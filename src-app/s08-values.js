// The "Bases" property values and the formula engine glue.
//
// Own reimplementation of the inherited value classes (Any/String/Number/Boolean/List/Object/Date/Duration/File/Link/URL/
// Image/RegExp/Null/Error/Tag(s)/Markdown/HTML), the formula function registry and function base classes, the formula
// editor's autocompletion suggester, the document-search bar base class, the link renderer used by `renderTo`, and the
// small helpers they share (JS value -> property value coercion, key glob -> regex, shallow clone, DOM child list,
// formula context lookup, cm5/cm6 tag range bridge, formula parameter spec builders).
//
// Class factories receive `host` (the application scope, via manifest.host); plain functions reach it lazily through
// `env()` (manifest.envBind). Every class is written as a constructor function + `inherit`/`methods` because inherited
// code still derives from some of them with `Base.call(this)`.
import { inherit, methods } from "./inherit.js";
import { env } from "./env.js";

// ---------------------------------------------------------------------------
// helpers (manifest "entries")
// ---------------------------------------------------------------------------

/** JS value -> property value (the lazy coercion used by List/Object). */
export function s08JsToValue(value) {
  const e = env();
  if (value == null || typeof value === "function") return e.bW.value;
  if (String.isString(value)) return new e.CW(value);
  if (Number.isNumber(value)) return new e.EW(value);
  if (value === true || value === false) return new e.MW(value);
  if (Array.isArray(value)) return new e.SW(value.slice());
  if (value instanceof Date) return new e.LW(new Date(value));
  if (typeof value === "object") return new e.AW(Object.assign({}, value));
  throw new Error("Value type is unsupported " + String(value));
}

/** Object-key glob ("a*b") -> RegExp source fragment matching one key. */
export function s08KeyGlob(pattern) {
  let body = Object.keys(pattern).join("");
  const hasWord = /\w/.test(body);
  if (hasWord) body = body.replace(/\w/g, "");
  return "[" + (hasWord ? "\\w" : "") + body.replace(/[^\w\s]/g, "\\$&") + "]";
}

/** Shallow clone: arrays sliced, other object values kept by reference. */
export function s08ShallowClone(value) {
  if (typeof value !== "object") return value;
  const out = {};
  for (const key in value) {
    const item = value[key];
    out[key] = item instanceof Array ? item.slice() : item;
  }
  return out;
}

/** childNodes -> plain array. */
export function s08ChildArray(node) {
  const out = [];
  for (let child = node == null ? void 0 : node.firstChild; child; child = child.nextSibling) out.push(child);
  return out;
}

/** Evaluate a formula source in a bases context; NullValue when it fails to parse or throws. */
export function s08FormulaValue(ctx, source) {
  const e = env();
  const holder = new e.DK(source);
  if (!(holder.formula instanceof e.RK)) {
    try { return holder.formula.getValue(ctx); } catch (err) { /* fall through to null */ }
  }
  return e.bW.value;
}

/** Bridge between the cm5-ish wrapper (`e.cm6`, `e.indexFromPos`) and the cm6 syntax tree:
 *  {open:{from,to},close:{from,to}} of the innermost OpenTag/CloseTag pair around pos, or undefined. */
export function s08TagRange(wrapper, pos) {
  const e = env();
  const state = wrapper.cm6.state;
  let at = wrapper.indexFromPos(pos);
  if (at < state.doc.length && "<" === state.sliceDoc(at, at + 1)) at++;
  const top = e.np(state, at);
  let cur = (top == null ? void 0 : top.resolve(at)) || null;
  for (; cur; cur = cur.parent) {
    const first = cur.firstChild, last = cur.lastChild;
    if (first && last && first.type.name === "OpenTag" && last.type.name === "CloseTag") {
      return { open: e.ej(state.doc, first), close: e.ej(state.doc, last) };
    }
  }
}

// formula parameter spec builders (name + typed value classes)
export function s08VariadicParam(name) {
  const type = Array.prototype.slice.call(arguments, 1);
  return [{ name, type, variadic: true }];
}
export function s08OptionalParam(name) {
  const type = Array.prototype.slice.call(arguments, 1);
  return { name, type, optional: true };
}
export function s08CustomWidgetParam(name, widget) {
  const type = Array.prototype.slice.call(arguments, 2);
  return { name, type, customWidget: widget };
}
export function s08TypedParam(name) {
  const type = Array.prototype.slice.call(arguments, 1);
  return { name, type };
}

// ---------------------------------------------------------------------------
// value classes
// ---------------------------------------------------------------------------

/** Root of every property value: icon, type tag, equality protocol, default render/objectAccess. */
export function s08AnyValue(host) {
  function AnyValue() { this.icon = "lucide-file-question"; }
  AnyValue.toString = function () { return this.type; };
  AnyValue.equals = function (a, b) { return a === b || (a && b && a.constructor === b.constructor && a.equals(b)); };
  AnyValue.looseEquals = function (a, b) {
    return a === b || (!(!a || !b) && (!(a.constructor !== b.constructor || !a.equals(b)) || (a.looseEquals(b) || b.looseEquals(a))));
  };
  AnyValue.prototype.equals = function () { return false; };
  AnyValue.prototype.looseEquals = function () { return false; };
  AnyValue.prototype.renderTo = function (el) { el.setText(this.toString()); };
  AnyValue.prototype.keys = function () { return []; };
  Object.defineProperty(AnyValue.prototype, "type", { get: function () { return this.constructor; }, enumerable: false, configurable: true });
  AnyValue.prototype.objectAccess = function () { return null; };
  AnyValue.type = "Any";
  return AnyValue;
}

/** Intermediate base between Any and the data-carrying values. */
export function s08Value(host) {
  function Value() { return host.gW.apply(this, arguments) || this; }
  inherit(Value, host.gW);
  return Value;
}

/** Scalar values that wrap a single `data` payload. */
export function s08ScalarValue(host) {
  function ScalarValue(data) {
    const self = host.wW.apply(this, arguments) || this;
    self.data = data;
    return self;
  }
  inherit(ScalarValue, host.wW);
  methods(ScalarValue, {
    toString() { return String(this.data); },
    isTruthy() { return !!this.data; },
    equals(other) { return this.data === other.data; },
    looseEquals(other) { return other instanceof ScalarValue && this.data == other.data; },
  });
  return ScalarValue;
}

/** String value; `length` is exposed to formulas. */
export function s08StringValue(host) {
  function StringValue() {
    const self = host.kW.apply(this, arguments) || this;
    self.icon = "lucide-text";
    return self;
  }
  inherit(StringValue, host.kW);
  methods(StringValue, {
    toString() { return this.data; },
    keys() { return host.gW.prototype.keys.call(this).concat(["length"]); },
    objectAccess(key) {
      return key.toLowerCase() === "length" ? new host.EW(this.data.length) : host.gW.prototype.objectAccess.call(this, key);
    },
    renderTo(el) { el.setText(this.data); },
  });
  StringValue.type = "String";
  return StringValue;
}

