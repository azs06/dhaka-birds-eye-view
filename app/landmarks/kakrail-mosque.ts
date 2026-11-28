// Kakrail Mosque (the Tablighi Jamaat markaz), Kakrail Road
//
// A large, deliberately plain mosque complex on the wedge of land between
// Kakrail Road and Ramna Park: no dome and no minaret, only cream-washed
// blocks striped with paired red pilasters, tall cusped arches along a
// two-storey prayer hall under a low tin roof, and taller dormitory blocks.
//
// The plan is OSM way 644413036 (building=mosque, 6 levels), an L of about
// 44 × 100 m lying north–south with its east side on Kakrail Road; the blocks
// below are that outline cut into rectangles, in metres east (E) and south (S)
// of 23.73695, 90.4037. OSM gives one height for the whole outline. The split
// into a two-storey arcaded hall, a four-storey north block and a six-storey
// south-west block follows two street photographs, which show all three but
// do not settle which stands where: the arrangement is a best reading, not a
// survey.
//
// Front (local +Z) is east, on Kakrail Road; local +X is north.
import { headingFromBearing, type LandmarkModule, type PlanPoint, type Vec3 } from "./kit";

const HALL_TOP = 9.4;
const NORTH_TOP = 14.6;
const SOUTH_TOP = 21;

