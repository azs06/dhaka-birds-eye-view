// Shah Ali Mazar (Shrine of Hazrat Shah Ali Baghdadi), Mirpur-1
//
// The dargah of the 16th-century saint in a walled compound off Mazar Road.
// What a visitor sees, and what is built here, from the Commons photos:
// - the shrine: a long single-storey pavilion of white columns with blue
//   glazing under a red-and-green patterned parapet, a green dome rising
//   over the tomb chamber, small green-domed corner turrets, on a white plinth
//   with steps down to the court;
// - the huge old banyan beside it, its trunk on a white round platform, its
//   crown spreading over the shrine roof;
// - the three-storey cream mosque block with maroon pilasters to the north,
//   and its tall pale-blue minaret with a flared lotus gallery;
// - the broad paved court east of the shrine, where pilgrims gather;
// - the orange-yellow gateway on Mazar Road: a pointed arch in a mosaic
//   panel, a sign band, and a small ribbed dome with a spire on top.
//
// Footprints (OSM, none of them in the snapshot): compound landuse=religious
// way 297734992; shrine pavilion way 1084145717 (the origin is its centre);
// mosque block way 995804674 (the "Shah Ali Mazar Jame Mashjid" node sits on
// it); gateway way 875674002 at the compound's south tip by the Mazar Road
// junction. The pavilion and gate are identified from the z19 imagery (flat
// roof with white parapet and the banyan crown at its north side; the gate's
// stepped outline between two kiosks) and are the best match, not tagged.
// The pond in the south-west corner (way 1230534636) is snapshot water and
// is left alone; so are the market and shop strips on the compound edge.
//
// Local +Z faces EAST (the shrine's front onto the court), +X points north;
// with this heading, local boxes stay square to the world.
import { headingFromBearing, type LandmarkModule, type PlanPoint } from "./kit";

const SHRINE: PlanPoint[] = [[-6912.6, -2809.7], [-6913.3, -2826.9], [-6878.5, -2828.5], [-6877.7, -2811.2]];
const MOSQUE: PlanPoint[] = [[-6917, -2871.1], [-6877.7, -2873.4], [-6875.8, -2840.7], [-6915.1, -2838.5]];
const MINARET: PlanPoint = [-6881.6, -2869.6];
const BANYAN: PlanPoint = [-6888, -2832.5];
const GATE: PlanPoint = [-6867.5, -2768.6];

const PLINTH = 0.9;
const SHRINE_TOP = 5.4;
const MOSQUE_TOP = 12.6;
const MINARET_TOP = 31;

