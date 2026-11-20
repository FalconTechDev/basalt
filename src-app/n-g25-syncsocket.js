// g25 clean-room s16-sync-socket: SyncSocket — one WebSocket to the vault sync server.
// Spec: F:\orch\specs\g25.md Part I. JSON control messages + binary data frames (2 MiB pieces),
// heartbeat keepalive, deterministic path/hash encryption via the vault cipher provider.

const NG25SS_PIECE = 2 * 1024 * 1024;
const NG25SS_REQ_TIMEOUT = 60000;
const NG25SS_HEARTBEAT = 20000;
const NG25SS_IDLE_PING = 10000;
const NG25SS_IDLE_DROP = 120000;

function ng25ssNow() { return Date.now(); }

function ng25ssDeferred() {
  let resolve, reject;
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  return { resolve, reject, promise };
}

// Close-code -> text classification (RFC 6455 ranges).
function ng25ssCloseText(code) {
  if (code >= 0 && code <= 999) return "(Unused)";
  if (code >= 1016 && code <= 1999) return "(Standard)";
  if (code >= 2000 && code <= 2999) return "(Extensions)";
  if (code >= 3000 && code <= 3999) return "(Libraries)";
  if (code >= 4000 && code <= 4999) return "(Applications)";
  const known = {
    1000: "Normal Closure", 1001: "Going Away", 1002: "Protocol Error", 1003: "Unsupported Data",
    1005: "No Status", 1006: "Abnormal Closure", 1007: "Invalid Payload",
    1008: "Policy Violation", 1009: "Message Too Big", 1010: "Extension Error",
    1011: "Internal Error", 1012: "Service Restart", 1013: "Try Again Later",
    1014: "Bad Gateway", 1015: "TLS Handshake",
  };
  return known[code] || "(Unknown)";
}

