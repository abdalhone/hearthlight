// Panel frames and the in-UI confirmation dialog. The UI facade owns the stack of
// open panels; this module only builds their markup.

import { h, icon, button } from './dom.js';

// A framed panel: header (icon, title, subtitle, close), scrolling body, optional footer.
export function makePanel({ id, title, subtitle = '', iconName = null, cls = '', onClose = null, closeLabel = 'Close' }) {
  const titleEl = h('h2', { class: 'panel-title', id: `panel-title-${id}`, text: title });
  const subEl = h('div', { class: 'panel-sub', text: subtitle });
  const closeBtn = button('', { icon: 'close', cls: 'btn-icon panel-close', title: `${closeLabel} (Esc)` });
  const head = h('header', { class: 'panel-head' }, iconName ? icon(iconName, 'panel-icon') : null, h('div', { class: 'panel-heading' }, titleEl, subEl), closeBtn);
  const body = h('div', { class: 'panel-body' });
  const foot = h('footer', { class: 'panel-foot' });
  const el = h('section', { class: `panel panel-${id} ${cls}`.trim(), role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': `panel-title-${id}` }, head, body, foot);
  const panel = {
    id,
    el,
    head,
    body,
    foot,
    titleEl,
    subEl,
    closeBtn,
    onClose,
    pauses: false,
    setTitle(t, s) {
      titleEl.textContent = t;
      if (s !== undefined) subEl.textContent = s;
    },
  };
  return panel;
}

// Confirmation panel content: resolves via the callbacks; never uses window.confirm.
export function makeConfirm({ title, text, yes = 'Yes', no = 'Cancel', danger = false }) {
  const panel = makePanel({ id: 'confirm', title, iconName: danger ? 'heart' : 'scroll', cls: 'panel-small' });
  panel.body.append(h('p', { class: 'confirm-text', text }));
  const yesBtn = button(yes, { cls: danger ? 'btn-danger' : 'btn-ember' });
  const noBtn = button(no, { cls: 'btn-ghost' });
  panel.foot.append(noBtn, yesBtn);
  panel.yesBtn = yesBtn;
  panel.noBtn = noBtn;
  return panel;
}
