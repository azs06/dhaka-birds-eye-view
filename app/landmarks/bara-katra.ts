// Bara Katra
//
// The great Mughal caravanserai of 1644–46 in Chawkbazar. What is modelled
// is its river (south) wing, the part people know: a two-storey brick range
// 68 m long, a three-storey gateway projecting from the middle with a tall
// arched alcove over the entrance and a row of windows above it, and an
// octagonal three-storey tower closing each end. Plaster survives in
// patches on dark, weathered brick.
//
// OpenStreetMap has no footprint for the katra, only the node 4667886550
// "Boro Katra" (23.7146489, 90.3952358, addr:street Shoari Ghat Road), which
// agrees with its Wikipedia article (23.7146, 90.3952). Photographs show the
// lane running through the gateway, and Shoari Ghat Road (way 234388546, a
// living street that the game does not draw) runs at 202°, square to the
// wing, 29 m east of the node. So the origin, the middle of the gateway, is
// where that road crosses the wing line drawn through the node at 111°:
// 23.714557, 90.395498 (approximate along the road). The front faces 201°
// toward the Buriganga. The length (67.97 m) and the arrangement are from
// the article; heights are estimated from photographs of the gateway. The
// katra is hemmed in by houses, so only the lane in front, a strip behind
// and the street through the gate are cleared.
//
// Local +Z is the river front; +X runs east-south-east along the wing.
import { headingFromBearing, type LandmarkModule } from "./kit";

const HALF_LENGTH = 34;
const WING_HALF_DEPTH = 5;
const WING_TOP = 9.6;
const GATE_HALF = 7.5;
const GATE_FRONT = 8.5;
const GATE_BACK = -6.5;
const GATE_TOP = 17.5;
const TOWER_RADIUS = 4.3;
const TOWER_TOP = 14;
const TOWER_Z = 3.2;

