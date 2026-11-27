// Dhaka New Market (1954)
//
// The triangular market between Mirpur Road (east), New Market Road (south)
// and Dhaka College (north): an outer ring of shops in three wings, broken at
// three points by tall pointed concrete vaults — the gates — an inner ring of
// low shops round open brick-paved courts, and in the middle a small
// round-cornered shop block, the market mosque with its white dome and a
// slender minaret.
//
// Every footprint is an OpenStreetMap way (fetched from the OSM map API):
// outer ring 1209331033 (south-east wing), 1209331034 (south-west wing) and
// 1209331035 (north wing); inner ring 1209331036 and 1209331037; the central
// block 1209331038; the mosque 1209331039; its minaret 1209331040; and the
// four-storey market annex along the north-west side, 1209331041 (unnamed
// in OSM).
// Only the first two are in the bundled snapshot. Points below are metres
// east and north of the module's lat/lon, which with heading 0 is local
// [x, −z]. The gates stand in the three real gaps of the outer ring: south
// (Gate 1), north-west and east (the gap OSM node 3560263275 calls Gate 3).
// Heights and colours are read from photographs: stone-clad two-storey gate
// blocks with terracotta corner columns under bulb caps, and a pale vault
// rising to about 14 m.
import type { LandmarkKit, LandmarkModule, PlanPoint } from "./kit";

type EastNorth = Array<[number, number]>;
type Material = LandmarkKit["materials"]["cream"];

const OUTER_SOUTH_EAST: EastNorth = [
  [7.0, -64.8], [91.2, -60.2], [108.7, -35.3], [104.8, -20.0], [100.1, -21.2], [87.7, 27.2],
  [80.2, 25.4], [95.4, -33.8], [87.5, -44.5], [85.0, -46.5], [6.3, -50.9],
];
const OUTER_SOUTH_WEST: EastNorth = [
  [-1.9, -64.5], [-13.4, -65.2], [-14.4, -62.6], [-90.2, -68.0], [-90.0, -70.4], [-114.0, -72.1],
  [-127.5, -44.5], [-89.4, -5.3], [-50.2, 35.1], [-42.2, 27.4], [-112.3, -44.8], [-104.2, -61.7],
  [-92.6, -60.9], [-92.9, -57.5], [-2.7, -51.6],
];
const OUTER_NORTH: EastNorth = [
  [87.1, 39.3], [75.1, 36.1], [57.0, 103.2], [59.6, 106.0], [57.1, 114.0], [43.7, 116.5], [34.7, 107.3],
  [35.8, 106.2], [-36.4, 33.4], [-45.1, 40.4], [40.7, 129.0], [64.1, 124.5], [72.7, 92.4],
];
const INNER_EAST: EastNorth = [
  [-24.5, 24.8], [-16.3, 16.4], [-12.4, 20.2], [-11.0, 18.8], [36.4, 64.7], [60.3, -15.3], [57.2, -19.2],
  [9.1, -22.6], [9.3, -25.0], [4.5, -25.4], [5.6, -40.2], [9.5, -40.0], [9.7, -43.2], [78.7, -38.3],
  [83.2, -32.0], [52.1, 89.9], [48.8, 93.4], [42.8, 95.5], [-23.4, 31.8], [-20.5, 28.8],
];
const INNER_WEST: EastNorth = [
  [-26.2, 8.4], [-22.2, 12.6], [-30.2, 20.1], [-35.3, 14.6], [-38.3, 17.4], [-85.5, -32.6], [-87.1, -38.9],
  [-85.3, -43.8], [-81.7, -46.8], [-77.2, -48.6], [-12.2, -45.5], [-12.6, -37.9], [-2.7, -37.5],
  [-3.1, -29.4], [-12.1, -29.8], [-12.4, -23.9], [-51.9, -25.8], [-22.7, 5.2],
];
const CENTRE_BLOCK: EastNorth = [
  [4.3, 21.1], [7.1, -14.0], [6.6, -15.2], [5.6, -16.2], [3.9, -16.8], [-29.4, -18.8], [-31.1, -16.8],
  [-30.9, -12.5], [-29.2, -9.7], [0.4, 21.2], [2.4, 21.9],
];
const MOSQUE: EastNorth = [[8.4, 22.1], [9.5, -8.5], [35.2, -7.5], [34.1, 23.0]];
const MINARET: [number, number] = [41.2, -3.0];
// The annex wraps the north-west gate in OSM. It is cut in two here by a 13 m
// lane on the gate's axis, so the gateway opens onto ground the bird can fly
// along and not onto a wall.
const ANNEX_NORTH: EastNorth = [
  [40.7, 129.0], [25.4, 142.1], [11.4, 139.8], [-2.6, 137.6], [-68.5, 67.4], [-43.0, 42.6],
];
const ANNEX_WEST: EastNorth = [
  [-77.5, 58.0], [-87.2, 47.6], [-129.3, 86.1], [-171.9, 75.7], [-179.3, 63.9], [-155.7, 13.8], [-136.9, 31.6],
  [-121.9, 19.5], [-119.5, 21.6], [-89.4, -5.3], [-52.0, 33.3],
];
const ANNEX_LANE: EastNorth = [[-52.0, 33.3], [-43.0, 42.6], [-68.5, 67.4], [-77.5, 58.0]];
// The whole paved triangle: the hull of the outer ring.
const PAVING: EastNorth = [
  [-127.5, -44.5], [-114.0, -72.1], [-90.0, -70.4], [91.2, -60.2], [108.7, -35.3], [64.1, 124.5], [40.7, 129.0],
];

