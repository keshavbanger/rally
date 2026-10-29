'use client';

/**
 * TripReplayPlayer – Google Maps version for RALLY.
 *
 * Plays back a completed trip frame-by-frame using data from the backend
 * GET /trips/{trip_id}/replay endpoint. Member positions animate on a
 * Google Map in dark mode.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { APIProvider, Map, AdvancedMarker, InfoWindow, useMap } from '@vis.gl/react-google-maps';
import { Play, Pause, RotateCcw, Loader2, AlertCircle } from 'lucide-react';
import { getTripReplay } from '@/lib/api/replay';
import { getTrip } from '@/lib/api/trips';
import { getGroupMembers } from '@/lib/api/groups';
import { friendlyErrorMessage } from '@/lib/api/errors';
import type { TripReplay } from '@/lib/api/types';
import { hasGoogleMapsKey, GOOGLE_MAPS_API_KEY } from '@/lib/services/googleMaps';

const SPEEDS = [0.5, 1, 2, 4] as const;
const BASE_TICK_MS = 700;

// ─── Inner component (needs Map context) ─────────────────────────────────────

function ReplayMapContent({
  frame,
  memberNames,
}: {
  frame: TripReplay['timeline'][number] | null;
  memberNames: Record<string, string>;
}) {
  const map = useMap();
  const [activePopup, setActivePopup] = useState<string | null>(null);
  const didFit = useRef(false);

  const positions = frame?.members.filter((m) => m.latitude != null && m.longitude != null) ?? [];

  useEffect(() => {
    if (!map || positions.length === 0 || didFit.current) return;
    map.setCenter({ lat: positions[0].latitude, lng: positions[0].longitude });
    map.setZoom(14);
    didFit.current = true;
  }, [map, positions]);

  return (
    <>
      <Map
        defaultCenter={{ lat: 19.076, lng: 72.877 }}
        defaultZoom={13}
        mapId="rally-replay-player"
        disableDefaultUI
        gestureHandling="greedy"
        style={{ width: '100%', height: '100%' }}
        colorScheme="DARK"
      />

      {positions.map((m) => {
        const name = memberNames[m.user_id] ?? 'Member';
        return (
          <AdvancedMarker
            key={m.user_id}
            position={{ lat: m.latitude, lng: m.longitude }}
            onClick={() => setActivePopup(m.user_id)}
          >
            <div style={{
              width: 24, height: 24, borderRadius: '50%',
              background: '#0A0A0A', border: '2px solid #19BFFF',
              color: '#fff', fontSize: 10, fontWeight: 700,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              boxShadow: '0 0 8px #19BFFF',
            }}>
              {name.charAt(0).toUpperCase()}
            </div>
            {activePopup === m.user_id && (
              <InfoWindow onClose={() => setActivePopup(null)} position={{ lat: m.latitude, lng: m.longitude }}>
                <div style={{ color: '#000', fontSize: 12, fontWeight: 600 }}>{name}</div>
                {m.movement_state && <div style={{ color: '#888', fontSize: 11 }}>{m.movement_state}</div>}
              </InfoWindow>
            )}
          </AdvancedMarker>
        );
      })}
    </>
  );
}

// ─── Root export ──────────────────────────────────────────────────────────────

export default function TripReplayPlayer({ tripId }: { tripId: string }) {
  const [replay, setReplay] = useState<TripReplay | null>(null);
  const [memberNames, setMemberNames] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [frameIndex, setFrameIndex] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState<(typeof SPEEDS)[number]>(1);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    getTripReplay(tripId)
      .then(async (r) => {
        if (cancelled) return;
        setReplay(r);
        try {
          const trip = await getTrip(tripId);
          const members = await getGroupMembers(trip.group_id);
          if (!cancelled)
            setMemberNames(Object.fromEntries(members.map((m) => [m.user_id, m.name ?? 'Member'])));
        } catch { /* Names are display-only; replay still works without them */ }
      })
      .catch((err) => { if (!cancelled) setError(friendlyErrorMessage(err)); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [tripId]);

  const frameCount = replay?.timeline.length ?? 0;

  useEffect(() => {
    if (!playing || frameCount === 0) return;
    const interval = setInterval(() => {
      setFrameIndex((i) => {
        if (i >= frameCount - 1) { setPlaying(false); return i; }
        return i + 1;
      });
    }, BASE_TICK_MS / speed);
    return () => clearInterval(interval);
  }, [playing, speed, frameCount]);

  const frame = replay?.timeline[frameIndex] ?? null;

  if (loading) {
    return (
      <div className="w-full h-[360px] rounded-2xl border border-border bg-card flex items-center justify-center text-muted-foreground">
        <Loader2 className="w-6 h-6 animate-spin" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="w-full h-[200px] rounded-2xl border border-border bg-card flex flex-col items-center justify-center gap-2 text-center px-6">
        <AlertCircle className="w-5 h-5 text-red-400" />
        <p className="text-sm text-muted-foreground">{error}</p>
      </div>
    );
  }

  if (!replay || replay.timeline.length === 0) {
    return (
      <div className="w-full h-[200px] rounded-2xl border border-border bg-card flex items-center justify-center text-sm text-muted-foreground">
        No replay data available for this trip.
      </div>
    );
  }

  const mapBlock = hasGoogleMapsKey() ? (
    <APIProvider apiKey={GOOGLE_MAPS_API_KEY}>
      <ReplayMapContent frame={frame} memberNames={memberNames} />
    </APIProvider>
  ) : (
    <div className="w-full h-full flex items-center justify-center bg-card text-xs text-muted-foreground text-center px-4">
      Add NEXT_PUBLIC_GOOGLE_MAPS_API_KEY to view the replay map.
    </div>
  );

  return (
    <div className="space-y-3">
      <div className="relative w-full h-[360px] rounded-2xl overflow-hidden border border-border">
        {mapBlock}
      </div>

      <div className="rounded-2xl border border-border bg-card p-4 space-y-3">
        <div className="flex items-center gap-3">
          <button
            onClick={() => setPlaying((p) => !p)}
            className="w-9 h-9 rounded-full bg-foreground text-background flex items-center justify-center hover:opacity-85 transition-opacity shrink-0"
            aria-label={playing ? 'Pause' : 'Play'}
          >
            {playing ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4 ml-0.5" />}
          </button>
          <button
            onClick={() => { setFrameIndex(0); setPlaying(false); }}
            className="w-9 h-9 rounded-full border border-border text-foreground flex items-center justify-center hover:bg-white/5 transition-colors shrink-0"
            aria-label="Restart"
          >
            <RotateCcw className="w-4 h-4" />
          </button>

          <input
            type="range"
            min={0}
            max={frameCount - 1}
            value={frameIndex}
            onChange={(e) => { setPlaying(false); setFrameIndex(Number(e.target.value)); }}
            className="flex-1 accent-rally-blue"
          />

          <div className="flex items-center gap-1 shrink-0">
            {SPEEDS.map((s) => (
              <button
                key={s}
                onClick={() => setSpeed(s)}
                className={`px-2 py-1 rounded-md text-[11px] font-semibold border transition-colors ${
                  speed === s
                    ? 'bg-rally-blue/15 border-rally-blue/40 text-rally-blue'
                    : 'border-border text-muted-foreground hover:text-foreground'
                }`}
              >
                {s}x
              </button>
            ))}
          </div>
        </div>

        <p className="text-[11px] text-muted-foreground font-mono">
          {frame
            ? new Date(frame.timestamp).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', second: '2-digit' })
            : '—'}
          {' · '}Frame {frameIndex + 1} / {frameCount}
        </p>
      </div>
    </div>
  );
}
