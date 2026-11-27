// Shankhari Bazar (Shakhari Bazar Road), Old Dhaka
//
// The lane of the conch-shell bangle makers: some 270 m of very narrow, very
// deep three- to six-storey houses, each only 3–4.5 m wide and painted its own
// strong colour, standing wall to wall on both sides of a lane a few metres
// across.
//
// The lane is OSM way 33800030 (living_street "Shakhari Bazar Road"); LANE
// below is that way between Court House Street's side and the Patuatuli end,
// in metres east (x) and south (z) of its vertex at 23.709958, 90.409122.
// OSM maps about seventy coarse building outlines along it (2–7 levels, 6–28 m
// deep); the individual house fronts are not mapped, so the plot widths,
// depths, storeys and colours are a seeded pattern inside those ranges, not a
// survey. The lane is drawn 4.6 m wide (really about 3 m) so it reads from
// above. Gaps are left where the side lanes join (ways 34361870, 34361879
// and 369784905).
//
// Heading 0: local +X is east, local +Z is south.
import { headingFromBearing, type LandmarkModule, type Vec3 } from "./kit";

const LANE: Array<[number, number]> = [
  [124.6, 4.0], [113.4, 4.5], [92.5, 3.8], [74.3, 1.8], [53.1, -0.2], [29.5, -0.9], [0, 0],
  [-17.7, -0.4], [-43.1, -2.8], [-77.3, -5.0], [-91.5, -7.5], [-103.6, -8.0], [-127.4, -8.1], [-139.8, -6.8],
];
const HALF_LANE = 2.3;
const STOREY = 3.1;
// Side lanes: [x where one joins, row it interrupts (+1 north, -1 south)].
const SIDE_LANES: Array<[number, number]> = [[53.1, -1], [0, -1], [-77.3, 1]];

const landmark: LandmarkModule = {
  key: "shankhari-bazar",
  label: "Shankhari Bazar",
  labelBn: "শাঁখারী বাজার",
  shortLabel: "SKB",
  lat: 23.709958,
  lon: 90.409122,
  altitude: 20,
  heading: headingFromBearing(180),
  clearingRadius: 70,
  extents: [135, 24],
  triangleBudget: 6500,
  plotGap: 3,
  inspectDistance: 150,
  build(kit) {
    const { group, addBox, addMesh, rectPane, materials } = kit;
    const paints = [
      kit.material(0xe58ea8, { roughness: 0.9 }),
      kit.material(0x45b5c2, { roughness: 0.9 }),
      kit.material(0xefc548, { roughness: 0.9 }),
      kit.material(0x4d84d6, { roughness: 0.9 }),
      kit.material(0xcc5b49, { roughness: 0.9 }),
      materials.cream,
    ];
    let seed = 90_409;
    const random = () => {
      seed = (seed * 1_103_515_245 + 12_345) % 2_147_483_648;
      return seed / 2_147_483_648;
    };

    // Lane paving.
    kit.addSweptBox(group, LANE.map(([x, z]): Vec3 => [x, 0.14, z]), HALF_LANE + 0.3, 0.14, materials.wornAsphalt);

    // Arc-length table of the lane.
    const lengths: number[] = [0];
    for (let i = 1; i < LANE.length; i++) {
      lengths.push(lengths[i - 1] + Math.hypot(LANE[i][0] - LANE[i - 1][0], LANE[i][1] - LANE[i - 1][1]));
    }
    const total = lengths[lengths.length - 1];
    const at = (s: number) => {
      let i = 1;
      while (i < LANE.length - 1 && lengths[i] < s) i++;
      const t = (s - lengths[i - 1]) / (lengths[i] - lengths[i - 1]);
      const dx = LANE[i][0] - LANE[i - 1][0];
      const dz = LANE[i][1] - LANE[i - 1][1];
      const length = Math.hypot(dx, dz);
      return { x: LANE[i - 1][0] + dx * t, z: LANE[i - 1][1] + dz * t, tx: dx / length, tz: dz / length };
    };

    kit.setBoundsCollider(false);
    let perch: [number, number] | null = null;
    let lastPaint = -1;
    for (const side of [1, -1]) {
      let s = 0.4;
      while (s < total - 3) {
        const width = Math.min(3 + random() * 1.6, total - s);
        const here = at(s + width / 2);
        s += width + 0.06;
        const depth = 11 + random() * 11;
        const storeys = 3 + Math.floor(random() * random() * 4.2);
        let paintIndex = Math.floor(random() * paints.length);
        if (paintIndex === lastPaint) paintIndex = (paintIndex + 1) % paints.length;
        lastPaint = paintIndex;
        const stairHead = random() < 0.55;
        if (SIDE_LANES.some(([x, laneSide]) => laneSide === side && Math.abs(here.x - x) < width / 2 + 1.6)) continue;

        const height = storeys * STOREY + 0.9;
        const paint = paints[paintIndex];
        // Normal pointing away from the lane on this side, and the house's turn.
        const nx = -here.tz * side;
        const nz = here.tx * side;
        const turn = Math.atan2(-here.tz, here.tx);
        const cx = here.x + nx * (HALF_LANE + depth / 2);
        const cz = here.z + nz * (HALF_LANE + depth / 2);
        const house = new kit.THREE.Group();
        house.position.set(cx, 0, cz);
        house.rotation.y = turn;
        group.add(house);
        // In the house's frame +X runs along the lane and +Z points away from
        // it on the `side` = 1 row, so the lane front is the -side face.
        const face = -side;
        addBox(house, [width, height, depth], [0, height / 2, 0], paint);
        // Grey roof inside the painted parapet rim.
        addBox(house, [width - 0.5, 0.12, depth - 0.5], [0, height, 0], materials.roofGrey);
        if (stairHead) {
          const along = (random() - 0.5) * depth * 0.5;
          addBox(house, [width - 0.9, 2.5, 3.2], [0, height + 1.0, along], paints[(paintIndex + 3) % paints.length]);
        }
        // Lane front: one dark strip of openings and a pale balcony per floor.
        const frontZ = face * (depth / 2 + 0.06);
        const frontTurn = face === 1 ? 0 : Math.PI;
        addMesh(house, rectPane(width - 1.1, height - 1.9), materials.archDark, [0, 0.3, frontZ], frontTurn);
        for (let floor = 1; floor < storeys; floor++) {
          addMesh(house, rectPane(width - 0.3, 0.95), materials.cream, [0, floor * STOREY - 0.1, frontZ + face * 0.05], frontTurn);
        }

        // World-axis collider, kept just off the lane so the bird can fly it.
        const halfAlong = width / 2 + 0.05;
        kit.solidBox(cx + nx * 0.2, cz + nz * 0.2, halfAlong, depth / 2 - 0.2, height);
        if (side === 1 && !perch && here.x < 8 && here.x > -8) perch = [cx, cz];
      }
    }
    // The lane itself stays free of generic buildings and street trees.
    for (let i = 1; i < LANE.length; i++) {
      const [ax, az] = LANE[i - 1];
      const [bx, bz] = LANE[i];
      kit.clearSite((ax + bx) / 2, (az + bz) / 2, Math.abs(bx - ax) / 2 + 1, Math.abs(bz - az) / 2 + HALF_LANE + 0.5);
    }
    if (perch) kit.setPerchTarget(perch[0], perch[1]);
  },
};

export default landmark;
