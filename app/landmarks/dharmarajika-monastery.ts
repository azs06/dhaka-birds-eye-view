// Dharmarajika Buddhist Monastery (Dharmarajika Bauddha Vihara), Basabo
//
// Dhaka's first Buddhist monastery (1960), a walled compound of yellow,
// orange-trimmed monastery and school blocks round a long rectangular pond.
// What the photos show, and what is built here: the pond with its red-capped
// white kerb walls; at one end a deck on gilded posts with two gilded gate
// frames and, in the middle, the tall gilded standing Buddha (abhaya mudra)
// on a red lotus; a small red three-tiered pagoda pavilion on the bank near
// the statue; and the covered ghat with a green roof and orange-tiled side
// walls at the other end, from which both pond photos are taken (Commons:
// "Pond at Dharmarajika Bauddha Vihara, Dhaka.jpg" and "… Dhaka 1.jpg",
// "Buddha statue at Dharmarajika Bauddha Vihara 1.jpg", "Dharmarajika Bhikkhu
// Training Centre.jpg" for the yellow blocks).
//
// The prayer hall with its gilded bell-shaped stupa is not mapped in OSM but
// is plain on z19 imagery on the pond's north bank, just north-west of the
// statue; it is sized and placed from that. The Thai decorative gate is only
// glimpsed in photos and has no position, so it is left out.
//
// Approximate: no reference with a position says which end the statue is
// at. It is put at the NORTH end, looking south down the pond, because (a)
// the orange-trimmed block behind the statue in the pond photos matches the
// compound's own blocks, which stand north and north-east of the pond, while
// the photos' side banks show only trees, as the open west and east banks of
// the pond's north half do; (b) OSM's footway runs from the north-west gate
// along the pond's north end, as the paved walk beside the statue does in
// the statue photo. The pagoda then stands on the east bank near the statue
// (on the right in the photos taken from the ghat).
//
// OSM: compound way 662218262; pond way 338750049, already drawn as snapshot
// water and not covered here; compound buildings (ways 454015118, 501560101,
// 501560102, 454015186, 454015173, 454015141, 1424930591) are mapped without
// heights and are absent from the snapshot, so they are drawn as plain
// three-storey yellow blocks. Nothing in the snapshot is replaced. The
// origin is the statue.
import { headingFromBearing, type LandmarkKit, type LandmarkModule, type PlanPoint } from "./kit";

type Parent = Parameters<LandmarkKit["addBox"]>[0];

// Survey node for the OSM offsets below (the compound way's bbox centre).
const NODE_LAT = 23.735797;
const NODE_LON = 90.429489;
const METRES_PER_DEG_LON = 111320 * Math.cos((23.7715 * Math.PI) / 180);
const METRES_PER_DEG_LAT = 110540;

const LOTUS_TOP = 2.6;

