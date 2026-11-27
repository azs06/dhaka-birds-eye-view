// Northbrook Hall (Lalkuthi)
//
// The red town hall of 1880 on the Buriganga bank in Farashganj: a tall
// Indo-Saracenic hall whose north front carries a white-framed horseshoe
// portal between four octagonal minarets with bulbous grey domes, under a
// deep cornice and a crested parapet. A low arcaded verandah with a central
// porch runs along the river (south) side.
//
// OSM way 454698651 ("Lalkuthi", also in the bundled snapshot): a 19.1 m ×
// 12.6 m hall whose long axis runs 126.5°, with a projection on the river
// side. The origin is the centre of that way's bounding box; the portal front
// faces 36.5° (north-east, toward B K Das Road) and the verandah the river.
// Heights are read off photographs against the 19.1 m front (cornice about
// 12.5 m, minaret domes about 20 m). The verandah is drawn the full width of
// the hall, as in photographs of the back, where OSM maps an 11 m projection.
//
// Local +Z is the portal front; +X runs north-west along it.
import { headingFromBearing, type LandmarkModule } from "./kit";

const HALF_WIDTH = 9.55;
const FRONT = 9.3;
const BACK = -3.3;
const TRANSEPT_BACK = 3.6;
const CORNICE = 12.5;
const PARAPET = 13.5;
const VERANDAH_BACK = -7.3;
const VERANDAH_TOP = 6.4;
const PORCH_BACK = -9.2;

