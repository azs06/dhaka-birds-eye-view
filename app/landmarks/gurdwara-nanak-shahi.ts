// Gurdwara Nanak Shahi
//
// The Sikh gurdwara on the Dhaka University campus by Nilkhet Road, said to
// date from the 1830s and rebuilt since. A white single-storey hall fronts
// SSE onto a paved court: five scalloped arches filled with jali (the middle
// one the door), a blue band and a gently raised parapet; behind it two
// set-back stages, the upper one the square drum carrying the ribbed white
// dome with its ring of blue khanda motifs and a gilt finial. The saffron
// Nishan Sahib stands on a railed plinth at the front-right corner, the
// three-storey "New Darbar" block with a small dome adjoins the east end,
// and the compound's arched gate on the south wall carries four small domed
// kiosks (Commons: "Front View of Gurudwara Nanak Shahi.jpg", "Gurdwara
// Nanak Shahi in Dhaka 03.jpg", "Front Side of Gurudwara Nanak Shahi 1.jpg",
// "Gurdwara NanakShahi Dhaka by Ragib Hasan.jpg", "Gurdwara Nanak Shahi,
// Dhaka (1).jpg" for the gate). The brief's "corner kiosks" are on the gate,
// not on the hall, in every photo.
//
// OSM: hall way 295394988 (two levels, 34 × 27 m, its front edge turned
// 13.7° from east-west), the three-level square drum way 1039101355 (12 m),
// compound wall 993911772 and gate 990466438. Neither the hall nor the drum
// is in the bundled snapshot (nothing to replace); the snapshot's two-storey
// "গুরু নানক" office (990262842) at the front-left is a neighbour and stays.
// The origin is the drum's centre.
import { headingFromBearing, type LandmarkModule, type PlanPoint } from "./kit";

// OSM way 295394988's node used as the survey origin for the offsets below.
const NODE_LAT = 23.733647;
const NODE_LON = 90.393679;
const METRES_PER_DEG_LON = 111320 * Math.cos((23.7715 * Math.PI) / 180);
const METRES_PER_DEG_LAT = 110540;

const HALL_TOP = 4.8;
const STAGE_TOP = 6.8;
const DRUM_TOP = 9.4;

