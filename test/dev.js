'use strict';
/*
 * Server di prova per controllare la grafica nel browser (npm run dev).
 * Usa un archivio separato (cartella data-dev) con account di prova già pronti,
 * così i dati veri nella cartella "data" non vengono toccati.
 *
 * Account di prova (SOLO per data-dev, non usarli sul server vero):
 *   founder / prova123   ·   mario / prova123   ·   centrale / prova123
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DIR = path.join(__dirname, '..', 'data-dev');
const FILE = path.join(DIR, 'radio-data.json');
process.env.DATA_FILE = FILE;
process.env.PORT = process.env.PORT || '3011';
delete process.env.GITHUB_TOKEN;
delete process.env.RENDER;

function hash(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  return { salt, hash: crypto.scryptSync(password, salt, 32).toString('hex') };
}

if (!fs.existsSync(FILE)) {
  const config = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'config.json'), 'utf8'));
  const rid = (n) => crypto.randomBytes(n).toString('hex');
  const NO = { utenti: false, canali: false, tuttiCanali: false, diramazione: false };
  const roles = config.reparti.map((r) => ({ id: 'r' + rid(4), nome: r.nome, icona: r.icona, colore: r.colore, permessi: { ...NO } }));
  const staff = roles.find((r) => r.nome === 'Staff');
  staff.permessi = { utenti: true, canali: true, tuttiCanali: true, diramazione: true };
  const cen = { id: 'r' + rid(4), nome: 'Operatore Centrale', icona: '📡', colore: '#38bdf8', permessi: { ...NO, diramazione: true } };
  roles.push(cen);
  const pol = roles.find((r) => r.nome === 'Polizia di Stato');
  const channels = config.canali.map((c, i) => ({
    id: c.id, tg: 2001 + i, nome: c.nome, icona: c.icona, descrizione: c.descrizione, password: c.password || '',
    ruoli: c.soloStaff ? [staff.id] : [], riceveSos: !!c.riceveSos, eco: !!c.eco,
  }));
  const user = (username, nome, sigla, ruolo, extra) => ({ id: rid(4), username, nome, sigla, ruolo, attivo: true, tv: 1, stato: 'disponibile', creato: Date.now(), creatoDa: 'prova', ...hash('prova123'), ...(extra || {}) });
  const data = {
    version: 4,
    secret: rid(32),
    settings: { nomeServer: 'Udine RP ITA', durataMassimaTrasmissione: 60, messaggiVocaliSalvati: 20 },
    roles,
    users: [
      user('founder', 'Matteo Rossi', 'Centrale 1', 'founder', { founder: true }),
      user('mario', 'Mario Bianchi', 'Volante 12', pol.id),
      user('centrale', 'Sara Gialli', 'Centrale 2', cen.id),
      user('luca', 'Luca Verdi', 'Alfa 3', pol.id),
    ],
    channels,
  };
  fs.mkdirSync(DIR, { recursive: true });
  fs.writeFileSync(FILE, JSON.stringify(data, null, 1));
  console.log('Creato archivio di prova in', FILE);
}

require('../server.js');