/** The singleton null value (the constructor throws on direct use). */
export function s08NullValue(host) {
  function NullValue() {
    const self = host.gW.apply(this, arguments) || this;
    if (NullValue.value) throw new Error("Use NullValue.value instead of creating a new NullValue.");
    return self;
  }
  inherit(NullValue, host.gW);
  methods(NullValue, {
    toString() { return "null"; },
    isTruthy() { return false; },
    equals() { return true; },
    renderTo() {},
  });
  NullValue.type = "Null";
  NullValue.value = new NullValue();
  return NullValue;
}

/** Finite numbers; non-finite render as ∞. */
export function s08NumberValue(host) {
  function NumberValue() {
    const self = host.kW.apply(this, arguments) || this;
    self.icon = "lucide-binary";
    return self;
  }
  inherit(NumberValue, host.kW);
  methods(NumberValue, {
    renderTo(el) { el.setText(isFinite(this.data) || isNaN(this.data) ? this.toString() : "∞"); },
  });
  NumberValue.type = "Number";
  return NumberValue;
}

/** Booleans render as a disabled checkbox. */
export function s08BooleanValue(host) {
  function BooleanValue() {
    const self = host.kW.apply(this, arguments) || this;
    self.icon = "lucide-check-square";
    return self;
  }
  inherit(BooleanValue, host.kW);
  methods(BooleanValue, {
    isTruthy() { return this.data; },
    renderTo(el) { el.createEl("input", { type: "checkbox", attr: { disabled: true } }).checked = this.data; },
  });
  BooleanValue.type = "Boolean";
  return BooleanValue;
}

/** Heterogeneous list; elements are lazily coerced through `lazyEvaluator`. */
export function s08ListValue(host) {
  function ListValue(data) {
    const self = host.wW.apply(this, arguments) || this;
    self.icon = "lucide-list";
    self.lazyEvaluator = function (key, raw) { return s08JsToValue(raw); };
    self.data = data;
    return self;
  }
  inherit(ListValue, host.wW);
  methods(ListValue, {
    getNumbers() {
      const out = [];
      for (let i = 0; i < this.data.length; i++) {
        const item = this.data[i];
        if (Number.isNumber(item)) out.push(item);
        else if (item instanceof host.EW) out.push(item.data);
      }
      return out;
    },
    getDates() {
      const out = [];
      for (let i = 0; i < this.data.length; i++) {
        const item = this.data[i];
        let date = null;
        if (typeof item === "string") date = host.LW.parseFromString(item);
        else if (item instanceof host.CW) date = host.LW.parseFromString(item.data);
        else if (item instanceof host.LW) date = item;
        if (date) out.push(date.date);
      }
      return out;
    },
    toString() { return this.join(", ").data; },
    isTruthy() { return this.data.length > 0; },
    includes(value) {
      for (let i = 0; i < this.data.length; i++) if (host.gW.looseEquals(value, this.get(i))) return true;
      return false;
    },
    compare(other, loose) {
      const mine = this.data, theirs = other.data;
      if (mine === theirs) return true;
      if (mine.length !== theirs.length) return false;
      for (let i = 0; i < mine.length; i++) {
        if (mine[i] !== theirs[i] && !loose(this.get(i), other.get(i))) return false;
      }
      return true;
    },
    equals(other) { return this.compare(other, host.gW.equals); },
    looseEquals(other) {
      return other instanceof ListValue ? this.compare(other, host.gW.looseEquals) : this.data.length === 1 && host.gW.looseEquals(this.get(0), other);
    },
    length() { return this.data.length; },
    get(index) {
      const raw = this.data[index];
      if (raw == null) return host.bW.value;
      if (raw instanceof host.gW) return raw;
      return this.data[index] = this.lazyEvaluator(index, raw);
    },
    slice(from, to) { return new ListValue(this.data.slice(from, to)); },
    reverse() { return new ListValue(this.data.slice().reverse()); },
    flatten() {
      const out = [];
      const walk = (items) => {
        for (let i = 0; i < items.length; i++) {
          const item = items[i];
          if (item instanceof ListValue) walk(item.data);
          else if (Array.isArray(item)) walk(item);
          else out.push(item);
        }
      };
      walk(this.data);
      return new ListValue(out);
    },
    unique() {
      const data = this.data, seen = {}, self = this;
      const add = (index) => {
        const value = self.get(index), key = value.toString();
        if (Object.hasOwn(seen, key)) {
          const bucket = seen[key];
          if (!bucket.some((v) => host.gW.equals(value, v))) bucket.push(value);
        } else seen[key] = [value];
      };
      for (let i = 0; i < data.length; i++) add(i);
      const out = [];
      for (const key in seen) out.push.apply(out, seen[key]);
      return new ListValue(out);
    },
    sort() {
      const data = this.data.slice();
      data.sort((a, b) => {
        const av = a instanceof host.kW ? a.data : a instanceof host.gW ? a.toString() : a;
        const bv = b instanceof host.kW ? b.data : b instanceof host.gW ? b.toString() : b;
        return Number.isNumber(av) && Number.isNumber(bv) ? av - bv : host.ub(av, bv);
      });
      return new ListValue(data);
    },
    concat(other) { return new ListValue(this.data.concat(other.data)); },
    earliest() {
      const dates = this.getDates();
      if (dates.length === 0) return host.bW.value;
      let min = dates[0];
      for (const d of dates) if (d < min) min = d;
      return new host.LW(min);
    },
    latest() {
      const dates = this.getDates();
      if (dates.length === 0) return host.bW.value;
      let max = dates[0];
      for (const d of dates) if (d > max) max = d;
      return new host.LW(max);
    },
    sum() {
      const nums = this.getNumbers();
      if (nums.length === 0) return host.bW.value;
      return new host.EW(nums.reduce((a, b) => a + b, 0));
    },
    median() {
      const nums = this.getNumbers();
      nums.sort((a, b) => a - b);
      const n = nums.length;
      if (n === 0) return host.bW.value;
      return new host.EW(n % 2 === 0 ? (nums[n / 2] + nums[n / 2 - 1]) / 2 : nums[(n - 1) / 2]);
    },
    mean() {
      const sum = this.sum();
      return sum instanceof host.bW ? host.bW.value : new host.EW(sum.data / this.length());
    },
    min() {
      const nums = this.getNumbers();
      return nums.length === 0 ? host.bW.value : new host.EW(Math.min.apply(Math, nums));
    },
    max() {
      const nums = this.getNumbers();
      return nums.length === 0 ? host.bW.value : new host.EW(Math.max.apply(Math, nums));
    },
    stddev() {
      const nums = this.getNumbers();
      if (nums.length === 0) return host.bW.value;
      const meanOf = (list) => list.reduce((a, b) => a + b, 0) / list.length;
      const m = meanOf(nums);
      const variance = meanOf(nums.map((x) => Math.pow(x - m, 2)));
      return new host.EW(Math.sqrt(variance));
    },
    join(sep) {
      const parts = [], data = this.data;
      for (let i = 0; i < data.length; i++) {
        const raw = data[i];
        if (typeof raw === "string" || typeof raw === "boolean" || Number.isNumber(raw)) parts.push(String(raw));
        else parts.push(this.get(i).toString());
      }
      return new host.CW(parts.join(sep));
    },
    keys() { return host.gW.prototype.keys.call(this).concat(["length"]); },
    objectAccess(key) {
      return key.toLowerCase() === "length" ? new host.EW(this.data.length) : host.gW.prototype.objectAccess.call(this, key);
    },
    renderTo(el, renderer) {
      const box = el.createDiv("value-list-container");
      for (let i = 0; i < this.data.length; i++) {
        this.get(i).renderTo(box.createSpan("value-list-element"), renderer);
        if (i < this.data.length - 1) box.createSpan("value-list-gap").setText("\n");
      }
    },
  });
  ListValue.type = "List";
  return ListValue;
}

