// Nilkhet Book Market
//
// The second-hand and textbook market in the north-east corner of the Nilkhet
// crossing, across Mirpur Road from New Market: a block of low tin-roofed
// stalls packed along narrow lanes, patched over with blue tarpaulins, behind
// a two-storey row of signboarded shops on Nilkhet Road.
//
// OSM maps it as way 296897366 (amenity=marketplace, "নীলক্ষেত বই মার্কেট"),
// a 2.5 ha polygon that also takes in a tower, a mosque and other markets to
// the north and east. Only its south-west part is built here — the part the
// ~65 mapped shop=books nodes fall in — cut at 235 m east and 50 m north of
// the reference point below, and set back from the Nilkhet Road and Mirpur
// Road centrelines so the stalls stay off the game's 14 m carriageways. OSM
// has no building footprints for the stalls: the rows are a texture for the
// area, not surveyed sheds.
//
// Local +X runs east along Nilkhet Road; +Z faces the road (south).
import { headingFromBearing, type LandmarkKit, type LandmarkModule, type PlanPoint } from "./kit";

// The plot, in metres east and north of 23.7330 N, 90.3838 E (the reference
// the New Market module uses too).
const REFERENCE_LAT = 23.733;
const REFERENCE_LON = 90.3838;
const METRES_PER_DEGREE_LAT = 110540;
const METRES_PER_DEGREE_LON = 101874.2;
const PLOT: Array<[number, number]> = [
  [136, -10], [147, 3], [158, 19.1], [171.5, 50], [235, 50], [235, -39.5], [222.5, -41.3], [166.5, -49.3],
  [152, -50], [146, -45],
];

const SHED_DEPTH = 5;
const LANE = 2.3;
const STALL_TOP = 3.4;
const FRONT_TOP = 6.4;

const inside = (x: number, z: number, points: PlanPoint[]) => {
  let hit = false;
  for (let index = 0, previous = points.length - 1; index < points.length; previous = index++) {
    const [x1, z1] = points[index];
    const [x2, z2] = points[previous];
    if ((z1 > z) !== (z2 > z) && x < ((x2 - x1) * (z - z1)) / (z2 - z1) + x1) hit = !hit;
  }
  return hit;
};

function build(kit: LandmarkKit) {
  const { group, addBox, addPrism, materials } = kit;
  const wall = kit.material(0x5f564b, { roughness: 0.95 });
  const rust = kit.material(0x7f5d4a, { roughness: 0.85 });
  const tarp = kit.material(0x2f6fc2, { roughness: 0.7 });
  const sign = kit.litMaterial(0xe2b93c, 0.5);
  const roofs = [materials.tinRoof, materials.tinRoof, rust, materials.tinRoof];

  const plot: PlanPoint[] = PLOT.map(([east, north]) =>
    kit.toLocal(REFERENCE_LAT + north / METRES_PER_DEGREE_LAT, REFERENCE_LON + east / METRES_PER_DEGREE_LON));
  addPrism(group, plot, 0, 0.1, materials.wornAsphalt);

  const minX = Math.min(...plot.map(([x]) => x));
  const maxX = Math.max(...plot.map(([x]) => x));
  const minZ = Math.min(...plot.map(([, z]) => z));
  const maxZ = Math.max(...plot.map(([, z]) => z));

  // A fixed pseudo-random sequence, so the market is the same on every build.
  let seed = 20231;
  const random = () => {
    seed = (seed * 16807) % 2147483647;
    return seed / 2147483647;
  };

  kit.setBoundsCollider(false);
  let perch: [number, number] | null = null;
  let perchDistance = Infinity;

  // Rows of sheds from the road frontage (largest z) back to the north.
  let row = 0;
  for (let z1 = maxZ - 0.6; z1 - SHED_DEPTH > minZ; z1 -= SHED_DEPTH + LANE, row++) {
    const z0 = z1 - SHED_DEPTH;
    const zc = (z0 + z1) / 2;
    const front = row === 0;
    // Stretches of this row that lie wholly inside the plot.
    let start: number | null = null;
    for (let x = minX; x <= maxX + 1; x += 1) {
      const covered = x <= maxX && inside(x, z0, plot) && inside(x, z1, plot);
      if (covered && start === null) start = x;
      if (covered || start === null) continue;
      const end = x - 1;
      const runStart = start;
      start = null;
      if (end - runStart < 5) continue;
      kit.solidTiles(runStart, end, z0, z1, front ? FRONT_TOP : STALL_TOP + 0.6, 14);
      // Cut the stretch into sheds with cross lanes between them.
      let x0 = runStart;
      while (end - x0 >= 5) {
        const length = Math.min(end - x0, front ? 16 + random() * 14 : 10 + random() * 13);
        const xc = x0 + length / 2;
        if (front) {
          addBox(group, [length, FRONT_TOP, SHED_DEPTH], [xc, FRONT_TOP / 2, zc], materials.agedConcrete);
          addBox(group, [length - 0.8, 0.12, SHED_DEPTH - 0.8], [xc, FRONT_TOP + 0.06, zc], materials.tinRoof);
          addBox(group, [length - 1.2, 2.5, 0.2], [xc, 1.45, z1 + 0.05], wall);
          addBox(group, [length - 1.2, 1.1, 0.25], [xc, 3.55, z1 + 0.12], random() < 0.5 ? sign : tarp);
        } else {
          const top = STALL_TOP - 0.5 + random() * 0.9;
          addBox(group, [length, top, SHED_DEPTH], [xc, top / 2, zc], wall);
          const sheet = addBox(group, [length + 0.4, 0.16, SHED_DEPTH + 0.9], [xc, top + 0.2, zc], roofs[Math.floor(random() * roofs.length)]);
          sheet.rotation.x = (random() < 0.5 ? -1 : 1) * 0.07;
          // A tarpaulin slung over the lane in front of some sheds.
          if (random() < 0.45) {
            const span = length * (0.35 + random() * 0.4);
            const cover = addBox(group, [span, 0.1, LANE + 1.6], [x0 + span / 2 + random() * (length - span), top + 0.45, z1 + LANE / 2], tarp);
            cover.rotation.x = (random() - 0.5) * 0.16;
          }
          const distance = Math.hypot(xc, zc);
          if (distance < perchDistance) {
            perchDistance = distance;
            perch = [xc, zc];
          }
        }
        x0 += length + 1.7;
      }
    }
  }

  // Keep the lanes between the rows free of generic buildings and trees.
  for (let z = minZ; z < maxZ; z += 10) {
    let x0 = Infinity;
    let x1 = -Infinity;
    for (let x = minX; x <= maxX; x += 2) {
      if (!inside(x, Math.min(z + 5, maxZ - 0.5), plot)) continue;
      x0 = Math.min(x0, x);
      x1 = Math.max(x1, x);
    }
    if (x1 > x0) kit.clearSite((x0 + x1) / 2, Math.min(z + 5, maxZ), (x1 - x0) / 2, 5);
  }
  if (perch) kit.setPerchTarget(perch[0], perch[1]);
}

const landmark: LandmarkModule = {
  key: "nilkhet-book-market",
  label: "Nilkhet Book Market",
  labelBn: "নীলক্ষেত বই মার্কেট",
  shortLabel: "NBM",
  lat: 23.733,
  lon: 90.385645,
  altitude: 7,
  heading: headingFromBearing(172),
  clearingRadius: 55,
  extents: [50, 50],
  triangleBudget: 2500,
  plotGap: 4,
  build,
};

export default landmark;
