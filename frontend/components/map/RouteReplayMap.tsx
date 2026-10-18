'use client';

/**
 * RouteReplayMap – Google Maps version for RALLY trip history.
 *
 * Preserves the same TripSummary prop shape as the old Leaflet implementation.
 * Shows the recorded route polyline, start/end markers, alert points, and
 * deviation markers on a dark Google Map.
 */

import React, { useEffect, useRef } from 'react';
import {
  APIProvider,
  Map,
  AdvancedMarker,
  InfoWindow,
  useMap,
} from '@vis.gl/react-google-maps';
import { AlertTriangle } from 'lucide-react';
import type { TripSummary } from '@/lib/mock/types';
import { hasGoogleMapsKey, GOOGLE_MAPS_API_KEY } from '@/lib/services/googleMaps';

interface RouteReplayMapProps {
  summary: TripSummary;
}

// ─── Inner component (needs Map context) ─────────────────────────────────────

function ReplayMapContent({ summary }: RouteReplayMapProps) {
  const map = useMap();
  const polylineRef = useRef<google.maps.Polyline | null>(null);
  const [activePopup, setActivePopup] = React.useState<string | null>(null);

  const route = summary.route ?? [];
  const hasRoute = route.length >= 2;
  const routePath = route.map((p) => ({ lat: p.lat, lng: p.lng }));

  // ── Draw route polyline ──────────────────────────────────────────────────
  useEffect(() => {
    if (!map || !hasRoute) return;

    polylineRef.current = new google.maps.Polyline({
      path: routePath,
      strokeColor: '#19BFFF',
      strokeWeight: 3,
      strokeOpacity: 0.85,
      map,
    });

    // Fit bounds to the entire route
    const bounds = new google.maps.LatLngBounds();
    routePath.forEach((p) => bounds.extend(p));
    if (summary.destinationLat && summary.destinationLng) {
      bounds.extend({ lat: summary.destinationLat, lng: summary.destinationLng });
    }
    if (!bounds.isEmpty()) map.fitBounds(bounds, 40);

    return () => {
      polylineRef.current?.setMap(null);
      polylineRef.current = null;
    };
  }, [map]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Derive map centre ─────────────────────────────────────────────────────
  const midIndex = Math.floor(route.length / 2);
  const centre =
    route.length > 0
      ? { lat: route[midIndex].lat, lng: route[midIndex].lng }
      : { lat: summary.destinationLat ?? 19.076, lng: summary.destinationLng ?? 72.877 };

  return (
    <>
      <Map
        defaultCenter={centre}
        defaultZoom={13}
        mapId="rally-replay-map"
        disableDefaultUI
        gestureHandling="greedy"
        style={{ width: '100%', height: '100%' }}
        colorScheme="DARK"
      />

      {/* Start marker */}
      {hasRoute && (
        <AdvancedMarker
          position={routePath[0]}
          onClick={() => setActivePopup('start')}
        >
          <div style={{ width: 22, height: 22, borderRadius: '50%', background: '#34D399', border: '2.5px solid #fff', boxShadow: '0 0 8px rgba(52,211,153,0.8)' }} />
          {activePopup === 'start' && (
            <InfoWindow onClose={() => setActivePopup(null)} position={routePath[0]}>
              <span style={{ color: '#000', fontSize: 12, fontWeight: 600 }}>Start</span>
            </InfoWindow>
          )}
        </AdvancedMarker>
      )}

      {/* End / destination marker */}
      {(hasRoute || (summary.destinationLat && summary.destinationLng)) && (
        <AdvancedMarker
          position={
            hasRoute
              ? routePath[routePath.length - 1]
              : { lat: summary.destinationLat!, lng: summary.destinationLng! }
          }
          onClick={() => setActivePopup('end')}
        >
          <div style={{ width: 14, height: 14, borderRadius: 3, background: '#19BFFF', transform: 'rotate(45deg)', boxShadow: '0 0 10px rgba(25,191,255,0.8)', border: '2px solid white' }} />
          {activePopup === 'end' && (
            <InfoWindow
              onClose={() => setActivePopup(null)}
              position={hasRoute ? routePath[routePath.length - 1] : { lat: summary.destinationLat!, lng: summary.destinationLng! }}
            >
              <span style={{ color: '#000', fontSize: 12, fontWeight: 600 }}>
                {summary.destination || 'Destination'}
              </span>
            </InfoWindow>
          )}
        </AdvancedMarker>
      )}

      {/* Alert points */}
      {(summary.alertPoints ?? []).map((pt, i) => (
        <AdvancedMarker
          key={`alert-${i}`}
          position={{ lat: pt.lat, lng: pt.lng }}
          onClick={() => setActivePopup(`alert-${i}`)}
        >
          <div style={{ width: 20, height: 20, borderRadius: 5, background: '#F59E0B', border: '2px solid #0A0A0A', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#0A0A0A', fontSize: 12, fontWeight: 900, boxShadow: '0 0 6px rgba(245,158,11,0.7)' }}>!</div>
          {activePopup === `alert-${i}` && (
            <InfoWindow onClose={() => setActivePopup(null)} position={{ lat: pt.lat, lng: pt.lng }}>
              <span style={{ color: '#000', fontSize: 12 }}>{pt.label}</span>
            </InfoWindow>
          )}
        </AdvancedMarker>
      ))}

      {/* Deviation marker */}
      {summary.deviationPoint && (
        <AdvancedMarker
          position={{ lat: summary.deviationPoint.lat, lng: summary.deviationPoint.lng }}
          onClick={() => setActivePopup('deviation')}
        >
          <div style={{ width: 20, height: 20, borderRadius: '50%', background: '#EF4444', border: '2px solid #fff', boxShadow: '0 0 8px rgba(239,68,68,0.7)' }} />
          {activePopup === 'deviation' && (
            <InfoWindow onClose={() => setActivePopup(null)} position={{ lat: summary.deviationPoint.lat, lng: summary.deviationPoint.lng }}>
              <span style={{ color: '#000', fontSize: 12, fontWeight: 600 }}>Route deviation</span>
            </InfoWindow>
          )}
        </AdvancedMarker>
      )}

      {/* Legend */}
      <div className="absolute bottom-3 left-3 z-[1000] flex items-center gap-3 bg-black/70 backdrop-blur-sm rounded-lg px-3 py-2 border border-white/10">
        <span className="flex items-center gap-1.5 text-[11px] text-white/70">
          <span className="w-2.5 h-2.5 rounded-full bg-emerald-400 shrink-0" />
          Start
        </span>
        <span className="flex items-center gap-1.5 text-[11px] text-white/70">
          <span className="w-2.5 h-2.5 shrink-0" style={{ background: '#19BFFF', borderRadius: 2, transform: 'rotate(45deg)', display: 'inline-block' }} />
          End
        </span>
        {(summary.alertPoints?.length ?? 0) > 0 && (
          <span className="flex items-center gap-1.5 text-[11px] text-white/70">
            <span className="w-2.5 h-2.5 rounded bg-amber-400 shrink-0" />
            Alert
          </span>
        )}
      </div>
    </>
  );
}

// ─── Root export ──────────────────────────────────────────────────────────────

export default function RouteReplayMap({ summary }: RouteReplayMapProps) {
  if (!hasGoogleMapsKey()) {
    return (
      <div className="w-full h-full min-h-[300px] rounded-2xl border border-amber-500/30 bg-amber-500/5 flex flex-col items-center justify-center gap-3 p-6 text-center">
        <AlertTriangle className="w-6 h-6 text-amber-400" />
        <p className="text-xs text-muted-foreground max-w-xs">
          Add <code className="bg-white/10 px-1 rounded">NEXT_PUBLIC_GOOGLE_MAPS_API_KEY</code> to{' '}
          <code className="bg-white/10 px-1 rounded">frontend/.env.local</code> to view the map.
        </p>
      </div>
    );
  }

  return (
    <div className="w-full h-full min-h-[300px] rounded-2xl overflow-hidden relative">
      <APIProvider apiKey={GOOGLE_MAPS_API_KEY}>
        <ReplayMapContent summary={summary} />
      </APIProvider>
    </div>
  );
}
