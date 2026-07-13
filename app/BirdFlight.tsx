"use client";

import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js";
import { Sky } from "three/examples/jsm/objects/Sky.js";

type CameraMode = "CHASE" | "BIRD'S EYE";
type BuildingCollider = { x: number; z: number; halfWidth: number; halfDepth: number; top: number };
type Perch = { position: THREE.Vector3; label: string; heading: number };
type WaterRibbon = THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>;
type BirdFlightWindow = Window & {
  __birdFlightDiagnostics?: () => {
    calls: number;
    triangles: number;
    geometries: number;
    textures: number;
    objects: number;
  };
};
type FlightAudio = {
  start: () => Promise<boolean>;
  toggle: () => Promise<boolean>;
  pause: () => void;
  resume: () => void;
  flap: () => void;
  setFlight: (speed: number, altitude: number) => void;
  dispose: () => void;
};

const clamp = THREE.MathUtils.clamp;

function seededRandom(seed = 713) {
  let value = seed;
  return () => {
    value = (value * 16807) % 2147483647;
    return (value - 1) / 2147483646;
  };
}

function createFlightAudio(): FlightAudio {
  let context: AudioContext | null = null;
  let master: GainNode | null = null;
  let windGain: GainNode | null = null;
  let windFilter: BiquadFilterNode | null = null;
  let waterGain: GainNode | null = null;
  let cityGain: GainNode | null = null;
  let flapBuffer: AudioBuffer | null = null;
  let enabled = false;

  const makeNoise = (audioContext: AudioContext, duration: number, softness = 0.76) => {
    const buffer = audioContext.createBuffer(1, audioContext.sampleRate * duration, audioContext.sampleRate);
    const data = buffer.getChannelData(0);
    let previous = 0;
    for (let i = 0; i < data.length; i++) {
      const white = Math.random() * 2 - 1;
      previous = previous * softness + white * (1 - softness);
      data[i] = previous;
    }
    return buffer;
  };

  const initialize = () => {
    if (context) return;
    context = new AudioContext();
    master = context.createGain();
    master.gain.value = 0;
    master.connect(context.destination);

    const windSource = context.createBufferSource();
    windSource.buffer = makeNoise(context, 4.5, 0.84);
    windSource.loop = true;
    windFilter = context.createBiquadFilter();
    windFilter.type = "lowpass";
    windFilter.frequency.value = 620;
    windFilter.Q.value = 0.45;
    windGain = context.createGain();
    windGain.gain.value = 0.038;
    windSource.connect(windFilter).connect(windGain).connect(master);
    windSource.start();

    const waterSource = context.createBufferSource();
    waterSource.buffer = makeNoise(context, 5.2, 0.91);
    waterSource.loop = true;
    const waterFilter = context.createBiquadFilter();
    waterFilter.type = "bandpass";
    waterFilter.frequency.value = 920;
    waterFilter.Q.value = 0.7;
    waterGain = context.createGain();
    waterGain.gain.value = 0.01;
    waterSource.connect(waterFilter).connect(waterGain).connect(master);
    waterSource.start();

    const cityTone = context.createOscillator();
    cityTone.type = "sine";
    cityTone.frequency.value = 73;
    cityGain = context.createGain();
    cityGain.gain.value = 0.008;
    cityTone.connect(cityGain).connect(master);
    cityTone.start();

    const breath = context.createOscillator();
    breath.type = "sine";
    breath.frequency.value = 0.08;
    const breathDepth = context.createGain();
    breathDepth.gain.value = 0.008;
    breath.connect(breathDepth).connect(windGain.gain);
    breath.start();

    flapBuffer = makeNoise(context, 0.34, 0.68);
  };

  const start = async () => {
    initialize();
    if (!context || !master) return false;
    await context.resume();
    enabled = true;
    master.gain.cancelScheduledValues(context.currentTime);
    master.gain.setTargetAtTime(0.28, context.currentTime, 0.45);
    return true;
  };

  return {
    start,
    async toggle() {
      if (!context || !master) return start();
      if (context.state === "suspended") await context.resume();
      enabled = !enabled;
      master.gain.cancelScheduledValues(context.currentTime);
      master.gain.setTargetAtTime(enabled ? 0.28 : 0, context.currentTime, 0.18);
      return enabled;
    },
    pause() {
      if (!context || !master) return;
      master.gain.cancelScheduledValues(context.currentTime);
      master.gain.setTargetAtTime(0, context.currentTime, 0.22);
    },
    resume() {
      if (!enabled || !context || !master) return;
      void context.resume();
      master.gain.cancelScheduledValues(context.currentTime);
      master.gain.setTargetAtTime(0.28, context.currentTime, 0.35);
    },
    flap() {
      if (!enabled || !context || !master || !flapBuffer) return;
      const source = context.createBufferSource();
      source.buffer = flapBuffer;
      const filter = context.createBiquadFilter();
      filter.type = "lowpass";
      filter.frequency.value = 780;
      const gain = context.createGain();
      const now = context.currentTime;
      gain.gain.setValueAtTime(0.001, now);
      gain.gain.exponentialRampToValueAtTime(0.055, now + 0.045);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.3);
      source.connect(filter).connect(gain).connect(master);
      source.start(now);
    },
    setFlight(speed, altitude) {
      if (!context || !windGain || !windFilter || !waterGain || !cityGain) return;
      const now = context.currentTime;
      windGain.gain.setTargetAtTime(0.025 + speed / 1450, now, 0.35);
      windFilter.frequency.setTargetAtTime(420 + speed * 7.5, now, 0.4);
      const nearness = clamp(1 - altitude / 190, 0, 1);
      waterGain.gain.setTargetAtTime(0.004 + nearness * 0.021, now, 0.7);
      cityGain.gain.setTargetAtTime(0.004 + nearness * 0.008, now, 0.8);
    },
    dispose() {
      enabled = false;
      context?.close();
      context = null;
    },
  };
}

