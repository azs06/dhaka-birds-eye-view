const CENTER = { lat: 23.7498, lon: 90.4127 };
const BOUNDS = {
  south: 23.7468,
  west: 90.4097,
  north: 23.7528,
  east: 90.4157,
};
const WORLD_SCALE = 3.2;
const MAX_BUILDINGS = 700;
const MAX_ROADS = 360;

type OsmPoint = { lat: number; lon: number };
type OsmElement = {
  id: number;
  type: "way" | "node" | "relation";
  tags?: Record<string, string>;
  geometry?: OsmPoint[];
};
type OsmResponse = { elements?: OsmElement[]; osm3s?: { timestamp_osm_base?: string } };
type WorldPoint = [number, number];

const overpassEndpoints = [
  "https://overpass.openstreetmap.fr/api/interpreter",
];
let cachedOsm: OsmResponse | null = null;
let cachedUntil = 0;
let inFlightRequest: Promise<OsmResponse> | null = null;

function toWorld(point: OsmPoint): WorldPoint {
  const metresPerLongitude = 111_320 * Math.cos(CENTER.lat * Math.PI / 180);
  return [
    (point.lon - CENTER.lon) * metresPerLongitude * WORLD_SCALE,
    -(point.lat - CENTER.lat) * 110_540 * WORLD_SCALE,
  ];
}

function cleanGeometry(element: OsmElement, closed = false): WorldPoint[] | null {
  if (!element.geometry || element.geometry.length < (closed ? 3 : 2)) return null;
  const points = element.geometry
    .filter((point) => Number.isFinite(point.lat) && Number.isFinite(point.lon))
    .map(toWorld);
  if (closed && points.length > 3) {
    const [firstX, firstZ] = points[0];
    const [lastX, lastZ] = points[points.length - 1];
    if (Math.hypot(firstX - lastX, firstZ - lastZ) < 0.5) points.pop();
  }
  return points.length >= (closed ? 3 : 2) ? points : null;
}

function polygonArea(points: WorldPoint[]) {
  let area = 0;
  for (let index = 0; index < points.length; index++) {
    const [x1, z1] = points[index];
    const [x2, z2] = points[(index + 1) % points.length];
    area += x1 * z2 - x2 * z1;
  }
  return Math.abs(area) / 2;
}

function buildingHeight(tags: Record<string, string>, id: number) {
  const taggedHeight = Number.parseFloat(tags.height ?? "");
  if (Number.isFinite(taggedHeight)) return Math.min(Math.max(taggedHeight, 5), 180);
  const levels = Number.parseFloat(tags["building:levels"] ?? "");
  if (Number.isFinite(levels)) return Math.min(Math.max(levels * 3.2 + 1.5, 6), 180);
  return 11 + (id % 7) * 2.4;
}

function xmlAttributes(source: string) {
  const attributes: Record<string, string> = {};
  for (const match of source.matchAll(/([:\w-]+)="([^"]*)"/g)) attributes[match[1]] = match[2];
  return attributes;
}

async function fetchOsmMapApi() {
  const bbox = `${BOUNDS.west},${BOUNDS.south},${BOUNDS.east},${BOUNDS.north}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10_000);
  try {
    const response = await fetch(`https://api.openstreetmap.org/api/0.6/map?bbox=${bbox}`, {
      headers: {
        Accept: "application/xml",
        "User-Agent": "BirdsEyeView-Dhaka/1.0 (OpenStreetMap flight visualization)",
      },
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`OpenStreetMap responded with ${response.status}`);
    const xml = await response.text();
    const nodes = new Map<string, OsmPoint>();
    for (const match of xml.matchAll(/<node\b([^>]*)>/g)) {
      const attributes = xmlAttributes(match[1]);
      const lat = Number(attributes.lat);
      const lon = Number(attributes.lon);
      if (attributes.id && Number.isFinite(lat) && Number.isFinite(lon)) nodes.set(attributes.id, { lat, lon });
    }

    const elements: OsmElement[] = [];
    for (const match of xml.matchAll(/<way\b([^>]*)>([\s\S]*?)<\/way>/g)) {
      const wayAttributes = xmlAttributes(match[1]);
      const body = match[2];
      const tags: Record<string, string> = {};
      for (const tagMatch of body.matchAll(/<tag\b([^>]*)\/>/g)) {
        const tag = xmlAttributes(tagMatch[1]);
        if (tag.k) tags[tag.k] = tag.v ?? "";
      }
      if (!tags.building && !tags.highway && tags.natural !== "water" && !tags.waterway) continue;
      const geometry = Array.from(body.matchAll(/<nd\b([^>]*)\/>/g))
        .map((nodeMatch) => nodes.get(xmlAttributes(nodeMatch[1]).ref))
        .filter((point): point is OsmPoint => Boolean(point));
      if (geometry.length < 2) continue;
      elements.push({
        id: Number(wayAttributes.id),
        type: "way",
        tags,
        geometry,
      });
    }
    return { elements, osm3s: { timestamp_osm_base: new Date().toISOString() } } satisfies OsmResponse;
  } finally {
    clearTimeout(timer);
  }
}

