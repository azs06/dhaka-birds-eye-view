"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js";
import { Sky } from "three/examples/jsm/objects/Sky.js";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";

type CameraMode = "CHASE" | "BIRD'S EYE";
type BuildingCollider = { x: number; z: number; halfWidth: number; halfDepth: number; top: number };
type Perch = { position: THREE.Vector3; label: string; heading: number };
type AreaLandmark = {
  label: string;
  shortLabel: string;
  lat: number;
  lon: number;
  altitude: number;
  heading: number;
  minimap?: boolean;
};
type WaterLandmark = {
  label: string;
  shortLabel: string;
  lat: number;
  lon: number;
  minimap?: boolean;
};
type DhakaLandmark = AreaLandmark & {
  kind:
    | "church"
    | "bashundhara-city"
    | "amphitheatre"
    | "police-plaza"
    | "brac"
    | "hotel"
    | "parliament"
    | "lalbagh-fort"
    | "ahsan-manzil"
    | "shaheed-minar"
    | "curzon-hall"
    | "baitul-mukarram";
};
type ProceduralDistrictTile = { group: THREE.Group; centerX: number; centerZ: number; colliders: BuildingCollider[] };
type WaterRibbon = THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>;
type MapStatus = "loading" | "live" | "fallback";
type WeatherStatus = "loading" | "live" | "fallback";
type WeatherMode = "clear" | "cloudy" | "fog" | "drizzle" | "rain" | "storm";
type WeatherSnapshot = {
  source: "Open-Meteo";
  fetchedAt: string;
  observedAt: string;
  mode: WeatherMode;
  label: string;
  weatherCode: number;
  isDay: boolean;
  temperature: number;
  apparentTemperature: number;
  precipitation: number;
  cloudCover: number;
  windSpeed: number;
  windDirection: number;
  windGusts: number;
};
type MapPoint = [number, number];
type OsmMapData = {
  source: "OpenStreetMap";
  fetchedAt: string;
  buildings: Array<{ id: number; points: MapPoint[]; height: number; name: string | null }>;
  roads: Array<{ id: number; points: MapPoint[]; kind: string; name: string | null }>;
  water: Array<{ id: number; points: MapPoint[]; area: boolean }>;
};
type BirdFlightWindow = Window & {
  __birdFlightDiagnostics?: () => {
    calls: number;
    triangles: number;
    geometries: number;
    textures: number;
    objects: number;
    proceduralTiles: number;
    visibleTiles: number;
    maxFrameMs: number;
    longFrames: number;
    mapBuildMs: number | null;
    trafficVehicles: number;
    trafficTickHz: number;
  };
};
type FlightAudio = {
  start: () => Promise<boolean>;
  toggle: () => Promise<boolean>;
  pause: () => void;
  resume: () => void;
  flap: () => void;
  setFlight: (speed: number, altitude: number) => void;
  setRadioDucking: (active: boolean) => void;
  dispose: () => void;
};
type RadioStatus = "off" | "buffering" | "playing" | "paused" | "error";
type RadioStation = {
  id: string;
  name: string;
  frequency: string;
  tagline: string;
  homepage?: string;
  stream?: string;
};
type FlightRadio = {
  tune: (station: RadioStation) => Promise<void>;
  stop: () => void;
  pause: () => void;
  resume: () => Promise<void>;
  setVolume: (volume: number) => void;
  dispose: () => void;
};
type AirflowVfx = {
  update: (dt: number, speedAmount: number, verticalSpeed: number, boosting: boolean, reducedMotion: boolean) => void;
  dispose: () => void;
};
type WeatherVfx = {
  apply: (weather: WeatherSnapshot) => void;
  update: (dt: number, anchor: THREE.Vector3, paused: boolean) => void;
  dispose: () => void;
};
type TrafficSimulation = {
  update: (dt: number, frameMs: number) => void;
  dispose: () => void;
  readonly vehicleCount: number;
  readonly tickHz: number;
};
type TrafficVehicle = {
  route: MapPoint[];
  segmentIndex: number;
  segmentProgress: number;
  direction: 1 | -1;
  laneOffset: number;
  speed: number;
  baseSpeed: number;
  phase: number;
  position: THREE.Vector3;
  previousPosition: THREE.Vector3;
  heading: number;
  previousHeading: number;
};

const clamp = THREE.MathUtils.clamp;
const MAP_CENTER = { lat: 23.7715, lon: 90.4165 };
const FLIGHT_EXTENT = { x: 11_200, z: 11_500 };
const COLLISION_CELL_SIZE = 180;
const BRAKE_SPEED = 18;
const CRUISE_SPEED = 44;
const BOOST_SPEED = 78;
const DEFAULT_FLIGHT_ALTITUDE = 130;
const MIN_FLIGHT_ALTITUDE = 10;
const MAX_FLIGHT_ALTITUDE = 650;
const CEILING_EASE_DEPTH = 90;
const MIN_CEILING_CLIMB_SPEED = 1.8;
const TRAFFIC_ROUTE_SAMPLE_RATIO = 0.35;
const TRAFFIC_ROUTE_BUDGET = 72;
const TRAFFIC_MAX_VEHICLES = 84;
const TRAFFIC_BASE_TICK_HZ = 10;
const TRAFFIC_THROTTLED_TICK_HZ = 5;
const TRAFFIC_LONG_FRAME_MS = 34;
const TRAFFIC_MAX_CATCH_UP_STEPS = 2;
const FLIGHT_AMBIENCE_GAIN = 0.28;
const RADIO_DUCKED_AMBIENCE_GAIN = 0.24;
const DEFAULT_WEATHER: WeatherSnapshot = {
  source: "Open-Meteo",
  fetchedAt: "",
  observedAt: "",
  mode: "cloudy",
  label: "Weather loading",
  weatherCode: 2,
  isDay: true,
  temperature: 29,
  apparentTemperature: 31,
  precipitation: 0,
  cloudCover: 45,
  windSpeed: 7,
  windDirection: 180,
  windGusts: 11,
};
const RADIO_STATIONS: RadioStation[] = [
  {
    id: "monsoon",
    name: "Monsoon Drift",
    frequency: "BEV 00.1",
    tagline: "Slow rain · warm air · no interruptions",
  },
  {
    id: "foorti",
    name: "Radio Foorti",
    frequency: "88.0 FM",
    tagline: "Live from Bangladesh",
    homepage: "https://radiofoorti.fm/",
    stream: "/api/radio?station=foorti",
  },
  {
    id: "dhaka-fm",
    name: "Dhaka FM",
    frequency: "90.4 FM",
    tagline: "Live from Gulshan, Dhaka",
    homepage: "https://www.dhakafm904.com/",
    stream: "https://play.dhakafm904.com/;",
  },
  {
    id: "jago",
    name: "Jago FM",
    frequency: "94.4 FM",
    tagline: "Live from Dhaka",
    homepage: "https://www.jago.fm/",
    stream: "/api/radio?station=jago",
  },
];
const AREA_LANDMARKS: AreaLandmark[] = [
  { label: "Moghbazar", shortLabel: "MOG", lat: 23.75096, lon: 90.40489, altitude: 44, heading: Math.PI },
  { label: "Tejgaon I/A", shortLabel: "TEJ", lat: 23.76535, lon: 90.40062, altitude: 58, heading: Math.PI / 2 },
  { label: "Niketan", shortLabel: "NIK", lat: 23.77485, lon: 90.41017, altitude: 62, heading: 0, minimap: true },
  { label: "Gulshan 1", shortLabel: "GUL", lat: 23.77512, lon: 90.41607, altitude: 78, heading: -Math.PI / 2 },
  { label: "Badda Link Road", shortLabel: "BAD", lat: 23.77157, lon: 90.42045, altitude: 46, heading: -Math.PI / 2 },
  { label: "Rampura Bridge", shortLabel: "RAM", lat: 23.76863, lon: 90.42245, altitude: 36, heading: Math.PI },
  { label: "Karwan Bazar", shortLabel: "KAR", lat: 23.75144, lon: 90.39706, altitude: 56, heading: Math.PI / 2 },
  { label: "Banglamotor", shortLabel: "BNG", lat: 23.74588, lon: 90.39477, altitude: 52, heading: Math.PI / 2, minimap: true },
  { label: "Malibagh", shortLabel: "MAL", lat: 23.74991, lon: 90.41326, altitude: 48, heading: Math.PI },
  { label: "Mohakhali", shortLabel: "MOH", lat: 23.77923, lon: 90.3989, altitude: 66, heading: Math.PI / 2 },
  { label: "Banani", shortLabel: "BAN", lat: 23.79318, lon: 90.40804, altitude: 74, heading: 0, minimap: true },
  { label: "Gulshan 2", shortLabel: "GU2", lat: 23.79483, lon: 90.41424, altitude: 86, heading: 0, minimap: true },
  { label: "Merul Badda", shortLabel: "MER", lat: 23.77166, lon: 90.42539, altitude: 44, heading: -Math.PI / 2 },
  { label: "Aftabnagar", shortLabel: "AFT", lat: 23.76562, lon: 90.42931, altitude: 42, heading: -Math.PI / 2, minimap: true },
  { label: "Banasree", shortLabel: "BNS", lat: 23.76294, lon: 90.43415, altitude: 46, heading: Math.PI, minimap: true },
  { label: "Dhanmondi", shortLabel: "DMD", lat: 23.75354, lon: 90.37031, altitude: 52, heading: Math.PI / 2, minimap: true },
  { label: "Farmgate", shortLabel: "FRM", lat: 23.75904, lon: 90.38711, altitude: 64, heading: Math.PI / 2 },
  { label: "Shahbagh", shortLabel: "SHB", lat: 23.73734, lon: 90.39617, altitude: 45, heading: Math.PI / 2, minimap: true },
  { label: "Ramna", shortLabel: "RMN", lat: 23.73297, lon: 90.40113, altitude: 38, heading: Math.PI },
  { label: "Motijheel", shortLabel: "MTJ", lat: 23.72726, lon: 90.4212, altitude: 96, heading: -Math.PI / 2, minimap: true },
  { label: "Khilgaon", shortLabel: "KHL", lat: 23.75065, lon: 90.42328, altitude: 50, heading: Math.PI },
  { label: "Agargaon", shortLabel: "AGR", lat: 23.77843, lon: 90.38005, altitude: 66, heading: Math.PI / 2, minimap: true },
  { label: "Baridhara", shortLabel: "BRD", lat: 23.80336, lon: 90.42026, altitude: 76, heading: 0, minimap: true },
  { label: "Kuril", shortLabel: "KRL", lat: 23.81814, lon: 90.42213, altitude: 68, heading: 0 },
  { label: "Bashundhara R/A", shortLabel: "BSR", lat: 23.81893, lon: 90.43682, altitude: 82, heading: -Math.PI / 2, minimap: true },
  { label: "Mohammadpur", shortLabel: "MHP", lat: 23.76541, lon: 90.35872, altitude: 54, heading: Math.PI / 2, minimap: true },
  { label: "Mirpur 1", shortLabel: "MR1", lat: 23.79807, lon: 90.35318, altitude: 58, heading: Math.PI / 2 },
  { label: "Mirpur 10", shortLabel: "MR10", lat: 23.80673, lon: 90.36856, altitude: 64, heading: Math.PI / 2, minimap: true },
  { label: "Pallabi", shortLabel: "PLB", lat: 23.82535, lon: 90.36631, altitude: 56, heading: 0 },
  { label: "Dhaka Cantonment", shortLabel: "CAN", lat: 23.82191, lon: 90.39112, altitude: 62, heading: 0 },
  { label: "Hazrat Shahjalal Airport", shortLabel: "DAC", lat: 23.84343, lon: 90.39784, altitude: 42, heading: 0, minimap: true },
  { label: "Uttara", shortLabel: "UTR", lat: 23.87532, lon: 90.39679, altitude: 68, heading: 0, minimap: true },
  { label: "Purbachal", shortLabel: "PUR", lat: 23.83611, lon: 90.49069, altitude: 48, heading: -Math.PI / 2, minimap: true },
  { label: "Demra", shortLabel: "DEM", lat: 23.72432, lon: 90.49338, altitude: 48, heading: -Math.PI / 2, minimap: true },
  { label: "Jatrabari", shortLabel: "JAT", lat: 23.71052, lon: 90.43491, altitude: 58, heading: Math.PI },
  { label: "Old Dhaka", shortLabel: "OLD", lat: 23.71039, lon: 90.40744, altitude: 54, heading: Math.PI, minimap: true },
  { label: "Lalbagh", shortLabel: "LAL", lat: 23.71825, lon: 90.38809, altitude: 46, heading: Math.PI, minimap: true },
  { label: "Sadarghat", shortLabel: "SDR", lat: 23.70615, lon: 90.41124, altitude: 38, heading: Math.PI },
  { label: "Kamrangirchar", shortLabel: "KAM", lat: 23.71603, lon: 90.36531, altitude: 42, heading: Math.PI },
  { label: "Keraniganj", shortLabel: "KER", lat: 23.69796, lon: 90.38509, altitude: 44, heading: Math.PI, minimap: true },
];
const WATER_LANDMARKS: WaterLandmark[] = [
  { label: "Hatirjheel Lake", shortLabel: "HJL", lat: 23.77051, lon: 90.41635, minimap: true },
  { label: "Dhanmondi Lake", shortLabel: "DHL", lat: 23.74608, lon: 90.37506 },
  { label: "Gulshan Lake", shortLabel: "GLL", lat: 23.79308, lon: 90.41693 },
  { label: "Buriganga River", shortLabel: "BUR", lat: 23.70396, lon: 90.39277, minimap: true },
  { label: "Turag River", shortLabel: "TUR", lat: 23.80258, lon: 90.33982, minimap: true },
  { label: "Tongi Khal", shortLabel: "TON", lat: 23.87524, lon: 90.38187, minimap: true },
  { label: "Balu River", shortLabel: "BAL", lat: 23.78091, lon: 90.49525, minimap: true },
  { label: "Shitalakshya River", shortLabel: "SHI", lat: 23.71674, lon: 90.51805, minimap: true },
];
const DHAKA_LANDMARKS: DhakaLandmark[] = [
  { label: "Holy Rosary Church", shortLabel: "HRC", lat: 23.759151, lon: 90.392216, altitude: 61, heading: Math.PI / 2, kind: "church" },
  { label: "Bashundhara City", shortLabel: "BSC", lat: 23.751142, lon: 90.3906411, altitude: 135, heading: Math.PI / 2, kind: "bashundhara-city" },
  { label: "Hatirjheel Amphitheatre", shortLabel: "HJA", lat: 23.771125, lon: 90.4133385, altitude: 28, heading: Math.PI, kind: "amphitheatre" },
  { label: "Police Plaza Concord", shortLabel: "PPC", lat: 23.772911, lon: 90.4161391, altitude: 86, heading: 0, kind: "police-plaza" },
  { label: "BRAC Centre", shortLabel: "BRC", lat: 23.78065, lon: 90.40715, altitude: 78, heading: Math.PI / 2, kind: "brac" },
  { label: "Four Points by Sheraton", shortLabel: "SHD", lat: 23.7920829, lon: 90.4137283, altitude: 95, heading: 0, kind: "hotel" },
  { label: "Jatiya Sangsad Bhaban", shortLabel: "JSB", lat: 23.76252, lon: 90.37836, altitude: 72, heading: Math.PI, kind: "parliament", minimap: true },
  { label: "Lalbagh Fort", shortLabel: "LBF", lat: 23.71885, lon: 90.38818, altitude: 31, heading: Math.PI, kind: "lalbagh-fort", minimap: true },
  { label: "Ahsan Manzil", shortLabel: "AHM", lat: 23.70863, lon: 90.40603, altitude: 43, heading: 0, kind: "ahsan-manzil", minimap: true },
  { label: "Central Shaheed Minar", shortLabel: "CSM", lat: 23.72767, lon: 90.39604, altitude: 31, heading: Math.PI, kind: "shaheed-minar" },
  { label: "Curzon Hall", shortLabel: "CRZ", lat: 23.72631, lon: 90.40248, altitude: 38, heading: Math.PI, kind: "curzon-hall" },
  { label: "Baitul Mukarram", shortLabel: "BTM", lat: 23.72914, lon: 90.41268, altitude: 47, heading: Math.PI, kind: "baitul-mukarram", minimap: true },
];

function coordinatesToWorld(lat: number, lon: number) {
  const metresPerLongitude = 111_320 * Math.cos(MAP_CENTER.lat * Math.PI / 180);
  return new THREE.Vector2(
    (lon - MAP_CENTER.lon) * metresPerLongitude,
    -(lat - MAP_CENTER.lat) * 110_540,
  );
}

function weatherIcon(mode: WeatherMode, isDay: boolean) {
  if (mode === "storm") return "ϟ";
  if (mode === "rain") return "☂";
  if (mode === "drizzle") return "⌁";
  if (mode === "fog") return "≋";
  if (mode === "cloudy") return "☁";
  return isDay ? "☀" : "☾";
}

