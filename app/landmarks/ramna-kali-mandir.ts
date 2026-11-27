// Ramna Kali Mandir
//
// The temple in the south-east corner of Suhrawardy Udyan, razed in 1971 and
// rebuilt with Indian support (inaugurated December 2021). The new mandir is
// an open ring pavilion on a red-brick plinth: grey round columns carry ten
// peach barrel vaults that radiate from the shrine, each ending in an arched
// gable, and a tall fluted saffron shikhara rises from the middle under a
// dark amalaka finial and trident (Commons: "রমনা কালী মন্দির 5.jpg",
// "Rebuilt Ramna Kali Mandir.jpg", "রমনা কালী মন্দির (চূড়া).jpg"). A long
// twin-vaulted shelter (OSM way 1151616627) runs SSE from the ring toward
// the Harichand temple, whose three grey ribbed spires sit on a small white
// shrine (way 1151616625; Commons photos of the Harichand mandir). The
// Loknath and Durga temples are mapped but have no photo here, so they are
// plain low white masses.
//
// OSM: temple way 1151616624 (snapshot building, replaced), centred on the
// origin; the Kali Mandir pond (way 297600618) lies west-south-west and is
// already drawn from the snapshot's water, so nothing is laid over it.
// Heading 0: local +X is east, local +Z is south (toward the shelter), so an
// OSM offset (E, N) is local (E, -N).
import type { LandmarkKit, LandmarkModule, Vec3 } from "./kit";

type Parent = Parameters<LandmarkKit["addBox"]>[0];
type Material = ReturnType<LandmarkKit["material"]>;

const PLINTH = 1.0;
const SPRING = 5.2;
const VAULT_R = 4.4;
// The vaults are segmental: a half-cylinder squashed to this rise ratio.
const VAULT_RISE = 0.55;
const RING_OUTER = 17;
const RING_INNER = 5;
const CORE_TOP = SPRING + VAULT_R * VAULT_RISE + 0.5;
const SPIRE_H = 13.6;
const SPIRE_TOP = CORE_TOP + SPIRE_H;

