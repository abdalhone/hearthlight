// Interface size with a mouse (r13; the author: "on pc i feel that the hud is a little
// small"; DESIGN §14): the HUD (cards, mission line, prompt, the weave bar) and every panel
// are drawn larger on a computer, by Settings → Display → Interface size (Small / Normal /
// Large) times how big the window is next to 1280×720, so the HUD keeps its share of the
// screen on a big monitor. Phones and tablets keep their sizes (their buttons have
// Controls → Button size). Applied as CSS `zoom: var(--uiz)` on the HUD, the chat and the
// panel layer (styles.css, "Interface size"); toasts and the coach stay at 1 because they
// are placed by measured boxes.

export const UI_SIZES = Object.freeze({ small: 1, normal: 1.2, large: 1.45 });
export const UI_SIZE_DEFAULT = 'normal';

// Pure: the zoom for a window of w×h CSS px. Touch: always 1.
export function uiZoom(size, w, h, touch = false) {
  if (touch) return 1;
  const base = UI_SIZES[size] ?? UI_SIZES[UI_SIZE_DEFAULT];
  const fit = Math.max(0.8, Math.min(1.35, Math.min((Number(w) || 1280) / 1280, (Number(h) || 720) / 720)));
  // Never so large the left column (about 290 px of cards) takes over a narrow window.
  const cap = Math.max(0.75, ((Number(w) || 1280) * 0.36) / 290);
  return Math.round(Math.min(base * fit, cap) * 100) / 100;
}

// Sets --uiz on the UI root (and the `ui-zoomed` class when it is not 1).
export function applyUiZoom(ui) {
  const root = ui?.root;
  if (!root || typeof window === 'undefined') return 1;
  const z = uiZoom(ui.game?.settings?.uiSize, window.innerWidth, window.innerHeight, !!ui.isTouch);
  if (ui._uiz === z) return z;
  ui._uiz = z;
  root.style.setProperty('--uiz', String(z));
  root.classList.toggle('ui-zoomed', z !== 1);
  return z;
}