const landmark: LandmarkModule = {
  key: "northbrook-hall",
  label: "Northbrook Hall",
  labelBn: "নর্থব্রুক হল",
  shortLabel: "NBH",
  lat: 23.704523,
  lon: 90.412583,
  altitude: 21,
  heading: headingFromBearing(36.5),
  clearingRadius: 26,
  extents: [10, 10],
  replacesOsmBuildingIds: [454698651],
  triangleBudget: 4000,
  plotGap: 6,
  build(kit) {
    const { group, addBox, addLathe, addMesh, roundArch, rectPane, materials } = kit;
    const red = kit.material(0xa22a2c, { roughness: 0.88 });
    const darkRed = kit.material(0x7f2023, { roughness: 0.9 });
    const white = materials.whiteStone;
    const crest = kit.material(0xcfcabd, { roughness: 0.9 });
    const domeGrey = kit.material(0xb5b2a8, { roughness: 0.8 });
    const dark = materials.archDark;
    const HALL_HALF = HALF_WIDTH - 0.65;

    // Paved compound.
    addBox(group, [28, 0.1, 34], [2, 0.05, 1.5], materials.yardPaving);

    // The hall, and the slightly wider front bay the minarets stand on.
    addBox(group, [HALL_HALF * 2, CORNICE, TRANSEPT_BACK - BACK], [0, CORNICE / 2, (TRANSEPT_BACK + BACK) / 2], red);
    addBox(group, [HALF_WIDTH * 2, CORNICE, FRONT - TRANSEPT_BACK], [0, CORNICE / 2, (FRONT + TRANSEPT_BACK) / 2], red);
    // Plinth, string courses, the deep bracketed cornice and the crested parapet.
    const band = (y: number, height: number, grow: number, material: typeof red) => {
      addBox(group, [(HALL_HALF + grow) * 2, height, TRANSEPT_BACK - BACK + grow], [0, y, (TRANSEPT_BACK + BACK - grow) / 2], material);
      addBox(group, [(HALF_WIDTH + grow) * 2, height, FRONT - TRANSEPT_BACK + grow * 2], [0, y, (FRONT + TRANSEPT_BACK) / 2], material);
    };
    band(0.45, 0.9, 0.25, darkRed);
    band(5.0, 0.28, 0.1, white);
    band(8.6, 0.28, 0.1, white);
    band(CORNICE - 0.75, 0.5, 0.35, darkRed);
    band(CORNICE - 0.2, 0.4, 1.0, white);
    band(CORNICE + 0.1, 0.22, 1.15, darkRed);
    const parapet = (x0: number, x1: number, z0: number, z1: number) => {
      const y = (CORNICE + PARAPET) / 2 + 0.1;
      const h = PARAPET - CORNICE - 0.2;
      addBox(group, [x1 - x0, h, 0.3], [(x0 + x1) / 2, y, z1 - 0.15], crest);
      addBox(group, [x1 - x0, h, 0.3], [(x0 + x1) / 2, y, z0 + 0.15], crest);
      addBox(group, [0.3, h, z1 - z0], [x0 + 0.15, y, (z0 + z1) / 2], crest);
      addBox(group, [0.3, h, z1 - z0], [x1 - 0.15, y, (z0 + z1) / 2], crest);
    };
    parapet(-HALF_WIDTH, HALF_WIDTH, TRANSEPT_BACK, FRONT);
    parapet(-HALL_HALF, HALL_HALF, BACK, TRANSEPT_BACK);

    // Octagonal minarets: a red shaft to the cornice, then white drum, red
    // shaft, flared white collar, red neck and a bulbous grey dome.
    const minaret = (x: number, z: number) => {
      addLathe(group, [[1.45, 0], [1.45, 0.9], [1.12, 1.2], [1.12, CORNICE - 1.0], [1.75, CORNICE - 0.1], [1.75, CORNICE + 0.25]], 8, [x, 0, z], red, true);
      addLathe(group, [[1.2, 0], [1.2, 1.5], [1.32, 1.62], [0, 1.62]], 8, [x, CORNICE + 0.25, z], white, true);
      addLathe(group, [[0.95, 0], [0.95, 1.5]], 8, [x, CORNICE + 1.85, z], red, true);
      addLathe(group, [[0.95, 0], [1.5, 0.55], [1.5, 0.8], [1.0, 0.95], [0, 0.95]], 8, [x, CORNICE + 3.35, z], white, true);
      addLathe(group, [[0.9, 0], [0.9, 1.4], [1.05, 1.5]], 8, [x, CORNICE + 4.3, z], red, true);
      addLathe(group, [[0.95, 0], [1.25, 0.5], [1.3, 0.95], [1.05, 1.5], [0.6, 1.9], [0.2, 2.1], [0.08, 2.9], [0, 2.9]], 10, [x, CORNICE + 5.8, z], domeGrey);
      kit.solid(x, z, 1.5, CORNICE + 8.4);
    };
    for (const side of [-1, 1]) {
      minaret(side * HALF_WIDTH, FRONT);
      minaret(side * HALF_WIDTH, TRANSEPT_BACK);
    }

    // The portal: a projecting frontispiece, a white frame and the horseshoe
    // arch, with a pierced frieze above.
    addBox(group, [9.6, 10.4, 1.0], [0, 5.2, FRONT + 0.5], red);
    addBox(group, [10.4, 0.4, 1.5], [0, 10.6, FRONT + 0.6], white);
    addBox(group, [9.2, 1.0, 0.5], [0, 11.3, FRONT + 0.45], crest);
    addBox(group, [5.8, 9.4, 0.3], [0, 4.7, FRONT + 1.1], white);
    addMesh(group, roundArch(4.5, 7.9), red, [0, 0, FRONT + 1.3]);
    addMesh(group, roundArch(3.5, 7.2), dark, [0, 0, FRONT + 1.36]);
    for (const side of [-1, 1]) addBox(group, [0.55, 6.2, 0.4], [side * 4.5, 5.6, FRONT + 1.05], white);
    addBox(group, [5.2, 0.3, 2.2], [0, 0.15, FRONT + 1.9], crest);

    // Windows: a white-ringed arched window below and a balconied one above
    // in every bay, the same on the sides of the hall.
    const windowBay = (x: number, z: number, turn: number) => {
      const nx = Math.sin(turn);
      const nz = Math.cos(turn);
      const at = (proud: number, y: number): [number, number, number] => [x + nx * proud, y, z + nz * proud];
      addMesh(group, roundArch(2.0, 3.5), white, at(0.08, 1.3), turn);
      addMesh(group, roundArch(1.3, 3.0), dark, at(0.14, 1.4), turn);
      addMesh(group, roundArch(1.5, 2.6), white, at(0.08, 6.0), turn);
      addMesh(group, roundArch(0.95, 2.1), dark, at(0.14, 6.2), turn);
      addMesh(group, rectPane(1.9, 0.8), white, at(0.2, 5.5), turn);
    };
    for (const side of [-1, 1]) {
      windowBay(side * 7.1, FRONT, 0);
      windowBay(side * HALF_WIDTH, (FRONT + TRANSEPT_BACK) / 2, side * Math.PI / 2);
      windowBay(side * HALL_HALF, 0.2, side * Math.PI / 2);
    }

    // River side: a single-storey arcaded verandah, three arches either side
    // of a taller central porch, under a pierced parapet with small domes.
    addBox(group, [HALL_HALF * 2, VERANDAH_TOP - 1.1, BACK - VERANDAH_BACK], [0, (VERANDAH_TOP - 1.1) / 2, (BACK + VERANDAH_BACK) / 2], red);
    addBox(group, [HALL_HALF * 2 + 0.4, 0.3, BACK - VERANDAH_BACK + 0.3], [0, VERANDAH_TOP - 1.0, (BACK + VERANDAH_BACK) / 2 - 0.15], white);
    addBox(group, [HALL_HALF * 2, 0.9, 0.3], [0, VERANDAH_TOP - 0.4, VERANDAH_BACK + 0.15], crest);
    for (const side of [-1, 1]) {
      addBox(group, [0.3, 0.9, BACK - VERANDAH_BACK], [side * (HALL_HALF - 0.15), VERANDAH_TOP - 0.4, (BACK + VERANDAH_BACK) / 2], crest);
      for (let bay = 0; bay < 3; bay++) {
        const x = side * (3.6 + bay * 2.15);
        addMesh(group, roundArch(1.95, 3.9), white, [x, 0.9, VERANDAH_BACK - 0.08], Math.PI);
        addMesh(group, roundArch(1.6, 3.6), dark, [x, 1.0, VERANDAH_BACK - 0.14], Math.PI);
      }
      addMesh(group, roundArch(1.6, 3.6), dark, [side * (HALL_HALF + 0.1), 1.0, (BACK + VERANDAH_BACK) / 2], side * Math.PI / 2);
      // End pier and its little dome.
      addBox(group, [0.9, VERANDAH_TOP, 0.9], [side * (HALL_HALF - 0.3), VERANDAH_TOP / 2, VERANDAH_BACK + 0.3], red);
      addLathe(group, [[0.5, 0], [0.5, 0.5], [0.62, 0.8], [0.45, 1.25], [0.1, 1.5], [0, 2.0]], 8, [side * (HALL_HALF - 0.3), VERANDAH_TOP, VERANDAH_BACK + 0.3], domeGrey);
    }
    addBox(group, [4.6, VERANDAH_TOP + 0.9, VERANDAH_BACK - PORCH_BACK + 0.4], [0, (VERANDAH_TOP + 0.9) / 2, (VERANDAH_BACK + PORCH_BACK) / 2 + 0.2], red);
    addBox(group, [5.0, 0.3, VERANDAH_BACK - PORCH_BACK + 0.8], [0, VERANDAH_TOP - 0.1, (VERANDAH_BACK + PORCH_BACK) / 2 + 0.2], white);
    addBox(group, [4.6, 0.8, 0.3], [0, VERANDAH_TOP + 0.6, PORCH_BACK + 0.15], crest);
    addMesh(group, roundArch(2.6, 5.0), white, [0, 0.5, PORCH_BACK - 0.08], Math.PI);
    addMesh(group, roundArch(1.9, 4.5), dark, [0, 0.6, PORCH_BACK - 0.14], Math.PI);
    addBox(group, [3.4, 0.5, 1.6], [0, 0.25, PORCH_BACK - 0.8], crest);
    for (const side of [-1, 1]) {
      addLathe(group, [[0.45, 0], [0.45, 0.5], [0.58, 0.8], [0.42, 1.2], [0.1, 1.45], [0, 1.9]], 8, [side * 2.0, VERANDAH_TOP + 0.9, PORCH_BACK + 0.4], domeGrey);
      // Slim pinnacles on the back of the hall parapet.
      addBox(group, [0.8, 2.2, 0.8], [side * 5.6, CORNICE + 1.1, BACK + 0.4], red);
      addLathe(group, [[0.48, 0], [0.6, 0.35], [0.45, 0.85], [0.1, 1.1], [0, 1.6]], 8, [side * 5.6, CORNICE + 2.2, BACK + 0.4], domeGrey);
    }

    // Trees of the compound, clear of the front.
    kit.addTree(group, 13.5, 13, 3.4, 4.2);
    kit.addTree(group, 14, -6, 3.0, 3.8);
    kit.addPalm(group, -11.2, 1.5, 9);

    kit.setBoundsCollider(false);
    kit.solidTiles(-HALF_WIDTH, HALF_WIDTH, VERANDAH_BACK, FRONT + 1, CORNICE + 1, 5);
    kit.solidTiles(-HALL_HALF, HALL_HALF, PORCH_BACK, VERANDAH_BACK, VERANDAH_TOP + 1, 4);
    // clearSite takes the world box of a turned rectangle, so the compound
    // is cleared in short pieces to keep the neighbours on this diagonal.
    for (let i = 0; i < 4; i++) {
      for (let j = 0; j < 5; j++) kit.clearSite(-12 + 7 * i + 3.5, -15.5 + 6.8 * j + 3.4, 3.5, 3.4);
    }
  },
};

export default landmark;
