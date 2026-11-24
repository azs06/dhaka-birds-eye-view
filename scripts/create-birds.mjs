import { mkdir, writeFile } from "node:fs/promises";
import * as THREE from "three";
import { GLTFExporter } from "three/examples/jsm/exporters/GLTFExporter.js";
import { mergeGeometries, mergeVertices } from "three/examples/jsm/utils/BufferGeometryUtils.js";

if (!globalThis.FileReader) {
  globalThis.FileReader = class FileReader {
    result = null;
    onloadend = null;
    readAsArrayBuffer(blob) {
      blob.arrayBuffer().then((buffer) => {
        this.result = buffer;
        this.onloadend?.();
      });
    }
    readAsDataURL(blob) {
      blob.arrayBuffer().then((buffer) => {
        this.result = `data:${blob.type};base64,${Buffer.from(buffer).toString("base64")}`;
        this.onloadend?.();
      });
    }
  };
}

// Builds the playable birds. Every species shares one skeleton and the same
// three clips (Flap, Glide, Rest), so the game can swap one model for another
// without touching its animation code; a species is only proportions, feather
// shapes, colours and markings.
//
// Models face -Z with +Y up, and the bind pose is the glide. The game re-shades
// them with a toon material that keeps only the colour, so colours are lifted
// well off pure black: a true black bird under toon shading has no visible form.
// The player mostly sees the back, the upper wing and the tail, so that is where
// each bird's field marks go.

const CROW = {
  file: "dhaka-house-crow",
  title: "House crow",
  colors: {
    body: 0x1d232b, bodyAlt: 0x2a3441,
    cap: 0x1d232b, nape: 0x82827d, neck: 0x82827d, throat: 0x1d232b,
    flightA: 0x232b35, flightB: 0x171c23,
    covertA: 0x2a3441, covertB: 0x1d232b, underCovert: 0x1d232b,
    tailA: 0x232b35, tailB: 0x171c23,
    bill: 0x14171a, legs: 0x14171a, thigh: 0x1d232b,
    eye: 0x2b1a12, glint: 0xe9efee,
  },
  body: { length: 1, girth: 1 },
  head: { size: 1 },
  // Coloured skins over part of the body: a collar, a pale belly, a bright back.
  shells: [{ color: 0x82827d, from: -1.6, to: -0.2, half: "full", mantle: [0x82827d, 0x666762] }],
  bill: {
    upper: { length: 1, drop: 0.2, width: 0.17, up: 0.17, down: 0.03, y: 0.02 },
    lower: { length: 0.84, drop: 0.1, width: 0.13, up: 0.025, down: 0.1, y: -0.06 },
    bristles: true,
  },
  wing: { span: 1, chord: 1, primaries: 9, primaryLength: 2, primaryBulge: 0.42, peak: 0.82, fan: 1.12, fingersFrom: 3, taper: 1 },
  tail: { count: 12, length: 2.05, shape: "wedge", fan: 0.062 },
};

