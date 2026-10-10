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

## Styrning (driftsandlådan, M1)

På asfalt greppar bilen tills gränsen och understyr sedan – den sladdar inte
av sig själv. Driften startar du genom att **släppa gasen kort (under 0,3 s)
och trycka igen** medan du styr in i kurvan – eller genom att dutta på bromsen
(under 0,25 s) medan du styr. Längre rullning eller vanlig inbromsning startar
ingen drift. I sladden orkar däcken nästan dubbelt så
mycket sidokraft, så rätt timing tar dig genom skarpa kurvor mycket fortare.
Gas ökar sladdvinkeln, släpp gasen eller motstyr för att räta upp. Is, olja
och snö sladdar av sig själva.

| Tangent | Funktion |
|---|---|
| ↑ / W | Gas. Släpp + tryck igen medan du styr = drift |
| ↓ / S | Broms / back (en kort dutt medan du styr = drift) |
| ← → / A D | Styr |
| R | Sätt tillbaka bilen på banan |
| P | Autopilot (AI kör din bil) |
| M | Stämning: dag / solnedgång / natt |
| 3 | CRT: av / scanlines / full (mask + kurvatur) |
| 4 | Färger: full (standard) / 12-bit Amiga / 32 färger |
| V | Delad skärm (test, höger vy följer AI-bil 1) |
| 1 | Debugvy (väggar, racinglinje, checkpoints) |
| 2 | Telemetri (slip, sidokraft, underlag) |
| 0 | Trimningspanel (lil-gui) |

Handkontroll: vänster spak styr, RT gas, LT broms.

URL-parametrar: `?ai=0..7` (antal AI-bilar), `?mood=day|sunset|night`,
`?debug=1`, `?scale=N` (pixelstorlek), `?mpp=0.19` (zoom: meter per pixel vid 270 linjer),
`?scanlines=1`, `?mute=1`.

Felsökning i konsolen: `__megacars.state()`, `.advance(ticks)`, `.pause()`,
`.autopilot()`, `.debug.crawlTest()` (1 = ingen pixelkrypning),
`.debug.bench()`, `.debug.look({ mood, palette, crt })` och
`.debug.snap(namn)` som sparar en skärmdump i `screenshots/` (bara i dev).

## Struktur

- `src/shared` – simulering som körs identiskt på server och klient (fysik,
  banor, AI, protokoll). Ingen DOM, ingen Node.
- `src/client` – rendering (Three.js), ljud, inmatning, UI.
- `src/server` – Node-server: statiska filer + WebSocket (`/ws`).
