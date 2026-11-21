// n-g25-crypto.js — clean-room vault crypto (spec g25 Part J).
// AES-GCM via WebCrypto; AES-SIV (S2V/CMAC/CTR) built on AES-CBC single-block
// primitive; scrypt via node crypto or window.scrypt; HKDF via WebCrypto.

const ng25cSubtle = () => globalThis.crypto.subtle;
const ng25cText = () => new TextEncoder();

export function utf8Bytes(str) {
  const u8 = ng25cText().encode(String(str));
  return u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength);
}
export function utf8String(buf) {
  return new TextDecoder().decode(buf);
}
export function decodeBase64(b64) {
  const bin = atob(b64);
  const u8 = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
  return u8.buffer;
}
export function encodeBase64(buf) {
  const u8 = new Uint8Array(buf);
  let s = "";
  const CH = 0x8000;
  for (let i = 0; i < u8.length; i += CH) {
    s += String.fromCharCode.apply(null, u8.subarray(i, i + CH));
  }
  return btoa(s);
}
export async function sha256(data) {
  return ng25cSubtle().digest("SHA-256", data);
}
export function randomSaltHex() {
  const u8 = new Uint8Array(16);
  globalThis.crypto.getRandomValues(u8);
  return ng25cHex(u8);
}
export function constantTimeEqual(a, b) {
  if (a.length !== b.length) return false;
  let acc = 0;
  for (let i = 0; i < a.length; i++) acc |= a[i] ^ b[i];
  return acc === 0;
}

function ng25cHex(buf) {
  const u8 = new Uint8Array(buf);
  let s = "";
  for (let i = 0; i < u8.length; i++) s += u8[i].toString(16).padStart(2, "0");
  return s;
}
function ng25cUnhex(hex) {
  const s = String(hex);
  const u8 = new Uint8Array(s.length / 2);
  for (let i = 0; i < u8.length; i++) u8[i] = parseInt(s.substr(i * 2, 2), 16);
  return u8;
}
function ng25cConcat(parts) {
  const u8s = parts.map((p) => p instanceof Uint8Array ? p : new Uint8Array(p));
  const out = new Uint8Array(u8s.reduce((n, u) => n + u.length, 0));
  let o = 0;
  for (const u of u8s) { out.set(u, o); o += u.length; }
  return out;
}

let ng25cSivErrorClass = null;
export function defineSivError() {
  if (!ng25cSivErrorClass) {
    ng25cSivErrorClass = class SivError extends Error {
      constructor(msg) { super(msg); this.name = "SivError"; }
    };
  }
  return ng25cSivErrorClass;
}

export async function importAesGcmKey(rawKey) {
  return ng25cSubtle().importKey("raw", rawKey, { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);
}

export async function aesGcmEncrypt(data, key, iv) {
  const ivBytes = iv === undefined
    ? (() => { const u = new Uint8Array(12); globalThis.crypto.getRandomValues(u); return u; })()
    : (iv instanceof Uint8Array ? iv : new Uint8Array(iv));
  const ct = await ng25cSubtle().encrypt({ name: "AES-GCM", iv: ivBytes }, key, data);
  return ng25cConcat([ivBytes, new Uint8Array(ct)]).buffer;
}

export async function aesGcmDecrypt(data, key) {
  const u8 = new Uint8Array(data);
  if (u8.length < 12) throw new Error("Encrypted data is bad");
  if (u8.length === 12) return new ArrayBuffer(0);
  const pt = await ng25cSubtle().decrypt({ name: "AES-GCM", iv: u8.subarray(0, 12) }, key, u8.subarray(12));
  return pt;
}

const NG25_SCRYPT_PARAMS = { N: 32768, r: 8, p: 1, maxmem: 67108864 };

export async function deriveScryptKey(password, salt) {
  const pwd = new TextEncoder().encode(String(password).normalize("NFKC"));
  const st = new TextEncoder().encode(String(salt).normalize("NFKC"));
  const req = (typeof window !== "undefined" && window.require) || (typeof globalThis !== "undefined" && globalThis.require);
  if (req) {
    const nodeCrypto = req("crypto");
    return await new Promise((resolve, reject) => {
      nodeCrypto.scrypt(pwd, st, 32, NG25_SCRYPT_PARAMS, (err, key) => {
        if (err) reject(err);
        else resolve(key.buffer.slice(key.byteOffset, key.byteOffset + key.byteLength));
      });
    });
  }
  if (typeof window !== "undefined" && window.scrypt && window.scrypt.scrypt) {
    const out = await window.scrypt.scrypt(pwd, st, NG25_SCRYPT_PARAMS.N, NG25_SCRYPT_PARAMS.r, NG25_SCRYPT_PARAMS.p, 32);
    const u8 = out instanceof Uint8Array ? out : new Uint8Array(out);
    return u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength);
  }
  throw new TypeError("No scrypt implementation available");
}

