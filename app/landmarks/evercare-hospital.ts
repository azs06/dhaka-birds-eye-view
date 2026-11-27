// Evercare Hospital Dhaka (Apollo Hospitals Dhaka until 2020), Bashundhara
// R/A Block E
//
// The hospital fills the plot between Sadek Road and the Block E roads, its
// main frontage on the north drive off STS Avenue. OSM way 506010001 (the
// building, tagged hospital, inside the hospital grounds way 974287986) is a
// wedge: a straight east wall running north–south for about 120 m, a 52 m
// south end, and a long west wall slanting to a point at the north. The
// photograph shows off-white rendered blocks of seven to nine storeys with
// deep framed square windows, strips of blue curtain glass, a taller block
// behind, a grey stone-clad sign slab standing proud of the front, and a
// low glass entrance pavilion with a curved roof. That is what is built.
// The task brief mentions cream-and-red walls and a helipad; neither is in
// the reference photo nor in OSM, so neither is drawn.
//
// Local +Z looks north (bearing 356°, square to the straight east wall);
// local +X points west.
import { headingFromBearing, type LandmarkModule, type PlanPoint } from "./kit";

// World-metre outline of way 506010001.
const OUTLINE: PlanPoint[] = [
  [1471.3, -4254.6], [1496.0, -4286.5], [1513.7, -4318.1], [1526.3, -4323.1], [1530.7, -4265.0], [1530.5, -4253.5], [1532.4, -4232.2],
  [1534.7, -4201.3], [1483.1, -4193.5], [1482.6, -4201.2], [1475.8, -4217.8],
];
// The taller block standing up along the east wall.
// Its east face stands 1.5 m behind the main wall.
const TOWER: PlanPoint[] = [[1508, -4298], [1527, -4298], [1528.9, -4262], [1530.6, -4216], [1508, -4216]];

const GROUND = 4.8;
const STOREY = 3.7;
const MAIN_TOP = GROUND + STOREY * 6; // seven storeys, 27 m
const TOWER_TOP = GROUND + STOREY * 8; // nine storeys, 34.4 m

const landmark: LandmarkModule = {
  key: "evercare-hospital",
  label: "Evercare Hospital Dhaka",
  labelBn: "এভারকেয়ার হাসপাতাল ঢাকা",
  shortLabel: "EVH",
  lat: 23.809932,
  lon: 90.431284,
  altitude: 35,
  heading: headingFromBearing(356),
  clearingRadius: 80,
  extents: [32, 65],
  replacesOsmBuildingIds: [506010001],
  triangleBudget: 4000,
  plotGap: 10,
  inspectDistance: 160,
  build(kit) {
    const { group, addBox, addPrism, addMesh, addBays, wallEdges, rectPane, materials } = kit;
    const render = kit.material(0xe8e6e0, { roughness: 0.85 });
    const window = kit.litMaterial(0x3b4b57, 0.7);
    const curtain = materials.skyGlass;
    const stone = kit.material(0x8e9399, { roughness: 0.8 });
    const roof = materials.roofGrey;
    const silver = materials.silverPanel;

    const L = (points: PlanPoint[]) => points.map(([x, z]) => kit.worldToLocal(x, z));
    const outline = L(OUTLINE);
    const tower = L(TOWER);

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

    const block = (poly: PlanPoint[], top: number, storeys: number, glassEvery: number, firstLevel = 0) => {
      addPrism(group, poly, 0, top + 1, render);
      addPrism(group, kit.offsetPolygon(poly, -0.6), top + 0.35, 0.8, roof);
      // Framed square windows, the frames standing proud of the wall.
      const levels = [];
      for (let level = firstLevel; level < storeys - 1; level++) levels.push({ y: GROUND + level * STOREY + 0.9, opening: rectPane(1.7, 1.7), surround: rectPane(2.5, 2.4) });
      addBays(group, wallEdges(poly), { bay: 4.6, storeys: levels, opening: window, surround: render, minEdge: 10, margin: 2.2 });
      // Strips of curtain glass up the longer walls.
      for (const edge of wallEdges(poly)) {
        if (edge.length < glassEvery) continue;
        for (const along of [0.33, 0.7]) kit.addOnWall(group, edge, edge.length * along, GROUND, rectPane(4.6, top - GROUND - 1), curtain, 0.4);
      }
      // Ground floor glazing.
      if (firstLevel === 0) addBays(group, wallEdges(poly), { bay: 8, storeys: [{ y: 0.4, opening: rectPane(6.4, 3.4) }], opening: materials.darkGlass, minEdge: 10, margin: 2 });
    };
    block(outline, MAIN_TOP, 7, 34);
    block(tower, TOWER_TOP, 9, 60, 6);
    // Rooftop plant rooms.
    const [px, pz] = kit.worldToLocal(1519, -4244);
    addBox(group, [12, 3.4, 16], [px, TOWER_TOP + 1.7 + 1, pz], render);
    const [qx, qz] = kit.worldToLocal(1494, -4222);
    addBox(group, [10, 2.8, 9], [qx, MAIN_TOP + 1.4 + 1, qz], render);

    // The front on the north drive: the stone-clad sign slab and the curved
    // glass entrance pavilion beside it, off the slanting west wall.
    const front = wallEdges(outline).filter((edge) => edge.length > 30 && edge.nx > 0).reduce((best, edge) => (edge.nz > best.nz ? edge : best));
    const at = (along: number, out: number): [number, number] => [front.ax + front.dx * along + front.nx * out, front.az + front.dz * along + front.nz * out];
    const [sx, sz] = at(front.length * 0.62, 2.2);
    addBox(group, [9, MAIN_TOP + 5, 2.6], [sx, (MAIN_TOP + 5) / 2, sz], stone).rotation.y = front.rotationY;
    addMesh(group, rectPane(1.8, 1.8), materials.whiteStone, [sx + front.nx * 1.36, MAIN_TOP - 1, sz + front.nz * 1.36], front.rotationY);
    addMesh(group, rectPane(6, 3.2), materials.whiteStone, [sx + front.nx * 1.36, MAIN_TOP - 6.5, sz + front.nz * 1.36], front.rotationY);
    // Entrance pavilion: glass walls under a curved silver roof.
    const [gx, gz] = at(front.length * 0.4, 6.5);
    addBox(group, [16, 6.2, 9], [gx, 3.1, gz], curtain).rotation.y = front.rotationY;
    const arc = new kit.THREE.Shape();
    arc.moveTo(-8.6, 0);
    arc.quadraticCurveTo(0, 2.6, 8.6, 0);
    arc.lineTo(8.6, -0.6);
    arc.quadraticCurveTo(0, 2.0, -8.6, -0.6);
    arc.lineTo(-8.6, 0);
    const canopy = new kit.THREE.ExtrudeGeometry(arc, { depth: 10, bevelEnabled: false, curveSegments: 8 });
    canopy.translate(0, 0, -5);
    addMesh(group, canopy, silver, [gx, 6.6, gz], front.rotationY + Math.PI / 2);

    kit.setBoundsCollider(false);
    fillSolid(outline, MAIN_TOP + 1, 6);
    fillSolid(tower, TOWER_TOP + 1, 6);
    kit.solidBox(sx, sz, 4.5, 4.5, MAIN_TOP + 5);
    kit.solidBox(gx, gz, 8, 8, 8);
    const [rx, rz] = kit.worldToLocal(1519, -4260);
    kit.setPerchTarget(rx, rz);
  },
};

export default landmark;
