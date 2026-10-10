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
av sig själv. Driften startar du enklast med **driftknappen** (Z, eller LB på
handkontrollen) medan du styr in i kurvan – håll den nere så håller bilen
sladden. Det går också att **släppa gasen kort (under 0,3 s) och trycka
igen** medan du styr in i kurvan – eller genom att dutta på bromsen
(under 0,25 s) medan du styr. Längre rullning eller vanlig inbromsning startar
ingen drift. I sladden orkar däcken mycket mer sidokraft, så rätt timing tar
dig genom skarpa kurvor mycket fortare. Gas ökar sladdvinkeln, släpp gasen
eller motstyr för att räta upp. Is, olja och snö sladdar av sig själva.

Fyra banor: **Green Valley** (bred landsbygdsbana), **Dust Bowl** (öken,
smal och teknisk, grus, oljefläckar och ett hopp över en torr flodfåra),
**Frost Ring** (vinter, snabba svep med is och packad snö) och **Meltdown
Ridge** (genom ett kärnkraftverk: kyltorn, reaktorhallar, en kylvattenläcka
och ett hopp över kylvattenkanalen – kommer du för kort får du vada ur).

**Ramper och hopp:** kör upp på rampen så lyfter bilen – ju fortare desto
längre. I luften går det inte att styra; en hård landning kostar lite fart
(och lite skada när vapnen är på).

**Vapen** (kan stängas av i menyn och i onlinelobbyn): varje bil startar med
5 missiler, 3 minor och 3 turbo. Missiler flyger rakt fram och snurrar runt
den de träffar, minor läggs bakom bilen, gillrar sig efter en halv sekund och
kastar upp bilen i luften. Turbo ger 1,5 s extra kraft och högre toppfart.
Vapnen låses upp tre sekunder efter start. Krockar och träffar ger skada;
över 40 % skada går bilen långsammare, och vid 100 % exploderar den, brinner
en stund och kommer tillbaka lappad (30 % skada). Datorförarna använder också
vapen – oftare ju svårare de är.

## Mästerskap och butik

**CHAMPIONSHIP** i titelmenyn kör ett lopp på varje bana (med inställningarna
från huvudmenyn: spelare, motståndare, svårighetsgrad, varv, vapen). Poäng
10-8-6-5-4-3-2-1; den med minst poäng startar längst fram, ledaren längst
bak. Varje lopp ger prispengar efter placering ($1200 för en seger ner till
$200) plus $40 per missil-/minträff och $150 per bil du skjutit sönder.
Mästerskapet sparas efter varje lopp och kan fortsättas senare (CONTINUE).

Före varje lopp öppnas **butiken** (vid delad skärm handlar P1 och sedan P2):

| Vara | Effekt | Pris |
|---|---|---|
| Motor nivå 1–3 | +8 % acceleration, +4 % toppfart per nivå | $1500 / $2800 / $4500 |
| Däck nivå 1–3 | +7 % grepp, +5 % sladdgrepp per nivå | $1000 / $2000 / $3200 |
| Pansar nivå 1–3 | −18 % skada per nivå | $1200 / $2400 / $3800 |
| Missil / mina / turbo | +1 (max 12 / 8 / 6) | $60 / $50 / $90 |
| Reparation | så mycket pengarna räcker till | $8 per % skada |

Oanvänd ammunition och skada följer med till nästa lopp. Du börjar med $1000.
Datorförarna uppgraderar i samma takt som spelarna (lite mer på HARD, lite
mindre på EASY).

Online har varje rum en **säsong**: poängen syns i lobbyn, och med
UPGRADES: ON (standard) tjänar alla pengar och handlar i lobbyns **SHOP**
mellan loppen. Servern håller pengar och uppgraderingar och godkänner varje
köp. Värden kan starta en **NEW SEASON**.

| En spelare | Funktion |
|---|---|
| ↑ / W | Gas (släpp + tryck igen medan du styr = drift) |
| ↓ / S | Broms / back |
| ← → / A D | Styr |
| Z / B | Drift (håll för att behålla sladden) |
| Space / K | Missil framåt |
| X / J | Mina bakåt |
| C / L | Turbo |
| R | Sätt tillbaka bilen på banan (P2 i delad skärm: Enter) |
| Esc / P | Paus |

Delad skärm: **P1** WASD, drift Q, missil/mina/turbo G/F/H, **P2**
piltangenter, drift L, missil/mina/turbo . , -. Handkontroller: vänster
spak styr, RT/A gas, LT/B broms, LB drift, X/RB missil, Y/↓ mina, ↑/L3
turbo, Start paus;
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

`npm run sim -- --seeds 20 --laps 3 [--track dustbowl] [--weapons]` kör headless AI-lopp och kontrollerar
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
