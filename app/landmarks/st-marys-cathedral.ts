// St. Mary's Cathedral, Ramna (Cathedral of the Immaculate Conception)
//
// The seat of the Catholic Archdiocese of Dhaka, on Kakrail Road beside the
// Archbishop's House. It is not a spired church: the photos show a 1950s
// modernist hall, a tall white nave whose long walls are clerestories of
// white concrete jali screens between plain piers, under a thin flat roof
// slab that overhangs on every side; single-storey aisles below (red brick
// on the north part of the east side, white with a slab canopy over the
// entrance further south), a low white wing at the south end, and a tall
// white cross on a post at the north-east corner (Commons: "Dhaka, Catholic
// Cathedral of the Immaculate Conception.JPG", which looks west with the
// ten-storey DPHE block, way 226516706, behind). The brief's "tall pointed
// concrete roof" is in no reference and is not built.
//
// OSM: cathedral way 226516707, a 20 × 52 m rectangle running north-south,
// centred on the origin; it is not in the bundled snapshot. East of it, the
// snapshot's "Kakrail Church" (way 376322211, U-shaped, 48 × 29 m) is the
// Archbishop's House: the snapshot gives it 25.4 m, but it is the two-storey
// arcaded house in "Archbishop's House & St. Mary's Cathedral, Dhaka.jpg", so
// it is replaced and redrawn here at that height.
//
// Heading π: local +Z is north (toward Kakrail Road), local +X is WEST, so an
// OSM offset (E, N) is local (-E, N).
import { headingFromBearing, type LandmarkModule, type PlanPoint } from "./kit";

const NAVE_TOP = 11.2;
const AISLE_TOP = 4.2;
const NAVE_HALF = 7;
const NAVE_SOUTH = -15;
const NAVE_NORTH = 26;
const HOUSE_TOP = 9.4;

