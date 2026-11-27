// Old High Court Building
//
// Built in 1905 as the Governor's residence of the short-lived province of
// Eastern Bengal and Assam, later the Dhaka High Court: a brilliant white
// two-storey renaissance block round a courtyard. The south front has a
// two-storey portico — a carriage porch below, Corinthian columns carrying a
// triangular pediment above — and behind it a ring of columns on a square
// base carries the tall dome. Arched windows run round the upper floor, the
// corner bays and the two rear pavilions end in segmental pediments, and the
// plinth is painted black.
//
// Plan from OSM relation 3224556 (outer way 239079241, court 239079246): the
// front block is 48.5 × 20 m, the side ranges and rear range close a
// 36 × 36 m court, and two-storey colonnades link the rear range to a
// pavilion on either side (121 m across in all). Its walls run 59.8°/149.8°;
// the portico faces 149.8° (SSE) toward Curzon Hall. Heights are read off the
// photographs against the 48.5 m front. The dome is placed over the entrance
// hall in the middle of the front block (OSM does not map it).
//
// Local +Z is the portico front; +X runs ENE toward the High Court mazar.
import { headingFromBearing, type LandmarkModule, type PlanPoint } from "./kit";

const FIRST_FLOOR = 6.2;
const EAVE = 12.4;
const PARAPET = 13.5;
const DOME_Z = 2.6;

// The outer wall line, clockwise from the west pavilion (OSM, squared up).
const OUTLINE: PlanPoint[] = [
  [-61.2, -36.8], [-61.2, -51.5], [-43.7, -51.5], [-43.7, -47.2], [-26.3, -47.2], [-26.3, -63], [23.1, -63],
  [23.1, -46.8], [42.1, -46.8], [42.1, -51.2], [59.5, -51.2], [59.5, -35.5], [42.1, -35.5], [42.1, -40.4],
  [23.3, -40.4], [23.3, -7.5], [24.4, -7.5], [24.4, 12.8], [8.25, 12.8], [8.25, 17.6], [-8.25, 17.6],
  [-8.25, 12.8], [-24.1, 12.8], [-24.1, -7.3], [-24.2, -7.3], [-24.2, -40], [-44.9, -40], [-44.9, -36.8],
];

type Rect = [number, number, number, number];
// [x0, x1, z0, z1] of each two-storey mass.
const FRONT_BLOCK: Rect = [-24.1, 24.4, -7.5, 12.8];
const WEST_PAVILION: Rect = [-61.2, -43.7, -51.5, -36.8];
const EAST_PAVILION: Rect = [42.1, 59.5, -51.2, -35.5];
const MASSES: Rect[] = [
  FRONT_BLOCK,
  [-24.2, -19.4, -42.8, -7.5], // west range
  [17, 23.3, -42.8, -7.5], // east range
  [-26.3, 23.1, -63, -42.8], // rear range
  [-7.4, 3, -13.3, -7.5], // stair hall into the court
  WEST_PAVILION,
  EAST_PAVILION,
];
// The colonnaded links to the pavilions.
const LINKS: Rect[] = [
  [-43.7, -24.2, -47.2, -40],
  [23.3, 42.1, -46.8, -40.4],
];

const HEADING = headingFromBearing(149.8);
// World box [x0, x1, z0, z1] of the High Court mazar (snapshot way 297589572),
// whose compound comes within 4 m of the east pavilion. A snapshot building
// is dropped when its world box comes within 2 m of a collider's, so the
// pavilion's colliders are kept just clear of it.
const MAZAR_BOX: Rect = [-1413.64, -1354.02, 4594.61, 4636.4];