const landmark: LandmarkModule = {
  key: "gurdwara-nanak-shahi",
  label: "Gurdwara Nanak Shahi",
  labelBn: "গুরুদুয়ারা নানকশাহী",
  shortLabel: "GNS",
  lat: 23.733595,
  lon: 90.39363,
  altitude: 17,
  heading: headingFromBearing(166.3),
  clearingRadius: 32,
  extents: [17, 14],
  triangleBudget: 3500,
  plotGap: 6,
  inspectDistance: 55,
  build(kit) {
    const { group, addBox, addCylinder, addLathe, addMesh, addPrism, materials } = kit;
    const white = materials.whiteStone;
    const blue = kit.material(0x2f86c6, { roughness: 0.6 });
    const jali = kit.material(0x6d6864, { roughness: 0.9 });
    const gold = materials.accent;
    const saffron = kit.material(0xee9a1c, { roughness: 0.6 });
    const paving = materials.marble;

    // An OSM offset (metres east, north of the survey node) in local x, z.
    const en = (east: number, north: number): PlanPoint =>
      kit.toLocal(NODE_LAT + north / METRES_PER_DEG_LAT, NODE_LON + east / METRES_PER_DEG_LON);

    // ---- The hall: the OSM footprint, then the facade on its front edge ---
    const hall: PlanPoint[] = [
      en(-19.8, 10.9), en(-5.1, 14.5), en(-4.6, 12.2), en(1.7, 14.1), en(8.4, 14.1), en(8.4, 15.0),
      en(12.4, 15.2), en(12.4, 10.5), en(16.2, 11.4), en(19.9, -7.2), en(-13.3, -15.3),
    ];
    addPrism(group, hall, 0, HALL_TOP, white);
    addPrism(group, kit.offsetPolygon(hall, -0.4), HALL_TOP, 0.12, materials.roofTerrace);
    // Front edge runs local x -10.4 … 23.8 at z = 7.3.
    const FRONT = 7.3;
    addBox(group, [34.2, 0.22, 0.12], [6.7, 3.85, FRONT + 0.08], blue);
    addBox(group, [34.2, 0.18, 0.12], [6.7, HALL_TOP - 0.05, FRONT + 0.08], blue);
    // Raised middle of the parapet over the arches.
    addBox(group, [19, 0.75, 0.5], [0, HALL_TOP + 0.37, FRONT - 0.25], white);
    addBox(group, [19.1, 0.14, 0.62], [0, HALL_TOP + 0.75, FRONT - 0.25], blue);
    // Five scalloped arches: jali screens either side of the open door.
    for (const [i, ax] of [-7.6, -3.8, 0, 3.8, 7.6].entries()) {
      addBox(group, [3.3, 3.45, 0.1], [ax, 0.3 + 1.72, FRONT + 0.05], white);
      addMesh(group, kit.roundArch(2.7, 3.0), i === 2 ? materials.archDark : jali, [ax, 0.35, FRONT + 0.12]);
    }
    addBox(group, [1.5, 1.5, 0.1], [0, 3.1 + 0.6, FRONT + 0.13], blue);
    // Plinth step along the facade and the paved court in front.
    addBox(group, [34.6, 0.3, 1.4], [6.7, 0.15, FRONT + 0.7], paving);
    addPrism(group, [[-9, FRONT + 1.4], [20, FRONT + 1.4], [20, 33], [-9, 33]], 0, 0.08, paving);

    // ---- Set-back stage and the square drum -------------------------------
    addBox(group, [18.4, STAGE_TOP - HALL_TOP, 13.6], [0, (HALL_TOP + STAGE_TOP) / 2, -1.4], white);
    addBox(group, [18.6, 0.16, 0.1], [0, STAGE_TOP - 0.1, 5.33], blue);
    for (const wx of [-4.5, 0, 4.5]) addMesh(group, kit.rectPane(0.7, 0.9), materials.archDark, [wx, HALL_TOP + 0.6, 5.36]);
    addBox(group, [11.6, DRUM_TOP - STAGE_TOP, 11.6], [0, (STAGE_TOP + DRUM_TOP) / 2, 0], white);
    addBox(group, [11.8, 0.2, 11.8], [0, DRUM_TOP - 0.1, 0], blue);
    addBox(group, [7.2, 0.5, 0.08], [0, STAGE_TOP + 1.2, 5.84], blue);

    // ---- Ribbed white dome, blue khanda band, gilt finial -----------------
    addCylinder(group, 3.7, 3.7, 0.5, [0, DRUM_TOP + 0.25, 0], white, 16);
    const domeBase = DRUM_TOP + 0.5;
    addLathe(group, kit.domeProfile(3.95, 5.4, 0.22, 12), 16, [0, domeBase, 0], white, true);
    addLathe(group, [[3.78, 0.05], [4.06, 0.6], [4.16, 1.3], [0, 1.3]], 16, [0, domeBase, 0], blue, true);
    const domeTop = domeBase + 5.4;
    kit.addFinial(group, [0, domeTop - 0.1, 0], 1.3, gold);

    // ---- New Darbar block at the east end, with its small dome ------------
    addBox(group, [9.6, 10.6, 13.6], [18.2, 5.3, -0.4], white);
    for (const y of [3.4, 6.8]) addBox(group, [9.7, 0.18, 13.7], [18.2, y, -0.4], blue);
    for (const y of [1.2, 4.6, 8.0]) addBox(group, [7.2, 1.3, 0.1], [18.2, y + 0.65, 6.36], materials.archDark);
    addCylinder(group, 1.6, 1.6, 0.9, [20.6, 11.05, 3.6], white, 12);
    addLathe(group, kit.domeProfile(1.75, 2.3, 0.2, 8), 12, [20.6, 11.5, 3.6], white);
    kit.addFinial(group, [20.6, 13.7, 3.6], 0.6, gold);

    // ---- Nishan Sahib on its railed plinth --------------------------------
    const NX = 12.6;
    const NZ = FRONT + 3.4;
    addBox(group, [2.6, 1.1, 2.6], [NX, 0.55, NZ], white);
    addBox(group, [2.8, 0.12, 2.8], [NX, 1.16, NZ], blue);
    addCylinder(group, 0.11, 0.17, 17, [NX, 1.1 + 8.5, NZ], saffron, 8);
    // A pennant streaming east from the pole, drawn on both faces.
    addMesh(group, kit.trianglePane(1.8, 2.8), saffron, [NX, 15.6, NZ + 0.02]).rotation.z = -Math.PI / 2;
    addMesh(group, kit.trianglePane(1.8, 2.8), saffron, [NX, 15.6, NZ - 0.02], Math.PI).rotation.z = Math.PI / 2;
    kit.addFinial(group, [NX, 18.1, NZ], 0.5, gold);

    // ---- The south gate: scalloped arch, four domed kiosks, compound wall --
    // Set 1.2 m inside the surveyed wall line: Nilkhet Road's drawn asphalt
    // comes within 0.5 m of it.
    const [g0x, g0z] = en(-7.9, -44.0);
    const [g1x, g1z] = en(-4.4, -44.0);
    const gate = new kit.THREE.Group();
    gate.position.set((g0x + g1x) / 2, 0, (g0z + g1z) / 2);
    gate.rotation.y = Math.atan2(-(g1z - g0z), g1x - g0x);
    group.add(gate);
    for (const side of [-1, 1]) addBox(gate, [1.5, 5.2, 1.1], [side * 3.2, 2.6, 0], white);
    addBox(gate, [7.9, 1.9, 1.1], [0, 5.55, 0], white);
    for (const side of [-1, 1]) kit.addChhatri(gate, [side * 3.2, 6.5, 0], 1.3, white, white);
    for (const cx of [-0.9, 0, 0.9]) kit.addChhatri(gate, [cx, 6.5, 0], cx === 0 ? 1.4 : 1.0, white, white);
    // The wall either side, along OSM way 993911772.
    const wall = (a: PlanPoint, b: PlanPoint) => {
      const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
      const piece = addBox(group, [len, 2.6, 0.35], [(a[0] + b[0]) / 2, 1.3, (a[1] + b[1]) / 2], white);
      piece.rotation.y = Math.atan2(-(b[1] - a[1]), b[0] - a[0]);
    };
    wall(en(-25.8, -44.2), en(-11.6, -44.05));
    wall(en(-0.7, -44.0), en(12.3, -43.9));
    wall(en(12.3, -43.9), en(22.8, -44.8));

    // ---- Colliders, clearing ----------------------------------------------
    kit.setBoundsCollider(false);
    kit.solidTiles(-10.6, 13, -19.4, FRONT, HALL_TOP, 6);
    kit.solidBox(0, -1.4, 9.2, 6.8, STAGE_TOP);
    kit.solidBox(0, 0, 5.8, 5.8, DRUM_TOP);
    kit.solid(0, 0, 3.2, domeTop + 0.8);
    kit.solidBox(18.2, -0.4, 4.8, 6.8, 13.5);
    kit.solid(NX, NZ, 0.6, 18);
    for (const side of [-1, 1]) {
      const c = Math.cos(gate.rotation.y);
      const s = Math.sin(gate.rotation.y);
      kit.solid(gate.position.x + side * 3.2 * c, gate.position.z - side * 3.2 * s, 0.9, 7.6);
    }
    // The court as small tiles: one turned box would reach the office next
    // door (990262842, local x -19.6 … -10.2), which really stands there.
    for (let x = -7; x < 19; x += 6) {
      for (let z = FRONT + 2; z < 37; z += 6) kit.clearSite(x + 3, z + 3, 3, 3);
    }
    kit.clearSite(-6.5, 32, 2.5, 5.5);
    kit.setPerchTarget(0.3, 0.3);
  },
};

export default landmark;
