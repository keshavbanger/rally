'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import {
  ArrowLeft, Loader2, Route, Clock, Users, BellRing,
  Navigation2, UsersRound, Octagon, Siren, CheckCircle2,
} from 'lucide-react';
import RouteReplayMap from '@/components/map/RouteReplayMap';
import RiskRing from '@/components/dashboard/RiskRing';
import { getTripSummaryById } from '@/lib/mock/tripHistoryService';
import * as tripsApi from '@/lib/api/trips';
import * as analyticsApi from '@/lib/api/analytics';
import * as routesApi from '@/lib/api/routes';
import type { TripSummary } from '@/lib/mock/types';
import Topbar from '@/components/dashboard/Topbar';
import { useGroup } from '@/hooks/useGroup';


export default function TripDetailsPage() {
  const { id } = useParams();
  const { group } = useGroup();
  const [trip, setTrip] = useState<TripSummary | null | undefined>(undefined);

  useEffect(() => {
    let cancelled = false;

    async function loadTrip() {
      if (typeof id !== 'string') return;

      // Local-first: localStorage has the richest data (saved by endTrip with analytics)
      const local = getTripSummaryById(id);
      if (local) {
        setTrip(local);
        // Background enrichment: overlay backend analytics on top of local data
        try {
          const [analytics, insights, routeData] = await Promise.all([
            analyticsApi.getTripAnalytics(id).catch(() => null),
            analyticsApi.getTripInsights(id).catch(() => null),
            routesApi.getRoute(id).catch(() => null),
          ]);
          if (cancelled) return;
          const routeWaypoints =
            routeData?.route?.coordinates?.map(([lng, lat]) => ({ lat, lng })) ?? [];
          setTrip((prev) => {
            if (!prev) return prev;
            return {
              ...prev,
              distanceKm:
                analytics?.distance_traveled_meters != null
                  ? Number((analytics.distance_traveled_meters / 1000).toFixed(1))
                  : prev.distanceKm,
              durationMin:
                analytics?.duration_seconds != null
                  ? Math.round(analytics.duration_seconds / 60)
                  : prev.durationMin,
              membersCount: analytics?.member_count ?? prev.membersCount,
              alertsCount: analytics?.alerts_count ?? prev.alertsCount,
              routeDeviations: analytics?.route_deviations ?? prev.routeDeviations,
              sosCount: analytics?.sos_count ?? prev.sosCount,
              insights:
                insights?.highlights?.length ? insights.highlights : prev.insights,
              route: routeWaypoints.length > 0 ? routeWaypoints : prev.route,
              destinationLat:
                routeData?.route?.destination_latitude ?? prev.destinationLat,
              destinationLng:
                routeData?.route?.destination_longitude ?? prev.destinationLng,
            };
          });
        } catch {
          // Enrichment failure is non-fatal — local data is already shown
        }
        return;
      }

      // Fall back to fetching everything from the backend
      try {
        const [apiTrip, analytics, insights, routeData] = await Promise.all([
          tripsApi.getTrip(id).catch(() => null),
          analyticsApi.getTripAnalytics(id).catch(() => null),
          analyticsApi.getTripInsights(id).catch(() => null),
          routesApi.getRoute(id).catch(() => null),
        ]);
        if (cancelled) return;
        if (apiTrip) {
          const started = apiTrip.started_at
            ? new Date(apiTrip.started_at)
            : new Date(apiTrip.created_at);
          const routeWaypoints =
            routeData?.route?.coordinates?.map(([lng, lat]) => ({ lat, lng })) ?? [];
          const remoteSummary: TripSummary = {
            id: apiTrip.id,
            groupName: 'Rally Trip',
            destination: apiTrip.destination_name ?? 'Destination',
            date: started.toLocaleDateString('en-US', {
              month: 'short', day: 'numeric', year: 'numeric',
            }),
            completedAt: apiTrip.ended_at
              ? new Date(apiTrip.ended_at).getTime()
              : Date.now(),
            distanceKm:
              analytics?.distance_traveled_meters != null
                ? Number((analytics.distance_traveled_meters / 1000).toFixed(1))
                : apiTrip.distance
                ? Number((apiTrip.distance / 1000).toFixed(1))
                : null,
            durationMin:
              analytics?.duration_seconds != null
                ? Math.round(analytics.duration_seconds / 60)
                : apiTrip.duration
                ? Math.round(apiTrip.duration / 60)
                : null,
            membersCount: analytics?.member_count ?? 1,
            alertsCount: analytics?.alerts_count ?? null,
            routeDeviations: analytics?.route_deviations ?? null,
            separationEvents: null,
            unexpectedStops: null,
            sosCount: analytics?.sos_count ?? null,
            safetyScore: apiTrip.safety_score ?? null,
            riskLevel: 'LOW RISK',
            route: routeWaypoints,
            destinationLat: routeData?.route?.destination_latitude ?? 0,
            destinationLng: routeData?.route?.destination_longitude ?? 0,
            alertPoints: [],
            deviationPoint: null,
            keyEvents: [],
            insights: insights?.highlights ?? [],
          };
          setTrip(remoteSummary);
          return;
        }
      } catch (err) {
        console.warn('Could not fetch trip details from backend:', err);
      }
      if (!cancelled) setTrip(null);
    }

    loadTrip();
    return () => { cancelled = true; };
  }, [id]);

  // ── Loading / error states ──────────────────────────────────────────────────

  if (trip === undefined) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center gap-3 text-muted-foreground bg-background">
        <Loader2 className="w-6 h-6 animate-spin" />
        <p className="text-sm">Loading trip details…</p>
      </div>
    );
  }

  if (trip === null) {
    return (
      <div className="min-h-screen bg-background flex flex-col">
        <Topbar group={group} />
        <div className="flex-1 flex flex-col items-center justify-center gap-4 px-6 text-center max-w-md mx-auto">
          <h1 className="text-xl font-semibold text-foreground">Trip not found</h1>
          <p className="text-sm text-muted-foreground">
            You don&apos;t have access to this trip, or it doesn&apos;t exist.
          </p>
          <Link
            href="/dashboard/history"
            className="px-5 py-2.5 rounded-lg bg-foreground text-background text-sm font-semibold hover:opacity-85 transition-opacity"
          >
            Back to Trip History
          </Link>
        </div>
      </div>
    );
  }

  // ── Helpers ────────────────────────────────────────────────────────────────

  const durationStr =
    trip.durationMin != null
      ? (() => {
          const h = Math.floor(trip.durationMin! / 60);
          const m = trip.durationMin! % 60;
          return h > 0 ? `${h}h ${m}m` : `${m} min`;
        })()
      : 'N/A';

  const fmt = (val: number | null | undefined, suffix = '') =>
    val != null ? `${val}${suffix}` : 'N/A';

  const stats = [
    { label: 'Distance',          value: trip.distanceKm != null ? `${trip.distanceKm} km` : 'N/A', icon: Route },
    { label: 'Duration',          value: durationStr, icon: Clock },
    { label: 'Members',           value: fmt(trip.membersCount), icon: Users },
    { label: 'Alerts',            value: fmt(trip.alertsCount), icon: BellRing },
    { label: 'Route deviations',  value: fmt(trip.routeDeviations), icon: Navigation2 },
    { label: 'Separation events', value: fmt(trip.separationEvents), icon: UsersRound },
    { label: 'Unexpected stops',  value: fmt(trip.unexpectedStops), icon: Octagon },
    { label: 'SOS triggered',     value: fmt(trip.sosCount), icon: Siren },
  ];

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <Topbar group={group} />

      <div className="flex-1 p-4 md:p-6 lg:p-8 space-y-6 max-w-4xl mx-auto w-full">

        {/* Back link */}
        <Link
          href="/dashboard/history"
          className="inline-flex items-center gap-2 text-sm font-semibold text-muted-foreground hover:text-foreground transition-colors"
        >
          <ArrowLeft className="w-4 h-4" /> Trip History
        </Link>

        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold text-foreground">{trip.groupName}</h1>
            <p className="text-sm text-muted-foreground mt-1">
              {trip.date}
              {trip.destination ? ` · ${trip.destination}` : ''}
            </p>
          </div>
          <span className="flex items-center gap-1.5 text-xs font-bold text-emerald-400 bg-emerald-400/10 px-2.5 py-1.5 rounded-md shrink-0">
            <CheckCircle2 className="w-3.5 h-3.5" /> Completed
          </span>
        </div>

        {/* Stats grid */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {stats.map((s) => (
            <div key={s.label} className="rounded-2xl border border-border bg-card p-4">
              <s.icon className="w-4 h-4 text-muted-foreground mb-2" />
              <p className="text-lg font-bold text-foreground leading-none">{s.value}</p>
              <p className="text-[11px] text-muted-foreground mt-1.5">{s.label}</p>
            </div>
          ))}
        </div>

        {/* Safety score */}
        {trip.safetyScore != null && (
          <div className="rounded-2xl border border-border bg-card p-6 flex flex-col items-center text-center">
            <p className="text-[11px] font-semibold text-muted-foreground tracking-wider mb-4">
              SAFETY SCORE
            </p>
            <RiskRing
              risk={{ score: trip.safetyScore, level: trip.riskLevel ?? 'LOW RISK' }}
              size={112}
            />
            <p
              className="text-sm font-bold tracking-wide mt-4"
              style={{
                color:
                  trip.riskLevel === 'LOW RISK'
                    ? '#34D399'
                    : trip.riskLevel === 'MODERATE RISK'
                    ? '#FBBF24'
                    : '#F87171',
              }}
            >
              {trip.riskLevel ?? '—'}
            </p>
          </div>
        )}

        {/* Route map */}
        <div className="rounded-2xl border border-border bg-card p-4 sm:p-6">
          <p className="text-[10px] font-bold text-muted-foreground/60 tracking-[0.15em] uppercase mb-4">
            Route Map
          </p>
          {trip.route && trip.route.length > 0 ? (
            <div className="h-[300px] sm:h-[420px]">
              <RouteReplayMap summary={trip} />
            </div>
          ) : (
            <div className="h-[300px] sm:h-[420px] rounded-xl border border-border bg-background flex items-center justify-center text-muted-foreground text-sm font-medium">
              Route data unavailable for this trip.
            </div>
          )}
        </div>

        {/* Key events + Insights */}
        <div className="grid sm:grid-cols-2 gap-6">
          {trip.keyEvents.length > 0 && (
            <div className="rounded-2xl border border-border bg-card p-5">
              <h2 className="text-sm font-semibold text-foreground mb-4">Key Events</h2>
              <div className="space-y-4">
                {trip.keyEvents.map((event, i) => (
                  <div key={i} className="flex items-start gap-3">
                    <div className="flex flex-col items-center pt-1">
                      <span className="w-2 h-2 rounded-full bg-rally-blue shrink-0" />
                      {i < trip.keyEvents.length - 1 && (
                        <span className="w-px flex-1 bg-border mt-1" style={{ minHeight: 16 }} />
                      )}
                    </div>
                    <div className="min-w-0 pb-1">
                      <p className="text-sm text-foreground">{event.label}</p>
                      <p className="text-[11px] text-muted-foreground font-mono">{event.time}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="rounded-2xl border border-border bg-card p-5">
            <h2 className="text-sm font-semibold text-foreground mb-4">Insights</h2>
            {trip.insights.length > 0 ? (
              <div className="space-y-3">
                {trip.insights.map((insight, i) => (
                  <p
                    key={i}
                    className="text-sm text-muted-foreground leading-relaxed pl-3 border-l-2 border-rally-blue/40"
                  >
                    {insight}
                  </p>
                ))}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">
                Analytics will appear here once enough trip data has been collected.
              </p>
            )}
          </div>
        </div>

      </div>
    </div>
  );
}