// Gates: centre of the gap (east, north), the outward direction it faces
// (east, north), half the clear gap between the wing ends and the wing depth.
const GATES: Array<{ at: [number, number]; out: [number, number]; gapHalf: number; depth: number }> = [
  { at: [2.2, -58.0], out: [0.058, -0.998], gapHalf: 4.45, depth: 13.4 },
  { at: [-43.5, 34.1], out: [-0.718, 0.696], gapHalf: 3.9, depth: 11.4 },
  { at: [81.5, 31.3], out: [0.954, 0.3], gapHalf: 5.9, depth: 12.4 },
];

const OUTER_TOP = 5.6;
const INNER_TOP = 4.5;
const GATE_BLOCK_TOP = 8.5;
const GATE_BLOCK_LENGTH = 12;
const VAULT_TOP = 14.4;
const ANNEX_TOP = 13;
const MOSQUE_TOP = 9;
const MINARET_TOP = 26.5;

const local = (points: EastNorth): PlanPoint[] => points.map(([east, north]) => [east, -north]);

const inside = (x: number, z: number, points: PlanPoint[]) => {
  let hit = false;
  for (let index = 0, previous = points.length - 1; index < points.length; previous = index++) {
    const [x1, z1] = points[index];
    const [x2, z2] = points[previous];
    if ((z1 > z) !== (z2 > z) && x < ((x2 - x1) * (z - z1)) / (z2 - z1) + x1) hit = !hit;
  }
  return hit;
};

// Cover plan polygons with world-axis strips `cell` metres deep (heading is
// 0, so local axes are world axes): one box per run of covered ground.
const strips = (
  polygons: PlanPoint[][],
  cell: number,
  pad: number,
  emit: (x: number, z: number, halfX: number, halfZ: number) => void,
) => {
  const all = polygons.flat();
  const minX = Math.min(...all.map(([x]) => x));
  const maxX = Math.max(...all.map(([x]) => x));
  const minZ = Math.min(...all.map(([, z]) => z));
  const maxZ = Math.max(...all.map(([, z]) => z));
  const step = 2;
  for (let z = minZ + cell / 2; z < maxZ; z += cell) {
    let start: number | null = null;
    for (let x = minX; x <= maxX + step; x += step) {
      const covered = x <= maxX && polygons.some((polygon) => inside(x, z, polygon));
      if (covered && start === null) start = x;
      if (!covered && start !== null) {
        const end = x - step;
        emit((start + end) / 2, z, (end - start) / 2 + pad, cell / 2);
        start = null;
      }
    }
  }
};

