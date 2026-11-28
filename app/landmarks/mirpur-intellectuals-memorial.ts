// Martyred Intellectuals Memorial, Mirpur (Mirpur Shaheed Buddhijibi Smritisoudho)
//
// The memorial at the south edge of the Mirpur Martyred Intellectuals'
// Graveyard, Mirpur-1 — a different monument from the Rayer Bazar memorial.
// Four red-brick wedge walls stand on the diagonals of a low stepped square:
// each wall is low where it meets the raised centre and climbs to a tall
// vertical end at the outer corner, and broad flights of brick steps rise
// between them on all four sides to the plaque (a black slab with a white
// open book in front of it). A large brick-paved forecourt laid out in a grid
// of white marble strips opens to the east.
//
// Position: OSM way 801796268 (historic=memorial) is a 38 m diamond centred
// at 23.793722, 90.345439, but on the z19 imagery the four walls converge
// about 13 m north of that centroid, still inside the way; the origin is the
// imagery centre. The forecourt, the brick paving round the memorial and the
// park (OSM way 801796269, "Mirpur Buddhijibi Shahid Minar Park") are taken
// from the same imagery / OSM. None of these ways is in the snapshot.
// Heights and colours from Commons photos (Category:Martyred Intellectuals
// Memorial, Mirpur): the wall ends stand about 9 m, roughly 5½ people.
//
// The graveyard round it (OSM way 451543888, "Mirpur Buddhijibi
// Koborsthan", about 370 × 360 m) is drawn from the same polygon and the Esri
// World Imagery: a brick boundary wall, earth paths, planted grave rows in the
// west, fields of white tombs in the south and east under old trees (the
// trees are two park ellipses inside the polygon), the green-domed graveyard
// mosque, and the open earth field of the north-west lobe. Behind the
// memorial's altar, 63 m west of it, lies the white-rimmed pool (the "water
// tank" of the brief; Prothom Alo, Aug 2023, photos 12–14) and south-east of
// it a second, narrow pool in the park.
//
// Local +Z faces EAST, down the axis of the forecourt; +X points north.
import { headingFromBearing, type LandmarkModule, type PlanPoint } from "./kit";

// OSM way 451543888, [lat, lon].
const GRAVEYARD: Array<[number, number]> = [
  [23.79745, 90.343628], [23.797379, 90.344128], [23.797179, 90.344121], [23.796349, 90.344139], [23.796371, 90.34573],
  [23.796697, 90.345728], [23.796818, 90.345879], [23.796918, 90.34604], [23.797017, 90.346245], [23.796806, 90.346467],
  [23.796501, 90.346839], [23.796301, 90.347161], [23.79608, 90.347066], [23.795757, 90.346926], [23.795467, 90.346952],
  [23.795192, 90.346925], [23.794963, 90.34684], [23.794743, 90.347325], [23.794267, 90.347291], [23.793852, 90.347187],
  [23.79404, 90.346443], [23.794057, 90.344668], [23.794126, 90.34466], [23.794084, 90.343442], [23.794942, 90.343179],
  [23.795698, 90.34297], [23.795844, 90.342988], [23.796656, 90.343246], [23.796945, 90.343325], [23.797213, 90.343513],
];
// Tomb fields, as [south, north, west, east] boxes and a tomb count each.
const TOMB_FIELDS: Array<[number, number, number, number, number]> = [
  [23.79428, 23.79496, 90.34445, 90.34598, 150],
  [23.79428, 23.79515, 90.34640, 90.34690, 70],
  [23.79515, 23.79600, 90.34650, 90.34700, 40],
];
// Planted grave rows in the west, [south, north, west, east].
const GRAVE_ROWS: Array<[number, number, number, number]> = [
  [23.79445, 23.79615, 90.34345, 90.34410],
  [23.79505, 23.79615, 90.34420, 90.34478],
];

// Stepped square: half side of the bottom and top tiers, number of steps.
const BASE_HALF = 13.5;
const TOP_HALF = 5;
const STEPS = 8;
const RISE = 0.2;
const TOP_Y = 0.12 + STEPS * RISE;
// Diagonal walls: radius of the low inner end and the tall outer end.
const WALL_INNER = 6.6;
const WALL_OUTER = BASE_HALF * Math.SQRT2 - 0.4;
const WALL_LOW = TOP_Y + 0.9;
const WALL_HIGH = 9.2;
const WALL_THICK = 1.05;

