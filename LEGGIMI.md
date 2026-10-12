# 📻 Radio Ufficiale · Udine RP ITA

La radio push-to-talk della community **Udine RP ITA**, ricostruita da zero come una vera radio TETRA:

- **Una radio vera sullo schermo**: antenna, manopola dei canali che gira (trascinala o usa la rotella del mouse), tasto emergenza arancione, LED, PTT laterale, tasti volume, tastierino con i toni DTMF e display LCD a segmenti che scorre come sulle radio vere
- **Il display cambia colore**: ambra a riposo, **verde** quando qualcuno parla, **rosso** quando parli tu, **azzurro** quando parla la Centrale, **viola** nelle chiamate private, lampeggia rosso/arancio con un SOS
- **Suono da radio**: filtro, fruscio, coda dello squelch e il "brrrp" Motorola MDC-1200 (oppure suono digitale TETRA, o classico)
- **Accensione cinematografica**: nella schermata d'accesso c'è una radio 3D e lo spettro radio che scorre; all'accesso la radio fa autotest e si registra in rete
- Tutto quello che c'era già: **parli in diretta**, account creati dallo Staff, **ruoli e permessi**, **SOS** con sirena e voce, **Centrale operativa**, **Parla con la Centrale**, richieste scritte, canale **eco**, **tasto PTT per Windows** anche in gioco, app installabile sul telefono

### Le novità

| Novità | Cosa fa |
|---|---|
| 🖥️ **Console della Centrale** | Una plancia con tutti i canali: vedi chi parla dove, colleghi i canali con un tocco, hai la coda di chiamate, richieste e SOS con «Rispondi» e «Presa in carico» |
| 🔒 **Chiamate e messaggi privati** | Dalla Rubrica tocca una persona: parli o scrivi **solo a lei**. Le fazioni solo dentro il proprio canale; dalla Centrale e dallo Staff a chiunque. Chi riceve può rispondere subito |
| 👥 **Rubrica** | Chi è online adesso, in quale canale e con quale stato (i canali riservati non vengono rivelati) |
| 🟢 **Stato operativo** | Disponibile, In servizio, In intervento, Occupato, In pausa, Fuori servizio: tutti lo vedono, la Centrale per prima |
| 📡 **Scansione** | Ascolti anche altri canali senza entrarci (tasto SCAN o ✱). Se parla qualcuno nel tuo canale, ha la precedenza |
| 🔢 **Numeri dei canali** | Ogni canale ha CH (posizione) e TG (numero fisso). Sul tastierino componi `03` o `2003` per andarci |
| 〰️ **Forma d'onda vera** | I vocali nel registro mostrano la vera forma d'onda e mentre li riascolti la vedi avanzare |
| 📶 **Segnale reale** | Le tacche del segnale e i millisecondi mostrano il vero ritardo verso il server |
| 📊 **Panoramica per lo Staff** | Statistiche del giorno, canali dal vivo, chi è online; il Founder vede anche il registro attività (chi ha fatto cosa, anche i comunicati) |
| ♻️ **Ripristino backup** | Il Founder può caricare un backup, **anche quello della radio vecchia**: account e password restano uguali |
| 🎨 **Personalizzazione** | 6 colori della scocca (nero, titanio, blu Polizia, rosso VVF, giallo soccorso, verde) e 4 colori del display |

---

## 1. Chi può fare cosa

| | Founder 👑 | Ruolo con permessi (es. Staff) | Utente normale |
|---|:-:|:-:|:-:|
| Parlare, ascoltare, chat, SOS, stato, scansione nel proprio canale | ✅ | ✅ | ✅ |
| Messaggi vocali e richieste alla Centrale («Parla con la Centrale») | ✅ | ✅ | ✅ |
| Creare account, cambiare password, disattivare o eliminare utenti normali | ✅ | ✅ se ha «Gestire gli utenti» | ❌ |
| Aggiungere o togliere canali, password dei canali | ✅ | ✅ se ha «Gestire i canali» | ❌ |
| Decidere con quali radio parla un canale | ✅ | ❌ | ❌ |
| Entrare in tutti i canali senza password | ✅ | ✅ se ha «Accesso a tutti i canali» | ❌ |
| 📡 Centrale: console, priorità, comunicati (dal canale Centrale o Staff) | ✅ | ✅ se ha «Centrale operativa» | ❌ |
| Panoramica (statistiche, chi è online) | ✅ | ✅ (chi apre il pannello) | ❌ |
| Registro attività, ruoli, impostazioni, backup e ripristino | ✅ | ❌ | ❌ |

Il Founder è uno solo e si crea alla prima accensione con il **codice di installazione**.

### Le fazioni parlano solo nel proprio canale