function buildColliderGrid(colliders: BuildingCollider[]) {
  const grid = new Map<string, BuildingCollider[]>();
  for (const collider of colliders) {
    const minX = Math.floor((collider.x - collider.halfWidth) / COLLISION_CELL_SIZE);
    const maxX = Math.floor((collider.x + collider.halfWidth) / COLLISION_CELL_SIZE);
    const minZ = Math.floor((collider.z - collider.halfDepth) / COLLISION_CELL_SIZE);
    const maxZ = Math.floor((collider.z + collider.halfDepth) / COLLISION_CELL_SIZE);
    for (let cellX = minX; cellX <= maxX; cellX++) {
      for (let cellZ = minZ; cellZ <= maxZ; cellZ++) {
        const key = `${cellX}:${cellZ}`;
        const entries = grid.get(key);
        if (entries) entries.push(collider);
        else grid.set(key, [collider]);
      }
    }
  }
  return grid;
}

function createMainThreadYielder(budgetMs = 6) {
  let deadline = performance.now() + budgetMs;
  return async (isCancelled: () => boolean) => {
    if (performance.now() < deadline) return;
    await new Promise<void>((resolve) => window.setTimeout(resolve, 0));
    if (isCancelled()) throw new DOMException("Map build cancelled", "AbortError");
    deadline = performance.now() + budgetMs;
  };
}

async function buildColliderGridAsync(colliders: BuildingCollider[], isCancelled: () => boolean) {
  const grid = new Map<string, BuildingCollider[]>();
  const yieldIfNeeded = createMainThreadYielder();
  for (const collider of colliders) {
    const minX = Math.floor((collider.x - collider.halfWidth) / COLLISION_CELL_SIZE);
    const maxX = Math.floor((collider.x + collider.halfWidth) / COLLISION_CELL_SIZE);
    const minZ = Math.floor((collider.z - collider.halfDepth) / COLLISION_CELL_SIZE);
    const maxZ = Math.floor((collider.z + collider.halfDepth) / COLLISION_CELL_SIZE);
    for (let cellX = minX; cellX <= maxX; cellX++) {
      for (let cellZ = minZ; cellZ <= maxZ; cellZ++) {
        const key = `${cellX}:${cellZ}`;
        const entries = grid.get(key);
        if (entries) entries.push(collider);
        else grid.set(key, [collider]);
      }
    }
    await yieldIfNeeded(isCancelled);
  }
  return grid;
}

function collisionCandidates(grid: Map<string, BuildingCollider[]>, x: number, z: number) {
  return grid.get(`${Math.floor(x / COLLISION_CELL_SIZE)}:${Math.floor(z / COLLISION_CELL_SIZE)}`) ?? [];
}

function seededRandom(seed = 713) {
  let value = seed;
  return () => {
    value = (value * 16807) % 2147483647;
    return (value - 1) / 2147483646;
  };
}

function trafficRoadLength(points: MapPoint[]) {
  let length = 0;
  for (let index = 1; index < points.length; index++) {
    length += Math.hypot(points[index][0] - points[index - 1][0], points[index][1] - points[index - 1][1]);
  }
  return length;
}

function selectTrafficRoads(roads: OsmMapData["roads"]) {
  const supportedKinds = new Set(["motorway", "trunk", "primary", "secondary", "tertiary", "residential", "unclassified", "service"]);
  const candidates = roads.flatMap((road, index) => {
    const points = road.points.filter(([x, z]) => Number.isFinite(x) && Number.isFinite(z));
    if (!supportedKinds.has(road.kind) || points.length < 2 || trafficRoadLength(points) < 70) return [];
    const hash = Math.imul(road.id || index + 1, 2_654_435_761) >>> 0;
    const score = hash / 4_294_967_295;
    if (roads.length > 4 && score > TRAFFIC_ROUTE_SAMPLE_RATIO) return [];
    const center = points[Math.floor(points.length / 2)];
    return [{ ...road, points, score, cell: `${Math.floor(center[0] / 1_200)}:${Math.floor(center[1] / 1_200)}` }];
  });

  candidates.sort((a, b) => a.score - b.score);
  const selected: typeof candidates = [];
  const selectedIds = new Set<number>();
  const occupiedCells = new Set<string>();
  for (const road of candidates) {
    if (occupiedCells.has(road.cell)) continue;
    selected.push(road);
    selectedIds.add(road.id);
    occupiedCells.add(road.cell);
    if (selected.length >= TRAFFIC_ROUTE_BUDGET) return selected;
  }
  for (const road of candidates) {
    if (selectedIds.has(road.id)) continue;
    selected.push(road);
    if (selected.length >= TRAFFIC_ROUTE_BUDGET) break;
  }
  return selected;
}

function createTrafficSimulation(
  parent: THREE.Object3D,
  roads: OsmMapData["roads"],
  maxVehicles = TRAFFIC_MAX_VEHICLES,
): TrafficSimulation | null {
  const routes = selectTrafficRoads(roads);
  if (routes.length === 0) return null;

  const random = seededRandom(9_047);
  const vehicleTotal = routes.length <= 4
    ? maxVehicles
    : Math.min(maxVehicles, Math.max(24, Math.round(routes.length * 1.15)));
  const trafficRoot = new THREE.Group();
  trafficRoot.name = "Sampled real-time traffic";
  parent.add(trafficRoot);

  const bodyGeometry = new THREE.BoxGeometry(6.2, 1.55, 3);
  const cabinGeometry = new THREE.BoxGeometry(3.15, 1.15, 2.55);
  const bodyMaterial = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.42, metalness: 0.18 });
  const cabinMaterial = new THREE.MeshStandardMaterial({ color: 0x6f898b, roughness: 0.23, metalness: 0.16 });
  const bodies = new THREE.InstancedMesh(bodyGeometry, bodyMaterial, vehicleTotal);
  const cabins = new THREE.InstancedMesh(cabinGeometry, cabinMaterial, vehicleTotal);
  bodies.name = "Traffic vehicle bodies";
  cabins.name = "Traffic vehicle cabins";
  bodies.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  cabins.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  bodies.frustumCulled = false;
  cabins.frustumCulled = false;
  trafficRoot.add(bodies, cabins);

  const palette = [0xe0b653, 0xb54f46, 0x4e7380, 0xd8d2ba, 0x45604f, 0xc8c5b7, 0x8d5d72];
  const vehicles: TrafficVehicle[] = [];
  for (let index = 0; index < vehicleTotal; index++) {
    const road = routes[index % routes.length];
    const direction: 1 | -1 = random() > 0.5 ? 1 : -1;
    const segmentIndex = direction === 1
      ? Math.floor(random() * (road.points.length - 1))
      : 1 + Math.floor(random() * (road.points.length - 1));
    const nextIndex = segmentIndex + direction;
    const start = road.points[segmentIndex];
    const end = road.points[nextIndex];
    const segmentLength = Math.max(1, Math.hypot(end[0] - start[0], end[1] - start[1]));
    const segmentProgress = random() * segmentLength;
    const ratio = segmentProgress / segmentLength;
    const dx = end[0] - start[0];
    const dz = end[1] - start[1];
    const heading = Math.atan2(dz, dx);
    const laneOffset = 0.75 + random() * 0.85;
    const position = new THREE.Vector3(
      THREE.MathUtils.lerp(start[0], end[0], ratio) - Math.sin(heading) * laneOffset * direction,
      2.25,
      THREE.MathUtils.lerp(start[1], end[1], ratio) + Math.cos(heading) * laneOffset * direction,
    );
    const major = ["motorway", "trunk", "primary", "secondary"].includes(road.kind);
    const baseSpeed = major ? 11 + random() * 8 : 6 + random() * 6;
    vehicles.push({
      route: road.points,
      segmentIndex,
      segmentProgress,
      direction,
      laneOffset,
      speed: baseSpeed,
      baseSpeed,
      phase: random() * Math.PI * 2,
      position,
      previousPosition: position.clone(),
      heading,
      previousHeading: heading,
    });
    bodies.setColorAt(index, new THREE.Color(palette[index % palette.length]));
  }
  if (bodies.instanceColor) bodies.instanceColor.needsUpdate = true;

  let simulationTime = 0;
  let accumulator = 0;
  let overloadCooldown = 0;
  let currentTickHz = TRAFFIC_BASE_TICK_HZ;
  let visibleVehicles = Math.min(vehicleTotal, Math.max(8, Math.floor(vehicleTotal * 0.18)));
  const matrix = new THREE.Matrix4();
  const quaternion = new THREE.Quaternion();
  const scale = new THREE.Vector3(1, 1, 1);
  const renderPosition = new THREE.Vector3();
  const up = new THREE.Vector3(0, 1, 0);

  const stepVehicle = (vehicle: TrafficVehicle, step: number) => {
    vehicle.previousPosition.copy(vehicle.position);
    vehicle.previousHeading = vehicle.heading;
    const flow = 0.82 + Math.sin(simulationTime * 0.42 + vehicle.phase) * 0.18;
    vehicle.speed = THREE.MathUtils.lerp(vehicle.speed, vehicle.baseSpeed * flow, 1 - Math.exp(-1.2 * step));
    let remaining = vehicle.speed * step;
    let guard = 0;
    while (remaining > 0 && guard++ < 8) {
      let nextIndex = vehicle.segmentIndex + vehicle.direction;
      if (nextIndex < 0 || nextIndex >= vehicle.route.length) {
        vehicle.direction = vehicle.direction === 1 ? -1 : 1;
        nextIndex = vehicle.segmentIndex + vehicle.direction;
        vehicle.segmentProgress = 0;
      }
      const start = vehicle.route[vehicle.segmentIndex];
      const end = vehicle.route[nextIndex];
      const dx = end[0] - start[0];
      const dz = end[1] - start[1];
      const segmentLength = Math.max(0.01, Math.hypot(dx, dz));
      const available = segmentLength - vehicle.segmentProgress;
      if (remaining < available) {
        vehicle.segmentProgress += remaining;
        remaining = 0;
      } else {
        remaining -= available;
        vehicle.segmentIndex = nextIndex;
        vehicle.segmentProgress = 0;
      }
    }
    let nextIndex = vehicle.segmentIndex + vehicle.direction;
    if (nextIndex < 0 || nextIndex >= vehicle.route.length) {
      vehicle.direction = vehicle.direction === 1 ? -1 : 1;
      nextIndex = vehicle.segmentIndex + vehicle.direction;
      vehicle.segmentProgress = 0;
    }
    const start = vehicle.route[vehicle.segmentIndex];
    const end = vehicle.route[nextIndex];
    const dx = end[0] - start[0];
    const dz = end[1] - start[1];
    const segmentLength = Math.max(0.01, Math.hypot(dx, dz));
    const ratio = clamp(vehicle.segmentProgress / segmentLength, 0, 1);
    vehicle.heading = Math.atan2(dz, dx);
    vehicle.position.set(
      THREE.MathUtils.lerp(start[0], end[0], ratio) - Math.sin(vehicle.heading) * vehicle.laneOffset * vehicle.direction,
      2.25,
      THREE.MathUtils.lerp(start[1], end[1], ratio) + Math.cos(vehicle.heading) * vehicle.laneOffset * vehicle.direction,
    );
  };

  const renderVehicles = (alpha: number) => {
    visibleVehicles = Math.min(vehicleTotal, Math.max(visibleVehicles, Math.floor(8 + simulationTime * 9)));
    bodies.count = visibleVehicles;
    cabins.count = visibleVehicles;
    for (let index = 0; index < visibleVehicles; index++) {
      const vehicle = vehicles[index];
      renderPosition.lerpVectors(vehicle.previousPosition, vehicle.position, alpha);
      const headingDelta = Math.atan2(
        Math.sin(vehicle.heading - vehicle.previousHeading),
        Math.cos(vehicle.heading - vehicle.previousHeading),
      );
      quaternion.setFromAxisAngle(up, -(vehicle.previousHeading + headingDelta * alpha));
      matrix.compose(renderPosition, quaternion, scale);
      bodies.setMatrixAt(index, matrix);
      renderPosition.y += 1.12;
      matrix.compose(renderPosition, quaternion, scale);
      cabins.setMatrixAt(index, matrix);
    }
    bodies.instanceMatrix.needsUpdate = true;
    cabins.instanceMatrix.needsUpdate = true;
  };

  renderVehicles(1);
  return {
    update(dt, frameMs) {
      overloadCooldown = frameMs > TRAFFIC_LONG_FRAME_MS ? 2.5 : Math.max(0, overloadCooldown - dt);
      currentTickHz = overloadCooldown > 0 ? TRAFFIC_THROTTLED_TICK_HZ : TRAFFIC_BASE_TICK_HZ;
      const step = 1 / currentTickHz;
      accumulator = Math.min(accumulator + dt, step * TRAFFIC_MAX_CATCH_UP_STEPS);
      let steps = 0;
      while (accumulator >= step && steps < TRAFFIC_MAX_CATCH_UP_STEPS) {
        simulationTime += step;
        for (const vehicle of vehicles) stepVehicle(vehicle, step);
        accumulator -= step;
        steps++;
      }
      renderVehicles(clamp(accumulator / step, 0, 1));
    },
    dispose() {
      parent.remove(trafficRoot);
      bodyGeometry.dispose();
      cabinGeometry.dispose();
      bodyMaterial.dispose();
      cabinMaterial.dispose();
    },
    get vehicleCount() {
      return visibleVehicles;
    },
    get tickHz() {
      return currentTickHz;
    },
  };
}

function createAirflowVfx(crow: THREE.Group): AirflowVfx {
  const random = seededRandom(2_606);
  const streakCount = 52;
  const positions = new Float32Array(streakCount * 6);
  const streaks = Array.from({ length: streakCount }, () => ({
    x: (random() - 0.5) * 36,
    y: (random() - 0.5) * 22,
    z: -70 + random() * 88,
    length: 1.2 + random() * 4.4,
    drift: 0.78 + random() * 0.52,
  }));
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  const material = new THREE.LineBasicMaterial({
    color: 0xd9ffff,
    transparent: true,
    opacity: 0,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    toneMapped: false,
  });
  const lines = new THREE.LineSegments(geometry, material);
  lines.frustumCulled = false;
  lines.renderOrder = 20;
  crow.add(lines);

  return {
    update(dt, speedAmount, verticalSpeed, boosting, reducedMotion) {
      const intensity = reducedMotion ? 0 : clamp((speedAmount - 0.28) / 0.72 + (boosting ? 0.28 : 0), 0, 1);
      lines.visible = intensity > 0.015;
      material.opacity = intensity * 0.48;
      const climbStretch = 1 + Math.abs(verticalSpeed) / 28;
      for (let index = 0; index < streaks.length; index++) {
        const streak = streaks[index];
        streak.z += dt * (22 + speedAmount * 112) * streak.drift;
        if (streak.z > 19) {
          streak.z = -72 - random() * 18;
          streak.x = (random() - 0.5) * 36;
          streak.y = (random() - 0.5) * 22;
        }
        const offset = index * 6;
        positions[offset] = streak.x;
        positions[offset + 1] = streak.y;
        positions[offset + 2] = streak.z;
        positions[offset + 3] = streak.x;
        positions[offset + 4] = streak.y - clamp(verticalSpeed / 14, -1.4, 1.4);
        positions[offset + 5] = streak.z + streak.length * (0.7 + speedAmount * 1.8) * climbStretch;
      }
      geometry.attributes.position.needsUpdate = true;
    },
    dispose() {
      crow.remove(lines);
      geometry.dispose();
      material.dispose();
    },
  };
}

