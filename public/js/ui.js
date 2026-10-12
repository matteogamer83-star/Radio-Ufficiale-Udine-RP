/*
 * Disegno dell'app: display della radio, canali, rubrica, registro, comandi,
 * console della Centrale, allarmi e tutte le finestre (impostazioni, SOS, richieste…)
 */
import { $, $$, el, icon, button, store, fmtTime, fmtDur, displayName, initials, keyName, STATI, statoInfo, statusPill, sleep, clamp, dotText, reducedMotion, saveFile } from './util.js';
import { settings, saveSettings, finePointer, SKINS, BACKLIGHTS, vibrate } from './settings.js';
import { audio, speak } from './audio.js';
import { modal, toast, popover, field, checkbox, switchEl, segmented, setRow, input as inputEl } from './ui-kit.js';
import { device } from './device.js';
import {
  state, net, rx, ptt, disp, scan, priv, alarm, tune, join, sendJoin, canCall, micTest, wake, install, keys,
  roleInfo, isMine, chNum, KINDS, canaliText, logoutNow, syncMonitor, APP_VERSION,
} from './app.js';

const APP_NAME = 'Radio Ufficiale';
const mqMobile = window.matchMedia('(max-width: 899px)');
const mqDrawer = window.matchMedia('(max-width: 1279px)');

// ================================================================== piccoli componenti
function avatar(u, cls) {
  const r = roleInfo(u && u.ruolo);
  const a = el('span', 'avatar' + (cls ? ' ' + cls : ''));
  a.style.setProperty('--c', r.colore || '#9ca3af');
  if (u && u.ruolo === 'centrale') a.append(icon('broadcast'));
  else if (u && u.ruolo === 'eco') a.append(icon('repeat'));
  else a.append(document.createTextNode(initials(u && u.nome)));
  return a;
}
function withStatus(a, stato) {
  const s = el('span', 'st');
  s.style.setProperty('--st', statoInfo(stato).colore);
  a.append(s);
  return a;
}
function eqBars() {
  const e = el('span', 'eq');
  e.append(el('i'), el('i'), el('i'), el('i'));
  return e;
}
function chIcons(c, extra) {
  const f = el('span', 'ch-flags');
  if (extra && extra.link) {
    const i = icon('broadcast', 'f-link');
    f.append(i);
  }
  if (extra && extra.scan) f.append(icon('scan', 'f-scan'));
  if (c.sos) f.append(icon('siren', 'f-sos'));
  if (c.eco) f.append(icon('repeat'));
  if (c.protetto) f.append(icon('lock'));
  return f;
}

// ================================================================== ui
let refreshQueued = false;
let lastChannelsSig = '';
let lastRosterSig = '';
let lastConsoleSig = '';

