import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import test from "node:test";

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
  const [page, layout, component, mapRoute, css, packageJson] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/layout.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/BirdFlight.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/api/osm/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
    readFile(new URL("../package.json", import.meta.url), "utf8"),
  ]);

  assert.match(page, /import \{ BirdFlight \}/);
  assert.match(page, /<BirdFlight \/>/);
  assert.match(layout, /Bird's Eye View — Fly over Dhaka/);
  assert.match(component, /new THREE\.WebGLRenderer/);
  assert.match(component, /dhaka-house-crow\.glb/);
  assert.match(component, /Hatirjheel Lake/);
  assert.match(component, /fetch\("\/api\/osm"\)/);
  assert.match(component, /addOpenStreetMapWorld/);
  assert.match(component, /HATIRJHEEL &amp; CENTRAL DHAKA/);
  for (const area of ["Moghbazar", "Tejgaon I\/A", "Niketan", "Gulshan 1", "Badda Link Road", "Rampura Bridge"]) {
    assert.match(component, new RegExp(area));
  }
  for (const area of ["Karwan Bazar", "Banglamotor", "Malibagh", "Mohakhali", "Banani", "Gulshan 2", "Merul Badda", "Aftabnagar", "Banasree"]) {
    assert.match(component, new RegExp(area));
  }
  assert.match(component, /addProceduralDistrictTiles/);
  assert.match(component, /proceduralDistrictTiles/);
  assert.match(mapRoute, /south: 23\.742/);
  assert.match(mapRoute, /north: 23\.801/);
  assert.match(mapRoute, /BUILDING_CELL_SIZE = 250/);
  assert.match(mapRoute, /BUILDINGS_PER_CELL = 16/);
  assert.match(mapRoute, /spatiallySampleBuildings/);
  assert.match(mapRoute, /way\["building"\]/);
  assert.match(mapRoute, /relation\["building"\]\["type"="multipolygon"\]/);
  assert.match(component, /selectSpatiallyEvenBuildings/);
  assert.match(component, /buildColliderGrid/);
  for (const landmark of ["Holy Rosary Church", "Bashundhara City", "Hatirjheel Amphitheatre", "Police Plaza Concord", "BRAC Centre", "Four Points by Sheraton"]) {
    assert.match(component, new RegExp(landmark));
  }
  assert.match(component, /© OpenStreetMap contributors/);
  assert.doesNotMatch(component, /className="mission-card"/);
  assert.match(css, /\.flight-shell/);
  assert.match(css, /\.topbar\.in-flight/);
  assert.doesNotMatch(packageJson, /react-loading-skeleton/);
  await assert.rejects(access(new URL("../app/_sites-preview", import.meta.url)));
});
