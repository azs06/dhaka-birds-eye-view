// Khan Mohammad Mridha Mosque (1706), Atish Khana, Lalbagh
//
// A three-domed Mughal mosque standing on the western half of a 5 m vaulted
// platform (tahkhana), reached from the garden on the east by one steep stair
// that ends in a small gateway on the platform's edge.
//
// OSM way 483751031 (the walled compound, 40 × 35–41 m) gives the site: its
// four corners average 23.720892, 90.384181, and its east side runs 177°, so
// the front (the stair and gateway) faces 93°. Banglapedia gives the platform
// as about 38 × 29 m and 5.2 m high and the mosque as 14.6 × 7.3 m; the
// platform is drawn 34 m long to stay inside the OSM plot. Heights above the
// platform are measured off the front elevation photo (wall 5.6 m, dome crown
// 7.5 m, corner cupolas 7.5 m).
//
// Local +Z is east (the stair), local +X is north.
import { headingFromBearing, type LandmarkModule } from "./kit";

const PLATFORM_TOP = 5;
// Platform plan: x from south to north, z from west to east.
const PLATFORM_X0 = -16;
const PLATFORM_X1 = 18;
const PLATFORM_Z0 = -18.5;
const PLATFORM_Z1 = 9.5;
// The mosque on the platform: long axis north–south.
const MOSQUE_Z = -10.5;
const MOSQUE_HALF_X = 7.3;
const MOSQUE_HALF_Z = 3.65;
const WALL = 5.6;

