// g29 clean-room: URL query codec, data-URL parser, HTTP request pipeline
// (Capacitor / Electron IPC / fetch dispatch), lazy response wrappers and
// GitHub URL builders (spec Part D).
import { env } from "./env.js";

// ---------- query codec ----------

function ng29EncodeUrlQuery(params) {
  if (params == null) return "";
  const parts = [];
  for (const key of Object.keys(params)) {
    const value = params[key];
    if (!value) continue;
    if (value === true) parts.push(encodeURIComponent(key));
    else parts.push(encodeURIComponent(key) + "=" + encodeURIComponent(value));
  }
  return parts.join("&");
}

function ng29DecodeUrlQuery(text) {
  const out = {};
  if (!text || !String(text).trim()) return out;
  for (const piece of String(text).split("&")) {
    const eq = piece.indexOf("=");
    const key = piece.slice(0, eq < 0 ? undefined : eq);
    if (!key) continue;
    const single = eq >= 0 && eq === piece.lastIndexOf("=");
    out[decodeURIComponent(key)] = single ? decodeURIComponent(piece.slice(eq + 1)) : "";
  }
  return out;
}

function ng29DecodeUrl(url) {
  const out = { path: "", query: {}, hash: {} };
  if (!url) return out;
  let s = String(url);
  const hi = s.indexOf("#");
  let hashText = "";
  if (hi >= 0) {
    const rest = s.slice(hi + 1);
    const hi2 = rest.indexOf("#");
    hashText = hi2 >= 0 ? rest.slice(0, hi2) : rest;
    s = s.slice(0, hi);
  }
  const qi = s.indexOf("?");
  let queryText = "";
  if (qi >= 0) {
    const rest = s.slice(qi + 1);
    const qi2 = rest.indexOf("?");
    queryText = qi2 >= 0 ? rest.slice(0, qi2) : rest;
    s = s.slice(0, qi);
  }
  out.path = s;
  out.query = ng29DecodeUrlQuery(queryText);
  out.hash = ng29DecodeUrlQuery(hashText);
  return out;
}

function ng29AddQuery(url, params) {
  return url + (url.includes("?") ? "&" : "?") + ng29EncodeUrlQuery(params);
}

const NG29_QUERY = {
  encodeUrlQuery: ng29EncodeUrlQuery,
  decodeUrlQuery: ng29DecodeUrlQuery,
  decodeUrl: ng29DecodeUrl,
  addQuery: ng29AddQuery,
};

export function s04UrlQuery() {
  return NG29_QUERY;
}

// ---------- data: URLs ----------

const NG29_DATA_URL_RE = /^data:((?:[a-z0-9!#$&^_.+-]+\/[a-z0-9!#$&^_.+-]+)?((?:;[a-z0-9!#$%&'*+.^_`|~-]+=[a-z0-9!#$%&'*+.^_`|~:-]*)*))(;base64)?,([a-z0-9!#$%&'()*+,\-./:;=?@_~%]*)$/i;

export const s04DataUrlPattern = NG29_DATA_URL_RE;

export function s04ParseDataUrl(url) {
  const m = NG29_DATA_URL_RE.exec(String(url || "").trim());
  if (!m) return null;
  const mimeText = m[1] || "text/plain;charset=us-ascii";
  const segments = mimeText.split(";");
  const properties = {};
  for (const seg of segments.slice(1)) {
    const parts = seg.split("=");
    properties[parts[0]] = parts.length > 1 ? parts[1] : undefined;
  }
  const isBase64 = !!m[3];
  const data = m[4] || "";
  return {
    contentType: segments[0].toLowerCase(),
    properties,
    isBase64,
    data,
    get arrayBuffer() {
      if (isBase64) {
        const bin = atob(data);
        const u8 = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
        return u8.buffer;
      }
      const u8 = new TextEncoder().encode(data);
      const ab = new ArrayBuffer(u8.byteLength);
      new Uint8Array(ab).set(u8);
      return ab;
    },
  };
}
