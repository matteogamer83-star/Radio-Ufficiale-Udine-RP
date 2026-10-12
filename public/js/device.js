/*
 * La radio disegnata: display LCD (segmenti che scorrono come sulle radio vere),
 * manopola dei canali che gira davvero, LED, tasto emergenza da tenere premuto,
 * PTT laterale, tasti volume, tastierino con toni DTMF e oscilloscopio della voce.
 */
import { $, $$, el, segText, dotText, clamp, sleep, reducedMotion } from './util.js';
import { settings } from './settings.js';
import { audio } from './audio.js';

const STEP_PX = 26; // trascinamento per uno scatto della manopola
const KNOB_R = 30; // raggio "virtuale" della manopola (per la tacca bianca)
const GLOW = { rx: '110 230 80', tx: '255 80 50', prio: '60 190 255', call: '50 220 180', priv: '170 130 255', sos: '255 80 50' };

export const device = {
  hooks: {},
  W: 10,
  mode: 'off',
  wantMode: 'off',
  booting: false,
  mainText: null,
  mainSeq: '',
  mainPos: 0,
  mainTimer: 0,
  popTimer: 0,
  ink: '40 22 2',
  knobOffset: 0,
  knobAcc: 0,
  natural: null,

  init(hooks) {
    this.hooks = hooks || {};
    this.dev = $('#device');
    this.lcd = $('#lcd');
    this.scope = $('#lcdScope');
    this.sctx = this.scope.getContext('2d');
    this.applySkin();
    this.bindKnob();
    this.bindHold($('#dvEmerg'), () => this.hooks.emergency && this.hooks.emergency(), () => this.hooks.emergencyShort && this.hooks.emergencyShort());
    this.bindPtt($('#dvPtt'));
    this.bindVol($('#dvVolUp'), +1);
    this.bindVol($('#dvVolDown'), -1);
    for (const b of $$('.dv-keys [data-sk]')) b.addEventListener('click', () => this.soft(Number(b.dataset.sk)));
    ['#lcdSk1', '#lcdSk2', '#lcdSk3'].forEach((s, i) => $(s).addEventListener('click', () => this.soft(i + 1)));
    $('#lcdPrev').addEventListener('click', () => this.hooks.step && this.hooks.step(-1, true));
    $('#lcdNext').addEventListener('click', () => this.hooks.step && this.hooks.step(+1, true));
    for (const b of $$('#dvPad [data-key]')) {
      b.addEventListener('pointerdown', (e) => {
        if (e.button !== 0) return;
        e.preventDefault();
        audio.resume();
        if (settings.toniTasti) audio.dtmf(b.dataset.key);
        else audio.sfx('key');
        if (this.hooks.key) this.hooks.key(b.dataset.key);
      });
    }
    this.measure();
    if (document.fonts && document.fonts.load) document.fonts.load('700 22px DSEG14').then(() => this.measure(), () => {});
    this.clock();
    setInterval(() => this.clock(), 1000);
    this.battery();
    this.loop();
  },

  applySkin() {
    this.dev.dataset.skin = settings.skin || 'nero';
    this.lcd.dataset.bl = settings.retro || 'ambra';
    this.readInk();
  },

  soft(n) {
    const b = $(`.dv-keys [data-sk="${n}"]`);
    if (b) {
      b.classList.add('pressed');
      setTimeout(() => b.classList.remove('pressed'), 120);
    }
    audio.resume();
    audio.sfx('key');
    if (this.hooks.soft) this.hooks.soft(n);
  },

  // ---------------------------------------------------------------- display
  /** Quanti caratteri entrano nella riga grande a segmenti */
  measure() {
    const main = $('.lcd-main');
    const probe = el('span', 'lcd-text', '~~~~~~~~~~');
    probe.style.visibility = 'hidden';
    main.append(probe);
    const w = probe.getBoundingClientRect().width / 10;
    probe.remove();
    const box = main.getBoundingClientRect().width;
    if (w > 0 && box > 0) this.W = clamp(Math.floor((box - 2) / w), 6, 16);
    $('#lcdGhost').textContent = '~'.repeat(this.W);
    const t = this.mainText;
    this.mainText = null;
    this.setMain(t || '');
  },

  readInk() {
    const v = getComputedStyle(this.lcd).getPropertyValue('--ink').trim();
    if (v) this.ink = v;
  },

  /** o = { mode, top, main, sub, soft: [a, b, c], flags: [] } */
  setLcd(o) {
    const mode = o.mode || 'idle';
    this.wantMode = mode;
    if (!this.booting && this.lcd.dataset.mode !== mode) {
      this.lcd.dataset.mode = mode;
      requestAnimationFrame(() => this.readInk());
      setTimeout(() => this.readInk(), 300);
    }
    const st = mode === 'off' ? 'off' : ['tx', 'rx', 'prio', 'call', 'priv', 'busy', 'sos'].includes(mode) ? mode : 'idle';
    this.dev.dataset.state = st;
    this.dev.style.setProperty('--glow-c', GLOW[st] || '255 170 40');
    this.setText('#lcdMode', dotText(o.top));
    this.setMain(o.main);
    this.setText('#lcdSub', dotText(o.sub));
    const soft = o.soft || ['', '', ''];
    this.setText('#lcdSk1', dotText(soft[0]));
    this.setText('#lcdSk2', dotText(soft[1]));
    this.setText('#lcdSk3', dotText(soft[2]));
    const flags = (o.flags || []).join('|');
    if (flags !== this._flags) {
      this._flags = flags;
      const box = $('#lcdFlags');
      box.textContent = '';
      for (const f of o.flags || []) box.append(el('b', null, f));
    }
  },
  setText(sel, text) {
    const n = $(sel);
    if (n.textContent !== text) n.textContent = text;
  },

  /** Riga grande: se il testo è lungo scorre un carattere alla volta, come sulle radio vere */
  setMain(text) {
    const t = segText(text).replace(/ /g, '!');
    if (t === this.mainText) return;
    this.mainText = t;
    clearInterval(this.mainTimer);
    this.mainTimer = 0;
    const W = this.W;
    if (t.length <= W) {
      $('#lcdMain').textContent = t + '!'.repeat(W - t.length);
      return;
    }
    this.mainSeq = t + '!!!';
    this.mainPos = 0;
    let wait = 4; // pausa all'inizio
    const show = () => {
      const s = this.mainSeq + this.mainSeq;
      $('#lcdMain').textContent = s.slice(this.mainPos, this.mainPos + W);
    };
    show();
    this.mainTimer = setInterval(() => {
      if (wait > 0) return void wait--;
      this.mainPos = (this.mainPos + 1) % this.mainSeq.length;
      if (this.mainPos === 0) wait = 4;
      show();
    }, 260);
  },

  /** Finestrella sul display (volume, canale scelto col tastierino, messaggi brevi). ms = 0: resta finché non la chiudi */
  pop(content, ms) {
    const p = $('#lcdPop');
    p.textContent = '';
    if (typeof content === 'string') p.append(el('div', null, content));
    else p.append(content);
    p.hidden = false;
    clearTimeout(this.popTimer);
    if (ms !== 0) this.popTimer = setTimeout(() => this.popHide(), ms || 1300);
  },
  popHide() {
    clearTimeout(this.popTimer);
    $('#lcdPop').hidden = true;
  },
  popLines(big, small, small2) {
    const box = el('div');
    if (big) box.append(el('big', null, segText(big).replace(/ /g, '!')));
    if (small) box.append(el('div', null, dotText(small)));
    if (small2) box.append(el('div', null, dotText(small2)));
    return box;
  },

  setSignal(bars) {
    $('#lcdSig').dataset.bars = String(bars);
  },
  setLed(s) {
    const led = $('#dvLed');
    if (led.dataset.led !== s) led.dataset.led = s;
  },

  clock() {
    const d = new Date();
    const hh = String(d.getHours()).padStart(2, '0');
    const mm = String(d.getMinutes()).padStart(2, '0');
    this.setText('#lcdClock', `${hh}${d.getSeconds() % 2 ? ':' : ' '}${mm}`);
  },

  async battery() {
    const bat = $('#lcdBat');
    const set = (lvl, charging) => {
      bat.style.setProperty('--bat', Math.round(clamp(lvl, 0.05, 1) * 100) + '%');
      bat.classList.toggle('low', lvl < 0.15 && !charging);
    };
    set(1, true);
    if (!navigator.getBattery) return;
    try {
      const b = await navigator.getBattery();
      const upd = () => set(b.level, b.charging);
      upd();
      b.addEventListener('levelchange', upd);
      b.addEventListener('chargingchange', upd);
    } catch (e) {}
  },

  // ---------------------------------------------------------------- oscilloscopio e luce dell'altoparlante
  loop() {
    let last = 0;
    const td = new Uint8Array(1024);
    const draw = (now) => {
      requestAnimationFrame(draw);
      if (document.hidden) return;
      const st = this.dev.dataset.state;
      const live = st === 'tx' || st === 'rx' || st === 'prio' || st === 'call' || st === 'priv';
      if (!live && now - last < 140) return; // a riposo basta poco
      last = now;
      const c = this.sctx;
      const w = this.scope.width;
      const h = this.scope.height;
      const mid = h / 2;
      c.clearRect(0, 0, w, h);
      c.strokeStyle = `rgb(${this.ink} / 0.12)`;
      c.lineWidth = 1;
      c.beginPath();
      for (let x = 0; x <= w; x += 44) {
        c.moveTo(x + 0.5, 4);
        c.lineTo(x + 0.5, h - 4);
      }
      c.moveTo(0, mid + 0.5);
      c.lineTo(w, mid + 0.5);
      c.stroke();
      let an = null;
      let gain = 1;
      if (st === 'tx' && audio.micAn) {
        an = audio.micAn;
        gain = 2.6;
      } else if (live && audio.analyser) {
        an = audio.analyser;
        gain = 1.8;
      }
      c.strokeStyle = `rgb(${this.ink} / 0.92)`;
      c.lineWidth = 3;
      c.lineJoin = 'round';
      c.beginPath();
      const pts = 110;
      let lvl = 0;
      if (an) {
        an.getByteTimeDomainData(td);
        let sum = 0;
        for (let i = 0; i < td.length; i += 4) {
          const v = (td[i] - 128) / 128;
          sum += v * v;
        }
        lvl = Math.sqrt(sum / (td.length / 4));
        for (let i = 0; i < pts; i++) {
          const v = (td[Math.floor((i / pts) * td.length)] - 128) / 128;
          const y = mid - clamp(v * gain, -1, 1) * (mid - 4);
          if (i === 0) c.moveTo(0, y);
          else c.lineTo((i / (pts - 1)) * w, y);
        }
      } else {
        for (let i = 0; i < pts; i++) {
          const y = mid + (Math.random() - 0.5) * (st === 'off' ? 0 : 2.2);
          if (i === 0) c.moveTo(0, y);
          else c.lineTo((i / (pts - 1)) * w, y);
        }
      }
      c.stroke();
      // l'altoparlante "si accende" con la voce che esce (non con la tua)
      const glow = st !== 'tx' && live ? clamp(lvl * 5, 0, 1) : 0;
      if (Math.abs(glow - (this._glow || 0)) > 0.02) {
        this._glow = glow;
        $('#dvGlow').style.setProperty('--lvl', glow.toFixed(2));
      }
    };
    requestAnimationFrame(draw);
  },

  // ---------------------------------------------------------------- manopola dei canali
  bindKnob() {
    const k = $('#dvKnob');
    let id = null;
    let lx = 0;
    let ly = 0;
    k.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      e.preventDefault();
      audio.resume();
      id = e.pointerId;
      lx = e.clientX;
      ly = e.clientY;
      try {
        k.setPointerCapture(id);
      } catch (err) {}
    });
    k.addEventListener('pointermove', (e) => {
      if (e.pointerId !== id) return;
      const d = e.clientX - lx - (e.clientY - ly) * 0.8;
      lx = e.clientX;
      ly = e.clientY;
      this.turn(d);
    });
    const end = (e) => {
      if (e.pointerId !== id) return;
      id = null;
      this.knobAcc = 0;
      if (this.hooks.commit) this.hooks.commit(false);
    };
    k.addEventListener('pointerup', end);
    k.addEventListener('pointercancel', end);
    let lastWheel = 0;
    k.addEventListener(
      'wheel',
      (e) => {
        e.preventDefault();
        const now = performance.now();
        if (now - lastWheel < 70) return;
        lastWheel = now;
        this.click(e.deltaY < 0 ? +1 : -1, true);
        if (this.hooks.commit) this.hooks.commit(false);
      },
      { passive: false }
    );
    k.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowRight' || e.key === 'ArrowUp') this.click(+1, true);
      else if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') this.click(-1, true);
      else if (e.key === 'Enter' || e.key === ' ') {
        if (this.hooks.commit) this.hooks.commit(true);
      } else return;
      e.preventDefault();
      e.stopPropagation();
    });
    this.drawKnob();
  },
  /** Trascinamento: le zigrinature scorrono e ogni STEP_PX scatta un canale */
  turn(d) {
    this.knobOffset += d;
    this.knobAcc += d;
    while (this.knobAcc >= STEP_PX) {
      this.knobAcc -= STEP_PX;
      this.click(+1, false);
    }
    while (this.knobAcc <= -STEP_PX) {
      this.knobAcc += STEP_PX;
      this.click(-1, false);
    }
    this.drawKnob();
  },
  /** Uno scatto (rumore meccanico + canale successivo/precedente) */
  click(dir, animate) {
    if (animate) {
      this.knobOffset += dir * STEP_PX;
      this.drawKnob();
    }
    audio.sfx('tick');
    if (this.hooks.step) this.hooks.step(dir, false);
  },
  drawKnob() {
    const rot = $('#dvKnobRot');
    rot.style.setProperty('--rib', this.knobOffset.toFixed(1) + 'px');
    const th = this.knobOffset / KNOB_R;
    const s = Math.sin(th);
    const co = Math.cos(th);
    rot.style.setProperty('--mark', (50 + s * 44).toFixed(1) + '%');
    rot.style.setProperty('--mark-o', co > 0 ? Math.pow(co, 0.6).toFixed(2) : '0');
  },
  setKnobRange(n, i) {
    const k = $('#dvKnob');
    k.setAttribute('aria-valuemax', String(Math.max(1, n)));
    k.setAttribute('aria-valuenow', String(i + 1));
  },

  // ---------------------------------------------------------------- tasti da tenere premuti
  bindHold(btn, onDone, onShort, ms) {
    let timer = 0;
    let done = false;
    const start = (e) => {
      if (e.button !== 0) return;
      e.preventDefault();
      audio.resume();
      done = false;
      btn.classList.add('holding');
      timer = setTimeout(() => {
        done = true;
        btn.classList.remove('holding');
        onDone();
      }, ms || 1000);
    };
    const stop = () => {
      if (!btn.classList.contains('holding')) return;
      clearTimeout(timer);
      btn.classList.remove('holding');
      if (!done && onShort) onShort();
    };
    btn.addEventListener('pointerdown', start);
    btn.addEventListener('pointerup', stop);
    btn.addEventListener('pointerleave', stop);
    btn.addEventListener('pointercancel', stop);
    btn.addEventListener('contextmenu', (e) => e.preventDefault());
    btn.addEventListener('keydown', (e) => {
      if ((e.key === 'Enter' || e.key === ' ') && !e.repeat) {
        e.preventDefault();
        onDone();
      }
    });
  },
  bindPtt(btn) {
    btn.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      e.preventDefault();
      try {
        btn.setPointerCapture(e.pointerId);
      } catch (err) {}
      if (this.hooks.ptt) this.hooks.ptt(true);
    });
    const up = () => this.hooks.ptt && this.hooks.ptt(false);
    btn.addEventListener('pointerup', up);
    btn.addEventListener('pointercancel', up);
    btn.addEventListener('lostpointercapture', up);
    btn.addEventListener('contextmenu', (e) => e.preventDefault());
  },
  bindVol(btn, dir) {
    let rep = 0;
    const go = () => this.hooks.vol && this.hooks.vol(dir);
    btn.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      e.preventDefault();
      audio.resume();
      go();
      clearInterval(rep);
      rep = setInterval(go, 180);
    });
    const stop = () => clearInterval(rep);
    btn.addEventListener('pointerup', stop);
    btn.addEventListener('pointerleave', stop);
    btn.addEventListener('pointercancel', stop);
  },

  // ---------------------------------------------------------------- accensione
  async boot(nome) {
    if (this.booting) return;
    this.booting = true;
    this.dev.classList.add('booting');
    this.lcd.dataset.mode = 'boot';
    this.readInk();
    this.setLed('amber');
    const fast = reducedMotion();
    audio.sfx('power');
    this.pop(this.popLines('URP-T1', 'RADIO UFFICIALE', 'UDINE RP ITA'), 0);
    await sleep(fast ? 150 : 700);
    const bar = el('div', 'bar');
    for (let i = 0; i < 10; i++) bar.append(el('i'));
    const box = el('div');
    box.append(el('div', null, 'AUTOTEST'), bar);
    this.pop(box, 0);
    for (let i = 0; i < 10; i++) {
      bar.children[i].classList.add('on');
      await sleep(fast ? 10 : 45);
    }
    this.pop(this.popLines('', 'RETE TETRA UDINE', 'REGISTRAZIONE...'), 0);
    await sleep(fast ? 120 : 520);
    this.pop(this.popLines('OK', 'REGISTRATO', dotText(nome || '').slice(0, 22)), 0);
    audio.sfx('registered');
    await sleep(fast ? 120 : 520);
    this.popHide();
    this.dev.classList.remove('booting');
    this.booting = false;
    this.lcd.dataset.mode = this.wantMode;
    this.readInk();
    setTimeout(() => this.readInk(), 300);
    if (this.hooks.afterBoot) this.hooks.afterBoot();
  },

  // ---------------------------------------------------------------- dimensione: la radio si adatta allo spazio
  fit(availW, availH, compact) {
    const wrap = $('#deviceWrap');
    wrap.classList.toggle('compact', !!compact);
    if (compact) {
      this.dev.style.setProperty('--dv-zoom', '1');
      const z = clamp((availW - 24 - 16 - 14) / 236, 0.9, 1.3);
      this.lcd.style.setProperty('--lcd-zoom', z.toFixed(3));
      this.measure();
      return;
    }
    this.lcd.style.removeProperty('--lcd-zoom');
    if (!this.natural) {
      this.dev.style.setProperty('--dv-zoom', '1');
      const r = this.dev.getBoundingClientRect();
      this.natural = { w: r.width + 24, h: r.height + 10 };
    }
    const z = clamp(Math.min(availW / this.natural.w, availH / this.natural.h), 0.5, 1.12);
    this.dev.style.setProperty('--dv-zoom', z.toFixed(3));
  },
};
