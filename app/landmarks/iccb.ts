// International Convention City Bashundhara (ICCB), Kuril
//
// The convention and exhibition grounds north of the Kuril end of the
// Purbachal Expressway (300 Feet Road): a cluster of big flat-roofed halls —
// Nabaratri, Hall of Fame, Jolshiri and the rest — clad in light grey metal
// panels over a board-marked concrete base, with tall glass entrance fronts
// and rounded roof edges, set among car parks lined with tall lamp posts.
// The main gate on the south is a broad concrete portal with the name in
// steel letters along its beam and the iccb logo on the gatehouse walls;
// behind it a twin-carriageway drive runs north between the halls.
//
// OSM tags only the ICCB node (5998293476, 23.82760 90.42718), which lies on
// that drive. The halls are the untagged OSM buildings round it, all turned
// 13° like the drive (ways 501671997, 501671872, 501387657, 501387658,
// 501671874 and 1452571783), with the car parks (amenity=parking ways
// 636026806–636026811) and the drive's two service carriageways (ways
// 636026812 and 636026813) between them; the gate stands where the tertiary
// entry road (way 1068718995) reaches the drive. None of these buildings is
// in the city snapshot. Heights are from the photographs: 14–20 m. The task
// brief describes white vaulted roofs, which the photographs do not show
// (the roofs are flat behind rounded parapets), so they are not built.
//
// Local +Z looks SSE (bearing 167°) down the drive to the gate; local +X
// points ENE (bearing 77°).
import { headingFromBearing, type LandmarkModule, type PlanPoint } from "./kit";

type Hall = { points: PlanPoint[]; top: number };
// World-metre outlines (public/dhaka-map.json frame) of the halls.
const HALLS: Hall[] = [
  // The biggest hall, at the north-west end of the drive.
  { points: [[946.1, -6392.0], [982.3, -6400.2], [1000.3, -6321.2], [964.1, -6313.1]], top: 20 },
  // North-east hall, with its entrance block on the south face.
  {
    points: [[1131.4, -6284.6], [1133.2, -6277.0], [1105.8, -6270.8], [1104.0, -6278.5], [1078.5, -6272.7], [1072.2, -6300.0], [1140.5, -6315.6], [1146.8, -6288.1]],
    top: 16,
  },
  { points: [[1014.8, -6199.3], [1043.0, -6208.3], [1065.0, -6140.6], [1036.8, -6131.5]], top: 18 },
  { points: [[969.9, -6152.8], [997.3, -6161.4], [1010.1, -6121.6], [982.6, -6113.0]], top: 14 },
  { points: [[1142.2, -6179.8], [1209.8, -6194.9], [1216.4, -6165.8], [1148.8, -6150.8]], top: 16 },
  { points: [[898.3, -6145.5], [953.8, -6158.4], [962.1, -6138.4], [965.4, -6111.5], [907.7, -6097.6], [907.7, -6128.0]], top: 14 },
];
const PARKING: PlanPoint[][] = [
  [[1094.2, -6176.3], [1127.5, -6183.8], [1137.8, -6142.5], [1104.6, -6134.3]],
  [[1027.3, -6280.4], [1043.4, -6284.8], [1060.1, -6226.5], [1043.4, -6223.6]],
  [[960.7, -6304.1], [1035.4, -6319.5], [1042.4, -6295.3], [990.9, -6283.1], [970.0, -6288.6], [962.7, -6292.8]],
  [[1059.5, -6304.2], [1082.4, -6310.7], [1067.5, -6371.1], [1042.6, -6376.1], [1046.6, -6356.9]],
  [[1151.0, -6360.9], [1176.2, -6347.6], [1159.8, -6315.4], [1119.6, -6306.8]],
  [[994.6, -6394.9], [1007.0, -6396.4], [1031.6, -6351.5], [1037.4, -6331.8], [1011.5, -6325.3]],
];
// The drive: west and east carriageways from the gate north.
const DRIVE_WEST: PlanPoint[] = [[1092, -6133], [1049, -6290], [1039, -6325]];
const DRIVE_EAST: PlanPoint[] = [[1104, -6129], [1091, -6176], [1076, -6228], [1069, -6253], [1057, -6292], [1047, -6327]];
const GATE: PlanPoint = [1098, -6131];

