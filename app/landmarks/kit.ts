// LANDMARK MODULES — BUILDER GUIDE
// ================================
// One landmark = one file, app/landmarks/<key>.ts, default-exporting a
// LandmarkModule. The registry (./index.ts) already imports every key, and
// app/BirdFlight.tsx reads everything it needs from the module, so a new
// landmark is added by replacing the `null` stub in its own file and touching
// NOTHING else (not index.ts, not BirdFlight.tsx, not i18n.ts).
//
//   import { headingFromBearing, type LandmarkModule } from "./kit";
//   const landmark: LandmarkModule = {
//     key: "my-landmark",            // must equal the file name / registry key
//     label: "My Landmark",          // English name (floating label, HUD, map)
//     labelBn: "আমার ল্যান্ডমার্ক",      // established Bengali spelling
//     shortLabel: "MYL",             // 3 letters, minimap chip
//     lat: 23.7, lon: 90.4,          // the landmark's origin (local 0,0)
//     altitude: 18,                  // overall height in metres
//     heading: headingFromBearing(137), // compass bearing the FRONT faces
//     clearingRadius: 40,
//     extents: [12, 8],              // local half extents of the solid mass
//     triangleBudget: 1500,
//     build(kit) { const { group, addBox, materials } = kit; ... },
//   };
//   export default landmark;
//
// Import nothing but "./kit" (its types and the pure helper headingFromBearing).
// Never import "three" or BirdFlight: THREE comes in as `kit.THREE`, and
// build() is the only place THREE objects may be created (nothing at module
// scope — the scene is rebuilt and its geometry disposed).
//
// AXES, UNITS, HEADING
// - 1 unit = 1 metre. `kit.group` is centred on the module's lat/lon.
// - Local +Y is up. y = 0 is the landmark's ground plane, which sits 0.9 m
//   above the world's zero so it clears the road and ground layers: build
//   upward from y = 0 (a lawn or paving slab is a thin box at y ≈ 0.05–0.15).
// - Local +Z is the FRONT of the landmark (put the main facade, portal or
//   stair on +Z). Local +X is to the RIGHT of a visitor who stands in front
//   and looks at the facade (the building's own left).
// - With heading 0 the front (+Z) faces due SOUTH and +X points EAST.
//   A positive heading turns the front anticlockwise seen from above (south →
//   east → north): front compass bearing = 180° − heading. Use
//   `headingFromBearing(bearingDegrees)` rather than doing this by hand
//   (front faces east 90° → +π/2, north 0° → π, west 270° → −π/2).
// - `kit.toLocal(lat, lon)` turns a real coordinate into local [x, z];
//   `kit.worldToLocal(x, z)` does the same for a point of public/dhaka-map.json
//   (whose buildings/roads are already in world metres). Take the real
//   position, size and orientation from OpenStreetMap and lay parts out with
//   these rather than by eye.
//
// MESH HELPERS (all take the parent first — pass `kit.group`, or a
// sub-Group you added to it — and return the mesh so you can rotate it)
// - addBox(parent, [sx, sy, sz], [x, y, z], material): position is the CENTRE.
// - addCylinder(parent, rTop, rBottom, height, [x, y, z], material, segments):
//   centre position; keep segments low (8–16 small, 24–32 big drums).
// - addCone, addLathe(profile [[radius, y]…] turned round Y; position is the
//   base), domeProfile(radius, height, bulge) for masonry domes, addFinial,
//   addChhatri, addArcSlab (curved tiers/walls), addBeam (strut from a to b),
//   addSweptBox (ribbon along a path), addQuads, addPrism (extruded [x, z]
//   polygon from y up by height: any non-rectangular plan), addGeodesicDome,
//   addTree, addPalm.
// - Flat openings (windows, doors, arches drawn on a wall): roundArch,
//   pointedArch, rectPane, discPane, trianglePane make a geometry in the XY
//   plane with its origin at the bottom centre, facing +Z; stand one up with
//   addMesh(parent, geometry, material, [x, y, z], rotationY) a few
//   centimetres (0.08–0.25) proud of the wall, or run rows of them along a
//   plan polygon with wallEdges(points) + addBays(...). `materials.archDark`
//   (dark, glows at night) and `materials.glass`/`darkGlass` suit openings.
// - Anything else: build a `new kit.THREE.Mesh(geometry, material)` and add it
//   to the group yourself. Custom BufferGeometry MUST have position, normal
//   and uv attributes (see "baking" below).
//
// MATERIALS
// - Use `kit.materials.<name>` (whiteStone, cream, redBrick, concrete, lawn,
//   water, glass, roofGrey, …) wherever one fits.
// - For any other flat colour call `kit.material(0xd9b55a)` (optionally
//   `{ roughness, metalness }`): it is cached by colour and shared by every
//   landmark. `kit.litMaterial(color, strength)` is the same but glows after
//   dark (windows, signs). Call them inside build(), reuse the result.
// - NEVER `new THREE.Mesh…Material(...)`, never a material per mesh, no
//   textures, no canvases, no lights, no transparent materials.
//
// BAKING (why you need not merge by hand)
// After build() returns, every Mesh under `kit.group` is merged into ONE mesh
// per material and frozen (matrixAutoUpdate off). So draw calls = number of
// distinct materials you used: keep that to roughly ≤ 8. Consequences:
// - nothing can animate; no per-frame work, no onBeforeRender, no userData
//   hooks — the meshes you created no longer exist after build();
// - geometries of one material must share the attribute set position/normal/
//   uv. All the helpers and THREE's built-in geometries do. A custom geometry
//   without uv (or addGeodesicDome's glass) makes the WHOLE bucket of that
//   material vanish silently — give such geometry a material nothing else uses
//   or add a zero-filled uv attribute;
// - InstancedMesh and meshes with material arrays are left alone (not merged).
//   Use an InstancedMesh only for hundreds of identical parts; for a few dozen
//   repeated parts a plain loop of helper calls is right, the bake merges them;
// - every merged mesh casts and receives shadows; `.castShadow = false` on a
//   part has no effect.
//
// COLLIDERS, CLEARING, PERCH (all in local metres, heading applied for you)
// - Default: after build() one solid box of `extents` ([halfX, halfZ] about
//   the origin, local axes) is added, as tall as `altitude` — or the height you
//   pass to kit.setColliderTop(y). That is all a compact building needs.
// - Anything that is not one box (a tower on a podium, an L, pieces with
//   open ground or a road between them): call kit.setBoundsCollider(false)
//   and cover the masses yourself with kit.solidBox(x, z, halfX, halfZ, top),
//   kit.solid(x, z, half, top) (square column: towers, minarets, pillars) or
//   kit.solidTiles(x0, x1, z0, z1, top) (a big turned rectangle as small
//   boxes). Colliders are world-axis boxes, so a long box on a diagonal
//   heading over-covers its corners — use solidTiles for those. The bird
//   flies through anything without a collider; never lay a solid across a
//   road, a gateway or a courtyard the bird should fly through.
// - Colliders also keep the generic city out: any OSM-snapshot building,
//   procedural plot or street tree overlapping a collider (+ a 16 m forecourt
//   for procedural plots, `plotGap` to change) is not drawn.
// - kit.clearSite(x, z, halfX, halfZ) / kit.clearOval(...) do only that
//   clearing — for your plaza, lawn, forecourt or pool — and can never be
//   struck. Clear exactly your own plot: neighbours that really exist should
//   stay. Roads, water and other landmarks are NOT affected by colliders, so
//   keep your geometry off the carriageways yourself (major roads are drawn
//   14 m wide on the snapshot centreline, minor ones 7.5 m).
// - `clearingRadius` (metres about lat/lon) only thins the far-distance
//   low-detail city mass; set it to roughly the radius of your plot (20–40 for
//   a monument, 60–120 for a building or compound).
// - `replacesOsmBuildingIds`: ids of public/dhaka-map.json buildings that ARE
//   your landmark (find them with a few lines of node over the JSON, by `name`
//   or by distance from kit-world coordinates). They are hidden even where no
//   collider covers them. Do not list neighbours.
// - `park`: an optional lawn-and-trees ellipse (lat, lon, rx, rz in metres,
//   angle) for a landmark that stands in a garden. It removes EVERY generic
//   building inside it and plants trees, so keep it to the real grounds; do
//   not add one inside an existing park or campus.
// - Perch: the bird lands on top of whatever is built at the origin. If the
//   origin is open ground (a courtyard, a road) call kit.setPerchTarget(x, z)
//   with a point on a roof, dome or pillar top (not exactly 0, 0).
//
// TRIANGLE GUIDE (counted after baking; going over `triangleBudget` logs a
// console error, and the count is in
// `window.__birdFlightDiagnostics().landmarkModules["<key>"]` as
// { triangles, drawCalls, budget, error? } — `error` is set, and the landmark
// left out, when build() throws. The capture helper lmshot.mjs, which sits
// beside shot.mjs and takes the same arguments plus the key
// (`node lmshot.mjs "<query>" <out.jpg> <key>`), prints it as diag.landmark)
// - small monument / sculpture / gate: ≤ 1 500
// - one building: ≤ 4 000
// - hero complex (campus, several blocks, stadium): ≤ 8 000
// A box is 12, a 12-segment cylinder 48, a 16×12 lathe ≈ 380, an arched pane
// ≈ 12. Spend triangles on the silhouette (roofline, domes, towers, the one
// feature people recognise), not on window grids: one dark band per storey
// reads better from the air than 200 panes.
//
// STYLE
// Simplified, recognisable silhouettes from a few dozen primitives, flat
// colours, real proportions (OSM footprint, photo for heights and colours).
// Offset coplanar faces by ≥ 0.05 m so they do not z-fight. Look at the
// "shapla-chattar", "gulshan-central-mosque" and "kamalapur-station" branches
// in BirdFlight.tsx (grep `landmark.kind === "…"`) and ./dhaka-gate.ts.
//
// CHECK YOUR OWN FILE ONLY
//   npx tsc --noEmit --incremental false -p . 2>&1 | grep "app/landmarks/<key>" ; npx eslint app/landmarks/<key>.ts
// (no output from the first, exit 0 from the second). A syntax error in your
// file breaks the shared dev server for everyone: typecheck before each shot.