function build(kit: LandmarkKit) {
  const { group, addBox, addCylinder, addLathe, addPrism, addMesh, addBays, materials } = kit;
  const stone = kit.material(0xcdb6a2, { roughness: 0.9 });
  const vault = materials.whiteStone;
  const column = kit.material(0xa9553a, { roughness: 0.88 });
  const shopWall = materials.cream;
  const roof = materials.concrete;

  // Brick paving under the whole triangle (the lanes and courts).
  addPrism(group, local(PAVING), 0, 0.12, materials.plazaBrick);

  // A ring of shops: wall, shop openings on every long face, a flat canopy
  // over the walkway and a darker roof.
  const shops = (points: EastNorth, top: number, wall: Material, bay: number) => {
    const plan = local(points);
    addPrism(group, plan, 0, top, wall);
    addPrism(group, kit.offsetPolygon(plan, 1.5), 3.15, 0.22, materials.whiteStone);
    addPrism(group, kit.offsetPolygon(plan, -0.7), top, 0.14, roof);
    addBays(group, kit.wallEdges(plan), {
      bay,
      storeys: [{ y: 0.15, opening: kit.rectPane(bay - 0.9, 2.75) }],
      opening: materials.archDark,
      minEdge: 7,
      margin: 0.6,
    });
  };
  shops(OUTER_SOUTH_EAST, OUTER_TOP, stone, 4.4);
  shops(OUTER_SOUTH_WEST, OUTER_TOP, stone, 4.4);
  shops(OUTER_NORTH, OUTER_TOP, stone, 4.4);
  shops(INNER_EAST, INNER_TOP, shopWall, 4.2);
  shops(INNER_WEST, INNER_TOP, shopWall, 4.2);

  // The round-cornered block in the middle court: columns under a white roof.
  const centre = local(CENTRE_BLOCK);
  addPrism(group, centre, 0, 4.1, shopWall);
  addPrism(group, kit.offsetPolygon(centre, 1.6), 4.1, 0.35, materials.whiteStone);
  addPrism(group, kit.offsetPolygon(centre, -3), 4.45, 0.5, materials.whiteStone);
  addBays(group, kit.wallEdges(centre), {
    bay: 4.2,
    storeys: [{ y: 0.15, opening: kit.rectPane(3.3, 3.1) }],
    opening: materials.archDark,
    minEdge: 7,
    margin: 0.6,
  });

  // The gates. Each is laid out in its own frame: +Z out of the market, +X
  // along the wing.
  const vaultShape = (innerWidth: number) => {
    const spring = 2.5;
    const inner = innerWidth / 2;
    const outer = inner + 0.6;
    const innerTop = VAULT_TOP - 0.8;
    const shape = new kit.THREE.Shape();
    shape.moveTo(-outer, spring);
    shape.quadraticCurveTo(-outer, VAULT_TOP - 2.2, 0, VAULT_TOP);
    shape.quadraticCurveTo(outer, VAULT_TOP - 2.2, outer, spring);
    shape.lineTo(inner, spring);
    shape.quadraticCurveTo(inner, innerTop - 2.2, 0, innerTop);
    shape.quadraticCurveTo(-inner, innerTop - 2.2, -inner, spring);
    shape.lineTo(-outer, spring);
    return shape;
  };
  for (const gate of GATES) {
    const [east, north] = gate.at;
    const turn = Math.atan2(gate.out[0], -gate.out[1]);
    const frame = new kit.THREE.Group();
    frame.position.set(east, 0, -north);
    frame.rotation.y = turn;
    group.add(frame);

    const depth = gate.depth + 0.5;
    const shell = new kit.THREE.ExtrudeGeometry(vaultShape(gate.gapHalf * 2 + 1.4), {
      depth: depth + 1.6,
      bevelEnabled: false,
      curveSegments: 7,
    });
    shell.translate(0, 0, -(depth + 1.6) / 2);
    addMesh(frame, shell, vault);

    for (const side of [-1, 1]) {
      const blockX = side * (gate.gapHalf + GATE_BLOCK_LENGTH / 2);
      addBox(frame, [GATE_BLOCK_LENGTH, GATE_BLOCK_TOP, depth], [blockX, GATE_BLOCK_TOP / 2, 0], stone);
      addBox(frame, [GATE_BLOCK_LENGTH - 1.2, 0.14, depth - 1.2], [blockX, GATE_BLOCK_TOP + 0.07, 0], roof);
      // Shop shutters at the foot of the block and a tiled window hood above.
      for (const face of [-1, 1]) {
        addMesh(frame, kit.rectPane(GATE_BLOCK_LENGTH - 2.6, 2.9), materials.archDark, [blockX, 0.15, face * (depth / 2 + 0.1)], face === 1 ? 0 : Math.PI);
        addBox(frame, [3.2, 0.5, 0.9], [blockX, 6.1, face * (depth / 2 + 0.4)], column);
      }
      // Terracotta corner columns with a moulded band and a bulb cap.
      for (const end of [-1, 1]) {
        const columnX = blockX + end * (GATE_BLOCK_LENGTH / 2 - 0.1);
        for (const face of [-1, 1]) {
          const columnZ = face * (depth / 2 + 0.05);
          addCylinder(frame, 0.48, 0.6, GATE_BLOCK_TOP + 0.7, [columnX, (GATE_BLOCK_TOP + 0.7) / 2, columnZ], column, 6);
          addCylinder(frame, 0.78, 0.78, 0.4, [columnX, 5.2, columnZ], column, 6);
          addLathe(frame, [[0.8, 0], [0.8, 0.3], [0.5, 0.45], [0.72, 0.8], [0.6, 1.2], [0, 1.5]], 6, [columnX, GATE_BLOCK_TOP + 0.7, columnZ], stone);
        }
      }
      // Collider for the taller block (frame +X is [cos, −sin] in local x, z):
      // a world-axis square shrunk so that it stays out of the gateway on
      // the diagonal wings.
      const half = GATE_BLOCK_LENGTH / 2 / (Math.abs(Math.cos(turn)) + Math.abs(Math.sin(turn)));
      kit.solid(east + Math.cos(turn) * blockX, -north - Math.sin(turn) * blockX, half, GATE_BLOCK_TOP);
    }
  }

  // The mosque: a white two-storey prayer hall with tall arched windows, a
  // drum and a white dome; the minaret stands off its south-east corner.
  const mosque = local(MOSQUE);
  const mosqueX = mosque.reduce((sum, [x]) => sum + x, 0) / mosque.length;
  const mosqueZ = mosque.reduce((sum, [, z]) => sum + z, 0) / mosque.length;
  addPrism(group, mosque, 0, MOSQUE_TOP, materials.whiteStone);
  addPrism(group, kit.offsetPolygon(mosque, 0.5), MOSQUE_TOP, 0.5, materials.whiteStone);
  addPrism(group, kit.offsetPolygon(mosque, -0.9), MOSQUE_TOP + 0.5, 0.1, roof);
  addBays(group, kit.wallEdges(mosque), {
    bay: 4.2,
    storeys: [{ y: 4.3, opening: kit.pointedArch(1.7, 3.7) }, { y: 0.4, opening: kit.rectPane(2.2, 2.6) }],
    opening: materials.archDark,
    margin: 1.2,
  });
  addCylinder(group, 6.4, 6.6, 2.4, [mosqueX, MOSQUE_TOP + 1.7, mosqueZ], materials.whiteStone, 16);
  addCylinder(group, 6.5, 6.5, 0.9, [mosqueX, MOSQUE_TOP + 1.6, mosqueZ], materials.archDark, 16);
  addLathe(group, kit.domeProfile(6.1, 6.6, 0.1, 7), 16, [mosqueX, MOSQUE_TOP + 2.9, mosqueZ], materials.whiteStone);
  kit.addFinial(group, [mosqueX, MOSQUE_TOP + 9.5, mosqueZ], 1.3);
  kit.solid(mosqueX, mosqueZ, 6.2, MOSQUE_TOP + 9.5);

  const [minaretX, minaretZ] = [MINARET[0], -MINARET[1]];
  addLathe(group, [
    [2.7, 0], [2.7, 2.6], [1.7, 3.2], [1.35, 18.4], [2.5, 19.6], [2.5, 20.5], [1.15, 20.6], [1.05, 23.6], [1.5, 23.9], [0.25, 26],
  ], 10, [minaretX, 0, minaretZ], materials.whiteStone);
  kit.addFinial(group, [minaretX, 26, minaretZ], 0.7);
  kit.solid(minaretX, minaretZ, 2.7, MINARET_TOP);

  // The market annex along the north-west side: a plain four-storey
  // block in a different colour, so the old triangle still reads.
  const annexes = [ANNEX_NORTH, ANNEX_WEST].map(local);
  for (const annex of annexes) {
    addPrism(group, annex, 0, ANNEX_TOP, roof);
    for (let storey = 0; storey < 4; storey++) {
      addPrism(group, kit.offsetPolygon(annex, 0.08), 1 + storey * 3.15, 1.5, materials.archDark);
    }
  }
  const lane = local(ANNEX_LANE);
  addPrism(group, lane, 0, 0.12, materials.plazaBrick);

  // A few trees in the middle court.
  for (const [east, north] of [[26, 39], [41, 34], [48, 10], [50, -10], [22, -15]]) {
    kit.addTree(group, east, -north, 4.2, 3.6);
  }

  // Colliders follow the real wings, so the lanes, courts and gateways stay
  // open to fly through; the whole triangle is cleared of generic city.
  kit.setBoundsCollider(false);
  strips([OUTER_SOUTH_EAST, OUTER_SOUTH_WEST, OUTER_NORTH].map(local), 3, 0, (x, z, halfX, halfZ) => kit.solidBox(x, z, halfX, halfZ, OUTER_TOP));
  strips([INNER_EAST, INNER_WEST, CENTRE_BLOCK].map(local), 6, 0, (x, z, halfX, halfZ) => kit.solidBox(x, z, halfX, halfZ, INNER_TOP));
  strips([mosque], 8, 0, (x, z, halfX, halfZ) => kit.solidBox(x, z, halfX, halfZ, MOSQUE_TOP + 0.5));
  strips(annexes, 8, 0, (x, z, halfX, halfZ) => kit.solidBox(x, z, halfX, halfZ, ANNEX_TOP));
  strips([lane], 6, 0, (x, z, halfX, halfZ) => kit.clearSite(x, z, halfX, halfZ));
  strips([local(PAVING)], 10, 1, (x, z, halfX, halfZ) => kit.clearSite(x, z, halfX, halfZ));
  // Beside the finial, on the crown of the dome.
  kit.setPerchTarget(mosqueX + 1.5, mosqueZ);
}

const landmark: LandmarkModule = {
  key: "dhaka-new-market",
  label: "Dhaka New Market",
  labelBn: "ঢাকা নিউ মার্কেট",
  shortLabel: "DNM",
  lat: 23.733,
  lon: 90.3838,
  altitude: MINARET_TOP,
  heading: 0,
  clearingRadius: 125,
  extents: [110, 100],
  replacesOsmBuildingIds: [1209331033, 1209331034],
  triangleBudget: 8000,
  plotGap: 6,
  build,
};

export default landmark;
