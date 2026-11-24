# Bird's Eye View — Fly over Dhaka

Take wing as a house crow, or another of the city's birds, over a stylised Greater Dhaka built from real
OpenStreetMap geometry, live weather, and the city's real solar clock.

Built on [vinext](https://github.com/cloudflare/vinext) and deployed as a
Cloudflare Worker.

## The flight

- **World** — OpenStreetMap buildings, roads, waterways, and the MRT Line 6
  alignment, fetched live from Overpass with a bundled snapshot
  (`public/dhaka-map.json`) as fallback. Procedural district tiles fill the gaps
  out to ±12 km, and sampled traffic runs on the real road network.
- **Sky** — driven by Dhaka's actual solar position and live Open-Meteo
  conditions, so rain, cloud, fog, and storms are whatever the city is having.
  After dark the whole city lights up: a procedural window grid evaluated in the
  fragment shader, plus glowing road markings.
- **Weather you can feel** — the live wind vector pushes the bird, gusting and
  strengthening with altitude, so a stiff breeze is a drift you correct for.
- **Landing** — fly at a landmark and the crow flares on its own, bleeding cruise
  speed down to a slow glide as the perch closes. Press `E` inside the capture
  ring to settle, or press it from up to 200 m out to commit: the bird then flies
  the approach itself and lands. `E` again waves off. Treetops still work as
  quick opportunistic perches.

## Controls

| Keyboard | Touch | Action |
| --- | --- | --- |
| `W` / `S` | drag the pad | Climb / dive |
| `A` / `D` | drag the pad | Bank left / right |
| `Space` | `FLAP` | Flap for a burst of lift |
| `Ctrl` / `Q` | hold `BRAKE` | Air-brake into a slow glide |
| `Shift` | hold `BOOST` | High-speed surge |
| `C` | `CAM` | Switch chase / first-person camera |
| `L` | `SITES` | Tour the landmarks |
| `E` | `LAND` | Land, commit to a guided approach, or take off |
| `P` / `Esc` | pause button | Pause. `Esc` closes the topmost panel first |
| `R` / `[` `]` | radio panel | Radio power / tune station |

## The welcome screen

The camera orbits the skyline while the map loads, so the game opens on a moving
city under its Bengali name, পাখির চোখে ঢাকা. Pick where to take off from to fly
the camera there before you start, then press `Take off` or just `Enter`. The
status line reports whether the city came from the live map or the saved one.

Touch controls appear automatically on devices with no mouse. Tap a pink diamond
on the minimap to fly the camera to that landmark, and use `◐` to hold the sky at
dawn, noon, golden hour, or night instead of following Dhaka's current time.

## Birds

Six Bangladeshi birds can be flown, chosen on the welcome screen or from the
pause panel: the house crow (পাতিকাক), the Oriental magpie-robin (দোয়েল, the
national bird), the common myna (ভাত শালিক), the black kite (ভুবন চিল), the
rose-ringed parakeet (সবুজ টিয়া), and the white-throated kingfisher (সাদাবুক
মাছরাঙা). The choice is remembered, and `?bird=` in a link overrides it.

All six share one skeleton and one flight model. They differ in shape, plumage,
size, and how they move their wings: the kite soars with barely a beat, the
parakeet and the robin flap almost constantly.

The models are generated, not hand-made. `scripts/create-birds.mjs` describes
each species as proportions, feather shapes, colours and markings, and
`npm run assets:birds` rebuilds every file in `public/models/`. `app/birds.ts`
lists them for the game.

## Sound

The world has its own sound, on from take-off: wind that builds with speed and
in a dive, a wingbeat on every downstroke, the city and its traffic rising as
you fly lower, car horns and rickshaw bells near the street, rain and thunder,
and the calls of the city's birds. `♫` opens a panel with a volume slider (the
setting is remembered) and a mute button.

The radio is separate and optional. Turn it on with `◉` or `R` and it plays
over the world's sound, which drops back but does not stop. It has its own
volume in its panel.

The bird calls are real field recordings from Wikimedia Commons: house crow,
magpie-robin, common myna, black kite, rose-ringed parakeet and Asian koel. The
bird you are flying calls close by; the others are heard at a distance. Wind,
wingbeats, city, traffic, rain and thunder are synthesised in the browser, and
so are bird calls until the recordings have loaded.

`scripts/audio-sources.json` lists each recording with its author, licence and
the seconds used. `npm run assets:audio` (needs `ffmpeg`) cuts and levels the
clips into `public/audio/` and regenerates `public/audio/CREDITS.txt`, which the
game links to from the flight manual. Most of the recordings are CC BY-SA, so
the clips stay under that licence and the credits must ship with them.

## Languages

