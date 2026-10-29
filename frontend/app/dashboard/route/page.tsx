'use client';

import { useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import {
  Search, Map as MapIcon, Loader2, Navigation, AlertTriangle,
  ArrowRight, Edit2, Check, Plus, X, GripVertical, ChevronDown, ChevronUp,
  MapPin, Flag, Circle
} from 'lucide-react';
import Topbar from '@/components/dashboard/Topbar';
import RequireGroup from '@/components/dashboard/RequireGroup';
import LiveMap from '@/components/map/LiveMap';
import { searchDestination, Destination } from '@/lib/services/geocoding';
import { calculateRoute, RouteOption } from '@/lib/services/routing';
import { groupService } from '@/lib/group/groupService';

// ─── Types ───────────────────────────────────────────────────────────────────

interface Waypoint {
  id: string;
  dest: Destination;
}

// ─── Device location hook ─────────────────────────────────────────────────────

function useDeviceLocation() {
  const [loc, setLoc] = useState<{ lat: number; lng: number } | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    if (!('geolocation' in navigator)) {
      setLoc({ lat: 19.076, lng: 72.8777 });
      setError(true);
      return;
    }

    let fallbackTimer = setTimeout(() => {
      if (!loc) {
        setLoc({ lat: 19.076, lng: 72.8777 });
        setError(true);
      }
    }, 4000);

    navigator.geolocation.getCurrentPosition(
      (pos) => {
        clearTimeout(fallbackTimer);
        setLoc({ lat: pos.coords.latitude, lng: pos.coords.longitude });
        setError(false);
      },
      () => {
        clearTimeout(fallbackTimer);
        setLoc({ lat: 19.076, lng: 72.8777 });
        setError(true);
      },
      { enableHighAccuracy: true, timeout: 5000 }
    );

    return () => clearTimeout(fallbackTimer);
  }, []);

  return { loc, error };
}

// ─── Search input for a single stop ─────────────────────────────────────────

