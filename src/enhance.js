// DOM helpers used across Basalt and by plugins: createEl / createDiv / createSpan / createSvg, class and attribute shortcuts,
// delegated events, small async helpers. The function is self-contained on purpose: a pop-out window evaluates its source
// text (`globalEnhance.toString()`), so it must not use anything from outside itself.
window.globalEnhance = function globalEnhance() {
	'use strict';
	const win = window;
	const def = (target, name, value) => { if (!target[name]) Object.defineProperty(target, name, { value, enumerable: false, configurable: true, writable: true }); };
	const getter = (target, name, get) => Object.defineProperty(target, name, { get, enumerable: false, configurable: true });
	if (!Object.hasOwn) Object.hasOwn = (o, k) => Object.prototype.hasOwnProperty.call(o, k);

	// ----- the active window / document (the app moves these when a pop-out window gets focus) -----
	win.activeWindow = win;
	win.activeDocument = win.document;

	// ----- plain helpers -----
	win.sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
	win.nextFrame = () => new Promise((resolve) => requestAnimationFrame(() => resolve()));
	win.ready = (fn) => { if (document.readyState !== 'loading') fn(); else document.addEventListener('DOMContentLoaded', fn); };
	win.combine = (fns) => () => { for (const f of fns) f(); };
	win.fish = (selector) => document.querySelector(selector);
	win.fishAll = (selector) => Array.from(document.querySelectorAll(selector));
	def(Array.prototype, 'contains', Array.prototype.includes);
	def(Array.prototype, 'first', function () { if (this.length) return this[0]; });
	def(Array.prototype, 'last', function () { if (this.length) return this[this.length - 1]; });
	def(Array.prototype, 'remove', function (item) { for (let i = this.length - 1; i >= 0; i--) if (this[i] === item) this.splice(i, 1); });
	def(Array.prototype, 'unique', function () { return Array.from(new Set(this)); });
	def(Array.prototype, 'shuffle', function () { for (let n = this.length; n; ) { const j = Math.floor(Math.random() * n--); const t = this[n]; this[n] = this[j]; this[j] = t; } return this; });
	if (!Array.combine) Array.combine = (lists) => [].concat(...lists);
	def(Math, 'clamp', (v, lo, hi) => Math.min(Math.max(v, lo), hi));
	def(Math, 'square', (n) => n * n);
	def(String, 'isString', (v) => typeof v === 'string' || v instanceof String);
	def(String.prototype, 'contains', String.prototype.includes);
	def(String.prototype, 'format', function (...a) { return this.replace(/{(\d+)}/g, (m, i) => (a[i] !== undefined ? a[i] : m)); });
	def(Number, 'isNumber', (v) => typeof v === 'number');
	def(win, 'isBoolean', (v) => typeof v === 'boolean');
	def(Object, 'isEmpty', (o) => { for (const k in o) if (Object.prototype.hasOwnProperty.call(o, k)) return false; return true; });
	def(Object, 'each', (obj, fn, ctx) => { for (const k in obj) if (Object.prototype.hasOwnProperty.call(obj, k) && fn.call(ctx, obj[k], k) === false) return false; return true; });

	// ----- XMLHttpRequest wrappers -----
	const send = (opts, done, fail) => {
		const req = opts.req || new XMLHttpRequest();
		req.open(opts.method || 'GET', opts.url, true);
		if (opts.headers) for (const h in opts.headers) req.setRequestHeader(h, opts.headers[h]);
		if (opts.withCredentials) req.withCredentials = true;
		req.onload = () => (req.status >= 200 && req.status < 300 ? done(req.responseType && req.responseType !== 'text' ? req.response : req.responseText, req) : fail(req.status, req));
		req.onerror = () => fail(req.status || 0, req);
		let body = opts.data;
		if (body && typeof body === 'object' && !(body instanceof ArrayBuffer) && !ArrayBuffer.isView(body) && !(body instanceof Blob) && !(body instanceof FormData)) { body = JSON.stringify(body); if (!(opts.headers && Object.keys(opts.headers).some((h) => h.toLowerCase() === 'content-type'))) req.setRequestHeader('Content-Type', 'application/json'); }
		req.send(body == null ? null : body);
		return req;
	};
	win.ajax = (opts) => send(opts, (res, req) => opts.success && opts.success(res, req), (status, req) => opts.error && opts.error(status, req));
	win.ajaxPromise = (opts) => new Promise((resolve, reject) => send(opts, (res) => resolve(res), (status, req) => reject(status !== undefined ? status : req)));

	// ----- element creation -----
	const apply = (el, o) => {
		if (o == null) return;
		if (typeof o === 'string') { el.className = o; return; }
		if (o.cls) el.className = Array.isArray(o.cls) ? o.cls.join(' ') : o.cls;
		if (o.text != null) { if (typeof o.text === 'string') el.textContent = o.text; else el.appendChild(o.text); }
		if (o.attr) for (const k in o.attr) { const v = o.attr[k]; if (v === null || v === undefined || v === false) continue; el.setAttribute(k, v === true ? '' : String(v)); }
		if (o.title != null) el.title = o.title;
		if (o.value != null) el.value = o.value;
		if (o.type != null) el.type = o.type;
		if (o.placeholder != null) el.placeholder = o.placeholder;
		if (o.href != null) el.href = o.href;
		if (o.parent) { if (o.prepend) o.parent.insertBefore(el, o.parent.firstChild); else o.parent.appendChild(el); }
	};
	const make = (doc, ns, tag, o, cb) => {
		const el = ns ? doc.createElementNS(ns, tag) : doc.createElement(tag);
		apply(el, o);
		if (cb) cb(el);
		return el;
	};
	const SVG = 'http://www.w3.org/2000/svg';
	// a callback given instead of the options
	const args = (o, cb) => (typeof o === 'function' ? [null, o] : [o, cb]);
	const doc = () => win.activeDocument || document;
	win.createEl = (tag, o, cb) => { [o, cb] = args(o, cb); return make(doc(), null, tag, o, cb); };
	win.createDiv = (o, cb) => { [o, cb] = args(o, cb); return make(doc(), null, 'div', o, cb); };
	win.createSpan = (o, cb) => { [o, cb] = args(o, cb); return make(doc(), null, 'span', o, cb); };
	win.createSvg = (tag, o, cb) => { [o, cb] = args(o, cb); return make(doc(), SVG, tag, o, cb); };
	win.createFragment = (cb) => { const f = doc().createDocumentFragment(); if (cb) cb(f); return f; };

	const N = win.Node.prototype;
	const owner = (node) => node.ownerDocument || node;
	def(N, 'createEl', function (tag, o, cb) { [o, cb] = args(o, cb); const el = make(owner(this), null, tag, o, cb); if (!(o && o.parent)) { if (o && o.prepend) this.insertBefore(el, this.firstChild); else this.appendChild(el); } return el; });
	def(N, 'createDiv', function (o, cb) { return this.createEl('div', o, cb); });
	def(N, 'createSpan', function (o, cb) { return this.createEl('span', o, cb); });
	def(N, 'createSvg', function (tag, o, cb) { [o, cb] = args(o, cb); const el = make(owner(this), SVG, tag, o, cb); if (!(o && o.parent)) { if (o && o.prepend) this.insertBefore(el, this.firstChild); else this.appendChild(el); } return el; });
	def(N, 'empty', function () { while (this.firstChild) this.removeChild(this.firstChild); });
	def(N, 'detach', function () { if (this.parentNode) this.parentNode.removeChild(this); });
	def(N, 'appendText', function (text) { this.appendChild(owner(this).createTextNode(text)); });
	def(N, 'insertAfter', function (node, ref) { this.insertBefore(node, ref ? ref.nextSibling : this.firstChild); return node; });
	def(N, 'indexOf', function (child) { return Array.prototype.indexOf.call(this.childNodes, child); });
	// make the children of this node exactly `children`, touching only what differs
	def(N, 'setChildrenInPlace', function (children) {
		let i = 0, cur = this.firstChild;
		for (; i < children.length; i++) {
			const want = children[i];
			if (cur === want) { cur = cur.nextSibling; continue; }
			this.insertBefore(want, cur);
		}
		while (cur) { const next = cur.nextSibling; this.removeChild(cur); cur = next; }
	});
	N.constructorWin = win; // the window whose constructors made these nodes
	getter(N, 'doc', function () { return this.ownerDocument || document; });
	getter(N, 'win', function () { return this.doc.defaultView || win; });
	// instanceof that also works for nodes that belong to another window
	const inst = function (type) { if (this instanceof type) return true; const w = this.constructorWin; const same = w && type && type.name && w[type.name]; return !!same && this instanceof same; };
	def(N, 'instanceOf', inst);
	const U = win.UIEvent.prototype;
	def(U, 'instanceOf', function (type) { if (this instanceof type) return true; const w = this.view || win, same = type && type.name && w[type.name]; return !!same && this instanceof same; });
	getter(U, 'targetNode', function () { return this.target; });
	getter(U, 'win', function () { return this.view || win; });
	getter(U, 'doc', function () { return this.win.document; });

	// ----- elements -----
	const E = win.Element.prototype;
	const names = (v) => (Array.isArray(v) ? v : String(v).split(/\s+/)).filter(Boolean);
	def(E, 'addClass', function (...c) { this.classList.add(...c.flatMap(names)); });
	def(E, 'addClasses', function (list) { this.classList.add(...list); });
	def(E, 'removeClass', function (...c) { this.classList.remove(...c.flatMap(names)); });
	def(E, 'removeClasses', function (list) { this.classList.remove(...list); });
	def(E, 'toggleClass', function (c, on) { for (const n of names(c)) this.classList.toggle(n, on); });
	def(E, 'hasClass', function (c) { return this.classList.contains(c); });
	def(E, 'setAttr', function (k, v) { if (v === null || v === undefined) this.removeAttribute(k); else this.setAttribute(k, String(v)); });
	def(E, 'setAttrs', function (o) { for (const k in o) this.setAttr(k, o[k]); });
	def(E, 'getAttr', function (k) { return this.getAttribute(k); });
	def(E, 'setText', function (t) { if (typeof t === 'string') this.textContent = t; else { this.textContent = ''; this.appendChild(t); } });
	def(E, 'getText', function () { return this.textContent; });
	def(E, 'find', function (selector) { return this.querySelector(selector); });
	def(E, 'findAll', function (selector) { return Array.from(this.querySelectorAll(selector)); });
	def(E, 'findAllSelf', function (selector) { const out = this.matches(selector) ? [this] : []; return out.concat(Array.from(this.querySelectorAll(selector))); });
	def(E, 'getCssPropertyValue', function (prop, pseudo) { return (this.ownerDocument.defaultView || win).getComputedStyle(this, pseudo).getPropertyValue(prop).trim(); });
	def(E, 'matchParent', function (selector, last) { if (this.matches(selector)) return this; if (this === last) return null; const up = this.parentElement; return up ? up.matchParent(selector, last) : null; });
	// true when this element has the keyboard focus, also inside iframes, and its window is the active one
	def(E, 'isActiveElement', function () { for (let el = this; el; ) { if (el.doc.activeElement !== el) return false; const frame = el.win.frameElement; if (!frame) return el.win === win.activeWindow; el = frame; } return false; });
	const DF = win.DocumentFragment.prototype;
	def(DF, 'find', function (selector) { return this.querySelector(selector); });
	def(DF, 'findAll', function (selector) { return Array.from(this.querySelectorAll(selector)); });

	// ----- visibility, events -----
	const H = win.HTMLElement.prototype;
	def(H, 'show', function () { this.style.display = this.dataset.prevDisplay || ''; delete this.dataset.prevDisplay; });
	def(H, 'hide', function () { if (this.style.display && this.style.display !== 'none') this.dataset.prevDisplay = this.style.display; this.style.display = 'none'; });
	def(H, 'toggle', function (on) { if (on) this.show(); else this.hide(); });
	def(H, 'toggleVisibility', function (on) { this.style.visibility = on ? '' : 'hidden'; });
	// element.on('click', '.item', (event, matchedElement) => ...): the listener runs for events that come from inside a match
	const delegates = new WeakMap();
	const bind = (target, type, selector, listener, options) => {
		if (typeof selector === 'function') { options = listener; listener = selector; selector = null; }
		const handler = selector ? (ev) => { let el = ev.target; while (el && el !== target) { if (el.nodeType === 1 && el.matches(selector)) return listener.call(el, ev, el); el = el.parentNode; } } : listener;
		const key = type + '\u0000' + (selector || '');
		let reg = delegates.get(target); if (!reg) delegates.set(target, (reg = new Map()));
		let list = reg.get(key); if (!list) reg.set(key, (list = []));
		list.push({ listener, handler, options });
		target.addEventListener(type, handler, options);
	};
	const unbind = (target, type, selector, listener, options) => {
		if (typeof selector === 'function') { options = listener; listener = selector; selector = null; }
		const reg = delegates.get(target), list = reg && reg.get(type + '\u0000' + (selector || ''));
		if (!list) return;
		const i = list.findIndex((x) => x.listener === listener);
		if (i < 0) return;
		target.removeEventListener(type, list[i].handler, options !== undefined ? options : list[i].options);
		list.splice(i, 1);
	};
	for (const proto of [H, win.Document.prototype]) {
		def(proto, 'on', function (type, selector, listener, options) { bind(this, type, selector, listener, options); });
		def(proto, 'off', function (type, selector, listener, options) { unbind(this, type, selector, listener, options); });
	}
	def(H, 'addEventListeners', function (map) { for (const type in map) if (Object.prototype.hasOwnProperty.call(map, type) && typeof map[type] === 'function') this.addEventListener(type, map[type]); });
	def(H, 'isShown', function () { return !!this.offsetParent; });
	const inner = (a, b, size) => function () { const cs = getComputedStyle(this); let x = parseFloat(cs[a]), y = parseFloat(cs[b]); if (isNaN(x)) x = 0; if (isNaN(y)) y = 0; return this[size] - x - y; };
	getter(H, 'innerWidth', inner('paddingLeft', 'paddingRight', 'scrollWidth'));
	getter(H, 'innerHeight', inner('paddingTop', 'paddingBottom', 'scrollHeight'));
	const cssProps = function (props) { for (const k in props) this.style.setProperty(k, props[k]); };
	const cssStyles = function (styles) { Object.assign(this.style, styles); };
	for (const proto of [H, win.SVGElement.prototype]) { def(proto, 'setCssProps', cssProps); def(proto, 'setCssStyles', cssStyles); }
	def(H, 'trigger', function (type) { this.dispatchEvent(new Event(type, { bubbles: true, cancelable: true })); });
	def(H, 'onClickEvent', function (listener, options) { this.addEventListener('click', listener, options); this.addEventListener('auxclick', listener, options); });
	// calls `listener` when the element is put into a document (right away if it already is); returns a function that cancels
	def(H, 'onNodeInserted', function (listener, once) {
		const el = this;
		let cancelled = false, observer = null;
		const fire = () => { if (cancelled) return; listener(); if (once) cancel(); };
		const cancel = () => { cancelled = true; if (observer) observer.disconnect(); };
		if (el.isConnected) { fire(); if (once) return cancel; }
		observer = new MutationObserver(() => { if (el.isConnected && !el.__wasConnected) { el.__wasConnected = true; fire(); } else if (!el.isConnected) el.__wasConnected = false; });
		el.__wasConnected = el.isConnected;
		observer.observe(el.ownerDocument.documentElement, { childList: true, subtree: true });
		return cancel;
	});
	// pop-out windows: the element can move to another window; listeners run after that (the window code reports it)
	def(H, 'onWindowMigrated', function (listener) {
		const el = this;
		let last = el.constructorWin;
		const check = () => { const w = el.constructorWin; if (w !== last) { last = w; listener(w); } };
		const observer = new MutationObserver(check);
		observer.observe(win.document.documentElement, { childList: true, subtree: true });
		return () => observer.disconnect();
	});
};
window.globalEnhance();
