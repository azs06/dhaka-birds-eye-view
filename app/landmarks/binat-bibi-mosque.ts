// Binat Bibi Mosque (1454), Narinda Road
//
// The oldest surviving mosque in Dhaka: a small pre-Mughal square chamber
// under a low hemispherical dome, doubled in 1932 with a second dome beside
// it, its walls since covered in white broken-china mosaic. A tall brick
// extension with blue arched windows now stands behind the two domes, and a
// white, green and blue minaret rises over the whole block.
//
// OSM has no named footprint, only two place-of-worship nodes (3711746808 at
// 23.711101, 90.418146 and 11768484956 at 23.711053, 90.418248). Both sit on
// the unnamed building way 1002612176 (about 15 × 17 m, east side on Narinda
// Road), which is taken as the mosque: its corners average 23.711122,
// 90.418209 and its road front faces about 105°. The split into old hall
// (front) and extension (rear), the heights and the minaret's place on the
// plot are read off photographs, not surveyed: the minaret's exact position
// is not visible in any of them and is approximate.
//
// Local +Z is the Narinda Road front (ESE), local +X runs NNE along the road.
import { headingFromBearing, type LandmarkModule } from "./kit";

const HALF_WIDTH = 7.4;
// The old single-storey hall, on the road.
const HALL_Z0 = 1.6;
const HALL_Z1 = 8.4;
const HALL_TOP = 4.7;
// The brick extension behind it.
const REAR_Z0 = -8.6;
const REAR_TOP = 13.4;
const MINARET: [number, number] = [-5.4, -6.6];
const MINARET_TOP = 39.5;

