// Dhaka Gate (Mir Jumla's Gate / Ramna Gate)
//
// The 17th-century north gate of Mughal Dhaka, rebuilt in 1825: round yellow
// lime-plastered columns under square caps, with low wing walls pierced by
// half-oval jali screens. It survives in three pieces across Kazi Nazrul
// Islam Avenue between Doyel Chattar and TSC — columns and wall on the west
// verge (the Renewable Energy Research Centre side), a lone column on the
// median, and columns and wall on the east verge, at the foot of the Three
// Leaders' Mausoleum garden.
//
// OSM relation 13199146 maps the west block (23.728469, 90.399773) and the
// median column (23.728527, 90.399845): they lie on a line square to the
// avenue (which runs 318°), 9.6 m apart. The game draws each carriageway
// (snapshot ways 24403456 and 669974794, centrelines 10.9 m apart) 14 m wide
// with traffic both ways, so its asphalt is 25 m across with no median strip
// and cars run where the median column stands. The origin is that spot,
// midway between the two centrelines, but the lone column is left out: only
// the two wing pieces are built, just clear of the asphalt edge (x = ±12.5)
// rather than at their surveyed 11 m. Everything is drawn about 1.3× life
// size, as the other roadside monuments are, to read from the air. The MRT
// Line 6 viaduct passes overhead between x = 2 and x = 13.
//
// Local +X runs along the gate line toward the NE (the mausoleum side);
// local +Z looks SE down the avenue to Doyel Chattar.
import { headingFromBearing, type LandmarkModule } from "./kit";

const COLUMN_TOP = 7.1;
const WALL_TOP = 3.6;
// Nearest and furthest column of each wing, and the far end of its wall.
const INNER_COLUMN = 14.3;
const OUTER_COLUMN = 21.1;
const WALL_END = 26.6;

const landmark: LandmarkModule = {
  key: "dhaka-gate",
  label: "Dhaka Gate",
  labelBn: "ঢাকা গেট",
  shortLabel: "DGT",
  lat: 23.728536,
  lon: 90.399855,
  altitude: 7.5,
  heading: headingFromBearing(137.7),
  clearingRadius: 20,
  extents: [27, 2],
  triangleBudget: 1500,
  // The pieces stand on road verges; nothing needs a forecourt.
  plotGap: 4,
  inspectDistance: 62,
  build(kit) {
    const { group, addBox, addLathe, addMesh, rectPane, materials } = kit;
    const plaster = kit.material(0xdcb655, { roughness: 0.9 });
    const moulding = kit.material(0xecd590, { roughness: 0.86 });
    const jali = kit.material(0x7a5b26, { roughness: 0.95 });
    const hole = kit.material(0x2c2114, { roughness: 1 });

    // A column: square plinth, torus base, plain shaft, necking, a flared
    // capital and a broad square abacus under a low stepped cap.
    const column = (x: number) => {
      addBox(group, [2.3, 0.5, 2.3], [x, 0.25, 0], moulding);
      addLathe(group, [
        [1.08, 0.5], [1.08, 0.82], [0.86, 0.98], [0.8, 5.5], [0.95, 5.66], [0.8, 5.84], [0.8, 6.15], [1.12, 6.5],
      ], 10, [x, 0, 0], plaster);
      addBox(group, [2.6, 0.34, 2.6], [x, 6.67, 0], moulding);
      addBox(group, [1.9, 0.26, 1.9], [x, COLUMN_TOP - 0.13, 0], plaster);
      kit.solid(x, 0, 1.3, COLUMN_TOP);
    };

    // The half-oval jali hanging from the cornice: a darker screen with a
    // chequer of openings, the same on both faces of the wall.
    const SCREEN_HALF_WIDTH = 1.75;
    const SCREEN_DROP = 1.7;
    const screenShape = new kit.THREE.Shape();
    screenShape.moveTo(SCREEN_HALF_WIDTH, 0);
    screenShape.absellipse(0, 0, SCREEN_HALF_WIDTH, SCREEN_DROP, 0, Math.PI, true);
    screenShape.lineTo(SCREEN_HALF_WIDTH, 0);
    const screen = (x: number) => {
      const top = WALL_TOP - 0.62;
      for (const face of [1, -1]) {
        const turn = face === 1 ? 0 : Math.PI;
        addMesh(group, new kit.THREE.ShapeGeometry(screenShape, 6), jali, [x, top, face * 0.43], turn);
        for (let row = 0; row < 3; row++) {
          for (let cell = -3 + (row % 2); cell <= 3; cell += 2) {
            const cx = cell * 0.4;
            const cy = -0.22 - row * 0.42;
            if ((cx * cx) / (SCREEN_HALF_WIDTH * SCREEN_HALF_WIDTH) + (cy * cy) / (SCREEN_DROP * SCREEN_DROP) > 0.62) continue;
            addMesh(group, rectPane(0.3, 0.3), hole, [x + face * cx, top + cy - 0.15, face * 0.47], turn);
          }
        }
      }
    };

    // A stretch of wing wall between x0 and x1: moulded plinth, plastered
    // wall, a stepped cornice, and one jali screen.
    const wall = (x0: number, x1: number) => {
      const length = Math.abs(x1 - x0);
      const centre = (x0 + x1) / 2;
      addBox(group, [length, 0.55, 1.3], [centre, 0.275, 0], moulding);
      addBox(group, [length, WALL_TOP - 0.85, 0.8], [centre, 0.55 + (WALL_TOP - 0.85) / 2, 0], plaster);
      addBox(group, [length, 0.3, 1.2], [centre, WALL_TOP - 0.15, 0], moulding);
      screen(centre);
    };

    for (const side of [-1, 1]) {
      // A paved verge under the wing, a step above the footpath.
      addBox(group, [WALL_END - INNER_COLUMN + 3.2, 0.12, 4.4], [side * (INNER_COLUMN + WALL_END + 0.6) / 2, 0.06, 0], materials.roofTerrace);
      column(side * INNER_COLUMN);
      wall(side * (INNER_COLUMN + 0.75), side * (OUTER_COLUMN - 0.75));
      column(side * OUTER_COLUMN);
      wall(side * (OUTER_COLUMN + 0.75), side * WALL_END);
      // The wall's square end pier.
      addBox(group, [1, WALL_TOP + 0.3, 1.3], [side * (WALL_END + 0.5), (WALL_TOP + 0.3) / 2, 0], plaster);
      addBox(group, [1.3, 0.24, 1.6], [side * (WALL_END + 0.5), WALL_TOP + 0.42, 0], moulding);
      const x0 = Math.min(side * (INNER_COLUMN + 1), side * (WALL_END + 1));
      const x1 = Math.max(side * (INNER_COLUMN + 1), side * (WALL_END + 1));
      kit.solidTiles(x0, x1, -0.7, 0.7, WALL_TOP, 3.2);
      kit.clearSite(side * (INNER_COLUMN + WALL_END) / 2, 0, (WALL_END - INNER_COLUMN) / 2 + 2.5, 3.5);
    }

    // The default extents box would wall off the avenue: each piece carries
    // its own collider above. The origin is mid-road, so the bird perches on
    // the west wing's roadside column.
    kit.setBoundsCollider(false);
    kit.setPerchTarget(-INNER_COLUMN, 0);
  },
};

export default landmark;
