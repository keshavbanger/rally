'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Search, Compass, Loader2, MapPin, Route as RouteIcon, Shield } from 'lucide-react';
import Topbar from '@/components/dashboard/Topbar';
import { useGroup } from '@/hooks/useGroup';
import { getTripHistory } from '@/lib/mock/tripHistoryService';
import * as tripsApi from '@/lib/api/trips';
import { supabase } from '@/lib/supabase/client';
import type { TripSummary } from '@/lib/mock/types';

export default function TripHistoryPage() {
  const { group } = useGroup();
  const router = useRouter();
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<'All' | 'Completed' | 'Cancelled'>('All');

  const [allTrips, setAllTrips] = useState<TripSummary[] | null>(null);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [retryCount, setRetryCount] = useState(0);

  useEffect(() => {
    let cancelled = false;
    async function loadTrips() {
      setFetchError(null);
      // Local localStorage trips saved by this user's active session
      const local = getTripHistory().filter((t) => t.id !== 'demo-manali-aug22');

      try {
        // Query user's real trip history from backend
        const remote = await tripsApi.getTripsHistory({ limit: 50 }).catch(() => tripsApi.listMyTripHistory({ limit: 50 }));
        if (cancelled) return;

        let remoteItems = remote?.items;

        // Fallback directly to Supabase if backend returned no items or empty
        if (!remoteItems || remoteItems.length === 0) {
          try {
            const { data: supaTrips } = await supabase
              .from('trips')
              .select('id, destination_name, status, started_at, ended_at, distance, duration, safety_score, created_at')
              .in('status', ['COMPLETED', 'completed', 'ended', 'ENDED'])
              .order('created_at', { ascending: false })
              .limit(50);

            if (supaTrips && supaTrips.length > 0) {
              remoteItems = supaTrips.map((st) => ({
                trip_id: st.id,
                name: st.destination_name,
                destination_name: st.destination_name,
                status: (st.status?.toUpperCase() || 'COMPLETED') as any,
                started_at: st.started_at || st.created_at,
                ended_at: st.ended_at,
                member_count: 1,
                distance_meters: st.distance ? Math.round(st.distance * 1000) : null,
                distance: st.distance,
                duration: st.duration,
                safety_score: st.safety_score,
              }));
            }
          } catch (supaErr) {
            console.warn('Could not query Supabase directly:', supaErr);
          }
        }

        if (remoteItems?.length) {
          const localIds = new Set(local.map((t) => t.id));

          // Map backend items that aren't already in local storage
          const backendOnly: TripSummary[] = remoteItems
            .filter((t) => !localIds.has(t.trip_id))
            .map((t) => {
              const started = t.started_at ? new Date(t.started_at) : new Date();
              const distanceKm = t.distance != null
                ? Number(t.distance.toFixed(1))
                : (t.distance_meters != null ? Number((t.distance_meters / 1000).toFixed(1)) : null);
              const durationMin = t.duration != null
                ? t.duration
                : ((t.started_at && t.ended_at)
                    ? Math.round((new Date(t.ended_at).getTime() - new Date(t.started_at).getTime()) / 60000)
                    : null);
              const routeWaypoints = t.route?.coordinates?.map(([lng, lat]: number[]) => ({ lat, lng })) || [];
              const destName = t.destination_name || t.name || (t.route?.name) || 'Destination';

              return {
                id: String(t.trip_id),
                groupName: t.name || 'Rally Trip',
                destination: destName,
                date: started.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }),
                completedAt: t.ended_at ? new Date(t.ended_at).getTime() : Date.now(),
                distanceKm,
                durationMin,
                membersCount: t.member_count || 1,
                alertsCount: null,
                routeDeviations: null,
                separationEvents: null,
                unexpectedStops: null,
                sosCount: null,
                safetyScore: t.safety_score ?? null,
                riskLevel: t.safety_score != null ? ((t.safety_score >= 80 ? 'LOW RISK' : 'MEDIUM RISK')) : null,
                route: routeWaypoints,
                destinationLat: t.route?.destination_latitude ?? 0,
                destinationLng: t.route?.destination_longitude ?? 0,
                alertPoints: [],
                deviationPoint: null,
                keyEvents: [],
                insights: [],
                // preserve status and route flag for display/filter
                _status: t.status,
                _hasRoute: !!t.route || routeWaypoints.length > 0,
              } as TripSummary & { _status: string; _hasRoute?: boolean };
            });

          // Local-first: rich summaries take priority, backend fills the gaps
          const merged = [...local, ...backendOnly].sort((a, b) => b.completedAt - a.completedAt);
          setAllTrips(merged);
          return;
        }
      } catch (err: any) {
        console.warn('Could not fetch remote trip history:', err);
        if (local.length === 0) {
          setFetchError(err?.message || 'Could not connect to server to fetch trip history.');
        }
      }

      if (!cancelled) {
        setAllTrips(local);
      }
    }
    loadTrips();
    return () => { cancelled = true; };
  }, [retryCount]);

  if (allTrips === null) {
    if (fetchError) {
      return (
        <div className="min-h-screen flex flex-col items-center justify-center gap-4 text-center p-6 bg-background">
          <p className="text-sm font-semibold text-red-400">{fetchError}</p>
          <button
            onClick={() => { setAllTrips(null); setRetryCount((c) => c + 1); }}
            className="px-4 py-2 rounded-xl bg-white/10 hover:bg-white/20 border border-white/20 text-xs font-bold text-white transition-colors"
          >
            Retry Loading
          </button>
        </div>
      );
    }

    return (
      <div className="min-h-screen flex flex-col items-center justify-center gap-3 text-muted-foreground bg-background">
        <Loader2 className="w-6 h-6 animate-spin" />
        <p className="text-sm">Loading trip history…</p>
      </div>
    );
  }

  const filtered = allTrips.filter((trip) => {
    const tripWithStatus = trip as TripSummary & { _status?: string };
    if (search && !trip.groupName.toLowerCase().includes(search.toLowerCase()) && !trip.destination.toLowerCase().includes(search.toLowerCase())) return false;
    if (filter === 'Completed') {
      // Trips without a _status field (local/mock) are assumed completed.
      return !tripWithStatus._status || tripWithStatus._status === 'COMPLETED';
    }
    if (filter === 'Cancelled') {
      return tripWithStatus._status === 'CANCELLED';
    }
    return true;
  });

  return (
    <div className="min-h-screen flex flex-col bg-background">
      <Topbar group={group} />

      <div className="flex-1 p-4 md:p-6 lg:p-8 space-y-6 max-w-4xl mx-auto w-full">
        {/* Header */}
        <div>
          <h1 className="text-2xl font-semibold text-foreground">Trip History</h1>
          <p className="text-sm text-muted-foreground mt-1">Review your previous RALLY journeys</p>
        </div>

        {allTrips.length > 0 && (
          <p className="text-sm font-semibold text-foreground">{allTrips.length} completed trips</p>
        )}

        {/* Active Trip Notice */}
        {group && !group.paused && (
          <div className="flex items-center justify-between p-4 rounded-xl border border-rally-blue/30 bg-rally-blue/10 text-rally-blue">
            <span className="text-sm font-semibold flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-rally-blue animate-pulse" />
              Trip currently active
            </span>
            <Link
              href="/dashboard/trip"
              className="px-3 py-1.5 rounded-lg bg-rally-blue text-white text-xs font-bold hover:bg-rally-blue/90 transition-colors"
            >
              View Live Trip
            </Link>
          </div>
        )}

        {/* Search & Filters */}
        {allTrips.length > 0 && (
          <div className="flex flex-col sm:flex-row gap-3">
            <div className="relative flex-1">
              <Search className="w-4 h-4 text-muted-foreground absolute left-3.5 top-1/2 -translate-y-1/2" />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="🔍 Search trips..."
                className="w-full bg-card border border-border rounded-xl pl-10 pr-4 py-2.5 text-sm text-foreground placeholder:text-muted-foreground/60 focus:outline-none focus:border-border transition-colors"
              />
            </div>
            <select
              value={filter}
              onChange={(e) => setFilter(e.target.value as any)}
              className="bg-card border border-border rounded-xl px-4 py-2.5 text-sm text-foreground focus:outline-none focus:border-border transition-colors appearance-none pr-8 cursor-pointer relative"
              style={{ backgroundImage: 'url("data:image/svg+xml;charset=US-ASCII,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20width%3D%22292.4%22%20height%3D%22292.4%22%3E%3Cpath%20fill%3D%22%239ca3af%22%20d%3D%22M287%2069.4a17.6%2017.6%200%200%200-13-5.4H18.4c-5%200-9.3%201.8-12.9%205.4A17.6%2017.6%200%200%200%200%2082.2c0%205%201.8%209.3%205.4%2012.9l128%20127.9c3.6%203.6%207.8%205.4%2012.8%205.4s9.2-1.8%2012.8-5.4L287%2095c3.5-3.5%205.4-7.8%205.4-12.8%200-5-1.9-9.2-5.5-12.8z%22%2F%3E%3C%2Fsvg%3E")', backgroundRepeat: 'no-repeat', backgroundPosition: 'right 12px top 50%', backgroundSize: '10px auto' }}
            >
              <option value="All">All</option>
              <option value="Completed">Completed</option>
              <option value="Cancelled">Cancelled</option>
            </select>
          </div>
        )}

        {/* List */}
        {allTrips.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 text-center gap-4 rounded-2xl border border-border bg-card">
            <div className="w-12 h-12 rounded-2xl bg-muted border border-border flex items-center justify-center text-muted-foreground">
              <Compass className="w-6 h-6" />
            </div>
            <div>
              <p className="text-base font-semibold text-foreground">No trips yet</p>
              <p className="text-sm text-muted-foreground mt-1">Complete your first RALLY trip<br />to see your journey history here.</p>
            </div>
            <Link
              href="/dashboard/route"
              className="px-5 py-2.5 rounded-lg bg-foreground text-background text-sm font-semibold hover:opacity-85 transition-opacity"
            >
              Plan a Trip
            </Link>
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-center gap-2 rounded-2xl border border-border bg-card">
            <p className="text-sm text-foreground font-semibold">No trips found</p>
            <p className="text-sm text-muted-foreground">Try another RALLY name or destination.</p>
          </div>
        ) : (
          <div className="space-y-3">
            <p className="text-[10px] font-bold text-muted-foreground/60 tracking-[0.15em] uppercase px-2">Trips</p>
            {filtered.map((trip) => {
              const durationStr = trip.durationMin != null
                ? (() => { const h = Math.floor(trip.durationMin! / 60); const m = trip.durationMin! % 60; return h > 0 ? `${h}h ${m}m` : `${m} min`; })()
                : 'N/A';

              return (
                <div key={trip.id} className="rounded-2xl border border-border bg-card p-5 hover:border-border/80 transition-colors flex flex-col gap-4">
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <h3 className="text-base font-semibold text-foreground">{trip.groupName}</h3>
                      <p className="text-sm text-muted-foreground mt-0.5">{trip.date}</p>
                    </div>
                    {(() => {
                      const s = (trip as any)._status || 'COMPLETED';
                      if (s === 'CANCELLED') {
                        return <span className="flex items-center gap-1.5 text-xs font-bold text-red-400 bg-red-400/10 px-2.5 py-1 rounded-md">🔴 Cancelled</span>;
                      }
                      if (s === 'ACTIVE') {
                        return <span className="flex items-center gap-1.5 text-xs font-bold text-rally-blue bg-rally-blue/10 px-2.5 py-1 rounded-md animate-pulse">🔵 Active</span>;
                      }
                      return <span className="flex items-center gap-1.5 text-xs font-bold text-emerald-400 bg-emerald-400/10 px-2.5 py-1 rounded-md">🟢 Completed</span>;
                    })()}
                  </div>

                  <div className="flex items-center gap-2.5 flex-wrap">
                    {trip.destination && (
                      <div className="text-sm text-foreground flex items-center gap-1.5 font-medium">
                        <MapPin className="w-4 h-4 text-rally-blue shrink-0" />
                        {trip.destination}
                      </div>
                    )}
                    {((trip as any)._hasRoute || (trip.route && trip.route.length > 0)) && (
                      <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-cyan-400 bg-cyan-400/10 border border-cyan-400/20 px-2 py-0.5 rounded-full">
                        <RouteIcon className="w-3 h-3" />
                        Route Recorded
                      </span>
                    )}
                    {trip.safetyScore != null && (
                      <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-emerald-400 bg-emerald-400/10 border border-emerald-400/20 px-2 py-0.5 rounded-full">
                        <Shield className="w-3 h-3" />
                        {trip.safetyScore}% Safety
                      </span>
                    )}
                  </div>

                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mt-2">
                    <div className="text-sm text-muted-foreground font-medium flex items-center flex-wrap gap-2">
                      <span>{trip.distanceKm} km</span>
                      <span>·</span>
                      <span>{durationStr}</span>
                      <span>·</span>
                      <span>{trip.membersCount} members</span>
                    </div>

                    <Link
                      href={`/dashboard/history/${trip.id}`}
                      className="inline-flex items-center justify-center px-4 py-2 rounded-lg bg-muted/60 border border-border text-foreground text-xs font-semibold hover:bg-muted transition-colors shrink-0"
                    >
                      View Details
                    </Link>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
