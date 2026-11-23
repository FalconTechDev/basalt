// Client for the running app's local API (src/basalt-api.js). Finds address and token, never touches a browser.
import os from "node:os";
import path from "node:path";
import http from "node:http";
import { CliError, EXIT, readJson } from "./util.mjs";

export function userDataDir(env = process.env) {
  if (env.BASALT_USER_DATA) return env.BASALT_USER_DATA;
  const base = env.APPDATA || (process.platform === "darwin" ? path.join(os.homedir(), "Library/Application Support") : path.join(os.homedir(), ".config"));
  return path.join(base, "Basalt");
}
export function apiInfo(opts = {}, env = process.env) {
  if (env.BASALT_API_URL && env.BASALT_API_TOKEN) { const u = new URL(env.BASALT_API_URL); return { port: +u.port, token: env.BASALT_API_TOKEN, host: u.hostname }; }
  const file = opts.infoFile || env.BASALT_API_INFO || path.join(userDataDir(env), "basalt-api.json");
  const j = readJson(file, null);
  if (!j || !j.port || !j.token) throw new CliError(`Basalt is not running or its API info is missing (${file})`, EXIT.APP);
  return { ...j, host: "127.0.0.1", file };
}
const qs = (q) => {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(q || {})) if (v !== undefined && v !== null && v !== false) p.set(k, v === true ? "1" : String(v));
  const s = p.toString(); return s ? "?" + s : "";
};

export class App {
  constructor(opts = {}, env = process.env) { this.info = apiInfo(opts, env); }
  request(method, route, { query, body } = {}) {
    return new Promise((resolve, reject) => {
      const data = body === undefined ? null : typeof body === "string" ? body : JSON.stringify(body);
      const headers = { Authorization: "Bearer " + this.info.token };
      if (data !== null) { headers["Content-Length"] = Buffer.byteLength(data); headers["Content-Type"] = typeof body === "string" ? "text/plain" : "application/json"; }
      const req = http.request({ host: this.info.host, port: this.info.port, method, path: route + qs(query), headers, timeout: 30000 }, (res) => {
        const chunks = []; res.on("data", (c) => chunks.push(c));
        res.on("end", () => {
          const text = Buffer.concat(chunks).toString("utf8"); let val = text;
          if (/json/.test(res.headers["content-type"] || "")) { try { val = JSON.parse(text); } catch { /* keep text */ } }
          if (res.statusCode >= 400) return reject(new CliError(`app answered ${res.statusCode}: ${(val && val.error) || text}`, res.statusCode === 404 ? EXIT.NOT_FOUND : res.statusCode === 403 ? EXIT.REFUSED : EXIT.APP, val));
          resolve(val);
        });
      });
      req.on("timeout", () => req.destroy(new Error("timeout")));
      req.on("error", (e) => reject(new CliError(`cannot reach Basalt on port ${this.info.port}: ${e.message}`, EXIT.APP)));
      if (data !== null) req.write(data);
      req.end();
    });
  }
  get(r, query) { return this.request("GET", r, { query }); }
  post(r, query, body) { return this.request("POST", r, { query, body }); }
  /** Server-Sent Events: calls onEvent({type,...}); returns {close()} */
  events(onEvent, onEnd) {
    const req = http.request({ host: this.info.host, port: this.info.port, path: "/v1/events", headers: { Authorization: "Bearer " + this.info.token } }, (res) => {
      if (res.statusCode !== 200) { onEnd && onEnd(new Error("status " + res.statusCode)); return; }
      let buf = ""; res.setEncoding("utf8");
      res.on("data", (c) => {
        buf += c; let i;
        while ((i = buf.indexOf("\n\n")) >= 0) {
          const blk = buf.slice(0, i); buf = buf.slice(i + 2);
          const d = blk.split("\n").filter((l) => l.startsWith("data: ")).map((l) => l.slice(6)).join("\n");
          if (d) { try { onEvent(JSON.parse(d)); } catch { /* skip */ } }
        }
      });
      res.on("end", () => onEnd && onEnd()); res.on("error", (e) => onEnd && onEnd(e));
    });
    req.on("error", (e) => onEnd && onEnd(e)); req.end();
    return { close: () => req.destroy() };
  }
}
export const settingsPath = (env = process.env) => path.join(userDataDir(env), "basalt-api-settings.json");
