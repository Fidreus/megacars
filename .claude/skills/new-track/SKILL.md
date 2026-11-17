---
name: new-track
description: Create or change a race track in Megacars – track shape, width, surfaces, jumps, bridges, theme, landmarks, music, and how to verify and ship it. Use when someone asks for a new track, a new track layout, a change to an existing track (wider, shorter, new corners, surfaces) or a new track theme.
---

# Creating a track in Megacars

A track is a `TrackDef` (data) in `src/shared/track/defs/`. The builder
(`src/shared/track/builder.ts`) turns it into the road, barriers, surfaces,
starting grid, pit, catch-up arrows and the AI's racing line. Everything in
`src/shared` runs identically on server and client, so **a track is part of
the simulation**.

## Player tracks (the track editor)

Players make their own tracks in the game's track editor (`src/client/editor/`).
The track is canonicalised by `canonicalDef` in `src/shared/track/custom.ts`:
it is rounded, kept within `LIMITS` and gets no bridges. Its id becomes `u-`
plus a hash of its contents.

- **Code:** the track is shared as a code (`encodeTrack`/`decodeTrack`) in a
  link `?t=CODE`. `npm run track -- <code or link>` checks such a track.
- **Checking:** `checkTrackDef` returns `errors`, meaning the track can't be
  driven, and `missing`, meaning the pit or arrows are missing.
- **Registry:** player tracks are registered with `registerTrack`. Anything
  that runs a track looks it up with `trackDef(id)`/`trackName(id)`, never
  `TRACKS[id]`. `TRACKS` covers only the game's own tracks, for example for
  leaderboards.
- **Online:** the server checks and builds player tracks in
  `src/server/trackWorker.ts` and publishes them via `src/server/trackStore.ts`.
  A player track becomes part of the game by being added to `defs/` and to
  `TRACK_LIST` following the steps below.

## Quick workflow

1. Write the definition in `src/shared/track/defs/<name>.ts` (see the template below).
2. Iterate with `npm run track -- src/shared/track/defs/<name>.ts --svg <scratchpad>/<id>.svg`
   until it builds without errors, has a pit and the AI can handle it (see "Verifying").
3. Register it in `TRACK_LIST` in `src/shared/track/defs/index.ts`.
4. Give it a theme: an existing one (`countryside`, `desert`, `winter`, `nuclear`,
   `brewery`, `tivoli`, `cigar`, `city`) or a new one (see "Appearance").
5. Bump `SIM_VERSION` in `src/shared/config/constants.ts` by one.
6. `npm run typecheck`, `npx vitest run`, `npm run sim -- --seeds 4 --track <id> --weapons`,
   `npm run build`, and look at it in the browser.
7. Update the track list in `README.md`, commit and push.

## Coordinates

- `x` points right (east), `z` points **down** the screen (south). The camera
  stands in the south looking north, angled downwards (57°).
- Units are metres. The car is about 4.4 × 2 m. Think "roughly 1 m per pixel
  in an overview image".
- The track is driven in the order `path` lists the corners. All existing
  tracks run clockwise on screen. Counter-clockwise works too.

## Template

```ts
import { Surface } from '../../config/surfaces.ts';
import type { TrackDef } from '../types.ts';

// One or two sentences on the track's character: what happens where on the lap.
export const MY_TRACK: TrackDef = {
  id: 'mytrack',            // unique, lower case. Used in the URL (?track=), records, rooms
  name: 'My Track',         // shown in menus (upper-cased in the UI)
  theme: 'countryside',     // key in THEMES (src/client/render/theme.ts)
  width: 17,                // road width in metres, 15–20 usually works
  // cornerWiden: 2,        // extra half-width per side in corners (wider corners = more forgiving)
  runoff: 5,                // grass/gravel between road edge and barrier, 3–6
  // runoffSurface: Surface.Gravel,
  startAt: 0.45,            // the start line: fraction along the straight from the last corner to the first
  laps: 3,
  // lapScale: 3,           // short tracks: laps driven per lap chosen in the menu
  seed: 8,                  // random seed for the scenery (trees, houses); different per track
  path: [
    { x: 300, z: 0, r: 30 },   // corner 0: end of the start straight. r = corner radius of the centre line
    { x: 300, z: 200, r: 40 },
    { x: -200, z: 200, r: 60 },
    { x: -200, z: 0, r: 30 },  // last corner: onto the start straight (towards corner 0)
  ],
  patches: [{ surface: Surface.Gravel, x: 290, z: 190, r: 22, runoff: true }],
  // ramps: [{ x: 100, z: 200, length: 10, height: 1.4 }],
  // bridges: [...]             // when the track crosses itself, see twinBridges.ts
  // landmarks: [{ kind: 'carousel', x: 0, z: 100 }],
};
```

