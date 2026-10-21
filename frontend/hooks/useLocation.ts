import { useState, useEffect, useCallback, useRef } from 'react';
import type { LocationData, LocationQuality } from '../types/location';
import { rallyGroupServiceLocation } from '@/lib/realtime/RallyGroupService';

export function useLocation(autoStart: boolean = true) {
  const [location, setLocation] = useState<LocationData | null>(null);
  const [isTracking, setIsTracking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [permissionState, setPermissionState] = useState<PermissionState | 'unsupported' | 'unknown'>('unknown');
  const watchIdRef = useRef<number | null>(null);
  const isTrackingRef = useRef(false);

  // Check initial permissions if supported
  useEffect(() => {
    let active = true;
    let statusRef: PermissionStatus | null = null;

    if (typeof window !== 'undefined' && 'navigator' in window && 'permissions' in navigator) {
      navigator.permissions.query({ name: 'geolocation' }).then((status) => {
        if (!active) return;
        statusRef = status;
        setPermissionState(status.state);
        status.onchange = () => {
          if (active) setPermissionState(status.state);
        };
      }).catch(() => {
        // Fallback for browsers that don't support permission query for geolocation
      });
    } else if (typeof window !== 'undefined' && !('geolocation' in navigator)) {
      setPermissionState('unsupported');
    }

    return () => {
      active = false;
      if (statusRef) statusRef.onchange = null;
    };
  }, []);

  const startTracking = useCallback(() => {
    if (typeof window === 'undefined' || !('geolocation' in navigator)) {
      setError('Your browser does not support location services required by RALLY.');
      setPermissionState('unsupported');
      return;
    }

    if (isTrackingRef.current) return;

    setError(null);
    isTrackingRef.current = true;
    setIsTracking(true);

    const id = navigator.geolocation.watchPosition(
      (position) => {
        const { latitude, longitude, accuracy, speed, heading } = position.coords;

        // Validation: reject out of bounds or invalid numbers
        if (
          typeof latitude !== 'number' ||
          typeof longitude !== 'number' ||
          isNaN(latitude) ||
          isNaN(longitude) ||
          latitude < -90 ||
          latitude > 90 ||
          longitude < -180 ||
          longitude > 180 ||
          (latitude === 0 && longitude === 0)
        ) {
          return; // Ignore invalid coordinates
        }

        const payload: LocationData = {
          latitude,
          longitude,
          accuracy,
          speed,
          heading,
          timestamp: position.timestamp,
        };

        setLocation(payload);
        setPermissionState('granted');

        try {
          rallyGroupServiceLocation.sendLocationUpdate({
            latitude,
            longitude,
            accuracy: accuracy ?? null,
            speed: speed ?? null,
            heading: heading ?? null,
            recorded_at: new Date(position.timestamp).toISOString(),
            timestamp: position.timestamp,
          });
        } catch {
          // Socket might be disconnected or not initialized yet; handled gracefully
        }
      },
      (err) => {
        isTrackingRef.current = false;
        setIsTracking(false);
        if (watchIdRef.current !== null && typeof window !== 'undefined' && 'geolocation' in navigator) {
          navigator.geolocation.clearWatch(watchIdRef.current);
          watchIdRef.current = null;
        }

        switch (err.code) {
          case err.PERMISSION_DENIED:
            setError('Location permission is required for RALLY location features. Please enable it in your browser settings.');
            setPermissionState('denied');
            break;
          case err.POSITION_UNAVAILABLE:
            setError('GPS signal unavailable. Please check your device location settings.');
            break;
          case err.TIMEOUT:
            setError('Location request timed out. Trying again...');
            break;
          default:
            setError('An unknown error occurred while acquiring location.');
        }
      },
      {
        enableHighAccuracy: true,
        maximumAge: 0,
        timeout: 15000,
      }
    );

    watchIdRef.current = id;
  }, []);

  const stopTracking = useCallback(() => {
    if (watchIdRef.current !== null && typeof window !== 'undefined' && 'geolocation' in navigator) {
      navigator.geolocation.clearWatch(watchIdRef.current);
      watchIdRef.current = null;
    }
    isTrackingRef.current = false;
    setIsTracking(false);
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (watchIdRef.current !== null && typeof window !== 'undefined' && 'geolocation' in navigator) {
        navigator.geolocation.clearWatch(watchIdRef.current);
        watchIdRef.current = null;
      }
    };
  }, []);

  return {
    location,
    isTracking,
    error,
    permissionState,
    startTracking,
    stopTracking,
  };
}

export function getLocationQuality(accuracy: number | undefined): LocationQuality {
  if (!accuracy) return 'Poor';
  if (accuracy <= 15) return 'Excellent';
  if (accuracy <= 50) return 'Good';
  if (accuracy <= 100) return 'Fair';
  return 'Poor';
}
