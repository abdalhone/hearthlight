// The game's own mood faces in the DOM (round 15, item 2). Every place a face shows a mood
// (the companion card on the HUD, its folded corner on a phone, People, the chat's header,
// the Mind panel) uses these: a pixel face from src/art/faces_art.js as an <img> that keeps
// a text label for screen readers and a tooltip ("Mood: afraid"). Never a system emoji.
//
//   faceImg(kind, label, cls)    a new <img class="px-face">
//   setFace(img, kind, label)    change it (a no-op when nothing changed)

import { h } from './dom.js';
import { faceUrl, faceLabel, FACE_SIZE } from '../art/faces_art.js';

export function setFace(img, kind, label = '', { prefix = 'Mood' } = {}) {
  if (!img) return img;
  const k = kind || 'neutral';
  const words = label || faceLabel(k);
  const text = prefix ? `${prefix}: ${words}` : words;
  if (img._face !== k) {
    img._face = k;
    img.src = faceUrl(k);
    img.dataset.face = k;
  }
  if (img._faceText !== text) {
    img._faceText = text;
    img.alt = text;
    img.title = text;
    img.setAttribute('aria-label', text);
  }
  return img;
}

export function faceImg(kind, label = '', cls = '', opts = {}) {
  const img = h('img', { class: `px-face ${cls}`.trim(), draggable: 'false', role: 'img' });
  img.style.setProperty('--iw', String(FACE_SIZE.w));
  img.style.setProperty('--ih', String(FACE_SIZE.h));
  return setFace(img, kind, label, opts);
}
