'use strict';
// Basalt main process: windows, the vault registry, the app:// protocol, the channels the interface talks to,
// menus, links, and the command line pipe. The launcher (stub/main.js) calls the exported function with the resources
// folder and an emitter for state the launcher cares about.

const path = require('path');
const fs = require('fs');
const os = require('os');
const net = require('net');
const crypto = require('crypto');
const { Readable } = require('stream');
const electron = require('electron');
const { app, BrowserWindow, Menu, ipcMain, dialog, shell, protocol, session, screen, clipboard } = electron;

const WIN = process.platform === 'win32';
const MAC = process.platform === 'darwin';
const SCHEME = 'app';
const APP_HOST = SCHEME + '://obsidian.md/'; // the interface addresses its own files with this host
const INDEX_URL = APP_HOST + 'index.html';
const DEFAULT_ADBLOCK = ['https://easylist.to/easylist/easylist.txt', 'https://easylist.to/easylist/easyprivacy.txt'];
const ALLOWED_PERMISSIONS = ['clipboard-read', 'clipboard-sanitized-write'];
const EXECUTABLE_EXT = WIN ? ['.exe', '.bat', '.cmd', '.ps1', '.com', '.msi', '.vbs', '.js', '.jse', '.wsf', '.wsh'] : ['.sh', '.command', '.csh', '.ksh', '.bash', '.zsh', '.fish', '.desktop', '.action', '.workflow'];

// plain recursive copy (fs.cpSync is avoided: it has crashed on some non-Latin paths)
const copyTree = (from, to) => {
	fs.mkdirSync(to, { recursive: true });
	for (const e of fs.readdirSync(from, { withFileTypes: true })) {
		if (e.isDirectory()) copyTree(path.join(from, e.name), path.join(to, e.name));
		else fs.copyFileSync(path.join(from, e.name), path.join(to, e.name));
	}
};
const short = (s, n) => (s.length <= n ? s : s.slice(0, n - 1).trim() + '…');
const attempt = (fn, fallback) => {
	try { return fn(); } catch (e) {
		console.log('Ignored:', String(e));
			try { fs.appendFileSync(path.join(app.getPath('userData'), 'basalt.log'), new Date().toISOString() + ' ignored: ' + String(e && e.stack || e).split(/\r?\n/).slice(0, 3).join(' | ') + os.EOL); } catch (e2) { /* no log */ }
		return fallback;
	}
};
const randomId = (n, hex) => { let out = ''; const chars = hex ? '0123456789abcdef' : 'abcdefghijklmnopqrstuvwxyz0123456789'; const bytes = crypto.randomBytes(n); for (let i = 0; i < n; i++) out += chars[bytes[i] % chars.length]; return out; };


