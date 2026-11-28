// InterContinental Dhaka (the old Dacca InterContinental of 1966, later the
// Sheraton and the Ruposhi Bangla), Minto Road, Shahbagh
//
// A white eleven-storey slab whose every room is a tall arched niche set
// between thin vertical ribs, so both long faces read as a screen of arches.
// The entrance canopy runs along the Minto Road front; at the west end a
// second wing turns south, with the glass drum of the winter garden and a low
// white podium in the angle facing the Shahbagh crossing; the pool lies on
// the garden side behind the slab.
//
// OSM, in the bundled snapshot's world metres (none of these ways is in the
// snapshot itself, so nothing is listed as replaced):
//   993181129 (10 levels) — the 72 m × 16 m slab on an 82° axis, its stepped
//             west end and the south wing
//   993181127 (6 levels)  — the round winter garden, radius about 14 m
//   993181128 (3 levels)  — the podium south-west of the drum
//   741140905             — the swimming pool
//   741140904 (2 levels)  — the low hall south of the pool
//   741140903             — the hotel compound (tourism=hotel)
// References: Commons "Hotel Intercontinental sideview.jpg" (the Minto Road
// front), "InterContinental Dhaka, 2018.jpg" (drum, podium and south wing from
// the crossing), "InterContinental Dhaka.jpg" (canopy and niches). Storey
// heights, the canopy's size and the roof pavilions are read from those
// photographs; the garden side is not shown in them and repeats the front in
// plainer form.
//
// Local +Z looks north-north-west to Minto Road; +X runs west to the crossing.
import { headingFromBearing, type LandmarkModule, type PlanPoint } from "./kit";

const LOBBY = 6;
const STOREY = 3.3;
const STOREYS = 11;
const TOP = LOBBY + STOREY * STOREYS + 0.9;

type Rect = { x: number; z: number; sx: number; sz: number };

