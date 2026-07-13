"use client";

import { useEffect, useRef, useState } from "react";
import * as THREE from "three";

type CameraMode = "CHASE" | "BIRD'S EYE";

const clamp = THREE.MathUtils.clamp;

function seededRandom(seed = 713) {
  let value = seed;
  return () => {
    value = (value * 16807) % 2147483647;
    return (value - 1) / 2147483646;
  };
}

function makeCrow() {
  const crow = new THREE.Group();
  const black = new THREE.MeshStandardMaterial({ color: 0x12181b, roughness: 0.72 });
  const feather = new THREE.MeshStandardMaterial({ color: 0x20282b, roughness: 0.62 });
  const beak = new THREE.MeshStandardMaterial({ color: 0x2d3638, roughness: 0.8 });

  const body = new THREE.Mesh(new THREE.SphereGeometry(1, 10, 8), black);
  body.scale.set(1.25, 0.82, 2.15);
  body.castShadow = true;
  crow.add(body);

  const chest = new THREE.Mesh(new THREE.SphereGeometry(0.8, 9, 7), feather);
  chest.position.set(0, 0.2, -1.2);
  chest.scale.set(0.9, 0.9, 1.05);
  chest.castShadow = true;
  crow.add(chest);

  const head = new THREE.Mesh(new THREE.SphereGeometry(0.73, 10, 8), black);
  head.position.set(0, 0.68, -2.05);
  head.castShadow = true;
  crow.add(head);

  const bill = new THREE.Mesh(new THREE.ConeGeometry(0.38, 1.35, 5), beak);
  bill.rotation.x = -Math.PI / 2;
  bill.position.set(0, 0.55, -3.02);
  crow.add(bill);

  const eyeMaterial = new THREE.MeshBasicMaterial({ color: 0xd8d4b9 });
  for (const side of [-1, 1]) {
    const eye = new THREE.Mesh(new THREE.SphereGeometry(0.07, 6, 4), eyeMaterial);
    eye.position.set(side * 0.63, 0.88, -2.31);
    crow.add(eye);
  }

  const makeWing = (side: number) => {
    const pivot = new THREE.Group();
    pivot.position.set(side * 0.7, 0.18, -0.25);
    const geometry = new THREE.BufferGeometry();
    const s = side;
    geometry.setAttribute(
      "position",
      new THREE.Float32BufferAttribute([
        0, 0, -1.2,
        s * 6.8, 0.05, 0.6,
        s * 4.8, 0.02, 2.2,
        0, 0, 1.1,
      ], 3),
    );
    geometry.setIndex([0, 1, 2, 0, 2, 3]);
    geometry.computeVertexNormals();
    const wing = new THREE.Mesh(geometry, feather);
    wing.castShadow = true;
    pivot.add(wing);
    crow.add(pivot);
    return pivot;
  };

  const leftWing = makeWing(-1);
  const rightWing = makeWing(1);

  for (const offset of [-0.52, 0, 0.52]) {
    const tail = new THREE.Mesh(new THREE.ConeGeometry(0.48, 2.9, 3), feather);
    tail.rotation.x = Math.PI / 2;
    tail.position.set(offset, 0, 2.75);
    tail.scale.x = 0.9;
    crow.add(tail);
  }

  crow.scale.setScalar(0.78);
  crow.userData.leftWing = leftWing;
  crow.userData.rightWing = rightWing;
  return crow;
}

