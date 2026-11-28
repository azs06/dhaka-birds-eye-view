import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import test from "node:test";
import { resolveBuildingCollision } from "../app/flight-collision.mjs";
import { buildMetroCorridor, metroGirderSampleCount } from "../app/metro-corridor.ts";
import { BIRDS } from "../app/birds.ts";
import { PLACE_NAMES_BN, STATION_TEXT_BN, STRINGS } from "../app/i18n.ts";

async function render() {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);

  return worker.fetch(
    new Request("http://localhost/", { headers: { accept: "text/html" } }),
    { ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) } },
    { waitUntil() {}, passThroughOnException() {} },
  );
}

test("server-renders the Bird's Eye View application shell", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);

  const html = await response.text();
  assert.match(html, /<title>Bird(?:'|&#x27;)s Eye View — Fly over Dhaka<\/title>/i);
  assert.match(html, /Take wing as a living, animated crow/);
  assert.match(html, /BirdFlight-[^"']+\.js/);
  assert.doesNotMatch(html, /codex-preview|Your site is taking shape|react-loading-skeleton/i);
});

test("keeps the finished flight experience free of starter preview code", async () => {
  const [page, layout, component, landmarkFootprints, mapRoute, weatherRoute, css, packageJson] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/layout.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/BirdFlight.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/dhaka-landmark-footprints.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/osm/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/weather/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
    readFile(new URL("../package.json", import.meta.url), "utf8"),
  ]);
  // Interface text lives in the strings file, in English and Bengali.
  const strings = await readFile(new URL("../app/i18n.ts", import.meta.url), "utf8");

  assert.match(page, /import \{ BirdFlight \}/);
  assert.match(page, /<BirdFlight \/>/);
  assert.match(layout, /Bird's Eye View — Fly over Dhaka/);
  assert.match(component, /new THREE\.WebGLRenderer/);
  assert.equal(BIRDS[0].model, "/models/dhaka-house-crow.glb");
  assert.match(component, /loadBird\(birdTraits, false\)/);
  assert.match(component, /Hatirjheel Lake/);
  assert.match(component, /fetch\("\/api\/osm",/);
  assert.match(component, /fetch\("\/dhaka-map\.json",/);
  assert.match(component, /addOpenStreetMapWorld/);
  assert.match(component, /MeshToonMaterial/);
  assert.doesNotMatch(component, /folk-poster-frame/);
  assert.match(strings, /Greater Dhaka and its rivers/);
  for (const area of ["Moghbazar", "Tejgaon I\/A", "Niketan", "Gulshan 1", "Badda Link Road", "Rampura Bridge"]) {
    assert.match(component, new RegExp(area));
  }
  for (const area of ["Karwan Bazar", "Banglamotor", "Malibagh", "Mohakhali", "Banani", "Gulshan 2", "Merul Badda", "Aftabnagar", "Banasree"]) {
    assert.match(component, new RegExp(area));
  }
  for (const area of ["Dhanmondi", "Farmgate", "Shahbagh", "Ramna", "Motijheel", "Khilgaon", "Agargaon", "Baridhara", "Kuril", "Bashundhara R/A"]) {
    assert.match(component, new RegExp(area));
  }
  for (const area of ["Mohammadpur", "Mirpur 10", "Uttara", "Purbachal", "Demra", "Old Dhaka", "Lalbagh", "Keraniganj"]) {
    assert.match(component, new RegExp(area));
  }
  for (const landmark of ["Jatiya Sangsad Bhaban", "Lalbagh Fort", "Ahsan Manzil", "Central Shaheed Minar", "Curzon Hall", "Baitul Mukarram"]) {
    assert.match(component, new RegExp(landmark));
  }
  for (const landmarkKind of ["parliament", "lalbagh-fort", "ahsan-manzil", "shaheed-minar", "curzon-hall", "baitul-mukarram"]) {
    assert.match(component, new RegExp(`landmark\\.kind === "${landmarkKind}"`));
  }
  assert.match(component, /label: "Baitul Mukarram"[^\n]+minimap: true/);
  assert.match(component, /DHAKA_LANDMARK_FOOTPRINTS/);
  assert.match(component, /OpenStreetMap-accurate Dhaka landmarks/);
  assert.match(component, /landmarkOsmIds/);
  assert.match(component, /new THREE\.ExtrudeGeometry\(polygonShape\(points\)/);
  for (const osmId of [717625483, 24448713, 366560370, 229029081, 498432169, 24448328, 624024881, 624025791, 941979151, 264272612, 186664126]) {
    assert.match(landmarkFootprints, new RegExp(`"osmId": ${osmId}`));
  }
  assert.match(landmarkFootprints, /Snapshot of real landmark footprints from OpenStreetMap/);
  assert.doesNotMatch(component, /const addPointedArchInset/);
  assert.doesNotMatch(component, /addFolkBuildingPosters/);
  assert.match(component, /DHAKA_LANDMARKS\.filter\(\(landmark\) => landmark\.minimap\)/);
  for (const waterway of ["Buriganga River", "Turag River", "Tongi Khal", "Balu River", "Shitalakshya River"]) {
    assert.match(component, new RegExp(waterway));
  }
  assert.match(component, /addProceduralDistrictTiles/);
  assert.match(component, /proceduralDistrictTiles/);
  assert.match(component, /createAirflowVfx/);
  assert.match(component, /createWeatherVfx/);
  assert.match(component, /flightAudio\.thunder\(strength, delay\)/);
  assert.match(component, /thunderWeather = mode === "rain" \|\| mode === "storm"/);
  assert.match(component, /const droplets = new THREE\.Points/);
  assert.match(component, /dataset\.rainDrops/);
  assert.match(component, /setWeather\(snapshot\.mode, snapshot\.precipitation\)/);
  assert.match(component, /createFlightRadio/);
  assert.match(component, /scheduleBirdCall/);
  assert.match(component, /const leafRustle/);
  assert.match(component, /const cityBed/);
  assert.doesNotMatch(component, /const crickets/);
  assert.match(strings, /Game sound: wind, wings, the city, real bird calls and rain/);
  // The world's sound has to be audible on its own, with the radio optional on
  // top: wingbeats follow the flap clip and street sounds exist.
  assert.match(component, /flightAudio\.wingbeat\(/);
  assert.match(component, /const scheduleStreetSound/);
  assert.match(component, /if \(!wanted\) return false;/);
  // Ducking must stay a step listeners can actually hear (~7 dB), not ~1 dB.
  assert.match(component, /RADIO_DUCKED_AMBIENCE_GAIN = 0\.12/);
  assert.match(component, /Monsoon Drift/);
  assert.match(component, /Soft rain · distant chimes · no interruptions/);
  assert.match(component, /scheduleGentleMelody/);
  assert.doesNotMatch(component, /oscillator\.type = index === 0 \? "sine" : "triangle"/);
  for (const station of ["Radio Foorti", "Dhaka FM", "Jago FM"]) {
    assert.match(component, new RegExp(station));
  }
  assert.match(component, /\/api\/radio\?station=foorti/);
  assert.match(component, /\/api\/radio\?station=jago/);
  assert.match(component, /\[\["R", "\[", "\]"\], t\.keyRadio\]/);
  assert.match(component, /fetch\("\/api\/weather"/);
  assert.match(component, /weatherVfx\.update/);
  for (const weatherMode of ["cloudy", "fog", "drizzle", "rain", "storm"]) {
    assert.match(weatherRoute, new RegExp(`mode: "${weatherMode}"`));
  }
  assert.match(weatherRoute, /api\.open-meteo\.com\/v1\/forecast/);
  assert.match(weatherRoute, /cloud_cover/);
  assert.match(weatherRoute, /daily", "sunrise,sunset/);
  assert.match(weatherRoute, /timeformat", "unixtime/);
  assert.match(weatherRoute, /wind_direction_10m/);
  assert.match(weatherRoute, /stale-while-revalidate=600/);
  assert.match(component, /function solarPosition/);
  assert.match(component, /function liveDaylightAmount/);
  assert.match(component, /sky\.scale\.setScalar\(8_000\)/);
  assert.match(component, /sky\.position\.copy\(camera\.position\)/);
  assert.match(component, /skyUniforms\.sunPosition\.value\.copy\(sunDirection\)/);
  assert.match(component, /dataset\.daylightAmount/);
  assert.match(component, /dataset\.sunElevation/);
  assert.match(component, /dataset\.nightReadability/);
  assert.match(component, /const nightExposure = mode === "storm" \? 0\.88/);
  assert.match(component, /const moonlightKey =/);
  assert.match(component, /nightGlowIntensity = 0\.78/);
  assert.match(component, /const BRAKE_SPEED = 18/);
  assert.match(component, /const DEFAULT_FLIGHT_ALTITUDE = 130/);
  assert.match(component, /const MAX_FLIGHT_ALTITUDE = 650/);
  assert.match(component, /const CEILING_EASE_DEPTH = 90/);
  assert.match(strings, /Inspect next landmark/);
  assert.match(component, /const MIN_CEILING_CLIMB_SPEED = 1\.8/);
  assert.match(component, /const spawnAlt = Number\(spawnParams\.get\("alt"\)\) \|\| DEFAULT_FLIGHT_ALTITUDE/);
  assert.match(component, /crow\.position\.set\(spawnWorld\.x, spawnAlt, spawnWorld\.y\)/);
  assert.match(component, /verticalSpeed = Math\.min\(22, verticalSpeed \+ 8\.5 \* flapLiftScale\)/);
  assert.match(component, /const ceilingClimbScale = THREE\.MathUtils\.smoothstep/);
  assert.match(component, /Math\.max\(\s*MIN_CEILING_CLIMB_SPEED,/);
  assert.match(component, /climb > 0 && crow\.position\.y >= MAX_FLIGHT_ALTITUDE - 1/);
  assert.match(component, /verticalSpeed = Math\.min\(verticalSpeed, 0\)/);
  assert.doesNotMatch(component, /verticalSpeed = Math\.min\(verticalSpeed, -3\)/);
  // The struck collider is passed so a glancing hit slides along the wall
  // instead of pinning the crow in place while forward is held.
  assert.match(component, /resolveBuildingCollision\(crow\.position, previousPosition, struckBuilding\)/);
  // A slide at a concave corner must not deposit the crow inside the neighbour.
  assert.match(component, /if \(buildingAt\(crow\.position\.x, crow\.position\.y, crow\.position\.z\)\) \{\s*\n\s*resolveBuildingCollision\(crow\.position, previousPosition\);/);
  assert.match(component, /\[\["Ctrl", "Q"\], t\.hintBrakeKey\]/);
  assert.match(strings, /unitVertical: "m\/s"/);
  assert.match(mapRoute, /south: 23\.655/);
  assert.match(mapRoute, /north: 23\.905/);
  assert.match(mapRoute, /CORE_BUILDING_BOUNDS/);
  assert.match(mapRoute, /BUILDING_CELL_SIZE = 250/);
  assert.match(mapRoute, /BUILDINGS_PER_CELL = 16/);
  assert.match(mapRoute, /MAX_BUILDINGS = 5_200/);
  assert.match(mapRoute, /spatiallySampleBuildings/);
  assert.match(mapRoute, /topologicallySampleRoads/);
  assert.match(mapRoute, /connectedRoads\.length === 2/);
  assert.match(mapRoute, /roadPriority\(roads\[connectedRoads\[0\]\]\.kind\)/);
  assert.match(mapRoute, /missingRequiredTiles\.length > 0/);
  assert.match(mapRoute, /required tiles missing/);
  assert.match(component, /TRAFFIC_ROUTE_SAMPLE_RATIO = 0\.5/);
  assert.match(component, /TRAFFIC_MAX_VEHICLES = 1_800/);
  assert.match(component, /TRAFFIC_BASE_TICK_HZ = 10/);
  assert.match(component, /TRAFFIC_THROTTLED_TICK_HZ = 5/);
  assert.match(component, /createTrafficSimulation/);
  assert.match(component, /Sampled real-time traffic/);
  assert.match(component, /trafficSimulation\?\.update\(dt, frameMs\)/);
  assert.match(strings, /SAMPLED SIM TRAFFIC/);
  assert.match(mapRoute, /way\["building"\]/);
  assert.match(mapRoute, /relation\["building"\]\["type"="multipolygon"\]/);
  assert.match(mapRoute, /relation\["natural"="water"\]\["type"="multipolygon"\]/);
  assert.match(component, /selectSpatiallyEvenBuildings/);
  assert.match(component, /buildColliderGrid/);
  for (const landmark of ["Holy Rosary Church", "Bashundhara City", "Hatirjheel Amphitheatre", "Police Plaza Concord", "BRAC Centre", "Four Points by Sheraton"]) {
    assert.match(component, new RegExp(landmark));
  }
  assert.match(strings, /© OpenStreetMap contributors/);
  assert.doesNotMatch(component, /className="mission-card"/);

  // Night city lighting: the merged OSM batches are the city the player actually
  // flies over, so they must carry the procedural window shader, and the day/night
  // driver must be the thing that turns it on.
  assert.match(component, /function applyNightWindows/);
  assert.match(component, /totalEmissiveRadiance \+= bevWindowTint/);
  assert.match(component, /const buildingMaterials = \[[^\]]+\]\.map\(\s*\(color\) => applyNightWindows/);
  assert.match(component, /NIGHT_WINDOW_GLOW\.value = \(1 - daylightStrength\)/);
  assert.match(component, /centerLineMaterial\.userData\.nightGlowIntensity/);
  assert.match(component, /customProgramCacheKey/);

  // Static shadow map: the world never moves, so it must not redraw every frame.
  assert.match(component, /renderer\.shadowMap\.autoUpdate = false/);
  assert.match(component, /requestShadowUpdate\(\)/);

  // Touch flight must exist and must feed the same axes the keyboard drives.
  // The bindings are `let` so a committed landing can steer them, but touch and
  // keyboard must still converge on one axis pair rather than two parallel ones.
  assert.match(component, /function TouchStick/);
  assert.match(component, /function TouchHoldButton/);
  assert.match(component, /(?:const|let) turn = active \? \(keyTurn \|\| pointerTurn\) : 0/);
  assert.match(component, /(?:const|let) climb = active \? \(keyClimb \|\| pointerClimb\) : 0/);
  assert.match(component, /className="touch-controls"/);
  assert.doesNotMatch(component, /DESKTOP FLIGHT PROTOTYPE · KEYBOARD REQUIRED/);

  // Landing assistance. Cruise is 44 m/s against a 34 m capture sphere, so the
  // throttle has to know a perch is ahead — without this the bird crosses the
  // landing window in about a second and landing is a reflex test.
  assert.match(component, /const LANDING_APPROACH_RADIUS = \d+/);
  assert.match(component, /const LANDING_FLARE_RADIUS = \d+/);
  // The flare must actually reach the target-speed calculation.
  assert.match(component, /const assistedTarget = THREE\.MathUtils\.lerp\(cruiseTarget, flareTarget, approachBlend\)/);
  assert.match(component, /: assistedTarget;/);
  // Holding BOOST has to opt out, or the assist would fight a deliberate flyby.
  assert.match(component, /approachPerch && !boost/);
  // Only perches ahead of the bird may grab the throttle.
  assert.match(component, /dot\(horizontalForward\) < LANDING_APPROACH_COS\) continue/);
  // Committing from the approach zone must fly the bird in and settle it.
  assert.match(component, /landingCommit = approachPerch/);
  assert.match(component, /distanceTo\(landingCommit\.position\) < LANDING_CAPTURE_DISTANCE/);
  // Clipping a facade used to accelerate the bird to 28 m/s mid-approach.
  assert.match(component, /speed = Math\.max\(approachPerch \? LANDING_FLARE_SPEED : 28/);

  // Title screen: an attract camera and a press-start, not a held frame.
  assert.match(component, /if \(!flyingRef\.current\) \{/);
  assert.match(component, /const LAUNCH_SITES = \[/);
  assert.match(component, /event\.code !== "Enter" && event\.code !== "Space"/);
  // Two beats, like a flight-sim opening: the sky alone with "press any key",
  // then a slim bar of tiles that leaves the upper sky clear.
  assert.match(component, /useState<"title" \| "menu">\("title"\)/);
  assert.match(component, /className="title-sky" data-art=\{titleArt\} data-bird=\{skyBird\}/);
  assert.match(component, /className="menu-bar"/);
  assert.match(component, /className="menu-tile go" onClick=\{beginFlight\}/);
  assert.equal(STRINGS.en.startFlight, "Take off");
  for (const art of ["sky-dawn", "sky-dusk", "sky-dawn-phone"]) {
    await access(new URL(`../public/title/${art}.jpg`, import.meta.url));
    // The title sky shows the chosen bird; the crow uses the plain art.
    for (const bird of ["doel", "shalik", "chil", "tiya", "machhranga"]) {
      await access(new URL(`../public/title/${art}-${bird}.jpg`, import.meta.url));
    }
  }
  // In flight only five controls are on screen; each opens its own panel in place.
  for (const panel of ["hud-place", "hud-more", "hud-readout", "hud-map"]) {
    assert.match(component, new RegExp(`hud-w ${panel}`));
  }
  assert.match(component, /setHudOpen\(""\)/);

  // Keyboard fixes: focused controls keep their own keys, and Escape dismisses
  // the topmost layer before it doubles as the pause key.
  assert.match(component, /function focusedControlClaim/);
  assert.match(component, /if \(focusedControlClaimsKey\(focusedControlClaim\(event\.target\), event\.code\)\) return;/);
  // Escape must never be surrendered to a focused control, or the pause dialog's
  // own resume button would swallow the key the dialog tells you to press.
  assert.match(component, /if \(code === "Escape"\) return false;/);
  assert.match(component, /if \(dismissOverlayRef\.current\(\)\)/);
  assert.match(component, /const releaseInspection = \(\) => \{/);
  assert.doesNotMatch(component, /if \(\["Space", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"\]\.includes\(event\.code\)\) event\.preventDefault\(\);/);

  // Live weather has to be felt, not just displayed.
  assert.match(component, /WIND_DRIFT_SCALE = 0\.34/);
  assert.match(component, /weatherVfx\.readWind\(windDrift\)/);

  // Time-of-day override, so visitors are not stuck with whatever hour it is.
  assert.match(component, /function dhakaInstantAtHour/);
  assert.match(component, /const SKY_PRESETS: SkyPreset\[\]/);
  assert.match(component, /skyHourOverride === null \? Date\.now\(\) : dhakaInstantAtHour\(skyHourOverride\)/);

  // Teardown must release GPU textures and the WebGL context itself.
  assert.match(component, /renderer\.forceContextLoss\(\)/);
  assert.match(component, /value instanceof THREE\.Texture/);
  assert.match(css, /\.flight-shell/);
  // Warm kohl glass for every piece of chrome, brick only for commit actions,
  // and no yellow anywhere.
  assert.match(css, /--kohl: #2a2320/);
  assert.match(css, /--brick: #b8472d/);
  assert.doesNotMatch(css, /--acid|#f5d65a|rgba\(216,255,98/i);
  assert.match(css, /\.touch-stick/);
  assert.match(css, /\.touch-controls/);
  assert.match(css, /:focus-visible/);
  assert.match(css, /\.visually-hidden/);
  // Attribution and status text had shrunk to 6px, which is below readable.
  assert.doesNotMatch(css, /font: 500 6px var\(--font-mono\)/);

  // The radio proxy must not accept inherited Object keys as station names.
  const radioRoute = await readFile(new URL("../app/api/radio/route.ts", import.meta.url), "utf8");
  assert.match(radioRoute, /Object\.hasOwn\(LIVE_STREAMS, station\)/);
  // The connect timeout must be cleared once headers arrive: aborting the signal
  // also cancels the streamed body, which would cut playback off mid-song.
  assert.match(radioRoute, /clearTimeout\(connectTimer\);/);
  assert.doesNotMatch(radioRoute, /signal: AbortSignal\.timeout/);
  assert.doesNotMatch(packageJson, /react-loading-skeleton/);
  await assert.rejects(access(new URL("../app/_sites-preview", import.meta.url)));
});

test("Bengali translations cover the whole interface", async () => {
  const component = await readFile(new URL("../app/BirdFlight.tsx", import.meta.url), "utf8");
  const bengali = /[\u0980-\u09FF]/;

  // Both languages must define exactly the same strings, with the same placeholders.
  assert.deepEqual(Object.keys(STRINGS.bn).sort(), Object.keys(STRINGS.en).sort());
  for (const [key, english] of Object.entries(STRINGS.en)) {
    const translated = STRINGS.bn[key];
    assert.ok(translated.trim().length > 0, `${key} is empty in Bengali`);
    assert.deepEqual(
      (translated.match(/\{\w+\}/g) ?? []).sort(),
      (english.match(/\{\w+\}/g) ?? []).sort(),
      `${key} has different placeholders in Bengali`,
    );
  }

  // A Bengali string that is still Latin is an untranslated one. The product
  // name and the Enter key cap are the only ones meant to stay as they are.
  const latinByDesign = new Set(["brandName", "startKeyHint"]);
  for (const [key, translated] of Object.entries(STRINGS.bn)) {
    if (latinByDesign.has(key)) continue;
    assert.match(translated, bengali, `${key} has no Bengali text`);
  }

  // Every place, landmark, launch site and station named in the game has a
  // Bengali name, so nothing falls back to English mid-flight.
  const labels = new Set([...component.matchAll(/\blabel: "([^"]+)"/g)].map((match) => match[1]));
  for (const skip of ["LIVE", "DAWN", "NOON", "GOLDEN", "DUSK", "NIGHT", "Weather loading"]) labels.delete(skip);
  assert.ok(labels.size > 60, "expected the place labels to be found in the component");
  for (const label of labels) {
    assert.match(PLACE_NAMES_BN[label] ?? "", bengali, `${label} has no Bengali name`);
  }
  for (const id of [...component.matchAll(/^    id: "([^"]+)",$/gm)].map((match) => match[1])) {
    assert.match(STATION_TEXT_BN[id]?.name ?? "", bengali, `radio station ${id} has no Bengali name`);
  }

  // The scene is built once, so the frame loop must read the language through a
  // ref, and styling hooks must stay in English whatever is displayed.
  assert.match(component, /const locale = localeRef\.current;/);
  assert.match(component, /flightModeRef\.current\.dataset\.mode = mode;/);
  assert.match(component, /<main className=\{shellClass\} lang=\{locale\}/);
  assert.match(component, /"flight-shell",/);
});

test("every playable bird ships a model the game can animate", async () => {
  // The game swaps models without touching its animation code, which only works
  // if every species carries the same three clips driving the same joints.
  const targets = new Map();
  for (const bird of BIRDS) {
    const file = await readFile(new URL(`../public${bird.model}`, import.meta.url));
    assert.equal(file.toString("utf8", 0, 4), "glTF", `${bird.id} is not a binary glTF`);
    const gltf = JSON.parse(file.toString("utf8", 20, 20 + file.readUInt32LE(12)));
    assert.deepEqual(gltf.animations.map((clip) => clip.name), ["Flap", "Glide", "Rest"], `${bird.id} clips`);
    for (const clip of gltf.animations) {
      const channels = clip.channels.map((channel) => `${gltf.nodes[channel.target.node].name}.${channel.target.path}`).sort();
      const expected = targets.get(clip.name) ?? channels;
      targets.set(clip.name, expected);
      assert.deepEqual(channels, expected, `${bird.id} ${clip.name} drives different joints from the crow`);
    }
    assert.ok(gltf.meshes.length <= 60, `${bird.id} has ${gltf.meshes.length} meshes; parts should be merged`);
    // Names and notes must exist in both languages.
    for (const key of [bird.name, bird.note]) {
      assert.ok(STRINGS.en[key] && STRINGS.bn[key], `${bird.id} is missing ${key}`);
    }
  }
  assert.ok(BIRDS.length >= 6);

  // Recorded calls must exist, be credited, and be traceable to their source.
  const clips = JSON.parse(await readFile(new URL("../app/sound-clips.json", import.meta.url), "utf8"));
  const sources = JSON.parse(await readFile(new URL("../scripts/audio-sources.json", import.meta.url), "utf8"));
  const credits = await readFile(new URL("../public/audio/CREDITS.txt", import.meta.url), "utf8");
  const allowed = /^(CC0|Public domain|CC BY(-SA)? \d\.\d)$/;
  for (const source of sources) {
    assert.match(source.licence, allowed, `${source.title} has an unusable licence`);
    assert.match(source.page, /^https:\/\/commons\.wikimedia\.org\/wiki\/File:/);
    assert.ok(credits.includes(source.author) && credits.includes(source.page), `${source.title} is not credited`);
  }
  for (const url of Object.values(clips).flat()) {
    await access(new URL(`../public${url}`, import.meta.url));
    assert.ok(credits.includes(url.split("/").pop()), `${url} is missing from the credits`);
  }
  assert.equal(new Set(BIRDS.map((bird) => bird.id)).size, BIRDS.length);
});

test("building collision recovery lets a perched crow climb clear on takeoff", () => {
  const position = {
    x: 0,
    y: 78.28,
    z: 0,
    copy(source) {
      this.x = source.x;
      this.y = source.y;
      this.z = source.z;
    },
  };
  let verticalSpeed = 5;

  for (let frame = 0; frame < 20; frame++) {
    const previousPosition = { x: position.x, y: position.y, z: position.z };
    position.x += 0.5;
    position.y += verticalSpeed / 60;
    resolveBuildingCollision(position, previousPosition);
    verticalSpeed = Math.max(5, verticalSpeed);
  }

  assert.equal(position.x, 0);
  assert.ok(position.y > 79.5, `expected takeoff to clear the roof collider, got ${position.y}`);
});

test("a glancing building hit slides along the wall instead of pinning the crow", () => {
  const makePosition = (x, y, z) => ({
    x,
    y,
    z,
    copy(source) {
      this.x = source.x;
      this.y = source.y;
      this.z = source.z;
    },
  });
  // A tower centred on the origin. The crow is already level with it on Z and
  // drifts east into its west face, so only the X axis is newly breached.
  const building = { x: 0, z: 0, halfWidth: 20, halfDepth: 20 };
  const overlaps = (point) =>
    Math.abs(point.x - building.x) < building.halfWidth && Math.abs(point.z - building.z) < building.halfDepth;

  const position = makePosition(-19, 40, -6);
  const previousPosition = { x: -21, y: 40, z: -10 };
  resolveBuildingCollision(position, previousPosition, building);
  assert.equal(position.x, -21, "the newly breached axis is rejected");
  assert.equal(position.z, -6, "movement along the wall is preserved");

  // Repeated frames must keep making progress rather than restoring the same spot.
  const sliding = makePosition(-21, 40, -10);
  for (let frame = 0; frame < 12; frame++) {
    const previous = { x: sliding.x, y: sliding.y, z: sliding.z };
    sliding.x += 1.5;
    sliding.z += 3;
    // Mirror the render loop: only resolve when the step actually lands inside.
    if (overlaps(sliding)) resolveBuildingCollision(sliding, previous, building);
  }
  assert.ok(sliding.z > 20, `expected the crow to slide clear of the tower, got z=${sliding.z}`);
  assert.ok(
    !overlaps(sliding),
    `expected the crow to stay outside the footprint, got x=${sliding.x} z=${sliding.z}`,
  );
});

test("a collider that appears around the crow still rejects the whole step", () => {
  const position = {
    x: 5,
    y: 30,
    z: 5,
    copy(source) {
      this.x = source.x;
      this.y = source.y;
      this.z = source.z;
    },
  };
  // Both previous and current positions are inside the footprint, which is what
  // happens when a streamed-in collider materialises around the bird.
  const previousPosition = { x: 3, y: 28, z: 3 };
  resolveBuildingCollision(position, previousPosition, { x: 0, z: 0, halfWidth: 20, halfDepth: 20 });
  assert.equal(position.x, 3);
  assert.equal(position.z, 3);
  assert.equal(position.y, 30, "upward recovery is still preserved");
});

test("bundled Dhaka roads preserve connected major corridors", async () => {
  const snapshot = JSON.parse(await readFile(new URL("../public/dhaka-map.json", import.meta.url), "utf8"));
  const roads = snapshot.roads ?? [];
  const pointKey = ([x, z]) => `${Math.round(x * 10)}:${Math.round(z * 10)}`;
  const pointOccurrences = new Map();
  for (const road of roads) {
    for (const point of road.points) {
      const key = pointKey(point);
      pointOccurrences.set(key, (pointOccurrences.get(key) ?? 0) + 1);
    }
  }

  const majorKinds = new Set(["motorway", "trunk", "primary", "secondary"]);
  let majorInteriorEndpoints = 0;
  let unmatchedMajorInteriorEndpoints = 0;
  for (const road of roads.filter((entry) => majorKinds.has(entry.kind))) {
    for (const point of [road.points[0], road.points.at(-1)]) {
      if (Math.abs(point[0]) >= 11_000 || Math.abs(point[1]) >= 13_800) continue;
      majorInteriorEndpoints++;
      if (pointOccurrences.get(pointKey(point)) === 1) unmatchedMajorInteriorEndpoints++;
    }
  }

  assert.equal(roads.length, 2_600);
  assert.ok(majorInteriorEndpoints > 500, "expected a substantial major-road network");
  assert.ok(
    unmatchedMajorInteriorEndpoints / majorInteriorEndpoints < 0.05,
    `too many major roads terminate inside the map: ${unmatchedMajorInteriorEndpoints}/${majorInteriorEndpoints}`,
  );
});

test("metro corridor clearance keeps procedural and OSM buildings out of the viaduct and stations", async () => {
  const component = await readFile(new URL("../app/BirdFlight.tsx", import.meta.url), "utf8");
  assert.match(component, /metroCorridor\.blocksCircle\(buildingX, buildingZ, buildingRadius\)/);
  assert.match(component, /metroCorridor\.blocksCircle\(x, z, Math\.hypot\(halfWidth, halfDepth\)\)/);
  assert.match(component, /metroCorridor\.blocksPolygon\(building\.points\)/);
  assert.match(component, /const GIRDER_SAMPLES = metroGirderSampleCount\(curveLength\)/);

  // Unit checks on an east-west viaduct with a station at the origin.
  const corridor = buildMetroCorridor(
    [[-200, 0], [0, 0], [200, 0]],
    [{ x: 0, z: 0, tx: 1, tz: 0 }],
  );
  assert.equal(corridor.blocksCircle(120, 4, 8), true, "procedural building clipping the viaduct is rejected");
  assert.equal(corridor.blocksCircle(120, 30, 8), false, "procedural building safely clear of the viaduct stays");
  assert.equal(corridor.blocksCircle(35, 16, 6), true, "building touching the station hall is rejected");
  assert.equal(corridor.blocksCircle(0, 38, 6), true, "building touching the station stair entrance is rejected");
  assert.equal(corridor.blocksCircle(35, 42, 6), false, "building clear of both hall and stairs stays");

  const crossingPoly = [[90, -25], [110, -25], [110, 25], [90, 25]];
  assert.equal(corridor.blocksPolygon(crossingPoly), true, "OSM footprint crossing the viaduct is rejected");
  const clearPoly = [[90, 20], [110, 20], [110, 40], [90, 40]];
  assert.equal(corridor.blocksPolygon(clearPoly), false, "OSM footprint clear of the viaduct stays");

  // Against the real bundled Dhaka map: blocks the Khamarbari curve & OSM station footprints without clearing the city.
  const THREE = await import("three");
  const snapshot = JSON.parse(await readFile(new URL("../public/dhaka-map.json", import.meta.url), "utf8"));
  const line0 = snapshot.metroLines[0];
  const curve = new THREE.CatmullRomCurve3(
    line0.map(([x, z]) => new THREE.Vector3(x, 18, z)),
    false,
    "centripetal",
    0.28,
  );
  const samples = metroGirderSampleCount(curve.getLength());
  const sampled = [];
  for (let i = 0; i <= samples; i++) {
    const p = curve.getPointAt(i / samples);
    sampled.push([p.x, p.z]);
  }
  const stations = snapshot.metroStations.map((station) => {
    let bestU = 0;
    let bestD2 = Infinity;
    for (let i = 0; i <= 1600; i++) {
      const p = curve.getPointAt(i / 1600);
      const d2 = (p.x - station.point[0]) ** 2 + (p.z - station.point[1]) ** 2;
      if (d2 < bestD2) {
        bestD2 = d2;
        bestU = i / 1600;
      }
    }
    const p = curve.getPointAt(bestU);
    const t = curve.getTangentAt(bestU);
    const len = Math.hypot(t.x, t.z) || 1;
    return { x: p.x, z: p.z, tx: t.x / len, tz: t.z / len };
  });
  const dhakaCorridor = buildMetroCorridor(sampled, stations);

  // Khamarbari/Bijoy Sarani curve off the main road (where procedural boxes used to spawn on the viaduct).
  assert.equal(dhakaCorridor.blocksCircle(-3415, 1200, 12), true);
  let rejected = 0;
  for (const building of snapshot.buildings) {
    if (dhakaCorridor.blocksPolygon(building.points)) rejected++;
  }
  assert.ok(rejected >= 10, `expected OSM metro station/overlapping buildings to be rejected, got ${rejected}`);
  assert.ok(rejected < 80, `expected clearance to remain surgical, rejected ${rejected}/${snapshot.buildings.length}`);
});

test("climb and dive orientation pitches the bird nose-up on ascent and nose-down into stoops", async () => {
  const [component, THREE] = await Promise.all([
    readFile(new URL("../app/BirdFlight.tsx", import.meta.url), "utf8"),
    import("three"),
  ]);

  // Bird models face -Z with +Y up, so euler.set(pitch, yaw, roll) must keep +pitch
  // (never -pitch, which inverted nose-down on climbs and nose-up on dives).
  assert.match(component, /euler\.set\(pitch, yaw, roll\)/);
  assert.doesNotMatch(component, /euler\.set\(-pitch, yaw, roll\)/);

  const climbQuat = new THREE.Quaternion().setFromEuler(new THREE.Euler(0.42, 0, 0, "YXZ"));
  const diveQuat = new THREE.Quaternion().setFromEuler(new THREE.Euler(-0.48, 0, 0, "YXZ"));
  const climbBeak = new THREE.Vector3(0, 0, -1).applyQuaternion(climbQuat);
  const diveBeak = new THREE.Vector3(0, 0, -1).applyQuaternion(diveQuat);
  assert.ok(climbBeak.y > 0.35, `climbing pitch must lift the beak (+Y), got ${climbBeak.y}`);
  assert.ok(diveBeak.y < -0.4, `diving pitch must point the beak downward (-Y), got ${diveBeak.y}`);

  // Climbing drives active wingbeats, diving folds wings into a stoop, and airflow
  // lives in world space rather than spinning with the bird group.
  assert.match(component, /const airflowVfx = createAirflowVfx\(scene, crow\)/);
  assert.match(component, /const climbFlap = clamp\(/);
  assert.match(component, /const diveSuppression = clamp\(/);
  assert.match(component, /swoopMomentum/);
});

test("horizontal bird picker ships portrait cards, sky sprites and per-bird animations", async () => {
  const [component, css] = await Promise.all([
    readFile(new URL("../app/BirdFlight.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
  ]);

  assert.match(component, /className="bird-card-media"/);
  assert.match(component, /className="title-sky-stage"/);
  assert.match(css, /\.menu-bird \.menu-list \{[^}]*grid-template-columns: repeat\(6,/);

  for (const plate of ["sky-dawn-clean", "sky-dusk-clean", "sky-dawn-phone-clean"]) {
    await access(new URL(`../public/title/${plate}.jpg`, import.meta.url));
  }
  for (const bird of BIRDS) {
    await access(new URL(`../public/title/card-${bird.id}.jpg`, import.meta.url));
    await access(new URL(`../public/title/bird-sky-dawn-${bird.id}.png`, import.meta.url));
    await access(new URL(`../public/title/bird-sky-dusk-${bird.id}.png`, import.meta.url));
    assert.match(css, new RegExp(`@keyframes bird-enter-${bird.id}\\b`), `${bird.id} missing entrance animation`);
    assert.match(css, new RegExp(`@keyframes bird-flap-${bird.id}\\b`), `${bird.id} missing wing animation`);
  }
});
