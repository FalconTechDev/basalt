// i18n plumbing that used to live in the inherited bundle scope (slice g39).
//
// Owns: the "language" localStorage key and the en/ru UI language table, the detected
// current/stored language helpers, the i18next resource bundle flattening, the lazy
// translation proxy (gm/t), the locale display-name lookup (ym), and the small
// Electron helpers around spellcheck languages, clipboard and reveal-in-folder.
//
// Everything the rest of the app sees keeps the original contract: same storage key,
// same i18next calls, same proxy shape, same display strings.
import { env } from "./env.js";
import { toKebab } from "./text.js";

/** localStorage key holding the chosen UI language (was Xf = "language"). */
export const ng39LanguageStorageKey = "language";

/** The fallback UI language (was $f = "en"). */
export const ng39FallbackLanguage = "en";

/** Human-readable labels for the supported UI languages (was Zf). */
export const ng39LanguageNames = { en: "English", ru: "Русский" };

/** Sorted list of supported language codes (was Jf = Object.keys(Zf).sort()). */
export const ng39SupportedLanguages = Object.keys(ng39LanguageNames).sort();

/** Locale-code -> moment-locale aliases; starts empty, other code may fill it (was em = {}). */
export const ng39LocaleAliasMap = {};

/** RTL language codes consulted by applyLanguage (was tm = []). */
export const ng39RtlLanguages = [];

/** i18next interpolation override used by option descriptions (was nm). */
export const ng39InterpolationOverride = { interpolation: { prefix: "{{{{", suffix: "}}}}" } };

/** i18next namespace for the app strings (was im = "default"). */
export const ng39ResourceNamespace = "default";

/** Resolved once the bundle finished its own deferred setup (was um = Promise.resolve()). */
export const ng39InitReady = Promise.resolve();

function ng39IsString(v) {
  return typeof v === "string" || v instanceof String;
}

/** The app's translation strings as a flat kebab-cased resource bundle (was om). */
let ng39ResourceBundle = null;
export function ng39I18nResourceBundle() {
  if (ng39ResourceBundle) return ng39ResourceBundle;
  const flatten = (node) => {
    const out = {};
    for (const key in node) {
      if (!node.hasOwnProperty(key)) continue;
      const flat = toKebab(key);
      const value = node[key];
      out[flat] = ng39IsString(value) ? value : flatten(value);
    }
    return out;
  };
  ng39ResourceBundle = flatten(window.BASALT_I18N || {});
  return ng39ResourceBundle;
}

/** Flattens the Russian bundle, folding `_plural0/1/2` suffixes onto the kebab base key. */
function ng39FlattenRuBundle(node) {
  const out = {};
  for (const key in node) {
    if (!node.hasOwnProperty(key)) continue;
    const plural = /^(.*)_plural([012])$/.exec(key);
    const flat = plural ? toKebab(plural[1]) + "_" + plural[2] : toKebab(key);
    const value = node[key];
    out[flat] = ng39IsString(value) ? value : ng39FlattenRuBundle(value);
  }
  return out;
}

/**
 * Registers the app string bundles with i18next: the default (English) bundle under
 * "en", plus the Russian bundle under "ru" when present, switching to it right away
 * when it is the detected UI language (was am).
 */
export function ng39RegisterDefaultBundle() {
  // a string nobody translated reads as words ("Bring to front"), never as its internal key ("plugins.canvas.action-bring-to-front")
  i18next.options.parseMissingKeyHandler = (key) => {
    const last = String(key).split(".").pop().replace(/^(action|menu|label|tooltip|option|command|msg|setting|title)-/, "").replace(/[-_]+/g, " ").trim();
    return last ? last.charAt(0).toUpperCase() + last.slice(1) : String(key);
  };
  i18next.addResourceBundle(ng39FallbackLanguage, ng39ResourceNamespace, ng39I18nResourceBundle());
  if (window.BASALT_I18N_RU) {
    i18next.addResourceBundle("ru", ng39ResourceNamespace, ng39FlattenRuBundle(window.BASALT_I18N_RU));
    if (ng39CurrentLanguage() === "ru") i18next.changeLanguage("ru");
  }
}

/** The UI language to use right now: stored choice or detected (was sm). */
export function ng39CurrentLanguage() {
  const stored = localStorage.getItem(ng39LanguageStorageKey);
  return stored && ng39SupportedLanguages.includes(stored) ? stored : ng39DetectLanguage();
}

/** Persists a UI language choice; a plain "en" on an English system is not stored (was lm). */
export function ng39StoreLanguage(lang) {
  if (lang === ng39FallbackLanguage && ng39DetectLanguage() === ng39FallbackLanguage) {
    localStorage.removeItem(ng39LanguageStorageKey);
  } else {
    localStorage.setItem(ng39LanguageStorageKey, lang);
  }
}

/** Picks a supported language from the OS locale (was cm). */
export function ng39DetectLanguage() {
  const locale = navigator.language;
  if (ng39SupportedLanguages.includes(locale)) return locale;
  const base = locale.split("-")[0];
  return ng39SupportedLanguages.includes(base) ? base : ng39FallbackLanguage;
}

// -- lazy translation proxy (was gm / the `t` host export) --------------------

function ng39I18nNode(prefix, target) {
  const cache = {};
  return new Proxy(target, {
    get(node, key) {
      if (cache.hasOwnProperty(key)) return cache[key];
      const kebab = toKebab(key);
      return (cache[key] = ng39I18nNode(prefix + kebab + ".", function (first, second) {
        return ng39IsString(first)
          ? i18next.t(prefix + kebab + "." + first, second)
          : i18next.t(prefix + kebab, first);
      }));
    },
  });
}

/** The root of the lazy `t` proxy tree, e.g. `t.editor.printModal` (was gm). */
export function ng39CreateI18nProxy() {
  return ng39I18nNode("", i18next.t.bind(i18next));
}

// -- Electron helpers ---------------------------------------------------------

/** Restricts the spell checker to the given languages on non-Apple desktops (was Kf). */
export function ng39ApplySpellcheckerLanguages(languages) {
  if (env().jl || !window.electron) return;
  const session = window.electron.remote.getCurrentWebContents().session;
  const available = session.availableSpellCheckerLanguages;
  if (!languages || languages.length === 0) {
    languages = [window.electron.remote.app.getLocale()];
  }
  const picked = languages.filter((lang) => available.contains(lang));
  session.setSpellCheckerLanguages(picked);
}

/** Opens the containing folder of a path in the OS file manager (was Yf). */
export function ng39RevealInFolder(path) {
  if (window.electron) window.electron.remote.shell.showItemInFolder(path);
}

/** The clipboard object for the running Electron version (was Qf). */
export function ng39ClipboardBridge() {
  return env().qf < 40 ? window.electron.clipboard : window.electron.remote.clipboard;
}
