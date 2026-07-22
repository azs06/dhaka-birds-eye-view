"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js";
import { Sky } from "three/examples/jsm/objects/Sky.js";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { resolveBuildingCollision } from "./flight-collision.mjs";
import { DHAKA_LANDMARK_FOOTPRINTS, type LandmarkFootprintPart } from "./dhaka-landmark-footprints";

type CameraMode = "CHASE" | "BIRD'S EYE";
type BuildingCollider = { x: number; z: number; halfWidth: number; halfDepth: number; top: number };
type Perch = { position: THREE.Vector3; label: string; heading: number; kind?: "landmark" | "tree" };
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
    | "baitul-mukarram"
    | "bangladesh-bank"
    | "airport";
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
  sunriseAt: string;
  sunsetAt: string;
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
  metroLines?: MapPoint[][];
  metroStations?: Array<{ id: number; name: string | null; point: MapPoint }>;
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
  sizeScale: number;
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
// Half-extents (metres) of the flyable world, matched to the OSM fetch BOUNDS
// in app/api/osm/route.ts: ~+/-12 km E-W and reaching Uttara in the north.
const FLIGHT_EXTENT = { x: 12_000, z: 14_800 };
const COLLISION_CELL_SIZE = 180;
const BRAKE_SPEED = 18;
const CRUISE_SPEED = 44;
const BOOST_SPEED = 78;
const DEFAULT_FLIGHT_ALTITUDE = 130;
const MIN_FLIGHT_ALTITUDE = 10;
const MAX_FLIGHT_ALTITUDE = 650;
const CEILING_EASE_DEPTH = 90;
const MIN_CEILING_CLIMB_SPEED = 1.8;
// Landing reach: landmark perches are big rooftop targets, treetops are tighter.
const LANDMARK_LANDING_RADIUS = 27;
const TREE_LANDING_RADIUS = 20;
// Tree perches are spatially hashed so the per-frame nearest-perch search only
// touches the 3x3 cells around the bird instead of every tree in the city.
const TREE_PERCH_CELL_SIZE = 160;
const TRAFFIC_ROUTE_SAMPLE_RATIO = 0.5;
const TRAFFIC_ROUTE_BUDGET = 160;
const TRAFFIC_MAX_VEHICLES = 320;
const TRAFFIC_MIN_VEHICLES = 40;
// Sparse ambient density: roughly one vehicle per this many metres of major road
// (local streets count at a quarter rate). Raise it for lighter traffic, lower for denser.
const TRAFFIC_METERS_PER_VEHICLE = 260;
// Fraction of vehicles routed onto major roads (highway/primary/secondary).
const TRAFFIC_MAJOR_SHARE = 0.75;
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
  sunriseAt: "",
  sunsetAt: "",
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
  { label: "Uttara", shortLabel: "UTR", lat: 23.87532, lon: 90.39679, altitude: 68, heading: 0, minimap: true },
  { label: "Uttara Sector 3", shortLabel: "US3", lat: 23.86894, lon: 90.40224, altitude: 58, heading: 0 },
  { label: "Diabari", shortLabel: "DBR", lat: 23.88566, lon: 90.37641, altitude: 60, heading: 0, minimap: true },
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
  { label: "BRAC Centre", shortLabel: "BRC", lat: 23.7799167, lon: 90.4101944, altitude: 64, heading: Math.PI / 2, kind: "brac" },
  { label: "Four Points by Sheraton", shortLabel: "SHD", lat: 23.7943691, lon: 90.413838, altitude: 112, heading: 0, kind: "hotel" },
  { label: "Jatiya Sangsad Bhaban", shortLabel: "JSB", lat: 23.7622884, lon: 90.3785482, altitude: 46, heading: Math.PI, kind: "parliament", minimap: true },
  { label: "Lalbagh Fort", shortLabel: "LBF", lat: 23.718843, lon: 90.3881528, altitude: 18, heading: Math.PI, kind: "lalbagh-fort", minimap: true },
  { label: "Ahsan Manzil", shortLabel: "AHM", lat: 23.7084768, lon: 90.4055988, altitude: 34, heading: 0, kind: "ahsan-manzil", minimap: true },
  { label: "Central Shaheed Minar", shortLabel: "CSM", lat: 23.7272114, lon: 90.3966368, altitude: 16, heading: Math.PI, kind: "shaheed-minar" },
  { label: "Curzon Hall", shortLabel: "CRZ", lat: 23.7273259, lon: 90.4019331, altitude: 28, heading: Math.PI, kind: "curzon-hall" },
  { label: "Baitul Mukarram", shortLabel: "BTM", lat: 23.7294725, lon: 90.412617, altitude: 72, heading: Math.PI, kind: "baitul-mukarram", minimap: true },
  { label: "Bangladesh Bank Tower", shortLabel: "BBT", lat: 23.72596, lon: 90.42228, altitude: 108, heading: -Math.PI / 2, kind: "bangladesh-bank", minimap: true },
  { label: "Hazrat Shahjalal Airport", shortLabel: "DAC", lat: 23.84343, lon: 90.39784, altitude: 48, heading: -0.56, kind: "airport", minimap: true },
];

