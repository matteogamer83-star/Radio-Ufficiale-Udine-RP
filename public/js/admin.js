/*
 * Pannello Founder / Staff
 * - Panoramica: statistiche del giorno, canali dal vivo, chi è online, registro attività (solo Founder)
 * - Utenti: creare account, cambiare password, disattivare, eliminare
 * - Canali: aggiungere/togliere radio, password, chi può entrare, Centrale SOS, eco
 * - Ruoli (solo Founder): ruoli personalizzati e i loro permessi
 * - Server (solo Founder): nome, durata trasmissioni, archivio dati, backup e ripristino
 */
import { el, icon, button, ago, fmtTime, fmtDur, displayName, copyText, saveFile, statoInfo, statusPill, initials } from './util.js';
import { modal, toast, confirmBox, field, checkbox, input } from './ui-kit.js';

const CH_ICONS = ['📻', '🚨', '🚓', '🚔', '🛡️', '🚦', '🚑', '🚒', '🔧', '⭐', '🔁', '🏥', '🚁', '🕵️', '💼', '🏛️', '⚖️', '🎖️', '🚛', '🚕', '🏪', '🔒', '📡', '🎮'];
const ROLE_ICONS = ['👤', '⭐', '🎖️', '👮', '🚓', '🚔', '🛡️', '🚦', '🚑', '🚒', '🔧', '🕵️', '💼', '⚖️', '🏛️', '🚕', '🎩', '🪖', '🧑‍⚕️', '🧑‍🚒', '📡'];
const ACT_ICONS = { voce: 'mic', privata: 'private', chiamata: 'phone', centrale: 'broadcast', sos: 'siren', comunicato: 'megaphone', richiesta: 'chat', accesso: 'user', admin: 'shield' };

