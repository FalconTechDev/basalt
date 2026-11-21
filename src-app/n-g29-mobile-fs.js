// g29 clean-room: Capacitor filesystem bridge (spec Part E). Wraps every
// plugin call (env().Dm) with directory bookkeeping, binary streaming for
// large files and ENOENT error normalisation.
import { env } from "./env.js";
import { collapseSlashes } from "./path.js";

const NG29_INLINE_LIMIT = 5 * 1024 * 1024;
const NG29_STREAM_CHUNK = 1024 * 1024;

function ng29NormalizeError(error) {
  if (error && typeof error.message === "string"
    && (error.message.includes("does not exist") || error.message.includes("there is no such file"))) {
    error.code = "ENOENT";
  }
  return error;
}

function ng29ToUint8(data) {
  return data instanceof Uint8Array ? data : new Uint8Array(data);
}

function ng29ToBase64(bytes) {
  let bin = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    bin += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
  }
  return btoa(bin);
}

export function s04CapacitorFs(host) {
  return class CapacitorFs {
    constructor(dir) {
      this.dir = dir;
      this.uri = "";
    }

    async call(method, args) {
      try {
        return await env().Dm[method](args);
      } catch (error) {
        throw ng29NormalizeError(error);
      }
    }

    baseArgs(extra) {
      return Object.assign({ directory: this.dir }, extra);
    }

    async init() {
      const result = await this.call("getUri", this.baseArgs({ path: "" }));
      this.uri = result.uri;
    }

    watch(path) { return this.call("startWatch", this.baseArgs({ path })); }
    verifyIcloud(path) { return this.call("verifyIcloud", { path }); }
    read(path) { return this.call("readFile", this.baseArgs({ path, encoding: "utf8" })).then((r) => r.data); }
    write(path, data) { return this.call("writeFile", this.baseArgs({ path, data, encoding: "utf8" })); }
    append(path, data) { return this.call("appendFile", this.baseArgs({ path, data, encoding: "utf8" })); }
    mkdir(path) { return this.call("mkdir", this.baseArgs({ path, recursive: true })); }
    readdir(path) { return this.call("readdir", this.baseArgs({ path })).then((r) => r.files); }
    stat(path) { return this.call("stat", this.baseArgs({ path })); }
    watchAndStatAll(path) { return this.call("watchAndStatAll", this.baseArgs({ path })); }
    setTimes(path, ctime, mtime) { return this.call("setTimes", this.baseArgs({ path, ctime, mtime })); }
    rmdir(path) { return this.call("rmdir", this.baseArgs({ path, recursive: true })); }
    delete(path) { return this.call("deleteFile", this.baseArgs({ path })); }
    rename(from, to) { return this.call("rename", this.baseArgs({ from, to })); }
    copy(from, to) { return this.call("copy", this.baseArgs({ from, to })); }
    open(path) { return this.call("open", this.baseArgs({ path })); }
    trash(path) { return this.call("trash", this.baseArgs({ path })); }

    async exists(path) {
      try {
        await this.stat(path);
        return true;
      } catch (error) {
        return false;
      }
    }

    async readBinary(path) {
      const info = await this.stat(path);
      if (info.size < NG29_INLINE_LIMIT) {
        const result = await this.call("readFile", this.baseArgs({ path }));
        return host.base64ToBuffer(result.data);
      }
      const response = await fetch(this.getUri(path));
      return response.arrayBuffer();
    }

    async writeBinary(path, data) {
      await this.writeBinaryInternal(path, data, false);
    }

    async appendBinary(path, data) {
      await this.writeBinaryInternal(path, data, true);
    }

    async writeBinaryInternal(path, data, append) {
      const bytes = ng29ToUint8(data);
      if (bytes.byteLength < NG29_INLINE_LIMIT) {
        const payload = { data: ng29ToBase64(bytes) };
        if (append) await this.call("appendFile", this.baseArgs(Object.assign({ path }, payload)));
        else await this.call("writeFile", this.baseArgs(Object.assign({ path }, payload)));
        return;
      }
      try {
        if (!append) await this.call("writeFile", this.baseArgs({ path, data: "" }));
        for (let offset = 0; offset < bytes.byteLength; offset += NG29_STREAM_CHUNK) {
          const chunk = bytes.subarray(offset, offset + NG29_STREAM_CHUNK);
          await this.call("appendFile", this.baseArgs({ path, data: ng29ToBase64(chunk) }));
        }
      } catch (error) {
        if (!append) {
          try { await this.call("deleteFile", this.baseArgs({ path })); } catch (e) { /* best effort */ }
        }
        throw error;
      }
    }

    getNativeUri(path) {
      const tidy = collapseSlashes(path);
      if (tidy === "/") return this.uri;
      const root = this.uri.endsWith("/") ? this.uri : this.uri + "/";
      return root + tidy.split("/").map((seg) => encodeURIComponent(seg)).join("/");
    }

    getUri(path) {
      const native = this.getNativeUri(path);
      if (native.startsWith("file://")) {
        return host.s04CapacitorCore.Ii.convertFileSrc(native);
      }
      return native;
    }
  };
}
