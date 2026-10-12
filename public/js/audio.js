/*
 * Motore audio della radio
 * - riproduzione della voce in diretta (PCM 16 bit, 16 kHz) con filtro "radio"
 * - cattura del microfono con AudioWorklet (funziona anche col browser in secondo piano)
 * - effetti realistici: fruscio, coda dello squelch, burst Motorola MDC-1200, beep TETRA, toni DTMF
 * - sirena e avvisi che suonano anche con l'audio su muto
 */
import { settings } from './settings.js';

export const SR = 16000;

function softClip(k) {
  const n = 1024;
  const curve = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const x = (i * 2) / (n - 1) - 1;
    curve[i] = ((1 + k) * x) / (1 + k * Math.abs(x));
  }
  return curve;
}
const LINEAR = new Float32Array([-1, 1]);
const DTMF = {
  1: [697, 1209], 2: [697, 1336], 3: [697, 1477],
  4: [770, 1209], 5: [770, 1336], 6: [770, 1477],
  7: [852, 1209], 8: [852, 1336], 9: [852, 1477],
  '*': [941, 1209], 0: [941, 1336], '#': [941, 1477],
};

// Cattura di riserva (browser senza AudioWorklet): stessa logica di mic-worklet.js
class Downsampler {
  constructor(inRate, outRate, emit) {
    this.target = outRate;
    this.ratio = inRate / outRate;
    this.frame = Math.round(outRate * 0.04);
    this.emit = emit;
    this.active = false;
    this.sid = 0;
    this.stopIn = 0;
    this.reset();
  }
  reset() {
    this.out = new Int16Array(this.frame);
    this.n = 0;
    this.acc = 0;
    this.accN = 0;
    this.pos = 0;
    this.sumSq = 0;
  }
  command(msg) {
    if (msg.cmd === 'start') {
      this.reset();
      this.sid = msg.sid;
      this.stopIn = 0;
      this.active = true;
    } else if (msg.cmd === 'stop') {
      if (this.active && msg.sid === this.sid) {
        const tail = Math.round((this.target * (msg.tail || 0)) / 1000);
        if (tail > 0) this.stopIn = tail;
        else {
          this.flush(true);
          this.active = false;
        }
      } else this.emit({ sid: msg.sid, final: true });
    }
  }
  flush(final) {
    if (this.n > 0) {
      const pcm = this.out.slice(0, this.n).buffer;
      this.emit({ sid: this.sid, pcm, level: Math.sqrt(this.sumSq / this.n), final: !!final });
    } else if (final) this.emit({ sid: this.sid, final: true });
    this.n = 0;
    this.sumSq = 0;
  }
  process(ch) {
    if (!this.active) return;
    for (let i = 0; i < ch.length; i++) {
      this.acc += ch[i];
      this.accN++;
      this.pos += 1;
      if (this.pos >= this.ratio) {
        this.pos -= this.ratio;
        let s = this.acc / this.accN;
        this.acc = 0;
        this.accN = 0;
        if (s > 1) s = 1;
        else if (s < -1) s = -1;
        this.sumSq += s * s;
        this.out[this.n++] = s < 0 ? s * 0x8000 : s * 0x7fff;
        if (this.stopIn > 0 && --this.stopIn === 0) {
          this.flush(true);
          this.active = false;
          return;
        }
        if (this.n === this.frame) this.flush(false);
      }
    }
  }
}