const landmark: LandmarkModule = {
  key: "kakrail-mosque",
  label: "Kakrail Mosque",
  labelBn: "কাকরাইল মসজিদ",
  shortLabel: "KKM",
  lat: 23.73695,
  lon: 90.4037,
  altitude: SOUTH_TOP + 1,
  heading: headingFromBearing(90),
  clearingRadius: 60,
  extents: [50, 22],
  replacesOsmBuildingIds: [644413036],
  triangleBudget: 4000,
  plotGap: 6,
  build(kit) {
    const { group, addBox, addMesh, rectPane, materials } = kit;
    const cream = kit.material(0xf1e3bb, { roughness: 0.9 });
    const stripe = kit.material(0xb65a44, { roughness: 0.9 });
    const frame = materials.paleConcrete;
    const dark = materials.archDark;
    // The newer north block is washed salmon-pink with pale balcony bands
    // (Commons "Kakrail Mosque, Dhaka.jpg"), not the hall's cream.
    const salmon = kit.material(0xd9a48e, { roughness: 0.9 });

    // A block given by its east and south ranges.
    const block = (e0: number, e1: number, s0: number, s1: number, y0: number, y1: number, material = cream) => {
      addBox(group, [s1 - s0, y1 - y0, e1 - e0], [-(s0 + s1) / 2, (y0 + y1) / 2, (e0 + e1) / 2], material);
    };
    const solid = (e0: number, e1: number, s0: number, s1: number, top: number) => {
      kit.solidBox(-(s0 + s1) / 2, (e0 + e1) / 2, (s1 - s0) / 2, (e1 - e0) / 2, top);
    };
    // A flat pane on an east face (turn 0), north face (π/2), south face
    // (-π/2) or west face (π), centred at (e, s).
    const pane = (width: number, height: number, e: number, s: number, y: number, turn: number, material = dark) => {
      addMesh(group, rectPane(width, height), material, [-s, y, e], turn);
    };

    // A cusped (multifoil) arch, as on every opening of the hall.
    const cusped = (width: number, height: number) => {
      const half = width / 2;
      const spring = height * 0.5;
      const shape = new kit.THREE.Shape();
      shape.moveTo(-half, 0);
      shape.lineTo(half, 0);
      shape.lineTo(half, spring);
      const LOBES = 5;
      for (let lobe = 0; lobe < LOBES; lobe++) {
        for (let step = 1; step <= 3; step++) {
          const t = (lobe + step / 3) / LOBES;
          const angle = t * Math.PI;
          const pinch = step === 3 && lobe < LOBES - 1 ? 0.84 : 1;
          const rise = (height - spring) * (0.86 + 0.14 * Math.sin(angle));
          shape.lineTo(Math.cos(angle) * half * pinch, spring + Math.sin(angle) * rise * pinch);
        }
      }
      shape.lineTo(-half, 0);
      return new kit.THREE.ShapeGeometry(shape, 1);
    };

    // FORECOURT: the paved wedge between the east front and Kakrail Road
    // (drawn 14 m wide on way 644407975), and the yard north of the hall.
    const wedge: Array<[number, number]> = [
      [-33, -43.5], [35.5, -43.5], [29.5, -21], [21.5, -6], [14.5, 12], [8, 34], [3.4, 55], [2.4, 59.5], [-34, 59.5],
    ];
    // Paved in the south block's pale concrete, keeping eight materials.
    kit.addPrism(group, wedge.map(([e, s]): PlanPoint => [-s, e]), 0, 0.1, frame);

    // PRAYER HALL: two tall storeys, a cusped arcade to the road, a low
    // hipped tin roof with a clerestory strip under its eaves.
    block(-29, 7.5, -21.5, 22.4, 0, HALL_TOP);
    block(7.5, 11, -7.7, 8, 0, HALL_TOP);
    block(-29.4, 7.9, -21.9, 22.8, HALL_TOP - 0.5, HALL_TOP - 0.15, stripe);
    const eave = HALL_TOP + 1.3;
    block(-27.5, 6, -20, 21, HALL_TOP, eave, dark);
    const roof = (x0: number, x1: number, z0: number, z1: number, base: number, rise: number, inset: number) => {
      const a: Vec3 = [x0, base, z0];
      const b: Vec3 = [x1, base, z0];
      const c: Vec3 = [x1, base, z1];
      const d: Vec3 = [x0, base, z1];
      const zm = (z0 + z1) / 2;
      const r0: Vec3 = [x0 + inset, base + rise, zm];
      const r1: Vec3 = [x1 - inset, base + rise, zm];
      kit.addQuads(group, [
        [a, b, r1, r0, [0, 1, -1]], [c, d, r0, r1, [0, 1, 1]],
        [d, a, r0, r0, [-1, 1, 0]], [b, c, r1, r1, [1, 1, 0]],
      ], materials.tinRoof);
    };
    roof(-22.6, 21.6, -29.2, 8.2, eave, 2.6, 13);
    // Arcade bays along the east front, both storeys, with paired red
    // pilasters on the piers between them.
    const hallArch = cusped(3.6, 3.5);
    const eastBays: Array<[number, number]> = [[7.5, -18.3], [7.5, -12.9], [11, -5.2], [11, 0.2], [11, 5.5], [7.5, 11.5], [7.5, 16.9]];
    for (const [e, s] of eastBays) {
      for (const y of [0.5, 5.0]) addMesh(group, hallArch, dark, [-s, y, e + 0.08], 0);
    }
    const eastPiers: Array<[number, number]> = [[7.5, -21], [7.5, -15.6], [7.5, -10.2], [11, -7.5], [11, -2.5], [11, 2.85], [11, 7.8], [7.5, 8.8], [7.5, 14.2], [7.5, 19.6], [7.5, 22]];
    for (const [e, s] of eastPiers) {
      pane(0.32, HALL_TOP - 0.9, e + 0.07, s - 0.3, 0.3, 0, stripe);
      pane(0.32, HALL_TOP - 0.9, e + 0.07, s + 0.3, 0.3, 0, stripe);
    }
    // South end of the hall (toward the yard): three more bays.
    for (const e of [-3.5, 1.5, 4.9]) {
      for (const y of [0.5, 5.0]) addMesh(group, cusped(2.9, 3.5), dark, [-22.48, y, e], -Math.PI / 2);
    }

    // NORTH BLOCK: four storeys, open verandahs to the road and the junction.
    block(-32, 8, -41.6, -21.5, 0, NORTH_TOP, salmon);
    block(-32.3, 8.3, -41.9, -21.5, NORTH_TOP - 0.3, NORTH_TOP + 0.5, cream);
    block(-20, -8, -36, -27, NORTH_TOP, NORTH_TOP + 3, cream);
    for (let floor = 0; floor < 4; floor++) {
      const y = 1.1 + floor * 3.55;
      // A pale balcony band under each row of windows.
      pane(16.5, 0.5, 8.06, -31.6, y - 0.55, 0, cream);
      pane(36, 0.5, -12, -41.66, y - 0.55, Math.PI / 2, cream);
      pane(16.5, 1.3, 8.1, -31.6, y + 0.2, 0);
      pane(36, 1.3, -12, -41.7, y + 0.2, Math.PI / 2);
      pane(16.5, 1.2, -32.08, -31.6, y + 0.3, Math.PI);
    }
    for (const s of [-41, -31.6, -22.2]) {
      pane(0.32, NORTH_TOP - 0.6, 8.14, s - 0.3, 0.3, 0, stripe);
      pane(0.32, NORTH_TOP - 0.6, 8.14, s + 0.3, 0.3, 0, stripe);
    }
    for (const e of [-31.4, -22, -12, -2, 7.4]) {
      pane(0.32, NORTH_TOP - 0.6, e - 0.3, -41.74, 0.3, Math.PI / 2, stripe);
      pane(0.32, NORTH_TOP - 0.6, e + 0.3, -41.74, 0.3, Math.PI / 2, stripe);
    }

    // SOUTH-WEST BLOCK: the six-storey concrete frame, floors open as bands.
    block(-33, -9, 22.4, 58, 0, SOUTH_TOP, frame);
    block(-9, -1.6, 32.8, 58, 0, SOUTH_TOP, frame);
    block(-33.3, -1.3, 22.4, 58.3, SOUTH_TOP - 0.25, SOUTH_TOP + 0.35, frame);
    for (let floor = 0; floor < 6; floor++) {
      const y = 1.0 + floor * 3.4;
      pane(23.5, 1.9, -1.52, 45.4, y, 0);
      pane(29, 1.9, -17.3, 58.08, y, -Math.PI / 2);
      pane(33.5, 1.9, -33.08, 40.2, y, Math.PI);
      if (y > HALL_TOP + 1) pane(22, 1.9, -21, 22.32, y, Math.PI / 2);
    }

    // The row of coconut palms along the road front.
    const palms: Array<[number, number, number]> = [[26, -30, 12], [21.5, -20, 13], [18.5, -10, 11.5], [15.5, 1, 13], [13, 13, 12], [9.5, 24, 12.5]];
    palms.forEach(([e, s, height], index) => kit.addPalm(group, -s, e, height, 0.08, index * 1.3));

    // COLLIDERS (heading 90°: local boxes are world boxes).
    kit.setBoundsCollider(false);
    solid(-29, 7.5, -21.5, 22.4, eave + 2.2);
    solid(7.5, 11, -7.7, 8, HALL_TOP);
    solid(-32, 8, -41.6, -21.5, NORTH_TOP + 0.5);
    solid(-33, -9, 22.4, 58, SOUTH_TOP + 0.35);
    solid(-9, -1.6, 32.8, 58, SOUTH_TOP + 0.35);
    // Open ground of the plot, cut in bands so it stays off the carriageway.
    const clear = (e0: number, e1: number, s0: number, s1: number) => kit.clearSite(-(s0 + s1) / 2, (e0 + e1) / 2, (s1 - s0) / 2, (e1 - e0) / 2);
    clear(-34, 29, -43.5, -21);
    clear(-34, 20, -21, 0);
    clear(-34, 12, 0, 25);
    clear(-34, 4, 25, 59.5);
    kit.setPerchTarget(0.01, -10);
  },
};

export default landmark;