const landmark: LandmarkModule = {
  key: "intercontinental-dhaka",
  label: "InterContinental Dhaka",
  labelBn: "ইন্টারকন্টিনেন্টাল ঢাকা",
  shortLabel: "ICD",
  lat: 23.741253,
  lon: 90.397131,
  altitude: 48,
  heading: headingFromBearing(352),
  clearingRadius: 90,
  extents: [66, 30],
  triangleBudget: 6500,
  plotGap: 8,
  build(kit) {
    const { group, addBox, addCylinder, addMesh, rectPane, materials } = kit;
    const THREE = kit.THREE;
    const wall = kit.material(0xefeadc, { roughness: 0.84 });
    const windowGlass = kit.litMaterial(0x33526e, 0.45, 0xffd9a0);
    const drumGlass = kit.litMaterial(0x86b9b4, 0.4, 0xffe6bd);
    // Eight materials: the ribs share the wall's white (their relief carries
    // them), the name board the window glass, and the pool the drum's teal,
    // which lights up after dark as the pool does.
    const rib = wall;

    const rect = (ax: number, az: number, bx: number, bz: number): Rect => {
      const [x0, z0] = kit.worldToLocal(ax, az);
      const [x1, z1] = kit.worldToLocal(bx, bz);
      return { x: (x0 + x1) / 2, z: (z0 + z1) / 2, sx: Math.abs(x1 - x0), sz: Math.abs(z1 - z0) };
    };
    const mass = (r: Rect, top: number, material = wall) => addBox(group, [r.sx, top, r.sz], [r.x, top / 2, r.z], material);
    const tiles = (r: Rect, top: number) => kit.solidTiles(r.x - r.sx / 2, r.x + r.sx / 2, r.z - r.sz / 2, r.z + r.sz / 2, top, 14);

    const slab = rect(-2009.9, 3340.7, -1936.4, 3346.3);
    const step = rect(-2009.3, 3345.3, -2020.2, 3358.4);
    const wing = rect(-2020.6, 3355.4, -2023.3, 3400.4);
    const wingBay = rect(-2025.9, 3384.7, -2035.7, 3367.4);
    const wingFoot = rect(-2011.5, 3388.8, -2023.3, 3400.4);
    const podiumNorth = rect(-2053.9, 3356.9, -2032.7, 3385.8);
    const podiumSouth = rect(-2024.4, 3393.9, -2038.8, 3384.1);
    const pool = rect(-1951, 3364, -1931, 3374.5);
    const hall = rect(-1934.5, 3375.6, -1937.4, 3415.4);
    const hallArm = rect(-1957.1, 3378.8, -1941.6, 3386.4);
    const [drumX, drumZ] = kit.worldToLocal(-2033.7, 3353.4);
    const DRUM_RADIUS = 14.2;
    const DRUM_TOP = 19;

    // An arched niche window, kept to a few triangles: there are hundreds.
    const NICHE_WIDTH = 2.2;
    const NICHE_HEIGHT = 2.5;
    const nicheShape = new THREE.Shape();
    nicheShape.moveTo(-NICHE_WIDTH / 2, 0);
    nicheShape.lineTo(NICHE_WIDTH / 2, 0);
    nicheShape.lineTo(NICHE_WIDTH / 2, NICHE_HEIGHT - NICHE_WIDTH / 2);
    nicheShape.absarc(0, NICHE_HEIGHT - NICHE_WIDTH / 2, NICHE_WIDTH / 2, 0, Math.PI, false);
    nicheShape.lineTo(-NICHE_WIDTH / 2, 0);
    const niche = new THREE.ShapeGeometry(nicheShape, 4);
    const plainWindow = rectPane(NICHE_WIDTH, NICHE_HEIGHT - 0.3);

    // One face of bedrooms: a column of windows between ribs, from `from` to
    // `to` along the wall whose outward normal is given by `turn`.
    const bedrooms = (from: number, to: number, fixed: number, turn: number, arched: boolean) => {
      const alongX = turn === 0 || turn === Math.PI;
      const outX = Math.round(Math.sin(turn));
      const outZ = Math.round(Math.cos(turn));
      const columns = Math.max(1, Math.round((to - from) / 4));
      const pitch = (to - from) / columns;
      const place = (along: number, y: number, proud: number): [number, number, number] =>
        alongX ? [along, y, fixed + outZ * proud] : [fixed + outX * proud, y, along];
      for (let column = 0; column <= columns; column++) {
        const [x, , z] = place(from + column * pitch, 0, 0.2);
        addBox(group, alongX ? [0.5, TOP - LOBBY, 0.6] : [0.6, TOP - LOBBY, 0.5], [x, (TOP + LOBBY) / 2, z], rib);
      }
      for (let column = 0; column < columns; column++) {
        for (let storey = 0; storey < STOREYS; storey++) {
          addMesh(group, arched ? niche : plainWindow, windowGlass, place(from + (column + 0.5) * pitch, LOBBY + storey * STOREY + 0.5, 0.08), turn);
        }
      }
    };

    // ── The slab, its stepped west end and the south wing ───────────────────
    mass(slab, TOP);
    mass(step, TOP);
    mass(wing, TOP);
    mass(wingBay, TOP);
    mass(wingFoot, TOP);
    const front = slab.z + slab.sz / 2;
    const back = slab.z - slab.sz / 2;
    const east = slab.x - slab.sx / 2;
    const west = slab.x + slab.sx / 2;
    bedrooms(east, west, front, 0, true);
    bedrooms(east, west, back, Math.PI, false);
    const wingWest = wing.x + wing.sx / 2;
    const wingEast = wing.x - wing.sx / 2;
    const wingSouth = wing.z - wing.sz / 2;
    bedrooms(wingBay.z + wingBay.sz / 2, wing.z + wing.sz / 2, wingWest, Math.PI / 2, true);
    bedrooms(wingSouth, wingBay.z - wingBay.sz / 2, wingWest, Math.PI / 2, true);
    bedrooms(wingBay.z - wingBay.sz / 2, wingBay.z + wingBay.sz / 2, wingBay.x + wingBay.sx / 2, Math.PI / 2, true);
    bedrooms(wingSouth + 10, step.z - step.sz / 2, wingEast, -Math.PI / 2, false);
    // The glazed stair strip on the stepped end, and the lobby glazing.
    addMesh(group, rectPane(4.5, TOP - LOBBY - 2), windowGlass, [step.x, LOBBY, step.z + step.sz / 2 + 0.08]);
    addMesh(group, rectPane(slab.sx - 4, LOBBY - 1.6), windowGlass, [slab.x, 0.6, front + 0.08]);
    addMesh(group, rectPane(slab.sx - 4, LOBBY - 1.6), windowGlass, [slab.x, 0.6, back - 0.08], Math.PI);
    // Parapet band and roof.
    addBox(group, [slab.sx + 0.7, 1, slab.sz + 0.7], [slab.x, TOP - 0.3, slab.z], rib);
    addBox(group, [slab.sx - 1.5, 0.16, slab.sz - 1.5], [slab.x, TOP + 0.28, slab.z], materials.roofGrey);
    addBox(group, [wing.sx + 0.7, 1, wing.sz + 0.7], [wing.x, TOP - 0.3, wing.z], rib);
    addBox(group, [wing.sx - 1.5, 0.16, wing.sz - 1.5], [wing.x, TOP + 0.28, wing.z], materials.roofGrey);
    // Roof pavilions with their white arcades, the name board between them
    // and the lift head.
    const roofArch = kit.roundArch(2.2, 2.8);
    for (const offset of [-17, 19]) {
      addBox(group, [13, 3.8, 6], [slab.x + offset, TOP + 2.2, slab.z + 1.5], rib);
      for (let arch = -2; arch <= 2; arch++) {
        addMesh(group, roofArch, windowGlass, [slab.x + offset + arch * 2.5, TOP + 0.7, slab.z + 4.58]);
      }
    }
    addBox(group, [15, 1.3, 0.3], [slab.x + 1, TOP + 1.1, front - 0.6], windowGlass);
    addBox(group, [8, 3, 6], [slab.x - 30, TOP + 1.8, slab.z - 1], materials.roofGrey);

    // ── The entrance canopy along the Minto Road front ──────────────────────
    const CANOPY_Y = 5.4;
    addBox(group, [slab.sx - 10, 0.6, 7], [slab.x, CANOPY_Y + 0.3, front + 3.5], rib);
    for (let post = -4; post <= 4; post++) {
      addBox(group, [0.7, CANOPY_Y, 0.7], [slab.x + post * 7.4, CANOPY_Y / 2, front + 6.3], rib);
    }
    addBox(group, [20, 0.7, 10], [slab.x, CANOPY_Y + 0.75, front + 12], rib);
    for (const px of [-9, 9]) {
      addBox(group, [0.8, CANOPY_Y + 0.4, 0.8], [slab.x + px, (CANOPY_Y + 0.4) / 2, front + 16.2], rib);
    }

    // ── The winter garden drum and the podium ───────────────────────────────
    addCylinder(group, DRUM_RADIUS, DRUM_RADIUS, DRUM_TOP, [drumX, DRUM_TOP / 2, drumZ], drumGlass, 20);
    for (const y of [0.7, 9.7, DRUM_TOP - 0.1]) {
      addCylinder(group, DRUM_RADIUS + 0.22, DRUM_RADIUS + 0.22, y < 1 ? 1.4 : 0.7, [drumX, y, drumZ], rib, 20);
    }
    for (let mullion = 0; mullion < 12; mullion++) {
      const angle = (mullion / 12) * Math.PI * 2;
      const post = addBox(group, [0.4, DRUM_TOP, 0.5], [drumX + Math.sin(angle) * (DRUM_RADIUS + 0.1), DRUM_TOP / 2, drumZ + Math.cos(angle) * (DRUM_RADIUS + 0.1)], rib);
      post.rotation.y = angle;
    }
    addCylinder(group, DRUM_RADIUS - 1, DRUM_RADIUS - 1, 0.3, [drumX, DRUM_TOP + 0.35, drumZ], materials.roofGrey, 20);
    for (const podium of [podiumNorth, podiumSouth]) {
      mass(podium, 13);
      for (let storey = 0; storey < 3; storey++) {
        addBox(group, [podium.sx + 0.16, 1.8, podium.sz - 2.4], [podium.x, 2 + storey * 4.1, podium.z], windowGlass);
        addBox(group, [podium.sx - 2.4, 1.8, podium.sz + 0.16], [podium.x, 2 + storey * 4.1, podium.z], windowGlass);
      }
      addBox(group, [podium.sx - 1.2, 0.16, podium.sz - 1.2], [podium.x, 13.08, podium.z], materials.roofGrey);
      tiles(podium, 13);
    }

    // ── Pool, garden and the low hall behind ────────────────────────────────
    addBox(group, [pool.sx + 9, 0.12, pool.sz + 8], [pool.x, 0.06, pool.z], materials.paleConcrete);
    addBox(group, [pool.sx, 0.1, pool.sz], [pool.x, 0.17, pool.z], drumGlass);
    const lawnEast = pool.x + pool.sx / 2 + 6;
    const lawnWest = wingEast - 3;
    addBox(group, [lawnWest - lawnEast, 0.1, 13], [(lawnWest + lawnEast) / 2, 0.05, back - 8.5], materials.lawn);
    for (const along of [0.15, 0.5, 0.85]) kit.addPalm(group, lawnEast + along * (lawnWest - lawnEast), back - 9, 11, 0.04, along * 9);
    kit.addPalm(group, pool.x - pool.sx / 2 - 3, pool.z + 2, 10, 0.05, 1.3);
    kit.clearSite(pool.x, pool.z, pool.sx / 2 + 5, pool.sz / 2 + 5);
    kit.clearSite((lawnWest + lawnEast) / 2, back - 8.5, (lawnWest - lawnEast) / 2, 7.5);
    for (const part of [hall, hallArm]) {
      mass(part, 9);
      addBox(group, [part.sx + 0.16, 2.4, part.sz - 2], [part.x, 5.4, part.z], windowGlass);
      addBox(group, [part.sx - 1, 0.16, part.sz - 1], [part.x, 9.08, part.z], materials.roofGrey);
    }
    kit.solidBox(hallArm.x, hallArm.z, hallArm.sx / 2, hallArm.sz / 2, 9);
    // Kept narrow: the neighbouring snapshot building (509772347) abuts the
    // hall's east wall, and a full-width solid would hide it.
    kit.solidTiles(hall.x - 1.5, hall.x + 3.5, hall.z - hall.sz / 2 + 1, hall.z + hall.sz / 2 - 1, 9, 10);

    // ── Forecourt up to the compound wall on Minto Road, with its palms ─────
    const forecourt: PlanPoint[] = [[east - 22, front + 0.4], [west + 9, front + 0.4], [west + 9, front + 14.5], [east, front + 30.5], [east - 22, front + 34]];
    kit.addPrism(group, forecourt, 0, 0.08, materials.paleConcrete);
    for (let palm = 0; palm < 4; palm++) {
      const along = palm / 3;
      // A row just inside the boundary wall, which runs askew to the slab.
      kit.addPalm(group, west + 6 - along * (west - east + 4), front + 13.5 + along * 15, 12, 0.03, palm * 1.7);
    }
    kit.clearSite((east - 22 + west + 9) / 2, front + 7.5, (west - east + 31) / 2, 7.5);
    kit.clearSite(east + 6, front + 22, 28, 9);

    kit.setBoundsCollider(false);
    kit.solidTiles(east, step.x + step.sx / 2, back, front, TOP, 14);
    kit.solidTiles(wingFoot.x - wingFoot.sx / 2, wingBay.x + wingBay.sx / 2, wingSouth, step.z - step.sz / 2, TOP, 14);
    kit.solid(drumX, drumZ, 11, DRUM_TOP + 0.5);
  },
};

export default landmark;