const SPECIES = [
  CROW,
  // Oriental magpie-robin, the national bird: blue-black above and on the
  // breast, white below, a white bar along the wing and white outer tail feathers.
  {
    file: "bird-doel",
    title: "Oriental magpie-robin",
    colors: {
      body: 0x1c2333, bodyAlt: 0x27314a,
      cap: 0x1c2333, nape: 0x1c2333, neck: 0x1c2333, throat: 0x1c2333,
      flightA: 0x242c3d, flightB: 0x181d29,
      covertA: 0x27314a, covertB: 0x1c2333, underCovert: 0xe4e2da,
      wingBar: 0xeeece4,
      tailA: 0x242c3d, tailB: 0x181d29, tailOuter: 0xeeece4,
      bill: 0x15171b, legs: 0x2b2c31, thigh: 0xe4e2da,
      eye: 0x241812, glint: 0xe9efee,
    },
    body: { length: 0.94, girth: 0.88 },
    head: { size: 0.94 },
    shells: [{ color: 0xeeece4, from: -0.62, to: 2.05, half: "bottom" }],
    bill: {
      upper: { length: 0.66, drop: 0.07, width: 0.1, up: 0.09, down: 0.02, y: 0 },
      lower: { length: 0.6, drop: 0.03, width: 0.085, up: 0.02, down: 0.055, y: -0.045 },
    },
    wing: { span: 0.86, chord: 0.96, primaries: 9, primaryLength: 1.9, primaryBulge: 0.3, peak: 0.8, fan: 1.05, fingersFrom: 5, taper: 0.6 },
    tail: { count: 12, length: 2.5, shape: "wedge", fan: 0.05, outer: 3 },
  },
  // Common myna: chocolate brown with a black hood, yellow bill, eye patch and
  // legs, and a white wing patch and tail tip that flash in flight.
  {
    file: "bird-shalik",
    title: "Common myna",
    colors: {
      body: 0x74513a, bodyAlt: 0x866046,
      cap: 0x1f2126, nape: 0x1f2126, neck: 0x2a2624, throat: 0x1f2126,
      flightA: 0x2f2826, flightB: 0x221d1c,
      covertA: 0x866046, covertB: 0x74513a, underCovert: 0xeeece4,
      wingPatch: 0xf0eee6,
      tailA: 0x2a2423, tailB: 0x1f1b1b, tailTip: 0xf0eee6,
      bill: 0xe6b422, legs: 0xdcae2a, thigh: 0x74513a,
      eye: 0x2a1c12, glint: 0xe9efee, eyePatch: 0xe6b422,
    },
    body: { length: 0.92, girth: 1 },
    head: { size: 0.98 },
    shells: [{ color: 0xeeece4, from: 1.05, to: 2.1, half: "bottom" }],
    bill: {
      upper: { length: 0.72, drop: 0.12, width: 0.13, up: 0.12, down: 0.025, y: 0.01 },
      lower: { length: 0.62, drop: 0.06, width: 0.1, up: 0.02, down: 0.07, y: -0.05 },
    },
    wing: { span: 0.9, chord: 0.98, primaries: 9, primaryLength: 1.95, primaryBulge: 0.32, peak: 0.78, fan: 1.05, fingersFrom: 5, taper: 0.6 },
    tail: { count: 12, length: 1.6, shape: "square", fan: 0.062 },
  },
  // Black kite, the raptor wheeling over every Dhaka rooftop: brown, long-
  // winged and long-fingered, with a pale band across the wing and a forked tail.
  {
    file: "bird-chil",
    title: "Black kite",
    colors: {
      body: 0x6c4c36, bodyAlt: 0x7d5a40,
      cap: 0x8e755d, nape: 0x8e755d, neck: 0x826850, throat: 0x8e755d,
      flightA: 0x3c2e26, flightB: 0x2c221d,
      covertA: 0x6c4c36, covertB: 0x5b402e, underCovert: 0x6c4c36,
      wingBar: 0xa98b68,
      tailA: 0x6e4f3a, tailB: 0x5b4130,
      bill: 0x1c1c1f, cere: 0xdcb63c, legs: 0xdcb63c, thigh: 0x7d5a40,
      eye: 0x3a2a18, glint: 0xe9efee,
    },
    body: { length: 1.06, girth: 0.98 },
    head: { size: 0.9 },
    shells: [],
    bill: {
      upper: { length: 0.56, drop: 0.36, width: 0.15, up: 0.17, down: 0.03, y: 0.03 },
      lower: { length: 0.36, drop: 0.05, width: 0.11, up: 0.02, down: 0.07, y: -0.06 },
    },
    wing: { span: 1.3, chord: 1.06, primaries: 9, primaryLength: 2.3, primaryBulge: 0.75, peak: 0.86, fan: 1.2, fingersFrom: 2, taper: 1.15 },
    tail: { count: 12, length: 2.2, shape: "fork", fan: 0.075 },
  },
  // Rose-ringed parakeet: all green with a red hooked bill, a rose and black
  // neck ring, pointed wings and a long, narrow blue-green tail.
  {
    file: "bird-tiya",
    title: "Rose-ringed parakeet",
    colors: {
      body: 0x62b03c, bodyAlt: 0x7bc64c,
      cap: 0x6fbe46, nape: 0x6fbe46, neck: 0x62b03c, throat: 0x23261f,
      flightA: 0x3f9644, flightB: 0x30803c,
      covertA: 0x7bc64c, covertB: 0x62b03c, underCovert: 0xbcd45e,
      tailA: 0x3fa9a6, tailB: 0x36958f, tailOuter: 0xaecd4e,
      bill: 0xd43c30, legs: 0x8d8c86, thigh: 0x62b03c,
      eye: 0x24221c, glint: 0xf2f0e2, ring: 0xdb667e,
    },
    body: { length: 0.9, girth: 0.86 },
    head: { size: 1.02 },
    shells: [],
    bill: {
      upper: { length: 0.5, drop: 0.44, width: 0.17, up: 0.22, down: 0.03, y: 0.05 },
      lower: { length: 0.26, drop: 0.02, width: 0.12, up: 0.02, down: 0.1, y: -0.08 },
    },
    wing: { span: 0.92, chord: 0.94, primaries: 9, primaryLength: 1.9, primaryBulge: 0.62, peak: 0.6, fan: 1.0, fingersFrom: 9, taper: 0.4 },
    tail: { count: 12, length: 3.5, shape: "long", fan: 0.026, outer: 4 },
  },
  // White-throated kingfisher: chestnut head and belly, white throat, electric
  // blue back, wings and tail, black wingtips with a white patch, a heavy red bill.
  {
    file: "bird-machhranga",
    title: "White-throated kingfisher",
    colors: {
      body: 0x8d4c2b, bodyAlt: 0x2aa6c8,
      cap: 0x8d4c2b, nape: 0x8d4c2b, neck: 0x8d4c2b, throat: 0xf1efe7,
      flightA: 0x2f97bf, flightB: 0x227fa6,
      primaryA: 0x27313f, primaryB: 0x1c2430,
      covertA: 0x8d4c2b, covertB: 0x22262d, underCovert: 0x8d4c2b,
      wingPatch: 0xf1efe7,
      tailA: 0x2aa6c8, tailB: 0x2390b4,
      bill: 0xd2422e, legs: 0xc8452f, thigh: 0x8d4c2b,
      eye: 0x241812, glint: 0xe9efee,
    },
    body: { length: 0.88, girth: 0.94 },
    head: { size: 1.14 },
    shells: [
      { color: 0x2aa6c8, from: -0.85, to: 2.1, half: "top" },
      { color: 0xf1efe7, from: -1.6, to: -0.25, half: "bottom" },
    ],
    bill: {
      upper: { length: 1.46, drop: 0.03, width: 0.16, up: 0.15, down: 0.03, y: 0.01 },
      lower: { length: 1.4, drop: -0.02, width: 0.14, up: 0.025, down: 0.12, y: -0.055 },
    },
    wing: { span: 0.84, chord: 0.95, primaries: 9, primaryLength: 1.85, primaryBulge: 0.42, peak: 0.7, fan: 1.02, fingersFrom: 6, taper: 0.5 },
    tail: { count: 10, length: 1.35, shape: "square", fan: 0.07 },
  },
];