const landmark: LandmarkModule = {
  key: "ramna-kali-mandir",
  label: "Ramna Kali Mandir",
  labelBn: "রমনা কালী মন্দির",
  shortLabel: "RKM",
  lat: 23.731214,
  lon: 90.39955,
  altitude: 25,
  heading: 0,
  clearingRadius: 45,
  extents: [18, 18],
  replacesOsmBuildingIds: [1151616624],
  triangleBudget: 5000,
  plotGap: 6,
  inspectDistance: 70,
  build(kit) {
    const { THREE, group, addBox, addLathe, addMesh, addPrism, addBeam, materials } = kit;
    const vaultRoof = kit.material(0xecbd9f, { roughness: 0.85 });
    const vaultEnd = kit.material(0xd8987a, { roughness: 0.9 });
    const saffron = kit.material(0xe48d5f, { roughness: 0.8 });
    const column = kit.material(0x868b8c, { roughness: 0.8 });
    const finial = kit.material(0x3b3631, { roughness: 0.6, metalness: 0.3 });
    const spireGrey = column;
    const white = materials.whiteStone;
    const brick = materials.redBrick;
    const floor = materials.marble;

    // A barrel vault whose axis runs along local Z of `parent` after turning
    // by `turn`: the upper half of a closed cylinder, springing at `at`'s y.
    const vault = (parent: Parent, radius: number, length: number, at: Vec3, turn: number, material: Material) => {
      const geometry = new THREE.CylinderGeometry(radius, radius, length, 12, 1, false, Math.PI / 2, Math.PI);
      geometry.rotateX(Math.PI / 2);
      geometry.scale(1, VAULT_RISE, 1);
      return addMesh(parent, geometry, material, at, turn);
    };
    // A round column without end caps (they are never seen).
    const post = (parent: Parent, x: number, z: number, bottom: number, top: number) =>
      addMesh(parent, new THREE.CylinderGeometry(0.42, 0.42, top - bottom, 8, 1, true), column, [x, (top + bottom) / 2, z]);
    // The darker arched face drawn on a vault's open end.
    const archFace = (parent: Parent, radius: number, at: Vec3, turn: number) => {
      const geometry = new THREE.CircleGeometry(radius, 12, 0, Math.PI);
      geometry.scale(1, VAULT_RISE, 1);
      return addMesh(parent, geometry, vaultEnd, at, turn);
    };

    // ---- The ring pavilion ------------------------------------------------
    const decagon = (radius: number, offset = Math.PI / 10): Array<[number, number]> =>
      Array.from({ length: 10 }, (_, i) => {
        const a = offset + (i * Math.PI) / 5;
        return [radius * Math.sin(a), radius * Math.cos(a)];
      });
    addPrism(group, decagon(18.6), 0, PLINTH, brick);
    addPrism(group, decagon(18.3), PLINTH, 0.08, floor);
    // Marble steps up from the east (avenue) side.
    for (let step = 0; step < 4; step++) {
      const h = PLINTH - step * 0.25;
      addBox(group, [1.0, h, 9], [18.9 + step * 0.9, h / 2, 0], floor);
    }

    for (let i = 0; i < 10; i++) {
      const phi = (i * Math.PI) / 5;
      const sin = Math.sin(phi);
      const cos = Math.cos(phi);
      const mid = (RING_OUTER + RING_INNER) / 2;
      vault(group, VAULT_R, RING_OUTER - RING_INNER, [mid * sin, SPRING, mid * cos], phi, vaultRoof);
      archFace(group, VAULT_R - 0.45, [(RING_OUTER + 0.06) * sin, SPRING, (RING_OUTER + 0.06) * cos], phi);
      // Two columns under each gable's springing, and one on the inner ring.
      for (const side of [-1, 1]) {
        const px = RING_OUTER - 0.6;
        const lateral = side * (VAULT_R - 0.35);
        post(group, px * sin + lateral * cos, px * cos - lateral * sin, PLINTH, SPRING);
      }
      const inner = 8.5;
      const between = phi + Math.PI / 10;
      post(group, inner * Math.sin(between), inner * Math.cos(between), PLINTH, SPRING);
    }
    // Flat soffit under the vaults, seen on low passes.
    kit.addArcSlab(group, RING_INNER, RING_OUTER - 0.2, 0, Math.PI * 2, SPRING - 0.3, 0.3, vaultEnd, 20);

    // The shrine core under the spire: an octagonal grey drum with a peach
    // band, then the fluted shikhara and its finial.
    addLathe(group, [[4.6, PLINTH], [4.6, CORE_TOP], [0, CORE_TOP]], 8, [0, 0, 0], column, true);
    addLathe(group, [[4.75, CORE_TOP - 1.2], [4.75, CORE_TOP + 0.02], [0, CORE_TOP + 0.02]], 8, [0, 0, 0], vaultRoof, true);
    addLathe(group, [
      [0, 0], [4.2, 0], [3.75, SPIRE_H * 0.26], [3.0, SPIRE_H * 0.52], [2.0, SPIRE_H * 0.74], [1.0, SPIRE_H * 0.92], [0.55, SPIRE_H], [0, SPIRE_H],
    ], 8, [0, CORE_TOP, 0], saffron, true);
    // Raised flute edges on the eight arrises.
    for (let i = 0; i < 8; i++) {
      const a = (i * Math.PI) / 4;
      addBeam(group, [4.25 * Math.sin(a), CORE_TOP + 0.1, 4.25 * Math.cos(a)], [0.62 * Math.sin(a), SPIRE_TOP - 0.15, 0.62 * Math.cos(a)], 0.32, 0.32, saffron, 0);
    }
    // Amalaka stack, kalash and trident.
    addLathe(group, [
      [0, 0], [0.75, 0.05], [0.9, 0.4], [0.7, 0.75], [0.78, 1.0], [0.6, 1.3], [0.64, 1.5], [0.42, 1.8], [0.15, 2.0], [0, 2.05],
    ], 10, [0, SPIRE_TOP, 0], finial);
    addBox(group, [0.12, 1.1, 0.12], [0, SPIRE_TOP + 2.5, 0], finial);
    addBox(group, [0.8, 0.12, 0.12], [0, SPIRE_TOP + 2.75, 0], finial);
    for (const side of [-1, 0, 1]) addBox(group, [0.1, 0.45, 0.1], [side * 0.38, SPIRE_TOP + 3.0, 0], finial);

    // ---- The SSE shelter: twin lengthwise vaults on grey columns ----------
    // OSM corners (E, N): (4.0,-17.3) (-16.5,-23.9) (-4.8,-60.0) (15.7,-53.5).
    const shelterTurn = Math.atan2(11.7, 36.15);
    const shelter = new THREE.Group();
    shelter.position.set(-6.25, 0, 20.6);
    shelter.rotation.y = shelterTurn;
    group.add(shelter);
    const S_START = -2;
    const S_END = 36;
    const S_LEN = S_END - S_START;
    const S_MID = (S_START + S_END) / 2;
    const S_SPRING = SPRING - 0.3;
    addBox(shelter, [20.4, 0.6, S_LEN], [0, 0.3, S_MID], floor);
    for (const side of [-1, 1]) {
      vault(shelter, 5.0, S_LEN, [side * 5.0, S_SPRING, S_MID], 0, vaultRoof);
      archFace(shelter, 4.5, [side * 5.0, S_SPRING, S_END + 0.06], 0);
    }
    for (let z = S_START + 4; z <= S_END; z += 7.6) {
      for (const x of [-9.6, 0, 9.6]) post(shelter, x, z, 0.6, S_SPRING);
    }
    addBox(shelter, [20, 0.3, S_LEN], [0, S_SPRING - 0.15, S_MID], vaultEnd);

    // ---- Harichand temple: white shrine, three grey ribbed spires ---------
    // Way 1151616625, centred (E 24.4, N -74.6); it fronts north, on the
    // temple court.
    const hx = 24.4;
    const hz = 74.6;
    addBox(group, [13.4, 0.9, 13.6], [hx, 0.45, hz], floor);
    addBox(group, [12.2, 5.4, 11.6], [hx, 0.9 + 2.7, hz + 0.6], white);
    addBox(group, [13.0, 0.5, 12.4], [hx, 6.55, hz + 0.6], white);
    addBox(group, [12.4, 0.12, 0.2], [hx, 4.2, hz - 5.25], brick);
    for (const ax of [-3.4, 0, 3.4]) addMesh(group, kit.pointedArch(2.2, 3.1), finial, [hx + ax, 0.95, hz - 5.25], Math.PI);
    for (let step = 0; step < 3; step++) addBox(group, [9, 0.3, 0.7], [hx, 0.15 + step * 0.3, hz - 6.9 + step * 0.6], floor);
    const ribbedSpire = (x: number, z: number, base: number, height: number, y: number) => {
      addLathe(group, [[base * 1.12, 0], [base * 1.12, 0.7], [base * 0.98, 0.95], [0, 0.95]], 8, [x, y, z], white, true);
      addLathe(group, [
        [0, 0], [base, 0], [base * 0.86, height * 0.3], [base * 0.6, height * 0.62], [base * 0.28, height * 0.88], [0.08, height], [0, height],
      ], 12, [x, y + 0.95, z], spireGrey, true);
      addBox(group, [0.08, 0.9, 0.08], [x, y + 0.95 + height + 0.4, z], finial);
    };
    ribbedSpire(hx, hz + 1, 2.3, 8.6, 6.8);
    ribbedSpire(hx - 4.9, hz - 3.6, 1.15, 4.6, 6.8);
    ribbedSpire(hx + 4.9, hz - 3.6, 1.15, 4.6, 6.8);

    // ---- Loknath and Durga temples: plain low white shrines ---------------
    // Loknath way 1151616626 (E 5.6…18, N -14.8…-25.7), Durga way 507710013
    // (E 18.6…31.2, N -25.9…-58.2).
    const loknath: Array<[number, number]> = [[5.6, 17.8], [8.1, 25.7], [18, 22.6], [15.5, 14.8]];
    addPrism(group, loknath, 0, 4.6, white);
    addPrism(group, loknath, 4.6, 0.12, floor);
    addBox(group, [12.4, 5.6, 32], [24.9, 2.8, 42.05], white);
    addBox(group, [12.0, 0.12, 31.6], [24.9, 5.66, 42.05], floor);
    addBox(group, [0.2, 0.35, 32.2], [18.65, 4.9, 42.05], brick);

    // Paved temple court between the ring, the shelter and the shrines.
    addBox(group, [30, 0.08, 64], [10, 0.04, 44], materials.yardPaving);

    // ---- Colliders, clearing ----------------------------------------------
    kit.setBoundsCollider(false);
    // The spire as three narrowing columns.
    kit.solid(0, 0, 4.3, CORE_TOP + SPIRE_H * 0.4);
    kit.solid(0, 0, 2.8, CORE_TOP + SPIRE_H * 0.75);
    kit.solid(0, 0, 1.3, SPIRE_TOP + 3);
    kit.solidBox(0, 0, 16.5, 16.5, SPRING + VAULT_R * VAULT_RISE);
    // The shelter, as boxes along its axis (it turns 18° east of south).
    for (const t of [6, 16, 26, 33]) {
      kit.solidBox(-6.25 + t * Math.sin(shelterTurn), 20.6 + t * Math.cos(shelterTurn), 10.5, 6, S_SPRING + 5 * VAULT_RISE);
    }
    kit.solidBox(hx, hz + 0.6, 6.1, 5.8, 15.6);
    kit.solidBox(11.8, 20.2, 5, 4, 4.7);
    kit.solidBox(24.9, 42.05, 6.2, 16, 5.7);
    kit.clearOval(0, 0, 21, 21);
    kit.clearSite(2, 40, 18, 22);
    kit.clearSite(hx, hz, 8, 8);
    kit.setPerchTarget(0.5, 0.5);
  },
};

export default landmark;
