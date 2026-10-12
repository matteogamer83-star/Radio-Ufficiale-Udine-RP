/* Piccoli aiuti usati da tutta la radio */

export const $ = (s, root = document) => root.querySelector(s);
export const $$ = (s, root = document) => [...root.querySelectorAll(s)];
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export const clamp = (n, a, b) => Math.min(b, Math.max(a, n));

export function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}

const SVG_NS = 'http://www.w3.org/2000/svg';
/** Icona dal set disegnato in index.html (#i-nome) */
export function icon(name, cls) {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('class', 'ico' + (cls ? ' ' + cls : ''));
  svg.setAttribute('aria-hidden', 'true');
  const use = document.createElementNS(SVG_NS, 'use');
  use.setAttribute('href', '#i-' + name);
  svg.append(use);
  return svg;
}

/** Pulsante con icona e testo */
export function button(label, cls, onClick, ico, title) {
  const b = el('button', 'btn ' + (cls || ''));
  b.type = 'button';
  if (ico) b.append(icon(ico));
  if (label) b.append(el('span', null, label));
  if (title) b.title = title;
  if (onClick) b.onclick = onClick;
  return b;
}

export const store = {
  get(k, d) {
    try {
      const v = localStorage.getItem('urp3:' + k);
      return v == null ? d : JSON.parse(v);
    } catch (e) {
      return d;
    }
  },
  set(k, v) {
    try {
      if (v == null) localStorage.removeItem('urp3:' + k);
      else localStorage.setItem('urp3:' + k, JSON.stringify(v));
    } catch (e) {}
  },
};

export function fmtTime(ts) {
  return new Date(ts).toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' });
}
export function fmtDur(s) {
  s = Math.max(0, Math.floor(s));
  return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
}
export function ago(ts) {
  if (!ts) return 'mai entrato';
  const d = new Date(ts);
  const today = new Date();
  if (d.toDateString() === today.toDateString()) return 'oggi alle ' + fmtTime(ts);
  const days = Math.max(1, Math.round((today - d) / 86400000));
  return days === 1 ? 'ieri' : `${days} giorni fa`;
}
export function displayName(u) {
  if (!u) return '';
  return u.sigla ? `${u.sigla} · ${u.nome}` : u.nome;
}
export function initials(nome) {
  const p = String(nome || '?').trim().split(/\s+/).filter(Boolean);
  if (!p.length) return '?';
  return ((p[0][0] || '') + (p.length > 1 ? p[p.length - 1][0] : p[0][1] || '')).toUpperCase();
}
export function isTyping(t) {
  return !!t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable);
}
export function keyName(code) {
  const map = {
    Space: 'Spazio', ControlLeft: 'Ctrl sinistro', ControlRight: 'Ctrl destro', ShiftLeft: 'Maiusc sinistro',
    ShiftRight: 'Maiusc destro', AltLeft: 'Alt', AltRight: 'Alt Gr', CapsLock: 'Bloc Maiusc', Tab: 'Tab',
    Backquote: '\\', Enter: 'Invio', Backspace: 'Backspace', ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←',
    ArrowRight: '→', Insert: 'Ins', Delete: 'Canc', Home: 'Home', End: 'Fine', PageUp: 'Pag ↑', PageDown: 'Pag ↓',
  };
  if (map[code]) return map[code];
  if (/^Key[A-Z]$/.test(code)) return code.slice(3);
  if (/^Digit\d$/.test(code)) return code.slice(5);
  if (/^Numpad/.test(code)) return 'Num ' + code.slice(6);
  return code;
}

/** Testo per il display a segmenti: maiuscolo, senza accenti, solo i caratteri che il display sa disegnare */
export function segText(s) {
  return String(s || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toUpperCase()
    .replace(/·/g, '-')
    .replace(/[^A-Z0-9.\-:/' ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}
/** Testo per le righe a matrice di punti (VT323): niente emoji, niente accenti strani */
export function dotText(s) {
  return String(s || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^\x20-\x7E·]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

// Stato operativo (come i messaggi di stato TETRA). Gli stessi nomi del server.
export const STATI = [
  { id: 'disponibile', nome: 'Disponibile', breve: 'DISP', colore: '#36e07d' },
  { id: 'servizio', nome: 'In servizio', breve: 'SERV', colore: '#3ec9ff' },
  { id: 'intervento', nome: 'In intervento', breve: 'INTV', colore: '#ff8a2a' },
  { id: 'occupato', nome: 'Occupato', breve: 'OCC', colore: '#a98bff' },
  { id: 'pausa', nome: 'In pausa', breve: 'PAUS', colore: '#ffd23f' },
  { id: 'fuori', nome: 'Fuori servizio', breve: 'OFF', colore: '#7f8c9c' },
];
export const statoInfo = (id) => STATI.find((s) => s.id === id) || STATI[0];

/** Pallino dello stato operativo */
export function statusPill(id) {
  const s = statoInfo(id);
  const p = el('span', 'status-pill', s.nome);
  p.style.setProperty('--st', s.colore);
  return p;
}

/** Copia negli appunti (con riserva per i browser vecchi) */
export async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch (e) {
    const ta = el('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.append(ta);
    ta.select();
    let ok = false;
    try {
      ok = document.execCommand('copy');
    } catch (err) {}
    ta.remove();
    return ok;
  }
}

/** Scarica un file generato nella pagina */
export function saveFile(name, blob) {
  const a = el('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 10000);
}

export const reducedMotion = () => !!(window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches);
