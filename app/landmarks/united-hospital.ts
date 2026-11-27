// United Hospital, Gulshan 2
//
// The hospital stands on the west shore of Gulshan–Baridhara lake between
// Road 71 and Road 72. In plan (OSM way 974549277, "United Hospital
// Limited") it is two near-square wings, each about 39 m a side and turned
// 36° off north, set corner to corner and joined by a narrower waist — the
// glazed atrium inside. Photographs show buff brick walls with deep punched
// windows of green glass on eight storeys, a glazed bay rising up the middle
// of the facade, and a recessed glass top floor whose gilded columns carry a
// broad flat overhanging roof (the roof edge is floodlit at night, seen
// across the lake). The red UNITED HOSPITAL sign sits over a brick porch at
// the road entrance.
//
// The snapshot height (15.8 m) is too low; storeys are counted from the
// photographs (ground floor + seven + the glass top floor ≈ 34 m).
//
// Local +Z looks north-west (bearing 306°), square to the wings, toward the
// entrance road; local +X points north-east along the wings.
import { headingFromBearing, type LandmarkModule, type PlanPoint } from "./kit";

// World-metre outline of way 974549277, split into wings and waist.
const WING_NORTH: PlanPoint[] = [[-126.6, -3711.1], [-103.2, -3742.4], [-71.6, -3719.1], [-86.8, -3698.7], [-102.7, -3693.6]];
const WING_SOUTH: PlanPoint[] = [[-84.6, -3684.9], [-54.8, -3663.5], [-82.7, -3625.2], [-121.8, -3653.2], [-101.0, -3681.8]];
const WAIST: PlanPoint[] = [[-102.7, -3693.6], [-86.8, -3698.7], [-84.6, -3684.9], [-101.0, -3681.8]];
const OUTLINE: PlanPoint[] = [
  [-126.6, -3711.1], [-103.2, -3742.4], [-71.6, -3719.1], [-86.8, -3698.7], [-84.6, -3684.9], [-54.8, -3663.5], [-82.7, -3625.2],
  [-121.8, -3653.2], [-101.0, -3681.8], [-102.7, -3693.6],
];

const GROUND = 4.6;
const STOREY = 3.6;
const BRICK_TOP = GROUND + STOREY * 7; // 29.8
const GLASS_TOP = BRICK_TOP + 4.2; // recessed top floor
const ROOF_TOP = GLASS_TOP + 1.1;

const landmark: LandmarkModule = {
  key: "united-hospital",
  label: "United Hospital",
  labelBn: "ইউনাইটেড হাসপাতাল",
  shortLabel: "UNH",
  lat: 23.804803,
  lon: 90.415591,
  altitude: 35,
  heading: headingFromBearing(306),
  clearingRadius: 70,
  extents: [30, 30],
  replacesOsmBuildingIds: [974549277],
  triangleBudget: 4000,
  plotGap: 8,
  inspectDistance: 140,
  build(kit) {
    const { group, addBox, addCylinder, addPrism, addMesh, addBays, wallEdges, rectPane, materials } = kit;
    const brick = kit.material(0xcbb29d, { roughness: 0.92 });
    const window = kit.litMaterial(0x3f6e69, 0.75);
    const glass = materials.atriumGlass;
    const gold = kit.material(0xc9a35a, { roughness: 0.45, metalness: 0.35 });
    const roof = kit.material(0xe6dccb, { roughness: 0.8 });
    const red = kit.material(0xc0302a, { roughness: 0.7 });

    const L = (points: PlanPoint[]) => points.map(([x, z]) => kit.worldToLocal(x, z));
    const wings = [L(WING_NORTH), L(WING_SOUTH)];
    const waist = L(WAIST);
    const outline = L(OUTLINE);

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

    for (const wing of wings) {
      // Brick body with a plinth band and a cornice band under the glass floor.
      addPrism(group, wing, 0, BRICK_TOP, brick);
      addPrism(group, kit.offsetPolygon(wing, 0.25), GROUND - 0.5, 0.5, brick);
      addPrism(group, kit.offsetPolygon(wing, 0.3), BRICK_TOP - 0.6, 0.6, brick);
      // Deep punched windows, one per bay on each storey.
      const levels = [];
      for (let level = 0; level < 7; level++) levels.push({ y: GROUND + level * STOREY + 0.8, opening: rectPane(2.3, 1.9) });
      levels.push({ y: 1.0, opening: rectPane(2.3, 2.2) });
      addBays(group, wallEdges(wing), { bay: 4.6, storeys: levels, opening: window, minEdge: 12, margin: 2 });
      // The glazed bay rising up the middle of the two long outer faces.
      for (const edge of wallEdges(wing)) {
        if (edge.length < 35) continue;
        kit.addOnWall(group, edge, edge.length / 2, GROUND + STOREY * 4, rectPane(9.5, BRICK_TOP - GROUND - STOREY * 4), glass, 0.32);
      }
      // Recessed glass top floor with gilded columns round its edge.
      addPrism(group, kit.offsetPolygon(wing, -2.2), BRICK_TOP, GLASS_TOP - BRICK_TOP, glass);
      for (const edge of wallEdges(wing)) {
        const count = Math.max(1, Math.round(edge.length / 12));
        for (let index = 0; index <= count; index++) {
          if (index === count && edge.length < 20) continue;
          const along = (edge.length * index) / count;
          addCylinder(group, 0.55, 0.55, GLASS_TOP - BRICK_TOP, [edge.ax + edge.dx * along - edge.nx * 0.6, (BRICK_TOP + GLASS_TOP) / 2, edge.az + edge.dz * along - edge.nz * 0.6], gold, 6);
        }
      }
    }
    // The atrium waist: glass between the wings.
    addPrism(group, waist, 0, GLASS_TOP, glass);
    // The broad overhanging flat roof over the whole building, its soffit gold.
    addPrism(group, kit.offsetPolygon(outline, 2.4), GLASS_TOP, 0.45, gold);
    addPrism(group, kit.offsetPolygon(outline, 2.6), GLASS_TOP + 0.45, ROOF_TOP - GLASS_TOP - 0.45, roof);
    // Rooftop plant room on the north wing.
    const [cx, cz] = kit.worldToLocal(-99, -3718);
    addBox(group, [9, 3.2, 7], [cx, ROOF_TOP + 1.6, cz], roof);

    // Entrance porch with the red UNITED HOSPITAL sign on the road face of
    // the south wing.
    const entrance = wallEdges(wings[1]).reduce((best, edge) => (edge.nz > best.nz ? edge : best));
    const ex = entrance.ax + entrance.dx * entrance.length * 0.55 + entrance.nx * 3.2;
    const ez = entrance.az + entrance.dz * entrance.length * 0.55 + entrance.nz * 3.2;
    addBox(group, [13, 4.6, 6.4], [ex, 2.3, ez], brick).rotation.y = entrance.rotationY;
    addBox(group, [11, 1.3, 0.3], [ex + entrance.nx * 3.3, 4.1, ez + entrance.nz * 3.3], red).rotation.y = entrance.rotationY;
    addMesh(group, rectPane(9, 2.6), materials.darkGlass, [ex + entrance.nx * 3.25, 0.4, ez + entrance.nz * 3.25], entrance.rotationY);

    kit.setBoundsCollider(false);
    for (const wing of wings) fillSolid(wing, ROOF_TOP, 5);
    fillSolid(waist, ROOF_TOP, 4);
    kit.solidBox(ex, ez, 6.5, 6.5, 4.6);
  },
};

export default landmark;
