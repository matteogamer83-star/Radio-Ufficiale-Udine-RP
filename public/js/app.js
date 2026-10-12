/*
 * Radio Ufficiale di Udine RP ITA — il cuore dell'app
 * Microfono -> AudioWorklet (PCM 16 bit, 16 kHz) -> WebSocket -> server -> radio degli altri
 * Qui: connessione, canali, trasmissione (PTT), ricezione, Centrale, scansione,
 * chiamate private, SOS e comunicati. Il disegno è in ui.js e device.js.
 */
import { $, $$, el, store, sleep, displayName, isTyping, STATI, statoInfo } from './util.js';
import { settings, saveSettings, vibrate, finePointer } from './settings.js';
import { audio, speak, stopSpeaking } from './audio.js';
import { modal, toast, popover } from './ui-kit.js';
import { device } from './device.js';
import { ui, dialogs } from './ui.js';

export const APP_VERSION = '3.0.0'; // uguale a package.json: se il server è più nuovo la pagina si ricarica da sola
const PROTO = 3; // audio con il numero della trasmissione (per sentire più canali insieme)

export const state = {
  info: null,
  token: store.get('token', null),
  pendingAuth: null,
  ws: null,
  online: false,
  loggedIn: false,
  loggedOut: true,
  myId: null,
  key: null,
  me: null,
  perms: {},
  roles: new Map(),
  serverName: '',
  maxTalk: 60,
  channels: [],
  channel: null,
  users: new Map(),
  roster: [],
  chPwd: store.get('chpwd', {}),
  pendingJoin: null,
  pcKeys: 0,
  tx: 'idle', // idle | pending | on | stopping
  txMode: null, // null = canale | 'call' = chiamata alla Centrale | 'disp' = come Centrale | 'priv' = privata
  txInfo: {},
  centrale: null,
  pttHeld: false,
  pttSource: null,
  preBuffer: [],
  txStart: 0,
  pendingTimer: null,
  stopTimer: null,
  reconnectDelay: 1000,
  reconnectTimer: null,
  pingTimer: null,
  rtt: null,
  busyUntil: 0,
  busyBy: null,
  busyKind: '',
  view: 'radio', // radio | console (Centrale)
  mobileTab: 'registro',
  lastNews: null,
  privLog: [],
  micLevel: 0,
};

export function roleInfo(id) {
  return state.roles.get(id) || { id, nome: '—', icona: '👤', colore: '#9ca3af' };
}
export const isMine = (u) => !!u && !!state.me && u.uid === state.me.uid;

// ================================================================== rete
const pending = new Map();
let reqSeq = 0;

