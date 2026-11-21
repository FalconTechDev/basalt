// g29 clean-room: back/forward history navigation button (spec Part C).
// Plain click steps one entry; mod+click duplicates the leaf first;
// contextmenu / touch long-press / downward drag opens a jump-to-entry menu.

const NG29_PRESS_MS = 400;
const NG29_DRAG_PX_SQ = 25;

export function s04HistoryNavButton(app, getLeaf, direction, host) {
  const backward = direction === "backward";
  const button = host.createEl("button", "clickable-icon");
  button.setAttribute("aria-disabled", "true");
  host.setTooltip(button, backward ? host.t.commands.navigateBack() : host.t.commands.navigateForward());

  async function navigate(event, steps) {
    const withDuplicate = host.keyModifiers.isModEvent(event);
    let leaf = getLeaf();
    if (withDuplicate) leaf = await app.workspace.duplicateLeaf(leaf, withDuplicate);
    await leaf.history.go(backward ? -steps : steps);
  }

  function openHistoryMenu(forwardMouseUp) {
    const leaf = getLeaf();
    const history = backward ? leaf.history.backHistory : leaf.history.forwardHistory;
    host.hideTooltip();
    const menu = new host.Menu();
    const items = [];
    for (let index = history.length - 1; index >= 0; index--) {
      const entry = history[index];
      const item = menu.addItem((menuItem) => {
        menuItem.setTitle(host.truncateText(entry.title, 50)).setIcon(entry.icon);
        menuItem.onClick((event) => navigate(event, history.length - index));
      });
      items.push(item);
    }
    const rect = button.getBoundingClientRect();
    menu.showAtPosition({ x: rect.x, y: rect.bottom, width: rect.width, overlap: true });
    if (forwardMouseUp) {
      menu.dom.addEventListener("mouseup", (event) => {
        setTimeout(() => {
          const target = event.targetNode || event.target;
          const hit = items.find((it) => it.dom && it.dom.contains(target));
          if (hit && hit.handleEvent) hit.handleEvent(event);
        }, 0);
      }, { once: true });
    }
  }

  button.addEventListener("click", (event) => {
    if (event.button === 2) return;
    navigate(event, 1);
  });
  button.addEventListener("contextmenu", (event) => {
    event.preventDefault();
    openHistoryMenu(false);
  });

  // touch long-press (400 ms) or downward drag (>5 px, dy dominant) opens the menu
  let pressTimer = null;
  let pressX = 0;
  let pressY = 0;
  let pressing = false;
  const cancelPress = () => {
    pressing = false;
    if (pressTimer !== null) { clearTimeout(pressTimer); pressTimer = null; }
  };
  button.addEventListener("mousedown", (event) => {
    pressing = true;
    pressX = event.clientX;
    pressY = event.clientY;
    pressTimer = setTimeout(() => {
      pressTimer = null;
      pressing = false;
      openHistoryMenu(true);
    }, NG29_PRESS_MS);
  });
  window.addEventListener("mousemove", (event) => {
    if (!pressing) return;
    const dx = event.clientX - pressX;
    const dy = event.clientY - pressY;
    if (dx * dx + dy * dy <= NG29_DRAG_PX_SQ) return;
    cancelPress();
    if (dy > 0 && dy > Math.abs(dx)) openHistoryMenu(true);
  });
  window.addEventListener("mouseup", cancelPress);

  return button;
}
