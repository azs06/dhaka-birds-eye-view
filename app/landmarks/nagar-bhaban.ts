// Nagar Bhaban (Dhaka South City Corporation)
//
// The city hall at Fulbaria: a long fifteen-storey slab of grey-buff concrete
// between pairs of taller, square-capped stair towers, with a clock tower on
// the middle of the roof. The street front stands on a tall arcade under a
// balcony band, and close-set vertical fins run up the office floors above.
// A lawn lies between the front and Phoenix Road, entered through a big
// single-arched gateway on the building's axis.
//
// OSM way 499445072 ("নগর ভবন", 18 levels) gives the plan, used here part by
// part: a 105 m × 36 m slab on a 92° axis, a 21 m × 76 m cross range at each
// end (the stair-tower pairs), a 21 m porch and rear core on the centre line
// and a small annex on the west end. Heights are read from the photographs
// (Commons: "Dhaka Nagar Bhaban (23334123713).jpg", "Nagar bhaban, dhaka
// 2.jpg", and two panoramas of the lawn), not surveyed. Those photographs
// show a straight, grey-buff building, so it is built that way. The gateway
// has no OSM tags of its own, but two Microsoft building footprints in the
// snapshot (1297720381, 1297720382) sit exactly on the centre line at the
// Phoenix Road edge of the lawn, where the reference shows the arch framing
// the porch and clock tower: the gateway is built there and replaces them.
//
// The lawn is on the north side: Phoenix Road runs 60 m north of the front,
// while the Mayor Hanif Flyover passes only 30 m behind the south wings.
// Local +Z therefore looks north to Phoenix Road, and +X runs west.
import { headingFromBearing, type LandmarkModule } from "./kit";

const ROOF = 58;
const TOWER_TOP = 66;
const CLOCK_TOP = 72;
const ARCADE_TOP = 17;
const FINS_BOTTOM = 23;
const FINS_TOP = 52;

type Rect = { x: number; z: number; sx: number; sz: number };