// ---------- request filter: EasyList style network rules (the web viewer's ad blocking) ----------
const TYPE_NAMES = { mainFrame: 'document', subFrame: 'subdocument', stylesheet: 'stylesheet', script: 'script', image: 'image', font: 'font', object: 'object', xhr: 'xmlhttprequest', ping: 'ping', media: 'media', webSocket: 'websocket', cspReport: 'other', other: 'other' };
const hostOf = (u) => { try { return new URL(u).hostname.toLowerCase(); } catch (e) { return ''; } };
const baseDomain = (h) => h.split('.').slice(-2).join('.');
class Blocker {
	constructor() { this.byHost = new Map(); this.byToken = new Map(); this.loose = []; this.allowByHost = new Map(); this.allowByToken = new Map(); this.allowLoose = []; this.count = 0; }
	addList(text) { for (const line of text.split('\n')) this.addRule(line.trim()); }
	addRule(line) {
		if (!line || line.length <= 3 || line[0] === '!' || line[0] === '[' || line.includes('##') || line.includes('#@#') || line.includes('#?#') || line.includes('#$#')) return;
		let allow = false;
		if (line.startsWith('@@')) { allow = true; line = line.slice(2); }
		const rule = { types: null, notTypes: null, third: null, domains: null, notDomains: null, re: null };
		const dollar = line.lastIndexOf('$');
		if (dollar > 0 && !line.slice(dollar).includes('/')) {
			for (const opt of line.slice(dollar + 1).split(',')) {
				const o = opt.trim().toLowerCase(), neg = o.startsWith('~'), name = neg ? o.slice(1) : o;
				if (name === 'third-party') rule.third = !neg;
				else if (name.startsWith('domain=')) { rule.domains = []; rule.notDomains = []; for (const d of name.slice(7).split('|')) (d.startsWith('~') ? rule.notDomains : rule.domains).push(d.replace(/^~/, '')); }
				else if (Object.values(TYPE_NAMES).includes(name)) (neg ? (rule.notTypes = rule.notTypes || []) : (rule.types = rule.types || [])).push(name);
				else if (['match-case', 'important', 'popup', 'badfilter', 'csp', 'redirect', 'removeparam', 'redirect-rule', 'rewrite', 'genericblock', 'generichide', 'elemhide', 'specifichide'].some((x) => name.startsWith(x))) { if (!name.startsWith('important') && !name.startsWith('match-case')) return; }
			}
			line = line.slice(0, dollar);
		}
		if (line.length < 2) return;
		let pattern = line, hostKey = null;
		if (pattern.startsWith('||')) { pattern = pattern.slice(2); const m = pattern.match(/^[a-z0-9.-]+/i); if (m) hostKey = m[0].toLowerCase().replace(/^\.|\.$/g, ''); }
		const rx = pattern.replace(/[.+?${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\^/g, '(?:[^\\w%.-]|$)');
		const src = line.startsWith('||') ? '^[a-z-]+:\\/\\/(?:[^/]+\\.)?' + rx : (line.startsWith('|') ? '^' + rx.slice(rx.startsWith('\\|') ? 2 : 1) : rx);
		try { rule.re = new RegExp(line.endsWith('|') && !line.endsWith('\\|') ? src.replace(/\\\|$|\|$/, '') + '$' : src, 'i'); } catch (e) { return; }
		this.count++;
		const hosts = allow ? this.allowByHost : this.byHost, tokens = allow ? this.allowByToken : this.byToken, loose = allow ? this.allowLoose : this.loose;
		if (hostKey && hostKey.includes('.')) { const k = baseDomain(hostKey); (hosts.get(k) || hosts.set(k, []).get(k)).push(rule); return; }
		const tok = (pattern.toLowerCase().match(/[a-z0-9%]{3,}/g) || []).sort((a, b) => b.length - a.length)[0];
		if (tok) (tokens.get(tok) || tokens.set(tok, []).get(tok)).push(rule); else loose.push(rule);
	}
	static ruleHits(rule, url, type, pageHost, reqHost) {
		if (rule.types && !rule.types.includes(type)) return false;
		if (rule.notTypes && rule.notTypes.includes(type)) return false;
		if (rule.third !== null && pageHost) { const third = baseDomain(reqHost) !== baseDomain(pageHost); if (third !== rule.third) return false; }
		if (rule.domains && rule.domains.length && !rule.domains.some((d) => pageHost === d || pageHost.endsWith('.' + d))) return false;
		if (rule.notDomains && rule.notDomains.some((d) => pageHost === d || pageHost.endsWith('.' + d))) return false;
		return rule.re.test(url);
	}
	match(hosts, tokens, loose, url, type, pageHost, reqHost) {
		for (let h = reqHost; h; ) { const list = hosts.get(baseDomain(h)); if (list) { for (const r of list) if (Blocker.ruleHits(r, url, type, pageHost, reqHost)) return true; break; } const i = h.indexOf('.'); if (i < 0) break; h = h.slice(i + 1); }
		const seen = new Set();
		for (const t of url.toLowerCase().match(/[a-z0-9%]{3,}/g) || []) { if (seen.has(t)) continue; seen.add(t); const list = tokens.get(t); if (list) for (const r of list) if (Blocker.ruleHits(r, url, type, pageHost, reqHost)) return true; }
		for (const r of loose) if (Blocker.ruleHits(r, url, type, pageHost, reqHost)) return true;
		return false;
	}
	blocks(details) {
		const url = details.url, reqHost = hostOf(url), type = TYPE_NAMES[details.resourceType] || 'other';
		const page = details.referrer || (details.webContents && attempt(() => details.webContents.getURL(), '')) || '', pageHost = hostOf(page);
		if (!this.match(this.byHost, this.byToken, this.loose, url, type, pageHost, reqHost)) return false;
		return !this.match(this.allowByHost, this.allowByToken, this.allowLoose, url, type, pageHost, reqHost);
	}
}

module.exports = function start(resources, events) {
	if (parseInt(process.versions.electron.split('.')[0], 10) < 18) {
		dialog.showErrorBox('Unsupported runtime', 'This version of Basalt needs a newer Electron runtime.');
		app.quit();
		return;
	}
	app.commandLine.appendSwitch('log-level', '3');
	const features = ['SharedArrayBuffer'];
	for (const a of process.argv) if (a.startsWith('--enable-features=')) features.push(...a.slice(18).split(',').map((x) => x.trim()));
	app.commandLine.appendSwitch('enable-features', features.join(','));

	// ---------- one instance; a second start hands its arguments over ----------
	const cliArgs = (argv) => { const a = argv.slice(); const exe = a.shift(); const keep = a.filter((x) => !x.startsWith('--') || ['--copy', '--help', '--json', '--md', '--tsv', '--csv'].includes(x)); if (path.basename(exe || '').toLowerCase().includes('electron')) keep.shift(); return keep; };
	const pipeName = WIN ? `\\\\.\\pipe\\basalt-cli-${os.userInfo().username}` : path.join((!MAC && process.env.XDG_RUNTIME_DIR) || os.homedir(), '.basalt-cli.sock');
	if (!app.requestSingleInstanceLock()) {
		const args = cliArgs(process.argv);
		if (WIN && args[0] && args[0].startsWith('session=')) { process.exit(0); return; } // the running Basalt serves this one
		if (MAC) app.dock.hide();
		events.emit('disable', true); events.emit('silence', true);
		process.removeAllListeners('uncaughtException');
		process.on('uncaughtException', (e) => { console.error('Uncaught Exception', e); process.exit(1); });
		const tty = !!process.stdin.isTTY && !!process.stdout.isTTY;
		if (!args.length && tty) { // no command: the interactive shell of basalt-cli
			const cli = path.join(resources, 'bin', WIN ? 'basalt-cli.exe' : 'basalt-cli');
			if (fs.existsSync(cli)) { require('child_process').spawn(cli, [], { stdio: 'inherit' }).on('exit', (c) => process.exit(c || 0)); return; }
		}
		const conn = net.createConnection(pipeName);
		conn.setNoDelay(true);
		conn.once('error', () => { console.error('Unable to connect to the running Basalt'); process.exit(1); });
		conn.once('connect', () => { conn.write(JSON.stringify({ argv: args, tty, cwd: process.cwd() }) + '\n'); conn.pipe(process.stdout); conn.on('end', () => process.exit(0)); });
		return;
	}

	// ---------- folders and settings ----------
	const data = app.getPath('userData');
	const safePath = (name, alt) => attempt(() => app.getPath(name), null) || attempt(() => { const p = path.join(app.getPath('home'), alt); return fs.existsSync(p) ? p : null; }, null) || data;
	const documentsDir = safePath('documents', 'Documents');
	const desktopDir = safePath('desktop', 'Desktop');
	const defaultVaultPath = path.join(documentsDir, 'Basalt Vault');
	const sandboxVaultPath = path.join(data, 'Basalt Sandbox');
	const fileBase = SCHEME + '://' + randomId(36) + '/'; // an address only our own pages know: file access goes through it
	const version = attempt(() => JSON.parse(fs.readFileSync(path.join(resources, 'package.json'), 'utf8')).version, null) || app.getVersion();

	const jsonFile = (name) => path.join(data, name + '.json');
	const readJson = (name) => attempt(() => JSON.parse(fs.readFileSync(jsonFile(name), 'utf8')) || null, null);
	const writeJson = (name, value) => attempt(() => fs.writeFileSync(jsonFile(name), JSON.stringify(value)));
	let config = readJson('basalt') || readJson('obsidian') || {};
	if (typeof config !== 'object') config = {};
	const save = () => writeJson('basalt', config);
	const vaults = config.vaults || {};
	config.vaults = vaults;

	const forgetPartition = (id) => fs.promises.rm(path.join(data, 'Partitions', `vault-${id}`), { recursive: true, force: true }).catch(() => {});
	for (const id of Object.keys(vaults)) {
		const v = vaults[id];
		v.path = path.resolve(v.path);
		if (!v.path || !fs.existsSync(v.path)) { delete vaults[id]; attempt(() => fs.unlinkSync(jsonFile(id))); }
	}
	fs.promises.readdir(path.join(data, 'Partitions')).then((list) => { for (const p of list) { const id = p.replace(/^vault-/, ''); if (!vaults[id]) forgetPartition(id); } }, () => {});

	if (config.insider) events.emit('insider', true);
	if (config.updateDisabled) events.emit('disable', true);
	if (config.disableGpu && !app.isReady()) attempt(() => app.disableHardwareAcceleration());
	const nativeFrame = config.frame === 'native';
	const titleBarStyle = nativeFrame ? 'default' : 'hidden';
	let iconPath = config.icon && fs.existsSync(path.join(data, config.icon)) ? path.join(data, config.icon) : undefined;

	// ---------- state ----------
	const windows = {}; // vault id -> window
	const parents = new WeakMap(); // popup window -> its main window
	let quitting = false;
	let contextMenuSender = null;
	let starterWindow = null;
	let helpWindow = null;
	let pendingUrl = null;

	const vaultByPath = (p) => { const r = path.resolve(p); let best = null; for (const id in vaults) { const v = path.resolve(vaults[id].path); if (r === v || r.startsWith(v + path.sep)) { if (!best || v.length > path.resolve(vaults[best].path).length) best = id; } } return best; };
	const vaultByName = (name) => { for (const id in vaults) if (id === name || path.basename(vaults[id].path).toUpperCase() === name.toUpperCase()) return id; return null; };
	const lastFocusedVault = () => { let best = null, id = null; for (const k in windows) { const w = windows[k]; if (!w.isDestroyed() && (!best || (w.focusTime || 0) > (best.focusTime || 0))) { best = w; id = k; } } return id; };
	const isUnc = (p) => typeof p === 'string' && /^[\\/]{2,}[^\\/]+[\\/]+[^\\/]+/.test(p);
	const setIcon = (win) => { if (iconPath && !MAC) attempt(() => win.setIcon(iconPath)); };
	const enableRemote = (wc) => { if (electron.remote) attempt(() => electron.remote.enable(wc)); };

	// ---------- menus ----------
	const defaultTemplate = () => [
		{ label: '&Edit', submenu: [{ role: 'undo' }, { role: 'redo' }, { type: 'separator' }, { role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { role: 'selectAll' }] },
		{ label: '&View', submenu: [{ role: 'resetZoom' }, { role: 'zoomIn' }, { role: 'zoomOut' }, { type: 'separator' }, { role: 'toggleDevTools' }, { role: 'togglefullscreen' }] },
		{ label: '&Window', role: 'window', submenu: [{ role: 'minimize' }, { role: 'close' }] },
	];
	const commandOnly = (item) => !item.triggeredByAccelerator || (!item.shiftKey && !item.ctrlKey && !item.metaKey && !item.altKey);
	function buildMenu(template) {
		// "Window" and "Help" menus stay as the interface gave them; commands run in the window the menu belongs to
		const wire = (items) => items.forEach((it) => {
			if (it.appCommand) {
				const id = it.appCommand;
				it.id = id;
				it.click = (menuItem, win, ev) => { if (win instanceof BrowserWindow && commandOnly(ev)) win.webContents.executeJavaScript(`app.commands.executeCommandById(${JSON.stringify(id)})`); };
				delete it.appCommand;
			}
			if (it.submenu) wire(it.submenu);
		});
		const merged = [];
		for (const top of template) {
			const same = merged.find((m) => (m.id && m.id === top.id) || m.label === top.label);
			if (!same) { merged.push(top); continue; }
			for (const sub of top.submenu || []) {
				const at = sub.before && same.submenu.findIndex((x) => x.id === sub.before[0]);
				if (at != null && at >= 0) same.submenu.splice(at, 0, sub); else same.submenu.push(sub);
			}
		}
		wire(merged);
		return Menu.buildFromTemplate(merged);
	}
	const fallbackMenu = buildMenu(defaultTemplate());
	const menuOf = (win) => { if (!win) return fallbackMenu; while (!win.appMenu && parents.has(win)) win = parents.get(win); return win.appMenu || fallbackMenu; };
	const applyMenu = () => { const w = BrowserWindow.getFocusedWindow(); if (w && MAC) Menu.setApplicationMenu(menuOf(w)); };
	const setMenuItem = (menu, id, props) => { const it = menu.getMenuItemById(id); if (it) for (const k in props) it[k] = props[k]; };

	function contextMenu(win, wc, p) {
		const flags = p.editFlags, sel = p.selectionText.trim(), has = sel.length > 0, editable = p.isEditable;
		let tpl = [
			{ accelerator: 'CmdOrCtrl+X', label: 'Cut', role: has && flags.canCut ? 'cut' : undefined, enabled: has && flags.canCut, visible: editable },
			{ accelerator: 'CmdOrCtrl+C', label: 'Copy', role: has && flags.canCopy ? 'copy' : undefined, enabled: has && flags.canCopy, visible: editable || has },
			{ accelerator: 'CmdOrCtrl+V', label: 'Paste', role: flags.canPaste ? 'paste' : undefined, enabled: flags.canPaste, visible: editable },
			{ accelerator: 'CmdOrCtrl+Shift+V', label: 'Paste as text', role: flags.canPaste ? 'pasteAndMatchStyle' : undefined, enabled: flags.canPaste, visible: editable },
		];
		let show = editable || has;
		if (p.misspelledWord) {
			const sug = (p.dictionarySuggestions || []).slice(0, 5).map((w) => ({ label: w, click: () => wc.replaceMisspelling(w) }));
			if (!sug.length) sug.push({ label: 'No suggestion', enabled: false });
			sug.push({ label: 'Add to Dictionary', click: () => { wc.session.addWordToSpellCheckerDictionary(p.misspelledWord); wc.replaceMisspelling(p.misspelledWord); } }, { type: 'separator' });
			tpl = sug.concat(tpl);
			show = true;
		}
		if (show) Menu.buildFromTemplate(tpl).popup({ window: win });
	}

	// ---------- links ----------
	async function isExecutable(file) {
		try {
			const st = await fs.promises.stat(file);
			if (st.isDirectory()) return false;
			const ext = path.extname(file).toLowerCase();
			if (EXECUTABLE_EXT.includes(ext)) return true;
			if (!WIN && !ext && (st.mode & 73) !== 0) {
				const head = Buffer.alloc(4), fh = await fs.promises.open(file, 'r');
				await fh.read(head, 0, 4, 0); await fh.close();
				return head.toString('ascii', 0, 2) === '#!' || ['7f454c46', 'cffaedfe', 'feedface'].includes(head.toString('hex'));
			}
		} catch (e) { /* unreadable */ }
		return false;
	}
	const fileUrlToPath = (url) => {
		let p = url.replace(/^file:(\/\/)?/, '');
		if (WIN && p.startsWith('/')) p = p.substring(1);
		const hash = p.lastIndexOf('#');
		if (hash !== -1) p = p.substring(0, hash);
		return path.normalize(decodeURIComponent(p));
	};
	async function openLink(win, url, disposition, frameName) {
		const m = url.match(/^([a-z][a-z0-9+\-.]*):/i), scheme = m ? m[1].toLowerCase() : '';
		if (!scheme || scheme === SCHEME || scheme === 'about') return;
		const filePath = scheme === 'file' ? fileUrlToPath(url) : '';
		const trusted = ['http', 'https', 'basalt', 'obsidian'].includes(scheme) || (filePath && vaultByPath(filePath)) || (config.openSchemes && config.openSchemes[scheme]);
		if (!trusted) {
			const r = await dialog.showMessageBox(win, { message: 'This link will open an external application outside of Basalt. Only proceed if you trust the source of this link.\n\nLink: ' + short(url, 200), type: 'warning', buttons: ['Open Link', 'Cancel'], defaultId: 1, cancelId: 1, title: 'Open external link?', checkboxLabel: 'Always open ' + scheme + ':// links' });
			if (r.response !== 0) return;
			if (r.checkboxChecked) { config.openSchemes = config.openSchemes || {}; config.openSchemes[scheme] = true; save(); }
		}
		if (frameName !== '_external' && (scheme === 'http' || scheme === 'https')) {
			let leaf = 'tab', active = false;
			if (disposition === 'new-window') { leaf = 'window'; active = true; } else if (frameName === 'split') { leaf = 'split'; active = true; } else if (disposition === 'foreground-tab') active = true;
			const script = `(() => { const e = new CustomEvent('open-url', ${JSON.stringify({ cancelable: true, detail: { url, leaf, active } })}); window.dispatchEvent(e); return e.defaultPrevented; })()`;
			if (await win.webContents.executeJavaScript(script)) return;
		}
		if (scheme !== 'file') { console.log('Opening URL: ' + url); return shell.openExternal(url); }
		if (isUnc(filePath) || (WIN && !/^[a-z]:/i.test(filePath))) {
			const r = await dialog.showMessageBox(win, { message: 'This file is located on a remote server, and may be dangerous.\nAre you sure you want to open it?\n\nLocation: ' + short(filePath, 200), type: 'warning', buttons: ['Open this file', 'Cancel'], defaultId: 1, cancelId: 1, title: 'Remote file warning' });
			if (r.response !== 0) return;
		}
		if (await isExecutable(filePath)) {
			const r = await dialog.showMessageBox(win, { message: 'This link points to an executable file. Running it can harm your computer.\nAre you sure you want to open it?\n\nFile: ' + short(filePath, 200), type: 'warning', buttons: ['Run File', 'Cancel'], defaultId: 1, cancelId: 1, title: 'Run executable file?' });
			if (r.response !== 0) return;
		}
		console.log('Opening file: ' + filePath);
		openPath(filePath);
	}
	function openPath(p) { if (!WIN && !MAC) shell.openExternal('file://' + p); else shell.openPath(p); }

	// ---------- windows ----------
	function secure(wc) {
		if (wc.isSecured) return;
		wc.isSecured = true;
		wc.setWindowOpenHandler((d) => {
			if (d.url === 'about:blank' && d.features && d.features.startsWith('popup')) {
				const o = {}; let bg = '';
				for (const part of d.features.split(',')) {
					const [k, v] = part.split('=');
					if (['x', 'y', 'width', 'height'].includes(k)) o[k] = parseInt(v, 10);
					if (k === 'background') bg = v;
				}
				return { action: 'allow', overrideBrowserWindowOptions: { trafficLightPosition: { x: 19, y: 12 }, autoHideMenuBar: true, backgroundColor: bg || undefined, ...o, webPreferences: { contextIsolation: false, nodeIntegration: true, nodeIntegrationInWorker: true } } };
			}
			openLink(BrowserWindow.fromWebContents(wc), d.url, d.disposition, d.frameName).catch(console.error);
			return { action: 'deny' };
		});
		wc.on('will-attach-webview', (e, prefs) => { delete prefs.preload; delete prefs.preloadURL; Object.assign(prefs, { sandbox: true, nodeIntegration: false, nodeIntegrationInWorker: false, nodeIntegrationInSubFrames: false, webSecurity: true, plugins: false, experimentalFeatures: false, webviewTag: false }); });
		let tabBudget = true;
		wc.on('did-attach-webview', (e, guest) => {
			guest.setWindowOpenHandler(({ url, disposition, frameName }) => {
				if (disposition === 'foreground-tab') { if (!tabBudget) return { action: 'deny' }; tabBudget = false; }
				if (/^https?:\/\//.test(url)) attempt(() => openLink(BrowserWindow.fromWebContents(guest), url, disposition, frameName));
				return { action: 'deny' };
			});
			guest.on('will-navigate', (ev, url) => { if (!/^https?:\/\//.test(url)) ev.preventDefault(); });
			guest.on('will-frame-navigate', (ev) => { if (!/^https?:\/\//.test(ev.url)) ev.preventDefault(); });
			guest.on('will-attach-webview', (ev) => ev.preventDefault());
			guest.on('did-navigate', () => { tabBudget = true; });
		});
	}
	function wireWindow(win, isMain) {
		const wc = win.webContents;
		secure(wc);
		enableRemote(wc);
		wc.on('will-navigate', (ev, url) => { if (url.indexOf(INDEX_URL) !== 0) { ev.preventDefault(); if (url.indexOf(APP_HOST) !== 0) openLink(win, url).catch(console.error); } });
		win.on('app-command', (e, cmd) => { if (cmd === 'browser-backward') wc.executeJavaScript('history.back()'); else if (cmd === 'browser-forward') wc.executeJavaScript('history.forward()'); });
		win.on('swipe', (e, dir) => { if (dir === 'left') wc.executeJavaScript('history.back()'); else if (dir === 'right') wc.executeJavaScript('history.forward()'); });
		win.on('focus', () => { win.focusTime = Date.now(); applyMenu(); setMenuItem(menuOf(win), 'window-always-on-top', { checked: win.isAlwaysOnTop(), enabled: !isMain }); });
		win.on('always-on-top-changed', () => { if (win === BrowserWindow.getFocusedWindow()) setMenuItem(menuOf(win), 'window-always-on-top', { checked: win.isAlwaysOnTop() }); });
		for (const ev of ['maximize', 'enter-full-screen']) win.on(ev, () => { if (win.isAlwaysOnTop()) win.setAlwaysOnTop(false); });
		const tell = (name) => () => wc.executeJavaScript(`window.dispatchEvent(new Event('${name}'));`);
		win.on('focus', tell('focuschange')); win.on('blur', tell('focuschange'));
		win.on('enter-full-screen', tell('fullscreenchange')); win.on('leave-full-screen', tell('fullscreenchange'));
	}
	function windowBounds(saved) {
		const out = { width: 800, height: 600 };
		attempt(() => { const wa = screen.getPrimaryDisplay().workArea; out.width = Math.min(1024, wa.width); out.height = Math.min(800, wa.height - 1); });
		let onScreen = false;
		if (saved.x !== undefined && saved.y !== undefined && saved.width !== undefined && saved.height !== undefined) {
			attempt(() => { for (const d of screen.getAllDisplays()) { const w = d.workArea; if (saved.x < w.x + w.width - 2 && saved.x + saved.width > w.x + 2 && saved.y < w.y + w.height - 2 && saved.y + saved.height > w.y + 2) { onScreen = true; break; } } });
		} else if (saved.x === undefined && saved.y === undefined && saved.width !== undefined && saved.height !== undefined) onScreen = true;
		if (onScreen) Object.assign(out, { x: saved.x, y: saved.y, width: saved.width, height: saved.height });
		out.width = Math.max(300, out.width); out.height = Math.max(200, out.height);
		return out;
	}
	function openVault(id, focus = true) {
		const existing = windows[id];
		if (existing) { if (focus) { if (existing.isMinimized()) existing.restore(); existing.focus(); } return existing; }
		const state = readJson(id) || {};
		const win = new BrowserWindow({
			width: 800, height: 600, minWidth: 200, minHeight: 150, backgroundColor: '#00000000', trafficLightPosition: { x: 19, y: 12 }, show: false,
			frame: nativeFrame, titleBarStyle,
			webPreferences: { contextIsolation: false, nodeIntegration: true, nodeIntegrationInWorker: true, spellcheck: true, webviewTag: true },
			...windowBounds(state),
		});
		windows[id] = win;
		const wc = win.webContents;
		let shown = false;
		const reveal = () => {
			if (shown) return;
			shown = true;
			if (state.isMaximized) win.maximize();
			if (state.devTools) wc.openDevTools();
			win.show();
			if (typeof state.zoom === 'number') wc.executeJavaScript(`require('electron').webFrame.setZoomLevel(${state.zoom})`);
		};
		win.menuBarVisible = false;
		setIcon(win);
		const normal = () => !win.isMaximized() && !win.isMinimized() && !win.isFullScreen();
		const remember = () => attempt(() => {
			const b = win.getBounds();
			if (normal()) Object.assign(state, { x: b.x, y: b.y, width: b.width, height: b.height });
			state.isMaximized = win.isMaximized(); state.devTools = wc.isDevToolsOpened(); state.zoom = wc.zoomLevel;
		});
		wc.on('did-finish-load', () => { win.loaded = true; });
		wireWindow(win, true);
		const spell = (target) => target.on('context-menu', (e, p) => {
			if (contextMenuSender && contextMenuSender === wc.id) {
				contextMenuSender = null;
				try { wc.send('context-menu', { editFlags: p.editFlags, misspelledWord: p.misspelledWord, dictionarySuggestions: p.dictionarySuggestions, webContentsId: target.id }); return; } catch (err) { console.error(err); }
			}
			contextMenu(win, target, p);
		});
		spell(wc);
		win.on('close', (e) => { remember(); writeJson(id, state); setTimeout(() => { if (!e.defaultPrevented && !win.isDestroyed()) win.destroy(); }, 3000); });
		win.on('closed', () => { delete windows[id]; if (!quitting && (starterWindow || Object.keys(windows).length > 0)) markOpen(id, false); });
		let timer;
		const later = () => { clearTimeout(timer); timer = setTimeout(remember, 100); };
		win.on('resize', later); win.on('move', later);
		win.on('ready-to-show', reveal);
		wc.on('did-create-window', (child) => { parents.set(child, win); setIcon(child); wireWindow(child, false); spell(child.webContents); });
		win.loadURL(INDEX_URL).then(reveal, reveal);
		markOpen(id, true);
		return win;
	}
	function markOpen(id, open) { const v = vaults[id]; if (!v) return; if (open) v.open = true; else delete v.open; save(); }
	function utilityWindow(opts) {
		const win = new BrowserWindow({ width: 800, height: 600, resizable: false, maximizable: false, fullscreenable: false, show: false, frame: nativeFrame, titleBarStyle, backgroundColor: '#1e1e1e', webPreferences: { contextIsolation: false, nodeIntegration: true }, ...opts });
		setIcon(win);
		enableRemote(win.webContents);
		win.menuBarVisible = false;
		win.on('focus', applyMenu);
		return win;
	}
	function showStarter() {
		if (starterWindow) { if (starterWindow.isMinimized()) starterWindow.restore(); starterWindow.focus(); return; }
		const win = starterWindow = utilityWindow({ width: 800, height: 650 });
		win.on('closed', () => { starterWindow = null; });
		const show = () => win.show();
		win.loadURL(APP_HOST + 'starter.html').then(show, show);
	}
	function showHelp() {
		if (helpWindow) { if (helpWindow.isMinimized()) helpWindow.restore(); helpWindow.focus(); return; }
		const win = helpWindow = utilityWindow({ width: 600, height: 680 });
		win.on('closed', () => { helpWindow = null; });
		const show = () => win.show();
		win.loadURL(APP_HOST + 'help.html').then(show, show);
	}
	const reopenWindows = () => { for (const id in vaults) if (vaults[id].open) openVault(id); if (Object.keys(windows).length === 0) showStarter(); };

	// ---------- vaults ----------
	function addVault(p) {
		const resolved = path.resolve(p);
		for (const id in vaults) if (path.resolve(vaults[id].path) === resolved) { openVault(id); return ''; }
		if (!fs.existsSync(resolved)) return 'Vault folder not found';
		const id = randomId(16, true);
		vaults[id] = { path: resolved, ts: Date.now() };
		save();
		openVault(id);
		return '';
	}
	function sendAction(id, action) {
		const win = openVault(id, false);
		const js = `(function(){var w=window,o=${JSON.stringify(action)};if(typeof w.OBS_ACT==="function"){w.OBS_ACT(o)}else{w.OBS_ACT=o}})()`;
		if (win.loaded) win.webContents.executeJavaScript(js); else win.webContents.once('did-finish-load', () => win.webContents.executeJavaScript(js));
	}
	const URI_PREFIXES = ['basalt://', 'obsidian://']; // obsidian:// stays so links made for other apps keep working
	function handleUri(raw) {
		const prefix = URI_PREFIXES.find((p) => raw.startsWith(p));
		if (!prefix) return;
		console.log('Received callback URL', raw);
		let rest = raw.slice(prefix.length);
		const action = {};
		if (rest.startsWith('/')) { action.action = 'open'; action.path = decodeURI(WIN ? rest.slice(1) : rest); }
		else if (rest.startsWith('sync-setup') || rest.startsWith('choose-vault')) { showStarter(); return; }
		else if (rest.startsWith('vault/')) { const parts = rest.slice(6).split('/').map(decodeURIComponent); action.action = 'open'; action.vault = parts[0]; action.file = parts.slice(1).join('/'); }
		else {
			let query = '', q = rest.indexOf('?'), h = rest.indexOf('#', Math.max(0, q));
			if (h >= 0) { action.hash = rest.slice(h + 1); rest = rest.slice(0, h); }
			if (q >= 0) { query = rest.slice(q + 1); rest = rest.slice(0, q); }
			for (const pair of query.split('&')) { const kv = pair.split('='); action[decodeURIComponent(kv[0])] = kv.length > 1 ? decodeURIComponent(kv[1]) : 'true'; }
			action.action = rest.replace(/\/+$/g, '');
		}
		let id = null;
		if (typeof action.path === 'string' && action.path) {
			id = vaultByPath(action.path);
			if (id) action.file = path.resolve(action.path).slice(path.resolve(vaults[id].path).length);
		} else if (typeof action.vault === 'string' && action.vault) id = vaultByName(action.vault);
		else { id = lastFocusedVault(); if (!id) { reopenWindows(); id = lastFocusedVault(); } }
		if (id) sendAction(id, action); else dialog.showErrorBox('Vault not found.', 'Unable to find a vault for the URL ' + raw);
	}

	// ---------- command line over a local pipe ----------
	// The console shim (basalt.com) starts Basalt with session=<pipe>: its console is that pipe, so commands print there
	function serveSession(args, cwd) {
		const name = args.shift().slice(8);
		let tty = false;
		if (args[0] === 'tty') { tty = true; args.shift(); }
		const deadline = Date.now() + 2000;
		const connect = () => {
			const sock = net.createConnection(`\\\\.\\pipe\\${name}`);
			sock.setNoDelay(true);
			sock.once('connect', () => answerConsole(sock, args, tty, cwd));
			sock.once('error', () => { sock.destroy(); if (Date.now() < deadline) setTimeout(connect, 10); });
		};
		connect();
	}
	async function answerConsole(sock, args, tty, cwd) {
		const id = (cwd && vaultByPath(cwd)) || lastFocusedVault() || Object.keys(vaults)[0];
		const uri = args[args.length - 1];
		if (uri && URI_PREFIXES.some((p) => uri.startsWith(p))) { handleUri(uri); sock.end('Processed URI ' + uri + '\n'); return; }
		if (args.length) { sock.end(String((await runCli(id, args)) ?? '') + '\n'); return; }
		if (!tty) { sock.end('Give a command, for example: basalt help\n'); return; }
		// no command in a console: a small prompt; the full shell is basalt-cli
		let line = '';
		const prompt = () => sock.write('\x1b[38;2;176;122;82mbasalt\x1b[0m> ');
		sock.write('Basalt command line. Type a command, "exit" to leave. For completion and history run basalt-cli.\r\n');
		prompt();
		sock.on('data', async (chunk) => {
			for (const ch of chunk.toString()) {
				if (ch === '\r' || ch === '\n') {
					const cmd = line.trim(); line = ''; sock.write('\r\n');
					if (cmd === 'exit' || cmd === 'quit') { sock.end(); return; }
					if (cmd) { const out = String((await runCli(id, cmd.match(/"[^"]*"|\S+/g).map((x) => x.replace(/^"|"$/g, '')))) ?? ''); sock.write(out.replace(/\r?\n/g, '\r\n') + '\r\n'); }
					prompt();
				} else if (ch === '\x7f' || ch === '\b') { if (line) { line = line.slice(0, -1); sock.write('\b \b'); } }
				else if (ch === '\x03' || ch === '\x04') { sock.end(); return; }
				else if (ch >= ' ') { line += ch; sock.write(ch); }
			}
		});
		sock.on('error', () => {});
	}

	async function runCli(id, argv) {
		if (!config.cli) return 'Command line interface is not enabled. Please turn it on in Settings > General > Advanced.';
		if (!id || !vaults[id]) return 'Vault not found.';
		const win = openVault(id, false);
		try {
			return await win.webContents.executeJavaScript(`new Promise((resolve, reject) => { const argv = ${JSON.stringify(argv)}; if (window.handleCli) { Promise.resolve(window.handleCli(argv)).then(resolve, reject); } else { window.cliQueue = window.cliQueue || []; window.cliQueue.push({ argv, resolve, reject }); } })`);
		} catch (e) { return typeof e === 'string' ? 'Error: ' + e : String(e); }
	}
	const server = net.createServer(async (sock) => {
		sock.setNoDelay(true);
		let buf = '';
		try {
			const head = await new Promise((resolve, reject) => {
				const onData = (chunk) => {
					buf += chunk.toString();
					const nl = buf.indexOf('\n');
					if (nl === -1) return;
					sock.removeListener('data', onData);
					resolve(JSON.parse(buf.slice(0, nl)));
				};
				sock.on('data', onData); sock.once('error', reject);
				setTimeout(() => reject(new Error('Header timeout')), 5000);
			});
			const argv = Array.isArray(head.argv) ? head.argv : [];
			const uri = argv[argv.length - 1];
			if (uri && URI_PREFIXES.some((p) => uri.startsWith(p))) { handleUri(uri); sock.write('Processed URI ' + uri + '\n'); return sock.end(); }
			const id = (head.cwd && vaultByPath(head.cwd)) || lastFocusedVault() || Object.keys(vaults)[0];
			const out = await runCli(id, argv);
			sock.write((out == null ? '' : String(out)) + '\n');
		} catch (e) { attempt(() => sock.write('Error: ' + e.message + '\n')); }
		sock.end();
	});
	server.on('error', (e) => console.error('CLI pipe:', e.message));
	if (!WIN) attempt(() => fs.unlinkSync(pipeName));
	server.listen(pipeName);

	// ---------- ad filter lists ----------
	let blocker = null, blockerTimer = null;
	async function loadBlocker() {
		const dir = path.join(data, 'adblock');
		fs.mkdirSync(dir, { recursive: true });
		const days = Object.prototype.hasOwnProperty.call(config, 'adblockFrequency') ? config.adblockFrequency : 4;
		const fresh = new Blocker();
		for (const url of config.adblock || DEFAULT_ADBLOCK) {
			const file = path.join(dir, path.basename(url));
			let download = true;
			try { const st = await fs.promises.stat(file); download = days === 0 ? false : (Date.now() - st.mtime.getTime()) / 864e5 >= days; } catch (e) { /* never downloaded */ }
			if (!download) { fresh.addList(await fs.promises.readFile(file, 'utf8')); continue; }
			console.log('Retrieving newer version of ' + url);
			try { const text = await (await electron.net.fetch(url)).text(); await fs.promises.writeFile(file, text); fresh.addList(text); }
			catch (e) { console.log('Failed to retrieve filter list: ' + e); try { fresh.addList(await fs.promises.readFile(file, 'utf8')); } catch (e2) { /* none yet */ } }
		}
		blocker = fresh;
		if (blockerTimer) clearTimeout(blockerTimer);
		if (days !== 0) blockerTimer = setTimeout(loadBlocker, Math.min(days, 24) * 864e5);
	}

	// ---------- the app:// protocol ----------
	function resolveAppUrl(raw) {
		let url = raw;
		for (const mark of ['?', '#']) if (url.indexOf(mark) > 0) url = url.substring(0, url.indexOf(mark));
		if (url.indexOf(APP_HOST) === 0) { // the interface's own files
			const file = path.resolve(path.join(resources, decodeURIComponent(url.substring(APP_HOST.length))));
			return { file: file.indexOf(path.resolve(resources)) === 0 ? file : '', own: true };
		}
		if (url.indexOf(fileBase) === 0) { // a vault file, only through the private address
			let file = decodeURIComponent(url.substring(fileBase.length));
			if (!WIN) file = '/' + file;
			return { file: path.resolve(file), own: isUnc(file) };
		}
		return { file: '', own: false };
	}
	function serveFile(req) {
		const { file, own } = resolveAppUrl(req.url);
		if (!file) return new Response('Not Found', { status: 400 });
		return fs.promises.stat(file).then((st) => {
			const headers = new Headers();
			let status = 200, stream;
			const range = req.headers.get('Range');
			if (range) {
				const m = range.match(/^bytes=(\d*)-(\d*)/);
				if (!m) return new Response('Range Not Satisfiable', { status: 416 });
				const from = Number(m[1] || 0), to = Number(m[2] || st.size - 1);
				if (isNaN(from) || isNaN(to) || from < 0 || to > st.size - 1 || to < from) return new Response('Range Not Satisfiable', { status: 416 });
				headers.set('Accept-Ranges', 'bytes'); headers.set('Content-Length', String(to - from + 1)); headers.set('Content-Range', `bytes ${from}-${to}/${st.size}`);
				status = 206; stream = fs.createReadStream(file, { start: from, end: to });
			} else { headers.set('Content-Length', String(st.size)); stream = fs.createReadStream(file); }
			headers.set('Access-Control-Allow-Origin', '*');
			headers.set('Last-Modified', st.mtime.toUTCString());
			if (own) headers.set('X-Frame-Options', 'DENY');
			return new Response(Readable.toWeb(stream), { status, headers });
		}).catch((e) => { console.error(e); return new Response('Not Found', { status: 400 }); });
	}

	// ---------- channels the interface calls ----------
	const sync = (name, fn) => ipcMain.on(name, (e, ...a) => { e.returnValue = fn(e, ...a); });
	function registerChannels() {
		sync('is-dev', () => false);
		sync('is-quitting', () => quitting);
		sync('desktop-dir', () => desktopDir);
		sync('documents-dir', () => documentsDir);
		sync('get-documents-path', () => documentsDir);
		sync('resources', () => resources);
		sync('version', () => version);
		sync('file-url', () => fileBase);
		sync('relaunch', () => { console.log('Relaunching!'); quitting = true; app.relaunch(); app.quit(); return ''; });
		// updates come from the project's releases through the interface itself, not from here
		sync('update', () => '');
		sync('check-update', () => false);
		sync('disable-update', (e, v) => { if (v === true) { config.updateDisabled = true; events.emit('disable', true); save(); } else if (v === false) { delete config.updateDisabled; events.emit('disable', false); save(); } return config.updateDisabled; });
		sync('copy-asar', () => false);
		sync('disable-gpu', (e, v) => { if (v === true) { config.disableGpu = true; save(); } else if (v === false) { delete config.disableGpu; save(); } return config.disableGpu; });
		sync('insider-build', (e, v) => { if (v === true && !config.insider) { config.insider = true; events.emit('insider', true); save(); } else if (v === false && config.insider) { delete config.insider; events.emit('insider', false); save(); } return !!config.insider; });
		sync('cli', (e, v) => { if (v === true && !config.cli) { config.cli = true; events.emit('cli', true); save(); } else if (v === false && config.cli) { delete config.cli; events.emit('cli', false); save(); } return !!config.cli; });
		sync('frame', (e, v) => { if (typeof v === 'string') { config.frame = v; if (!v) delete config.frame; save(); } return config.frame; });
		sync('adblock-lists', (e, v) => { if (Array.isArray(v)) { config.adblock = v; save(); loadBlocker().catch(console.error); } return config.adblock || DEFAULT_ADBLOCK; });
		sync('adblock-frequency', (e, v) => { if (typeof v === 'number') { config.adblockFrequency = v; save(); loadBlocker().catch(console.error); } return config.adblockFrequency || 4; });
		ipcMain.on('print-to-pdf', async (e, opts) => {
			console.log('Saving PDF...');
			const wc = e.sender;
			try { const buf = await wc.printToPDF(opts); await fs.promises.writeFile(opts.filepath, buf); if (opts.open) openPath(opts.filepath); } finally { console.log('Done.'); wc.send('print-to-pdf', {}); }
		});
		sync('vault', (e) => { for (const id in windows) if (windows[id].webContents === e.sender) return { id, path: path.resolve(vaults[id].path) }; return {}; });
		sync('vault-list', () => vaults);
		sync('vault-remove', (e, p) => {
			if (!p || typeof p !== 'string') return false;
			for (const id in vaults) if (vaults[id].path === p) { if (windows[id]) return false; delete vaults[id]; save(); attempt(() => fs.unlinkSync(jsonFile(id))); forgetPartition(id); return true; }
			return false;
		});
		sync('vault-move', (e, from, to) => {
			if (!from || typeof from !== 'string') return false;
			for (const id in vaults) {
				if (vaults[id].path !== from) continue;
				if (windows[id]) return 'EVAULTOPEN';
				try { fs.renameSync(from, to); } catch (err) { return String(err); }
				vaults[id].path = to; save();
				return '';
			}
			return false;
		});
		sync('vault-open', (e, p, create) => {
			if (create) {
				if (fs.existsSync(p)) return 'Vault already exists';
				try { fs.mkdirSync(p, { recursive: true }); } catch (err) { return String(err); }
			}
			return addVault(p);
		});
		sync('vault-message', (e, p, action) => { const id = vaultByPath(path.resolve(p)); if (id) sendAction(id, action); return ''; });
		sync('starter', () => { showStarter(); return null; });
		sync('help', () => { showHelp(); return null; });
		sync('sandbox', () => {
			attempt(() => fs.mkdirSync(sandboxVaultPath, { recursive: true }));
			// the example notes are copied once, into an empty folder
			attempt(() => { if (!fs.readdirSync(sandboxVaultPath).length) copyTree(path.join(resources, 'sandbox'), sandboxVaultPath); });
			addVault(sandboxVaultPath);
			return null;
		});
		sync('get-sandbox-vault-path', () => sandboxVaultPath);
		sync('get-default-vault-path', () => defaultVaultPath);
		ipcMain.on('context-menu', (e) => { contextMenuSender = e.sender.id; });
		ipcMain.on('request-url', async (e, channel, opts) => {
			try {
				const { url, method, contentType, body, headers } = opts;
				const req = electron.net.request({ url, method, redirect: 'follow' });
				if (contentType) req.setHeader('Content-Type', contentType);
				if (headers) for (const k in headers) attempt(() => req.setHeader(k, headers[k]));
				req.on('login', (info, cb) => cb());
				req.on('error', (err) => e.reply(channel, { error: err }));
				req.on('response', (res) => {
					const parts = [];
					res.on('data', (c) => parts.push(c));
					res.on('end', () => { const b = Buffer.concat(parts); e.reply(channel, { status: res.statusCode, headers: res.headers, body: b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) }); });
				});
				if (typeof body === 'string') req.write(body); else if (body instanceof ArrayBuffer) req.write(Buffer.from(new Uint8Array(body)));
				req.end();
			} catch (err) { e.reply(channel, { error: err }); }
		});
		ipcMain.on('show-in-folder', (e, p) => { try { shell.showItemInFolder(path.normalize(String(p))); } catch (err) { console.log(err); } });
		ipcMain.on('trash', async (e, p) => { try { await shell.trashItem(p); e.returnValue = true; } catch (err) { console.log(err); e.returnValue = false; } });
		ipcMain.on('set-menu', (e, { template }) => { const win = BrowserWindow.fromWebContents(e.sender); if (!win) return; win.appMenu = buildMenu(template); if (MAC) applyMenu(); else win.setMenu(win.appMenu); });
		ipcMain.on('update-menu-items', (e, items, refresh) => { const win = BrowserWindow.fromWebContents(e.sender), menu = menuOf(win); if (menu !== fallbackMenu) { for (const { itemId, eState } of items) setMenuItem(menu, itemId, eState); if (refresh) applyMenu(); } });
		ipcMain.on('render-menu', (e) => { const win = BrowserWindow.fromWebContents(e.sender); menuOf(win).popup({ window: win }); });
		sync('set-icon', (e, name, bytes) => {
			if (config.icon) fs.rmSync(path.join(data, config.icon), { force: true });
			if (name && bytes) fs.writeFileSync(path.join(data, name), bytes); else name = null;
			if ((config.icon || '') !== (name || '')) { if (name) config.icon = name; else delete config.icon; save(); }
			iconPath = config.icon ? path.join(data, config.icon) : undefined;
			return null;
		});
		sync('get-icon', () => config.icon);
		const browserSessions = {};
		ipcMain.on('create-browser-session', (e, partition, filter) => {
			let entry = browserSessions[partition];
			if (!entry) {
				if (filter === true && !blocker) loadBlocker().catch(console.error);
				entry = browserSessions[partition] = { session: session.fromPartition(partition), filter: !!filter };
				entry.session.webRequest.onBeforeRequest({ urls: ['https://*/*', 'http://*/*'] }, (details, cb) => cb({ cancel: entry.filter && !!blocker && blocker.blocks(details) }));
				entry.session.setUserAgent(entry.session.getUserAgent().split(' ').filter((t) => !/^(basalt|electron)/i.test(t)).join(' '));
				entry.session.setPermissionRequestHandler((wc, permission, cb) => cb(ALLOWED_PERMISSIONS.includes(permission)));
			}
			e.returnValue = null;
		});
		ipcMain.handle('pick-folder', async (e, start) => {
			const win = BrowserWindow.fromWebContents(e.sender);
			const r = await dialog.showOpenDialog(win, { properties: ['openDirectory', 'createDirectory'], defaultPath: start && fs.existsSync(start) ? start : documentsDir });
			return r.canceled || !r.filePaths.length ? null : r.filePaths[0];
		});
		ipcMain.handle('register-cli', async () => {
			const exeName = path.basename(process.argv0);
			if (!exeName.toLowerCase().includes('basalt')) return { success: false, message: `Unable to add to the command line because the executable is "${exeName}" instead of "basalt".` };
			try {
				const run = require('util').promisify(require('child_process').exec), dir = path.dirname(process.execPath);
				if (WIN) {
					const { stdout } = await run(`powershell -NoProfile -Command "[Environment]::GetEnvironmentVariable('Path', 'User')"`);
					const parts = stdout.trim().split(';').filter(Boolean);
					if (parts.some((p) => path.resolve(p).toLowerCase() === path.resolve(dir).toLowerCase())) return { success: true, message: 'Already registered to PATH.' };
					const next = parts.concat(dir).join(';').replace(/'/g, "''");
					await run(`powershell -NoProfile -Command "[Environment]::SetEnvironmentVariable('Path', '${next}', 'User')"`);
					return { success: true, message: 'Successfully registered to PATH. Please restart your terminal.' };
				}
				const bin = path.join(os.homedir(), '.local', 'bin'), link = path.join(bin, 'basalt');
				fs.mkdirSync(bin, { recursive: true });
				const target = fs.existsSync(path.join(dir, 'basalt')) ? path.join(dir, 'basalt') : process.execPath;
				attempt(() => fs.unlinkSync(link));
				fs.symlinkSync(target, link);
				return { success: true, message: `Registered ${link}. Make sure ${bin} is in your PATH.` };
			} catch (e) { return { success: false, message: 'Could not register: ' + e.message }; }
		});
	}

	// ---------- application events ----------
	let launchUrl = null;
	app.on('will-finish-launching', () => { app.once('open-url', (e, url) => { e.preventDefault(); launchUrl = url; }); });
	app.on('web-contents-created', (e, wc) => {
		secure(wc);
		wc.noContextMenu = false;
		if (wc.hostWebContents) wc.on('context-menu', (ev, p) => { if (!wc.noContextMenu) contextMenu(BrowserWindow.fromWebContents(wc), wc, p); });
	});
	app.on('open-file', (e, file) => { e.preventDefault(); const id = vaultByPath(file); if (id) openVault(id); });
	app.on('open-url', (e, url) => { e.preventDefault(); handleUri(url); });
	app.on('window-all-closed', () => { if (!MAC) app.quit(); });
	app.on('before-quit', () => { quitting = true; });
	app.on('will-quit', () => { attempt(() => server.close()); if (!WIN) attempt(() => fs.unlinkSync(pipeName)); });
	app.on('activate', () => { quitting = false; if (BrowserWindow.getAllWindows().length === 0) reopenWindows(); });
	app.on('second-instance', (e, argv, cwd) => {
		const args = cliArgs(argv);
		if (WIN && args[0] && args[0].startsWith('session=')) { serveSession(args, cwd); return; }
		for (const a of argv) {
			if (URI_PREFIXES.some((p) => a.startsWith(p))) handleUri(a);
			else if (!a.startsWith('-') && path.isAbsolute(a)) { const id = vaultByPath(a); if (id) openVault(id); }
		}
	});

	app.whenReady().then(() => {
		protocol.handle(SCHEME, serveFile);
		registerChannels();
		if (!app.isPackaged || !app.isDefaultProtocolClient('basalt')) attempt(() => app.setAsDefaultProtocolClient('basalt'));
		const argvUri = process.argv.slice(1).reverse().find((a) => URI_PREFIXES.some((p) => a.startsWith(p)));
		if (argvUri) launchUrl = argvUri;
		if (launchUrl) handleUri(launchUrl); else reopenWindows();
	});
};
