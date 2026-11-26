export type MetroPoint = [number, number];

export type MetroStationFootprint = {
  x: number;
  z: number;
  /** Unit tangent along the track at the projected station point. */
  tx: number;
  tz: number;
};

type MetroSegment = { x1: number; z1: number; x2: number; z2: number };

export const METRO_GIRDER_HALF_WIDTH = 4.8;
export const METRO_PIER_CAP_WIDTH = 11.4;
export const METRO_VIADUCT_CLEARANCE_PROCEDURAL = 9;
export const METRO_VIADUCT_CLEARANCE_OSM = 7.5;
export const METRO_STATION_HALL_HALF_LENGTH = 50;
export const METRO_STATION_HALL_HALF_WIDTH = 14;
export const METRO_STATION_STAIR_HALF_LENGTH = 6;
export const METRO_STATION_STAIR_HALF_WIDTH = 40;
export const METRO_STATION_CLEARANCE_MARGIN = 2.5;

/**
 * Sample density shared by the rendered viaduct mesh and the building clearance
 * index so curves stay smooth (~24 m chords) and avoidance matches the geometry.
 */
export function metroGirderSampleCount(curveLength: number) {
  return Math.min(1200, Math.max(320, Math.round(curveLength / 24)));
}

function distanceToSegmentSquared(px: number, pz: number, x1: number, z1: number, x2: number, z2: number) {
  const dx = x2 - x1;
  const dz = z2 - z1;
  const lengthSquared = dx * dx + dz * dz;
  if (lengthSquared === 0) return (px - x1) ** 2 + (pz - z1) ** 2;
  const t = Math.min(1, Math.max(0, ((px - x1) * dx + (pz - z1) * dz) / lengthSquared));
  const nearestX = x1 + t * dx;
  const nearestZ = z1 + t * dz;
  return (px - nearestX) ** 2 + (pz - nearestZ) ** 2;
}

function cross2D(ax: number, az: number, bx: number, bz: number, cx: number, cz: number) {
  return (bx - ax) * (cz - az) - (bz - az) * (cx - ax);
}

function segmentsProperlyIntersect(
  ax: number,
  az: number,
  bx: number,
  bz: number,
  cx: number,
  cz: number,
  dx: number,
  dz: number,
) {
  const d1 = cross2D(ax, az, bx, bz, cx, cz);
  const d2 = cross2D(ax, az, bx, bz, dx, dz);
  const d3 = cross2D(cx, cz, dx, dz, ax, az);
  const d4 = cross2D(cx, cz, dx, dz, bx, bz);
  return ((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0))
    && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0));
}

function segmentToSegmentDistanceSquared(
  ax: number,
  az: number,
  bx: number,
  bz: number,
  cx: number,
  cz: number,
  dx: number,
  dz: number,
) {
  if (segmentsProperlyIntersect(ax, az, bx, bz, cx, cz, dx, dz)) return 0;
  return Math.min(
    distanceToSegmentSquared(ax, az, cx, cz, dx, dz),
    distanceToSegmentSquared(bx, bz, cx, cz, dx, dz),
    distanceToSegmentSquared(cx, cz, ax, az, bx, bz),
    distanceToSegmentSquared(dx, dz, ax, az, bx, bz),
  );
}

function pointInPolygon(x: number, z: number, points: MetroPoint[]) {
  let inside = false;
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const [xi, zi] = points[i];
    const [xj, zj] = points[j];
    const intersects = ((zi > z) !== (zj > z)) && (x < ((xj - xi) * (z - zi)) / (zj - zi || 1e-6) + xi);
    if (intersects) inside = !inside;
  }
  return inside;
}

function segmentIntersectsAabb(
  x1: number,
  z1: number,
  x2: number,
  z2: number,
  halfX: number,
  halfZ: number,
) {
  let tMin = 0;
  let tMax = 1;
  const dx = x2 - x1;
  const dz = z2 - z1;
  const clip = (p: number, q: number) => {
    if (Math.abs(p) < 1e-9) return q >= 0;
    const r = q / p;
    if (p < 0) {
      if (r > tMax) return false;
      if (r > tMin) tMin = r;
    } else {
      if (r < tMin) return false;
      if (r < tMax) tMax = r;
    }
    return true;
  };
  return clip(-dx, x1 + halfX)
    && clip(dx, halfX - x1)
    && clip(-dz, z1 + halfZ)
    && clip(dz, halfZ - z1);
}