/** Tag value: data is normalized through `xW` (strip leading # / whitespace). */
export function s08TagValue(host) {
  function TagValue(data) {
    const self = host.CW.apply(this, arguments) || this;
    self.data = host.xW(data);
    self.lowerTag = self.data.toLowerCase();
    return self;
  }
  inherit(TagValue, host.CW);
  methods(TagValue, {
    renderTo(el, renderer) { renderer.renderTag(this.data, el); },
    tagMatches(other) {
      const mine = this.lowerTag;
      if (other instanceof host.CW) {
        const theirs = other instanceof TagValue ? other.lowerTag : host.xW(other.data).toLowerCase();
        if (mine.startsWith(theirs) && (mine.length === theirs.length || "/" === mine.charAt(theirs.length))) return true;
      }
      return false;
    },
  });
  return TagValue;
}

/** List of tags; `includes` uses prefix matching. */
export function s08TagsValue(host) {
  function TagsValue(data) {
    const self = host.SW.apply(this, [data.map((tag) => new host.TW(tag))]) || this;
    self.icon = "lucide-tags";
    return self;
  }
  inherit(TagsValue, host.SW);
  methods(TagsValue, {
    includes(tag) {
      for (let i = 0; i < this.data.length; i++) if (this.data[i].tagMatches(tag)) return true;
      return false;
    },
  });
  return TagsValue;
}

/** Object value (front-matter maps); `lazyEvaluator` may be replaced (fromFrontMatter installs a smarter one). */
export function s08ObjectValue(host) {
  function ObjectValue(data) {
    const self = host.wW.apply(this, arguments) || this;
    self.icon = "lucide-list";
    self.lazyEvaluator = function (key, raw) { return s08JsToValue(raw); };
    self.data = data;
    return self;
  }
  inherit(ObjectValue, host.wW);
  methods(ObjectValue, {
    toString() {
      const out = {}, data = this.data;
      for (const key in data) if (Object.hasOwn(data, key)) out[key] = this.get(key).toString();
      return JSON.stringify(out);
    },
    isTruthy() { return !this.isEmpty(); },
    isEmpty() { return Object.keys(this.data).length === 0; },
    equals(other) {
      const mine = this.data, theirs = other.data;
      if (mine === theirs) return true;
      const myKeys = Object.keys(mine), theirKeys = Object.keys(theirs);
      if (myKeys.length !== theirKeys.length) return false;
      for (const key of myKeys) if (!Object.hasOwn(theirs, key)) return false;
      for (const key of myKeys) if (!host.gW.equals(this.get(key), other.get(key))) return false;
      return true;
    },
    valuesRaw() { return Object.values(this.data); },
    get(key) {
      if (!Object.hasOwn(this.data, key)) return host.bW.value;
      const raw = this.data[key];
      return raw instanceof host.gW ? raw : this.data[key] = this.lazyEvaluator(key, raw);
    },
    getInsensitive(key) { return this.get(host.qV(this.data, key)); },
    keys() { return Object.keys(this.data); },
    objectAccess(key) { return this.getInsensitive(key); },
  });
  ObjectValue.fromFrontMatter = function (app, file, frontmatter) {
    const value = new ObjectValue(Object.assign({}, frontmatter));
    value.lazyEvaluator = function (key, raw) {
      if (typeof key === "string" && key.toLowerCase() === "tags") {
        if (host.vc(raw, true)) return new host.DW(raw);
        if (typeof raw === "string") return new host.DW([raw]);
      }
      if (typeof raw === "string") {
        const link = host.BW.parseFromString(app, raw, file.path);
        if (link) return link;
        if (host.Qc(raw)) return new host.RW(raw);
        const date = host.LW.parseFromString(raw);
        if (date) return date;
      }
      const coerced = s08JsToValue(raw);
      if (coerced instanceof host.SW || coerced instanceof ObjectValue) coerced.lazyEvaluator = value.lazyEvaluator;
      return coerced;
    };
    return value;
  };
  ObjectValue.type = "Object";
  return ObjectValue;
}

/** RegExp value (formula patterns). */
export function s08RegExpValue(host) {
  function RegExpValue(regexp) {
    const self = host.wW.apply(this, arguments) || this;
    self.icon = "lucide-regex";
    self.regexp = regexp;
    return self;
  }
  inherit(RegExpValue, host.wW);
  methods(RegExpValue, {
    toString() { return this.regexp.toString(); },
    isTruthy() { return true; },
  });
  RegExpValue.type = "RegExp";
  return RegExpValue;
}