const landmark: LandmarkModule = {
  key: "iccb",
  label: "International Convention City Bashundhara",
  labelBn: "আন্তর্জাতিক কনভেনশন সিটি বসুন্ধরা",
  shortLabel: "ICB",
  lat: 23.8276,
  lon: 90.42718,
  altitude: 20,
  heading: headingFromBearing(167),
  clearingRadius: 150,
  extents: [150, 140],
  triangleBudget: 8000,
  plotGap: 10,
  inspectDistance: 300,
  build(kit) {
    const { group, addBox, addPrism, addMesh, addSweptBox, addCylinder, wallEdges, rectPane, materials } = kit;
    const panel = kit.material(0xa2a7ab, { roughness: 0.55, metalness: 0.25 });
    const joint = materials.plantGrey;
    const concrete = materials.boardConcrete;
    const glass = materials.darkGlass;
    const roof = kit.material(0xb4b8bb, { roughness: 0.7 });
    const asphalt = materials.wornAsphalt;

    const L = (points: PlanPoint[]) => points.map(([x, z]) => kit.worldToLocal(x, z));

    const inside = (poly: PlanPoint[], x: number, z: number) => {
      let hit = false;
      for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
        const [xi, zi] = poly[i];
        const [xj, zj] = poly[j];
        if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) hit = !hit;
      }
      return hit;
    };
    const bbox = (poly: PlanPoint[]) => {
      const xs = poly.map((p) => p[0]);
      const zs = poly.map((p) => p[1]);
      return { x0: Math.min(...xs), x1: Math.max(...xs), z0: Math.min(...zs), z1: Math.max(...zs) };
    };
    const fillSolid = (poly: PlanPoint[], top: number, cell: number) => {
      const { x0, x1, z0, z1 } = bbox(poly);
      for (let x = x0 + cell / 2; x < x1; x += cell) {
        for (let z = z0 + cell / 2; z < z1; z += cell) {
          if (inside(poly, x, z)) kit.solidBox(x, z, cell / 2, cell / 2, top);
        }
      }
    };
    const clearPoly = (poly: PlanPoint[], pad: number) => {
      const { x0, x1, z0, z1 } = bbox(poly);
      kit.clearSite((x0 + x1) / 2, (z0 + z1) / 2, (x1 - x0) / 2 + pad, (z1 - z0) / 2 + pad);
    };

    // The drive, as a line in local metres, to find each hall's front.
    const drive = L(DRIVE_WEST);
    const distanceToDrive = (x: number, z: number) => {
      let best = Infinity;
      for (let i = 0; i < drive.length - 1; i++) {
        const [ax, az] = drive[i];
        const [bx, bz] = drive[i + 1];
        const dx = bx - ax;
        const dz = bz - az;
        const t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / (dx * dx + dz * dz)));
        best = Math.min(best, Math.hypot(ax + dx * t - x, az + dz * t - z));
      }
      return best;
    };

    for (const hall of HALLS) {
      const poly = L(hall.points);
      const top = hall.top;
      // Board-marked concrete base, grey panel walls, panel joint lines.
      addPrism(group, poly, 0, 4.2, concrete);
      addPrism(group, kit.offsetPolygon(poly, -0.25), 4.2, top - 4.2 - 0.9, panel);
      for (const y of [8.2, top - 5]) addPrism(group, kit.offsetPolygon(poly, -0.12), y, 0.22, joint);
      // Rounded roof edge: a half-round coping over the parapet, then the
      // flat metal roof set back inside it.
      const edges = wallEdges(poly);
      for (const edge of edges) {
        if (edge.length < 6) continue;
        const coping = addCylinder(group, 0.9, 0.9, edge.length + 0.2, [
          edge.ax + edge.dx * edge.length / 2 - edge.nx * 0.65,
          top - 0.9,
          edge.az + edge.dz * edge.length / 2 - edge.nz * 0.65,
        ], panel, 8);
        coping.rotation.set(Math.PI / 2, 0, 0);
        coping.rotation.order = "YXZ";
        coping.rotation.y = Math.atan2(edge.dx, edge.dz);
      }
      addPrism(group, kit.offsetPolygon(poly, -1.4), top - 1.2, 0.5, roof);
      // The tall glass entrance front on the wall facing the drive.
      const front = edges.reduce((best, edge) => {
        const mid = (e: typeof edge) => distanceToDrive(e.ax + e.dx * e.length / 2, e.az + e.dz * e.length / 2) - e.length * 0.15;
        return mid(edge) < mid(best) ? edge : best;
      });
      const glassWidth = Math.min(front.length - 4, 36);
      kit.addOnWall(group, front, front.length / 2, 0.4, rectPane(glassWidth, top - 3.2), glass, 0.3);
      // Canopy over the doors.
      const cx = front.ax + front.dx * front.length / 2 + front.nx * 3;
      const cz = front.az + front.dz * front.length / 2 + front.nz * 3;
      addBox(group, [Math.min(glassWidth, 18), 0.5, 6], [cx, 5.4, cz], panel).rotation.y = front.rotationY;
      fillSolid(poly, top, 7);
      clearPoly(poly, 4);
    }

    // Car parks and the twin drive with its lawn median and lamp posts.
    for (const lot of PARKING) {
      const poly = L(lot);
      addPrism(group, poly, 0.02, 0.1, asphalt);
      clearPoly(poly, 2);
    }
    const driveEast = L(DRIVE_EAST);
    for (const lane of [drive, driveEast]) addSweptBox(group, lane.map(([x, z]) => [x, 0.14, z]), 4.2, 0.12, asphalt);
    const median = drive.map(([x, z], index) => {
      const [ex, ez] = driveEast[Math.min(index * 2, driveEast.length - 1)];
      return [(x + ex) / 2, 0.2, (z + ez) / 2] as [number, number, number];
    });
    addSweptBox(group, median, 1.4, 0.16, materials.lawn);
    const post = joint;
    for (let i = 0; i < drive.length - 1; i++) {
      const [ax, az] = drive[i];
      const [bx, bz] = drive[i + 1];
      const length = Math.hypot(bx - ax, bz - az);
      const nx = -(bz - az) / length;
      const nz = (bx - ax) / length;
      for (let along = 6; along < length; along += 24) {
        const x = ax + ((bx - ax) * along) / length;
        const z = az + ((bz - az) * along) / length;
        for (const side of [-5.6, 17.5]) {
          addBox(group, [0.32, 11, 0.32], [x + nx * side, 5.5, z + nz * side], post);
          addBox(group, [1.4, 0.3, 0.5], [x + nx * side, 11, z + nz * side], post);
        }
      }
    }
    const { x0, x1, z0, z1 } = bbox([...drive, ...driveEast]);
    kit.clearSite((x0 + x1) / 2, (z0 + z1) / 2, (x1 - x0) / 2 + 8, (z1 - z0) / 2 + 4);

    // The gate: concrete portal across the drive, the name in steel letters
    // on its beam, and gatehouse walls with the iccb logo either side.
    const [gx, gz] = kit.worldToLocal(...GATE);
    const SPAN = 30;
    for (const side of [-1, 1]) {
      addBox(group, [1.6, 8.2, 1.6], [gx + side * SPAN / 2, 4.1, gz], concrete);
      addBox(group, [5.4, 4.4, 1.8], [gx + side * (SPAN / 2 + 3.6), 2.2, gz], concrete);
      addMesh(group, rectPane(1.8, 0.7), kit.material(0xc0272d), [gx + side * (SPAN / 2 + 3.6), 2.9, gz + 0.95], 0);
      kit.solidBox(gx + side * (SPAN / 2 + 2.6), gz, 4, 1.1, 8.2);
    }
    addBox(group, [1.6, 8.2, 1.6], [gx, 4.1, gz], concrete);
    kit.solid(gx, gz, 0.9, 8.2);
    addBox(group, [SPAN + 4, 1.1, 1.8], [gx, 8.75, gz], concrete);
    addMesh(group, rectPane(SPAN - 2, 0.9), panel, [gx, 9.3, gz + 0.95], 0);
    addMesh(group, rectPane(SPAN - 2, 0.9), panel, [gx, 9.3, gz - 0.95], Math.PI);

    kit.setBoundsCollider(false);
    const [rx, rz] = kit.worldToLocal(1040, -6170);
    kit.setPerchTarget(rx, rz);
  },
};

export default landmark;
