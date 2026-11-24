// Builds the Linux and macOS archives of Basalt from stock Electron zips, on any host (including Windows). No dependencies.
//   node build-unix.mjs [--version 0.3.9] [--targets linux-x64,mac-arm64,mac-x64] [--electron-dir DIR] [--bin-dir DIR]
//
// The Electron zips (electron-v<ELECTRON>-<platform>-<arch>.zip from github.com/electron/electron/releases) are looked for in
// --electron-dir, then dist/unix-cache, then %LOCALAPPDATA%\electron\Cache. Each one is checked against SHASUMS256.txt when that
// file lies beside it. The zips are read and the output written in memory, so symlinks (the macOS frameworks) and executable bits
// survive even on a Windows file system that cannot hold them.
// Per-OS helpers (basalt-pty, basalt-cli) are taken from <bin-dir>/<os>-<arch>/ (default dist/unix-bin); a target without them
// ships without them and the terminal card says so.
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

const root = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const opt = (n, d) => (args.includes(n) ? args[args.indexOf(n) + 1] : d);
const ELECTRON = "39.8.6";
const version = opt("--version", "0.3.9");
const targets = opt("--targets", "linux-x64,mac-arm64,mac-x64").split(",");
const binDir = path.resolve(opt("--bin-dir", path.join(root, "dist", "unix-bin")));
const searchDirs = [opt("--electron-dir"), path.join(root, "dist", "unix-cache"), path.join(process.env.LOCALAPPDATA || "", "electron", "Cache")].filter(Boolean);
const out = path.join(root, "dist");
fs.mkdirSync(out, { recursive: true });

// ---------------------------------------------------------------- zip reading (central directory, raw entries kept as they are)
function readZip(buf) {
  let e = buf.length - 22;
  while (e >= 0 && buf.readUInt32LE(e) !== 0x06054b50) e--;
  if (e < 0) throw new Error("not a zip");
  const count = buf.readUInt16LE(e + 10);
  let p = buf.readUInt32LE(e + 16);
  const entries = [];
  for (let i = 0; i < count; i++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) throw new Error("bad central directory");
    const made = buf.readUInt16LE(p + 4), method = buf.readUInt16LE(p + 10), crc = buf.readUInt32LE(p + 16);
    const csize = buf.readUInt32LE(p + 20), usize = buf.readUInt32LE(p + 24);
    const nlen = buf.readUInt16LE(p + 28), elen = buf.readUInt16LE(p + 30), clen = buf.readUInt16LE(p + 32);
    const eattr = buf.readUInt32LE(p + 38), lho = buf.readUInt32LE(p + 42);
    const name = buf.toString("utf8", p + 46, p + 46 + nlen);
    const unixMode = made >> 8 === 3 ? eattr >>> 16 : 0;
    const ln = buf.readUInt16LE(lho + 26), le = buf.readUInt16LE(lho + 28);
    const raw = buf.subarray(lho + 30 + ln + le, lho + 30 + ln + le + csize);
    const dir = name.endsWith("/");
    const type = unixMode & 0o170000;
    entries.push({ name: dir ? name.slice(0, -1) : name, dir, link: type === 0o120000, mode: (unixMode & 0o7777) || (dir ? 0o755 : 0o644), method, crc, usize, raw, data: null });
    p += 46 + nlen + elen + clen;
  }
  return entries;
}
const dataOf = (en) => {
  if (!en.data) en.data = en.method === 0 ? Buffer.from(en.raw) : zlib.inflateRawSync(en.raw);
  if (en.data.length !== en.usize && !en.edited) throw new Error("size mismatch in " + en.name);
  return en.data;
};
const setData = (en, data) => { en.data = Buffer.from(data); en.usize = en.data.length; en.crc = zlib.crc32(en.data); en.raw = null; en.edited = true; };