async function ng25cHkdfBits(ikm, salt, info, bits) {
  const key = await ng25cSubtle().importKey("raw", ikm, "HKDF", false, ["deriveBits"]);
  const out = await ng25cSubtle().deriveBits(
    { name: "HKDF", hash: "SHA-256", salt, info },
    key, bits);
  return new Uint8Array(out);
}

async function ng25cHkdfKeyBytes(ikm, salt, info) {
  const bits = await ng25cHkdfBits(ikm, salt, info, 256);
  return bits.buffer.slice(bits.byteOffset, bits.byteOffset + bits.byteLength);
}

async function ng25cImportAesCbc(rawKey, usages) {
  return ng25cSubtle().importKey("raw", rawKey, { name: "AES-CBC" }, true, usages);
}

async function ng25cImportAesCbcExtractable(rawKey) {
  return ng25cSubtle().importKey("raw", rawKey, { name: "AES-CBC" }, true, ["encrypt"]);
}

export async function deriveKeyHash(keyBytes, salt, version) {
  if (version === 0) {
    return ng25cHex(await sha256(keyBytes));
  }
  if (version === 2 || version === 3) {
    const bits = await ng25cHkdfKeyBytes(keyBytes, utf8Bytes(salt || ""), utf8Bytes("ObsidianKeyHash"));
    const key = await ng25cImportAesCbcExtractable(bits);
    const raw = await ng25cSubtle().exportKey("raw", key);
    return ng25cHex(raw);
  }
  throw new Error("Encryption version not supported");
}

export async function deriveVaultSecrets(password, salt, version) {
  const key = await deriveScryptKey(password, salt);
  const keyhash = await deriveKeyHash(key, salt, version);
  return { key, keyhash };
}

export async function deriveVaultKeyhash(password, salt, version) {
  const key = await deriveScryptKey(password, salt);
  return deriveKeyHash(key, salt, version);
}

// ---- AES block primitive: AES-CBC with zero IV over one block yields AES-ECB.
async function ng25cAesBlock(key, block16) {
  const ct = await ng25cSubtle().encrypt({ name: "AES-CBC", iv: new Uint8Array(16) }, key, block16);
  return new Uint8Array(ct).subarray(0, 16);
}

function ng25cXor16(a, b) {
  const out = new Uint8Array(16);
  for (let i = 0; i < 16; i++) out[i] = a[i] ^ b[i];
  return out;
}

async function ng25cCbcCrypt(key, iv, data) {
  // data length multiple of 16; manual CBC so we control padding-free blocks.
  const out = new Uint8Array(data.length);
  let prev = iv;
  for (let o = 0; o < data.length; o += 16) {
    const block = ng25cXor16(new Uint8Array(data.subarray(o, o + 16)), prev);
    const enc = await ng25cAesBlock(key, block);
    out.set(enc, o);
    prev = enc;
  }
  return out;
}