/** Date/datetime; `time` selects the icon and the input rendering. */
export function s08DateValue(host) {
  function DateValue(date, time) {
    if (time === undefined) time = true;
    const self = host.wW.apply(this, arguments) || this;
    self.icon = "lucide-calendar";
    self.date = date;
    self.time = time;
    if (time) self.icon = "lucide-clock";
    return self;
  }
  inherit(DateValue, host.wW);
  methods(DateValue, {
    toString() {
      if (this.time) { const d = this.date; return host.HV(d) + "T" + host.zV(d); }
      return host.HV(this.date);
    },
    printDate() { return host.HV(this.date); },
    dateOnly() { return this.time ? new DateValue(new Date(this.printDate() + "T00:00:00"), false) : this; },
    printTime() { return host.zV(this.date); },
    relative() { return window.moment(this.date).fromNow(); },
    isTruthy() { return true; },
    equals(other) { return this.time === other.time && this.date.getTime() === other.date.getTime(); },
    looseEquals(other) {
      if (other instanceof host.CW) {
        const parsed = DateValue.parseFromString(other.data);
        if (parsed) other = parsed;
      }
      return other instanceof DateValue && (this.time && other.time
        ? this.date.getTime() === other.date.getTime()
        : this.dateOnly().date.getTime() === other.dateOnly().date.getTime());
    },
    keys() { return host.gW.prototype.keys.call(this).concat(["year", "month", "day", "hour", "minute", "second", "millisecond", "timestamp"]); },
    objectAccess(key) {
      const d = this.date;
      switch (key.toLowerCase()) {
        case "year": return new host.EW(d.getFullYear());
        case "month": return new host.EW(d.getMonth() + 1);
        case "day": return new host.EW(d.getDate());
        case "hour": return new host.EW(d.getHours());
        case "minute": return new host.EW(d.getMinutes());
        case "second": return new host.EW(d.getSeconds());
        case "millisecond": return new host.EW(d.getMilliseconds());
        case "timestamp": return new host.EW(d.getTime());
      }
      return host.gW.prototype.objectAccess.call(this, key);
    },
    renderTo(el) {
      el.createEl("input", {
        cls: "metadata-input metadata-input-text " + (this.time ? "mod-datetime" : "mod-date"),
        type: this.time ? "datetime-local" : "date",
        value: this.toString(),
        attr: { step: "any", disabled: true },
      });
    },
  });
  DateValue.parseFromString = function (text) {
    const isDateTime = /^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}(:\d{2}(?:\.\d{1,9})?)?(Z|[+-]\d{2}(:?\d{2})?)?$/.test(text);
    if (isDateTime) return new DateValue(new Date(text), true);
    const isDate = /^\d{4}-\d{2}-\d{2}$/.test(text);
    if (isDate) return new DateValue(new Date(text + "T00:00:00"), false);
    return null;
  };
  DateValue.type = "Date";
  return DateValue;
}

/** Relative date ("3 days ago"): toString/renderTo delegate to `relative()`. */
export function s08RelativeDateValue(host) {
  function RelativeDateValue() { return host.LW.apply(this, arguments) || this; }
  inherit(RelativeDateValue, host.LW);
  methods(RelativeDateValue, {
    toString() { return this.relative(); },
    renderTo(el) { el.createSpan(this.time ? "mod-datetime" : "mod-date").setText(this.relative()); },
  });
  return RelativeDateValue;
}

/** ISO-8601-ish duration; math goes through moment.duration for display and diff. */
export function s08DurationValue(host) {
  function DurationValue(years, months, days, hours, minutes, seconds, milliseconds) {
    const self = host.wW.apply(this, arguments) || this;
    self.icon = "lucide-calendar-range";
    self.years = years; self.months = months; self.days = days; self.hours = hours;
    self.minutes = minutes; self.seconds = seconds; self.milliseconds = milliseconds;
    return self;
  }
  inherit(DurationValue, host.wW);
  methods(DurationValue, {
    toString() {
      return window.moment.duration({
        years: this.years, months: this.months, days: this.days, hours: this.hours,
        minutes: this.minutes, seconds: this.seconds, milliseconds: this.milliseconds,
      }).humanize();
    },
    isTruthy() {
      return this.years !== 0 || this.months !== 0 || this.days !== 0 || this.hours !== 0 ||
        this.minutes !== 0 || this.seconds !== 0 || this.milliseconds !== 0;
    },
    equals(other) {
      return this.years === other.years && this.months === other.months && this.days === other.days &&
        this.hours === other.hours && this.minutes === other.minutes && this.seconds === other.seconds &&
        this.milliseconds === other.milliseconds;
    },
    looseEquals(other) {
      if (other instanceof host.CW) {
        const parsed = DurationValue.parseFromString(other.data);
        if (parsed) other = parsed;
      }
      return other instanceof DurationValue && this.getMilliseconds() === other.getMilliseconds();
    },
    addToDate(dateValue, negate) {
      const sign = negate ? -1 : 1;
      const date = new Date(dateValue.date);
      let timed = dateValue.time;
      if (this.years !== 0) date.setFullYear(date.getFullYear() + sign * this.years);
      if (this.months !== 0) date.setMonth(date.getMonth() + sign * this.months);
      if (this.days !== 0) date.setDate(date.getDate() + sign * this.days);
      if (this.hours !== 0) { date.setHours(date.getHours() + sign * this.hours); timed = true; }
      if (this.minutes !== 0) { date.setMinutes(date.getMinutes() + sign * this.minutes); timed = true; }
      if (this.seconds !== 0) { date.setSeconds(date.getSeconds() + sign * this.seconds); timed = true; }
      if (this.milliseconds !== 0) { date.setMilliseconds(date.getMilliseconds() + sign * this.milliseconds); timed = true; }
      return new host.LW(date, timed);
    },
    getMilliseconds() {
      const now = new host.LW(new Date());
      return this.addToDate(now).date.getTime() - now.date.getTime();
    },
    keys() { return host.gW.prototype.keys.call(this).concat(["years", "months", "days", "weeks", "hours", "minutes", "seconds", "milliseconds"]); },
    objectAccess(key) {
      const unit = key.toLowerCase();
      switch (unit) {
        case "years": case "months": case "weeks": case "days":
        case "hours": case "minutes": case "seconds": case "milliseconds": {
          const now = new host.LW(new Date());
          const shifted = this.addToDate(now);
          return new host.EW(window.moment(shifted.date).diff(now.date, unit, true));
        }
      }
      return host.gW.prototype.objectAccess.call(this, key);
    },
  });
  DurationValue.parseFromString = function (text) {
    const iso = text.match(/P(?:([.,\d]+)Y)?(?:([.,\d]+)M)?(?:([.,\d]+)W)?(?:([.,\d]+)D)?T(?:([.,\d]+)H)?(?:([.,\d]+)M)?(?:([.,\d]+)S)?/);
    if (iso) {
      const num = (s) => (s === undefined ? 0 : parseInt(s));
      return new DurationValue(num(iso[1]), num(iso[2]), 7 * num(iso[3]) + num(iso[4]), num(iso[5]), num(iso[6]), num(iso[7]), 0);
    }
    const human = text.match(/^(-?\d+) ?([dhmswMy]|(?:second|minute|hour|day|week|month|year)[s]?)$/);
    if (human) {
      const amount = human[1], unit = human[2], value = parseFloat(amount);
      if (unit === "y" || unit === "year" || unit === "years") return new DurationValue(value, 0, 0, 0, 0, 0, 0);
      if (unit === "M" || unit === "month" || unit === "months") return new DurationValue(0, value, 0, 0, 0, 0, 0);
      if (unit === "w" || unit === "week" || unit === "weeks") return new DurationValue(0, 0, 7 * value, 0, 0, 0, 0);
      if (unit === "d" || unit === "day" || unit === "days") return new DurationValue(0, 0, value, 0, 0, 0, 0);
      if (unit === "h" || unit === "hour" || unit === "hours") return new DurationValue(0, 0, 0, value, 0, 0, 0);
      if (unit === "m" || unit === "minute" || unit === "minutes") return new DurationValue(0, 0, 0, 0, value, 0, 0);
      if (unit === "s" || unit === "second" || unit === "seconds") return new DurationValue(0, 0, 0, 0, 0, value, 0);
      if (unit === "ms" || unit === "millisecond" || unit === "milliseconds") return new DurationValue(0, 0, 0, 0, 0, 0, value);
    }
    return null;
  };
  DurationValue.fromMilliseconds = function (ms) { return new DurationValue(0, 0, 0, 0, 0, 0, ms); };
  DurationValue.type = "Duration";
  return DurationValue;
}

