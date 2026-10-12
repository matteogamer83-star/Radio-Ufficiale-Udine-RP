/* Componenti dell'interfaccia: finestre, avvisi brevi, menu a comparsa, campi dei moduli */
import { $, el, icon } from './util.js';

// ------------------------------------------------------------------ finestra (modale; sul telefono sale dal basso)
export const modal = {
  actions: [],
  onClose: null,
  lastFocus: null,
  open(opts) {
    const title = $('#modalTitle');
    title.textContent = '';
    if (opts.icon) title.append(icon(opts.icon));
    title.append(document.createTextNode(opts.title || ''));
    const body = $('#modalBody');
    body.textContent = '';
    if (typeof opts.body === 'string') body.append(el('p', 'muted', opts.body));
    else if (opts.body) body.append(opts.body);
    const box = $('#modalActions');
    box.textContent = '';
    this.actions = opts.actions || [{ label: 'Chiudi', cls: 'btn-primary' }];
    for (const a of this.actions) {
      const b = el('button', 'btn ' + (a.cls || ''));
      b.type = 'button';
      if (a.icon) b.append(icon(a.icon));
      b.append(el('span', null, a.label));
      b.onclick = () => this.run(a, b);
      box.append(b);
    }
    this.onClose = opts.onClose || null;
    $('#modal').classList.toggle('wide', !!opts.wide);
    if ($('#modal').hidden) this.lastFocus = document.activeElement;
    $('#modal').hidden = false;
    $('#modalBody').scrollTop = 0;
    // primo campo pronto per scrivere (sul PC); sul telefono non apriamo la tastiera da soli
    if (opts.focus !== false && window.matchMedia('(pointer: fine)').matches) {
      setTimeout(() => {
        const f = opts.focus || $('#modalBody').querySelector('input:not([type=checkbox]):not([type=range]):not([disabled]), textarea, select');
        if (f) f.focus();
      }, 60);
    }
  },
  async run(a, btn) {
    if (a.onClick) {
      let r;
      try {
        if (btn) btn.disabled = true;
        r = await a.onClick();
      } catch (e) {
        toast((e && e.message) || 'Errore', { kind: 'bad', icon: 'alert', ms: 5000 });
        r = false;
      } finally {
        if (btn) btn.disabled = false;
      }
      if (r === false) return;
    }
    this.close();
  },
  submit() {
    const a = this.actions.find((x) => x.primary);
    if (a) this.run(a, null);
  },
  close() {
    if ($('#modal').hidden) return;
    $('#modal').hidden = true;
    const f = this.onClose;
    this.onClose = null;
    if (f) f();
    if (this.lastFocus && this.lastFocus.focus) {
      try {
        this.lastFocus.focus({ preventScroll: true });
      } catch (e) {}
    }
  },
  isOpen() {
    return !$('#modal').hidden;
  },
};

export function confirmBox(title, text, okLabel, okCls, fn, ico) {
  modal.open({
    title,
    icon: ico,
    body: text,
    actions: [{ label: 'Annulla' }, { label: okLabel, cls: okCls || 'btn-danger', primary: true, onClick: fn }],
  });
}

// ------------------------------------------------------------------ avvisi brevi in alto
const TOAST_ICONS = { ok: 'check', bad: 'alert', cen: 'broadcast', priv: 'private', info: 'info' };
/** toast("testo") oppure toast("testo", { kind: 'ok'|'bad'|'cen'|'priv', icon, ms }) o toast("testo", 5000) */
export function toast(msg, opts) {
  if (typeof opts === 'number') opts = { ms: opts };
  opts = opts || {};
  const box = $('#toasts');
  const t = el('div', 'toast' + (opts.kind ? ' t-' + opts.kind : ''));
  t.setAttribute('role', 'status');
  t.append(icon(opts.icon || TOAST_ICONS[opts.kind] || 'info'), el('div', null, msg));
  box.append(t);
  while (box.children.length > 3) box.firstChild.remove();
  const ms = opts.ms || Math.min(7000, 2600 + String(msg).length * 30);
  let left = ms;
  let since = Date.now();
  let timer = setTimeout(dismiss, ms);
  // il tempo si ferma mentre ci passi sopra col mouse
  t.onpointerenter = () => {
    clearTimeout(timer);
    left -= Date.now() - since;
  };
  t.onpointerleave = () => {
    since = Date.now();
    timer = setTimeout(dismiss, Math.max(800, left));
  };
  t.onclick = dismiss;
  function dismiss() {
    clearTimeout(timer);
    t.classList.add('out');
    setTimeout(() => t.remove(), 200);
  }
  return dismiss;
}

