'use strict';
// Basalt launcher: the first file Electron runs. It prepares the process (data folder, command line, headless mode, window
// recovery, the app:// scheme) and hands over to the app in resources/app-src/main.js.

const path = require('path');
const fs = require('fs');
const os = require('os');
const util = require('util');
const EventEmitter = require('events');
const electron = require('electron');
const remote = require('@electron/remote/main');
electron.remote = remote;
const { app, protocol, BrowserWindow } = electron;

// Basalt keeps its own data folder; a test run can point elsewhere with --user-data-dir
if (!process.argv.some((a) => a.startsWith('--user-data-dir'))) {
	app.setPath('userData', path.join(app.getPath('appData'), 'Basalt'));
}
const dataPath = app.getPath('userData');

// Chromium keeps compiled copies of our scripts; after an update they would run the old version
for (const d of ['Code Cache', 'Cache', 'GPUCache']) {
	try { fs.rmSync(path.join(dataPath, d), { recursive: true, force: true }); } catch (e) { /* in use */ }
}

// The command line (`basalt ...`) is on by default: it is how scripts and the daemon talk to the app
try {
	const cfgFile = ['basalt.json', 'obsidian.json'].map((n) => path.join(dataPath, n)).find((f) => fs.existsSync(f)) || path.join(dataPath, 'basalt.json');
	const cfg = fs.existsSync(cfgFile) ? JSON.parse(fs.readFileSync(cfgFile, 'utf8')) : {};
	if (cfg.cli === undefined && !cfg.cliOff) {
		cfg.cli = true;
		fs.mkdirSync(path.dirname(cfgFile), { recursive: true });
		fs.writeFileSync(cfgFile, JSON.stringify(cfg));
	}
} catch (e) { /* settings unreadable: leave them */ }

// Headless mode (BASALT_HEADLESS=1, started by `basalt daemon start`): the window exists because the app needs a live page,
// but it is far off screen and has no taskbar entry.
let stealthOn = !!process.env.BASALT_HEADLESS;
if (stealthOn) {
	for (const sw of ['disable-renderer-backgrounding', 'disable-background-timer-throttling', 'disable-backgrounding-occluded-windows']) app.commandLine.appendSwitch(sw);
	app.commandLine.appendSwitch('disable-features', 'CalculateNativeWinOcclusion');
	const hide = (win) => {
		if (!stealthOn) return;
		try { win.setPosition(-32000, -32000); win.setSkipTaskbar(true); } catch (e) { /* window not ready */ }
	};
	app.on('browser-window-created', (e, win) => {
		hide(win);
		for (const ev of ['show', 'ready-to-show', 'move', 'restore', 'focus']) win.on(ev, () => hide(win));
	});
}

// Starting Basalt again while it is running (the daemon, a window that lost its page) shows the windows
app.on('second-instance', () => {
	stealthOn = false;
	for (const win of BrowserWindow.getAllWindows()) {
		try {
			win.setSkipTaskbar(false);
			win.setFocusable(true);
			win.setIgnoreMouseEvents(false);
			win.setOpacity(1);
			if (win.getBounds().x < -10000) win.center();
			if (win.isMinimized()) win.restore();
			win.show();
			win.focus();
		} catch (e) { /* window closed */ }
	}
});

// A renderer that died leaves an empty window: load the page again (once a minute at most)
app.on('browser-window-created', (e, win) => {
	let last = 0;
	win.webContents.on('render-process-gone', () => {
		if (Date.now() - last < 60000) return;
		last = Date.now();
		try { win.webContents.reload(); } catch (err) { /* gone */ }
	});
});

remote.initialize();
protocol.registerSchemesAsPrivileged([
	{ scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, codeCache: true } },
]);

// The app tells us about its state through this emitter ('silence' keeps the log off stdout, so CLI output stays clean)
const appEvents = new EventEmitter();
let silence = false;
appEvents.on('silence', (v) => { silence = v; });

// Log file in the data folder, mirrored to stdout
const logFile = fs.openSync(path.join(dataPath, 'basalt.log'), 'a');
process.stdout.on('error', () => { /* a closed pipe is not our problem */ });
function log(...args) {
	const d = new Date(), p2 = (n) => String(n).padStart(2, '0');
	const stamp = `${d.getUTCFullYear()}-${p2(d.getUTCMonth() + 1)}-${p2(d.getUTCDate())} ${p2(d.getUTCHours())}:${p2(d.getUTCMinutes())}:${p2(d.getUTCSeconds())}`;
	const line = stamp + ' ' + util.format(...args) + os.EOL;
	try {
		fs.writeSync(logFile, line);
		if (!silence) process.stdout.write(line);
	} catch (e) { /* log unavailable */ }
}

process.on('uncaughtException', (error) => {
	if (error.message && error.message.includes('net::ERR')) return; // a failed network request, not a bug
	console.error('Uncaught Exception', error);
	import('electron').then(({ dialog }) => {
		dialog.showErrorBox('A JavaScript error occurred in the main process', 'Uncaught Exception:\n' + (error.stack || `${error.name}: ${error.message}`));
	});
});

// Hand over to the app
const appPath = path.join(path.dirname(process.execPath), 'resources', 'app-src');
let started = false;
try {
	const start = require(path.join(appPath, 'main.js'));
	if (typeof start === 'function') {
		start(appPath, appEvents);
		started = true;
	}
} catch (e) {
	log('Could not load the app:', e && e.stack ? e.stack : e);
}
log(started ? 'Loaded app from ' + appPath : 'The app did not start.');