const landmark: LandmarkModule = {
  key: "dharmarajika-monastery",
  label: "Dharmarajika Buddhist Monastery",
  labelBn: "ধর্মরাজিক বৌদ্ধবিহার",
  shortLabel: "DBM",
  lat: 23.736176,
  lon: 90.429489,
  altitude: 25,
  heading: headingFromBearing(176),
  clearingRadius: 60,
  extents: [3, 3],
  triangleBudget: 5000,
  plotGap: 8,
  inspectDistance: 70,
  build(kit) {
    const { THREE, group, addBox, addCone, addLathe, addMesh, materials } = kit;
    const gold = kit.material(0xd9a630, { roughness: 0.4, metalness: 0.55 });
    const red = kit.material(0xc8463a, { roughness: 0.75 });
    const green = kit.material(0x3f9b62, { roughness: 0.7 });
    const yellow = kit.material(0xe8b63c, { roughness: 0.9 });
    const orange = kit.material(0xe0873a, { roughness: 0.9 });
    const marble = materials.marble;
    const paving = materials.yardPaving;
    const dark = materials.archDark;

    const en = (east: number, north: number): PlanPoint =>
      kit.toLocal(NODE_LAT + north / METRES_PER_DEG_LAT, NODE_LON + east / METRES_PER_DEG_LON);
    // A box between two local plan points, pushed `offset` along its normal.
    const run = (a: PlanPoint, b: PlanPoint, width: number, y0: number, height: number, material: typeof marble, offset = 0) => {
      const dx = b[0] - a[0];
      const dz = b[1] - a[1];
      const len = Math.hypot(dx, dz);
      const nx = dz / len;
      const nz = -dx / len;
      const piece = addBox(group, [len + width, height, width], [(a[0] + b[0]) / 2 + nx * offset, y0 + height / 2, (a[1] + b[1]) / 2 + nz * offset], material);
      piece.rotation.y = Math.atan2(-dz, dx);
      return piece;
    };
    // A post without end caps.
    const post = (parent: Parent, x: number, z: number, radius: number, bottom: number, top: number, material: typeof marble) =>
      addMesh(parent, new THREE.CylinderGeometry(radius, radius, top - bottom, 8, 1, true), material, [x, (top + bottom) / 2, z]);
    // A sub-group laid along the pond edge a → b: its +X runs along the edge
    // and its +Z points away from the water (toward `land`).
    const along = (a: PlanPoint, b: PlanPoint, land: PlanPoint) => {
      const g = new THREE.Group();
      g.position.set((a[0] + b[0]) / 2, 0, (a[1] + b[1]) / 2);
      let turn = Math.atan2(-(b[1] - a[1]), b[0] - a[0]);
      const zx = Math.sin(turn);
      const zz = Math.cos(turn);
      if ((land[0] - g.position.x) * zx + (land[1] - g.position.z) * zz < 0) turn += Math.PI;
      g.rotation.y = turn;
      group.add(g);
      return { g, length: Math.hypot(b[0] - a[0], b[1] - a[1]) };
    };

    // ---- Pond kerb: white wall, red cap, just outside the water edge -------
    const pond: PlanPoint[] = [en(-17.0, 36.8), en(-19.5, 35.6), en(-21.0, 33.6), en(-15.2, -46.9), en(26.8, -46.6), en(17.6, 40.1)];
    let signed = 0;
    for (let i = 0; i < pond.length; i++) {
      const [ax, az] = pond[i];
      const [bx, bz] = pond[(i + 1) % pond.length];
      signed += ax * bz - bx * az;
    }
    const out = signed > 0 ? -0.4 : 0.4;
    for (let i = 0; i < pond.length; i++) {
      const a = pond[i];
      const b = pond[(i + 1) % pond.length];
      run(a, b, 0.7, 0, 0.75, marble, out);
      run(a, b, 0.8, 0.75, 0.22, red, out);
    }

    // ---- The statue deck at the north end ---------------------------------
    // Along the pond's north edge, 6.5 m deep on the land side, on gilded
    // posts, with a gilded gate frame either side of the statue.
    const deck = along(en(-17.0, 36.8), en(17.6, 40.1), [0, 0]);
    // The statue (origin) is on the land side: `along` faces +Z toward it.
    const D = deck.length;
    addBox(deck.g, [D + 1, 0.9, 6.6], [0, 0.45, 3.3], paving);
    addBox(deck.g, [D + 1.2, 0.12, 6.8], [0, 0.96, 3.3], marble);
    for (let i = 0; i <= 10; i++) {
      const x = -D / 2 + (D * i) / 10;
      post(deck.g, x, 0.4, 0.16, 0.9, 4.1, gold);
      addBox(deck.g, [0.5, 0.25, 0.5], [x, 4.2, 0.4], gold);
    }
    addBox(deck.g, [D, 0.08, 0.08], [0, 1.9, 0.4], gold);
    for (const fx of [-D * 0.32, D * 0.32]) {
      for (const side of [-1, 1]) post(deck.g, fx + side * 3.2, 3.2, 0.22, 0.9, 4.5, gold);
      addBox(deck.g, [7.4, 0.4, 0.4], [fx, 4.4, 3.2], gold);
      addBox(deck.g, [6.4, 0.25, 0.3], [fx, 3.9, 3.2], gold);
    }

    // ---- The standing Buddha on its lotus (origin) -------------------------
    addLathe(group, [[0, 0], [2.6, 0], [2.4, 0.7], [0, 0.7]], 16, [0, 0.9, 0], marble);
    addLathe(group, [[0, 0], [1.3, 0], [2.4, 0.5], [2.75, 1.0], [2.2, 1.0], [0, 1.0]], 16, [0, 1.6, 0], red, true);
    const figure = addLathe(group, [
      [0, 0], [1.1, 0], [1.3, 0.6], [1.08, 1.8], [0.95, 3.8], [1.04, 5.1], [1.2, 6.4], [1.28, 7.0], [1.0, 7.45], [0.45, 7.7], [0.42, 7.9], [0, 7.9],
    ], 14, [0, LOTUS_TOP, 0], gold);
    figure.scale.z = 0.62;
    const headY = LOTUS_TOP + 8.35;
    addLathe(group, [[0, -0.5], [0.46, -0.35], [0.55, 0], [0.48, 0.36], [0.28, 0.56], [0.24, 0.7], [0.09, 0.98], [0, 1.25]], 12, [0, headY, 0], gold);
    // Right forearm raised before the chest (abhaya), left arm lowered. The
    // statue faces local +Z; its right hand is on local -X.
    kit.addBeam(group, [-1.05, LOTUS_TOP + 6.4, 0.2], [-1.1, LOTUS_TOP + 5.2, 0.8], 0.36, 0.36, gold);
    kit.addBeam(group, [-1.1, LOTUS_TOP + 5.2, 0.8], [-0.95, LOTUS_TOP + 6.4, 1.0], 0.32, 0.32, gold);
    kit.addBeam(group, [1.1, LOTUS_TOP + 6.4, 0.1], [1.2, LOTUS_TOP + 4.2, 0.3], 0.34, 0.34, gold);

    // ---- Red three-tier pagoda pavilion on the east bank -------------------
    const [px, pz] = en(22.5, 26);
    for (const [dx, dz] of [[-1.7, -1.7], [1.7, -1.7], [-1.7, 1.7], [1.7, 1.7]]) post(group, px + dx, pz + dz, 0.16, 0.3, 3.0, yellow);
    addBox(group, [5, 0.3, 5], [px, 0.15, pz], marble);
    const tiers: Array<[number, number, number]> = [[3.6, 3.0, 1.4], [2.6, 4.6, 1.2], [1.7, 5.9, 1.3]];
    for (const [r, y, h] of tiers) {
      const roof = addCone(group, r, h, [px, y + h / 2, pz], red, 4);
      roof.rotation.y = Math.PI / 4;
      if (y > 3) addBox(group, [r * 0.9, 0.5, r * 0.9], [px, y - 0.1, pz], yellow);
    }
    addCone(group, 0.14, 1.4, [px, 7.9, pz], gold, 6);

    // ---- The prayer hall with its gilded stupa, north of the statue --------
    // From z19 imagery: a pale square hall on the pond's north bank, its roof
    // carrying a bell-shaped stupa about 12 m across whose centre is ~15 m
    // west and ~17 m north of the statue; the terrace round it is ~18 × 14 m.
    // Heights are estimated (two storeys, bell and spire roughly as tall
    // again).
    const [hx, hz] = en(-15, 59.2);
    const HALL_W = 17;
    const HALL_D = 13;
    const HALL_ROOF = 8.2;
    addBox(group, [HALL_W + 3, 1.2, HALL_D + 3], [hx, 0.6, hz], marble);
    addBox(group, [6, 0.6, 2.4], [hx, 0.3, hz + HALL_D / 2 + 2.6], marble);
    addBox(group, [HALL_W, HALL_ROOF - 1.2, HALL_D], [hx, 1.2 + (HALL_ROOF - 1.2) / 2, hz], marble);
    for (const y of [2.2, 5.4]) addBox(group, [HALL_W + 0.12, 1.3, HALL_D + 0.12], [hx, y + 0.65, hz], dark);
    addBox(group, [HALL_W + 1.2, 0.45, HALL_D + 1.2], [hx, HALL_ROOF - 0.1, hz], gold);
    addBox(group, [HALL_W + 0.6, 0.8, HALL_D + 0.6], [hx, HALL_ROOF + 0.5, hz], marble);
    // Entrance bay on the pond side: red frame, dark doorway.
    addBox(group, [5.2, 5.6, 0.5], [hx, 1.2 + 2.8, hz + HALL_D / 2 + 0.25], red);
    addMesh(group, kit.roundArch(3, 4.2), dark, [hx, 1.2, hz + HALL_D / 2 + 0.56]);
    // Stepped square base, then the bell, the harmika and the ringed spire.
    const sy = HALL_ROOF + 0.9;
    addBox(group, [10.4, 0.9, 10.4], [hx, sy + 0.45, hz], marble);
    addBox(group, [9.2, 0.7, 9.2], [hx, sy + 1.25, hz], gold);
    const bellY = sy + 1.6;
    addLathe(group, [
      [0, 0], [4.7, 0], [4.7, 0.5], [4.45, 0.75], [4.55, 2.2], [4.3, 4.0], [3.7, 5.6], [2.7, 6.8], [1.5, 7.6], [0, 7.8],
    ], 20, [hx, bellY, hz], gold);
    addBox(group, [1.9, 1.1, 1.9], [hx, bellY + 8.2, hz], gold);
    addLathe(group, [
      [0, 0], [1.0, 0], [0.95, 0.4], [0.8, 0.5], [0.78, 0.9], [0.62, 1.0], [0.6, 1.5], [0.46, 1.6], [0.42, 2.4], [0.24, 3.6], [0.1, 4.8], [0, 5.4],
    ], 10, [hx, bellY + 8.75, hz], gold);
    const STUPA_TOP = bellY + 8.75 + 5.4;
    // Small gilded stupas on the four roof corners.
    for (const [dx, dz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
      const cx = hx + dx * (HALL_W / 2 - 0.9);
      const cz = hz + dz * (HALL_D / 2 - 0.9);
      addLathe(group, [[0, 0], [0.75, 0], [0.75, 0.3], [0.7, 0.9], [0.45, 1.4], [0.15, 1.7], [0.06, 2.6], [0, 2.8]], 8, [cx, HALL_ROOF + 0.9, cz], gold);
    }

    // ---- The covered ghat at the south end ---------------------------------
    const ghat = along(en(-15.2, -46.9), en(26.8, -46.6), en(5.8, -60));
    addBox(ghat.g, [8, 0.5, 7], [0, 0.25, 3.5], marble);
    for (const side of [-1, 1]) {
      addBox(ghat.g, [0.6, 2.6, 7], [side * 4.3, 1.3, 3.5], orange);
      addBox(ghat.g, [0.7, 0.25, 7.1], [side * 4.3, 2.72, 3.5], red);
      addBox(ghat.g, [0.5, 1.2, 0.5], [side * 2.6, 0.6, -0.4], yellow);
    }
    addBox(ghat.g, [9.6, 0.18, 8.2], [0, 3.5, 3.6], green);

    // ---- Yellow monastery, hostel and school blocks ------------------------
    const block = (corners: Array<[number, number]>, top: number) => {
      const plan = corners.map(([e, n]) => en(e, n));
      kit.addPrism(group, plan, 0, top, yellow);
      kit.addPrism(group, kit.offsetPolygon(plan, -0.3), top, 0.06, marble);
      kit.addPrism(group, kit.offsetPolygon(plan, 0.1), top - 0.7, 0.7, orange);
      for (let storey = 0; storey < Math.round(top / 3.3); storey++) {
        kit.addPrism(group, kit.offsetPolygon(plan, 0.06), 1.3 + storey * 3.3, 0.9, dark);
      }
      const xs = plan.map((p) => p[0]);
      const zs = plan.map((p) => p[1]);
      const cx = (Math.min(...xs) + Math.max(...xs)) / 2;
      const cz = (Math.min(...zs) + Math.max(...zs)) / 2;
      kit.solidBox(cx, cz, (Math.max(...xs) - Math.min(...xs)) / 2, (Math.max(...zs) - Math.min(...zs)) / 2, top + 0.2);
    };
    block([[37.3, -4.7], [45.9, -4.4], [48.1, -69.3], [39.5, -69.6]], 10);
    block([[35.8, 21.6], [44.4, 22.3], [45.8, 4.6], [37.1, 4.0]], 10);
    block([[26.8, 21.2], [34.4, 21.6], [35.5, 1.8], [27.8, 1.4]], 10);
    block([[27.2, 40.9], [37.8, 42.0], [39.1, 29.6], [28.4, 28.6]], 10);
    block([[22.9, 57.3], [31.2, 58.1], [32.6, 44.0], [24.3, 43.2]], 10);
    block([[0.9, 65.7], [29.9, 70.2], [31.4, 60.7], [2.4, 56.2]], 13);
    block([[-34.2, -9.3], [-20.4, -8.0], [-16.8, -48.4], [-30.6, -49.6]], 10);

    // Coconut palms along the open banks (the photos show both
    // banks lined with them), kept off the blocks' footprints.
    for (const [e, n, h] of [[-25, 30, 13], [-24.5, 18, 11], [-24, 6, 14], [-23.5, -4, 12], [31, -40, 12], [30.5, -28, 14], [30, -16, 11]]) {
      const [x, z] = en(e, n);
      kit.addPalm(group, x, z, h, 0.1, e * 0.7);
    }
    for (const [e, n, h] of [[-28.5, 24, 10], [-28, 11, 12], [33, -34, 13], [32.5, -22, 10]]) {
      const [x, z] = en(e, n);
      kit.addPalm(group, x, z, h, 0.14, n * 0.5);
    }

    // Paved walk from the north-west gate along the north end (OSM footway
    // 662218261).
    kit.addPrism(group, [en(-41, 60), en(-38, 44.5), en(21, 50), en(20, 55)], 0, 0.08, paving);

    // ---- Colliders, clearing ----------------------------------------------
    kit.setBoundsCollider(false);
    kit.solid(0, 0, 1.6, headY + 1.2);
    kit.solid(px, pz, 2.4, 7.5);
    kit.solidBox(hx, hz, HALL_W / 2 + 1.5, HALL_D / 2 + 1.5, HALL_ROOF + 1);
    kit.solid(hx, hz, 4.7, STUPA_TOP);
    // The compound inside its wall (way 662218262), as two rectangles.
    const clearEN = (e0: number, e1: number, n0: number, n1: number) => {
      const [ax, az] = en(e0, n0);
      const [bx, bz] = en(e1, n1);
      kit.clearSite((ax + bx) / 2, (az + bz) / 2, Math.abs(bx - ax) / 2, Math.abs(bz - az) / 2);
    };
    clearEN(-44, 48, -71, 26);
    clearEN(-46, 30, 26, 60);
    kit.setPerchTarget(0, 0.2);
  },
};

export default landmark;
