'use client';

import React, { useState } from 'react';
import { Siren, Check, CheckCircle2, XCircle, MapPin, Loader2, AlertCircle } from 'lucide-react';
import type { ApiSOSEvent } from '@/lib/api/types';

interface SOSBannerProps {
  activeSOS: ApiSOSEvent[];
  currentUserId: string | null;
  onAcknowledge: (sosId: string) => Promise<void>;
  onResolve: (sosId: string) => Promise<void>;
  onCancel: (sosId: string) => Promise<void>;
}

export default function SOSBanner({
  activeSOS,
  currentUserId,
  onAcknowledge,
  onResolve,
  onCancel,
}: SOSBannerProps) {
  const [busyId, setBusyId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  if (!activeSOS || activeSOS.length === 0) return null;

  const handleAction = async (sosId: string, actionFn: (id: string) => Promise<void>) => {
    setBusyId(sosId);
    setActionError(null);
    try {
      await actionFn(sosId);
    } catch (err: any) {
      setActionError(err?.message || 'Operation failed. Please try again.');
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="w-full space-y-3 z-30 animate-in slide-in-from-top-4 duration-300">
      {actionError && (
        <div className="p-2.5 rounded-xl bg-red-950/80 border border-red-500/40 text-xs text-red-200 flex items-center justify-between">
          <span>{actionError}</span>
          <button onClick={() => setActionError(null)} className="text-red-400 hover:text-white font-bold text-xs ml-2">
            Dismiss
          </button>
        </div>
      )}

      {activeSOS.map((sos) => {
        const isMine = currentUserId != null && sos.user_id === currentUserId;
        const isAck = sos.status === 'ACKNOWLEDGED';
        const isBusy = busyId === sos.id;

        return (
          <div
            key={sos.id}
            className="w-full rounded-2xl bg-red-950/90 border-2 border-red-500 shadow-[0_0_30px_rgba(239,68,68,0.35)] p-4 sm:p-5 flex flex-col md:flex-row items-start md:items-center justify-between gap-4 backdrop-blur-xl text-white"
          >
            {/* Left: Siren & details */}
            <div className="flex items-start gap-3.5 min-w-0">
              <div className="w-11 h-11 rounded-xl bg-red-600/30 border border-red-500/50 text-red-400 flex items-center justify-center shrink-0 animate-bounce">
                <Siren className="w-6 h-6" />
              </div>
              <div className="min-w-0 space-y-0.5">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="px-2 py-0.5 rounded-full bg-red-600 text-[10px] font-black uppercase tracking-wider text-white">
                    EMERGENCY SOS ACTIVE
                  </span>
                  {isAck && (
                    <span className="px-2 py-0.5 rounded-full bg-amber-500/20 border border-amber-500/40 text-[10px] font-bold text-amber-300 uppercase tracking-wider">
                      ACKNOWLEDGED
                    </span>
                  )}
                  {isMine && (
                    <span className="px-2 py-0.5 rounded-full bg-white/10 text-[10px] font-medium text-white/90">
                      Triggered by You
                    </span>
                  )}
                </div>
                <p className="text-sm font-bold text-white truncate">
                  {sos.message ? `"${sos.message}"` : isMine ? 'Your emergency broadcast is active.' : 'A group member needs emergency assistance!'}
                </p>
                <div className="flex items-center gap-3 text-xs text-red-200/80 font-mono">
                  <span className="flex items-center gap-1">
                    <MapPin className="w-3.5 h-3.5 text-red-400" />
                    {sos.latitude.toFixed(5)}, {sos.longitude.toFixed(5)}
                  </span>
                  <span>•</span>
                  <span>{new Date(sos.triggered_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}</span>
                </div>
              </div>
            </div>

            {/* Right: Actions */}
            <div className="flex items-center gap-2.5 w-full md:w-auto shrink-0 justify-end">
              {isMine ? (
                <button
                  onClick={() => handleAction(sos.id, onCancel)}
                  disabled={isBusy}
                  className="w-full md:w-auto px-4 py-2 rounded-xl bg-white/10 hover:bg-white/20 border border-white/20 text-xs font-bold text-white transition-colors flex items-center justify-center gap-1.5 disabled:opacity-50"
                >
                  {isBusy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <XCircle className="w-4 h-4 text-red-400" />}
                  Cancel My SOS
                </button>
              ) : (
                <>
                  {!isAck && (
                    <button
                      onClick={() => handleAction(sos.id, onAcknowledge)}
                      disabled={isBusy}
                      className="px-3.5 py-2 rounded-xl bg-amber-500/20 hover:bg-amber-500/30 border border-amber-500/40 text-xs font-bold text-amber-300 transition-colors flex items-center gap-1.5 disabled:opacity-50"
                    >
                      {isBusy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
                      Acknowledge
                    </button>
                  )}
                  <button
                    onClick={() => handleAction(sos.id, onResolve)}
                    disabled={isBusy}
                    className="px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-xs font-bold text-white shadow-md transition-colors flex items-center gap-1.5 disabled:opacity-50"
                  >
                    {isBusy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
                    Mark Resolved
                  </button>
                </>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
