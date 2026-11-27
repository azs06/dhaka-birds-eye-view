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
// Local +Z faces EAST, down the axis of the forecourt; +X points north.
import { headingFromBearing, type LandmarkModule } from "./kit";

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
  triangleBudget: 2500,
  plotGap: 6,
  inspectDistance: 70,
  // The memorial park round it (OSM 801796269 is a 300 × 156 m block of
  // lawns and trees south of the graveyard).
  park: {
    name: "Mirpur Martyred Intellectuals Memorial Park",
    lat: 23.79332,
    lon: 90.34615,
    rx: 150,
    rz: 78,
  },
  build(kit) {
    const { THREE, group, addBox, addMesh, addPalm, materials } = kit;
    const wallBrick = kit.material(0xa83f2d, { roughness: 0.9 });
    const coping = materials.brickTrim;
    const steps = materials.plazaRed;
    const paving = materials.plazaBrick;
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