/** Icon-only file value: renders an svg glyph via `ev`. */
export function s08IconValue(host) {
  function IconValue() {
    const self = host.CW.apply(this, arguments) || this;
    self.icon = "lucide-image";
    return self;
  }
  inherit(IconValue, host.CW);
  methods(IconValue, {
    renderTo(el) {
      let icon = host.ev(this.data);
      if (!icon) icon = host.ev("question-mark-glyph");
      if (icon) el.appendChild(icon);
    },
  });
  return IconValue;
}

/** File value: backlinks/tags/props/links come from the metadata cache, lazily and cached. */
export function s08FileValue(host) {
  function FileValue(app, file) {
    const self = host.wW.apply(this, arguments) || this;
    self.icon = "lucide-file";
    self.app = app;
    self.file = file;
    return self;
  }
  inherit(FileValue, host.wW);
  methods(FileValue, {
    toString() { return this.file.path; },
    isTruthy() { return true; },
    equals(other) { return this.file === other.file; },
    looseEquals(other) { return other instanceof host.CW && this.file.path === other.data; },
    getLinks() {
      if (this._cachedLinks) return this._cachedLinks;
      const app = this.app, file = this.file, links = [];
      app.metadataCache.iterateRefsForFile(file, (ref) => links.push(host.BW.fromReference(app, file.path, ref)));
      return this._cachedLinks = new host.SW(links);
    },
    getBacklinks() {
      if (this._cachedBacklinks) return this._cachedBacklinks;
      const app = this.app, file = this.file;
      const resolved = app.metadataCache.resolvedLinks, links = [];
      for (const src in resolved) {
        if (Object.hasOwn(resolved, src) && Object.hasOwn(resolved[src], file.path)) {
          links.push(new host.BW(app, src, "", new host.CW(host.hu(src))));
        }
      }
      return this._cachedBacklinks = new host.SW(links);
    },
    getEmbeds() {
      if (this._cachedEmbeds) return this._cachedEmbeds;
      const app = this.app, file = this.file, embeds = [];
      const cache = app.metadataCache.getFileCache(file);
      if (cache && cache.embeds) for (const embed of cache.embeds) embeds.push(host.BW.fromReference(app, file.path, embed));
      return this._cachedEmbeds = new host.SW(embeds);
    },
    getTags() {
      if (this._cachedTags) return this._cachedTags;
      const app = this.app, file = this.file, tags = [];
      const cache = app.metadataCache.getFileCache(file);
      if (cache) {
        if (cache.tags) for (const tag of cache.tags) tags.push(tag.tag);
        const front = host.iT(cache.frontmatter);
        if (front) for (const tag of front) tags.push(tag);
      }
      return this._cachedTags = new host.DW(host.ac(tags));
    },
    getProps() {
      if (this._cachedProps) return this._cachedProps;
      const app = this.app, file = this.file;
      const cache = app.metadataCache.getFileCache(file);
      return this._cachedProps = host.AW.fromFrontMatter(app, file, (cache == null ? void 0 : cache.frontmatter) || {});
    },
    keys() {
      return host.gW.prototype.keys.call(this).concat(["file", "name", "basename", "fullname", "path", "folder", "ext", "ctime", "mtime", "size", "links", "embeds", "backlinks", "tags", "properties"]);
    },
    objectAccess(key) {
      const file = this.file;
      switch (key.toLowerCase()) {
        case "file": return this;
        case "name": return new host.CW(file.getShortName());
        case "basename": return new host.CW(file.basename);
        case "fullname": return new host.CW(file.name);
        case "path": return new host.CW(file.path);
        case "folder": return new host.CW(file.parent.path);
        case "ext": return new host.CW(file.extension);
        case "ctime": return new host.LW(new Date(file.stat.ctime));
        case "mtime": return new host.LW(new Date(file.stat.mtime));
        case "size": return new host.EW(file.stat.size);
        case "links": return this.getLinks();
        case "embeds": return this.getEmbeds();
        case "backlinks": return this.getBacklinks();
        case "tags": return this.getTags();
        case "properties": return this.getProps();
      }
      return host.gW.prototype.objectAccess.call(this, key);
    },
    renderTo(el, renderer) { renderer.renderFileLink(this.file, null, el); },
  });
  FileValue.type = "File";
  return FileValue;
}

/** External URL value. */
export function s08UrlValue(host) {
  function UrlValue(url, display) {
    const self = host.CW.apply(this, arguments) || this;
    self.icon = "lucide-link";
    self.display = display != null ? display : null;
    return self;
  }
  inherit(UrlValue, host.CW);
  methods(UrlValue, {
    equals(other) { return this.data === other.data && host.gW.equals(this.display, other.display); },
    renderTo(el, renderer) { renderer.renderExternalLink(this.data, this.display, el); },
  });
  UrlValue.type = "URL";
  return UrlValue;
}

/** Internal wikilink `[[target|display]]`; resolve() goes through the metadata cache. */
export function s08LinkValue(host) {
  function LinkValue(app, link, sourcePath, display) {
    const self = host.CW.apply(this, [link]) || this;
    self.icon = "lucide-link";
    self.app = app;
    self.sourcePath = sourcePath;
    self.display = display != null ? display : null;
    return self;
  }
  inherit(LinkValue, host.CW);
  methods(LinkValue, {
    toString() { return "[[" + this.data + (this.display ? "|" + this.display : "") + "]]"; },
    isTruthy() { return true; },
    equals(other) {
      return this.data === other.data && this.sourcePath === other.sourcePath && host.gW.equals(this.display, other.display);
    },
    looseEquals(other) {
      if (other instanceof LinkValue) {
        const mine = this.resolve(), theirs = other.resolve();
        return mine && theirs ? mine === theirs : this.data === other.data;
      }
      if (other instanceof host.CW) {
        const parsed = LinkValue.parseFromString(this.app, other.data, "");
        if (parsed) return this.looseEquals(parsed);
      }
      return other instanceof host.NW && this.resolve() === other.file;
    },
    renderTo(el, renderer) { renderer.renderFileLink(this.data, this.display, el); },
    resolve() { return this.app.metadataCache.getFirstLinkpathDest(host.ET(this.data), this.sourcePath); },
  });
  LinkValue.parseFromString = function (app, text, sourcePath) {
    if (text.startsWith("[[") && text.endsWith("]]")) {
      let target = text.slice(2, -2), display = null;
      const bar = target.lastIndexOf("|");
      if (bar !== -1) {
        display = new host.CW(target.substring(bar + 1));
        target = target.substring(0, bar);
      }
      return new LinkValue(app, target, sourcePath, display);
    }
    return null;
  };
  LinkValue.fromReference = function (app, sourcePath, ref) {
    return new LinkValue(app, ref.link, sourcePath, ref.displayText ? new host.CW(ref.displayText) : null);
  };
  LinkValue.type = "Link";
  return LinkValue;
}

