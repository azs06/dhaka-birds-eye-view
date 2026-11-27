// Bangladesh–China Friendship Exhibition Center (BCFEC), Purbachal
//
// The permanent home of the Dhaka International Trade Fair, beside the
// Dhaka bypass at the east end of Purbachal New Town. One long exhibition
// hall, 286 m by 85 m, runs east–west: terracotta-red walls with vertical
// slots, a band of clerestory glass, and a long silver roof with rounded
// eaves. In the middle the roof rises into the signature wave — a bell-shaped
// canopy sweeping up from the eaves to about twice their height, carried at
// the front on four silver Y-columns over the glazed entrance — and a
// reflecting pool runs down the axis of the paved forecourt to the south.
//
// OSM: the hall is way 822108275 (its south edge bulges out where the wave
// canopy oversails the entrance, centred on x 12061), the grounds relation
// 14376114 (also drawn as a 21 m "building" in the city snapshot, so both
// ids are replaced), the pool and lawns from the forecourt ways. The task
// hint (23.8400, 90.5180) is 1.7 km west of the real site; the OSM position
// is used. The site lies on the east edge of the game world: the hall's
// centre is about 60 m beyond FLIGHT_EXTENT.x (12 000 m), so the bird is
// turned back as it passes over the entrance, and it perches on the west
// wing's roof, inside the boundary.
//
// Local +Z looks south (heading 0) to the forecourt; local +X points east.
import type { LandmarkModule, PlanPoint } from "./kit";

const HALL_WEST = -143;
const HALL_EAST = 142.4;
const FACE_SOUTH = 40.5;
const FACE_NORTH = -44.3;
const WING_INNER = 50;
const BASE_TOP = 8.6;
const GLASS_TOP = 12.6;
const EAVE_TOP = 15.6;
// The wave: a bell from the eaves at |x| = WAVE_HALF to the crest.
const WAVE_HALF = 60;
const CREST = 31;
const WAVE_THICK = 3.2;
const WAVE_SOUTH = 55;
const WAVE_NORTH = -46.5;
const waveTop = (x: number) => EAVE_TOP + ((CREST - EAVE_TOP) * (1 + Math.cos((Math.PI * Math.max(-1, Math.min(1, x / WAVE_HALF))))) / 2);

// Forecourt (world metres): squared off on the south by Road No. 107 and
// cut on the south-west parallel to the Dhaka bypass.
const FORECOURT: PlanPoint[] = [[11910, -7872], [12203, -7872], [12203, -7754], [12000, -7754]];
const LAWN_WEST: PlanPoint[] = [[11935, -7849], [12031, -7849], [12031, -7796], [11979, -7796]];
const LAWN_EAST: PlanPoint[] = [[12093, -7850], [12201, -7850], [12201, -7794], [12093, -7794]];
const POOL: PlanPoint[] = [[12055, -7840], [12071, -7840], [12071, -7794], [12055, -7794]];