export const net = {
  connect() {
    clearTimeout(state.reconnectTimer);
    if (state.ws) return;
    const ws = new WebSocket((location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host + '/ws');
    ws.binaryType = 'arraybuffer';
    state.ws = ws;
    ui.status('connecting');
    ws.onopen = () => {
      const msg = state.pendingAuth || { t: 'auth', token: state.token };
      ws.send(JSON.stringify(Object.assign({}, msg, { tastoPc: !!settings.tastoPc, proto: PROTO })));
    };
    ws.onmessage = (e) => {
      if (typeof e.data !== 'string') {
        // 2 byte con il numero della trasmissione + audio PCM 16 bit
        const ab = e.data;
        if (ab.byteLength < 4 || ab.byteLength % 2) return;
        const n = new DataView(ab).getUint16(0, true);
        rx.touch(n);
        if (rx.muted(n)) return; // scansione: il canale principale ha la precedenza
        audio.playPcm(new Int16Array(ab, 2), n);
        return;
      }
      let m;
      try {
        m = JSON.parse(e.data);
      } catch (err) {
        return;
      }
      try {
        onMessage(m);
      } catch (err) {
        console.error('Errore messaggio', m && m.t, err);
      }
    };
    ws.onclose = () => {
      if (state.ws !== ws) return;
      state.ws = null;
      const wasOnline = state.online;
      state.online = false;
      state.rtt = null;
      clearInterval(state.pingTimer);
      for (const [, p] of pending) {
        clearTimeout(p.timer);
        p.reject(new Error('Connessione persa'));
      }
      pending.clear();
      ptt.abort();
      rx.reset();
      ui.status('off');
      ui.refresh();
      if (state.loggedOut) return;
      if (!state.loggedIn) {
        state.loggedOut = true;
        loginFail('Server non raggiungibile. Controlla la connessione e riprova.');
        return;
      }
      if (wasOnline) toast('Segnale perso: mi ricollego…', { kind: 'bad', icon: 'signal' });
      state.reconnectTimer = setTimeout(() => net.connect(), state.reconnectDelay);
      state.reconnectDelay = Math.min(state.reconnectDelay * 1.6, 8000);
    };
    ws.onerror = () => {};
  },
  send(obj) {
    const ws = state.ws;
    if (ws && ws.readyState === 1) ws.send(JSON.stringify(obj));
  },
  sendBinary(buf) {
    const ws = state.ws;
    if (ws && ws.readyState === 1 && ws.bufferedAmount < 256 * 1024) ws.send(buf);
  },
  request(op, data) {
    return new Promise((resolve, reject) => {
      if (!state.online) return reject(new Error('Non sei collegato alla radio.'));
      const rid = ++reqSeq;
      const timer = setTimeout(() => {
        pending.delete(rid);
        reject(new Error('Il server non risponde, riprova.'));
      }, 20000);
      pending.set(rid, { resolve, reject, timer });
      net.send(Object.assign({}, data || {}, { t: 'req', rid, op }));
    });
  },
  ping() {
    net.send({ t: 'ping', ts: Math.round(performance.now()) });
  },
  close() {
    state.loggedOut = true;
    clearTimeout(state.reconnectTimer);
    clearInterval(state.pingTimer);
    const ws = state.ws;
    state.ws = null;
    state.online = false;
    if (ws) {
      try {
        ws.close();
      } catch (e) {}
    }
  },
  reconnectNow() {
    if (state.ws || !state.loggedIn || state.loggedOut) return;
    state.reconnectDelay = 1000;
    net.connect();
  },
};

function applySession(m) {
  if (!state.me || !m.me || state.me.uid !== m.me.uid) {
    disp.load(m.me && m.me.uid);
    scan.load(m.me && m.me.uid);
  }
  state.me = m.me;
  state.perms = m.perms || {};
  state.roles = new Map((m.roles || []).map((r) => [r.id, r]));
  state.channels = m.channels || [];
  state.maxTalk = m.maxTalk || 60;
  state.serverName = m.server || state.serverName;
  state.pcKeys = m.pcKeys || 0;
  state.centrale = m.centrale || null;
  if (m.roster) state.roster = m.roster;
  if (m.channel) state.channel = m.channel;
  if (!disp.allowed() && state.view === 'console') state.view = 'radio';
  syncMonitor();
  ui.refresh(true);
  if (RadioApp.onSession) RadioApp.onSession();
}

// Il server è stato aggiornato: ricarica la pagina (una volta sola) per avere la radio nuova
function checkVersion(v) {
  if (!v || v === APP_VERSION) return false;
  let done = '';
  try {
    done = sessionStorage.getItem('urp3:reload') || '';
    sessionStorage.setItem('urp3:reload', v);
  } catch (e) {}
  if (done === v) return false;
  toast('Radio aggiornata: ricarico…', { icon: 'refresh' });
  setTimeout(() => location.reload(), 600);
  return true;
}

function onMessage(m) {
  switch (m.t) {
    case 'welcome': {
      if (checkVersion(m.versione)) return;
      state.myId = m.id;
      state.key = m.key;
      if (m.token) {
        state.token = m.token;
        store.set('token', m.token);
      }
      state.pendingAuth = null;
      const first = !state.loggedIn;
      applySession(m);
      store.set('lastName', displayName(m.me));
      state.online = true;
      state.reconnectDelay = 1000;
      lastMon = '';
      syncMonitor();
      clearInterval(state.pingTimer);
      net.ping();
      state.pingTimer = setInterval(() => net.ping(), 5000);
      if (first) {
        state.loggedIn = true;
        ui.showApp();
        if (!audio.micOk && audio.micError !== 'insecure') setTimeout(() => state.loggedIn && dialogs.micHelp(), 2600);
      }
      ui.status('on');
      const last = (state.channel && state.channel.id) || store.get('lastChannel', null);
      if (last && state.channels.some((c) => c.id === last)) join(last, true);
      else joinFallback();
      break;
    }
    case 'auth_fail':
      onAuthFail(m);
      break;
    case 'kicked':
      logoutNow(m.msg || 'Sei stato disconnesso.');
      break;
    case 'session':
      applySession(m);
      break;
    case 'error':
      handleError(m);
      break;
    case 'channels':
      state.channels = m.channels || [];
      if ('centrale' in m) state.centrale = m.centrale || null;
      if (m.roster) state.roster = m.roster;
      if (state.channel) {
        const c = state.channels.find((x) => x.id === state.channel.id);
        if (c) state.channel = c;
      }
      syncMonitor();
      ui.refresh();
      break;
    case 'channel_gone':
      toast(m.msg || 'Il canale non è più disponibile', { kind: 'bad' });
      rx.reset();
      state.channel = null;
      state.users.clear();
      ui.feedReset([]);
      joinFallback();
      ui.refresh();
      break;
    case 'joined': {
      rx.reset();
      audio.stopReplay();
      const pj = state.pendingJoin;
      if (pj && pj.id === m.channel.id && pj.password) {
        state.chPwd[m.channel.id] = pj.password;
        store.set('chpwd', state.chPwd);
      }
      const changed = !state.channel || state.channel.id !== m.channel.id;
      state.pendingJoin = null;
      state.channel = m.channel;
      state.users = new Map((m.users || []).map((u) => [u.id, u]));
      store.set('lastChannel', m.channel.id);
      ui.feedReset(m.feed || []);
      syncMonitor();
      ui.refresh();
      if (changed && !device.booting && state.loggedIn) {
        device.pop(device.popLines(`CH ${chNum(m.channel)}`, m.channel.nome, `TG ${m.channel.tg || ''}`), 1100);
      }
      if (m.talker) rx.start(m.talker, true);
      break;
    }
    case 'users':
      state.users = new Map((m.users || []).map((u) => [u.id, u]));
      ui.refresh();
      break;
    case 'user_join':
      state.users.set(m.user.id, m.user);
      ui.refresh();
      ui.system(`${displayName(m.user)} è entrato nel canale`);
      break;
    case 'user_leave':
      if (state.users.delete(m.user.id)) {
        ui.refresh();
        ui.system(`${displayName(m.user)} ha lasciato il canale`);
      }
      break;
    case 'stato':
      if (state.me) state.me.stato = m.stato;
      ui.refresh();
      break;
    case 'talk_start':
      rx.start(m);
      break;
    case 'talk_end':
      rx.end(m);
      break;
    case 'text':
      onText(m);
      break;
    case 'alert':
      onAlert(m.msg);
      break;
    case 'sos_ack':
      onSosAck(m);
      break;
    case 'annuncio':
      onAnnuncio(m);
      break;
    case 'annuncio_ack':
      onAnnuncioAck(m);
      break;
    case 'richiesta':
      onRichiesta(m);
      break;
    case 'richiesta_ack':
      onRichiestaAck(m);
      break;
    case 'ptt_ok':
      ptt.onOk(m);
      break;
    case 'ptt_busy':
      ptt.onBusy(m.by, m.prio ? 'prio' : m.centrale ? 'centrale' : m.privato ? 'privato' : '');
      break;
    case 'ptt_fail':
      ptt.onFail(m.msg);
      break;
    case 'ptt_timeout':
      ptt.onTimeout();
      break;
    case 'ptt_cut':
      ptt.onCut(m.by);
      break;
    case 'remote_ptt':
      onRemotePtt(!!m.down, !!m.centrale);
      break;
    case 'pc_key':
      state.pcKeys = m.n || 0;
      ui.refresh();
      if (m.n > 0 && m.nuovo) toast('Tasto PTT per PC collegato!', { kind: 'ok', icon: 'keyboard' });
      break;
    case 'pong':
      if (typeof m.ts === 'number') {
        state.rtt = Math.max(1, Math.round(performance.now() - m.ts));
        ui.status('on');
      }
      break;
    case 'res': {
      const p = pending.get(m.rid);
      if (!p) return;
      pending.delete(m.rid);
      clearTimeout(p.timer);
      if (m.ok) p.resolve(m.data || {});
      else p.reject(new Error(m.error || 'Errore'));
      break;
    }
    case 'admin_dirty':
      if (RadioApp.onAdminDirty) RadioApp.onAdminDirty();
      break;
  }
}

function onAuthFail(m) {
  if (m.code === 'token' || m.code === 'disattivato') {
    state.token = null;
    store.set('token', null);
  }
  if (state.loggedIn) return logoutNow(m.msg);
  net.close();
  if (m.code === 'token') showView('login');
  if (m.code === 'setup_done') return boot(true);
  loginFail(m.msg || 'Accesso non riuscito');
}

function handleError(m) {
  switch (m.code) {
    case 'channel_password': {
      const pj = state.pendingJoin;
      state.pendingJoin = null;
      const ch = state.channels.find((c) => c.id === m.channel);
      if (ch) {
        delete state.chPwd[ch.id];
        store.set('chpwd', state.chPwd);
      }
      if (!state.channel) joinFallback();
      if (ch && pj && !pj.auto) dialogs.channelPassword(ch, !!pj.password);
      ui.refresh();
      break;
    }
    case 'no_channel':
      state.pendingJoin = null;
      if (!state.channel) joinFallback();
      else toast(m.msg, { kind: 'bad' });
      break;
    default:
      toast(m.msg || 'Errore', { kind: 'bad', ms: 5000 });
  }
}

// ================================================================== canali
export function chNum(ch) {
  const i = state.channels.findIndex((c) => c.id === (ch && ch.id));
  return String(i + 1).padStart(2, '0');
}

export function join(id, auto) {
  const ch = state.channels.find((c) => c.id === id);
  if (!ch) return;
  ui.closeDrawer();
  if (!auto && state.channel && state.channel.id === id) return;
  const pwd = state.chPwd[id] || '';
  if (ch.protetto && !pwd) {
    if (auto) joinFallback();
    else dialogs.channelPassword(ch, false);
    return;
  }
  sendJoin(id, pwd, auto);
}
export function sendJoin(id, password, auto) {
  ptt.abort();
  audio.stopReplay();
  state.pendingJoin = { id, password, auto: !!auto };
  net.send({ t: 'join', channel: id, password });
}
function joinFallback() {
  const c = state.channels.find((x) => !x.protetto && !x.eco) || state.channels.find((x) => !x.protetto);
  if (c) sendJoin(c.id, '', true);
}

/** Manopola, frecce e tastierino: scegli il canale sul display, poi la radio ci entra */
export const tune = {
  idx: null,
  timer: 0,
  digits: '',
  digitTimer: 0,
  cur() {
    const i = state.channels.findIndex((c) => state.channel && c.id === state.channel.id);
    return i < 0 ? 0 : i;
  },
  step(dir, quick) {
    const n = state.channels.length;
    if (!n || !state.online) return;
    const base = this.idx == null ? this.cur() : this.idx;
    this.idx = (base + dir + n) % n;
    const ch = state.channels[this.idx];
    device.setKnobRange(n, this.idx);
    device.pop(device.popLines(`CH ${String(this.idx + 1).padStart(2, '0')}`, ch.nome, `TG ${ch.tg || ''}${ch.protetto ? ' · PASSWORD' : ''}`), 0);
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.commit(true), quick ? 650 : 1000);
  },
  /** now = entra subito; altrimenti aspetta un attimo (si può ancora girare) */
  commit(now) {
    if (this.idx == null) return;
    if (!now) {
      clearTimeout(this.timer);
      this.timer = setTimeout(() => this.commit(true), 700);
      return;
    }
    clearTimeout(this.timer);
    const ch = state.channels[this.idx];
    this.idx = null;
    device.popHide();
    if (ch && (!state.channel || ch.id !== state.channel.id)) join(ch.id);
  },
  key(k) {
    if (k === '*') return scan.toggle();
    if (k === '#') return dialogs.status();
    if (!state.online) return;
    this.digits = (this.digits + k).slice(-4);
    device.pop(device.popLines(`CH ${this.digits.padEnd(2, '-')}`, 'COMPONI IL CANALE', 'O IL NUMERO TG'), 0);
    clearTimeout(this.digitTimer);
    this.digitTimer = setTimeout(() => {
      const n = Number(this.digits);
      this.digits = '';
      const ch = n >= 1000 ? state.channels.find((c) => c.tg === n) : state.channels[n - 1];
      if (!ch) {
        audio.sfx('error');
        device.pop(device.popLines('ERRORE', 'CANALE NON TROVATO'), 1200);
        return;
      }
      device.popHide();
      if (state.channel && ch.id === state.channel.id) device.pop(device.popLines(`CH ${chNum(ch)}`, 'SEI GIA QUI'), 900);
      else join(ch.id);
    }, 1200);
  },
};

