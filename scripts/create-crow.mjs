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

// A house crow (Corvus splendens), the bird of every Dhaka rooftop: glossy black
// with a grey collar over the nape, neck and breast, a stout curved bill, broad
// wings whose outer primaries separate into fingers, and a rounded wedge tail.
//
// The model faces -Z with +Y up, and its bind pose is the glide. Every joint is
// keyed in all three clips so blends between them never fall back to the bind.
const scene = new THREE.Scene();
scene.name = "DhakaHouseCrow";
const rig = new THREE.Group();
rig.name = "CrowRig";
scene.add(rig);

// The game re-shades these with a toon material that keeps only the colour, so
// the values are lifted well off pure black: a true black crow under two-step
// toon shading has no visible form at all.
const material = (name, color) => {
  const result = new THREE.MeshStandardMaterial({ color, roughness: 0.6, side: THREE.DoubleSide });
  result.name = name;
  return result;
};
const MATERIALS = {
  black: material("PlumageBlack", 0x1d232b),
  gloss: material("PlumageGloss", 0x2a3441),
  flight: material("FlightFeather", 0x171c23),
  flightAlt: material("FlightFeatherAlt", 0x232b35),
  grey: material("CollarGrey", 0x82827d),
  greyDark: material("CollarShade", 0x666762),
  horn: material("BillAndLegs", 0x14171a),
  eye: material("Eye", 0x2b1a12),
  glint: material("EyeGlint", 0xe9efee),
};

// Geometry is gathered per joint and material, then merged, so the finished
// bird is a few dozen meshes instead of one per feather.
function collector(joint) {
  const buckets = new Map();
  return {
    joint,
    add(geometry, materialKey, matrix) {
      const prepared = geometry.index ? geometry.toNonIndexed() : geometry.clone();
      for (const attribute of Object.keys(prepared.attributes)) {
        if (attribute !== "position") prepared.deleteAttribute(attribute);
      }
      if (matrix) prepared.applyMatrix4(matrix);
      const bucket = buckets.get(materialKey) ?? [];
      bucket.push(prepared);
      buckets.set(materialKey, bucket);
    },
    finish() {
      for (const [materialKey, geometries] of buckets) {
        // Welding shared corners roughly halves the file and smooths the shading.
        const merged = mergeVertices(mergeGeometries(geometries, false), 1e-4);
        merged.computeVertexNormals();
        const object = new THREE.Mesh(merged, MATERIALS[materialKey]);
        object.name = `${joint.name}.${MATERIALS[materialKey].name}`;
        object.castShadow = true;
        object.receiveShadow = true;
        joint.add(object);
      }
    },
  };
}

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
  const tip = width * (0.3 - taper * 0.16);
  shape.moveTo(-width * 0.16, 0);
  shape.quadraticCurveTo(-width * 0.56, length * 0.3, -width * (0.46 - taper * 0.2), length * 0.72);
  shape.quadraticCurveTo(-tip, length * 0.97, 0, length);
  shape.quadraticCurveTo(tip, length * 0.97, width * (0.46 - taper * 0.2), length * 0.72);
  shape.quadraticCurveTo(width * 0.56, length * 0.3, width * 0.16, 0);
  shape.closePath();
  const geometry = new THREE.ExtrudeGeometry(shape, { depth: 0.03, bevelEnabled: false, curveSegments: 5 });
  geometry.rotateX(Math.PI / 2);
  return geometry;
}

const sphere = new THREE.SphereGeometry(1, 14, 10);

// ---- Body --------------------------------------------------------------
const bodyJoint = joint("BodyJoint", rig);
const body = collector(bodyJoint);
body.add(loft([
  [-1.62, 0.2, 0.05, 0.05, 0.05],
  [-1.5, 0.19, 0.34, 0.34, 0.34],
  [-1.15, 0.1, 0.55, 0.52, 0.52],
  [-0.65, 0.03, 0.7, 0.64, 0.66],
  [-0.05, 0, 0.74, 0.66, 0.68],
  [0.6, 0.01, 0.66, 0.58, 0.58],
  [1.2, 0.05, 0.48, 0.42, 0.4],
  [1.75, 0.1, 0.28, 0.22, 0.2],
  [2.15, 0.12, 0.06, 0.05, 0.05],
]), "black");
// The grey collar wraps the mantle and upper breast and fades out along the back.
body.add(loft([
  [-1.6, 0.2, 0.06, 0.06, 0.06],
  [-1.5, 0.19, 0.36, 0.36, 0.36],
  [-1.15, 0.1, 0.575, 0.545, 0.545],
  [-0.7, 0.035, 0.725, 0.665, 0.68],
  [-0.38, 0.015, 0.74, 0.675, 0.66],
  [-0.2, 0.01, 0.7, 0.66, 0.4],
]), "grey");
for (let row = 0; row < 3; row++) {
  for (let column = -2; column <= 2; column++) {
    const spread = column * (0.2 + row * 0.03);
    body.add(feather(0.62, 0.34), row % 2 ? "grey" : "greyDark", transform(
      [spread, 0.6 - Math.abs(column) * 0.07 - row * 0.012, -0.5 + row * 0.26],
      [0.1, column * 0.1, column * -0.32],
    ));
  }
}
// Rump and under-tail coverts close the body onto the tail.
for (const [y, lift, key] of [[0.26, 0.08, "gloss"], [-0.02, -0.1, "black"]]) {
  for (let column = -2; column <= 2; column++) {
    body.add(feather(0.95, 0.4), key, transform([column * 0.15, y - Math.abs(column) * 0.03, 1.25], [lift, column * 0.13, 0]));
  }
}

