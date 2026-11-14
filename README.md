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

**Driftboost:** en sladd genom en kurva laddar en boost i tre nivåer, efter
ungefär 0,6, 1,3 och 2,2 sekunders drift (mätaren bredvid hastigheten, gnistor
från bakhjulen i blått, orange och lila). När bilen greppar igen får den en
kort knuff framåt: nivå 1 är en liten puff, nivå 3 (en lång hårnål på Cigar
Circuit) ungefär som en turbo. Det räknas bara när bilen verkligen svänger,
i en kurva och strax efter den; att sladda eller slingra nerför en raka ger
ingen laddning och ingen reparation. Is, olja och snö laddar inget, en hård
smäll i en vägg eller en bil eller en snurr tar bort laddningen, och broms
håller tillbaka boosten. Datorförarna laddar och får boost på samma sätt.

**Draft:** ligger du tätt bakom en annan bil (från några meter till ungefär
24 m bakom, i samma riktning och i fart) dras du med: upp till 6 % högre
toppfart och lite mer acceleration. Effekten byggs upp på 0,7 s och släpper
på 0,3 s. DRAFT lyser bredvid hastigheten, luften strömmar förbi bilen och
det börjar vina. Gäller inte under nedräkningen, och inte bakom vrak eller
spöklika bilar efter en återställning.

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
3 missiler, 2 minor och 2 turbo, och fyller på från lådorna på banan. Missiler flyger rakt fram och snurrar runt
den de träffar, minor läggs bakom bilen, gillrar sig efter en halv sekund och
kastar upp bilen i luften. Turbo ger 1,5 s extra kraft och högre toppfart.
Vapnen låses upp tre sekunder efter start. Krockar och träffar ger skada;
över 40 % skada går bilen långsammare, och vid 100 % exploderar den, brinner
en stund och kommer tillbaka lappad (30 % skada). Datorförarna använder också
vapen – oftare ju svårare de är.

**Lådor** (bara med vapen på): på några ställen runt varvet står en rad med
två eller tre glödande lådor tvärs över vägen, så du får välja spår. Kör
igenom en så får du något: 2 missiler, 2 minor, 1 turbo eller en lagning
(30 % skada). Lådan kommer tillbaka efter 6 sekunder. Vad den ger avgörs av
banan (fröet, lådan och tick), lite viktat efter placering: de som ligger
sist får oftare turbo, missiler och lagning, ledaren oftare minor. Taket är
detsamma som i butiken (12 missiler, 8 minor, 6 turbo); är du full på något
får du något annat, och är du full på allt står lådan kvar åt nästa. HUD:en
visar vad du fick ("+2 MISSILES") ovanför vapenpanelen. Banbyggaren lägger
ut lådorna själv utifrån banans form – 3–5 rader på en vanlig bana, färre
på de korta – aldrig i depån, på startrutorna, på ramper, broar eller
landningen efter ett hopp, på pilarna eller i inbromsningen före en snäv
kurva. Datorförarna styr gärna över en meter eller två för en låda nära
sin linje, men aldrig tvärs över vägen. `npm run track` och banskaparens
statusrad visar raderna. Nya sorters innehåll läggs till som en rad i
`CRATE_ITEMS` i `src/shared/sim/crates.ts`.

## Datorförarna

De tio datorförarna har var sin personlighet som syns i hur de kör. Inom en
svårighetsgrad skiljer det ungefär ±1,5 % i varvtid mellan dem (snittet är
detsamma som förut; på HARD kan ingen bli snabbare än den felfria föraren,
så där är spridningen mest åt det långsamma hållet).

| Förare | Typ | Hur |
| --- | --- | --- |
| BLITZ | HOTHEAD | bromsar sent, skjuter gärna, viker inte undan, kör på trots skada |
| NITRO NINA | TURBO ADDICT | en extra turbo, bränner dem direkt på kortare raksträckor |
| TURBO TOM | TURBO HOARDER | en extra turbo, sparar alla till slutet av loppet |
| VIXEN | MINE LAYER | lägger minor när någon ligger tätt bakom |
| DIESEL DAN | ROADBLOCK | seg i starten, glider över mot den som försöker gå om |
| ROXY | CLEAN RACER | greppkörare som bara driftar de snäva kurvorna, skjuter sällan, depåar tidigt |
| MAX POWER | GUNSLINGER | massor av missiler |
| ACE | THE PRO | snabbast, exakt, kall i huvudet |
| SPARKY | NERVOUS ROOKIE | bromsar tidigt, viker undan, depåar vid första skrapan, reagerar långsamt |
| LUCKY LOU | WILD CARD | slarvig linje och olika fart från varv till varv |

