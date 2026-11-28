// Ruplal House
//
// The 19th-century riverside mansion of the Das brothers in Farashganj, on
// the Buckland Bund of the Buriganga. Two blocks in a row: the grand western
// (Ruplal) block, two tall storeys of arched openings between pilasters with
// three gabled pavilions on its river front, and E-shaped behind, where the
// middle arm ends in a portico of giant Corinthian columns under a
// triangular pediment; and, joined to it by a short link, the lower and
// plainer eastern (Raghunath) block with an open upper verandah.
//
// OpenStreetMap has no named footprint, only the node 4668159173 "Ruplal
// House" (23.7038752, 90.4134684; Wikipedia gives 23.70364, 90.41364). The
// node lies on a row of three unnamed building ways that match the house:
// 497324763 and 497324762 (together 52.6 m × 21.4 m, long axis 133.5°, the
// western block) and 497324760 (16.2 m × 19.3 m, in line to the south-east,
// the eastern block). The origin is the centre of the western pair and the
// river front faces 223.5°. The end arms reach 10.5 m behind the range, as
// in 497324763/62; the portico on the middle arm is from a 19th-century
// photograph of the city side (OSM traces only the roof behind it). The
// eastern block is set back as OSM has it, its front 9 m behind the main
// river front. None of the three is in the bundled snapshot. The 4:1 ratio
// of the two blocks matches the 1875 river photograph; heights are
// estimated from photographs.
//
// Local +Z is the river front; +X runs south-east along it.
import { headingFromBearing, type LandmarkModule } from "./kit";

const HALF_LENGTH = 26.3;
const FRONT = 10.7;
const RANGE_BACK = -1.3;
const TOP = 11.6;
const FLOOR = 5.9;
const END_ARM_BACK = -10.3;
const MID_ARM_BACK = -8.4;
const PORTICO_BACK = -10.9;
const EAST_X0 = 31.9;
const EAST_X1 = 48.2;
const EAST_FRONT = 1.8;
const EAST_BACK = -17.6;
const LINK_FRONT = 1.2;
const LINK_BACK = -6;
const EAST_TOP = 9.4;

