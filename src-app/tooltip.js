// Compatibility surface: implementations live in n-g40-tooltip.js / n-g40-tooltip-ui.js.
import { ng40HideTooltip, ng40CancelTooltipDelay, ng40TooltipsDisabled, ng40DisplayTooltip, ng40ApplyTooltipOptions, ng40SetElementTooltip, ng40SetDynamicTooltip } from "./n-g40-tooltip.js";
import { ng40InitTooltips, ng40ShowTooltipFromAttributes, ng40OnTooltipPointerOver, ng40OnTooltipPointerOut, ng40InstallTooltipHandlers } from "./n-g40-tooltip-ui.js";
export function hideTooltip() { return ng40HideTooltip(); }
export function cancelTooltipDelay() { return ng40CancelTooltipDelay(); }
export function tooltipsDisabled(el) { return ng40TooltipsDisabled(el); }
export function displayTooltip(el, text, options) { return ng40DisplayTooltip(el, text, options); }
export function applyTooltipOptions(el, options) { return ng40ApplyTooltipOptions(el, options); }
export function setElementTooltip(el, text, options) { return ng40SetElementTooltip(el, text, options); }
export function setDynamicTooltip(el, getText, options) { return ng40SetDynamicTooltip(el, getText, options); }
export function initTooltips(host) { return ng40InitTooltips(host); }
export function showTooltipFromAttributes(el) { return ng40ShowTooltipFromAttributes(el); }
export function onTooltipPointerOver(event, el) { return ng40OnTooltipPointerOver(event, el); }
export function onTooltipPointerOut(event, el) { return ng40OnTooltipPointerOut(event, el); }
export function installTooltipHandlers(doc) { return ng40InstallTooltipHandlers(doc); }