export const audio = {
  ctx: null,
  streams: new Map(), // numero trasmissione -> fine dell'audio già in coda
  sources: new Set(),
  stream: null,
  micOk: false,
  micError: '',
  micPromise: null,
  capCmd: null,
  handlers: null,
  capSid: 0,
  replaySrc: null,
  noiseBuf: null,
  sirenNodes: [],
  bed: null,
  onState: null, // la pagina viene avvisata quando il contesto audio si blocca/sblocca
  onMicLost: null,
  onLevel: null, // livello del microfono mentre si parla

  ensureCtx() {
    if (this.ctx) return this.ctx;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) throw new Error('noaudio');
    let c;
    try {
      c = new AC({ latencyHint: 'interactive' });
    } catch (e) {
      c = new AC();
    }
    this.ctx = c;
    // ingresso -> filtri "radio" -> distorsione leggera -> compressore -> volume -> casse
    this.input = c.createGain();
    this.hp = c.createBiquadFilter();
    this.hp.type = 'highpass';
    this.lp = c.createBiquadFilter();
    this.lp.type = 'lowpass';
    this.peak = c.createBiquadFilter(); // la "presenza" tipica degli altoparlanti delle radio
    this.peak.type = 'peaking';
    this.shaper = c.createWaveShaper();
    this.comp = c.createDynamicsCompressor();
    this.vol = c.createGain();
    this.analyser = c.createAnalyser();
    this.analyser.fftSize = 1024;
    this.input.connect(this.hp);
    this.hp.connect(this.lp);
    this.lp.connect(this.peak);
    this.peak.connect(this.shaper);
    this.shaper.connect(this.comp);
    this.comp.connect(this.vol);
    this.comp.connect(this.analyser);
    this.vol.connect(c.destination);
    // uscita separata per sirene e allarmi: suona anche se l'audio è su "muto"
    this.alarmOut = c.createGain();
    this.alarmOut.gain.value = 1;
    this.alarmOut.connect(c.destination);
    this.applyFx();
    this.setVolume();
    c.onstatechange = () => this.onState && this.onState();
    return c;
  },

  resume() {
    if (this.ctx && this.ctx.state !== 'running') return this.ctx.resume().then(() => this.onState && this.onState(), () => {});
    return Promise.resolve();
  },

  /** Da chiamare dentro un tocco/click: sblocca l'audio su iPhone e Android */
  unlock() {
    const c = this.ensureCtx();
    this.resume();
    const b = c.createBuffer(1, 1, c.sampleRate);
    const s = c.createBufferSource();
    s.buffer = b;
    s.connect(c.destination);
    s.start(0);
    if ('speechSynthesis' in window) {
      try {
        speechSynthesis.getVoices();
      } catch (e) {}
    }
  },

  applyFx() {
    if (!this.ctx) return;
    const nyq = this.ctx.sampleRate / 2;
    if (settings.radioFx) {
      this.hp.frequency.value = 360;
      this.lp.frequency.value = 3100;
      this.peak.frequency.value = 1700;
      this.peak.gain.value = 5;
      this.peak.Q.value = 0.9;
      this.shaper.curve = softClip(4.5);
      this.input.gain.value = 0.6;
      this.comp.threshold.value = -26;
      this.comp.ratio.value = 10;
    } else {
      this.hp.frequency.value = 70;
      this.lp.frequency.value = Math.min(9000, nyq - 100);
      this.peak.gain.value = 0;
      this.shaper.curve = LINEAR;
      this.input.gain.value = 1;
      this.comp.threshold.value = -18;
      this.comp.ratio.value = 3;
    }
    if (!this.analog()) this.bedStop();
  },

  setVolume() {
    if (this.vol) this.vol.gain.value = settings.muted ? 0 : settings.volume;
  },

  /** Suono "analogico" (fruscio, squelch, MDC) oppure digitale/classico */
  analog() {
    return settings.radioFx && settings.suono === 'analogico';
  },

  // -------------------------------------------------------------- microfono
  initMic() {
    if (this.micOk) return Promise.resolve(true);
    if (!this.micPromise) this.micPromise = this._initMic().finally(() => (this.micPromise = null));
    return this.micPromise;
  },

  async _initMic() {
    if (!window.isSecureContext || !navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      this.micError = 'insecure';
      return false;
    }
    const c = this.ensureCtx();
    try {
      if (!this.stream) {
        this.stream = await navigator.mediaDevices.getUserMedia({
          audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 },
          video: false,
        });
      }
    } catch (e) {
      const n = e && e.name;
      this.micError = n === 'NotAllowedError' || n === 'SecurityError' ? 'denied' : n === 'NotFoundError' || n === 'OverconstrainedError' ? 'notfound' : 'error';
      return false;
    }
    try {
      const src = c.createMediaStreamSource(this.stream);
      const sink = c.createGain();
      sink.gain.value = 0; // nessun ritorno del microfono nelle casse
      sink.connect(c.destination);
      this.micAn = c.createAnalyser(); // per disegnare la tua voce sul display
      this.micAn.fftSize = 1024;
      src.connect(this.micAn);
      let node = null;
      if (c.audioWorklet && window.AudioWorkletNode) {
        try {
          await c.audioWorklet.addModule('mic-worklet.js?v=3');
          node = new AudioWorkletNode(c, 'mic-capture', {
            numberOfInputs: 1,
            numberOfOutputs: 1,
            outputChannelCount: [1],
            processorOptions: { targetRate: SR },
          });
          node.port.onmessage = (e) => this.onCapture(e.data);
          this.capCmd = (msg) => node.port.postMessage(msg);
        } catch (e) {
          node = null;
        }
      }
      if (!node) {
        const ds = new Downsampler(c.sampleRate, SR, (d) => this.onCapture(d));
        node = c.createScriptProcessor(2048, 1, 1);
        node.onaudioprocess = (e) => ds.process(e.inputBuffer.getChannelData(0));
        this.capCmd = (msg) => ds.command(msg);
      }
      src.connect(node);
      node.connect(sink);
      this.capNode = node;
      this.micSrc = src;
      this.stream.getAudioTracks().forEach((t) =>
        t.addEventListener('ended', () => {
          this.micOk = false;
          this.micError = 'error';
          this.stream = null;
          if (this.onMicLost) this.onMicLost();
        })
      );
      this.micOk = true;
      this.micError = '';
      return true;
    } catch (e) {
      this.micError = 'error';
      return false;
    }
  },

  startCapture(sid, handlers) {
    this.capSid = sid;
    this.handlers = handlers;
    if (this.capCmd) this.capCmd({ cmd: 'start', sid });
  },
  stopCapture(sid, tailMs) {
    if (this.capCmd) this.capCmd({ cmd: 'stop', sid, tail: tailMs || 0 });
  },
  onCapture(d) {
    if (!d || d.sid !== this.capSid || !this.handlers) return;
    if (d.level != null && this.onLevel) this.onLevel(d.level);
    if (d.pcm) this.handlers.pcm(d.pcm);
    if (d.final) this.handlers.final();
  },

  // -------------------------------------------------------------- voce in arrivo
  /** Pacchetto di voce in diretta. stream = numero della trasmissione (voci diverse si sovrappongono) */
  playPcm(i16, stream) {
    const c = this.ctx;
    if (!c) return;
    const n = i16.length;
    if (!n) return;
    const rate = c.sampleRate;
    const outLen = Math.max(1, Math.round((n * rate) / SR));
    const buf = c.createBuffer(1, outLen, rate);
    const out = buf.getChannelData(0);
    const step = SR / rate;
    for (let j = 0; j < outLen; j++) {
      const pos = j * step;
      const i = Math.floor(pos);
      const f = pos - i;
      const a = i16[Math.min(i, n - 1)] / 32768;
      const b = i16[Math.min(i + 1, n - 1)] / 32768;
      out[j] = a + (b - a) * f;
    }
    const now = c.currentTime;
    let at = this.streams.get(stream) || 0;
    if (at < now + 0.02) at = now + 0.15; // piccolo buffer anti-scatti
    else if (at > now + 3) return; // troppo ritardo accumulato: scarta
    const s = c.createBufferSource();
    s.buffer = buf;
    s.connect(this.input);
    s.start(at);
    this.streams.set(stream, at + outLen / rate);
    this.sources.add(s);
    s.onended = () => this.sources.delete(s);
    if (c.state !== 'running') this.resume();
  },

  stopAll() {
    for (const s of this.sources) {
      try {
        s.stop();
      } catch (e) {}
    }
    this.sources.clear();
    this.streams.clear();
    this.bedStop();
  },
  endOf(stream) {
    return this.streams.get(stream) || 0;
  },

  /** Livello del suono che esce adesso dall'altoparlante (0..1) */
  outLevel() {
    if (!this.analyser) return 0;
    const d = this._td || (this._td = new Uint8Array(this.analyser.fftSize));
    this.analyser.getByteTimeDomainData(d);
    let sum = 0;
    for (let i = 0; i < d.length; i += 2) {
      const v = (d[i] - 128) / 128;
      sum += v * v;
    }
    return Math.sqrt(sum / (d.length / 2));
  },

  // -------------------------------------------------------------- suoni sintetizzati
  noiseBuffer() {
    const c = this.ctx;
    if (!this.noiseBuf) {
      const len = c.sampleRate * 2;
      const b = c.createBuffer(1, len, c.sampleRate);
      const d = b.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
      this.noiseBuf = b;
    }
    return this.noiseBuf;
  },

  tone(freq, start, dur, opts) {
    const c = this.ctx;
    if (!c) return null;
    opts = opts || {};
    const o = c.createOscillator();
    const g = c.createGain();
    const v = opts.vol != null ? opts.vol : 0.18;
    o.type = opts.type || 'sine';
    o.frequency.value = freq;
    g.gain.setValueAtTime(0, start);
    g.gain.linearRampToValueAtTime(v, start + 0.006);
    g.gain.setValueAtTime(v, start + Math.max(0.007, dur - 0.012));
    g.gain.linearRampToValueAtTime(0, start + dur);
    o.connect(g);
    g.connect(opts.out || this.vol);
    o.start(start);
    o.stop(start + dur + 0.02);
    return o;
  },

  noise(start, dur, vol, out, filter) {
    const c = this.ctx;
    if (!c) return;
    const s = c.createBufferSource();
    const g = c.createGain();
    s.buffer = this.noiseBuffer();
    g.gain.setValueAtTime(vol, start);
    g.gain.exponentialRampToValueAtTime(0.001, start + dur);
    if (filter) {
      const f = c.createBiquadFilter();
      f.type = filter.type || 'bandpass';
      f.frequency.value = filter.freq || 2000;
      f.Q.value = filter.q || 0.7;
      s.connect(f);
      f.connect(g);
    } else s.connect(g);
    g.connect(out || this.input);
    s.start(start, Math.random() * 1.5);
    s.stop(start + dur + 0.02);
  },

  /** Burst dati Motorola MDC-1200 (FSK 1200/1800 Hz): il classico "brrrp" delle radio della polizia */
  mdc(t, dur) {
    const c = this.ctx;
    if (!c) return;
    dur = dur || 0.17;
    const o = c.createOscillator();
    const g = c.createGain();
    o.type = 'sine';
    const bit = 1 / 1200;
    let tt = t;
    let state = 0;
    // preambolo alternato, poi "dati" casuali ma ripetibili per suonare sempre uguale
    let seed = 0x5a3c;
    for (let i = 0; tt < t + dur; i++) {
      if (i < 24) state = i % 2;
      else {
        seed = (seed * 1103515245 + 12345) & 0x7fffffff;
        state = (seed >> 16) & 1;
      }
      o.frequency.setValueAtTime(state ? 1800 : 1200, tt);
      tt += bit;
    }
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.16, t + 0.004);
    g.gain.setValueAtTime(0.16, t + dur - 0.006);
    g.gain.linearRampToValueAtTime(0, t + dur);
    o.connect(g);
    g.connect(this.input); // passa dal filtro radio, come dal vero
    o.start(t);
    o.stop(t + dur + 0.02);
  },

  /** Fruscio di fondo mentre qualcuno parla (solo suono analogico) */
  bedStart() {
    if (!this.ctx || this.bed || !settings.fruscio || !this.analog()) return;
    const c = this.ctx;
    const s = c.createBufferSource();
    s.buffer = this.noiseBuffer();
    s.loop = true;
    const f = c.createBiquadFilter();
    f.type = 'bandpass';
    f.frequency.value = 2200;
    f.Q.value = 0.5;
    const g = c.createGain();
    g.gain.setValueAtTime(0, c.currentTime);
    g.gain.linearRampToValueAtTime(0.03, c.currentTime + 0.06);
    s.connect(f);
    f.connect(g);
    g.connect(this.input);
    s.start(0, Math.random());
    this.bed = { s, g };
  },
  bedStop(at) {
    const b = this.bed;
    if (!b || !this.ctx) return;
    this.bed = null;
    const t = Math.max(at || 0, this.ctx.currentTime);
    b.g.gain.setValueAtTime(0.03, t);
    b.g.gain.linearRampToValueAtTime(0, t + 0.04);
    try {
      b.s.stop(t + 0.08);
    } catch (e) {}
  },

  sfx(name, at) {
    if (!this.ctx) return;
    const ui = name === 'tick' || name === 'key' || name === 'power' || name === 'scan';
    if (!settings.beeps && !ui) return;
    const t = Math.max(at || 0, this.ctx.currentTime + 0.01);
    const analog = this.analog();
    const digital = settings.suono === 'digitale';
    switch (name) {
      case 'permit': // permesso di parlare (lo senti solo tu)
        if (digital) {
          this.tone(1480, t, 0.035, { vol: 0.12 });
          this.tone(1480, t + 0.07, 0.035, { vol: 0.12 });
        } else if (analog) {
          this.tone(1050, t, 0.09, { vol: 0.12 });
        } else {
          this.tone(880, t, 0.07);
          this.tone(1320, t + 0.08, 0.09);
        }
        break;
      case 'busy':
        for (let i = 0; i < 3; i++) this.tone(440, t + i * 0.18, 0.12, { type: 'square', vol: 0.07 });
        break;
      case 'rxStart': // si apre lo squelch
        if (analog) this.noise(t, 0.09, 0.32);
        else if (digital) this.tone(1200, t, 0.025, { vol: 0.06 });
        else if (settings.radioFx) this.noise(t, 0.12, 0.35);
        else this.tone(1500, t, 0.04, { vol: 0.08 });
        break;
      case 'roger': // fine della trasmissione ricevuta
        if (analog) {
          this.mdc(t, 0.16);
          this.noise(t + 0.17, 0.22, 0.42); // coda dello squelch
        } else if (digital) {
          this.tone(900, t, 0.04, { vol: 0.08 });
        } else {
          this.tone(1250, t, 0.09, { vol: 0.13 });
          if (settings.radioFx) this.noise(t + 0.1, 0.2, 0.4);
        }
        break;
      case 'end': // la tua trasmissione è finita
        this.tone(660, t, 0.06, { vol: 0.1 });
        break;
      case 'text':
        this.tone(1046, t, 0.05, { vol: 0.07 });
        this.tone(1568, t + 0.06, 0.07, { vol: 0.07 });
        break;
      case 'error':
        this.tone(300, t, 0.2, { type: 'square', vol: 0.07 });
        break;
      case 'call': // chiamata alla Centrale: doppio squillo
        for (let i = 0; i < 2; i++) {
          this.tone(1320, t + i * 0.22, 0.08, { vol: 0.12 });
          this.tone(1660, t + i * 0.22 + 0.09, 0.08, { vol: 0.12 });
        }
        break;
      case 'prio': // parla la Centrale: tre note in salita
        this.tone(988, t, 0.07, { vol: 0.12 });
        this.tone(1319, t + 0.08, 0.07, { vol: 0.12 });
        this.tone(1760, t + 0.16, 0.1, { vol: 0.12 });
        break;
      case 'priv': // chiamata privata in arrivo
        for (let i = 0; i < 2; i++) {
          this.tone(1175, t + i * 0.32, 0.11, { vol: 0.12 });
          this.tone(880, t + i * 0.32 + 0.13, 0.13, { vol: 0.12 });
        }
        break;
      case 'tick': // scatto della manopola
        this.noise(t, 0.012, 0.5, this.vol, { type: 'highpass', freq: 3500, q: 0.7 });
        this.tone(2400, t, 0.008, { vol: 0.05 });
        break;
      case 'key': // tasto del tastierino (senza tono DTMF)
        this.tone(1650, t, 0.03, { vol: 0.06 });
        break;
      case 'scan':
        this.tone(1320, t, 0.05, { vol: 0.09 });
        this.tone(1760, t + 0.07, 0.06, { vol: 0.09 });
        break;
      case 'power': // accensione
        this.noise(t, 0.25, 0.18, this.vol, { type: 'bandpass', freq: 2500, q: 0.5 });
        [660, 880, 1320].forEach((f, i) => this.tone(f, t + 0.12 + i * 0.09, 0.08, { vol: 0.11 }));
        break;
      case 'registered':
        this.tone(1568, t, 0.05, { vol: 0.09 });
        this.tone(2093, t + 0.07, 0.08, { vol: 0.09 });
        break;
    }
  },

  /** Tono DTMF vero del tastierino */
  dtmf(k) {
    const c = this.ctx;
    const f = DTMF[k];
    if (!c || !f) return;
    const t = c.currentTime + 0.005;
    this.tone(f[0], t, 0.09, { vol: 0.07 });
    this.tone(f[1], t, 0.09, { vol: 0.07 });
  },

  // Avvisi dei comunicati (suonano anche con l'audio su "muto"). Ritornano la durata in secondi.
  alertTone() {
    const c = this.ctx;
    if (!c) return 0;
    this.stopSiren();
    const t = c.currentTime + 0.05;
    for (let i = 0; i < 4; i++) {
      this.sirenNodes.push(this.tone(1047, t + i * 0.5, 0.18, { type: 'square', vol: 0.09, out: this.alarmOut }));
      this.sirenNodes.push(this.tone(1397, t + i * 0.5 + 0.2, 0.18, { type: 'square', vol: 0.09, out: this.alarmOut }));
    }
    return 2.1;
  },
  chime() {
    const c = this.ctx;
    if (!c) return 0;
    this.stopSiren();
    const t = c.currentTime + 0.05;
    [523, 659, 784, 1047].forEach((f, i) => this.sirenNodes.push(this.tone(f, t + i * 0.13, 0.22, { vol: 0.13, out: this.alarmOut })));
    return 0.75;
  },

  /** Sirena bitonale italiana (anche con l'audio su muto). Ritorna la durata in secondi */
  siren(seconds) {
    const c = this.ctx;
    if (!c) return 0;
    this.stopSiren();
    const t0 = c.currentTime + 0.05;
    const step = 0.45;
    const n = Math.max(2, Math.round(seconds / step));
    const end = t0 + n * step;
    const o = c.createOscillator();
    const lp = c.createBiquadFilter();
    const g = c.createGain();
    o.type = 'square';
    for (let i = 0; i < n; i++) o.frequency.setValueAtTime(i % 2 ? 660 : 880, t0 + i * step);
    lp.type = 'lowpass';
    lp.frequency.value = 2600;
    g.gain.setValueAtTime(0, t0);
    g.gain.linearRampToValueAtTime(0.17, t0 + 0.03);
    g.gain.setValueAtTime(0.17, end - 0.05);
    g.gain.linearRampToValueAtTime(0, end);
    o.connect(lp);
    lp.connect(g);
    g.connect(this.alarmOut);
    o.start(t0);
    o.stop(end + 0.05);
    this.sirenNodes = [o];
    return n * step;
  },
  stopSiren() {
    for (const o of this.sirenNodes) {
      try {
        if (o) o.stop();
      } catch (e) {}
    }
    this.sirenNodes = [];
  },

  // -------------------------------------------------------------- riascolto dei vocali
  /** onStart(durata, inizio) viene chiamata quando parte, per disegnare l'avanzamento */
  async replay(url, onStart) {
    this.stopReplay();
    const c = this.ensureCtx();
    await this.resume();
    const res = await fetch(url, { cache: 'no-store' });
    if (!res.ok) throw new Error(res.status === 404 ? 'gone' : 'http');
    const ab = await res.arrayBuffer();
    const buf = await new Promise((ok, ko) => {
      const p = c.decodeAudioData(ab, ok, ko);
      if (p && p.catch) p.catch(ko);
    });
    const s = c.createBufferSource();
    s.buffer = buf;
    s.connect(this.input);
    this.replaySrc = s;
    return new Promise((resolve) => {
      s.onended = () => {
        if (this.replaySrc === s) this.replaySrc = null;
        resolve();
      };
      const at = c.currentTime + 0.02;
      s.start(at);
      if (onStart) onStart(buf.duration, at);
    });
  },
  stopReplay() {
    if (this.replaySrc) {
      const s = this.replaySrc;
      this.replaySrc = null;
      try {
        s.stop();
      } catch (e) {}
    }
  },
};

// ------------------------------------------------------------------ voce sintetica (SOS, comunicati, richieste)
let itVoice = null;
function pickVoice() {
  if (!('speechSynthesis' in window)) return;
  const vs = speechSynthesis.getVoices();
  itVoice = vs.find((v) => /^it[-_]IT/i.test(v.lang) && /google|natural|online/i.test(v.name)) || vs.find((v) => /^it/i.test(v.lang)) || null;
}
if ('speechSynthesis' in window) {
  pickVoice();
  if (speechSynthesis.addEventListener) speechSynthesis.addEventListener('voiceschanged', pickVoice);
}
export function speak(text) {
  if (!('speechSynthesis' in window)) return false;
  try {
    speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.lang = 'it-IT';
    if (itVoice) u.voice = itVoice;
    u.rate = 0.95;
    u.volume = 1;
    speechSynthesis.speak(u);
    return true;
  } catch (e) {
    return false;
  }
}
export function stopSpeaking() {
  if ('speechSynthesis' in window) {
    try {
      speechSynthesis.cancel();
    } catch (e) {}
  }
}
