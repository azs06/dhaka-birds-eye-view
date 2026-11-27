// Bangladesh Shilpakala Academy, Segunbagicha
//
// The national academy of fine and performing arts: a walled compound between
// Kakrail Road and Segunbagicha Road with a big central lawn. The National
// Theatre (Jatiya Natyashala) closes the lawn on the east, a tall blank
// yellow-cream box whose entrance has a broad marble stair under a
// stainless-steel space-frame canopy. The National Art Gallery (Jatiya
// Chitrashala), six storeys of pale concrete with ribbon windows, stands at
// the west end by Kakrail Road; the music, recitation and dance centre runs
// on a diagonal south of the lawn, and the open-air Nondonmancho stage sits
// between it and the theatre.
//
// Footprints are OpenStreetMap: compound way 1187734440, theatre way
// 376279393 (8 levels), gallery way 297636209 (6 levels, with the National
// Art Gallery node 3797289725 inside it), music and dance centre way
// 297635735 (the one snapshot building it replaces), lawn way 433044956 and
// the Nondonmancho relation 12791438 (yard way 433043884, stage way
// 949113342). The walls run 6.9° east of north. Colours are from photographs
// (cream and pale concrete, no exposed brick). Heights: theatre and gallery
// from their OSM levels; the music centre has no levels in OSM and no photo,
// so it is a plain prism of its footprint at an estimated four storeys.
// Which side of the theatre carries the canopy is not mapped; it is put on
// the west face, on the lawn, which is where the compound's plaza is.
//
// Local +Z points east (96.9°) toward Segunbagicha Road, +X north (6.9°)
// toward Kakrail Road's bend; the origin is the middle of the lawn.
import { headingFromBearing, type LandmarkModule, type PlanPoint } from "./kit";

// World-metre outlines (public/dhaka-map.json frame) from OSM.
const COMPOUND: PlanPoint[] = [
  [-1270.7, 4038.1], [-1276.2, 4118.7], [-1222.9, 4122], [-1226.1, 4166.8], [-1031.4, 4182.2], [-1024.8, 4084.8], [-1196.1, 4046],
];
const THEATRE: PlanPoint[] = [
  [-1068.6, 4078.4], [-1078, 4156.5], [-1073.5, 4167.8], [-1050.9, 4170.2], [-1051.5, 4176.1], [-1033.6, 4178], [-1030.3, 4147.4],
  [-1035.5, 4146.8], [-1031.2, 4107.5], [-1034.9, 4107.1], [-1034.4, 4103.3], [-1037.1, 4103], [-1036.7, 4099.4], [-1039, 4099.1],
  [-1038.6, 4095.7], [-1041.2, 4095.4], [-1040.8, 4091.5], [-1044.3, 4091.1], [-1043.1, 4081.5],
];
const GALLERY: PlanPoint[] = [
  [-1205.9, 4112], [-1201, 4052.8], [-1206.9, 4047.8], [-1213, 4047.3], [-1218, 4050.3], [-1261.6, 4045.2], [-1264, 4065.2],
  [-1268.5, 4066], [-1271, 4068.5], [-1272.5, 4074], [-1271.1, 4079.4], [-1265.9, 4082.3], [-1268.5, 4104.8], [-1245.6, 4107.4],
  [-1246.4, 4114.7], [-1243.3, 4119.2], [-1236, 4119.7], [-1232.5, 4115.6], [-1232.1, 4109.9],
];
const MUSIC_CENTRE: PlanPoint[] = [
  [-1147, 4145.7], [-1157.7, 4134.9], [-1157, 4132.5], [-1157.7, 4130], [-1159.7, 4128.9], [-1161.7, 4128.9], [-1162.9, 4131.8],
  [-1166.3, 4128.4], [-1171.7, 4133.6], [-1180, 4125.1], [-1183.4, 4128.3], [-1184.5, 4127.1], [-1181.1, 4123.8], [-1187.2, 4117.6],
  [-1193.7, 4123.9], [-1190.7, 4127.1], [-1192.6, 4128.9], [-1197.5, 4123.9], [-1205, 4131.1], [-1203.3, 4132.9], [-1205.4, 4135],
  [-1211.9, 4128.4], [-1225, 4141], [-1214, 4152.2], [-1208.3, 4146.8], [-1191.2, 4164.3], [-1175.5, 4149.1], [-1163.2, 4161.6],
  [-1155.7, 4154.2],
];
const LAWN: PlanPoint[] = [[-1144.6, 4077.2], [-1074.7, 4085.3], [-1080.3, 4133.2], [-1150.3, 4125.1]];
const STAGE_YARD: PlanPoint[] = [[-1137.4, 4160.8], [-1096.1, 4165.2], [-1092.6, 4133.8], [-1133.9, 4129.3]];
const STAGE: PlanPoint[] = [
  [-1116.9, 4157.3], [-1116.8, 4155.7], [-1121.5, 4155.2], [-1120.5, 4145.8], [-1108.7, 4147.1], [-1109.6, 4156.3], [-1114.1, 4155.9],
  [-1114.2, 4157.6],
];