function addCity(scene: THREE.Scene) {
  const random = seededRandom();
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(2400, 2400),
    new THREE.MeshStandardMaterial({ color: 0x75856e, roughness: 1 }),
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
    new THREE.MeshStandardMaterial({ color: 0x3f7f87, roughness: 0.28, metalness: 0.12 }),
  );
  water.rotation.x = -Math.PI / 2;
  water.position.y = 0.45;
  water.receiveShadow = true;
  water.name = "Hatirjheel Lake";
  scene.add(water);

  const roadMaterial = new THREE.MeshStandardMaterial({ color: 0x545957, roughness: 0.95 });
  const lineMaterial = new THREE.MeshBasicMaterial({ color: 0xc7b96d });
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
  }

  for (const x of [-590, -70, 510]) {
    const bridge = new THREE.Mesh(new THREE.BoxGeometry(42, 5, 440), roadMaterial);
    bridge.position.set(x, 6, Math.sin(x * 0.0042) * 90);
    bridge.castShadow = true;
    bridge.receiveShadow = true;
    scene.add(bridge);
    for (const side of [-1, 1]) {
      const rail = new THREE.Mesh(new THREE.BoxGeometry(3, 5, 440), lineMaterial);
      rail.position.set(x + side * 19, 10, bridge.position.z);
      scene.add(rail);
    }
  }

  const buildingColors = [0xd6c49f, 0xb8c0b7, 0xc99072, 0x9cad9d, 0xd0d0c1, 0xa77f68];
  const windowMaterial = new THREE.MeshBasicMaterial({ color: 0xc8d7c4, transparent: true, opacity: 0.48 });
  for (let gx = -1050; gx <= 1050; gx += 92) {
    for (let gz = -980; gz <= 980; gz += 92) {
      const lakeCenter = Math.sin(gx * 0.0042) * 90 + Math.sin(gx * 0.009) * 24;
      if (Math.abs(gz - lakeCenter) < 205 || Math.abs(Math.abs(gz) - 285) < 46 || random() < 0.12) continue;
      const width = 42 + random() * 35;
      const depth = 40 + random() * 34;
      const central = 1 - clamp(Math.hypot(gx * 0.55, gz * 0.55) / 950, 0, 1);
      const height = 18 + random() * 52 + central * random() * 82;
      const building = new THREE.Mesh(
        new THREE.BoxGeometry(width, height, depth),
        new THREE.MeshStandardMaterial({ color: buildingColors[Math.floor(random() * buildingColors.length)], roughness: 0.88 }),
      );
      building.position.set(gx + (random() - 0.5) * 20, height / 2, gz + (random() - 0.5) * 20);
      building.rotation.y = (random() - 0.5) * 0.12;
      building.castShadow = true;
      building.receiveShadow = true;
      scene.add(building);

      if (height > 48) {
        const windows = new THREE.Mesh(new THREE.PlaneGeometry(width * 0.72, height * 0.72), windowMaterial);
        windows.position.set(building.position.x, height * 0.54, building.position.z - depth / 2 - 0.08);
        scene.add(windows);
      }
    }
  }

  const treeTrunk = new THREE.CylinderGeometry(1.2, 1.6, 6, 5);
  const treeTop = new THREE.ConeGeometry(5.4, 13, 7);
  const trunkMaterial = new THREE.MeshStandardMaterial({ color: 0x665244 });
  const leafMaterials = [0x3f654a, 0x527653, 0x6e8652].map((color) => new THREE.MeshStandardMaterial({ color }));
  for (let i = 0; i < 170; i++) {
    const x = (random() - 0.5) * 2200;
    const z = (random() - 0.5) * 2100;
    const lakeCenter = Math.sin(x * 0.0042) * 90;
    if (Math.abs(z - lakeCenter) < 125) continue;
    const trunk = new THREE.Mesh(treeTrunk, trunkMaterial);
    trunk.position.set(x, 3, z);
    const crown = new THREE.Mesh(treeTop, leafMaterials[i % leafMaterials.length]);
    crown.position.set(x, 12, z);
    crown.castShadow = true;
    scene.add(trunk, crown);
  }

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
}

