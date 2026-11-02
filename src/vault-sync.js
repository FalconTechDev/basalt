// vault-sync: git synchronisation for the vault, a port of the ideas in FalconTechDev/synchronize.
//
// It is a careful wrapper around git, run on a timer. Nothing here is magic: the vault stays an ordinary
// git repository, a conflict stops syncing instead of being guessed at, and every rewrite is preceded by a
// backup branch. Tokens live in the app data folder, never in the vault and never in a remote URL.
(() => {
  "use strict";

  const cp = window.require("child_process");
  const fs = window.require("fs");
  const path = window.require("path");
  const os = window.require("os");

  const DEFAULT_COMMIT = "sync: auto-commit from {host} at {time}";
  const NETWORK_TIMEOUT_MS = 120000;
  const AUTO_STASH = "syn-auto-stash";
  const EXCLUDE_BEGIN = "# >>> vault-sync (managed) >>>";
  const EXCLUDE_END = "# <<< vault-sync <<<";
  const WINDOW_STATE_FILES = [".obsidian/workspace.json", ".obsidian/workspace-mobile.json", ".obsidian/workspaces.json", ".obsidian/cache", ".basalt/workspace.json", ".basalt/workspace-mobile.json", ".basalt/workspaces.json", ".basalt/cache"];

  // ------------------------------------------------------------------ storage
  const home = () => {
    const base = window.electron.remote.app.getPath("userData");
    const dir = path.join(base, "vault-sync");
    fs.mkdirSync(dir, { recursive: true });
    return dir;
  };
  const readJson = (file, fallback) => {
    try { return JSON.parse(fs.readFileSync(path.join(home(), file), "utf8")); } catch (e) { return fallback; }
  };
  const writeJson = (file, data, mode = 0o600) => {
    const target = path.join(home(), file);
    const tmp = `${target}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(data, null, 2), { mode });
    fs.renameSync(tmp, target);
  };

  const defaultConfig = () => ({
    backup: true,
    pushBackup: false,
    strategy: "rebase",
    intervalMinutes: 10,
    notify: "conflict",
    commitTemplate: DEFAULT_COMMIT,
    keepBackupDays: 14,
    telegram: { token: "", chatId: "" },
    identity: { name: "", email: "" },
    auto: { login: false, watch: false, shutdown: false },
    skipWindowState: true,
    journal: { enabled: true, delay: 3 },
    repos: [],
  });
  let cfg = defaultConfig();
  // read once the app is up: userData is not reachable while the scripts are still loading
  function loadConfig() {
    cfg = Object.assign(defaultConfig(), readJson("config.json", {}));
    cfg.auto = Object.assign({ login: false, watch: false, shutdown: false }, cfg.auto);
    cfg.telegram = Object.assign({ token: "", chatId: "" }, cfg.telegram);
    cfg.identity = Object.assign({ name: "", email: "" }, cfg.identity);
    cfg.journal = Object.assign({ enabled: true, delay: 3 }, cfg.journal);
    cfg.repos = cfg.repos || [];
  }
  const saveConfig = () => writeJson("config.json", cfg);

  let state = { conflicts: {}, lastSync: {}, lastPrune: {}, lastNag: {} };
  function loadState() {
    state = Object.assign({ conflicts: {}, lastSync: {}, lastPrune: {}, lastNag: {} }, readJson("state.json", {}));
    for (const k of ["conflicts", "lastSync", "lastPrune", "lastNag"]) state[k] = state[k] || {};
  }
  const saveState = () => writeJson("state.json", state);

  const creds = () => readJson("credentials.json", {});
  const token = () => (creds().github || {}).token || "";

  const samePath = (a, b) => {
    const x = path.resolve(a), y = path.resolve(b);
    return process.platform === "win32" ? x.toLowerCase() === y.toLowerCase() : x === y;
  };
  const vaultPath = () => app.vault.adapter.basePath;
  const findRepo = () => cfg.repos.find((r) => samePath(r.path, vaultPath()));
  const ensureRepo = () => {
    let r = findRepo();
    if (!r) {
      r = { name: path.basename(vaultPath()), path: vaultPath(), remote: "origin", branch: "", enabled: true, intervalMinutes: 0, noAutoCommit: false, noCommit: [], pausedUntil: 0, pullOnly: false, slug: "", hooks: { afterPull: [], afterPush: [], onConflict: [], timeoutSeconds: 0, rollback: false } };
      cfg.repos.push(r);
      saveConfig();
    }
    return r;
  };
  const key = (r) => r.path;
  const intervalFor = (r) => (r.intervalMinutes > 0 ? r.intervalMinutes : cfg.intervalMinutes) || 10;
  const syncsByItself = (r) => r.enabled && (!r.pausedUntil || Date.now() > r.pausedUntil);

  // ------------------------------------------------------------------ log
  const ring = [];
  const listeners = new Set();
  const logFile = () => path.join(home(), "sync.log");
  const stamp = () => new Date().toISOString().replace("T", " ").slice(0, 19);
  function log(level, msg) {
    const line = `${stamp()} [${level}] ${msg}`;
    ring.push(line);
    if (ring.length > 600) ring.shift();
    try {
      const f = logFile();
      try { if (fs.statSync(f).size > 2 * 1024 * 1024) fs.writeFileSync(f, ring.join("\n") + "\n"); } catch (e) { /* new file */ }
      fs.appendFileSync(f, line + "\n");
    } catch (e) { /* the log must never break a sync */ }
    emit("log");
  }
  const info = (m) => log("INFO", m);
  const warn = (m) => log("WARN", m);
  const errorf = (m) => log("ERROR", m);
  const debug = (m) => log("DEBUG", m);
  function emit(kind) { for (const l of listeners) { try { l(kind); } catch (e) { /* listener bug */ } } }

  // an unchanged failure is not news every ten minutes
  const repeating = new Map();
  function shouldReport(k, message) {
    const now = Date.now();
    const prev = repeating.get(k);
    if (!prev || prev.message !== message) { repeating.set(k, { message, first: now, last: now, count: 1 }); return message; }
    prev.count += 1;
    if (now - prev.last < 3600000 && prev.count !== 2) return null;
    prev.last = now;
    return `${message}\n       (то же самое уже ${prev.count} раз, с ${roughly(now - prev.first)} назад — пока ничего нового писать не буду)`;
  }
  const clearRepeat = (k) => repeating.delete(k);
  function roughly(ms) {
    const m = ms / 60000;
    if (m < 1) return "меньше минуты";
    if (m < 60) return `${Math.floor(m)} мин`;
    if (m < 1440) return `${Math.floor(m / 60)} ч`;
    return `${Math.floor(m / 1440)} дн`;
  }
  const ago = (t) => {
    if (!t) return "никогда";
    const s = (Date.now() - t) / 1000;
    if (s < 10) return "только что";
    if (s < 60) return `${Math.floor(s)} сек назад`;
    if (s < 3600) return `${Math.floor(s / 60)} мин назад`;
    if (s < 86400) return `${Math.floor(s / 3600)} ч назад`;
    return `${Math.floor(s / 86400)} дн назад`;
  };
  const plural = (n, one, few, many) => {
    const a = Math.abs(n) % 100, b = a % 10;
    return `${n} ${a > 10 && a < 20 ? many : b === 1 ? one : b >= 2 && b <= 4 ? few : many}`;
  };

  // ------------------------------------------------------------------ git
  class GitError extends Error {
    constructor(args, stderr, cause) {
      const msg = (stderr || "").trim() || (cause && cause.message) || "ошибка";
      super(`git ${args.join(" ")}: ${msg}`);
      this.args = args;
      this.stderr = stderr;
    }
  }
  const BASE_ENV = { GIT_TERMINAL_PROMPT: "0", GIT_OPTIONAL_LOCKS: "0", GIT_EDITOR: "true" };
  const touchesNetwork = (args) => ["fetch", "push", "pull", "clone", "ls-remote"].includes(args[0]);

  function git(dir, args, opts = {}) {
    const full = ["-c", "core.quotepath=false", ...args];
    const network = touchesNetwork(args);
    return new Promise((resolve, reject) => {
      cp.execFile("git", full, {
        cwd: dir, windowsHide: true, maxBuffer: 256 * 1024 * 1024, encoding: "utf8",
        env: Object.assign({}, process.env, BASE_ENV, opts.env || {}),
        timeout: network ? NETWORK_TIMEOUT_MS : 0, killSignal: "SIGKILL",
      }, (err, stdout, stderr) => {
        if (err) {
          if (err.killed && network) {
            return reject(new Error(`git ${args[0]} не ответил за ${NETWORK_TIMEOUT_MS / 1000} с — нет ответа от удалённого репозитория (сеть или VPN?)`));
          }
          if (err.code === "ENOENT") return reject(new Error("git не найден. Установите git и перезапустите приложение."));
          return reject(new GitError(args, stderr, err));
        }
        resolve(String(stdout).replace(/\s+$/, ""));
      });
    });
  }
  const gitOK = (dir, args) => git(dir, args).then(() => true, () => false);

  function authEnv(tok) {
    if (!tok) return {};
    return {
      GIT_CONFIG_COUNT: "2",
      GIT_CONFIG_KEY_0: "credential.helper", GIT_CONFIG_VALUE_0: "",
      GIT_CONFIG_KEY_1: "credential.https://github.com.helper",
      GIT_CONFIG_VALUE_1: "!f(){ echo username=oauth2; echo password=$VAULT_SYNC_TOKEN; }; f",
      VAULT_SYNC_TOKEN: tok,
    };
  }
  async function remoteURL(dir, remote) { return git(dir, ["remote", "get-url", remote]); }
  async function tokenFor(r) {
    try {
      const url = await remoteURL(r.path, r.remote);
      const host = remoteHost(url);
      return host === "github.com" && !url.startsWith("git@") ? token() : "";
    } catch (e) { return ""; }
  }
  const gitR = async (r, args) => git(r.path, args, { env: authEnv(await tokenFor(r)) });
  function remoteHost(u) {
    if (u.startsWith("git@")) { const rest = u.slice(4); const i = rest.indexOf(":"); return i >= 0 ? rest.slice(0, i) : ""; }
    try { return new URL(u).hostname; } catch (e) { return ""; }
  }
  async function identityEnv(dir) {
    if (!cfg.identity.name || !cfg.identity.email) return {};
    const n = await git(dir, ["config", "--get", "user.name"]).catch(() => "");
    const e = await git(dir, ["config", "--get", "user.email"]).catch(() => "");
    if (n && e) return {};
    return { GIT_CONFIG_COUNT: "2", GIT_CONFIG_KEY_0: "user.name", GIT_CONFIG_VALUE_0: cfg.identity.name, GIT_CONFIG_KEY_1: "user.email", GIT_CONFIG_VALUE_1: cfg.identity.email };
  }
  async function gitCommit(dir, msg) { return git(dir, ["commit", "--quiet", "-m", msg], { env: await identityEnv(dir) }); }

  const isRepo = async (dir) => (await git(dir, ["rev-parse", "--is-inside-work-tree"]).catch(() => "")) === "true";
  async function currentBranch(dir) {
    try { return await git(dir, ["symbolic-ref", "--quiet", "--short", "HEAD"]); } catch (e) {
      throw new Error("репозиторий не на ветке (detached HEAD)");
    }
  }
  const hasCommits = (dir) => gitOK(dir, ["rev-parse", "--verify", "--quiet", "HEAD"]);
  const currentCommit = (dir) => git(dir, ["rev-parse", "HEAD"]).catch(() => "");

  // porcelain -z: no quoting, rename pairs are two entries
  async function changedFiles(dir) {
    const out = await git(dir, ["status", "--porcelain=v1", "-z", "--untracked-files=all"]).catch(() => "");
    const parts = out.split("\0").filter((x) => x !== "");
    const files = [];
    for (let i = 0; i < parts.length; i++) {
      const code = parts[i].slice(0, 2), p = parts[i].slice(3);
      let label = "изменён";
      if (code === "??") label = "новый";
      else if (code[0] === "A" || code[1] === "A") label = "добавлен";
      else if (code[0] === "D" || code[1] === "D") label = "удалён";
      else if (code[0] === "R" || code[1] === "R") { label = "переименован"; i += 1; }
      files.push({ status: label, path: p, code });
    }
    return files;
  }
  const isDirty = async (dir) => (await changedFiles(dir)).length > 0;

  async function aheadBehind(dir, branch, remote) {
    const ref = `${remote}/${branch}`;
    if (!(await gitOK(dir, ["rev-parse", "--verify", "--quiet", ref]))) {
      if (!(await hasCommits(dir))) return [0, 0];
      const n = await git(dir, ["rev-list", "--count", "HEAD"]);
      return [parseInt(n, 10) || 0, 0];
    }
    const out = await git(dir, ["rev-list", "--left-right", "--count", `HEAD...${ref}`]);
    const [a, b] = out.split(/\s+/).map((x) => parseInt(x, 10) || 0);
    return [a, b];
  }
  const remoteBranchExists = (dir, remote, branch) => gitOK(dir, ["rev-parse", "--verify", "--quiet", `${remote}/${branch}`]);

  async function inProgress(dir) {
    const gd = await git(dir, ["rev-parse", "--absolute-git-dir"]).catch(() => "");
    if (!gd) return "";
    const marks = [["rebase-merge", "rebase"], ["rebase-apply", "rebase"], ["MERGE_HEAD", "merge"], ["CHERRY_PICK_HEAD", "cherry-pick"]];
    for (const [name, label] of marks) if (fs.existsSync(path.join(gd, name))) return label;
    return "";
  }
  async function conflictedFiles(dir) {
    const out = await git(dir, ["diff", "--name-only", "--diff-filter=U"]).catch(() => "");
    return out ? out.split("\n") : [];
  }
  function withMarkers(dir, files) {
    const left = [];
    for (const f of files) {
      let text;
      try { text = fs.readFileSync(path.join(dir, f), "utf8"); } catch (e) { continue; }
      if (text.startsWith("<<<<<<< ") || text.includes("\n<<<<<<< ")) left.push(f);
    }
    return left;
  }
  async function commitLog(dir, from, to, limit = 5) {
    const out = await git(dir, ["log", "--no-merges", `--max-count=${limit}`, "--pretty=format:%h  %s", `${from}..${to}`]).catch(() => "");
    return out.split("\n").map((l) => l.trim()).filter(Boolean);
  }
  async function filesBetween(dir, from, to) {
    const out = await git(dir, ["diff", "--name-status", from, to]).catch(() => "");
    if (!out) return [];
    return out.split("\n").map((line) => {
      const [s, ...p] = line.split("\t");
      const label = { A: "добавлен", D: "удалён", R: "переименован" }[s[0]] || "изменён";
      return { status: label, path: p[p.length - 1] };
    });
  }

  // ------------------------------------------------------------------ globs (held-back files)
  function globToRegex(p) {
    let re = "";
    for (let i = 0; i < p.length; i++) {
      const c = p[i];
      if (c === "*") { if (p[i + 1] === "*") { re += ".*"; i++; if (p[i + 1] === "/") i++; } else re += "[^/]*"; }
      else if (c === "?") re += "[^/]";
      else if (c === "[") { const j = p.indexOf("]", i); if (j > i) { re += p.slice(i, j + 1); i = j; } else re += "\\["; }
      else re += c.replace(/[.+^${}()|\\]/g, "\\$&");
    }
    return new RegExp(`^${re}$`);
  }
  function matchesAny(file, patterns) {
    const f = file.replace(/\\/g, "/");
    for (const raw of patterns) {
      const p = raw.trim().replace(/\\/g, "/");
      if (!p) continue;
      const re = globToRegex(p);
      if (re.test(f) || re.test(path.posix.basename(f))) return true;
      if (p.endsWith("/**") && f.startsWith(p.slice(0, -2))) return true;
    }
    return false;
  }
  function splitHeldBack(files, patterns) {
    if (!patterns || !patterns.length) return [files, []];
    const take = [], hold = [];
    for (const f of files) (matchesAny(f.path, patterns) ? hold : take).push(f);
    return [take, hold];
  }

  // ------------------------------------------------------------------ locks (one worker per repository)
  const chains = new Map();
  const lockFile = (r) => path.join(home(), `repo-${Buffer.from(key(r)).toString("hex").slice(0, 40)}.lock`);
  async function withLock(r, waitMs, fn) {
    const k = key(r);
    const prev = chains.get(k) || Promise.resolve();
    let release;
    const mine = new Promise((res) => { release = res; });
    chains.set(k, prev.then(() => mine));
    await prev;
    const file = lockFile(r);
    const deadline = Date.now() + waitMs;
    let fd = null;
    for (;;) {
      try { fd = fs.openSync(file, "wx"); fs.writeSync(fd, String(process.pid)); break; } catch (e) {
        if (e.code !== "EEXIST") { release(); throw e; }
        try { if (Date.now() - fs.statSync(file).mtimeMs > 10 * 60 * 1000) { fs.unlinkSync(file); continue; } } catch (x) { /* raced */ }
        if (Date.now() > deadline) { release(); throw new Error(`другая синхронизация уже работает с «${r.name}» — ждал ${Math.round(waitMs / 1000)} с`); }
        await new Promise((res) => setTimeout(res, 150));
      }
    }
    try { return await fn(); } finally {
      try { fs.closeSync(fd); fs.unlinkSync(file); } catch (e) { /* already gone */ }
      release();
    }
  }

  // ------------------------------------------------------------------ engine
  const hostname = () => os.hostname() || "unknown-host";
  const sanitizeRef = (s) => s.replace(/[ ~^:?*[\\]/g, "-").replace(/^[-.]+|[-.]+$/g, "");
  const fmtTime = (d = new Date()) => {
    const p = (n) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
  };
  const stampName = (d = new Date()) => {
    const p = (n) => String(n).padStart(2, "0");
    return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
  };

  async function prepare(r) {
    if (!fs.existsSync(r.path) || !(await isRepo(r.path))) throw new Error(`«${r.path}» не git-репозиторий — подключите хранилище к репозиторию в настройках синхронизации`);
    const op = await inProgress(r.path);
    if (op) throw new Error(`уже идёт ${op} — завершите его или нажмите «Отменить слияние»`);
    if (!(await hasCommits(r.path))) throw new Error("в репозитории ещё нет ни одного коммита");
    const cur = await currentBranch(r.path);
    if (r.branch && r.branch !== cur) throw new Error(`хранилище на ветке «${cur}», а закреплено за «${r.branch}»`);
    await remoteURL(r.path, r.remote).catch(() => { throw new Error(`удалённый репозиторий «${r.remote}» не настроен`); });
    return r.branch || cur;
  }

  async function backup(r, branch) {
    if (!cfg.backup) return "";
    const base = `syn/backup/${sanitizeRef(hostname())}/${sanitizeRef(branch)}/${stampName()}`;
    let name = base;
    for (let i = 2; await gitOK(r.path, ["rev-parse", "--verify", "--quiet", name]); i++) name = `${base}-${i}`;
    try { await git(r.path, ["branch", name, "HEAD"]); } catch (e) { warn(`${r.name}: не удалось создать бэкап-ветку: ${e.message}`); return ""; }
    debug(`${r.name}: бэкап-ветка ${name}`);
    if (cfg.pushBackup) {
      try { await git(r.path, ["push", "--quiet", r.remote, name], { env: authEnv(await tokenFor(r)) }); } catch (e) { warn(`${r.name}: бэкап ${name} остался локальным: ${e.message}`); }
    }
    return name;
  }

  async function autoCommit(r) {
    const files = await changedFiles(r.path);
    if (!files.length) return { committed: false, files: [] };
    if (r.noAutoCommit) {
      info(`${r.name}: ${plural(files.length, "файл оставлен", "файла оставлено", "файлов оставлено")} без коммита (автокоммит выключен)`);
      return { committed: false, files: [] };
    }
    // never commit a half-finished merge, whatever state we do or do not remember
    const left = withMarkers(r.path, files.map((f) => f.path));
    if (left.length) {
      throw new Error(`маркеры конфликта всё ещё в файлах: ${left.join(", ")}\n        ничего не закоммичено. Отредактируйте файлы — оставьте нужное и удалите строки <<<<<<< ======= >>>>>>> — потом нажмите «Я починил»`);
    }
    const [kept, held] = splitHeldBack(files, r.noCommit);
    if (held.length) {
      debug(`${r.name}: придержал ${held.length} файл(ов) от коммита`);
      if (!kept.length) return { committed: false, files: [] };
      for (const f of kept) await git(r.path, ["add", "--", f.path]);
    } else await git(r.path, ["add", "-A"]);
    if (await gitOK(r.path, ["diff", "--cached", "--quiet"])) return { committed: false, files: [] };
    const msg = (cfg.commitTemplate || DEFAULT_COMMIT).replace(/\{host\}/g, hostname()).replace(/\{time\}/g, fmtTime());
    await gitCommit(r.path, msg);
    return { committed: true, files: kept };
  }

  async function recordConflict(r, branch, backupBranch, reason, files) {
    const c = { repo: r.name, branch, backupBranch, files, reason, at: Date.now() };
    state.conflicts[key(r)] = c;
    saveState();
    errorf(`${r.name}: конфликт на ${branch} (${reason})`);
    notify("conflict", {
      title: "Синхронизация: конфликт",
      short: `${r.name} (${branch}) — откройте настройки синхронизации`,
      full: `Синхронизация: конфликт\n\nХранилище: ${r.name}\nВетка: ${branch}\nМашина: ${hostname()}\nПричина: ${reason}\nФайлы: ${files.join(", ")}\nБэкап-ветка: ${backupBranch || "(не создавалась)"}\n\nИсправьте файлы вручную и нажмите «Я починил» в настройках синхронизации.`,
    });
    emit("state");
    return c;
  }
  function clearConflict(r) {
    if (state.conflicts[key(r)]) { delete state.conflicts[key(r)]; saveState(); emit("state"); }
  }

  async function integrate(r, branch) {
    const ref = `${r.remote}/${branch}`;
    try {
      await git(r.path, cfg.strategy === "merge" ? ["merge", "--no-edit", ref] : ["rebase", ref]);
      return { conflicted: false, files: [] };
    } catch (e) {
      const files = await conflictedFiles(r.path);
      if (!files.length && !(await inProgress(r.path))) throw e;
      await git(r.path, [cfg.strategy === "merge" ? "merge" : "rebase", "--abort"]).catch(() => {});
      return { conflicted: true, files };
    }
  }

  function conflictStillOpen(r, c) {
    return new Error(`конфликт от ${fmtTime(new Date(c.at))} не разрешён, синхронизация приостановлена\n        файлы: ${c.files.join(", ")}\n        отредактируйте их и нажмите «Я починил», либо выберите сторону («Оставить моё» / «Взять удалённое»)\n        ваша работа до конфликта сохранена на ${c.backupBranch || "(бэкап-ветка не создавалась)"}`);
  }
  async function nagAboutConflict(r, c) {
    const stuck = Date.now() - c.at;
    if (stuck < 86400000) return;
    if (state.lastNag[key(r)] && Date.now() - state.lastNag[key(r)] < 86400000) return;
    state.lastNag[key(r)] = Date.now();
    saveState();
    warn(`${r.name} не синхронизируется уже ${roughly(stuck)} — конфликт всё ещё ждёт вас`);
    notify("conflict", { title: "Синхронизация стоит", short: `${r.name} не синхронизируется ${roughly(stuck)}`, full: `Синхронизация: «${r.name}» стоит ${roughly(stuck)}.\nКонфликт не разрешён всё это время.\nФайлы: ${c.files.join(", ")}` });
  }

  // one operation at a time per repository; an open conflict puts everything but its own ways out on hold
  async function runGuarded(r, allowConflict, run) {
    return withLock(r, 90000, async () => {
      const c = state.conflicts[key(r)];
      if (c && !allowConflict) {
        await nagAboutConflict(r, c);
        return { repo: r.name, remote: r.remote, path: r.path, err: conflictStillOpen(r, c) };
      }
      return run(r);
    });
  }

  const markSynced = (r) => { state.lastSync[key(r)] = Date.now(); saveState(); pruneIfDue(r); emit("state"); };

  async function pullImpl(r) {
    const res = { repo: r.name, remote: r.remote, path: r.path, committed: false, pulled: 0, pushed: 0, pulledLog: [], pushedLog: [], pulledFiles: [], committedFiles: [], backup: "" };
    try {
      const branch = await prepare(r);
      res.branch = branch;
      await gitR(r, ["fetch", "--prune", r.remote]);
      if (!(await remoteBranchExists(r.path, r.remote, branch))) { info(`${r.name}: ${r.remote}/${branch} ещё нет, тянуть нечего`); return res; }
      const [ahead, behind] = await aheadBehind(r.path, branch, r.remote);
      const dirty = await isDirty(r.path);
      if (behind === 0) { markSynced(r); return res; }
      res.pulledLog = await commitLog(r.path, "HEAD", `${r.remote}/${branch}`);
      if (ahead > 0 || dirty) res.backup = await backup(r, branch);
      let stashed = false;
      if (dirty) {
        try { await git(r.path, ["stash", "push", "--include-untracked", "-m", AUTO_STASH]); } catch (e) { throw new Error(`не удалось отложить локальные правки: ${e.message}`); }
        stashed = true;
      }
      const before = await currentCommit(r.path);
      let out;
      try { out = await integrate(r, branch); } catch (e) { if (stashed) await git(r.path, ["stash", "pop"]).catch(() => {}); throw e; }
      if (out.conflicted) {
        if (stashed) await git(r.path, ["stash", "pop"]).catch(() => {});
        res.conflict = await recordConflict(r, branch, res.backup, "ваши коммиты конфликтуют с удалённым репозиторием", out.files);
        return res;
      }
      res.pulled = behind;
      if (before) res.pulledFiles = await filesBetween(r.path, before, await currentCommit(r.path));
      if (stashed) {
        try { await git(r.path, ["stash", "pop"]); } catch (e) {
          const cf = await conflictedFiles(r.path);
          if (cf.length) { res.conflict = await recordConflict(r, branch, res.backup, "ваши несохранённые правки конфликтуют с полученными", cf); return res; }
          throw new Error(`не удалось вернуть локальные правки (они целы в «git stash list»): ${e.message}`);
        }
      }
      clearConflict(r);
      markSynced(r);
    } catch (e) { res.err = e; }
    return res;
  }

  async function pushImpl(r) {
    const res = { repo: r.name, remote: r.remote, path: r.path, committed: false, pulled: 0, pushed: 0, pulledLog: [], pushedLog: [], pulledFiles: [], committedFiles: [], backup: "" };
    try {
      const branch = await prepare(r);
      res.branch = branch;
      const ac = await autoCommit(r);
      res.committed = ac.committed; res.committedFiles = ac.files;
      await gitR(r, ["fetch", "--prune", r.remote]);
      let [ahead, behind] = await aheadBehind(r.path, branch, r.remote);
      if (ahead === 0 && behind === 0) { markSynced(r); return res; }
      if (ahead > 0 && behind > 0) res.backup = await backup(r, branch);
      if (behind > 0) {
        res.pulledLog = await commitLog(r.path, "HEAD", `${r.remote}/${branch}`);
        const beforeIntegrate = await currentCommit(r.path);
        const out = await integrate(r, branch);
        if (out.conflicted) { res.conflict = await recordConflict(r, branch, res.backup, "ваши коммиты конфликтуют с тем, что уже в удалённом репозитории", out.files); return res; }
        res.pulled = behind;
        if (beforeIntegrate) res.pulledFiles = await filesBetween(r.path, beforeIntegrate, await currentCommit(r.path));
      }
      [ahead] = await aheadBehind(r.path, branch, r.remote);
      if (ahead === 0) { markSynced(r); return res; }
      res.pushedLog = await commitLog(r.path, `${r.remote}/${branch}`, "HEAD");
      await gitR(r, ["push", r.remote, branch]);
      res.pushed = ahead;
      clearConflict(r);
      markSynced(r);
    } catch (e) { res.err = e; }
    return res;
  }

  // ---- hooks: a command on THIS machine after a sync really changed something.
  // Commands live in the app's own config and never travel through git: a push decides whether a hook runs, never what runs.
  // the same object every time: the settings screen keeps hold of it while the engine reads it
  const hooksOf = (r) => {
    const h = r.hooks || (r.hooks = {});
    for (const k of ["afterPull", "afterPush", "onConflict"]) if (!Array.isArray(h[k])) h[k] = [];
    if (typeof h.timeoutSeconds !== "number") h.timeoutSeconds = 0;
    if (typeof h.rollback !== "boolean") h.rollback = false;
    return h;
  };
  const EVENT_KEYS = { "after-pull": "afterPull", "after-push": "afterPush", "on-conflict": "onConflict" };
  const hookTimeoutMs = (r) => (hooksOf(r).timeoutSeconds > 0 ? hooksOf(r).timeoutSeconds : 300) * 1000;
  const pathsOf = (files) => (files || []).map((f) => f.path);
  // a hook that named paths sits out a sync that did not touch them; with no list to check against it runs (a deploy that fires once too often beats one that silently stops)
  const hookWants = (h, changed) => !h.paths || !h.paths.length || !changed.length || changed.some((f) => matchesAny(f, h.paths));

  function decodeConsole(buf) {
    try { return new TextDecoder("utf-8", { fatal: true }).decode(buf); } catch (e) { /* a legacy console code page */ }
    try { return new TextDecoder(process.platform === "win32" ? "ibm866" : "utf-8").decode(buf); } catch (e) { return buf.toString(); }
  }
  function tailLines(text, max = 20) {
    const lines = text.split(/\r?\n/).map((l) => l.replace(/[ \t]+$/, "")).filter(Boolean);
    return lines.length > max ? [`... ещё ${lines.length - max} ранних строк опущено`, ...lines.slice(-max)] : lines;
  }
  function runShell(command, cwd, env, timeoutMs) {
    return new Promise((resolve) => {
      const start = Date.now();
      const win = process.platform === "win32";
      const child = win
        ? cp.spawn("cmd", ["/s", "/c", command], { cwd, env, windowsHide: true, windowsVerbatimArguments: true })
        : cp.spawn("sh", ["-c", command], { cwd, env, detached: true });
      const chunks = [];
      let timedOut = false;
      child.stdout.on("data", (d) => chunks.push(d));
      child.stderr.on("data", (d) => chunks.push(d));
      const killTree = () => {
        try { if (win) cp.execFile("taskkill", ["/pid", String(child.pid), "/T", "/F"], { windowsHide: true }, () => {}); else process.kill(-child.pid, "SIGKILL"); } catch (e) { /* already gone */ }
      };
      const timer = setTimeout(() => { timedOut = true; killTree(); }, timeoutMs);
      child.on("error", (e) => { clearTimeout(timer); resolve({ command, output: [], duration: Date.now() - start, err: e }); });
      child.on("close", (code) => {
        clearTimeout(timer);
        const out = tailLines(decodeConsole(Buffer.concat(chunks)));
        resolve({ command, output: out, duration: Date.now() - start, err: timedOut ? new Error(`не уложился в ${Math.round(timeoutMs / 1000)} с`) : code === 0 ? null : new Error(`код выхода ${code}`) });
      });
    });
  }
  async function hookEnv(r, hi) {
    const branch = await currentBranch(r.path).catch(() => "");
    const base = { SYN_EVENT: hi.event, SYN_REPO: r.name, SYN_PATH: r.path, SYN_BRANCH: branch, SYN_COMMIT: hi.commit || "", SYN_PREV_COMMIT: hi.prev || "", SYN_CHANGED_FILES: hi.changed.join("\n"), SYN_CHANGED_COUNT: String(hi.changed.length) };
    // the same facts under the app's own name
    const env = Object.assign({}, process.env, base);
    for (const [k, v] of Object.entries(base)) env["BASALT_" + k.slice(4)] = v;
    return env;
  }
  async function runHooks(r, hi, list) {
    if (!list || !list.length) return [];
    const wanted = list.filter((h) => hookWants(h, hi.changed));
    for (const h of list) if (!wanted.includes(h)) debug(`${r.name}: хук ${hi.event} пропущен, ничего из ${(h.paths || []).join(", ")} не менялось: ${h.run}`);
    if (!wanted.length) return [];
    info(`${r.name}: запускаю ${plural(wanted.length, "хук", "хука", "хуков")} ${hi.event}`);
    const env = await hookEnv(r, hi);
    const runs = [];
    for (const h of wanted) {
      const run = await runShell(h.run, r.path, env, hookTimeoutMs(r));
      runs.push(run);
      if (run.err) {
        errorf(`${r.name}: хук ${hi.event} упал через ${run.duration} мс: ${h.run}\n       ${run.err.message}${run.output.map((l) => `\n       ${l}`).join("")}`);
        break;
      }
      info(`${r.name}: хук ${hi.event} в порядке за ${run.duration} мс: ${h.run}${run.output.map((l) => `\n       ${l}`).join("")}`);
    }
    return runs;
  }
  // a deployed copy should keep running the old code if the new code's hook fails
  async function rollbackPull(r, before, res, what) {
    if (!before) { errorf(`${r.name}: ${what} упал, но коммита для отката нет`); return; }
    if ((await changedFiles(r.path)).length) {
      errorf(`${r.name}: ${what} упал, но в рабочих файлах есть несохранённые правки,\n       откат пропущен, чтобы их не потерять. Откатитесь вручную: git reset --hard ${before.slice(0, 8)}`);
      return;
    }
    try { await git(r.path, ["reset", "--hard", before]); } catch (e) { errorf(`${r.name}: ${what} упал и откат тоже: ${e.message}`); return; }
    warn(`${r.name}: ${what} упал — откатился на ${before.slice(0, 8)}`);
    res.rolledBack = true;
    res.err = new Error(`${what} упал; получение откатено на ${before.slice(0, 8)}`);
  }
  async function runWithHooks(r, allowConflict, run) {
    return runGuarded(r, allowConflict, async () => {
      const hooks = hooksOf(r);
      const before = await currentCommit(r.path);
      const info0 = async (event, changed) => ({ event, commit: await currentCommit(r.path), prev: before, changed });
      const res = await run(r);
      if (res.conflict) { await runHooks(r, await info0("on-conflict", res.conflict.files), hooks.onConflict); return res; }
      if (res.err) return res;
      const firePull = res.pulled > 0 && hooks.afterPull.length > 0;
      const firePush = res.pushed > 0 && hooks.afterPush.length > 0;
      if (!firePull && !firePush) return res;
      // say what happened first, so the hook output does not read as if it ran before the sync
      info(detail(res));
      res.summaryLogged = true;
      if (firePull) {
        const runs = await runHooks(r, await info0("after-pull", pathsOf(res.pulledFiles)), hooks.afterPull);
        if (hooks.rollback && runs.some((x) => x.err)) { await rollbackPull(r, before, res, "хук after-pull"); return res; }
      }
      // a failed after-push hook is not rolled back: the commits are already published and may be pulled elsewhere
      if (firePush) await runHooks(r, await info0("after-push", pathsOf(res.committedFiles)), hooks.afterPush);
      return res;
    });
  }
  async function runHooksNow(r, event) {
    const key0 = EVENT_KEYS[event];
    if (!key0) throw new Error("событие должно быть after-pull, after-push или on-conflict");
    const list = hooksOf(r)[key0];
    if (!list.length) throw new Error(`у «${r.name}» нет хуков ${event}`);
    const head = await currentCommit(r.path);
    const runs = await runHooks(r, { event, commit: head, prev: head, changed: [] }, list);
    const bad = runs.find((x) => x.err);
    if (bad) throw new Error(`хук упал: ${bad.command}: ${bad.err.message}`);
    return runs;
  }

  const pull = (r) => runWithHooks(r, false, pullImpl);
  const push = (r) => (r.pullOnly ? Promise.resolve(deployTarget(r)) : runWithHooks(r, false, pushImpl));
  function deployTarget(r) { info(`${r.name}: режим «только скачивать» — отсюда ничего не публикуется`); return { repo: r.name, remote: r.remote, path: r.path, pullOnly: true }; }
  async function sync(r) {
    const p = await pull(r);
    if (p.err || p.conflict) return p;
    if (r.pullOnly) return p;
    const q = await push(r);
    q.pulled = (q.pulled || 0) + (p.pulled || 0);
    if (!q.backup) q.backup = p.backup;
    if (p.pulledFiles && p.pulledFiles.length) q.pulledFiles = p.pulledFiles;
    return q;
  }

  const ok = (res) => !res.err && !res.conflict;
  function summary(res) {
    if (res.err) return `${res.repo}: ОШИБКА — ${res.err.message}`;
    if (res.conflict) return `${res.repo}: КОНФЛИКТ на ${res.branch} (${res.conflict.files.join(", ")}) — бэкап-ветка ${res.conflict.backupBranch || "—"}`;
    if (res.pullOnly) return `${res.repo}: режим «только скачивать»`;
    const parts = [];
    if (res.committed) parts.push("закоммитил локальные правки");
    if (res.pulled > 0) parts.push(`получил ${plural(res.pulled, "коммит", "коммита", "коммитов")}`);
    if (res.pushed > 0) parts.push(`отправил ${plural(res.pushed, "коммит", "коммита", "коммитов")}`);
    if (!parts.length) parts.push(`всё актуально с ${res.remote}/${res.branch || ""}`);
    return `${res.repo}: ${parts.join(", ")}`;
  }
  function detail(res) {
    let s = summary(res);
    for (const l of res.pulledLog || []) s += `\n           вниз  ${l}`;
    for (const f of (res.pulledFiles || []).slice(0, 12)) s += `\n                 ${f.status.padEnd(12)} ${f.path}`;
    for (const l of res.pushedLog || []) s += `\n           вверх ${l}`;
    for (const f of (res.committedFiles || []).slice(0, 12)) s += `\n                 ${f.status.padEnd(12)} ${f.path}`;
    return s;
  }
  function report(r, res) {
    if (res.err) { const line = shouldReport(key(r), summary(res)); if (line) errorf(line); }
    else if (!res.conflict) { clearRepeat(key(r)); if (!res.summaryLogged) info(detail(res)); }
    return res;
  }

  // -------- resolving a conflict
  async function takeSide(r, files, mode) {
    // an unmerged stash flips git's sides: stage 2 is what we just pulled, stage 3 the set-aside edit
    const flag = mode === "theirs" ? "--ours" : "--theirs";
    for (const f of files) {
      try { await git(r.path, ["checkout", flag, "--", f]); await git(r.path, ["add", "--", f]); } catch (e) {
        try { if (mode === "ours") await git(r.path, ["add", "--", f]); else await git(r.path, ["rm", "--force", "--quiet", "--", f]); } catch (x) { throw new Error(`не удалось разрешить ${f}: ${x.message}`); }
      }
    }
  }
  async function dropAutoStash(r) {
    const out = await git(r.path, ["stash", "list", "--format=%gd %gs"]).catch(() => "");
    for (const line of out.split("\n")) {
      if (!line.includes(AUTO_STASH)) continue;
      await git(r.path, ["stash", "drop", line.split(/\s+/)[0]]).catch(() => {});
      return;
    }
  }
  async function replay(r, branch, mode) {
    if (!branch) branch = await currentBranch(r.path);
    await gitR(r, ["fetch", "--prune", r.remote]);
    const ref = `${r.remote}/${branch}`;
    const merge = cfg.strategy === "merge";
    const args = merge ? ["merge", "--no-edit"] : ["rebase"];
    if (mode === "ours") args.push(merge ? "-Xours" : "-Xtheirs");
    if (mode === "theirs") args.push(merge ? "-Xtheirs" : "-Xours");
    args.push(ref);
    try { await git(r.path, args); return false; } catch (e) {
      if ((await conflictedFiles(r.path)).length || (await inProgress(r.path))) return true;
      throw e;
    }
  }
  async function resolve(r, mode) {
    return runGuarded(r, true, async () => {
      const res = { repo: r.name };
      try {
        const op = await inProgress(r.path);
        if (op) {
          if (mode === "abort") { await git(r.path, [op, "--abort"]); info(`${r.name}: прервал идущий ${op}`); clearConflict(r); return res; }
          await git(r.path, ["add", "-A"]);
          try { await git(r.path, [op, "--continue"]); } catch (e) {
            const files = await conflictedFiles(r.path);
            if (files.length) throw new Error(`всё ещё конфликт: ${files.join(", ")}`);
            throw e;
          }
          info(`${r.name}: завершил ${op}`);
        }
        if (mode === "abort") { clearConflict(r); return res; }
        const files = await conflictedFiles(r.path);
        if (files.length) {
          if (mode === "ours" || mode === "theirs") {
            await takeSide(r, files, mode);
            info(`${r.name}: оставил ${mode === "ours" ? "вашу" : "удалённую"} сторону в ${files.join(", ")}`);
            clearConflict(r);
          } else {
            const markers = withMarkers(r.path, files);
            if (markers.length) throw new Error(`маркеры конфликта всё ещё в файлах: ${markers.join(", ")}\n        оставьте нужное, удалите строки <<<<<<< ======= >>>>>>> и нажмите «Я починил» снова, либо возьмите одну сторону целиком`);
            for (const f of files) await git(r.path, ["add", "--", f]);
            info(`${r.name}: маркеры в ${files.join(", ")} убраны`);
            clearConflict(r);
            await dropAutoStash(r);
          }
        } else if (!op && state.conflicts[key(r)]) {
          const c = state.conflicts[key(r)];
          if (await replay(r, c.branch, mode)) {
            res.err = new Error(`маркеры конфликта теперь в рабочих файлах (${(await conflictedFiles(r.path)).join(", ")}) — исправьте и нажмите «Я починил»`);
            return res;
          }
        }
        clearConflict(r);
      } catch (e) { res.err = e; return res; }
      // runGuarded holds the lock; run the sync outside of it
      return Object.assign(res, { thenSync: true });
    }).then(async (res) => (res.thenSync && !res.err ? sync(r) : res));
  }

  async function undoLastCommit(r) {
    return withLock(r, 30000, async () => {
      const branch = await prepare(r);
      const subject = await git(r.path, ["log", "-1", "--pretty=format:%s"]);
      const prefix = (cfg.commitTemplate || DEFAULT_COMMIT).split("{")[0].trim();
      if (!prefix || !subject.startsWith(prefix)) throw new Error(`последний коммит «${subject}» сделан не синхронизацией — откатывайте его вручную`);
      const safety = await backup(r, branch);
      await git(r.path, ["reset", "--soft", "HEAD~1"]);
      await git(r.path, ["reset"]);
      info(`${r.name}: откатил «${subject}» — изменения остались в файлах${safety ? `; коммит на ${safety}` : ""}`);
      const head = await currentCommit(r.path);
      const onRemote = await git(r.path, ["branch", "--remotes", "--contains", head]).catch(() => "");
      return { subject, safety, wasPushed: false || onRemote.includes(`${r.remote}/`) };
    });
  }

  async function backups(r) {
    const out = await git(r.path, ["for-each-ref", "--sort=-creatordate", "--format=%(refname:short)|%(creatordate:unix)", "refs/heads/syn/backup"]).catch(() => "");
    return out ? out.split("\n").map((l) => { const [name, ts] = l.split("|"); return { name, at: parseInt(ts, 10) * 1000 }; }) : [];
  }
  async function restoreBackup(r, name) {
    return withLock(r, 60000, async () => {
      const branch = await prepare(r);
      if (!(await gitOK(r.path, ["rev-parse", "--verify", "--quiet", name]))) throw new Error(`нет такой бэкап-ветки: ${name}`);
      if (await isDirty(r.path)) await autoCommit(r);
      const safety = await backup(r, branch);
      await git(r.path, ["reset", "--hard", name]);
      info(`${r.name}: ${branch} восстановлена из ${name} (прежнее состояние на ${safety})`);
    });
  }
  async function pruneBackups(r, days) {
    if (days == null || days < 0) days = cfg.keepBackupDays;
    if (!days || days <= 0) return 0;
    const cutoff = Date.now() - days * 86400000;
    let n = 0;
    for (const b of await backups(r)) {
      if (b.at > cutoff) continue;
      if (await gitOK(r.path, ["branch", "-D", b.name])) {
        n++;
        if (await gitOK(r.path, ["rev-parse", "--verify", "--quiet", `${r.remote}/${b.name}`])) {
          await git(r.path, ["push", "--quiet", r.remote, "--delete", b.name], { env: authEnv(await tokenFor(r)) }).catch((e) => warn(`${b.name} всё ещё на ${r.remote}: ${e.message}`));
        }
      }
    }
    return n;
  }
  async function pruneIfDue(r) {
    if (!cfg.keepBackupDays || cfg.keepBackupDays <= 0) return;
    if (state.lastPrune[key(r)] && Date.now() - state.lastPrune[key(r)] < 86400000) return;
    state.lastPrune[key(r)] = Date.now();
    saveState();
    try { const n = await pruneBackups(r, -1); if (n > 0) info(`${r.name}: удалил ${plural(n, "старую бэкап-ветку", "старые бэкап-ветки", "старых бэкап-веток")}`); } catch (e) { debug(`${r.name}: чистка бэкапов: ${e.message}`); }
  }

  // -------- status
  async function status(r, fetchFirst = false) {
    const st = { repo: r, conflict: state.conflicts[key(r)] || null, lastSync: state.lastSync[key(r)] || 0 };
    try {
      if (!fs.existsSync(r.path) || !(await isRepo(r.path))) { st.notRepo = true; return st; }
      st.inProgress = await inProgress(r.path);
      st.hasCommits = await hasCommits(r.path);
      st.branch = st.hasCommits ? await currentBranch(r.path) : (await git(r.path, ["symbolic-ref", "--short", "HEAD"]).catch(() => ""));
      st.url = await remoteURL(r.path, r.remote).catch(() => "");
      if (fetchFirst && st.url) await gitR(r, ["fetch", "--prune", r.remote]);
      st.changed = await changedFiles(r.path);
      if (st.hasCommits && st.branch) [st.ahead, st.behind] = await aheadBehind(r.path, r.branch || st.branch, r.remote);
      else { st.ahead = 0; st.behind = 0; }
    } catch (e) { st.err = e; }
    return st;
  }

  // -------- connecting a vault to a remote
  function slugFromUrl(u) {
    const m = /github\.com[:/]+([^/]+\/[^/]+?)(?:\.git)?\/?$/.exec(u);
    return m ? m[1] : "";
  }
  function cleanUrl(u) {
    u = u.trim();
    if (/^https?:\/\/[^/@]+@/.test(u)) throw new Error("не вставляйте токен в адрес — войдите через токен GitHub выше, он хранится отдельно");
    return u;
  }
  async function applyExcludes(r) {
    const gd = await git(r.path, ["rev-parse", "--absolute-git-dir"]);
    const file = path.join(gd, "info", "exclude");
    fs.mkdirSync(path.dirname(file), { recursive: true });
    let text = "";
    try { text = fs.readFileSync(file, "utf8"); } catch (e) { /* none yet */ }
    const re = new RegExp(`${EXCLUDE_BEGIN.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}[\\s\\S]*?${EXCLUDE_END.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\n?`);
    text = text.replace(re, "");
    if (cfg.skipWindowState) {
      text = text.replace(/\n*$/, "\n") + `${EXCLUDE_BEGIN}\n${WINDOW_STATE_FILES.join("\n")}\n${EXCLUDE_END}\n`;
      // an exclude does not untrack: take already-tracked ones out of the index (the files stay on disk)
      for (const f of WINDOW_STATE_FILES) {
        if (await gitOK(r.path, ["ls-files", "--error-unmatch", "--", f])) await git(r.path, ["rm", "--cached", "-r", "--quiet", "--", f]).catch(() => {});
      }
    }
    fs.writeFileSync(file, text);
  }
  async function connect(url, branchName) {
    const r = ensureRepo();
    url = cleanUrl(url);
    if (!(await isRepo(r.path))) { await git(r.path, ["init", "-b", branchName || "main"]); info(`${r.name}: создал git-репозиторий`); }
    const remotes = (await git(r.path, ["remote"]).catch(() => "")).split("\n").filter(Boolean);
    if (remotes.includes(r.remote)) await git(r.path, ["remote", "set-url", r.remote, url]); else await git(r.path, ["remote", "add", r.remote, url]);
    r.slug = slugFromUrl(url);
    saveConfig();
    await applyExcludes(r);
    await gitR(r, ["fetch", "--prune", r.remote]);
    const branch = branchName || (await git(r.path, ["symbolic-ref", "--short", "HEAD"]).catch(() => "main"));
    if (await remoteBranchExists(r.path, r.remote, branch)) {
      if (!(await hasCommits(r.path))) {
        // adopt the remote history without touching the files: whatever differs shows up as local changes
        await git(r.path, ["reset", "--mixed", `${r.remote}/${branch}`]);
        await git(r.path, ["branch", "--set-upstream-to", `${r.remote}/${branch}`, branch]).catch(() => {});
        info(`${r.name}: взял историю ${r.remote}/${branch}; отличия ваших файлов — это локальные правки`);
      }
    } else if (!(await hasCommits(r.path))) {
      await git(r.path, ["add", "-A"]);
      if (!(await gitOK(r.path, ["diff", "--cached", "--quiet"]))) await gitCommit(r.path, (cfg.commitTemplate || DEFAULT_COMMIT).replace(/\{host\}/g, hostname()).replace(/\{time\}/g, fmtTime()));
    }
    emit("state");
    return r;
  }
  // GitHub API over Node's https, not fetch: the renderer's fetch is subject to CORS and the app:// origin, this is not.
  function ghRequest(method, apiPath, tok, body) {
    const https = window.require("https");
    return new Promise((resolve, reject) => {
      const data = body ? JSON.stringify(body) : null;
      const req = https.request({
        method, hostname: "api.github.com", path: apiPath, timeout: 20000,
        headers: Object.assign({ Authorization: `Bearer ${tok}`, Accept: "application/vnd.github+json", "User-Agent": "Basalt-vault-sync", "X-GitHub-Api-Version": "2022-11-28" },
          data ? { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(data) } : {}),
      }, (res) => {
        let buf = "";
        res.setEncoding("utf8");
        res.on("data", (c) => { buf += c; });
        res.on("end", () => { let json = {}; try { json = buf ? JSON.parse(buf) : {}; } catch (e) { /* not json */ } resolve({ status: res.statusCode, json }); });
      });
      req.on("timeout", () => req.destroy(new Error("GitHub не ответил за 20 с (сеть или VPN?)")));
      req.on("error", (e) => reject(new Error(`не удалось связаться с GitHub: ${e.message}`)));
      if (data) req.write(data);
      req.end();
    });
  }
  async function githubUser(tok) {
    const res = await ghRequest("GET", "/user", tok);
    if (res.status < 200 || res.status >= 300) throw new Error(res.status === 401 ? "токен не подошёл (401)" : `GitHub ответил ${res.status}${res.json.message ? ": " + res.json.message : ""}`);
    return res.json;
  }
  async function githubCreateRepo(name, isPrivate) {
    if (!name) throw new Error("введите имя репозитория");
    const res = await ghRequest("POST", "/user/repos", token(), { name, private: !!isPrivate, description: "Basalt vault (vault-sync)" });
    if (res.status < 200 || res.status >= 300) {
      const detail = (res.json.errors && res.json.errors[0] && res.json.errors[0].message) || "";
      throw new Error(`GitHub: ${res.status} ${res.json.message || ""}${detail ? " (" + detail + ")" : ""}${res.status === 403 || res.status === 404 ? ". Токену нужны права repo (classic) или Administration: write (fine-grained)" : ""}`);
    }
    return res.json;
  }

  // ------------------------------------------------------------------ notifications
  function notify(kind, alert) {
    if (cfg.notify === "off") return;
    if (kind !== "conflict" && cfg.notify !== "all") return;
    try { new window.Notice(alert.short || alert.title, 12000); } catch (e) { /* UI not ready */ }
    try { new Notification(alert.title, { body: alert.short || "" }); } catch (e) { /* no OS permission */ }
    if (cfg.telegram.token && cfg.telegram.chatId) {
      fetch(`https://api.telegram.org/bot${cfg.telegram.token}/sendMessage`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chat_id: cfg.telegram.chatId, text: alert.full || alert.short }),
      }).catch((e) => debug(`telegram: ${e.message}`));
    }
  }

  // ------------------------------------------------------------------ watcher
  const watcher = { timer: null, busy: false, started: 0, next: {} };
  async function tick() {
    if (watcher.busy) return;
    const r = findRepo();
    if (!r || !syncsByItself(r)) return;
    const due = watcher.next[key(r)] || 0;
    if (Date.now() < due) return;
    watcher.next[key(r)] = Date.now() + intervalFor(r) * 60000;
    watcher.busy = true;
    setBusy(true);
    try {
      const res = report(r, await sync(r));
      if (cfg.notify === "all" && (res.pulled > 0 || res.pushed > 0)) notify("sync", { title: "Синхронизация", short: summary(res) });
      lastResult = res;
    } finally { watcher.busy = false; setBusy(false); }
  }
  function startWatcher() {
    stopWatcher();
    if (!cfg.auto.watch) return;
    watcher.started = Date.now();
    const r = findRepo();
    if (r) watcher.next[key(r)] = Date.now() + intervalFor(r) * 60000;
    watcher.timer = setInterval(() => tick().catch((e) => errorf(`watcher: ${e.message}`)), 5000);
    info(`наблюдатель запущен: каждые ${intervalFor(r || {})} мин`);
  }
  function stopWatcher() { if (watcher.timer) { clearInterval(watcher.timer); watcher.timer = null; } }

  let lastResult = null;
  async function runManual(op) {
    const r = findRepo();
    if (!r) throw new Error("синхронизация для этого хранилища не настроена");
    setBusy(true);
    try {
      const res = report(r, await op(r));
      lastResult = res;
      return res;
    } finally { setBusy(false); }
  }

  // ------------------------------------------------------------------ status bar
  let barEl = null, busy = false;
  function setBusy(v) { busy = v; renderBar(); emit("busy"); }
  async function renderBar() {
    if (!barEl) return;
    const r = findRepo();
    let text = "Синхр.: не настроена", title = "Нажмите, чтобы настроить синхронизацию с git";
    if (r) {
      const c = state.conflicts[key(r)];
      if (busy) { text = "⟳ Синхронизация…"; title = "Идёт синхронизация"; }
      else if (c) { text = "⚠ Конфликт"; title = `Конфликт: ${c.files.join(", ")}. Нажмите, чтобы разрешить.`; }
      else if (!syncsByItself(r) && r.enabled === false) { text = "Синхр.: выкл"; title = "Синхронизация этого хранилища выключена"; }
      else {
        const last = state.lastSync[key(r)];
        text = `⟳ ${last ? ago(last) : "ещё не было"}`;
        title = `Последняя синхронизация: ${last ? new Date(last).toLocaleString() : "никогда"}. Нажмите — синхронизировать сейчас; правый клик — настройки.`;
      }
    }
    barEl.textContent = text;
    barEl.setAttribute("aria-label", title);
    barEl.title = title;
    barEl.classList.toggle("vs-conflict", !!(r && state.conflicts[key(r)]));
  }

  // ------------------------------------------------------------------ settings UI (replaces the paid Sync tab)
  const h = (tag, attrs, ...kids) => {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (k === "class") el.className = v; else if (k === "text") el.textContent = v;
      else if (k.startsWith("on")) el.addEventListener(k.slice(2), v); else if (v !== false && v != null) el.setAttribute(k, v === true ? "" : v);
    }
    for (const kid of kids.flat()) if (kid != null) el.append(kid.nodeType ? kid : document.createTextNode(kid));
    return el;
  };
  const group = (title, hint) => {
    const g = h("div", { class: "setting-group" });
    g.append(h("div", { class: "setting-item setting-item-heading" }, h("div", { class: "setting-item-name", text: title })));
    if (hint) g.append(h("div", { class: "setting-item-description vs-hint", text: hint }));
    const items = h("div", { class: "setting-items" });
    g.append(items);
    g.items = items;
    return g;
  };
  const row = (name, desc, ...controls) => {
    const info = h("div", { class: "setting-item-info" }, h("div", { class: "setting-item-name", text: name }));
    if (desc) info.append(h("div", { class: "setting-item-description", text: desc }));
    const control = h("div", { class: "setting-item-control" }, ...controls);
    const item = h("div", { class: "setting-item" }, info, control);
    // several buttons would squeeze the text away: give the text its own line instead
    if (controls.filter(Boolean).length >= 3) {
      item.style.flexWrap = "wrap";
      info.style.flexBasis = "100%";
      info.style.marginInlineEnd = "0";
      control.style.justifyContent = "flex-start";
      control.style.flexWrap = "wrap";
      control.style.flex = "1 1 100%";
    }
    return item;
  };
  const btn = (label, onclick, cta) => { const b = h("button", { class: cta ? "mod-cta" : "", text: label }); b.addEventListener("click", async () => { b.disabled = true; try { await onclick(); } catch (e) { toast(e.message); } finally { b.disabled = false; ui.refresh(); } }); return b; };
  const toggle = (value, onchange) => {
    const box = h("div", { class: "checkbox-container" + (value ? " is-enabled" : ""), tabindex: "0" }, h("input", { type: "checkbox", tabindex: "0" }));
    box.addEventListener("click", () => { const v = !box.classList.contains("is-enabled"); box.classList.toggle("is-enabled", v); onchange(v); });
    return box;
  };
  const select = (value, options, onchange) => {
    const s = h("select", { class: "dropdown" }, options.map(([v, l]) => { const o = h("option", { value: v, text: l }); if (String(v) === String(value)) o.selected = true; return o; }));
    s.addEventListener("change", () => onchange(s.value));
    return s;
  };
  const input = (value, onchange, opts = {}) => {
    const i = h("input", { type: opts.type || "text", spellcheck: "false", placeholder: opts.placeholder || "" });
    i.value = value == null ? "" : value;
    if (opts.width) i.style.width = opts.width;
    i.addEventListener("change", () => onchange(i.value));
    return i;
  };
  const textarea = (value, onchange) => {
    const t = h("textarea", { spellcheck: "false", rows: "4" });
    t.value = value;
    t.style.width = "260px";
    t.addEventListener("change", () => onchange(t.value));
    return t;
  };
  function toast(msg) { try { new window.Notice(msg, 9000); } catch (e) { /* UI not ready */ } }

  const ui = {
    el: null,
    refresh() { if (this.el && this.el.isConnected) renderSettings(this.el); },
  };

  async function renderSettings(el) {
    ui.el = el;
    const token0 = ++renderToken;
    const r = findRepo();
    const st = r ? await status(r) : null;
    if (token0 !== renderToken) return;
    const logLines = ring.slice(-40);
    const out = h("div", { class: "vault-sync-settings" });

    // ---- state
    const g0 = group("Состояние");
    if (!r || st.notRepo) {
      g0.items.append(row("Хранилище не подключено", `«${vaultPath()}» ${st && st.notRepo ? "ещё не git-репозиторий" : "не настроено"}. Подключите его к репозиторию ниже — файлы при этом не меняются.`));
    } else {
      const bits = [];
      bits.push(`ветка ${st.branch || "—"} → ${r.remote}${st.url ? ` (${st.url.replace(/^https?:\/\//, "")})` : ""}`);
      bits.push(`локально: ${st.changed && st.changed.length ? plural(st.changed.length, "несохранённое изменение", "несохранённых изменения", "несохранённых изменений") : "чисто"}`);
      bits.push(`относительно удалённого: ${st.ahead || 0} вперёд, ${st.behind || 0} назад`);
      bits.push(`последняя синхронизация: ${state.lastSync[key(r)] ? `${new Date(state.lastSync[key(r)]).toLocaleString()} (${ago(state.lastSync[key(r)])})` : "ещё не было"}`);
      if (cfg.auto.watch && watcher.timer && syncsByItself(r)) bits.push(`следующая проверка: ${watcher.next[key(r)] ? new Date(watcher.next[key(r)]).toLocaleTimeString() : "скоро"}`);
      if (st.inProgress) bits.push(`внимание: идёт ${st.inProgress}`);
      if (st.err) bits.push(`ошибка: ${st.err.message}`);
      g0.items.append(row("Репозиторий", bits.join("\n")));
      g0.items.lastChild.querySelector(".setting-item-description").style.whiteSpace = "pre-line";
      if (st.conflict) {
        const c = st.conflict;
        const d = row("Конфликт", `${c.reason}\nфайлы: ${c.files.join(", ")}\nбэкап: ${c.backupBranch || "—"}\nСинхронизация стоит, пока вы не решите: правки не будут закоммичены и отправлены.`,
          btn("Я починил", async () => { const res = await runManual((x) => resolve(x, "")); toast(summary(res)); }, true),
          btn("Оставить моё", async () => { toast(summary(await runManual((x) => resolve(x, "ours")))); }),
          btn("Взять удалённое", async () => { toast(summary(await runManual((x) => resolve(x, "theirs")))); }),
          btn("Отменить слияние", async () => { await runManual((x) => resolve(x, "abort")); }));
        d.querySelector(".setting-item-description").style.whiteSpace = "pre-line";
        d.classList.add("vs-conflict-row");
        g0.items.append(d);
      }
      g0.items.append(row("Сейчас", "Что-то одно за раз: синхронизация идёт по очереди для каждого хранилища.",
        btn("Синхронизировать", async () => { toast(summary(await runManual(sync))); }, true),
        btn("Только скачать", async () => { toast(summary(await runManual(pull))); }),
        btn("Только отправить", async () => { toast(summary(await runManual(push))); }),
        btn("Проверить (fetch)", async () => { await status(r, true); toast("Проверил удалённый репозиторий"); }),
        btn("Лента версий", async () => { await showVaultFeed(); })));
    }
    out.append(g0);

    // ---- account
    const creds0 = creds().github || {};
    const g1 = group("Аккаунт GitHub", "Токен лежит в папке данных приложения (не в хранилище) и никогда не попадает в адрес репозитория. Классический токен: права repo. Fine-grained: Contents read/write.");
    let tokenInput = input("", () => {}, { type: "password", placeholder: creds0.token ? "токен сохранён" : "ghp_...", width: "220px" });
    g1.items.append(row(creds0.login ? `Вы вошли как ${creds0.login}` : "Токен доступа",
      creds0.login ? "Другой токен можно ввести поле ниже." : "Нужен для приватных репозиториев на GitHub. Для чужих публичных не обязателен.",
      tokenInput,
      btn("Войти", async () => {
        const t = tokenInput.value.trim();
        if (!t) throw new Error("вставьте токен");
        const u = await githubUser(t);
        writeJson("credentials.json", Object.assign(creds(), { github: { token: t, login: u.login } }));
        info(`вошёл в GitHub как ${u.login}`);
        toast(`Вы вошли как ${u.login}`);
      }, true),
      creds0.token ? btn("Выйти", async () => { const c = creds(); delete c.github; writeJson("credentials.json", c); toast("Токен удалён"); }) : null));
    out.append(g1);

    // ---- repository
    const g2 = group("Репозиторий");
    let urlInput = input(st && st.url ? st.url : "", () => {}, { placeholder: "https://github.com/owner/name.git", width: "300px" });
    g2.items.append(row("Адрес удалённого репозитория", "Подключение не меняет ваши файлы: если в удалённом репозитории уже есть история, она принимается, а отличия ваших файлов становятся локальными правками.",
      urlInput,
      btn(r && st && !st.notRepo ? "Сменить адрес" : "Подключить", async () => {
        const rr = await connect(urlInput.value, r && r.branch ? r.branch : "");
        toast(`Подключено: ${rr.name}`);
      }, true)));
    let newName = input(path.basename(vaultPath()).replace(/[^\w.-]+/g, "-"), () => {}, { width: "160px" });
    let privSel = select("1", [["1", "приватный"], ["0", "публичный"]], () => {});
    g2.items.append(row("Создать репозиторий на GitHub", "Создаст новый репозиторий под вашим аккаунтом и подключит к нему это хранилище.",
      newName, privSel,
      btn("Создать", async () => {
        if (!token()) throw new Error("сначала войдите по токену выше");
        const info0 = await githubCreateRepo(newName.value.trim(), privSel.value === "1");
        await connect(info0.clone_url, "");
        toast(`Создан ${info0.full_name}`);
      })));
    if (r) {
      g2.items.append(row("Ветка", "Пусто — синхронизировать ту, на которой вы сейчас. Если задать, синхронизация откажется работать на другой ветке.", input(r.branch, (v) => { r.branch = v.trim(); saveConfig(); }, { width: "140px" })));
      g2.items.append(row("Не синхронизировать состояние окон", "workspace.json и кэш постоянно меняются и вечно конфликтуют. Исключаются локально, через .git/info/exclude, репозиторий не меняется.",
        toggle(cfg.skipWindowState, async (v) => { cfg.skipWindowState = v; saveConfig(); await applyExcludes(r).catch((e) => toast(e.message)); })));
    }
    out.append(g2);

    // ---- automatic
    const g3 = group("Автоматическая синхронизация", "Три независимых переключателя. Ничего не включено насильно.");
    const rr = r || {};
    g3.items.append(row("При открытии", "Забирает всё, что изменилось, пока вас не было.", toggle(cfg.auto.login, (v) => { cfg.auto.login = v; saveConfig(); })));
    g3.items.append(row("По таймеру", "Поддерживает хранилище в актуальном виде, пока вы работаете.", toggle(cfg.auto.watch, (v) => { cfg.auto.watch = v; saveConfig(); startWatcher(); ui.refresh(); })));
    g3.items.append(row("Интервал, минут", "Как часто проверять (для этого хранилища; пусто — общее значение).", input(r ? r.intervalMinutes || "" : "", (v) => { const n = parseInt(v, 10); if (r) { r.intervalMinutes = n > 0 ? n : 0; saveConfig(); startWatcher(); } }, { type: "number", width: "70px", placeholder: String(cfg.intervalMinutes) })));
    g3.items.append(row("При закрытии", "Коммитит, публикует и задерживает закрытие приложения, пока не закончит.", toggle(cfg.auto.shutdown, (v) => { cfg.auto.shutdown = v; saveConfig(); })));
    if (r) {
      g3.items.append(row("Автоматически для этого хранилища", "Выключите, чтобы исключить его из автоматической синхронизации (ручная работает всегда).", toggle(r.enabled !== false, (v) => { r.enabled = v; saveConfig(); renderBar(); })));
      g3.items.append(row("Пауза", r.pausedUntil && r.pausedUntil > Date.now() ? `на паузе до ${new Date(r.pausedUntil).toLocaleString()}` : "Выключает автоматическую синхронизацию на время; ручная работает.",
        select("", [["", "—"], ["3600000", "1 час"], ["7200000", "2 часа"], ["86400000", "1 день"], ["off", "снять паузу"]], (v) => { r.pausedUntil = v === "off" || !v ? 0 : Date.now() + parseInt(v, 10); saveConfig(); renderBar(); ui.refresh(); })));
    }
    out.append(g3);

    // ---- behaviour
    const g4 = group("Поведение");
    g4.items.append(row("Стратегия", "Как принимать чужие коммиты: перенести ваши поверх (rebase) или слить (merge).", select(cfg.strategy, [["rebase", "rebase"], ["merge", "merge"]], (v) => { cfg.strategy = v; saveConfig(); })));
    g4.items.append(row("Бэкап-ветки перед перезаписью", "Перед любым rebase/merge/reset берётся ветка syn/backup/…, чтобы ничего нельзя было потерять.", toggle(cfg.backup, (v) => { cfg.backup = v; saveConfig(); })));
    g4.items.append(row("Хранить бэкапы, дней", "Старые удаляются сами, не чаще раза в сутки. 0 — не удалять.", input(cfg.keepBackupDays, (v) => { cfg.keepBackupDays = Math.max(0, parseInt(v, 10) || 0); saveConfig(); }, { type: "number", width: "70px" })));
    g4.items.append(row("Шаблон сообщения коммита", "Подстановки: {host}, {time}. Другие остаются как написаны.", input(cfg.commitTemplate, (v) => { cfg.commitTemplate = v.trim() || DEFAULT_COMMIT; saveConfig(); }, { width: "300px" })));
    if (r) {
      g4.items.append(row("Коммитить мои правки автоматически", "Выключите, если вы работаете в репозитории сами: синхронизация будет забирать и отправлять только ваши собственные коммиты, не засоряя историю.", toggle(!r.noAutoCommit, (v) => { r.noAutoCommit = !v; saveConfig(); })));
      g4.items.append(row("Не коммитить файлы", "По одному шаблону на строку (*.env, private/**). Файлы остаются на диске, но в автоматические коммиты не попадают.", textarea((r.noCommit || []).join("\n"), (v) => { r.noCommit = v.split("\n").map((x) => x.trim()).filter(Boolean); saveConfig(); })));
      g4.items.append(row("Только скачивать", "Режим «получателя»: изменения приходят, наружу не уходит ничего. Для копии, которую только читают.", toggle(!!r.pullOnly, (v) => { r.pullOnly = v; saveConfig(); })));
    }
    out.append(g4);

    // ---- hooks
    if (r) {
      const hk = hooksOf(r);
      const g4h = group("Хуки", "Команда на этом компьютере после синхронизации, которая что-то изменила. Команды хранятся только в настройках приложения и никогда не едут через git: пуш решает, запустится ли хук, но не что именно запустится. Не помещайте в хук долгоживущую программу: синхронизация ждёт команду до таймаута.");
      for (const [ev, k] of Object.entries(EVENT_KEYS)) {
        for (const [idx, h] of hk[k].entries()) {
          g4h.items.append(row(`${ev}`, `${h.run}${h.paths && h.paths.length ? `\n[пути: ${h.paths.join(", ")}]` : ""}`, btn("Удалить", async () => { hk[k].splice(idx, 1); saveConfig(); })));
          g4h.items.lastChild.querySelector(".setting-item-description").style.whiteSpace = "pre-line";
        }
      }
      let evSel = select("after-pull", [["after-pull", "after-pull (после получения)"], ["after-push", "after-push (после отправки)"], ["on-conflict", "on-conflict (при конфликте)"]], () => {});
      let cmdIn = input("", () => {}, { placeholder: "команда, например: echo %BASALT_CHANGED_COUNT%", width: "260px" });
      let pathsIn = input("", () => {}, { placeholder: "только для путей (через запятую)", width: "180px" });
      g4h.items.append(row("Добавить хук", "Переменные: BASALT_EVENT, BASALT_REPO, BASALT_PATH, BASALT_BRANCH, BASALT_COMMIT, BASALT_PREV_COMMIT, BASALT_CHANGED_FILES (по одному пути в строке), BASALT_CHANGED_COUNT; то же под именами SYN_*. Пути: *, ?, [..] и dir/**.",
        evSel, cmdIn, pathsIn,
        btn("Добавить", async () => {
          const run = cmdIn.value.trim();
          if (!run) throw new Error("введите команду");
          const paths = pathsIn.value.split(",").map((x) => x.trim()).filter(Boolean);
          hk[EVENT_KEYS[evSel.value]].push(paths.length ? { run, paths } : { run });
          saveConfig();
        }, true)));
      g4h.items.append(row("Проверить хук сейчас", "Запускает хуки события без синхронизации; изменённых файлов при этом нет.",
        ...Object.keys(EVENT_KEYS).map((ev) => btn(ev, async () => { await runHooksNow(r, ev); toast(`Хуки ${ev} отработали`); }))));
      g4h.items.append(row("Таймаут хука, секунд", "По умолчанию 300.", input(hk.timeoutSeconds || "", (v) => { hk.timeoutSeconds = Math.max(0, parseInt(v, 10) || 0); saveConfig(); }, { type: "number", width: "80px", placeholder: "300" })));
      g4h.items.append(row("Откатывать получение, если хук упал", "Для копии, с которой запускают код: если новая версия не поднялась, остаётся старая. Не откатывает, если есть несохранённые правки, и никогда не откатывает after-push.", toggle(!!hk.rollback, (v) => { hk.rollback = v; saveConfig(); })));
      out.append(g4h);
    }

    // ---- notifications
    const gj = group("Журнал действий", "Приватная история хранилища в папке данных приложения: каждая правка заметки, карточки холста или переименование записывается через несколько секунд. Работает без GitHub и не мешает синхронизации. Открыть журнал, отменить действие или откатить всё к нужному моменту можно в «Журнал действий: открыть».");
    const jst = await journalStats();
    gj.items.append(row("Записывать действия", J.ready ? `Записей: ${jst.count} · занимает ${jst.size}` : "Выключено или не запущено.", toggle(cfg.journal.enabled, async (v) => { cfg.journal.enabled = v; saveConfig(); if (v && !J.ready) { await startJournal(); } toast(v ? "Журнал включён" : "Журнал остановится после перезапуска"); })));
    gj.items.append(row("Пауза перед записью, секунд", "Правки подряд склеиваются в одну запись.", input(cfg.journal.delay, (v) => { cfg.journal.delay = Math.max(1, parseInt(v, 10) || 3); saveConfig(); }, { type: "number", width: "70px" })));
    gj.items.append(row("Журнал", "Все записи, отмена одного действия и откат к моменту.", btn("Открыть", async () => { await showVaultFeed(); }, true), btn("Снимок сейчас", async () => { J.pending.add("."); await journalCommit("Снимок вручную"); toast("Снимок записан"); })));
    out.append(gj);
    const g5 = group("Уведомления");
    g5.items.append(row("Уведомлять о", "Конфликт напоминает о себе раз в сутки, пока не решён.", select(cfg.notify, [["conflict", "только конфликтах"], ["all", "каждой синхронизации"], ["off", "ничего"]], (v) => { cfg.notify = v; saveConfig(); })));
    g5.items.append(row("Telegram: токен бота", "Необязательно. Токен — от @BotFather.", input(cfg.telegram.token, (v) => { cfg.telegram.token = v.trim(); saveConfig(); }, { type: "password", width: "220px" })));
    g5.items.append(row("Telegram: chat id", "Узнать можно у @userinfobot.", input(cfg.telegram.chatId, (v) => { cfg.telegram.chatId = v.trim(); saveConfig(); }, { width: "140px" }),
      btn("Проверить", async () => { notify("conflict", { title: "Проверка", short: "Синхронизация: тестовое уведомление", full: "Синхронизация: тестовое уведомление — доставка работает." }); toast("Отправил тест"); })));
    g5.items.append(row("Git-личность по умолчанию", "Используется, только если в git не настроены user.name и user.email.", input(cfg.identity.name, (v) => { cfg.identity.name = v.trim(); saveConfig(); }, { placeholder: "имя", width: "120px" }), input(cfg.identity.email, (v) => { cfg.identity.email = v.trim(); saveConfig(); }, { placeholder: "email", width: "170px" })));
    out.append(g5);

    // ---- safety net
    if (r && st && !st.notRepo) {
      const g6 = group("Страховка");
      const bs = (await backups(r)).slice(0, 8);
      g6.items.append(row("Отменить последний автокоммит", "Изменения остаются в файлах, откатывается только коммит синхронизации.", btn("Отменить", async () => { setBusy(true); try { const u = await undoLastCommit(r); toast(`Откатил «${u.subject}»${u.wasPushed ? " — он уже опубликован, исправление нужно отправить принудительно" : ""}`); } finally { setBusy(false); } })));
      g6.items.append(row(`Бэкап-ветки (${bs.length ? "последние " + bs.length : "нет"})`, bs.map((b) => `${b.name}  —  ${new Date(b.at).toLocaleString()}`).join("\n") || "Появятся перед первой перезаписью истории.",
        bs.length ? select("", [["", "восстановить из…"], ...bs.map((b) => [b.name, b.name.split("/").slice(-1)[0]])], async (v) => { if (v && await window.__bsConfirm(`Восстановить ветку из ${v}? Текущее состояние сохранится в новой бэкап-ветке.`)) { try { await restoreBackup(r, v); toast("Восстановлено"); } catch (e) { toast(e.message); } ui.refresh(); } }) : null,
        bs.length ? btn("Удалить старые", async () => { toast(`Удалено: ${await pruneBackups(r, cfg.keepBackupDays || 14)}`); }) : null));
      g6.items.lastChild.querySelector(".setting-item-description").style.whiteSpace = "pre-line";
      out.append(g6);
    }

    // ---- log
    const g7 = group("Журнал");
    const pre = h("pre", { class: "vs-log" }, logLines.join("\n") || "Пока пусто.");
    pre.style.cssText = "max-height:260px;overflow:auto;font-size:11px;white-space:pre-wrap;user-select:text;padding:8px;background:var(--background-secondary);border-radius:6px;margin:0";
    g7.items.append(h("div", { class: "setting-item" }, pre));
    g7.items.append(row("", `Файл: ${logFile()}`, btn("Обновить", async () => {})));
    out.append(g7);

    el.empty();
    el.append(out);
    pre.scrollTop = pre.scrollHeight;
  }
  let renderToken = 0;

  // ------------------------------------------------------------------ boot
  async function boot() {
    loadConfig();
    loadState();
    const tab = app.setting.pluginTabs.find((t) => t.id === "sync");
    if (tab) {
      tab.name = "Синхронизация (git)";
      tab.display = function () { renderSettings(this.containerEl); };
      if (tab.navEl) { const t = tab.navEl.querySelector(".vertical-tab-nav-item-title"); if (t) t.textContent = tab.name; }
    }
    barEl = app.statusBar.registerStatusBarItem();
    barEl.classList.add("mod-clickable", "vault-sync-status");
    barEl.addEventListener("click", async () => {
      const r = findRepo();
      if (!r) { app.setting.open(); app.setting.openTabById("sync"); return; }
      if (state.conflicts[key(r)]) { app.setting.open(); app.setting.openTabById("sync"); return; }
      try { toast(summary(await runManual(sync))); } catch (e) { toast(e.message); }
    });
    barEl.addEventListener("contextmenu", (e) => { e.preventDefault(); app.setting.open(); app.setting.openTabById("sync"); });
    const style = document.createElement("style");
    style.textContent = ".vault-sync-status.vs-conflict{color:var(--text-error)}.vault-sync-settings .vs-hint{padding:0 var(--size-4-4) var(--size-4-2)}.vault-sync-settings .vs-conflict-row{border:1px solid var(--text-error)}.vault-sync-settings textarea{font-size:var(--font-ui-small)}";
    document.head.appendChild(style);

    const cmd = (id, name, fn) => app.commands.addCommand({ id: `vault-sync:${id}`, name: `Синхронизация: ${name}`, callback: async () => { try { toast(summary(await runManual(fn))); } catch (e) { toast(e.message); } } });
    cmd("sync", "синхронизировать сейчас", sync);
    cmd("pull", "только скачать", pull);
    cmd("push", "только отправить", push);
    app.commands.addCommand({ id: "vault-sync:file-history", name: "Синхронизация: история версий файла", checkCallback: (c) => { const f = app.workspace.getActiveFile(); if (!f) return false; if (!c) showFileHistory(f.path); return true; } });
    app.commands.addCommand({ id: "vault-sync:feed", name: "Журнал действий: открыть", callback: () => showVaultFeed() });
    app.commands.addCommand({ id: "vault-sync:journal-undo", name: "Журнал действий: отменить последнее действие", callback: async () => {
      if (!J.ready) return toast("Журнал действий выключен");
      await journalCommit();
      const log = await jgit(["log", "-8", "--pretty=format:%H%x1f%s"]).catch(() => "");
      const last = log.split("\n").map((l) => l.split("\x1f")).find((x) => x[1] && !/^(Откат|Перед откатом|Снимок)/.test(x[1]));
      if (!last) return toast("Нечего отменять");
      if (!(await window.__bsConfirm(`Отменить последнее действие?\n${last[1]}`))) return;
      try { toast(`Отменено: ${plural(await journalRevert(last[0]), "файл", "файла", "файлов")}`); } catch (e) { toast(e.message); }
    } });
    app.commands.addCommand({ id: "vault-sync:journal-snapshot", name: "Журнал действий: сделать снимок сейчас", callback: async () => { J.pending.add("."); await journalCommit("Снимок вручную"); toast("Снимок записан"); } });
    app.commands.addCommand({ id: "vault-sync:settings", name: "Синхронизация: открыть настройки", callback: () => { app.setting.open(); app.setting.openTabById("sync"); } });
    app.commands.addCommand({ id: "vault-sync:status", name: "Синхронизация: показать состояние", callback: async () => { const r = findRepo(); if (!r) return toast("Синхронизация не настроена"); const s = await status(r, true); toast(`${s.branch || "—"}: ${s.ahead || 0} вперёд, ${s.behind || 0} назад, ${(s.changed || []).length} изм.`); } });

    // closing: publish first, but never hang the window forever
    app.workspace.on("quit", (tasks) => {
      const r = findRepo();
      if (!cfg.auto.shutdown || !r || !r.enabled) return;
      tasks.add(async () => {
        info("закрытие: публикую перед выходом");
        const res = await Promise.race([push(r), new Promise((res0) => setTimeout(() => res0({ repo: r.name, err: new Error("не уложился в 90 с — закрываю без публикации") }), 90000))]);
        report(r, res);
      });
    });

    startJournal();
    listeners.add((kind) => { if (kind === "state" || kind === "busy") renderBar(); });
    setInterval(renderBar, 30000);
    renderBar();

    const r = findRepo();
    if (r && cfg.auto.login && syncsByItself(r)) {
      setTimeout(async () => { try { await runManual(pull); } catch (e) { errorf(e.message); } startWatcher(); }, 1500);
    } else startWatcher();
    info(`vault-sync запущен для «${vaultPath()}»`);
  }

  // ---- Version history of one file, from the vault's git repository (replaces the stock server-side one)
  function gitBuf(dir, args) {
    return new Promise((resolve, reject) => {
      cp.execFile("git", ["-c", "core.quotepath=false", ...args], { cwd: dir, windowsHide: true, maxBuffer: 512 * 1024 * 1024, encoding: "buffer", env: Object.assign({}, process.env, BASE_ENV) },
        (err, out, errOut) => (err ? reject(new GitError(args, String(errOut || ""), err)) : resolve(out)));
    });
  }
  const BINARY_EXT = /\.(png|jpe?g|gif|webp|bmp|ico|pdf|zip|mp3|wav|ogg|m4a|mp4|webm|mov|mkv|ttf|otf|woff2?|docx?|xlsx?|pptx?)$/i;

  const HISTORY_CSS =
      ".vs-history{width:min(1100px,94vw);max-width:none;height:min(720px,88vh);display:flex;flex-direction:column;padding:0}" +
      ".vs-head{padding:18px 24px 12px;border-bottom:1px solid var(--background-modifier-border)}.vs-title{font-size:var(--font-ui-large);font-weight:600}.vs-sub{color:var(--text-muted);font-size:var(--font-ui-small)}" +
      ".vs-body{display:flex;flex:1;min-height:0}.vs-list{flex:0 0 310px;overflow:auto;padding:10px 6px 10px 18px;border-right:1px solid var(--background-modifier-border)}" +
      ".vs-day{margin:14px 0 6px 18px;font-size:var(--font-ui-smaller);text-transform:uppercase;letter-spacing:.08em;color:var(--text-faint)}" +
      ".vs-item{position:relative;padding:8px 10px 8px 22px;cursor:pointer;border-radius:var(--radius-s)}.vs-item:before{content:'';position:absolute;left:5px;top:0;bottom:0;width:2px;background:var(--background-modifier-border)}" +
      ".vs-item:after{content:'';position:absolute;left:0;top:15px;width:12px;height:12px;border-radius:50%;background:var(--background-primary);border:2px solid var(--text-faint)}" +
      ".vs-item:hover{background:var(--background-modifier-hover)}.vs-item.is-active{background:var(--background-modifier-hover)}.vs-item.is-active:after{border-color:var(--interactive-accent);background:var(--interactive-accent)}" +
      ".vs-item .vs-s{font-weight:500;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.vs-item small{display:block;color:var(--text-muted)}.vs-item .vs-cur{color:var(--interactive-accent)}" +
      ".vs-main{flex:1;display:flex;flex-direction:column;min-width:0;padding:14px 20px 16px;gap:10px}.vs-meta{color:var(--text-muted);font-size:var(--font-ui-small)}.vs-meta b{color:var(--text-normal)}" +
      ".vs-bar{display:flex;gap:6px;align-items:center;flex-wrap:wrap}.vs-bar .vs-tab{padding:4px 12px}.vs-bar .vs-gap{flex:1}" +
      ".vs-tab{background:transparent;border:0;border-bottom:2px solid transparent;border-radius:0;clip-path:none;box-shadow:none;color:var(--text-muted)}.vs-tab.is-on{color:var(--text-normal);border-bottom-color:var(--interactive-accent)}" +
      ".vs-view.vs-live{position:relative;padding:0;overflow:hidden}" +
      ".vs-view{flex:1;overflow:auto;border:1px solid var(--background-modifier-border);padding:16px 22px;background:var(--background-primary-alt, var(--background-secondary))}" +
      ".vs-view h1,.vs-view h2,.vs-view h3,.vs-view h4{margin:.9em 0 .4em}.vs-view h1{font-size:1.6em}.vs-view h2{font-size:1.35em}.vs-view p{margin:.5em 0}.vs-view ul,.vs-view ol{margin:.4em 0 .4em 1.3em}" +
      ".vs-view blockquote{margin:.6em 0;padding:2px 12px;border-left:3px solid var(--interactive-accent);color:var(--text-muted)}.vs-view code{background:var(--background-secondary);padding:1px 5px}.vs-code{background:var(--background-secondary);padding:10px;white-space:pre-wrap;font-size:var(--font-ui-small)}" +
      ".vs-link{color:var(--text-accent);text-decoration:underline}.vs-tag{color:var(--text-accent)}.vs-front{padding:8px 12px;margin-bottom:10px;background:var(--background-secondary);color:var(--text-muted);font-size:var(--font-ui-smaller);white-space:pre-wrap}" +
      ".vs-tasks{list-style:none;margin-left:0!important}.vs-task{display:flex;gap:8px;align-items:center}.vs-box{width:13px;height:13px;border:2px solid var(--text-faint);flex:none}.vs-task.is-done .vs-box{background:var(--interactive-accent);border-color:var(--interactive-accent)}.vs-task.is-done{color:var(--text-muted);text-decoration:line-through}" +
      ".vs-stats{margin-bottom:10px;color:var(--text-muted)}.vs-add{color:var(--color-green,#4caf50);font-weight:600}.vs-del{color:var(--color-red,#e5534b);font-weight:600}.vs-diff{font-family:var(--font-monospace);font-size:var(--font-ui-smaller);line-height:1.55}" +
      ".vs-d{display:flex;white-space:pre-wrap;word-break:break-word}.vs-d span{flex:0 0 38px;text-align:right;padding-right:8px;color:var(--text-faint);user-select:none}.vs-d i{flex:0 0 16px;font-style:normal;color:var(--text-faint)}.vs-d.add{background:rgba(76,175,80,.16)}.vs-d.add i{color:var(--color-green,#4caf50)}.vs-d.del{background:rgba(229,83,75,.16)}.vs-d.del i{color:var(--color-red,#e5534b)}.vs-hunk{margin:8px 0 2px 54px;color:var(--text-faint)}" +
      ".vs-cards{display:grid;grid-template-columns:repeat(auto-fill,minmax(190px,1fr));gap:10px}.vs-card{padding:10px 12px;background:var(--background-secondary);border:1px solid var(--background-modifier-border);font-size:var(--font-ui-smaller)}.vs-card small{display:block;color:var(--text-faint);text-transform:uppercase;letter-spacing:.06em;margin-bottom:4px}" +
      ".vs-view img{max-width:100%;display:block;margin:0 auto}.vs-muted{color:var(--text-muted)}" +
      ".vs-head{padding-right:64px}" +
      ".vs-chip{display:inline-block;padding:0 7px;margin-right:6px;font-size:10px;line-height:16px;letter-spacing:.04em;text-transform:uppercase;font-weight:600;background:var(--background-modifier-border);color:var(--text-muted)}.vs-chip.a{background:rgba(76,175,80,.18);color:var(--color-green,#4caf50)}.vs-chip.d{background:rgba(229,83,75,.18);color:var(--color-red,#e5534b)}.vs-chip.m{background:color-mix(in srgb,var(--interactive-accent) 20%,transparent);color:var(--interactive-accent)}" +
      ".vs-mag{display:inline-flex;height:6px;gap:1px;vertical-align:middle;margin-right:6px}.vs-mag i{display:block;height:6px}.vs-mag i.a{background:#4caf50}.vs-mag i.d{background:#e5534b}" +
      ".vs-item .vs-mrow{display:flex;align-items:center;gap:4px;margin-top:3px;font-size:var(--font-ui-smaller);color:var(--text-muted)}" +
      ".vs-grp{position:relative;margin:2px 0}.vs-grp>.vs-gh{position:relative;padding:8px 10px 8px 22px;cursor:pointer;border-radius:var(--radius-s);display:flex;flex-wrap:wrap;gap:2px 8px;align-items:center}.vs-grp>.vs-gh:before{content:'';position:absolute;left:5px;top:0;bottom:0;width:2px;background:var(--background-modifier-border)}" +
      ".vs-grp>.vs-gh:after{content:'';position:absolute;left:0;top:14px;width:12px;height:12px;background:var(--background-primary);border:2px solid var(--text-faint);transform:rotate(45deg) scale(.8)}.vs-grp>.vs-gh:hover{background:var(--background-modifier-hover)}" +
      ".vs-gh .vs-n{font-weight:600}.vs-gh .vs-car{margin-left:auto;width:8px;height:8px;border-right:2px solid var(--text-faint);border-bottom:2px solid var(--text-faint);transform:rotate(-45deg);transition:transform .12s}.vs-grp.is-open>.vs-gh .vs-car{transform:rotate(45deg)}" +
      ".vs-gb{display:none;margin-left:12px;border-left:1px dashed var(--background-modifier-border)}.vs-grp.is-open>.vs-gb{display:block}.vs-gb .vs-item{padding-top:5px;padding-bottom:5px}.vs-gb .vs-item:before{display:none}.vs-gb .vs-item:after{width:8px;height:8px;top:11px;left:-5px}" +
      ".vs-map{position:relative;height:10px;margin:0 0 12px;background:var(--background-secondary);border:1px solid var(--background-modifier-border)}.vs-map i{position:absolute;top:0;bottom:0;min-width:3px;background:var(--interactive-accent)}.vs-map i.a{background:#4caf50}.vs-map i.d{background:#e5534b}.vs-mapl{display:flex;justify-content:space-between;font-size:10px;color:var(--text-faint);margin:-8px 0 12px}" +
      ".vs-hunk b{color:var(--text-normal);font-weight:500}.vs-hunk .vs-sec{color:var(--interactive-accent)}" +
      ".vs-cmap{width:100%;height:230px;background:var(--background-secondary);border:1px solid var(--background-modifier-border);margin-bottom:12px;display:block}.vs-cmap .n{fill:var(--background-modifier-border);stroke:var(--text-faint);stroke-width:1}.vs-cmap .n.a{fill:rgba(76,175,80,.4);stroke:#4caf50}.vs-cmap .n.d{fill:rgba(229,83,75,.18);stroke:#e5534b;stroke-dasharray:6 4}.vs-cmap .n.m{fill:color-mix(in srgb,var(--interactive-accent) 35%,transparent);stroke:var(--interactive-accent)}.vs-cmap .n.g{fill:none;stroke:var(--interactive-accent);stroke-dasharray:6 4;opacity:.7}.vs-cmap .e{stroke:var(--text-faint);stroke-width:1.5;opacity:.55}.vs-cmap .e.a{stroke:#4caf50;opacity:1;stroke-width:2.5}.vs-cmap .e.d{stroke:#e5534b;opacity:1;stroke-dasharray:6 4;stroke-width:2}" +
      ".vs-legend{display:flex;gap:14px;flex-wrap:wrap;margin-bottom:10px;font-size:var(--font-ui-smaller);color:var(--text-muted)}.vs-legend span:before{content:'';display:inline-block;width:10px;height:10px;margin-right:5px;vertical-align:-1px;background:var(--text-faint)}.vs-legend .a:before{background:#4caf50}.vs-legend .d:before{background:#e5534b}.vs-legend .m:before{background:var(--interactive-accent)}" +
      ".vs-crow{display:flex;gap:8px;align-items:baseline;padding:4px 0;border-bottom:1px solid var(--background-modifier-border)}.vs-crow small{color:var(--text-faint);text-transform:uppercase;letter-spacing:.05em;flex:none}.vs-crow .vs-how{margin-left:auto;color:var(--text-muted);font-size:var(--font-ui-smaller);flex:none}";


  // ================================================================== action journal
  // A private git history of the vault, kept in the app data folder (not in the vault, never pushed): every burst of
  // changes - a note edited, a canvas card moved, a file renamed - becomes one entry a few seconds after it happens.
  // It is independent of the synchronisation repository, so it works without a remote and never touches the vault's own git.
  const crypto = window.require("crypto");
  const J = { gitdir: "", dir: "", timer: 0, pending: new Set(), busy: false, again: false, ready: false, bootTimer: 0 };
  const JOURNAL_EXCLUDE = [".git/", ".basalt/workspace.json", ".basalt/workspace-mobile.json", ".basalt/workspaces.json", ".basalt/cache", ".obsidian/workspace.json", ".obsidian/workspace-mobile.json", ".obsidian/workspaces.json", ".obsidian/cache", ".trash/", "node_modules/", "*.tmp", ".DS_Store", "Thumbs.db"];
  const journalDirFor = (vault) => path.join(path.dirname(home()), "vault-history", crypto.createHash("sha1").update(path.resolve(vault).toLowerCase()).digest("hex").slice(0, 16) + ".git");
  const jgit = (args, opts) => git(J.dir, ["--git-dir=" + J.gitdir, "--work-tree=" + J.dir, ...args], opts);
  const jbuf = (args) => gitBuf(J.dir, ["--git-dir=" + J.gitdir, "--work-tree=" + J.dir, ...args]);
  const JOURNAL_ENV = { GIT_AUTHOR_NAME: "Basalt", GIT_AUTHOR_EMAIL: "journal@basalt.local", GIT_COMMITTER_NAME: "Basalt", GIT_COMMITTER_EMAIL: "journal@basalt.local" };
  const skipPath = (p) => /^(\.git\/|\.trash\/|node_modules\/)/.test(p) || /^\.(obsidian|basalt)\/(workspace|cache)/.test(p);

  async function journalInit() {
    const vault = vaultPath();
    if (!vault) return false;
    J.dir = vault; J.gitdir = journalDirFor(vault);
    if (!fs.existsSync(path.join(J.gitdir, "HEAD"))) {
      fs.mkdirSync(J.gitdir, { recursive: true });
      await git(J.dir, ["init", "--bare", "-q", "-b", "journal", J.gitdir]);
      await jgit(["config", "core.bare", "false"]);
      for (const [k, v] of [["core.autocrlf", "false"], ["core.safecrlf", "false"], ["core.quotepath", "false"], ["gc.auto", "256"], ["commit.gpgsign", "false"]]) await jgit(["config", k, v]);
    }
    fs.mkdirSync(path.join(J.gitdir, "info"), { recursive: true });
    fs.writeFileSync(path.join(J.gitdir, "info", "exclude"), JOURNAL_EXCLUDE.join("\n") + "\n");
    J.ready = true;
    return true;
  }

  function describeChange(nameStatus, numstat) {
    const rows = nameStatus.split("\n").filter(Boolean).map((l) => l.split("\t"));
    const base = (x) => x.replace(/^.*\//, "");
    const nums = numstat.split("\n").filter(Boolean).map((l) => l.split("\t"));
    if (rows.length === 1) {
      const [st, a, b] = rows[0];
      const n = nums[0] && nums[0][0] !== "-" ? ` (+${nums[0][0]} −${nums[0][1]})` : "";
      if (st === "A") return `Создано: ${base(a)}`;
      if (st === "D") return `Удалено: ${base(a)}`;
      if (st[0] === "R") return `Переименовано: ${base(a)} → ${base(b)}`;
      return `Изменено: ${base(a)}${n}`;
    }
    const add = rows.filter((r) => r[0] === "A").length, del = rows.filter((r) => r[0] === "D").length, mod = rows.length - add - del;
    const parts = []; if (add) parts.push(`создано ${add}`); if (mod) parts.push(`изменено ${mod}`); if (del) parts.push(`удалено ${del}`);
    const names = rows.slice(0, 3).map((r) => base(r[r.length - 1])).join(", ");
    return `${parts.join(", ")}: ${names}${rows.length > 3 ? "…" : ""}`;
  }

  async function journalCommit(label) {
    if (!J.ready) return;
    if (J.busy) { J.again = true; return; }
    J.busy = true;
    try {
      const paths = Array.from(J.pending); J.pending.clear();
      await jgit(["add", "-A", "--ignore-errors", "--", ...(paths.length && paths.length < 150 ? paths : ["."])]).catch(() => "");
      const ns = await jgit(["diff", "--cached", "--name-status", "-M"]);
      if (!ns) return;
      const num = await jgit(["diff", "--cached", "--numstat", "-M"]).catch(() => "");
      const msg = label || describeChange(ns, num);
      await jgit(["commit", "-q", "--no-verify", "-m", msg], { env: JOURNAL_ENV });
      emit("journal");
    } catch (e) { debug("journal: " + e.message); }
    finally { J.busy = false; if (J.again) { J.again = false; schedule(); } }
  }
  function schedule() { clearTimeout(J.timer); J.timer = setTimeout(() => journalCommit(), Math.max(1, cfg.journal.delay || 3) * 1000); }

  async function startJournal() {
    if (!cfg.journal.enabled) return;
    try { if (!(await journalInit())) return; } catch (e) { warn("журнал действий не запустился: " + e.message); return; }
    if (J.started) return; J.started = true;
    app.vault.on("raw", (p) => { if (!cfg.journal.enabled || !p || skipPath(p)) return; J.pending.add(String(p).replace(/\\/g, "/")); schedule(); });
    // the first snapshot, then a full sweep now and then in case an event was missed
    clearTimeout(J.bootTimer); J.bootTimer = setTimeout(() => { J.pending.add("."); journalCommit("Снимок хранилища"); }, 6000);
    setInterval(() => { J.pending.add("."); schedule(); }, 15 * 60 * 1000);
  }
  async function journalStats() {
    if (!J.ready) return { count: 0, size: "" };
    const count = await jgit(["rev-list", "--count", "HEAD"]).catch(() => "0");
    let bytes = 0; const walk = (d) => { try { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const f = path.join(d, e.name); if (e.isDirectory()) walk(f); else bytes += fs.statSync(f).size; } } catch (err) { /* gone */ } }; walk(J.gitdir);
    return { count: +count || 0, size: bytes > 1048576 ? (bytes / 1048576).toFixed(1) + " МБ" : Math.ceil(bytes / 1024) + " КБ" };
  }

  // restore what one entry changed to how it was before it (the entry's own files only)
  async function journalRevert(hash) {
    const parent = await jgit(["rev-parse", hash + "^"]).catch(() => "");
    if (!parent) throw new Error("это первая запись: до неё ничего не было");
    const out = await jgit(["diff-tree", "--no-commit-id", "--name-status", "-r", "-M", hash]);
    const rows = out.split("\n").filter(Boolean).map((l) => l.split("\t"));
    let n = 0;
    for (const [st, a, b] of rows) {
      const put = async (rel, from) => { const data = await jbuf(["show", `${from}:${rel}`]); const dest = path.join(J.dir, rel); fs.mkdirSync(path.dirname(dest), { recursive: true }); fs.writeFileSync(dest, data); n++; };
      const drop = (rel) => { try { fs.rmSync(path.join(J.dir, rel), { force: true }); n++; } catch (e) { /* in use */ } };
      if (st === "A") drop(a); else if (st[0] === "R") { drop(b); await put(a, parent); } else await put(a, parent);
    }
    return n;
  }
  // bring the whole vault to how it was at an entry
  async function journalRollback(hash) {
    await journalCommit("Перед откатом");
    const out = await jgit(["diff", "--name-status", "-M", hash, "HEAD"]);
    const rows = out.split("\n").filter(Boolean).map((l) => l.split("\t"));
    let n = 0;
    for (const [st, a, b] of rows) {
      const put = async (rel) => { const data = await jbuf(["show", `${hash}:${rel}`]); const dest = path.join(J.dir, rel); fs.mkdirSync(path.dirname(dest), { recursive: true }); fs.writeFileSync(dest, data); n++; };
      const drop = (rel) => { try { fs.rmSync(path.join(J.dir, rel), { force: true }); n++; } catch (e) { /* in use */ } };
      // diff runs from the entry towards now: A = appeared later (remove), D = existed then (restore), M = restore, R = a -> b later
      if (st === "A") drop(a); else if (st[0] === "R") { drop(b); await put(a); } else await put(a);
    }
    return n;
  }
  const BURST_MS = 10 * 60 * 1000;
  const CHIP = { a: "Создан", d: "Удалён", m: "Изменён" };
  // entries a few minutes apart by one author are one working session: the lists fold them into one row
  function burstGroups(items) {
    const groups = [];
    for (const it of items) {
      const g = groups[groups.length - 1];
      if (g && g.author === it.author && Math.abs(new Date(g.items[g.items.length - 1].date) - new Date(it.date)) <= BURST_MS) g.items.push(it);
      else groups.push({ author: it.author, items: [it] });
    }
    return groups;
  }
  // "@@hash\x1f…" blocks of `git log --raw --numstat --no-renames` -> entries with per-file status and line counts
  function parseLog(out) {
    return (out ? out.split("@@").filter(Boolean) : []).map((blk) => {
      const lines = blk.split("\n");
      const [full, short, date, author, subject] = lines[0].split("\x1f");
      const byPath = new Map();
      for (const l of lines.slice(1)) {
        if (!l.trim()) continue;
        if (l[0] === ":") { const [meta, ...pth] = l.split("\t"); const f = byPath.get(pth.join("\t")) || {}; f.st = { A: "a", D: "d" }[meta.trim().split(" ").pop()[0]] || "m"; byPath.set(pth.join("\t"), f); }
        else { const [a, d, ...pth] = l.split("\t"); const k = pth.join("\t"); const f = byPath.get(k) || {}; f.add = a === "-" ? null : +a; f.del = d === "-" ? null : +d; byPath.set(k, f); }
      }
      const files = Array.from(byPath, ([pth, f]) => ({ path: pth, st: f.st || "m", add: f.add == null ? null : f.add, del: f.del == null ? null : f.del }));
      return { full, short, date, author, subject, files };
    });
  }
  const magHtml = (add, del) => {
    if (add == null || del == null) return '<span class="vs-sum">двоичный</span>';
    const t = add + del, w = t ? Math.max(4, Math.round(Math.min(1, Math.log10(t + 1) / 3) * 60)) : 0, aw = t ? Math.round((w * add) / t) : 0;
    return `<span class="vs-mag"><i class="a" style="width:${aw}px"></i><i class="d" style="width:${w - aw}px"></i></span><span class="vs-sum"><span class="vs-add">+${add}</span> <span class="vs-del">−${del}</span></span>`;
  };
  const hhmm = (d) => new Date(d).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  const histGit = (r, args) => (J.ready ? jgit(args) : git(r.path, args));
  const histBuf = (r, args) => (J.ready ? jbuf(args) : gitBuf(r.path, args));
  const hasHistory = async (r) => J.ready || (await isRepo(r.path));

  async function showFileHistory(relPath) {
    const r = findRepo() || { path: vaultPath(), name: path.basename(vaultPath() || "vault") };
    if (!(await hasHistory(r))) { toast("История версий берётся из git-репозитория хранилища. Подключите синхронизацию в настройках."); return; }
    const rel = String(relPath).replace(/\\/g, "/");
    let list = [];
    try {
      const out = await histGit(r, ["log", "--follow", "--max-count=300", "--no-renames", "--raw", "--numstat", "--pretty=format:@@%H%x1f%h%x1f%aI%x1f%an%x1f%s", "--", rel]);
      list = parseLog(out).map((v) => { const f = v.files.find((x) => x.path === rel) || v.files[0] || { st: "m", add: 0, del: 0 }; return { ...v, st: f.st, add: f.add, del: f.del }; });
    } catch (e) { toast("Не удалось прочитать историю: " + e.message); return; }
    if (!list.length) { toast("У этого файла ещё нет сохранённых версий: он не попал ни в один коммит."); return; }

    const esc = (t) => String(t).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    const inline = (t) => esc(t)
      .replace(/`([^`]+)`/g, "<code>$1</code>")
      .replace(/\*\*([^*]+)\*\*/g, "<b>$1</b>").replace(/(^|[^*])\*([^*\s][^*]*)\*/g, "$1<i>$2</i>")
      .replace(/~~([^~]+)~~/g, "<s>$1</s>").replace(/==([^=]+)==/g, "<mark>$1</mark>")
      .replace(/\[\[([^\]|#]+)(?:#[^\]|]*)?(?:\|([^\]]+))?\]\]/g, (m, a, b) => `<span class="vs-link">${b || a}</span>`)
      .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<span class="vs-link">$1</span>')
      .replace(/(^|\s)#([\p{L}\w\/-]+)/gu, '$1<span class="vs-tag">#$2</span>');
    // a small markdown -> HTML renderer: enough to read a note as a note, not as source
    function mdToHtml(src) {
      const lines = src.replace(/\r/g, "").split("\n"); const out = []; let i = 0, list = null;
      const closeList = () => { if (list) { out.push(`</${list}>`); list = null; } };
      if (lines[0] === "---") { const end = lines.indexOf("---", 1); if (end > 0) { out.push(`<div class="vs-front">${esc(lines.slice(1, end).join("\n"))}</div>`); i = end + 1; } }
      for (; i < lines.length; i++) {
        const l = lines[i]; let m;
        if (/^```/.test(l)) { closeList(); const buf = []; i++; while (i < lines.length && !/^```/.test(lines[i])) buf.push(lines[i++]); out.push(`<pre class="vs-code">${esc(buf.join("\n"))}</pre>`); continue; }
        if ((m = /^(#{1,6})\s+(.*)$/.exec(l))) { closeList(); out.push(`<h${m[1].length}>${inline(m[2])}</h${m[1].length}>`); continue; }
        if (/^\s*([-*_])\1{2,}\s*$/.test(l)) { closeList(); out.push("<hr>"); continue; }
        if ((m = /^>\s?(.*)$/.exec(l))) { closeList(); out.push(`<blockquote>${inline(m[1])}</blockquote>`); continue; }
        if ((m = /^\s*[-*+]\s+\[( |x|X)\]\s+(.*)$/.exec(l))) { if (list !== "ul") { closeList(); out.push('<ul class="vs-tasks">'); list = "ul"; } out.push(`<li class="vs-task${m[1] === " " ? "" : " is-done"}"><span class="vs-box"></span>${inline(m[2])}</li>`); continue; }
        if ((m = /^\s*[-*+]\s+(.*)$/.exec(l))) { if (list !== "ul") { closeList(); out.push("<ul>"); list = "ul"; } out.push(`<li>${inline(m[1])}</li>`); continue; }
        if ((m = /^\s*\d+[.)]\s+(.*)$/.exec(l))) { if (list !== "ol") { closeList(); out.push("<ol>"); list = "ol"; } out.push(`<li>${inline(m[1])}</li>`); continue; }
        if (!l.trim()) { closeList(); continue; }
        closeList(); out.push(`<p>${inline(l)}</p>`);
      }
      closeList(); return out.join("\n");
    }
    // the drawing of a canvas (fpInk): strokes as svg, each marked added / removed / unchanged
    const inkBox = (s) => { const pts = s.t === "t" ? [s.a, [s.a[0] + String(s.text || "").length * (s.z || 16) * 0.6, s.a[1] + (s.z || 16) * 1.3 * String(s.text || "").split(String.fromCharCode(10)).length]] : s.p || [s.a, s.b]; let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9; for (const q of pts) { if (!q) continue; x0 = Math.min(x0, q[0]); y0 = Math.min(y0, q[1]); x1 = Math.max(x1, q[0]); y1 = Math.max(y1, q[1]); } return [x0, y0, x1, y1]; };
    const inkSvg = (s, c) => {
      const col = c === "a" ? "#44cf6e" : c === "d" ? "#fb464c" : (s.c || "currentColor"), op = c ? 1 : 0.6, dash = c === "d" ? ' stroke-dasharray="6 5"' : "", sw = 2;
      const at = `stroke="${col}" stroke-width="${sw}" vector-effect="non-scaling-stroke" fill="none" stroke-linecap="round" stroke-linejoin="round" opacity="${op}"${dash}`;
      const t = s.t || "p";
      if (t === "p") return `<polyline points="${(s.p || []).map((q) => q[0].toFixed(1) + "," + q[1].toFixed(1)).join(" ")}" ${at}/>`;
      if (t === "l" || t === "a") return `<line x1="${s.a[0]}" y1="${s.a[1]}" x2="${s.b[0]}" y2="${s.b[1]}" ${at}/>`;
      if (t === "r") return `<rect x="${Math.min(s.a[0], s.b[0])}" y="${Math.min(s.a[1], s.b[1])}" width="${Math.abs(s.b[0] - s.a[0])}" height="${Math.abs(s.b[1] - s.a[1])}" ${at}/>`;
      if (t === "e") return `<ellipse cx="${(s.a[0] + s.b[0]) / 2}" cy="${(s.a[1] + s.b[1]) / 2}" rx="${Math.abs(s.b[0] - s.a[0]) / 2}" ry="${Math.abs(s.b[1] - s.a[1]) / 2}" ${at}/>`;
      if (t === "t") return `<text x="${s.a[0]}" y="${s.a[1] + (s.z || 16)}" font-size="${s.z || 16}" fill="${col}" opacity="${op}">${esc(String(s.text || "").split(String.fromCharCode(10))[0])}</text>`;
      return "";
    };
    const inkKind = (s) => ((s.t === "t") ? "текст" : "штрих");
    function canvasToHtml(src) {
      let d; try { d = JSON.parse(src); } catch (e) { return `<p class="vs-muted">Не удалось разобрать холст.</p>`; }
      const nodes = d.nodes || [], edges = d.edges || [];
      const kind = (n) => (n.type === "text" ? "текст" : n.type === "file" ? "файл" : n.type === "link" ? "ссылка" : n.type === "group" ? "группа" : n.type);
      const ink = Array.isArray(d.fpInk) ? d.fpInk : [];
      let inkHtml = "";
      if (ink.length) { let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9; for (const k of ink) { const b = inkBox(k); x0 = Math.min(x0, b[0]); y0 = Math.min(y0, b[1]); x1 = Math.max(x1, b[2]); y1 = Math.max(y1, b[3]); } const pad = Math.max(20, (x1 - x0) * 0.05); inkHtml = `<div class="vs-stats">Рисунок: <b>${ink.length}</b> объектов</div><svg class="vs-cmap" viewBox="${x0 - pad} ${y0 - pad} ${Math.max(40, x1 - x0 + pad * 2)} ${Math.max(40, y1 - y0 + pad * 2)}" preserveAspectRatio="xMidYMid meet">${ink.map((k) => inkSvg(k, "")).join("")}</svg>`; }
      return inkHtml + `<div class="vs-stats"><b>${nodes.length}</b> карточек · <b>${edges.length}</b> связей</div><div class="vs-cards">` +
        nodes.slice(0, 120).map((n) => `<div class="vs-card"><small>${esc(kind(n))}</small>${esc(n.type === "text" ? n.text : n.type === "file" ? n.file : n.type === "link" ? n.url : n.label || "").slice(0, 280).replace(/\n/g, "<br>")}</div>`).join("") + "</div>";
    }
    // a diff, with the place of each hunk: the section of the note it falls in, and a strip showing where in the file the changes are
    function diffToHtml(raw, text) {
      if (!raw.trim()) return `<p class="vs-muted">Изменений нет.</p>`;
      const doc = typeof text === "string" ? text.replace(/\r/g, "").split("\n") : null;
      const sectionAt = (n) => { if (!doc || !isMd) return ""; for (let k = Math.min(n, doc.length) - 1; k >= 0; k--) { const m = /^(#{1,6})\s+(.*)$/.exec(doc[k]); if (m) return m[2]; } return ""; };
      let add = 0, del = 0, a = 0, b = 0; const rows = [], marks = []; let cur = null;
      for (const l of raw.split("\n")) {
        let m;
        if ((m = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,(\d+))?/.exec(l))) {
          a = +m[1]; b = +m[2]; const len = m[3] == null ? 1 : +m[3]; const sec = sectionAt(b + 2);
          cur = { at: b, len, a: 0, d: 0 }; marks.push(cur);
          rows.push(`<div class="vs-hunk">строки <b>${b}−${b + Math.max(0, len - 1)}</b>${sec ? ` · раздел <span class="vs-sec">«${esc(sec)}»</span>` : ""}</div>`); continue;
        }
        if (/^(diff |index |--- |\+\+\+ |new file|deleted file|similarity|rename |old mode|new mode|\\ No newline)/.test(l) || l === "") continue;
        const c = l[0], t = l.slice(1);
        if (c === "+") { add++; if (cur) cur.a++; rows.push(`<div class="vs-d add"><span>${b++}</span><i>+</i>${esc(t) || "&nbsp;"}</div>`); }
        else if (c === "-") { del++; if (cur) cur.d++; rows.push(`<div class="vs-d del"><span>${a++}</span><i>−</i>${esc(t) || "&nbsp;"}</div>`); }
        else { rows.push(`<div class="vs-d"><span>${b}</span><i></i>${esc(t) || "&nbsp;"}</div>`); a++; b++; }
      }
      const total = Math.max(doc ? doc.length : 0, ...marks.map((x) => x.at + x.len), 1);
      const strip = `<div class="vs-map" title="где в файле изменения">${marks.map((x) => `<i class="${x.a && !x.d ? "a" : x.d && !x.a ? "d" : ""}" style="left:${((x.at - 1) / total * 100).toFixed(2)}%;width:${Math.max(0.4, x.len / total * 100).toFixed(2)}%"></i>`).join("")}</div><div class="vs-mapl"><span>начало файла</span><span>${marks.length} ${marks.length === 1 ? "место" : "мест"} изменений</span><span>конец</span></div>`;
      return `<div class="vs-stats"><span class="vs-add">+${add}</span> <span class="vs-del">−${del}</span> строк</div>${strip}<div class="vs-diff">${rows.join("")}</div>`;
    }
    // a canvas is a picture, not text: show what happened to which cards and links, and where on the board
    function canvasDiffHtml(prevText, curText) {
      let P = null, C;
      try { C = JSON.parse(curText); } catch (e) { return ""; }
      try { P = prevText == null ? null : JSON.parse(prevText); } catch (e) { P = null; }
      const cn = new Map((C.nodes || []).map((n) => [n.id, n])), pn = new Map(((P && P.nodes) || []).map((n) => [n.id, n]));
      const ce = new Map((C.edges || []).map((n) => [n.id, n])), pe = new Map(((P && P.edges) || []).map((n) => [n.id, n]));
      const kind = (n) => (n.type === "text" ? "текст" : n.type === "file" ? "файл" : n.type === "link" ? "ссылка" : n.type === "group" ? "группа" : n.type || "карточка");
      const title = (n) => String(n.type === "text" ? n.text : n.type === "file" ? n.file : n.type === "link" ? n.url : n.label || "").replace(/\s+/g, " ").trim().slice(0, 70) || "без текста";
      // the drawing: strokes that are new, gone, or the same (a stroke has no id: it is compared by what it looks like)
      const Cink = Array.isArray(C.fpInk) ? C.fpInk : [], Pink = P && Array.isArray(P.fpInk) ? P.fpInk : [];
      const left = new Map(); for (const k of Pink) { const key = JSON.stringify(k); left.set(key, (left.get(key) || 0) + 1); }
      const inkItems = Cink.map((k) => { const key = JSON.stringify(k), n = left.get(key) || 0; if (n > 0) { left.set(key, n - 1); return { k, c: "" }; } return { k, c: "a" }; });
      const gone = new Map(); for (const k of Pink) { const key = JSON.stringify(k), n = left.get(key) || 0; if (n > 0) { left.set(key, n - 1); inkItems.push({ k, c: "d" }); } }
      void gone;
      const ia = inkItems.filter((x) => x.c === "a"), id_ = inkItems.filter((x) => x.c === "d");
      const state = new Map(); const rows = [];
      const body = (n) => (n.type === "text" ? n.text : n.type === "file" ? n.file + "|" + (n.subpath || "") : n.type === "link" ? n.url : n.label) || "";
      const row = (cls, tag, n, how) => rows.push(`<div class="vs-crow"><span class="vs-st ${cls}">${cls === "a" ? "+" : cls === "d" ? "−" : "•"}</span><small>${esc(tag)}</small><span>${esc(title(n))}</span><span class="vs-how">${esc(how)}</span></div>`);
      let na = 0, nd = 0, nm = 0;
      for (const [id, n] of cn) {
        const o = pn.get(id);
        if (!o) { state.set(id, "a"); na++; row("a", kind(n), n, "добавлена"); continue; }
        const how = [];
        if (body(o) !== body(n)) how.push(n.type === "text" ? "изменён текст" : "изменено содержимое");
        if (o.x !== n.x || o.y !== n.y) how.push("перемещена");
        if (o.width !== n.width || o.height !== n.height) how.push("изменён размер");
        if (o.color !== n.color) how.push("другой цвет");
        if (how.length) { state.set(id, "m"); nm++; row("m", kind(n), n, how.join(", ")); }
      }
      for (const [id, n] of pn) if (!cn.has(id)) { state.set(id, "d"); nd++; row("d", kind(n), n, "удалена"); }
      let ea = 0, ed = 0, em = 0; const estate = new Map();
      const label = (e, nodes) => { const f = nodes.get(e.fromNode), t = nodes.get(e.toNode); return (f ? title(f).slice(0, 24) : "?") + " → " + (t ? title(t).slice(0, 24) : "?"); };
      const allN = new Map([...pn, ...cn]);
      for (const [id, e] of ce) { const o = pe.get(id); if (!o) { ea++; estate.set(id, "a"); rows.push(`<div class="vs-crow"><span class="vs-st a">+</span><small>связь</small><span>${esc(label(e, allN))}</span><span class="vs-how">добавлена</span></div>`); } else if (JSON.stringify(o) !== JSON.stringify(e)) { em++; rows.push(`<div class="vs-crow"><span class="vs-st m">•</span><small>связь</small><span>${esc(label(e, allN))}</span><span class="vs-how">изменена форма или стрелки</span></div>`); } }
      for (const [id, e] of pe) if (!ce.has(id)) { ed++; estate.set(id, "d"); rows.push(`<div class="vs-crow"><span class="vs-st d">−</span><small>связь</small><span>${esc(label(e, allN))}</span><span class="vs-how">удалена</span></div>`); }
      // the board, with every changed card marked where it is
      const items = [];
      for (const [id, n] of cn) items.push({ n, c: state.get(id) || "" });
      for (const [id, n] of pn) if (!cn.has(id)) items.push({ n, c: "d" });
      for (const [id, n] of cn) { const o = pn.get(id); if (o && (o.x !== n.x || o.y !== n.y)) items.push({ n: o, c: "g" }); }
      let svg = "";
      if (items.length || inkItems.length) {
        let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
        for (const { n } of items) { x0 = Math.min(x0, n.x); y0 = Math.min(y0, n.y); x1 = Math.max(x1, n.x + (n.width || 250)); y1 = Math.max(y1, n.y + (n.height || 60)); }
        for (const { k } of inkItems) { const b = inkBox(k); x0 = Math.min(x0, b[0]); y0 = Math.min(y0, b[1]); x1 = Math.max(x1, b[2]); y1 = Math.max(y1, b[3]); }
        const pad = Math.max(40, (x1 - x0) * 0.04);
        const ctr = (n) => [n.x + (n.width || 250) / 2, n.y + (n.height || 60) / 2];
        const lines = [];
        for (const [id, e] of ce) { const f = cn.get(e.fromNode), t = cn.get(e.toNode); if (f && t) { const [ax, ay] = ctr(f), [bx, by] = ctr(t); lines.push(`<line class="e ${estate.get(id) || ""}" x1="${ax}" y1="${ay}" x2="${bx}" y2="${by}"/>`); } }
        for (const [id, e] of pe) if (!ce.has(id)) { const f = allN.get(e.fromNode), t = allN.get(e.toNode); if (f && t) { const [ax, ay] = ctr(f), [bx, by] = ctr(t); lines.push(`<line class="e d" x1="${ax}" y1="${ay}" x2="${bx}" y2="${by}"/>`); } }
        const sw = Math.max(1, (x1 - x0 + pad * 2) / 600);
        svg = `<svg class="vs-cmap" viewBox="${x0 - pad} ${y0 - pad} ${x1 - x0 + pad * 2} ${y1 - y0 + pad * 2}" preserveAspectRatio="xMidYMid meet" style="--sw:${sw}">${lines.join("")}${items.map(({ n, c }) => `<rect class="n ${c}" x="${n.x}" y="${n.y}" width="${n.width || 250}" height="${n.height || 60}" vector-effect="non-scaling-stroke"/>`).join("")}${inkItems.map(({ k, c }) => inkSvg(k, c)).join("")}</svg>`;
      }
      const head = P == null ? `<div class="vs-stats">Холст создан: <b>${cn.size}</b> карточек · <b>${ce.size}</b> связей</div>`
        : (na || nd || nm || ea || ed || em || ia.length || id_.length) ? `<div class="vs-stats">Карточки: <span class="vs-add">+${na}</span> <span class="vs-del">−${nd}</span> изменено ${nm} · связи: <span class="vs-add">+${ea}</span> <span class="vs-del">−${ed}</span>${em ? " изменено " + em : ""}</div>`
        : `<div class="vs-stats">Содержимое карточек и связей то же: поменялся вид (масштаб, служебные поля).</div>`;
      const inkHead = (ia.length || id_.length) ? `<div class="vs-stats">Рисунок: <span class="vs-add">+${ia.length}</span> <span class="vs-del">−${id_.length}</span> ${ia.length + id_.length === 1 ? "объект" : "объектов"}${ia.some((x) => x.k.t === "t") ? " (есть текст)" : ""}</div>` : (Cink.length ? `<div class="vs-stats">Рисунок без изменений: ${Cink.length} объектов</div>` : "");
      const legend = `<div class="vs-legend"><span class="a">добавлено</span><span class="m">изменено / перемещено</span><span class="d">удалено</span></div>`;
      return head + inkHead + svg + legend + rows.join("");
    }

    const wrap = document.createElement("div");
    wrap.className = "modal-container mod-dim";
    wrap.innerHTML = '<div class="modal-bg"></div><div class="modal vs-history"><div class="modal-close-button"></div><div class="vs-head"><div class="vs-title"></div><div class="vs-sub"></div></div><div class="vs-body"><div class="vs-list"></div><div class="vs-main"><div class="vs-meta"></div><div class="vs-bar"></div><div class="vs-view"></div></div></div></div>';
    const q = (s) => wrap.querySelector(s);
    const css = document.createElement("style");
    css.textContent = HISTORY_CSS;
    wrap.appendChild(css);
    q(".vs-title").textContent = rel.split("/").pop();
    q(".vs-sub").textContent = `${rel} · ${plural(list.length, "версия", "версии", "версий")}`;
    const listEl = q(".vs-list"), meta = q(".vs-meta"), bar = q(".vs-bar"), view = q(".vs-view");
    const mk = (txt, cls) => { const b = document.createElement("button"); b.textContent = txt; b.className = cls || ""; return b; };
    const isMd = /\.md$/i.test(rel), isCanvas = /\.canvas$/i.test(rel), isImg = /\.(png|jpe?g|gif|webp|bmp|ico|svg)$/i.test(rel), binary = BINARY_EXT.test(rel) && !isImg;
    const tabs = [["changes", "Что изменилось"], ["view", "Как выглядело"], ["now", "Сравнить с текущей"], ["src", "Исходник"]].filter(([k]) => !(isImg || binary) || k === "view");
    const tabBtns = {};
    tabs.forEach(([k, label]) => { const b = mk(label, "vs-tab"); b.addEventListener("click", () => { mode = k; render(); }); tabBtns[k] = b; bar.appendChild(b); });
    bar.appendChild(Object.assign(document.createElement("span"), { className: "vs-gap" }));
    const copyBtn = mk("Копировать"), restoreBtn = mk("Восстановить эту версию", "mod-cta");
    if (!isImg && !binary) bar.appendChild(copyBtn);
    bar.appendChild(restoreBtn);
    const prevFocus = document.activeElement; const close = () => { wrap.remove(); try { prevFocus && prevFocus.focus && prevFocus.focus(); } catch (e) { /* gone */ } };
    q(".modal-close-button").addEventListener("click", close);
    q(".modal-bg").addEventListener("click", close);
    wrap.addEventListener("keydown", (e) => { if (e.key === "Escape") close(); });

    let pvLive = null, cur = null, mode = (isImg || binary) ? "view" : "changes", token = 0;
    const blob = (v) => histBuf(r, ["show", `${v.full}:${rel}`]);
    const render = async () => {
      if (!cur) return;
      const my = ++token;
      for (const [k, b] of Object.entries(tabBtns)) b.classList.toggle("is-on", k === mode);
      meta.innerHTML = `<span class="vs-chip ${cur.st}">${CHIP[cur.st]}</span><b>${esc(cur.subject || "(без описания)")}</b><br>${esc(new Date(cur.date).toLocaleString())} · ${esc(cur.author)} · <code>${esc(cur.short)}</code>`;
      if (pvLive) { pvLive.destroy(); pvLive = null; }
      view.textContent = "…";
      let html = "";
      try {
        if (mode === "changes" || mode === "now") {
          const text = cur.st === "d" && mode === "changes" ? null : await blob(cur).then((x) => x.toString("utf8")).catch(() => null);
          if (isCanvas && mode === "changes" && text != null) {
            const prev = cur.st === "a" ? null : await histBuf(r, ["show", `${cur.full}^:${rel}`]).then((x) => x.toString("utf8")).catch(() => null);
            html = canvasDiffHtml(prev, text) || diffToHtml(await histGit(r, ["show", "--format=", "--no-color", "-U4", cur.full, "--", rel]), text);
          } else html = diffToHtml(await histGit(r, mode === "changes" ? ["show", "--format=", "--no-color", "-U4", cur.full, "--", rel] : ["diff", "--no-color", "-U4", cur.full, "--", rel]), mode === "changes" ? text : null);
        }
        else if (isImg) { const b = await blob(cur); const url = URL.createObjectURL(new Blob([b], { type: "image/" + (rel.split(".").pop().toLowerCase().replace("jpg", "jpeg").replace("svg", "svg+xml")) })); html = `<img src="${url}">`; }
        else if (binary) html = '<p class="vs-muted">Двоичный файл: просмотр недоступен, но эту версию можно восстановить.</p>';
        else {
          const text = (await blob(cur)).toString("utf8");
          html = mode === "src" ? `<pre class="vs-code">${esc(text)}</pre>` : isMd ? mdToHtml(text) : isCanvas ? canvasToHtml(text) : `<pre class="vs-code">${esc(text)}</pre>`;
        }
      } catch (e) { html = `<p class="vs-muted">Не удалось прочитать версию: ${esc(e.message)}</p>`; }
      if (my === token && isCanvas && mode === "view" && window.__fpMountPreview && !/vs-muted/.test(html)) {
        const tf = app.vault.getAbstractFileByPath(rel), text = html && (await blob(cur).then((x) => x.toString("utf8")).catch(() => null));
        if (tf && text != null && my === token) { view.innerHTML = ""; view.classList.add("vs-live"); const P = await window.__fpMountPreview(tf, view, text); if (P && my === token) { pvLive = P; return; } if (P) P.destroy(); view.innerHTML = html; return; }
      }
      view.classList.remove("vs-live");
      if (my === token) view.innerHTML = html;
    };
    const fmtDay = (d) => { const t = new Date(); const dd = new Date(d); const days = Math.round((new Date(t.getFullYear(), t.getMonth(), t.getDate()) - new Date(dd.getFullYear(), dd.getMonth(), dd.getDate())) / 864e5); return days === 0 ? "Сегодня" : days === 1 ? "Вчера" : dd.toLocaleDateString(undefined, { day: "numeric", month: "long", year: dd.getFullYear() === t.getFullYear() ? undefined : "numeric" }); };
    let lastDay = "";
    const itemEl = (v, first) => {
      const it = document.createElement("div"); it.className = "vs-item";
      it.innerHTML = '<div class="vs-s"></div><small></small><div class="vs-mrow"></div>';
      it.firstChild.textContent = (v.subject || "(без описания)").replace(/^(Создано|Удалено|Изменено): [^(→\n]*?(?= \(|$)/, "$1").replace(/ \(\+(\d+) −(\d+)\)/, " · +$1 −$2");
      it.children[1].innerHTML = `<span class="vs-chip ${v.st}">${CHIP[v.st]}</span>${esc(hhmm(v.date))} · ${esc(v.author)}${first ? ' · <span class="vs-cur">текущая</span>' : ""}`;
      it.lastChild.innerHTML = magHtml(v.add, v.del);
      it.addEventListener("click", (e) => { e.stopPropagation(); listEl.querySelectorAll(".vs-item").forEach((x) => x.classList.remove("is-active")); it.classList.add("is-active"); cur = v; render(); });
      return it;
    };
    let idx = 0;
    for (const g of burstGroups(list)) {
      const day = fmtDay(g.items[0].date);
      if (day !== lastDay) { lastDay = day; const dh = document.createElement("div"); dh.className = "vs-day"; dh.textContent = day; listEl.appendChild(dh); }
      if (g.items.length === 1) { listEl.appendChild(itemEl(g.items[0], idx === 0)); idx++; continue; }
      const add = g.items.reduce((n, x) => n + (x.add || 0), 0), del = g.items.reduce((n, x) => n + (x.del || 0), 0);
      const grp = document.createElement("div"); grp.className = "vs-grp";
      const gh = document.createElement("div"); gh.className = "vs-gh";
      gh.innerHTML = `<span class="vs-n">${plural(g.items.length, "правка", "правки", "правок")}</span><small class="vs-sum">${esc(hhmm(g.items[g.items.length - 1].date))}−${esc(hhmm(g.items[0].date))}</small>${magHtml(add, del)}<span class="vs-car"></span>`;
      const gb = document.createElement("div"); gb.className = "vs-gb";
      g.items.forEach((v, k) => gb.appendChild(itemEl(v, idx === 0 && k === 0)));
      idx += g.items.length;
      gh.addEventListener("click", () => { grp.classList.toggle("is-open"); });
      grp.append(gh, gb); listEl.appendChild(grp);
    }
    copyBtn.addEventListener("click", async () => { if (!cur) return; try { await navigator.clipboard.writeText((await blob(cur)).toString("utf8")); toast("Скопировано"); } catch (e) { toast(e.message); } });
    restoreBtn.addEventListener("click", async () => {
      if (!cur) return;
      if (!(await window.__bsConfirm(`Заменить текущий файл версией от ${new Date(cur.date).toLocaleString()}? Текущее содержимое уйдёт в следующую синхронизацию как новая версия, так что к нему можно будет вернуться.`))) return;
      try {
        const dest = path.join(r.path, rel);
        fs.mkdirSync(path.dirname(dest), { recursive: true });
        fs.writeFileSync(dest, await blob(cur));
        toast("Версия восстановлена"); close();
      } catch (e) { toast("Не удалось восстановить: " + e.message); }
    });
    document.body.appendChild(wrap);
    listEl.querySelector(".vs-item").click();
    { const f = listEl.querySelector(".vs-item"); const g = f.closest(".vs-grp"); if (g) g.classList.add("is-open"); }
  }
  window.__vaultSyncHistory = showFileHistory;

  // ---- Version feed of the whole vault: working sessions (a burst of saves folded into one card), what each touched and where
  const FEED_CSS = HISTORY_CSS +
    ".vs-feed{width:min(940px,94vw);max-width:none;height:min(740px,90vh);display:flex;flex-direction:column;padding:0}.vs-feed .vs-top{display:flex;gap:10px;align-items:center;padding:12px 24px;border-bottom:1px solid var(--background-modifier-border)}.vs-feed .vs-top input{flex:1}" +
    ".vs-feed .vs-scroll{flex:1;overflow:auto;padding:6px 24px 20px}.vs-feed .vs-day{margin-left:0}" +
    ".vs-card2{position:relative;margin:8px 0;padding:11px 14px;background:var(--background-secondary);border:1px solid var(--background-modifier-border);border-left:3px solid var(--text-faint);cursor:pointer}.vs-card2:hover{background:var(--background-modifier-hover)}.vs-card2.a{border-left-color:var(--color-green,#4caf50)}.vs-card2.d{border-left-color:var(--color-red,#e5534b)}.vs-card2.m{border-left-color:var(--interactive-accent)}.vs-card2.is-open{background:var(--background-primary-alt, var(--background-secondary))}" +
    ".vs-card2 .vs-ch{display:flex;gap:10px;align-items:baseline}.vs-card2 .vs-ch b{flex:1;font-weight:500;overflow:hidden;text-overflow:ellipsis}.vs-card2 .vs-ch small{color:var(--text-muted);white-space:nowrap}.vs-card2 .vs-sum{color:var(--text-muted);font-size:var(--font-ui-smaller)}.vs-card2 .vs-chips{margin-top:6px;display:flex;flex-wrap:wrap;gap:4px 0;align-items:center}" +
    ".vs-files{margin-top:10px;display:flex;flex-direction:column;gap:2px}.vs-file{display:flex;gap:8px;align-items:center;padding:4px 8px;background:var(--background-primary)}.vs-file .vs-fn{flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.vs-file .vs-dir{color:var(--text-faint)}.vs-file button{padding:1px 8px;font-size:var(--font-ui-smaller)}" +
    ".vs-st{width:16px;text-align:center;font-weight:600}.vs-st.a{color:var(--color-green,#4caf50)}.vs-st.d{color:var(--color-red,#e5534b)}.vs-st.m{color:var(--interactive-accent)}" +
    ".vs-saves{margin-top:10px;border-top:1px dashed var(--background-modifier-border);padding-top:6px}.vs-save{display:flex;gap:8px;align-items:baseline;padding:3px 0;font-size:var(--font-ui-smaller)}.vs-save time{color:var(--text-faint);flex:none;width:44px}.vs-save span.t{flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.vs-save button{padding:0 8px;font-size:var(--font-ui-smaller)}" +
    ".vs-acts{display:flex;gap:8px;margin-top:10px}.vs-more{margin:14px auto;display:block}";

  async function showVaultFeed() {
    const r = findRepo() || { path: vaultPath(), name: path.basename(vaultPath() || "vault") };
    if (!(await hasHistory(r))) { toast("Лента версий берётся из git-репозитория хранилища. Подключите синхронизацию в настройках."); return; }
    const esc = (t) => String(t).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    const wrap = document.createElement("div");
    wrap.className = "modal-container mod-dim";
    wrap.innerHTML = '<div class="modal-bg"></div><div class="modal vs-feed"><div class="modal-close-button"></div><div class="vs-head"><div class="vs-title">Журнал действий</div><div class="vs-sub"></div></div><div class="vs-top"><input type="text" placeholder="Поиск по описанию, автору или имени файла…"></div><div class="vs-scroll"></div></div>';
    const css = document.createElement("style"); css.textContent = FEED_CSS; wrap.appendChild(css);
    const q = (x) => wrap.querySelector(x);
    const prevFocus = document.activeElement; const close = () => { wrap.remove(); try { prevFocus && prevFocus.focus && prevFocus.focus(); } catch (e) { /* gone */ } };
    q(".modal-close-button").addEventListener("click", close);
    q(".modal-bg").addEventListener("click", close);
    wrap.addEventListener("keydown", (e) => { if (e.key === "Escape") close(); });
    const scroll = q(".vs-scroll"), search = q("input"), sub = q(".vs-sub");
    document.body.appendChild(wrap);

    const PAGE = 80;
    let commits = [], skip = 0, done = false, loading = false;
    async function loadMore() {
      if (loading || done) return;
      loading = true;
      try {
        const out = await histGit(r, ["log", `--max-count=${PAGE}`, `--skip=${skip}`, "--no-renames", "--raw", "--numstat", "--pretty=format:@@%H%x1f%h%x1f%aI%x1f%an%x1f%s"]);
        const got = parseLog(out);
        commits.push(...got);
        skip += PAGE;
        if (got.length < PAGE) done = true;
      } catch (e) { toast("Не удалось прочитать ленту: " + e.message); done = true; }
      loading = false;
    }
    const fmtDay = (d) => { const t = new Date(), dd = new Date(d); const days = Math.round((new Date(t.getFullYear(), t.getMonth(), t.getDate()) - new Date(dd.getFullYear(), dd.getMonth(), dd.getDate())) / 864e5); return days === 0 ? "Сегодня" : days === 1 ? "Вчера" : dd.toLocaleDateString(undefined, { day: "numeric", month: "long", year: dd.getFullYear() === t.getFullYear() ? undefined : "numeric" }); };
    const open = new Set();
    const sum = (files) => ({ add: files.reduce((n, x) => n + (x.add || 0), 0), del: files.reduce((n, x) => n + (x.del || 0), 0), a: files.filter((x) => x.st === "a").length, d: files.filter((x) => x.st === "d").length, m: files.filter((x) => x.st === "m").length });
    // one file of a session: what it was (created / changed / deleted), where it is, how much changed
    const fileRow = (x) => {
      const row = document.createElement("div"); row.className = "vs-file";
      const i = x.path.lastIndexOf("/"), dir = i >= 0 ? x.path.slice(0, i + 1) : "", name = x.path.slice(i + 1);
      row.innerHTML = `<span class="vs-st ${x.st}">${x.st === "a" ? "+" : x.st === "d" ? "−" : "•"}</span><span class="vs-fn"><span class="vs-dir"></span><b></b></span>${magHtml(x.add, x.del)}`;
      row.querySelector(".vs-dir").textContent = dir; row.querySelector("b").textContent = name; row.title = x.path;
      const hist = document.createElement("button"); hist.textContent = "История";
      hist.addEventListener("click", (e) => { e.stopPropagation(); showFileHistory(x.path); });
      row.appendChild(hist);
      if (x.st !== "d") { const op = document.createElement("button"); op.textContent = "Открыть"; op.addEventListener("click", (e) => { e.stopPropagation(); try { app.workspace.openLinkText(x.path, "", false); close(); } catch (err) { toast(err.message); } }); row.appendChild(op); }
      return row;
    };
    const chipsHtml = (s) => [s.a ? `<span class="vs-chip a">создано ${s.a}</span>` : "", s.m ? `<span class="vs-chip m">изменено ${s.m}</span>` : "", s.d ? `<span class="vs-chip d">удалено ${s.d}</span>` : ""].join("") + magHtml(s.add, s.del);
    const actions = (c) => {
      const acts = document.createElement("div"); acts.className = "vs-acts";
      if (!J.ready) return acts;
      const undo = document.createElement("button"); undo.textContent = "Отменить это действие";
      undo.addEventListener("click", async (e) => { e.stopPropagation(); if (!(await window.__bsConfirm("Вернуть файлы этой записи к тому, какими они были до неё? Более поздние правки этих файлов будут потеряны (но останутся в журнале)."))) return; try { const n = await journalRevert(c.full); toast(`Отменено: ${plural(n, "файл", "файла", "файлов")}`); } catch (err) { toast(err.message); } });
      const back = document.createElement("button"); back.className = "mod-warning"; back.textContent = "Откатить хранилище сюда";
      back.addEventListener("click", async (e) => { e.stopPropagation(); if (!(await window.__bsConfirm(`Вернуть всё хранилище к состоянию «${c.subject}» от ${new Date(c.date).toLocaleString()}? Сейчас будет сделан снимок, так что откат тоже можно отменить из журнала.`))) return; try { const n = await journalRollback(c.full); toast(`Откат выполнен: затронуто ${plural(n, "файл", "файла", "файлов")}`); close(); } catch (err) { toast(err.message); } });
      acts.append(undo, back); return acts;
    };
    // the final state of a session's files: created then deleted inside it = nothing to show
    const merged = (items) => {
      const map = new Map();
      for (const c of items.slice().reverse()) for (const x of c.files) {
        const o = map.get(x.path);
        if (!o) map.set(x.path, { ...x });
        else { o.add = o.add == null || x.add == null ? null : o.add + x.add; o.del = o.del == null || x.del == null ? null : o.del + x.del; o.st = x.st === "d" ? "d" : o.st === "a" ? "a" : "m"; }
      }
      return Array.from(map.values());
    };
    function render() {
      const f = search.value.trim().toLowerCase();
      const shown = commits.filter((c) => !f || c.subject.toLowerCase().includes(f) || c.author.toLowerCase().includes(f) || c.files.some((x) => x.path.toLowerCase().includes(f)));
      const groups = burstGroups(shown);
      sub.textContent = `${plural(shown.length, "запись", "записи", "записей")} · ${plural(groups.length, "сеанс", "сеанса", "сеансов")}${done ? "" : " и больше"} · ${r.name}`;
      scroll.textContent = "";
      let last = "";
      for (const g of groups) {
        const day = fmtDay(g.items[0].date);
        if (day !== last) { last = day; const h = document.createElement("div"); h.className = "vs-day"; h.textContent = day; scroll.appendChild(h); }
        const files = g.items.length === 1 ? g.items[0].files : merged(g.items), s = sum(files);
        const key = g.items[0].full, isOpen = open.has(key);
        const el = document.createElement("div"); el.className = "vs-card2 " + (s.d && !s.a && !s.m ? "d" : s.a && !s.m && !s.d ? "a" : "m") + (isOpen ? " is-open" : "");
        const head = g.items.length === 1 ? g.items[0].subject || "(без описания)" : `${plural(g.items.length, "правка", "правки", "правок")} за сеанс · ${plural(files.length, "файл", "файла", "файлов")}`;
        const when = g.items.length === 1 ? hhmm(g.items[0].date) : `${hhmm(g.items[g.items.length - 1].date)}−${hhmm(g.items[0].date)}`;
        el.innerHTML = `<div class="vs-ch"><b></b><small>${esc(when)} · ${esc(g.author)}${g.items.length === 1 ? ` · <code>${esc(g.items[0].short)}</code>` : ""}</small></div><div class="vs-chips">${chipsHtml(s)}</div>`;
        el.querySelector("b").textContent = head;
        if (isOpen) {
          const fl = document.createElement("div"); fl.className = "vs-files";
          for (const x of files.slice(0, 200)) fl.appendChild(fileRow(x));
          el.appendChild(fl);
          if (g.items.length === 1) el.appendChild(actions(g.items[0]));
          else {
            const sv = document.createElement("div"); sv.className = "vs-saves";
            for (const c of g.items) {
              const row = document.createElement("div"); row.className = "vs-save";
              row.innerHTML = `<time>${esc(hhmm(c.date))}</time><span class="t"></span>`;
              row.querySelector(".t").textContent = c.subject || "(без описания)";
              if (J.ready) {
                const u = document.createElement("button"); u.textContent = "Отменить";
                u.addEventListener("click", async (e) => { e.stopPropagation(); if (!(await window.__bsConfirm("Вернуть файлы этой записи к тому, какими они были до неё?"))) return; try { const n = await journalRevert(c.full); toast(`Отменено: ${plural(n, "файл", "файла", "файлов")}`); } catch (err) { toast(err.message); } });
                const b = document.createElement("button"); b.textContent = "Откатить сюда";
                b.addEventListener("click", async (e) => { e.stopPropagation(); if (!(await window.__bsConfirm(`Вернуть всё хранилище к состоянию от ${new Date(c.date).toLocaleString()}? Сейчас будет сделан снимок, так что откат можно отменить из журнала.`))) return; try { const n = await journalRollback(c.full); toast(`Откат выполнен: затронуто ${plural(n, "файл", "файла", "файлов")}`); close(); } catch (err) { toast(err.message); } });
                row.append(u, b);
              }
              sv.appendChild(row);
            }
            el.appendChild(sv);
          }
        }
        el.addEventListener("click", () => { if (open.has(key)) open.delete(key); else open.add(key); render(); });
        scroll.appendChild(el);
      }
      if (!shown.length) scroll.textContent = commits.length ? "Ничего не найдено в загруженных версиях." : "В репозитории ещё нет ни одной версии.";
      if (!done) { const more = document.createElement("button"); more.className = "vs-more"; more.textContent = "Загрузить ещё"; more.addEventListener("click", async () => { more.disabled = true; await loadMore(); render(); }); scroll.appendChild(more); }
    }
    search.addEventListener("input", render);
    await loadMore(); render(); search.focus();
  }
  window.__vaultSyncFeed = showVaultFeed;


  window.__vaultSync = { journal: { start: startJournal, commit: journalCommit, revert: journalRevert, rollback: journalRollback, stats: journalStats, J, setCfg: (c) => { cfg = c; } }, runHooksNow, runHooks, hooksOf, hookWants, rollbackPull, cfg: () => cfg, state: () => state, findRepo, ensureRepo, pull, push, sync, resolve, status, connect, backups, restoreBackup, pruneBackups, undoLastCommit, autoCommit, tick, startWatcher, stopWatcher, log: () => ring, summary, detail, home, git, applyExcludes, saveConfig, matchesAny, shouldReport, notify, set: (c) => { cfg = c; } };

  const wait = setInterval(() => {
    if (window.app && app.workspace && app.vault && app.setting && app.statusBar && app.setting.pluginTabs && app.setting.pluginTabs.length) {
      clearInterval(wait);
      app.workspace.onLayoutReady(() => boot().catch((e) => console.error("[vault-sync] boot failed", e)));
    }
  }, 250);
})();
