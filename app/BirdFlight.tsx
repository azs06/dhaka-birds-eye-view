"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import type { PointerEvent as ReactPointerEvent, ReactNode } from "react";
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js";
import { Sky } from "three/examples/jsm/objects/Sky.js";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { resolveBuildingCollision } from "./flight-collision.mjs";
import {
  STRINGS,
  chooseLocale,
  fill,
  frequencyText,
  localDigits,
  placeName,
  readLocale,
  stationText,
  subscribeToLocale,
  weatherLabel,
  worldLabelText,
  type Locale,
  type Strings,
} from "./i18n";
import { BIRDS, birdById, chooseBird, readBird, subscribeToBird, type Bird, type BirdId } from "./birds";
import { HudIcon, weatherIconName } from "./HudIcon";
import soundClips from "./sound-clips.json";
import { DHAKA_LANDMARK_FOOTPRINTS, type LandmarkFootprintPart } from "./dhaka-landmark-footprints";

type CameraMode = "CHASE" | "BIRD'S EYE";
// Discrete flight verbs, shared by the keyboard handler and the touch HUD so both
// input methods drive one implementation instead of two that can drift apart.
type FlightActions = {
  flap: () => void;
  togglePerch: () => void;
  toggleCamera: () => void;
  cycleInspection: () => void;
  releaseInspection: () => boolean;
  setHold: (code: string, held: boolean) => void;
  setAxes: (turn: number, climb: number) => void;
  /** Move the bird to a launch site while the title screen is still up. */
  spawnAt: (lat: number, lon: number, alt: number) => void;
  /** Current spot in the sky, for building a shareable link back to it. */
  readView: () => { lat: number; lon: number; alt: number; yaw: number };
};
type BuildingCollider = { x: number; z: number; halfWidth: number; halfDepth: number; top: number };
type Perch = {
  position: THREE.Vector3;
  label: string;
  heading: number;
  kind?: "landmark" | "tree";
  /** Floating ring above this perch, so the approach target can be lit up. */
  marker?: THREE.Group;
};
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
    /** Live landing-approach state, for tuning the flare without a debugger. */
    landing: {
      speed: number;
      perch: string | null;
      distance: number;
      committed: boolean;
      position: { x: number; y: number; z: number };
    };
  };
};
type FlightAudio = {
  start: () => Promise<boolean>;
  toggle: () => Promise<boolean>;
  pause: () => void;
  resume: () => void;
  flap: () => void;
  wingbeat: (strength: number) => void;
  land: () => void;
  thunder: (strength: number, delay: number) => void;
  setFlight: (speed: number, altitude: number, verticalSpeed: number) => void;
  setWeather: (mode: WeatherMode, precipitation: number) => void;
  setRadioDucking: (active: boolean) => void;
  /** The player's volume for the world's sound: 1 is the designed level. */
  setVolume: (volume: number) => void;
  /** Which species the player is, so its own call is heard close by. */
  setBird: (id: string) => void;
  /** Output level right now, for checking the mix without ears. */
  probe: () => { state: string; rms: number; peak: number; above250: number; clips: number; lastCall: string };
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
  /** Horizontal air movement in world units per second, for pushing the bird. */
  readWind: (target: THREE.Vector3) => THREE.Vector3;
  /** Local Dhaka hour to render the sky at, or null to follow the real clock. */
  setSkyHour: (hour: number | null) => void;
  dispose: () => void;
};
type SkyPreset = { id: string; label: string; hour: number | null };
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
const LANDMARK_LANDING_RADIUS = 34;
const TREE_LANDING_RADIUS = 26;
// A crow spots its perch long before it reaches it and spends the last stretch
// bleeding off speed. Cruise is 44 m/s, so an unassisted bird crossed the old
// 27 m capture sphere in about a second — far too little to react. These three
// radii give the approach a shape: notice, flare, then land.
const LANDING_APPROACH_RADIUS = 200;
const LANDING_FLARE_RADIUS = 70;
// Speeds held at the edge of the approach cone and at the perch itself.
const LANDING_APPROACH_SPEED = 27;
const LANDING_FLARE_SPEED = 12;
// Only perches inside this forward cone count as an approach target, so merely
// passing a rooftop never grabs the throttle.
const LANDING_APPROACH_COS = 0.5;
// Committed landings fly themselves in; these bound how that glide behaves.
const LANDING_COMMIT_SPEED = 21;
const LANDING_CAPTURE_DISTANCE = 4.5;
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
// Shadow refresh cadence in frames. The world is static enough that every frame
// is pure waste, but the crow and the streaming district tiles do move, so this
// trades a twelfth of the shadow-pass cost for a shadow that still tracks.
const SHADOW_REFRESH_FRAMES = 12;
// Frame pacing: 60 fps in flight, a slow tick while paused, and a reduced rate
// when the window is visible but another app has focus.
const ACTIVE_FRAME_MS = 1000 / 60;
const UNFOCUSED_FRAME_MS = 1000 / 24;
const PAUSED_FRAME_MS = 1000 / 10;
// The rain streaks use the raw wind vector; the bird uses a fraction of it so a
// stiff Dhaka breeze is a drift you correct for, never a fight you cannot win.
const WIND_DRIFT_SCALE = 0.34;
// Hours chosen against Dhaka's actual solar day (sunrise ~05:15, sunset ~18:45)
// so each preset lands on a genuinely distinct sun elevation rather than a
// nominally different clock reading.
const SKY_PRESETS: SkyPreset[] = [
  { id: "live", label: "LIVE", hour: null },
  { id: "dawn", label: "DAWN", hour: 5.7 },
  { id: "noon", label: "NOON", hour: 12.5 },
  { id: "golden", label: "GOLDEN", hour: 18.1 },
  { id: "dusk", label: "DUSK", hour: 18.9 },
  { id: "night", label: "NIGHT", hour: 22 },
];
const FLIGHT_AMBIENCE_GAIN = 0.28;
// Ducking has to be heard, not just computed: 0.28 -> 0.24 is about 1.3 dB, which
// is below the threshold most listeners notice. 0.12 is a clear ~7 dB step down,
// so the radio actually comes forward when a station is playing.
const RADIO_DUCKED_AMBIENCE_GAIN = 0.12;
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
    tagline: "Soft rain · distant chimes · no interruptions",
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

// Launch sites offered on the title screen. Picking one moves the attract-mode
// bird immediately, so the choice previews itself behind the panel.
const LAUNCH_SITES = [
  { id: "sangsad", short: "JSB", label: "Sangsad Bhaban", lat: 23.7622884, lon: 90.3785482, alt: 175 },
  { id: "old-dhaka", short: "AHM", label: "Old Dhaka", lat: 23.7084768, lon: 90.4055988, alt: 150 },
  { id: "hatirjheel", short: "HJL", label: "Hatirjheel", lat: 23.771125, lon: 90.4133385, alt: 140 },
  { id: "airport", short: "DAC", label: "Shahjalal Airport", lat: 23.84343, lon: 90.39784, alt: 195 },
] as const;

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

// Flight keys are captured on `window`, so they fire even while a HUD control has
// focus. Blanket-ignoring every key while a control is focused is too blunt — it
// would kill "press P to resume" the moment the pause dialog focuses its own
// resume button. Instead, work out which keys the focused control legitimately
// owns and surrender only those.
const FLIGHT_MODE_KEYS = {
  "braking": "modeBraking",
  "surge": "modeSurge",
  "climb": "modeClimb",
  "dive": "modeDive",
  "slow-glide": "modeSlowGlide",
  "cruise": "modeCruise",
} as const satisfies Record<string, keyof Strings>;
const SKY_PRESET_KEYS: Record<string, keyof Strings> = {
  live: "skyLive",
  dawn: "skyDawn",
  noon: "skyNoon",
  golden: "skyGolden",
  dusk: "skyDusk",
  night: "skyNight",
};
const SKY_NOTE_KEYS: Record<string, keyof Strings> = {
  live: "skyLiveNote",
  dawn: "skyDawnNote",
  noon: "skyNoonNote",
  golden: "skyGoldenNote",
  dusk: "skyDuskNote",
  night: "skyNightNote",
};

type FocusClaim = "none" | "text" | "slider" | "activatable";
const SLIDER_CLAIMED_KEYS = new Set([
  "ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End", "PageUp", "PageDown",
]);
const ACTIVATION_CLAIMED_KEYS = new Set(["Space", "Enter"]);

function focusedControlClaim(target: EventTarget | null): FocusClaim {
  if (!(target instanceof Element)) return "none";
  const control = target.closest(
    "input, textarea, select, button, a[href], [contenteditable='true'], [role='slider'], [role='button']",
  );
  if (!control) return "none";
  if (control instanceof HTMLInputElement) return control.type === "range" ? "slider" : "text";
  if (control.getAttribute("role") === "slider") return "slider";
  if (control instanceof HTMLTextAreaElement || control instanceof HTMLSelectElement) return "text";
  if (control.getAttribute("contenteditable") === "true") return "text";
  return "activatable";
}

/** True when the focused control, not the flight, should receive this key. */
function focusedControlClaimsKey(claim: FocusClaim, code: string) {
  // Escape is the universal dismiss key and is never surrendered.
  if (code === "Escape") return false;
  if (claim === "text") return true;
  if (claim === "slider") return SLIDER_CLAIMED_KEYS.has(code);
  if (claim === "activatable") return ACTIVATION_CLAIMED_KEYS.has(code);
  return false;
}

function coordinatesToWorld(lat: number, lon: number) {
  const metresPerLongitude = 111_320 * Math.cos(MAP_CENTER.lat * Math.PI / 180);
  return new THREE.Vector2(
    (lon - MAP_CENTER.lon) * metresPerLongitude,
    -(lat - MAP_CENTER.lat) * 110_540,
  );
}

/** Inverse of coordinatesToWorld, for turning a spot in the sky back into a link. */
function worldToCoordinates(x: number, z: number) {
  const metresPerLongitude = 111_320 * Math.cos(MAP_CENTER.lat * Math.PI / 180);
  return {
    lat: MAP_CENTER.lat - z / 110_540,
    lon: MAP_CENTER.lon + x / metresPerLongitude,
  };
}

// The procedural airport runway (3.2 km) and terminal apron extend far past the
// small landmark anchor box, so OSM roads/buildings and procedural tiles all
// test against its rotated footprint to keep the tarmac clear of z-fighting.
const AIRPORT_WORLD = coordinatesToWorld(23.84343, 90.39784);
const AIRPORT_COS = Math.cos(-0.56);
const AIRPORT_SIN = Math.sin(-0.56);

function inAirportClearance(x: number, z: number, pad = 0) {
  const dx = x - AIRPORT_WORLD.x;
  const dz = z - AIRPORT_WORLD.y;
  const localX = dx * AIRPORT_COS - dz * AIRPORT_SIN;
  const localZ = dx * AIRPORT_SIN + dz * AIRPORT_COS;
  if (Math.abs(localX) < 120 + pad && Math.abs(localZ) < 1_640 + pad) return true;
  if (localX > -440 - pad && localX < 120 + pad && localZ > -410 - pad && localZ < 140 + pad) return true;
  return false;
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

// Dhaka keeps a fixed UTC+6 offset with no daylight saving, so a local hour maps
// to an absolute instant without any timezone database.
const DHAKA_UTC_OFFSET_MS = 6 * 3_600_000;

/** Absolute epoch ms for a given local Dhaka hour on the reference day. */
function dhakaInstantAtHour(hour: number, reference = Date.now()) {
  const localNow = reference + DHAKA_UTC_OFFSET_MS;
  const localDayStart = Math.floor(localNow / 86_400_000) * 86_400_000;
  return localDayStart + hour * 3_600_000 - DHAKA_UTC_OFFSET_MS;
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
  onThunder: (strength: number, delay: number) => void,
): WeatherVfx {
  const random = seededRandom(9_071);
  const maxDrops = reducedMotion ? 520 : 1_100;
  const positions = new Float32Array(maxDrops * 6);
  const dropletPositions = new Float32Array(maxDrops * 3);
  const drops = Array.from({ length: maxDrops }, (_, index) => {
    // Golden-ratio ordering keeps every draw-range prefix distributed across
    // near, middle, and far layers (important when drizzle enables only 28%).
    const depth = (index * 0.618_033_988_75) % 1;
    const near = depth < 0.34;
    const radius = near ? 150 : depth < 0.72 ? 215 : 290;
    return {
      x: (random() - 0.5) * radius * 2,
      y: -45 + random() * 235,
      z: (random() - 0.5) * radius * 2,
      radius,
      speed: (near ? 118 : 76) + random() * (near ? 112 : 86),
      length: (near ? 9 : 4.5) + random() * (near ? 13 : 8),
    };
  });
  drops.forEach((drop, index) => {
    const lineOffset = index * 6;
    positions[lineOffset] = drop.x;
    positions[lineOffset + 1] = drop.y;
    positions[lineOffset + 2] = drop.z;
    positions[lineOffset + 3] = drop.x;
    positions[lineOffset + 4] = drop.y + drop.length;
    positions[lineOffset + 5] = drop.z;
    const pointOffset = index * 3;
    dropletPositions[pointOffset] = drop.x;
    dropletPositions[pointOffset + 1] = drop.y;
    dropletPositions[pointOffset + 2] = drop.z;
  });
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

  // The line layer supplies long, fast foreground streaks. A soft point-sprite
  // layer fills the middle and far field so rain has depth instead of looking
  // like a sparse cage of identical one-pixel lines.
  const dropletGeometry = new THREE.BufferGeometry();
  dropletGeometry.setAttribute("position", new THREE.BufferAttribute(dropletPositions, 3));
  const dropletMaterial = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    toneMapped: false,
    uniforms: {
      uColor: { value: new THREE.Color(0xb9dce5) },
      uOpacity: { value: 0 },
      uPixelRatio: { value: renderer.getPixelRatio() },
      uSlant: { value: 0 },
    },
    vertexShader: `
      uniform float uPixelRatio;
      varying float vDepthFade;
      void main() {
        vec4 viewPosition = modelViewMatrix * vec4(position, 1.0);
        float distanceToCamera = max(45.0, -viewPosition.z);
        gl_PointSize = clamp(520.0 / distanceToCamera, 1.6, 7.5) * uPixelRatio;
        gl_Position = projectionMatrix * viewPosition;
        vDepthFade = 1.0 - smoothstep(150.0, 460.0, distanceToCamera);
      }
    `,
    fragmentShader: `
      uniform vec3 uColor;
      uniform float uOpacity;
      uniform float uSlant;
      varying float vDepthFade;
      void main() {
        vec2 drop = gl_PointCoord - vec2(0.5);
        drop.x += drop.y * uSlant;
        float core = 1.0 - smoothstep(0.035, 0.16, abs(drop.x));
        float lengthMask = 1.0 - smoothstep(0.34, 0.5, abs(drop.y));
        float taperedHead = smoothstep(-0.52, 0.18, drop.y);
        float alpha = core * lengthMask * taperedHead * uOpacity * (0.38 + vDepthFade * 0.62);
        if (alpha < 0.015) discard;
        gl_FragColor = vec4(uColor, alpha);
      }
    `,
  });
  const droplets = new THREE.Points(dropletGeometry, dropletMaterial);
  droplets.frustumCulled = false;
  droplets.renderOrder = 24;
  droplets.visible = false;
  scene.add(droplets);

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
  let lightningEchoClock = -1;
  let currentWeather = DEFAULT_WEATHER;
  let daylightRefreshClock = 0;
  let skyHourOverride: number | null = null;
  const sunDirection = new THREE.Vector3();
  const moonDirection = new THREE.Vector3();
  const nightColor = new THREE.Color();
  const dayColor = new THREE.Color();
  const twilightColor = new THREE.Color(0xc47c68);
  const blendedBackground = new THREE.Color();
  const sunColor = new THREE.Color();
  const moonColor = new THREE.Color(0x9fc7ed);
  const highSunColor = new THREE.Color(0xffefd1);
  const overcastSunColor = new THREE.Color(0xd6e5e5);

  const apply = (weather: WeatherSnapshot) => {
    const previousMode = mode;
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
    dropletGeometry.setDrawRange(0, activeDrops);
    rain.visible = raining;
    droplets.visible = raining;
    rainMaterial.opacity = 0.2 + rainStrength * 0.48;
    rainMaterial.color.set(mode === "storm" ? 0xc9e6f2 : 0xaed3dc);
    dropletMaterial.uniforms.uOpacity.value = 0.2 + rainStrength * 0.42;
    dropletMaterial.uniforms.uColor.value.set(mode === "storm" ? 0xd8eff7 : 0xb8dce3);
    renderer.domElement.dataset.rainStrength = rainStrength.toFixed(2);
    renderer.domElement.dataset.rainDrops = activeDrops.toString();

    const windToward = THREE.MathUtils.degToRad(weather.windDirection + 180);
    const windScale = clamp(weather.windSpeed / 18, 0.08, 1.5);
    windX = Math.sin(windToward) * 12 * windScale;
    windZ = Math.cos(windToward) * 12 * windScale;
    dropletMaterial.uniforms.uSlant.value = clamp((windX + windZ) / 44, -0.42, 0.42);
    if (mode !== previousMode && (mode === "rain" || mode === "storm")) {
      lightningClock = mode === "storm" ? 3 + random() * 5 : 8 + random() * 10;
    }

    // Visitors otherwise only ever see whatever hour it happens to be in Dhaka.
    // The override re-times the whole sky — sun vector, colour, stars, exposure —
    // by moving the instant every downstream calculation reads from.
    const now = skyHourOverride === null ? Date.now() : dhakaInstantAtHour(skyHourOverride);
    const solar = solarPosition(new Date(now));
    const solarElevation = THREE.MathUtils.radToDeg(solar.elevation);
    const daylight = liveDaylightAmount(weather, now, solar.elevation);
    const isNight = daylight < 0.08;
    const twilight = 1 - Math.abs(daylight * 2 - 1);
    const daylightStrength = smoothRange(daylight, 0.04, 0.92);
    const nightStrength = 1 - smoothRange(daylight, 0.025, 0.24);
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
      const weatherFogDensity = mode === "fog"
        ? 0.00135
        : mode === "storm"
          ? 0.00082
          : mode === "rain"
            ? 0.00064
            : 0.00024 + cloudAmount * 0.00018;
      // At night, dense same-colour fog erases the ground before the player can
      // read it. Games retain aerial perspective but extend the useful sightline.
      scene.fog.density = weatherFogDensity * THREE.MathUtils.lerp(0.72, 1, daylightStrength);
    }

    const horizontal = Math.cos(solar.elevation);
    sunDirection.set(
      Math.sin(solar.azimuth) * horizontal,
      Math.sin(solar.elevation),
      -Math.cos(solar.azimuth) * horizontal,
    ).normalize();
    // The Preetham sky model is only defined for a sun above the horizon; past
    // sunset it collapses the whole dome to black and hides the twilight gradient
    // that scene.background is already computing. Hand over as the sun sets.
    sky.visible = solarElevation > -1.2;
    // Stars fade in from late dusk rather than snapping on, so the zenith is
    // never an empty black field while the horizon is still lit.
    stars.visible = daylight < 0.52 && cloudAmount < 0.72 && !raining && mode !== "fog";
    starMaterial.opacity = clamp((0.82 - cloudAmount) * (1 - daylight / 0.52), 0, 0.82);
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

    const nightExposure = mode === "storm" ? 0.88 : mode === "rain" ? 0.92 : 0.98;
    renderer.toneMappingExposure = THREE.MathUtils.lerp(
      nightExposure,
      mode === "clear" ? 1.02 : mode === "cloudy" ? 0.9 : 0.76,
      daylightStrength,
    );
    hemisphere.intensity = THREE.MathUtils.lerp(
      0.82 - cloudAmount * 0.12,
      1.8 - cloudAmount * 0.82,
      daylightStrength,
    );
    hemisphere.color.set(isNight ? 0x7893ad : mode === "rain" || mode === "storm" ? 0xb8d0d4 : 0xe8f3ee);
    hemisphere.groundColor.set(isNight ? 0x263c36 : 0x5d6c58);
    const sunVisibility = smoothRange(solarElevation, -5, 8) * (1 - cloudAmount * 0.72);
    const daylightKey = (mode === "clear" ? 3.35 : mode === "cloudy" ? 1.45 : 0.58) * sunVisibility;
    // A readable game night still has a cool key light. Reuse the one shadowed
    // directional light as moonlight instead of adding costly local shadow lights.
    const moonVisibility = nightStrength * (1 - cloudAmount * 0.5);
    const moonlightKey = (mode === "storm" ? 0.72 : mode === "rain" ? 0.88 : 1.35) * moonVisibility;
    // Between sunset and true night the sun key has faded but the moon key has
    // not arrived yet, which left civil twilight — the best-looking hour of the
    // day — darker than midnight. Fill that gap with the scattered sky itself.
    const twilightKey = twilight * (mode === "storm" ? 0.4 : mode === "rain" ? 0.55 : 1.05) * (1 - cloudAmount * 0.45);
    sun.intensity = Math.max(daylightKey, moonlightKey, twilightKey);
    sunColor.set(0xff965e).lerp(highSunColor, smoothRange(solarElevation, 2, 28));
    sunColor.lerp(overcastSunColor, clamp(cloudAmount * 0.55 + (raining ? 0.28 : 0), 0, 0.82));
    sun.color.copy(moonColor).lerp(sunColor, daylightStrength);
    moonDirection.set(-sunDirection.x, 0.62, -sunDirection.z).normalize();
    sun.position.copy(moonDirection).lerp(sunDirection, daylightStrength).normalize().multiplyScalar(3_800);
    sun.target.position.set(0, 0, 0);
    // The key light just moved, so the cached static shadow map is now stale.
    renderer.shadowMap.needsUpdate = true;
    skyFill.intensity = THREE.MathUtils.lerp(0.58, 0.48 + cloudAmount * 0.28, daylightStrength);
    skyFill.color.set(isNight ? 0x45617b : twilight > 0.35 ? 0xc99b8e : 0x9bc8d2);
    renderer.domElement.dataset.nightReadability = nightStrength.toFixed(3);

    const nightGlowMaterials = scene.userData.nightGlowMaterials as THREE.MeshStandardMaterial[] | undefined ?? [];
    for (const material of nightGlowMaterials) {
      material.emissiveIntensity = THREE.MathUtils.lerp(material.userData.nightGlowIntensity ?? 0.7, 0, daylightStrength);
    }
    // Windows come on through dusk and fade out at dawn. Overcast and rain
    // scatter the glow, so the city reads slightly brighter through cloud.
    NIGHT_WINDOW_GLOW.value = (1 - daylightStrength) * (1.15 + cloudAmount * 0.35);
    NIGHT_WINDOW_TINT.value.setHex(mode === "fog" ? 0xffd2a4 : 0xffc074);

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
    readWind(target) {
      // windX/windZ already carry live speed and bearing for the rain streaks;
      // the bird rides the same air mass so the two always agree on screen.
      return target.set(windX, 0, windZ);
    },
    setSkyHour(hour) {
      skyHourOverride = hour;
      apply(currentWeather);
    },
    update(dt, anchor, paused) {
      daylightRefreshClock -= dt;
      if (daylightRefreshClock <= 0) {
        daylightRefreshClock = 30;
        apply(currentWeather);
      }
      rain.position.copy(anchor);
      droplets.position.copy(anchor);
      stars.position.set(anchor.x, 0, anchor.z);
      if (!paused && rain.visible) {
        for (let index = 0; index < activeDrops; index++) {
          const drop = drops[index];
          drop.y -= drop.speed * dt;
          drop.x += windX * dt;
          drop.z += windZ * dt;
          if (drop.y < -48 || Math.abs(drop.x) > drop.radius || Math.abs(drop.z) > drop.radius) {
            drop.x = (random() - 0.5) * drop.radius * 2;
            drop.y = 145 + random() * 45;
            drop.z = (random() - 0.5) * drop.radius * 2;
          }
          const offset = index * 6;
          positions[offset] = drop.x;
          positions[offset + 1] = drop.y;
          positions[offset + 2] = drop.z;
          positions[offset + 3] = drop.x - windX * 0.16;
          positions[offset + 4] = drop.y + drop.length;
          positions[offset + 5] = drop.z - windZ * 0.16;
          const pointOffset = index * 3;
          dropletPositions[pointOffset] = drop.x;
          dropletPositions[pointOffset + 1] = drop.y + drop.length * 0.4;
          dropletPositions[pointOffset + 2] = drop.z;
        }
        rainGeometry.attributes.position.needsUpdate = true;
        dropletGeometry.attributes.position.needsUpdate = true;
      }

      const thunderWeather = mode === "rain" || mode === "storm";
      if (!paused && thunderWeather) {
        lightningClock -= dt;
        if (lightningClock <= 0) {
          lightningPulse = 1;
          lightningEchoClock = 0.09 + random() * 0.12;
          lightning.position.set(
            anchor.x + (random() - 0.5) * 900,
            420 + random() * 260,
            anchor.z + (random() - 0.5) * 900,
          );
          const thunderStrength = mode === "storm" ? 0.78 + random() * 0.22 : 0.48 + random() * 0.22;
          const thunderDelay = mode === "storm" ? 0.35 + random() * 2.1 : 0.8 + random() * 2.8;
          onThunder(thunderStrength, thunderDelay);
          lightningClock = mode === "storm" ? 5 + random() * 10 : 14 + random() * 18;
        }
        if (lightningEchoClock >= 0) {
          lightningEchoClock -= dt;
          if (lightningEchoClock < 0) lightningPulse = 0.68;
        }
        lightningPulse = Math.max(0, lightningPulse - dt * 8.8);
        lightning.intensity = lightningPulse > 0 ? 1.8 + lightningPulse * (mode === "storm" ? 9.5 : 6.2) : 0;
        renderer.domElement.dataset.thunderActive = lightningPulse > 0 ? "true" : "false";
      } else {
        lightning.intensity = 0;
        renderer.domElement.dataset.thunderActive = "false";
      }
    },
    dispose() {
      scene.remove(rain, droplets, stars, lightning);
      rainGeometry.dispose();
      rainMaterial.dispose();
      dropletGeometry.dispose();
      dropletMaterial.dispose();
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
  scene?: THREE.Scene,
) {
  const majorRoads = new Set(["motorway", "trunk", "primary", "secondary"]);
  const localRoads = new Set(["tertiary", "residential", "unclassified", "service"]);
  const shoulders: THREE.BufferGeometry[] = [];
  const surfaces: THREE.BufferGeometry[][] = [[], [], []];
  const centerLines: THREE.BufferGeometry[] = [];
  const edgeLines: THREE.BufferGeometry[] = [];

  // Roads are only ever seen from above, so each strip is its top face alone:
  // two triangles where a box would spend twelve on sides and an underside
  // nobody can see. `y` and `height` still describe the box it stands in for,
  // so every deck keeps the elevation it had.
  const segmentStrip = (
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
    const geometry = new THREE.PlaneGeometry(length + 0.8, width);
    geometry.rotateX(-Math.PI / 2);
    geometry.rotateY(-Math.atan2(dz, dx));
    geometry.translate(
      (x1 + x2) / 2 + normalX * lateralOffset,
      y + height / 2,
      (z1 + z2) / 2 + normalZ * lateralOffset,
    );
    return geometry;
  };

  for (const road of roads) {
    const bucket = majorRoads.has(road.kind) ? 0 : localRoads.has(road.kind) ? 1 : 2;
    const width = bucket === 0 ? (road.kind === "motorway" || road.kind === "trunk" ? 17 : 14) : bucket === 1 ? 7.5 : 4.2;
    // Separate road classes vertically and with per-layer polygonOffset so
    // shoulders, asphalt tiers, and markings never z-fight at distance or at
    // junctions. A tiny deterministic per-road and per-segment stagger also
    // separates same-class crossings and consecutive segment overlaps.
    const roadJitter = ((Math.abs(road.id) % 7) - 3) * 0.004;
    const surfaceY = (bucket === 0 ? 1.07 : bucket === 1 ? 0.93 : 0.79) + roadJitter;
    const shoulderY = 0.7 + roadJitter * 0.5;
    for (let index = 1; index < road.points.length; index++) {
      const [x1, z1] = road.points[index - 1];
      const [x2, z2] = road.points[index];
      if (inAirportClearance((x1 + x2) / 2, (z1 + z2) / 2, 12)) continue;
      const segStep = (index & 1) * 0.002;
      const surface = segmentStrip(x1, z1, x2, z2, width, 0.34, surfaceY + segStep);
      if (!surface) continue;
      surfaces[bucket].push(surface);
      const shoulder = segmentStrip(x1, z1, x2, z2, width + (bucket === 0 ? 5.5 : 2.4), 0.24, shoulderY + segStep);
      if (shoulder) shoulders.push(shoulder);
      if (bucket === 0) {
        const center = segmentStrip(x1, z1, x2, z2, 0.58, 0.09, 1.335 + roadJitter * 0.5 + segStep);
        if (center) centerLines.push(center);
        const edgeOffset = width / 2 - 0.85;
        const leftEdge = segmentStrip(x1, z1, x2, z2, 0.32, 0.075, 1.29 + roadJitter * 0.5 + segStep, -edgeOffset);
        const rightEdge = segmentStrip(x1, z1, x2, z2, 0.32, 0.075, 1.29 + roadJitter * 0.5 + segStep, edgeOffset);
        if (leftEdge) edgeLines.push(leftEdge);
        if (rightEdge) edgeLines.push(rightEdge);
      }
    }
  }

  // Strictly ordered polygonOffset keeps shoulders, road classes, and markings
  // cleanly layered even from kilometres away at grazing angles.
  await mergeIntoMeshBatches(
    parent,
    shoulders,
    new THREE.MeshStandardMaterial({
      color: 0xaaa28f,
      roughness: 0.96,
      polygonOffset: true,
      polygonOffsetFactor: -1,
      polygonOffsetUnits: -1,
    }),
    `${name} shoulders`,
    isCancelled,
  );
  const roadMaterials = [
    { color: 0x2f3735, offset: -4 },
    { color: 0x464f4b, offset: -3 },
    { color: 0x626b65, offset: -2 },
  ].map(({ color, offset }) => new THREE.MeshStandardMaterial({
    color,
    roughness: 0.96,
    polygonOffset: true,
    polygonOffsetFactor: offset,
    polygonOffsetUnits: offset,
  }));
  for (let index = 0; index < surfaces.length; index++) {
    await mergeIntoMeshBatches(parent, surfaces[index], roadMaterials[index], `${name} roads ${index}`, isCancelled);
  }
  // Road markings are the only continuous line work in the city, so lifting them
  // at night traces every corridor from the air the way real street lighting does.
  const centerLineMaterial = new THREE.MeshStandardMaterial({
    color: 0xe0bd62,
    roughness: 0.86,
    emissive: 0xffb347,
    emissiveIntensity: 0,
    polygonOffset: true,
    polygonOffsetFactor: -6,
    polygonOffsetUnits: -6,
  });
  centerLineMaterial.userData.nightGlowIntensity = 0.92;
  const edgeLineMaterial = new THREE.MeshStandardMaterial({
    color: 0xe5deca,
    roughness: 0.9,
    emissive: 0xfff0c8,
    emissiveIntensity: 0,
    polygonOffset: true,
    polygonOffsetFactor: -5,
    polygonOffsetUnits: -5,
  });
  edgeLineMaterial.userData.nightGlowIntensity = 0.58;
  if (scene) {
    const nightGlowMaterials = (scene.userData.nightGlowMaterials as THREE.MeshStandardMaterial[] | undefined) ?? [];
    if (!scene.userData.nightGlowMaterials) scene.userData.nightGlowMaterials = nightGlowMaterials;
    nightGlowMaterials.push(centerLineMaterial, edgeLineMaterial);
  }
  await mergeIntoMeshBatches(
    parent,
    centerLines,
    centerLineMaterial,
    `${name} center lines`,
    isCancelled,
  );
  await mergeIntoMeshBatches(
    parent,
    edgeLines,
    edgeLineMaterial,
    `${name} edge lines`,
    isCancelled,
  );
}