const MRT_LINE_6_STATIONS = [
  { label: "Uttara North", lat: 23.87125, lon: 90.39818 },
  { label: "Pallabi", lat: 23.82556, lon: 90.36681 },
  { label: "Mirpur 10", lat: 23.80674, lon: 90.36863 },
  { label: "Agargaon", lat: 23.77824, lon: 90.38018 },
  { label: "Bijoy Sarani", lat: 23.76486, lon: 90.38508 },
  { label: "Farmgate", lat: 23.75875, lon: 90.38776 },
  { label: "Karwan Bazar", lat: 23.75135, lon: 90.39364 },
  { label: "Shahbagh", lat: 23.73838, lon: 90.39594 },
  { label: "Dhaka University", lat: 23.7324, lon: 90.39811 },
  { label: "Secretariat", lat: 23.73124, lon: 90.40873 },
  { label: "Motijheel", lat: 23.72743, lon: 90.42048 },
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

const DHAKA_SKY_LOCATION = { lat: 23.7715, lon: 90.4165 };

function smoothRange(value: number, start: number, end: number) {
  const amount = clamp((value - start) / Math.max(end - start, Number.EPSILON), 0, 1);
  return amount * amount * (3 - 2 * amount);
}

function solarPosition(at: Date) {
  const julianDay = at.getTime() / 86_400_000 + 2_440_587.5;
  const daysSinceJ2000 = julianDay - 2_451_545;
  const meanLongitude = THREE.MathUtils.degToRad((280.46 + 0.9856474 * daysSinceJ2000) % 360);
  const meanAnomaly = THREE.MathUtils.degToRad((357.528 + 0.9856003 * daysSinceJ2000) % 360);
  const eclipticLongitude = meanLongitude
    + THREE.MathUtils.degToRad(1.915) * Math.sin(meanAnomaly)
    + THREE.MathUtils.degToRad(0.02) * Math.sin(2 * meanAnomaly);
  const obliquity = THREE.MathUtils.degToRad(23.439 - 0.0000004 * daysSinceJ2000);
  const rightAscension = Math.atan2(Math.cos(obliquity) * Math.sin(eclipticLongitude), Math.cos(eclipticLongitude));
  const declination = Math.asin(Math.sin(obliquity) * Math.sin(eclipticLongitude));
  const siderealDegrees = (280.46061837 + 360.98564736629 * daysSinceJ2000 + DHAKA_SKY_LOCATION.lon) % 360;
  const hourAngle = THREE.MathUtils.degToRad(((siderealDegrees - THREE.MathUtils.radToDeg(rightAscension) + 540) % 360) - 180);
  const latitude = THREE.MathUtils.degToRad(DHAKA_SKY_LOCATION.lat);
  const elevation = Math.asin(
    Math.sin(latitude) * Math.sin(declination)
    + Math.cos(latitude) * Math.cos(declination) * Math.cos(hourAngle),
  );
  const azimuth = Math.atan2(
    Math.sin(hourAngle),
    Math.cos(hourAngle) * Math.sin(latitude) - Math.tan(declination) * Math.cos(latitude),
  ) + Math.PI;
  return { elevation, azimuth };
}

function liveDaylightAmount(weather: WeatherSnapshot, now: number, solarElevation: number) {
  const sunrise = Date.parse(weather.sunriseAt);
  const sunset = Date.parse(weather.sunsetAt);
  if (!Number.isFinite(sunrise) || !Number.isFinite(sunset) || sunrise >= sunset) {
    return smoothRange(THREE.MathUtils.radToDeg(solarElevation), -6, 7);
  }
  const dawn = smoothRange(now, sunrise - 35 * 60_000, sunrise + 25 * 60_000);
  const dusk = 1 - smoothRange(now, sunset - 25 * 60_000, sunset + 35 * 60_000);
  return Math.min(dawn, dusk);
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
  const majorKinds = new Set(["motorway", "trunk", "primary", "secondary"]);
  const localKinds = new Set(["tertiary", "residential", "unclassified", "service"]);
  const candidates = roads.flatMap((road, index) => {
    const points = road.points.filter(([x, z]) => Number.isFinite(x) && Number.isFinite(z));
    if ((!majorKinds.has(road.kind) && !localKinds.has(road.kind)) || points.length < 2) return [];
    const length = trafficRoadLength(points);
    if (length < 70) return [];
    const hash = Math.imul(road.id || index + 1, 2_654_435_761) >>> 0;
    const sample = hash / 4_294_967_295;
    const major = majorKinds.has(road.kind);
    // Keep every major road; thin the far denser local grid by hash sampling.
    if (!major && roads.length > 4 && sample > TRAFFIC_ROUTE_SAMPLE_RATIO) return [];
    // Mirror the rendered surface widths from addRoadNetworkMeshes so vehicles sit in lanes.
    const width = major ? (road.kind === "motorway" || road.kind === "trunk" ? 17 : 14) : 7.5;
    const center = points[Math.floor(points.length / 2)];
    // Major roads (offset 0) sort ahead of locals (offset 1); the hash shuffles within each tier.
    const score = (major ? 0 : 1) + sample;
    return [{ ...road, points, major, length, width, score, cell: `${Math.floor(center[0] / 1_200)}:${Math.floor(center[1] / 1_200)}` }];
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
  const majorRoutes = routes.filter((route) => route.major);
  const localRoutes = routes.filter((route) => !route.major);
  const majorLength = majorRoutes.reduce((sum, route) => sum + route.length, 0);
  const localLength = localRoutes.reduce((sum, route) => sum + route.length, 0);
  // Density scales with total road length, weighted toward major roads.
  const densityTarget = Math.round((majorLength + localLength * 0.25) / TRAFFIC_METERS_PER_VEHICLE);
  const vehicleTotal = routes.length <= 4
    ? maxVehicles
    : clamp(densityTarget, TRAFFIC_MIN_VEHICLES, maxVehicles);
  // Route most vehicles onto major roads so highways feel busier than side streets.
  const majorVehicleCount = majorRoutes.length === 0
    ? 0
    : localRoutes.length === 0
      ? vehicleTotal
      : Math.round(vehicleTotal * TRAFFIC_MAJOR_SHARE);
  const routeForIndex = (index: number) => {
    if (index < majorVehicleCount && majorRoutes.length > 0) return majorRoutes[index % majorRoutes.length];
    const pool = localRoutes.length > 0 ? localRoutes : majorRoutes;
    return pool.length > 0 ? pool[index % pool.length] : routes[index % routes.length];
  };
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
    const road = routeForIndex(index);
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
    // Sit opposing lanes to each side of the centerline, spaced by the rendered road width.
    const laneOffset = road.width * 0.24 + random() * 0.6;
    const sizeScale = 0.85 + random() * 0.4;
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
      sizeScale,
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
    visibleVehicles = Math.min(vehicleTotal, Math.max(visibleVehicles, Math.floor(12 + simulationTime * 16)));
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
      scale.setScalar(vehicle.sizeScale);
      matrix.compose(renderPosition, quaternion, scale);
      bodies.setMatrixAt(index, matrix);
      renderPosition.y += 1.12 * vehicle.sizeScale;
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
  let currentWeather = DEFAULT_WEATHER;
  let daylightRefreshClock = 0;
  const sunDirection = new THREE.Vector3();
  const nightColor = new THREE.Color();
  const dayColor = new THREE.Color();
  const twilightColor = new THREE.Color(0xc47c68);
  const blendedBackground = new THREE.Color();
  const sunColor = new THREE.Color();
  const highSunColor = new THREE.Color(0xffefd1);
  const overcastSunColor = new THREE.Color(0xd6e5e5);

  const apply = (weather: WeatherSnapshot) => {
    currentWeather = weather;
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

    const now = Date.now();
    const solar = solarPosition(new Date(now));
    const solarElevation = THREE.MathUtils.radToDeg(solar.elevation);
    const daylight = liveDaylightAmount(weather, now, solar.elevation);
    const isNight = daylight < 0.08;
    const twilight = 1 - Math.abs(daylight * 2 - 1);
    const daylightStrength = smoothRange(daylight, 0.04, 0.92);
    const nightHex = mode === "storm" ? 0x0d1822 : mode === "rain" ? 0x10232e : 0x122b3c;
    const dayHex = mode === "fog" ? 0xa4ad91
      : mode === "storm" ? 0x49656b
        : mode === "rain" ? 0x6f9695
          : mode === "cloudy" ? 0x86aaa0
            : 0x91c7c0;
    nightColor.setHex(nightHex);
    dayColor.setHex(dayHex);
    blendedBackground.copy(nightColor).lerp(twilightColor, twilight * (1 - cloudAmount * 0.55)).lerp(dayColor, daylightStrength);
    scene.background = blendedBackground;
    if (scene.fog instanceof THREE.FogExp2) {
      scene.fog.color.copy(blendedBackground);
      scene.fog.density = mode === "fog"
        ? 0.00135
        : mode === "storm"
          ? 0.00082
          : mode === "rain"
            ? 0.00064
            : 0.00024 + cloudAmount * 0.00018;
    }

    const horizontal = Math.cos(solar.elevation);
    sunDirection.set(
      Math.sin(solar.azimuth) * horizontal,
      Math.sin(solar.elevation),
      -Math.cos(solar.azimuth) * horizontal,
    ).normalize();
    sky.visible = solarElevation > -7;
    stars.visible = daylight < 0.32 && cloudAmount < 0.72 && !raining && mode !== "fog";
    starMaterial.opacity = clamp((0.82 - cloudAmount) * (1 - daylight / 0.32), 0, 0.82);
    const skyUniforms = sky.material.uniforms;
    skyUniforms.sunPosition.value.copy(sunDirection);
    renderer.domElement.dataset.cloudCover = weather.cloudCover.toFixed(0);
    renderer.domElement.dataset.daylightAmount = daylight.toFixed(3);
    renderer.domElement.dataset.sunElevation = solarElevation.toFixed(2);
    renderer.domElement.dataset.sunAzimuth = THREE.MathUtils.radToDeg(solar.azimuth).toFixed(2);
    skyUniforms.turbidity.value = 3.8 + cloudAmount * 10 + (raining ? 4 : 0);
    skyUniforms.rayleigh.value = 3.4 - cloudAmount * 2.35;
    skyUniforms.mieCoefficient.value = 0.0035 + cloudAmount * 0.016;
    skyUniforms.mieDirectionalG.value = 0.82;

    renderer.toneMappingExposure = THREE.MathUtils.lerp(0.72, mode === "clear" ? 1.02 : mode === "cloudy" ? 0.9 : 0.76, daylight);
    hemisphere.intensity = THREE.MathUtils.lerp(0.36, 1.8 - cloudAmount * 0.82, daylight);
    hemisphere.color.set(isNight ? 0x7893ad : mode === "rain" || mode === "storm" ? 0xb8d0d4 : 0xe8f3ee);
    hemisphere.groundColor.set(isNight ? 0x182923 : 0x5d6c58);
    const sunVisibility = smoothRange(solarElevation, -5, 8) * (1 - cloudAmount * 0.72);
    sun.intensity = (mode === "clear" ? 3.35 : mode === "cloudy" ? 1.45 : 0.58) * sunVisibility;
    sunColor.set(0xff965e).lerp(highSunColor, smoothRange(solarElevation, 2, 28));
    sunColor.lerp(overcastSunColor, clamp(cloudAmount * 0.55 + (raining ? 0.28 : 0), 0, 0.82));
    sun.color.copy(sunColor);
    sun.position.copy(sunDirection).multiplyScalar(1_200);
    sun.target.position.set(0, 0, 0);
    skyFill.intensity = THREE.MathUtils.lerp(0.28, 0.48 + cloudAmount * 0.28, daylight);
    skyFill.color.set(isNight ? 0x45617b : twilight > 0.35 ? 0xc99b8e : 0x9bc8d2);

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
      daylightRefreshClock -= dt;
      if (daylightRefreshClock <= 0) {
        daylightRefreshClock = 30;
        apply(currentWeather);
      }
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

function proceduralFallbackRoads(): OsmMapData["roads"] {
  const roads: OsmMapData["roads"] = [];
  let id = -10_000;

  const corridor = (
    name: string,
    kind: string,
    coordinates: Array<[number, number]>,
  ) => {
    roads.push({
      id: id--,
      points: coordinates.map(([lat, lon]) => {
        const world = coordinatesToWorld(lat, lon);
        return [world.x, world.y] as MapPoint;
      }),
      kind,
      name,
    });
  };

  corridor("Airport Road", "trunk", [
    [23.861, 90.400], [23.843, 90.399], [23.821, 90.401], [23.793, 90.400],
    [23.779, 90.399], [23.765, 90.391], [23.758, 90.387], [23.738, 90.396],
    [23.728, 90.407], [23.713, 90.421],
  ]);
  corridor("Begum Rokeya Sarani", "primary", [
    [23.835, 90.367], [23.825, 90.367], [23.807, 90.369], [23.791, 90.374],
    [23.778, 90.380], [23.765, 90.385], [23.758, 90.388],
  ]);
  corridor("Mirpur Road", "primary", [
    [23.801, 90.354], [23.781, 90.354], [23.765, 90.359], [23.754, 90.370],
    [23.744, 90.382], [23.733, 90.385], [23.720, 90.389],
  ]);
  corridor("Pragati Sarani", "primary", [
    [23.823, 90.421], [23.803, 90.421], [23.783, 90.422], [23.772, 90.422],
    [23.760, 90.421], [23.750, 90.415], [23.741, 90.411],
  ]);
  corridor("Purbachal Expressway", "trunk", [
    [23.825, 90.414], [23.824, 90.430], [23.827, 90.448], [23.833, 90.469],
    [23.838, 90.491],
  ]);
  corridor("Motijheel Arterial", "primary", [
    [23.737, 90.396], [23.733, 90.407], [23.728, 90.416], [23.727, 90.422],
    [23.729, 90.437], [23.732, 90.456], [23.724, 90.481],
  ]);
  corridor("Dhaka–Chattogram Highway", "trunk", [
    [23.731, 90.407], [23.720, 90.422], [23.711, 90.435], [23.700, 90.451],
    [23.686, 90.468], [23.671, 90.488],
  ]);

  const spacing = 520;
  const localRandom = seededRandom(7_129);
  for (let baseZ = -FLIGHT_EXTENT.z; baseZ <= FLIGHT_EXTENT.z; baseZ += spacing) {
    const points: MapPoint[] = [];
    const phase = localRandom() * Math.PI * 2;
    for (let x = -FLIGHT_EXTENT.x; x <= FLIGHT_EXTENT.x; x += 720) {
      points.push([x, baseZ + Math.sin(x * 0.0012 + phase) * 46 + (localRandom() - 0.5) * 34]);
    }
    roads.push({
      id: id--,
      points,
      kind: "residential",
      name: null,
    });
  }
  for (let baseX = -FLIGHT_EXTENT.x; baseX <= FLIGHT_EXTENT.x; baseX += spacing) {
    const points: MapPoint[] = [];
    const phase = localRandom() * Math.PI * 2;
    for (let z = -FLIGHT_EXTENT.z; z <= FLIGHT_EXTENT.z; z += 720) {
      points.push([baseX + Math.sin(z * 0.00115 + phase) * 42 + (localRandom() - 0.5) * 32, z]);
    }
    roads.push({ id: id--, points, kind: "residential", name: null });
  }
  return roads;
}

async function addRoadNetworkMeshes(
  parent: THREE.Object3D,
  roads: OsmMapData["roads"],
  name: string,
  isCancelled: () => boolean,
) {
  const majorRoads = new Set(["motorway", "trunk", "primary", "secondary"]);
  const localRoads = new Set(["tertiary", "residential", "unclassified", "service"]);
  const surfaces: THREE.BufferGeometry[][] = [[], [], []];
  const shoulders: THREE.BufferGeometry[] = [];
  const centerLines: THREE.BufferGeometry[] = [];
  const edgeLines: THREE.BufferGeometry[] = [];

  const segmentBox = (
    x1: number,
    z1: number,
    x2: number,
    z2: number,
    width: number,
    height: number,
    y: number,
    lateralOffset = 0,
  ) => {
    const dx = x2 - x1;
    const dz = z2 - z1;
    const length = Math.hypot(dx, dz);
    if (length < 1) return null;
    const normalX = -dz / length;
    const normalZ = dx / length;
    const geometry = new THREE.BoxGeometry(length + 0.8, height, width);
    geometry.rotateY(-Math.atan2(dz, dx));
    geometry.translate(
      (x1 + x2) / 2 + normalX * lateralOffset,
      y,
      (z1 + z2) / 2 + normalZ * lateralOffset,
    );
    return geometry;
  };

  for (const road of roads) {
    const bucket = majorRoads.has(road.kind) ? 0 : localRoads.has(road.kind) ? 1 : 2;
    const width = bucket === 0 ? (road.kind === "motorway" || road.kind === "trunk" ? 17 : 14) : bucket === 1 ? 7.5 : 4.2;
    // Stagger deck heights per class so crossing roads never share a coplanar top
    // face — identical-height boxes in different asphalt colours z-fight at every
    // junction where a local street overlaps a major road.
    const surfaceY = bucket === 0 ? 0.98 : bucket === 1 ? 0.9 : 0.84;
    for (let index = 1; index < road.points.length; index++) {
      const [x1, z1] = road.points[index - 1];
      const [x2, z2] = road.points[index];
      const surface = segmentBox(x1, z1, x2, z2, width, 0.34, surfaceY);
      if (!surface) continue;
      surfaces[bucket].push(surface);
      const shoulder = segmentBox(x1, z1, x2, z2, width + (bucket === 0 ? 5.5 : 2.4), 0.24, 0.78);
      if (shoulder) shoulders.push(shoulder);
      if (bucket === 0) {
        const center = segmentBox(x1, z1, x2, z2, 0.58, 0.09, 1.19);
        if (center) centerLines.push(center);
        const edgeOffset = width / 2 - 0.85;
        const leftEdge = segmentBox(x1, z1, x2, z2, 0.32, 0.075, 1.18, -edgeOffset);
        const rightEdge = segmentBox(x1, z1, x2, z2, 0.32, 0.075, 1.18, edgeOffset);
        if (leftEdge) edgeLines.push(leftEdge);
        if (rightEdge) edgeLines.push(rightEdge);
      }
    }
  }

  await mergeIntoMeshBatches(
    parent,
    shoulders,
    new THREE.MeshStandardMaterial({ color: 0xaaa28f, roughness: 0.98 }),
    `${name} shoulders`,
    isCancelled,
    false,
    280,
    false,
  );
  const roadMaterials = [0x2f3735, 0x464f4b, 0x626b65].map(
    (color) => new THREE.MeshStandardMaterial({ color, roughness: 0.95 }),
  );
  for (let index = 0; index < surfaces.length; index++) {
    await mergeIntoMeshBatches(parent, surfaces[index], roadMaterials[index], `${name} roads ${index}`, isCancelled, false, 280, false);
  }
  await mergeIntoMeshBatches(
    parent,
    centerLines,
    new THREE.MeshStandardMaterial({ color: 0xe0bd62, roughness: 0.86 }),
    `${name} center lines`,
    isCancelled,
    false,
    320,
    false,
  );
  await mergeIntoMeshBatches(
    parent,
    edgeLines,
    new THREE.MeshStandardMaterial({ color: 0xe5deca, roughness: 0.9 }),
    `${name} edge lines`,
    isCancelled,
    false,
    320,
    false,
  );
}

function addImmediateCityMass(scene: THREE.Scene, roads: OsmMapData["roads"]) {
  const group = new THREE.Group();
  group.name = "Immediate Greater Dhaka city mass";
  const geometry = new THREE.BoxGeometry(1, 1, 1);
  const materials = [0xc4b99f, 0xa9b3aa, 0xb47e69].map(
    (color) => new THREE.MeshStandardMaterial({ color, roughness: 0.94, metalness: 0.01 }),
  );
  const transforms: THREE.Matrix4[][] = [[], [], []];
  const districtCenters = AREA_LANDMARKS.map((landmark) => {
    const world = coordinatesToWorld(landmark.lat, landmark.lon);
    return { x: world.x, z: world.y, intensity: clamp(landmark.altitude / 88, 0.42, 1.08) };
  });
  const landmarkClearings = DHAKA_LANDMARKS.map((landmark) => {
    const world = coordinatesToWorld(landmark.lat, landmark.lon);
    return { x: world.x, z: world.y, radius: landmark.kind === "airport" ? 1_350 : 105 };
  });
  const roadCellSize = 180;
  const roadGrid = new Map<string, Array<{ x1: number; z1: number; x2: number; z2: number; radius: number }>>();
  const roadKey = (cellX: number, cellZ: number) => `${cellX}:${cellZ}`;
  for (const road of roads) {
    const radius = ["motorway", "trunk", "primary", "secondary"].includes(road.kind) ? 28 : 15;
    for (let index = 1; index < road.points.length; index++) {
      const [x1, z1] = road.points[index - 1];
      const [x2, z2] = road.points[index];
      const segment = { x1, z1, x2, z2, radius };
      for (let cellX = Math.floor((Math.min(x1, x2) - radius) / roadCellSize); cellX <= Math.floor((Math.max(x1, x2) + radius) / roadCellSize); cellX++) {
        for (let cellZ = Math.floor((Math.min(z1, z2) - radius) / roadCellSize); cellZ <= Math.floor((Math.max(z1, z2) + radius) / roadCellSize); cellZ++) {
          const key = roadKey(cellX, cellZ);
          const entries = roadGrid.get(key);
          if (entries) entries.push(segment);
          else roadGrid.set(key, [segment]);
        }
      }
    }
  }

  const random = seededRandom(24_071);
  const matrix = new THREE.Matrix4();
  const position = new THREE.Vector3();
  const quaternion = new THREE.Quaternion();
  const scale = new THREE.Vector3();
  const spacing = 116;
  for (let x = -FLIGHT_EXTENT.x + 70; x < FLIGHT_EXTENT.x - 70; x += spacing) {
    for (let z = -FLIGHT_EXTENT.z + 70; z < FLIGHT_EXTENT.z - 70; z += spacing) {
      const buildingX = x + (random() - 0.5) * 48;
      const buildingZ = z + (random() - 0.5) * 48;
      let intensity = 0.22;
      for (const district of districtCenters) {
        const proximity = clamp(1 - Math.hypot(buildingX - district.x, buildingZ - district.z) / 1_700, 0, 1);
        intensity = Math.max(intensity, proximity * district.intensity);
      }
      if (random() > 0.36 + intensity * 0.42) continue;
      if (landmarkClearings.some((landmark) => Math.hypot(buildingX - landmark.x, buildingZ - landmark.z) < landmark.radius)) continue;
      const width = 22 + random() * 30;
      const depth = 20 + random() * 32;
      const buildingRadius = Math.hypot(width, depth) / 2;
      const roadCellX = Math.floor(buildingX / roadCellSize);
      const roadCellZ = Math.floor(buildingZ / roadCellSize);
      const nearbyRoads: Array<{ x1: number; z1: number; x2: number; z2: number; radius: number }> = [];
      for (let offsetX = -1; offsetX <= 1; offsetX++) {
        for (let offsetZ = -1; offsetZ <= 1; offsetZ++) {
          nearbyRoads.push(...(roadGrid.get(roadKey(roadCellX + offsetX, roadCellZ + offsetZ)) ?? []));
        }
      }
      if (nearbyRoads.some((segment) => distanceToSegmentSquared(
        buildingX,
        buildingZ,
        segment.x1,
        segment.z1,
        segment.x2,
        segment.z2,
      ) < (segment.radius + buildingRadius + 6) ** 2)) continue;

      const height = 10 + random() * 30 + intensity * (24 + random() * 44);
      const bucket = height > 52 ? 2 : height > 30 ? 1 : 0;
      position.set(buildingX, height / 2 + 0.9, buildingZ);
      quaternion.setFromAxisAngle(new THREE.Vector3(0, 1, 0), (random() - 0.5) * 0.16);
      scale.set(width, height, depth);
      transforms[bucket].push(matrix.compose(position, quaternion, scale).clone());
    }
  }

  transforms.forEach((bucketTransforms, bucket) => {
    const mesh = new THREE.InstancedMesh(geometry, materials[bucket], bucketTransforms.length);
    mesh.name = `Immediate city buildings ${bucket}`;
    bucketTransforms.forEach((transform, index) => mesh.setMatrixAt(index, transform));
    mesh.instanceMatrix.needsUpdate = true;
    mesh.castShadow = false;
    mesh.receiveShadow = true;
    group.add(mesh);
  });
  scene.add(group);
  scene.userData.immediateCityMass = group;
  return group;
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
  const foliageGeometry = new THREE.IcosahedronGeometry(1, 1);
  const trunkGeometry = new THREE.CylinderGeometry(0.5, 0.72, 1, 6);
  const materials = [0xc9bda3, 0xaeb8ae, 0xb9826d].map(
    (color) => new THREE.MeshStandardMaterial({ color, roughness: 0.9, metalness: 0.01 }),
  );
  const roofMaterial = new THREE.MeshStandardMaterial({ color: 0x59655f, roughness: 0.94 });
  const trunkMaterial = new THREE.MeshStandardMaterial({ color: 0x6b5140, roughness: 1 });
  const foliageMaterial = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1 });
  const foliagePalette = [0x3f684a, 0x567b53, 0x7d8e59, 0x4b7452].map((color) => new THREE.Color(color));
  const bushPalette = [0x5d8a55, 0x6f9a58, 0x4e7d4f].map((color) => new THREE.Color(color));
  const treePerchGrid = (scene.userData.treePerchGrid as Map<string, Perch[]> | undefined) ?? new Map<string, Perch[]>();
  scene.userData.treePerchGrid = treePerchGrid;
  const registerTreePerch = (perch: Perch) => {
    const key = `${Math.floor(perch.position.x / TREE_PERCH_CELL_SIZE)}:${Math.floor(perch.position.z / TREE_PERCH_CELL_SIZE)}`;
    const bucket = treePerchGrid.get(key);
    if (bucket) bucket.push(perch);
    else treePerchGrid.set(key, [perch]);
  };
  const majorRoads = new Set(["motorway", "trunk", "primary", "secondary"]);
  type AvoidanceSegment = { x1: number; z1: number; x2: number; z2: number; radius: number };
  const spatialCellSize = 180;
  const roadGrid = new Map<string, AvoidanceSegment[]>();
  const waterGrid = new Map<string, AvoidanceSegment[]>();
  const waterAreaGrid = new Map<string, MapPoint[][]>();
  const colliderGrid = new Map<string, BuildingCollider[]>();
  const yieldIfNeeded = createMainThreadYielder();
  const roads = data.roads.length > 0 ? data.roads : proceduralFallbackRoads();
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
  for (const road of roads) {
    const radius = majorRoads.has(road.kind) ? 15 : road.kind === "service" ? 6 : 9;
    for (let index = 1; index < road.points.length; index++) {
      const [x1, z1] = road.points[index - 1];
      const [x2, z2] = road.points[index];
      const segment = { x1, z1, x2, z2, radius };
      addToGrid(roadGrid, segment, Math.min(x1, x2) - 42, Math.max(x1, x2) + 42, Math.min(z1, z2) - 42, Math.max(z1, z2) + 42);
    }
    await yieldIfNeeded(isCancelled);
  }
  if (data.roads.length === 0 && !scene.userData.proceduralRoadFallback) {
    const roadFallback = new THREE.Group();
    roadFallback.name = "Greater Dhaka procedural road fallback";
    await addRoadNetworkMeshes(roadFallback, roads, "Fallback", isCancelled);
    scene.add(roadFallback);
    scene.userData.proceduralRoadFallback = roadFallback;
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

  const tileCoordinates: Array<{ tileX: number; tileZ: number }> = [];
  for (let tileX = minTileX; tileX <= maxTileX; tileX++) {
    for (let tileZ = minTileZ; tileZ <= maxTileZ; tileZ++) {
      tileCoordinates.push({ tileX, tileZ });
    }
  }
  tileCoordinates.sort((a, b) => (
    Math.hypot(a.tileX * tileSize - initialPosition.x, a.tileZ * tileSize - initialPosition.z) -
    Math.hypot(b.tileX * tileSize - initialPosition.x, b.tileZ * tileSize - initialPosition.z)
  ));
  scene.userData.proceduralDistrictTiles = tiles;

  for (const { tileX, tileZ } of tileCoordinates) {
      const random = coordinateRandom(tileX, tileZ);
      const centerX = tileX * tileSize;
      const centerZ = tileZ * tileSize;
      if (Math.abs(centerX) > FLIGHT_EXTENT.x + tileSize / 2 || Math.abs(centerZ) > FLIGHT_EXTENT.z + tileSize / 2) continue;
      const transforms: THREE.Matrix4[][] = [[], [], []];
      const roofTransforms: THREE.Matrix4[] = [];
      const trunkTransforms: THREE.Matrix4[] = [];
      const foliageTransforms: THREE.Matrix4[] = [];
      const foliageColors: THREE.Color[] = [];
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

      // Full trees: trunk + clustered canopy blobs, each registering a treetop
      // perch so the bird can land anywhere in the city, not just at landmarks.
      const targetTrees = 8 + Math.floor(random() * 6 + tileIntensity * 5);
      for (let index = 0; index < targetTrees; index++) {
        const x = centerX + (random() - 0.5) * (tileSize - 34);
        const z = centerZ + (random() - 0.5) * (tileSize - 34);
        const canopyRadius = 2.9 + random() * 2.4;
        if (blockedByMap(x, z, canopyRadius + 1.5, canopyRadius + 1.5)) continue;
        if (tileColliders.some((collider) => Math.abs(x - collider.x) < collider.halfWidth + canopyRadius && Math.abs(z - collider.z) < collider.halfDepth + canopyRadius)) continue;
        const trunkHeight = 7 + random() * 4.5;
        const trunkThickness = 0.65 + random() * 0.4;
        quaternion.setFromEuler(new THREE.Euler((random() - 0.5) * 0.09, random() * Math.PI, (random() - 0.5) * 0.09));
        position.set(x, trunkHeight / 2 + 0.92, z);
        scale.set(trunkThickness, trunkHeight, trunkThickness);
        trunkTransforms.push(matrix.compose(position, quaternion, scale).clone());
        const crownBase = trunkHeight + 0.92;
        const shade = foliagePalette[Math.floor(random() * foliagePalette.length)];
        const blobCount = 2 + Math.floor(random() * 3);
        let crownTop = crownBase;
        for (let blob = 0; blob < blobCount; blob++) {
          const spread = blob === 0 ? 0 : canopyRadius * (0.35 + random() * 0.5);
          const angle = random() * Math.PI * 2;
          const blobRadius = canopyRadius * (blob === 0 ? 1 : 0.55 + random() * 0.35);
          const blobHeight = blobRadius * (0.82 + random() * 0.3);
          position.set(
            x + Math.cos(angle) * spread,
            crownBase + (blob === 0 ? blobRadius * 0.55 : blobRadius * (0.2 + random() * 0.75)),
            z + Math.sin(angle) * spread,
          );
          quaternion.setFromEuler(new THREE.Euler(random(), random(), random()));
          scale.set(blobRadius, blobHeight, blobRadius);
          foliageTransforms.push(matrix.compose(position, quaternion, scale).clone());
          foliageColors.push(shade.clone().offsetHSL((random() - 0.5) * 0.02, (random() - 0.5) * 0.08, (random() - 0.5) * 0.05));
          crownTop = Math.max(crownTop, position.y + blobHeight * 0.8);
        }
        registerTreePerch({
          position: new THREE.Vector3(x, crownTop - 0.3, z),
          label: "Treetop",
          heading: 0,
          kind: "tree",
        });
      }

      // Ground foliage: low bushes and shrubs scattered between the lots.
      const targetBushes = 8 + Math.floor(random() * 9);
      for (let index = 0; index < targetBushes; index++) {
        const x = centerX + (random() - 0.5) * (tileSize - 24);
        const z = centerZ + (random() - 0.5) * (tileSize - 24);
        const radius = 0.9 + random() * 1.6;
        if (blockedByMap(x, z, radius + 0.8, radius + 0.8)) continue;
        if (tileColliders.some((collider) => Math.abs(x - collider.x) < collider.halfWidth + radius && Math.abs(z - collider.z) < collider.halfDepth + radius)) continue;
        quaternion.setFromEuler(new THREE.Euler(random(), random(), random()));
        position.set(x, 0.92 + radius * 0.55, z);
        scale.set(radius, radius * (0.7 + random() * 0.4), radius);
        foliageTransforms.push(matrix.compose(position, quaternion, scale).clone());
        foliageColors.push(bushPalette[Math.floor(random() * bushPalette.length)].clone().offsetHSL(0, (random() - 0.5) * 0.06, (random() - 0.5) * 0.05));
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
      if (trunkTransforms.length > 0) {
        const trunks = new THREE.InstancedMesh(trunkGeometry, trunkMaterial, trunkTransforms.length);
        trunkTransforms.forEach((transform, index) => trunks.setMatrixAt(index, transform));
        trunks.instanceMatrix.needsUpdate = true;
        trunks.castShadow = true;
        group.add(trunks);
      }
      if (foliageTransforms.length > 0) {
        // Canopies and bushes share one instanced mesh; per-instance colors give
        // the palette variety without extra materials or draw calls.
        const foliage = new THREE.InstancedMesh(foliageGeometry, foliageMaterial, foliageTransforms.length);
        foliageTransforms.forEach((transform, index) => {
          foliage.setMatrixAt(index, transform);
          foliage.setColorAt(index, foliageColors[index]);
        });
        foliage.instanceMatrix.needsUpdate = true;
        if (foliage.instanceColor) foliage.instanceColor.needsUpdate = true;
        foliage.castShadow = true;
        group.add(foliage);
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
  scene.userData.proceduralTileVisibilityRadius = visibilityRadius;
  const immediateCityMass = scene.userData.immediateCityMass as THREE.Group | undefined;
  if (immediateCityMass) immediateCityMass.visible = false;
  const roadFallback = scene.userData.proceduralRoadFallback as THREE.Group | undefined;
  if (roadFallback && data.roads.length > 0) roadFallback.visible = false;
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
  root.name = "OpenStreetMap-accurate Dhaka landmarks";
  const colliders: BuildingCollider[] = [];
  const perches: Perch[] = [];
  const footprintByKind = new Map(DHAKA_LANDMARK_FOOTPRINTS.map((footprint) => [footprint.kind, footprint]));
  const landmarkOsmIds = new Set(DHAKA_LANDMARK_FOOTPRINTS.flatMap((footprint) => footprint.parts.map((part) => part.osmId)));

  const concrete = new THREE.MeshStandardMaterial({ color: 0xc8c1ad, roughness: 0.88 });
  const paleConcrete = new THREE.MeshStandardMaterial({ color: 0xe2dece, roughness: 0.82 });
  const whiteStone = new THREE.MeshStandardMaterial({ color: 0xf0eee6, roughness: 0.76 });
  const brick = new THREE.MeshStandardMaterial({ color: 0x9f5946, roughness: 0.87 });
  const redBrick = new THREE.MeshStandardMaterial({ color: 0xa34c39, roughness: 0.9 });
  const pinkPlaster = new THREE.MeshStandardMaterial({ color: 0xd47a88, roughness: 0.8 });
  const glass = new THREE.MeshPhysicalMaterial({ color: 0x537f88, roughness: 0.2, metalness: 0.16, clearcoat: 0.45 });
  const darkGlass = new THREE.MeshStandardMaterial({ color: 0x294b54, roughness: 0.2, metalness: 0.26 });
  const roof = new THREE.MeshStandardMaterial({ color: 0x596462, roughness: 0.78, metalness: 0.12 });
  const recess = new THREE.MeshStandardMaterial({ color: 0x202625, roughness: 0.98 });
  const accent = new THREE.MeshStandardMaterial({ color: 0xcaa24c, roughness: 0.56, metalness: 0.22 });
  const lawn = new THREE.MeshStandardMaterial({ color: 0x688652, roughness: 1 });
  const water = new THREE.MeshPhysicalMaterial({ color: 0x407e8a, roughness: 0.2, metalness: 0.04, clearcoat: 0.7 });
  const monumentRed = new THREE.MeshStandardMaterial({ color: 0xb92d32, roughness: 0.76 });
  const unitBox = new THREE.BoxGeometry(1, 1, 1);

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
    const mesh = new THREE.Mesh(new THREE.SphereGeometry(radius, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2), material);
    mesh.position.set(...position);
    mesh.castShadow = true;
    parent.add(mesh);
    return mesh;
  };

  // Voxel relief: a pixel-art elevation (strings of palette chars, "." = empty)
  // extruded `depth` voxels and rendered as one InstancedMesh per material.
  // `position` is the centre of the grid's bottom edge.
  const addVoxelRelief = (
    parent: THREE.Object3D,
    rows: string[],
    palette: Record<string, THREE.Material>,
    voxel: number,
    position: [number, number, number],
    options?: { depth?: number; rotationY?: number; leanX?: number },
  ) => {
    const group = new THREE.Group();
    group.position.set(...position);
    if (options?.rotationY) group.rotation.y = options.rotationY;
    if (options?.leanX) group.rotation.x = options.leanX;
    const depth = options?.depth ?? 1;
    const gridWidth = rows[0].length;
    const counts = new Map<string, number>();
    for (const row of rows) for (const cell of row) if (cell !== ".") counts.set(cell, (counts.get(cell) ?? 0) + depth);
    const matrix = new THREE.Matrix4();
    const quaternion = new THREE.Quaternion();
    const scale = new THREE.Vector3(voxel, voxel, voxel);
    const voxelPosition = new THREE.Vector3();
    for (const [cell, count] of counts) {
      const material = palette[cell];
      if (!material) continue;
      const instanced = new THREE.InstancedMesh(unitBox, material, count);
      instanced.castShadow = true;
      instanced.receiveShadow = true;
      let index = 0;
      rows.forEach((row, rowIndex) => {
        for (let column = 0; column < row.length; column++) {
          if (row[column] !== cell) continue;
          for (let layer = 0; layer < depth; layer++) {
            voxelPosition.set(
              (column - (gridWidth - 1) / 2) * voxel,
              (rows.length - 1 - rowIndex) * voxel + voxel / 2,
              (layer - (depth - 1) / 2) * voxel,
            );
            matrix.compose(voxelPosition, quaternion, scale);
            instanced.setMatrixAt(index++, matrix);
          }
        }
      });
      group.add(instanced);
    }
    parent.add(group);
    return group;
  };

  const addLabel = (position: THREE.Vector3, text: string, parent: THREE.Object3D = root) => {
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
    parent.add(label);
  };

  const partMaterial = (kind: DhakaLandmark["kind"], part: LandmarkFootprintPart) => {
    if (part.role === "water") return water;
    if (part.role === "ground") {
      if (kind === "amphitheatre" || kind === "shaheed-minar") return paleConcrete;
      return lawn;
    }
    if (kind === "church") return part.role === "tower" ? paleConcrete : whiteStone;
    if (kind === "bashundhara-city") return part.role === "tower" ? glass : paleConcrete;
    if (kind === "police-plaza") return glass;
    if (kind === "brac") return brick;
    if (kind === "hotel") return darkGlass;
    if (kind === "parliament") return concrete;
    if (kind === "lalbagh-fort") return part.role === "tomb" ? whiteStone : redBrick;
    if (kind === "ahsan-manzil") return pinkPlaster;
    if (kind === "curzon-hall") return redBrick;
    if (kind === "baitul-mukarram") return paleConcrete;
    return whiteStone;
  };

  const partBounds = new Map<number, { minX: number; maxX: number; minZ: number; maxZ: number; height: number }>();
  const allBounds = new Map<DhakaLandmark["kind"], { minX: number; maxX: number; minZ: number; maxZ: number; top: number }>();

  for (const landmark of DHAKA_LANDMARKS) {
    const footprint = footprintByKind.get(landmark.kind);
    if (!footprint) {
      const center = coordinatesToWorld(landmark.lat, landmark.lon);
      const halfWidth = landmark.kind === "airport" ? 150 : 28;
      const halfDepth = landmark.kind === "airport" ? 85 : 22;
      allBounds.set(landmark.kind, {
        minX: center.x - halfWidth,
        maxX: center.x + halfWidth,
        minZ: center.y - halfDepth,
        maxZ: center.y + halfDepth,
        top: landmark.altitude,
      });
      continue;
    }
    let minX = Infinity;
    let maxX = -Infinity;
    let minZ = Infinity;
    let maxZ = -Infinity;
    let top = 0;

    for (const part of footprint.parts) {
      const points = part.points.map(([lat, lon]) => {
        const world = coordinatesToWorld(lat, lon);
        return [world.x, world.y] as MapPoint;
      });
      const xs = points.map(([x]) => x);
      const zs = points.map(([, z]) => z);
      const partMinX = Math.min(...xs);
      const partMaxX = Math.max(...xs);
      const partMinZ = Math.min(...zs);
      const partMaxZ = Math.max(...zs);
      partBounds.set(part.osmId, { minX: partMinX, maxX: partMaxX, minZ: partMinZ, maxZ: partMaxZ, height: part.height });
      if (part.role !== "ground" && part.role !== "water") {
        minX = Math.min(minX, partMinX);
        maxX = Math.max(maxX, partMaxX);
        minZ = Math.min(minZ, partMinZ);
        maxZ = Math.max(maxZ, partMaxZ);
        top = Math.max(top, part.height);
      }

      const geometry = new THREE.ExtrudeGeometry(polygonShape(points), {
        depth: part.height,
        bevelEnabled: false,
        curveSegments: 1,
      });
      geometry.rotateX(-Math.PI / 2);
      const mesh = new THREE.Mesh(geometry, partMaterial(landmark.kind, part));
      mesh.name = `${landmark.label} · OSM ${part.osmId} · ${part.role}`;
      mesh.position.y = part.role === "water" ? 0.72 : 0.9;
      mesh.castShadow = part.role !== "ground" && part.role !== "water";
      mesh.receiveShadow = true;
      mesh.userData.osmId = part.osmId;
      root.add(mesh);
    }

    if (!Number.isFinite(minX)) {
      const center = coordinatesToWorld(landmark.lat, landmark.lon);
      minX = center.x - 30;
      maxX = center.x + 30;
      minZ = center.y - 20;
      maxZ = center.y + 20;
      top = landmark.altitude;
    }
    allBounds.set(landmark.kind, { minX, maxX, minZ, maxZ, top });
  }

  // Landmarks with no OSM masses to align with may orient details by heading;
  // footprint-anchored details must stay in world space like the masses they decorate.
  const proceduralKinds = new Set<DhakaLandmark["kind"]>(["shaheed-minar", "amphitheatre", "bangladesh-bank", "airport"]);

  const detailGroup = (landmark: DhakaLandmark) => {
    const bounds = allBounds.get(landmark.kind)!;
    const group = new THREE.Group();
    group.name = `${landmark.label} signature architecture`;
    group.position.set((bounds.minX + bounds.maxX) / 2, 0.9, (bounds.minZ + bounds.maxZ) / 2);
    if (proceduralKinds.has(landmark.kind)) group.rotation.y = landmark.heading;
    root.add(group);
    const anchor = (osmId: number) => {
      const part = partBounds.get(osmId);
      if (!part) return null;
      return {
        x: (part.minX + part.maxX) / 2 - group.position.x,
        z: (part.minZ + part.maxZ) / 2 - group.position.z,
        width: part.maxX - part.minX,
        depth: part.maxZ - part.minZ,
        height: part.height,
      };
    };
    return {
      group,
      anchor,
      width: Math.max(8, bounds.maxX - bounds.minX),
      depth: Math.max(8, bounds.maxZ - bounds.minZ),
      top: bounds.top > 0 ? bounds.top : landmark.altitude,
    };
  };

  for (const landmark of DHAKA_LANDMARKS) {
    const { group, anchor, width, depth, top } = detailGroup(landmark);

    if (landmark.kind === "church") {
      const tower = anchor(983631140);
      if (tower) {
        const spire = new THREE.Mesh(new THREE.ConeGeometry(Math.min(tower.width, tower.depth) * 0.52, 14, 8), roof);
        spire.position.set(tower.x, tower.height + 7, tower.z);
        spire.castShadow = true;
        group.add(spire);
        addBox(group, [0.7, 6, 0.7], [tower.x, tower.height + 17, tower.z], accent);
        addBox(group, [3.4, 0.7, 0.7], [tower.x, tower.height + 18.2, tower.z], accent);
      }
      for (const osmId of [983631141, 983631142]) {
        const upper = anchor(osmId);
        if (!upper) continue;
        const pinnacle = new THREE.Mesh(new THREE.ConeGeometry(Math.min(upper.width, upper.depth) * 0.42, 6, 8), roof);
        pinnacle.position.set(upper.x, upper.height + 3, upper.z);
        pinnacle.castShadow = true;
        group.add(pinnacle);
      }
    } else if (landmark.kind === "bashundhara-city") {
      const tower = anchor(1092674471);
      if (tower) {
        for (let y = 7; y < tower.height - 3; y += 4.6) {
          addBox(group, [tower.width * 1.04, 0.55, tower.depth * 1.04], [tower.x, y, tower.z], paleConcrete);
        }
        addBox(group, [tower.width * 0.94, 1.8, tower.depth * 0.94], [tower.x, tower.height + 0.9, tower.z], roof);
      }
      const core = anchor(1092674472);
      if (core) {
        addDome(group, Math.max(3.2, Math.min(core.width, core.depth) * 0.52), [core.x, core.height + 0.4, core.z], glass);
        addCylinder(group, 0.5, 0.9, 11, [core.x, core.height + 6, core.z], accent, 8);
      }
    } else if (landmark.kind === "amphitheatre") {
      for (let tier = 0; tier < 7; tier++) {
        const seating = new THREE.Mesh(
          new THREE.TorusGeometry(Math.min(width, depth) * (0.18 + tier * 0.045), 0.75, 5, 40, Math.PI),
          tier % 2 ? concrete : paleConcrete,
        );
        seating.rotation.x = Math.PI / 2;
        seating.rotation.z = Math.PI;
        seating.position.set(0, 1.5 + tier * 1.25, depth * 0.08 - tier * 0.7);
        seating.castShadow = true;
        group.add(seating);
      }
    } else if (landmark.kind === "police-plaza") {
      const mass = anchor(366560370);
      if (mass) {
        addBox(group, [Math.max(5, mass.width * 0.09), mass.height * 0.96, mass.depth * 1.03], [mass.x, mass.height * 0.48, mass.z], paleConcrete);
        for (let y = 10; y < mass.height - 4; y += 7.4) {
          addBox(group, [mass.width * 1.03, 0.6, mass.depth * 1.03], [mass.x, y, mass.z], paleConcrete);
        }
        addBox(group, [mass.width * 0.9, 2.2, mass.depth * 1.04], [mass.x, mass.height + 1.1, mass.z], roof);
      }
    } else if (landmark.kind === "brac") {
      const mass = anchor(229029081);
      if (mass) {
        addBox(group, [mass.width * 0.18, mass.height * 0.92, mass.depth * 1.02], [mass.x + mass.width * 0.2, mass.height * 0.46, mass.z], darkGlass);
        for (let y = 8; y < mass.height - 4; y += 6.5) {
          addBox(group, [mass.width * 1.02, 0.6, mass.depth * 1.02], [mass.x, y, mass.z], paleConcrete);
        }
        addBox(group, [mass.width, 1.8, mass.depth], [mass.x, mass.height + 0.9, mass.z], roof);
      }
    } else if (landmark.kind === "hotel") {
      const mass = anchor(498432169);
      if (mass) {
        for (let y = 10; y < mass.height - 5; y += 8) {
          addBox(group, [mass.width * 1.02, 0.65, mass.depth * 1.02], [mass.x, y, mass.z], paleConcrete);
        }
        addBox(group, [mass.width * 0.7, 3.5, mass.depth * 0.7], [mass.x, mass.height + 1.7, mass.z], roof);
        addBox(group, [4, 6, 4], [mass.x, mass.height + 5.5, mass.z], accent);
      }
    } else if (landmark.kind === "parliament") {
      const drum = anchor(443037035);
      if (drum) {
        addCylinder(group, Math.min(drum.width, drum.depth) * 0.34, Math.min(drum.width, drum.depth) * 0.44, 8, [drum.x, drum.height + 4, drum.z], concrete, 8);
      }
      const ring = anchor(443036732);
      if (ring) {
        // Louis Kahn's signature geometric voids, sunk flush into the assembly drum walls.
        const cutout = (radius: number, segments: number, x: number, y: number, z: number, alongX: boolean) => {
          const disk = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, 1.6, segments), recess);
          disk.position.set(x, y, z);
          if (alongX) disk.rotation.z = Math.PI / 2;
          else disk.rotation.x = Math.PI / 2;
          group.add(disk);
        };
        cutout(8, 32, ring.x, ring.height * 0.55, ring.z - ring.depth * 0.5, false);
        cutout(8, 32, ring.x, ring.height * 0.55, ring.z + ring.depth * 0.5, false);
        cutout(7, 3, ring.x - ring.width * 0.5, ring.height * 0.52, ring.z, true);
        cutout(7, 3, ring.x + ring.width * 0.5, ring.height * 0.52, ring.z, true);
      }
    } else if (landmark.kind === "lalbagh-fort") {
      const grounds = anchor(624024881);
      if (grounds) {
        const halfWidth = grounds.width / 2 - 2;
        const halfDepth = grounds.depth / 2 - 2;
        addBox(group, [grounds.width - 4, 4.5, 1.8], [grounds.x, 2.6, grounds.z - halfDepth], redBrick);
        addBox(group, [grounds.width - 4, 4.5, 1.8], [grounds.x, 2.6, grounds.z + halfDepth], redBrick);
        addBox(group, [1.8, 4.5, grounds.depth - 4], [grounds.x - halfWidth, 2.6, grounds.z], redBrick);
        addBox(group, [1.8, 4.5, grounds.depth - 4], [grounds.x + halfWidth, 2.6, grounds.z], redBrick);
        for (const [sideX, sideZ] of [[-1, -1], [1, -1], [-1, 1], [1, 1]] as const) {
          const cornerX = grounds.x + sideX * halfWidth;
          const cornerZ = grounds.z + sideZ * halfDepth;
          addCylinder(group, 3.4, 3.8, 7, [cornerX, 3.5, cornerZ], redBrick, 12);
          addDome(group, 3.3, [cornerX, 7, cornerZ], whiteStone);
        }
      }
      const tomb = anchor(624024857);
      if (tomb) {
        const domeRadius = Math.max(5, Math.min(tomb.width, tomb.depth) * 0.38);
        addDome(group, domeRadius, [tomb.x, tomb.height, tomb.z], whiteStone);
        addCylinder(group, 0.35, 0.6, 3.2, [tomb.x, tomb.height + domeRadius + 1.4, tomb.z], accent, 8);
      }
      const mosque = anchor(624024874);
      if (mosque) {
        const alongX = mosque.width >= mosque.depth;
        const spacing = Math.max(mosque.width, mosque.depth) * 0.3;
        for (const step of [-1, 0, 1]) {
          const radius = step === 0 ? 3.8 : 3.1;
          addDome(group, radius, [mosque.x + (alongX ? step * spacing : 0), mosque.height, mosque.z + (alongX ? 0 : step * spacing)], whiteStone);
        }
      }
      const gate = anchor(624024884);
      if (gate) {
        addBox(group, [gate.width * 0.5, 4, gate.depth * 0.5], [gate.x, gate.height + 2, gate.z], redBrick);
        addDome(group, Math.max(2.4, Math.min(gate.width, gate.depth) * 0.26), [gate.x, gate.height + 4, gate.z], whiteStone);
      }
    } else if (landmark.kind === "ahsan-manzil") {
      const palace = anchor(624025793);
      if (palace) {
        addBox(group, [palace.width * 1.03, 1.1, palace.depth * 1.03], [palace.x, palace.height + 0.4, palace.z], whiteStone);
        const domeRadius = clamp(Math.min(palace.width, palace.depth) * 0.28, 5, 8.5);
        addCylinder(group, domeRadius * 1.12, domeRadius * 1.3, 5, [palace.x, palace.height + 2.5, palace.z], pinkPlaster, 8);
        addCylinder(group, domeRadius * 0.94, domeRadius * 1.04, 2.4, [palace.x, palace.height + 6.2, palace.z], whiteStone, 8);
        addDome(group, domeRadius, [palace.x, palace.height + 7, palace.z], pinkPlaster);
        addCylinder(group, 0.4, 0.7, 4, [palace.x, palace.height + 7 + domeRadius + 1.8, palace.z], accent, 8);
        // Pilaster rhythm along the river-facing south facade.
        const alongX = palace.width >= palace.depth;
        const span = (alongX ? palace.width : palace.depth) * 0.42;
        for (let index = 0; index < 7; index++) {
          const offset = -span + (2 * span * index) / 6;
          const pilasterX = palace.x + (alongX ? offset : palace.width / 2 + 0.3);
          const pilasterZ = palace.z + (alongX ? palace.depth / 2 + 0.3 : offset);
          addBox(group, alongX ? [1.4, palace.height * 0.82, 1] : [1, palace.height * 0.82, 1.4], [pilasterX, palace.height * 0.44, pilasterZ], whiteStone);
        }
        addBox(group, [10, 1.4, 6], [palace.x, 0.8, palace.z + palace.depth / 2 + 3.2], whiteStone);
        addBox(group, [13, 0.7, 9], [palace.x, 0.35, palace.z + palace.depth / 2 + 4.4], paleConcrete);
      }
    } else if (landmark.kind === "shaheed-minar") {
      addBox(group, [44, 0.6, 28], [0, 0.3, 2], paleConcrete);
      addBox(group, [40, 1.2, 23], [0, 0.9, 0], whiteStone);
      // Voxel-art elevation: five column-and-lintel frames bowing forward,
      // the mother frame tallest at centre, the red sun rising behind.
      addVoxelRelief(
        group,
        [
          "..RRRR..",
          ".RRRRRR.",
          "RRRRRRRR",
          "RRRRRRRR",
          "RRRRRRRR",
          "RRRRRRRR",
          ".RRRRRR.",
          "..RRRR..",
        ],
        { R: monumentRed },
        1.4,
        [4.5, 4.2, -3.6],
        { depth: 1 },
      );
      addVoxelRelief(
        group,
        [
          "..........WWWW..........",
          "..........W..W..........",
          ".....WWWW.W..W.WWWW.....",
          ".....W..W.W..W.W..W.....",
          "WWWW.W..W.W..W.W..W.WWWW",
          "W..W.W..W.W..W.W..W.W..W",
          "W..W.W..W.W..W.W..W.W..W",
          "W..W.W..W.W..W.W..W.W..W",
          "W..W.W..W.W..W.W..W.W..W",
          "W..W.W..W.W..W.W..W.W..W",
        ],
        { W: whiteStone },
        1.6,
        [0, 1.4, 0],
        { depth: 1, leanX: -0.15 },
      );
    } else if (landmark.kind === "curzon-hall") {
      const mass = anchor(264272612);
      if (mass) {
        addBox(group, [mass.width * 1.02, 0.7, mass.depth * 1.02], [mass.x, 5.5, mass.z], whiteStone);
        addBox(group, [mass.width * 1.02, 0.7, mass.depth * 1.02], [mass.x, 11.5, mass.z], whiteStone);
        addCylinder(group, 6.5, 7.5, 4.5, [mass.x, mass.height + 2, mass.z], whiteStone, 16);
        addDome(group, 6.5, [mass.x, mass.height + 4, mass.z], redBrick);
        addCylinder(group, 0.4, 0.7, 3.4, [mass.x, mass.height + 11.6, mass.z], accent, 8);
        const cornerX = mass.width / 2 - 4;
        const cornerZ = mass.depth / 2 - 4;
        for (const [sideX, sideZ] of [[-1, -1], [1, -1], [-1, 1], [1, 1]] as const) {
          addCylinder(group, 1.6, 1.8, 4, [mass.x + sideX * cornerX, mass.height + 1.6, mass.z + sideZ * cornerZ], whiteStone, 10);
          addDome(group, 2, [mass.x + sideX * cornerX, mass.height + 3.6, mass.z + sideZ * cornerZ], whiteStone);
        }
      }
    } else if (landmark.kind === "baitul-mukarram") {
      const mass = anchor(186664126);
      if (mass) {
        addBox(group, [mass.width * 0.6, 2.2, mass.depth * 0.6], [mass.x, mass.height + 1.1, mass.z], whiteStone);
        // Voxel arch screens: rows of recessed pointed arches sunk into every
        // facade of the great white cube, in repeating 5-column units.
        const voxel = 2.2;
        const archRows = (columns: number) => {
          const lines: string[] = [];
          for (let row = 0; row < 10; row++) {
            let line = "";
            for (let column = 0; column < columns; column++) {
              const phase = column % 5;
              if (row === 0) line += ".";
              else if (row === 1) line += phase === 2 ? "D" : ".";
              else line += phase >= 1 && phase <= 3 ? "D" : ".";
            }
            lines.push(line);
          }
          return lines;
        };
        const screenColumns = (wallLength: number) => Math.max(6, Math.floor((wallLength - 10) / voxel));
        for (const side of [-1, 1]) {
          addVoxelRelief(group, archRows(screenColumns(mass.width)), { D: recess }, voxel, [mass.x, 3, mass.z + side * (mass.depth / 2 - 0.6)], { depth: 1 });
          addVoxelRelief(group, archRows(screenColumns(mass.depth)), { D: recess }, voxel, [mass.x + side * (mass.width / 2 - 0.6), 3, mass.z], { depth: 1, rotationY: Math.PI / 2 });
        }
        const minaretX = mass.x + mass.width * 0.6;
        const minaretZ = mass.z + mass.depth * 0.52;
        addCylinder(group, 2.6, 3.1, 50, [minaretX, 25, minaretZ], paleConcrete, 12);
        addCylinder(group, 4.2, 4.2, 1.6, [minaretX, 50.8, minaretZ], whiteStone, 12);
        addCylinder(group, 1.9, 2.3, 10, [minaretX, 56.5, minaretZ], paleConcrete, 12);
        addDome(group, 2.2, [minaretX, 61.5, minaretZ], whiteStone);
        addCylinder(group, 0.35, 0.6, 4.5, [minaretX, 65.5, minaretZ], accent, 8);
      }
    } else if (landmark.kind === "bangladesh-bank") {
      addBox(group, [width * 0.9, 8, depth * 0.92], [0, 4, 0], concrete);
      const shaftHeight = top - 10;
      addBox(group, [width * 0.72, shaftHeight, depth * 0.66], [0, shaftHeight / 2 + 7, 0], darkGlass);
      for (let y = 14; y < top - 6; y += 7) {
        addBox(group, [width * 0.75, 0.8, depth * 0.69], [0, y, 0], paleConcrete);
      }
      addBox(group, [width * 0.78, 2.6, depth * 0.72], [0, top - 1.5, 0], roof);
      addBox(group, [5, 9, 5], [0, top + 2.5, 0], accent);
    } else if (landmark.kind === "airport") {
      const runway = addBox(group, [72, 1.2, 3_200], [0, 0.35, 0], recess);
      runway.receiveShadow = true;
      addBox(group, [11, 0.4, 3_040], [0, 1.05, 0], paleConcrete);
      for (let offset = -1_430; offset <= 1_430; offset += 105) {
        addBox(group, [2.2, 0.45, 42], [0, 1.35, offset], whiteStone);
      }
      for (const side of [-1, 1]) {
        addBox(group, [18, 0.55, 3_100], [side * 94, 0.8, 0], concrete);
        for (let offset = -1_500; offset <= 1_500; offset += 60) {
          addCylinder(group, 0.8, 0.8, 0.5, [side * 38, 1.45, offset], side < 0 ? monumentRed : accent, 8);
        }
      }
      addBox(group, [290, 16, 72], [-245, 8, -300], paleConcrete);
      addBox(group, [230, 8, 126], [-250, 4, -205], concrete);
      for (const gate of [-120, -40, 40, 120]) {
        addBox(group, [13, 5, 55], [-202 + gate, 5, -120], glass);
      }
      addCylinder(group, 11, 15, 52, [-390, 26, -245], concrete, 12);
      addCylinder(group, 20, 15, 8, [-390, 55, -245], darkGlass, 12);
      addCylinder(group, 1.2, 1.2, 13, [-390, 65.5, -245], accent, 8);
    }

    const bounds = allBounds.get(landmark.kind)!;
    colliders.push({
      x: (bounds.minX + bounds.maxX) / 2,
      z: (bounds.minZ + bounds.maxZ) / 2,
      halfWidth: Math.max(3, (bounds.maxX - bounds.minX) / 2),
      halfDepth: Math.max(3, (bounds.maxZ - bounds.minZ) / 2),
      top,
    });
    const world = coordinatesToWorld(landmark.lat, landmark.lon);
    const perch = {
      position: new THREE.Vector3(world.x, top, world.y),
      label: landmark.label,
      heading: landmark.heading,
    };
    perches.push(perch);
    addLabel(perch.position.clone().add(new THREE.Vector3(0, 24, 0)), landmark.label);
  }

  const METRO_DECK_Y = 18;
  type MetroStationSpec = { label: string; x: number; z: number };

  const disposeMetroGroup = (group: THREE.Group) => {
    group.traverse((object) => {
      if (object instanceof THREE.Sprite) {
        object.material.map?.dispose();
        object.material.dispose();
        return;
      }
      if (object instanceof THREE.Mesh && object.geometry !== unitBox) object.geometry.dispose();
    });
    root.remove(group);
  };

  const buildMetro = (centerline: THREE.Vector3[], stationSpecs: MetroStationSpec[]) => {
    const metroRoot = new THREE.Group();
    metroRoot.name = "Dhaka MRT Line 6";
    const metroCurve = new THREE.CatmullRomCurve3(centerline, false, "centripetal", 0.28);
    const curveLength = metroCurve.getLength();
    const guidewayMaterial = new THREE.MeshStandardMaterial({ color: 0xc9c7bd, roughness: 0.78 });
    const metroRed = new THREE.MeshStandardMaterial({ color: 0xb72e36, roughness: 0.58, metalness: 0.18 });
    const metroGlass = new THREE.MeshPhysicalMaterial({ color: 0x365d68, roughness: 0.2, metalness: 0.18, clearcoat: 0.5 });
    const metroSteel = new THREE.MeshStandardMaterial({ color: 0xd2d6d9, roughness: 0.42, metalness: 0.55 });
    const RAIL_TOP_Y = METRO_DECK_Y + 0.9;
    const TRACK_OFFSET = 2.6;

    // Box-girder guideway: a chain of rectangular boxes swept along the curve, resting on the piers.
    // Sample counts scale with the line's true length so the dense OSM track geometry
    // and the coarse station-to-station fallback both render smoothly.
    const GIRDER_SAMPLES = Math.min(560, Math.max(160, Math.round(curveLength / 90)));
    let girderPrev = metroCurve.getPointAt(0);
    for (let index = 1; index <= GIRDER_SAMPLES; index++) {
      const point = metroCurve.getPointAt(index / GIRDER_SAMPLES);
      const midX = (girderPrev.x + point.x) / 2;
      const midY = (girderPrev.y + point.y) / 2;
      const midZ = (girderPrev.z + point.z) / 2;
      const dx = point.x - girderPrev.x;
      const dz = point.z - girderPrev.z;
      const segLength = Math.hypot(dx, dz) + 0.7;
      const girder = addBox(metroRoot, [segLength, 2.4, 9.6], [midX, midY - 1.2, midZ], guidewayMaterial);
      girder.rotation.y = Math.atan2(-dz, dx);
      girderPrev = point;
    }
    // Two running rails sitting on top of the girder deck, offset perpendicular to the track (dual-track).
    const RAIL_SAMPLES = GIRDER_SAMPLES;
    for (const track of [-1, 1]) {
      const railPoints: THREE.Vector3[] = [];
      for (let index = 0; index <= RAIL_SAMPLES; index++) {
        const u = index / RAIL_SAMPLES;
        const p = metroCurve.getPointAt(u);
        const t = metroCurve.getTangentAt(u);
        const perpLength = Math.hypot(t.z, t.x) || 1;
        railPoints.push(new THREE.Vector3(
          p.x + (-t.z / perpLength) * track * TRACK_OFFSET,
          RAIL_TOP_Y,
          p.z + (t.x / perpLength) * track * TRACK_OFFSET,
        ));
      }
      const railCurve = new THREE.CatmullRomCurve3(railPoints, false, "centripetal", 0.5);
      metroRoot.add(new THREE.Mesh(new THREE.TubeGeometry(railCurve, RAIL_SAMPLES, 0.4, 5, false), metroRed));
    }
    const PIER_COUNT = Math.max(24, Math.round(curveLength / 260));
    for (let index = 1; index < PIER_COUNT; index++) {
      const point = metroCurve.getPointAt(index / PIER_COUNT);
      const pierHeight = Math.max(5, point.y - 0.5);
      addCylinder(metroRoot, 2.4, 3.8, pierHeight, [point.x, pierHeight / 2, point.z], concrete, 8);
      addBox(metroRoot, [18, 2.2, 4.2], [point.x, point.y - 3, point.z], concrete);
    }

    // Project each station onto the curve: nearest arc-length parameter wins. Stations
    // further than 200 m from the line are dropped as bad data.
    const PROJECTION_SAMPLES = 1600;
    const stations = stationSpecs
      .map((spec) => {
        let bestU = 0;
        let bestDistanceSquared = Infinity;
        for (let index = 0; index <= PROJECTION_SAMPLES; index++) {
          const sample = metroCurve.getPointAt(index / PROJECTION_SAMPLES);
          const distanceSquared = (sample.x - spec.x) ** 2 + (sample.z - spec.z) ** 2;
          if (distanceSquared < bestDistanceSquared) {
            bestDistanceSquared = distanceSquared;
            bestU = index / PROJECTION_SAMPLES;
          }
        }
        return { label: spec.label, u: bestU, distance: Math.sqrt(bestDistanceSquared) };
      })
      .filter((station) => station.distance < 200)
      .sort((a, b) => a.u - b.u);

    // Elevated station hall: platform deck, glazed sides, a vaulted (arch-profile) roof, and stair blocks to street level.
    const VAULT_RADIUS = 13;
    const VAULT_RISE = 0.55;
    const ROOF_BASE_Y = 11;
    const stationVaultGeometry = new THREE.CylinderGeometry(VAULT_RADIUS, VAULT_RADIUS, 90, 20, 1, true, 0, Math.PI);
    for (const station of stations) {
      const point = metroCurve.getPointAt(station.u);
      const tangent = metroCurve.getTangentAt(station.u);
      const stationGroup = new THREE.Group();
      stationGroup.name = `${station.label} MRT station`;
      stationGroup.position.copy(point);
      stationGroup.rotation.y = Math.atan2(-tangent.z, tangent.x);
      // Platform deck (station long axis runs along local X, over the tracks).
      addBox(stationGroup, [98, 3, 22], [0, 0.5, 0], concrete);
      for (const side of [-1, 1]) addBox(stationGroup, [98, 0.35, 0.6], [0, 2.1, side * 10.4], metroRed);
      // Supporting columns and glazed side walls up to the eaves.
      for (const side of [-1, 1]) {
        for (const x of [-40, -20, 0, 20, 40]) addBox(stationGroup, [1.8, ROOF_BASE_Y - 2, 1.8], [x, (ROOF_BASE_Y + 2) / 2, side * 11.4], concrete);
        addBox(stationGroup, [90, ROOF_BASE_Y - 2, 0.4], [0, (ROOF_BASE_Y + 2) / 2, side * 11.4], metroGlass);
      }
      for (const end of [-1, 1]) addBox(stationGroup, [0.6, ROOF_BASE_Y - 2, 24], [end * 45, (ROOF_BASE_Y + 2) / 2, 0], metroGlass);
      // Vaulted roof (half-cylinder arch), flattened a little, with a red line-colour accent along the eaves and ridge.
      const vault = new THREE.Mesh(stationVaultGeometry, whiteStone);
      vault.rotation.z = Math.PI / 2;
      vault.position.y = ROOF_BASE_Y;
      vault.scale.x = VAULT_RISE;
      vault.castShadow = true;
      vault.receiveShadow = true;
      stationGroup.add(vault);
      for (const side of [-1, 1]) addBox(stationGroup, [92, 0.9, 0.7], [0, ROOF_BASE_Y, side * VAULT_RADIUS], metroRed);
      addBox(stationGroup, [92, 0.3, 1.2], [0, ROOF_BASE_Y + VAULT_RADIUS * VAULT_RISE, 0], metroRed);
      // Two entrance stair blocks angling down to street level on either side.
      for (const side of [-1, 1]) {
        const run = 23;
        const drop = 18;
        const slope = Math.hypot(run, drop);
        const stair = addBox(stationGroup, [8, 2.6, slope], [0, -drop / 2, side * (11 + run / 2)], concrete);
        stair.rotation.x = side * Math.atan2(drop, run);
        addBox(stationGroup, [10, 3, 6], [0, -drop + 0.5, side * (11 + run + 2)], paleConcrete);
      }
      metroRoot.add(stationGroup);
      addLabel(point.clone().add(new THREE.Vector3(0, 42, 0)), `${station.label} · MRT 6`, metroRoot);
    }

    // Stainless-steel 6-car trainset, magenta/red Line-6 stripe, dark window band, rounded nose cabs at both ends.
    const CAR_COUNT = 6;
    const CAR_LEN = 19.8;
    const CAR_PITCH = 21;
    const CAR_W = 3;
    const buildTrain = () => {
      const train = new THREE.Group();
      train.name = "MRT Line 6 trainset";
      for (let car = 0; car < CAR_COUNT; car++) {
        const z = (car - (CAR_COUNT - 1) / 2) * CAR_PITCH;
        addBox(train, [CAR_W, 3.2, CAR_LEN], [0, 2.6, z], metroSteel);
        addBox(train, [CAR_W + 0.04, 1.1, CAR_LEN - 2.4], [0, 3.1, z], darkGlass);
        addBox(train, [CAR_W + 0.06, 0.55, CAR_LEN - 0.6], [0, 2.15, z], metroRed);
        addBox(train, [CAR_W - 0.5, 0.5, CAR_LEN - 0.4], [0, 4.35, z], metroSteel);
        addBox(train, [0.8, 0.22, CAR_LEN - 0.4], [0, 4.62, z], metroRed);
        for (const b of [-1, 1]) addBox(train, [2.4, 0.9, 3.6], [0, 0.35, z + b * 6.4], recess);
        // Nose cab detailing on the two end cars.
        if (car === 0 || car === CAR_COUNT - 1) {
          const dir = car === 0 ? -1 : 1;
          const tip = z + dir * (CAR_LEN / 2);
          addBox(train, [CAR_W - 0.4, 2.6, 1.4], [0, 2.4, tip - dir * 0.7], metroSteel);
          const windshield = addBox(train, [CAR_W - 0.1, 2.2, 0.5], [0, 3.2, tip - dir * 0.9], darkGlass);
          windshield.rotation.x = dir * 0.42;
          addBox(train, [CAR_W - 0.2, 0.5, 0.35], [0, 1.9, tip - dir * 0.2], metroRed);
        }
      }
      train.traverse((object) => { object.frustumCulled = false; });
      return train;
    };

    // Ping-pong stop sequence over the projected station parameters: run up the line
    // stopping at each station, dwell at the terminus, run back down.
    const stationU = stations.map((station) => station.u);
    const stops = stationU.length >= 2 ? stationU : [0, 1];
    const stopSeq = [...stops, ...stops.slice(0, -1).reverse()];
    const CRUISE = 0.04; // arc-fraction per second
    const DWELL = 2.4; // seconds stopped at each station
    const segDur = stopSeq.map((u, i) => Math.abs(stopSeq[(i + 1) % stopSeq.length] - u) / CRUISE);
    const dirSign = stopSeq.map((u, i) => {
      const next = stopSeq[(i + 1) % stopSeq.length] - u;
      if (Math.abs(next) > 1e-6) return Math.sign(next);
      const prev = u - stopSeq[(i - 1 + stopSeq.length) % stopSeq.length];
      return Math.sign(prev) || 1;
    });
    const cycle = segDur.reduce((sum, d) => sum + d + DWELL, 0);
    const runner = (time: number, phase: number) => {
      let tp = (time + phase) % cycle;
      if (tp < 0) tp += cycle;
      let acc = 0;
      for (let i = 0; i < stopSeq.length; i++) {
        if (tp < acc + DWELL) return { u: stopSeq[i], dir: dirSign[i] };
        acc += DWELL;
        if (tp < acc + segDur[i]) {
          const f = segDur[i] > 0 ? (tp - acc) / segDur[i] : 1;
          const ease = f * f * (3 - 2 * f);
          const next = stopSeq[(i + 1) % stopSeq.length];
          return { u: stopSeq[i] + (next - stopSeq[i]) * ease, dir: dirSign[i] };
        }
        acc += segDur[i];
      }
      return { u: stopSeq[0], dir: dirSign[0] };
    };

    const TRAIN_COUNT = 3;
    const trains = Array.from({ length: TRAIN_COUNT }, (_, i) => {
      const train = buildTrain();
      metroRoot.add(train);
      return { train, phase: (cycle * i) / TRAIN_COUNT };
    });
    const trainPoint = new THREE.Vector3();
    const trainTangent = new THREE.Vector3();
    const trainPerp = new THREE.Vector3();
    const trainTarget = new THREE.Vector3();
    scene.userData.metroRailUpdate = (time: number) => {
      for (const { train, phase } of trains) {
        const { u, dir } = runner(time, phase);
        const cu = Math.min(Math.max(u, 0), 1);
        metroCurve.getPointAt(cu, trainPoint);
        metroCurve.getTangentAt(cu, trainTangent);
        trainPerp.set(-trainTangent.z, 0, trainTangent.x).normalize();
        const side = dir >= 0 ? 1 : -1;
        train.position.copy(trainPoint).addScaledVector(trainPerp, side * TRACK_OFFSET);
        train.position.y = RAIL_TOP_Y;
        trainTarget.copy(train.position).addScaledVector(trainTangent, dir >= 0 ? 1 : -1);
        train.lookAt(trainTarget);
      }
    };
    root.add(metroRoot);
    return metroRoot;
  };

  const fallbackStationSpecs: MetroStationSpec[] = MRT_LINE_6_STATIONS.map((station) => {
    const world = coordinatesToWorld(station.lat, station.lon);
    return { label: station.label, x: world.x, z: world.y };
  });
  const fallbackCenterline = fallbackStationSpecs.map((station) => new THREE.Vector3(station.x, METRO_DECK_Y, station.z));
  let metroRoot = buildMetro(fallbackCenterline, fallbackStationSpecs);
  // Swap the approximate hardcoded line for true OSM track geometry once it arrives.
  scene.userData.rebuildMetro = (
    lines: MapPoint[][],
    osmStations: Array<{ id: number; name: string | null; point: MapPoint }>,
  ) => {
    const centerline = lines[0]?.map(([x, z]) => new THREE.Vector3(x, METRO_DECK_Y, z)) ?? [];
    if (centerline.length < 2) return;
    const specs = osmStations.map((station, index) => ({
      label: station.name ?? `Station ${index + 1}`,
      x: station.point[0],
      z: station.point[1],
    }));
    disposeMetroGroup(metroRoot);
    metroRoot = buildMetro(centerline, specs.length >= 2 ? specs : fallbackStationSpecs);
  };

  scene.add(root);
  scene.userData.landmarkColliders = colliders;
  scene.userData.landmarkRoot = root;
  scene.userData.landmarkOsmIds = landmarkOsmIds;
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
    new THREE.PlaneGeometry(34_000, 34_000),
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
  const landmarkClearings = DHAKA_LANDMARKS.map((landmark) => coordinatesToWorld(landmark.lat, landmark.lon));

  for (let gx = -1050; gx <= 1050; gx += 126) {
    for (let gz = -980; gz <= 980; gz += 126) {
      const lakeCenter = Math.sin(gx * 0.0042) * 90 + Math.sin(gx * 0.009) * 24;
      if (
        Math.abs(gz - lakeCenter) < 205 ||
        Math.abs(Math.abs(gz) - 285) < 46 ||
        Math.abs(gx - 180) < 220 ||
        landmarkClearings.some((landmark) => Math.hypot(gx - landmark.x, gz - landmark.y) < 145) ||
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
  group: THREE.Object3D,
  geometries: THREE.BufferGeometry[],
  material: THREE.Material,
  name: string,
  isCancelled: () => boolean,
  shadows = false,
  batchSize = 160,
  frustumCulled = true,
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
      // Each merged batch bundles road segments spanning a wide area, so its
      // bounding sphere leaves the frustum (and the whole batch is culled) long
      // before the individual roads do — making connected roads pop in/out as the
      // camera turns. Ground-level road/water meshes opt out of frustum culling.
      mesh.frustumCulled = frustumCulled;
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
  await mergeIntoMeshBatches(root, waterAreas, waterMaterial, "OSM water areas", isCancelled, false, 160, false);
  await mergeIntoMeshBatches(root, waterLines, waterMaterial, "OSM waterways", isCancelled, false, 160, false);

  await addRoadNetworkMeshes(root, data.roads, "OSM", isCancelled);
  // Hide the immediate fallback network the moment real OSM roads exist — both are
  // built at identical elevations, so any overlap window z-fights badly.
  if (data.roads.length > 0) {
    const roadFallback = scene.userData.proceduralRoadFallback as THREE.Group | undefined;
    if (roadFallback) roadFallback.visible = false;
  }

  // Roads and water are ground-level features. Reject any building footprint that would
  // sit on top of them so extruded walls never occlude the asphalt or the lake surface.
  // The clearance radii mirror the rendered road/water widths from the mesh passes above.
  const clearanceCellSize = 180;
  const clearanceKey = (cellX: number, cellZ: number) => `${cellX}:${cellZ}`;
  type ClearanceSegment = { x1: number; z1: number; x2: number; z2: number; radius: number };
  const roadClearanceGrid = new Map<string, ClearanceSegment[]>();
  const waterClearanceGrid = new Map<string, ClearanceSegment[]>();
  const waterAreaClearanceGrid = new Map<string, MapPoint[][]>();
  const addToClearanceGrid = <T,>(grid: Map<string, T[]>, item: T, minX: number, maxX: number, minZ: number, maxZ: number) => {
    for (let cellX = Math.floor(minX / clearanceCellSize); cellX <= Math.floor(maxX / clearanceCellSize); cellX++) {
      for (let cellZ = Math.floor(minZ / clearanceCellSize); cellZ <= Math.floor(maxZ / clearanceCellSize); cellZ++) {
        const key = clearanceKey(cellX, cellZ);
        const entries = grid.get(key);
        if (entries) entries.push(item);
        else grid.set(key, [item]);
      }
    }
  };
  const majorRoadKinds = new Set(["motorway", "trunk", "primary", "secondary"]);
  const localRoadKinds = new Set(["tertiary", "residential", "unclassified", "service"]);
  for (const road of data.roads) {
    const major = majorRoadKinds.has(road.kind);
    const surfaceWidth = major ? (road.kind === "motorway" || road.kind === "trunk" ? 17 : 14) : localRoadKinds.has(road.kind) ? 7.5 : 4.2;
    const shoulder = major ? 5.5 : 2.4;
    const radius = (surfaceWidth + shoulder) / 2 + 2;
    for (let index = 1; index < road.points.length; index++) {
      const [x1, z1] = road.points[index - 1];
      const [x2, z2] = road.points[index];
      addToClearanceGrid(roadClearanceGrid, { x1, z1, x2, z2, radius }, Math.min(x1, x2) - radius, Math.max(x1, x2) + radius, Math.min(z1, z2) - radius, Math.max(z1, z2) + radius);
    }
    await yieldIfNeeded(isCancelled);
  }
  for (const feature of data.water) {
    if (feature.area && feature.points.length >= 3) {
      const xs = feature.points.map(([x]) => x);
      const zs = feature.points.map(([, z]) => z);
      addToClearanceGrid(waterAreaClearanceGrid, feature.points, Math.min(...xs), Math.max(...xs), Math.min(...zs), Math.max(...zs));
    }
    for (let index = 1; index < feature.points.length; index++) {
      const [x1, z1] = feature.points[index - 1];
      const [x2, z2] = feature.points[index];
      addToClearanceGrid(waterClearanceGrid, { x1, z1, x2, z2, radius: 6 }, Math.min(x1, x2) - 6, Math.max(x1, x2) + 6, Math.min(z1, z2) - 6, Math.max(z1, z2) + 6);
    }
    await yieldIfNeeded(isCancelled);
  }
  const footprintBlockedByGround = (x: number, z: number, halfWidth: number, halfDepth: number) => {
    const key = clearanceKey(Math.floor(x / clearanceCellSize), Math.floor(z / clearanceCellSize));
    if ((waterAreaClearanceGrid.get(key) ?? []).some((points) => pointInPolygon(x, z, points))) return true;
    const reach = Math.max(halfWidth, halfDepth);
    for (const segment of waterClearanceGrid.get(key) ?? []) {
      const clearance = reach + segment.radius;
      if (distanceToSegmentSquared(x, z, segment.x1, segment.z1, segment.x2, segment.z2) < clearance ** 2) return true;
    }
    for (const segment of roadClearanceGrid.get(key) ?? []) {
      const clearance = reach + segment.radius;
      if (distanceToSegmentSquared(x, z, segment.x1, segment.z1, segment.x2, segment.z2) < clearance ** 2) return true;
    }
    return false;
  };

  const buildingBuckets: THREE.BufferGeometry[][] = [[], [], [], []];
  const landmarkOsmIds = scene.userData.landmarkOsmIds as Set<number> | undefined;
  // The full Dhaka payload can contain tens of thousands of footprints. Keep the
  // live mesh deterministic and geographically even; procedural tiles fill the gaps.
  for (const building of await selectSpatiallyEvenBuildings(data.buildings, isCancelled)) {
    if (building.points.length < 3 || landmarkOsmIds?.has(building.id)) continue;
    const xs = building.points.map(([x]) => x);
    const zs = building.points.map(([, z]) => z);
    const minX = Math.min(...xs);
    const maxX = Math.max(...xs);
    const minZ = Math.min(...zs);
    const maxZ = Math.max(...zs);
    const centerX = (minX + maxX) / 2;
    const centerZ = (minZ + maxZ) / 2;
    const halfWidth = Math.max(2, (maxX - minX) / 2);
    const halfDepth = Math.max(2, (maxZ - minZ) / 2);
    if (footprintBlockedByGround(centerX, centerZ, halfWidth, halfDepth)) {
      await yieldIfNeeded(isCancelled);
      continue;
    }
    const geometry = new THREE.ExtrudeGeometry(polygonShape(building.points), {
      depth: building.height,
      bevelEnabled: false,
      curveSegments: 1,
    });
    geometry.rotateX(-Math.PI / 2);
    buildingBuckets[Math.abs(building.id) % buildingBuckets.length].push(geometry);
    colliders.push({
      x: centerX,
      z: centerZ,
      halfWidth,
      halfDepth,
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
  const focusLandmarkRef = useRef<(kind: DhakaLandmark["kind"] | null) => boolean>(() => false);
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
    // Keep the complete sky cube inside the camera's far plane. It follows the
    // camera below, so the bird can never reach or leave its finite bounds.
    sky.scale.setScalar(8_000);
    sky.renderOrder = -100;
    sky.frustumCulled = false;
    const skyUniforms = sky.material.uniforms;
    skyUniforms.turbidity.value = 5.8;
    skyUniforms.rayleigh.value = 3.15;
    skyUniforms.mieCoefficient.value = 0.0035;
    skyUniforms.mieDirectionalG.value = 0.84;
    // The sky cube scale and camera-follow below preserve the clipping fix;
    // live weather applies the solar vector and atmosphere after setup.
    skyUniforms.sunPosition.value.set(0, 1, 0);
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

    let disposed = false;
    const buildingColliders = addCity(scene);
    let buildingColliderGrid = buildColliderGrid(buildingColliders);
    const fallbackRoads = proceduralFallbackRoads();
    addImmediateCityMass(scene, fallbackRoads);
    const immediateRoadFallback = new THREE.Group();
    immediateRoadFallback.name = "Immediate Greater Dhaka road network";
    scene.add(immediateRoadFallback);
    scene.userData.proceduralRoadFallback = immediateRoadFallback;
    void addRoadNetworkMeshes(immediateRoadFallback, fallbackRoads, "Immediate fallback", () => disposed);
    const mapRequestStartedAt = performance.now();
    // Live Overpass data first, but never hang on it: the deployed worker can stall
    // upstream indefinitely, so time the request out and fall back to the bundled
    // snapshot before resorting to the sparse procedural grid.
    const fetchMapData = async (): Promise<OsmMapData> => {
      try {
        const response = await fetch("/api/osm", { signal: AbortSignal.timeout(35_000) });
        if (!response.ok) throw new Error(`Map request failed with ${response.status}`);
        return await response.json() as OsmMapData;
      } catch (liveError) {
        const snapshot = await fetch("/dhaka-map.json", { signal: AbortSignal.timeout(20_000) });
        if (!snapshot.ok) throw liveError;
        return await snapshot.json() as OsmMapData;
      }
    };
    void fetchMapData()
      .then(async (data) => {
        if (disposed) return;
        const mapBuildStartedAt = performance.now();
        const osmColliders = await addOpenStreetMapWorld(scene, data, () => disposed);
        if (!osmColliders) throw new Error("OpenStreetMap response contained no usable buildings");
        const rebuildMetro = scene.userData.rebuildMetro as
          | ((lines: MapPoint[][], stations: NonNullable<OsmMapData["metroStations"]>) => void)
          | undefined;
        if (rebuildMetro && data.metroLines?.length) rebuildMetro(data.metroLines, data.metroStations ?? []);
        const landmarkColliders = scene.userData.landmarkColliders as BuildingCollider[] | undefined ?? [];
        const proceduralColliders = await addProceduralDistrictTiles(
          scene,
          data,
          [...osmColliders, ...landmarkColliders],
          crow.position,
          () => disposed,
        );
        // Rebuild in place (the array identity is captured elsewhere) without
        // spreading: spread-as-arguments overflows the call stack past ~120k items.
        buildingColliders.length = 0;
        for (const group of [osmColliders, proceduralColliders, landmarkColliders]) {
          for (const collider of group) buildingColliders.push(collider);
        }
        buildingColliderGrid = await buildColliderGridAsync(buildingColliders, () => disposed);
        if (disposed) return;
        renderer.domElement.dataset.mapRequestMs = (performance.now() - mapRequestStartedAt).toFixed(1);
        renderer.domElement.dataset.mapBuildMs = (performance.now() - mapBuildStartedAt).toFixed(1);
        setMapStatus("live");
      })
      .catch(async (error: unknown) => {
        if (disposed) return;
        console.error("Live map build failed; using procedural fallback", error);
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
          for (const collider of proceduralColliders) buildingColliders.push(collider);
          buildingColliderGrid = await buildColliderGridAsync(buildingColliders, () => disposed);
        }
        setMapStatus("fallback");
      })
      .catch(() => {
        if (!disposed) setMapStatus("fallback");
      });

    const crow = new THREE.Group();
    crow.name = "PlayerCrow";
    const spawnParams = new URLSearchParams(window.location.search);
    const spawnLat = Number(spawnParams.get("lat")) || 23.7595;
    const spawnLon = Number(spawnParams.get("lon")) || 90.4105;
    const spawnAlt = Number(spawnParams.get("alt")) || DEFAULT_FLIGHT_ALTITUDE;
    const spawnWorld = coordinatesToWorld(spawnLat, spawnLon);
    crow.position.set(spawnWorld.x, spawnAlt, spawnWorld.y);
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
    if (import.meta.env.DEV) (window as BirdFlightWindow & { __scene?: THREE.Scene }).__scene = scene;
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
    const flightControlCodes = new Set([
      "KeyA", "KeyD", "KeyQ", "KeyS", "KeyW",
      "ArrowDown", "ArrowLeft", "ArrowRight", "ArrowUp",
      "ControlLeft", "ControlRight", "ShiftLeft", "ShiftRight",
    ]);
    let yaw = Number(new URLSearchParams(window.location.search).get("yaw")) || 0.15;
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
    let inspectionTarget: THREE.Vector3 | null = null;
    let inspectionCameraOffset = 120;
    let inspectionIndex = -1;
    const focusLandmark = (kind: DhakaLandmark["kind"] | null) => {
      if (!kind) {
        inspectionTarget = null;
        return true;
      }
      const landmark = DHAKA_LANDMARKS.find((entry) => entry.kind === kind);
      if (!landmark) return false;
      const world = coordinatesToWorld(landmark.lat, landmark.lon);
      inspectionTarget = new THREE.Vector3(world.x, Math.max(6, landmark.altitude * 0.42), world.y);
      inspectionCameraOffset = ["parliament", "lalbagh-fort", "ahsan-manzil"].includes(kind) ? 190 : Math.max(105, landmark.altitude * 1.45);
      return true;
    };
    focusLandmarkRef.current = focusLandmark;
    let nearestPerch: Perch | null = null;

    const onKeyDown = (event: KeyboardEvent) => {
      if (flightControlCodes.has(event.code) && flyingRef.current && !pausedRef.current) {
        keys.add(event.code);
      }
      if (["Space", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(event.code)) event.preventDefault();
      if (event.code === "KeyC" && !event.repeat) {
        focusLandmark(null);
        const next: CameraMode = cameraModeRef.current === "CHASE" ? "BIRD'S EYE" : "CHASE";
        cameraModeRef.current = next;
        setCameraMode(next);
      }
      if (event.code === "KeyL" && !event.repeat) {
        inspectionIndex = (inspectionIndex + 1) % DHAKA_LANDMARKS.length;
        focusLandmark(DHAKA_LANDMARKS[inspectionIndex].kind);
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
          // Treetops have no meaningful facing; settle in the direction flown.
          yaw = nearestPerch.kind === "tree" ? yaw : nearestPerch.heading;
          yawRate = 0;
          pitch = 0;
          roll = 0;
          speed = 0;
          verticalSpeed = 0;
        }
      }
    };
    const onKeyUp = (event: KeyboardEvent) => keys.delete(event.code);
    const clearFlightControls = () => keys.clear();
    const onVisibilityChange = () => {
      if (document.visibilityState !== "visible") clearFlightControls();
    };
    window.addEventListener("keydown", onKeyDown, { passive: false });
    window.addEventListener("keyup", onKeyUp);
    window.addEventListener("blur", clearFlightControls);
    document.addEventListener("visibilitychange", onVisibilityChange);

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
      if (!active) clearFlightControls();
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
        // Preserve any upward movement while rejecting the horizontal impact.
        // This lets takeoff clear a perch collider instead of restoring the
        // same below-roof position every frame and soft-locking the crow.
        resolveBuildingCollision(crow.position, previousPosition);
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
          if (distance < LANDMARK_LANDING_RADIUS && distance < nearestDistance) {
            nearestPerch = perch;
            nearestDistance = distance;
          }
        }
        const treePerchGrid = scene.userData.treePerchGrid as Map<string, Perch[]> | undefined;
        if (treePerchGrid) {
          const cellX = Math.floor(crow.position.x / TREE_PERCH_CELL_SIZE);
          const cellZ = Math.floor(crow.position.z / TREE_PERCH_CELL_SIZE);
          for (let offsetX = -1; offsetX <= 1; offsetX++) {
            for (let offsetZ = -1; offsetZ <= 1; offsetZ++) {
              for (const perch of treePerchGrid.get(`${cellX + offsetX}:${cellZ + offsetZ}`) ?? []) {
                const distance = crow.position.distanceTo(perch.position);
                if (distance < TREE_LANDING_RADIUS && distance < nearestDistance) {
                  nearestPerch = perch;
                  nearestDistance = distance;
                }
              }
            }
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
        const updateMetroRail = scene.userData.metroRailUpdate as ((time: number) => void) | undefined;
        updateMetroRail?.(elapsedTime);
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

      if (inspectionTarget) {
        desiredCamera.copy(inspectionTarget).add(new THREE.Vector3(
          inspectionCameraOffset,
          Math.max(52, inspectionCameraOffset * 0.52),
          inspectionCameraOffset,
        ));
        desiredTarget.copy(inspectionTarget);
      } else if (cameraModeRef.current === "CHASE") {
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
        // Forward is (-sin yaw, 0, -cos yaw), so the true compass bearing
        // (clockwise from north) is -yaw — using +yaw mirrors east and west.
        const headings = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];
        const bearing = ((-yaw % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
        const headingIndex = Math.round(bearing / (Math.PI / 4)) % 8;
        compassRef.current.textContent = headings[headingIndex];
      }
      if (mapBirdRef.current) {
        mapBirdRef.current.style.left = `${50 + clamp(crow.position.x / FLIGHT_EXTENT.x, -1, 1) * 43}%`;
        mapBirdRef.current.style.top = `${50 + clamp(crow.position.z / FLIGHT_EXTENT.z, -1, 1) * 43}%`;
        mapBirdRef.current.style.transform = `translate(-50%, -50%) rotate(${-yaw}rad)`;
      }

      sky.position.copy(camera.position);
      renderer.render(scene, camera);
      diagnosticFrame++;
      if (diagnosticFrame % 30 === 0) {
        const districtTiles = scene.userData.proceduralDistrictTiles as ProceduralDistrictTile[] | undefined;
        const tileVisibilityRadius = scene.userData.proceduralTileVisibilityRadius as number | undefined;
        if (districtTiles && tileVisibilityRadius) {
          const visibilitySquared = tileVisibilityRadius ** 2;
          const visibilityAnchor = inspectionTarget ?? crow.position;
          for (const tile of districtTiles) {
            const dx = tile.centerX - visibilityAnchor.x;
            const dz = tile.centerZ - visibilityAnchor.z;
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
      focusLandmarkRef.current = () => false;
      flightAudio.dispose();
      airflowVfx.dispose();
      weatherVfx.dispose();
      weatherController.abort();
      window.clearInterval(weatherRefresh);
      audioRef.current = null;
      cancelAnimationFrame(animation);
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("blur", clearFlightControls);
      document.removeEventListener("visibilitychange", onVisibilityChange);
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
                <button
                  type="button"
                  key={landmark.label}
                  className="map-landmark"
                  title={landmark.label}
                  aria-label={`Inspect ${landmark.label}`}
                  onClick={() => focusLandmarkRef.current(landmark.kind)}
                  style={{
                    left: `${50 + clamp(world.x / FLIGHT_EXTENT.x, -1, 1) * 43}%`,
                    top: `${50 + clamp(world.y / FLIGHT_EXTENT.z, -1, 1) * 43}%`,
                  }}
                >{landmark.shortLabel}</button>
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
              <div><dt>L</dt><dd>Inspect next landmark</dd></div>
            <div><dt>P / Esc</dt><dd>Pause / resume flight</dd></div>
            <div><dt>E</dt><dd>Land / take off at a perch or treetop</dd></div>
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