const landmark: LandmarkModule = {
  key: "khan-mohammad-mridha-mosque",
  label: "Khan Mohammad Mridha Mosque",
  labelBn: "খান মোহাম্মদ মৃধা মসজিদ",
  shortLabel: "KMM",
  lat: 23.720892,
  lon: 90.384181,
  altitude: 13.6,
  heading: headingFromBearing(93),
  clearingRadius: 28,
  extents: [17, 14],
  replacesOsmBuildingIds: [483751031],
  triangleBudget: 4000,
  // A walled plot in a packed neighbourhood: the houses come right up to it.
  plotGap: 3,
  build(kit) {
    const { group, addBox, addCylinder, addLathe, addMesh, addFinial, domeProfile, pointedArch, roundArch, materials } = kit;
    const plaster = kit.material(0xe08c64, { roughness: 0.9 });
    const trim = kit.material(0xc9764f, { roughness: 0.9 });
    const aged = kit.material(0xd6a086, { roughness: 0.95 });
    // Eight materials: the terrace floor and doors share the trim, the stair
    // the platform's aged plaster, and the trees the palms' canopy.
    const terrace = trim;
    const recess = kit.material(0xf1e6da, { roughness: 0.9 });
    const P = PLATFORM_TOP;
    const platformX = (PLATFORM_X0 + PLATFORM_X1) / 2;
    const platformZ = (PLATFORM_Z0 + PLATFORM_Z1) / 2;
    const platformSX = PLATFORM_X1 - PLATFORM_X0;
    const platformSZ = PLATFORM_Z1 - PLATFORM_Z0;

    // GARDEN: lawn over the whole plot, a path to the stair, a low wall.
    addBox(group, [36, 0.1, 39], [1, 0.05, 0], materials.lawn);
    addBox(group, [3.4, 0.08, 3.6], [0, 0.12, 17.6], aged);
    const boundary: Array<[number, number, number, number]> = [
      [36.6, 0.4, 1, -19.6], [0.4, 39.2, -17.2, 0], [0.4, 39.2, 19.2, 0], [15.6, 0.4, -9.2, 19.6], [15.6, 0.4, 11.2, 19.6],
    ];
    for (const [sx, sz, x, z] of boundary) addBox(group, [sx, 1.7, sz], [x, 0.85, z], aged);
    kit.addPalm(group, -9, 14.5, 9, 0.1, 0.4);
    kit.addPalm(group, 12, 15, 10, 0.12, 2.1);
    kit.addTree(group, -12.5, 15.5, 2.6, 3.2, materials.lightCanopy);
    kit.addTree(group, 7, 16, 2.2, 2.8, materials.lightCanopy);

    // PLATFORM (tahkhana): a plain mass with a moulded edge, the red-painted
    // terrace on top and the vault openings along its sides.
    addBox(group, [platformSX, P - 0.35, platformSZ], [platformX, (P - 0.35) / 2, platformZ], aged);
    addBox(group, [platformSX + 0.5, 0.35, platformSZ + 0.5], [platformX, P - 0.175, platformZ], trim);
    addBox(group, [platformSX - 1.2, 0.08, platformSZ - 1.2], [platformX, P + 0.04, platformZ], terrace);
    // Low parapet round the terrace, open at the head of the stair.
    const parapet: Array<[number, number, number, number]> = [
      [platformSX, 0.45, platformX, PLATFORM_Z0 + 0.22], [0.45, platformSZ, PLATFORM_X0 + 0.22, platformZ], [0.45, platformSZ, PLATFORM_X1 - 0.22, platformZ],
      [PLATFORM_X1 - 2.3, 0.45, (PLATFORM_X1 + 2.3) / 2, PLATFORM_Z1 - 0.22], [-2.3 - PLATFORM_X0, 0.45, (PLATFORM_X0 - 2.3) / 2, PLATFORM_Z1 - 0.22],
    ];
    for (const [sx, sz, x, z] of parapet) addBox(group, [sx, 0.7, sz], [x, P + 0.35, z], aged);
    for (let i = 0; i < 7; i++) {
      const z = PLATFORM_Z0 + 2.6 + i * 3.8;
      addMesh(group, roundArch(2.2, 3.3), materials.archDark, [PLATFORM_X1 + 0.08, 0.3, z], Math.PI / 2);
      addMesh(group, roundArch(2.2, 3.3), materials.archDark, [PLATFORM_X0 - 0.08, 0.3, z], -Math.PI / 2);
    }
    for (let i = 0; i < 8; i++) {
      addMesh(group, roundArch(2.2, 3.3), materials.archDark, [PLATFORM_X0 + 3.4 + i * 3.9, 0.3, PLATFORM_Z0 - 0.08], Math.PI);
    }
    // The two round buttresses on the east face, either side of the stair.
    for (const x of [-8.6, 8.6]) {
      addCylinder(group, 1.75, 1.9, P - 0.5, [x, (P - 0.5) / 2, PLATFORM_Z1], aged, 12);
      addCylinder(group, 2.05, 2.05, 0.5, [x, P - 0.25, PLATFORM_Z1], trim, 12);
    }

    // STAIR: one straight flight between solid cheek walls, drawn as six
    // broad steps.
    const STAIR_RUN = 7.2;
    const STEPS = 6;
    for (let i = 0; i < STEPS; i++) {
      const stepTop = P * (1 - i / STEPS);
      const depth = STAIR_RUN / STEPS;
      addBox(group, [3.2, stepTop, depth], [0, stepTop / 2, PLATFORM_Z1 + depth * (i + 0.5)], aged);
    }
    for (const x of [-1.95, 1.95]) {
      kit.addBeam(group, [x, P + 0.15, PLATFORM_Z1], [x, 0.75, PLATFORM_Z1 + STAIR_RUN + 0.3], 0.7, 1.5, aged);
    }

    // GATEWAY at the head of the stair: a plain tower with a pointed archway
    // in a recessed panel and a band of merlons.
    const GATE_Z = PLATFORM_Z1 - 1.3;
    addBox(group, [4.4, 5.4, 2.4], [0, P + 2.7, GATE_Z], plaster);
    addBox(group, [4.7, 0.25, 2.7], [0, P + 5.0, GATE_Z], trim);
    addBox(group, [4.5, 0.55, 2.5], [0, P + 5.65, GATE_Z], trim);
    for (const [face, turn] of [[1, 0], [-1, Math.PI]] as const) {
      addMesh(group, pointedArch(3, 4.3), trim, [0, P + 0.15, GATE_Z + face * 1.24], turn);
      addMesh(group, pointedArch(1.7, 2.7), materials.archDark, [0, P + 0.05, GATE_Z + face * 1.3], turn);
    }

    // MOSQUE: an oblong hall with three doorways to the east, octagonal corner
    // towers with ribbed cupolas, and three domes on low drums.
    const top = P + WALL;
    addBox(group, [MOSQUE_HALF_X * 2, WALL - 0.8, MOSQUE_HALF_Z * 2], [0, P + (WALL - 0.8) / 2, MOSQUE_Z], plaster);
    // Cornice and the merlon band of the parapet.
    addBox(group, [MOSQUE_HALF_X * 2 + 0.3, 0.2, MOSQUE_HALF_Z * 2 + 0.3], [0, top - 0.9, MOSQUE_Z], trim);
    addBox(group, [MOSQUE_HALF_X * 2 + 0.1, 0.8, MOSQUE_HALF_Z * 2 + 0.1], [0, top - 0.4, MOSQUE_Z], plaster);
    addBox(group, [MOSQUE_HALF_X * 2 - 1, 0.1, MOSQUE_HALF_Z * 2 - 1], [0, top + 0.03, MOSQUE_Z], trim);
    // The central bay stands a little proud of the front, as a tall frame.
    const front = MOSQUE_Z + MOSQUE_HALF_Z;
    addBox(group, [4.4, WALL - 0.75, 0.35], [0, P + (WALL - 0.75) / 2, front + 0.17], plaster);
    // Doorways: a white recess with a red door, three on the front and one
    // in each end wall.
    const doorway = (x: number, z: number, turn: number, width: number, height: number) => {
      const nx = Math.sin(turn);
      const nz = Math.cos(turn);
      addMesh(group, pointedArch(width + 1, height + 1), trim, [x + nx * 0.04, P + 0.1, z + nz * 0.04], turn);
      addMesh(group, pointedArch(width, height), recess, [x + nx * 0.1, P + 0.1, z + nz * 0.1], turn);
      addMesh(group, kit.rectPane(width * 0.8, height * 0.62), terrace, [x + nx * 0.16, P + 0.1, z + nz * 0.16], turn);
    };
    doorway(0, front + 0.35, 0, 2.1, 3.3);
    doorway(-4.5, front, 0, 1.6, 2.9);
    doorway(4.5, front, 0, 1.6, 2.9);
    doorway(MOSQUE_HALF_X, MOSQUE_Z, Math.PI / 2, 1.6, 2.9);
    doorway(-MOSQUE_HALF_X, MOSQUE_Z, -Math.PI / 2, 1.6, 2.9);
    // Slender turrets flanking the bays, rising through the parapet.
    for (const x of [-5.9, -2.25, 2.25, 5.9]) {
      addCylinder(group, 0.26, 0.3, WALL + 0.5, [x, P + (WALL + 0.5) / 2, front + 0.3], trim, 8);
      kit.addCone(group, 0.34, 0.6, [x, P + WALL + 0.8, front + 0.3], trim, 8);
    }
    // Corner towers.
    for (const x of [-MOSQUE_HALF_X, MOSQUE_HALF_X]) {
      for (const z of [MOSQUE_Z - MOSQUE_HALF_Z, MOSQUE_Z + MOSQUE_HALF_Z]) {
        addLathe(group, [
          [0.82, 0], [0.74, 0.5], [0.74, WALL - 0.2], [1.02, WALL], [1.02, WALL + 0.15], [0.62, WALL + 0.3],
          [0.62, WALL + 1.0], [0.84, WALL + 1.12], [0.84, WALL + 1.25], [0.6, WALL + 1.3],
        ], 8, [x, P, z], plaster, true);
        addLathe(group, domeProfile(0.6, 0.62, 0.12, 4), 8, [x, P + WALL + 1.3, z], trim);
        kit.addCone(group, 0.09, 0.7, [x, P + WALL + 2.2, z], trim, 5);
      }
    }
    // Domes.
    const dome = (x: number, radius: number, rise: number) => {
      addCylinder(group, radius + 0.12, radius + 0.22, 0.95, [x, top - 0.2, MOSQUE_Z], plaster, 8);
      addCylinder(group, radius + 0.3, radius + 0.3, 0.16, [x, top + 0.3, MOSQUE_Z], trim, 8);
      addLathe(group, domeProfile(radius, rise, 0.06, 6), 14, [x, top + 0.3, MOSQUE_Z], plaster);
      addFinial(group, [x, top + 0.25 + rise, MOSQUE_Z], radius * 0.14, trim);
    };
    dome(0, 2.3, 1.9);
    dome(-4.4, 1.75, 1.45);
    dome(4.4, 1.75, 1.45);

    // MADRASA: the low verandahed range on the north edge of the terrace.
    addBox(group, [5.6, 3.6, 15], [PLATFORM_X1 - 3.4, P + 1.8, 0.4], plaster);
    addBox(group, [6.8, 0.25, 16.2], [PLATFORM_X1 - 3.6, P + 3.3, 0.4], trim);
    for (let i = 0; i < 5; i++) {
      addMesh(group, pointedArch(1.5, 2.5), materials.archDark, [PLATFORM_X1 - 6.28, P + 0.1, -5.2 + i * 2.8], -Math.PI / 2);
    }

    // COLLIDERS: the platform, then what stands on it. The garden and the
    // stair stay open.
    kit.setBoundsCollider(false);
    kit.solidBox(platformX, platformZ, platformSX / 2, platformSZ / 2, P + 0.7);
    kit.solidBox(0, MOSQUE_Z, MOSQUE_HALF_X + 0.8, MOSQUE_HALF_Z + 0.8, P + WALL + 1.2);
    kit.solid(0, MOSQUE_Z, 2.2, P + WALL + 2.2);
    kit.solidBox(0, GATE_Z, 2.3, 1.3, P + 5.9);
    kit.solidBox(PLATFORM_X1 - 3.4, 0.4, 3, 7.6, P + 3.5);
    kit.clearSite(1, 0, 18.4, 19.8);
    kit.setPerchTarget(0.01, MOSQUE_Z);
  },
};

export default landmark;
