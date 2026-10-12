/*
 * Spettro a cascata (come sui ricevitori SDR) sul fondo della schermata d'accesso:
 * rumore di fondo, qualche portante fissa e trasmissioni che compaiono e spariscono.
 */
import { reducedMotion } from './util.js';

const STOPS = [
  [0, [5, 8, 12]],
  [0.28, [8, 30, 52]],
  [0.5, [12, 92, 118]],
  [0.7, [240, 150, 30]],
  [0.86, [255, 205, 110]],
  [1, [255, 246, 220]],
];
function color(v) {
  v = Math.max(0, Math.min(1, v));
  for (let i = 1; i < STOPS.length; i++) {
    if (v <= STOPS[i][0]) {
      const [a, ca] = STOPS[i - 1];
      const [b, cb] = STOPS[i];
      const t = (v - a) / (b - a);
      return [ca[0] + (cb[0] - ca[0]) * t, ca[1] + (cb[1] - ca[1]) * t, ca[2] + (cb[2] - ca[2]) * t];
    }
  }
  return STOPS[STOPS.length - 1][1];
}
const LUT = Array.from({ length: 256 }, (_, i) => color(i / 255));

export function startWaterfall(canvas) {
  const ctx = canvas.getContext('2d');
  let w = 0;
  let h = 0;
  let row = null;
  let running = false;
  let raf = 0;
  let last = 0;
  const carriers = [0.12, 0.31, 0.47, 0.66, 0.83].map((f) => ({ f, a: 0.25 + Math.random() * 0.2, bw: 0.0025 }));
  const bursts = [];

  function resize() {
    const r = canvas.getBoundingClientRect();
    w = Math.max(64, Math.round(r.width / 2));
    h = Math.max(32, Math.round(r.height / 2));
    canvas.width = w;
    canvas.height = h;
    row = ctx.createImageData(w, 1);
    ctx.fillStyle = 'rgb(5,8,12)';
    ctx.fillRect(0, 0, w, h);
  }

  function line() {
    // a volte parte una "trasmissione" in voce (banda larga che dura qualche secondo)
    if (Math.random() < 0.02 && bursts.length < 3) {
      bursts.push({ f: 0.06 + Math.random() * 0.88, life: 40 + Math.random() * 140, bw: 0.006 + Math.random() * 0.01, a: 0.45 + Math.random() * 0.35, ph: Math.random() * 6 });
    }
    const d = row.data;
    for (let x = 0; x < w; x++) {
      const f = x / w;
      let v = 0.12 + Math.random() * 0.13;
      for (const c of carriers) {
        const k = (f - c.f) / c.bw;
        v += c.a * Math.exp(-k * k);
      }
      for (const b of bursts) {
        const k = (f - b.f) / b.bw;
        if (Math.abs(k) < 3) v += b.a * Math.exp(-k * k * 0.5) * (0.6 + 0.4 * Math.sin(b.ph + x * 0.9)) * (0.7 + Math.random() * 0.3);
      }
      const col = LUT[Math.min(255, Math.max(0, Math.round(v * 255)))];
      const i = x * 4;
      d[i] = col[0];
      d[i + 1] = col[1];
      d[i + 2] = col[2];
      d[i + 3] = 255;
    }
    for (let i = bursts.length - 1; i >= 0; i--) {
      bursts[i].life--;
      bursts[i].ph += 0.4;
      if (bursts[i].life <= 0) bursts.splice(i, 1);
    }
    ctx.drawImage(canvas, 0, 0, w, h - 1, 0, 1, w, h - 1);
    ctx.putImageData(row, 0, 0);
  }

  function frame(now) {
    if (!running) return;
    raf = requestAnimationFrame(frame);
    if (document.hidden) return;
    const every = reducedMotion() ? 140 : 40;
    if (now - last < every) return;
    last = now;
    line();
  }

  const api = {
    start() {
      if (running) return;
      running = true;
      resize();
      for (let i = 0; i < h; i++) line();
      raf = requestAnimationFrame(frame);
    },
    stop() {
      running = false;
      cancelAnimationFrame(raf);
    },
  };
  window.addEventListener('resize', () => running && resize());
  api.start();
  return api;
}
