/**
 * RALLY Destination search service.
 *
 * Strategy:
 *  1. If NEXT_PUBLIC_GOOGLE_MAPS_API_KEY is set → Google Places API (New) Text Search.
 *  2. Fallback → Nominatim / OpenStreetMap (free, no key needed).
 *
 * The Destination shape is identical so existing callers work without change.
 */

import { hasGoogleMapsKey, GOOGLE_MAPS_API_KEY } from './googleMaps';

export interface Destination {
  name: string;
  latitude: number;
  longitude: number;
  placeId?: string; // Google Places ID when available
}

export async function searchDestination(query: string): Promise<Destination[]> {
  if (!query.trim()) return [];

  if (hasGoogleMapsKey()) {
    try {
      return await searchWithGooglePlaces(query);
    } catch (err: any) {
      console.warn('[geocoding] Google Places failed, falling back to Nominatim:', err.message);
    }
  }

  return searchWithNominatim(query);
}

// ── Google Places API (New) – Text Search ─────────────────────────────────

async function searchWithGooglePlaces(query: string): Promise<Destination[]> {
  const res = await fetch(
    'https://places.googleapis.com/v1/places:searchText',
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': GOOGLE_MAPS_API_KEY,
        // Only request fields we render — minimises cost
        'X-Goog-FieldMask': 'places.id,places.displayName,places.formattedAddress,places.location',
      },
      body: JSON.stringify({
        textQuery:    query,
        maxResultCount: 5,
        languageCode: 'en',
      }),
    }
  );

  if (!res.ok) {
    const detail = await res.json().then((d: any) => d.error?.message ?? '').catch(() => '');
    if (res.status === 403 || res.status === 401) {
      throw new Error(
        `Google Places API: permission denied (${res.status}). ` +
        `Ensure "Places API (New)" is enabled in your Google Cloud project. ${detail}`
      );
    }
    if (res.status === 429) throw new Error('Google Places API: quota exceeded.');
    throw new Error(`Google Places API error ${res.status}: ${detail || res.statusText}`);
  }

  const data = await res.json();
  return (data.places ?? []).map((p: any): Destination => ({
    name:      p.formattedAddress || p.displayName?.text || 'Unknown place',
    latitude:  p.location?.latitude  ?? 0,
    longitude: p.location?.longitude ?? 0,
    placeId:   p.id,
  }));
}

// ── Nominatim / OpenStreetMap (fallback) ─────────────────────────────────────

async function searchWithNominatim(query: string): Promise<Destination[]> {
  const url = `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(query)}&limit=5`;

  const res = await fetch(url, { headers: { 'Accept-Language': 'en' } });
  if (!res.ok) throw new Error('Geocoding service unavailable');

  const data = await res.json();
  return data.map((item: any): Destination => ({
    name:      item.display_name,
    latitude:  parseFloat(item.lat),
    longitude: parseFloat(item.lon),
  }));
}
