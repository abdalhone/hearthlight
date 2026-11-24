// Tiny DOM toolkit for the UI. Functions only (never run at import time).
// Text always goes through textContent: names and lines can come from a language
// model or from the player, so nothing is ever parsed as HTML.

import { iconUrl, iconSize } from './icons.js';

export function h(tag, props, ...children) {
  const el = document.createElement(tag);
  if (props) {
    for (const k in props) {
      const v = props[k];
      if (v == null || v === false) continue;
      if (k === 'class') el.className = v;
      else if (k === 'text') el.textContent = String(v);
      else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
      else if (k === 'dataset') Object.assign(el.dataset, v);
      else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
      else if (typeof v === 'boolean' || typeof v === 'number' || k === 'value') {
        if (k in el) el[k] = v;
        else el.setAttribute(k, String(v));
      } else el.setAttribute(k, String(v));
    }
  }
  appendAll(el, children);
  return el;
}

export function appendAll(el, children) {
  for (const c of children) {
    if (c == null || c === false) continue;
    if (Array.isArray(c)) appendAll(el, c);
    else el.append(c instanceof Node ? c : String(c));
  }
  return el;
}

export function clear(el) {
  while (el.firstChild) el.removeChild(el.firstChild);
  return el;
}

// Write text only when it changed (keeps layout and paint work out of hot paths).
export function setText(el, text) {
  const s = text == null ? '' : String(text);
  if (el._txt !== s) {
    el._txt = s;
    el.textContent = s;
  }
}

export function setStyle(el, prop, value) {
  const key = `_st_${prop}`;
  if (el[key] !== value) {
    el[key] = value;
    el.style.setProperty(prop, value);
  }
}

export function toggleClass(el, cls, on) {
  const want = !!on;
  const key = `_cl_${cls}`;
  if (el[key] !== want) {
    el[key] = want;
    el.classList.toggle(cls, want);
  }
}

export function setAttr(el, name, value) {
  const key = `_at_${name}`;
  if (el[key] !== value) {
    el[key] = value;
    if (value == null || value === false) el.removeAttribute(name);
    else el.setAttribute(name, value === true ? '' : String(value));
  }
}

// Pixel icon at an integer scale of its grid (CSS --isc picks the scale).
export function icon(name, cls = '') {
  const img = h('img', { class: `px-icon ${cls}`.trim(), alt: '', draggable: 'false', 'aria-hidden': 'true' });
  setIcon(img, name);
  return img;
}

export function setIcon(img, name) {
  if (img._icon !== name) {
    img._icon = name;
    const { w, h: ih } = iconSize(name);
    img.style.setProperty('--iw', String(w || 9));
    img.style.setProperty('--ih', String(ih || 9));
    img.src = iconUrl(name);
  }
}

// A pixel-styled button. opts: { icon, cls, title, key, onClick, disabled }
export function button(label, opts = {}) {
  const b = h('button', {
    type: 'button',
    class: `btn ${opts.cls || ''}`.trim(),
    title: opts.title || null,
    'aria-label': opts.aria || (label ? null : opts.title) || null,
    disabled: !!opts.disabled,
  });
  if (opts.icon) b.append(icon(opts.icon));
  if (label) b.append(h('span', { class: 'btn-label', text: label }));
  if (opts.key) b.append(h('kbd', { class: 'keycap', text: opts.key }));
  if (opts.onClick) b.addEventListener('click', opts.onClick);
  return b;
}

// A labelled meter bar; returns { el, set(fraction, text) }.
export function meter(cls, label) {
  const fill = h('div', { class: 'meter-fill' });
  const txt = h('span', { class: 'meter-text' });
  const el = h('div', { class: `meter ${cls}`, role: 'meter', 'aria-label': label || null }, h('div', { class: 'meter-track' }, fill), txt);
  return {
    el,
    set(f, text) {
      setStyle(fill, 'width', `${Math.round(Math.max(0, Math.min(1, f)) * 1000) / 10}%`);
      if (text !== undefined) setText(txt, text);
    },
  };
}

// Canvas -> cached data URL, for portraits and item icons shown as <img>.
const urlCache = new WeakMap();
export function canvasUrl(canvas) {
  if (!canvas) return '';
  let u = urlCache.get(canvas);
  if (!u) {
    try {
      u = canvas.toDataURL('image/png');
    } catch {
      u = '';
    }
    urlCache.set(canvas, u);
  }
  return u;
}

export function onTap(el, fn) {
  el.addEventListener('click', fn);
  return el;
}

// Clipboard write that must start inside the click handler (user activation).
export function copyText(text) {
  try {
    if (navigator.clipboard?.writeText) return navigator.clipboard.writeText(text).then(() => true, () => fallbackCopy(text));
  } catch {
    /* fall through */
  }
  return Promise.resolve(fallbackCopy(text));
}

function fallbackCopy(text) {
  try {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.cssText = 'position:fixed;left:-9999px;top:0;opacity:0';
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand && document.execCommand('copy');
    ta.remove();
    return !!ok;
  } catch {
    return false;
  }
}

export function isTouchDevice() {
  try {
    return window.matchMedia?.('(pointer: coarse)').matches || false;
  } catch {
    return false;
  }
}

export function prefersReducedMotion() {
  try {
    return window.matchMedia?.('(prefers-reduced-motion: reduce)').matches || false;
  } catch {
    return false;
  }
}
