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
resultatlistan. Under **LEAGUE** väljer du bilklass: **STANDARD** (spelet som
det är tunat), **SUPERCARS** (mycket snabbare, greppar och bromsar hårdare)
eller **MEGACARS** (ännu lite snabbare igen, med egen vildare look). Varje
klass har egna rekordtavlor per bana.

På asfalt greppar bilen tills gränsen och understyr sedan – den sladdar inte
av sig själv. Driften startar du enklast med **driftknappen** (Z, eller LB på
handkontrollen) medan du styr in i kurvan – håll den nere så håller bilen
sladden. Det går också att **släppa gasen kort (under 0,3 s) och trycka
igen** medan du styr in i kurvan – eller genom att dutta på bromsen
(under 0,25 s) medan du styr. Längre rullning eller vanlig inbromsning startar
ingen drift. I sladden orkar däcken mycket mer sidokraft, så rätt timing tar
dig genom skarpa kurvor mycket fortare. Gas ökar sladdvinkeln, släpp gasen
eller motstyr för att räta upp. Is, olja och snö sladdar av sig själva.

Nio banor: **Green Valley** (bred landsbygdsbana), **Dust Bowl** (öken,
smal och teknisk, grus, oljefläckar och ett hopp över en torr flodfåra),
**Frost Ring** (vinter, snabba svep med is och packad snö), **Meltdown
Ridge** (genom ett kärnkraftverk: kyltorn, reaktorhallar, en kylvattenläcka
och ett hopp över kylvattenkanalen – kommer du för kort får du vada ur),
**Twin Bridges** (korsar sig själv två gånger: en trasig bro att hoppa och
en viadukt), **Brewery Bash** (bryggeri, öl på vägen), **Tivoli Twist**
(kompakt tivolibana med vänster-höger-svängar, körs med tre gånger så många
varv) och **Cigar Circuit** (kompakt bana i tobakslandet med tre hårnålar på
rad, rena 180°-svängar för långa drifter, och aska på vägen) samt
**Manhattan Sprint** (kompakt New York-bana genom ett höghuskvarter med två
långa svepande högersvängar, en trång sidogata, våt asfalt och Liberty,
subway och taxibilar i kulissen – körs med tre gånger så många varv).

Ny bana? Se `.claude/skills/new-track/SKILL.md` och `npm run track`.

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

## Karriär

**CAREER** i titelmenyn: börja i **Division 3** och kör säsonger – ett
mästerskap över alla banor mot sju datorförare. Slutar du topp 3 flyttas du
upp en division; motståndarna blir skickligare (EASY → NORMAL → HARD) och
bättre utrustade. Vinn **Division 1** för att bli **MEGACARS CHAMPION**, och
försvara sedan titeln. Varje säsong ger en bonus efter slutplacering (mer i
högre divisioner). Pengar, uppgraderingar, bil, ammunition och skada följer
med mellan säsongerna, och karriären sparas efter varje lopp (CONTINUE).

**Bilar:** INTERCEPTOR (startbil), **VIPER** ($4000: +7 % acceleration,
+4 % toppfart, +5 % grepp) och **BRUTE** ($9000: +15 % acceleration, +8 %
toppfart, +8 % grepp, −15 % skada). Köps i butiken i alla lägen (även
online); uppgraderingarna följer med till den nya bilen. Varje modell har
sin egen kaross.

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
| Ny bil | Viper / Brute (se Karriär) | $4000 / $9000 |
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
turbo, Select återställ bil, Start paus;
handkontroll 1 = P1, handkontroll 2 = P2.

Alla tangenter och knappar kan bytas under **OPTIONS → CONTROLS** (en
spelare, delad skärm vänster/höger och handkontroll, två platser per
funktion). **HOW TO PLAY** i titelmenyn visar de nuvarande knapparna.

## Mobil och surfplatta

