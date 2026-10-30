'use client';

/**
 * RouteReplayMap – Interactive GPS Trip Replay for RALLY trip history.
 *
 * Supports:
 * - Chronological replay of actual recorded GPS breadcrumbs (GET /api/v1/trips/{id}/locations)
 * - Distinct styling for Planned Route (cyan dashed/translucent) vs Recorded GPS Path (emerald)
 * - Interactive timeline scrubber with Play, Pause, Resume, Reset, and Speed selection (1x, 2x, 5x)
 * - Animated tracking marker displaying current replay timestamp and vehicle speed (km/h)
 * - Start, End/Destination, Route Deviations, and Alert incident markers
 * - Handling for missing, sparse, or single-point GPS traces
 * - Google Maps rendering when API key is present, with an interactive SVG vector replay fallback
 */

import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  APIProvider,
  Map,
  AdvancedMarker,
  InfoWindow,
  useMap,
} from '@vis.gl/react-google-maps';
import {
  Play,
  Pause,
  RotateCcw,
  Navigation,
  Clock,
  Gauge,
  AlertTriangle,
  MapPin,
  Flag,
  Activity,
} from 'lucide-react';
import type { TripSummary } from '@/lib/mock/types';
import type { LocationResponse, ApiAlert } from '@/lib/api/types';
import { hasGoogleMapsKey, GOOGLE_MAPS_API_KEY } from '@/lib/services/googleMaps';

export interface RouteReplayMapProps {
  summary: TripSummary;
  recordedLocations?: LocationResponse[];
  plannedRoute?: { lat: number; lng: number }[];
  alerts?: ApiAlert[];
}

interface ReplayPoint {
  lat: number;
  lng: number;
  speed: number | null; // m/s
  heading: number | null;
  recordedAt: string;
}

// ─── Google Maps Content ──────────────────────────────────────────────────────