// ================================================================== ricezione (in diretta)
// Ogni trasmissione ha un numero (n). La Centrale (o chi scansiona) può sentirne più di una insieme.
export const rx = {
  talks: new Map(),
  timers: new Map(),
  watchTimer: 0,

  start(t, silent) {
    if (!t || !t.user || t.n == null) return;
    const old = this.talks.get(t.n);
    clearTimeout(this.timers.get(t.n));
    this.timers.delete(t.n);
    this.talks.set(t.n, Object.assign({}, t, { start: old ? old.start : Date.now(), last: Date.now() }));
    this.watch();
    if (old) return ui.refresh();
    if (!t.via) audio.stopReplay();
    audio.resume();
    if (t.chiamata) disp.noteCall(t.chiamata, t.user, t.id);
    if (t.privato) priv.incoming(t.user);
    if (!silent && !this.muted(t.n)) audio.sfx(t.privato ? 'priv' : t.chiamata ? 'call' : t.prio ? 'prio' : 'rxStart');
    if (!t.eco) audio.bedStart();
    vibrate(t.prio || t.privato ? [50, 40, 50] : 25);
    ui.refresh();
  },

  touch(n) {
    const t = this.talks.get(n);
    if (t) t.last = Date.now();
  },

  /** Scansione: se parla qualcuno nel tuo canale, i canali scansionati tacciono (priorità al canale principale) */
  muted(n) {
    const t = this.talks.get(n);
    if (!t || !t.via || disp.allowed()) return false;
    for (const x of this.talks.values()) if (!x.via && x.n !== n) return true;
    return false;
  },

  end(m) {
    if (m.msg) {
      const item = Object.assign({}, m.msg, { via: m.via || null });
      if (item.privato) priv.log(item);
      ui.feedAdd(item);
    }
    const t = this.talks.get(m.n);
    if (!t || this.timers.has(m.n)) return;
    const c = audio.ctx;
    const endAt = c ? Math.max(audio.endOf(m.n), c.currentTime) : 0;
    if (!this.muted(m.n) && !t.eco) audio.sfx('roger', endAt);
    const delay = c ? Math.max(0, (endAt - c.currentTime) * 1000) + 350 : 0;
    this.timers.set(m.n, setTimeout(() => this.remove(m.n), delay));
  },

  remove(n) {
    clearTimeout(this.timers.get(n));
    this.timers.delete(n);
    if (!this.talks.delete(n)) return;
    audio.streams.delete(n);
    if (!this.talks.size) audio.bedStop();
    ui.refresh();
  },

  // rete persa a metà: se una voce non manda più audio da 4 secondi la tolgo dal display
  watch() {
    if (this.watchTimer) return;
    this.watchTimer = setInterval(() => {
      const now = Date.now();
      for (const t of [...this.talks.values()]) if (now - t.last > 4000 && !this.timers.has(t.n)) this.remove(t.n);
      if (!this.talks.size) {
        clearInterval(this.watchTimer);
        this.watchTimer = 0;
      }
    }, 1000);
  },

  /** Quella da mostrare: prima il mio canale, poi le private, poi la più recente */
  latest() {
    let best = null;
    const score = (t) => (!t.via && !t.privato ? 3 : t.privato ? 2 : 1);
    for (const t of this.talks.values()) {
      if (this.muted(t.n)) continue;
      if (!best || score(t) > score(best) || (score(t) === score(best) && t.start >= best.start)) best = t;
    }
    return best;
  },
  busyHere() {
    for (const t of this.talks.values()) if (!t.via && !t.privato) return true;
    return false;
  },
  talkingIds() {
    const s = new Set();
    for (const t of this.talks.values()) s.add(t.user.id);
    return s;
  },
  reset() {
    for (const t of this.timers.values()) clearTimeout(t);
    this.timers.clear();
    this.talks.clear();
    audio.stopAll();
  },
};