/** Image value: internal paths resolve through the vault, external URLs render directly. */
export function s08ImageValue(host) {
  function ImageValue() {
    const self = host.CW.apply(this, arguments) || this;
    self.icon = "lucide-image";
    return self;
  }
  inherit(ImageValue, host.CW);
  methods(ImageValue, {
    toString() { return host.YC(this.data) ? "![[" + this.data + "]]" : "![](" + this.data + ")"; },
    renderTo(el, renderer) {
      if (host.YC(this.data)) {
        const dest = renderer.app.metadataCache.getFirstLinkpathDest(this.data, "");
        if (dest && host.Vy.contains(dest.extension)) {
          const img = el.createEl("img");
          img.src = renderer.app.vault.getResourcePath(dest);
        }
      } else {
        const img = el.createEl("img");
        let src = this.data;
        if (host.Yl.isDesktopApp && src.startsWith("file:///")) src = host.Yl.resourcePathPrefix + src.substring(8);
        img.src = src;
      }
    },
  });
  ImageValue.type = "Image";
  return ImageValue;
}

/** Error value shown in formula results. */
export function s08ErrorValue(host) {
  function ErrorValue(message) {
    const self = host.gW.apply(this, arguments) || this;
    self.icon = "lucide-alert-triangle";
    if (message) {
      self.message = message instanceof Error || message instanceof ErrorValue ? message.message : message.toString();
    } else self.message = "";
    return self;
  }
  inherit(ErrorValue, host.gW);
  methods(ErrorValue, {
    toString() { return "Error: " + this.message; },
    isTruthy() { return false; },
    equals(other) { return other.message === this.message; },
    renderTo(el) {
      const text = this.message;
      const box = el.createDiv("bases-formula-error");
      host.tv(box.createDiv("warning-icon"), "lucide-alert-triangle");
      box.createDiv({ text, cls: "bases-formula-error-message" });
      host.Mv(box, text, { delay: host.sv });
      box.addEventListener("click", () => host.kv(box, text));
    },
  });
  ErrorValue.type = "Error";
  return ErrorValue;
}

/** Markdown text value (rendered through the markdown pipeline, links fixed up). */
export function s08MarkdownValue(host) {
  function MarkdownValue() {
    const self = host.CW.apply(this, arguments) || this;
    self.icon = "lucide-baseline";
    return self;
  }
  inherit(MarkdownValue, host.CW);
  methods(MarkdownValue, {
    renderTo(el, renderer) {
      el.addClass("markdown-rendered");
      const html = host.Zx(host.Kx(this.data));
      el.appendChild(host.xL(html));
      renderer.app.fixFileLinks(el, "");
    },
  });
  MarkdownValue.type = "Markdown";
  return MarkdownValue;
}

/** Raw HTML value. */
export function s08HtmlValue(host) {
  function HtmlValue() {
    const self = host.CW.apply(this, arguments) || this;
    self.icon = "lucide-code-2";
    return self;
  }
  inherit(HtmlValue, host.CW);
  methods(HtmlValue, {
    renderTo(el, renderer) {
      el.appendChild(host.xL(this.data));
      renderer.app.fixFileLinks(el, "");
    },
  });
  HtmlValue.type = "HTML";
  return HtmlValue;
}

// ---------------------------------------------------------------------------
// formula engine pieces
// ---------------------------------------------------------------------------

/** Registry of formula functions per value type + globals. */
export function s08FuncRegistry(host) {
  function FuncRegistry() {
    this.global = {};
    this.instance = new Map();
  }
  methods(FuncRegistry, {
    addForType(type, fn) {
      let bucket = this.instance.get(type);
      if (!bucket) { bucket = {}; this.instance.set(type, bucket); }
      bucket[fn.name.toLowerCase()] = fn;
    },
    removeForType(type, name) {
      const bucket = this.instance.get(type);
      if (bucket) delete bucket[name.toLowerCase()];
    },
    addGlobal(fn) { this.global[fn.name.toLowerCase()] = fn; },
    removeGlobal(name) { delete this.global[name.toLowerCase()]; },
    getAllForValue(value) {
      const out = {};
      for (let type = value.type; type;) {
        const bucket = this.instance.get(type);
        if (bucket) for (const key in bucket) if (!Object.hasOwn(out, key)) out[key] = bucket[key];
        if (type === host.gW) break;
        type = Object.getPrototypeOf(type);
      }
      return out;
    },
    findForValue(value, name) {
      const key = name.toLowerCase();
      for (let type = value.type; type;) {
        const bucket = this.instance.get(type);
        if (bucket && Object.hasOwn(bucket, key)) return bucket[key];
        if (type === host.gW) break;
        type = Object.getPrototypeOf(type);
      }
      return null;
    },
    getAllGlobal() { return Object.values(this.global); },
    findGlobal(name) {
      const key = name.toLowerCase();
      return Object.hasOwn(this.global, key) ? this.global[key] : null;
    },
  });
  return FuncRegistry;
}

/** Base class for formula functions: applyWithContext + serialize. */
export function s08FormulaFunc(host) {
  function FormulaFunc() { this.ctx = null; }
  methods(FormulaFunc, {
    applyWithContext(ctx) {
      const args = Array.prototype.slice.call(arguments, 1);
      this.ctx = ctx;
      try { return this.apply.apply(this, args); } finally { this.ctx = null; }
    },
    serialize() {
      const args = Array.prototype.slice.call(arguments);
      return this.name + "(" + args.join(", ") + ")";
    },
  });
  return FormulaFunc;
}

/** Method-style formula function: first arg is the receiver, result is Boolean. */
export function s08FormulaMethod(host) {
  function FormulaMethod() { return host.GW.apply(this, arguments) || this; }
  inherit(FormulaMethod, host.GW);
  methods(FormulaMethod, {
    apply() {
      const args = Array.prototype.slice.call(arguments);
      return new host.MW(this.operate.apply(this, args));
    },
    serialize() {
      const args = Array.prototype.slice.call(arguments);
      const receiver = args[0], rest = args.slice(1);
      return receiver + "." + this.name + "(" + rest.join(", ") + ")";
    },
  });
  return FormulaMethod;
}

/** The `self` numeric function used by generated formula wrappers. */
export function s08SelfFunc(host) {
  function SelfFunc() {
    const self = host.GW.apply(this, arguments) || this;
    self.params = [s08TypedParam("self", host.EW)];
    return self;
  }
  inherit(SelfFunc, host.GW);
  methods(SelfFunc, {
    apply(value) { return new host.EW(this.operate(value.data)); },
  });
  return SelfFunc;
}

