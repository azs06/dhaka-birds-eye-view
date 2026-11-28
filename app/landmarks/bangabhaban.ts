// Bangabhaban (President's House)
//
// The white palace of the President of Bangladesh in its walled, wooded
// grounds south of Dilkusha: the former Governor's House, rebuilt after the
// 1961 storm as a long flat-roofed Mughal-revival block. What people know it
// by, from the Motijheel towers, is the long north front — a ground-floor
// arcade under a sun-shade, a recessed upper verandah between two square stair
// towers — standing on a paved terrace before a great lawn, with the white
// dome over the west entrance porch at one end and a round white building
// among the trees behind the other.
//
// OSM way 549705064 is the palace footprint (about 128 m by 78 m, long axis
// 98°), way 698433176 the oval drive before the west porch, ways 698433174/5
// the drive from it to Banga Bhaban Road (way 499247021), way 1131175853 the
// round building 150 m to the east, and way 336778005 the compound wall. The
// four ponds inside the wall are map water already. The origin is the middle
// of the palace footprint.
//
// Local +Z is the garden (north) front, bearing 8°; local +X runs WEST along
// the building to the entrance porch and the dome.
import { headingFromBearing, type LandmarkModule, type Vec3 } from "./kit";

const ENTRANCE_ROOF = 7;
const MAIN_ROOF = 11;
const PAVILION_ROOF = 14.2;
const TOWER_TOP = 17;
const DOME_X = 40;
const DOME_BASE = 10.4;
// The fountain island in the oval drive, and the round building.
const ISLAND: [number, number] = [93, 2];
const ROTUNDA: [number, number] = [-150, -0.5];
// Banga Bhaban Road (OSM way 499247021), north to south. Both ends stop
// short of the avenues it joins, which the map already draws.
const ROAD: Array<[number, number]> = [[337, 200], [309.6, 5.9], [309, 1.6], [296, -90]];
const DRIVE_Z = 3.6;

