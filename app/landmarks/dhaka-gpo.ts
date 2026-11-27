// Dhaka General Post Office (GPO)
//
// The 1960s head post office at Zero Point, west of Baitul Mukarram: long
// four-storey ranges in cream with every floor slab picked out in post-office
// red, slim vertical fins between the windows, a folded-plate canopy over the
// public entrance and a palm garden on the Zero Point side.
//
// OSM way 223081768 ("GPO", amenity=post_office) gives the plan used here
// vertex for vertex: a 76 m × 217 m comb whose sides run 1°/91° — a west range
// and a south range, a long east range reaching north toward Baitul Mukarram
// Road, and short cross wings — round a service court open to the north. The
// way is not in the bundled snapshot, so nothing is listed as replaced.
//
// The canopy front is the south range: in the reference photos (Commons:
// "Dhaka GPO.jpeg", "GPO in gulistan.jpg", "GPO, gulistan.jpg", "GPO
// dhaka.jpg") Baitul Mukarram's arches show beyond the right-hand end of that
// front and the Secretariat towers beyond its left, which only fits a view
// north from Zero Point. Storey heights and the canopy's exact place along
// the front are read from those photos, not measured.
//
// Local +Z looks south to Zero Point; +X runs east.
import { headingFromBearing, type LandmarkModule, type PlanPoint } from "./kit";

// OSM way 223081768 in the snapshot's world metres.
const FOOTPRINT: PlanPoint[] = [
  [-581.1, 4654.7], [-558.9, 4655.1], [-560.6, 4751.9], [-566.8, 4751.8], [-567.1, 4768.2], [-524.1, 4769.0],
  [-523.6, 4740.8], [-517.1, 4740.9], [-516.9, 4731.4], [-533.3, 4731.1], [-532.4, 4680.1], [-516.5, 4680.4],
  [-516.3, 4671.4], [-548.2, 4670.8], [-548.0, 4655.1], [-516.3, 4655.6], [-516.0, 4634.4], [-522.4, 4634.3],
  [-521.6, 4591.6], [-504.1, 4591.9], [-507.9, 4809.2], [-583.7, 4807.9],
];
const STOREY = 3.9;
const STOREYS = 4;
const ROOF = STOREY * STOREYS;

