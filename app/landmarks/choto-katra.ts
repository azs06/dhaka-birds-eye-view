// Choto Katra
//
// Shaista Khan's caravanserai of 1663, the smaller sister of Bara Katra. It
// was a 101 × 92 m enclosure of ranges round a court with gateways north and
// south and octagonal towers on the south corners, but today almost all of it
// is gone or swallowed by housing: what people know is the three-storey SOUTH
// GATEWAY that Hakim Habibur Rahman Lane passes through, its colonial top
// storey with a row of round-headed windows, and a few weathered stretches of
// the south range on either side, overgrown and hemmed in by shops. Only that
// is built here; the generic city fills the rest of the old quadrangle, as
// the real houses do.
//
// OpenStreetMap has no footprint, only the node 4715484647 "Choto Katra"
// (23.7129644, 90.3962138; Wikipedia gives 23.713, 90.3962). The katra's
// centre was put on the middle of the north–south run of Hakim Habibur Rahman
// Lane (way 478317262), turned to that run (bearing 19°/199°); the south gate
// stands on the lane 46 m (half the plan depth, from the Wikipedia article's
// 101.20 m × 92.05 m outside) south-south-west of it, and that point is the
// origin here. Gate depth (11.4 m range plus its projection) is from the
// article's inner/outer dimensions; heights are estimated from photographs.
//
// Local +Z is the south (river) front; +X runs east-south-east.
import { headingFromBearing, type LandmarkModule } from "./kit";

// Depth of the south range (court face at z = -RANGE_DEPTH, street face at 0).
const RANGE_DEPTH = 11.4;
const GATE_HALF = 7;
const GATE_FRONT = 3;
const GATE_BACK = -RANGE_DEPTH - 1;
const GATE_TOP = 15;

