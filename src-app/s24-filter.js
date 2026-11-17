// Slice s24 — Bases query-filter editor UI: the root builder (EX), the shared
// base class of the filter widgets (MX), the and/or/not group (SX) and the
// single-statement editor with LHS/operator/RHS pickers plus an advanced
// formula mode (xX). The filter model classes and formula AST stay in s09/s08;
// app internals are reached through env() and the __basaltHost table.
import { env } from "./env.js";
import { inherit } from "./inherit.js";
import { parsePropertyId, keyIgnoringCase } from "./text.js";
import { isStringArray } from "./misc.js";
import { s09AndFilter, s09RuleFilter, s09ConjunctionFilter, s09PropertySuggest, s09PropertyToRef, s09ValueTypeName, s09FormulaEditorExtensions } from "./s09-query.js";
import { s09InvalidNode, s09CompareNode, s09NotNode, s09CallNode } from "./s09-formula.js";
import { s10FilterCompareOps, s10FilterOrderOps } from "./s10-consts.js";
import { s10FormulaIdentifier, s10FormulaLinktext } from "./s10-app.js";

const s24Cache = {};
function s24Once(key, build) { return s24Cache[key] ??= build(); }

// Every factory below is invoked once with the same __basaltHost object; keep it
// so widget code can reach the i18n table (`host.t.plugins.bases`) and CM helpers.
let s24Host = null;
function s24Strings() { return s24Host.t.plugins.bases; }

// ---------------------------------------------------------------- `var MX` — filter editor widget base

function s24buildFilterEditorBase() {
  function FilterEditorBase(filterEditor, parent) {
    this.filterEditor = filterEditor;
    this.parent = parent;
  }
  FilterEditorBase.fromParsedQueryFilter = function (filter, filterEditor, parent) {
    return s24FilterEditorFromParsed(filter, filterEditor, parent);
  };
  return FilterEditorBase;
}

let s24GroupClass = null;
let s24StatementClass = null;

/** `MX.fromParsedQueryFilter` — builds the widget tree for a parsed filter model. */
function s24FilterEditorFromParsed(filter, filterEditor, parent) {
  const isConjunction = filter instanceof s09ConjunctionFilter();
  if (!isConjunction && !parent) {
    const wrapped = new (s09AndFilter())([filter]);
    return new s24GroupClass(wrapped, filterEditor, parent);
  }
  if (isConjunction) return new s24GroupClass(filter, filterEditor, parent);
  if (filter instanceof s09RuleFilter()) return new s24StatementClass(filter, filterEditor, parent);
  if (!filter) return new s24StatementClass(null, filterEditor, parent);
  throw new Error("Invalid input filter");
}

// ---------------------------------------------------------------- `var SX` — and/or/not group