function addCity(scene: THREE.Scene) {
  const random = seededRandom();
  const colliders: BuildingCollider[] = [];
  const sharedBox = new RoundedBoxGeometry(1, 1, 1, 2, 0.055);
  const unitBox = new THREE.BoxGeometry(1, 1, 1);

  const makeGroundTexture = () => {
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = 192;
    const context = canvas.getContext("2d");
    if (!context) return null;
    context.fillStyle = "#77866e";
    context.fillRect(0, 0, canvas.width, canvas.height);
    for (let i = 0; i < 3600; i++) {
      const lightness = 34 + Math.floor(random() * 18);
      context.fillStyle = `hsla(${82 + random() * 20}, 15%, ${lightness}%, ${0.06 + random() * 0.1})`;
      const size = 1 + random() * 3.5;
      context.fillRect(random() * canvas.width, random() * canvas.height, size, size);
    }
    const texture = new THREE.CanvasTexture(canvas);
    texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
    texture.repeat.set(24, 24);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = 4;
    return texture;
  };

  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(2400, 2400),
    new THREE.MeshStandardMaterial({ color: 0x87937a, map: makeGroundTexture(), roughness: 1 }),
  );
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  scene.add(ground);

  const waterShape = new THREE.Shape();
  const top: THREE.Vector2[] = [];
  const bottom: THREE.Vector2[] = [];
  for (let x = -1000; x <= 1000; x += 80) {
    const bend = Math.sin(x * 0.0042) * 90 + Math.sin(x * 0.009) * 24;
    const width = 105 + Math.sin(x * 0.006 + 1) * 28;
    top.push(new THREE.Vector2(x, bend + width));
    bottom.push(new THREE.Vector2(x, bend - width));
  }
  waterShape.moveTo(top[0].x, top[0].y);
  top.slice(1).forEach((p) => waterShape.lineTo(p.x, p.y));
  bottom.reverse().forEach((p) => waterShape.lineTo(p.x, p.y));
  waterShape.closePath();
  const water = new THREE.Mesh(
    new THREE.ShapeGeometry(waterShape),
    new THREE.MeshPhysicalMaterial({
      color: 0x397f88,
      roughness: 0.2,
      metalness: 0.05,
      clearcoat: 0.72,
      clearcoatRoughness: 0.24,
      reflectivity: 0.64,
    }),
  );
  water.rotation.x = -Math.PI / 2;
  water.position.y = 0.45;
  water.receiveShadow = true;
  water.name = "Hatirjheel Lake";
  scene.add(water);

  const waterRibbons: WaterRibbon[] = [];
  const ribbonGeometry = new THREE.PlaneGeometry(54, 1.25);
  for (let i = 0; i < 52; i++) {
    const x = -980 + random() * 1960;
    const center = Math.sin(x * 0.0042) * 90 + Math.sin(x * 0.009) * 24;
    const ribbon = new THREE.Mesh(
      ribbonGeometry,
      new THREE.MeshBasicMaterial({ color: i % 3 === 0 ? 0xc9e1d7 : 0x7eb7b2, transparent: true, opacity: 0.18, depthWrite: false }),
    );
    ribbon.rotation.x = -Math.PI / 2;
    ribbon.rotation.z = (random() - 0.5) * 0.14;
    ribbon.scale.x = 0.45 + random() * 1.15;
    ribbon.position.set(x, 0.58 + random() * 0.025, center + (random() - 0.5) * 125);
    ribbon.userData.phase = random() * Math.PI * 2;
    scene.add(ribbon);
    waterRibbons.push(ribbon);
  }
  scene.userData.waterRibbons = waterRibbons;

  const roadMaterial = new THREE.MeshStandardMaterial({ color: 0x3f4746, roughness: 0.92 });
  const lineMaterial = new THREE.MeshStandardMaterial({ color: 0xd6c879, roughness: 0.74 });
  const concreteMaterial = new THREE.MeshStandardMaterial({ color: 0xa6a696, roughness: 0.95 });
  const curbGeometry = new THREE.BoxGeometry(2200, 1.4, 3.2);
  for (const z of [-285, 285]) {
    const road = new THREE.Mesh(new THREE.BoxGeometry(2200, 1.1, 38), roadMaterial);
    road.position.set(0, 0.55, z);
    road.receiveShadow = true;
    scene.add(road);
    for (let x = -1050; x < 1050; x += 55) {
      const line = new THREE.Mesh(new THREE.BoxGeometry(26, 0.15, 1.5), lineMaterial);
      line.position.set(x, 1.15, z);
      scene.add(line);
    }
    for (const side of [-1, 1]) {
      const curb = new THREE.Mesh(curbGeometry, concreteMaterial);
      curb.position.set(0, 1.05, z + side * 21);
      curb.receiveShadow = true;
      scene.add(curb);
    }
  }

  const traffic: THREE.Group[] = [];
  const carColors = [0xe0b653, 0xb54f46, 0x4e7380, 0xd8d2ba, 0x45604f];
  for (let i = 0; i < 24; i++) {
    const car = new THREE.Group();
    const paint = new THREE.MeshStandardMaterial({ color: carColors[i % carColors.length], roughness: 0.38, metalness: 0.22 });
    const chassis = new THREE.Mesh(sharedBox, paint);
    chassis.scale.set(6.6, 1.8, 3.2);
    chassis.position.y = 1.15;
    chassis.castShadow = true;
    car.add(chassis);
    const cabin = new THREE.Mesh(sharedBox, new THREE.MeshStandardMaterial({ color: 0x7f9998, roughness: 0.2, metalness: 0.18 }));
    cabin.scale.set(3.2, 1.35, 2.75);
    cabin.position.set(-0.25, 2.35, 0);
    cabin.castShadow = true;
    car.add(cabin);
    for (const side of [-1, 1]) {
      for (const axle of [-2.1, 2.15]) {
        const wheel = new THREE.Mesh(new THREE.CylinderGeometry(0.66, 0.66, 0.38, 10), new THREE.MeshStandardMaterial({ color: 0x171b1b, roughness: 0.95 }));
        wheel.rotation.x = Math.PI / 2;
        wheel.position.set(axle, 0.68, side * 1.7);
        car.add(wheel);
      }
    }
    car.position.set(-1050 + random() * 2100, 3.1, i % 2 === 0 ? -281 : 281);
    car.userData.direction = i % 4 < 2 ? 1 : -1;
    car.userData.speed = 13 + random() * 12;
    car.castShadow = true;
    scene.add(car);
    traffic.push(car);
  }
  scene.userData.traffic = traffic;

  const lampPosts = new THREE.Group();
  const lampMetal = new THREE.MeshStandardMaterial({ color: 0x454f4e, roughness: 0.64, metalness: 0.5 });
  const lampGlow = new THREE.MeshBasicMaterial({ color: 0xffe4a8 });
  for (const z of [-309, 309]) {
    for (let x = -1000; x <= 1000; x += 95) {
      const post = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.48, 10, 7), lampMetal);
      post.position.set(x, 6, z);
      const light = new THREE.Mesh(new THREE.SphereGeometry(0.66, 8, 5), lampGlow);
      light.position.set(x, 11.2, z);
      lampPosts.add(post, light);
    }
  }
  scene.add(lampPosts);

  for (const x of [-590, -70, 510]) {
    const bridgeCenter = Math.sin(x * 0.0042) * 90;
    const bridge = new THREE.Group();
    bridge.position.set(x, 0, bridgeCenter);
    const deck = new THREE.Mesh(new THREE.BoxGeometry(42, 5, 440), roadMaterial);
    deck.position.y = 6;
    deck.castShadow = true;
    deck.receiveShadow = true;
    bridge.add(deck);
    for (const side of [-1, 1]) {
      const rail = new THREE.Mesh(new THREE.BoxGeometry(3, 5, 440), lineMaterial);
      rail.position.set(side * 19, 10, 0);
      bridge.add(rail);
    }
    for (const offset of [-150, 0, 150]) {
      const pier = new THREE.Mesh(new THREE.CylinderGeometry(5.5, 7.5, 16, 8), concreteMaterial);
      pier.position.set(0, 0.5, offset);
      pier.castShadow = true;
      bridge.add(pier);
    }
    scene.add(bridge);
  }

  const buildingColors = [0xd6c49f, 0xb8c0b7, 0xc99072, 0x9cad9d, 0xd0d0c1, 0xa77f68];
  const buildingMaterials = buildingColors.map((color) => new THREE.MeshStandardMaterial({ color, roughness: 0.78 }));
  const facadeMaterials = buildingColors.map((color) => new THREE.MeshStandardMaterial({ color: new THREE.Color(color).multiplyScalar(0.82), roughness: 0.84 }));
  const rooftopMaterial = new THREE.MeshStandardMaterial({ color: 0x777f74, roughness: 0.86 });
  const tankMaterials = [0x4c5b55, 0x947f68, 0x325d62].map((color) => new THREE.MeshStandardMaterial({ color, roughness: 0.7, metalness: 0.08 }));
  const windows: Array<{ position: THREE.Vector3; quaternion: THREE.Quaternion; scale: THREE.Vector3; color: THREE.Color }> = [];
  const local = new THREE.Vector3();
  const world = new THREE.Vector3();
  const buildingQuaternion = new THREE.Quaternion();

  for (let gx = -1050; gx <= 1050; gx += 126) {
    for (let gz = -980; gz <= 980; gz += 126) {
      const lakeCenter = Math.sin(gx * 0.0042) * 90 + Math.sin(gx * 0.009) * 24;
      if (
        Math.abs(gz - lakeCenter) < 205 ||
        Math.abs(Math.abs(gz) - 285) < 46 ||
        Math.abs(gx - 180) < 220 ||
        random() < 0.12
      ) continue;
      const width = 42 + random() * 35;
      const depth = 40 + random() * 34;
      const central = 1 - clamp(Math.hypot(gx * 0.55, gz * 0.55) / 950, 0, 1);
      const height = 18 + random() * 52 + central * random() * 82;
      const colorIndex = Math.floor(random() * buildingMaterials.length);
      const building = new THREE.Group();
      building.position.set(gx + (random() - 0.5) * 20, 0, gz + (random() - 0.5) * 20);
      building.rotation.y = (random() - 0.5) * 0.12;
      const body = new THREE.Mesh(sharedBox, buildingMaterials[colorIndex]);
      body.scale.set(width, height, depth);
      body.position.y = height / 2;
      body.castShadow = true;
      body.receiveShadow = true;
      building.add(body);

      const lowerBand = new THREE.Mesh(unitBox, facadeMaterials[colorIndex]);
      lowerBand.scale.set(width * 1.015, 4.2, depth * 1.015);
      lowerBand.position.y = 2.15;
      building.add(lowerBand);

      const parapet = new THREE.Mesh(sharedBox, rooftopMaterial);
      parapet.scale.set(width * 0.88, 1.6, depth * 0.88);
      parapet.position.y = height + 0.7;
      building.add(parapet);

      if (height > 40 && random() > 0.35) {
        const stairHouse = new THREE.Mesh(sharedBox, facadeMaterials[colorIndex]);
        stairHouse.scale.set(width * (0.2 + random() * 0.16), 5 + random() * 7, depth * (0.22 + random() * 0.17));
        stairHouse.position.set((random() - 0.5) * width * 0.42, height + stairHouse.scale.y / 2 + 1.2, (random() - 0.5) * depth * 0.36);
        stairHouse.castShadow = true;
        building.add(stairHouse);
        if (random() > 0.45) {
          const tank = new THREE.Mesh(new THREE.CylinderGeometry(2.1, 2.35, 4.4, 10), tankMaterials[Math.floor(random() * tankMaterials.length)]);
          tank.position.set(-stairHouse.position.x * 0.65, height + 3.2, -stairHouse.position.z * 0.55);
          tank.castShadow = true;
          building.add(tank);
        }
      }
      scene.add(building);
      colliders.push({
        x: building.position.x,
        z: building.position.z,
        halfWidth: width * 0.58,
        halfDepth: depth * 0.58,
        top: height,
      });

      if (height > 24 && random() > 0.18) {
        buildingQuaternion.setFromAxisAngle(new THREE.Vector3(0, 1, 0), building.rotation.y);
        const floors = Math.min(14, Math.floor((height - 8) / 6));
        const frontColumns = Math.max(3, Math.floor(width / 8));
        const sideColumns = Math.max(3, Math.floor(depth / 8));
        for (let floor = 0; floor < floors; floor++) {
          const y = 7.2 + floor * 5.8;
          for (let column = 0; column < frontColumns; column++) {
            local.set(-width * 0.37 + (column / Math.max(1, frontColumns - 1)) * width * 0.74, y, -depth / 2 - 0.08);
            world.copy(local).applyQuaternion(buildingQuaternion).add(building.position);
            windows.push({
              position: world.clone(),
              quaternion: buildingQuaternion.clone(),
              scale: new THREE.Vector3(Math.min(4.3, width / (frontColumns * 1.7)), 2.35, 0.16),
              color: new THREE.Color(random() > 0.18 ? 0x719092 : 0xd6b879),
            });
          }
          if (random() > 0.28) {
            for (let column = 0; column < sideColumns; column++) {
              local.set(width / 2 + 0.08, y, -depth * 0.37 + (column / Math.max(1, sideColumns - 1)) * depth * 0.74);
              world.copy(local).applyQuaternion(buildingQuaternion).add(building.position);
              const sideQuaternion = buildingQuaternion.clone().multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI / 2));
              windows.push({
                position: world.clone(),
                quaternion: sideQuaternion,
                scale: new THREE.Vector3(Math.min(4.2, depth / (sideColumns * 1.7)), 2.35, 0.16),
                color: new THREE.Color(random() > 0.17 ? 0x6d8989 : 0xd6b879),
              });
            }
          }
        }
      }
    }
  }

  const windowMaterial = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.26, metalness: 0.24, vertexColors: true });
  const windowMesh = new THREE.InstancedMesh(unitBox, windowMaterial, windows.length);
  windowMesh.name = "Building windows";
  const matrix = new THREE.Matrix4();
  windows.forEach((window, index) => {
    matrix.compose(window.position, window.quaternion, window.scale);
    windowMesh.setMatrixAt(index, matrix);
    windowMesh.setColorAt(index, window.color);
  });
  windowMesh.instanceMatrix.needsUpdate = true;
  if (windowMesh.instanceColor) windowMesh.instanceColor.needsUpdate = true;
  scene.add(windowMesh);

  const treeTrunk = new THREE.CylinderGeometry(1.1, 1.65, 7.5, 6);
  const treeTop = new THREE.IcosahedronGeometry(1, 1);
  const trunkMaterial = new THREE.MeshStandardMaterial({ color: 0x665244, roughness: 1 });
  const leafMaterials = [0x355f44, 0x4d744c, 0x70834d].map((color) => new THREE.MeshStandardMaterial({ color, roughness: 0.92, flatShading: true }));
  const trunkMatrices: THREE.Matrix4[] = [];
  const foliageMatrices: THREE.Matrix4[][] = [[], [], []];
  const treeQuaternion = new THREE.Quaternion();
  const treeScale = new THREE.Vector3();
  for (let i = 0; i < 170; i++) {
    const x = (random() - 0.5) * 2200;
    const z = (random() - 0.5) * 2100;
    const lakeCenter = Math.sin(x * 0.0042) * 90;
    if (Math.abs(z - lakeCenter) < 125) continue;
    const treeHeight = 0.75 + random() * 0.55;
    treeScale.set(1, treeHeight, 1);
    trunkMatrices.push(new THREE.Matrix4().compose(new THREE.Vector3(x, 3.75 * treeHeight, z), treeQuaternion, treeScale.clone()));
    for (let cluster = 0; cluster < 3; cluster++) {
      const foliageIndex = (i + cluster) % leafMaterials.length;
      const foliagePosition = new THREE.Vector3(
        x + (cluster - 1) * (2.3 + random() * 1.8),
        9.2 * treeHeight + (cluster === 1 ? 3 : 0),
        z + (random() - 0.5) * 3.6,
      );
      const foliageQuaternion = new THREE.Quaternion().setFromEuler(new THREE.Euler(random(), random(), random()));
      const foliageScale = new THREE.Vector3(4.4 + random() * 2.5, 4 + random() * 3, 4.4 + random() * 2.8);
      foliageMatrices[foliageIndex].push(new THREE.Matrix4().compose(foliagePosition, foliageQuaternion, foliageScale));
    }
  }
  const trunks = new THREE.InstancedMesh(treeTrunk, trunkMaterial, trunkMatrices.length);
  trunkMatrices.forEach((transform, index) => trunks.setMatrixAt(index, transform));
  trunks.instanceMatrix.needsUpdate = true;
  scene.add(trunks);
  foliageMatrices.forEach((transforms, materialIndex) => {
    const foliage = new THREE.InstancedMesh(treeTop, leafMaterials[materialIndex], transforms.length);
    transforms.forEach((transform, index) => foliage.setMatrixAt(index, transform));
    foliage.instanceMatrix.needsUpdate = true;
    foliage.castShadow = true;
    scene.add(foliage);
  });

  const tower = new THREE.Group();
  const towerMaterial = new THREE.MeshStandardMaterial({ color: 0xd7c9ac, roughness: 0.75 });
  const towerBody = new THREE.Mesh(new THREE.CylinderGeometry(18, 27, 150, 8), towerMaterial);
  towerBody.position.y = 75;
  towerBody.castShadow = true;
  tower.add(towerBody);
  const crown = new THREE.Mesh(new THREE.CylinderGeometry(30, 22, 24, 8), new THREE.MeshStandardMaterial({ color: 0x647b76 }));
  crown.position.y = 157;
  tower.add(crown);
  const spire = new THREE.Mesh(new THREE.CylinderGeometry(2, 4, 62, 6), towerMaterial);
  spire.position.y = 200;
  tower.add(spire);
  tower.position.set(720, 0, -430);
  scene.add(tower);
  colliders.push({ x: 720, z: -430, halfWidth: 32, halfDepth: 32, top: 220 });

  const perches: Perch[] = [
    { position: new THREE.Vector3(-571, 13, Math.sin(-590 * 0.0042) * 90 + 78), label: "West bridge rail", heading: 0 },
    { position: new THREE.Vector3(-51, 13, Math.sin(-70 * 0.0042) * 90 - 72), label: "Central bridge rail", heading: Math.PI },
    { position: new THREE.Vector3(529, 13, Math.sin(510 * 0.0042) * 90 + 62), label: "East bridge rail", heading: 0 },
    { position: new THREE.Vector3(745, 174, -430), label: "Tower crown", heading: -Math.PI / 2 },
  ];
  const perchMaterial = new THREE.MeshStandardMaterial({ color: 0x4a5552, roughness: 0.72, metalness: 0.2 });
  const perchMarkers: THREE.Group[] = [];
  for (const [index, perch] of perches.entries()) {
    const bar = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.42, 17, 12), perchMaterial);
    bar.position.copy(perch.position);
    bar.rotation.x = Math.PI / 2;
    bar.castShadow = true;
    scene.add(bar);

    const marker = new THREE.Group();
    marker.position.copy(perch.position).add(new THREE.Vector3(0, 3.2, 0));
    marker.userData.baseY = marker.position.y;
    marker.userData.phase = index * 0.9;
    const markerMaterial = new THREE.MeshBasicMaterial({
      color: 0xd8ff62,
      transparent: true,
      opacity: 0.68,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    const ring = new THREE.Mesh(new THREE.TorusGeometry(3.3, 0.12, 10, 40), markerMaterial);
    ring.rotation.x = Math.PI / 2;
    marker.add(ring);
    const innerRing = new THREE.Mesh(new THREE.TorusGeometry(1.45, 0.06, 8, 32), markerMaterial.clone());
    innerRing.rotation.x = Math.PI / 2;
    innerRing.position.y = 0.25;
    marker.add(innerRing);
    const shimmer = new THREE.Mesh(
      new THREE.CylinderGeometry(0.08, 0.34, 5.5, 10, 1, true),
      new THREE.MeshBasicMaterial({ color: 0xd8ff62, transparent: true, opacity: 0.16, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide }),
    );
    shimmer.position.y = 2.8;
    marker.add(shimmer);
    scene.add(marker);
    perchMarkers.push(marker);
  }
  scene.userData.perches = perches;
  scene.userData.perchMarkers = perchMarkers;

  const clouds: THREE.Group[] = [];
  const cloudMaterial = new THREE.MeshStandardMaterial({ color: 0xe9e5d5, roughness: 1, transparent: true, opacity: 0.55 });
  for (let i = 0; i < 7; i++) {
    const cloud = new THREE.Group();
    for (let puff = 0; puff < 5; puff++) {
      const sphere = new THREE.Mesh(new THREE.SphereGeometry(1, 18, 12), cloudMaterial);
      sphere.position.set((puff - 2) * 18 + random() * 8, random() * 7, random() * 10);
      sphere.scale.set(19 + random() * 12, 7 + random() * 5, 11 + random() * 8);
      cloud.add(sphere);
    }
    cloud.position.set(-1000 + random() * 2000, 245 + random() * 115, -1100 + random() * 2200);
    cloud.userData.speed = 1.2 + random() * 1.8;
    scene.add(cloud);
    clouds.push(cloud);
  }
  scene.userData.clouds = clouds;
  return colliders;
}