Chi è in una fazione (CC, Polizia, GdF, Polizia Locale, 118, VVF, Soccorso Stradale…) **non può mandare niente alle radio degli altri**: niente trasmissioni su più canali, niente comunicati, niente chiamate o messaggi privati a chi è in un altro canale.
Per dire cosa gli serve o cosa sta succedendo usa la **Centrale**: tiene premuto **📞 Parla con la Centrale** (messaggio vocale, resta registrato anche se in Centrale non c'è nessuno), oppure manda una **Richiesta** scritta o un **SOS**.

Alle altre radio parlano **solo il canale della Centrale Operativa e il canale Staff**: lo decide il **canale**, non il ruolo. Anche il Founder, per parlare a tutti, entra nel canale della Centrale (la console ha il pulsante «Vai in Centrale Operativa 112»).
Chi ha il permesso «Centrale operativa» resta comunque in ascolto dei canali collegati e riceve le chiamate da qualsiasi canale.

**Abilitare altri canali (solo se vuoi):** 🛡️ → **Canali** → ✏️ sul canale → **Può parlare con le altre radio?**

- **Solo il suo canale**: come le fazioni (è la scelta di base per i canali nuovi)
- **Tutte le radio**: come la Centrale e lo Staff, anche verso i canali creati dopo
- **Solo alcune**: spunti tu con quali canali (es. Polizia ↔ 118)

Quello che si manda alle altre radio compare firmato con il **nome del canale** (es. *Centrale Operativa 112*, *Staff*), non con il nome della persona. Solo chi ha anche il permesso «Centrale operativa» ha la **priorità** (interrompe chi sta parlando) e manda i **comunicati**.

## 2. Mettere la radio su Render (link https fisso)

È un servizio **nuovo e separato** dalla radio vecchia: puoi tenerle accese tutte e due.

### 2a. Dove salvare gli account (gratis, una volta sola)

Su Render i file si cancellano a ogni riavvio, quindi gli account vanno in un **Gist privato** su GitHub.
Se hai già il token della radio vecchia **puoi riusare lo stesso**: la radio nuova salva in un file diverso (`radio-ufficiale-udine-rp-data.json`), le due radio non si toccano.

1. Su [github.com](https://github.com) clicca la tua foto → **Settings** → **Developer settings** → **Personal access tokens** → **Tokens (classic)**
2. **Generate new token (classic)**. Note: `radio`. Expiration: **No expiration**. Spunta **solo** la casella **gist**. Poi **Generate token**
3. Copia il codice che inizia con `ghp_` (si vede una volta sola!)

### 2b. Creare il servizio

1. Crea un repository nuovo su GitHub e caricaci (trascinandoli in **Add file → Upload files**) tutti i file e le cartelle di questa cartella **tranne** `node_modules`, `data` e `data-dev`
2. Su [render.com](https://render.com): **New** → **Blueprint** (usa il file `render.yaml`) oppure **Web Service** con Build `npm install --omit=dev` e Start `node server.js`
3. In **Environment** aggiungi:
   - `GITHUB_TOKEN` = il codice `ghp_…`
   - `SETUP_CODE` = un numero che scegli tu, es. `482913`
4. **Save Changes** e aspetta che il servizio sia acceso

### 2c. Creare il Founder

Apri il link della radio: compare **"Prima accensione"**. Scrivi il codice di installazione, il tuo nome utente, la password e il nome RP. Sei dentro come 👑 Founder.

> Nel pannello 🛡️ → **Server** vedi dove sono salvati i dati. Se c'è scritto **temporaneo**, il `GITHUB_TOKEN` manca o è sbagliato.

## 3. Portare gli account dalla radio vecchia

1. Nella radio **vecchia**: 🛡️ → **Server** → **⬇️ Scarica backup**
2. Nella radio **nuova** (dopo aver creato il Founder): 🛡️ → **Server** → **Ripristina un backup…** → scegli il file
3. Tutti vengono disconnessi e rientrano **con le stesse password di prima** (anche tu: usa il tuo account della radio vecchia)

Il ripristino sostituisce utenti, ruoli, canali e impostazioni. I codici del tasto PTT per Windows non vengono copiati (per sicurezza): chi lo usa lo riscarica dalle Impostazioni.

## 4. Usare la radio

| Cosa | Come |
|---|---|
| **Parlare** | Tieni premuto **PARLA** (o la barra **Spazio**, o il **PTT laterale** della radio). Rilascia per chiudere |
| **Cambiare canale** | Gira la **manopola** (trascina o rotella del mouse), tocca un canale nell'elenco, usa le frecce ‹ › sul display del telefono, oppure **componi il numero** sul tastierino (`03` = CH 03, `2003` = TG 2003) |
| **SOS** | Tieni premuto **SOS** (o il **tasto arancione** sopra la radio) per un secondo, scrivi dove sei e invia |
| **Stato operativo** | Tasto centrale della radio (**STATO**), tasto `#`, oppure il tuo avatar in alto a destra |
| **Scansione** | Tasto destro **SCAN** o `✱` sul tastierino. Scegli i canali in ⚙️ → Scansione |
| **Chiamata privata** | **Rubrica** → tocca la persona → **Chiamata privata** (poi tieni premuto PARLA) o **Messaggio privato** (solo chi è nel tuo canale, se sei in una fazione). Il tasto **FINE PR** la chiude |
| **Volume** | Tasti laterali della radio o ⚙️ → Volume |
| **Riascoltare un vocale** | ▶ nel registro: l'onda avanza mentre ascolti |

## 5. 📡 Centrale operativa

Il Founder ce l'ha già; agli altri dai il ruolo **📡 Operatore Centrale** (o spunta **Centrale operativa** in un ruolo tuo).

- Entra nel canale della **Centrale Operativa** (o dello Staff): solo da lì si parla alle altre radio
- Premi **Console Centrale** (o il tasto destro della radio): vedi tutti i canali con chi sta parlando
- Accendi **In servizio** e tocca i canali da collegare (o **Tutti**): tieni premuto e parli **a tutti i canali collegati insieme**, con **priorità** (interrompi chi sta parlando)
- **Ascolto**: senti anche le risposte dei canali collegati
- A destra c'è la **coda**: chiamate «Parla con la Centrale», richieste scritte e SOS. **Rispondi** prepara la risposta solo a quel canale; **Presa in carico** avvisa chi ha chiesto
- **Comunicato**: Notizia (avviso e voce), Allerta (schermata arancione, voce due volte), Emergenza (schermata rossa e **sirena** anche col muto). Compare anche come notizia che scorre in alto
- Tutto quello che manda la Centrale è firmato col nome del canale (es. *Centrale Operativa 112*), mai con il nome dell'operatore. Chi l'ha mandato davvero lo vede solo il Founder nel **registro attività**

**Per tutti gli altri**: in ogni canale c'è **📞 Parla con la Centrale** (tieni premuto) e **Richiesta** (scelte rapide: ambulanza, rinforzi, Vigili del Fuoco, carro attrezzi…).

## 6. Parlare anche dentro al gioco (Windows) 🎮

1. ⚙️ **Impostazioni** → **Tasto PTT anche in gioco** → **Scarica**
2. Apri `Radio-Ufficiale-Tasto-PTT.bat` (se Windows avvisa: **Ulteriori informazioni** → **Esegui comunque**)
3. Premi il tasto che vuoi usare (consigliato: un tasto laterale del mouse). Poi, se vuoi, un **secondo tasto** per parlare con la Centrale
4. Lascia aperte la finestra nera e la radio nel browser (anche ridotta a icona): tieni premuto il tasto in gioco e parli

Il file contiene il tuo codice personale: **non condividerlo**. È separato da quello della radio vecchia.

## 7. Usare la radio sul PC (senza Render)

Doppio clic su **`avvia.bat`**: si apre su `http://localhost:3000`. Alla prima accensione il codice di installazione è scritto nella finestra nera. I dati restano nella cartella `data`.
Per far entrare gli amici da fuori: una volta sola `winget install --id Cloudflare.cloudflared` in PowerShell, poi doppio clic su **`condividi-online.bat`** e manda il link `https://….trycloudflare.com`.

## 8. Installarla come app sul telefono

- **Android (Chrome)**: ⚙️ Impostazioni → **Installa**, oppure menu **⋮** → *Installa app*
- **iPhone (Safari)**: **Condividi** → **Aggiungi alla schermata Home**

## 9. Problemi comuni

- **"Parlo ma non sento niente"**: è normale, chi parla non sente sé stesso. Per provarti da solo entra in **🔁 Prova audio (eco)**
- **Il pulsante dice "ASCOLTO"**: il microfono non è attivo. Toccalo e segui le istruzioni (permesso del microfono o link non `https://`)
- **Non sento gli altri**: controlla **AUDIO** (non MUTO) e il volume. Se compare la barra *"Audio bloccato"* toccala
- **Il display mostra "NO RETE"**: connessione persa, la radio si ricollega da sola
- **Non vedo la Console**: serve il permesso *Centrale operativa*. Dopo un aggiornamento ricarica la pagina (F5)
- **La scansione non prende un canale**: i canali con password non si scansionano
- **Render ci mette tanto ad aprirsi**: nel piano gratis dopo 15 minuti senza nessuno "si addormenta"; il primo accesso può richiedere un minuto
- **Controllo automatico**: in questa cartella apri PowerShell e scrivi `npm test` (simula Founder, Staff, Centrale e utenti e verifica 127 cose)
- **Provare la grafica senza toccare i dati veri**: `npm run dev` apre una radio di prova su `http://localhost:3011` con account di prova (sono scritti in `test/dev.js`, valgono solo lì)
