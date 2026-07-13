import { mkdir, writeFile } from "node:fs/promises";
import * as THREE from "three";
import { GLTFExporter } from "three/examples/jsm/exporters/GLTFExporter.js";

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

const scene = new THREE.Scene();
scene.name = "DhakaHouseCrow";
const rig = new THREE.Group();
rig.name = "CrowRig";
scene.add(rig);

const plumage = new THREE.MeshStandardMaterial({ color: 0x172126, roughness: 0.46, metalness: 0.18 });
const breast = new THREE.MeshStandardMaterial({ color: 0x29353a, roughness: 0.6, metalness: 0.08 });
const wingMaterial = new THREE.MeshStandardMaterial({ color: 0x10191d, roughness: 0.4, metalness: 0.22 });
const flightFeather = new THREE.MeshStandardMaterial({ color: 0x0c1418, roughness: 0.54, metalness: 0.13 });
const beakMaterial = new THREE.MeshStandardMaterial({ color: 0x2e3738, roughness: 0.72 });
const eyeMaterial = new THREE.MeshStandardMaterial({ color: 0x090b0b, roughness: 0.12, metalness: 0.28 });

function mesh(geometry, material, name, position, scale) {
  const object = new THREE.Mesh(geometry, material);
  object.name = name;
  object.position.set(...position);
  object.scale.set(...scale);
  object.castShadow = true;
  object.receiveShadow = true;
  return object;
}

const bodyJoint = new THREE.Group();
bodyJoint.name = "BodyJoint";
rig.add(bodyJoint);
bodyJoint.add(mesh(new THREE.SphereGeometry(1, 28, 18), plumage, "Body", [0, 0, 0.15], [0.88, 0.66, 1.72]));
bodyJoint.add(mesh(new THREE.SphereGeometry(1, 26, 16), breast, "Breast", [0, 0.05, -0.92], [0.72, 0.62, 0.95]));

const neckJoint = new THREE.Group();
neckJoint.name = "NeckJoint";
neckJoint.position.set(0, 0.22, -1.35);
bodyJoint.add(neckJoint);
neckJoint.add(mesh(new THREE.SphereGeometry(1, 24, 15), breast, "Neck", [0, 0.18, 0], [0.62, 0.61, 0.78]));

const headJoint = new THREE.Group();
headJoint.name = "HeadJoint";
headJoint.position.set(0, 0.44, -0.52);
neckJoint.add(headJoint);
headJoint.add(mesh(new THREE.SphereGeometry(1, 26, 17), plumage, "Head", [0, 0, 0], [0.54, 0.52, 0.59]));

const billGeometry = new THREE.BufferGeometry();
billGeometry.setAttribute("position", new THREE.Float32BufferAttribute([
  -0.28, 0.14, 0, 0.28, 0.14, 0, -0.24, -0.13, 0, 0.24, -0.13, 0,
  -0.025, 0, -1.05, 0.025, 0, -1.05,
], 3));
billGeometry.setIndex([0, 1, 4, 1, 5, 4, 2, 4, 3, 3, 4, 5, 0, 4, 2, 1, 3, 5, 0, 2, 3, 0, 3, 1]);
billGeometry.computeVertexNormals();
headJoint.add(mesh(billGeometry, beakMaterial, "Beak", [0, -0.04, -0.5], [1, 1, 1]));

for (const side of [-1, 1]) {
  const eye = mesh(new THREE.SphereGeometry(1, 16, 10), eyeMaterial, side < 0 ? "Eye.L" : "Eye.R", [side * 0.48, 0.12, -0.22], [0.065, 0.065, 0.052]);
  headJoint.add(eye);
}

function wingGeometry(side) {
  const shape = new THREE.Shape();
  shape.moveTo(0, -0.48);
  shape.bezierCurveTo(side * 1.4, -0.55, side * 3.3, -0.15, side * 5.6, 0.75);
  shape.bezierCurveTo(side * 5.9, 0.92, side * 5.65, 1.25, side * 5.15, 1.48);
  shape.bezierCurveTo(side * 4.3, 1.9, side * 3.2, 2.28, side * 2.1, 2.05);
  shape.bezierCurveTo(side * 1.05, 1.82, side * 0.4, 1.25, 0, 0.85);
  shape.closePath();
  const geometry = new THREE.ExtrudeGeometry(shape, { depth: 0.16, bevelEnabled: true, bevelSize: 0.09, bevelThickness: 0.08, bevelSegments: 3, curveSegments: 18 });
  geometry.rotateX(-Math.PI / 2);
  geometry.translate(0, -0.08, 0);
  geometry.computeVertexNormals();
  return geometry;
}