function createWeatherVfx(
  scene: THREE.Scene,
  renderer: THREE.WebGLRenderer,
  sky: Sky,
  hemisphere: THREE.HemisphereLight,
  sun: THREE.DirectionalLight,
  skyFill: THREE.DirectionalLight,
  reducedMotion: boolean,
): WeatherVfx {
  const random = seededRandom(9_071);
  const maxDrops = reducedMotion ? 360 : 720;
  const positions = new Float32Array(maxDrops * 6);
  const drops = Array.from({ length: maxDrops }, () => ({
    x: (random() - 0.5) * 250,
    y: -35 + random() * 210,
    z: (random() - 0.5) * 250,
    speed: 82 + random() * 95,
    length: 4.5 + random() * 8,
  }));
  const rainGeometry = new THREE.BufferGeometry();
  rainGeometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  const rainMaterial = new THREE.LineBasicMaterial({
    color: 0xb8dbe4,
    transparent: true,
    opacity: 0,
    depthWrite: false,
    toneMapped: false,
  });
  const rain = new THREE.LineSegments(rainGeometry, rainMaterial);
  rain.frustumCulled = false;
  rain.renderOrder = 25;
  rain.visible = false;
  scene.add(rain);

  const starPositions = new Float32Array(420 * 3);
  for (let index = 0; index < 420; index++) {
    const radius = 4_200 + random() * 800;
    const azimuth = random() * Math.PI * 2;
    const elevation = 0.08 + random() * 1.18;
    starPositions[index * 3] = Math.cos(azimuth) * Math.cos(elevation) * radius;
    starPositions[index * 3 + 1] = Math.sin(elevation) * radius;
    starPositions[index * 3 + 2] = Math.sin(azimuth) * Math.cos(elevation) * radius;
  }
  const starGeometry = new THREE.BufferGeometry();
  starGeometry.setAttribute("position", new THREE.BufferAttribute(starPositions, 3));
  const starMaterial = new THREE.PointsMaterial({
    color: 0xd9ecff,
    size: 5.5,
    sizeAttenuation: true,
    transparent: true,
    opacity: 0.72,
    depthWrite: false,
    fog: false,
    toneMapped: false,
  });
  const stars = new THREE.Points(starGeometry, starMaterial);
  stars.visible = false;
  stars.renderOrder = -1;
  scene.add(stars);

  const lightning = new THREE.DirectionalLight(0xd8eeff, 0);
  lightning.position.set(-180, 520, -240);
  scene.add(lightning);

  let activeDrops = 0;
  let mode: WeatherMode = "cloudy";
  let windX = 0;
  let windZ = 0;
  let lightningClock = 4 + random() * 4;
  let lightningPulse = 0;

  const apply = (weather: WeatherSnapshot) => {
    mode = weather.mode;
    const cloudAmount = clamp(weather.cloudCover / 100, 0, 1);
    const raining = mode === "drizzle" || mode === "rain" || mode === "storm";
    const rainStrength = mode === "drizzle"
      ? 0.28
      : mode === "rain"
        ? clamp(0.58 + weather.precipitation * 0.13, 0.58, 0.9)
        : mode === "storm"
          ? 1
          : 0;
    activeDrops = Math.round(maxDrops * rainStrength);
    rainGeometry.setDrawRange(0, activeDrops * 2);
    rain.visible = raining;
    rainMaterial.opacity = 0.2 + rainStrength * 0.48;
    rainMaterial.color.set(mode === "storm" ? 0xc9e6f2 : 0xaed3dc);

    const windToward = THREE.MathUtils.degToRad(weather.windDirection + 180);
    const windScale = clamp(weather.windSpeed / 18, 0.08, 1.5);
    windX = Math.sin(windToward) * 12 * windScale;
    windZ = Math.cos(windToward) * 12 * windScale;

    const isNight = !weather.isDay;
    const background = isNight
      ? mode === "storm" ? 0x10212a : mode === "rain" ? 0x142933 : 0x17313d
      : mode === "fog" ? 0xa4ad91
        : mode === "storm" ? 0x49656b
          : mode === "rain" ? 0x6f9695
            : mode === "cloudy" ? 0x86aaa0
              : 0x91c7c0;
    scene.background = new THREE.Color(background);
    if (scene.fog instanceof THREE.FogExp2) {
      scene.fog.color.set(background);
      scene.fog.density = mode === "fog"
        ? 0.00135
        : mode === "storm"
          ? 0.00082
          : mode === "rain"
            ? 0.00064
            : 0.00024 + cloudAmount * 0.00018;
    }

    sky.visible = weather.isDay;
    stars.visible = isNight && cloudAmount < 0.62 && !raining && mode !== "fog";
    starMaterial.opacity = clamp(0.92 - cloudAmount, 0.25, 0.82);
    const skyUniforms = sky.material.uniforms;
    skyUniforms.turbidity.value = 3.8 + cloudAmount * 10 + (raining ? 4 : 0);
    skyUniforms.rayleigh.value = 3.4 - cloudAmount * 2.35;
    skyUniforms.mieCoefficient.value = 0.0035 + cloudAmount * 0.016;
    skyUniforms.mieDirectionalG.value = 0.82;

    renderer.toneMappingExposure = isNight
      ? 1
      : mode === "clear" ? 1.02
        : mode === "cloudy" ? 0.9
          : 0.76;
    hemisphere.intensity = isNight ? 1.42 : 1.8 - cloudAmount * 0.82;
    hemisphere.color.set(isNight ? 0x91abc1 : mode === "rain" || mode === "storm" ? 0xb8d0d4 : 0xe8f3ee);
    hemisphere.groundColor.set(isNight ? 0x34483d : 0x5d6c58);
    sun.intensity = isNight ? 0.82 : mode === "clear" ? 3.35 : mode === "cloudy" ? 1.25 : 0.46;
    sun.color.set(isNight ? 0x8ba8c7 : mode === "rain" || mode === "storm" ? 0xd6e5e5 : 0xffd6a0);
    skyFill.intensity = isNight ? 0.92 : 0.48 + cloudAmount * 0.22;
    skyFill.color.set(isNight ? 0x45617b : 0x9bc8d2);

    const clouds = scene.userData.clouds as THREE.Group[] | undefined ?? [];
    const visibleClouds = mode === "fog"
      ? Math.ceil(clouds.length * 0.45)
      : Math.round(clouds.length * clamp(cloudAmount * 1.12 + (raining ? 0.22 : 0), 0.08, 1));
    clouds.forEach((cloud, index) => {
      cloud.visible = index < visibleClouds;
      cloud.scale.setScalar(0.9 + cloudAmount * 0.34);
      cloud.userData.weatherSpeed = (0.45 + weather.windSpeed * 0.13) * (0.72 + (index % 4) * 0.12);
      for (const child of cloud.children) {
        if (child instanceof THREE.Mesh && child.material instanceof THREE.MeshStandardMaterial) {
          child.material.color.set(isNight ? 0x526773 : raining ? 0x9aa9a8 : 0xe9e5d5);
          child.material.opacity = 0.35 + cloudAmount * 0.42;
        }
      }
    });
  };

  return {
    apply,
    update(dt, anchor, paused) {
      rain.position.copy(anchor);
      stars.position.set(anchor.x, 0, anchor.z);
      if (!paused && rain.visible) {
        for (let index = 0; index < activeDrops; index++) {
          const drop = drops[index];
          drop.y -= drop.speed * dt;
          drop.x += windX * dt;
          drop.z += windZ * dt;
          if (drop.y < -45 || Math.abs(drop.x) > 145 || Math.abs(drop.z) > 145) {
            drop.x = (random() - 0.5) * 250;
            drop.y = 145 + random() * 45;
            drop.z = (random() - 0.5) * 250;
          }
          const offset = index * 6;
          positions[offset] = drop.x;
          positions[offset + 1] = drop.y;
          positions[offset + 2] = drop.z;
          positions[offset + 3] = drop.x - windX * 0.16;
          positions[offset + 4] = drop.y + drop.length;
          positions[offset + 5] = drop.z - windZ * 0.16;
        }
        rainGeometry.attributes.position.needsUpdate = true;
      }

      if (!paused && mode === "storm") {
        lightningClock -= dt;
        if (lightningClock <= 0) {
          lightningPulse = 1;
          lightningClock = 3.2 + random() * 6.8;
        }
        lightningPulse = Math.max(0, lightningPulse - dt * 7.5);
        lightning.intensity = lightningPulse > 0 ? 2.5 + lightningPulse * 8 : 0;
      } else {
        lightning.intensity = 0;
      }
    },
    dispose() {
      scene.remove(rain, stars, lightning);
      rainGeometry.dispose();
      rainMaterial.dispose();
      starGeometry.dispose();
      starMaterial.dispose();
      lightning.dispose();
    },
  };
}

function coordinateRandom(tileX: number, tileZ: number) {
  const seed = Math.abs(Math.imul(tileX + 4099, 73_856_093) ^ Math.imul(tileZ - 8191, 19_349_663)) || 1;
  return seededRandom(seed % 2_147_483_647);
}

function pointInPolygon(x: number, z: number, points: MapPoint[]) {
  let inside = false;
  for (let index = 0, previous = points.length - 1; index < points.length; previous = index++) {
    const [x1, z1] = points[index];
    const [x2, z2] = points[previous];
    const intersects = ((z1 > z) !== (z2 > z)) && x < ((x2 - x1) * (z - z1)) / ((z2 - z1) || Number.EPSILON) + x1;
    if (intersects) inside = !inside;
  }
  return inside;
}

function distanceToSegmentSquared(x: number, z: number, x1: number, z1: number, x2: number, z2: number) {
  const dx = x2 - x1;
  const dz = z2 - z1;
  const lengthSquared = dx * dx + dz * dz;
  const amount = lengthSquared === 0 ? 0 : clamp(((x - x1) * dx + (z - z1) * dz) / lengthSquared, 0, 1);
  const closestX = x1 + dx * amount;
  const closestZ = z1 + dz * amount;
  return (x - closestX) ** 2 + (z - closestZ) ** 2;
}

async function addProceduralDistrictTiles(
  scene: THREE.Scene,
  data: OsmMapData,
  osmColliders: BuildingCollider[],
  initialPosition: THREE.Vector3,
  isCancelled: () => boolean,
) {
  const tileSize = 460;
  const visibilityRadius = 1_550;
  const tiles: ProceduralDistrictTile[] = [];
  const colliders: BuildingCollider[] = [];
  const unitBox = new THREE.BoxGeometry(1, 1, 1);
  const roofBox = new THREE.BoxGeometry(1, 1, 1);
  const treeGeometry = new THREE.IcosahedronGeometry(1, 1);
  const materials = [0xc9bda3, 0xaeb8ae, 0xb9826d].map(
    (color) => new THREE.MeshStandardMaterial({ color, roughness: 0.9, metalness: 0.01 }),
  );
  const roofMaterial = new THREE.MeshStandardMaterial({ color: 0x59655f, roughness: 0.94 });
  const treeMaterial = new THREE.MeshStandardMaterial({ color: 0x4b7452, roughness: 1 });
  const majorRoads = new Set(["motorway", "trunk", "primary", "secondary"]);
  type AvoidanceSegment = { x1: number; z1: number; x2: number; z2: number; radius: number };
  const spatialCellSize = 180;
  const roadGrid = new Map<string, AvoidanceSegment[]>();
  const waterGrid = new Map<string, AvoidanceSegment[]>();
  const waterAreaGrid = new Map<string, MapPoint[][]>();
  const colliderGrid = new Map<string, BuildingCollider[]>();
  const yieldIfNeeded = createMainThreadYielder();
  const spatialKey = (cellX: number, cellZ: number) => `${cellX}:${cellZ}`;
  const addToGrid = <T,>(grid: Map<string, T[]>, item: T, minX: number, maxX: number, minZ: number, maxZ: number) => {
    for (let cellX = Math.floor(minX / spatialCellSize); cellX <= Math.floor(maxX / spatialCellSize); cellX++) {
      for (let cellZ = Math.floor(minZ / spatialCellSize); cellZ <= Math.floor(maxZ / spatialCellSize); cellZ++) {
        const key = spatialKey(cellX, cellZ);
        const entries = grid.get(key);
        if (entries) entries.push(item);
        else grid.set(key, [item]);
      }
    }
  };
  for (const road of data.roads) {
    const radius = majorRoads.has(road.kind) ? 15 : road.kind === "service" ? 6 : 9;
    for (let index = 1; index < road.points.length; index++) {
      const [x1, z1] = road.points[index - 1];
      const [x2, z2] = road.points[index];
      const segment = { x1, z1, x2, z2, radius };
      addToGrid(roadGrid, segment, Math.min(x1, x2) - 42, Math.max(x1, x2) + 42, Math.min(z1, z2) - 42, Math.max(z1, z2) + 42);
    }
    await yieldIfNeeded(isCancelled);
  }
  for (const feature of data.water) {
    if (feature.area && feature.points.length >= 3) {
      const xs = feature.points.map(([x]) => x);
      const zs = feature.points.map(([, z]) => z);
      addToGrid(waterAreaGrid, feature.points, Math.min(...xs), Math.max(...xs), Math.min(...zs), Math.max(...zs));
    }
    for (let index = 1; index < feature.points.length; index++) {
      const [x1, z1] = feature.points[index - 1];
      const [x2, z2] = feature.points[index];
      const segment = { x1, z1, x2, z2, radius: 10 };
      addToGrid(waterGrid, segment, Math.min(x1, x2) - 46, Math.max(x1, x2) + 46, Math.min(z1, z2) - 46, Math.max(z1, z2) + 46);
    }
    await yieldIfNeeded(isCancelled);
  }
  for (const collider of osmColliders) {
    addToGrid(
      colliderGrid,
      collider,
      collider.x - collider.halfWidth - 38,
      collider.x + collider.halfWidth + 38,
      collider.z - collider.halfDepth - 38,
      collider.z + collider.halfDepth + 38,
    );
    await yieldIfNeeded(isCancelled);
  }
  const districtCenters = AREA_LANDMARKS.map((landmark) => {
    const world = coordinatesToWorld(landmark.lat, landmark.lon);
    return { x: world.x, z: world.y, intensity: clamp(landmark.altitude / 82, 0.45, 1.1) };
  });

  const blockedByMap = (x: number, z: number, halfWidth: number, halfDepth: number) => {
    const key = spatialKey(Math.floor(x / spatialCellSize), Math.floor(z / spatialCellSize));
    if ((waterAreaGrid.get(key) ?? []).some((points) => pointInPolygon(x, z, points))) return true;
    const waterClearance = Math.max(halfWidth, halfDepth) + 10;
    if ((waterGrid.get(key) ?? []).some((segment) => distanceToSegmentSquared(x, z, segment.x1, segment.z1, segment.x2, segment.z2) < waterClearance ** 2)) return true;
    for (const segment of roadGrid.get(key) ?? []) {
      const clearance = Math.max(halfWidth, halfDepth) + segment.radius;
      if (distanceToSegmentSquared(x, z, segment.x1, segment.z1, segment.x2, segment.z2) < clearance ** 2) return true;
    }
    return (colliderGrid.get(key) ?? []).some((collider) => (
      Math.abs(x - collider.x) < halfWidth + collider.halfWidth + 4 &&
      Math.abs(z - collider.z) < halfDepth + collider.halfDepth + 4
    ));
  };

  const roadHeadingAt = (x: number, z: number) => {
    const cellX = Math.floor(x / spatialCellSize);
    const cellZ = Math.floor(z / spatialCellSize);
    let nearest: AvoidanceSegment | null = null;
    let nearestDistance = 150 ** 2;
    for (let offsetX = -1; offsetX <= 1; offsetX++) {
      for (let offsetZ = -1; offsetZ <= 1; offsetZ++) {
        for (const segment of roadGrid.get(spatialKey(cellX + offsetX, cellZ + offsetZ)) ?? []) {
          const distance = distanceToSegmentSquared(x, z, segment.x1, segment.z1, segment.x2, segment.z2);
          if (distance < nearestDistance) {
            nearest = segment;
            nearestDistance = distance;
          }
        }
      }
    }
    return nearest ? -Math.atan2(nearest.z2 - nearest.z1, nearest.x2 - nearest.x1) : 0;
  };

  const matrix = new THREE.Matrix4();
  const quaternion = new THREE.Quaternion();
  const position = new THREE.Vector3();
  const scale = new THREE.Vector3();
  const minTileX = Math.floor(-FLIGHT_EXTENT.x / tileSize);
  const maxTileX = Math.ceil(FLIGHT_EXTENT.x / tileSize);
  const minTileZ = Math.floor(-FLIGHT_EXTENT.z / tileSize);
  const maxTileZ = Math.ceil(FLIGHT_EXTENT.z / tileSize);

  for (let tileX = minTileX; tileX <= maxTileX; tileX++) {
    for (let tileZ = minTileZ; tileZ <= maxTileZ; tileZ++) {
      const random = coordinateRandom(tileX, tileZ);
      const centerX = tileX * tileSize;
      const centerZ = tileZ * tileSize;
      if (Math.abs(centerX) > FLIGHT_EXTENT.x + tileSize / 2 || Math.abs(centerZ) > FLIGHT_EXTENT.z + tileSize / 2) continue;
      const transforms: THREE.Matrix4[][] = [[], [], []];
      const roofTransforms: THREE.Matrix4[] = [];
      const treeTransforms: THREE.Matrix4[] = [];
      const tileColliders: BuildingCollider[] = [];
      let tileIntensity = 0.2;
      for (const district of districtCenters) {
        const proximity = clamp(1 - Math.hypot(centerX - district.x, centerZ - district.z) / 1_350, 0, 1);
        tileIntensity = Math.max(tileIntensity, proximity * district.intensity);
      }
      // These are placement attempts rather than guaranteed buildings. Dense, compact lots
      // survive the road/water/OSM rejection pass and still render in only a few draw calls.
      const targetBuildings = 52 + Math.floor(tileIntensity * 34 + random() * 14);

      for (let index = 0; index < targetBuildings; index++) {
        const x = centerX + (random() - 0.5) * (tileSize - 44);
        const z = centerZ + (random() - 0.5) * (tileSize - 44);
        const width = 9 + random() * 17;
        const depth = 10 + random() * 18;
        const halfWidth = width / 2;
        const halfDepth = depth / 2;
        if (Math.abs(x) > FLIGHT_EXTENT.x - halfWidth || Math.abs(z) > FLIGHT_EXTENT.z - halfDepth) continue;
        if (blockedByMap(x, z, halfWidth, halfDepth)) continue;
        if (tileColliders.some((collider) => (
          Math.abs(x - collider.x) < halfWidth + collider.halfWidth + 3.5 &&
          Math.abs(z - collider.z) < halfDepth + collider.halfDepth + 3.5
        ))) continue;
        let districtInfluence = 0.18;
        for (const district of districtCenters) {
          const proximity = clamp(1 - Math.hypot(x - district.x, z - district.z) / 1_150, 0, 1);
          districtInfluence = Math.max(districtInfluence, proximity * district.intensity);
        }
        const floors = 2 + Math.floor(random() * 5 + districtInfluence * 9);
        const height = floors * (2.95 + random() * 0.38);
        const bucket = height > 34 ? 2 : height > 20 ? 1 : 0;
        const streetHeading = roadHeadingAt(x, z);
        quaternion.setFromAxisAngle(new THREE.Vector3(0, 1, 0), streetHeading + (random() - 0.5) * 0.055);
        position.set(x, height / 2 + 0.92, z);
        scale.set(width, height, depth);
        transforms[bucket].push(matrix.compose(position, quaternion, scale).clone());
        const collider = { x, z, halfWidth, halfDepth, top: height + 0.92 };
        tileColliders.push(collider);
        colliders.push(collider);
        if (height > 25 && random() > 0.34) {
          const roofHeight = 2.6 + random() * 3.2;
          position.set(x + (random() - 0.5) * width * 0.22, height + roofHeight / 2 + 0.92, z + (random() - 0.5) * depth * 0.22);
          scale.set(width * (0.18 + random() * 0.18), roofHeight, depth * (0.2 + random() * 0.18));
          roofTransforms.push(matrix.compose(position, quaternion, scale).clone());
        }
      }

      const targetTrees = 2 + Math.floor(random() * 4);
      for (let index = 0; index < targetTrees; index++) {
        const x = centerX + (random() - 0.5) * (tileSize - 34);
        const z = centerZ + (random() - 0.5) * (tileSize - 34);
        const radius = 3.2 + random() * 2.8;
        if (blockedByMap(x, z, radius, radius)) continue;
        if (tileColliders.some((collider) => Math.abs(x - collider.x) < collider.halfWidth + radius && Math.abs(z - collider.z) < collider.halfDepth + radius)) continue;
        quaternion.setFromEuler(new THREE.Euler(random(), random(), random()));
        position.set(x, 7 + random() * 3.5, z);
        scale.set(radius, 5 + random() * 3.5, radius);
        treeTransforms.push(matrix.compose(position, quaternion, scale).clone());
      }

      const group = new THREE.Group();
      group.name = `Procedural district tile ${tileX},${tileZ}`;
      transforms.forEach((bucketTransforms, bucket) => {
        if (bucketTransforms.length === 0) return;
        const mesh = new THREE.InstancedMesh(unitBox, materials[bucket], bucketTransforms.length);
        bucketTransforms.forEach((transform, index) => mesh.setMatrixAt(index, transform));
        mesh.instanceMatrix.needsUpdate = true;
        mesh.castShadow = bucket === 2;
        mesh.receiveShadow = true;
        group.add(mesh);
      });
      if (roofTransforms.length > 0) {
        const roofs = new THREE.InstancedMesh(roofBox, roofMaterial, roofTransforms.length);
        roofTransforms.forEach((transform, index) => roofs.setMatrixAt(index, transform));
        roofs.instanceMatrix.needsUpdate = true;
        roofs.castShadow = true;
        group.add(roofs);
      }
      if (treeTransforms.length > 0) {
        const trees = new THREE.InstancedMesh(treeGeometry, treeMaterial, treeTransforms.length);
        treeTransforms.forEach((transform, index) => trees.setMatrixAt(index, transform));
        trees.instanceMatrix.needsUpdate = true;
        trees.castShadow = true;
        group.add(trees);
      }
      if (group.children.length === 0) {
        await yieldIfNeeded(isCancelled);
        continue;
      }
      group.visible = Math.hypot(centerX - initialPosition.x, centerZ - initialPosition.z) < visibilityRadius;
      scene.add(group);
      tiles.push({ group, centerX, centerZ, colliders: tileColliders });
      await yieldIfNeeded(isCancelled);
    }
  }
  scene.userData.proceduralDistrictTiles = tiles;
  scene.userData.proceduralTileVisibilityRadius = visibilityRadius;
  return colliders;
}

