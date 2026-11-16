import fs from "node:fs";
const src = fs.readFileSync("tools/s36-kte.js", "utf8");
const m = src.match(/base64,([A-Za-z0-9+/=]+)/);
const png = Buffer.from(m[1], "base64");
fs.writeFileSync("tools/s36-logo-full.png", png);
console.log("png bytes", png.length, png.slice(0, 8).toString("hex"));
const disk = fs.readFileSync("src/basalt-logo.png");
console.log("disk bytes", disk.length, disk.slice(0, 8).toString("hex"));
console.log("identical:", disk.equals(png));
// also extract wireframe path
const pm = src.match(/<path d="([^"]+)"\/>/);
fs.writeFileSync("tools/s36-wireframe.txt", pm[1]);
console.log("path len", pm[1].length, pm[1].slice(0, 120));
