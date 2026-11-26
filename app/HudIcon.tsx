// Line icons for the flight interface. They draw in currentColor so the same
// glyph works on the warm glass, on the paper selection and on brick.

import type { ReactNode } from "react";
import type { Bird } from "./birds";

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

/** Species silhouette tinted with each bird's plumage; lightens dark bodies on kohl glass. */
export function BirdGlyph({
  bird,
  selected = false,
  className = "bird-glyph",
}: {
  bird: Pick<Bird, "id" | "swatch">;
  selected?: boolean;
  className?: string;
}) {
  const [c1, c2, c3] = bird.swatch;
  const darkBody = selected ? c1 : (bird.id === "crow" || bird.id === "doel" ? "#dfd8c8" : c1);
  const collar = selected ? c2 : (bird.id === "crow" ? "#98968f" : c2);
  const bill = selected ? c3 : (bird.id === "crow" || bird.id === "doel" ? "#b7b0a2" : c3);
  const kiteWing = selected ? c1 : "#c79e79";
  const kiteEdge = selected ? c2 : "#f0dec4";
  const shalikBody = selected ? c1 : "#b68562";
  const shalikHood = selected ? c2 : "#3b3532";

  return (
    <svg className={className} viewBox="0 0 21 21" fill="none" aria-hidden="true" focusable="false">
      {bird.id === "crow" && (
        <>
          <path d="M2.5 16.2l3.8-2.4c1.3-2.6 3.3-4.6 5.4-5.6.3-1.4 1.3-2.5 2.7-2.5 1.1 0 1.9.7 2.2 1.6l2.4.6-2.2 1.1c-.1 2.2-1.1 4.4-3 5.7-1.6 1.1-3.5 1.5-5.6 1.4l-4.6 1.5-1.1-1.4z" fill={darkBody} />
          <path d="M11.6 8.3c.7-.8 1.5-1.3 2.5-1.3.7 0 1.3.4 1.6 1-.8.9-1.9 1.6-3.3 1.8-.3-.5-.6-1-.8-1.5z" fill={collar} />
          <path d="M16.5 7.2l2.6.7-2.4 1.1z" fill={bill} />
        </>
      )}
      {bird.id === "doel" && (
        <>
          <path d="M2.2 5.4l4.8 4.4c1.2-.5 2.6-.5 3.9-.2.5-1.3 1.4-2.2 2.7-2.2 1 0 1.8.6 2.1 1.5l2.2.5-2 .9c-.2 2.1-1.3 4.1-3.2 5.1-2.1 1.1-4.8 1-6.9-.5L1.6 6.8l.6-1.4z" fill={darkBody} />
          <path d="M7.6 13.6c1.7.9 3.8.9 5.5-.1.9-.6 1.6-1.4 2-2.4-1.5.5-3.2.5-4.7-.2-1-.4-1.9-.1-2.8.8v1.9z" fill={selected ? "#ffffff" : "#2a2320"} />
          <path d="M8.8 11.4l3.5.1-.5 1-3.3-.2z" fill={selected ? "#ffffff" : "#2a2320"} />
        </>
      )}
      {bird.id === "shalik" && (
        <>
          <path d="M2.8 15.8l3.7-2.2c1.1-2.4 2.8-4.4 5-5.4.4-1.4 1.3-2.4 2.7-2.4 1.1 0 1.9.7 2.2 1.6l2.6.6-2.4 1.1c-.2 2.2-1.2 4.3-3 5.5-1.6 1.1-3.6 1.5-5.6 1.4l-4.2 1.2-1-1.4z" fill={shalikBody} />
          <path d="M11.6 8.3c.3-1.4 1.3-2.5 2.6-2.5 1.1 0 1.9.7 2.2 1.6-.8.9-2 1.4-3.4 1.4-.5 0-1-.2-1.4-.5z" fill={shalikHood} />
          <path d="M8.7 12.1l2.8-.6-.4 1.3-2.6.4z" fill="#f6f0e1" opacity=".88" />
          <path d="M16.3 7.2l2.9.7-2.7 1.1z" fill={c3} />
        </>
      )}
      {bird.id === "chil" && (
        <>
          <path d="M1.2 9.8c3.1-2.5 6.4-3.4 9.3-2.5 2.9-.9 6.2 0 9.3 2.5-3-.6-5.7-.5-8.1.5l2.2 5.1-3.4-2.1-3.4 2.1 2.2-5.1c-2.4-1-5.1-1.1-8.1-.5z" fill={kiteWing} />
          <path d="M3.5 9c2.3-1 4.7-1.1 7-.4 2.3-.7 4.7-.6 7 .4-2.3-.1-4.6.2-7 1-2.4-.8-4.7-1.1-7-1z" fill={kiteEdge} opacity=".75" />
        </>
      )}
      {bird.id === "tiya" && (
        <>
          <path d="M1.8 18.2l5.9-5.3c1-2.2 2.4-4.1 4.1-5.3.4-1.4 1.5-2.4 2.9-2.4 1.2 0 2.2.8 2.4 2 .1 2.4-.8 4.8-2.6 6.4-1.4 1.2-3.1 1.9-5.1 2.1l-6.6 3.5-1-1z" fill={c1} />
          <path d="M11.6 8.7c1.1.1 2.1.6 2.8 1.5-.8.8-1.9 1.3-3.1 1.4 0-1 .1-2 .3-2.9z" fill={c2} opacity=".72" />
          <path d="M16.8 6.4c1.4 0 2.4.9 2.4 2.1 0 .6-.3 1.1-.8 1.4-.3-.7-.9-1.1-1.7-1.2l.1-2.3z" fill={c3} />
        </>
      )}
      {bird.id === "machhranga" && (
        <>
          <path d="M4.2 15.6l2.8-1.8c.9-2.1 2.4-3.9 4.3-4.9.4-1.5 1.4-2.5 2.8-2.5 1.2 0 2.2.8 2.4 1.9-.1 2.2-1.1 4.3-2.8 5.6-1.5 1.2-3.5 1.9-5.7 2l-3.1.9-.7-1.2z" fill={c1} />
          <path d="M11.2 9.1c.3-1.5 1.4-2.7 2.9-2.7 1.2 0 2.2.8 2.4 1.9-.7 1-1.9 1.7-3.3 1.7-.8 0-1.5-.3-2-.9z" fill={c2} />
          <path d="M11.9 10.6c.8.2 1.6.1 2.3-.3-.3.9-.9 1.6-1.8 1.9-.5-.4-.6-1-.5-1.6z" fill="#f6f0e1" />
          <path d="M16.2 7.2l4.2 1.1-4.2 1.2z" fill={c3} />
        </>
      )}
    </svg>
  );
}