import type * as THREE from "three";

export type Vec3 = [number, number, number];
/** A plan point in metres: [x, z]. */
export type PlanPoint = [number, number];
/** One wall of a plan polygon, as returned by `wallEdges`. */
export type WallEdge = { ax: number; az: number; dx: number; dz: number; nx: number; nz: number; length: number; rotationY: number };
export type BayStorey = { y: number; opening: THREE.BufferGeometry; surround?: THREE.BufferGeometry };
/** Corner order a, b, c, d round the quad, then the direction it must face. */
export type Quad = [Vec3, Vec3, Vec3, Vec3, Vec3];

/** Shared flat-colour materials, by name. Prefer these to new colours. */
export type LandmarkMaterialName =
  | "concrete" | "paleConcrete" | "agedConcrete" | "boardConcrete" | "sageConcrete"
  | "whiteStone" | "marble" | "cream" | "stationCream" | "oliveBuff" | "fadedPaint"
  | "brick" | "redBrick" | "deepBrick" | "brickTrim" | "terracotta" | "plazaBrick" | "plazaRed" | "tileRoof"
  | "peach" | "salmon" | "pink" | "pinkTrim" | "roseBeige" | "monumentRed" | "canopyBeige"
  | "glass" | "darkGlass" | "ribbonGlass" | "atriumGlass" | "skyGlass" | "archDark" | "recess"
  | "accent" | "bronze" | "copperDark" | "silverPanel" | "tinRoof" | "roofGrey" | "plantGrey" | "roofTerrace" | "stoneStep"
  | "lawn" | "packedEarth" | "water" | "poolTurquoise" | "tealArch" | "seatGreen"
  | "wornAsphalt" | "yardPaving"
  | "bark" | "canopy" | "lightCanopy" | "krishnachura";

