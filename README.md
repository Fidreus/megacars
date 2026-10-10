# Megacars

Retro top-down combat racer for the browser, inspired by the Amiga classic
Super Cars II. 3D rendered at Amiga-like resolution with pixel-snapped
camera, toon shading and hard shadows; arcade drift physics where full-speed
corners are taken sideways.

## Kom igång

```bash
npm install
npm run dev        # Vite (http://localhost:5173) + spelserver (ws på 8787)
npm test           # fysik-, ban- och driftbenchmarktester
npm run typecheck
npm run build && npm start   # produktion: en server för spel + WebSocket på $PORT
```

## Styrning (driftsandlådan, M1)

| Tangent | Funktion |
|---|---|
| ↑ / W | Gas |
| ↓ / S | Broms / back |
| ← → / A D | Styr |
| R | Sätt tillbaka bilen på banan |
| P | Autopilot (AI kör din bil) |
| 1 | Debugvy (väggar, racinglinje, checkpoints) |
| 2 | Telemetri (slip, sidokraft, underlag) |
| 3 | Scanlines |
| 0 | Trimningspanel (lil-gui) |

Handkontroll: vänster spak styr, RT gas, LT broms.

URL-parametrar: `?ai=0..7` (antal AI-bilar), `?debug=1`, `?scale=N`
(pixelstorlek), `?mpp=0.19` (meter per pixel), `?scanlines=1`, `?mute=1`.

## Struktur

- `src/shared` – simulering som körs identiskt på server och klient (fysik,
  banor, AI, protokoll). Ingen DOM, ingen Node.
- `src/client` – rendering (Three.js), ljud, inmatning, UI.
- `src/server` – Node-server: statiska filer + WebSocket (`/ws`).