// Every building in the world funnels into a handful of shared materials — four
// merged OSM batches, three procedural-tile instance buckets, three immediate-mass
// buckets. Adding real window geometry across ±12 km is impossible, but a
// procedural window grid evaluated in the fragment shader costs no geometry, no
// draw calls, and no extra materials, and it works identically for merged meshes
// and InstancedMesh because it is driven entirely by world position and normal.
const NIGHT_WINDOW_GLOW = { value: 0 };
const NIGHT_WINDOW_TINT = { value: new THREE.Color(0xffc074) };

function applyNightWindows(material: THREE.MeshStandardMaterial, density = 0.5) {
  const densityUniform = { value: density };
  material.onBeforeCompile = (shader) => {
    shader.uniforms.bevNightGlow = NIGHT_WINDOW_GLOW;
    shader.uniforms.bevWindowTint = NIGHT_WINDOW_TINT;
    shader.uniforms.bevWindowDensity = densityUniform;
    shader.vertexShader = shader.vertexShader
      .replace(
        "#include <common>",
        `#include <common>
varying vec3 bevWorldPos;
varying vec3 bevWorldNormal;`,
      )
      // `begin_vertex` is where `transformed` first exists, and `objectNormal`
      // has already been set by `beginnormal_vertex` above it.
      .replace(
        "#include <begin_vertex>",
        `#include <begin_vertex>
#ifdef USE_INSTANCING
  bevWorldPos = ( modelMatrix * instanceMatrix * vec4( transformed, 1.0 ) ).xyz;
  bevWorldNormal = normalize( mat3( modelMatrix ) * mat3( instanceMatrix ) * objectNormal );
#else
  bevWorldPos = ( modelMatrix * vec4( transformed, 1.0 ) ).xyz;
  bevWorldNormal = normalize( mat3( modelMatrix ) * objectNormal );
#endif`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        "#include <common>",
        `#include <common>
varying vec3 bevWorldPos;
varying vec3 bevWorldNormal;
uniform float bevNightGlow;
uniform float bevWindowDensity;
uniform vec3 bevWindowTint;`,
      )
      // `totalEmissiveRadiance` is already declared and populated at this point,
      // so window light adds on top of whatever emissive the material had.
      .replace(
        "#include <emissivemap_fragment>",
        `#include <emissivemap_fragment>
if ( bevNightGlow > 0.001 ) {
  float bevWall = 1.0 - smoothstep( 0.30, 0.58, abs( bevWorldNormal.y ) );
  // Roofs and the first storey stay dark: lit windows start above street level.
  float bevStorey = smoothstep( 3.0, 7.0, bevWorldPos.y );
  if ( bevWall * bevStorey > 0.001 ) {
    // Read the facade along whichever horizontal axis it faces.
    float bevAcross = abs( bevWorldNormal.x ) > abs( bevWorldNormal.z ) ? bevWorldPos.z : bevWorldPos.x;
    vec2 bevCell = vec2( bevAcross / 4.6, bevWorldPos.y / 3.75 );
    vec2 bevId = floor( bevCell );
    vec2 bevUv = fract( bevCell );
    // Filter window edges with screen-space derivatives and blend toward the
    // average lit density once a cell shrinks below ~2 pixels, eliminating
    // sub-pixel moire and sparkle across distant facades at night.
    vec2 bevFw = max( fwidth( bevCell ), vec2( 0.001 ) );
    float bevPaneX = smoothstep( 0.17 - bevFw.x, 0.17 + bevFw.x, bevUv.x )
      * ( 1.0 - smoothstep( 0.70 - bevFw.x, 0.70 + bevFw.x, bevUv.x ) );
    float bevPaneY = smoothstep( 0.24 - bevFw.y, 0.24 + bevFw.y, bevUv.y )
      * ( 1.0 - smoothstep( 0.76 - bevFw.y, 0.76 + bevFw.y, bevUv.y ) );
    float bevPane = bevPaneX * bevPaneY;
    // Stable per-window hash so a given window keeps its state frame to frame.
    float bevNoise = fract( sin( dot( bevId, vec2( 37.31, 271.9 ) ) ) * 43758.5453 );
    float bevLit = step( 1.0 - bevWindowDensity, bevNoise );
    float bevWarmth = 0.55 + 0.75 * fract( bevNoise * 17.13 );
    float bevMip = smoothstep( 0.28, 1.1, max( bevFw.x, bevFw.y ) );
    float bevWindow = mix( bevPane * bevLit * bevWarmth, 0.255 * bevWindowDensity, bevMip );
    totalEmissiveRadiance += bevWindowTint * ( bevWindow * bevWall * bevStorey * bevNightGlow );
  }
}`,
      );
  };
  // Patched and unpatched standard materials must not share a compiled program.
  material.customProgramCacheKey = () => `bev-night-windows-${density}`;
  return material;
}