const landmark: LandmarkModule = {
  key: "dhaka-gpo",
  label: "Dhaka GPO",
  labelBn: "ঢাকা জিপিও",
  shortLabel: "GPO",
  lat: 23.728981,
  lon: 90.41116,
  altitude: 18,
  heading: headingFromBearing(181),
  clearingRadius: 110,
  extents: [39, 109],
  triangleBudget: 4000,
  plotGap: 8,
  build(kit) {
    const { group, addBox, addPrism, addOnWall, rectPane, materials } = kit;
    const wall = kit.material(0xeadfb6, { roughness: 0.86 });
    const red = kit.material(0xc0392f, { roughness: 0.8 });
    const grille = kit.material(0x7a2f28, { roughness: 0.9 });
    const sign = kit.litMaterial(0xd42a22, 0.6, 0xff6a50);

    const plan = FOOTPRINT.map(([x, z]) => kit.worldToLocal(x, z));
    const edges = kit.wallEdges(plan);

    // The ranges, a grey roof inside the parapet, and a red line at every
    // floor slab and along the parapet.
    addPrism(group, plan, 0, ROOF + 0.9, wall);
    addPrism(group, kit.offsetPolygon(plan, -0.7), ROOF + 0.9, 0.12, materials.roofGrey);
    for (let floor = 1; floor <= STOREYS; floor++) {
      addPrism(group, kit.offsetPolygon(plan, 0.32), floor * STOREY - 0.22, 0.44, red);
    }

    // Windows as one dark strip per storey on every wall; the ground storey
    // is the red-painted grille work of the counters and sorting halls.
    for (const edge of edges) {
      if (edge.length < 6) continue;
      const width = edge.length - 2;
      addOnWall(group, edge, edge.length / 2, 0.5, rectPane(width, 2.7), grille, 0.1);
      for (let floor = 1; floor < STOREYS; floor++) {
        addOnWall(group, edge, edge.length / 2, floor * STOREY + 1, rectPane(width, 1.9), materials.darkGlass, 0.1);
      }
    }
    // The fins: on the three long street fronts only.
    kit.addBays(group, edges.filter((edge) => edge.length > 60), {
      bay: 4.6,
      storeys: [],
      opening: materials.darkGlass,
      margin: 1,
      pier: { width: 0.5, depth: 0.8, bottom: 0, top: ROOF, material: wall },
    });

    // Local landmarks of the plan, from the same OSM vertices.
    const [southWestX, southZ] = kit.worldToLocal(-583.7, 4807.9);
    const [southEastX] = kit.worldToLocal(-507.9, 4809.2);
    const frontX = (southWestX + southEastX) / 2;
    const front = southZ + 0.3;

    // Stair heads on the roof.
    const [westRoofX, westRoofZ] = kit.worldToLocal(-571, 4700);
    const [eastRoofX, eastRoofZ] = kit.worldToLocal(-512, 4620);
    addBox(group, [9, 3.2, 7], [westRoofX, ROOF + 2.5, westRoofZ], wall);
    addBox(group, [7, 3.2, 9], [eastRoofX, ROOF + 2.5, eastRoofZ], wall);
    addBox(group, [9, 3.2, 7], [frontX + 14, ROOF + 2.5, front - 20], wall);

    // The folded-plate entrance canopy: five gables side by side on posts.
    const FOLD = 5.2;
    const CANOPY_DEPTH = 8.5;
    for (let fold = -2; fold <= 2; fold++) {
      for (const side of [-1, 1]) {
        const plate = addBox(group, [FOLD / 2 + 0.35, 0.28, CANOPY_DEPTH], [frontX + fold * FOLD + side * FOLD / 4, 4.35, front + CANOPY_DEPTH / 2], wall);
        plate.rotation.z = -side * 0.42;
      }
      addBox(group, [FOLD, 0.5, 0.3], [frontX + fold * FOLD, 3.5, front + CANOPY_DEPTH - 0.1], red);
    }
    for (let post = -2; post <= 3; post++) {
      addBox(group, [0.45, 3.9, 0.45], [frontX + (post - 0.5) * FOLD, 1.95, front + CANOPY_DEPTH - 0.6], wall);
    }
    // The red GPO board above the canopy.
    addBox(group, [8, 1.7, 0.35], [frontX, 6.9, front + 0.5], sign);
    addBox(group, [8.5, 0.25, 0.4], [frontX, 7.9, front + 0.5], wall);

    // The garden between the front and Zero Point, with its royal palms.
    const [gardenWestX, gardenNorthZ] = kit.worldToLocal(-572, 4811);
    const [gardenEastX, gardenSouthZ] = kit.worldToLocal(-510, 4829);
    const gardenX = (gardenWestX + gardenEastX) / 2;
    const gardenZ = (gardenNorthZ + gardenSouthZ) / 2;
    const gardenHalfX = Math.abs(gardenEastX - gardenWestX) / 2;
    const gardenHalfZ = Math.abs(gardenSouthZ - gardenNorthZ) / 2;
    addBox(group, [gardenHalfX * 2, 0.1, gardenHalfZ * 2], [gardenX, 0.05, gardenZ], materials.lawn);
    addBox(group, [FOLD * 5, 0.14, gardenHalfZ * 2], [frontX, 0.07, gardenZ], materials.roofTerrace);
    for (const offset of [-26, -17, 17, 26]) kit.addPalm(group, frontX + offset, gardenZ + 2, 15, 0.03, offset);
    kit.clearSite(gardenX, gardenZ, gardenHalfX + 2, gardenHalfZ + 1);

    // Each range is its own solid so the court stays open to the bird.
    kit.setBoundsCollider(false);
    const solidRange = (ax: number, az: number, bx: number, bz: number) => {
      const [x0, z0] = kit.worldToLocal(ax, az);
      const [x1, z1] = kit.worldToLocal(bx, bz);
      kit.solidTiles(Math.min(x0, x1), Math.max(x0, x1), Math.min(z0, z1), Math.max(z0, z1), ROOF + 1, 40);
    };
    solidRange(-583.7, 4654.7, -559.5, 4808);
    solidRange(-583.7, 4768.5, -507.9, 4809);
    solidRange(-522.4, 4591.7, -504.5, 4809);
    solidRange(-533.3, 4680.2, -516.5, 4731.2);
    solidRange(-548.1, 4655.2, -516.3, 4671.2);
    // The service court and the yard north of the west range.
    const [courtX0, courtZ0] = kit.worldToLocal(-558, 4673);
    const [courtX1, courtZ1] = kit.worldToLocal(-535, 4767);
    kit.clearSite((courtX0 + courtX1) / 2, (courtZ0 + courtZ1) / 2, Math.abs(courtX1 - courtX0) / 2, Math.abs(courtZ1 - courtZ0) / 2);
    // The origin is in the court: perch on the west range.
    kit.setPerchTarget(westRoofX, westRoofZ);
  },
};

export default landmark;
