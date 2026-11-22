import * as Y from "yjs";
import { WebrtcProvider } from "y-webrtc";
import * as awareness from "y-protocols/awareness";
import { joinRoom } from "trystero";

// A Yjs provider over Trystero: peers find each other through public relays (Nostr), then talk directly over WebRTC.
// Options: password, relayUrls, readOnly (never sends document changes), ok(peerId, userId) (peers failing it are held back until admit()), onPending(peerId, userId).
class TrysteroProvider {
  constructor(roomId, doc, opts = {}) {
    this.doc = doc; this.awareness = new awareness.Awareness(doc); this.peers = new Map(); this.status = "connecting"; this.listeners = new Set();
    this.readOnly = !!opts.readOnly; this.isReadOnly = opts.isReadOnly || (() => this.readOnly); this.canWrite = opts.canWrite || (() => true); this.ok = opts.ok || (() => true); this.onPending = opts.onPending || (() => {}); this.selfUserId = null;
    const cfg = { appId: "basalt-share" }; if (opts.password) cfg.password = opts.password; if (opts.relayUrls && opts.relayUrls.length) cfg.relayUrls = opts.relayUrls;
    this.room = joinRoom(cfg, roomId);
    try { const g = this.room.getSelf(); if (g && g.then) g.then((s) => { this.selfUserId = s && s.userId; }).catch(() => {}); } catch (e) { /* ignore */ }
    const sync = this.room.makeAction("sync"), upd = this.room.makeAction("upd"), aws = this.room.makeAction("aw");
    const aw = this.awareness, safe = (p) => { if (p && p.catch) p.catch(() => {}); };
    const bcast = (act, data) => { for (const [id, i] of this.peers) if (i.admitted) safe(act.send(data, { target: id })); };
    this.onUpdate = (u, origin) => { if (origin !== this && !this.isReadOnly()) bcast(upd, u); };
    doc.on("update", this.onUpdate);
    this.onAw = ({ added, updated, removed }, origin) => { if (origin !== this) bcast(aws, awareness.encodeAwarenessUpdate(aw, added.concat(updated, removed))); };
    aw.on("update", this.onAw);
    const full = (id) => { if (!this.isReadOnly()) safe(sync.send(Y.encodeStateAsUpdate(doc), { target: id })); safe(aws.send(awareness.encodeAwarenessUpdate(aw, [aw.clientID]), { target: id })); };
    this.admit = (id) => { const i = this.peers.get(id); if (!i || i.admitted) return; i.admitted = true; full(id); this.emit(); };
    this.recheck = () => { for (const [id, i] of this.peers) { const ok = this.ok(id, i.userId); if (!i.admitted && ok) this.admit(id); else if (i.admitted && !ok) { i.admitted = false; this.emit(); } } };
    this.room.onPeerJoin(({ peerId, userId }) => {
      const i = { ids: new Set(), userId, admitted: false }; this.peers.set(peerId, i); this.status = "online";
      if (this.ok(peerId, userId)) { i.admitted = true; full(peerId); } else { try { this.onPending(peerId, userId); } catch (e) { /* ignore */ } }
      this.emit();
    });
    this.room.onPeerLeave(({ peerId }) => {
      const i = this.peers.get(peerId); this.peers.delete(peerId); if (i && i.ids.size) awareness.removeAwarenessStates(aw, Array.from(i.ids), this);
      if (!this.peers.size) this.status = "alone"; this.emit();
    });
    sync.onMessage((d, { peerId }) => { const i = this.peers.get(peerId); if (i && !this.canWrite(i.userId)) return; Y.applyUpdate(doc, new Uint8Array(d), this); });
    upd.onMessage((d, { peerId }) => { const i = this.peers.get(peerId); if (i && !this.canWrite(i.userId)) return; Y.applyUpdate(doc, new Uint8Array(d), this); });
    aws.onMessage((d, { peerId }) => { const before = new Set(aw.getStates().keys()); awareness.applyAwarenessUpdate(aw, new Uint8Array(d), this); const i = this.peers.get(peerId); if (i) for (const k of aw.getStates().keys()) if (!before.has(k) && k !== aw.clientID) i.ids.add(k); });
    setTimeout(() => { if (!this.peers.size && this.status === "connecting") { this.status = "alone"; this.emit(); } }, 8000);
  }
  emit() { for (const f of this.listeners) { try { f(this); } catch (e) { /* ignore */ } } }
  onStatus(f) { this.listeners.add(f); }
  destroy() { this.doc.off("update", this.onUpdate); this.awareness.off("update", this.onAw); awareness.removeAwarenessStates(this.awareness, [this.awareness.clientID], this); try { const r = this.room.leave(); if (r && r.catch) r.catch(() => {}); } catch (e) { /* ignore */ } this.listeners.clear(); }
}
window.__bsY = { Y, WebrtcProvider, TrysteroProvider, awareness };
