'use client';

/**
 * LiveMap – Google Maps implementation for RALLY.
 *
 * Props are intentionally identical to the old Leaflet LiveMap so every
 * existing caller (route/page.tsx, trip/page.tsx, etc.) keeps working
 * without any changes.
 *
 * When NEXT_PUBLIC_GOOGLE_MAPS_API_KEY is not set the component shows a
 * clear, user-friendly "configure your API key" banner instead of crashing.
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  APIProvider,
  Map,
  AdvancedMarker,
  Pin,
  useMap,
  InfoWindow,
} from '@vis.gl/react-google-maps';
import { LocateFixed, Plus, Minus, Maximize, Route as RouteIcon, AlertTriangle } from 'lucide-react';
import type { AlertItem, Group } from '@/lib/mock/types';
import { STATUS_STYLE } from '@/components/dashboard/status';
import { hasGoogleMapsKey, GOOGLE_MAPS_API_KEY } from '@/lib/services/googleMaps';

// ─── Types ───────────────────────────────────────────────────────────────────

interface RouteAlt {
  id: string;
  coordinates: { lat: number; lng: number }[];
  selected: boolean;
}

interface LiveMapProps {
  group?: Group;
  showStart?: boolean;
  alerts?: AlertItem[];
  routeAlternatives?: RouteAlt[];
  onRouteSelect?: (id: string) => void;
  customDestination?: { lat: number; lng: number; name: string };
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function useDeviceLocation() {
  const [loc, setLoc] = useState<google.maps.LatLngLiteral | null>(null);
  useEffect(() => {
    if (!navigator.geolocation) return;
    navigator.geolocation.getCurrentPosition(
      (p) => setLoc({ lat: p.coords.latitude, lng: p.coords.longitude }),
      () => {},
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
    );
  }, []);
  return loc;
}

// ─── Inner map content (needs to be a child of <APIProvider>) ────────────────

function MapContent({
  group,
  showStart,
  alerts,
  routeAlternatives,
  onRouteSelect,
  customDestination,
  deviceLoc,
}: LiveMapProps & { deviceLoc: google.maps.LatLngLiteral | null }) {
  const map = useMap();
  const [showRoute, setShowRoute] = useState(true);
  const [activePopup, setActivePopup] = useState<string | null>(null);
  const polylinesRef = useRef<google.maps.Polyline[]>([]);

  const validMembers = group ? group.members.filter((m) => m.lat !== 0 && m.lng !== 0) : [];

  const destLat = customDestination ? customDestination.lat : (group?.destinationLat ?? 0);
  const destLng = customDestination ? customDestination.lng : (group?.destinationLng ?? 0);
  const destName = customDestination ? customDestination.name : (group?.destination ?? 'Destination');
  const hasDestination = destLat !== 0 || destLng !== 0;

  // Centre: prefer device location, then group members, then destination
  const center: google.maps.LatLngLiteral =
    deviceLoc ??
    (validMembers.length
      ? {
          lat: validMembers.reduce((s, m) => s + m.lat, 0) / validMembers.length,
          lng: validMembers.reduce((s, m) => s + m.lng, 0) / validMembers.length,
        }
      : hasDestination
      ? { lat: destLat, lng: destLng }
      : { lat: 19.076, lng: 72.8777 }); // Mumbai default

  // ── Draw route polylines ──────────────────────────────────────────────────

  useEffect(() => {
    if (!map) return;

    // Clear old polylines
    polylinesRef.current.forEach((p) => p.setMap(null));
    polylinesRef.current = [];

    if (!showRoute || !routeAlternatives?.length) return;

    routeAlternatives.forEach((alt) => {
      const line = new google.maps.Polyline({
        path:         alt.coordinates,
        strokeColor:  alt.selected ? '#19BFFF' : '#6B7280',
        strokeWeight: alt.selected ? 5 : 4,
        strokeOpacity: alt.selected ? 1 : 0.6,
        map,
      });
      if (onRouteSelect) {
        line.addListener('click', () => onRouteSelect(alt.id));
      }
      polylinesRef.current.push(line);
    });

    return () => {
      polylinesRef.current.forEach((p) => p.setMap(null));
      polylinesRef.current = [];
    };
  }, [map, routeAlternatives, showRoute, onRouteSelect]);

  // ── Fit bounds whenever routes change ────────────────────────────────────

  useEffect(() => {
    if (!map || !routeAlternatives?.length) return;
    const bounds = new google.maps.LatLngBounds();
    routeAlternatives.forEach((alt) => alt.coordinates.forEach((c) => bounds.extend(c)));
    if (deviceLoc) bounds.extend(deviceLoc);
    if (hasDestination) bounds.extend({ lat: destLat, lng: destLng });
    if (!bounds.isEmpty()) map.fitBounds(bounds, 60);
  }, [map, routeAlternatives]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Fit bounds on first mount if no routes ────────────────────────────────

  useEffect(() => {
    if (!map) return;
    const bounds = new google.maps.LatLngBounds();
    validMembers.forEach((m) => bounds.extend({ lat: m.lat, lng: m.lng }));
    if (hasDestination) bounds.extend({ lat: destLat, lng: destLng });
    if (deviceLoc) bounds.extend(deviceLoc);
    if (!bounds.isEmpty() && bounds.getNorthEast()?.toString() !== bounds.getSouthWest()?.toString()) {
      map.fitBounds(bounds, 70);
    } else {
      map.setCenter(center);
      map.setZoom(15);
    }
  }, [map]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Control handlers ─────────────────────────────────────────────────────

  const handleLocateMe = useCallback(() => {
    if (!map) return;
    const me = group?.members.find((m) => m.isCurrentUser);
    if (me && me.lat !== 0 && me.lng !== 0) {
      map.panTo({ lat: me.lat, lng: me.lng });
      map.setZoom(16);
    } else if (deviceLoc) {
      map.panTo(deviceLoc);
      map.setZoom(16);
    }
  }, [map, group, deviceLoc]);

  const handleFitGroup = useCallback(() => {
    if (!map) return;
    const bounds = new google.maps.LatLngBounds();
    validMembers.forEach((m) => bounds.extend({ lat: m.lat, lng: m.lng }));
    if (hasDestination) bounds.extend({ lat: destLat, lng: destLng });
    if (deviceLoc) bounds.extend(deviceLoc);
    routeAlternatives?.forEach((alt) => alt.coordinates.forEach((c) => bounds.extend(c)));
    if (!bounds.isEmpty()) map.fitBounds(bounds, 60);
    else { map.setCenter(center); map.setZoom(15); }
  }, [map, validMembers, hasDestination, destLat, destLng, deviceLoc, routeAlternatives, center]);

  // Show current-user marker (live device location when no group member coords)
  const currentUserMarkers: { id: string; lat: number; lng: number; name: string; status: string; isCurrentUser: boolean }[] =
    group
      ? group.members.filter((m) => m.isCurrentUser && m.lat !== 0 && m.lng !== 0)
      : deviceLoc
      ? [{ id: 'me', lat: deviceLoc.lat, lng: deviceLoc.lng, name: 'You', status: 'safe', isCurrentUser: true }]
      : [];

  return (
    <>
      {/* ── Map ─────────────────────────────────────────────────────────── */}
      <Map
        defaultCenter={center}
        defaultZoom={15}
        mapId="rally-live-map"
        disableDefaultUI
        gestureHandling="greedy"
        style={{ width: '100%', height: '100%' }}
        colorScheme="DARK"
      />

      {/* ── Destination marker ───────────────────────────────────────────── */}
      {hasDestination && (
        <AdvancedMarker
          position={{ lat: destLat, lng: destLng }}
          onClick={() => setActivePopup('dest')}
        >
          <div
            style={{
              width: 16, height: 16,
              borderRadius: 4,
              background: '#19BFFF',
              transform: 'rotate(45deg)',
              boxShadow: '0 0 14px rgba(25,191,255,0.8)',
              border: '2px solid white',
            }}
          />
          {activePopup === 'dest' && (
            <InfoWindow onClose={() => setActivePopup(null)} position={{ lat: destLat, lng: destLng }}>
              <div style={{ color: '#000', fontSize: 12, fontWeight: 600 }}>{destName}</div>
              <div style={{ color: '#888', fontSize: 11 }}>Destination</div>
            </InfoWindow>
          )}
        </AdvancedMarker>
      )}

      {/* ── Start marker (route planning) ───────────────────────────────── */}
      {showStart && group && group.route.length > 0 && (
        <AdvancedMarker position={{ lat: group.route[0].lat, lng: group.route[0].lng }}>
          <div style={{ width: 16, height: 16, borderRadius: '50%', background: '#34D399', border: '2px solid white', boxShadow: '0 0 10px rgba(52,211,153,0.8)' }} />
        </AdvancedMarker>
      )}

      {/* ── Alert markers ───────────────────────────────────────────────── */}
      {alerts?.map((a) => {
        const m = group?.members.find((mem) => mem.id === a.memberId);
        if (!m) return null;
        return (
          <AdvancedMarker
            key={a.id}
            position={{ lat: m.lat + 0.0008, lng: m.lng + 0.0008 }}
            onClick={() => setActivePopup(`alert-${a.id}`)}
          >
            <div style={{ width: 22, height: 22, borderRadius: 6, background: '#F59E0B', border: '2px solid #0A0A0A', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#0A0A0A', fontSize: 13, fontWeight: 900, boxShadow: '0 0 8px rgba(245,158,11,0.7)' }}>!</div>
            {activePopup === `alert-${a.id}` && (
              <InfoWindow onClose={() => setActivePopup(null)} position={{ lat: m.lat + 0.0008, lng: m.lng + 0.0008 }}>
                <div style={{ color: '#000', fontSize: 12, fontWeight: 600 }}>{a.message}</div>
                <div style={{ color: '#888', fontSize: 11 }}>{a.detail}</div>
              </InfoWindow>
            )}
          </AdvancedMarker>
        );
      })}

      {/* ── Member markers ───────────────────────────────────────────────── */}
      {[...currentUserMarkers, ...(group ? group.members.filter((m) => !m.isCurrentUser && m.lat !== 0 && m.lng !== 0) : [])].map((m: any) => {
        const style = STATUS_STYLE[m.status as keyof typeof STATUS_STYLE] || STATUS_STYLE.safe;
        return (
          <AdvancedMarker
            key={m.id}
            position={{ lat: m.lat, lng: m.lng }}
            onClick={() => setActivePopup(`member-${m.id}`)}
          >
            <div style={{ position: 'relative', width: 36, height: 36, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <div style={{ position: 'absolute', width: '100%', height: '100%', borderRadius: '50%', background: style.hex, opacity: 0.3 }} />
              <div style={{ width: 28, height: 28, borderRadius: '50%', background: '#0A0A0A', border: `2px solid ${style.hex}`, color: '#fff', fontSize: 11, fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: `0 0 10px ${style.hex}` }}>
                {m.name.charAt(0)}
              </div>
              {m.isCurrentUser && (
                <div style={{ position: 'absolute', bottom: -14, left: '50%', transform: 'translateX(-50%)', fontSize: 9, fontWeight: 700, color: style.hex, letterSpacing: '0.05em', whiteSpace: 'nowrap' }}>
                  YOU
                </div>
              )}
            </div>
            {activePopup === `member-${m.id}` && (
              <InfoWindow onClose={() => setActivePopup(null)} position={{ lat: m.lat, lng: m.lng }}>
                <div style={{ color: '#000', fontSize: 12, fontWeight: 700 }}>
                  {m.name} {m.isCurrentUser && <span style={{ color: '#888', fontWeight: 400, fontSize: 10 }}>(You)</span>}
                </div>
                <div style={{ color: '#888', fontSize: 11 }}>{style.label} · {m.speedKmh ?? 0} km/h</div>
              </InfoWindow>
            )}
          </AdvancedMarker>
        );
      })}

      {/* ── Floating map controls ───────────────────────────────────────── */}
      <div className="absolute top-4 right-4 z-[1000] flex flex-col gap-2">
        <MapControlButton onClick={handleLocateMe} label="Recenter">
          <LocateFixed className="w-4 h-4" />
        </MapControlButton>
        <div className="flex flex-col rounded-xl overflow-hidden border border-white/10 bg-[#0A0A0A]/90 backdrop-blur">
          <button
            onClick={() => map?.setZoom((map.getZoom() ?? 15) + 1)}
            aria-label="Zoom in"
            className="w-9 h-9 flex items-center justify-center text-white hover:bg-white/10 transition-colors"
          >
            <Plus className="w-4 h-4" />
          </button>
          <div className="h-px bg-white/10" />
          <button
            onClick={() => map?.setZoom((map.getZoom() ?? 15) - 1)}
            aria-label="Zoom out"
            className="w-9 h-9 flex items-center justify-center text-white hover:bg-white/10 transition-colors"
          >
            <Minus className="w-4 h-4" />
          </button>
        </div>
        <MapControlButton onClick={handleFitGroup} label="Fit group">
          <Maximize className="w-4 h-4" />
        </MapControlButton>
        <MapControlButton onClick={() => setShowRoute((v) => !v)} label="Toggle route" active={showRoute}>
          <RouteIcon className="w-4 h-4" />
        </MapControlButton>
      </div>
    </>
  );
}

// ─── Root export ──────────────────────────────────────────────────────────────

export default function LiveMap(props: LiveMapProps) {
  const deviceLoc = useDeviceLocation();

  // ── Missing API key banner ─────────────────────────────────────────────────
  if (!hasGoogleMapsKey()) {
    return (
      <div className="w-full h-full min-h-[420px] rounded-2xl border border-amber-500/30 bg-amber-500/5 flex flex-col items-center justify-center gap-4 p-6 text-center">
        <AlertTriangle className="w-8 h-8 text-amber-400 shrink-0" />
        <div>
          <p className="text-sm font-semibold text-amber-300 mb-1">Google Maps API key required</p>
          <p className="text-xs text-muted-foreground max-w-xs">
            Add <code className="bg-white/10 px-1 rounded text-amber-200">NEXT_PUBLIC_GOOGLE_MAPS_API_KEY</code> to{' '}
            <code className="bg-white/10 px-1 rounded text-amber-200">frontend/.env.local</code> and restart the dev server.
          </p>
          <p className="text-xs text-muted-foreground mt-2">
            Enable: <strong>Maps JavaScript API</strong>, <strong>Places API (New)</strong>, and <strong>Routes API</strong> in your Google Cloud project.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="relative w-full h-full min-h-[420px] rounded-2xl overflow-hidden border border-border">
      <APIProvider apiKey={GOOGLE_MAPS_API_KEY} libraries={['places', 'geometry']}>
        <MapContent {...props} deviceLoc={deviceLoc} />
      </APIProvider>
    </div>
  );
}

// ─── Shared control button ────────────────────────────────────────────────────

function MapControlButton({
  onClick, label, children, active,
}: {
  onClick: () => void;
  label: string;
  children: React.ReactNode;
  active?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      aria-label={label}
      title={label}
      className={`w-9 h-9 rounded-xl flex items-center justify-center border backdrop-blur transition-colors ${
        active
          ? 'bg-rally-blue/20 border-rally-blue/50 text-rally-blue'
          : 'bg-[#0A0A0A]/90 border-white/10 text-white hover:bg-white/10'
      }`}
    >
      {children}
    </button>
  );
}
