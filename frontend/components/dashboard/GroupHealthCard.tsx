'use client';

/**
 * GroupHealthCard — Real-time Group Health & Risk Telemetry.
 *
 * Displays:
 * - Overall rule-based group health score: 0–100
 * - Togetherness percentage (members within safe cohesion corridor)
 * - On-route percentage (members adhering to planned route)
 * - Connectivity percentage (members actively transmitting telemetry)
 * - Stability percentage (stability penalized by active alerts and SOS)
 * - Active alert count & current risk level
 * - Last updated timestamp & explicit handling for insufficient/stale data
 */

import React from 'react';
import {
  ShieldCheck,
  ShieldAlert,
  Wifi,
  Navigation2,
  Users,
  Activity,
  AlertTriangle,
  Clock,
  CheckCircle2,
} from 'lucide-react';
import type { Group } from '@/lib/mock/types';
import RiskRing from './RiskRing';

export default function GroupHealthCard({ group }: { group: Group }) {
  const gh = group.groupHealth;

  // Fallback calculations if backend dashboard payload is still loading or connecting
  const onlineCount = group.members.filter((m) => m.online).length;
  const totalMembers = Math.max(1, group.members.length);
  const activeAlertsCount = group.alerts.filter((a) => a.status === 'active').length;
  const criticalCount = group.alerts.filter(
    (a) => a.status === 'active' && a.severity === 'critical'
  ).length;

  const connectivityPct =
    gh?.connectivity_percent != null
      ? gh.connectivity_percent
      : Math.round((onlineCount / totalMembers) * 100);

  const togethernessPct = gh?.togetherness_percent != null ? gh.togetherness_percent : null;
  const onRoutePct = gh?.on_route_percent != null ? gh.on_route_percent : null;

  const stabilityPct =
    gh?.stability_percent != null
      ? gh.stability_percent
      : Math.max(0, Math.min(100, 100 - activeAlertsCount * 10 - criticalCount * 20));

  const healthScore =
    gh?.health_score != null
      ? gh.health_score
      : Math.round(
          connectivityPct * 0.4 +
            stabilityPct * 0.4 +
            (togethernessPct != null ? togethernessPct * 0.2 : 15)
        );

  const statusLabel =
    gh?.status_label ??
    (group.activeSOS && group.activeSOS.length > 0
      ? 'RISK'
      : healthScore >= 85
      ? 'OPTIMAL'
      : healthScore >= 70
      ? 'STABLE'
      : healthScore >= 50
      ? 'ATTENTION'
      : 'RISK');

  const riskColor =
    statusLabel === 'OPTIMAL' || statusLabel === 'STABLE'
      ? '#34D399'
      : statusLabel === 'ATTENTION'
      ? '#FBBF24'
      : '#F87171';

  const updatedTime = gh?.updated_at
    ? new Date(gh.updated_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
    : 'Live';

  return (
    <div className="rounded-2xl border border-border bg-card p-5 shadow-xl w-full text-foreground space-y-4">
      {/* Header */}
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <Activity className="w-4 h-4 text-rally-blue" />
            <h3 className="text-[11px] font-bold uppercase tracking-[0.15em] text-muted-foreground">
              Group Health & Risk Telemetry
            </h3>
          </div>
          <p className="text-xs text-muted-foreground mt-0.5 flex items-center gap-1.5">
            <span>{onlineCount} / {group.members.length} members connected</span>
            <span>·</span>
            <span className="flex items-center gap-1 font-mono text-[10px]">
              <Clock className="w-3 h-3 text-muted-foreground/70" />
              {updatedTime}
            </span>
          </p>
        </div>

        <span
          className="text-[11px] font-bold px-2.5 py-1 rounded-full uppercase tracking-wider"
          style={{
            color: riskColor,
            backgroundColor: `${riskColor}15`,
            border: `1px solid ${riskColor}30`,
          }}
        >
          {statusLabel}
        </span>
      </div>

      {/* Main Composite Score Display */}
      <div className="flex items-center justify-between gap-4 p-4 rounded-xl bg-background/60 border border-border/80">
        <div className="flex items-center gap-4">
          <div className="flex flex-col">
            <span className="text-3xl font-black font-mono tracking-tight text-foreground">
              {healthScore != null ? healthScore : '—'}
              <span className="text-xs text-muted-foreground font-normal">/100</span>
            </span>
            <span className="text-[10px] text-muted-foreground font-semibold uppercase tracking-wider mt-0.5">
              Health Index
            </span>
          </div>

          <div className="h-8 w-px bg-border" />

          <div>
            <p className="text-xs font-bold" style={{ color: riskColor }}>
              {group.risk.level}
            </p>
            <p className="text-[11px] text-muted-foreground">
              {activeAlertsCount} active alert{activeAlertsCount === 1 ? '' : 's'}
              {(group.activeSOS?.length ?? 0) > 0 ? ` · ${group.activeSOS!.length} SOS` : ''}
            </p>
          </div>
        </div>

        <div className="shrink-0">
          <RiskRing risk={group.risk} size={54} />
        </div>
      </div>

      {/* 4 Telemetry Metrics */}
      <div className="space-y-3 pt-1">
        {/* Togetherness */}
        <div className="space-y-1.5">
          <div className="flex items-center justify-between text-xs">
            <span className="flex items-center gap-1.5 text-muted-foreground">
              <Users className="w-3.5 h-3.5 text-emerald-400" />
              Togetherness
            </span>
            <span className="font-mono font-bold text-foreground">
              {togethernessPct != null ? `${togethernessPct}%` : 'Awaiting GPS'}
            </span>
          </div>
          <div className="w-full h-1.5 bg-muted rounded-full overflow-hidden">
            <div
              className="h-full bg-emerald-400 rounded-full transition-all duration-500"
              style={{ width: `${togethernessPct ?? (onlineCount > 0 ? 100 : 0)}%` }}
            />
          </div>
        </div>

        {/* On-Route */}
        <div className="space-y-1.5">
          <div className="flex items-center justify-between text-xs">
            <span className="flex items-center gap-1.5 text-muted-foreground">
              <Navigation2 className="w-3.5 h-3.5 text-rally-blue" />
              On-Route Alignment
            </span>
            <span className="font-mono font-bold text-foreground">
              {onRoutePct != null ? `${onRoutePct}%` : 'Route Inactive'}
            </span>
          </div>
          <div className="w-full h-1.5 bg-muted rounded-full overflow-hidden">
            <div
              className="h-full bg-rally-blue rounded-full transition-all duration-500"
              style={{ width: `${onRoutePct ?? (group.route?.length ? 100 : 0)}%` }}
            />
          </div>
        </div>

        {/* Connectivity */}
        <div className="space-y-1.5">
          <div className="flex items-center justify-between text-xs">
            <span className="flex items-center gap-1.5 text-muted-foreground">
              <Wifi className="w-3.5 h-3.5 text-blue-400" />
              Live Connectivity
            </span>
            <span className="font-mono font-bold text-foreground">
              {connectivityPct}%
            </span>
          </div>
          <div className="w-full h-1.5 bg-muted rounded-full overflow-hidden">
            <div
              className="h-full bg-blue-400 rounded-full transition-all duration-500"
              style={{ width: `${connectivityPct}%` }}
            />
          </div>
        </div>

        {/* Stability */}
        <div className="space-y-1.5">
          <div className="flex items-center justify-between text-xs">
            <span className="flex items-center gap-1.5 text-muted-foreground">
              <ShieldCheck className="w-3.5 h-3.5 text-amber-400" />
              Fleet Stability
            </span>
            <span className="font-mono font-bold text-foreground">
              {stabilityPct}%
            </span>
          </div>
          <div className="w-full h-1.5 bg-muted rounded-full overflow-hidden">
            <div
              className="h-full rounded-full transition-all duration-500"
              style={{
                width: `${stabilityPct}%`,
                backgroundColor: stabilityPct > 75 ? '#34D399' : stabilityPct > 50 ? '#FBBF24' : '#F87171',
              }}
            />
          </div>
        </div>
      </div>

      {/* Footer / Method disclaimer */}
      <div className="pt-2 border-t border-border flex items-center justify-between text-[10px] text-muted-foreground">
        <span>Deterministic rule-based composite</span>
        <span className="font-mono">Live WebSocket</span>
      </div>
    </div>
  );
}