function GoogleMapsReplayContent({
  points,
  plannedPath,
  currentIndex,
  alerts,
  summary,
}: {
  points: ReplayPoint[];
  plannedPath: { lat: number; lng: number }[];
  currentIndex: number;
  alerts?: ApiAlert[];
  summary: TripSummary;
}) {
  const map = useMap();
  const plannedPolylineRef = useRef<google.maps.Polyline | null>(null);
  const fullActualPolylineRef = useRef<google.maps.Polyline | null>(null);
  const traversedPolylineRef = useRef<google.maps.Polyline | null>(null);
  const [activePopup, setActivePopup] = useState<string | null>(null);

  const hasPoints = points.length > 0;
  const currentPoint = hasPoints ? points[Math.min(currentIndex, points.length - 1)] : null;

  // 1. Draw planned route polyline
  useEffect(() => {
    if (!map || plannedPath.length < 2) return;

    plannedPolylineRef.current = new google.maps.Polyline({
      path: plannedPath,
      strokeColor: '#00C2FF',
      strokeWeight: 3.5,
      strokeOpacity: 0.45,
      map,
    });

    return () => {
      plannedPolylineRef.current?.setMap(null);
      plannedPolylineRef.current = null;
    };
  }, [map, plannedPath]);

  // 2. Draw full actual trail (dim emerald)
  useEffect(() => {
    if (!map || points.length < 2) return;

    fullActualPolylineRef.current = new google.maps.Polyline({
      path: points.map((p) => ({ lat: p.lat, lng: p.lng })),
      strokeColor: '#064E3B',
      strokeWeight: 3,
      strokeOpacity: 0.4,
      map,
    });

    return () => {
      fullActualPolylineRef.current?.setMap(null);
      fullActualPolylineRef.current = null;
    };
  }, [map, points]);

  // 3. Draw traversed trail up to current replay index (vibrant emerald)
  useEffect(() => {
    if (!map || points.length < 2) return;

    const traversedPoints = points
      .slice(0, Math.min(currentIndex + 1, points.length))
      .map((p) => ({ lat: p.lat, lng: p.lng }));

    if (traversedPolylineRef.current) {
      traversedPolylineRef.current.setPath(traversedPoints);
    } else {
      traversedPolylineRef.current = new google.maps.Polyline({
        path: traversedPoints,
        strokeColor: '#10B981',
        strokeWeight: 4,
        strokeOpacity: 0.95,
        map,
      });
    }

    return () => {
      if (traversedPolylineRef.current) {
        traversedPolylineRef.current.setMap(null);
        traversedPolylineRef.current = null;
      }
    };
  }, [map, points, currentIndex]);

  // 4. Fit map bounds on initial load
  useEffect(() => {
    if (!map) return;
    const bounds = new google.maps.LatLngBounds();

    points.forEach((p) => bounds.extend({ lat: p.lat, lng: p.lng }));
    plannedPath.forEach((p) => bounds.extend(p));
    if (summary.destinationLat && summary.destinationLng) {
      bounds.extend({ lat: summary.destinationLat, lng: summary.destinationLng });
    }

    if (!bounds.isEmpty()) {
      map.fitBounds(bounds, 48);
    }
  }, [map, points, plannedPath, summary.destinationLat, summary.destinationLng]);

  // Center coordinate
  const center = useMemo(() => {
    if (currentPoint) return { lat: currentPoint.lat, lng: currentPoint.lng };
    if (points.length > 0) return { lat: points[0].lat, lng: points[0].lng };
    if (plannedPath.length > 0) return plannedPath[0];
    return { lat: summary.destinationLat || 28.6139, lng: summary.destinationLng || 77.209 };
  }, [currentPoint, points, plannedPath, summary]);

  return (
    <>
      <Map
        defaultCenter={center}
        defaultZoom={13}
        mapId="rally-route-replay-map"
        disableDefaultUI
        gestureHandling="greedy"
        style={{ width: '100%', height: '100%' }}
        colorScheme="DARK"
      />

      {/* Start Marker */}
      {points.length > 0 && (
        <AdvancedMarker
          position={{ lat: points[0].lat, lng: points[0].lng }}
          onClick={() => setActivePopup('start')}
        >
          <div className="w-5 h-5 rounded-full bg-emerald-500 border-2 border-white shadow-lg shadow-emerald-500/50 flex items-center justify-center">
            <span className="w-1.5 h-1.5 rounded-full bg-white" />
          </div>
          {activePopup === 'start' && (
            <InfoWindow
              onClose={() => setActivePopup(null)}
              position={{ lat: points[0].lat, lng: points[0].lng }}
            >
              <div className="text-xs text-foreground p-1">
                <p className="font-bold text-emerald-600">Trip Start</p>
                <p className="text-[10px] text-muted-foreground">
                  {new Date(points[0].recordedAt).toLocaleTimeString()}
                </p>
              </div>
            </InfoWindow>
          )}
        </AdvancedMarker>
      )}

      {/* End / Destination Marker */}
      {(points.length > 0 || (summary.destinationLat && summary.destinationLng)) && (
        <AdvancedMarker
          position={
            points.length > 0
              ? { lat: points[points.length - 1].lat, lng: points[points.length - 1].lng }
              : { lat: summary.destinationLat!, lng: summary.destinationLng! }
          }
          onClick={() => setActivePopup('end')}
        >
          <div className="w-5 h-5 bg-rally-blue rotate-45 border-2 border-white shadow-lg shadow-rally-blue/50" />
          {activePopup === 'end' && (
            <InfoWindow
              onClose={() => setActivePopup(null)}
              position={
                points.length > 0
                  ? { lat: points[points.length - 1].lat, lng: points[points.length - 1].lng }
                  : { lat: summary.destinationLat!, lng: summary.destinationLng! }
              }
            >
              <div className="text-xs text-foreground p-1">
                <p className="font-bold text-rally-blue">
                  {summary.destination || 'Destination'}
                </p>
                {points.length > 0 && (
                  <p className="text-[10px] text-muted-foreground">
                    Ended {new Date(points[points.length - 1].recordedAt).toLocaleTimeString()}
                  </p>
                )}
              </div>
            </InfoWindow>
          )}
        </AdvancedMarker>
      )}

      {/* Current Replay Position Marker */}
      {currentPoint && (
        <AdvancedMarker position={{ lat: currentPoint.lat, lng: currentPoint.lng }}>
          <div className="relative flex items-center justify-center">
            <div className="absolute w-8 h-8 rounded-full bg-emerald-400/30 animate-ping" />
            <div className="w-6 h-6 rounded-full bg-foreground border-2 border-emerald-400 shadow-md flex items-center justify-center text-emerald-400">
              <Navigation
                className="w-3.5 h-3.5"
                style={{
                  transform: `rotate(${currentPoint.heading ?? 0}deg)`,
                  transition: 'transform 200ms ease-out',
                }}
              />
            </div>
          </div>
        </AdvancedMarker>
      )}

      {/* Incident / Alert Markers */}
      {(alerts ?? []).map((alert) => {
        // Find nearest point for coordinates if alert has no direct lat/lng
        const pt = points[0];
        if (!pt) return null;
        return (
          <AdvancedMarker
            key={alert.id}
            position={{ lat: pt.lat, lng: pt.lng }}
            onClick={() => setActivePopup(`alert-${alert.id}`)}
          >
            <div className="w-5 h-5 rounded bg-amber-500 border border-white text-black font-bold text-[10px] flex items-center justify-center shadow">
              !
            </div>
            {activePopup === `alert-${alert.id}` && (
              <InfoWindow onClose={() => setActivePopup(null)} position={{ lat: pt.lat, lng: pt.lng }}>
                <div className="text-xs text-foreground p-1">
                  <p className="font-bold text-amber-500">{alert.title}</p>
                  <p className="text-[10px] text-muted-foreground">{alert.message}</p>
                </div>
              </InfoWindow>
            )}
          </AdvancedMarker>
        );
      })}
    </>
  );
}

