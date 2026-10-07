'use client';

import { useCallback, useEffect, useState } from 'react';
import { rallyGroupService } from '@/lib/realtime/RallyGroupService';
import type { ApiTrip } from '@/lib/api/types';
import * as tripsApi from '@/lib/api/trips';

/**
 * Provides access to the trip currently backing the active group.
 *
 * Reads the trip ID from RallyGroupService (the single source of truth for
 * the live trip) and exposes thin wrappers around the real REST endpoints
 * in lib/api/trips.ts so components never call those endpoints directly.
 *
 * - `tripId`     — the backend UUID of the current trip, or null.
 * - `trip`       — full ApiTrip object once loaded, null while loading / no trip.
 * - `loading`    — true while the initial fetch is in flight.
 * - `error`      — any error from the last operation.
 * - `startTrip`  — CREATED -> ACTIVE (leader only).
 * - `endTrip`    — ACTIVE  -> COMPLETED (leader only).
 * - `cancelTrip` — any non-terminal state -> CANCELLED (leader only).
 * - `refresh`    — re-fetch the trip from the backend.
 */
export function useTrip() {
  const tripId = rallyGroupService.getTripId();

  const [trip, setTrip] = useState<ApiTrip | null>(null);
  const [loading, setLoading] = useState(!!tripId);
  const [error, setError] = useState<Error | null>(null);

  const fetchTrip = useCallback(async (id: string) => {
    setLoading(true);
    setError(null);
    try {
      const data = await tripsApi.getTrip(id);
      setTrip(data);
    } catch (err) {
      setError(err instanceof Error ? err : new Error(String(err)));
    } finally {
      setLoading(false);
    }
  }, []);

  // Re-fetch whenever the tripId changes (group attached to a different trip).
  useEffect(() => {
    if (!tripId) {
      setTrip(null);
      setLoading(false);
      return;
    }
    void fetchTrip(tripId);
  }, [tripId, fetchTrip]);

  // Also listen to group updates so we pick up the new tripId after the
  // group service re-initialises (e.g. after joinGroup / createGroup).
  useEffect(() => {
    return rallyGroupService.subscribe(() => {
      const newTripId = rallyGroupService.getTripId();
      if (newTripId && newTripId !== trip?.id) {
        void fetchTrip(newTripId);
      }
    });
  }, [trip?.id, fetchTrip]);

  const startTrip = useCallback(async (coords?: { latitude: number; longitude: number }) => {
    if (!tripId) throw new Error('No current trip.');
    const updated = await tripsApi.startTrip(tripId, coords ? { latitude: coords.latitude, longitude: coords.longitude } : undefined);
    setTrip(updated);
    return updated;
  }, [tripId]);

  const endTrip = useCallback(async () => {
    if (!tripId) throw new Error('No current trip.');
    const updated = await tripsApi.endTrip(tripId);
    setTrip(updated);
    return updated;
  }, [tripId]);

  const cancelTrip = useCallback(async () => {
    if (!tripId) throw new Error('No current trip.');
    const updated = await tripsApi.cancelTrip(tripId);
    setTrip(updated);
    return updated;
  }, [tripId]);

  const refresh = useCallback(() => {
    if (tripId) void fetchTrip(tripId);
  }, [tripId, fetchTrip]);

  return {
    tripId,
    trip,
    loading,
    error,
    startTrip,
    endTrip,
    cancelTrip,
    refresh,
  };
}