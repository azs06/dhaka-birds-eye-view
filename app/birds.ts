// The birds a player can fly as. Each is a model built by
// scripts/create-birds.mjs on one shared skeleton, so they differ here only in
// size and in how busily they flap; the flight physics is the same for all.

import type { Strings } from "./i18n";

export type BirdId = "crow" | "doel" | "shalik" | "chil" | "tiya" | "machhranga";

export type Bird = {
  id: BirdId;
  model: string;
  name: keyof Strings;
  note: keyof Strings;
  // Body, accent and bill colours, shown as a swatch beside the name.
  swatch: [string, string, string];
  // Real sizes run from a 19 cm robin to a 60 cm kite. They are compressed
  // here so the smallest is still readable from the chase camera.
  scale: number;
  // How far to shift the perched model so its feet, not the crow's, meet the roof.
  restLift: number;
  // Wingbeat speed relative to the crow, and how much of the cruise is flapping
  // rather than gliding: a kite soars, a parakeet never stops beating.
  flapRate: number;
  cruiseFlap: number;
};

export const BIRDS: Bird[] = [
  { id: "crow", model: "/models/dhaka-house-crow.glb", name: "birdCrow", note: "birdCrowNote", swatch: ["#1d232b", "#82827d", "#14171a"], scale: 0.92, restLift: 0, flapRate: 1, cruiseFlap: 0.16 },
  { id: "doel", model: "/models/bird-doel.glb", name: "birdDoel", note: "birdDoelNote", swatch: ["#1c2333", "#eeece4", "#15171b"], scale: 0.74, restLift: -0.25, flapRate: 1.4, cruiseFlap: 0.3 },
  { id: "shalik", model: "/models/bird-shalik.glb", name: "birdShalik", note: "birdShalikNote", swatch: ["#74513a", "#1f2126", "#e6b422"], scale: 0.8, restLift: -0.14, flapRate: 1.25, cruiseFlap: 0.26 },
  { id: "chil", model: "/models/bird-chil.glb", name: "birdChil", note: "birdChilNote", swatch: ["#6c4c36", "#a98b68", "#dcb63c"], scale: 1.1, restLift: 0.2, flapRate: 0.72, cruiseFlap: 0.05 },
  { id: "tiya", model: "/models/bird-tiya.glb", name: "birdTiya", note: "birdTiyaNote", swatch: ["#62b03c", "#3fa9a6", "#d43c30"], scale: 0.82, restLift: -0.17, flapRate: 1.35, cruiseFlap: 0.3 },
  { id: "machhranga", model: "/models/bird-machhranga.glb", name: "birdMachhranga", note: "birdMachhrangaNote", swatch: ["#2aa6c8", "#8d4c2b", "#d2422e"], scale: 0.8, restLift: -0.16, flapRate: 1.3, cruiseFlap: 0.28 },
];

export const DEFAULT_BIRD: BirdId = "crow";

export function birdById(id: BirdId) {
  return BIRDS.find((bird) => bird.id === id) ?? BIRDS[0];
}

// The chosen bird lives outside React for the same reason the language does:
// the 3D scene is built once and swaps models through a ref.
const BIRD_STORAGE_KEY = "bev-bird";
const birdListeners = new Set<() => void>();
let chosenBird: BirdId | null = null;

function isBirdId(value: string | null | undefined): value is BirdId {
  return BIRDS.some((bird) => bird.id === value);
}

/** Explicit choice, then `?bird=`, then the saved choice, then the crow. */
export function readBird(): BirdId {
  if (chosenBird) return chosenBird;
  const requested = new URLSearchParams(window.location.search).get("bird");
  if (isBirdId(requested)) return requested;
  try {
    const saved = window.localStorage.getItem(BIRD_STORAGE_KEY);
    if (isBirdId(saved)) return saved;
  } catch {
    // Storage can be blocked; fall through to the default.
  }
  return DEFAULT_BIRD;
}

export function chooseBird(id: BirdId) {
  chosenBird = id;
  try {
    window.localStorage.setItem(BIRD_STORAGE_KEY, id);
  } catch {
    // The choice still holds for this visit.
  }
  birdListeners.forEach((listener) => listener());
}

export function subscribeToBird(listener: () => void) {
  birdListeners.add(listener);
  return () => {
    birdListeners.delete(listener);
  };
}
