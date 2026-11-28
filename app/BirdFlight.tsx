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
  ELEVATED_ROAD_GROUND,
  ELEVATED_ROAD_PIER_KEEP_OUT,
  ELEVATED_ROAD_STYLES,
  ELEVATED_ROAD_TRIM_WAY_IDS,
  ELEVATED_ROAD_WAY_IDS,
  buildElevatedRoadCorridor,
  elevatedDeckBelow,
  groundRunsOfTrimmedWay,
  layoutElevatedRoads,
  type ElevatedRoadLayout,
} from "./elevated-roads";
import {
  GABTOLI_BUS_TERMINAL,
  SAYEDABAD_BUS_TERMINAL,
  TEJGAON_AIRPORT,
  type BusTerminal,
  type LatLon,
} from "./ground-infrastructure";
import {
  METRO_GIRDER_HALF_WIDTH,
  METRO_PIER_CAP_WIDTH,
  buildMetroCorridor,
  metroGirderSampleCount,
  type MetroCorridorIndex,
  type MetroStationFootprint,
} from "./metro-corridor";
import {
  STRINGS,
  chooseLocale,
  fill,
  frequencyText,
  localDigits,
  placeName,
  readLocale,
  registerPlaceNames,
  stationText,
  subscribeToLocale,
  weatherLabel,
  worldLabelText,
  type Locale,
  type Strings,
} from "./i18n";
import { BIRDS, DEFAULT_BIRD, birdById, chooseBird, readBird, subscribeToBird, type Bird, type BirdId } from "./birds";
import { BirdGlyph, HudIcon, weatherIconName } from "./HudIcon";
import soundClips from "./sound-clips.json";
import { DHAKA_LANDMARK_FOOTPRINTS, type LandmarkFootprintPart } from "./dhaka-landmark-footprints";
import { LANDMARK_MODULES, type LandmarkModuleKey } from "./landmarks";
import type { LandmarkKit, LandmarkModule } from "./landmarks/kit";

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
type BuildingCollider = {
  x: number;
  z: number;
  halfWidth: number;
  halfDepth: number;
  top: number;
  /** Landmark colliders only: clear ground procedural plots keep from it, in metres. */
  gap?: number;
};
// Top of a landmark "clearing" collider: low enough that the bird's
// `y < top + 5.5` strike test never fires, so it only keeps generic buildings
// and trees off a landmark's plaza or lawn.
const LANDMARK_CLEARING_TOP = -6;
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
    | "airport"
    | "ramna-park"
    | "suhrawardy-udyan"
    | "rabindra-sarobar"
    | "baldha-garden"
    | "botanical-garden"
    | "national-zoo"
    | "national-museum"
    | "liberation-museum"
    | "military-museum"
    | "science-museum"
    | "shishu-park"
    | "shishu-mela"
    | "novo-theatre"
    | "dhaka-medical"
    | "sher-e-bangla-stadium"
    | "zia-udyan"
    | "sat-gambuj-mosque"
    | "dhakeshwari-temple"
    | "aparajeyo-bangla"
    | "star-mosque"
    | "kamalapur-station"
    | "bcfcc"
    | "jamuna-future-park"
    | "hatirjheel-bridge"
    | "kuril-flyover"
    | "gulshan-central-mosque"
    | "army-stadium"
    | "tsc-raju"
    | "doyel-chattar"
    | "shapla-chattar"
    | "three-leaders-mausoleum"
    | "hussaini-dalan"
    | "sadarghat-terminal"
    | "supreme-court"
    | "national-stadium"
    | "rayer-bazar-memorial"
    | "air-force-museum"
    | "sonargaon-hotel"
    | "pm-office"
    | "armenian-church"
    | "bahadur-shah-park"
    | "rose-garden-palace"
    | "tejgaon-airport"
    | "sayedabad-bus-terminal"
    | "gabtoli-bus-terminal"
    // Landmarks that live in their own files: app/landmarks/<key>.ts.
    | LandmarkModuleKey;
};
type ProceduralDistrictTile = {
  group: THREE.Group;
  centerX: number;
  centerZ: number;
  colliders: BuildingCollider[];
  /** The tile's single building mesh, which alone stays drawn in the far ring. */
  buildings: THREE.InstancedMesh | null;
  /** 0 hidden, 1 far ring (buildings only, no shadows), 2 full detail. */
  detail: 0 | 1 | 2;
};
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
type LandmarkModuleStats = { triangles: number; drawCalls: number; budget: number; error?: string };
type BirdFlightWindow = Window & {
  __birdFlightDiagnostics?: () => {
    calls: number;
    triangles: number;
    geometries: number;
    textures: number;
    objects: number;
    proceduralTiles: number;
    visibleTiles: number;
    farTiles: number;
    maxFrameMs: number;
    longFrames: number;
    mapBuildMs: number | null;
    /** Per landmark module (app/landmarks): triangles and draw calls after baking. */
    landmarkModules: Record<string, LandmarkModuleStats>;
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
  setWingtips: (left: THREE.Object3D | null, right: THREE.Object3D | null) => void;
  update: (
    dt: number,
    velocity: THREE.Vector3,
    cameraPosition: THREE.Vector3,
    speedAmount: number,
    verticalSpeed: number,
    boosting: boolean,
    active: boolean,
    reducedMotion: boolean,
  ) => void;
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
  /** Where the viewer is, so a share of the vehicles can keep to roads nearby. */
  follow: (anchor: THREE.Vector3) => void;
  dispose: () => void;
  readonly vehicleCount: number;
  readonly tickHz: number;
};
type TrafficVehicle = {
  route: MapPoint[];
  /** Height of the vehicle's centre at each route point (elevated decks), or null on the ground. */
  routeY: number[] | null;
  /** Index into the elevated routes (one-way decks run on into the next chain), or -1. */
  elevatedRoute: number;
  /** Joined a two-way bridge from a ramp: leaves at the bridge's next end. */
  visitor?: boolean;
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
// x reaches about 220 m past the east bound (12 077 m) so the whole Bangladesh–China
// Friendship Exhibition Center, whose hall ends at 12 212 m, can be flown
// round before the soft turn-back starts.
const FLIGHT_EXTENT = { x: 12_300, z: 14_800 };
const COLLISION_CELL_SIZE = 180;
const BRAKE_SPEED = 18;
const CRUISE_SPEED = 44;
const BOOST_SPEED = 78;
const DEFAULT_FLIGHT_ALTITUDE = 130;
const MIN_FLIGHT_ALTITUDE = 10;
const MAX_FLIGHT_ALTITUDE = 650;
// The lowest puff bottom sits about 30 m below a cloud's origin at full
// weather scale, so this keeps about 100 m between the clouds and the bird at
// the ceiling, and about 84 m above a level chase camera there.
const CLOUD_BASE_ALTITUDE = MAX_FLIGHT_ALTITUDE + 130;
const CLOUD_LAYER_DEPTH = 260;
// Clouds wrap within this distance of the camera on both axes, so the sky
// stays populated anywhere in the flight area.
const CLOUD_FIELD_RADIUS = 2800;
// Clouds fade to nothing over this outer band of the field before they wrap.
const CLOUD_EDGE_FADE = 400;
const CEILING_EASE_DEPTH = 90;
// Descent eases out over the last stretch above the floor, so the bird levels
// off into a skim instead of hitting the floor and being kicked back up.
const FLOOR_EASE_DEPTH = 16;
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
const TRAFFIC_ROUTE_BUDGET = 480;
const TRAFFIC_MAX_VEHICLES = 1_800;
const TRAFFIC_MIN_VEHICLES = 40;
// Sparse ambient density: roughly one vehicle per this many metres of major road
// (local streets count at a quarter rate). Raise it for lighter traffic, lower for denser.
const TRAFFIC_METERS_PER_VEHICLE = 110;
// Fraction of vehicles routed onto major roads (highway/primary/secondary).
const TRAFFIC_MAJOR_SHARE = 0.75;
const TRAFFIC_BASE_TICK_HZ = 10;
const TRAFFIC_THROTTLED_TICK_HZ = 5;
const TRAFFIC_LONG_FRAME_MS = 34;
const TRAFFIC_MAX_CATCH_UP_STEPS = 2;
// Flyover and expressway decks: one vehicle per this many metres of deck, up
// to the cap, on top of the ground traffic.
const TRAFFIC_ELEVATED_METERS_PER_VEHICLE = 90;
const TRAFFIC_ELEVATED_MAX_VEHICLES = 320;
const TRAFFIC_GROUND_Y = 2.25;
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
  { label: "Hazaribagh", shortLabel: "HAZ", lat: 23.7320, lon: 90.3684, altitude: 46, heading: Math.PI },
  { label: "Gulistan", shortLabel: "GLS", lat: 23.7240, lon: 90.4110, altitude: 62, heading: Math.PI },
  { label: "Wari", shortLabel: "WAR", lat: 23.7167, lon: 90.4167, altitude: 54, heading: Math.PI, minimap: true },
  { label: "Gendaria", shortLabel: "GEN", lat: 23.7058, lon: 90.4295, altitude: 48, heading: Math.PI },
  { label: "Sutrapur", shortLabel: "SUT", lat: 23.7065, lon: 90.4169, altitude: 44, heading: Math.PI },
  { label: "Gabtoli", shortLabel: "GAB", lat: 23.7795, lon: 90.3475, altitude: 42, heading: Math.PI / 2, minimap: true },
  { label: "Shyamoli", shortLabel: "SHY", lat: 23.7744, lon: 90.3654, altitude: 52, heading: Math.PI / 2 },
  { label: "Kallyanpur", shortLabel: "KLP", lat: 23.7813, lon: 90.3570, altitude: 50, heading: Math.PI / 2 },
  { label: "Mirpur DOHS", shortLabel: "MDH", lat: 23.8370, lon: 90.3694, altitude: 52, heading: 0 },
  { label: "Bashabo", shortLabel: "BAS", lat: 23.7407, lon: 90.4296, altitude: 50, heading: -Math.PI / 2 },
  { label: "Mugda", shortLabel: "MUG", lat: 23.7317, lon: 90.4347, altitude: 50, heading: -Math.PI / 2 },
  { label: "Shyampur", shortLabel: "SYP", lat: 23.6850, lon: 90.4465, altitude: 42, heading: Math.PI },
  { label: "Tongi", shortLabel: "TNG", lat: 23.8915, lon: 90.4023, altitude: 46, heading: 0, minimap: true },
  { label: "Ashulia", shortLabel: "ASH", lat: 23.8975, lon: 90.3243, altitude: 40, heading: 0, minimap: true },
  { label: "Korail", shortLabel: "KOR", lat: 23.7846, lon: 90.4095, altitude: 30, heading: Math.PI / 2 },
];
const WATER_LANDMARKS: WaterLandmark[] = [
  { label: "Hatirjheel Lake", shortLabel: "HJL", lat: 23.77051, lon: 90.41635, minimap: true },
  { label: "Dhanmondi Lake", shortLabel: "DHL", lat: 23.74608, lon: 90.37506, minimap: true },
  { label: "Gulshan Lake", shortLabel: "GLL", lat: 23.79308, lon: 90.41693 },
  { label: "Buriganga River", shortLabel: "BUR", lat: 23.70396, lon: 90.39277, minimap: true },
  { label: "Turag River", shortLabel: "TUR", lat: 23.80258, lon: 90.33982, minimap: true },
  { label: "Tongi Khal", shortLabel: "TON", lat: 23.87524, lon: 90.38187, minimap: true },
  { label: "Balu River", shortLabel: "BAL", lat: 23.78091, lon: 90.49525, minimap: true },
  { label: "Shitalakshya River", shortLabel: "SHI", lat: 23.71674, lon: 90.51805, minimap: true },
];
const DHAKA_LANDMARKS: DhakaLandmark[] = [
  { label: "Holy Rosary Church", shortLabel: "HRC", lat: 23.7589, lon: 90.39231, altitude: 29, heading: Math.PI / 2, kind: "church" },
  { label: "Bashundhara City", shortLabel: "BSC", lat: 23.751142, lon: 90.3906411, altitude: 135, heading: Math.PI / 2, kind: "bashundhara-city" },
  // OSM theatre way 1065574904. The red stage disk is at the east lake tip and
  // the seat fans face it, so the audience looks east (bearing 95°).
  { label: "Hatirjheel Amphitheatre", shortLabel: "HJA", lat: 23.771154, lon: 90.413435, altitude: 14, heading: 1.48, kind: "amphitheatre" },
  { label: "Police Plaza Concord", shortLabel: "PPC", lat: 23.772911, lon: 90.4161391, altitude: 78, heading: 0, kind: "police-plaza" },
  { label: "BRAC Centre", shortLabel: "BRC", lat: 23.7799167, lon: 90.4101944, altitude: 81, heading: Math.PI / 2, kind: "brac" },
  { label: "Four Points by Sheraton", shortLabel: "FPS", lat: 23.7943691, lon: 90.413838, altitude: 112, heading: 0, kind: "hotel" },
  { label: "Jatiya Sangsad Bhaban", shortLabel: "JSB", lat: 23.7622884, lon: 90.3785482, altitude: 46, heading: Math.PI, kind: "parliament", minimap: true },
  { label: "Lalbagh Fort", shortLabel: "LBF", lat: 23.718843, lon: 90.3881528, altitude: 18, heading: Math.PI, kind: "lalbagh-fort", minimap: true },
  { label: "Ahsan Manzil", shortLabel: "AHM", lat: 23.7084768, lon: 90.4055988, altitude: 34, heading: 0, kind: "ahsan-manzil", minimap: true },
  { label: "Central Shaheed Minar", shortLabel: "CSM", lat: 23.7272114, lon: 90.3966368, altitude: 16, heading: Math.PI, kind: "shaheed-minar" },
  { label: "Curzon Hall", shortLabel: "CRZ", lat: 23.7273259, lon: 90.4019331, altitude: 28, heading: Math.PI, kind: "curzon-hall" },
  { label: "Baitul Mukarram", shortLabel: "BTM", lat: 23.7294725, lon: 90.412617, altitude: 72, heading: Math.PI, kind: "baitul-mukarram", minimap: true },
  // The 31-storey tower is OSM way 498175910 (46 × 26 m, long side E–W).
  { label: "Bangladesh Bank Tower", shortLabel: "BBT", lat: 23.726443, lon: 90.423328, altitude: 118, heading: 0, kind: "bangladesh-bank", minimap: true },
  // Runway 14/32 (OSM way 13858653) runs at bearing 144°, so local +Z points down
  // it to the SE; the terminals stand 850–1300 m to its NE (local +X).
  { label: "Hazrat Shahjalal Airport", shortLabel: "DAC", lat: 23.845004, lon: 90.396455, altitude: 50, heading: 0.628, kind: "airport", minimap: true },
  // Iconic Dhaka parks, gardens, zoo, museums & children's parks
  // Ramna Batamul, the Pohela Boishakh fig (OSM node 3014838436); its stage
  // looks ESE (120°) over the festival lawn.
  { label: "Ramna Park", shortLabel: "RMP", lat: 23.735685, lon: 90.401354, altitude: 20, heading: 1.047, kind: "ramna-park", minimap: true },
  // Swadhinata Stambha (OSM 447734739) at the south end of the museum-roof plaza,
  // which runs NNW (bearing 349°) between the arms of the lake.
  { label: "Suhrawardy Udyan", shortLabel: "SUD", lat: 23.733461, lon: 90.398528, altitude: 54, heading: -2.95, kind: "suhrawardy-udyan" },
  // Stage centre on the west shore of Dhanmondi Lake; the tiers face WNW (bearing 280°).
  { label: "Rabindra Sarobar", shortLabel: "RBS", lat: 23.745262, lon: 90.377204, altitude: 18, heading: -1.745, kind: "rabindra-sarobar" },
  { label: "Baldha Garden", shortLabel: "BLG", lat: 23.716829, lon: 90.419405, altitude: 20, heading: 2.88, kind: "baldha-garden" },
  { label: "National Botanical Garden", shortLabel: "NBG", lat: 23.8211, lon: 90.3478, altitude: 24, heading: 0.1, kind: "botanical-garden" },
  // Between the two lakes, 116 m inside the main gate (OSM node 1813542591),
  // which faces east (80°) onto Zoo Road.
  { label: "Bangladesh National Zoo", shortLabel: "ZOO", lat: 23.8136, lon: 90.3469, altitude: 24, heading: 1.745, kind: "national-zoo", minimap: true },
  // OSM relation 7392256: a 97 × 95 m ring round a court; the entrance faces
  // Kazi Nazrul Islam Avenue to the east.
  { label: "Bangladesh National Museum", shortLabel: "BNM", lat: 23.7375, lon: 90.3945, altitude: 26, heading: Math.PI / 2, kind: "national-museum" },
  // OSM 478326295: the 63 × 19 m street-front bar, long axis 164°. Its entrance
  // face is taken to look ENE (74°) onto the road; not confirmed by an aerial.
  { label: "Liberation War Museum", shortLabel: "LWM", lat: 23.775565, lon: 90.36943, altitude: 26, heading: 1.85, kind: "liberation-museum", minimap: true },
  { label: "Bangladesh Military Museum", shortLabel: "BMM", lat: 23.763864, lon: 90.385289, altitude: 28, heading: 2.97, kind: "military-museum" },
  // The blue geodesic dome (OSM 737537259); the front faces Bijoy Sarani (355°).
  { label: "Novo Theatre", shortLabel: "NOV", lat: 23.763729, lon: 90.387275, altitude: 31, heading: -3.054, kind: "novo-theatre" },
  { label: "National Science Museum", shortLabel: "NSM", lat: 23.778928, lon: 90.3717, altitude: 24, heading: 0.26, kind: "science-museum" },
  { label: "Shishu Park", shortLabel: "SHP", lat: 23.736772, lon: 90.397785, altitude: 10, heading: 0, kind: "shishu-park" },
  // OSM way 32561560: the 86 × 62 m fairground (long axis 161°); the cartoon
  // gate faces WSW (251°) onto Mirpur Road.
  { label: "Shishu Mela", shortLabel: "SHM", lat: 23.773007, lon: 90.36788, altitude: 28, heading: -1.24, kind: "shishu-mela" },
  // OSM way 1036301057: the long NW–SE hospital spine (bearing 138°); the domed
  // entrance faces the NE forecourt (48°). The lat/lon is the dome.
  // OSM stadium way 121390579: an oval bowl 196 × 249 m, long axis 152°.
  { label: "Sher-e-Bangla National Cricket Stadium", shortLabel: "SBS", lat: 23.806854, lon: 90.363583, altitude: 50, heading: 0.489, kind: "sher-e-bangla-stadium", minimap: true },
  // Ziaur Rahman's mausoleum (OSM node 265576693); the front faces south (175°)
  // down the brick axis walk to the Crescent Lake bridge and the Parliament.
  { label: "Zia Udyan", shortLabel: "ZIA", lat: 23.766604, lon: 90.378172, altitude: 17, heading: 0.087, kind: "zia-udyan" },
  // OSM 1560283156 (Mughal, 15.7 × 22.6 m, long axis N–S); front faces east.
  { label: "Sat Gambuj Mosque", shortLabel: "SGM", lat: 23.757711, lon: 90.35897, altitude: 24, heading: 1.588, kind: "sat-gambuj-mosque" },
  // Compound OSM 435104024; the four Shiva temples face SSW (199°) across the
  // courtyard east of the pond.
  { label: "Dhakeshwari National Temple", shortLabel: "DKT", lat: 23.72305, lon: 90.39005, altitude: 14, heading: -0.332, kind: "dhakeshwari-temple" },
  // OSM node 2992690009, just south of the Arts Faculty; the figures face south.
  { label: "Aparajeyo Bangla", shortLabel: "APB", lat: 23.733799, lon: 90.392412, altitude: 12, heading: 0, kind: "aparajeyo-bangla" },
  { label: "Dhaka Medical College Hospital", shortLabel: "DMC", lat: 23.72562, lon: 90.39803, altitude: 28, heading: 2.304, kind: "dhaka-medical" },
  // OSM 245019710 (20 × 12 m, long axis N–S); the arcade faces east onto the
  // courtyard and its star-shaped pool.
  { label: "Star Mosque", shortLabel: "STM", lat: 23.715666, lon: 90.401559, altitude: 17, heading: Math.PI / 2, kind: "star-mosque" },
  // Centre of the 84 × 82 m umbrella-shell roof; the front faces the forecourt
  // to the west (268°) and the platforms run 440 m north.
  { label: "Kamalapur Railway Station", shortLabel: "KMR", lat: 23.73193, lon: 90.42611, altitude: 18, heading: -1.536, kind: "kamalapur-station", minimap: true },
  // OSM 24448507: the 150 × 128 m roof plate; the flagpole forecourt faces
  // east toward Begum Rokeya Sarani (inferred, 85°).
  { label: "Bangladesh-China Friendship Conference Centre", shortLabel: "BCF", lat: 23.769168, lon: 90.381376, altitude: 25, heading: 1.658, kind: "bcfcc" },
  // OSM 586535435 (229 × 212 m, seven floors); the main façade faces west
  // onto Pragati Sarani. Footprint mode.
  { label: "Jamuna Future Park", shortLabel: "JFP", lat: 23.813286, lon: 90.42379, altitude: 42, heading: -1.344, kind: "jamuna-future-park" },
  // OSM way 444229773, the 193 m deck of the white arch bridge across
  // Hatirjheel; local +Z runs down its axis to the SE (138°).
  { label: "Hatirjheel Bridge", shortLabel: "HJB", lat: 23.767836, lon: 90.412947, altitude: 23, heading: 0.733, kind: "hatirjheel-bridge" },
  // The ramps are the ten OSM ways named "Kuril Flyover", built in world axes.
  { label: "Kuril Flyover", shortLabel: "KFO", lat: 23.8231, lon: 90.4209, altitude: 16, heading: 0, kind: "kuril-flyover" },
  // OSM 345170898 (Azad Masjid, Road 36); the fin facade faces east over the Eidgah lawn.
  { label: "Gulshan Central Mosque", shortLabel: "GCM", lat: 23.790106, lon: 90.414579, altitude: 30, heading: 1.571, kind: "gulshan-central-mosque" },
  // OSM 24821768 (145 × 218 m, long axis N–S); the grandstand faces west (279°) to Airport Road.
  { label: "Bangladesh Army Stadium", shortLabel: "ARS", lat: 23.805601, lon: 90.404203, altitude: 40, heading: -1.728, kind: "army-stadium" },
  // TSC main block OSM 655714604 and the Raju sculpture (node 9150960977) on
  // the TSC Mor roundabout 60 m north. Footprint mode.
  { label: "TSC & Raju Memorial", shortLabel: "TSC", lat: 23.73225, lon: 90.3959, altitude: 16, heading: -2.985, kind: "tsc-raju" },
  // OSM 296816607, the magpie-robin pair in the roundabout basin; beaks to the NW.
  { label: "Doyel Chattar", shortLabel: "DOY", lat: 23.727996, lon: 90.400293, altitude: 9, heading: -2.356, kind: "doyel-chattar" },
  // Centre of the Motijheel roundabout (OSM ways 15491646 and 1099855656).
  { label: "Shapla Chattar", shortLabel: "SHP", lat: 23.726557, lon: 90.421619, altitude: 13, heading: 0, kind: "shapla-chattar" },
  // OSM 296802766, the 60 × 33 m plinth (long axis 167°) under three hypar
  // shells; the main stair faces WSW (257°) toward the Shahbag road.
  { label: "Mausoleum of Three Leaders", shortLabel: "TNM", lat: 23.729107, lon: 90.399921, altitude: 14, heading: -1.344, kind: "three-leaders-mausoleum" },
  // OSM 234106448 (32 × 22 m) on the north bank of its tank (OSM 234069504);
  // the columned loggia and the two blue domes face south over the water.
  { label: "Hussaini Dalan", shortLabel: "HSD", lat: 23.7223, lon: 90.39798, altitude: 19, heading: 0.017, kind: "hussaini-dalan" },
  // OSM ferry terminal 332507445: the quay and pontoons follow the in-game
  // Buriganga bank (bearing 121°), and the launches moor bow-in from the
  // river (front faces 211°).
  { label: "Sadarghat Launch Terminal", shortLabel: "SLT", lat: 23.7058, lon: 90.4092, altitude: 15, heading: -0.541, kind: "sadarghat-terminal" },
  // OSM relation 15508050: a white courtyard block (long axis 171°) whose
  // domed entrance tower faces east (81°) over the lotus fountain.
  { label: "Supreme Court of Bangladesh", shortLabel: "SPC", lat: 23.731056, lon: 90.402907, altitude: 36, heading: 1.728, kind: "supreme-court" },
  // OSM 24477071: a near-round 229 × 220 m bowl round a N–S pitch; the
  // covered stand is on the ESE arc.
  { label: "National Stadium", shortLabel: "NST", lat: 23.727981, lon: 90.413532, altitude: 24, heading: 0, kind: "national-stadium" },
  // OSM 1074764129: the curved brick wall hugs the west edge of the D-shaped
  // pool (OSM 320577211, drawn from map data); its concave face looks ENE (77°).
  { label: "Rayer Bazar Martyred Intellectuals Memorial", shortLabel: "RBM", lat: 23.75082, lon: 90.35725, altitude: 18, heading: 1.798, kind: "rayer-bazar-memorial" },
  // OSM way 462486324: a 688 × 170 m lawn strip of parked aircraft (long axis
  // 165°); the gate faces WSW (255°) onto Begum Rokeya Sarani. The lat/lon is
  // the site centroid, on the pond; the An-24 is 75 m NNW of it.
  { label: "Bangladesh Air Force Museum", shortLabel: "AFM", lat: 23.778157, lon: 90.381077, altitude: 10, heading: -1.309, kind: "air-force-museum" },
  // OSM way 32562242: the room slab runs ENE (70°) along the south side of a
  // podium wedge; the porte-cochère faces NNW (340°, inferred).
  { label: "Sonargaon Hotel", shortLabel: "PPS", lat: 23.749564, lon: 90.394453, altitude: 34, heading: -2.793, kind: "sonargaon-hotel" },
  // OSM 571232877 (the old Sangsad Bhaban, Tejgaon); the portico faces west
  // over the formal lawns (inferred).
  { label: "Prime Minister's Office", shortLabel: "PMO", lat: 23.76835, lon: 90.39184, altitude: 12, heading: -1.571, kind: "pm-office" },
  // OSM 243376194 (31 × 16 m, long axis 98°); the bell tower stands over the
  // west door (278°), the apse at the east end.
  { label: "Armenian Church", shortLabel: "ARM", lat: 23.712456, lon: 90.402228, altitude: 22, heading: -1.71, kind: "armenian-church" },
  // OSM 948448576, the 1857 memorial in the north half of the oval park (way 34339923).
  { label: "Bahadur Shah Park", shortLabel: "BSP", lat: 23.709417, lon: 90.412344, altitude: 18, heading: 0, kind: "bahadur-shah-park" },
  // OSM 439770540 (26 × 15 m, long axis 174°) in its walled garden (way
  // 439770049); the belvedere front faces west (264°) across the lawn to the pond.
  { label: "Rose Garden Palace", shortLabel: "RGP", lat: 23.718358, lon: 90.4264, altitude: 22, heading: -1.466, kind: "rose-garden-palace" },
  // The old airport, now BAF Base Bashar (OSM aerodrome 622567201). The row
  // sits on the midpoint of runway 17/35 and its heading turns local +Z down
  // the runway (bearing 164.4°); see TEJGAON_AIRPORT in ground-infrastructure.ts.
  { label: "Tejgaon Airport", shortLabel: "TEJ", lat: TEJGAON_AIRPORT.centre[0], lon: TEJGAON_AIRPORT.centre[1], altitude: 14, heading: TEJGAON_AIRPORT.heading, kind: "tejgaon-airport" },
  // The intercity bus terminals, built in world axes on their OSM yards.
  { label: "Sayedabad Bus Terminal", shortLabel: "SBT", lat: SAYEDABAD_BUS_TERMINAL.centre[0], lon: SAYEDABAD_BUS_TERMINAL.centre[1], altitude: 8, heading: 0, kind: "sayedabad-bus-terminal" },
  { label: "Gabtoli Bus Terminal", shortLabel: "GBT", lat: GABTOLI_BUS_TERMINAL.centre[0], lon: GABTOLI_BUS_TERMINAL.centre[1], altitude: 8, heading: 0, kind: "gabtoli-bus-terminal" },
];
// Landmarks that live in their own files (app/landmarks/<kind>.ts) join the
// table here. Everything a built-in kind keeps in a per-kind table or branch
// (clearing radius, extents, heading, colliders, names, parks, inspection
// distance) a module carries itself, looked up through this map.
const LANDMARK_MODULE_BY_KIND = new Map<DhakaLandmark["kind"], LandmarkModule>();
{
  const builtInKinds = new Set<string>(DHAKA_LANDMARKS.map((landmark) => landmark.kind));
  for (const landmarkModule of LANDMARK_MODULES) {
    if (builtInKinds.has(landmarkModule.key)) {
      console.error(`Landmark module "${landmarkModule.key}" duplicates a built-in landmark kind. Skipped.`);
      continue;
    }
    LANDMARK_MODULE_BY_KIND.set(landmarkModule.key, landmarkModule);
    DHAKA_LANDMARKS.push({
      label: landmarkModule.label,
      shortLabel: landmarkModule.shortLabel,
      lat: landmarkModule.lat,
      lon: landmarkModule.lon,
      altitude: landmarkModule.altitude,
      heading: landmarkModule.heading,
      kind: landmarkModule.key,
      minimap: landmarkModule.minimap,
    });
  }
  registerPlaceNames(Object.fromEntries([...LANDMARK_MODULE_BY_KIND.values()].map((landmarkModule) => [landmarkModule.label, landmarkModule.labelBn])));
}

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
// Each airfield's frame is its landmark's own detail group: origin at the table
// lat/lon, turned by its heading, local +Z down the runway. Rectangles are in
// that frame.
const AIRFIELD_CLEARANCES = [
  {
    // Hazrat Shahjalal: heading 0.628 (runway 14/32 at bearing 144°), local +Z
    // down the runway to the SE and local +X toward the terminals (NE).
    lat: 23.845004,
    lon: 90.396455,
    heading: 0.628,
    rects: [
      // The airfield: runway, both parallel taxiways, the west aprons, the main
      // apron and the Terminal 1/2 hall.
      { minX: -490, maxX: 1_000, minZ: -1_480, maxZ: 1_930 },
      // Terminal 3 and its landside canopy.
      { minX: 990, maxX: 1_330, minZ: 670, maxZ: 1_450 },
      // The Terminal 1/2 forecourt and car parks, up to Airport Road.
      { minX: 979, maxX: 1_300, minZ: -100, maxZ: 680 },
    ],
  },
  {
    // Tejgaon: local +Z down runway 17/35 to the SSE, local +X east to the
    // aprons. The rectangles tile the inside of the aerodrome fence (OSM way
    // 622567201) and stop short of everything round it: the Air Force Museum
    // strip and its lawns (west of x -62 for z < 240), Agargaon Link Road,
    // which hugs the fence down the west side and round the south tip, the
    // street along the east aprons, and the pond beside the north-east grass.
    // They are what roads are clipped against. The mown grass fills the whole
    // fence polygon, which the rectangles cannot tile exactly, so buildings
    // and trees are also kept out of `fence` itself (see inAirportClearance).
    lat: TEJGAON_AIRPORT.centre[0],
    lon: TEJGAON_AIRPORT.centre[1],
    heading: TEJGAON_AIRPORT.heading,
    fence: TEJGAON_AIRPORT.boundary,
    rects: [
      // Runway strip and its shoulders, end to end.
      { minX: -50, maxX: 75, minZ: -1_400, maxZ: 1_380 },
      // The grass east of the runway's north half.
      { minX: 75, maxX: 195, minZ: -1_310, maxZ: -480 },
      { minX: 75, maxX: 150, minZ: -480, maxZ: -290 },
      // The taxiway's north leg, stepped under the fence line it follows.
      { minX: 150, maxX: 260, minZ: -362, maxZ: -290 },
      { minX: 260, maxX: 432, minZ: -335, maxZ: -290 },
      // Taxiway loop, the three east aprons and the big hangars.
      { minX: 75, maxX: 432, minZ: -290, maxZ: 960 },
      { minX: 432, maxX: 455, minZ: -235, maxZ: -60 },
      { minX: 432, maxX: 470, minZ: -60, maxZ: 80 },
      { minX: 432, maxX: 490, minZ: 80, maxZ: 830 },
      { minX: 490, maxX: 515, minZ: 400, maxZ: 440 },
      { minX: 490, maxX: 545, minZ: 440, maxZ: 760 },
      // South-east grass down to the Bijoy Sarani end.
      { minX: 75, maxX: 205, minZ: 960, maxZ: 1_380 },
      // West hangars and the parade-ground lawns south of them.
      { minX: -170, maxX: -50, minZ: 250, maxZ: 370 },
      { minX: -205, maxX: -50, minZ: 370, maxZ: 1_340 },
      // The south tip, inside the bend of Agargaon Link Road.
      { minX: -120, maxX: 75, minZ: 1_380, maxZ: 1_430 },
      { minX: -40, maxX: 75, minZ: 1_430, maxZ: 1_480 },
      { minX: 75, maxX: 190, minZ: 1_380, maxZ: 1_460 },
    ],
  },
].map((field) => {
  const world = coordinatesToWorld(field.lat, field.lon);
  const reach = Math.max(...field.rects.map((rect) => Math.hypot(
    Math.max(Math.abs(rect.minX), Math.abs(rect.maxX)),
    Math.max(Math.abs(rect.minZ), Math.abs(rect.maxZ)),
  )));
  // The fence in world metres, with its bounding box for a quick reject.
  const fence = (field.fence ?? []).map(([lat, lon]): MapPoint => {
    const point = coordinatesToWorld(lat, lon);
    return [point.x, point.y];
  });
  const fenceBox = {
    minX: Math.min(...fence.map(([x]) => x)),
    maxX: Math.max(...fence.map(([x]) => x)),
    minZ: Math.min(...fence.map(([, z]) => z)),
    maxZ: Math.max(...fence.map(([, z]) => z)),
  };
  return { x: world.x, z: world.y, cos: Math.cos(field.heading), sin: Math.sin(field.heading), rects: field.rects, reach, fence, fenceBox };
});
// Callers pad the rectangles by 20 to 40 m; the fence is only padded this far,
// so the streets and plots that hug its outside keep their buildings and trees.
const AIRFIELD_FENCE_PAD = 6;
type AirfieldClearance = (typeof AIRFIELD_CLEARANCES)[number];

function toAirfieldLocal(field: AirfieldClearance, x: number, z: number): [number, number] {
  const dx = x - field.x;
  const dz = z - field.z;
  return [dx * field.cos - dz * field.sin, dx * field.sin + dz * field.cos];
}

function inAirportClearance(x: number, z: number, pad = 0) {
  for (const field of AIRFIELD_CLEARANCES) {
    const reach = field.reach + pad;
    if (Math.abs(x - field.x) > reach || Math.abs(z - field.z) > reach) continue;
    const [localX, localZ] = toAirfieldLocal(field, x, z);
    for (const rect of field.rects) {
      if (localX > rect.minX - pad && localX < rect.maxX + pad && localZ > rect.minZ - pad && localZ < rect.maxZ + pad) {
        return true;
      }
    }
  }
  // Inside an aerodrome fence, or within a few metres of it.
  for (const { fence, fenceBox } of AIRFIELD_CLEARANCES) {
    if (fence.length < 3) continue;
    const reach = Math.min(Math.max(pad, 0), AIRFIELD_FENCE_PAD);
    if (x < fenceBox.minX - reach || x > fenceBox.maxX + reach || z < fenceBox.minZ - reach || z > fenceBox.maxZ + reach) continue;
    if (pointInPolygon(x, z, fence)) return true;
    if (reach > 0 && (
      pointInPolygon(x - reach, z, fence) || pointInPolygon(x + reach, z, fence)
      || pointInPolygon(x, z - reach, fence) || pointInPolygon(x, z + reach, fence)
    )) return true;
  }
  return false;
}

// Major real Dhaka green parks & urban lungs. Anchoring greenery to actual
// Dhaka parks lets the rest of the ground read as dense concrete/brick urban
// fabric instead of a forest.
type DhakaParkRow = { name: string; lat: number; lon: number; rx: number; rz: number; angle: number; hasLoop: boolean; wooded?: boolean; understory?: boolean };
const DHAKA_PARKS = ([
  { name: "Ramna Park", lat: 23.7378, lon: 90.4007, rx: 225, rz: 260, angle: 0.12, hasLoop: false },
  { name: "Suhrawardy Udyan", lat: 23.7332, lon: 90.3992, rx: 155, rz: 255, angle: 0.08, hasLoop: false },
  // OSM 24448418 (838 × 374 m, centroid 23.7658, 90.3797): woodland round the
  // mausoleum and along both banks of Crescent Lake.
  { name: "Zia Udyan", lat: 23.7661, lon: 90.3793, rx: 330, rz: 135, angle: 0.03, hasLoop: false },
  { name: "National Botanical Garden", lat: 23.8211, lon: 90.3478, rx: 460, rz: 350, angle: 0.1, hasLoop: false },
  // OSM 987024670: the zoo runs ≈1.3 km N–S between its North and South
  // lakes, from the Beribadh road on the west to the main gate on the east.
  { name: "Bangladesh National Zoo", lat: 23.812605, lon: 90.344937, rx: 285, rz: 690, angle: 0, hasLoop: false },
  // West of the Airport Road bend, round the course's three lakes (OSM
  // 188564504–6): fairways under belts of old trees.
  { name: "Kurmitola Golf Club", lat: 23.8190, lon: 90.4040, rx: 290, rz: 370, angle: -0.18, hasLoop: true, wooded: true },
  { name: "Sher-e-Bangla Nagar North Lawn", lat: 23.7642, lon: 90.3785, rx: 280, rz: 100, angle: 0, hasLoop: false },
  // One sweep of open lawn from the flanks of the Sangsad South Plaza down to Manik Mia Avenue.
  { name: "Sher-e-Bangla Nagar South Lawn", lat: 23.7590, lon: 90.3786, rx: 270, rz: 235, angle: 0, hasLoop: false },
  { name: "Dhaka University Mall Green", lat: 23.7322, lon: 90.3940, rx: 120, rz: 145, angle: 0.15, hasLoop: false },
  { name: "Curzon Hall Garden", lat: 23.7266, lon: 90.4034, rx: 105, rz: 85, angle: 0.05, hasLoop: false },
  // Continuous greenbelt hugging the winding crescent of Dhanmondi Lake
  { name: "Dhanmondi Lake North Park", lat: 23.7506, lon: 90.3766, rx: 95, rz: 195, angle: 0.14, hasLoop: false },
  { name: "Dhanmondi Rabindra Sarobar", lat: 23.7458, lon: 90.3768, rx: 110, rz: 200, angle: 0.22, hasLoop: false },
  { name: "Dhanmondi Lake South Park", lat: 23.7414, lon: 90.3752, rx: 90, rz: 185, angle: -0.16, hasLoop: false },
  { name: "Justice Shahabuddin Park", lat: 23.7907, lon: 90.4152, rx: 78, rz: 105, angle: 0.05, hasLoop: false },
  { name: "Gulshan Tank Park", lat: 23.7988, lon: 90.4158, rx: 72, rz: 92, angle: 0, hasLoop: false },
  { name: "Tajuddin Ahmad Smriti Park", lat: 23.7882, lon: 90.4168, rx: 62, rz: 78, angle: 0, hasLoop: false },
  { name: "Banani Lake Park", lat: 23.7925, lon: 90.4042, rx: 68, rz: 95, angle: -0.1, hasLoop: false },
  { name: "Baridhara Park", lat: 23.8038, lon: 90.4212, rx: 62, rz: 82, angle: 0, hasLoop: false },
  { name: "Uttara Sector 3 & 7 Park", lat: 23.8685, lon: 90.3995, rx: 85, rz: 135, angle: 0.05, hasLoop: false },
  { name: "Osmani Udyan", lat: 23.7267, lon: 90.4071, rx: 105, rz: 78, angle: 0, hasLoop: false },
  // OSM 34597180: a 229 m strip running NNE beside Narinda Road.
  { name: "Baldha Garden", lat: 23.716829, lon: 90.419405, rx: 32, rz: 115, angle: 0.26, hasLoop: false },
  // OSM 34339923: a 101 × 53 m oval of old trees inside its railing.
  { name: "Bahadur Shah Park", lat: 23.709228, lon: 90.412342, rx: 27, rz: 50, angle: 0.03, hasLoop: false },
  // OSM 31664637 (373 × 268 m), round the promenade being built there.
  { name: "Shishu Park Grounds", lat: 23.736772, lon: 90.397785, rx: 180, rz: 125, angle: 0, hasLoop: false },
  { name: "Shishu Mela Grounds", lat: 23.773007, lon: 90.36788, rx: 30, rz: 42, angle: -0.33, hasLoop: false },
  // OSM 236956073's south lobe, round the Batamul lawn down to the Star Gate.
  // Appended last: park trees are seeded by index.
  // Reaches past the tip of the lake's south arm (OSM 31664577 / 941967046).
  { name: "Ramna Park South", lat: 23.7350, lon: 90.4026, rx: 175, rz: 145, angle: 0, hasLoop: false },
  // The old Military Museum grounds (OSM site 232998223) round the new hall.
  { name: "Military Museum Grounds", lat: 23.763792, lon: 90.385691, rx: 100, rz: 92, angle: 0, hasLoop: false },
  // The Air Force Museum lawn strip (OSM 462486324, long axis 165°).
  { name: "Air Force Museum Lawns", lat: 23.778954, lon: 90.380967, rx: 80, rz: 335, angle: -0.26, hasLoop: false },
  // The formal lawns west of the Prime Minister's Office (OSM 296186028, 296187712).
  { name: "Prime Minister's Office Lawns", lat: 23.768169, lon: 90.390761, rx: 75, rz: 135, angle: 0, hasLoop: false },
  // Ramna's east half, from the lake across to the Kakrail edge.
  { name: "Ramna Park East", lat: 23.7372, lon: 90.4034, rx: 160, rz: 235, angle: 0.12, hasLoop: false },
  // Sher-e-Bangla Nagar: the lawns between the moat and the MP hostels on
  // the east and west shores (the Manik Mia lawns are the South Lawn row).
  { name: "Sher-e-Bangla Nagar West Lawn", lat: 23.7618, lon: 90.3752, rx: 120, rz: 200, angle: 0, hasLoop: false },
  { name: "Sher-e-Bangla Nagar East Lawn", lat: 23.7618, lon: 90.3822, rx: 130, rz: 200, angle: 0, hasLoop: false },
  // Dhaka University, BUET and Dhaka Medical stand among old campus trees,
  // not city blocks: OSM keeps the real halls, the rows add turf and canopy.
  { name: "Dhaka University Arts Campus", lat: 23.7335, lon: 90.3925, rx: 230, rz: 170, angle: 0.1, hasLoop: false },
  { name: "Dhaka University Science Campus", lat: 23.7288, lon: 90.3995, rx: 210, rz: 120, angle: -0.35, hasLoop: false },
  { name: "Shaheed Minar & Medical Grounds", lat: 23.7279, lon: 90.3958, rx: 170, rz: 120, angle: 0, hasLoop: false },
  { name: "BUET Campus", lat: 23.7262, lon: 90.3918, rx: 120, rz: 150, angle: 0, hasLoop: false },
  { name: "Dhaka University Halls", lat: 23.7306, lon: 90.3950, rx: 200, rz: 115, angle: 0, hasLoop: false },
  // West of Airport Road from Banani up to Staff Road the Cantonment is
  // fairways, ponds and woodland, not city blocks (the ponds are map water).
  { name: "Army Golf Club", lat: 23.8010, lon: 90.3957, rx: 400, rz: 440, angle: 0, hasLoop: false, wooded: true },
  // `understory` swaps the lawn for dark leaf litter, so the gaps between
  // crowns read as more wood rather than as turf.
  { name: "Cantonment Woods", lat: 23.8100, lon: 90.3975, rx: 370, rz: 470, angle: 0, hasLoop: false, wooded: true, understory: true },
  // The grounds of landmark modules (app/landmarks), after every row above.
  ...[...LANDMARK_MODULE_BY_KIND.values()].flatMap((landmarkModule) => [landmarkModule.park ?? []].flat().map((park) => ({
    name: park.name ?? `${landmarkModule.label} Grounds`,
    lat: park.lat,
    lon: park.lon,
    rx: park.rx,
    rz: park.rz,
    angle: park.angle ?? 0,
    hasLoop: false,
    wooded: park.wooded,
  }))),
] as DhakaParkRow[]).map((park) => {
  const world = coordinatesToWorld(park.lat, park.lon);
  return {
    ...park,
    x: world.x,
    z: world.y,
    cos: Math.cos(-park.angle),
    sin: Math.sin(-park.angle),
    fwdCos: Math.cos(park.angle),
    fwdSin: Math.sin(park.angle),
  };
});

// Campus grounds the generic city must stay out of entirely (world-axis
// lat/lon boxes): Louis Kahn's Sher-e-Bangla Nagar is open lawn, lake and a
// few low brick hostels from Manik Mia Avenue up to the Agargaon road.
const DHAKA_OPEN_GROUNDS = [
  { name: "Sher-e-Bangla Nagar", south: 23.7572, north: 23.7695, west: 90.3730, east: 90.3858 },
].map((ground) => {
  const southWest = coordinatesToWorld(ground.south, ground.west);
  const northEast = coordinatesToWorld(ground.north, ground.east);
  return { minX: southWest.x, maxX: northEast.x, minZ: northEast.y, maxZ: southWest.y };
});

function inDhakaOpenGround(x: number, z: number, pad = 0) {
  return DHAKA_OPEN_GROUNDS.some((ground) => (
    x > ground.minX - pad && x < ground.maxX + pad && z > ground.minZ - pad && z < ground.maxZ + pad
  ));
}

// Clear ground procedural plots keep from a landmark's solid parts (default
// 16 m): sites that stand in a compound or forecourt keep a wider one.
const LANDMARK_PLOT_GAP: Partial<Record<DhakaLandmark["kind"], number>> = {
  "baitul-mukarram": 40,
  bcfcc: 40,
  "gulshan-central-mosque": 30,
  "national-museum": 30,
  "sat-gambuj-mosque": 20,
};

function inDhakaPark(x: number, z: number, pad = 0) {
  for (const park of DHAKA_PARKS) {
    const dx = x - park.x;
    const dz = z - park.z;
    const lx = dx * park.cos - dz * park.sin;
    const lz = dx * park.sin + dz * park.cos;
    const rx = Math.max(1, park.rx + pad);
    const rz = Math.max(1, park.rz + pad);
    if ((lx * lx) / (rx * rx) + (lz * lz) / (rz * rz) <= 1) return true;
  }
  return false;
}

// Neighborhood canopy density anchors independent of building height: leafy
// garden/planned districts (Ramna, DU, Sangsad, Dhanmondi, Gulshan, Banani,
// Uttara, Cantonment) contrast with wall-to-wall masonry cores (Old Dhaka,
// Motijheel, Tejgaon, Kamrangirchar).
const DHAKA_GREEN_ZONES = [
  // Leafy institutional & garden cores
  { name: "Ramna & Mintoo Road", lat: 23.7365, lon: 90.4025, radius: 1_050, weight: 1.85 },
  { name: "Dhaka University & Shahbagh", lat: 23.7305, lon: 90.3955, radius: 1_000, weight: 1.75 },
  { name: "Sangsad & Agargaon", lat: 23.7660, lon: 90.3790, radius: 1_200, weight: 1.65 },
  { name: "Dhaka Cantonment", lat: 23.8180, lon: 90.3940, radius: 1_650, weight: 1.55 },
  { name: "Botanical & Zoo", lat: 23.8145, lon: 90.3455, radius: 1_200, weight: 1.75 },
  // Planned leafy residential & lakeside districts
  { name: "Dhanmondi & Lalmatia", lat: 23.7495, lon: 90.3725, radius: 1_300, weight: 1.38 },
  { name: "Gulshan, Banani & Baridhara", lat: 23.7925, lon: 90.4135, radius: 1_700, weight: 1.35 },
  { name: "Hatirjheel & Niketan", lat: 23.7710, lon: 90.4135, radius: 1_100, weight: 1.28 },
  { name: "Uttara Sectors", lat: 23.8720, lon: 90.3975, radius: 1_800, weight: 1.25 },
  { name: "Bashundhara", lat: 23.8185, lon: 90.4365, radius: 1_400, weight: 1.15 },
  { name: "Mohammadpur", lat: 23.7620, lon: 90.3610, radius: 1_100, weight: 1.02 },
  // Peri-urban riverine belts
  { name: "Diabari", lat: 23.8850, lon: 90.3760, radius: 1_500, weight: 1.22 },
  { name: "Purbachal", lat: 23.8360, lon: 90.4900, radius: 2_200, weight: 1.28 },
  { name: "Demra", lat: 23.7240, lon: 90.4930, radius: 1_700, weight: 1.18 },
  { name: "Keraniganj", lat: 23.6940, lon: 90.3860, radius: 1_600, weight: 1.16 },
  // Hyper-dense masonry & commercial cores
  { name: "Old Dhaka & Sadarghat", lat: 23.7105, lon: 90.4065, radius: 1_300, weight: 0.30 },
  { name: "Kamrangirchar", lat: 23.7160, lon: 90.3655, radius: 950, weight: 0.34 },
  { name: "Motijheel", lat: 23.7275, lon: 90.4205, radius: 850, weight: 0.36 },
  { name: "Tejgaon & Karwan Bazar", lat: 23.7595, lon: 90.3990, radius: 1_000, weight: 0.40 },
  { name: "Farmgate & Moghbazar", lat: 23.7515, lon: 90.4010, radius: 950, weight: 0.50 },
  { name: "Jatrabari", lat: 23.7105, lon: 90.4350, radius: 950, weight: 0.40 },
].map((zone) => {
  const world = coordinatesToWorld(zone.lat, zone.lon);
  return { x: world.x, z: world.y, radius: zone.radius, weight: zone.weight };
});

function dhakaGreenWeight(x: number, z: number) {
  let weightedSum = 0.80 * 0.35;
  let totalInfluence = 0.35;
  for (const zone of DHAKA_GREEN_ZONES) {
    const dist = Math.hypot(x - zone.x, z - zone.z);
    if (dist >= zone.radius) continue;
    const t = 1 - dist / zone.radius;
    const influence = t * t * (3 - 2 * t);
    weightedSum += zone.weight * influence;
    totalInfluence += influence;
  }
  return weightedSum / totalInfluence;
}

// Urban fabric of each Dhaka district: plot size, packing and storey range.
// Old Dhaka and Kamrangirchar are tight low-rise masonry, Mirpur, Mohammadpur
// and Badda are 5–9 storey walk-ups, Dhanmondi and Uttara are planned 6–10
// storey blocks, and Motijheel, Karwan Bazar, Gulshan and Banani mix in towers.
// Lot sizes are in metres along (lotW) and away from (lotD) the street; gap is
// the space between neighbours and lane the alley between plot blocks.
type UrbanStyle = {
  lotW: number;
  lotD: number;
  gap: number;
  lane: number;
  minFloors: number;
  maxFloors: number;
  tower: number;
  towerMin: number;
  towerMax: number;
  organic: number;
  brick: number;
  /** Extra share of low roofs under corrugated tin (informal settlements, sheds). */
  tin: number;
};
const DEFAULT_URBAN_STYLE: UrbanStyle = {
  lotW: 12, lotD: 15, gap: 1.3, lane: 4.6, minFloors: 4, maxFloors: 7, tower: 0, towerMin: 10, towerMax: 14, organic: 0.08, brick: 0.1, tin: 0,
};
const URBAN_STYLE_KEYS = Object.keys(DEFAULT_URBAN_STYLE) as Array<keyof UrbanStyle>;
const DHAKA_URBAN_ZONES = [
  { lat: 23.7120, lon: 90.4050, radius: 1_600, style: { lotW: 9.5, lotD: 12.5, gap: 0.6, lane: 3.4, minFloors: 3, maxFloors: 7, tower: 0, towerMin: 8, towerMax: 10, organic: 0.1, brick: 0.14 } }, // Old Dhaka & Sadarghat
  { lat: 23.7185, lon: 90.3880, radius: 1_100, style: { lotW: 10, lotD: 13, gap: 0.7, lane: 3.6, minFloors: 3, maxFloors: 6, tower: 0, towerMin: 8, towerMax: 10, organic: 0.1, brick: 0.13 } }, // Lalbagh & Chawkbazar
  { lat: 23.7160, lon: 90.3655, radius: 1_000, style: { lotW: 8.5, lotD: 11, gap: 0.8, lane: 3.6, minFloors: 2, maxFloors: 5, tower: 0, towerMin: 6, towerMax: 8, organic: 0.12, brick: 0.15 } }, // Kamrangirchar
  { lat: 23.7105, lon: 90.4350, radius: 1_100, style: { lotW: 11, lotD: 14, gap: 1, lane: 4, minFloors: 4, maxFloors: 8, tower: 0.01, towerMin: 10, towerMax: 13, organic: 0.06, brick: 0.11 } }, // Jatrabari
  { lat: 23.7280, lon: 90.4190, radius: 1_000, style: { lotW: 19, lotD: 22, gap: 2.5, lane: 7, minFloors: 8, maxFloors: 16, tower: 0.3, towerMin: 16, towerMax: 34, organic: 0.02, brick: 0.04 } }, // Motijheel & Dilkusha
  { lat: 23.7370, lon: 90.4130, radius: 900, style: { lotW: 14, lotD: 17, gap: 1.4, lane: 5, minFloors: 6, maxFloors: 12, tower: 0.08, towerMin: 13, towerMax: 20, organic: 0.03, brick: 0.07 } }, // Paltan, Kakrail & Shantinagar
  { lat: 23.7510, lon: 90.3930, radius: 900, style: { lotW: 18, lotD: 21, gap: 2.5, lane: 7, minFloors: 7, maxFloors: 14, tower: 0.25, towerMin: 14, towerMax: 40, organic: 0.02, brick: 0.04 } }, // Karwan Bazar & Panthapath
  { lat: 23.7590, lon: 90.3920, radius: 900, style: { lotW: 14, lotD: 17, gap: 1.4, lane: 5, minFloors: 6, maxFloors: 11, tower: 0.1, towerMin: 12, towerMax: 36, organic: 0.03, brick: 0.07 } }, // Farmgate & Tejgaon
  { lat: 23.7500, lon: 90.4150, radius: 1_300, style: { lotW: 12.5, lotD: 15, gap: 1.2, lane: 4.5, minFloors: 5, maxFloors: 10, tower: 0.04, towerMin: 11, towerMax: 15, organic: 0.05, brick: 0.09 } }, // Moghbazar, Malibagh & Khilgaon
  { lat: 23.7480, lon: 90.3720, radius: 1_300, style: { lotW: 15, lotD: 18, gap: 1.6, lane: 5, minFloors: 6, maxFloors: 10, tower: 0.04, towerMin: 11, towerMax: 15, organic: 0.02, brick: 0.04 } }, // Dhanmondi & Lalmatia
  { lat: 23.7630, lon: 90.3600, radius: 1_300, style: { lotW: 12, lotD: 15, gap: 1.2, lane: 4.5, minFloors: 5, maxFloors: 9, tower: 0.02, towerMin: 10, towerMax: 13, organic: 0.05, brick: 0.09 } }, // Mohammadpur & Shyamoli
  { lat: 23.8040, lon: 90.3650, radius: 2_300, style: { lotW: 12, lotD: 15, gap: 1, lane: 3.8, minFloors: 5, maxFloors: 9, tower: 0.03, towerMin: 10, towerMax: 14, organic: 0.05, brick: 0.08 } }, // Mirpur & Pallabi
  { lat: 23.7930, lon: 90.4150, radius: 1_400, style: { lotW: 19, lotD: 22, gap: 2.2, lane: 6, minFloors: 7, maxFloors: 14, tower: 0.26, towerMin: 14, towerMax: 26, organic: 0.02, brick: 0.03 } }, // Gulshan & Baridhara
  { lat: 23.7900, lon: 90.4020, radius: 1_000, style: { lotW: 17, lotD: 20, gap: 2, lane: 5.5, minFloors: 6, maxFloors: 13, tower: 0.18, towerMin: 13, towerMax: 24, organic: 0.02, brick: 0.04 } }, // Banani & Mohakhali
  { lat: 23.7700, lon: 90.4300, radius: 1_700, style: { lotW: 11.5, lotD: 14.5, gap: 1.1, lane: 4.2, minFloors: 4, maxFloors: 8, tower: 0.01, towerMin: 9, towerMax: 12, organic: 0.06, brick: 0.1 } }, // Badda, Rampura & Banasree
  { lat: 23.8700, lon: 90.3990, radius: 2_000, style: { lotW: 15, lotD: 18, gap: 2.2, lane: 6.5, minFloors: 6, maxFloors: 10, tower: 0.05, towerMin: 11, towerMax: 16, organic: 0.02, brick: 0.05 } }, // Uttara
  { lat: 23.8190, lon: 90.4340, radius: 1_300, style: { lotW: 17, lotD: 20, gap: 2.6, lane: 7, minFloors: 6, maxFloors: 12, tower: 0.08, towerMin: 13, towerMax: 20, organic: 0.02, brick: 0.04 } }, // Bashundhara
  { lat: 23.7222, lon: 90.3958, radius: 700, style: { lotW: 10, lotD: 13, gap: 0.8, lane: 3.8, minFloors: 3, maxFloors: 7, tower: 0, towerMin: 8, towerMax: 10, organic: 0.09, brick: 0.12 } }, // Bakshibazar & Chankharpul
  { lat: 23.7300, lon: 90.3855, radius: 650, style: { lotW: 11, lotD: 14, gap: 1, lane: 4, minFloors: 4, maxFloors: 8, tower: 0.01, towerMin: 9, towerMax: 12, organic: 0.07, brick: 0.1 } }, // Azimpur & Nilkhet
  { lat: 23.7395, lon: 90.3900, radius: 650, style: { lotW: 13, lotD: 16, gap: 1.3, lane: 4.6, minFloors: 5, maxFloors: 10, tower: 0.05, towerMin: 11, towerMax: 16, organic: 0.04, brick: 0.07 } }, // Shahbag, Elephant Road & Katabon
  { lat: 23.7770, lon: 90.3740, radius: 800, style: { lotW: 30, lotD: 24, gap: 9, lane: 14, minFloors: 6, maxFloors: 12, tower: 0.15, towerMin: 13, towerMax: 20, organic: 0.02, brick: 0.03 } }, // Agargaon government offices
  // Dense 5–9 storey walk-up fabric that used to fall to the default style.
  { lat: 23.7320, lon: 90.4350, radius: 1_300, style: { lotW: 11, lotD: 14, gap: 1, lane: 4, minFloors: 5, maxFloors: 9, tower: 0.01, towerMin: 10, towerMax: 13, organic: 0.06, brick: 0.1 } }, // Mugda, Bashabo & Manda
  { lat: 23.7215, lon: 90.4285, radius: 900, style: { lotW: 11, lotD: 14, gap: 1, lane: 4, minFloors: 5, maxFloors: 9, tower: 0.01, towerMin: 10, towerMax: 13, organic: 0.07, brick: 0.11 } }, // Shahjahanpur, Gopibagh & Kamalapur
  { lat: 23.7470, lon: 90.4370, radius: 1_000, style: { lotW: 11.5, lotD: 14.5, gap: 1.1, lane: 4.2, minFloors: 5, maxFloors: 9, tower: 0.01, towerMin: 10, towerMax: 13, organic: 0.06, brick: 0.1 } }, // Khilgaon, Goran & Madartek
  { lat: 23.6990, lon: 90.4290, radius: 1_100, style: { lotW: 10.5, lotD: 13.5, gap: 1, lane: 4, minFloors: 4, maxFloors: 8, tower: 0, towerMin: 9, towerMax: 12, organic: 0.07, brick: 0.12 } }, // Gendaria, Jurain & Postogola
  { lat: 23.7810, lon: 90.3945, radius: 750, style: { lotW: 15, lotD: 18, gap: 1.8, lane: 5.5, minFloors: 5, maxFloors: 9, tower: 0.03, towerMin: 10, towerMax: 14, organic: 0.02, brick: 0.06 } }, // Mohakhali DOHS
  // Tejgaon Industrial Area: long low sheds, godowns and two- to four-storey
  // factory blocks on big plots, with a few newer office towers.
  { lat: 23.7655, lon: 90.4010, radius: 750, style: { lotW: 26, lotD: 34, gap: 4, lane: 9, minFloors: 2, maxFloors: 4, tower: 0.05, towerMin: 8, towerMax: 18, organic: 0.02, brick: 0.06, tin: 0.3 } }, // Tejgaon industrial area
  { lat: 23.7935, lon: 90.3835, radius: 900, style: { lotW: 11.5, lotD: 14.5, gap: 1.1, lane: 4.2, minFloors: 5, maxFloors: 9, tower: 0.01, towerMin: 10, towerMax: 13, organic: 0.06, brick: 0.1 } }, // Kafrul & Ibrahimpur
  { lat: 23.8300, lon: 90.4190, radius: 1_000, style: { lotW: 12, lotD: 15, gap: 1.2, lane: 4.4, minFloors: 5, maxFloors: 9, tower: 0.02, towerMin: 10, towerMax: 14, organic: 0.04, brick: 0.08 } }, // Nikunja & Khilkhet
  { lat: 23.8560, lon: 90.4270, radius: 1_300, style: { lotW: 11.5, lotD: 14.5, gap: 1.2, lane: 4.4, minFloors: 4, maxFloors: 8, tower: 0, towerMin: 9, towerMax: 12, organic: 0.07, brick: 0.1 } }, // Dakshinkhan & Uttarkhan
  { lat: 23.7400, lon: 90.3600, radius: 1_000, style: { lotW: 11, lotD: 14, gap: 1, lane: 4, minFloors: 4, maxFloors: 8, tower: 0.01, towerMin: 9, towerMax: 12, organic: 0.07, brick: 0.12 } }, // Rayerbazar & Hazaribagh
  // Districts that had a label but fell between the zones above.
  { lat: 23.7240, lon: 90.4110, radius: 600, style: { lotW: 13, lotD: 16, gap: 1, lane: 4, minFloors: 5, maxFloors: 11, tower: 0.06, towerMin: 12, towerMax: 18, organic: 0.04, brick: 0.07 } }, // Gulistan: markets and office blocks
  { lat: 23.7167, lon: 90.4167, radius: 650, style: { lotW: 12, lotD: 15, gap: 1, lane: 4.2, minFloors: 5, maxFloors: 10, tower: 0.02, towerMin: 10, towerMax: 14, organic: 0.05, brick: 0.1 } }, // Wari
  { lat: 23.7065, lon: 90.4169, radius: 650, style: { lotW: 10, lotD: 13, gap: 0.7, lane: 3.6, minFloors: 3, maxFloors: 7, tower: 0, towerMin: 8, towerMax: 10, organic: 0.1, brick: 0.13 } }, // Sutrapur & Farashganj
  { lat: 23.7805, lon: 90.3480, radius: 800, style: { lotW: 11, lotD: 14, gap: 1.2, lane: 4.4, minFloors: 2, maxFloors: 6, tower: 0, towerMin: 8, towerMax: 10, organic: 0.1, brick: 0.1, tin: 0.12 } }, // Gabtoli
  { lat: 23.7813, lon: 90.3570, radius: 650, style: { lotW: 11.5, lotD: 14.5, gap: 1.1, lane: 4.2, minFloors: 4, maxFloors: 8, tower: 0.01, towerMin: 9, towerMax: 12, organic: 0.07, brick: 0.1 } }, // Kallyanpur
  { lat: 23.8370, lon: 90.3694, radius: 550, style: { lotW: 16, lotD: 19, gap: 2, lane: 6, minFloors: 6, maxFloors: 8, tower: 0, towerMin: 9, towerMax: 10, organic: 0.01, brick: 0.03 } }, // Mirpur DOHS: planned six- to eight-storey blocks
  { lat: 23.6850, lon: 90.4465, radius: 1_000, style: { lotW: 12, lotD: 15, gap: 1.2, lane: 4.4, minFloors: 3, maxFloors: 7, tower: 0, towerMin: 8, towerMax: 10, organic: 0.08, brick: 0.12, tin: 0.08 } }, // Shyampur
  { lat: 23.8915, lon: 90.4023, radius: 1_200, style: { lotW: 13, lotD: 16, gap: 1.4, lane: 4.6, minFloors: 3, maxFloors: 7, tower: 0, towerMin: 8, towerMax: 10, organic: 0.06, brick: 0.1, tin: 0.06 } }, // Tongi
  { lat: 23.8975, lon: 90.3243, radius: 1_400, style: { lotW: 18, lotD: 24, gap: 3, lane: 7, minFloors: 2, maxFloors: 6, tower: 0, towerMin: 8, towerMax: 10, organic: 0.05, brick: 0.08, tin: 0.15 } }, // Ashulia: garment factories among fields
  // Korail, on the west shore of Banani Lake: one- and two-storey tin-roofed
  // shacks packed along narrow lanes (Esri World Imagery), a wedge that is
  // widest at the lake. Three overlapping zones follow its shape; `weight`
  // lets them outvote the taller Banani and Mohakhali fabric round them.
  { lat: 23.7848, lon: 90.4120, radius: 300, weight: 4, style: { lotW: 6, lotD: 8, gap: 0.45, lane: 2.2, minFloors: 2, maxFloors: 2, tower: 0, towerMin: 6, towerMax: 6, organic: 0.3, brick: 0.02, tin: 0.8 } }, // Korail, lake end
  { lat: 23.7843, lon: 90.4088, radius: 260, weight: 4, style: { lotW: 6, lotD: 8, gap: 0.45, lane: 2.2, minFloors: 2, maxFloors: 2, tower: 0, towerMin: 6, towerMax: 6, organic: 0.3, brick: 0.02, tin: 0.8 } }, // Korail, middle
  { lat: 23.7845, lon: 90.4060, radius: 190, weight: 4, style: { lotW: 6, lotD: 8, gap: 0.45, lane: 2.2, minFloors: 2, maxFloors: 2, tower: 0, towerMin: 6, towerMax: 6, organic: 0.3, brick: 0.02, tin: 0.8 } }, // Korail, west tip
].map((zone: { lat: number; lon: number; radius: number; weight?: number; style: Partial<UrbanStyle> }) => {
  const world = coordinatesToWorld(zone.lat, zone.lon);
  return { x: world.x, z: world.y, radius: zone.radius, weight: zone.weight ?? 1, style: zone.style };
});

/** Blended district style at a point, plus how strongly any district claims it (0–1). */
function dhakaUrbanFabric(x: number, z: number) {
  const baseInfluence = 0.3;
  const sums = {} as Record<keyof UrbanStyle, number>;
  for (const key of URBAN_STYLE_KEYS) sums[key] = DEFAULT_URBAN_STYLE[key] * baseInfluence;
  let totalInfluence = baseInfluence;
  let strongest = 0;
  for (const zone of DHAKA_URBAN_ZONES) {
    const dist = Math.hypot(x - zone.x, z - zone.z);
    if (dist >= zone.radius) continue;
    const t = 1 - dist / zone.radius;
    const influence = t * t * (3 - 2 * t);
    const weighted = influence * zone.weight;
    for (const key of URBAN_STYLE_KEYS) sums[key] += (zone.style[key] ?? DEFAULT_URBAN_STYLE[key]) * weighted;
    totalInfluence += weighted;
    strongest = Math.max(strongest, influence);
  }
  for (const key of URBAN_STYLE_KEYS) sums[key] /= totalInfluence;
  return { style: sums as UrbanStyle, zoneInfluence: strongest };
}

// Dhaka masonry palette for procedural buildings, as the city reads from the
// air: a grey-cream crust of sun-bleached plaster and rain-stained concrete,
// the odd pastel repaint, a little dark bare brick, a few teal, sky-blue, mint
// and pink facades, and blue glass or white cladding on towers. The glass
// shades are blue enough for the facade shader to treat them as curtain wall.
const PLASTER_SHADES = [0xd2ccc1, 0xc4beb4, 0xcbbfa8, 0xd9d3c8, 0xbdb8ae, 0xcfcac2, 0xb7b1a6];
const PASTEL_SHADES = [0xd3bba6, 0xc3cab8, 0xbcc5c8, 0xd6c596, 0xcdb0ae];
const ACCENT_SHADES = [0x4f9a96, 0x86b6d6, 0x9fd0b4, 0xdc9aa8, 0x5fa7a2, 0xd9a05f];
const BRICK_SHADES = [0x8a5a4a, 0x7d5245, 0x94624f];
const WEATHERED_SHADES = [0x9a958c, 0x8a867e, 0xa39f97, 0x7f7b74];
const TOWER_SHADES = [0x4a6a80, 0x55788c, 0x3f5a6e, 0x648497, 0xd6d6d0, 0xc9c6bf, 0xe0ddd6, 0xb4b8ba, 0xcfc8b8, 0xa9adb0];
// Corrugated tin over low buildings and plastic rooftop water tanks. These are
// saturated (or near black) on purpose: the facade shader keeps such colours
// and weathers every other roof to concrete grey.
const TIN_ROOF_SHADES = [0x2a6fbf, 0x2366b0, 0x245fa6, 0x1a7040, 0xa8401f, 0x9a3a1c];
// Informal settlements (styles with tin > 0.45, Korail): mostly rusted brown
// and bare grey sheet, the grey left to weather to concrete, the odd blue one.
const SETTLEMENT_TIN_SHADES = [0x7a4426, 0x8a4c2a, 0x6b3d24, 0x8d8f8c, 0x7f8280, 0x8d8f8c, 0x2a6fbf];
const WATER_TANK_SHADES = [0x141416, 0x18181b, 0x1f5fae, 0x141416];

function pickBuildingShade(target: THREE.Color, style: UrbanStyle, tower: boolean, height: number, random: () => number) {
  const pick = (shades: number[]) => shades[Math.floor(random() * shades.length)];
  const roll = random();
  let hex: number;
  if (tower || (height > 40 && roll < 0.2)) hex = pick(TOWER_SHADES);
  else if (roll < style.brick) hex = pick(BRICK_SHADES);
  else if (roll < style.brick + 0.09) hex = pick(PASTEL_SHADES);
  else if (roll < style.brick + 0.09 + 0.045) hex = pick(ACCENT_SHADES);
  else if (roll < style.brick + 0.135 + 0.2) hex = pick(WEATHERED_SHADES);
  else hex = pick(PLASTER_SHADES);
  return target.setHex(hex).offsetHSL(0, (random() - 0.5) * 0.04, (random() - 0.5) * 0.05);
}

const FOOTPRINT_CELL = 24;
const FOOTPRINT_COLUMNS = Math.ceil(460 / FOOTPRINT_CELL) + 1;

/**
 * Separating-axis test for two yawed rectangles on the ground plane. Each is a
 * centre, the cos/sin of its yaw (local X runs along (cos, -sin) in world x/z,
 * as THREE's Y rotation maps it) and half extents; `gap` is the clear space
 * required between them.
 */
function orientedRectsOverlap(
  ax: number, az: number, aCos: number, aSin: number, aHalfWidth: number, aHalfDepth: number,
  bx: number, bz: number, bCos: number, bSin: number, bHalfWidth: number, bHalfDepth: number,
  gap: number,
) {
  const dx = bx - ax;
  const dz = bz - az;
  const parallel = Math.abs(aCos * bCos + aSin * bSin);
  const cross = Math.abs(aCos * bSin - aSin * bCos);
  if (Math.abs(dx * aCos - dz * aSin) >= aHalfWidth + bHalfWidth * parallel + bHalfDepth * cross + gap) return false;
  if (Math.abs(dx * aSin + dz * aCos) >= aHalfDepth + bHalfWidth * cross + bHalfDepth * parallel + gap) return false;
  if (Math.abs(dx * bCos - dz * bSin) >= bHalfWidth + aHalfWidth * parallel + aHalfDepth * cross + gap) return false;
  if (Math.abs(dx * bSin + dz * bCos) >= bHalfDepth + aHalfWidth * cross + aHalfDepth * parallel + gap) return false;
  return true;
}

/**
 * Drawn width of a non-area OSM waterway (0 = not drawn). The bundled map
 * carries no waterway tags, so total length stands in for them: Old Dhaka's
 * web of short, mostly covered drains is skipped, streams and khals draw
 * narrow, and only long lines (canals, river centrelines) keep 8 m.
 */
function waterLineWidth(points: MapPoint[]) {
  let length = 0;
  for (let index = 1; index < points.length; index++) {
    length += Math.hypot(points[index][0] - points[index - 1][0], points[index][1] - points[index - 1][1]);
  }
  if (length < 400) return 0;
  return length < 1_500 ? 3 : 8;
}

function polygonArea2D(points: MapPoint[]) {
  let area = 0;
  for (let index = 0; index < points.length; index++) {
    const [x1, z1] = points[index];
    const [x2, z2] = points[(index + 1) % points.length];
    area += x1 * z2 - x2 * z1;
  }
  return Math.abs(area) * 0.5;
}

/** Clip a world-space segment against every airfield's rotated runway and apron rectangles. */
function clipSegmentOutsideAirport(
  x1: number,
  z1: number,
  x2: number,
  z2: number,
  pad = 0,
): Array<[number, number, number, number]> {
  let surviving: Array<[number, number]> = [[0, 1]];

  for (const field of AIRFIELD_CLEARANCES) {
    const reach = field.reach + pad;
    if (Math.min(x1, x2) - field.x > reach || field.x - Math.max(x1, x2) > reach) continue;
    if (Math.min(z1, z2) - field.z > reach || field.z - Math.max(z1, z2) > reach) continue;
    const [lx1, lz1] = toAirfieldLocal(field, x1, z1);
    const [lx2, lz2] = toAirfieldLocal(field, x2, z2);
    const dlx = lx2 - lx1;
    const dlz = lz2 - lz1;
    for (const rect of field.rects) {
      const minX = rect.minX - pad;
      const maxX = rect.maxX + pad;
      const minZ = rect.minZ - pad;
      const maxZ = rect.maxZ + pad;
      let tEnter = 0;
      let tExit = 1;
      let intersects = true;

      if (Math.abs(dlx) < 1e-9) {
        if (lx1 <= minX || lx1 >= maxX) intersects = false;
      } else {
        let tx0 = (minX - lx1) / dlx;
        let tx1 = (maxX - lx1) / dlx;
        if (tx0 > tx1) [tx0, tx1] = [tx1, tx0];
        tEnter = Math.max(tEnter, tx0);
        tExit = Math.min(tExit, tx1);
      }

      if (intersects) {
        if (Math.abs(dlz) < 1e-9) {
          if (lz1 <= minZ || lz1 >= maxZ) intersects = false;
        } else {
          let tz0 = (minZ - lz1) / dlz;
          let tz1 = (maxZ - lz1) / dlz;
          if (tz0 > tz1) [tz0, tz1] = [tz1, tz0];
          tEnter = Math.max(tEnter, tz0);
          tExit = Math.min(tExit, tz1);
        }
      }

      if (!intersects || tEnter >= tExit) continue;
      const next: Array<[number, number]> = [];
      for (const [start, end] of surviving) {
        if (tExit <= start || tEnter >= end) {
          next.push([start, end]);
          continue;
        }
        if (tEnter > start + 1e-4) next.push([start, tEnter]);
        if (tExit < end - 1e-4) next.push([tExit, end]);
      }
      surviving = next;
      if (surviving.length === 0) return [];
    }
  }

  return surviving.map(([a, b]) => [
    x1 + (x2 - x1) * a,
    z1 + (z2 - z1) * a,
    x1 + (x2 - x1) * b,
    z1 + (z2 - z1) * b,
  ]);
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
    // Ways rebuilt as elevated decks carry no ground-level traffic.
    const ground = longestGroundRun(road);
    if (!ground) return [];
    const points = ground.filter(([x, z]) => Number.isFinite(x) && Number.isFinite(z));
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

type ElevatedTrafficRoute = {
  points: MapPoint[];
  ys: number[];
  length: number;
  /** Two-way decks (the river bridges) turn round at their ends like streets. */
  oneWay: boolean;
  /** Lane centres, metres to the right of the direction of travel. */
  laneOffsets: number[];
  /**
   * Where a one-way chain runs on: the route, segment and distance into it,
   * and which way along that route's points to drive (a ramp can join a
   * two-way bridge against the order its points are stored in).
   */
  successors: Array<{ route: number; index: number; progress: number; direction: 1 | -1 }>;
  /** Largest vehicle scale whose width fits between neighbouring lanes. */
  maxScale: number;
};

/**
 * The decks of app/elevated-roads.ts as traffic routes: one per chain, with
 * the deck height at every cross-section. Chains are drawn in the direction
 * of travel, so on one-way decks a vehicle that reaches the end of a ramp or
 * carriageway runs on into the deck it joins.
 */
function elevatedTrafficRoutes(): ElevatedTrafficRoute[] {
  const chains = elevatedRoadLayouts().flatMap(({ chains: roadChains }) => roadChains
    .filter((chain) => !chain.atGrade && chain.rings.length >= 2)
    .map((chain) => ({ chain })));
  const routes: ElevatedTrafficRoute[] = chains.map(({ chain }) => {
    const oneWay = !chain.twoWay;
    // Lane centres across the deck, inside the parapets, for a ~3 m vehicle.
    // A two-way deck keeps each direction to its left half, as Dhaka drives.
    const usable = Math.max(0, chain.half - 0.45 - 1.7);
    const lanes = Math.max(1, chain.lanes);
    const laneOffsets = oneWay
      ? Array.from({ length: lanes }, (_, lane) => (lanes === 1 ? 0 : -usable + (2 * usable * lane) / (lanes - 1)))
      : [-Math.max(1.6, usable * 0.6)];
    // Vehicles are 3 m wide at scale 1: on a narrow two-lane ramp (lane
    // centres 2.2 m apart on Moghbazar) they are drawn smaller so neighbours
    // never overlap when one passes the other.
    const laneSpacing = laneOffsets.length > 1 ? Math.abs(laneOffsets[1] - laneOffsets[0]) : Infinity;
    const maxScale = Math.min(1.25, (laneSpacing - 0.15) / 3);
    return {
      points: chain.rings.map((ring) => [ring.x, ring.z] as MapPoint),
      ys: chain.rings.map((ring) => ring.top + chain.lift + (TRAFFIC_GROUND_Y - ELEVATED_ROAD_GROUND)),
      length: chain.length,
      oneWay,
      laneOffsets,
      successors: [],
      maxScale,
    };
  });
  chains.forEach(({ chain }, index) => {
    if (!routes[index].oneWay) return;
    const end = chain.rings[chain.rings.length - 1];
    const before = chain.rings[chain.rings.length - 2];
    chains.forEach(({ chain: other }, otherIndex) => {
      if (otherIndex === index) return;
      const near = other.nearest(end.x, end.z);
      if (near.distance > Math.max(3, other.half) || Math.abs(other.at(near.s).top - end.top) > 1.5) return;
      // Enter at the merge point itself: the segment that contains it and
      // the distance into that segment.
      const next = other.rings.findIndex((ring) => ring.s > near.s);
      if (next <= 0) return;
      const a = other.rings[next - 1];
      const b = other.rings[next];
      const along = near.s - a.s;
      // Drive the way the ramp is heading. Against the stored order a vehicle
      // starts from the segment's far end and counts its progress from there.
      const forward = (b.x - a.x) * (end.x - before.x) + (b.z - a.z) * (end.z - before.z) >= 0;
      // A one-way deck is only ever joined in its own direction.
      if (!forward && routes[otherIndex].oneWay) return;
      routes[index].successors.push(forward
        ? { route: otherIndex, index: next - 1, progress: along, direction: 1 }
        : { route: otherIndex, index: next, progress: Math.max(0, b.s - a.s - along), direction: -1 });
    });
  });
  return routes;
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
  const elevatedRoutes = elevatedTrafficRoutes();
  // A vehicle whose ramp lands on the street starts again at the head of a
  // one-way deck (never on a two-way bridge, which would collect them).
  const respawnRoutes = elevatedRoutes.flatMap((route, index) => (route.oneWay ? [index] : []));
  const elevatedLength = elevatedRoutes.reduce((sum, route) => sum + route.length, 0);
  const elevatedTotal = Math.min(TRAFFIC_ELEVATED_MAX_VEHICLES, Math.round(elevatedLength / TRAFFIC_ELEVATED_METERS_PER_VEHICLE));
  const groundTotal = vehicleTotal;
  const instanceTotal = groundTotal + elevatedTotal;
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
  const bodies = new THREE.InstancedMesh(bodyGeometry, bodyMaterial, instanceTotal);
  const cabins = new THREE.InstancedMesh(cabinGeometry, cabinMaterial, instanceTotal);
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
      TRAFFIC_GROUND_Y,
      THREE.MathUtils.lerp(start[1], end[1], ratio) + Math.cos(heading) * laneOffset * direction,
    );
    const major = ["motorway", "trunk", "primary", "secondary"].includes(road.kind);
    const baseSpeed = major ? 11 + random() * 8 : 6 + random() * 6;
    vehicles.push({
      route: road.points,
      routeY: null,
      elevatedRoute: -1,
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
    bodies.setColorAt(elevatedTotal + index, new THREE.Color(palette[index % palette.length]));
  }
  // Deck traffic, spread along the chains by length. It goes at the front of
  // the instance list so it is drawn from the first frame (the street traffic
  // fades in over the first seconds) and never roams.
  const deckVehicles: TrafficVehicle[] = [];
  const routeAtDistance = (distance: number) => {
    for (const [index, route] of elevatedRoutes.entries()) {
      if (distance < route.length) return { index, route, along: distance };
      distance -= route.length;
    }
    return { index: 0, route: elevatedRoutes[0], along: 0 };
  };
  for (let index = 0; index < elevatedTotal; index++) {
    const { index: routeIndex, route, along } = routeAtDistance(((index + random() * 0.8) / elevatedTotal) * elevatedLength);
    let segmentIndex = 0;
    let travelled = 0;
    while (segmentIndex < route.points.length - 2) {
      const step = Math.hypot(route.points[segmentIndex + 1][0] - route.points[segmentIndex][0], route.points[segmentIndex + 1][1] - route.points[segmentIndex][1]);
      if (travelled + step > along) break;
      travelled += step;
      segmentIndex++;
    }
    const direction: 1 | -1 = route.oneWay || random() > 0.5 ? 1 : -1;
    if (direction === -1) segmentIndex++;
    const baseSpeed = 12 + random() * 8;
    const position = new THREE.Vector3();
    const vehicle: TrafficVehicle = {
      route: route.points,
      routeY: route.ys,
      elevatedRoute: routeIndex,
      segmentIndex,
      segmentProgress: 0,
      direction,
      laneOffset: route.laneOffsets[Math.floor(random() * route.laneOffsets.length)],
      sizeScale: Math.min(route.maxScale, 0.85 + random() * 0.4),
      speed: baseSpeed,
      baseSpeed,
      phase: random() * Math.PI * 2,
      position,
      previousPosition: position.clone(),
      heading: 0,
      previousHeading: 0,
    };
    deckVehicles.push(vehicle);
    bodies.setColorAt(index, new THREE.Color(palette[(index * 3 + 1) % palette.length]));
  }
  vehicles.unshift(...deckVehicles);
  if (bodies.instanceColor) bodies.instanceColor.needsUpdate = true;

  let simulationTime = 0;
  let accumulator = 0;
  let overloadCooldown = 0;
  let currentTickHz = TRAFFIC_BASE_TICK_HZ;
  let visibleVehicles = elevatedTotal + Math.min(vehicleTotal, Math.max(8, Math.floor(vehicleTotal * 0.18)));
  const matrix = new THREE.Matrix4();
  const quaternion = new THREE.Quaternion();
  const scale = new THREE.Vector3(1, 1, 1);
  const renderPosition = new THREE.Vector3();
  const up = new THREE.Vector3(0, 1, 0);

  // Put a deck vehicle onto an elevated route at a given point.
  const enterRoute = (vehicle: TrafficVehicle, next: { route: number; index: number; progress: number; direction: 1 | -1 }, visitor: boolean) => {
    const route = elevatedRoutes[next.route];
    vehicle.elevatedRoute = next.route;
    vehicle.route = route.points;
    vehicle.routeY = route.ys;
    vehicle.direction = next.direction;
    vehicle.segmentIndex = Math.max(0, Math.min(next.index, route.points.length - 1));
    vehicle.segmentProgress = next.progress;
    vehicle.visitor = visitor;
    vehicle.sizeScale = Math.min(vehicle.sizeScale, route.maxScale);
    if (!route.laneOffsets.includes(vehicle.laneOffset)) vehicle.laneOffset = route.laneOffsets[Math.floor(random() * route.laneOffsets.length)];
  };
  // A ramp that lands on the street, or a visitor reaching a bridge end,
  // starts again at the head of a one-way deck (never on a two-way bridge,
  // which would collect them).
  const respawnOnDeck = (vehicle: TrafficVehicle) => {
    enterRoute(vehicle, { route: respawnRoutes[Math.floor(random() * respawnRoutes.length)], index: 0, progress: 0, direction: 1 }, false);
  };
  const stepVehicle = (vehicle: TrafficVehicle, step: number) => {
    vehicle.previousPosition.copy(vehicle.position);
    vehicle.previousHeading = vehicle.heading;
    const flow = 0.82 + Math.sin(simulationTime * 0.42 + vehicle.phase) * 0.18;
    vehicle.speed = THREE.MathUtils.lerp(vehicle.speed, vehicle.baseSpeed * flow, 1 - Math.exp(-1.2 * step));
    let remaining = vehicle.speed * step;
    let guard = 0;
    let jumped = false;
    // At the end of its route a vehicle turns round, unless it is on a deck:
    // a one-way deck runs on into the deck it joins (or, landing on the
    // street, sends it back to a deck start), and a ramp's visitor to a
    // two-way bridge leaves at the bridge end.
    const nextAfterEnd = () => {
      let nextIndex = vehicle.segmentIndex + vehicle.direction;
      if (nextIndex >= 0 && nextIndex < vehicle.route.length) return nextIndex;
      const current = vehicle.elevatedRoute >= 0 ? elevatedRoutes[vehicle.elevatedRoute] : null;
      if (current?.oneWay && current.successors.length > 0) {
        const next = current.successors[Math.floor(random() * current.successors.length)];
        enterRoute(vehicle, next, !elevatedRoutes[next.route].oneWay);
      } else if (current?.oneWay || (current && vehicle.visitor)) {
        respawnOnDeck(vehicle);
        jumped = true;
      }
      nextIndex = vehicle.segmentIndex + vehicle.direction;
      if (nextIndex < 0 || nextIndex >= vehicle.route.length) {
        vehicle.direction = vehicle.direction === 1 ? -1 : 1;
        nextIndex = vehicle.segmentIndex + vehicle.direction;
        vehicle.segmentProgress = 0;
      }
      return nextIndex;
    };
    while (remaining > 0 && guard++ < 8) {
      const nextIndex = nextAfterEnd();
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
    const nextIndex = nextAfterEnd();
    const start = vehicle.route[vehicle.segmentIndex];
    const end = vehicle.route[nextIndex];
    const dx = end[0] - start[0];
    const dz = end[1] - start[1];
    const segmentLength = Math.max(0.01, Math.hypot(dx, dz));
    const ratio = clamp(vehicle.segmentProgress / segmentLength, 0, 1);
    vehicle.heading = Math.atan2(dz, dx);
    // The heading already turns with the direction of travel, so deck lanes
    // (measured from it) are not flipped again; street lanes keep their sign.
    const side = vehicle.routeY ? vehicle.laneOffset : vehicle.laneOffset * vehicle.direction;
    vehicle.position.set(
      THREE.MathUtils.lerp(start[0], end[0], ratio) - Math.sin(vehicle.heading) * side,
      vehicle.routeY ? THREE.MathUtils.lerp(vehicle.routeY[vehicle.segmentIndex], vehicle.routeY[nextIndex], ratio) : TRAFFIC_GROUND_Y,
      THREE.MathUtils.lerp(start[1], end[1], ratio) + Math.cos(vehicle.heading) * side,
    );
    // No streak across the city when a vehicle is sent back to a deck start.
    if (jumped) {
      vehicle.previousPosition.copy(vehicle.position);
      vehicle.previousHeading = vehicle.heading;
    }
  };

  const renderVehicles = (alpha: number) => {
    visibleVehicles = Math.min(instanceTotal, Math.max(visibleVehicles, elevatedTotal + Math.floor(12 + simulationTime * 120)));
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

  // A city-wide spread leaves only a handful of vehicles in view, so every
  // third one roams: once it is far behind the haze it is put back on a major
  // road near the viewer (never close enough to be seen appearing). The
  // instance count and draw calls stay what they were.
  const majorKindSet = new Set(["motorway", "trunk", "primary", "secondary"]);
  const localRoads = roads.flatMap((road) => {
    const points = (longestGroundRun(road) ?? []).filter(([x, z]) => Number.isFinite(x) && Number.isFinite(z));
    if (!majorKindSet.has(road.kind) || points.length < 2) return [];
    const middle = points[Math.floor(points.length / 2)];
    return [{ points, x: middle[0], z: middle[1], width: road.kind === "motorway" || road.kind === "trunk" ? 17 : 14 }];
  });
  const ROAM_RADIUS = 1_700;
  const ROAM_MIN_SPAWN = 520;
  let anchorX = Number.NaN;
  let anchorZ = Number.NaN;
  let nearbyX = Infinity;
  let nearbyZ = Infinity;
  let nearbyRoads: typeof localRoads = [];
  let roamCursor = 0;
  const recallRoamingVehicles = () => {
    if (!Number.isFinite(anchorX) || localRoads.length === 0) return;
    if (Math.hypot(anchorX - nearbyX, anchorZ - nearbyZ) > 350) {
      nearbyX = anchorX;
      nearbyZ = anchorZ;
      nearbyRoads = localRoads.filter((road) => Math.hypot(road.x - anchorX, road.z - anchorZ) < ROAM_RADIUS - 300);
    }
    if (nearbyRoads.length === 0) return;
    for (let attempt = 0; attempt < 30; attempt++) {
      roamCursor = (roamCursor + 3) % groundTotal;
      const vehicle = vehicles[elevatedTotal + roamCursor];
      if (Math.hypot(vehicle.position.x - anchorX, vehicle.position.z - anchorZ) < ROAM_RADIUS) continue;
      const road = nearbyRoads[Math.floor(random() * nearbyRoads.length)];
      const direction: 1 | -1 = random() > 0.5 ? 1 : -1;
      const segmentIndex = direction === 1
        ? Math.floor(random() * (road.points.length - 1))
        : 1 + Math.floor(random() * (road.points.length - 1));
      const start = road.points[segmentIndex];
      const distance = Math.hypot(start[0] - anchorX, start[1] - anchorZ);
      if (distance < ROAM_MIN_SPAWN || distance > ROAM_RADIUS - 100) continue;
      vehicle.route = road.points;
      vehicle.direction = direction;
      vehicle.segmentIndex = segmentIndex;
      vehicle.segmentProgress = 0;
      vehicle.laneOffset = road.width * 0.24 + random() * 0.6;
      const end = road.points[segmentIndex + direction];
      vehicle.heading = Math.atan2(end[1] - start[1], end[0] - start[0]);
      vehicle.previousHeading = vehicle.heading;
      vehicle.position.set(
        start[0] - Math.sin(vehicle.heading) * vehicle.laneOffset * direction,
        TRAFFIC_GROUND_Y,
        start[1] + Math.cos(vehicle.heading) * vehicle.laneOffset * direction,
      );
      vehicle.previousPosition.copy(vehicle.position);
    }
  };

  // Put the deck vehicles on their decks before the first frame.
  for (const vehicle of deckVehicles) {
    stepVehicle(vehicle, 0);
    vehicle.previousPosition.copy(vehicle.position);
    vehicle.previousHeading = vehicle.heading;
  }
  renderVehicles(1);
  return {
    follow(anchor) {
      anchorX = anchor.x;
      anchorZ = anchor.z;
    },
    update(dt, frameMs) {
      overloadCooldown = frameMs > TRAFFIC_LONG_FRAME_MS ? 2.5 : Math.max(0, overloadCooldown - dt);
      currentTickHz = overloadCooldown > 0 ? TRAFFIC_THROTTLED_TICK_HZ : TRAFFIC_BASE_TICK_HZ;
      const step = 1 / currentTickHz;
      accumulator = Math.min(accumulator + dt, step * TRAFFIC_MAX_CATCH_UP_STEPS);
      let steps = 0;
      while (accumulator >= step && steps < TRAFFIC_MAX_CATCH_UP_STEPS) {
        simulationTime += step;
        recallRoamingVehicles();
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

function createAirflowVfx(scene: THREE.Scene, crow: THREE.Group): AirflowVfx {
  const random = seededRandom(2_606);
  // World-space air motes sit in the sky around the bird rather than rotating
  // with its pitch and roll, so climbing carries you up through falling wisps
  // and diving plunges you down through rising ones.
  const streakCount = 44;
  const positions = new Float32Array(streakCount * 6);
  const streaks = Array.from({ length: streakCount }, () => ({
    x: 0,
    y: 0,
    z: 0,
    lengthScale: 0.65 + random() * 0.85,
    drift: (random() - 0.5) * 1.4,
  }));
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  const material = new THREE.LineBasicMaterial({
    color: 0xe8f6f8,
    transparent: true,
    opacity: 0,
    depthWrite: false,
    toneMapped: false,
  });
  const lines = new THREE.LineSegments(geometry, material);
  lines.frustumCulled = false;
  lines.renderOrder = 20;
  lines.visible = false;
  scene.add(lines);

  // Twin gossamer slipstream ribbons peel off the outermost primary tips during
  // steep dives, swoops, climbs, and boost surges, tracing the bird's 3D arc.
  const trailSamples = 20;
  const ribbonVertexCount = 2 * trailSamples * 2;
  const ribbonPositions = new Float32Array(ribbonVertexCount * 3);
  const ribbonAlphas = new Float32Array(ribbonVertexCount);
  const ribbonIndices: number[] = [];
  for (let wing = 0; wing < 2; wing++) {
    const base = wing * trailSamples * 2;
    for (let i = 0; i < trailSamples; i++) {
      const t = i / (trailSamples - 1);
      // Fade in just behind the feather tip and taper smoothly to nothing.
      const fade = Math.sin(Math.min(1, t * 5.5) * (Math.PI * 0.5)) * Math.pow(1 - t, 1.45);
      ribbonAlphas[base + i * 2] = fade;
      ribbonAlphas[base + i * 2 + 1] = fade;
      if (i + 1 < trailSamples) {
        const a = base + i * 2;
        const b = a + 1;
        const c = a + 2;
        const d = a + 3;
        ribbonIndices.push(a, c, b, b, c, d);
      }
    }
  }
  const ribbonGeometry = new THREE.BufferGeometry();
  const ribbonPosAttr = new THREE.BufferAttribute(ribbonPositions, 3);
  ribbonGeometry.setAttribute("position", ribbonPosAttr);
  ribbonGeometry.setAttribute("aAlpha", new THREE.BufferAttribute(ribbonAlphas, 1));
  ribbonGeometry.setIndex(ribbonIndices);
  const ribbonUniforms = {
    uColor: { value: new THREE.Color(0xf0fafb) },
    uOpacity: { value: 0 },
  };
  const ribbonMaterial = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    toneMapped: false,
    side: THREE.DoubleSide,
    uniforms: ribbonUniforms,
    vertexShader: `
      attribute float aAlpha;
      varying float vAlpha;
      void main() {
        vAlpha = aAlpha;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      uniform vec3 uColor;
      uniform float uOpacity;
      varying float vAlpha;
      void main() {
        gl_FragColor = vec4(uColor, vAlpha * uOpacity);
      }
    `,
  });
  const ribbon = new THREE.Mesh(ribbonGeometry, ribbonMaterial);
  ribbon.frustumCulled = false;
  ribbon.renderOrder = 19;
  ribbon.visible = false;
  scene.add(ribbon);

  const leftHistory = new Float32Array(trailSamples * 3);
  const rightHistory = new Float32Array(trailSamples * 3);
  let leftTip: THREE.Object3D | null = null;
  let rightTip: THREE.Object3D | null = null;
  let trailPrimed = false;
  let streaksPrimed = false;
  let smoothedTrailOpacity = 0;
  const lastBirdPos = new THREE.Vector3();
  const anchor = new THREE.Vector3();
  const velDir = new THREE.Vector3(0, 0, -1);
  const tipL = new THREE.Vector3();
  const tipR = new THREE.Vector3();
  const prevTipL = new THREE.Vector3();
  const tangent = new THREE.Vector3();
  const toCam = new THREE.Vector3();
  const sideVec = new THREE.Vector3();

  const halfX = 28;
  const halfY = 22;
  const halfZ = 28;

  const respawnStreak = (streak: (typeof streaks)[number], forwardBias: boolean) => {
    let ox = (random() - 0.5) * halfX * 2;
    let oy = (random() - 0.5) * halfY * 2;
    let oz = (random() - 0.5) * halfZ * 2;
    if (forwardBias) {
      const along = ox * velDir.x + oy * velDir.y + oz * velDir.z;
      if (along < 4) {
        const push = (4 - along) + random() * 16;
        ox += velDir.x * push;
        oy += velDir.y * push;
        oz += velDir.z * push;
      }
    }
    streak.x = anchor.x + clamp(ox, -halfX, halfX);
    streak.y = anchor.y + clamp(oy, -halfY, halfY);
    streak.z = anchor.z + clamp(oz, -halfZ, halfZ);
    // Keep wisps out of the bird's immediate body & camera line so streaks frame
    // the periphery rather than stabbing across the wings.
    const bx = streak.x - crow.position.x;
    const by = streak.y - crow.position.y;
    const bz = streak.z - crow.position.z;
    const distSq = bx * bx + by * by + bz * bz;
    if (distSq < 36) {
      const inv = 6.2 / Math.max(Math.sqrt(distSq), 0.001);
      streak.x = crow.position.x + bx * inv;
      streak.y = crow.position.y + by * inv;
      streak.z = crow.position.z + bz * inv;
    }
  };

  const writeRibbonWing = (history: Float32Array, wingIndex: number, cameraPosition: THREE.Vector3, widthScale: number) => {
    const baseVertex = wingIndex * trailSamples * 2;
    for (let i = 0; i < trailSamples; i++) {
      const idx = i * 3;
      const px = history[idx];
      const py = history[idx + 1];
      const pz = history[idx + 2];
      const prevIdx = Math.max(0, i - 1) * 3;
      const nextIdx = Math.min(trailSamples - 1, i + 1) * 3;
      tangent.set(
        history[prevIdx] - history[nextIdx],
        history[prevIdx + 1] - history[nextIdx + 1],
        history[prevIdx + 2] - history[nextIdx + 2],
      );
      if (tangent.lengthSq() < 1e-6) tangent.copy(velDir);
      else tangent.normalize();
      toCam.set(cameraPosition.x - px, cameraPosition.y - py, cameraPosition.z - pz);
      sideVec.crossVectors(tangent, toCam);
      if (sideVec.lengthSq() < 1e-6) sideVec.set(1, 0, 0);
      else sideVec.normalize();

      const t = i / (trailSamples - 1);
      const halfWidth = widthScale * Math.sin(Math.pow(1 - t, 0.72) * Math.PI * 0.88);
      const v0 = (baseVertex + i * 2) * 3;
      const v1 = v0 + 3;
      ribbonPositions[v0] = px - sideVec.x * halfWidth;
      ribbonPositions[v0 + 1] = py - sideVec.y * halfWidth;
      ribbonPositions[v0 + 2] = pz - sideVec.z * halfWidth;
      ribbonPositions[v1] = px + sideVec.x * halfWidth;
      ribbonPositions[v1 + 1] = py + sideVec.y * halfWidth;
      ribbonPositions[v1 + 2] = pz + sideVec.z * halfWidth;
    }
  };

  return {
    setWingtips(left, right) {
      leftTip = left;
      rightTip = right;
      trailPrimed = false;
    },
    update(dt, velocity, cameraPosition, speedAmount, verticalSpeed, boosting, active, reducedMotion) {
      const flowSpeed = velocity.length();
      if (flowSpeed > 0.5) velDir.copy(velocity).divideScalar(flowSpeed);

      const verticalEffort = clamp((Math.abs(verticalSpeed) - 2.2) / 16.5, 0, 1);
      const speedRush = clamp((speedAmount - 0.44) / 0.56, 0, 1);
      const wispIntensity = !active || reducedMotion
        ? 0
        : clamp(verticalEffort * 0.78 + speedRush * 0.52 + (boosting ? 0.36 : 0), 0, 1);

      lines.visible = wispIntensity > 0.015;
      if (lines.visible) {
        material.opacity = wispIntensity * 0.24;
        anchor.copy(crow.position).addScaledVector(velDir, 14);
        const teleported = !streaksPrimed || crow.position.distanceToSquared(lastBirdPos) > 10_000;
        lastBirdPos.copy(crow.position);
        if (teleported) {
          for (let i = 0; i < streaks.length; i++) respawnStreak(streaks[i], false);
          streaksPrimed = true;
        }
        const tailSpanBase = clamp(flowSpeed * (0.026 + wispIntensity * 0.04), 0.75, 4.8);
        for (let index = 0; index < streaks.length; index++) {
          const streak = streaks[index];
          streak.y += dt * streak.drift;
          if (
            Math.abs(streak.x - anchor.x) > halfX ||
            Math.abs(streak.y - anchor.y) > halfY ||
            Math.abs(streak.z - anchor.z) > halfZ
          ) {
            respawnStreak(streak, true);
          }
          const span = tailSpanBase * streak.lengthScale;
          const offset = index * 6;
          positions[offset] = streak.x;
          positions[offset + 1] = streak.y;
          positions[offset + 2] = streak.z;
          positions[offset + 3] = streak.x - velDir.x * span;
          positions[offset + 4] = streak.y - velDir.y * span;
          positions[offset + 5] = streak.z - velDir.z * span;
        }
        geometry.attributes.position.needsUpdate = true;
      }

      const targetTrail = !active || reducedMotion || !leftTip || !rightTip
        ? 0
        : clamp(verticalEffort * 0.88 + clamp((speedAmount - 0.5) / 0.5, 0, 1) * 0.65 + (boosting ? 0.45 : 0), 0, 1);
      smoothedTrailOpacity = THREE.MathUtils.lerp(smoothedTrailOpacity, targetTrail, 1 - Math.exp(-7 * dt));

      if (leftTip && rightTip && (smoothedTrailOpacity > 0.012 || !trailPrimed)) {
        leftTip.getWorldPosition(tipL);
        rightTip.getWorldPosition(tipR);
        prevTipL.set(leftHistory[0], leftHistory[1], leftHistory[2]);
        if (!trailPrimed || tipL.distanceToSquared(prevTipL) > 36) {
          for (let i = 0; i < trailSamples; i++) {
            const idx = i * 3;
            leftHistory[idx] = tipL.x;
            leftHistory[idx + 1] = tipL.y;
            leftHistory[idx + 2] = tipL.z;
            rightHistory[idx] = tipR.x;
            rightHistory[idx + 1] = tipR.y;
            rightHistory[idx + 2] = tipR.z;
          }
          trailPrimed = true;
        } else {
          leftHistory.copyWithin(3, 0, (trailSamples - 1) * 3);
          rightHistory.copyWithin(3, 0, (trailSamples - 1) * 3);
          leftHistory[0] = tipL.x;
          leftHistory[1] = tipL.y;
          leftHistory[2] = tipL.z;
          rightHistory[0] = tipR.x;
          rightHistory[1] = tipR.y;
          rightHistory[2] = tipR.z;
        }
      }

      ribbon.visible = smoothedTrailOpacity > 0.012 && trailPrimed;
      if (ribbon.visible) {
        ribbonUniforms.uOpacity.value = smoothedTrailOpacity * 0.28;
        const widthScale = 0.055 + smoothedTrailOpacity * 0.045;
        writeRibbonWing(leftHistory, 0, cameraPosition, widthScale);
        writeRibbonWing(rightHistory, 1, cameraPosition, widthScale);
        ribbonPosAttr.needsUpdate = true;
      }
    },
    dispose() {
      scene.remove(lines);
      scene.remove(ribbon);
      geometry.dispose();
      material.dispose();
      ribbonGeometry.dispose();
      ribbonMaterial.dispose();
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
  // Dust-laden air lit by a low sun: the colour of the haze at golden hour.
  const lowSunHazeColor = new THREE.Color(0xe0b88c);
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
    const nightHex = mode === "storm" ? 0x0d1620 : mode === "rain" ? 0x11202c : 0x132738;
    const dayHex = mode === "fog" ? 0xc7bfb2
      : mode === "storm" ? 0x4e5964
        : mode === "rain" ? 0x7c8a94
          : mode === "cloudy" ? 0xaeb8bf
            : 0xc2cdd5;
    nightColor.setHex(nightHex);
    dayColor.setHex(dayHex);
    blendedBackground.copy(nightColor).lerp(twilightColor, twilight * (1 - cloudAmount * 0.55)).lerp(dayColor, daylightStrength);
    // The fog, the far ground and the sky's horizon all take this colour, so
    // it has to follow the sun: blue-grey at noon, warm while the sun is low
    // (the glow the bare sky dome used to give), unless cloud or rain hides it.
    const lowSunWarmth = (1 - smoothRange(solarElevation, 4, 24)) * daylightStrength
      * (1 - cloudAmount * 0.75) * (mode === "clear" || mode === "cloudy" ? 1 : 0);
    blendedBackground.lerp(lowSunHazeColor, lowSunWarmth * 0.72);
    scene.background = blendedBackground;
    if (scene.fog instanceof THREE.FogExp2) {
      scene.fog.color.copy(blendedBackground);
      // Dhaka's dry-season haze: buildings lose their contrast by 3–4 km even
      // on a clear day, which also hides where the detailed tiles end. Rain,
      // storm and fog each stay thicker than the mode before them.
      const weatherFogDensity = mode === "fog"
        ? 0.0015
        : mode === "storm"
          ? 0.00105
          : mode === "rain"
            ? 0.00086
            : 0.00046 + cloudAmount * 0.00014;
      // At night, dense same-colour fog erases the ground before the player can
      // read it. Games retain aerial perspective but extend the useful sightline.
      scene.fog.density = weatherFogDensity * THREE.MathUtils.lerp(0.45, 1, daylightStrength);
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
    // The horizon always matches the fog exactly. Overhead the dome is washed
    // about half-way with the sun high (more under cloud); a low sun keeps
    // most of the dome's own colour, so golden hour and dawn still glow.
    // Fog reaches its shaders in the output colour space, so the haze must too.
    blendedBackground.getRGB(skyUniforms.bevHazeColor.value as THREE.Color, THREE.SRGBColorSpace);
    const highSun = smoothRange(solarElevation, 5, 30);
    const hazeWash = THREE.MathUtils.lerp(0.1, 0.5, highSun) + cloudAmount * 0.3;
    skyUniforms.bevHazeAmount.value = THREE.MathUtils.lerp(0.1, hazeWash, daylightStrength);

    const nightExposure = mode === "storm" ? 0.88 : mode === "rain" ? 0.92 : 0.98;
    renderer.toneMappingExposure = THREE.MathUtils.lerp(
      nightExposure,
      mode === "clear" ? 1.02 : mode === "cloudy" ? 0.97 : 0.78,
      daylightStrength,
    );
    hemisphere.intensity = THREE.MathUtils.lerp(
      0.82 - cloudAmount * 0.12,
      1.8 - cloudAmount * 0.82,
      daylightStrength,
    );
    hemisphere.color.set(isNight ? 0x7c93ad : mode === "rain" || mode === "storm" ? 0xc4cdd4 : 0xf1efe9);
    hemisphere.groundColor.set(isNight ? 0x2d2a28 : 0x7a7064);
    const sunVisibility = smoothRange(solarElevation, -5, 8) * (1 - cloudAmount * 0.72);
    const daylightKey = (mode === "clear" ? 3.35 : mode === "cloudy" ? 2.15 : 0.58) * sunVisibility;
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
    skyFill.color.set(isNight ? 0x475e78 : twilight > 0.35 ? 0xd29c84 : 0xb6c7d6);
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
      // The frame loop multiplies this by the cloud's edge-of-field fade.
      cloud.userData.weatherOpacity = 0.35 + cloudAmount * 0.42;
      for (const child of cloud.children) {
        if (child instanceof THREE.Mesh && child.material instanceof THREE.MeshStandardMaterial) {
          child.material.color.set(isNight ? 0x526773 : raining ? 0x9aa9a8 : 0xe9e5d5);
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
    // Flyover and viaduct ways are drawn as decks by buildElevatedRoads.
    // A way that runs on beyond a bridge keeps the part that is on the ground.
    const groundRuns = groundRunsOfRoad(road);
    if (groundRuns.length === 0) continue;
    const bucket = majorRoads.has(road.kind) ? 0 : localRoads.has(road.kind) ? 1 : 2;
    const width = bucket === 0 ? (road.kind === "motorway" || road.kind === "trunk" ? 17 : 14) : bucket === 1 ? 7.5 : 4.2;
    // Separate road classes vertically and with per-layer polygonOffset so
    // shoulders, asphalt tiers, and markings never z-fight at distance or at
    // junctions. A tiny deterministic per-road and per-segment stagger also
    // separates same-class crossings and consecutive segment overlaps.
    const roadJitter = ((Math.abs(road.id) % 7) - 3) * 0.004;
    const surfaceY = (bucket === 0 ? 1.07 : bucket === 1 ? 0.93 : 0.79) + roadJitter;
    const shoulderY = 0.7 + roadJitter * 0.5;
    const shoulderWidth = width + (bucket === 0 ? 5.5 : 2.4);
    const airportPad = shoulderWidth / 2 + 1;
    for (const runPoints of groundRuns) for (let index = 1; index < runPoints.length; index++) {
      const [rawX1, rawZ1] = runPoints[index - 1];
      const [rawX2, rawZ2] = runPoints[index];
      const segStep = (index & 1) * 0.002;
      for (const [x1, z1, x2, z2] of clipSegmentOutsideAirport(rawX1, rawZ1, rawX2, rawZ2, airportPad)) {
        const surface = segmentStrip(x1, z1, x2, z2, width, 0.34, surfaceY + segStep);
        if (!surface) continue;
        surfaces[bucket].push(surface);
        const shoulder = segmentStrip(x1, z1, x2, z2, shoulderWidth, 0.24, shoulderY + segStep);
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
  }

  // Strictly ordered polygonOffset keeps shoulders, road classes, and markings
  // cleanly layered even from kilometres away at grazing angles.
  await mergeIntoMeshBatches(
    parent,
    shoulders,
    new THREE.MeshStandardMaterial({
      color: 0x9c978e,
      roughness: 0.96,
      polygonOffset: true,
      polygonOffsetFactor: -1,
      polygonOffsetUnits: -1,
    }),
    `${name} shoulders`,
    isCancelled,
  );
  const roadMaterials = [
    // Sun-bleached concrete and worn bitumen: mid grey, lighter than the
    // shadowed ground between buildings.
    { color: 0x6b6b6a, offset: -4 },
    { color: 0x74726f, offset: -3 },
    { color: 0x7c7973, offset: -2 },
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

/**
 * `dayFacade` also dresses generic city buildings for daylight: darker window
 * bands and a floor line per storey on walls, curtain-wall mullions and a sky
 * sheen on blue glass, and upward faces weathered to concrete grey so a cream
 * building does not carry a cream roof. Landmark glass leaves it off.
 */
function applyNightWindows(material: THREE.MeshStandardMaterial, density = 0.5, dayFacade = false) {
  const densityUniform = { value: density };
  if (dayFacade) material.defines = { ...material.defines, BEV_DAY_FACADE: "" };
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
uniform vec3 bevWindowTint;
#ifdef BEV_DAY_FACADE
float bevGlass = 0.0;
#endif`,
      )
      // `diffuseColor` now holds the material colour times the instance colour.
      .replace(
        "#include <color_fragment>",
        `#include <color_fragment>
#ifdef BEV_DAY_FACADE
{
  float bevMaxC = max( diffuseColor.r, max( diffuseColor.g, diffuseColor.b ) );
  float bevMinC = min( diffuseColor.r, min( diffuseColor.g, diffuseColor.b ) );
  float bevSat = ( bevMaxC - bevMinC ) / max( bevMaxC, 0.001 );
  float bevLum = dot( diffuseColor.rgb, vec3( 0.2126, 0.7152, 0.0722 ) );
  // Tin sheets and plastic tanks (saturated or near black) keep their colour.
  float bevKeep = max( smoothstep( 0.86, 0.93, bevSat ), 1.0 - smoothstep( 0.012, 0.03, bevLum ) );
  bevGlass = smoothstep( 0.42, 0.6, ( diffuseColor.b - diffuseColor.r ) / max( diffuseColor.b, 0.001 ) ) * ( 1.0 - bevKeep );
  float bevUpD = smoothstep( 0.55, 0.85, bevWorldNormal.y );
  float bevWallD = 1.0 - smoothstep( 0.30, 0.58, abs( bevWorldNormal.y ) );
  // Roofs: rain-stained concrete, a little lighter over pale buildings, in
  // broad patches so neighbouring slabs differ.
  float bevPatch = fract( sin( dot( floor( bevWorldPos.xz / 9.0 ), vec2( 12.9898, 78.233 ) ) ) * 43758.5453 );
  float bevRoofShade = 0.13 + 0.15 * bevLum + 0.05 * bevPatch;
  vec3 bevRoofColor = bevRoofShade * vec3( 1.0, 0.985, 0.95 );
  diffuseColor.rgb = mix( diffuseColor.rgb, bevRoofColor, bevUpD * ( 1.0 - bevKeep ) * 0.92 );
  // Walls: the same facade cells the night windows use, filtered the same way.
  float bevAcrossD = abs( bevWorldNormal.x ) > abs( bevWorldNormal.z ) ? bevWorldPos.z : bevWorldPos.x;
  vec2 bevCellD = vec2( bevAcrossD / 4.6, bevWorldPos.y / 3.75 );
  vec2 bevFwD = max( fwidth( bevCellD ), vec2( 0.001 ) );
  vec2 bevUvD = fract( bevCellD );
  float bevMipD = smoothstep( 0.28, 1.1, max( bevFwD.x, bevFwD.y ) );
  float bevPaneXD = smoothstep( 0.2 - bevFwD.x, 0.2 + bevFwD.x, bevUvD.x )
    * ( 1.0 - smoothstep( 0.74 - bevFwD.x, 0.74 + bevFwD.x, bevUvD.x ) );
  float bevPaneYD = smoothstep( 0.3 - bevFwD.y, 0.3 + bevFwD.y, bevUvD.y )
    * ( 1.0 - smoothstep( 0.72 - bevFwD.y, 0.72 + bevFwD.y, bevUvD.y ) );
  float bevBand = mix( bevPaneYD * ( 0.14 + 0.86 * bevPaneXD ), 0.25, bevMipD );
  float bevFloorLine = mix( 1.0 - smoothstep( 0.07 - bevFwD.y, 0.07 + bevFwD.y, bevUvD.y ), 0.07, bevMipD );
  float bevMasonry = 1.0 - bevWallD * ( 0.36 * bevBand + 0.14 * bevFloorLine );
  // Curtain wall: thin dark mullions on panes that brighten toward the sky.
  float bevMullionLine = 1.0 - smoothstep( 0.1 - bevFwD.x, 0.1 + bevFwD.x, bevUvD.x );
  float bevMullion = mix( max( bevMullionLine, bevFloorLine ), 0.16, bevMipD );
  float bevSheen = 0.82 + 0.5 * smoothstep( 8.0, 110.0, bevWorldPos.y );
  float bevCurtain = mix( 1.0, bevSheen * ( 1.0 - 0.42 * bevMullion ), bevWallD );
  diffuseColor.rgb *= mix( bevMasonry, bevCurtain, bevGlass );
}
#endif`,
      )
      .replace(
        "#include <roughnessmap_fragment>",
        `#include <roughnessmap_fragment>
#ifdef BEV_DAY_FACADE
  roughnessFactor = mix( roughnessFactor, 0.24, bevGlass * ( 1.0 - smoothstep( 0.55, 0.85, bevWorldNormal.y ) ) );
#endif`,
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
  // Compute facade cell coordinates and screen-space derivatives outside the
  // fragment-dependent branch so GLSL fwidth() stays defined across cutoffs.
  float bevAcross = abs( bevWorldNormal.x ) > abs( bevWorldNormal.z ) ? bevWorldPos.z : bevWorldPos.x;
  vec2 bevCell = vec2( bevAcross / 4.6, bevWorldPos.y / 3.75 );
  vec2 bevFw = max( fwidth( bevCell ), vec2( 0.001 ) );
  if ( bevWall * bevStorey > 0.001 ) {
    vec2 bevId = floor( bevCell );
    vec2 bevUv = fract( bevCell );
    // Filter window edges with screen-space derivatives and blend toward the
    // average lit density once a cell shrinks below ~2 pixels, eliminating
    // sub-pixel moire and sparkle across distant facades at night.
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
  material.customProgramCacheKey = () => `bev-night-windows-${density}-${dayFacade}`;
  return material;
}

// The elevated-road table projected into world metres, and the clearance index
// over it. Both depend only on the table, so they are worked out once.
let elevatedRoadLayoutCache: ElevatedRoadLayout[] | null = null;
function elevatedRoadLayouts() {
  elevatedRoadLayoutCache ??= layoutElevatedRoads((lat, lon) => {
    const world = coordinatesToWorld(lat, lon);
    return [world.x, world.y];
  });
  return elevatedRoadLayoutCache;
}
/**
 * What is left of a road at ground level: nothing of a way rebuilt as an
 * elevated deck, and only the stretches beyond the deck of a way that a
 * bridge approach trims. Every other road is returned whole.
 */
function groundRunsOfRoad(road: { id: number; points: MapPoint[] }): MapPoint[][] {
  if (ELEVATED_ROAD_WAY_IDS.has(road.id)) return [];
  const trimmedBy = ELEVATED_ROAD_TRIM_WAY_IDS.get(road.id);
  if (trimmedBy === undefined) return [road.points];
  return groundRunsOfTrimmedWay(elevatedRoadLayouts()[trimmedBy], road.points);
}
/** The one stretch of a road that ground traffic drives: its longest ground run. */
function longestGroundRun(road: { id: number; points: MapPoint[] }): MapPoint[] | null {
  if (!ELEVATED_ROAD_WAY_IDS.has(road.id) && !ELEVATED_ROAD_TRIM_WAY_IDS.has(road.id)) return road.points;
  let best: MapPoint[] | null = null;
  let bestLength = 0;
  for (const run of groundRunsOfRoad(road)) {
    const length = trafficRoadLength(run);
    if (length > bestLength) [best, bestLength] = [run, length];
  }
  return best;
}
let elevatedRoadCorridorCache: MetroCorridorIndex | null = null;
function elevatedRoadCorridor() {
  elevatedRoadCorridorCache ??= buildElevatedRoadCorridor(elevatedRoadLayouts());
  return elevatedRoadCorridorCache;
}

function createMetroCorridor(
  metroLines?: OsmMapData["metroLines"],
  metroStations?: OsmMapData["metroStations"],
) {
  const fallbackSpecs = MRT_LINE_6_STATIONS.map((station) => {
    const world = coordinatesToWorld(station.lat, station.lon);
    return { x: world.x, z: world.y };
  });
  const line = metroLines?.[0];
  const controlPoints = line && line.length >= 2
    ? line.map(([x, z]) => new THREE.Vector3(x, 18, z))
    : fallbackSpecs.map((station) => new THREE.Vector3(station.x, 18, station.z));
  const curve = new THREE.CatmullRomCurve3(controlPoints, false, "centripetal", 0.28);
  const samples = metroGirderSampleCount(curve.getLength());
  const sampledCenterline: MapPoint[] = [];
  for (let index = 0; index <= samples; index++) {
    const point = curve.getPointAt(index / samples);
    sampledCenterline.push([point.x, point.z]);
  }
  const stationSpecs = metroStations && metroStations.length >= 2
    ? metroStations.map((station) => ({ x: station.point[0], z: station.point[1] }))
    : fallbackSpecs;
  const PROJECTION_SAMPLES = 1600;
  const projectedStations: MetroStationFootprint[] = [];
  for (const spec of stationSpecs) {
    let bestU = 0;
    let bestDistanceSquared = Infinity;
    for (let index = 0; index <= PROJECTION_SAMPLES; index++) {
      const sample = curve.getPointAt(index / PROJECTION_SAMPLES);
      const distanceSquared = (sample.x - spec.x) ** 2 + (sample.z - spec.z) ** 2;
      if (distanceSquared < bestDistanceSquared) {
        bestDistanceSquared = distanceSquared;
        bestU = index / PROJECTION_SAMPLES;
      }
    }
    if (bestDistanceSquared >= 200 * 200) continue;
    const point = curve.getPointAt(bestU);
    const tangent = curve.getTangentAt(bestU);
    const tangentLength = Math.hypot(tangent.x, tangent.z) || 1;
    projectedStations.push({
      x: point.x,
      z: point.z,
      tx: tangent.x / tangentLength,
      tz: tangent.z / tangentLength,
    });
  }
  // Every caller clears buildings and trees off this index, so the elevated
  // roads ride along with the metro viaduct at all of those sites.
  const metro = buildMetroCorridor(sampledCenterline, projectedStations);
  const elevated = elevatedRoadCorridor();
  const corridor: MetroCorridorIndex = {
    blocksCircle: (x, z, radius, viaductClearance) => metro.blocksCircle(x, z, radius, viaductClearance) || elevated.blocksCircle(x, z, radius),
    blocksPolygon: (points, viaductClearance) => metro.blocksPolygon(points, viaductClearance) || elevated.blocksPolygon(points),
  };
  return corridor;
}

function addImmediateCityMass(scene: THREE.Scene, roads: OsmMapData["roads"]) {
  const group = new THREE.Group();
  group.name = "Immediate Greater Dhaka city mass";
  const metroCorridor = createMetroCorridor();
  const geometry = new THREE.BoxGeometry(1, 1, 1);
  const materials = [0xd2ccc1, 0xc1bbb1, 0xa39f97].map(
    (color) => applyNightWindows(new THREE.MeshStandardMaterial({ color, roughness: 0.92, metalness: 0.01 }), 0.46, true),
  );
  const transforms: THREE.Matrix4[][] = [[], [], []];
  const districtCenters = AREA_LANDMARKS.map((landmark) => {
    const world = coordinatesToWorld(landmark.lat, landmark.lon);
    return { x: world.x, z: world.y, intensity: clamp(landmark.altitude / 88, 0.42, 1.08) };
  });
  // Sites much bigger than the default 105 m (the stadium bowl and masts, the
  // hospital spine, the mausoleum's walk down to the bridge) clear further.
  const clearingRadius: Partial<Record<DhakaLandmark["kind"], number>> = {
    airport: 1_350,
    // The airfield itself is kept clear by its clearance rectangles.
    "tejgaon-airport": 60,
    "sayedabad-bus-terminal": 120,
    "gabtoli-bus-terminal": 120,
    "sher-e-bangla-stadium": 165,
    "dhaka-medical": 130,
    "zia-udyan": 140,
    "star-mosque": 40,
    "military-museum": 120,
    bcfcc: 125,
    "jamuna-future-park": 185,
    "kuril-flyover": 320,
    "army-stadium": 140,
    "gulshan-central-mosque": 95,
    "doyel-chattar": 28,
    "shapla-chattar": 24,
    "tsc-raju": 70,
    "hatirjheel-bridge": 60,
    "three-leaders-mausoleum": 70,
    "hussaini-dalan": 75,
    "sadarghat-terminal": 40,
    "supreme-court": 120,
    "national-stadium": 125,
    "rayer-bazar-memorial": 115,
    "shishu-park": 150,
    "shishu-mela": 60,
    "air-force-museum": 100,
    "sonargaon-hotel": 90,
    "pm-office": 100,
    "armenian-church": 35,
    "bahadur-shah-park": 60,
    "rose-garden-palace": 75,
  };
  const landmarkClearings = DHAKA_LANDMARKS.map((landmark) => {
    const world = coordinatesToWorld(landmark.lat, landmark.lon);
    return { x: world.x, z: world.y, radius: LANDMARK_MODULE_BY_KIND.get(landmark.kind)?.clearingRadius ?? clearingRadius[landmark.kind] ?? 105 };
  });
  const roadCellSize = 180;
  const roadGrid = new Map<string, Array<{ x1: number; z1: number; x2: number; z2: number; radius: number }>>();
  const roadKey = (cellX: number, cellZ: number) => `${cellX}:${cellZ}`;
  for (const road of roads) {
    const radius = ["motorway", "trunk", "primary", "secondary"].includes(road.kind) ? 24 : 13;
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
  const spacing = 84;
  for (let x = -FLIGHT_EXTENT.x + 60; x < FLIGHT_EXTENT.x - 60; x += spacing) {
    for (let z = -FLIGHT_EXTENT.z + 60; z < FLIGHT_EXTENT.z - 60; z += spacing) {
      const buildingX = x + (random() - 0.5) * 30;
      const buildingZ = z + (random() - 0.5) * 30;
      let intensity = 0.28;
      for (const district of districtCenters) {
        const proximity = clamp(1 - Math.hypot(buildingX - district.x, buildingZ - district.z) / 1_700, 0, 1);
        intensity = Math.max(intensity, proximity * district.intensity);
      }
      if (random() > 0.58 + intensity * 0.34) continue;
      // Keep the central Hatirjheel fallback block, Dhaka parks, and airport apron
      // clear so immediate filler buildings never intersect them while OSM is loading.
      if (Math.abs(buildingX) < 1_090 && Math.abs(buildingZ) < 1_010) continue;
      if (inAirportClearance(buildingX, buildingZ, 40)) continue;
      if (inDhakaPark(buildingX, buildingZ, 18)) continue;
      if (inDhakaOpenGround(buildingX, buildingZ, 30)) continue;
      if (landmarkClearings.some((landmark) => Math.hypot(buildingX - landmark.x, buildingZ - landmark.z) < landmark.radius)) continue;
      const width = 20 + random() * 28;
      const depth = 18 + random() * 28;
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
      ) < (segment.radius + buildingRadius + 4) ** 2)) continue;
      if (metroCorridor.blocksCircle(buildingX, buildingZ, buildingRadius)) continue;

      const height = 10 + random() * 26 + intensity * (24 + random() * 44);
      const bucket = random() < 0.24 ? 2 : height > 30 ? 1 : 0;
      position.set(buildingX, height / 2 + 0.9, buildingZ);
      quaternion.setFromAxisAngle(new THREE.Vector3(0, 1, 0), (random() - 0.5) * 0.14);
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

  // Immediate-load tree canopy layer (1 draw call, hidden on live reveal) so
  // Dhaka's parks and leafy avenues read green on frame 1 while OSM builds.
  const canopyGeometry = new THREE.IcosahedronGeometry(1, 0);
  const canopyMaterial = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.88 });
  const canopyPalette = [0x1f4027, 0x254a2b, 0x2d532e, 0x375c33].map((color) => new THREE.Color(color));
  const krishnachura = new THREE.Color(0xc84628);
  const canopyTransforms: THREE.Matrix4[] = [];
  const canopyColors: THREE.Color[] = [];
  const canopyRng = seededRandom(31_907);
  const immediateLandmarkColliders = (scene.userData.landmarkColliders as BuildingCollider[] | undefined) ?? [];
  for (const park of DHAKA_PARKS) {
    const count = clamp(Math.round((Math.PI * park.rx * park.rz) / 950), 16, 85);
    for (let i = 0; i < count; i++) {
      const radial = Math.sqrt(canopyRng()) * 0.95;
      const angle = canopyRng() * Math.PI * 2;
      const lx = Math.cos(angle) * radial * park.rx;
      const lz = Math.sin(angle) * radial * park.rz;
      const wx = park.x + lx * park.fwdCos - lz * park.fwdSin;
      const wz = park.z + lx * park.fwdSin + lz * park.fwdCos;
      const r = 4.6 + canopyRng() * 3.4;
      if (inAirportClearance(wx, wz, 20) || metroCorridor.blocksCircle(wx, wz, r + 2)) continue;
      if (immediateLandmarkColliders.some((c) => Math.abs(wx - c.x) < c.halfWidth + r + 2 && Math.abs(wz - c.z) < c.halfDepth + r + 2)) continue;
      position.set(wx, 5.5 + r * 0.55, wz);
      quaternion.setFromEuler(new THREE.Euler(canopyRng(), canopyRng(), canopyRng()));
      scale.set(r, r * 0.72, r);
      canopyTransforms.push(matrix.compose(position, quaternion, scale).clone());
      canopyColors.push(
        canopyRng() < 0.015
          ? krishnachura.clone()
          : canopyPalette[Math.floor(canopyRng() * canopyPalette.length)].clone(),
      );
    }
  }
  for (const road of roads) {
    const isMajor = ["motorway", "trunk", "primary", "secondary"].includes(road.kind);
    if (!isMajor) continue;
    for (let index = 1; index < road.points.length; index++) {
      const [x1, z1] = road.points[index - 1];
      const [x2, z2] = road.points[index];
      const len = Math.hypot(x2 - x1, z2 - z1);
      if (len < 30) continue;
      const nx = -(z2 - z1) / len;
      const nz = (x2 - x1) / len;
      for (let dist = 16; dist < len - 12; dist += 42) {
        const t = dist / len;
        const side = ((index + Math.floor(dist)) & 1) ? 1 : -1;
        const wx = x1 + (x2 - x1) * t + nx * side * 13.5;
        const wz = z1 + (z2 - z1) * t + nz * side * 13.5;
        if (Math.abs(wx) > FLIGHT_EXTENT.x - 40 || Math.abs(wz) > FLIGHT_EXTENT.z - 40) continue;
        if (inAirportClearance(wx, wz, 24) || metroCorridor.blocksCircle(wx, wz, 8)) continue;
        if (canopyRng() > clamp(dhakaGreenWeight(wx, wz) * 0.62, 0.2, 0.85)) continue;
        const r = 3.8 + canopyRng() * 2.4;
        position.set(wx, 4.8 + r * 0.55, wz);
        quaternion.setFromEuler(new THREE.Euler(canopyRng(), canopyRng(), canopyRng()));
        scale.set(r, r * 0.72, r);
        canopyTransforms.push(matrix.compose(position, quaternion, scale).clone());
        canopyColors.push(
          canopyRng() < 0.01
            ? krishnachura.clone()
            : canopyPalette[Math.floor(canopyRng() * canopyPalette.length)].clone(),
        );
      }
    }
  }
  if (canopyTransforms.length > 0) {
    const canopyMesh = new THREE.InstancedMesh(canopyGeometry, canopyMaterial, canopyTransforms.length);
    canopyMesh.name = "Immediate Dhaka tree canopies";
    canopyTransforms.forEach((transform, index) => {
      canopyMesh.setMatrixAt(index, transform);
      canopyMesh.setColorAt(index, canopyColors[index]);
    });
    canopyMesh.instanceMatrix.needsUpdate = true;
    if (canopyMesh.instanceColor) canopyMesh.instanceColor.needsUpdate = true;
    canopyMesh.castShadow = false;
    canopyMesh.receiveShadow = true;
    group.add(canopyMesh);
  }
  scene.add(group);
  scene.userData.immediateCityMass = group;
  return group;
}

// District tiles within the visibility radius draw everything; a ring beyond
// it keeps only the tile's one building mesh (no trees, no shadow casting), so
// the city carries on toward the haze instead of ending in bare ground.
// Clear-day haze has taken ~90% of a building's contrast by 3 km, so the
// ring stops there, and its tiles drop their rooftop furniture.
const PROCEDURAL_FAR_RING_FACTOR = 1.35;

function proceduralTileDetailAt(tile: ProceduralDistrictTile, x: number, z: number, visibilityRadius: number): 0 | 1 | 2 {
  const distanceSquared = (tile.centerX - x) ** 2 + (tile.centerZ - z) ** 2;
  if (distanceSquared < visibilityRadius ** 2) return 2;
  if (tile.buildings && distanceSquared < (visibilityRadius * PROCEDURAL_FAR_RING_FACTOR) ** 2) return 1;
  return 0;
}

function setProceduralTileDetail(scene: THREE.Scene, tile: ProceduralDistrictTile, detail: 0 | 1 | 2) {
  tile.detail = detail;
  tile.group.visible = detail > 0;
  if (detail > 0) scene.add(tile.group);
  else scene.remove(tile.group);
  for (const child of tile.group.children) child.visible = detail === 2 || child === tile.buildings;
  if (tile.buildings) {
    tile.buildings.castShadow = detail === 2;
    // Stair heads, tanks and tin sheets follow the buildings in the instance list.
    tile.buildings.count = detail === 2
      ? tile.buildings.instanceMatrix.count
      : tile.buildings.userData.buildingCount as number;
  }
}

async function addProceduralDistrictTiles(
  scene: THREE.Scene,
  data: OsmMapData,
  osmColliders: BuildingCollider[],
  initialPosition: THREE.Vector3,
  isCancelled: () => boolean,
) {
  const tileSize = 460;
  const visibilityRadius = 2_250;
  const tiles: ProceduralDistrictTile[] = [];
  const colliders: BuildingCollider[] = [];
  // Every building and stair head stands on something, so the unit box drops
  // its never-seen underside: 10 triangles per instance instead of 12.
  const unitBox = new THREE.BoxGeometry(1, 1, 1);
  const boxIndex = Array.from(unitBox.getIndex()?.array ?? []);
  unitBox.setIndex([...boxIndex.slice(0, 18), ...boxIndex.slice(24)]);
  unitBox.clearGroups();
  const foliageGeometry = new THREE.IcosahedronGeometry(1, 1);
  const trunkGeometry = new THREE.CylinderGeometry(0.5, 0.72, 1, 6);
  // One white, night-windowed material for every procedural building; the
  // colour comes per instance from the Dhaka masonry palette below.
  const buildingMaterial = applyNightWindows(new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.9, metalness: 0.01 }), 0.5, true);
  const landmarkColliders = (scene.userData.landmarkColliders as BuildingCollider[] | undefined) ?? [];
  const areaPerches = AREA_LANDMARKS.map((landmark) => {
    const world = coordinatesToWorld(landmark.lat, landmark.lon);
    return { x: world.x, z: world.y, altitude: landmark.altitude };
  });
  const shadeColor = new THREE.Color();
  const trunkMaterial = new THREE.MeshStandardMaterial({ color: 0x5d4739, roughness: 1 });
  const foliageMaterial = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.86 });
  // Tropical Dhaka canopy palette: mango/banyan shade, mahogany, kadam, koroi,
  // roadside olive, plus flowering Krishnachura, Radhachura, Jarul, and rooftop plants.
  const foliagePalette = [0x1f4027, 0x254a2b, 0x2d532e, 0x375c33, 0x284830].map((color) => new THREE.Color(color));
  const krishnachuraColor = new THREE.Color(0xc84628);
  const radhachuraColor = new THREE.Color(0xd49b2a);
  const jarulColor = new THREE.Color(0x865494);
  const rooftopGardenPalette = [0x4a7840, 0x5d8a48, 0x3d683b].map((color) => new THREE.Color(color));
  const bougainvilleaColor = new THREE.Color(0xa83e6c);
  const bushPalette = [0x3d633b, 0x4e7542, 0x335536].map((color) => new THREE.Color(color));
  const treePerchGrid = new Map<string, Perch[]>();
  const registerTreePerch = (perch: Perch) => {
    const key = `${Math.floor(perch.position.x / TREE_PERCH_CELL_SIZE)}:${Math.floor(perch.position.z / TREE_PERCH_CELL_SIZE)}`;
    const bucket = treePerchGrid.get(key);
    if (bucket) bucket.push(perch);
    else treePerchGrid.set(key, [perch]);
  };
  const majorRoads = new Set(["motorway", "trunk", "primary", "secondary"]);
  type AvoidanceSegment = { x1: number; z1: number; x2: number; z2: number; radius: number; asphaltHalf?: number };
  type TileRoadSegment = { x1: number; z1: number; x2: number; z2: number; length: number; asphaltHalf: number; major: boolean };
  type TileShoreSegment = { x1: number; z1: number; x2: number; z2: number; length: number };
  const spatialCellSize = 180;
  const roadGrid = new Map<string, AvoidanceSegment[]>();
  const waterGrid = new Map<string, AvoidanceSegment[]>();
  const waterAreaGrid = new Map<string, MapPoint[][]>();
  const colliderGrid = new Map<string, BuildingCollider[]>();
  const tileRoadSegments = new Map<string, TileRoadSegment[]>();
  const tileShoreSegments = new Map<string, TileShoreSegment[]>();
  // Longer slices than the default: each yield is a nested setTimeout that the
  // browser clamps to ~4 ms, and this pass yields a few thousand times. Ten
  // milliseconds of work still leaves room for a 60 fps frame in between.
  const yieldIfNeeded = createMainThreadYielder(10);
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
  const addToTileSpan = <T,>(grid: Map<string, T[]>, item: T, x1: number, z1: number, x2: number, z2: number, pad = 18) => {
    const minTX = Math.round((Math.min(x1, x2) - pad) / tileSize);
    const maxTX = Math.round((Math.max(x1, x2) + pad) / tileSize);
    const minTZ = Math.round((Math.min(z1, z2) - pad) / tileSize);
    const maxTZ = Math.round((Math.max(z1, z2) + pad) / tileSize);
    for (let tx = minTX; tx <= maxTX; tx++) {
      for (let tz = minTZ; tz <= maxTZ; tz++) {
        const key = spatialKey(tx, tz);
        const entries = grid.get(key);
        if (entries) entries.push(item);
        else grid.set(key, [item]);
      }
    }
  };
  for (const road of roads) {
    const isMajor = majorRoads.has(road.kind);
    const radius = isMajor ? 13 : road.kind === "service" ? 5 : 7.5;
    const asphaltHalf = isMajor
      ? (road.kind === "motorway" || road.kind === "trunk" ? 8.5 : 7.0)
      : road.kind === "service" ? 2.1 : 3.75;
    for (let index = 1; index < road.points.length; index++) {
      const [x1, z1] = road.points[index - 1];
      const [x2, z2] = road.points[index];
      const segment = { x1, z1, x2, z2, radius, asphaltHalf };
      addToGrid(roadGrid, segment, Math.min(x1, x2) - 42, Math.max(x1, x2) + 42, Math.min(z1, z2) - 42, Math.max(z1, z2) + 42);
      const length = Math.hypot(x2 - x1, z2 - z1);
      if (length >= 18) {
        addToTileSpan(tileRoadSegments, { x1, z1, x2, z2, length, asphaltHalf, major: isMajor }, x1, z1, x2, z2, asphaltHalf + 8);
      }
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
    let isMajorWaterBody = false;
    if (feature.area && feature.points.length >= 3) {
      const xs = feature.points.map(([x]) => x);
      const zs = feature.points.map(([, z]) => z);
      addToGrid(waterAreaGrid, feature.points, Math.min(...xs), Math.max(...xs), Math.min(...zs), Math.max(...zs));
      isMajorWaterBody = polygonArea2D(feature.points) >= 3_500;
    }
    const isArea = feature.area && feature.points.length >= 3;
    // Undrawn drains do not hold buildings apart; narrow khals hold less.
    const lineWidth = isArea ? 8 : waterLineWidth(feature.points);
    const edgeCount = lineWidth === 0 ? 0 : isArea ? feature.points.length : feature.points.length - 1;
    for (let index = 0; index < edgeCount; index++) {
      const [x1, z1] = feature.points[index];
      const [x2, z2] = feature.points[(index + 1) % feature.points.length];
      const segment = { x1, z1, x2, z2, radius: lineWidth === 3 ? 6 : 10 };
      addToGrid(waterGrid, segment, Math.min(x1, x2) - 46, Math.max(x1, x2) + 46, Math.min(z1, z2) - 46, Math.max(z1, z2) + 46);
      if (isMajorWaterBody) {
        const length = Math.hypot(x2 - x1, z2 - z1);
        if (length >= 14) {
          addToTileSpan(tileShoreSegments, { x1, z1, x2, z2, length }, x1, z1, x2, z2, 14);
        }
      }
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

  const metroCorridor = createMetroCorridor(data.metroLines, data.metroStations);
  const blockedByMap = (x: number, z: number, halfWidth: number, halfDepth: number) => {
    if (inAirportClearance(x, z, Math.max(halfWidth, halfDepth) + 12)) return true;
    if (metroCorridor.blocksCircle(x, z, Math.hypot(halfWidth, halfDepth))) return true;
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

  // Dedicated tree clearance: allows trunks right on sidewalks/shoulders and
  // lake embankments while keeping them out of asphalt, water bodies, metro
  // viaducts, airports, and building interiors.
  const pointInWaterArea = (x: number, z: number) => {
    const key = spatialKey(Math.floor(x / spatialCellSize), Math.floor(z / spatialCellSize));
    return (waterAreaGrid.get(key) ?? []).some((points) => pointInPolygon(x, z, points));
  };
  const treeBlockedByMap = (x: number, z: number, canopyRadius: number) => {
    if (Math.abs(x) > FLIGHT_EXTENT.x - 16 || Math.abs(z) > FLIGHT_EXTENT.z - 16) return true;
    if (inAirportClearance(x, z, canopyRadius + 8)) return true;
    if (metroCorridor.blocksCircle(x, z, canopyRadius * 0.75)) return true;
    const key = spatialKey(Math.floor(x / spatialCellSize), Math.floor(z / spatialCellSize));
    if ((waterAreaGrid.get(key) ?? []).some((points) => pointInPolygon(x, z, points))) return true;
    // Keep trunks slightly back from narrow canal/khal centerlines while letting
    // embankment trees stand close to lakeshores.
    const waterMargin = 3.2;
    if ((waterGrid.get(key) ?? []).some((segment) => distanceToSegmentSquared(x, z, segment.x1, segment.z1, segment.x2, segment.z2) < waterMargin ** 2)) return true;
    for (const segment of roadGrid.get(key) ?? []) {
      const asphaltMargin = (segment.asphaltHalf ?? segment.radius * 0.5) + 1.2;
      if (distanceToSegmentSquared(x, z, segment.x1, segment.z1, segment.x2, segment.z2) < asphaltMargin ** 2) return true;
    }
    const wallClearance = Math.max(1.4, canopyRadius * 0.42);
    return (colliderGrid.get(key) ?? []).some((collider) => (
      Math.abs(x - collider.x) < collider.halfWidth + wallClearance &&
      Math.abs(z - collider.z) < collider.halfDepth + wallClearance
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

  for (const { tileX, tileZ } of tileCoordinates) {
      const random = coordinateRandom(tileX, tileZ);
      const vegRandom = coordinateRandom(tileX + 7_919, tileZ - 6_151);
      const centerX = tileX * tileSize;
      const centerZ = tileZ * tileSize;
      if (Math.abs(centerX) > FLIGHT_EXTENT.x + tileSize / 2 || Math.abs(centerZ) > FLIGHT_EXTENT.z + tileSize / 2) continue;
      const trunkTransforms: THREE.Matrix4[] = [];
      const foliageTransforms: THREE.Matrix4[] = [];
      const foliageColors: THREE.Color[] = [];
      const tileColliders: BuildingCollider[] = [];
      const rooftopGardenCandidates: Array<{ x: number; z: number; width: number; depth: number; topY: number; heading: number; stairX: number; stairZ: number }> = [];
      // Buildings and their stair heads share one instanced mesh per tile, written
      // straight into flat arrays; per-instance colour replaces the five
      // single-colour meshes (and draw calls) a tile used to need.
      const buildingMatrices: number[] = [];
      const buildingColors: number[] = [];
      const roofMatrices: number[] = [];
      const roofColors: number[] = [];
      const vacantLots: number[] = [];
      // Share of low buildings under a tin sheet; each block sets its own.
      let tinRoofChance = 0.08;
      let tinRoofShades = TIN_ROOF_SHADES;
      const greenWeight = dhakaGreenWeight(centerX, centerZ);
      const tileMinX = centerX - tileSize / 2;
      const tileMinZ = centerZ - tileSize / 2;
      const tileNearPark = DHAKA_PARKS.some((park) => (
        Math.abs(centerX - park.x) < tileSize / 2 + Math.max(park.rx, park.rz) + 40
        && Math.abs(centerZ - park.z) < tileSize / 2 + Math.max(park.rx, park.rz) + 40
      ));
      const tileLandmarks = landmarkColliders.filter((collider) => (
        Math.abs(collider.x - centerX) < tileSize / 2 + collider.halfWidth + 90
        && Math.abs(collider.z - centerZ) < tileSize / 2 + collider.halfDepth + 90
      ));
      const tileAreaPerches = areaPerches.filter((perch) => (
        Math.abs(perch.x - centerX) < tileSize / 2 + 70 && Math.abs(perch.z - centerZ) < tileSize / 2 + 70
      ));

      // Oriented footprints (x, z, cos, sin, halfWidth, halfDepth) bucketed on a
      // small grid so overlap and tree-clearance tests stay O(1) per lot.
      const footprints: number[] = [];
      const footprintGrid = new Map<number, number[]>();
      const footprintCells = (minX: number, maxX: number, minZ: number, maxZ: number, visit: (bucket: number[] | undefined, key: number) => boolean | void) => {
        const startX = Math.max(0, Math.floor((minX - tileMinX) / FOOTPRINT_CELL));
        const endX = Math.min(FOOTPRINT_COLUMNS - 1, Math.floor((maxX - tileMinX) / FOOTPRINT_CELL));
        const startZ = Math.max(0, Math.floor((minZ - tileMinZ) / FOOTPRINT_CELL));
        const endZ = Math.min(FOOTPRINT_COLUMNS - 1, Math.floor((maxZ - tileMinZ) / FOOTPRINT_CELL));
        for (let cellX = startX; cellX <= endX; cellX++) {
          for (let cellZ = startZ; cellZ <= endZ; cellZ++) {
            const key = cellX * FOOTPRINT_COLUMNS + cellZ;
            if (visit(footprintGrid.get(key), key)) return true;
          }
        }
        return false;
      };
      const footprintOverlaps = (x: number, z: number, cos: number, sin: number, halfWidth: number, halfDepth: number, reachX: number, reachZ: number, gap: number) => (
        footprintCells(x - reachX - gap, x + reachX + gap, z - reachZ - gap, z + reachZ + gap, (bucket) => {
          if (!bucket) return false;
          for (const index of bucket) {
            if (orientedRectsOverlap(
              x, z, cos, sin, halfWidth, halfDepth,
              footprints[index], footprints[index + 1], footprints[index + 2], footprints[index + 3], footprints[index + 4], footprints[index + 5],
              gap,
            )) return true;
          }
          return false;
        })
      );
      const nearFootprint = (x: number, z: number, margin: number) => (
        footprintCells(x - margin - 18, x + margin + 18, z - margin - 18, z + margin + 18, (bucket) => {
          if (!bucket) return false;
          for (const index of bucket) {
            const dx = x - footprints[index];
            const dz = z - footprints[index + 1];
            const cos = footprints[index + 2];
            const sin = footprints[index + 3];
            const halfWidth = footprints[index + 4];
            const halfDepth = footprints[index + 5];
            if (
              Math.abs(dx * cos - dz * sin) < halfWidth + margin
              && Math.abs(dx * sin + dz * cos) < halfDepth + margin
            ) return true;
            // Nor inside the building's (axis-aligned) collider, where a perch
            // beside a turned building could not be reached.
            if (
              Math.abs(dx) < Math.abs(cos) * halfWidth + Math.abs(sin) * halfDepth
              && Math.abs(dz) < Math.abs(sin) * halfWidth + Math.abs(cos) * halfDepth
            ) return true;
          }
          return false;
        })
      );

      // One plot: clearance tests in rising cost order, then the box, its
      // collider (the axis-aligned bounds of the turned footprint, so a bird
      // can never clip a corner) and an optional stair head.
      // `shaft` turns the plot into a tower: the plot footprint becomes a 3–5
      // storey podium and a narrower shaft rises through it to `height`.
      const placeBuilding = (
        x: number, z: number, yaw: number, width: number, depth: number, height: number, gap: number, color: THREE.Color, roofChance: number,
        shaft?: { width: number; depth: number; podium: number },
      ) => {
        const cos = Math.cos(yaw);
        const sin = Math.sin(yaw);
        const halfWidth = width / 2;
        const halfDepth = depth / 2;
        const reachX = Math.abs(cos) * halfWidth + Math.abs(sin) * halfDepth;
        const reachZ = Math.abs(sin) * halfWidth + Math.abs(cos) * halfDepth;
        if (Math.abs(x - centerX) + reachX > tileSize / 2 - 0.8 || Math.abs(z - centerZ) + reachZ > tileSize / 2 - 0.8) return false;
        if (Math.abs(x) > FLIGHT_EXTENT.x - reachX || Math.abs(z) > FLIGHT_EXTENT.z - reachZ) return false;
        if (footprintOverlaps(x, z, cos, sin, halfWidth, halfDepth, reachX, reachZ, gap)) return false;
        if (tileNearPark && inDhakaPark(x, z, Math.max(halfWidth, halfDepth) + 6)) return false;
        if (inDhakaOpenGround(x, z, Math.max(halfWidth, halfDepth))) return false;
        if (blockedByMap(x, z, halfWidth, halfDepth)) return false;
        let top = height;
        // Landmarks keep a small forecourt and are never towered over by the
        // plots right next to them.
        for (const landmark of tileLandmarks) {
          const gapX = Math.max(0, Math.abs(x - landmark.x) - landmark.halfWidth - reachX);
          const gapZ = Math.max(0, Math.abs(z - landmark.z) - landmark.halfDepth - reachZ);
          const distance = Math.hypot(gapX, gapZ);
          // Open landmark ground (plazas, lawns, bowls) only keeps plots off;
          // it has no height, so it never caps its neighbours.
          if (landmark.top <= 0) {
            if (distance < 10) return false;
            continue;
          }
          if (distance < (landmark.gap ?? 10)) return false;
          if (distance < 80) top = Math.min(top, Math.max(12, landmark.top * 0.6 + distance * 0.3));
        }
        for (const perch of tileAreaPerches) {
          const gapX = Math.max(0, Math.abs(x - perch.x) - reachX);
          const gapZ = Math.max(0, Math.abs(z - perch.z) - reachZ);
          if (gapX * gapX + gapZ * gapZ < 50 * 50) top = Math.min(top, perch.altitude - 8);
        }
        if (top < 6) return false;
        const footprintIndex = footprints.length;
        footprints.push(x, z, cos, sin, halfWidth, halfDepth);
        footprintCells(x - reachX, x + reachX, z - reachZ, z + reachZ, (bucket, key) => {
          if (bucket) bucket.push(footprintIndex);
          else footprintGrid.set(key, [footprintIndex]);
        });
        if (shaft && top > shaft.podium + 14) {
          // Podium over the whole plot, in a darker tone of the tower's cladding.
          buildingMatrices.push(
            cos * width, 0, -sin * width, 0,
            0, shaft.podium, 0, 0,
            sin * depth, 0, cos * depth, 0,
            x, shaft.podium / 2 + 0.92, z, 1,
          );
          buildingColors.push(color.r * 0.8, color.g * 0.8, color.b * 0.8);
          const podiumCollider = { x, z, halfWidth: reachX, halfDepth: reachZ, top: shaft.podium + 0.92 };
          tileColliders.push(podiumCollider);
          colliders.push(podiumCollider);
        }
        if (shaft) {
          width = shaft.width;
          depth = shaft.depth;
        }
        const bodyReachX = shaft ? Math.abs(cos) * width / 2 + Math.abs(sin) * depth / 2 : reachX;
        const bodyReachZ = shaft ? Math.abs(sin) * width / 2 + Math.abs(cos) * depth / 2 : reachZ;
        buildingMatrices.push(
          cos * width, 0, -sin * width, 0,
          0, top, 0, 0,
          sin * depth, 0, cos * depth, 0,
          x, top / 2 + 0.92, z, 1,
        );
        buildingColors.push(color.r, color.g, color.b);
        const collider = { x, z, halfWidth: bodyReachX, halfDepth: bodyReachZ, top: top + 0.92 };
        tileColliders.push(collider);
        colliders.push(collider);
        // Roof furniture shares the stair heads' instance list. A corrugated
        // tin sheet covers a share of the low buildings; taller roofs carry a
        // black or blue plastic water tank beside the stair head.
        if (!shaft && top < 15 && random() < tinRoofChance) {
          const sheet = 0.55;
          roofMatrices.push(
            cos * (width + 0.7), 0, -sin * (width + 0.7), 0,
            0, sheet, 0, 0,
            sin * (depth + 0.7), 0, cos * (depth + 0.7), 0,
            x, top + sheet / 2 + 0.92, z, 1,
          );
          shadeColor.setHex(tinRoofShades[Math.floor(random() * tinRoofShades.length)]).offsetHSL(0, 0, (random() - 0.5) * 0.06);
          roofColors.push(shadeColor.r, shadeColor.g, shadeColor.b);
        } else if (top >= 11 && random() < 0.34) {
          const tankSize = 1.3 + random() * 0.8;
          const tankX = (random() < 0.5 ? -1 : 1) * width * (0.26 + random() * 0.12);
          const tankZ = (random() < 0.5 ? -1 : 1) * depth * (0.26 + random() * 0.12);
          roofMatrices.push(
            cos * tankSize, 0, -sin * tankSize, 0,
            0, tankSize * 1.15, 0, 0,
            sin * tankSize, 0, cos * tankSize, 0,
            x + tankX * cos + tankZ * sin, top + tankSize * 0.575 + 0.92, z - tankX * sin + tankZ * cos, 1,
          );
          shadeColor.setHex(WATER_TANK_SHADES[Math.floor(random() * WATER_TANK_SHADES.length)]);
          roofColors.push(shadeColor.r, shadeColor.g, shadeColor.b);
        }
        let stairX = 0;
        let stairZ = 0;
        if (top > 14 && random() < roofChance) {
          const roofHeight = 2.4 + random() * 3.0;
          stairX = (random() - 0.5) * width * 0.24;
          stairZ = (random() - 0.5) * depth * 0.24;
          const roofWidth = width * (0.2 + random() * 0.18);
          const roofDepth = depth * (0.2 + random() * 0.18);
          roofMatrices.push(
            cos * roofWidth, 0, -sin * roofWidth, 0,
            0, roofHeight, 0, 0,
            sin * roofDepth, 0, cos * roofDepth, 0,
            x + stairX * cos + stairZ * sin, top + roofHeight / 2 + 0.92, z - stairX * sin + stairZ * cos, 1,
          );
          shadeColor.setHex(0x7c7770).offsetHSL(0, 0, (random() - 0.5) * 0.05);
          roofColors.push(shadeColor.r, shadeColor.g, shadeColor.b);
        }
        if (top >= 10 && top <= 46 && width >= 12 && depth >= 12) {
          rooftopGardenCandidates.push({ x, z, width, depth, topY: top + 0.92, heading: yaw, stairX, stairZ });
        }
        return true;
      };

      // Dense Dhaka urban fabric: each 115 m block of the tile is laid out as
      // plots facing its nearest road — rows of buildings back to back, a lane
      // every few plots — sized and stacked by district (see DHAKA_URBAN_ZONES)
      // and thinned out where the city frays into fields and wetland.
      const blockSize = tileSize / 4;
      for (let blockX = 0; blockX < 4; blockX++) {
        for (let blockZ = 0; blockZ < 4; blockZ++) {
          const blockCenterX = tileMinX + (blockX + 0.5) * blockSize;
          const blockCenterZ = tileMinZ + (blockZ + 0.5) * blockSize;
          if (Math.abs(blockCenterX) > FLIGHT_EXTENT.x + blockSize / 2 || Math.abs(blockCenterZ) > FLIGHT_EXTENT.z + blockSize / 2) continue;
          if (tileNearPark && inDhakaPark(blockCenterX, blockCenterZ, -blockSize * 0.75)) continue;
          if (inDhakaOpenGround(blockCenterX, blockCenterZ, -blockSize * 0.75)) continue;
          const { style, zoneInfluence } = dhakaUrbanFabric(blockCenterX, blockCenterZ);
          let districtProximity = 0;
          for (const district of districtCenters) {
            const proximity = clamp(1 - Math.hypot(blockCenterX - district.x, blockCenterZ - district.z) / 2_000, 0, 1);
            districtProximity = Math.max(districtProximity, proximity * district.intensity);
          }
          const urban = clamp(Math.max(districtProximity, zoneInfluence > 0 ? 0.4 + 0.6 * zoneInfluence : 0), 0.12, 1);
          const blockGreen = dhakaGreenWeight(blockCenterX, blockCenterZ);
          // Built-up districts are a continuous crust: empty plot groups and
          // lots fall away steeply once a district claims the block, while the
          // unclaimed fringe (urban ≈ 0.12) stays mostly fields.
          const plotBlockVacancy = Math.min(0.9, 0.95 * (1 - urban) ** 2.6);
          const lotVacancy = 0.01 + 0.13 * (1 - urban) ** 1.5 + clamp((blockGreen - 0.95) * 0.16, 0, 0.1);
          const roofChance = 0.32 + 0.2 * (1 - urban);
          tinRoofChance = Math.min(0.95, 0.05 + 0.1 * (1 - urban) + style.organic * 0.5 + style.tin);
          tinRoofShades = style.tin > 0.45 ? SETTLEMENT_TIN_SHADES : TIN_ROOF_SHADES;
          const heading = roadHeadingAt(blockCenterX, blockCenterZ);
          const headingCos = Math.cos(heading);
          const headingSin = Math.sin(heading);
          const pitchU = style.lotW + style.gap;
          const pitchV = style.lotD + style.gap;
          const reach = blockSize * 0.72;
          let row = 0;
          for (let v = -reach + random() * pitchV; v < reach; row++) {
            const rowCenter = v + pitchV / 2;
            for (let u = -reach + random() * pitchU; u < reach; u += style.lane) {
              const plotsInBlock = 3 + Math.floor(random() * 3);
              const emptyBlock = random() < plotBlockVacancy;
              for (let plot = 0; plot < plotsInBlock && u < reach; plot++) {
                // Towers stand on two or three amalgamated plots where the row has them.
                const tower = !emptyBlock && random() < style.tower;
                const span = emptyBlock
                  ? 1
                  : tower
                    ? Math.max(1, Math.min(random() < 0.35 ? 3 : 2, plotsInBlock - plot))
                    : plot + 1 < plotsInBlock && random() < 0.1 ? 2 : 1;
                plot += span - 1;
                const plotCenter = u + (pitchU * span) / 2;
                u += pitchU * span;
                const lotX = blockCenterX + headingCos * plotCenter + headingSin * rowCenter;
                const lotZ = blockCenterZ - headingSin * plotCenter + headingCos * rowCenter;
                if (Math.abs(lotX - blockCenterX) > blockSize / 2 || Math.abs(lotZ - blockCenterZ) > blockSize / 2) continue;
                if (emptyBlock || random() < lotVacancy) {
                  vacantLots.push(lotX, lotZ);
                  continue;
                }
                // Squaring the roll keeps most towers near the district's lower
                // bound and lets only a few reach its tallest storeys.
                const floors = tower
                  ? Math.round(style.towerMin + random() ** 2 * (style.towerMax - style.towerMin))
                  : Math.floor(style.minFloors + random() ** 1.25 * (style.maxFloors - style.minFloors + 1));
                const height = floors * (2.95 + random() * 0.38);
                let width = (pitchU * span - style.gap) * (tower ? 0.97 : 0.88 + random() * 0.12);
                let depth = (pitchV - style.gap) * (tower ? 0.97 : 0.85 + random() * 0.15);
                const shaft = tower
                  ? {
                    width: Math.min(width, 38) * (0.72 + random() * 0.14),
                    depth: depth * (0.74 + random() * 0.14),
                    podium: (3 + Math.floor(random() * 3)) * 3.6,
                  }
                  : undefined;
                // Back-to-back rows: each building hugs the lane its row faces.
                const shift = ((pitchV - style.gap - depth) / 2) * (row % 2 === 0 ? -1 : 1);
                const x = lotX + headingSin * shift;
                const z = lotZ + headingCos * shift;
                const yaw = heading + (random() - 0.5) * 2 * style.organic;
                pickBuildingShade(shadeColor, style, tower, height, random);
                if (!placeBuilding(x, z, yaw, width, depth, height, style.gap, shadeColor, roofChance, shaft)) {
                  // Squeeze a smaller building into what the neighbours, roads
                  // and water leave of the plot.
                  width *= 0.64;
                  depth *= 0.64;
                  if (width >= 6 && depth >= 6) placeBuilding(lotX, lotZ, yaw, width, depth, Math.min(height, 24), style.gap, shadeColor, roofChance);
                }
              }
            }
            v += pitchV;
            if (row % 2 === 1) v += style.lane;
          }
        }
      }

      // Structured Dhaka urban greenery: park groves, lakeside embankments,
      // tree-lined avenues, courtyard pockets, and rooftop chhad-bagan gardens.
      const treeSpots: Array<{ x: number; z: number; minSep: number }> = [];
      // "wood" is a park tree for woodland rows: one broad crown standing
      // close enough to its neighbours to close the canopy, at half the
      // triangles of a two-blob park tree.
      type TreeTier = "park" | "wood" | "lakeside" | "avenue" | "courtyard";
      const pickCanopyShade = (tier: TreeTier) => {
        const flowerRoll = vegRandom();
        if (tier === "wood") {
          if (flowerRoll < 0.008) return krishnachuraColor;
        } else if (tier === "park" || tier === "lakeside") {
          if (flowerRoll < 0.014) return krishnachuraColor;
          if (flowerRoll < 0.021) return radhachuraColor;
          if (flowerRoll < 0.026) return jarulColor;
        } else if (tier === "avenue") {
          if (flowerRoll < 0.012) return krishnachuraColor;
          if (flowerRoll < 0.018) return radhachuraColor;
        } else if (flowerRoll < 0.006) {
          return krishnachuraColor;
        }
        return foliagePalette[Math.floor(vegRandom() * foliagePalette.length)];
      };

      const placeTree = (x: number, z: number, tier: TreeTier) => {
        const canopyRadius = tier === "wood"
          ? 5.2 + vegRandom() * 3.4
          : tier === "park"
          ? 4.0 + vegRandom() * 3.0
          : tier === "lakeside" || tier === "avenue"
            ? 3.2 + vegRandom() * 2.2
            : 2.7 + vegRandom() * 1.9;
        // Park and bank crowns overlap into one mass; street trees stand apart.
        const minSep = tier === "wood"
          ? canopyRadius * 0.95
          : tier === "park" || tier === "lakeside" ? canopyRadius * 1.05 : canopyRadius * 1.45;
        if (treeSpots.some((spot) => {
          const sep = Math.max(minSep, spot.minSep) * 0.85;
          return (x - spot.x) ** 2 + (z - spot.z) ** 2 < sep * sep;
        })) return false;
        if (treeBlockedByMap(x, z, canopyRadius)) return false;
        if (nearFootprint(x, z, Math.max(1.4, canopyRadius * 0.42))) return false;

        treeSpots.push({ x, z, minSep });
        const trunkHeight = tier === "park" || tier === "wood"
          ? 6.2 + vegRandom() * 4.0
          : tier === "lakeside" || tier === "avenue"
            ? 5.4 + vegRandom() * 3.2
            : 4.8 + vegRandom() * 3.0;
        const trunkThickness = tier === "park" || tier === "wood" ? 0.62 + vegRandom() * 0.36 : 0.5 + vegRandom() * 0.3;
        quaternion.setFromEuler(new THREE.Euler((vegRandom() - 0.5) * 0.08, vegRandom() * Math.PI, (vegRandom() - 0.5) * 0.08));
        position.set(x, trunkHeight / 2 + 0.92, z);
        scale.set(trunkThickness, trunkHeight, trunkThickness);
        trunkTransforms.push(matrix.compose(position, quaternion, scale).clone());
        const crownBase = trunkHeight + 0.92;
        const shade = pickCanopyShade(tier);
        const blobCount = tier === "wood"
          ? 1
          : tier === "park"
          ? 2 + Math.floor(vegRandom() * 2)
          : tier === "courtyard"
            ? (canopyRadius > 3.5 ? 2 : 1)
            : 2;
        let crownTop = crownBase;
        for (let blob = 0; blob < blobCount; blob++) {
          const spread = blob === 0 ? 0 : canopyRadius * (0.34 + vegRandom() * 0.42);
          const angle = vegRandom() * Math.PI * 2;
          const blobRadius = canopyRadius * (blob === 0 ? 1 : 0.62 + vegRandom() * 0.28);
          const blobHeight = blobRadius * (0.62 + vegRandom() * 0.24);
          position.set(
            x + Math.cos(angle) * spread,
            crownBase + (blob === 0 ? blobRadius * 0.48 : blobRadius * (0.2 + vegRandom() * 0.55)),
            z + Math.sin(angle) * spread,
          );
          quaternion.setFromEuler(new THREE.Euler(vegRandom(), vegRandom(), vegRandom()));
          scale.set(blobRadius, blobHeight, blobRadius);
          foliageTransforms.push(matrix.compose(position, quaternion, scale).clone());
          foliageColors.push(shade.clone().offsetHSL((vegRandom() - 0.5) * 0.02, (vegRandom() - 0.5) * 0.07, (vegRandom() - 0.5) * 0.05));
          crownTop = Math.max(crownTop, position.y + blobHeight * 0.8);
        }
        registerTreePerch({
          position: new THREE.Vector3(x, crownTop - 0.3, z),
          label: "Treetop",
          heading: 0,
          kind: "tree",
        });
        return true;
      };

      // Pass 1: Direct park-coordinate sampling so every Dhaka park (even compact
      // ones like Shahabuddin Park or Baldha Garden) gets lush woodland regardless
      // of tile alignment, while keeping footpath loops clear on larger parks.
      for (let parkIndex = 0; parkIndex < DHAKA_PARKS.length; parkIndex++) {
        const park = DHAKA_PARKS[parkIndex];
        if (
          Math.abs(centerX - park.x) > tileSize * 0.65 + park.rx
          || Math.abs(centerZ - park.z) > tileSize * 0.65 + park.rz
        ) continue;
        const pRng = seededRandom(41_017 + parkIndex * 977);
        // Woodland rows are planted about twice as thick, to a higher cap.
        const parkTreeTotal = park.wooded
          ? clamp(Math.round((Math.PI * park.rx * park.rz) / 620), 28, 760)
          : clamp(Math.round((Math.PI * park.rx * park.rz) / 440), 28, 175);
        const hasLoop = park.hasLoop;
        for (let i = 0; i < parkTreeTotal; i++) {
          const radial = Math.sqrt(pRng()) * 0.96;
          const angle = pRng() * Math.PI * 2;
          if (hasLoop && radial > 0.63 && radial < 0.74) continue;
          const lx = Math.cos(angle) * radial * (park.rx - 4);
          const lz = Math.sin(angle) * radial * (park.rz - 4);
          const px = park.x + lx * park.fwdCos - lz * park.fwdSin;
          const pz = park.z + lx * park.fwdSin + lz * park.fwdCos;
          if (Math.round(px / tileSize) !== tileX || Math.round(pz / tileSize) !== tileZ) continue;
          placeTree(px, pz, park.wooded ? "wood" : "park");
        }
        const parkBushTotal = park.wooded ? 0 : Math.round(parkTreeTotal * 0.35);
        for (let i = 0; i < parkBushTotal; i++) {
          const radial = Math.sqrt(pRng()) * 0.95;
          const angle = pRng() * Math.PI * 2;
          if (hasLoop && radial > 0.64 && radial < 0.73) continue;
          const lx = Math.cos(angle) * radial * (park.rx - 4);
          const lz = Math.sin(angle) * radial * (park.rz - 4);
          const px = park.x + lx * park.fwdCos - lz * park.fwdSin;
          const pz = park.z + lx * park.fwdSin + lz * park.fwdCos;
          if (Math.round(px / tileSize) !== tileX || Math.round(pz / tileSize) !== tileZ) continue;
          const radius = 1.0 + pRng() * 1.4;
          if (treeBlockedByMap(px, pz, radius)) continue;
          quaternion.setFromEuler(new THREE.Euler(pRng(), pRng(), pRng()));
          position.set(px, 0.92 + radius * 0.5, pz);
          scale.set(radius, radius * (0.65 + pRng() * 0.32), radius);
          foliageTransforms.push(matrix.compose(position, quaternion, scale).clone());
          foliageColors.push(bushPalette[Math.floor(pRng() * bushPalette.length)].clone().offsetHSL(0, (pRng() - 0.5) * 0.05, (pRng() - 0.5) * 0.04));
        }
      }

      const outerTaper = (Math.abs(centerX) > 7_800 || Math.abs(centerZ) > 9_800) ? 0.5 : 1;
      const tileKey = spatialKey(tileX, tileZ);

      // Pass 2: Lakeside & riverbank embankments (Hatirjheel, Dhanmondi Lake,
      // Gulshan-Banani Lake, Crescent Lake, and major water edges).
      const shoreSegments = tileShoreSegments.get(tileKey);
      if (shoreSegments && shoreSegments.length > 0) {
        let shoreTreesPlaced = 0;
        // Leafy districts (Gulshan, Banani, Dhanmondi, the Cantonment) get a
        // continuous belt along the bank; elsewhere the line stays broken.
        const leafyBank = greenWeight > 1.05;
        const shoreCap = Math.round((leafyBank ? 46 : 28) * outerTaper);
        const shoreStep = (leafyBank ? 10.5 : 20) / clamp(greenWeight, 0.6, 1.4);
        for (const seg of shoreSegments) {
          if (shoreTreesPlaced >= shoreCap) break;
          const nx = -(seg.z2 - seg.z1) / seg.length;
          const nz = (seg.x2 - seg.x1) / seg.length;
          for (let dist = 8 + vegRandom() * 8; dist < seg.length - 6 && shoreTreesPlaced < shoreCap; dist += shoreStep * (0.75 + vegRandom() * 0.55)) {
            const t = dist / seg.length;
            const mx = seg.x1 + (seg.x2 - seg.x1) * t;
            const mz = seg.z1 + (seg.z2 - seg.z1) * t;
            const bankOffset = 5.5 + vegRandom() * 5.0;
            const posInWater = pointInWaterArea(mx + nx * bankOffset, mz + nz * bankOffset);
            const negInWater = pointInWaterArea(mx - nx * bankOffset, mz - nz * bankOffset);
            if (posInWater === negInWater) continue;
            const side = posInWater ? -1 : 1;
            const tx = mx + nx * side * bankOffset;
            const tz = mz + nz * side * bankOffset;
            if (Math.round(tx / tileSize) !== tileX || Math.round(tz / tileSize) !== tileZ) continue;
            if (placeTree(tx, tz, "lakeside")) {
              shoreTreesPlaced++;
            }
          }
        }
      }

      // Pass 3: Tree-lined avenues & boulevards in natural clusters along road
      // shoulders (dense in Ramna/DU/Dhanmondi/Gulshan, sparse in Old Dhaka).
      const roadSegments = tileRoadSegments.get(tileKey);
      if (roadSegments && roadSegments.length > 0) {
        let avenueTreesPlaced = 0;
        const avenueCap = Math.round(clamp(16 * greenWeight, 5, 24) * outerTaper);
        for (const seg of roadSegments) {
          if (avenueTreesPlaced >= avenueCap) break;
          const baseStep = (seg.major ? 28 : 42) / clamp(greenWeight, 0.35, 1.55);
          const nx = -(seg.z2 - seg.z1) / seg.length;
          const nz = (seg.x2 - seg.x1) / seg.length;
          let side = vegRandom() < 0.5 ? 1 : -1;
          let clusterRemaining = 3 + Math.floor(vegRandom() * 4);
          let dist = 8 + vegRandom() * 12;
          while (dist < seg.length - 6 && avenueTreesPlaced < avenueCap) {
            const t = dist / seg.length;
            const offset = seg.asphaltHalf + 2.3 + vegRandom() * 2.2;
            const tx = seg.x1 + (seg.x2 - seg.x1) * t + nx * side * offset;
            const tz = seg.z1 + (seg.z2 - seg.z1) * t + nz * side * offset;
            if (Math.round(tx / tileSize) === tileX && Math.round(tz / tileSize) === tileZ && placeTree(tx, tz, "avenue")) {
              avenueTreesPlaced++;
            }
            clusterRemaining--;
            if (clusterRemaining <= 0) {
              dist += baseStep * (1.8 + vegRandom() * 1.1);
              side = -side;
              clusterRemaining = 3 + Math.floor(vegRandom() * 4);
            } else {
              dist += baseStep * (0.7 + vegRandom() * 0.45);
            }
          }
        }
      }

      // Pass 4: Courtyard & compound pocket trees (with up to 4 retries per tree)
      // scaled by neighborhood greenness so leafy neighborhoods feel distinct from
      // Old Dhaka and Motijheel while keeping treetop perches available citywide.
      // Open plots left by the lot layout come first, since the packed blocks
      // leave few random gaps wide enough for a canopy.
      const targetCourtyardTrees = Math.max(2, Math.round((9 + vegRandom() * 5) * greenWeight * (greenWeight > 1.05 ? 1.5 : 1) * outerTaper));
      let courtyardTrees = 0;
      for (let lot = 0; lot < vacantLots.length && courtyardTrees < targetCourtyardTrees; lot += 2) {
        if (vegRandom() > 0.5) continue;
        const x = vacantLots[lot] + (vegRandom() - 0.5) * 6;
        const z = vacantLots[lot + 1] + (vegRandom() - 0.5) * 6;
        if (placeTree(x, z, inDhakaPark(x, z) ? "park" : "courtyard")) courtyardTrees++;
      }
      for (let index = courtyardTrees; index < targetCourtyardTrees; index++) {
        for (let attempt = 0; attempt < 6; attempt++) {
          const x = centerX + (vegRandom() - 0.5) * (tileSize - 32);
          const z = centerZ + (vegRandom() - 0.5) * (tileSize - 32);
          if (placeTree(x, z, inDhakaPark(x, z) ? "park" : "courtyard")) break;
        }
      }

      // Pass 5: Dhaka chhad-bagan (rooftop gardens) along flat residential roofs —
      // reuses the tile's foliage InstancedMesh (0 extra draw calls, no perches).
      // Held to about the per-tile count the sparser layout produced, so the
      // denser roofscape does not multiply 80-triangle shrubs.
      const gardenChance = clamp(0.06 + 0.13 * greenWeight, 0.07, 0.24) * 0.5;
      let gardenRoofs = 0;
      for (const roof of rooftopGardenCandidates) {
        if (gardenRoofs >= 7) break;
        if (vegRandom() > gardenChance) continue;
        gardenRoofs++;
        const cosH = Math.cos(-roof.heading);
        const sinH = Math.sin(-roof.heading);
        const edgeSide = vegRandom() < 0.5 ? -1 : 1;
        const alongX = vegRandom() < 0.5;
        const shrubCount = 2 + Math.floor(vegRandom() * 3);
        for (let s = 0; s < shrubCount; s++) {
          const frac = shrubCount === 1 ? 0 : (s / (shrubCount - 1) - 0.5) * 0.62;
          const localX = alongX ? frac * roof.width : edgeSide * (roof.width * 0.34);
          const localZ = alongX ? edgeSide * (roof.depth * 0.34) : frac * roof.depth;
          if (Math.hypot(localX - roof.stairX, localZ - roof.stairZ) < 3.0) continue;
          const wx = roof.x + localX * cosH - localZ * sinH;
          const wz = roof.z + localX * sinH + localZ * cosH;
          const r = 0.85 + vegRandom() * 0.75;
          const h = r * (0.58 + vegRandom() * 0.28);
          quaternion.setFromEuler(new THREE.Euler(vegRandom(), vegRandom(), vegRandom()));
          position.set(wx, roof.topY + h * 0.5, wz);
          scale.set(r, h, r);
          foliageTransforms.push(matrix.compose(position, quaternion, scale).clone());
          const plantShade = vegRandom() < 0.06
            ? bougainvilleaColor
            : rooftopGardenPalette[Math.floor(vegRandom() * rooftopGardenPalette.length)];
          foliageColors.push(plantShade.clone().offsetHSL((vegRandom() - 0.5) * 0.02, (vegRandom() - 0.5) * 0.06, (vegRandom() - 0.5) * 0.05));
        }
      }

      const group = new THREE.Group();
      group.name = `Procedural district tile ${tileX},${tileZ}`;
      const buildingCount = buildingMatrices.length / 16;
      const instanceCount = buildingCount + roofMatrices.length / 16;
      let buildings: THREE.InstancedMesh | null = null;
      if (instanceCount > 0) {
        buildings = new THREE.InstancedMesh(unitBox, buildingMaterial, instanceCount);
        buildings.name = "Procedural buildings";
        buildings.instanceMatrix.array.set(buildingMatrices);
        buildings.instanceMatrix.array.set(roofMatrices, buildingMatrices.length);
        const instanceColors = new Float32Array(instanceCount * 3);
        instanceColors.set(buildingColors);
        instanceColors.set(roofColors, buildingColors.length);
        buildings.instanceColor = new THREE.InstancedBufferAttribute(instanceColors, 3);
        // Stair heads follow the buildings in the instance list.
        buildings.userData.buildingCount = buildingCount;
        buildings.castShadow = true;
        buildings.receiveShadow = true;
        group.add(buildings);
      }
      if (trunkTransforms.length > 0) {
        const trunks = new THREE.InstancedMesh(trunkGeometry, trunkMaterial, trunkTransforms.length);
        trunkTransforms.forEach((transform, index) => trunks.setMatrixAt(index, transform));
        trunks.instanceMatrix.needsUpdate = true;
        trunks.castShadow = false;
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
      // Keep all tiles detached until the caller swaps the collision grid and
      // reveals the finished district layer in the same frame.
      group.visible = false;
      group.updateMatrixWorld(true);
      group.traverse((object) => { object.matrixAutoUpdate = false; });
      tiles.push({ group, centerX, centerZ, colliders: tileColliders, buildings, detail: 0 });
      await yieldIfNeeded(isCancelled);
  }
  const reveal = (anchor: THREE.Vector3) => {
    for (const tile of tiles) {
      setProceduralTileDetail(scene, tile, proceduralTileDetailAt(tile, anchor.x, anchor.z, visibilityRadius));
    }
    scene.userData.proceduralDistrictTiles = tiles;
    scene.userData.proceduralTileVisibilityRadius = visibilityRadius;
    scene.userData.treePerchGrid = treePerchGrid;
    const immediateCityMass = scene.userData.immediateCityMass as THREE.Group | undefined;
    if (immediateCityMass) immediateCityMass.visible = false;
    const roadFallback = scene.userData.proceduralRoadFallback as THREE.Group | undefined;
    if (roadFallback && data.roads.length > 0) roadFallback.visible = false;
  };
  const dispose = () => {
    for (const tile of tiles) scene.remove(tile.group);
    unitBox.dispose();
    foliageGeometry.dispose();
    trunkGeometry.dispose();
    buildingMaterial.dispose();
    trunkMaterial.dispose();
    foliageMaterial.dispose();
  };
  return { colliders, reveal, dispose };
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
      const diveRush = clamp(-verticalSpeed / 22, 0, 1);
      windLowGain.gain.setTargetAtTime(0.1 + pace * 0.34 + diveRush * 0.08, now, 0.35);
      windAirGain.gain.setTargetAtTime(0.05 + pace * pace * 0.5 + diveRush * 0.2, now, 0.28);
      windAirFilter.frequency.setTargetAtTime(1_100 + pace * 1_900 + diveRush * 780, now, 0.35);
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
  // Map buildings a landmark module stands in for are never drawn either.
  for (const landmarkModule of LANDMARK_MODULE_BY_KIND.values()) {
    for (const osmId of landmarkModule.replacesOsmBuildingIds ?? []) landmarkOsmIds.add(osmId);
  }

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
  const water = new THREE.MeshPhysicalMaterial({ color: 0x48665a, roughness: 0.26, metalness: 0.04, clearcoat: 0.7 });
  const monumentRed = new THREE.MeshStandardMaterial({ color: 0xb92d32, roughness: 0.76 });
  const marble = new THREE.MeshStandardMaterial({ color: 0xf5f2ea, roughness: 0.58 });
  const terracotta = new THREE.MeshStandardMaterial({ color: 0xa9604b, roughness: 0.94 });
  const plazaBrick = new THREE.MeshStandardMaterial({ color: 0x8f4a3a, roughness: 0.96 });
  const deepBrick = new THREE.MeshStandardMaterial({ color: 0x9a3f31, roughness: 0.9 });
  const brickTrim = new THREE.MeshStandardMaterial({ color: 0xc27a62, roughness: 0.86 });
  const cream = new THREE.MeshStandardMaterial({ color: 0xefe6cf, roughness: 0.82 });
  const peach = new THREE.MeshStandardMaterial({ color: 0xe6b497, roughness: 0.86 });
  const tileRoof = new THREE.MeshStandardMaterial({ color: 0x9c4f3c, roughness: 0.9 });
  const salmon = new THREE.MeshStandardMaterial({ color: 0xdf9184, roughness: 0.84 });
  // Ahsan Manzil's pastel pink, with lighter pink-cream for its trims.
  const pink = new THREE.MeshStandardMaterial({ color: 0xec92b8, roughness: 0.8 });
  const pinkTrim = new THREE.MeshStandardMaterial({ color: 0xf7cfdc, roughness: 0.76 });
  const roofTerrace = new THREE.MeshStandardMaterial({ color: 0xb59c90, roughness: 0.95 });
  const stoneStep = new THREE.MeshStandardMaterial({ color: 0x8d7868, roughness: 0.93 });
  const silverPanel = new THREE.MeshStandardMaterial({ color: 0xcdd2d4, roughness: 0.46, metalness: 0.32 });
  const roofGrey = new THREE.MeshStandardMaterial({ color: 0x858c8a, roughness: 0.9 });
  const plantGrey = new THREE.MeshStandardMaterial({ color: 0xa9adab, roughness: 0.7, metalness: 0.2 });
  // Ground infrastructure: the old airfield and the bus terminal yards.
  // Dry, dusty olive turf, as the Tejgaon field reads on the imagery beside
  // the city's grey-brown ground (the old 0x788a57 glowed pastel green).
  const airfieldGrass = new THREE.MeshStandardMaterial({ color: 0x5f6243, roughness: 1 });
  const wornAsphalt = new THREE.MeshStandardMaterial({ color: 0x3b3f40, roughness: 0.96 });
  const agedConcrete = new THREE.MeshStandardMaterial({ color: 0xa6a498, roughness: 0.92 });
  const fadedPaint = new THREE.MeshStandardMaterial({ color: 0xc9c7b8, roughness: 0.9 });
  const yardPaving = new THREE.MeshStandardMaterial({ color: 0x5c5d5a, roughness: 0.97 });
  const tinRoof = new THREE.MeshStandardMaterial({ color: 0x8c9ca1, roughness: 0.55, metalness: 0.35 });
  const hangarWall = new THREE.MeshStandardMaterial({ color: 0xb4bcae, roughness: 0.8, metalness: 0.1 });
  const busGlass = new THREE.MeshStandardMaterial({ color: 0x1c2a30, roughness: 0.3, metalness: 0.2 });
  const busPaint = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.5, metalness: 0.15 });
  const busBodyGeometry = new THREE.BoxGeometry(11.6, 2.9, 2.55);
  const busWindowGeometry = new THREE.BoxGeometry(11.7, 0.85, 2.62);
  // Coach liveries: mostly white, with the greens, blues and reds of the
  // intercity lines and a few of the street-traffic body colours.
  const BUS_LIVERIES = [0xf1efe6, 0xf1efe6, 0xf1efe6, 0x2f7d4f, 0x2c5f9e, 0xc23b32, 0xe0b653, 0xd8d2ba, 0x4e7380, 0x1f6b62];
  const bronze = new THREE.MeshStandardMaterial({ color: 0x6f6a5c, roughness: 0.5, metalness: 0.45 });
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
  const beaconGlass = nightLit(new THREE.MeshPhysicalMaterial({ color: 0x9ad3dc, roughness: 0.12, metalness: 0.12, clearcoat: 0.8 }), 0.95, 0xfff3c8);
  const landmarkBark = new THREE.MeshStandardMaterial({ color: 0x5d4739, roughness: 1 });
  const landmarkCanopy = new THREE.MeshStandardMaterial({ color: 0x356438, roughness: 0.86 });
  const landmarkLightCanopy = new THREE.MeshStandardMaterial({ color: 0x4f7f40, roughness: 0.86 });
  const landmarkKrishnachura = new THREE.MeshStandardMaterial({ color: 0xc84628, roughness: 0.86 });
  const carnivalBlue = new THREE.MeshStandardMaterial({ color: 0x2f7ea0, roughness: 0.52, metalness: 0.16 });
  // Worn footpaths and festival grounds: packed earth, not paving or lawn.
  const packedEarth = new THREE.MeshStandardMaterial({ color: 0xa88b6a, roughness: 1 });
  // Weathered dark green-black copper, as on the dome of Pari Bibi's tomb.
  // Baitul Mukarram: the beige sheet-steel canopy over the prayer deck, and
  // the deep teal inside its portal arches.
  const canopyBeige = new THREE.MeshStandardMaterial({ color: 0xcdbfa6, roughness: 0.7, metalness: 0.15 });
  const tealArch = new THREE.MeshStandardMaterial({ color: 0x2e6e78, roughness: 0.8 });
  const copperDark = new THREE.MeshStandardMaterial({ color: 0x2e3b39, roughness: 0.5, metalness: 0.35 });
  // Kahn's South Plaza brick: brighter and redder than terracotta.
  const plazaRed = new THREE.MeshStandardMaterial({ color: 0xc9563e, roughness: 0.92 });
  // Novo Theatre's pale sky-blue geodesic glass dome.
  // Pan Pacific Sonargaon's dusty pink-beige render.
  const roseBeige = new THREE.MeshStandardMaterial({ color: 0xd3b3a8, roughness: 0.86 });
  const skyGlass = nightLit(new THREE.MeshPhysicalMaterial({ color: 0xa3c2de, roughness: 0.25, metalness: 0.1, clearcoat: 0.5 }), 0.32, 0xdfeaff);
  // Bangladesh Bank Tower: buff-olive spandrel panels and the weathered
  // sage-green concrete of its blank end walls.
  const oliveBuff = new THREE.MeshStandardMaterial({ color: 0xcbc398, roughness: 0.8 });
  const sageConcrete = new THREE.MeshStandardMaterial({ color: 0x8f9a86, roughness: 0.9 });
  // Board-marked fair-faced grey concrete (Liberation War Museum, the
  // Museum of Independence wall).
  const boardConcrete = new THREE.MeshStandardMaterial({ color: 0xa29e95, roughness: 0.92 });
  // Stadium seating green (Sher-e-Bangla's stands).
  const seatGreen = new THREE.MeshStandardMaterial({ color: 0x347a3e, roughness: 0.78 });
  // Star Mosque: the blue-starred white tile of its domes reads as a cool
  // blue-white from the air, and its star pool is bright turquoise tile.
  const starTile = new THREE.MeshStandardMaterial({ color: 0xc9d6ec, roughness: 0.5 });
  const poolTurquoise = new THREE.MeshStandardMaterial({ color: 0x45a9c0, roughness: 0.75 });
  const starBlue = new THREE.MeshStandardMaterial({ color: 0x34589e, roughness: 0.45 });
  // Kamalapur's pale yellow platform-canopy concrete.
  const stationCream = new THREE.MeshStandardMaterial({ color: 0xe3d8a8, roughness: 0.86 });
  // The white nodes and struts of a geodesic glass dome, drawn as the
  // triangle edges of the dome's own mesh (Military Museum).
  const geodesicFrame = new THREE.MeshStandardMaterial({ color: 0xeef1f1, roughness: 0.5, metalness: 0.3, wireframe: true });
  const unitBox = new THREE.BoxGeometry(1, 1, 1);
  const treeCrownGeo = new THREE.IcosahedronGeometry(1, 1);

  const addLandmarkTree = (
    parent: THREE.Object3D,
    x: number,
    z: number,
    radius = 4.6,
    trunkHeight = 6.2,
    canopyMat: THREE.Material = landmarkCanopy,
  ) => {
    addCylinder(parent, 0.45, 0.7, trunkHeight, [x, trunkHeight / 2 + 0.4, z], landmarkBark, 6);
    const crown = new THREE.Mesh(treeCrownGeo, canopyMat);
    crown.position.set(x, trunkHeight + radius * 0.48 + 0.4, z);
    crown.scale.set(radius, radius * 0.72, radius);
    crown.castShadow = true;
    crown.receiveShadow = true;
    parent.add(crown);
  };

  const addFerrisWheel = (
    parent: THREE.Object3D,
    cx: number,
    cz: number,
    radius = 12,
    hubY = 15,
  ) => {
    const wheel = new THREE.Group();
    wheel.position.set(cx, 0, cz);
    parent.add(wheel);
    // Twin A-frame steel legs supporting the hub
    for (const sideZ of [-2.4, 2.4]) {
      for (const leg of [-1, 1]) {
        const strut = addBox(wheel, [0.7, hubY + 2, 0.7], [leg * 3.8, hubY / 2, sideZ], whiteStone);
        strut.rotation.z = leg * 0.26;
      }
    }
    const hub = addCylinder(wheel, 1.3, 1.3, 5.4, [0, hubY, 0], monumentRed, 12);
    hub.rotation.x = Math.PI / 2;
    const SPOKES = 12;
    const cabinMats = [monumentRed, accent, carnivalBlue, whiteStone];
    for (let i = 0; i < SPOKES; i++) {
      const a = (i / SPOKES) * Math.PI * 2;
      const sx = Math.cos(a) * radius;
      const sy = Math.sin(a) * radius;
      const spoke = addBox(wheel, [radius * 2, 0.35, 0.35], [0, hubY, 0], silverPanel);
      spoke.rotation.z = a;
      // Rim chord segment between adjacent spokes
      const aNext = ((i + 1) / SPOKES) * Math.PI * 2;
      const mx = (sx + Math.cos(aNext) * radius) / 2;
      const my = hubY + (sy + Math.sin(aNext) * radius) / 2;
      const chordLen = 2 * radius * Math.sin(Math.PI / SPOKES);
      const rim = addBox(wheel, [chordLen + 0.3, 0.55, 1.8], [mx, my, 0], i % 2 === 0 ? monumentRed : whiteStone);
      rim.rotation.z = (a + aNext) / 2 + Math.PI / 2;
      // Hanging passenger gondola
      addBox(wheel, [2.0, 2.2, 2.1], [sx, hubY + sy - 1.3, 0], cabinMats[i % cabinMats.length]);
    }
  };

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

  // A solid slab shaped as a ring sector: amphitheatre tiers, curved benches,
  // colonnade beams, retaining walls. Angles are measured from local +Z toward
  // +X (the same sense as a Lathe or Cylinder theta), so a sector centred on
  // `thetaStart + thetaLength / 2 = 0` opens toward +Z. Rise is from `y` up by
  // `height`; every face is closed, so stacked tiers never show back faces.
  const addArcSlab = (
    parent: THREE.Object3D,
    innerRadius: number,
    outerRadius: number,
    thetaStart: number,
    thetaLength: number,
    y: number,
    height: number,
    material: THREE.Material,
    segments = 24,
  ) => {
    const shape = new THREE.Shape();
    // Shape XY maps to local (x, -z) once the extrusion is turned to stand up.
    const at = (radius: number, theta: number) => [radius * Math.sin(theta), -radius * Math.cos(theta)] as const;
    shape.moveTo(...at(outerRadius, thetaStart));
    for (let step = 1; step <= segments; step++) shape.lineTo(...at(outerRadius, thetaStart + (thetaLength * step) / segments));
    for (let step = segments; step >= 0; step--) shape.lineTo(...at(innerRadius, thetaStart + (thetaLength * step) / segments));
    const geometry = new THREE.ExtrudeGeometry(shape, { depth: height, bevelEnabled: false, curveSegments: 1 });
    geometry.rotateX(-Math.PI / 2);
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.y = y;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    parent.add(mesh);
    return mesh;
  };

  // A straight box beam from point `a` to point `b` in the parent's frame:
  // arch ribs, struts, hangers, space-frame members. `width` is across, `depth`
  // is the second section side, `overrun` lengthens it so chained beams meet.
  const beamAxis = new THREE.Vector3(0, 0, 1);
  const addBeam = (
    parent: THREE.Object3D,
    a: [number, number, number],
    b: [number, number, number],
    width: number,
    depth: number,
    material: THREE.Material,
    overrun = 0,
  ) => {
    const direction = new THREE.Vector3(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
    const length = direction.length();
    const beam = new THREE.Mesh(unitBox, material);
    beam.scale.set(width, depth, length + overrun);
    beam.position.set((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2);
    if (length > 1e-6) beam.quaternion.setFromUnitVectors(beamAxis, direction.divideScalar(length));
    beam.castShadow = true;
    beam.receiveShadow = true;
    parent.add(beam);
    return beam;
  };

  // Hand-built quads (a deck swept along a curve, a stadium terrace ring) as
  // one mesh. Each quad names the way it must face, and its winding is fixed
  // to match, so single-sided materials always show the outside. The uv
  // attribute is there only so bakeGroup can merge it with built-in shapes.
  type QuadPoint = [number, number, number];
  const addQuads = (parent: THREE.Object3D, quads: Array<[QuadPoint, QuadPoint, QuadPoint, QuadPoint, QuadPoint]>, material: THREE.Material) => {
    const positions: number[] = [];
    for (const [a, b, c, d, out] of quads) {
      const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2];
      const vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
      const facing = (uy * vz - uz * vy) * out[0] + (uz * vx - ux * vz) * out[1] + (ux * vy - uy * vx) * out[2];
      const ring = facing >= 0 ? [a, b, c, d] : [a, d, c, b];
      positions.push(...ring[0], ...ring[1], ...ring[2], ...ring[0], ...ring[2], ...ring[3]);
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute("uv", new THREE.Float32BufferAttribute(new Array((positions.length / 3) * 2).fill(0), 2));
    geometry.computeVertexNormals();
    const mesh = new THREE.Mesh(geometry, material);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    parent.add(mesh);
    return mesh;
  };
  // A box-section ribbon swept along a polyline of [x, topY, z] points: deck
  // slabs, flyover ramps, kerbs and parapets. Each cross-section is square to
  // the path's plan direction (mitred at the bends), so consecutive segments
  // share their edges instead of overlapping as chained beams would. `offset`
  // slides the ribbon sideways (+ is to the right of the direction of travel);
  // `floor`, when given, drops the underside to at least that height, so a
  // deck can close the gap down to a road drawn beneath it.
  const addSweptBox = (
    parent: THREE.Object3D,
    path: QuadPoint[],
    halfWidth: number,
    depth: number,
    material: THREE.Material,
    offset = 0,
    floor = Infinity,
  ) => {
    if (path.length < 2) return null;
    const rings = path.map(([x, y, z], index) => {
      const [ax, , az] = path[Math.max(0, index - 1)];
      const [bx, , bz] = path[Math.min(path.length - 1, index + 1)];
      const length = Math.hypot(bx - ax, bz - az) || 1;
      const rx = -(bz - az) / length;
      const rz = (bx - ax) / length;
      const left = offset - halfWidth;
      const right = offset + halfWidth;
      return {
        rx,
        rz,
        tl: [x + rx * left, y, z + rz * left] as QuadPoint,
        tr: [x + rx * right, y, z + rz * right] as QuadPoint,
        br: [x + rx * right, Math.min(y - depth, floor), z + rz * right] as QuadPoint,
        bl: [x + rx * left, Math.min(y - depth, floor), z + rz * left] as QuadPoint,
      };
    });
    const quads: Array<[QuadPoint, QuadPoint, QuadPoint, QuadPoint, QuadPoint]> = [];
    for (let index = 0; index < rings.length - 1; index++) {
      const p = rings[index];
      const q = rings[index + 1];
      quads.push([p.tl, p.tr, q.tr, q.tl, [0, 1, 0]]);
      quads.push([p.bl, p.br, q.br, q.bl, [0, -1, 0]]);
      quads.push([p.tr, p.br, q.br, q.tr, [p.rx, 0, p.rz]]);
      quads.push([p.tl, p.bl, q.bl, q.tl, [-p.rx, 0, -p.rz]]);
    }
    const first = rings[0];
    const last = rings[rings.length - 1];
    const [sx, , sz] = path[0];
    const [nx, , nz] = path[1];
    const [ex, , ez] = path[path.length - 1];
    const [px, , pz] = path[path.length - 2];
    quads.push([first.tl, first.tr, first.br, first.bl, [sx - nx, 0, sz - nz]]);
    quads.push([last.tl, last.tr, last.br, last.bl, [ex - px, 0, ez - pz]]);
    return addQuads(parent, quads, material);
  };

  // A triangulated geodesic glass dome standing on the ground: an icosphere
  // cut flat where it meets y = 0, with a wireframe twin for the struts.
  // `rise` may exceed `radius` (more than a hemisphere).
  const addGeodesicDome = (
    parent: THREE.Object3D,
    x: number,
    z: number,
    radius: number,
    rise: number,
    detail: number,
    glassMaterial: THREE.Material,
    strutMaterial: THREE.Material,
  ) => {
    const centre = rise - radius;
    const source = new THREE.IcosahedronGeometry(radius, detail);
    const from = source.getAttribute("position");
    const kept: number[] = [];
    for (let index = 0; index < from.count; index += 3) {
      const ys = [from.getY(index), from.getY(index + 1), from.getY(index + 2)];
      if (Math.max(...ys) <= -centre + 0.05) continue;
      for (let corner = 0; corner < 3; corner++) {
        kept.push(from.getX(index + corner), Math.max(-centre, ys[corner]) + centre, from.getZ(index + corner));
      }
    }
    source.dispose();
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.Float32BufferAttribute(kept, 3));
    geometry.computeVertexNormals();
    const glassMesh = new THREE.Mesh(geometry, glassMaterial);
    glassMesh.position.set(x, 0, z);
    glassMesh.castShadow = true;
    glassMesh.receiveShadow = true;
    parent.add(glassMesh);
    const struts = new THREE.Mesh(geometry.clone(), strutMaterial);
    struts.position.set(x, 0, z);
    struts.scale.setScalar(1.006);
    parent.add(struts);
    return glassMesh;
  };

  // A coconut or palmyra palm: a slim leaning trunk and a crown of drooping
  // fronds, far more legible from the air than a round crown on a stick.
  const addPalm = (parent: THREE.Object3D, x: number, z: number, height = 10, lean = 0.08, turn = 0) => {
    const palm = new THREE.Group();
    palm.position.set(x, 0, z);
    palm.rotation.set(lean, turn, 0, "YXZ");
    parent.add(palm);
    addCylinder(palm, 0.2, 0.32, height, [0, height / 2, 0], landmarkBark, 5);
    for (let frond = 0; frond < 7; frond++) {
      const holder = new THREE.Group();
      holder.position.set(0, height, 0);
      holder.rotation.set(0, (frond / 7) * Math.PI * 2, 0);
      palm.add(holder);
      const leaf = addBox(holder, [0.9, 0.1, 3.8], [0, -0.55, 1.75], landmarkLightCanopy);
      leaf.rotation.x = 0.42;
    }
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
      if (source.geometry !== unitBox && source.geometry !== treeCrownGeo) source.geometry.dispose();
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
    // The whole scene: the district and river signs (addCity) redraw too.
    scene.traverse((object) => {
      (object.userData.redrawLabel as (() => void) | undefined)?.();
    });
  };

  const partMaterial = (kind: DhakaLandmark["kind"], part: LandmarkFootprintPart) => {
    if (part.role === "water") return water;
    if (part.role === "ground") {
      if (kind === "shaheed-minar") return plazaBrick;
      if (kind === "amphitheatre") return paleConcrete;
      return lawn;
    }
    // Holy Rosary: a glazed ground floor, louvred upper tiers, a cream lantern drum.
    if (kind === "church") return part.role === "tower" ? cream : part.osmId === 717625483 ? ribbonGlass : roofGrey;
    if (kind === "bashundhara-city") return part.osmId === 1092674471 ? atriumGlass : part.osmId === 1092674472 ? paleConcrete : silverPanel;
    // Police Plaza's podium is cream panelling; BRAC Centre's dark ribbon
    // glazing is the wall plane its projecting concrete ledges stand off.
    if (kind === "police-plaza") return cream;
    if (kind === "brac") return ribbonGlass;
    if (kind === "jamuna-future-park") return silverPanel;
    // TSC: the grey concrete frame of the main block; the auditorium and game room are paler.
    if (kind === "tsc-raju") return part.osmId === 655714604 ? concrete : paleConcrete;
    // Doreen Tower is white aluminium panel; its glass is dressed on.
    if (kind === "hotel") return whiteStone;
    // The science museum's halls, repainted deep teal.
    if (kind === "science-museum") return tealArch;
    if (kind === "parliament") return concrete;
    if (kind === "lalbagh-fort") return part.role === "tomb" ? salmon : part.role === "museum" ? peach : redBrick;
    if (kind === "ahsan-manzil") return pink;
    if (kind === "rose-garden-palace") return marble;
    if (kind === "curzon-hall") return redBrick;
    if (kind === "baitul-mukarram") return cream;
    return whiteStone;
  };

  // The OSM snapshot's heights are coarse tags. Where a part's real proportions
  // matter to how the building reads, model it at its true height instead.
  const PART_HEIGHTS: Record<number, number> = {
    // Holy Rosary Church: the fan's tiers step up toward the lantern tower.
    717625483: 5.4,
    983631142: 9,
    983631141: 12,
    983631140: 11.6,
    370071885: 12, // Science museum exhibition halls: two to three storeys
    498432169: 104, // Doreen Tower: the roof under the sky lounge and prow canopy (112 m overall)
    624025793: 14, // Ahsan Manzil: two storeys on a plinth, the dome carries the height
    624025792: 13.5, // Andarmahal: the same two storeys as the Rangmahal
    24448713: 35, // Bashundhara City mall podium
    1092674471: 76, // the full-height blue glass drum at the tower's east end
    1092674472: 82, // office slab
    264272612: 13.5, // Curzon Hall: two storeys to the parapet, so the tower and turrets stand out
    186664126: 15, // Baitul Mukarram's covered prayer deck; the prayer-hall cube stands above it
    366560370: 20, // Police Plaza Concord: the four-storey podium; its two slab towers are built on it
    229029081: 78, // BRAC Centre: 21 floors, parapet at 78 m
    586535435: 34, // Jamuna Future Park: seven retail floors; the corner pavilions rise to 42 m
    439770540: 12.5, // Rose Garden Palace: two tall storeys under the balustrade; the belvedere carries the height
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
      const defaultExtents: Partial<Record<DhakaLandmark["kind"], [number, number]>> = {
        // The runway strip only; the terminals carry their own columns.
        airport: [40, 40],
        // A patch of runway; hangars and sheds carry their own columns.
        "tejgaon-airport": [20, 20],
        "sayedabad-bus-terminal": [6, 6],
        "gabtoli-bus-terminal": [6, 6],
        "bangladesh-bank": [23.5, 13.5],
        "novo-theatre": [42, 34],
        // Only the outfield centre; the stands carry their own columns.
        "sher-e-bangla-stadium": [12, 12],
        // The mausoleum square; the walk and bridge carry their own columns.
        "zia-udyan": [23, 23],
        // World half extents (E–W, N–S) of the 1.5× mosque on its plinth.
        "sat-gambuj-mosque": [15, 20],
        "dhakeshwari-temple": [7, 7],
        "aparajeyo-bangla": [8, 6],
        // The 1.3× mosque only (long side N–S); its courtyard is cleared, not solid.
        "star-mosque": [8.4, 14.6],
        // The umbrella-shell headhouse; the platforms carry their own boxes.
        "kamalapur-station": [42, 42],
        "ramna-park": [42, 42],
        "suhrawardy-udyan": [21, 21],
        "rabindra-sarobar": [40, 40],
        "baldha-garden": [36, 33],
        "botanical-garden": [54, 48],
        "national-zoo": [60, 54],
        "national-museum": [52, 52],
        "liberation-museum": [33, 33],
        "military-museum": [54, 40],
        // World half extents of the roof plate (its 146 m side runs N–S).
        bcfcc: [65, 74],
        "shishu-park": [44, 40],
        // The fairground carries its own boxes; the extents only centre it.
        "shishu-mela": [10, 10],
        // Only the centre of each; the deck and ramps carry their own columns.
        "hatirjheel-bridge": [12, 12],
        "kuril-flyover": [12, 12],
        // World half extents (E–W, N–S) of the prayer hall, its long side N–S.
        "gulshan-central-mosque": [20, 30],
        // The bowl and the west grandstand (the long axis runs N–S).
        "army-stadium": [76, 110],
        // The blue basin on its island.
        "doyel-chattar": [9.5, 9.5],
        // The fountain basin on the roundabout island.
        "shapla-chattar": [8, 8],
        // World half extents of the plinth (its 60 m side runs at 167°).
        "three-leaders-mausoleum": [23, 33],
        // These sites carry their own collision boxes; the extents only
        // centre the detail group on the table lat/lon.
        "hussaini-dalan": [10, 10],
        "sadarghat-terminal": [10, 10],
        "supreme-court": [10, 10],
        "national-stadium": [10, 10],
        "rayer-bazar-memorial": [10, 10],
        "air-force-museum": [10, 10],
        "sonargaon-hotel": [10, 10],
        // World half extents (E–W, N–S) of the main block, long side N–S.
        "pm-office": [20, 55],
        // World half extents of the nave (its long side runs E–W).
        "armenian-church": [15, 7],
        // The memorial on its plinth.
        "bahadur-shah-park": [6.5, 6.5],
      };
      // A module's extents are local to its heading; these bounds are their
      // world-axis box, centred on its lat/lon.
      const moduleExtents = LANDMARK_MODULE_BY_KIND.get(landmark.kind)?.extents;
      const [halfWidth, halfDepth] = moduleExtents
        ? [
          Math.abs(Math.cos(landmark.heading)) * moduleExtents[0] + Math.abs(Math.sin(landmark.heading)) * moduleExtents[1],
          Math.abs(Math.sin(landmark.heading)) * moduleExtents[0] + Math.abs(Math.cos(landmark.heading)) * moduleExtents[1],
        ]
        : defaultExtents[landmark.kind] ?? [28, 22];
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
      // Most of the Hatirjheel amphitheatre outline stands over the lake on steel
      // piers; its detail branch builds the deck, so the lake shows under it.
      if (part.osmId === 1065574904) continue;

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
  const proceduralKinds = new Set<DhakaLandmark["kind"]>([
    "shaheed-minar",
    "amphitheatre",
    "bangladesh-bank",
    "airport",
    "tejgaon-airport",
    "sayedabad-bus-terminal",
    "gabtoli-bus-terminal",
    "ramna-park",
    "suhrawardy-udyan",
    "rabindra-sarobar",
    "baldha-garden",
    "botanical-garden",
    "national-zoo",
    "national-museum",
    "liberation-museum",
    "military-museum",
    "shishu-park",
    "shishu-mela",
    "novo-theatre",
    "sher-e-bangla-stadium",
    "zia-udyan",
    "sat-gambuj-mosque",
    "dhakeshwari-temple",
    "aparajeyo-bangla",
    "star-mosque",
    "kamalapur-station",
    "bcfcc",
    "hatirjheel-bridge",
    "kuril-flyover",
    "gulshan-central-mosque",
    "army-stadium",
    "doyel-chattar",
    "shapla-chattar",
    "three-leaders-mausoleum",
    "hussaini-dalan",
    "sadarghat-terminal",
    "supreme-court",
    "national-stadium",
    "rayer-bazar-memorial",
    "air-force-museum",
    "sonargaon-hotel",
    "pm-office",
    "armenian-church",
    "bahadur-shah-park",
  ]);

  // What a landmark module (app/landmarks) builds with: the same helpers and
  // materials the branches below use, plus flat colours cached by value so
  // modules never make a material of their own.
  const moduleMaterials: LandmarkKit["materials"] = {
    concrete, paleConcrete, agedConcrete, boardConcrete, sageConcrete,
    whiteStone, marble, cream, stationCream, oliveBuff, fadedPaint,
    brick, redBrick, deepBrick, brickTrim, terracotta, plazaBrick, plazaRed, tileRoof,
    peach, salmon, pink, pinkTrim, roseBeige, monumentRed, canopyBeige,
    glass, darkGlass, ribbonGlass, atriumGlass, skyGlass, archDark, recess,
    accent, bronze, copperDark, silverPanel, tinRoof, roofGrey, plantGrey, roofTerrace, stoneStep,
    lawn, packedEarth, water, poolTurquoise, tealArch, seatGreen,
    wornAsphalt, yardPaving,
    bark: landmarkBark, canopy: landmarkCanopy, lightCanopy: landmarkLightCanopy, krishnachura: landmarkKrishnachura,
  };
  const moduleColours = new Map<string, THREE.MeshStandardMaterial>();
  const moduleMaterial: LandmarkKit["material"] = (color, options = {}) => {
    const roughness = options.roughness ?? 0.85;
    const metalness = options.metalness ?? 0;
    const key = `${color}:${roughness}:${metalness}`;
    let material = moduleColours.get(key);
    if (!material) {
      material = new THREE.MeshStandardMaterial({ color, roughness, metalness });
      moduleColours.set(key, material);
    }
    return material;
  };
  const moduleLitMaterial: LandmarkKit["litMaterial"] = (color, strength = 0.5, tint = 0xffc27a) => {
    const key = `lit:${color}:${strength}:${tint}`;
    let material = moduleColours.get(key);
    if (!material) {
      material = nightLit(new THREE.MeshStandardMaterial({ color, roughness: 0.5, metalness: 0.1 }), strength, tint);
      moduleColours.set(key, material);
    }
    return material;
  };
  const addMesh: LandmarkKit["addMesh"] = (parent, geometry, material, position = [0, 0, 0], rotationY = 0) => {
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.set(...position);
    mesh.rotation.y = rotationY;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    parent.add(mesh);
    return mesh;
  };
  const addPrism: LandmarkKit["addPrism"] = (parent, points, y, height, material) => {
    const geometry = new THREE.ExtrudeGeometry(polygonShape(points), { depth: height, bevelEnabled: false, curveSegments: 1 });
    geometry.rotateX(-Math.PI / 2);
    return addMesh(parent, geometry, material, [0, y, 0]);
  };
  const landmarkModuleStats: Record<string, LandmarkModuleStats> = {};
  scene.userData.landmarkModuleStats = landmarkModuleStats;
  // A module that throws or overruns its triangle budget must not take the
  // rest of the city down with it. It is only logged (an uncaught error would
  // raise the dev overlay over everyone's view) and kept in the diagnostics:
  // `__birdFlightDiagnostics().landmarkModules[key]`.
  const reportLandmarkModule = (message: string) => console.error(message);

  const detailGroup = (landmark: DhakaLandmark) => {
    const bounds = allBounds.get(landmark.kind)!;
    const group = new THREE.Group();
    group.name = `${landmark.label} signature architecture`;
    group.position.set((bounds.minX + bounds.maxX) / 2, 0.9, (bounds.minZ + bounds.maxZ) / 2);
    if (proceduralKinds.has(landmark.kind) || LANDMARK_MODULE_BY_KIND.has(landmark.kind)) group.rotation.y = landmark.heading;
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
    const colliderStart = colliders.length;
    const { group, anchor, outline: partOutline, walls, slab, frame, top } = detailGroup(landmark);
    const cosH = Math.cos(group.rotation.y);
    const sinH = Math.sin(group.rotation.y);
    // Tall features that rise above the footprint's own height get their own
    // collision column (rotated into world space and lifted by group.position.y).
    const solid = (x: number, z: number, half: number, solidTop: number) => {
      const wx = group.position.x + x * cosH + z * sinH;
      const wz = group.position.z - x * sinH + z * cosH;
      colliders.push({ x: wx, z: wz, halfWidth: half, halfDepth: half, top: solidTop + group.position.y });
    };
    // Open ground that belongs to a landmark (a plaza, lawn, forecourt or bowl)
    // and must stay free of generic buildings and park trees. It is a collider
    // the bird can never strike — flight tests `y < top + 5.5`, and this top
    // keeps that false above ground — but OSM buildings, procedural plots and
    // park trees all treat it as occupied. Local centre and half extents; the
    // world box is the axis-aligned bounds of the turned rectangle.
    const clearSite = (x: number, z: number, halfX: number, halfZ: number) => {
      const wx = group.position.x + x * cosH + z * sinH;
      const wz = group.position.z - x * sinH + z * cosH;
      colliders.push({
        x: wx,
        z: wz,
        halfWidth: Math.abs(cosH) * halfX + Math.abs(sinH) * halfZ,
        halfDepth: Math.abs(sinH) * halfX + Math.abs(cosH) * halfZ,
        top: LANDMARK_CLEARING_TOP,
      });
    };
    // A solid box the bird strikes, in local coordinates (world AABB of the
    // turned rectangle), for low wide masses that a square `solid()` fits badly.
    const solidBox = (x: number, z: number, halfX: number, halfZ: number, boxTop: number) => {
      colliders.push({
        x: group.position.x + x * cosH + z * sinH,
        z: group.position.z - x * sinH + z * cosH,
        halfWidth: Math.abs(cosH) * halfX + Math.abs(sinH) * halfZ,
        halfDepth: Math.abs(sinH) * halfX + Math.abs(cosH) * halfZ,
        top: boxTop + group.position.y,
      });
    };
    // A big turned rectangle (local x0…x1, z0…z1) as a tiling of small
    // solid boxes, so the over-cover of each world AABB stays a few metres
    // instead of the huge empty corners one turned box would leave.
    const solidTiles = (x0: number, x1: number, z0: number, z1: number, boxTop: number, cell = 30) => {
      const columns = Math.max(1, Math.ceil((x1 - x0) / cell));
      const rows = Math.max(1, Math.ceil((z1 - z0) / cell));
      const halfX = (x1 - x0) / columns / 2;
      const halfZ = (z1 - z0) / rows / 2;
      for (let column = 0; column < columns; column++) {
        for (let row = 0; row < rows; row++) {
          solidBox(x0 + (column * 2 + 1) * halfX, z0 + (row * 2 + 1) * halfZ, halfX, halfZ, boxTop);
        }
      }
    };
    // Clear an oval bowl or ground (local centre, local semi-axes along X and
    // Z, plus a pad) with world-axis strips, so a turned ellipse does not leave
    // the empty corners one big turned rectangle would.
    const clearOval = (x: number, z: number, radiusX: number, radiusZ: number, pad = 0) => {
      const rim: Array<[number, number]> = [];
      for (let step = 0; step < 72; step++) {
        const angle = (step / 72) * Math.PI * 2;
        const lx = x + Math.sin(angle) * (radiusX + pad);
        const lz = z + Math.cos(angle) * (radiusZ + pad);
        rim.push([group.position.x + lx * cosH + lz * sinH, group.position.z - lx * sinH + lz * cosH]);
      }
      const minZ = Math.min(...rim.map(([, rz]) => rz));
      const maxZ = Math.max(...rim.map(([, rz]) => rz));
      const STRIP = 16;
      for (let z0 = minZ; z0 < maxZ; z0 += STRIP) {
        const z1 = Math.min(maxZ, z0 + STRIP);
        // The oval's x extent over this strip: rim points inside it, plus the
        // crossings of every rim edge with the strip's two edges.
        const xs: number[] = [];
        rim.forEach(([ax, az], index) => {
          const [bx, bz] = rim[(index + 1) % rim.length];
          if (az >= z0 && az <= z1) xs.push(ax);
          for (const edgeZ of [z0, z1]) {
            if ((az - edgeZ) * (bz - edgeZ) < 0) xs.push(ax + ((edgeZ - az) / (bz - az)) * (bx - ax));
          }
        });
        if (!xs.length) continue;
        const left = Math.min(...xs);
        const right = Math.max(...xs);
        colliders.push({ x: (left + right) / 2, z: (z0 + z1) / 2, halfWidth: (right - left) / 2, halfDepth: (z1 - z0) / 2, top: LANDMARK_CLEARING_TOP });
      }
    };
    // A real-world point in this detail group's local frame (heading applied).
    const toLocal = (lat: number, lon: number): [number, number] => {
      const point = coordinatesToWorld(lat, lon);
      const dx = point.x - group.position.x;
      const dz = point.y - group.position.z;
      return [dx * cosH - dz * sinH, dx * sinH + dz * cosH];
    };
    let colliderTop = top;
    let perchTarget: [number, number] = [0, 0];
    // Odd-shaped sites whose bounding box would swallow open ground (a
    // forecourt, the neighbours inside an L) turn this off and cover their own
    // masses with `solid()`/`solidBox()` columns instead.
    let boundsCollider = true;

    if (landmark.kind === "church") {
      // Holy Rosary Church, Tejgaon: a modern quarter-fan hall whose three
      // tiers of shallow red clay-tile roof step up toward the apex, each tier
      // lifted on a ribbon of grey louvred clerestory under a cream fascia
      // with a pink edge line. The glazed ground floor sits behind a ring of
      // pink columns. At the apex stands the arched "tombstone" lantern tower:
      // a cream frame round a full-height panel of grey louvres, crossed in red.
      const HALL = 717625483;
      const MIDDLE = 983631142;
      const INNER = 983631141;
      const TOWER = 983631140;
      const hall = anchor(HALL);
      const tower = anchor(TOWER);
      // A tier's wall line in this group's coordinates.
      const ring = (osmId: number) => {
        const seat = anchor(osmId);
        const local = partOutline(osmId);
        return seat && local ? local.map(([x, z]) => [x + seat.x, z + seat.z] as MapPoint) : null;
      };
      if (hall && tower) {
        const apexX = tower.x;
        const apexZ = tower.z;
        // The fan opens away from the tower, toward the forecourt (NW).
        let faceX = hall.x - apexX;
        let faceZ = hall.z - apexZ;
        const faceLength = Math.hypot(faceX, faceZ) || 1;
        faceX /= faceLength;
        faceZ /= faceLength;
        // A shallow tile roof rising from a tier's eave line to the apex. The
        // part of it inside the next tier up is buried in that tier's mass.
        const tierRoof = (osmId: number, eaveY: number, rise: number, overhang: number) => {
          const points = ring(osmId);
          if (!points) return;
          const eave = offsetPolygon(points, overhang);
          const quads: Array<[QuadPoint, QuadPoint, QuadPoint, QuadPoint, QuadPoint]> = [];
          const apex: QuadPoint = [apexX, eaveY + rise, apexZ];
          eave.forEach(([ax, az], index) => {
            const [bx, bz] = eave[(index + 1) % eave.length];
            quads.push([[ax, eaveY, az], [bx, eaveY, bz], apex, apex, [0, 1, 0]]);
          });
          addQuads(group, quads, tileRoof);
          // Cream fascia with its pink edge line, closing the eave underneath.
          slab(osmId, eaveY - 0.6, 0.6, 1 + overhang / 4, cream);
          slab(osmId, eaveY - 0.78, 0.18, 1 + overhang / 4, salmon);
        };
        // Glazed ground floor, proud of every wall the tiers share with it.
        slab(HALL, 0, 5.4, 1.01, ribbonGlass);
        // Louvred clerestories: the middle and inner tiers above the roof below.
        slab(MIDDLE, 5.6, 3.2, 1.02, roofGrey);
        slab(INNER, 8.8, 3.0, 1.02, roofGrey);
        tierRoof(HALL, 5.4, 1.3, 1.6);
        tierRoof(MIDDLE, 9.0, 1.3, 0.9);
        tierRoof(INNER, 12.0, 1.2, 0.9);
        // Pink columns carrying the lowest eave, just inside its fascia.
        const hallRing = ring(HALL);
        if (hallRing) {
          for (const edge of wallEdges(offsetPolygon(hallRing, 1.0))) {
            if (edge.length < 3) continue;
            const count = Math.max(1, Math.round(edge.length / 4.2));
            for (let index = 0; index < count; index++) {
              const along = (index + 0.5) * (edge.length / count);
              addCylinder(group, 0.32, 0.32, 4.7, [edge.ax + edge.dx * along, 2.35, edge.az + edge.dz * along], salmon, 7);
            }
          }
        }
        // The arched lantern tower, its louvred faces turned down the fan.
        const lantern = new THREE.Group();
        lantern.position.set(apexX, 11.8, apexZ);
        lantern.rotation.y = Math.atan2(faceX, faceZ);
        group.add(lantern);
        const LANTERN_W = 10;
        const LANTERN_H = 14.2;
        const LANTERN_D = 6;
        const archShape = new THREE.Shape();
        archShape.moveTo(-LANTERN_W / 2, 0);
        archShape.lineTo(LANTERN_W / 2, 0);
        archShape.lineTo(LANTERN_W / 2, LANTERN_H - LANTERN_W / 2);
        archShape.absarc(0, LANTERN_H - LANTERN_W / 2, LANTERN_W / 2, 0, Math.PI, false);
        archShape.lineTo(-LANTERN_W / 2, 0);
        const lanternGeometry = new THREE.ExtrudeGeometry(archShape, { depth: LANTERN_D, bevelEnabled: false, curveSegments: 10 });
        lanternGeometry.translate(0, 0, -LANTERN_D / 2);
        const frameMesh = new THREE.Mesh(lanternGeometry, cream);
        frameMesh.castShadow = true;
        frameMesh.receiveShadow = true;
        lantern.add(frameMesh);
        for (const side of [1, -1]) {
          const louvre = new THREE.Mesh(roundArch(7.6, 12.2), roofGrey);
          louvre.position.set(0, 1.1, side * (LANTERN_D / 2 + 0.06));
          louvre.rotation.y = side > 0 ? 0 : Math.PI;
          lantern.add(louvre);
          // Slats across the louvre panel.
          for (let y = 2.2; y < 12.4; y += 1.15) {
            const half = y > 8.4 ? Math.sqrt(Math.max(0, 3.8 * 3.8 - (y - 9.5) ** 2)) : 3.8;
            if (half < 0.8) continue;
            addBox(lantern, [half * 2 - 0.3, 0.16, 0.14], [0, y, side * (LANTERN_D / 2 + 0.12)], ribbonGlass);
          }
        }
        const plaque = new THREE.Mesh(trianglePane(3.6, 2.6), whiteStone);
        plaque.position.set(0, 0.5, LANTERN_D / 2 + 0.22);
        lantern.add(plaque);
        addBox(lantern, [0.55, 4.2, 0.55], [0, LANTERN_H + 2.1, 0], monumentRed);
        addBox(lantern, [2.6, 0.55, 0.55], [0, LANTERN_H + 2.8, 0], monumentRed);
        solid(apexX, apexZ, 5, 11.8 + LANTERN_H);
        // Perch on the crown of the arch, beside the cross.
        perchTarget = [apexX + faceZ * 1.6, apexZ - faceX * 1.6];
        // Herringbone brick forecourt with the blue basin and the Marian statue.
        const courtX = apexX + faceX * 56;
        const courtZ = apexZ + faceZ * 56;
        const court = addBox(group, [30, 0.24, 22], [courtX, 0.12, courtZ], plazaBrick);
        court.rotation.y = Math.atan2(faceX, faceZ) + Math.PI / 2;
        const basinX = apexX + faceX * 50;
        const basinZ = apexZ + faceZ * 50;
        addCylinder(group, 4.6, 4.6, 0.55, [basinX, 0.28, basinZ], whiteStone, 18);
        addCylinder(group, 4.0, 4.0, 0.2, [basinX, 0.5, basinZ], carnivalBlue, 18);
        const statueX = apexX + faceX * 57;
        const statueZ = apexZ + faceZ * 57;
        addBox(group, [1.8, 1.6, 1.8], [statueX, 0.8, statueZ], whiteStone);
        addCylinder(group, 0.45, 0.7, 2.4, [statueX, 2.8, statueZ], carnivalBlue, 7);
        addCylinder(group, 0.3, 0.3, 0.55, [statueX, 4.2, statueZ], whiteStone, 6);
        clearSite(courtX, courtZ, 18, 18);
        for (const [along, across] of [[62, 14], [62, -14], [44, 22], [44, -22]] as const) {
          addLandmarkTree(group, apexX + faceX * along + faceZ * across, apexZ + faceZ * along - faceX * across, 3.6, 7.5);
        }
      }
      colliderTop = 13;
    } else if (landmark.kind === "bashundhara-city") {
      // Bashundhara City, Panthapath: a champagne-silver panelled mall podium
      // broken by deep staggered cut-outs, a polished steel drum standing on
      // its roof, the cinema level's curved roof trimmed in red at the west
      // end, and the low spoked glass dome of the central atrium. At the SE
      // corner a cream office slab with punched windows, capped at its east
      // end by a full-height blue glass drum rising from a white wave canopy.
      const MALL = 24448713;
      const ROTUNDA = 1092674471;
      const TOWER = 1092674472;
      const mall = anchor(MALL);
      if (mall) {
        slab(MALL, 0, 4.4, 1.004, ribbonGlass);
        slab(MALL, 4.4, 0.6, 1.022, paleConcrete);
        // Lighter panel bands, not window ribbons: the mall is mostly blind.
        for (const y of [12, 19.5, 27]) slab(MALL, y, 0.7, 1.003, paleConcrete);
        slab(MALL, mall.height, 1.3, 1.006, silverPanel);
        slab(MALL, mall.height + 1.3, 0.08, 0.965, plantGrey);
        // Deep rectangular cut-outs, stacked in a staggered checker.
        walls(MALL).forEach((edge, edgeIndex) => {
          if (edge.length < 16) return;
          const slots = edge.length > 60 ? 4 : edge.length > 34 ? 3 : 2;
          for (let slot = 0; slot < slots; slot++) {
            const along = edge.length * (slot + 0.5) / slots;
            for (const tier of [0, 1]) {
              const level = (edgeIndex + slot + tier * 2) % 3;
              const height = level === 1 ? 7 : 4.5;
              addOnWall(group, edge, along, 7 + level * 3 + tier * 13, rectPane(Math.min(13, edge.length / slots - 3), height), archDark, 0.2);
            }
          }
        });
        const deck = frame(MALL, [0, 1]);
        if (deck) {
          const roofY = mall.height + 1.38;
          for (const [fx, fz, w, h, d] of [
            [0.36, -0.44, 13, 5, 13], [-0.42, -0.5, 14, 4.5, 10], [0.44, 0.3, 12, 4.5, 14], [0.05, -0.6, 10, 3.6, 8],
          ] as const) {
            addBox(deck.g, [w, h, d], [fx * deck.hx, roofY + h / 2, fz * deck.hz], plantGrey);
          }
          // The polished steel drum on the roof, a third of the way along the
          // Panthapath frontage from the west.
          const drumAt: [number, number] = [-deck.hx * 0.33, deck.hz * 0.62];
          addCylinder(deck.g, 4, 4, 11, [drumAt[0], roofY + 5.5, drumAt[1]], silverPanel, 16);
          addCylinder(deck.g, 4.3, 4.3, 0.6, [drumAt[0], roofY + 11.2, drumAt[1]], plantGrey, 16);
          const cos = Math.cos(deck.g.rotation.y);
          const sin = Math.sin(deck.g.rotation.y);
          const drumX = deck.g.position.x + drumAt[0] * cos + drumAt[1] * sin;
          const drumZ = deck.g.position.z - drumAt[0] * sin + drumAt[1] * cos;
          solid(drumX, drumZ, 4, roofY + 11.5);
          perchTarget = [drumX, drumZ];
          // The cinema level at the west end: a curved roof edged in red.
          const cinemaX = -deck.hx + 12;
          const cinemaDepth = deck.hz * 1.3;
          addBox(deck.g, [22, 5, cinemaDepth], [cinemaX, roofY + 2.5, -deck.hz * 0.12], silverPanel);
          addBox(deck.g, [22.6, 1.5, cinemaDepth + 0.6], [cinemaX, roofY + 4.55, -deck.hz * 0.12], monumentRed);
          const curve = new THREE.Mesh(new THREE.CylinderGeometry(cinemaDepth / 2, cinemaDepth / 2, 22, 16, 1, false, -Math.PI / 2, Math.PI), silverPanel);
          curve.geometry.rotateZ(Math.PI / 2);
          curve.geometry.rotateX(-Math.PI / 2);
          curve.scale.set(1, 0.1, 1);
          curve.position.set(cinemaX, roofY + 5.3, -deck.hz * 0.12);
          deck.g.add(curve);
          // The central atrium's low spoked glass dome, 26 m across.
          const radius = 13;
          const rise = 5;
          const profile: Array<[number, number]> = [];
          for (let step = 0; step <= 6; step++) {
            const angle = (step / 6) * Math.PI / 2;
            profile.push([Math.max(0.001, radius * Math.cos(angle)), rise * Math.sin(angle)]);
          }
          addCylinder(deck.g, radius + 0.6, radius + 0.6, 1.2, [0, roofY + 0.6, 0], silverPanel, 24);
          addLathe(deck.g, profile, 24, [0, roofY + 1.2, 0], atriumGlass);
          const rib = new THREE.TorusGeometry(radius * 0.99, 0.18, 3, 8, Math.PI / 2);
          for (let index = 0; index < 12; index++) {
            const mesh = new THREE.Mesh(rib, silverPanel);
            mesh.scale.y = rise / radius;
            mesh.rotation.y = (index / 12) * Math.PI * 2;
            mesh.position.set(0, roofY + 1.2, 0);
            deck.g.add(mesh);
          }
          addCylinder(deck.g, 2.2, 2.4, 0.8, [0, roofY + 1.2 + rise, 0], silverPanel, 12);
        }
        colliderTop = mall.height + 2;
      }
      const rotunda = anchor(ROTUNDA);
      if (rotunda) {
        const radius = Math.min(rotunda.width, rotunda.depth) / 2;
        for (let y = 40; y < rotunda.height - 4; y += 11) slab(ROTUNDA, y, 0.35, 1.01, silverPanel);
        slab(ROTUNDA, rotunda.height, 1.0, 1.025, silverPanel);
        slab(ROTUNDA, rotunda.height + 1.0, 0.08, 0.94, plantGrey);
        // The white wave canopy that sweeps out from the drum's foot at 34 m.
        const waveY = (mall?.height ?? 35) + 1.5;
        for (const [start, length, y] of [[-0.4, 2.2, waveY], [1.8, 1.6, waveY + 1.2]] as const) {
          const wave = addArcSlab(group, radius - 0.6, radius + 4.4, start, length, y, 0.9, whiteStone, 16);
          wave.position.x = rotunda.x;
          wave.position.z = rotunda.z;
        }
        solid(rotunda.x, rotunda.z, radius, rotunda.height + 1);
      }
      const tower = anchor(TOWER);
      if (tower && mall) {
        // Cream panels with small punched windows in groups of four.
        const punched = rectPane(1, 1.6);
        for (const edge of walls(TOWER)) {
          const groups = Math.max(1, Math.round(edge.length / 9));
          for (let g = 0; g < groups; g++) {
            const centre = edge.length * (g + 0.5) / groups;
            for (let y = mall.height + 2; y < tower.height - 3; y += 3.7) {
              for (const offset of [-2.1, -0.7, 0.7, 2.1]) addOnWall(group, edge, centre + offset, y, punched, archDark, 0.16);
            }
          }
        }
        slab(TOWER, tower.height, 1.4, 1.01, paleConcrete);
        slab(TOWER, tower.height + 1.4, 0.08, 0.93, plantGrey);
        addBox(group, [tower.width * 0.3, 3.2, tower.depth * 0.3], [tower.x, tower.height + 3, tower.z], plantGrey);
        solid(tower.x, tower.z, Math.max(tower.width, tower.depth) / 2, tower.height + 4.6);
      }
    } else if (landmark.kind === "amphitheatre") {
      // Hatirjheel Amphitheatre: an open red stage disk at the lake tip, three
      // separate raked fans of maroon seats on steel V-piers over the water, a
      // big fan of pink paved terraces on the shore side, and a covered ramp up
      // from the plaza. Local +Z points east (the audience faces the stage and
      // the open lake), local +X points north. Water is at local y ≈ -0.4.
      const DECK = 3;
      colliderTop = DECK + 0.6;
      perchTarget = [-6, 18];
      // Everything radiates from the stage centre (the round lobe of OSM 1065574904).
      const bowl = new THREE.Group();
      bowl.position.set(-6, 0, 18);
      group.add(bowl);
      // Stage: coral-red disk on a black plinth band, a pale concrete apron, a
      // black parapet on the water side.
      addCylinder(bowl, 9.6, 9.6, 1.1, [0, DECK - 0.05, 0], recess, 36);
      addCylinder(bowl, 9.5, 9.5, 0.12, [0, DECK + 0.54, 0], monumentRed, 36);
      addArcSlab(bowl, 9.6, 13, 0, Math.PI * 2, DECK - 0.6, 0.6, paleConcrete, 36);
      addArcSlab(bowl, 12.6, 13, -1.75, 3.5, DECK, 1.1, recess, 20);
      // A seat fan: rows of maroon benches rising away from the stage, each row
      // a stepped slab with its own underside (so water shows below), a light
      // grey stair aisle down the middle, and steel V-piers to the lake bed.
      const fan = (start: number, length: number, inner: number, outer: number, rise: number, overWater: boolean) => {
        const rows = Math.round((outer - inner) / 2.2);
        const depth = (outer - inner) / rows;
        const step = rise / rows;
        for (let row = 0; row < rows; row++) {
          const rowTop = DECK + step * (row + 1);
          const r = inner + row * depth;
          addArcSlab(bowl, r, r + depth, start, length, rowTop - step - 0.7, step + 0.7, plazaBrick, 10);
          addArcSlab(bowl, r, r + depth, start + length / 2 - 0.03, 0.06, rowTop - 0.3, 0.36, paleConcrete, 1);
        }
        // Back rail and side cheeks.
        addArcSlab(bowl, outer, outer + 0.5, start, length, DECK + rise - 0.6, 1.7, recess, 10);
        if (!overWater) return;
        for (const theta of [start + 0.05, start + length / 2, start + length - 0.05]) {
          for (const along of [0.3, 0.65, 0.95]) {
            const r = inner + (outer - inner) * along;
            const underside = DECK + rise * along - 0.9;
            for (const lean of [-0.32, 0.32]) {
              const strut = addBox(bowl, [0.45, underside + 0.6, 0.45], [Math.sin(theta) * r, (underside - 0.6) / 2, Math.cos(theta) * r], roofGrey);
              strut.rotation.set(0, theta, lean, "YXZ");
            }
          }
        }
      };
      fan(3.7, 0.92, 13, 37, 9.5, true); // the steep separate fan to the south
      fan(2.76, 0.86, 13, 35, 8.6, true); // the main centre fan, facing east
      fan(0.95, 0.9, 13, 30, 4.4, true); // the low fan wrapping the north side
      // Pink paved terraces stepping up from the stage to the shore road.
      for (let terrace = 0; terrace < 8; terrace++) {
        const r = 13 + terrace * 5.2;
        const terraceTop = DECK + 0.5 * (terrace + 1);
        addArcSlab(bowl, r, r + 5.2, 1.93, 0.75, terraceTop - 1.2, 1.2, salmon, 10);
        addArcSlab(bowl, r, r + 0.35, 1.93, 0.75, terraceTop, 0.06, paleConcrete, 10);
      }
      // Plaza on the shore behind the fans, and the shore piers under the stage.
      addArcSlab(bowl, 38, 60, 2.05, 1.0, -0.9, 1.05, salmon, 12);
      for (let pier = 0; pier < 8; pier++) {
        const theta = (pier / 8) * Math.PI * 2;
        for (const lean of [-0.3, 0.3]) {
          const strut = addBox(bowl, [0.5, DECK + 0.5, 0.5], [Math.sin(theta) * 8, (DECK - 0.8) / 2, Math.cos(theta) * 8], roofGrey);
          strut.rotation.set(0, theta, lean, "YXZ");
        }
      }
      // Covered ramp sweeping along the shore from the plaza up to the top of the
      // terraces: a stepped walkway under a run of pale roof panels on posts.
      for (let segment = 0; segment < 10; segment++) {
        const start = 2.2 + segment * 0.11;
        const walkTop = DECK + 4.6 - segment * 0.75;
        addArcSlab(bowl, 50, 54, start, 0.11, walkTop - 0.6, 0.6, paleConcrete, 2);
        addArcSlab(bowl, 49.4, 54.6, start + 0.01, 0.09, walkTop + 3.4, 0.25, silverPanel, 2);
        const post = start + 0.055;
        addCylinder(bowl, 0.18, 0.18, walkTop + 3.5, [Math.sin(post) * 54.3, (walkTop + 3.5) / 2 - 0.4, Math.cos(post) * 54.3], roofGrey, 5);
      }
      solid(-27, 5, 10, DECK + 9.5);
      solid(-8, -7, 11, DECK + 8.6);
      solid(16, 22, 8, DECK + 4.4);
      clearSite(-3, -14, 42, 46);
    } else if (landmark.kind === "police-plaza") {
      // Police Plaza Concord, Gulshan Avenue: a four-storey shopping podium
      // over the whole lakeside site, banded in chocolate brown with a cream
      // diamond-lattice frieze and a glass shopfront, carrying two cream slab
      // towers. Brown piers run up every bay and corner, green glass strips
      // fill the tower corners, and the top two floors are a glazed crown
      // band. The main slab (40 × 24 m, long side N–S) stands toward the
      // avenue; the narrower one is set back behind it on the west. The OSM
      // extrusion is the podium; the frame's +Z faces the avenue (east).
      const TOWER = 366560370;
      const podium = anchor(TOWER);
      const site = frame(TOWER, [1, 0]);
      if (podium && site) {
        const PODIUM = podium.height;
        slab(TOWER, 0.4, 4.2, 1.006, ribbonGlass);
        for (const [y, h] of [[4.6, 0.6], [9.4, 0.5], [15.6, 0.5]] as const) slab(TOWER, y, h, 1.01, landmarkBark);
        slab(TOWER, PODIUM - 0.5, 0.9, 1.016, landmarkBark);
        slab(TOWER, PODIUM + 0.4, 0.1, 0.97, roofGrey);
        // The diamond lattice frieze between the two upper bands.
        for (const edge of walls(TOWER)) {
          if (edge.length < 6) continue;
          const count = Math.floor(edge.length / 4.4);
          for (let index = 0; index < count; index++) {
            const along = (edge.length / count) * (index + 0.5);
            for (const tilt of [-0.72, 0.72]) {
              const bar = addBox(group, [0.24, 6.6, 0.16], [edge.ax + edge.dx * along + edge.nx * 0.3, 12.65, edge.az + edge.dz * along + edge.nz * 0.3], landmarkBark);
              bar.rotation.set(0, edge.rotationY, tilt);
            }
          }
        }
        const turn = site.g.rotation.y;
        const toGroup = (x: number, z: number): [number, number] => [
          site.g.position.x + x * Math.cos(turn) + z * Math.sin(turn),
          site.g.position.z - x * Math.sin(turn) + z * Math.cos(turn),
        ];
        const pane = rectPane(2.4, 1.8);
        const slabTower = (x0: number, x1: number, z0: number, z1: number, roof: number) => {
          const w = x1 - x0;
          const d = z1 - z0;
          const cx = (x0 + x1) / 2;
          const cz = (z0 + z1) / 2;
          const rise = roof - PODIUM;
          addBox(site.g, [w, rise, d], [cx, PODIUM + rise / 2, cz], cream);
          // Glazed crown band over the top two floors, then a cream parapet.
          addBox(site.g, [w + 0.3, 6.4, d + 0.3], [cx, roof - 3.6, cz], glass);
          addBox(site.g, [w + 0.7, 1.2, d + 0.7], [cx, roof + 0.2, cz], cream);
          addBox(site.g, [w - 0.6, 0.12, d - 0.6], [cx, roof + 0.86, cz], roofGrey);
          const faces = [
            { length: w, nx: 0, nz: 1, at: (u: number): [number, number] => [x0 + u, z1], turnY: 0 },
            { length: w, nx: 0, nz: -1, at: (u: number): [number, number] => [x1 - u, z0], turnY: Math.PI },
            { length: d, nx: 1, nz: 0, at: (u: number): [number, number] => [x1, z1 - u], turnY: Math.PI / 2 },
            { length: d, nx: -1, nz: 0, at: (u: number): [number, number] => [x0, z0 + u], turnY: -Math.PI / 2 },
          ];
          for (const face of faces) {
            const bays = Math.max(2, Math.round(face.length / 4));
            const bay = face.length / bays;
            // Brown piers at every bay line, full height, standing proud.
            for (let index = 0; index <= bays; index++) {
              const [px, pz] = face.at(index * bay);
              const corner = index === 0 || index === bays;
              const pier = addBox(site.g, [corner ? 1.3 : 0.8, rise + 0.8, corner ? 1.3 : 0.5], [px + face.nx * 0.2, PODIUM + (rise + 0.8) / 2, pz + face.nz * 0.2], landmarkBark);
              pier.rotation.y = face.turnY;
            }
            for (let index = 0; index < bays; index++) {
              const [bx, bz] = face.at((index + 0.5) * bay);
              // Green glass fills one corner bay of each face full height (so
              // every corner carries one glass strip); the rest are punched.
              if (index === bays - 1) {
                addBox(site.g, face.nx ? [0.2, rise - 7.2, bay - 1] : [bay - 1, rise - 7.2, 0.2], [bx + face.nx * 0.08, PODIUM + (rise - 7.2) / 2, bz + face.nz * 0.08], glass);
                continue;
              }
              for (let y = PODIUM + 1.2; y < roof - 8; y += 3.3) {
                const opening = new THREE.Mesh(pane, darkGlass);
                opening.position.set(bx + face.nx * 0.08, y, bz + face.nz * 0.08);
                opening.rotation.y = face.turnY;
                site.g.add(opening);
              }
            }
          }
          const [gx, gz] = toGroup(cx, cz);
          const c = Math.abs(Math.cos(turn));
          const s = Math.abs(Math.sin(turn));
          solidBox(gx, gz, c * w / 2 + s * d / 2, s * w / 2 + c * d / 2, roof + 0.8);
        };
        const MAIN_TOP = 72;
        slabTower(-24, 16, 2, 26, MAIN_TOP);
        slabTower(-10, 12, -20, 3, 70);
        // The lit sign frame and the plant house on the main roof.
        const deck = MAIN_TOP + 0.92;
        for (const x of [-7, 7]) addBox(site.g, [0.4, 5.4, 0.4], [x - 4, deck + 2.7, 8], silverPanel);
        for (const y of [1.6, 5.2]) addBox(site.g, [14.4, 0.3, 0.3], [-4, deck + y, 8], silverPanel);
        for (let index = 0; index < 4; index++) {
          const strut = addBox(site.g, [0.2, 4.6, 0.2], [-9.25 + index * 3.5, deck + 3.4, 8], silverPanel);
          strut.rotation.z = index % 2 ? 0.66 : -0.66;
        }
        addBox(site.g, [9, 3.4, 6], [-4, deck + 1.7, 18], plantGrey);
        colliderTop = PODIUM + 0.6;
        perchTarget = toGroup(12, 22);
      }
    } else if (landmark.kind === "brac") {
      // BRAC Centre, Mohakhali (21 floors, 81 m): board-marked grey fair-faced
      // concrete, not brick. Every floor is a deep projecting concrete ledge
      // over a recessed dark ribbon window, so the tower reads as strong
      // grey and black strata, held between plain concrete corner piers. A
      // dark glazed stair slot runs full height in the re-entrant corner of
      // the north entrance notch, where a coffered canopy on round pilotis
      // shelters the drop-off under rain trees and krishnachura.
      const TOWER = 229029081;
      const mass = anchor(TOWER);
      const ring = partOutlines.get(TOWER);
      if (mass && ring) {
        const H = mass.height;
        const FLOOR = 3.7;
        slab(TOWER, 0, 7.8, 1.012, boardConcrete);
        for (let y = 8.6; y < H - 2; y += FLOOR) slab(TOWER, y, 1.15, 1.065, boardConcrete);
        slab(TOWER, H - 0.6, 2, 1.075, boardConcrete);
        slab(TOWER, H + 1.4, 0.1, 0.93, roofGrey);
        addBox(group, [8, 3.2, 6], [mass.x - 3, H + 3, mass.z + 4], boardConcrete);
        addBox(group, [4, 2.2, 3], [mass.x + 6, H + 2.5, mass.z - 3], plantGrey);
        // Corner piers on the convex corners; the stair slot in the notch.
        const points = ring.map(([x, z]) => [x - group.position.x, z - group.position.z] as MapPoint);
        let area = 0;
        points.forEach(([ax, az], index) => {
          const [bx, bz] = points[(index + 1) % points.length];
          area += ax * bz - bx * az;
        });
        const edges = wallEdges(points);
        points.forEach(([px, pz], index) => {
          const [ax, az] = points[(index - 1 + points.length) % points.length];
          const [bx, bz] = points[(index + 1) % points.length];
          const cross = (px - ax) * (bz - pz) - (pz - az) * (bx - px);
          const outgoing = edges.find((edge) => Math.abs(edge.ax - px) < 0.01 && Math.abs(edge.az - pz) < 0.01) ?? edges[0];
          const incoming = edges.find((edge) => Math.abs(edge.ax - ax) < 0.01 && Math.abs(edge.az - az) < 0.01) ?? edges[0];
          if (cross * area > 0) {
            const pier = addBox(group, [2.6, H + 1.6, 2.6], [px, (H + 1.6) / 2, pz], boardConcrete);
            pier.rotation.y = outgoing.rotationY;
            return;
          }
          // Re-entrant corner: a dark glazed slot standing out past the
          // ledges, between two concrete fins along the notch walls.
          let nx = outgoing.nx + incoming.nx;
          let nz = outgoing.nz + incoming.nz;
          const length = Math.hypot(nx, nz) || 1;
          nx /= length;
          nz /= length;
          const slot = addBox(group, [3.6, H - 8.2, 0.6], [px + nx * 1.5, 8.2 + (H - 8.2) / 2, pz + nz * 1.5], darkGlass);
          slot.rotation.y = Math.atan2(nx, nz);
          for (const edge of [outgoing, incoming]) {
            const along = edge === outgoing ? 2.4 : edge.length - 2.4;
            const fin = addBox(group, [0.8, H - 8, 2.4], [edge.ax + edge.dx * along + edge.nx * 1.1, 8 + (H - 8) / 2, edge.az + edge.dz * along + edge.nz * 1.1], boardConcrete);
            fin.rotation.y = edge.rotationY;
          }
        });
        // The coffered drop-off canopy on round pilotis in the north notch.
        const canopyX = mass.x + 8.5;
        const canopyZ = mass.z - 15.5;
        addBox(group, [14, 1, 10.5], [canopyX, 7.4, canopyZ], boardConcrete);
        for (const offset of [-4.2, 0, 4.2]) addBox(group, [0.5, 0.9, 10.3], [canopyX + offset, 6.5, canopyZ], plantGrey);
        for (const [ox, oz] of [[-5.5, -4.6], [0, -4.6], [5.5, -4.6], [5.5, 2.5]] as const) {
          addCylinder(group, 0.45, 0.45, 6.9, [canopyX + ox, 3.45, canopyZ + oz], boardConcrete, 8);
        }
        for (const [tx, tz, radius, canopy] of [
          [-9, -30, 6.2, landmarkCanopy],
          [5, -32, 5.6, landmarkKrishnachura],
          [19, -27, 6, landmarkCanopy],
          [-22, -24, 5.2, landmarkKrishnachura],
        ] as const) {
          addLandmarkTree(group, mass.x + tx, mass.z + tz, radius, 7.5, canopy);
        }
        clearSite(mass.x, mass.z - 30, 28, 11);
        colliderTop = H + 1.6;
        perchTarget = [mass.x + 12, mass.z - 4];
      }
    } else if (landmark.kind === "hotel") {
      // Four Points by Sheraton (Doreen Tower), Gulshan 2: a slim white
      // panelled wedge with a ledge at every floor, a green glass sail that
      // sweeps up its curved NE face and widens toward the top, a glazed sky
      // lounge under a cantilevered, upswept prow canopy reaching toward
      // Gulshan Avenue, and a gold perforated screen on the podium's NE corner.
      const TOWER = 498432169;
      const mass = anchor(TOWER);
      const local = partOutline(TOWER);
      if (mass && local) {
        const ring = local.map(([x, z]) => [x + mass.x, z + mass.z] as MapPoint);
        const NE_X = Math.SQRT1_2;
        const NE_Z = -Math.SQRT1_2;
        const ROOF = mass.height;
        // Podium: grey glass all round, the gold screen on the NE corner.
        slab(TOWER, 0, 14, 1.03, ribbonGlass);
        slab(TOWER, 14, 0.6, 1.06, whiteStone);
        for (const edge of wallEdges(offsetPolygon(ring, 0.7))) {
          if (edge.nx * NE_X + edge.nz * NE_Z < 0.25) continue;
          addOnWall(group, edge, edge.length / 2, 1.2, rectPane(edge.length + 0.05, 12.4), accent, 0.02);
        }
        // A projecting white ledge at every floor.
        for (let y = 17.6; y < ROOF - 1; y += 3.6) slab(TOWER, y, 0.32, 1.05, whiteStone);
        // The glass sail: a band across the NE face, narrow over the podium
        // and opening out toward the top, standing proud of the ledges.
        const sailEdges = wallEdges(offsetPolygon(ring, 0.75)).filter((edge) => edge.nx * NE_X + edge.nz * NE_Z > 0.45);
        const sailLength = sailEdges.reduce((sum, edge) => sum + edge.length, 0);
        const sailQuads: Array<[QuadPoint, QuadPoint, QuadPoint, QuadPoint, QuadPoint]> = [];
        for (let y = 14.6; y < ROOF; y += 3.6) {
          const top = Math.min(ROOF, y + 3.6);
          // One edge runs straight up by the E corner; the other swings out
          // toward the N corner in a concave curve as the sail climbs.
          const rise = clamp((y - 14) / 70, 0, 1);
          const to = sailLength - 1.6;
          const from = Math.max(1.4, to - (3.2 + (sailLength - 6.5) * Math.sqrt(rise)));
          let start = 0;
          for (const edge of sailEdges) {
            const a = Math.max(from, start) - start;
            const b = Math.min(to, start + edge.length) - start;
            if (b > a + 0.05) {
              const p0: [number, number] = [edge.ax + edge.dx * a, edge.az + edge.dz * a];
              const p1: [number, number] = [edge.ax + edge.dx * b, edge.az + edge.dz * b];
              sailQuads.push([[p0[0], y, p0[1]], [p1[0], y, p1[1]], [p1[0], top, p1[1]], [p0[0], top, p0[1]], [edge.nx, 0, edge.nz]]);
            }
            start += edge.length;
          }
        }
        addQuads(group, sailQuads, glass);
        // The narrow glass strip up the N corner, and the column of punched
        // windows on the plain SW face.
        for (const edge of wallEdges(ring)) {
          const facing = edge.nx * NE_X + edge.nz * NE_Z;
          if (edge.nz < -0.8 && facing < 0.6) {
            addOnWall(group, edge, edge.length * 0.78, 15, rectPane(4, ROOF - 16), glass, 0.75);
          } else if (edge.length > 18 && facing < -0.6) {
            for (let y = 16.2; y < ROOF - 3; y += 3.6) {
              for (const along of [0.42, 0.58]) addOnWall(group, edge, edge.length * along, y, rectPane(1.4, 1.9), ribbonGlass, 0.36);
            }
          }
        }
        // Sky lounge, then the cantilevered prow canopy sweeping up to the NE.
        slab(TOWER, ROOF, 4.2, 0.96, atriumGlass);
        let plate = offsetPolygon(ring, 1.2);
        plate = plate.map(([x, z]) => {
          const reach = (x - mass.x) * NE_X + (z - mass.z) * NE_Z;
          const push = reach > 0 ? 5 * Math.min(1, reach / 10) : 0;
          return [x + NE_X * push, z + NE_Z * push] as MapPoint;
        });
        const plateGeometry = new THREE.ExtrudeGeometry(polygonShape(plate), { depth: 1.1, bevelEnabled: false, curveSegments: 1 });
        plateGeometry.rotateX(-Math.PI / 2);
        const platePositions = plateGeometry.getAttribute("position");
        let prowReach = -Infinity;
        for (let index = 0; index < platePositions.count; index++) {
          const reach = (platePositions.getX(index) - mass.x) * NE_X + (platePositions.getZ(index) - mass.z) * NE_Z;
          prowReach = Math.max(prowReach, reach);
          platePositions.setY(index, platePositions.getY(index) + (Math.max(0, reach) / 10) ** 2 * 1.6);
        }
        plateGeometry.computeVertexNormals();
        const canopy = new THREE.Mesh(plateGeometry, glass);
        canopy.position.y = ROOF + 4.2;
        canopy.castShadow = true;
        canopy.receiveShadow = true;
        group.add(canopy);
        const prowX = mass.x + NE_X * (prowReach - 2.5);
        const prowZ = mass.z + NE_Z * (prowReach - 2.5);
        solid(prowX, prowZ, 3, ROOF + 7.5);
        perchTarget = [prowX, prowZ];
        colliderTop = ROOF + 5.3;
      }
    } else if (landmark.kind === "parliament") {
      // Kahn's citadel is three concentric rings the OSM outlines already carry:
      // a 34 m ring of office blocks, a 42 m star of light wells, and the 46 m
      // octagonal assembly chamber. What makes it read from the air is the
      // finish: marble pour lines on grey concrete, giant geometric openings in
      // the outer walls, grey roof terraces, and the two plazas it stands
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
      // From the air the roofscape is grey board-marked concrete inside white
      // marble parapet bands; only the South Plaza is red brick.
      slab(CITADEL, 34, 1.2, 1.004, marble);
      slab(CITADEL, 35.2, 0.08, 0.962, boardConcrete);
      slab(STAR, 42, 1.0, 1.004, marble);
      slab(STAR, 43, 0.08, 0.95, boardConcrete);
      slab(CHAMBER, 46, 1.0, 1.004, marble);
      slab(CHAMBER, 47, 0.08, 0.94, boardConcrete);

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
        // There is no dome: the chamber roof is a white umbrella disc that
        // barely breaks the parapet line (top ≈ 1 m above it).
        addCylinder(group, radius * 0.62, radius * 0.64, 0.9, [chamber.x, 47.55, chamber.z], marble, 16);
        for (let slotIndex = 0; slotIndex < 8; slotIndex++) {
          const angle = (slotIndex / 8) * Math.PI * 2 + Math.PI / 8;
          const court = addBox(group, [5.4, 0.3, 2.6], [chamber.x + Math.cos(angle) * radius * 0.8, 47.1, chamber.z + Math.sin(angle) * radius * 0.8], recess);
          court.rotation.y = -angle + Math.PI / 2;
        }
      }

      if (citadel) {
        const southEdge = citadel.z + citadel.depth / 2;
        const northEdge = citadel.z - citadel.depth / 2;
        const cx = citadel.x;
        // South Plaza: a bright red-brick deck ≈ 170 × 120 m, 20 m south of the
        // building across the moat. The north 40 % is a raised upper deck with a
        // white grid and rows of skylight boxes; the south 60 % is a lower deck
        // of three big flat red planes, with darker ramps down both sides.
        const plazaNorth = southEdge + 20;
        const UPPER = 48;
        const LOWER = 72;
        const upperZ = plazaNorth + UPPER / 2;
        const lowerZ = plazaNorth + UPPER + LOWER / 2;
        addBox(group, [170, 2.6, UPPER], [cx, 1.3, upperZ], plazaRed);
        addBox(group, [146, 1.3, LOWER], [cx, 0.65, lowerZ], plazaRed);
        for (const side of [-1, 1]) {
          // Side ramps falling from the upper deck to the street.
          const ramp = addBox(group, [12, 0.8, Math.hypot(LOWER, 2.2)], [cx + side * 79, 1.1, lowerZ], plazaBrick);
          ramp.rotation.x = Math.atan2(2.2, LOWER);
          addBox(group, [1, 1.6, LOWER + UPPER], [cx + side * 85.5, 0.8, plazaNorth + (UPPER + LOWER) / 2], plazaBrick);
        }
        // Upper deck grid and skylights; lower deck split into three planes.
        for (const offset of [-56, 0, 56]) addBox(group, [0.7, 0.1, UPPER - 2], [cx + offset, 2.65, upperZ], marble);
        addBox(group, [168, 0.1, 0.7], [cx, 2.65, upperZ], marble);
        for (const offset of [-24, 24]) addBox(group, [0.7, 0.1, LOWER - 2], [cx + offset, 1.35, lowerZ], marble);
        for (let row = 0; row < 2; row++) {
          for (let column = 0; column < 9; column++) {
            addBox(group, [2.6, 1.4, 2.6], [cx - 72 + column * 18, 3.3, plazaNorth + 12 + row * 24], marble);
          }
        }
        // A single narrow brick causeway across the moat to the south towers.
        addBox(group, [8, 2.4, 26], [cx, 1.2, southEdge + 7], plazaBrick);
        // Tree lines along the avenues that flank the plaza.
        for (const side of [-1, 1]) {
          for (let index = 0; index < 8; index++) addLandmarkTree(group, cx + side * 102, plazaNorth + 6 + index * 16, 4.4, 5.6, landmarkCanopy);
        }
        // Presidential Plaza to the north: white marble round a red-brick centre.
        addBox(group, [96, 1.2, 70], [cx, 0.6, northEdge - 36], marble);
        addBox(group, [52, 0.2, 40], [cx, 1.3, northEdge - 38], plazaRed);
        // Keep both plazas free of generic blocks and park trees; the lawns
        // round them are DHAKA_PARKS ellipses, the moat is map water.
        clearSite(cx, plazaNorth + (UPPER + LOWER) / 2, 92, (UPPER + LOWER) / 2 + 6);
        clearSite(cx, northEdge - 36, 52, 40);
      }
    } else if (landmark.kind === "lalbagh-fort") {
      // An unfinished Mughal fort: a walled garden holding the Diwan-i-Aam, the
      // tomb of Pari Bibi and the three-domed mosque on one east-west axis,
      // laid out on a grid of brick paths with a big square tank to the east.
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
      // The garden from the air: a grid of red-brick paths over the lawn,
      // paved squares round the tomb and the hall, a square fountain tank
      // between them, and round half-bastions every ~65 m along the south wall.
      // Laid out in the grounds' own frame (+Z south) from the satellite plan.
      const garden = frame(GROUNDS, [0, 1]);
      if (garden) {
        const { g, hz } = garden;
        for (const x of [-141, -78, -18, 35, 84]) addBox(g, [4.5, 0.2, 192], [x, 0.6, -4], brick);
        for (const z of [-92, -42, 37]) addBox(g, [258, 0.2, 4.5], [-45, 0.62, z], brick);
        addBox(g, [258, 0.2, 6], [-45, 0.62, 4], brick);
        addBox(g, [10, 0.3, 10], [-18, 0.75, 4], whiteStone);
        addBox(g, [7.4, 0.3, 7.4], [-18, 0.8, 4], water);
        // Clipped hedges along the cross paths that miss the monuments.
        for (const z of [-92, -42, 37]) {
          for (const side of [-1, 1]) addBox(g, [252, 0.9, 0.8], [-45, 0.95, z + side * 3.2], landmarkCanopy);
        }
        for (const x of [-163, -98, -26, 40, 113]) {
          addCylinder(g, 4, 4.4, 7, [x, 3.5, hz - 0.2], redBrick, 10);
          addCylinder(g, 4.5, 4.5, 0.5, [x, 7.2, hz - 0.2], brickTrim, 10);
        }
      }
      const tomb = anchor(TOMB);
      if (tomb) {
        // Pari Bibi's tomb: salmon-pink plaster, a tall white pointed-arch
        // iwan in the middle of every face between two small white-framed
        // doors, octagonal corner towers with ribbed melon domes, and a dark
        // green-black copper dome on an octagonal drum (peak ≈ 21 m).
        const H = tomb.height;
        const iwan = pointedArch(5, 8.2);
        const iwanDoor = roundArch(2.2, 3.4);
        const sideFrame = pointedArch(2.4, 4.2);
        const sideDoor = roundArch(1.3, 2.3);
        for (const edge of walls(TOMB)) {
          if (edge.length < 12) continue;
          const middle = edge.length / 2;
          addOnWall(group, edge, middle, 1.6, iwan, whiteStone, 0.14);
          addOnWall(group, edge, middle, 1.6, iwanDoor, archDark, 0.26);
          for (const offset of [-1, 1]) {
            const along = middle + offset * (edge.length / 2 - 5);
            addOnWall(group, edge, along, 1.6, sideFrame, whiteStone, 0.14);
            addOnWall(group, edge, along, 1.6, sideDoor, archDark, 0.26);
          }
        }
        slab(TOMB, 0, 1.6, 1.07, salmon);
        slab(TOMB, H - 0.6, 1, 1.03, peach);
        slab(TOMB, H + 0.4, 1, 1.004, salmon);
        const half = Math.min(tomb.width, tomb.depth) / 2;
        addCylinder(group, 4.6, 4.8, 2.6, [tomb.x, H + 2.7, tomb.z], salmon, 8).rotation.y = Math.PI / 8;
        addCylinder(group, 4.9, 4.9, 0.4, [tomb.x, H + 4.2, tomb.z], peach, 8).rotation.y = Math.PI / 8;
        addLathe(group, domeProfile(4.1, 4.3, 0.12, 10), 16, [tomb.x, H + 4.4, tomb.z], copperDark);
        addFinial(group, [tomb.x, H + 4.4 + 4.2, tomb.z], 0.6, whiteStone);
        for (const sideX of [-1, 1]) {
          for (const sideZ of [-1, 1]) {
            const tx = tomb.x + sideX * (tomb.width / 2 - 0.5);
            const tz = tomb.z + sideZ * (tomb.depth / 2 - 0.5);
            addCylinder(group, 1.5, 1.6, H + 4, [tx, (H + 4) / 2, tz], salmon, 8);
            addCylinder(group, 1.9, 1.9, 0.4, [tx, H + 4.2, tz], peach, 8);
            addLathe(group, domeProfile(1.6, 2.3, 0.22, 8), 12, [tx, H + 4.4, tz], peach, true);
            addFinial(group, [tx, H + 6.6, tz], 0.4, whiteStone);
          }
          // Small domed kiosks inboard of the corner towers on the long faces.
          for (const sideZ of [-1, 1]) {
            const kx = tomb.x + sideX * (tomb.width / 2 - 4.6);
            const kz = tomb.z + sideZ * (tomb.depth / 2 - 1.2);
            addCylinder(group, 0.9, 1, 1.4, [kx, H + 1.4 + 0.7, kz], salmon, 8);
            addLathe(group, domeProfile(1, 1.4, 0.2, 6), 8, [kx, H + 2.8, kz], peach, true);
          }
        }
        // Tiled reflecting pool on the axis east of the tomb, with a row of
        // lotus-bud fountain heads down its middle.
        const poolX = tomb.x + half + 15;
        addBox(group, [22, 0.36, 6], [poolX, 0.8, tomb.z], whiteStone);
        addBox(group, [21, 0.36, 5], [poolX, 0.86, tomb.z], water);
        for (let jet = 0; jet < 5; jet++) addLathe(group, domeProfile(0.35, 0.7, 0.1, 4), 6, [poolX - 8 + jet * 4, 1.04, tomb.z], salmon);
        // Paved square round the tomb.
        addBox(group, [42, 0.2, 38], [tomb.x, 0.66, tomb.z], brick);
        solid(tomb.x, tomb.z, 4.6, H + 8);
        // The perch is the tomb's dome, not the open lawn at the grounds' centre.
        perchTarget = [tomb.x, tomb.z];
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
        slab(HALL, audience.height + 1.3, 0.08, 0.92, brick);
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
      // Paved square round the Diwan-i-Aam, and the whole walled garden kept
      // free of generic blocks.
      if (audience) addBox(group, [audience.width + 10, 0.2, audience.depth + 12], [audience.x, 0.66, audience.z], brick);
      const fortGrounds = anchor(GROUNDS);
      if (fortGrounds) clearSite(fortGrounds.x, fortGrounds.z, fortGrounds.width / 2, fortGrounds.depth / 2);
    } else if (landmark.kind === "ahsan-manzil") {
      // Ahsan Manzil, the Pink Palace: two arcaded storeys on a 1 m plinth,
      // corner pavilions rising above a balustraded roof, the grand stair from
      // the river lawn to the first floor, and the domed tower over the
      // entrance bay (finial at 27.1 m). Faces south to the Buriganga.
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
          surround: pinkTrim,
          pier: { width: 0.7, depth: 0.5, bottom: 0, top: height, material: pinkTrim },
        });
        slab(osmId, 0, 1.1, 1.014, pinkTrim);
        slab(osmId, height * 0.5, 0.55, 1.014, pinkTrim);
        slab(osmId, height - 0.5, 0.7, 1.024, pinkTrim);
        slab(osmId, height, 1.2, 1.004, pink);
        slab(osmId, height + 1.2, 0.22, 1.016, pinkTrim);
        slab(osmId, height + 1.42, 0.18, 0.95, roofTerrace);
      };
      const palace = anchor(PALACE);
      if (palace) {
        const H = palace.height;
        dress(PALACE, H, [
          { y: 1.7, opening: archLow, surround: archLowTrim },
          { y: H * 0.5 + 1.1, opening: archHigh, surround: archHighTrim },
        ]);
        const body = frame(PALACE, [0, 1]);
        if (body) {
          const { g, hx, hz } = body;
          // Corner pavilions: an attic above the roof line with a raised,
          // shaped centre on each outer face and a bud finial at every corner.
          for (const sideX of [-1, 1]) {
            for (const sideZ of [-1, 1]) {
              const px = sideX * (hx - 4.2);
              const pz = sideZ * (hz - 4.4);
              addBox(g, [8.6, 2.4, 8.6], [px, H + 2.4, pz], pink);
              addBox(g, [9.2, 0.4, 9.2], [px, H + 3.8, pz], pinkTrim);
              addBox(g, [8.2, 0.08, 8.2], [px, H + 4.04, pz], roofTerrace);
              addBox(g, [0.6, 1.5, 3.6], [px + sideX * 4.3, H + 4.75, pz], pinkTrim);
              addBox(g, [3.6, 1.5, 0.6], [px, H + 4.75, pz + sideZ * 4.3], pinkTrim);
              addLathe(g, domeProfile(0.55, 0.9, 0.2, 5), 6, [px + sideX * 4.3, H + 5.5, pz], pink);
              addLathe(g, domeProfile(0.55, 0.9, 0.2, 5), 6, [px, H + 5.5, pz + sideZ * 4.3], pink);
              for (const cx of [-1, 1]) {
                for (const cz of [-1, 1]) {
                  addCylinder(g, 0.5, 0.6, 2.2, [px + cx * 4, H + 5.1, pz + cz * 4], pink, 8);
                  addLathe(g, domeProfile(0.75, 1.3, 0.2, 6), 8, [px + cx * 4, H + 6.2, pz + cz * 4], pinkTrim);
                }
              }
            }
          }
          // Central tower over the entrance: a square base with corner
          // pinnacles, an arcaded round drum with paired columns, a balustrade,
          // then the tall ribbed "lotus-bud" dome.
          const tz = hz - 9;
          const towerBase = H + 1.2;
          addBox(g, [12, 1.2, 12], [0, towerBase + 0.6, tz], pink);
          addBox(g, [12.8, 0.4, 12.8], [0, towerBase + 1.4, tz], pinkTrim);
          const drumBase = towerBase + 1.6;
          addCylinder(g, 4.8, 4.8, 3.6, [0, drumBase + 1.8, tz], pink, 16);
          const drumArch = roundArch(1.5, 2.9);
          for (let bay = 0; bay < 8; bay++) {
            const angle = ((bay + 0.5) / 8) * Math.PI * 2;
            const pane = new THREE.Mesh(drumArch, archDark);
            pane.position.set(Math.sin(angle) * 4.86, drumBase + 0.35, tz + Math.cos(angle) * 4.86);
            pane.rotation.y = angle;
            g.add(pane);
            for (const pair of [-0.11, 0.11]) {
              const columnAngle = (bay / 8) * Math.PI * 2 + pair;
              addCylinder(g, 0.22, 0.24, 3.6, [Math.sin(columnAngle) * 5.2, drumBase + 1.8, tz + Math.cos(columnAngle) * 5.2], pinkTrim, 6);
            }
          }
          addCylinder(g, 5.7, 5.7, 0.5, [0, drumBase + 3.85, tz], pinkTrim, 16);
          addCylinder(g, 5.3, 5.3, 0.6, [0, drumBase + 4.4, tz], pink, 16);
          const domeBase = drumBase + 4.7;
          const domeShape = domeProfile(5.1, 5, 0.08, 12);
          addLathe(g, domeShape, 16, [0, domeBase, tz], pink);
          const ribProfile = domeShape.map(([radius, y]) => new THREE.Vector2(radius * 1.03 + 0.02, y * 1.01));
          for (let rib = 0; rib < 8; rib++) {
            const ribMesh = new THREE.Mesh(new THREE.LatheGeometry(ribProfile, 1, (rib / 8) * Math.PI * 2, 0.09), pinkTrim);
            ribMesh.position.set(0, domeBase, tz);
            g.add(ribMesh);
          }
          addFinial(g, [0, domeBase + 4.9, tz], 0.33);
          for (const cx of [-1, 1]) {
            for (const cz of [-1, 1]) {
              addCylinder(g, 0.4, 0.5, 3.2, [cx * 5.6, drumBase + 1.6, tz + cz * 5.6], pinkTrim, 6);
              addLathe(g, domeProfile(0.6, 1, 0.2, 5), 6, [cx * 5.6, drumBase + 3.2, tz + cz * 5.6], pink);
            }
          }
          g.updateMatrix();
          const towerSeat = new THREE.Vector3(0, 0, tz).applyMatrix4(g.matrix);
          solid(towerSeat.x, towerSeat.z, 5.5, domeBase + 3.2);
          perchTarget = [towerSeat.x, towerSeat.z];

          // Projecting entrance bay with a triple arch at the head of the
          // stair and a shaped pediment above the roof line.
          addBox(g, [13, H + 1.2, 3.2], [0, (H + 1.2) / 2, hz + 1.6], pink);
          addBox(g, [13.8, 0.6, 3.8], [0, H * 0.5 + 0.2, hz + 1.7], pinkTrim);
          addBox(g, [13.8, 0.7, 3.8], [0, H - 0.2, hz + 1.7], pinkTrim);
          addBox(g, [13.6, 0.24, 3.6], [0, H + 1.3, hz + 1.7], pinkTrim);
          addBox(g, [5, 1.8, 0.8], [0, H + 2.3, hz + 2.8], pinkTrim);
          addLathe(g, domeProfile(0.6, 1, 0.2, 5), 6, [0, H + 3.2, hz + 2.8], pink);
          const doorArch = roundArch(2.6, 5);
          const doorArchTrim = roundArch(3.4, 5.6);
          for (const offset of [-4.1, 0, 4.1]) {
            for (const [geometry, material, proud, lift] of [[doorArchTrim, pinkTrim, 3.34, -0.2], [doorArch, archDark, 3.46, 0]] as const) {
              const pane = new THREE.Mesh(geometry, material);
              pane.position.set(offset, H * 0.5 + 0.9 + lift, hz + proud);
              g.add(pane);
            }
          }
          for (const offset of [-6.2, -2.05, 2.05, 6.2]) addBox(g, [0.8, H + 1.2, 0.5], [offset, (H + 1.2) / 2, hz + 3.35], pinkTrim);
          // The grand stair: one broad flight of 26 steps from the lawn to the
          // first-floor portico, 13 m wide at the top flaring to 18 m, between
          // black iron balustrades with a gilded top rail.
          const landing = H * 0.5;
          const STEPS = 26;
          const run = 19;
          const stairStart = hz + 3.2;
          for (let step = 0; step < STEPS; step++) {
            const stepHeight = landing * (1 - step / STEPS);
            addBox(g, [13 + step * 0.19, stepHeight, run / STEPS + 0.04], [0, stepHeight / 2, stairStart + (step + 0.5) * (run / STEPS)], stoneStep);
          }
          const railLength = Math.hypot(run, landing, 2.4);
          for (const side of [-1, 1]) {
            const rail = new THREE.Group();
            rail.position.set(side * 7.75, landing / 2 + 0.55, stairStart + run / 2);
            rail.rotation.set(Math.atan2(landing, Math.hypot(run, 2.4)), side * Math.atan2(2.4, run), 0, "YXZ");
            g.add(rail);
            addBox(rail, [0.16, 1, railLength], [0, 0, 0], recess);
            addBox(rail, [0.24, 0.14, railLength], [0, 0.56, 0], accent);
            addBox(g, [1.2, 1.8, 1.2], [side * 9, 0.9, stairStart + run + 0.3], pinkTrim);
          }
          // Brick walks: the axis down to the river gate and a cross walk.
          addBox(g, [7, 0.18, 46], [0, 0.64, stairStart + run + 23], brick);
          addBox(g, [58, 0.18, 4], [0, 0.68, stairStart + run + 3], brick);
          // Coconut and palmyra palms on the river lawn and by the stair foot.
          for (const [px, pz, height, lean] of [
            [-11, hz + 9, 11, 0.12], [11.5, hz + 8, 10, -0.1], [-15, stairStart + run + 9, 12, 0.08],
            [15, stairStart + run + 10, 10.5, 0.1], [-24, stairStart + run + 4, 9.5, 0.14], [25, stairStart + run + 5, 11.5, 0.06],
            [-10, stairStart + run + 24, 12.5, 0.1], [10, stairStart + run + 30, 10, 0.12], [-27, stairStart + run + 22, 11, 0.1],
          ] as const) {
            addPalm(g, px, pz, height, lean, px * 0.3);
          }
          // Keep the river lawn in front of the stair free of generic blocks;
          // Old Dhaka is left to press in on the other three sides.
          g.updateMatrix();
          const lawnSeat = new THREE.Vector3(0, 0, hz + 40).applyMatrix4(g.matrix);
          clearSite(lawnSeat.x, lawnSeat.z, 34, 38);
        }
      }
      const andarmahal = anchor(ANDARMAHAL);
      if (andarmahal) {
        dress(ANDARMAHAL, andarmahal.height, [
          { y: 1.5, opening: roundArch(2, 2.9), surround: roundArch(2.6, 3.4) },
          { y: andarmahal.height * 0.5 + 1.1, opening: roundArch(2, 3.4), surround: roundArch(2.6, 3.9) },
        ]);
      }
      for (const osmId of [624025788, 624025789, 624025784]) {
        const wing = anchor(osmId);
        if (!wing) continue;
        slab(osmId, wing.height, 0.6, 1.02, pinkTrim);
        slab(osmId, wing.height + 0.6, 0.08, 0.93, roofTerrace);
      }
    } else if (landmark.kind === "shaheed-minar") {
      // Central Shaheed Minar: a bowed "mother" frame and four "son" frames in
      // white, filled with fine black rods, before a red sun disc, on a maroon
      // dais at the south apex of a maroon plaza that fans out northward with
      // white radial lines and alpana circles. Local +Z is north (the front),
      // +X is west. The monument is drawn 1.3× true size so it reads from the air.
      const S = 1.3;
      const TERRACE = 2.1; // stepped terrace top: the plaza (0.5) plus 1.6 m
      // Raised terrace behind the steps, and the full-width stepped front with
      // white nosings, centre ramp and white end walls.
      const TERRACE_FRONT = 13;
      // Full width in front of the dais, narrowing behind it at the plaza's apex.
      addBox(group, [40, TERRACE, 9], [-2, TERRACE / 2, TERRACE_FRONT - 4.5], deepBrick);
      addBox(group, [31, TERRACE, 14], [0, TERRACE / 2, TERRACE_FRONT - 16], deepBrick);
      for (let step = 0; step < 6; step++) {
        const top = TERRACE - 0.27 * (step + 1);
        const z = TERRACE_FRONT + 0.45 + step * 0.9;
        addBox(group, [48, top, 0.9], [-2, top / 2, z], deepBrick);
        addBox(group, [48, 0.04, 0.22], [-2, top + 0.02, z + 0.34], whiteStone);
      }
      const ramp = addBox(group, [3.2, 0.5, Math.hypot(5.4, TERRACE - 0.5)], [0, (TERRACE + 0.5) / 2 + 0.06, TERRACE_FRONT + 2.7], marble);
      ramp.rotation.x = Math.atan2(TERRACE - 0.5, 5.4);
      for (const side of [-1, 1]) addBox(group, [0.8, TERRACE + 0.9, 6.6], [-2 + side * 24.4, (TERRACE + 0.9) / 2, TERRACE_FRONT + 2.6], whiteStone);
      // Plaza graphics: white radial lines fanning north and alpana circles.
      for (let line = -3; line <= 3; line++) {
        const angle = line * 0.17;
        const start = 19 / Math.cos(angle);
        const end = 50 / Math.cos(angle);
        const stripe = addBox(group, [0.45, 0.04, end - start], [Math.sin(angle) * (start + end) / 2, 0.52, Math.cos(angle) * (start + end) / 2], marble);
        stripe.rotation.y = angle;
      }
      const alpanaOuter = new THREE.RingGeometry(2.7, 3.4, 24);
      const alpanaInner = new THREE.RingGeometry(0.9, 1.7, 16);
      alpanaOuter.rotateX(-Math.PI / 2);
      alpanaInner.rotateX(-Math.PI / 2);
      for (const [ax, az] of [[0, 27], [-13, 31], [13, 31], [-9, 44], [9, 44], [-23, 46]] as const) {
        for (const ring of [alpanaOuter, alpanaInner]) {
          const mesh = new THREE.Mesh(ring, marble);
          mesh.position.set(ax, 0.56, az);
          group.add(mesh);
        }
      }
      // The monument itself, at true size inside a scaled holder.
      const monument = new THREE.Group();
      monument.position.set(0, TERRACE, 0);
      monument.scale.setScalar(S);
      group.add(monument);
      addBox(monument, [23, 0.5, 16], [0, 0.25, 1], deepBrick);
      const BASE = 0.5;
      const rods = (parent: THREE.Object3D, fromX: number, toX: number, count: number, bottom: number, length: number) => {
        for (let rod = 0; rod < count; rod++) {
          const x = fromX + ((toX - fromX) * (rod + 0.5)) / count;
          addBox(parent, [0.1, length, 0.1], [x, bottom + length / 2, 0], recess);
        }
      };
      // Mother: three posts and two bays rise 10 m, then the top 4.2 m bows
      // forward 30° to a cross-beam.
      const LEAN = 0.52;
      const BENT = 4.2;
      const STRAIGHT = 10;
      const MOTHER_Z = 3;
      const mother = new THREE.Group();
      mother.position.set(0, BASE, MOTHER_Z);
      monument.add(mother);
      const bowed = new THREE.Group();
      bowed.position.set(0, STRAIGHT, 0);
      bowed.rotation.x = LEAN;
      mother.add(bowed);
      for (const x of [-3.25, 0, 3.25]) {
        addBox(mother, [0.7, STRAIGHT + 0.2, 0.7], [x, (STRAIGHT + 0.2) / 2, 0], marble);
        addBox(bowed, [0.7, BENT, 0.7], [x, BENT / 2, 0], marble);
      }
      addBox(bowed, [7.9, 0.7, 0.7], [0, BENT - 0.35, 0], marble);
      addBox(mother, [7.9, 0.3, 0.9], [0, 0.15, 0], marble);
      for (const [fromX, toX] of [[-2.9, -0.35], [0.35, 2.9]] as const) {
        rods(mother, fromX, toX, 5, 0.3, STRAIGHT - 0.2);
        rods(bowed, fromX, toX, 5, 0, BENT - 0.7);
      }
      // Sons: single-bay frames in a shallow arc either side, turned inward.
      const son = (x: number, z: number, height: number, turn: number) => {
        const holder = new THREE.Group();
        holder.position.set(x, BASE, z);
        holder.rotation.y = turn;
        monument.add(holder);
        for (const side of [-1, 1]) addBox(holder, [0.65, height, 0.65], [side * 0.975, height / 2, 0], marble);
        addBox(holder, [2.6, 0.65, 0.65], [0, height - 0.325, 0], marble);
        addBox(holder, [2.6, 0.3, 0.85], [0, 0.15, 0], marble);
        rods(holder, -0.65, 0.65, 4, 0.3, height - 0.95);
      };
      for (const side of [-1, 1]) {
        son(side * 6, 2, 8.8, -side * 0.26);
        son(side * 9.5, 0.5, 6.8, -side * 0.44);
      }
      // The red sun, standing behind the mother frame and showing above it.
      const sun = addCylinder(monument, 4.25, 4.25, 0.5, [0, BASE + 9, -4], monumentRed, 32);
      sun.rotation.x = Math.PI / 2;
      // Two slim dark stays hold the disc up from behind.
      for (const side of [-1, 1]) addBox(monument, [0.25, 9, 0.25], [side * 1.6, BASE + 4.5, -4.45], recess);
      // Collision: the terrace, then a column for each frame.
      colliderTop = TERRACE + 0.9;
      const motherTop = TERRACE + S * (BASE + STRAIGHT + Math.cos(LEAN) * BENT);
      const motherReach = S * (MOTHER_Z + Math.sin(LEAN) * BENT);
      solid(0, S * MOTHER_Z, S * 4, motherTop - 0.6);
      solid(0, -S * 4, S * 4.3, TERRACE + S * (BASE + 13.25));
      for (const side of [-1, 1]) {
        solid(side * S * 6, S * 2, S * 1.6, TERRACE + S * (BASE + 8.8));
        solid(side * S * 9.5, S * 0.5, S * 1.6, TERRACE + S * (BASE + 6.8));
      }
      // Perch on the bowed cross-beam, where it is seen against the sky.
      perchTarget = [0, motherReach - S * 0.2];
      // Big rain trees on the unpaved ground along the plaza's east side, a
      // few on the west.
      for (const [tx, tz, radius] of [[-42, 8, 8], [-35, 27, 7.5], [-48, 36, 8.5], [-44, 56, 8], [40, 22, 7.5], [38, 46, 8], [18, 66, 7]] as const) {
        addLandmarkTree(group, tx, tz, radius, 7.5, landmarkCanopy);
      }
      // OSM plaza 941979151 runs ≈ 15 m south of the monument to ≈ 56 m north,
      // ≈ 37 m east to 31 m west: keep generic blocks off all of it.
      clearSite(-3, 20, 38, 38);
    } else if (landmark.kind === "curzon-hall") {
      // Curzon Hall (1904): a two-storey deep red brick hall with cusped
      // two-tier arcades and white balustrades on every wing, a parapet of
      // small domed finials, and on the north front the tall entrance tower
      // with its corbelled cornice, a big white-latticed Mughal arch window
      // and chhatris on top, flanked by octagonal turrets under open
      // terracotta-domed kiosks at the corners of the centre bay and the end
      // pavilions. Footprint mode: world axes, the front faces north (-z).
      const HALL = 264272612;
      const mass = anchor(HALL);
      const points = partOutlines.get(HALL);
      if (mass && points) {
        const H = mass.height;
        const local = points.map(([x, z]) => [x - group.position.x, z - group.position.z] as MapPoint);
        addBays(group, walls(HALL), {
          bay: 4.3, minEdge: 4,
          storeys: [
            { y: 1.0, opening: pointedArch(2.5, 4.4) },
            { y: 7.1, opening: pointedArch(2.5, 4.2) },
          ],
          opening: archDark,
          pier: { width: 0.75, depth: 0.5, bottom: 0, top: H, material: deepBrick },
        });
        // White balustrades at the foot of each arcade tier, and the parapet.
        slab(HALL, 0.9, 0.5, 1.02, whiteStone);
        slab(HALL, 6.3, 0.75, 1.022, whiteStone);
        slab(HALL, H - 0.5, 0.5, 1.026, deepBrick);
        slab(HALL, H, 1.0, 1.012, whiteStone);
        slab(HALL, H + 1.0, 0.08, 0.955, roofTerrace);
        // Small domed finials along the parapet, about every 4 m.
        for (const edge of walls(HALL)) {
          const count = Math.floor(edge.length / 4);
          for (let index = 0; index <= count; index++) {
            const along = count > 0 ? (edge.length * index) / count : edge.length / 2;
            addCone(group, 0.42, 1.3, [edge.ax + edge.dx * along + edge.nx * 0.3, H + 1.65, edge.az + edge.dz * along + edge.nz * 0.3], terracotta, 5);
          }
        }
        // The entrance tower on the north tip of the centre bay.
        const tip = local.reduce((a, b) => (b[1] < a[1] ? b : a));
        const neighbours = local.filter(([, z]) => z < tip[1] + 0.6);
        const towerX = neighbours.reduce((sum, [x]) => sum + x, 0) / neighbours.length;
        const TOWER = 9;
        const towerZ = tip[1] + TOWER / 2;
        const front = tip[1] - 0.06;
        const TOP = 24;
        addBox(group, [TOWER, TOP, TOWER], [towerX, TOP / 2, towerZ], redBrick);
        addBox(group, [TOWER + 0.6, 0.5, TOWER + 0.6], [towerX, 6.6, towerZ], whiteStone);
        addBox(group, [TOWER + 0.5, 0.6, TOWER + 0.5], [towerX, 16, towerZ], whiteStone);
        addBox(group, [TOWER + 1.6, 1.3, TOWER + 1.6], [towerX, TOP - 1.1, towerZ], deepBrick);
        addBox(group, [TOWER + 1.2, 1.0, TOWER + 1.2], [towerX, TOP + 0.5, towerZ], whiteStone);
        addBox(group, [TOWER + 0.8, 0.08, TOWER + 0.8], [towerX, TOP + 1.04, towerZ], roofTerrace);
        const tall = new THREE.Mesh(pointedArch(3.2, 6.4), archDark);
        tall.position.set(towerX, 0.3, front);
        tall.rotation.y = Math.PI;
        group.add(tall);
        const jali = new THREE.Mesh(pointedArch(5, 6), whiteStone);
        jali.position.set(towerX, 8.4, front);
        jali.rotation.y = Math.PI;
        group.add(jali);
        const jaliDark = new THREE.Mesh(pointedArch(3.6, 3.4), archDark);
        jaliDark.position.set(towerX, 8.9, front - 0.06);
        jaliDark.rotation.y = Math.PI;
        group.add(jaliDark);
        // The row of small pointed arches under the corbelled cornice.
        for (const [nx, nz] of [[0, -1], [1, 0], [-1, 0]] as const) {
          for (const t of [-3, -1.5, 0, 1.5, 3]) {
            const small = new THREE.Mesh(pointedArch(0.8, 1.7), archDark);
            small.position.set(towerX + nx * (TOWER / 2 + 0.06) + (nz !== 0 ? t : 0), TOP - 3.9, towerZ + nz * (TOWER / 2 + 0.06) + (nx !== 0 ? t : 0));
            small.rotation.y = Math.atan2(nx, nz);
            group.add(small);
          }
        }
        // Two corner chhatris on the front of the tower top, three small kiosks between.
        for (const side of [-1, 1]) {
          addChhatri(group, [towerX + side * 3.1, TOP + 1.1, towerZ - 2.9], 2.7, deepBrick, terracotta);
          solid(towerX + side * 3.1, towerZ - 2.9, 1.6, TOP + 5.5);
        }
        for (const t of [-1.3, 0, 1.3]) {
          addCylinder(group, 0.45, 0.45, 1.3, [towerX + t, TOP + 1.7, towerZ - 3.6], deepBrick, 6);
          addLathe(group, domeProfile(0.55, 0.7, 0.1, 5), 6, [towerX + t, TOP + 2.35, towerZ - 3.6], terracotta);
        }
        solid(towerX, towerZ, TOWER / 2 + 0.8, TOP + 1.1);
        perchTarget = [towerX, towerZ + 1.5];
        // Octagonal turrets with open kiosks: the centre bay's four corners
        // and the end pavilions' front corners.
        const nearest = (x: number, z: number) => local.reduce((a, b) => (Math.hypot(b[0] - x, b[1] - z) < Math.hypot(a[0] - x, a[1] - z) ? b : a));
        const bayFront = local.filter(([x, z]) => z < -9 && Math.abs(x - towerX) > 8);
        const corners: Array<[MapPoint, number, number]> = bayFront.map((point) => [point, 17, 2.7]);
        for (const [x, z] of bayFront) corners.push([nearest(x, z + 8.5), 17, 2.7]);
        for (const side of [-1, 1]) corners.push([nearest(side * mass.width, -mass.depth), 16, 2.3]);
        for (const [[x, z], top, size] of corners) {
          addCylinder(group, 1.25, 1.35, top, [x, top / 2, z], deepBrick, 8);
          addCylinder(group, 1.6, 1.6, 0.4, [x, top - 0.2, z], whiteStone, 8);
          addChhatri(group, [x, top, z], size, deepBrick, terracotta);
          solid(x, z, 1.4, top + size * 1.6);
        }
        // The north lawn stays open.
        addBox(group, [100, 0.1, 56], [towerX, 0.05, tip[1] - 10], lawn).castShadow = false;
        clearSite(towerX, tip[1] - 22, 50, 21);
      }
    } else if (landmark.kind === "baitul-mukarram") {
      // The national mosque: a hollow cream cube after the Kaaba (≈ 32 × 37 m,
      // 35 m tall, three thin black bands near the top, a blue-glass box on its
      // roof) at the west end of the site, a trapezoidal triple-arched portal on
      // its east face, and east of it the marble prayer deck, now under a broad
      // beige steel canopy with rows of dark vents. The minaret stands north.
      const HALL = 186664126;
      const mass = anchor(HALL);
      if (mass) {
        const H = mass.height;
        addBays(group, walls(HALL), {
          bay: 3.4, minEdge: 14, margin: 3,
          storeys: [{ y: 3.6, opening: roundArch(1, 7.6) }],
          opening: archDark,
        });
        slab(HALL, 0, 1.6, 1.012, cream);
        slab(HALL, H - 1.2, 1.6, 1.01, cream);
        slab(HALL, H + 0.4, 0.12, 0.985, canopyBeige);
        // Frame axes: local +Z is east (the front), local +X is north.
        const hall = frame(HALL, [1, 0]);
        if (hall) {
          const { g, hz } = hall;
          // Canopy vents: four east-west rows of slots over the deck.
          for (const row of [29.4, 9.2, -8.4, -28]) {
            for (let slot = 0; slot < 13; slot++) addBox(g, [2.8, 0.12, 0.9], [row, H + 0.58, -18 + slot * 5.6], recess);
          }
          // The cube, built as four walls round its open light-well so the
          // galleried court reads from above.
          const NS = 37;
          const EW = 32.6;
          const CX = 5.5;
          // West face stands 0.4 m proud of the footprint's west wall.
          const CZ = -hz + EW / 2 - 0.4;
          const TOP = 35;
          const WELL_NS = 21;
          const WELL_EW = 17;
          const sideNS = (NS - WELL_NS) / 2;
          const sideEW = (EW - WELL_EW) / 2;
          for (const s of [-1, 1]) {
            addBox(g, [sideNS, TOP, EW], [CX + s * (NS - sideNS) / 2, TOP / 2, CZ], cream);
            addBox(g, [WELL_NS, TOP, sideEW], [CX, TOP / 2, CZ + s * (EW - sideEW) / 2], cream);
            addBox(g, [sideNS + 0.3, 0.12, EW + 0.3], [CX + s * (NS - sideNS) / 2, TOP + 0.06, CZ], roofGrey);
            addBox(g, [WELL_NS - 0.1, 0.12, sideEW + 0.3], [CX, TOP + 0.06, CZ + s * (EW - sideEW) / 2], roofGrey);
          }
          // Court floor deep in the well, with its low shallow dome.
          addBox(g, [WELL_NS, 0.6, WELL_EW], [CX, 22, CZ], cream);
          addLathe(g, domeProfile(5.5, 2.2, 0, 8), 16, [CX, 22.3, CZ], cream);
          // Three thin black bands round the outside near the top.
          for (const y of [26.9, 28.9, 30.7]) {
            for (const s of [-1, 1]) {
              addBox(g, [0.3, 0.5, EW + 0.6], [CX + s * (NS / 2 + 0.15), y, CZ], recess);
              addBox(g, [NS + 0.6, 0.5, 0.3], [CX, y, CZ + s * (EW / 2 + 0.15)], recess);
            }
          }
          // Blue-glass rooftop box on the west rim.
          addBox(g, [10, 5, 6.6], [CX - 2, TOP + 2.5, CZ - (EW - sideEW) / 2], atriumGlass);
          // Trapezoidal frontispiece on the east face: three pointed arches with
          // deep teal interiors, the centre one taller.
          const portal = new THREE.Group();
          portal.position.set(CX, 6, CZ + EW / 2);
          g.add(portal);
          const front = new THREE.Shape();
          front.moveTo(-8, 0);
          front.lineTo(8, 0);
          front.lineTo(6.5, 14);
          front.lineTo(-6.5, 14);
          front.lineTo(-8, 0);
          const frontMesh = new THREE.Mesh(new THREE.ExtrudeGeometry(front, { depth: 3, bevelEnabled: false, curveSegments: 1 }), cream);
          portal.add(frontMesh);
          for (const [offset, archWidth, archHeight] of [[-4.6, 3.6, 8], [0, 5, 11], [4.6, 3.6, 8]] as const) {
            const arch = new THREE.Mesh(pointedArch(archWidth, archHeight), tealArch);
            arch.position.set(offset, 0.2, 3.06);
            portal.add(arch);
          }
          for (const offset of [-2.6, 2.6]) addCylinder(portal, 0.3, 0.3, 6.8, [offset, 3.6, 3.4], cream, 8);
          // Minaret north of the cube: square base, square shaft, an open
          // balcony box and a small dome.
          const MX = CX + 32;
          addBox(g, [8, 9, 8], [MX, 4.5, CZ], cream);
          addBox(g, [5, 30, 5], [MX, 24, CZ], cream);
          addBox(g, [6.4, 4, 6.4], [MX, 41, CZ], cream);
          for (let face = 0; face < 4; face++) {
            const angle = (face / 4) * Math.PI * 2;
            const opening = new THREE.Mesh(roundArch(1.4, 2.4), archDark);
            opening.position.set(MX + Math.sin(angle) * 3.26, 39.8, CZ + Math.cos(angle) * 3.26);
            opening.rotation.y = angle;
            g.add(opening);
          }
          addBox(g, [7, 0.5, 7], [MX, 43.2, CZ], cream);
          addLathe(g, domeProfile(2.4, 3.2, 0.12, 8), 12, [MX, 43.45, CZ], cream);
          addFinial(g, [MX, 46.5, CZ], 0.5, cream);
          // Pink-domed gate pavilion at the south gate.
          const GX = CX - 41;
          addBox(g, [8, 7, 8], [GX, 3.5, CZ], cream);
          addLathe(g, domeProfile(3.4, 3.6, 0.1, 8), 12, [GX, 7, CZ], pink);
          g.updateMatrix();
          const seat = (x: number, z: number) => new THREE.Vector3(x, 0, z).applyMatrix4(g.matrix);
          const cubeSeat = seat(CX, CZ);
          solid(cubeSeat.x, cubeSeat.z, NS / 2, TOP);
          const minaretSeat = seat(MX, CZ);
          solid(minaretSeat.x, minaretSeat.z, 3.4, 46);
          const perchSeat = seat(CX + 6, CZ + (EW - sideEW) / 2);
          perchTarget = [perchSeat.x, perchSeat.z];
        }
      }
    } else if (landmark.kind === "bangladesh-bank") {
      // Bangladesh Bank Tower (OSM 498175910): a 46 × 26 m slab, 31 storeys.
      // The long N and S faces are continuous bronze-dark ribbon windows between
      // buff-olive spandrels, finely checkered by dark mullions; the short E and
      // W ends are blank sage concrete; a heavy fascia caps the wings. A solid
      // concrete core spine runs up the middle of the south face and rises two
      // storeys above the roof, carrying two lattice masts. The four-storey
      // podium (OSM 297868959) wraps the tower on the N, E and S; its north
      // front carries a mosaic mural under a deep fascia beam, facing the
      // forecourt sculpture. Heading 0, so local axes are world axes (+Z south).
      const WING = 112;
      const CORE = 118;
      const PODIUM = 16;
      colliderTop = WING;
      perchTarget = [0, 4];
      addBox(group, [44, WING - 2, 25.2], [0, (WING - 2) / 2, 0], ribbonGlass);
      for (const side of [-1, 1]) addBox(group, [1.8, WING, 26], [side * 22.3, WING / 2, 0], sageConcrete);
      for (let y = PODIUM + 1.2; y < WING - 4; y += 3.6) addBox(group, [42.9, 1.65, 26], [0, y, 0], oliveBuff);
      for (let x = -20.5; x <= 20.6; x += 1.5) {
        for (const side of [-1, 1]) addBox(group, [0.16, WING - PODIUM - 4, 0.3], [x, (WING + PODIUM - 4) / 2, side * 13.08], ribbonGlass);
      }
      addBox(group, [46.6, 3.4, 26.6], [0, WING - 1.7, 0], concrete);
      addBox(group, [45, 0.2, 25], [0, WING + 0.05, 0], roofGrey);
      // The core spine on the south face, with its small punched windows.
      addBox(group, [12, CORE, 1.4], [0, CORE / 2, 13.6], concrete);
      addBox(group, [12, CORE - WING, 20], [0, (WING + CORE) / 2, 4], concrete);
      for (let y = PODIUM + 2; y < CORE - 2; y += 3.6) {
        for (const x of [-3.2, 0, 3.2]) addBox(group, [1.1, 1.6, 0.12], [x, y, 14.33], ribbonGlass);
      }
      for (const [mx, mz, mastHeight] of [[-2.6, 0, 17], [3, 8, 12]] as const) {
        addCylinder(group, 0.16, 0.3, mastHeight, [mx, CORE + mastHeight / 2, mz], roofGrey, 4);
        for (let arm = 0; arm < 3; arm++) addBox(group, [2.6, 0.12, 0.12], [mx, CORE + mastHeight * (0.5 + arm * 0.18), mz], roofGrey);
      }
      // Podium, re-centred from OSM 297868959 (local x = east, z = south).
      const podiumShape = new THREE.Shape();
      const podiumOutline: Array<[number, number]> = [
        [26.8, 15.9], [15.9, 59.8], [-19.4, 58.7], [-19.1, 51.4], [-17.7, 13.3], [23.4, 13], [23.2, -13.4],
        [-16.6, -13.2], [-16.3, -23.2], [-2.9, -22.6], [37.7, -20.8],
      ];
      podiumOutline.forEach(([x, z], index) => (index ? podiumShape.lineTo(x, -z) : podiumShape.moveTo(x, -z)));
      const podiumGeometry = new THREE.ExtrudeGeometry(podiumShape, { depth: PODIUM, bevelEnabled: false, curveSegments: 1 });
      podiumGeometry.rotateX(-Math.PI / 2);
      const podium = new THREE.Mesh(podiumGeometry, concrete);
      group.add(podium);
      // Recessed glazed ground floor, the mural frieze and the fascia beam on
      // the north front (edge from (-16.3, -23.2) to (37.7, -20.8)).
      const front = new THREE.Group();
      front.position.set(10.7, 0, -22);
      front.rotation.y = -Math.atan2(2.4, 54);
      group.add(front);
      addBox(front, [53.6, 4.6, 0.3], [0, 2.3, -0.12], ribbonGlass);
      addBox(front, [53, 5.4, 0.2], [0, 7.8, -0.08], accent);
      addBox(front, [55, 3.4, 3.2], [0, PODIUM - 1.7, -1.4], concrete);
      addBox(group, [30, 0.15, 34], [-1.5, PODIUM + 0.05, 38], roofGrey);
      // Forecourt sculpture: two raised steel arms round a sphere.
      for (const side of [-1, 1]) {
        const arm = addBox(group, [1.4, 9, 1.4], [8 + side * 1.6, 4.5, -36], bronze);
        arm.rotation.z = side * -0.38;
      }
      const orb = new THREE.Mesh(new THREE.SphereGeometry(1.7, 12, 8), bronze);
      orb.position.set(8, 9.4, -36);
      group.add(orb);
      solidBox(0, 4.5, 7, 10.5, CORE);
      // The podium as boxes that follow podiumOutline (heading 0, so local
      // boxes are world boxes): the south block, the east arm in two steps
      // under its slanted edge, and the north front.
      solidBox(3.7, 36.4, 23.1, 23.4, PODIUM);
      solidBox(30.45, -12, 7.25, 9, PODIUM);
      solidBox(27.75, 6.5, 4.55, 9.5, PODIUM);
      solidBox(10.7, -19.6, 27.6, 6.4, PODIUM);
      clearSite(10, 16, 36, 46);
    } else if (landmark.kind === "airport") {
      // Hazrat Shahjalal International. Local +Z runs down runway 14/32 (bearing
      // 144°) and local +X points NE, across the airfield to the terminals; the
      // numbers come from OSM measured in this frame. The runway (way 13858653)
      // spans z -1370…1822, with grass infields, parallel taxiways and aprons;
      // Terminal 1/2 (way 143950720) is the long white Berger-era hall with
      // arched bays, porthole openings and a flat canopy on slender columns;
      // Terminal 3 (way 1172183216) is the vast pale roof with a grid of
      // skylights, piers toward the apron and a deep landside canopy.
      colliderTop = 1.5;
      perchTarget = [1170, 1060];
      const GROUND = -0.9; // world y = 0
      const RUNWAY_Z = 226;
      const RUNWAY_LENGTH = 3_192;
      // Grass infield (above park turf, below map water), shoulders, runway.
      addBox(group, [1_000, 0.1, 3_380], [40, GROUND + 0.33, 225], lawn).castShadow = false;
      addBox(group, [64, 0.2, RUNWAY_LENGTH + 60], [2.5, GROUND + 0.5, RUNWAY_Z], paleConcrete).castShadow = false;
      addBox(group, [45, 0.2, RUNWAY_LENGTH], [2.5, GROUND + 0.65, RUNWAY_Z], recess).castShadow = false;
      const markTop = GROUND + 0.78;
      for (let z = RUNWAY_Z - RUNWAY_LENGTH / 2 + 120; z < RUNWAY_Z + RUNWAY_LENGTH / 2 - 120; z += 60) {
        addBox(group, [0.9, 0.06, 30], [2.5, markTop, z], whiteStone);
      }
      for (const end of [-1, 1]) {
        const threshold = RUNWAY_Z + end * (RUNWAY_LENGTH / 2 - 14);
        for (let bar = -7; bar <= 7; bar++) {
          if (bar === 0) continue;
          addBox(group, [1.8, 0.06, 30], [2.5 + bar * 2.8, markTop, threshold], whiteStone);
        }
        for (const offset of [150, 300, 450]) {
          for (const side of [-1, 1]) addBox(group, [3, 0.06, 22], [2.5 + side * 9, markTop, RUNWAY_Z + end * (RUNWAY_LENGTH / 2 - offset)], whiteStone);
        }
      }
      // Parallel taxiways (east at x 552, west angling at x -430), the link
      // taxiways, the main apron in front of Terminal 1/2 and the west aprons.
      const pave = (x0: number, x1: number, z0: number, z1: number, y = GROUND + 0.38) => {
        const pad = addBox(group, [x1 - x0, 0.16, z1 - z0], [(x0 + x1) / 2, y, (z0 + z1) / 2], paleConcrete);
        pad.castShadow = false;
      };
      pave(541, 564, -1420, 1780);
      pave(-442, -419, -330, 1790);
      for (const z of [-1300, -400, 229, 900, 1745]) pave(34, 541, z - 11, z + 11, GROUND + 0.34);
      for (const z of [-300, 1100, 1760]) pave(-430, -30, z - 11, z + 11, GROUND + 0.34);
      pave(564, 868, -793, 775, GROUND + 0.42);
      pave(-472, -380, 97, 1064, GROUND + 0.42);
      pave(566, 1000, 776, 1440, GROUND + 0.42);
      // Landside forecourt and car parks between the terminals and Airport Road.
      pave(992, 1290, -70, 665);
      addBox(group, [18, 0.12, 735], [1003, GROUND + 0.5, 297], recess).castShadow = false;
      for (let z = -40; z < 650; z += 46) addBox(group, [236, 0.2, 6], [1158, GROUND + 0.52, z], lawn).castShadow = false;
      // Terminal 1/2: hall x 900…979, z -62…512, roof 16 m; a lower glazed
      // concourse and jet bridges airside.
      const T12 = { x0: 900, x1: 979, z0: -62, z1: 512, roof: 16 };
      addBox(group, [T12.x1 - T12.x0, T12.roof, T12.z1 - T12.z0], [(T12.x0 + T12.x1) / 2, T12.roof / 2 + GROUND, (T12.z0 + T12.z1) / 2], whiteStone);
      addBox(group, [T12.x1 - T12.x0 - 4, 0.2, T12.z1 - T12.z0 - 4], [(T12.x0 + T12.x1) / 2, T12.roof + GROUND + 0.1, (T12.z0 + T12.z1) / 2], paleConcrete);
      addBox(group, [36, 9, T12.z1 - T12.z0 - 30], [882, 4.5 + GROUND, (T12.z0 + T12.z1) / 2], ribbonGlass);
      addBox(group, [38, 0.8, T12.z1 - T12.z0 - 28], [882, 9.4 + GROUND, (T12.z0 + T12.z1) / 2], whiteStone);
      for (const z of [-45, 27, 103, 174, 246, 319, 393, 466]) {
        addBox(group, [36, 3.2, 3.6], [846, 5.5 + GROUND, z], silverPanel);
        addBox(group, [3, 4, 3], [830, 2 + GROUND, z], silverPanel);
      }
      // Landside arcade: shallow arch bays with porthole openings in the upper
      // storey, a glazed ground floor, and the deep flat canopy whose slender
      // white columns flare out at the top.
      const arch = roundArch(9.4, 7.2);
      const porthole = discPane(2.3, 16);
      addBox(group, [0.3, 4.4, T12.z1 - T12.z0 - 2], [T12.x1 + 0.1, 2.2 + GROUND, (T12.z0 + T12.z1) / 2], ribbonGlass);
      for (let z = T12.z0 + 7; z < T12.z1 - 4; z += 12) {
        const bay = new THREE.Mesh(arch, ribbonGlass);
        bay.position.set(T12.x1 + 0.08, 6 + GROUND, z);
        bay.rotation.y = Math.PI / 2;
        group.add(bay);
        const ring = new THREE.Mesh(porthole, whiteStone);
        ring.position.set(T12.x1 + 0.16, 7.6 + GROUND, z);
        ring.rotation.y = Math.PI / 2;
        group.add(ring);
        addCylinder(group, 1.4, 0.4, 3, [T12.x1 + 11, 10.9 + GROUND, z + 6], whiteStone, 8);
        addCylinder(group, 0.4, 0.4, 9.6, [T12.x1 + 11, 4.8 + GROUND, z + 6], whiteStone, 8);
      }
      addBox(group, [13, 1.1, T12.z1 - T12.z0 + 8], [T12.x1 + 6.5, 12.9 + GROUND, (T12.z0 + T12.z1) / 2], whiteStone);
      // The column heads flare into a continuous row of shallow white arches
      // under the canopy's outer edge: the terminal's signature from the curb.
      const canopyArch = new THREE.Shape();
      canopyArch.moveTo(-6, 0);
      canopyArch.lineTo(-6, 3.95);
      canopyArch.lineTo(6, 3.95);
      canopyArch.lineTo(6, 0);
      for (let step = 1; step < 10; step++) {
        const angle = (step / 10) * Math.PI;
        canopyArch.lineTo(6 * Math.cos(angle), 2.4 * Math.sin(angle));
      }
      canopyArch.lineTo(-6, 0);
      const canopyArchGeometry = new THREE.ExtrudeGeometry(canopyArch, { depth: 0.6, bevelEnabled: false });
      for (let z = T12.z0 + 19; z < T12.z1; z += 12) {
        const span = new THREE.Mesh(canopyArchGeometry, whiteStone);
        span.position.set(T12.x1 + 10.7, 8.6 + GROUND, z);
        span.rotation.y = Math.PI / 2;
        group.add(span);
      }
      addBox(group, [0.4, 1.4, 120], [T12.x1 + 0.4, T12.roof + 0.7 + GROUND, 300], monumentRed);
      // Control tower beside the concourse.
      addCylinder(group, 3.6, 4.6, 46, [866, 23 + GROUND, 47], paleConcrete, 10);
      addCylinder(group, 9, 5, 5, [866, 48.5 + GROUND, 47], whiteStone, 10);
      addCylinder(group, 9.6, 9, 5.2, [866, 53.6 + GROUND, 47], ribbonGlass, 10);
      addCylinder(group, 10.2, 10.2, 1, [866, 56.7 + GROUND, 47], whiteStone, 10);
      addCylinder(group, 0.4, 0.4, 9, [866, 61.7 + GROUND, 47], silverPanel, 4);
      // Terminal 3: glazed hall under one pale roof oversailing 5 m all round,
      // with a skylight grid and gentle ridges across the short axis, three
      // airside piers and a 15 m landside canopy on tall slim columns.
      const T3 = { x0: 1062, x1: 1286, z0: 702, z1: 1418, roof: 24 };
      const t3x = (T3.x0 + T3.x1) / 2;
      const t3z = (T3.z0 + T3.z1) / 2;
      addBox(group, [T3.x1 - T3.x0, T3.roof - 2, T3.z1 - T3.z0], [t3x, (T3.roof - 2) / 2 + GROUND, t3z], ribbonGlass);
      addBox(group, [T3.x1 - T3.x0 + 10, 2, T3.z1 - T3.z0 + 10], [t3x, T3.roof - 1 + GROUND, t3z], silverPanel);
      for (let z = T3.z0 + 30; z < T3.z1; z += 60) addBox(group, [T3.x1 - T3.x0 + 8, 1, 7], [t3x, T3.roof + 0.4 + GROUND, z], silverPanel);
      for (let x = T3.x0 + 12; x < T3.x1; x += 25) {
        for (let z = T3.z0 + 15; z < T3.z1; z += 25) {
          if ((z - T3.z0 - 30) % 60 > 50) continue;
          addBox(group, [3.2, 0.3, 3.2], [x, T3.roof + 0.05 + GROUND, z], atriumGlass);
        }
      }
      for (const z of [820, 1060, 1300]) {
        addBox(group, [62, 12, 30], [1031, 6 + GROUND, z], ribbonGlass);
        addBox(group, [64, 1.2, 32], [1031, 12.6 + GROUND, z], silverPanel);
      }
      addBox(group, [16, 1, T3.z1 - T3.z0 - 40], [T3.x1 + 13, 18.5 + GROUND, t3z], silverPanel);
      for (let z = T3.z0 + 30; z < T3.z1 - 20; z += 36) addCylinder(group, 0.5, 0.5, 18, [T3.x1 + 19, 9 + GROUND, z], whiteStone, 6);
      // Airliners at the Terminal 1/2 gates, one on the taxiway, one at T3.
      const addAirliner = (x: number, z: number, heading: number, livery: THREE.Material) => {
        const plane = new THREE.Group();
        plane.position.set(x, 3.7 + GROUND, z);
        plane.rotation.y = heading;
        group.add(plane);
        const fuselage = addCylinder(plane, 2.2, 2.2, 34, [0, 0, 0], whiteStone, 10);
        fuselage.rotation.x = Math.PI / 2;
        const nose = addCone(plane, 2.2, 6, [0, 0, 20], whiteStone, 10);
        nose.rotation.x = Math.PI / 2;
        const tail = addCone(plane, 2.2, 9, [0, 0.6, -21.5], whiteStone, 10);
        tail.rotation.x = -Math.PI / 2;
        for (const side of [-1, 1]) {
          const wing = addBox(plane, [20, 0.5, 5.4], [side * 11, -0.6, -1.5], whiteStone);
          wing.rotation.y = side * 0.42;
          const engine = addCylinder(plane, 1.1, 1.1, 4.6, [side * 7.4, -1.9, 1.6], silverPanel, 8);
          engine.rotation.x = Math.PI / 2;
          const stabiliser = addBox(plane, [7.6, 0.4, 3], [side * 4.2, 1, -21.5], whiteStone);
          stabiliser.rotation.y = side * 0.4;
        }
        const fin = addBox(plane, [0.5, 8, 5.6], [0, 4.6, -21.5], livery);
        fin.rotation.x = -0.5;
      };
      for (const [index, z] of [-45, 103, 246, 393].entries()) addAirliner(800, z, Math.PI / 2, index % 2 ? ribbonGlass : monumentRed);
      addAirliner(552, 620, 0, monumentRed);
      addAirliner(972, 1060, Math.PI / 2, ribbonGlass);
      // The terminals, the T1/T2 concourse and canopy, and the T3 piers and
      // oversailing roof, tiled in their own turned frame.
      solidTiles(T12.x0, T12.x1, T12.z0, T12.z1, T12.roof + GROUND, 26);
      solidTiles(T12.x1, T12.x1 + 13, T12.z0 - 4, T12.z1 + 4, 13.5 + GROUND, 26);
      solidTiles(864, 900, T12.z0 + 15, T12.z1 - 15, 9.8 + GROUND, 26);
      solidTiles(T3.x0 - 5, T3.x1 + 5, T3.z0 - 5, T3.z1 + 5, T3.roof + GROUND, 40);
      solidTiles(T3.x1 + 5, T3.x1 + 21, T3.z0 + 20, T3.z1 - 20, 19 + GROUND, 30);
      for (const z of [820, 1060, 1300]) solidBox(1031, z, 32, 16, 13.2 + GROUND);
      solid(866, 47, 8, 57 + GROUND);
    } else if (landmark.kind === "ramna-park") {
      // Ramna Park: Ramna Batamul, the huge old fig on the peninsula at the
      // inner corner of Ramna Lake where Pohela Boishakh is greeted, with one
      // long low limb sweeping out over its brick planter; the worn festival
      // lawn ESE of it; and the timber boardwalk along the lake shore with a
      // long flat footbridge across the west arm. The lake itself is map water.
      // Local +Z faces ESE (120°) toward the lawn.
      boundsCollider = false;
      addCylinder(group, 5, 5.2, 0.6, [0, 0.3, 0], plazaBrick, 14);
      addCylinder(group, 0.9, 1.4, 8.5, [0, 4.6, 0], landmarkBark, 8);
      for (const angle of [0.4, 1.9, 3.3, 4.8]) {
        addBeam(group, [Math.sin(angle) * 1.8, 0.6, Math.cos(angle) * 1.8], [Math.sin(angle) * 0.4, 3.2, Math.cos(angle) * 0.4], 0.7, 0.9, landmarkBark);
      }
      // Main limbs up into the crown, and the long near-horizontal limb.
      for (const [lx, ly, lz] of [[-5, 11, 4], [6, 11.5, -3], [3, 12, 6], [-4, 12, -5]] as const) {
        addBeam(group, [0, 7.5, 0], [lx, ly, lz], 0.6, 0.6, landmarkBark);
      }
      addBeam(group, [0.6, 3.6, 0.6], [6.5, 3.4, 5.2], 0.75, 0.75, landmarkBark);
      addBeam(group, [6.5, 3.4, 5.2], [11.4, 2.6, 8.6], 0.55, 0.55, landmarkBark);
      // A broad spreading dome of a crown, about 30 m across and 19 m tall —
      // twice the spread of any park tree round it — drooping low at the rim.
      for (const [bx, by, bz, r, sy, mat] of [
        [0, 13.2, 0, 13, 0.42, landmarkCanopy],
        [-6.4, 11.6, 4.6, 7.6, 0.6, landmarkLightCanopy],
        [7.2, 11.8, -3.8, 7.4, 0.6, landmarkCanopy],
        [3.4, 12.4, 6.6, 6.6, 0.62, landmarkLightCanopy],
        [-5.2, 12.2, -6.4, 6.8, 0.6, landmarkCanopy],
        [1.5, 15.5, -1, 6.2, 0.58, landmarkLightCanopy],
        [-9.6, 9.6, -1.2, 5.4, 0.58, landmarkLightCanopy],
        [0.6, 9.8, -10.2, 5.2, 0.58, landmarkLightCanopy],
        [10.8, 6.4, 8.2, 3.8, 0.62, landmarkLightCanopy],
        // The drooping skirt that carries the crown out to its full spread.
        [8.8, 9.2, -1.8, 5.0, 0.55, landmarkCanopy],
        [-8.7, 9.4, 1.7, 5.0, 0.55, landmarkCanopy],
        [-2.4, 9.0, 8.7, 5.0, 0.55, landmarkCanopy],
        [3.3, 9.2, -8.5, 5.0, 0.55, landmarkCanopy],
        [-6.7, 9.0, -6.4, 4.6, 0.55, landmarkLightCanopy],
        [6.4, 9.2, 6.7, 4.6, 0.55, landmarkLightCanopy],
      ] as const) {
        const crown = new THREE.Mesh(treeCrownGeo, mat);
        crown.position.set(bx * 1.12, by * 1.04, bz * 1.12);
        crown.scale.set(r * 1.12, r * sy * 1.08, r * 1.12);
        crown.castShadow = true;
        crown.receiveShadow = true;
        group.add(crown);
      }
      solid(0, 0, 14, 19.8);
      perchTarget = [0.01, 0];
      // The worn festival lawn, framed by the park's big rain trees.
      addBox(group, [35, 0.08, 30], [0, 0.04, 21], packedEarth).castShadow = false;
      for (const [tx, tz, r, h, mat] of [
        [-30, 24, 5.4, 6.8, landmarkCanopy],
        [30, 22, 5.2, 6.6, landmarkLightCanopy],
        [-22, 46, 5.0, 6.4, landmarkKrishnachura],
        [22, 46, 5.2, 6.6, landmarkCanopy],
      ] as const) {
        addLandmarkTree(group, tx, tz, r, h, mat);
      }
      clearSite(0, 12, 22, 36);
      // Park trees keep clear of the crown so it stands alone.
      clearSite(0, -4, 21, 20);
      // The shore boardwalk and the footbridge, in world axes (east +x, south
      // +z) about the tree: OSM 31664577's shoreline offset 1.4 m inland.
      const shore = new THREE.Group();
      shore.rotation.y = -landmark.heading;
      group.add(shore);
      const walk = (points: Array<[number, number]>, deckY: number, width: number) => {
        for (let index = 1; index < points.length; index++) {
          const [ax, az] = points[index - 1];
          const [bx, bz] = points[index];
          const length = Math.hypot(bx - ax, bz - az);
          const [nx, nz] = [-(bz - az) / length, (bx - ax) / length];
          addBeam(shore, [ax, deckY, az], [bx, deckY, bz], width, 0.3, brick, 1.2);
          for (const side of [-1, 1]) {
            const ox = nx * side * (width / 2 - 0.05);
            const oz = nz * side * (width / 2 - 0.05);
            addBeam(shore, [ax + ox, deckY + 0.6, az + oz], [bx + ox, deckY + 0.6, bz + oz], 0.1, 1.0, landmarkBark, 0.2);
          }
        }
      };
      walk([[66.5, 28.5], [55.3, 5.9], [49.1, -3.8], [43.3, -10.8], [29.9, -21], [9.4, -28.1], [-8.5, -29.5], [-21.3, -27.3],
        [-31.6, -21.3], [-36.6, -15.6], [-38.4, -9.8], [-38, 1], [-35.1, 19.6], [-32, 33.2]], 0.5, 3);
      walk([[-92.3, -266.1], [-40.2, -72.5], [-36, -64.2], [-31, -57.3], [-26.6, -54.3], [-17.7, -52.3], [3.3, -53.3], [20.6, -54],
        [47.8, -52.9], [70.1, -49.3], [98.2, -36.7]], 0.5, 3);
      // The long low footbridge across the west arm, on concrete piers.
      walk([[-58, -150], [-136, -150]], 1.4, 2.6);
      for (let x = -62; x >= -132; x -= 7) addBox(shore, [0.6, 1.3, 2.2], [x, 0.6, -150], paleConcrete);
      // Mukto Mancha, the small open-air stage north of the lake.
      addBox(shore, [12.6, 1.5, 11.3], [34.5, 0.75, -95], paleConcrete);
    } else if (landmark.kind === "suhrawardy-udyan") {
      // Swadhinata Stambha: a 50 m square glass shaft with its steel lattice
      // showing through, at the south end of the Museum of Independence's roof
      // plaza. The plaza is a pale stone deck between the arms of the lake (map
      // water), with a round pool, rows of skylights, a long relief wall down
      // its east edge and broad steps down to the park at the north end.
      // Local +Z runs NNW up the plaza; local -X is east. Shikha Chirantan, the
      // eternal flame, stands 242 m up the same axis and is not modelled here.
      const DECK = 2.2;
      colliderTop = DECK;
      // Land on the cap frame beside the mast.
      perchTarget = [2.2, 2.2];
      // The deck (OSM 259718868): x -20.5…18.5, from 20 m south of the tower to
      // the head of the steps.
      addBox(group, [39, DECK + 0.9, 153], [-1, (DECK - 0.9) / 2, 56.5], paleConcrete);
      for (let step = 0; step < 8; step++) {
        const stepTop = DECK - ((step + 1) * DECK) / 9;
        addBox(group, [39, stepTop + 0.9, 1.5], [-1, (stepTop - 0.9) / 2, 133.75 + step * 1.5], paleConcrete);
      }
      // Pairs of square skylights over the galleries below.
      for (let row = 0; row < 9; row++) {
        const z = 18 + row * 12.5;
        if (Math.abs(z - 70) < 12) continue;
        for (const x of [-15, -11.6, -3, 0.4, 9, 12.4]) addBox(group, [2.6, 0.12, 1.6], [x, DECK + 0.02, z], beaconGlass);
      }
      // The round pool in a stepped rim, on the axis north of the tower.
      addArcSlab(group, 8.6, 10.2, 0, Math.PI * 2, DECK, 0.1, concrete, 28).position.set(-1, DECK, 70);
      addCylinder(group, 8.6, 8.6, 0.08, [-1, DECK + 0.02, 70], water, 28);
      // Relief wall (OSM 947680219): grey board-marked concrete, its plaza face
      // carrying a terracotta relief with a ragged lower edge.
      addBox(group, [3, DECK + 6.9, 127], [-22.5, (DECK + 5.1) / 2, 85.5], boardConcrete);
      for (let panel = 0; panel < 16; panel++) {
        const bottom = DECK + 1.6 + ((panel * 7) % 5) * 0.45;
        const relief = addBox(group, [0.2, DECK + 5.6 - bottom, 7.94], [-20.92, (DECK + 5.6 + bottom) / 2, 25.97 + panel * 7.94], terracotta);
        relief.castShadow = false;
      }
      // The stambha: plinth, glass shaft, the steel frame outside the glass
      // (corner posts, a ring and a cross-brace on every face every 4 m), cap
      // frame and mast.
      const SHAFT_BASE = DECK + 1;
      const SHAFT = 50;
      addBox(group, [11.4, 1, 10.4], [0, DECK + 0.5, 0], concrete);
      addBox(group, [7, SHAFT, 7], [0, SHAFT_BASE + SHAFT / 2, 0], beaconGlass);
      for (const cx of [-1, 1]) {
        for (const cz of [-1, 1]) addBox(group, [0.42, SHAFT, 0.42], [cx * 3.52, SHAFT_BASE + SHAFT / 2, cz * 3.52], plantGrey);
      }
      const PANEL = 4;
      const brace = Math.hypot(7, PANEL);
      const braceAngle = Math.atan2(PANEL, 7);
      for (let y = SHAFT_BASE; y < SHAFT_BASE + SHAFT - 0.1; y += PANEL) {
        for (let face = 0; face < 4; face++) {
          const face1 = new THREE.Group();
          face1.rotation.y = (face * Math.PI) / 2;
          group.add(face1);
          addBox(face1, [7.1, 0.22, 0.14], [0, y, 3.56], plantGrey);
          for (const sign of [-1, 1]) {
            const bar = addBox(face1, [brace, 0.14, 0.1], [0, y + PANEL / 2, 3.55], plantGrey);
            bar.rotation.z = sign * braceAngle;
          }
        }
      }
      addBox(group, [7.4, 0.7, 7.4], [0, SHAFT_BASE + SHAFT + 0.35, 0], plantGrey);
      addCylinder(group, 0.1, 0.16, 5, [0, SHAFT_BASE + SHAFT + 3.2, 0], plantGrey, 5);
      solid(0, 0, 4.2, SHAFT_BASE + SHAFT + 0.7);
      clearSite(-2, 62, 23, 86);
    } else if (landmark.kind === "rabindra-sarobar") {
      // Rabindra Sarobar: a sunken open-air amphitheatre on the west shore of
      // Dhanmondi Lake. Grass-and-step tiers wrap ~215° round a small round
      // stage; a curved six-column colonnade with a red beam stands between the
      // stage and the water. Local +Z faces the audience (WNW), the lake is -Z.
      colliderTop = 3.8;
      perchTarget = [0, -7];
      // OSM seating fan 983581387: bearings 19° → west → 166°, i.e. local
      // -99° → +114° from +Z, open toward the lake.
      const FAN_START = -1.73;
      const FAN_LENGTH = 3.72;
      const PATH_TOP = 0.2;
      // Brick ring path round the stage, running on to a parapet at the shore.
      addCylinder(group, 9.5, 9.5, PATH_TOP, [0, PATH_TOP / 2, 0], redBrick, 32);
      addBox(group, [22, 0.18, 2.6], [0, 0.09, -10.4], redBrick);
      addBox(group, [22, 0.8, 0.4], [0, 0.4, -11.7], concrete);
      // Stage: Ø13.6 m drum 0.9 m up, on one step ring.
      addCylinder(group, 7.7, 7.7, 0.45, [0, PATH_TOP + 0.225, 0], concrete, 32);
      addCylinder(group, 6.8, 6.8, 0.9, [0, PATH_TOP + 0.45, 0], marble, 32);
      // Five tier bands, each two 0.36 m concrete risers and a 2 m grass tread,
      // with pale radial aisles cutting through them.
      for (let band = 0; band < 5; band++) {
        const radius = 9.5 + band * 2.9;
        const riserTop = PATH_TOP + 0.36 * (band * 2 + 1);
        const treadTop = PATH_TOP + 0.36 * (band * 2 + 2);
        addArcSlab(group, radius, radius + 0.45, FAN_START, FAN_LENGTH, 0, riserTop, concrete, 28);
        addArcSlab(group, radius + 0.45, radius + 2.9, FAN_START, FAN_LENGTH, 0, treadTop, concrete, 28);
        addArcSlab(group, radius + 0.95, radius + 2.9, FAN_START, FAN_LENGTH, treadTop, 0.05, lawn, 28);
        for (let aisle = 0; aisle < 5; aisle++) {
          const theta = FAN_START + (FAN_LENGTH * (aisle + 0.5)) / 5;
          const mid = radius + 1.45;
          const step = addBox(group, [1.6, treadTop + 0.07, 2.9], [Math.sin(theta) * mid, (treadTop + 0.07) / 2, Math.cos(theta) * mid], marble);
          step.rotation.y = theta;
        }
      }
      // Grass berm stepping down from the top tier to a brick retaining wall,
      // then the earth footpath under the trees.
      for (const [inner, outer, terraceTop] of [[24, 27.5, 3.45], [27.5, 31, 2.7], [31, 34, 1.9]] as const) {
        addArcSlab(group, inner, outer, FAN_START, FAN_LENGTH, 0, terraceTop, lawn, 28);
      }
      addArcSlab(group, 34, 34.6, FAN_START, FAN_LENGTH, 0, 2.15, redBrick, 28);
      addArcSlab(group, 34.6, 38, FAN_START - 0.05, FAN_LENGTH + 0.1, 0, 0.14, packedEarth, 28);
      // The signature: six white columns on a curved bench, carrying one
      // continuous red beam, on the lake side of the stage.
      const ARC_START = 2.217;
      const ARC_LENGTH = 1.85;
      addArcSlab(group, 6.6, 7.4, ARC_START - 0.06, ARC_LENGTH + 0.12, PATH_TOP, 1.05, marble, 12);
      for (let column = 0; column < 6; column++) {
        const theta = ARC_START + (ARC_LENGTH * column) / 5;
        addCylinder(group, 0.28, 0.3, 4.2, [Math.sin(theta) * 7, PATH_TOP + 1.05 + 2.1, Math.cos(theta) * 7], marble, 10);
      }
      addArcSlab(group, 6.55, 7.45, ARC_START - 0.04, ARC_LENGTH + 0.08, PATH_TOP + 5.25, 1.05, monumentRed, 12);
      solid(0, -6, 5, 5.5);
      // Big rain trees and figs ring the bowl; on the south side (local +X)
      // their crowns overhang the upper tiers. Coconut palms by the stage.
      for (let index = 0; index < 12; index++) {
        const theta = -1.95 + index * 0.37;
        const radius = 43 + (index % 3) * 2.5;
        addLandmarkTree(group, Math.sin(theta) * radius, Math.cos(theta) * radius, 7 + (index % 2), 7.4, landmarkCanopy);
      }
      for (const [tx, tz, radius] of [[31, 6, 8], [26, -9, 7], [34, 19, 7.5]] as const) addLandmarkTree(group, tx, tz, radius, 8, landmarkCanopy);
      addPalm(group, 11.5, -8.6, 10.5, 0.1, 0.4);
      addPalm(group, 14.6, -6.2, 9, 0.14, -0.6);
      addPalm(group, 8.4, -11, 11.5, 0.08, 2.2);
    } else if (landmark.kind === "baldha-garden") {
      // Baldha Garden, Wari: a narrow 229 m walled strip (OSM way 34597180)
      // running NNE beside Narinda Road, almost wholly under a closed canopy
      // of tall old trees and palms. The one clear opening is the
      // whitewashed water-lily tank with its railed walk and a stepped ghat
      // lined with red flower pots; small whitewashed plant houses stand in
      // clearings. Local +Z runs NNE along the strip (heading 2.88).
      boundsCollider = false;
      const strip = ([
        [23.717837, 90.4193419], [23.7178026, 90.4195143], [23.7177692, 90.4195339], [23.7174688, 90.4197211],
        [23.7171683, 90.419791], [23.7167939, 90.419684], [23.7157676, 90.4193711], [23.715782, 90.4191111],
        [23.7166146, 90.419199], [23.7166261, 90.4190636], [23.7170472, 90.4190596], [23.7171264, 90.4192127],
        [23.717449, 90.419301],
      ] as const).map(([lat, lon]) => toLocal(lat, lon));
      // In the local frame +Z is NNE, so a plan drawn from local (x, z)
      // mirrors; the shape is built in (x, -z) and turned back by rotateX.
      const ground = new THREE.Mesh(new THREE.ShapeGeometry(new THREE.Shape(strip.map(([x, z]) => new THREE.Vector2(x, -z)))), lawn);
      ground.rotation.x = -Math.PI / 2;
      ground.position.y = 0.12;
      ground.receiveShadow = true;
      group.add(ground);
      // The low whitewashed compound wall.
      addSweptBox(group, [...strip, strip[0]].map(([x, z]) => [x, 2.1, z] as QuadPoint), 0.2, 2.1, whiteStone);
      // The lily tank: whitewashed retaining walls, water, railings, and the ghat.
      const TANK_X = -2;
      const TANK_Z = -14;
      for (const side of [-1, 1]) {
        addBox(group, [27, 0.9, 0.8], [TANK_X, 0.45, TANK_Z + side * 6.6], whiteStone);
        addBox(group, [0.8, 0.9, 12.4], [TANK_X + side * 13.1, 0.45, TANK_Z], whiteStone);
        addBox(group, [26.6, 0.08, 0.08], [TANK_X, 1.9, TANK_Z + side * 7.3], whiteStone);
        addBox(group, [0.08, 0.08, 14.2], [TANK_X + side * 13.8, 1.9, TANK_Z], whiteStone);
      }
      addBox(group, [25.4, 0.1, 11.6], [TANK_X, 0.32, TANK_Z], water);
      addBox(group, [30, 0.06, 18], [TANK_X, 0.14, TANK_Z], paleConcrete);
      for (let step = 0; step < 4; step++) addBox(group, [6, 0.3, 1], [TANK_X + 4, 0.75 + step * 0.3, TANK_Z + 7.4 + step], paleConcrete);
      for (let pot = 0; pot < 6; pot++) {
        addCylinder(group, 0.3, 0.22, 0.5, [TANK_X + 1.2 + (pot % 2) * 5.6, 1.15 + Math.floor(pot / 2) * 0.3, TANK_Z + 7.4 + Math.floor(pot / 2)], monumentRed, 6);
      }
      clearSite(TANK_X, TANK_Z, 17, 11);
      // Whitewashed plant houses (Camellia, Fern, Cactus and Conservatory
      // houses), each in its own clearing.
      for (const [hx, hz, w, d] of [[8, 34, 10, 6], [-14, 58, 8, 6], [-12, -60, 12, 7], [2, -92, 8, 5]] as const) {
        addBox(group, [w, 4, d], [hx, 2, hz], whiteStone);
        addBox(group, [w + 0.6, 0.35, d + 0.6], [hx, 4.15, hz], roofGrey);
        clearSite(hx, hz, w / 2 + 3, d / 2 + 3);
        solidBox(hx, hz, w / 2, d / 2, 4.4);
      }
      perchTarget = [-12, -60];
      // The closed canopy: big old crowns packed wall to wall, and tall palms.
      const rng = seededRandom(70_918);
      const canopyMats = [landmarkCanopy, landmarkCanopy, landmarkLightCanopy, landmarkCanopy, landmarkLightCanopy, landmarkCanopy, landmarkCanopy, landmarkLightCanopy, landmarkCanopy, landmarkKrishnachura];
      const open = (x: number, z: number, r: number) => (
        (Math.abs(x - TANK_X) < 14 + r * 0.5 && Math.abs(z - TANK_Z) < 8 + r * 0.5)
        || [[8, 34], [-14, 58], [-12, -60], [2, -92]].some(([hx, hz]) => Math.hypot(x - hx, z - hz) < 6 + r * 0.6)
      );
      for (let z = -114; z <= 108; z += 10.5) {
        for (let x = -30; x <= 42; x += 10.5) {
          const px = x + (rng() - 0.5) * 6;
          const pz = z + (rng() - 0.5) * 6;
          const radius = 5.4 + rng() * 2.6;
          if (!pointInPolygon(px, pz, strip) || open(px, pz, radius)) continue;
          addLandmarkTree(group, px, pz, radius, 8 + rng() * 5, canopyMats[Math.floor(rng() * canopyMats.length)]);
        }
      }
      for (const [px, pz, h] of [[10, -4, 19], [-14, -28, 17], [16, 70, 18], [-20, 20, 16]] as const) addPalm(group, px, pz, h, 0.04, px);
      // The garden is its own woodland: keep the whole strip free of city
      // blocks and of the generic park trees the DHAKA_PARKS row would add.
      clearSite(-9, -90, 19, 30);
      clearSite(1, -30, 29, 30);
      clearSite(6, 30, 34, 30);
      clearSite(11, 84, 24, 24);
    } else if (landmark.kind === "botanical-garden") {
      // National Botanical Garden, Mirpur: an 84 ha closed woodland of
      // mahogany, rain trees and palms round many ponds, which reads from the
      // air as one lumpy dark green mass. Inside it, the ≈170 m rose-garden
      // path circle on open lawn, a low dark arched shade-net orchid house, and
      // a slim concrete watch tower with an open deck above the canopy. At the
      // south, the cream-pillared gate with its flat salmon-pink cornice.
      boundsCollider = false;
      // Canopy masses: broad low domes packed edge to edge over the garden
      // lawn (DHAKA_PARKS row), kept off the map's ponds (circles that cover
      // public/dhaka-map.json water, as east/south metres from the table
      // point) and off the open rose garden.
      const PONDS: Array<[number, number, number]> = [
        [99, -315, 51], [315, -51, 33], [45, -345, 33], [-111, 153, 27], [303, -93, 27], [-297, -141, 21], [189, 261, 21],
        [291, -123, 21], [141, -261, 20], [255, 291, 20], [-291, -117, 20], [9, -273, 16], [231, 273, 16], [-105, 351, 15],
        [-87, 351, 15], [-123, 123, 15], [159, -237, 15], [213, 267, 15], [279, 303, 15], [-105, 117, 15], [-171, -123, 15],
        [171, 243, 15], [153, -339, 15], [-123, 351, 11], [333, -15, 11], [213, -75, 9], [-291, -93, 9], [3, -297, 9],
        [-279, -93, 9], [21, -291, 9], [-273, -183, 9], [-291, -165, 9], [-69, 351, 9], [141, -237, 9], [-135, 345, 9],
        [297, -15, 9], [-69, 363, 9], [-303, -165, 9], [57, -273, 9], [3, -255, 9],
      ];
      const PARK_ANGLE = 0.1;
      // Mostly deep green, a lighter crown here and there, and the odd
      // flowering krishnachura.
      const canopyMats: THREE.Material[] = [];
      for (let index = 0; index < 18; index++) canopyMats.push(index % 4 === 1 ? landmarkLightCanopy : landmarkCanopy);
      canopyMats.push(landmarkKrishnachura);
      const ORCHID: [number, number] = [-96, 40];
      const TOWER: [number, number] = [94, -42];
      // The real gate (23.816639, 90.348489) lies ≈170 m south of where this
      // lawn ends, so it stands on the lawn's south edge on the same line, as
      // east/south metres from the table point.
      const GATE: [number, number] = [3, 320];
      const rng = seededRandom(52_331);
      const SPACING = 42;
      for (let dz = -330; dz <= 330; dz += SPACING) {
        for (let dx = -440; dx <= 440; dx += SPACING) {
          const wx = dx + (rng() - 0.5) * SPACING * 0.7;
          const wz = dz + (rng() - 0.5) * SPACING * 0.7;
          const radius = 18 + rng() * 7;
          const ex = wx * Math.cos(PARK_ANGLE) + wz * Math.sin(PARK_ANGLE);
          const ez = -wx * Math.sin(PARK_ANGLE) + wz * Math.cos(PARK_ANGLE);
          if ((ex / 430) ** 2 + (ez / 322) ** 2 > 1) continue;
          if (Math.hypot(wx, wz) < 100 + radius * 0.4) continue;
          if ([ORCHID, TOWER].some(([sx, sz]) => {
            const [ox, oz] = [sx * cosH + sz * sinH, -sx * sinH + sz * cosH];
            return Math.hypot(wx - ox, wz - oz) < 18 + radius * 0.7;
          }) || Math.hypot(wx - GATE[0], wz - GATE[1]) < 30 + radius * 0.7) continue;
          if (PONDS.some(([px, pz, pr]) => Math.hypot(wx - px, wz - pz) < pr + radius * 0.75)) continue;
          const [lx, lz] = [wx * cosH - wz * sinH, wx * sinH + wz * cosH];
          const crown = new THREE.Mesh(treeCrownGeo, canopyMats[Math.floor(rng() * canopyMats.length)]);
          crown.position.set(lx, radius * 0.36, lz);
          crown.scale.set(radius, radius * (0.5 + rng() * 0.16), radius * (0.85 + rng() * 0.3));
          crown.rotation.y = rng() * Math.PI;
          group.add(crown);
        }
      }
      // The rose garden: a path circle on open lawn with low rose beds.
      const roseRing = new THREE.Mesh(new THREE.RingGeometry(82, 86, 64), paleConcrete);
      roseRing.rotation.x = -Math.PI / 2;
      roseRing.position.y = 0.16;
      group.add(roseRing);
      for (const [ringRadius, beds] of [[24, 8], [44, 12], [64, 16]] as const) {
        for (let bed = 0; bed < beds; bed++) {
          const angle = ((bed + 0.5) / beds) * Math.PI * 2;
          const rose = addBox(group, [6, 0.4, 2], [Math.sin(angle) * ringRadius, 0.2, Math.cos(angle) * ringRadius], bed % 2 ? salmon : monumentRed);
          rose.rotation.y = angle + Math.PI / 2;
        }
      }
      addCylinder(group, 7, 7, 0.5, [0, 0.25, 0], monumentRed, 18);
      addSweptBox(group, [[-84, 0.2, 0], [84, 0.2, 0]], 1.6, 0.2, paleConcrete);
      addSweptBox(group, [[0, 0.22, -84], [0, 0.22, 84]], 1.6, 0.2, paleConcrete);
      clearOval(0, 0, 88, 88);
      for (const [tx, tz] of [[30, 40], [-36, -30], [44, -48], [-50, 52], [70, 20], [-74, -12]] as const) addPalm(group, tx, tz, 11, 0.05, tx);
      // The orchid house: a low arched shade-net shed on a brick plinth.
      addBox(group, [31, 0.8, 11], [ORCHID[0], 0.4, ORCHID[1]], redBrick);
      const net = addCylinder(group, 5, 5, 30, [ORCHID[0], 0.8, ORCHID[1]], recess, 12);
      net.rotation.z = Math.PI / 2;
      net.scale.set(1, 1, 0.8);
      solidBox(ORCHID[0], ORCHID[1], 15.5, 5.5, 5);
      // The watch tower: a square shaft, an open deck with rails, a thin roof.
      addBox(group, [4, 14, 4], [TOWER[0], 7, TOWER[1]], paleConcrete);
      addBox(group, [7.4, 0.5, 7.4], [TOWER[0], 13.2, TOWER[1]], paleConcrete);
      for (const side of [-1, 1]) {
        addBox(group, [7.4, 1.1, 0.12], [TOWER[0], 14.0, TOWER[1] + side * 3.64], paleConcrete);
        addBox(group, [0.12, 1.1, 7.4], [TOWER[0] + side * 3.64, 14.0, TOWER[1]], paleConcrete);
      }
      for (const cx of [-1, 1]) for (const cz of [-1, 1]) addBox(group, [0.25, 2.6, 0.25], [TOWER[0] + cx * 3.4, 14.7, TOWER[1] + cz * 3.4], paleConcrete);
      addBox(group, [8.2, 0.3, 8.2], [TOWER[0], 16.1, TOWER[1]], paleConcrete);
      solid(TOWER[0], TOWER[1], 3.8, 16.3);
      perchTarget = [TOWER[0], TOWER[1]];
      // The main gate, its front to the south-south-east (≈160°), with the
      // brick boundary wall either side.
      const [gateX, gateZ] = [GATE[0] * cosH - GATE[1] * sinH, GATE[0] * sinH + GATE[1] * cosH];
      const gate = new THREE.Group();
      gate.position.set(gateX, 0, gateZ);
      const frontX = Math.sin((160 * Math.PI) / 180);
      const frontZ = -Math.cos((160 * Math.PI) / 180);
      gate.rotation.y = Math.atan2(frontX * cosH - frontZ * sinH, frontX * sinH + frontZ * cosH);
      group.add(gate);
      for (const side of [-1, 1]) {
        addBox(gate, [1.4, 9, 1.4], [side * 5.6, 4.5, 0], stationCream);
        addBox(gate, [1.4, 7, 1.4], [side * 9.2, 3.5, 0], stationCream);
        addBox(gate, [2.8, 1.1, 2.6], [side * 9.2, 7.4, 0], salmon);
        addBox(gate, [1.2, 5, 1.2], [side * 12.4, 2.5, 0], stationCream);
        addBox(gate, [2.4, 0.9, 2.2], [side * 12.4, 5.4, 0], salmon);
        addBox(gate, [46, 2.5, 0.5], [side * 36, 1.25, 0], redBrick);
      }
      addBox(gate, [14.6, 1.6, 2.8], [0, 9.8, 0], salmon);
      addBox(gate, [13.6, 0.4, 2.2], [0, 8.8, 0], stationCream);
      addBox(gate, [9.4, 1.4, 0.3], [0, 7.6, 0], paleConcrete);
      addBox(gate, [9.8, 3, 0.2], [0, 1.5, 0], seatGreen);
      solidBox(gateX, gateZ, 8, 2, 10.6);
      clearSite(gateX, gateZ + 8, 30, 12);
    } else if (landmark.kind === "national-zoo") {
      // Bangladesh National Zoo (Mirpur, 186.6 acres): a woodland 1.3 km
      // long between its North and South lakes (both already map water). The
      // main gate on the east is four light grey concrete pylons stepping up
      // from 8 to 13 m, banded blue and terracotta on their edges, with brown
      // sign panels between them. Inside, a paved loop path runs past rows of
      // low cage sheds, earth paddocks and the big netted walk-in aviary,
      // under dense tree canopy. Positions are OSM (relation/ways in zoo
      // dumps), in metres east (e) and north (n) of this landmark's point,
      // authored in a world-axis child group so (e, n) map to (x, -z).
      boundsCollider = false;
      const site = new THREE.Group();
      site.rotation.y = -landmark.heading;
      group.add(site);
      const plan = (e: number, n: number): [number, number] => [e * cosH + n * sinH, e * sinH - n * cosH];
      const worldBox = (e0: number, e1: number, n0: number, n1: number, boxTop: number) => {
        colliders.push({
          x: group.position.x + (e0 + e1) / 2,
          z: group.position.z - (n0 + n1) / 2,
          halfWidth: (e1 - e0) / 2,
          halfDepth: (n1 - n0) / 2,
          top: boxTop,
        });
      };
      // Ground-level work sits just above the park turf (world y ≈ 0.25).
      const GROUND = -0.55;
      // The main gate (OSM node 1813542591), facing east onto Zoo Road. From
      // outside the pylons rise left (south) to right (north).
      const GATE_E = 9;
      const GATE_N = -116;
      const pylons: Array<[number, number]> = [[-13.5, 8], [-4.5, 9.7], [4.5, 11.3], [13.5, 13]];
      pylons.forEach(([offset, height], index) => {
        const z = -(GATE_N + offset);
        addBox(site, [2.6, height, 2.2], [GATE_E, height / 2, z], paleConcrete);
        for (const face of [-1, 1]) {
          for (let band = 0; band * 1.6 < height - 0.4; band++) {
            const bandHeight = Math.min(1.6, height - band * 1.6);
            addBox(site, [0.08, bandHeight, 0.75], [GATE_E + face * 1.33, band * 1.6 + bandHeight / 2, z + 0.72], band % 2 ? terracotta : carnivalBlue);
          }
        }
        solid(...plan(GATE_E, GATE_N + offset), 1.4, height);
        if (index === pylons.length - 1) return;
        const [nextOffset] = pylons[index + 1];
        addBox(site, [0.5, 1.8, nextOffset - offset - 2.2], [GATE_E, height - 1.4, -(GATE_N + (offset + nextOffset) / 2)], landmarkBark);
      });
      // Forecourt to the end of Zoo Road, ticket kiosks and brick counters.
      addBox(site, [34, 0.2, 44], [GATE_E + 17, GROUND, -GATE_N], paleConcrete).castShadow = false;
      for (const offset of [-19, 19]) addBox(site, [5, 3.2, 4], [GATE_E + 3, 1.6, -(GATE_N + offset)], paleConcrete);
      addBox(site, [4, 3, 12], [GATE_E + 14, 1.5, -(GATE_N + 30)], terracotta);
      // The paved paths: the entry walk and the great loop (OSM 39760229, 34228796).
      const path = (points: Array<[number, number]>, width: number) => {
        for (let index = 1; index < points.length; index++) {
          const [e1, n1] = points[index - 1];
          const [e2, n2] = points[index];
          const length = Math.hypot(e2 - e1, n2 - n1);
          if (length < 0.5) continue;
          const strip = addBox(site, [length + width * 0.6, 0.2, width], [(e1 + e2) / 2, GROUND + 0.02 * (index % 2), -(n1 + n2) / 2], paleConcrete);
          strip.rotation.y = Math.atan2(n2 - n1, e2 - e1);
          strip.castShadow = false;
        }
      };
      path([[GATE_E, GATE_N], [-20, -127], [-41, -122], [-68, -114], [-85, -107], [-100, -99], [-107, -90]], 6);
      path([
        [-476, -68], [-478, -40], [-475, -22], [-471, -13], [-465, -1], [-452, 13], [-432, 27], [-417, 38], [-397, 45],
        [-362, 45], [-341, 38], [-317, 31], [-273, 31], [-249, 38], [-228, 51], [-201, 62], [-186, 77], [-175, 103],
        [-159, 129], [-142, 151], [-133, 170], [-114, 194], [-102, 201], [-82, 207], [-53, 207], [-26, 203], [-11, 192],
        [5, 175], [7, 159], [5, 140], [2, 105], [-2, 81], [-11, 39], [-21, 12], [-33, -19], [-54, -45], [-79, -68],
        [-107, -90], [-135, -106], [-170, -127], [-193, -132], [-222, -143], [-242, -152], [-273, -155], [-290, -166],
        [-304, -184], [-315, -212], [-325, -236], [-330, -256], [-330, -323], [-325, -344], [-317, -370], [-306, -407],
        [-292, -447], [-289, -474], [-289, -537], [-297, -568], [-312, -589], [-336, -606], [-385, -609], [-417, -596],
        [-435, -583], [-444, -572], [-457, -546], [-455, -511], [-455, -383], [-450, -353], [-446, -311], [-446, -227],
        [-448, -195], [-457, -158], [-465, -124], [-476, -68],
      ], 5);
      // Enclosures (OSM bounds e0, e1, n0, n1): sheds with dark mesh fronts
      // under grey roofs, earth paddocks with a low wall and a keeper's shed.
      const enclosures: Array<[number, number, number, number, "shed" | "paddock"]> = [
        [-305, -273, -439, -408, "shed"], [-284, -254, -452, -431, "shed"], [-275, -221, 87, 141, "paddock"],
        [-66, -18, 18, 44, "shed"], [-63, -34, 53, 74, "shed"], [-438, -300, -578, -515, "paddock"],
        [-487, -461, -131, -60, "paddock"], [-35, 20, 510, 605, "paddock"], [-310, -275, 74, 97, "shed"],
        [-443, -416, 28, 55, "shed"], [-467, -445, 19, 35, "shed"], [-475, -457, -8, 17, "shed"],
        [-388, -336, -384, -248, "paddock"], [-468, -335, -243, -207, "paddock"], [5, 71, 65, 213, "paddock"],
        [-242, -194, 156, 233, "paddock"], [-35, -20, 53, 75, "shed"],
      ];
      for (const [e0, e1, n0, n1, type] of enclosures) {
        const ce = (e0 + e1) / 2;
        const cn = (n0 + n1) / 2;
        const w = e1 - e0;
        const d = n1 - n0;
        if (type === "shed") {
          addBox(site, [w - 3, 3.6, d - 3], [ce, 1.8, -cn], recess);
          addBox(site, [w - 1.6, 0.4, d - 1.6], [ce, 3.8, -cn], roofGrey);
          continue;
        }
        addBox(site, [w, 0.2, d], [ce, GROUND + 0.05, -cn], packedEarth).castShadow = false;
        for (const [we, wn, ww, wd] of [[ce, n0, w, 0.6], [ce, n1, w, 0.6], [e0, cn, 0.6, d], [e1, cn, 0.6, d]] as const) {
          addBox(site, [ww, 1.4, wd], [we, 0.15, -wn], roofGrey);
        }
        addBox(site, [Math.min(14, w * 0.4), 4, 8], [e0 + Math.min(14, w * 0.4) / 2 + 2, 2, -(n1 - 6)], recess);
        addBox(site, [Math.min(14, w * 0.4) + 1.2, 0.4, 9.2], [e0 + Math.min(14, w * 0.4) / 2 + 2, 4.2, -(n1 - 6)], roofGrey);
      }
      // The netted walk-in aviary (Birds Cage, OSM 207546840): tall posts and
      // a roof net of dark steel over an 88 × 62 m bay.
      const AVIARY: [number, number, number, number] = [-408, -320, 24, 86];
      const AVIARY_TOP = 9.5;
      for (let e = AVIARY[0]; e <= AVIARY[1] + 0.1; e += 11) {
        addBox(site, [0.25, 0.25, AVIARY[3] - AVIARY[2]], [e, AVIARY_TOP, -(AVIARY[2] + AVIARY[3]) / 2], recess);
        for (const n of [AVIARY[2], AVIARY[3]]) addBox(site, [0.5, AVIARY_TOP, 0.5], [e, AVIARY_TOP / 2, -n], recess);
      }
      for (let n = AVIARY[2]; n <= AVIARY[3] + 0.1; n += 7.75) {
        addBox(site, [AVIARY[1] - AVIARY[0], 0.25, 0.25], [(AVIARY[0] + AVIARY[1]) / 2, AVIARY_TOP, -n], recess);
        for (const e of [AVIARY[0], AVIARY[1]]) addBox(site, [0.5, AVIARY_TOP, 0.5], [e, AVIARY_TOP / 2, -n], recess);
      }
      for (const [e, n] of [[-385, 40], [-352, 70], [-340, 38]] as const) {
        const crown = new THREE.Mesh(treeCrownGeo, landmarkCanopy);
        crown.position.set(e, 5.5, -n);
        crown.scale.set(6, 4, 6);
        site.add(crown);
      }
      worldBox(AVIARY[0], AVIARY[1], AVIARY[2], AVIARY[3], AVIARY_TOP + group.position.y);
      // Dense canopy: clumps of crowns placed clear of the lakes, the paths
      // and the enclosures (offline from the OSM lake and path geometry).
      const clumps: Array<[number, number, number]> = [
        [-453, -21, 9], [-249, -538, 9], [-170, -152, 14], [-327, -450, 10], [-8, 241, 10], [-257, 273, 10], [-219, -574, 12],
        [-169, -82, 13], [-37, -284, 11], [-393, -482, 9], [-66, -467, 10], [-259, -197, 13], [37, -442, 10], [-148, 178, 9],
        [-429, 128, 9], [-403, -500, 11], [-231, -49, 9], [-33, -430, 9], [33, 3, 10], [-60, -231, 10], [-82, -352, 12],
        [-439, 159, 14], [-59, 265, 11], [-35, -371, 10], [-344, -126, 10], [11, -203, 11], [15, -28, 12], [-391, -61, 13],
        [-182, -235, 12], [-64, -21, 12], [-151, -23, 12], [-27, -458, 10], [4, -438, 13], [42, -361, 14], [-268, -45, 14],
        [-204, -220, 10], [-183, -100, 9], [-428, -307, 9], [-60, -301, 10], [-344, -444, 14], [-174, 206, 9], [-139, 326, 9],
        [-238, -220, 12], [20, -304, 10], [-327, -30, 10], [-296, -599, 10], [24, -495, 13], [-249, -36, 13], [-271, -22, 12],
        [50, -216, 13], [-100, 130, 11], [45, 26, 10], [41, -255, 11], [-226, -27, 10], [-436, -149, 9], [-473, -261, 10],
        [-166, 4, 13], [-127, 225, 13], [-273, -235, 14], [-114, -43, 9], [-83, -322, 9], [-216, -169, 11], [-112, 285, 12],
        [-232, -70, 10], [2, -385, 14], [-408, -2, 14], [-217, -88, 11], [-28, -478, 14], [-164, -194, 11], [-382, -179, 14],
        [20, -470, 11], [47, -313, 12],
      ];
      clumps.forEach(([e, n, spread], index) => {
        // Spread out past the placement radius so neighbouring crowns knit.
        const radius = spread * 1.3;
        const crown = new THREE.Mesh(treeCrownGeo, landmarkCanopy);
        const lift = 6 + (index % 4) * 1.4;
        crown.position.set(e, lift + radius * 0.42, -n);
        crown.scale.set(radius, radius * 0.62, radius * (0.85 + (index % 3) * 0.1));
        crown.rotation.y = index * 0.7;
        site.add(crown);
        addCylinder(site, 0.6, 0.9, lift + 1, [e, (lift + 1) / 2 + GROUND, -n], landmarkBark, 5);
      });
      // Keep the gate forecourt clear.
      colliders.push({
        x: group.position.x + GATE_E + 18,
        z: group.position.z - GATE_N,
        halfWidth: 24,
        halfDepth: 30,
        top: LANDMARK_CLEARING_TOP,
      });
      perchTarget = plan(GATE_E, GATE_N + 13.5);
    } else if (landmark.kind === "national-museum") {
      // Bangladesh National Museum (Shahbagh, 1983): a 97 × 95 m ring of
      // four-storey fawn concrete wings round an open court, each wing roofed
      // by a row of grey barrel vaults running across it, whose half-round ends
      // make the scalloped skyline with a dark glazed lunette in each. Slim
      // pilasters every vault, two slot-window bands, and a recessed ground
      // colonnade; the pink entrance canopy faces east onto a brick forecourt,
      // and a lower block with a skylight stands in the court. Local +Z faces
      // east, +X north.
      const HALF_X = 47.5;
      const HALF_Z = 48.5;
      const WING = 18;
      const BODY = 20;
      boundsCollider = false;
      perchTarget = [3.39, HALF_Z - WING / 2];
      // East and west wings run the full 95 m; the north and south wings sit between.
      const wings: Array<{ x: number; z: number; hx: number; hz: number; acrossX: boolean }> = [
        { x: 0, z: HALF_Z - WING / 2, hx: HALF_X, hz: WING / 2, acrossX: false },
        { x: 0, z: -HALF_Z + WING / 2, hx: HALF_X, hz: WING / 2, acrossX: false },
        { x: HALF_X - WING / 2, z: 0, hx: WING / 2, hz: HALF_Z - WING, acrossX: true },
        { x: -HALF_X + WING / 2, z: 0, hx: WING / 2, hz: HALF_Z - WING, acrossX: true },
      ];
      for (const wing of wings) {
        // Upper floors over a ground storey set back behind the pilasters.
        addBox(group, [wing.hx * 2, BODY - 4.5, wing.hz * 2], [wing.x, 4.5 + (BODY - 4.5) / 2, wing.z], canopyBeige);
        addBox(group, [wing.hx * 2 - 4, 4.6, wing.hz * 2 - 4], [wing.x, 2.3, wing.z], canopyBeige);
        solidBox(wing.x, wing.z, wing.hx, wing.hz, BODY + 3.4);
        // The vaults run across the wing (along its short side), repeated along it.
        const length = wing.acrossX ? wing.hz * 2 : wing.hx * 2;
        const count = Math.round(length / 6.7);
        const span = length / count;
        const depth = wing.acrossX ? wing.hx * 2 : wing.hz * 2;
        const vault = new THREE.CylinderGeometry(span / 2 - 0.08, span / 2 - 0.08, depth + 0.6, 8, 1, false, -Math.PI / 2, Math.PI);
        vault.rotateX(-Math.PI / 2);
        const lunette = new THREE.CircleGeometry(span / 2 - 0.9, 8, 0, Math.PI);
        for (let index = 0; index < count; index++) {
          const along = -length / 2 + span * (index + 0.5);
          const mesh = new THREE.Mesh(vault, boardConcrete);
          mesh.position.set(wing.acrossX ? wing.x : along, BODY, wing.acrossX ? along : wing.z);
          mesh.rotation.y = wing.acrossX ? Math.PI / 2 : 0;
          group.add(mesh);
          // A dark lunette in each vault end on the outer face.
          const outward = wing.acrossX ? Math.sign(wing.x) : Math.sign(wing.z);
          const pane = new THREE.Mesh(lunette, archDark);
          pane.rotation.set(0, wing.acrossX ? (outward > 0 ? Math.PI / 2 : -Math.PI / 2) : (outward > 0 ? 0 : Math.PI), 0);
          const face = (wing.acrossX ? HALF_X : HALF_Z) + 0.36;
          pane.position.set(wing.acrossX ? outward * face : along, BODY + 0.15, wing.acrossX ? along : outward * face);
          group.add(pane);
        }
      }
      // Outer facades: a pilaster under every vault joint, and two slot-window bands.
      const facades: Array<{ axis: "x" | "z"; sign: number; half: number; length: number }> = [
        { axis: "z", sign: 1, half: HALF_Z, length: HALF_X * 2 },
        { axis: "z", sign: -1, half: HALF_Z, length: HALF_X * 2 },
        { axis: "x", sign: 1, half: HALF_X, length: HALF_Z * 2 },
        { axis: "x", sign: -1, half: HALF_X, length: HALF_Z * 2 },
      ];
      for (const facade of facades) {
        const pilasters = Math.round(facade.length / 6.7);
        // The north and south faces leave their corner pilasters to the east and west faces.
        for (let index = facade.axis === "x" ? 1 : 0; index <= (facade.axis === "x" ? pilasters - 1 : pilasters); index++) {
          const along = -facade.length / 2 + (facade.length / pilasters) * index;
          const [x, z] = facade.axis === "z" ? [along, facade.sign * (facade.half + 0.25)] : [facade.sign * (facade.half + 0.25), along];
          addBox(group, [0.7, BODY, 0.7], [x, BODY / 2, z], canopyBeige);
        }
        for (const y of [11, 15]) {
          const [x, z] = facade.axis === "z" ? [0, facade.sign * (facade.half + 0.04)] : [facade.sign * (facade.half + 0.04), 0];
          addBox(group, facade.axis === "z" ? [facade.length - 2, 0.9, 0.1] : [0.1, 0.9, facade.length - 2], [x, y, z], archDark);
        }
      }
      // The block in the court: a squat octagon with a flat roof and a skylight.
      const core = addCylinder(group, 1, 1, 17, [0, 8.5, 0], canopyBeige, 8);
      core.scale.set(18, 1, 27);
      const skylight = addCone(group, 13, 3, [0, 18.5, 0], boardConcrete, 4);
      skylight.rotation.y = Math.PI / 4;
      solidBox(0, 0, 18, 27, 18.4);
      // East entrance: the flat pink canopy, the statue and the brick forecourt.
      addBox(group, [18, 0.7, 5.5], [0, 4.6, HALF_Z + 2.6], pink);
      addBox(group, [18.4, 1.3, 0.3], [0, 5.4, HALF_Z + 5.3], pink);
      for (const x of [-8, 8]) addBox(group, [0.6, 4.3, 0.6], [x, 2.15, HALF_Z + 5], canopyBeige);
      addBox(group, [2.2, 1.6, 2.2], [0, 0.8, HALF_Z + 11], canopyBeige);
      addCylinder(group, 0.45, 0.55, 3.4, [0, 3.3, HALF_Z + 11], boardConcrete, 6);
      addBox(group, [44, 0.12, 34], [0, 0.06, HALF_Z + 17], plazaBrick).castShadow = false;
      for (const [tx, tz, mat] of [
        [-30, HALF_Z + 12, landmarkCanopy],
        [30, HALF_Z + 12, landmarkLightCanopy],
        [-30, HALF_Z + 26, landmarkLightCanopy],
        [30, HALF_Z + 26, landmarkCanopy],
      ] as const) {
        addLandmarkTree(group, tx, tz, 5.2, 6.4, mat);
      }
      clearSite(0, 0, HALF_X - WING, HALF_Z - WING);
      clearSite(0, HALF_Z + 17, 24, 18);
    } else if (landmark.kind === "liberation-museum") {
      // Liberation War Museum (Agargaon): a monolithic board-marked grey
      // concrete box whose nearly blank upper floors cantilever over a dark,
      // recessed ground floor. Short dark steel "war-scar" rods stick out of the
      // main face at angles; red Bengali lettering runs high on it; a long
      // canopy on round columns shelters the entrance with a fighter jet hung
      // under it; a row of white flagpoles lines the roof; a glazed bridge with
      // steel X-trusses projects on the right over a lower wing. Behind a sunken
      // court stands the bulkier rear block (OSM 499002486). Local +Z is the
      // front (ENE, unconfirmed), +X is the right-hand side seen from the front.
      const TOP = 24;
      colliderTop = TOP;
      perchTarget = [-4, 6];
      // Forecourt paving and the main bar (OSM 478326295, 63 × 19 m).
      addBox(group, [76, 0.3, 18], [4, 0.15, 18], paleConcrete).castShadow = false;
      addBox(group, [59, 8, 15.6], [0, 4, -1.6], ribbonGlass);
      addBox(group, [58, 2, 0.2], [0, 2.2, 6.25], atriumGlass);
      addBox(group, [62.6, TOP - 8, 20.4], [0, 8 + (TOP - 8) / 2, 0.8], boardConcrete);
      addBox(group, [62.6, 1, 2], [0, TOP - 0.5, 11], boardConcrete);
      // Board-mark joints: faint horizontal lines every 1.2 m on the front.
      for (let y = 9.2; y < TOP - 1; y += 2.4) addBox(group, [62.4, 0.08, 0.06], [0, y, 11.02], roofGrey);
      // The war-scar rods, staggered across the upper face.
      for (let row = 0; row < 4; row++) {
        for (let column = 0; column < 6; column++) {
          const x = -26 + column * 10 + (row % 2) * 5;
          if (x > 28) continue;
          const rod = addBox(group, [3, 0.28, 0.5], [x, 11 + row * 3.2, 11.2], recess);
          rod.rotation.z = ((row + column) % 3 === 0 ? -1 : 1) * 0.55;
          rod.rotation.y = 0.35;
        }
      }
      addBox(group, [17, 2.6, 0.2], [-15, TOP - 3.6, 11.08], monumentRed);
      // Entrance canopy beam on round columns, red lettering on its fascia, and
      // the suspended fighter.
      addBox(group, [42, 1.1, 8], [-6, 8.2, 14.6], boardConcrete);
      addBox(group, [16, 0.6, 0.12], [-12, 8.2, 18.65], monumentRed);
      for (let x = -24; x <= 12; x += 9) addCylinder(group, 0.45, 0.45, 7.7, [x, 3.85, 17.4], boardConcrete, 8);
      const jet = new THREE.Group();
      jet.position.set(-4, 5.4, 14.4);
      group.add(jet);
      addCylinder(jet, 0.55, 0.75, 9, [0, 0, 0], roofGrey, 6).rotation.z = Math.PI / 2;
      addCone(jet, 0.55, 2.4, [-5.7, 0, 0], roofGrey, 6).rotation.z = Math.PI / 2;
      const wing = new THREE.Shape();
      wing.moveTo(-1.5, 0);
      wing.lineTo(3, 4.4);
      wing.lineTo(3.6, 4.4);
      wing.lineTo(3.4, -4.4);
      wing.lineTo(3, -4.4);
      wing.lineTo(-1.5, 0);
      const wingMesh = new THREE.Mesh(new THREE.ShapeGeometry(wing, 1), roofGrey);
      wingMesh.rotation.x = -Math.PI / 2;
      jet.add(wingMesh);
      addBox(jet, [1.6, 2, 0.15], [3.6, 1.1, 0], roofGrey);
      // Roof flagpoles.
      for (let x = -27; x <= 27; x += 6) addCylinder(group, 0.1, 0.14, 10, [x, TOP + 5, 9.6], whiteStone, 4);
      // Right side: the lower wing and the glazed truss bridge above it.
      addBox(group, [16, 9, 12], [39, 4.5, -6], boardConcrete);
      addBox(group, [20, 7, 9], [41, 12.5, 3], ribbonGlass);
      addBox(group, [21, 0.8, 9.6], [41, 16.4, 3], boardConcrete);
      addBox(group, [21, 0.8, 9.6], [41, 8.6, 3], boardConcrete);
      for (let bay = 0; bay < 3; bay++) {
        for (const sign of [-1, 1]) {
          const truss = addBox(group, [8.4, 0.35, 0.35], [34.3 + bay * 6.7, 12.5, 7.7], roofGrey);
          truss.rotation.z = sign * 0.78;
        }
      }
      // The rear block across the sunken court.
      addBox(group, [60, 18, 40], [0, 9, -36.5], boardConcrete);
      addBox(group, [56, 0.2, 36], [0, 18.1, -36.5], roofGrey);
      addBox(group, [61, 3, 41], [0, 1.5, -36.5], ribbonGlass);
      solid(-14, -36, 16, 18);
      solid(14, -36, 16, 18);
      solid(41, 0, 9, 17);
      clearSite(4, -18, 38, 46);
    } else if (landmark.kind === "military-museum") {
      // Bangabandhu Military Museum (Bijoy Sarani, 2022): a long, almost
      // windowless hall clad in white stone tiles, its roofline sloping up to
      // sharp prow corners, with two triangulated geodesic glass domes set
      // into it: the big one (Ø 24 m) opens north onto a turquoise reflecting
      // pool with a fountain ring, the small one (Ø 15 m) sits between the
      // hall and the round west annex. A deep stone canopy shelters the
      // entrance east of the big dome, with seating steps down to the pool;
      // an open-air amphitheatre lies south. Plan from OSM 1317835190/91/92/93
      // (relation 18084981) and pool way 1317835195, in metres east (e) and
      // north (n) of the hall centroid. Authored in a world-axis child group
      // so (e, n) map straight to (x, -z). Novo Theatre, 190 m east, is its
      // own landmark.
      boundsCollider = false;
      const site = new THREE.Group();
      site.rotation.y = -landmark.heading;
      group.add(site);
      const plan = (e: number, n: number): [number, number] => [e * cosH + n * sinH, e * sinH - n * cosH];
      const worldBox = (e0: number, e1: number, n0: number, n1: number, boxTop: number) => {
        colliders.push({
          x: group.position.x + (e0 + e1) / 2,
          z: group.position.z - (n0 + n1) / 2,
          halfWidth: (e1 - e0) / 2,
          halfDepth: (n1 - n0) / 2,
          top: boxTop + group.position.y,
        });
      };
      // Extrude an (e, n) outline and lift its roof by `roof(e, n)`, so the
      // parapet slopes and the hall reads as tilted stone planes.
      const stoneMass = (outline: Array<[number, number]>, roof: (e: number, n: number) => number) => {
        const shape = new THREE.Shape();
        outline.forEach(([e, n], index) => (index ? shape.lineTo(e, n) : shape.moveTo(e, n)));
        const geometry = new THREE.ExtrudeGeometry(shape, { depth: 1, bevelEnabled: false, curveSegments: 1 });
        geometry.rotateX(-Math.PI / 2);
        const position = geometry.getAttribute("position");
        for (let index = 0; index < position.count; index++) {
          if (position.getY(index) > 0.5) position.setY(index, roof(position.getX(index), -position.getZ(index)));
        }
        geometry.computeVertexNormals();
        const mesh = new THREE.Mesh(geometry, whiteStone);
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        site.add(mesh);
      };
      const ramp = (value: number, from: number, to: number) => clamp((value - from) / (to - from), 0, 1);
      // The hall, with the big dome's footprint cut out of its north side.
      stoneMass([
        [-60.1, 3.3], [-55.5, 9.7], [-57.5, 10.9], [-55.7, 21.1], [-52.7, 20.4], [-53.8, 23.2], [-43.8, 31.8], [-37.7, 25.2],
        [-40.7, 22.6], [-42.7, 19.3], [-43.6, 15.5], [-43.2, 11.7], [-41.6, 8.1], [-39, 5.2], [-35.6, 3.3], [-31.8, 2.5],
        [-27.9, 3], [-24.3, 4.7], [-21.5, 7.4], [-19.7, 10.8], [-19, 14.6], [-19.3, 17.6], [-10.4, 17.6], [-2.9, 18.1],
        [9.5, 18.3], [15.3, 18.5], [22.9, 17.8], [30, 16.7], [36.9, 15.2], [41.8, 14.2], [57, 10.2], [66.5, 5.8], [75.6, 1.5],
        [70.6, -6.3], [76.2, -15.8], [61.9, -25.1], [57.8, -19], [55, -15.3], [49.8, -11.6], [42.4, -22.5], [40.3, -20.6],
        [37.4, -19.2], [34.3, -18.8], [28.2, -18.1], [19.6, -18.1], [14.1, -18.6], [7.2, -20.7], [-0.5, -21.5], [-9.7, -22.5],
        [-18.7, -21.3], [-24.5, -19.7], [-27.4, -17.9], [-29, -17], [-30.1, -14.8], [-31.9, -13], [-33.7, -12.1],
        [-35.7, -11.8], [-37.6, -11.9], [-40.2, -10], [-49.2, -4.5],
      ], (e, n) => 15 + 5.5 * ramp(e, 30, 76) + 4 * ramp(-e, 50, 60) * ramp(n, 0, 28) + 1.5 * ramp(-n, 10, 22) * ramp(e, 30, 60)
        // The walls stoop round the big dome so its glass crown stands clear.
        - 4 * (1 - ramp(Math.hypot(e + 31.3, n - 14.8), 13, 26)));
      // The round west annex, cut round the small dome.
      stoneMass([
        [-49.9, -7], [-51.1, -10.3], [-50.7, -15.8], [-50.4, -21.8], [-48.5, -27.6], [-46.1, -32.1], [-42.2, -36.4],
        [-37.5, -40.3], [-34.4, -40.9], [-31.2, -40.7], [-26.9, -39], [-24.4, -36.2], [-23, -32.7], [-21.7, -29.7],
        [-21.3, -26.3], [-21.8, -23.2], [-22.7, -20.8], [-24.5, -19.7], [-27.4, -17.9], [-29, -17], [-28.7, -19.2],
        [-29, -21.4], [-30, -23.4], [-31.5, -25], [-33.5, -26.1], [-35.6, -26.6], [-37.9, -26.4], [-40, -25.6],
        [-41.7, -24.2], [-43, -22.3], [-43.6, -20.2], [-43.5, -18], [-42.8, -15.8], [-41.5, -14], [-40.2, -10], [-49.2, -4.5],
      ], (_e, n) => 8.5 + 3.5 * ramp(-n, 27, 40));
      // The two geodesic domes.
      addGeodesicDome(site, -31.3, -14.8, 12.4, 14, 3, skyGlass, geodesicFrame);
      addGeodesicDome(site, -36.2, 19.2, 7.6, 10, 2, skyGlass, geodesicFrame);
      // Entrance: a deep stone canopy over a dark glazed lobby east of the dome.
      addBox(site, [24, 1.4, 9], [-6, 8.3, -22.2], whiteStone);
      addBox(site, [22, 7.6, 0.4], [-6, 3.8, -18.4], recess);
      for (const e of [-15, 3]) addBox(site, [0.8, 7.6, 0.8], [e, 3.8, -26], whiteStone);
      // The reflecting pool (OSM 1317835195): turquoise water inside a dark
      // granite rim, a fountain ring in the middle, seating steps to the east.
      const pool: Array<[number, number]> = [[-40.5, 31.6], [-33.5, 78.8], [7.7, 72], [-2.2, 19.5]];
      const poolShape = new THREE.Shape();
      pool.forEach(([e, n], index) => (index ? poolShape.lineTo(e, n) : poolShape.moveTo(e, n)));
      const poolGeometry = new THREE.ShapeGeometry(poolShape);
      poolGeometry.rotateX(-Math.PI / 2);
      const poolMesh = new THREE.Mesh(poolGeometry, poolTurquoise);
      poolMesh.position.y = 0.45;
      site.add(poolMesh);
      pool.forEach(([ae, an], index) => {
        const [be, bn] = pool[(index + 1) % pool.length];
        addBeam(site, [ae, 0.45, -an], [be, 0.45, -bn], 1.3, 1, recess, 1.3);
      });
      for (let jet = 0; jet < 12; jet++) {
        const angle = (jet / 12) * Math.PI * 2;
        const cone = addCone(site, 0.4, 5.5, [-16.5 + Math.sin(angle) * 4.5, 3.2, -49 + Math.cos(angle) * 4.5], whiteStone, 5);
        cone.rotation.set(Math.cos(angle) * 0.2, 0, -Math.sin(angle) * 0.2);
      }
      addCone(site, 0.7, 8.5, [-16.5, 4.7, -49], whiteStone, 6);
      // Seating steps along the pool's east side, rising away from the water.
      const stepsRun = Math.hypot(9.9, 52.5);
      const steps = new THREE.Group();
      steps.position.set(2.75, 0, -45.75);
      steps.rotation.y = Math.atan2(52.5, 9.9);
      site.add(steps);
      for (let step = 0; step < 5; step++) addBox(steps, [stepsRun - 6, 0.35 * (step + 1), 1.6], [0, 0.175 * (step + 1), 2.2 + step * 1.6], paleConcrete);
      // Plaza paving between the hall, the pool and Bijoy Sarani.
      addBox(site, [70, 0.12, 62], [-12, 0.06, -52], paleConcrete).castShadow = false;
      // The amphitheatre to the south: stone tiers facing a round stage.
      for (let tier = 0; tier < 5; tier++) {
        const tierMesh = addArcSlab(site, 9 + tier * 4.4, 13.4 + tier * 4.4, Math.PI - 0.95, 1.9, 0, 0.5 * (tier + 1), paleConcrete, 14);
        tierMesh.position.set(9, 0, 88);
      }
      addCylinder(site, 8, 8, 0.6, [9, 0.3, 88], paleConcrete, 18);
      // Mature trees of the old museum grounds.
      for (const [e, n, radius, crown] of [
        [92, 26, 6.4, landmarkCanopy], [126, -8, 6, landmarkCanopy], [95, -60, 6.6, landmarkCanopy], [130, 34, 5.6, landmarkCanopy],
        [-72, -30, 6.2, landmarkCanopy], [-76, 12, 5.8, landmarkCanopy], [42, -48, 5.6, landmarkCanopy], [62, -62, 6, landmarkCanopy],
        [-62, -52, 6.2, landmarkCanopy], [118, -62, 5.8, landmarkCanopy], [36, 38, 5.4, landmarkCanopy], [58, 34, 5.8, landmarkCanopy],
      ] as const) {
        addLandmarkTree(site, e, -n, radius, 8, crown);
      }
      worldBox(-60, -43, -10, 32, 18);
      worldBox(-43, -20, -12, 3, 13);
      worldBox(-20, 42, -22, 18.5, 17);
      worldBox(42, 76, -25, 14, 20.5);
      worldBox(-51, -21, -41, -27, 12);
      worldBox(-23, 11, 18, 27, 9);
      solid(...plan(-31.3, 14.8), 9, 14);
      solid(...plan(-36.2, -19.2), 6, 10);
      // Keep the pool, the plaza and the amphitheatre free of city blocks.
      const clearWorld = (e0: number, e1: number, n0: number, n1: number) => colliders.push({
        x: group.position.x + (e0 + e1) / 2,
        z: group.position.z - (n0 + n1) / 2,
        halfWidth: (e1 - e0) / 2,
        halfDepth: (n1 - n0) / 2,
        top: LANDMARK_CLEARING_TOP,
      });
      clearWorld(-48, 24, 18, 86);
      clearWorld(-18, 36, -100, -50);
      colliderTop = 17;
      perchTarget = plan(-31.3, 14.8);
    } else if (landmark.kind === "science-museum") {
      // National Museum of Science and Technology, Agargaon: long, plain
      // 1980s concrete exhibition halls on OSM's real outline (way 370071885),
      // repainted deep teal with white aluminium trim, and a taller five-storey
      // admin block over the flat entrance portico. On the front lawn an F-6
      // fighter stands on a plinth beside a ring of solar-system planets.
      const HALLS = 370071885;
      const halls = anchor(HALLS);
      const local = partOutline(HALLS);
      // Local +Z of the frame is the long (114 m) axis, toward the ESE front.
      const deck = frame(HALLS, [0.259, 0.966]);
      if (halls && local && deck) {
        const ring = local.map(([x, z]) => [x + halls.x, z + halls.z] as MapPoint);
        const g = deck.g;
        const turn = g.rotation.y;
        const toGroup = (lx: number, lz: number): [number, number] => [
          g.position.x + lx * Math.cos(turn) + lz * Math.sin(turn),
          g.position.z - lx * Math.sin(turn) + lz * Math.cos(turn),
        ];
        const HALL_TOP = halls.height;
        // White trim: a plinth course, a band at the upper floor, the parapet.
        slab(HALLS, 0, 0.9, 1.01, whiteStone);
        slab(HALLS, 6.6, 0.5, 1.012, whiteStone);
        slab(HALLS, HALL_TOP, 1.1, 1.012, whiteStone);
        slab(HALLS, HALL_TOP + 1.1, 0.08, 0.97, roofGrey);
        // Narrow punched windows in rows along the long walls.
        addBays(group, walls(HALLS), {
          bay: 6.5, minEdge: 9, margin: 2,
          storeys: [{ y: 2.4, opening: rectPane(1.6, 2.4) }, { y: 8.2, opening: rectPane(1.6, 1.8) }],
          opening: ribbonGlass,
        });
        // The five-storey admin block, teal with white floor bands.
        const ADMIN_TOP = 21;
        addBox(g, [21, ADMIN_TOP, 14], [0, ADMIN_TOP / 2, 11], tealArch);
        addBox(g, [21.8, 1.2, 14.8], [0, ADMIN_TOP + 0.6, 11], whiteStone);
        for (const y of [HALL_TOP + 4.2, HALL_TOP + 8.4]) addBox(g, [21.4, 0.35, 14.4], [0, y, 11], whiteStone);
        for (let floor = 0; floor < 3; floor++) {
          for (const lx of [-7.5, -4.5, -1.5, 1.5, 4.5, 7.5]) {
            const pane = new THREE.Mesh(rectPane(1.5, 1.6), ribbonGlass);
            pane.position.set(lx, HALL_TOP + 2 + floor * 3, 18.08);
            g.add(pane);
          }
        }
        // Amber sign band, then the flat portico canopy on four columns.
        addBox(g, [14, 1.8, 0.3], [0, HALL_TOP + 0.4, 18.1], terracotta);
        addBox(g, [14, 0.6, 9], [0, 5.4, 22.5], whiteStone);
        for (const lx of [-6, 6]) for (const lz of [20, 26]) addCylinder(g, 0.35, 0.35, 5.1, [lx, 2.55, lz], whiteStone, 8);
        // A small observatory dome on the admin roof.
        addCylinder(g, 2.6, 2.6, 1.6, [5, ADMIN_TOP + 2, 9], whiteStone, 14);
        addLathe(g, domeProfile(2.6, 2.4, 0, 6), 14, [5, ADMIN_TOP + 2.8, 9], silverPanel);
        // F-6 fighter on its plinth.
        const jet = new THREE.Group();
        jet.position.set(-20, 0, 73);
        jet.rotation.y = 0.6;
        g.add(jet);
        addBox(jet, [3, 2.2, 3], [0, 1.1, 0], whiteStone);
        const fuselage = addCylinder(jet, 0.55, 0.8, 12.5, [0, 3.4, 0], silverPanel, 8);
        fuselage.rotation.x = Math.PI / 2;
        addCone(jet, 0.55, 1.6, [0, 3.4, 7.05], silverPanel, 8).rotation.x = Math.PI / 2;
        for (const side of [-1, 1]) {
          const wing = addBox(jet, [4.4, 0.18, 2.8], [side * 2.6, 3.2, -0.6], silverPanel);
          wing.rotation.y = side * 0.5;
          const tailplane = addBox(jet, [1.8, 0.14, 1.3], [side * 1.2, 3.5, -5.5], silverPanel);
          tailplane.rotation.y = side * 0.45;
        }
        const fin = addBox(jet, [0.16, 2.4, 2], [0, 4.8, -5.2], silverPanel);
        fin.rotation.x = -0.35;
        // The solar-system garden: the sun and its planets in a ring.
        addBox(g, [26, 0.12, 26], [16, 0.06, 66], lawn);
        addCylinder(g, 1.4, 1.4, 0.4, [16, 0.32, 66], whiteStone, 12);
        const sun = new THREE.Mesh(new THREE.SphereGeometry(1.5, 10, 8), accent);
        sun.position.set(16, 2.1, 66);
        g.add(sun);
        const planetMats = [silverPanel, terracotta, whiteStone, terracotta, accent, silverPanel, whiteStone, tealArch];
        planetMats.forEach((mat, index) => {
          const angle = index * 0.8;
          const radius = 3.6 + index * 1.05;
          const size = [0.35, 0.55, 0.6, 0.45, 1.1, 0.95, 0.75, 0.7][index];
          const planet = new THREE.Mesh(new THREE.SphereGeometry(size, 8, 6), mat);
          planet.position.set(16 + Math.sin(angle) * radius, 0.9 + size, 66 + Math.cos(angle) * radius);
          g.add(planet);
        });
        // Flagpoles along the entrance drive, and palms on the lawn.
        const flagMats = [terracotta, accent, whiteStone, terracotta, accent, whiteStone];
        for (let index = 0; index < 6; index++) {
          addCylinder(g, 0.08, 0.1, 7, [-6 - index * 4.5, 3.5, 44], whiteStone, 5);
          addBox(g, [0.06, 1.1, 1.6], [-6 - index * 4.5, 6.3, 44.8], flagMats[index]);
        }
        for (const [lx, lz] of [[-36, 50], [-28, 58], [34, 52], [38, 74], [-40, 70]] as const) addPalm(g, lx, lz, 9, 0.06, lx);
        // Collision follows the real outline rather than its diagonal bounds.
        boundsCollider = false;
        for (let lx = -deck.hx + 5; lx < deck.hx; lx += 10) {
          for (let lz = -deck.hz + 5; lz < deck.hz; lz += 10) {
            const [x, z] = toGroup(lx, lz);
            if (pointInPolygon(x, z, ring)) solid(x, z, 5.4, HALL_TOP + 1.1);
          }
        }
        const [adminX, adminZ] = toGroup(0, 11);
        solidBox(adminX, adminZ, 10, 10, ADMIN_TOP + 1.2);
        perchTarget = [adminX - 3, adminZ + 2];
        // Keep the front lawn and drive open.
        const [lawnX, lawnZ] = toGroup(0, 66);
        clearSite(lawnX, lawnZ, 46, 46);
      }
    } else if (landmark.kind === "shishu-park") {
      // Shaheed Zia Shishu Park, Shahbag: closed since 2019 and being rebuilt.
      // Inside green hoarding, a wide pale concrete promenade runs N–S between
      // bare parterres, sweeping out at its north end in a curved band to two
      // round plazas, with two more plazas at its south end; the old round
      // brick plaza survives under the trees to the west, and site sheds line
      // the east side. Local axes are world axes (heading 0).
      boundsCollider = false;
      const SPINE_X = 9;
      addBox(group, [32, 0.3, 186], [SPINE_X, 0.15, 0], paleConcrete);
      addBox(group, [10, 0.08, 186], [SPINE_X, 0.34, 0], whiteStone);
      for (const z of [-60, -20, 20, 60]) addBox(group, [32.4, 0.06, 1], [SPINE_X, 0.33, z], whiteStone);
      // Bare earth parterres either side of the spine.
      addBox(group, [26, 0.22, 48], [41, 0.11, -50], packedEarth);
      addBox(group, [26, 0.22, 62], [41, 0.11, 22], packedEarth);
      addBox(group, [18, 0.22, 58], [-19, 0.11, 18], packedEarth);
      // The curved north band and its round plazas, and the two south plazas.
      addSweptBox(group, [[-54, 0.3, -96], [-40, 0.3, -94], [-22, 0.3, -92], [-4, 0.3, -91], [26, 0.3, -91], [50, 0.3, -90]], 7, 0.3, paleConcrete);
      addSweptBox(group, [[-8, 0.3, 84], [-8, 0.3, 72]], 6, 0.3, paleConcrete);
      addSweptBox(group, [[26, 0.3, 84], [44, 0.3, 74], [56, 0.3, 66]], 6, 0.3, paleConcrete);
      for (const [px, pz] of [[-58, -98], [54, -90], [-8, 62], [56, 60]] as const) {
        addCylinder(group, 10.5, 10.5, 0.36, [px, 0.18, pz], paleConcrete, 24);
        addCylinder(group, 8.4, 8.4, 0.1, [px, 0.4, pz], whiteStone, 24);
        addCylinder(group, 3.2, 3.4, 0.7, [px, 0.5, pz], lawn, 12);
      }
      // The old round brick plaza in the wooded west.
      addCylinder(group, 14, 14, 0.3, [-54, 0.15, -69], plazaBrick, 24);
      addCylinder(group, 6, 6, 0.9, [-54, 0.45, -69], carnivalBlue, 16);
      // Site sheds and the site office along the east side.
      for (const [sx, sz, len] of [[72, -52, 24], [74, -16, 18], [70, 18, 26]] as const) {
        addBox(group, [9, 3.6, len], [sx, 1.8, sz], whiteStone);
        addBox(group, [9.8, 0.3, len + 0.8], [sx, 3.75, sz], carnivalBlue);
        solidBox(sx, sz, 5, len / 2, 4);
      }
      addBox(group, [12, 7, 9], [62, 3.5, 44], cream);
      addBox(group, [12.8, 0.4, 9.8], [62, 7.2, 44], carnivalBlue);
      solidBox(62, 44, 6.4, 4.9, 7.4);
      perchTarget = [62, 44];
      // Green corrugated hoarding round the site, just inside the park lawn
      // and pulled back from the road along its NE edge.
      const ROAD_A = [-40, -137] as const;
      const ROAD_B = [162, -33] as const;
      const roadLength = Math.hypot(ROAD_B[0] - ROAD_A[0], ROAD_B[1] - ROAD_A[1]);
      const inX = -(ROAD_B[1] - ROAD_A[1]) / roadLength;
      const inZ = (ROAD_B[0] - ROAD_A[0]) / roadLength;
      const hoarding: QuadPoint[] = [];
      for (let step = 0; step <= 40; step++) {
        const angle = (step / 40) * Math.PI * 2;
        let hx = Math.cos(angle) * 170;
        let hz = Math.sin(angle) * 116;
        const inside = (hx - ROAD_A[0]) * inX + (hz - ROAD_A[1]) * inZ;
        if (inside < -6) {
          hx += inX * (-6 - inside);
          hz += inZ * (-6 - inside);
        }
        hoarding.push([hx, 2.4, hz]);
      }
      addSweptBox(group, hoarding, 0.12, 2.4, seatGreen);
      // Keep the paving and the plazas clear of park trees.
      clearSite(SPINE_X, 0, 17, 94);
      clearSite(-4, -94, 66, 14);
      clearSite(24, 66, 42, 18);
      clearSite(-54, -69, 15, 15);
      clearSite(41, -14, 14, 62);
      clearSite(-19, 18, 10, 30);
    } else if (landmark.kind === "novo-theatre") {
      // Bangabandhu Sheikh Mujibur Rahman Novo Theatre (planetarium, Bijoy
      // Sarani): a 34 m pale sky-blue geodesic glass dome rising from plaza
      // level behind a grand stair, ringed on its front half by a white steel
      // space-frame. Two white wings flank it, their deep roof slabs carried on
      // rows of tall silver columns along the slanted fronts; the east wing's
      // roof tilts up into a sharp prow. A red-brick forecourt with two long
      // reflecting pools runs north to the road. Local +Z is north (the front),
      // local +X is west. Plan from OSM 264634214 (dome-centred metres).
      const PODIUM = 11;
      colliderTop = PODIUM;
      // Podium wings, with the dome's front bulge cut back so the glass shows
      // down to the stair landing.
      const outline: Array<[number, number]> = [
        [-39, 1], [-42, -2], [-43, -4], [-41, -8], [-39, -9], [-38, -31], [-33, -34], [-16, -34], [-32, -50],
        [-23, -59], [26, -57], [35, -47], [19, -32], [35, -32], [40, -28], [39, -6], [42, -4], [43, 0],
        [39, 3], [38, 25], [19, 6], [16, 3], [-18, 3], [-21, 5], [-40, 23],
      ];
      const podiumShape = new THREE.Shape();
      outline.forEach(([x, z], index) => (index ? podiumShape.lineTo(x, -z) : podiumShape.moveTo(x, -z)));
      const podiumGeometry = new THREE.ExtrudeGeometry(podiumShape, { depth: PODIUM, bevelEnabled: false, curveSegments: 1 });
      podiumGeometry.rotateX(-Math.PI / 2);
      group.add(new THREE.Mesh(podiumGeometry, whiteStone));
      // Curtain glass on the slanted wing fronts, set behind the colonnades.
      for (const side of [-1, 1]) {
        // Each wing front runs from beside the dome out to the wing's prow
        // corner; the group's +Z is the outward face, toward the forecourt.
        const front = new THREE.Group();
        const length = Math.hypot(19, 19);
        front.position.set(side * 29, 0, 14.5);
        front.rotation.y = (-side * Math.PI) / 4;
        group.add(front);
        addBox(front, [length - 3, PODIUM - 2.5, 0.3], [0, (PODIUM - 2.5) / 2 + 1.5, 0.2], ribbonGlass);
        for (let column = 0; column < 7; column++) {
          const along = -length / 2 + 2 + (column * (length - 4)) / 6;
          addCylinder(front, 0.8, 0.8, 13.2, [along, 6.6, 5.2], silverPanel, 10);
        }
        // Deep roof slab cantilevered past the colonnade. On the east wing
        // (side -1, outer end toward front-local -X) the outer 16 m tilts up
        // into the wedge prow.
        const roof = new THREE.Group();
        roof.position.set(0, 13.6, -6);
        front.add(roof);
        if (side > 0) {
          addBox(roof, [length + 10, 1.1, 30], [0, 0, 0], whiteStone);
        } else {
          const flat = length + 10 - 16;
          addBox(roof, [flat, 1.1, 30], [(length + 10) / 2 - flat / 2, 0, 0], whiteStone);
          const wedge = addBox(roof, [16.4, 1.1, 30], [-(length + 10) / 2 + 8, 2.75, 0], whiteStone);
          wedge.rotation.z = -0.35;
        }
      }
      // The dome: 0.8 of a sphere (r 17, centre 14 m up) faceted like the
      // geodesic glass, springing from the stair landing.
      const domeProfileGeo: Array<[number, number]> = [];
      for (let step = 0; step <= 9; step++) {
        const angle = -0.63 + (step / 9) * (Math.PI / 2 + 0.63);
        domeProfileGeo.push([Math.max(0.01, 17 * Math.cos(angle)), 17 * Math.sin(angle)]);
      }
      addLathe(group, domeProfileGeo, 18, [0, 14, 0], skyGlass, true);
      addCylinder(group, 1.2, 1.2, 0.6, [0, 31.2, 0], whiteStone, 8);
      // White space-frame ring round the front 200°, on slim columns.
      addArcSlab(group, 18, 22, -1.75, 3.5, 15.4, 1.2, whiteStone, 20);
      for (let column = 0; column < 7; column++) {
        const theta = -1.6 + (column * 3.2) / 6;
        addCylinder(group, 0.5, 0.5, 15.4, [Math.sin(theta) * 20, 7.7, Math.cos(theta) * 20], silverPanel, 6);
      }
      // Stair landing under the dome and the grand stair down to the plaza.
      addBox(group, [42, 4, 14], [0, 2, 10], paleConcrete);
      for (let step = 0; step < 10; step++) {
        const stepTop = 4 - (step + 1) * 0.4;
        addBox(group, [42, stepTop + 0.02, 1.3], [0, (stepTop + 0.02) / 2, 17.65 + step * 1.3], paleConcrete);
      }
      // Forecourt: red brick paving, two long pools in brick rims, lawn strips.
      addBox(group, [96, 0.12, 52], [0, 0.06, 56], plazaBrick).castShadow = false;
      for (const side of [-1, 1]) {
        addBox(group, [30, 0.5, 9], [side * 22, 0.25, 46], plazaBrick);
        addBox(group, [28.6, 0.12, 7.6], [side * 22, 0.48, 46], water);
        addBox(group, [36, 0.3, 6], [side * 27, 0.15, 74], lawn);
      }
      solid(0, 0, 14, 31.5);
      solid(-14, -46, 14, PODIUM);
      solid(14, -46, 14, PODIUM);
      clearSite(0, 12, 58, 72);
    } else if (landmark.kind === "dhaka-medical") {
      // Dhaka Medical College Hospital: the long white colonial spine (OSM
      // 1036301057, bearing 138°) with tall round-arched verandahs on its NE
      // front, a projecting entrance block crowned by a drum-and-dome, square
      // end towers (the SE one domed) and a toothed parapet. The NE forecourt
      // is lawn and trees round two oval drive loops. Footprint mode: local axes
      // are world axes, so a child group turned to the facade carries the
      // entrance, dome and towers.
      const MAIN = 1036301057;
      const mass = anchor(MAIN);
      const points = (() => {
        const ring = partOutlines.get(MAIN);
        return ring ? ring.map(([x, z]) => [x - group.position.x, z - group.position.z] as MapPoint) : [];
      })();
      if (mass && points.length) {
        const H = mass.height;
        // Facade frame: +Z faces the NE forecourt (48°), +X runs NW along the spine.
        const FRONT: [number, number] = [0.743, -0.669];
        const along: [number, number] = [-0.669, -0.743];
        const edges = walls(MAIN);
        const front = edges.filter((edge) => edge.nx * FRONT[0] + edge.nz * FRONT[1] > 0.85);
        const others = edges.filter((edge) => edge.nx * FRONT[0] + edge.nz * FRONT[1] <= 0.85);
        // Two storeys of tall round-headed verandah arches on the front wings.
        addBays(group, front, {
          bay: 4.5, minEdge: 6,
          storeys: [
            { y: 1.3, opening: roundArch(3.1, 6.4) },
            { y: 9.2, opening: roundArch(3.1, 6.0) },
          ],
          opening: archDark,
          pier: { width: 1.1, depth: 0.7, bottom: 0, top: H - 0.9, material: whiteStone },
        });
        // Rows of arched windows round the rest of the block.
        addBays(group, others, {
          bay: 4.6, minEdge: 5,
          storeys: [
            { y: 2.2, opening: rectPane(1.6, 2.8) },
            { y: 7.8, opening: rectPane(1.6, 2.8) },
            { y: 13.2, opening: rectPane(1.6, 2.6) },
          ],
          opening: archDark,
        });
        slab(MAIN, 0, 1.3, 1.012, paleConcrete);
        slab(MAIN, 8.2, 0.5, 1.012, paleConcrete);
        slab(MAIN, H - 0.9, 0.9, 1.024, paleConcrete);
        slab(MAIN, H, 1.1, 1.006, whiteStone);
        slab(MAIN, H + 1.1, 0.08, 0.965, roofTerrace);
        // The toothed parapet: a merlon every 3.4 m on every roof edge.
        for (const edge of edges) {
          const count = Math.floor(edge.length / 3.4);
          for (let index = 0; index < count; index++) {
            const t = (index + 0.5) * (edge.length / count);
            const merlon = addBox(group, [0.8, 0.9, 0.45], [
              edge.ax + edge.dx * t - edge.nx * 0.25,
              H + 1.55,
              edge.az + edge.dz * t - edge.nz * 0.25,
            ], whiteStone);
            merlon.rotation.y = edge.rotationY;
          }
        }
        const facade = (x: number, z: number) => {
          const g = new THREE.Group();
          g.position.set(x, 0, z);
          g.rotation.y = Math.atan2(FRONT[0], FRONT[1]);
          group.add(g);
          return g;
        };
        // Entrance block, 24 m wide and 8 m proud of the front at the bend in
        // the facade, rising to 20 m, with the big arched carriage porch.
        const [bendX, bendZ] = toLocal(23.7257547, 90.3982249);
        const entrance = facade(bendX, bendZ);
        addBox(entrance, [24, 20, 12], [0, 10, 2], whiteStone);
        addBox(entrance, [24.8, 0.9, 12.8], [0, 19.6, 2], paleConcrete);
        addBox(entrance, [24.8, 1.2, 12.8], [0, 0.6, 2], paleConcrete);
        addBox(entrance, [12, 3, 2], [0, 21.2, 7.2], whiteStone);
        addBox(entrance, [25, 0.6, 0.6], [0, 13.6, 8.3], paleConcrete);
        for (const x of [-10.5, -7.5, 7.5, 10.5, -3.5, -1.2, 1.2, 3.5]) {
          for (const z of [7.95]) {
            const merlon = addBox(entrance, [0.8, 0.9, 0.4], [x, 20.5, z], whiteStone);
            merlon.castShadow = false;
          }
        }
        const porch = new THREE.Mesh(roundArch(6, 7.4), archDark);
        porch.position.set(0, 0.6, 8.08);
        entrance.add(porch);
        for (const x of [-8.5, -4.5, 4.5, 8.5]) {
          const pane = new THREE.Mesh(roundArch(1.6, 3), archDark);
          pane.position.set(x, 14.6, 8.08);
          entrance.add(pane);
          const lower = new THREE.Mesh(roundArch(1.8, 3.6), archDark);
          lower.position.set(x, 3.2, 8.08);
          entrance.add(lower);
        }
        // Drum and dome on the spine behind the entrance (12 m back from the
        // front wall): a square base, an arcaded octagonal drum, a white dome.
        const dome = facade(bendX - FRONT[0] * 12, bendZ - FRONT[1] * 12);
        addBox(dome, [13, 2.4, 13], [0, H + 1.2, 0], whiteStone);
        addBox(dome, [13.8, 0.5, 13.8], [0, H + 2.6, 0], paleConcrete);
        addCylinder(dome, 5.2, 5.4, 3.2, [0, H + 4.4, 0], whiteStone, 8).rotation.y = Math.PI / 8;
        for (let side = 0; side < 8; side++) {
          const angle = (side / 8) * Math.PI * 2;
          const opening = new THREE.Mesh(roundArch(1.3, 2.2), archDark);
          opening.position.set(Math.sin(angle) * 5.05, H + 3.2, Math.cos(angle) * 5.05);
          opening.rotation.y = angle;
          dome.add(opening);
        }
        addCylinder(dome, 5.8, 5.8, 0.5, [0, H + 6.25, 0], paleConcrete, 16);
        addLathe(dome, domeProfile(5, 5, 0.04, 8), 16, [0, H + 6.5, 0], whiteStone);
        addFinial(dome, [0, H + 11.3, 0], 0.7, whiteStone);
        // Square end towers on the front corners of the spine, 5 m over the
        // parapet; the SE one carries a small dome.
        for (const [t, domed] of [[-62, false], [62, true]] as const) {
          const tower = facade(
            bendX - FRONT[0] * 6 + along[0] * -t,
            bendZ - FRONT[1] * 6 + along[1] * -t,
          );
          addBox(tower, [9, H + 5, 9], [0, (H + 5) / 2, 0], whiteStone);
          addBox(tower, [9.8, 0.7, 9.8], [0, H + 4.2, 0], paleConcrete);
          for (const x of [-3.3, -1.1, 1.1, 3.3]) {
            for (const [dx, dz, ry] of [[x, 4.7, 0], [x, -4.7, 0], [4.7, x, Math.PI / 2], [-4.7, x, Math.PI / 2]] as const) {
              addBox(tower, [0.8, 0.9, 0.4], [dx, H + 5.45, dz], whiteStone).rotation.y = ry;
            }
          }
          for (const side of [0, Math.PI / 2, Math.PI, -Math.PI / 2]) {
            const opening = new THREE.Mesh(roundArch(1.4, 2.6), archDark);
            opening.position.set(Math.sin(side) * 4.62, H + 0.6, Math.cos(side) * 4.62);
            opening.rotation.y = side;
            tower.add(opening);
          }
          if (domed) {
            addCylinder(tower, 3.2, 3.3, 1.6, [0, H + 5.8, 0], whiteStone, 8);
            addLathe(tower, domeProfile(3.1, 3.2, 0.04, 7), 12, [0, H + 6.6, 0], whiteStone);
            addFinial(tower, [0, H + 9.7, 0], 0.5, whiteStone);
          }
          solid(tower.position.x, tower.position.z, 4.5, H + (domed ? 10 : 5.9));
        }
        // NE forecourt: lawn, two oval drive loops and shade trees, kept clear
        // of generic blocks.
        const court = facade(bendX + FRONT[0] * 30, bendZ + FRONT[1] * 30);
        addBox(court, [120, 0.12, 50], [6, 0.06, 4], lawn).castShadow = false;
        for (const x of [-26, 34]) {
          const loop = addArcSlab(court, 9, 12.5, 0, Math.PI * 2, 0.12, 0.1, roofGrey, 28);
          loop.position.x = x;
          loop.scale.set(1.9, 1, 1);
          loop.castShadow = false;
          addLandmarkTree(court, x - 6, 0, 3.6, 4.8, landmarkLightCanopy);
          addLandmarkTree(court, x + 6, 0, 3.4, 4.6, landmarkLightCanopy);
        }
        addBox(court, [10, 0.1, 22], [4, 0.14, -12], roofGrey).castShadow = false;
        for (let index = 0; index < 9; index++) {
          addPalm(court, -48 + index * 13, 20, 10 + (index % 3), 0.06, index * 0.7);
        }
        // Clear the forecourt (its world AABB) of generic blocks and park trees.
        clearSite(court.position.x, court.position.z, 46, 46);
        clearSite(court.position.x + along[0] * 40, court.position.z + along[1] * 40, 26, 26);
        clearSite(court.position.x - along[0] * 40, court.position.z - along[1] * 40, 26, 26);
        // Collision: the bounding box of this L-shaped plan would cover the
        // forecourt and the neighbouring hospital blocks, so the masses are
        // tiled with runs of 8 m cells instead.
        boundsCollider = false;
        const insidePlan = (x: number, z: number) => {
          let inside = false;
          for (let index = 0, prev = points.length - 1; index < points.length; prev = index++) {
            const [ax, az] = points[index];
            const [bx, bz] = points[prev];
            if ((az > z) !== (bz > z) && x < ax + ((z - az) * (bx - ax)) / (bz - az)) inside = !inside;
          }
          return inside;
        };
        const CELL = 8;
        for (let z = -mass.depth / 2 + CELL / 2; z < mass.depth / 2; z += CELL) {
          let runStart: number | null = null;
          for (let x = -mass.width / 2 + CELL / 2; x < mass.width / 2 + CELL; x += CELL) {
            // A cell counts when any part of it (centre or a corner) is under
            // the plan, so the diagonal spine leaves no open slivers.
            const filled = x < mass.width / 2 && [[0, 0], [-1, -1], [1, -1], [-1, 1], [1, 1]].some(([cx, cz]) => (
              insidePlan(x + mass.x + (cx * CELL) / 2, z + mass.z + (cz * CELL) / 2)
            ));
            if (filled && runStart === null) runStart = x;
            if (!filled && runStart !== null) {
              const runEnd = x - CELL;
              solidBox(mass.x + (runStart + runEnd) / 2, mass.z + z, (runEnd - runStart) / 2 + CELL / 2, CELL / 2, H + 1.2);
              runStart = null;
            }
          }
        }
        solid(dome.position.x, dome.position.z, 6.5, H + 12);
        solid(entrance.position.x + FRONT[0] * 2, entrance.position.z + FRONT[1] * 2, 7, 21);
        colliderTop = H + 1.2;
        perchTarget = [dome.position.x, dome.position.z];
      }
    } else if (landmark.kind === "sher-e-bangla-stadium") {
      // Sher-e-Bangla National Cricket Stadium, Mirpur: an oval two-tier bowl
      // of green and grey seats split by a white concourse band, a cream back
      // wall, white barrel-vault canopies over the WSW side and NNW end, six
      // floodlight masts, and a striped oval outfield with a tan pitch strip
      // on the 152° axis. Outer ring OSM 121390579 (196 × 249 m), outfield
      // OSM 121390580. Local +Z is the long axis toward 152° (SSE), +X is ENE.
      const STRETCH = 1.3; // the bowl is a circle stretched along local Z
      colliderTop = 1;
      const bowl = new THREE.Group();
      bowl.scale.set(1, 1, STRETCH);
      group.add(bowl);
      const SECTORS = 16;
      const sectorLength = (Math.PI * 2) / SECTORS;
      const ring = (profile: Array<[number, number]>, phiStart: number, phiLength: number, material: THREE.Material, segments = 2) => {
        const mesh = new THREE.Mesh(
          new THREE.LatheGeometry(profile.map(([r, y]) => new THREE.Vector2(r, y)), segments, phiStart, phiLength),
          material,
        );
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        bowl.add(mesh);
        return mesh;
      };
      for (let sector = 0; sector < SECTORS; sector++) {
        const phi = sector * sectorLength;
        // Profiles run so each face looks toward the field or the sky.
        ring([[84, 9], [77, 4.6], [71, 1.3]], phi, sectorLength, sector % 2 ? plantGrey : seatGreen);
        ring([[96, 20], [90, 15.5], [84, 11]], phi, sectorLength, sector % 4 === 1 ? plantGrey : seatGreen);
      }
      ring([[84, 11], [84, 9]], 0, Math.PI * 2, whiteStone, 32);
      ring([[71, 1.3], [70, 1.3], [70, 0]], 0, Math.PI * 2, whiteStone, 32);
      ring([[98.5, 0], [98.5, 22.5], [96, 22.5], [96, 20]], 0, Math.PI * 2, paleConcrete, 32);
      // A row of dark openings round the outside of the back wall.
      for (let index = 0; index < 48; index++) {
        const phi = (index / 48) * Math.PI * 2;
        const opening = addBox(bowl, [4.4, 2.2, 0.3], [Math.sin(phi) * 98.6, 17.5, Math.cos(phi) * 98.6], plantGrey);
        opening.rotation.y = phi;
        opening.castShadow = false;
      }
      // Outfield: an oval of mown grass with lighter stripes, the square and
      // its tan pitch strip down the long axis.
      const field = new THREE.Mesh(new THREE.CircleGeometry(70, 40), lawn);
      field.rotation.x = -Math.PI / 2;
      field.position.y = 0.1;
      field.receiveShadow = true;
      bowl.add(field);
      for (let band = -6; band <= 6; band += 2) {
        const z = band * 7.4;
        const halfWidth = Math.sqrt(Math.max(0, 69.5 ** 2 - (z / 0.98) ** 2)) * 0.995;
        addBox(bowl, [halfWidth * 2, 0.06, 7.4], [0, 0.16, z], landmarkLightCanopy).castShadow = false;
      }
      addBox(group, [3.2, 0.1, 22], [0, 0.24, 0], packedEarth).castShadow = false;
      addBox(group, [9, 0.06, 26], [0, 0.2, 0], landmarkLightCanopy).castShadow = false;
      // Point on the outer ellipse (radius r before stretching) at angle phi.
      const onOval = (r: number, phi: number): [number, number] => [Math.sin(phi) * r, Math.cos(phi) * r * STRETCH];
      // Tensile canopies: white barrel-vault bays over the WSW long side
      // (local -X) and round the NNW end (local -Z), tilting up to the field.
      const vault = new THREE.CylinderGeometry(5.6, 5.6, 10.5, 6, 1, true, Math.PI / 2, Math.PI);
      const CANOPY_FROM = Math.PI * 0.62;
      const CANOPY_TO = Math.PI * 1.72;
      const BAYS = 22;
      for (let bay = 0; bay < BAYS; bay++) {
        const phi = CANOPY_FROM + ((bay + 0.5) / BAYS) * (CANOPY_TO - CANOPY_FROM);
        const [x, z] = onOval(91, phi);
        const [ix, iz] = onOval(85, phi);
        const holder = new THREE.Group();
        holder.position.set(x, 24.2, z);
        holder.rotation.y = Math.atan2(ix - x, iz - z);
        group.add(holder);
        const shell = new THREE.Mesh(vault, whiteStone);
        shell.rotation.set(Math.PI / 2 - 0.16, 0, 0);
        shell.scale.set(1, 1, 0.28);
        shell.castShadow = true;
        holder.add(shell);
        addCylinder(holder, 0.22, 0.22, 7, [5.5, 1.6, -4], whiteStone, 5);
        addCylinder(holder, 0.35, 0.4, 4.5, [5.5, -2.1, -5.2], plantGrey, 5);
      }
      // Six floodlight masts on an oval 20 m outside the bowl, each with a
      // lamp frame tipped toward the centre.
      let northMast: [number, number] = [0, 0];
      for (let mast = 0; mast < 6; mast++) {
        const phi = Math.PI / 6 + (mast * Math.PI) / 3;
        const [x, z] = [Math.sin(phi) * 118, Math.cos(phi) * 150];
        addCylinder(group, 0.7, 1.3, 50, [x, 25, z], plantGrey, 6);
        const head = new THREE.Group();
        head.position.set(x, 50, z);
        head.rotation.y = Math.atan2(-x, -z);
        group.add(head);
        const lamps = addBox(head, [10, 6, 1], [0, 2, 0.6], whiteStone);
        lamps.rotation.x = 0.45;
        addBox(head, [10.4, 0.5, 2.2], [0, -0.9, 0], plantGrey);
        solid(x, z, 5.5, 52);
        if (Math.abs(phi - (5 * Math.PI) / 6) < 0.01) northMast = [x, z];
      }
      // Pale-yellow four-storey club house built into the SSE end.
      addBox(group, [60, 14, 13], [0, 7, 130], peach);
      addBox(group, [61, 0.8, 14], [0, 14.4, 130], paleConcrete);
      for (let floor = 0; floor < 4; floor++) {
        addBox(group, [56, 1.3, 0.3], [0, 2.4 + floor * 3.3, 136.6], plantGrey).castShadow = false;
      }
      // The stands are struck as a ring of columns; the field stays open so the
      // bird can drop into the bowl. The perch is the north mast's lamp frame.
      // 48 columns on the upper tier's mid line overlap all round the ring
      // and reach from the tier's inner lip to the back wall.
      for (let index = 0; index < 56; index++) {
        const [x, z] = onOval(92, (index / 56) * Math.PI * 2);
        solid(x, z, 11, 22.5);
      }
      // The club house at the SSE end.
      solidBox(0, 130, 31, 7.5, 14.8);
      clearOval(0, 0, 105, 105 * STRETCH, 14);
      perchTarget = northMast;
    } else if (landmark.kind === "zia-udyan") {
      // Zia Udyan (Chandrima Udyan): Ziaur Rahman's mausoleum, a white marble
      // square with four corner wall blocks, a round dark pool holding two
      // grass-topped graves and a green glass pyramid on a white frame, set
      // diagonally. A red-brick axis walk runs south to the grey tied-arch
      // footbridge over Crescent Lake, on Kahn's Parliament axis (355°).
      // Local +Z points south (175°) toward the bridge; the lake (map water,
      // OSM 438559926) spans local z ≈ 133–187 on the axis.
      colliderTop = 8;
      addBox(group, [46, 0.6, 46], [0, 0.3, 0], marble).castShadow = false;
      // The grave pool: a white ring walk, a black granite pool and two
      // grass-topped marble graves side by side, long axis north–south.
      addCylinder(group, 11.5, 11.5, 0.2, [0, 0.7, 0], whiteStone, 32).castShadow = false;
      addCylinder(group, 7.2, 7.2, 0.24, [0, 0.74, 0], recess, 28).castShadow = false;
      addCylinder(group, 6.7, 6.7, 0.1, [0, 0.84, 0], water, 28).castShadow = false;
      for (const x of [-1.7, 1.7]) {
        addBox(group, [2.3, 1.0, 5.6], [x, 1.2, 0], whiteStone);
        addBox(group, [2.0, 0.1, 5.2], [x, 1.75, 0], lawn).castShadow = false;
      }
      for (let strip = 0; strip < 24; strip++) {
        const angle = (strip / 24) * Math.PI * 2;
        const radial = addBox(group, [0.35, 0.06, 3.4], [Math.sin(angle) * 9.4, 0.82, Math.cos(angle) * 9.4], marble);
        radial.rotation.y = angle;
        radial.castShadow = false;
      }
      // Four corner wall blocks with black granite panels on their inner faces.
      for (const sx of [-1, 1]) {
        for (const sz of [-1, 1]) {
          addBox(group, [12, 7.4, 12], [sx * 15, 4.3, sz * 15], whiteStone);
          addBox(group, [12.6, 0.5, 12.6], [sx * 15, 8.2, sz * 15], marble);
          addBox(group, [6, 4, 0.2], [sx * 15, 4, sz * 8.9], recess);
          addBox(group, [0.2, 4, 6], [sx * 8.9, 4, sz * 15], recess);
        }
      }
      // The pyramid: 26 m square in plan, turned 45° to the plaza (so a cone
      // of four sides has its corners on the axes), eaves 11 m, apex 17.5 m,
      // with white frame edges and paired struts down to the wall blocks.
      const EAVE = 11;
      const APEX = 17.5;
      const CORNER = 18.4;
      addCone(group, CORNER, APEX - EAVE, [0, (EAVE + APEX) / 2, 0], atriumGlass, 4);
      for (let corner = 0; corner < 4; corner++) {
        const angle = (corner * Math.PI) / 2;
        const [cx, cz] = [Math.sin(angle) * CORNER, Math.cos(angle) * CORNER];
        const [nx, nz] = [Math.sin(angle + Math.PI / 2) * CORNER, Math.cos(angle + Math.PI / 2) * CORNER];
        // Eave beam to the next corner, and the hip up to the apex.
        const eave = addBox(group, [0.55, 0.55, Math.hypot(nx - cx, nz - cz)], [(cx + nx) / 2, EAVE, (cz + nz) / 2], whiteStone);
        eave.rotation.y = Math.atan2(nx - cx, nz - cz);
        const hip = new THREE.Group();
        hip.position.set(cx / 2, (EAVE + APEX) / 2, cz / 2);
        hip.rotation.y = Math.atan2(cx, cz);
        group.add(hip);
        addBox(hip, [0.5, 0.5, Math.hypot(CORNER, APEX - EAVE) + 0.3], [0, 0, 0], whiteStone).rotation.x = Math.atan2(APEX - EAVE, CORNER);
        // A strut from each neighbouring wall block's inner corner.
        for (const side of [-1, 1]) {
          const tx = Math.sin(angle) * 9.5 + Math.sin(angle + (side * Math.PI) / 2) * 9.5;
          const tz = Math.cos(angle) * 9.5 + Math.cos(angle + (side * Math.PI) / 2) * 9.5;
          addBeam(group, [tx, 8.4, tz], [cx * 0.97, EAVE - 0.2, cz * 0.97], 0.8, 0.8, whiteStone);
        }
      }
      // The red-brick axis walk south to the bridge, lined with clipped
      // shrub balls, and the bridge itself on the same line.
      const BRIDGE: [number, number] = [-6, 160];
      const axis = new THREE.Group();
      axis.rotation.y = Math.atan2(BRIDGE[0], BRIDGE[1]);
      group.add(axis);
      const WALK_FROM = 23;
      const WALK_TO = 131;
      addBox(axis, [10, 0.14, WALK_TO - WALK_FROM], [0, 0.07, (WALK_FROM + WALK_TO) / 2], plazaBrick).castShadow = false;
      for (let z = WALK_FROM + 4; z < WALK_TO - 2; z += 9) {
        for (const side of [-1, 1]) {
          const shrub = new THREE.Mesh(treeCrownGeo, lawn);
          shrub.position.set(side * 6.4, 1.0, z);
          shrub.scale.set(1.3, 1.0, 1.3);
          shrub.castShadow = true;
          axis.add(shrub);
        }
      }
      // Tied-arch footbridge: a 5 m deck about 1.6 m above the water, two grey
      // concrete box ribs rising 8 m and leaning outward, a white zig-zag of
      // hangers and white cross ties at the crown. Brick landings on both banks.
      const bridge = new THREE.Group();
      bridge.position.set(0, 0, Math.hypot(BRIDGE[0], BRIDGE[1]));
      axis.add(bridge);
      const SPAN = 58;
      const DECK = 1.2;
      const RISE = 8;
      addBox(bridge, [5.2, 0.6, SPAN + 4], [0, DECK - 0.3, 0], concrete);
      // The north landing steps down into the walk; the south one meets the
      // lakeside road (local +Z) directly.
      addBox(bridge, [14, DECK, 7], [0, DECK / 2, -(SPAN / 2 + 3.5)], plazaBrick);
      addBox(bridge, [16, 0.5, 2.5], [0, 0.25, -(SPAN / 2 + 8.2)], plazaBrick);
      addBox(bridge, [10, DECK, 3], [0, DECK / 2, SPAN / 2 + 1.5], plazaBrick);
      const ribPoint = (t: number, side: number): [number, number, number] => {
        const z = -SPAN / 2 + t * SPAN;
        const lift = RISE * (1 - ((2 * t - 1) ** 2));
        return [side * (3.1 + lift * 0.17), DECK + lift, z];
      };
      const strutBetween = (a: [number, number, number], b: [number, number, number], thickness: [number, number], material: THREE.Material) => (
        addBeam(bridge, a, b, thickness[0], thickness[1], material, 0.2)
      );
      const RIB_STEPS = 12;
      for (const side of [-1, 1]) {
        for (let step = 0; step < RIB_STEPS; step++) {
          strutBetween(ribPoint(step / RIB_STEPS, side), ribPoint((step + 1) / RIB_STEPS, side), [0.9, 1.4], concrete);
        }
        const HANGERS = 14;
        for (let index = 0; index < HANGERS; index++) {
          const t0 = (index + 0.15) / (HANGERS + 0.3);
          const t1 = (index + 0.65) / (HANGERS + 0.3);
          const t2 = (index + 1.15) / (HANGERS + 0.3);
          const deckA: [number, number, number] = [side * 2.5, DECK, -SPAN / 2 + t0 * SPAN];
          const deckB: [number, number, number] = [side * 2.5, DECK, -SPAN / 2 + t2 * SPAN];
          const rib = ribPoint(t1, side);
          rib[1] -= 0.6;
          if (rib[1] - DECK < 1.2) continue;
          strutBetween(deckA, rib, [0.22, 0.22], whiteStone);
          strutBetween(rib, deckB, [0.22, 0.22], whiteStone);
        }
      }
      for (const t of [0.42, 0.5, 0.58]) {
        const [x, y, z] = ribPoint(t, 1);
        strutBetween([-x, y - 0.3, z], [x, y - 0.3, z], [0.4, 0.4], whiteStone);
      }
      // Keep generic blocks and park trees off the plaza, the walk and the
      // landings; strike the canopy, the wall blocks and the arch crown.
      clearSite(0, 0, 26, 26);
      clearSite(BRIDGE[0] / 2, (WALK_FROM + WALK_TO) / 2, 9, (WALK_TO - WALK_FROM) / 2 + 2);
      solid(0, 0, 13, APEX);
      solid(BRIDGE[0], BRIDGE[1], 3.5, DECK + RISE + 0.8);
      solidBox(BRIDGE[0], BRIDGE[1], 4, 31, DECK);
      perchTarget = [0.01, 0];
    } else if (landmark.kind === "sat-gambuj-mosque") {
      // Sat Gambuj (Seven-Domed) Mosque, Mohammadpur (Mughal, c. 1680): a
      // salmon-pink limewashed prayer hall with three weathered bulbous domes
      // in a north–south row and four two-storey octagonal corner kiosks under
      // ribbed domes, on a raised plinth with a gate on the east axis and the
      // Eidgah lawn beyond. OSM 1560283156 is 15.7 × 22.6 m; built at 1.5× so it
      // reads beside the madrasa blocks. Local +Z faces east (89°), +X north.
      const S = 1.5;
      const PLINTH = 2.6;
      const WALL = 7.5;
      const m = new THREE.Group();
      m.scale.setScalar(S);
      group.add(m);
      colliderTop = (PLINTH + WALL) * S;
      // Plinth with its east terrace, steps and the gate pavilion.
      addBox(m, [26, PLINTH, 22], [0, PLINTH / 2, 3], concrete);
      addBox(m, [26.4, 0.35, 22.4], [0, PLINTH - 0.12, 3], concrete);
      addBox(m, [26.5, 0.5, 22.5], [0, PLINTH - 0.7, 3], brickTrim);
      for (let step = 0; step < 4; step++) {
        addBox(m, [6, PLINTH - step * 0.62, 1], [0, (PLINTH - step * 0.62) / 2, 14.5 + step], concrete);
      }
      addBox(m, [5, 4.6, 3], [0, PLINTH + 2.3, 12], salmon);
      solidBox(0, 12 * S, 2.5 * S, 1.5 * S, (PLINTH + 5.9) * S);
      addBox(m, [5.6, 0.7, 3.4], [0, PLINTH + 4.9, 12], brickTrim);
      for (const x of [-2.3, -1.15, 0, 1.15, 2.3]) addBox(m, [0.5, 0.6, 0.3], [x, PLINTH + 5.55, 13.5], brickTrim);
      for (const z of [10.48, 13.52]) {
        const gate = new THREE.Mesh(pointedArch(2.2, 3.4), archDark);
        gate.position.set(0, PLINTH, z);
        if (z < 12) gate.rotation.y = Math.PI;
        m.add(gate);
      }
      // Prayer hall: 17.7 m north–south by 8.2 m, crenellated parapet.
      const HALL_X = 17.7;
      const HALL_Z = 8.2;
      addBox(m, [HALL_X, WALL, HALL_Z], [0, PLINTH + WALL / 2, 0], salmon);
      addBox(m, [HALL_X + 0.4, 0.5, HALL_Z + 0.4], [0, PLINTH + WALL - 0.9, 0], brickTrim);
      addBox(m, [HALL_X + 0.3, 0.7, HALL_Z + 0.3], [0, PLINTH + 0.35, 0], brickTrim);
      for (let x = -HALL_X / 2 + 0.6; x <= HALL_X / 2 - 0.5; x += 1.15) {
        for (const z of [-HALL_Z / 2 + 0.15, HALL_Z / 2 - 0.15]) addBox(m, [0.55, 0.6, 0.3], [x, PLINTH + WALL + 0.3, z], brickTrim);
      }
      for (let z = -HALL_Z / 2 + 0.7; z <= HALL_Z / 2 - 0.6; z += 1.15) {
        for (const x of [-HALL_X / 2 + 0.15, HALL_X / 2 - 0.15]) addBox(m, [0.3, 0.6, 0.55], [x, PLINTH + WALL + 0.3, z], brickTrim);
      }
      // East facade: three pointed doorways in recessed frames (the middle one
      // larger) between shallow blind-arch panels; blind arches on the back.
      for (const [x, width, height] of [[-5.5, 1.9, 3.6], [0, 2.4, 4.4], [5.5, 1.9, 3.6]] as const) {
        addBox(m, [width + 1.4, height + 1.6, 0.25], [x, PLINTH + (height + 1.6) / 2, HALL_Z / 2 + 0.1], brickTrim);
        const door = new THREE.Mesh(pointedArch(width, height), archDark);
        door.position.set(x, PLINTH + 0.2, HALL_Z / 2 + 0.26);
        m.add(door);
      }
      for (const x of [-7.6, -3.2, 3.2, 7.6]) {
        for (const [z, ry] of [[HALL_Z / 2 + 0.06, 0], [-HALL_Z / 2 - 0.06, Math.PI]] as const) {
          for (const y of [1.2, 4.4]) {
            const blind = new THREE.Mesh(pointedArch(1.3, 2.4), brickTrim);
            blind.position.set(x, PLINTH + y, z);
            blind.rotation.y = ry;
            m.add(blind);
          }
        }
      }
      // Three bulbous domes on short octagonal drums with merlon rings.
      const roof = PLINTH + WALL;
      for (const [x, radius, rise] of [[-5.5, 2.5, 3.4], [0, 3.0, 4.3], [5.5, 2.5, 3.4]] as const) {
        addCylinder(m, radius + 0.15, radius + 0.25, 1.1, [x, roof + 0.55, 0], salmon, 8);
        addCylinder(m, radius + 0.35, radius + 0.35, 0.4, [x, roof + 1.25, 0], brickTrim, 8);
        addLathe(m, domeProfile(radius, rise, 0.1, 9), 12, [x, roof + 1.4, 0], terracotta);
        addFinial(m, [x, roof + 1.25 + rise, 0], radius * 0.28, terracotta);
        solid(x * S, 0, radius * S, (roof + 1.4 + rise) * S);
      }
      // Four hollow two-storey octagonal kiosks at the corners, projecting
      // past the walls, with arched openings, a cornice, a merlon ring and a
      // ribbed dome.
      const KIOSK = 2.15;
      const KIOSK_TOP = 9.2;
      for (const sx of [-1, 1]) {
        for (const sz of [-1, 1]) {
          const [x, z] = [sx * (HALL_X / 2 + 0.6), sz * (HALL_Z / 2 + 0.6)];
          addCylinder(m, KIOSK, KIOSK, KIOSK_TOP, [x, PLINTH + KIOSK_TOP / 2, z], salmon, 8).rotation.y = Math.PI / 8;
          addCylinder(m, KIOSK + 0.35, KIOSK + 0.2, 0.45, [x, PLINTH + 5.4, z], brickTrim, 8).rotation.y = Math.PI / 8;
          addCylinder(m, KIOSK + 0.2, KIOSK + 0.2, 0.7, [x, PLINTH + KIOSK_TOP + 0.35, z], brickTrim, 8).rotation.y = Math.PI / 8;
          for (let face = 0; face < 8; face++) {
            const angle = (face / 8) * Math.PI * 2;
            for (const [y, h] of [[1.2, 2.8], [6.2, 2.2]] as const) {
              const opening = new THREE.Mesh(pointedArch(0.95, h), archDark);
              opening.position.set(x + Math.sin(angle) * (KIOSK * 0.93 + 0.05), PLINTH + y, z + Math.cos(angle) * (KIOSK * 0.93 + 0.05));
              opening.rotation.y = angle;
              m.add(opening);
            }
          }
          addLathe(m, domeProfile(1.8, 2.5, 0.08, 7), 8, [x, PLINTH + KIOSK_TOP + 0.7, z], terracotta, true);
          addFinial(m, [x, PLINTH + KIOSK_TOP + 3.1, z], 0.38, terracotta);
          solid(x * S, z * S, KIOSK * S, (PLINTH + KIOSK_TOP + 3.3) * S);
        }
      }
      // The Eidgah lawn east of the gate, kept open.
      addBox(group, [60, 0.12, 78], [0, 0.06, 72], lawn).castShadow = false;
      clearSite(0, 4, 21, 19);
      clearSite(0, 70, 31, 40);
      perchTarget = [0.01, 0];
    } else if (landmark.kind === "dhakeshwari-temple") {
      // Dhakeshwari National Temple: the postcard row of four identical Shiva
      // temples (OSM 989231329–332), cream-peach cellas under curvilinear
      // rekha spires banded in bright red, facing SSW across a brick
      // courtyard with two lawns; the main shrine with its squat banded dome
      // facing east into the flat-roofed nat-mandir pavilion; the long
      // red-roofed halls at the south tip; a cream wall with red trim round
      // it all. The green pond (OSM 337722335) is map water. Local +Z faces
      // SSW (199°), +X runs ESE along the temple row (109°).
      colliderTop = 7;
      // Brick courtyard east of the pond, and its two small lawns.
      addBox(group, [36, 0.12, 44.5], [10, 0.06, -10.25], brickTrim).castShadow = false;
      addBox(group, [26, 0.12, 15.5], [15, 0.06, 19.75], brickTrim).castShadow = false;
      for (const x of [-9, 1.5]) addBox(group, [8, 0.1, 9], [x, 0.17, -15], lawn).castShadow = false;
      // The four Shiva temples, built 1.4× so the row reads from the air.
      const row = new THREE.Group();
      row.position.set(-0.75, 0, -29.9);
      row.scale.setScalar(1.4);
      group.add(row);
      const SHIVA = [-6.95, -2.4, 2.25, 6.95];
      const spire: Array<[number, number]> = [[2.1, 4.0], [2.2, 4.9], [2.08, 5.8], [1.78, 6.6], [1.38, 7.4], [0.95, 8.1], [0.6, 8.7]];
      const SQRT2 = Math.SQRT2;
      for (const x of SHIVA) {
        addBox(row, [4.2, 4.0, 4.2], [x, 2.0, 0], peach);
        addBox(row, [4.5, 0.3, 4.5], [x, 0.15, 0], monumentRed);
        for (const px of [-1.95, 1.95]) addBox(row, [0.36, 3.6, 0.3], [x + px, 1.9, 2.1], monumentRed);
        addBox(row, [3.9, 0.3, 0.3], [x, 3.75, 2.12], monumentRed);
        const door = new THREE.Mesh(pointedArch(1.1, 2.3), archDark);
        door.position.set(x, 0.3, 2.13);
        row.add(door);
        // Rekha spire in banded tiers: cream courses with a red band proud
        // at the top of each, square in plan (a four-sided lathe, turned 45°).
        for (let tier = 0; tier < spire.length - 1; tier++) {
          const [r0, y0] = spire[tier];
          const [r1, y1] = spire[tier + 1];
          const split = y0 + (y1 - y0) * 0.72;
          const rSplit = r0 + (r1 - r0) * 0.72;
          addLathe(row, [[r0 * SQRT2, y0], [rSplit * SQRT2, split]], 4, [x, 0, 0], peach, true).rotation.y = Math.PI / 4;
          addLathe(row, [[rSplit * SQRT2 * 1.07, split], [r1 * SQRT2 * 1.07, y1], [r1 * SQRT2 * 0.98, y1]], 4, [x, 0, 0], monumentRed, true).rotation.y = Math.PI / 4;
        }
        addBox(row, [1.0, 0.25, 1.0], [x, 8.82, 0], peach);
        addCylinder(row, 0.62, 0.62, 0.35, [x, 9.1, 0], monumentRed, 8);
        // Trishul: a shaft, a crossbar low down, and three prongs (never a cross).
        addCylinder(row, 0.04, 0.06, 1.3, [x, 9.9, 0], archDark, 4);
        addBox(row, [0.62, 0.07, 0.07], [x, 10.05, 0], archDark);
        for (const px of [-0.28, 0.28]) addBox(row, [0.07, 0.42, 0.07], [x + px, 10.27, 0], archDark);
      }
      // The low wall that links the four cellas.
      addBox(row, [17.6, 2.6, 2.6], [0, 1.3, -0.4], peach);
      // Main shrine: a 9 m peach cella under a squat banded char-chala dome
      // and a red-and-cream crown turret, facing east (local +X) into the
      // nat-mandir.
      const SHRINE: [number, number] = [-4.2, 3.1];
      addBox(group, [9, 6, 9], [SHRINE[0], 3, SHRINE[1]], peach);
      addBox(group, [9.5, 0.6, 9.5], [SHRINE[0], 5.9, SHRINE[1]], monumentRed);
      addBox(group, [9.4, 0.5, 9.4], [SHRINE[0], 0.25, SHRINE[1]], monumentRed);
      const shrineDoor = new THREE.Mesh(pointedArch(2.4, 3.6), archDark);
      shrineDoor.position.set(SHRINE[0] + 4.53, 0.5, SHRINE[1]);
      shrineDoor.rotation.y = Math.PI / 2;
      group.add(shrineDoor);
      addLathe(group, domeProfile(4.5, 3.0, 0.06, 8), 8, [SHRINE[0], 6.2, SHRINE[1]], peach, true).rotation.y = Math.PI / 8;
      addCylinder(group, 4.6, 4.75, 0.5, [SHRINE[0], 6.9, SHRINE[1]], monumentRed, 8).rotation.y = Math.PI / 8;
      addCylinder(group, 3.55, 3.75, 0.45, [SHRINE[0], 8.0, SHRINE[1]], monumentRed, 8).rotation.y = Math.PI / 8;
      addBox(group, [2.2, 1.6, 2.2], [SHRINE[0], 9.6, SHRINE[1]], monumentRed);
      addBox(group, [1.4, 0.8, 1.4], [SHRINE[0], 10.8, SHRINE[1]], peach);
      addCylinder(group, 0.05, 0.07, 1.4, [SHRINE[0], 11.9, SHRINE[1]], archDark, 4);
      // Nat-mandir: an open hall with a flat brown concrete roof on columns
      // and cream arched gateways on its shrine side.
      const HALL_X = 15.5;
      const HALL_Z = -5;
      addBox(group, [17, 0.7, 38], [HALL_X, 6.3, HALL_Z], stoneStep);
      addBox(group, [17, 0.6, 38], [HALL_X, 0.3, HALL_Z], cream);
      for (const x of [HALL_X - 8, HALL_X + 8]) {
        for (let z = HALL_Z - 18; z <= HALL_Z + 18.1; z += 6) addBox(group, [0.7, 5.5, 0.7], [x, 3.4, z], cream);
      }
      for (const z of [HALL_Z - 8, HALL_Z + 8]) {
        addBox(group, [1.4, 5.4, 6], [HALL_X - 8.4, 3.3, z], cream);
        const arch = new THREE.Mesh(roundArch(3.2, 4.2), archDark);
        arch.position.set(HALL_X - 9.12, 0.6, z);
        arch.rotation.y = -Math.PI / 2;
        group.add(arch);
      }
      // The two long two-storey halls at the south tip, under red roofs.
      for (const [x, z, width, length] of [[7.5, 50, 11, 40], [19.5, 53, 10, 30]] as const) {
        addBox(group, [width, 7, length], [x, 3.5, z], cream);
        // Gabled tile roof: a triangular prism with flat faces.
        const gable = new THREE.Shape();
        gable.moveTo(-width / 2 - 0.4, 0);
        gable.lineTo(width / 2 + 0.4, 0);
        gable.lineTo(0, width * 0.32);
        gable.lineTo(-width / 2 - 0.4, 0);
        const roofGeometry = new THREE.ExtrudeGeometry(gable, { depth: length + 0.8, bevelEnabled: false, curveSegments: 1 });
        roofGeometry.translate(0, 0, -(length + 0.8) / 2);
        const roof = new THREE.Mesh(roofGeometry, tileRoof);
        roof.position.set(x, 7, z);
        roof.castShadow = true;
        group.add(roof);
        solidBox(x, z, width / 2, length / 2, 7 + width * 0.3);
      }
      // Cream compound wall with red coping along the OSM outline (way
      // 435104024); it runs just outside the pond's own edges.
      const wall: Array<[number, number]> = [
        [-4.7, 71.3], [2.2, 11.5], [-1.7, 11.7], [-4.8, 11.9], [-52.2, 24.1], [-65.3, -33.2], [-66.9, -38.5],
        [-22.7, -49.6], [-18.2, -33.8], [41.8, -31.8], [55.3, 25.7], [35.5, 30.9], [25.7, 51.6], [26.3, 63.6], [17.7, 76.2],
      ];
      wall.forEach(([ax, az], index) => {
        const [bx, bz] = wall[(index + 1) % wall.length];
        addBeam(group, [ax, 1.25, az], [bx, 1.25, bz], 0.5, 2.5, cream);
        addBeam(group, [ax, 2.6, az], [bx, 2.6, bz], 0.7, 0.25, monumentRed);
      });
      // Main gate on Dhakeshwari Road at the south tip: a pink arched gateway.
      const gate = new THREE.Group();
      gate.position.set(6.5, 0, 73.7);
      gate.rotation.y = Math.atan2(17.7 + 4.7, 76.2 - 71.3) - Math.PI / 2;
      group.add(gate);
      addBox(gate, [7.5, 7, 2.4], [0, 3.5, 0], peach);
      addBox(gate, [8, 0.7, 2.8], [0, 7.2, 0], monumentRed);
      addBox(gate, [2.2, 1.4, 2.2], [0, 8.2, 0], monumentRed);
      for (const z of [1.22, -1.22]) {
        const opening = new THREE.Mesh(pointedArch(3.2, 5), archDark);
        opening.position.set(0, 0, z);
        if (z < 0) opening.rotation.y = Math.PI;
        gate.add(opening);
      }
      clearSite(8, -6, 26, 32);
      clearSite(13, 52, 14, 26);
      solidBox(-0.75, -29.9, 15, 4, 14.4);
      solid(SHRINE[0], SHRINE[1], 4.8, 12.6);
      solidBox(HALL_X, HALL_Z, 8.5, 19, 6.7);
      perchTarget = [-0.75 + SHIVA[2] * 1.4, -29.9];
    } else if (landmark.kind === "aparajeyo-bangla") {
      // Aparajeyo Bangla (Syed Abdullah Khalid, 1979), Dhaka University: three
      // pale concrete Liberation War figures on a two-tier pedestal, facing
      // south down the campus road from the Arts Faculty (Kala Bhaban). Seen
      // from the front, left to right: the nurse in a sari with a first-aid
      // box, the tallest bare-chested fighter holding his rifle upright, and
      // the fighter with a rifle across his body. Built 1.5× on a round brick
      // plaza under shade trees, with the long white, blue-banded Arts
      // building behind. Local +Z faces south, +X east.
      const S = 1.5;
      colliderTop = 3.6;
      addCylinder(group, 11, 11, 0.16, [0, 0.08, 0], plazaBrick, 28).castShadow = false;
      addArcSlab(group, 10.6, 11.4, 0, Math.PI * 2, 0, 0.45, plazaBrick, 28);
      // Brick path out to the road in front.
      addBox(group, [5, 0.14, 14], [0, 0.07, 17], plazaBrick).castShadow = false;
      // Pedestal: a low slab, then a truncated pyramid with flat faces.
      addBox(group, [10 * S, 0.6 * S, 7 * S], [0, 0.3 * S, 0], concrete);
      const frustum = new THREE.CylinderGeometry(Math.SQRT1_2 * 0.79, Math.SQRT1_2, 1, 4, 1).toNonIndexed();
      frustum.rotateY(Math.PI / 4);
      frustum.computeVertexNormals();
      const pyramid = new THREE.Mesh(frustum, concrete);
      pyramid.scale.set(8 * S, 1.6 * S, 5.5 * S);
      pyramid.position.set(0, (0.6 + 0.8) * S, 0);
      pyramid.castShadow = true;
      group.add(pyramid);
      const BASE = 2.2 * S;
      addBox(group, [5.6 * S, 0.25 * S, 3.4 * S], [0, BASE + 0.12 * S, 0], paleConcrete);
      // A stocky standing figure `height` tall, built in a 1.8 m body frame:
      // merged legs, a broad torso and shoulders, a round head, and (for the
      // fighters) a rifle in the same pale stone as the rest of the group.
      const headGeometry = new THREE.SphereGeometry(0.15, 8, 6);
      const figure = (x: number, z: number, height: number, turn: number, kind: "nurse" | "upright" | "across") => {
        const body = new THREE.Group();
        body.position.set(x, BASE + 0.25 * S, z);
        body.rotation.y = turn;
        // Broadened, so the group still reads as three figures from the air.
        body.scale.set((height / 1.8) * 1.2, height / 1.8, (height / 1.8) * 1.2);
        group.add(body);
        if (kind === "nurse") {
          // Sari: a long tapered skirt, the bodice, the drape over one shoulder,
          // and the first-aid box held at her right hip.
          addCylinder(body, 0.24, 0.34, 1.02, [0, 0.51, 0], paleConcrete, 8);
          addBox(body, [0.5, 0.54, 0.3], [0, 1.27, 0], paleConcrete);
          addBox(body, [0.6, 0.14, 0.3], [0, 1.5, 0], paleConcrete);
          addBox(body, [0.18, 0.72, 0.32], [0.1, 1.12, 0.02], paleConcrete).rotation.z = 0.35;
          addBox(body, [0.3, 0.24, 0.22], [-0.38, 0.9, 0.08], paleConcrete);
        } else {
          // Legs as one tapered block, a belt line, the bare torso and shoulders.
          addBox(body, [0.44, 0.94, 0.28], [0, 0.47, 0], paleConcrete);
          addBox(body, [0.56, 0.14, 0.31], [0, 0.98, 0], paleConcrete);
          addBox(body, [0.66, 0.5, 0.34], [0, 1.3, 0], paleConcrete);
          addBox(body, [0.76, 0.14, 0.34], [0, 1.52, 0], paleConcrete);
        }
        addCylinder(body, 0.07, 0.08, 0.12, [0, 1.62, 0], paleConcrete, 6);
        const head = new THREE.Mesh(headGeometry, paleConcrete);
        head.position.set(0, 1.74, 0.01);
        head.scale.set(1, 1.15, 1);
        head.castShadow = true;
        body.add(head);
        for (const side of [-1, 1]) {
          const arm = addBox(body, [0.15, 0.66, 0.17], [side * (kind === "nurse" ? 0.33 : 0.42), 1.2, 0], paleConcrete);
          arm.rotation.z = side * 0.06;
        }
        if (kind === "upright") {
          // Rifle held upright by his left side, muzzle above the shoulder.
          addBox(body, [0.06, 0.95, 0.07], [0.5, 1.22, 0.07], paleConcrete);
        } else if (kind === "across") {
          // Rifle across the body, stock low at his right, muzzle up past the left shoulder.
          const rifle = addBox(body, [0.06, 0.98, 0.09], [0.08, 1.16, 0.2], paleConcrete);
          rifle.rotation.z = -0.9;
          addBox(body, [0.11, 0.26, 0.1], [-0.24, 0.94, 0.2], paleConcrete).rotation.z = -0.9;
        }
      };
      // Shoulder to shoulder, as in the sculpture.
      figure(-1.75 * S, -0.1, 4.6 * S, 0.12, "nurse");
      figure(0, 0.25, 5.5 * S, 0, "upright");
      figure(1.8 * S, -0.05, 5.0 * S, -0.1, "across");
      // Shade trees ringing the plaza, open to the front.
      for (let tree = 0; tree < 7; tree++) {
        const angle = Math.PI * 0.45 + (tree / 6) * Math.PI * 1.1;
        addLandmarkTree(group, Math.sin(angle) * 16, Math.cos(angle) * 16, 4.4, 6.5, tree % 2 ? landmarkCanopy : landmarkLightCanopy);
      }
      // Kala Bhaban (Arts Faculty, OSM 1152392502, 154 × 77 m, six storeys):
      // a white concrete frame with pale-blue spandrel bands, wings round a
      // row of courtyards. Its south front stands ~8 m behind the statue.
      const [artsX, artsZ] = toLocal(23.734223, 90.392795);
      const ARTS_H = 20;
      const wing = (x: number, z: number, w: number, d: number) => {
        addBox(group, [w, ARTS_H, d], [artsX + x, ARTS_H / 2, artsZ + z], paleConcrete);
        addBox(group, [w - 0.6, 0.1, d - 0.6], [artsX + x, ARTS_H + 0.05, artsZ + z], concrete).castShadow = false;
        solidBox(artsX + x, artsZ + z, w / 2, d / 2, ARTS_H);
      };
      wing(0, 31.5, 154, 14);
      wing(0, -31.5, 154, 14);
      for (const x of [-70, -35, 0, 35, 70]) wing(x, 0, 14, 49);
      for (let floor = 0; floor < 5; floor++) {
        const y = 4.4 + floor * 3.3;
        addBox(group, [154.4, 1.2, 0.3], [artsX, y, artsZ + 38.62], skyGlass);
        addBox(group, [154.4, 1.2, 0.3], [artsX, y, artsZ - 38.62], skyGlass);
      }
      clearSite(0, 4, 13, 14);
      solid(0, 0, 4, BASE + 5.8 * S);
      perchTarget = [0.01, 0.25];
    } else if (landmark.kind === "shishu-mela") {
      // Shishu Mela / DNCC Wonderland, Shyamoli (OSM way 32561560): a small,
      // packed fairground filling an 86 × 62 m plot whose long axis runs SSE
      // (161°) along local X. The cartoon gate faces WSW onto Mirpur Road
      // (local +Z): two orange-and-white spiral seashell pillars and green
      // dragons coiling off a sea-green relief wall with an octopus, under a
      // cream-gold "DNCC WONDERLAND" banner. Inside a painted perimeter wall
      // and shop row stand the Wonder Wheel, a green dragon coaster loop, a
      // pirate-ship swing, a carousel and small ride canopies.
      boundsCollider = false;
      const HX = 43;
      const HZ = 31;
      const PAD = 0.3;
      addBox(group, [HX * 2, PAD, HZ * 2], [0, PAD / 2, 0], paleConcrete);
      // The perimeter: red frames with blue and yellow mural panels, on both
      // faces where the wall meets the street.
      const wallRun = (ax: number, az: number, bx: number, bz: number, height: number, depth: number, faces: number[]) => {
        const length = Math.hypot(bx - ax, bz - az);
        const ux = (bx - ax) / length;
        const uz = (bz - az) / length;
        const yaw = Math.atan2(ux, uz);
        const body = addBox(group, [depth, height, length], [(ax + bx) / 2, PAD + height / 2, (az + bz) / 2], monumentRed);
        body.rotation.y = yaw;
        const panels = Math.max(1, Math.floor(length / 4));
        for (let index = 0; index < panels; index++) {
          const t = (index + 0.5) / panels;
          for (const face of faces) {
            const offset = (depth / 2 + 0.07) * face;
            const panel = addBox(
              group,
              [0.14, height * 0.56, (length / panels) * 0.74],
              [ax + (bx - ax) * t + uz * offset, PAD + height * 0.5, az + (bz - az) * t - ux * offset],
              index % 2 ? accent : carnivalBlue,
            );
            panel.rotation.y = yaw;
          }
        }
      };
      // Front wall either side of the gate, the two side walls, and the back
      // shop row (deeper, with its counters facing in).
      wallRun(-HX + 0.4, HZ - 0.4, -10.5, HZ - 0.4, 4, 0.8, [1, -1]);
      wallRun(10.5, HZ - 0.4, HX - 0.4, HZ - 0.4, 4, 0.8, [1, -1]);
      wallRun(-HX + 0.4, -HZ + 5, -HX + 0.4, HZ - 0.8, 4, 0.8, [1, -1]);
      wallRun(HX - 0.4, HZ - 0.8, HX - 0.4, -HZ + 5, 4, 0.8, [1, -1]);
      wallRun(HX - 0.4, -HZ + 2.5, -HX + 0.4, -HZ + 2.5, 4.4, 5, [1]);
      addBox(group, [HX * 2 - 0.4, 0.3, 6], [0, PAD + 4.55, -HZ + 2.8], carnivalBlue);

      // The cartoon gate.
      const GZ = HZ - 0.2;
      for (const side of [-1, 1]) {
        addBox(group, [2.2, 4.6, 1.8], [side * 6, PAD + 2.3, GZ], monumentRed);
        // Spiral seashell pillar: stacked cones in orange-gold and white,
        // under a mushroom cap.
        for (let ring = 0; ring < 5; ring++) {
          addCone(group, 1.05 - ring * 0.04, 1.5, [side * 8.6, PAD + 0.75 + ring * 1.22, GZ + 1.6], ring % 2 ? whiteStone : accent, 9);
        }
        addCylinder(group, 2.3, 0.7, 1.1, [side * 8.6, PAD + 7.0, GZ + 1.6], accent, 10);
        // A coiled green dragon rising off the pillar cap to a head with an
        // open red mouth, its tail running out along the wall top.
        const coil: Array<[number, number, number]> = [
          [side * 21, PAD + 4.3, GZ + 0.2], [side * 16, PAD + 5.2, GZ + 0.6], [side * 12.5, PAD + 6.4, GZ + 1.2],
          [side * 10.4, PAD + 8.0, GZ + 1.6], [side * 11.4, PAD + 9.8, GZ + 1.9], [side * 9.4, PAD + 11.0, GZ + 2.2],
        ];
        for (let index = 0; index < coil.length - 1; index++) {
          addBeam(group, coil[index], coil[index + 1], 1.3, 1.3, landmarkLightCanopy, 0.8);
          addCone(group, 0.35, 1.1, [coil[index][0], coil[index][1] + 0.9, coil[index][2]], monumentRed, 4);
        }
        addBox(group, [2.0, 1.4, 2.4], [side * 8.6, PAD + 11.4, GZ + 2.6], landmarkLightCanopy);
        addBox(group, [1.6, 0.5, 1.4], [side * 8.2, PAD + 10.7, GZ + 3.5], monumentRed);
      }
      // The sea-green relief wall over the doorway, with the octopus.
      addBox(group, [15, 5.2, 1.2], [0, PAD + 7.2, GZ], tealArch);
      const head = new THREE.Mesh(new THREE.SphereGeometry(1.5, 8, 6), whiteStone);
      head.position.set(0, PAD + 8.6, GZ + 0.9);
      group.add(head);
      for (let arm = 0; arm < 6; arm++) {
        const angle = -0.5 - (arm / 5) * (Math.PI - 1);
        addBeam(group, [0, PAD + 7.6, GZ + 0.9], [Math.cos(angle) * 5.2, PAD + 7.4 + Math.sin(angle) * 2.2, GZ + 0.75], 0.45, 0.45, accent);
      }
      // The arched cream-gold banner along the top.
      const bannerPoints: Array<[number, number, number]> = [];
      for (let step = 0; step <= 6; step++) {
        const x = -11 + (22 * step) / 6;
        bannerPoints.push([x, PAD + 10.6 + Math.cos((x / 11) * (Math.PI / 2)) * 0.9 - (Math.abs(x) > 9 ? 0.6 : 0), GZ + 0.4]);
      }
      for (let index = 0; index < bannerPoints.length - 1; index++) addBeam(group, bannerPoints[index], bannerPoints[index + 1], 0.5, 1.6, accent, 0.3);
      solidBox(0, GZ + 1, 12, 2, 12);

      // The Wonder Wheel at the NNW end.
      addFerrisWheel(group, -22, -13, 12, 15);
      solidBox(-22, -13, 12.5, 3, 28);
      perchTarget = [-22, -13];

      // The dragon coaster: a closed oval of green rail on silver posts,
      // rising and dipping between 2 and 6 m, with a dragon-head train.
      const track: QuadPoint[] = [];
      const CX = 20;
      const CZ = -8;
      for (let step = 0; step <= 28; step++) {
        const t = (step / 28) * Math.PI * 2;
        track.push([CX + Math.cos(t) * 15, PAD + 4 + Math.sin(t * 2) * 1.6 + Math.cos(t) * 0.6, CZ + Math.sin(t) * 7.5]);
      }
      addSweptBox(group, track, 0.9, 0.55, landmarkLightCanopy);
      for (let step = 0; step < 28; step += 2) {
        const [px, py, pz] = track[step];
        addBox(group, [0.35, py - PAD, 0.35], [px, PAD + (py - PAD) / 2 - 0.3, pz], silverPanel);
      }
      for (let car = 0; car < 4; car++) {
        const [px, py, pz] = track[3 + car];
        addBox(group, [1.6, 0.9, 1.6], [px, py + 0.5, pz], car === 0 ? landmarkLightCanopy : accent);
      }
      addCone(group, 0.5, 1.4, [track[3][0], track[3][1] + 1.6, track[3][2]], monumentRed, 4);
      solidBox(CX, CZ, 16, 8.5, 6.8);

      // The pirate-ship swing: an A-frame, and the hull caught mid-swing.
      const SX = 24;
      const SZ = 17;
      const PIVOT = 11.5;
      for (const side of [-2.4, 2.4]) {
        for (const leg of [-1, 1]) addBeam(group, [SX + leg * 6, PAD, SZ + side], [SX, PAD + PIVOT, SZ + side * 0.4], 0.45, 0.45, silverPanel);
      }
      const ship = new THREE.Group();
      ship.position.set(SX, PAD + PIVOT, SZ);
      ship.rotation.z = 0.42;
      group.add(ship);
      addBeam(ship, [0, 0, -1.3], [0, -8.2, -1.3], 0.35, 0.35, silverPanel);
      addBeam(ship, [0, 0, 1.3], [0, -8.2, 1.3], 0.35, 0.35, silverPanel);
      addBox(ship, [10, 1.8, 3.4], [0, -9, 0], landmarkBark);
      for (const end of [-1, 1]) {
        const prow = addBox(ship, [2.4, 1.6, 3.0], [end * 5.6, -8.6, 0], landmarkBark);
        prow.rotation.z = end * 0.5;
      }
      addBox(ship, [0.25, 4.2, 0.25], [0, -6.0, 0], landmarkBark);
      addBox(ship, [0.1, 2.6, 2.6], [0.3, -5.4, 0], whiteStone);
      solidBox(SX, SZ, 7, 3, 13);

      // A carousel under a striped tent roof.
      addCylinder(group, 6.2, 6.4, 0.8, [-3, PAD + 0.4, 12], whiteStone, 14);
      for (let post = 0; post < 8; post++) {
        const angle = (post / 8) * Math.PI * 2;
        addBox(group, [0.3, 3.4, 0.3], [-3 + Math.sin(angle) * 5.4, PAD + 2.5, 12 + Math.cos(angle) * 5.4], accent);
        addBox(group, [0.9, 1.0, 1.6], [-3 + Math.sin(angle) * 4.2, PAD + 1.5, 12 + Math.cos(angle) * 4.2], post % 2 ? monumentRed : carnivalBlue);
      }
      addCone(group, 6.9, 3.4, [-3, PAD + 5.9, 12], monumentRed, 14);
      addCone(group, 3.2, 1.8, [-3, PAD + 7.6, 12], whiteStone, 14);
      addFinial(group, [-3, PAD + 8.4, 12], 0.6, accent);
      solidBox(-3, 12, 6.5, 6.5, 9);

      // Small ride canopies (bumper cars, the paratrooper, kiosks) filling the rest.
      for (const [x, z, w, d, roof] of [
        [4, -22, 9, 6, carnivalBlue], [-34, 16, 8, 8, accent], [-20, 17, 6, 6, monumentRed],
        [36, 14, 6, 9, accent], [-8, -2, 6, 5, carnivalBlue], [35, -22, 6, 5, monumentRed],
      ] as const) {
        addBox(group, [w, 2.6, d], [x, PAD + 1.3, z], whiteStone);
        const cap = addCone(group, Math.max(w, d) * 0.74, 2.2, [x, PAD + 3.7, z], roof, 4);
        cap.rotation.y = Math.PI / 4;
      }
      // The paratrooper: a mast with a tilted umbrella of hanging seats.
      addCylinder(group, 0.5, 0.7, 9, [-33, PAD + 4.5, 3], silverPanel, 8);
      const umbrella = new THREE.Group();
      umbrella.position.set(-33, PAD + 9, 3);
      umbrella.rotation.x = 0.35;
      group.add(umbrella);
      for (let arm = 0; arm < 8; arm++) {
        const angle = (arm / 8) * Math.PI * 2;
        addBeam(umbrella, [0, 0, 0], [Math.sin(angle) * 6, 0.6, Math.cos(angle) * 6], 0.3, 0.3, silverPanel);
        addBox(umbrella, [1.2, 1.4, 1.2], [Math.sin(angle) * 6, -0.8, Math.cos(angle) * 6], arm % 2 ? accent : monumentRed);
      }
      solidBox(-33, 3, 6, 6, 11);
      for (const [x, z] of [[-38, -22], [8, 25], [38, 2]] as const) addLandmarkTree(group, x, z, 3.4, 4.6, landmarkLightCanopy);
      // The plot is solid fairground: keep generic blocks and park trees off it.
      for (let strip = 0; strip < 4; strip++) solidBox(-HX + (HX / 4) * (strip * 2 + 1), 0, HX / 4, HZ, 4.4);
    } else if (landmark.kind === "star-mosque") {
      // Star Mosque (Tara Masjid), Armanitola: a brilliant white hall covered
      // in blue star tile, five domes in a row along its back half (large,
      // small, large alternating), an eleven-arch verandah facing east, slim
      // domed corner turrets over a merlon parapet, and the star-shaped
      // turquoise pool in the white marble courtyard. OSM 245019710 is 20 × 12 m;
      // built at 1.3× against the 4–7 storey Armanitola blocks. Local +Z faces
      // east, +X north.
      const S = 1.3;
      const WALL = 7.5;
      const HALL_X = 21.4;
      const DEPTH = 12;
      const ROOF = WALL + 0.35;
      const DOME_Z = -2.2;
      const m = new THREE.Group();
      m.scale.setScalar(S);
      group.add(m);
      const starDotGeometry = new THREE.OctahedronGeometry(0.2, 0);
      colliderTop = (ROOF + 0.7) * S;
      addBox(m, [HALL_X + 1.4, 0.45, DEPTH + 1.4], [0, 0.225, 0], marble);
      addBox(m, [HALL_X, WALL, DEPTH], [0, WALL / 2, 0], whiteStone);
      // The mihrab bay projecting from the back (west) wall.
      addBox(m, [3.2, 6.2, 1.2], [0, 3.1, -DEPTH / 2 - 0.6], whiteStone);
      // Roof slab, the pale pink floral frieze and a merlon parapet all round.
      addBox(m, [HALL_X + 0.3, 0.35, DEPTH + 0.3], [0, WALL + 0.175, 0], whiteStone);
      addBox(m, [HALL_X + 0.12, 0.45, 0.12], [0, WALL - 0.75, DEPTH / 2 + 0.06], pinkTrim);
      addBox(m, [HALL_X + 0.12, 0.3, 0.12], [0, 5.25, DEPTH / 2 + 0.06], pinkTrim);
      for (let x = -HALL_X / 2 + 0.45; x <= HALL_X / 2 - 0.4; x += 0.9) {
        for (const z of [-DEPTH / 2 - 0.02, DEPTH / 2 + 0.02]) addBox(m, [0.5, 0.7, 0.26], [x, ROOF + 0.35, z], whiteStone);
      }
      for (let z = -DEPTH / 2 + 0.9; z <= DEPTH / 2 - 0.8; z += 0.9) {
        for (const x of [-HALL_X / 2 - 0.02, HALL_X / 2 + 0.02]) addBox(m, [0.26, 0.7, 0.5], [x, ROOF + 0.35, z], whiteStone);
      }
      // East verandah: eleven pointed arches on star-tiled piers.
      const BAY = HALL_X / 11;
      for (let bay = 0; bay < 11; bay++) {
        const arch = new THREE.Mesh(pointedArch(BAY - 0.6, 4.1), archDark);
        arch.position.set(-HALL_X / 2 + BAY * (bay + 0.5), 0.45, DEPTH / 2 + 0.05);
        m.add(arch);
      }
      for (let pier = 0; pier <= 11; pier++) {
        addBox(m, [0.5, 4.7, 0.36], [-HALL_X / 2 + BAY * pier, 0.45 + 2.35, DEPTH / 2 + 0.18], whiteStone);
      }
      // Blind arched windows on the end walls.
      for (const side of [-1, 1]) {
        for (const z of [-3.4, 0, 3.4]) {
          const blind = new THREE.Mesh(pointedArch(1.3, 2.8), archDark);
          blind.position.set(side * (HALL_X / 2 + 0.05), 1.6, z);
          blind.rotation.y = side * Math.PI / 2;
          m.add(blind);
        }
      }
      // Five onion domes on short drums along the back half, north to south:
      // small, large, small, large, small.
      for (const [x, radius, rise, finial] of [
        [9.2, 1.65, 2.3, 0.5], [4.9, 2.55, 3.2, 0.8], [0, 1.75, 2.4, 0.55], [-4.9, 2.55, 3.2, 0.8], [-9.2, 1.65, 2.3, 0.5],
      ] as const) {
        const drum = radius > 2 ? 0.9 : 0.7;
        addCylinder(m, radius + 0.08, radius + 0.12, drum, [x, ROOF + drum / 2, DOME_Z], whiteStone, 14);
        addCylinder(m, radius + 0.3, radius + 0.3, 0.28, [x, ROOF + drum - 0.05, DOME_Z], pinkTrim, 14);
        const profile = domeProfile(radius, rise, 0.16, 10);
        addLathe(m, profile, 14, [x, ROOF + drum, DOME_Z], starTile);
        // The blue stars, big enough to speckle the dome from a passing bird.
        for (let step = 1; step <= 8; step += 1.5) {
          const [ringRadius, ringY] = profile[Math.round(step)];
          const count = Math.max(4, Math.round(ringRadius * 3.4));
          for (let index = 0; index < count; index++) {
            const angle = ((index + (step % 3) * 0.5) / count) * Math.PI * 2;
            const dot = new THREE.Mesh(starDotGeometry, starBlue);
            dot.position.set(x + Math.sin(angle) * (ringRadius + 0.04), ROOF + drum + ringY, DOME_Z + Math.cos(angle) * (ringRadius + 0.04));
            m.add(dot);
          }
        }
        addFinial(m, [x, ROOF + drum + rise - 0.25, DOME_Z], finial, whiteStone);
        solid(x * S, DOME_Z * S, radius * S, (ROOF + drum + rise) * S);
      }
      // Slim octagonal turrets: full height at the four corners, and shorter
      // ones rising from the parapet between them, each under a mini dome.
      const turret = (x: number, z: number, base: number, top: number, radius: number) => {
        addCylinder(m, radius, radius * 1.1, top - base, [x, base + (top - base) / 2, z], whiteStone, 8);
        addCylinder(m, radius * 1.45, radius * 1.45, 0.22, [x, top - 0.1, z], pinkTrim, 8);
        addLathe(m, domeProfile(radius * 1.2, radius * 1.9, 0.12, 6), 8, [x, top, z], starTile);
        addFinial(m, [x, top + radius * 1.6, z], radius * 0.55, whiteStone);
      };
      for (const sx of [-1, 1]) {
        for (const sz of [-1, 1]) turret(sx * (HALL_X / 2 + 0.1), sz * (DEPTH / 2 + 0.1), 0.45, ROOF + 2.4, 0.45);
        for (const x of [3.9, 7.8]) turret(sx * x, DEPTH / 2 - 0.05, ROOF, ROOF + 1.9, 0.3);
        turret(sx * 7.8, -DEPTH / 2 + 0.05, ROOF, ROOF + 1.9, 0.3);
      }
      // The white marble courtyard to the east, with two grass panels and the
      // five-pointed star pool.
      addBox(m, [28, 0.2, 18.6], [0, 0.1, 15.3], marble);
      for (const side of [-1, 1]) addBox(m, [7.5, 0.08, 3.6], [side * 8.6, 0.24, 10.6], lawn).castShadow = false;
      const star = (outer: number, inner: number) => {
        const points: THREE.Vector2[] = [];
        for (let index = 0; index < 10; index++) {
          const angle = (index / 10) * Math.PI * 2;
          const radius = index % 2 === 0 ? outer : inner;
          points.push(new THREE.Vector2(Math.sin(angle) * radius, Math.cos(angle) * radius));
        }
        return points;
      };
      const rim = new THREE.Shape(star(4.2, 2.0));
      rim.holes.push(new THREE.Path(star(3.5, 1.55)));
      const rimGeometry = new THREE.ExtrudeGeometry(rim, { depth: 0.55, bevelEnabled: false, curveSegments: 1 });
      rimGeometry.rotateX(-Math.PI / 2);
      const pool = new THREE.Mesh(rimGeometry, marble);
      pool.position.set(-1.2, 0.2, 19);
      m.add(pool);
      const poolWater = new THREE.Mesh(new THREE.ShapeGeometry(new THREE.Shape(star(3.55, 1.6))), poolTurquoise);
      poolWater.rotation.x = -Math.PI / 2;
      poolWater.position.set(-1.2, 0.42, 19);
      m.add(poolWater);
      clearSite(0, 8.5 * S, 16 * S, 17 * S);
      perchTarget = [4.9 * S, DOME_Z * S];
    } else if (landmark.kind === "kamalapur-station") {
      // Kamalapur Railway Station (1968): a square of 36 umbrella shells on a
      // 7 × 7 grid of slender columns. From above it is a diamond lattice of
      // grey pyramidal shells with a zigzag edge; from the forecourt, a row of
      // tall white pointed scallops. The shops and halls sit well inside under
      // it, and four long cream platform canopies run 440 m north. Local +Z
      // faces the west forecourt, local +X south.
      const ROOF_Y = 13.4;
      const PITCH = 14;
      colliderTop = 17.5;
      addBox(group, [64, 9, 64], [0, 4.5, 0], paleConcrete);
      addBox(group, [64.6, 3.8, 64.6], [0, 2.1, 0], ribbonGlass);
      for (let i = -3; i <= 3; i++) {
        for (let j = -3; j <= 3; j++) {
          const [cx, cz] = [i * PITCH, j * PITCH];
          addCylinder(group, 0.5, 0.62, ROOF_Y, [cx, ROOF_Y / 2, cz], cream, 8);
          if (Math.abs(i) < 3 && Math.abs(j) < 3) continue;
          // The outer columns fork into ribbed arms under the shell edges.
          for (const [ax, az] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
            if (Math.abs(cx + ax * 4.2) > 42 || Math.abs(cz + az * 4.2) > 42) continue;
            addBeam(group, [cx, 8.4, cz], [cx + ax * 4.2, ROOF_Y, cz + az * 4.2], 0.45, 0.45, cream);
          }
        }
      }
      // Each facade bay is a tall pointed scallop: the turned-up edge of a shell.
      const spandrel = new THREE.Shape();
      spandrel.moveTo(-7, 0);
      spandrel.lineTo(-6.5, 0);
      spandrel.quadraticCurveTo(-6.5, 4.5, 0, 5.5);
      spandrel.quadraticCurveTo(6.5, 4.5, 6.5, 0);
      spandrel.lineTo(7, 0);
      spandrel.lineTo(7, 6.2);
      spandrel.lineTo(-7, 6.2);
      spandrel.lineTo(-7, 0);
      const spandrelGeometry = new THREE.ExtrudeGeometry(spandrel, { depth: 0.5, bevelEnabled: false, curveSegments: 6 });
      for (let side = 0; side < 4; side++) {
        const face = new THREE.Group();
        face.rotation.y = side * Math.PI / 2;
        group.add(face);
        for (let bay = -3; bay < 3; bay++) {
          const mesh = new THREE.Mesh(spandrelGeometry, cream);
          mesh.position.set(bay * PITCH + 7, ROOF_Y - 6.2, 41.1);
          face.add(mesh);
        }
      }
      // The shell soffit, then the diamond lattice: 8 × 8 pyramids with 7 × 7
      // set in their gaps, corners pointing N/S/E/W, tips forming the zigzag edge.
      addBox(group, [83, 0.8, 83], [0, ROOF_Y + 0.4, 0], cream);
      const SHELL = 10.5;
      const pyramid = new THREE.ConeGeometry(SHELL / 2, 3.4, 4, 1, true).toNonIndexed();
      pyramid.computeVertexNormals();
      for (const count of [8, 7]) {
        for (let i = 0; i < count; i++) {
          for (let j = 0; j < count; j++) {
            const shell = new THREE.Mesh(pyramid, boardConcrete);
            shell.position.set((i - (count - 1) / 2) * SHELL, ROOF_Y + 0.8 + 1.7, (j - (count - 1) / 2) * SHELL);
            group.add(shell);
          }
        }
      }
      // Platforms, tracks and canopies in world axes (east +x, south +z), from
      // the headhouse's north edge to lat 23.7367.
      const yard = new THREE.Group();
      yard.rotation.y = -landmark.heading;
      group.add(yard);
      const YARD_MID = -284;
      const YARD_LENGTH = 486;
      addBox(yard, [114, 0.3, YARD_LENGTH], [29, 0.15, YARD_MID], roofGrey).castShadow = false;
      const PLATFORMS: Array<[number, number]> = [[-16.3, 14], [14.3, 12], [40.8, 12], [69.3, 12]];
      // Each track reads from the air as a dark steel-and-sleeper strip on the ballast.
      for (const x of [-4.5, 3.5, 24, 31, 51, 59, 80]) {
        addBox(yard, [2.6, 0.2, YARD_LENGTH], [x, 0.4, YARD_MID], bronze).castShadow = false;
      }
      const CANOPY_MID = -279;
      const CANOPY_LENGTH = 470;
      const vault = new THREE.CylinderGeometry(1.7, 1.7, 7.4, 6, 1, true, -Math.PI / 2, Math.PI);
      vault.rotateX(-Math.PI / 2);
      vault.scale(1, 0.7, 1);
      for (const [x, width] of PLATFORMS) {
        addBox(yard, [width, 0.9, 476], [x, 0.75, -282], paleConcrete);
        addBox(yard, [width - 2, 0.5, CANOPY_LENGTH], [x, 6.25, CANOPY_MID], stationCream);
        for (let z = -50; z >= -510; z -= 16) addBox(yard, [0.7, 4.9, 0.7], [x, 3.65, z], stationCream);
        for (let z = -48.5; z >= -510; z -= 9) {
          const hump = new THREE.Mesh(vault, boardConcrete);
          hump.position.set(x, 6.5, z);
          yard.add(hump);
        }
        colliders.push({ x: group.position.x + x, z: group.position.z + CANOPY_MID, halfWidth: width / 2 - 1, halfDepth: CANOPY_LENGTH / 2, top: 7.7 + group.position.y });
      }
      // The white footbridge over the yard, 120 m north of the headhouse.
      addBox(yard, [130, 0.8, 3.6], [28, 8.4, -161], whiteStone);
      for (const side of [-1.7, 1.7]) addBox(yard, [130, 1.1, 0.25], [28, 9.35, -161 + side], whiteStone);
      for (const x of [-30, -16.3, 14.3, 40.8, 69.3, 90]) addBox(yard, [0.9, 7.7, 0.9], [x, 4.15, -161], whiteStone);
      colliders.push({ x: group.position.x + 28, z: group.position.z - 161, halfWidth: 65, halfDepth: 2, top: 9.9 + group.position.y });
      // Keep the yard and the west forecourt free of generic blocks.
      colliders.push({ x: group.position.x + 29, z: group.position.z + YARD_MID, halfWidth: 60, halfDepth: YARD_LENGTH / 2 + 4, top: LANDMARK_CLEARING_TOP });
      colliders.push({ x: group.position.x - 52, z: group.position.z, halfWidth: 12, halfDepth: 46, top: LANDMARK_CLEARING_TOP });
    } else if (landmark.kind === "bcfcc") {
      // Bangladesh-China Friendship Conference Centre (formerly BICC,
      // Agargaon, 2001): one huge, thin grey metal roof plate floating at
      // 23 m over the whole hall, carried on a ring of white round columns
      // whose curved white brackets sweep up to its edge, with a row of
      // shallow white barrel vaults hanging under the eaves and a dark space
      // truss beneath. The hall itself, glass curtain walls between tan-tiled
      // drums at the corners, sits in shadow well inside the roof edge; three
      // pointed-arch portals mark the front. Out front: a fountain pool on the
      // axis and a grid of forty flagpoles on two lawns. Local +Z is the front
      // (east, inferred), +X is north.
      const HX = 73;
      const HZ = 64;
      const EAVE = 22.3;
      colliderTop = 24.2;
      perchTarget = [0, HZ - 4];
      // The roof plate, its white fascia, the dark soffit and the space truss.
      addBox(group, [HX * 2, 1.2, HZ * 2], [0, 23.4, 0], plantGrey);
      addBox(group, [HX * 2 + 0.8, 0.9, HZ * 2 + 0.8], [0, 23, 0], whiteStone);
      addBox(group, [HX * 2 - 6, 0.4, HZ * 2 - 6], [0, EAVE + 0.2, 0], recess);
      for (let z = -54; z <= 54; z += 12) addBox(group, [HX * 2 - 8, 0.5, 0.5], [0, 20.4, z], recess);
      for (let x = -60; x <= 60; x += 12) addBox(group, [0.5, 0.5, HZ * 2 - 8], [x, 20.4, 0], recess);
      for (let x = -60; x <= 60; x += 24) {
        for (let z = -48; z <= 48; z += 24) {
          for (const [dx, dz] of [[6, 6], [-6, 6], [6, -6], [-6, -6]] as const) addBeam(group, [x, 20.4, z], [x + dx, EAVE, z + dz], 0.3, 0.3, recess);
        }
      }
      // The hall: glass curtain walls, tan drums at the corners, tan end blocks.
      addBox(group, [112, 14, 96], [0, 7, 0], glass);
      addBox(group, [104, 4, 88], [0, 16, 0], recess);
      for (const sx of [-1, 1]) {
        for (const sz of [-1, 1]) addCylinder(group, 7.5, 7.5, 17, [sx * 54, 8.5, sz * 46], peach, 16);
        addBox(group, [12, 17, 22], [sx * 52, 8.5, 0], peach);
      }
      // Three tall pointed-arch portals in white frames at the front centre.
      for (const x of [-8.5, 0, 8.5]) {
        const frameArch = new THREE.Mesh(pointedArch(7, 13.4), whiteStone);
        frameArch.position.set(x, 0.2, 48.12);
        group.add(frameArch);
        const doorway = new THREE.Mesh(pointedArch(5.4, 12), recess);
        doorway.position.set(x, 0.2, 48.3);
        group.add(doorway);
      }
      // The ring of white columns and their curved brackets, and the barrel
      // vaults between them under the eaves.
      const bracket = new THREE.TorusGeometry(5.6, 0.32, 4, 6, Math.PI / 2);
      const vault = new THREE.CylinderGeometry(5.8, 5.8, 9, 6, 1, true, -Math.PI / 2, Math.PI);
      vault.rotateX(Math.PI / 2);
      vault.scale(1, 0.42, 1);
      const sides = [
        { across: HZ, half: HX, nx: 0, nz: 1 },
        { across: HZ, half: HX, nx: 0, nz: -1 },
        { across: HX, half: HZ, nx: 1, nz: 0 },
        { across: HX, half: HZ, nx: -1, nz: 0 },
      ];
      for (const side of sides) {
        const count = Math.round((side.half * 2 - 14) / 12);
        const spacing = (side.half * 2 - 14) / count;
        const facing = Math.atan2(side.nx, side.nz);
        for (let index = 0; index <= count; index++) {
          const along = -side.half + 7 + index * spacing;
          const inset = side.across - 6;
          const x = side.nz ? along : side.nx * inset;
          const z = side.nz ? side.nz * inset : along;
          addCylinder(group, 0.65, 0.65, 16.7, [x, 8.35, z], whiteStone, 8);
          const holder = new THREE.Group();
          holder.position.set(x + side.nx * 5.6, 16.7, z + side.nz * 5.6);
          holder.rotation.y = facing - Math.PI / 2;
          group.add(holder);
          const rib = new THREE.Mesh(bracket, whiteStone);
          rib.rotation.y = Math.PI;
          holder.add(rib);
          if (index === count) continue;
          const mid = along + spacing / 2;
          const vaultMesh = new THREE.Mesh(vault, whiteStone);
          vaultMesh.position.set(side.nz ? mid : side.nx * (side.across - 7), EAVE, side.nz ? side.nz * (side.across - 7) : mid);
          vaultMesh.rotation.y = facing;
          group.add(vaultMesh);
        }
      }
      // Forecourt: asphalt apron, two flagpole lawns and the fountain pool.
      addBox(group, [140, 0.1, 62], [0, 0.05, HZ + 31], roofGrey).castShadow = false;
      for (const sx of [-1, 1]) {
        addBox(group, [43, 0.24, 22], [sx * 33.5, 0.12, HZ + 17], lawn).castShadow = false;
        for (let row = 0; row < 4; row++) {
          for (let pole = 0; pole < 5; pole++) {
            addCylinder(group, 0.12, 0.14, 16, [sx * (16 + pole * 9), 8.2, HZ + 9 + row * 5.5], whiteStone, 5);
          }
        }
      }
      addBox(group, [31, 0.6, 11], [0, 0.3, HZ + 17], whiteStone);
      addBox(group, [29.4, 0.14, 9.4], [0, 0.62, HZ + 17], water);
      clearSite(0, HZ + 31, 72, 32);
    } else if (landmark.kind === "jamuna-future-park") {
      // Jamuna Future Park, Kuril: a 230 m block of light grey composite
      // panelling (OSM 586535435, seven retail floors) whose skyline is a
      // ring of taller square pavilions, each under a flat overhanging dark
      // "hat" roof over a shadowed bracket band, with tall blue glass panels
      // and slot windows. The west front onto Pragati Sarani has the big
      // pavilion with the round-arched blue glass window, and blue glass
      // blocks at its north end; an octagonal glass skylight crowns the
      // atrium. The outdoor rides stand on the forecourt to the south-west,
      // clear of the JW Marriott. Footprint mode: local axes are world axes.
      const MALL = 586535435;
      const mall = anchor(MALL);
      if (mall) {
        boundsCollider = false;
        const H = mall.height;
        slab(MALL, H - 1.6, 1.5, 1.004, copperDark);
        slab(MALL, H - 0.1, 0.8, 1.012, roofGrey);
        // Pavilions: group-local centre, outward facing, width, height, type
        // (from the OSM outline, inset so their faces are flush with it).
        const pavilions: Array<[number, number, number, number, number, "main" | "blue" | "pav"]> = [
          [-100.9, -10.4, -1.392, 46, 44, "main"], [-109.4, -56.7, -1.813, 30, 46, "blue"], [-78, 78, -1.154, 32, 42, "pav"],
          [-49.5, 106.4, 0.235, 32, 42, "pav"], [4.2, 94.5, 0.235, 30, 40, "pav"], [69.9, 78.1, 0.227, 32, 42, "pav"],
          [114.8, 68.7, 0.227, 30, 42, "pav"], [103.1, 31.8, 1.776, 32, 40, "pav"], [77.7, -80.8, 1.821, 30, 42, "pav"],
          [44, -101.9, -2.904, 32, 42, "pav"], [-45.3, -80.3, -2.904, 32, 40, "pav"],
        ];
        // The table is in metres from the footprint's bounds centre (the
        // anchor), which sits about 35 m E and 25 m N of the OSM centroid.
        for (const [px, pz, facing, w, h, type] of pavilions) {
          const holder = new THREE.Group();
          holder.position.set(mall.x + px, 0, mall.z + pz);
          holder.rotation.y = facing;
          group.add(holder);
          addBox(holder, [w, h, w], [0, h / 2, 0], type === "blue" ? starBlue : silverPanel);
          addBox(holder, [w + 0.5, 1.5, w + 0.5], [0, h - 0.9, 0], copperDark);
          addBox(holder, [w + 4.6, 0.8, w + 4.6], [0, h + 0.3, 0], copperDark);
          if (type === "main") {
            const arch = new THREE.Mesh(roundArch(w * 0.62, h * 0.8), starBlue);
            arch.position.set(0, 2, w / 2 + 0.15);
            holder.add(arch);
          } else if (type === "pav") {
            addBox(holder, [w * 0.5, h * 0.62, 0.4], [0, h * 0.5, w / 2 + 0.1], starBlue);
          }
          if (type !== "blue") {
            for (const side of [-1, 1]) {
              addBox(holder, [0.9, h * 0.52, 0.3], [side * w * 0.4, h * 0.5, w / 2 + 0.1], starBlue);
              addBox(holder, [0.3, h * 0.52, 0.9], [side * (w / 2 + 0.1), h * 0.5, 0], starBlue);
            }
          }
          solid(mall.x + px, mall.z + pz, w * 0.5, h + 0.7);
        }
        // Rooftop: the octagonal atrium skylight over the mass centroid, and plant.
        const [skyX, skyZ] = toLocal(23.813286, 90.42379);
        addCylinder(group, 17.5, 17.5, 1.4, [skyX, H + 1.2, skyZ], roofGrey, 8);
        addCone(group, 16.5, 4.5, [skyX, H + 4.15, skyZ], atriumGlass, 8);
        for (const [rx, rz, w, d] of [[40, -40, 14, 9], [-40, 50, 12, 10], [70, 40, 10, 14], [-20, -70, 16, 8], [20, 70, 12, 8]] as const) {
          addBox(group, [w, 3, d], [mall.x + rx, H + 2.2, mall.z + rz], roofGrey);
        }
        // Collision: three strips over the irregular mass, below the pavilions.
        solidBox(mall.x - 5, mall.z, 110, 78, H + 0.7);
        solidBox(mall.x + 20, mall.z - 95, 60, 17, H + 0.7);
        solidBox(mall.x + 25, mall.z + 95, 65, 17, H + 0.7);
        solidBox(mall.x + 111, mall.z + 30, 7, 50, H + 0.7);
        perchTarget = [mall.x - 100.9, mall.z - 10.4];
        // The rides on the south-west forecourt: a red coaster on blue
        // trestles, a red pendulum ride and a red drop tower.
        const rides = new THREE.Group();
        rides.position.set(mall.x - 205, 0, mall.z + 82);
        group.add(rides);
        addBox(rides, [112, 0.12, 100], [0, 0.06, 0], roofGrey).castShadow = false;
        const SEGMENTS = 28;
        const trackPoint = (index: number): [number, number, number] => {
          const angle = (index / SEGMENTS) * Math.PI * 2;
          return [Math.cos(angle) * 34, 9 + 6 * Math.sin(angle * 2) + 3 * Math.cos(angle), Math.sin(angle) * 14 - 14];
        };
        for (let index = 0; index < SEGMENTS; index++) {
          const a = trackPoint(index);
          const b = trackPoint(index + 1);
          addBeam(rides, a, b, 1.8, 0.5, monumentRed, 0.4);
          if (index % 2 === 0) addBox(rides, [0.6, a[1], 0.6], [a[0], a[1] / 2, a[2]], carnivalBlue);
        }
        for (const side of [-1, 1]) {
          addBeam(rides, [side * 7, 0, 22], [0, 24, 22], 0.9, 0.9, monumentRed);
          addBeam(rides, [side * 7, 0, 28], [0, 24, 28], 0.9, 0.9, monumentRed);
        }
        addBeam(rides, [0, 24, 25], [9, 8, 25], 1.2, 1.2, accent);
        addCylinder(rides, 3.4, 3.4, 1.4, [9.6, 7.2, 25], carnivalBlue, 10);
        addBox(rides, [2.6, 32, 2.6], [32, 16, 26], monumentRed);
        addCylinder(rides, 2.6, 2.6, 2.2, [32, 21, 26], accent, 8);
        solid(mall.x - 205, mall.z + 68, 34, 17);
        solid(mall.x - 205 + 32, mall.z + 82 + 26, 2, 32);
        clearSite(mall.x - 205, mall.z + 82, 56, 50);
      }
    } else if (landmark.kind === "hatirjheel-bridge") {
      // Hatirjheel's signature bridge (OSM way 444229773, 193 m): a straight
      // pale deck low over the lake, crowned by four pairs of white concrete
      // arch ribs that spring from the deck edges, lean in over the road and
      // are tied by short struts at the crown, so side-on they read as a wave
      // with the main arch tallest. From the NW end the spans are 30, 55, 40
      // and 35 m. Local +Z runs down the axis to the SE (138°), +X is NE.
      boundsCollider = false;
      // The map draws the two carriageways (and their shoulders) flat on the
      // water 7 m apart; the deck covers both, and its deep girder fascia
      // comes down to just above them so they never show beneath it.
      const DX = 3.5;
      const HALF = 96.5;
      const TOP = 3;
      const END = 0.7;
      const deckY = (s: number) => {
        const a = Math.abs(s);
        return a <= 68 ? TOP : TOP + (END - TOP) * Math.min(1, (a - 68) / (HALF - 68));
      };
      const along = (dx: number, lift = 0): QuadPoint[] => {
        const path: QuadPoint[] = [];
        for (let s = -HALF; s <= HALF + 0.01; s += 4) path.push([DX + dx, deckY(s) + lift, s]);
        return path;
      };
      const EDGE = 10.4;
      addSweptBox(group, along(0), 13.4, 0.4, paleConcrete, 0, 0.62);
      addSweptBox(group, along(0, 0.07), 8, 0.4, roofGrey);
      addSweptBox(group, along(0, 0.3), 0.5, 0.6, whiteStone);
      for (const side of [-1, 1]) {
        addSweptBox(group, along(side * 11.7, 0.25), 1.5, 0.5, concrete);
        addSweptBox(group, along(side * 13.25, 1.15), 0.12, 1.1, plantGrey);
      }
      // Arch pairs: [start, end, rise] along the axis (lake water spans ±78 m).
      const ARCHES: Array<[number, number, number]> = [[-80, -50, 10], [-50, 5, 18], [5, 45, 13], [45, 80, 11]];
      const CROWN_GAP = 3;
      const SEGMENTS = 12;
      const ribPoint = (s0: number, s1: number, rise: number, side: number, t: number): QuadPoint => {
        const s = s0 + (s1 - s0) * t;
        const h = rise * Math.sin(Math.PI * t);
        return [DX + side * (EDGE - ((EDGE - CROWN_GAP) * h) / rise), deckY(s) + h, s];
      };
      for (const [s0, s1, rise] of ARCHES) {
        for (const side of [-1, 1]) {
          for (let step = 0; step < SEGMENTS; step++) {
            addBeam(group, ribPoint(s0, s1, rise, side, step / SEGMENTS), ribPoint(s0, s1, rise, side, (step + 1) / SEGMENTS), 1.3, 1.1, whiteStone, 0.7);
          }
          // Springing blocks where the ribs land on the deck edge.
          addBox(group, [2.2, 1.4, 3.2], [DX + side * EDGE, deckY(s0) + 0.7, s0], whiteStone);
          if (s1 === 80) addBox(group, [2.2, 1.4, 3.2], [DX + side * EDGE, deckY(s1) + 0.7, s1], whiteStone);
        }
        // Crown struts tie the two ribs where they lean closest.
        const struts = rise > 15 ? [0.3, 0.4, 0.5, 0.6, 0.7] : [0.36, 0.5, 0.64];
        for (const t of struts) addBeam(group, ribPoint(s0, s1, rise, -1, t), ribPoint(s0, s1, rise, 1, t), 0.8, 0.8, whiteStone);
        // Hangers every 5 m down to the deck edges, on the main span only.
        if (rise > 15) {
          for (let s = s0 + 5; s < s1 - 2; s += 5) {
            const t = (s - s0) / (s1 - s0);
            for (const side of [-1, 1]) {
              const top = ribPoint(s0, s1, rise, side, t);
              addBeam(group, top, [DX + side * EDGE, deckY(s) + 0.4, s], 0.16, 0.16, plantGrey);
            }
          }
        }
        solid(DX, (s0 + s1) / 2, 4, deckY((s0 + s1) / 2) + rise + 0.7);
      }
      // The deck the bird can stand on, in short square columns along it.
      for (let s = -HALF + 6; s <= HALF - 5; s += 12) solid(DX, s, 12, deckY(s));
      // Keep generic blocks off both landings.
      for (const end of [-1, 1]) clearSite(DX, end * (HALF + 14), 16, 15);
      perchTarget = [DX, -22.5];
    } else if (landmark.kind === "kuril-flyover") {
      // Kuril Flyover: one-lane box-girder ramps (8.5 m, 1.6 m deep, pale
      // concrete with parapets) on single round piers with hammerheads, tying
      // a knot over Airport Road, the rail line and the ponds in its loops
      // (map water). The three chains join the ten OSM ways named "Kuril
      // Flyover" end to end; heights run from the free ground ends up to layer
      // 1 (8 m) and layer 2 (15 m). Heading 0, so local axes are world axes.
      boundsCollider = false;
      type Ramp = { points: Array<[number, number]>; heights: Array<[number, number]> };
      const RAMPS: Ramp[] = [
        // 1207428605 (ground) → 316785308 (layer 1, the 470 m hook) → 1207086854.
        {
          points: [[23.8203951, 90.4170930], [23.8206336, 90.4173414], [23.8210005, 90.4178943], [23.8210704, 90.4180041], [23.8211315, 90.4180929], [23.8212386, 90.4182394], [23.8213518, 90.4183896], [23.8214946, 90.4185815], [23.8216086, 90.4187333], [23.8216581, 90.4187971], [23.8217236, 90.4188689], [23.8217941, 90.4189419], [23.8218800, 90.4190288], [23.8219580, 90.4191023], [23.8220193, 90.4191529], [23.8220908, 90.4192031], [23.8221778, 90.4192658], [23.8222272, 90.4193176], [23.8222745, 90.4193753], [23.8223197, 90.4194531], [23.8223522, 90.4195196], [23.8223709, 90.4195736], [23.8223824, 90.4196485], [23.8223842, 90.4197218], [23.8223814, 90.4198201], [23.8223680, 90.4199479], [23.8223414, 90.4200960], [23.8223068, 90.4202861], [23.8222624, 90.4204819], [23.8222351, 90.4205838], [23.8221857, 90.4206958], [23.8221525, 90.4207522], [23.8221122, 90.4207974], [23.8220565, 90.4208504], [23.8220101, 90.4208859], [23.8219567, 90.4209191], [23.8218917, 90.4209432], [23.8218419, 90.4209590], [23.8217505, 90.4209811], [23.8216843, 90.4209808], [23.8216046, 90.4209754], [23.8215629, 90.4209646], [23.8215082, 90.4209533], [23.8214211, 90.4209259], [23.8210697, 90.4207805], [23.8208244, 90.4206646], [23.8207166, 90.4206003], [23.8205928, 90.4205094]],
          heights: [[0, 0.75], [150, 8], [590, 8], [650, 0.75]],
        },
        // 569957263 → 569962327 (layer 1) → 917305509 (layer 2, the hairpin)
        // → 316785309 (layer 1) → 1207086856 (ground).
        {
          points: [[23.8252300, 90.4219105], [23.8251931, 90.4219101], [23.8251330, 90.4219048], [23.8250753, 90.4218873], [23.8250397, 90.4218726], [23.8250017, 90.4218558], [23.8249453, 90.4218256], [23.8249249, 90.4218125], [23.8248869, 90.4217881], [23.8248360, 90.4217590], [23.8247815, 90.4217298], [23.8246207, 90.4216560], [23.8245542, 90.4216229], [23.8244536, 90.4215926], [23.8243671, 90.4215775], [23.8242628, 90.4215625], [23.8229523, 90.4214569], [23.8227876, 90.4214396], [23.8226981, 90.4214261], [23.8226204, 90.4213994], [23.8225684, 90.4213737], [23.8225154, 90.4213366], [23.8224562, 90.4212841], [23.8223970, 90.4212216], [23.8223476, 90.4211484], [23.8223203, 90.4210912], [23.8222988, 90.4210262], [23.8222895, 90.4209625], [23.8222852, 90.4208874], [23.8222893, 90.4207828], [23.8223049, 90.4206338], [23.8223312, 90.4204810], [23.8223637, 90.4203422], [23.8224056, 90.4202026], [23.8224341, 90.4201310], [23.8224849, 90.4200397], [23.8225464, 90.4199676], [23.8226234, 90.4199063], [23.8227005, 90.4198707], [23.8227934, 90.4198412], [23.8228798, 90.4198244], [23.8229586, 90.4198297], [23.8230449, 90.4198408], [23.8231259, 90.4198596], [23.8232375, 90.4198875], [23.8235835, 90.4200186], [23.8237761, 90.4200847], [23.8238554, 90.4201064], [23.8239445, 90.4201315], [23.8240933, 90.4201839], [23.8243009, 90.4202329], [23.8244087, 90.4202551], [23.8245204, 90.4202778], [23.8246263, 90.4203039], [23.8247345, 90.4203233], [23.8248443, 90.4203396], [23.8252082, 90.4203790], [23.8254053, 90.4204313]],
          heights: [[0, 0.75], [81, 7], [170, 15], [390, 15], [792, 0.75]],
        },
        // 316785310 (layer 2 over the expressway) → 1307888384 (ground). Its
        // west end joins ways not in the snapshot, so it is landed there.
        {
          points: [[23.8250362, 90.4211850], [23.8250109, 90.4213417], [23.8250079, 90.4214604], [23.8250186, 90.4215745], [23.8250317, 90.4216448], [23.8250518, 90.4217575], [23.8250975, 90.4219643], [23.8251230, 90.4220852], [23.8251869, 90.4223723], [23.8252434, 90.4226610], [23.8253241, 90.4230412], [23.8255060, 90.4238220], [23.8256522, 90.4244002], [23.8257638, 90.4247858]],
          heights: [[0, 0.75], [100, 15], [193, 15], [377, 0.75]],
        },
      ];
      const DECK_HALF = 4.25;
      const DEPTH = 1.6;
      let bestPerch = -1;
      RAMPS.forEach((ramp, rampIndex) => {
        // Resample to ≤ 9 m steps so the height profile bends smoothly.
        const plan = ramp.points.map(([lat, lon]) => toLocal(lat, lon));
        const samples: Array<{ x: number; z: number; s: number; dx: number; dz: number }> = [];
        let travelled = 0;
        for (let index = 0; index < plan.length - 1; index++) {
          const [ax, az] = plan[index];
          const [bx, bz] = plan[index + 1];
          const length = Math.hypot(bx - ax, bz - az);
          const steps = Math.max(1, Math.ceil(length / 9));
          for (let step = 0; step < steps; step++) {
            const t = step / steps;
            samples.push({ x: ax + (bx - ax) * t, z: az + (bz - az) * t, s: travelled + length * t, dx: (bx - ax) / length, dz: (bz - az) / length });
          }
          travelled += length;
          if (index === plan.length - 2) samples.push({ x: bx, z: bz, s: travelled, dx: (bx - ax) / length, dz: (bz - az) / length });
        }
        const heightAt = (s: number) => {
          const keys = ramp.heights;
          if (s <= keys[0][0]) return keys[0][1];
          for (let index = 1; index < keys.length; index++) {
            const [s1, h1] = keys[index];
            const [s0, h0] = keys[index - 1];
            if (s <= s1) return h0 + ((h1 - h0) * (s - s0)) / (s1 - s0);
          }
          return keys[keys.length - 1][1];
        };
        const path: QuadPoint[] = samples.map(({ x, z, s }) => [x, heightAt(s), z]);
        addSweptBox(group, path, DECK_HALF, DEPTH, paleConcrete);
        addSweptBox(group, path.map(([x, y, z]) => [x, y + 0.06, z] as QuadPoint), DECK_HALF - 0.6, 0.3, roofGrey);
        for (const side of [-1, 1]) {
          addSweptBox(group, path.map(([x, y, z]) => [x, y + 1, z] as QuadPoint), 0.22, 1.3, concrete, side * (DECK_HALF - 0.22));
        }
        // Piers every ≈30 m wherever the deck is clear of the ground, each a
        // round column under a hammerhead turned square to the deck.
        let nextPier = 12;
        let nextColumn = 0;
        for (const { x, z, s, dx, dz } of samples) {
          const top = heightAt(s);
          if (s >= nextPier && top > 3.2) {
            nextPier = s + 30;
            const column = top - DEPTH - 1.5;
            addCylinder(group, 0.9, 0.9, column, [x, column / 2, z], concrete, 8);
            const head = addBox(group, [6.4, 1.5, 2.2], [x, column + 0.75, z], concrete);
            head.rotation.y = Math.atan2(dx, dz);
          }
          if (s >= nextColumn && top > 2.4) {
            // Overlapping columns as wide as the deck and its parapets.
            nextColumn = s + 6;
            solid(x, z, DECK_HALF + 0.8, top + 0.4);
          }
          // The perch: the middle of the layer-2 hairpin (way 917305509).
          if (rampIndex === 1 && bestPerch < 0 && s >= 243) {
            bestPerch = s;
            perchTarget = [x, z];
          }
        }
      });
    } else if (landmark.kind === "gulshan-central-mosque") {
      // Gulshan Central Mosque & Eidgah (Azad Masjid): a white two-storey hall
      // famous for its folded-plate facade, a row of tapering fins whose
      // points rise above the roof as a sawtooth crest, dark trapezoid windows
      // between them over a ground-floor arcade of round arches. A separate
      // white arched loggia runs along the forecourt, palms line it, and the
      // Eidgah lawn opens to the east. The minaret with its saucer balcony
      // and pine-cone lantern stands at the south end. Local +Z faces east
      // (the front), +X points north.
      colliderTop = 13.2;
      const HX = 30;
      const HZ = 20;
      addBox(group, [HX * 2, 13, HZ * 2], [0, 6.5, 0], whiteStone);
      addBox(group, [HX * 2 - 2, 0.2, HZ * 2 - 2], [0, 13.05, 0], concrete);
      // The plain stair tower at the north end of the facade.
      addBox(group, [6, 16.5, 9], [HX - 3, 8.25, HZ - 5], whiteStone);
      const BAY = 5.5;
      const fin = new THREE.Shape();
      fin.moveTo(-0.35, 4.6);
      fin.lineTo(0.35, 4.6);
      fin.lineTo(1.35, 13);
      fin.lineTo(0, 17.6);
      fin.lineTo(-1.35, 13);
      fin.lineTo(-0.35, 4.6);
      const finGeometry = new THREE.ExtrudeGeometry(fin, { depth: 1.9, bevelEnabled: false });
      const trapezoid = new THREE.Shape();
      trapezoid.moveTo(-1.1, 0);
      trapezoid.lineTo(1.1, 0);
      trapezoid.lineTo(1.5, 3);
      trapezoid.lineTo(-1.5, 3);
      trapezoid.lineTo(-1.1, 0);
      const trapezoidGeometry = shapeGeometry(trapezoid, 1);
      const arcadeArch = roundArch(4.4, 4.9);
      const upperArch = rectPane(2.6, 1.5);
      for (let bay = 0; bay <= 10; bay++) {
        const x = -HX + 2.5 + bay * BAY;
        const finMesh = new THREE.Mesh(finGeometry, whiteStone);
        finMesh.position.set(x - BAY / 2, 0, HZ - 0.4);
        group.add(finMesh);
        if (bay === 10) {
          const last = new THREE.Mesh(finGeometry, whiteStone);
          last.position.set(x + BAY / 2, 0, HZ - 0.4);
          group.add(last);
        }
        for (const [geometry, y] of [[arcadeArch, 0.3], [trapezoidGeometry, 6.2], [upperArch, 10.6]] as const) {
          const pane = new THREE.Mesh(geometry, recess);
          pane.position.set(x, y, HZ + 0.12);
          group.add(pane);
        }
      }
      // The loggia: two arched screens under a flat roof along the forecourt,
      // with a return at the south end beside the minaret.
      const archScreen = (length: number, height: number, span: number) => {
        const shape = new THREE.Shape();
        shape.moveTo(-length / 2, -0.3);
        shape.lineTo(length / 2, -0.3);
        shape.lineTo(length / 2, height);
        shape.lineTo(-length / 2, height);
        shape.lineTo(-length / 2, -0.3);
        const count = Math.max(1, Math.floor(length / (span + 1.4)));
        const pitch = length / count;
        for (let index = 0; index < count; index++) {
          const cx = -length / 2 + pitch * (index + 0.5);
          const hole = new THREE.Path();
          hole.moveTo(cx - span / 2, 0);
          hole.lineTo(cx + span / 2, 0);
          hole.lineTo(cx + span / 2, height - span / 2 - 0.7);
          hole.absarc(cx, height - span / 2 - 0.7, span / 2, 0, Math.PI, false);
          hole.lineTo(cx - span / 2, 0);
          shape.holes.push(hole);
        }
        return new THREE.ExtrudeGeometry(shape, { depth: 0.6, bevelEnabled: false, curveSegments: 6 });
      };
      const LOGGIA_Z = 31;
      const LOGGIA_FROM = -50;
      const LOGGIA_TO = 36;
      const loggiaLength = LOGGIA_TO - LOGGIA_FROM;
      const front = archScreen(loggiaLength, 4.6, 5.6);
      for (const z of [LOGGIA_Z + 5.4, LOGGIA_Z - 0.6]) {
        const screen = new THREE.Mesh(front, whiteStone);
        screen.position.set((LOGGIA_FROM + LOGGIA_TO) / 2, 0, z);
        group.add(screen);
      }
      addBox(group, [loggiaLength + 0.6, 0.8, 6.8], [(LOGGIA_FROM + LOGGIA_TO) / 2, 4.9, LOGGIA_Z + 2.7], whiteStone);
      const returnLength = LOGGIA_Z - (HZ - 2);
      const roofLength = returnLength - 0.7;
      const side = archScreen(returnLength, 4.6, 5.6);
      for (const x of [LOGGIA_FROM, LOGGIA_FROM + 6]) {
        const screen = new THREE.Mesh(side, whiteStone);
        screen.rotation.y = Math.PI / 2;
        screen.position.set(x - 0.3, 0, (HZ - 2 + LOGGIA_Z) / 2);
        group.add(screen);
      }
      addBox(group, [6.8, 0.8, roofLength], [LOGGIA_FROM + 3, 4.9, HZ - 2 + roofLength / 2], whiteStone);
      // Paved forecourt, the Eidgah lawn and the palms along the loggia.
      addBox(group, [LOGGIA_TO - LOGGIA_FROM + 8, 0.1, LOGGIA_Z - HZ + 8], [(LOGGIA_FROM + LOGGIA_TO) / 2, 0.05, (HZ + LOGGIA_Z + 6) / 2], paleConcrete).castShadow = false;
      addBox(group, [88, 0.08, 114], [-12, 0.04, 98], lawn).castShadow = false;
      for (let x = -42; x <= 30; x += 9) addPalm(group, x + 2, LOGGIA_Z + 10, 10.5, 0.05, x * 0.37);
      // Minaret: a faceted shaft tapering from 3 m to 1.5 m, a saucer
      // balcony, a short neck, a fluted pine-cone lantern and a spire.
      const MX = -HX - 4;
      const MZ = 12;
      addCylinder(group, 1.5, 3, 19.5, [MX, 9.75, MZ], whiteStone, 8);
      addLathe(group, [[0.6, 0], [3.4, 0.5], [3.7, 1.1], [3.1, 1.6], [1.5, 1.8]], 16, [MX, 19.4, MZ], whiteStone);
      addCylinder(group, 1.25, 1.35, 3.6, [MX, 22.8, MZ], whiteStone, 8);
      addLathe(group, [[1.3, 0], [2.3, 0.9], [2.4, 2.4], [1.3, 3.9], [0.3, 5.2]], 8, [MX, 24.4, MZ], whiteStone, true);
      addCone(group, 0.35, 3.2, [MX, 31.2, MZ], whiteStone, 6);
      solid(MX, MZ, 1.6, 32.8);
      solid(HX - 3, HZ - 5, 4.5, 16.6);
      clearSite(-12, 98, 44, 58);
      clearSite((LOGGIA_FROM + LOGGIA_TO) / 2, (HZ + LOGGIA_Z + 6) / 2, (LOGGIA_TO - LOGGIA_FROM) / 2 + 4, (LOGGIA_Z - HZ + 8) / 2);
      // The perch is on the saucer balcony, beside the shaft.
      perchTarget = [MX + 2.9, MZ];
    } else if (landmark.kind === "army-stadium") {
      // Bangladesh Army Stadium, Banani (OSM 24821768, 145 × 218 m): a pale
      // single-tier bowl round a red eight-lane running track and a striped
      // football field, the renovated two-storey brick-and-glass grandstand
      // on the west straight under a long flat white canopy, and four lattice
      // floodlight pylons at the corners. Local +Z faces west (279°) toward
      // Airport Road; the long axis is local X (+X is south).
      colliderTop = 1;
      const SEG = 72;
      // A rounded-rectangle (superellipse) outline with half axes a (X) and b (Z).
      const rim = (a: number, b: number, theta: number, power = 3): [number, number] => {
        const s = Math.sin(theta);
        const c = Math.cos(theta);
        return [a * Math.sign(s) * Math.abs(s) ** (2 / power), b * Math.sign(c) * Math.abs(c) ** (2 / power)];
      };
      // A ring of quads between two outlines ([a, b, power] each) at heights
      // yIn and yOut, facing up, or (for a wall) in toward the field or out.
      const ring = (inner: [number, number, number], outer: [number, number, number], yIn: number, yOut: number, facing: "up" | "in" | "out" = "up") => {
        const quads: Array<[QuadPoint, QuadPoint, QuadPoint, QuadPoint, QuadPoint]> = [];
        for (let index = 0; index < SEG; index++) {
          const t0 = (index / SEG) * Math.PI * 2;
          const t1 = ((index + 1) / SEG) * Math.PI * 2;
          const i0 = rim(inner[0], inner[1], t0, inner[2]);
          const i1 = rim(inner[0], inner[1], t1, inner[2]);
          const o0 = rim(outer[0], outer[1], t0, outer[2]);
          const o1 = rim(outer[0], outer[1], t1, outer[2]);
          const sign = facing === "in" ? -1 : 1;
          const out: QuadPoint = facing === "up" ? [0, 1, 0] : [sign * i0[0], 0, sign * i0[1]];
          quads.push([[i0[0], yIn, i0[1]], [i1[0], yIn, i1[1]], [o1[0], yOut, o1[1]], [o0[0], yOut, o0[1]], out]);
        }
        return quads;
      };
      const TRACK_IN: [number, number, number] = [75, 42.5, 2.6];
      const TRACK_OUT: [number, number, number] = [85, 52.5, 2.6];
      const APRON: [number, number, number] = [89, 57, 2.8];
      const BOWL_TOP: [number, number, number] = [107, 71, 3];
      const OUTER: [number, number, number] = [108.5, 72.5, 3];
      // Infield (a fan of triangles drawn as degenerate quads), track, apron.
      const infield: Array<[QuadPoint, QuadPoint, QuadPoint, QuadPoint, QuadPoint]> = [];
      for (let index = 0; index < SEG; index++) {
        const a = rim(TRACK_IN[0], TRACK_IN[1], (index / SEG) * Math.PI * 2, TRACK_IN[2]);
        const b = rim(TRACK_IN[0], TRACK_IN[1], ((index + 1) / SEG) * Math.PI * 2, TRACK_IN[2]);
        infield.push([[0, 0.08, 0], [a[0], 0.08, a[1]], [b[0], 0.08, b[1]], [0, 0.08, 0], [0, 1, 0]]);
      }
      addQuads(group, infield, lawn);
      addQuads(group, ring(TRACK_IN, TRACK_OUT, 0.1, 0.1), plazaRed);
      addQuads(group, ring(TRACK_OUT, APRON, 0.1, 0.1), concrete);
      // The terraces rise from a 1.2 m front wall to 9 m at the back, with a
      // parapet and the outer wall round the outside.
      addQuads(group, [
        ...ring(APRON, APRON, 0, 1.2, "in"),
        ...ring(BOWL_TOP, OUTER, 10, 10),
        ...ring(BOWL_TOP, BOWL_TOP, 9, 10, "in"),
        ...ring(OUTER, OUTER, 0, 10, "out"),
      ], concrete);
      addQuads(group, ring(APRON, BOWL_TOP, 1.2, 9), paleConcrete);
      // Football field with mown stripes and goal mouths.
      addBox(group, [105, 0.1, 68], [0, 0.12, 0], lawn).castShadow = false;
      for (let stripe = -3; stripe <= 3; stripe += 2) addBox(group, [105 / 7, 0.06, 68], [stripe * (105 / 7), 0.2, 0], landmarkLightCanopy).castShadow = false;
      for (const end of [-1, 1]) addBox(group, [0.4, 2.4, 7.3], [end * 52.5, 1.3, 0], whiteStone);
      // West grandstand: a 120 m two-storey block behind the west terraces,
      // brick below, a teal glass band above, a cream fascia and name board,
      // and the cantilevered white canopy over the seats.
      addBox(group, [120, 12, 14], [0, 6, 73], paleConcrete);
      addBox(group, [118, 4.6, 0.3], [0, 2.5, 80.1], brickTrim);
      addBox(group, [118, 3.6, 0.3], [0, 8, 80.1], atriumGlass);
      addBox(group, [30, 2.6, 1.2], [0, 13.3, 78.6], paleConcrete);
      addBox(group, [110, 0.8, 21], [0, 16.4, 68.5], whiteStone);
      for (let x = -50; x <= 50; x += 12.5) addBox(group, [0.8, 4.4, 0.8], [x, 14, 78.4], whiteStone);
      solidBox(0, 70, 60, 11, 16.8);
      // Four lattice floodlight pylons at the corners, lamps turned inward.
      for (const sx of [-1, 1]) {
        for (const sz of [-1, 1]) {
          const px = sx * 100;
          const pz = sz * 68;
          const pylon = new THREE.Group();
          pylon.position.set(px, 0, pz);
          pylon.rotation.y = Math.atan2(-px, -pz);
          group.add(pylon);
          const H = 38;
          for (const cx of [-1, 1]) {
            for (const cz of [-1, 1]) addBeam(pylon, [cx * 2.2, 0, cz * 2.2], [cx * 0.8, H, cz * 0.8], 0.35, 0.35, concrete);
          }
          for (let y = 6; y < H; y += 8) {
            const r = 2.2 - (1.4 * y) / H;
            for (const cz of [-1, 1]) addBeam(pylon, [-r, y, cz * r], [r, y + 4, cz * r], 0.2, 0.2, concrete);
          }
          addBox(pylon, [7, 4.6, 0.9], [0, H + 2, 0.6], whiteStone).rotation.x = 0.35;
          addBox(pylon, [7.4, 0.5, 2.2], [0, H - 0.4, 0], concrete);
          solid(px, pz, 2.5, H + 4.5);
        }
      }
      // The bowl strikes as a ring of columns; the field stays open.
      for (let index = 0; index < 28; index++) {
        const [x, z] = rim(98, 64, (index / 28) * Math.PI * 2, 3);
        solid(x, z, 10, 9.5);
      }
      clearOval(0, 0, 108.5, 80, 10);
      perchTarget = [0, 66];
    } else if (landmark.kind === "tsc-raju") {
      // TSC (Teacher-Student Centre) and the Raju Memorial Sculpture. The TSC
      // main block (OSM 655714604) is a long modernist slab of open galleries:
      // a grey concrete frame on a 4.5 m grid, thin white slab edges with a
      // pale blue spandrel band under each, white jali screens in some bays,
      // and a deep overhanging roof. The auditorium behind it has a low
      // barrel roof. Sixty metres north, on the TSC Mor roundabout, seven
      // linked figures stride on a grey granite drum (×1.4). Footprint mode:
      // local axes are world axes.
      boundsCollider = false;
      const MAIN = 655714604;
      const AUDITORIUM = 447734507;
      const GAME_ROOM = 507722586;
      const main = frame(MAIN, [-0.156, -0.988]);
      if (main) {
        const { g, hx, hz } = main;
        for (const y of [3.8, 7.4, 11]) {
          addBox(g, [hx * 2 + 1.2, 0.35, hz * 2 + 1.8], [0, y, 0], whiteStone);
          addBox(g, [hx * 2 + 0.5, 1, hz * 2 + 0.6], [0, y - 0.68, 0], skyGlass);
        }
        addBox(g, [hx * 2 + 2.4, 0.6, hz * 2 + 8], [0, 15.3, 0], roofGrey);
        const bays = Math.round((hx * 2) / 4.5);
        for (let bay = 0; bay <= bays; bay++) {
          const x = -hx + (bay * hx * 2) / bays;
          for (const face of [-1, 1]) addBox(g, [0.45, 15, 0.5], [x, 7.5, face * (hz + 0.35)], whiteStone);
        }
        for (const bay of [3, 4, 9, 10]) {
          const x = -hx + ((bay + 0.5) * hx * 2) / bays;
          for (const y of [5.6, 9.2]) addBox(g, [(hx * 2) / bays - 0.6, 2.2, 0.2], [x, y, hz + 0.18], paleConcrete);
        }
      }
      const hall = frame(AUDITORIUM, [0, -1]);
      if (hall) {
        const vault = new THREE.Mesh(new THREE.CylinderGeometry(hall.hz, hall.hz, hall.hx * 2, 14, 1, false, 0, Math.PI), roofGrey);
        vault.rotation.z = Math.PI / 2;
        vault.scale.set(2.6 / hall.hz, 1, 1);
        vault.position.set(0, hall.height, 0);
        hall.g.add(vault);
      }
      for (const [id, top] of [[MAIN, 15.6], [AUDITORIUM, 12.6], [GAME_ROOM, 5]] as const) {
        const seat = anchor(id);
        if (seat) solidBox(seat.x, seat.z, seat.width / 2, seat.depth / 2, top);
      }
      // Raju Memorial on its kerbed lawn island.
      const [rx, rz] = toLocal(23.732649, 90.39568);
      addCylinder(group, 7.2, 7.4, 0.6, [rx, 0.25, rz], concrete, 24);
      addCylinder(group, 6.7, 6.7, 0.1, [rx, 0.58, rz], lawn, 24);
      addCylinder(group, 3.85, 4.9, 4.2, [rx, 2.7, rz], stoneStep, 12);
      addCylinder(group, 3.6, 3.9, 0.4, [rx, 5, rz], concrete, 12);
      const figures = new THREE.Group();
      figures.position.set(rx, 5.2, rz);
      figures.rotation.y = Math.PI;
      group.add(figures);
      for (let index = -3; index <= 3; index++) {
        const x = index * 1.2;
        const z = 1.1 * (1 - (index / 3.4) ** 2);
        const tall = 1 + ((index * 7 + 3) % 3) * 0.03;
        if (index === 0) {
          addCylinder(figures, 0.42, 0.68, 2.3 * tall, [x, 1.15 * tall, z], paleConcrete, 6);
        } else {
          // Striding legs, one forward and one back.
          for (const leg of [-1, 1]) {
            const limb = addBox(figures, [0.34, 2.3 * tall, 0.4], [x + leg * 0.2, 1.1 * tall, z + leg * 0.22], paleConcrete);
            limb.rotation.x = leg * 0.2;
          }
        }
        addBox(figures, [1.02, 1.55 * tall, 0.55], [x, 2.98 * tall, z], paleConcrete);
        addBox(figures, [1.2, 0.35, 0.6], [x, 3.65 * tall, z], paleConcrete);
        const head = new THREE.Mesh(new THREE.SphereGeometry(0.36, 7, 5), paleConcrete);
        head.position.set(x, 4.12 * tall, z + 0.05);
        figures.add(head);
      }
      addBeam(figures, [-3.6, 3, 0.55], [0, 3, 1.4], 0.32, 0.32, paleConcrete, 0.3);
      addBeam(figures, [0, 3, 1.4], [3.6, 3, 0.55], 0.32, 0.32, paleConcrete, 0.3);
      solid(rx, rz, 4.9, 5.3);
      clearSite(rx, rz, 8, 8);
      // The head of the woman at the centre of the group (the figures face north).
      perchTarget = [rx, rz - 1.15];
    } else if (landmark.kind === "doyel-chattar") {
      // Doyel Chattar: two black-and-white magpie-robins (doyel, the national
      // bird) with long wings swept up in a V, on a pale lens-shaped disc
      // carried on short posts over a round sky-blue basin with a yellow base
      // band and white coping, in a lawn island inside the roundabout. ×1.3.
      // Local +Z is where the beaks point (NW).
      colliderTop = 1.8;
      addCylinder(group, 14, 14, 0.12, [0, 0.06, 0], lawn, 32);
      addLathe(group, [[9.1, 0.35], [9.1, 1.56], [8.5, 1.56], [8.5, 0.95]], 40, [0, 0, 0], poolTurquoise);
      addLathe(group, [[9.18, 0.05], [9.18, 0.4]], 40, [0, 0, 0], accent);
      addLathe(group, [[9.25, 1.5], [9.25, 1.72], [8.42, 1.72], [8.42, 1.5]], 40, [0, 0, 0], whiteStone);
      addCylinder(group, 8.55, 8.55, 0.2, [0, 1, 0], poolTurquoise, 32);
      // The lens disc on short posts, lifted clear of the coping.
      for (const x of [-1.8, 1.8]) addCylinder(group, 0.6, 0.6, 1.7, [x, 1.9, 0], poolTurquoise, 10);
      addLathe(group, [[0.01, 2.65], [4.9, 2.9], [4.95, 3.15], [0.01, 3.4]], 28, [0, 0, 0], concrete);
      // Each wing is a long blade, broad at the root and pointed at the tip,
      // its broad face turned mostly to the front, with a white stripe along
      // the leading edge. The left wing is the mirror image of the right.
      const blade = (points: Array<[number, number]>, mirror: boolean, depth: number) => {
        const shape = new THREE.Shape();
        points.forEach(([x, y], index) => (index === 0 ? shape.moveTo(x, mirror ? -y : y) : shape.lineTo(x, mirror ? -y : y)));
        const geometry = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: false });
        geometry.translate(0, 0, -depth / 2);
        // Twisted along the span so the broad face shows from the front, the
        // sides and above, not only head-on.
        geometry.rotateX(mirror ? -0.6 : 0.6);
        return geometry;
      };
      const WING: Array<[number, number]> = [[0, -0.75], [3.2, -0.45], [4.3, 0.05], [3.4, 0.45], [0, 0.75]];
      const STRIPE: Array<[number, number]> = [[0.35, 0.36], [3.3, 0.2], [4.05, 0.08], [3.35, 0.36], [0.35, 0.6]];
      const wingGeometries = [false, true].map((mirror) => blade(WING, mirror, 0.18));
      const stripeGeometries = [false, true].map((mirror) => blade(STRIPE, mirror, 0.24));
      const bellyGeometry = new THREE.SphereGeometry(1, 12, 6, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2);
      for (const [bx, bz, turn] of [[-2.4, -0.8, 0.1], [2.4, 0.6, -0.08]] as const) {
        const bird = new THREE.Group();
        bird.position.set(bx, 3.4, bz);
        bird.rotation.y = turn;
        bird.scale.setScalar(1.8);
        group.add(bird);
        const body = new THREE.Mesh(new THREE.SphereGeometry(1, 12, 8), recess);
        body.scale.set(0.7, 0.8, 1.4);
        body.position.set(0, 1.15, 0);
        body.rotation.x = -0.18;
        bird.add(body);
        const belly = new THREE.Mesh(bellyGeometry, whiteStone);
        belly.scale.set(0.74, 0.9, 1.34);
        belly.position.set(0, 1.12, 0);
        belly.rotation.x = -0.18;
        bird.add(belly);
        addCylinder(bird, 0.45, 0.5, 0.5, [0, 0.25, 0], whiteStone, 10);
        const head = new THREE.Mesh(new THREE.SphereGeometry(0.5, 10, 7), recess);
        head.position.set(0, 1.95, 1.2);
        bird.add(head);
        addCone(bird, 0.14, 0.6, [0, 1.9, 1.85], recess, 6).rotation.x = Math.PI / 2;
        addBox(bird, [0.5, 0.14, 1.3], [0, 1.6, -1.55], recess).rotation.x = 0.55;
        for (const side of [-1, 1]) {
          const holder = new THREE.Group();
          holder.position.set(side * 0.45, 1.45, 0.1);
          holder.rotation.set(-0.1, 0, side > 0 ? 0.75 : Math.PI - 0.75);
          bird.add(holder);
          const mirror = side < 0 ? 1 : 0;
          holder.add(new THREE.Mesh(wingGeometries[mirror], recess));
          holder.add(new THREE.Mesh(stripeGeometries[mirror], whiteStone));
        }
      }
      solid(0, 0, 4, 6.9);
      clearSite(0, 0, 14, 14);
      perchTarget = [2.4, 0.6];
    } else if (landmark.kind === "shapla-chattar") {
      // Shapla Chattar, Motijheel: a white water lily (shapla, the national
      // flower) in three rings of pointed petals round a yellow heart, raised
      // on a stem from a round fountain basin, on the lawn island of the
      // roundabout. The roundabout's centreline radius is about 25 m.
      colliderTop = 1.2;
      addCylinder(group, 12.5, 12.5, 0.14, [0, 0.07, 0], lawn, 36).castShadow = false;
      addLathe(group, [[8.2, 0.1], [8.2, 1.1], [7.5, 1.1], [7.5, 0.5]], 40, [0, 0, 0], whiteStone);
      addCylinder(group, 7.55, 7.55, 0.2, [0, 0.75, 0], water, 36).castShadow = false;
      // Lily pads floating round the stem.
      for (let pad = 0; pad < 6; pad++) {
        const angle = (pad / 6) * Math.PI * 2 + 0.4;
        const reach = 4.4 + (pad % 2) * 1.5;
        addCylinder(group, 1.25, 1.25, 0.08, [Math.cos(angle) * reach, 0.9, Math.sin(angle) * reach], lawn, 12).castShadow = false;
      }
      // Stem and calyx.
      addCylinder(group, 0.55, 0.8, 4.6, [0, 3.1, 0], whiteStone, 12);
      addLathe(group, [[0.55, 5.1], [1.9, 5.9], [2.1, 6.3], [0.01, 6.3]], 20, [0, 0, 0], lawn);
      const petalGeometry = (length: number, width: number) => {
        const shape = new THREE.Shape();
        shape.moveTo(0, 0);
        shape.quadraticCurveTo(width, length * 0.3, width * 0.72, length * 0.62);
        shape.lineTo(0, length);
        shape.lineTo(-width * 0.72, length * 0.62);
        shape.quadraticCurveTo(-width, length * 0.3, 0, 0);
        const geometry = new THREE.ExtrudeGeometry(shape, { depth: 0.22, bevelEnabled: false, curveSegments: 4 });
        geometry.translate(0, 0, -0.11);
        return geometry;
      };
      // [petals, length, half width, lean from vertical, root radius, phase]
      for (const [count, length, width, lean, root, phase] of [
        [10, 6.2, 1.25, 1.08, 1.5, 0],
        [8, 5.6, 1.1, 0.68, 1.0, 0.39],
        [6, 4.6, 0.9, 0.3, 0.55, 0.2],
      ] as const) {
        const geometry = petalGeometry(length, width);
        for (let index = 0; index < count; index++) {
          const holder = new THREE.Group();
          holder.position.set(0, 6.2, 0);
          holder.rotation.y = (index / count) * Math.PI * 2 + phase;
          const petal = new THREE.Mesh(geometry, whiteStone);
          petal.position.z = root;
          petal.rotation.x = lean;
          petal.castShadow = true;
          holder.add(petal);
          group.add(holder);
        }
      }
      const heart = new THREE.Mesh(new THREE.SphereGeometry(0.95, 12, 8), accent);
      heart.scale.y = 0.7;
      heart.position.set(0, 6.9, 0);
      group.add(heart);
      solid(0, 0, 5, 11);
      clearSite(0, 0, 12.5, 12.5);
    } else if (landmark.kind === "three-leaders-mausoleum") {
      // Mausoleum of Three Leaders (OSM 296802766): three white hyperbolic-
      // paraboloid shells in a row over the graves, each four tall pointed
      // "petals" that stand on four feet at the diagonals and sweep up to
      // sharp tips, so side on they read as a row of tall pointed arches and
      // from the air as three four-petal flowers. They stand on a 60 × 33 m
      // plinth with a pink-red border round a white marble field, broad
      // stairs front and back, in a paved garden of lawn beds and palm rows.
      // The small three-domed Haji Khwaja Shahbaz mosque stands to the NE.
      // Local +Z faces WSW (257°); the row runs along local X (+X is SSE).
      colliderTop = 1.3;
      const PLINTH = 1.2;
      // The paved garden court, its lawn beds and palm rows.
      addBox(group, [82, 0.1, 60], [0, 0.05, 0], roofTerrace).castShadow = false;
      for (const side of [-1, 1]) {
        for (const x of [-27, -15, 15, 27]) addBox(group, [7, 0.16, 3.4], [x, 0.12, side * 22.5], lawn).castShadow = false;
        addBox(group, [5, 0.16, 18], [side * 37, 0.12, 0], lawn).castShadow = false;
        addBox(group, [9, 0.16, 4], [side * 37, 0.12, 22], lawn).castShadow = false;
        addBox(group, [9, 0.16, 4], [side * 37, 0.12, -22], lawn).castShadow = false;
      }
      for (let z = -26; z <= 26; z += 6.5) addPalm(group, -39.5, z, 9 + ((z * 7) % 3), 0.06, z);
      for (let x = -30; x <= 30; x += 10) addPalm(group, x, 28.5, 8.5 + ((x * 3) % 2), 0.07, x);
      for (let z = -20; z <= 20; z += 10) addPalm(group, 39.5, z, 9, 0.05, z * 2);
      // The plinth: a pink-red sandstone border round the marble field, with
      // a grid of joints, and stairs on both long sides and both ends.
      addBox(group, [60, PLINTH, 33], [0, PLINTH / 2, 0], terracotta);
      addBox(group, [53, 0.08, 26], [0, PLINTH + 0.04, 0], marble);
      for (let x = -22; x <= 22; x += 4.4) addBox(group, [0.16, 0.05, 26], [x, PLINTH + 0.1, 0], roofTerrace).castShadow = false;
      for (let z = -8.6; z <= 8.6; z += 4.3) addBox(group, [53, 0.05, 0.16], [0, PLINTH + 0.1, z], roofTerrace).castShadow = false;
      for (let step = 0; step < 3; step++) {
        const h = PLINTH - step * 0.4;
        for (const side of [-1, 1]) {
          addBox(group, [15, h, 1.1], [0, h / 2, side * (17.05 + step * 1.1)], paleConcrete);
          addBox(group, [1.1, h, 6], [side * (30.55 + step * 1.1), h / 2, 0], paleConcrete);
        }
      }
      // The three graves, pale marble chests under the shells.
      for (const x of [-15, 0, 15]) addBox(group, [1.4, 0.8, 2.8], [x, PLINTH + 0.4, 0], marble);
      // Shells. Each petal is a Coons patch bounded by two valley creases
      // (from the crown down to the feet at the diagonals) and two arch edges
      // (from the feet up to the tip, springing vertically and bowing out).
      const N = 8;
      const FOOT = 4.9;
      const CROWN = PLINTH + 7.5;
      const TIP = PLINTH + 12;
      const BOW = 2.6;
      const shellTop: number[] = [];
      const shellIndex: number[] = [];
      type V3 = [number, number, number];
      const petal = (cx: number, ax: number, az: number, reach: number) => {
        const px = -az;
        const pz = ax;
        const C: V3 = [cx, CROWN, 0];
        const T: V3 = [cx + ax * reach, TIP, az * reach];
        const foot = (side: number): V3 => [cx + (ax + side * px) * FOOT, PLINTH, (az + side * pz) * FOOT];
        const Fl = foot(-1);
        const Fr = foot(1);
        const crease = (F: V3, u: number): V3 => [C[0] + (F[0] - C[0]) * u, PLINTH + (CROWN - PLINTH) * Math.cos((u * Math.PI) / 2), C[2] + (F[2] - C[2]) * u];
        const arch = (F: V3, side: number, u: number): V3 => {
          const k = 1 - Math.cos((u * Math.PI) / 2);
          const bow = BOW * Math.sin(u * Math.PI) * side;
          return [F[0] + (T[0] - F[0]) * k + px * bow, PLINTH + (TIP - PLINTH) * u, F[2] + (T[2] - F[2]) * k + pz * bow];
        };
        const at = (s: number, t: number): V3 => {
          const c0 = crease(Fl, s);
          const c1 = arch(Fr, 1, s);
          const d0 = crease(Fr, t);
          const d1 = arch(Fl, -1, t);
          const out: V3 = [0, 0, 0];
          for (let axis = 0; axis < 3; axis++) {
            out[axis] = (1 - t) * c0[axis] + t * c1[axis] + (1 - s) * d0[axis] + s * d1[axis]
              - ((1 - s) * (1 - t) * C[axis] + s * (1 - t) * Fl[axis] + (1 - s) * t * Fr[axis] + s * t * T[axis]);
          }
          return out;
        };
        // Wind every petal so its front face looks up out of the scoop.
        const a = at(0.55, 0.5), b = at(0.45, 0.5), c = at(0.5, 0.55), d = at(0.5, 0.45);
        const ux = a[0] - b[0], uz = a[2] - b[2];
        const vx = c[0] - d[0], vz = c[2] - d[2];
        // (d/ds × d/dt).y > 0: wind s before t.
        const flip = uz * vx - ux * vz > 0;
        const base = shellTop.length / 3;
        for (let i = 0; i <= N; i++) for (let j = 0; j <= N; j++) shellTop.push(...at(i / N, j / N));
        for (let i = 0; i < N; i++) {
          for (let j = 0; j < N; j++) {
            const p00 = base + i * (N + 1) + j;
            const p10 = p00 + N + 1;
            if (flip) shellIndex.push(p00, p10, p00 + 1, p10, p10 + 1, p00 + 1);
            else shellIndex.push(p00, p00 + 1, p10, p10, p00 + 1, p10 + 1);
          }
        }
      };
      const UNITS = [-15, 0, 15];
      for (const cx of UNITS) {
        petal(cx, 0, 1, 10.5);
        petal(cx, 0, -1, 10.5);
        petal(cx, 1, 0, cx === 15 ? 10 : 7.5);
        petal(cx, -1, 0, cx === -15 ? 10 : 7.5);
      }
      const shellGeometry = new THREE.BufferGeometry();
      shellGeometry.setAttribute("position", new THREE.Float32BufferAttribute(shellTop, 3));
      shellGeometry.setAttribute("uv", new THREE.Float32BufferAttribute(new Array((shellTop.length / 3) * 2).fill(0), 2));
      shellGeometry.setIndex(shellIndex);
      shellGeometry.computeVertexNormals();
      // The underside: the same surface 0.18 m lower along its normal, wound
      // the other way, so the thin shell shows from above and from below.
      const normals = shellGeometry.getAttribute("normal");
      const under: number[] = [];
      for (let index = 0; index < shellTop.length / 3; index++) {
        under.push(
          shellTop[index * 3] - normals.getX(index) * 0.18,
          shellTop[index * 3 + 1] - normals.getY(index) * 0.18,
          shellTop[index * 3 + 2] - normals.getZ(index) * 0.18,
        );
      }
      const underIndex: number[] = [];
      for (let index = 0; index < shellIndex.length; index += 3) underIndex.push(shellIndex[index], shellIndex[index + 2], shellIndex[index + 1]);
      const underGeometry = new THREE.BufferGeometry();
      underGeometry.setAttribute("position", new THREE.Float32BufferAttribute(under, 3));
      underGeometry.setAttribute("uv", new THREE.Float32BufferAttribute(new Array((under.length / 3) * 2).fill(0), 2));
      underGeometry.setIndex(underIndex);
      underGeometry.computeVertexNormals();
      for (const geometry of [shellGeometry, underGeometry]) {
        const mesh = new THREE.Mesh(geometry, paleConcrete);
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        group.add(mesh);
      }
      for (const cx of UNITS) solid(cx, 0, 8, TIP + 0.4);
      // Haji Khwaja Shahbaz's mosque (1679, OSM 297592460), in world axes:
      // a 20 × 8 m prayer hall, long side N–S, three ribbed terracotta domes,
      // octagonal corner turrets and three arched doors facing east.
      const [mx, mz] = toLocal(23.729302, 90.40032);
      const mosque = new THREE.Group();
      mosque.position.set(mx, 0, mz);
      mosque.rotation.y = -landmark.heading;
      group.add(mosque);
      addBox(mosque, [9, 0.6, 21], [0, 0.3, 0], terracotta);
      addBox(mosque, [8, 6.4, 20], [0, 3.6, 0], paleConcrete);
      addBox(mosque, [8.4, 0.5, 20.4], [0, 6.6, 0], paleConcrete);
      for (const z of [-6.4, 0, 6.4]) {
        const r = z === 0 ? 2.9 : 2.4;
        addCylinder(mosque, r, r, 1.2, [0, 7.4, z], paleConcrete, 12);
        addLathe(mosque, domeProfile(r, r * 1.15, 0.1, 6), 12, [0, 8, z], terracotta, true);
        addCone(mosque, 0.16, 1.8, [0, 8.9 + r * 1.15, z], paleConcrete, 5);
        addBox(mosque, [0.2, z === 0 ? 3.6 : 3, z === 0 ? 2 : 1.7], [4.05, 2.8, z], recess);
      }
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) addCylinder(mosque, 0.55, 0.6, 9, [sx * 4, 4.5, sz * 10], paleConcrete, 8);
      solid(mx, mz, 10, 11);
      // Keep the garden, its approach and the mosque clear of the city.
      clearSite(0, 0, 42, 31);
      clearSite(mx, mz, 13, 12);
      // The tip of the middle shell's front petal.
      perchTarget = [0, 9.2];
    } else if (landmark.kind === "hussaini-dalan") {
      // Hussaini Dalan, the Shia imambara (OSM 234106448, 32 × 22 m): a
      // brilliant white raised hall standing straight out of its tank on the
      // south, with a recessed loggia of six tall Tuscan columns in front of
      // green arched windows, an octagonal tower with a blue-tiled dome at
      // each end of the south front, two slender white onion-domed corner
      // turrets behind them and a red-and-white toothed parapet. The tank
      // (OSM 234069504) is drawn from the map's water; only its red coping is
      // built here. A big earth forecourt opens to the north. Local +Z faces
      // south over the tank; the table point sits on the tank's north bank.
      boundsCollider = false;
      const [, hallZ] = toLocal(23.722405, 90.397979);
      const hall = new THREE.Group();
      hall.position.set(0, 0, hallZ);
      group.add(hall);
      const FRONT = 11;
      // Plinth storey, recessed upper hall and the side bays either side of
      // the loggia.
      addBox(hall, [32, 3.6, 22], [0, 1.8, 0], whiteStone);
      addBox(hall, [32, 8.4, 19], [0, 7.8, -1.5], whiteStone);
      for (const side of [-1, 1]) addBox(hall, [8, 8.4, 3.2], [side * 12, 7.8, FRONT - 1.6], whiteStone);
      addBox(hall, [33, 0.5, 23], [0, 3.85, 0], whiteStone);
      addBox(hall, [33, 0.7, 23], [0, 12.2, 0], whiteStone);
      addBox(hall, [30, 0.12, 20.4], [0, 12.6, -0.2], paleConcrete).castShadow = false;
      // Plinth-storey doors and the north entrance stair.
      const door = roundArch(1.6, 2.6);
      for (let x = -13.5; x <= 13.5; x += 4.5) {
        const mesh = new THREE.Mesh(door, seatGreen);
        mesh.position.set(x, 0.1, FRONT + 0.03);
        hall.add(mesh);
      }
      for (let step = 0; step < 5; step++) addBox(hall, [12, 3.6 - step * 0.72, 1.1], [0, (3.6 - step * 0.72) / 2, -11.55 - step * 1.1], paleConcrete);
      // The loggia: a balustraded floor, six columns, the entablature, and the
      // green-glazed arched windows on the recessed wall behind.
      addBox(hall, [16, 1, 0.3], [0, 4.6, FRONT - 0.3], whiteStone);
      for (let index = 0; index < 6; index++) {
        const x = -6.5 + index * 2.6;
        addCylinder(hall, 0.42, 0.5, 7, [x, 7.6, FRONT - 0.9], whiteStone, 10);
        addBox(hall, [1.1, 0.4, 1.1], [x, 4.3, FRONT - 0.9], whiteStone);
      }
      addBox(hall, [16.4, 1.1, 1.6], [0, 11.5, FRONT - 0.9], whiteStone);
      // The shaded back wall of the loggia.
      addBox(hall, [16, 7.2, 0.1], [0, 7.8, FRONT - 3], paleConcrete);
      const tallArch = roundArch(1.9, 4.4);
      for (let index = 0; index < 5; index++) {
        const mesh = new THREE.Mesh(tallArch, seatGreen);
        mesh.position.set(-5.2 + index * 2.6, 5.2, FRONT - 2.92);
        hall.add(mesh);
      }
      // Side-bay windows, two storeys.
      for (const side of [-1, 1]) {
        for (const y of [4.6, 8.4]) {
          const mesh = new THREE.Mesh(roundArch(1.2, 2.4), seatGreen);
          mesh.position.set(side * 10.2, y, FRONT + 0.03);
          hall.add(mesh);
        }
      }
      // Octagonal end towers with their blue-tiled domes.
      for (const side of [-1, 1]) {
        const tx = side * 13.6;
        const tz = FRONT - 1.4;
        addCylinder(hall, 3.2, 3.2, 12.4, [tx, 6.2, tz], whiteStone, 8).rotation.y = Math.PI / 8;
        addCylinder(hall, 3.55, 3.55, 0.45, [tx, 4.1, tz], whiteStone, 8).rotation.y = Math.PI / 8;
        addCylinder(hall, 3.6, 3.6, 0.6, [tx, 12.5, tz], whiteStone, 8).rotation.y = Math.PI / 8;
        for (let face = 0; face < 8; face++) {
          const angle = (face / 8) * Math.PI * 2;
          for (const y of [5.2, 8.6]) {
            const mesh = new THREE.Mesh(roundArch(1, 2), seatGreen);
            mesh.position.set(tx + Math.sin(angle) * 3.02, y, tz + Math.cos(angle) * 3.02);
            mesh.rotation.y = angle;
            hall.add(mesh);
          }
        }
        addCylinder(hall, 2.5, 2.6, 0.8, [tx, 13.2, tz], whiteStone, 12);
        addLathe(hall, domeProfile(2.6, 3.1, 0.12, 8), 12, [tx, 13.6, tz], carnivalBlue);
        addFinial(hall, [tx, 16.5, tz], 0.55, whiteStone);
        // The slender corner turret behind it.
        const cz = FRONT - 7.5;
        const cx = side * 15.2;
        addCylinder(hall, 1.25, 1.25, 4, [cx, 14.4, cz], whiteStone, 8);
        addCylinder(hall, 1.5, 1.5, 0.35, [cx, 16.5, cz], whiteStone, 8);
        addLathe(hall, domeProfile(1.3, 2.1, 0.22, 7), 10, [cx, 16.65, cz], whiteStone);
        addFinial(hall, [cx, 18.6, cz], 0.4, whiteStone);
        solid(tx, hallZ + tz, 3.6, 16.8);
        solid(cx, hallZ + cz, 1.6, 18.8);
      }
      // The red-and-white toothed parapet strip on the south and side walls.
      for (let x = -16; x <= 16; x += 0.9) addBox(hall, [0.45, 0.55, 0.35], [x, 12.8, FRONT + 0.4], monumentRed);
      for (const side of [-1, 1]) for (let z = -11; z <= 10; z += 0.9) addBox(hall, [0.35, 0.55, 0.45], [side * 16.5, 12.8, z], monumentRed);
      solidBox(0, hallZ, 16.5, 11.2, 13.2);
      // The ledge between the hall and the tank, and the tank's red-tile
      // coping and low railing round the water drawn from the map.
      const [tankW, tankN] = toLocal(23.7222568, 90.3978562);
      const [tankE, tankS] = toLocal(23.7219, 90.3981537);
      addBox(group, [tankE - tankW + 2, 0.3, tankN - hallZ - FRONT], [(tankE + tankW) / 2, 0.15, (hallZ + FRONT + tankN) / 2], paleConcrete);
      const rimY = 0.2;
      addBox(group, [tankE - tankW + 3, 0.5, 1.4], [(tankE + tankW) / 2, rimY, tankS + 0.7], brickTrim);
      for (const x of [tankW - 0.7, tankE + 0.7]) addBox(group, [1.4, 0.5, tankS - tankN + 1.4], [x, rimY, (tankN + tankS) / 2], brickTrim);
      // The walled earth forecourt to the north.
      addBox(group, [64, 0.1, 62], [-6, 0.05, hallZ - 11 - 33], packedEarth).castShadow = false;
      clearSite(-6, hallZ - 44, 34, 33);
      clearSite(0, hallZ, 19, 13);
      clearSite((tankE + tankW) / 2, (tankN + tankS) / 2, (tankE - tankW) / 2 + 3, (tankS - tankN) / 2 + 3);
      // The east blue dome.
      perchTarget = [13.6, hallZ + FRONT - 1.4];
    } else if (landmark.kind === "supreme-court") {
      // Supreme Court of Bangladesh (OSM relation 15508050): a brilliant
      // white two-storey courtyard block round a square lawn, with Mughal
      // cusped-arch verandahs on the first floor of every outer face. Over
      // the middle of the east wing a projecting entrance tower with a deep
      // flat cornice carries a square drum stage, four small chhatris and the
      // big white bulbous dome (36 m). A red-roofed apse juts into the court
      // behind it, and the round lotus fountain lies 45 m in front. Local +Z
      // faces east (81°); +X runs along the long axis to the north (351°).
      boundsCollider = false;
      const EAVE = 14;
      // [x0, x1, z0, z1] of each wing, from the OSM outer ring and court.
      const wings: Array<[number, number, number, number]> = [
        [-60, 61, 36, 57],
        [-58, 58, -59, -42],
        [38, 58, -42, 36],
        [-57, -40, -42, 36],
      ];
      for (const [x0, x1, z0, z1] of wings) {
        const cx = (x0 + x1) / 2;
        const cz = (z0 + z1) / 2;
        addBox(group, [x1 - x0, EAVE, z1 - z0], [cx, EAVE / 2, cz], whiteStone);
        addBox(group, [x1 - x0 + 1.6, 0.7, z1 - z0 + 1.6], [cx, EAVE + 0.1, cz], whiteStone);
        addBox(group, [x1 - x0 - 1, 0.1, z1 - z0 - 1], [cx, EAVE + 0.5, cz], paleConcrete).castShadow = false;
        addBox(group, [x1 - x0 + 0.8, 0.45, z1 - z0 + 0.8], [cx, 6.3, cz], whiteStone);
        solidBox(cx, cz, (x1 - x0) / 2, (z1 - z0) / 2, EAVE + 0.6);
      }
      // Corner pavilions, a storey's parapet higher.
      for (const sx of [-1, 1]) {
        for (const [z0, z1] of [[-50, -26], [34, 57]] as const) {
          addBox(group, [9, EAVE + 1.8, z1 - z0], [sx * 62.5, (EAVE + 1.8) / 2, (z0 + z1) / 2], whiteStone);
          addBox(group, [10.2, 0.7, z1 - z0 + 1.2], [sx * 62.5, EAVE + 2, (z0 + z1) / 2], whiteStone);
          solidBox(sx * 62.5, (z0 + z1) / 2, 4.5, (z1 - z0) / 2, EAVE + 2.4);
        }
      }
      // First-floor verandahs of cusped (pointed) arches, and small lattice
      // windows below, on every outer face. Each run is [x0, z0, x1, z1].
      const cusp = pointedArch(2.4, 4.2);
      const lattice = rectPane(1.1, 1.3);
      const runs: Array<[number, number, number, number]> = [
        [-58, 57, -14, 57], [14, 57, 58, 57],
        [-58, -59, 58, -59],
        [58, -24, 58, 32], [-57, -24, -57, 32],
      ];
      for (const [x0, z0, x1, z1] of runs) {
        const length = Math.hypot(x1 - x0, z1 - z0);
        const dx = (x1 - x0) / length;
        const dz = (z1 - z0) / length;
        // Outward normal: away from the court centre.
        let nx = dz;
        let nz = -dx;
        if (nx * (x0 + x1) + nz * (z0 + z1) < 0) {
          nx = -nx;
          nz = -nz;
        }
        // The side runs stand on the end pavilions' inner wall line.
        const face = Math.abs(nx) > 0.5 ? (nx > 0 ? 58 : -57) : 0;
        const count = Math.floor(length / 3.6);
        for (let index = 0; index < count; index++) {
          const along = (index + 0.5) * (length / count);
          const px = face || x0 + dx * along;
          const pz = z0 + dz * along;
          for (const [geometry, y] of [[cusp, 7.2], [lattice, 2.6]] as const) {
            const mesh = new THREE.Mesh(geometry, archDark);
            mesh.position.set(px + nx * 0.06, y, pz + nz * 0.06);
            mesh.rotation.y = Math.atan2(nx, nz);
            group.add(mesh);
          }
        }
      }
      // The entrance tower: a deep flat cornice at 20 m, a square drum stage,
      // four chhatris, a ribbed drum and the bulbous white dome.
      addBox(group, [26, 20, 12], [0, 10, 57], whiteStone);
      addBox(group, [30, 1.1, 16], [0, 20.3, 57.4], whiteStone);
      addBox(group, [27, 0.8, 13], [0, 21.2, 57.2], whiteStone);
      addBox(group, [8, 9, 0.3], [0, 10.5, 63.1], archDark);
      for (const x of [-3, -1, 1, 3]) addCylinder(group, 0.38, 0.42, 8, [x, 10.8, 63.6], whiteStone, 8);
      addBox(group, [10, 0.6, 2], [0, 6.5, 63.6], whiteStone);
      const gate = new THREE.Mesh(pointedArch(7, 5.4), archDark);
      gate.position.set(0, 0, 63.07);
      group.add(gate);
      addBox(group, [14, 4.6, 14], [0, 23.9, 56], whiteStone);
      addBox(group, [15, 0.6, 15], [0, 26.4, 56], whiteStone);
      addCylinder(group, 6.1, 6.3, 2.6, [0, 28, 56], whiteStone, 24);
      addCylinder(group, 6.6, 6.6, 0.5, [0, 29.4, 56], whiteStone, 24);
      addLathe(group, domeProfile(6.4, 6.8, 0.1, 12), 24, [0, 29.6, 56], whiteStone);
      addFinial(group, [0, 36.1, 56], 0.9, whiteStone);
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) addChhatri(group, [sx * 6.6, 26.7, 56 + sz * 6.6], 2.4, whiteStone, whiteStone);
      solid(0, 57, 13, 21.6);
      solid(0, 56, 7, 38);
      // The red-roofed apse behind the entrance, and the inner court lawn.
      addBox(group, [29, 10, 10], [0, 5, 31], whiteStone);
      addCylinder(group, 14.5, 14.5, 10, [0, 5, 26], whiteStone, 24);
      addCylinder(group, 15, 13.5, 1.6, [0, 10.8, 26], tileRoof, 24);
      addBox(group, [77, 0.12, 77], [-1, 0.06, -3], lawn).castShadow = false;
      // The forecourt and the round lotus fountain: the pool is drawn from
      // the map's water (OSM 982460216), redrawn here above the paving; a kerb of white posts rings it, and
      // lotus buds and flowers stand on green stalks in the water.
      addBox(group, [60, 0.1, 50], [0, 0.05, 88], paleConcrete).castShadow = false;
      addCylinder(group, 12.7, 12.7, 0.1, [0, 0.13, 92], water, 32).castShadow = false;
      addLathe(group, [[13.2, -0.3], [13.2, 1.1], [12.6, 1.1], [12.6, -0.3]], 40, [0, 0, 92], whiteStone);
      for (let index = 0; index < 22; index++) {
        const angle = index * 2.4;
        const radius = 3 + (index % 5) * 2;
        const lx = Math.sin(angle) * radius;
        const lz = 92 + Math.cos(angle) * radius;
        const h = 1.4 + (index % 3) * 0.5;
        addCylinder(group, 0.08, 0.08, h + 0.5, [lx, h / 2 - 0.2, lz], seatGreen, 4);
        addCone(group, 0.6, 0.9, [lx, h + 0.4, lz], index % 2 ? seatGreen : whiteStone, 6);
      }
      clearSite(0, -1, 70, 64);
      clearSite(0, 88, 32, 26);
      perchTarget = [0, 56];
    } else if (landmark.kind === "national-stadium") {
      // National Stadium, Motijheel (OSM 24477071, 229 × 220 m): a near-
      // round single-tier concrete bowl raked up to an 18 m rim, its grey
      // seating broken by a regular rhythm of red-orange seat blocks, round
      // a red athletics track and a north–south football pitch. A white
      // cantilever roof covers the ESE stand, a press box breaks the north
      // rim, and four 50 m lattice floodlight masts stand at the diagonals.
      // Local axes are world axes (+X east, +Z south).
      colliderTop = 1;
      const SEG = 80;
      // A rounded outline with half axes a (X) and b (Z); theta runs from +Z
      // (south) toward +X (east), so a bearing B sits at theta = π − B.
      const rim = (a: number, b: number, theta: number, power = 2.2): [number, number] => {
        const s = Math.sin(theta);
        const c = Math.cos(theta);
        return [a * Math.sign(s) * Math.abs(s) ** (2 / power), b * Math.sign(c) * Math.abs(c) ** (2 / power)];
      };
      type Outline = [number, number, number];
      const ring = (inner: Outline, outer: Outline, yIn: number, yOut: number, facing: "up" | "down" | "in" | "out" = "up", from = 0, to = Math.PI * 2, steps = SEG) => {
        const quads: Array<[QuadPoint, QuadPoint, QuadPoint, QuadPoint, QuadPoint]> = [];
        for (let index = 0; index < steps; index++) {
          const t0 = from + ((to - from) * index) / steps;
          const t1 = from + ((to - from) * (index + 1)) / steps;
          const i0 = rim(inner[0], inner[1], t0, inner[2]);
          const i1 = rim(inner[0], inner[1], t1, inner[2]);
          const o0 = rim(outer[0], outer[1], t0, outer[2]);
          const o1 = rim(outer[0], outer[1], t1, outer[2]);
          const sign = facing === "in" ? -1 : 1;
          const out: QuadPoint = facing === "up" ? [0, 1, 0] : facing === "down" ? [0, -1, 0] : [sign * i0[0], 0, sign * i0[1]];
          quads.push([[i0[0], yIn, i0[1]], [i1[0], yIn, i1[1]], [o1[0], yOut, o1[1]], [o0[0], yOut, o0[1]], out]);
        }
        return quads;
      };
      const TRACK_IN: Outline = [43, 58, 2.7];
      const TRACK_OUT: Outline = [52, 69, 2.7];
      const FIELD: Outline = [80, 87, 2.2];
      const BOWL_TOP: Outline = [104, 112, 2.2];
      const OUTER: Outline = [108, 116, 2.2];
      // Infield lawn (a fan drawn as degenerate quads), the track.
      const infield: Array<[QuadPoint, QuadPoint, QuadPoint, QuadPoint, QuadPoint]> = [];
      for (let index = 0; index < SEG; index++) {
        const a = rim(FIELD[0], FIELD[1], (index / SEG) * Math.PI * 2, FIELD[2]);
        const b = rim(FIELD[0], FIELD[1], ((index + 1) / SEG) * Math.PI * 2, FIELD[2]);
        infield.push([[0, 0.08, 0], [a[0], 0.08, a[1]], [b[0], 0.08, b[1]], [0, 0.08, 0], [0, 1, 0]]);
      }
      addQuads(group, infield, lawn);
      addQuads(group, ring(TRACK_IN, TRACK_OUT, 0.14, 0.14), terracotta);
      // Football pitch with mown stripes, white lines and goals.
      addBox(group, [72, 0.1, 104], [0, 0.18, 0], lawn).castShadow = false;
      for (let stripe = -4; stripe <= 4; stripe += 2) addBox(group, [72, 0.06, 104 / 9], [0, 0.26, stripe * (104 / 9)], landmarkLightCanopy).castShadow = false;
      for (const [w, d, x, z] of [[72, 0.25, 0, -52], [72, 0.25, 0, 52], [0.25, 104, -36, 0], [0.25, 104, 36, 0], [72, 0.25, 0, 0]] as const) {
        addBox(group, [w, 0.05, d], [x, 0.32, z], whiteStone).castShadow = false;
      }
      for (const end of [-1, 1]) addBox(group, [7.3, 2.4, 0.4], [0, 1.4, end * 52.2], whiteStone);
      // The bowl: a 2 m front wall, seating raked to the 18 m rim in sectors
      // of grey with red seat blocks, a walkway, and the outer facade.
      addQuads(group, [
        ...ring(FIELD, FIELD, 0, 2, "in"),
        ...ring(BOWL_TOP, OUTER, 18.6, 18.6),
        ...ring(BOWL_TOP, BOWL_TOP, 18, 18.6, "in"),
        ...ring(OUTER, OUTER, 0, 18.6, "out"),
      ], concrete);
      const SECTORS = 36;
      const greyQuads: Array<[QuadPoint, QuadPoint, QuadPoint, QuadPoint, QuadPoint]> = [];
      const redQuads: Array<[QuadPoint, QuadPoint, QuadPoint, QuadPoint, QuadPoint]> = [];
      const MID: Outline = [93, 100.5, 2.2];
      for (let sector = 0; sector < SECTORS; sector++) {
        const a0 = (sector / SECTORS) * Math.PI * 2;
        const a1 = ((sector + 0.62) / SECTORS) * Math.PI * 2;
        const a2 = ((sector + 1) / SECTORS) * Math.PI * 2;
        // Lower tier: red blocks alternate with grey; upper tier: grey with
        // a narrow red aisle band.
        greyQuads.push(...ring(FIELD, MID, 2, 10.5, "up", a0, a1, 2));
        redQuads.push(...ring(FIELD, MID, 2, 10.5, "up", a1, a2, 2));
        greyQuads.push(...ring(MID, BOWL_TOP, 10.5, 18, "up", a0, a2 - 0.012, 2));
        redQuads.push(...ring(MID, BOWL_TOP, 10.5, 18, "up", a2 - 0.012, a2, 1));
      }
      addQuads(group, greyQuads, paleConcrete);
      addQuads(group, redQuads, plazaRed);
      // Dark concourse openings round the outer facade.
      for (let index = 0; index < 48; index++) {
        const theta = ((index + 0.5) / 48) * Math.PI * 2;
        const [x, z] = rim(OUTER[0] + 0.08, OUTER[1] + 0.08, theta, OUTER[2]);
        const opening = new THREE.Mesh(rectPane(5, 3.2), archDark);
        opening.position.set(x, 13.5, z);
        opening.rotation.y = Math.atan2(x / OUTER[0] ** 2, z / OUTER[1] ** 2);
        group.add(opening);
      }
      // The covered ESE stand (bearings 100–160°): a white cantilever roof
      // on raking back girders and columns behind the rim.
      const ROOF_FROM = Math.PI - (160 * Math.PI) / 180;
      const ROOF_TO = Math.PI - (100 * Math.PI) / 180;
      const ROOF_IN: Outline = [88, 95.5, 2.2];
      const ROOF_OUT: Outline = [109, 117, 2.2];
      addQuads(group, [
        ...ring(ROOF_IN, ROOF_OUT, 23.4, 25.2, "up", ROOF_FROM, ROOF_TO, 16),
        ...ring(ROOF_IN, ROOF_OUT, 22.8, 24.6, "down", ROOF_FROM, ROOF_TO, 16),
        ...ring(ROOF_IN, ROOF_IN, 22.8, 23.4, "in", ROOF_FROM, ROOF_TO, 16),
        ...ring(ROOF_OUT, ROOF_OUT, 24.6, 25.2, "out", ROOF_FROM, ROOF_TO, 16),
      ], whiteStone);
      for (let index = 0; index <= 8; index++) {
        const theta = ROOF_FROM + ((ROOF_TO - ROOF_FROM) * index) / 8;
        const [bx, bz] = rim(108, 116, theta);
        const [fx, fz] = rim(90, 97.5, theta);
        addBeam(group, [bx, 25.6, bz], [fx, 23.8, fz], 0.6, 0.9, concrete);
        addBox(group, [0.9, 25, 0.9], [bx, 12.5, bz], concrete);
      }
      // The press box breaking the north rim.
      addBox(group, [16, 6, 9], [0, 21, -110], whiteStone);
      addBox(group, [16.4, 0.7, 9.4], [0, 24.2, -110], plazaRed);
      addBox(group, [14, 2.6, 0.2], [0, 21, -105.4], archDark);
      solidBox(0, -110, 8, 4.5, 24.6);
      // Four lattice floodlight masts at the diagonals, lamps turned inward.
      for (const bearing of [45, 135, 225, 315]) {
        const theta = Math.PI - (bearing * Math.PI) / 180;
        const px = Math.sin(theta) * 124;
        const pz = Math.cos(theta) * 128;
        const mast = new THREE.Group();
        mast.position.set(px, 0, pz);
        mast.rotation.y = Math.atan2(-px, -pz);
        group.add(mast);
        const H = 50;
        for (const cx of [-1, 1]) {
          for (const cz of [-1, 1]) addBeam(mast, [cx * 1.6, 0, cz * 1.6], [cx * 0.8, H, cz * 0.8], 0.32, 0.32, concrete);
        }
        for (let y = 5; y < H - 2; y += 6) {
          const r = 1.6 - (0.8 * y) / H;
          const r2 = 1.6 - (0.8 * (y + 6)) / H;
          for (const cz of [-1, 1]) addBeam(mast, [-r, y, cz * r], [r2, y + 6, cz * r2], 0.16, 0.16, concrete);
          for (const cx of [-1, 1]) addBeam(mast, [cx * r, y, -r], [cx * r2, y + 6, r2], 0.16, 0.16, concrete);
        }
        addBox(mast, [7, 5, 0.9], [0, H + 2.4, 0.8], whiteStone).rotation.x = 0.4;
        addBox(mast, [7.6, 0.5, 2.6], [0, H - 0.3, 0], concrete);
        solid(px, pz, 5, H + 5);
      }
      // The bowl strikes as a ring of overlapping columns over the upper
      // tier and rim (the field stays open), the covered stand's roof as a
      // second ring over its sector.
      for (let index = 0; index < 56; index++) {
        const [x, z] = rim(101, 109, (index / 56) * Math.PI * 2);
        solid(x, z, 10, 18.6);
      }
      for (let index = 0; index < 48; index++) {
        const [x, z] = rim(89, 96, (index / 48) * Math.PI * 2);
        solid(x, z, 6.5, 10.5);
      }
      for (let index = 0; index <= 10; index++) {
        for (const [ra, rb] of [[95, 102.5], [108, 115.5]]) {
          const [x, z] = rim(ra, rb, ROOF_FROM + ((ROOF_TO - ROOF_FROM) * index) / 10);
          solid(x, z, 8, 24.6);
        }
      }
      clearOval(0, 0, 108, 116, 10);
      // The front edge of the covered stand's roof.
      perchTarget = rim(93, 100.5, Math.PI - (130 * Math.PI) / 180);
    } else if (landmark.kind === "rayer-bazar-memorial") {
      // Martyred Intellectuals Memorial, Rayer Bazar (OSM 1074764129): a
      // 0.9 m thick red-brick wall, 115.8 m long and 17.7 m at its highest,
      // curving round the west side of a still D-shaped pool. Its top is
      // broken: low and torn at both ends, rising to a ragged crest, with a
      // square window cut through it south of the middle. A black granite
      // pillar stands in the water, and a red-brick plaza with square lawns
      // looks across the pool at the wall. The pool (OSM 320577211) is drawn
      // from the map's water. Local +Z faces ENE (77°) toward the plaza; +X
      // runs NNW (347°) along the pool's straight east edge at z = −5.6.
      boundsCollider = false;
      const CX = 1.2;
      const CHORD = -5.6;
      const A = 44.2;
      const B = 24;
      // The wall top from the SSE end (u = 0) round to the NNW end (u = 1).
      const crest = (u: number) => {
        // Torn brick steps up from the SSE end, a long high run with the
        // ragged crest, then torn steps down to the NNW end (photo 03).
        const rise = [3.2, 5.4, 8.2, 10.6];
        if (u < 0.12) return rise[Math.floor((u / 0.12) * rise.length)];
        if (u < 0.36) return 11.4 + ((u - 0.12) / 0.24) * 3.8;
        if (u < 0.5) return 15.2 + ((u - 0.36) / 0.14) * 2.5;
        if (u < 0.74) return 17.7 - ((u - 0.5) / 0.24) * 2;
        const steps = [14.6, 12.8, 11.6, 9.4, 8.2, 6, 4.6];
        return steps[Math.min(steps.length - 1, Math.floor(((u - 0.74) / 0.26) * steps.length))];
      };
      const SEGMENTS = 30;
      const WINDOW = 11;
      const point = (u: number): [number, number] => {
        const phi = Math.PI + 0.08 - u * (Math.PI + 0.16);
        return [CX + A * Math.cos(phi), CHORD - B * Math.sin(phi)];
      };
      for (let index = 0; index < SEGMENTS; index++) {
        const u0 = index / SEGMENTS;
        const u1 = (index + 1) / SEGMENTS;
        const [x0, z0] = point(u0);
        const [x1, z1] = point(u1);
        // A ragged crest: a small deterministic jitter on every segment.
        const height = crest((u0 + u1) / 2) + (((index * 7) % 5) - 2) * 0.22;
        const length = Math.hypot(x1 - x0, z1 - z0);
        const turn = Math.atan2(-(z1 - z0), x1 - x0);
        const pieces: Array<[number, number]> = index === WINDOW ? [[0, 4.8], [9.4, height]] : [[0, height]];
        for (const [bottom, top] of pieces) {
          const piece = addBox(group, [length + 0.35, top - bottom, 0.9], [(x0 + x1) / 2, (bottom + top) / 2, (z0 + z1) / 2], plazaRed);
          piece.rotation.y = turn;
        }
        if (index % 2 === 0) solid((x0 + x1) / 2, (z0 + z1) / 2, 3.2, height);
      }
      // The black granite pillar in the water, and the dark slab near it.
      addBox(group, [3.2, 9.6, 3.2], [8, 4.4, CHORD - 4], recess);
      addBox(group, [5, 0.14, 5], [-15, -0.33, CHORD - 2.4], recess);
      solid(8, CHORD - 4, 2, 9.2);
      // The low brick parapet along the pool's straight edge, broken by a
      // landing at its middle.
      for (const [x0, x1] of [[-40, -6], [6, 43]] as const) addBox(group, [x1 - x0, 1, 0.6], [(x0 + x1) / 2, 0.3, CHORD + 0.4], brick);
      addBox(group, [12, 0.5, 3], [0, 0.1, CHORD + 1.6], brick);
      // Lawn over the whole site, the red-brick plaza, its sunken central
      // lawn and the square lawn panels either side.
      // (The lawn leaves the pool and the strip inside the wall uncovered.)
      addBox(group, [210, 0.06, 16], [0, 0.03, -38], lawn).castShadow = false;
      for (const sx of [-1, 1]) addBox(group, [59, 0.06, 25], [sx * 75.5, 0.03, -17.5], lawn).castShadow = false;
      addBox(group, [210, 0.06, 53], [0, 0.03, 21.5], lawn).castShadow = false;
      addBox(group, [96, 0.1, 46], [1, 0.08, 19], brickTrim).castShadow = false;
      addBox(group, [42, 0.08, 17], [1, 0.16, 23], lawn).castShadow = false;
      for (const sx of [-1, 1]) {
        for (const x of [28, 41]) for (const z of [8, 21, 34]) addBox(group, [10.5, 0.1, 10.5], [1 + sx * x, 0.16, z], lawn).castShadow = false;
      }
      // Brick paths across the lawns beyond the plaza.
      for (const x of [-62, -78, -94, 64, 80, 96]) addBox(group, [3, 0.08, 90], [x, 0.07, 1], brickTrim).castShadow = false;
      addBox(group, [206, 0.08, 3], [0, 0.07, 44], brickTrim).castShadow = false;
      // Trees line the outer edges of the site, never between plaza and wall.
      for (let x = -96; x <= 96; x += 16) addLandmarkTree(group, x, 40.5 + ((x / 16) % 2) * 2.5, 4.4, 5.6);
      for (const sx of [-1, 1]) for (let z = -38; z <= 30; z += 17) addLandmarkTree(group, sx * 101, z, 4.6, 6);
      clearSite(0, 1, 106, 48);
      // The crest at the wall's highest point.
      perchTarget = point(0.5);
    } else if (landmark.kind === "sadarghat-terminal") {
      // Sadarghat Launch Terminal on the Buriganga (OSM ferry terminal
      // 332507445): a concrete quay with steps down to the water, a modest
      // BIWTA terminal block, a line of rusty floating pontoons with long
      // grey-green shed roofs 25–30 m offshore, gangways out to them, and
      // the signature: big white three-deck passenger launches moored bow-in
      // side by side in two rows, with arched window bands on every deck and
      // pale cyan, green or salmon roof decks, among small wooden nouka.
      // Local +Z faces the river (211°, square to the in-game bank, which
      // runs along local X about 15 m from the origin); +X is ESE.
      boundsCollider = false;
      const BANK = 15;
      const WATER = -0.42;
      // The quay apron, its edge and the steps down to the water.
      addBox(group, [420, 0.12, 12], [0, 0.06, BANK - 7], concrete).castShadow = false;
      for (let step = 0; step < 3; step++) addBox(group, [420, 0.3, 1.6], [0, -0.12 - step * 0.18, BANK - 0.6 + step * 1.4], concrete);
      // The terminal block: three storeys, dark window bands, a flat roof.
      addBox(group, [64, 12, 16], [10, 6, BANK - 30], whiteStone);
      for (const y of [3, 6.8, 10.4]) addBox(group, [62, 1.6, 0.12], [10, y, BANK - 21.94], archDark);
      addBox(group, [66, 0.6, 18], [10, 12.3, BANK - 30], concrete);
      addBox(group, [40, 0.4, 7], [10, 4.4, BANK - 18.6], sageConcrete);
      solidBox(10, BANK - 30, 32, 8, 12.6);
      // Floating pontoons, their shed roofs on posts, and the gangways.
      const PONTOON = BANK + 27;
      for (let index = 0; index < 10; index++) {
        const x = -198 + index * 44;
        addBox(group, [41, 1.2, 8], [x, WATER + 0.6, PONTOON], recess);
        addBox(group, [38, 0.25, 9], [x, 3.9, PONTOON], sageConcrete);
        for (const px of [-17, -8.5, 0, 8.5, 17]) for (const pz of [-3.2, 3.2]) addBox(group, [0.25, 3.1, 0.25], [x + px, 2.3, PONTOON + pz], concrete);
      }
      solidBox(0, PONTOON, 220, 4.5, 4.2);
      for (let x = -180; x <= 180; x += 60) {
        addBox(group, [3, 0.35, PONTOON - BANK - 2], [x, 0.75, (BANK + PONTOON) / 2 - 2], concrete);
        for (const side of [-1, 1]) addBox(group, [0.12, 0.9, PONTOON - BANK - 2], [x + side * 1.45, 1.35, (BANK + PONTOON) / 2 - 2], recess);
      }
      // One launch, bow toward the bank: a dark hull with a pointed bow,
      // three white decks with arched window bands, a coloured roof deck,
      // a wheelhouse and two funnels.
      const roofs = [starTile, seatGreen, salmon, starTile, whiteStone, seatGreen, salmon];
      // In the launch's own frame the bow tip is at z = 0 and the stern at
      // z = length (toward the open river).
      const launch = (x: number, length: number, roof: THREE.Material, turn: number) => {
        const boat = new THREE.Group();
        boat.position.set(x, WATER, PONTOON + 4.5);
        boat.rotation.y = turn;
        group.add(boat);
        addBox(boat, [14, 3.4, length - 5], [0, 1.1, (5 + length) / 2], recess);
        addBox(boat, [9.9, 3.4, 9.9], [0, 1.1, 7], recess).rotation.y = Math.PI / 4;
        const decks: Array<[number, number, number, number, number]> = [
          [13.6, 2.8, 8, length - 1, 2.8],
          [13.2, 2.8, 12, length - 3, 5.6],
          [11, 2.6, 20, length - 6, 8.4],
        ];
        for (const [width, height, from, to, bottom] of decks) {
          const cz = (from + to) / 2;
          addBox(boat, [width, height, to - from], [0, bottom + height / 2, cz], whiteStone);
          for (const side of [-1, 1]) addBox(boat, [0.1, height * 0.62, to - from - 3], [side * (width / 2 + 0.03), bottom + height * 0.52, cz], archDark);
          for (const end of [from - 0.03, to + 0.03]) addBox(boat, [width - 2, height * 0.62, 0.1], [0, bottom + height * 0.52, end], archDark);
        }
        addBox(boat, [11.6, 0.3, length - 25.4], [0, 11.15, (20 + length - 6) / 2], roof);
        addBox(boat, [6, 2.4, 5], [0, 12.5, 24], whiteStone);
        addBox(boat, [6.2, 0.9, 0.1], [0, 12.8, 21.47], archDark);
        for (const fx of [-2.2, 2.2]) addCylinder(boat, 0.55, 0.6, 2.8, [fx, 12.6, length - 12], recess, 8);
      };
      const rows: Array<[number, number]> = [[-150, 6], [40, 7]];
      let count = 0;
      for (const [start, n] of rows) {
        for (let index = 0; index < n; index++) {
          const x = start + index * 15.2;
          const length = 78 + ((index * 5 + count) % 3) * 6;
          launch(x, length, roofs[(index + count) % roofs.length], (((index * 3 + count) % 5) - 2) * 0.012);
          // The wheelhouse and the funnel pair stand above the roof deck.
          solid(x, PONTOON + 4.5 + 24, 3.4, WATER + 13.7);
          solid(x, PONTOON + 4.5 + length - 12, 3.2, WATER + 14);
          count++;
        }
        // The row of hulls up to the roof deck (11.3 m above the water).
        solidBox(start + ((n - 1) * 15.2) / 2, PONTOON + 4.5 + 45, (n - 1) * 7.6 + 8, 45, WATER + 11.3);
      }
      // Wooden nouka taxi boats among the launches and across the river.
      const nouka = [[-108, 70], [-96, 140], [-60, 112], [-30, 160], [-12, 96], [12, 134], [24, 186], [148, 120], [162, 82], [180, 150], [-170, 104], [80, 168], [120, 210], [-70, 200]];
      nouka.forEach(([x, z], index) => {
        const boat = addBox(group, [1.8, 0.7, 7], [x, WATER + 0.3, BANK + z], landmarkBark);
        boat.rotation.y = index * 1.3;
        const bow = addBox(group, [1.2, 0.5, 2.4], [x + Math.sin(index * 1.3) * 4, WATER + 0.45, BANK + z + Math.cos(index * 1.3) * 4], landmarkBark);
        bow.rotation.set(0.25, index * 1.3, 0, "YXZ");
      });
      // Keep the quay road clear; the city comes right up to it.
      clearSite(0, BANK - 11, 210, 11);
      // The top deck of the middle launch in the SE row.
      perchTarget = [40 + 3 * 15.2, PONTOON + 4.5 + 45];
    } else if (landmark.kind === "air-force-museum") {
      // Bangladesh Air Force Museum, Agargaon (OSM way 462486324): a 688 m
      // lawn strip (long axis 165°, local X) beside Begum Rokeya Sarani, with
      // static aircraft on low brick-edged beds either side of a brick path.
      // The An-24 "Balaka" transport and a dark-green Mi-8 lead; yellow
      // trainers with red noses (Fouga Magister, CJ-6) and silver jets (FT-7,
      // F-86 Sabre on angled white plinths, F-6, F-7) follow, and the white
      // "BAF Nokkhotro" shuttle replica stands by the dark-red brick gate.
      // The lawn and its trees are a DHAKA_PARKS row. Local +Z faces WSW
      // (255°) toward the road; +X runs SSE.
      boundsCollider = false;
      // Flat parts: a plan polygon (x, z) extruded up by `thick`.
      const flatPoly = (parent: THREE.Object3D, points: Array<[number, number]>, y: number, thick: number, material: THREE.Material) => {
        const geometry = new THREE.ExtrudeGeometry(new THREE.Shape(points.map(([px, pz]) => new THREE.Vector2(px, -pz))), { depth: thick, bevelEnabled: false, curveSegments: 1 });
        geometry.rotateX(-Math.PI / 2);
        const mesh = new THREE.Mesh(geometry, material);
        mesh.position.y = y;
        parent.add(mesh);
        return mesh;
      };
      // A fin: an outline in (z, y) given thickness across x.
      const finPoly = (parent: THREE.Object3D, points: Array<[number, number]>, thick: number, material: THREE.Material) => {
        const geometry = new THREE.ExtrudeGeometry(new THREE.Shape(points.map(([pz, py]) => new THREE.Vector2(pz, py))), { depth: thick, bevelEnabled: false, curveSegments: 1 });
        geometry.rotateY(-Math.PI / 2);
        geometry.translate(thick / 2, 0, 0);
        const mesh = new THREE.Mesh(geometry, material);
        parent.add(mesh);
        return mesh;
      };
      // A body of revolution along local Z (nose toward +Z).
      const tube = (parent: THREE.Object3D, rFront: number, rBack: number, length: number, y: number, z: number, material: THREE.Material, segments = 8) => {
        const mesh = addCylinder(parent, rFront, rBack, length, [0, y, z], material, segments);
        mesh.rotation.x = Math.PI / 2;
        return mesh;
      };
      const mirror = (points: Array<[number, number]>) => [...points, ...points.filter(([px]) => px !== 0).reverse().map(([px, pz]) => [-px, pz] as [number, number])];
      const aircraft = (x: number, z: number, yaw: number, lift = 0) => {
        const holder = new THREE.Group();
        holder.position.set(x, lift, z);
        holder.rotation.y = yaw;
        group.add(holder);
        return holder;
      };
      // A brick-edged display bed under each exhibit, kept free of park trees.
      const bed = (x: number, z: number, half: number) => {
        for (const [bx, bz, w, d] of [[0, half, half * 2 + 0.4, 0.4], [0, -half, half * 2 + 0.4, 0.4], [half, 0, 0.4, half * 2], [-half, 0, 0.4, half * 2]] as const) {
          addBox(group, [w, 0.4, d], [x + bx, 0.2, z + bz], plazaBrick);
        }
        clearSite(x, z, half + 2, half + 2);
      };
      const roundel = (parent: THREE.Object3D, x: number, y: number, z: number, radius: number) => {
        for (const side of [-1, 1]) {
          const ring = addCylinder(parent, radius, radius, 0.06, [x * side, y, z], landmarkCanopy, 10);
          ring.rotation.z = Math.PI / 2;
          const dot = addCylinder(parent, radius * 0.6, radius * 0.6, 0.06, [(x + 0.04) * side, y, z], monumentRed, 10);
          dot.rotation.z = Math.PI / 2;
        }
      };

      // The brick path down the lawn (it skirts the pond in the middle, OSM
      // 583653806, drawn from map data), and the red pipe railing round the site.
      addSweptBox(group, [[-420, 0.14, 12], [-60, 0.14, 12], [-32, 0.14, -38], [70, 0.14, -38], [110, 0.14, -20], [235, 0.14, -40]], 1.6, 0.14, plazaBrick);
      const site: Array<[number, number]> = [[-433, 71], [80, 68], [88, 60], [102, 42], [118, 21], [133, 11], [168, 6], [252, 9], [254, -100], [-332, -94], [-429, -93]];
      addSweptBox(group, [...site, site[0]].map(([sx, sz]) => [sx, 1.1, sz] as QuadPoint), 0.07, 1.1, monumentRed);

      // An-24 "Balaka" 0001, broadside to the road.
      const AN_X = -75;
      const AN_Z = -30;
      bed(AN_X, AN_Z, 15.5);
      const an = aircraft(AN_X, AN_Z, Math.PI / 2);
      tube(an, 1.45, 1.45, 17, 2.6, 0.5, whiteStone);
      addBox(an, [2.6, 1.0, 17], [0, 1.65, 0.5], roofGrey);
      tube(an, 0.7, 1.45, 2.0, 2.5, 10.0, starTile);
      addLathe(an, [[0.7, 0], [0.45, 0.35], [0.01, 0.5]], 8, [0, 2.5, 11.0], starTile).rotation.x = Math.PI / 2;
      tube(an, 1.45, 0.45, 5.4, 2.95, -10.7, whiteStone);
      addBox(an, [1.6, 0.5, 1.6], [0, 3.85, 8.3], recess);
      flatPoly(an, mirror([[0, 2.0], [3, 2.0], [14.5, 1.1], [14.5, -0.4], [3, -0.9]]), 3.95, 0.35, whiteStone);
      for (const side of [-1, 1]) {
        const nacelle = tube(an, 0.62, 0.55, 6, 3.4, 1.2, silverPanel);
        nacelle.position.x = side * 4.3;
        for (const blade of [0, 1]) {
          const prop = addBox(an, [3.8, 0.24, 0.12], [side * 4.3, 3.4, 4.3], recess);
          prop.rotation.z = blade * (Math.PI / 2) + 0.4;
        }
        addBox(an, [0.4, 2.2, 0.4], [side * 4.3, 1.1, 1.5], recess);
      }
      addBox(an, [0.4, 1.4, 0.4], [0, 0.7, 8], recess);
      finPoly(an, [[-9.2, 3.4], [-13.4, 3.4], [-13.6, 8.3], [-12.3, 8.3]], 0.32, whiteStone);
      flatPoly(an, mirror([[0, -10.6], [5.1, -11.8], [5.1, -12.9], [0, -13.2]]), 3.5, 0.22, whiteStone);
      roundel(an, 1.46, 2.7, -5.5, 0.85);
      addBox(an, [0.36, 1.0, 1.6], [0, 7.0, -12.9], landmarkCanopy);
      solidBox(AN_X, AN_Z, 12.5, 1.6, 4.3);
      solidBox(AN_X + 1.5, AN_Z, 1.4, 14.5, 4.4);
      solid(AN_X - 12.6, AN_Z, 1.3, 8.4);
      perchTarget = [AN_X - 12.9, AN_Z];

      // The dark-green Mi-8 helicopter beside it.
      const MI_X = -112;
      const MI_Z = -30;
      bed(MI_X, MI_Z, 10.5);
      const mi = aircraft(MI_X, MI_Z, Math.PI / 2);
      tube(mi, 1.0, 1.3, 10.5, 2.3, 0.5, landmarkCanopy);
      tube(mi, 0.4, 1.0, 2.2, 2.1, 6.85, landmarkCanopy);
      addBox(mi, [1.7, 0.9, 4.5], [0, 3.7, 1.5], landmarkCanopy);
      tube(mi, 0.55, 0.25, 8, 2.9, -8.6, landmarkCanopy, 6);
      finPoly(mi, [[-11.6, 2.8], [-12.9, 2.8], [-13.3, 5.4], [-12.4, 5.4]], 0.22, landmarkCanopy);
      addCylinder(mi, 0.25, 0.25, 0.8, [0, 4.5, 1.2], recess, 6);
      for (let blade = 0; blade < 5; blade++) {
        const angle = (blade / 5) * Math.PI * 2;
        const rotor = addBox(mi, [0.55, 0.12, 10.5], [Math.sin(angle) * 5.25, 4.95, 1.2 + Math.cos(angle) * 5.25], recess);
        rotor.rotation.y = angle;
      }
      addBox(mi, [2.8, 0.25, 0.12], [0.2, 4.3, -12.6], recess);
      roundel(mi, 1.25, 2.4, -2.8, 0.6);
      solidBox(MI_X, MI_Z, 9, 1.6, 5);

      // A jet: fuselage, nose cone, wing and tailplane outlines, swept fin.
      const jet = (
        holder: THREE.Object3D, body: THREE.Material, length: number, radius: number, y: number,
        wing: Array<[number, number]>, tail: Array<[number, number]>, fin: Array<[number, number]>, finTip: THREE.Material,
      ) => {
        tube(holder, radius * 0.8, radius, length, y, 0, body);
        const cone = addCone(holder, radius * 0.8, length * 0.16, [0, y, length / 2 + length * 0.08], body, 8);
        cone.rotation.x = Math.PI / 2;
        addBox(holder, [radius * 1.1, radius * 0.8, length * 0.22], [0, y + radius * 0.8, length * 0.2], recess);
        flatPoly(holder, mirror(wing), y - radius * 0.45, 0.16, body);
        flatPoly(holder, mirror(tail), y + 0.05, 0.12, body);
        finPoly(holder, fin, 0.16, body);
        const [tipZ, tipY] = fin[2];
        addBox(holder, [0.2, 0.7, 1.2], [0, tipY - 0.3, tipZ + 0.2], finTip);
        roundel(holder, radius * 0.98, y + 0.1, -length * 0.25, radius * 0.6);
      };
      // FT-7 two-seater "036": delta wing.
      bed(-82, 32, 8.5);
      const ft7 = aircraft(-82, 32, -Math.PI / 2 + 0.35);
      jet(ft7, silverPanel, 13, 0.62, 1.8,
        [[0, 1.5], [3.6, -3.8], [3.6, -4.4], [0, -4.4]], [[0, -5.2], [1.9, -6.4], [1.9, -6.8], [0, -6.6]],
        [[-3.6, 2.2], [-6.6, 2.2], [-6.9, 4.8], [-5.8, 4.8]], landmarkCanopy);
      solid(-82, 32, 3, 5);
      // F-86 Sabre "JB-255": swept wing, raised on angled white plinths.
      const SABRE_X = -150;
      const SABRE_Z = -12;
      bed(SABRE_X, SABRE_Z, 8.5);
      const sabre = aircraft(SABRE_X, SABRE_Z, Math.PI / 2 + 0.5, 1.6);
      jet(sabre, silverPanel, 11, 0.72, 1.4,
        [[0, 1.4], [5.6, -1.6], [5.6, -2.5], [0, -1.2]], [[0, -4.0], [2.2, -5.2], [2.2, -5.7], [0, -5.2]],
        [[-3.2, 1.8], [-5.6, 1.8], [-6.0, 4.1], [-5.0, 4.1]], silverPanel);
      for (const [px, pz, lean] of [[0, 3.2, 0.5], [2.2, -1, -0.45], [-2.2, -1, -0.45]] as const) {
        const plinth = addBox(sabre, [0.9, 2.8, 1.6], [px, -0.4, pz], whiteStone);
        plinth.rotation.x = lean;
      }
      addBox(group, [3.6, 0.5, 3.6], [SABRE_X, 0.25, SABRE_Z], plazaBrick);
      solid(SABRE_X, SABRE_Z, 3, 6.2);
      // An F-6 (MiG-19 type), swept wing with the green and white fin.
      bed(-182, 30, 8.5);
      const f6 = aircraft(-182, 30, -Math.PI / 2 - 0.25);
      jet(f6, silverPanel, 12.5, 0.7, 1.7,
        [[0, 1.6], [4.6, -2.6], [4.6, -3.4], [0, -1.6]], [[0, -4.5], [2.3, -5.9], [2.3, -6.4], [0, -6.0]],
        [[-3.4, 2.2], [-6.0, 2.2], [-6.6, 4.9], [-5.4, 4.9]], landmarkCanopy);
      solid(-182, 30, 3, 5);
      // An F-7 (MiG-21 type) delta.
      bed(-236, -12, 8.5);
      const f7 = aircraft(-236, -12, Math.PI / 2 - 0.3);
      jet(f7, silverPanel, 13.5, 0.62, 1.8,
        [[0, 1.2], [3.6, -4.0], [3.6, -4.6], [0, -4.6]], [[0, -5.4], [1.9, -6.6], [1.9, -7.0], [0, -6.8]],
        [[-3.8, 2.2], [-6.9, 2.2], [-7.2, 4.9], [-6.1, 4.9]], landmarkCanopy);
      solid(-236, -12, 3, 5);

      // Yellow-orange trainers with red noses and wingtips.
      const trainer = (holder: THREE.Object3D, vTail: boolean) => {
        tube(holder, 0.55, 0.62, 8.2, 1.6, 0, accent);
        tube(holder, 0.2, 0.55, 1.6, 1.6, 4.9, monumentRed);
        addBox(holder, [0.8, 0.6, 2.8], [0, 2.25, 1.4], recess);
        flatPoly(holder, mirror([[0, 1.6], [5.0, 1.1], [5.0, -0.2], [0, -0.6]]), 1.1, 0.16, accent);
        for (const side of [-1, 1]) addBox(holder, [0.5, 0.2, 1.4], [side * 5.3, 1.18, 0.45], monumentRed);
        if (vTail) {
          for (const side of [-1, 1]) {
            const fin = finPoly(holder, [[-3.4, 0], [-4.7, 0], [-5.2, 2.5], [-4.4, 2.5]], 0.14, accent);
            fin.rotation.z = side * 0.6;
            fin.position.y = 1.75;
          }
        } else {
          finPoly(holder, [[-3.4, 1.8], [-4.6, 1.8], [-4.8, 3.5], [-4.1, 3.5]], 0.14, accent);
          flatPoly(holder, mirror([[0, -3.5], [2.0, -3.8], [2.0, -4.5], [0, -4.6]]), 1.7, 0.12, accent);
          for (const blade of [0, 1]) {
            const prop = addBox(holder, [2.2, 0.18, 0.08], [0, 1.6, 5.75], recess);
            prop.rotation.z = blade * (Math.PI / 2) + 0.3;
          }
        }
      };
      bed(102, 30, 7);
      trainer(aircraft(102, 30, -2.4), true);
      solid(102, 30, 2.5, 4.4);
      bed(140, -55, 7);
      trainer(aircraft(140, -55, 2.6), false);
      solid(140, -55, 2.5, 3.8);

      // The "BAF Nokkhotro" shuttle replica on its round red-tile plinth.
      const SHX = 85;
      const SHZ = 40;
      addCylinder(group, 3.1, 3.1, 1.0, [SHX, 0.5, SHZ], monumentRed, 14);
      addBox(group, [2.8, 1.2, 2.2], [SHX, 1.6, SHZ], recess);
      addCylinder(group, 0.9, 0.9, 7.6, [SHX, 2.2 + 3.8, SHZ - 0.6], whiteStone, 10);
      addCone(group, 0.9, 1.6, [SHX, 2.2 + 7.6 + 0.8, SHZ - 0.6], monumentRed, 10);
      for (const side of [-1, 1]) {
        addCylinder(group, 0.5, 0.5, 6.4, [SHX + side * 1.45, 2.2 + 3.2, SHZ - 0.6], whiteStone, 8);
        addCone(group, 0.5, 1.2, [SHX + side * 1.45, 2.2 + 6.4 + 0.6, SHZ - 0.6], monumentRed, 8);
        for (const band of [1.2, 3.6, 4.8]) addCylinder(group, 0.53, 0.53, 0.22, [SHX + side * 1.45, 2.2 + band, SHZ - 0.6], recess, 8);
        addCone(group, 0.45, 0.8, [SHX + side * 0.5, 2.2, SHZ + 0.5], monumentRed, 6);
      }
      addCylinder(group, 0.62, 0.62, 5.6, [SHX, 2.4 + 2.8, SHZ + 0.55], whiteStone, 8);
      addCone(group, 0.62, 1.3, [SHX, 2.4 + 5.6 + 0.65, SHZ + 0.55], whiteStone, 8);
      const orbiterWing = new THREE.Shape([new THREE.Vector2(-2.6, 0), new THREE.Vector2(2.6, 0), new THREE.Vector2(0.4, 4.6), new THREE.Vector2(-0.4, 4.6)]);
      const wingGeometry = new THREE.ExtrudeGeometry(orbiterWing, { depth: 0.24, bevelEnabled: false, curveSegments: 1 });
      const wingMesh = new THREE.Mesh(wingGeometry, whiteStone);
      wingMesh.position.set(SHX, 2.4, SHZ + 0.45);
      group.add(wingMesh);
      addBox(group, [0.2, 1.8, 1.3], [SHX, 2.4 + 0.9, SHZ + 1.6], whiteStone);
      solid(SHX, SHZ, 3.1, 11.4);
      clearSite(SHX, SHZ, 6, 6);

      // The dark-red brick main gate at the south-west entry, the BAF eagle
      // on its left pylon, and relief walls either side.
      const GX = 72;
      const GZ = 67;
      for (const side of [-1, 1]) {
        addBox(group, [2.4, 9.2, 2.4], [GX + side * 7.2, 4.6, GZ], plazaBrick);
        addBox(group, [9, 2.6, 0.7], [GX + side * 13.6, 1.3, GZ], plazaBrick);
      }
      addBox(group, [16.8, 2.4, 2.4], [GX, 8.0, GZ], plazaBrick);
      addBox(group, [14, 0.12, 0.12], [GX, 9.6, GZ - 0.6], silverPanel);
      addBox(group, [14, 0.12, 0.12], [GX, 10.2, GZ - 0.6], silverPanel);
      // The eagle sits on the pylon to the left of a visitor facing the gate.
      const EX = GX - 7.2;
      addBox(group, [0.7, 1.2, 0.8], [EX, 9.8, GZ], recess);
      for (const side of [-1, 1]) {
        const wing = addBox(group, [1.8, 0.2, 0.7], [EX + side * 1.0, 10.5, GZ], recess);
        wing.rotation.z = side * 0.6;
      }
      solidBox(GX, GZ, 9, 1.4, 9.2);
      clearSite(GX, GZ - 8, 10, 8);
    } else if (landmark.kind === "sonargaon-hotel") {
      // Pan Pacific Sonargaon, Karwan Bazar (OSM way 32562242): a long,
      // low, dusty pink-beige ten-storey room slab running ENE (70°) along
      // the south side of a podium wedge. Both long faces are a sawtooth of
      // deep balcony trays between angled fins over dark glass; the blank end
      // walls carry a projecting central pier and the hotel name on the roof
      // cornice, with a glazed roof lounge at the WSW end. The podium courts
      // open to the NNW, the pool court in the notch; the garden is on
      // the south. Local +Z faces NNW (340°), +X runs WSW along the slab.
      boundsCollider = false;
      const X0 = -72;
      const X1 = 51;
      const Z0 = -38.6;
      const Z1 = -18.6;
      const ZM = (Z0 + Z1) / 2;
      const H = 33;
      const FLOOR = 3.3;
      // Glazed core, the balcony trays at every floor, and the end walls.
      addBox(group, [X1 - X0 - 3, H, Z1 - Z0 - 4], [(X0 + X1) / 2, H / 2, ZM], darkGlass);
      for (let floor = 1; floor <= 9; floor++) {
        addBox(group, [X1 - X0 - 5, 0.7, Z1 - Z0], [(X0 + X1) / 2, floor * FLOOR, ZM], roseBeige);
      }
      // Angled fins between the bays turn each face into a sawtooth.
      for (const side of [-1, 1]) {
        for (let bay = 0; bay < 15; bay++) {
          const x = X0 + 5.6 + bay * 8.0;
          const fin = addBox(group, [0.6, H - FLOOR + 0.4, 3.0], [x, FLOOR + (H - FLOOR) / 2, ZM + side * (Z1 - Z0 - 2.6) / 2], roseBeige);
          fin.rotation.y = side * 0.6;
        }
      }
      for (const [x, sign] of [[X1 - 1.5, 1], [X0 + 1.5, -1]] as const) {
        // The end wall, its edges stepping in by floor.
        addBox(group, [3, H, Z1 - Z0 - 3], [x, H / 2, ZM], roseBeige);
        for (let floor = 0; floor < 10; floor++) {
          if (floor % 2) continue;
          for (const edge of [-1, 1]) addBox(group, [3, FLOOR, 1.5], [x, floor * FLOOR + FLOOR / 2, ZM + edge * (Z1 - Z0 - 1.5) / 2], roseBeige);
        }
        addBox(group, [1.3, H + 2, 5.2], [x + sign * 2.1, (H + 2) / 2, ZM], roseBeige);
        addBox(group, [0.18, 0.8, 12], [x + sign * 2.15, H + 0.75, ZM], darkGlass);
      }
      addBox(group, [X1 - X0 + 1, 1.4, Z1 - Z0 + 1], [(X0 + X1) / 2, H + 0.7, ZM], roseBeige);
      addBox(group, [X1 - X0 - 2, 0.1, Z1 - Z0 - 2], [(X0 + X1) / 2, H + 1.42, ZM], roofGrey);
      addBox(group, [16, 3.2, 12], [38, H + 3.0, ZM], darkGlass);
      addBox(group, [16.6, 0.3, 12.6], [38, H + 4.75, ZM], roseBeige);
      addBox(group, [8, 2.6, 6], [-20, H + 2.7, ZM], roofGrey);
      // Podium blocks round the forecourt notch, and the 24 m east wing.
      const podium: Array<[number, number, number, number, number]> = [
        [25.5, X1 - 0.5, Z1 - 1, 27, 10], [-8, 25.5, Z1 - 1, -9.6, 10], [-54, -8, Z1 - 1, 27, 10], [X0 + 0.5, -54, Z1 - 1, 27, 24],
      ];
      for (const [x0, x1, z0, z1, top] of podium) {
        addBox(group, [x1 - x0, top, z1 - z0], [(x0 + x1) / 2, top / 2, (z0 + z1) / 2], roseBeige);
        for (let y = 3.4; y < top - 1; y += FLOOR) {
          addBox(group, [x1 - x0 + 0.2, 1.3, z1 - z0 + 0.2], [(x0 + x1) / 2, y + 0.65, (z0 + z1) / 2], darkGlass);
        }
        addBox(group, [x1 - x0 - 1.2, 0.1, z1 - z0 - 1.2], [(x0 + x1) / 2, top + 0.05, (z0 + z1) / 2], roofGrey);
        solidBox((x0 + x1) / 2, (z0 + z1) / 2, (x1 - x0) / 2, (z1 - z0) / 2, top);
      }
      for (let part = 0; part < 4; part++) {
        const length = (X1 - X0) / 4;
        solidBox(X0 + length * (part + 0.5), ZM, length / 2, (Z1 - Z0) / 2, H + 1.4);
      }
      // The pool court in the podium notch (map water OSM 948448048, which
      // this deck would hide, so the pool is redrawn on it), its palms, and
      // the porte-cochère on the north face of the east podium.
      addBox(group, [33.6, 0.1, 37], [8.75, 0.05, 8.7], paleConcrete);
      addBox(group, [24, 0.1, 18], [8.5, 0.12, 5.5], water);
      for (let palm = 0; palm < 6; palm++) addPalm(group, -5 + (palm % 3) * 13.6, palm < 3 ? -7.2 : 18.5, 9 + (palm % 2) * 2, 0.08, palm * 1.1);
      clearSite(8.75, 12, 16.5, 21);
      addBox(group, [16, 0.8, 9], [-32, 6.2, 31.5], roseBeige);
      for (const [px, pz] of [[-39, 35], [-25, 35]] as const) addBox(group, [0.9, 5.8, 0.9], [px, 2.9, pz], roseBeige);
      addBox(group, [30, 0.1, 16], [-32, 0.05, 35], paleConcrete);
      clearSite(-32, 35, 15, 8);
      // The garden on the south, under old trees and palms.
      addBox(group, [120, 0.1, 40], [-10, 0.05, Z0 - 21], lawn);
      clearSite(-10, Z0 - 21, 60, 20);
      for (let tree = 0; tree < 9; tree++) {
        const x = -64 + tree * 12.5 + (tree % 2) * 3;
        addLandmarkTree(group, x, Z0 - 12 - (tree % 3) * 9, 4.2, 5.4, landmarkLightCanopy);
      }
      for (let palm = 0; palm < 6; palm++) addPalm(group, -40 + palm * 15, Z0 - 31 - (palm % 2) * 3, 10 + (palm % 3), 0.08, palm * 1.3);
      perchTarget = [X1 - 1.5, ZM];
    } else if (landmark.kind === "pm-office") {
      // Prime Minister's Office, Tejgaon (the old Sangsad Bhaban; OSM
      // 571232877). A long white two-storey block, long axis N–S, whose
      // central portico faces west over the formal lawns: four square white
      // columns under a broad, shallow white gable with a dark-wood fascia and
      // the state emblem, flanked by white wall piers. The wings carry green
      // hipped metal roofs; tall flagpoles line the forecourt. The full plan
      // was not surveyed, so the courtyards are an estimate. Local +Z faces
      // west, +X south.
      const H = 10;
      const roofGreen = lawn;
      // Front and back ranges joined by three cross wings round two courts.
      const blocks: Array<[number, number, number, number]> = [
        [-55, 55, 6, 20], [-55, 55, -20, -8], [-55, -43, -8, 6], [-6, 6, -8, 6], [43, 55, -8, 6],
      ];
      for (const [x0, x1, z0, z1] of blocks) addBox(group, [x1 - x0, H, z1 - z0], [(x0 + x1) / 2, H / 2, (z0 + z1) / 2], whiteStone);
      // A hipped roof (ridge along X) over a rectangle, with eaves.
      const hipRoof = (x0: number, x1: number, z0: number, z1: number, rise: number) => {
        const e = 0.7;
        const ax = x0 - e, bx = x1 + e, az = z0 - e, bz = z1 + e;
        const halfD = (bz - az) / 2;
        const midZ = (az + bz) / 2;
        const r1: QuadPoint = [ax + halfD, H + rise, midZ];
        const r2: QuadPoint = [bx - halfD, H + rise, midZ];
        addQuads(group, [
          [[ax, H, bz], [bx, H, bz], r2, r1, [0, 1, 1]],
          [[ax, H, az], [bx, H, az], r2, r1, [0, 1, -1]],
          [[ax, H, az], [ax, H, bz], r1, r1, [-1, 1, 0]],
          [[bx, H, az], [bx, H, bz], r2, r2, [1, 1, 0]],
        ], roofGreen);
      };
      hipRoof(-55, -15, 6, 20, 2.6);
      hipRoof(15, 55, 6, 20, 2.6);
      hipRoof(-55, 55, -20, -8, 2.4);
      // The flat-roofed centre of the front range behind the portico, with a parapet.
      for (const [x, z, w, d] of [[0, 20, 30, 0.5], [0, 6, 30, 0.5], [-15, 13, 0.5, 14], [15, 13, 0.5, 14]] as const) {
        addBox(group, [w, 0.9, d], [x, H + 0.45, z], whiteStone);
      }
      addBox(group, [29, 0.08, 13], [0, H + 0.04, 13], paleConcrete);
      // Window strips on the west front, both storeys.
      const windowPane = rectPane(1.6, 2.4);
      for (let bay = 0; bay < 26; bay++) {
        const x = -52 + bay * 4.16;
        if (Math.abs(x) < 12) continue;
        for (const y of [1.4, 6.0]) {
          const pane = new THREE.Mesh(windowPane, archDark);
          pane.position.set(x, y, 20.03);
          group.add(pane);
        }
      }
      // The portico.
      const PZ = 20;
      for (const side of [-1, 1]) addBox(group, [2.6, 8.2, 10], [side * 10.4, 4.1, PZ + 5], whiteStone);
      for (const x of [-6.6, -2.2, 2.2, 6.6]) addBox(group, [1.1, 7.6, 1.1], [x, 3.8, PZ + 8.6], whiteStone);
      const doorway = new THREE.Mesh(rectPane(16, 6.4), recess);
      doorway.position.set(0, 0, PZ + 0.03);
      group.add(doorway);
      const SLOPE = Math.atan2(3.2, 11.5);
      addBox(group, [23.4, 0.8, 0.9], [0, 7.95, PZ + 10.4], bronze);
      const tympanum = new THREE.Mesh(trianglePane(22, 3.2), whiteStone);
      tympanum.position.set(0, 8.35, PZ + 10.0);
      group.add(tympanum);
      for (const side of [-1, 1]) {
        const roof = addBox(group, [12.2, 0.9, 12.4], [side * 5.75, 8.35 + 1.6 + 0.45, PZ + 5.2], whiteStone);
        roof.rotation.z = -side * SLOPE;
        const fascia = addBox(group, [12.0, 0.5, 0.5], [side * 5.75, 8.35 + 1.6 - 0.15, PZ + 10.55], bronze);
        fascia.rotation.z = -side * SLOPE;
      }
      const emblem = new THREE.Mesh(discPane(0.75, 14), accent);
      emblem.position.set(0, 8.75, PZ + 10.05);
      group.add(emblem);
      // Flagpoles along the forecourt.
      for (const side of [-1, 1]) {
        for (let pole = 0; pole < 5; pole++) addCylinder(group, 0.1, 0.14, 15, [side * (16 + pole * 3.6), 7.5, PZ + 13], silverPanel, 5);
      }
      addBox(group, [44, 0.1, 22], [0, 0.05, PZ + 22], paleConcrete);
      clearSite(0, PZ + 22, 22, 11);
      solidBox(0, PZ + 5.2, 11.8, 6.2, 12.2);
      // The walled compound's lawns round the block stay open.
      clearSite(0, 0, 72, 36);
      colliderTop = H + 2.6;
      perchTarget = [0, PZ + 5.2];
    } else if (landmark.kind === "armenian-church") {
      // Armenian Church of the Holy Resurrection, Armanitola (1781; OSM
      // 243376194, 31 × 16 m, long axis 98°). An ochre flat-roofed nave behind
      // a balustraded parapet, with low round-arched verandahs down both long
      // sides. The west door is under the bell tower: a square base, an
      // octagonal open belfry and a pointed octagonal spire with an oculus and
      // a cross, about 22 m. The east end is a round apse crowned by a curved
      // Baroque scroll gable with an oculus. A walled yard of flat white
      // grave slabs lies south and west. Local +Z faces west (278°), +X south.
      const WALL = 9;
      const HW = 5.5;
      const ZW = 14;
      const ZE = -11;
      const MID = (ZW + ZE) / 2;
      const LEN = ZW - ZE;
      addBox(group, [HW * 2, WALL, LEN], [0, WALL / 2, MID], stationCream);
      addBox(group, [HW * 2 + 0.5, 0.45, LEN + 0.5], [0, WALL + 0.05, MID], cream);
      addBox(group, [HW * 2 - 0.4, 0.12, LEN - 0.4], [0, WALL + 0.31, MID], concrete);
      // A balustrade: top rail, plinth rail and baluster blocks between
      // pedestals, along a rectangle in this group's frame.
      const balustrade = (x0: number, x1: number, z0: number, z1: number, y: number) => {
        for (const [ax, az, bx, bz] of [[x0, z0, x1, z0], [x1, z0, x1, z1], [x1, z1, x0, z1], [x0, z1, x0, z0]] as const) {
          const length = Math.hypot(bx - ax, bz - az);
          const yaw = Math.atan2(bx - ax, bz - az);
          const top = addBox(group, [0.42, 0.16, length + 0.42], [(ax + bx) / 2, y + 0.92, (az + bz) / 2], cream);
          top.rotation.y = yaw;
          const base = addBox(group, [0.36, 0.14, length], [(ax + bx) / 2, y + 0.07, (az + bz) / 2], cream);
          base.rotation.y = yaw;
          const count = Math.round(length / 0.75);
          for (let index = 1; index < count; index++) {
            const t = index / count;
            const pedestal = index % 5 === 0;
            const post = addBox(group, pedestal ? [0.5, 0.86, 0.5] : [0.2, 0.7, 0.2], [ax + (bx - ax) * t, y + (pedestal ? 0.5 : 0.49), az + (bz - az) * t], pedestal ? cream : stationCream);
            post.rotation.y = yaw;
          }
        }
      };
      balustrade(-HW, HW, ZE, ZW, WALL + 0.37);
      // Round-arched verandahs down both long sides, their own balustrades on top.
      const arch = roundArch(1.7, 3.3);
      for (const side of [-1, 1]) {
        addBox(group, [2.6, 5, LEN - 3], [side * (HW + 1.3), 2.5, MID - 0.5], stationCream);
        addBox(group, [2.9, 0.3, LEN - 2.7], [side * (HW + 1.35), 5.12, MID - 0.5], cream);
        for (let bay = 0; bay < 8; bay++) {
          const z = ZE + 2.4 + bay * 2.65;
          const pane = new THREE.Mesh(arch, archDark);
          pane.position.set(side * (HW + 2.62), 0.3, z);
          pane.rotation.y = side * Math.PI / 2;
          group.add(pane);
        }
        balustrade(side > 0 ? HW + 0.1 : -HW - 2.75, side > 0 ? HW + 2.75 : -HW - 0.1, ZE + 1.25, ZW - 2.25, 5.27);
        // Tall windows in the nave wall above the verandah roof.
        for (let bay = 0; bay < 5; bay++) {
          const pane = new THREE.Mesh(rectPane(1.2, 2.2), archDark);
          pane.position.set(side * (HW + 0.03), 5.9, ZE + 3.5 + bay * 4.4);
          pane.rotation.y = side * Math.PI / 2;
          group.add(pane);
        }
      }
      // The round east apse, and its scroll gable with the oculus and cross.
      const APSE_Z = ZE - 0.6;
      addCylinder(group, 4.6, 4.6, 8.8, [0, 4.4, APSE_Z], stationCream, 14);
      addCylinder(group, 4.85, 4.85, 0.4, [0, 9.0, APSE_Z], cream, 14);
      const gable = new THREE.Shape();
      gable.moveTo(-4.4, 0);
      gable.lineTo(-4.4, 0.5);
      gable.quadraticCurveTo(-2.3, 0.6, -2.0, 2.3);
      gable.quadraticCurveTo(-1.9, 3.0, -1.3, 3.3);
      gable.quadraticCurveTo(-1.0, 4.3, 0, 4.4);
      gable.quadraticCurveTo(1.0, 4.3, 1.3, 3.3);
      gable.quadraticCurveTo(1.9, 3.0, 2.0, 2.3);
      gable.quadraticCurveTo(2.3, 0.6, 4.4, 0.5);
      gable.lineTo(4.4, 0);
      gable.lineTo(-4.4, 0);
      const gableGeometry = new THREE.ExtrudeGeometry(gable, { depth: 0.8, bevelEnabled: false, curveSegments: 5 });
      gableGeometry.translate(0, 0, -0.4);
      const GABLE_Z = APSE_Z - 1.2;
      const gableMesh = new THREE.Mesh(gableGeometry, stationCream);
      gableMesh.position.set(0, 9.2, GABLE_Z);
      group.add(gableMesh);
      const ring = new THREE.Mesh(discPane(1.15, 14), cream);
      ring.position.set(0, 9.2 + 0.6, GABLE_Z - 0.46);
      ring.rotation.y = Math.PI;
      group.add(ring);
      const oculus = new THREE.Mesh(discPane(0.75, 12), archDark);
      oculus.position.set(0, 9.2 + 1.0, GABLE_Z - 0.52);
      oculus.rotation.y = Math.PI;
      group.add(oculus);
      addBox(group, [0.22, 1.7, 0.22], [0, 9.2 + 4.4 + 0.85, GABLE_Z], bronze);
      addBox(group, [1.0, 0.2, 0.22], [0, 9.2 + 4.4 + 1.2, GABLE_Z], bronze);
      // The west bell tower: square base over the door, octagonal belfry,
      // pointed octagonal spire, oculus and cross.
      const TZ = ZW - 2.6;
      addBox(group, [6, 12, 6], [0, 6, TZ + 0.4], stationCream);
      addBox(group, [6.5, 0.45, 6.5], [0, 12.1, TZ + 0.4], cream);
      const door = new THREE.Mesh(roundArch(2.2, 4), archDark);
      door.position.set(0, 0.2, TZ + 3.43);
      group.add(door);
      const loft = new THREE.Mesh(roundArch(1.8, 3), archDark);
      loft.position.set(0, 7.2, TZ + 3.43);
      group.add(loft);
      const belfry = addCylinder(group, 2.6, 2.6, 3.8, [0, 12.3 + 1.9, TZ + 0.4], stationCream, 8);
      belfry.rotation.y = -Math.PI / 8;
      const opening = roundArch(1.1, 2.5);
      for (let faceIndex = 0; faceIndex < 8; faceIndex += 2) {
        const angle = (faceIndex * Math.PI) / 4;
        const pane = new THREE.Mesh(opening, archDark);
        pane.position.set(Math.sin(angle) * 2.43, 12.9, TZ + 0.4 + Math.cos(angle) * 2.43);
        pane.rotation.y = angle;
        group.add(pane);
      }
      const cornice = addCylinder(group, 2.95, 2.95, 0.4, [0, 16.3, TZ + 0.4], cream, 8);
      cornice.rotation.y = -Math.PI / 8;
      const spire = addLathe(group, [[2.55, 0], [2.6, 1.4], [2.3, 3.0], [1.6, 4.5], [0.7, 5.6], [0.06, 6.1]], 8, [0, 16.5, TZ + 0.4], cream, true);
      spire.rotation.y = -Math.PI / 8;
      const spireEye = new THREE.Mesh(discPane(0.45, 10), archDark);
      spireEye.position.set(0, 18.0, TZ + 0.4 + 2.42);
      spireEye.rotation.x = -0.12;
      group.add(spireEye);
      addBox(group, [0.2, 1.8, 0.2], [0, 22.6 + 0.9, TZ + 0.4], bronze);
      addBox(group, [0.95, 0.2, 0.2], [0, 22.6 + 1.25, TZ + 0.4], bronze);
      solid(0, TZ + 0.4, 3.3, 22.6);
      colliderTop = WALL + 1.3;
      perchTarget = [0, TZ + 0.4];
      // The walled graveyard: paving, rows of flat white slabs, a low white
      // wall, and its trees and palms.
      const YARD: Array<[number, number, number, number]> = [[8.6, 22, -12, 21], [-8, 8.6, 15, 21]];
      for (const [x0, x1, z0, z1] of YARD) {
        addBox(group, [x1 - x0, 0.1, z1 - z0], [(x0 + x1) / 2, 0.05, (z0 + z1) / 2], concrete);
        clearSite((x0 + x1) / 2, (z0 + z1) / 2, (x1 - x0) / 2, (z1 - z0) / 2);
      }
      for (const [ax, az, bx, bz] of [[22, -12, 22, 21], [22, 21, -8, 21], [-8, 21, -8, 15], [8.6, -12, 22, -12]] as const) {
        const length = Math.hypot(bx - ax, bz - az);
        const wall = addBox(group, [0.35, 1.8, length], [(ax + bx) / 2, 0.9, (az + bz) / 2], whiteStone);
        wall.rotation.y = Math.atan2(bx - ax, bz - az);
      }
      for (let row = 0; row < 4; row++) {
        for (let slot = 0; slot < 7; slot++) {
          const z = -9 + slot * 3.3 + (row % 2) * 0.6;
          const x = 10.5 + row * 2.6;
          if (z > 15 && x < 13) continue;
          addBox(group, [1.2, 0.35, 2.2], [x, 0.27, z], (row + slot) % 3 === 0 ? bronze : whiteStone);
        }
      }
      for (let slot = 0; slot < 5; slot++) addBox(group, [2.2, 0.35, 1.2], [-5 + slot * 2.6, 0.27, 18.2], slot % 2 ? whiteStone : bronze);
      addLandmarkTree(group, 19, -6, 4.4, 5.6, landmarkLightCanopy);
      addLandmarkTree(group, 18.5, 14, 4.8, 6.0, landmarkLightCanopy);
      addPalm(group, 12, 19, 11, 0.1, 0.6);
      addPalm(group, 20.5, 4, 10, 0.12, 2.2);
    } else if (landmark.kind === "bahadur-shah-park") {
      // Bahadur Shah Park, Old Dhaka: a 101 × 53 m oval of dense old trees
      // inside an iron railing, ringed by a roundabout (OSM way 34339923; the
      // canopy is its DHAKA_PARKS row). The group sits on the 1857 Sepoy
      // memorial (OSM 948448576) in the north half: a white pavilion on a
      // grey plinth, a tall pointed arch in each face between chamfered corner
      // piers with granite skirts, the piers leaning in above the cornice to
      // a tapering spire capped by a small dome. The pink-grey Hafizullah
      // obelisk stands 30 m south. Heading 0: local +Z is south.
      colliderTop = 11.2;
      const PLINTH = 1.2;
      addBox(group, [13, PLINTH, 13], [0, PLINTH / 2, 0], concrete);
      for (let side = 0; side < 4; side++) {
        const angle = (side * Math.PI) / 2;
        const step = addBox(group, [5, 0.45, 1.6], [Math.sin(angle) * 7.2, 0.22, Math.cos(angle) * 7.2], concrete);
        step.rotation.y = angle;
      }
      // Packed-earth ground round the plinth, where the trees thin out.
      addCylinder(group, 11, 11, 0.06, [0, 0.03, 0], packedEarth, 18);
      // Four arched faces: a wall with a tall pointed opening cut from it.
      const ARCH_W = 5.6;
      const ARCH_H = 8.2;
      const WALL_H = 9.6;
      const face = new THREE.Shape();
      const half = ARCH_W / 2;
      const spring = ARCH_H - ARCH_W * 0.72;
      face.moveTo(-5.2, 0);
      face.lineTo(-half, 0);
      face.lineTo(-half, spring);
      face.quadraticCurveTo(-half, ARCH_H - ARCH_W * 0.2, 0, ARCH_H);
      face.quadraticCurveTo(half, ARCH_H - ARCH_W * 0.2, half, spring);
      face.lineTo(half, 0);
      face.lineTo(5.2, 0);
      face.lineTo(5.2, WALL_H);
      face.lineTo(-5.2, WALL_H);
      face.lineTo(-5.2, 0);
      const faceGeometry = new THREE.ExtrudeGeometry(face, { depth: 0.9, bevelEnabled: false, curveSegments: 6 });
      faceGeometry.translate(0, 0, -0.45);
      for (let side = 0; side < 4; side++) {
        const angle = (side * Math.PI) / 2;
        const wall = new THREE.Mesh(faceGeometry, whiteStone);
        wall.position.set(Math.sin(angle) * 4.55, PLINTH, Math.cos(angle) * 4.55);
        wall.rotation.y = angle;
        group.add(wall);
      }
      // Chamfered corner piers with their grey granite skirts, rising past
      // the cornice and leaning in as the ribs of the spire.
      for (const cx of [-1, 1]) {
        for (const cz of [-1, 1]) {
          addCylinder(group, 1.25, 1.35, WALL_H + 0.8, [cx * 4.7, PLINTH + (WALL_H + 0.8) / 2, cz * 4.7], whiteStone, 8);
          addCylinder(group, 1.5, 1.5, 1.5, [cx * 4.7, PLINTH + 0.75, cz * 4.7], concrete, 8);
          addBeam(group, [cx * 4.6, PLINTH + WALL_H + 0.6, cz * 4.6], [cx * 1.15, PLINTH + 15.2, cz * 1.15], 1.0, 1.0, whiteStone, 0.6);
        }
      }
      addBox(group, [10.8, 0.6, 10.8], [0, PLINTH + WALL_H + 0.3, 0], whiteStone);
      // The tapering spire, nearly round in plan as seen from the air, its
      // small dome and finial.
      addCylinder(group, 1.5, 4.5, 5.2, [0, PLINTH + WALL_H + 0.6 + 2.6, 0], whiteStone, 8);
      addCylinder(group, 1.7, 1.7, 0.4, [0, PLINTH + 15.6, 0], whiteStone, 8);
      addLathe(group, domeProfile(1.55, 1.7, 0.1, 7), 10, [0, PLINTH + 15.8, 0], whiteStone);
      addFinial(group, [0, PLINTH + 17.4, 0], 0.4, whiteStone);
      solid(0, 0, 2.2, PLINTH + 18.4);
      clearSite(0, 0, 11, 11);
      // The Khawja Hafizullah obelisk.
      const OBZ = 30;
      addBox(group, [2.6, 1.1, 2.6], [0, 0.55, OBZ], concrete);
      addBox(group, [1.6, 0.8, 1.6], [0, 1.5, OBZ], roofTerrace);
      const shaft = addCylinder(group, 0.42, 0.78, 5.2, [0, 1.9 + 2.6, OBZ], roofTerrace, 4);
      shaft.rotation.y = Math.PI / 4;
      const tip = addCone(group, 0.42, 0.7, [0, 7.85, OBZ], roofTerrace, 4);
      tip.rotation.y = Math.PI / 4;
      solid(0, OBZ, 1.4, 8.2);
      clearSite(0, OBZ, 4, 4);
      // The iron railing round the oval.
      const oval = ([
        [23.7096093, 90.4121417], [23.7096654, 90.4122219], [23.7096842, 90.4123056], [23.7096508, 90.4124704],
        [23.7095872, 90.4125449], [23.7094792, 90.4126069], [23.7094064, 90.4126228], [23.709255, 90.4126106],
        [23.7090742, 90.4125763], [23.7089328, 90.412542], [23.708807, 90.4124905], [23.7087677, 90.4123875],
        [23.7087677, 90.4123102], [23.7087992, 90.41219], [23.7088542, 90.4121128], [23.708972, 90.4120871],
        [23.7091685, 90.4120956], [23.7094593, 90.4121042],
      ] as const).map(([lat, lon]) => toLocal(lat, lon));
      addSweptBox(group, [...oval, oval[0]].map(([x, z]) => [x, 1.3, z] as QuadPoint), 0.06, 1.3, recess);
      addSweptBox(group, [...oval, oval[0]].map(([x, z]) => [x, 0.35, z] as QuadPoint), 0.25, 0.35, concrete);
    } else if (landmark.kind === "rose-garden-palace") {
      // Rose Garden Palace, Tikatuli (1888; OSM 439770540, 26 × 15 m, long axis
      // 174°). A brilliant white two-storey "wedding cake" villa: giant fluted
      // pilasters run through both floors between green-shuttered arched
      // windows, balconies hang on the first floor, and an urn-topped
      // balustrade with curved pediments crowns the roof. Over the centre of
      // the west front an open octagonal belvedere carries a small white dome.
      // A twin stair climbs to the projecting centre bay, and a lawn with a
      // round fountain and a statue runs west to the dark rectangular pond
      // (OSM 439770165), with a bathing ghat on the palace axis. The masses
      // are footprint-anchored, so the group is not turned; `frame` gives the
      // palace's own axes, local +Z facing west (264°).
      const PALACE = 439770540;
      const palace = anchor(PALACE);
      const H = palace?.height ?? 12.5;
      const PARAPET = H + 1.1;
      // Plinth, first-floor band, cornice, the balustrade and its rail, roof.
      slab(PALACE, 0, 1.3, 1.03, whiteStone);
      slab(PALACE, 5.85, 0.45, 1.02, whiteStone);
      slab(PALACE, H - 0.6, 0.75, 1.04, whiteStone);
      slab(PALACE, H + 0.15, 0.95, 1.005, marble);
      slab(PALACE, PARAPET, 0.18, 1.03, whiteStone);
      slab(PALACE, PARAPET + 0.18, 0.08, 0.93, roofGrey);
      const palaceWalls = walls(PALACE);
      // Green shutters under white arched surrounds on both floors, a giant
      // pilaster between every bay, dark fanlights over the upper windows and
      // the gaps of the roof balustrade.
      addBays(group, palaceWalls, {
        bay: 3.2,
        margin: 0.9,
        storeys: [
          { y: 1.75, opening: roundArch(1.15, 2.7), surround: roundArch(1.6, 3.1) },
          { y: 6.9, opening: rectPane(1.15, 2.1), surround: roundArch(1.6, 3.35) },
        ],
        opening: seatGreen,
        surround: whiteStone,
        pier: { width: 0.75, depth: 0.5, bottom: 1.3, top: H - 0.55, material: whiteStone },
      });
      addBays(group, palaceWalls, {
        bay: 3.2,
        margin: 0.9,
        storeys: [{ y: 9.1, opening: roundArch(1.0, 0.5) }],
        opening: archDark,
      });
      addBays(group, palaceWalls, { bay: 0.62, margin: 0.35, minEdge: 2, storeys: [{ y: H + 0.3, opening: rectPane(0.3, 0.62) }], opening: archDark });

      const body = frame(PALACE, [-0.995, 0.105]);
      if (body) {
        const { g, hz } = body;
        const FRONT = hz + 0.8;
        // A first-floor balcony: slab, end posts, rails and balusters.
        const balcony = (x: number, z: number, width: number, yaw = 0) => {
          const holder = new THREE.Group();
          holder.position.set(x, 0, z);
          holder.rotation.y = yaw;
          g.add(holder);
          addBox(holder, [width, 0.32, 1.15], [0, 6.0, 0.55], whiteStone);
          addBox(holder, [width * 0.8, 0.5, 0.5], [0, 5.6, 0.35], whiteStone);
          addBox(holder, [width, 0.14, 0.2], [0, 6.24, 1.02], marble);
          addBox(holder, [width + 0.1, 0.14, 0.24], [0, 7.08, 1.02], marble);
          for (const side of [-1, 1]) addBox(holder, [0.24, 0.9, 1.0], [side * (width / 2 - 0.12), 6.6, 0.6], marble);
          const count = Math.round(width / 0.36);
          for (let index = 1; index < count; index++) addBox(holder, [0.12, 0.72, 0.12], [-width / 2 + (index * width) / count, 6.66, 1.02], marble);
        };
        // A curved pediment: a segmental hood standing on the balustrade.
        const pediment = (x: number, z: number, width: number, height: number, depth: number) => {
          const shape = new THREE.Shape();
          shape.moveTo(-width / 2, 0);
          shape.lineTo(width / 2, 0);
          shape.lineTo(width / 2, height * 0.38);
          shape.quadraticCurveTo(width * 0.36, height * 1.18, 0, height);
          shape.quadraticCurveTo(-width * 0.36, height * 1.18, -width / 2, height * 0.38);
          shape.lineTo(-width / 2, 0);
          const geometry = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: false, curveSegments: 5 });
          geometry.translate(0, 0, -depth / 2);
          const mesh = new THREE.Mesh(geometry, marble);
          mesh.position.set(x, PARAPET, z);
          g.add(mesh);
          const shell = new THREE.Mesh(discPane(height * 0.24, 10), whiteStone);
          shell.position.set(x, PARAPET + height * 0.22, z + depth / 2 + 0.03);
          g.add(shell);
        };
        // An urn on a pedestal.
        const urn = (x: number, z: number) => {
          addBox(g, [0.62, 0.9, 0.62], [x, PARAPET + 0.45, z], marble);
          addBox(g, [0.74, 0.12, 0.74], [x, PARAPET + 0.96, z], whiteStone);
          addLathe(g, [[0.12, 0], [0.32, 0.18], [0.36, 0.45], [0.2, 0.72], [0.1, 0.78], [0.16, 0.9], [0.001, 1.25]], 6, [x, PARAPET + 1.02, z], marble);
        };

        // The projecting centre bay: paired round giant columns, triple-arched
        // entrance, three arched windows over a bowed balcony, and the large
        // curved pediment in front of the belvedere.
        addBox(g, [7, H, 0.8], [0, H / 2, hz + 0.4], marble);
        addBox(g, [7.5, 1.3, 1.3], [0, 0.65, hz + 0.45], whiteStone);
        addBox(g, [7.6, 0.75, 1.3], [0, H - 0.22, hz + 0.45], whiteStone);
        addBox(g, [7.2, 0.95, 0.95], [0, H + 0.62, hz + 0.45], marble);
        addBox(g, [7.7, 0.18, 1.4], [0, PARAPET + 0.09, hz + 0.45], whiteStone);
        for (const side of [-1, 1]) {
          for (const x of [2.55, 3.3]) {
            const cx = side * x;
            addBox(g, [0.95, 0.55, 0.95], [cx, 1.57, FRONT + 0.4], whiteStone);
            addCylinder(g, 0.34, 0.38, H - 2.6, [cx, 1.85 + (H - 2.6) / 2, FRONT + 0.4], marble, 8);
            addBox(g, [1.0, 0.65, 1.0], [cx, H - 0.6, FRONT + 0.4], whiteStone);
          }
        }
        for (const x of [-1.75, 0, 1.75]) {
          const door = new THREE.Mesh(roundArch(1.25, 3.0), archDark);
          door.position.set(x, 1.3, FRONT + 0.03);
          g.add(door);
          const frameArch = new THREE.Mesh(roundArch(1.6, 3.4), whiteStone);
          frameArch.position.set(x, 6.55, FRONT + 0.02);
          g.add(frameArch);
          const shutter = new THREE.Mesh(roundArch(1.15, 3.0), seatGreen);
          shutter.position.set(x, 6.75, FRONT + 0.05);
          g.add(shutter);
        }
        addCylinder(g, 2.25, 1.6, 0.34, [0, 6.0, FRONT], whiteStone, 14);
        addCylinder(g, 2.15, 2.15, 0.9, [0, 6.62, FRONT], marble, 14);
        addCylinder(g, 2.3, 2.3, 0.14, [0, 7.13, FRONT], whiteStone, 14);
        pediment(0, FRONT - 0.3, 7.4, 2.5, 0.6);

        // Balconies on the flanking bays and the set-back wings.
        for (const side of [-1, 1]) balcony(side * 5.6, hz, 3.2);
        balcony(-10.3, 3.15, 3.4, 0.02);
        balcony(10.45, 4.5, 3.4, -0.18);
        for (const side of [-1, 1]) pediment(side * 5.6, hz + 0.05, 3.6, 1.45, 0.45);

        // Twelve urns on the balustrade: the corners and the centre bay.
        for (const [x, z] of [
          [-8.2, hz + 0.2], [8.1, hz + 0.2], [-3.75, FRONT], [3.75, FRONT],
          [-13.2, 3.2], [13.2, 5.0], [-13.2, -4.15], [13.2, -3.4],
          [-6.4, -7.4], [8.8, -6.85], [-7.5, 3.05], [7.7, 4.0],
        ] as const) urn(x, z);

        // The octagonal belvedere: an open arcade on corner colonnettes, a
        // cornice, a little balustrade, the white dome and its finial.
        const BZ = hz - 1.9;
        const base = PARAPET + 0.18;
        addBox(g, [5.2, 0.7, 5.2], [0, base + 0.35, BZ], marble);
        const drumBase = base + 0.7;
        const DRUM = 3.4;
        const core = addCylinder(g, 1.85, 1.85, DRUM, [0, drumBase + DRUM / 2, BZ], marble, 8);
        core.rotation.y = Math.PI / 8;
        const opening = roundArch(1.25, 2.6);
        for (let face = 0; face < 8; face++) {
          const angle = (face / 8) * Math.PI * 2;
          const pane = new THREE.Mesh(opening, archDark);
          pane.position.set(Math.sin(angle) * 1.73, drumBase + 0.25, BZ + Math.cos(angle) * 1.73);
          pane.rotation.y = angle;
          g.add(pane);
          const corner = angle + Math.PI / 8;
          addCylinder(g, 0.2, 0.22, DRUM, [Math.sin(corner) * 2.25, drumBase + DRUM / 2, BZ + Math.cos(corner) * 2.25], whiteStone, 6);
        }
        const cornice = addCylinder(g, 2.75, 2.45, 0.45, [0, drumBase + DRUM + 0.22, BZ], whiteStone, 8);
        cornice.rotation.y = Math.PI / 8;
        const rail = addCylinder(g, 2.45, 2.45, 0.55, [0, drumBase + DRUM + 0.72, BZ], marble, 8);
        rail.rotation.y = Math.PI / 8;
        const domeBase = drumBase + DRUM + 0.95;
        addCylinder(g, 1.9, 2.0, 0.5, [0, domeBase + 0.1, BZ], marble, 12);
        addLathe(g, domeProfile(1.95, 2.3, 0.1, 8), 12, [0, domeBase + 0.35, BZ], marble);
        addCylinder(g, 0.3, 0.42, 0.6, [0, domeBase + 2.6, BZ], whiteStone, 6);
        addFinial(g, [0, domeBase + 2.85, BZ], 0.42, marble);

        // The twin stair: a landing at the centre door and two flights
        // running out along the front to the lawn.
        const STAIR_Z = FRONT + 1.5;
        addBox(g, [3.6, 1.3, 1.6], [0, 0.65, STAIR_Z], whiteStone);
        for (const side of [-1, 1]) {
          for (let step = 0; step < 6; step++) {
            const top = 1.3 * (1 - (step + 1) / 7);
            addBox(g, [0.5, top, 1.6], [side * (2.05 + step * 0.48), top / 2, STAIR_Z], whiteStone);
          }
          const sideRail = addBox(g, [3.4, 0.18, 0.2], [side * 3.1, 1.45, STAIR_Z + 0.8], marble);
          sideRail.rotation.z = side * -0.38;
          addBox(g, [0.4, 1.1, 0.4], [side * 4.85, 0.55, STAIR_Z + 0.8], marble);
        }

        // Clipped hedges along the front, open at the stair, and a walk on the
        // axis down to the bathing ghat on the pond's east bank.
        for (const side of [-1, 1]) addBox(g, [8.5, 0.75, 0.9], [side * 9.5, 0.37, hz + 4.6], landmarkLightCanopy);
        addBox(g, [3.2, 0.1, 29], [0, 0.1, hz + 4.6 + 14.2], whiteStone).castShadow = false;
        addBox(g, [6.4, 0.45, 2.4], [0, 0.22, 33.6], whiteStone);
        for (const side of [-1, 1]) addBox(g, [0.5, 1.0, 3.2], [side * 3.4, 0.5, 33.8], whiteStone);
        addBox(g, [6.0, 0.18, 0.7], [0, 0.11, 35.1], whiteStone);

        g.updateMatrix();
        const tower = new THREE.Vector3(0, 0, BZ).applyMatrix4(g.matrix);
        solid(tower.x, tower.z, 2.8, domeBase + 4.5);
        perchTarget = [tower.x, tower.z];
      }
      colliderTop = PARAPET;

      // The walled garden (OSM 439770049): one lawn under the whole open part
      // (the pond's water stands 5 cm above it), the round fountain and the
      // statue on the lawn, and palms round the pond. In group (world-aligned)
      // metres from the palace's centre.
      addBox(group, [105, 0.1, 64], [-20.5, 0.02, 4], lawn).castShadow = false;
      addBox(group, [18, 0.1, 33], [41, 0.02, 13.5], lawn).castShadow = false;
      clearSite(-20.5, 4, 52.5, 32);
      // The garden's boundary wall, just inside the lawn's edge.
      const WALL: Array<[number, number]> = [[-72.8, -27.8], [31.8, -27.8], [31.8, -2.8], [49.8, -2.8], [49.8, 29.8], [31.8, 29.8], [31.8, 35.8], [-72.8, 35.8]];
      WALL.forEach(([ax, az], index) => {
        const [bx, bz] = WALL[(index + 1) % WALL.length];
        const length = Math.hypot(bx - ax, bz - az);
        const wall = addBox(group, [0.35, 2.2, length + 0.35], [(ax + bx) / 2, 1.1, (az + bz) / 2], whiteStone);
        wall.rotation.y = Math.atan2(bx - ax, bz - az);
      });
      clearSite(41, 13.5, 9, 16.5);
      addCylinder(group, 1.45, 1.55, 0.55, [-15, 0.27, 7.6], whiteStone, 14);
      addCylinder(group, 1.2, 1.2, 0.1, [-15, 0.5, 7.6], archDark, 14);
      addCylinder(group, 0.25, 0.4, 0.9, [-15, 0.95, 7.6], marble, 6);
      addBox(group, [1.4, 1.9, 1.4], [-17, 0.95, -10], whiteStone);
      addBox(group, [1.7, 0.25, 1.7], [-17, 2.0, -10], whiteStone);
      addCylinder(group, 0.26, 0.42, 1.7, [-17, 2.95, -10], marble, 6);
      addLathe(group, domeProfile(0.24, 0.4, 0, 4), 6, [-17, 3.8, -10], marble);
      for (const [x, z, height, lean, turn] of [
        [-62, -11, 12, 0.1, 0.4], [-52, -10.5, 11, 0.06, 1.6], [-41, -11, 12.5, 0.12, 2.6], [-29, -13, 10.5, 0.08, 3.4],
        [-69, 2, 11.5, 0.1, 4.2], [-69.5, 16, 12, 0.07, 5.1], [-69, 30, 10.5, 0.11, 0.9],
        [-29.5, 28, 11, 0.09, 2.1], [-26, -21, 9.5, 0.05, 4.8], [14, -12, 10.5, 0.08, 1.2], [14, 14, 11.5, 0.1, 3.9],
      ] as const) addPalm(group, x, z, height, lean, turn);
      for (const [x, z, radius, trunk] of [
        [-50, -22, 5.2, 5.8], [-35, -24, 4.6, 5.4], [-64, -22, 4.8, 5.6], [27, 10, 5.0, 5.6], [24, 26, 4.6, 5.2],
        [42, 4, 4.4, 5.0], [44, 22, 4.8, 5.4], [-8, 30, 4.2, 5.0],
      ] as const) addLandmarkTree(group, x, z, radius, trunk, landmarkLightCanopy);
    } else if (landmark.kind === "tejgaon-airport") {
      // Tejgaon Airport, the city's first, now the Air Force's Base Bashar.
      // Local +Z runs down runway 17/35 (bearing 164.4°) and local +X points
      // east across the taxiway loop to the aprons and hangars; every outline
      // is an OSM chain from TEJGAON_AIRPORT turned into this frame. The
      // runway is disused, so its paint is worn: faded, with dashes missing.
      // Paving is flat and never struck; hangars and buildings are solid.
      boundsCollider = false;
      const GROUND = -0.9; // world y = 0
      const field = TEJGAON_AIRPORT;
      const local = (points: LatLon[]) => points.map(([lat, lon]) => toLocal(lat, lon) as MapPoint);
      const ground = (points: MapPoint[], y: number, material: THREE.Material) => {
        const geometry = new THREE.ShapeGeometry(polygonShape(points));
        geometry.rotateX(-Math.PI / 2);
        const mesh = new THREE.Mesh(geometry, material);
        mesh.position.y = GROUND + y;
        group.add(mesh);
      };
      // A strip of paving along a chain: one flat box per leg, run on past
      // each joint so the bends close up.
      const strip = (points: MapPoint[], width: number, y: number, material: THREE.Material) => {
        for (let index = 1; index < points.length; index++) {
          const [x1, z1] = points[index - 1];
          const [x2, z2] = points[index];
          const length = Math.hypot(x2 - x1, z2 - z1);
          if (length < 0.5) continue;
          const leg = addBox(group, [width, 0.16, length + width * 0.5], [(x1 + x2) / 2, GROUND + y - 0.08, (z1 + z2) / 2], material);
          leg.rotation.y = Math.atan2(x2 - x1, z2 - z1);
        }
      };
      // A flat-roofed block on an OSM outline, struck as the world-axis box
      // round it. The column also keeps the map's own copy of the building
      // and any generic plot off the spot.
      const block = (ring: LatLon[], height: number, wall: THREE.Material, roof: THREE.Material) => {
        const points = local(ring);
        const shape = polygonShape(points);
        const body = new THREE.Mesh(new THREE.ExtrudeGeometry(shape, { depth: height, bevelEnabled: false, curveSegments: 1 }).rotateX(-Math.PI / 2), wall);
        body.position.y = GROUND;
        const cap = new THREE.Mesh(new THREE.ExtrudeGeometry(shape, { depth: 0.5, bevelEnabled: false, curveSegments: 1 }).rotateX(-Math.PI / 2), roof);
        cap.position.y = GROUND + height;
        group.add(body, cap);
        let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
        for (const [x, z] of points) {
          const wx = group.position.x + x * cosH + z * sinH;
          const wz = group.position.z - x * sinH + z * cosH;
          minX = Math.min(minX, wx); maxX = Math.max(maxX, wx);
          minZ = Math.min(minZ, wz); maxZ = Math.max(maxZ, wz);
        }
        colliders.push({ x: (minX + maxX) / 2, z: (minZ + maxZ) / 2, halfWidth: (maxX - minX) / 2, halfDepth: (maxZ - minZ) / 2, top: height + 0.5 });
      };

      // Mown grass inside the fence (above park turf, below map water).
      ground(local(field.boundary), 0.36, airfieldGrass);
      // Aprons, then the taxiway loop and its stubs over them.
      for (const apron of field.aprons) ground(local(apron), 0.44, agedConcrete);
      for (const taxiway of field.taxiways) strip(local(taxiway), 23, 0.52, agedConcrete);

      // Runway 17/35: concrete shoulders, asphalt, and what is left of the paint.
      const LENGTH = field.runway.length;
      const WIDTH = field.runway.width;
      const HALF = LENGTH / 2;
      addBox(group, [WIDTH + 15, 0.2, LENGTH + 60], [0, GROUND + 0.5, 0], agedConcrete);
      addBox(group, [WIDTH, 0.2, LENGTH], [0, GROUND + 0.65, 0], wornAsphalt);
      const PAINT = GROUND + 0.78;
      const paint = (x: number, z: number, sizeX: number, sizeZ: number) => addBox(group, [sizeX, 0.06, sizeZ], [x, PAINT, z], fadedPaint);
      for (const side of [-1, 1]) paint(side * (WIDTH / 2 - 1.5), 0, 0.9, LENGTH - 20);
      let dash = 0;
      for (let z = -HALF + 110; z < HALF - 110; z += 60) {
        // About one dash in five has worn away.
        if ((dash++ * 7 + 3) % 5 !== 0) paint(0, z, 0.9, 30);
      }
      // Seven-segment numerals, read by a pilot on approach: `towards` is the
      // way that pilot is flying along local Z.
      const SEGMENTS: Record<string, string> = { "1": "i", "3": "abgcd", "5": "afgcd", "7": "abc" };
      const numeral = (digit: string, across: number, z: number, towards: 1 | -1) => {
        const W = 5.5, H = 16, S = 1.5;
        const bars: Record<string, [number, number, number, number]> = {
          a: [0, H / 2, W + S, S], g: [0, 0, W + S, S], d: [0, -H / 2, W + S, S],
          f: [-W / 2, H / 4, S, H / 2 + S], b: [W / 2, H / 4, S, H / 2 + S],
          e: [-W / 2, -H / 4, S, H / 2 + S], c: [W / 2, -H / 4, S, H / 2 + S],
          i: [0, 0, S, H + S],
        };
        for (const key of SEGMENTS[digit]) {
          const [u, v, sizeU, sizeV] = bars[key];
          paint(-towards * (across + u), z + towards * v, sizeU, sizeV);
        }
      };
      for (const [towards, digits] of [[1, "17"], [-1, "35"]] as const) {
        const threshold = -towards * HALF;
        for (let bar = -6; bar <= 6; bar++) {
          if (bar !== 0) paint(bar * 3.1, threshold + towards * 22, 1.8, 30);
        }
        numeral(digits[0], -5.6, threshold + towards * 56, towards);
        numeral(digits[1], 5.6, threshold + towards * 56, towards);
        for (const side of [-1, 1]) {
          for (const offset of [150, 300, 600]) paint(side * 9, threshold + towards * offset, 3, 22);
          paint(side * 10, threshold + towards * 420, 6, 45);
        }
      }

      // Hangars (metal sheds) and the base's other buildings.
      for (const hangar of field.hangars) block(hangar.ring, hangar.height, hangarWall, tinRoof);
      for (const building of field.buildings) block(building.ring, building.height, paleConcrete, roofGrey);
      // Helipads on the east aprons: a painted ring each.
      for (const [lat, lon, diameter] of field.helipads) {
        const [x, z] = toLocal(lat, lon);
        addCylinder(group, diameter / 2 + 1.6, diameter / 2 + 1.6, 0.04, [x, GROUND + 0.48, z], fadedPaint, 20);
        addCylinder(group, diameter / 2 + 0.7, diameter / 2 + 0.7, 0.04, [x, GROUND + 0.52, z], agedConcrete, 20);
        paint(x, z, 0.8, diameter * 0.6).position.y = GROUND + 0.57;
      }
      const [sockX, sockZ] = toLocal(...field.windsock);
      addCylinder(group, 0.18, 0.18, 7, [sockX, GROUND + 3.5, sockZ], plantGrey, 6);
      addBox(group, [3.2, 0.8, 0.8], [sockX + 1.6, GROUND + 6.6, sockZ], monumentRed);
      const hero = local(field.hangars[0].ring);
      perchTarget = [
        hero.reduce((sum, [x]) => sum + x, 0) / hero.length,
        hero.reduce((sum, [, z]) => sum + z, 0) / hero.length,
      ];
    } else if (landmark.kind === "sayedabad-bus-terminal" || landmark.kind === "gabtoli-bus-terminal") {
      // An intercity bus terminal: an oil-stained paved yard on the OSM
      // outline, the counter halls and sheds that stand on it, and coaches
      // parked nose-in at an angle down both sides of every service aisle.
      // Built in world axes (heading 0), so local offsets are world offsets.
      // The yard is never struck; the halls are solid; the parked coaches are
      // not (they are lower than the bird's ground clearance checks need).
      const sayedabad = landmark.kind === "sayedabad-bus-terminal";
      const terminal: BusTerminal = sayedabad ? SAYEDABAD_BUS_TERMINAL : GABTOLI_BUS_TERMINAL;
      boundsCollider = false;
      const GROUND = -0.9; // world y = 0
      // Below every road tier (shoulders start at 0.7), so the streets that
      // bound the yard draw over its edge.
      const YARD = GROUND + 0.45;
      const local = (points: LatLon[]) => points.map(([lat, lon]) => toLocal(lat, lon) as MapPoint);
      const yard = local(terminal.yard);
      const paving = new THREE.ShapeGeometry(polygonShape(yard));
      paving.rotateX(-Math.PI / 2);
      const pavingMesh = new THREE.Mesh(paving, yardPaving);
      pavingMesh.position.y = YARD;
      group.add(pavingMesh);
      const rings = terminal.blocks.map((entry) => local(entry.ring));
      terminal.blocks.forEach((entry, index) => {
        const shape = polygonShape(rings[index]);
        const body = new THREE.Mesh(new THREE.ExtrudeGeometry(shape, { depth: entry.height, bevelEnabled: false, curveSegments: 1 }).rotateX(-Math.PI / 2), index % 2 === 0 ? paleConcrete : cream);
        body.position.y = GROUND;
        const cap = new THREE.Mesh(new THREE.ExtrudeGeometry(shape, { depth: 0.4, bevelEnabled: false, curveSegments: 1 }).rotateX(-Math.PI / 2), tinRoof);
        cap.position.y = GROUND + entry.height;
        group.add(body, cap);
        const xs = rings[index].map(([x]) => x);
        const zs = rings[index].map(([, z]) => z);
        solidBox(
          (Math.min(...xs) + Math.max(...xs)) / 2,
          (Math.min(...zs) + Math.max(...zs)) / 2,
          (Math.max(...xs) - Math.min(...xs)) / 2,
          (Math.max(...zs) - Math.min(...zs)) / 2,
          GROUND + entry.height + 0.4,
        );
      });
      // An open tin shed: a roof on two rows of posts (local centre, size).
      const shed = (x: number, z: number, sizeX: number, sizeZ: number, height = 4.6) => {
        addBox(group, [sizeX, 0.3, sizeZ], [x, GROUND + height, z], tinRoof);
        const alongX = sizeX >= sizeZ;
        const run = alongX ? sizeX : sizeZ;
        const across = (alongX ? sizeZ : sizeX) / 2 - 0.6;
        for (let step = -run / 2 + 1; step <= run / 2 - 0.9; step += (run - 2) / Math.max(1, Math.round(run / 9))) {
          for (const side of [-1, 1]) {
            addBox(group, [0.35, height, 0.35], alongX ? [x + step, GROUND + height / 2, z + side * across] : [x + side * across, GROUND + height / 2, z + step], plantGrey);
          }
        }
      };
      if (sayedabad) {
        // Not in OSM: the passenger sheds in front of the south counter block
        // and along the west side of the yard.
        shed(38, 87, 76, 9);
        shed(-62, 96, 9, 44);
        clearSite(45, -37, 73, 71);
        clearSite(30, 70, 125, 34);
        clearSite(85, 108, 65, 4);
        clearSite(-70, 113, 25, 9);
        perchTarget = [38, 100];
      } else {
        clearSite(-112.5, -20, 92.5, 25);
        clearSite(74, -28.5, 94, 33.5);
        clearSite(50, 25, 110, 20);
        clearSite(72.5, 53.5, 72.5, 8.5);
        clearSite(67, 65, 48, 3.5);
        clearSite(-77.5, 13.5, 17.5, 8.5);
        perchTarget = [30, -38];
      }

      // Parked coaches. Each aisle is walked at one bay pitch; a coach stands
      // at 60° to it on either side, nose to the aisle. A bay is dropped if it
      // leaves the yard, crowds a hall, another aisle or a coach already
      // parked, or stands under an elevated road's deck or pier.
      const BAY_ANGLE = Math.PI / 3;
      const BAY_PITCH = 3.75;
      const HALF_LENGTH = 5.8;
      // Gabtoli's outline is road centrelines (Mirpur Road and the outer
      // loop), so its coaches stand further in.
      const EDGE_GAP = sayedabad ? 6 : 10;
      const aisles = terminal.aisles.map(local);
      const elevated = elevatedRoadCorridor();
      const random = seededRandom(sayedabad ? 4_101 : 4_217);
      const edgeDistance = (x: number, z: number, ring: MapPoint[]) => {
        let best = Infinity;
        for (let index = 0; index < ring.length; index++) {
          const [ax, az] = ring[index];
          const [bx, bz] = ring[(index + 1) % ring.length];
          best = Math.min(best, distanceToSegmentSquared(x, z, ax, az, bx, bz));
        }
        return Math.sqrt(best);
      };
      const chainDistance = (x: number, z: number, chain: MapPoint[]) => {
        let best = Infinity;
        for (let index = 1; index < chain.length; index++) {
          best = Math.min(best, distanceToSegmentSquared(x, z, chain[index - 1][0], chain[index - 1][1], chain[index][0], chain[index][1]));
        }
        return Math.sqrt(best);
      };
      const bays: Array<{ x: number; z: number; dx: number; dz: number }> = [];
      aisles.forEach((aisle, aisleIndex) => {
        let carried = BAY_PITCH;
        for (let index = 1; index < aisle.length; index++) {
          const [x1, z1] = aisle[index - 1];
          const [x2, z2] = aisle[index];
          const length = Math.hypot(x2 - x1, z2 - z1);
          if (length < 0.5) continue;
          const tx = (x2 - x1) / length;
          const tz = (z2 - z1) / length;
          for (; carried < length; carried += BAY_PITCH) {
            for (const side of [-1, 1]) {
              // The coach's long axis: the aisle direction swung 60° to this side.
              const cos = Math.cos(BAY_ANGLE * side);
              const sin = Math.sin(BAY_ANGLE * side);
              const dx = tx * cos - tz * sin;
              const dz = tx * sin + tz * cos;
              const x = x1 + tx * carried + dx * (HALF_LENGTH + 4.4);
              const z = z1 + tz * carried + dz * (HALF_LENGTH + 4.4);
              const probes: MapPoint[] = [[x, z], [x + dx * HALF_LENGTH, z + dz * HALF_LENGTH], [x - dx * HALF_LENGTH, z - dz * HALF_LENGTH]];
              if (probes.some(([px, pz]) => !pointInPolygon(px, pz, yard) || edgeDistance(px, pz, yard) < EDGE_GAP)) continue;
              if (probes.some(([px, pz]) => rings.some((ring) => pointInPolygon(px, pz, ring) || edgeDistance(px, pz, ring) < 3))) continue;
              if (probes.some(([px, pz]) => aisles.some((other, otherIndex) => chainDistance(px, pz, other) < (otherIndex === aisleIndex ? 2.6 : 4.2)))) continue;
              if (probes.some(([px, pz]) => elevated.blocksCircle(group.position.x + px, group.position.z + pz, 3))) continue;
              if (bays.some((bay) => {
                const others: MapPoint[] = [[bay.x, bay.z], [bay.x + bay.dx * HALF_LENGTH, bay.z + bay.dz * HALF_LENGTH], [bay.x - bay.dx * HALF_LENGTH, bay.z - bay.dz * HALF_LENGTH]];
                return probes.some(([px, pz]) => others.some(([ox, oz]) => Math.hypot(px - ox, pz - oz) < 3.1));
              })) continue;
              // The slot is taken either way; a fifth of the bays stand empty.
              bays.push({ x, z, dx, dz });
            }
          }
          carried -= length;
        }
      });
      const parked = bays.filter(() => random() > 0.2);
      const bodies = new THREE.InstancedMesh(busBodyGeometry, busPaint, parked.length);
      const windows = new THREE.InstancedMesh(busWindowGeometry, busGlass, parked.length);
      bodies.name = `${landmark.label} parked coaches`;
      const bayMatrix = new THREE.Matrix4();
      const bayColor = new THREE.Color();
      parked.forEach((bay, index) => {
        const turn = -Math.atan2(bay.dz, bay.dx) + (random() - 0.5) * 0.05;
        bayMatrix.makeRotationY(turn).setPosition(bay.x, YARD + 0.45 + 1.45, bay.z);
        bodies.setMatrixAt(index, bayMatrix);
        bayMatrix.setPosition(bay.x, YARD + 0.45 + 2.05, bay.z);
        windows.setMatrixAt(index, bayMatrix);
        bodies.setColorAt(index, bayColor.setHex(BUS_LIVERIES[Math.floor(random() * BUS_LIVERIES.length)]));
      });
      bodies.instanceMatrix.needsUpdate = true;
      windows.instanceMatrix.needsUpdate = true;
      if (bodies.instanceColor) bodies.instanceColor.needsUpdate = true;
      bodies.castShadow = true;
      bodies.receiveShadow = true;
      group.add(bodies, windows);
    } else {
      // Every other landmark lives in its own file under app/landmarks/ and
      // builds itself with the kit (see the guide in app/landmarks/kit.ts).
      const landmarkModule = LANDMARK_MODULE_BY_KIND.get(landmark.kind);
      if (landmarkModule) {
        // Its extents are local to its heading, so its default collider is a
        // turned box added below rather than the world-axis bounds box.
        boundsCollider = false;
        colliderTop = landmark.altitude;
        let extentsCollider = true;
        const kit: LandmarkKit = {
          THREE,
          group,
          materials: moduleMaterials,
          material: moduleMaterial,
          litMaterial: moduleLitMaterial,
          addBox,
          addCylinder,
          addCone,
          addLathe,
          domeProfile,
          addFinial,
          addChhatri,
          addArcSlab,
          addBeam,
          addQuads,
          addSweptBox,
          addPrism,
          addGeodesicDome,
          addMesh,
          addTree: addLandmarkTree,
          addPalm,
          roundArch,
          pointedArch,
          rectPane,
          discPane,
          trianglePane,
          offsetPolygon,
          wallEdges,
          addOnWall,
          addBays,
          solid,
          solidBox,
          solidTiles,
          clearSite,
          clearOval,
          setColliderTop: (value) => { colliderTop = value; },
          setBoundsCollider: (enabled) => { extentsCollider = enabled; },
          setPerchTarget: (x, z) => { perchTarget = [x, z]; },
          toLocal,
          worldToLocal: (x, z) => {
            const dx = x - group.position.x;
            const dz = z - group.position.z;
            return [dx * cosH - dz * sinH, dx * sinH + dz * cosH];
          },
        };
        const stats: LandmarkModuleStats = { triangles: 0, drawCalls: 0, budget: landmarkModule.triangleBudget ?? 4000 };
        landmarkModuleStats[landmarkModule.key] = stats;
        try {
          landmarkModule.build(kit);
          if (extentsCollider) solidBox(0, 0, landmarkModule.extents[0], landmarkModule.extents[1], colliderTop);
        } catch (error) {
          // Leave a bare, collider-free site rather than half a landmark.
          group.clear();
          colliders.length = colliderStart;
          perchTarget = [0, 0];
          stats.error = error instanceof Error ? error.message : String(error);
          reportLandmarkModule(`Landmark module "${landmarkModule.key}" failed to build: ${stats.error}`);
        }
      }
    }

    bakeGroup(group);
    group.updateMatrixWorld(true);
    group.traverse((object) => { object.matrixAutoUpdate = false; });
    const moduleStats = landmarkModuleStats[landmark.kind];
    if (moduleStats) {
      group.traverse((object) => {
        if (!(object instanceof THREE.Mesh)) return;
        const geometry = object.geometry as THREE.BufferGeometry;
        const faces = (geometry.index ? geometry.index.count : geometry.getAttribute("position").count) / 3;
        moduleStats.triangles += Math.round(faces * (object instanceof THREE.InstancedMesh ? object.count : 1));
        moduleStats.drawCalls += 1;
      });
      if (moduleStats.triangles > moduleStats.budget) {
        reportLandmarkModule(`Landmark module "${landmark.kind}" is ${moduleStats.triangles} triangles, over its budget of ${moduleStats.budget}.`);
      }
    }
    const bounds = allBounds.get(landmark.kind)!;
    if (boundsCollider) {
      colliders.push({
        x: (bounds.minX + bounds.maxX) / 2,
        z: (bounds.minZ + bounds.maxZ) / 2,
        halfWidth: Math.max(3, (bounds.maxX - bounds.minX) / 2),
        halfDepth: Math.max(3, (bounds.maxZ - bounds.minZ) / 2),
        top: colliderTop,
      });
    }
    // Generic plots keep a forecourt off every solid part of the landmark;
    // sites that stand in a compound keep a wider one.
    const plotGap = LANDMARK_MODULE_BY_KIND.get(landmark.kind)?.plotGap ?? LANDMARK_PLOT_GAP[landmark.kind] ?? 16;
    for (let index = colliderStart; index < colliders.length; index++) {
      if (colliders[index].top > 0) colliders[index].gap = plotGap;
    }
    const world = coordinatesToWorld(landmark.lat, landmark.lon);
    const perchWorldX = perchTarget[0] !== 0 || perchTarget[1] !== 0
      ? group.position.x + perchTarget[0] * cosH + perchTarget[1] * sinH
      : world.x;
    const perchWorldZ = perchTarget[0] !== 0 || perchTarget[1] !== 0
      ? group.position.z - perchTarget[0] * sinH + perchTarget[1] * cosH
      : world.y;
    // Seat the perch on whatever is actually built at the hero target spot, so the
    // crow lands on the roof, dome, or canopy rather than floating or inside geometry.
    perchRay.set(perchOrigin.set(perchWorldX, 900, perchWorldZ), perchDown);
    const surfaces = perchRay.intersectObjects([group, ...(landmarkMeshes.get(landmark.kind) ?? [])], true);
    let perchTop = surfaces.length > 0 ? surfaces[0].point.y : top;
    // A perch below the top of a collision column could never be reached, so
    // it never sits lower than the columns that contain it.
    for (const collider of colliders) {
      if (Math.abs(perchWorldX - collider.x) <= collider.halfWidth && Math.abs(perchWorldZ - collider.z) <= collider.halfDepth) {
        perchTop = Math.max(perchTop, collider.top);
      }
    }
    const perch = {
      position: new THREE.Vector3(perchWorldX, perchTop, perchWorldZ),
      label: landmark.label,
      heading: landmark.heading,
    };
    perches.push(perch);
    addLabel(perch.position.clone().add(new THREE.Vector3(0, 24, 0)), landmark.label);
  }
  treeCrownGeo.dispose();

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
    const GIRDER_SAMPLES = metroGirderSampleCount(curveLength);
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
      const nx = (-tangent.z / perpLen) * METRO_GIRDER_HALF_WIDTH;
      const nz = (tangent.x / perpLen) * METRO_GIRDER_HALF_WIDTH;
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
      const u = index / PIER_COUNT;
      const point = metroCurve.getPointAt(u);
      const tangent = metroCurve.getTangentAt(u);
      const pierHeight = Math.max(5, point.y - 0.5);
      addCylinder(metroRoot, 2.4, 3.8, pierHeight, [point.x, pierHeight / 2, point.z], concrete, 8);
      const cap = addBox(metroRoot, [4.2, 2.2, METRO_PIER_CAP_WIDTH], [point.x, point.y - 3, point.z], concrete);
      cap.rotation.y = Math.atan2(-tangent.z, tangent.x);
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

  // ELEVATED ROADS: every structure in the ELEVATED_ROADS table (see
  // elevated-roads.ts for the format), swept as a box-girder deck per chain.
  // A deck is one vertex-coloured mesh per structure per square kilometre, so
  // the frustum can drop most of a long viaduct; piers are two instanced
  // meshes per structure. Low ramp ends stand on solid walls instead of piers.
  const buildElevatedRoads = () => {
    const elevatedRoot = new THREE.Group();
    elevatedRoot.name = "Elevated roads";
    root.add(elevatedRoot);
    const deckMaterial = new THREE.MeshStandardMaterial({ color: 0xffffff, vertexColors: true, roughness: 0.86 });
    const columnGeometry = new THREE.CylinderGeometry(1, 1, 1, 8, 1, true).translate(0, 0.5, 0);
    const bladeGeometry = new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0);
    // A lamp post standing on the parapet line: mast, arm reaching +x, lantern.
    const lampGeometry = mergeGeometries([
      new THREE.BoxGeometry(0.24, 9, 0.24).translate(0, 4.5, 0),
      new THREE.BoxGeometry(2.6, 0.16, 0.16).translate(1.2, 8.9, 0),
      new THREE.BoxGeometry(0.9, 0.2, 0.42).translate(2.3, 8.72, 0),
    ], false);
    const lampMaterial = new THREE.MeshStandardMaterial({ color: 0x4a5354, roughness: 0.6, metalness: 0.45 });
    // Marks a strip corner that sits on the girder's soffit, whatever its depth there.
    const SOFFIT = -1000;
    const DECK_CELL = 1000;
    const EDGE_SLAB = 0.45;
    const PARAPET_WIDTH = 0.45;
    const CAP_DEPTH = 1.4;
    // Decks lower than this stand on fill between walls and take no piers.
    const WALL_SOFFIT = 2.6;
    const tint = new THREE.Color();
    const deckColliders: BuildingCollider[] = [];
    type PierSet = {
      layout: ElevatedRoadLayout;
      shafts: THREE.InstancedMesh;
      caps: THREE.InstancedMesh;
    };
    const pierSets: PierSet[] = [];

    for (const layout of elevatedRoadLayouts()) {
      const { road, chains } = layout;
      const style = ELEVATED_ROAD_STYLES[road.style];
      const cells = new Map<string, { positions: number[]; colors: number[] }>();
      let pierCapacity = 0;
      for (const chain of chains) {
        const half = chain.half;
        const web = half * style.webRatio;
        pierCapacity += chain.pierStations.length;
        // Sibling chains may overlap at one level; a few centimetres between
        // their road surfaces stops a lane line fighting asphalt.
        const lift = chain.lift;
        for (let index = 0; index < chain.rings.length - 1; index++) {
          const p = chain.rings[index];
          const q = chain.rings[index + 1];
          const key = `${Math.floor((p.x + q.x) / 2 / DECK_CELL)}:${Math.floor((p.z + q.z) / 2 / DECK_CELL)}`;
          let cell = cells.get(key);
          if (!cell) cells.set(key, cell = { positions: [], colors: [] });
          const { positions, colors } = cell;
          // One strip of the cross-section between the two rings, from
          // [offset, height above the road surface] a to b. `out` is the way
          // it faces: sideways (-1 left, 1 right), up or down.
          const strip = (a: [number, number], b: [number, number], color: number, out: [number, number]) => {
            const corner = (ring: typeof p, [offset, rise]: [number, number]): QuadPoint => (
              [ring.x + ring.rx * offset, Math.max(0.2, ring.top + (rise === SOFFIT ? -ring.depth : rise)), ring.z + ring.rz * offset]
            );
            const [c0, c1, c2, c3] = [corner(p, a), corner(p, b), corner(q, b), corner(q, a)];
            const ux = c1[0] - c0[0], uy = c1[1] - c0[1], uz = c1[2] - c0[2];
            const vx = c2[0] - c0[0], vy = c2[1] - c0[1], vz = c2[2] - c0[2];
            const facing = (uy * vz - uz * vy) * p.rx * out[0] + (uz * vx - ux * vz) * out[1] + (ux * vy - uy * vx) * p.rz * out[0];
            const ring = facing >= 0 ? [c0, c1, c2, c3] : [c0, c3, c2, c1];
            positions.push(...ring[0], ...ring[1], ...ring[2], ...ring[0], ...ring[2], ...ring[3]);
            tint.setHex(color);
            for (let vertex = 0; vertex < 6; vertex++) colors.push(tint.r, tint.g, tint.b);
          };
          if (chain.atGrade) {
            // A link road on the ground: just its surface and kerbs.
            strip([-half, lift], [-0.16, lift], style.asphalt, [0, 1]);
            strip([-0.16, lift], [0.16, lift], 0xdad6c8, [0, 1]);
            strip([0.16, lift], [half, lift], style.asphalt, [0, 1]);
            for (const side of [-1, 1]) strip([side * half, lift], [side * half, -EDGE_SLAB], style.girder, [side, 0]);
            continue;
          }
          const onWalls = Math.max(p.top - p.depth, q.top - q.depth) < WALL_SOFFIT;
          const edges = [-1, 1].map((side) => {
            const parapet = p.parapet[side < 0 ? 0 : 1] && q.parapet[side < 0 ? 0 : 1];
            const edge = side * half;
            if (parapet) {
              const inner = side * (half - PARAPET_WIDTH);
              strip([inner, 0], [inner, style.parapetHeight], style.parapet, [-side, 0]);
              strip([inner, style.parapetHeight], [edge, style.parapetHeight], style.parapet, [0, 1]);
              strip([edge, style.parapetHeight], [edge, -EDGE_SLAB], style.parapet, [side, 0]);
            } else {
              strip([edge, 0], [edge, -EDGE_SLAB], style.girder, [side, 0]);
            }
            if (onWalls) strip([edge, -EDGE_SLAB], [edge, -40], style.girder, [side, 0]);
            else strip([edge, -EDGE_SLAB], [side * web, SOFFIT], style.soffit, [side * 0.4, -1]);
            return parapet ? side * (half - PARAPET_WIDTH) : edge;
          });
          if (style.laneLine) {
            // Lane lines split the carriageway into `lanes` equal lanes.
            const lanes = chain.lanes;
            let from = edges[0];
            for (let line = 1; line < lanes; line++) {
              const offset = (half - PARAPET_WIDTH) * ((2 * line) / lanes - 1);
              strip([from, lift], [offset - 0.16, lift], style.asphalt, [0, 1]);
              strip([offset - 0.16, lift], [offset + 0.16, lift], 0xdad6c8, [0, 1]);
              from = offset + 0.16;
            }
            strip([from, lift], [edges[1], lift], style.asphalt, [0, 1]);
          } else {
            strip([edges[0], lift], [edges[1], lift], style.asphalt, [0, 1]);
          }
          if (!onWalls) strip([-web, SOFFIT], [web, SOFFIT], style.soffit, [0, -1]);
        }
        // What the bird strikes: overlapping columns under the deck wherever
        // it is clear of the ground, as the Kuril ramps have.
        if (road.collide !== false && !chain.atGrade) {
          const step = Math.max(6, half * 1.4);
          for (let s = 0; s <= chain.length; s += step) {
            const { x, z, top } = chain.at(s);
            if (top > 2.4) deckColliders.push({ x, z, halfWidth: half + 0.8, halfDepth: half + 0.8, top: top + 0.4 });
          }
        }
      }
      for (const [key, { positions, colors }] of cells) {
        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
        geometry.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
        geometry.computeVertexNormals();
        const deck = new THREE.Mesh(geometry, deckMaterial);
        deck.name = `${road.key} deck ${key}`;
        deck.castShadow = true;
        deck.receiveShadow = true;
        deck.matrixAutoUpdate = false;
        elevatedRoot.add(deck);
      }
      // Portal piers (see placePiers) take two shafts.
      const shafts = new THREE.InstancedMesh(style.pier === "wall" ? bladeGeometry : columnGeometry, concrete, pierCapacity * 2);
      const caps = new THREE.InstancedMesh(unitBox, concrete, pierCapacity);
      for (const mesh of [shafts, caps]) {
        mesh.name = `${road.key} ${mesh === shafts ? "pier shafts" : "pier caps"}`;
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        mesh.matrixAutoUpdate = false;
        elevatedRoot.add(mesh);
      }
      pierSets.push({ layout, shafts, caps });
      if (road.lampSpacing) {
        // Lamp posts down both parapets, staggered side to side.
        const spots: Array<{ x: number; z: number; top: number; turn: number }> = [];
        for (const chain of chains) {
          // Only the bridge itself is lit, not the link ramps beside it.
          if (!chain.pierStations.some((station) => station.river)) continue;
          for (const side of [-1, 1]) {
            for (let s = road.lampSpacing * (side < 0 ? 0.5 : 1); s < chain.length; s += road.lampSpacing) {
              const { x, z, tx, tz, top } = chain.at(s);
              if (top - chain.depthAt(s) < WALL_SOFFIT) continue;
              const reach = side * (chain.half - PARAPET_WIDTH / 2);
              // The arm (+x of the post) points back across the deck.
              spots.push({ x: x - tz * reach, z: z + tx * reach, top, turn: Math.atan2(side * tx, side * tz) });
            }
          }
        }
        const lamps = new THREE.InstancedMesh(lampGeometry, lampMaterial, spots.length);
        const lampMatrix = new THREE.Matrix4();
        spots.forEach((spot, index) => lamps.setMatrixAt(index, lampMatrix.makeRotationY(spot.turn).setPosition(spot.x, spot.top + style.parapetHeight - 0.2, spot.z)));
        lamps.name = `${road.key} lamps`;
        lamps.matrixAutoUpdate = false;
        lamps.computeBoundingBox();
        lamps.computeBoundingSphere();
        elevatedRoot.add(lamps);
      }
      if (road.label) {
        const middle = chains[0].at(road.labelAt ?? chains[0].length / 2);
        addLabel(new THREE.Vector3(middle.x, middle.top + 26, middle.z), road.label, elevatedRoot);
      }
    }

    // Piers stand every `pierSpacing` metres wherever the deck is up on its
    // girder. `blocked` reports a spot a pier must not stand on (open water,
    // the carriageway of a street crossing underneath); a blocked pier slides
    // along the deck to the nearest free spot, or is left out.
    const pierMatrix = new THREE.Matrix4();
    const pierPosition = new THREE.Vector3();
    const pierQuaternion = new THREE.Quaternion();
    const pierScale = new THREE.Vector3();
    const upAxis = new THREE.Vector3(0, 1, 0);
    const keepOut = ELEVATED_ROAD_PIER_KEEP_OUT.map(({ points, halfWidth }) => ({
      plan: points.map(([lat, lon]) => coordinatesToWorld(lat, lon)),
      halfWidth,
    }));
    // `strict` (portal legs, which stand off the deck's centre line) treats a
    // street running along the deck as blocking too, except on its centre
    // line: a leg may stand in the median or beyond the kerb, never in a lane.
    const placePiers = (blocked: (x: number, z: number, tx: number, tz: number, inWaterAllowed: boolean, strict?: boolean) => boolean) => {
      const layouts = elevatedRoadLayouts();
      for (const { layout, shafts, caps } of pierSets) {
        const { road, chains } = layout;
        const style = ELEVATED_ROAD_STYLES[road.style];
        let shaftCount = 0;
        let capCount = 0;
        // Stations left without a pier, for the dev diagnostics.
        let missing = 0;
        const clearOfKeepOut = (x: number, z: number) => !keepOut.some(({ plan, halfWidth }) => plan.some((point, index) => index > 0
          && distanceToSegmentSquared(x, z, plan[index - 1].x, plan[index - 1].y, point.x, point.y) < (halfWidth + style.pierRadius + 0.4) ** 2));
        for (const chain of chains) {
          if (chain.atGrade) continue;
          const web = chain.half * style.webRatio;
          for (const { s, river } of chain.pierStations) {
            if (shaftCount + 2 > shafts.instanceMatrix.count || capCount >= caps.instanceMatrix.count) break;
            let placed = false;
            let underDeck = false;
            // A main-span pier stands where the span puts it; the rest may slide.
            for (const shift of river ? [0] : [0, 5, -5, 10, -10, 15, -15]) {
              const { x, z, tx, tz, top } = chain.at(s + shift);
              const soffit = top - chain.depthAt(s + shift);
              if (soffit < WALL_SOFFIT) break;
              // Not through a lower deck or a link road at a crossing or merge.
              if (elevatedDeckBelow(layouts, chain, x, z, tx, tz, soffit, style.pierRadius + 0.4)) {
                underDeck = true;
                continue;
              }
              if (!clearOfKeepOut(x, z)) continue;
              if (!river && blocked(x, z, tx, tz, style.piersInWater)) continue;
              pierQuaternion.setFromAxisAngle(upAxis, Math.atan2(tx, tz));
              if (style.pier === "wall" && river) {
                // A blade as wide as the soffit on a pile cap at the waterline.
                shafts.setMatrixAt(shaftCount++, pierMatrix.compose(pierPosition.set(x, 0, z), pierQuaternion, pierScale.set(web * 1.7, soffit, style.pierRadius * 1.4)));
                caps.setMatrixAt(capCount++, pierMatrix.compose(pierPosition.set(x, 1.1, z), pierQuaternion, pierScale.set(web * 1.7 + 3, 1.8, style.pierRadius * 1.4 + 3.4)));
              } else if (style.pier === "wall") {
                // An approach pier on land: a narrower blade under a crosshead.
                shafts.setMatrixAt(shaftCount++, pierMatrix.compose(pierPosition.set(x, 0, z), pierQuaternion, pierScale.set(web * 1.1, soffit - 1.2, style.pierRadius * 1.4)));
                caps.setMatrixAt(capCount++, pierMatrix.compose(pierPosition.set(x, soffit - 0.6, z), pierQuaternion, pierScale.set(web * 1.9, 1.2, style.pierRadius * 1.4 + 0.7)));
              } else {
                shafts.setMatrixAt(shaftCount++, pierMatrix.compose(pierPosition.set(x, 0, z), pierQuaternion, pierScale.set(style.pierRadius, soffit - CAP_DEPTH, style.pierRadius)));
                caps.setMatrixAt(capCount++, pierMatrix.compose(pierPosition.set(x, soffit - CAP_DEPTH / 2, z), pierQuaternion, pierScale.set(web * 2 + 0.8, CAP_DEPTH, style.pierRadius * 2.2)));
              }
              placed = true;
              break;
            }
            // A deck stacked over lower ones (Moghbazar at Malibagh) has no
            // ground under its centre for hundreds of metres. There it rides
            // on a portal: a leg either side, clear of the lower decks, and a
            // crossbeam under the soffit spanning them.
            if (!placed && underDeck && style.pier === "column") {
              const { x, z, tx, tz, top } = chain.at(s);
              const soffit = top - chain.depthAt(s);
              const beamBottom = soffit - CAP_DEPTH;
              // Lateral unit vector, to the deck's right.
              const rx = -tz;
              const rz = tx;
              const legClear = (offset: number) => {
                const lx = x + rx * offset;
                const lz = z + rz * offset;
                return !elevatedDeckBelow(layouts, chain, lx, lz, tx, tz, soffit, style.pierRadius + 0.4)
                  && clearOfKeepOut(lx, lz) && !blocked(lx, lz, tx, tz, style.piersInWater, true);
              };
              const reach = (side: 1 | -1) => {
                for (let offset = chain.half; offset <= 16; offset += 0.5) if (legClear(side * offset)) return offset;
                return null;
              };
              const left = reach(-1);
              const right = reach(1);
              // The beam must pass over the lower decks' parapets.
              const beamClear = left !== null && right !== null && !layouts.some(({ chains: others }) => others.some((other) => {
                if (other === chain || other.atGrade) return false;
                for (let offset = -left; offset <= right; offset += 1) {
                  const near = other.nearest(x + rx * offset, z + rz * offset);
                  if (near.distance < other.half && other.at(near.s).top + 1.6 > beamBottom && other.at(near.s).top < soffit - 1) return true;
                }
                return false;
              }));
              if (left !== null && right !== null && beamClear) {
                pierQuaternion.setFromAxisAngle(upAxis, Math.atan2(tx, tz));
                for (const offset of [-left, right]) {
                  shafts.setMatrixAt(shaftCount++, pierMatrix.compose(pierPosition.set(x + rx * offset, 0, z + rz * offset), pierQuaternion, pierScale.set(style.pierRadius, beamBottom, style.pierRadius)));
                }
                const middle = (right - left) / 2;
                caps.setMatrixAt(capCount++, pierMatrix.compose(
                  pierPosition.set(x + rx * middle, soffit - CAP_DEPTH / 2, z + rz * middle),
                  pierQuaternion,
                  pierScale.set(left + right + style.pierRadius * 2, CAP_DEPTH, style.pierRadius * 2.2),
                ));
                placed = true;
              }
            }
            if (!placed && chain.at(s).top - chain.depthAt(s) >= WALL_SOFFIT) missing++;
          }
        }
        if (import.meta.env.DEV) (scene.userData.elevatedPiersMissing ??= {})[road.key] = missing;
        shafts.count = shaftCount;
        caps.count = capCount;
        for (const mesh of [shafts, caps]) {
          mesh.instanceMatrix.needsUpdate = true;
          mesh.computeBoundingBox();
          mesh.computeBoundingSphere();
        }
      }
    };
    placePiers(() => false);

    // Once the map arrives, move piers out of its water and off the streets
    // that cross under the decks. Streets running along a deck are left alone:
    // the piers stand in their median.
    scene.userData.placeElevatedRoadPiers = (water: OsmMapData["water"], roads: OsmMapData["roads"]) => {
      const corridor = elevatedRoadCorridor();
      const CELL = 120;
      type Obstacle = { x1: number; z1: number; x2: number; z2: number; radius: number; water: boolean };
      const obstacles = new Map<string, Obstacle[]>();
      const waterAreas = new Map<string, MapPoint[][]>();
      const addToCells = <T,>(grid: Map<string, T[]>, item: T, minX: number, maxX: number, minZ: number, maxZ: number) => {
        for (let cellX = Math.floor(minX / CELL); cellX <= Math.floor(maxX / CELL); cellX++) {
          for (let cellZ = Math.floor(minZ / CELL); cellZ <= Math.floor(maxZ / CELL); cellZ++) {
            const key = `${cellX}:${cellZ}`;
            const bucket = grid.get(key);
            if (bucket) bucket.push(item);
            else grid.set(key, [item]);
          }
        }
      };
      const addSegments = (points: MapPoint[], radius: number, isWater: boolean) => {
        for (let index = 1; index < points.length; index++) {
          const [x1, z1] = points[index - 1];
          const [x2, z2] = points[index];
          // Only what lies near a deck matters.
          if (!corridor.blocksCircle((x1 + x2) / 2, (z1 + z2) / 2, Math.hypot(x2 - x1, z2 - z1) / 2 + radius + 12)) continue;
          addToCells(obstacles, { x1, z1, x2, z2, radius, water: isWater }, Math.min(x1, x2) - radius, Math.max(x1, x2) + radius, Math.min(z1, z2) - radius, Math.max(z1, z2) + radius);
        }
      };
      for (const road of roads) {
        if (ELEVATED_ROAD_WAY_IDS.has(road.id) || road.points.length < 2) continue;
        const major = road.kind === "motorway" || road.kind === "trunk" || road.kind === "primary" || road.kind === "secondary";
        addSegments(road.points, (major ? (road.kind === "motorway" || road.kind === "trunk" ? 8.5 : 7) : 3.75) + 1.5, false);
      }
      for (const feature of water) {
        if (feature.area && feature.points.length >= 3) {
          let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
          for (const [x, z] of feature.points) {
            minX = Math.min(minX, x);
            maxX = Math.max(maxX, x);
            minZ = Math.min(minZ, z);
            maxZ = Math.max(maxZ, z);
          }
          if (corridor.blocksCircle((minX + maxX) / 2, (minZ + maxZ) / 2, Math.hypot(maxX - minX, maxZ - minZ) / 2 + 12)) {
            addToCells(waterAreas, feature.points, minX, maxX, minZ, maxZ);
          }
        } else {
          const width = waterLineWidth(feature.points);
          if (width > 0) addSegments(feature.points, width / 2 + 1.5, true);
        }
      }
      placePiers((x, z, tx, tz, inWaterAllowed, strict = false) => {
        const key = `${Math.floor(x / CELL)}:${Math.floor(z / CELL)}`;
        if (!inWaterAllowed && (waterAreas.get(key) ?? []).some((points) => pointInPolygon(x, z, points))) return true;
        for (const obstacle of obstacles.get(key) ?? []) {
          if (obstacle.water && inWaterAllowed) continue;
          const distanceSquared = distanceToSegmentSquared(x, z, obstacle.x1, obstacle.z1, obstacle.x2, obstacle.z2);
          if (distanceSquared > obstacle.radius ** 2) continue;
          if (obstacle.water) return true;
          const dx = obstacle.x2 - obstacle.x1;
          const dz = obstacle.z2 - obstacle.z1;
          // A street within about 35° of the deck's line runs along it, not
          // across, and a centre pier may stand in its median.
          if (Math.abs(dx * tx + dz * tz) < 0.82 * Math.hypot(dx, dz)) return true;
          if (strict && distanceSquared > 1.2 ** 2) return true;
        }
        return false;
      });
    };
    scene.userData.elevatedRoadColliders = deckColliders;
  };
  buildElevatedRoads();

  scene.add(root);
  scene.userData.landmarkColliders = colliders;
  scene.userData.landmarkRoot = root;
  scene.userData.landmarkOsmIds = landmarkOsmIds;
  return { colliders, perches };
}

/**
 * Draw a district or river sign (80 px tall canvas) in the scene's label
 * language: capitals in monospace for English, the Bangla face for Bangla.
 */
function drawSignText(
  context: CanvasRenderingContext2D,
  locale: Locale,
  label: string,
  width: number,
  fontSize: number,
  fill: string,
  stroke: string,
  ink: string,
  texture: THREE.Texture,
) {
  const text = locale === "en" ? label.toUpperCase() : placeName(locale, label);
  const family = locale === "bn"
    ? `${getComputedStyle(document.body).getPropertyValue("--font-bangla") || "sans-serif"}, sans-serif`
    : "monospace";
  context.clearRect(0, 0, width, 80);
  context.fillStyle = fill;
  context.fillRect(2, 2, width - 4, 76);
  context.strokeStyle = stroke;
  context.lineWidth = 3;
  context.strokeRect(3.5, 3.5, width - 7, 73);
  context.fillStyle = ink;
  context.textAlign = "center";
  context.textBaseline = "middle";
  let size = locale === "bn" ? fontSize + 5 : fontSize;
  do {
    context.font = `600 ${size}px ${family}`;
    size -= 2;
  } while (size > 14 && context.measureText(text).width > width - 24);
  context.fillText(text, width / 2, locale === "bn" ? 44 : 41);
  texture.needsUpdate = true;
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
    canvas.width = canvas.height = 512;
    const context = canvas.getContext("2d");
    if (!context) return null;
    const size = canvas.width;
    // What shows between Dhaka's buildings from the air is shadowed lane,
    // worn asphalt and dust: a dark warm grey with only faint plot marks, so
    // gaps in the crust read as lanes instead of a tan tiled floor.
    context.fillStyle = "#5f5d59";
    context.fillRect(0, 0, size, size);

    // Dense urban city blocks, courtyards, and low-rise concrete/brick lots.
    const lotPalette = [
      "#66635e",
      "#615f5a",
      "#5c5a56",
      "#6a6761",
      "#585652",
      "#67605a",
      "#625a54",
    ];
    const grid = 8;
    const cell = size / grid;
    for (let row = 0; row < grid; row++) {
      for (let col = 0; col < grid; col++) {
        const bx = col * cell;
        const by = row * cell;
        // Narrow asphalt/concrete lane framing each urban block.
        context.fillStyle = (row + col) % 3 === 0 ? "#52504d" : "#585653";
        context.fillRect(bx, by, cell, cell);
        const pad = 2.5 + random() * 2;
        context.fillStyle = lotPalette[Math.floor(random() * lotPalette.length)];
        context.fillRect(bx + pad, by + pad, cell - pad * 2, cell - pad * 2);

        // Subdivide each block into tightly packed Dhaka plots, alleys, and roofs.
        const subCols = 2 + Math.floor(random() * 2);
        const subRows = 2 + Math.floor(random() * 2);
        const innerW = (cell - pad * 2) / subCols;
        const innerH = (cell - pad * 2) / subRows;
        for (let sr = 0; sr < subRows; sr++) {
          for (let sc = 0; sc < subCols; sc++) {
            const px = bx + pad + sc * innerW + 1.2;
            const py = by + pad + sr * innerH + 1.2;
            const pw = Math.max(2, innerW - 2.4);
            const ph = Math.max(2, innerH - 2.4);
            context.fillStyle = lotPalette[Math.floor(random() * lotPalette.length)];
            context.fillRect(px, py, pw, ph);
            // Subtle shadow edge along tightly packed plots.
            context.fillStyle = "rgba(42, 38, 34, 0.14)";
            context.fillRect(px + pw - 1.5, py, 1.5, ph);
            context.fillRect(px, py + ph - 1.5, pw, 1.5);
            // Occasional tiny shaded courtyard garden speck inside urban blocks.
            if (random() < 0.075 && pw > 6 && ph > 6) {
              context.fillStyle = "rgba(62, 82, 52, 0.24)";
              context.fillRect(px + 2, py + 2, Math.min(4, pw - 4), Math.min(4, ph - 4));
            }
          }
        }
      }
    }

    // Subtle dusty concrete & brick-grit speckle across the urban surface.
    for (let i = 0; i < 4200; i++) {
      const shade = 28 + Math.floor(random() * 20);
      const hue = 24 + random() * 16;
      context.fillStyle = `hsla(${hue}, 10%, ${shade}%, ${0.06 + random() * 0.08})`;
      const s = 1 + random() * 3;
      context.fillRect(random() * size, random() * size, s, s);
    }

    const texture = new THREE.CanvasTexture(canvas);
    texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
    texture.repeat.set(136, 136);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = 4;
    return texture;
  };

  // Beyond the districts the ground is field and wetland, not asphalt: a
  // coarse vertex tint turns the grey olive where no district claims it.
  const groundGeometry = new THREE.PlaneGeometry(34_000, 34_000, 112, 112);
  const groundPositions = groundGeometry.getAttribute("position");
  const groundTints = new Float32Array(groundPositions.count * 3);
  const groundDistricts = AREA_LANDMARKS.map((landmark) => coordinatesToWorld(landmark.lat, landmark.lon));
  for (let index = 0; index < groundPositions.count; index++) {
    // The plane is laid flat below, which maps its local +Y to world −Z.
    const x = groundPositions.getX(index);
    const z = -groundPositions.getY(index);
    let built = dhakaUrbanFabric(x, z).zoneInfluence;
    for (const district of groundDistricts) {
      built = Math.max(built, 1 - Math.hypot(x - district.x, z - district.y) / 1_800);
    }
    const fringe = 1 - smoothRange(built, 0, 0.3);
    groundTints[index * 3] = 1 + 0.04 * fringe;
    groundTints[index * 3 + 1] = 1 + 0.26 * fringe;
    groundTints[index * 3 + 2] = 1 - 0.14 * fringe;
  }
  groundGeometry.setAttribute("color", new THREE.BufferAttribute(groundTints, 3));
  const ground = new THREE.Mesh(
    groundGeometry,
    new THREE.MeshStandardMaterial({
      color: 0xeae4da,
      vertexColors: true,
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

  // Explicit Dhaka park lawns merged into two static draw calls (turf + paths)
  // so green space appears cleanly where real Dhaka parks sit.
  const parksGroup = new THREE.Group();
  parksGroup.name = "Dhaka urban parks";
  const parkTurfMaterial = new THREE.MeshStandardMaterial({
    color: 0x576d44,
    roughness: 1,
    polygonOffset: true,
    polygonOffsetFactor: 3,
    polygonOffsetUnits: 3,
  });
  const parkPathMaterial = new THREE.MeshStandardMaterial({
    color: 0xb7aa96,
    roughness: 0.96,
    polygonOffset: true,
    polygonOffsetFactor: 2,
    polygonOffsetUnits: 2,
  });
  const turfGeometries: THREE.BufferGeometry[] = [];
  const understoryGeometries: THREE.BufferGeometry[] = [];
  const pathGeometries: THREE.BufferGeometry[] = [];
  // Open campus grounds read as one sweep of lawn under their park rows.
  for (const ground of DHAKA_OPEN_GROUNDS) {
    const groundGeo = new THREE.PlaneGeometry(ground.maxX - ground.minX, ground.maxZ - ground.minZ);
    groundGeo.rotateX(-Math.PI / 2);
    groundGeo.translate((ground.minX + ground.maxX) / 2, 0.19, (ground.minZ + ground.maxZ) / 2);
    turfGeometries.push(groundGeo);
  }
  DHAKA_PARKS.forEach((park, index) => {
    const lawnGeo = new THREE.CircleGeometry(1, 28);
    lawnGeo.scale(park.rx, park.rz, 1);
    lawnGeo.rotateZ(-park.angle);
    lawnGeo.rotateX(-Math.PI / 2);
    lawnGeo.translate(park.x, 0.22 + (index % 5) * 0.006, park.z);
    (park.understory ? understoryGeometries : turfGeometries).push(lawnGeo);
    if (park.hasLoop) {
      const loopGeo = new THREE.RingGeometry(0.66, 0.71, 28);
      loopGeo.scale(park.rx, park.rz, 1);
      loopGeo.rotateZ(-park.angle);
      loopGeo.rotateX(-Math.PI / 2);
      loopGeo.translate(park.x, 0.28 + (index % 3) * 0.004, park.z);
      pathGeometries.push(loopGeo);
    }
  });
  const mergedTurf = mergeGeometries(turfGeometries, false);
  turfGeometries.forEach((geometry) => geometry.dispose());
  if (mergedTurf) {
    const turfMesh = new THREE.Mesh(mergedTurf, parkTurfMaterial);
    turfMesh.name = "Dhaka park turf";
    turfMesh.receiveShadow = true;
    turfMesh.matrixAutoUpdate = false;
    parksGroup.add(turfMesh);
  }
  const mergedUnderstory = understoryGeometries.length > 0 ? mergeGeometries(understoryGeometries, false) : null;
  understoryGeometries.forEach((geometry) => geometry.dispose());
  if (mergedUnderstory) {
    const understoryMaterial = parkTurfMaterial.clone();
    understoryMaterial.color.setHex(0x34492f);
    const understoryMesh = new THREE.Mesh(mergedUnderstory, understoryMaterial);
    understoryMesh.name = "Dhaka woodland understory";
    understoryMesh.receiveShadow = true;
    understoryMesh.matrixAutoUpdate = false;
    parksGroup.add(understoryMesh);
  }
  const mergedPaths = pathGeometries.length > 0 ? mergeGeometries(pathGeometries, false) : null;
  pathGeometries.forEach((geometry) => geometry.dispose());
  if (mergedPaths) {
    const pathMesh = new THREE.Mesh(mergedPaths, parkPathMaterial);
    pathMesh.name = "Dhaka park paths";
    pathMesh.receiveShadow = true;
    pathMesh.matrixAutoUpdate = false;
    parksGroup.add(pathMesh);
  }
  scene.add(parksGroup);

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
      color: 0x48665a,
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

  const roadMaterial = new THREE.MeshStandardMaterial({ color: 0x6b6b6a, roughness: 0.97 });
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

  const buildingColors = [0xd2ccc1, 0xc4beb4, 0x8a5a4a, 0xcbbfa8, 0xd9d3c8, 0x9a958c];
  const buildingMaterials = buildingColors.map((color) => new THREE.MeshStandardMaterial({ color, roughness: 0.88, metalness: 0.01 }));
  const facadeMaterials = buildingColors.map((color) => new THREE.MeshStandardMaterial({ color: new THREE.Color(color).multiplyScalar(0.84), roughness: 0.93 }));
  const rooftopMaterial = new THREE.MeshStandardMaterial({ color: 0x7c7770, roughness: 0.94 });
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
  const trunkMaterial = new THREE.MeshStandardMaterial({ color: 0x5d4739, roughness: 1 });
  const leafMaterials = [0x2d5a36, 0x3b6d3a, 0x4d7c3f, 0xc84628].map(
    (color) => new THREE.MeshStandardMaterial({ color, roughness: 0.86 }),
  );
  const trunkMatrices: THREE.Matrix4[] = [];
  const foliageMatrices: THREE.Matrix4[][] = [[], [], [], []];
  const treeQuaternion = new THREE.Quaternion();
  const treeScale = new THREE.Vector3();
  const addFallbackTree = (x: number, z: number, mature: boolean, flowering: boolean) => {
    const treeHeight = mature ? 0.85 + random() * 0.45 : 0.7 + random() * 0.35;
    treeScale.set(mature ? 0.9 : 0.78, treeHeight, mature ? 0.9 : 0.78);
    trunkMatrices.push(new THREE.Matrix4().compose(new THREE.Vector3(x, 3.75 * treeHeight, z), treeQuaternion, treeScale.clone()));
    for (let cluster = 0; cluster < 2; cluster++) {
      const foliageIndex = flowering ? 3 : Math.floor(random() * 3);
      const foliagePosition = new THREE.Vector3(
        x + (cluster - 0.5) * (2.4 + random() * 1.8),
        8.6 * treeHeight + (cluster === 1 ? 1.8 : 0),
        z + (random() - 0.5) * 2.6,
      );
      const foliageQuaternion = new THREE.Quaternion().setFromEuler(new THREE.Euler(random(), random(), random()));
      const radius = mature ? 4.2 + random() * 2.2 : 3.2 + random() * 1.7;
      const foliageScale = new THREE.Vector3(radius, radius * (0.68 + random() * 0.22), radius);
      foliageMatrices[foliageIndex].push(new THREE.Matrix4().compose(foliagePosition, foliageQuaternion, foliageScale));
    }
  };
  // Line both Hatirjheel embankments so the fallback view opens with lush lakeside greenery.
  for (let i = 0; i < 72; i++) {
    const x = -980 + (i / 71) * 1960 + (random() - 0.5) * 20;
    const lakeCenter = Math.sin(x * 0.0042) * 90 + Math.sin(x * 0.009) * 24;
    const side = i % 2 === 0 ? 1 : -1;
    const z = lakeCenter + side * (122 + random() * 44);
    if (Math.abs(Math.abs(z) - 285) < 28) continue;
    addFallbackTree(x, z, true, i % 11 === 0);
  }
  // Scatter additional courtyard trees between fallback blocks.
  for (let i = 0; i < 44; i++) {
    const x = (random() - 0.5) * 2100;
    const z = (random() - 0.5) * 1950;
    const lakeCenter = Math.sin(x * 0.0042) * 90;
    if (Math.abs(z - lakeCenter) < 125 || Math.abs(Math.abs(z) - 285) < 28) continue;
    addFallbackTree(x, z, false, false);
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
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.minFilter = THREE.LinearFilter;
    const draw = () => drawSignText(context, (scene.userData.labelLocale as Locale | undefined) ?? "en", landmark.label, 384, 29, "rgba(247, 222, 171, 0.92)", "rgba(196, 71, 85, 0.9)", "#243b35", texture);
    draw();
    const label = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, transparent: true, depthWrite: false, toneMapped: false }));
    label.position.copy(perches[index].position).add(new THREE.Vector3(0, 22, 0));
    label.scale.set(72, 15, 1);
    label.userData.redrawLabel = draw;
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
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.minFilter = THREE.LinearFilter;
    const draw = () => drawSignText(context, (scene.userData.labelLocale as Locale | undefined) ?? "en", landmark.label, 448, 27, "rgba(43, 139, 151, 0.9)", "rgba(255, 224, 135, 0.92)", "#fff0c4", texture);
    draw();
    const label = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, transparent: true, depthWrite: false, toneMapped: false }));
    label.userData.redrawLabel = draw;
    const world = coordinatesToWorld(landmark.lat, landmark.lon);
    label.position.set(world.x, 20, world.y);
    label.scale.set(86, 15, 1);
    waterLabels.add(label);
  }
  scene.add(waterLabels);
  const perchMaterial = new THREE.MeshStandardMaterial({ color: 0x4a5552, roughness: 0.72, metalness: 0.2 });
  const perchMarkers: THREE.Group[] = [];
  for (const [index, perch] of perches.entries()) {
    // Area perches hang in the sky and need a bar to stand on; landmark
    // perches sit on a built roof, dome or sculpture, so they keep only the
    // glowing ring (a 17 m bar would spear through a small monument).
    if (index < AREA_LANDMARKS.length) {
      const bar = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.42, 17, 12), perchMaterial);
      bar.position.copy(perch.position);
      bar.rotation.x = Math.PI / 2;
      bar.castShadow = true;
      scene.add(bar);
    }

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

  // Clouds float above the flight ceiling so the bird always sees them from
  // below. Seen from above, the flattened puffs read as white patches painted
  // on the ground that hide the buildings under them.
  const clouds: THREE.Group[] = [];
  const puffGeometry = new THREE.SphereGeometry(1, 18, 12);
  for (let i = 0; i < 14; i++) {
    const cloud = new THREE.Group();
    // One material per cloud so each can fade out on its own near the field edge.
    const cloudMaterial = new THREE.MeshStandardMaterial({ color: 0xe9e5d5, roughness: 1, transparent: true, opacity: 0.55, depthWrite: false });
    cloud.userData.weatherOpacity = cloudMaterial.opacity;
    for (let puff = 0; puff < 5; puff++) {
      const sphere = new THREE.Mesh(puffGeometry, cloudMaterial);
      sphere.position.set((puff - 2) * 36 + random() * 16, random() * 14, random() * 20);
      sphere.scale.set(38 + random() * 24, 14 + random() * 10, 22 + random() * 16);
      cloud.add(sphere);
    }
    cloud.position.set(
      (random() * 2 - 1) * CLOUD_FIELD_RADIUS,
      CLOUD_BASE_ALTITUDE + random() * CLOUD_LAYER_DEPTH,
      (random() * 2 - 1) * CLOUD_FIELD_RADIUS,
    );
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
  budget = 5_200,
) {
  const tileSize = 380;
  const perTile = 24;
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
  // Dhaka's water is not one clean teal. City lakes are dull algae green, the
  // Buriganga, Turag and Balu round the edge run grey-brown, and the hundreds
  // of small ponds are pale and murky. Tint each polygon by size and place
  // through vertex colours, so the merged batches stay one material.
  // (Kept darker and greyer than park turf, or a lake reads as a lawn.)
  const lakeTint = new THREE.Color(0x445e57);
  const riverTint = new THREE.Color(0x555a50);
  const pondTint = new THREE.Color(0x6c7a68);
  const waterTint = new THREE.Color();
  const cityCoreSouthWest = coordinatesToWorld(23.7150, 90.3500);
  const cityCoreNorthEast = coordinatesToWorld(23.8800, 90.4560);
  for (const feature of data.water) {
    const waterJitter = (Math.abs(feature.id) % 7) * 0.008;
    if (feature.area && feature.points.length >= 3) {
      const geometry = new THREE.ShapeGeometry(polygonShape(feature.points));
      geometry.rotateX(-Math.PI / 2);
      geometry.translate(0, 0.48 + waterJitter, 0);
      const area = polygonArea2D(feature.points);
      let centerX = 0;
      let centerZ = 0;
      for (const [x, z] of feature.points) {
        centerX += x;
        centerZ += z;
      }
      centerX /= feature.points.length;
      centerZ /= feature.points.length;
      const inCityCore = centerX > cityCoreSouthWest.x && centerX < cityCoreNorthEast.x
        && centerZ > cityCoreNorthEast.y && centerZ < cityCoreSouthWest.y;
      if (area >= 60_000 && !inCityCore) waterTint.copy(riverTint);
      else waterTint.copy(pondTint).lerp(lakeTint, smoothRange(area, 2_500, 30_000));
      waterTint.offsetHSL(0, 0, ((Math.abs(feature.id) % 5) - 2) * 0.012);
      const vertexCount = geometry.getAttribute("position").count;
      const tints = new Float32Array(vertexCount * 3);
      for (let index = 0; index < vertexCount; index++) waterTint.toArray(tints, index * 3);
      geometry.setAttribute("color", new THREE.BufferAttribute(tints, 3));
      waterAreas.push(geometry);
      continue;
    }
    const ribbonWidth = waterLineWidth(feature.points);
    if (ribbonWidth === 0) continue;
    for (let index = 1; index < feature.points.length; index++) {
      const [x1, z1] = feature.points[index - 1];
      const [x2, z2] = feature.points[index];
      const length = Math.hypot(x2 - x1, z2 - z1);
      if (length < 1) continue;
      // Top face only, staggered slightly per segment to avoid corner overlap z-fighting.
      const geometry = new THREE.PlaneGeometry(length, ribbonWidth);
      geometry.rotateX(-Math.PI / 2);
      geometry.rotateY(-Math.atan2(z2 - z1, x2 - x1));
      geometry.translate((x1 + x2) / 2, 0.64 + waterJitter + (index & 1) * 0.004, (z1 + z2) / 2);
      waterLines.push(geometry);
    }
    await yieldIfNeeded(isCancelled);
  }
  const waterAreaMaterial = new THREE.MeshPhysicalMaterial({
    color: 0xffffff,
    vertexColors: true,
    roughness: 0.22,
    metalness: 0.02,
    clearcoat: 0.7,
    clearcoatRoughness: 0.28,
    polygonOffset: true,
    polygonOffsetFactor: 0,
    polygonOffsetUnits: 0,
  });
  const waterLineMaterial = new THREE.MeshPhysicalMaterial({
    color: 0x566355,
    roughness: 0.22,
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
    const radius = (surfaceWidth + shoulder) / 2 + 0.5;
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
    const waterIsArea = feature.area && feature.points.length >= 3;
    const waterWidth = waterIsArea ? 8 : waterLineWidth(feature.points);
    const waterRadius = waterWidth === 3 ? 3 : 6;
    const waterEdgeCount = waterWidth === 0 ? 0 : waterIsArea ? feature.points.length : feature.points.length - 1;
    for (let index = 0; index < waterEdgeCount; index++) {
      const [x1, z1] = feature.points[index];
      const [x2, z2] = feature.points[(index + 1) % feature.points.length];
      addToClearanceGrid(waterClearanceGrid, { x1, z1, x2, z2, radius: waterRadius }, Math.min(x1, x2) - waterRadius, Math.max(x1, x2) + waterRadius, Math.min(z1, z2) - waterRadius, Math.max(z1, z2) + waterRadius);
    }
    await yieldIfNeeded(isCancelled);
  }
  const footprintBlockedByGround = (x: number, z: number, halfWidth: number, halfDepth: number) => {
    const key = clearanceKey(Math.floor(x / clearanceCellSize), Math.floor(z / clearanceCellSize));
    if ((waterAreaClearanceGrid.get(key) ?? []).some((points) => pointInPolygon(x, z, points))) return true;
    const reach = Math.min(Math.max(halfWidth, halfDepth), (halfWidth + halfDepth) * 0.62);
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

  const metroCorridor = createMetroCorridor(data.metroLines, data.metroStations);
  const buildingBuckets: THREE.BufferGeometry[][] = [[], [], [], [], []];
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
      || inDhakaPark(centerX, centerZ, -6)
      || landmarkColliders.some((collider) => (
        Math.abs(centerX - collider.x) < halfWidth + collider.halfWidth + 2
        && Math.abs(centerZ - collider.z) < halfDepth + collider.halfDepth + 2
      ))
      || footprintBlockedByGround(centerX, centerZ, halfWidth, halfDepth)
      || metroCorridor.blocksPolygon(building.points)
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
  // These five merged batches are the real Dhaka the player flies over, so they
  // carry the window lighting that makes the city legible after dark.
  const buildingMaterials = [0xd2ccc1, 0xc4beb4, 0xa39f97, 0xcbbfa8, 0x9a958c].map(
    (color) => applyNightWindows(new THREE.MeshStandardMaterial({ color, roughness: 0.88, metalness: 0.01 }), 0.54, true),
  );
  // Nearby procedural towers and landmarks provide local shadows. Keeping the
  // four citywide merged meshes out of the shadow pass avoids redrawing the
  // entire map into the large directional-light shadow camera every frame.
  for (let index = 0; index < buildingBuckets.length; index++) {
    await mergeIntoMeshBatches(root, buildingBuckets[index], buildingMaterials[index], `OSM buildings ${index}`, isCancelled);
  }

  // Static 1-draw-call horizon canopy across Dhaka's 20 parks and major lake
  // shorelines so green landmarks stay visibly wooded beyond the 2,250 m
  // procedural tile streaming radius.
  const horizonRng = seededRandom(51_409);
  const horizonMatrix = new THREE.Matrix4();
  const horizonPos = new THREE.Vector3();
  const horizonQuat = new THREE.Quaternion();
  const horizonScale = new THREE.Vector3();
  const horizonPalette = [0x1f4027, 0x254a2b, 0x2d532e, 0x375c33].map((color) => new THREE.Color(color));
  const horizonKrishnachura = new THREE.Color(0xc84628);
  const horizonTransforms: THREE.Matrix4[] = [];
  const horizonColors: THREE.Color[] = [];
  for (const park of DHAKA_PARKS) {
    const count = clamp(Math.round((Math.PI * park.rx * park.rz) / 1_150), 14, park.wooded ? 260 : 72);
    for (let i = 0; i < count; i++) {
      const radial = Math.sqrt(horizonRng()) * 0.94;
      const angle = horizonRng() * Math.PI * 2;
      const lx = Math.cos(angle) * radial * (park.rx - 5);
      const lz = Math.sin(angle) * radial * (park.rz - 5);
      const wx = park.x + lx * park.fwdCos - lz * park.fwdSin;
      const wz = park.z + lx * park.fwdSin + lz * park.fwdCos;
      const r = 4.8 + horizonRng() * 3.0;
      if (inAirportClearance(wx, wz, 20) || metroCorridor.blocksCircle(wx, wz, r + 2)) continue;
      if (landmarkColliders.some((c) => Math.abs(wx - c.x) < c.halfWidth + r + 2 && Math.abs(wz - c.z) < c.halfDepth + r + 2)) continue;
      if (footprintBlockedByGround(wx, wz, 2.5, 2.5)) continue;
      horizonPos.set(wx, 6.2 + horizonRng() * 2.5, wz);
      horizonQuat.setFromEuler(new THREE.Euler(horizonRng(), horizonRng(), horizonRng()));
      horizonScale.set(r, r * 0.65, r);
      horizonTransforms.push(horizonMatrix.compose(horizonPos, horizonQuat, horizonScale).clone());
      horizonColors.push(
        horizonRng() < 0.015
          ? horizonKrishnachura.clone()
          : horizonPalette[Math.floor(horizonRng() * horizonPalette.length)].clone(),
      );
    }
  }
  const inWaterAreaOsm = (x: number, z: number) => {
    const key = clearanceKey(Math.floor(x / clearanceCellSize), Math.floor(z / clearanceCellSize));
    return (waterAreaClearanceGrid.get(key) ?? []).some((points) => pointInPolygon(x, z, points));
  };
  let shoreHorizonCount = 0;
  for (const feature of data.water) {
    if (shoreHorizonCount >= 620) break;
    if (!feature.area || feature.points.length < 3 || polygonArea2D(feature.points) < 12_000) continue;
    for (let index = 0; index < feature.points.length && shoreHorizonCount < 620; index++) {
      const [x1, z1] = feature.points[index];
      const [x2, z2] = feature.points[(index + 1) % feature.points.length];
      const len = Math.hypot(x2 - x1, z2 - z1);
      if (len < 24) continue;
      const nx = -(z2 - z1) / len;
      const nz = (x2 - x1) / len;
      for (let dist = 16; dist < len - 12 && shoreHorizonCount < 620; dist += 92) {
        const t = dist / len;
        const mx = x1 + (x2 - x1) * t;
        const mz = z1 + (z2 - z1) * t;
        const posW = inWaterAreaOsm(mx + nx * 8, mz + nz * 8);
        const negW = inWaterAreaOsm(mx - nx * 8, mz - nz * 8);
        if (posW === negW) continue;
        const side = posW ? -1 : 1;
        const wx = mx + nx * side * 8;
        const wz = mz + nz * side * 8;
        if (inAirportClearance(wx, wz, 20) || metroCorridor.blocksCircle(wx, wz, 8)) continue;
        const r = 4.4 + horizonRng() * 2.6;
        horizonPos.set(wx, 5.8 + horizonRng() * 2.0, wz);
        horizonQuat.setFromEuler(new THREE.Euler(horizonRng(), horizonRng(), horizonRng()));
        horizonScale.set(r, r * 0.65, r);
        horizonTransforms.push(horizonMatrix.compose(horizonPos, horizonQuat, horizonScale).clone());
        horizonColors.push(
          horizonRng() < 0.012
            ? horizonKrishnachura.clone()
            : horizonPalette[Math.floor(horizonRng() * horizonPalette.length)].clone(),
        );
        shoreHorizonCount++;
      }
    }
  }
  if (horizonTransforms.length > 0) {
    const horizonMesh = new THREE.InstancedMesh(
      new THREE.IcosahedronGeometry(1, 0),
      new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.88 }),
      horizonTransforms.length,
    );
    horizonMesh.name = "OSM horizon Dhaka canopy";
    horizonTransforms.forEach((transform, index) => {
      horizonMesh.setMatrixAt(index, transform);
      horizonMesh.setColorAt(index, horizonColors[index]);
    });
    horizonMesh.instanceMatrix.needsUpdate = true;
    if (horizonMesh.instanceColor) horizonMesh.instanceColor.needsUpdate = true;
    horizonMesh.castShadow = false;
    horizonMesh.receiveShadow = true;
    horizonMesh.matrixAutoUpdate = false;
    root.add(horizonMesh);
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
  const dispose = () => {
    trafficSimulation?.dispose();
    root.traverse((object) => {
      if (object instanceof THREE.Mesh) {
        object.geometry.dispose();
        const material = object.material;
        if (Array.isArray(material)) material.forEach((entry) => entry.dispose());
        else material.dispose();
      }
    });
    scene.remove(root);
  };
  const reveal = () => {
    if (trafficSimulation) {
      const fallbackTraffic = scene.userData.trafficSimulation as TrafficSimulation | null | undefined;
      fallbackTraffic?.dispose();
      scene.userData.trafficSimulation = trafficSimulation;
    }
    // Atomically swap out the fallback layers and reveal the live OSM world so
    // roads, water, buildings, and collisions stay in sync on the same frame.
    if (data.roads.length > 0) {
      const roadFallback = scene.userData.proceduralRoadFallback as THREE.Group | undefined;
      if (roadFallback) roadFallback.visible = false;
    }
    const fallback = scene.userData.fallbackWorld as THREE.Group | undefined;
    if (fallback) fallback.visible = false;
    const immediateCityMass = scene.userData.immediateCityMass as THREE.Group | undefined;
    if (immediateCityMass) immediateCityMass.visible = false;
    root.visible = true;
  };
  return { colliders, reveal, dispose };
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

/** One bird choice: a species silhouette and name, expanding its full note when selected. */
function BirdOption({ bird, selected, name, note, onChoose }: { bird: Bird; selected: boolean; name: string; note: string; onChoose: () => void }) {
  return (
    <button type="button" className={`bird-opt${selected ? " selected" : ""}`} aria-pressed={selected} onClick={onChoose}>
      <span className="bird-opt-icon" aria-hidden="true">
        <BirdGlyph bird={bird} selected={selected} />
      </span>
      <span className="bird-opt-text">
        <b>{name}</b>
        <span className="bird-opt-note" aria-hidden={!selected}>
          <small>{note}</small>
        </span>
      </span>
      <HudIcon name="check" className="opt-check" />
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
    scene.background = new THREE.Color(0xc3ced6);
    scene.fog = new THREE.FogExp2(0xc5ccd2, 0.0005);
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
    // The Preetham dome ignores scene fog, so the hazed ground met it in a hard
    // line under a near-white noon sky. Blend the dome into the fog colour at
    // the horizon (at the stage standard materials apply fog) and wash the
    // rest of it part-way, so the sky reads as pale haze over the city.
    skyUniforms.bevHazeColor = { value: new THREE.Color(0xc5ccd2).convertLinearToSRGB() };
    skyUniforms.bevHazeAmount = { value: 0.5 };
    sky.material.fragmentShader = sky.material.fragmentShader
      .replace(
        "void main() {",
        `uniform vec3 bevHazeColor;
uniform float bevHazeAmount;
void main() {`,
      )
      .replace(
        "#include <colorspace_fragment>",
        `#include <colorspace_fragment>
  float bevHorizon = 1.0 - smoothstep( -0.01, 0.34, normalize( vWorldPosition - cameraPosition ).y );
  gl_FragColor.rgb = mix( gl_FragColor.rgb, bevHazeColor, clamp( bevHazeAmount + ( 1.0 - bevHazeAmount ) * bevHorizon * bevHorizon, 0.0, 1.0 ) );`,
      );
    scene.add(sky);

    const hemisphere = new THREE.HemisphereLight(0xf1efe9, 0x7a7064, 1.8);
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
    const skyFill = new THREE.DirectionalLight(0xb6c7d6, 0.48);
    skyFill.position.set(500, 260, -600);
    scene.add(skyFill);

    let disposed = false;
    const buildingColliders = addCity(scene);
    relabelRef.current = (nextLocale) => (scene.userData.relabel as ((locale: Locale) => void) | undefined)?.(nextLocale);
    relabelRef.current(localeRef.current);
    // Elevated-road decks are struck like buildings but kept out of the
    // building lists, which the map passes scan linearly for clearings.
    const elevatedRoadColliders = (scene.userData.elevatedRoadColliders as BuildingCollider[] | undefined) ?? [];
    let buildingColliderGrid = buildColliderGrid([...buildingColliders, ...elevatedRoadColliders]);
    const fallbackRoads = proceduralFallbackRoads();
    addImmediateCityMass(scene, fallbackRoads);
    const immediateRoadFallback = new THREE.Group();
    immediateRoadFallback.name = "Immediate Greater Dhaka road network";
    scene.add(immediateRoadFallback);
    scene.userData.proceduralRoadFallback = immediateRoadFallback;
    void addRoadNetworkMeshes(immediateRoadFallback, fallbackRoads, "Immediate fallback", () => disposed, scene);
    const mapRequestStartedAt = performance.now();
    // The bundled snapshot first: it is a static file, so the real city appears
    // as soon as it is built instead of waiting on Overpass, which the worker
    // can stall on for tens of seconds. The live route is only the fallback
    // if the snapshot is missing, before the sparse procedural grid.
    const fetchMapData = async (): Promise<OsmMapData> => {
      try {
        const snapshot = await fetch("/dhaka-map.json", { signal: AbortSignal.timeout(20_000) });
        if (!snapshot.ok) throw new Error(`Map snapshot failed with ${snapshot.status}`);
        return await snapshot.json() as OsmMapData;
      } catch (snapshotError) {
        const response = await fetch("/api/osm", { signal: AbortSignal.timeout(35_000) });
        if (!response.ok) throw snapshotError;
        return await response.json() as OsmMapData;
      }
    };
    let pendingOsmWorld: Awaited<ReturnType<typeof addOpenStreetMapWorld>> = null;
    let pendingProceduralTiles: Awaited<ReturnType<typeof addProceduralDistrictTiles>> | null = null;
    void fetchMapData()
      .then(async (data) => {
        if (disposed) return;
        const mapBuildStartedAt = performance.now();
        const osmWorld = await addOpenStreetMapWorld(scene, data, () => disposed);
        if (!osmWorld) throw new Error("OpenStreetMap response contained no usable buildings");
        pendingOsmWorld = osmWorld;
        const landmarkColliders = scene.userData.landmarkColliders as BuildingCollider[] | undefined ?? [];
        const proceduralTiles = await addProceduralDistrictTiles(
          scene,
          data,
          [...osmWorld.colliders, ...landmarkColliders],
          crow.position,
          () => disposed,
        );
        pendingProceduralTiles = proceduralTiles;
        const nextColliders: BuildingCollider[] = [];
        for (const group of [osmWorld.colliders, proceduralTiles.colliders, landmarkColliders]) {
          for (const collider of group) nextColliders.push(collider);
        }
        const nextColliderGrid = await buildColliderGridAsync([...nextColliders, ...elevatedRoadColliders], () => disposed);
        if (disposed) {
          proceduralTiles.dispose();
          osmWorld.dispose();
          pendingProceduralTiles = null;
          pendingOsmWorld = null;
          return;
        }
        // Install the collision grid and switch the visible world in the same
        // synchronous turn so a flying bird never hits hidden buildings or flies
        // through newly revealed ones.
        buildingColliders.length = 0;
        for (const collider of nextColliders) buildingColliders.push(collider);
        buildingColliderGrid = nextColliderGrid;
        osmWorld.reveal();
        proceduralTiles.reveal(crow.position);
        pendingOsmWorld = null;
        pendingProceduralTiles = null;
        const rebuildMetro = scene.userData.rebuildMetro as
          | ((lines: MapPoint[][], stations: NonNullable<OsmMapData["metroStations"]>) => void)
          | undefined;
        if (rebuildMetro && data.metroLines?.length) rebuildMetro(data.metroLines, data.metroStations ?? []);
        (scene.userData.placeElevatedRoadPiers as ((water: OsmMapData["water"], roads: OsmMapData["roads"]) => void) | undefined)?.(data.water, data.roads);
        renderer.domElement.dataset.mapRequestMs = (performance.now() - mapRequestStartedAt).toFixed(1);
        renderer.domElement.dataset.mapBuildMs = (performance.now() - mapBuildStartedAt).toFixed(1);
        // New geometry needs one shadow pass now that the map is no longer redrawn
        // into the shadow camera on every frame.
        requestShadowUpdate();
        setMapStatus("live");
      })
      .catch(async (error: unknown) => {
        pendingProceduralTiles?.dispose();
        pendingProceduralTiles = null;
        pendingOsmWorld?.dispose();
        pendingOsmWorld = null;
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
          const proceduralTiles = await addProceduralDistrictTiles(
            scene,
            emptyMap,
            buildingColliders,
            crow.position,
            () => disposed,
          );
          pendingProceduralTiles = proceduralTiles;
          const nextColliders = [...buildingColliders];
          for (const collider of proceduralTiles.colliders) nextColliders.push(collider);
          const nextColliderGrid = await buildColliderGridAsync([...nextColliders, ...elevatedRoadColliders], () => disposed);
          if (disposed) {
            proceduralTiles.dispose();
            pendingProceduralTiles = null;
            return;
          }
          buildingColliders.length = 0;
          for (const collider of nextColliders) buildingColliders.push(collider);
          buildingColliderGrid = nextColliderGrid;
          proceduralTiles.reveal(crow.position);
          pendingProceduralTiles = null;
        }
        requestShadowUpdate();
        setMapStatus("fallback");
      })
      .catch(() => {
        pendingProceduralTiles?.dispose();
        pendingProceduralTiles = null;
        pendingOsmWorld?.dispose();
        pendingOsmWorld = null;
        if (!disposed) setMapStatus("fallback");
      });

    const crow = new THREE.Group();
    crow.name = "PlayerCrow";
    const spawnParams = new URLSearchParams(window.location.search);
    const spawnLat = Number(spawnParams.get("lat")) || 23.7595;
    const spawnLon = Number(spawnParams.get("lon")) || 90.4105;
    // Clamped so a shared link can't start the bird above the ceiling, inside the clouds.
    const spawnAlt = clamp(Number(spawnParams.get("alt")) || DEFAULT_FLIGHT_ALTITUDE, MIN_FLIGHT_ALTITUDE, MAX_FLIGHT_ALTITUDE);
    const spawnWorld = coordinatesToWorld(spawnLat, spawnLon);
    crow.position.set(spawnWorld.x, spawnAlt, spawnWorld.y);
    scene.add(crow);
    const airflowVfx = createAirflowVfx(scene, crow);
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
    type WingChain = {
      shoulder: THREE.Object3D;
      forearm: THREE.Object3D;
      hand: THREE.Object3D;
      tipAnchor: THREE.Object3D;
    };
    type BirdRigJoints = {
      body: THREE.Object3D | null;
      neck: THREE.Object3D | null;
      head: THREE.Object3D | null;
      tail: THREE.Object3D | null;
      wingL: WingChain | null;
      wingR: WingChain | null;
    };
    const emptyRigJoints = (): BirdRigJoints => ({
      body: null,
      neck: null,
      head: null,
      tail: null,
      wingL: null,
      wingR: null,
    });
    const buildWingChain = (model: THREE.Object3D, suffix: "L" | "R", side: -1 | 1): WingChain | null => {
      const shoulder = model.getObjectByName(`WingJoint.${suffix}`);
      const forearm = model.getObjectByName(`ForearmJoint.${suffix}`);
      const hand = model.getObjectByName(`HandJoint.${suffix}`);
      if (!shoulder || !forearm || !hand) return null;
      // Find the outermost primary feather tip in HandJoint space so wingtip
      // trails sit right on each species' actual wingtip regardless of span.
      let bestExtent = -Infinity;
      const tipPos = new THREE.Vector3(side * 2.6, -0.06, 0.7);
      for (const child of hand.children) {
        if (!(child instanceof THREE.Mesh)) continue;
        const pos = child.geometry.getAttribute("position");
        if (!pos) continue;
        for (let i = 0; i < pos.count; i++) {
          const vx = pos.getX(i);
          const extent = vx * side;
          if (extent > bestExtent) {
            bestExtent = extent;
            tipPos.set(vx, pos.getY(i), pos.getZ(i));
          }
        }
      }
      const tipAnchor = new THREE.Object3D();
      tipAnchor.position.copy(tipPos);
      hand.add(tipAnchor);
      return { shoulder, forearm, hand, tipAnchor };
    };
    let birdModel: THREE.Object3D | null = null;
    let rigJoints: BirdRigJoints = emptyRigJoints();
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
          rigJoints = emptyRigJoints();
          airflowVfx.setWingtips(null, null);
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
        rigJoints = {
          body: model.getObjectByName("BodyJoint") ?? null,
          neck: model.getObjectByName("NeckJoint") ?? null,
          head: model.getObjectByName("HeadJoint") ?? null,
          tail: model.getObjectByName("TailJoint") ?? null,
          wingL: buildWingChain(model, "L", -1),
          wingR: buildWingChain(model, "R", 1),
        };
        airflowVfx.setWingtips(rigJoints.wingL?.tipAnchor ?? null, rigJoints.wingR?.tipAnchor ?? null);
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
        visibleTiles: (scene.userData.proceduralDistrictTiles as ProceduralDistrictTile[] | undefined)?.filter((tile) => tile.detail === 2).length ?? 0,
        farTiles: (scene.userData.proceduralDistrictTiles as ProceduralDistrictTile[] | undefined)?.filter((tile) => tile.detail === 1).length ?? 0,
        maxFrameMs,
        longFrames,
        mapBuildMs: Number.parseFloat(renderer.domElement.dataset.mapBuildMs ?? "") || null,
        landmarkModules: (scene.userData.landmarkModuleStats as Record<string, LandmarkModuleStats> | undefined) ?? {},
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
    let previousVerticalSpeed = 0;
    let swoopMomentum = 0;
    let divePose = 0;
    let climbPose = 0;
    let flarePose = 0;
    let bankPose = 0;
    let smoothedFlapRate = 0.85;
    let strokeLiftSignal = 0;
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
    const cameraForward = new THREE.Vector3();
    const velocityVec = new THREE.Vector3();
    const horizontalForward = new THREE.Vector3();
    const previousPosition = new THREE.Vector3();
    const cameraOffset = new THREE.Vector3();
    const windDrift = new THREE.Vector3();
    const targetQuat = new THREE.Quaternion();
    const euler = new THREE.Euler(0, 0, 0, "YXZ");
    const postureQuat = new THREE.Quaternion();
    const postureEuler = new THREE.Euler(0, 0, 0, "YXZ");
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
      const landmarkModule = LANDMARK_MODULE_BY_KIND.get(kind);
      inspectionCameraOffset = landmarkModule
        ? landmarkModule.inspectDistance ?? Math.max(105, landmark.altitude * 1.45, Math.max(...landmarkModule.extents) * 2.4)
        : kind === "airport"
        ? 900 // the runway and both terminals span 1.3 × 3.2 km
        : kind === "tejgaon-airport" ? 700
        : kind === "sayedabad-bus-terminal" || kind === "gabtoli-bus-terminal" ? 230
        : ["parliament", "lalbagh-fort", "ahsan-manzil", "zia-udyan", "dhaka-medical", "kamalapur-station", "military-museum", "bcfcc", "supreme-court", "sadarghat-terminal", "rayer-bazar-memorial", "shishu-park", "baldha-garden", "science-museum", "air-force-museum", "sonargaon-hotel", "pm-office"].includes(kind) ? 190
          : kind === "jamuna-future-park" || kind === "national-zoo" || kind === "army-stadium" || kind === "national-stadium" || kind === "botanical-garden" ? 260
          : kind === "kuril-flyover" ? 560
          : kind === "hatirjheel-bridge" || kind === "gulshan-central-mosque" ? 170
          : kind === "sher-e-bangla-stadium" ? 300 : Math.max(105, landmark.altitude * 1.45);
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
      previousVerticalSpeed = 0;
      swoopMomentum = 0;
      divePose = 0;
      climbPose = 0;
      flarePose = 0;
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
        previousVerticalSpeed = 0;
        swoopMomentum = 0;
        divePose = 0;
        climbPose = 0;
        flarePose = 0;
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
      const floorSinkScale = THREE.MathUtils.smoothstep(
        crow.position.y - MIN_FLIGHT_ALTITUDE,
        0,
        FLOOR_EASE_DEPTH,
      );
      const effectiveClimb = climb > 0 ? climb * ceilingClimbScale : climb;
      // Keyboard climb is always ±1, so scaling by magnitude leaves key flight
      // untouched while giving the touch stick a genuinely proportional climb.
      const climbAmount = Math.abs(climb);
      // Diving stores kinetic energy that lingers after pull-out so swooping low
      // over a river or converting a dive into a zoom-climb feels buoyant and real.
      if (!active || braking) {
        swoopMomentum = Math.max(0, swoopMomentum - 14 * dt);
      } else if (verticalSpeed < -2) {
        const diveFeed = clamp((-verticalSpeed - 2) / 20, 0, 1);
        swoopMomentum = Math.min(18, swoopMomentum + diveFeed * 16 * dt);
      } else if (verticalSpeed > 1) {
        swoopMomentum = Math.max(0, swoopMomentum - (4.2 + verticalSpeed * 0.28) * dt);
      } else {
        swoopMomentum = Math.max(0, swoopMomentum - 3.6 * dt);
      }
      const zoomClimbBonus = swoopMomentum * 0.22;
      const climbBeatPulse = climb > 0 ? strokeLiftSignal * 1.35 * climbAmount * ceilingClimbScale : 0;
      const targetVerticalSpeed = !active
        ? (restingRef.current ? 0 : verticalSpeed)
        : guidedSink !== null
          ? guidedSink
          : climb > 0
            ? altitudeHeadroom <= 1
              ? 0
              : Math.max(
                  MIN_CEILING_CLIMB_SPEED,
                  (15.5 + speedAmountBeforeThrottle * 8 + zoomClimbBonus) * ceilingClimbScale * climbAmount + climbBeatPulse,
                )
            : climb < 0
              ? -22.5 * climbAmount * floorSinkScale
              : -0.45 * floorSinkScale;
      const pullingOutOfDive = climb > 0 && verticalSpeed < -1;
      const verticalResponse = guidedSink !== null
        ? 3.1
        : pullingOutOfDive
          ? 3.6
          : climb < 0 && floorSinkScale < 1
            ? THREE.MathUtils.lerp(4.6, 2.05, floorSinkScale)
            : climb === 0
              ? 2.1
              : climb > 0 && ceilingClimbScale < 1
                ? THREE.MathUtils.lerp(4.6, 2.35, ceilingClimbScale)
                : climb < 0
                  ? 1.95
                  : 2.4;
      verticalSpeed = THREE.MathUtils.lerp(verticalSpeed, targetVerticalSpeed, 1 - Math.exp(-verticalResponse * dt));
      const verticalAccel = dt > 1e-4 ? (verticalSpeed - previousVerticalSpeed) / dt : 0;
      previousVerticalSpeed = verticalSpeed;

      const trajectoryPitch = Math.atan2(verticalSpeed, Math.max(speed, 1));
      // Angle-of-attack leads trajectory: the bird tips its beak into a climb or
      // stoop first, then lift and gravity bend the flight path behind it.
      const pitchLead = effectiveClimb >= 0 ? effectiveClimb * 0.21 : effectiveClimb * 0.27;
      const brakeFlarePitch = braking ? 0.16 : 0;
      const targetPitch = restingRef.current
        ? 0
        : clamp(
            trajectoryPitch * 0.92 + pitchLead + flapKick * 0.14 + brakeFlarePitch + strokeLiftSignal * 0.024,
            -0.66,
            0.56,
          );
      pitch = THREE.MathUtils.lerp(pitch, targetPitch, 1 - Math.pow(0.84, dt * 60));
      const targetRoll = turn * 0.48;
      roll = THREE.MathUtils.lerp(roll, targetRoll, 1 - Math.pow(0.8, dt * 60));
      const diveEnergy = Math.max(clamp(-verticalSpeed * 0.72, 0, 16), swoopMomentum);
      const climbCost = clamp(verticalSpeed * 0.34, 0, 8.5);
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
      forward.set(horizontalForward.x, clamp(verticalSpeed / Math.max(speed, 1), -0.62, 0.58), horizontalForward.z).normalize();
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
      const floorAltitude = landingCommit
        ? Math.min(MIN_FLIGHT_ALTITUDE, Math.max(2.5, landingCommit.position.y - 0.5))
        : MIN_FLIGHT_ALTITUDE;
      crow.position.y = Math.max(crow.position.y, floorAltitude);
      if (crow.position.y >= MAX_FLIGHT_ALTITUDE || (climb > 0 && crow.position.y >= MAX_FLIGHT_ALTITUDE - 1)) {
        crow.position.y = MAX_FLIGHT_ALTITUDE;
        verticalSpeed = Math.min(verticalSpeed, 0);
      }
      if (crow.position.y <= floorAltitude) {
        // Hold the floor without a bounce. The old +7 m/s kick here fought a
        // held dive every few frames, and the chase camera shook with it.
        crow.position.y = floorAltitude;
        verticalSpeed = Math.max(verticalSpeed, 0);
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

      // Bird models face -Z with +Y up, so a positive X rotation pitches the beak
      // skyward (+Y) on climbs and a negative X rotation points it into dives.
      euler.set(pitch, yaw, roll);
      targetQuat.setFromEuler(euler);
      crow.quaternion.slerp(targetQuat, 1 - Math.pow(0.8, dt * 60));
      if (!pausedRef.current && mixer && flapAction && glideAction && restAction) {
        const desiredRestWeight = restingRef.current ? 0.96 : 0;
        const restWeight = THREE.MathUtils.lerp(restAction.getEffectiveWeight(), desiredRestWeight, 1 - Math.pow(0.78, dt * 60));
        restAction.setEffectiveWeight(restWeight);
        restAction.timeScale = 0.55;

        // Climbing takes sustained, energetic wingbeats; diving shuts flapping off
        // and tucks the wings into a streamlined stoop unless the player flaps out.
        const climbIntent = active ? Math.max(0, effectiveClimb) : 0;
        const climbVelFactor = active ? clamp((verticalSpeed - 1.2) / 16, 0, 1) : 0;
        const diveIntent = active ? Math.max(0, -climb) : 0;
        const diveVelFactor = active ? clamp((-verticalSpeed - 1.5) / 18, 0, 1) : 0;
        const climbFlap = clamp(climbIntent * 0.88 + climbVelFactor * 0.34, 0, 0.96);
        const diveSuppression = clamp(diveIntent * 0.92 + diveVelFactor * 0.88, 0, 1);
        const brakeFlap = active && braking && speed > BRAKE_SPEED + 3 ? 0.42 : 0;
        const cruiseFlap = birdTraits.cruiseFlap * (1 - diveSuppression) + (boost && diveSuppression < 0.4 ? 0.3 * (1 - diveSuppression) : 0);
        const desiredFlapWeight = active
          ? (flapKick > 0 ? 0.98 : clamp(Math.max(climbFlap, cruiseFlap, brakeFlap), 0, 0.98))
          : 0;
        const flapWeight = THREE.MathUtils.lerp(flapAction.getEffectiveWeight(), desiredFlapWeight, 1 - Math.pow(0.78, dt * 60));
        flapAction.setEffectiveWeight(flapWeight);
        const targetFlapRate = (0.78 + climbFlap * 1.05 + flapKick * 0.85 + (boost ? 0.32 : 0)) * birdTraits.flapRate;
        smoothedFlapRate = THREE.MathUtils.lerp(smoothedFlapRate, targetFlapRate, 1 - Math.exp(-8.5 * dt));
        flapAction.timeScale = smoothedFlapRate;

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
        if (crossedDownstroke && flapWeight > 0.05 && restWeight < 0.5) flightAudio.wingbeat(0.35 + flapWeight * 0.65);

        // Layer flight biomechanics over the freshly evaluated clip pose: swept
        // M-wing stoop and furled tail in dives, cupped wings and fanned tail on
        // flares/pull-outs, and visible downstroke body heave while climbing.
        const pullOut = active && verticalSpeed < -1 && verticalAccel > 3
          ? clamp((-verticalSpeed / 14) * ((verticalAccel - 3) / 18), 0, 1)
          : 0;
        const targetDivePose = active && !braking
          ? clamp((diveIntent * 0.55 + diveVelFactor * 0.78) * (1 - flapKick * 0.85), 0, 1)
          : 0;
        const targetClimbPose = active ? clamp(climbIntent * 0.65 + climbVelFactor * 0.65 + flapKick * 0.45, 0, 1) : 0;
        const targetFlarePose = active ? clamp((braking ? 0.9 : 0) + approachBlend * 0.62 + pullOut * 0.88, 0, 1) : 0;
        const targetBankPose = active ? clamp(turn, -1, 1) : 0;

        divePose = THREE.MathUtils.lerp(divePose, targetDivePose, 1 - Math.exp(-6.5 * dt));
        climbPose = THREE.MathUtils.lerp(climbPose, targetClimbPose, 1 - Math.exp(-6 * dt));
        flarePose = THREE.MathUtils.lerp(flarePose, targetFlarePose, 1 - Math.exp(-7.5 * dt));
        bankPose = THREE.MathUtils.lerp(bankPose, targetBankPose, 1 - Math.exp(-6.5 * dt));

        const inFlight = clamp(1 - restWeight * 1.2, 0, 1);
        const strokeWave = Math.sin((flapPhase - 0.3) * Math.PI * 2);
        strokeLiftSignal = strokeWave * flapWeight * inFlight;

        if (rigJoints.body) {
          const heave = (0.09 + climbPose * 0.16 + flapKick * 0.1) * flapWeight * inFlight;
          rigJoints.body.position.y += strokeWave * heave;
          postureEuler.set(strokeWave * 0.038 * flapWeight * (0.4 + climbPose * 0.6) * inFlight, 0, 0, "YXZ");
          rigJoints.body.quaternion.multiply(postureQuat.setFromEuler(postureEuler));
        }

        const d = divePose * inFlight;
        const f = flarePose * (1 - divePose * 0.5) * inFlight;
        const c = climbPose * inFlight;
        for (const [wing, side] of [[rigJoints.wingL, -1], [rigJoints.wingR, 1]] as const) {
          if (!wing) continue;
          const bankTrim = bankPose * side * inFlight;
          postureEuler.set(
            -0.1 * d + 0.16 * f + 0.06 * c,
            -side * (0.28 * d - 0.08 * f - 0.04 * c),
            side * (-0.18 * d + 0.14 * f + 0.05 * c),
            "YXZ",
          );
          wing.shoulder.quaternion.multiply(postureQuat.setFromEuler(postureEuler));
          wing.shoulder.scale.x *= 1 - 0.16 * d + 0.04 * f;
          wing.shoulder.scale.z *= 1 + 0.06 * d;

          postureEuler.set(0.06 * f, -side * (-0.14 * d), side * (-0.06 * d + 0.06 * f), "YXZ");
          wing.forearm.quaternion.multiply(postureQuat.setFromEuler(postureEuler));

          postureEuler.set(
            -0.08 * d + 0.12 * f,
            -side * (0.52 * d - 0.1 * f - bankTrim * 0.06),
            side * (-0.12 * d + 0.08 * f),
            "YXZ",
          );
          wing.hand.quaternion.multiply(postureQuat.setFromEuler(postureEuler));
        }

        if (rigJoints.tail) {
          rigJoints.tail.scale.set(clamp(1 - 0.28 * d + 0.3 * f + 0.16 * c, 0.68, 1.36), 1, 1);
          postureEuler.set(
            0.24 * f + 0.1 * c - 0.06 * d - strokeWave * 0.05 * flapWeight * inFlight,
            -bankPose * 0.08 * inFlight,
            -bankPose * 0.2 * inFlight,
            "YXZ",
          );
          rigJoints.tail.quaternion.multiply(postureQuat.setFromEuler(postureEuler));
        }
        if (rigJoints.neck) {
          postureEuler.set(0.05 * c - 0.06 * d + 0.04 * f, 0, 0, "YXZ");
          rigJoints.neck.quaternion.multiply(postureQuat.setFromEuler(postureEuler));
        }
        if (rigJoints.head) {
          postureEuler.set(
            0.1 * c - 0.1 * d + 0.1 * f,
            bankPose * 0.18 * inFlight,
            -bankPose * 0.12 * inFlight,
            "YXZ",
          );
          rigJoints.head.quaternion.multiply(postureQuat.setFromEuler(postureEuler));
        }
      } else {
        strokeLiftSignal = 0;
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
        trafficSimulation?.follow(crow.position);
        trafficSimulation?.update(dt, frameMs);
        for (const cloud of scene.userData.clouds as THREE.Group[]) {
          cloud.position.x += (cloud.userData.weatherSpeed ?? cloud.userData.speed) * dt;
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
        // High up, a level chase camera sees mostly sky with the bird as a dark
        // silhouette against it. With altitude, rise above the bird and tilt down
        // so the city fills the frame below its back. During climbs and dives,
        // follow only part of the flight-path slope so the bird visibly pitches
        // up or down relative to the view while keeping the receding or rushing
        // rooftops in frame for vertical depth perception.
        const highAmount = THREE.MathUtils.smoothstep(crow.position.y, 60, 300);
        const climbSlope = clamp(verticalSpeed / Math.max(speed, 1), -0.62, 0.58);
        const cameraSlope = climbSlope >= 0 ? climbSlope * 0.36 : climbSlope * 0.58;
        cameraForward.set(horizontalForward.x, cameraSlope, horizontalForward.z).normalize();
        const divePullback = Math.max(0, -verticalSpeed) * 0.18;
        const chaseDistance = 14.5 + speedAmount * 9 + highAmount * 8 + divePullback;
        desiredCamera.copy(crow.position).addScaledVector(cameraForward, -chaseDistance);
        const climbFrameDrop = Math.max(0, verticalSpeed) * 0.14;
        const diveFrameLift = Math.max(0, -verticalSpeed) * (0.12 - highAmount * 0.05);
        desiredCamera.y += 6.4 + highAmount * 10 - climbFrameDrop + diveFrameLift - cameraKick * 1.5;
        const lookAhead = 13 + speedAmount * 10 - highAmount * 3;
        desiredTarget.copy(crow.position).addScaledVector(cameraForward, lookAhead);
        const verticalTargetOffset = verticalSpeed >= 0 ? -verticalSpeed * 0.08 : verticalSpeed * 0.05;
        desiredTarget.y += 1.4 - highAmount * 2.5 + verticalTargetOffset;
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
        const diveShake = clamp((-verticalSpeed - 12) / 14, 0, 1) * 0.08;
        const shakeAmount = (boost ? 0.16 * speedAmount : Math.max(0, speedAmount - 0.78) * 0.12) + diveShake;
        desiredCamera.x += Math.sin(elapsedTime * 43) * shakeAmount;
        desiredCamera.y += Math.sin(elapsedTime * 57 + 1.2) * shakeAmount * 0.65;
      }
      const camPosAlpha = 1 - Math.pow(0.78, dt * 60);
      const camVerticalAlpha = flyingRef.current && cameraModeRef.current === "CHASE" && !inspectionTarget
        ? 1 - Math.pow(0.84, dt * 60)
        : camPosAlpha;
      camera.position.x = THREE.MathUtils.lerp(camera.position.x, desiredCamera.x, camPosAlpha);
      camera.position.y = THREE.MathUtils.lerp(camera.position.y, desiredCamera.y, camVerticalAlpha);
      camera.position.z = THREE.MathUtils.lerp(camera.position.z, desiredCamera.z, camPosAlpha);
      cameraTarget.lerp(desiredTarget, 1 - Math.pow(0.75, dt * 60));
      camera.lookAt(cameraTarget);
      // Keep every cloud within the field around this frame's camera, even while
      // paused or after a jump to a far landmark, and fade it out over the outer
      // edge so wrapping to the far side never pops.
      const cloudFieldSpan = CLOUD_FIELD_RADIUS * 2;
      for (const cloud of scene.userData.clouds as THREE.Group[]) {
        cloud.position.x = camera.position.x - CLOUD_FIELD_RADIUS
          + THREE.MathUtils.euclideanModulo(cloud.position.x - camera.position.x + CLOUD_FIELD_RADIUS, cloudFieldSpan);
        cloud.position.z = camera.position.z - CLOUD_FIELD_RADIUS
          + THREE.MathUtils.euclideanModulo(cloud.position.z - camera.position.z + CLOUD_FIELD_RADIUS, cloudFieldSpan);
        const edgeDistance = Math.max(Math.abs(cloud.position.x - camera.position.x), Math.abs(cloud.position.z - camera.position.z));
        const edgeFade = 1 - THREE.MathUtils.smoothstep(edgeDistance, CLOUD_FIELD_RADIUS - CLOUD_EDGE_FADE, CLOUD_FIELD_RADIUS);
        const material = (cloud.children[0] as THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardMaterial>).material;
        material.opacity = (cloud.userData.weatherOpacity ?? 0.55) * edgeFade;
      }
      const diveFovRush = clamp(-verticalSpeed / 22, 0, 1) * 5;
      const climbFovTighten = clamp(verticalSpeed / 20, 0, 1) * 1.5;
      const targetFov = reducedMotion ? 58 : 52 + speedAmount * 13 + (boost ? 5 : 0) + diveFovRush - climbFovTighten;
      const nextFov = THREE.MathUtils.lerp(camera.fov, targetFov, 1 - Math.exp(-3.4 * dt));
      if (Math.abs(nextFov - camera.fov) > 0.01) {
        camera.fov = nextFov;
        camera.updateProjectionMatrix();
      }
      velocityVec.set(horizontalForward.x * speed, verticalSpeed, horizontalForward.z * speed);
      // Refresh world matrices on the posed bird so wingtip ribbons start flush
      // on the feather tips rather than one frame behind.
      crow.updateMatrixWorld(true);
      airflowVfx.update(dt, velocityVec, camera.position, speedAmount, verticalSpeed, boost, active, reducedMotion);
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
          const visibilityAnchor = inspectionTarget ?? crow.position;
          let visibilityChanged = false;
          for (const tile of districtTiles) {
            const detail = proceduralTileDetailAt(tile, visibilityAnchor.x, visibilityAnchor.z, tileVisibilityRadius);
            if (tile.detail !== detail) {
              setProceduralTileDetail(scene, tile, detail);
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
  // Each bird has its own painting. Fetch the set for this sky up front so
  // picking a bird swaps the art at once, and keep showing the last painting
  // until the new one has decoded so a slow load never blinks.
  const [skyBird, setSkyBird] = useState<BirdId>(birdId);
  useEffect(() => {
    if (flying) return;
    const phone = titleArt === "dawn" && window.matchMedia("(max-width: 700px) and (orientation: portrait)").matches;
    const art = phone ? "sky-dawn-phone" : `sky-${titleArt}`;
    const url = (id: BirdId) => (id === DEFAULT_BIRD ? `/title/${art}.jpg` : `/title/${art}-${id}.jpg`);
    for (const bird of BIRDS) new Image().src = url(bird.id);
    let current = true;
    const next = new Image();
    next.src = url(birdId);
    next.decode().catch(() => {}).then(() => {
      if (current) setSkyBird(birdId);
    });
    return () => {
      current = false;
    };
  }, [flying, titleArt, birdId]);
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
          <div className="title-sky" data-art={titleArt} data-bird={skyBird} aria-hidden="true" />
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
                <><BirdGlyph bird={selectedBird} className="tile-bird-glyph" />{t[selectedBird.name]}</>,
                STRINGS[otherLocale][selectedBird.name],
                BIRDS.map((bird) => (
                  <BirdOption key={bird.id} bird={bird} selected={bird.id === birdId} name={t[bird.name]} note={t[bird.note]} onChoose={() => {
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
                      onClick={() => {
                        if (focusLandmarkRef.current(landmark.kind)) setInspecting(true);
                      }}
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
