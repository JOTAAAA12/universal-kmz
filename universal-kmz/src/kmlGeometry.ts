import { BoundingBox, Coordinate } from './types';

const R_EARTH = 6371000;

export function getDistanceMeters(c1: Coordinate, c2: Coordinate): number {
  const lat1Rad = (c1.lat * Math.PI) / 180;
  const lat2Rad = (c2.lat * Math.PI) / 180;
  const deltaLat = ((c2.lat - c1.lat) * Math.PI) / 180;
  const deltaLng = ((c2.lng - c1.lng) * Math.PI) / 180;

  const a =
    Math.sin(deltaLat / 2) * Math.sin(deltaLat / 2) +
    Math.cos(lat1Rad) *
      Math.cos(lat2Rad) *
      Math.sin(deltaLng / 2) *
      Math.sin(deltaLng / 2);

  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R_EARTH * c;
}

export function distancePointToSegment(P: Coordinate, A: Coordinate, B: Coordinate): number {
  const dAB = getDistanceMeters(A, B);
  if (dAB < 0.1) return getDistanceMeters(P, A);

  const midLat = (A.lat + B.lat) / 2;
  const midLatRad = (midLat * Math.PI) / 180;
  const toMetersX = (lng: number) => (lng * Math.PI / 180) * R_EARTH * Math.cos(midLatRad);
  const toMetersY = (lat: number) => (lat * Math.PI / 180) * R_EARTH;
  const ax = toMetersX(A.lng);
  const ay = toMetersY(A.lat);
  const bx = toMetersX(B.lng);
  const by = toMetersY(B.lat);
  const px = toMetersX(P.lng);
  const py = toMetersY(P.lat);
  const l2 = (bx - ax) ** 2 + (by - ay) ** 2;
  let t = ((px - ax) * (bx - ax) + (py - ay) * (by - ay)) / l2;
  t = Math.max(0, Math.min(1, t));
  const cx = ax + t * (bx - ax);
  const cy = ay + t * (by - ay);
  return Math.sqrt((px - cx) ** 2 + (py - cy) ** 2);
}

export function calculateBoundingBox(coords: Coordinate[]): BoundingBox {
  if (coords.length === 0) return { minLat: 0, minLng: 0, maxLat: 0, maxLng: 0 };
  let minLat = Infinity;
  let minLng = Infinity;
  let maxLat = -Infinity;
  let maxLng = -Infinity;

  for (const c of coords) {
    if (c.lat < minLat) minLat = c.lat;
    if (c.lng < minLng) minLng = c.lng;
    if (c.lat > maxLat) maxLat = c.lat;
    if (c.lng > maxLng) maxLng = c.lng;
  }

  return { minLat, minLng, maxLat, maxLng };
}

export function calculateCentroid(coords: Coordinate[]): Coordinate {
  if (coords.length === 0) return { lat: 0, lng: 0 };
  let sumLat = 0;
  let sumLng = 0;
  for (const c of coords) {
    sumLat += c.lat;
    sumLng += c.lng;
  }
  return { lat: sumLat / coords.length, lng: sumLng / coords.length };
}

export function calculatePlanarPolygonAreaAndPerimeter(coords: Coordinate[]): { area: number; perimeter: number } {
  if (coords.length < 3) return { area: 0, perimeter: 0 };

  const localCoords = [...coords];
  const first = localCoords[0];
  const last = localCoords[localCoords.length - 1];
  if (first.lat !== last.lat || first.lng !== last.lng) {
    localCoords.push(first);
  }

  const centroid = calculateCentroid(localCoords);
  const midLatRad = (centroid.lat * Math.PI) / 180;
  const points = localCoords.map(c => ({
    x: ((c.lng - centroid.lng) * Math.PI / 180) * R_EARTH * Math.cos(midLatRad),
    y: ((c.lat - centroid.lat) * Math.PI / 180) * R_EARTH
  }));

  let doubleArea = 0;
  let perimeter = 0;
  for (let i = 0; i < points.length - 1; i++) {
    const p1 = points[i];
    const p2 = points[i + 1];
    doubleArea += (p1.x * p2.y - p2.x * p1.y);
    perimeter += Math.sqrt((p2.x - p1.x) ** 2 + (p2.y - p1.y) ** 2);
  }

  return {
    area: Math.abs(doubleArea) / 2,
    perimeter
  };
}

export function calculatePolygonRingsAreaAndPerimeter(rings: Coordinate[][]): { area: number; perimeter: number } {
  if (rings.length === 0) return { area: 0, perimeter: 0 };

  const [outer, ...holes] = rings;
  const outerStats = calculatePlanarPolygonAreaAndPerimeter(outer);
  const holesStats = holes.map(hole => calculatePlanarPolygonAreaAndPerimeter(hole));
  const holesArea = holesStats.reduce((sum, item) => sum + item.area, 0);
  const holesPerimeter = holesStats.reduce((sum, item) => sum + item.perimeter, 0);

  return {
    area: Math.max(outerStats.area - holesArea, 0),
    perimeter: outerStats.perimeter + holesPerimeter
  };
}

export function parseDeclaredLength(name: string): { text: string; m: number } {
  if (!name) return { text: '', m: 0 };
  const regex = /(\d+(?:[.,]\d+)?)\s*(m|meters|metros|km|kilometers|kilometros|quilometros|quilômetros)/gi;
  const match = regex.exec(name);
  if (!match) return { text: '', m: 0 };

  const value = parseFloat(match[1].replace(',', '.'));
  if (Number.isNaN(value)) return { text: '', m: 0 };
  return {
    text: match[0],
    m: match[2].toLowerCase().startsWith('k') ? value * 1000 : value
  };
}

export function parseKmlCoordinates(coordStr: string): Coordinate[] {
  if (!coordStr) return [];
  const coords: Coordinate[] = [];
  const tuples = coordStr.trim().split(/\s+/);

  for (const tuple of tuples) {
    const parts = tuple.split(',');
    if (parts.length < 2) continue;
    const lng = parseFloat(parts[0]);
    const lat = parseFloat(parts[1]);
    const alt = parts.length >= 3 ? parseFloat(parts[2]) : undefined;
    if (!Number.isNaN(lat) && !Number.isNaN(lng) && lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180) {
      coords.push({ lat, lng, alt: Number.isNaN(alt as number) ? undefined : alt });
    }
  }

  return coords;
}