## Track shape: rules the builder checks

`path` is a closed polygon. Each corner is rounded with a circular arc of
radius `r`. The start straight runs from the last corner to corner 0.

- **Minimum radius:** `r ≥ width/2 + cornerWiden + runoff + 0.5`, otherwise
  the inner barrier folds over. Example: width 17 and runoff 5 give at least
  14 m. 18–25 m are tight hairpins, 30–60 m ordinary corners, 100 m and more
  sweepers.
- **Room for the corners:** a turn through angle θ takes up `r·tan(θ/2)` of
  the straight on each side (so 90° takes `r`). Two neighbouring corners may
  not take more than the distance between them: the error is called
  `straight i->j: corners need …`. Lower the radii or move the corners apart.
- **At most 179° per corner.** A U-turn is two consecutive corners with a
  90° turn each, for example `{x:150,z:200}` and `{x:150,z:248}` in Green Valley.
- **No overlaps:** parts of the track that are not connected along the road
  must be at least `2·(half-width + runoff) + 1` m apart, measured centre line
  to centre line. With width 17 and runoff 5 that is 28 m. The error is called
  `sections at s=… and s=… are only X m apart`. The centre line may not cross
  itself, except via a `bridges` entry.
- **The starting grid sits on the straight:** 8 cars stand up to about 35 m
  behind the line. Have at least 45 m of straight before the line.
- **Ramps and bridges** may not cross the start line.

## What doesn't cause errors but makes the track worse

- **The pit** (`pit.ts`) is only placed if the start straight is long enough.
  The straight before and after the line, as shown by `npm run track`, must
  together be at least about 106 m (8 m of margin to each corner and a lane of
  at least 90 m). The side the pit ends up on needs about 25 m of free space
  outside the barrier for the lane, island and garages. Aim for 70–90 m of
  straight on each side of the line, with `startAt` around 0.4–0.55. The
  longest possible pit is 180 m. `npm run track` prints `pit: NONE` if it
  couldn't be placed. **The tests require a pit on every track**, with the pit
  box longer than 30 m, i.e. a repair zone of at least about 25 m. The AI must
  also drive in and come out repaired (`pit.test.ts`).
- **Catch-up arrows** (`catchUp.ts`) end up on straights that are at least
  24 m long, lie more than 80 m from the start line and are at least 160 m
  from each other. **The tests require at least two** (`catchUp.test.ts`). A
  compact 800 m track only manages this with arrows on opposite sides of the
  lap.
- **Rhythm:** alternate tight and fast corners and give every corner a
  straight on the way out. Left-right sequences with 20–35 m of straight in
  between are fun to drift through, see Tivoli Twist's "wave". Tight corners
  right after a long straight cause crashes with weapons and dense traffic.
  That's good, but not too often.
- **Length:** full-size tracks are 1600–2500 m (AI lap 38–58 s, 3–4 laps).
  A compact track of around 800 m has `lapScale: 3`, AI lap around 18 s.
- **Forgiving or hard:** a wider road, `cornerWiden` and larger `runoff` make
  the track easier. A narrow road, gravel runoff and surfaces on the racing
  line make it harder. Measure the effect with wall hits and respawns.