// ------------------------------------------------------------------ menu a comparsa vicino a un elemento
export const popover = {
  anchor: null,
  open(anchor, build) {
    const p = $('#popover');
    if (!p.hidden && this.anchor === anchor) return this.close();
    p.textContent = '';
    build(p);
    p.hidden = false;
    this.anchor = anchor;
    const r = anchor.getBoundingClientRect();
    const pw = p.offsetWidth;
    const ph = p.offsetHeight;
    let x = r.left;
    let y = r.bottom + 6;
    let ox = 'left';
    let oy = 'top';
    if (x + pw > innerWidth - 12) {
      x = Math.max(12, r.right - pw);
      ox = 'right';
    }
    if (y + ph > innerHeight - 12) {
      y = Math.max(12, r.top - ph - 6);
      oy = 'bottom';
    }
    p.style.left = x + 'px';
    p.style.top = y + 'px';
    p.style.setProperty('--origin', `${oy} ${ox}`);
    const first = p.querySelector('button:not(:disabled)');
    if (first && window.matchMedia('(pointer: fine)').matches) first.focus({ preventScroll: true });
  },
  item(label, ico, onClick, opts) {
    const b = el('button', 'pop-item' + (opts && opts.on ? ' on' : ''));
    b.type = 'button';
    if (ico) b.append(icon(ico));
    b.append(el('span', null, label));
    if (opts && opts.hint) b.append(el('small', null, opts.hint));
    if (opts && opts.disabled) b.disabled = true;
    b.onclick = () => {
      this.close();
      onClick();
    };
    return b;
  },
  close() {
    const p = $('#popover');
    if (p.hidden) return;
    p.hidden = true;
    this.anchor = null;
  },
  isOpen() {
    return !$('#popover').hidden;
  },
};
document.addEventListener(
  'pointerdown',
  (e) => {
    const p = $('#popover');
    if (p && !p.hidden && !p.contains(e.target) && !(popover.anchor && popover.anchor.contains(e.target))) popover.close();
  },
  true
);
window.addEventListener('resize', () => popover.close());

// ------------------------------------------------------------------ campi dei moduli
export function input(value, placeholder, type) {
  const i = el('input', 'input');
  i.type = type || 'text';
  i.value = value == null ? '' : String(value);
  if (placeholder) i.placeholder = placeholder;
  i.autocomplete = 'off';
  return i;
}
export function field(label, control, hint) {
  const f = el('div', 'fld');
  f.append(el('span', 'fld-label', label), control);
  if (hint) f.append(hint instanceof Node ? hint : el('small', 'fld-hint', hint));
  return f;
}
export function checkbox(label, checked, hint) {
  const w = el('label', 'chk');
  const cb = el('input');
  cb.type = 'checkbox';
  cb.checked = !!checked;
  const t = el('span');
  t.append(el('b', null, label));
  if (hint) t.append(el('small', null, hint));
  w.append(cb, t);
  w.cb = cb;
  return w;
}
export function switchEl(checked, onChange) {
  const w = el('label', 'switch');
  const cb = el('input');
  cb.type = 'checkbox';
  cb.checked = !!checked;
  cb.onchange = () => onChange && onChange(cb.checked, cb);
  w.append(cb, el('i'));
  w.cb = cb;
  return w;
}
/** Scelte a segmenti: options = [[valore, etichetta, icona?]] */
export function segmented(options, value, onChange, cls) {
  const seg = el('div', 'seg ' + (cls || ''));
  for (const [v, label, ico] of options) {
    const b = el('button', v === value ? 'on' : '');
    b.type = 'button';
    if (ico) b.append(icon(ico));
    b.append(document.createTextNode(label));
    b.onclick = () => {
      seg.querySelectorAll('button').forEach((x) => x.classList.toggle('on', x === b));
      onChange(v);
    };
    seg.append(b);
  }
  return seg;
}
/** Riga delle impostazioni: etichetta (con icona e spiegazione) + controllo */
export function setRow(ico, label, control, hint) {
  const r = el('div', 'set-row');
  const l = el('div', 'set-label');
  if (ico) l.append(icon(ico));
  const t = el('div');
  t.append(el('b', null, label));
  if (hint) t.append(el('small', null, hint));
  l.append(t);
  r.append(l);
  if (control) r.append(control);
  return r;
}