function StopSearchInput({
  placeholder,
  onSelect,
  disabled,
  value,
  onClear,
}: {
  placeholder: string;
  onSelect: (d: Destination) => void;
  disabled?: boolean;
  value?: string;
  onClear?: () => void;
}) {
  const [query, setQuery] = useState(value ?? '');
  const [suggestions, setSuggestions] = useState<Destination[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (value !== undefined) setQuery(value);
  }, [value]);

  useEffect(() => {
    if (!query.trim() || disabled) {
      setSuggestions([]);
      return;
    }
    const delay = setTimeout(async () => {
      setIsSearching(true);
      try {
        const results = await searchDestination(query);
        setSuggestions(results);
      } catch {
        /* ignore */
      } finally {
        setIsSearching(false);
      }
    }, 400);
    return () => clearTimeout(delay);
  }, [query, disabled]);

  const handleSelect = (d: Destination) => {
    setQuery(d.name);
    setSuggestions([]);
    onSelect(d);
  };

  return (
    <div className="relative">
      <input
        ref={inputRef}
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && suggestions.length > 0) handleSelect(suggestions[0]);
        }}
        placeholder={placeholder}
        disabled={disabled}
        className="w-full bg-card border border-border rounded-xl pl-4 pr-10 py-3 text-sm text-foreground focus:outline-none focus:border-rally-blue transition-colors disabled:opacity-60"
      />
      {/* Clear / loading indicator */}
      <div className="absolute inset-y-0 right-3 flex items-center gap-1.5">
        {isSearching && <Loader2 className="w-3.5 h-3.5 animate-spin text-muted-foreground" />}
        {onClear && query && !isSearching && (
          <button
            onClick={() => {
              setQuery('');
              setSuggestions([]);
              onClear();
            }}
            className="text-muted-foreground hover:text-foreground transition-colors"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        )}
      </div>

      {suggestions.length > 0 && (
        <div className="absolute top-full mt-2 left-0 right-0 z-50 bg-card border border-border rounded-xl shadow-2xl overflow-hidden max-h-52 overflow-y-auto">
          {suggestions.map((s, i) => (
            <button
              key={i}
              onClick={() => handleSelect(s)}
              className="w-full text-left px-4 py-3 text-sm hover:bg-white/5 border-b border-border/50 last:border-0 flex items-start gap-3"
            >
              <MapIcon className="w-4 h-4 text-muted-foreground shrink-0 mt-0.5" />
              <span className="truncate">{s.name}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function RoutePage() {
  const router = useRouter();
  const { loc: deviceLoc, error: locError } = useDeviceLocation();

  // The fixed final destination
  const [destination, setDestination] = useState<Destination | null>(null);
  const [destQuery, setDestQuery] = useState('');

  // Intermediate waypoints (stops)
  const [waypoints, setWaypoints] = useState<Waypoint[]>([]);

  // Route calculation
  const [isCalculating, setIsCalculating] = useState(false);
  const [routeError, setRouteError] = useState<string | null>(null);
  const [routeAlternatives, setRouteAlternatives] = useState<RouteOption[]>([]);
  const [selectedRouteId, setSelectedRouteId] = useState<string | null>(null);

  // UI
  const [showAddStop, setShowAddStop] = useState(false);

  // ── helpers ──

  const addWaypoint = (dest: Destination) => {
    setWaypoints((prev) => [
      ...prev,
      { id: `wp-${Date.now()}`, dest },
    ]);
    setShowAddStop(false);
  };

  const removeWaypoint = (id: string) => {
    setWaypoints((prev) => prev.filter((w) => w.id !== id));
    // Reset routes if order changed
    setRouteAlternatives([]);
    setSelectedRouteId(null);
  };

  const moveWaypoint = (id: string, dir: 'up' | 'down') => {
    setWaypoints((prev) => {
      const idx = prev.findIndex((w) => w.id === id);
      if (idx < 0) return prev;
      const next = [...prev];
      const swap = dir === 'up' ? idx - 1 : idx + 1;
      if (swap < 0 || swap >= next.length) return prev;
      [next[idx], next[swap]] = [next[swap], next[idx]];
      return next;
    });
    setRouteAlternatives([]);
    setSelectedRouteId(null);
  };

  const handlePlanRoute = async () => {
    if (!deviceLoc) {
      setRouteError('Current location is unavailable.');
      return;
    }
    if (!destination) return;

    setIsCalculating(true);
    setRouteError(null);
    setRouteAlternatives([]);
    setSelectedRouteId(null);

    try {
      const intermediates = waypoints.map((w) => ({
        lat: w.dest.latitude,
        lng: w.dest.longitude,
      }));

      const res = await calculateRoute(
        deviceLoc,
        { lat: destination.latitude, lng: destination.longitude },
        intermediates.length > 0 ? intermediates : undefined
      );
      setRouteAlternatives(res);
      const recommended = res.find((r) => r.isRecommended) || res[0];
      if (recommended) setSelectedRouteId(recommended.id);
    } catch (err: any) {
      setRouteError(err.message || "Couldn't calculate a route. Please try again.");
    } finally {
      setIsCalculating(false);
    }
  };

  const handleStartTrip = async () => {
    const selectedRoute = routeAlternatives.find((r) => r.id === selectedRouteId);
    if (selectedRoute && destination) {
      try {
        await groupService.setTripRoute(
          destination.name,
          destination.latitude,
          destination.longitude,
          selectedRoute.coordinates,
          selectedRoute.distance,
          selectedRoute.duration
        );
        await groupService.startTrip();
      } catch (err) {
        console.warn('Trip route start warning:', err);
      }
    }
    router.push('/dashboard/trip');
  };

  const handleReset = () => {
    setDestination(null);
    setDestQuery('');
    setWaypoints([]);
    setRouteAlternatives([]);
    setSelectedRouteId(null);
    setRouteError(null);
  };

  const formatDistance = (meters: number) => {
    if (meters < 1000) return `${meters.toFixed(0)} m`;
    return `${(meters / 1000).toFixed(1)} km`;
  };

  const formatDuration = (seconds: number) => {
    const m = Math.round(seconds / 60);
    if (m < 60) return `~${m} min`;
    const h = Math.floor(m / 60);
    const mRem = m % 60;
    return `~${h} hr ${mRem} min`;
  };

  // All destination points to show on map
  const allMapDestinations = [
    ...waypoints.map((w) => ({ lat: w.dest.latitude, lng: w.dest.longitude, name: w.dest.name })),
    destination ? { lat: destination.latitude, lng: destination.longitude, name: destination.name } : null,
  ].filter(Boolean) as { lat: number; lng: number; name: string }[];

  const primaryDest = destination
    ? { lat: destination.latitude, lng: destination.longitude, name: destination.name }
    : undefined;

  const routeReady = routeAlternatives.length > 0;
  const canPlan = !!destination && !!deviceLoc && !isCalculating;

  const renderStatus = () => {
    if (routeReady)
      return (
        <span className="flex items-center gap-1.5 text-xs font-semibold text-emerald-400">
          <span className="w-2 h-2 rounded-full bg-emerald-400" /> Routes Ready
        </span>
      );
    if (isCalculating)
      return (
        <span className="flex items-center gap-1.5 text-xs font-semibold text-amber-400">
          <span className="w-2 h-2 rounded-full bg-amber-400" /> Calculating…
        </span>
      );
    if (waypoints.length > 0 && destination)
      return (
        <span className="flex items-center gap-1.5 text-xs font-semibold text-rally-blue">
          <span className="w-2 h-2 rounded-full bg-rally-blue" /> {waypoints.length + 2} stop{waypoints.length > 0 ? 's' : ''} planned
        </span>
      );
    return (
      <span className="flex items-center gap-1.5 text-xs font-semibold text-muted-foreground">
        <span className="w-2 h-2 rounded-full border border-muted-foreground" /> No Route
      </span>
    );
  };

  return (
    <RequireGroup>
      {(group) => (
        <div className="min-h-screen flex flex-col bg-background pb-8">
          <Topbar group={group} />

          <div className="flex-1 max-w-6xl w-full mx-auto p-4 md:p-6 lg:p-8 flex flex-col gap-6">

            {/* Header */}
            <div className="flex items-start justify-between">
              <div>
                <h1 className="text-2xl font-semibold text-foreground">Route Planner</h1>
                <p className="text-sm text-muted-foreground mt-1">Plan your RALLY journey with multiple stops</p>
              </div>
              <div className="px-3 py-1.5 rounded-full bg-card border border-border">
                {renderStatus()}
              </div>
            </div>

            <div className="grid lg:grid-cols-[1fr_380px] gap-6 flex-1 items-start">

              {/* Map Column */}
              <div className="h-[50vh] lg:h-[70vh] min-h-[400px] w-full rounded-2xl overflow-hidden border border-border bg-card">
                <LiveMap
                  customDestination={primaryDest}
                  routeAlternatives={routeAlternatives.map((r) => ({
                    id: r.id,
                    coordinates: r.coordinates,
                    selected: r.id === selectedRouteId,
                  }))}
                  onRouteSelect={(id) => setSelectedRouteId(id)}
                />
              </div>

              {/* Controls Column */}
              <div className="flex flex-col gap-4 max-h-[70vh] lg:overflow-y-auto no-scrollbar">

                {/* Location error */}
                {locError && !deviceLoc && (
                  <div className="p-4 rounded-xl border border-red-500/30 bg-red-500/10 text-red-400 flex items-start gap-3">
                    <AlertTriangle className="w-5 h-5 shrink-0" />
                    <div className="text-sm">
                      <p className="font-semibold mb-1">Current location unavailable.</p>
                      <p className="opacity-90">Enable location access to plan a route from your current position.</p>
                    </div>
                  </div>
                )}

                {/* Route error */}
                {routeError && (
                  <div className="p-4 rounded-xl border border-red-500/30 bg-red-500/10 text-red-400 flex items-start gap-3">
                    <AlertTriangle className="w-5 h-5 shrink-0" />
                    <div className="text-sm">
                      <p className="font-semibold mb-1">Route unavailable</p>
                      <p className="opacity-90">{routeError}</p>
                    </div>
                  </div>
                )}

                {/* ── Stop list ──────────────────────────────────────────────── */}
                {!routeReady && (
                  <div className="space-y-3">
                    <h2 className="text-[10px] font-bold text-muted-foreground/60 tracking-[0.15em] uppercase">
                      Plan your route
                    </h2>

                    {/* Origin (read-only) */}
                    <div className="flex items-center gap-3">
                      <div className="flex flex-col items-center gap-0.5 shrink-0">
                        <div className="w-8 h-8 rounded-full bg-emerald-500/15 border border-emerald-500/40 flex items-center justify-center">
                          <Navigation className="w-3.5 h-3.5 text-emerald-400" />
                        </div>
                        {(waypoints.length > 0 || destination) && (
                          <div className="w-px h-5 bg-border" />
                        )}
                      </div>
                      <div className="flex-1 bg-card border border-border rounded-xl px-4 py-3 text-sm">
                        <p className="text-[10px] font-semibold text-muted-foreground/60 tracking-wider mb-0.5">ORIGIN</p>
                        <p className="text-foreground font-medium">
                          {deviceLoc ? 'Your current location' : <span className="text-muted-foreground">Acquiring GPS…</span>}
                        </p>
                      </div>
                    </div>

                    {/* Waypoints */}
                    {waypoints.map((wp, idx) => (
                      <div key={wp.id} className="flex items-center gap-3">
                        <div className="flex flex-col items-center gap-0.5 shrink-0">
                          <div className="w-8 h-8 rounded-full bg-rally-blue/10 border border-rally-blue/40 flex items-center justify-center">
                            <Circle className="w-3 h-3 text-rally-blue fill-rally-blue/30" />
                          </div>
                          <div className="w-px h-5 bg-border" />
                        </div>
                        <div className="flex-1 bg-card border border-border rounded-xl px-4 py-3 text-sm">
                          <p className="text-[10px] font-semibold text-muted-foreground/60 tracking-wider mb-0.5">STOP {idx + 1}</p>
                          <p className="text-foreground font-medium truncate">{wp.dest.name}</p>
                        </div>
                        <div className="flex flex-col gap-1 shrink-0">
                          <button
                            onClick={() => moveWaypoint(wp.id, 'up')}
                            disabled={idx === 0}
                            className="p-1 rounded-lg hover:bg-white/5 text-muted-foreground disabled:opacity-30 transition-colors"
                            title="Move up"
                          >
                            <ChevronUp className="w-3.5 h-3.5" />
                          </button>
                          <button
                            onClick={() => moveWaypoint(wp.id, 'down')}
                            disabled={idx === waypoints.length - 1}
                            className="p-1 rounded-lg hover:bg-white/5 text-muted-foreground disabled:opacity-30 transition-colors"
                            title="Move down"
                          >
                            <ChevronDown className="w-3.5 h-3.5" />
                          </button>
                          <button
                            onClick={() => removeWaypoint(wp.id)}
                            className="p-1 rounded-lg hover:bg-red-500/10 text-muted-foreground hover:text-red-400 transition-colors"
                            title="Remove stop"
                          >
                            <X className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </div>
                    ))}

                    {/* Destination */}
                    <div className="flex items-center gap-3">
                      <div className="flex flex-col items-center gap-0.5 shrink-0">
                        <div className="w-8 h-8 rounded-full bg-red-500/10 border border-red-500/30 flex items-center justify-center">
                          <Flag className="w-3.5 h-3.5 text-red-400" />
                        </div>
                      </div>
                      <div className="flex-1 relative">
                        {destination ? (
                          <div className="bg-card border border-border rounded-xl px-4 py-3 text-sm flex items-center justify-between gap-2">
                            <div className="min-w-0">
                              <p className="text-[10px] font-semibold text-muted-foreground/60 tracking-wider mb-0.5">DESTINATION</p>
                              <p className="text-foreground font-medium truncate">{destination.name}</p>
                            </div>
                            <button
                              onClick={() => { setDestination(null); setDestQuery(''); setRouteAlternatives([]); setSelectedRouteId(null); }}
                              className="shrink-0 text-muted-foreground hover:text-foreground transition-colors"
                              title="Clear destination"
                            >
                              <X className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        ) : (
                          <StopSearchInput
                            placeholder="Search destination…"
                            onSelect={(d) => { setDestination(d); setDestQuery(d.name); }}
                            value={destQuery}
                            onClear={() => { setDestination(null); setDestQuery(''); }}
                          />
                        )}
                      </div>
                    </div>

                    {/* Add stop button */}
                    {showAddStop ? (
                      <div className="ml-11 space-y-2">
                        <StopSearchInput
                          placeholder="Search a stop to add…"
                          onSelect={addWaypoint}
                          onClear={() => setShowAddStop(false)}
                        />
                      </div>
                    ) : (
                      <button
                        onClick={() => setShowAddStop(true)}
                        className="ml-11 flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors py-1"
                      >
                        <Plus className="w-4 h-4" />
                        Add a stop
                      </button>
                    )}

                    {/* Plan Route button */}
                    {destination && (
                      <div className="flex gap-3 pt-2">
                        <button
                          onClick={handlePlanRoute}
                          disabled={!canPlan}
                          className="flex-1 py-3.5 rounded-xl bg-foreground text-background text-sm font-semibold hover:opacity-85 transition-opacity disabled:opacity-50 flex items-center justify-center gap-2"
                        >
                          {isCalculating ? (
                            <><Loader2 className="w-4 h-4 animate-spin" /> Calculating…</>
                          ) : (
                            <>
                              <MapPin className="w-4 h-4" />
                              Plan Route{waypoints.length > 0 ? ` (${waypoints.length + 2} stops)` : ''}
                            </>
                          )}
                        </button>
                      </div>
                    )}
                  </div>
                )}

                {/* ── Calculating spinner ────────────────────────────────────── */}
                {isCalculating && (
                  <div className="p-6 rounded-xl border border-border bg-card flex flex-col items-center justify-center text-center gap-4">
                    <Loader2 className="w-8 h-8 animate-spin text-amber-400" />
                    <div>
                      <p className="text-sm font-semibold text-foreground">Finding the best routes…</p>
                      {waypoints.length > 0 && (
                        <p className="text-xs text-muted-foreground mt-1">
                          Via {waypoints.length} stop{waypoints.length > 1 ? 's' : ''}
                        </p>
                      )}
                    </div>
                  </div>
                )}

                {/* ── Route alternatives ─────────────────────────────────────── */}
                {routeReady && (
                  <div className="space-y-4">

                    {/* Summary bar */}
                    <div className="p-3 rounded-xl border border-border bg-card/60 text-xs text-muted-foreground flex flex-wrap gap-x-4 gap-y-1">
                      <span className="flex items-center gap-1.5">
                        <Navigation className="w-3.5 h-3.5 text-emerald-400" /> Your location
                      </span>
                      {waypoints.map((wp, i) => (
                        <span key={wp.id} className="flex items-center gap-1.5">
                          <Circle className="w-3 h-3 text-rally-blue fill-rally-blue/30" /> Stop {i + 1}: {wp.dest.name.split(',')[0]}
                        </span>
                      ))}
                      <span className="flex items-center gap-1.5">
                        <Flag className="w-3.5 h-3.5 text-red-400" /> {destination?.name.split(',')[0]}
                      </span>
                    </div>

                    <h2 className="text-[10px] font-bold text-muted-foreground/60 tracking-[0.15em] uppercase">
                      Route Options
                    </h2>

                    <div className="space-y-3">
                      {routeAlternatives.map((route) => {
                        const isSelected = selectedRouteId === route.id;
                        return (
                          <button
                            key={route.id}
                            onClick={() => setSelectedRouteId(route.id)}
                            className={`w-full text-left p-5 rounded-2xl border transition-colors relative flex flex-col gap-3 ${
                              isSelected
                                ? 'bg-rally-blue/10 border-rally-blue'
                                : 'bg-card border-border hover:border-border/80'
                            }`}
                          >
                            <div className="flex items-center justify-between gap-2">
                              {route.isRecommended ? (
                                <span className={`text-[10px] font-bold tracking-wider uppercase flex items-center gap-1.5 ${isSelected ? 'text-emerald-400' : 'text-emerald-500/80'}`}>
                                  🟢 Recommended
                                </span>
                              ) : (
                                <span className="text-[10px] font-bold tracking-wider uppercase text-muted-foreground">
                                  Alternative
                                </span>
                              )}
                              {isSelected ? (
                                <span className="flex items-center gap-1 text-xs font-semibold text-rally-blue">
                                  <Check className="w-3.5 h-3.5" /> Selected
                                </span>
                              ) : (
                                <span className="px-3 py-1 rounded-lg bg-white/5 border border-white/10 text-xs font-semibold text-muted-foreground">
                                  Select
                                </span>
                              )}
                            </div>

                            <div className="flex items-end justify-between gap-4">
                              <div>
                                <p className={`text-lg font-bold ${isSelected ? 'text-foreground' : 'text-foreground/80'}`}>
                                  {formatDistance(route.distance)}
                                </p>
                                <p className={`text-xs font-medium mt-0.5 ${isSelected ? 'text-foreground/90' : 'text-muted-foreground'}`}>
                                  {route.isRecommended ? 'Fastest' : 'Alternative route'}
                                  {waypoints.length > 0 && ` · via ${waypoints.length} stop${waypoints.length > 1 ? 's' : ''}`}
                                </p>
                              </div>
                              <p className={`text-xl font-bold ${isSelected ? 'text-rally-blue' : 'text-foreground'}`}>
                                {formatDuration(route.duration)}
                              </p>
                            </div>
                          </button>
                        );
                      })}
                    </div>

                    <div className="flex gap-3 pt-2">
                      <button
                        onClick={handleReset}
                        className="px-4 py-3.5 rounded-xl border border-border text-foreground text-sm font-semibold hover:bg-white/5 transition-colors"
                      >
                        Change
                      </button>
                      <button
                        onClick={handleStartTrip}
                        disabled={!selectedRouteId}
                        className="flex-1 py-3.5 rounded-xl bg-rally-blue text-background text-sm font-bold hover:opacity-90 transition-opacity disabled:opacity-50 flex items-center justify-center gap-2"
                      >
                        Start Trip <ArrowRight className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                )}

              </div>
            </div>

          </div>
        </div>
      )}
    </RequireGroup>
  );
}