// ================================================================== trasmissione (PTT)
export const ptt = {
  sid: 0,

  /** mode: 'call' = chiama la Centrale da qualsiasi canale */
  down(mode) {
    if (state.tx !== 'idle' || micTest.running) return;
    if (!state.online || !state.channel) {
      toast('Non sei collegato a nessun canale', { kind: 'bad' });
      audio.sfx('error');
      return;
    }
    if (!audio.micOk) return dialogs.micHelp();
    audio.resume();
    audio.stopReplay();
    tune.commit(true);
    if (mode === 'call' && !canCall()) {
      // nel canale della Centrale (o senza Centrale) il tasto "chiama" parla normalmente nel canale
      if (!state.centrale) toast("Non c'è una Centrale: chiedi al Founder di crearla");
      mode = null;
    }
    state.tx = 'pending';
    state.pttHeld = true;
    state.preBuffer = [];
    state.txInfo = {};
    const sid = ++this.sid;
    audio.startCapture(sid, { pcm: (b) => this.onPcm(b, sid), final: () => this.onFinal(sid) });
    const pt = priv.active();
    if (mode === 'call') {
      state.txMode = 'call';
      net.send({ t: 'ptt_start', centrale: true });
    } else if (pt) {
      state.txMode = 'priv';
      net.send({ t: 'ptt_start', privato: pt.uid });
    } else if (disp.sending()) {
      // la Centrale: parla ai canali collegati (o risponde a chi l'ha chiamata), con priorità
      state.txMode = 'disp';
      net.send({ t: 'ptt_start', diramazione: true, canali: disp.sendIds() });
    } else {
      state.txMode = null;
      net.send({ t: 'ptt_start' });
    }
    clearTimeout(state.pendingTimer);
    state.pendingTimer = setTimeout(() => {
      if (state.tx === 'pending') {
        this.abort();
        toast('Il server non risponde, riprova', { kind: 'bad' });
      }
    }, 4000);
    ui.refresh();
  },

  up() {
    state.pttHeld = false;
    if (state.tx === 'on') this.finish();
  },

  toggle(mode) {
    if (state.tx === 'idle') this.down(mode);
    else this.up();
  },

  onPcm(buf, sid) {
    if (sid !== this.sid) return;
    if (state.tx === 'pending') {
      state.preBuffer.push(buf);
      if (state.preBuffer.length > 60) state.preBuffer.shift();
    } else if (state.tx === 'on' || state.tx === 'stopping') {
      net.sendBinary(buf);
    }
  },

  onOk(m) {
    if (state.tx !== 'pending') return;
    clearTimeout(state.pendingTimer);
    state.tx = 'on';
    state.txStart = Date.now();
    state.txInfo = m || {};
    for (const b of state.preBuffer) net.sendBinary(b);
    state.preBuffer = [];
    audio.sfx('permit');
    vibrate(40);
    if (m && m.privato) priv.touch();
    if (m && m.saltati && m.saltati.length) toast(`Non ti sentono in: ${m.saltati.join(', ')} (lì sta già parlando un'altra Centrale)`, { kind: 'cen', ms: 6000 });
    ui.refresh();
    if (!state.pttHeld) this.finish();
  },

  finish() {
    if (state.tx !== 'on') return;
    state.tx = 'stopping';
    const sid = this.sid;
    // la coda (per non tagliare l'ultima parola) la gestisce il thread audio: funziona anche in secondo piano
    audio.stopCapture(sid, 160);
    clearTimeout(state.stopTimer);
    state.stopTimer = setTimeout(() => this.onFinal(sid), 1500);
  },

  onFinal(sid) {
    if (sid !== this.sid || state.tx !== 'stopping') return;
    clearTimeout(state.stopTimer);
    net.send({ t: 'ptt_stop' });
    this.reset();
    audio.sfx('end');
  },

  onBusy(by, kind) {
    if (state.tx !== 'pending') return;
    audio.stopCapture(this.sid);
    this.sid++;
    this.reset();
    audio.sfx('busy');
    vibrate([60, 60, 60]);
    state.busyBy = by;
    state.busyKind = kind;
    state.busyUntil = Date.now() + 2000;
    ui.busy();
    setTimeout(() => ui.refresh(), 2050);
  },

  onFail(msg) {
    if (state.tx !== 'pending') return;
    audio.stopCapture(this.sid);
    this.sid++;
    this.reset();
    audio.sfx('error');
    toast(msg || 'Non è possibile parlare adesso', { kind: 'bad', ms: 6000 });
  },

  // la Centrale ha preso la linea mentre parlavi
  onCut(by) {
    if (state.tx !== 'on' && state.tx !== 'stopping') return;
    audio.stopCapture(this.sid);
    this.sid++;
    this.reset();
    audio.sfx('busy');
    vibrate([80, 60, 80]);
    toast(`La Centrale (${displayName(by)}) ha preso la linea: la tua trasmissione è stata interrotta`, { kind: 'cen', ms: 6000 });
  },

  onTimeout() {
    if (state.tx !== 'on' && state.tx !== 'stopping') return;
    audio.stopCapture(this.sid);
    this.sid++;
    this.reset();
    audio.sfx('end');
    toast(`Tempo massimo di trasmissione (${state.maxTalk}s) raggiunto`, { icon: 'clock' });
  },

  abort() {
    if (state.tx === 'idle') return;
    audio.stopCapture(this.sid);
    this.sid++;
    net.send({ t: 'ptt_stop' });
    this.reset();
  },

  reset() {
    clearTimeout(state.pendingTimer);
    clearTimeout(state.stopTimer);
    const spoke = state.tx === 'on' || state.tx === 'stopping';
    if (spoke && state.txMode === 'disp') disp.replied();
    if (spoke && state.txMode === 'priv') priv.touch();
    state.tx = 'idle';
    state.txMode = null;
    state.preBuffer = [];
    state.micLevel = 0;
    ui.refresh();
  },
};
audio.onLevel = (lvl) => {
  state.micLevel = lvl;
  ui.micLevel(lvl);
};
audio.onMicLost = () => {
  ptt.abort();
  ui.refresh();
  toast('Il microfono si è scollegato', { kind: 'bad', icon: 'mic-off' });
};
audio.onState = () => ui.audioBanner();

/** Inizio/fine dal pulsante, dalla tastiera o dal tasto PC (rispetta "tieni premuto" / "premi una volta") */
export function pttPress(down, source, mode) {
  if (down) {
    audio.resume();
    if (!audio.micOk) return dialogs.micHelp();
    if (settings.pttMode === 'toggle') return ptt.toggle(mode);
    if (state.tx !== 'idle') return;
    state.pttSource = source;
    ptt.down(mode);
  } else if (settings.pttMode === 'hold' && state.pttSource === source) {
    state.pttSource = null;
    ptt.up();
  }
}

// Tasto PTT per Windows (funziona anche col gioco in primo piano); secondo tasto: chiama la Centrale
function onRemotePtt(down, centrale) {
  if (!settings.tastoPc || !state.loggedIn) return;
  pttPress(down, centrale ? 'remoteCall' : 'remote', centrale ? 'call' : null);
}

/** Posso chiamare la Centrale da qui? (c'è una Centrale e non sono già nel suo canale) */
export function canCall() {
  return !!state.centrale && !!state.channel && !state.channel.sos && !state.channel.eco;
}

// Registra 3 secondi e li fa riascoltare (solo qui, niente viene inviato)
export const micTest = {
  running: false,
  async run(btn) {
    if (this.running || state.tx !== 'idle') return;
    if (!audio.micOk) {
      const ok = await audio.initMic();
      ui.refresh();
      if (!ok) return dialogs.micHelp();
    }
    this.running = true;
    audio.resume();
    audio.stopReplay();
    const chunks = [];
    const sid = ++ptt.sid;
    const label = btn.querySelector('span') || btn;
    btn.disabled = true;
    label.textContent = 'Parla ora… (3 s)';
    audio.startCapture(sid, { pcm: (b) => chunks.push(b), final: () => {} });
    await sleep(3000);
    audio.stopCapture(sid);
    await sleep(250);
    label.textContent = 'Riascolto…';
    audio.streams.delete(0);
    for (const b of chunks) audio.playPcm(new Int16Array(b), 0);
    const wait = audio.ctx ? Math.max(0, audio.endOf(0) - audio.ctx.currentTime) : 0;
    await sleep(wait * 1000 + 250);
    audio.streams.delete(0);
    label.textContent = 'Prova microfono';
    btn.disabled = false;
    this.running = false;
    if (!chunks.length) toast('Nessun audio registrato: controlla il microfono', { kind: 'bad' });
  },
};

// ================================================================== messaggi scritti
function onText(m) {
  const item = Object.assign({}, m.msg, { via: m.via || null, mio: !!m.mio });
  if (item.privato) {
    priv.log(item);
    if (!m.mio) {
      priv.incoming(item.from, true);
      toast(`${displayName(item.from)}: ${item.testo}`, { kind: 'priv', ms: 7000 });
      audio.sfx('text');
      vibrate([30, 40, 30]);
    }
  } else if (!m.mio && !isMine(m.msg.from)) {
    audio.sfx('text');
    vibrate(20);
  }
  ui.feedAdd(item);
}

