'use client';

import 'leaflet/dist/leaflet.css';
import React, { useEffect, useRef, useState } from 'react';
import dynamic from 'next/dynamic';
import type { Map as LeafletMap } from 'leaflet';
import type { TripSummary } from '@/lib/mock/types';

const MapContainer = dynamic(() => import('react-leaflet').then((m) => m.MapContainer), { ssr: false });
const TileLayer = dynamic(() => import('react-leaflet').then((m) => m.TileLayer), { ssr: false });
const Marker = dynamic(() => import('react-leaflet').then((m) => m.Marker), { ssr: false });
const Popup = dynamic(() => import('react-leaflet').then((m) => m.Popup), { ssr: false });
const Polyline = dynamic(() => import('react-leaflet').then((m) => m.Polyline), { ssr: false });
const MapBridge = dynamic(() => import('./MapBridge'), { ssr: false });

interface RouteReplayMapProps {
  summary: TripSummary;
}

export default function RouteReplayMap({ summary }: RouteReplayMapProps) {
  const [mounted, setMounted] = useState(false);
  const [L, setL] = useState<any>(null);
  const mapRef = useRef<LeafletMap | null>(null);

  const handleMapReady = (map: LeafletMap) => {
    mapRef.current = map;
    // Fit bounds once the map is ready
    if (hasRouteDerived(summary.route ?? [])) {
      const pts = (summary.route ?? []).map((p): [number, number] => [p.lat, p.lng]);
      try {
        // @ts-ignore
        map.fitBounds(pts, { padding: [40, 40], maxZoom: 16 });
      } catch { /* ignore */ }
    }
  };
  useEffect(() => {
    setMounted(true);
    import('leaflet').then((mod) => setL(mod.default));
  }, []);

  if (!mounted || !L) {
    return (
      <div className="w-full h-full min-h-[300px] rounded-2xl border border-border bg-card flex flex-col items-center justify-center text-muted-foreground gap-3">
        <div className="w-8 h-8 border-2 border-rally-blue border-t-transparent rounded-full animate-spin" />
        <p className="text-sm font-medium">Loading map…</p>
      </div>
    );
  }

  const route = summary.route ?? [];
  const hasRoute = route.length >= 2;

  // Helper to check hasRoute before mount (needed in handleMapReady)
  function hasRouteDerived(r: typeof route) { return r.length >= 2; }

  // Derive map centre: prefer route midpoint → destination → fallback
  const midIndex = Math.floor(route.length / 2);
  const centre: [number, number] = route.length > 0
    ? [route[midIndex].lat, route[midIndex].lng]
    : [summary.destinationLat || 0, summary.destinationLng || 0];

  const routePositions = route.map((p): [number, number] => [p.lat, p.lng]);

  const startIcon = L.divIcon({
    className: '',
    html: `
      <div style="width:22px;height:22px;border-radius:50%;background:#34D399;border:2.5px solid #fff;box-shadow:0 0 8px rgba(52,211,153,0.8);display:flex;align-items:center;justify-content:center;">
      </div>
    `,
    iconSize: [22, 22],
    iconAnchor: [11, 11],
  });

  const endIcon = L.divIcon({
    className: '',
    html: `
      <div style="position:relative;width:28px;height:28px;display:flex;align-items:center;justify-content:center;">
        <div style="width:14px;height:14px;border-radius:3px;background:#19BFFF;transform:rotate(45deg);box-shadow:0 0 10px rgba(25,191,255,0.8);border:2px solid white;"></div>
      </div>
    `,
    iconSize: [28, 28],
    iconAnchor: [14, 14],
  });

  const alertIcon = L.divIcon({
    className: '',
    html: `
      <div style="width:20px;height:20px;border-radius:5px;background:#F59E0B;border:2px solid #0A0A0A;display:flex;align-items:center;justify-content:center;color:#0A0A0A;font-size:12px;font-weight:900;box-shadow:0 0 6px rgba(245,158,11,0.7);">!</div>
    `,
    iconSize: [20, 20],
    iconAnchor: [10, 10],
  });

  const deviationIcon = L.divIcon({
    className: '',
    html: `
      <div style="width:20px;height:20px;border-radius:50%;background:#EF4444;border:2px solid #fff;box-shadow:0 0 8px rgba(239,68,68,0.7);display:flex;align-items:center;justify-content:center;">
      </div>
    `,
    iconSize: [20, 20],
    iconAnchor: [10, 10],
  });

  return (
    <div className="w-full h-full min-h-[300px] rounded-2xl overflow-hidden relative">
      <MapContainer
        center={centre}
        zoom={13}
        className="w-full h-full"
        zoomControl={false}
      >
        <MapBridge onReady={handleMapReady} />
        <TileLayer
          url="https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png"
          attribution='&copy; <a href="https://carto.com/">CARTO</a>'
          subdomains="abcd"
          maxZoom={19}
        />

        {/* Route polyline */}
        {hasRoute && (
          <Polyline
            positions={routePositions}
            pathOptions={{ color: '#19BFFF', weight: 3, opacity: 0.85 }}
          />
        )}

        {/* Start marker */}
        {hasRoute && (
          <Marker position={routePositions[0]} icon={startIcon}>
            <Popup>
              <span className="text-xs font-semibold">Start</span>
            </Popup>
          </Marker>
        )}

        {/* End / destination marker */}
        {(hasRoute || (summary.destinationLat && summary.destinationLng)) && (
          <Marker
            position={
              hasRoute
                ? routePositions[routePositions.length - 1]
                : [summary.destinationLat, summary.destinationLng]
            }
            icon={endIcon}
          >
            <Popup>
              <span className="text-xs font-semibold">
                {summary.destination || 'Destination'}
              </span>
            </Popup>
          </Marker>
        )}

        {/* Alert points */}
        {(summary.alertPoints ?? []).map((pt, i) => (
          <Marker key={`alert-${i}`} position={[pt.lat, pt.lng]} icon={alertIcon}>
            <Popup>
              <span className="text-xs">{pt.label}</span>
            </Popup>
          </Marker>
        ))}

        {/* Deviation point */}
        {summary.deviationPoint && (
          <Marker
            position={[summary.deviationPoint.lat, summary.deviationPoint.lng]}
            icon={deviationIcon}
          >
            <Popup>
              <span className="text-xs font-semibold">Route deviation</span>
            </Popup>
          </Marker>
        )}
      </MapContainer>

      {/* Legend */}
      <div className="absolute bottom-3 left-3 z-[1000] flex items-center gap-3 bg-black/70 backdrop-blur-sm rounded-lg px-3 py-2 border border-white/10">
        <span className="flex items-center gap-1.5 text-[11px] text-white/70">
          <span className="w-2.5 h-2.5 rounded-full bg-emerald-400 shrink-0" />
          Start
        </span>
        <span className="flex items-center gap-1.5 text-[11px] text-white/70">
          <span
            className="w-2.5 h-2.5 shrink-0"
            style={{
              background: '#19BFFF',
              borderRadius: '2px',
              transform: 'rotate(45deg)',
              display: 'inline-block',
            }}
          />
          End
        </span>
        {(summary.alertPoints?.length ?? 0) > 0 && (
          <span className="flex items-center gap-1.5 text-[11px] text-white/70">
            <span className="w-2.5 h-2.5 rounded bg-amber-400 shrink-0" />
            Alert
          </span>
        )}
      </div>
    </div>
  );
}