const landmark: LandmarkModule = {
  key: "old-high-court",
  label: "Old High Court Building",
  labelBn: "পুরাতন হাইকোর্ট ভবন",
  shortLabel: "OHC",
  lat: 23.729339,
  lon: 90.402328,
  altitude: 29,
  heading: HEADING,
  clearingRadius: 70,
  extents: [25, 38],
  replacesOsmBuildingIds: [1000322455600],
  triangleBudget: 4000,
  plotGap: 8,
  build(kit) {
    const { group, addBox, addCylinder, addCone, addLathe, addMesh, addQuads, materials } = kit;
    const white = materials.whiteStone;
    const dark = materials.archDark;
    const plinth = kit.material(0x2a2a2e, { roughness: 0.9 });
    const roof = materials.roofGrey;
    // The weathered dome reads grey against the white walls.
    const domeGrey = roof;

    // A tiled clearing: one big turned rectangle would sweep the neighbours
    // (the mazar stands 25 m east of the east range) out with its world box.
    const clearTiles = (x0: number, x1: number, z0: number, z1: number, cell = 8) => {
      const columns = Math.max(1, Math.ceil((x1 - x0) / cell));
      const rows = Math.max(1, Math.ceil((z1 - z0) / cell));
      const halfX = (x1 - x0) / columns / 2;
      const halfZ = (z1 - z0) / rows / 2;
      for (let column = 0; column < columns; column++) {
        for (let row = 0; row < rows; row++) {
          kit.clearSite(x0 + (column * 2 + 1) * halfX, z0 + (row * 2 + 1) * halfZ, halfX, halfZ);
        }
      }
    };

    // Small solid tiles over a rectangle, leaving out any whose world box
    // would reach the mazar's.
    const cosH = Math.cos(HEADING);
    const sinH = Math.sin(HEADING);
    const [originX, originZ] = kit.worldToLocal(0, 0);
    const worldX = -(originX * cosH + originZ * sinH);
    const worldZ = originX * sinH - originZ * cosH;
    const solidTilesClearOfMazar = ([x0, x1, z0, z1]: Rect, top: number, cell = 3) => {
      const columns = Math.max(1, Math.ceil((x1 - x0) / cell));
      const rows = Math.max(1, Math.ceil((z1 - z0) / cell));
      const halfX = (x1 - x0) / columns / 2;
      const halfZ = (z1 - z0) / rows / 2;
      const halfWidth = Math.abs(cosH) * halfX + Math.abs(sinH) * halfZ + 2.3;
      const halfDepth = Math.abs(sinH) * halfX + Math.abs(cosH) * halfZ + 2.3;
      for (let column = 0; column < columns; column++) {
        for (let row = 0; row < rows; row++) {
          const x = x0 + (column * 2 + 1) * halfX;
          const z = z0 + (row * 2 + 1) * halfZ;
          const wx = worldX + x * cosH + z * sinH;
          const wz = worldZ - x * sinH + z * cosH;
          const reaches = wx + halfWidth > MAZAR_BOX[0] && wx - halfWidth < MAZAR_BOX[1] && wz + halfDepth > MAZAR_BOX[2] && wz - halfDepth < MAZAR_BOX[3];
          if (!reaches) kit.solidBox(x, z, halfX, halfZ, top);
        }
      }
    };

    // A two-storey mass: black plinth, white walls up to the parapet, a
    // projecting cornice at the eave and the grey roof inside the parapet.
    const mass = ([x0, x1, z0, z1]: Rect, top = PARAPET) => {
      const cx = (x0 + x1) / 2;
      const cz = (z0 + z1) / 2;
      const sx = x1 - x0;
      const sz = z1 - z0;
      addBox(group, [sx, top, sz], [cx, top / 2, cz], white);
      addBox(group, [sx + 0.3, 1.1, sz + 0.3], [cx, 0.55, cz], plinth);
      addBox(group, [sx + 1, 0.45, sz + 1], [cx, EAVE - 0.2, cz], white);
      addBox(group, [sx - 1.4, 0.12, sz - 1.4], [cx, top + 0.02, cz], roof);
      if (x1 > 40) solidTilesClearOfMazar([x0, x1, z0, z1], top);
      else kit.solidTiles(x0, x1, z0, z1, top, 8);
    };
    for (const rect of MASSES) mass(rect);
    for (const rect of LINKS) mass(rect, EAVE + 0.5);

    // Windows: a square-headed row below, the tall arched row above, on every
    // outer wall but the links and the portico (drawn below).
    const walls = kit.wallEdges(OUTLINE).filter((edge) => {
      const mx = edge.ax + (edge.dx * edge.length) / 2;
      const mz = edge.az + (edge.dz * edge.length) / 2;
      const link = Math.abs(edge.dz) < 0.1 && Math.abs(mx) > 24 && Math.abs(mx) < 44;
      return !link && mz < 12.9;
    });
    kit.addBays(group, walls, {
      bay: 5.6,
      margin: 1.4,
      minEdge: 6,
      opening: dark,
      storeys: [
        { y: 1.9, opening: kit.rectPane(1.7, 2.9) },
        { y: FIRST_FLOOR + 1.2, opening: kit.roundArch(1.9, 3.7) },
      ],
    });
    // A string course at the first floor of the front block.
    addBox(group, [48.9, 0.35, 20.5], [0.15, FIRST_FLOOR, 2.65], white);

    // The links: a dark verandah on each floor behind white piers.
    for (const [x0, x1, z0, z1] of LINKS) {
      const length = x1 - x0;
      const cx = (x0 + x1) / 2;
      const faces: Array<[number, number]> = [[z1 + 0.12, 0], [z0 - 0.12, Math.PI]];
      for (const [z, turn] of faces) {
        addMesh(group, kit.rectPane(length - 1, 3.9), dark, [cx, 1.6, z], turn);
        addMesh(group, kit.rectPane(length - 1, 4.2), dark, [cx, FIRST_FLOOR + 0.9, z], turn);
      }
      for (let index = 1; index < 5; index++) {
        const x = x0 + (length * index) / 5;
        addBox(group, [0.6, EAVE, z1 - z0 + 0.5], [x, EAVE / 2, (z0 + z1) / 2], white);
      }
    }

    // A segmental pediment: half a flattened drum lying on the parapet.
    const segmental = (x: number, z: number, width: number, depth: number, y: number) => {
      const geometry = new kit.THREE.CylinderGeometry(width / 2, width / 2, depth, 8, 1, false, Math.PI / 2, Math.PI);
      const mesh = addMesh(group, geometry, white, [x, y, z]);
      mesh.rotation.x = Math.PI / 2;
      mesh.scale.set(1, 1, 0.5);
    };
    const finial = (x: number, z: number, y: number) => {
      addBox(group, [1.1, 1.2, 1.1], [x, y + 0.6, z], white);
      addCone(group, 0.5, 2.2, [x, y + 2.3, z], white, 6);
    };

    // The front block's end bays: a shallow projection under a segmental
    // pediment, with an urn finial on the outer corners.
    for (const side of [-1, 1]) {
      const x = side * 20.4 + 0.15;
      addBox(group, [7.4, PARAPET, 0.7], [x, PARAPET / 2, 13.1], white);
      addBox(group, [7.7, 1.1, 0.9], [x, 0.55, 13.1], plinth);
      addMesh(group, kit.roundArch(2.4, 4.4), dark, [x, FIRST_FLOOR + 1, 13.55]);
      addMesh(group, kit.rectPane(2, 3), dark, [x, 1.9, 13.55]);
      segmental(x, 12.6, 7.4, 1.8, PARAPET);
      finial(side * 23.6 + 0.15, 12, PARAPET);
      finial(side * 23.6 + 0.15, -6.7, PARAPET);
    }
    // The rear pavilions carry the same pediment on their south faces.
    for (const [x0, x1, , z1] of [WEST_PAVILION, EAST_PAVILION]) {
      segmental((x0 + x1) / 2, z1 - 0.9, 9, 1.8, PARAPET);
      finial(x0 + 0.8, z1 - 0.8, PARAPET);
      finial(x1 - 0.8, z1 - 0.8, PARAPET);
    }

    // The portico. Ground storey: a solid arcaded bay with the carriage porch
    // in front of it.
    addBox(group, [16.5, FIRST_FLOOR, 4.8], [0, FIRST_FLOOR / 2, 15.2], white);
    addBox(group, [16.8, 1.1, 5], [0, 0.55, 15.25], plinth);
    addBox(group, [17.1, 0.4, 5.3], [0, FIRST_FLOOR, 15.3], white);
    for (const side of [-1, 1]) addMesh(group, kit.roundArch(2.4, 4.3), dark, [side * 6.2, 1.2, 17.72]);
    addBox(group, [8.4, 5.4, 9.7], [0, 2.7, 22.45], white);
    addBox(group, [9, 0.4, 10.2], [0, 5.3, 22.6], white);
    addBox(group, [8.4, 0.9, 9.7], [0, 5.95, 22.45], white);
    addBox(group, [7.4, 0.1, 8.7], [0, 6.42, 22.45], roof);
    addMesh(group, kit.roundArch(4.6, 4.5), dark, [0, 0.3, 27.42]);
    for (const side of [-1, 1]) {
      for (const z of [20.1, 24.7]) addMesh(group, kit.roundArch(3, 4.3), dark, [side * 4.32, 0.3, z], (side * Math.PI) / 2);
    }
    // Upper storey: an open loggia of columns under the pediment.
    addMesh(group, kit.rectPane(15.4, 4.9), dark, [0, FIRST_FLOOR + 0.3, 12.95]);
    for (const x of [-7.5, -5.1, -1.6, 1.6, 5.1, 7.5]) {
      addBox(group, [1, 0.5, 1], [x, FIRST_FLOOR + 0.45, 16.9], white);
      addCylinder(group, 0.36, 0.42, 4.4, [x, FIRST_FLOOR + 2.9, 16.9], white, 6);
      addBox(group, [1.05, 0.5, 1.05], [x, FIRST_FLOOR + 5.2, 16.9], white);
    }
    addBox(group, [17, 1.2, 5.2], [0, FIRST_FLOOR + 6.05, 15.2], white);
    const PEDIMENT_BASE = FIRST_FLOOR + 6.65;
    const PEDIMENT_RISE = 3.3;
    const apex = PEDIMENT_BASE + PEDIMENT_RISE;
    addMesh(group, kit.trianglePane(17.6, PEDIMENT_RISE), white, [0, PEDIMENT_BASE, 17.95]);
    addMesh(group, kit.trianglePane(17.6, PEDIMENT_RISE), white, [0, PEDIMENT_BASE, 12.4], Math.PI);
    addQuads(group, [
      [[-8.8, PEDIMENT_BASE, 17.95], [0, apex, 17.95], [0, apex, 12.4], [-8.8, PEDIMENT_BASE, 12.4], [-1, 2, 0]],
      [[8.8, PEDIMENT_BASE, 17.95], [8.8, PEDIMENT_BASE, 12.4], [0, apex, 12.4], [0, apex, 17.95], [1, 2, 0]],
    ], white);

    // The dome: a square base on the roof, a ring of piers and columns round
    // a dark core, an entablature, the dome and its spire.
    const BASE_TOP = 16;
    const DRUM_TOP = 21.2;
    const drumMid = (BASE_TOP + DRUM_TOP) / 2;
    addBox(group, [10.4, BASE_TOP - PARAPET, 10.4], [0, (BASE_TOP + PARAPET) / 2, DOME_Z], white);
    addBox(group, [11.2, 0.4, 11.2], [0, BASE_TOP - 0.2, DOME_Z], white);
    addCylinder(group, 3.1, 3.1, DRUM_TOP - BASE_TOP, [0, drumMid, DOME_Z], dark, 12);
    addCylinder(group, 4.3, 4.3, 0.5, [0, BASE_TOP + 0.25, DOME_Z], white, 12);
    for (let index = 0; index < 4; index++) {
      const angle = (index * Math.PI) / 2 + Math.PI / 4;
      const pier = addBox(group, [2.5, DRUM_TOP - BASE_TOP, 1.1], [Math.sin(angle) * 3.3, drumMid, DOME_Z + Math.cos(angle) * 3.3], white);
      pier.rotation.y = angle;
      for (const offset of [-0.36, 0.36]) {
        const at = (index * Math.PI) / 2 + offset;
        addCylinder(group, 0.3, 0.34, DRUM_TOP - BASE_TOP, [Math.sin(at) * 3.65, drumMid, DOME_Z + Math.cos(at) * 3.65], white, 6);
      }
    }
    addCylinder(group, 4.45, 4.25, 1, [0, DRUM_TOP + 0.5, DOME_Z], white, 12);
    addLathe(group, kit.domeProfile(4.05, 4.3, 0, 7), 16, [0, DRUM_TOP + 1, DOME_Z], domeGrey);
    addCylinder(group, 0.45, 0.6, 0.8, [0, DRUM_TOP + 5.5, DOME_Z], domeGrey, 8);
    addCone(group, 0.3, 2.4, [0, DRUM_TOP + 7.1, DOME_Z], domeGrey, 6);
    kit.solid(0, DOME_Z, 5.4, DRUM_TOP + 5.5);
    kit.solidTiles(-8.25, 8.25, 12.8, 17.6, apex, 8);
    kit.solidBox(0, 22.45, 4.2, 4.85, 6.4);

    // The court lawn, and the forecourt: a paved drive round a brick-kerbed
    // oval lawn, as it lies in front of the portico today.
    addBox(group, [36, 0.1, 34.8], [-1.2, 0.07, -25.2], materials.lawn);
    addBox(group, [66, 0.08, 46], [0, 0.05, 37], materials.yardPaving);
    addCylinder(group, 13.4, 13.4, 0.16, [0, 0.1, 44], materials.plazaBrick, 12).scale.set(1.5, 1, 1);
    addCylinder(group, 12.8, 12.8, 0.2, [0, 0.12, 44], materials.lawn, 12).scale.set(1.5, 1, 1);
    const trees: Array<[number, number, number]> = [[-27, 22, 4.2], [27, 24, 4.6], [-29, 50, 5], [29, 52, 4.4], [-9, 44, 3.2], [10, 46, 3]];
    for (const [x, z, radius] of trees) kit.addTree(group, x, z, radius, 4.2);
    clearTiles(-33, 33, 13, 60);
    clearTiles(-19.4, 17, -42.8, -7.5);

    // Each mass carries its own collider (the building is turned 30° off the
    // world axes and has an open court); the bird perches on the dome.
    kit.setBoundsCollider(false);
    kit.setPerchTarget(0, DOME_Z);
  },
};

export default landmark;
