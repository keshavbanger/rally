'use client';

import React, { useState } from 'react';
import { Siren, AlertTriangle, Loader2, X, MapPin } from 'lucide-react';

interface SOSModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: (message?: string) => Promise<void>;
  deviceLocation?: { latitude: number; longitude: number; accuracy?: number } | null;
}

export default function SOSModal({
  isOpen,
  onClose,
  onConfirm,
  deviceLocation,
}: SOSModalProps) {
  const [message, setMessage] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!isOpen) return null;

  const handleConfirm = async () => {
    setError(null);
    setSubmitting(true);
    try {
      await onConfirm(message.trim() || undefined);
      onClose();
    } catch (err: any) {
      setError(err?.message || 'Failed to trigger SOS. Please check connection and retry.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md animate-in fade-in duration-200">
      <div
        className="w-full max-w-lg rounded-2xl bg-[#0F0F12] border-2 border-red-500/50 shadow-[0_0_50px_rgba(239,68,68,0.3)] p-6 space-y-6 relative text-foreground"
        role="dialog"
        aria-modal="true"
        aria-labelledby="sos-modal-title"
      >
        {/* Close button */}
        <button
          onClick={onClose}
          disabled={submitting}
          className="absolute top-4 right-4 p-2 rounded-xl text-muted-foreground hover:text-white hover:bg-white/10 transition-colors disabled:opacity-50"
          aria-label="Close"
        >
          <X className="w-5 h-5" />
        </button>

        {/* Header with Siren */}
        <div className="flex items-center gap-4">
          <div className="w-14 h-14 rounded-2xl bg-red-500/20 border border-red-500/40 text-red-500 flex items-center justify-center shrink-0 animate-pulse">
            <Siren className="w-8 h-8" />
          </div>
          <div>
            <h2 id="sos-modal-title" className="text-xl font-bold text-white tracking-tight flex items-center gap-2">
              Trigger Emergency SOS
            </h2>
            <p className="text-xs text-red-400 font-medium tracking-wide uppercase mt-0.5">
              High-priority broadcast to all group members
            </p>
          </div>
        </div>

        {/* Warning copy */}
        <div className="p-3.5 rounded-xl bg-red-500/10 border border-red-500/20 text-xs text-red-300 leading-relaxed">
          <p className="font-semibold mb-1 flex items-center gap-1.5 text-red-200">
            <AlertTriangle className="w-4 h-4 shrink-0" />
            Confirmation Required
          </p>
          This will immediately notify all active group members with your exact coordinates and open an emergency incident in this trip.
        </div>

        {/* Live GPS Coordinates Preview */}
        <div className="rounded-xl border border-white/10 bg-white/[0.02] p-3 text-xs space-y-1">
          <div className="flex items-center justify-between text-muted-foreground">
            <span className="flex items-center gap-1.5 font-medium">
              <MapPin className="w-3.5 h-3.5 text-red-400" />
              Broadcast Coordinates
            </span>
            <span className="font-mono text-[11px]">
              {deviceLocation ? `±${Math.round(deviceLocation.accuracy ?? 10)}m accuracy` : 'Fetching fix...'}
            </span>
          </div>
          <p className="font-mono text-white text-xs">
            {deviceLocation
              ? `${deviceLocation.latitude.toFixed(6)}, ${deviceLocation.longitude.toFixed(6)}`
              : 'GPS position will be captured upon submission.'}
          </p>
        </div>

        {/* Optional emergency message */}
        <div className="space-y-1.5">
          <label htmlFor="sos-message" className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
            Emergency Note (Optional)
          </label>
          <input
            id="sos-message"
            type="text"
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            disabled={submitting}
            placeholder="e.g. Flat tire, medical assistance, separated from group"
            maxLength={140}
            className="w-full px-3.5 py-2.5 rounded-xl bg-white/5 border border-white/10 text-sm text-white placeholder:text-muted-foreground/60 focus:outline-none focus:border-red-500 focus:ring-1 focus:ring-red-500"
          />
        </div>

        {/* Error notice */}
        {error && (
          <div className="p-3 rounded-xl bg-red-500/20 border border-red-500/40 text-xs text-red-200">
            {error}
          </div>
        )}

        {/* Actions */}
        <div className="flex flex-col sm:flex-row items-center gap-3 pt-2">
          <button
            type="button"
            onClick={onClose}
            disabled={submitting}
            className="w-full sm:w-1/3 py-3 rounded-xl bg-white/5 border border-white/10 text-sm font-semibold text-white hover:bg-white/10 transition-colors disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleConfirm}
            disabled={submitting}
            className="w-full sm:w-2/3 py-3 rounded-xl bg-red-600 hover:bg-red-500 active:bg-red-700 text-white text-sm font-bold shadow-[0_0_20px_rgba(239,68,68,0.4)] transition-all flex items-center justify-center gap-2 disabled:opacity-60"
          >
            {submitting ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                Broadcasting Emergency...
              </>
            ) : (
              <>
                <Siren className="w-4 h-4" />
                Confirm & Broadcast SOS
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
