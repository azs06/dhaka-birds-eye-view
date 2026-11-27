// Bangla Academy (Burdwan House)
//
// Burdwan House, the white colonial block the Bangla Academy has occupied
// since 1955: a tall, narrow three-storey house with string courses between
// the floors, a heavy cornice, arched shuttered windows down both long sides
// and a half-round columned porch with a balustraded balcony at each end. The
// east end, facing the lawn and Kazi Nazrul Islam Avenue, carries the
// academy's round emblem on its blank top storey. On the grounds are the
// banyan that shades the Nazrul Mancha stage, and Moder Gorob ("Our Pride"),
// the monument to the five language martyrs, between the house and the pond.
//
// Plan from OSM way 381049769 (17.6 × 35 m with a stair bay on each long
// side and a 3.5 m-radius porch at each end; long axis 112.6°/292.6°). The
// height comes from the frontal photograph (0.95 × the 17.6 m width). The
// lawn is OSM way 507722588, the trees are OSM tree nodes, the stage is node
// 6255748818 and the monument node 6255748752. The academy's pond (way
// 665081371) is already drawn from the map snapshot and is left alone.
//
// Local +Z is the east porch front (112.6°); +X is to the north-east.
import { headingFromBearing, type LandmarkModule, type PlanPoint } from "./kit";

const X0 = -9;
const X1 = 8.3;
const CX = (X0 + X1) / 2;
const Z_BACK = -15.8;
const Z_FRONT = 19.2;
const FIRST_FLOOR = 5.2;
const SECOND_FLOOR = 10;
const TOP = 16.6;
const PORCH_RADIUS = 3.5;

