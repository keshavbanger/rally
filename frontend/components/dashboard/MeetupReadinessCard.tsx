'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { Flag, CheckCircle, Clock, AlertCircle, Users, Check } from 'lucide-react';
import * as groupsApi from '@/lib/api/groups';
import type { ArrivalStatus } from '@/lib/api/types';

interface MeetupReadinessCardProps {
  groupId: string;
  isLeader: boolean;
  meetupName?: string | null;
  onReadinessChanged?: () => void;
}

export default function MeetupReadinessCard({
  groupId,
  isLeader,
  meetupName,
  onReadinessChanged,
}: MeetupReadinessCardProps) {
  const [readiness, setReadiness] = useState<{
    total_members: number;
    ready_members: number;
    arrived_members: number;
    all_ready: boolean;
    readiness_percentage: number;
  } | null>(null);
  const [myStatus, setMyStatus] = useState<ArrivalStatus>('NOT_ARRIVED');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchReadiness = useCallback(async () => {
    try {
      const data = await groupsApi.getReadiness(groupId);
      setReadiness(data);
    } catch (err) {
      console.warn('Failed to fetch readiness status:', err);
    }
  }, [groupId]);

  useEffect(() => {
    fetchReadiness();
    const interval = setInterval(fetchReadiness, 5000);
    return () => clearInterval(interval);
  }, [fetchReadiness]);

  const handleStatusChange = async (status: ArrivalStatus) => {
    setLoading(true);
    setError(null);
    try {
      await groupsApi.updateReadiness(groupId, status);
      setMyStatus(status);
      await fetchReadiness();
      if (onReadinessChanged) onReadinessChanged();
    } catch (err: any) {
      setError(err?.message || 'Failed to update readiness status.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="bg-card border border-border rounded-2xl p-5 mb-5 shadow-sm">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <Flag className="w-5 h-5 text-amber-500" />
          <div>
            <h3 className="font-semibold text-foreground text-sm sm:text-base">Meetup Point Coordination</h3>
            {meetupName && (
              <p className="text-xs text-muted-foreground">Gathering at: <span className="font-medium text-foreground">{meetupName}</span></p>
            )}
          </div>
        </div>

        {readiness && (
          <span
            className={`px-2.5 py-1 rounded-full text-xs font-bold ${
              readiness.all_ready
                ? 'bg-emerald-500/20 text-emerald-400'
                : 'bg-amber-500/20 text-amber-400'
            }`}
          >
            {readiness.all_ready ? 'All Members Ready' : `${readiness.ready_members} / ${readiness.total_members} Ready`}
          </span>
        )}
      </div>

      {readiness && (
        <div className="mb-4">
          <div className="flex justify-between text-xs text-muted-foreground mb-1.5 font-medium">
            <span>Readiness Progress</span>
            <span>{readiness.readiness_percentage}%</span>
          </div>
          <div className="w-full h-2 bg-muted rounded-full overflow-hidden">
            <div
              className="h-full bg-emerald-500 transition-all duration-300"
              style={{ width: `${readiness.readiness_percentage}%` }}
            />
          </div>
        </div>
      )}

      {error && (
        <div className="p-2.5 mb-3 rounded-xl bg-destructive/10 border border-destructive/20 text-destructive text-xs flex items-center gap-2">
          <AlertCircle className="w-4 h-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      <div className="border-t border-border pt-3 flex flex-col sm:flex-row items-center justify-between gap-3">
        <span className="text-xs font-medium text-muted-foreground">Update your arrival status:</span>
        <div className="flex items-center gap-2 w-full sm:w-auto">
          <button
            onClick={() => handleStatusChange('ARRIVED')}
            disabled={loading}
            className={`flex-1 sm:flex-none px-3 py-1.5 rounded-xl border text-xs font-semibold transition-all ${
              myStatus === 'ARRIVED'
                ? 'bg-amber-500/20 border-amber-500 text-amber-400'
                : 'border-border bg-card text-muted-foreground hover:bg-white/5'
            }`}
          >
            I&apos;ve Arrived
          </button>
          <button
            onClick={() => handleStatusChange('READY')}
            disabled={loading}
            className={`flex-1 sm:flex-none px-3 py-1.5 rounded-xl border text-xs font-semibold transition-all flex items-center justify-center gap-1.5 ${
              myStatus === 'READY'
                ? 'bg-emerald-500/20 border-emerald-500 text-emerald-400'
                : 'border-border bg-card text-muted-foreground hover:bg-white/5'
            }`}
          >
            <Check className="w-3.5 h-3.5" />
            I&apos;m Ready to Ride
          </button>
        </div>
      </div>
    </div>
  );
}