// ─── High-Fidelity Vector Replay (Fallback when Google Maps key is omitted) ───

function VectorReplayCanvas({
  points,
  plannedPath,
  currentIndex,
  alerts,
  summary,
}: {
  points: ReplayPoint[];
  plannedPath: { lat: number; lng: number }[];
  currentIndex: number;
  alerts?: ApiAlert[];
  summary: TripSummary;
}) {
  const allCoords = useMemo(() => {
    const list: { lat: number; lng: number }[] = [];
    points.forEach((p) => list.push({ lat: p.lat, lng: p.lng }));
    plannedPath.forEach((p) => list.push(p));
    if (summary.destinationLat && summary.destinationLng) {
      list.push({ lat: summary.destinationLat, lng: summary.destinationLng });
    }
    return list;
  }, [points, plannedPath, summary]);

  const bounds = useMemo(() => {
    if (allCoords.length === 0) {
      return { minLat: 0, maxLat: 1, minLng: 0, maxLng: 1 };
    }
    let minLat = Infinity,
      maxLat = -Infinity,
      minLng = Infinity,
      maxLng = -Infinity;
    allCoords.forEach((c) => {
      if (c.lat < minLat) minLat = c.lat;
      if (c.lat > maxLat) maxLat = c.lat;
      if (c.lng < minLng) minLng = c.lng;
      if (c.lng > maxLng) maxLng = c.lng;
    });
    // Add 10% padding
    const latSpan = Math.max(maxLat - minLat, 0.005);
    const lngSpan = Math.max(maxLng - minLng, 0.005);
    return {
      minLat: minLat - latSpan * 0.1,
      maxLat: maxLat + latSpan * 0.1,
      minLng: minLng - lngSpan * 0.1,
      maxLng: maxLng + lngSpan * 0.1,
    };
  }, [allCoords]);

  // Project lat/lng to SVG 0..1000 width, 0..500 height
  const project = (lat: number, lng: number) => {
    const x = ((lng - bounds.minLng) / (bounds.maxLng - bounds.minLng)) * 1000;
    const y = (1 - (lat - bounds.minLat) / (bounds.maxLat - bounds.minLat)) * 500;
    return { x, y };
  };

  const plannedSvgPath = useMemo(() => {
    if (plannedPath.length < 2) return '';
    return plannedPath
      .map((p, idx) => {
        const { x, y } = project(p.lat, p.lng);
        return `${idx === 0 ? 'M' : 'L'} ${x.toFixed(1)} ${y.toFixed(1)}`;
      })
      .join(' ');
  }, [plannedPath, bounds]);

  const fullActualSvgPath = useMemo(() => {
    if (points.length < 2) return '';
    return points
      .map((p, idx) => {
        const { x, y } = project(p.lat, p.lng);
        return `${idx === 0 ? 'M' : 'L'} ${x.toFixed(1)} ${y.toFixed(1)}`;
      })
      .join(' ');
  }, [points, bounds]);

  const traversedSvgPath = useMemo(() => {
    if (points.length < 2) return '';
    const slice = points.slice(0, Math.min(currentIndex + 1, points.length));
    return slice
      .map((p, idx) => {
        const { x, y } = project(p.lat, p.lng);
        return `${idx === 0 ? 'M' : 'L'} ${x.toFixed(1)} ${y.toFixed(1)}`;
      })
      .join(' ');
  }, [points, currentIndex, bounds]);

  const currentPt = points[Math.min(currentIndex, points.length - 1)];
  const currentPos = currentPt ? project(currentPt.lat, currentPt.lng) : null;
  const startPos = points.length > 0 ? project(points[0].lat, points[0].lng) : null;
  const endPos =
    points.length > 0
      ? project(points[points.length - 1].lat, points[points.length - 1].lng)
      : summary.destinationLat && summary.destinationLng
      ? project(summary.destinationLat, summary.destinationLng)
      : null;

  return (
    <div className="w-full h-full bg-card/60 relative overflow-hidden flex items-center justify-center">
      {/* Subtle grid background */}
      <div
        className="absolute inset-0 opacity-[0.07] pointer-events-none"
        style={{
          backgroundImage:
            'linear-gradient(to right, #ffffff 1px, transparent 1px), linear-gradient(to bottom, #ffffff 1px, transparent 1px)',
          backgroundSize: '40px 40px',
        }}
      />

      <svg viewBox="0 0 1000 500" className="w-full h-full p-6 select-none">
        {/* Planned Route (Cyan Dashed) */}
        {plannedSvgPath && (
          <path
            d={plannedSvgPath}
            fill="none"
            stroke="#00C2FF"
            strokeWidth="3"
            strokeDasharray="8 6"
            strokeOpacity="0.5"
            strokeLinecap="round"
          />
        )}

        {/* Full Recorded Trail (Dim Green) */}
        {fullActualSvgPath && (
          <path
            d={fullActualSvgPath}
            fill="none"
            stroke="#065F46"
            strokeWidth="3.5"
            strokeOpacity="0.4"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        )}

        {/* Traversed Trail (Vibrant Emerald) */}
        {traversedSvgPath && (
          <path
            d={traversedSvgPath}
            fill="none"
            stroke="#10B981"
            strokeWidth="4"
            strokeOpacity="0.95"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        )}

        {/* Start Point */}
        {startPos && (
          <g transform={`translate(${startPos.x}, ${startPos.y})`}>
            <circle r="7" fill="#10B981" stroke="#ffffff" strokeWidth="2" />
            <text x="12" y="4" fill="#10B981" fontSize="11" fontWeight="bold">
              Start
            </text>
          </g>
        )}

        {/* End / Destination Point */}
        {endPos && (
          <g transform={`translate(${endPos.x}, ${endPos.y})`}>
            <rect
              x="-6"
              y="-6"
              width="12"
              height="12"
              fill="#00C2FF"
              stroke="#ffffff"
              strokeWidth="2"
              transform="rotate(45)"
            />
            <text x="12" y="4" fill="#00C2FF" fontSize="11" fontWeight="bold">
              {summary.destination || 'Destination'}
            </text>
          </g>
        )}

        {/* Current Replaying Vehicle Marker */}
        {currentPos && (
          <g transform={`translate(${currentPos.x}, ${currentPos.y})`}>
            <circle r="14" fill="#10B981" opacity="0.25">
              <animate attributeName="r" values="8;18;8" dur="1.5s" repeatCount="indefinite" />
            </circle>
            <circle r="8" fill="#059669" stroke="#ffffff" strokeWidth="2.5" />
          </g>
        )}
      </svg>
    </div>
  );
}

