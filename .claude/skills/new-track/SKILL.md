---
name: new-track
description: Skapa eller ändra en bana i Megacars (create or change a race track) – banform, bredd, ytor, hopp, broar, tema, landmärken, musik, och hur man verifierar och lanserar den. Använd när någon ber om en ny bana, en ny bansträckning, en ändring av en befintlig bana (bredare, kortare, nya kurvor, ytor) eller ett nytt banteema.
---

# Skapa en bana i Megacars

En bana är en `TrackDef` (data) i `src/shared/track/defs/`. Byggaren
(`src/shared/track/builder.ts`) gör vägen, räcken, ytor, startgrid,
depå, catch-up-pilar och AI:ns ideallinje av den. Allt i `src/shared` körs
identiskt på server och klient, så **en bana är en del av simuleringen**.

## Snabbt arbetsflöde

1. Skriv definitionen i `src/shared/track/defs/<namn>.ts` (se mallen nedan).
2. Iterera med `npm run track -- src/shared/track/defs/<namn>.ts --svg <scratchpad>/<id>.svg`
   tills den bygger utan fel, har depå och AI:n klarar den (se "Kontrollera").
3. Registrera den i `TRACK_LIST` i `src/shared/track/defs/index.ts`.
4. Ge den ett tema: ett befintligt (`countryside`, `desert`, `winter`, `nuclear`,
   `brewery`, `tivoli`, `cigar`, `city`) eller ett nytt (se "Utseende").
5. Höj `SIM_VERSION` i `src/shared/config/constants.ts` med ett.
6. `npm run typecheck`, `npx vitest run`, `npm run sim -- --seeds 4 --track <id> --weapons`,
   `npm run build`, och titta på den i webbläsaren.
7. Uppdatera banlistan i `README.md`, committa och pusha.

## Koordinater

- `x` åt höger (öster), `z` **nedåt** på skärmen (söder). Kameran står i
  söder och tittar norrut, snett nedåt (57°).
- Mått i meter. Bilen är cirka 4,4 × 2 m. Tänk "ungefär 1 m per pixel i en
  översiktsbild".
- Banan körs i den ordning `path` listar hörnen. Alla befintliga banor går
  medurs på skärmen. Moturs fungerar också.

## Mall

```ts
import { Surface } from '../../config/surfaces.ts';
import type { TrackDef } from '../types.ts';

// En eller två meningar om banans karaktär: vad som händer var på varvet.
export const MY_TRACK: TrackDef = {
  id: 'mytrack',            // unikt, små bokstäver. Används i URL (?track=), rekord, rum
  name: 'My Track',         // visas i menyer (versaler i UI)
  theme: 'countryside',     // nyckel i THEMES (src/client/render/theme.ts)
  width: 17,                // vägbredd i meter, 15–20 brukar fungera
  // cornerWiden: 2,        // extra halvbredd per sida i kurvorna (bredare kurvor = mer förlåtande)
  runoff: 5,                // gräs/grus mellan vägkant och räcke, 3–6
  // runoffSurface: Surface.Gravel,
  startAt: 0.45,            // startlinjen: andel längs rakan från sista hörnet till första
  laps: 3,
  // lapScale: 3,           // korta banor: varv körda per varv valt i menyn
  seed: 8,                  // slumpfrö för kulissen (träd, hus); olika per bana
  path: [
    { x: 300, z: 0, r: 30 },   // hörn 0: slutet av startrakan. r = kurvradie för mittlinjen
    { x: 300, z: 200, r: 40 },
    { x: -200, z: 200, r: 60 },
    { x: -200, z: 0, r: 30 },  // sista hörnet: in på startrakan (mot hörn 0)
  ],
  patches: [{ surface: Surface.Gravel, x: 290, z: 190, r: 22, runoff: true }],
  // ramps: [{ x: 100, z: 200, length: 10, height: 1.4 }],
  // bridges: [...]             // när banan korsar sig själv, se twinBridges.ts
  // landmarks: [{ kind: 'carousel', x: 0, z: 100 }],
};
```

## Banformen: regler som byggaren kontrollerar