function s24buildFilterGroup() {
  const Base = s24Once("s24FilterEditorBase", s24buildFilterEditorBase);
  function FilterGroup(conjunctionFilter, filterEditor, parent) {
    const self = Base.call(this, filterEditor, parent) || this;
    self.children = [];
    self.conjunction = "and";
    self.conjunction = conjunctionFilter.conjunction;
    self.children = conjunctionFilter.filters && conjunctionFilter.filters.length > 0
      ? conjunctionFilter.filters.map((f) => s24FilterEditorFromParsed(f, self.filterEditor, self))
      : [new s24StatementClass(null, self.filterEditor, self)];

    self.containerEl = createDiv("filter-group");
    self.containerEl.createDiv("filter-group-header", (headerEl) => {
      const select = headerEl.createEl("select", { cls: "conjunction dropdown" });
      select.createEl("option", { text: s24Strings().labelAllTheFollowing(), attr: { value: "and" } }, (opt) => {
        if (self.conjunction === "and") opt.selected = true;
      });
      select.createEl("option", { text: s24Strings().labelAnyOfTheFollowing(), attr: { value: "or" } }, (opt) => {
        if (self.conjunction === "or") opt.selected = true;
      });
      select.createEl("option", { text: s24Strings().labelNoneOfTheFollowing(), attr: { value: "not" } }, (opt) => {
        if (self.conjunction === "not") opt.selected = true;
      });
      select.addEventListener("change", () => {
        switch (select.value) {
          case "and": self.conjunction = "and"; break;
          case "or": self.conjunction = "or"; break;
          case "not": self.conjunction = "not"; break;
          default: throw new Error("Invalid conjunction");
        }
        self.renderChildren();
        if (self.children.last().serialize()) self.filterEditor.save();
      });
      headerEl.createDiv("filter-group-header-actions", (actions) => {
        if (self.parent) {
          const del = actions.createEl("button", { cls: "clickable-icon" });
          env().tv(del, "lucide-trash-2");
          del.addEventListener("click", () => {
            if (self.parent) self.parent.removeChild(self);
            else self.filterEditor.emptyTopLevelFilter();
          });
        }
      });
    });
    self.listEl = self.containerEl.createDiv("filter-group-statements");
    self.renderChildren();
    self.containerEl.createDiv("filter-group-actions", (actions) => {
      actions.createDiv({ cls: "text-icon-button", attr: { tabIndex: 0 } }, (btn) => {
        btn.createSpan("text-button-icon", (icon) => env().tv(icon, "lucide-plus"));
        btn.createSpan({ cls: "text-button-label", text: s24Strings().buttonAddFilter() });
        btn.addEventListener("click", () => {
          const statement = new s24StatementClass(null, self.filterEditor, self);
          self.children.push(statement);
          self.renderChildren();
          statement.focusLHS();
        });
      });
      actions.createDiv({ cls: "text-icon-button", attr: { tabIndex: 0 } }, (btn) => {
        btn.createSpan("text-button-icon", (icon) => env().tv(icon, "lucide-plus"));
        btn.createSpan({ cls: "text-button-label", text: s24Strings().buttonAddFilterGroup() });
        btn.addEventListener("click", () => {
          const groupFilter = new (s09AndFilter())([]);
          self.children.push(new FilterGroup(groupFilter, self.filterEditor, self));
          self.renderChildren();
        });
      });
    });
    return self;
  }
  inherit(FilterGroup, Base);

  FilterGroup.prototype.renderChildren = function () {
    const children = this.children, listEl = this.listEl;
    listEl.empty();
    for (let i = 0; i < children.length; i++) {
      const row = listEl.createDiv("filter-row");
      let label = this.conjunction === "and" ? s24Strings().labelAnd() : s24Strings().labelOr();
      if (i === 0) label = s24Strings().labelWhere();
      row.createEl("span", { cls: "conjunction", text: label });
      const child = children[i];
      if (child instanceof FilterGroup) row.addClass("mod-group");
      row.appendChild(child.containerEl);
    }
  };

  FilterGroup.prototype.removeChild = function (child) {
    this.children.remove(child);
    if (this.children.length > 0) {
      this.renderChildren();
      this.filterEditor.save();
      return;
    }
    if (this.parent) this.parent.removeChild(this);
    else this.filterEditor.emptyTopLevelFilter();
  };

  FilterGroup.prototype.replaceChild = function (oldChild, newChild) {
    const idx = this.children.indexOf(oldChild);
    this.children[idx] = newChild;
    this.filterEditor.save();
  };

  FilterGroup.prototype.serialize = function () {
    const filters = this.children.map((c) => c.serialize()).filter((f) => !!f);
    if (filters.length === 0) return null;
    switch (this.conjunction) {
      case "and": return { and: filters };
      case "or": return { or: filters };
      case "not": return { not: filters };
      default: throw new Error("Invalid conjunction");
    }
  };
  return FilterGroup;
}

// ---------------------------------------------------------------- `var EX` — root filter builder

