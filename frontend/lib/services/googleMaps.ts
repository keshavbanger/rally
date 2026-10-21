/**
 * Google Maps Platform utilities for RALLY.
 *
 * APIs used:
 *  - Maps JavaScript API  → map tiles & markers (loaded via @vis.gl/react-google-maps)
 *  - Places API (New)     → destination autocomplete (loaded via @vis.gl/react-google-maps usePlacesAutocomplete)
 *  - Routes API           → route calculation (HTTP REST, server-side-safe endpoint)
 *
 * Cost notes (as of 2025):
 *  - Maps JS API: $7 / 1 000 Dynamic Map loads (200 USD monthly free credit covers ~28 000 loads)
 *  - Places Autocomplete: $2.83 / 1 000 requests (per-session billing recommended)
 *  - Routes API:           $5 / 1 000 route calculations
 *
 * Always restrict your API key to allowed HTTP referrers and only the APIs
 * you actually need to minimise accidental charges.
 */

export const GOOGLE_MAPS_API_KEY =
  process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY ?? '';

/** Returns true when a non-empty key is present. */
export function hasGoogleMapsKey(): boolean {
  return GOOGLE_MAPS_API_KEY.length > 0;
}

/** Throws a clear, user-readable error if the key is missing. */
export function requireGoogleMapsKey(): string {
  if (!hasGoogleMapsKey()) {
    throw new Error(
      'Google Maps API key is not configured. ' +
        'Add NEXT_PUBLIC_GOOGLE_MAPS_API_KEY to frontend/.env.local and restart the dev server.'
    );
  }
  return GOOGLE_MAPS_API_KEY;
}

// ─── Routes API ─────────────────────────────────────────────────────────────

export interface LatLng {
  lat: number;
  lng: number;
}

export interface RouteOption {
  id: string;
  coordinates: LatLng[];
  distance: number;   // metres
  duration: number;   // seconds
  summary: string;
  isRecommended: boolean;
}

/**
 * Calculate driving routes via the Google Routes API (REST).
 * Returns up to 3 route alternatives sorted by duration.
 *
 * @throws if the key is missing, the API returns an error, or no routes are found.
 */
export async function calculateGoogleRoute(
  origin: LatLng,
  destination: LatLng,
  intermediates?: LatLng[]
): Promise<RouteOption[]> {
  requireGoogleMapsKey();

  const body: any = {
    origin:      { location: { latLng: { latitude: origin.lat,      longitude: origin.lng      } } },
    destination: { location: { latLng: { latitude: destination.lat, longitude: destination.lng } } },
    travelMode:  'DRIVE',
    computeAlternativeRoutes: true,
    routeModifiers: { avoidTolls: false, avoidHighways: false },
    polylineEncoding: 'ENCODED_POLYLINE',
  };

  if (intermediates && intermediates.length > 0) {
    body.intermediates = intermediates.map((p) => ({
      location: { latLng: { latitude: p.lat, longitude: p.lng } },
    }));
  }

  const res = await fetch(
    'https://routes.googleapis.com/directions/v2:computeRoutes',
    {
      method:  'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': GOOGLE_MAPS_API_KEY,
        // Request only the fields we actually use (keeps cost down)
        'X-Goog-FieldMask':
          'routes.duration,routes.distanceMeters,routes.description,routes.polyline.encodedPolyline',
      },
      body: JSON.stringify(body),
    }
  );

  if (!res.ok) {
    let detail = '';
    try { detail = (await res.json()).error?.message ?? ''; } catch { /* ignore */ }
    if (res.status === 403 || res.status === 401) {
      throw new Error(`Google Routes API: permission denied (${res.status}). Check that Routes API is enabled in your Google Cloud project and the key is not restricted away from this domain. ${detail}`);
    }
    if (res.status === 429) {
      throw new Error('Google Routes API: quota exceeded. Check your Google Cloud console.');
    }
    throw new Error(`Google Routes API error ${res.status}: ${detail || res.statusText}`);
  }

  const data = await res.json();
  const routes: any[] = data.routes ?? [];

  if (routes.length === 0) {
    throw new Error('No driveable route found between these locations.');
  }

  const options: RouteOption[] = routes.map((r: any, i: number) => ({
    id:            `route-${i}`,
    coordinates:   decodePolyline(r.polyline?.encodedPolyline ?? ''),
    distance:      r.distanceMeters ?? 0,
    duration:      parseDurationSeconds(r.duration ?? '0s'),
    summary:       r.description ?? `Route ${i + 1}`,
    isRecommended: false,
  }));

  // Mark the fastest route as recommended
  let fastestIdx = 0;
  options.forEach((o, i) => { if (o.duration < options[fastestIdx].duration) fastestIdx = i; });
  options[fastestIdx].isRecommended = true;

  return options;
}

// ─── Polyline decoder ────────────────────────────────────────────────────────

/**
 * Decode a Google Maps encoded polyline string into an array of {lat,lng}.
 * Reference: https://developers.google.com/maps/documentation/utilities/polylinealgorithm
 */
function decodePolyline(encoded: string): LatLng[] {
  const points: LatLng[] = [];
  let index = 0;
  let lat = 0;
  let lng = 0;

  while (index < encoded.length) {
    let b: number;
    let shift = 0;
    let result = 0;
    do {
      b = encoded.charCodeAt(index++) - 63;
      result |= (b & 0x1f) << shift;
      shift += 5;
    } while (b >= 0x20);
    const dlat = (result & 1) !== 0 ? ~(result >> 1) : result >> 1;
    lat += dlat;

    shift = 0;
    result = 0;
    do {
      b = encoded.charCodeAt(index++) - 63;
      result |= (b & 0x1f) << shift;
      shift += 5;
    } while (b >= 0x20);
    const dlng = (result & 1) !== 0 ? ~(result >> 1) : result >> 1;
    lng += dlng;

    points.push({ lat: lat / 1e5, lng: lng / 1e5 });
  }

  return points;
}

/** Parse a Google duration string like "3600s" → 3600 */
function parseDurationSeconds(s: string): number {
  return parseInt(s.replace('s', ''), 10) || 0;
}