export interface LandmarkKit {
  /** The three.js namespace. Modules must not import "three" themselves. */
  THREE: typeof THREE;
  /** The landmark's own group: origin at its lat/lon, turned by its heading. */
  group: THREE.Group;
  materials: Record<LandmarkMaterialName, THREE.Material>;
  /** A flat-colour material, cached by colour and shared across landmarks. */
  material(color: number, options?: { roughness?: number; metalness?: number }): THREE.Material;
  /** As `material`, but glowing after dark with the city's windows. */
  litMaterial(color: number, strength?: number, tint?: number): THREE.Material;

  addBox(parent: THREE.Object3D, size: Vec3, position: Vec3, material: THREE.Material): THREE.Mesh;
  addCylinder(parent: THREE.Object3D, radiusTop: number, radiusBottom: number, height: number, position: Vec3, material: THREE.Material, segments?: number): THREE.Mesh;
  addCone(parent: THREE.Object3D, radius: number, height: number, position: Vec3, material: THREE.Material, segments?: number): THREE.Mesh;
  /** A solid of revolution from [radius, y] pairs; `flat` gives faceted sides. */
  addLathe(parent: THREE.Object3D, profile: Array<[number, number]>, segments: number, position: Vec3, material: THREE.Material, flat?: boolean): THREE.Mesh;
  /** Lathe profile of a masonry dome; `bulge` > 0 swells it (Mughal domes). */
  domeProfile(radius: number, height: number, bulge?: number, steps?: number): Array<[number, number]>;
  addFinial(parent: THREE.Object3D, position: Vec3, size?: number, material?: THREE.Material): void;
  /** A small domed roof kiosk, `size` metres wide. */
  addChhatri(parent: THREE.Object3D, position: Vec3, size: number, body: THREE.Material, dome: THREE.Material): void;
  /** A ring-sector slab; angles from local +Z toward +X. */
  addArcSlab(parent: THREE.Object3D, innerRadius: number, outerRadius: number, thetaStart: number, thetaLength: number, y: number, height: number, material: THREE.Material, segments?: number): THREE.Mesh;
  /** A box beam from `a` to `b`. */
  addBeam(parent: THREE.Object3D, a: Vec3, b: Vec3, width: number, depth: number, material: THREE.Material, overrun?: number): THREE.Mesh;
  addQuads(parent: THREE.Object3D, quads: Quad[], material: THREE.Material): THREE.Mesh;
  /** A box-section ribbon along [x, topY, z] points, mitred at the bends. */
  addSweptBox(parent: THREE.Object3D, path: Vec3[], halfWidth: number, depth: number, material: THREE.Material, offset?: number, floor?: number): THREE.Mesh | null;
  /** A plan polygon of [x, z] points extruded from `y` up by `height`. */
  addPrism(parent: THREE.Object3D, points: PlanPoint[], y: number, height: number, material: THREE.Material): THREE.Mesh;
  addGeodesicDome(parent: THREE.Object3D, x: number, z: number, radius: number, rise: number, detail: number, glassMaterial: THREE.Material, strutMaterial: THREE.Material): THREE.Mesh;
  /** A mesh from any geometry; `rotationY` turns a +Z-facing pane to its wall. */
  addMesh(parent: THREE.Object3D, geometry: THREE.BufferGeometry, material: THREE.Material, position?: Vec3, rotationY?: number): THREE.Mesh;
  addTree(parent: THREE.Object3D, x: number, z: number, radius?: number, trunkHeight?: number, canopyMaterial?: THREE.Material): void;
  addPalm(parent: THREE.Object3D, x: number, z: number, height?: number, lean?: number, turn?: number): void;