function joint(name, parent, position = [0, 0, 0]) {
  const group = new THREE.Group();
  group.name = name;
  group.position.set(...position);
  parent.add(group);
  return group;
}

const transform = (position, rotation = [0, 0, 0], scale = [1, 1, 1], order = "YXZ") => new THREE.Matrix4().compose(
  new THREE.Vector3(...position),
  new THREE.Quaternion().setFromEuler(new THREE.Euler(...rotation, order)),
  new THREE.Vector3(...scale),
);

// A smooth skin through a run of cross-sections along Z. Each station is
// [z, centreY, halfWidth, radiusUp, radiusDown], so a back can be flatter than
// a belly and a bill can have a hard lower edge.
function loft(stations, segments = 18) {
  const positions = [];
  const indices = [];
  stations.forEach(([z, centreY, halfWidth, up, down]) => {
    for (let segment = 0; segment < segments; segment++) {
      const angle = (segment / segments) * Math.PI * 2;
      const sine = Math.sin(angle);
      positions.push(Math.cos(angle) * halfWidth, centreY + sine * (sine >= 0 ? up : down), z);
    }
  });
  for (let ring = 0; ring + 1 < stations.length; ring++) {
    for (let segment = 0; segment < segments; segment++) {
      const a = ring * segments + segment;
      const b = ring * segments + ((segment + 1) % segments);
      const c = a + segments;
      const d = b + segments;
      indices.push(a, c, b, b, c, d);
    }
  }
  for (const [ring, flip] of [[0, false], [stations.length - 1, true]]) {
    const centre = positions.length / 3;
    positions.push(0, stations[ring][1], stations[ring][0]);
    for (let segment = 0; segment < segments; segment++) {
      const a = ring * segments + segment;
      const b = ring * segments + ((segment + 1) % segments);
      if (flip) indices.push(centre, a, b);
      else indices.push(centre, b, a);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

// One feather: a thin closed blade lying flat, its quill at the origin and its
// tip `length` away along +Z. `taper` narrows the outer half, which is what
// opens the slots between the wingtip fingers.
function feather(length, width, taper = 0) {
  const shape = new THREE.Shape();
  const tip = width * Math.max(0.06, 0.3 - taper * 0.16);
  const shoulder = width * Math.max(0.14, 0.46 - taper * 0.2);
  shape.moveTo(-width * 0.16, 0);
  shape.quadraticCurveTo(-width * 0.56, length * 0.3, -shoulder, length * 0.72);
  shape.quadraticCurveTo(-tip, length * 0.97, 0, length);
  shape.quadraticCurveTo(tip, length * 0.97, shoulder, length * 0.72);
  shape.quadraticCurveTo(width * 0.56, length * 0.3, width * 0.16, 0);
  shape.closePath();
  const geometry = new THREE.ExtrudeGeometry(shape, { depth: 0.03, bevelEnabled: false, curveSegments: 5 });
  geometry.rotateX(Math.PI / 2);
  return geometry;
}

const sphere = new THREE.SphereGeometry(1, 14, 10);
const BODY_STATIONS = [
  [-1.62, 0.2, 0.05, 0.05, 0.05],
  [-1.5, 0.19, 0.34, 0.34, 0.34],
  [-1.15, 0.1, 0.55, 0.52, 0.52],
  [-0.65, 0.03, 0.7, 0.64, 0.66],
  [-0.05, 0, 0.74, 0.66, 0.68],
  [0.6, 0.01, 0.66, 0.58, 0.58],
  [1.2, 0.05, 0.48, 0.42, 0.4],
  [1.75, 0.1, 0.28, 0.22, 0.2],
  [2.15, 0.12, 0.06, 0.05, 0.05],
];
// The body's cross-section at any point along its length.
function bodyAt(z) {
  for (let index = 0; index + 1 < BODY_STATIONS.length; index++) {
    const a = BODY_STATIONS[index];
    const b = BODY_STATIONS[index + 1];
    if (z < a[0] || z > b[0]) continue;
    const t = (z - a[0]) / (b[0] - a[0]);
    return a.map((value, part) => value + (b[part] - value) * t);
  }
  return z < BODY_STATIONS[0][0] ? BODY_STATIONS[0] : BODY_STATIONS[BODY_STATIONS.length - 1];
}

const quaternions = (rotations, order = "YXZ") => rotations.flatMap(([x, y, z]) => {
  const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(x, y, z, order));
  return [q.x, q.y, q.z, q.w];
});
const vectors = (values) => values.flat();
const LEGS_TUCKED = -1.28;
const FEET_TRAILING = -1.35;

function buildBird(spec) {
  const scene = new THREE.Scene();
  scene.name = "DhakaBird";
  const rig = new THREE.Group();
  rig.name = "BirdRig";
  scene.add(rig);

  // One material per distinct colour, so parts that share a colour also share
  // a mesh once each joint's geometry is merged.
  const materials = new Map();
  const materialFor = (color) => {
    let found = materials.get(color);
    if (!found) {
      found = new THREE.MeshStandardMaterial({ color, roughness: 0.6, side: THREE.DoubleSide });
      found.name = `Plumage.${color.toString(16).padStart(6, "0")}`;
      materials.set(color, found);
    }
    return found;
  };
  const C = spec.colors;

  // Geometry is gathered per joint and colour, then merged, so the finished
  // bird is a few dozen meshes instead of one per feather.
  function collector(target, base) {
    const buckets = new Map();
    return {
      add(geometry, color, matrix) {
        const prepared = geometry.index ? geometry.toNonIndexed() : geometry.clone();
        for (const attribute of Object.keys(prepared.attributes)) {
          if (attribute !== "position") prepared.deleteAttribute(attribute);
        }
        if (matrix) prepared.applyMatrix4(matrix);
        if (base) prepared.applyMatrix4(base);
        const bucket = buckets.get(color) ?? [];
        bucket.push(prepared);
        buckets.set(color, bucket);
      },
      finish() {
        for (const [color, geometries] of buckets) {
          // Welding shared corners roughly halves the file and smooths the shading.
          const merged = mergeVertices(mergeGeometries(geometries, false), 1e-4);
          merged.computeVertexNormals();
          const object = new THREE.Mesh(merged, materialFor(color));
          object.name = `${target.name}.${materialFor(color).name}`;
          object.castShadow = true;
          object.receiveShadow = true;
          target.add(object);
        }
      },
    };
  }

  const L = spec.body.length;
  const G = spec.body.girth;
  const stations = (list, inflate = 1) => list.map(([z, y, w, up, down]) => [z * L, y * G, w * G * inflate, up * G * inflate, down * G * inflate]);

  // ---- Body ------------------------------------------------------------
  const bodyJoint = joint("BodyJoint", rig);
  const body = collector(bodyJoint);
  body.add(loft(stations(BODY_STATIONS)), C.body);
  for (const shell of spec.shells) {
    // A shell follows the body just proud of it; a half shell pinches shut along
    // the side of the bird so a belly or a back gets its own colour.
    const steps = 9;
    const run = Array.from({ length: steps }, (_, index) => {
      const z = shell.from + ((shell.to - shell.from) * index) / (steps - 1);
      const [, y, w, up, down] = bodyAt(z);
      const end = index === 0 || index === steps - 1;
      const grow = end ? 0.4 : 1.035;
      return [z, y, w * grow, shell.half === "bottom" ? up * 0.25 : up * grow, shell.half === "top" ? down * 0.25 : down * grow];
    });
    body.add(loft(stations(run)), shell.color);
    if (shell.mantle) {
      for (let row = 0; row < 3; row++) {
        for (let column = -2; column <= 2; column++) {
          const spread = column * (0.2 + row * 0.03);
          body.add(feather(0.62, 0.34), shell.mantle[row % 2], transform(
            [spread * G, (0.6 - Math.abs(column) * 0.07 - row * 0.012) * G, (-0.5 + row * 0.26) * L],
            [0.1, column * 0.1, column * -0.32],
          ));
        }
      }
    }
  }
  // Rump and under-tail coverts close the body onto the tail.
  const rumpTop = spec.shells.find((shell) => shell.half === "top" && shell.to > 1.5)?.color ?? C.bodyAlt;
  const rumpBottom = spec.shells.find((shell) => shell.half === "bottom" && shell.to > 1.5)?.color ?? C.body;
  for (const [y, lift, color] of [[0.26, 0.08, rumpTop], [-0.02, -0.1, rumpBottom]]) {
    for (let column = -2; column <= 2; column++) {
      body.add(feather(0.95, 0.4), color, transform([column * 0.15 * G, (y - Math.abs(column) * 0.03) * G, 1.25 * L], [lift, column * 0.13, 0]));
    }
  }

  // ---- Neck and head ---------------------------------------------------
  const neckJoint = joint("NeckJoint", bodyJoint, [0, 0.2 * G, -1.32 * L]);
  const neck = collector(neckJoint, new THREE.Matrix4().makeScale(G, G, G));
  neck.add(loft([
    [0.25, -0.04, 0.3, 0.32, 0.32],
    [0, 0.04, 0.44, 0.44, 0.42],
    [-0.35, 0.2, 0.42, 0.42, 0.4],
    [-0.68, 0.38, 0.38, 0.38, 0.36],
    [-0.9, 0.46, 0.2, 0.22, 0.2],
  ]), C.neck);
  // Throat: the bib under the bill.
  neck.add(sphere, C.throat, transform([0, 0.14, -0.62], [0.5, 0, 0], [0.3, 0.26, 0.42]));
  if (C.ring) {
    const ring = new THREE.TorusGeometry(0.4, 0.045, 6, 20);
    neck.add(ring, C.ring, transform([0, 0.3, -0.52], [-0.5, 0, 0], [1, 1, 1], "XYZ"));
  }

  const H = spec.head.size * G;
  const headJoint = joint("HeadJoint", neckJoint, [0, 0.46 * G, -0.66 * G]);
  const head = collector(headJoint, new THREE.Matrix4().makeScale(H / G, H / G, H / G));
  head.add(sphere, C.cap, transform([0, 0.02, -0.04], [0, 0, 0], [0.44, 0.43, 0.56]));
  head.add(sphere, C.cap, transform([0, 0.17, -0.2], [0.3, 0, 0], [0.34, 0.26, 0.36]));
  head.add(sphere, C.nape, transform([0, 0.02, 0.24], [0, 0, 0], [0.4, 0.4, 0.34]));
  const billStations = ({ length, drop, width, up, down, y }) => Array.from({ length: 8 }, (_, index) => {
    const t = index / 7;
    const taper = Math.pow(1 - t, 0.75);
    return [-0.44 - t * length, y - drop * t * t, 0.012 + width * taper, 0.012 + up * taper, 0.012 + down * taper];
  });
  head.add(loft(billStations(spec.bill.upper), 12), C.bill);
  head.add(loft(billStations(spec.bill.lower), 12), C.bill);
  if (spec.bill.bristles) head.add(sphere, C.cap, transform([0, 0.1, -0.56], [0.2, 0, 0], [0.17, 0.1, 0.24]));
  // A raptor's cere: the bare skin saddling the base of the bill.
  if (C.cere) head.add(sphere, C.cere, transform([0, 0.1, -0.5], [0.2, 0, 0], [0.17, 0.13, 0.17]));
  for (const side of [-1, 1]) {
    head.add(sphere, C.eye, transform([side * 0.37, 0.09, -0.3], [0, 0, 0], [0.07, 0.075, 0.075]));
    head.add(sphere, C.glint, transform([side * 0.425, 0.125, -0.335], [0, 0, 0], [0.018, 0.02, 0.02]));
    if (C.eyePatch) head.add(sphere, C.eyePatch, transform([side * 0.36, 0.05, -0.18], [0, 0, 0], [0.09, 0.13, 0.2]));
  }

  // ---- Wings -----------------------------------------------------------
  // Three bones, as in the real wing: the humerus carries the tertials, the
  // forearm the secondaries and the hand the primaries. In the glide the wrist
  // is the forward bend of the leading edge.
  const W = spec.wing;
  const S = W.span;
  const K = W.chord;
  const SHOULDER = [0.6 * G, 0.3 * G, -0.78 * L];
  const wingJoints = {};
  for (const side of [-1, 1]) {
    const suffix = side < 0 ? "L" : "R";
    const shoulder = joint(`WingJoint.${suffix}`, bodyJoint, [side * SHOULDER[0], SHOULDER[1], SHOULDER[2]]);
    const forearm = joint(`ForearmJoint.${suffix}`, shoulder, [side * 1 * S, 0, 0.12 * S]);
    const hand = joint(`HandJoint.${suffix}`, forearm, [side * 1.7 * S, 0, -0.34 * S]);
    wingJoints[suffix] = { shoulder, forearm, hand };

    // Lay a feather with its quill at [x, y, z], fanned `angle` outward from
    // pointing straight back, with a little droop toward the tip.
    const lay = (target, geometry, color, x, y, z, angle, droop = 0.05, roll = 0) => {
      target.add(geometry, color, transform([side * x * S, y, z * S], [droop, side * angle, side * roll]));
    };
    // The fleshy leading edge of each bone.
    const limb = (target, length, sweep, from, to) => {
      const bone = new THREE.CylinderGeometry(to, from, length * S, 8);
      bone.rotateZ(-side * Math.PI / 2);
      target.add(bone, C.covertB, transform([side * length * S / 2 * Math.cos(sweep), 0, -length * S / 2 * Math.sin(sweep)], [0, side * sweep, 0]));
    };
    const bar = C.wingBar;

    const upper = collector(shoulder);
    limb(upper, 1.05, -0.12, 0.2, 0.15);
    for (let index = 0; index < 4; index++) {
      lay(upper, feather((1.75 - index * 0.06) * K, 0.5 * S), index % 2 ? C.flightB : C.flightA, 0.12 + index * 0.25, -0.02 - index * 0.006, 0.06 + index * 0.03, -0.1 + index * 0.05);
    }
    for (let index = 0; index < 4; index++) {
      lay(upper, feather(0.95 * K, 0.46 * S), bar ?? (index % 2 ? C.covertA : C.covertB), 0.1 + index * 0.26, 0.03 - index * 0.004, -0.06, -0.14 + index * 0.06, 0.09);
    }
    upper.finish();

    const middle = collector(forearm);
    limb(middle, 1.75, 0.2, 0.15, 0.11);
    for (let index = 0; index < 8; index++) {
      const along = index / 7;
      lay(middle, feather((1.92 - along * 0.1) * K, 0.42 * S), index % 2 ? C.flightA : C.flightB, 0.08 + along * 1.62, -0.02 - index * 0.006, 0.02 - along * 0.34, 0.03 + along * 0.1);
    }
    for (let index = 0; index < 7; index++) {
      const along = index / 6;
      lay(middle, feather((1.02 - along * 0.08) * K, 0.42 * S), bar ?? (index % 2 ? C.covertB : C.covertA), 0.1 + along * 1.5, 0.028 - index * 0.004, -0.05 - along * 0.32, 0.02 + along * 0.1, 0.09);
      lay(middle, feather(0.55 * K, 0.36 * S), index % 2 ? C.covertA : C.covertB, 0.12 + along * 1.5, 0.056 - index * 0.004, -0.12 - along * 0.32, 0.02 + along * 0.1, 0.12);
      lay(middle, feather(0.9 * K, 0.42 * S), C.underCovert, 0.1 + along * 1.5, -0.085 - index * 0.004, -0.04 - along * 0.32, 0.02 + along * 0.1, 0.02);
    }
    middle.finish();

    const outer = collector(hand);
    limb(outer, 0.95, -0.3, 0.11, 0.06);
    // The primaries swing from pointing back at the wrist to pointing nearly
    // straight out at the tip. Where they narrow toward their ends, slots open
    // between them: the spread fingers of a crow or a kite.
    for (let index = 0; index < W.primaries; index++) {
      const along = index / (W.primaries - 1);
      const angle = 0.16 + along * W.fan;
      const length = (W.primaryLength + Math.sin(along * Math.PI * W.peak) * W.primaryBulge) * K;
      const fingered = index >= W.fingersFrom;
      const color = index % 2 ? (C.primaryB ?? C.flightB) : (C.primaryA ?? C.flightA);
      lay(outer, feather(length, (0.4 - along * 0.08) * S, fingered ? W.taper : 0.2), color, 0.05 + along * 0.82, -0.02 - index * 0.006, 0.02 + along * 0.24, angle, 0.04, -0.05 * along);
      // A pale patch across the bases of the primaries flashes in flight.
      if (C.wingPatch && index < W.primaries - 1) {
        lay(outer, feather(length * 0.42, (0.4 - along * 0.08) * S), C.wingPatch, 0.05 + along * 0.82, 0.012 - index * 0.006, 0.02 + along * 0.24, angle, 0.04, -0.05 * along);
        lay(outer, feather(length * 0.42, (0.4 - along * 0.08) * S), C.wingPatch, 0.05 + along * 0.82, -0.054 - index * 0.006, 0.02 + along * 0.24, angle, 0.04, -0.05 * along);
      }
    }
    for (let index = 0; index < 6; index++) {
      const along = index / 5;
      lay(outer, feather((0.92 - along * 0.2) * K, 0.36 * S), index % 2 ? C.covertA : C.covertB, 0.06 + along * 0.72, 0.03 - index * 0.004, -0.03 + along * 0.2, 0.2 + along * 0.9, 0.09);
      lay(outer, feather((0.8 - along * 0.16) * K, 0.34 * S), C.underCovert, 0.06 + along * 0.72, -0.1 - index * 0.004, -0.02 + along * 0.2, 0.2 + along * 0.9, 0.02);
    }
    // The alula, the small thumb feathers at the wrist.
    lay(outer, feather(0.52 * K, 0.2 * S), C.flightB, 0.06, 0.04, -0.06, 0.5, 0.02);
    outer.finish();
  }

  // ---- Tail ------------------------------------------------------------
  const T = spec.tail;
  const tailJoint = joint("TailJoint", bodyJoint, [0, 0.12 * G, 1.85 * L]);
  const tail = collector(tailJoint);
  const middleIndex = (T.count - 1) / 2;
  for (let index = 0; index < T.count; index++) {
    const offset = index - middleIndex;
    const spread = Math.abs(offset) / middleIndex;
    const length = T.shape === "wedge" ? T.length - spread * spread * 0.46
      : T.shape === "fork" ? T.length * (0.84 + spread * spread * 0.2)
      : T.shape === "long" ? T.length * (0.4 + Math.pow(1 - spread, 2.4) * 0.6)
      : T.length;
    const isOuter = T.outer && Math.abs(offset) > middleIndex - T.outer;
    const color = isOuter && C.tailOuter ? C.tailOuter : index % 2 ? C.tailB : C.tailA;
    const placement = [[offset * 0.065 * G, -Math.abs(offset) * 0.012 + (offset > 0 ? 0.004 : 0), 0], [0.02, offset * T.fan, 0]];
    tail.add(feather(length, 0.4 * G), color, transform(...placement));
    if (C.tailTip && spread > 0.1) {
      const tip = feather(length * 0.2, 0.4 * G);
      tip.translate(0, 0.012, length * 0.82);
      tail.add(tip, C.tailTip, transform(...placement));
      const under = feather(length * 0.2, 0.4 * G);
      under.translate(0, -0.042, length * 0.82);
      tail.add(under, C.tailTip, transform(...placement));
    }
  }
  tail.finish();

  // ---- Legs ------------------------------------------------------------
  // Modelled hanging straight down; the clips tuck them back along the belly
  // in flight and swing them under the body to perch.
  const legJoints = {};
  const footJoints = {};
  for (const side of [-1, 1]) {
    const suffix = side < 0 ? "L" : "R";
    const legJoint = joint(`LegJoint.${suffix}`, bodyJoint, [side * 0.3 * G, -0.42 * G, 0.5 * L]);
    legJoints[suffix] = legJoint;
    const leg = collector(legJoint);
    leg.add(sphere, C.thigh, transform([0, -0.06, 0], [0, 0, 0], [0.17, 0.26, 0.2]));
    leg.add(new THREE.CylinderGeometry(0.05, 0.04, 0.5, 7), C.legs, transform([0, -0.48, 0]));
    // The foot has its own joint so the toes can trail behind a tucked leg in
    // flight and spread flat to grip a perch.
    const footJoint = joint(`FootJoint.${suffix}`, legJoint, [0, -0.73, 0]);
    footJoints[suffix] = footJoint;
    const foot = collector(footJoint);
    for (const [yaw, length] of [[0, 0.36], [0.5, 0.31], [-0.5, 0.31], [Math.PI, 0.24]]) {
      const toe = new THREE.CylinderGeometry(0.022, 0.03, length, 6);
      toe.rotateX(Math.PI / 2);
      toe.translate(0, 0, -length / 2);
      foot.add(toe, C.legs, transform([0, 0, 0], [0.12, yaw, 0]));
      const claw = new THREE.ConeGeometry(0.024, 0.13, 6);
      claw.rotateX(-Math.PI / 2);
      claw.translate(0, 0, -length - 0.05);
      foot.add(claw, C.legs, transform([0, 0, 0], [0.3, yaw, 0]));
    }
    foot.finish();
    leg.finish();
  }

  body.finish();
  neck.finish();
  head.finish();

  // ---- Animation -------------------------------------------------------
  // A pose is written once for the right wing and mirrored for the left.
  // `lift` raises the wing about the body's long axis, `fold` sweeps it back,
  // and `tilt` rolls its feathers down against the flank.
  const wingTracks = (times, poses) => {
    const tracks = [];
    for (const [suffix, side] of [["L", -1], ["R", 1]]) {
      const rotation = (key) => quaternions(poses.map((pose) => {
        const [tilt = 0, fold = 0, lift = 0] = pose[key];
        return [tilt, -side * fold, side * lift];
      }));
      tracks.push(new THREE.QuaternionKeyframeTrack(`WingJoint.${suffix}.quaternion`, times, rotation("shoulder")));
      tracks.push(new THREE.QuaternionKeyframeTrack(`ForearmJoint.${suffix}.quaternion`, times, rotation("forearm")));
      tracks.push(new THREE.QuaternionKeyframeTrack(`HandJoint.${suffix}.quaternion`, times, rotation("hand")));
      tracks.push(new THREE.VectorKeyframeTrack(`WingJoint.${suffix}.scale`, times, vectors(poses.map((pose) => pose.scale ?? [1, 1, 1]))));
      // A folded wing sits out on the flank, clear of the body it wraps.
      tracks.push(new THREE.VectorKeyframeTrack(`WingJoint.${suffix}.position`, times, vectors(poses.map((pose) => {
        const [out, up, back] = pose.offset ?? [0, 0, 0];
        return [side * (SHOULDER[0] + out * G), SHOULDER[1] + up * G, SHOULDER[2] + back];
      }))));
    }
    return tracks;
  };
  // Legs swing back to tuck; the feet curl the other way so the toes trail.
  const legTracks = (times, angles) => ["L", "R"].flatMap((suffix) => [
    new THREE.QuaternionKeyframeTrack(`LegJoint.${suffix}.quaternion`, times, quaternions(angles.map((angle) => [angle, 0, 0]))),
    new THREE.QuaternionKeyframeTrack(`FootJoint.${suffix}.quaternion`, times, quaternions(angles.map((angle) => [angle < -0.5 ? FEET_TRAILING : 0, 0, 0]))),
  ]);
  const pitch = (name, times, angles) => new THREE.QuaternionKeyframeTrack(`${name}.quaternion`, times, quaternions(angles.map((angle) => [angle, 0, 0])));
  const turn = (name, times, angles) => new THREE.QuaternionKeyframeTrack(`${name}.quaternion`, times, quaternions(angles.map((angle) => [0, angle, 0])));

  const GLIDE_WING = { shoulder: [0, 0, 0.1], forearm: [0, 0, 0.02], hand: [0, 0, 0.07] };
  for (const [suffix, side] of [["L", -1], ["R", 1]]) {
    wingJoints[suffix].shoulder.rotation.set(0, 0, side * 0.1, "YXZ");
    wingJoints[suffix].forearm.rotation.set(0, 0, side * 0.02, "YXZ");
    wingJoints[suffix].hand.rotation.set(0, 0, side * 0.07, "YXZ");
    legJoints[suffix].rotation.set(LEGS_TUCKED, 0, 0, "YXZ");
    footJoints[suffix].rotation.set(FEET_TRAILING, 0, 0, "YXZ");
  }

  // Flap: the wrist leads on the way up, folding the hand back and letting its
  // tips trail, then the whole wing snaps flat and drives down.
  const flapTimes = [0, 0.2, 0.42, 0.68, 1];
  const flap = new THREE.AnimationClip("Flap", 1, [
    ...wingTracks(flapTimes, [
      GLIDE_WING,
      { shoulder: [0, 0.1, 0.78], forearm: [0, 0.16, -0.12], hand: [0, 0.42, -0.34] },
      { shoulder: [0, 0, 0.1], forearm: [0, 0, 0.04], hand: [0, 0, 0.12] },
      { shoulder: [0, -0.04, -0.56], forearm: [0, -0.03, 0.1], hand: [0, 0.06, 0.26] },
      GLIDE_WING,
    ]),
    ...legTracks(flapTimes, [LEGS_TUCKED, LEGS_TUCKED, LEGS_TUCKED, LEGS_TUCKED, LEGS_TUCKED]),
    new THREE.VectorKeyframeTrack("BodyJoint.position", flapTimes, vectors([[0, 0, 0], [0, -0.05, 0], [0, 0.02, 0], [0, 0.08, 0], [0, 0, 0]])),
    pitch("BodyJoint", flapTimes, [0, 0.03, 0, -0.03, 0]),
    pitch("TailJoint", flapTimes, [0, 0.07, 0, -0.06, 0]),
    pitch("NeckJoint", flapTimes, [0, -0.03, 0, 0.03, 0]),
    turn("HeadJoint", flapTimes, [0, 0, 0, 0, 0]),
  ]);

  const glideTimes = [0, 1.2, 2.4];
  const glide = new THREE.AnimationClip("Glide", 2.4, [
    ...wingTracks(glideTimes, [
      GLIDE_WING,
      { shoulder: [0, 0, 0.05], forearm: [0, 0, 0.02], hand: [0, 0.03, 0.11] },
      GLIDE_WING,
    ]),
    ...legTracks(glideTimes, [LEGS_TUCKED, LEGS_TUCKED, LEGS_TUCKED]),
    new THREE.VectorKeyframeTrack("BodyJoint.position", glideTimes, vectors([[0, 0, 0], [0, 0, 0], [0, 0, 0]])),
    pitch("BodyJoint", glideTimes, [0, 0, 0]),
    pitch("TailJoint", glideTimes, [0.02, -0.035, 0.02]),
    pitch("NeckJoint", glideTimes, [0, 0.02, 0]),
    turn("HeadJoint", glideTimes, [-0.06, 0.08, -0.06]),
  ]);

  // Rest: the wing drops against the flank and its span closes right up.
  // Closing the span is also what collapses the fanned primaries into a stack
  // of feathers pointing back along the body, the way a real wing folds.
  const restTimes = [0, 1.5, 3];
  const folded = (breath) => ({
    shoulder: [0, 0.12, -1.42 - breath],
    forearm: [0, 0, 0],
    hand: [0, 0, 0],
    scale: [0.16, 1, 0.9],
    offset: [0.3, 0.06, 0.1],
  });
  const rest = new THREE.AnimationClip("Rest", 3, [
    ...wingTracks(restTimes, [folded(0), folded(0.02), folded(0)]),
    ...legTracks(restTimes, [0.02, 0.01, 0.02]),
    new THREE.VectorKeyframeTrack("BodyJoint.position", restTimes, vectors([[0, 0, 0], [0, 0.025, 0], [0, 0, 0]])),
    pitch("BodyJoint", restTimes, [0.19, 0.205, 0.19]),
    pitch("TailJoint", restTimes, [0.13, 0.11, 0.13]),
    pitch("NeckJoint", restTimes, [-0.12, -0.14, -0.12]),
    turn("HeadJoint", restTimes, [-0.18, 0.2, -0.18]),
  ]);

  return { scene, clips: [flap, glide, rest] };
}

await mkdir("public/models", { recursive: true });
for (const spec of SPECIES) {
  const { scene, clips } = buildBird(spec);
  const result = await new GLTFExporter().parseAsync(scene, { binary: true, animations: clips, onlyVisible: true });
  await writeFile(`public/models/${spec.file}.glb`, Buffer.from(result));
  let meshes = 0;
  let triangles = 0;
  scene.traverse((object) => {
    if (!object.isMesh) return;
    meshes++;
    triangles += (object.geometry.index ? object.geometry.index.count : object.geometry.attributes.position.count) / 3;
  });
  console.log(`${spec.title}: public/models/${spec.file}.glb, ${meshes} meshes, ${Math.round(triangles)} triangles, ${(result.byteLength / 1024).toFixed(0)} KB, ${clips.map((clip) => `${clip.name} ${clip.tracks.length}`).join(" / ")}`);
}