function s24buildFilterBuilder() {
  function FilterBuilder(app, containerEl, queryController) {
    this.app = app;
    this.queryController = queryController;
    this.plugin = app.internalPlugins.getEnabledPluginById("bases");
    this.innerContainerEl = containerEl.createDiv("bases-query-container");
  }
  FilterBuilder.prototype.save = function () {
    const data = this.root.serialize();
    if (this.saveFn) this.saveFn.call(this, data);
  };
  FilterBuilder.prototype.emptyTopLevelFilter = function () {
    this.innerContainerEl.empty();
    const empty = new (s09AndFilter())(null);
    this.root = new s24GroupClass(empty, this, null);
    this.innerContainerEl.appendChild(this.root.containerEl);
    this.save();
  };
  FilterBuilder.prototype.updateQuery = function (saveFn, viewConfig, parsedFilter) {
    this.saveFn = saveFn;
    this.viewConfig = viewConfig;
    const self = this;
    const changed = (() => {
      if (!self.root) return true;
      const before = self.root.serialize();
      const after = parsedFilter === null || parsedFilter === undefined ? undefined : parsedFilter.serialize();
      return !(!before && !after) && JSON.stringify(before) !== JSON.stringify(after);
    })();
    if (changed) {
      this.innerContainerEl.empty();
      this.root = s24FilterEditorFromParsed(parsedFilter, this, undefined);
      this.innerContainerEl.appendChild(this.root.containerEl);
    }
  };
  return FilterBuilder;
}

// ---------------------------------------------------------------- `var xX` — single filter statement

