// g27 inherit: ES5-style class plumbing.
// inherit(Child, Parent) links BOTH the static chain (Child -> Parent) and the
// instance chain (Child.prototype -> Parent.prototype) with a non-enumerable
// `constructor` own property, and returns Child.
// methods(Class, table) bulk-assigns own enumerable keys onto Class.prototype
// with plain assignment semantics (writable/configurable/enumerable) and
// returns Class.

export function inherit(Child, Parent) {
  Child.prototype = Object.create(Parent.prototype, {
    constructor: { value: Child, writable: true, configurable: true },
  });
  Object.setPrototypeOf(Child, Parent);
  return Child;
}

export function methods(Class, table) {
  for (const name of Object.keys(table)) Class.prototype[name] = table[name];
  return Class;
}