function addImmediateCityMass(scene: THREE.Scene, roads: OsmMapData["roads"]) {
  const group = new THREE.Group();
  group.name = "Immediate Greater Dhaka city mass";
  const geometry = new THREE.BoxGeometry(1, 1, 1);
  const materials = [0xc4b99f, 0xa9b3aa, 0xb47e69].map(
    (color) => applyNightWindows(new THREE.MeshStandardMaterial({ color, roughness: 0.94, metalness: 0.01 }), 0.46),
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
      // Keep the central Hatirjheel fallback block and airport apron clear so
      // immediate filler buildings never intersect them while OSM is loading.
      if (Math.abs(buildingX) < 1_090 && Math.abs(buildingZ) < 1_010) continue;
      if (inAirportClearance(buildingX, buildingZ, 40)) continue;
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
    (color) => applyNightWindows(new THREE.MeshStandardMaterial({ color, roughness: 0.9, metalness: 0.01 }), 0.5),
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
    await addRoadNetworkMeshes(roadFallback, roads, "Fallback", isCancelled, scene);
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
    if (inAirportClearance(x, z, Math.max(halfWidth, halfDepth) + 12)) return true;
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
      // Hidden tiles stay out of the scene graph entirely. There are thousands
      // of them, and three.js walks every attached object each frame whether or
      // not it is visible.
      group.visible = Math.hypot(centerX - initialPosition.x, centerZ - initialPosition.z) < visibilityRadius;
      group.updateMatrixWorld(true);
      group.traverse((object) => { object.matrixAutoUpdate = false; });
      if (group.visible) scene.add(group);
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

// The world's own sound: wind, wings, the city below, birds, weather. It plays
// whenever sound is on, the way a game's ambience does, and the radio is an
// optional layer over it that ducks it rather than replacing it.
//
// Everything is synthesised, so there are no audio files to ship. Layer gains
// are set so a cruise sits around -26 dBFS: the first version of this mix
// measured -53 dBFS, which is why the game seemed to have no sound at all.
function createFlightAudio(): FlightAudio {
  let context: AudioContext | null = null;
  let master: GainNode | null = null;
  let mix: GainNode | null = null;
  let analyser: AnalyserNode | null = null;
  let windLowGain: GainNode | null = null;
  let windAirGain: GainNode | null = null;
  let windAirFilter: BiquadFilterNode | null = null;
  let rainGain: GainNode | null = null;
  let waterGain: GainNode | null = null;
  let cityGain: GainNode | null = null;
  let washGain: GainNode | null = null;
  let cityFilter: BiquadFilterNode | null = null;
  let washFilter: BiquadFilterNode | null = null;
  let natureGain: GainNode | null = null;
  let streetGain: GainNode | null = null;
  let flapBuffer: AudioBuffer | null = null;
  let thunderRumbleBuffer: AudioBuffer | null = null;
  let thunderCrackBuffer: AudioBuffer | null = null;
  let birdCallTimer = 0;
  let streetTimer = 0;
  let weatherRainStrength = 0;
  let nearness = 0;
  let lastWingAt = 0;
  // `enabled` is whether sound is playing; `wanted` is the player's own choice,
  // which a later take-off must not override.
  let enabled = false;
  let wanted = true;
  let radioDucking = false;
  // Recorded calls, by species, as they finish downloading and decoding.
  const recordedCalls = new Map<string, AudioBuffer[]>();
  let clipsRequested = false;
  let playerSpecies = "crow";
  let lastCall = "none";

  // The player's own volume setting, as a multiple of the designed mix.
  let volume = 1;
  const activeGain = () => (radioDucking ? RADIO_DUCKED_AMBIENCE_GAIN : FLIGHT_AMBIENCE_GAIN) * volume;

  // Fetch the field recordings in the background once sound is on. Nothing
  // waits for them: until a species has a decoded clip, its calls are the
  // synthesised ones, and a failed download just leaves it that way.
  const loadRecordedCalls = () => {
    if (clipsRequested || !context) return;
    clipsRequested = true;
    const audioContext = context;
    for (const [species, urls] of Object.entries(soundClips as Record<string, string[]>)) {
      for (const url of urls) {
        void fetch(url)
          .then((response) => (response.ok ? response.arrayBuffer() : Promise.reject(new Error(String(response.status)))))
          .then((data) => audioContext.decodeAudioData(data))
          .then((buffer) => {
            const clips = recordedCalls.get(species) ?? [];
            clips.push(buffer);
            recordedCalls.set(species, clips);
          })
          .catch(() => {});
      }
    }
  };
  // How often each bird is heard over Dhaka. The crow is everywhere.
  const CALL_WEIGHTS: Record<string, number> = { crow: 4, koel: 2, shalik: 2, doel: 2, tiya: 1.5, chil: 1 };
  const playRecordedCall = () => {
    if (!context || !natureGain || recordedCalls.size === 0) return false;
    const own = recordedCalls.get(playerSpecies);
    // About one call in four is the player's own bird, close and clear; the
    // rest are other birds at a distance, quieter and duller the further off.
    const isOwn = Boolean(own?.length) && Math.random() < 0.26;
    let species = playerSpecies;
    if (!isOwn) {
      const available = [...recordedCalls.keys()];
      let pick = Math.random() * available.reduce((sum, key) => sum + (CALL_WEIGHTS[key] ?? 1), 0);
      species = available[available.length - 1];
      for (const key of available) {
        pick -= CALL_WEIGHTS[key] ?? 1;
        if (pick <= 0) {
          species = key;
          break;
        }
      }
    }
    const clips = recordedCalls.get(species);
    if (!clips?.length) return false;
    const buffer = clips[Math.floor(Math.random() * clips.length)];
    const distance = isOwn ? 0 : 0.25 + Math.random() * 0.75;
    const source = context.createBufferSource();
    source.buffer = buffer;
    // A little pitch variation keeps a repeated clip from sounding identical.
    source.playbackRate.value = 0.96 + Math.random() * 0.08;
    const air = filter(context, "lowpass", 9_000 - distance * 6_400, 0.4);
    const gain = level(context, isOwn ? 0.5 : 0.36 - distance * 0.26);
    const panner = context.createStereoPanner();
    panner.pan.value = isOwn ? Math.random() * 0.3 - 0.15 : Math.random() * 1.7 - 0.85;
    source.connect(air).connect(gain).connect(panner).connect(natureGain);
    source.onended = () => panner.disconnect();
    source.start();
    lastCall = `${species}${isOwn ? " (own)" : ""}`;
    return true;
  };

  // Filtered noise, normalised so every layer's gain means the same thing.
  const makeNoise = (audioContext: AudioContext, duration: number, softness = 0.76) => {
    const buffer = audioContext.createBuffer(1, audioContext.sampleRate * duration, audioContext.sampleRate);
    const data = buffer.getChannelData(0);
    let previous = 0;
    let loudest = 0;
    for (let i = 0; i < data.length; i++) {
      const white = Math.random() * 2 - 1;
      previous = previous * softness + white * (1 - softness);
      data[i] = previous;
      loudest = Math.max(loudest, Math.abs(previous));
    }
    const gain = loudest > 0 ? 0.9 / loudest : 1;
    for (let i = 0; i < data.length; i++) data[i] *= gain;
    return buffer;
  };

  const loop = (audioContext: AudioContext, duration: number, softness: number) => {
    const source = audioContext.createBufferSource();
    source.buffer = makeNoise(audioContext, duration, softness);
    source.loop = true;
    source.start();
    return source;
  };
  const filter = (audioContext: AudioContext, type: BiquadFilterType, frequency: number, q: number) => {
    const node = audioContext.createBiquadFilter();
    node.type = type;
    node.frequency.value = frequency;
    node.Q.value = q;
    return node;
  };
  const level = (audioContext: AudioContext, value: number) => {
    const node = audioContext.createGain();
    node.gain.value = value;
    return node;
  };
  // A slow wobble on a gain, so no bed is a perfectly steady hiss.
  const sway = (audioContext: AudioContext, target: AudioParam, rate: number, depth: number) => {
    const oscillator = audioContext.createOscillator();
    oscillator.frequency.value = rate;
    const amount = level(audioContext, depth);
    oscillator.connect(amount).connect(target);
    oscillator.start();
  };

  // One pitched note with its own envelope, panned and routed, cleaned up when done.
  const note = (
    destination: AudioNode,
    options: { type: OscillatorType; from: number; to: number; start: number; length: number; gain: number; shape?: BiquadFilterNode },
  ) => {
    if (!context) return;
    const oscillator = context.createOscillator();
    oscillator.type = options.type;
    oscillator.frequency.setValueAtTime(options.from, options.start);
    oscillator.frequency.exponentialRampToValueAtTime(options.to, options.start + options.length);
    const envelope = context.createGain();
    envelope.gain.setValueAtTime(0.0001, options.start);
    envelope.gain.exponentialRampToValueAtTime(options.gain, options.start + Math.min(0.03, options.length * 0.25));
    envelope.gain.exponentialRampToValueAtTime(0.0001, options.start + options.length);
    if (options.shape) oscillator.connect(options.shape).connect(envelope);
    else oscillator.connect(envelope);
    envelope.connect(destination);
    oscillator.onended = () => {
      envelope.disconnect();
      options.shape?.disconnect();
    };
    oscillator.start(options.start);
    oscillator.stop(options.start + options.length + 0.03);
  };
  const panned = (destination: AudioNode, lifetime: number) => {
    const panner = context!.createStereoPanner();
    panner.pan.value = Math.random() * 1.6 - 0.8;
    panner.connect(destination);
    window.setTimeout(() => panner.disconnect(), lifetime * 1000 + 400);
    return panner;
  };

  // The city's other birds, heard from the air: a small songbird, a distant
  // crow, and the koel's rising two-note whistle.
  const playBirdCall = () => {
    if (!enabled || !context || !natureGain) return;
    if (playRecordedCall()) return;
    lastCall = "synthesised";
    const now = context.currentTime + 0.02;
    const out = panned(natureGain, 1.6);
    const kind = Math.random();
    if (kind < 0.5) {
      const basePitch = 1_650 + Math.random() * 720;
      const notes = Math.random() > 0.5 ? 3 : 2;
      for (let index = 0; index < notes; index++) {
        const start = now + index * (0.105 + Math.random() * 0.035);
        note(out, { type: "sine", from: basePitch * (1 + index * 0.055), to: basePitch * (1.26 + index * 0.035), start, length: 0.19, gain: 0.13 });
      }
    } else if (kind < 0.78) {
      const caws = 2 + Math.floor(Math.random() * 2);
      for (let index = 0; index < caws; index++) {
        const start = now + index * 0.34;
        note(out, { type: "sawtooth", from: 470, to: 360, start, length: 0.24, gain: 0.1, shape: filter(context, "bandpass", 1_250, 2.2) });
      }
    } else {
      const calls = 2 + Math.floor(Math.random() * 2);
      for (let index = 0; index < calls; index++) {
        const start = now + index * 0.52;
        note(out, { type: "sine", from: 760 + index * 50, to: 1_180 + index * 70, start, length: 0.36, gain: 0.11 });
      }
    }
  };

  const scheduleBirdCall = (delay = 1_800 + Math.random() * 2_800) => {
    if (birdCallTimer) window.clearTimeout(birdCallTimer);
    birdCallTimer = window.setTimeout(() => {
      birdCallTimer = 0;
      playBirdCall();
      if (enabled) scheduleBirdCall(3_400 + Math.random() * 5_600);
    }, delay);
  };

  // Street life, only heard low over the city: a car horn or a rickshaw bell.
  const playStreetSound = () => {
    if (!enabled || !context || !streetGain || nearness < 0.12) return;
    const now = context.currentTime + 0.02;
    const out = panned(streetGain, 1.2);
    if (Math.random() < 0.6) {
      const pitch = 380 + Math.random() * 120;
      const taps = Math.random() < 0.4 ? 2 : 1;
      for (let tap = 0; tap < taps; tap++) {
        const start = now + tap * 0.26;
        const length = taps === 2 ? 0.16 : 0.22 + Math.random() * 0.3;
        for (const ratio of [1, 1.26]) {
          note(out, { type: "square", from: pitch * ratio, to: pitch * ratio * 0.99, start, length, gain: 0.05, shape: filter(context, "lowpass", 1_900, 0.7) });
        }
      }
    } else {
      const rings = 2 + Math.floor(Math.random() * 2);
      for (let ring = 0; ring < rings; ring++) {
        const start = now + ring * 0.17;
        note(out, { type: "sine", from: 2_350, to: 2_330, start, length: 0.32, gain: 0.05 });
        note(out, { type: "sine", from: 3_520, to: 3_500, start, length: 0.2, gain: 0.025 });
      }
    }
  };
  const scheduleStreetSound = (delay = 2_500 + Math.random() * 3_500) => {
    if (streetTimer) window.clearTimeout(streetTimer);
    streetTimer = window.setTimeout(() => {
      streetTimer = 0;
      playStreetSound();
      if (enabled) scheduleStreetSound(2_200 + Math.random() * 5_200);
    }, delay);
  };
  const stopSchedules = () => {
    if (birdCallTimer) window.clearTimeout(birdCallTimer);
    if (streetTimer) window.clearTimeout(streetTimer);
    birdCallTimer = 0;
    streetTimer = 0;
  };
  const startSchedules = () => {
    if (!birdCallTimer) scheduleBirdCall();
    if (!streetTimer) scheduleStreetSound();
  };

  const initialize = () => {
    if (context) return;
    context = new AudioContext();
    master = context.createGain();
    master.gain.value = 0;
    master.connect(context.destination);
    analyser = context.createAnalyser();
    analyser.fftSize = 4096;
    master.connect(analyser);
    // Every layer sums here, and one compressor keeps a thunderclap over a
    // boost from clipping.
    mix = context.createGain();
    mix.gain.value = 2;
    const compressor = context.createDynamicsCompressor();
    compressor.threshold.value = -16;
    compressor.knee.value = 12;
    compressor.ratio.value = 5;
    compressor.attack.value = 0.006;
    compressor.release.value = 0.28;
    mix.connect(compressor).connect(master);

    // Wind is two bands of one noise source: a low rush that is always there,
    // and an airy band that opens up with speed and in a dive.
    const windSource = loop(context, 4.5, 0.55);
    windLowGain = level(context, 0.3);
    windSource.connect(filter(context, "lowpass", 520, 0.5)).connect(windLowGain).connect(mix);
    windAirFilter = filter(context, "bandpass", 1_500, 0.6);
    windAirGain = level(context, 0.08);
    windSource.connect(windAirFilter).connect(windAirGain).connect(mix);
    sway(context, windLowGain.gain, 0.08, 0.05);
    sway(context, windAirGain.gain, 0.13, 0.02);

    const rainSource = loop(context, 6.4, 0.5);
    rainGain = level(context, weatherRainStrength * 0.55);
    rainSource.connect(filter(context, "highpass", 760, 0.2)).connect(filter(context, "lowpass", 4_600, 0.28)).connect(rainGain).connect(mix);

    const waterSource = loop(context, 5.2, 0.8);
    waterGain = level(context, 0.02);
    waterSource.connect(filter(context, "bandpass", 920, 0.7)).connect(waterGain).connect(mix);

    // A pitched oscillator reads as an electrical hum when it never stops.
    // Use a soft, filtered noise bed for distant city air instead, with a
    // mid-band wash of traffic over it that small speakers can reproduce.
    const cityBed = loop(context, 8.6, 0.93);
    cityGain = level(context, 0.1);
    cityFilter = filter(context, "lowpass", 260, 0.25);
    cityBed.connect(cityFilter).connect(cityGain).connect(mix);
    const trafficWash = loop(context, 7.1, 0.7);
    washGain = level(context, 0.02);
    washFilter = filter(context, "bandpass", 680, 0.45);
    trafficWash.connect(washFilter).connect(washGain).connect(mix);
    sway(context, washGain.gain, 0.06, 0.012);

    natureGain = level(context, 0.72);
    natureGain.connect(mix);
    streetGain = level(context, 0);
    streetGain.connect(mix);

    const leafRustle = loop(context, 7.4, 0.6);
    const rustleGain = level(context, 0.1);
    leafRustle.connect(filter(context, "bandpass", 2_350, 0.32)).connect(rustleGain).connect(natureGain);
    sway(context, rustleGain.gain, 0.11, 0.04);

    flapBuffer = makeNoise(context, 0.34, 0.5);
    thunderRumbleBuffer = makeNoise(context, 6.5, 0.982);
    thunderCrackBuffer = makeNoise(context, 0.72, 0.56);
  };

  // One wingbeat: a short rush of air that starts bright and closes down.
  const wingSound = (strength: number) => {
    if (!enabled || !context || !mix || !flapBuffer) return;
    const now = context.currentTime;
    if (now - lastWingAt < 0.11) return;
    lastWingAt = now;
    const source = context.createBufferSource();
    source.buffer = flapBuffer;
    source.playbackRate.value = 0.9 + Math.random() * 0.2;
    const shape = filter(context, "lowpass", 1_700, 0.6);
    shape.frequency.setValueAtTime(1_700, now);
    shape.frequency.exponentialRampToValueAtTime(420, now + 0.24);
    const gain = context.createGain();
    gain.gain.setValueAtTime(0.001, now);
    gain.gain.exponentialRampToValueAtTime(0.7 * strength, now + 0.04);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.28);
    source.connect(shape).connect(gain).connect(mix);
    source.onended = () => gain.disconnect();
    source.start(now);
  };

  const start = async () => {
    initialize();
    if (!context || !master) return false;
    await context.resume();
    if (!wanted) return false;
    enabled = true;
    master.gain.cancelScheduledValues(context.currentTime);
    master.gain.setTargetAtTime(activeGain(), context.currentTime, 0.45);
    startSchedules();
    loadRecordedCalls();
    return true;
  };

  return {
    start,
    async toggle() {
      if (!context || !master) {
        wanted = true;
        return start();
      }
      if (context.state === "suspended") await context.resume();
      enabled = !enabled;
      wanted = enabled;
      master.gain.cancelScheduledValues(context.currentTime);
      master.gain.setTargetAtTime(enabled ? activeGain() : 0, context.currentTime, 0.18);
      if (enabled) {
        startSchedules();
        loadRecordedCalls();
      } else stopSchedules();
      return enabled;
    },
    pause() {
      if (!context || !master) return;
      master.gain.cancelScheduledValues(context.currentTime);
      master.gain.setTargetAtTime(0, context.currentTime, 0.22);
      // Silencing the master still leaves the schedulers spinning up
      // oscillators nobody can hear, and a queued call would fire the instant
      // the flight resumes.
      stopSchedules();
    },
    resume() {
      if (!enabled || !context || !master) return;
      void context.resume();
      master.gain.cancelScheduledValues(context.currentTime);
      master.gain.setTargetAtTime(activeGain(), context.currentTime, 0.35);
      startSchedules();
    },
    flap() {
      wingSound(1);
    },
    wingbeat(strength) {
      wingSound(clamp(strength, 0, 1) * 0.55);
    },
    land() {
      if (!enabled || !context || !mix || !flapBuffer) return;
      const now = context.currentTime;
      // Feet meeting the perch, then the wings shuffling shut.
      const thud = context.createBufferSource();
      thud.buffer = flapBuffer;
      thud.playbackRate.value = 0.5;
      const gain = context.createGain();
      gain.gain.setValueAtTime(0.001, now);
      gain.gain.exponentialRampToValueAtTime(0.6, now + 0.015);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.2);
      thud.connect(filter(context, "lowpass", 240, 0.8)).connect(gain).connect(mix);
      thud.onended = () => gain.disconnect();
      thud.start(now);
      lastWingAt = 0;
      window.setTimeout(() => wingSound(0.45), 140);
    },
    thunder(strength, delay) {
      if (!enabled || !context || !mix || !thunderRumbleBuffer || !thunderCrackBuffer) return;
      const amount = clamp(strength, 0.25, 1);
      const startAt = context.currentTime + Math.max(0, delay);
      const panner = context.createStereoPanner();
      panner.pan.value = (Math.random() - 0.5) * 0.65;
      panner.connect(mix);

      const crack = context.createBufferSource();
      crack.buffer = thunderCrackBuffer;
      crack.playbackRate.value = 0.82 + Math.random() * 0.2;
      const crackGain = context.createGain();
      crackGain.gain.setValueAtTime(0.0001, startAt);
      crackGain.gain.exponentialRampToValueAtTime(0.9 * amount, startAt + 0.018);
      crackGain.gain.exponentialRampToValueAtTime(0.0001, startAt + 0.62);
      crack.connect(filter(context, "bandpass", 1_150 + Math.random() * 480, 0.48)).connect(crackGain).connect(panner);
      crack.start(startAt);
      crack.stop(startAt + 0.7);

      const rumble = context.createBufferSource();
      rumble.buffer = thunderRumbleBuffer;
      rumble.playbackRate.value = 0.68 + Math.random() * 0.16;
      const rumbleFilter = filter(context, "lowpass", 260, 0.72);
      rumbleFilter.frequency.setValueAtTime(320, startAt);
      rumbleFilter.frequency.exponentialRampToValueAtTime(120, startAt + 5.8);
      const rumbleGain = context.createGain();
      rumbleGain.gain.setValueAtTime(0.0001, startAt);
      rumbleGain.gain.exponentialRampToValueAtTime(1.3 * amount, startAt + 0.18);
      rumbleGain.gain.exponentialRampToValueAtTime(0.5 * amount, startAt + 1.6);
      rumbleGain.gain.exponentialRampToValueAtTime(0.0001, startAt + 6.1);
      rumble.connect(rumbleFilter).connect(rumbleGain).connect(panner);
      rumble.onended = () => panner.disconnect();
      rumble.start(startAt);
      rumble.stop(startAt + 6.2);
    },
    setFlight(speed, altitude, verticalSpeed) {
      if (!context || !windLowGain || !windAirGain || !windAirFilter || !waterGain || !cityGain || !washGain || !natureGain || !streetGain) return;
      const now = context.currentTime;
      // Standing on a perch there is only a light breeze; at a full boost or in
      // a steep dive the air roars.
      const pace = clamp(speed / BOOST_SPEED, 0, 1);
      const dive = clamp(Math.abs(verticalSpeed) / 22, 0, 1);
      windLowGain.gain.setTargetAtTime(0.1 + pace * 0.34, now, 0.35);
      windAirGain.gain.setTargetAtTime(0.05 + pace * pace * 0.5 + dive * 0.14, now, 0.3);
      windAirFilter.frequency.setTargetAtTime(1_100 + pace * 1_900 + dive * 500, now, 0.4);
      // The city rises to meet a low-flying bird and fades out with height.
      nearness = clamp(1 - altitude / 190, 0, 1);
      waterGain.gain.setTargetAtTime(0.012 + nearness * 0.05, now, 0.7);
      cityGain.gain.setTargetAtTime(0.07 + nearness * 0.2, now, 0.8);
      washGain.gain.setTargetAtTime(0.06 + nearness * nearness * 0.3, now, 0.8);
      natureGain.gain.setTargetAtTime(0.42 + nearness * 0.58, now, 1.1);
      streetGain.gain.setTargetAtTime(nearness, now, 0.9);
      // Distance takes the top off a sound before it takes the level, so the
      // city is duller as well as quieter from high up.
      cityFilter?.frequency.setTargetAtTime(200 + nearness * 260, now, 0.9);
      washFilter?.frequency.setTargetAtTime(480 + nearness * 420, now, 0.9);
    },
    setWeather(mode, precipitation) {
      weatherRainStrength = mode === "storm"
        ? 1
        : mode === "rain"
          ? clamp(0.62 + precipitation * 0.12, 0.62, 0.94)
          : mode === "drizzle"
            ? 0.3
            : 0;
      if (!context || !rainGain) return;
      rainGain.gain.setTargetAtTime(weatherRainStrength * 0.55, context.currentTime, 1.4);
    },
    setRadioDucking(active) {
      radioDucking = active;
      if (!enabled || !context || !master) return;
      master.gain.cancelScheduledValues(context.currentTime);
      master.gain.setTargetAtTime(activeGain(), context.currentTime, 0.28);
    },
    setBird(id) {
      playerSpecies = id;
    },
    setVolume(next) {
      volume = clamp(next, 0, 1.5);
      if (!enabled || !context || !master) return;
      master.gain.cancelScheduledValues(context.currentTime);
      master.gain.setTargetAtTime(activeGain(), context.currentTime, 0.08);
    },
    probe() {
      const clips = [...recordedCalls.values()].reduce((count, list) => count + list.length, 0);
      if (!context || !analyser) return { state: context?.state ?? "none", rms: 0, peak: 0, above250: 0, clips, lastCall };
      const samples = new Float32Array(analyser.fftSize);
      analyser.getFloatTimeDomainData(samples);
      let sum = 0;
      let peak = 0;
      for (const sample of samples) {
        sum += sample * sample;
        peak = Math.max(peak, Math.abs(sample));
      }
      // Laptop speakers reproduce very little below about 250 Hz, so the part of
      // the mix above that is what most players will actually hear.
      const spectrum = new Float32Array(analyser.frequencyBinCount);
      analyser.getFloatFrequencyData(spectrum);
      const binWidth = context.sampleRate / analyser.fftSize;
      let power = 0;
      for (let bin = Math.ceil(250 / binWidth); bin < spectrum.length; bin++) power += 10 ** (spectrum[bin] / 10);
      return { state: context.state, rms: Math.sqrt(sum / samples.length), peak, above250: Math.sqrt(power), clips, lastCall };
    },
    dispose() {
      enabled = false;
      stopSchedules();
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
  let melodyTimer = 0;
  let melodyStep = 0;

  const stopGentleMelody = () => {
    if (melodyTimer) window.clearTimeout(melodyTimer);
    melodyTimer = 0;
  };

  const fadeSynth = (target: number) => {
    if (!context || !synthMaster) return;
    const now = context.currentTime;
    synthMaster.gain.cancelScheduledValues(now);
    synthMaster.gain.setTargetAtTime(target, now, target > 0 ? 1.6 : 0.22);
  };

  // Two bare sines an octave apart read as a test tone. A sub, a fifth and an
  // occasional struck chime give the phrase a body and a decay that sound played
  // rather than generated, while still leaving real silence between phrases.
  const GENTLE_VOICES = [
    { ratio: 0.5, peak: 0.011, attack: 1.9, release: 8.4, pan: -0.12 },
    { ratio: 1, peak: 0.017, attack: 1.3, release: 7.4, pan: 0.16 },
    { ratio: 1.5, peak: 0.007, attack: 2.3, release: 6.8, pan: -0.34 },
    { ratio: 2, peak: 0.005, attack: 1.6, release: 6.1, pan: 0.31 },
  ];

  const playGentleNote = () => {
    if (!context || !synthMaster || !enabled || currentStation?.stream) return;
    // A pentatonic-leaning line: every pair of notes is consonant, so the phrases
    // never resolve anywhere uncomfortable no matter which order they arrive in.
    const roots = [196, 220, 261.63, 174.61, 196, 233.08, 220, 146.83];
    const root = roots[melodyStep % roots.length];
    melodyStep++;
    const now = context.currentTime;
    const direction = melodyStep % 2 === 0 ? -1 : 1;

    for (const voice of GENTLE_VOICES) {
      const oscillator = context.createOscillator();
      oscillator.type = "sine";
      oscillator.frequency.value = root * voice.ratio;
      // A few cents of drift keeps the sustained voices from beating perfectly.
      oscillator.detune.value = (melodyStep % 3 - 1) * 3.5;
      const envelope = context.createGain();
      envelope.gain.setValueAtTime(0.0001, now);
      envelope.gain.exponentialRampToValueAtTime(voice.peak, now + voice.attack);
      envelope.gain.exponentialRampToValueAtTime(0.0001, now + voice.release);
      const panner = context.createStereoPanner();
      panner.pan.value = voice.pan * direction;
      oscillator.connect(envelope).connect(panner).connect(synthMaster);
      oscillator.onended = () => {
        oscillator.disconnect();
        envelope.disconnect();
        panner.disconnect();
      };
      oscillator.start(now);
      oscillator.stop(now + voice.release + 0.1);
    }

    // The station promises distant chimes, so roughly every third phrase strikes
    // one: fast attack, long tail, well above the pad so it reads as a bell.
    if (melodyStep % 3 === 1) {
      const chime = context.createOscillator();
      chime.type = "sine";
      chime.frequency.value = root * 6;
      const chimeEnvelope = context.createGain();
      const strikeAt = now + 1.1;
      chimeEnvelope.gain.setValueAtTime(0.0001, strikeAt);
      chimeEnvelope.gain.exponentialRampToValueAtTime(0.0045, strikeAt + 0.02);
      chimeEnvelope.gain.exponentialRampToValueAtTime(0.0001, strikeAt + 5.2);
      const chimePan = context.createStereoPanner();
      chimePan.pan.value = -0.42 * direction;
      chime.connect(chimeEnvelope).connect(chimePan).connect(synthMaster);
      chime.onended = () => {
        chime.disconnect();
        chimeEnvelope.disconnect();
        chimePan.disconnect();
      };
      chime.start(strikeAt);
      chime.stop(strikeAt + 5.3);
    }
  };

  const scheduleGentleMelody = (delay = 900) => {
    stopGentleMelody();
    melodyTimer = window.setTimeout(() => {
      melodyTimer = 0;
      playGentleNote();
      if (enabled && !currentStation?.stream) scheduleGentleMelody(6_200 + Math.random() * 3_600);
    }, delay);
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
    rainFilter.type = "lowpass";
    rainFilter.frequency.value = 1_050;
    rainFilter.Q.value = 0.18;
    const rainGain = context.createGain();
    rainGain.gain.value = 0.042;
    rain.connect(rainFilter).connect(rainGain).connect(synthMaster);
    rain.start();
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
      stopGentleMelody();
      onStatus("buffering");
      if (!station.stream) {
        initializeRelaxingStation();
        void context?.resume();
        melodyStep = 0;
        scheduleGentleMelody();
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
      stopGentleMelody();
      onStatus("off");
    },
    pause() {
      if (!enabled) return;
      liveAudio.pause();
      fadeSynth(0);
      stopGentleMelody();
      onStatus("paused");
    },
    async resume() {
      if (!enabled || !currentStation) return;
      if (!currentStation.stream) {
        void context?.resume();
        scheduleGentleMelody();
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
      stopGentleMelody();
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
  const glass = applyNightWindows(new THREE.MeshPhysicalMaterial({ color: 0x537f88, roughness: 0.2, metalness: 0.16, clearcoat: 0.45 }), 0.62);
  const darkGlass = applyNightWindows(new THREE.MeshStandardMaterial({ color: 0x294b54, roughness: 0.2, metalness: 0.26 }), 0.6);
  const recess = new THREE.MeshStandardMaterial({ color: 0x202625, roughness: 0.98 });
  const accent = new THREE.MeshStandardMaterial({ color: 0xcaa24c, roughness: 0.56, metalness: 0.22 });
  const lawn = new THREE.MeshStandardMaterial({ color: 0x688652, roughness: 1 });
  const water = new THREE.MeshPhysicalMaterial({ color: 0x407e8a, roughness: 0.2, metalness: 0.04, clearcoat: 0.7 });
  const monumentRed = new THREE.MeshStandardMaterial({ color: 0xb92d32, roughness: 0.76 });
  const marble = new THREE.MeshStandardMaterial({ color: 0xf5f2ea, roughness: 0.58 });
  const terracotta = new THREE.MeshStandardMaterial({ color: 0xa9604b, roughness: 0.94 });
  const plazaBrick = new THREE.MeshStandardMaterial({ color: 0x8f4a3a, roughness: 0.96 });
  const deepBrick = new THREE.MeshStandardMaterial({ color: 0x9a3f31, roughness: 0.9 });
  const brickTrim = new THREE.MeshStandardMaterial({ color: 0xc27a62, roughness: 0.86 });
  const bronze = new THREE.MeshStandardMaterial({ color: 0x6f6a5c, roughness: 0.5, metalness: 0.45 });
  const cream = new THREE.MeshStandardMaterial({ color: 0xefe6cf, roughness: 0.82 });
  const peach = new THREE.MeshStandardMaterial({ color: 0xe6b497, roughness: 0.86 });
  const tileRoof = new THREE.MeshStandardMaterial({ color: 0x9c4f3c, roughness: 0.9 });
  const salmon = new THREE.MeshStandardMaterial({ color: 0xdf9184, roughness: 0.84 });
  const salmonTrim = new THREE.MeshStandardMaterial({ color: 0xf4d6cb, roughness: 0.78 });
  const roofTerrace = new THREE.MeshStandardMaterial({ color: 0xb59c90, roughness: 0.95 });
  const stoneStep = new THREE.MeshStandardMaterial({ color: 0x8d7868, roughness: 0.93 });
  const silverPanel = new THREE.MeshStandardMaterial({ color: 0xcdd2d4, roughness: 0.46, metalness: 0.32 });
  const roofGrey = new THREE.MeshStandardMaterial({ color: 0x858c8a, roughness: 0.9 });
  const plantGrey = new THREE.MeshStandardMaterial({ color: 0xa9adab, roughness: 0.7, metalness: 0.2 });
  // Materials that glow after dark share the city's night-window uniform, so
  // landmark openings come on with the rest of the skyline.
  const nightLit = <T extends THREE.MeshStandardMaterial>(material: T, strength: number, tint = 0xffc27a) => {
    const tintUniform = { value: new THREE.Color(tint).multiplyScalar(strength) };
    material.onBeforeCompile = (shader) => {
      shader.uniforms.bevNightGlow = NIGHT_WINDOW_GLOW;
      shader.uniforms.bevLitTint = tintUniform;
      shader.fragmentShader = shader.fragmentShader
        .replace("#include <common>", "#include <common>\nuniform float bevNightGlow;\nuniform vec3 bevLitTint;")
        .replace("#include <emissivemap_fragment>", "#include <emissivemap_fragment>\ntotalEmissiveRadiance += bevLitTint * bevNightGlow;");
    };
    material.customProgramCacheKey = () => `bev-night-lit-${tint}-${strength}`;
    return material;
  };
  const archDark = nightLit(new THREE.MeshStandardMaterial({
    color: 0x3d2a22,
    roughness: 0.9,
    polygonOffset: true,
    polygonOffsetFactor: -1,
    polygonOffsetUnits: -1,
  }), 0.55);
  const ribbonGlass = nightLit(new THREE.MeshStandardMaterial({ color: 0x24434c, roughness: 0.22, metalness: 0.3 }), 0.34, 0xffd9a0);
  const atriumGlass = nightLit(new THREE.MeshPhysicalMaterial({ color: 0x4f9aa6, roughness: 0.16, metalness: 0.2, clearcoat: 0.6 }), 0.3, 0xfff0c8);
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

  const addCone = (
    parent: THREE.Object3D,
    radius: number,
    height: number,
    position: [number, number, number],
    material: THREE.Material,
    segments = 8,
  ) => {
    const mesh = new THREE.Mesh(new THREE.ConeGeometry(radius, height, segments), material);
    mesh.position.set(...position);
    mesh.castShadow = true;
    parent.add(mesh);
    return mesh;
  };

  // A dome turned from a profile of [radius, height] pairs. `flat` gives faceted
  // (octagonal, ribbed) domes instead of a smooth shell.
  const addLathe = (
    parent: THREE.Object3D,
    profile: Array<[number, number]>,
    segments: number,
    position: [number, number, number],
    material: THREE.Material,
    flat = false,
  ) => {
    let geometry: THREE.BufferGeometry = new THREE.LatheGeometry(profile.map(([r, y]) => new THREE.Vector2(r, y)), segments);
    if (flat) {
      geometry = geometry.toNonIndexed();
      geometry.computeVertexNormals();
    }
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.set(...position);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    parent.add(mesh);
    return mesh;
  };
  // Profile for a masonry dome: `bulge` > 0 swells it past its springing line
  // (Mughal and Indo-Saracenic domes), and the tip is drawn up into a point.
  const domeProfile = (radius: number, height: number, bulge = 0, steps = 12) => {
    const profile: Array<[number, number]> = [];
    for (let step = 0; step <= steps; step++) {
      const t = step / steps;
      const angle = t * Math.PI / 2;
      const swell = 1 + bulge * Math.sin(Math.min(1, t * 2.2) * Math.PI);
      profile.push([Math.max(0.001, radius * Math.cos(angle) * swell), height * (Math.sin(angle) * 0.86 + t * t * 0.14)]);
    }
    return profile;
  };
  const addFinial = (parent: THREE.Object3D, position: [number, number, number], size = 1, material: THREE.Material = accent) => {
    const [x, y, z] = position;
    const ball = new THREE.Mesh(new THREE.SphereGeometry(0.55 * size, 8, 6), material);
    ball.position.set(x, y + 0.5 * size, z);
    parent.add(ball);
    addCone(parent, 0.22 * size, 2.6 * size, [x, y + 2.1 * size, z], material, 6);
  };

  // Flat facade openings. Each is drawn in the XY plane with its origin at the
  // bottom centre, and faces +Z until a wall edge turns it.
  const shapeGeometry = (shape: THREE.Shape, segments = 10) => new THREE.ShapeGeometry(shape, segments);
  const roundArch = (width: number, height: number) => {
    const half = width / 2;
    const shape = new THREE.Shape();
    shape.moveTo(-half, 0);
    shape.lineTo(half, 0);
    shape.lineTo(half, height - half);
    shape.absarc(0, height - half, half, 0, Math.PI, false);
    shape.lineTo(-half, 0);
    return shapeGeometry(shape);
  };
  const pointedArch = (width: number, height: number) => {
    const half = width / 2;
    const spring = height - width * 0.72;
    const shape = new THREE.Shape();
    shape.moveTo(-half, 0);
    shape.lineTo(half, 0);
    shape.lineTo(half, spring);
    shape.quadraticCurveTo(half, height - width * 0.2, 0, height);
    shape.quadraticCurveTo(-half, height - width * 0.2, -half, spring);
    shape.lineTo(-half, 0);
    return shapeGeometry(shape);
  };
  const rectPane = (width: number, height: number) => {
    const geometry = new THREE.PlaneGeometry(width, height);
    geometry.translate(0, height / 2, 0);
    return geometry;
  };
  const discPane = (radius: number, segments = 36) => {
    const geometry = new THREE.CircleGeometry(radius, segments);
    geometry.translate(0, radius, 0);
    return geometry;
  };
  const trianglePane = (width: number, height: number) => {
    const shape = new THREE.Shape();
    shape.moveTo(-width / 2, 0);
    shape.lineTo(width / 2, 0);
    shape.lineTo(0, height);
    shape.lineTo(-width / 2, 0);
    return shapeGeometry(shape, 1);
  };

  type WallEdge = { ax: number; az: number; dx: number; dz: number; nx: number; nz: number; length: number; rotationY: number };
  // Offset a closed 2D polygon along its outward edge normals so floor bands,
  // cornices and parapets stand cleanly proud of every wall — including concave
  // and radial faces where radial scaling would lie coplanar or cut inward.
  const offsetPolygon = (points: MapPoint[], offset: number): MapPoint[] => {
    const clean: MapPoint[] = [];
    for (const point of points) {
      const prev = clean[clean.length - 1];
      if (!prev || Math.hypot(point[0] - prev[0], point[1] - prev[1]) > 0.05) clean.push(point);
    }
    if (clean.length > 1 && Math.hypot(clean[0][0] - clean[clean.length - 1][0], clean[0][1] - clean[clean.length - 1][1]) <= 0.05) {
      clean.pop();
    }
    if (clean.length < 3) return points;
    let area = 0;
    for (let index = 0; index < clean.length; index++) {
      const [ax, az] = clean[index];
      const [bx, bz] = clean[(index + 1) % clean.length];
      area += ax * bz - bx * az;
    }
    const side = area > 0 ? 1 : -1;
    const normals: MapPoint[] = clean.map(([ax, az], index) => {
      const [bx, bz] = clean[(index + 1) % clean.length];
      const length = Math.hypot(bx - ax, bz - az) || 1;
      return [((bz - az) / length) * side, -((bx - ax) / length) * side];
    });
    return clean.map(([x, z], index) => {
      const [nx0, nz0] = normals[(index - 1 + clean.length) % clean.length];
      const [nx1, nz1] = normals[index];
      let bx = nx0 + nx1;
      let bz = nz0 + nz1;
      const bLen = Math.hypot(bx, bz);
      if (bLen < 1e-4) {
        bx = nx1;
        bz = nz1;
      } else {
        bx /= bLen;
        bz /= bLen;
      }
      const scale = offset / Math.max(bx * nx1 + bz * nz1, 0.45);
      return [x + bx * scale, z + bz * scale] as MapPoint;
    });
  };

  // Every wall of an outline, with the normal that points away from the building.
  const wallEdges = (points: MapPoint[]): WallEdge[] => {
    let area = 0;
    for (let index = 0; index < points.length; index++) {
      const [ax, az] = points[index];
      const [bx, bz] = points[(index + 1) % points.length];
      area += ax * bz - bx * az;
    }
    const edges: WallEdge[] = [];
    for (let index = 0; index < points.length; index++) {
      const [ax, az] = points[index];
      const [bx, bz] = points[(index + 1) % points.length];
      const length = Math.hypot(bx - ax, bz - az);
      if (length < 0.5) continue;
      const dx = (bx - ax) / length;
      const dz = (bz - az) / length;
      const side = area > 0 ? 1 : -1;
      const nx = dz * side;
      const nz = -dx * side;
      edges.push({ ax, az, dx, dz, nx, nz, length, rotationY: Math.atan2(nx, nz) });
    }
    return edges;
  };
  // Stand a flat opening on a wall edge, `along` metres from the edge's start.
  const addOnWall = (
    parent: THREE.Object3D,
    edge: WallEdge,
    along: number,
    y: number,
    geometry: THREE.BufferGeometry,
    material: THREE.Material,
    proud = 0.12,
  ) => {
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.set(edge.ax + edge.dx * along + edge.nx * proud, y, edge.az + edge.dz * along + edge.nz * proud);
    mesh.rotation.y = edge.rotationY;
    parent.add(mesh);
    return mesh;
  };
  type BayStorey = { y: number; opening: THREE.BufferGeometry; surround?: THREE.BufferGeometry };
  // Regular bays of openings along every wall long enough to take one, so
  // arcades and window rows follow the real wall line of any footprint.
  const addBays = (
    parent: THREE.Object3D,
    edges: WallEdge[],
    options: {
      bay: number;
      storeys: BayStorey[];
      opening: THREE.Material;
      surround?: THREE.Material;
      minEdge?: number;
      margin?: number;
      pier?: { width: number; depth: number; bottom: number; top: number; material: THREE.Material };
    },
  ) => {
    const margin = options.margin ?? 0.8;
    for (const edge of edges) {
      if (edge.length < (options.minEdge ?? options.bay)) continue;
      const usable = edge.length - margin * 2;
      const count = Math.max(1, Math.floor(usable / options.bay));
      const spacing = usable / count;
      for (let index = 0; index < count; index++) {
        const along = margin + (index + 0.5) * spacing;
        for (const storey of options.storeys) {
          if (storey.surround && options.surround) addOnWall(parent, edge, along, storey.y - 0.25, storey.surround, options.surround, 0.14);
          addOnWall(parent, edge, along, storey.y, storey.opening, options.opening, 0.26);
        }
      }
      if (options.pier) {
        const { width, depth, bottom, top, material } = options.pier;
        for (let index = 0; index <= count; index++) {
          const along = margin + index * spacing;
          const pier = addBox(parent, [width, top - bottom, depth], [
            edge.ax + edge.dx * along + edge.nx * depth * 0.4,
            (top + bottom) / 2,
            edge.az + edge.dz * along + edge.nz * depth * 0.4,
          ], material);
          pier.rotation.y = edge.rotationY;
        }
      }
    }
  };

  // A chhatri: the small domed kiosk that crowns Mughal and Indo-Saracenic roofs.
  const addChhatri = (
    parent: THREE.Object3D,
    position: [number, number, number],
    size: number,
    body: THREE.Material,
    dome: THREE.Material,
  ) => {
    const [x, y, z] = position;
    addBox(parent, [size * 1.15, size * 0.14, size * 1.15], [x, y + size * 0.07, z], body);
    for (const cx of [-1, 1]) {
      for (const cz of [-1, 1]) addBox(parent, [size * 0.13, size * 0.8, size * 0.13], [x + cx * size * 0.42, y + size * 0.5, z + cz * size * 0.42], body);
    }
    addBox(parent, [size * 1.3, size * 0.12, size * 1.3], [x, y + size * 0.96, z], body);
    addLathe(parent, domeProfile(size * 0.5, size * 0.62, 0.12, 7), 10, [x, y + size * 1.02, z], dome);
    addFinial(parent, [x, y + size * 1.62, z], size * 0.16);
  };

  // Collapse a finished detail group to one mesh per material. Landmark detail
  // is static, so hundreds of small parts should not cost hundreds of draw calls.
  const bakeGroup = (group: THREE.Group) => {
    group.updateMatrixWorld(true);
    const toGroup = group.matrixWorld.clone().invert();
    const buckets = new Map<THREE.Material, THREE.BufferGeometry[]>();
    const sources: THREE.Mesh[] = [];
    const relative = new THREE.Matrix4();
    group.traverse((object) => {
      if (!(object instanceof THREE.Mesh) || object instanceof THREE.InstancedMesh || Array.isArray(object.material)) return;
      const geometry = object.geometry.index ? object.geometry.toNonIndexed() : object.geometry.clone();
      for (const name of Object.keys(geometry.attributes)) {
        if (name !== "position" && name !== "normal" && name !== "uv") geometry.deleteAttribute(name);
      }
      geometry.applyMatrix4(relative.multiplyMatrices(toGroup, object.matrixWorld));
      const bucket = buckets.get(object.material) ?? [];
      bucket.push(geometry);
      buckets.set(object.material, bucket);
      sources.push(object);
    });
    for (const source of sources) {
      source.removeFromParent();
      if (source.geometry !== unitBox) source.geometry.dispose();
    }
    for (const [material, geometries] of buckets) {
      const merged = mergeGeometries(geometries, false);
      geometries.forEach((geometry) => geometry.dispose());
      if (!merged) continue;
      const mesh = new THREE.Mesh(merged, material);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      group.add(mesh);
    }
  };

  // Floating name labels are canvas textures, so switching language means
  // redrawing them. Each sprite keeps its own redraw, and `relabel` runs them all.
  const addLabel = (position: THREE.Vector3, text: string, parent: THREE.Object3D = root, onMetro = false) => {
    const canvas = document.createElement("canvas");
    canvas.width = 512;
    canvas.height = 96;
    const context = canvas.getContext("2d");
    if (!context) return;
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.minFilter = THREE.LinearFilter;
    const draw = () => {
      const locale = (scene.userData.labelLocale as Locale | undefined) ?? "en";
      const translated = worldLabelText(locale, text, onMetro);
      const content = locale === "en" ? translated.toUpperCase() : translated;
      // Bengali has no monospace tradition and needs its own face to shape
      // conjuncts properly; Latin labels keep the instrument-panel look.
      const family = locale === "bn"
        ? `${getComputedStyle(document.body).getPropertyValue("--font-bangla") || "sans-serif"}, sans-serif`
        : "monospace";
      context.clearRect(0, 0, 512, 96);
      context.fillStyle = "rgba(17, 23, 22, 0.9)";
      context.fillRect(3, 3, 506, 90);
      context.strokeStyle = "rgba(255, 204, 91, 0.92)";
      context.lineWidth = 4;
      context.strokeRect(5, 5, 502, 86);
      context.fillStyle = "#ffcc5b";
      context.textAlign = "center";
      context.textBaseline = "middle";
      let size = locale === "bn" ? 38 : 31;
      do {
        context.font = `700 ${size}px ${family}`;
        size -= 2;
      } while (size > 16 && context.measureText(content).width > 478);
      context.fillText(content, 256, locale === "bn" ? 52 : 50);
      texture.needsUpdate = true;
    };
    draw();
    const label = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, transparent: true, depthWrite: false, toneMapped: false }));
    label.position.copy(position);
    label.scale.set(96, 18, 1);
    label.userData.redrawLabel = draw;
    parent.add(label);
  };
  scene.userData.relabel = (locale: Locale) => {
    scene.userData.labelLocale = locale;
    root.traverse((object) => {
      (object.userData.redrawLabel as (() => void) | undefined)?.();
    });
  };

  const partMaterial = (kind: DhakaLandmark["kind"], part: LandmarkFootprintPart) => {
    if (part.role === "water") return water;
    if (part.role === "ground") {
      if (kind === "amphitheatre" || kind === "shaheed-minar") return paleConcrete;
      return lawn;
    }
    if (kind === "church") return part.role === "tower" ? paleConcrete : whiteStone;
    if (kind === "bashundhara-city") return part.osmId === 1092674471 ? atriumGlass : silverPanel;
    if (kind === "police-plaza") return glass;
    if (kind === "brac") return brick;
    if (kind === "hotel") return darkGlass;
    if (kind === "parliament") return concrete;
    if (kind === "lalbagh-fort") return part.role === "tomb" || part.role === "museum" ? peach : redBrick;
    if (kind === "ahsan-manzil") return salmon;
    if (kind === "curzon-hall") return redBrick;
    if (kind === "baitul-mukarram") return paleConcrete;
    return whiteStone;
  };

  // The OSM snapshot's heights are coarse tags. Where a part's real proportions
  // matter to how the building reads, model it at its true height instead.
  const PART_HEIGHTS: Record<number, number> = {
    624025793: 14, // Ahsan Manzil: two storeys on a plinth, the dome carries the height
    624025792: 11,
    24448713: 33, // Bashundhara City mall podium
    1092674471: 37, // atrium rotunda
    1092674472: 80, // office tower
    186664126: 13, // Baitul Mukarram's low wings; the prayer-hall cube stands above them
  };
  const partHeight = (part: LandmarkFootprintPart) => PART_HEIGHTS[part.osmId] ?? part.height;
  const partBounds = new Map<number, { minX: number; maxX: number; minZ: number; maxZ: number; height: number }>();
  // Bounding boxes are enough to hang a dome or a spire off, but banding and wall
  // voids have to follow the actual wall line, so keep the polygons too.
  const partOutlines = new Map<number, MapPoint[]>();
  const allBounds = new Map<DhakaLandmark["kind"], { minX: number; maxX: number; minZ: number; maxZ: number; top: number }>();
  const landmarkMeshes = new Map<DhakaLandmark["kind"], THREE.Object3D[]>();

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
      const rawPoints = part.points.map(([lat, lon]) => {
        const world = coordinatesToWorld(lat, lon);
        return [world.x, world.y] as MapPoint;
      });
      // Holy Rosary Church's bell tower shares 9 wall vertices with the white
      // upper wings; outsetting it slightly stops the two materials z-fighting.
      const points = part.osmId === 983631140 ? offsetPolygon(rawPoints, 0.18) : rawPoints;
      const xs = points.map(([x]) => x);
      const zs = points.map(([, z]) => z);
      const partMinX = Math.min(...xs);
      const partMaxX = Math.max(...xs);
      const partMinZ = Math.min(...zs);
      const partMaxZ = Math.max(...zs);
      const height = partHeight(part);
      partBounds.set(part.osmId, { minX: partMinX, maxX: partMaxX, minZ: partMinZ, maxZ: partMaxZ, height });
      partOutlines.set(part.osmId, points);
      if (part.role !== "ground" && part.role !== "water") {
        minX = Math.min(minX, partMinX);
        maxX = Math.max(maxX, partMaxX);
        minZ = Math.min(minZ, partMinZ);
        maxZ = Math.max(maxZ, partMaxZ);
        top = Math.max(top, height);
      }

      const geometry = new THREE.ExtrudeGeometry(polygonShape(points), {
        depth: height,
        bevelEnabled: false,
        curveSegments: 1,
      });
      geometry.rotateX(-Math.PI / 2);
      const mesh = new THREE.Mesh(geometry, partMaterial(landmark.kind, part));
      mesh.name = `${landmark.label} · OSM ${part.osmId} · ${part.role}`;
      // Lalbagh Fort's reflecting tank sits inside the fort's 1.4 m lawn, so it
      // rises above the lawn instead of fighting underneath it.
      mesh.position.y = part.role === "water" ? (part.osmId === 624024882 ? 1.32 : 0.72) : 0.9;
      mesh.castShadow = part.role !== "ground" && part.role !== "water";
      mesh.receiveShadow = true;
      mesh.userData.osmId = part.osmId;
      root.add(mesh);
      const partMeshes = landmarkMeshes.get(landmark.kind) ?? [];
      partMeshes.push(mesh);
      landmarkMeshes.set(landmark.kind, partMeshes);
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

  const perchRay = new THREE.Raycaster();
  const perchOrigin = new THREE.Vector3();
  const perchDown = new THREE.Vector3(0, -1, 0);

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
    // The wall line of one part, re-centred on that part so a mesh built from it
    // can be positioned and scaled about its own middle.
    const outline = (osmId: number) => {
      const points = partOutlines.get(osmId);
      const part = partBounds.get(osmId);
      if (!points || !part) return null;
      const centreX = (part.minX + part.maxX) / 2;
      const centreZ = (part.minZ + part.maxZ) / 2;
      return points.map(([x, z]) => [x - centreX, z - centreZ] as MapPoint);
    };
    // The same wall line in the detail group's own coordinates.
    const walls = (osmId: number) => {
      const points = partOutlines.get(osmId);
      return points ? wallEdges(points.map(([x, z]) => [x - group.position.x, z - group.position.z] as MapPoint)) : [];
    };
    // A slab that follows a part's outline: string courses, cornices, parapets
    // and roof finishes. Outward slabs (`grow > 1`) offset every edge along its
    // true normal so concave and radial walls never lie coplanar with the mass;
    // inset roof finishes (`grow < 1`) are thickened enough to stay clean at
    // distance.
    const slabGeometries = new Map<string, THREE.BufferGeometry>();
    const slab = (osmId: number, y: number, height: number, grow: number, material: THREE.Material) => {
      const local = outline(osmId);
      const seat = anchor(osmId);
      if (!local || !seat) return null;
      const outset = grow > 1 ? clamp((grow - 1) * Math.min(seat.width, seat.depth) * 0.5, 0.24, 1.5) : 0;
      const depth = grow < 1 ? Math.max(0.18, height) : height;
      const key = `${osmId}:${depth.toFixed(3)}:${outset.toFixed(3)}`;
      let geometry = slabGeometries.get(key);
      if (!geometry) {
        const ring = outset > 0 ? offsetPolygon(local, outset) : local;
        geometry = new THREE.ExtrudeGeometry(polygonShape(ring), { depth, bevelEnabled: false, curveSegments: 1 });
        geometry.rotateX(-Math.PI / 2);
        slabGeometries.set(key, geometry);
      }
      const mesh = new THREE.Mesh(geometry, material);
      mesh.position.set(seat.x, y, seat.z);
      if (grow < 1) mesh.scale.set(grow, 1, grow);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      group.add(mesh);
      return mesh;
    };
    // A part's own axes: a child group centred on its tightest bounding
    // rectangle and turned so local +Z faces `facing`. Details built in it line
    // up with walls that are not square to the map.
    const frame = (osmId: number, facing: [number, number]) => {
      const points = partOutlines.get(osmId);
      const part = partBounds.get(osmId);
      if (!points || !part) return null;
      let best: { area: number; cos: number; sin: number; minU: number; maxU: number; minV: number; maxV: number } | null = null;
      for (let index = 0; index < points.length; index++) {
        const [ax, az] = points[index];
        const [bx, bz] = points[(index + 1) % points.length];
        const length = Math.hypot(bx - ax, bz - az);
        if (length < 0.5) continue;
        const cos = (bx - ax) / length;
        const sin = (bz - az) / length;
        let minU = Infinity, maxU = -Infinity, minV = Infinity, maxV = -Infinity;
        for (const [x, z] of points) {
          const u = x * cos + z * sin;
          const v = -x * sin + z * cos;
          minU = Math.min(minU, u); maxU = Math.max(maxU, u);
          minV = Math.min(minV, v); maxV = Math.max(maxV, v);
        }
        const area = (maxU - minU) * (maxV - minV);
        if (!best || area < best.area) best = { area, cos, sin, minU, maxU, minV, maxV };
      }
      if (!best) return null;
      const centreU = (best.minU + best.maxU) / 2;
      const centreV = (best.minV + best.maxV) / 2;
      const axes = [
        { x: best.cos, z: best.sin, half: (best.maxU - best.minU) / 2, across: (best.maxV - best.minV) / 2 },
        { x: -best.cos, z: -best.sin, half: (best.maxU - best.minU) / 2, across: (best.maxV - best.minV) / 2 },
        { x: -best.sin, z: best.cos, half: (best.maxV - best.minV) / 2, across: (best.maxU - best.minU) / 2 },
        { x: best.sin, z: -best.cos, half: (best.maxV - best.minV) / 2, across: (best.maxU - best.minU) / 2 },
      ];
      const front = axes.reduce((a, b) => (b.x * facing[0] + b.z * facing[1] > a.x * facing[0] + a.z * facing[1] ? b : a));
      const local = new THREE.Group();
      local.position.set(
        centreU * best.cos - centreV * best.sin - group.position.x,
        0,
        centreU * best.sin + centreV * best.cos - group.position.z,
      );
      local.rotation.y = Math.atan2(front.x, front.z);
      group.add(local);
      return { g: local, hx: front.across, hz: front.half, height: part.height };
    };
    // Floor-by-floor dressing for a plain tower extrusion: a band to every
    // storey, a parapet, a roof finish, and plant on top.
    const dressTower = (osmId: number, options: { floor: number; band: THREE.Material; bandHeight: number; crown: THREE.Material; start?: number; grow?: number }) => {
      const seat = anchor(osmId);
      if (!seat) return null;
      for (let y = options.start ?? 5; y < seat.height - 1.5; y += options.floor) slab(osmId, y, options.bandHeight, options.grow ?? 1.006, options.band);
      slab(osmId, seat.height, 1.4, 1.012, options.crown);
      slab(osmId, seat.height + 1.4, 0.08, 0.93, roofGrey);
      const core = Math.min(seat.width, seat.depth);
      addBox(group, [core * 0.42, 3.6, core * 0.34], [seat.x - core * 0.08, seat.height + 3.2, seat.z + core * 0.06], plantGrey);
      addBox(group, [core * 0.2, 2.2, core * 0.2], [seat.x + core * 0.22, seat.height + 2.5, seat.z - core * 0.16], roofGrey);
      addCylinder(group, core * 0.07, core * 0.08, 2.4, [seat.x + core * 0.2, seat.height + 2.6, seat.z + core * 0.24], plantGrey, 10);
      return seat;
    };
    return {
      group,
      anchor,
      outline,
      walls,
      slab,
      frame,
      dressTower,
      width: Math.max(8, bounds.maxX - bounds.minX),
      depth: Math.max(8, bounds.maxZ - bounds.minZ),
      top: bounds.top > 0 ? bounds.top : landmark.altitude,
    };
  };

  for (const landmark of DHAKA_LANDMARKS) {
    const { group, anchor, walls, slab, frame, dressTower, width, depth, top } = detailGroup(landmark);
    // Tall features that rise above the footprint's own height get their own
    // collision column instead of lifting the whole building's.
    const solid = (x: number, z: number, half: number, solidTop: number) => {
      colliders.push({ x: group.position.x + x, z: group.position.z + z, halfWidth: half, halfDepth: half, top: solidTop });
    };
    let colliderTop = top;

    if (landmark.kind === "church") {
      const NAVE = 717625483;
      const nave = anchor(NAVE);
      if (nave) {
        const lancet = pointedArch(1.7, 5.2);
        addBays(group, walls(NAVE), {
          bay: 5.2, minEdge: 5, storeys: [{ y: 3.2, opening: lancet, surround: pointedArch(2.3, 5.9) }],
          opening: archDark, surround: paleConcrete,
          pier: { width: 0.8, depth: 0.7, bottom: 0, top: nave.height, material: paleConcrete },
        });
        slab(NAVE, 0, 1.2, 1.012, paleConcrete);
        slab(NAVE, nave.height - 0.4, 0.9, 1.02, paleConcrete);
        slab(NAVE, nave.height + 0.5, 0.08, 0.95, tileRoof);
      }
      for (const osmId of [983631141, 983631142]) {
        const upper = anchor(osmId);
        if (!upper) continue;
        addBays(group, walls(osmId), { bay: 4.4, minEdge: 4, storeys: [{ y: 14.4, opening: pointedArch(1.3, 3.4) }], opening: archDark });
        slab(osmId, upper.height - 0.3, 0.7, 1.03, paleConcrete);
        addCone(group, Math.min(upper.width, upper.depth) * 0.5, 6.5, [upper.x, upper.height + 3.6, upper.z], tileRoof, 8);
      }
      const tower = anchor(983631140);
      if (tower) {
        const radius = Math.min(tower.width, tower.depth) * 0.5;
        slab(983631140, 12, 0.6, 1.05, paleConcrete);
        slab(983631140, tower.height - 0.4, 0.9, 1.08, paleConcrete);
        addBays(group, walls(983631140), { bay: 3.6, minEdge: 1.4, margin: 0.2, storeys: [{ y: 14.5, opening: pointedArch(1, 4.2) }], opening: archDark });
        addCone(group, radius * 1.02, 15, [tower.x, tower.height + 8, tower.z], tileRoof, 8);
        addBox(group, [0.5, 5.4, 0.5], [tower.x, tower.height + 17.6, tower.z], accent);
        addBox(group, [3, 0.5, 0.5], [tower.x, tower.height + 18.6, tower.z], accent);
        solid(tower.x, tower.z, radius, tower.height + 14);
      }
    } else if (landmark.kind === "bashundhara-city") {
      // Three volumes the OSM outline already separates: the silver-panelled
      // mall podium, the round glass atrium with its ribbed dome, and the
      // office tower with a curved curtain-wall bay.
      const MALL = 24448713;
      const ROTUNDA = 1092674471;
      const TOWER = 1092674472;
      const FLOOR = 3.7;
      const mall = anchor(MALL);
      if (mall) {
        // Glazed shopfront under a canopy, then a ribbon window to every floor.
        slab(MALL, 0, 4.4, 1.004, ribbonGlass);
        slab(MALL, 4.4, 0.6, 1.022, paleConcrete);
        for (let y = 7; y < mall.height - 2; y += FLOOR) slab(MALL, y, 1.5, 1.003, ribbonGlass);
        slab(MALL, mall.height, 1.3, 1.006, silverPanel);
        slab(MALL, mall.height + 1.3, 0.08, 0.965, roofGrey);
        const deck = frame(MALL, [0, 1]);
        if (deck) {
          const roofY = mall.height + 1.38;
          // Rooftop plant, lift overruns and skylights: the roof is the face a
          // bird sees most, so it should not be a blank slab.
          const plant: Array<[number, number, number, number, number]> = [
            [-0.42, -0.5, 16, 5, 11], [-0.1, -0.56, 11, 3.6, 8], [0.36, -0.44, 13, 6, 13],
            [-0.5, 0.1, 9, 4, 20], [0.44, 0.3, 12, 4.5, 16], [-0.3, 0.52, 18, 3.4, 9],
          ];
          for (const [fx, fz, w, h, d] of plant) {
            addBox(deck.g, [w, h, d], [fx * deck.hx, roofY + h / 2, fz * deck.hz], plantGrey);
            addBox(deck.g, [w * 0.86, 0.5, d * 0.86], [fx * deck.hx, roofY + h + 0.25, fz * deck.hz], roofGrey);
          }
          for (const [fx, fz] of [[0.02, 0.1], [0.02, 0.34], [-0.2, 0.22]] as const) {
            addBox(deck.g, [15, 1.6, 7], [fx * deck.hx, roofY + 0.8, fz * deck.hz], atriumGlass);
          }
          for (const [fx, fz] of [[0.26, -0.08], [0.34, -0.08], [0.26, 0.04], [0.34, 0.04]] as const) {
            addCylinder(deck.g, 2.1, 2.4, 3.2, [fx * deck.hx, roofY + 1.6, fz * deck.hz], plantGrey, 12);
          }
        }
      }
      const rotunda = anchor(ROTUNDA);
      if (rotunda) {
        const radius = Math.min(rotunda.width, rotunda.depth) / 2;
        for (let y = 4.4; y < rotunda.height; y += FLOOR) slab(ROTUNDA, y, 0.5, 1.012, silverPanel);
        slab(ROTUNDA, rotunda.height, 1.2, 1.03, silverPanel);
        const rise = radius * 0.62;
        const domeY = rotunda.height + 1.2;
        const profile: Array<[number, number]> = [];
        for (let step = 0; step <= 8; step++) {
          const angle = (step / 8) * Math.PI / 2;
          profile.push([Math.max(0.001, radius * 0.97 * Math.cos(angle)), rise * Math.sin(angle)]);
        }
        addLathe(group, profile, 24, [rotunda.x, domeY, rotunda.z], atriumGlass);
        // Radial glazing ribs and two ring purlins over the glass.
        const ribGeometry = new THREE.TorusGeometry(radius * 0.975, 0.2, 4, 10, Math.PI / 2);
        for (let rib = 0; rib < 16; rib++) {
          const mesh = new THREE.Mesh(ribGeometry, silverPanel);
          mesh.scale.y = rise / radius;
          mesh.rotation.y = (rib / 16) * Math.PI * 2;
          mesh.position.set(rotunda.x, domeY, rotunda.z);
          group.add(mesh);
        }
        for (const t of [0.34, 0.68]) {
          const angle = t * Math.PI / 2;
          const ring = new THREE.Mesh(new THREE.TorusGeometry(radius * 0.975 * Math.cos(angle), 0.18, 4, 32), silverPanel);
          ring.rotation.x = Math.PI / 2;
          ring.position.set(rotunda.x, domeY + rise * Math.sin(angle), rotunda.z);
          group.add(ring);
        }
        addCylinder(group, 1.5, 1.9, 0.9, [rotunda.x, domeY + rise + 0.2, rotunda.z], accent, 12);
        solid(rotunda.x, rotunda.z, radius, domeY + rise);
      }
      const tower = anchor(TOWER);
      if (tower && mall) {
        const base = mall.height;
        for (let y = base + 2.4; y < tower.height - 2; y += FLOOR) slab(TOWER, y, 1.6, 1.004, ribbonGlass);
        slab(TOWER, tower.height, 1.4, 1.01, silverPanel);
        slab(TOWER, tower.height + 1.4, 0.08, 0.93, roofGrey);
        // Face the curved bay away from the mall, toward the street.
        const shaft = frame(TOWER, [tower.x - mall.x, tower.z - mall.z]);
        if (shaft) {
          const bayRadius = shaft.hx * 0.6;
          const bayHeight = tower.height - base + 3;
          const bay = new THREE.Mesh(
            new THREE.CylinderGeometry(bayRadius, bayRadius, bayHeight, 28, 1, false, -Math.PI / 2, Math.PI),
            atriumGlass,
          );
          bay.position.set(0, base + bayHeight / 2, shaft.hz - bayRadius * 0.45);
          bay.castShadow = true;
          shaft.g.add(bay);
          for (let y = base + FLOOR; y < base + bayHeight; y += FLOOR) {
            const mullion = new THREE.Mesh(new THREE.TorusGeometry(bayRadius + 0.05, 0.12, 4, 20, Math.PI), silverPanel);
            mullion.rotation.x = Math.PI / 2;
            mullion.rotation.z = Math.PI;
            mullion.position.set(0, y, shaft.hz - bayRadius * 0.45);
            shaft.g.add(mullion);
          }
          addCylinder(shaft.g, bayRadius + 0.5, bayRadius + 0.5, 0.7, [0, base + bayHeight + 0.35, shaft.hz - bayRadius * 0.45], silverPanel, 28);
          // Recessed service slots down the two end walls.
          for (const side of [-1, 1]) {
            addBox(shaft.g, [0.5, tower.height - base - 8, shaft.hz * 0.5], [side * (shaft.hx + 0.1), base + (tower.height - base) / 2, -shaft.hz * 0.2], ribbonGlass);
          }
          addBox(shaft.g, [shaft.hx * 1.1, 4.5, shaft.hz * 1.0], [0, tower.height + 3, -shaft.hz * 0.1], plantGrey);
          addBox(shaft.g, [shaft.hx * 0.5, 2.6, shaft.hz * 0.6], [-shaft.hx * 0.2, tower.height + 6.5, -shaft.hz * 0.1], roofGrey);
          addCylinder(shaft.g, 0.35, 0.5, 13, [shaft.hx * 0.3, tower.height + 11.5, -shaft.hz * 0.1], accent, 8);
        }
        solid(tower.x, tower.z, Math.max(tower.width, tower.depth) / 2, tower.height + 6);
        colliderTop = mall.height + 2;
      }
    } else if (landmark.kind === "amphitheatre") {
      // A stepped half-bowl of seating round a lakeside stage. Each tier is a
      // half-drum a little taller and wider than the one inside it.
      const bowl = anchor(1065574904);
      const reach = (bowl ? Math.min(bowl.width, bowl.depth) : Math.min(width, depth)) * 0.4;
      const TIERS = 9;
      for (let tier = 0; tier < TIERS; tier++) {
        const radius = reach * (0.42 + (tier / (TIERS - 1)) * 0.58);
        const height = 0.9 + tier * 0.95;
        const seating = new THREE.Mesh(
          new THREE.CylinderGeometry(radius, radius, height, 48, 1, false, Math.PI / 2, Math.PI),
          tier % 2 ? lawn : paleConcrete,
        );
        seating.position.set(0, 1.2 + height / 2, -reach * 0.1);
        seating.castShadow = true;
        seating.receiveShadow = true;
        group.add(seating);
      }
      // Aisles cut through the tiers, the stage, and its shell canopy.
      for (const angle of [-0.9, -0.3, 0.3, 0.9]) {
        const aisle = addBox(group, [1.6, 0.2, reach * 0.56], [Math.sin(angle) * reach * 0.72, 1.2 + (TIERS - 1) * 0.95 + 1, -reach * 0.1 - Math.cos(angle) * reach * 0.72], whiteStone);
        aisle.rotation.y = angle;
        aisle.rotation.x = -0.18;
      }
      addCylinder(group, reach * 0.4, reach * 0.42, 1.4, [0, 1.9, -reach * 0.1], whiteStone, 40);
      addBox(group, [reach * 0.9, 1.6, reach * 0.3], [0, 2, reach * 0.12], whiteStone);
      const canopy = new THREE.Mesh(new THREE.SphereGeometry(reach * 0.36, 28, 10, 0, Math.PI, 0, Math.PI / 2), marble);
      canopy.scale.set(1.3, 0.62, 0.8);
      canopy.position.set(0, 2.8, reach * 0.2);
      canopy.castShadow = true;
      group.add(canopy);
      addBox(group, [reach * 1.1, 0.5, 1.2], [0, 3, reach * 0.2], accent);
    } else if (landmark.kind === "police-plaza") {
      // Blue curtain-wall tower on a shopping podium.
      const TOWER = 366560370;
      const mass = dressTower(TOWER, { floor: 3.8, band: silverPanel, bandHeight: 0.5, crown: silverPanel, start: 12 });
      if (mass) {
        slab(TOWER, 0, 9, 1.035, paleConcrete);
        slab(TOWER, 9, 0.8, 1.06, silverPanel);
        slab(TOWER, 2, 5, 1.04, ribbonGlass);
        for (const edge of walls(TOWER)) {
          if (edge.length < 12) continue;
          for (let along = 4; along < edge.length - 2; along += 8) {
            const fin = addBox(group, [0.5, mass.height - 11, 0.9], [edge.ax + edge.dx * along + edge.nx * 0.4, 10 + (mass.height - 11) / 2, edge.az + edge.dz * along + edge.nz * 0.4], silverPanel);
            fin.rotation.y = edge.rotationY;
          }
        }
      }
    } else if (landmark.kind === "brac") {
      // Brick-red office tower with deep ribbon windows.
      const TOWER = 229029081;
      const mass = dressTower(TOWER, { floor: 3.6, band: ribbonGlass, bandHeight: 1.7, crown: brickTrim, start: 6.5, grow: 1.004 });
      if (mass) {
        slab(TOWER, 0, 4.6, 1.02, ribbonGlass);
        slab(TOWER, 4.6, 0.7, 1.05, paleConcrete);
        const shaft = frame(TOWER, [1, 0]);
        if (shaft) {
          // Glazed lift core standing proud of the brick on the entrance face.
          addBox(shaft.g, [shaft.hx * 0.34, mass.height + 4, 1.6], [0, (mass.height + 4) / 2, shaft.hz + 0.6], darkGlass);
          for (const side of [-1, 1]) addBox(shaft.g, [0.7, mass.height + 4.6, 2], [side * shaft.hx * 0.19, (mass.height + 4.6) / 2, shaft.hz + 0.6], paleConcrete);
        }
      }
    } else if (landmark.kind === "hotel") {
      // Slim dark-glass hotel tower with a lit crown.
      const TOWER = 498432169;
      const mass = dressTower(TOWER, { floor: 3.5, band: silverPanel, bandHeight: 0.4, crown: silverPanel, start: 14 });
      if (mass) {
        slab(TOWER, 0, 10, 1.05, paleConcrete);
        slab(TOWER, 2, 6, 1.056, ribbonGlass);
        slab(TOWER, 10, 0.8, 1.1, silverPanel);
        slab(TOWER, mass.height - 7, 5, 1.012, atriumGlass);
        addCylinder(group, 0.3, 0.45, 12, [mass.x, mass.height + 9, mass.z], accent, 8);
      }
    } else if (landmark.kind === "parliament") {
      // Kahn's citadel is three concentric rings the OSM outlines already carry:
      // a 34 m ring of office blocks, a 42 m star of light wells, and the 46 m
      // octagonal assembly chamber. What makes it read from the air is the
      // finish: marble pour lines on grey concrete, giant geometric openings in
      // the outer walls, terracotta roof terraces, and the two plazas it stands
      // between: red brick to the south, white marble to the north.
      const CITADEL = 24448328;
      const STAR = 443036732;
      const CHAMBER = 443037035;
      const citadel = anchor(CITADEL);
      const chamber = anchor(CHAMBER);

      // Marble inlay at every pour line.
      for (const [osmId, wallTop] of [[CITADEL, 34], [STAR, 42], [CHAMBER, 46]] as const) {
        for (let y = 3.2; y < wallTop - 1; y += 3.2) slab(osmId, y, 0.26, 1.003, marble);
      }
      // Terracotta terraces inside a concrete parapet.
      slab(CITADEL, 34, 1.2, 1.004, concrete);
      slab(CITADEL, 35.2, 0.08, 0.962, terracotta);
      slab(STAR, 42, 1.0, 1.004, concrete);
      slab(STAR, 43, 0.08, 0.95, terracotta);
      slab(CHAMBER, 46, 1.0, 1.004, concrete);
      slab(CHAMBER, 47, 0.08, 0.94, terracotta);

      // The giant openings. One to each flat wall of the outer blocks, sized to
      // the wall: circles on the long entrance and lounge faces, and circles
      // alternating with triangles round the diamond-set office blocks.
      const circleLarge = discPane(8.6);
      const circleLargeTrim = discPane(9.6);
      const circleSmall = discPane(5.6);
      const circleSmallTrim = discPane(6.3);
      const triangle = trianglePane(11.5, 15);
      const triangleTrim = trianglePane(13.3, 16.6);
      const slot = rectPane(2.2, 9);
      walls(CITADEL).forEach((edge, index) => {
        const middle = edge.length / 2;
        if (edge.length >= 26) {
          addOnWall(group, edge, middle, 6.4, circleLargeTrim, marble, 0.16);
          addOnWall(group, edge, middle, 7.4, circleLarge, recess, 0.28);
        } else if (edge.length >= 15.5) {
          if (index % 2 === 0) {
            addOnWall(group, edge, middle, 9.3, circleSmallTrim, marble, 0.16);
            addOnWall(group, edge, middle, 10, circleSmall, recess, 0.28);
            addOnWall(group, edge, middle, 23.5, slot, recess, 0.28);
          } else {
            addOnWall(group, edge, middle, 7.2, triangleTrim, marble, 0.16);
            addOnWall(group, edge, middle, 8, triangle, recess, 0.28);
          }
        } else if (edge.length >= 11) {
          addOnWall(group, edge, middle, 6, rectPane(2.4, 22), recess, 0.28);
        }
      });
      // Tall light slits between the folds of the star.
      const slit = rectPane(1.5, 30);
      for (const edge of walls(STAR)) {
        if (edge.length >= 9) addOnWall(group, edge, edge.length / 2, 8, slit, recess, 0.28);
      }

      if (chamber) {
        const radius = Math.min(chamber.width, chamber.depth) * 0.5;
        // The chamber roof barely breaks the skyline: a low clerestory ring and
        // the white folded umbrella that lights the hall below.
        addCylinder(group, radius * 0.6, radius * 0.62, 2.6, [chamber.x, 47 + 1.3, chamber.z], concrete, 8);
        addLathe(group, [[radius * 0.6, 0], [radius * 0.34, 2.3], [radius * 0.1, 3.3], [0.001, 3.5]], 16, [chamber.x, 49.6, chamber.z], marble, true);
        for (let slotIndex = 0; slotIndex < 8; slotIndex++) {
          const angle = (slotIndex / 8) * Math.PI * 2 + Math.PI / 8;
          const court = addBox(group, [5.4, 0.3, 2.6], [chamber.x + Math.cos(angle) * radius * 0.8, 47.1, chamber.z + Math.sin(angle) * radius * 0.8], recess);
          court.rotation.y = -angle + Math.PI / 2;
        }
      }

      if (citadel) {
        const southEdge = citadel.z + citadel.depth / 2;
        const northEdge = citadel.z - citadel.depth / 2;
        // South Plaza: two brick tiers across the lake, reached by a brick causeway.
        const plazaZ = southEdge + 26 + 50;
        addBox(group, [232, 1.2, 108], [citadel.x, 0.6, plazaZ], plazaBrick);
        addBox(group, [220, 1, 98], [citadel.x, 1.7, plazaZ - 1], terracotta);
        addBox(group, [20, 2.4, 40], [citadel.x, 1.2, southEdge + 14], plazaBrick);
        for (const offset of [-73, 0, 73]) addBox(group, [0.6, 0.12, 98], [citadel.x + offset, 2.26, plazaZ - 1], marble);
        for (const offset of [-16, 16]) addBox(group, [220, 0.12, 0.6], [citadel.x, 2.3, plazaZ - 1 + offset], marble);
        for (const side of [-1, 1]) addBox(group, [3.4, 3, 98], [citadel.x + side * 112, 1.5, plazaZ - 1], plazaBrick);
        // Presidential Plaza: white marble steps on the north side.
        addBox(group, [118, 1.2, 64], [citadel.x, 0.6, northEdge - 24], marble);
        addBox(group, [96, 1.1, 46], [citadel.x, 1.75, northEdge - 18], whiteStone);
        addBox(group, [60, 0.2, 26], [citadel.x, 2.4, northEdge - 20], lawn);
      }
    } else if (landmark.kind === "lalbagh-fort") {
      // An unfinished Mughal fort: a walled garden holding the Diwan-i-Aam, the
      // tomb of Pari Bibi and the three-domed mosque on one east-west axis.
      const GROUNDS = 624024881;
      const TOMB = 624024857;
      const MOSQUE = 624024874;
      const HALL = 624024864;
      const GATE = 624024884;
      // Curtain wall along the real boundary, with a bastion at every corner.
      const boundary = walls(GROUNDS);
      boundary.forEach((edge, index) => {
        const cornerLift = (index & 1) * 0.04;
        const wall = addBox(group, [edge.length + 1.2, 5.2, 1.7], [edge.ax + edge.dx * edge.length / 2, 3 + cornerLift, edge.az + edge.dz * edge.length / 2], redBrick);
        wall.rotation.y = edge.rotationY;
        const coping = addBox(group, [edge.length + 1.2, 0.5, 2.2], [edge.ax + edge.dx * edge.length / 2, 5.8 + cornerLift, edge.az + edge.dz * edge.length / 2], brickTrim);
        coping.rotation.y = edge.rotationY;
        const next = boundary[(index + 1) % boundary.length];
        const turn = Math.abs(edge.dx * next.dz - edge.dz * next.dx);
        if (turn > 0.5 && edge.length > 14 && next.length > 14) {
          addCylinder(group, 3.6, 4.2, 7.4, [next.ax, 4.1, next.az], redBrick, 8);
          addCylinder(group, 4.1, 4.1, 0.5, [next.ax, 8, next.az], brickTrim, 8);
          addLathe(group, domeProfile(3.2, 2.8, 0.1, 7), 12, [next.ax, 8.2, next.az], whiteStone);
        }
      });
      const mughalArch = pointedArch(2.6, 5.2);
      const mughalArchTrim = pointedArch(3.5, 6.2);
      const tomb = anchor(TOMB);
      if (tomb) {
        // Pari Bibi's tomb: a square of peach-washed stone, three arched
        // doors to each face, a bronze dome on an octagonal drum, four turrets.
        addBays(group, walls(TOMB), {
          bay: 6.4, minEdge: 6, storeys: [{ y: 2.2, opening: mughalArch, surround: mughalArchTrim }],
          opening: archDark, surround: cream,
          pier: { width: 0.9, depth: 0.6, bottom: 0, top: tomb.height, material: cream },
        });
        slab(TOMB, 0, 1.6, 1.07, cream);
        slab(TOMB, tomb.height - 0.6, 1, 1.03, cream);
        slab(TOMB, tomb.height + 0.4, 1, 1.004, peach);
        const half = Math.min(tomb.width, tomb.depth) / 2;
        const domeRadius = half * 0.56;
        addCylinder(group, domeRadius * 1.05, domeRadius * 1.12, 3.4, [tomb.x, tomb.height + 3.1, tomb.z], peach, 8);
        addCylinder(group, domeRadius * 1.14, domeRadius * 1.14, 0.5, [tomb.x, tomb.height + 5, tomb.z], cream, 8);
        addLathe(group, domeProfile(domeRadius, domeRadius * 1.3, 0.12, 14), 28, [tomb.x, tomb.height + 5.2, tomb.z], bronze);
        addFinial(group, [tomb.x, tomb.height + 5.2 + domeRadius * 1.3, tomb.z], 0.9);
        for (const sideX of [-1, 1]) {
          for (const sideZ of [-1, 1]) {
            const tx = tomb.x + sideX * (tomb.width / 2 - 0.4);
            const tz = tomb.z + sideZ * (tomb.depth / 2 - 0.4);
            addCylinder(group, 1.3, 1.5, tomb.height + 2.4, [tx, (tomb.height + 2.4) / 2, tz], peach, 8);
            addChhatri(group, [tx, tomb.height + 2.4, tz], 3, peach, bronze);
          }
        }
        solid(tomb.x, tomb.z, domeRadius * 1.2, tomb.height + 5.2 + domeRadius * 1.3);
      }
      const mosque = anchor(MOSQUE);
      if (mosque) {
        const hall = frame(MOSQUE, [1, 0]);
        addBays(group, walls(MOSQUE), {
          bay: 5.6, minEdge: 7, storeys: [{ y: 1.6, opening: pointedArch(2.4, 5.6), surround: pointedArch(3.3, 6.6) }],
          opening: archDark, surround: brickTrim,
        });
        slab(MOSQUE, mosque.height - 0.5, 0.8, 1.05, brickTrim);
        slab(MOSQUE, mosque.height + 0.3, 0.9, 1.01, redBrick);
        if (hall) {
          for (const step of [-1, 0, 1]) {
            const radius = step === 0 ? 2.9 : 2.3;
            const x = step * hall.hx * 0.62;
            addCylinder(hall.g, radius * 1.05, radius * 1.1, 1.6, [x, mosque.height + 2, 0], redBrick, 8);
            addLathe(hall.g, domeProfile(radius, radius * 1.45, 0.16, 12), 16, [x, mosque.height + 2.8, 0], whiteStone, true);
            addFinial(hall.g, [x, mosque.height + 2.8 + radius * 1.45, 0], 0.6);
          }
          for (const sideX of [-1, 1]) {
            for (const sideZ of [-1, 1]) {
              addCylinder(hall.g, 0.9, 1.1, mosque.height + 3.4, [sideX * hall.hx, (mosque.height + 3.4) / 2, sideZ * hall.hz], redBrick, 8);
              addLathe(hall.g, domeProfile(1.1, 1.7, 0.2, 6), 8, [sideX * hall.hx, mosque.height + 3.4, sideZ * hall.hz], whiteStone);
            }
          }
        }
      }
      const audience = anchor(HALL);
      if (audience) {
        // Diwan-i-Aam: two arcaded storeys under a flat terrace.
        addBays(group, walls(HALL), {
          bay: 4.6, minEdge: 4.2,
          storeys: [
            { y: 1.2, opening: pointedArch(2.2, 3.9), surround: pointedArch(3, 4.7) },
            { y: 6.9, opening: pointedArch(2.2, 3.6), surround: pointedArch(3, 4.4) },
          ],
          opening: archDark, surround: cream,
          pier: { width: 0.7, depth: 0.5, bottom: 0, top: audience.height, material: cream },
        });
        slab(HALL, 5.7, 0.6, 1.03, cream);
        slab(HALL, audience.height - 0.4, 0.8, 1.05, cream);
        slab(HALL, audience.height + 0.4, 0.9, 1.006, peach);
        slab(HALL, audience.height + 1.3, 0.08, 0.92, terracotta);
      }
      const gate = anchor(GATE);
      if (gate) {
        const gateway = frame(GATE, [0, 1]);
        slab(GATE, gate.height, 0.7, 1.01, brickTrim);
        if (gateway) {
          // The south gate: a tall arched pavilion between two slender minarets.
          const { g, hz } = gateway;
          addBox(g, [17, 17, hz * 2 + 5], [0, 8.5, 0], redBrick);
          addBox(g, [18, 0.7, hz * 2 + 6], [0, 17, 0], brickTrim);
          for (const side of [-1, 1]) {
            const arch = new THREE.Mesh(pointedArch(6.4, 11.5), archDark);
            arch.position.set(0, 0.6, side * (hz + 2.74));
            if (side < 0) arch.rotation.y = Math.PI;
            g.add(arch);
            const trim = new THREE.Mesh(pointedArch(8, 13), cream);
            trim.position.set(0, 0.3, side * (hz + 2.62));
            if (side < 0) trim.rotation.y = Math.PI;
            g.add(trim);
          }
          for (const sideX of [-1, 1]) {
            addCylinder(g, 1.4, 1.7, 20, [sideX * 9.6, 10, 0], redBrick, 8);
            addChhatri(g, [sideX * 9.6, 20, 0], 3.2, redBrick, whiteStone);
          }
          addChhatri(g, [-4.5, 17.4, 0], 3.4, redBrick, whiteStone);
          addChhatri(g, [4.5, 17.4, 0], 3.4, redBrick, whiteStone);
        }
      }
      // The garden axis that ties the three monuments together.
      const axis = [audience, tomb, mosque].filter((stop): stop is NonNullable<typeof stop> => Boolean(stop));
      for (let index = 0; index + 1 < axis.length; index++) {
        const from = axis[index];
        const to = axis[index + 1];
        const length = Math.hypot(to.x - from.x, to.z - from.z);
        const path = addBox(group, [length, 0.2, 5], [(from.x + to.x) / 2, 0.66 + index * 0.02, (from.z + to.z) / 2], paleConcrete);
        path.rotation.y = Math.atan2(-(to.z - from.z), to.x - from.x);
        const channel = addBox(group, [length * 0.6, 0.22, 1.4], [(from.x + to.x) / 2, 0.78 + index * 0.02, (from.z + to.z) / 2], water);
        channel.rotation.y = path.rotation.y;
      }
    } else if (landmark.kind === "ahsan-manzil") {
      // The Pink Palace: two arcaded storeys on a plinth, corner pavilions, the
      // grand river stair up to the first floor, and the domed tower over it.
      const PALACE = 624025793;
      const ANDARMAHAL = 624025792;
      const archLow = roundArch(2.3, 3.5);
      const archLowTrim = roundArch(3, 4.1);
      const archHigh = roundArch(2.3, 4.3);
      const archHighTrim = roundArch(3, 4.9);
      const dress = (osmId: number, height: number, storeys: BayStorey[]) => {
        addBays(group, walls(osmId), {
          bay: 4.3,
          minEdge: 3.6,
          storeys,
          opening: archDark,
          surround: salmonTrim,
          pier: { width: 0.7, depth: 0.5, bottom: 0, top: height, material: salmonTrim },
        });
        slab(osmId, 0, 1.1, 1.014, salmonTrim);
        slab(osmId, height * 0.46, 0.55, 1.014, salmonTrim);
        slab(osmId, height - 0.5, 0.7, 1.024, salmonTrim);
        slab(osmId, height, 1.2, 1.004, salmon);
        slab(osmId, height + 1.2, 0.22, 1.016, salmonTrim);
        slab(osmId, height + 1.42, 0.18, 0.95, roofTerrace);
      };
      const palace = anchor(PALACE);
      if (palace) {
        const H = palace.height;
        dress(PALACE, H, [
          { y: 1.7, opening: archLow, surround: archLowTrim },
          { y: H * 0.46 + 1.2, opening: archHigh, surround: archHighTrim },
        ]);
        const body = frame(PALACE, [0, 1]);
        if (body) {
          const { g, hx, hz } = body;
          // Corner pavilions rise an attic above the roof line, each crowned with a
          // shaped gable and four bud finials.
          for (const sideX of [-1, 1]) {
            for (const sideZ of [-1, 1]) {
              const px = sideX * (hx - 4.2);
              const pz = sideZ * (hz - 4.4);
              addBox(g, [8.6, 2.4, 8.6], [px, H + 1.2 + 1.2, pz], salmon);
              addBox(g, [9.2, 0.4, 9.2], [px, H + 3.8, pz], salmonTrim);
              addCone(g, 4.6, 1.6, [px, H + 4.8, pz], roofTerrace, 4).rotation.y = Math.PI / 4;
              for (const cx of [-1, 1]) {
                for (const cz of [-1, 1]) {
                  addCylinder(g, 0.5, 0.6, 2.2, [px + cx * 4, H + 5.1, pz + cz * 4], salmon, 8);
                  addLathe(g, domeProfile(0.75, 1.3, 0.2, 6), 8, [px + cx * 4, H + 6.2, pz + cz * 4], salmonTrim);
                }
              }
            }
          }
          // Central tower over the entrance: a square stage, an octagonal drum,
          // then the dome. It stands toward the river front, as built.
          const tz = hz - 7.5;
          const towerBase = H + 1.2;
          addBox(g, [11, 7.4, 11], [0, towerBase + 3.7, tz], salmon);
          addBox(g, [12.2, 0.6, 12.2], [0, towerBase + 7.4, tz], salmonTrim);
          addBox(g, [11.6, 0.4, 11.6], [0, towerBase + 2.2, tz], salmonTrim);
          const towerArch = roundArch(1.7, 3.6);
          const towerArchTrim = roundArch(2.3, 4.1);
          for (let face = 0; face < 4; face++) {
            const angle = (face / 4) * Math.PI * 2;
            for (const offset of [-3, 0, 3]) {
              for (const [geometry, material, proud, lift] of [[towerArchTrim, salmonTrim, 5.64, -0.2], [towerArch, archDark, 5.76, 0]] as const) {
                const pane = new THREE.Mesh(geometry, material);
                pane.position.set(Math.sin(angle) * proud + Math.cos(angle) * offset, towerBase + 2.9 + lift, tz + Math.cos(angle) * proud - Math.sin(angle) * offset);
                pane.rotation.y = angle;
                g.add(pane);
              }
            }
          }
          for (const cx of [-1, 1]) {
            for (const cz of [-1, 1]) {
              addCylinder(g, 0.8, 0.9, 9.6, [cx * 5.6, towerBase + 4.8, tz + cz * 5.6], salmonTrim, 8);
              addLathe(g, domeProfile(1.15, 1.9, 0.22, 6), 8, [cx * 5.6, towerBase + 9.6, tz + cz * 5.6], salmon);
              addFinial(g, [cx * 5.6, towerBase + 11.4, tz + cz * 5.6], 0.5);
            }
          }
          addCylinder(g, 5, 5.3, 2.6, [0, towerBase + 8.9, tz], salmon, 8).rotation.y = Math.PI / 8;
          addCylinder(g, 5.5, 5.5, 0.5, [0, towerBase + 10.4, tz], salmonTrim, 8).rotation.y = Math.PI / 8;
          addLathe(g, domeProfile(5, 7.2, 0.07, 14), 24, [0, towerBase + 10.6, tz], salmon);
          addFinial(g, [0, towerBase + 17.6, tz], 1.1);
          g.updateMatrix();
          const towerSeat = new THREE.Vector3(0, 0, tz).applyMatrix4(g.matrix);
          solid(towerSeat.x, towerSeat.z, 8, towerBase + 18);

          // Projecting entrance bay with a triple arch at the head of the stair.
          addBox(g, [13, H + 1.2, 3.2], [0, (H + 1.2) / 2, hz + 1.6], salmon);
          addBox(g, [13.8, 0.6, 3.8], [0, H * 0.46 + 0.2, hz + 1.7], salmonTrim);
          addBox(g, [13.8, 0.7, 3.8], [0, H - 0.2, hz + 1.7], salmonTrim);
          addBox(g, [13.6, 0.24, 3.6], [0, H + 1.3, hz + 1.7], salmonTrim);
          const doorArch = roundArch(2.6, 5);
          const doorArchTrim = roundArch(3.4, 5.6);
          for (const offset of [-4.1, 0, 4.1]) {
            for (const [geometry, material, proud, lift] of [[doorArchTrim, salmonTrim, 3.34, -0.2], [doorArch, archDark, 3.46, 0]] as const) {
              const pane = new THREE.Mesh(geometry, material);
              pane.position.set(offset, H * 0.46 + 1.1 + lift, hz + proud);
              g.add(pane);
            }
          }
          for (const offset of [-6.2, -2.05, 2.05, 6.2]) addBox(g, [0.8, H + 1.2, 0.5], [offset, (H + 1.2) / 2, hz + 3.35], salmonTrim);
          // The grand stair: a single broad flight from the lawn to the first floor.
          const landing = H * 0.46;
          const STEPS = 12;
          const run = 17;
          const stairStart = hz + 3.2;
          for (let step = 0; step < STEPS; step++) {
            const stepHeight = landing * (1 - step / STEPS);
            addBox(g, [12 + step * 0.34, stepHeight, run / STEPS + 0.05], [0, stepHeight / 2, stairStart + (step + 0.5) * (run / STEPS)], stoneStep);
          }
          for (const side of [-1, 1]) {
            const rail = addBox(g, [0.9, 1.5, Math.hypot(run, landing)], [side * 7.6, landing / 2 + 0.7, stairStart + run / 2], salmon);
            rail.rotation.x = Math.atan2(landing, run);
            addBox(g, [1.5, 2.6, 1.5], [side * 8.2, 1.3, stairStart + run + 0.4], salmonTrim);
          }
          // Forecourt walk down to the river gate.
          addBox(g, [7, 0.18, 46], [0, 0.64, stairStart + run + 23], paleConcrete);
          addBox(g, [58, 0.18, 4], [0, 0.68, stairStart + run + 3], paleConcrete);
        }
      }
      const andarmahal = anchor(ANDARMAHAL);
      if (andarmahal) {
        dress(ANDARMAHAL, andarmahal.height, [
          { y: 1.5, opening: roundArch(2, 2.9), surround: roundArch(2.6, 3.4) },
          { y: andarmahal.height * 0.46 + 1.1, opening: roundArch(2, 3.4), surround: roundArch(2.6, 3.9) },
        ]);
      }
      for (const osmId of [624025788, 624025789, 624025784]) {
        const wing = anchor(osmId);
        if (!wing) continue;
        slab(osmId, wing.height, 0.6, 1.02, salmonTrim);
        slab(osmId, wing.height + 0.6, 0.08, 0.93, roofTerrace);
      }
    } else if (landmark.kind === "shaheed-minar") {
      // The Language Martyrs' monument: a mother and her fallen sons as five
      // marble frames on a stepped plinth, her head bowed, the red sun behind.
      // Base tier clears the 0.5 m OSM ground footprint underneath it.
      addBox(group, [58, 0.72, 40], [0, 0.36, 5], paleConcrete);
      addBox(group, [50, 1.1, 30], [0, 1.16, 2], whiteStone);
      addBox(group, [44, 1, 22], [0, 2.1, 0], marble);
      for (let step = 0; step < 4; step++) addBox(group, [26 - step * 1.2, 0.5, 1.4], [0, 0.75 + step * 0.5, 17.6 - step * 1.4], whiteStone);
      const BASE = 2.6;
      const sun = addCylinder(group, 5.6, 5.6, 0.5, [0, BASE + 8.4, -4.4], monumentRed, 40);
      sun.rotation.x = Math.PI / 2;
      const addFrame = (x: number, z: number, frameWidth: number, height: number, bars: number, turn: number, bowed: boolean) => {
        const holder = new THREE.Group();
        holder.position.set(x, BASE, z);
        holder.rotation.y = turn;
        group.add(holder);
        const straight = bowed ? height * 0.68 : height;
        for (let bar = 0; bar < bars; bar++) {
          const barX = -frameWidth / 2 + (frameWidth * bar) / (bars - 1);
          addBox(holder, [0.55, straight, 0.55], [barX, straight / 2, 0], marble);
          if (bowed) {
            const lean = 0.5;
            const upper = height - straight;
            const bent = addBox(holder, [0.55, upper, 0.55], [barX, straight + Math.cos(lean) * upper / 2, Math.sin(lean) * upper / 2], marble);
            bent.rotation.x = lean;
          }
        }
        if (bowed) {
          const lean = 0.5;
          const upper = height - straight;
          addBox(holder, [frameWidth + 0.55, 0.6, 0.6], [0, straight + Math.cos(lean) * upper, Math.sin(lean) * upper], marble);
          addBox(holder, [frameWidth + 0.55, 0.5, 0.6], [0, straight, 0], marble);
        } else {
          addBox(holder, [frameWidth + 0.55, 0.6, 0.6], [0, height - 0.3, 0], marble);
        }
        addBox(holder, [frameWidth + 1.6, 0.4, 2], [0, 0.2, 0], whiteStone);
      };
      addFrame(0, -1.5, 7.2, 14, 5, 0, true);
      addFrame(-8.4, -0.4, 4.6, 9.4, 4, 0.2, false);
      addFrame(8.4, -0.4, 4.6, 9.4, 4, -0.2, false);
      addFrame(-15, 2, 3.8, 7, 3, 0.42, false);
      addFrame(15, 2, 3.8, 7, 3, -0.42, false);
    } else if (landmark.kind === "curzon-hall") {
      // Curzon Hall: deep red brick, cusped arcades on both storeys, and a
      // roofline of chhatris rather than any single dome.
      const HALL = 264272612;
      const mass = anchor(HALL);
      if (mass) {
        const H = mass.height;
        addBays(group, walls(HALL), {
          bay: 4.4, minEdge: 4,
          storeys: [
            { y: 1.4, opening: pointedArch(2.4, 5), surround: pointedArch(3.2, 5.8) },
            { y: H * 0.5 + 1, opening: pointedArch(2.4, 5.4), surround: pointedArch(3.2, 6.2) },
          ],
          opening: archDark, surround: brickTrim,
          pier: { width: 0.7, depth: 0.5, bottom: 0, top: H, material: brickTrim },
        });
        slab(HALL, 0, 1.1, 1.01, brickTrim);
        slab(HALL, H * 0.5, 0.6, 1.012, brickTrim);
        slab(HALL, H - 0.6, 0.9, 1.022, brickTrim);
        slab(HALL, H + 0.3, 1.1, 1.004, deepBrick);
        slab(HALL, H + 1.4, 0.08, 0.955, terracotta);
        const hall = frame(HALL, [0, -1]);
        if (hall) {
          const { g, hx, hz } = hall;
          const roofY = H + 1.4;
          // Corner kiosks, a row along each long parapet, and the larger
          // pavilions over the projecting centre bays.
          for (const sideX of [-1, 1]) {
            for (const sideZ of [-1, 1]) addChhatri(g, [sideX * (hx - 3), roofY, sideZ * (hz * 0.42)], 4.2, deepBrick, brickTrim);
            for (const t of [0.3, 0.62]) {
              for (const sideZ of [-1, 1]) addChhatri(g, [sideX * hx * t, roofY, sideZ * (hz * 0.3)], 2.6, deepBrick, brickTrim);
            }
          }
          for (const sideZ of [-1, 1]) {
            addBox(g, [16, 3.4, 9], [0, roofY + 1.7, sideZ * (hz - 6)], deepBrick);
            addBox(g, [17, 0.5, 10], [0, roofY + 3.6, sideZ * (hz - 6)], brickTrim);
            for (const sideX of [-1, 1]) addChhatri(g, [sideX * 6.2, roofY + 3.8, sideZ * (hz - 6)], 4.6, deepBrick, brickTrim);
            const portal = new THREE.Mesh(pointedArch(5, 8.4), archDark);
            portal.position.set(0, 1.2, sideZ * (hz + 0.2));
            if (sideZ < 0) portal.rotation.y = Math.PI;
            g.add(portal);
          }
        }
      }
    } else if (landmark.kind === "baitul-mukarram") {
      // The national mosque: a tall white cube after the Kaaba rising out of
      // low wings of slit windows, entered through a triple-arched portal, with
      // a single minaret beside it.
      const HALL = 186664126;
      const mass = anchor(HALL);
      if (mass) {
        const H = mass.height;
        addBays(group, walls(HALL), {
          bay: 3.4, minEdge: 14, margin: 3,
          storeys: [{ y: 3.6, opening: roundArch(1, 7.6) }],
          opening: archDark,
        });
        slab(HALL, 0, 1.6, 1.012, paleConcrete);
        slab(HALL, H - 1.2, 1.6, 1.01, marble);
        slab(HALL, H + 0.4, 0.08, 0.97, roofGrey);
        const hall = frame(HALL, [1, 0]);
        if (hall) {
          const { g, hx, hz } = hall;
          const cube = hz * 0.62;
          const cubeX = -hx * 0.2;
          const cubeTop = 35;
          addBox(g, [cube * 2, cubeTop, cube * 2], [cubeX, cubeTop / 2, 0], whiteStone);
          // The two dark bands under the cornice are the cube's only ornament.
          for (const y of [cubeTop - 5.6, cubeTop - 3.6]) addBox(g, [cube * 2 + 0.3, 0.7, cube * 2 + 0.3], [cubeX, y, 0], recess);
          addBox(g, [cube * 2 + 0.8, 0.9, cube * 2 + 0.8], [cubeX, cubeTop - 0.45, 0], marble);
          addBox(g, [cube * 2 - 2, 0.1, cube * 2 - 2], [cubeX, cubeTop + 0.05, 0], roofGrey);
          // Entrance portal on the east front, three pointed arches wide.
          const portalX = cubeX + cube;
          addBox(g, [5, H + 6.5, 30], [portalX + 2.5, (H + 6.5) / 2, 0], whiteStone);
          addBox(g, [5.6, 1, 31], [portalX + 2.5, H + 6.5, 0], marble);
          for (const [offset, archWidth, archHeight] of [[-9.6, 5.4, 11.5], [0, 7, 14.5], [9.6, 5.4, 11.5]] as const) {
            const arch = new THREE.Mesh(pointedArch(archWidth, archHeight), archDark);
            arch.position.set(portalX + 5.18, 1.6, offset);
            arch.rotation.y = Math.PI / 2;
            g.add(arch);
          }
          // Forecourt, reflecting pool and the walk up to the portal.
          addBox(g, [hx * 0.5, 0.3, 26], [hx + hx * 0.2, 0.2, 0], paleConcrete);
          addBox(g, [hx * 0.42, 0.3, 9], [hx + hx * 0.2, 0.34, 0], water);
          g.updateMatrix();
          const cubeSeat = new THREE.Vector3(cubeX, 0, 0).applyMatrix4(g.matrix);
          solid(cubeSeat.x, cubeSeat.z, cube, cubeTop);
        }
        const minaretX = mass.x + mass.width * 0.56;
        const minaretZ = mass.z + mass.depth * 0.54;
        addBox(group, [7.5, 6, 7.5], [minaretX, 3, minaretZ], whiteStone);
        addCylinder(group, 2.3, 3, 46, [minaretX, 29, minaretZ], whiteStone, 8);
        for (const y of [22, 38]) addCylinder(group, 3.5, 3.1, 1.2, [minaretX, y, minaretZ], marble, 8);
        addCylinder(group, 4.3, 3.2, 1.6, [minaretX, 52.6, minaretZ], marble, 8);
        addCylinder(group, 1.8, 2.1, 8, [minaretX, 57.4, minaretZ], whiteStone, 8);
        addLathe(group, domeProfile(2.1, 3.4, 0.14, 8), 12, [minaretX, 61.4, minaretZ], marble);
        addFinial(group, [minaretX, 64.8, minaretZ], 0.8);
        solid(minaretX, minaretZ, 3.6, 66);
      }
    } else if (landmark.kind === "bangladesh-bank") {
      // Central bank tower: a concrete podium, a glazed shaft with a spandrel to
      // every floor, solid end cores, and a stepped crown.
      addBox(group, [width * 0.96, 9, depth * 0.96], [0, 4.5, 0], concrete);
      addBox(group, [width * 0.98, 4.6, depth * 0.98], [0, 4.4, 0], ribbonGlass);
      addBox(group, [width * 1.02, 0.9, depth * 1.02], [0, 9.4, 0], paleConcrete);
      const shaftHeight = top - 12;
      addBox(group, [width * 0.72, shaftHeight, depth * 0.66], [0, shaftHeight / 2 + 9.8, 0], darkGlass);
      for (let y = 13.4; y < top - 5; y += 3.7) addBox(group, [width * 0.735, 0.7, depth * 0.675], [0, y, 0], paleConcrete);
      for (const side of [-1, 1]) {
        addBox(group, [width * 0.1, shaftHeight + 3, depth * 0.5], [side * width * 0.39, (shaftHeight + 3) / 2 + 9.8, 0], concrete);
        for (let offset = -0.26; offset <= 0.261; offset += 0.13) {
          addBox(group, [0.5, shaftHeight, 0.8], [width * offset, shaftHeight / 2 + 9.8, side * depth * 0.335], paleConcrete);
        }
      }
      addBox(group, [width * 0.78, 2.4, depth * 0.72], [0, top - 1.4, 0], paleConcrete);
      addBox(group, [width * 0.5, 4, depth * 0.44], [0, top + 1.8, 0], plantGrey);
      addBox(group, [width * 0.3, 2.4, depth * 0.3], [0, top + 5, 0], roofGrey);
      addCylinder(group, 0.4, 0.6, 12, [0, top + 12, 0], accent, 8);
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
      // Terminal: a long glazed concourse under an oversailing roof, with
      // piers out to the apron stands.
      addBox(group, [290, 14, 72], [-245, 7, -300], paleConcrete);
      addBox(group, [292, 6, 73], [-245, 8, -300], ribbonGlass);
      addBox(group, [304, 1.6, 84], [-245, 15, -300], silverPanel);
      for (let offset = -120; offset <= 120; offset += 40) addBox(group, [14, 2.4, 60], [-245 + offset, 17, -300], atriumGlass);
      addBox(group, [230, 8, 126], [-250, 4, -205], concrete);
      addBox(group, [228, 0.2, 124], [-250, 8.1, -205], roofGrey);
      // A simple airliner: fuselage, swept wing, tailplane and fin.
      const addAirliner = (x: number, z: number, heading: number, livery: THREE.Material) => {
        const plane = new THREE.Group();
        plane.position.set(x, 4.6, z);
        plane.rotation.y = heading;
        group.add(plane);
        const fuselage = addCylinder(plane, 2.3, 2.3, 34, [0, 0, 0], whiteStone, 12);
        fuselage.rotation.x = Math.PI / 2;
        const nose = addCone(plane, 2.3, 6, [0, 0, 20], whiteStone, 12);
        nose.rotation.x = Math.PI / 2;
        const tail = addCone(plane, 2.3, 9, [0, 0.6, -21.5], whiteStone, 12);
        tail.rotation.x = -Math.PI / 2;
        for (const side of [-1, 1]) {
          const wing = addBox(plane, [20, 0.5, 5.4], [side * 11, -0.6, -1.5], whiteStone);
          wing.rotation.y = side * 0.42;
          const engine = addCylinder(plane, 1.1, 1.1, 4.6, [side * 7.4, -1.9, 1.6], plantGrey, 10);
          engine.rotation.x = Math.PI / 2;
          const stabiliser = addBox(plane, [7.6, 0.4, 3], [side * 4.2, 1, -21.5], whiteStone);
          stabiliser.rotation.y = side * 0.4;
        }
        const fin = addBox(plane, [0.5, 8, 5.6], [0, 4.6, -21.5], livery);
        fin.rotation.x = -0.5;
        addBox(plane, [4.7, 0.5, 30], [0, -0.3, 0], livery);
      };
      for (const [index, gate] of [-120, -40, 40, 120].entries()) {
        addBox(group, [5, 4, 44], [-202 + gate, 6, -122], silverPanel);
        addBox(group, [5.4, 2, 44.2], [-202 + gate, 6.4, -122], ribbonGlass);
        addAirliner(-202 + gate + 16, -86, Math.PI, index % 2 ? accent : monumentRed);
      }
      addAirliner(-70, 420, 0, monumentRed);
      // Control tower with a glazed cab.
      addCylinder(group, 6, 8, 48, [-390, 24, -245], concrete, 12);
      addCylinder(group, 12, 7, 6, [-390, 51, -245], paleConcrete, 12);
      addCylinder(group, 13, 12, 5.5, [-390, 56.7, -245], ribbonGlass, 12);
      addCylinder(group, 13.6, 13.6, 1, [-390, 60, -245], silverPanel, 12);
      addCylinder(group, 1, 1, 12, [-390, 66.5, -245], accent, 8);
      // Runway numbers end: threshold bars at both ends.
      for (const end of [-1, 1]) {
        for (let bar = -3; bar <= 3; bar++) addBox(group, [3, 0.45, 44], [bar * 8, 1.36, end * 1_500], whiteStone);
      }
    }

    bakeGroup(group);
    const bounds = allBounds.get(landmark.kind)!;
    colliders.push({
      x: (bounds.minX + bounds.maxX) / 2,
      z: (bounds.minZ + bounds.maxZ) / 2,
      halfWidth: Math.max(3, (bounds.maxX - bounds.minX) / 2),
      halfDepth: Math.max(3, (bounds.maxZ - bounds.minZ) / 2),
      top: colliderTop,
    });
    const world = coordinatesToWorld(landmark.lat, landmark.lon);
    // Seat the perch on whatever is actually built at that spot, so the crow
    // lands on the roof or the dome rather than inside it.
    group.updateMatrixWorld(true);
    perchRay.set(perchOrigin.set(world.x, 900, world.y), perchDown);
    const surfaces = perchRay.intersectObjects([group, ...(landmarkMeshes.get(landmark.kind) ?? [])], true);
    let perchTop = surfaces.length > 0 ? surfaces[0].point.y : top;
    // A perch below the top of a collision column could never be reached, so
    // it never sits lower than the columns that contain it.
    for (const collider of colliders) {
      if (Math.abs(world.x - collider.x) <= collider.halfWidth && Math.abs(world.y - collider.z) <= collider.halfDepth) {
        perchTop = Math.max(perchTop, collider.top);
      }
    }
    const perch = {
      position: new THREE.Vector3(world.x, perchTop, world.y),
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

    // Box-girder guideway: one continuous swept rectangular tube along the curve
    // so adjacent spans never overlap on coplanar top/bottom faces and z-fight.
    const GIRDER_SAMPLES = Math.min(560, Math.max(160, Math.round(curveLength / 90)));
    const girderPositions: number[] = [];
    const girderUvs: number[] = [];
    const pushQuad = (a: [number, number, number], b: [number, number, number], c: [number, number, number], d: [number, number, number]) => {
      girderPositions.push(...a, ...b, ...c, ...a, ...c, ...d);
      girderUvs.push(0, 0, 1, 0, 1, 1, 0, 0, 1, 1, 0, 1);
    };
    const girderRings: Array<[[number, number, number], [number, number, number], [number, number, number], [number, number, number]]> = [];
    for (let index = 0; index <= GIRDER_SAMPLES; index++) {
      const u = index / GIRDER_SAMPLES;
      const point = metroCurve.getPointAt(u);
      const tangent = metroCurve.getTangentAt(u);
      const perpLen = Math.hypot(tangent.x, tangent.z) || 1;
      const nx = (-tangent.z / perpLen) * 4.8;
      const nz = (tangent.x / perpLen) * 4.8;
      const topY = point.y;
      const botY = point.y - 2.4;
      girderRings.push([
        [point.x - nx, topY, point.z - nz],
        [point.x + nx, topY, point.z + nz],
        [point.x + nx, botY, point.z + nz],
        [point.x - nx, botY, point.z - nz],
      ]);
    }
    for (let index = 0; index < girderRings.length - 1; index++) {
      const [tl0, tr0, br0, bl0] = girderRings[index];
      const [tl1, tr1, br1, bl1] = girderRings[index + 1];
      pushQuad(tl0, tr0, tr1, tl1); // top
      pushQuad(bl0, bl1, br1, br0); // bottom
      pushQuad(tr0, br0, br1, tr1); // right
      pushQuad(tl0, tl1, bl1, bl0); // left
    }
    if (girderRings.length >= 2) {
      const [tl0, tr0, br0, bl0] = girderRings[0];
      pushQuad(tl0, bl0, br0, tr0);
      const [tln, trn, brn, bln] = girderRings[girderRings.length - 1];
      pushQuad(tln, trn, brn, bln);
    }
    const girderGeometry = new THREE.BufferGeometry();
    girderGeometry.setAttribute("position", new THREE.Float32BufferAttribute(girderPositions, 3));
    girderGeometry.setAttribute("uv", new THREE.Float32BufferAttribute(girderUvs, 2));
    girderGeometry.computeVertexNormals();
    const girderMesh = new THREE.Mesh(girderGeometry, guidewayMaterial);
    girderMesh.castShadow = true;
    girderMesh.receiveShadow = true;
    metroRoot.add(girderMesh);
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
      for (const side of [-1, 1]) addBox(stationGroup, [98, 0.35, 0.6], [0, 2.2, side * 10.4], metroRed);
      // Supporting columns and glazed side walls up to the eaves.
      for (const side of [-1, 1]) {
        for (const x of [-40, -20, 0, 20, 40]) addBox(stationGroup, [1.8, ROOF_BASE_Y - 2, 1.8], [x, (ROOF_BASE_Y + 2) / 2, side * 11.4], concrete);
        addBox(stationGroup, [89.2, ROOF_BASE_Y - 2.3, 0.4], [0, (ROOF_BASE_Y + 2) / 2, side * 11.4], metroGlass);
      }
      for (const end of [-1, 1]) addBox(stationGroup, [0.6, ROOF_BASE_Y - 2.4, 22.4], [end * 45, (ROOF_BASE_Y + 2) / 2, 0], metroGlass);
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
      addLabel(point.clone().add(new THREE.Vector3(0, 42, 0)), station.label, metroRoot, true);
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
        addBox(train, [CAR_W + 0.14, 1.1, CAR_LEN - 2.4], [0, 3.1, z], darkGlass);
        addBox(train, [CAR_W + 0.18, 0.55, CAR_LEN - 0.6], [0, 2.15, z], metroRed);
        addBox(train, [CAR_W - 0.5, 0.5, CAR_LEN - 0.4], [0, 4.35, z], metroSteel);
        addBox(train, [0.8, 0.24, CAR_LEN - 0.4], [0, 4.72, z], metroRed);
        for (const b of [-1, 1]) addBox(train, [2.4, 0.9, 3.6], [0, 0.35, z + b * 6.4], recess);
        // Nose cab detailing on the two end cars.
        if (car === 0 || car === CAR_COUNT - 1) {
          const dir = car === 0 ? -1 : 1;
          const tip = z + dir * (CAR_LEN / 2);
          const windshield = addBox(train, [CAR_W - 0.1, 2.2, 0.5], [0, 3.2, tip + dir * 0.08], darkGlass);
          windshield.rotation.x = dir * 0.42;
          addBox(train, [CAR_W - 0.2, 0.5, 0.35], [0, 1.9, tip + dir * 0.12], metroRed);
        }
      }
      bakeGroup(train);
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

    // Guideway, piers and stations are static: merge them to one mesh per
    // material instead of one draw call per girder segment.
    bakeGroup(metroRoot);
    for (const child of [...metroRoot.children]) {
      if (child instanceof THREE.Group && child.children.length === 0) metroRoot.remove(child);
    }

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
    new THREE.MeshStandardMaterial({
      color: 0x87937a,
      map: makeGroundTexture(),
      roughness: 1,
      polygonOffset: true,
      polygonOffsetFactor: 4,
      polygonOffsetUnits: 4,
    }),
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
      roughness: 0.24,
      metalness: 0.02,
      clearcoat: 0.7,
      clearcoatRoughness: 0.28,
      polygonOffset: true,
      polygonOffsetFactor: 2,
      polygonOffsetUnits: 2,
    }),
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
      new THREE.MeshBasicMaterial({
        color: i % 3 === 0 ? 0xc9e1d7 : 0x7eb7b2,
        transparent: true,
        opacity: 0.18,
        depthWrite: false,
        polygonOffset: true,
        polygonOffsetFactor: -1,
        polygonOffsetUnits: -1,
      }),
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
  const lineMaterial = new THREE.MeshStandardMaterial({
    color: 0xd9c277,
    roughness: 0.9,
    emissive: 0x8b641e,
    emissiveIntensity: 0,
  });
  lineMaterial.userData.nightGlowIntensity = 0.32;
  const nightGlowMaterials = scene.userData.nightGlowMaterials as THREE.MeshStandardMaterial[] | undefined ?? [];
  if (!scene.userData.nightGlowMaterials) scene.userData.nightGlowMaterials = nightGlowMaterials;
  nightGlowMaterials.push(lineMaterial);
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

  const windowMaterial = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    roughness: 0.26,
    metalness: 0.24,
    vertexColors: true,
    emissive: 0xffb45e,
    emissiveIntensity: 0,
  });
  windowMaterial.userData.nightGlowIntensity = 0.78;
  nightGlowMaterials.push(windowMaterial);
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
    perch.marker = marker;
  }
  scene.userData.perches = perches;
  scene.userData.perchMarkers = perchMarkers;

  const clouds: THREE.Group[] = [];
  const cloudMaterial = new THREE.MeshStandardMaterial({ color: 0xe9e5d5, roughness: 1, transparent: true, opacity: 0.55, depthWrite: false });
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