`path` är en sluten polygon. Varje hörn rundas med en cirkelbåge med radien
`r`. Startrakan går från sista hörnet till hörn 0.

- **Minsta radie:** `r ≥ width/2 + cornerWiden + runoff + 0.5`, annars viks
  innerräcket. Exempel: width 17 och runoff 5 ger minst 14 m. 18–25 m är
  tvära hårnålar, 30–60 m vanliga kurvor, 100 m och mer svep.
- **Plats för kurvorna:** en sväng med vinkeln θ tar upp `r·tan(θ/2)` av
  rakan på varje sida (90° tar alltså `r`). Två grannhörn får inte ta
  mer än sträckan mellan dem: felet heter `straight i->j: corners need …`.
  Sänk radierna eller flytta isär hörnen.
- **Högst 179° per hörn.** En U-sväng är två hörn i följd med var sin
  90°-sväng, till exempel `{x:150,z:200}` och `{x:150,z:248}` i Green Valley.
- **Inga överlapp:** delar av banan som inte hänger ihop längs vägen måste
  ligga minst `2·(halvbredd + runoff) + 1` m isär, mätt mittlinje till
  mittlinje. Med width 17 och runoff 5 blir det 28 m. Felet heter
  `sections at s=… and s=… are only X m apart`. Mittlinjen får inte korsa
  sig själv, utom via en `bridges`-post.
- **Startgriden står på rakan:** 8 bilar står upp till cirka 35 m bakom
  linjen. Ha minst 45 m raka före linjen.
- **Ramper och broar** får inte gå över startlinjen.

## Det som inte ger fel men gör banan sämre

- **Depån** (`pit.ts`) läggs bara ut om startrakan är lång nog. Raka
  före och efter linjen, som `npm run track` visar, måste tillsammans vara
  minst cirka 106 m (8 m marginal mot varje kurva och en fil på minst 90 m).
  Den sida depån hamnar på behöver cirka 25 m fritt utanför räcket för
  fil, ö och garage. Sikta på 70–90 m raka på var sida om linjen, med
  `startAt` runt 0,4–0,55. Den längsta depån som går är 180 m.
  `npm run track` skriver `pit: NONE` om det inte gick. **Testerna kräver
  en depå på varje bana**, med depåboxen längre än 30 m, alltså en
  reparationszon på minst cirka 25 m. AI:n måste också köra in och komma
  ut reparerad (`pit.test.ts`).
- **Catch-up-pilar** (`catchUp.ts`) hamnar på raksträckor som är minst
  24 m långa, ligger mer än 80 m från startlinjen och ligger minst 160 m
  från varandra. **Testerna kräver minst två** (`catchUp.test.ts`). En
  kompakt bana på 800 m klarar det bara med pilar på motsatta sidor av
  varvet.
- **Rytm:** varva tvära och snabba kurvor och ge varje kurva en raka ut.
  Vänster-höger-följder med 20–35 m raka emellan är roliga att drifta
  igenom, se Tivoli Twists "våg". Tvära kurvor direkt efter en lång raka
  ger krockar med vapen och tät trafik. Det är bra, men inte för ofta.
- **Längd:** fullstora banor är 1600–2500 m (AI-varv 38–58 s, 3–4 varv).
  En kompakt bana kring 800 m har `lapScale: 3`, AI-varv runt 18 s.
- **Förlåtande eller svår:** bredare väg, `cornerWiden` och större
  `runoff` gör banan lättare. Smal väg, grusrunoff och ytor på
  ideallinjen gör den svårare. Mät effekten med väggträffar och respawns.

## Ytor (`patches`)

`Surface`: `Asphalt`, `Wet`, `Gravel`, `Grass`, `Snow`, `Ice`, `Oil`,
`ShallowWater`, `DeepWater`. Greppvärden finns i
`src/shared/config/surfaces.ts`.

- En patch är en cirkel (`r`) som ritas som en oregelbunden fläck
  (`patchShape.ts`). Med `hx`/`hz` blir den en rektangel, som ett vattendike.
- `runoff: true` täcker även runoffen. Använd det för gruskurvor.
- Lägg is, olja och vått **i eller strax efter** en kurva. Lägg dem aldrig
  vid startgriden eller på depåns fil.