const landmark: LandmarkModule = {
  key: "bangabhaban",
  label: "Bangabhaban",
  labelBn: "বঙ্গভবন",
  shortLabel: "BBN",
  lat: 23.7233,
  lon: 90.418149,
  altitude: 22,
  heading: headingFromBearing(8),
  clearingRadius: 125,
  extents: [64, 40],
  replacesOsmBuildingIds: [549705064],
  // The wooded grounds inside the wall, kept 15 m and more off the roads
  // that run along it.
  park: { name: "Bangabhaban Grounds", lat: 23.723977, lon: 90.418004, rx: 295, rz: 190, angle: 0.1396, wooded: true },
  triangleBudget: 8000,
  inspectDistance: 190,
  build(kit) {
    const { group, addBox, addCylinder, addMesh, materials } = kit;
    const wall = materials.whiteStone;
    const roof = materials.paleConcrete;
    const dark = materials.archDark;
    // Eight materials: the jali screens and terrace paving share the pale
    // roof concrete, the basin the dark of the openings, the trees the palms'
    // light canopy, and the green standard the lawn.
    const jali = roof;
    const flowers = kit.material(0xc8402f, { roughness: 0.95 });
    const paving = roof;

    // A flat-roofed mass from the ground (or `base`) to `top`, under a
    // slightly oversailing roof slab.
    const block = (x0: number, x1: number, z0: number, z1: number, top: number, base = 0, eave = 0.5) => {
      addBox(group, [x1 - x0, top - base, z1 - z0], [(x0 + x1) / 2, (base + top) / 2, (z0 + z1) / 2], wall);
      addBox(group, [x1 - x0 + eave * 2, 0.35, z1 - z0 + eave * 2], [(x0 + x1) / 2, top + 0.175, (z0 + z1) / 2], roof);
    };
    // Panes on the four faces: north (+Z), south, west (+X), east.
    const TURN = { north: 0, south: Math.PI, west: Math.PI / 2, east: -Math.PI / 2 } as const;
    const pane = (geometry: ReturnType<typeof kit.rectPane>, position: Vec3, face: keyof typeof TURN, material = dark) =>
      addMesh(group, geometry, material, position, TURN[face]);

    // ---- Ground: terrace, lawn, forecourt, drive ----
    addBox(group, [140, 0.1, 94], [0, 0.05, -1], paving);
    addBox(group, [150, 0.12, 118], [0, 0.07, 105], materials.lawn);
    addBox(group, [124, 0.3, 1.6], [0, 0.2, 47.2], flowers);
    const forecourt = addCylinder(group, 1, 1, 0.1, [ISLAND[0], 0.08, ISLAND[1]], materials.wornAsphalt, 28);
    forecourt.scale.set(31, 1, 25);
    const bed = addCylinder(group, 1, 1, 0.2, [ISLAND[0], 0.2, ISLAND[1]], flowers, 24);
    bed.scale.set(21, 1, 15);
    const turf = addCylinder(group, 1, 1, 0.2, [ISLAND[0], 0.26, ISLAND[1]], materials.lawn, 24);
    turf.scale.set(19.2, 1, 13.2);
    addCylinder(group, 6.4, 6.6, 0.8, [ISLAND[0], 0.7, ISLAND[1]], wall, 20);
    addCylinder(group, 5.7, 5.7, 0.1, [ISLAND[0], 1.12, ISLAND[1]], dark, 20);
    // The steel cranes rising from the basin, as three leaning blades.
    for (const [dx, dz, lean] of [[-1.1, 0.3, 0.14], [0.4, -0.7, -0.1], [1, 0.8, 0.2]] as const) {
      kit.addCone(group, 0.45, 5.4, [ISLAND[0] + dx, 3.8, ISLAND[1] + dz], roof, 4).rotation.z = lean;
    }
    addBox(group, [ROAD[1][0] - 4 - (ISLAND[0] + 28), 0.1, 8.5], [(ROAD[1][0] - 4 + ISLAND[0] + 28) / 2, 0.07, DRIVE_Z], materials.wornAsphalt);
    kit.addSweptBox(group, ROAD.map(([x, z]): Vec3 => [x, 0.14, z]), 4.2, 0.14, materials.wornAsphalt);
    // Royal palms line the drive.
    for (let x = 136; x < 290; x += 26) {
      for (const side of [-1, 1]) kit.addPalm(group, x, DRIVE_Z + side * 8.5, 11, 0.03, x);
    }
    // The big trees that wall the lawn in on either side.
    for (let z = 52; z < 170; z += 19) {
      for (const side of [-1, 1]) kit.addTree(group, side * (84 + ((z * 7) % 9)), z + ((z * 3) % 5), 6.2 + ((z * 5) % 3) * 0.6, 7.5, materials.lightCanopy);
    }
    // The compound wall along the road, open at the drive.
    const inset = (index: number, z: number): Vec3 => {
      const [ax, az] = ROAD[index];
      const [bx, bz] = ROAD[index + 1];
      return [ax + ((bx - ax) * (z - az)) / (bz - az) - 7.2, 3, z];
    };
    kit.addSweptBox(group, [inset(0, 200), inset(0, DRIVE_Z + 8)], 0.35, 3, wall);
    kit.addSweptBox(group, [inset(2, DRIVE_Z - 8), inset(2, -90)], 0.35, 3, wall);

    // ---- West entrance range, porch and dome ----
    block(30, 56, -38, 38, ENTRANCE_ROOF);
    block(50, 64, -8.5, 8.5, 9.2);
    for (const z of [-4.9, 0, 4.9]) pane(kit.pointedArch(3.7, 6), [64.12, 0.5, z], "west");
    for (const side of [-1, 1]) {
      // The verandah either side of the porch, and the jali screen beyond it.
      pane(kit.rectPane(20, 3.7), [56.12, 1.1, side * 19.4], "west");
      for (let pier = 0; pier <= 5; pier++) addBox(group, [0.5, 3.9, 0.7], [56.3, 3, side * (9.4 + pier * 4)], wall);
      pane(kit.rectPane(5.4, 4.6), [56.12, 1, side * 33.6], "west", jali);
      // The end walls of the range: two screens and a door.
      const face = side === 1 ? "north" : "south";
      for (const x of [36.5, 50]) pane(kit.rectPane(6.6, 4.4), [x, 1.1, side * 38.12], face, jali);
      pane(kit.rectPane(1.8, 3), [43.2, 0.4, side * 38.12], face);
    }
    block(DOME_X - 8, DOME_X + 8, -8, 8, DOME_BASE, ENTRANCE_ROOF);
    addCylinder(group, 5.2, 5.2, 2.9, [DOME_X, DOME_BASE + 1.45, 0], wall, 16);
    for (let index = 0; index < 12; index++) {
      const angle = (index / 12) * Math.PI * 2;
      addMesh(group, kit.roundArch(1.3, 1.9), dark, [DOME_X + Math.sin(angle) * 5.3, DOME_BASE + 0.6, Math.cos(angle) * 5.3], angle);
    }
    addCylinder(group, 6.4, 5.4, 0.4, [DOME_X, DOME_BASE + 3.1, 0], roof, 16);
    kit.addLathe(group, kit.domeProfile(4.9, 5.3, 0.04), 16, [DOME_X, DOME_BASE + 3.3, 0], wall);
    kit.addFinial(group, [DOME_X, DOME_BASE + 8.5, 0], 2.2, wall);
    // The national and presidential standards before the dome.
    for (const [z, flag] of [[-4.2, materials.lawn], [-6.8, flowers]] as const) {
      addCylinder(group, 0.12, 0.14, 12, [DOME_X + 9.5, ENTRANCE_ROOF + 6, z], roof, 5);
      addBox(group, [0.12, 1.5, 2.4], [DOME_X + 9.5, ENTRANCE_ROOF + 11, z + 1.3], flag);
    }

    // ---- Main block: arcade, upper verandah, stair towers ----
    block(-33, 30, -24.6, 19.5, MAIN_ROOF);
    block(-22, 19, 19.5, 27.7, 5.5, 0, 0.3);
    block(19, 30, 19.5, 23, ENTRANCE_ROOF);
    block(-30, -22, 19.5, 23.4, ENTRANCE_ROOF);
    for (let bay = 0; bay < 10; bay++) pane(kit.roundArch(3, 4.3), [-22 + 4.1 * (bay + 0.5), 0.3, 27.82], "north");
    // The sun-shade over the arcade.
    addBox(group, [42.6, 0.22, 3.2], [-1.5, 5.05, 29.3], roof).rotation.x = 0.12;
    // A row of blind arches on the wall above the arcade roof.
    for (let bay = 0; bay < 9; bay++) pane(kit.roundArch(2.2, 2.6), [-22 + 41 * ((bay + 0.5) / 9), 6.9, 19.62], "north", jali);
    // The south side, unseen in the references, gets one plain window band a
    // storey.
    for (const y of [1.6, 6.8]) pane(kit.rectPane(56, 2.2), [-1.5, y, -24.72], "south");
    block(-27, 24, -16, 12.5, PAVILION_ROOF, MAIN_ROOF + 0.35, 1.6);
    pane(kit.rectPane(48, 2.2), [-1.5, MAIN_ROOF + 0.75, 12.62], "north");
    for (let post = 0; post <= 12; post++) addBox(group, [0.45, 2.5, 0.45], [-25.5 + post * 4, MAIN_ROOF + 1.7, 12.8], wall);
    for (const x of [-30, 27]) {
      block(x - 3, x + 3, 2, 9, TOWER_TOP, MAIN_ROOF + 0.35, 0.35);
      pane(kit.rectPane(1.6, 2.6), [x, MAIN_ROOF + 2.4, 9.12], "north");
    }
    // A small chhatri, as kit.addChhatri draws it but with a white finial
    // (its default gold one would be a ninth material).
    {
      const [x, y, z, size] = [-8, PAVILION_ROOF + 0.35, -6, 3];
      addBox(group, [size * 1.15, size * 0.14, size * 1.15], [x, y + size * 0.07, z], wall);
      for (const cx of [-1, 1]) {
        for (const cz of [-1, 1]) addBox(group, [size * 0.13, size * 0.8, size * 0.13], [x + cx * size * 0.42, y + size * 0.5, z + cz * size * 0.42], wall);
      }
      addBox(group, [size * 1.3, size * 0.12, size * 1.3], [x, y + size * 0.96, z], wall);
      kit.addLathe(group, kit.domeProfile(size * 0.5, size * 0.62, 0.12, 7), 10, [x, y + size * 1.02, z], wall);
      kit.addFinial(group, [x, y + size * 1.62, z], size * 0.16, wall);
    }

    // ---- East range ----
    block(-60, -33, -40, 10, 9);
    block(-60, -38, 10, 36, 6);
    for (const x of [-55, -49, -43]) pane(kit.roundArch(2.4, 3.6), [x, 0.8, 36.12], "north");
    for (const y of [1.4, 5.4]) pane(kit.rectPane(44, 1.9), [-60.12, y, -15], "east");
    pane(kit.rectPane(22, 2.2), [-60.12, 1.6, 23], "east");

    // ---- The round building east of the palace ----
    const [rx, rz] = ROTUNDA;
    addCylinder(group, 24.5, 24.5, 8.5, [rx, 4.25, rz], wall, 28);
    for (const y of [2.6, 6.2]) addCylinder(group, 24.62, 24.62, 1.5, [rx, y, rz], dark, 28);
    addCylinder(group, 25.6, 25.6, 0.4, [rx, 8.7, rz], roof, 28);
    addCylinder(group, 13, 13, 1.8, [rx, 9.8, rz], wall, 20);
    addCylinder(group, 13.6, 13.6, 0.3, [rx, 10.85, rz], roof, 20);

    // ---- Colliders ----
    kit.setBoundsCollider(false);
    kit.solidTiles(30, 56.5, -38.5, 38.5, ENTRANCE_ROOF + 0.4, 14);
    kit.solidBox(60, 0, 4.5, 9, 9.6);
    kit.solid(DOME_X, 0, 8.5, DOME_BASE + 0.4);
    kit.solid(DOME_X, 0, 5.4, DOME_BASE + 8.6);
    kit.solidTiles(-33.5, 30, -25, 19.5, MAIN_ROOF + 0.4, 16);
    kit.solidTiles(-30, 30, 19.5, 28, ENTRANCE_ROOF + 0.4, 12);
    kit.solidTiles(-28.5, 25.5, -17.5, 14, PAVILION_ROOF + 0.4, 14);
    for (const x of [-30, 27]) kit.solid(x, 5.5, 3.5, TOWER_TOP + 0.4);
    kit.solidTiles(-60.5, -33.5, -40.5, 10, 9.4, 14);
    kit.solidTiles(-60.5, -38, 10, 36.5, 6.4, 13);
    kit.solid(rx, rz, 20, 9.2);

    // ---- Open ground the park's trees must keep off ----
    kit.clearSite(0, -1, 76, 54);
    kit.clearSite(0, 108, 78, 62);
    kit.clearSite(ISLAND[0], ISLAND[1], 36, 30);
    for (let x = 140; x < ROAD[1][0]; x += 36) kit.clearSite(x + 4, DRIVE_Z, 18, 8);
    kit.clearSite(rx, rz, 32, 32);
    for (let index = 0; index + 1 < ROAD.length; index++) {
      const [ax, az] = ROAD[index];
      const [bx, bz] = ROAD[index + 1];
      const steps = Math.max(1, Math.round(Math.abs(bz - az) / 20));
      for (let step = 0; step < steps; step++) {
        const t = (step + 0.5) / steps;
        kit.clearSite(ax + (bx - ax) * t - 2, az + (bz - az) * t, 9, Math.abs(bz - az) / steps / 2);
      }
    }

    // The origin is the main block's roof; the bird lands on the dome.
    kit.setPerchTarget(DOME_X, 0.01);
  },
};

export default landmark;
