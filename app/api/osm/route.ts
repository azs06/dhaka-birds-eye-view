const CENTER = { lat: 23.7715, lon: 90.4165 };
const BOUNDS = {
  south: 23.742,
  west: 90.389,
  north: 23.801,
  east: 90.444,
};
const WORLD_SCALE = 1;
const BUILDING_CELL_SIZE = 250;
const BUILDINGS_PER_CELL = 16;
const RELATION_ID_OFFSET = 1_000_000_000_000;
const MAX_ROADS = 1_100;

type OsmPoint = { lat: number; lon: number };
type OsmElement = {
  id: number;
  type: "way" | "node" | "relation";
  tags?: Record<string, string>;
  geometry?: OsmPoint[];
  members?: Array<{
    type: "way" | "node" | "relation";
    ref: number;
    role: string;
    geometry?: OsmPoint[];
  }>;
};
type OsmResponse = { elements?: OsmElement[]; osm3s?: { timestamp_osm_base?: string } };
type WorldPoint = [number, number];

const overpassEndpoints = [
  "https://overpass.openstreetmap.fr/api/interpreter",
  "https://overpass-api.de/api/interpreter",
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
  return cleanPoints(element.geometry, closed);
}

function cleanPoints(geometry: OsmPoint[] | undefined, closed = false): WorldPoint[] | null {
  if (!geometry || geometry.length < (closed ? 3 : 2)) return null;
  const points = geometry
    .filter((point) => Number.isFinite(point.lat) && Number.isFinite(point.lon))
    .map(toWorld);
  if (closed && points.length > 3) {
    const [firstX, firstZ] = points[0];
    const [lastX, lastZ] = points[points.length - 1];
    if (Math.hypot(firstX - lastX, firstZ - lastZ) < 0.5) points.pop();
  }
  return points.length >= (closed ? 3 : 2) ? points : null;
}

function pointsMeet(a: WorldPoint, b: WorldPoint) {
  return Math.hypot(a[0] - b[0], a[1] - b[1]) < 0.75;
}