async function requestOverpass(query: string) {
  let lastError: unknown;
  for (const endpoint of overpassEndpoints) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8_000);
    try {
      const response = await fetch(endpoint, {
        method: "POST",
        body: new URLSearchParams({ data: query }),
        headers: {
          "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8",
          "User-Agent": "BirdsEyeView-Dhaka/1.0 (OpenStreetMap flight visualization)",
        },
        signal: controller.signal,
      });
      if (!response.ok) throw new Error(`Overpass responded with ${response.status}`);
      return await response.json() as OsmResponse;
    } catch (error) {
      lastError = error;
    } finally {
      clearTimeout(timer);
    }
  }
  try {
    return await fetchOsmMapApi();
  } catch (error) {
    throw lastError instanceof Error ? lastError : error;
  }
}

async function fetchOverpass(query: string) {
  if (cachedOsm && Date.now() < cachedUntil) return cachedOsm;
  if (!inFlightRequest) {
    inFlightRequest = requestOverpass(query)
      .then((osm) => {
        cachedOsm = osm;
        cachedUntil = Date.now() + 60 * 60 * 1000;
        return osm;
      })
      .finally(() => {
        inFlightRequest = null;
      });
  }
  try {
    return await inFlightRequest;
  } catch (error) {
    if (cachedOsm) return cachedOsm;
    throw error;
  }
}

export async function GET() {
  const bbox = `${BOUNDS.south},${BOUNDS.west},${BOUNDS.north},${BOUNDS.east}`;
  const query = `[out:json][timeout:22];(
    way["building"]["building:levels"](${bbox});
    way["building"]["height"](${bbox});
    way["building"]["name"](${bbox});
    way["highway"](${bbox});
    way["natural"="water"](${bbox});
    way["waterway"](${bbox});
  );out geom qt;`;

  try {
    const osm = await fetchOverpass(query);
    const elements = osm.elements ?? [];
    const buildings = elements
      .filter((element) => element.type === "way" && element.tags?.building)
      .map((element) => {
        const points = cleanGeometry(element, true);
        if (!points) return null;
        const area = polygonArea(points);
        if (area < 16 || area > 30_000) return null;
        const tags = element.tags ?? {};
        return {
          id: element.id,
          points,
          height: buildingHeight(tags, element.id),
          name: tags.name ?? null,
          score: area + (tags.name ? 8_000 : 0) + (tags["building:levels"] ? 4_000 : 0),
        };
      })
      .filter((building): building is NonNullable<typeof building> => Boolean(building))
      .sort((a, b) => b.score - a.score)
      .slice(0, MAX_BUILDINGS)
      .map((building) => ({
        id: building.id,
        points: building.points,
        height: building.height,
        name: building.name,
      }));

    const roads = elements
      .filter((element) => element.type === "way" && element.tags?.highway)
      .map((element) => {
        const points = cleanGeometry(element);
        if (!points) return null;
        return {
          id: element.id,
          points,
          kind: element.tags?.highway ?? "road",
          name: element.tags?.name ?? null,
        };
      })
      .filter((road): road is NonNullable<typeof road> => Boolean(road))
      .slice(0, MAX_ROADS);

    const water = elements
      .filter((element) => element.type === "way" && (element.tags?.natural === "water" || element.tags?.waterway))
      .map((element) => {
        const points = cleanGeometry(element, element.tags?.natural === "water");
        if (!points) return null;
        return { id: element.id, points, area: element.tags?.natural === "water" };
      })
      .filter((feature): feature is NonNullable<typeof feature> => Boolean(feature));

    return Response.json({
      source: "OpenStreetMap",
      fetchedAt: osm.osm3s?.timestamp_osm_base ?? new Date().toISOString(),
      center: CENTER,
      buildings,
      roads,
      water,
    }, {
      headers: {
        "Cache-Control": "public, max-age=900, s-maxage=3600, stale-while-revalidate=86400",
      },
    });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "OpenStreetMap data is unavailable" },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
}
