// BSMMU (Bangabandhu Sheikh Mujib Medical University) — "PG Hospital", Shahbagh
//
// The teaching hospital on the north-west corner of the Shahbagh crossing.
// What everyone knows is the long cream block on Shahbagh Road whose rounded
// end faces the crossing: eight storeys of close vertical fins and floor
// bands, a green bank fascia round the first floor, the university's name
// board on the roof of the curve and red "BSMMU" letters beside it. Behind it
// the older ward blocks, an E-plan block and the taller emergency
// and ward towers stand round the hospital courts.
//
// Footprints are OSM ways, in the bundled snapshot's world metres:
//   296798802 "BSMMU Block D" (7 levels; the photos show 8) — the curved block
//   296798727 (11 levels) and 296799763 "PG Emergency" (13 levels) — towers
//   296798873, 296798100, 296799236 — ward blocks, no levels tagged
//   296798222 (8 levels, unnamed) — the E-plan block south of the court
// Only the curved block is shown in the references (Commons: "Bangabandhu
// Sheikh Mujib Medical University from afar", "… from afar 3", "… Hospital in
// 2022.03", "Shahbag PG Hospital by Ragib Hasan"), so the others are plain
// masses on their OSM plans; where OSM has no level count the height is an
// assumption (five or six storeys).
//
// The game draws Shahbagh Road's north carriageway (snapshot way 691209732,
// a trunk road) 17 m wide on a centreline only 2–3 m from the curved block's
// surveyed south wall, so that wall is drawn 7.2 m north of its place, and
// the north wall 6 m north, to keep the block off the asphalt; the PG
// Emergency tower's south wall is likewise cut back 4 m. Blocks north of
// 23.7393 (the outdoor and super-specialised buildings) are left to the
// generic city.
//
// Local +Z looks south to Shahbagh Road; +X runs east to the crossing.
import { headingFromBearing, type LandmarkModule, type PlanPoint } from "./kit";

const STOREY = 3.6;
const BLOCK_D_STOREYS = 8;
const BLOCK_D_TOP = BLOCK_D_STOREYS * STOREY + 1.4;

// Way 296798802, moved clear of the road as described above. The first edge
// is the north wall, the last the west end; edges 1–8 are the rounded end.
const BLOCK_D: PlanPoint[] = [
  [-2258.7, 3646.0], [-2134.1, 3647.8], [-2136.0, 3653.0], [-2137.3, 3656.2], [-2139.3, 3659.0], [-2140.8, 3660.9],
  [-2144.1, 3664.2], [-2149.3, 3668.5], [-2154.5, 3671.1], [-2160.2, 3671.9], [-2259.4, 3655.3],
];
// Way 296798222, the E-plan block.
const OLD_HOTEL: PlanPoint[] = [
  [-2162.3, 3609.9], [-2162.4, 3624.5], [-2149.9, 3624.6], [-2149.8, 3609.6], [-2112.5, 3609.8], [-2112.4, 3597.1],
  [-2149.3, 3596.9], [-2149.2, 3569.1], [-2112.8, 3569.3], [-2112.7, 3557.6], [-2168.7, 3557.3], [-2168.8, 3569.2],
  [-2161.6, 3569.2], [-2161.7, 3597.3], [-2222.3, 3597.0], [-2222.4, 3609.6],
];

type Rect = { x: number; z: number; sx: number; sz: number };