export function BirdFlight() {
  const mountRef = useRef<HTMLDivElement>(null);
  const speedRef = useRef<HTMLSpanElement>(null);
  const altitudeRef = useRef<HTMLSpanElement>(null);
  const compassRef = useRef<HTMLSpanElement>(null);
  const mapBirdRef = useRef<HTMLDivElement>(null);
  const flyingRef = useRef(false);
  const cameraModeRef = useRef<CameraMode>("CHASE");
  const [flying, setFlying] = useState(false);
  const [cameraMode, setCameraMode] = useState<CameraMode>("CHASE");
  const [controlsOpen, setControlsOpen] = useState(false);

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x9fc6c9);
    scene.fog = new THREE.FogExp2(0xa8c5c4, 0.00072);
    const camera = new THREE.PerspectiveCamera(58, mount.clientWidth / mount.clientHeight, 0.5, 4000);
    const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: "high-performance" });
    renderer.setSize(mount.clientWidth, mount.clientHeight);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.75));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.05;
    mount.appendChild(renderer.domElement);

    scene.add(new THREE.HemisphereLight(0xe3f1e7, 0x68705c, 2.35));
    const sun = new THREE.DirectionalLight(0xffdfad, 3.2);
    sun.position.set(-400, 650, 280);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    sun.shadow.camera.left = -700;
    sun.shadow.camera.right = 700;
    sun.shadow.camera.top = 700;
    sun.shadow.camera.bottom = -700;
    sun.shadow.camera.far = 1700;
    scene.add(sun);

    const sunDisc = new THREE.Mesh(new THREE.SphereGeometry(34, 16, 12), new THREE.MeshBasicMaterial({ color: 0xffd394 }));
    sunDisc.position.set(-700, 570, -1300);
    scene.add(sunDisc);
    addCity(scene);

    const crow = makeCrow();
    crow.position.set(180, 92, 420);
    scene.add(crow);

    const keys = new Set<string>();
    let yaw = 0.15;
    let pitch = -0.03;
    let speed = 48;
    let wingPhase = 0;
    let flapKick = 0;
    const clock = new THREE.Clock();
    const desiredCamera = new THREE.Vector3();
    const desiredTarget = new THREE.Vector3();
    const forward = new THREE.Vector3();
    const targetQuat = new THREE.Quaternion();
    const euler = new THREE.Euler(0, 0, 0, "YXZ");
    const cameraTarget = new THREE.Vector3();

    const onKeyDown = (event: KeyboardEvent) => {
      keys.add(event.code);
      if (["Space", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(event.code)) event.preventDefault();
      if (event.code === "KeyC" && !event.repeat) {
        const next: CameraMode = cameraModeRef.current === "CHASE" ? "BIRD'S EYE" : "CHASE";
        cameraModeRef.current = next;
        setCameraMode(next);
      }
      if (event.code === "Space" && !event.repeat && flyingRef.current) flapKick = 1;
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
      const dt = Math.min(clock.getDelta(), 0.035);
      const active = flyingRef.current;
      const turn = active ? (keys.has("KeyA") || keys.has("ArrowLeft") ? 1 : 0) - (keys.has("KeyD") || keys.has("ArrowRight") ? 1 : 0) : 0;
      const pitchInput = active ? (keys.has("KeyS") || keys.has("ArrowDown") ? 1 : 0) - (keys.has("KeyW") || keys.has("ArrowUp") ? 1 : 0) : 0;
      const boost = active && (keys.has("ShiftLeft") || keys.has("ShiftRight"));

      yaw += turn * dt * (0.92 + speed / 110);
      pitch += pitchInput * dt * 0.72;
      pitch *= Math.pow(0.92, dt * 60);
      flapKick = Math.max(0, flapKick - dt * 1.8);
      if (flapKick > 0) pitch += dt * 0.34;
      pitch = clamp(pitch, -0.48, 0.38);
      const targetSpeed = boost ? 88 : 51 + Math.max(0, -pitch) * 28;
      speed = THREE.MathUtils.lerp(speed, targetSpeed, 1 - Math.pow(0.94, dt * 60));

      forward.set(Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), -Math.cos(yaw) * Math.cos(pitch));
      if (active) crow.position.addScaledVector(forward, speed * dt);
      crow.position.y = clamp(crow.position.y, 10, 390);
      if (crow.position.y <= 10.2) pitch = Math.max(pitch, 0.12);
      if (Math.abs(crow.position.x) > 1120 || Math.abs(crow.position.z) > 1120) {
        const homeYaw = Math.atan2(-crow.position.x, crow.position.z);
        yaw = THREE.MathUtils.lerp(yaw, homeYaw, dt * 0.35);
      }

      euler.set(-pitch, yaw, -turn * 0.5);
      targetQuat.setFromEuler(euler);
      crow.quaternion.slerp(targetQuat, 1 - Math.pow(0.83, dt * 60));
      wingPhase += dt * (active ? (flapKick > 0 ? 18 : 5.2) : 2.2);
      const flap = active ? Math.sin(wingPhase) * (flapKick > 0 ? 0.78 : 0.15) : Math.sin(wingPhase) * 0.12;
      crow.userData.leftWing.rotation.z = flap;
      crow.userData.rightWing.rotation.z = -flap;

      if (cameraModeRef.current === "CHASE") {
        desiredCamera.copy(crow.position).addScaledVector(forward, -18).add(new THREE.Vector3(0, 7.5, 0));
        desiredTarget.copy(crow.position).addScaledVector(forward, 14).add(new THREE.Vector3(0, 1.5, 0));
      } else {
        desiredCamera.copy(crow.position).addScaledVector(forward, 3.1).add(new THREE.Vector3(0, 1.2, 0));
        desiredTarget.copy(crow.position).addScaledVector(forward, 42).add(new THREE.Vector3(0, 1, 0));
      }
      camera.position.lerp(desiredCamera, 1 - Math.pow(0.88, dt * 60));
      cameraTarget.lerp(desiredTarget, 1 - Math.pow(0.84, dt * 60));
      camera.lookAt(cameraTarget);

      if (speedRef.current) speedRef.current.textContent = Math.round(speed).toString();
      if (altitudeRef.current) altitudeRef.current.textContent = Math.round(crow.position.y).toString();
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
    };
    animate();

    return () => {
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

  const beginFlight = () => {
    flyingRef.current = true;
    setFlying(true);
  };

  return (
    <main className="flight-shell">
      <div ref={mountRef} className="world" aria-label="Interactive low-poly flight over Hatirjheel, Dhaka" />
      <div className="atmosphere" />

      <header className="topbar">
        <div className="brand">
          <span className="brand-mark">BEV</span>
          <div><strong>BIRD'S EYE VIEW</strong><small>DHAKA · EARLY FLIGHT</small></div>
        </div>
        <div className="location"><span className="pulse" /> HATIRJHEEL, DHAKA <b>23.7498° N</b></div>
        <button className="icon-button" onClick={() => setControlsOpen((value) => !value)} aria-label="Show flight controls">?</button>
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
          <div className="flight-hint"><kbd>SPACE</kbd><span>FLAP</span><kbd>SHIFT</kbd><span>DIVE</span></div>
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
            <div><dt>W / S</dt><dd>Dive / climb</dd></div>
            <div><dt>A / D</dt><dd>Bank left / right</dd></div>
            <div><dt>Space</dt><dd>Flap for lift</dd></div>
            <div><dt>Shift</dt><dd>Accelerate into a dive</dd></div>
            <div><dt>C</dt><dd>Switch camera</dd></div>
          </dl>
        </section>
      )}

      <div className="desktop-note">DESKTOP FLIGHT PROTOTYPE · KEYBOARD REQUIRED</div>
    </main>
  );
}