const landmark: LandmarkModule = {
  key: "bangla-academy",
  label: "Bangla Academy",
  labelBn: "বাংলা একাডেমি",
  shortLabel: "BAC",
  lat: 23.730004,
  lon: 90.397442,
  altitude: 17,
  heading: headingFromBearing(112.6),
  clearingRadius: 45,
  extents: [9, 18],
  triangleBudget: 4000,
  plotGap: 6,
  build(kit) {
    const { group, addBox, addCylinder, addMesh, materials } = kit;
    const white = materials.whiteStone;
    const shutter = kit.material(0x5f6964, { roughness: 0.9 });
    const dark = materials.archDark;

    const clearTiles = (x0: number, x1: number, z0: number, z1: number, cell = 7) => {
      const columns = Math.max(1, Math.ceil((x1 - x0) / cell));
      const rows = Math.max(1, Math.ceil((z1 - z0) / cell));
      const halfX = (x1 - x0) / columns / 2;
      const halfZ = (z1 - z0) / rows / 2;
      for (let column = 0; column < columns; column++) {
        for (let row = 0; row < rows; row++) {
          kit.clearSite(x0 + (column * 2 + 1) * halfX, z0 + (row * 2 + 1) * halfZ, halfX, halfZ);
        }
      }
    };

    // The house: walls, string courses, cornice and a flat roof.
    const width = X1 - X0;
    const depth = Z_FRONT - Z_BACK;
    const cz = (Z_FRONT + Z_BACK) / 2;
    addBox(group, [width, TOP, depth], [CX, TOP / 2, cz], white);
    addBox(group, [width + 0.3, 0.7, depth + 0.3], [CX, 0.35, cz], white);
    for (const [y, thick, out] of [[FIRST_FLOOR, 0.3, 0.5], [SECOND_FLOOR - 0.9, 0.25, 0.4], [SECOND_FLOOR, 0.35, 0.6], [TOP - 1.9, 0.3, 0.5], [TOP - 0.9, 0.4, 1], [TOP - 0.25, 0.5, 1.5]] as Array<[number, number, number]>) {
      addBox(group, [width + out, thick, depth + out], [CX, y, cz], white);
    }
    addBox(group, [width - 1.2, 0.1, depth - 1.2], [CX, TOP + 0.03, cz], materials.roofTerrace);
    // The stair bays in the middle of each long side, with a verandah arch
    // on each of the lower floors.
    for (const [x0, x1, z0, z1] of [[X1, 12.1, -3.3, 4], [-12.4, X0, -3.9, 3]] as Array<[number, number, number, number]>) {
      const side = x0 > 0 ? 1 : -1;
      const bx = (x0 + x1) / 2;
      const bz = (z0 + z1) / 2;
      addBox(group, [x1 - x0 + 0.4, TOP - 0.6, z1 - z0], [bx - side * 0.2, (TOP - 0.6) / 2, bz], white);
      addBox(group, [x1 - x0 + 0.9, 0.4, z1 - z0 + 0.5], [bx - side * 0.2, TOP - 0.9, bz], white);
      const face = side > 0 ? x1 + 0.12 : x0 - 0.12;
      for (const y of [0.9, FIRST_FLOOR + 0.6]) addMesh(group, kit.roundArch(3.6, 3.9), dark, [face, y, bz], (side * Math.PI) / 2);
      addMesh(group, kit.roundArch(1.5, 3), shutter, [face, SECOND_FLOOR + 1.5, bz], (side * Math.PI) / 2);
      kit.solidTiles(x0, x1, z0, z1, TOP, 5);
    }
    kit.solidTiles(X0, X1, Z_BACK, Z_FRONT, TOP, 6);

    // Arched, shuttered windows on all three floors of the long sides, in
    // the wall on either side of the stair bay.
    const window = kit.roundArch(1.5, 3);
    const sideWalls: PlanPoint[][] = [
      [[X1, 5], [X1, Z_FRONT]],
      [[X1, Z_BACK], [X1, -4.3]],
      [[X0, 4], [X0, Z_FRONT]],
      [[X0, Z_BACK], [X0, -4.9]],
    ];
    for (const [[ax, az], [, bz]] of sideWalls) {
      const side = ax > 0 ? 1 : -1;
      const count = Math.max(1, Math.round((bz - az) / 4.4));
      for (let index = 0; index < count; index++) {
        const z = az + ((index + 0.5) * (bz - az)) / count;
        for (const y of [1.5, FIRST_FLOOR + 1.3, SECOND_FLOOR + 1.5]) {
          addMesh(group, window, shutter, [ax + side * 0.14, y, z], (side * Math.PI) / 2);
        }
      }
    }

    // An end front: red fan of steps, four columns on a half-round plan, a
    // half-round entablature and a balustraded balcony over it; the door
    // behind the columns, an arched balcony door above and a window on either
    // side on each of the two lower floors.
    const porch = (front: 1 | -1) => {
      const z = front > 0 ? Z_FRONT : Z_BACK;
      const turn = front > 0 ? 0 : Math.PI;
      const face = z + front * 0.14;
      addCylinder(group, 7, 7, 0.22, [CX, 0.11, z], materials.plazaRed, 12);
      addCylinder(group, 5.8, 5.8, 0.44, [CX, 0.22, z], materials.plazaRed, 12);
      addCylinder(group, 4.6, 4.6, 0.66, [CX, 0.33, z], materials.plazaRed, 12);
      for (const angle of [-1.22, -0.44, 0.44, 1.22]) {
        const x = CX + Math.sin(angle) * (PORCH_RADIUS - 0.4);
        const cz2 = z + front * Math.cos(angle) * (PORCH_RADIUS - 0.4);
        addCylinder(group, 0.34, 0.4, 4.1, [x, 0.66 + 2.05, cz2], white, 8);
      }
      addCylinder(group, PORCH_RADIUS + 0.2, PORCH_RADIUS + 0.2, 0.9, [CX, 5.2, z], white, 12);
      addCylinder(group, PORCH_RADIUS + 0.5, PORCH_RADIUS + 0.5, 0.25, [CX, 5.75, z], white, 12);
      kit.addArcSlab(group, PORCH_RADIUS - 0.25, PORCH_RADIUS + 0.2, front > 0 ? -Math.PI / 2 : Math.PI / 2, Math.PI, 5.85, 1, white, 12);
      addMesh(group, kit.roundArch(3.2, 3.9), dark, [CX, 0.7, face], turn);
      addMesh(group, kit.roundArch(3.4, 3.5), shutter, [CX, FIRST_FLOOR + 0.95, face], turn);
      for (const side of [-1, 1]) {
        addMesh(group, kit.roundArch(2.6, 3.1), shutter, [CX + side * 5.7, 1.2, face], turn);
        addMesh(group, kit.roundArch(1.5, 3), shutter, [CX + side * 5.7, FIRST_FLOOR + 1.6, face], turn);
      }
      kit.solid(CX, z + front * 1.4, PORCH_RADIUS, 7);
    };
    porch(1);
    porch(-1);
    // The academy's emblem on the blank top storey of the east front.
    addMesh(group, kit.discPane(1.75, 16), kit.material(0xb7a868, { roughness: 0.85 }), [CX, SECOND_FLOOR + 1.6, Z_FRONT + 0.14]);
    addMesh(group, kit.discPane(0.7, 12), white, [CX + 0.55, SECOND_FLOOR + 2.3, Z_FRONT + 0.2]);

    // The grounds: grass round the house and the mapped front lawn.
    addBox(group, [44, 0.08, 52], [0, 0.04, 1], materials.lawn);
    kit.addPrism(group, [[-32.2, 24.8], [9.1, 27.4], [7.9, 46.6], [-33.3, 44]], 0.02, 0.1, materials.lawn);

    // The banyan and the round Nazrul Mancha platform under it, then the
    // other mapped trees of the compound.
    addCylinder(group, 6, 6.3, 0.6, [28.5, 0.3, 27], materials.plazaBrick, 14);
    addCylinder(group, 5.6, 5.6, 0.08, [28.5, 0.64, 27], materials.roofTerrace, 14);
    kit.addTree(group, 29.3, 22.6, 9.5, 5.5);
    kit.addTree(group, 18.1, 19, 5, 4.5);
    const trees: PlanPoint[] = [[-20.6, -9.7], [-20.6, 8.9], [24.9, -15.7], [36.1, 5.4], [-31.4, -8.7], [-31, 2.3], [-32.5, 12.8], [-11.6, -39.8], [-20.4, -40]];
    trees.forEach(([x, z], index) => kit.addTree(group, x, z, 3.4 + (index % 3) * 0.6, 4));

    // Moder Gorob: a flared concrete pedestal, a terracotta relief drum
    // between white rings, five bronze busts, and the tall terracotta mural
    // slab in its white frame behind them.
    const MX = 9;
    const MZ = -38;
    const terracotta = materials.terracotta;
    kit.addLathe(group, [[2.2, 0], [2.3, 1.1], [3, 1.9]], 10, [MX, 0, MZ], materials.paleConcrete);
    addCylinder(group, 3.3, 3.3, 0.25, [MX, 2.02, MZ], white, 10);
    addCylinder(group, 3, 3, 1.3, [MX, 2.8, MZ], terracotta, 10);
    addCylinder(group, 3.3, 3.3, 0.25, [MX, 3.57, MZ], white, 10);
    addCylinder(group, 2.3, 2.3, 0.5, [MX, 3.95, MZ], white, 10);
    addBox(group, [4.4, 5.4, 0.5], [MX, 6.4, MZ - 1.5], white);
    addBox(group, [3.8, 4.9, 0.1], [MX, 6.35, MZ - 1.22], terracotta);
    for (const [bx, bz] of [[-2.2, 1], [-1.1, 0.2], [0, 1.6], [1.1, 0.2], [2.2, 1]]) {
      addBox(group, [0.9, 0.6, 0.6], [MX + bx, 4.5, MZ + bz], materials.bronze);
      addCylinder(group, 0.3, 0.3, 0.8, [MX + bx, 5.2, MZ + bz], materials.bronze, 6);
    }
    addCylinder(group, 5.2, 5.2, 0.1, [MX, 0.1, MZ], materials.yardPaving, 12);
    kit.solid(MX, MZ, 3.2, 9);

    clearTiles(-34, 38, -24, 47);
    clearTiles(2, 16, -44, -30);

    kit.setBoundsCollider(false);
  },
};

export default landmark;
