// Start window: pick or create a vault. It talks to the main process through the channels in src/main.js.
(() => {
	'use strict';
	const { ipcRenderer, shell } = require('electron');
	const path = require('path');

	const ru = (localStorage.getItem('language') || navigator.language || 'en').toLowerCase().startsWith('ru');
	const t = (en, rus) => (ru ? rus : en);
	const root = document.getElementById('app');

	const el = (tag, props, ...kids) => {
		const node = document.createElement(tag);
		for (const k in props || {}) {
			if (k === 'class') node.className = props[k];
			else if (k === 'on') for (const ev in props.on) node.addEventListener(ev, props.on[ev]);
			else if (k in node) node[k] = props[k];
			else node.setAttribute(k, props[k]);
		}
		for (const kid of kids) if (kid != null) node.append(kid);
		return node;
	};

	const ICONS = {
		folder: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/></svg>',
		plus: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 5v14M5 12h14"/></svg>',
		open: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M6 14l1.5-2.5A2 2 0 0 1 9.2 10.5H20M6 14v3a2 2 0 0 0 2 2h9.5a2 2 0 0 0 1.7-1l1.8-5.5M6 14V7a2 2 0 0 1 2-2h3l2 2"/></svg>',
		box: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M21 8l-9-5-9 5 9 5zM3 8v8l9 5 9-5V8M12 13v8"/></svg>',
		help: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.7.3-1 .9-1 1.7M12 17h.01"/></svg>',
	};
	const ico = (n) => { const s = document.createElement('span'); s.className = 'ico'; s.innerHTML = ICONS[n]; return s; };

	const plainError = (e) => {
		const s = String(e || '');
		if (/already exists/i.test(s)) return t('A folder with this name already exists here. Pick another name, or use "Open a folder as vault".', 'Папка с таким именем уже есть. Выберите другое имя или откройте её кнопкой «Открыть папку как хранилище».');
		if (/not found/i.test(s)) return t('That folder is gone. Remove it from the list and pick it again.', 'Эта папка больше не существует. Уберите её из списка и выберите заново.');
		if (/EACCES|EPERM/i.test(s)) return t('No permission to write there. Choose another location, for example Documents.', 'Нет прав на запись в это место. Выберите другое расположение, например «Документы».');
		if (/ENOENT/i.test(s)) return t('The location does not exist. Choose an existing folder.', 'Такого расположения нет. Выберите существующую папку.');
		return t('Could not open the vault. Check the folder and try again.', 'Не удалось открыть хранилище. Проверьте папку и попробуйте ещё раз.');
	};
	const state = { creating: !Object.keys(ipcRenderer.sendSync('vault-list') || {}).length, error: '', location: ipcRenderer.sendSync('get-default-vault-path') ? path.dirname(ipcRenderer.sendSync('get-default-vault-path')) : '', name: 'My vault' };

	function open(p, create) {
		const err = ipcRenderer.sendSync('vault-open', p, !!create);
		if (err) { state.error = plainError(err); render(); return; }
		window.close();
	}

	function vaultRows() {
		const vaults = ipcRenderer.sendSync('vault-list') || {};
		const items = Object.keys(vaults).map((id) => ({ id, ...vaults[id] })).sort((a, b) => (b.ts || 0) - (a.ts || 0));
		if (!items.length) return [el('div', { class: 'empty' }, t('No vaults yet. Fill in the form below and press "Create", or open a folder you already have.', 'Хранилищ пока нет. Заполните форму ниже и нажмите «Создать» или откройте уже существующую папку.'))];
		return items.map((v) => el('div', { class: 'row', tabindex: 0, role: 'button', title: t('Open this vault', 'Открыть это хранилище'), on: { click: () => open(v.path, false), keydown: (e) => { if (e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); open(v.path, false); } } } },
			ico('folder'),
			el('div', { class: 'main' }, el('div', { class: 'name' }, path.basename(v.path)), el('div', { class: 'path', title: v.path }, v.path)),
			el('button', {
				class: 'x', title: t('Remove from the list (the folder and notes stay on disk)', 'Убрать из списка (папка и заметки останутся на диске)'), 'aria-label': t('Remove from the list', 'Убрать из списка'),
				on: { click: (e) => { e.stopPropagation(); if (!ipcRenderer.sendSync('vault-remove', v.path)) state.error = t('This vault is open in a window. Close that window first, then remove it from the list.', 'Это хранилище открыто в окне. Сначала закройте окно, потом уберите его из списка.'); else state.error = ''; render(); } },
			}, '×')));
	}

	async function choose(then) {
		const picked = await ipcRenderer.invoke('pick-folder', state.location);
		if (picked) then(picked);
	}

	function createForm() {
		const name = el('input', { type: 'text', autofocus: true, placeholder: t('For example: Notes', 'Например: Заметки'), value: state.name, on: { input: (e) => { state.name = e.target.value; } } });
		const loc = el('input', { type: 'text', value: state.location, on: { input: (e) => { state.location = e.target.value; } } });
		const submit = () => {
			const n = state.name.trim();
			if (!n || /[\\/:*?"<>|]/.test(n)) { state.error = t('Enter a plain name without \ / : * ? " < > |.', 'Введите простое название без символов \ / : * ? " < > |.'); render(); return; }
			open(path.join(state.location, n), true);
		};
		return el('form', { class: 'create' + (state.creating ? ' open' : ''), on: { submit: (e) => { e.preventDefault(); submit(); } } },
			el('label', null, t('Vault name', 'Название хранилища'), name),
			el('label', null, t('Location', 'Расположение'), el('div', { class: 'pathrow' }, loc, el('button', { class: 'btn', type: 'button', on: { click: () => choose((p) => { state.location = p; render(); }) } }, t('Choose…', 'Выбрать…')))),
			el('div', { class: 'hint' }, t('A folder with this name will be created in the chosen location; your notes are stored in it as ordinary files.', 'В выбранном расположении появится папка с этим названием, заметки лежат в ней обычными файлами.')),
			el('div', null, el('button', { class: 'btn primary', type: 'submit' }, t('Create', 'Создать'))));
	}

	function render() {
		const version = ipcRenderer.sendSync('version');
		root.replaceChildren(el('div', { class: 'page' },
			el('div', { class: 'brand' }, el('img', { src: 'basalt-logo.png', alt: '' }), el('div', null, el('h1', null, 'Basalt'), el('small', null, t('Version ', 'Версия ') + version))),
			el('h2', null, t('Recent vaults', 'Недавние хранилища')),
			el('div', { class: 'list' }, ...vaultRows()),
			el('h2', null, t('Start', 'Начать')),
			el('div', { class: 'actions' },
				el('button', { class: 'big', title: t('A new empty folder for your notes', 'Новая пустая папка для ваших заметок'), on: { click: () => { state.creating = !state.creating; state.error = ''; render(); } } }, ico('plus'), t('Create a new vault', 'Создать хранилище')),
				el('button', { class: 'big', title: t('Use a folder with notes you already have', 'Взять папку, в которой уже лежат ваши заметки'), on: { click: () => choose((p) => open(p, false)) } }, ico('open'), t('Open a folder as vault', 'Открыть папку как хранилище')),
				el('button', { class: 'big', title: t('A ready vault with example notes to try things out', 'Готовое хранилище с примерами заметок, чтобы всё попробовать'), on: { click: () => { ipcRenderer.sendSync('sandbox'); window.close(); } } }, ico('box'), t('Open the sandbox', 'Открыть песочницу')),
				el('button', { class: 'big', title: t('How Basalt works and the main shortcuts', 'Как устроен Basalt и основные сочетания клавиш'), on: { click: () => ipcRenderer.sendSync('help') } }, ico('help'), t('Help', 'Справка'))),
			createForm(),
			el('div', { class: 'err' }, state.error),
			el('div', { class: 'foot' }, el('span', null, t('Your notes stay as plain files in the folder you pick.', 'Заметки остаются обычными файлами в выбранной папке.')))));
	}
	render();
})();
