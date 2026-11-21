import * as Y from "yjs";
import { WebrtcProvider } from "y-webrtc";
import * as awareness from "y-protocols/awareness";
import { joinRoom } from "trystero";

// A Yjs provider over Trystero: peers find each other through public relays (Nostr), then talk directly over WebRTC.
class TrysteroProvider {
  constructor(roomId, doc, opts = {}) {
    this.doc = doc; this.awareness = new awareness.Awareness(doc); this.peers = new Map(); this.status = "connecting"; this.listeners = new Set();
    const cfg = { appId: "basalt-share" }; if (opts.password) cfg.password = opts.password; if (opts.relayUrls && opts.relayUrls.length) cfg.relayUrls = opts.relayUrls;
    this.room = joinRoom(cfg, roomId);
    const sync = this.room.makeAction("sync"), upd = this.room.makeAction("upd"), aws = this.room.makeAction("aw");
    const aw = this.awareness, safe = (p) => { if (p && p.catch) p.catch(() => {}); };
    this.onUpdate = (u, origin) => { if (origin !== this) safe(upd.send(u)); };
    doc.on("update", this.onUpdate);
    this.onAw = ({ added, updated, removed }, origin) => { if (origin !== this) safe(aws.send(awareness.encodeAwarenessUpdate(aw, added.concat(updated, removed)))); };
    aw.on("update", this.onAw);
    this.room.onPeerJoin(({ peerId }) => {
      this.peers.set(peerId, new Set()); this.status = "online"; this.emit();
      safe(sync.send(Y.encodeStateAsUpdate(doc), { target: peerId })); safe(aws.send(awareness.encodeAwarenessUpdate(aw, [aw.clientID]), { target: peerId }));
    });
    this.room.onPeerLeave(({ peerId }) => {
      const ids = this.peers.get(peerId); this.peers.delete(peerId); if (ids && ids.size) awareness.removeAwarenessStates(aw, Array.from(ids), this);
      if (!this.peers.size) this.status = "alone"; this.emit();
    });
    sync.onMessage((d) => { Y.applyUpdate(doc, new Uint8Array(d), this); });
    upd.onMessage((d) => { Y.applyUpdate(doc, new Uint8Array(d), this); });
    aws.onMessage((d, { peerId }) => { const before = new Set(aw.getStates().keys()); awareness.applyAwarenessUpdate(aw, new Uint8Array(d), this); const set = this.peers.get(peerId); if (set) for (const k of aw.getStates().keys()) if (!before.has(k) && k !== aw.clientID) set.add(k); });
    setTimeout(() => { if (!this.peers.size && this.status === "connecting") { this.status = "alone"; this.emit(); } }, 8000);
  }
  emit() { for (const f of this.listeners) { try { f(this); } catch (e) { /* ignore */ } } }
  onStatus(f) { this.listeners.add(f); }
  destroy() { this.doc.off("update", this.onUpdate); this.awareness.off("update", this.onAw); awareness.removeAwarenessStates(this.awareness, [this.awareness.clientID], this); try { const r = this.room.leave(); if (r && r.catch) r.catch(() => {}); } catch (e) { /* ignore */ } this.listeners.clear(); }
}
window.__bsY = { Y, WebrtcProvider, TrysteroProvider, awareness };