/** Tag->class resolver seeded from the lezer highlight table plus per-instance extras. */
export function s08TableResolver(host) {
  function TableResolver(extra) {
    this.extra = extra;
    this.table = Object.assign(Object.create(null), host.tW);
  }
  methods(TableResolver, {
    resolve(tag) { return tag ? this.table[tag] || (this.table[tag] = host.uW(this.extra, tag)) : 0; },
  });
  return TableResolver;
}

/** Renders property values as links/external links/tags inside the app chrome. */
export function s08LinkRenderer(host) {
  function LinkRenderer(app) {
    this.hoverPopover = null;
    this.app = app;
  }
  methods(LinkRenderer, {
    renderFileLink(linktext, value, el) {
      const app = this.app;
      let file, href;
      if (linktext instanceof host.$T) {
        file = linktext; href = file.path;
      } else {
        const dest = app.metadataCache.getFirstLinkpathDest(host.ET(linktext), "");
        file = dest; href = linktext;
      }
      el.addClass("markdown-rendered");
      const anchor = el.createSpan("internal-link");
      if (value) value.renderTo(anchor, this);
      else if (typeof linktext === "string") anchor.setText(host.nE(linktext));
      else anchor.setText(file ? file.getShortName() : href);
      anchor.setAttr("data-href", href);
      anchor.toggleClass("is-unresolved", !file);
      host.Ic(anchor);
      anchor.onClickEvent((evt) => {
        if (evt.button !== 0 && evt.button !== 1) return;
        evt.preventDefault();
        app.workspace.openLinkText(href, "", host.Bg.isModEvent(evt));
      });
      anchor.addEventListener("contextmenu", (evt) => {
        const menu = host.Ug.forEvent(evt).addSections(["title", "open", "action-primary", "action", "info", "info.copy", "view", "system", "", "danger"]);
        app.workspace.handleLinkContextMenu(menu, href, "");
        if (linktext instanceof host.$T) {
          menu.addItem((item) => item.setSection("danger").setTitle(host.gm.interface.menu.deleteFile()).setIcon("lucide-trash-2").setWarning(true).onClick(() => app.fileManager.promptForDeletion(file)));
        }
      });
      app.dragManager.handleDrag(anchor, (evt) => app.dragManager.dragLink(evt, href, ""));
      anchor.addEventListener("mouseover", (evt) => {
        if (host.Lc(evt, anchor)) app.workspace.trigger("hover-link", { event: evt, source: "bases", hoverParent: this, targetEl: anchor, linktext: href });
      });
    },
    renderExternalLink(url, value, el) {
      const app = this.app;
      const anchor = el.createEl("a", { href: url, cls: "external-link", attr: { target: "_blank", rel: "noopener" } });
      if (value) value.renderTo(anchor, this); else anchor.setText(url);
      anchor.addEventListener("contextmenu", (evt) => {
        const menu = host.Ug.forEvent(evt).addSections(["title", "open", "action", "info", "view", "", "danger"]);
        app.workspace.handleExternalLinkContextMenu(menu, url);
      });
      anchor.onClickEvent((evt) => {
        if (evt.button === 0 || evt.button === 1) {
          evt.preventDefault();
          if (host.Yc(url)) {
            const mod = host.Bg.isModEvent(evt);
            const target = typeof mod === "boolean" ? "" : mod;
            window.open(url, target);
          } else new host.fb(host.gm.interface.msgFailedToOpenHref({ href: url }));
        }
      });
    },
    renderTag(tag, el) {
      const name = tag.slice(1);
      el.createEl("a", { cls: "tag", text: name });
      el.addEventListener("click", () => {
        const plugin = this.app.internalPlugins.getEnabledPluginById("global-search");
        if (plugin) plugin.openGlobalSearch("tag:" + name);
      });
    },
  });
  return LinkRenderer;
}

/** Base class of the document search bars (find next/previous, replace input plumbing). */
export function s08SearchBarBase(host) {
  function SearchBarBase(containerEl) {
    const self = this;
    this.replaceInputEl = null;
    this.scope = null;
    this.containerEl = containerEl;
    this.searchContainerEl = host.createDiv("document-search-container");
    const row = this.searchContainerEl.createDiv("document-search");
    const inputBox = row.createDiv("search-input-container document-search-input");
    this.searchInputEl = inputBox.createEl("input", { type: "text", placeholder: host.gm.editor.search.placeholderFind() });
    this.countEl = inputBox.createDiv("document-search-count");
    this.searchInputEl.addEventListener("input", this.onSearchInput.bind(this));
    this.searchInputEl.addEventListener("keydown", (evt) => {
      if (evt.isComposing || host.Yl.hasPhysicalKeyboard || evt.key !== "Enter") return;
      evt.preventDefault();
      host.Lv();
    });
    this.searchButtonContainerEl = row.createDiv({ cls: "document-search-buttons", type: "text" });
    this.searchButtonContainerEl.createEl("button", { cls: "clickable-icon document-search-button" }, (btn) => {
      host.tv(btn, "lucide-arrow-up");
      host.Mv(btn, host.gm.editor.search.labelPrevious() + "\n" + host.Rb(host.Fb(["Shift"], "F3")), { placement: "top" });
      btn.addEventListener("mousedown", (evt) => evt.preventDefault());
      btn.addEventListener("click", (evt) => { evt.preventDefault(); self.findPrevious(); });
    });
    this.searchButtonContainerEl.createEl("button", { cls: "clickable-icon document-search-button" }, (btn) => {
      host.tv(btn, "lucide-arrow-down");
      host.Mv(btn, host.gm.editor.search.labelNext() + "\n" + host.Rb(host.Fb([], "F3")), { placement: "top" });
      btn.addEventListener("mousedown", (evt) => evt.preventDefault());
      btn.addEventListener("click", (evt) => { evt.preventDefault(); self.findNext(); });
    });
    row.createDiv("clickable-icon document-search-close-button", (btn) => {
      host.tv(btn, "lucide-x");
      host.Mv(btn, host.gm.editor.search.labelExitSearch(), { placement: "top" });
      btn.addEventListener("click", (evt) => { evt.preventDefault(); self.hide(); });
    });
    const scope = this.scope = new host.Ng(host.s08app.scope);
    scope.register([], "F3", this.findNext.bind(this));
    scope.register(["Mod"], "G", this.findNext.bind(this));
    scope.register(["Shift"], "F3", this.findPrevious.bind(this));
    scope.register(["Mod", "Shift"], "G", this.findPrevious.bind(this));
    scope.register([], "Enter", this.onEnter.bind(this));
    scope.register(["Shift"], "Enter", this.onShiftEnter.bind(this));
    scope.register([], "Escape", this.hide.bind(this));
    scope.register([], "Tab", this.goToNextInput.bind(this));
    scope.register(["Shift"], "Tab", this.goToNextInput.bind(this));
  }
  methods(SearchBarBase, {
    getQuery() { return this.searchInputEl.value; },
    goToNextInput(evt) {
      if (!this.replaceInputEl) return;
      if (this.searchInputEl.isActiveElement()) {
        this.replaceInputEl.focus(); evt.preventDefault();
      } else if (this.replaceInputEl.isActiveElement()) {
        this.searchInputEl.focus(); evt.preventDefault();
      }
    },
    onEnter(evt) {
      const other = this.replaceInputEl;
      if (evt.isComposing) return;
      if (!this.searchInputEl.isActiveElement() && !(other == null ? void 0 : other.isActiveElement())) return;
      this.findNextOrReplace();
    },
    onShiftEnter(evt) {
      const other = this.replaceInputEl;
      if (evt.isComposing) return;
      if (!this.searchInputEl.isActiveElement() && !(other == null ? void 0 : other.isActiveElement())) return;
      this.findPrevious();
    },
  });
  return SearchBarBase;
}