Personligheten väljs av förarens namn i loppets spec, så servern och alla
klienter kör dem lika. En människa som tappar anslutningen och tas över av
datorn får ingen personlighet. Mästerskapstabellen visar en rad om varje
förare (på smala skärmar bara typen).

Datorförarna har också **reaktionstid** som en människa: något nytt (en sladd
de inte bett om, en bil som plötsligt dyker upp, ett mål som kommer i
siktet, grönt ljus) hanteras först efter ca 0,25–0,35 s på EASY, 0,15–0,25 s
på MEDIUM och 0,08–0,15 s på HARD, olika från gång till gång och per förare.
Att följa linjen och bromsa för en kurva de ser komma är förutseende och sker
direkt. Bromstrycken för att drifta är olika långa. På raksträckor kör de
rakt: inga driftstarter, inte mer styrning än däcken klarar, och en sladd
efter en smäll rätas upp i stället för att hållas. Andelen tid de glider på
raksträckor av egen vilja gick från 6,5 % (8,6 % med skada) till 1,1 %
(1,9 %); `node scripts/personaLaps.ts` mäter varvtiderna per personlighet.

## Karriär

**CAREER** i titelmenyn: börja i **Division 3** och kör säsonger – ett
mästerskap över alla banor mot sju datorförare. Slutar du topp 3 flyttas du
upp en division; motståndarna blir skickligare (EASY → NORMAL → HARD) och
bättre utrustade. Vinn **Division 1** för att bli **MEGACARS CHAMPION**, och
försvara sedan titeln. Varje säsong ger en bonus efter slutplacering (mer i
högre divisioner). Pengar, uppgraderingar, bil, ammunition och skada följer
med mellan säsongerna, och karriären sparas efter varje lopp (CONTINUE).

**Rival:** varje säsong får du en datorförare som **RIVAL**. Första
säsongen, och i en ny division, är det en av de snabbaste i fältet (en ny
varje gång du flyttas upp); stannar du kvar i divisionen blir det den som
slutade närmast före dig (eller tvåan, om du vann). Rivalen har en röd
skylt över bilen och en röd ruta på minikartan, och siktar på dig med
missiler och minor lite oftare än på andra. Tabellen och karriärsidan visar
hur många lopp var och en slutat före och poängskillnaden. Har du fler poäng
än rivalen när säsongen är slut får du en rivalbonus utöver säsongsbonusen
($1000 i division 3, $1500 i 2, $2000 i 1), och säsongsavslutet säger vem
som vann duellen. Äldre sparade karriärer får en rival när de laddas.

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
med genom att välja ett. Publika rum kör en turnering på tre slumpade banor
ur spelet och slumpar nya när den är slut. Rum kan vara **PUBLIC** (syns i listan) eller
**PRIVATE** (bara med koden); värden kan växla i lobbyn. Publika rum väntar
inte på värden: när minst två är inne och alla har tryckt READY startar
racet efter fem sekunders nedräkning.

## Banskaparen

**TRACK EDITOR** i titelmenyn öppnar **MY TRACKS**: dina egna banor, sparade
i webbläsaren. **NEW TRACK** börjar från en rektangel, **NEW FROM A GAME
TRACK** från en kopia av en av spelets banor (utom de med broar).

Banskaparen visar banan uppifrån och fungerar med mus, pekskärm och tangenter:

- **ROAD (1):** dra i hörnen för att forma vägen och i hörnets ratt för att
  ändra radien. Tryck på vägen mellan två hörn för att lägga till ett hörn,
  och dra startlinjen längs sista rakan.
- **SURFACE (2):** måla ytor som grus, is, olja, blött, snö, vatten och gräs.
- **RAMP (3):** lägg ut hopp, högst fyra.
- **LANDMARK (4):** placera temats landmärken.
- **SETTINGS:** namn, tema, bredd, bredare kurvor, runoff och dess yta, varv
  och kortbanefaktor.

Kortkommandon:

| Tangent | Funktion |
|---|---|
| Ctrl+Z / Ctrl+Y | ångra / gör om |
| Delete | ta bort det markerade |
| G | fäst mot rutnätet |
| F | passa in hela banan |
| +/- och hjulet | zooma |
| piltangenter eller WASD | panorera |

Varje ändring kontrolleras direkt. Problem markeras på kartan, och
statusraden visar längd, depå, antal pilar och lådrader.