// ---- Neck and head -----------------------------------------------------
const neckJoint = joint("NeckJoint", bodyJoint, [0, 0.2, -1.32]);
const neck = collector(neckJoint);
neck.add(loft([
  [0.25, -0.04, 0.3, 0.32, 0.32],
  [0, 0.04, 0.44, 0.44, 0.42],
  [-0.35, 0.2, 0.42, 0.42, 0.4],
  [-0.68, 0.38, 0.38, 0.38, 0.36],
  [-0.9, 0.46, 0.2, 0.22, 0.2],
]), "grey");
// Throat hackles: the black bib under the bill.
neck.add(sphere, "black", transform([0, 0.14, -0.62], [0.5, 0, 0], [0.3, 0.26, 0.42]));

const headJoint = joint("HeadJoint", neckJoint, [0, 0.46, -0.66]);
const head = collector(headJoint);
head.add(sphere, "black", transform([0, 0.02, -0.04], [0, 0, 0], [0.44, 0.43, 0.56]));
// A slightly peaked forecrown, the house crow's steep forehead.
head.add(sphere, "black", transform([0, 0.17, -0.2], [0.3, 0, 0], [0.34, 0.26, 0.36]));
head.add(sphere, "grey", transform([0, 0.02, 0.24], [0, 0, 0], [0.4, 0.4, 0.34]));
const billStations = (length, drop, width, up, down, startY) => Array.from({ length: 8 }, (_, index) => {
  const t = index / 7;
  const taper = Math.pow(1 - t, 0.75);
  return [-0.44 - t * length, startY - drop * t * t, 0.012 + width * taper, 0.012 + up * taper, 0.012 + down * taper];
});
head.add(loft(billStations(1, 0.2, 0.17, 0.17, 0.03, 0.02), 12), "horn");
head.add(loft(billStations(0.84, 0.1, 0.13, 0.025, 0.1, -0.06), 12), "horn");
// Nasal bristles lie over the base of the upper mandible.
head.add(sphere, "black", transform([0, 0.1, -0.56], [0.2, 0, 0], [0.17, 0.1, 0.24]));
for (const side of [-1, 1]) {
  head.add(sphere, "eye", transform([side * 0.37, 0.09, -0.3], [0, 0, 0], [0.07, 0.075, 0.075]));
  head.add(sphere, "glint", transform([side * 0.425, 0.125, -0.335], [0, 0, 0], [0.018, 0.02, 0.02]));
}