// ---------------------------------------------------------------- zip writing
function writeZip(entries) {
  const parts = [], central = [];
  let off = 0;
  const date = new Date(), dosTime = (date.getHours() << 11) | (date.getMinutes() << 5) | (date.getSeconds() >> 1);
  const dosDate = ((date.getFullYear() - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate();
  for (const en of entries) {
    const name = Buffer.from(en.dir ? en.name + "/" : en.name, "utf8");
    let method = 0, crc = 0, usize = 0, body = Buffer.alloc(0);
    if (!en.dir) {
      if (en.raw && !en.edited) { method = en.method; crc = en.crc; usize = en.usize; body = en.raw; }
      else {
        const d = dataOf(en); usize = d.length; crc = zlib.crc32(d);
        const z = en.link || d.length < 64 ? null : zlib.deflateRawSync(d, { level: 9 });
        if (z && z.length < d.length) { method = 8; body = z; } else body = d;
      }
    }
    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(20, 4); lh.writeUInt16LE(0x0800, 6); lh.writeUInt16LE(method, 8);
    lh.writeUInt16LE(dosTime, 10); lh.writeUInt16LE(dosDate, 12); lh.writeUInt32LE(crc, 14); lh.writeUInt32LE(body.length, 18);
    lh.writeUInt32LE(usize, 22); lh.writeUInt16LE(name.length, 26);
    const ch = Buffer.alloc(46);
    ch.writeUInt32LE(0x02014b50, 0); ch.writeUInt16LE((3 << 8) | 20, 4); ch.writeUInt16LE(20, 6); ch.writeUInt16LE(0x0800, 8); ch.writeUInt16LE(method, 10);
    ch.writeUInt16LE(dosTime, 12); ch.writeUInt16LE(dosDate, 14); ch.writeUInt32LE(crc, 16); ch.writeUInt32LE(body.length, 20); ch.writeUInt32LE(usize, 24);
    ch.writeUInt16LE(name.length, 28);
    const mode = (en.dir ? 0o040000 : en.link ? 0o120000 : 0o100000) | en.mode;
    ch.writeUInt32LE((((mode << 16) | (en.dir ? 0x10 : 0)) >>> 0), 38); ch.writeUInt32LE(off, 42);
    parts.push(lh, name, body); central.push(ch, name);
    off += 30 + name.length + body.length;
  }
  const cd = Buffer.concat(central), end = Buffer.alloc(22);
  if (entries.length > 0xffff || off + cd.length > 0xffffffff) throw new Error("archive too large for plain zip");
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(entries.length, 8); end.writeUInt16LE(entries.length, 10); end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(off, 16);
  return Buffer.concat([...parts, cd, end]);
}

// ---------------------------------------------------------------- tar writing (ustar; long names use the prefix field)
function writeTarGz(entries) {
  const parts = [], mtime = Math.floor(Date.now() / 1000);
  const field = (b, v, o, n) => b.write(v, o, n, "utf8");
  const oct = (b, v, o, n) => b.write(v.toString(8).padStart(n - 1, "0") + "\0", o, n, "latin1");
  for (const en of entries) {
    const full = en.dir ? en.name + "/" : en.name;
    let name = full, prefix = "";
    if (Buffer.byteLength(full) > 100) {
      const cut = full.lastIndexOf("/", 155 + 1);
      let at = -1;
      for (let i = full.length - 1; i > 0; i--) if (full[i] === "/" && i <= 155 && Buffer.byteLength(full) - i - 1 <= 100) { at = i; break; }
      if (at < 0) throw new Error("path too long for tar: " + full + cut);
      prefix = full.slice(0, at); name = full.slice(at + 1);
    }
    const body = en.dir || en.link ? Buffer.alloc(0) : dataOf(en);
    const h = Buffer.alloc(512);
    field(h, name, 0, 100); oct(h, en.mode, 100, 8); oct(h, 0, 108, 8); oct(h, 0, 116, 8); oct(h, body.length, 124, 12); oct(h, mtime, 136, 12);
    h.write("        ", 148, 8, "latin1");
    h[156] = en.dir ? 53 : en.link ? 50 : 48;
    if (en.link) { const t = dataOf(en).toString("utf8"); if (Buffer.byteLength(t) > 100) throw new Error("link target too long: " + t); field(h, t, 157, 100); }
    h.write("ustar\0" + "00", 257, 8, "latin1"); field(h, "root", 265, 32); field(h, "root", 297, 32); field(h, prefix, 345, 155);
    let sum = 0; for (const x of h) sum += x;
    h.write(sum.toString(8).padStart(6, "0") + "\0 ", 148, 8, "latin1");
    parts.push(h, body, Buffer.alloc((512 - (body.length % 512)) % 512));
  }
  parts.push(Buffer.alloc(1024));
  return zlib.gzipSync(Buffer.concat(parts), { level: 9 });
}

// ---------------------------------------------------------------- the app files
const NOT_SHIPPED = /[\\/](btime|get-fonts)([\\/]|$)/i; // Windows .node binaries written by the Obsidian authors: never shipped
function walk(dir, rel, accept, list = []) {
  for (const d of fs.readdirSync(dir, { withFileTypes: true })) {
    const abs = path.join(dir, d.name), r = rel + "/" + d.name;
    if (!accept(abs)) continue;
    if (d.isDirectory()) { list.push({ name: r, dir: true, mode: 0o755 }); walk(abs, r, accept, list); }
    else list.push({ name: r, dir: false, mode: 0o644, data: fs.readFileSync(abs) });
  }
  return list;
}
const mk = (l) => ({ link: false, method: 0, raw: null, edited: true, crc: l.dir ? 0 : zlib.crc32(l.data), usize: l.dir ? 0 : l.data.length, ...l });
function appFiles(resRel, helpers) {
  const list = [{ name: resRel + "/app", dir: true, mode: 0o755 }, { name: resRel + "/app-src", dir: true, mode: 0o755 }];
  walk(path.join(root, "stub"), resRel + "/app", (p) => !NOT_SHIPPED.test(p), list);
  walk(path.join(root, "src"), resRel + "/app-src", (p) => !/\.orig$/.test(p) && !/[\\/]bin[\\/][^\\/]+\.exe$/i.test(p), list);
  if (helpers && fs.existsSync(helpers)) {
    if (!list.some((x) => x.name === resRel + "/app-src/bin")) list.push({ name: resRel + "/app-src/bin", dir: true, mode: 0o755 });
    for (const f of fs.readdirSync(helpers)) list.push({ name: `${resRel}/app-src/bin/${f}`, dir: false, mode: 0o755, data: fs.readFileSync(path.join(helpers, f)) });
  }
  return list.map(mk);
}

// ---------------------------------------------------------------- Electron zips
function findZip(platform, arch) {
  const file = `electron-v${ELECTRON}-${platform}-${arch}.zip`;
  for (const d of searchDirs) {
    const f = path.join(d, file);
    if (fs.existsSync(f)) return f;
    // the cache of @electron/get keeps each zip in a folder named after a hash
    if (fs.existsSync(d)) for (const sub of fs.readdirSync(d, { withFileTypes: true })) if (sub.isDirectory() && fs.existsSync(path.join(d, sub.name, file))) return path.join(d, sub.name, file);
  }
  throw new Error(`${file} not found in: ${searchDirs.join(", ")}. Download it from https://github.com/electron/electron/releases/tag/v${ELECTRON}`);
}
function loadZip(platform, arch) {
  const f = findZip(platform, arch), buf = fs.readFileSync(f), sha = crypto.createHash("sha256").update(buf).digest("hex");
  const sums = path.join(path.dirname(f), "SHASUMS256.txt");
  const name = path.basename(f);
  if (fs.existsSync(sums)) {
    const line = fs.readFileSync(sums, "utf8").split(/\r?\n/).find((l) => l.trim().endsWith("*" + name) || l.trim().endsWith(" " + name));
    if (!line) console.warn(`  (no ${name} line in SHASUMS256.txt)`);
    else if (line.split(/\s+/)[0] !== sha) throw new Error(`sha256 of ${f} does not match SHASUMS256.txt`);
    else console.log(`  sha256 ok  ${name}`);
  } else console.warn(`  (no SHASUMS256.txt beside ${name}: sha256 ${sha} not verified)`);
  return readZip(buf);
}

const readme = (os) => `Basalt ${version} (${os}, unsigned build)\n\nThis build was made by build-unix.mjs from stock Electron ${ELECTRON}. See docs/BUILD-UNIX.md in the repository.\n`;

// ---------------------------------------------------------------- Linux
function buildLinux(arch) {
  const dirName = `basalt-linux-${arch}`;
  const files = loadZip("linux", arch);
  const keep = [];
  for (const en of files) {
    if (en.name === "resources/default_app.asar") continue;
    const e2 = { ...en, name: `${dirName}/${en.name === "electron" ? "basalt" : en.name}` };
    keep.push(e2);
  }
  keep.unshift(mk({ name: dirName, dir: true, mode: 0o755 }));
  const res = `${dirName}/resources`;
  keep.push(...appFiles(res, path.join(binDir, `linux-${arch}`)).map((e) => ({ ...e, name: e.name.replace(res, res) })));
  const add = (name, text, mode = 0o644) => keep.push(mk({ name: `${dirName}/${name}`, dir: false, mode, data: Buffer.from(text.replace(/\r\n/g, "\n")) }));
  keep.push(mk({ name: `${dirName}/icon.png`, dir: false, mode: 0o644, data: fs.readFileSync(path.join(root, "branding", "icon.png")) }));
  add("basalt.sh", `#!/bin/sh
# Starts Basalt. Chromium needs its sandbox: either chrome-sandbox owned by root with mode 4755, or user namespaces.
# When neither is available this falls back to --no-sandbox (and says so) instead of refusing to start.
here="$(cd "$(dirname "$(readlink -f "$0")")" && pwd)"
sb="$here/chrome-sandbox"
if [ -u "$sb" ] && [ "$(stat -c %u "$sb" 2>/dev/null)" = 0 ]; then :
elif unshare -U true >/dev/null 2>&1; then :
else
  echo "basalt: no usable sandbox (chrome-sandbox is not setuid root and user namespaces are off); starting with --no-sandbox" >&2
  set -- --no-sandbox "$@"
fi
exec "$here/basalt" "$@"
`, 0o755);
  add("install-desktop.sh", `#!/bin/sh
# Adds Basalt to the application menu of the current user and links \`basalt\` into ~/.local/bin.
here="$(cd "$(dirname "$(readlink -f "$0")")" && pwd)"
mkdir -p "$HOME/.local/share/applications" "$HOME/.local/bin"
sed -e "s|@DIR@|$here|g" "$here/basalt.desktop" > "$HOME/.local/share/applications/basalt.desktop"
ln -sf "$here/basalt.sh" "$HOME/.local/bin/basalt"
echo "Installed: $HOME/.local/share/applications/basalt.desktop and $HOME/.local/bin/basalt"
`, 0o755);
  add("basalt.desktop", `[Desktop Entry]
Type=Application
Name=Basalt
Comment=Notes, boards and graphs on plain files
Exec=@DIR@/basalt.sh %U
Icon=@DIR@/icon.png
Terminal=false
Categories=Office;Utility;TextEditor;
MimeType=x-scheme-handler/basalt;
StartupWMClass=Basalt
`);
  add("README.txt", readme("Linux x64") + `\nRun ./basalt.sh. Run ./install-desktop.sh to add a menu entry.\nIf the window does not appear and the log mentions the sandbox: sudo chown root chrome-sandbox && sudo chmod 4755 chrome-sandbox\n${fs.existsSync(path.join(binDir, "linux-" + arch, "basalt-pty")) ? "" : "This build has no terminal helper (basalt-pty): the terminal card shows a message.\n"}`);
  const file = path.join(out, `Basalt-${version}-linux-${arch}.tar.gz`);
  fs.writeFileSync(file, writeTarGz(keep));
  return file;
}

// ---------------------------------------------------------------- macOS
const icns = (png) => { // one 'ic09' (512x512 PNG) chunk is a valid icns
  const body = Buffer.alloc(8); body.write("ic09", 0, "latin1"); body.writeUInt32BE(png.length + 8, 4);
  const head = Buffer.alloc(8); head.write("icns", 0, "latin1"); head.writeUInt32BE(8 + png.length + 8, 4);
  return Buffer.concat([head, body, png]);
};
function patchPlist(xml, main) {
  let s = xml.replace(/<key>ElectronAsarIntegrity<\/key>\s*<dict>[\s\S]*?<\/dict>\s*<\/dict>/, "") // we ship no default_app.asar
    .replace(/<string>Electron<\/string>/g, "<string>Basalt</string>")
    .replace(/Electron Helper/g, "Basalt Helper")
    .replace(/com\.github\.Electron/g, "com.falcontech.basalt")
    .replace(/electron\.icns/g, "basalt.icns");
  if (main) {
    s = s.replace(/(<key>CFBundleShortVersionString<\/key>\s*<string>)[^<]*/, `$1${version}`).replace(/(<key>CFBundleVersion<\/key>\s*<string>)[^<]*/, `$1${version}`)
      .replace(/(<key>LSApplicationCategoryType<\/key>\s*<string>)[^<]*/, "$1public.app-category.productivity");
  }
  return s;
}
function buildMac(arch) {
  const files = loadZip("darwin", arch), A = "Basalt.app", res = `${A}/Contents/Resources`;
  const keep = [];
  for (const en of files) {
    if (!en.name.startsWith("Electron.app")) { keep.push(en); continue; } // LICENSE, LICENSES.chromium.html, version
    let name = en.name.replace(/^Electron\.app/, A);
    name = name.replace("Contents/MacOS/Electron", "Contents/MacOS/Basalt").replace(/Electron Helper/g, "Basalt Helper");
    if (name === `${res}/default_app.asar` || name === `${res}/electron.icns`) continue;
    const e2 = { ...en, name };
    if (/\.app\/Contents\/Info\.plist$/.test(name)) setData(e2, patchPlist(dataOf(en).toString("utf8"), name === `${A}/Contents/Info.plist`));
    keep.push(e2);
  }
  for (const need of [`${A}/Contents/MacOS/Basalt`, `${A}/Contents/Frameworks/Basalt Helper.app/Contents/MacOS/Basalt Helper`]) if (!keep.some((e) => e.name === need)) throw new Error("expected entry missing: " + need);
  keep.push(mk({ name: `${res}/basalt.icns`, dir: false, mode: 0o644, data: icns(fs.readFileSync(path.join(root, "branding", "icon.png"))) }));
  keep.push(...appFiles(res, path.join(binDir, `mac-${arch}`)));
  keep.push(mk({ name: "README.txt", dir: false, mode: 0o644, data: Buffer.from(readme(`macOS ${arch}`) + `\nUnsigned and not notarized. After unzipping, move Basalt.app to Applications, then either right-click it, choose Open, and confirm,\nor run: xattr -cr /Applications/Basalt.app\nIf macOS still reports a damaged app: codesign --force --deep --sign - /Applications/Basalt.app\nThis build has no terminal helper: the terminal card shows a message.\n`) }));
  const file = path.join(out, `Basalt-${version}-mac-${arch}.zip`);
  fs.writeFileSync(file, writeZip(keep));
  return file;
}

for (const t of targets) {
  const [os, arch] = t.split("-");
  console.log(t);
  const f = os === "linux" ? buildLinux(arch) : os === "mac" ? buildMac(arch) : (() => { throw new Error("unknown target " + t); })();
  const buf = fs.readFileSync(f);
  console.log(`  ${f}  ${(buf.length / 1048576).toFixed(1)} MB  sha256 ${crypto.createHash("sha256").update(buf).digest("hex")}`);
}