function addWing(side) {
  const joint = new THREE.Group();
  joint.name = side < 0 ? "WingJoint.L" : "WingJoint.R";
  joint.position.set(side * 0.55, 0.12, -0.68);
  bodyJoint.add(joint);
  joint.add(mesh(wingGeometry(side), wingMaterial, side < 0 ? "Wing.L" : "Wing.R", [0, 0, 0], [1, 1, 1]));

  for (let i = 0; i < 5; i++) {
    const feather = mesh(
      new THREE.SphereGeometry(1, 18, 10), flightFeather,
      `${side < 0 ? "Primary.L" : "Primary.R"}.${i + 1}`,
      [side * (3.5 + i * 0.35), -0.05, 1.05 + i * 0.2],
      [0.19, 0.085, 1.15 + i * 0.12],
    );
    feather.rotation.y = side * (0.17 + i * 0.035);
    joint.add(feather);
  }
  return joint;
}

const leftWing = addWing(-1);
const rightWing = addWing(1);

const tailJoint = new THREE.Group();
tailJoint.name = "TailJoint";
tailJoint.position.set(0, -0.02, 1.45);
bodyJoint.add(tailJoint);
for (let i = -2; i <= 2; i++) {
  const tail = mesh(new THREE.SphereGeometry(1, 18, 10), flightFeather, `TailFeather.${i + 3}`, [i * 0.2, 0, 0.95 + Math.abs(i) * 0.05], [0.2, 0.08, 1.42]);
  tail.rotation.y = i * 0.07;
  tailJoint.add(tail);
}

for (const side of [-1, 1]) {
  const leg = mesh(new THREE.CylinderGeometry(0.055, 0.07, 0.7, 8), beakMaterial, side < 0 ? "Leg.L" : "Leg.R", [side * 0.28, -0.58, 0.38], [1, 1, 1]);
  leg.rotation.x = -0.78;
  bodyJoint.add(leg);
}

function quaternionValues(axis, angles) {
  return angles.flatMap((angle) => {
    const q = new THREE.Quaternion().setFromAxisAngle(axis, angle);
    return [q.x, q.y, q.z, q.w];
  });
}

const flapTimes = [0, 0.18, 0.42, 0.68, 1];
const flap = new THREE.AnimationClip("Flap", 1, [
  new THREE.QuaternionKeyframeTrack("WingJoint.L.quaternion", flapTimes, quaternionValues(new THREE.Vector3(0, 0, 1), [0.08, -0.82, 0.08, 0.56, 0.08])),
  new THREE.QuaternionKeyframeTrack("WingJoint.R.quaternion", flapTimes, quaternionValues(new THREE.Vector3(0, 0, 1), [-0.08, 0.82, -0.08, -0.56, -0.08])),
  new THREE.VectorKeyframeTrack("BodyJoint.position", flapTimes, [0,0,0, 0,0.07,0, 0,0,0, 0,-0.025,0, 0,0,0]),
  new THREE.QuaternionKeyframeTrack("TailJoint.quaternion", flapTimes, quaternionValues(new THREE.Vector3(1, 0, 0), [0, -0.08, 0, 0.05, 0])),
]);

const glideTimes = [0, 1.2, 2.4];
const glide = new THREE.AnimationClip("Glide", 2.4, [
  new THREE.QuaternionKeyframeTrack("WingJoint.L.quaternion", glideTimes, quaternionValues(new THREE.Vector3(0, 0, 1), [0.08, 0.02, 0.08])),
  new THREE.QuaternionKeyframeTrack("WingJoint.R.quaternion", glideTimes, quaternionValues(new THREE.Vector3(0, 0, 1), [-0.08, -0.02, -0.08])),
  new THREE.QuaternionKeyframeTrack("HeadJoint.quaternion", glideTimes, quaternionValues(new THREE.Vector3(0, 1, 0), [-0.05, 0.07, -0.05])),
  new THREE.QuaternionKeyframeTrack("TailJoint.quaternion", glideTimes, quaternionValues(new THREE.Vector3(1, 0, 0), [0.02, -0.035, 0.02])),
]);

const restTimes = [0, 1.5, 3];
const rest = new THREE.AnimationClip("Rest", 3, [
  new THREE.QuaternionKeyframeTrack("WingJoint.L.quaternion", restTimes, quaternionValues(new THREE.Vector3(0, 0, 1), [-1.12, -1.18, -1.12])),
  new THREE.QuaternionKeyframeTrack("WingJoint.R.quaternion", restTimes, quaternionValues(new THREE.Vector3(0, 0, 1), [1.12, 1.18, 1.12])),
  new THREE.QuaternionKeyframeTrack("HeadJoint.quaternion", restTimes, quaternionValues(new THREE.Vector3(0, 1, 0), [-0.16, 0.18, -0.16])),
  new THREE.VectorKeyframeTrack("BodyJoint.position", restTimes, [0,0,0, 0,0.025,0, 0,0,0]),
  new THREE.QuaternionKeyframeTrack("TailJoint.quaternion", restTimes, quaternionValues(new THREE.Vector3(1, 0, 0), [0.09, 0.06, 0.09])),
]);

const exporter = new GLTFExporter();
const result = await exporter.parseAsync(scene, { binary: true, animations: [flap, glide, rest], onlyVisible: true });
await mkdir("public/models", { recursive: true });
await writeFile("public/models/dhaka-house-crow.glb", Buffer.from(result));
console.log("Created public/models/dhaka-house-crow.glb");