// ---- Wings -------------------------------------------------------------
// Three bones, as in the real wing: the humerus carries the tertials, the
// forearm the secondaries and the hand the primaries. In the glide the wrist is
// the forward bend of the leading edge.
const wingJoints = {};
const SHOULDER = [0.6, 0.3, -0.78];
function addWing(side) {
  const suffix = side < 0 ? "L" : "R";
  const shoulder = joint(`WingJoint.${suffix}`, bodyJoint, [side * SHOULDER[0], SHOULDER[1], SHOULDER[2]]);
  const forearm = joint(`ForearmJoint.${suffix}`, shoulder, [side * 1, 0, 0.12]);
  const hand = joint(`HandJoint.${suffix}`, forearm, [side * 1.7, 0, -0.34]);
  wingJoints[suffix] = { shoulder, forearm, hand };

  // Lay a feather with its quill at [x, y, z], fanned `angle` outward from
  // pointing straight back, with a little droop toward the tip.
  const lay = (target, geometry, key, x, y, z, angle, droop = 0.05, roll = 0) => {
    target.add(geometry, key, transform([side * x, y, z], [droop, side * angle, side * roll]));
  };
  // The fleshy leading edge of each bone.
  const limb = (target, length, sweep, from, to) => {
    const bone = new THREE.CylinderGeometry(to, from, length, 8);
    bone.rotateZ(-side * Math.PI / 2);
    target.add(bone, "black", transform([side * length / 2 * Math.cos(sweep), 0, length / 2 * Math.sin(sweep) * -1], [0, side * sweep, 0]));
  };

  const upper = collector(shoulder);
  limb(upper, 1.05, -0.12, 0.2, 0.15);
  for (let index = 0; index < 4; index++) {
    lay(upper, feather(1.75 - index * 0.06, 0.5), index % 2 ? "flight" : "flightAlt", 0.12 + index * 0.25, -0.02 - index * 0.006, 0.06 + index * 0.03, -0.1 + index * 0.05);
  }
  for (let index = 0; index < 4; index++) {
    lay(upper, feather(0.95, 0.46), index % 2 ? "gloss" : "black", 0.1 + index * 0.26, 0.03, -0.06, -0.14 + index * 0.06, 0.09);
  }
  upper.finish();

  const middle = collector(forearm);
  limb(middle, 1.75, 0.2, 0.15, 0.11);
  for (let index = 0; index < 8; index++) {
    const along = index / 7;
    lay(middle, feather(1.92 - along * 0.1, 0.42), index % 2 ? "flightAlt" : "flight", 0.08 + along * 1.62, -0.02 - index * 0.006, 0.02 - along * 0.34, 0.03 + along * 0.1);
  }
  for (let index = 0; index < 7; index++) {
    const along = index / 6;
    lay(middle, feather(1.02 - along * 0.08, 0.42), index % 2 ? "black" : "gloss", 0.1 + along * 1.5, 0.025, -0.05 - along * 0.32, 0.02 + along * 0.1, 0.09);
    lay(middle, feather(0.55, 0.36), index % 2 ? "gloss" : "black", 0.12 + along * 1.5, 0.05, -0.12 - along * 0.32, 0.02 + along * 0.1, 0.12);
    lay(middle, feather(0.9, 0.42), "black", 0.1 + along * 1.5, -0.085, -0.04 - along * 0.32, 0.02 + along * 0.1, 0.02);
  }
  middle.finish();

  const outer = collector(hand);
  limb(outer, 0.95, -0.3, 0.11, 0.06);
  // Nine primaries swing from pointing back at the wrist to pointing nearly
  // straight out at the tip. The outer six narrow toward their ends, which
  // opens the slots that make a crow's wingtip look like spread fingers.
  for (let index = 0; index < 9; index++) {
    const along = index / 8;
    const angle = 0.16 + along * 1.12;
    const length = 2.0 + Math.sin(along * Math.PI * 0.82) * 0.42;
    lay(outer, feather(length, 0.4 - along * 0.08, index >= 3 ? 1 : 0.2), index % 2 ? "flight" : "flightAlt", 0.05 + along * 0.82, -0.02 - index * 0.006, 0.02 + along * 0.24, angle, 0.04, -0.05 * along);
  }
  for (let index = 0; index < 6; index++) {
    const along = index / 5;
    lay(outer, feather(0.92 - along * 0.2, 0.36), index % 2 ? "gloss" : "black", 0.06 + along * 0.72, 0.025, -0.03 + along * 0.2, 0.2 + along * 0.9, 0.09);
    lay(outer, feather(0.8 - along * 0.16, 0.34), "black", 0.06 + along * 0.72, -0.085, -0.02 + along * 0.2, 0.2 + along * 0.9, 0.02);
  }
  // The alula, the small thumb feathers at the wrist.
  lay(outer, feather(0.52, 0.2), "flight", 0.06, 0.04, -0.06, 0.5, 0.02);
  outer.finish();
}
addWing(-1);
addWing(1);

// ---- Tail --------------------------------------------------------------
const tailJoint = joint("TailJoint", bodyJoint, [0, 0.12, 1.85]);
const tail = collector(tailJoint);
for (let index = 0; index < 12; index++) {
  const offset = index - 5.5;
  const spread = Math.abs(offset) / 5.5;
  tail.add(feather(2.05 - spread * spread * 0.46, 0.4), index % 2 ? "flight" : "flightAlt", transform(
    [offset * 0.065, -Math.abs(offset) * 0.012, 0],
    [0.02, offset * 0.062, 0],
  ));
}
tail.finish();