- **AI TEST** kör åtta datorbilar i två korta lopp i en egen tråd.
- **TEST DRIVE** kör fri träning på banan. Paus → **BACK TO THE EDITOR**
  går tillbaka till banskaparen.
- **SHARE** kopierar en länk (`?t=KOD`). Den som öppnar länken får banan i
  sina My Tracks.
- **PUBLISH** lägger ut banan i den gemensamma listan.

Egna banor finns med i banvalet under Single Race. Personbästa på dem sparas
bara lokalt, eftersom topplistorna gäller spelets egna banor. Koden är en
kompakt sifferlista i base64url, och banans id (`u-…`) är en hash av
innehållet. Samma bana har alltså samma id överallt. `npm run track -- <kod
eller länk>` kontrollerar en delad bana från terminalen.

**PUBLISHED TRACKS** (i My Tracks) listar publicerade banor sorterade på
flest gillningar, nyast eller mest körda. Du kan köra en bana, gilla den,
spara den till My Tracks eller öppna en kopia i banskaparen.

Servern kontrollerar varje bana i en worker-tråd innan den listas. Banan måste
bygga, ha depå och pilar, och alla datorbilar måste gå i mål. Det finns tre
gränser:

- varje adress kan publicera högst fem banor i timmen;
- listan rymmer högst 2000 banor;
- varje adress kan gilla en bana en gång.

Banorna sparas i `$DATA_DIR/tracks.json`. API:

| Anrop | Funktion |
|---|---|
| `GET /api/tracks?sort=new\|top\|played&page=0` | listar banor |
| `POST /api/tracks` med `{code, author}` | publicerar en bana |
| `POST /api/tracks/<id>/like` | gillar en bana |
| `POST /api/tracks/<id>/play` | räknar en körning |
| `DELETE /api/tracks/<id>` med `Authorization: Bearer <TRACKS_TOKEN>` | tar bort en bana |

`TRACKS_TOKEN` faller tillbaka på `STATS_TOKEN`.

## Rekord och topplistor

**RECORDS** i titelmenyn visar per bana ditt bästa varv och dina bästa
racetider (sparas i webbläsaren) och världens topp 10 bästa varv. Slår du
ditt rekord i ett snabbrace, i träning eller i en tidskörning med serienbil skickas racet till
servern: din inmatning tick för tick (komprimerad, typiskt 30–50 kB) och
racets uppsättning. Eftersom simuleringen är deterministisk spelar servern
upp racet igen i en egen tråd (≈1 s för 3 minuter med 8 bilar) och mäter
varven själv – en påhittad tid kan alltså inte komma in. Topplistan sparas i
`$DATA_DIR/records/v<SIM_VERSION>/records.json` (standard `./data`); i
produktion bör `DATA_DIR` peka på en beständig volym.

Topplistorna hör till en simuleringsversion (`SIM_VERSION`): när fysiken
ändras börjar listorna om i en ny mapp, och gamla tider ligger kvar orörda
på disk men visas inte. Tiderna från före version 25 ligger kvar i
`$DATA_DIR/records.json`. En lista som inte går att läsa flyttas undan
(`records.json.bad-<tid>`) i stället för att skrivas över.

För varje plats på en lista sparar servern det kontrollerade racet (racets
uppsättning och inmatningen) som en egen fil bredvid listan,
`records/v<version>/replays/<id>.json` (30–50 kB, packas till ~10 kB), så att
andra kan köra mot det som spöke. Filen tas bort när platsen faller ur
listan. `GET /api/records/replay/<id>` hämtar det (id står på platsen i
`GET /api/records`); ett id:s race ändras aldrig, så svaret får cachas för
evigt. Högst 30 hämtningar per minut och adress. Dina egna rekord
i webbläsaren sparas också per version (`megacars.records.v1.sim<version>`);
de gamla finns kvar i localStorage men visas inte.

## Tidskörning (TIME TRIAL)

**TIME TRIAL** i titelmenyn: ensam på banan, inga vapen, serienbil (inte
den egna tuningen) och hur många varv som helst – fri träning med ett
spöke att jaga. Välj bana, klass och spöke: **OFF**, **MY BEST** (ditt
bästa varv på banan i den klassen), **WORLD RECORD** (etta på världslistan)
eller båda. På egna banor finns ingen världslista, där finns bara MY BEST.
Valet sparas.