export function initAdmin(R) {
  const panel = document.getElementById('adminPanel');
  let data = null;
  let tab = null;
  let isOpen = false;
  let loading = false;
  let filter = '';
  let pollTimer = 0;

  const perms = () => R.state.perms || {};
  const later = (fn) => setTimeout(fn, 60);

  function iconPicker(inp, icons) {
    const row = el('div', 'emoji-row');
    for (const ic of icons) {
      const b = el('button', 'emoji', ic);
      b.type = 'button';
      b.onclick = () => {
        inp.value = ic;
      };
      row.append(b);
    }
    return row;
  }
  function badge(text, cls, ico) {
    const b = el('span', 'badge ' + (cls || ''));
    if (ico) b.append(icon(ico));
    b.append(document.createTextNode(text));
    return b;
  }
  function genPassword() {
    const chars = 'abcdefghjkmnpqrstuvwxyz23456789';
    const a = new Uint32Array(8);
    crypto.getRandomValues(a);
    return Array.from(a, (x) => chars[x % chars.length]).join('');
  }
  function avatarOf(u) {
    const r = R.roleInfo(u.ruolo);
    const a = el('span', 'avatar');
    a.style.setProperty('--c', u.founder ? '#f2c230' : r.colore || '#9ca3af');
    a.append(u.founder ? icon('crown') : document.createTextNode(initials(u.nome)));
    return a;
  }

  // ---------------------------------------------------------------- struttura
  function tabs() {
    const p = perms();
    const t = [['panoramica', 'Panoramica', 'chart']];
    if (p.utenti) t.push(['utenti', 'Utenti', 'users']);
    if (p.canali) t.push(['canali', 'Canali', 'tower']);
    if (p.founder) t.push(['ruoli', 'Ruoli', 'star']);
    if (p.founder) t.push(['server', 'Server', 'server']);
    return t;
  }

  async function load() {
    loading = true;
    try {
      data = await R.request('state');
    } catch (e) {
      toast(e.message, { kind: 'bad', ms: 5000 });
    }
    loading = false;
    render();
  }

  function show() {
    const p = perms();
    if (!(p.founder || p.utenti || p.canali)) return toast('Non hai accesso al pannello', { kind: 'bad' });
    const t = tabs();
    if (!tab || !t.some((x) => x[0] === tab)) tab = t[0][0];
    isOpen = true;
    panel.hidden = false;
    render();
    load();
    clearInterval(pollTimer);
    pollTimer = setInterval(() => {
      if (isOpen && tab === 'panoramica' && !modal.isOpen()) load();
    }, 6000);
  }
  function hide() {
    isOpen = false;
    panel.hidden = true;
    clearInterval(pollTimer);
  }

  R.onAdminDirty = () => {
    if (isOpen) load();
  };
  R.onSession = () => {
    if (!isOpen) return;
    const p = perms();
    if (!(p.founder || p.utenti || p.canali)) return hide();
    if (!tabs().some((x) => x[0] === tab)) tab = tabs()[0][0];
    render();
  };
  R.admin = { show, hide, isOpen: () => isOpen };

  function render() {
    if (!isOpen) return;
    const oldBody = panel.querySelector('.adm-body');
    const scroll = oldBody ? oldBody.scrollTop : 0;
    const focusedSearch = document.activeElement && document.activeElement.classList.contains('adm-search');
    panel.textContent = '';

    const side = el('nav', 'adm-nav');
    const head = el('div', 'adm-brand');
    const lg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    lg.setAttribute('viewBox', '0 0 48 48');
    lg.setAttribute('class', 'adm-logo');
    const use = document.createElementNS('http://www.w3.org/2000/svg', 'use');
    use.setAttribute('href', '#logo');
    lg.append(use);
    const ht = el('div');
    ht.append(el('b', null, 'Pannello ' + (perms().founder ? 'Founder' : 'Staff')), el('small', null, R.state.serverName || ''));
    head.append(lg, ht);
    side.append(head);
    for (const [id, label, ico] of tabs()) {
      const b = el('button', 'adm-tab' + (id === tab ? ' on' : ''));
      b.type = 'button';
      b.append(icon(ico), el('span', null, label));
      b.onclick = () => {
        tab = id;
        filter = '';
        render();
      };
      side.append(b);
    }
    const close = button('Torna alla radio', 'btn-ghost adm-close', hide, 'radio');
    side.append(el('div', 'grow'), close);

    const body = el('div', 'adm-body');
    const top = el('div', 'adm-top');
    const title = (tabs().find((x) => x[0] === tab) || [])[1] || '';
    top.append(el('h2', null, title));
    const x = el('button', 'icon-btn');
    x.type = 'button';
    x.setAttribute('aria-label', 'Chiudi il pannello');
    x.append(icon('close'));
    x.onclick = hide;
    top.append(x);
    const inner = el('div', 'adm-inner');
    body.append(top, inner);
    panel.append(side, body);

    if (!data) {
      inner.append(el('p', 'muted', loading ? 'Caricamento…' : 'Impossibile caricare i dati.'));
      return;
    }
    if (data.storage && (data.storage.temporaneo || data.storage.errore)) inner.append(storageWarning(data.storage));
    ({ panoramica: renderOverview, utenti: renderUsers, canali: renderChannels, ruoli: renderRoles, server: renderServer }[tab] || renderOverview)(inner);
    body.scrollTop = scroll;
    if (focusedSearch) {
      const s = panel.querySelector('.adm-search');
      if (s) {
        s.focus();
        s.setSelectionRange(s.value.length, s.value.length);
      }
    }
  }

  function storageWarning(s) {
    const box = el('div', 'note note-bad adm-warn');
    if (s.temporaneo) {
      box.append(
        el('b', null, 'ATTENZIONE: i dati sono su un archivio TEMPORANEO.'),
        el('p', null, 'Al prossimo riavvio del server (Render lo fa spesso) utenti, ruoli e canali verranno CANCELLATI. Imposta subito la variabile GITHUB_TOKEN su Render: trovi i passaggi nella scheda Server.')
      );
    }
    if (s.errore) box.append(el('p', null, 'Ultimo salvataggio non riuscito: ' + s.errore));
    return box;
  }

  // ---------------------------------------------------------------- PANORAMICA
  function renderOverview(root) {
    const s = data.stats || {};
    const nums = el('div', 'adm-nums');
    const num = (value, label, ico, cls) => {
      const n = el('div', 'adm-num' + (cls ? ' ' + cls : ''));
      const t = el('div', 'adm-num-top');
      t.append(icon(ico), el('span', null, label));
      n.append(t, el('b', 'mono', String(value)));
      nums.append(n);
    };
    const online = data.online || [];
    num(online.length, 'online adesso', 'users', 'good');
    num(s.trasmissioni || 0, 'trasmissioni oggi', 'mic');
    num(fmtDur(s.secondi || 0), 'minuti in onda', 'clock');
    num(s.private || 0, 'chiamate private', 'private');
    num(s.chiamate || 0, 'chiamate alla Centrale', 'phone');
    num(s.sos || 0, 'SOS', 'siren', s.sos ? 'bad' : '');
    num(s.comunicati || 0, 'comunicati', 'megaphone');
    num(s.picco || 0, 'picco di persone', 'pulse');
    root.append(nums);

    const grid = el('div', 'adm-two');
    // canali dal vivo
    const chCard = el('section', 'adm-card');
    const h1 = el('h3');
    h1.append(icon('tower'), document.createTextNode('Canali dal vivo'));
    chCard.append(h1);
    const max = Math.max(1, ...(data.panoramica || []).map((c) => c.utenti));
    for (const c of data.panoramica || []) {
      const row = el('div', 'adm-bar-row' + (c.attivo ? ' live' : ''));
      const name = el('span', 'adm-bar-name');
      name.append(el('span', null, c.icona), el('span', null, c.nome));
      const bar = el('span', 'adm-bar');
      const fill = el('i');
      fill.style.width = (c.utenti / max) * 100 + '%';
      bar.append(fill);
      const v = el('span', 'mono adm-bar-v', String(c.utenti));
      row.append(name, bar, v);
      row.title = `TG ${c.tg} · ${c.utenti} dentro · ${c.ascolto} in ascolto da fuori · ${c.vocali} vocali salvati${c.attivo ? ' · qualcuno sta parlando' : ''}`;
      chCard.append(row);
    }
    // online
    const onCard = el('section', 'adm-card');
    const h2 = el('h3');
    h2.append(icon('users'), document.createTextNode(`Online (${online.length})`));
    onCard.append(h2);
    if (!online.length) onCard.append(el('p', 'muted', 'Nessuno collegato adesso.'));
    for (const p of online.sort((a, b) => a.nome.localeCompare(b.nome, 'it'))) {
      const row = el('div', 'adm-person');
      const a = avatarOf(p);
      const st = el('span', 'st');
      st.style.setProperty('--st', statoInfo(p.stato).colore);
      a.append(st);
      const t = el('div', 'grow');
      const ch = p.canale && (data.panoramica || []).find((c) => c.id === p.canale);
      t.append(el('b', null, displayName(p)), el('small', null, `${R.roleInfo(p.ruolo).nome} · ${ch ? ch.icona + ' ' + ch.nome : 'canale riservato'}${p.dispositivi > 1 ? ` · ${p.dispositivi} dispositivi` : ''}`));
      row.append(a, t, statusPill(p.stato));
      onCard.append(row);
    }
    grid.append(chCard, onCard);
    root.append(grid);

    if (data.activity) {
      const ac = el('section', 'adm-card');
      const h3 = el('h3');
      h3.append(icon('history'), document.createTextNode('Registro attività'), el('small', 'muted', 'solo il Founder lo vede · si azzera al riavvio'));
      ac.append(h3);
      const list = el('div', 'adm-log');
      if (!data.activity.length) list.append(el('p', 'muted', 'Ancora niente da mostrare.'));
      for (const a of data.activity) {
        const row = el('div', 'adm-log-row t-' + a.tipo);
        row.append(el('time', 'mono', fmtTime(a.ts)), icon(ACT_ICONS[a.tipo] || 'info'), el('span', null, a.testo));
        list.append(row);
      }
      ac.append(list);
      root.append(ac);
    }
    root.append(el('p', 'muted small', `Statistiche del ${new Date().toLocaleDateString('it-IT')} · server acceso ${ago(data.avvio)}`));
  }

  // ---------------------------------------------------------------- UTENTI
  function renderUsers(root) {
    const bar = el('div', 'adm-bar-top');
    const search = input(filter, 'Cerca per nome, utente o ruolo…');
    search.classList.add('adm-search');
    const list = el('div', 'adm-list');
    search.oninput = () => {
      filter = search.value;
      fill();
    };
    bar.append(search, button('Nuovo utente', 'btn-primary', () => userForm(null), 'plus'));
    root.append(
      bar,
      el('p', 'muted small', perms().founder ? 'Come Founder puoi gestire tutti, anche lo Staff. Solo chi ha un account può entrare nella radio.' : 'Puoi gestire gli utenti con ruoli normali. Chi ha permessi di Staff lo gestisce solo il Founder.'),
      list
    );
    function fill() {
      list.textContent = '';
      const q = filter.trim().toLowerCase();
      const users = data.users
        .filter((u) => !q || [u.username, u.nome, u.sigla, R.roleInfo(u.ruolo).nome].join(' ').toLowerCase().includes(q))
        .sort((a, b) => b.founder - a.founder || b.online - a.online || a.nome.localeCompare(b.nome, 'it'));
      if (!users.length) list.append(el('p', 'muted', q ? 'Nessun utente trovato.' : 'Nessun utente: creane uno con «Nuovo utente».'));
      for (const u of users) list.append(userRow(u));
      list.append(el('p', 'muted small', `${data.users.length} account in totale · ${data.users.filter((u) => u.online).length} online adesso`));
    }
    fill();
  }

  function userRow(u) {
    const r = R.roleInfo(u.ruolo);
    const row = el('div', 'adm-row' + (u.attivo ? '' : ' off'));
    const main = el('div', 'adm-main');
    main.append(el('b', null, displayName(u) + (u.id === data.me ? ' (tu)' : '')), el('small', null, `@${u.username} · ${u.founder ? 'Founder' : r.nome}`));
    const st = !u.attivo ? badge('disattivato', 'red', 'ban') : u.online ? badge('online', 'green', 'status') : badge(ago(u.ultimoAccesso), '', 'clock');
    main.append(st);
    const actions = el('div', 'adm-actions');
    if (u.gestibile) actions.append(button('', 'btn-sm btn-icon', () => userForm(u), 'edit', 'Modifica'));
    if (u.gestibile === true) actions.append(button('', 'btn-sm btn-icon', () => resetPassword(u), 'key', 'Nuova password'));
    if (u.gestibile === true && !u.founder && u.id !== data.me) {
      actions.append(button('', 'btn-sm btn-icon', () => toggleUser(u), u.attivo ? 'ban' : 'check', u.attivo ? 'Disattiva' : 'Riattiva'));
      actions.append(button('', 'btn-sm btn-icon danger', () => deleteUser(u), 'trash', 'Elimina'));
    }
    row.append(avatarOf(u), main, actions);
    return row;
  }

  function roleSelect(current, disabled) {
    const sel = el('select', 'input');
    const roles = data.roles.filter((r) => r.assegnabile || r.id === current);
    if (current === 'founder') {
      const o = el('option', null, '👑 Founder');
      o.value = 'founder';
      sel.append(o);
    }
    for (const r of roles) {
      const p = r.permessi || {};
      const extra = p.utenti || p.canali || p.tuttiCanali || p.diramazione ? ' (con permessi)' : '';
      const o = el('option', null, `${r.icona} ${r.nome}${extra}`);
      o.value = r.id;
      sel.append(o);
    }
    if (current) sel.value = current;
    sel.disabled = !!disabled;
    return sel;
  }

  function userForm(u) {
    const isNew = !u;
    const username = input(isNew ? '' : u.username, 'es. mario.rossi');
    username.autocapitalize = 'none';
    username.spellcheck = false;
    if (!isNew) username.disabled = true;
    const password = input(isNew ? genPassword() : '', 'almeno 6 caratteri');
    const nome = input(isNew ? '' : u.nome, 'es. Mario Rossi');
    nome.maxLength = 24;
    const sigla = input(isNew ? '' : u.sigla, 'es. Volante 12');
    sigla.maxLength = 16;
    const lockRole = !isNew && (u.founder || u.gestibile === 'self');
    const ruolo = roleSelect(isNew ? (data.roles.find((r) => r.assegnabile) || {}).id : u.ruolo, lockRole);

    const f = el('div', 'form-grid');
    f.append(field('Nome utente (per entrare)', username, isNew ? 'Minuscolo, senza spazi. Non si potrà cambiare.' : 'Non modificabile'));
    if (isNew) {
      const pw = el('div', 'inline');
      pw.append(password, button('', 'btn-icon', () => (password.value = genPassword()), 'dice', 'Genera password'));
      f.append(field('Password', pw, "Comunicala all'utente: potrà cambiarla dalle Impostazioni."));
    }
    const two = el('div', 'row-2');
    two.append(field('Nome RP', nome), field('Sigla / nominativo (facoltativo)', sigla));
    f.append(two);
    f.append(field('Ruolo', ruolo, lockRole ? 'Non puoi cambiare il ruolo di questo account.' : perms().founder ? 'I ruoli "(con permessi)" danno poteri speciali (gestione, Centrale…).' : 'Puoi assegnare solo ruoli senza permessi speciali.'));
    if (!ruolo.options.length) f.append(el('p', 'note note-warn', 'Non ci sono ruoli assegnabili: chiedi al Founder di crearne uno.'));

    modal.open({
      title: isNew ? 'Nuovo utente' : 'Modifica ' + displayName(u),
      icon: isNew ? 'plus' : 'edit',
      body: f,
      actions: [
        { label: 'Annulla' },
        {
          label: isNew ? 'Crea utente' : 'Salva',
          cls: 'btn-primary',
          primary: true,
          onClick: async () => {
            if (isNew) {
              const un = username.value.trim().toLowerCase();
              await R.request('user_create', { username: un, password: password.value, nome: nome.value, sigla: sigla.value, ruolo: ruolo.value });
              later(() => showCredentials(un, password.value, nome.value.trim()));
            } else {
              const payload = { id: u.id, nome: nome.value, sigla: sigla.value };
              if (!ruolo.disabled) payload.ruolo = ruolo.value;
              await R.request('user_update', payload);
              toast('Utente aggiornato', { kind: 'ok' });
            }
            load();
          },
        },
      ],
    });
  }

  function showCredentials(username, password, nome) {
    const text = `📻 Radio Ufficiale · ${R.state.serverName || 'Udine RP'}\nLink: ${location.origin}\nUtente: ${username}\nPassword: ${password}`;
    const box = el('div', 'stack');
    box.append(el('p', null, `Manda questi dati a ${nome || username} (in privato, es. su Discord):`), el('pre', 'cred', text));
    modal.open({
      title: 'Account pronto',
      icon: 'check',
      body: box,
      actions: [
        {
          label: 'Copia',
          icon: 'copy',
          onClick: async () => {
            toast((await copyText(text)) ? 'Copiato! Incollalo in un messaggio privato' : 'Copia non riuscita: selezionalo a mano', { icon: 'copy' });
            return false;
          },
        },
        { label: 'Fatto', cls: 'btn-primary', primary: true },
      ],
    });
  }

  function resetPassword(u) {
    const pw = input(genPassword(), 'almeno 6 caratteri');
    const box = el('div', 'stack');
    const row = el('div', 'inline');
    row.append(pw, button('', 'btn-icon', () => (pw.value = genPassword()), 'dice', 'Genera'));
    box.append(el('p', 'muted', `La vecchia password di ${displayName(u)} smetterà di funzionare e verrà disconnesso da tutti i dispositivi.`), row);
    modal.open({
      title: 'Nuova password',
      icon: 'key',
      body: box,
      actions: [
        { label: 'Annulla' },
        {
          label: 'Cambia password',
          cls: 'btn-primary',
          primary: true,
          onClick: async () => {
            const r = await R.request('user_password', { id: u.id, password: pw.value });
            if (r.token) R.setToken(r.token);
            later(() => showCredentials(u.username, pw.value, u.nome));
            load();
          },
        },
      ],
    });
  }

  function toggleUser(u) {
    const go = async () => {
      await R.request('user_update', { id: u.id, attivo: !u.attivo });
      toast(u.attivo ? 'Utente disattivato' : 'Utente riattivato', { kind: u.attivo ? 'bad' : 'ok' });
      load();
    };
    if (u.attivo) confirmBox('Disattiva utente', `${displayName(u)} verrà disconnesso subito e non potrà più entrare finché non lo riattivi.`, 'Disattiva', 'btn-danger', go, 'ban');
    else go().catch((e) => toast(e.message, { kind: 'bad', ms: 5000 }));
  }

  function deleteUser(u) {
    confirmBox('Elimina utente', `Eliminare per sempre l'account @${u.username} (${displayName(u)})? Verrà disconnesso subito.`, 'Elimina', 'btn-danger', async () => {
      await R.request('user_delete', { id: u.id });
      toast('Utente eliminato', { kind: 'ok' });
      load();
    }, 'trash');
  }

  // ---------------------------------------------------------------- CANALI
  function renderChannels(root) {
    const bar = el('div', 'adm-bar-top');
    bar.append(el('p', 'muted small grow', "L'ordine qui sotto è lo stesso della radio (numero CH). Il numero TG resta fisso."), button('Nuovo canale', 'btn-primary', () => channelForm(null), 'plus'));
    root.append(bar);
    const list = el('div', 'adm-list');
    data.channels.forEach((c, i) => {
      const row = el('div', 'adm-row');
      const main = el('div', 'adm-main');
      const nm = el('b');
      nm.append(el('span', 'mono adm-tg', `CH ${String(i + 1).padStart(2, '0')} · TG ${c.tg}`), document.createTextNode(c.nome));
      main.append(nm, el('small', null, c.descrizione || '—'));
      const badges = el('div', 'badges');
      if (c.password) badges.append(badge('password: ' + c.password, 'gold', 'lock'));
      if (c.ruoli.length) badges.append(badge('solo: ' + c.ruoli.map((id) => R.roleInfo(id).nome).join(', '), 'blue', 'users'));
      if (c.riceveSos) badges.append(badge('Centrale: SOS e chiamate da tutti', 'red', 'siren'));
      if (c.eco) badges.append(badge('canale eco', 'blue', 'repeat'));
      badges.append(badge(`${c.utenti} dentro`, '', 'user'));
      main.append(badges);
      const actions = el('div', 'adm-actions');
      const up = button('', 'btn-sm btn-icon', () => move(c, -1), 'up', 'Sposta su');
      up.disabled = i === 0;
      const down = button('', 'btn-sm btn-icon', () => move(c, 1), 'down', 'Sposta giù');
      down.disabled = i === data.channels.length - 1;
      actions.append(up, down, button('', 'btn-sm btn-icon', () => channelForm(c), 'edit', 'Modifica'), button('', 'btn-sm btn-icon danger', () => deleteChannel(c), 'trash', 'Elimina'));
      row.append(el('span', 'big-ic', c.icona), main, actions);
      list.append(row);
    });
    root.append(list);
  }

  async function move(c, dir) {
    try {
      await R.request('channel_move', { id: c.id, dir });
      load();
    } catch (e) {
      toast(e.message, { kind: 'bad', ms: 5000 });
    }
  }

  function channelForm(c) {
    const isNew = !c;
    const nome = input(isNew ? '' : c.nome, 'es. Polizia di Stato');
    nome.maxLength = 40;
    const icona = input(isNew ? '📻' : c.icona, '📻');
    icona.classList.add('icon-input');
    const desc = input(isNew ? '' : c.descrizione, 'es. Questura di Udine');
    desc.maxLength = 80;
    const pass = input(isNew ? '' : c.password, 'vuota = nessuna password');
    const sos = checkbox(
      'Centrale: riceve SOS, chiamate e richieste da TUTTI i canali',
      isNew ? false : c.riceveSos,
      'Chi è in questo canale sente ogni SOS e risponde alle chiamate «Parla con la Centrale» fatte da qualsiasi canale. Il nome di questo canale è anche la firma dei comunicati.'
    );
    const eco = checkbox('Canale eco (prova audio)', isNew ? false : c.eco, 'Chi parla qui si risente subito dopo: serve per provare microfono e casse.');
    const roleBox = el('div', 'check-grid');
    const chosen = new Set(isNew ? [] : c.ruoli);
    for (const r of data.roles) {
      const ck = checkbox(`${r.icona} ${r.nome}`, chosen.has(r.id));
      ck.dataset.id = r.id;
      roleBox.append(ck);
    }
    const f = el('div', 'form-grid');
    const icRow = el('div', 'stack');
    icRow.append(icona, iconPicker(icona, CH_ICONS));
    f.append(
      field('Nome del canale', nome),
      field('Icona', icRow),
      field('Descrizione (facoltativa)', desc),
      field('Password del canale', pass, 'Chi non ha "accesso a tutti i canali" dovrà scriverla per entrare. Vuota = canale libero.'),
      field('Chi può vedere ed entrare', roleBox, 'Nessuno spuntato = tutti. Il Founder e i ruoli con "accesso a tutti i canali" entrano sempre.'),
      sos,
      eco
    );
    modal.open({
      title: isNew ? 'Nuovo canale' : 'Modifica ' + c.nome,
      icon: isNew ? 'plus' : 'edit',
      body: f,
      wide: true,
      actions: [
        { label: 'Annulla' },
        {
          label: isNew ? 'Crea canale' : 'Salva',
          cls: 'btn-primary',
          primary: true,
          onClick: async () => {
            const ruoli = [...roleBox.querySelectorAll('.chk')].filter((x) => x.cb.checked).map((x) => x.dataset.id);
            await R.request('channel_save', { id: isNew ? undefined : c.id, nome: nome.value, icona: icona.value, descrizione: desc.value, password: pass.value, ruoli, riceveSos: sos.cb.checked, eco: eco.cb.checked });
            toast(isNew ? 'Canale creato' : 'Canale aggiornato', { kind: 'ok' });
            load();
          },
        },
      ],
    });
  }

  function deleteChannel(c) {
    confirmBox('Elimina canale', `Eliminare il canale ${c.icona} ${c.nome}? Chi è dentro verrà spostato in un altro canale.`, 'Elimina', 'btn-danger', async () => {
      await R.request('channel_delete', { id: c.id });
      toast('Canale eliminato', { kind: 'ok' });
      load();
    }, 'trash');
  }

  // ---------------------------------------------------------------- RUOLI (solo Founder)
  function permBadges(p) {
    const w = el('div', 'badges');
    if (p.utenti) w.append(badge('gestisce utenti', 'gold', 'users'));
    if (p.canali) w.append(badge('gestisce canali', 'gold', 'tower'));
    if (p.tuttiCanali) w.append(badge('tutti i canali', 'blue', 'lock'));
    if (p.diramazione) w.append(badge('Centrale: più canali e comunicati', 'blue', 'broadcast'));
    if (!p.utenti && !p.canali && !p.tuttiCanali && !p.diramazione) w.append(badge('nessun permesso speciale'));
    return w;
  }

  function renderRoles(root) {
    const bar = el('div', 'adm-bar-top');
    bar.append(
      el('p', 'muted small grow', 'Solo tu, Founder, puoi creare ruoli (es. Comandante, Vice, Staff, Operatore Centrale) e decidere cosa possono fare. I ruoli con permessi speciali li assegni solo tu.'),
      button('Nuovo ruolo', 'btn-primary', () => roleForm(null), 'plus')
    );
    root.append(bar);
    const list = el('div', 'adm-list');
    const fr = el('div', 'adm-row fixed');
    const fmain = el('div', 'adm-main');
    fmain.append(el('b', null, 'Founder'), el('small', null, 'Tu. Può fare tutto. Non modificabile.'));
    fmain.append(permBadges({ utenti: true, canali: true, tuttiCanali: true, diramazione: true }));
    fr.append(el('span', 'big-ic', '👑'), fmain);
    list.append(fr);
    for (const r of data.roles) {
      const row = el('div', 'adm-row');
      const ic = el('span', 'big-ic role-ic', r.icona);
      ic.style.borderColor = r.colore;
      const main = el('div', 'adm-main');
      const name = el('b', null, r.nome);
      name.style.color = r.colore;
      main.append(name, el('small', null, `${r.utenti} ${r.utenti === 1 ? 'utente' : 'utenti'}`), permBadges(r.permessi));
      const actions = el('div', 'adm-actions');
      actions.append(button('', 'btn-sm btn-icon', () => roleForm(r), 'edit', 'Modifica'), button('', 'btn-sm btn-icon danger', () => deleteRole(r), 'trash', 'Elimina'));
      row.append(ic, main, actions);
      list.append(row);
    }
    root.append(list);
  }

  function roleForm(r) {
    const isNew = !r;
    const nome = input(isNew ? '' : r.nome, 'es. Comandante');
    nome.maxLength = 30;
    const icona = input(isNew ? '🎖️' : r.icona, '🎖️');
    icona.classList.add('icon-input');
    const colore = input(isNew ? '#f59e0b' : r.colore, '', 'color');
    const p = (r && r.permessi) || {};
    const pu = checkbox('Gestire gli utenti', p.utenti, 'Creare account, dare nuove password, disattivare ed eliminare utenti (solo quelli senza permessi di Staff).');
    const pc = checkbox('Gestire i canali', p.canali, 'Aggiungere e togliere radio, cambiare le password dei canali e chi può entrare.');
    const pt = checkbox('Accesso a tutti i canali', p.tuttiCanali, 'Vede ed entra in ogni canale, anche protetti, senza password.');
    const pd = checkbox('Centrale operativa', p.diramazione, 'Per chi gestisce emergenze e notizie: console con tutti i canali, parla a più canali insieme (con priorità), sente le risposte e manda comunicati / allerte / emergenze.');
    const f = el('div', 'form-grid');
    const icRow = el('div', 'stack');
    icRow.append(icona, iconPicker(icona, ROLE_ICONS));
    const permBox = el('div', 'stack');
    permBox.append(pd, pu, pc, pt);
    const two = el('div', 'row-2');
    two.append(field('Nome del ruolo', nome), field('Colore', colore));
    f.append(two, field('Icona', icRow), field('Permessi', permBox, 'Senza permessi = utente normale della radio.'));
    modal.open({
      title: isNew ? 'Nuovo ruolo' : 'Modifica ruolo ' + r.nome,
      icon: 'star',
      body: f,
      wide: true,
      actions: [
        { label: 'Annulla' },
        {
          label: isNew ? 'Crea ruolo' : 'Salva',
          cls: 'btn-primary',
          primary: true,
          onClick: async () => {
            await R.request('role_save', {
              id: isNew ? undefined : r.id,
              nome: nome.value,
              icona: icona.value,
              colore: colore.value,
              permessi: { utenti: pu.cb.checked, canali: pc.cb.checked, tuttiCanali: pt.cb.checked, diramazione: pd.cb.checked },
            });
            toast(isNew ? 'Ruolo creato' : 'Ruolo aggiornato', { kind: 'ok' });
            load();
          },
        },
      ],
    });
  }

  function deleteRole(r) {
    confirmBox('Elimina ruolo', `Eliminare il ruolo ${r.icona} ${r.nome}?`, 'Elimina', 'btn-danger', async () => {
      await R.request('role_delete', { id: r.id });
      toast('Ruolo eliminato', { kind: 'ok' });
      load();
    }, 'trash');
  }

  // ---------------------------------------------------------------- SERVER (solo Founder)
  function renderServer(root) {
    const s = data.settings || {};
    const nome = input(s.nomeServer, 'Udine RP ITA');
    nome.maxLength = 40;
    const durata = input(s.durataMassimaTrasmissione, '60', 'number');
    durata.min = '5';
    durata.max = '300';
    const vocali = input(s.messaggiVocaliSalvati, '20', 'number');
    vocali.min = '0';
    vocali.max = '50';

    const card = el('section', 'adm-card');
    const h = el('h3');
    h.append(icon('sliders'), document.createTextNode('Impostazioni'));
    card.append(h);
    const f = el('div', 'form-grid');
    f.append(
      field('Nome del server', nome),
      field('Durata massima di una trasmissione (secondi)', durata, 'Da 5 a 300. Dopo questo tempo la trasmissione si chiude da sola.'),
      field('Vocali salvati per canale', vocali, 'Quanti messaggi vocali si possono riascoltare (0 = nessuno). Si cancellano al riavvio del server.')
    );
    const save = button('Salva impostazioni', 'btn-primary', null, 'check');
    save.onclick = async () => {
      save.disabled = true;
      try {
        await R.request('settings_save', { nomeServer: nome.value, durataMassimaTrasmissione: durata.value, messaggiVocaliSalvati: vocali.value });
        toast('Impostazioni salvate', { kind: 'ok' });
        load();
      } catch (e) {
        toast(e.message, { kind: 'bad', ms: 5000 });
      } finally {
        save.disabled = false;
      }
    };
    card.append(f, el('div', 'adm-card-actions'));
    card.lastChild.append(save);
    root.append(card);

    const st = data.storage || {};
    const arch = el('section', 'adm-card');
    const h2 = el('h3');
    h2.append(icon('server'), document.createTextNode('Archivio dati (account, ruoli, canali)'));
    arch.append(h2);
    arch.append(
      el('p', st.temporaneo ? 'note note-bad' : 'note note-good', st.descrizione || '—'),
      el('p', 'muted small', st.ultimoSalvataggio ? 'Ultimo salvataggio: ' + new Date(st.ultimoSalvataggio).toLocaleString('it-IT') : 'Nessun salvataggio ancora.')
    );
    if (st.errore) arch.append(el('p', 'note note-bad', st.errore));
    if (st.temporaneo) {
      const steps = el('ol', 'steps');
      for (const t of [
        'Su github.com clicca sulla tua foto → Settings → Developer settings → Personal access tokens → Tokens (classic).',
        'Clicca «Generate new token (classic)». Nota: radio. Scadenza: No expiration. Spunta SOLO la casella «gist». Poi «Generate token».',
        'Copia il codice che inizia con ghp_ (si vede una volta sola!).',
        'Su render.com apri il servizio della radio → Environment → Add Environment Variable: chiave GITHUB_TOKEN, valore = il codice copiato → Save Changes.',
        'Render riavvia la radio. Se ti chiede di nuovo il Founder, rifallo: da quel momento i dati restano salvati per sempre.',
      ]) steps.append(el('li', null, t));
      arch.append(el('p', null, 'Per salvare i dati in modo permanente (gratis):'), steps);
    }
    const actions = el('div', 'adm-card-actions');
    actions.append(
      button('Scarica backup', '', async () => {
        try {
          const r = await R.request('export');
          saveFile(`backup-radio-ufficiale-${new Date().toISOString().slice(0, 10)}.json`, new Blob([JSON.stringify(r.data, null, 1)], { type: 'application/json' }));
        } catch (e) {
          toast(e.message, { kind: 'bad', ms: 5000 });
        }
      }, 'download'),
      button('Ripristina un backup…', '', () => importForm(), 'upload')
    );
    arch.append(actions, el('p', 'muted small', 'Il backup contiene tutti i dati (le password sono cifrate). Tienilo al sicuro e non condividerlo. Puoi ripristinare anche il backup scaricato dalla radio vecchia (Zello).'));
    root.append(arch);
  }

  function importForm() {
    const file = el('input', 'input');
    file.type = 'file';
    file.accept = '.json,application/json';
    const box = el('div', 'stack');
    box.append(
      el('p', 'note note-warn', 'Il ripristino SOSTITUISCE utenti, ruoli, canali e impostazioni di questa radio con quelli del backup. Tutti vengono disconnessi e rientrano con le password del backup (anche tu).'),
      field('File di backup (.json)', file, 'Va bene anche il backup della radio vecchia: account e password restano gli stessi.')
    );
    modal.open({
      title: 'Ripristina un backup',
      icon: 'upload',
      body: box,
      actions: [
        { label: 'Annulla' },
        {
          label: 'Ripristina',
          cls: 'btn-danger',
          primary: true,
          icon: 'upload',
          onClick: async () => {
            const f = file.files && file.files[0];
            if (!f) throw new Error('Scegli il file di backup');
            if (f.size > 5 * 1024 * 1024) throw new Error('File troppo grande (massimo 5 MB)');
            const text = await f.text();
            const res = await fetch(`/api/import?k=${encodeURIComponent(R.state.key)}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: text });
            const r = await res.json().catch(() => ({}));
            if (!res.ok || !r.ok) throw new Error(r.errore || 'Ripristino non riuscito');
            toast(`Backup ripristinato: ${r.utenti} utenti, ${r.canali} canali, ${r.ruoli} ruoli. Rientra con il tuo account del backup.`, { kind: 'ok', ms: 8000 });
          },
        },
      ],
    });
  }
}