function createFlightAudio(): FlightAudio {
  let context: AudioContext | null = null;
  let master: GainNode | null = null;
  let windGain: GainNode | null = null;
  let windFilter: BiquadFilterNode | null = null;
  let waterGain: GainNode | null = null;
  let cityGain: GainNode | null = null;
  let natureGain: GainNode | null = null;
  let flapBuffer: AudioBuffer | null = null;
  let birdCallTimer = 0;
  let enabled = false;
  let radioDucking = false;

  const activeGain = () => radioDucking ? RADIO_DUCKED_AMBIENCE_GAIN : FLIGHT_AMBIENCE_GAIN;

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

  const playBirdCall = () => {
    if (!enabled || !context || !natureGain) return;
    const now = context.currentTime;
    const panner = context.createStereoPanner();
    panner.pan.value = Math.random() * 1.5 - 0.75;
    panner.connect(natureGain);
    const basePitch = 1_650 + Math.random() * 720;
    const notes = Math.random() > 0.5 ? 3 : 2;

    for (let index = 0; index < notes; index++) {
      const startAt = now + index * (0.105 + Math.random() * 0.035);
      const oscillator = context.createOscillator();
      oscillator.type = "sine";
      oscillator.frequency.setValueAtTime(basePitch * (1 + index * 0.055), startAt);
      oscillator.frequency.exponentialRampToValueAtTime(basePitch * (1.28 + index * 0.035), startAt + 0.075);
      oscillator.frequency.exponentialRampToValueAtTime(basePitch * 0.94, startAt + 0.19);
      const envelope = context.createGain();
      envelope.gain.setValueAtTime(0.0001, startAt);
      envelope.gain.exponentialRampToValueAtTime(0.018 + Math.random() * 0.008, startAt + 0.025);
      envelope.gain.exponentialRampToValueAtTime(0.0001, startAt + 0.2);
      oscillator.connect(envelope).connect(panner);
      if (index === notes - 1) oscillator.onended = () => panner.disconnect();
      oscillator.start(startAt);
      oscillator.stop(startAt + 0.22);
    }
  };

  const scheduleBirdCall = (delay = 1_800 + Math.random() * 2_800) => {
    if (birdCallTimer) window.clearTimeout(birdCallTimer);
    birdCallTimer = window.setTimeout(() => {
      birdCallTimer = 0;
      playBirdCall();
      if (enabled) scheduleBirdCall(4_200 + Math.random() * 6_800);
    }, delay);
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

    natureGain = context.createGain();
    natureGain.gain.value = 0.72;
    natureGain.connect(master);

    const leafRustle = context.createBufferSource();
    leafRustle.buffer = makeNoise(context, 7.4, 0.955);
    leafRustle.loop = true;
    const rustleFilter = context.createBiquadFilter();
    rustleFilter.type = "bandpass";
    rustleFilter.frequency.value = 2_350;
    rustleFilter.Q.value = 0.32;
    const rustleGain = context.createGain();
    rustleGain.gain.value = 0.018;
    leafRustle.connect(rustleFilter).connect(rustleGain).connect(natureGain);
    leafRustle.start();

    const breezePulse = context.createOscillator();
    breezePulse.type = "sine";
    breezePulse.frequency.value = 0.11;
    const breezeDepth = context.createGain();
    breezeDepth.gain.value = 0.009;
    breezePulse.connect(breezeDepth).connect(rustleGain.gain);
    breezePulse.start();

    const crickets = context.createOscillator();
    crickets.type = "sine";
    crickets.frequency.value = 3_780;
    const cricketGain = context.createGain();
    cricketGain.gain.value = 0.0017;
    crickets.connect(cricketGain).connect(natureGain);
    crickets.start();

    const cricketPulse = context.createOscillator();
    cricketPulse.type = "square";
    cricketPulse.frequency.value = 7.2;
    const cricketDepth = context.createGain();
    cricketDepth.gain.value = 0.0014;
    cricketPulse.connect(cricketDepth).connect(cricketGain.gain);
    cricketPulse.start();

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
    master.gain.setTargetAtTime(activeGain(), context.currentTime, 0.45);
    scheduleBirdCall();
    return true;
  };

  return {
    start,
    async toggle() {
      if (!context || !master) return start();
      if (context.state === "suspended") await context.resume();
      enabled = !enabled;
      master.gain.cancelScheduledValues(context.currentTime);
      master.gain.setTargetAtTime(enabled ? activeGain() : 0, context.currentTime, 0.18);
      if (enabled) scheduleBirdCall();
      else if (birdCallTimer) {
        window.clearTimeout(birdCallTimer);
        birdCallTimer = 0;
      }
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
      master.gain.setTargetAtTime(activeGain(), context.currentTime, 0.35);
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
      if (!context || !windGain || !windFilter || !waterGain || !cityGain || !natureGain) return;
      const now = context.currentTime;
      windGain.gain.setTargetAtTime(0.025 + speed / 1450, now, 0.35);
      windFilter.frequency.setTargetAtTime(420 + speed * 7.5, now, 0.4);
      const nearness = clamp(1 - altitude / 190, 0, 1);
      waterGain.gain.setTargetAtTime(0.004 + nearness * 0.021, now, 0.7);
      cityGain.gain.setTargetAtTime(0.004 + nearness * 0.008, now, 0.8);
      natureGain.gain.setTargetAtTime(0.42 + nearness * 0.58, now, 1.1);
    },
    setRadioDucking(active) {
      radioDucking = active;
      if (!enabled || !context || !master) return;
      master.gain.cancelScheduledValues(context.currentTime);
      master.gain.setTargetAtTime(activeGain(), context.currentTime, 0.28);
    },
    dispose() {
      enabled = false;
      if (birdCallTimer) window.clearTimeout(birdCallTimer);
      birdCallTimer = 0;
      context?.close();
      context = null;
    },
  };
}

function createFlightRadio(onStatus: (status: RadioStatus) => void): FlightRadio {
  const liveAudio = new Audio();
  liveAudio.preload = "none";
  let currentStation: RadioStation | null = null;
  let enabled = false;
  let volume = 0.58;
  let context: AudioContext | null = null;
  let synthMaster: GainNode | null = null;
  let chordOscillators: OscillatorNode[] = [];
  let chordTimer = 0;

  const stopChordTimer = () => {
    if (chordTimer) window.clearInterval(chordTimer);
    chordTimer = 0;
  };

  const fadeSynth = (target: number) => {
    if (!context || !synthMaster) return;
    const now = context.currentTime;
    synthMaster.gain.cancelScheduledValues(now);
    synthMaster.gain.setTargetAtTime(target, now, target > 0 ? 1.6 : 0.22);
  };

  const tuneChord = (root: number) => {
    if (!context) return;
    const ratios = [1, 1.25, 1.5];
    chordOscillators.forEach((oscillator, index) => {
      oscillator.frequency.setTargetAtTime(root * ratios[index], context!.currentTime, 3.8);
    });
  };

  const initializeRelaxingStation = () => {
    if (context) return;
    context = new AudioContext();
    synthMaster = context.createGain();
    synthMaster.gain.value = 0;
    synthMaster.connect(context.destination);

    const noiseBuffer = context.createBuffer(2, context.sampleRate * 6, context.sampleRate);
    for (let channel = 0; channel < noiseBuffer.numberOfChannels; channel++) {
      const data = noiseBuffer.getChannelData(channel);
      let previous = 0;
      for (let index = 0; index < data.length; index++) {
        const white = Math.random() * 2 - 1;
        previous = previous * 0.965 + white * 0.035;
        data[index] = previous;
      }
    }
    const rain = context.createBufferSource();
    rain.buffer = noiseBuffer;
    rain.loop = true;
    const rainFilter = context.createBiquadFilter();
    rainFilter.type = "bandpass";
    rainFilter.frequency.value = 950;
    rainFilter.Q.value = 0.42;
    const rainGain = context.createGain();
    rainGain.gain.value = 0.085;
    rain.connect(rainFilter).connect(rainGain).connect(synthMaster);
    rain.start();

    chordOscillators = [0, 1, 2].map((index) => {
      const oscillator = context!.createOscillator();
      oscillator.type = index === 0 ? "sine" : "triangle";
      oscillator.frequency.value = [110, 137.5, 165][index];
      const gain = context!.createGain();
      gain.gain.value = [0.055, 0.024, 0.018][index];
      oscillator.connect(gain).connect(synthMaster!);
      oscillator.start();
      return oscillator;
    });

  };

  const beginChordDrift = () => {
    stopChordTimer();
    const roots = [110, 98, 123.47, 103.83];
    let chordIndex = 0;
    tuneChord(roots[chordIndex]);
    chordTimer = window.setInterval(() => {
      chordIndex = (chordIndex + 1) % roots.length;
      tuneChord(roots[chordIndex]);
    }, 12_000);
  };

  const clearLiveAudio = () => {
    liveAudio.pause();
    liveAudio.removeAttribute("src");
    liveAudio.load();
  };

  liveAudio.addEventListener("playing", () => {
    if (enabled && currentStation?.stream) onStatus("playing");
  });
  liveAudio.addEventListener("waiting", () => {
    if (enabled && currentStation?.stream) onStatus("buffering");
  });
  liveAudio.addEventListener("stalled", () => {
    if (enabled && currentStation?.stream) onStatus("buffering");
  });
  liveAudio.addEventListener("error", () => {
    if (enabled && currentStation?.stream) onStatus("error");
  });

  return {
    async tune(station) {
      enabled = true;
      currentStation = station;
      clearLiveAudio();
      fadeSynth(0);
      stopChordTimer();
      onStatus("buffering");
      if (!station.stream) {
        initializeRelaxingStation();
        void context?.resume();
        beginChordDrift();
        fadeSynth(volume * 0.72);
        onStatus("playing");
        return;
      }
      liveAudio.src = `${station.stream}${station.stream.includes("?") ? "&" : "?"}t=${Date.now()}`;
      liveAudio.volume = volume;
      try {
        await liveAudio.play();
      } catch {
        if (enabled && currentStation?.id === station.id) onStatus("error");
      }
    },
    stop() {
      enabled = false;
      clearLiveAudio();
      fadeSynth(0);
      stopChordTimer();
      onStatus("off");
    },
    pause() {
      if (!enabled) return;
      liveAudio.pause();
      fadeSynth(0);
      stopChordTimer();
      onStatus("paused");
    },
    async resume() {
      if (!enabled || !currentStation) return;
      if (!currentStation.stream) {
        void context?.resume();
        beginChordDrift();
        fadeSynth(volume * 0.72);
        onStatus("playing");
        return;
      }
      onStatus("buffering");
      try {
        await liveAudio.play();
      } catch {
        onStatus("error");
      }
    },
    setVolume(nextVolume) {
      volume = clamp(nextVolume, 0, 1);
      liveAudio.volume = volume;
      if (enabled && currentStation && !currentStation.stream) fadeSynth(volume * 0.72);
    },
    dispose() {
      enabled = false;
      clearLiveAudio();
      stopChordTimer();
      if (context) void context.close();
    },
  };
}