Spelet fungerar på telefon i liggande läge (i stående visas "vänd
telefonen", och racet pausas). Vänster tumme styr genom att dra i sidled
där den landar (analogt, med en bred neutral mitt och mjuk kurva), eller med
två pilknappar (OPTIONS → TOUCH STEERING). Höger tumme har DRIFT (störst),
BRAKE, MISSILE, MINE och TURBO (ammunitionen syns på knapparna), RESET och
paus uppe till höger.
**TOUCH GAS** (OPTIONS): standard är att bilen gasar medan vänster tumme
ligger på skärmen – lyft tummen för att släppa gasen; i en oönskad sladd
lättar gasen automatiskt (halkskydd, ej på snö/is). Andra lägen: alltid gas,
eller en egen gasknapp. Med automatisk gas är höger tumme fri för vapen;
broms/back avbryter gasen. Menyerna styrs genom att trycka, långa
menyer scrollar med pilarna, och en BACK-knapp finns uppe till vänster.
Namn och rumskod öppnar telefonens tangentbord. Gränssnittet ritas med
större pixlar på pekskärmar så att texten går att läsa och träffa. Första
tryck går till helskärm (Android); installerat som app (Lägg till på
hemskärmen) körs det i helskärm även på iPhone. Telefoner startar på
grafiknivå MEDIUM i AUTO.

## Publika rum

**PLAY ONLINE → QUICK MATCH** går med i det publika rum som har flest
spelare och väntar, annars ett som kör (man tittar och är med i nästa race),
och finns inget öppnas ett nytt publikt rum där man väntar på andra.
**PUBLIC ROOMS** listar öppna rum (uppdateras var tredje sekund) och man går
med genom att välja ett. Rum kan vara **PUBLIC** (syns i listan) eller
**PRIVATE** (bara med koden); värden kan växla i lobbyn. Publika rum väntar
inte på värden: när minst två är inne och alla har tryckt READY startar
racet efter fem sekunders nedräkning.

## Rekord och topplistor

**RECORDS** i titelmenyn visar per bana ditt bästa varv och dina bästa
racetider (sparas i webbläsaren) och världens topp 10 bästa varv. Slår du
ditt rekord i ett snabbrace eller i träning med serienbil skickas racet till
servern: din inmatning tick för tick (komprimerad, typiskt 30–50 kB) och
racets uppsättning. Eftersom simuleringen är deterministisk spelar servern
upp racet igen i en egen tråd (≈1 s för 3 minuter med 8 bilar) och mäter
varven själv – en påhittad tid kan alltså inte komma in. Topplistan sparas i
`$DATA_DIR/records.json` (standard `./data`); i produktion bör `DATA_DIR`
peka på en beständig volym.

## Grafik och prestanda

**OPTIONS → GRAPHICS**: AUTO, HIGH, MEDIUM eller LOW. AUTO börjar på HIGH och
går ner ett steg om spelet ligger under ~45 fps i några sekunder under ett
race (skuggkartan halveras, sedan stängs skuggor av; färre partiklar).
Valet sparas. Statiska föremål slås ihop till några få stora meshar per
område, och bilarnas delar per material, för färre draw calls.

Servern komprimerar (brotli/gzip) och skickar ETag, så återbesök laddar
nästan ingenting. Spelet kan installeras som app (PWA) och startar offline
för spel mot datorn.

## Musik

Trackermusik (MOD/XM) spelas med libopenmpt i en Web Worker; en liten AudioWorklet spelar upp det renderade ljudet, så ljudtråden aldrig blockeras.
Varje bana har sin låt, menyerna och resultaten sina; låtarna tonas mellan
skärmarna. **OPTIONS** i titelmenyn: musik TRACKS / SHUFFLE / OFF,
musik- och ljudvolym, nästa låt (även **N**), tid på dygnet och credits.
Dra egna .mod/.xm/.s3m/.it-filer till spelfönstret så hamnar de i
shuffle-listan – de sparas bara i din webbläsare och laddas aldrig upp.

Alla medföljande låtar kommer från The Mod Archive och har licenser som
tillåter att de följer med spelet (10 public domain, *Imagine* av Andreas
Viklund under CC BY 4.0). Se `public/music/CREDITS.md`.

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

## Användningslogg

Servern för en enkel logg över användningen, utan personuppgifter. Det
sparas aldrig någon IP-adress, bara en hash av den (med hemligt salt och
dagens datum, så samma person kan inte följas från en dag till nästa) och
landet. Webbläsare med Do Not Track eller Global Privacy Control loggas inte.
Inga cookies, ingen lagring i webbläsaren.

Det loggas, en JSON-rad per händelse i `DATA_DIR/analytics/ÅÅÅÅ-MM-DD.jsonl`:

- `open`: sidan öppnades (hash, land, mobil eller dator). Skickas av sidan själv, för servern ser inte sidladdningar när appen körs från cachen. Botar räknas inte.
- `race`: ett lopp startades på enheten (bana, läge, varv, motståndare,
  spelare). Det gäller träning, snabbt lopp, mästerskap och karriär.
- `session`: hur länge sidan varit framme, och hur många lopp. Webbläsaren
  skickar den när fliken göms.
- `ws`: en onlineanslutning och hur länge den varade.
- `room_race`: ett lopp startade i ett rum (bana, varv, personer, AI).

Landet kommer från CDN-headern om det finns en (`CF-IPCountry` m.fl.),
annars slås det upp i en inbyggd databas (`geoip-country`). This product
includes GeoLite2 data created by MaxMind, available from
https://www.maxmind.com.

Läs sammanfattningen med `npm run stats -- --days 30` (kör den där loggen
ligger), eller över HTTP: sätt `STATS_TOKEN` och hämta
`/api/stats?days=30&format=text` med headern `Authorization: Bearer <token>`.
Utan `STATS_TOKEN` finns sidan inte.

Inställningar (miljövariabler på servern):

| Variabel | Standard | Betydelse |
| --- | --- | --- |
| `ANALYTICS` | på | `0` stänger av loggen helt. `npm run dev` loggar inte om inte `ANALYTICS=1`. |
| `ANALYTICS_RETENTION_DAYS` | 90 | Dagar som sparas. Äldre filer raderas. |
| `ANALYTICS_SALT` | slumpas | Saltet för hashen. Annars skapas `DATA_DIR/analytics/salt`. |
| `STATS_TOKEN` | – | Slår på `/api/stats`. |

`DATA_DIR` ska peka på en persistent volym, annars försvinner loggen vid
omstart.

Sidan har också Umami Cloud (skriptet ligger i `index.html`, med
`data-do-not-track`). Den ger besökare, sidvisningar och land i deras
dashboard, utan cookies. Den loggen och vår egen är separata.

## Struktur

- `src/shared` – simulering som körs identiskt på server och klient (fysik,
  banor, AI, protokoll). Ingen DOM, ingen Node.
- `src/client` – rendering (Three.js), ljud, inmatning, UI.
- `src/server` – Node-server: statiska filer + WebSocket (`/ws`), rum och
  lopp (`gameServer.ts`, `room.ts`).
- `src/shared/net` – protokoll, binära ögonblicksbilder, klientförutsägelse
  (`predictor.ts`) och klientens loppklocka (`netRace.ts`).