export const ui = {
  // ---------------------------------------------------------------- aggiornamento generale (una volta per fotogramma)
  refresh() {
    if (refreshQueued) return;
    refreshQueued = true;
    requestAnimationFrame(() => {
      refreshQueued = false;
      if (!state.loggedIn) return;
      this.header();
      this.channels();
      this.roster();
      this.lcd();
      this.pttBtn();
      this.callBar();
      this.dispStrip();
      this.privBar();
      this.composer();
      this.topbar();
      this.views();
      if (state.view === 'console' || state.mobileTab === 'console') this.console();
    });
  },

  bind() {
    // canali / rubrica (colonna sinistra)
    for (const b of $$('.side-tabs [data-tab]')) b.onclick = () => this.sideTab(b.dataset.tab);
    $('#btnMenu').onclick = () => this.openDrawer();
    $('#scrim').onclick = () => this.closeDrawer();
    $('#rosterSearch').addEventListener('input', () => {
      lastRosterSig = '';
      this.roster();
    });
    // schede del telefono
    $('#mobileTabs').addEventListener('click', (e) => {
      const b = e.target.closest('[data-m]');
      if (b) this.mobileTab(b.dataset.m);
    });
    // filtro del registro
    $('#feedFilter').addEventListener('click', (e) => {
      const b = e.target.closest('[data-f]');
      if (!b) return;
      for (const x of $$('#feedFilter button')) x.classList.toggle('on', x === b);
      $('#feed').dataset.filter = b.dataset.f;
    });
    // radio / console
    $('#viewSwitch').addEventListener('click', (e) => {
      const b = e.target.closest('[data-view]');
      if (b) this.setView(b.dataset.view);
    });
    $('#btnSettings').onclick = () => dialogs.settings();
    $('#btnMe').onclick = (e) => dialogs.meMenu(e.currentTarget);
    $('#btnAdmin').onclick = () => {
      this.closeDrawer();
      if (window.RadioApp.admin) window.RadioApp.admin.show();
    };
    $('#ticker').onclick = () => {
      const n = state.lastNews;
      if (n) toast(`${KINDS[n.livello] ? KINDS[n.livello].title : 'COMUNICATO'}: ${n.testo}${n.luogo ? ' · ' + n.luogo : ''}`, { kind: 'cen', icon: 'megaphone', ms: 8000 });
    };
    // la radio si adatta allo spazio
    const ro = new ResizeObserver(() => this.layout());
    ro.observe(document.querySelector('.stage'));
    mqMobile.addEventListener('change', () => {
      this.layout();
      this.refresh();
    });
    window.addEventListener('resize', () => this.layout());
    // tempi sul display mentre si parla
    setInterval(() => {
      if (state.loggedIn && (state.tx !== 'idle' || rx.talks.size)) {
        this.lcd();
        this.pttRing();
      }
    }, 250);
    setInterval(() => this.ticker(), 30000);
    // il registro aggiorna le "ore fa" ogni tanto non serve: mostriamo l'ora esatta
  },

  layout() {
    if (!state.loggedIn) return;
    const mobile = mqMobile.matches;
    if (mobile) {
      device.fit(window.innerWidth, 0, true);
      return;
    }
    const sm = $('.stage-main');
    const r = sm.getBoundingClientRect();
    const row = r.width >= 560;
    const ctl = $('.controls').getBoundingClientRect();
    const padH = 32;
    const availW = row ? r.width - ctl.width - 70 : r.width - 40;
    const availH = row ? r.height - padH : r.height - ctl.height - padH - 14;
    device.fit(availW, availH, false);
  },

  showApp() {
    const login = $('#login');
    const app = $('#app');
    const go = () => {
      login.hidden = true;
      login.classList.remove('leaving');
      app.hidden = false;
      app.classList.add('entering');
      setTimeout(() => app.classList.remove('entering'), 1400);
      this.stopLoginFx();
      this.mobileTab(state.mobileTab);
      this.layout();
      this.refresh();
      device.boot(displayName(state.me));
      this.audioBanner();
    };
    if (!login.hidden && !reducedMotion()) {
      login.classList.add('leaving');
      if (this.hero && this.hero.zoomIn) this.hero.zoomIn();
      setTimeout(go, 600);
    } else go();
  },
  hideApp() {
    $('#app').hidden = true;
    $('#login').hidden = false;
    $('#alarm').hidden = true;
    this.startLoginFx();
  },

  // ---------------------------------------------------------------- accesso: numeri, radio 3D e spettro
  loginInfo(info) {
    $('#serverName').textContent = (info && info.nome) || 'Udine RP ITA';
    $('#sideServer').textContent = (info && info.nome) || 'Udine RP ITA';
    $('#infoOnline').textContent = info ? String(info.online || 0) : '—';
    $('#infoCanali').textContent = info ? String(info.canali || 0) : '—';
    $('#loginVersion').textContent = 'v' + ((info && info.versione) || APP_VERSION);
    if (!$('#login').hidden) this.startLoginFx();
  },
  startLoginFx() {
    if (!this.fall) {
      import('./waterfall.js').then((m) => {
        this.fall = m.startWaterfall($('#waterfall'));
      }, () => {});
    } else this.fall.start();
    if (!this.hero) {
      this.hero = { pending: true };
      import('./hero3d.js')
        .then((m) => m.startHero($('#hero3d')))
        .then((h) => (this.hero = h || null), () => (this.hero = null));
    } else if (this.hero.start) this.hero.start();
  },
  stopLoginFx() {
    if (this.fall) this.fall.stop();
    if (this.hero && this.hero.stop) this.hero.stop();
  },

  // ---------------------------------------------------------------- barra in alto
  status(s) {
    const n = $('#netStatus');
    n.dataset.s = s;
    let bars = 0;
    let txt = 'Offline';
    if (s === 'connecting') txt = 'Aggancio…';
    if (s === 'on') {
      const r = state.rtt;
      bars = r == null ? 3 : r < 90 ? 4 : r < 180 ? 3 : r < 400 ? 2 : 1;
      txt = r == null ? 'Online' : `${r} ms`;
    }
    n.dataset.bars = String(bars);
    n.querySelector('.net-txt').textContent = txt;
    n.title = s === 'on' ? `Collegato · ritardo ${state.rtt == null ? '—' : state.rtt + ' ms'}` : txt;
    device.setSignal(bars);
    if (s !== 'on') this.lcd();
  },
  topbar() {
    const p = state.perms || {};
    const admin = !!(p.founder || p.utenti || p.canali);
    $('#btnAdmin').hidden = !admin;
    $('#pcKey').hidden = !(state.pcKeys > 0 && settings.tastoPc);
    const me = state.me;
    const b = $('#btnMe');
    const sig = me ? `${me.uid}|${me.nome}|${me.sigla}|${me.ruolo}|${me.stato}` : '';
    if (b.dataset.sig !== sig) {
      b.dataset.sig = sig;
      b.textContent = '';
      if (me) {
        b.append(withStatus(avatar(me), me.stato));
        const t = el('span', 'me-txt');
        t.append(el('b', null, displayName(me)), el('small', null, statoInfo(me.stato).nome));
        b.append(t);
      }
    }
    $('#btnInstall').hidden = !install.available();
  },
  ticker() {
    const n = state.lastNews;
    const t = $('#ticker');
    if (!n || Date.now() - n.at > 30 * 60000) {
      t.hidden = true;
      return;
    }
    const text = `${KINDS[n.livello] ? KINDS[n.livello].title : 'COMUNICATO'} · ${n.from.nome}: ${n.testo}${n.luogo ? ' — ' + n.luogo : ''}   ·   ${fmtTime(n.ts)}`;
    const span = $('#tickerText');
    if (span.textContent !== text) {
      span.textContent = text;
      span.style.setProperty('--dur', Math.max(12, text.length * 0.22) + 's');
    }
    t.dataset.lv = n.livello;
    t.hidden = false;
  },
  audioBanner() {
    const blocked = !!audio.ctx && audio.ctx.state !== 'running' && state.loggedIn;
    $('#audioBanner').hidden = !blocked;
  },
  flash() {
    const app = $('#app');
    app.classList.remove('flash');
    void app.offsetWidth;
    app.classList.add('flash');
    setTimeout(() => app.classList.remove('flash'), 3200);
  },
  busy() {
    const b = $('#ptt');
    b.dataset.state = 'busy';
    this.lcd();
    setTimeout(() => this.refresh(), 2050);
  },
  volume(dir) {
    settings.volume = clamp(Math.round((settings.volume + dir * 0.1) * 10) / 10, 0, 1.5);
    settings.muted = false;
    saveSettings();
    audio.setVolume();
    audio.sfx('key');
    const bar = el('div', 'bar');
    const lv = Math.round((settings.volume / 1.5) * 10);
    for (let i = 0; i < 10; i++) bar.append(el('i', i < lv ? 'on' : ''));
    const box = el('div');
    box.append(el('div', null, `VOLUME ${Math.round(settings.volume * 100)}%`), bar);
    device.pop(box, 1200);
    this.refresh();
  },
  micLevel(lvl) {
    const core = $('#ptt .ptt-core');
    if (state.tx === 'on') core.style.boxShadow = `inset 0 2px 0 rgba(255,255,255,.3), inset 0 -8px 16px rgba(80,0,0,.45), 0 0 0 1px rgba(0,0,0,.5), 0 0 ${Math.round(40 + lvl * 260)}px -6px rgba(255,60,40,${Math.min(0.95, 0.5 + lvl * 3).toFixed(2)})`;
    else core.style.boxShadow = '';
  },

  // ---------------------------------------------------------------- testata del registro
  header() {
    const ch = state.channel;
    $('#chIcon').textContent = ch ? ch.icona : '📻';
    $('#chName').textContent = ch ? ch.nome : 'Nessun canale';
    const n = this.people().length;
    $('#chMeta').textContent = ch ? `TG ${ch.tg || '—'} · ${n} ${n === 1 ? 'persona' : 'persone'} in canale` : '';
    this.title();
  },
  title() {
    const ch = state.channel;
    const t = rx.latest();
    if (state.tx === 'on') document.title = `● IN ONDA — ${APP_NAME}`;
    else if (t) document.title = `▶ ${displayName(t.user)} — ${APP_NAME}`;
    else document.title = ch ? `${ch.nome} — ${APP_NAME}` : APP_NAME;
  },

  // Una persona collegata da più dispositivi (es. PC e telefono) compare una volta sola
  people() {
    const groups = new Map();
    for (const u of state.users.values()) {
      const key = u.uid || 'c' + u.id;
      const g = groups.get(key) || { u, n: 0, ids: [] };
      g.n++;
      g.ids.push(u.id);
      groups.set(key, g);
    }
    return [...groups.values()];
  },

  // ---------------------------------------------------------------- canali
  sideTab(tab) {
    $('#tabCanali').classList.toggle('on', tab === 'canali');
    $('#tabRubrica').classList.toggle('on', tab === 'rubrica');
    $('#tabCanali').setAttribute('aria-selected', String(tab === 'canali'));
    $('#tabRubrica').setAttribute('aria-selected', String(tab === 'rubrica'));
    $('#panelCanali').hidden = tab !== 'canali';
    $('#panelRubrica').hidden = tab !== 'rubrica';
  },
  showChannels() {
    if (mqMobile.matches) return this.mobileTab('canali');
    this.sideTab('canali');
    if (mqDrawer.matches) this.openDrawer();
    const a = $('#channelList .ch.active');
    if (a) a.focus();
  },
  openDrawer() {
    if (!mqDrawer.matches || mqMobile.matches) return;
    $('#side').classList.add('open');
    $('#scrim').classList.add('show');
  },
  closeDrawer() {
    $('#side').classList.remove('open');
    $('#scrim').classList.remove('show');
  },
  mobileTab(m) {
    if (m === 'console' && !disp.allowed()) m = 'registro';
    state.mobileTab = m;
    $('#app').dataset.m = m;
    for (const b of $$('#mobileTabs [data-m]')) b.classList.toggle('on', b.dataset.m === m);
    if (m === 'console') this.console();
  },

  channels() {
    const cur = state.channel && state.channel.id;
    const sig = JSON.stringify([cur, state.channels, disp.active() ? disp.cfg : 0, scan.cfg.on ? scan.cfg : 0]);
    if (sig === lastChannelsSig) return;
    lastChannelsSig = sig;
    const list = $('#channelList');
    const focused = document.activeElement && document.activeElement.closest && document.activeElement.closest('#channelList [data-id]');
    const fid = focused && focused.dataset.id;
    list.textContent = '';
    state.channels.forEach((c, i) => {
      const active = c.id === cur;
      const linked = !active && disp.active() && !c.eco && disp.linked(c.id);
      const scanned = !active && !disp.active() && scan.cfg.on && !c.eco && !c.protetto && scan.inList(c.id);
      const b = el('button', 'ch' + (active ? ' active' : '') + (c.attivo ? ' live' : '') + (linked ? ' linked' : ''));
      b.type = 'button';
      b.dataset.id = c.id;
      const body = el('span', 'ch-body');
      body.append(el('span', 'ch-name', c.nome));
      const desc = el('span', 'ch-desc');
      if (c.attivo && c.parla) {
        desc.append(eqBars(), document.createTextNode(c.parla.prio ? 'Centrale in onda' : displayName(c.parla)));
      } else desc.textContent = c.descrizione || (c.eco ? 'Prova audio' : 'Canale libero');
      body.append(desc);
      const count = el('span', 'ch-count', String(c.utenti));
      count.title = `${c.utenti} ${c.utenti === 1 ? 'persona' : 'persone'} nel canale`;
      b.append(el('span', 'ch-tg', String(i + 1).padStart(2, '0')), el('span', 'ch-ic', c.icona), body, chIcons(c, { link: linked, scan: scanned }), count);
      b.title = `${c.nome} · TG ${c.tg || '—'}` + (c.protetto ? ' · con password' : '') + (c.sos ? ' · Centrale: riceve SOS e chiamate' : '');
      b.onclick = () => join(c.id);
      list.append(b);
    });
    if (fid) {
      const f = list.querySelector(`[data-id="${CSS.escape(fid)}"]`);
      if (f) f.focus({ preventScroll: true });
    }
    device.setKnobRange(state.channels.length, tune.cur());
  },

  // ---------------------------------------------------------------- rubrica (chi è online)
  roster() {
    const q = $('#rosterSearch').value.trim().toLowerCase();
    const talking = new Set([...rx.talks.values()].map((t) => t.user.uid));
    const sig = JSON.stringify([q, state.roster, state.channel && state.channel.id, [...talking]]);
    if (sig === lastRosterSig) return;
    lastRosterSig = sig;
    const box = $('#roster');
    box.textContent = '';
    const all = state.roster || [];
    $('#rubricaCount').textContent = all.length ? String(all.length) : '';
    const chName = (id) => {
      const c = state.channels.find((x) => x.id === id);
      return c ? `${c.icona} ${c.nome}` : 'Canale riservato';
    };
    const list = all.filter((p) => !q || [p.nome, p.sigla, roleInfo(p.ruolo).nome, statoInfo(p.stato).nome].join(' ').toLowerCase().includes(q));
    if (!list.length) {
      const e = el('div', 'empty');
      e.append(icon('users'), el('div', null, q ? 'Nessuno trovato.' : 'Nessuno online in questo momento.'));
      box.append(e);
      return;
    }
    const cur = state.channel && state.channel.id;
    const order = new Map(state.channels.map((c, i) => [c.id, i]));
    const groups = [
      ['Nel tuo canale', list.filter((p) => p.canale && p.canale === cur)],
      ['In altri canali', list.filter((p) => p.canale && p.canale !== cur).sort((a, b) => (order.get(a.canale) ?? 99) - (order.get(b.canale) ?? 99) || a.nome.localeCompare(b.nome, 'it'))],
      ['In canali riservati', list.filter((p) => !p.canale)],
    ];
    for (const [title, ps] of groups) {
      if (!ps.length) continue;
      const g = el('div', 'ro-group');
      g.append(el('span', null, title), el('span', 'count', String(ps.length)));
      box.append(g);
      for (const p of ps) {
        const mine = isMine(p);
        const b = el('button', 'ro');
        b.type = 'button';
        const a = withStatus(avatar(p), p.stato);
        if (p.parla || talking.has(p.uid)) a.classList.add('talking');
        const body = el('span', 'ro-body');
        const name = el('b', null, displayName(p));
        body.append(name);
        const sm = el('small');
        sm.append(statusPill(p.stato));
        if (title !== 'Nel tuo canale') sm.append(document.createTextNode('· ' + (p.canale ? chName(p.canale) : roleInfo(p.ruolo).nome)));
        else sm.append(document.createTextNode('· ' + roleInfo(p.ruolo).nome));
        body.append(sm);
        b.append(a, body);
        if (p.centrale) {
          const ci = icon('broadcast', 'ico-cen');
          ci.setAttribute('aria-label', 'In servizio come Centrale');
          b.append(ci);
        }
        if (p.parla || talking.has(p.uid)) b.append(eqBars());
        if (mine) b.append(el('span', 'tag-me', 'TU'));
        b.title = `${displayName(p)} — ${roleInfo(p.ruolo).nome} · ${statoInfo(p.stato).nome}` + (p.dispositivi > 1 ? ` · collegato da ${p.dispositivi} dispositivi` : '');
        b.onclick = () => (mine ? dialogs.status() : dialogs.personMenu(b, p));
        box.append(b);
      }
    }
  },

  // ---------------------------------------------------------------- display della radio
  lcd() {
    const ch = state.channel;
    const o = { mode: 'idle', top: '', main: '', sub: '', soft: ['', '', ''], flags: [] };
    const pt = priv.active();
    const t = rx.latest();
    const others = () => this.people().filter((g) => !isMine(g.u)).length;
    if (scan.active() && scan.cfg.on) o.flags.push('SCAN');
    if (disp.active()) o.flags.push('CEN');
    if (pt) o.flags.push('PRIV');
    if (settings.muted) o.flags.push('MUTE');
    if (state.pcKeys > 0 && settings.tastoPc) o.flags.push('PC');
    o.soft = [pt ? 'FINE PR' : 'CANALI', 'STATO', disp.allowed() ? (state.view === 'console' ? 'RADIO' : 'CONSOLE') : scan.cfg.on ? 'SCAN ON' : 'SCAN'];
    if (alarm.current && (alarm.kind === 'sos' || alarm.kind === 'emergenza')) {
      o.mode = 'sos';
      o.top = alarm.kind === 'sos' ? '!! SOS !!' : '!! EMERGENZA !!';
      o.main = alarm.kind === 'sos' ? displayName(alarm.current.from) : 'CENTRALE';
      o.sub = alarm.kind === 'sos' ? alarm.current.testo || 'POSIZIONE NON INDICATA' : alarm.current.luogo || alarm.current.testo;
    } else if (!state.online) {
      o.mode = 'off';
      o.top = 'SENZA SEGNALE';
      o.main = 'NO RETE';
      o.sub = 'Riconnessione...';
      o.soft = ['', '', ''];
    } else if (state.tx === 'pending') {
      o.mode = 'tx';
      if (state.txMode === 'call') {
        o.top = 'CHIAMO LA CENTRALE';
        o.main = state.centrale ? state.centrale.nome : 'CENTRALE';
      } else if (state.txMode === 'priv' && pt) {
        o.top = 'CHIAMATA PRIVATA';
        o.main = displayName(pt);
      } else {
        const n = disp.sendIds().length + 1;
        o.top = state.txMode === 'disp' ? 'CENTRALE: LINEA...' : 'RICHIESTA CANALE';
        o.main = n > 1 ? `${n} CANALI` : ch ? ch.nome : '';
      }
      o.sub = 'Attendi...';
    } else if (state.tx === 'on' || state.tx === 'stopping') {
      o.mode = 'tx';
      const info = state.txInfo || {};
      const people = (k) => `${k} ${k === 1 ? 'ti ascolta' : 'ti ascoltano'} in diretta`;
      const time = `TX ${fmtDur((Date.now() - state.txStart) / 1000)}/${fmtDur(state.maxTalk)}`;
      o.top = time;
      if (state.txMode === 'call') {
        o.main = 'CENTRALE';
        o.sub = info.ascoltatori ? people(info.ascoltatori) : 'Nessuno in Centrale: resta registrato';
      } else if (state.txMode === 'priv') {
        o.mode = 'tx';
        o.main = pt ? displayName(pt) : 'PRIVATA';
        o.sub = 'Privata: ti sente solo lui';
      } else if (info.canali > 1) {
        o.main = `${info.canali} CANALI`;
        o.sub = info.ascoltatori ? people(info.ascoltatori) : 'Nessuno in questi canali';
      } else {
        o.main = 'IN ONDA';
        if (ch && ch.eco) o.sub = 'Rilascia e ti risenti';
        else o.sub = others() ? people(others()) : 'Nessuno ti sta ascoltando';
      }
    } else if (Date.now() < state.busyUntil && state.busyBy) {
      o.mode = 'busy';
      o.main = displayName(state.busyBy);
      const k = state.busyKind;
      o.top = k === 'prio' ? 'PARLA LA CENTRALE' : k === 'centrale' ? 'CENTRALE OCCUPATA' : k === 'privato' ? 'OCCUPATO IN PRIVATA' : 'CANALE OCCUPATO';
      o.sub = k === 'prio' ? 'Priorita: aspetta che finisca' : 'Riprova tra poco';
    } else if (t) {
      const r = roleInfo(t.user.ruolo);
      const more = rx.talks.size > 1 ? ` +${rx.talks.size - 1}` : '';
      const el2 = fmtDur((Date.now() - t.start) / 1000);
      o.mode = t.privato ? 'priv' : t.prio ? 'prio' : t.chiamata ? 'call' : 'rx';
      o.main = t.user.sigla || t.user.nome;
      if (t.eco) {
        o.top = 'ECO · LA TUA VOCE';
        o.main = 'ECO';
      } else if (t.privato) o.top = `PRIVATA ${el2}`;
      else if (t.prio) o.top = `CENTRALE ${el2}${more}`;
      else if (t.chiamata) o.top = `CHIAMATA DA ${t.chiamata.nome}`;
      else if (t.via) o.top = `SCAN ${t.via.nome}${more}`;
      else o.top = `RX ${el2}${more}`;
      o.sub = t.prio ? (t.canali > 1 ? `Comunicazione a ${t.canali} canali` : 'Comunicazione della Centrale') : `${t.user.sigla ? t.user.nome + ' · ' : ''}${r.nome}`;
    } else if (pt) {
      o.mode = 'priv';
      o.top = pt.auto ? 'RISPOSTA PRIVATA' : 'CHIAMATA PRIVATA';
      o.main = pt.sigla || pt.nome;
      o.sub = 'Tieni premuto: ti sente solo lui';
    } else if (disp.replyTarget()) {
      const rt = disp.replyTarget();
      o.mode = 'prio';
      o.top = 'RISPOSTA PRONTA';
      o.main = rt.nome;
      o.sub = 'Tieni premuto e parla';
    } else if (disp.active()) {
      const n = disp.targets().length + 1;
      o.mode = 'idle';
      o.top = !disp.canSend() ? 'IN SERVIZIO · ASCOLTO' : n > 1 ? `CENTRALE · ${n} CANALI` : 'CENTRALE IN SERVIZIO';
      o.main = ch ? ch.nome : '';
      o.sub = !disp.canSend() ? 'Per parlare a tutti: canale Centrale' : n === 1 ? 'Collega i canali dalla console' : disp.cfg.ascolta ? 'Senti anche i canali collegati' : 'Senti solo questo canale';
    } else {
      o.mode = 'idle';
      o.top = scan.cfg.on ? `SCAN · CH ${ch ? chNum(ch) : '--'}` : `CH ${ch ? chNum(ch) : '--'} · IN ASCOLTO`;
      o.main = ch ? ch.nome : '';
      const n = others() + (ch ? 1 : 0);
      o.sub = ch ? `TG ${ch.tg || '-'} · ${n} in canale` : '';
    }
    device.setLcd(o);
    // LED e titolo della finestra
    const led = o.mode === 'off' ? 'off' : o.mode === 'tx' ? 'red' : o.mode === 'sos' ? 'sos' : o.mode === 'busy' ? 'amber' : ['rx', 'prio', 'call', 'priv'].includes(o.mode) && (t || state.tx !== 'idle') ? 'green' : 'idle';
    device.setLed(led);
    this.title();
    // riga di stato della console
    const cs = $('#csStatus');
    if (cs) {
      cs.dataset.mode = o.mode;
      cs.querySelector('span').textContent = dotText(`${o.top} · ${o.main}`);
      cs.querySelector('small').textContent = dotText(o.sub);
    }
  },

  // ---------------------------------------------------------------- pulsante PTT
  pttBtn() {
    const b = $('#ptt');
    const hold = settings.pttMode === 'hold';
    const pt = priv.active();
    let st;
    let label;
    let sub;
    let ico = 'mic';
    if (!audio.micOk) {
      st = 'nomic';
      label = 'ASCOLTO';
      sub = 'tocca per il microfono';
      ico = 'mic-off';
    } else if (!state.online) {
      st = 'off';
      label = 'NO RETE';
      sub = 'riconnessione…';
    } else if (state.tx === 'pending') {
      st = 'pending';
      label = 'ATTENDI';
      sub = 'richiesta linea';
    } else if (state.tx === 'on' || state.tx === 'stopping') {
      st = 'on';
      label = state.txMode === 'call' ? 'CHIAMATA' : 'IN ONDA';
      sub = hold ? 'rilascia per chiudere' : 'premi per chiudere';
    } else {
      st = 'idle';
      const n = disp.targets().length + 1;
      label = pt ? 'PRIVATA' : disp.replyTarget() ? 'RISPONDI' : n > 1 ? `${n} CANALI` : 'PARLA';
      sub = hold ? 'tieni premuto' : 'premi una volta';
    }
    if (!(b.dataset.state === 'busy' && st === 'idle' && Date.now() < state.busyUntil)) b.dataset.state = st;
    b.dataset.multi = !pt && (disp.targets().length || disp.replyTarget()) ? '1' : '';
    b.dataset.priv = pt ? '1' : '';
    $('#pttLabel').textContent = label;
    $('#pttSub').textContent = sub;
    $('#pttIcoUse').setAttribute('href', '#i-' + ico);
    b.setAttribute('aria-label', `${label}: ${sub}`);
    this.pttRing();
    // aiuto sotto i pulsanti
    const hint = $('#pttHint');
    hint.textContent = '';
    if (audio.micOk && finePointer) {
      hint.append(hold ? 'Da tastiera tieni premuto ' : 'Da tastiera premi ', el('kbd', null, keyName(settings.pttKey)));
      if (state.pcKeys > 0 && settings.tastoPc) hint.append(' · tasto PC collegato (anche in gioco)');
    }
    // altoparlante
    $('#spkIco').setAttribute('href', settings.muted ? '#i-volume-off' : '#i-volume');
    $('#spkLbl').textContent = settings.muted ? 'MUTO' : 'AUDIO';
    $('#btnSpeaker').classList.toggle('off', settings.muted);
  },
  /** L'anello intorno al pulsante mostra quanto tempo resta della trasmissione */
  pttRing() {
    const ring = $('#pttRing');
    if (state.tx === 'on' || state.tx === 'stopping') {
      const p = clamp((Date.now() - state.txStart) / 1000 / state.maxTalk, 0, 1);
      ring.style.strokeDashoffset = String(590.6 * (1 - p));
    } else ring.style.strokeDashoffset = '';
  },

  // Barra "Parla con la Centrale" (in tutti i canali, tranne quello della Centrale)
  callBar() {
    const bar = $('#callBar');
    const show = state.loggedIn && canCall() && !disp.canSend();
    bar.hidden = !show;
    if (!show) return;
    const c = state.centrale;
    const calling = state.txMode === 'call' && state.tx !== 'idle';
    const hold = settings.pttMode === 'hold';
    $('#btnCall').classList.toggle('on', calling);
    $('#callTitle').textContent = calling ? 'In chiamata con la Centrale' : 'Parla con la Centrale';
    const key = settings.callKey && finePointer ? ` · tasto ${keyName(settings.callKey)}` : '';
    $('#callSub').textContent = calling ? (hold ? 'rilascia per chiudere' : 'premi di nuovo per chiudere') : `messaggio vocale · ${c.persone ? c.persone + ' in ascolto' : 'resta registrato'} · ${hold ? 'tieni premuto' : 'premi'}${key}`;
  },

  // Barra della Centrale nella vista radio
  dispStrip() {
    const bar = $('#dispStrip');
    const show = disp.allowed() && state.loggedIn && state.view !== 'console' && state.mobileTab !== 'console';
    bar.hidden = !show;
    if (!show) return;
    const sig = JSON.stringify([disp.cfg, disp.targets().length, disp.replyTarget(), disp.calls.filter((c) => !c.done).length, state.channel && state.channel.id, [...disp.verso()]]);
    if (bar.dataset.sig === sig) return;
    bar.dataset.sig = sig;
    bar.textContent = '';
    bar.classList.toggle('on', disp.cfg.on);
    const row = el('div', 'ds-row');
    const title = el('span', 'ds-title');
    title.append(icon('broadcast'), document.createTextNode('CENTRALE'));
    const sw = switchEl(disp.cfg.on, () => disp.toggle());
    sw.title = 'In servizio: parli e ascolti su più canali insieme';
    row.append(title, sw);
    if (disp.cfg.on) {
      const n = disp.targets().length + 1;
      row.append(el('span', 'ds-count', `${n} ${n === 1 ? 'canale' : 'canali'}`));
    }
    const sp = el('span', 'grow');
    row.append(sp);
    const cons = button('Console', 'btn-sm', () => this.setView('console'), 'console');
    const pend = disp.calls.filter((c) => !c.done).length;
    if (pend) cons.append(el('span', 'badge red', String(pend)));
    row.append(cons);
    bar.append(row);
    if (!disp.canSend()) {
      const nr = el('div', 'ds-reply');
      const go = centraleChannel();
      nr.append(icon('lock'), el('span', null, 'Da questo canale parli solo qui (le fazioni non parlano alle altre radio).'));
      if (go) nr.append(button(go.nome, 'btn-sm', () => join(go.id), 'right', 'Vai nel canale da cui si parla con tutte le radio'));
      bar.append(nr);
      return;
    }
    const r = disp.replyTarget();
    if (r) {
      const rr = el('div', 'ds-reply armed');
      rr.append(icon('reply'), el('span', null, `Rispondi a ${r.icona} ${r.nome}: tieni premuto e parla`), button('', 'btn-sm btn-icon btn-ghost', () => disp.cancelReply(), 'close', 'Annulla'));
      bar.append(rr);
    } else {
      const last = disp.calls.find((c) => !c.done && c.kind !== 'sos');
      if (last) {
        const rr = el('div', 'ds-reply');
        rr.append(icon(last.kind === 'req' ? 'chat' : 'phone'), el('span', null, `${fmtTime(last.ts)} · ${displayName(last.user)} da ${last.canale.icona} ${last.canale.nome}`), button('Rispondi', 'btn-sm', () => disp.armReply(last.canale), 'reply'));
        bar.append(rr);
      }
    }
  },

  privBar() {
    const bar = $('#privBar');
    const pt = priv.active();
    bar.hidden = !pt || !state.loggedIn;
    if (!pt) return;
    const sig = `${pt.uid}|${pt.auto}`;
    if (bar.dataset.sig === sig) return;
    bar.dataset.sig = sig;
    bar.textContent = '';
    const t = el('div');
    t.append(el('b', null, `${pt.auto ? 'Rispondi in privato a' : 'Privata con'} ${displayName(pt)}`), el('small', null, 'Tieni premuto PARLA: ti sente solo questa persona'));
    bar.append(icon('private'), t, button('', 'btn-sm btn-icon btn-ghost', () => priv.end(), 'close', 'Chiudi la chiamata privata'));
  },

  composer() {
    const box = $('#composeTarget');
    const pt = priv.active();
    const n = disp.sendIds().length + 1;
    const input = $('#inText');
    box.textContent = '';
    box.className = 'compose-target';
    if (pt) {
      box.classList.add('priv');
      box.append(icon('private'), el('span', null, `Messaggio privato a ${displayName(pt)}`), button('', 'btn-sm btn-icon btn-ghost', () => priv.end(), 'close', 'Torna al canale'));
      input.placeholder = `Scrivi a ${pt.nome}…`;
    } else if (disp.sending() && n > 1) {
      box.classList.add('cen');
      box.append(icon('broadcast'), el('span', null, `Scrivi come ${state.channel.nome} a ${n} canali`));
      input.placeholder = `Scrivi a ${n} canali…`;
    } else {
      input.placeholder = state.channel ? `Scrivi in ${state.channel.nome}…` : 'Scrivi al canale…';
    }
    box.hidden = !box.childNodes.length;
  },

  // ---------------------------------------------------------------- viste: radio / console
  setView(v) {
    if (v === 'console' && !disp.allowed()) v = 'radio';
    state.view = v;
    if (mqMobile.matches) this.mobileTab(v === 'console' ? 'console' : 'registro');
    this.refresh();
    setTimeout(() => this.layout(), 0);
  },
  views() {
    const allowed = disp.allowed();
    $('#viewSwitch').hidden = !allowed;
    for (const b of $$('#viewSwitch [data-view]')) b.classList.toggle('on', b.dataset.view === state.view);
    const mobile = mqMobile.matches;
    const con = !mobile && allowed && state.view === 'console';
    $('#console').hidden = mobile ? !(allowed && state.mobileTab === 'console') : !con;
    $('#deviceWrap').hidden = con;
    $('.stage-main').classList.toggle('cm', con);
    // scheda Console sul telefono (solo per la Centrale)
    const tabs = $('#mobileTabs');
    let cb = tabs.querySelector('[data-m="console"]');
    if (allowed && !cb) {
      cb = el('button');
      cb.type = 'button';
      cb.dataset.m = 'console';
      cb.append(icon('console'), document.createTextNode('Console'));
      tabs.append(cb);
    } else if (!allowed && cb) {
      cb.remove();
      if (state.mobileTab === 'console') this.mobileTab('registro');
    }
  },

  // ---------------------------------------------------------------- console della Centrale
  console() {
    const box = $('#console');
    if (!disp.allowed()) return;
    if (!box.querySelector('.cs-head')) {
      box.textContent = '';
      box.append(el('div', 'cs-head'));
      const st = el('div', 'cs-status');
      st.id = 'csStatus';
      st.append(el('span'), el('small'));
      box.append(st);
      const body = el('div', 'cs-body');
      body.append(el('div', 'cs-grid'), el('div', 'cs-queue'));
      box.append(body);
      lastConsoleSig = '';
    }
    const cur = state.channel && state.channel.id;
    const verso = disp.verso();
    const sig = JSON.stringify([disp.cfg, cur, state.channels, disp.calls, disp.replyTarget(), [...verso]]);
    if (sig === lastConsoleSig) return;
    lastConsoleSig = sig;

    // testata: in servizio, tutti, ascolto, comunicato
    const head = box.querySelector('.cs-head');
    head.textContent = '';
    const title = el('span', 'ds-title');
    title.append(icon('broadcast'), document.createTextNode('CONSOLE CENTRALE'));
    const sw = el('label', 'row small');
    sw.append(switchEl(disp.cfg.on, () => disp.toggle()), el('span', null, 'In servizio'));
    head.append(title, sw);
    if (disp.cfg.on) {
      const n = disp.targets().length + 1;
      head.append(el('span', 'ds-count', `${n} ${n === 1 ? 'canale' : 'canali'} collegati`));
    }
    head.append(el('span', 'grow'));
    const all = button('Tutti', 'btn-sm' + (disp.cfg.tutti ? ' btn-primary' : ''), () => {
      if (!disp.cfg.on) disp.cfg.on = true;
      disp.toggleAll();
    }, 'broadcast', 'Tutti i canali, anche quelli creati dopo');
    const lis = button(disp.cfg.ascolta ? 'Ascolto' : 'Muto', 'btn-sm', () => disp.toggleListen(), disp.cfg.ascolta ? 'ear' : 'ear-off', 'Senti le risposte dei canali collegati');
    head.append(all);
    if (disp.perm()) head.append(lis, button('Comunicato', 'btn-sm btn-primary', () => dialogs.news(), 'megaphone'));
    // da un canale che non parla con le altre radio: solo ascolto, con la scorciatoia per la Centrale
    let note = box.querySelector('.cs-note');
    if (!disp.canSend()) {
      if (!note) {
        note = el('div', 'cs-note');
        box.insertBefore(note, box.querySelector('.cs-body'));
      }
      note.textContent = '';
      const go = centraleChannel();
      note.append(icon('lock'), el('span', null, `Da ${state.channel ? state.channel.nome : 'questo canale'} non si parla alle altre radio: qui puoi solo ascoltarle e ricevere le chiamate.`));
      if (go) note.append(button(`Vai in ${go.nome}`, 'btn-sm btn-primary', () => join(go.id), 'right'));
    } else if (note) note.remove();

    // canali
    const grid = box.querySelector('.cs-grid');
    grid.textContent = '';
    disp.eligible().forEach((c) => {
      const here = c.id === cur;
      const sel = here || (disp.cfg.on && disp.linked(c.id));
      const talk = verso.has(c.id);
      const t = el('div', 'tile' + (sel && !here ? ' sel' : '') + (here ? ' here' : '') + (c.attivo ? ' live' : '') + (c.parla && c.parla.prio ? ' prio' : '') + (!talk && !here ? ' listen' : ''));
      t.setAttribute('role', 'button');
      t.tabIndex = 0;
      const top = el('div', 'tile-top');
      top.append(el('span', 'tile-ic', c.icona), el('span', 'ch-tg', `TG ${c.tg || '—'}`));
      const name = el('div', 'tile-name', c.nome);
      t.append(top, name);
      if (c.attivo && c.parla) {
        const live = el('div', 'tile-live');
        live.append(eqBars(), el('span', null, c.parla.prio ? 'Centrale in onda' : displayName(c.parla)));
        t.append(live);
      }
      const meta = el('div', 'tile-meta');
      meta.append(icon('users', 'ico-sm'), el('span', null, String(c.utenti)));
      if (c.sos) meta.append(icon('siren', 'ico-sm'));
      if (c.protetto) meta.append(icon('lock', 'ico-sm'));
      if (here) meta.append(el('span', 'tile-tag', 'SEI QUI'));
      else if (!talk) meta.append(el('span', 'tile-tag mute', 'SOLO ASCOLTO'));
      t.append(meta);
      const selBox = el('span', 'tile-sel');
      selBox.append(icon('check'));
      if (!here) t.append(selBox);
      const toggle = () => {
        if (here) return;
        if (!disp.cfg.on) {
          disp.cfg.on = true;
          if (!disp.cfg.tutti && !disp.cfg.canali.includes(c.id)) disp.cfg.canali.push(c.id);
          disp.changed();
          return;
        }
        disp.toggleCh(c.id);
      };
      t.onclick = toggle;
      t.onkeydown = (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          toggle();
        }
      };
      t.title = here ? 'Il canale in cui sei: è sempre incluso' : !talk ? 'Da qui puoi solo ascoltarlo' + (sel ? ' (collegato)' : ': tocca per ascoltarlo') : sel ? 'Collegato: tocca per scollegarlo' : 'Tocca per collegarlo (parli e ascolti anche qui)';
      if (!here) {
        const j = button('Entra', 'btn-sm btn-ghost tile-join', (e) => {
          e.stopPropagation();
          join(c.id);
        }, 'right');
        t.append(j);
      }
      grid.append(t);
    });

    // coda: chiamate, richieste, SOS
    const q = box.querySelector('.cs-queue');
    q.textContent = '';
    const h = el('h3');
    h.append(icon('phone'), document.createTextNode('Chiamate e richieste'));
    q.append(h);
    if (!disp.calls.length) q.append(el('p', 'muted small', 'Qui arrivano le chiamate «Parla con la Centrale», le richieste scritte e gli SOS da tutti i canali.'));
    for (const c of disp.calls) {
      const it = el('div', `q-item k-${c.kind}${c.done ? ' done' : ''}`);
      const top = el('div', 'q-top');
      top.append(icon(c.kind === 'sos' ? 'siren' : c.kind === 'req' ? 'chat' : 'phone'), el('span', null, c.kind === 'sos' ? 'SOS' : c.kind === 'req' ? 'Richiesta' : 'Chiamata'), el('time', null, fmtTime(c.ts)));
      it.append(top, el('div', null, `${displayName(c.user)} · ${c.canale.icona} ${c.canale.nome}`));
      if (c.testo) it.append(el('div', 'muted', c.testo + (c.luogo ? ` — ${c.luogo}` : '')));
      const acts = el('div', 'q-acts');
      if (c.kind !== 'sos') acts.append(button('Rispondi', 'btn-sm', () => disp.armReply(c.canale), 'reply'));
      if (c.kind === 'req' && !c.done) {
        acts.append(button('Presa in carico', 'btn-sm', () => {
          net.send({ t: 'richiesta_ack', id: c.id });
          c.done = true;
          lastConsoleSig = '';
          this.refresh();
        }, 'check'));
      }
      if (c.kind === 'sos' && !c.done) acts.append(button('Intervengo', 'btn-sm', () => {
        net.send({ t: 'sos_ack', id: c.id });
        c.done = true;
        lastConsoleSig = '';
        this.refresh();
      }, 'check'));
      if (c.done) acts.append(el('span', 'badge green', 'gestita'));
      it.append(acts);
      q.append(it);
    }
    this.lcd();
  },

  // ---------------------------------------------------------------- registro
  feedItem(m) {
    if (m.tipo === 'sistema') {
      const s = el('div', 'msg-sys');
      s.append(el('time', null, fmtTime(m.ts)), document.createTextNode(m.testo));
      return s;
    }
    const mine = !!m.mio || isMine(m.from);
    const inCentrale = disp.allowed() || !!(state.channel && state.channel.sos);
    const kind = m.tipo === 'voce' ? 'voce' : m.tipo === 'testo' ? 'testo' : 'avvisi';
    const item = el('div', `msg msg-${m.tipo}` + (mine ? ' mine' : '') + (m.prio ? ' prio' : '') + (m.privato ? ' priv' : ''));
    item.dataset.k = kind;
    if (m.id) item.dataset.id = m.id;
    const r = roleInfo(m.from.ruolo);
    item.append(avatar(m.from));
    const head = el('div', 'msg-head');
    head.append(el('b', null, displayName(m.from)));
    if (m.from.ruolo !== 'centrale') head.append(el('span', 'rep', r.nome));
    const tag = (cls, ico, text) => {
      const t = el('span', 'tag ' + cls);
      t.append(icon(ico), document.createTextNode(text));
      head.append(t);
    };
    if (m.privato) tag('priv', 'private', mine ? `privato a ${m.privato.nome}` : 'privato per te');
    const daCanale = m.chiamata || (m.tipo === 'richiesta' ? m.canale : null);
    if (daCanale) tag('call', 'phone', mine ? 'alla Centrale' : `da ${daCanale.icona} ${daCanale.nome}`);
    else if (m.via) tag('', 'ear', `da ${m.via.icona} ${m.via.nome}`);
    if (m.canali > 1) tag('cen', 'broadcast', `a ${m.canali} canali`);
    head.append(el('time', null, fmtTime(m.ts)));
    item.append(head);

    if (m.tipo === 'voce') {
      const row = el('div', 'voice');
      const btn = el('button', 'play');
      btn.type = 'button';
      btn.setAttribute('aria-label', 'Riascolta il messaggio vocale');
      btn.append(icon('play'));
      const wave = el('div', 'wave');
      const bars = m.onda && m.onda.length ? m.onda : fakeWave(m.id);
      for (const v of bars) {
        const b = el('i');
        b.style.height = Math.max(8, v) + '%';
        wave.append(b);
      }
      row.append(btn, wave, el('span', 'dur', fmtDur(Math.max(1, m.durata))));
      btn.onclick = () => replayMsg(m, btn, wave);
      item.append(row);
      if (m.chiamata && !mine && disp.allowed()) item.append(this.callActions(m.chiamata));
      if (m.privato && !mine) {
        const acts = el('div', 'mc-actions');
        acts.style.gridColumn = '2';
        acts.append(button('Rispondi in privato', 'btn-sm', () => priv.set(m.from), 'reply'));
        item.append(acts);
      }
    } else if (m.tipo === 'testo') {
      const tx = el('div', 'text', m.testo);
      item.append(tx);
    } else if (m.tipo === 'allerta') {
      const card = el('div', 'msg-card mc-sos');
      const t = el('div', 'mc-title');
      const fromOther = state.channel && m.canale && m.canale.id !== state.channel.id;
      t.append(icon('siren'), document.createTextNode('Allerta SOS' + (fromOther ? ` · da ${m.canale.nome}` : '')));
      const w = el('div', 'mc-where');
      w.append(icon('pin'), document.createTextNode(m.testo || 'posizione non indicata'));
      card.append(t, w);
      item.append(card);
    } else if (m.tipo === 'annuncio') {
      const K = KINDS[m.livello] || KINDS.info;
      const card = el('div', 'msg-card mc-' + (KINDS[m.livello] ? m.livello : 'info'));
      const t = el('div', 'mc-title');
      t.append(icon(K.icon), document.createTextNode(`${K.title} · ${canaliText(m)}`));
      card.append(t, el('div', 'text', m.testo));
      if (m.luogo) {
        const w = el('div', 'mc-where');
        w.append(icon('pin'), document.createTextNode(m.luogo));
        card.append(w);
      }
      item.append(card);
    } else if (m.tipo === 'richiesta') {
      const card = el('div', 'msg-card mc-req');
      const t = el('div', 'mc-title');
      t.append(icon('phone'), document.createTextNode('Richiesta alla Centrale'));
      card.append(t, el('div', 'text', m.testo));
      if (m.luogo) {
        const w = el('div', 'mc-where');
        w.append(icon('pin'), document.createTextNode(m.luogo));
        card.append(w);
      }
      item.append(card);
    }
    if (m.tipo === 'allerta' || m.tipo === 'annuncio' || m.tipo === 'richiesta') {
      const card = item.querySelector('.msg-card');
      item._acks = (m.presoDa || []).map((p) => p.nome);
      const taken = el('div', 'mc-acks');
      taken.append(icon('check'), el('span', null, item._acks.join(', ')));
      taken.hidden = !item._acks.length;
      card.append(taken);
      const acts = el('div', 'mc-actions');
      if (m.tipo === 'richiesta' && !mine && inCentrale) {
        if (disp.allowed()) acts.append(button(`Rispondi a ${m.canale.nome}`, 'btn-sm', () => disp.armReply(m.canale), 'reply'));
        const take = button('Presa in carico', 'btn-sm', () => {
          net.send({ t: 'richiesta_ack', id: m.id });
          take.disabled = true;
        }, 'check');
        acts.prepend(take);
      }
      if (acts.childNodes.length) card.append(acts);
    }
    return item;
  },

  /** Pulsante "Rispondi" sotto a una chiamata (solo per la Centrale) */
  callActions(canale) {
    const box = el('div', 'mc-actions');
    box.style.gridColumn = '2';
    box.append(button(`Rispondi a ${canale.icona} ${canale.nome}`, 'btn-sm', () => disp.armReply(canale), 'reply'));
    return box;
  },

  /** Qualcuno ha risposto «Ricevuto» a un SOS, comunicato o richiesta: aggiorna il registro */
  addAck(id, name) {
    const item = [...$('#feed').children].find((x) => x.dataset.id === id);
    if (!item || !item._acks || item._acks.includes(name)) return;
    item._acks.push(name);
    const taken = item.querySelector('.mc-acks');
    taken.hidden = false;
    taken.querySelector('span').textContent = item._acks.join(', ');
  },

  feedReset(items) {
    const f = $('#feed');
    f.textContent = '';
    // i messaggi privati restano visibili anche cambiando canale (ultima mezz'ora)
    const since = Date.now() - 30 * 60000;
    const privs = state.privLog.filter((p) => p.ts > since && !items.some((x) => x.id === p.id));
    const all = items.concat(privs).sort((a, b) => a.ts - b.ts);
    if (!all.length) {
      const e = el('div', 'feed-empty');
      e.append(icon('radio'), el('div', null, 'Nessun messaggio recente in questo canale.'), el('div', null, 'Tieni premuto PARLA: gli altri ti sentono in diretta.'));
      f.append(e);
    }
    for (const m of all) f.append(this.feedItem(m));
    f.scrollTop = f.scrollHeight;
  },

  feedAdd(m) {
    const f = $('#feed');
    const nearBottom = f.scrollHeight - f.scrollTop - f.clientHeight < 120;
    const empty = f.querySelector('.feed-empty');
    if (empty) empty.remove();
    f.append(this.feedItem(m));
    while (f.children.length > 220) f.firstChild.remove();
    if (nearBottom || isMine(m.from)) f.scrollTop = f.scrollHeight;
  },

  system(text) {
    this.feedAdd({ tipo: 'sistema', testo: text, ts: Date.now() });
  },

  // ---------------------------------------------------------------- tasti funzione della radio
  softkey(n) {
    if (n === 1) {
      if (priv.active()) return priv.end();
      return this.showChannels();
    }
    if (n === 2) return dialogs.status();
    if (n === 3) {
      if (disp.allowed()) return this.setView(state.view === 'console' ? 'radio' : 'console');
      return scan.toggle();
    }
  },

  // ---------------------------------------------------------------- allarmi a tutto schermo
  alarm(kind, m) {
    const K = KINDS[kind];
    const r = roleInfo(m.from.ruolo);
    const isSos = kind === 'sos';
    const where = isSos ? m.testo : m.luogo;
    const box = $('#alarm');
    box.dataset.kind = kind === 'emergenza' ? 'sos' : kind;
    $('#alarmIco').setAttribute('href', '#i-' + K.icon);
    $('#alarmTitle').textContent = K.title;
    const daCentrale = m.from.ruolo === 'centrale';
    $('#alarmWho').textContent = displayName(m.from);
    $('#alarmRole').textContent = daCentrale ? 'Comunicazione ufficiale della Centrale' : `${r.icona} ${r.nome}`;
    $('#alarmText').hidden = isSos;
    $('#alarmText').textContent = isSos ? '' : m.testo;
    $('#alarmWhereBox').hidden = !isSos && !where;
    $('#alarmWhereLbl').lastChild.textContent = K.where;
    $('#alarmWhere').textContent = where || 'Posizione non indicata';
    $('#alarmWhere').classList.toggle('missing', !where);
    $('#alarmChan').textContent = isSos ? `Canale: ${m.canale.icona} ${m.canale.nome}` : canaliText(m);
    $('#alarmAcks').textContent = '';
    const b = $('#alarmAck');
    b.disabled = false;
    b.textContent = K.ack;
    box.hidden = false;
    setTimeout(() => b.focus(), 50);
  },
  alarmAcked(text) {
    const b = $('#alarmAck');
    b.disabled = true;
    b.textContent = text;
  },
  alarmAddAck(text) {
    const d = el('div', 'row');
    d.style.justifyContent = 'center';
    d.append(icon('check', 'ico-sm'), document.createTextNode(text));
    $('#alarmAcks').append(d);
  },
  alarmClose() {
    $('#alarm').hidden = true;
  },
};