export function defineSyncSocket(host) {
  const SerialTaskQueue = host.SerialTaskQueue;

  class SyncSocket {
    constructor(encryptionProvider) {
      this.socket = null;
      this.queue = new SerialTaskQueue();
      this.notifyQueue = new SerialTaskQueue();
      this.perFileMax = 208666624;
      this.userId = -1;
      this.justPushed = null;
      this.encryptionProvider = encryptionProvider;
      this.heartbeat = null;
      this.lastMessageTs = 0;
      this.responsePromise = null;
      this.dataPromise = null;
      this.onReady = null;
      this.onPush = null;
      this.lastNetworkRequestTs = 0;
    }

    isConnecting() { return !!this.socket && this.socket.readyState === 0; }
    isConnected() { return !!this.socket && this.socket.readyState === 1; }
    hasConnection() { return this.socket !== null; }

    send(msg) { this.socket.send(JSON.stringify(msg)); }
    sendBinary(data) { this.socket.send(data); }

    // Arms the deferred resolved by the next JSON response message; resolves with it.
    response() {
      const d = ng25ssDeferred();
      this.responsePromise = d;
      return d.promise;
    }

    // Arms the deferred resolved by the next binary message; resolves with the data.
    dataResponse() {
      const d = ng25ssDeferred();
      this.dataPromise = d;
      return d.promise;
    }

    // Sends a JSON request and resolves with the response message
    // (rejects Error(response.err) when the server reports an error).
    request(message, timeout = NG25SS_REQ_TIMEOUT) {
      return new Promise((resolve, reject) => {
        const slot = {
          resolve: (m) => {
            clearTimeout(timer);
            if (m && m.err !== undefined) reject(new Error(m.err));
            else resolve(m);
          },
          reject: (e) => { clearTimeout(timer); reject(e); },
        };
        const timer = setTimeout(() => {
          if (this.responsePromise === slot) this.responsePromise = null;
          reject(new Error("Timeout"));
          this.disconnect();
        }, timeout);
        this.responsePromise = slot;
        try { this.send(message); }
        catch (e) {
          clearTimeout(timer);
          if (this.responsePromise === slot) this.responsePromise = null;
          reject(e);
        }
      });
    }

    onMessage(event) {
      this.lastMessageTs = ng25ssNow();
      const data = event.data;
      if (typeof data !== "string") {
        if (this.dataPromise) {
          const d = this.dataPromise; this.dataPromise = null;
          d.resolve(data);
        }
        return;
      }
      let msg;
      try { msg = JSON.parse(data); }
      catch (e) {
        console.error("Sync socket: unparseable message:", data);
        this.disconnect();
        return;
      }
      if (msg && msg.op === "pong") return;
      if (msg && msg.op === "ready") {
        if (this.onReady) this.onReady(msg.version);
        return;
      }
      if (msg && msg.op === "push") {
        this.onServerPush(msg);
        return;
      }
      if (this.responsePromise) {
        const d = this.responsePromise; this.responsePromise = null;
        d.resolve(msg);
      }
    }

    disconnect() {
      const s = this.socket;
      this.socket = null;
      if (this.heartbeat) { clearInterval(this.heartbeat); this.heartbeat = null; }
      for (const key of ["responsePromise", "dataPromise"]) {
        const d = this[key];
        this[key] = null;
        if (d && d.reject) d.reject(new Error("Disconnected"));
      }
      if (s) {
        try { s.onclose = null; s.onerror = null; s.onmessage = null; s.onopen = null; s.close(); } catch (e) {}
      }
    }

    connect(url, token, id, version, initial, device, onReady, onPush) {
      if (this.socket) return Promise.resolve();
      return new Promise((resolve, reject) => {
        let u;
        try { u = new URL(url); } catch (e) { return reject(new Error("Unable to connect to server.")); }
        const hostName = u.hostname;
        if (!(hostName === "127.0.0.1" || hostName.endsWith(".basalt.md"))) {
          return reject(new Error("Unable to connect to server."));
        }
        const ws = new WebSocket(u.toString());
        ws.binaryType = "arraybuffer";
        this.socket = ws;
        this.onReady = onReady;
        this.onPush = onPush;
        this.lastMessageTs = ng25ssNow();
        let handshake = true;
        let settled = false;

        const fail = (err) => {
          if (settled) return;
          settled = true;
          this.disconnect();
          reject(err);
        };

        ws.onopen = () => {
          this.heartbeat = setInterval(() => {
            const idle = ng25ssNow() - this.lastMessageTs;
            if (idle > NG25SS_IDLE_DROP) { this.disconnect(); return; }
            if (idle > NG25SS_IDLE_PING && this.socket) {
              try { this.send({ op: "ping" }); } catch (e) {}
            }
          }, NG25SS_HEARTBEAT);
          try {
            this.send({
              op: "init", token, id,
              keyhash: this.encryptionProvider.keyHash,
              version, initial, device,
              encryption_version: this.encryptionProvider.encryptionVersion,
            });
          } catch (e) { fail(e); }
        };

        ws.onmessage = (event) => {
          this.lastMessageTs = ng25ssNow();
          const data = event.data;
          if (handshake) {
            if (typeof data !== "string") return fail(new Error("Server returned binary"));
            let msg;
            try { msg = JSON.parse(data); }
            catch (e) { return fail(new Error("Server JSON failed to parse: " + data)); }
            if (msg && msg.op === "pong") return;
            if (msg && (msg.status === "err" || msg.res === "err")) {
              return fail(new Error("Failed to authenticate: " + (msg.msg || msg.error || data)));
            }
            if (!msg || msg.res !== "ok") return fail(new Error("Did not respond to login request: " + data));
            if (msg.perFileMax !== undefined) {
              if (typeof msg.perFileMax !== "number" || !Number.isInteger(msg.perFileMax) || msg.perFileMax < 0) {
                return fail(new Error("Unexpected value from server for max file size"));
              }
              this.perFileMax = msg.perFileMax;
            }
            if (msg.userId) this.userId = msg.userId;
            handshake = false;
            ws.onmessage = (ev) => this.onMessage(ev);
            ws.onclose = () => this.disconnect();
            ws.onerror = () => this.disconnect();
            settled = true;
            resolve();
            return;
          }
          this.onMessage(event);
        };

        ws.onclose = (event) => {
          if (handshake && !settled) {
            const code = event ? event.code : -1;
            fail(code === 1006
              ? new Error("Unable to connect to server.")
              : new Error("Disconnected. Code: " + code + " " + ng25ssCloseText(code)));
          } else {
            this.disconnect();
          }
        };
        ws.onerror = () => { if (handshake) fail(new Error("Unable to connect to server.")); };
      });
    }

    // ---- file operations (serial on queue) ----

    pull(uid) {
      return this.queue.queue(async () => {
        const meta = await this.request({ op: "pull", uid });
        if (meta.deleted) return null;
        const size = meta.size || 0;
        const out = new Uint8Array(size);
        let offset = 0;
        for (let i = 0; i < (meta.pieces || 0); i++) {
          const chunk = await this.dataResponse();
          const u8 = chunk instanceof Uint8Array ? chunk : new Uint8Array(chunk);
          const n = Math.min(u8.length, size - offset);
          out.set(u8.subarray(0, n), offset);
          offset += u8.length;
        }
        const buf = out.buffer.slice(out.byteOffset, out.byteOffset + out.byteLength);
        if (size > 0) return this.encryptionProvider.decrypt(buf);
        return buf;
      });
    }

    push(path, relatedPath, folder, deleted, ctime, mtime, hash, content) {
      return this.queue.queue(async () => {
        const enc = this.encryptionProvider;
        const encPath = await enc.deterministicEncodeStr(path);
        const msg = { op: "push", path: encPath };
        if (relatedPath) msg.relatedpath = await enc.deterministicEncodeStr(relatedPath);
        const seg = path.slice(path.lastIndexOf("/") + 1);
        const dot = seg.lastIndexOf(".");
        msg.extension = folder ? "" : (dot > 0 ? seg.slice(dot + 1) : "");
        msg.folder = !!folder;
        msg.deleted = !!deleted;

        if (folder || deleted) {
          msg.hash = ""; msg.ctime = 0; msg.mtime = 0;
          this.justPushed = {
            path: encPath, folder: msg.folder, deleted: msg.deleted, mtime,
            hash: hash ? await enc.deterministicEncodeStr(hash) : "",
          };
          await this.request(msg);
          return;
        }

        let payload = content;
        if (payload && payload.byteLength) payload = await enc.encrypt(payload);
        const encHash = hash ? await enc.deterministicEncodeStr(hash) : "";
        const size = payload ? payload.byteLength : 0;
        msg.size = size;
        msg.pieces = Math.ceil(size / NG25SS_PIECE);
        msg.hash = encHash;
        msg.ctime = ctime || 0;
        msg.mtime = mtime || 0;
        this.justPushed = { path: encPath, folder: false, deleted: false, mtime, hash: encHash };
        const res = await this.request(msg);
        if (res && res.res === "ok") { this.justPushed = null; return; }
        if (payload && size > 0) {
          const u8 = payload instanceof Uint8Array ? payload : new Uint8Array(payload);
          for (let off = 0; off < u8.length; off += NG25SS_PIECE) {
            this.sendBinary(u8.subarray(off, off + NG25SS_PIECE));
            await this.response();
          }
        }
        this.justPushed = null;
      });
    }

    listDeleted() {
      return this.queue.queue(async () => {
        const res = await this.request({ op: "deleted", suppressrenames: true });
        const items = res && res.items ? res.items : [];
        for (const it of items) {
          if (it && it.path) it.path = await this.encryptionProvider.deterministicDecodeStr(it.path);
        }
        return items;
      });
    }

    listHistory(path, last) {
      return this.queue.queue(async () => {
        const enc = await this.encryptionProvider.deterministicEncodeStr(path);
        const res = await this.request({ op: "history", path: enc, last });
        const items = res && res.items ? res.items : [];
        for (const it of items) {
          if (it && it.path) it.path = await this.encryptionProvider.deterministicDecodeStr(it.path);
          if (it && it.relatedpath) it.relatedpath = await this.encryptionProvider.deterministicDecodeStr(it.relatedpath);
        }
        return res;
      });
    }

    restore(uid) { return this.queue.queue(() => this.request({ op: "restore", uid })); }
    getUsernames() { return this.queue.queue(() => this.request({ op: "usernames" })); }
    purge() { return this.queue.queue(() => this.request({ op: "purge" })); }
    size() { return this.queue.queue(() => this.request({ op: "size" })); }

    onServerPush(message) {
      const jp = this.justPushed;
      if (jp && message &&
          message.path === jp.path && message.folder === jp.folder &&
          message.deleted === jp.deleted && message.mtime === jp.mtime &&
          (message.hash || "") === (jp.hash || "")) {
        this.justPushed = null;
        message.wasJustPushed = true;
      }
      this.notifyQueue.queue(async () => {
        if (message && message.path) {
          try { message.path = await this.encryptionProvider.deterministicDecodeStr(message.path); } catch (e) {}
        }
        if (message && message.hash) {
          try { message.hash = await this.encryptionProvider.deterministicDecodeStr(message.hash); } catch (e) {}
        }
        if (this.onPush) this.onPush(message);
      });
    }
  }

  return SyncSocket;
}