// ================================================================== allarmi: SOS e comunicati della Centrale
export const KINDS = {
  sos: { title: 'SOS', icon: 'siren', ack: 'Ricevuto, intervengo', done: "Hai risposto all'SOS", sev: 3, where: 'POSIZIONE' },
  emergenza: { title: 'EMERGENZA', icon: 'siren', ack: 'Ricevuto, intervengo', done: 'Hai risposto: stai intervenendo', sev: 3, where: 'LUOGO' },
  allerta: { title: 'ALLERTA', icon: 'alert', ack: 'Ricevuto', done: 'Hai confermato', sev: 2, where: 'LUOGO' },
  info: { title: 'COMUNICATO', icon: 'megaphone', ack: 'Ricevuto', done: 'Hai confermato', sev: 1, where: 'LUOGO' },
};

export function canaliText(m) {
  if (m.tutti) return 'A tutti i canali';
  const list = m.canali || [];
  const names = list
    .slice(0, 4)
    .map((c) => `${c.icona} ${c.nome}`)
    .join(', ');
  return `A: ${names}${list.length > 4 ? ` e altri ${list.length - 4}` : ''}`;
}

export const alarm = {
  current: null,
  kind: null,
  timer: 0,
  show(kind, m) {
    const K = KINDS[kind];
    if (this.current && this.current.id !== m.id && KINDS[this.kind].sev > K.sev) {
      toast(`${K.title}: ${m.testo}`, { kind: 'bad', ms: 6000 }); // è già aperto un allarme più grave
      return;
    }
    this.current = m;
    this.kind = kind;
    ui.alarm(kind, m);
    audio.resume();
    this.stopSound();
    const quiet = kind === 'info' && settings.muted; // le notizie rispettano il "muto", gli allarmi no
    if (!quiet) {
      const dur = kind === 'sos' || kind === 'emergenza' ? audio.siren(4) : kind === 'allerta' ? audio.alertTone() : audio.chime();
      this.timer = setTimeout(() => this.speak(), dur * 1000 + 300);
    }
    vibrate(kind === 'info' ? [120, 80, 120] : [400, 150, 400, 150, 800]);
    notifyAlarm(kind, m);
    ui.refresh();
  },
  speak() {
    const m = this.current;
    if (!m) return;
    const r = roleInfo(m.from.ruolo);
    const chi = (m.from.sigla ? m.from.sigla + ', ' : '') + m.from.nome;
    if (this.kind === 'sos') {
      const dove = m.testo ? `Posizione: ${m.testo}. Ripeto: ${m.testo}.` : 'Posizione non indicata.';
      speak(`Attenzione! S O S da ${chi}, ${r.nome}. ${dove} Canale ${m.canale.nome}.`);
    } else if (this.kind === 'emergenza') {
      speak(`Emergenza! La Centrale comunica: ${m.testo}.` + (m.luogo ? ` Luogo: ${m.luogo}. Ripeto: ${m.luogo}.` : ` Ripeto: ${m.testo}.`));
    } else if (this.kind === 'allerta') {
      speak(`Attenzione, allerta dalla Centrale: ${m.testo}.` + (m.luogo ? ` Luogo: ${m.luogo}.` : '') + ` Ripeto: ${m.testo}.`);
    } else {
      speak(`Comunicato della Centrale: ${m.testo}.` + (m.luogo ? ` Luogo: ${m.luogo}.` : ''));
    }
  },
  ack() {
    if (!this.current) return;
    net.send(this.kind === 'sos' ? { t: 'sos_ack', id: this.current.id } : { t: 'annuncio_ack', id: this.current.id });
    ui.alarmAcked(KINDS[this.kind].done);
  },
  stopSound() {
    clearTimeout(this.timer);
    audio.stopSiren();
    stopSpeaking();
  },
  close() {
    this.stopSound();
    ui.alarmClose();
    this.current = null;
    this.kind = null;
    ui.refresh();
  },
};

function notifyAlarm(kind, m) {
  if (!settings.notifiche || !('Notification' in window) || Notification.permission !== 'granted' || !document.hidden) return;
  const isSos = kind === 'sos';
  const title = isSos ? `SOS — ${displayName(m.from)}` : `${KINDS[kind].title} — Centrale`;
  const body = isSos ? `${m.testo || 'Posizione non indicata'} · ${m.canale.nome}` : m.testo + (m.luogo ? ` · ${m.luogo}` : '');
  const opts = { body, tag: m.id, requireInteraction: kind !== 'info', icon: 'icons/icon-192.png' };
  const fallback = () => {
    try {
      new Notification(title, opts);
    } catch (e) {}
  };
  if (navigator.serviceWorker && navigator.serviceWorker.ready) navigator.serviceWorker.ready.then((reg) => reg.showNotification(title, opts)).catch(fallback);
  else fallback();
}

function onAlert(m) {
  ui.feedAdd(m);
  ui.flash();
  disp.noteSos(m);
  if (isMine(m.from)) {
    audio.sfx('permit');
    toast('SOS inviato: sirena e posizione arrivano a tutto il canale e alla Centrale', { kind: 'bad', icon: 'siren', ms: 5000 });
    return;
  }
  alarm.show('sos', m);
}

function onSosAck(m) {
  const mineAck = isMine(m.by);
  const name = displayName(m.by);
  ui.addAck(m.id, name);
  ui.system(`${name} ha risposto all'SOS di ${displayName(m.alert.from)}`);
  disp.ackDone(m.id);
  if (alarm.current && alarm.current.id === m.id) ui.alarmAddAck(name + (mineAck ? ' (tu)' : ''));
  if (isMine(m.alert.from) && !mineAck) {
    toast(`${name} ha ricevuto il tuo SOS e sta intervenendo`, { kind: 'ok', ms: 7000 });
    audio.sfx('permit');
    speak(`${m.by.nome} ha ricevuto il tuo S O S.`);
  }
}

function onAnnuncio(m) {
  const a = m.msg;
  ui.feedAdd(a);
  state.lastNews = { ...a, at: Date.now() };
  ui.ticker();
  if (m.mio || isMine(a.from)) {
    if (m.mio) {
      audio.sfx('permit');
      const dove = a.tutti ? 'tutti i canali' : a.canali.length === 1 ? '1 canale' : `${a.canali.length} canali`;
      toast(`Comunicato inviato a ${dove}: lo ricevono ${m.persone} ${m.persone === 1 ? 'persona collegata' : 'persone collegate'}`, { kind: 'cen', ms: 6000 });
    }
    return;
  }
  if (a.livello !== 'info') ui.flash();
  alarm.show(KINDS[a.livello] ? a.livello : 'info', a);
}

function onAnnuncioAck(m) {
  const name = displayName(m.by);
  ui.addAck(m.id, name);
  if (alarm.current && alarm.current.id === m.id) ui.alarmAddAck(name + (isMine(m.by) ? ' (tu)' : ''));
  if (m.mio && !isMine(m.by)) {
    toast(`${name} ha ricevuto il comunicato`, { kind: 'ok', ms: 5000 });
    audio.sfx('permit');
    if (m.annuncio.livello === 'emergenza') speak(`${m.by.nome} interviene.`);
  }
}