The interface is in English and Bengali (বাংলা). Switch with the `বাংলা / English`
control in the top bar at any time, including mid-flight; the choice is remembered
on that device. A first visit follows the browser's language, and `?lang=bn` or
`?lang=en` in the link overrides it.

All interface text lives in `app/i18n.ts`, alongside the Bengali names of every
landmark, neighbourhood, river, and metro station. Key caps (`W`, `Ctrl`, `Enter`)
and the three-letter minimap codes stay in Latin script in both languages.

## Deep links

`SHARE THIS SPOT` copies a link back to wherever you are. The parameters also
work by hand:

| Parameter | Meaning |
| --- | --- |
| `lat`, `lon` | Spawn coordinates |
| `alt` | Spawn altitude in metres |
| `yaw` | Initial heading in radians |
| `sky` | `live`, `dawn`, `noon`, `golden`, `dusk`, or `night` |
| `lang` | `en` or `bn` |
| `bird` | `crow`, `doel`, `shalik`, `chil`, `tiya`, or `machhranga` |
| `touch` | `1` forces the touch HUD on, `0` forces it off |

Example: `/?lat=23.7280&lon=90.4090&alt=190&yaw=2.4&sky=dusk` — dusk over the
Buriganga.

## Diagnostics

In the browser console, `__birdFlightDiagnostics()` returns draw calls, triangle
and geometry counts, procedural tile counts, frame timings, traffic state, and a
`landing` block (current speed, targeted perch, range, and whether an approach is
committed) for tuning the flare.
The same values are mirrored onto the canvas element's `dataset` every 30 frames.

## Prerequisites

- Node.js `>=22.13.0`

## Quick Start

```bash
npm install
npm run dev
npm run build
```

## Deploying to Cloudflare

The app builds to a single Cloudflare Worker plus static assets. `wrangler.jsonc`
holds the Worker's name, entry point, and bindings.

```bash
npx wrangler login   # once per machine
npm run deploy       # vinext build, then wrangler deploy
```

The first deploy creates a Worker called `birds-eye-view` and prints its
`*.workers.dev` URL. Rename it by changing `name` in `wrangler.jsonc`. Attach a
custom domain from the Worker's **Settings → Domains & Routes** page, or add a
`routes` entry with `"custom_domain": true` to `wrangler.jsonc`.

To deploy on every push instead, connect the repository under **Workers & Pages
→ Create → Import a repository** (Workers Builds) with:

| Setting | Value |
| --- | --- |
| Build command | `npm run build` |
| Deploy command | `npx wrangler deploy` |

Notes:

- `vinext build` writes the resolved config to `dist/server/wrangler.json`, and
  `wrangler deploy` picks it up automatically. Always build before deploying;
  `npx wrangler deploy --dry-run` shows what would be uploaded.
- `npx wrangler dev` (after a build) runs the built Worker in the real Workers
  runtime locally. `npx wrangler tail` streams production logs.
- `/api/osm` depends on ten live Overpass queries and reshapes several megabytes
  of data per request, so it is the route most likely to fail or run slowly on
  Workers. When it errors or takes longer than 35 s the game loads the bundled
  `public/dhaka-map.json` instead.
- If `npm install` fails building `sharp` on a Mac with Homebrew's `vips`
  installed, run it as `SHARP_IGNORE_GLOBAL_LIBVIPS=1 npm install`.

## Project Layout

- `app/BirdFlight.tsx` holds the whole experience: world building, flight model,
  render loop, audio, and HUD
- `app/i18n.ts` holds the English and Bengali interface text and place names
- `app/flight-collision.mjs` is shared with the tests so collision behaviour is
  verified directly rather than through the renderer
- `app/dhaka-landmark-footprints.ts` is a snapshot of real landmark outlines from
  OpenStreetMap, so hero buildings stay stable when the live map is unavailable
- `app/api/osm`, `app/api/weather`, `app/api/radio` proxy Overpass, Open-Meteo,
  and the live radio streams
- `worker/index.ts` is the Cloudflare Worker entry point
- `wrangler.jsonc` configures the Worker; `vite.config.ts` wires vinext to it
- `scripts/create-birds.mjs` regenerates the bird models in `public/models/`
- `app/birds.ts` lists the playable birds

## Useful Commands

- `npm run dev`: start local development
- `npm run build`: produce the Worker and static assets in `dist/`
- `npm run start`: serve the production build locally
- `npm run deploy`: build and deploy to Cloudflare Workers
- `npm test`: build, then check the rendered shell, source invariants, flight
  collision, and the bundled map
- `npm run lint` / `npm run typecheck`: ESLint and `tsc --noEmit`
- `npm run assets:birds`: regenerate the bird models in `public/models/`

## Learn More

- [vinext Documentation](https://github.com/cloudflare/vinext)
- [Cloudflare Workers Documentation](https://developers.cloudflare.com/workers/)