const landmark: LandmarkModule = {
  key: "bara-katra",
  label: "Bara Katra",
  labelBn: "বড় কাটরা",
  shortLabel: "BKT",
  lat: 23.714557,
  lon: 90.395498,
  altitude: 18.5,
  heading: headingFromBearing(201),
  clearingRadius: 38,
  extents: [38, 9],
  triangleBudget: 3000,
  plotGap: 3,
  build(kit) {
    const { group, addBox, addLathe, addMesh, addPrism, pointedArch, rectPane, materials } = kit;
    const brick = kit.material(0x99583e, { roughness: 0.95 });
    const darkBrick = kit.material(0x6e3d2b, { roughness: 1 });
    const plaster = kit.material(0xb9a283, { roughness: 0.95 });
    const dark = materials.archDark;

    // Trodden ground: the lane along the front, a strip behind, and the
    // street that runs through the gateway.
    addBox(group, [HALF_LENGTH * 2 + 10, 0.1, 7], [0, 0.05, 8.5], materials.packedEarth);
    addBox(group, [HALF_LENGTH * 2 + 2, 0.1, 4], [0, 0.05, -7], materials.packedEarth);
    addBox(group, [6, 0.12, 44], [0, 0.06, 0], materials.packedEarth);

    // The two-storey range with a plaster string course and a plain parapet.
    addBox(group, [HALF_LENGTH * 2, WING_TOP, WING_HALF_DEPTH * 2], [0, WING_TOP / 2, 0], brick);
    addBox(group, [HALF_LENGTH * 2 + 0.3, 0.35, WING_HALF_DEPTH * 2 + 0.3], [0, 4.9, 0], plaster);
    addBox(group, [HALF_LENGTH * 2 + 0.4, 0.5, WING_HALF_DEPTH * 2 + 0.4], [0, WING_TOP - 0.1, 0], plaster);
    addBox(group, [HALF_LENGTH * 2 - 0.6, 0.5, WING_HALF_DEPTH * 2 - 0.6], [0, WING_TOP + 0.3, 0], darkBrick);

    // Five vaulted rooms either side of the gate: an arched recess below and
    // a small window in a plastered panel above, on both faces.
    for (const side of [-1, 1]) {
      for (let room = 0; room < 5; room++) {
        const x = side * (GATE_HALF + 2.9 + room * 4.4);
        for (const face of [1, -1]) {
          const turn = face === 1 ? 0 : Math.PI;
          const z = face * WING_HALF_DEPTH;
          addMesh(group, pointedArch(3.0, 3.9), darkBrick, [x, 0.3, z + face * 0.08], turn);
          addMesh(group, pointedArch(1.5, 2.6), dark, [x, 0.3, z + face * 0.14], turn);
          addMesh(group, pointedArch(2.3, 3.1), plaster, [x, 5.5, z + face * 0.08], turn);
          addMesh(group, rectPane(1.0, 1.4), dark, [x, 6.0, z + face * 0.14], turn);
        }
      }
    }

    // The three-storey gateway, its front corners cut off at an angle.
    const gatePlan: Array<[number, number]> = [
      [-GATE_HALF, GATE_BACK], [GATE_HALF, GATE_BACK], [GATE_HALF, GATE_FRONT - 2.2],
      [GATE_HALF - 2.2, GATE_FRONT], [-GATE_HALF + 2.2, GATE_FRONT], [-GATE_HALF, GATE_FRONT - 2.2],
    ];
    addPrism(group, gatePlan, 0, GATE_TOP, brick);
    addPrism(group, kit.offsetPolygon(gatePlan, 0.2), 12.3, 0.4, plaster);
    addPrism(group, kit.offsetPolygon(gatePlan, 0.25), GATE_TOP - 0.5, 0.5, plaster);
    addPrism(group, kit.offsetPolygon(gatePlan, -0.4), GATE_TOP, 0.6, darkBrick);
    // The alcove rising through two storeys, the entrance in it, the little
    // window in the half-dome, and the third-storey windows above.
    addMesh(group, pointedArch(8.6, 11.9), plaster, [0, 0, GATE_FRONT + 0.06]);
    addMesh(group, pointedArch(7.6, 11.3), darkBrick, [0, 0, GATE_FRONT + 0.12]);
    addMesh(group, pointedArch(3.6, 5.2), plaster, [0, 0, GATE_FRONT + 0.18]);
    addMesh(group, pointedArch(3.0, 4.8), dark, [0, 0, GATE_FRONT + 0.24]);
    addMesh(group, pointedArch(1.2, 1.7), dark, [0, 6.6, GATE_FRONT + 0.2]);
    for (const x of [-3.2, 0, 3.2]) {
      addMesh(group, pointedArch(2.2, 3.0), plaster, [x, 13.3, GATE_FRONT + 0.06]);
      addMesh(group, rectPane(1.1, 1.6), dark, [x, 13.7, GATE_FRONT + 0.12]);
    }
    // Courtyard side: a plainer arch over the passage.
    addMesh(group, pointedArch(6.0, 8.6), darkBrick, [0, 0, GATE_BACK - 0.08], Math.PI);
    addMesh(group, pointedArch(3.0, 4.8), dark, [0, 0, GATE_BACK - 0.14], Math.PI);
    for (const x of [-3.2, 0, 3.2]) addMesh(group, rectPane(1.1, 1.6), dark, [x, 13.7, GATE_BACK - 0.1], Math.PI);
    // Niches up the angled corners and the flanks of the gate.
    for (const side of [-1, 1]) {
      const turn = side * Math.PI / 4;
      const cx = side * (GATE_HALF - 1.1 + 0.07);
      const cz = GATE_FRONT - 1.1 + 0.07;
      for (const y of [1.2, 5.6, 9.2, 13.6]) addMesh(group, pointedArch(1.5, 2.6), plaster, [cx, y, cz], turn);
      addMesh(group, rectPane(1.0, 1.5), dark, [side * (GATE_HALF + 0.1), 13.7, 1.5], side * Math.PI / 2);
    }

    // Octagonal end towers, three storeys of plastered panels.
    const apothem = TOWER_RADIUS * Math.cos(Math.PI / 8);
    for (const side of [-1, 1]) {
      const x = side * HALF_LENGTH;
      const tower = addLathe(group, [[TOWER_RADIUS + 0.25, 0], [TOWER_RADIUS + 0.25, 0.8], [TOWER_RADIUS, 1.0], [TOWER_RADIUS, TOWER_TOP], [0, TOWER_TOP]], 8, [x, 0, TOWER_Z], brick, true);
      tower.rotation.y = Math.PI / 8;
      for (const [y, height] of [[4.9, 0.3], [9.4, 0.3], [TOWER_TOP - 0.3, 0.45]]) {
        const ring = addLathe(group, [[TOWER_RADIUS + 0.18, 0], [TOWER_RADIUS + 0.18, height], [0, height]], 8, [x, y, TOWER_Z], plaster, true);
        ring.rotation.y = Math.PI / 8;
      }
      for (let face = 0; face < 8; face++) {
        const angle = face * Math.PI / 4;
        const px = x + Math.sin(angle) * (apothem + 0.07);
        const pz = TOWER_Z + Math.cos(angle) * (apothem + 0.07);
        // Faces buried in the wing are skipped.
        if (Math.abs(pz) < WING_HALF_DEPTH && Math.abs(px) < HALF_LENGTH) continue;
        addMesh(group, pointedArch(1.7, 2.9), plaster, [px, 1.4, pz], angle);
        addMesh(group, pointedArch(1.7, 2.9), plaster, [px, 5.8, pz], angle);
        addMesh(group, rectPane(1.7, 2.2), plaster, [px, 10.6, pz], angle);
        if (face % 2 === 0) addMesh(group, rectPane(0.8, 1.4), dark, [x + Math.sin(angle) * (apothem + 0.13), 6.2, TOWER_Z + Math.cos(angle) * (apothem + 0.13)], angle);
      }
      kit.solid(x, TOWER_Z, TOWER_RADIUS, TOWER_TOP);
    }

    kit.setBoundsCollider(false);
    kit.solidTiles(-HALF_LENGTH, HALF_LENGTH, -WING_HALF_DEPTH, WING_HALF_DEPTH, WING_TOP + 0.6, 7);
    kit.solidTiles(-GATE_HALF, GATE_HALF, GATE_BACK, GATE_FRONT, GATE_TOP + 0.6, 7.5);
    // clearSite takes the world box of a turned rectangle, so the strips are
    // cleared in short pieces to keep the neighbours on this diagonal.
    const clearStrip = (x0: number, x1: number, z0: number, z1: number, cell = 6) => {
      const nx = Math.max(1, Math.round((x1 - x0) / cell));
      const nz = Math.max(1, Math.round((z1 - z0) / cell));
      const hx = (x1 - x0) / nx / 2;
      const hz = (z1 - z0) / nz / 2;
      for (let i = 0; i < nx; i++) {
        for (let j = 0; j < nz; j++) kit.clearSite(x0 + hx * (2 * i + 1), z0 + hz * (2 * j + 1), hx, hz);
      }
    };
    clearStrip(-HALF_LENGTH - 5, HALF_LENGTH + 5, WING_HALF_DEPTH, 12);
    clearStrip(-HALF_LENGTH - 1, HALF_LENGTH + 1, -9, -WING_HALF_DEPTH);
    clearStrip(-3, 3, -22, -9);
    clearStrip(-3, 3, 12, 22);
  },
};

export default landmark;