// ------------------------------------------------------------------ riascolto con l'onda che avanza
function fakeWave(id) {
  const out = [];
  const s = String(id || 'x');
  for (let i = 0; i < 40; i++) {
    const c = s.charCodeAt(i % s.length) || 0;
    out.push(18 + ((c * 37 + i * 53) % 82));
  }
  return out;
}
let replayBtn = null;
async function replayMsg(m, btn, wave) {
  if (replayBtn === btn) {
    audio.stopReplay();
    return;
  }
  if (state.tx !== 'idle' || !state.channel) return;
  if (rx.busyHere()) return toast('Aspetta la fine della trasmissione');
  audio.stopReplay();
  replayBtn = btn;
  btn.classList.add('on');
  btn.firstChild.firstChild.setAttribute('href', '#i-stop');
  const bars = [...wave.children];
  let raf = 0;
  // vocale privato, di un canale ascoltato (Centrale o scansione), la mia chiamata (registrata in Centrale)
  const chId = m.privato ? '@privato' : (m.via && m.via.id) || (m.chiamata && m.centrale && isMine(m.from) ? m.centrale.id : state.channel.id);
  try {
    await audio.replay(`/api/msg/${encodeURIComponent(chId)}/${m.id}.wav?k=${encodeURIComponent(state.key)}`, (dur, at) => {
      const tick = () => {
        const p = clamp((audio.ctx.currentTime - at) / dur, 0, 1);
        const k = Math.round(p * bars.length);
        bars.forEach((b, i) => b.classList.toggle('p', i < k));
        if (p < 1 && replayBtn === btn) raf = requestAnimationFrame(tick);
      };
      raf = requestAnimationFrame(tick);
    });
  } catch (e) {
    toast(e && e.message === 'gone' ? 'Messaggio non più disponibile (i vocali si cancellano al riavvio del server)' : 'Impossibile riprodurre il messaggio', { kind: 'bad' });
  } finally {
    cancelAnimationFrame(raf);
    bars.forEach((b) => b.classList.remove('p'));
    if (replayBtn === btn) replayBtn = null;
    btn.classList.remove('on');
    btn.firstChild.firstChild.setAttribute('href', '#i-play');
  }
}