export function defineBlock() {
  return class Block {
    constructor() { this.data = new Uint8Array(16); }
    dbl() {
      const msb = this.data[0] & 0x80;
      let carry = 0;
      for (let i = 15; i >= 0; i--) {
        const nc = this.data[i] >> 7;
        this.data[i] = ((this.data[i] << 1) & 0xff) | carry;
        carry = nc;
      }
      if (msb) this.data[15] ^= 0x87;
      return this;
    }
    static fromBytes(b) { const blk = new this(); blk.data.set(b.subarray(0, 16)); return blk; }
  };
}

const ng25cBlockProto = defineBlock();

function ng25cDouble(block16) {
  const b = ng25cBlockProto.fromBytes(block16);
  b.dbl();
  return b.data;
}

export function defineCmac() {
  return class Cmac {
    constructor(key) { this.key = key; this._k1 = null; this._k2 = null; this._done = false; }
    async _subkeys() {
      if (!this._k1) {
        const l = await ng25cAesBlock(this.key, new Uint8Array(16));
        this._k1 = ng25cDouble(l);
        this._k2 = ng25cDouble(this._k1);
      }
      return [this._k1, this._k2];
    }
    async mac(data) {
      const u8 = data instanceof Uint8Array ? data : new Uint8Array(data);
      const [k1, k2] = await this._subkeys();
      const n = u8.length % 16 === 0 ? u8.length / 16 : Math.ceil(u8.length / 16);
      const parts = [];
      for (let i = 0; i < n - 1; i++) parts.push(u8.subarray(i * 16, i * 16 + 16));
      const rem = u8.subarray((n - 1) * 16);
      let last;
      if (u8.length > 0 && u8.length % 16 === 0) {
        last = ng25cXor16(new Uint8Array(rem), k1);
      } else {
        const pad = new Uint8Array(16);
        pad.set(rem);
        pad[rem.length] = 0x80;
        last = ng25cXor16(pad, k2);
      }
      parts.push(last);
      const cbcIn = ng25cConcat(parts);
      const ct = await ng25cCbcCrypt(this.key, new Uint8Array(16), cbcIn);
      return ct.subarray(ct.length - 16);
    }
    finish() { this._done = true; }
    update() { if (this._done) throw new Error("Cannot update finished CMAC"); }
  };
}

export function defineCbcMacCipher() {
  return class CbcMacCipher {
    constructor(key) { this._cmac = new (defineCmac())(key); }
    async mac(data) { return this._cmac.mac(data); }
  };
}

export function defineCtrCipher() {
  return class CtrCipher {
    constructor(key) { this.key = key; }
    async crypt(counter16, data) {
      const u8 = data instanceof Uint8Array ? data : new Uint8Array(data);
      const out = new Uint8Array(u8.length);
      const ctr = new Uint8Array(counter16.subarray(0, 16));
      for (let o = 0; o < u8.length; o += 16) {
        const ks = await ng25cAesBlock(this.key, ctr);
        const n = Math.min(16, u8.length - o);
        for (let i = 0; i < n; i++) out[o + i] = u8[o + i] ^ ks[i];
        // increment 128-bit big-endian counter
        for (let i = 15; i >= 0; i--) { ctr[i] = (ctr[i] + 1) & 0xff; if (ctr[i] !== 0) break; }
      }
      return out;
    }
  };
}

function ng25cSivMask(tag) {
  const t = new Uint8Array(tag);
  const n = t.length;
  if (n >= 16) { t[n - 8] &= 0x7f; t[n - 4] &= 0x7f; }
  return t;
}