function circleHitsStation(
  x: number,
  z: number,
  radius: number,
  station: MetroStationFootprint,
  margin: number,
) {
  const dx = x - station.x;
  const dz = z - station.z;
  const along = Math.abs(dx * station.tx + dz * station.tz);
  const across = Math.abs(-dx * station.tz + dz * station.tx);
  const clearanceSquared = (radius + margin) ** 2;
  const hallDx = Math.max(0, along - METRO_STATION_HALL_HALF_LENGTH);
  const hallDz = Math.max(0, across - METRO_STATION_HALL_HALF_WIDTH);
  if (hallDx * hallDx + hallDz * hallDz < clearanceSquared) return true;
  const stairDx = Math.max(0, along - METRO_STATION_STAIR_HALF_LENGTH);
  const stairDz = Math.max(0, across - METRO_STATION_STAIR_HALF_WIDTH);
  return stairDx * stairDx + stairDz * stairDz < clearanceSquared;
}

function polygonHitsStation(
  points: MetroPoint[],
  station: MetroStationFootprint,
  margin: number,
) {
  const local: MetroPoint[] = points.map(([px, pz]) => {
    const dx = px - station.x;
    const dz = pz - station.z;
    return [dx * station.tx + dz * station.tz, -dx * station.tz + dz * station.tx];
  });
  if (pointInPolygon(0, 0, local)) return true;
  const hallHalfX = METRO_STATION_HALL_HALF_LENGTH + margin;
  const hallHalfZ = METRO_STATION_HALL_HALF_WIDTH + margin;
  const stairHalfX = METRO_STATION_STAIR_HALF_LENGTH + margin;
  const stairHalfZ = METRO_STATION_STAIR_HALF_WIDTH + margin;
  for (let i = 0; i < local.length; i++) {
    const [x1, z1] = local[i];
    const [x2, z2] = local[(i + 1) % local.length];
    if (segmentIntersectsAabb(x1, z1, x2, z2, hallHalfX, hallHalfZ)) return true;
    if (segmentIntersectsAabb(x1, z1, x2, z2, stairHalfX, stairHalfZ)) return true;
  }
  return false;
}

export type MetroCorridorIndex = {
  /** True when a circle (e.g. a procedural building or tree) clips the viaduct or a station. */
  blocksCircle: (x: number, z: number, radius: number, viaductClearance?: number) => boolean;
  /** True when an OSM building polygon clips the viaduct or a station. */
  blocksPolygon: (points: MetroPoint[], viaductClearance?: number) => boolean;
};

/**
 * Spatial clearance index over the elevated metro viaduct and stations so
 * neither procedural filler nor OSM building extrusions cut through the rail.
 */