function addPersistentDhakaLandmarks(scene: THREE.Scene) {
  const root = new THREE.Group();
  root.name = "Persistent Dhaka landmarks";
  const colliders: BuildingCollider[] = [];
  const perches: Perch[] = [];
  const unitBox = new THREE.BoxGeometry(1, 1, 1);
  const concrete = new THREE.MeshStandardMaterial({ color: 0xc9c2ad, roughness: 0.86 });
  const paleConcrete = new THREE.MeshStandardMaterial({ color: 0xe0d9c3, roughness: 0.8 });
  const brick = new THREE.MeshStandardMaterial({ color: 0x9b5e49, roughness: 0.84 });
  const redBrick = new THREE.MeshStandardMaterial({ color: 0x9f4938, roughness: 0.88 });
  const pinkPlaster = new THREE.MeshStandardMaterial({ color: 0xd47f88, roughness: 0.8 });
  const whiteStone = new THREE.MeshStandardMaterial({ color: 0xeee9dc, roughness: 0.78 });
  const glass = new THREE.MeshStandardMaterial({ color: 0x497b82, roughness: 0.22, metalness: 0.16 });
  const darkGlass = new THREE.MeshStandardMaterial({ color: 0x294e56, roughness: 0.18, metalness: 0.22 });
  const roof = new THREE.MeshStandardMaterial({ color: 0x5d6866, roughness: 0.72, metalness: 0.12 });
  const accent = new THREE.MeshStandardMaterial({ color: 0xc89c44, roughness: 0.6, metalness: 0.18 });
  const blueAccent = new THREE.MeshStandardMaterial({ color: 0x4d78a8, emissive: 0x183d66, emissiveIntensity: 0.42, roughness: 0.35, metalness: 0.22 });
  const recess = new THREE.MeshStandardMaterial({ color: 0x202826, roughness: 0.96 });
  const lawn = new THREE.MeshStandardMaterial({ color: 0x718a55, roughness: 1 });
  const water = new THREE.MeshStandardMaterial({ color: 0x477f8c, roughness: 0.2, metalness: 0.08 });
  const monumentRed = new THREE.MeshStandardMaterial({ color: 0xb72f2f, roughness: 0.78 });

  const addBox = (
    parent: THREE.Object3D,
    size: [number, number, number],
    position: [number, number, number],
    material: THREE.Material,
  ) => {
    const mesh = new THREE.Mesh(unitBox, material);
    mesh.scale.set(...size);
    mesh.position.set(...position);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    parent.add(mesh);
    return mesh;
  };

  const addCylinder = (
    parent: THREE.Object3D,
    radiusTop: number,
    radiusBottom: number,
    height: number,
    position: [number, number, number],
    material: THREE.Material,
    segments = 20,
  ) => {
    const mesh = new THREE.Mesh(new THREE.CylinderGeometry(radiusTop, radiusBottom, height, segments), material);
    mesh.position.set(...position);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    parent.add(mesh);
    return mesh;
  };

  const addDome = (
    parent: THREE.Object3D,
    radius: number,
    position: [number, number, number],
    material: THREE.Material,
  ) => {
    const mesh = new THREE.Mesh(new THREE.SphereGeometry(radius, 20, 10, 0, Math.PI * 2, 0, Math.PI / 2), material);
    mesh.position.set(...position);
    mesh.castShadow = true;
    parent.add(mesh);
    return mesh;
  };

  const addRoundInset = (
    parent: THREE.Object3D,
    radius: number,
    position: [number, number, number],
    facing: "front" | "back" | "left" | "right" = "front",
  ) => {
    const mesh = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, 1.1, 28), recess);
    mesh.position.set(...position);
    if (facing === "front" || facing === "back") mesh.rotation.x = Math.PI / 2;
    else mesh.rotation.z = Math.PI / 2;
    parent.add(mesh);
    return mesh;
  };

  const addWindowGrid = (
    parent: THREE.Object3D,
    columns: number,
    rows: number,
    spacingX: number,
    spacingY: number,
    yStart: number,
    z: number,
    material: THREE.Material = darkGlass,
  ) => {
    for (let row = 0; row < rows; row++) {
      for (let column = 0; column < columns; column++) {
        addBox(
          parent,
          [spacingX * 0.58, spacingY * 0.42, 0.8],
          [(column - (columns - 1) / 2) * spacingX, yStart + row * spacingY, z],
          material,
        );
      }
    }
  };

  const addLabel = (position: THREE.Vector3, text: string) => {
    const canvas = document.createElement("canvas");
    canvas.width = 512;
    canvas.height = 96;
    const context = canvas.getContext("2d");
    if (!context) return;
    context.fillStyle = "rgba(17, 23, 22, 0.9)";
    context.fillRect(3, 3, 506, 90);
    context.strokeStyle = "rgba(255, 204, 91, 0.92)";
    context.lineWidth = 4;
    context.strokeRect(5, 5, 502, 86);
    context.fillStyle = "#ffcc5b";
    context.font = "700 31px monospace";
    context.textAlign = "center";
    context.textBaseline = "middle";
    context.fillText(text.toUpperCase(), 256, 50);
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.minFilter = THREE.LinearFilter;
    const label = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, transparent: true, depthWrite: false, toneMapped: false }));
    label.position.copy(position);
    label.scale.set(96, 18, 1);
    root.add(label);
  };

  for (const landmark of DHAKA_LANDMARKS) {
    const world = coordinatesToWorld(landmark.lat, landmark.lon);
    const model = new THREE.Group();
    model.name = landmark.label;
    model.position.set(world.x, 0.9, world.y);
    model.rotation.y = landmark.heading;
    root.add(model);
    let halfWidth = 28;
    let halfDepth = 24;

    if (landmark.kind === "church") {
      halfWidth = 38;
      halfDepth = 25;
      addBox(model, [72, 10, 44], [0, 5, 0], paleConcrete);
      addBox(model, [54, 22, 34], [0, 19, 0], paleConcrete);
      for (const side of [-1, 1]) {
        addBox(model, [12, 35, 13], [side * 23, 27.5, -12], concrete);
        const spire = new THREE.Mesh(new THREE.ConeGeometry(7, 17, 8), roof);
        spire.position.set(side * 23, 53.5, -12);
        spire.castShadow = true;
        model.add(spire);
        addBox(model, [1.1, 8, 1.1], [side * 23, 64, -12], accent);
        addBox(model, [5, 1.1, 1.1], [side * 23, 65.5, -12], accent);
      }
      const rose = new THREE.Mesh(new THREE.TorusGeometry(5.5, 1.1, 8, 24), darkGlass);
      rose.position.set(0, 25, -17.4);
      model.add(rose);
    } else if (landmark.kind === "bashundhara-city") {
      halfWidth = 57;
      halfDepth = 40;
      addBox(model, [114, 22, 80], [0, 11, 0], paleConcrete);
      addBox(model, [108, 4, 76], [0, 24, 0], accent);
      addBox(model, [34, 17, 4], [0, 11, -42], darkGlass);
      addCylinder(model, 29, 35, 86, [0, 68, 0], concrete, 18);
      addCylinder(model, 25.5, 31.5, 80, [0, 68, 0], glass, 18);
      addBox(model, [16, 82, 3], [0, 68, -32.2], darkGlass);
      for (let y = 31; y <= 108; y += 10.5) {
        addCylinder(model, 32.5, 32.5, 1.5, [0, y, 0], accent, 18);
      }
      addCylinder(model, 17, 21, 19, [0, 121.5, 0], darkGlass, 18);
      for (let y = 114; y <= 132; y += 6) {
        const crownRing = new THREE.Mesh(new THREE.TorusGeometry(19, 0.9, 8, 32), blueAccent);
        crownRing.position.y = y;
        crownRing.rotation.x = Math.PI / 2;
        model.add(crownRing);
      }
      addCylinder(model, 0.75, 1.2, 7, [0, 137, 0], blueAccent, 8);
    } else if (landmark.kind === "amphitheatre") {
      halfWidth = 52;
      halfDepth = 38;
      addBox(model, [74, 3, 46], [0, 1.5, 3], concrete);
      for (let tier = 0; tier < 6; tier++) {
        const seating = new THREE.Mesh(new THREE.TorusGeometry(17 + tier * 4.6, 1.25, 5, 32, Math.PI), paleConcrete);
        seating.rotation.x = Math.PI / 2;
        seating.rotation.z = Math.PI;
        seating.position.set(0, 3 + tier * 1.7, 16 - tier * 2.3);
        model.add(seating);
      }
      const shell = new THREE.Mesh(new THREE.TorusGeometry(20, 2.4, 7, 36, Math.PI), accent);
      shell.position.set(0, 17, -15);
      model.add(shell);
      addBox(model, [39, 2, 15], [0, 3, -12], darkGlass);
    } else if (landmark.kind === "police-plaza") {
      halfWidth = 42;
      halfDepth = 31;
      addBox(model, [84, 15, 62], [0, 7.5, 0], paleConcrete);
      addBox(model, [78, 3, 58], [0, 16.5, 0], accent);
      for (const side of [-1, 1]) {
        const wing = addBox(model, [31, 62, 35], [side * 20, 47, 2], glass);
        wing.rotation.z = side * -0.035;
        addBox(model, [4, 64, 38], [side * 20, 48, -0.5], paleConcrete);
      }
      addBox(model, [24, 70, 30], [0, 52, 0], darkGlass);
      addBox(model, [82, 2.2, 62], [0, 80, 0], roof);
    } else if (landmark.kind === "brac") {
      halfWidth = 27;
      halfDepth = 24;
      addBox(model, [54, 12, 48], [0, 6, 0], concrete);
      addBox(model, [47, 63, 39], [0, 43.5, 0], brick);
      addBox(model, [9, 65, 41], [7, 44.5, -0.5], darkGlass);
      addBox(model, [51, 2.5, 43], [0, 76, 0], roof);
      addWindowGrid(model, 5, 6, 7.2, 8.5, 20, -20.1);
    } else if (landmark.kind === "hotel") {
      halfWidth = 34;
      halfDepth = 27;
      addBox(model, [68, 10, 54], [0, 5, 0], paleConcrete);
      addBox(model, [51, 81, 34], [-5, 50.5, 0], paleConcrete);
      addBox(model, [6, 79, 36], [-5, 51, -18.5], glass);
      addBox(model, [22, 57, 23], [25, 38.5, 6], concrete);
      addBox(model, [55, 3, 38], [-5, 92.5, 0], roof);
      for (let y = 18; y < 88; y += 9) addBox(model, [53, 1, 36], [-5, y, 0], concrete);
    } else if (landmark.kind === "parliament") {
      halfWidth = 78;
      halfDepth = 70;
      addBox(model, [180, 1.2, 154], [0, 0.6, 0], lawn);
      addBox(model, [34, 0.8, 118], [-66, 1.3, 0], water);
      addBox(model, [34, 0.8, 118], [66, 1.3, 0], water);
      addCylinder(model, 39, 43, 50, [0, 27, 0], concrete, 8);
      addCylinder(model, 31, 36, 11, [0, 57.5, 0], concrete, 8);
      addCylinder(model, 25, 30, 6, [0, 66, 0], roof, 8);
      for (let index = 0; index < 8; index++) {
        const angle = index * Math.PI / 4;
        const x = Math.sin(angle) * 54;
        const z = Math.cos(angle) * 48;
        const block = addBox(model, [27, 42, 29], [x, 23, z], concrete);
        block.rotation.y = angle;
      }
      addRoundInset(model, 12, [0, 31, -43.2]);
      addRoundInset(model, 9, [0, 30, 43.2], "back");
      addRoundInset(model, 9, [-43.2, 28, 0], "left");
      addRoundInset(model, 9, [43.2, 28, 0], "right");
      addBox(model, [13, 28, 1.2], [-24, 27, -43.1], recess);
      addBox(model, [13, 28, 1.2], [24, 27, -43.1], recess);
      addBox(model, [70, 2, 24], [0, 2.2, -72], brick);
    } else if (landmark.kind === "lalbagh-fort") {
      halfWidth = 88;
      halfDepth = 58;
      addBox(model, [176, 1, 116], [0, 0.5, 0], lawn);
      addBox(model, [176, 5, 3], [0, 3, -57], redBrick);
      addBox(model, [176, 5, 3], [0, 3, 57], redBrick);
      addBox(model, [3, 5, 116], [-87, 3, 0], redBrick);
      addBox(model, [3, 5, 116], [87, 3, 0], redBrick);
      addBox(model, [7, 0.8, 100], [0, 1.1, 0], water);
      addBox(model, [142, 0.8, 7], [0, 1.1, 0], water);
      addBox(model, [37, 12, 29], [0, 7, 0], whiteStone);
      addBox(model, [27, 7, 20], [0, 16.5, 0], paleConcrete);
      addDome(model, 10, [0, 20, 0], whiteStone);
      for (const x of [-13, 13]) for (const z of [-9, 9]) addDome(model, 3.4, [x, 14, z], whiteStone);
      addBox(model, [50, 10, 27], [-57, 6, 0], redBrick);
      for (const x of [-69, -57, -45]) addDome(model, 6, [x, 11, 0], whiteStone);
      addBox(model, [47, 13, 29], [58, 7.5, 0], redBrick);
      addBox(model, [18, 7, 5], [58, 8, -17], recess);
      for (const x of [-73, 73]) addCylinder(model, 3.2, 4.2, 10, [x, 6, -43], redBrick, 8);
    } else if (landmark.kind === "ahsan-manzil") {
      halfWidth = 54;
      halfDepth = 33;
      addBox(model, [106, 3, 66], [0, 1.5, 0], lawn);
      addBox(model, [94, 18, 34], [0, 11, 3], pinkPlaster);
      addBox(model, [37, 23, 42], [0, 18.5, 0], pinkPlaster);
      addBox(model, [58, 3, 9], [0, 3.5, -26], paleConcrete);
      addBox(model, [49, 3, 8], [0, 6.5, -21.5], paleConcrete);
      addBox(model, [40, 3, 7], [0, 9.5, -17], paleConcrete);
      for (const x of [-38, -25, -12, 12, 25, 38]) addBox(model, [2.3, 15, 2.3], [x, 13, -15], whiteStone);
      addCylinder(model, 10, 12, 7, [0, 32.5, 0], whiteStone, 16);
      addDome(model, 10, [0, 36, 0], pinkPlaster);
      addCylinder(model, 0.6, 1.1, 5, [0, 47, 0], accent, 8);
      addWindowGrid(model, 7, 2, 12.5, 8.5, 10, -14.5, recess);
    } else if (landmark.kind === "shaheed-minar") {
      halfWidth = 42;
      halfDepth = 26;
      addBox(model, [86, 2.5, 50], [0, 1.25, 0], paleConcrete);
      addBox(model, [76, 1.5, 8], [0, 3.25, -18], whiteStone);
      addRoundInset(model, 11, [0, 20, 4]);
      const sun = model.children.at(-1);
      if (sun instanceof THREE.Mesh) sun.material = monumentRed;
      for (const index of [-2, -1, 0, 1, 2]) {
        const pillar = addBox(model, [5.2, index === 0 ? 30 : 25, 4], [index * 12, index === 0 ? 18 : 15.5, -2], whiteStone);
        pillar.rotation.z = index * -0.045;
        addBox(model, [9, 2.2, 4.5], [index * 12, index === 0 ? 31 : 26, -2], whiteStone).rotation.z = index * -0.045;
      }
    } else if (landmark.kind === "curzon-hall") {
      halfWidth = 57;
      halfDepth = 32;
      addBox(model, [114, 2, 62], [0, 1, 0], lawn);
      addBox(model, [104, 18, 32], [0, 11, 0], redBrick);
      addBox(model, [38, 26, 38], [0, 16, -1], redBrick);
      for (const x of [-43, 43]) {
        addCylinder(model, 7, 8.5, 24, [x, 14, -2], redBrick, 12);
        addDome(model, 7, [x, 26, -2], whiteStone);
      }
      addCylinder(model, 10, 12, 8, [0, 31, -1], whiteStone, 12);
      addDome(model, 10, [0, 35, -1], redBrick);
      for (const x of [-36, -24, -12, 0, 12, 24, 36]) addBox(model, [6, 9, 1], [x, 12, -16.5], recess);
      addBox(model, [108, 2, 36], [0, 21, 0], whiteStone);
    } else if (landmark.kind === "baitul-mukarram") {
      halfWidth = 45;
      halfDepth = 39;
      addBox(model, [96, 2, 84], [0, 1, 0], paleConcrete);
      addBox(model, [78, 44, 68], [0, 24, 0], whiteStone);
      addBox(model, [48, 36, 2], [0, 21, -34.5], paleConcrete);
      addBox(model, [16, 27, 1], [0, 19, -35.8], recess);
      for (const x of [-27, -18, -9, 9, 18, 27]) {
        addBox(model, [5.5, 12, 1], [x, 13, -35.8], recess);
        addBox(model, [7.5, 2, 1.2], [x, 20, -35.9], recess);
      }
      addBox(model, [82, 3, 72], [0, 47.5, 0], paleConcrete);
      for (const x of [-33, 33]) for (const z of [-28, 28]) addCylinder(model, 2.2, 3, 8, [x, 53, z], whiteStone, 8);
    }

    colliders.push({ x: world.x, z: world.y, halfWidth, halfDepth, top: landmark.altitude + 2 });
    const perch = {
      position: new THREE.Vector3(world.x, landmark.altitude, world.y),
      label: landmark.label,
      heading: landmark.heading,
    };
    perches.push(perch);
    addLabel(perch.position.clone().add(new THREE.Vector3(0, 28, 0)), landmark.label);
  }

  scene.add(root);
  scene.userData.landmarkColliders = colliders;
  scene.userData.landmarkRoot = root;
  return { colliders, perches };
}