// ---------------------------------------------------------------- richieste scritte alla Centrale
function onRichiesta(m) {
  const r = m.msg;
  ui.feedAdd(Object.assign({}, r, { via: m.via || null, mio: !!m.mio }));
  if (m.mio) {
    audio.sfx('permit');
    toast(
      m.persone
        ? `Richiesta inviata alla Centrale (la leggono ${m.persone} ${m.persone === 1 ? 'persona' : 'persone'})`
        : "Richiesta inviata. In Centrale ora non c'è nessuno: la troveranno appena entrano",
      { kind: 'cen', icon: 'phone', ms: 6000 }
    );
    return;
  }
  // in Centrale: avviso, voce che legge la richiesta e risposta veloce
  disp.noteRequest(r);
  audio.sfx('call');
  vibrate([120, 80, 120]);
  toast(`${displayName(r.from)} (${r.canale.icona} ${r.canale.nome}): ${r.testo}`, { kind: 'cen', icon: 'phone', ms: 8000 });
  if (!settings.muted) {
    const chi = (r.from.sigla ? r.from.sigla + ', ' : '') + r.from.nome;
    setTimeout(() => speak(`Richiesta da ${chi}, ${r.canale.nome}: ${r.testo}.` + (r.luogo ? ` Luogo: ${r.luogo}.` : '')), 700);
  }
}

function onRichiestaAck(m) {
  ui.addAck(m.id, displayName(m.by));
  disp.ackDone(m.id);
  if (m.mio) {
    toast('La Centrale ha preso in carico la tua richiesta', { kind: 'ok', icon: 'check', ms: 6000 });
    audio.sfx('permit');
    speak('La Centrale ha ricevuto la tua richiesta.');
  }
}

// ================================================================== Centrale operativa
// Chi ha il permesso "Centrale" collega più canali: parla a tutti insieme (con priorità),
// sente le loro risposte e manda comunicati (notizia, allerta, emergenza).
const DISP_DEFAULT = { on: false, tutti: false, canali: [], ascolta: true };
export const disp = {
  cfg: Object.assign({}, DISP_DEFAULT),
  uid: null,
  calls: [], // coda: chiamate, richieste e SOS arrivati alla Centrale
  reply: null,

  load(uid) {
    this.uid = uid || null;
    this.cfg = Object.assign({}, DISP_DEFAULT, (uid && store.get('disp:' + uid, null)) || {});
    if (!Array.isArray(this.cfg.canali)) this.cfg.canali = [];
    this.calls = [];
    this.reply = null;
  },
  save() {
    if (this.uid) store.set('disp:' + this.uid, this.cfg);
  },
  allowed() {
    return !!(state.perms && state.perms.diramazione);
  },
  /** Tutti i canali che posso collegare: quelli che vedo, tranne l'eco. I canali nuovi compaiono da soli */
  eligible() {
    return state.channels.filter((c) => !c.eco);
  },
  linked(id) {
    return this.cfg.tutti || this.cfg.canali.includes(id);
  },
  /** "In servizio" (più canali) acceso adesso (nel canale eco no) */
  active() {
    return this.allowed() && this.cfg.on && !!state.channel && !state.channel.eco;
  },
  targets() {
    if (!this.active()) return [];
    const cur = state.channel.id;
    return this.eligible().filter((c) => c.id !== cur && this.linked(c.id));
  },
  targetIds() {
    return this.targets().map((c) => c.id);
  },

  // ---- coda delle chiamate e risposta veloce
  push(item) {
    if (!this.allowed() && !(state.channel && state.channel.sos)) return;
    this.calls = [item, ...this.calls.filter((x) => x.id !== item.id)].slice(0, 14);
    ui.refresh();
  },
  noteCall(canale, user, id) {
    if (!canale) return;
    this.push({ kind: 'call', id: id || 'c' + Date.now(), canale, user, ts: Date.now() });
  },
  noteRequest(r) {
    this.push({ kind: 'req', id: r.id, canale: r.canale, user: r.from, ts: r.ts || Date.now(), testo: r.testo, luogo: r.luogo });
  },
  noteSos(m) {
    if (isMine(m.from)) return;
    this.push({ kind: 'sos', id: m.id, canale: m.canale, user: m.from, ts: m.ts || Date.now(), testo: m.testo });
  },
  ackDone(id) {
    const c = this.calls.find((x) => x.id === id);
    if (c) {
      c.done = true;
      ui.refresh();
    }
  },
  armReply(canale) {
    if (!this.allowed() || !canale) return;
    if (state.channel && canale.id === state.channel.id) return toast('Sei già in quel canale: tieni premuto e parla');
    this.reply = { ...canale, ts: Date.now() };
    ui.refresh();
    toast(`Tieni premuto e parla: rispondi a ${canale.icona} ${canale.nome}`, { kind: 'cen', icon: 'reply', ms: 4000 });
  },
  cancelReply() {
    this.reply = null;
    ui.refresh();
  },
  replied() {
    if (!this.reply) return;
    for (const c of this.calls) if (c.kind === 'call' && c.canale.id === this.reply.id) c.done = true;
    this.reply = null;
    ui.refresh();
  },
  replyTarget() {
    if (this.reply && Date.now() - this.reply.ts > 3 * 60000) this.reply = null; // dopo 3 minuti si annulla
    return this.allowed() && state.channel && !state.channel.eco ? this.reply : null;
  },
  /** La prossima trasmissione va "come Centrale" (più canali o risposta) */
  sending() {
    return this.active() || !!this.replyTarget();
  },
  sendIds() {
    const r = this.replyTarget();
    const ids = this.targetIds();
    if (r && !ids.includes(r.id)) ids.unshift(r.id);
    return ids;
  },
  changed() {
    this.save();
    syncMonitor();
    ui.refresh();
  },
  toggle() {
    this.cfg.on = !this.cfg.on;
    this.changed();
    audio.sfx('scan');
    if (!this.cfg.on) return toast('Centrale fuori servizio: parli solo nel tuo canale', { kind: 'cen' });
    const n = this.targets().length;
    toast(n ? `Centrale in servizio: parli a ${n + 1} canali insieme` : 'Centrale in servizio: scegli i canali da collegare (o «Tutti»)', { kind: 'cen', ms: 4500 });
  },
  toggleAll() {
    this.cfg.tutti = !this.cfg.tutti;
    if (!this.cfg.tutti) this.cfg.canali = [];
    this.changed();
  },
  toggleCh(id) {
    if (this.cfg.tutti) {
      this.cfg.tutti = false;
      this.cfg.canali = this.eligible()
        .map((c) => c.id)
        .filter((x) => x !== id);
    } else if (this.cfg.canali.includes(id)) this.cfg.canali = this.cfg.canali.filter((x) => x !== id);
    else this.cfg.canali.push(id);
    this.changed();
  },
  toggleListen() {
    this.cfg.ascolta = !this.cfg.ascolta;
    this.changed();
    toast(this.cfg.ascolta ? 'Senti anche le risposte dei canali collegati' : 'Non senti più i canali collegati (solo il tuo)', { kind: 'cen', icon: this.cfg.ascolta ? 'ear' : 'ear-off' });
  },
};