export function defineSiv() {
  const SivError = defineSivError();
  return class Siv {
    constructor(macKey, ctrKey) {
      this._cmac = new (defineCmac())(macKey);
      this._ctr = new (defineCtrCipher())(ctrKey);
    }
    async _s2v(plaintext) {
      // RFC 5297 S2V over the single vector element P (no associated data).
      const p = plaintext instanceof Uint8Array ? plaintext : new Uint8Array(plaintext);
      const d = new Uint8Array(await this._cmac.mac(new Uint8Array(16)));
      let t;
      if (p.length >= 16) {
        t = new Uint8Array(p);
        for (let i = 0; i < 16; i++) t[p.length - 16 + i] ^= d[i];
      } else {
        const dd = ng25cDouble(d);
        t = new Uint8Array(16);
        t.set(p);
        t[p.length] = 0x80;
        for (let i = 0; i < 16; i++) t[i] ^= dd[i];
      }
      return new Uint8Array(await this._cmac.mac(t));
    }
    async seal(plaintext) {
      const pt = plaintext instanceof Uint8Array ? plaintext : new Uint8Array(plaintext);
      const tag = ng25cSivMask(await this._s2v(pt));
      const ct = await this._ctr.crypt(tag, pt);
      return ng25cConcat([tag, ct]);
    }
    async open(data) {
      const u8 = data instanceof Uint8Array ? data : new Uint8Array(data);
      if (u8.length < 16) throw new SivError("AES-SIV: ciphertext is truncated");
      const tag = u8.subarray(0, 16);
      const ct = u8.subarray(16);
      const pt = new Uint8Array(await this._ctr.crypt(ng25cSivMask(tag), ct));
      const expected = ng25cSivMask(await this._s2v(pt));
      if (!constantTimeEqual(expected, ng25cSivMask(tag))) {
        pt.fill(0);
        throw new SivError("AES-SIV: ciphertext verification failure!");
      }
      return pt;
    }
  };
}

export function defineCipherV0() {
  return class CipherV0 {
    constructor(keyBytes, salt) {
      this.encryptionVersion = 0;
      this._salt = salt || "";
      this._ready = this._setup(keyBytes);
    }
    async _setup(keyBytes) {
      const kb = new Uint8Array(keyBytes);
      if (kb.length !== 32) throw new Error("Invalid encryption key");
      this.keyHash = ng25cHex(await sha256(kb.buffer.slice(kb.byteOffset, kb.byteOffset + kb.byteLength)));
      this.cryptoKey = await importAesGcmKey(kb.buffer.slice(kb.byteOffset, kb.byteOffset + kb.byteLength));
    }
    async encrypt(data) { await this._ready; return aesGcmEncrypt(data, this.cryptoKey); }
    async decrypt(data) { await this._ready; return aesGcmDecrypt(data, this.cryptoKey); }
    async deterministicEncodeStr(str) {
      await this._ready;
      const ivFull = new Uint8Array(await sha256(utf8Bytes(str)));
      const iv = ivFull.subarray(0, 12);
      const ct = await aesGcmEncrypt(utf8Bytes(str), this.cryptoKey, iv);
      return ng25cHex(ct);
    }
    async deterministicDecodeStr(hex) {
      await this._ready;
      const pt = await aesGcmDecrypt(ng25cUnhex(hex).buffer, this.cryptoKey);
      return utf8String(pt);
    }
  };
}