function addCity(scene: THREE.Scene) {
  const random = seededRandom();
  const colliders: BuildingCollider[] = [];
  const fallbackWorld = new THREE.Group();
  fallbackWorld.name = "Procedural map fallback";
  scene.add(fallbackWorld);
  scene.userData.fallbackWorld = fallbackWorld;
  const proceduralBuildings = new THREE.Group();
  proceduralBuildings.name = "Procedural building fallback";
  fallbackWorld.add(proceduralBuildings);
  scene.userData.proceduralBuildings = proceduralBuildings;
  const sharedBox = new RoundedBoxGeometry(1, 1, 1, 2, 0.055);
  const unitBox = new THREE.BoxGeometry(1, 1, 1);

  const makeGroundTexture = () => {
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = 192;
    const context = canvas.getContext("2d");
    if (!context) return null;
    context.fillStyle = "#8c9d72";
    context.fillRect(0, 0, canvas.width, canvas.height);
    for (let i = 0; i < 3600; i++) {
      const lightness = 34 + Math.floor(random() * 18);
      context.fillStyle = `hsla(${82 + random() * 20}, 15%, ${lightness}%, ${0.06 + random() * 0.1})`;
      const size = 1 + random() * 3.5;
      context.fillRect(random() * canvas.width, random() * canvas.height, size, size);
    }
    context.lineWidth = 1;
    for (let contour = 0; contour < 14; contour++) {
      const baseY = 8 + contour * 14;
      context.beginPath();
      for (let x = 0; x <= canvas.width; x += 4) {
        const y = baseY + Math.sin(x * 0.055 + contour * 0.9) * 3.2 + Math.sin(x * 0.13) * 1.2;
        if (x === 0) context.moveTo(x, y);
        else context.lineTo(x, y);
      }
      context.strokeStyle = contour % 3 === 0 ? "rgba(123, 62, 48, .16)" : "rgba(29, 66, 55, .12)";
      context.stroke();
    }
    for (let field = 0; field < 18; field++) {
      context.fillStyle = field % 2 === 0 ? "rgba(232, 167, 71, .07)" : "rgba(196, 71, 85, .055)";
      context.fillRect(random() * canvas.width, random() * canvas.height, 7 + random() * 17, 4 + random() * 10);
    }
    const texture = new THREE.CanvasTexture(canvas);
    texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
    texture.repeat.set(76, 76);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = 4;
    return texture;
  };

  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(26_000, 26_000),
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
    new THREE.MeshPhysicalMaterial({ color: 0x397f88, roughness: 0.24, metalness: 0.02, clearcoat: 0.7, clearcoatRoughness: 0.28 }),
  );
  water.rotation.x = -Math.PI / 2;
  water.position.y = 0.45;
  water.receiveShadow = true;
  water.name = "Hatirjheel Lake";
  fallbackWorld.add(water);

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
    fallbackWorld.add(ribbon);
    waterRibbons.push(ribbon);
  }
  scene.userData.waterRibbons = waterRibbons;

  const roadMaterial = new THREE.MeshStandardMaterial({ color: 0x303a38, roughness: 0.97 });
  const lineMaterial = new THREE.MeshStandardMaterial({ color: 0xd9c277, roughness: 0.9 });
  const concreteMaterial = new THREE.MeshStandardMaterial({ color: 0xb9af99, roughness: 0.96 });
  const curbGeometry = new THREE.BoxGeometry(2200, 1.4, 3.2);
  for (const z of [-285, 285]) {
    const road = new THREE.Mesh(new THREE.BoxGeometry(2200, 1.1, 38), roadMaterial);
    road.position.set(0, 0.55, z);
    road.receiveShadow = true;
    fallbackWorld.add(road);
    for (let x = -1050; x < 1050; x += 55) {
      const line = new THREE.Mesh(new THREE.BoxGeometry(26, 0.15, 1.5), lineMaterial);
      line.position.set(x, 1.15, z);
      fallbackWorld.add(line);
    }
    for (const side of [-1, 1]) {
      const curb = new THREE.Mesh(curbGeometry, concreteMaterial);
      curb.position.set(0, 1.05, z + side * 21);
      curb.receiveShadow = true;
      fallbackWorld.add(curb);
    }
  }

  scene.userData.trafficSimulation = createTrafficSimulation(fallbackWorld, [
    { id: -1, points: [[-1_100, -281], [1_100, -281]], kind: "primary", name: "Hatirjheel north road" },
    { id: -2, points: [[1_100, 281], [-1_100, 281]], kind: "primary", name: "Hatirjheel south road" },
  ], 24);

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
  fallbackWorld.add(lampPosts);

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
    fallbackWorld.add(bridge);
  }

  const buildingColors = [0xd2c5aa, 0xb7bdb4, 0xc3977f, 0x9eaa9d, 0xd8d3c2, 0xaa826d];
  const buildingMaterials = buildingColors.map((color) => new THREE.MeshStandardMaterial({ color, roughness: 0.88, metalness: 0.01 }));
  const facadeMaterials = buildingColors.map((color) => new THREE.MeshStandardMaterial({ color: new THREE.Color(color).multiplyScalar(0.82), roughness: 0.93 }));
  const rooftopMaterial = new THREE.MeshStandardMaterial({ color: 0x5d6863, roughness: 0.94 });
  const tankMaterials = [0x526a64, 0xa27c66, 0x557d83].map((color) => new THREE.MeshStandardMaterial({ color, roughness: 0.82 }));
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
      proceduralBuildings.add(building);
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
  proceduralBuildings.add(windowMesh);

  const treeTrunk = new THREE.CylinderGeometry(1.1, 1.65, 7.5, 6);
  const treeTop = new THREE.IcosahedronGeometry(1, 1);
  const trunkMaterial = new THREE.MeshStandardMaterial({ color: 0x6f5547, roughness: 1 });
  const leafMaterials = [0x3f684a, 0x567b53, 0x7d8e59].map((color) => new THREE.MeshStandardMaterial({ color, roughness: 1 }));
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
  fallbackWorld.add(trunks);
  foliageMatrices.forEach((transforms, materialIndex) => {
    const foliage = new THREE.InstancedMesh(treeTop, leafMaterials[materialIndex], transforms.length);
    transforms.forEach((transform, index) => foliage.setMatrixAt(index, transform));
    foliage.instanceMatrix.needsUpdate = true;
    foliage.castShadow = true;
    fallbackWorld.add(foliage);
  });

  const landmarkWorld = addPersistentDhakaLandmarks(scene);
  colliders.push(...landmarkWorld.colliders);

  const perches: Perch[] = AREA_LANDMARKS.map((landmark) => {
    const world = coordinatesToWorld(landmark.lat, landmark.lon);
    return {
      position: new THREE.Vector3(world.x, landmark.altitude, world.y),
      label: landmark.label,
      heading: landmark.heading,
    };
  }).concat(landmarkWorld.perches);
  const areaLabels = new THREE.Group();
  areaLabels.name = "Greater Dhaka area labels";
  for (const [index, landmark] of AREA_LANDMARKS.entries()) {
    const canvas = document.createElement("canvas");
    canvas.width = 384;
    canvas.height = 80;
    const context = canvas.getContext("2d");
    if (!context) continue;
    context.fillStyle = "rgba(247, 222, 171, 0.92)";
    context.fillRect(2, 2, 380, 76);
    context.strokeStyle = "rgba(196, 71, 85, 0.9)";
    context.lineWidth = 3;
    context.strokeRect(3.5, 3.5, 377, 73);
    context.fillStyle = "#243b35";
    context.font = "600 29px monospace";
    context.textAlign = "center";
    context.textBaseline = "middle";
    context.fillText(landmark.label.toUpperCase(), 192, 41);
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.minFilter = THREE.LinearFilter;
    const label = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, transparent: true, depthWrite: false, toneMapped: false }));
    label.position.copy(perches[index].position).add(new THREE.Vector3(0, 22, 0));
    label.scale.set(72, 15, 1);
    areaLabels.add(label);
  }
  scene.add(areaLabels);
  const waterLabels = new THREE.Group();
  waterLabels.name = "Greater Dhaka waterway labels";
  for (const landmark of WATER_LANDMARKS) {
    const canvas = document.createElement("canvas");
    canvas.width = 448;
    canvas.height = 80;
    const context = canvas.getContext("2d");
    if (!context) continue;
    context.fillStyle = "rgba(43, 139, 151, 0.9)";
    context.fillRect(2, 2, 444, 76);
    context.strokeStyle = "rgba(255, 224, 135, 0.92)";
    context.lineWidth = 3;
    context.strokeRect(3.5, 3.5, 441, 73);
    context.fillStyle = "#fff0c4";
    context.font = "600 27px monospace";
    context.textAlign = "center";
    context.textBaseline = "middle";
    context.fillText(landmark.label.toUpperCase(), 224, 41);
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.minFilter = THREE.LinearFilter;
    const label = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, transparent: true, depthWrite: false, toneMapped: false }));
    const world = coordinatesToWorld(landmark.lat, landmark.lon);
    label.position.set(world.x, 20, world.y);
    label.scale.set(86, 15, 1);
    waterLabels.add(label);
  }
  scene.add(waterLabels);
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
    marker.renderOrder = 20;
    const markerMaterial = new THREE.MeshBasicMaterial({
      color: 0xd8ff62,
      transparent: true,
      opacity: 0.68,
      depthTest: false,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      toneMapped: false,
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
      new THREE.MeshBasicMaterial({ color: 0xd8ff62, transparent: true, opacity: 0.16, depthTest: false, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, toneMapped: false }),
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
  for (let i = 0; i < 14; i++) {
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

function polygonShape(points: MapPoint[]) {
  const shape = new THREE.Shape();
  points.forEach(([x, z], index) => {
    if (index === 0) shape.moveTo(x, -z);
    else shape.lineTo(x, -z);
  });
  shape.closePath();
  return shape;
}

async function mergeIntoMeshBatches(
  group: THREE.Group,
  geometries: THREE.BufferGeometry[],
  material: THREE.Material,
  name: string,
  isCancelled: () => boolean,
  shadows = false,
  batchSize = 160,
) {
  if (geometries.length === 0) return;
  const yieldIfNeeded = createMainThreadYielder();
  for (let start = 0; start < geometries.length; start += batchSize) {
    const batch = geometries.slice(start, start + batchSize);
    const merged = mergeGeometries(batch, false);
    batch.forEach((geometry) => geometry.dispose());
    if (merged) {
      const mesh = new THREE.Mesh(merged, material);
      mesh.name = `${name} ${Math.floor(start / batchSize) + 1}`;
      mesh.castShadow = shadows;
      mesh.receiveShadow = true;
      group.add(mesh);
    }
    await yieldIfNeeded(isCancelled);
  }
}

async function selectSpatiallyEvenBuildings(
  buildings: OsmMapData["buildings"],
  isCancelled: () => boolean,
  budget = 2_600,
) {
  const tileSize = 380;
  const perTile = 9;
  const tiles = new Map<string, Array<{ building: OsmMapData["buildings"][number]; score: number }>>();
  const yieldIfNeeded = createMainThreadYielder();
  for (const building of buildings) {
    await yieldIfNeeded(isCancelled);
    if (building.points.length < 3 || building.points.length > 96) continue;
    let x = 0;
    let z = 0;
    for (const point of building.points) {
      x += point[0];
      z += point[1];
    }
    x /= building.points.length;
    z /= building.points.length;
    if (Math.abs(x) > FLIGHT_EXTENT.x + 500 || Math.abs(z) > FLIGHT_EXTENT.z + 500) continue;
    const key = `${Math.floor(x / tileSize)}:${Math.floor(z / tileSize)}`;
    const score = Math.abs(Math.imul(building.id || 1, 2_654_435_761));
    const entries = tiles.get(key) ?? [];
    if (entries.length < perTile) {
      entries.push({ building, score });
      tiles.set(key, entries);
      continue;
    }
    let worstIndex = 0;
    for (let index = 1; index < entries.length; index++) {
      if (entries[index].score > entries[worstIndex].score) worstIndex = index;
    }
    if (score < entries[worstIndex].score) entries[worstIndex] = { building, score };
  }
  const tileEntries = [...tiles.values()];
  const selected: OsmMapData["buildings"] = [];
  for (let index = 0; index < perTile && selected.length < budget; index++) {
    for (const entries of tileEntries) {
      if (entries[index]) selected.push(entries[index].building);
      if (selected.length >= budget) break;
    }
    await yieldIfNeeded(isCancelled);
  }
  return selected;
}

async function addOpenStreetMapWorld(scene: THREE.Scene, data: OsmMapData, isCancelled: () => boolean) {
  const root = new THREE.Group();
  root.name = "Live OpenStreetMap world";
  scene.add(root);
  const colliders: BuildingCollider[] = [];
  const yieldIfNeeded = createMainThreadYielder();

  const waterAreas: THREE.BufferGeometry[] = [];
  const waterLines: THREE.BufferGeometry[] = [];
  for (const feature of data.water) {
    if (feature.area && feature.points.length >= 3) {
      const geometry = new THREE.ShapeGeometry(polygonShape(feature.points));
      geometry.rotateX(-Math.PI / 2);
      geometry.translate(0, 0.68, 0);
      waterAreas.push(geometry);
      continue;
    }
    for (let index = 1; index < feature.points.length; index++) {
      const [x1, z1] = feature.points[index - 1];
      const [x2, z2] = feature.points[index];
      const length = Math.hypot(x2 - x1, z2 - z1);
      if (length < 1) continue;
      const geometry = new THREE.BoxGeometry(length, 0.24, 8);
      geometry.rotateY(-Math.atan2(z2 - z1, x2 - x1));
      geometry.translate((x1 + x2) / 2, 0.74, (z1 + z2) / 2);
      waterLines.push(geometry);
    }
    await yieldIfNeeded(isCancelled);
  }
  const waterMaterial = new THREE.MeshPhysicalMaterial({ color: 0x397f88, roughness: 0.24, metalness: 0.02, clearcoat: 0.7, clearcoatRoughness: 0.28 });
  await mergeIntoMeshBatches(root, waterAreas, waterMaterial, "OSM water areas", isCancelled);
  await mergeIntoMeshBatches(root, waterLines, waterMaterial, "OSM waterways", isCancelled);

  const roadBuckets: THREE.BufferGeometry[][] = [[], [], []];
  const majorRoads = new Set(["motorway", "trunk", "primary", "secondary"]);
  const localRoads = new Set(["tertiary", "residential", "unclassified", "service"]);
  for (const road of data.roads) {
    const bucket = majorRoads.has(road.kind) ? 0 : localRoads.has(road.kind) ? 1 : 2;
    const width = bucket === 0 ? 13 : bucket === 1 ? 7 : 3.8;
    for (let index = 1; index < road.points.length; index++) {
      const [x1, z1] = road.points[index - 1];
      const [x2, z2] = road.points[index];
      const length = Math.hypot(x2 - x1, z2 - z1);
      if (length < 1) continue;
      const geometry = new THREE.BoxGeometry(length + 0.6, 0.3, width);
      geometry.rotateY(-Math.atan2(z2 - z1, x2 - x1));
      geometry.translate((x1 + x2) / 2, 0.92, (z1 + z2) / 2);
      roadBuckets[bucket].push(geometry);
    }
    await yieldIfNeeded(isCancelled);
  }
  const roadMaterials = [0x303a38, 0x46514d, 0x69716a].map((color) => new THREE.MeshStandardMaterial({ color, roughness: 0.96 }));
  for (let index = 0; index < roadBuckets.length; index++) {
    await mergeIntoMeshBatches(root, roadBuckets[index], roadMaterials[index], `OSM roads ${index}`, isCancelled);
  }

  const buildingBuckets: THREE.BufferGeometry[][] = [[], [], [], []];
  // The full Dhaka payload can contain tens of thousands of footprints. Keep the
  // live mesh deterministic and geographically even; procedural tiles fill the gaps.
  for (const building of await selectSpatiallyEvenBuildings(data.buildings, isCancelled)) {
    if (building.points.length < 3) continue;
    const geometry = new THREE.ExtrudeGeometry(polygonShape(building.points), {
      depth: building.height,
      bevelEnabled: false,
      curveSegments: 1,
    });
    geometry.rotateX(-Math.PI / 2);
    buildingBuckets[Math.abs(building.id) % buildingBuckets.length].push(geometry);
    const xs = building.points.map(([x]) => x);
    const zs = building.points.map(([, z]) => z);
    const minX = Math.min(...xs);
    const maxX = Math.max(...xs);
    const minZ = Math.min(...zs);
    const maxZ = Math.max(...zs);
    colliders.push({
      x: (minX + maxX) / 2,
      z: (minZ + maxZ) / 2,
      halfWidth: Math.max(2, (maxX - minX) / 2),
      halfDepth: Math.max(2, (maxZ - minZ) / 2),
      top: building.height,
    });
    await yieldIfNeeded(isCancelled);
  }
  const buildingMaterials = [0xcdbfa5, 0xb5bdb3, 0xc28f76, 0x9daa9d].map(
    (color) => new THREE.MeshStandardMaterial({ color, roughness: 0.88, metalness: 0.01 }),
  );
  // Nearby procedural towers and landmarks provide local shadows. Keeping the
  // four citywide merged meshes out of the shadow pass avoids redrawing the
  // entire map into the large directional-light shadow camera every frame.
  for (let index = 0; index < buildingBuckets.length; index++) {
    await mergeIntoMeshBatches(root, buildingBuckets[index], buildingMaterials[index], `OSM buildings ${index}`, isCancelled);
  }

  if (colliders.length === 0) {
    root.traverse((object) => {
      if (object instanceof THREE.Mesh) {
        object.geometry.dispose();
        object.material.dispose();
      }
    });
    scene.remove(root);
    return null;
  }
  const trafficSimulation = createTrafficSimulation(root, data.roads);
  if (trafficSimulation) {
    const fallbackTraffic = scene.userData.trafficSimulation as TrafficSimulation | null | undefined;
    fallbackTraffic?.dispose();
    scene.userData.trafficSimulation = trafficSimulation;
  }
  const fallback = scene.userData.fallbackWorld as THREE.Group | undefined;
  if (fallback) fallback.visible = false;
  return colliders;
}

export function BirdFlight() {
  const mountRef = useRef<HTMLDivElement>(null);
  const speedRef = useRef<HTMLSpanElement>(null);
  const altitudeRef = useRef<HTMLSpanElement>(null);
  const verticalSpeedRef = useRef<HTMLSpanElement>(null);
  const compassRef = useRef<HTMLSpanElement>(null);
  const flightModeRef = useRef<HTMLSpanElement>(null);
  const flightEffectRef = useRef<HTMLDivElement>(null);
  const mapBirdRef = useRef<HTMLDivElement>(null);
  const perchPromptRef = useRef<HTMLDivElement>(null);
  const perchLabelRef = useRef<HTMLSpanElement>(null);
  const flyingRef = useRef(false);
  const pausedRef = useRef(false);
  const restingRef = useRef(false);
  const cameraModeRef = useRef<CameraMode>("CHASE");
  const audioRef = useRef<FlightAudio | null>(null);
  const radioRef = useRef<FlightRadio | null>(null);
  const [flying, setFlying] = useState(false);
  const [paused, setPaused] = useState(false);
  const [resting, setResting] = useState(false);
  const [cameraMode, setCameraMode] = useState<CameraMode>("CHASE");
  const [controlsOpen, setControlsOpen] = useState(false);
  const [soundOn, setSoundOn] = useState(false);
  const [radioOpen, setRadioOpen] = useState(false);
  const [radioStatus, setRadioStatus] = useState<RadioStatus>("off");
  const [radioStationIndex, setRadioStationIndex] = useState(0);
  const [radioVolume, setRadioVolume] = useState(0.58);
  const [mapStatus, setMapStatus] = useState<MapStatus>("loading");
  const [weatherStatus, setWeatherStatus] = useState<WeatherStatus>("loading");
  const [weather, setWeather] = useState<WeatherSnapshot>(DEFAULT_WEATHER);
  const selectedRadioStation = RADIO_STATIONS[radioStationIndex];

  const tuneRadio = useCallback((stationIndex: number) => {
    const nextIndex = (stationIndex + RADIO_STATIONS.length) % RADIO_STATIONS.length;
    setRadioStationIndex(nextIndex);
    void radioRef.current?.tune(RADIO_STATIONS[nextIndex]);
  }, []);

  const toggleRadio = useCallback(() => {
    if (["playing", "buffering", "paused"].includes(radioStatus)) {
      radioRef.current?.stop();
      return;
    }
    void radioRef.current?.tune(RADIO_STATIONS[radioStationIndex]);
  }, [radioStationIndex, radioStatus]);

  const cycleRadio = useCallback((direction: number) => {
    tuneRadio(radioStationIndex + direction);
  }, [radioStationIndex, tuneRadio]);

  useEffect(() => {
    const radio = createFlightRadio(setRadioStatus);
    radio.setVolume(0.58);
    radioRef.current = radio;
    return () => {
      radio.dispose();
      radioRef.current = null;
    };
  }, []);

  useEffect(() => {
    audioRef.current?.setRadioDucking(radioStatus === "playing" || radioStatus === "buffering");
  }, [radioStatus]);

  useEffect(() => {
    if (!flying) return;
    if (paused) radioRef.current?.pause();
    else void radioRef.current?.resume();
  }, [flying, paused]);

  useEffect(() => {
    const onRadioKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target?.matches("input, textarea, select, [contenteditable='true']")) return;
      if (event.code === "KeyR" && !event.repeat) {
        event.preventDefault();
        toggleRadio();
      }
      if (event.code === "BracketLeft" && !event.repeat) {
        event.preventDefault();
        cycleRadio(-1);
      }
      if (event.code === "BracketRight" && !event.repeat) {
        event.preventDefault();
        cycleRadio(1);
      }
    };
    window.addEventListener("keydown", onRadioKey);
    return () => window.removeEventListener("keydown", onRadioKey);
  }, [cycleRadio, toggleRadio]);

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;
    const flightAudio = createFlightAudio();
    audioRef.current = flightAudio;
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x91c7c0);
    scene.fog = new THREE.FogExp2(0x91b8a8, 0.00028);
    const camera = new THREE.PerspectiveCamera(58, mount.clientWidth / mount.clientHeight, 0.5, 8000);
    const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: "high-performance" });
    renderer.setSize(mount.clientWidth, mount.clientHeight);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFShadowMap;
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1;
    mount.appendChild(renderer.domElement);

    const sky = new Sky();
    sky.scale.setScalar(15_000);
    const skyUniforms = sky.material.uniforms;
    skyUniforms.turbidity.value = 5.8;
    skyUniforms.rayleigh.value = 3.15;
    skyUniforms.mieCoefficient.value = 0.0035;
    skyUniforms.mieDirectionalG.value = 0.84;
    const sunPosition = new THREE.Vector3().setFromSphericalCoords(1, THREE.MathUtils.degToRad(63), THREE.MathUtils.degToRad(232));
    skyUniforms.sunPosition.value.copy(sunPosition);
    scene.add(sky);

    const hemisphere = new THREE.HemisphereLight(0xe8f3ee, 0x5d6c58, 1.8);
    scene.add(hemisphere);
    const sun = new THREE.DirectionalLight(0xffd6a0, 3.35);
    sun.position.set(-400, 650, 280);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    sun.shadow.camera.left = -3400;
    sun.shadow.camera.right = 3400;
    sun.shadow.camera.top = 3800;
    sun.shadow.camera.bottom = -3800;
    sun.shadow.camera.far = 4200;
    sun.shadow.bias = -0.00012;
    sun.shadow.normalBias = 0.035;
    scene.add(sun);
    const skyFill = new THREE.DirectionalLight(0x9bc8d2, 0.48);
    skyFill.position.set(500, 260, -600);
    scene.add(skyFill);

    const buildingColliders = addCity(scene);
    let buildingColliderGrid = buildColliderGrid(buildingColliders);
    const mapRequestStartedAt = performance.now();
    void fetch("/api/osm")
      .then(async (response) => {
        if (!response.ok) throw new Error(`Map request failed with ${response.status}`);
        return await response.json() as OsmMapData;
      })
      .then(async (data) => {
        if (disposed) return;
        const mapBuildStartedAt = performance.now();
        const osmColliders = await addOpenStreetMapWorld(scene, data, () => disposed);
        if (!osmColliders) throw new Error("OpenStreetMap response contained no usable buildings");
        const landmarkColliders = scene.userData.landmarkColliders as BuildingCollider[] | undefined ?? [];
        const proceduralColliders = await addProceduralDistrictTiles(
          scene,
          data,
          [...osmColliders, ...landmarkColliders],
          crow.position,
          () => disposed,
        );
        buildingColliders.splice(0, buildingColliders.length, ...osmColliders, ...proceduralColliders, ...landmarkColliders);
        buildingColliderGrid = await buildColliderGridAsync(buildingColliders, () => disposed);
        if (disposed) return;
        renderer.domElement.dataset.mapRequestMs = (performance.now() - mapRequestStartedAt).toFixed(1);
        renderer.domElement.dataset.mapBuildMs = (performance.now() - mapBuildStartedAt).toFixed(1);
        setMapStatus("live");
      })
      .catch(async () => {
        if (disposed) return;
        if (!(scene.userData.proceduralDistrictTiles as ProceduralDistrictTile[] | undefined)?.length) {
          const emptyMap: OsmMapData = {
            source: "OpenStreetMap",
            fetchedAt: new Date().toISOString(),
            buildings: [],
            roads: [],
            water: [],
          };
          const proceduralColliders = await addProceduralDistrictTiles(
            scene,
            emptyMap,
            buildingColliders,
            crow.position,
            () => disposed,
          );
          if (disposed) return;
          buildingColliders.push(...proceduralColliders);
          buildingColliderGrid = await buildColliderGridAsync(buildingColliders, () => disposed);
        }
        setMapStatus("fallback");
      })
      .catch(() => {
        if (!disposed) setMapStatus("fallback");
      });

    const crow = new THREE.Group();
    crow.name = "PlayerCrow";
    const spawnWorld = coordinatesToWorld(23.7595, 90.4105);
    crow.position.set(spawnWorld.x, DEFAULT_FLIGHT_ALTITUDE, spawnWorld.y);
    scene.add(crow);
    const airflowVfx = createAirflowVfx(crow);
    const weatherVfx = createWeatherVfx(scene, renderer, sky, hemisphere, sun, skyFill, reducedMotion);
    weatherVfx.apply(DEFAULT_WEATHER);
    const weatherController = new AbortController();
    const loadWeather = () => {
      void fetch("/api/weather", { signal: weatherController.signal })
        .then(async (response) => {
          if (!response.ok) throw new Error(`Weather request failed with ${response.status}`);
          return await response.json() as WeatherSnapshot;
        })
        .then((snapshot) => {
          if (disposed || !["clear", "cloudy", "fog", "drizzle", "rain", "storm"].includes(snapshot.mode)) return;
          weatherVfx.apply(snapshot);
          setWeather(snapshot);
          setWeatherStatus("live");
        })
        .catch((error: unknown) => {
          if (disposed || (error instanceof DOMException && error.name === "AbortError")) return;
          setWeatherStatus("fallback");
        });
    };
    loadWeather();
    const weatherRefresh = window.setInterval(loadWeather, 10 * 60 * 1_000);
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
          const sourceMaterials = Array.isArray(object.material) ? object.material : [object.material];
          const toonMaterials = sourceMaterials.map((material) => new THREE.MeshToonMaterial({
            color: material.color?.clone() ?? new THREE.Color(0x1b2b2a),
            map: material.map ?? null,
          }));
          object.material = Array.isArray(object.material) ? toonMaterials : toonMaterials[0];
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

    let maxFrameMs = 0;
    let longFrames = 0;
    (window as BirdFlightWindow).__birdFlightDiagnostics = () => {
      const trafficSimulation = scene.userData.trafficSimulation as TrafficSimulation | null | undefined;
      return {
        calls: renderer.info.render.calls,
        triangles: renderer.info.render.triangles,
        geometries: renderer.info.memory.geometries,
        textures: renderer.info.memory.textures,
        objects: scene.children.reduce((count, child) => count + 1 + child.children.length, 0),
        proceduralTiles: (scene.userData.proceduralDistrictTiles as ProceduralDistrictTile[] | undefined)?.length ?? 0,
        visibleTiles: (scene.userData.proceduralDistrictTiles as ProceduralDistrictTile[] | undefined)?.filter((tile) => tile.group.visible).length ?? 0,
        maxFrameMs,
        longFrames,
        mapBuildMs: Number.parseFloat(renderer.domElement.dataset.mapBuildMs ?? "") || null,
        trafficVehicles: trafficSimulation?.vehicleCount ?? 0,
        trafficTickHz: trafficSimulation?.tickHz ?? 0,
      };
    };

    const keys = new Set<string>();
    let yaw = 0.15;
    let yawRate = 0;
    let pitch = 0;
    let roll = 0;
    let speed = CRUISE_SPEED;
    let verticalSpeed = 0;
    let flapKick = 0;
    let cameraKick = 0;
    let lastFrame = performance.now();
    let elapsedTime = 0;
    let diagnosticFrame = 0;
    const desiredCamera = new THREE.Vector3();
    const desiredTarget = new THREE.Vector3();
    const forward = new THREE.Vector3();
    const horizontalForward = new THREE.Vector3();
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
        cameraKick = 1;
        const flapLiftScale = THREE.MathUtils.smoothstep(
          MAX_FLIGHT_ALTITUDE - crow.position.y,
          0,
          CEILING_EASE_DEPTH,
        );
        verticalSpeed = Math.min(22, verticalSpeed + 8.5 * flapLiftScale);
        speed = Math.max(BRAKE_SPEED, speed - 1.6);
        flightAudio.flap();
      }
      if (event.code === "KeyE" && !event.repeat && flyingRef.current && !pausedRef.current) {
        if (restingRef.current) {
          restingRef.current = false;
          setResting(false);
          crow.position.y += 5;
          speed = 34;
          verticalSpeed = 9;
          pitch = 0.2;
          flapKick = 1;
          cameraKick = 1;
          flightAudio.flap();
        } else if (nearestPerch) {
          restingRef.current = true;
          setResting(true);
          crow.position.copy(nearestPerch.position).add(new THREE.Vector3(0, 1.28, 0));
          yaw = nearestPerch.heading;
          yawRate = 0;
          pitch = 0;
          roll = 0;
          speed = 0;
          verticalSpeed = 0;
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

    camera.position.copy(crow.position).add(new THREE.Vector3(10, 13, 26));
    cameraTarget.copy(crow.position);
    let animation = 0;
    const animate = () => {
      animation = requestAnimationFrame(animate);
      const now = performance.now();
      const frameMs = now - lastFrame;
      const dt = Math.min(frameMs / 1000, 0.035);
      lastFrame = now;
      if (flyingRef.current) {
        maxFrameMs = Math.max(maxFrameMs, frameMs);
        if (frameMs > 50) longFrames++;
      }
      elapsedTime += dt;
      const active = flyingRef.current && !pausedRef.current && !restingRef.current;
      const turn = active ? (keys.has("KeyA") || keys.has("ArrowLeft") ? 1 : 0) - (keys.has("KeyD") || keys.has("ArrowRight") ? 1 : 0) : 0;
      const climb = active ? (keys.has("KeyW") || keys.has("ArrowUp") ? 1 : 0) - (keys.has("KeyS") || keys.has("ArrowDown") ? 1 : 0) : 0;
      const boost = active && (keys.has("ShiftLeft") || keys.has("ShiftRight"));
      const braking = active && (keys.has("ControlLeft") || keys.has("ControlRight") || keys.has("KeyQ"));

      const targetYawRate = turn * (0.58 + speed / 180);
      yawRate = THREE.MathUtils.lerp(yawRate, targetYawRate, 1 - Math.pow(0.82, dt * 60));
      yaw += yawRate * dt;
      flapKick = Math.max(0, flapKick - dt * 1.8);
      cameraKick = Math.max(0, cameraKick - dt * 3.3);

      const speedAmountBeforeThrottle = clamp((speed - BRAKE_SPEED) / (BOOST_SPEED - BRAKE_SPEED), 0, 1);
      const ceilingClimbScale = THREE.MathUtils.smoothstep(
        MAX_FLIGHT_ALTITUDE - crow.position.y,
        0,
        CEILING_EASE_DEPTH,
      );
      const altitudeHeadroom = MAX_FLIGHT_ALTITUDE - crow.position.y;
      const effectiveClimb = climb > 0 ? climb * ceilingClimbScale : climb;
      const targetVerticalSpeed = !active
        ? (restingRef.current ? 0 : verticalSpeed)
        : climb > 0
          ? altitudeHeadroom <= 1
            ? 0
            : Math.max(
                MIN_CEILING_CLIMB_SPEED,
                (16 + speedAmountBeforeThrottle * 7) * ceilingClimbScale,
              )
          : climb < 0
            ? -19
            : -0.65;
      const verticalResponse = climb === 0
        ? 0.72
        : climb > 0 && ceilingClimbScale < 1
          ? THREE.MathUtils.lerp(4.6, 2.25, ceilingClimbScale)
          : 2.25;
      verticalSpeed = THREE.MathUtils.lerp(verticalSpeed, targetVerticalSpeed, 1 - Math.exp(-verticalResponse * dt));

      const trajectoryPitch = Math.atan2(verticalSpeed, Math.max(speed, 1));
      const targetPitch = clamp(trajectoryPitch * 0.78 + effectiveClimb * 0.11 + flapKick * 0.1, -0.42, 0.44);
      pitch = THREE.MathUtils.lerp(pitch, targetPitch, 1 - Math.pow(0.88, dt * 60));
      const targetRoll = turn * 0.48;
      roll = THREE.MathUtils.lerp(roll, targetRoll, 1 - Math.pow(0.8, dt * 60));
      const diveEnergy = clamp(-verticalSpeed * 0.68, 0, 13);
      const climbCost = clamp(verticalSpeed * 0.22, 0, 5.5);
      const targetSpeed = !active
        ? (restingRef.current ? 0 : speed)
        : braking
          ? BRAKE_SPEED
          : (boost ? BOOST_SPEED : CRUISE_SPEED) + diveEnergy - climbCost;
      const throttleResponse = braking ? 4.6 : boost ? 2.2 : 1.55;
      speed = THREE.MathUtils.lerp(speed, targetSpeed, 1 - Math.exp(-throttleResponse * dt));

      horizontalForward.set(-Math.sin(yaw), 0, -Math.cos(yaw));
      forward.set(horizontalForward.x, clamp(verticalSpeed / Math.max(speed, 1), -0.45, 0.45), horizontalForward.z).normalize();
      previousPosition.copy(crow.position);
      if (active) {
        crow.position.addScaledVector(horizontalForward, speed * dt);
        crow.position.y += verticalSpeed * dt;
      }
      let collided = false;
      if (!restingRef.current) {
        for (const building of collisionCandidates(buildingColliderGrid, crow.position.x, crow.position.z)) {
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
        verticalSpeed = Math.max(5, verticalSpeed);
        cameraKick = 0.7;
        speed = Math.max(28, speed * 0.82);
      }
      crow.position.y = Math.max(crow.position.y, MIN_FLIGHT_ALTITUDE);
      if (crow.position.y >= MAX_FLIGHT_ALTITUDE || (climb > 0 && crow.position.y >= MAX_FLIGHT_ALTITUDE - 1)) {
        crow.position.y = MAX_FLIGHT_ALTITUDE;
        verticalSpeed = Math.min(verticalSpeed, 0);
      }
      if (crow.position.y <= MIN_FLIGHT_ALTITUDE + 0.2) {
        pitch = Math.max(pitch, 0.16);
        verticalSpeed = Math.max(verticalSpeed, 7);
      }
      if (Math.abs(crow.position.x) > FLIGHT_EXTENT.x || Math.abs(crow.position.z) > FLIGHT_EXTENT.z) {
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
        const trafficSimulation = scene.userData.trafficSimulation as TrafficSimulation | null | undefined;
        trafficSimulation?.update(dt, frameMs);
        for (const cloud of scene.userData.clouds as THREE.Group[]) {
          cloud.position.x += (cloud.userData.weatherSpeed ?? cloud.userData.speed) * dt;
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
        const speedAmount = clamp((speed - BRAKE_SPEED) / (BOOST_SPEED - BRAKE_SPEED), 0, 1);
        const chaseDistance = 14.5 + speedAmount * 9;
        desiredCamera.copy(crow.position).addScaledVector(forward, -chaseDistance).add(new THREE.Vector3(0, 6.4 - cameraKick * 1.5, 0));
        desiredTarget.copy(crow.position).addScaledVector(forward, 13 + speedAmount * 10).add(new THREE.Vector3(0, 1.4 + verticalSpeed * 0.08, 0));
      } else {
        desiredCamera.copy(crow.position).addScaledVector(forward, 3.1).add(new THREE.Vector3(0, 1.2, 0));
        desiredTarget.copy(crow.position).addScaledVector(forward, 42).add(new THREE.Vector3(0, 1, 0));
      }
      const speedAmount = clamp((speed - BRAKE_SPEED) / (BOOST_SPEED - BRAKE_SPEED), 0, 1);
      if (!reducedMotion) {
        const shakeAmount = boost ? 0.16 * speedAmount : Math.max(0, speedAmount - 0.78) * 0.12;
        desiredCamera.x += Math.sin(elapsedTime * 43) * shakeAmount;
        desiredCamera.y += Math.sin(elapsedTime * 57 + 1.2) * shakeAmount * 0.65;
      }
      camera.position.lerp(desiredCamera, 1 - Math.pow(0.78, dt * 60));
      cameraTarget.lerp(desiredTarget, 1 - Math.pow(0.76, dt * 60));
      camera.lookAt(cameraTarget);
      const targetFov = reducedMotion ? 58 : 52 + speedAmount * 13 + (boost ? 5 : 0) + clamp(Math.abs(verticalSpeed) / 20, 0, 1) * 2;
      const nextFov = THREE.MathUtils.lerp(camera.fov, targetFov, 1 - Math.exp(-3.2 * dt));
      if (Math.abs(nextFov - camera.fov) > 0.01) {
        camera.fov = nextFov;
        camera.updateProjectionMatrix();
      }
      airflowVfx.update(dt, speedAmount, verticalSpeed, boost, reducedMotion);
      weatherVfx.update(dt, crow.position, pausedRef.current);

      if (speedRef.current) speedRef.current.textContent = Math.round(speed).toString();
      if (altitudeRef.current) altitudeRef.current.textContent = Math.round(crow.position.y).toString();
      if (verticalSpeedRef.current) verticalSpeedRef.current.textContent = `${verticalSpeed >= 0 ? "+" : ""}${verticalSpeed.toFixed(1)}`;
      if (flightModeRef.current) {
        const mode = braking ? "BRAKING" : boost ? "SURGE" : verticalSpeed > 4 ? "CLIMB" : verticalSpeed < -4 ? "DIVE" : speed < 30 ? "SLOW GLIDE" : "CRUISE";
        flightModeRef.current.textContent = mode;
        flightModeRef.current.dataset.mode = mode.toLowerCase().replace(" ", "-");
      }
      if (flightEffectRef.current) {
        const effectStrength = reducedMotion ? 0 : clamp((speedAmount - 0.38) * 1.35 + Math.abs(verticalSpeed) / 55, 0, 0.72);
        flightEffectRef.current.style.opacity = effectStrength.toFixed(3);
        flightEffectRef.current.style.transform = `translateY(${clamp(verticalSpeed * -0.32, -7, 7)}px) scale(${1 + effectStrength * 0.025})`;
      }
      flightAudio.setFlight(speed, crow.position.y);
      if (compassRef.current) {
        const headings = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];
        const headingIndex = Math.round((((yaw % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2)) / (Math.PI / 4)) % 8;
        compassRef.current.textContent = headings[headingIndex];
      }
      if (mapBirdRef.current) {
        mapBirdRef.current.style.left = `${50 + clamp(crow.position.x / FLIGHT_EXTENT.x, -1, 1) * 43}%`;
        mapBirdRef.current.style.top = `${50 + clamp(crow.position.z / FLIGHT_EXTENT.z, -1, 1) * 43}%`;
        mapBirdRef.current.style.transform = `translate(-50%, -50%) rotate(${yaw}rad)`;
      }

      renderer.render(scene, camera);
      diagnosticFrame++;
      if (diagnosticFrame % 30 === 0) {
        const districtTiles = scene.userData.proceduralDistrictTiles as ProceduralDistrictTile[] | undefined;
        const tileVisibilityRadius = scene.userData.proceduralTileVisibilityRadius as number | undefined;
        if (districtTiles && tileVisibilityRadius) {
          const visibilitySquared = tileVisibilityRadius ** 2;
          for (const tile of districtTiles) {
            const dx = tile.centerX - crow.position.x;
            const dz = tile.centerZ - crow.position.z;
            tile.group.visible = dx * dx + dz * dz < visibilitySquared;
          }
        }
        renderer.domElement.dataset.calls = renderer.info.render.calls.toString();
        renderer.domElement.dataset.triangles = renderer.info.render.triangles.toString();
        renderer.domElement.dataset.geometries = renderer.info.memory.geometries.toString();
        renderer.domElement.dataset.textures = renderer.info.memory.textures.toString();
        renderer.domElement.dataset.maxFrameMs = maxFrameMs.toFixed(1);
        renderer.domElement.dataset.longFrames = longFrames.toString();
        const trafficSimulation = scene.userData.trafficSimulation as TrafficSimulation | null | undefined;
        renderer.domElement.dataset.trafficVehicles = (trafficSimulation?.vehicleCount ?? 0).toString();
        renderer.domElement.dataset.trafficTickHz = (trafficSimulation?.tickHz ?? 0).toString();
      }
    };
    animate();

    return () => {
      disposed = true;
      delete (window as BirdFlightWindow).__birdFlightDiagnostics;
      flightAudio.dispose();
      airflowVfx.dispose();
      weatherVfx.dispose();
      weatherController.abort();
      window.clearInterval(weatherRefresh);
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
      <div ref={mountRef} className="world" aria-label="Interactive hybrid flight map of central Dhaka" />
      <div className="atmosphere" data-weather={weather.mode} data-daylight={weather.isDay ? "day" : "night"} />
      <div ref={flightEffectRef} className="flight-dynamics" aria-hidden="true" />
      {!flying && <div className="folk-river-seal" aria-hidden="true">
        <span className="folk-sun" />
        <strong lang="bn">নদীর শহর</strong>
        <small>CITY OF RIVERS</small>
        <i className="folk-wave one" /><i className="folk-wave two" /><i className="folk-wave three" />
      </div>}

      <header className={`topbar${flying ? " in-flight" : ""}`}>
        {!flying && <div className="brand">
          <span className="brand-mark">BEV</span>
          <div><strong>BIRD&apos;S EYE VIEW</strong><small>DHAKA · EARLY FLIGHT</small></div>
        </div>}
        {!flying && <div className="header-center">
          <div className="location"><span className="pulse" /> GREATER DHAKA &amp; ITS RIVERS <b>23.7715° N</b></div>
          <div className={`weather-chip ${weatherStatus}`} title={`Feels like ${Math.round(weather.apparentTemperature)}°C · Wind ${Math.round(weather.windSpeed)} km/h`}>
            <strong>{weatherIcon(weather.mode, weather.isDay)}</strong>
            <span>{weather.label}</span>
            <b>{Math.round(weather.temperature)}°</b>
            <i>{weatherStatus === "live" ? "LIVE" : weatherStatus === "loading" ? "SYNC" : "OFFLINE"}</i>
          </div>
        </div>}
        <div className="top-actions">
          <button
            className={`icon-button sound-button${soundOn ? " active" : ""}`}
            onClick={toggleSound}
            aria-label={soundOn ? "Mute nature ambience" : "Enable nature ambience"}
            aria-pressed={soundOn}
            title={soundOn ? "Nature ambience on" : "Turn on nature ambience"}
          >♫</button>
          <button
            className={`icon-button radio-toggle${radioStatus === "playing" || radioStatus === "buffering" ? " active" : ""}`}
            onClick={() => setRadioOpen((value) => !value)}
            aria-label="Open sky radio"
            aria-expanded={radioOpen}
          >◉</button>
          {flying && <button className={`icon-button pause-button${paused ? " active" : ""}`} onClick={togglePause} aria-label={paused ? "Resume flight" : "Pause flight"}>{paused ? "▶" : "Ⅱ"}</button>}
          <button className="icon-button" onClick={() => setControlsOpen((value) => !value)} aria-label="Show flight controls">?</button>
        </div>
      </header>

      {radioOpen && (
        <section className={`radio-panel${flying ? " in-flight" : ""}`} aria-label="Sky radio player">
          <button className="radio-close" onClick={() => setRadioOpen(false)} aria-label="Close radio">×</button>
          <div className="radio-heading">
            <span className="eyebrow">SKY RADIO</span>
            <span className={`radio-status ${radioStatus}`}>
              {radioStatus === "playing" ? "ON AIR" : radioStatus === "buffering" ? "TUNING" : radioStatus === "paused" ? "PAUSED" : radioStatus === "error" ? "SIGNAL LOST" : "OFF"}
            </span>
          </div>
          <div className="radio-display" aria-live="polite">
            <span>{selectedRadioStation.frequency}</span>
            <h2>{selectedRadioStation.name}</h2>
            <p>{radioStatus === "error" ? "This station is unavailable right now. Try again or switch frequencies." : selectedRadioStation.tagline}</p>
          </div>
          <div className="radio-transport">
            <button onClick={() => cycleRadio(-1)} aria-label="Previous station">‹</button>
            <button className="radio-power" onClick={toggleRadio} aria-label={radioStatus === "off" || radioStatus === "error" ? "Play station" : "Turn radio off"}>
              {radioStatus === "off" || radioStatus === "error" ? "PLAY" : "OFF"}
            </button>
            <button onClick={() => cycleRadio(1)} aria-label="Next station">›</button>
          </div>
          <label className="radio-volume">
            <span>VOL</span>
            <input
              type="range"
              min="0"
              max="1"
              step="0.05"
              value={radioVolume}
              onChange={(event) => {
                const volume = Number(event.target.value);
                setRadioVolume(volume);
                radioRef.current?.setVolume(volume);
              }}
              aria-label="Radio volume"
            />
          </label>
          <div className="radio-stations" role="group" aria-label="Available stations">
            {RADIO_STATIONS.map((station, index) => (
              <button
                key={station.id}
                className={index === radioStationIndex ? "selected" : ""}
                onClick={() => tuneRadio(index)}
                aria-label={`Tune ${station.name}`}
              >
                <span>{station.frequency}</span>
                <b>{station.name}</b>
                <i>{station.stream ? "LIVE" : "BEV"}</i>
              </button>
            ))}
          </div>
          <div className="radio-meta">
            <span><kbd>R</kbd> POWER</span><span><kbd>[ ]</kbd> TUNE</span>
            {selectedRadioStation.homepage && <a href={selectedRadioStation.homepage} target="_blank" rel="noreferrer">OFFICIAL STATION ↗</a>}
          </div>
          <small>LIVE INTERNET RADIO · SIGNAL AVAILABILITY MAY VARY</small>
        </section>
      )}

      {!radioOpen && radioStatus !== "off" && (
        <button className={`radio-now-playing ${radioStatus}${flying ? " in-flight" : ""}`} onClick={() => setRadioOpen(true)} aria-label="Show now playing station">
          <i />
          <span>{radioStatus === "error" ? "SIGNAL LOST" : selectedRadioStation.frequency}</span>
          <b>{selectedRadioStation.name}</b>
        </button>
      )}

      {flying && <div className={`weather-chip weather-flight ${weatherStatus}`} title={`Feels like ${Math.round(weather.apparentTemperature)}°C · Wind ${Math.round(weather.windSpeed)} km/h`}>
        <strong>{weatherIcon(weather.mode, weather.isDay)}</strong>
        <span>{weather.label}</span>
        <b>{Math.round(weather.temperature)}°</b>
        <i>{weatherStatus === "live" ? "LIVE" : weatherStatus === "loading" ? "SYNC" : "OFFLINE"}</i>
      </div>}

      {flying && (
        <>
          <section className="telemetry" aria-label="Flight telemetry">
            <div><span ref={speedRef}>48</span><small>KM/H</small></div>
            <i />
            <div><span ref={altitudeRef}>{DEFAULT_FLIGHT_ALTITUDE}</span><small>METRES</small></div>
            <i />
            <div><span ref={verticalSpeedRef}>+0.0</span><small>VERT M/S</small></div>
            <i />
            <div><span ref={compassRef}>N</span><small>HEADING</small></div>
          </section>
          <div className="flight-mode"><i /><span ref={flightModeRef} data-mode="cruise">CRUISE</span></div>

          <div className="minimap" aria-label="Mini map of the Greater Dhaka river basin flight grid">
            <span className="north">N</span>
            <div className="map-water one" /><div className="map-water two" />
            <div className="map-road" />
            {AREA_LANDMARKS.filter((landmark) => landmark.minimap).map((landmark) => {
              const world = coordinatesToWorld(landmark.lat, landmark.lon);
              return (
                <span
                  key={landmark.label}
                  className="map-area"
                  title={landmark.label}
                  style={{
                    left: `${50 + clamp(world.x / FLIGHT_EXTENT.x, -1, 1) * 43}%`,
                    top: `${50 + clamp(world.y / FLIGHT_EXTENT.z, -1, 1) * 43}%`,
                  }}
                >{landmark.shortLabel}</span>
              );
            })}
            {DHAKA_LANDMARKS.filter((landmark) => landmark.minimap).map((landmark) => {
              const world = coordinatesToWorld(landmark.lat, landmark.lon);
              return (
                <span
                  key={landmark.label}
                  className="map-landmark"
                  title={landmark.label}
                  style={{
                    left: `${50 + clamp(world.x / FLIGHT_EXTENT.x, -1, 1) * 43}%`,
                    top: `${50 + clamp(world.y / FLIGHT_EXTENT.z, -1, 1) * 43}%`,
                  }}
                >{landmark.shortLabel}</span>
              );
            })}
            {WATER_LANDMARKS.filter((landmark) => landmark.minimap).map((landmark) => {
              const world = coordinatesToWorld(landmark.lat, landmark.lon);
              return (
                <span
                  key={landmark.label}
                  className="map-river"
                  title={landmark.label}
                  style={{
                    left: `${50 + clamp(world.x / FLIGHT_EXTENT.x, -1, 1) * 43}%`,
                    top: `${50 + clamp(world.y / FLIGHT_EXTENT.z, -1, 1) * 43}%`,
                  }}
                >{landmark.shortLabel}</span>
              );
            })}
            <div ref={mapBirdRef} className="map-bird">▲</div>
            <small>GREATER DHAKA BASIN</small>
          </div>

          <div className="camera-chip"><span>CAMERA</span>{cameraMode}<kbd>C</kbd></div>
          <div className="perch-legend"><i /> AREA PERCH</div>
          <div className="flight-hint"><kbd>W / S</kbd><span>CLIMB / DIVE</span><kbd>CTRL / Q</kbd><span>BRAKE</span><kbd>SHIFT</kbd><span>BOOST</span></div>
          <div ref={perchPromptRef} className="perch-prompt" data-visible="false"><kbd>E</kbd><span ref={perchLabelRef}>LAND</span></div>
          {resting && <div className="resting-chip"><i /> RESTING · WATCHING DHAKA</div>}
          <div className={`map-source ${mapStatus}`}>
            <i /> {mapStatus === "live" ? "OSM + PROCEDURAL + SAMPLED SIM TRAFFIC · " : mapStatus === "loading" ? "LOADING MAP + SIM TRAFFIC · " : "MAP + SIM TRAFFIC FALLBACK · "}
            <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">© OpenStreetMap contributors</a>
          </div>
        </>
      )}

      {!flying && (
        <section className="welcome-panel">
          <span className="eyebrow">AN ILLUSTRATED FLIGHT THROUGH THE RIVER CITY</span>
          <h1>The sky<br />belongs to you.</h1>
          <p>Cross Greater Dhaka from Uttara and Mirpur to Old Dhaka, Keraniganj, Demra, and Purbachal—following the Buriganga, Turag, Balu, Shitalakshya, and the lakes between them.</p>
          <button onClick={beginFlight} className="primary-button"><span>BEGIN FLIGHT</span><b>→</b></button>
          <div className="quick-controls"><span><kbd>WASD</kbd> STEER</span><span><kbd>CTRL / Q</kbd> BRAKE</span><span><kbd>SPACE</kbd> FLAP</span><span><kbd>C</kbd> CAMERA</span></div>
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
            <div><dt>Space</dt><dd>Flap for a burst of lift</dd></div>
            <div><dt>Ctrl / Q</dt><dd>Air-brake into a slow glide</dd></div>
            <div><dt>Shift</dt><dd>Accelerate into a high-speed surge</dd></div>
            <div><dt>C</dt><dd>Switch camera</dd></div>
            <div><dt>P / Esc</dt><dd>Pause / resume flight</dd></div>
            <div><dt>E</dt><dd>Land / take off at a perch</dd></div>
            <div><dt>♫</dt><dd>Nature ambience: birds, leaves, water, and insects</dd></div>
            <div><dt>R / [ ]</dt><dd>Radio power / tune station</dd></div>
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