// ================================================================== scansione (per tutti)
// Ascolti anche altri canali senza entrarci; se parla qualcuno nel tuo canale, lui ha la precedenza.
export const scan = {
  cfg: { on: false, tutti: true, canali: [] },
  uid: null,
  load(uid) {
    this.uid = uid || null;
    this.cfg = Object.assign({ on: false, tutti: true, canali: [] }, (uid && store.get('scan:' + uid, null)) || {});
  },
  save() {
    if (this.uid) store.set('scan:' + this.uid, this.cfg);
  },
  /** Canali che si possono scansionare: liberi (senza password per te), non eco */
  eligible() {
    return state.channels.filter((c) => !c.eco && !c.protetto);
  },
  inList(id) {
    return this.cfg.tutti || this.cfg.canali.includes(id);
  },
  ids() {
    const cur = state.channel && state.channel.id;
    return this.eligible()
      .filter((c) => c.id !== cur && this.inList(c.id))
      .map((c) => c.id);
  },
  active() {
    return !!this.cfg.on && !(disp.allowed() && disp.cfg.on);
  },
  toggle() {
    this.cfg.on = !this.cfg.on;
    this.save();
    syncMonitor();
    audio.sfx('scan');
    device.pop(device.popLines(this.cfg.on ? 'SCAN ON' : 'SCAN OFF', this.cfg.on ? `${this.ids().length} CANALI` : 'SOLO IL TUO CANALE'), 1000);
    toast(this.cfg.on ? `Scansione attiva: ascolti anche ${this.ids().length} canali (il tuo ha la precedenza)` : 'Scansione spenta', { icon: 'scan' });
    ui.refresh();
  },
  setList(tutti, canali) {
    this.cfg.tutti = !!tutti;
    this.cfg.canali = canali || [];
    this.save();
    syncMonitor();
    ui.refresh();
  },
};

/** Dice al server quali canali ascoltare oltre al mio (Centrale o scansione) e se sono "in servizio" come Centrale */
let lastMon = '';
export function syncMonitor() {
  if (!state.online) return;
  const cur = state.channel && state.channel.id;
  const allowed = disp.allowed();
  const attivo = allowed && disp.cfg.on;
  let ids = [];
  if (attivo) {
    if (disp.cfg.ascolta) ids = disp.eligible().filter((c) => c.id !== cur && disp.linked(c.id)).map((c) => c.id);
  } else if (scan.cfg.on) ids = scan.ids();
  const key = (attivo ? 'on:' : 'off:') + ids.join(',');
  if (key === lastMon) return;
  lastMon = key;
  net.send({ t: 'monitor', canali: ids, attivo });
}

// ================================================================== chiamate private
export const priv = {
  target: null, // { uid, nome, sigla, ruolo, ts, auto }
  active() {
    if (this.target && Date.now() - this.target.ts > (this.target.auto ? 60000 : 180000)) this.target = null;
    return this.target;
  },
  set(u) {
    if (!u || isMine(u)) return;
    this.target = { uid: u.uid, nome: u.nome, sigla: u.sigla, ruolo: u.ruolo, ts: Date.now(), auto: false };
    audio.sfx('scan');
    ui.refresh();
    toast(`Chiamata privata con ${displayName(u)}: tieni premuto e parla. Ti sente solo lui.`, { kind: 'priv', ms: 5000 });
  },
  /** Qualcuno mi ha chiamato in privato: la risposta è pronta per un minuto */
  incoming(u, text) {
    if (!u || isMine(u)) return;
    const t = this.active();
    if (t && t.uid !== u.uid) return; // sono già in privato con un altro
    if (t) return this.touch();
    this.target = { uid: u.uid, nome: u.nome, sigla: u.sigla, ruolo: u.ruolo, ts: Date.now(), auto: true };
    if (!text) device.pop(device.popLines('PRIVATA', displayName(u)), 1400);
    ui.refresh();
  },
  touch() {
    if (this.target) this.target.ts = Date.now();
  },
  end() {
    if (!this.target) return;
    this.target = null;
    audio.sfx('end');
    ui.refresh();
  },
  log(item) {
    state.privLog.push(item);
    if (state.privLog.length > 60) state.privLog.shift();
  },
};
setInterval(() => {
  // la risposta privata scade da sola: aggiorna lo schermo quando succede
  if (priv.target && !priv.active()) ui.refresh();
  if (disp.reply && !disp.replyTarget()) ui.refresh();
}, 5000);

// ================================================================== schermo sempre acceso
const wake = {
  lock: null,
  async on() {
    if (!settings.wakeLock || !('wakeLock' in navigator) || document.visibilityState !== 'visible' || this.lock) return;
    try {
      this.lock = await navigator.wakeLock.request('screen');
      this.lock.addEventListener('release', () => (this.lock = null));
    } catch (e) {}
  },
  off() {
    if (this.lock) {
      this.lock.release().catch(() => {});
      this.lock = null;
    }
  },
};
export { wake };

// ================================================================== accesso
function showView(v) {
  $('#loadingBox').hidden = v !== 'loading';
  $('#loginForm').hidden = v !== 'login';
  $('#resumeForm').hidden = v !== 'resume';
  $('#setupForm').hidden = v !== 'setup';
  $('#btnRetry').hidden = v !== 'error';
  if (v === 'resume') $('#resumeName').textContent = store.get('lastName', '') || 'operatore';
  if (v === 'login' && finePointer) setTimeout(() => ($('#inUser').value ? $('#inPass') : $('#inUser')).focus(), 50);
}

function setBusy(text) {
  for (const b of $$('.btn-go')) {
    const s = b.querySelector('span');
    if (!b.dataset.label) b.dataset.label = s.textContent;
    b.disabled = true;
    s.textContent = text;
  }
}

function loginFail(msg) {
  $('#loginErr').textContent = msg || '';
  for (const b of $$('.btn-go')) {
    b.disabled = false;
    if (b.dataset.label) b.querySelector('span').textContent = b.dataset.label;
  }
}

async function start(authMsg) {
  loginFail('');
  try {
    audio.unlock(); // deve avvenire subito, dentro il click
  } catch (err) {
    return loginFail("Il tuo browser non supporta l'audio. Usa Chrome, Edge, Firefox o Safari aggiornati.");
  }
  setBusy('Attivo il microfono…');
  await audio.initMic();
  setBusy('Aggancio alla rete…');
  state.pendingAuth = authMsg;
  state.loggedOut = false;
  if (state.ws) {
    const old = state.ws;
    state.ws = null;
    try {
      old.close();
    } catch (e) {}
  }
  net.connect();
  wake.on();
}

export function logoutNow(msg) {
  ptt.abort();
  net.close();
  rx.reset();
  audio.stopReplay();
  alarm.close();
  lastMon = '';
  wake.off();
  modal.close();
  popover.close();
  if (RadioApp.admin) RadioApp.admin.hide();
  state.loggedIn = false;
  state.channel = null;
  state.users.clear();
  state.roster = [];
  state.token = null;
  priv.target = null;
  store.set('token', null);
  ui.hideApp();
  ui.status('off');
  showView(state.info && state.info.setup ? 'setup' : 'login');
  loginFail(msg || '');
}

// ================================================================== tasto installa app
let installEvt = null;
export const install = {
  available: () => !!installEvt,
  async run() {
    if (!installEvt) return;
    installEvt.prompt();
    try {
      await installEvt.userChoice;
    } catch (err) {}
    installEvt = null;
    $('#btnInstall').hidden = true;
  },
};

// ================================================================== eventi
export const keys = { capture: null };