const landmark: LandmarkModule = {
  key: "binat-bibi-mosque",
  label: "Binat Bibi Mosque",
  labelBn: "বিনত বিবি মসজিদ",
  shortLabel: "BBM",
  lat: 23.711122,
  lon: 90.418209,
  altitude: MINARET_TOP,
  heading: headingFromBearing(105),
  clearingRadius: 16,
  extents: [HALF_WIDTH, 8.6],
  triangleBudget: 2500,
  plotGap: 3,
  inspectDistance: 70,
  build(kit) {
    const { group, addBox, addCylinder, addLathe, addMesh, domeProfile, pointedArch, rectPane, materials } = kit;
    const mosaic = kit.material(0xe2ddd0, { roughness: 0.85 });
    const grille = kit.material(0x3f7a4c, { roughness: 0.9 });
    const tileGreen = kit.material(0x1f6b3a, { roughness: 0.7 });
    const tileBlue = kit.material(0x2f9fd0, { roughness: 0.5 });
    const windowBlue = kit.litMaterial(0x3f6fd0, 0.5);
    const white = materials.whiteStone;
    const domeWhite = white;

    // Forecourt strip between the hall and the road.
    addBox(group, [HALF_WIDTH * 2 + 1, 0.1, 2.6], [0, 0.05, HALL_Z1 + 1.3], materials.concrete);

    // OLD HALL: mosaic walls, five grilled bays between slim pillars, a deep
    // bracketed cornice, and the two low domes.
    const hallDepth = HALL_Z1 - HALL_Z0;
    const hallZ = (HALL_Z0 + HALL_Z1) / 2;
    addBox(group, [HALF_WIDTH * 2, HALL_TOP, hallDepth], [0, HALL_TOP / 2, hallZ], mosaic);
    addBox(group, [HALF_WIDTH * 2 + 0.7, 0.3, hallDepth + 0.7], [0, HALL_TOP - 0.55, hallZ], domeWhite);
    addBox(group, [HALF_WIDTH * 2 + 0.2, 0.5, hallDepth + 0.2], [0, HALL_TOP + 0.05, hallZ], mosaic);
    const BAYS = 5;
    const bay = (HALF_WIDTH * 2 - 1.4) / BAYS;
    for (let i = 0; i < BAYS; i++) {
      const x = -HALF_WIDTH + 0.7 + bay * (i + 0.5);
      addMesh(group, rectPane(bay - 0.5, 2.9), materials.archDark, [x, 0.25, HALL_Z1 + 0.06]);
      addMesh(group, rectPane(bay - 0.5, 1.7), grille, [x, 0.25, HALL_Z1 + 0.1]);
    }
    for (const x of [-3.6, 3.6]) {
      addCylinder(group, 3.0, 3.1, 0.5, [x, HALL_TOP + 0.5, hallZ], mosaic, 14);
      addLathe(group, domeProfile(2.85, 2.25, 0, 6), 14, [x, HALL_TOP + 0.75, hallZ], domeWhite);
      kit.addCone(group, 0.28, 0.75, [x, HALL_TOP + 3.3, hallZ], mosaic, 6);
    }
    // The four little turrets on the road parapet.
    for (const x of [-HALF_WIDTH + 0.4, -2.4, 2.4, HALF_WIDTH - 0.4]) {
      const z = HALL_Z1 - 0.3;
      addCylinder(group, 0.32, 0.38, 1.5, [x, HALL_TOP + 1.05, z], mosaic, 8);
      addCylinder(group, 0.5, 0.5, 0.14, [x, HALL_TOP + 1.85, z], domeWhite, 8);
      addCylinder(group, 0.26, 0.26, 0.55, [x, HALL_TOP + 2.2, z], materials.archDark, 6);
      addLathe(group, domeProfile(0.46, 0.5, 0, 3), 8, [x, HALL_TOP + 2.47, z], domeWhite);
      kit.addCone(group, 0.08, 0.5, [x, HALL_TOP + 3.2, z], domeWhite, 5);
    }

    // EXTENSION: four brick storeys behind the domes, blue pointed windows
    // on the front, plain window bands on the other sides.
    const rearDepth = HALL_Z0 - REAR_Z0;
    const rearZ = (HALL_Z0 + REAR_Z0) / 2;
    addBox(group, [HALF_WIDTH * 2, REAR_TOP, rearDepth], [0, REAR_TOP / 2, rearZ], materials.redBrick);
    // Flat concrete roof slab, lapping the brick so its top does not z-fight.
    addBox(group, [HALF_WIDTH * 2 + 0.3, 0.4, rearDepth + 0.3], [0, REAR_TOP - 0.1, rearZ], materials.concrete);
    for (const y of [6.3, 9.7]) {
      for (const x of [-4.6, -1.5, 1.6, 4.7]) {
        addMesh(group, pointedArch(1.9, 2.6), windowBlue, [x, y, HALL_Z0 + 0.07]);
      }
    }
    for (let floor = 0; floor < 4; floor++) {
      const y = 1.3 + floor * 3.25;
      addMesh(group, rectPane(rearDepth - 2, 1.3), materials.archDark, [HALF_WIDTH + 0.06, y, rearZ], Math.PI / 2);
      addMesh(group, rectPane(rearDepth - 2, 1.3), materials.archDark, [-HALF_WIDTH - 0.06, y, rearZ], -Math.PI / 2);
      addMesh(group, rectPane(HALF_WIDTH * 2 - 5.5, 1.3), materials.archDark, [2, y, REAR_Z0 - 0.06], Math.PI);
    }

    // MINARET: a square white shaft with slit windows, turning octagonal
    // under two balconies on green corbels, and an egg-shaped blue dome.
    const [mx, mz] = MINARET;
    addBox(group, [3, 23, 3], [mx, 11.5, mz], white);
    for (const y of [15.2, 18.8]) {
      for (const [turn, dx, dz] of [[0, 0, 1.56], [Math.PI, 0, -1.56], [Math.PI / 2, 1.56, 0], [-Math.PI / 2, -1.56, 0]] as const) {
        addMesh(group, pointedArch(0.55, 2.1), materials.archDark, [mx + dx, y, mz + dz], turn);
      }
    }
    addBox(group, [3.06, 0.2, 3.06], [mx, 17.9, mz], materials.archDark);
    addBox(group, [3.06, 0.2, 3.06], [mx, 22.2, mz], materials.archDark);
    addLathe(group, [[1.6, 23], [1.45, 23.6], [1.45, 27.4]], 8, [mx, 0, mz], white, true);
    addLathe(group, [[1.45, 27.2], [2.55, 28.9], [2.55, 29.1]], 8, [mx, 0, mz], tileGreen, true);
    addCylinder(group, 2.65, 2.65, 0.22, [mx, 29.2, mz], white, 8);
    addCylinder(group, 1.12, 1.12, 3.6, [mx, 31.1, mz], white, 10);
    addLathe(group, [[1.12, 32.7], [1.9, 33.9], [1.9, 34.05]], 10, [mx, 0, mz], tileGreen, true);
    addCylinder(group, 2.0, 2.0, 0.2, [mx, 34.15, mz], white, 10);
    addCylinder(group, 0.95, 0.95, 1.9, [mx, 35.2, mz], white, 8);
    addCylinder(group, 0.97, 0.97, 1.0, [mx, 35.1, mz], materials.archDark, 8);
    addCylinder(group, 1.12, 1.12, 0.22, [mx, 36.2, mz], tileGreen, 10);
    addLathe(group, [[1.0, 0], [1.05, 0.5], [0.95, 1.2], [0.66, 1.9], [0.3, 2.3], [0.02, 2.45]], 10, [mx, 36.3, mz], tileBlue);
    kit.addCone(group, 0.07, 1.1, [mx, 39.2, mz], white, 5);

    // COLLIDERS: hall, domes, extension, minaret.
    kit.setBoundsCollider(false);
    kit.solidBox(0, hallZ, HALF_WIDTH, hallDepth / 2, HALL_TOP + 0.4);
    kit.solid(-3.6, hallZ, 2.1, HALL_TOP + 2.6);
    kit.solid(3.6, hallZ, 2.1, HALL_TOP + 2.6);
    kit.solidBox(0, rearZ, HALF_WIDTH, rearDepth / 2, REAR_TOP);
    kit.solid(mx, mz, 1.6, MINARET_TOP - 2);
    kit.clearSite(0, HALL_Z1 + 1.3, HALF_WIDTH + 0.5, 1.4);
    kit.setPerchTarget(3.6, hallZ);
  },
};

export default landmark;