const landmark: LandmarkModule = {
  key: "st-marys-cathedral",
  label: "St. Mary's Cathedral",
  labelBn: "সেন্ট মেরি ক্যাথিড্রাল",
  shortLabel: "SMC",
  lat: 23.737032,
  lon: 90.405043,
  altitude: 13,
  heading: headingFromBearing(0),
  clearingRadius: 50,
  extents: [10, 26],
  replacesOsmBuildingIds: [376322211],
  triangleBudget: 4000,
  plotGap: 8,
  inspectDistance: 75,
  build(kit) {
    const { group, addBox, addMesh, addPrism, materials } = kit;
    const white = materials.whiteStone;
    const jali = kit.material(0xa9a69e, { roughness: 0.95 });
    const brick = materials.redBrick;
    const houseWall = kit.material(0xe8e4d8, { roughness: 0.9 });

    // ---- Nave ----------------------------------------------------------
    const naveLen = NAVE_NORTH - NAVE_SOUTH;
    const naveMid = (NAVE_NORTH + NAVE_SOUTH) / 2;
    addBox(group, [NAVE_HALF * 2, NAVE_TOP, naveLen], [0, NAVE_TOP / 2, naveMid], white);
    // The overhanging roof slab and its thin fascia.
    addBox(group, [NAVE_HALF * 2 + 2.6, 0.45, naveLen + 2.6], [0, NAVE_TOP + 0.22, naveMid], white);
    addBox(group, [NAVE_HALF * 2 + 2.2, 0.08, naveLen + 2.2], [0, NAVE_TOP + 0.48, naveMid], jali);
    // Jali clerestory: seven screens a side between plain piers, three on
    // each end wall.
    const JALI_BOTTOM = AISLE_TOP + 0.6;
    const JALI_H = NAVE_TOP - 0.8 - JALI_BOTTOM;
    const bays = 7;
    const bayLen = (naveLen - 4) / bays;
    for (let i = 0; i < bays; i++) {
      const z = NAVE_SOUTH + 2 + bayLen * (i + 0.5);
      for (const side of [-1, 1]) {
        addMesh(group, kit.rectPane(bayLen - 0.9, JALI_H), jali, [side * (NAVE_HALF + 0.06), JALI_BOTTOM, z], side * Math.PI / 2);
        addBox(group, [0.3, JALI_H + 0.4, 0.75], [side * (NAVE_HALF + 0.15), JALI_BOTTOM + JALI_H / 2, z - bayLen / 2], white);
      }
    }
    for (const end of [-1, 1]) {
      const z = end === 1 ? NAVE_NORTH + 0.06 : NAVE_SOUTH - 0.06;
      for (const x of [-4.4, 0, 4.4]) addMesh(group, kit.rectPane(3.6, JALI_H), jali, [x, JALI_BOTTOM, z], end === 1 ? 0 : Math.PI);
    }

    // ---- Aisles --------------------------------------------------------
    // East side: red-brick aisle north of the entrance, white porch south.
    // West side: a plain white aisle.
    const AISLE_HALF = 10;
    const ENTRANCE_N = -2;
    addBox(group, [AISLE_HALF - NAVE_HALF, AISLE_TOP, NAVE_NORTH - ENTRANCE_N], [-(NAVE_HALF + AISLE_HALF) / 2, AISLE_TOP / 2, (NAVE_NORTH + ENTRANCE_N) / 2], brick);
    addBox(group, [AISLE_HALF - NAVE_HALF, AISLE_TOP, ENTRANCE_N - NAVE_SOUTH], [-(NAVE_HALF + AISLE_HALF) / 2, AISLE_TOP / 2, (ENTRANCE_N + NAVE_SOUTH) / 2], white);
    addBox(group, [AISLE_HALF - NAVE_HALF, AISLE_TOP, naveLen], [(NAVE_HALF + AISLE_HALF) / 2, AISLE_TOP / 2, naveMid], white);
    // Aisle roofs as one flat white slab each side.
    for (const side of [-1, 1]) {
      addBox(group, [AISLE_HALF - NAVE_HALF + 0.6, 0.3, naveLen + 0.6], [side * (NAVE_HALF + AISLE_HALF + 0.6) / 2, AISLE_TOP + 0.15, naveMid], white);
    }
    // Brick-aisle windows and the dark entrance with its slab canopy.
    for (let z = ENTRANCE_N + 3; z < NAVE_NORTH - 1; z += 3.6) {
      addMesh(group, kit.rectPane(1.6, 2.2), materials.archDark, [-(AISLE_HALF + 0.06), 0.9, z], -Math.PI / 2);
    }
    addMesh(group, kit.rectPane(5, 2.8), materials.archDark, [-(AISLE_HALF + 0.06), 0, (ENTRANCE_N + NAVE_SOUTH) / 2 + 2], -Math.PI / 2);
    addBox(group, [4.2, 0.28, 10], [-(AISLE_HALF + 2.1), 3.5, (ENTRANCE_N + NAVE_SOUTH) / 2], white);
    for (const z of [-13, -4]) addBox(group, [0.3, 3.4, 0.3], [-(AISLE_HALF + 3.9), 1.7, z], white);

    // ---- Low south wing --------------------------------------------------
    addBox(group, [AISLE_HALF * 2, 4.4, 11], [0, 2.2, -20.5], white);
    addBox(group, [AISLE_HALF * 2 + 0.6, 0.3, 11.6], [0, 4.55, -20.5], white);
    for (const side of [-1, 1]) addBox(group, [0.08, 0.9, 9.6], [side * (AISLE_HALF + 0.04), 2.6, -20.5], materials.archDark);
    addBox(group, [18.4, 0.9, 0.08], [0, 2.6, -26.04], materials.archDark);

    // ---- The cross on its post at the north-east corner -------------------
    const CX = -13;
    const CZ = 23.5;
    addBox(group, [0.5, 9.4, 0.5], [CX, 4.7, CZ], white);
    addBox(group, [3.2, 0.5, 0.5], [CX, 7.3, CZ], white);

    // Forecourt and paths on the east side.
    addBox(group, [9, 0.08, 46], [-14.5, 0.04, 3], materials.yardPaving);

    // ---- Archbishop's House (way 376322211), two arcaded storeys ----------
    const house: PlanPoint[] = ([
      [19.2, -12.8], [28.6, -12.8], [28.6, -14.1], [39.0, -14.0], [39.0, -9.4], [47.3, -9.4], [47.4, -14.1],
      [60.7, -14.1], [60.7, -12.5], [66.9, -12.5], [67.0, -37.9], [60.9, -38.0], [60.9, -26.5], [24.4, -26.7],
      [24.5, -38.2], [19.4, -38.2],
    ] as PlanPoint[]).map(([e, n]) => [-e, n]);
    addPrism(group, house, 0, HOUSE_TOP, houseWall);
    addPrism(group, kit.offsetPolygon(house, -0.5), HOUSE_TOP, 0.1, jali);
    addPrism(group, house, 4.5, 0.25, white);
    addPrism(group, house, HOUSE_TOP, 0.55, white);
    kit.addBays(group, kit.wallEdges(house), {
      bay: 4.0,
      minEdge: 9,
      margin: 1.2,
      opening: materials.archDark,
      storeys: [
        { y: 0.5, opening: kit.roundArch(2.5, 3.3) },
        { y: 5.15, opening: kit.roundArch(2.3, 3.0) },
      ],
    });

    // ---- The green compound: the lawn south of the house (OSM grass way
    // 297639839), the royal palm by the porch, trees along the east side ---
    const lawn: PlanPoint[] = ([[-14.0, -36.9], [62.4, -44.1], [59.3, -77.2], [-17.2, -70.0]] as PlanPoint[]).map(([e, n]) => [-e, n]);
    addPrism(group, lawn, 0.02, 0.08, materials.lawn);
    kit.addPalm(group, -17.5, -15, 14, 0.04, 0.6);
    kit.addPalm(group, -18.5, 12, 12, 0.07, 2.1);
    for (const [x, z, r] of [[-13.5, 7, 3.6], [-13.8, 17, 3.8], [-20, -55, 4.6], [-38, -62, 5], [-55, -52, 4.4], [6, -58, 4.2]]) {
      kit.addTree(group, x, z, r, 5.2);
    }

    // ---- Colliders, clearing ----------------------------------------------
    kit.setBoundsCollider(false);
    kit.solidBox(0, naveMid, NAVE_HALF + 1.3, naveLen / 2 + 1.3, NAVE_TOP + 0.5);
    kit.solidBox(0, naveMid, AISLE_HALF, naveLen / 2, AISLE_TOP + 0.3);
    kit.solidBox(0, -20.5, AISLE_HALF, 5.5, 4.7);
    kit.solid(CX, CZ, 0.6, 9.4);
    kit.solidBox(-42.7, -19.7, 23.8, 6.9, HOUSE_TOP + 0.6);
    kit.solidBox(-22, -32.4, 2.7, 6, HOUSE_TOP + 0.6);
    kit.solidBox(-64, -32.2, 3.1, 6, HOUSE_TOP + 0.6);
    kit.clearSite(-14.5, 3, 4.5, 23);
    kit.clearSite(-22.6, -57, 40, 20);
  },
};

export default landmark;