  // Flat openings: XY-plane geometries, origin bottom centre, facing +Z.
  roundArch(width: number, height: number): THREE.BufferGeometry;
  pointedArch(width: number, height: number): THREE.BufferGeometry;
  rectPane(width: number, height: number): THREE.BufferGeometry;
  discPane(radius: number, segments?: number): THREE.BufferGeometry;
  trianglePane(width: number, height: number): THREE.BufferGeometry;
  /** Grow (or shrink) a plan polygon along its edge normals. */
  offsetPolygon(points: PlanPoint[], offset: number): PlanPoint[];
  /** The walls of a plan polygon, each with its outward normal. */
  wallEdges(points: PlanPoint[]): WallEdge[];
  addOnWall(parent: THREE.Object3D, edge: WallEdge, along: number, y: number, geometry: THREE.BufferGeometry, material: THREE.Material, proud?: number): THREE.Mesh;
  /** Regular bays of openings (and optional piers) along every long wall. */
  addBays(parent: THREE.Object3D, edges: WallEdge[], options: {
    bay: number;
    storeys: BayStorey[];
    opening: THREE.Material;
    surround?: THREE.Material;
    minEdge?: number;
    margin?: number;
    pier?: { width: number; depth: number; bottom: number; top: number; material: THREE.Material };
  }): void;