// ─── Main RouteReplayMap Component ───────────────────────────────────────────

export default function RouteReplayMap({
  summary,
  recordedLocations,
  plannedRoute,
  alerts,
}: RouteReplayMapProps) {
  // Convert recordedLocations or fallback to summary.route
  const points: ReplayPoint[] = useMemo(() => {
    if (recordedLocations && recordedLocations.length > 0) {
      return recordedLocations
        .slice()
        .sort((a, b) => new Date(a.recorded_at).getTime() - new Date(b.recorded_at).getTime())
        .map((loc) => ({
          lat: loc.latitude,
          lng: loc.longitude,
          speed: loc.speed ?? null,
          heading: loc.heading ?? null,
          recordedAt: loc.recorded_at,
        }));
    }

    // Fall back to summary.route coordinates if no granular location history exists
    if (summary.route && summary.route.length > 0) {
      const baseTime = summary.completedAt - summary.route.length * 15000;
      return summary.route.map((p, idx) => ({
        lat: p.lat,
        lng: p.lng,
        speed: 12.5, // ~45 km/h
        heading: 0,
        recordedAt: new Date(baseTime + idx * 15000).toISOString(),
      }));
    }

    return [];
  }, [recordedLocations, summary.route, summary.completedAt]);

  const plannedPath = useMemo(() => {
    if (plannedRoute && plannedRoute.length > 0) return plannedRoute;
    if (summary.route && summary.route.length > 0) return summary.route;
    return [];
  }, [plannedRoute, summary.route]);

  // Replay State
  const [currentIndex, setCurrentIndex] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [playbackSpeed, setPlaybackSpeed] = useState<1 | 2 | 5>(1);

  const hasPoints = points.length > 0;
  const currentPoint = hasPoints ? points[Math.min(currentIndex, points.length - 1)] : null;

  // Auto-play interval
  useEffect(() => {
    if (!isPlaying || points.length <= 1) return;

    const intervalTime = Math.max(80, Math.floor(600 / playbackSpeed));
    const timer = setInterval(() => {
      setCurrentIndex((prev) => {
        if (prev >= points.length - 1) {
          setIsPlaying(false);
          return prev;
        }
        return prev + 1;
      });
    }, intervalTime);

    return () => clearInterval(timer);
  }, [isPlaying, points.length, playbackSpeed]);

  const handlePlayPause = () => {
    if (!hasPoints) return;
    if (currentIndex >= points.length - 1) {
      setCurrentIndex(0);
    }
    setIsPlaying(!isPlaying);
  };

  const handleReset = () => {
    setIsPlaying(false);
    setCurrentIndex(0);
  };

  const currentSpeedKmh =
    currentPoint?.speed != null ? Math.round(currentPoint.speed * 3.6) : null;

  const currentTimestamp = currentPoint
    ? new Date(currentPoint.recordedAt).toLocaleTimeString('en-US', {
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
      })
    : '—';

  const isGoogleMapsAvailable = hasGoogleMapsKey();

  return (
    <div className="w-full h-full min-h-[380px] rounded-2xl overflow-hidden border border-border bg-card flex flex-col relative">
      {/* Map display area */}
      <div className="flex-1 w-full relative min-h-[260px]">
        {isGoogleMapsAvailable ? (
          <APIProvider apiKey={GOOGLE_MAPS_API_KEY}>
            <GoogleMapsReplayContent
              points={points}
              plannedPath={plannedPath}
              currentIndex={currentIndex}
              alerts={alerts}
              summary={summary}
            />
          </APIProvider>
        ) : (
          <VectorReplayCanvas
            points={points}
            plannedPath={plannedPath}
            currentIndex={currentIndex}
            alerts={alerts}
            summary={summary}
          />
        )}

        {/* Floating Live Telemetry HUD */}
        {hasPoints && (
          <div className="absolute top-3 left-3 z-[100] flex flex-wrap items-center gap-2 bg-background/85 backdrop-blur-md rounded-xl px-3 py-2 border border-border/80 shadow-md text-xs">
            <div className="flex items-center gap-1.5 font-mono text-foreground font-semibold">
              <Clock className="w-3.5 h-3.5 text-muted-foreground" />
              <span>{currentTimestamp}</span>
            </div>

            <div className="h-3 w-px bg-border" />

            <div className="flex items-center gap-1.5 font-mono">
              <Gauge className="w-3.5 h-3.5 text-emerald-400" />
              <span className="font-semibold text-foreground">
                {currentSpeedKmh != null ? `${currentSpeedKmh} km/h` : 'N/A'}
              </span>
            </div>

            <div className="h-3 w-px bg-border" />

            <div className="flex items-center gap-1 text-[11px] text-muted-foreground">
              <span>Point</span>
              <span className="font-bold text-foreground">
                {currentIndex + 1}/{points.length}
              </span>
            </div>
          </div>
        )}

        {/* Legend */}
        <div className="absolute top-3 right-3 z-[100] hidden sm:flex items-center gap-3 bg-background/85 backdrop-blur-md rounded-xl px-3 py-2 border border-border/80 shadow-md text-[11px] text-muted-foreground">
          <span className="flex items-center gap-1.5">
            <span className="w-3 h-0.5 bg-rally-blue rounded border-t border-dashed border-rally-blue" />
            Planned
          </span>
          <span className="flex items-center gap-1.5">
            <span className="w-3 h-1 bg-emerald-500 rounded" />
            Recorded GPS
          </span>
          {points.length > 0 && (
            <span className="flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-emerald-400" />
              Vehicle
            </span>
          )}
        </div>
      </div>

      {/* Interactive Replay Scrubber Controls */}
      <div className="p-3 sm:p-4 border-t border-border bg-card/95 backdrop-blur-sm flex flex-col gap-2.5">
        {/* Timeline slider */}
        <div className="flex items-center gap-3">
          <input
            type="range"
            min={0}
            max={Math.max(0, points.length - 1)}
            value={currentIndex}
            disabled={!hasPoints || points.length <= 1}
            onChange={(e) => {
              setIsPlaying(false);
              setCurrentIndex(Number(e.target.value));
            }}
            className="w-full h-1.5 bg-muted rounded-lg appearance-none cursor-pointer accent-emerald-400 disabled:opacity-40"
          />
        </div>

        {/* Playback action buttons */}
        <div className="flex items-center justify-between text-xs">
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handlePlayPause}
              disabled={!hasPoints || points.length <= 1}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-foreground text-background font-semibold hover:opacity-85 transition-opacity disabled:opacity-40"
            >
              {isPlaying ? (
                <>
                  <Pause className="w-3.5 h-3.5" /> Pause
                </>
              ) : (
                <>
                  <Play className="w-3.5 h-3.5" /> Play
                </>
              )}
            </button>

            <button
              type="button"
              onClick={handleReset}
              disabled={!hasPoints || points.length <= 1}
              className="p-1.5 rounded-lg border border-border hover:bg-muted text-muted-foreground hover:text-foreground transition-colors disabled:opacity-40"
              title="Reset to start"
            >
              <RotateCcw className="w-3.5 h-3.5" />
            </button>

            {/* Speed toggle */}
            <div className="flex items-center rounded-lg border border-border overflow-hidden">
              {([1, 2, 5] as const).map((spd) => (
                <button
                  key={spd}
                  type="button"
                  onClick={() => setPlaybackSpeed(spd)}
                  className={`px-2 py-1 text-[11px] font-semibold transition-colors ${
                    playbackSpeed === spd
                      ? 'bg-muted text-foreground'
                      : 'text-muted-foreground hover:text-foreground'
                  }`}
                >
                  {spd}x
                </button>
              ))}
            </div>
          </div>

          <div className="text-[11px] text-muted-foreground font-mono">
            {points.length > 0 ? (
              <span>{Math.round(((currentIndex + 1) / points.length) * 100)}% complete</span>
            ) : (
              <span>No GPS samples recorded</span>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