## Surfaces (`patches`)

`Surface`: `Asphalt`, `Wet`, `Gravel`, `Grass`, `Snow`, `Ice`, `Oil`,
`ShallowWater`, `DeepWater`. Grip values are in
`src/shared/config/surfaces.ts`.

- A patch is a circle (`r`) drawn as an irregular blob (`patchShape.ts`).
  With `hx`/`hz` it becomes a rectangle, like a water ditch.
- `runoff: true` also covers the runoff. Use it for gravel corners.
- Put ice, oil and wet **in or just after** a corner. Never put them at the
  starting grid or on the pit lane.
- Ice and oil are very slippery (grip 0.18 and 0.06). Keep them small, r 6–10,
  so they can be avoided.

## Jumps and bridges

- `ramps`: `(x, z)` is the ramp's crest, in the middle of the road on a
  straight. The ramp rises over `length` metres before the crest. Typical
  values are length 10–11 and height 1.4–1.7 (see `dustBowl.ts` and
  `meltdown.ts`). Consider putting water or gravel after the crest so that a
  jump that falls short costs something.
- `bridges`: used when the track crosses itself. `upper` (0 or 1) says which
  of the two passes, counted from the start line, goes on top. `gap: true`
  gives a broken bridge to jump over. Follow `twinBridges.ts`: cross at
  roughly a right angle, height about 5.5, span 14–15 and ramp 45.

## Appearance (client side, does not affect the simulation)

- **Theme:** `THEMES` in `src/client/render/theme.ts` controls ground colour,
  trees, rocks, houses, dust and advertising boards (`sponsors`). With
  `patchColors` a surface can be drawn in a different colour, for example oil
  as beer. An unknown theme falls back to `countryside`.
- **Ground:** `flowers` gives flower meadows, `mowed` gives mown stripes in a
  grass runoff, `clouds` gives drifting cloud shadows, `sand` gives dunes and
  wind ripples, `snow` gives drifts and glitter, `woods` gathers the trees
  into groves and `blossom` gives blossoming trees.
- **Life (`life`, a recipe in the theme, see `trackLife.ts`):**
  - `banks`: spectator banks in the corners, with marshals.
  - `camps`: tent or camper-van camps.
  - `paddocks`: paddocks with sheep, cows, horses or reindeer.
  - `bales`: hay bales.
  - `vehicles`: a tractor, snowmobile, lorry or forklift driving back and
    forth.
  - `walkers`: people out for a walk.
  - `birds`: circling birds.
  - `balloon`: a hot-air balloon.
  - `extras`: oil pumps, tumbleweeds, wind pumps, snowmen, skaters and
    work sites (`lifeExtras.ts`).

  Small figures are drawn instanced per 80 m cell and animated in the shader.
  Larger moving things are moved by `animate` and must be kept out of
  `batchStatic` (`moving`). Materials with `onBeforeCompile` that differ
  between tracks or themes need their own `customProgramCacheKey`.
  Otherwise three.js reuses the wrong program.
- **Houses:** buildings with window walls automatically get soft contact
  shadows (`grounding.ts`). Houses along the road get a paved area with
  benches and planters. The heights along the road are set per theme in
  `town.ts`: low houses in the countryside, the desert and the snow, towers
  in the city.
- **Buildings and landmarks:** each theme has a branch in `buildTown`
  (`src/client/render/town.ts`). That is where the theme's buildings are
  placed with `place()` and `def.landmarks` is read. Custom models live in
  their own file, like `brewery.ts` and `tivoli.ts`. Landmarks that exist
  today:
  - `brewery`: `brewhouse`, `mug` and `tent`.
  - `tivoli`: `ferriswheel`, `carousel` and `bigtop`.
  - `city`: `tower`, `liberty`, `board` and `subway`.
- **Landmarks are silently dropped** if they don't fit. Either of two things
  is enough:
  - they stand too close to the road or to another object,
  - they hide the road. An object of height h hides about 0.65·h m of ground
    **north of itself** (lower z).

  Put tall things south of the road or with plenty of room to the north,
  ideally inside the loops where they are seen every lap. Check in the browser
  that they are visible.