  /** A solid square column the bird strikes: local centre, half side, top. */
  solid(x: number, z: number, half: number, top: number): void;
  /** A solid box the bird strikes: local centre, local half extents, top. */
  solidBox(x: number, z: number, halfX: number, halfZ: number, top: number): void;
  /** A big local rectangle x0…x1 × z0…z1 as a tiling of small solid boxes. */
  solidTiles(x0: number, x1: number, z0: number, z1: number, top: number, cell?: number): void;
  /** Open ground of the landmark: keeps generic buildings and trees off it. */
  clearSite(x: number, z: number, halfX: number, halfZ: number): void;
  /** As `clearSite`, for an oval (local semi-axes along X and Z). */
  clearOval(x: number, z: number, radiusX: number, radiusZ: number, pad?: number): void;
  /** Height of the default `extents` collider (default: the module's altitude). */
  setColliderTop(top: number): void;
  /** Turn the default `extents` collider off (then add your own solids). */
  setBoundsCollider(enabled: boolean): void;
  /** Local point the bird lands on (default: the origin). */
  setPerchTarget(x: number, z: number): void;

  /** A real coordinate in this landmark's local frame. */
  toLocal(lat: number, lon: number): PlanPoint;
  /** A world-metre point (public/dhaka-map.json) in the local frame. */
  worldToLocal(x: number, z: number): PlanPoint;
}

/** A DHAKA_PARKS-style lawn ellipse with trees. */
export type LandmarkPark = {
  /** Defaults to "<label> Grounds". */
  name?: string;
  lat: number;
  lon: number;
  /** Semi-axes in metres (rx across, rz along, before `angle`). */
  rx: number;
  rz: number;
  /** Radians, same sense as a heading. Default 0. */
  angle?: number;
  /** Dense tree cover instead of open lawn. */
  wooded?: boolean;
};

export type LandmarkModule = {
  /** The landmark kind: must equal the file name and the registry key. */
  key: string;
  label: string;
  labelBn: string;
  /** Three capitals for the minimap. */
  shortLabel: string;
  lat: number;
  lon: number;
  /** Overall height in metres (label height, inspection camera, default collider top). */
  altitude: number;
  /** Radians; see `headingFromBearing`. */
  heading: number;
  /** Show on the minimap. Only for city-scale landmarks. */
  minimap?: boolean;
  /** Radius (m) about lat/lon kept free of the far-distance city mass. */
  clearingRadius: number;
  /** Local half extents [halfX, halfZ] of the main solid mass. */
  extents: [number, number];
  /** public/dhaka-map.json building ids this landmark replaces. */
  replacesOsmBuildingIds?: number[];
  /** One lawn ellipse, or several for grounds no single ellipse fits. */
  park?: LandmarkPark | LandmarkPark[];
  /** Default 4000. */
  triangleBudget?: number;
  /** Forecourt (m) procedural plots keep from the solid parts. Default 16. */
  plotGap?: number;
  /** Camera distance (m) when the landmark is inspected. Default from size. */
  inspectDistance?: number;
  build(kit: LandmarkKit): void;
};

/**
 * Heading (radians) for a landmark whose front (local +Z) faces the given
 * compass bearing in degrees (0 north, 90 east, 180 south, 270 west).
 */
export function headingFromBearing(bearingDegrees: number) {
  const turn = ((180 - bearingDegrees) * Math.PI) / 180;
  return Math.atan2(Math.sin(turn), Math.cos(turn));
}