// Side of the square map cells that static world geometry is merged into.
const WORLD_MESH_CELL_SIZE = 2400;

// Merge static world geometry into one mesh per map cell. Merging by cell rather
// than by arrival order is what lets the renderer cull: each mesh's bounds are a
// compact patch of the city, so everything behind the camera or past the far
// plane is skipped instead of the whole map being submitted every frame.
async function mergeIntoMeshBatches(
  group: THREE.Object3D,
  geometries: THREE.BufferGeometry[],
  material: THREE.Material,
  name: string,
  isCancelled: () => boolean,
  shadows = false,
) {
  if (geometries.length === 0) return;
  const yieldIfNeeded = createMainThreadYielder();
  const cells = new Map<string, THREE.BufferGeometry[]>();
  for (const geometry of geometries) {
    geometry.computeBoundingBox();
    const box = geometry.boundingBox!;
    const key = `${Math.floor((box.min.x + box.max.x) / 2 / WORLD_MESH_CELL_SIZE)}:${Math.floor((box.min.z + box.max.z) / 2 / WORLD_MESH_CELL_SIZE)}`;
    const cell = cells.get(key);
    if (cell) cell.push(geometry);
    else cells.set(key, [geometry]);
  }
  for (const [key, batch] of cells) {
    const merged = mergeGeometries(batch, false);
    batch.forEach((geometry) => geometry.dispose());
    if (merged) {
      const mesh = new THREE.Mesh(merged, material);
      mesh.name = `${name} ${key}`;
      mesh.castShadow = shadows;
      mesh.receiveShadow = true;
      // The world never moves, so skip recomposing its matrix every frame.
      mesh.matrixAutoUpdate = false;
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
  // Keep the incoming OSM world hidden until every batch is built so it never
  // overlaps and z-fights with the fallback world mid-load.
  root.visible = false;
  scene.add(root);
  const colliders: BuildingCollider[] = [];
  const yieldIfNeeded = createMainThreadYielder();

  const waterAreas: THREE.BufferGeometry[] = [];
  const waterLines: THREE.BufferGeometry[] = [];
  for (const feature of data.water) {
    const waterJitter = (Math.abs(feature.id) % 7) * 0.008;
    if (feature.area && feature.points.length >= 3) {
      const geometry = new THREE.ShapeGeometry(polygonShape(feature.points));
      geometry.rotateX(-Math.PI / 2);
      geometry.translate(0, 0.48 + waterJitter, 0);
      waterAreas.push(geometry);
      continue;
    }
    for (let index = 1; index < feature.points.length; index++) {
      const [x1, z1] = feature.points[index - 1];
      const [x2, z2] = feature.points[index];
      const length = Math.hypot(x2 - x1, z2 - z1);
      if (length < 1) continue;
      // Top face only, staggered slightly per segment to avoid corner overlap z-fighting.
      const geometry = new THREE.PlaneGeometry(length, 8);
      geometry.rotateX(-Math.PI / 2);
      geometry.rotateY(-Math.atan2(z2 - z1, x2 - x1));
      geometry.translate((x1 + x2) / 2, 0.64 + waterJitter + (index & 1) * 0.004, (z1 + z2) / 2);
      waterLines.push(geometry);
    }
    await yieldIfNeeded(isCancelled);
  }
  const waterAreaMaterial = new THREE.MeshPhysicalMaterial({
    color: 0x397f88,
    roughness: 0.24,
    metalness: 0.02,
    clearcoat: 0.7,
    clearcoatRoughness: 0.28,
    polygonOffset: true,
    polygonOffsetFactor: 2,
    polygonOffsetUnits: 2,
  });
  const waterLineMaterial = new THREE.MeshPhysicalMaterial({
    color: 0x397f88,
    roughness: 0.24,
    metalness: 0.02,
    clearcoat: 0.7,
    clearcoatRoughness: 0.28,
    polygonOffset: true,
    polygonOffsetFactor: 1,
    polygonOffsetUnits: 1,
  });
  await mergeIntoMeshBatches(root, waterAreas, waterAreaMaterial, "OSM water areas", isCancelled);
  await mergeIntoMeshBatches(root, waterLines, waterLineMaterial, "OSM waterways", isCancelled);

  await addRoadNetworkMeshes(root, data.roads, "OSM", isCancelled, scene);

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
  const landmarkColliders = (scene.userData.landmarkColliders as BuildingCollider[] | undefined) ?? [];
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
    if (
      inAirportClearance(centerX, centerZ, Math.max(halfWidth, halfDepth) + 10)
      || landmarkColliders.some((collider) => (
        Math.abs(centerX - collider.x) < halfWidth + collider.halfWidth + 2
        && Math.abs(centerZ - collider.z) < halfDepth + collider.halfDepth + 2
      ))
      || footprintBlockedByGround(centerX, centerZ, halfWidth, halfDepth)
    ) {
      await yieldIfNeeded(isCancelled);
      continue;
    }
    // Slight deterministic height jitter separates coplanar roofs where OSM
    // footprints touch or overlap at identical tagged heights.
    const height = Math.max(3, building.height + ((Math.abs(building.id) % 7) - 3) * 0.04);
    const geometry = new THREE.ExtrudeGeometry(polygonShape(building.points), {
      depth: height,
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
      top: height,
    });
    await yieldIfNeeded(isCancelled);
  }
  // These four merged batches are the real Dhaka the player flies over, so they
  // carry the window lighting that makes the city legible after dark.
  const buildingMaterials = [0xcdbfa5, 0xb5bdb3, 0xc28f76, 0x9daa9d].map(
    (color) => applyNightWindows(new THREE.MeshStandardMaterial({ color, roughness: 0.88, metalness: 0.01 }), 0.54),
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
  // Atomically swap out the fallback layers and reveal the live OSM world so
  // roads, water, and buildings never overlap across two layers on screen.
  if (data.roads.length > 0) {
    const roadFallback = scene.userData.proceduralRoadFallback as THREE.Group | undefined;
    if (roadFallback) roadFallback.visible = false;
  }
  const fallback = scene.userData.fallbackWorld as THREE.Group | undefined;
  if (fallback) fallback.visible = false;
  const immediateCityMass = scene.userData.immediateCityMass as THREE.Group | undefined;
  if (immediateCityMass) immediateCityMass.visible = false;
  root.visible = true;
  return colliders;
}

// Both of these read browser-only state that must not differ between the server
// render and hydration. useSyncExternalStore serves the server snapshot first and
// then swaps in the real value, which avoids both a mismatch and a cascading
// setState-inside-an-effect.
const COARSE_POINTER_QUERY = "(pointer: coarse), (hover: none)";

function subscribeToPointerKind(onChange: () => void) {
  const query = window.matchMedia(COARSE_POINTER_QUERY);
  query.addEventListener("change", onChange);
  return () => query.removeEventListener("change", onChange);
}

function readTouchPreference() {
  // `?touch=1` forces the on-screen controls on (useful on hybrid laptops and for
  // testing); `?touch=0` forces them off.
  const override = new URLSearchParams(window.location.search).get("touch");
  if (override === "1") return true;
  if (override === "0") return false;
  return window.matchMedia(COARSE_POINTER_QUERY).matches;
}

function noopSubscribe() {
  return () => {};
}

const SOUND_VOLUME_KEY = "bev-sound-volume";
function readSavedSoundVolume() {
  try {
    const saved = Number(window.localStorage.getItem(SOUND_VOLUME_KEY) ?? "1");
    return Number.isFinite(saved) ? clamp(saved, 0, 1.5) : 1;
  } catch {
    return 1;
  }
}

function readSkyPresetFromUrl() {
  const requested = new URLSearchParams(window.location.search).get("sky");
  return SKY_PRESETS.some((preset) => preset.id === requested) ? requested as string : "live";
}

const TOUCH_STICK_RADIUS = 52;
const TOUCH_STICK_DEADZONE = 0.14;

/**
 * Analog steering pad for touchscreens. It reports a continuous [-1, 1] pair
 * rather than synthesised key presses so the flight model gets proportional
 * banking and climb, which a four-way keypad cannot express.
 */
function TouchStick({ onAxes, label }: { onAxes: (turn: number, climb: number) => void; label: string }) {
  const padRef = useRef<HTMLDivElement>(null);
  const knobRef = useRef<HTMLDivElement>(null);
  const pointerIdRef = useRef<number | null>(null);

  const applyOffset = useCallback((offsetX: number, offsetY: number) => {
    const distance = Math.hypot(offsetX, offsetY);
    const limit = distance > TOUCH_STICK_RADIUS ? TOUCH_STICK_RADIUS / distance : 1;
    const clampedX = offsetX * limit;
    const clampedY = offsetY * limit;
    if (knobRef.current) knobRef.current.style.transform = `translate(${clampedX}px, ${clampedY}px)`;
    const normalizedX = clampedX / TOUCH_STICK_RADIUS;
    const normalizedY = clampedY / TOUCH_STICK_RADIUS;
    // Rescale past the deadzone so the very first responsive input is gentle
    // instead of jumping straight to 14% deflection.
    const shape = (value: number) => {
      const magnitude = Math.abs(value);
      if (magnitude < TOUCH_STICK_DEADZONE) return 0;
      return Math.sign(value) * ((magnitude - TOUCH_STICK_DEADZONE) / (1 - TOUCH_STICK_DEADZONE));
    };
    // Left on screen is a left bank, and screen-up is a climb, so Y inverts.
    onAxes(-shape(normalizedX), -shape(normalizedY));
  }, [onAxes]);

  const release = useCallback(() => {
    pointerIdRef.current = null;
    if (knobRef.current) knobRef.current.style.transform = "";
    if (padRef.current) padRef.current.dataset.active = "false";
    onAxes(0, 0);
  }, [onAxes]);

  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (pointerIdRef.current !== null) return;
    pointerIdRef.current = event.pointerId;
    event.currentTarget.setPointerCapture(event.pointerId);
    event.currentTarget.dataset.active = "true";
    const bounds = event.currentTarget.getBoundingClientRect();
    applyOffset(event.clientX - (bounds.left + bounds.width / 2), event.clientY - (bounds.top + bounds.height / 2));
  };

  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (pointerIdRef.current !== event.pointerId) return;
    const bounds = event.currentTarget.getBoundingClientRect();
    applyOffset(event.clientX - (bounds.left + bounds.width / 2), event.clientY - (bounds.top + bounds.height / 2));
  };

  const onPointerEnd = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (pointerIdRef.current !== event.pointerId) return;
    release();
  };

  // A stick left deflected while the component unmounts would steer forever.
  useEffect(() => () => onAxes(0, 0), [onAxes]);

  return (
    <div
      ref={padRef}
      className="touch-stick"
      data-active="false"
      role="application"
      aria-label={label}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerEnd}
      onPointerCancel={onPointerEnd}
    >
      <i className="touch-stick-axis" aria-hidden="true" />
      <div ref={knobRef} className="touch-stick-knob" aria-hidden="true" />
    </div>
  );
}