const landmark: LandmarkModule = {
  key: "mirpur-intellectuals-memorial",
  label: "Martyred Intellectuals Memorial, Mirpur",
  labelBn: "মিরপুর শহীদ বুদ্ধিজীবী স্মৃতিসৌধ",
  shortLabel: "MIM",
  lat: 23.793837,
  lon: 90.345458,
  altitude: WALL_HIGH,
  heading: headingFromBearing(90),
  clearingRadius: 60,
  extents: [BASE_HALF, BASE_HALF],
  triangleBudget: 7000,
  plotGap: 6,
  inspectDistance: 70,
  park: [
    // The memorial park round it (OSM 801796269 is a 300 × 156 m block of
    // lawns and trees south of the graveyard).
    {
      name: "Mirpur Martyred Intellectuals Memorial Park",
      lat: 23.79332,
      lon: 90.34615,
      rx: 150,
      rz: 78,
    },
    // The graveyard's main body, kept inside its polygon; the corners and
    // the north-west lobe are cleared in build().
    {
      name: "Mirpur Martyred Intellectuals Graveyard",
      lat: 23.79515,
      lon: 90.3452,
      rx: 165,
      rz: 112,
    },
  ],
  build(kit) {
    const { THREE, group, addBox, addMesh, addPalm, addPrism, materials } = kit;
    const wallBrick = kit.material(0xa83f2d, { roughness: 0.9 });
    const coping = materials.brickTrim;
    const paving = materials.plazaBrick;
    const steps = paving;
    const strip = materials.marble;
    const blackStone = kit.material(0x1d1d1f, { roughness: 0.45 });

    // Brick paving round the memorial and the gridded forecourt to the east
    // (local z 17 → 88, x ±24), one slab with marble strips on top.
    const PAVE_WEST = -27;
    const PAVE_EAST = 88;
    const PAVE_HALF_X = 24;
    addBox(group, [PAVE_HALF_X * 2, 0.12, PAVE_EAST - PAVE_WEST], [0, 0.06, (PAVE_EAST + PAVE_WEST) / 2], paving);
    const GRID_START = 17;
    const GRID = 6;
    for (let x = -PAVE_HALF_X; x <= PAVE_HALF_X + 0.01; x += GRID) {
      const at = Math.max(-PAVE_HALF_X + 0.23, Math.min(PAVE_HALF_X - 0.23, x));
      addBox(group, [0.45, 0.04, PAVE_EAST - GRID_START], [at, 0.14, (PAVE_EAST + GRID_START) / 2], strip);
    }
    for (let z = GRID_START; z <= PAVE_EAST + 0.01; z += GRID) {
      addBox(group, [PAVE_HALF_X * 2, 0.04, 0.45], [0, 0.141, Math.min(z, PAVE_EAST - 0.23)], strip);
    }

    // Stepped square: each tier a slab a little smaller than the one below,
    // so flights of steps face all four sides between the walls.
    for (let i = 0; i < STEPS; i++) {
      const half = BASE_HALF - ((BASE_HALF - TOP_HALF) * i) / (STEPS - 1);
      addBox(group, [half * 2, RISE, half * 2], [0, 0.12 + RISE * (i + 0.5), 0], steps);
    }

    // The four wedge walls on the diagonals, low at the centre and tall at the
    // corners, with a lighter brick coping along the sloping top.
    const wallShape = new THREE.Shape();
    wallShape.moveTo(WALL_INNER, 0);
    wallShape.lineTo(WALL_OUTER, 0);
    wallShape.lineTo(WALL_OUTER, WALL_HIGH);
    wallShape.lineTo(WALL_INNER, WALL_LOW);
    wallShape.lineTo(WALL_INNER, 0);
    const copeShape = new THREE.Shape();
    copeShape.moveTo(WALL_INNER, WALL_LOW - 0.02);
    copeShape.lineTo(WALL_OUTER + 0.08, WALL_HIGH - 0.02);
    copeShape.lineTo(WALL_OUTER + 0.08, WALL_HIGH + 0.16);
    copeShape.lineTo(WALL_INNER, WALL_LOW + 0.16);
    copeShape.lineTo(WALL_INNER, WALL_LOW - 0.02);
    const slab = (shape: InstanceType<typeof THREE.Shape>, depth: number) => {
      const geometry = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: false });
      geometry.translate(0, 0, -depth / 2);
      return geometry;
    };
    const diagonals: Array<[number, number]> = [[1, 1], [1, -1], [-1, 1], [-1, -1]];
    for (const [dx, dz] of diagonals) {
      // Rotation about Y taking the shape's +X onto the diagonal (dx, dz).
      const turn = Math.atan2(-dz, dx);
      addMesh(group, slab(wallShape, WALL_THICK), wallBrick, [0, 0, 0], turn);
      addMesh(group, slab(copeShape, WALL_THICK + 0.12), coping, [0, 0, 0], turn);
      // Stepped column colliders up the slope; the flights stay open.
      for (let r = WALL_INNER + 1; r <= WALL_OUTER; r += 2) {
        const top = WALL_LOW + ((WALL_HIGH - WALL_LOW) * (r + 1 - WALL_INNER)) / (WALL_OUTER - WALL_INNER);
        kit.solid((dx * r) / Math.SQRT2, (dz * r) / Math.SQRT2, 0.9, Math.min(top, WALL_HIGH));
      }
    }

    // The plaque on the raised centre: a black stone slab facing the
    // forecourt, and a white marble open book on a stand in front of it.
    addBox(group, [4.2, 0.35, 1.6], [0, TOP_Y + 0.175, -1.3], blackStone);
    addBox(group, [3.4, 2.5, 0.35], [0, TOP_Y + 0.35 + 1.25, -1.5], blackStone);
    addBox(group, [1.0, 0.7, 0.8], [0, TOP_Y + 0.35, 1.4], strip);
    for (const side of [-1, 1]) {
      const page = addBox(group, [0.95, 0.12, 1.25], [side * 0.5, TOP_Y + 1.15, 1.4], strip);
      page.rotation.set(-0.85, 0, side * -0.18);
    }
    kit.solidBox(0, 0, TOP_HALF, TOP_HALF, TOP_Y);
    kit.solidBox(0, -1.4, 2.1, 0.8, TOP_Y + 2.85);

    // Palmyra palms by the south-west corner (their shadows are on the
    // imagery; the photos show the row behind the memorial).
    addPalm(group, -17.5, -9, 15, 0.05, 0.4);
    addPalm(group, -19.5, -13.5, 16.5, 0.07, 1.9);
    addPalm(group, -16, -17.5, 14, 0.06, 3.1);
    addPalm(group, -21, -5, 13.5, 0.05, 4.4);

    // ── The graveyard ──────────────────────────────────────────────────────
    // Shaded, trodden earth: darker than the kit's packed earth, as the
    // graveyard reads under its trees on the imagery.
    const earth = kit.material(0x554c3d, { roughness: 1 });
    const planted = kit.material(0x4d6b3f, { roughness: 0.95 });
    const L = ([lat, lon]: [number, number]): PlanPoint => kit.toLocal(lat, lon);
    const yard = GRAVEYARD.map(L);
    addPrism(group, yard, 0, 0.07, earth);
    // Boundary wall, 2 m of brick with a lighter coping, open where the
    // memorial forecourt meets the graveyard's south edge.
    // Each side is cut into pieces of at most 40 m; pieces beside the
    // memorial (local x 0…40, z −35…95) are left out.
    yard.forEach(([ax, az], index) => {
      const [bx, bz] = yard[(index + 1) % yard.length];
      const pieces = Math.max(1, Math.ceil(Math.hypot(bx - ax, bz - az) / 40));
      for (let piece = 0; piece < pieces; piece++) {
        const t0 = piece / pieces;
        const t1 = (piece + 1) / pieces;
        const mx = ax + (bx - ax) * (t0 + t1) / 2;
        const mz = az + (bz - az) * (t0 + t1) / 2;
        if (mx > 0 && mx < 40 && mz > -35 && mz < 95) continue;
        kit.addSweptBox(group, [
          [ax + (bx - ax) * t0, 2, az + (bz - az) * t0],
          [ax + (bx - ax) * t1, 2, az + (bz - az) * t1],
        ], 0.18, 2, coping);
      }
    });
    const inside = (x: number, z: number) => {
      let hit = false;
      for (let i = 0, j = yard.length - 1; i < yard.length; j = i++) {
        const [xi, zi] = yard[i];
        const [xj, zj] = yard[j];
        if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) hit = !hit;
      }
      return hit;
    };
    let seed = 1971;
    const random = () => {
      seed = (seed * 16807) % 2147483647;
      return (seed - 1) / 2147483646;
    };
    // Planted grave rows: long low beds running east–west with earth between.
    for (const [south, north, west, east] of GRAVE_ROWS) {
      const [x0, z0] = L([south, west]);
      const [x1, z1] = L([north, east]);
      const xMin = Math.min(x0, x1);
      const xMax = Math.max(x0, x1);
      const zMid = (z0 + z1) / 2;
      const length = Math.abs(z1 - z0);
      for (let x = xMin + 2; x < xMax - 1; x += 4.2) addBox(group, [2.4, 0.22, length], [x, 0.11, zMid], planted);
    }
    // White tombs in loose east–west rows.
    for (const [south, north, west, east, count] of TOMB_FIELDS) {
      const [x0, z0] = L([south, west]);
      const [x1, z1] = L([north, east]);
      for (let placed = 0, tries = 0; placed < count && tries < count * 4; tries++) {
        const x = Math.min(x0, x1) + random() * Math.abs(x1 - x0);
        const z = Math.min(z0, z1) + random() * Math.abs(z1 - z0);
        if (!inside(x, z) || Math.hypot(x, z) < 45) continue;
        // Snap to rows 3.4 m apart so the fields read as rows from the air.
        const rowX = Math.round(x / 3.4) * 3.4;
        addBox(group, [1.0, 0.45 + random() * 0.25, 2.2], [rowX, 0.3, z], strip);
        placed++;
      }
    }
    // The graveyard mosque: a white three-storey block with a green dome on
    // its roof, and a lower annex to the south (imagery, 23.79519, 90.34619).
    const [mx, mz] = L([23.79519, 90.34619]);
    addBox(group, [27, 12, 27], [mx, 6, mz], strip);
    addBox(group, [27.6, 0.5, 27.6], [mx, 12.2, mz], strip);
    kit.addLathe(group, kit.domeProfile(4.6, 5.2, 0.15), 12, [mx, 12.4, mz], planted);
    addBox(group, [13, 7, 16], [mx - 20, 3.5, mz + 2], strip);
    kit.solidBox(mx, mz, 13.5, 13.5, 17.6);
    kit.solidBox(mx - 20, mz + 2, 6.5, 8, 7);
    // The pool behind the altar: 47.7 m north–south by 23.7 m, a white rim
    // round still, dark water; and the narrow pool south-east of the memorial.
    const pool = (south: number, north: number, west: number, east: number) => {
      const [x0, z0] = L([south, west]);
      const [x1, z1] = L([north, east]);
      const sx = Math.abs(x1 - x0);
      const sz = Math.abs(z1 - z0);
      const cx = (x0 + x1) / 2;
      const cz = (z0 + z1) / 2;
      addBox(group, [sx, 0.5, sz], [cx, 0.25, cz], strip);
      addBox(group, [sx - 1.6, 0.06, sz - 1.6], [cx, 0.53, cz], materials.water);
      kit.clearSite(cx, cz, sx / 2 + 3, sz / 2 + 3);
    };
    pool(23.79362, 23.79405, 90.34473, 90.34496);
    pool(23.79331, 23.79337, 90.34523, 90.34564);
    // Keep the generic city off the parts of the polygon the park ellipse
    // misses (its corners and the north-west lobe), in 24 m cells.
    const gx = yard.map(([x]) => x);
    const gz = yard.map(([, z]) => z);
    const [pcx, pcz] = L([23.79515, 90.3452]);
    for (let x = Math.min(...gx) + 12; x < Math.max(...gx); x += 24) {
      for (let z = Math.min(...gz) + 12; z < Math.max(...gz); z += 24) {
        if (!inside(x, z)) continue;
        // Local +X is north and +Z east here: the ellipse is 165 m E–W, 112 m N–S.
        const e = ((z - pcz) / 160) ** 2 + ((x - pcx) / 107) ** 2;
        if (e < 1) continue;
        kit.clearSite(x, z, 12, 12);
      }
    }

    // The memorial carries its own colliders; the paved plot stays clear of
    // the generic city and the park's trees.
    kit.setBoundsCollider(false);
    kit.clearSite(0, (PAVE_EAST + PAVE_WEST) / 2, PAVE_HALF_X + 1, (PAVE_EAST - PAVE_WEST) / 2 + 1);
    // Perch on the tall north-east wall end.
    const perch = (WALL_OUTER - 0.6) / Math.SQRT2;
    kit.setPerchTarget(perch, perch);
  },
};

export default landmark;