function bindEvents() {
  $('#loginForm').addEventListener('submit', (e) => {
    e.preventDefault();
    const username = $('#inUser').value.trim().toLowerCase();
    const password = $('#inPass').value;
    if (!username || !password) return loginFail('Scrivi nome utente e password');
    start({ t: 'login', username, password });
    $('#inPass').value = '';
  });
  $('#resumeForm').addEventListener('submit', (e) => {
    e.preventDefault();
    if (!state.token) return showView('login');
    start({ t: 'auth', token: state.token });
  });
  $('#btnSwitch').onclick = () => {
    state.token = null;
    store.set('token', null);
    showView('login');
  };
  $('#setupForm').addEventListener('submit', (e) => {
    e.preventDefault();
    start({
      t: 'setup',
      code: $('#suCode').value.trim(),
      username: $('#suUser').value.trim().toLowerCase(),
      password: $('#suPass').value,
      nome: $('#suNome').value.trim(),
      sigla: $('#suSigla').value.trim(),
    });
  });
  $('#btnRetry').onclick = () => boot(true);

  // pulsante grande PTT (mouse e touch)
  bindHoldPtt($('#ptt'), 'pointer', null);
  // "Parla con la Centrale" (tieni premuto, come il pulsante grande)
  bindHoldPtt($('#btnCall'), 'call', 'call');
  $('#btnRequest').onclick = () => dialogs.request();

  // tastiera (solo con la finestra in primo piano: per il gioco c'è il tasto PTT per Windows)
  document.addEventListener('keydown', (e) => {
    if (keys.capture) {
      e.preventDefault();
      const f = keys.capture;
      keys.capture = null;
      f(e.code === 'Escape' ? null : e.code);
      return;
    }
    if (popover.isOpen() && e.key === 'Escape') return popover.close();
    if (modal.isOpen()) {
      if (e.key === 'Escape') modal.close();
      return;
    }
    if (!$('#alarm').hidden && e.key === 'Escape') return alarm.close();
    if (RadioApp.admin && RadioApp.admin.isOpen()) {
      if (e.key === 'Escape') RadioApp.admin.hide();
      return;
    }
    if (e.key === 'Escape' && isTyping(e.target)) e.target.blur();
    if (!state.loggedIn || isTyping(e.target)) return;
    const call = !!settings.callKey && e.code === settings.callKey && e.code !== settings.pttKey;
    if (e.code !== settings.pttKey && !call) return;
    e.preventDefault();
    if (e.repeat) return;
    pttPress(true, call ? 'callkey' : 'key', call ? 'call' : null);
  });
  document.addEventListener('keyup', (e) => {
    const src = e.code === settings.pttKey ? 'key' : settings.callKey && e.code === settings.callKey ? 'callkey' : null;
    if (!src || state.pttSource !== src) return;
    e.preventDefault();
    pttPress(false, src);
  });
  window.addEventListener('blur', () => {
    if (state.pttSource === 'key' || state.pttSource === 'callkey') {
      state.pttSource = null;
      ptt.up();
    }
  });

  // SOS: tieni premuto (anche il tasto arancione sulla radio)
  device.bindHold($('#btnSos'), () => dialogs.sos(), () => toast('Tieni premuto SOS per un secondo per lanciare l\'allarme', { icon: 'siren' }));

  $('#btnSpeaker').onclick = () => {
    settings.muted = !settings.muted;
    saveSettings();
    audio.resume();
    audio.setVolume();
    ui.refresh();
    toast(settings.muted ? 'Audio disattivato (gli SOS suonano comunque)' : 'Audio attivo', { icon: settings.muted ? 'volume-off' : 'volume' });
  };
  $('#audioBanner').onclick = () => {
    audio.unlock();
    ui.audioBanner();
  };

  $('#composer').addEventListener('submit', (e) => {
    e.preventDefault();
    const input = $('#inText');
    const text = input.value.trim();
    if (!text) return;
    if (!state.online || !state.channel) return toast('Non sei collegato', { kind: 'bad' });
    const pt = priv.active();
    if (pt) {
      net.send({ t: 'text', text, privato: pt.uid });
      priv.touch();
    } else if (disp.sending()) {
      // Centrale (in servizio o risposta): il messaggio va ai canali collegati, firmato "Centrale"
      net.send({ t: 'text', text, diramazione: true, canali: disp.sendIds() });
      disp.replied();
    } else net.send({ t: 'text', text });
    input.value = '';
  });

  // allarmi
  $('#alarmAck').onclick = () => alarm.ack();
  $('#alarmRepeat').onclick = () => alarm.speak();
  $('#alarmClose').onclick = () => alarm.close();

  // finestre
  $('#modalForm').addEventListener('submit', (e) => {
    e.preventDefault();
    modal.submit();
  });
  $('#modalX').onclick = () => modal.close();
  $('#modal').addEventListener('pointerdown', (e) => {
    if (e.target === $('#modal')) modal.close();
  });

  // qualsiasi tocco riattiva l'audio se il browser l'ha messo in pausa
  document.addEventListener('pointerdown', () => audio.resume(), true);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      wake.on();
      audio.resume();
      net.reconnectNow();
    }
  });
  window.addEventListener('online', () => net.reconnectNow());

  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    installEvt = e;
    $('#btnInstall').hidden = false;
  });
  $('#btnInstall').onclick = () => install.run();

  ui.bind();
  device.init({
    step: (dir, quick) => tune.step(dir, quick),
    commit: (now) => tune.commit(now),
    key: (k) => tune.key(k),
    soft: (n) => ui.softkey(n),
    ptt: (down) => pttPress(down, 'side', null),
    vol: (dir) => ui.volume(dir),
    emergency: () => dialogs.sos(),
    emergencyShort: () => toast('Tieni premuto il tasto arancione per un secondo per l\'SOS', { icon: 'siren' }),
    afterBoot: () => ui.refresh(),
  });
}

function bindHoldPtt(btn, source, mode) {
  btn.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    e.preventDefault();
    if (settings.pttMode === 'hold') {
      try {
        btn.setPointerCapture(e.pointerId);
      } catch (err) {}
    }
    pttPress(true, source, mode);
  });
  const release = () => pttPress(false, source);
  btn.addEventListener('pointerup', release);
  btn.addEventListener('pointercancel', release);
  btn.addEventListener('lostpointercapture', release);
  btn.addEventListener('contextmenu', (e) => e.preventDefault());
  btn.addEventListener('keydown', (e) => {
    if ((e.key === 'Enter' || e.key === ' ') && !e.repeat && !isTyping(e.target)) {
      e.preventDefault();
      e.stopPropagation();
      pttPress(true, source + 'Key', mode);
    }
  });
  btn.addEventListener('keyup', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      pttPress(false, source + 'Key');
    }
  });
}

// ================================================================== avvio
async function boot(again) {
  if (!again) bindEvents();
  showView('loading');
  loginFail('');
  let info = null;
  try {
    const r = await fetch('/api/info', { cache: 'no-store' });
    if (r.ok) info = await r.json();
  } catch (e) {}
  state.info = info;
  ui.loginInfo(info);
  if (!info) {
    showView('error');
    return loginFail('Server non raggiungibile. Se è su Render può metterci fino a un minuto a svegliarsi: riprova tra poco.');
  }
  if (!window.isSecureContext) $('#insecureNote').hidden = false;
  if (info.errore) {
    showView('error');
    return loginFail(info.errore);
  }
  if (info.caricamento) {
    showView('loading');
    setTimeout(() => boot(true), 2000);
    return;
  }
  if (info.setup) showView('setup');
  else showView(state.token ? 'resume' : 'login');
  if (!again && 'serviceWorker' in navigator && window.isSecureContext) navigator.serviceWorker.register('sw.js').catch(() => {});
}

// API per il pannello Founder/Staff (admin.js) e per la diagnosi dalla console
export const RadioApp = {
  state,
  roleInfo,
  request: (op, data) => net.request(op, data),
  setToken(t) {
    state.token = t;
    store.set('token', t);
  },
  onAdminDirty: null,
  onSession: null,
  admin: null,
};
window.RadioApp = RadioApp;
window.__radio = { state, audio, settings, rx, disp, scan, priv, device };

boot(false);
import('./admin.js').then((m) => m.initAdmin(RadioApp)).catch((e) => console.error('Pannello non caricato', e));