const landmark: LandmarkModule = {
  key: "bsmmu",
  label: "BSMMU (PG Hospital)",
  labelBn: "বিএসএমএমইউ (পিজি হাসপাতাল)",
  shortLabel: "PGH",
  lat: 23.738752,
  lon: 90.394591,
  altitude: 50,
  heading: headingFromBearing(180),
  clearingRadius: 120,
  extents: [120, 63],
  replacesOsmBuildingIds: [296798802, 296799763],
  triangleBudget: 6000,
  plotGap: 8,
  build(kit) {
    const { group, addBox, addPrism, addOnWall, rectPane, materials } = kit;
    const cream = kit.material(0xe8dfc4, { roughness: 0.86 });
    const paleWall = kit.material(0xdcd8cb, { roughness: 0.88 });
    const hotelWall = kit.material(0xe3d6b0, { roughness: 0.88 });
    const bankGreen = kit.litMaterial(0x1f7d50, 0.4, 0x9dffc8);
    const signRed = kit.litMaterial(0xb8322c, 0.5, 0xff7060);
    const glass = materials.darkGlass;

    const rect = (ax: number, az: number, bx: number, bz: number): Rect => {
      const [x0, z0] = kit.worldToLocal(ax, az);
      const [x1, z1] = kit.worldToLocal(bx, bz);
      return { x: (x0 + x1) / 2, z: (z0 + z1) / 2, sx: Math.abs(x1 - x0), sz: Math.abs(z1 - z0) };
    };

    // A plain ward block: ribbon windows on every floor between corner piers
    // and a pier every few metres along the long sides.
    const block = (r: Rect, storeys: number, material: typeof cream, stairHead = true) => {
      const top = storeys * STOREY + 0.9;
      addBox(group, [r.sx, top, r.sz], [r.x, top / 2, r.z], material);
      for (let storey = 0; storey < storeys; storey++) {
        addBox(group, [r.sx + 0.16, 1.7, r.sz + 0.16], [r.x, storey * STOREY + 2, r.z], glass);
      }
      for (const cx of [-1, 1]) {
        for (const cz of [-1, 1]) {
          addBox(group, [1.6, top, 1.6], [r.x + cx * (r.sx / 2 - 0.6), top / 2, r.z + cz * (r.sz / 2 - 0.6)], material);
        }
      }
      const alongX = r.sx >= r.sz;
      const span = alongX ? r.sx : r.sz;
      const bays = Math.max(2, Math.round(span / 6.5));
      for (let bay = 1; bay < bays; bay++) {
        const along = -span / 2 + (bay * span) / bays;
        for (const side of [-1, 1]) {
          if (alongX) addBox(group, [0.6, top, 0.5], [r.x + along, top / 2, r.z + side * (r.sz / 2 + 0.05)], material);
          else addBox(group, [0.5, top, 0.6], [r.x + side * (r.sx / 2 + 0.05), top / 2, r.z + along], material);
        }
      }
      addBox(group, [r.sx - 1.4, 0.16, r.sz - 1.4], [r.x, top + 0.08, r.z], materials.roofGrey);
      if (stairHead) addBox(group, [5.5, 3, 4.5], [r.x + r.sx / 4, top + 1.5, r.z], material);
      kit.solidBox(r.x, r.z, r.sx / 2, r.sz / 2, top);
      return top;
    };

    // ── The curved block on Shahbagh Road ──────────────────────────────────
    const blockD = BLOCK_D.map(([x, z]) => kit.worldToLocal(x, z));
    const edgesD = kit.wallEdges(blockD);
    addPrism(group, blockD, 0, BLOCK_D_TOP - 0.6, cream);
    addPrism(group, kit.offsetPolygon(blockD, 0.1), 4.4, BLOCK_D_STOREYS * STOREY - 4.6, glass);
    for (let floor = 1; floor <= BLOCK_D_STOREYS; floor++) {
      addPrism(group, kit.offsetPolygon(blockD, 0.5), floor * STOREY - 0.6, 1.25, cream);
    }
    // The projecting roof slab and a grey roof.
    addPrism(group, kit.offsetPolygon(blockD, 1.3), BLOCK_D_TOP - 0.6, 0.6, cream);
    addPrism(group, kit.offsetPolygon(blockD, -0.8), BLOCK_D_TOP, 0.12, materials.roofGrey);
    kit.addBays(group, edgesD, {
      bay: 3.6,
      storeys: [],
      opening: glass,
      minEdge: 2,
      margin: 0.3,
      pier: { width: 0.85, depth: 1.1, bottom: STOREY, top: BLOCK_D_TOP - 0.6, material: cream },
    });
    // Ground storey shopfronts and the bank's green fascia round the curve.
    edgesD.forEach((edge, index) => {
      if (edge.length > 20) addOnWall(group, edge, edge.length / 2, 0.5, rectPane(edge.length - 3, 2.6), glass, 0.12);
      if (index >= 1 && index <= 8) addOnWall(group, edge, edge.length / 2, STOREY - 0.2, rectPane(edge.length + 0.4, 1.5), bankGreen, 1.25);
    });
    // The name board on the roof of the curve, facing the crossing, and the
    // red letters on the parapet beside it.
    const [boardX, boardZ] = kit.worldToLocal(-2147.5, 3661.9);
    const board = addBox(group, [17, 2.6, 0.4], [boardX, BLOCK_D_TOP + 1.9, boardZ], materials.whiteStone);
    board.rotation.y = 0.82;
    const boardBase = addBox(group, [17, 0.6, 0.5], [boardX, BLOCK_D_TOP + 0.3, boardZ], bankGreen);
    boardBase.rotation.y = 0.82;
    const [lettersX, lettersZ] = kit.worldToLocal(-2170, 3669.5);
    const letters = addBox(group, [10, 1.9, 0.35], [lettersX, BLOCK_D_TOP + 1, lettersZ], signRed);
    letters.rotation.y = -0.171;
    // The block as boxes inscribed in 8 m strips of its plan, so no solid
    // stands out over the road or the crossing past the diagonal south wall
    // and the rounded end.
    const span = (x: number) => {
      const hits: number[] = [];
      blockD.forEach(([ax, az], index) => {
        const [bx, bz] = blockD[(index + 1) % blockD.length];
        if ((ax - x) * (bx - x) < 0) hits.push(az + ((x - ax) / (bx - ax)) * (bz - az));
      });
      return hits.length >= 2 ? [Math.min(...hits), Math.max(...hits)] : null;
    };
    const xs = blockD.map(([x]) => x);
    const west = Math.min(...xs) + 0.2;
    const east = Math.max(...xs) - 0.2;
    for (let x0 = west; x0 < east - 0.5; x0 += 8) {
      const x1 = Math.min(east, x0 + 8);
      let north = -Infinity;
      let south = Infinity;
      for (let step = 0; step <= 4; step++) {
        const z = span(x0 + ((x1 - x0) * step) / 4);
        if (!z) continue;
        north = Math.max(north, z[0]);
        south = Math.min(south, z[1]);
      }
      if (south - north > 1) kit.solidBox((x0 + x1) / 2, (north + south) / 2, (x1 - x0) / 2, (south - north) / 2, BLOCK_D_TOP);
    }

    // ── The towers and ward blocks behind ───────────────────────────────────
    block(rect(-2299.1, 3615.3, -2258.0, 3642.7), 11, paleWall);
    block(rect(-2344.6, 3608.8, -2313.8, 3641), 13, paleWall);
    block(rect(-2257.3, 3612.2, -2221.0, 3629.8), 6, cream);
    block(rect(-2278.9, 3578.4, -2238.8, 3603.1), 6, cream);
    block(rect(-2297.1, 3575.8, -2278.9, 3604.9), 6, cream, false);
    block(rect(-2195.2, 3558.9, -2171.4, 3580.1), 5, paleWall);

    // The E-plan block, eight storeys as OSM tags it.
    const hotel = OLD_HOTEL.map(([x, z]) => kit.worldToLocal(x, z));
    const HOTEL_STOREYS = 8;
    const hotelTop = HOTEL_STOREYS * STOREY + 0.9;
    addPrism(group, hotel, 0, hotelTop, hotelWall);
    for (let storey = 0; storey < HOTEL_STOREYS; storey++) {
      addPrism(group, kit.offsetPolygon(hotel, 0.1), storey * STOREY + 1.2, 1.7, glass);
    }
    kit.addBays(group, kit.wallEdges(hotel), {
      bay: 6.2,
      storeys: [],
      opening: glass,
      minEdge: 10,
      margin: 0.2,
      pier: { width: 0.9, depth: 0.5, bottom: 0, top: hotelTop, material: hotelWall },
    });
    addPrism(group, kit.offsetPolygon(hotel, -0.7), hotelTop, 0.14, materials.roofGrey);
    const hotelSolid = (ax: number, az: number, bx: number, bz: number) => {
      const r = rect(ax, az, bx, bz);
      kit.solidBox(r.x, r.z, r.sx / 2, r.sz / 2, hotelTop);
    };
    hotelSolid(-2222.4, 3597, -2112.4, 3609.8);
    hotelSolid(-2162.4, 3609.8, -2149.8, 3624.6);
    hotelSolid(-2161.7, 3569.1, -2149.2, 3597);
    hotelSolid(-2168.8, 3557.3, -2112.7, 3569.3);

    // ── The court between the E-plan block and the curved block ─────────────
    const court = rect(-2218, 3612, -2116, 3646);
    addBox(group, [court.sx, 0.08, court.sz], [court.x, 0.04, court.z], materials.yardPaving);
    const garden = rect(-2212, 3630, -2168, 3643);
    addBox(group, [garden.sx, 0.14, garden.sz], [garden.x, 0.07, garden.z], materials.lawn);
    for (const along of [-0.36, 0, 0.36]) kit.addTree(group, garden.x + along * garden.sx, garden.z, 4.2, 5.5);
    const yard = rect(-2300, 3557, -2112, 3647);
    kit.clearSite(yard.x, yard.z, yard.sx / 2, yard.sz / 2);

    kit.setBoundsCollider(false);
  },
};

export default landmark;