/** Press-and-hold button that maps a touch to a sustained flight key. */
function TouchHoldButton({
  label,
  hint,
  onHold,
  className = "",
}: {
  label: string;
  hint: string;
  onHold: (held: boolean) => void;
  className?: string;
}) {
  const activePointer = useRef<number | null>(null);
  const end = (event: ReactPointerEvent<HTMLButtonElement>) => {
    if (activePointer.current !== event.pointerId) return;
    activePointer.current = null;
    event.currentTarget.dataset.held = "false";
    onHold(false);
  };
  return (
    <button
      type="button"
      className={`touch-button ${className}`.trim()}
      data-held="false"
      aria-label={hint}
      onPointerDown={(event) => {
        activePointer.current = event.pointerId;
        event.currentTarget.setPointerCapture(event.pointerId);
        event.currentTarget.dataset.held = "true";
        onHold(true);
      }}
      onPointerUp={end}
      onPointerCancel={end}
      // Releasing outside the button must still release the key.
      onLostPointerCapture={() => {
        if (activePointer.current === null) return;
        activePointer.current = null;
        onHold(false);
      }}
    >{label}</button>
  );
}

/** One choice in a take-off menu list: name, a line about it, and a tick when chosen. */
function MenuOption({ selected, name, note, swatch, onChoose }: { selected: boolean; name: string; note: string; swatch?: string; onChoose: () => void }) {
  return (
    <button type="button" className={`menu-opt${selected ? " selected" : ""}${swatch ? "" : " no-swatch"}`} aria-pressed={selected} onClick={onChoose}>
      <i aria-hidden="true" style={swatch ? { background: swatch } : undefined} />
      <b>{name}</b>
      <small>{note}</small>
      {selected && <HudIcon name="check" className="opt-check" />}
    </button>
  );
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
  const perchRangeRef = useRef<HTMLElement>(null);
  const landmarkRangeRef = useRef<HTMLSpanElement>(null);
  // On a phone the map and the settings open as sheets that hold the flight
  // still without raising the pause dialog. This records that hold.
  const sheetHoldRef = useRef(false);
  const flyingRef = useRef(false);
  const pausedRef = useRef(false);
  const restingRef = useRef(false);
  const cameraModeRef = useRef<CameraMode>("CHASE");
  const audioRef = useRef<FlightAudio | null>(null);
  const radioRef = useRef<FlightRadio | null>(null);
  const focusLandmarkRef = useRef<(kind: DhakaLandmark["kind"] | null) => boolean>(() => false);
  const flightActionsRef = useRef<FlightActions | null>(null);
  const setSkyHourRef = useRef<(hour: number | null) => void>(() => {});
  const resumeButtonRef = useRef<HTMLButtonElement>(null);
  // Escape has to know what is currently on screen, but the world effect never
  // re-runs. A ref kept fresh by a tiny effect bridges that gap.
  const dismissOverlayRef = useRef<() => boolean>(() => false);
  // English is what the server renders; the visitor's language swaps in on the client.
  const locale = useSyncExternalStore(subscribeToLocale, readLocale, () => "en" as Locale);
  const t = STRINGS[locale];
  const localeRef = useRef<Locale>("en");
  const relabelRef = useRef<(locale: Locale) => void>(() => {});
  // The crow is what the server renders; the visitor's bird swaps in on the client.
  const birdId = useSyncExternalStore(subscribeToBird, readBird, () => "crow" as BirdId);
  const birdRef = useRef<BirdId>("crow");
  const loadBirdRef = useRef<(bird: Bird, preview: boolean) => void>(() => {});
  const [flying, setFlying] = useState(false);
  const [paused, setPaused] = useState(false);
  const [resting, setResting] = useState(false);
  const [cameraMode, setCameraMode] = useState<CameraMode>("CHASE");
  const [inspecting, setInspecting] = useState(false);
  // The title opens on the sky alone; any key brings up the take-off menu.
  const [titleBeat, setTitleBeat] = useState<"title" | "menu">("title");
  const [menuOpen, setMenuOpen] = useState<"" | "bird" | "site" | "sky">("");
  const [titleLeaving, setTitleLeaving] = useState(false);
  // In flight only five small controls are on screen. Each opens its panel in
  // place, one at a time.
  const [hudOpen, setHudOpen] = useState<"" | "place" | "more" | "readout" | "map">("");
  const [hudHidden, setHudHidden] = useState(false);
  const [hudIdle, setHudIdle] = useState(false);
  const [areaLabel, setAreaLabel] = useState("");
  const [nearestLandmark, setNearestLandmark] = useState("");
  const [soundOn, setSoundOn] = useState(false);
  const [radioStatus, setRadioStatus] = useState<RadioStatus>("off");
  const [radioStationIndex, setRadioStationIndex] = useState(0);
  const [radioVolume, setRadioVolume] = useState(0.58);
  // A coarse pointer with no hover means there is no mouse, which is exactly when
  // the keyboard-only HUD is useless and the thumb controls have to appear.
  const touchDevice = useSyncExternalStore(subscribeToPointerKind, readTouchPreference, () => false);
  const [mapStatus, setMapStatus] = useState<MapStatus>("loading");
  const [launchSiteId, setLaunchSiteId] = useState<string | null>(null);
  const [weatherStatus, setWeatherStatus] = useState<WeatherStatus>("loading");
  const [weather, setWeather] = useState<WeatherSnapshot>(DEFAULT_WEATHER);
  // A shared link can pin the sky; once the player picks an hour their choice wins.
  const urlSkyPresetId = useSyncExternalStore(noopSubscribe, readSkyPresetFromUrl, () => "live");
  const [chosenSkyPresetId, setChosenSkyPresetId] = useState<string | null>(null);
  const skyPresetId = chosenSkyPresetId ?? urlSkyPresetId;
  // The server renders the designed level; a saved setting swaps in on the client.
  const savedSoundVolume = useSyncExternalStore(noopSubscribe, readSavedSoundVolume, () => 1);
  const [chosenSoundVolume, setChosenSoundVolume] = useState<number | null>(null);
  const soundVolume = chosenSoundVolume ?? savedSoundVolume;
  const [shareState, setShareState] = useState<"idle" | "copied" | "failed">("idle");
  const [sharedLink, setSharedLink] = useState("");
  // With an hour pinned, the sun/moon glyph has to follow the rendered sky rather
  // than the live observation, or the HUD contradicts the window.
  const skyPresetHour = SKY_PRESETS.find((preset) => preset.id === skyPresetId)?.hour ?? null;
  const skyIsDay = skyPresetHour === null ? weather.isDay : skyPresetHour > 5.4 && skyPresetHour < 18.7;
  const selectedRadioStation = RADIO_STATIONS[radioStationIndex];

  const selectedStationText = stationText(locale, selectedRadioStation);

  // Hand the language to everything outside React's render: the frame loop,
  // the canvas labels in the scene, and the document itself.
  useEffect(() => {
    localeRef.current = locale;
    document.documentElement.lang = locale;
    relabelRef.current(locale);
    if (locale !== "bn") return;
    // The Bengali face may still be loading; redraw the labels once it is in.
    let cancelled = false;
    const family = getComputedStyle(document.body).getPropertyValue("--font-bangla");
    if (family) {
      void document.fonts.load(`700 38px ${family}`, "ঢাকা").then(() => {
        if (!cancelled) relabelRef.current(locale);
      });
    }
    return () => {
      cancelled = true;
    };
  }, [locale]);

  // Swap the model in the running scene when the bird changes.
  useEffect(() => {
    const changed = birdRef.current !== birdId;
    birdRef.current = birdId;
    if (changed) loadBirdRef.current(birdById(birdId), true);
  }, [birdId]);

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

  // The pause overlay is a modal dialog, so keyboard focus has to move into it.
  useEffect(() => {
    if (paused) resumeButtonRef.current?.focus();
  }, [paused]);

  // Topmost-first dismissal order, so Escape always removes exactly one layer.
  useEffect(() => {
    dismissOverlayRef.current = () => {
      if (hudOpen) {
        setHudOpen("");
        return true;
      }
      if (menuOpen) {
        setMenuOpen("");
        return true;
      }
      return false;
    };
  }, [hudOpen, menuOpen]);

  // Keep the engine at the chosen volume, including one restored from a past visit.
  useEffect(() => {
    audioRef.current?.setVolume(soundVolume);
  }, [soundVolume]);
  const changeSoundVolume = useCallback((next: number) => {
    setChosenSoundVolume(next);
    try {
      window.localStorage.setItem(SOUND_VOLUME_KEY, String(next));
    } catch {
      // The setting still holds for this visit.
    }
  }, []);

  useEffect(() => {
    if (!flying) return;
    if (paused) radioRef.current?.pause();
    else void radioRef.current?.resume();
  }, [flying, paused]);

  useEffect(() => {
    const onRadioKey = (event: KeyboardEvent) => {
      // `event.target` is only an Element when a DOM node has focus; it is the
      // window itself for synthetic events, so feature-test before matching.
      if (focusedControlClaimsKey(focusedControlClaim(event.target), event.code)) return;
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
    flightAudio.setVolume(readSavedSoundVolume());
    const reducedMotionQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
    // Read live: a player can flip the OS setting without reloading the flight.
    let reducedMotion = reducedMotionQuery.matches;
    const onReducedMotionChange = (event: MediaQueryListEvent) => {
      reducedMotion = event.matches;
    };
    reducedMotionQuery.addEventListener("change", onReducedMotionChange);
    const lowPowerDevice = window.matchMedia("(pointer: coarse)").matches
      && Math.min(window.innerWidth, window.innerHeight) < 820;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x91c7c0);
    scene.fog = new THREE.FogExp2(0x91b8a8, 0.00028);
    // A 2 m near plane quadruples 24-bit depth-buffer precision across the city
    // compared to 0.5 m while staying well clear of every camera mode.
    const camera = new THREE.PerspectiveCamera(58, mount.clientWidth / mount.clientHeight, 2, 8000);
    // Phones pay for MSAA and a 2048² shadow map in both fill rate and memory, and
    // they are exactly the devices that cannot afford either. Detect them once.
    const renderer = new THREE.WebGLRenderer({ antialias: !lowPowerDevice, powerPreference: "high-performance" });
    renderer.setSize(mount.clientWidth, mount.clientHeight);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, lowPowerDevice ? 1.25 : 1.5));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFShadowMap;
    // The city never moves and the sun steps only every 30s, so re-rendering ~2M
    // triangles into the shadow map at 60Hz buys almost nothing. It is not fully
    // static though — the crow casts a shadow and district tiles stream in and
    // out of visibility — so refresh on demand plus a low steady cadence rather
    // than freezing it outright.
    renderer.shadowMap.autoUpdate = false;
    renderer.shadowMap.needsUpdate = true;
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1;
    mount.appendChild(renderer.domElement);
    const requestShadowUpdate = () => {
      renderer.shadowMap.needsUpdate = true;
    };

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
    sun.position.set(-1_200, 1_950, 840);
    sun.castShadow = true;
    sun.shadow.mapSize.set(lowPowerDevice ? 1024 : 2048, lowPowerDevice ? 1024 : 2048);
    sun.shadow.camera.left = -3400;
    sun.shadow.camera.right = 3400;
    sun.shadow.camera.top = 3800;
    sun.shadow.camera.bottom = -3800;
    sun.shadow.camera.near = 200;
    sun.shadow.camera.far = 8_000;
    // Shadow texels span ~3.5 m across the city box; bias and normalBias need
    // to match that scale to avoid striped self-shadow acne on roofs and domes.
    sun.shadow.bias = -0.0004;
    sun.shadow.normalBias = 0.75;
    scene.add(sun);
    const skyFill = new THREE.DirectionalLight(0x9bc8d2, 0.48);
    skyFill.position.set(500, 260, -600);
    scene.add(skyFill);

    let disposed = false;
    const buildingColliders = addCity(scene);
    relabelRef.current = (nextLocale) => (scene.userData.relabel as ((locale: Locale) => void) | undefined)?.(nextLocale);
    relabelRef.current(localeRef.current);
    let buildingColliderGrid = buildColliderGrid(buildingColliders);
    const fallbackRoads = proceduralFallbackRoads();
    addImmediateCityMass(scene, fallbackRoads);
    const immediateRoadFallback = new THREE.Group();
    immediateRoadFallback.name = "Immediate Greater Dhaka road network";
    scene.add(immediateRoadFallback);
    scene.userData.proceduralRoadFallback = immediateRoadFallback;
    void addRoadNetworkMeshes(immediateRoadFallback, fallbackRoads, "Immediate fallback", () => disposed, scene);
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
        // New geometry needs one shadow pass now that the map is no longer redrawn
        // into the shadow camera on every frame.
        requestShadowUpdate();
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
        requestShadowUpdate();
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
    const weatherVfx = createWeatherVfx(
      scene,
      renderer,
      sky,
      hemisphere,
      sun,
      skyFill,
      reducedMotion,
      (strength, delay) => flightAudio.thunder(strength, delay),
    );
    weatherVfx.apply(DEFAULT_WEATHER);
    flightAudio.setWeather(DEFAULT_WEATHER.mode, DEFAULT_WEATHER.precipitation);
    setSkyHourRef.current = (hour) => weatherVfx.setSkyHour(hour);
    // A shared link can pin the sky, so "look at Dhaka at golden hour" survives
    // being sent to someone in another timezone.
    const initialPreset = SKY_PRESETS.find((preset) => preset.id === readSkyPresetFromUrl());
    if (initialPreset) weatherVfx.setSkyHour(initialPreset.hour);
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
          flightAudio.setWeather(snapshot.mode, snapshot.precipitation);
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
    // Four tone steps instead of the default two: enough to model the round of
    // the body and the layering of the wing on a bird that is nearly black.
    const crowToonRamp = new THREE.DataTexture(new Uint8Array([96, 150, 205, 255]), 4, 1, THREE.RedFormat);
    crowToonRamp.minFilter = THREE.NearestFilter;
    crowToonRamp.magFilter = THREE.NearestFilter;
    crowToonRamp.needsUpdate = true;
    // The player's bird. Every species shares one skeleton and the same three
    // clips, so swapping is just replacing the model under the `crow` group. The
    // crow, at /models/dhaka-house-crow.glb, is the default.
    let birdModel: THREE.Object3D | null = null;
    let birdTraits: Bird = birdById(birdRef.current);
    let birdLoadToken = 0;
    let birdPreviewUntil = 0;
    let birdPreview = 0;
    const disposeBirdModel = (model: THREE.Object3D) => {
      model.traverse((object) => {
        if (!(object instanceof THREE.Mesh)) return;
        object.geometry.dispose();
        // The tone ramp is shared by every bird, so it is not released here.
        for (const material of Array.isArray(object.material) ? object.material : [object.material]) material.dispose();
      });
    };
    const loadBird = (bird: Bird, preview: boolean) => {
      const token = ++birdLoadToken;
      new GLTFLoader().load(bird.model, (gltf) => {
        const model = gltf.scene;
        // A newer pick, or teardown, arrived while this one was loading.
        if (disposed || token !== birdLoadToken) {
          disposeBirdModel(model);
          return;
        }
        if (birdModel) {
          mixer?.stopAllAction();
          mixer?.uncacheRoot(birdModel);
          crow.remove(birdModel);
          disposeBirdModel(birdModel);
        }
        model.scale.setScalar(bird.scale);
        model.traverse((object) => {
          if (object instanceof THREE.Mesh) {
            object.castShadow = true;
            // The citywide shadow map has ~3.5 m texels and refreshes every 12
            // frames; receiving it on a 2 m moving bird causes 5 Hz self-shadow flicker.
            object.receiveShadow = false;
            const sourceMaterials = Array.isArray(object.material) ? object.material : [object.material];
            const toonMaterials = sourceMaterials.map((material) => {
              const toon = new THREE.MeshToonMaterial({
                color: material.color?.clone() ?? new THREE.Color(0x1b2b2a),
                map: material.map ?? null,
                // Feathers are thin blades seen from above and below.
                side: material.side,
                gradientMap: crowToonRamp,
              });
              material.dispose();
              return toon;
            });
            object.material = Array.isArray(object.material) ? toonMaterials : toonMaterials[0];
          }
        });
        crow.add(model);
        birdModel = model;
        birdTraits = bird;
        flightAudio.setBird(bird.id);
        mixer = new THREE.AnimationMixer(model);
        flapAction = mixer.clipAction(gltf.animations.find((clip) => clip.name === "Flap") ?? gltf.animations[0]);
        glideAction = mixer.clipAction(gltf.animations.find((clip) => clip.name === "Glide") ?? gltf.animations[1]);
        restAction = mixer.clipAction(gltf.animations.find((clip) => clip.name === "Rest") ?? gltf.animations[2]);
        flapAction.play();
        glideAction.play();
        restAction.play();
        const perched = restingRef.current;
        flapAction.setEffectiveWeight(perched ? 0 : 0.08);
        glideAction.setEffectiveWeight(perched ? 0.04 : 0.92);
        restAction.setEffectiveWeight(perched ? 0.96 : 0);
        // On the welcome screen, bring the camera in to show the new bird.
        if (preview) birdPreviewUntil = elapsedTime + 5;
        requestShadowUpdate();
        if (import.meta.env.DEV) {
          // Dev-only: lets a pose be held and inspected outside the flight loop.
          (window as BirdFlightWindow & { __crowRig?: unknown }).__crowRig = { model, mixer, flap: flapAction, glide: glideAction, rest: restAction };
        }
      // A bird that fails to load leaves the current one flying.
      }, undefined, () => {});
    };
    loadBirdRef.current = loadBird;
    loadBird(birdTraits, false);

    let maxFrameMs = 0;
    let longFrames = 0;
    if (import.meta.env.DEV) {
      // Dev-only handles for inspecting models from an arbitrary camera.
      const devWindow = window as BirdFlightWindow & { __scene?: THREE.Scene; __renderer?: THREE.WebGLRenderer; __THREE?: typeof THREE };
      devWindow.__scene = scene;
      devWindow.__renderer = renderer;
      devWindow.__THREE = THREE;
      (window as BirdFlightWindow & { __audioProbe?: unknown }).__audioProbe = () => flightAudio.probe();
    }
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
        landing: {
          speed,
          perch: (landingCommit ?? approachPerch ?? nearestPerch)?.label ?? null,
          distance: Math.round(approachDistance),
          committed: landingCommit !== null,
          position: { x: crow.position.x, y: crow.position.y, z: crow.position.z },
        },
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
    let nextFrameAt = 0;
    let elapsedTime = 0;
    let diagnosticFrame = 0;
    let shadowFrame = 0;
    // The place chip names the district under the bird and the map names the
    // closest landmark. Both change slowly, so they are looked up a few times a
    // second and only handed to React when the answer changes.
    const areaPoints = AREA_LANDMARKS.map((area) => ({ label: area.label, world: coordinatesToWorld(area.lat, area.lon) }));
    const landmarkPoints = DHAKA_LANDMARKS.map((landmark) => ({ label: landmark.label, world: coordinatesToWorld(landmark.lat, landmark.lon) }));
    let hudFrame = 0;
    let shownArea = "";
    let shownLandmark = "";
    // Touch steering is continuous, unlike the keyboard's on/off axes, so it is
    // kept separate and only used when the keys are idle.
    let pointerTurn = 0;
    let pointerClimb = 0;
    const desiredCamera = new THREE.Vector3();
    const desiredTarget = new THREE.Vector3();
    const forward = new THREE.Vector3();
    const horizontalForward = new THREE.Vector3();
    const previousPosition = new THREE.Vector3();
    const cameraOffset = new THREE.Vector3();
    const windDrift = new THREE.Vector3();
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
    // The perch the bird is currently lined up on. Distinct from nearestPerch:
    // this one is picked from a wide forward cone and drives the automatic
    // flare, while nearestPerch is strictly "close enough to sit down on".
    let approachPerch: Perch | null = null;
    let approachDistance = 0;
    // Set once the player commits to a landing; the bird then flies itself in.
    let landingCommit: Perch | null = null;
    const perchDelta = new THREE.Vector3();
    const perchFlat = new THREE.Vector3();

    // Every discrete flight action lives here so the keyboard handler and the
    // on-screen touch controls drive exactly the same code path.
    const flapWings = () => {
      if (!flyingRef.current || pausedRef.current || restingRef.current) return;
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
    };
    const settleOnPerch = (perch: Perch) => {
      restingRef.current = true;
      setResting(true);
      landingCommit = null;
      crow.position.copy(perch.position);
      crow.position.y += 1.28;
      flightAudio.land();
      // Treetops have no meaningful facing; settle in the direction flown.
      yaw = perch.kind === "tree" ? yaw : perch.heading;
      yawRate = 0;
      pitch = 0;
      roll = 0;
      speed = 0;
      verticalSpeed = 0;
    };
    const togglePerch = () => {
      if (!flyingRef.current || pausedRef.current) return;
      if (restingRef.current) {
        restingRef.current = false;
        setResting(false);
        landingCommit = null;
        crow.position.y += 5;
        speed = 34;
        verticalSpeed = 9;
        pitch = 0.2;
        flapKick = 1;
        cameraKick = 1;
        flightAudio.flap();
      } else if (landingCommit) {
        // Second press waves off the approach and hands control straight back.
        landingCommit = null;
      } else if (nearestPerch) {
        settleOnPerch(nearestPerch);
      } else if (approachPerch) {
        // Too far to sit down but lined up on the perch: commit, and the bird
        // flies the rest of the approach itself. This is the difference between
        // threading a 34 m sphere at speed and simply choosing to land.
        landingCommit = approachPerch;
      }
    };
    const toggleCameraMode = () => {
      focusLandmark(null);
      setInspecting(false);
      const next: CameraMode = cameraModeRef.current === "CHASE" ? "BIRD'S EYE" : "CHASE";
      cameraModeRef.current = next;
      setCameraMode(next);
    };
    const cycleInspection = () => {
      inspectionIndex = (inspectionIndex + 1) % DHAKA_LANDMARKS.length;
      focusLandmark(DHAKA_LANDMARKS[inspectionIndex].kind);
      setInspecting(true);
    };
    // Landmark inspection parks the camera away from the bird, so it needs an
    // explicit way out or the player is stranded watching a building.
    const releaseInspection = () => {
      if (!inspectionTarget) return false;
      focusLandmark(null);
      inspectionIndex = -1;
      setInspecting(false);
      return true;
    };
    const setFlightPaused = (nextPaused: boolean) => {
      if (!flyingRef.current || pausedRef.current === nextPaused) return;
      pausedRef.current = nextPaused;
      setPaused(nextPaused);
      if (nextPaused) flightAudio.pause();
      else flightAudio.resume();
    };
    flightActionsRef.current = {
      flap: flapWings,
      togglePerch,
      toggleCamera: toggleCameraMode,
      cycleInspection,
      releaseInspection,
      setHold: (code, held) => {
        if (held) keys.add(code);
        else keys.delete(code);
      },
      setAxes: (turn, climb) => {
        pointerTurn = turn;
        pointerClimb = climb;
      },
      spawnAt: (lat, lon, alt) => {
        const world = coordinatesToWorld(lat, lon);
        crow.position.set(world.x, alt, world.y);
        // Face the middle of the city so the attract orbit opens on the skyline
        // rather than on the empty edge of the map.
        yaw = Math.atan2(world.x, world.y);
        yawRate = 0;
        speed = CRUISE_SPEED;
        verticalSpeed = 0;
        landingCommit = null;
        camera.position.copy(crow.position).add(new THREE.Vector3(10, 26, 26));
        cameraTarget.copy(crow.position);
      },
      readView: () => ({
        ...worldToCoordinates(crow.position.x, crow.position.z),
        alt: crow.position.y,
        yaw,
      }),
    };

    const onKeyDown = (event: KeyboardEvent) => {
      // Hand a focused control the keys it owns — typing, slider arrows, Space to
      // activate a button — but keep everything else, including Escape, for flight.
      if (focusedControlClaimsKey(focusedControlClaim(event.target), event.code)) return;
      if (flightControlCodes.has(event.code) && flyingRef.current && !pausedRef.current) {
        keys.add(event.code);
      }
      // Only cancel scroll/activation defaults for keys this flight actually uses.
      if (flyingRef.current && ["Space", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(event.code)) {
        event.preventDefault();
      }
      if (event.code === "KeyC" && !event.repeat && flyingRef.current) toggleCameraMode();
      if (event.code === "KeyL" && !event.repeat && flyingRef.current) cycleInspection();
      if (event.code === "Escape" && !event.repeat) {
        // Escape means "dismiss the thing in front of me". Panels first, then the
        // inspection camera, and only then does it double as the pause key.
        if (dismissOverlayRef.current()) {
          event.preventDefault();
          return;
        }
        if (releaseInspection()) {
          event.preventDefault();
          return;
        }
      }
      if ((event.code === "KeyP" || event.code === "Escape") && !event.repeat && flyingRef.current) {
        event.preventDefault();
        setFlightPaused(!pausedRef.current);
      }
      if (event.code === "Space" && !event.repeat) flapWings();
      if (event.code === "KeyE" && !event.repeat) togglePerch();
    };
    const onKeyUp = (event: KeyboardEvent) => keys.delete(event.code);
    const clearFlightControls = () => keys.clear();
    // A hidden tab still runs timers, so ambience and bird calls would keep
    // playing from a tab the player has walked away from. Silence it, and only
    // resume if the flight was not deliberately paused.
    const onVisibilityChange = () => {
      if (document.visibilityState !== "visible") {
        clearFlightControls();
        flightAudio.pause();
      } else if (!pausedRef.current) {
        flightAudio.resume();
      }
    };
    window.addEventListener("keydown", onKeyDown, { passive: false });
    window.addEventListener("keyup", onKeyUp);
    window.addEventListener("blur", clearFlightControls);
    document.addEventListener("visibilitychange", onVisibilityChange);

    // A ResizeObserver tracks the canvas box itself, so it also catches phone
    // orientation flips and the browser chrome sliding in and out — and it
    // coalesces to one callback per frame instead of firing on every resize event.
    let viewportWidth = mount.clientWidth;
    let viewportHeight = mount.clientHeight;
    const applyViewportSize = () => {
      const width = mount.clientWidth;
      const height = mount.clientHeight;
      if (width === 0 || height === 0 || (width === viewportWidth && height === viewportHeight)) return;
      viewportWidth = width;
      viewportHeight = height;
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
      renderer.setSize(width, height);
      requestShadowUpdate();
    };
    const resizeObserver = new ResizeObserver(applyViewportSize);
    resizeObserver.observe(mount);
    window.addEventListener("orientationchange", applyViewportSize);

    camera.position.copy(crow.position).add(new THREE.Vector3(10, 13, 26));
    cameraTarget.copy(crow.position);
    let animation = 0;
    const animate = () => {
      animation = requestAnimationFrame(animate);
      const now = performance.now();
      // Pace the loop instead of drawing as fast as the display allows. A 120 Hz
      // panel would otherwise render two million triangles twice as often for no
      // visible gain, and a paused or backgrounded game would keep the GPU at
      // full load. The 1.5 ms slack stops a 60 Hz display from skipping frames.
      const frameBudgetMs = pausedRef.current
        ? PAUSED_FRAME_MS
        : document.hasFocus() ? ACTIVE_FRAME_MS : UNFOCUSED_FRAME_MS;
      if (now + 1.5 < nextFrameAt) return;
      // Advance by the budget, not from `now`, so displays that are not a
      // multiple of 60 Hz still average the target rate.
      nextFrameAt = Math.max(nextFrameAt + frameBudgetMs, now);
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
      const keyTurn = (keys.has("KeyA") || keys.has("ArrowLeft") ? 1 : 0) - (keys.has("KeyD") || keys.has("ArrowRight") ? 1 : 0);
      const keyClimb = (keys.has("KeyW") || keys.has("ArrowUp") ? 1 : 0) - (keys.has("KeyS") || keys.has("ArrowDown") ? 1 : 0);
      // Keys win when held; otherwise the touch stick supplies a continuous axis.
      let turn = active ? (keyTurn || pointerTurn) : 0;
      let climb = active ? (keyClimb || pointerClimb) : 0;
      const boost = active && (keys.has("ShiftLeft") || keys.has("ShiftRight"));
      const braking = active && (keys.has("ControlLeft") || keys.has("ControlRight") || keys.has("KeyQ"));

      // A committed landing flies itself: the bird banks onto the perch and trims
      // its sink so it arrives level with the rooftop instead of through it.
      let guidedSink: number | null = null;
      if (landingCommit && active) {
        perchDelta.copy(landingCommit.position).sub(crow.position);
        const flatDistance = Math.hypot(perchDelta.x, perchDelta.z);
        // horizontalForward is (-sin yaw, 0, -cos yaw), so the heading that points
        // at the perch inverts both components before the atan2.
        const desiredYaw = Math.atan2(-perchDelta.x, -perchDelta.z);
        const yawError = Math.atan2(Math.sin(desiredYaw - yaw), Math.cos(desiredYaw - yaw));
        turn = clamp(yawError * 1.9, -1, 1);
        climb = 0;
        // Spread the remaining height gap over however long the ground distance
        // will take at the current speed, so the descent is always on profile.
        const timeToPerch = Math.max(0.5, flatDistance / Math.max(speed, 6));
        guidedSink = clamp((perchDelta.y + 1.28) / timeToPerch, -18, 12);
      }

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
      // Keyboard climb is always ±1, so scaling by magnitude leaves key flight
      // untouched while giving the touch stick a genuinely proportional climb.
      const climbAmount = Math.abs(climb);
      const targetVerticalSpeed = !active
        ? (restingRef.current ? 0 : verticalSpeed)
        : guidedSink !== null
          ? guidedSink
          : climb > 0
            ? altitudeHeadroom <= 1
              ? 0
              : Math.max(
                  MIN_CEILING_CLIMB_SPEED,
                  (16 + speedAmountBeforeThrottle * 7) * ceilingClimbScale * climbAmount,
                )
            : climb < 0
              ? -19 * climbAmount
              : -0.65;
      const verticalResponse = guidedSink !== null
        ? 3.1
        : climb === 0
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
      const cruiseTarget = (boost ? BOOST_SPEED : CRUISE_SPEED) + diveEnergy - climbCost;
      // How deep into the approach envelope the bird is: 0 at the outer radius,
      // 1 once inside the flare. Holding BOOST opts out completely, so anyone who
      // wants to blow past a landmark at full speed still can.
      const approachBlend = active && approachPerch && !boost
        ? 1 - THREE.MathUtils.smoothstep(approachDistance, LANDING_FLARE_RADIUS, LANDING_APPROACH_RADIUS)
        : 0;
      // Inside the flare the bird keeps shedding speed all the way down to the
      // perch. This is the whole reason landing used to be so hard: nothing here
      // had any idea a perch was ahead, so cruise speed carried straight through
      // the capture sphere in about a second.
      const closeness = 1 - THREE.MathUtils.smoothstep(approachDistance, LANDMARK_LANDING_RADIUS, LANDING_FLARE_RADIUS);
      const flareTarget = THREE.MathUtils.lerp(
        landingCommit ? LANDING_COMMIT_SPEED : LANDING_APPROACH_SPEED,
        LANDING_FLARE_SPEED,
        closeness,
      );
      const assistedTarget = THREE.MathUtils.lerp(cruiseTarget, flareTarget, approachBlend);
      const targetSpeed = !active
        ? (restingRef.current ? 0 : speed)
        // Braking now bites below the old 18 m/s floor during an approach, so
        // manually flying a landing is rewarded rather than capped.
        : braking
          ? Math.min(BRAKE_SPEED, assistedTarget)
          : assistedTarget;
      const throttleResponse = braking ? 4.6 : boost ? 2.2 : THREE.MathUtils.lerp(1.55, 3.6, approachBlend);
      speed = THREE.MathUtils.lerp(speed, targetSpeed, 1 - Math.exp(-throttleResponse * dt));

      horizontalForward.set(-Math.sin(yaw), 0, -Math.cos(yaw));
      forward.set(horizontalForward.x, clamp(verticalSpeed / Math.max(speed, 1), -0.45, 0.45), horizontalForward.z).normalize();
      previousPosition.copy(crow.position);
      if (active) {
        crow.position.addScaledVector(horizontalForward, speed * dt);
        crow.position.y += verticalSpeed * dt;
        // The live wind already blows the rain and the clouds; letting it push the
        // bird too is what turns the weather readout into something you can feel.
        // Gusting is sampled from two detuned sines so it never repeats obviously.
        weatherVfx.readWind(windDrift);
        const gust = 1 + Math.sin(elapsedTime * 0.37) * 0.28 + Math.sin(elapsedTime * 1.13 + 2.1) * 0.14;
        // Higher air is windier, and a crow low between buildings is sheltered.
        const exposure = 0.35 + THREE.MathUtils.smoothstep(crow.position.y, 40, 420) * 0.65;
        crow.position.addScaledVector(windDrift, WIND_DRIFT_SCALE * gust * exposure * dt);
      }
      // Deliberately no title-screen drift or yaw wander. The camera orbit below
      // supplies all the motion, and moving the bird here would quietly walk a
      // shared ?lat/?lon/?yaw link off its spot while the map finished loading.
      const buildingAt = (x: number, y: number, z: number) => {
        for (const building of collisionCandidates(buildingColliderGrid, x, z)) {
          if (
            Math.abs(x - building.x) < building.halfWidth &&
            Math.abs(z - building.z) < building.halfDepth &&
            y < building.top + 5.5
          ) {
            return building;
          }
        }
        return null;
      };
      const struckBuilding = restingRef.current
        ? null
        : buildingAt(crow.position.x, crow.position.y, crow.position.z);
      // A committed landing has to be able to cross the parapet of the very roof
      // it is aiming at — otherwise the bird bounces off the building it is
      // trying to sit on. Waive only the collider that actually holds the target
      // perch; every other building in the city still stops it dead.
      const landingThrough = struckBuilding !== null && landingCommit !== null
        && Math.abs(landingCommit.position.x - struckBuilding.x) < struckBuilding.halfWidth + 2
        && Math.abs(landingCommit.position.z - struckBuilding.z) < struckBuilding.halfDepth + 2;
      if (struckBuilding && !landingThrough) {
        // Preserve any upward movement while rejecting the horizontal impact.
        // This lets takeoff clear a perch collider instead of restoring the
        // same below-roof position every frame and soft-locking the crow.
        // Passing the collider lets a glancing hit slide along the facade.
        resolveBuildingCollision(crow.position, previousPosition, struckBuilding);
        // Sliding preserves one axis, which at a concave corner can carry the
        // crow straight into the neighbouring footprint. Only keep the slide if
        // it actually landed in clear air; otherwise stop dead at the facade.
        if (buildingAt(crow.position.x, crow.position.y, crow.position.z)) {
          resolveBuildingCollision(crow.position, previousPosition);
        }
        pitch = Math.max(pitch, 0.15);
        verticalSpeed = Math.max(5, verticalSpeed);
        cameraKick = 0.7;
        // Clipping a facade used to *accelerate* the bird to 28 m/s, which fought
        // every landing flown at brake speed. Near a perch, keep the slow.
        speed = Math.max(approachPerch ? LANDING_FLARE_SPEED : 28, speed * 0.82);
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
      // Contact. A guided approach ends by settling rather than by the player
      // catching a window, so the landing lands.
      if (landingCommit && active && crow.position.distanceTo(landingCommit.position) < LANDING_CAPTURE_DISTANCE) {
        settleOnPerch(landingCommit);
        flightAudio.flap();
      }

      euler.set(-pitch, yaw, roll);
      targetQuat.setFromEuler(euler);
      crow.quaternion.slerp(targetQuat, 1 - Math.pow(0.83, dt * 60));
      if (!pausedRef.current && mixer && flapAction && glideAction && restAction) {
        const desiredRestWeight = restingRef.current ? 0.96 : 0;
        const restWeight = THREE.MathUtils.lerp(restAction.getEffectiveWeight(), desiredRestWeight, 1 - Math.pow(0.78, dt * 60));
        restAction.setEffectiveWeight(restWeight);
        restAction.timeScale = 0.55;
        const desiredFlapWeight = active ? (flapKick > 0 ? 0.96 : birdTraits.cruiseFlap) : 0;
        const flapWeight = THREE.MathUtils.lerp(flapAction.getEffectiveWeight(), desiredFlapWeight, 1 - Math.pow(0.8, dt * 60));
        flapAction.setEffectiveWeight(flapWeight);
        flapAction.timeScale = (flapKick > 0 ? 2.15 : 0.7) * birdTraits.flapRate;
        // Birds differ in leg length, so seat each one's own feet on the perch.
        if (birdModel) birdModel.position.y = birdTraits.restLift * restWeight;
        glideAction.setEffectiveWeight(Math.max(0, 1 - flapWeight - restWeight));
        glideAction.timeScale = 0.72;
        // Sound each wingbeat as the flap clip starts its downstroke, so what is
        // heard matches the wings: the kite barely beats, the parakeet never stops.
        const flapPhaseBefore = flapAction.time;
        mixer.update(dt);
        const flapPhase = flapAction.time;
        const crossedDownstroke = flapPhaseBefore <= flapPhase
          ? flapPhaseBefore < 0.42 && flapPhase >= 0.42
          : flapPhaseBefore < 0.42 || flapPhase >= 0.42;
        if (crossedDownstroke && flapWeight > 0.03 && restWeight < 0.5) flightAudio.wingbeat(0.35 + flapWeight * 0.65);
      }

      nearestPerch = null;
      let nearestDistance = Number.POSITIVE_INFINITY;
      // Approach targeting is deliberately limited to the named landmark perches.
      // Treetops are everywhere, and letting them grab the throttle would mean
      // the bird braking at random all the way across the city.
      approachPerch = null;
      approachDistance = 0;
      let approachScore = Number.POSITIVE_INFINITY;
      if (!restingRef.current && !pausedRef.current) {
        for (const perch of scene.userData.perches as Perch[]) {
          const distance = crow.position.distanceTo(perch.position);
          if (distance < LANDMARK_LANDING_RADIUS && distance < nearestDistance) {
            nearestPerch = perch;
            nearestDistance = distance;
          }
          if (distance >= LANDING_APPROACH_RADIUS || distance >= approachScore) continue;
          // Only count perches inside the forward cone, so flying past a rooftop
          // never triggers a flare — you have to actually be heading at it.
          perchFlat.copy(perch.position).sub(crow.position);
          perchFlat.y = 0;
          if (perchFlat.lengthSq() < 1e-4) {
            approachPerch = perch;
            approachScore = distance;
            continue;
          }
          if (perchFlat.normalize().dot(horizontalForward) < LANDING_APPROACH_COS) continue;
          approachPerch = perch;
          approachScore = distance;
        }
        // A committed landing owns the target until it lands or is waved off,
        // even if the bird swings wide enough to leave the cone mid-approach.
        if (landingCommit) {
          approachPerch = landingCommit;
          approachScore = crow.position.distanceTo(landingCommit.position);
        }
        approachDistance = approachPerch ? approachScore : 0;
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
      // The scene is built once, so HUD text written from the loop reads the
      // current language through a ref instead of a render.
      const locale = localeRef.current;
      const strings = STRINGS[locale];
      const perchName = (label: string) => placeName(locale, label);
      if (perchPromptRef.current && perchLabelRef.current) {
        const prompt = perchPromptRef.current;
        const range = perchRangeRef.current;
        if (restingRef.current) {
          prompt.dataset.visible = "true";
          prompt.dataset.state = "rest";
          perchLabelRef.current.textContent = strings.perchTakeOff;
          if (range) range.textContent = "";
        } else if (landingCommit) {
          prompt.dataset.visible = "true";
          prompt.dataset.state = "commit";
          perchLabelRef.current.textContent = fill(strings.perchLanding, { name: perchName(landingCommit.label) });
          if (range) range.textContent = fill(strings.perchRangeCancel, { distance: localDigits(locale, Math.round(approachDistance)) });
        } else if (nearestPerch) {
          prompt.dataset.visible = "true";
          prompt.dataset.state = "ready";
          perchLabelRef.current.textContent = fill(strings.perchLandAt, { name: perchName(nearestPerch.label) });
          if (range) range.textContent = "";
        } else if (approachPerch) {
          // Showing the closing range turns the approach into something the
          // player can fly deliberately instead of a prompt that blinks past.
          prompt.dataset.visible = "true";
          prompt.dataset.state = "approach";
          perchLabelRef.current.textContent = fill(strings.perchLandAt, { name: perchName(approachPerch.label) });
          if (range) range.textContent = fill(strings.perchRange, { distance: localDigits(locale, Math.round(approachDistance)) });
        } else {
          prompt.dataset.visible = "false";
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
        // Every ring in the city used to pulse identically, so nothing told you
        // which one you were actually lined up on. The targeted perch now runs a
        // faster, brighter, wider beat than the rest.
        const targetMarker = (landingCommit ?? approachPerch ?? nearestPerch)?.marker ?? null;
        for (const marker of scene.userData.perchMarkers as THREE.Group[]) {
          const focused = marker === targetMarker;
          const pulse = Math.sin(markerTime * (focused ? 4.2 : 1.8) + marker.userData.phase);
          const settled = restingRef.current;
          marker.position.y = marker.userData.baseY + (settled ? 0 : pulse * (focused ? 0.5 : 0.28));
          const markerScale = settled ? 0.86 : (focused ? 1.5 : 1) + pulse * (focused ? 0.16 : 0.08);
          marker.scale.setScalar(markerScale);
          marker.rotation.y += dt * (focused ? 0.9 : 0.18);
          for (const child of marker.children) {
            if (child instanceof THREE.Mesh && child.material instanceof THREE.MeshBasicMaterial) {
              const base = child.geometry.type === "CylinderGeometry"
                ? (settled ? 0.06 : 0.13 + (pulse + 1) * 0.035)
                : (settled ? 0.24 : 0.52 + (pulse + 1) * 0.08);
              child.material.opacity = focused ? Math.min(1, base * 1.75) : base;
            }
          }
        }
      }

      // Reuse one scratch vector: this block runs 60 times a second, and fresh
      // Vector3s here were the only per-frame garbage left in the hot loop.
      if (!flyingRef.current) {
        // Attract mode. The title screen used to hold a single frozen chase frame;
        // orbiting the drifting bird opens the game on a moving skyline instead,
        // and the lerp below turns BEGIN FLIGHT into a swoop down into the chase.
        // Picking a bird pulls the orbit in close for a few seconds, so the
        // choice shows itself before the camera drifts back out to the skyline.
        const orbit = elapsedTime * 0.085;
        birdPreview = THREE.MathUtils.lerp(birdPreview, elapsedTime < birdPreviewUntil ? 1 : 0, 1 - Math.pow(0.94, dt * 60));
        const orbitRadius = THREE.MathUtils.lerp(82, 13, birdPreview);
        desiredCamera.set(
          crow.position.x + Math.cos(orbit) * orbitRadius,
          crow.position.y + THREE.MathUtils.lerp(27 + Math.sin(orbit * 0.7) * 9, 4.5, birdPreview),
          crow.position.z + Math.sin(orbit) * orbitRadius,
        );
        desiredTarget.copy(crow.position);
      } else if (inspectionTarget) {
        cameraOffset.set(inspectionCameraOffset, Math.max(52, inspectionCameraOffset * 0.52), inspectionCameraOffset);
        desiredCamera.copy(inspectionTarget).add(cameraOffset);
        desiredTarget.copy(inspectionTarget);
      } else if (cameraModeRef.current === "CHASE") {
        const speedAmount = clamp((speed - BRAKE_SPEED) / (BOOST_SPEED - BRAKE_SPEED), 0, 1);
        const chaseDistance = 14.5 + speedAmount * 9;
        desiredCamera.copy(crow.position).addScaledVector(forward, -chaseDistance);
        desiredCamera.y += 6.4 - cameraKick * 1.5;
        desiredTarget.copy(crow.position).addScaledVector(forward, 13 + speedAmount * 10);
        desiredTarget.y += 1.4 + verticalSpeed * 0.08;
      } else {
        // The camera eases toward this point, so at speed it trails by a couple
        // of metres and ends up looking at the back of the bird's own head. Lead
        // the point by that lag so the view stays out in front of the bill.
        desiredCamera.copy(crow.position).addScaledVector(forward, 3.1 + speed * 0.059);
        desiredCamera.y += 1.2;
        desiredTarget.copy(crow.position).addScaledVector(forward, 42);
        desiredTarget.y += 1;
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

      if (speedRef.current) speedRef.current.textContent = localDigits(locale, Math.round(speed));
      if (altitudeRef.current) altitudeRef.current.textContent = localDigits(locale, Math.round(crow.position.y));
      if (verticalSpeedRef.current) verticalSpeedRef.current.textContent = localDigits(locale, `${verticalSpeed >= 0 ? "+" : ""}${verticalSpeed.toFixed(1)}`);
      if (flightModeRef.current) {
        // `data-mode` drives styling and stays in English whatever is displayed.
        const mode = braking ? "braking" : boost ? "surge" : verticalSpeed > 4 ? "climb" : verticalSpeed < -4 ? "dive" : speed < 30 ? "slow-glide" : "cruise";
        flightModeRef.current.textContent = strings[FLIGHT_MODE_KEYS[mode]];
        flightModeRef.current.dataset.mode = mode;
      }
      if (flightEffectRef.current) {
        const effectStrength = reducedMotion ? 0 : clamp((speedAmount - 0.38) * 1.35 + Math.abs(verticalSpeed) / 55, 0, 0.72);
        flightEffectRef.current.style.opacity = effectStrength.toFixed(3);
        flightEffectRef.current.style.transform = `translateY(${clamp(verticalSpeed * -0.32, -7, 7)}px) scale(${1 + effectStrength * 0.025})`;
      }
      flightAudio.setFlight(restingRef.current ? 0 : speed, crow.position.y, restingRef.current ? 0 : verticalSpeed);
      if (compassRef.current) {
        // Forward is (-sin yaw, 0, -cos yaw), so the true compass bearing
        // (clockwise from north) is -yaw — using +yaw mirrors east and west.
        const headings = strings.compassPoints.split(",");
        const bearing = ((-yaw % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
        const headingIndex = Math.round(bearing / (Math.PI / 4)) % 8;
        compassRef.current.textContent = headings[headingIndex];
      }
      if (mapBirdRef.current) {
        mapBirdRef.current.style.left = `${50 + clamp(crow.position.x / FLIGHT_EXTENT.x, -1, 1) * 43}%`;
        mapBirdRef.current.style.top = `${50 + clamp(crow.position.z / FLIGHT_EXTENT.z, -1, 1) * 43}%`;
        mapBirdRef.current.style.transform = `translate(-50%, -50%) rotate(${-yaw}rad)`;
      }
      hudFrame++;
      if (hudFrame % 15 === 0) {
        let area = shownArea;
        let areaDistance = Infinity;
        for (const point of areaPoints) {
          const distance = Math.hypot(point.world.x - crow.position.x, point.world.y - crow.position.z);
          if (distance < areaDistance) {
            areaDistance = distance;
            area = point.label;
          }
        }
        if (area !== shownArea) {
          shownArea = area;
          setAreaLabel(area);
        }
        let landmark = shownLandmark;
        let landmarkDistance = Infinity;
        for (const point of landmarkPoints) {
          const distance = Math.hypot(point.world.x - crow.position.x, point.world.y - crow.position.z);
          if (distance < landmarkDistance) {
            landmarkDistance = distance;
            landmark = point.label;
          }
        }
        if (landmark !== shownLandmark) {
          shownLandmark = landmark;
          setNearestLandmark(landmark);
        }
        if (landmarkRangeRef.current) {
          const range = landmarkDistance < 1_000
            ? fill(strings.perchRange, { distance: localDigits(locale, Math.round(landmarkDistance / 10) * 10) })
            : `${localDigits(locale, (landmarkDistance / 1_000).toFixed(1))} ${strings.unitKm}`;
          landmarkRangeRef.current.textContent = range;
        }
      }

      sky.position.copy(camera.position);
      // Shadow casters do still change — the crow moves, and district tiles are
      // shown and hidden below — so refresh on a slow cadence. At 1-in-12 frames
      // this keeps the crow's shadow tracking while costing a twelfth of the
      // shadow-pass fill of the default every-frame behaviour.
      shadowFrame++;
      if (shadowFrame % SHADOW_REFRESH_FRAMES === 0) requestShadowUpdate();
      renderer.render(scene, camera);
      diagnosticFrame++;
      if (diagnosticFrame % 30 === 0) {
        const districtTiles = scene.userData.proceduralDistrictTiles as ProceduralDistrictTile[] | undefined;
        const tileVisibilityRadius = scene.userData.proceduralTileVisibilityRadius as number | undefined;
        if (districtTiles && tileVisibilityRadius) {
          const visibilitySquared = tileVisibilityRadius ** 2;
          const visibilityAnchor = inspectionTarget ?? crow.position;
          let visibilityChanged = false;
          for (const tile of districtTiles) {
            const dx = tile.centerX - visibilityAnchor.x;
            const dz = tile.centerZ - visibilityAnchor.z;
            const visible = dx * dx + dz * dz < visibilitySquared;
            if (tile.group.visible !== visible) {
              tile.group.visible = visible;
              if (visible) scene.add(tile.group);
              else scene.remove(tile.group);
              visibilityChanged = true;
            }
          }
          // A tile appearing or disappearing adds or removes shadow casters.
          if (visibilityChanged) requestShadowUpdate();
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
      const devWindow = window as BirdFlightWindow & { __scene?: unknown; __renderer?: unknown; __THREE?: unknown };
      delete devWindow.__scene;
      delete devWindow.__renderer;
      delete devWindow.__THREE;
      delete (window as BirdFlightWindow & { __crowRig?: unknown }).__crowRig;
      focusLandmarkRef.current = () => false;
      relabelRef.current = () => {};
      loadBirdRef.current = () => {};
      birdLoadToken++;
      flightActionsRef.current = null;
      flightAudio.dispose();
      airflowVfx.dispose();
      weatherVfx.dispose();
      weatherController.abort();
      window.clearInterval(weatherRefresh);
      setSkyHourRef.current = () => {};
      audioRef.current = null;
      cancelAnimationFrame(animation);
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("blur", clearFlightControls);
      document.removeEventListener("visibilitychange", onVisibilityChange);
      window.removeEventListener("orientationchange", applyViewportSize);
      reducedMotionQuery.removeEventListener("change", onReducedMotionChange);
      resizeObserver.disconnect();
      // Materials hold GPU textures (canvas ground, sprite labels, window atlases)
      // that survive material.dispose() unless released explicitly, and Sprites are
      // not Meshes so the old Mesh-only walk skipped every label in the scene.
      const releaseMaterial = (material: THREE.Material) => {
        for (const value of Object.values(material)) {
          if (value instanceof THREE.Texture) value.dispose();
        }
        material.dispose();
      };
      // Detached district tiles still own GPU resources: reattach them so the
      // walk below releases those too.
      for (const tile of (scene.userData.proceduralDistrictTiles as ProceduralDistrictTile[] | undefined) ?? []) scene.add(tile.group);
      scene.traverse((object) => {
        if (object instanceof THREE.Mesh || object instanceof THREE.Points || object instanceof THREE.Line) {
          object.geometry.dispose();
        }
        const material = (object as Partial<THREE.Mesh>).material;
        if (!material) return;
        if (Array.isArray(material)) material.forEach(releaseMaterial);
        else releaseMaterial(material);
      });
      scene.clear();
      renderer.dispose();
      // Hand the WebGL context back immediately; browsers cap live contexts and
      // silently kill the oldest one when a remount allocates another.
      renderer.forceContextLoss();
      renderer.domElement.remove();
    };
  }, []);

  // Stable identities: TouchStick holds these in effects and would otherwise
  // re-register (and zero the axes) on every parent render.
  const setFlightAxes = useCallback((turn: number, climb: number) => {
    flightActionsRef.current?.setAxes(turn, climb);
  }, []);
  const holdFlightKey = useCallback((code: string, held: boolean) => {
    flightActionsRef.current?.setHold(code, held);
  }, []);
  const releaseInspectionCamera = useCallback(() => {
    flightActionsRef.current?.releaseInspection();
  }, []);
  const chooseSkyPreset = useCallback((preset: SkyPreset) => {
    setChosenSkyPresetId(preset.id);
    setSkyHourRef.current(preset.hour);
  }, []);

  // The spawn parameters have always worked; nothing ever produced one. This
  // turns the current spot in the sky into a link somebody else can open.
  const shareView = useCallback(async () => {
    const view = flightActionsRef.current?.readView();
    if (!view) return;
    const url = new URL(window.location.href);
    url.search = "";
    url.searchParams.set("lat", view.lat.toFixed(5));
    url.searchParams.set("lon", view.lon.toFixed(5));
    url.searchParams.set("alt", Math.round(view.alt).toString());
    url.searchParams.set("yaw", view.yaw.toFixed(3));
    if (skyPresetId !== "live") url.searchParams.set("sky", skyPresetId);
    const link = url.toString();
    try {
      await navigator.clipboard.writeText(link);
      setShareState("copied");
    } catch {
      // Clipboard access is denied in some browsers and every insecure origin.
      setShareState("failed");
      setSharedLink(link);
    }
  }, [skyPresetId]);

  useEffect(() => {
    if (shareState !== "copied") return;
    const timer = window.setTimeout(() => setShareState("idle"), 2_600);
    return () => window.clearTimeout(timer);
  }, [shareState]);

  const beginFlight = useCallback(async () => {
    flyingRef.current = true;
    pausedRef.current = false;
    restingRef.current = false;
    setFlying(true);
    setPaused(false);
    setResting(false);
    setMenuOpen("");
    setHudOpen("");
    // The painted sky fades out over the swoop down into the chase camera.
    setTitleLeaving(true);
    window.setTimeout(() => setTitleLeaving(false), 900);
    setSoundOn(await audioRef.current?.start() ?? false);
  }, []);

  const chooseLaunchSite = useCallback((site: (typeof LAUNCH_SITES)[number]) => {
    setLaunchSiteId(site.id);
    flightActionsRef.current?.spawnAt(site.lat, site.lon, site.alt);
  }, []);

  // Press-start, the way a flight-sim title screen answers. On the title any key
  // brings up the menu; on the menu Enter or Space takes off without reaching
  // for the mouse. The focus guard leaves keys to a focused control, so Enter
  // on a tile opens that tile instead of taking off.
  useEffect(() => {
    if (flying) return;
    const onTitleKey = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      if (["Shift", "Control", "Alt", "Meta"].includes(event.key)) return;
      if (focusedControlClaim(event.target) !== "none") return;
      if (titleBeat === "title") {
        if (event.code === "Space" || event.code === "Enter") event.preventDefault();
        setTitleBeat("menu");
        return;
      }
      if (event.code !== "Enter" && event.code !== "Space") return;
      if (menuOpen) return;
      event.preventDefault();
      void beginFlight();
    };
    window.addEventListener("keydown", onTitleKey);
    return () => window.removeEventListener("keydown", onTitleKey);
  }, [flying, beginFlight, menuOpen, titleBeat]);

  // I, M and ? open the place, map and readout panels; H hides everything.
  useEffect(() => {
    if (!flying || paused) return;
    const onHudKey = (event: KeyboardEvent) => {
      if (event.repeat || event.metaKey || event.ctrlKey || event.altKey) return;
      if (focusedControlClaimsKey(focusedControlClaim(event.target), event.code)) return;
      const panel = event.code === "KeyI" ? "place" : event.code === "KeyM" ? "map" : event.key === "?" ? "readout" : null;
      if (panel) {
        event.preventDefault();
        setHudHidden(false);
        setHudOpen((open) => (open === panel ? "" : panel));
        return;
      }
      if (event.code === "KeyH") {
        event.preventDefault();
        setHudOpen("");
        setHudHidden((hidden) => !hidden);
      }
    };
    window.addEventListener("keydown", onHudKey);
    return () => window.removeEventListener("keydown", onHudKey);
  }, [flying, paused]);

  // The chrome steps back while you fly: after four seconds without input the
  // closed controls fade, and any movement brings them back.
  useEffect(() => {
    if (!flying) return;
    let timer = window.setTimeout(() => setHudIdle(true), 4_000);
    const wake = () => {
      setHudIdle(false);
      window.clearTimeout(timer);
      timer = window.setTimeout(() => setHudIdle(true), 4_000);
    };
    const events = ["pointermove", "pointerdown", "keydown"] as const;
    for (const name of events) window.addEventListener(name, wake, { passive: true });
    return () => {
      window.clearTimeout(timer);
      for (const name of events) window.removeEventListener(name, wake);
    };
  }, [flying]);

  // A phone's map and settings sheets cover most of the screen, so they hold
  // the flight still while they are open and let it go when they close.
  const sheetOpen = touchDevice && flying && !paused && (hudOpen === "map" || hudOpen === "more");
  useEffect(() => {
    if (!sheetOpen || pausedRef.current) return;
    pausedRef.current = true;
    sheetHoldRef.current = true;
    audioRef.current?.pause();
    return () => {
      // A real pause taken while the sheet was up keeps the flight stopped.
      if (!sheetHoldRef.current) return;
      sheetHoldRef.current = false;
      pausedRef.current = false;
      audioRef.current?.resume();
    };
  }, [sheetOpen]);

  const toggleSound = async () => {
    const enabled = await audioRef.current?.toggle() ?? false;
    if (pausedRef.current && enabled) audioRef.current?.pause();
    setSoundOn(enabled);
  };

  const togglePause = () => {
    if (!flyingRef.current) return;
    if (sheetHoldRef.current) {
      // Turn the sheet's hold into a real pause rather than releasing it.
      sheetHoldRef.current = false;
      setHudOpen("");
      setPaused(true);
      return;
    }
    const nextPaused = !pausedRef.current;
    pausedRef.current = nextPaused;
    setPaused(nextPaused);
    if (nextPaused) {
      setHudOpen("");
      audioRef.current?.pause();
    } else audioRef.current?.resume();
  };

  const openSettings = () => {
    togglePause();
    setHudOpen("more");
  };

  // Back to the title, with the bird left where it is so the menu can change
  // the bird, the place or the sky before the next take-off.
  const backToStart = () => {
    if (restingRef.current) flightActionsRef.current?.togglePerch();
    flightActionsRef.current?.releaseInspection();
    sheetHoldRef.current = false;
    flyingRef.current = false;
    pausedRef.current = false;
    restingRef.current = false;
    audioRef.current?.pause();
    setFlying(false);
    setPaused(false);
    setResting(false);
    setHudOpen("");
    setHudHidden(false);
    setTitleBeat("menu");
  };

  const toggleHud = (panel: Exclude<typeof hudOpen, "">) => setHudOpen((open) => (open === panel ? "" : panel));

  // A click on the open sky closes whatever panel is up, as Escape does.
  const closeOnScene = (event: ReactPointerEvent<HTMLElement>) => {
    const target = event.target as Element;
    if (!flying) {
      if (menuOpen && !target.closest(".menu-w")) setMenuOpen("");
      return;
    }
    if (hudOpen && !target.closest(".hud-w, .touch-controls, .perch-prompt, .inspect-exit")) setHudOpen("");
  };

  const selectedBird = birdById(birdId);
  const otherLocale: Locale = locale === "bn" ? "en" : "bn";
  const selectedSite = LAUNCH_SITES.find((site) => site.id === launchSiteId) ?? null;
  const selectedSky = SKY_PRESETS.find((preset) => preset.id === skyPresetId) ?? SKY_PRESETS[0];
  const skyName = (id: string) => t[SKY_PRESET_KEYS[id]] ?? id;
  const skyNote = (id: string) => t[SKY_NOTE_KEYS[id]] ?? "";
  const areaName = areaLabel ? placeName(locale, areaLabel) : t.launchAnywhere;
  const weatherIconKey = weatherIconName(weather.mode, skyIsDay);
  // Night and dusk skies get the dusk painting; every other hour opens at dawn.
  const titleArt = skyPresetId === "dusk" || skyPresetId === "night" || (skyPresetId === "live" && !skyIsDay) ? "dusk" : "dawn";
  const temperature = `${localDigits(locale, Math.round(weather.temperature))}°`;
  const radioActive = radioStatus === "playing" || radioStatus === "buffering";
  const radioStateText = radioStatus === "playing" ? t.radioStatePlaying : radioStatus === "buffering" ? t.radioStateTuning : radioStatus === "paused" ? t.radioStatePaused : radioStatus === "error" ? t.radioStateLost : t.radioStateOff;
  const flightKeys: Array<[string[], string]> = [[["W", "S"], t.hintClimbDive], [["A", "D"], t.hintBank], [["Space"], t.hintFlap], [["Ctrl", "Q"], t.hintBrakeKey], [["Shift"], t.hintBoostKey], [["E"], t.hintLand]];
  const hudKeys: Array<[string[], string]> = [[["I"], t.keyPlace], [["M"], t.keyMap], [["C"], t.keyCamera], [["L"], t.keyLandmarks], [["R", "[", "]"], t.keyRadio], [["H"], t.keyHide], [["Esc"], t.keyEsc]];
  const keyRow = (list: Array<[string[], string]>) => (
    <div className="hud-keys">
      {list.map(([caps, label]) => (
        <span key={caps.join("")}>{caps.map((cap) => <kbd key={cap} lang="en">{cap}</kbd>)}{label}</span>
      ))}
    </div>
  );
  const panelHead = (title: string) => (
    <div className="hud-head">
      <h2>{title}</h2>
      <button type="button" className="hud-x" onClick={() => setHudOpen("")} aria-label={t.panelClose}><HudIcon name="close" /></button>
    </div>
  );
  const sheetNote = touchDevice ? <p className="sheet-paused"><HudIcon name="pause" />{t.sheetPaused}</p> : null;
  const mapPosition = (lat: number, lon: number) => {
    const world = coordinatesToWorld(lat, lon);
    return {
      left: `${50 + clamp(world.x / FLIGHT_EXTENT.x, -1, 1) * 43}%`,
      top: `${50 + clamp(world.y / FLIGHT_EXTENT.z, -1, 1) * 43}%`,
    };
  };
  const menuTile = (id: "bird" | "site" | "sky", label: string, value: ReactNode, sub: string, list: ReactNode) => (
    <div className={`menu-w menu-${id}${menuOpen === id ? " open" : ""}`}>
      <button
        type="button"
        className="menu-tile"
        aria-expanded={menuOpen === id}
        aria-controls={`menu-list-${id}`}
        onClick={() => setMenuOpen((open) => (open === id ? "" : id))}
      >
        <span className="tile-k">{label}</span>
        <span className="tile-v">{value}</span>
        <span className="tile-s">{sub}</span>
        <HudIcon name="chev" className="hud-chev" />
      </button>
      <div className="menu-list" id={`menu-list-${id}`} role="group" aria-label={label}>{list}</div>
    </div>
  );

  const shellClass = [
    "flight-shell",
    flying ? "in-flight" : "on-title",
    paused ? "is-paused" : "",
    hudOpen ? "has-open" : "",
    hudHidden ? "hud-hidden" : "",
    hudIdle && !hudOpen ? "hud-idle" : "",
    sheetOpen ? "sheet-open" : "",
  ].filter(Boolean).join(" ");

  return (
    <main className={shellClass} lang={locale} onPointerDown={closeOnScene}>
      <div ref={mountRef} className="world" aria-label={t.worldLabel} />
      <div className="atmosphere" data-weather={weather.mode} data-daylight={skyIsDay ? "day" : "night"} />
      <div ref={flightEffectRef} className="flight-dynamics" aria-hidden="true" />

      {(!flying || titleLeaving) && (
        <section
          className={`title-screen beat-${titleBeat}${flying ? " leaving" : ""}`}
          aria-label={t.titleScreen}
          onClick={(event) => {
            if (titleBeat === "title" && !(event.target as Element).closest("button, a")) setTitleBeat("menu");
          }}
        >
          <div className="title-sky" data-art={titleArt} aria-hidden="true" />
          <div className="title-shade" aria-hidden="true" />
          <div className="title-top">
            <span className="title-mark"><HudIcon name="brand" className="brand-icon" />{t.titleNameA} {t.titleNameB}</span>
            <span className={`title-live ${mapStatus}`} role="status">
              <i data-weather={weatherStatus} />
              {mapStatus === "loading"
                ? t.loadLoading
                : `${skyPresetId === "live" ? t.liveSky : skyName(skyPresetId)} · ${weatherLabel(locale, weather.label)} · ${temperature}`}
            </span>
            <button type="button" className="hud-chip" lang={otherLocale} onClick={() => chooseLocale(otherLocale)}>
              <HudIcon name="lang" />{otherLocale === "bn" ? "বাংলা" : "English"}
            </button>
            <button type="button" className="hud-chip icon" onClick={toggleSound} aria-label={soundOn ? t.soundMute : t.soundEnable} aria-pressed={soundOn}>
              <HudIcon name={soundOn ? "sound" : "mute"} />
            </button>
          </div>

          <div className="title-hero" aria-hidden={titleBeat === "menu"}>
            <h1 className="title-name"><span>{t.titleNameA}</span> <span>{t.titleNameB}</span></h1>
            <p>{t.titleTagline}</p>
            <button type="button" className="title-any" onClick={() => setTitleBeat("menu")} aria-label={t.titleWake}>
              {touchDevice ? t.titleTap : t.titlePressKey}
            </button>
          </div>

          <div className="title-menu" aria-hidden={titleBeat === "title"} inert={titleBeat === "title"}>
            <div className="menu-title">
              <h1 className="title-name"><span>{t.titleNameA}</span> <span>{t.titleNameB}</span></h1>
              <p>{selectedSite ? fill(t.menuSummary, { bird: t[selectedBird.name], place: placeName(locale, selectedSite.label) }) : fill(t.menuSummaryAnywhere, { bird: t[selectedBird.name] })}</p>
            </div>
            <div className="menu-bar">
              <button type="button" className="menu-tile go" onClick={beginFlight}>
                <span className="tile-k">{t.menuFreeFlight}</span>
                <span className="tile-v">{t.startFlight}</span>
                {!touchDevice && <kbd lang="en">{t.startKeyHint}</kbd>}
              </button>
              {menuTile(
                "bird",
                t.menuBird,
                <><i className="tile-swatch" style={{ background: selectedBird.swatch[0] }} />{t[selectedBird.name]}</>,
                STRINGS[otherLocale][selectedBird.name],
                BIRDS.map((bird) => (
                  <MenuOption key={bird.id} selected={bird.id === birdId} name={t[bird.name]} note={t[bird.note]} swatch={bird.swatch[0]} onChoose={() => {
                    chooseBird(bird.id);
                    setMenuOpen("");
                  }} />
                )),
              )}
              {menuTile(
                "site",
                t.menuStart,
                <><HudIcon name="pin" />{selectedSite ? placeName(locale, selectedSite.label) : t.launchAnywhere}</>,
                selectedSite ? placeName(otherLocale, selectedSite.label) : t.launchAnywhereNote,
                LAUNCH_SITES.map((site) => (
                  <MenuOption key={site.id} selected={site.id === launchSiteId} name={placeName(locale, site.label)} note={placeName(otherLocale, site.label)} onChoose={() => {
                    chooseLaunchSite(site);
                    setMenuOpen("");
                  }} />
                )),
              )}
              {menuTile(
                "sky",
                t.menuSky,
                <><HudIcon name={selectedSky.id === "live" ? weatherIconKey : selectedSky.id === "dusk" || selectedSky.id === "night" ? "moon" : "sun"} />{skyName(selectedSky.id)}</>,
                skyNote(selectedSky.id),
                SKY_PRESETS.map((preset) => (
                  <MenuOption key={preset.id} selected={preset.id === skyPresetId} name={skyName(preset.id)} note={skyNote(preset.id)} onChoose={() => {
                    chooseSkyPreset(preset);
                    setMenuOpen("");
                  }} />
                )),
              )}
            </div>
          </div>
        </section>
      )}

      {flying && (
        <div className="hud" aria-hidden={paused}>
          {/* Top left: where you are, the weather, the sky and the radio. */}
          <div className={`hud-w hud-place${hudOpen === "place" ? " open" : ""}`}>
            <button type="button" className="hud-chip" onClick={() => toggleHud("place")} aria-expanded={hudOpen === "place"} aria-controls="hud-place" aria-label={t.placeOpen}>
              <HudIcon name="pin" />
              <span>{areaName}</span>
              <i className="chip-sep" />
              <HudIcon name={weatherIconKey} />
              <span className="num">{temperature}</span>
              {radioActive && <span className="eq" aria-hidden="true"><i /><i /><i /></span>}
              <HudIcon name="chev" className="hud-chev" />
            </button>
            <div className="hud-panel" id="hud-place" role="dialog" aria-label={fill(t.placeOver, { place: areaName })}>
              {panelHead(fill(t.placeOver, { place: areaName }))}
              <div className="wx-line">
                <span><HudIcon name={weatherIconKey} /><b>{weatherLabel(locale, weather.label)}</b> <b className="num">{temperature}</b></span>
                <span>{fill(t.placeFeels, { temperature: localDigits(locale, Math.round(weather.apparentTemperature)) })}</span>
                <span>{fill(t.placeWind, { wind: localDigits(locale, Math.round(weather.windSpeed)) })}</span>
              </div>
              <div className="hud-label">{t.menuSky}</div>
              <div className="hud-seg three" role="group" aria-label={t.skyPresets}>
                {SKY_PRESETS.map((preset) => (
                  <button key={preset.id} type="button" className={preset.id === skyPresetId ? "selected" : ""} aria-pressed={preset.id === skyPresetId} onClick={() => chooseSkyPreset(preset)}>
                    {skyName(preset.id)}
                  </button>
                ))}
              </div>
              <p className="hud-note">{skyPresetId === "live" ? t.skyLiveHint : t.skyHeldHint}</p>
              <div className="hud-label">{t.radioTitle}</div>
              <div className={`radio-row ${radioStatus}`}>
                {radioActive ? <span className="eq" aria-hidden="true"><i /><i /><i /></span> : <i className="radio-dot" aria-hidden="true" />}
                <span className="radio-station" aria-live="polite">
                  <b>{selectedStationText.name}</b>
                  <small><span className="num">{frequencyText(locale, selectedRadioStation.frequency)}</span> · {radioStateText}</small>
                </span>
                <button type="button" className="radio-btn" onClick={() => cycleRadio(-1)} aria-label={t.radioPrevious}><HudIcon name="prev" /></button>
                <button type="button" className="radio-btn main" onClick={toggleRadio} aria-label={radioStatus === "off" || radioStatus === "error" ? t.radioPlayStation : t.radioTurnOff}>
                  <HudIcon name={radioStatus === "off" || radioStatus === "error" ? "play" : "pause"} />
                </button>
                <button type="button" className="radio-btn" onClick={() => cycleRadio(1)} aria-label={t.radioNext}><HudIcon name="next" /></button>
              </div>
              <label className="hud-range">
                <HudIcon name="sound" />
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
                  aria-label={t.radioVolume}
                />
                {selectedRadioStation.homepage && <a href={selectedRadioStation.homepage} target="_blank" rel="noreferrer">{t.radioWebsite}</a>}
              </label>
              <div className="hud-rule" />
              <button type="button" className={`hud-btn share-view ${shareState}`} onClick={shareView}>
                <HudIcon name="share" />
                {shareState === "copied" ? t.shareCopied : shareState === "failed" ? t.shareFailed : t.share}
              </button>
              {shareState === "failed" && (
                <label className="share-fallback">
                  <span>{t.shareFallback}</span>
                  <input readOnly value={sharedLink} onFocus={(event) => event.target.select()} aria-label={t.shareLink} />
                </label>
              )}
            </div>
          </div>

          {/* Top right: pause, and everything else. */}
          <div className={`hud-w hud-more${hudOpen === "more" ? " open" : ""}`}>
            <button type="button" className="hud-chip icon" onClick={togglePause} aria-label={t.flightPause}><HudIcon name="pause" /></button>
            <button type="button" className="hud-chip icon" onClick={() => toggleHud("more")} aria-expanded={hudOpen === "more"} aria-controls="hud-more" aria-label={t.moreOpen}><HudIcon name="more" /></button>
            <div className="hud-panel" id="hud-more" role="dialog" aria-label={t.moreTitle}>
              {touchDevice && <div className="sheet-grab" aria-hidden="true" />}
              {panelHead(t.moreTitle)}
              {sheetNote}
              <div className="hud-label first">{t.language}</div>
              <div className="hud-seg" role="group" aria-label={t.language}>
                {(["en", "bn"] as const).map((code) => (
                  <button key={code} type="button" lang={code} className={code === locale ? "selected" : ""} aria-pressed={code === locale} onClick={() => chooseLocale(code)}>
                    {code === "bn" ? "বাংলা" : "English"}
                  </button>
                ))}
              </div>
              <div className="hud-label">{t.camera}</div>
              <div className="hud-seg" role="group" aria-label={t.camera}>
                {(["CHASE", "BIRD'S EYE"] as const).map((mode) => (
                  <button key={mode} type="button" className={mode === cameraMode ? "selected" : ""} aria-pressed={mode === cameraMode} onClick={() => {
                    if (mode !== cameraMode) flightActionsRef.current?.toggleCamera();
                  }}>
                    {mode === "CHASE" ? t.cameraChase : t.cameraBirdsEye}
                  </button>
                ))}
              </div>
              <div className="hud-rule" />
              <button type="button" className="hud-row" role="switch" aria-checked={soundOn} onClick={toggleSound}>
                <span>{t.soundPanel}</span>
                <span className={`hud-toggle${soundOn ? " on" : ""}`} aria-hidden="true" />
              </button>
              <label className="hud-range">
                <HudIcon name={soundOn ? "sound" : "mute"} />
                <input
                  type="range"
                  min="0"
                  max="1.5"
                  step="0.05"
                  value={soundVolume}
                  onChange={(event) => changeSoundVolume(Number(event.target.value))}
                  aria-label={t.soundVolume}
                  aria-valuetext={`${Math.round(soundVolume * 100)}%`}
                />
                <span className="num">{localDigits(locale, Math.round(soundVolume * 100))}%</span>
              </label>
              <div className="hud-rule" />
              {!touchDevice && (
                <button type="button" className="hud-btn" onClick={() => setHudOpen("readout")}>
                  <HudIcon name="help" />{t.controlsTitle}<kbd lang="en">?</kbd>
                </button>
              )}
              <button type="button" className="hud-btn" onClick={backToStart}><HudIcon name="home" />{t.backToStart}</button>
            </div>
          </div>

          {/* Bottom left: speed and height, opening into the full readout. */}
          <div className={`hud-w hud-readout${hudOpen === "readout" ? " open" : ""}`}>
            <div className="readout-card" role={hudOpen === "readout" ? "dialog" : undefined} aria-label={t.telemetry}>
              {hudOpen === "readout" && (
                <div className="hud-head">
                  <h2>
                    <i className="tile-swatch" style={{ background: selectedBird.swatch[0] }} />
                    {t[selectedBird.name]}
                    <span className="flight-mode"><i /><span ref={flightModeRef} data-mode="cruise">{t.modeCruise}</span></span>
                  </h2>
                  <button type="button" className="hud-x" onClick={() => setHudOpen("")} aria-label={t.panelClose}><HudIcon name="close" /></button>
                </div>
              )}
              <button type="button" className="readout-chip" onClick={() => toggleHud("readout")} aria-expanded={hudOpen === "readout"} aria-label={t.readoutOpen}>
                <span className="tele"><b ref={speedRef} className="num">{localDigits(locale, 48)}</b><small>{t.unitSpeed}</small></span>
                <i className="chip-sep" />
                <span className="tele"><b ref={altitudeRef} className="num">{localDigits(locale, DEFAULT_FLIGHT_ALTITUDE)}</b><small>{t.unitAltitude}</small></span>
                {hudOpen === "readout" && (
                  <>
                    <span className="tele small"><b ref={verticalSpeedRef} className="num">{localDigits(locale, "+0.0")}</b><small>{t.unitVertical}</small></span>
                    <span className="tele compass" title={t.unitHeading}><b ref={compassRef}>{t.minimapNorth}</b></span>
                  </>
                )}
                <HudIcon name="chev" className="hud-chev" />
              </button>
              {hudOpen === "readout" && (
                <div className="readout-more">
                  {touchDevice
                    ? <p className="hud-note">{t.touchNote}</p>
                    : <>{keyRow(flightKeys)}<div className="hud-rule" />{keyRow(hudKeys)}</>}
                  <a className="sound-credits" href="/audio/CREDITS.txt" target="_blank" rel="noreferrer">{t.soundCredits}</a>
                </div>
              )}
            </div>
          </div>

          {/* Bottom right: a map dial that opens into the full map. The map is
              drawn once; the dial and the panel are two sizes of the same thing. */}
          <div className={`hud-w hud-map${hudOpen === "map" ? " open" : ""}`} data-daylight={skyIsDay ? "day" : "night"}>
            <div className="map-card" role={hudOpen === "map" ? "dialog" : undefined} aria-label={t.mapTitle}>
              {hudOpen === "map" && (
                <>
                  {touchDevice && <div className="sheet-grab" aria-hidden="true" />}
                  {panelHead(t.mapTitle)}
                  {sheetNote}
                </>
              )}
              <div className="minimap" aria-label={t.minimap}>
                <div className="map-canvas">
                  <span className="north">{t.minimapNorth}</span>
                  <div className="map-water one" /><div className="map-water two" />
                  <div className="map-road" />
                  {AREA_LANDMARKS.filter((landmark) => landmark.minimap).map((landmark) => (
                    <span key={landmark.label} className="map-area" lang="en" title={placeName(locale, landmark.label)} style={mapPosition(landmark.lat, landmark.lon)}>{landmark.shortLabel}</span>
                  ))}
                  {DHAKA_LANDMARKS.filter((landmark) => landmark.minimap).map((landmark) => (
                    <button
                      type="button"
                      key={landmark.label}
                      className="map-landmark"
                      lang="en"
                      title={placeName(locale, landmark.label)}
                      aria-label={fill(t.inspectLandmark, { name: placeName(locale, landmark.label) })}
                      tabIndex={hudOpen === "map" ? 0 : -1}
                      onClick={() => focusLandmarkRef.current(landmark.kind)}
                      style={mapPosition(landmark.lat, landmark.lon)}
                    >{landmark.shortLabel}</button>
                  ))}
                  {WATER_LANDMARKS.filter((landmark) => landmark.minimap).map((landmark) => (
                    <span key={landmark.label} className="map-river" lang="en" title={placeName(locale, landmark.label)} style={mapPosition(landmark.lat, landmark.lon)}>{landmark.shortLabel}</span>
                  ))}
                  <div ref={mapBirdRef} className="map-bird" />
                </div>
                {hudOpen !== "map" && <button type="button" className="map-dial-hit" onClick={() => toggleHud("map")} aria-expanded={false} aria-label={t.mapOpen} />}
              </div>
              {hudOpen === "map" && (
                <>
                  <p className="map-near">
                    <HudIcon name="pin" />{t.mapNearest}: <b>{nearestLandmark ? placeName(locale, nearestLandmark) : "…"}</b> <span ref={landmarkRangeRef} className="num" />
                  </p>
                  <p className="hud-note">{touchDevice ? t.mapHintTouch : t.mapHint}</p>
                  <p className={`map-source ${mapStatus}`}>
                    {mapStatus === "live" ? t.mapSourceLive : mapStatus === "loading" ? t.mapSourceLoading : t.mapSourceFallback}
                    <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">{t.mapAttribution}</a>
                  </p>
                </>
              )}
            </div>
            {hudOpen !== "map" && <a className="hud-credit" href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">© OpenStreetMap</a>}
          </div>

          <div ref={perchPromptRef} className="perch-prompt" data-visible="false" data-state="approach" role="status">
            <kbd lang="en">E</kbd><span ref={perchLabelRef}>{t.perchLand}</span><i ref={perchRangeRef} className="perch-range num" />
          </div>
          {inspecting && (
            <button type="button" className="inspect-exit hud-chip" onClick={releaseInspectionCamera}>
              <span>{t.inspecting}</span><b>{t.inspectReturn}</b>
            </button>
          )}

          {touchDevice && (
            <section className="touch-controls" aria-label={t.touchControls}>
              <TouchStick onAxes={setFlightAxes} label={t.touchStick} />
              <div className="touch-actions">
                <div className="touch-action-row">
                  <button type="button" className="touch-button touch-secondary" aria-label={t.touchCameraHint} onClick={() => flightActionsRef.current?.toggleCamera()}>{t.touchCamera}</button>
                  <button type="button" className="touch-button touch-secondary" aria-label={t.touchSitesHint} onClick={() => flightActionsRef.current?.cycleInspection()}>{t.touchSites}</button>
                  <button type="button" className="touch-button touch-land" aria-label={t.touchLandHint} onClick={() => flightActionsRef.current?.togglePerch()}>{resting ? t.touchFly : t.touchLand}</button>
                </div>
                <div className="touch-action-row">
                  <TouchHoldButton label={t.touchBrake} hint={t.touchBrakeHint} onHold={(held) => holdFlightKey("KeyQ", held)} />
                  <TouchHoldButton label={t.touchBoost} hint={t.touchBoostHint} className="touch-boost" onHold={(held) => holdFlightKey("ShiftLeft", held)} />
                </div>
                <button type="button" className="touch-button touch-flap" aria-label={t.touchFlapHint} onPointerDown={() => flightActionsRef.current?.flap()}>{t.touchFlap}</button>
              </div>
            </section>
          )}
        </div>
      )}

      {flying && paused && (
        <section className="pause-overlay" role="dialog" aria-modal="true" aria-label={t.pauseDialog}>
          <h2>{t.pauseTitle}</h2>
          <p>{fill(t.pauseBody, { place: areaName })}</p>
          <button ref={resumeButtonRef} type="button" className="commit-button" onClick={togglePause}>
            <span>{t.pauseResume}</span>{!touchDevice && <kbd lang="en">Esc</kbd>}
          </button>
          <div className="pause-links">
            <button type="button" onClick={openSettings}>{t.pauseSettings}</button>
            <button type="button" onClick={backToStart}>{t.backToStart}</button>
          </div>
        </section>
      )}

      {/* The flight is entirely visual, so state changes are announced here for
          anyone who cannot see the HUD change. */}
      <p className="visually-hidden" role="status">
        {!flying
          ? t.statusReady
          : paused
            ? t.statusPaused
            : hudHidden
              ? t.hudHidden
              : resting
                ? t.statusResting
                : mapStatus === "live" ? t.statusFlyingLive : mapStatus === "loading" ? t.statusFlyingLoading : t.statusFlyingFallback}
      </p>
    </main>
  );
}
