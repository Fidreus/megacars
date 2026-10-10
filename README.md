# Megacars

Retro top-down combat racer for the browser, inspired by the Amiga classic
Super Cars II. 3D rendered at a low internal resolution (~360 lines) with a
pixel-snapped camera, toon-shaded world, glossy cars, hard shadows, bloom and
optional Amiga colour modes/CRT; arcade drift physics where full-speed corners
are taken sideways.

## Kom igång

```bash
npm install
npm run dev        # Vite (http://localhost:5173) + spelserver (ws på 8787)
npm test           # fysik-, ban- och driftbenchmarktester
npm run typecheck
npm run build && npm start   # produktion: en server för spel + WebSocket på $PORT
```

## Spela

Titelmenyn styrs med piltangenter/WASD + Enter, handkontroll eller mus:
starta lopp, 1–2 spelare (delad skärm), bana, antal varv, motståndare,
svårighetsgrad, tid på dygnet, eller fri träning. Loppet startar med fem
röda startljus – när de släcks är det fullt ös. Efter målgång visas
resultatlistan.

På asfalt greppar bilen tills gränsen och understyr sedan – den sladdar inte
av sig själv. Driften startar du genom att **släppa gasen kort (under 0,3 s)
och trycka igen** medan du styr in i kurvan – eller genom att dutta på bromsen
(under 0,25 s) medan du styr. Längre rullning eller vanlig inbromsning startar
ingen drift. I sladden orkar däcken mycket mer sidokraft, så rätt timing tar
dig genom skarpa kurvor mycket fortare. Gas ökar sladdvinkeln, släpp gasen
eller motstyr för att räta upp. Is, olja och snö sladdar av sig själva.

| En spelare | Funktion |
|---|---|
| ↑ / W | Gas (släpp + tryck igen medan du styr = drift) |
| ↓ / S | Broms / back |
| ← → / A D | Styr |
| R | Sätt tillbaka bilen på banan (P2 i delad skärm: Enter) |
| Esc / P | Paus |

Delad skärm: **P1** WASD (vapentangenter G/F/H kommer i M5), **P2**
piltangenter (. , -). Handkontroller: vänster spak styr, RT gas, LT broms;
handkontroll 1 = P1, handkontroll 2 = P2.

## Spela online

Välj **PLAY ONLINE** i titelmenyn, skriv ditt namn och välj **CREATE ROOM**.
Du får en rumskod på fyra bokstäver och en inbjudningslänk
(`https://…/?room=KODE`) – **COPY INVITE LINK** kopierar den. Kompisar skriver
in koden under **JOIN ROOM** eller öppnar länken. Upp till åtta personer per
rum; värden väljer bana, varv, antal datorbilar och svårighetsgrad, de andra
markerar sig som redo och värden startar. Efter målgång är alla tillbaka i
lobbyn för nästa lopp. Den som kommer in mitt i ett lopp tittar på tills nästa.

Servern räknar loppet (60 tick/s) och skickar läget 20 gånger i sekunden.
Din egen bil svarar direkt: klienten kör simuleringen några tick före servern
med dina knapptryck och spolar om från varje serverbild, så du hamnar exakt där
servern säger utan att känna fördröjningen. Datorbilarna förutsägs exakt
(samma deterministiska kod på båda sidor); andra människors bilar gissas utifrån
deras senaste kända inmatning och glider mjukt till rätta. Tappar du
anslutningen kör datorn din bil tills du är tillbaka (samma flik återansluter
automatiskt inom en minut).

`npm run soak -- --url ws://localhost:8787/ws --clients 3` kör huvudlösa botar
över riktiga WebSockets mot en körande server och rapporterar synkhälsa.

| Överallt | Funktion |
|---|---|
| M | Tid på dygnet: dag / solnedgång / natt |
| 3 | CRT: av / scanlines / full |
| 4 | Färger: full (standard) / 12-bit Amiga / 32 färger |
| 1 / 2 / 0 | Debugvy / telemetri / trimningspanel |

URL-parametrar: `?mode=quick` (direkt till lopp), `?mode=practice`, `?p2=1`,
`?laps=N`, `?ai=N` (motståndare), `?difficulty=0..2`,
`?mood=day|sunset|night`, `?debug=1`, `?scale=N`, `?scanlines=1`, `?mute=1`,
`?room=KODE` (gå direkt med i ett onlinerum).

`npm run sim -- --seeds 20 --laps 3` kör headless AI-lopp och kontrollerar
att alla bilar går i mål.

Felsökning i konsolen: `__megacars.state()`, `.startRace({ players: 2 })`,
`.advance(ticks)`, `.pause()`, `.autopilot()`, `.debug.crawlTest()`,
`.debug.bench()`, `.debug.look({ mood, palette, crt })`, `.debug.snap(namn)`,
`.online()` (anslutning, rum, förutsägelsens lead/takt).

## Struktur

- `src/shared` – simulering som körs identiskt på server och klient (fysik,
  banor, AI, protokoll). Ingen DOM, ingen Node.
- `src/client` – rendering (Three.js), ljud, inmatning, UI.
- `src/server` – Node-server: statiska filer + WebSocket (`/ws`), rum och
  lopp (`gameServer.ts`, `room.ts`).
- `src/shared/net` – protokoll, binära ögonblicksbilder, klientförutsägelse
  (`predictor.ts`) och klientens loppklocka (`netRace.ts`).