export function BirdFlight() {
  const mountRef = useRef<HTMLDivElement>(null);
  const speedRef = useRef<HTMLSpanElement>(null);
  const altitudeRef = useRef<HTMLSpanElement>(null);
  const compassRef = useRef<HTMLSpanElement>(null);
  const mapBirdRef = useRef<HTMLDivElement>(null);
  const perchPromptRef = useRef<HTMLDivElement>(null);
  const perchLabelRef = useRef<HTMLSpanElement>(null);
  const flyingRef = useRef(false);
  const pausedRef = useRef(false);
  const restingRef = useRef(false);
  const cameraModeRef = useRef<CameraMode>("CHASE");
  const audioRef = useRef<FlightAudio | null>(null);
  const [flying, setFlying] = useState(false);
  const [paused, setPaused] = useState(false);
  const [resting, setResting] = useState(false);
  const [cameraMode, setCameraMode] = useState<CameraMode>("CHASE");
  const [controlsOpen, setControlsOpen] = useState(false);
  const [soundOn, setSoundOn] = useState(false);

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;
    const flightAudio = createFlightAudio();
    audioRef.current = flightAudio;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0xa9c9ca);
    scene.fog = new THREE.FogExp2(0xa9c3bf, 0.00062);
    const camera = new THREE.PerspectiveCamera(58, mount.clientWidth / mount.clientHeight, 0.5, 4000);
    const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: "high-performance" });
    renderer.setSize(mount.clientWidth, mount.clientHeight);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFShadowMap;
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 0.82;
    mount.appendChild(renderer.domElement);

    const sky = new Sky();
    sky.scale.setScalar(3800);
    const skyUniforms = sky.material.uniforms;
    skyUniforms.turbidity.value = 5.8;
    skyUniforms.rayleigh.value = 3.15;
    skyUniforms.mieCoefficient.value = 0.0035;
    skyUniforms.mieDirectionalG.value = 0.84;
    const sunPosition = new THREE.Vector3().setFromSphericalCoords(1, THREE.MathUtils.degToRad(63), THREE.MathUtils.degToRad(232));
    skyUniforms.sunPosition.value.copy(sunPosition);
    scene.add(sky);

    scene.add(new THREE.HemisphereLight(0xe8f3ee, 0x5d6c58, 1.8));
    const sun = new THREE.DirectionalLight(0xffd6a0, 3.35);
    sun.position.set(-400, 650, 280);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    sun.shadow.camera.left = -700;
    sun.shadow.camera.right = 700;
    sun.shadow.camera.top = 700;
    sun.shadow.camera.bottom = -700;
    sun.shadow.camera.far = 1700;
    sun.shadow.bias = -0.00012;
    sun.shadow.normalBias = 0.035;
    scene.add(sun);
    const skyFill = new THREE.DirectionalLight(0x9bc8d2, 0.48);
    skyFill.position.set(500, 260, -600);
    scene.add(skyFill);

    const buildingColliders = addCity(scene);

    const crow = new THREE.Group();
    crow.name = "PlayerCrow";
    crow.position.set(180, 92, 420);
    scene.add(crow);
    let mixer: THREE.AnimationMixer | null = null;
    let flapAction: THREE.AnimationAction | null = null;
    let glideAction: THREE.AnimationAction | null = null;
    let restAction: THREE.AnimationAction | null = null;
    let disposed = false;
    new GLTFLoader().load("/models/dhaka-house-crow.glb", (gltf) => {
      if (disposed) return;
      const model = gltf.scene;
      model.scale.setScalar(0.92);
      model.traverse((object) => {
        if (object instanceof THREE.Mesh) {
          object.castShadow = true;
          object.receiveShadow = true;
        }
      });
      crow.add(model);
      mixer = new THREE.AnimationMixer(model);
      flapAction = mixer.clipAction(gltf.animations.find((clip) => clip.name === "Flap") ?? gltf.animations[0]);
      glideAction = mixer.clipAction(gltf.animations.find((clip) => clip.name === "Glide") ?? gltf.animations[1]);
      restAction = mixer.clipAction(gltf.animations.find((clip) => clip.name === "Rest") ?? gltf.animations[2]);
      flapAction.play();
      glideAction.play();
      restAction.play();
      flapAction.setEffectiveWeight(0.08);
      glideAction.setEffectiveWeight(0.92);
      restAction.setEffectiveWeight(0);
    });

    (window as BirdFlightWindow).__birdFlightDiagnostics = () => ({
      calls: renderer.info.render.calls,
      triangles: renderer.info.render.triangles,
      geometries: renderer.info.memory.geometries,
      textures: renderer.info.memory.textures,
      objects: scene.children.reduce((count, child) => count + 1 + child.children.length, 0),
    });

    const keys = new Set<string>();
    let yaw = 0.15;
    let yawRate = 0;
    let pitch = 0;
    let roll = 0;
    let speed = 44;
    let flapKick = 0;
    let lastFrame = performance.now();
    let elapsedTime = 0;
    let diagnosticFrame = 0;
    const desiredCamera = new THREE.Vector3();
    const desiredTarget = new THREE.Vector3();
    const forward = new THREE.Vector3();
    const previousPosition = new THREE.Vector3();
    const targetQuat = new THREE.Quaternion();
    const euler = new THREE.Euler(0, 0, 0, "YXZ");
    const cameraTarget = new THREE.Vector3();
    let nearestPerch: Perch | null = null;

    const onKeyDown = (event: KeyboardEvent) => {
      keys.add(event.code);
      if (["Space", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(event.code)) event.preventDefault();
      if (event.code === "KeyC" && !event.repeat) {
        const next: CameraMode = cameraModeRef.current === "CHASE" ? "BIRD'S EYE" : "CHASE";
        cameraModeRef.current = next;
        setCameraMode(next);
      }
      if ((event.code === "KeyP" || event.code === "Escape") && !event.repeat && flyingRef.current) {
        event.preventDefault();
        const nextPaused = !pausedRef.current;
        pausedRef.current = nextPaused;
        setPaused(nextPaused);
        if (nextPaused) flightAudio.pause();
        else flightAudio.resume();
      }
      if (event.code === "Space" && !event.repeat && flyingRef.current && !pausedRef.current) {
        flapKick = 1;
        flightAudio.flap();
      }
      if (event.code === "KeyE" && !event.repeat && flyingRef.current && !pausedRef.current) {
        if (restingRef.current) {
          restingRef.current = false;
          setResting(false);
          crow.position.y += 5;
          speed = 34;
          pitch = 0.16;
          flapKick = 1;
          flightAudio.flap();
        } else if (nearestPerch) {
          restingRef.current = true;
          setResting(true);
          crow.position.copy(nearestPerch.position).add(new THREE.Vector3(0, 1.6, 0));
          yaw = nearestPerch.heading;
          yawRate = 0;
          pitch = 0;
          roll = 0;
          speed = 0;
        }
      }
    };
    const onKeyUp = (event: KeyboardEvent) => keys.delete(event.code);
    window.addEventListener("keydown", onKeyDown, { passive: false });
    window.addEventListener("keyup", onKeyUp);

    const onResize = () => {
      camera.aspect = mount.clientWidth / mount.clientHeight;
      camera.updateProjectionMatrix();
      renderer.setSize(mount.clientWidth, mount.clientHeight);
    };
    window.addEventListener("resize", onResize);

    camera.position.set(190, 105, 446);
    cameraTarget.copy(crow.position);
    let animation = 0;
    const animate = () => {
      animation = requestAnimationFrame(animate);
      const now = performance.now();
      const dt = Math.min((now - lastFrame) / 1000, 0.035);
      lastFrame = now;
      elapsedTime += dt;
      const active = flyingRef.current && !pausedRef.current && !restingRef.current;
      const turn = active ? (keys.has("KeyA") || keys.has("ArrowLeft") ? 1 : 0) - (keys.has("KeyD") || keys.has("ArrowRight") ? 1 : 0) : 0;
      const climb = active ? (keys.has("KeyW") || keys.has("ArrowUp") ? 1 : 0) - (keys.has("KeyS") || keys.has("ArrowDown") ? 1 : 0) : 0;
      const boost = active && (keys.has("ShiftLeft") || keys.has("ShiftRight"));

      const targetYawRate = turn * (0.58 + speed / 180);
      yawRate = THREE.MathUtils.lerp(yawRate, targetYawRate, 1 - Math.pow(0.82, dt * 60));
      yaw += yawRate * dt;
      flapKick = Math.max(0, flapKick - dt * 1.8);
      const targetPitch = clamp(climb * 0.25 + flapKick * 0.12, -0.27, 0.3);
      pitch = THREE.MathUtils.lerp(pitch, targetPitch, 1 - Math.pow(0.88, dt * 60));
      const targetRoll = turn * 0.48;
      roll = THREE.MathUtils.lerp(roll, targetRoll, 1 - Math.pow(0.8, dt * 60));
      const targetSpeed = boost ? 70 : 44 + Math.max(0, -pitch) * 30 - Math.max(0, pitch) * 10;
      speed = THREE.MathUtils.lerp(speed, targetSpeed, 1 - Math.pow(0.96, dt * 60));

      forward.set(-Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), -Math.cos(yaw) * Math.cos(pitch));
      previousPosition.copy(crow.position);
      if (active) crow.position.addScaledVector(forward, speed * dt);
      let collided = false;
      if (!restingRef.current) {
        for (const building of buildingColliders) {
          if (
            Math.abs(crow.position.x - building.x) < building.halfWidth &&
            Math.abs(crow.position.z - building.z) < building.halfDepth &&
            crow.position.y < building.top + 5.5
          ) {
            collided = true;
            break;
          }
        }
      }
      if (collided) {
        crow.position.copy(previousPosition);
        pitch = Math.max(pitch, 0.15);
        speed = Math.max(28, speed * 0.82);
      }
      crow.position.y = clamp(crow.position.y, 10, 390);
      if (crow.position.y <= 10.2) pitch = Math.max(pitch, 0.16);
      if (Math.abs(crow.position.x) > 1080 || Math.abs(crow.position.z) > 1080) {
        const homeYaw = Math.atan2(crow.position.x, crow.position.z);
        const angleDifference = Math.atan2(Math.sin(homeYaw - yaw), Math.cos(homeYaw - yaw));
        yaw += angleDifference * dt * 0.75;
      }

      euler.set(-pitch, yaw, roll);
      targetQuat.setFromEuler(euler);
      crow.quaternion.slerp(targetQuat, 1 - Math.pow(0.83, dt * 60));
      if (!pausedRef.current && mixer && flapAction && glideAction && restAction) {
        const desiredRestWeight = restingRef.current ? 0.96 : 0;
        const restWeight = THREE.MathUtils.lerp(restAction.getEffectiveWeight(), desiredRestWeight, 1 - Math.pow(0.78, dt * 60));
        restAction.setEffectiveWeight(restWeight);
        restAction.timeScale = 0.55;
        const desiredFlapWeight = active ? (flapKick > 0 ? 0.96 : 0.16) : 0;
        const flapWeight = THREE.MathUtils.lerp(flapAction.getEffectiveWeight(), desiredFlapWeight, 1 - Math.pow(0.8, dt * 60));
        flapAction.setEffectiveWeight(flapWeight);
        flapAction.timeScale = flapKick > 0 ? 2.15 : 0.7;
        glideAction.setEffectiveWeight(Math.max(0, 1 - flapWeight - restWeight));
        glideAction.timeScale = 0.72;
        mixer.update(dt);
      }

      nearestPerch = null;
      let nearestDistance = Number.POSITIVE_INFINITY;
      if (!restingRef.current && !pausedRef.current) {
        for (const perch of scene.userData.perches as Perch[]) {
          const distance = crow.position.distanceTo(perch.position);
          if (distance < 27 && distance < nearestDistance) {
            nearestPerch = perch;
            nearestDistance = distance;
          }
        }
      }
      if (perchPromptRef.current && perchLabelRef.current) {
        if (restingRef.current) {
          perchPromptRef.current.dataset.visible = "true";
          perchLabelRef.current.textContent = "TAKE OFF";
        } else if (nearestPerch) {
          perchPromptRef.current.dataset.visible = "true";
          perchLabelRef.current.textContent = `LAND · ${nearestPerch.label.toUpperCase()}`;
        } else {
          perchPromptRef.current.dataset.visible = "false";
        }
      }

      if (!pausedRef.current) {
        for (const car of scene.userData.traffic as THREE.Group[]) {
          car.position.x += car.userData.direction * car.userData.speed * dt;
          if (car.position.x > 1100) car.position.x = -1100;
          if (car.position.x < -1100) car.position.x = 1100;
        }
        for (const cloud of scene.userData.clouds as THREE.Group[]) {
          cloud.position.x += cloud.userData.speed * dt;
          if (cloud.position.x > 1250) cloud.position.x = -1250;
        }
        const markerTime = elapsedTime;
        for (const ribbon of scene.userData.waterRibbons as WaterRibbon[]) {
          const wave = Math.sin(markerTime * 0.42 + ribbon.userData.phase);
          ribbon.material.opacity = 0.105 + (wave + 1) * 0.055;
          ribbon.scale.y = 0.72 + (wave + 1) * 0.18;
        }
        for (const marker of scene.userData.perchMarkers as THREE.Group[]) {
          const pulse = Math.sin(markerTime * 1.8 + marker.userData.phase);
          const settled = restingRef.current;
          marker.position.y = marker.userData.baseY + (settled ? 0 : pulse * 0.28);
          const markerScale = settled ? 0.86 : 1 + pulse * 0.08;
          marker.scale.setScalar(markerScale);
          marker.rotation.y += dt * 0.18;
          for (const child of marker.children) {
            if (child instanceof THREE.Mesh && child.material instanceof THREE.MeshBasicMaterial) {
              child.material.opacity = child.geometry.type === "CylinderGeometry"
                ? (settled ? 0.06 : 0.13 + (pulse + 1) * 0.035)
                : (settled ? 0.24 : 0.52 + (pulse + 1) * 0.08);
            }
          }
        }
      }

      if (cameraModeRef.current === "CHASE") {
        desiredCamera.copy(crow.position).addScaledVector(forward, -18).add(new THREE.Vector3(0, 7.5, 0));
        desiredTarget.copy(crow.position).addScaledVector(forward, 14).add(new THREE.Vector3(0, 1.5, 0));
      } else {
        desiredCamera.copy(crow.position).addScaledVector(forward, 3.1).add(new THREE.Vector3(0, 1.2, 0));
        desiredTarget.copy(crow.position).addScaledVector(forward, 42).add(new THREE.Vector3(0, 1, 0));
      }
      camera.position.lerp(desiredCamera, 1 - Math.pow(0.78, dt * 60));
      cameraTarget.lerp(desiredTarget, 1 - Math.pow(0.76, dt * 60));
      camera.lookAt(cameraTarget);

      if (speedRef.current) speedRef.current.textContent = Math.round(speed).toString();
      if (altitudeRef.current) altitudeRef.current.textContent = Math.round(crow.position.y).toString();
      flightAudio.setFlight(speed, crow.position.y);
      if (compassRef.current) {
        const headings = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];
        const headingIndex = Math.round((((yaw % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2)) / (Math.PI / 4)) % 8;
        compassRef.current.textContent = headings[headingIndex];
      }
      if (mapBirdRef.current) {
        mapBirdRef.current.style.left = `${50 + clamp(crow.position.x / 24, -39, 39)}%`;
        mapBirdRef.current.style.top = `${50 + clamp(crow.position.z / 24, -39, 39)}%`;
        mapBirdRef.current.style.transform = `translate(-50%, -50%) rotate(${yaw}rad)`;
      }

      renderer.render(scene, camera);
      diagnosticFrame++;
      if (diagnosticFrame % 30 === 0) {
        renderer.domElement.dataset.calls = renderer.info.render.calls.toString();
        renderer.domElement.dataset.triangles = renderer.info.render.triangles.toString();
        renderer.domElement.dataset.geometries = renderer.info.memory.geometries.toString();
        renderer.domElement.dataset.textures = renderer.info.memory.textures.toString();
      }
    };
    animate();

    return () => {
      disposed = true;
      delete (window as BirdFlightWindow).__birdFlightDiagnostics;
      flightAudio.dispose();
      audioRef.current = null;
      cancelAnimationFrame(animation);
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("resize", onResize);
      renderer.dispose();
      scene.traverse((object) => {
        if (object instanceof THREE.Mesh) {
          object.geometry.dispose();
          const materials = Array.isArray(object.material) ? object.material : [object.material];
          materials.forEach((material) => material.dispose());
        }
      });
      mount.removeChild(renderer.domElement);
    };
  }, []);

  const beginFlight = async () => {
    flyingRef.current = true;
    pausedRef.current = false;
    restingRef.current = false;
    setFlying(true);
    setPaused(false);
    setResting(false);
    setSoundOn(await audioRef.current?.start() ?? false);
  };

  const toggleSound = async () => {
    const enabled = await audioRef.current?.toggle() ?? false;
    if (pausedRef.current && enabled) audioRef.current?.pause();
    setSoundOn(enabled);
  };

  const togglePause = () => {
    if (!flyingRef.current) return;
    const nextPaused = !pausedRef.current;
    pausedRef.current = nextPaused;
    setPaused(nextPaused);
    if (nextPaused) audioRef.current?.pause();
    else audioRef.current?.resume();
  };

  return (
    <main className="flight-shell">
      <div ref={mountRef} className="world" aria-label="Interactive stylized flight over Hatirjheel, Dhaka" />
      <div className="atmosphere" />

      <header className="topbar">
        <div className="brand">
          <span className="brand-mark">BEV</span>
          <div><strong>BIRD&apos;S EYE VIEW</strong><small>DHAKA · EARLY FLIGHT</small></div>
        </div>
        <div className="location"><span className="pulse" /> HATIRJHEEL, DHAKA <b>23.7498° N</b></div>
        <div className="top-actions">
          <button className={`icon-button sound-button${soundOn ? " active" : ""}`} onClick={toggleSound} aria-label={soundOn ? "Mute ambient sound" : "Enable ambient sound"}>♫</button>
          {flying && <button className={`icon-button pause-button${paused ? " active" : ""}`} onClick={togglePause} aria-label={paused ? "Resume flight" : "Pause flight"}>{paused ? "▶" : "Ⅱ"}</button>}
          <button className="icon-button" onClick={() => setControlsOpen((value) => !value)} aria-label="Show flight controls">?</button>
        </div>
      </header>

      {flying && (
        <>
          <aside className="mission-card">
            <span className="eyebrow">FIRST FLIGHT</span>
            <h2>Follow the water</h2>
            <p>Fly east across Hatirjheel and pass beneath a bridge.</p>
            <div className="mission-progress"><i /></div>
            <small>EXPLORE MODE · NO TIME LIMIT</small>
          </aside>

          <section className="telemetry" aria-label="Flight telemetry">
            <div><span ref={speedRef}>48</span><small>KM/H</small></div>
            <i />
            <div><span ref={altitudeRef}>92</span><small>METRES</small></div>
            <i />
            <div><span ref={compassRef}>N</span><small>HEADING</small></div>
          </section>

          <div className="minimap" aria-label="Mini map of Hatirjheel">
            <span className="north">N</span>
            <div className="map-water one" /><div className="map-water two" />
            <div className="map-road" />
            <div ref={mapBirdRef} className="map-bird">▲</div>
            <small>HATIRJHEEL</small>
          </div>

          <div className="camera-chip"><span>CAMERA</span>{cameraMode}<kbd>C</kbd></div>
          <div className="perch-legend"><i /> REST PERCH</div>
          <div className="flight-hint"><kbd>W / S</kbd><span>CLIMB / DIVE</span><kbd>SHIFT</kbd><span>BOOST</span></div>
          <div ref={perchPromptRef} className="perch-prompt" data-visible="false"><kbd>E</kbd><span ref={perchLabelRef}>LAND</span></div>
          {resting && <div className="resting-chip"><i /> RESTING · WATCHING DHAKA</div>}
        </>
      )}

      {!flying && (
        <section className="welcome-panel">
          <span className="eyebrow">A CITY FROM ANOTHER POINT OF VIEW</span>
          <h1>The sky<br />belongs to you.</h1>
          <p>Take wing as a Dhaka crow. Ride the warm air above Hatirjheel, skim the water, and find your own path through the city.</p>
          <button onClick={beginFlight} className="primary-button"><span>BEGIN FLIGHT</span><b>→</b></button>
          <div className="quick-controls"><span><kbd>WASD</kbd> STEER</span><span><kbd>SPACE</kbd> FLAP</span><span><kbd>C</kbd> CAMERA</span></div>
        </section>
      )}

      {controlsOpen && (
        <section className="controls-panel">
          <button onClick={() => setControlsOpen(false)} aria-label="Close controls">×</button>
          <span className="eyebrow">FLIGHT MANUAL</span>
          <h2>Move like a crow</h2>
          <dl>
            <div><dt>W / S</dt><dd>Climb / dive</dd></div>
            <div><dt>A / D</dt><dd>Bank left / right</dd></div>
            <div><dt>Space</dt><dd>Flap for lift</dd></div>
            <div><dt>Shift</dt><dd>Controlled speed boost</dd></div>
            <div><dt>C</dt><dd>Switch camera</dd></div>
            <div><dt>P / Esc</dt><dd>Pause / resume flight</dd></div>
            <div><dt>E</dt><dd>Land / take off at a perch</dd></div>
          </dl>
        </section>
      )}

      {flying && paused && (
        <section className="pause-overlay" role="dialog" aria-label="Flight paused">
          <span className="eyebrow">FLIGHT SUSPENDED</span>
          <h2>Take a breath.</h2>
          <p>Your place in the sky is waiting.</p>
          <button className="primary-button resume-button" onClick={togglePause}><span>RESUME FLIGHT</span><b>▶</b></button>
          <small>PRESS P TO CONTINUE</small>
        </section>
      )}

      <div className="desktop-note">DESKTOP FLIGHT PROTOTYPE · KEYBOARD REQUIRED</div>
    </main>
  );
}