/** Join the outer member ways of an OSM multipolygon into closed footprint rings. */
function relationOuterRings(element: OsmElement) {
  const segments = (element.members ?? [])
    .filter((member) => member.type === "way" && (member.role === "outer" || member.role === ""))
    .map((member) => cleanPoints(member.geometry))
    .filter((points): points is WorldPoint[] => Boolean(points));
  const rings: WorldPoint[][] = [];

  while (segments.length > 0) {
    const ring = segments.pop()!;
    let joined = true;
    while (!pointsMeet(ring[0], ring[ring.length - 1]) && joined) {
      joined = false;
      for (let index = 0; index < segments.length; index++) {
        const segment = segments[index];
        if (pointsMeet(ring[ring.length - 1], segment[0])) {
          ring.push(...segment.slice(1));
        } else if (pointsMeet(ring[ring.length - 1], segment[segment.length - 1])) {
          ring.push(...segment.reverse().slice(1));
        } else {
          continue;
        }
        segments.splice(index, 1);
        joined = true;
        break;
      }
    }

    if (ring.length >= 4 && pointsMeet(ring[0], ring[ring.length - 1])) {
      ring.pop();
      if (ring.length >= 3) rings.push(ring);
    }
  }

  return rings;
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

function isPriorityBuilding(tags: Record<string, string>) {
  if (tags.name) return true;
  const taggedHeight = Number.parseFloat(tags.height ?? "");
  if (Number.isFinite(taggedHeight) && taggedHeight >= 30) return true;
  const levels = Number.parseFloat(tags["building:levels"] ?? "");
  return Number.isFinite(levels) && levels >= 8;
}

function deterministicBuildingOrder(id: number) {
  let value = Math.abs(id) % 2_147_483_647;
  value = Math.imul(value ^ (value >>> 16), 0x45d9f3b);
  value = Math.imul(value ^ (value >>> 16), 0x45d9f3b);
  return (value ^ (value >>> 16)) >>> 0;
}

function spatiallySampleBuildings<T extends { id: number; points: WorldPoint[]; priority: boolean }>(buildings: T[]) {
  const cells = new Map<string, T[]>();
  for (const building of buildings) {
    const [sumX, sumZ] = building.points.reduce(
      ([x, z], point) => [x + point[0], z + point[1]],
      [0, 0],
    );
    const cellX = Math.floor((sumX / building.points.length) / BUILDING_CELL_SIZE);
    const cellZ = Math.floor((sumZ / building.points.length) / BUILDING_CELL_SIZE);
    const key = `${cellX}:${cellZ}`;
    const cell = cells.get(key);
    if (cell) cell.push(building);
    else cells.set(key, [building]);
  }

  return Array.from(cells.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .flatMap(([, cell]) => {
      const priority = cell
        .filter((building) => building.priority)
        .sort((a, b) => deterministicBuildingOrder(a.id) - deterministicBuildingOrder(b.id) || a.id - b.id);
      const remainingSlots = Math.max(0, BUILDINGS_PER_CELL - priority.length);
      const sampled = cell
        .filter((building) => !building.priority)
        .sort((a, b) => deterministicBuildingOrder(a.id) - deterministicBuildingOrder(b.id) || a.id - b.id)
        .slice(0, remainingSlots);
      return [...priority, ...sampled];
    });
}

function xmlAttributes(source: string) {
  const attributes: Record<string, string> = {};
  for (const match of source.matchAll(/([:\w-]+)="([^"]*)"/g)) attributes[match[1]] = match[2];
  return attributes;
}

async function fetchOsmMapApi(bounds: number[]) {
  const [south, west, north, east] = bounds;
  const bbox = `${west},${south},${east},${north}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20_000);
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

async function requestOverpass(query: string, preferredEndpoint = 0) {
  let lastError: unknown;
  for (let attempt = 0; attempt < overpassEndpoints.length; attempt++) {
    const endpoint = overpassEndpoints[(preferredEndpoint + attempt) % overpassEndpoints.length];
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 18_000);
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
  throw lastError instanceof Error ? lastError : new Error("OpenStreetMap data is unavailable");
}

async function fetchOverpass(tiles: Array<{ bounds: number[]; query: string }>) {
  if (cachedOsm && Date.now() < cachedUntil) return cachedOsm;
  if (!inFlightRequest) {
    inFlightRequest = Promise.allSettled(tiles.map(async (tile, index) => {
      try {
        return await requestOverpass(tile.query, index);
      } catch {
        return fetchOsmMapApi(tile.bounds);
      }
    }))
      .then(async (results) => {
        const successful = results
          .filter((result): result is PromiseFulfilledResult<OsmResponse> => result.status === "fulfilled")
          .map((result) => result.value);
        if (successful.length === 0) throw new Error("OpenStreetMap data is unavailable");
        const elements = new Map<string, OsmElement>();
        for (const osm of successful) {
          for (const element of osm.elements ?? []) elements.set(`${element.type}:${element.id}`, element);
        }
        return {
          elements: Array.from(elements.values()),
          osm3s: { timestamp_osm_base: successful[0].osm3s?.timestamp_osm_base ?? new Date().toISOString() },
        } satisfies OsmResponse;
      })
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
  const middleLatitude = (BOUNDS.south + BOUNDS.north) / 2;
  const middleLongitude = (BOUNDS.west + BOUNDS.east) / 2;
  const tileBounds = [
    [BOUNDS.south, BOUNDS.west, middleLatitude, middleLongitude],
    [BOUNDS.south, middleLongitude, middleLatitude, BOUNDS.east],
    [middleLatitude, BOUNDS.west, BOUNDS.north, middleLongitude],
    [middleLatitude, middleLongitude, BOUNDS.north, BOUNDS.east],
  ];
  const tiles = tileBounds.map((bounds) => {
    const bbox = bounds.join(",");
    return { bounds, query: `[out:json][timeout:20];(
      way["building"](${bbox});
      relation["building"]["type"="multipolygon"](${bbox});
      way["highway"~"^(motorway|trunk|primary|secondary|tertiary|residential|unclassified)$"](${bbox});
      way["natural"="water"](${bbox});
      way["waterway"](${bbox});
    );out geom qt;` };
  });

  try {
    const osm = await fetchOverpass(tiles);
    const elements = osm.elements ?? [];
    const relationMemberWayIds = new Set(elements
      .filter((element) => element.type === "relation" && element.tags?.building)
      .flatMap((element) => (element.members ?? [])
        .filter((member) => member.type === "way" && (member.role === "outer" || member.role === ""))
        .map((member) => member.ref)));
    const buildingCandidates = elements.flatMap((element) => {
      if (!element.tags?.building) return [];
      const tags = element.tags;
      const footprints = element.type === "relation"
        ? relationOuterRings(element)
        : element.type === "way" && !relationMemberWayIds.has(element.id)
          ? [cleanGeometry(element, true)].filter((points): points is WorldPoint[] => Boolean(points))
          : [];
      return footprints
        .filter((points) => polygonArea(points) >= 9)
        .map((points, ringIndex) => ({
          id: element.type === "relation" ? RELATION_ID_OFFSET + element.id * 100 + ringIndex : element.id,
          points,
          height: buildingHeight(tags, element.id),
          name: tags.name ?? null,
          priority: isPriorityBuilding(tags),
        }));
    });
    const buildings = spatiallySampleBuildings(buildingCandidates).map((building) => ({
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
