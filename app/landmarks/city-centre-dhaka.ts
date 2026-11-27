// City Centre Dhaka, Motijheel
//
// The sea-green glass office tower on Motijheel Road, 37 storeys and about
// 171 m: a round glass drum that rises clear of squarer glass shoulders and
// ends in a thin projecting disc with a small frame and mast on top.
//
// OSM way 686702285 ("City center") gives the plot: a 39.8 m × 42 m rectangle
// whose long sides run 31°/211°, centred on 23.729275, 90.417604, with its
// south-west side on Motijheel Road. (Its tags say height 118 and levels
// "47qrq"; the published figure of 171 m is used instead.) The footprint's
// road side is only 6.6 m from the snapshot centreline of the road, which the
// game draws 14 m wide, so the base is held 1.6 m back from that edge.
//
// The references (Commons: "City Centre skyscraper in Motijheel, Dhaka",
// "City Center View From Dainik Bangla More", "City Centre.jpg") show the
// upper tower only. The street-level base is therefore a plain block, and the
// arrangement of the shoulders round the drum is a reading of those distant
// views rather than a survey.
//
// Local +Z looks south-west across Motijheel Road; +X runs north-west.
import { headingFromBearing, type LandmarkModule } from "./kit";

const PODIUM_TOP = 18;
const DRUM_TOP = 160;
const DRUM_RADIUS = 15.5;
// The drum's centre, a metre behind the middle of the plot.
const DRUM_Z = -1;

const landmark: LandmarkModule = {
  key: "city-centre-dhaka",
  label: "City Centre Dhaka",
  labelBn: "সিটি সেন্টার ঢাকা",
  shortLabel: "CCD",
  lat: 23.729275,
  lon: 90.417604,
  altitude: 171,
  heading: headingFromBearing(211),
  clearingRadius: 34,
  extents: [20, 21],
  replacesOsmBuildingIds: [686702285],
  triangleBudget: 4000,
  // The tower fills its plot; neighbours stand close on three sides.
  plotGap: 6,
  build(kit) {
    const { group, addBox, addCylinder, materials } = kit;
    const glass = kit.litMaterial(0x5aa79d, 0.3, 0xffe2b0);
    const paleGlass = kit.litMaterial(0x7dbdb2, 0.3, 0xffe2b0);
    const mullion = kit.material(0x356f6b, { roughness: 0.6, metalness: 0.2 });
    const frame = materials.paleConcrete;

    // Street-level base: a plain four-storey block with ribbon glazing.
    addBox(group, [39, PODIUM_TOP, 40], [0, PODIUM_TOP / 2, -1], frame);
    for (let storey = 0; storey < 4; storey++) {
      addBox(group, [39.2, 2.2, 37], [0, 2.6 + storey * 4.2, -1], materials.darkGlass);
      addBox(group, [36, 2.2, 40.2], [0, 2.6 + storey * 4.2, -1], materials.darkGlass);
    }

    // The drum, with a darker ring every few storeys.
    addCylinder(group, DRUM_RADIUS, DRUM_RADIUS, DRUM_TOP - PODIUM_TOP, [0, (DRUM_TOP + PODIUM_TOP) / 2, DRUM_Z], glass, 28);
    for (let ring = 1; ring <= 7; ring++) {
      addCylinder(group, DRUM_RADIUS + 0.18, DRUM_RADIUS + 0.18, 0.7, [0, PODIUM_TOP + ring * 18.5, DRUM_Z], mullion, 28);
    }
    // Two pale vertical piers on the road face of the drum.
    for (const side of [-1, 1]) {
      addBox(group, [1.3, DRUM_TOP - PODIUM_TOP - 12, 1.4], [side * 5.2, (DRUM_TOP + PODIUM_TOP - 12) / 2, DRUM_Z + 14.2], frame);
    }

    // Squarer glass shoulders gripping the drum: a tall pair behind, a lower
    // pair on the road side and a still lower block between them.
    const shoulder = (x0: number, x1: number, z0: number, z1: number, top: number, material = glass) => {
      const sx = x1 - x0;
      const sz = z1 - z0;
      addBox(group, [sx, top - PODIUM_TOP, sz], [(x0 + x1) / 2, (top + PODIUM_TOP) / 2, (z0 + z1) / 2], material);
      for (let y = PODIUM_TOP + 18.5; y < top - 4; y += 18.5) {
        addBox(group, [sx + 0.3, 0.7, sz + 0.3], [(x0 + x1) / 2, y, (z0 + z1) / 2], mullion);
      }
      addBox(group, [sx + 0.5, 0.8, sz + 0.5], [(x0 + x1) / 2, top + 0.4, (z0 + z1) / 2], frame);
    };
    shoulder(-18.5, -4, -20, -5, 146);
    shoulder(4, 18.5, -20, -5, 146);
    shoulder(-18.5, -5, 3, 17, 134);
    shoulder(5, 18.5, 3, 17, 134);
    shoulder(-7.5, 7.5, 9, 18.5, 94, paleGlass);

    // The crown: a thin projecting disc, a set-back glazed ring, and the
    // small roof frame with its mast.
    addCylinder(group, DRUM_RADIUS + 2, DRUM_RADIUS + 2, 1.3, [0, DRUM_TOP + 0.65, DRUM_Z], frame, 28);
    addCylinder(group, 8, 8, 3, [0, DRUM_TOP + 2.8, DRUM_Z], mullion, 16);
    for (const [px, pz] of [[-2.2, -2.2], [2.2, -2.2], [-2.2, 2.2], [2.2, 2.2]]) {
      addBox(group, [0.35, 4, 0.35], [px, DRUM_TOP + 6.3, DRUM_Z + pz], frame);
    }
    addBox(group, [6, 0.4, 6], [0, DRUM_TOP + 8.5, DRUM_Z], frame);
    addBox(group, [0.3, 2.4, 0.3], [0, DRUM_TOP + 9.8, DRUM_Z], frame);

    // The plot is turned 31° from the map axes, so the tower is tiled with
    // small colliders instead of one over-wide box.
    kit.setBoundsCollider(false);
    kit.solidTiles(-19.5, 19.5, -21, 19, PODIUM_TOP, 10);
    kit.solidTiles(-18.5, 18.5, -20, 18, 140, 10);
    kit.solid(0, DRUM_Z, 11, DRUM_TOP + 2);
  },
};

export default landmark;