// ================================================================== finestre
const RICHIESTE = [
  ['Serve un\'ambulanza', '🚑'],
  ['Servono rinforzi', '🚓'],
  ['Servono i Vigili del Fuoco', '🚒'],
  ['Serve un carro attrezzi', '🔧'],
  ['Sono arrivato sul posto', '📍'],
  ['Situazione risolta', '✅'],
];
const LIVELLI = [
  ['info', 'Notizia', 'megaphone', 'Suona un avviso e una voce legge il messaggio. Per aggiornamenti e informazioni.'],
  ['allerta', 'Allerta', 'alert', 'Schermata arancione, suono di allarme e una voce che legge il messaggio due volte.'],
  ['emergenza', 'Emergenza', 'siren', "Schermata rossa e SIRENA (anche con l'audio su muto), poi una voce legge messaggio e luogo."],
];

/** Il canale da cui si parla con tutte le radio (di solito la Centrale) */
function centraleChannel() {
  const withTalk = state.channels.filter((c) => !c.eco && c.verso && c.verso.length);
  return withTalk.find((c) => c.sos) || withTalk[0] || null;
}

export const dialogs = {
  goCentrale(why) {
    const go = centraleChannel();
    const body = el('div', 'stack');
    body.append(el('p', 'muted', why), el('p', null, 'Dalle fazioni si parla solo nel proprio canale: alle altre radio parlano la Centrale e lo Staff (o i canali che il Founder ha abilitato).'));
    modal.open({
      title: 'Solo nel tuo canale',
      icon: 'lock',
      body,
      actions: go ? [{ label: 'Resta qui' }, { label: `Vai in ${go.nome}`, cls: 'btn-primary', primary: true, icon: 'right', onClick: () => join(go.id) }] : [{ label: 'Ho capito', cls: 'btn-primary', primary: true }],
    });
  },

  micHelp() {
    const msgs = {
      insecure: 'Il microfono funziona solo con un indirizzo sicuro che inizia con https:// (oppure aprendo la radio sul PC del server da http://localhost). Intanto puoi ascoltare.',
      denied: "Il permesso del microfono è bloccato. Tocca il lucchetto accanto all'indirizzo, metti Microfono su «Consenti» e poi premi Riprova.",
      notfound: 'Non trovo nessun microfono. Collega un microfono o delle cuffie con microfono e premi Riprova.',
      error: 'Non riesco ad attivare il microfono. Chiudi le altre app che lo stanno usando e premi Riprova.',
    };
    const actions = [{ label: 'Solo ascolto' }];
    if (audio.micError !== 'insecure') {
      actions.push({
        label: 'Riprova',
        cls: 'btn-primary',
        primary: true,
        icon: 'mic',
        onClick: async () => {
          audio.unlock();
          const ok = await audio.initMic();
          ui.refresh();
          if (ok) toast('Microfono attivato!', { kind: 'ok', icon: 'mic' });
          else setTimeout(() => dialogs.micHelp(), 300);
        },
      });
    }
    modal.open({ title: 'Microfono non attivo', icon: 'mic-off', body: msgs[audio.micError] || msgs.error, actions });
  },

  channelPassword(ch, wrong) {
    const pw = inputEl('', 'Password del canale', 'password');
    const body = el('div', 'stack');
    body.append(el('p', wrong ? 'note note-bad' : 'muted', wrong ? 'Password errata, riprova.' : `Il canale ${ch.icona} ${ch.nome} è protetto da password.`), pw);
    modal.open({
      title: ch.nome,
      icon: 'lock',
      body,
      focus: pw,
      actions: [
        { label: 'Annulla' },
        {
          label: 'Entra',
          cls: 'btn-primary',
          primary: true,
          onClick: () => {
            if (!pw.value) return false;
            sendJoin(ch.id, pw.value, false);
          },
        },
      ],
    });
  },

  sos() {
    if (!state.channel || !state.online) return toast('Non sei collegato a nessun canale', { kind: 'bad' });
    const recent = store.get('luoghi', []);
    const where = inputEl('', 'es. Piazza Libertà, vicino alla stazione');
    where.maxLength = 120;
    const body = el('div', 'stack');
    body.append(el('p', 'muted', `Tutti in ${state.channel.icona} ${state.channel.nome} e la Centrale sentiranno la sirena e una voce che legge la tua posizione.`), field('Dove ti trovi?', where));
    if (recent.length) {
      const q = el('div', 'quick-row');
      for (const l of recent) q.append(button(l, 'btn-sm', () => (where.value = l), 'pin'));
      body.append(field('Posizioni recenti', q));
    }
    audio.resume();
    vibrate([80, 40, 80]);
    modal.open({
      title: 'Allerta SOS',
      icon: 'siren',
      body,
      focus: where,
      actions: [
        { label: 'Annulla' },
        {
          label: 'INVIA SOS',
          cls: 'btn-danger',
          primary: true,
          icon: 'siren',
          onClick: () => {
            const l = where.value.trim();
            if (l) store.set('luoghi', [l, ...recent.filter((x) => x !== l)].slice(0, 4));
            net.send({ t: 'alert', text: l });
          },
        },
      ],
    });
  },

  request() {
    if (!state.online || !canCall()) return toast(state.centrale ? 'Sei già nel canale della Centrale: scrivi qui sotto' : "Non c'è una Centrale");
    const testo = el('textarea', 'input');
    testo.rows = 2;
    testo.maxLength = 200;
    testo.placeholder = "Cosa ti serve? es. Serve un'ambulanza, c'è un ferito";
    const quick = el('div', 'quick-row');
    for (const [q, e] of RICHIESTE) {
      const b = el('button', 'btn btn-sm', `${e} ${q}`);
      b.type = 'button';
      b.onclick = () => {
        testo.value = q;
        testo.focus();
      };
      quick.append(b);
    }
    const luogo = inputEl('', 'es. Via Roma, davanti alla banca (facoltativo)');
    luogo.maxLength = 80;
    const c = state.centrale;
    const body = el('div', 'form-grid');
    body.append(
      el('p', 'muted', `La richiesta arriva a ${c.icona} ${c.nome}: una voce la legge e ti rispondono appena possono. Per un messaggio vocale tieni premuto «Parla con la Centrale».`),
      field('Scelta rapida', quick),
      field('Cosa ti serve', testo),
      field('Dove sei', luogo)
    );
    modal.open({
      title: 'Richiesta alla Centrale',
      icon: 'phone',
      body,
      focus: testo,
      actions: [
        { label: 'Annulla' },
        {
          label: 'Invia',
          cls: 'btn-primary',
          primary: true,
          icon: 'send',
          onClick: () => {
            const text = testo.value.trim();
            if (!text) {
              toast('Scrivi cosa ti serve (o tocca una scelta rapida)');
              return false;
            }
            net.send({ t: 'richiesta', text, luogo: luogo.value.trim() });
          },
        },
      ],
    });
  },

  // Comunicato della Centrale: notizia / allerta / emergenza a uno, alcuni o tutti i canali
  news() {
    if (!state.online || !disp.perm()) return toast('Non hai il permesso di mandare comunicati', { kind: 'bad' });
    if (!disp.canSend()) return dialogs.goCentrale('I comunicati si mandano dal canale della Centrale (o dello Staff).');
    let livello = 'info';
    const hint = el('small', 'fld-hint', LIVELLI[0][3]);
    const seg = segmented(LIVELLI.map(([v, l, i]) => [v, l, i]), 'info', (v) => {
      livello = v;
      hint.textContent = LIVELLI.find((x) => x[0] === v)[3];
    }, 'seg-full');
    const testo = el('textarea', 'input');
    testo.rows = 3;
    testo.maxLength = 300;
    testo.placeholder = 'Cosa sta succedendo? es. Rapina in corso alla banca, servono pattuglie';
    const luogo = inputEl('', 'es. Piazza Libertà (facoltativo)');
    luogo.maxLength = 80;
    const allCk = checkbox('TUTTI i canali', disp.cfg.on && disp.cfg.tutti, 'Tutte le radio con cui si parla da qui');
    const list = el('div', 'check-grid');
    const pre = new Set([state.channel && state.channel.id, ...disp.targetIds()]);
    const v = disp.verso();
    for (const c of state.channels.filter((x) => x.id === state.channel.id || v.has(x.id))) {
      const k = checkbox(`${c.icona} ${c.nome}`, pre.has(c.id), `${c.utenti} ${c.utenti === 1 ? 'persona collegata' : 'persone collegate'}`);
      k.dataset.id = c.id;
      list.append(k);
    }
    const syncAll = () => {
      list.classList.toggle('dim', allCk.cb.checked);
      list.querySelectorAll('input').forEach((i) => (i.disabled = allCk.cb.checked));
    };
    allCk.cb.onchange = syncAll;
    syncAll();
    const who = el('div', 'stack');
    who.append(allCk, list);
    const body = el('div', 'form-grid');
    body.append(field('Tipo', seg, hint), field('Messaggio', testo), field('Luogo', luogo), field('A chi lo mandi', who));
    modal.open({
      title: 'Comunicato della Centrale',
      icon: 'megaphone',
      body,
      wide: true,
      focus: testo,
      actions: [
        { label: 'Annulla' },
        {
          label: 'Invia comunicato',
          cls: 'btn-primary',
          primary: true,
          icon: 'send',
          onClick: () => {
            const text = testo.value.trim();
            if (!text) {
              toast('Scrivi il messaggio del comunicato');
              testo.focus();
              return false;
            }
            const tutti = allCk.cb.checked;
            const canali = [...list.querySelectorAll('.chk')].filter((x) => x.cb.checked).map((x) => x.dataset.id);
            if (!tutti && !canali.length) {
              toast('Scegli almeno un canale');
              return false;
            }
            net.send({ t: 'annuncio', livello, text, luogo: luogo.value.trim(), tutti, canali });
          },
        },
      ],
    });
  },

  /** Stato operativo (come i tasti di stato delle radio TETRA) */
  status() {
    if (!state.online) return;
    const cur = (state.me && state.me.stato) || 'disponibile';
    const box = el('div', 'stack');
    box.append(el('p', 'muted', 'Il tuo stato lo vedono tutti nella rubrica e la Centrale nella console.'));
    const grid = el('div', 'check-grid');
    for (const s of STATI) {
      const b = el('button', 'chk');
      b.type = 'button';
      if (s.id === cur) b.style.borderColor = s.colore;
      const dot = el('span', 'status-pill');
      dot.style.setProperty('--st', s.colore);
      const t = el('span');
      t.append(el('b', null, s.nome), el('small', null, s.id === cur ? 'stato attuale' : `sul display: ${s.breve}`));
      b.append(dot, t);
      b.onclick = () => {
        modal.close();
        if (s.id === cur) return;
        net.send({ t: 'stato', stato: s.id });
        device.pop(device.popLines(s.breve, 'STATO INVIATO', s.nome), 1100);
        audio.sfx('registered');
      };
      grid.append(b);
    }
    box.append(grid);
    modal.open({ title: 'Stato operativo', icon: 'status', body: box, actions: [{ label: 'Chiudi' }] });
  },

  /** Menu di una persona della rubrica */
  personMenu(anchor, p) {
    popover.open(anchor, (box) => {
      const head = el('div', 'pop-head');
      head.append(withStatus(avatar(p), p.stato));
      const t = el('div');
      t.append(el('b', null, displayName(p)), el('small', null, `${roleInfo(p.ruolo).nome} · ${statoInfo(p.stato).nome}`));
      head.append(t);
      box.append(head);
      const ok = priv.reachable(p);
      box.append(popover.item('Chiamata privata', 'private', () => priv.set(p), { hint: ok ? 'voce' : 'altra fazione', disabled: !ok }));
      box.append(popover.item('Messaggio privato', 'chat', () => {
        priv.set(p);
        if (mqMobile.matches) ui.mobileTab('registro');
        setTimeout(() => $('#inText').focus(), 80);
      }, { hint: ok ? 'testo' : 'altra fazione', disabled: !ok }));
      if (!ok) box.append(el('p', 'pop-note', 'È in un altro canale: per le altre radio passa dalla Centrale.'));
      const ch = p.canale && state.channels.find((c) => c.id === p.canale);
      if (ch && (!state.channel || ch.id !== state.channel.id)) box.append(popover.item(`Vai in ${ch.nome}`, 'right', () => join(ch.id)));
    });
  },

  /** Il tuo avatar in alto: stato, impostazioni, uscita */
  meMenu(anchor) {
    popover.open(anchor, (box) => {
      const me = state.me || {};
      const head = el('div', 'pop-head');
      head.append(withStatus(avatar(me, 'avatar-lg'), me.stato));
      const t = el('div');
      t.append(el('b', null, displayName(me)), el('small', null, `@${me.username || ''} · ${roleInfo(me.ruolo).nome}`));
      head.append(t);
      box.append(head);
      for (const s of STATI) {
        const it = popover.item(s.nome, 'status', () => {
          if (s.id !== me.stato) net.send({ t: 'stato', stato: s.id });
        }, { on: s.id === me.stato });
        it.querySelector('.ico').style.color = s.colore;
        box.append(it);
      }
      box.append(el('div', 'pop-sep'));
      box.append(popover.item('Impostazioni', 'sliders', () => dialogs.settings()));
      box.append(popover.item('Cambia password', 'key', () => dialogs.changePassword()));
      box.append(popover.item('Esci', 'logout', () => logoutNow('')));
    });
  },

  scanList() {
    const list = el('div', 'check-grid');
    const allCk = checkbox('Tutti i canali liberi', scan.cfg.tutti, 'Anche quelli creati dopo');
    for (const c of scan.eligible()) {
      const k = checkbox(`${c.icona} ${c.nome}`, scan.cfg.tutti || scan.cfg.canali.includes(c.id), `TG ${c.tg || '—'}`);
      k.dataset.id = c.id;
      list.append(k);
    }
    const sync = () => {
      list.classList.toggle('dim', allCk.cb.checked);
      list.querySelectorAll('input').forEach((i) => (i.disabled = allCk.cb.checked));
    };
    allCk.cb.onchange = sync;
    sync();
    const body = el('div', 'stack');
    body.append(
      el('p', 'muted', 'Con la scansione ascolti anche questi canali senza entrarci. Se parla qualcuno nel tuo canale, lui ha la precedenza. I canali con password non si possono scansionare.'),
      allCk,
      list
    );
    modal.open({
      title: 'Canali da scansionare',
      icon: 'scan',
      body,
      wide: true,
      actions: [
        { label: 'Annulla' },
        {
          label: 'Salva',
          cls: 'btn-primary',
          primary: true,
          onClick: () => {
            const ids = [...list.querySelectorAll('.chk')].filter((x) => x.cb.checked).map((x) => x.dataset.id);
            scan.setList(allCk.cb.checked, ids);
            toast('Elenco della scansione salvato', { kind: 'ok', icon: 'scan' });
          },
        },
      ],
    });
  },

  changePassword() {
    const mk = (ph, ac) => {
      const i = inputEl('', ph, 'password');
      i.autocomplete = ac;
      return i;
    };
    const old = mk('Password attuale', 'current-password');
    const nw = mk('Nuova password (almeno 6 caratteri)', 'new-password');
    const nw2 = mk('Ripeti la nuova password', 'new-password');
    const body = el('div', 'stack');
    body.append(old, nw, nw2);
    modal.open({
      title: 'Cambia password',
      icon: 'key',
      body,
      focus: old,
      actions: [
        { label: 'Annulla' },
        {
          label: 'Salva',
          cls: 'btn-primary',
          primary: true,
          onClick: async () => {
            if (nw.value !== nw2.value) throw new Error('Le due password nuove non sono uguali');
            const r = await net.request('my_password', { old: old.value, password: nw.value });
            if (r.token) window.RadioApp.setToken(r.token);
            toast('Password cambiata', { kind: 'ok', icon: 'key' });
          },
        },
      ],
    });
  },

  async downloadPcKey() {
    const { token } = await net.request('ptt_token');
    const res = await fetch('ptt-helper.txt', { cache: 'no-store' });
    if (!res.ok) throw new Error('File del tasto non trovato sul server');
    const tpl = await res.text();
    const wsUrl = (location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host + '/ws';
    const ascii = (s) =>
      String(s || '')
        .normalize('NFD')
        .replace(/[̀-ͯ]/g, '')
        .replace(/[^\x20-\x7E]/g, '')
        .replace(/['"`$%^&|<>]/g, '');
    const text = tpl
      .split('__SERVER__').join(ascii(wsUrl))
      .split('__TOKEN__').join(ascii(token))
      .split('__NOME__').join(ascii(displayName(state.me)) || 'utente')
      .replace(/\r?\n/g, '\r\n');
    saveFile('Radio-Ufficiale-Tasto-PTT.bat', new Blob([text], { type: 'application/octet-stream' }));
    if (!settings.tastoPc) {
      settings.tastoPc = true;
      saveSettings();
      net.send({ t: 'set_remote', on: true });
    }
    const steps = el('ol', 'steps');
    for (const s of [
      'Apri il file scaricato «Radio-Ufficiale-Tasto-PTT.bat».',
      'Se Windows mostra «PC protetto da Windows», clicca «Ulteriori informazioni» e poi «Esegui comunque».',
      'Nella finestra nera premi il tasto che vuoi usare per parlare (consigliato: un tasto laterale del mouse o un tasto che il gioco non usa).',
      'Poi ti chiede se vuoi un SECONDO tasto per parlare direttamente con la Centrale: scrivi S e premilo, oppure premi solo INVIO per saltare.',
      'Lascia aperte la finestra nera e questa radio nel browser (anche ridotta a icona).',
      'Ora tieni premuto quel tasto anche dentro al gioco: parli in radio!',
    ]) steps.append(el('li', null, s));
    const body = el('div', 'stack');
    body.append(steps, el('p', 'muted small', 'Il file contiene il tuo codice personale: non condividerlo. Funziona su Windows 10 e 11.'));
    modal.open({ title: 'Tasto PTT per PC scaricato', icon: 'keyboard', body, actions: [{ label: 'Ho capito', cls: 'btn-primary', primary: true }] });
  },

  settings() {
    const wrap = el('div');
    const section = (t) => wrap.append(el('div', 'set-section', t));
    const check = (key, after) =>
      switchEl(settings[key], (v, cb) => {
        settings[key] = v;
        saveSettings();
        if (after) after(cb);
      });

    section('Audio');
    const vol = el('input');
    vol.type = 'range';
    vol.min = '0';
    vol.max = '1.5';
    vol.step = '0.05';
    vol.value = String(settings.volume);
    vol.oninput = () => {
      settings.volume = Number(vol.value);
      settings.muted = false;
      audio.setVolume();
      saveSettings();
      ui.refresh();
    };
    wrap.append(setRow('volume', 'Volume', vol));
    wrap.append(setRow('radio', 'Effetto radio', check('radioFx', () => audio.applyFx()), 'Filtro e distorsione da walkie-talkie sulla voce'));
    const suono = segmented(
      [
        ['analogico', 'Analogico'],
        ['digitale', 'TETRA'],
        ['classico', 'Classico'],
      ],
      settings.suono,
      (v) => {
        settings.suono = v;
        saveSettings();
        audio.applyFx();
        audio.resume();
        audio.sfx('roger');
      },
      'seg-sm'
    );
    wrap.append(setRow('wave', 'Suono della radio', suono, 'Analogico: fruscio e beep Motorola. TETRA: digitale e pulito.'));
    wrap.append(setRow('signal', 'Fruscio di fondo', check('fruscio'), 'Mentre qualcuno parla (solo suono analogico)'));
    wrap.append(setRow('bell', 'Suoni di sistema', check('beeps'), 'Beep di inizio e fine trasmissione'));
    wrap.append(setRow('dice', 'Toni del tastierino', check('toniTasti'), 'I veri toni DTMF quando premi i numeri sulla radio'));
    const testBtn = button('Prova microfono', '', null, 'mic');
    testBtn.onclick = () => micTest.run(testBtn);
    wrap.append(setRow('mic', 'Microfono', testBtn, audio.micOk ? 'Attivo. Per la prova completa usa il canale «Prova audio».' : 'Non attivo'));

    section('Aspetto della radio');
    const skins = el('div', 'skins');
    for (const s of SKINS) {
      const b = el('button', 'skin' + (settings.skin === s.id ? ' on' : ''));
      b.type = 'button';
      b.style.background = s.c;
      b.title = s.nome;
      b.setAttribute('aria-label', s.nome);
      b.onclick = () => {
        settings.skin = s.id;
        saveSettings();
        device.applySkin();
        skins.querySelectorAll('.skin').forEach((x) => x.classList.toggle('on', x === b));
      };
      skins.append(b);
    }
    wrap.append(setRow('palette', 'Colore della scocca', skins));
    const bls = el('div', 'skins');
    for (const s of BACKLIGHTS) {
      const b = el('button', 'skin' + (settings.retro === s.id ? ' on' : ''));
      b.type = 'button';
      b.style.background = s.c;
      b.title = s.nome;
      b.setAttribute('aria-label', s.nome);
      b.onclick = () => {
        settings.retro = s.id;
        saveSettings();
        device.applySkin();
        bls.querySelectorAll('.skin').forEach((x) => x.classList.toggle('on', x === b));
      };
      bls.append(b);
    }
    wrap.append(setRow('screen', 'Luce del display', bls, 'Il colore a riposo (quando parla qualcuno cambia da solo)'));

    section('Pulsante per parlare');
    const mode = segmented(
      [
        ['hold', 'Tieni premuto'],
        ['toggle', 'Premi 1 volta'],
      ],
      settings.pttMode,
      (v) => {
        settings.pttMode = v;
        saveSettings();
        ui.refresh();
      },
      'seg-sm'
    );
    wrap.append(setRow('mic', 'Modalità', mode));
    const keyBtn = button(keyName(settings.pttKey), '', null, 'keyboard');
    keyBtn.onclick = () => {
      keyBtn.querySelector('span').textContent = 'Premi un tasto…';
      keys.capture = (code) => {
        if (code) {
          settings.pttKey = code;
          saveSettings();
          ui.refresh();
        }
        keyBtn.querySelector('span').textContent = keyName(settings.pttKey);
      };
    };
    wrap.append(setRow('keyboard', 'Tasto nel browser', keyBtn, 'Funziona solo con questa finestra in primo piano'));
    if (state.centrale) {
      const callBtn = button(settings.callKey ? keyName(settings.callKey) : 'Scegli', '', null, 'phone');
      callBtn.onclick = () => {
        callBtn.querySelector('span').textContent = 'Premi un tasto… (Esc = nessuno)';
        keys.capture = (code) => {
          settings.callKey = code && code !== settings.pttKey ? code : '';
          saveSettings();
          ui.refresh();
          callBtn.querySelector('span').textContent = settings.callKey ? keyName(settings.callKey) : 'Scegli';
        };
      };
      wrap.append(setRow('phone', 'Tasto per chiamare la Centrale', callBtn, 'Tieni premuto per parlare con la Centrale da qualsiasi canale'));
    }
    const dl = button('Scarica', 'btn-primary', null, 'download');
    dl.onclick = async () => {
      dl.disabled = true;
      try {
        await dialogs.downloadPcKey();
      } catch (e) {
        toast(e.message, { kind: 'bad', ms: 5000 });
      } finally {
        dl.disabled = false;
      }
    };
    wrap.append(setRow('gamepad', 'Tasto PTT anche in gioco (Windows)', dl, 'Parli tenendo premuto un tasto anche dentro al gioco (più un secondo tasto, se vuoi, per la Centrale)'));
    wrap.append(
      setRow('keyboard', 'Questo browser risponde al tasto PC', check('tastoPc', () => {
        net.send({ t: 'set_remote', on: !!settings.tastoPc });
        ui.refresh();
      }), state.pcKeys > 0 ? 'Tasto collegato adesso' : 'Disattivalo sul telefono se usi il tasto sul PC')
    );

    section('Scansione');
    const scanSw = switchEl(scan.cfg.on, (v) => {
      if (v !== !!scan.cfg.on) scan.toggle();
    });
    wrap.append(setRow('scan', 'Scansione dei canali', scanSw, 'Ascolti anche altri canali (il tuo ha la precedenza)'));
    wrap.append(setRow('filter', 'Quali canali', button('Scegli', '', () => dialogs.scanList(), 'filter')));

    section('Telefono e avvisi');
    if (install.available()) {
      wrap.append(setRow('install', 'Installa la radio come app', button('Installa', 'btn-primary', () => {
        modal.close();
        install.run();
      }, 'install'), 'Icona nella schermata Home, a schermo intero'));
    }
    wrap.append(setRow('vibrate', 'Vibrazione', check('vibrate')));
    wrap.append(setRow('screen', 'Schermo sempre acceso', check('wakeLock', () => (settings.wakeLock ? wake.on() : wake.off())), 'Evita che il telefono si blocchi e smetta di ricevere'));
    wrap.append(
      setRow('bell', 'Notifiche SOS', check('notifiche', async (cb) => {
        if (!cb.checked) return;
        if (!('Notification' in window)) {
          toast('Questo browser non supporta le notifiche');
          cb.checked = settings.notifiche = false;
          saveSettings();
          return;
        }
        const p = await Notification.requestPermission().catch(() => 'denied');
        if (p !== 'granted') {
          toast('Notifiche bloccate dal browser', { kind: 'bad' });
          cb.checked = settings.notifiche = false;
          saveSettings();
        }
      }), 'Avviso sul desktop se arriva un SOS mentre la radio è in secondo piano')
    );

    section('Account');
    const u = state.me || {};
    wrap.append(setRow('user', displayName(u), button('Cambia password', '', () => dialogs.changePassword(), 'key'), `@${u.username || ''} · ${roleInfo(u.ruolo).nome}`));
    wrap.append(setRow('logout', 'Esci da questo dispositivo', button('Esci', 'btn-danger', () => {
      modal.close();
      logoutNow('');
    }, 'logout')));
    wrap.append(el('p', 'muted small', `Radio Ufficiale v${APP_VERSION}`));

    modal.open({
      title: 'Impostazioni',
      icon: 'sliders',
      body: wrap,
      wide: true,
      focus: false,
      actions: [{ label: 'Chiudi', cls: 'btn-primary' }],
      onClose: () => (keys.capture = null),
    });
  },
};
