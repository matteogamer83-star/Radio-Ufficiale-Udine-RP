/* Impostazioni personali (restano su questo dispositivo) */
import { store } from './util.js';

export const finePointer = !!(window.matchMedia && matchMedia('(pointer: fine)').matches);

export const DEFAULTS = {
  volume: 1,
  muted: false,
  radioFx: true, // filtro "radio" sulla voce
  suono: 'analogico', // analogico (fruscio e beep Motorola) | digitale (TETRA, pulito) | classico
  fruscio: true, // fruscio di fondo mentre qualcuno parla (solo suono analogico)
  pttMode: 'hold', // hold = tieni premuto, toggle = premi una volta
  pttKey: 'Space',
  callKey: '', // tasto per chiamare la Centrale (nessuno finché non lo scegli)
  beeps: true,
  toniTasti: true, // toni DTMF del tastierino
  vibrate: true,
  wakeLock: true,
  tastoPc: finePointer, // risponde al tasto PTT per Windows
  notifiche: false,
  skin: 'nero',
  retro: 'ambra', // colore del display a riposo
};

export const settings = Object.assign({}, DEFAULTS, store.get('settings', {}));
export const saveSettings = () => store.set('settings', settings);

export function vibrate(pattern) {
  if (settings.vibrate && navigator.vibrate) {
    try {
      navigator.vibrate(pattern);
    } catch (e) {}
  }
}

export const SKINS = [
  { id: 'nero', nome: 'Nero tattico', c: 'linear-gradient(160deg,#30353c,#0f1114)' },
  { id: 'titanio', nome: 'Titanio', c: 'linear-gradient(160deg,#6b727c,#2c3037)' },
  { id: 'blu', nome: 'Blu Polizia', c: 'linear-gradient(160deg,#3561a3,#11223e)' },
  { id: 'rosso', nome: 'Rosso Vigili del Fuoco', c: 'linear-gradient(160deg,#c9342a,#5a0f0a)' },
  { id: 'giallo', nome: 'Giallo soccorso', c: 'linear-gradient(160deg,#f7cf4f,#b8860a)' },
  { id: 'verde', nome: 'Verde operativo', c: 'linear-gradient(160deg,#5b6e47,#1f2818)' },
];
export const BACKLIGHTS = [
  { id: 'ambra', nome: 'Ambra', c: '#f5a93a' },
  { id: 'verde', nome: 'Verde', c: '#9fd860' },
  { id: 'bianco', nome: 'Bianco', c: '#dfe8f0' },
  { id: 'blu', nome: 'Azzurro', c: '#6cc3f2' },
];
