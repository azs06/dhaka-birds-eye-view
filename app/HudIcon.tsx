// Line icons for the flight interface. They draw in currentColor so the same
// glyph works on the warm glass, on the paper selection and on brick.

import type { ReactNode } from "react";

export type HudIconName =
  | "brand" | "sun" | "moon" | "rain" | "cloud" | "storm" | "fog"
  | "sound" | "mute" | "pause" | "play" | "share" | "prev" | "next" | "more"
  | "help" | "check" | "pin" | "up" | "down" | "chev" | "close" | "home" | "lang";

const PATHS: Record<HudIconName, { viewBox: string; body: ReactNode }> = {
  brand: {
    viewBox: "0 0 38 30",
    body: (
      <>
        <path d="M2 13c6-1 11 1 17 7 6-6 11-8 17-7-6 2-10 5-13 10l-4 5-4-5C12 18 8 15 2 13Z" fill="currentColor" />
        <path d="M19 20c-1-5-1-10 2-15" stroke="#b8472d" strokeWidth="2.4" fill="none" strokeLinecap="round" />
      </>
    ),
  },
  sun: {
    viewBox: "0 0 20 20",
    body: (
      <g fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
        <circle cx="10" cy="10" r="3.6" />
        <path d="M10 1.8v2.2M10 16v2.2M1.8 10H4M16 10h2.2M4.2 4.2l1.6 1.6M14.2 14.2l1.6 1.6M4.2 15.8l1.6-1.6M14.2 5.8l1.6-1.6" />
      </g>
    ),
  },
  moon: {
    viewBox: "0 0 20 20",
    body: <path d="M14.5 13.6A6.5 6.5 0 0 1 7.2 3.4a6.6 6.6 0 1 0 9.4 8.9 6.3 6.3 0 0 1-2.1 1.3Z" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />,
  },
  cloud: {
    viewBox: "0 0 20 20",
    body: <path d="M5.5 15a3.5 3.5 0 0 1 .4-7 4.6 4.6 0 0 1 8.7 1.4 2.9 2.9 0 0 1-.3 5.6Z" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />,
  },
  rain: {
    viewBox: "0 0 20 20",
    body: (
      <g fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
        <path d="M5.5 12.5a3.5 3.5 0 0 1 .4-7 4.6 4.6 0 0 1 8.7 1.4 2.9 2.9 0 0 1-.3 5.6Z" />
        <path d="M7 15l-1 2.6M10.5 15l-1 2.6M14 15l-1 2.6" />
      </g>
    ),
  },
  storm: {
    viewBox: "0 0 20 20",
    body: (
      <g fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
        <path d="M5.5 12.5a3.5 3.5 0 0 1 .4-7 4.6 4.6 0 0 1 8.7 1.4 2.9 2.9 0 0 1-.3 5.6Z" />
        <path d="M10.5 13 8.6 16h2.6l-1.6 2.6" />
      </g>
    ),
  },
  fog: {
    viewBox: "0 0 20 20",
    body: <path d="M3 7h14M5 10.5h12M3 14h11" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />,
  },
  sound: {
    viewBox: "0 0 20 20",
    body: (
      <g fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
        <path d="M3 8h3l4-3.5v11L6 12H3Z" fill="currentColor" fillOpacity=".15" />
        <path d="M13 7.2a4 4 0 0 1 0 5.6M15.4 5a7.2 7.2 0 0 1 0 10" />
      </g>
    ),
  },
  mute: {
    viewBox: "0 0 20 20",
    body: (
      <g fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
        <path d="M3 8h3l4-3.5v11L6 12H3Z" fill="currentColor" fillOpacity=".15" />
        <path d="M13.2 7.6l4.4 4.8M17.6 7.6l-4.4 4.8" />
      </g>
    ),
  },
  pause: {
    viewBox: "0 0 20 20",
    body: (
      <>
        <rect x="5" y="4" width="3.2" height="12" rx="1" fill="currentColor" />
        <rect x="11.8" y="4" width="3.2" height="12" rx="1" fill="currentColor" />
      </>
    ),
  },
  play: { viewBox: "0 0 20 20", body: <path d="M6 4l10 6-10 6Z" fill="currentColor" /> },
  share: {
    viewBox: "0 0 20 20",
    body: (
      <g fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
        <path d="M8.6 11.4a3.2 3.2 0 0 0 4.6 0l2.6-2.6a3.2 3.2 0 0 0-4.6-4.6l-1 1" />
        <path d="M11.4 8.6a3.2 3.2 0 0 0-4.6 0l-2.6 2.6a3.2 3.2 0 0 0 4.6 4.6l1-1" />
      </g>
    ),
  },
  prev: { viewBox: "0 0 20 20", body: <path d="M12.5 4.5 7 10l5.5 5.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /> },
  next: { viewBox: "0 0 20 20", body: <path d="M7.5 4.5 13 10l-5.5 5.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /> },
  more: {
    viewBox: "0 0 20 20",
    body: (
      <>
        <circle cx="4.5" cy="10" r="1.8" fill="currentColor" />
        <circle cx="10" cy="10" r="1.8" fill="currentColor" />
        <circle cx="15.5" cy="10" r="1.8" fill="currentColor" />
      </>
    ),
  },
  help: {
    viewBox: "0 0 20 20",
    body: (
      <>
        <circle cx="10" cy="10" r="7.5" fill="none" stroke="currentColor" strokeWidth="1.6" />
        <path d="M7.8 7.8a2.3 2.3 0 1 1 3.2 2.1c-.7.3-1 .8-1 1.5v.4M10 14.2v.2" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
      </>
    ),
  },
  check: { viewBox: "0 0 16 16", body: <path d="M3 8.5l3.2 3L13 4.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /> },
  pin: {
    viewBox: "0 0 16 16",
    body: (
      <>
        <path d="M8 15s5-4.6 5-8.5A5 5 0 0 0 3 6.5C3 10.4 8 15 8 15Z" fill="none" stroke="currentColor" strokeWidth="1.6" />
        <circle cx="8" cy="6.5" r="1.8" fill="currentColor" />
      </>
    ),
  },
  up: { viewBox: "0 0 24 24", body: <path d="M12 20V5M6 11l6-6 6 6" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" /> },
  down: { viewBox: "0 0 24 24", body: <path d="M12 4v15M6 13l6 6 6-6" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" /> },
  chev: { viewBox: "0 0 10 10", body: <path d="M1.5 3.5 5 7l3.5-3.5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /> },
  close: { viewBox: "0 0 20 20", body: <path d="M5 5l10 10M15 5 5 15" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" /> },
  home: {
    viewBox: "0 0 20 20",
    body: <path d="M3.5 9.5 10 4l6.5 5.5M5.5 8v8h9V8" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />,
  },
  lang: {
    viewBox: "0 0 20 20",
    body: (
      <g fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
        <circle cx="10" cy="10" r="7.2" />
        <path d="M2.8 10h14.4M10 2.8c2.2 2.2 2.2 12.2 0 14.4M10 2.8c-2.2 2.2-2.2 12.2 0 14.4" />
      </g>
    ),
  },
};

export function HudIcon({ name, className = "hud-icon" }: { name: HudIconName; className?: string }) {
  const icon = PATHS[name];
  return (
    <svg className={className} viewBox={icon.viewBox} aria-hidden="true" focusable="false">
      {icon.body}
    </svg>
  );
}

/** The icon for the sky as it is drawn: a preset hour wins over the live reading. */
export function weatherIconName(mode: string, isDay: boolean): HudIconName {
  if (mode === "storm") return "storm";
  if (mode === "rain" || mode === "drizzle") return "rain";
  if (mode === "fog") return "fog";
  if (mode === "cloudy") return "cloud";
  return isDay ? "sun" : "moon";
}