const landmark: LandmarkModule = {
  key: "bcfec-purbachal",
  label: "Bangladesh–China Friendship Exhibition Center",
  labelBn: "বাংলাদেশ-চীন মৈত্রী প্রদর্শনী কেন্দ্র",
  shortLabel: "BCF",
  lat: 23.843112,
  lon: 90.534892,
  altitude: 31,
  heading: 0,
  clearingRadius: 150,
  extents: [143, 45],
  replacesOsmBuildingIds: [822108275, 1001437611400],
  triangleBudget: 8000,
  plotGap: 10,
  inspectDistance: 320,
  build(kit) {
    const { group, addBox, addCylinder, addPrism, addMesh, addBeam, rectPane, materials } = kit;
    const red = kit.material(0xb55a3e, { roughness: 0.85 });
    const glass = materials.darkGlass;
    const roof = kit.material(0xd9dbdc, { roughness: 0.45, metalness: 0.3 });
    const soffit = kit.material(0x55504b, { roughness: 0.9 });
    const silver = materials.silverPanel;
    const paving = kit.material(0xd8cdb8, { roughness: 0.95 });

    const L = (points: PlanPoint[]) => points.map(([x, z]) => kit.worldToLocal(x, z));
    const depth = FACE_SOUTH - FACE_NORTH;
    const midZ = (FACE_SOUTH + FACE_NORTH) / 2;

    // Vertical slots in the red walls of a stretch of facade x0…x1.
    const slots = (x0: number, x1: number) => {
      for (let x = x0 + 3; x < x1 - 2; x += 5.2) {
        addMesh(group, rectPane(0.9, 6.6), soffit, [x, 1, FACE_SOUTH + 0.12], 0);
        addMesh(group, rectPane(0.9, 6.6), soffit, [x, 1, FACE_NORTH - 0.12], Math.PI);
      }
    };
    // A rounded eave: a half-buried cylinder along a roof edge.
    const eave = (a: [number, number], b: [number, number]) => {
      const length = Math.hypot(b[0] - a[0], b[1] - a[1]);
      const mesh = addCylinder(group, 1.5, 1.5, length, [(a[0] + b[0]) / 2, EAVE_TOP - 1.5, (a[1] + b[1]) / 2], roof, 10);
      mesh.rotation.order = "YXZ";
      mesh.rotation.set(Math.PI / 2, Math.atan2(b[0] - a[0], b[1] - a[1]), 0);
    };

    // The two wings.
    for (const side of [-1, 1]) {
      const outer = side < 0 ? HALL_WEST : HALL_EAST;
      const x0 = Math.min(outer, side * WING_INNER);
      const x1 = Math.max(outer, side * WING_INNER);
      const cx = (x0 + x1) / 2;
      const width = x1 - x0;
      addBox(group, [width, BASE_TOP, depth], [cx, BASE_TOP / 2, midZ], red);
      addBox(group, [width - 1, GLASS_TOP - BASE_TOP, depth - 3], [cx, (BASE_TOP + GLASS_TOP) / 2, midZ], glass);
      const over = 3.5;
      const rx0 = side < 0 ? x0 - over : x0;
      const rx1 = side < 0 ? x1 : x1 + over;
      addBox(group, [rx1 - rx0, EAVE_TOP - GLASS_TOP - 1.5, depth + over * 2], [(rx0 + rx1) / 2, GLASS_TOP + (EAVE_TOP - GLASS_TOP - 1.5) / 2, midZ], roof);
      addBox(group, [rx1 - rx0, 1.5, depth + over * 2 - 3], [(rx0 + rx1) / 2, EAVE_TOP - 0.75, midZ], roof);
      eave([rx0, FACE_SOUTH + over - 1.5], [rx1, FACE_SOUTH + over - 1.5]);
      eave([rx0, FACE_NORTH - over + 1.5], [rx1, FACE_NORTH - over + 1.5]);
      const end = side < 0 ? rx0 + 1.5 : rx1 - 1.5;
      eave([end, FACE_NORTH - over + 1.5], [end, FACE_SOUTH + over - 1.5]);
      slots(x0, x1);
      kit.solidBox(cx, midZ, width / 2 + 1, depth / 2 + 3, EAVE_TOP);
    }

    // The centre: red walls either side of the glazed entrance block, with
    // clerestory glass above them, all under the wave.
    for (const side of [-1, 1]) {
      const cx = side * (WING_INNER + 30) / 2;
      addBox(group, [20, BASE_TOP, depth], [cx, BASE_TOP / 2, midZ], red);
      addBox(group, [20, GLASS_TOP + 1.5 - BASE_TOP, depth - 3], [cx, (BASE_TOP + GLASS_TOP + 1.5) / 2, midZ], glass);
      slots(cx - 10, cx + 10);
    }
    addBox(group, [60, 9.4, depth - 6], [0, 4.7, midZ - 3], silver);
    addMesh(group, rectPane(54, 7.2), glass, [0, 0.4, FACE_SOUTH - 6 + 0.12], 0);
    addBox(group, [58, 0.8, 0.6], [0, 8.2, FACE_SOUTH - 5.9], silver);
    // The hall beyond the entrance, under the crest, glazed toward the wave.
    addBox(group, [60, 14, depth - 30], [0, 7, midZ - 12], red);
    addMesh(group, rectPane(56, 10), glass, [0, 9.4, midZ - 12 + (depth - 30) / 2 + 0.12], 0);

    // The wave canopy: a bell-shaped roof extruded north–south, with a dark
    // soffit under it.
    const STEPS = 24;
    const wave = new kit.THREE.Shape();
    const under = new kit.THREE.Shape();
    for (let i = 0; i <= STEPS; i++) {
      const x = -WAVE_HALF + (2 * WAVE_HALF * i) / STEPS;
      if (i === 0) wave.moveTo(x, waveTop(x));
      else wave.lineTo(x, waveTop(x));
    }
    for (let i = STEPS; i >= 0; i--) {
      const x = -WAVE_HALF + (2 * WAVE_HALF * i) / STEPS;
      wave.lineTo(x, waveTop(x) - WAVE_THICK);
    }
    for (let i = 0; i <= STEPS; i++) {
      const x = -WAVE_HALF + (2 * WAVE_HALF * i) / STEPS;
      if (i === 0) under.moveTo(x, waveTop(x) - WAVE_THICK);
      else under.lineTo(x, waveTop(x) - WAVE_THICK);
    }
    for (let i = STEPS; i >= 0; i--) {
      const x = -WAVE_HALF + (2 * WAVE_HALF * i) / STEPS;
      under.lineTo(x, waveTop(x) - WAVE_THICK - 0.25);
    }
    const length = WAVE_SOUTH - WAVE_NORTH;
    addMesh(group, new kit.THREE.ExtrudeGeometry(wave, { depth: length, bevelEnabled: false }), roof, [0, 0, WAVE_NORTH], 0);
    addMesh(group, new kit.THREE.ExtrudeGeometry(under, { depth: length - 0.4, bevelEnabled: false }), soffit, [0, 0, WAVE_NORTH + 0.2], 0);
    for (let x = -WING_INNER + 5; x < WING_INNER; x += 10) kit.solidBox(x, midZ, 5, depth / 2, waveTop(x) - 2);

    // Four silver Y-columns carrying the front of the wave.
    const COLUMN_Z = 48.5;
    for (const x of [-27, -9.5, 9.5, 27]) {
      addBox(group, [3, 0.6, 3], [x, 0.3, COLUMN_Z], paving);
      addCylinder(group, 1.0, 1.15, 15, [x, 7.5, COLUMN_Z], silver, 12);
      for (const arm of [-1, 1]) {
        const tx = x + arm * 4.6;
        addBeam(group, [x, 14.6, COLUMN_Z], [tx, waveTop(tx) - WAVE_THICK - 0.1, COLUMN_Z], 1.0, 1.0, silver, 0.3);
      }
      kit.solid(x, COLUMN_Z, 1.3, 15);
    }

    // Forecourt: paving, two lawns and the reflecting pool on the axis.
    const forecourt = L(FORECOURT);
    addPrism(group, forecourt, 0.02, 0.1, paving);
    addPrism(group, L(LAWN_WEST), 0.12, 0.08, materials.lawn);
    addPrism(group, L(LAWN_EAST), 0.12, 0.08, materials.lawn);
    const pool = L(POOL);
    addPrism(group, kit.offsetPolygon(pool, 0.8), 0.12, 0.42, soffit);
    addPrism(group, pool, 0.14, 0.44, materials.water);
    const xs = forecourt.map((p) => p[0]);
    const zs = forecourt.map((p) => p[1]);
    kit.clearSite((Math.min(...xs) + Math.max(...xs)) / 2, (Math.min(...zs) + Math.max(...zs)) / 2, (Math.max(...xs) - Math.min(...xs)) / 2, (Math.max(...zs) - Math.min(...zs)) / 2);
    // Apron round the hall's other sides.
    kit.clearSite(0, FACE_NORTH - 8, 150, 10);

    kit.setBoundsCollider(false);
    kit.setPerchTarget(-95, midZ);
  },
};

export default landmark;