- Is och olja är mycket hala (grepp 0,18 och 0,06). Håll dem små, r 6–10,
  så att de går att undvika.

## Hopp och broar

- `ramps`: `(x, z)` är rampens krön, mitt på vägen på en raka. Rampen
  stiger över `length` meter före krönet. Typiska värden är length 10–11
  och height 1,4–1,7 (se `dustBowl.ts` och `meltdown.ts`). Sätt gärna
  vatten eller grus efter krönet så att ett för kort hopp kostar något.
- `bridges`: används när banan korsar sig själv. `upper` (0 eller 1) anger
  vilken av de två passagerna, räknat från startlinjen, som går överst.
  `gap: true` ger en trasig bro att hoppa över. Följ `twinBridges.ts`:
  korsa i ungefär rät vinkel, height cirka 5,5, span 14–15 och ramp 45.

## Utseende (klienten, påverkar inte simuleringen)

- **Tema:** `THEMES` i `src/client/render/theme.ts` styr markfärg, träd,
  stenar, hus, damm och reklamskyltar (`sponsors`). Med `patchColors` kan en
  yta ritas i en annan färg, till exempel olja som öl. Ett okänt tema
  faller tillbaka på `countryside`.
- **Mark:** `flowers` ger blomsterängar, `mowed` ger klippta ränder i en
  gräsrunoff, `clouds` ger drivande molnskuggor, `sand` ger dyner och
  vindrippel, `snow` ger drivor och glitter, `woods` samlar träden i
  skogsdungar och `blossom` ger blommande träd.
- **Liv (`life`, ett recept i temat, se `trackLife.ts`):**
  - `banks`: publikslänter i kurvorna, med funktionärer.
  - `camps`: tält- eller husbilsläger.
  - `paddocks`: hagar med får, kor, hästar eller renar.
  - `bales`: höbalar.
  - `vehicles`: traktor, snöskoter, lastbil eller truck som kör fram och
    tillbaka.
  - `walkers`: folk som promenerar.
  - `birds`: fåglar som cirklar.
  - `balloon`: en luftballong.
  - `extras`: oljepumpar, rullande buskar, vindpumpar, snögubbar,
    skridskoåkare och arbetsplatser (`lifeExtras.ts`).

  Små figurer ritas instansierat per 80 m-ruta och animeras i shadern.
  Större saker som rör sig flyttas av `animate` och måste hållas utanför
  `batchStatic` (`moving`). Material med `onBeforeCompile` som skiljer sig
  mellan banor eller teman behöver en egen `customProgramCacheKey`.
  Annars återanvänder three.js fel program.
- **Hus:** byggnader med fönsterväggar får automatiskt mjuka
  kontaktskuggor (`grounding.ts`). Husen längs vägen får en stensatt yta
  med bänkar och planteringar. Höjderna längs vägen sätts per tema i
  `town.ts`: låga hus på landet, i öknen och i snön, torn i staden.
- **Byggnader och landmärken:** varje tema har en gren i `buildTown`
  (`src/client/render/town.ts`). Där placeras temats byggnader med `place()`
  och `def.landmarks` läses. Egna modeller ligger i en egen fil, som
  `brewery.ts` och `tivoli.ts`. Landmärken som finns idag:
  - `brewery`: `brewhouse`, `mug` och `tent`.
  - `tivoli`: `ferriswheel`, `carousel` och `bigtop`.
  - `city`: `tower`, `liberty`, `board` och `subway`.
- **Landmärken tappas tyst** om de inte får plats. Två saker räcker:
  - de står för nära vägen eller ett annat objekt,
  - de skymmer vägen. Ett objekt med höjden h skymmer cirka 0,65·h m mark
    **norr om sig** (lägre z).

  Lägg höga saker söder om vägen eller med gott om plats norrut, gärna
  inne i slingorna där man ser dem varje varv. Kontrollera i webbläsaren
  att de syns.
- **Musik:** `TRACK_SONG` i `src/client/audio/music.ts` kopplar bana till
  låt. Utan en post där spelas låten med samma namn som banans id, och
  finns ingen sådan spelas `greenvalley`. Lägg aldrig till musik utan känd
  licens, och fyll i `public/music/CREDITS.md`.

