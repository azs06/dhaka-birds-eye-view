# Bird's Eye View — Fly over Dhaka

Take wing as a house crow over a stylised Greater Dhaka built from real
OpenStreetMap geometry, live weather, and the city's real solar clock.

Built on [vinext](https://github.com/cloudflare/vinext) and deployed as a
Cloudflare Worker. Platform notes for the underlying starter are further down.

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

## The title screen

The camera orbits the skyline while the map loads, so the game opens on a moving
city. Pick a launch site to fly the attract camera there before you start, then
`BEGIN FLIGHT` or just press `Enter`. The build-status line reports whether the
world came from live Overpass or the bundled snapshot.

Touch controls appear automatically on devices with no mouse. Tap a pink diamond
on the minimap to fly the camera to that landmark, and use `◐` to hold the sky at
dawn, noon, golden hour, or night instead of following Dhaka's current time.

## Deep links

`SHARE THIS SPOT` copies a link back to wherever you are. The parameters also
work by hand:

| Parameter | Meaning |
| --- | --- |
| `lat`, `lon` | Spawn coordinates |
| `alt` | Spawn altitude in metres |
| `yaw` | Initial heading in radians |
| `sky` | `live`, `dawn`, `noon`, `golden`, `dusk`, or `night` |
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

This starter does not use `wrangler.jsonc`.

## Included Shape

- `app/BirdFlight.tsx` holds the whole experience: world building, flight model,
  render loop, audio, and HUD
- `app/flight-collision.mjs` is shared with the tests so collision behaviour is
  verified directly rather than through the renderer
- `app/api/osm`, `app/api/weather`, `app/api/radio` proxy Overpass, Open-Meteo,
  and the live radio streams
- edit site code under `app/`
- `.openai/hosting.json` declares optional Sites D1 and R2 bindings
- `vite.config.ts` simulates declared bindings for local development
- `db/schema.ts` starts intentionally empty
- `examples/d1/` contains an optional D1 example surface
- `drizzle.config.ts` supports local migration generation when needed

## Workspace Auth Headers

OpenAI workspace sites can read the current user's email from
`oai-authenticated-user-email`.

SIWC-authenticated workspace sites may also receive
`oai-authenticated-user-full-name` when the user's SIWC profile has a non-empty
`name` claim. The full-name value is percent-encoded UTF-8 and is accompanied by
`oai-authenticated-user-full-name-encoding: percent-encoded-utf-8`.

Treat the full name as optional and fall back to email when it is absent:

```tsx
import { headers } from "next/headers";

export default async function Home() {
  const requestHeaders = await headers();
  const email = requestHeaders.get("oai-authenticated-user-email");
  const encodedFullName = requestHeaders.get("oai-authenticated-user-full-name");
  const fullName =
    encodedFullName &&
    requestHeaders.get("oai-authenticated-user-full-name-encoding") ===
      "percent-encoded-utf-8"
      ? decodeURIComponent(encodedFullName)
      : null;

  const displayName = fullName ?? email;
  // ...
}
```

## Optional Dispatch-Owned ChatGPT Sign-In

Import the ready-to-use helpers from `app/chatgpt-auth.ts` when the site needs
optional or required ChatGPT sign-in:

- Use `getChatGPTUser()` for optional signed-in UI.
- Use `requireChatGPTUser(returnTo)` for server-rendered pages that should send
  anonymous visitors through Sign in with ChatGPT.
- Use `chatGPTSignInPath(returnTo)` and `chatGPTSignOutPath(returnTo)` for
  browser links or actions.
- Pass a same-origin relative `returnTo` path for the destination after sign-in
  or sign-out. The helper validates and safely encodes it.
- Mark protected pages with `export const dynamic = "force-dynamic"` because
  they depend on per-request identity headers.

Dispatch owns `/signin-with-chatgpt`, `/signout-with-chatgpt`, `/callback`, the
OAuth cookies, and identity header injection. Do not implement app routes for
those reserved paths. Routes that do not import and call the helper remain
anonymous-compatible.

SIWC establishes identity only; it does not prove workspace membership. Use the
Sites hosting platform's access policy controls for workspace-wide restrictions,
or enforce explicit server-side membership or allowlist checks.

Use SIWC for account pages, user-specific dashboards, saved records, and write
actions tied to the current ChatGPT user. Leave public content anonymous.

## Useful Commands

- `npm run dev`: start local development
- `npm run build`: verify the vinext build output
- `npm test`: build the starter and verify its rendered loading skeleton
- `npm run db:generate`: generate Drizzle migrations after schema changes

## Learn More

- [vinext Documentation](https://github.com/cloudflare/vinext)
- [Drizzle D1 Guide](https://orm.drizzle.team/docs/get-started/d1-new)