function s24buildFilterStatement(host) {
  const Base = s24Once("s24FilterEditorBase", s24buildFilterEditorBase);
  const CMView = host.CMEditorView;
  const CMComp = host.cmCompartmentClass;

  function FilterStatement(ruleFilter, filterEditor, parent) {
    const self = Base.call(this, filterEditor, parent) || this;
    self.rightInputValue = null;
    self.advancedInputMode = false;
    self.advancedInputValue = "";
    self.advancedInputEditor = null;
    self.parsedQuery = ruleFilter === null || ruleFilter === undefined ? undefined : ruleFilter.rule;

    const app = filterEditor.app;
    const queryController = filterEditor.queryController;
    const strings = s24Strings();

    self.containerEl = createDiv("filter-statement");
    const exprEl = self.containerEl.createDiv("filter-expression metadata-property");
    const lhsContainer = self.leftInputContainerEl = exprEl.createDiv("filter-lhs-container");

    // focus tracking shared by the left input and the operator picker
    let focusCount = 0;
    const onFocusIn = () => { if (focusCount === 0) exprEl.addClass("has-focus"); focusCount++; };
    const onFocusOut = () => { focusCount = Math.max(0, focusCount - 1); if (focusCount === 0) exprEl.removeClass("has-focus"); };

    self.leftInputEl = new (s09PropertySuggest())(queryController, lhsContainer)
      .setPlaceholder(strings.labelPropertyKey())
      .filterProperties((id) => id !== "note.tags" && id !== "file.backlinks")
      .onOpen(onFocusIn)
      .onClose(onFocusOut)
      .onSelect(() => {
        const items = self.updateOperators();
        const current = self.operatorComponent.value;
        const match = items.find((item) => {
          if (item.funcName && current && current.funcName === item.funcName && !!current.inverse === !!item.inverse) return true;
          return current != null && current.value === item.value;
        }) || null;
        if (!match) {
          self.rightInputValue = null;
          self.operatorComponent.setValue(items[0]);
        }
        self.renderRightInput();
        self.operatorComponent.focus();
        self.update();
      });
    self.leftInputEl.buttonEl.addClass("filter-property-select");
    self.leftInputWarningEl = lhsContainer.createDiv({ cls: "clickable-icon metadata-property-warning-icon" });
    self.leftInputWarningEl.hide();
    env().Mv(self.leftInputWarningEl, env().gm.properties.labelTypeMismatchWarningGeneric());
    env().tv(self.leftInputWarningEl, "lucide-alert-triangle");

    self.operatorComponent = new (env().MI)(app, exprEl)
      .onOpen(onFocusIn)
      .onClose(onFocusOut)
      .onSelect(() => {
        self.renderRightInput();
        self.update();
        if (self.rightInputEl) self.rightInputEl.focus();
        else host.blurAndClearSelection();
      });
    self.operatorComponent.buttonEl.addClass("filter-operator");
    self.rightInputContainerEl = exprEl.createDiv("filter-rhs-container metadata-property-value");
    const advContainer = self.advancedInputContainerEl = exprEl.createDiv("formula-editor-container");
    self.advancedInputEditorEl = advContainer.createDiv("formula-editor");
    advContainer.hide();
    advContainer.onNodeInserted(() => {
      self.reconcileVisibleFields();
      if (self.advancedInputEditor) {
        self.advancedInputEditor.setRoot(self.containerEl.doc);
        self.advancedInputEditor.dispatch({
          effects: [self.tooltipCompartment.reconfigure(env().Ja({ parent: self.containerEl.doc.body }))],
        });
      }
    });
    self.tooltipCompartment = new CMComp();

    const rowActions = exprEl.createDiv("filter-row-actions");
    self.errorMessageEl = self.containerEl.createDiv("filter-row-error");
    self.errorMessageEl.hide();

    self.toggleAdvancedModeButton = rowActions.createEl("button", { cls: "clickable-icon filer-expression-mode-toggle" });
    env().Mv(self.toggleAdvancedModeButton, strings.tooltipFilterAdvancedMode());
    self.toggleAdvancedModeButton.addEventListener("click", () => {
      const serialized = self.serialize();
      if (self.advancedInputMode) {
        if (!serialized) {
          self.setFieldValuesFromInput(null);
          return;
        }
        const parsed = new (env().DK)(serialized);
        if (parsed.formula instanceof s09InvalidNode()) {
          new host.Notice(strings.msgFilterCannotParse());
          self.setErrorState(parsed.formula.getErrorMessage());
        } else {
          self.setFieldValuesFromInput(parsed);
          if (self.advancedInputMode) new host.Notice(strings.msgFilterSimpleUnavailable());
        }
      } else {
        self.advancedInputMode = true;
        self.setAdvancedValue(serialized);
        self.reconcileVisibleFields();
      }
    });

    const del = rowActions.createEl("button", { cls: "clickable-icon" });
    env().Mv(del, strings.tooltipRemoveFilter());
    env().tv(del, "trash-2");
    del.addEventListener("click", () => {
      if (self.parent) self.parent.removeChild(self);
      else self.filterEditor.emptyTopLevelFilter();
    });

    self.setFieldValuesFromInput(self.parsedQuery);
    return self;
  }
  inherit(FilterStatement, Base);

  // ---- operator list -----------------------------------------------------

  FilterStatement.prototype.setOperator = function (name, inverse) {
    name = name.toLowerCase();
    inverse = !!inverse;
    for (const item of this.operatorComponent.getItems()) {
      if (item.funcName) {
        if (name === item.funcName && inverse === !!item.inverse) {
          this.operatorComponent.setValue(item);
          return;
        }
      } else if (name === item.value) {
        this.operatorComponent.setValue(item);
        return;
      }
    }
    throw new Error("Unsupported operator");
  };

  FilterStatement.prototype.getSelectedFunction = function () {
    const value = this.operatorComponent.value;
    return value ? value.funcName || value.value : "";
  };

  FilterStatement.prototype.updateOperators = function () {
    const app = this.filterEditor.app;
    const lhsValue = this.getLHSValue();
    const selectedName = this.getSelectedFunction();
    const items = [];
    const allForValue = host.QW.getAllForValue(lhsValue);
    let methods = allForValue ? Object.values(allForValue).filter((v) => v instanceof env().KW) : [];
    if (!(lhsValue instanceof host.bW)) {
      methods = methods.filter((m) => !(!m.params || m.params.length === 0)
        && m.params[0].type.some((t) => lhsValue instanceof t));
    }
    if (!(lhsValue instanceof host.NW)) {
      const displayFor = (fallback, spec) => {
        if (lhsValue instanceof host.EW && spec.number) return spec.number;
        if (lhsValue instanceof host.LW && spec.date) return spec.date;
        if (lhsValue instanceof host.SW && spec.list) return spec.list;
        return fallback;
      };
      items.push({ display: displayFor("is", { number: "=", date: "on", list: "is exactly" }), value: "==" });
      items.push({ display: displayFor("is not", { number: "≠", date: "not on", list: "is not exactly" }), value: "!=" });
      if (lhsValue instanceof host.EW || lhsValue instanceof host.LW || s10FilterOrderOps.includes(selectedName)) {
        items.push({ display: displayFor("<", { number: "<", date: "before" }), value: "<" });
        items.push({ display: displayFor("≤", { number: "≤", date: "on or before" }), value: "<=" });
        items.push({ display: displayFor(">", { number: ">", date: "after" }), value: ">" });
        items.push({ display: displayFor("≥", { number: "≥", date: "on or after" }), value: ">=" });
      }
    }
    const funcDisplay = (name, inverse) => {
      const lower = name.toLowerCase();
      for (const group of Object.values(app.workspace.operatorFuncConfigs)) {
        for (const cfg of group) {
          if (lower === cfg.funcName.toLowerCase()) return inverse ? cfg.inverseDisplay : cfg.display;
        }
      }
      return name;
    };
    for (const method of methods) {
      const lower = method.name.toLowerCase();
      items.push({ display: funcDisplay(method.name, false), funcName: lower, value: lower, inverse: false });
    }
    for (const method of methods) {
      const lower = method.name.toLowerCase();
      items.push({ display: funcDisplay(method.name, true), funcName: lower, value: "!" + lower, inverse: true });
    }
    this.operatorComponent.setItems(items);
    return items;
  };

  // ---- visibility ---------------------------------------------------------

  FilterStatement.prototype.focusLHS = function () {
    if (this.advancedInputMode) this.advancedInputEditor.focus();
    else this.leftInputEl.focus();
  };

  FilterStatement.prototype.reconcileVisibleFields = function () {
    const self = this;
    if (this.advancedInputMode) {
      this.advancedInputContainerEl.show();
      this.operatorComponent.buttonEl.hide();
      this.leftInputContainerEl.hide();
      this.rightInputContainerEl.hide();
      this.leftInputWarningEl.hide();
      if (!this.advancedInputEditor) {
        this.advancedInputEditor = new CMView({
          doc: this.advancedInputValue,
          parent: this.advancedInputEditorEl,
          extensions: [
            ...s09FormulaEditorExtensions(),
            this.tooltipCompartment.of(env().Ja({ parent: this.containerEl.doc.body })),
            env().Ua(s24Strings().placeholderFilterAdvancedMode()),
            this.filterEditor.queryController.getEditorLanguageSupport(),
            CMView.domEventHandlers({ blur: this.update.bind(this) }),
            CMView.updateListener.of((update) => {
              if (update.docChanged) self.advancedInputValue = update.state.doc.toString();
            }),
          ],
        });
        env().Rv(this.advancedInputContainerEl, 500, () => {
          if (self.advancedInputEditor) self.advancedInputEditor.destroy();
          self.advancedInputEditor = null;
        });
      }
      this.advancedInputContainerEl.show();
      env().tv(this.toggleAdvancedModeButton, "mouse-pointer-click");
      env().Mv(this.toggleAdvancedModeButton, s24Strings().tooltipFilterSimpleMode());
    } else {
      this.advancedInputContainerEl.hide();
      this.leftInputContainerEl.show();
      if (this.advancedInputEditor) {
        this.advancedInputEditor.destroy();
        this.advancedInputEditor = null;
      }
      this.rightInputContainerEl.show();
      this.operatorComponent.buttonEl.show();
      env().tv(this.toggleAdvancedModeButton, "code-xml");
    }
  };

  // ---- formula <-> fields --------------------------------------------------

  FilterStatement.prototype.getFunction = function (name) {
    if (name) {
      const all = host.QW.getAllForValue(this.getLHSValue());
      const key = keyIgnoringCase(all, name);
      if (Object.hasOwn(all, key)) {
        const found = all[key];
        if (found instanceof env().KW) return found;
      }
    }
    return null;
  };

  FilterStatement.prototype.renderRightInput = function () {
    const self = this;
    const editor = this.filterEditor;
    const app = editor.app;
    const controller = editor.queryController;
    const value = this.rightInputValue;
    const selected = this.getSelectedFunction();
    const lhsId = this.getLeftInputValue();
    let widgetType = "text";
    let supported = true;
    if (s10FilterCompareOps.includes(selected)) {
      if (lhsId !== "" && lhsId.startsWith("note.")) {
        const typeName = parsePropertyId(lhsId).name;
        widgetType = app.metadataTypeManager.getTypeInfo(typeName).inferred.type;
      }
      const refId = s09PropertyToRef(lhsId);
      widgetType = controller.getWidgetForIdent(refId);
    } else {
      const fn = this.getFunction(selected);
      if (fn && fn.params.length > 1) {
        widgetType = ((p) => {
          if (p.customWidget) return p.customWidget;
          if (p.variadic) return "multitext";
          const t = s09ValueTypeName(p.type[0]);
          return t === "unknown" ? "text" : t;
        })(fn.params[1]);
      } else supported = false;
    }
    if (!supported) {
      this.rightInputEl = this.rightInputValue = null;
      this.rightInputContainerEl.empty();
      return;
    }
    if (this.rightInputEl && this.rightInputValue != null && this.rightInputEl.type === widgetType) {
      this.rightInputEl.setValue(value);
      return;
    }
    this.rightInputContainerEl.empty();
    let propName = "";
    if (lhsId !== "") {
      const parsed = parsePropertyId(lhsId);
      propName = parsed.type === "note" ? parsed.name : "";
    }
    const Widget = app.metadataTypeManager.getWidget(widgetType);
    this.rightInputEl = Widget.render(this.rightInputContainerEl, value, {
      app,
      blur: () => {},
      key: propName,
      hoverSource: "bases",
      onChange: (v) => { self.rightInputValue = v; self.update(); },
      sourcePath: "",
    });
  };

  FilterStatement.prototype.getLeftInputValue = function () {
    const value = this.leftInputEl.value;
    return (value === null || value === undefined ? undefined : value.value) || "";
  };

  FilterStatement.prototype.getLHSValue = function () {
    const ref = s09PropertyToRef(this.getLeftInputValue());
    return this.filterEditor.queryController.mockContext.evaluateIdent(ref);
  };

  FilterStatement.prototype.setFieldValuesFromInput = function (parsed) {
    this.advancedInputMode = false;
    if (!parsed) {
      this.rightInputValue = null;
      this.operatorComponent.setValue(null);
      this.leftInputEl.setValueById("file.file");
      const items = this.updateOperators();
      this.operatorComponent.setValue(items[0]);
      this.renderRightInput();
      this.reconcileVisibleFields();
      return;
    }
    let node = parsed.formula;
    let isNot = false;
    if (node instanceof s09NotNode()) { isNot = true; node = node.expr; }
    let handled = false;
    if (node instanceof s09CompareNode()) {
      try {
        this.leftInputEl.setValueById(s10FormulaIdentifier(node.left, s24Host));
        this.rightInputValue = s10FormulaLinktext([node.right], s24Host);
        this.updateOperators();
        this.setOperator(node.operator, isNot);
        this.renderRightInput();
        handled = true;
      } catch (e) { /* not representable in simple mode */ }
    } else if (node instanceof s09CallNode()) {
      try {
        this.leftInputEl.setValueById(s10FormulaIdentifier(node.subject, s24Host));
        this.rightInputValue = s10FormulaLinktext(node.args, s24Host);
        this.updateOperators();
        this.setOperator(node.name, isNot);
        this.renderRightInput();
        handled = true;
      } catch (e) { /* not representable in simple mode */ }
    } else if (node instanceof s09InvalidNode()) {
      this.setErrorState(node.getErrorMessage());
    }
    if (!handled) {
      this.advancedInputMode = true;
      this.setAdvancedValue(parsed.toString());
    }
    this.reconcileVisibleFields();
  };

  FilterStatement.prototype.setAdvancedValue = function (text) {
    this.advancedInputValue = text;
    if (this.advancedInputEditor) {
      const state = this.advancedInputEditor.state;
      this.advancedInputEditor.dispatch({ changes: { from: 0, to: state.doc.length, insert: text } });
    }
  };

  FilterStatement.prototype.setErrorState = function (message) {
    if (message) {
      this.containerEl.addClass("mod-error");
      env().tv(this.toggleAdvancedModeButton, "lucide-circle-alert");
      this.errorMessageEl.setText(message);
      this.errorMessageEl.show();
    } else {
      this.containerEl.removeClass("mod-error");
      this.errorMessageEl.hide();
      if (this.advancedInputMode) env().tv(this.toggleAdvancedModeButton, "mouse-pointer-click");
    }
  };

  FilterStatement.prototype.update = function () {
    this.setErrorState("");
    const hasValue = this.advancedInputMode || !this.rightInputEl
      || (this.rightInputValue !== null && this.rightInputValue !== "");
    if (hasValue) {
      const parsed = this.parsedQuery = new (env().DK)(this.serialize());
      if (parsed.formula instanceof s09InvalidNode() && this.advancedInputMode
        && this.advancedInputEditor.state.doc.length > 0) {
        this.setErrorState(parsed.formula.getErrorMessage());
      }
      try {
        this.filterEditor.save();
      } catch (e) { /* save errors are swallowed here */ }
    }
  };

  FilterStatement.prototype.serialize = function () {
    if (this.advancedInputMode) return this.advancedInputValue;
    const lhsId = this.getLeftInputValue();
    if (!lhsId) return "";
    const op = this.operatorComponent.value;
    if (!op) return "";
    const fn = this.getFunction(op.funcName);
    const lhsRef = s09PropertyToRef(lhsId);
    if (fn) {
      let result;
      if (fn.params.length > 1) {
        const raw = this.rightInputValue;
        if (raw == "" || raw == null) return "";
        result = Array.isArray(raw)
          ? fn.serialize.apply(fn, [lhsRef, ...raw.map((v) => this.quoteValueString(v))])
          : fn.serialize(lhsRef, this.quoteValueString(raw));
      } else {
        result = fn.serialize(lhsRef);
      }
      return op.inverse ? "!" + result : result;
    }
    const opValue = op.value;
    if (s10FilterCompareOps.includes(opValue)) {
      return `${lhsRef} ${opValue} ${this.quoteValueString(this.rightInputValue)}`;
    }
    return "";
  };

  FilterStatement.prototype.quoteValueString = function (value) {
    if (typeof value === "string") {
      if (value.startsWith("[[") && value.endsWith("]]")) {
        const bar = value.indexOf("|");
        return bar !== -1
          ? `link("${value.slice(2, bar)}", "${value.slice(bar + 1, -2)}")`
          : `link("${value.slice(2, -2)}")`;
      }
      const parts = value.split(".", 2);
      if (parts.length === 2 && ["note", "formula", "file", "this"].includes(parts[1])) return value;
      return `"${value}"`;
    }
    return isStringArray(value, true) ? JSON.stringify(value) : String(value);
  };

  return FilterStatement;
}

// ---------------------------------------------------------------- factories (called with __basaltHost)

export function s24FilterEditorBase(host) { s24Host = host; return s24Once("s24FilterEditorBase", s24buildFilterEditorBase); }
export function s24FilterGroup(host) { s24Host = host; return s24GroupClass ??= s24Once("s24FilterGroup", s24buildFilterGroup); }
export function s24FilterStatement(host) { s24Host = host; return s24StatementClass ??= s24Once("s24FilterStatement", () => s24buildFilterStatement(host)); }
export function s24FilterBuilder(host) { s24Host = host; return s24Once("s24FilterBuilder", s24buildFilterBuilder); }