// ---- Legs --------------------------------------------------------------
// Modelled hanging straight down; the clips tuck them back along the belly in
// flight and swing them under the body to perch.
const legJoints = {};
const footJoints = {};
for (const side of [-1, 1]) {
  const suffix = side < 0 ? "L" : "R";
  const legJoint = joint(`LegJoint.${suffix}`, bodyJoint, [side * 0.3, -0.42, 0.5]);
  legJoints[suffix] = legJoint;
  const leg = collector(legJoint);
  leg.add(sphere, "black", transform([0, -0.06, 0], [0, 0, 0], [0.17, 0.26, 0.2]));
  const tarsus = new THREE.CylinderGeometry(0.05, 0.04, 0.5, 7);
  leg.add(tarsus, "horn", transform([0, -0.48, 0]));
  // The foot has its own joint so the toes can trail behind a tucked leg in
  // flight and spread flat to grip a perch.
  const footJoint = joint(`FootJoint.${suffix}`, legJoint, [0, -0.73, 0]);
  footJoints[suffix] = footJoint;
  const foot = collector(footJoint);
  for (const [yaw, length] of [[0, 0.36], [0.5, 0.31], [-0.5, 0.31], [Math.PI, 0.24]]) {
    const toe = new THREE.CylinderGeometry(0.022, 0.03, length, 6);
    toe.rotateX(Math.PI / 2);
    toe.translate(0, 0, -length / 2);
    foot.add(toe, "horn", transform([0, 0, 0], [0.12, yaw, 0]));
    const claw = new THREE.ConeGeometry(0.024, 0.13, 6);
    claw.rotateX(-Math.PI / 2);
    claw.translate(0, 0, -length - 0.05);
    foot.add(claw, "horn", transform([0, 0, 0], [0.3, yaw, 0]));
  }
  foot.finish();
  leg.finish();
}

body.finish();
neck.finish();
head.finish();

// ---- Animation ---------------------------------------------------------
const quaternions = (rotations, order = "YXZ") => rotations.flatMap(([x, y, z]) => {
  const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(x, y, z, order));
  return [q.x, q.y, q.z, q.w];
});
const vectors = (values) => values.flat();

// A pose is written once for the right wing and mirrored for the left.
// `lift` raises the wing about the body's long axis, `fold` sweeps it back, and
// `tilt` rolls its feathers down against the flank.
function wingTracks(times, poses) {
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
      return [side * (SHOULDER[0] + out), SHOULDER[1] + up, SHOULDER[2] + back];
    }))));
  }
  return tracks;
}
// Legs swing back to tuck; the feet curl the other way so the toes trail.
const legTracks = (times, angles) => ["L", "R"].flatMap((suffix) => [
  new THREE.QuaternionKeyframeTrack(`LegJoint.${suffix}.quaternion`, times, quaternions(angles.map((angle) => [angle, 0, 0]))),
  new THREE.QuaternionKeyframeTrack(`FootJoint.${suffix}.quaternion`, times, quaternions(angles.map((angle) => [angle < -0.5 ? FEET_TRAILING : 0, 0, 0]))),
]);
const pitch = (name, times, angles) => new THREE.QuaternionKeyframeTrack(`${name}.quaternion`, times, quaternions(angles.map((angle) => [angle, 0, 0])));
const turn = (name, times, angles) => new THREE.QuaternionKeyframeTrack(`${name}.quaternion`, times, quaternions(angles.map((angle) => [0, angle, 0])));

const LEGS_TUCKED = -1.28;
const FEET_TRAILING = -1.35;
const GLIDE_WING = { shoulder: [0, 0, 0.1], forearm: [0, 0, 0.02], hand: [0, 0, 0.07] };

// Bind pose = glide.
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

// Rest: the wing drops against the flank and its span closes right up. Closing
// the span is also what collapses the fanned primaries into a stack of feathers
// pointing back along the body, the way a real wing folds.
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

const exporter = new GLTFExporter();
const result = await exporter.parseAsync(scene, { binary: true, animations: [flap, glide, rest], onlyVisible: true });
await mkdir("public/models", { recursive: true });
await writeFile("public/models/dhaka-house-crow.glb", Buffer.from(result));
let meshes = 0;
let triangles = 0;
scene.traverse((object) => {
  if (!object.isMesh) return;
  meshes++;
  triangles += (object.geometry.index ? object.geometry.index.count : object.geometry.attributes.position.count) / 3;
});
console.log(`Created public/models/dhaka-house-crow.glb: ${meshes} meshes, ${Math.round(triangles)} triangles, ${(result.byteLength / 1024).toFixed(0)} KB`);
console.log([flap, glide, rest].map((clip) => `${clip.name}: ${clip.tracks.length} tracks`).join(", "));