const landmark: LandmarkModule = {
  key: "shah-ali-mazar",
  label: "Shah Ali Mazar",
  labelBn: "হযরত শাহ আলী বাগদাদী (রহ.) মাজার",
  shortLabel: "SAM",
  lat: 23.797003,
  lon: 90.348815,
  altitude: MINARET_TOP,
  heading: headingFromBearing(90),
  clearingRadius: 70,
  extents: [9, 18],
  triangleBudget: 5000,
  plotGap: 6,
  inspectDistance: 95,
  build(kit) {
    const { THREE, group, addBox, addCylinder, addLathe, addPrism, addFinial, addTree, addMesh, materials } = kit;
    const local = (points: PlanPoint[]) => points.map(([x, z]) => kit.worldToLocal(x, z));
    const at = ([x, z]: PlanPoint) => kit.worldToLocal(x, z);
    // A world-axis rectangle (snapshot metres) as a local centre and half
    // extents: with this heading, world boxes stay boxes.
    const rect = (x0: number, x1: number, z0: number, z1: number) => {
      const [ax, az] = kit.worldToLocal(x0, z0);
      const [bx, bz] = kit.worldToLocal(x1, z1);
      return { x: (ax + bx) / 2, z: (az + bz) / 2, hx: Math.abs(ax - bx) / 2, hz: Math.abs(az - bz) / 2 };
    };
    const clearWorld = (x0: number, x1: number, z0: number, z1: number) => {
      const r = rect(x0, x1, z0, z1);
      kit.clearSite(r.x, r.z, r.hx, r.hz);
    };

    const white = materials.whiteStone;
    const cream = materials.cream;
    const blueGlass = kit.material(0x3f72b5, { roughness: 0.35 });
    const domeGreen = kit.material(0x2f8a4c, { roughness: 0.6 });
    // Eleven materials in all: the red of the shrine parapet, the gate trim
    // and the mosque pilasters share one; the gate's sign band uses the dome
    // green and its dome the cream.
    const maroon = materials.deepBrick;
    const parapetRed = maroon;
    const gateTrim = maroon;
    const signGreen = domeGreen;
    const domeGrey = cream;
    const minaretBlue = kit.material(0x8fc3d8, { roughness: 0.7 });
    const courtPaving = kit.material(0x9a6b5e, { roughness: 0.96 });
    const gateOrange = kit.material(0xe2a42c, { roughness: 0.8 });

    // --- The court: paving from the mosque to the gate, east of the shrine.
    const court = rect(-6915, -6842, -2840, -2777);
    addBox(group, [court.hx * 2, 0.1, court.hz * 2], [court.x, 0.05, court.z], courtPaving);
    const lane = rect(-6879, -6858, -2777, -2763);
    addBox(group, [lane.hx * 2, 0.1, lane.hz * 2], [lane.x, 0.05, lane.z], courtPaving);

    // --- The shrine pavilion.
    const shrine = local(SHRINE);
    addPrism(group, kit.offsetPolygon(shrine, 1.6), 0.1, PLINTH - 0.1, white);
    addPrism(group, shrine, PLINTH, SHRINE_TOP - PLINTH - 0.7, cream);
    // Blue glazing between the columns, and the columns themselves.
    addPrism(group, kit.offsetPolygon(shrine, 0.06), PLINTH + 0.5, 3.0, blueGlass);
    for (const edge of kit.wallEdges(shrine)) {
      const bays = Math.max(2, Math.round(edge.length / 3.4));
      for (let i = 0; i <= bays; i++) {
        const t = (edge.length * i) / bays;
        const x = edge.ax + edge.dx * t + edge.nx * 0.22;
        const z = edge.az + edge.dz * t + edge.nz * 0.22;
        addBox(group, [0.6, SHRINE_TOP - PLINTH - 0.7, 0.6], [x, PLINTH + (SHRINE_TOP - PLINTH - 0.7) / 2, z], white).rotation.y = edge.rotationY;
      }
    }
    // Patterned parapet: red band under a green coping, a white cornice below.
    addPrism(group, kit.offsetPolygon(shrine, 0.45), SHRINE_TOP - 0.75, 0.25, white);
    addPrism(group, kit.offsetPolygon(shrine, 0.35), SHRINE_TOP - 0.5, 0.75, parapetRed);
    addPrism(group, kit.offsetPolygon(shrine, 0.42), SHRINE_TOP + 0.25, 0.18, domeGreen);
    // Steps down to the court along the east front.
    const front = rect(-6877.7, -6874.6, -2826, -2813);
    for (let s = 0; s < 3; s++) {
      addBox(group, [front.hx * 2, 0.3, front.hz * 2 - s * 1.0], [front.x, 0.15 + s * 0.3, front.z - s * 0.5], white);
    }
    // The tomb chamber's green dome on a drum, and green-domed corner turrets.
    addCylinder(group, 3.7, 3.7, 1.6, [0, SHRINE_TOP + 0.8, 0], white, 16);
    addLathe(group, kit.domeProfile(3.9, 4.0, 0.18), 16, [0, SHRINE_TOP + 1.6, 0], domeGreen);
    addFinial(group, [0, SHRINE_TOP + 5.6, 0], 1.3, gateOrange);
    for (const [x, z] of shrine) {
      addCylinder(group, 0.45, 0.5, 2.2, [x, SHRINE_TOP + 1.1, z], white, 8);
      addLathe(group, kit.domeProfile(0.6, 0.8, 0.15, 4), 8, [x, SHRINE_TOP + 2.2, z], domeGreen);
    }
    const shrineBox = rect(-6913.3, -6877.7, -2828.5, -2809.7);
    kit.solidBox(shrineBox.x, shrineBox.z, shrineBox.hx, shrineBox.hz, SHRINE_TOP + 0.4);
    kit.solid(0, 0, 3.6, SHRINE_TOP + 5.4);

    // --- The banyan beside the shrine's north wall: a thick trunk on a white,
    // red-banded platform, and a wide double crown that overhangs the north
    // half of the shrine roof but stays clear of the dome. (Local +X is
    // north, -Z west.)
    const [bx, bz] = at(BANYAN);
    addCylinder(group, 3.1, 3.2, 0.8, [bx, 0.4, bz], white, 16);
    addCylinder(group, 3.15, 3.15, 0.18, [bx, 0.75, bz], parapetRed, 16);
    addCylinder(group, 1.1, 1.6, 6, [bx, 3.6, bz], materials.bark, 8);
    addTree(group, bx + 1, bz, 10.5, 6.8, materials.canopy);
    addTree(group, bx + 6, bz - 8, 8.5, 6.2, materials.canopy);
    kit.solid(bx, bz, 1.5, 7);

    // --- The mosque block: three storeys, cream with maroon pilasters, a dark
    // band per storey, and its minaret at the north-east corner.
    const mosque = local(MOSQUE);
    addPrism(group, mosque, 0.1, MOSQUE_TOP - 0.1, cream);
    for (const y of [1.2, 5.2, 9.0]) addPrism(group, kit.offsetPolygon(mosque, 0.07), y, 1.9, materials.archDark);
    addPrism(group, kit.offsetPolygon(mosque, 0.25), MOSQUE_TOP, 0.6, cream);
    const mosqueEdges = kit.wallEdges(mosque);
    for (const edge of mosqueEdges) {
      const bays = Math.max(2, Math.round(edge.length / 6.5));
      for (let i = 0; i <= bays; i++) {
        const t = (edge.length * i) / bays;
        const x = edge.ax + edge.dx * t + edge.nx * 0.3;
        const z = edge.az + edge.dz * t + edge.nz * 0.3;
        addBox(group, [1.1, MOSQUE_TOP + 0.3, 0.7], [x, (MOSQUE_TOP + 0.3) / 2, z], maroon).rotation.y = edge.rotationY;
      }
    }
    const mosqueBox = rect(-6917, -6875.8, -2873.4, -2838.5);
    kit.solidBox(mosqueBox.x, mosqueBox.z, mosqueBox.hx, mosqueBox.hz, MOSQUE_TOP + 0.6);

    // Shaft from a plinth on the roof, flared lotus gallery, a short neck and
    // a green cap: profile heights are relative to the shaft's base.
    const [mx, mz] = at(MINARET);
    const SHAFT_BASE = MOSQUE_TOP + 1.8;
    const SHAFT = MINARET_TOP - 2 - SHAFT_BASE;
    addCylinder(group, 1.75, 1.75, 1.2, [mx, MOSQUE_TOP + 1.2, mz], cream, 8);
    addLathe(group, [
      [1.55, 0], [1.3, 0.4], [1.2, SHAFT - 5], [1.35, SHAFT - 4.4], [2.3, SHAFT - 1.6],
      [2.3, SHAFT - 1.2], [1.25, SHAFT - 0.9], [1.25, SHAFT],
    ], 8, [mx, SHAFT_BASE, mz], minaretBlue, true);
    addLathe(group, kit.domeProfile(1.45, 2.0, 0.2, 5), 8, [mx, MINARET_TOP - 2, mz], domeGreen);
    addFinial(group, [mx, MINARET_TOP - 0.1, mz], 1.0, gateOrange);
    kit.solid(mx, mz, 1.8, MINARET_TOP);

    // --- The gateway, facing south onto the Mazar Road junction.
    const [gx, gz] = at(GATE);
    const gate = new THREE.Group();
    gate.position.set(gx, 0, gz);
    // The gate's own +Z (its street face) points south, which is local -X.
    gate.rotation.y = -Math.PI / 2;
    group.add(gate);
    const GATE_TOP = 8.6;
    for (const side of [-1, 1]) {
      addBox(gate, [2.9, GATE_TOP, 2.4], [side * 4.45, GATE_TOP / 2, 0], gateOrange);
      addBox(gate, [0.35, GATE_TOP - 0.4, 2.5], [side * 3.1, (GATE_TOP - 0.4) / 2, 0], gateTrim);
      addBox(gate, [0.35, GATE_TOP - 0.4, 2.5], [side * 5.8, (GATE_TOP - 0.4) / 2, 0], gateTrim);
      // Small domed kiosks either side.
      addBox(gate, [2.6, 3.6, 2.6], [side * 7.4, 1.8, -0.4], gateOrange);
      addLathe(gate, kit.domeProfile(1.25, 1.4, 0.15, 4), 8, [side * 7.4, 3.6, -0.4], domeGrey);
    }
    // Mosaic panel round the pointed arch, then the sign band and cornice.
    addBox(gate, [6.0, 2.2, 2.0], [0, 6.1, 0], white);
    for (const face of [1, -1]) {
      addMesh(gate, kit.pointedArch(5.0, 2.0), maroon, [0, 5.0, face * 1.02], face === 1 ? 0 : Math.PI);
    }
    addBox(gate, [12.0, 1.3, 2.6], [0, GATE_TOP - 0.85, 0], signGreen);
    addBox(gate, [12.6, 0.4, 2.9], [0, GATE_TOP + 0.0, 0], gateOrange);
    addCylinder(gate, 2.3, 2.5, 0.9, [0, GATE_TOP + 0.65, 0], gateOrange, 12);
    addLathe(gate, kit.domeProfile(2.4, 2.6, 0.12, 5), 12, [0, GATE_TOP + 1.1, 0], domeGrey, true);
    addCylinder(gate, 0.12, 0.2, 4.2, [0, GATE_TOP + 5.6, 0], gateTrim, 6);
    // Piers only: the arch stays open to fly through.
    for (const side of [-1, 1]) {
      const [px, pz] = at([GATE[0] + side * 4.45, GATE[1]]);
      kit.solid(px, pz, 1.5, GATE_TOP);
    }

    // --- Old trees round the shrine, on the court, and on the pond's north bank.
    const trees: Array<[number, number, number]> = [
      [-6930, -2830, 7], [-6940, -2808, 7.5], [-6925, -2790, 8], [-6905, -2784, 6.5],
      [-6945, -2784, 6.5], [-6869, -2799, 6], [-6852, -2804, 6.5],
    ];
    for (const [x, z, r] of trees) {
      const [tx, tz] = kit.worldToLocal(x, z);
      addTree(group, tx, tz, r, 6.5, materials.canopy);
    }

    // The compound's open ground: court and shrine garden, the strip by the
    // mosque, and the lane in from the gate. The market and shops on the
    // edges, and the pond, are not touched.
    clearWorld(-6950, -6842, -2848, -2775);
    clearWorld(-6918, -6855, -2876, -2848);
    clearWorld(-6884, -6856, -2777, -2762);
    kit.setBoundsCollider(false);
  },
};

export default landmark;