/** Autocomplete provider + language registration for the bases formula editor. */
export function s08FormulaSuggester(host) {
  function FormulaSuggester(ctx) {
    // the highlight extension: base theme + module/dark-aware style (a comma sequence in the original)
    const style = host._G;
    const extensions = [host.TU];
    let themeType;
    if (style instanceof host.CU) {
      if (style.module) extensions.push(host._o.styleModule.of(style.module));
      themeType = style.themeType;
    }
    if (themeType) {
      extensions.push(host.EU.computeN([host._o.darkTheme], (ed) => ed.facet(host._o.darkTheme) == ("dark" == themeType) ? [style] : []));
    } else {
      extensions.push(host.EU.of(style));
    }
    const self = host.tU.call(this, host.AK, [
      host.RG({
        icons: false,
        tooltipClass: () => "suggestion-container",
        optionClass: () => "suggestion-item mod-complex",
        addToOptions: [
          { render: FormulaSuggester.renderIcon, position: 20 },
          { render: FormulaSuggester.renderDetail, position: 80 },
        ],
      }),
      extensions,
      host.AK.data.of({ autocomplete: (ed) => self.autocomplete(ed) }),
      host.KG(ctx),
    ]) || this;
    self.ctx = ctx;
    return self;
  }
  inherit(FormulaSuggester, host.tU);
  methods(FormulaSuggester, {
    autocomplete(ed) {
      if (host.Yl.isPhone) return null;
      const node = host.$G(ed.state), parent = node.parent;
      if (parent) {
        if (parent.name === "ObjectAccess") {
          const from = node.name === "Identifier" ? node.from : ed.pos;
          const first = parent.firstChild;
          const target = s08FormulaValue(this.ctx, host.XG(ed.state, first));
          const options = [];
          const addKey = (key) => {
            let icon = "lucide-file-question";
            try { icon = target.objectAccess(key).icon; } catch (err) { /* keep default */ }
            options.push({
              label: key, type: icon,
              apply(view, completion, from2, to) {
                if (host.IK(key)) host.GG(view, completion, from2 - 1, to, "[" + JSON.stringify(key) + "]");
                else host.GG(view, completion, from2, to, key);
              },
            });
          };
          for (const key of target.keys()) addKey(key);
          const funcs = Object.values(host.QW.getAllForValue(target));
          for (const fn of funcs) options.push(this.funcCompletion(fn, true));
          return { from, options };
        }
        if (parent.name === "ArrayAccess") {
          const first = parent.firstChild;
          const at = first.nextSibling.nextSibling;
          const target = s08FormulaValue(this.ctx, host.XG(ed.state, first));
          const options = [];
          const addKey = (key) => {
            let icon = "lucide-file-question";
            try { icon = target.objectAccess(key).icon; } catch (err) { /* keep default */ }
            options.push({
              label: '"' + key + '"', type: icon, boost: 99,
              apply(view, completion, from2, to) { host.GG(view, completion, from2, to, JSON.stringify(key)); },
            });
          };
          for (const key of target.keys()) addKey(key);
          return { from: at.from, options: options.concat(this.expressionCompletions()) };
        }
        if (parent.name === "Call") {
          if (node.name === "String") return { from: ed.pos, options: [] };
          const from = node.name === "Identifier" ? node.from : ed.pos;
          return { from, options: this.expressionCompletions() };
        }
        const kids = s08ChildArray(parent);
        if (kids.length === 3 && parent.name === "LogicalExpression" && kids[1].from === kids[1].to) {
          return { from: kids[0].from, options: this.expressionCompletions() };
        }
        if (kids.length === 3 && kids[2].from <= ed.pos &&
            ["LogicalExpression", "EqualityExpression", "RelationalExpression", "AdditiveExpression", "MultiplicativeExpression"].includes(parent.name)) {
          return { from: kids[2].from, options: this.expressionCompletions() };
        }
      }
      if (node.name === "Identifier" || ed.state.doc.length === 0) {
        return { from: node.from, options: this.expressionCompletions() };
      }
      return null;
    },
    getEncodedIdentifier(name) { return name; },
    expressionCompletions() {
      const self = this;
      const options = this.ctx.keys().map((key) => {
        const value = self.ctx.getByIdentifier(key);
        return {
          label: key, type: value.icon,
          apply(view, completion, from, to) {
            let text = key;
            if (host.IK(key)) text = self.getEncodedIdentifier(key);
            host.GG(view, completion, from, to, text);
          },
        };
      });
      const globals = host.QW.getAllGlobal();
      for (const fn of globals) options.push(this.funcCompletion(fn, false));
      return options;
    },
    funcCompletion(fn, isMethod) {
      const params = fn.params.slice(1).map((p) => p.name + ": " + p.type + (p.optional ? "?" : "")).join(", ");
      let info = fn.name + "(" + params + ")";
      if (fn.docString) info += "\n" + (typeof fn.docString === "string" ? fn.docString : fn.docString());
      return {
        label: fn.name + "()", type: "square-function", info,
        apply(view, completion, from, to) {
          const needsArg = fn.params.length > (isMethod ? 1 : 0);
          view.dispatch({
            changes: [{ from, to, insert: fn.name + "()" }],
            selection: host.pe.single(from + fn.name.length + (needsArg ? 1 : 2)),
            annotations: host.o_.of(completion),
          });
        },
      };
    },
  });
  FormulaSuggester.renderIcon = function (option) {
    if (option.type) {
      const el = host.createDiv("cm-custom-completionIcon suggestion-icon");
      host.tv(el.createSpan("suggestion-flair"), option.type);
      return el;
    }
    return null;
  };
  FormulaSuggester.renderDetail = function (option) {
    if (!option.detail) return null;
    return host.createDiv("cm-custom-completionDescription suggestion-aux", (el) => {
      el.createDiv({ cls: "suggestion-flair u-small", text: option.detail });
    });
  };
  return FormulaSuggester;
}

/** The eagerly-created anonymous `rt` subclass instance bound to `yG`. */
export function s08RtInstance(host) {
  function RtSub() { return host.rt.apply(this, arguments) || this; }
  inherit(RtSub, host.rt);
  return new RtSub();
}