export function defineCipherV23() {
  return class CipherV23 {
    constructor(keyBytes, salt, version) {
      this.encryptionVersion = version;
      this._salt = salt || "";
      this._ready = this._setup(keyBytes, version);
    }
    async _setup(keyBytes, version) {
      if (version !== 2 && version !== 3) throw new Error("Encryption version not supported");
      const kb = new Uint8Array(keyBytes);
      if (kb.length !== 32) throw new Error("Invalid encryption key");
      const raw = kb.buffer.slice(kb.byteOffset, kb.byteOffset + kb.byteLength);
      this.keyHash = await deriveKeyHash(raw, this._salt, version);
      const saltBytes = utf8Bytes(this._salt);
      const emptySalt = new Uint8Array(0);
      const macBits = await ng25cHkdfKeyBytes(raw, saltBytes, utf8Bytes("ObsidianAesSivMac"));
      const encBits = await ng25cHkdfKeyBytes(raw, saltBytes, utf8Bytes("ObsidianAesSivEnc"));
      const gcmBits = await ng25cHkdfKeyBytes(raw, emptySalt, utf8Bytes("ObsidianAesGcm"));
      const macKey = await ng25cImportAesCbc(macBits, ["encrypt"]);
      const encKey = await ng25cImportAesCbc(encBits, ["encrypt"]);
      this.siv = new (defineSiv())(macKey, encKey);
      this.cryptoKey = await ng25cSubtle().importKey("raw", gcmBits, { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);
    }
    async encrypt(data) { await this._ready; return aesGcmEncrypt(data, this.cryptoKey); }
    async decrypt(data) { await this._ready; return aesGcmDecrypt(data, this.cryptoKey); }
    async deterministicEncodeStr(str) {
      await this._ready;
      const sealed = await this.siv.seal(utf8Bytes(str));
      return ng25cHex(sealed);
    }
    async deterministicDecodeStr(hex) {
      await this._ready;
      const opened = await this.siv.open(ng25cUnhex(hex));
      return utf8String(opened.buffer.slice(opened.byteOffset, opened.byteOffset + opened.byteLength));
    }
  };
}

export async function initCipher(version, keyBytes, salt) {
  if (version === 0) {
    const C = defineCipherV0();
    const c = new C(keyBytes, salt);
    await c._ready;
    return c;
  }
  if (version === 2 || version === 3) {
    const C = defineCipherV23();
    const c = new C(keyBytes, salt, version);
    await c._ready;
    return c;
  }
  throw new Error("Encryption version not supported");
}

export async function requestVaultAccess(vaultUid, password, salt, host, encryptionVersion) {
  const keyhash = await deriveVaultKeyhash(password, salt, encryptionVersion);
  return acctVaultAccess(account.token, vaultUid, keyhash, host, encryptionVersion);
}

export function parseCallbackUrl(url) {
  if (typeof url !== "string" || !url.startsWith("obsidian://")) return null;
  const rest = url.slice("obsidian://".length);
  // vault branch: obsidian://vault/<a>/<b>… (hash/query not parsed here)
  const pathPart = rest.split("#")[0].split("?")[0];
  const vm = /^vault\/([^/]+)(?:\/([\s\S]*))?$/.exec(pathPart);
  if (vm) {
    return { action: "open", vault: decodeURIComponent(vm[1]), file: vm[2] !== undefined ? decodeURIComponent(vm[2]) : "" };
  }
  let hash = "";
  let work = rest;
  const hi = work.indexOf("#");
  if (hi >= 0) { hash = work.slice(hi + 1); work = work.slice(0, hi); }
  const params = {};
  const qi = work.indexOf("?");
  let action = work;
  if (qi >= 0) {
    action = work.slice(0, qi);
    const query = work.slice(qi + 1);
    for (const pair of query.split("&")) {
      if (!pair) continue;
      const eq = pair.indexOf("=");
      const k = eq < 0 ? pair : pair.slice(0, eq);
      const v = eq < 0 ? "true" : pair.slice(eq + 1);
      try { params[decodeURIComponent(k)] = decodeURIComponent(v); }
      catch { params[k] = v; }
    }
  }
  action = action.replace(/\/+$/, "");
  if (hash) params.hash = hash;
  params.action = decodeURIComponent(action);
  return params;
}

export function renderFormattedDescription(containerEl, text) {
  const lines = String(text).split("\n");
  for (const line of lines) {
    const p = document.createElement("p");
    const re = /\*\*(.*?)\*\*/g;
    let last = 0, m;
    while ((m = re.exec(line))) {
      if (m.index > last) p.appendChild(document.createTextNode(line.slice(last, m.index)));
      const strong = document.createElement("strong");
      strong.textContent = m[1];
      p.appendChild(strong);
      last = m.index + m[0].length;
    }
    if (last < line.length) p.appendChild(document.createTextNode(line.slice(last)));
    containerEl.appendChild(p);
  }
}

export const SYNCABLE_FEATURE_TYPES = ["app", "appearance", "appearance-data", "hotkey", "core-plugin", "core-plugin-data"];
export const MEDIA_FEATURE_TYPES = ["image", "audio", "pdf", "video"];
