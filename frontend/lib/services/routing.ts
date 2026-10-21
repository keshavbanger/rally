/**
 * RALLY Route calculation service.
 *
 * Strategy:
 *  1. If NEXT_PUBLIC_GOOGLE_MAPS_API_KEY is set → Google Routes API (REST).
 *  2. Fallback → OSRM public demo server (free, no key needed).
 *
 * The RouteOption shape is identical regardless of which backend is used so
 * all existing callers (route/page.tsx, groupService.setTripRoute, etc.)
 * continue to work without change.
 */

import { hasGoogleMapsKey, calculateGoogleRoute } from './googleMaps';

export interface RouteOption {
  id: string;
  coordinates: { lat: number; lng: number }[];
  distance: number; // metres
  duration: number; // seconds
  summary: string;
  isRecommended: boolean;
}

export async function calculateRoute(
  start: { lat: number; lng: number },
  destination: { lat: number; lng: number },
  intermediates?: { lat: number; lng: number }[]
): Promise<RouteOption[]> {
  // Validate coordinates
  if (
    start.lat < -90 || start.lat > 90 || start.lng < -180 || start.lng > 180 ||
    destination.lat < -90 || destination.lat > 90 ||
    destination.lng < -180 || destination.lng > 180
  ) {
    throw new Error('Invalid coordinates provided');
  }

  if (intermediates) {
    for (const pt of intermediates) {
      if (pt.lat < -90 || pt.lat > 90 || pt.lng < -180 || pt.lng > 180) {
        throw new Error('Invalid waypoint coordinates provided');
      }
    }
  }

  // ── Google Routes API (preferred) ─────────────────────────────────────────
  if (hasGoogleMapsKey()) {
    try {
      return await calculateGoogleRoute(start, destination, intermediates);
    } catch (err: any) {
      console.warn('[routing] Google Routes API failed, falling back to OSRM:', err.message);
      // Fall through to OSRM
    }
  }

  // ── OSRM public demo server (fallback / no key) ────────────────────────────
  return calculateOsrmRoute(start, destination, intermediates);
}

async function calculateOsrmRoute(
  start: { lat: number; lng: number },
  destination: { lat: number; lng: number },
  intermediates?: { lat: number; lng: number }[]
): Promise<RouteOption[]> {
  const points = [start, ...(intermediates || []), destination];
  const coordStr = points.map((p) => `${p.lng},${p.lat}`).join(';');
  const url =
    `https://router.project-osrm.org/route/v1/driving/${coordStr}` +
    `?overview=full&geometries=geojson&alternatives=true`;

  const res = await fetch(url);
  if (!res.ok) throw new Error('Routing service unavailable');

  const data = await res.json();
  if (data.code !== 'Ok' || !data.routes?.length) {
    throw new Error('No route available');
  }

  const options: RouteOption[] = data.routes.map((route: any, index: number) => ({
    id: `route-${index}`,
    coordinates: route.geometry.coordinates.map((coord: number[]) => ({
      lat: coord[1],
      lng: coord[0],
    })),
    distance: route.distance,
    duration: route.duration,
    summary: route.legs?.[0]?.summary || `Route ${index + 1}`,
    isRecommended: false,
  }));

  let fastestIdx = 0;
  options.forEach((o, i) => { if (o.duration < options[fastestIdx].duration) fastestIdx = i; });
  options[fastestIdx].isRecommended = true;

  return options;
}