const landmark: LandmarkModule = {
  key: "ruplal-house",
  label: "Ruplal House",
  labelBn: "রূপলাল হাউস",
  shortLabel: "RLH",
  lat: 23.703784,
  lon: 90.413537,
  altitude: 15,
  heading: headingFromBearing(223.5),
  clearingRadius: 40,
  extents: [48, 12],
  triangleBudget: 4000,
  plotGap: 4,
  build(kit) {
    const { group, addBox, addCylinder, addMesh, rectPane, materials } = kit;
    // Soot- and damp-greyed plaster, as the house stands today (Commons
    // "Ruplal House, Farashganj, Dhaka.jpg"), not fresh cream.
    const wall = kit.material(0x857d6e, { roughness: 0.96 });
    const trim = kit.material(0x9d9583, { roughness: 0.94 });
    const eastWall = kit.material(0x787061, { roughness: 0.97 });
    // The weathered plinth shares the eastern block's darker plaster.
    const stain = eastWall;
    const shutter = kit.material(0x6a6557, { roughness: 0.9 });
    const dark = materials.archDark;
    const roof = materials.roofTerrace;

    // A round-headed opening with a coarse arc: there are over a hundred.
    const roundArch = (width: number, height: number) => {
      const half = width / 2;
      const shape = new kit.THREE.Shape();
      shape.moveTo(-half, 0);
      shape.lineTo(half, 0);
      shape.lineTo(half, height - half);
      shape.absarc(0, height - half, half, 0, Math.PI, false);
      shape.lineTo(-half, 0);
      return new kit.THREE.ShapeGeometry(shape, 3);
    };
    // An upright triangular gable, `depth` thick, facing `turn`.
    const gable = (x: number, y: number, z: number, width: number, height: number, depth: number, turn: number) => {
      const shape = new kit.THREE.Shape();
      shape.moveTo(-width / 2, 0);
      shape.lineTo(width / 2, 0);
      shape.lineTo(0, height);
      shape.lineTo(-width / 2, 0);
      addMesh(group, new kit.THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: false }), trim, [x, y, z], turn);
    };
    // A block: stained plinth, wall, string course, cornice and parapet.
    const block = (x0: number, x1: number, z0: number, z1: number, top: number, material: typeof wall, floor = FLOOR) => {
      const sx = x1 - x0;
      const sz = z1 - z0;
      const cx = (x0 + x1) / 2;
      const cz = (z0 + z1) / 2;
      addBox(group, [sx, top - 1.1, sz], [cx, (top - 1.1) / 2, cz], material);
      addBox(group, [sx + 0.2, 0.9, sz + 0.2], [cx, 0.45, cz], stain);
      addBox(group, [sx + 0.3, 0.3, sz + 0.3], [cx, floor, cz], trim);
      addBox(group, [sx + 0.9, 0.35, sz + 0.9], [cx, top - 1.0, cz], trim);
      addBox(group, [sx, 0.75, sz], [cx, top - 0.45, cz], material);
      addBox(group, [sx - 0.7, 0.1, sz - 0.7], [cx, top - 0.2, cz], roof);
    };
    // One bay of openings on a wall facing `turn`: an arch below and a
    // shuttered arched window above.
    const bay = (x: number, z: number, turn: number, width = 1.7) => {
      const nx = Math.sin(turn);
      const nz = Math.cos(turn);
      const at = (proud: number, y: number): [number, number, number] => [x + nx * proud, y, z + nz * proud];
      addMesh(group, roundArch(width + 0.5, 4.1), trim, at(0.06, 0.9), turn);
      addMesh(group, roundArch(width, 3.8), dark, at(0.12, 0.9), turn);
      addMesh(group, roundArch(width + 0.5, 3.9), trim, at(0.06, FLOOR + 0.5), turn);
      addMesh(group, roundArch(width, 3.6), dark, at(0.12, FLOOR + 0.6), turn);
      addMesh(group, rectPane(width, 2.2), shutter, at(0.18, FLOOR + 0.6), turn);
    };
    // A giant pilaster up both storeys.
    const pilaster = (x: number, z: number) => {
      addBox(group, [0.8, TOP - 2.2, 0.8], [x, (TOP - 2.2) / 2 + 0.9, z], trim);
      addBox(group, [1.1, 0.5, 1.1], [x, TOP - 1.45, z], trim);
    };

    // Embankment forecourt on the river side, the yard in front of the
    // set-back eastern block, and the entrance court behind.
    const yard = materials.yardPaving;
    addBox(group, [EAST_X1 + HALF_LENGTH + 6, 0.1, 7], [(EAST_X1 - HALF_LENGTH) / 2, 0.05, FRONT + 3.2], yard);
    addBox(group, [EAST_X1 - HALF_LENGTH + 1, 0.08, FRONT - EAST_FRONT + 0.2], [(EAST_X1 + HALF_LENGTH + 1) / 2, 0.04, (FRONT + EAST_FRONT) / 2], yard);
    addBox(group, [HALF_LENGTH * 2, 0.1, 15], [0, 0.05, RANGE_BACK - 7.5], yard);

    // ---- Western (Ruplal) block ----
    block(-HALF_LENGTH, HALF_LENGTH, RANGE_BACK, FRONT, TOP, wall);
    block(-HALF_LENGTH, -HALF_LENGTH + 9, END_ARM_BACK, RANGE_BACK + 0.2, TOP, wall);
    block(HALF_LENGTH - 9, HALF_LENGTH, END_ARM_BACK, RANGE_BACK + 0.2, TOP, wall);
    block(-7, 7, MID_ARM_BACK, RANGE_BACK + 0.2, TOP, wall);

    // River front: three pavilions standing forward under scrolled gables
    // with urns, and arcaded bays between them.
    const pavilions: Array<[number, number]> = [[-21.6, 9.4], [0, 9], [21.6, 9.4]];
    for (const [px, width] of pavilions) {
      addBox(group, [width, TOP - 1.1, 0.9], [px, (TOP - 1.1) / 2, FRONT + 0.45], wall);
      addBox(group, [width + 0.3, 0.3, 1.1], [px, FLOOR, FRONT + 0.5], trim);
      addBox(group, [width + 0.9, 0.35, 1.6], [px, TOP - 1.0, FRONT + 0.6], trim);
      addBox(group, [width, 0.75, 0.9], [px, TOP - 0.45, FRONT + 0.45], wall);
      gable(px, TOP - 0.1, FRONT + 0.3, 5.4, 2.1, 0.5, 0);
      for (const side of [-1, 1]) {
        pilaster(px + side * (width / 2 - 0.4), FRONT + 0.95);
        addCylinder(group, 0.22, 0.34, 1.0, [px + side * (width / 2 - 0.5), TOP + 0.4, FRONT + 0.5], trim, 6);
      }
      for (const dx of [-2.3, 0, 2.3]) bay(px + dx, FRONT + 0.9, 0, dx === 0 ? 1.9 : 1.5);
    }
    for (const side of [-1, 1]) {
      for (let i = 0; i < 4; i++) bay(side * (6.5 + i * 2.95), FRONT, 0);
      // End walls.
      for (const z of [3.9, 7.6]) bay(side * HALF_LENGTH, z, side * Math.PI / 2);
    }

    // City side: the courts between the arms, and the portico.
    for (const side of [-1, 1]) {
      for (let i = 0; i < 3; i++) bay(side * (9.6 + i * 2.9), RANGE_BACK, Math.PI);
      for (const dx of [-2.3, 2.3]) bay(side * (HALF_LENGTH - 4.5) + dx, END_ARM_BACK, Math.PI);
      pilaster(side * (HALF_LENGTH - 8.8), END_ARM_BACK - 0.05);
      pilaster(side * (HALF_LENGTH - 0.2), END_ARM_BACK - 0.05);
    }
    const PLINTH = 1.0;
    addBox(group, [15, PLINTH, 3.4], [0, PLINTH / 2, (MID_ARM_BACK + PORTICO_BACK) / 2 - 0.4], trim);
    addBox(group, [9, 0.5, 1.6], [0, 0.25, PORTICO_BACK - 1.4], trim);
    const columnTop = TOP - 1.9;
    for (let i = 0; i < 6; i++) {
      const x = -6.25 + i * 2.5;
      addCylinder(group, 0.48, 0.56, columnTop - PLINTH - 0.9, [x, PLINTH + (columnTop - PLINTH - 0.9) / 2, PORTICO_BACK + 0.6], trim, 10);
      addBox(group, [1.3, 0.9, 1.3], [x, columnTop - 0.45, PORTICO_BACK + 0.6], trim);
    }
    addBox(group, [14.6, 1.1, 3.4], [0, columnTop + 0.55, (MID_ARM_BACK + PORTICO_BACK) / 2 + 0.3], wall);
    addBox(group, [15.4, 0.3, 4.0], [0, columnTop + 1.25, (MID_ARM_BACK + PORTICO_BACK) / 2 + 0.3], trim);
    gable(0, columnTop + 1.4, MID_ARM_BACK + 0.4, 15.4, 3.3, 3.6, Math.PI);
    for (const dx of [-4.2, 0, 4.2]) {
      addMesh(group, roundArch(1.8, 3.8), dark, [dx, PLINTH, MID_ARM_BACK - 0.1], Math.PI);
      addMesh(group, rectPane(1.6, 2.6), shutter, [dx, FLOOR + 0.8, MID_ARM_BACK - 0.1], Math.PI);
    }

    // ---- Link and eastern (Raghunath) block ----
    block(HALF_LENGTH, EAST_X0, LINK_BACK, LINK_FRONT, EAST_TOP - 0.6, eastWall, 4.8);
    addMesh(group, roundArch(2.4, 3.6), dark, [(HALF_LENGTH + EAST_X0) / 2, 0.5, LINK_FRONT + 0.12]);
    block(EAST_X0, EAST_X1, EAST_BACK, EAST_FRONT, EAST_TOP, eastWall, 4.8);
    // Its river face: plain openings below, a long open verandah above.
    addMesh(group, rectPane(EAST_X1 - EAST_X0 - 3.4, 2.7), dark, [(EAST_X0 + EAST_X1) / 2, 5.3, EAST_FRONT + 0.1]);
    for (let i = 0; i <= 6; i++) {
      const x = EAST_X0 + 1.7 + i * ((EAST_X1 - EAST_X0 - 3.4) / 6);
      addBox(group, [0.22, 2.7, 0.22], [x, 6.65, EAST_FRONT + 0.12], trim);
      if (i < 6) addMesh(group, rectPane(1.1, 2.4), dark, [x + 1.05, 1.2, EAST_FRONT + 0.1]);
    }
    addBox(group, [EAST_X1 - EAST_X0 - 3.4, 0.7, 0.2], [(EAST_X0 + EAST_X1) / 2, 5.65, EAST_FRONT + 0.14], trim);
    for (let i = 0; i < 4; i++) {
      const z = EAST_BACK + 2.6 + i * 4.8;
      addMesh(group, rectPane(1.2, 2.2), shutter, [EAST_X1 + 0.1, 5.6, z], Math.PI / 2);
      addMesh(group, rectPane(1.2, 2.4), dark, [EAST_X1 + 0.1, 1.2, z], Math.PI / 2);
    }
    for (let i = 0; i < 4; i++) {
      const x = EAST_X0 + 2.6 + i * 3.6;
      addMesh(group, rectPane(1.2, 2.2), shutter, [x, 5.6, EAST_BACK - 0.1], Math.PI);
      addMesh(group, rectPane(1.2, 2.4), dark, [x, 1.2, EAST_BACK - 0.1], Math.PI);
    }
    // The stair-head room on its roof.
    addBox(group, [4.6, 2.4, 4.2], [EAST_X0 + 4.4, EAST_TOP + 1.0, EAST_BACK + 5], eastWall);
    addBox(group, [5.0, 0.25, 4.6], [EAST_X0 + 4.4, EAST_TOP + 2.3, EAST_BACK + 5], trim);

    kit.setBoundsCollider(false);
    kit.solidTiles(-HALF_LENGTH, HALF_LENGTH, RANGE_BACK, FRONT + 0.9, TOP + 0.4, 6);
    kit.solidTiles(-HALF_LENGTH, -HALF_LENGTH + 9, END_ARM_BACK, RANGE_BACK, TOP + 0.4, 6);
    kit.solidTiles(HALF_LENGTH - 9, HALF_LENGTH, END_ARM_BACK, RANGE_BACK, TOP + 0.4, 6);
    kit.solidTiles(-7.5, 7.5, PORTICO_BACK, RANGE_BACK, TOP + 3, 5);
    kit.solidTiles(HALF_LENGTH, EAST_X0, LINK_BACK, LINK_FRONT, EAST_TOP, 4);
    kit.solidTiles(EAST_X0, EAST_X1, EAST_BACK, EAST_FRONT, EAST_TOP + 0.4, 6);
    // clearSite takes the world box of a turned rectangle, and this heading
    // is nearly diagonal, so the yards are cleared in short pieces.
    const clearStrip = (x0: number, x1: number, z0: number, z1: number, cell = 6) => {
      const nx = Math.max(1, Math.round((x1 - x0) / cell));
      const nz = Math.max(1, Math.round((z1 - z0) / cell));
      const hx = (x1 - x0) / nx / 2;
      const hz = (z1 - z0) / nz / 2;
      for (let i = 0; i < nx; i++) {
        for (let j = 0; j < nz; j++) kit.clearSite(x0 + hx * (2 * i + 1), z0 + hz * (2 * j + 1), hx, hz);
      }
    };
    clearStrip(-HALF_LENGTH, HALF_LENGTH, RANGE_BACK - 15, RANGE_BACK);
    clearStrip(-HALF_LENGTH - 3, EAST_X1 + 3, FRONT, FRONT + 6.7);
    clearStrip(HALF_LENGTH, EAST_X1, EAST_FRONT, FRONT);
  },
};

export default landmark;