const THEATRE_TOP = 25;
const GALLERY_TOP = 21;
const MUSIC_TOP = 15;

const inside = (x: number, z: number, polygon: PlanPoint[]) => {
  let hit = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const [xi, zi] = polygon[i];
    const [xj, zj] = polygon[j];
    if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) hit = !hit;
  }
  return hit;
};

const landmark: LandmarkModule = {
  key: "shilpakala-academy",
  label: "Bangladesh Shilpakala Academy",
  labelBn: "বাংলাদেশ শিল্পকলা একাডেমি",
  shortLabel: "BSA",
  lat: 23.734409,
  lon: 90.405516,
  altitude: THEATRE_TOP,
  heading: headingFromBearing(96.9),
  clearingRadius: 95,
  extents: [60, 125],
  replacesOsmBuildingIds: [297635735],
  triangleBudget: 5000,
  plotGap: 6,
  inspectDistance: 190,
  build(kit) {
    const { group, addBox, addPrism, materials } = kit;
    const theatreCream = materials.stationCream;
    const pale = materials.paleConcrete;
    const glass = materials.darkGlass;
    const steel = materials.silverPanel;
    const local = (points: PlanPoint[]) => points.map(([x, z]) => kit.worldToLocal(x, z));

    const compound = local(COMPOUND);
    const theatre = local(THEATRE);
    const gallery = local(GALLERY);
    const music = local(MUSIC_CENTRE);

    // Small solid boxes over the cells of a footprint (the music centre is
    // turned 45° to the rest, and the gallery and theatre are not rectangles).
    const solidFootprint = (points: PlanPoint[], top: number, cell = 8) => {
      const xs = points.map((p) => p[0]);
      const zs = points.map((p) => p[1]);
      const x0 = Math.min(...xs);
      const z0 = Math.min(...zs);
      const columns = Math.ceil((Math.max(...xs) - x0) / cell);
      const rows = Math.ceil((Math.max(...zs) - z0) / cell);
      for (let column = 0; column < columns; column++) {
        for (let row = 0; row < rows; row++) {
          const x = x0 + (column + 0.5) * cell;
          const z = z0 + (row + 0.5) * cell;
          if (inside(x, z, points)) kit.solidBox(x, z, cell / 2 - 0.4, cell / 2 - 0.4, top);
        }
      }
    };

    // A walled block: the mass, a roof slab inside the parapet and a dark
    // ribbon of windows round every storey listed.
    const block = (points: PlanPoint[], top: number, wall: typeof pale, ribbons: number[], ribbonHeight: number) => {
      addPrism(group, points, 0, top, wall);
      addPrism(group, kit.offsetPolygon(points, -0.7), top, 0.12, materials.roofGrey);
      const skin = kit.offsetPolygon(points, 0.1);
      for (const y of ribbons) addPrism(group, skin, y, ribbonHeight, glass);
    };

    // Ground: the compound's drives and yards, the lawn and the stage yard.
    addPrism(group, compound, 0.02, 0.06, materials.yardPaving);
    addPrism(group, local(LAWN), 0.05, 0.1, materials.lawn);
    addPrism(group, local(STAGE_YARD), 0.05, 0.08, materials.stoneStep);
    // Nondonmancho: the raised open-air stage.
    addPrism(group, local(STAGE), 0, 1.3, pale);

    // National Theatre: a tall, almost blank cream box (its stepped east
    // corner comes from the footprint), the glazed lobby on the lawn side, a
    // marble stair up to it and the space-frame canopy over the doors.
    block(theatre, THEATRE_TOP, theatreCream, [], 0);
    const lobbyFace = 47.4;
    addBox(group, [34, 6.2, 0.3], [-14, 4.6, lobbyFace - 0.1], glass);
    addBox(group, [40, 1.5, 3.4], [-14, 0.75, lobbyFace - 1.7], pale);
    for (let step = 1; step <= 3; step++) {
      const rise = 1.5 * (1 - step / 4);
      addBox(group, [40, rise, 0.8], [-14, rise / 2, lobbyFace - 3.4 - (step - 0.5) * 0.8], pale);
    }
    const CANOPY_Y = 9.2;
    addBox(group, [36, 0.22, 9], [-14, CANOPY_Y + 1.2, lobbyFace - 4.5], steel);
    for (let index = 0; index <= 6; index++) {
      addBox(group, [0.3, 0.3, 9], [-32 + index * 6, CANOPY_Y, lobbyFace - 4.5], steel);
    }
    for (const z of [lobbyFace - 8.8, lobbyFace - 4.5]) addBox(group, [36, 0.3, 0.3], [-14, CANOPY_Y, z], steel);
    for (let index = 0; index < 6; index++) {
      const x = -29 + index * 6;
      kit.addBeam(group, [x, CANOPY_Y, lobbyFace - 8.8], [x + 3, CANOPY_Y + 1.1, lobbyFace - 6.6], 0.16, 0.16, steel);
      kit.addBeam(group, [x + 3, CANOPY_Y + 1.1, lobbyFace - 6.6], [x + 6, CANOPY_Y, lobbyFace - 4.5], 0.16, 0.16, steel);
    }
    solidFootprint(theatre, THEATRE_TOP);

    // National Art Gallery: six storeys of pale concrete, a recessed ground
    // floor and long ribbon windows, with stair and tank houses on the roof.
    block(gallery, GALLERY_TOP, pale, [1.4, 8.4, 12, 15.6], 1.7);
    addBox(group, [9, 3.2, 7], [10, GALLERY_TOP + 1.6, -132], pale);
    addBox(group, [6, 2.6, 6], [-12, GALLERY_TOP + 1.3, -96], pale);
    solidFootprint(gallery, GALLERY_TOP + 1);

    // Music, recitation and dance centre on its diagonal.
    block(music, MUSIC_TOP, pale, [1.4, 5.2, 9, 12.4], 1.4);
    solidFootprint(music, MUSIC_TOP, 6);

    // A low boundary wall round the compound.
    const wallPath = [...compound, compound[0]].map(([x, z]) => [x, 2.2, z] as [number, number, number]);
    kit.addSweptBox(group, wallPath, 0.18, 2.2, pale);

    // Trees along the lawn's long edges.
    const trees: PlanPoint[] = [[-33, -22], [-33, -6], [-33, 10], [-33, 25], [-36, 37], [25, -20], [25, -2], [25, 16], [25, 33]];
    trees.forEach(([x, z], index) => kit.addTree(group, x, z, 3.6 + (index % 3) * 0.7, 4.6));

    // Keep the generic city off the compound (tiles, so the Matshya Bhaban in
    // the compound's south-west notch stays).
    const cell = 13;
    for (let x = -80; x < 46; x += cell) {
      for (let z = -160; z < 98; z += cell) {
        const cx = x + cell / 2;
        const cz = z + cell / 2;
        if (inside(cx, cz, compound)) kit.clearSite(cx, cz, cell / 2, cell / 2);
      }
    }

    kit.setBoundsCollider(false);
    kit.setPerchTarget(-14, 70);
  },
};

export default landmark;