## Kontrollera

```sh
npm run track -- src/shared/track/defs/<namn>.ts --svg <scratchpad>/<id>.svg   # innan den är registrerad
npm run track -- <id> --seeds 3 [--weapons] [--laps 3]                         # när den finns i TRACK_LIST
```

Verktyget skriver ut följande:

- längd och bredd,
- byggfel,
- startrakan före och efter linjen,
- depåns sida och reparationszon,
- catch-up-pilarnas positioner,
- sektionerna i körordning (`S92 R38 L29 …` = raka, höger, vänster, meter),
- AI-lopp med 8 bilar: alla i mål, bästa varv, respawns, väggträffar.

Det avslutas med kod 1 vid fel. SVG-bilden visar räcken (rött), vägkanter,
mittlinje, ideallinje (blått), ytor (gult), pilar (cyan), grid, startlinje,
landmärken och hörnens index.

Vill du titta på SVG-filen som bild kan du lägga den i en sida och ta en
skärmdump med Playwright. Chromium finns på `/opt/pw-browsers/chromium`:

```js
await page.setContent(`<body style="margin:0">${readFileSync(svgPath, 'utf8')}</body>`);
await page.screenshot({ path: pngPath });
```

**Godkänt:**

- inga fel och en depå,
- minst två pilar,
- 8/8 i mål i varje seed, också med `--weapons`,
- respawns som är få och inte ökar mellan seeds.

En respawn-loop, alltså samma bil om och om igen, betyder att AI:n
inte klarar ett ställe. Bredda vägen där, öka radien eller ta bort ytan.

**I spelet:** starta servern (`node src/server/main.ts` med `PORT=8790`)
och öppna `http://localhost:8790/?mute=1&track=<id>&mode=practice`. Med
Playwright går det att styra spelet via `window.__megacars`:

```js
await page.evaluate((t) => __megacars.startRace({ track: t, opponents: 0, practice: true }), id);
await page.evaluate(() => __megacars.autopilot(true));   // AI kör din bil
await page.evaluate(() => __megacars.debug.zoom(2.5));   // zooma ut
await page.evaluate(() => __megacars.debug.place(x, z)); // flytta bilen (kameran följer)
await page.evaluate(() => __megacars.advance(600));      // stega simuleringen
```

Starta Chromium med `--use-angle=swiftshader --enable-unsafe-swiftshader`.
Granska att vägen och depån syns, att landmärkena kom med och att inget
står på vägen.

## Ändra en befintlig bana

- Ändrad geometri (path, bredd, runoff, ytor, ramper) är en
  simuleringsändring. Höj `SIM_VERSION`, kör `npm run track -- <id>` och
  sim-loppen igen, och jämför varvtider och väggträffar med före ändringen.
- Rekorden ligger under banans `id`. Byter du `id` försvinner banans
  rekord. Ändrar du formen kraftigt blir gamla rekord ojämförbara, så
  nämn det för användaren.
- `width`, `cornerWiden` och `runoff` påverkar allt omkring: depåns läge,
  överlappskontrollen, minsta radien och kulissens avstånd. Kör därför hela
  kontrollen, inte bara ett lopp.

## Fallgropar

- `getTrack()` cachar byggda banor per `id`. Ge utkast egna id:n och
  återanvänd aldrig ett id för en annan form i samma process.
- Tester som går över alla banor i `TRACK_LIST`:
  - `builder.test.ts`: banan bygger utan fel och har 8 gridplatser.
  - `pit.test.ts`: depå finns, och AI:n kör in och reparerar.
  - `catchUp.test.ts`: minst två pilar, mer än 80 m från startlinjen.

  En ny bana måste klara alla tre.
- Höj `SIM_VERSION` när en bana läggs till eller ändras. Annars kan en
  gammal klient gå med i ett rum vars bana den inte känner till eller
  bygger annorlunda.
- `laps` och `lapScale` hör ihop med `raceLaps()`. Använd `raceLaps(track, laps)`
  och inte `def.laps` direkt när antalet varv som faktiskt körs behövs.
