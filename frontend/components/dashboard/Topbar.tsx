'use client';

import Link from 'next/link';
import { Wifi, WifiOff, MapPin, Siren } from 'lucide-react';
import type { Group } from '@/lib/mock/types';

interface TopbarProps {
  group: Group | null;
  online?: boolean;
  gpsState?: 'active' | 'off' | 'waiting' | 'unavailable';
}

const GPS_STYLE = {
  active:      { dot: 'bg-emerald-400', text: 'text-emerald-400', label: 'GPS Active' },
  off:         { dot: 'bg-muted-foreground', text: 'text-muted-foreground', label: 'GPS Off' },
  waiting:     { dot: 'bg-amber-400 animate-pulse', text: 'text-amber-400', label: 'Waiting for GPS' },
  unavailable: { dot: 'bg-red-400', text: 'text-red-400', label: 'GPS Unavailable' },
};

export default function Topbar({ group, online = true, gpsState = 'off' }: TopbarProps) {
  const gps = GPS_STYLE[gpsState];
  const hasSOS = Boolean(group?.activeSOS && group.activeSOS.length > 0);

  return (
    <header className="sticky top-0 z-30 h-14 px-4 md:px-6 flex items-center justify-between bg-card/90 backdrop-blur-md border-b border-border">
      <div className="flex items-center gap-3 min-w-0">
        <p className="text-sm font-semibold text-foreground truncate">
          {group?.name ?? 'RALLY'}
        </p>
        {hasSOS && (
          <Link
            href="/dashboard/trip"
            className="flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-red-600 text-white text-[11px] font-black uppercase tracking-wider animate-pulse shadow-[0_0_12px_rgba(239,68,68,0.6)]"
          >
            <Siren className="w-3.5 h-3.5" />
            SOS Active ({group?.activeSOS?.length})
          </Link>
        )}
      </div>

      <div className="flex items-center gap-4 shrink-0">
        <span
          className={`hidden sm:inline-flex items-center gap-1.5 text-xs font-medium ${
            online ? 'text-muted-foreground' : 'text-red-400'
          }`}
        >
          {online ? <Wifi className="w-3.5 h-3.5" /> : <WifiOff className="w-3.5 h-3.5" />}
          {online ? 'Connected' : 'Reconnecting…'}
        </span>

        <span className={`inline-flex items-center gap-1.5 text-xs font-medium ${gps.text}`}>
          <span className={`w-1.5 h-1.5 rounded-full ${gps.dot}`} />
          {gps.label}
        </span>
      </div>
    </header>
  );
}