const landmark: LandmarkModule = {
  key: "nagar-bhaban",
  label: "Nagar Bhaban",
  labelBn: "নগর ভবন",
  shortLabel: "NGB",
  lat: 23.723807,
  lon: 90.408549,
  altitude: CLOCK_TOP,
  heading: headingFromBearing(2),
  clearingRadius: 95,
  extents: [76, 42],
  // 1297720381 and 1297720382 are Microsoft footprints of the gateway itself.
  replacesOsmBuildingIds: [499445072, 1297720381, 1297720382],
  triangleBudget: 6000,
  build(kit) {
    const { group, addBox, addMesh, rectPane, roundArch, materials } = kit;
    const THREE = kit.THREE;
    const body = kit.material(0xc3bba6, { roughness: 0.9 });
    const trim = kit.material(0xd8d1bd, { roughness: 0.88 });
    const shade = kit.material(0xa59d8a, { roughness: 0.92 });
    const dark = materials.archDark;

    // A rectangle of the plan from two opposite OSM corners (world metres).
    const rect = (ax: number, az: number, bx: number, bz: number): Rect => {
      const [x0, z0] = kit.worldToLocal(ax, az);
      const [x1, z1] = kit.worldToLocal(bx, bz);
      return { x: (x0 + x1) / 2, z: (z0 + z1) / 2, sx: Math.abs(x1 - x0), sz: Math.abs(z1 - z0) };
    };
    const mass = (r: Rect, bottom: number, top: number, material = body) =>
      addBox(group, [r.sx, top - bottom, r.sz], [r.x, (top + bottom) / 2, r.z], material);
    const solid = (r: Rect, top: number) => kit.solidBox(r.x, r.z, r.sx / 2, r.sz / 2, top);

    const slab = rect(-862.7, 5253.0, -757.8, 5292.0);
    const westRange = rect(-883.3, 5235.0, -862.4, 5310.9);
    const eastRange = rect(-756.5, 5238.0, -735.9, 5316.6);
    const porch = rect(-821.4, 5240.7, -801.1, 5254.4);
    const rearCore = rect(-822.8, 5302.3, -800.2, 5288.7);
    const annex = rect(-896.7, 5280.2, -885.0, 5265.2);

    const front = slab.z + slab.sz / 2;
    const back = slab.z - slab.sz / 2;
    const length = slab.sx;

    // The slab, its roof and cornice.
    mass(slab, 0, ROOF);
    addBox(group, [length + 0.6, 1.2, slab.sz + 1.6], [slab.x, ROOF - 1.6, slab.z], trim);
    addBox(group, [length - 2, 0.2, slab.sz - 2], [slab.x, ROOF + 0.1, slab.z], materials.roofGrey);

    // Office floors: a dark window field behind fins and floor bands, with a
    // row of separate windows above it under the cornice.
    const face = (z: number, turn: number, pitch: number) => {
      const out = turn === 0 ? 1 : -1;
      addMesh(group, rectPane(length - 3, FINS_TOP - FINS_BOTTOM), dark, [slab.x, FINS_BOTTOM, z + out * 0.1], turn);
      for (let x = -length / 2 + 1.5; x <= length / 2 - 1.4; x += pitch) {
        addBox(group, [0.7, FINS_TOP - FINS_BOTTOM + 0.6, 1.1], [slab.x + x, (FINS_TOP + FINS_BOTTOM) / 2, z + out * 0.5], body);
      }
      for (let y = FINS_BOTTOM + 3.6; y < FINS_TOP - 1; y += 3.6) {
        addBox(group, [length - 3, 0.9, 0.5], [slab.x, y, z + out * 0.3], shade);
      }
      for (let x = -length / 2 + 4; x <= length / 2 - 3.9; x += pitch * 2) {
        addMesh(group, rectPane(2.2, 2.2), dark, [slab.x + x, FINS_TOP + 1.2, z + out * 0.1], turn);
      }
      // The plain balcony bay on the centre line.
      addBox(group, [7, FINS_TOP - FINS_BOTTOM + 0.6, 1.6], [slab.x, (FINS_TOP + FINS_BOTTOM) / 2, z + out * 0.8], trim);
      for (let y = FINS_BOTTOM + 1.2; y < FINS_TOP - 2; y += 3.6) {
        addMesh(group, rectPane(4.6, 1.8), dark, [slab.x, y, z + out * 1.65], turn);
      }
    };
    face(front, 0, 3.4);
    face(back, Math.PI, 6.8);

    // The street front's base: a tall arcade standing forward of the slab,
    // under a balcony band of small arches.
    const ARCADE_DEPTH = 5;
    addBox(group, [length, ARCADE_TOP, ARCADE_DEPTH], [slab.x, ARCADE_TOP / 2, front + ARCADE_DEPTH / 2], body);
    addBox(group, [length + 0.4, 1.1, ARCADE_DEPTH + 1], [slab.x, ARCADE_TOP + 0.55, front + ARCADE_DEPTH / 2], trim);
    addBox(group, [length, 4.2, ARCADE_DEPTH - 1.6], [slab.x, ARCADE_TOP + 3.2, front + (ARCADE_DEPTH - 1.6) / 2], body);
    addBox(group, [length + 0.4, 0.8, ARCADE_DEPTH - 0.8], [slab.x, ARCADE_TOP + 5.7, front + (ARCADE_DEPTH - 1.6) / 2], trim);
    const tallArch = roundArch(4.6, 13.2);
    const smallArch = roundArch(1.7, 2.6);
    for (let bay = 0; bay < 14; bay++) {
      const x = -length / 2 + (bay + 0.5) * (length / 14);
      // The porch covers the middle bays.
      if (Math.abs(x + slab.x - porch.x) > porch.sx / 2 + 1) {
        addMesh(group, tallArch, dark, [slab.x + x, 1.2, front + ARCADE_DEPTH + 0.1]);
      }
      for (const offset of [-2.4, 0, 2.4]) {
        addMesh(group, smallArch, dark, [slab.x + x + offset, ARCADE_TOP + 1.9, front + ARCADE_DEPTH - 1.5]);
      }
    }
    // Rear base: plain, with one dark band per storey.
    for (let storey = 0; storey < 5; storey++) {
      addMesh(group, rectPane(length - 3, 2), dark, [slab.x, 1.4 + storey * 4.2, back - 0.1], Math.PI);
    }

    // The entrance porch with its single great arch, and the rear core.
    mass(porch, 0, 13.5, trim);
    addBox(group, [porch.sx + 0.8, 1, porch.sz + 0.8], [porch.x, 14, porch.z], body);
    addMesh(group, roundArch(9, 10.5), dark, [porch.x, 0.6, porch.z + porch.sz / 2 + 0.1]);
    for (const side of [-1, 1]) {
      addMesh(group, roundArch(5, 9), dark, [porch.x + side * (porch.sx / 2 + 0.1), 0.6, porch.z], side * Math.PI / 2);
    }
    mass(rearCore, 0, ROOF);
    addMesh(group, rectPane(3, ROOF - 10), dark, [rearCore.x, 5, rearCore.z - rearCore.sz / 2 - 0.1], Math.PI);

    // The end ranges: a tower at each end of each, joined by a link no
    // higher than the slab.
    for (const range of [westRange, eastRange]) {
      const out = Math.sign(range.x - slab.x);
      const north = range.z + range.sz / 2;
      const south = range.z - range.sz / 2;
      mass({ x: range.x - out, z: slab.z, sx: range.sx, sz: slab.sz - 2 }, 0, ROOF);
      for (let y = 6; y < ROOF - 4; y += 3.6) {
        addMesh(group, rectPane(slab.sz - 8, 1.7), dark, [range.x + out * (range.sx / 2 - 0.9), y, slab.z], out * Math.PI / 2);
      }
      for (const [z0, z1] of [[front - 1, north], [south, back + 1]]) {
        const tower: Rect = { x: range.x, z: (z0 + z1) / 2, sx: range.sx, sz: z1 - z0 };
        mass(tower, 0, TOWER_TOP);
        addBox(group, [tower.sx + 1.4, 1.4, tower.sz + 1.4], [tower.x, TOWER_TOP + 0.7, tower.z], trim);
        addBox(group, [tower.sx - 1.5, 1, tower.sz - 1.5], [tower.x, TOWER_TOP + 1.9, tower.z], body);
        // A slit of stair windows up the outer face and the end face.
        const end = z1 === north ? 1 : -1;
        addMesh(group, rectPane(2.4, TOWER_TOP - 12), dark, [tower.x + out * (tower.sx / 2 + 0.1), 6, tower.z], out * Math.PI / 2);
        addMesh(group, rectPane(2.4, TOWER_TOP - 12), dark, [tower.x, 6, tower.z + end * (tower.sz / 2 + 0.1)], end === 1 ? 0 : Math.PI);
        solid(tower, TOWER_TOP + 2);
      }
    }
    mass(annex, 0, 9, trim);
    addMesh(group, rectPane(annex.sx - 2, 1.8), dark, [annex.x, 5.4, annex.z + annex.sz / 2 + 0.1]);

    // The clock tower.
    addBox(group, [17, 4, 17], [slab.x, ROOF + 2, slab.z], body);
    addBox(group, [12.5, CLOCK_TOP - ROOF - 5.2, 12.5], [slab.x, (CLOCK_TOP - 1.2 + ROOF + 4) / 2, slab.z], trim);
    addBox(group, [14.2, 1.2, 14.2], [slab.x, CLOCK_TOP - 0.6, slab.z], body);
    const clockFace = kit.discPane(2.7, 20);
    const clockRim = kit.discPane(3.2, 20);
    for (const [turn, dx, dz] of [[0, 0, 1], [Math.PI, 0, -1], [Math.PI / 2, 1, 0], [-Math.PI / 2, -1, 0]]) {
      addMesh(group, clockRim, materials.recess, [slab.x + dx * 6.32, ROOF + 4.7, slab.z + dz * 6.32], turn);
      addMesh(group, clockFace, materials.whiteStone, [slab.x + dx * 6.4, ROOF + 5.2, slab.z + dz * 6.4], turn);
    }

    // The lawn, the drive up its middle, and the gateway on Phoenix Road.
    const [lawnX0, lawnZ0] = kit.worldToLocal(-880, 5233);
    const [lawnX1, lawnZ1] = kit.worldToLocal(-740, 5189.5);
    const lawnX = (lawnX0 + lawnX1) / 2;
    const lawnZ = (lawnZ0 + lawnZ1) / 2;
    const lawnSx = Math.abs(lawnX1 - lawnX0);
    const lawnSz = Math.abs(lawnZ1 - lawnZ0);
    addBox(group, [lawnSx, 0.1, lawnSz], [lawnX, 0.05, lawnZ], materials.lawn);
    addBox(group, [9, 0.16, lawnSz + 6], [porch.x, 0.08, lawnZ], materials.roofTerrace);
    for (const side of [-1, 1]) {
      for (const along of [-0.3, 0.05, 0.4]) kit.addPalm(group, porch.x + side * 9, lawnZ + along * lawnSz, 13, 0.03, side + along);
      kit.addTree(group, porch.x + side * 52, lawnZ + 4, 6, 7);
      kit.addTree(group, porch.x + side * 34, lawnZ - 6, 5, 6.5, materials.lightCanopy);
    }
    kit.clearSite(lawnX, lawnZ, lawnSx / 2 + 2, lawnSz / 2 + 2);

    const gateZ = lawnZ + lawnSz / 2 + 2.5;
    const GATE_TOP = 11;
    const gateShape = new THREE.Shape();
    gateShape.moveTo(-7, 0);
    gateShape.lineTo(7, 0);
    gateShape.lineTo(7, GATE_TOP - 1.5);
    gateShape.lineTo(-7, GATE_TOP - 1.5);
    gateShape.lineTo(-7, 0);
    const opening = new THREE.Path();
    opening.moveTo(-4.3, 0);
    opening.lineTo(-4.3, 4.2);
    opening.absarc(0, 4.2, 4.3, Math.PI, 0, true);
    opening.lineTo(4.3, 0);
    opening.lineTo(-4.3, 0);
    gateShape.holes.push(opening);
    addMesh(group, new THREE.ExtrudeGeometry(gateShape, { depth: 1.8, bevelEnabled: false, curveSegments: 8 }), body, [porch.x, 0, gateZ - 0.9]);
    for (const side of [-1, 1]) {
      addBox(group, [3.6, GATE_TOP, 3.2], [porch.x + side * 7.4, GATE_TOP / 2, gateZ], body);
      addBox(group, [4.6, 0.9, 4.2], [porch.x + side * 7.4, GATE_TOP + 0.45, gateZ], trim);
      kit.solid(porch.x + side * 7.4, gateZ, 2, GATE_TOP + 1);
      // The low screen walls either side, pierced by small arches.
      addBox(group, [22, 4.4, 1.2], [porch.x + side * 20.2, 2.2, gateZ], body);
      addBox(group, [22.4, 0.5, 1.6], [porch.x + side * 20.2, 4.65, gateZ], trim);
      for (let arch = 0; arch < 6; arch++) {
        for (const faceSide of [1, -1]) {
          addMesh(group, roundArch(1.5, 2.3), dark, [porch.x + side * (11.4 + arch * 3.5), 1.4, gateZ + faceSide * 0.66], faceSide === 1 ? 0 : Math.PI);
        }
      }
      kit.solidTiles(Math.min(porch.x + side * 9.2, porch.x + side * 31.2), Math.max(porch.x + side * 9.2, porch.x + side * 31.2), gateZ - 0.6, gateZ + 0.6, 4.9, 12);
    }
    addBox(group, [16, 0.8, 2.4], [porch.x, GATE_TOP - 1.1, gateZ], trim);

    kit.setBoundsCollider(false);
    solid({ x: slab.x, z: slab.z + ARCADE_DEPTH / 2, sx: slab.sx, sz: slab.sz + ARCADE_DEPTH }, ROOF);
    solid({ x: westRange.x, z: slab.z, sx: westRange.sx, sz: slab.sz }, ROOF);
    solid({ x: eastRange.x, z: slab.z, sx: eastRange.sx, sz: slab.sz }, ROOF);
    solid(porch, 14.5);
    solid(rearCore, ROOF);
    solid(annex, 9);
    kit.solid(slab.x, slab.z, 7.2, CLOCK_TOP);
  },
};

export default landmark;