const landmark: LandmarkModule = {
  key: "choto-katra",
  label: "Choto Katra",
  labelBn: "ছোট কাটরা",
  shortLabel: "CKT",
  lat: 23.712647,
  lon: 90.395853,
  altitude: 16,
  heading: headingFromBearing(199),
  clearingRadius: 20,
  extents: [17, 8],
  triangleBudget: 3000,
  plotGap: 2,
  inspectDistance: 55,
  build(kit) {
    const { group, addBox, addMesh, addPrism, pointedArch, roundArch, rectPane, materials } = kit;
    // Old, soot-darkened brick and grimy limewash, as in the photographs.
    const brick = kit.material(0x86563f, { roughness: 0.95 });
    const darkBrick = kit.material(0x5c392a, { roughness: 1 });
    const plaster = kit.material(0xa89c84, { roughness: 0.95 });
    const limewash = kit.material(0xbcb39c, { roughness: 0.9 });
    const weeds = materials.canopy;
    const dark = materials.archDark;

    // A coarse pointed arch for the cells of the range.
    const cellArch = (width: number, height: number) => {
      const half = width / 2;
      const spring = height - width * 0.72;
      const shape = new kit.THREE.Shape();
      shape.moveTo(-half, 0);
      shape.lineTo(half, 0);
      shape.lineTo(half, spring);
      shape.quadraticCurveTo(half, height - width * 0.2, 0, height);
      shape.quadraticCurveTo(-half, height - width * 0.2, -half, spring);
      shape.lineTo(-half, 0);
      return new kit.THREE.ShapeGeometry(shape, 3);
    };

    // ---- Surviving stubs of the south range --------------------------------
    // Either side of the gate: a two-storey piece that still has its coping,
    // then a lower broken end where the range has fallen or been built over.
    // [inner x, outer x, top, has coping]
    const pieces: Array<[number, number, number, boolean]> = [
      [GATE_HALF - 0.2, 12.5, 8.4, true],
      [12.5, 16.5, 5.6, false],
      [-GATE_HALF + 0.2, -11, 8.4, true],
      [-11, -15, 6.4, false],
    ];
    for (const [a, b, top, coping] of pieces) {
      const x0 = Math.min(a, b);
      const x1 = Math.max(a, b);
      const sx = x1 - x0;
      const cx = (x0 + x1) / 2;
      const cz = -RANGE_DEPTH / 2;
      addBox(group, [sx, top, RANGE_DEPTH], [cx, top / 2, cz], brick);
      if (coping) {
        addBox(group, [sx + 0.3, 0.4, RANGE_DEPTH + 0.3], [cx, top - 0.1, cz], plaster);
        addBox(group, [sx - 0.6, 0.45, RANGE_DEPTH - 0.6], [cx, top + 0.3, cz], darkBrick);
        addBox(group, [sx + 0.3, 0.3, RANGE_DEPTH + 0.3], [cx, 4.4, cz], plaster);
      } else {
        // Broken top: a ragged step and a tuft of growth.
        addBox(group, [sx * 0.55, 1.1, RANGE_DEPTH * 0.7], [cx - Math.sign(cx) * sx * 0.2, top + 0.55, cz + 0.8], brick);
        addBox(group, [sx * 0.5, 0.7, RANGE_DEPTH * 0.45], [cx, top + 0.3, cz - 2], weeds);
      }
      // One arched cell per bay on the street and court faces.
      const count = Math.max(1, Math.round(sx / 5.2));
      const step = sx / count;
      for (let i = 0; i < count; i++) {
        const x = x0 + step * (i + 0.5);
        addMesh(group, cellArch(2.8, 3.4), darkBrick, [x, 0.3, 0.08]);
        addMesh(group, cellArch(1.4, 2.4), dark, [x, 0.3, 0.14]);
        addMesh(group, cellArch(2.4, 3.2), dark, [x, 0.3, -RANGE_DEPTH - 0.1], Math.PI);
        if (top > 7) {
          addMesh(group, rectPane(1.0, 1.3), dark, [x, 5.4, 0.1]);
          addMesh(group, rectPane(1.0, 1.3), dark, [x, 5.4, -RANGE_DEPTH - 0.1], Math.PI);
        }
      }
      kit.solidBox(cx, cz, sx / 2, RANGE_DEPTH / 2, top + 0.8);
    }
    // Growth along the coping of the full-height stubs.
    addBox(group, [3.2, 0.8, 4.5], [10.2, 9.1, -4], weeds);
    addBox(group, [2.6, 0.7, 3.5], [-9.4, 9.0, -7.5], weeds);

    // ---- South gateway -----------------------------------------------------
    // Three storeys with angled front corners: brick below with the tall
    // alcove, limewashed colonial top storey with three round-headed windows.
    const gatePlan: Array<[number, number]> = [
      [-GATE_HALF, GATE_BACK], [GATE_HALF, GATE_BACK], [GATE_HALF, GATE_FRONT - 2],
      [GATE_HALF - 2, GATE_FRONT], [-GATE_HALF + 2, GATE_FRONT], [-GATE_HALF, GATE_FRONT - 2],
    ];
    addPrism(group, gatePlan, 0, 10.6, brick);
    addPrism(group, kit.offsetPolygon(gatePlan, 0.05), 10.6, GATE_TOP - 10.6, limewash);
    addPrism(group, kit.offsetPolygon(gatePlan, 0.3), 10.5, 0.4, plaster);
    addPrism(group, kit.offsetPolygon(gatePlan, 0.5), GATE_TOP - 0.2, 0.45, plaster);
    addPrism(group, kit.offsetPolygon(gatePlan, -0.3), GATE_TOP + 0.25, 0.5, darkBrick);
    addBox(group, [3.4, 0.6, 2.4], [-3.2, GATE_TOP + 0.75, -6], weeds);
    // Street front: the great alcove with the passage at its foot.
    addMesh(group, pointedArch(7.6, 9.9), plaster, [0, 0, GATE_FRONT + 0.06]);
    addMesh(group, pointedArch(6.8, 9.4), darkBrick, [0, 0, GATE_FRONT + 0.12]);
    addMesh(group, pointedArch(3.4, 4.8), dark, [0, 0, GATE_FRONT + 0.2]);
    addMesh(group, pointedArch(1.1, 1.5), dark, [0, 5.8, GATE_FRONT + 0.18]);
    // Round-headed windows of the top storey, front and back.
    for (const x of [-2.6, 0, 2.6]) {
      addMesh(group, roundArch(1.9, 2.7), plaster, [x, 11.4, GATE_FRONT + 0.14]);
      addMesh(group, roundArch(1.4, 2.3), dark, [x, 11.5, GATE_FRONT + 0.2]);
      addMesh(group, roundArch(1.9, 2.7), plaster, [x, 11.4, GATE_BACK - 0.1], Math.PI);
      addMesh(group, roundArch(1.4, 2.3), dark, [x, 11.5, GATE_BACK - 0.15], Math.PI);
    }
    // Small windows in the angled corners and the sides above the range.
    for (const side of [-1, 1]) {
      const cx = side * (GATE_HALF - 1);
      const cz = GATE_FRONT - 1;
      const turn = side * Math.PI / 4;
      addMesh(group, roundArch(1.0, 1.7), dark, [cx + side * 0.15, 11.6, cz + 0.15], turn);
      addMesh(group, pointedArch(1.0, 1.6), dark, [cx + side * 0.15, 6.2, cz + 0.15], turn);
      addMesh(group, roundArch(1.2, 2.0), dark, [side * (GATE_HALF + 0.1), 11.5, -5], side * Math.PI / 2);
    }
    // Court side: the inner arch of the passage.
    addMesh(group, pointedArch(5.6, 7.4), darkBrick, [0, 0, GATE_BACK - 0.08], Math.PI);
    addMesh(group, pointedArch(3.4, 4.8), dark, [0, 0, GATE_BACK - 0.14], Math.PI);
    kit.solidTiles(-GATE_HALF, GATE_HALF, GATE_BACK, GATE_FRONT, GATE_TOP + 0.8, 7);

    kit.setBoundsCollider(false);
    kit.setPerchTarget(0, -4);
  },
};

export default landmark;
