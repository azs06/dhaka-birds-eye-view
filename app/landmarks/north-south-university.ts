// North South University (NSU), Bashundhara R/A
//
// The main campus is one connected block of pinkish-buff brick round a long
// paved plaza: the North Academic Building (NAC) on the north side and the
// South Academic Building (SAC) on the south, about nine storeys each, joined
// by glass skybridges across the plaza and closed at the west end by the
// lower front block, whose red-brick centre pavilion carries a colonnade and
// a segmental arched pediment lettered NORTH SOUTH UNIVERSITY. The plaza
// floor is painted with a big circular alpona, and each plaza facade opens in
// a multi-storey "sky portal" on tall piers.
//
// Footprint: OSM way 586535384 ("NAC (North Academic Building)"), which draws
// the whole ring NAC + front block + SAC round the plaza as one polygon
// (vertices below, in public/dhaka-map.json world metres). The plaza is the
// polygon's inner notch. The west end steps out in a 29.5 m wide centre bay
// (x 877.8–899) with set-back wings either side: that is taken to be the
// red-brick front pavilion of the photographs, facing west onto NSU Main
// Campus Road, where gate 1 (OSM node 6369749773) stands at the south-west
// corner. The NSU Auditorium (relation 9882171) north-east of the ring is
// left to the generic city, as are the IUB buildings east of the campus.
//
// Local +Z looks west (bearing 265°) out of the front pavilion; local +X
// points south (bearing 175°), toward SAC.
import { headingFromBearing, type LandmarkModule, type PlanPoint } from "./kit";

// World-metre outlines split from way 586535384.
const NAC: PlanPoint[] = [
  [925.9, -4830.8], [1028.1, -4839.9], [1025.7, -4866.5], [1000.3, -4864.3], [983.3, -4862.8], [957.7, -4860.5], [924.0, -4857.4],
];
const SAC: PlanPoint[] = [
  [927.5, -4813.0], [1040.8, -4823.1], [1039.3, -4839.8], [1070.5, -4842.6], [1071.1, -4836.8], [1082.9, -4837.9], [1086.4, -4799.5],
  [1008.6, -4792.6], [910.3, -4783.7],
];
// The front block: wings stepped back either side of the centre pavilion.
// The pavilion bay itself (x 877.8–899) is cut out here and built in red
// brick below, its back wall on a line parallel to its front.
const FRONT: PlanPoint[] = [
  [910.3, -4783.7], [909.8, -4788.8], [900.7, -4788.0], [899.3, -4803.6], [896.7, -4833.0], [896.2, -4835.8], [895.3, -4845.2],
  [905.3, -4846.1], [904.5, -4855.7], [924.0, -4857.4], [925.9, -4830.8], [927.5, -4813.0],
];
// The pavilion's front corners (the 29.5 m bay that steps out west).
const PAVILION_SOUTH: PlanPoint = [880.4, -4801.9];
const PAVILION_NORTH: PlanPoint = [877.8, -4831.4];
const PLAZA_CENTRE: PlanPoint = [983, -4827];

const STOREY = 3.65;
const MAIN_TOP = 4.6 + STOREY * 8; // nine storeys, ≈ 33.8 m
const FRONT_TOP = 4.6 + STOREY * 6; // the lower front block, ≈ 26.5 m