Spöket är en genomskinlig bil utan kollisioner och ljud (MY BEST cyan,
världsrekordet gult) som börjar sitt varv varje gång du börjar ett, så du
kör alltid samma varv från linjen. Det bleknar när det ligger ovanpå din
bil. Överst i mitten står skillnaden mot spöket på samma ställe på banan
(uppdateras tio gånger i sekunden, grön före, röd efter; med två spöken
jämförs mot det snabbare), och efter varje varv en kort rad med
skillnaden för hela varvet. Ett nytt personbästa blir ditt spöke direkt.

MY BEST sparas i webbläsarens IndexedDB (position, höjd, riktning och
körd sträcka varje tick, ~20 byte per tick, ~70 kB för en minut), per
simuleringsversion som rekorden; spöket sparas från varje nytt personbästa
varv, även i snabbrace och träning. Världsrekordets race hämtas från
servern, spelas upp igen i en Web Worker (en hel session kan ta några
sekunder) och det snabbaste varvet plockas ut; det måste ha exakt samma tid
som på listan, annars visas det inte. Det sparas, ett per bana och klass.
I **RECORDS** väljer ↑↓ (eller ett tryck) en plats på världslistan och
ENTER (eller ett tryck till) startar en tidskörning mot just den.

## Grafik och prestanda

**OPTIONS → GRAPHICS**: AUTO, HIGH, MEDIUM eller LOW. AUTO börjar på HIGH och
går ner ett steg om spelet ligger under ~45 fps i några sekunder under ett
race (skuggkartan halveras, sedan stängs skuggor av; färre partiklar).
Valet sparas. Statiska föremål slås ihop till några få stora meshar per
område, och bilarnas delar per material, för färre draw calls.

Servern komprimerar (brotli/gzip) och skickar ETag, så återbesök laddar
nästan ingenting. Spelet kan installeras som app (PWA) och startar offline
för spel mot datorn.

## Spelkänsla

**Vibration:** handkontroller (dual-rumble, där webbläsaren och kontrollen
stöder det) och Android-mobiler (`navigator.vibrate`; iPhone saknar det och
får ingenting) ger korta pulser för vägg- och bilkrockar, träffar av missil
och mina, att bli totalad, hårda landningar, turbo som startar, lådor du
plockar samt startljusen och GO. Styrkan följer hur hårt det small. I delad skärm känner
varje kontroll bara sin egen bil (kontroll 1 = spelare 1, kontroll 2 =
spelare 2). Nya händelser får en vibration med en rad i `RULES` i
`src/client/input/haptics.ts`. Av/på under **OPTIONS → GAME FEEL → VIBRATION**
(på som standard, sparas med övriga inställningar).

**Slow motion:** när din bil blir totalad, eller du totalar en bil i bild,
går spelet på ungefär en tredjedels fart i ca 0,8 s (verklig tid) och
mjukas tillbaka, kameran zoomar in lite och motorljuden går ner i tonhöjd.
Högst en gång var fjärde sekund. Bara klientens tid in i den fasta
simuleringssteget skalas – simuleringen är orörd och varje tick körs och spelas
in exakt en gång, så lap-rekord kan fortfarande kontrolleras. Online styr
servern klockan, och i delad skärm delar två spelare på den: där blir det bara
kamerarörelsen. Av/på under **OPTIONS → GAME FEEL → SLOW MOTION ON WRECKS**.

**Prispall:** när ett lopp är slut, före resultatlistan, visas en kort prispall
över startrakan: de tre främsta bilarna på första, andra och tredje steget med
förarnamn och konfetti (byggd av renderarens egna delar: bilmodellerna, partiklarna
och pixelkameran). Enter, ett tryck eller en handkontrollsknapp (A/B/Start) hoppar
över den; annars går den vidare av sig själv efter ca fyra sekunder. Den visas
efter vanliga lopp, mästerskaps- och karriärlopp och onlinelopp (varje klient
ritar den från slutställningen), i delad skärm över hela skärmen, men inte vid
fri träning. Är det färre än tre bilar visas lika många steg som bilar. Står du
själv på pallen blir det en stor banderoll ("YOU WIN!", "SECOND PLACE!"...) och
mer konfetti; slutar du längre ner visas vem som vann och din placering.

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
rum. Värden väljer banor under **TRACKS** och varv, antal datorbilar och
svårighetsgrad under **RACE SETTINGS**. De andra markerar sig som redo, och
värden startar. Efter målgång är alla tillbaka i lobbyn för nästa lopp. Den som
kommer in mitt i ett lopp tittar på tills nästa.