- **Music:** `TRACK_SONG` in `src/client/audio/music.ts` maps a track to a
  song. Without an entry there, the song with the same name as the track's id
  is played, and if there is no such song, `greenvalley` is played. Never add
  music without a known licence, and fill in `public/music/CREDITS.md`.

## Verifying

```sh
npm run track -- src/shared/track/defs/<name>.ts --svg <scratchpad>/<id>.svg   # before it is registered
npm run track -- <id> --seeds 3 [--weapons] [--laps 3]                         # once it is in TRACK_LIST
```

The tool prints the following:

- length and width,
- build errors,
- the start straight before and after the line,
- the pit's side and repair zone,
- the positions of the catch-up arrows,
- the sections in driving order (`S92 R38 L29 …` = straight, right, left, metres),
- AI races with 8 cars: all finished, best lap, respawns, wall hits.

It exits with code 1 on errors. The SVG image shows barriers (red), road
edges, centre line, racing line (blue), surfaces (yellow), arrows (cyan),
grid, start line, landmarks and the corners' indices.

If you want to view the SVG file as an image, you can put it in a page and
take a screenshot with Playwright. Chromium is at `/opt/pw-browsers/chromium`:

```js
await page.setContent(`<body style="margin:0">${readFileSync(svgPath, 'utf8')}</body>`);
await page.screenshot({ path: pngPath });
```

**Passing:**

- no errors and a pit,
- at least two arrows,
- 8/8 finished in every seed, also with `--weapons`,
- respawns that are few and don't increase between seeds.

A respawn loop, i.e. the same car over and over again, means the AI can't
handle a spot. Widen the road there, increase the radius or remove the
surface.

**In the game:** start the server (`node src/server/main.ts` with `PORT=8790`)
and open `http://localhost:8790/?mute=1&track=<id>&mode=practice`. With
Playwright you can control the game via `window.__megacars`:

```js
await page.evaluate((t) => __megacars.startRace({ track: t, opponents: 0, practice: true }), id);
await page.evaluate(() => __megacars.autopilot(true));   // the AI drives your car
await page.evaluate(() => __megacars.debug.zoom(2.5));   // zoom out
await page.evaluate(() => __megacars.debug.place(x, z)); // move the car (the camera follows)
await page.evaluate(() => __megacars.advance(600));      // step the simulation
```

Launch Chromium with `--use-angle=swiftshader --enable-unsafe-swiftshader`.
Check that the road and the pit are visible, that the landmarks made it in
and that nothing stands on the road.

## Changing an existing track

- Changed geometry (path, width, runoff, surfaces, ramps) is a simulation
  change. Bump `SIM_VERSION`, run `npm run track -- <id>` and the sim races
  again, and compare lap times and wall hits with before the change.
- Records are stored under the track's `id`. If you change the `id`, the
  track's records disappear. If you change the shape substantially, old
  records become incomparable, so mention that to the user.
- `width`, `cornerWiden` and `runoff` affect everything around them: the
  pit's position, the overlap check, the minimum radius and the scenery's
  distance. So run the full verification, not just one race.

## Pitfalls

- `getTrack()` caches built tracks per `id`. Give drafts their own ids and
  never reuse an id for a different shape in the same process.
- Tests that run over all tracks in `TRACK_LIST`:
  - `builder.test.ts`: the track builds without errors and has 8 grid slots.
  - `pit.test.ts`: a pit exists, and the AI drives in and repairs.
  - `catchUp.test.ts`: at least two arrows, more than 80 m from the start line.

  A new track must pass all three.
- Bump `SIM_VERSION` when a track is added or changed. Otherwise an old
  client can join a room whose track it doesn't know or builds differently.
- `laps` and `lapScale` go together with `raceLaps()`. Use `raceLaps(track, laps)`
  and not `def.laps` directly when you need the number of laps actually driven.