const landmark: LandmarkModule = {
  key: "north-south-university",
  label: "North South University",
  labelBn: "নর্থ সাউথ বিশ্ববিদ্যালয়",
  shortLabel: "NSU",
  lat: 23.815172,
  lon: 90.426166,
  altitude: 34,
  heading: headingFromBearing(265),
  clearingRadius: 105,
  extents: [42, 105],
  replacesOsmBuildingIds: [586535384],
  triangleBudget: 8000,
  plotGap: 8,
  inspectDistance: 190,
  build(kit) {
    const { group, addBox, addCylinder, addPrism, addMesh, addBays, wallEdges, rectPane, roundArch, materials } = kit;
    const brick = kit.material(0xc9ad9a, { roughness: 0.92 });
    const redBrick = kit.material(0x9c4a35, { roughness: 0.9 });
    const window = kit.litMaterial(0x34474c, 0.7);
    const roof = materials.roofTerrace;
    const recess = materials.recess;
    const glass = window;
    const cream = materials.cream;
    const gold = kit.material(0xc49a55, { roughness: 0.55, metalness: 0.3 });
    const plaza = materials.plazaRed;

    const L = (points: PlanPoint[]) => points.map(([x, z]) => kit.worldToLocal(x, z));
    const nac = L(NAC);
    const sac = L(SAC);
    const front = L(FRONT);

    // Solid cover of a plan polygon as small boxes, so the plaza between the
    // wings stays open to the bird.
    const inside = (poly: PlanPoint[], x: number, z: number) => {
      let hit = false;
      for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
        const [xi, zi] = poly[i];
        const [xj, zj] = poly[j];
        if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) hit = !hit;
      }
      return hit;
    };
    const fillSolid = (poly: PlanPoint[], top: number, cell: number) => {
      const xs = poly.map((p) => p[0]);
      const zs = poly.map((p) => p[1]);
      for (let x = Math.min(...xs) + cell / 2; x < Math.max(...xs); x += cell) {
        for (let z = Math.min(...zs) + cell / 2; z < Math.max(...zs); z += cell) {
          if (inside(poly, x, z)) kit.solidBox(x, z, cell / 2, cell / 2, top);
        }
      }
    };

    // A block: brick mass, a terrace roof inside a parapet, and a ribbon
    // window per storey between brick piers, as on every NSU facade.
    const block = (poly: PlanPoint[], top: number, storeys: number) => {
      addPrism(group, poly, 0, top + 1.1, brick);
      addPrism(group, kit.offsetPolygon(poly, -0.6), top + 0.4, 0.75, roof);
      const levels = [];
      for (let level = 1; level < storeys; level++) levels.push({ y: 4.6 + (level - 1) * STOREY + 0.9, opening: rectPane(5.4, 1.7) });
      addBays(group, wallEdges(poly), { bay: 7.4, storeys: levels, opening: window, minEdge: 9, margin: 1.4 });
      // Shaded ground-floor arcade line.
      addBays(group, wallEdges(poly), { bay: 7.4, storeys: [{ y: 0.3, opening: rectPane(6.2, 3.4) }], opening: recess, minEdge: 9, margin: 1.4 });
    };
    block(nac, MAIN_TOP, 9);
    block(sac, MAIN_TOP, 9);
    block(front, FRONT_TOP, 7);

    // The plaza: the painted circular alpona on the paving.
    const [px, pz] = kit.worldToLocal(...PLAZA_CENTRE);
    addCylinder(group, 7.6, 7.6, 0.08, [px, 0.08, pz], plaza, 32);
    addCylinder(group, 5.4, 5.4, 0.08, [px, 0.14, pz], gold, 28);
    addCylinder(group, 3.2, 3.2, 0.08, [px, 0.2, pz], plaza, 20);
    addCylinder(group, 1.3, 1.3, 0.08, [px, 0.26, pz], cream, 12);
    kit.clearSite(px, pz, 12, 52);

    // Glass skybridges across the plaza, with golden roof and floor bands.
    for (const bridge of [{ along: 990, y: 16 }, { along: 1018, y: 23.5 }]) {
      const [nx, nz] = kit.worldToLocal(bridge.along, -4838);
      const [sx, sz] = kit.worldToLocal(bridge.along + 1, -4818);
      const cx = (nx + sx) / 2;
      const cz = (nz + sz) / 2;
      const length = Math.hypot(sx - nx, sz - nz) + 1.2;
      const turn = Math.atan2(sx - nx, sz - nz);
      addBox(group, [3.6, 0.5, length], [cx, bridge.y, cz], gold).rotation.y = turn;
      addBox(group, [3.4, 2.9, length - 0.2], [cx, bridge.y + 1.7, cz], glass).rotation.y = turn;
      addBox(group, [3.9, 0.35, length], [cx, bridge.y + 3.3, cz], gold).rotation.y = turn;
    }

    // Sky portals: a five-storey void in the middle of each plaza facade,
    // with two tall brick piers standing in it.
    const portal = (poly: PlanPoint[], edgeIndex: number, along: number) => {
      const edge = wallEdges(poly)[edgeIndex];
      kit.addOnWall(group, edge, along, 11.9, rectPane(17, 19.5), recess, 0.3);
      for (const offset of [-4.3, 4.3]) {
        const x = edge.ax + edge.dx * (along + offset) + edge.nx * 0.9;
        const z = edge.az + edge.dz * (along + offset) + edge.nz * 0.9;
        addBox(group, [1.5, 19.4, 1.5], [x, 11.9 + 9.7, z], brick).rotation.y = edge.rotationY;
      }
    };
    portal(nac, 0, 52);
    portal(sac, 0, 60);

    // The front pavilion: red brick between the buff wings, a recessed glass
    // wall behind five tall piers, a lettered entablature and the segmental
    // pediment, with the university's white roundel.
    const [xS, sz0] = kit.worldToLocal(...PAVILION_SOUTH);
    const [xN, nz0] = kit.worldToLocal(...PAVILION_NORTH);
    const zf = Math.max(sz0, nz0);
    const width = Math.abs(xS - xN);
    const xc = (xS + xN) / 2;
    const PAV_TOP = 24.2;
    // Brick mass behind the colonnade (back to the front block), flanking
    // end walls and the glass wall.
    const back = kit.worldToLocal(898, -4818)[1];
    addBox(group, [width, PAV_TOP, zf - 4.6 - back + 1], [xc, PAV_TOP / 2, (zf - 4.6 + back - 1) / 2], redBrick);
    addPrism(group, [[xc - width / 2 + 0.6, zf - 5], [xc + width / 2 - 0.6, zf - 5], [xc + width / 2 - 0.6, back], [xc - width / 2 + 0.6, back]], PAV_TOP, 0.3, roof);
    for (const side of [-1, 1]) addBox(group, [2.6, PAV_TOP, 4.8], [xc + side * (width / 2 - 1.3), PAV_TOP / 2, zf - 2.4], redBrick);
    addMesh(group, rectPane(width - 5.6, 19.6), window, [xc, 0.6, zf - 4.5], 0);
    // Bands across the glass wall, one per floor.
    for (let level = 1; level < 5; level++) addBox(group, [width - 5.4, 0.45, 0.4], [xc, level * 4.2, zf - 4.3], redBrick);
    const pierSpan = width - 7;
    for (let index = 0; index < 5; index++) {
      const x = xc - pierSpan / 2 + (pierSpan * index) / 4;
      addBox(group, [1.7, 20.6, 1.7], [x, 10.3, zf - 1.2], redBrick);
      addBox(group, [2.1, 0.6, 2.1], [x, 0.3, zf - 1.2], roof);
    }
    // Entablature with the lettering band.
    addBox(group, [width + 0.4, 3.6, 4.8], [xc, 22.4, zf - 2.3], redBrick);
    addMesh(group, rectPane(width * 0.72, 0.9), cream, [xc, 22.0, zf + 0.12], 0);
    // Segmental pediment: an arc of brick on the entablature.
    const half = width / 2 + 0.2;
    const rise = 4.4;
    const radius = (half * half + rise * rise) / (2 * rise);
    const arc = new kit.THREE.Shape();
    arc.moveTo(half, 0);
    arc.absarc(0, rise - radius, radius, Math.atan2(radius - rise, half), Math.atan2(radius - rise, -half), false);
    arc.lineTo(half, 0);
    const pediment = new kit.THREE.ExtrudeGeometry(arc, { depth: 3.2, bevelEnabled: false, curveSegments: 10 });
    addMesh(group, pediment, redBrick, [xc, PAV_TOP, zf - 3.4], 0);
    addMesh(group, kit.discPane(0.9, 12), cream, [xc, PAV_TOP + 2.3, zf - 0.15], 0);
    // Front steps.
    addBox(group, [width - 4, 0.5, 4], [xc, 0.25, zf + 1.4], roof);

    // Tall blind arches on the buff front wings either side of the pavilion.
    for (const edge of wallEdges(front)) {
      if (edge.length < 12 || edge.length > 18 || edge.nz < 0.9) continue;
      kit.addOnWall(group, edge, edge.length / 2, 3, roundArch(5.2, 19), recess, 0.1);
    }

    // Colliders: each wing as a field of boxes (the plaza stays open), and
    // the pavilion's colonnade as its own box.
    kit.setBoundsCollider(false);
    fillSolid(nac, MAIN_TOP + 1.2, 6);
    fillSolid(sac, MAIN_TOP + 1.2, 6);
    fillSolid(front, FRONT_TOP + 1.2, 6);
    kit.solidBox(xc, (zf + back) / 2, width / 2, (zf - back) / 2, PAV_TOP + rise);
    const [rx, rz] = kit.worldToLocal(975, -4850);
    kit.setPerchTarget(rx, rz);
  },
};

export default landmark;
