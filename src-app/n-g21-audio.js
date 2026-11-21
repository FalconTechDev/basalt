// n-g21-audio.js — AudioRecorder (a4): built-in "audio-recorder" plugin that
// records microphone audio and saves it as a note attachment.
// Clean-room, spec g21 §3.5.

import { env } from "./env.js";

const NG21_AUDIO_NAME = "Recording ";

function ng21AudioT(host, key, fallback) {
  try {
    const table = env().gm && env().gm.plugins && env().gm.plugins.audioRecorder;
    const value = table && table[key];
    if (typeof value === "function") return value();
    if (typeof value === "string") return value;
  } catch (e) { /* fall through */ }
  return fallback;
}

/** Best-effort webm->m4a conversion; returns the original blob on any failure. */
async function ng21ConvertAudio(host, blob) {
  try {
    const entry = host.s13AudioConverter;
    if (typeof entry === "function") {
      const convert = entry.length === 0 ? entry() : entry;
      const fn = typeof convert === "function" ? convert : (convert && (convert.convert || convert.default));
      if (typeof fn === "function") return await fn(blob);
    }
  } catch (e) { console.warn("audio conversion failed", e); }
  return blob;
}

export function ng21DefineS13AudioRecorder(host) {
  function AudioRecorder() {
    this.id = "audio-recorder";
    this.name = ng21AudioT(host, "name", "Audio recorder");
    this.description = ng21AudioT(host, "desc", "Capture voice memos, kept as attachments.");
    this.defaultOn = true;
    this.app = null;
    this.plugin = null;
    this.recording = false;
    this.recorder = null;
    this.chunks = null;
    this.mime = "";
    this.extension = "";
    this.stream = null;
    this.ribbonEl = null;
    this._keepAwake = null;
    return this;
  }
  const p = AudioRecorder.prototype;

  p.init = function (app, plugin) {
    this.app = app;
    this.plugin = plugin;
  };

  p.onEnable = function (app, plugin) {
    const self = this;
    const T = (key, fb) => ng21AudioT(host, key, fb);
    plugin.registerRibbonItem(T("actionToggle", "Begin or end recording"), "lucide-mic", (event) => {
      if (event && event.currentTarget) self.ribbonEl = event.currentTarget;
      self.onRecordAudio();
    });
    plugin.registerGlobalCommand({
      id: "audio-recorder:start",
      name: T("actionStart", "Start recording"),
      icon: "lucide-play-circle",
      checkCallback: (checking) => {
        if (self.recording) return false;
        if (!checking) self.onStartRecording();
        return true;
      },
    });
    plugin.registerGlobalCommand({
      id: "audio-recorder:stop",
      name: T("actionStop", "Stop recording"),
      icon: "lucide-stop-circle",
      checkCallback: (checking) => {
        if (!self.recording) return false;
        if (!checking) self.onStopRecording();
        return true;
      },
    });
  };

  p.onDisable = function () {
    if (this.recording) this.onStopRecording();
  };

  p.checkPermission = async function () {
    const T = (key, fb) => ng21AudioT(host, key, fb);
    try {
      const electron = env().electron || (typeof window !== "undefined" && window.electron);
      const remote = electron && electron.remote;
      const sp = remote && remote.systemPreferences;
      if (host.Platform.isDesktopApp && host.Platform.isMacOS && sp && sp.getMediaAccessStatus) {
        const status = sp.getMediaAccessStatus("microphone");
        if (status === "denied" || status === "restricted" || status === "unknown") {
          this.showRecordingMessage(T("msgAccessDenied", "Microphone access denied."), true);
          return false;
        }
        if (status === "not-determined") {
          this.showRecordingMessage(T("msgPendingGrant", "Allow microphone access to record."), false);
          try { await sp.askForMediaAccess("microphone"); } catch (e) {}
          return sp.getMediaAccessStatus("microphone") === "granted";
        }
        return status === "granted";
      }
    } catch (e) { console.error(e); }
    return true;
  };

  p.onRecordAudio = async function () {
    if (!(await this.checkPermission())) return;
    if (this.recording) this.onStopRecording();
    else this.onStartRecording();
  };

  p.onStartRecording = function () {
    const self = this;
    const T = (key, fb) => ng21AudioT(host, key, fb);
    const nav = typeof navigator !== "undefined" ? navigator : null;
    if (host.Platform.isIosApp && (!nav || !nav.mediaDevices || !nav.mediaDevices.getUserMedia)) {
      new host.Notice("This functionality requires iOS 14.5.");
      return;
    }
    if (!nav || !nav.mediaDevices || !nav.mediaDevices.getUserMedia) {
      new host.Notice(T("msgNoMicrophone", "No microphone detected."));
      return;
    }
    nav.mediaDevices.getUserMedia({ audio: true }).then((stream) => {
      self.startRecording(stream);
      self.recording = true;
      if (self.ribbonEl) {
        host.setIcon(self.ribbonEl, "lucide-mic");
        self.ribbonEl.addClass("is-active");
      }
    }).catch((err) => {
      console.error(err);
      const msg = String(err && err.message ? err.message : err);
      if (/not found/i.test(msg)) {
        new host.Notice(T("msgNoMicrophone", "No microphone detected."));
      } else if (/denied/i.test(msg)) {
        new host.Notice(msg);
      } else {
        this.showRecordingMessage(T("msgNoMicrophone", "No microphone detected."), true);
      }
    });
  };

  p.onStopRecording = function () {
    this.recording = false;
    try { if (this.recorder && this.recorder.state !== "inactive") this.recorder.stop(); } catch (e) {}
    if (this.ribbonEl) this.ribbonEl.removeClass("is-active");
  };

  p.startRecording = function (stream) {
    const self = this;
    this.stream = stream;
    this.chunks = [];
    const nav = typeof navigator !== "undefined" ? navigator : null;
    const hasMp4 = typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported && MediaRecorder.isTypeSupported("audio/mp4");
    if (hasMp4) {
      this.mime = "audio/mp4";
      this.extension = "m4a";
    } else {
      this.mime = typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported && MediaRecorder.isTypeSupported('audio/webm;codecs="opus"')
        ? 'audio/webm;codecs="opus"' : "audio/webm";
      this.extension = "webm";
    }
    try {
      this.recorder = new MediaRecorder(stream, { mimeType: this.mime });
    } catch (e) {
      this.recorder = new MediaRecorder(stream);
      this.mime = this.recorder.mimeType || this.mime;
      this.extension = this.mime.indexOf("mp4") !== -1 || this.mime.indexOf("m4a") !== -1 ? "m4a" : "webm";
    }
    this.recorder.ondataavailable = (event) => {
      if (event.data && event.data.size > 0) this.chunks.push(event.data);
    };
    this.recorder.onstop = async () => {
      self.recorder = null;
      if (self.stream) {
        for (const track of self.stream.getTracks()) { try { track.stop(); } catch (e) {} }
        self.stream = null;
      }
      try {
        let blob = new Blob(self.chunks, { type: self.mime });
        self.chunks = null;
        if (self.extension === "webm") {
          try { blob = await ng21ConvertAudio(host, blob); } catch (e) { console.warn(e); }
          if (blob && blob.type && (blob.type.indexOf("mp4") !== -1 || blob.type.indexOf("m4a") !== -1)) self.extension = "m4a";
        }
        const buffer = await blob.arrayBuffer();
        await self.saveRecording(buffer);
      } catch (e) {
        console.error(e);
      } finally {
        if (self._keepAwake) {
          try { self._keepAwake.release(); } catch (e) {}
          self._keepAwake = null;
        }
      }
    };
    try {
      if (host.s13KeepAwake) this._keepAwake = host.s13KeepAwake();
    } catch (e) {}
    this.recorder.start();
  };

  p.saveRecording = async function (buffer) {
    const app = this.app;
    const vault = app.vault;
    const moment = (typeof window !== "undefined" && window.moment) || globalThis.moment;
    const stamp = moment ? moment().format("YYYYMMDDHHmmss") : String(Date.now());
    const name = NG21_AUDIO_NAME + stamp;
    const view = app.workspace.getActiveViewOfType(host.MarkdownView);
    const activeFile = app.workspace.getActiveFile && app.workspace.getActiveFile();
    const path = await vault.getAvailablePathForAttachments(name, this.extension || "webm", activeFile);
    const file = await vault.createBinary(path, buffer);
    if (view && view.file && view.editor) {
      const link = app.fileManager.generateMarkdownLink(file, view.file.path);
      view.editor.replaceSelection("\n!" + link + "\n");
    } else {
      const leaf = app.workspace.getUnpinnedLeaf(false);
      if (leaf) leaf.openFile(file);
    }
  };

  p.showRecordingMessage = function (msg, isError) {
    const el = this.ribbonEl || this._findRibbonEl();
    if (!el) { new host.Notice(msg); return; }
    try {
      host.setTooltip(el, msg, { delay: 0, placement: "right" });
      el.toggleClass("mod-error", !!isError);
    } catch (e) { new host.Notice(msg); }
  };

  p._findRibbonEl = function () {
    try {
      const buttons = document.querySelectorAll(".side-dock-ribbon-action, .workspace-ribbon .clickable-icon");
      for (const b of buttons) {
        const svg = b.querySelector("svg");
        if (svg && /mic/.test(svg.getAttribute("class") || "")) return b;
      }
      return buttons[0] || null;
    } catch (e) { return null; }
  };

  return AudioRecorder;
}