**TRACKS** är en turnering och kan innehålla upp till 12 banor i valfri
ordning: slumpade banor, alla spelets banor, eller en blandning av spelets
banor och dina egna. Med en enda bana körs den om och om igen och poängen
samlas på hela säsongen.

- Rummet kör banorna i tur och ordning. Mellan loppen visar lobbyn ställningen
  sorterad på poäng, vilket lopp som är nästa och vilka banor som kommer
  sedan.
- Efter sista loppet visas vinnaren. Nästa START börjar en ny turnering, och
  **NEW TOURNAMENT** nollställer den när som helst.
- Värdens egna banor skickas som delningskod till servern. Servern
  kontrollerar och bygger dem i en worker-tråd och skickar dem till alla i
  rummet innan de används.

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
`?room=KODE` (gå direkt med i ett onlinerum), `?t=KOD` (en delad bana läggs i
My Tracks).

`npm run sim -- --seeds 20 --laps 3 [--track dustbowl] [--weapons]` kör headless AI-lopp och kontrollerar
att alla bilar går i mål.

Felsökning i konsolen: `__megacars.state()`, `.startRace({ players: 2 })`,
`.advance(ticks)`, `.pause()`, `.autopilot()`, `.debug.crawlTest()`,
`.debug.bench()`, `.debug.look({ mood, palette, crt })`, `.debug.snap(namn)`,
`.online()` (anslutning, rum, förutsägelsens lead/takt), `.timeTrial()`
(spöken, avstånd), `.worldGhost(bana, klass, plats)` (hämtar och spelar upp
en plats på världslistan, jämför varvtiden), `.keepLapAsMyGhost()`.

## Användningslogg

Servern för en enkel logg över användningen, utan personuppgifter. Det
sparas aldrig någon IP-adress, bara en hash av den (med hemligt salt och
dagens datum, så samma person kan inte följas från en dag till nästa) och
landet. Webbläsare med Do Not Track eller Global Privacy Control loggas inte.
Inga cookies, ingen lagring i webbläsaren.

Det loggas, en JSON-rad per händelse i `DATA_DIR/analytics/ÅÅÅÅ-MM-DD.jsonl`:

- `open`: sidan öppnades (hash, land, enhetstyp, webbläsare, system,
  skärmbredd i grova steg, språk och vilken sajt man kom från, bara
  domännamnet). Skickas av sidan själv, för servern ser inte sidladdningar när appen körs från cachen. Botar räknas inte.
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

Läs sammanfattningen på en statistiksida: sätt `STATS_TOKEN` och öppna
`/api/stats?token=<token>` i en webbläsare. Du får besökare per dag, tid på
dygnet och veckodag, länder, enheter (mobil, surfplatta, dator),
webbläsare, system, skärmbredd, språk, var de kom ifrån, hur länge de
stannar, banor och spellägen samt onlinelopp. Parametrar: `days=1..365`,
`tz=Europe/Stockholm` (för klockslag) och `format=html|text|json`. En
webbläsare får html, andra klienter json. Skicka helst token som
`Authorization: Bearer <token>` när du inte använder en webbläsare, så
hamnar den inte i adressen. Utan `STATS_TOKEN` finns sidan inte. Samma
sammanfattning som text: `npm run stats -- --days 30` där loggen ligger.

Inställningar (miljövariabler på servern):

| Variabel | Standard | Betydelse |
| --- | --- | --- |
| `ANALYTICS` | på | `0` stänger av loggen helt. `npm run dev` loggar inte om inte `ANALYTICS=1`. |
| `ANALYTICS_RETENTION_DAYS` | 90 | Dagar som sparas. Äldre filer raderas. |
| `ANALYTICS_SALT` | slumpas | Saltet för hashen. Annars skapas `DATA_DIR/analytics/salt`. |
| `STATS_TOKEN` | – | Slår på `/api/stats`. |
| `TRACKS_TOKEN` | `STATS_TOKEN` | Tar bort publicerade banor (`DELETE /api/tracks/<id>`). |

`DATA_DIR` ska peka på en persistent volym, annars försvinner loggen vid
omstart.

## Struktur

- `src/shared` – simulering som körs identiskt på server och klient (fysik,
  banor, AI, protokoll). Ingen DOM, ingen Node.
- `src/client` – rendering (Three.js), ljud, inmatning, UI.
- `src/server` – Node-server: statiska filer + WebSocket (`/ws`), rum och
  lopp (`gameServer.ts`, `room.ts`).
- `src/shared/net` – protokoll, binära ögonblicksbilder, klientförutsägelse
  (`predictor.ts`) och klientens loppklocka (`netRace.ts`).