export function buildMetroCorridor(
  centerline: MetroPoint[],
  stations: MetroStationFootprint[],
  cellSize = 180,
): MetroCorridorIndex {
  const segmentGrid = new Map<string, MetroSegment[]>();
  const stationGrid = new Map<string, MetroStationFootprint[]>();
  const keyFor = (cellX: number, cellZ: number) => `${cellX}:${cellZ}`;

  const addToGrid = <T,>(grid: Map<string, T[]>, item: T, minX: number, maxX: number, minZ: number, maxZ: number) => {
    const startX = Math.floor(minX / cellSize);
    const endX = Math.floor(maxX / cellSize);
    const startZ = Math.floor(minZ / cellSize);
    const endZ = Math.floor(maxZ / cellSize);
    for (let cellX = startX; cellX <= endX; cellX++) {
      for (let cellZ = startZ; cellZ <= endZ; cellZ++) {
        const key = keyFor(cellX, cellZ);
        const bucket = grid.get(key);
        if (bucket) bucket.push(item);
        else grid.set(key, [item]);
      }
    }
  };

  const segmentPad = 16;
  for (let i = 1; i < centerline.length; i++) {
    const [x1, z1] = centerline[i - 1];
    const [x2, z2] = centerline[i];
    addToGrid(
      segmentGrid,
      { x1, z1, x2, z2 },
      Math.min(x1, x2) - segmentPad,
      Math.max(x1, x2) + segmentPad,
      Math.min(z1, z2) - segmentPad,
      Math.max(z1, z2) + segmentPad,
    );
  }

  const stationPad = 60;
  for (const station of stations) {
    addToGrid(
      stationGrid,
      station,
      station.x - stationPad,
      station.x + stationPad,
      station.z - stationPad,
      station.z + stationPad,
    );
  }

  const blocksCircle = (
    x: number,
    z: number,
    radius: number,
    viaductClearance = METRO_VIADUCT_CLEARANCE_PROCEDURAL,
  ) => {
    const reach = radius + viaductClearance;
    const reachSquared = reach * reach;
    const startX = Math.floor((x - radius) / cellSize);
    const endX = Math.floor((x + radius) / cellSize);
    const startZ = Math.floor((z - radius) / cellSize);
    const endZ = Math.floor((z + radius) / cellSize);
    for (let cellX = startX; cellX <= endX; cellX++) {
      for (let cellZ = startZ; cellZ <= endZ; cellZ++) {
        const key = keyFor(cellX, cellZ);
        const segments = segmentGrid.get(key);
        if (segments) {
          for (const segment of segments) {
            if (distanceToSegmentSquared(x, z, segment.x1, segment.z1, segment.x2, segment.z2) < reachSquared) {
              return true;
            }
          }
        }
        const nearbyStations = stationGrid.get(key);
        if (nearbyStations) {
          for (const station of nearbyStations) {
            if (circleHitsStation(x, z, radius, station, METRO_STATION_CLEARANCE_MARGIN)) {
              return true;
            }
          }
        }
      }
    }
    return false;
  };

  const blocksPolygon = (
    points: MetroPoint[],
    viaductClearance = METRO_VIADUCT_CLEARANCE_OSM,
  ) => {
    if (points.length < 3) return false;
    let minX = Infinity;
    let maxX = -Infinity;
    let minZ = Infinity;
    let maxZ = -Infinity;
    for (const [px, pz] of points) {
      if (px < minX) minX = px;
      if (px > maxX) maxX = px;
      if (pz < minZ) minZ = pz;
      if (pz > maxZ) maxZ = pz;
    }
    const clearanceSquared = viaductClearance * viaductClearance;
    const startX = Math.floor((minX - viaductClearance) / cellSize);
    const endX = Math.floor((maxX + viaductClearance) / cellSize);
    const startZ = Math.floor((minZ - viaductClearance) / cellSize);
    const endZ = Math.floor((maxZ + viaductClearance) / cellSize);
    const checkedStations = new Set<MetroStationFootprint>();
    for (let cellX = startX; cellX <= endX; cellX++) {
      for (let cellZ = startZ; cellZ <= endZ; cellZ++) {
        const key = keyFor(cellX, cellZ);
        const segments = segmentGrid.get(key);
        if (segments) {
          for (const seg of segments) {
            if (
              Math.max(seg.x1, seg.x2) < minX - viaductClearance
              || Math.min(seg.x1, seg.x2) > maxX + viaductClearance
              || Math.max(seg.z1, seg.z2) < minZ - viaductClearance
              || Math.min(seg.z1, seg.z2) > maxZ + viaductClearance
            ) {
              continue;
            }
            if (pointInPolygon(seg.x1, seg.z1, points) || pointInPolygon(seg.x2, seg.z2, points)) {
              return true;
            }
            for (let i = 0; i < points.length; i++) {
              const [px, pz] = points[i];
              const [qx, qz] = points[(i + 1) % points.length];
              if (segmentToSegmentDistanceSquared(seg.x1, seg.z1, seg.x2, seg.z2, px, pz, qx, qz) < clearanceSquared) {
                return true;
              }
            }
          }
        }
        const nearbyStations = stationGrid.get(key);
        if (nearbyStations) {
          for (const station of nearbyStations) {
            if (checkedStations.has(station)) continue;
            checkedStations.add(station);
            if (polygonHitsStation(points, station, 2)) return true;
          }
        }
      }
    }
    return false;
  };

  return { blocksCircle, blocksPolygon };
}
