'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { MapPin, Check, X, MessageSquare, Plus, Clock, AlertCircle } from 'lucide-react';
import * as groupsApi from '@/lib/api/groups';
import type { ApiDestinationSuggestion } from '@/lib/api/types';
import { searchDestination, Destination } from '@/lib/services/geocoding';

interface DestinationSuggestionsProps {
  groupId: string;
  isLeader: boolean;
  onDestinationApproved?: (newDestination: string, lat?: number, lng?: number) => void;
}

export default function DestinationSuggestions({
  groupId,
  isLeader,
  onDestinationApproved,
}: DestinationSuggestionsProps) {
  const [suggestions, setSuggestions] = useState<ApiDestinationSuggestion[]>([]);
  const [loading, setLoading] = useState(false);
  const [showModal, setShowModal] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<Destination[]>([]);
  const [searching, setSearching] = useState(false);
  const [rejectingId, setRejectingId] = useState<string | null>(null);
  const [rejectionReason, setRejectionReason] = useState('');
  const [actionError, setActionError] = useState<string | null>(null);

  const loadSuggestions = useCallback(async () => {
    try {
      const data = await groupsApi.listSuggestions(groupId);
      setSuggestions(data);
    } catch (err) {
      console.warn('Failed to load destination suggestions:', err);
    }
  }, [groupId]);

  useEffect(() => {
    loadSuggestions();
    const interval = setInterval(loadSuggestions, 10000);
    return () => clearInterval(interval);
  }, [loadSuggestions]);

  const handleSearch = async (query: string) => {
    setSearchQuery(query);
    if (!query.trim()) {
      setSearchResults([]);
      return;
    }
    setSearching(true);
    try {
      const results = await searchDestination(query);
      setSearchResults(results);
    } catch {
      setSearchResults([]);
    } finally {
      setSearching(false);
    }
  };

  const handleSuggest = async (dest: Destination) => {
    setActionError(null);
    setLoading(true);
    try {
      await groupsApi.suggestDestination(groupId, {
        destination_name: dest.name,
        latitude: dest.latitude,
        longitude: dest.longitude,
      });
      setShowModal(false);
      setSearchQuery('');
      setSearchResults([]);
      await loadSuggestions();
    } catch (err: any) {
      setActionError(err?.message || 'Failed to submit destination suggestion.');
    } finally {
      setLoading(false);
    }
  };

  const handleApprove = async (sugg: ApiDestinationSuggestion) => {
    setActionError(null);
    try {
      await groupsApi.approveSuggestion(groupId, sugg.id);
      await loadSuggestions();
      if (onDestinationApproved) {
        onDestinationApproved(sugg.destination_name, sugg.latitude, sugg.longitude);
      }
    } catch (err: any) {
      setActionError(err?.message || 'Failed to approve suggestion.');
    }
  };

  const handleReject = async (suggId: string) => {
    if (!rejectionReason.trim()) {
      setActionError('Please provide a reason for rejecting the destination.');
      return;
    }
    setActionError(null);
    try {
      await groupsApi.rejectSuggestion(groupId, suggId, rejectionReason.trim());
      setRejectingId(null);
      setRejectionReason('');
      await loadSuggestions();
    } catch (err: any) {
      setActionError(err?.message || 'Failed to reject suggestion.');
    }
  };

  const pendingSuggestions = suggestions.filter((s) => s.status === 'PENDING');

  return (
    <div className="bg-card border border-border rounded-2xl p-5 mb-5 shadow-sm">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <MapPin className="w-5 h-5 text-rally-blue" />
          <h3 className="font-semibold text-foreground text-sm sm:text-base">Destination Suggestions</h3>
          {pendingSuggestions.length > 0 && (
            <span className="px-2 py-0.5 rounded-full text-xs font-bold bg-rally-blue/20 text-rally-blue">
              {pendingSuggestions.length} pending
            </span>
          )}
        </div>
        <button
          onClick={() => setShowModal(true)}
          className="px-3 py-1.5 rounded-xl bg-primary text-primary-foreground text-xs font-semibold hover:opacity-90 transition-opacity flex items-center gap-1.5 shadow-sm"
        >
          <Plus className="w-3.5 h-3.5" />
          Suggest Alternative
        </button>
      </div>

      {actionError && (
        <div className="p-3 mb-3 rounded-xl bg-destructive/10 border border-destructive/20 text-destructive text-xs flex items-center gap-2">
          <AlertCircle className="w-4 h-4 shrink-0" />
          <span>{actionError}</span>
        </div>
      )}

      {suggestions.length === 0 ? (
        <p className="text-xs text-muted-foreground py-2">
          No destination suggestions yet. Members can propose alternative rally endpoints here.
        </p>
      ) : (
        <div className="space-y-2.5 max-h-60 overflow-y-auto pr-1">
          {suggestions.map((s) => (
            <div
              key={s.id}
              className={`p-3 rounded-xl border transition-all ${
                s.status === 'APPROVED'
                  ? 'bg-emerald-500/10 border-emerald-500/30'
                  : s.status === 'REJECTED'
                  ? 'bg-muted/30 border-border opacity-70'
                  : 'bg-card border-border hover:border-rally-blue/50'
              }`}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="flex-1">
                  <div className="flex items-center gap-2">
                    <span className="font-semibold text-xs sm:text-sm text-foreground">{s.destination_name}</span>
                    <span
                      className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${
                        s.status === 'APPROVED'
                          ? 'bg-emerald-500/20 text-emerald-400'
                          : s.status === 'REJECTED'
                          ? 'bg-destructive/20 text-destructive'
                          : 'bg-amber-500/20 text-amber-400'
                      }`}
                    >
                      {s.status}
                    </span>
                  </div>
                  {s.rejection_reason && (
                    <p className="text-[11px] text-destructive/90 mt-1 italic">
                      Reason: {s.rejection_reason}
                    </p>
                  )}
                </div>

                {isLeader && s.status === 'PENDING' && (
                  <div className="flex items-center gap-1.5 shrink-0">
                    <button
                      onClick={() => handleApprove(s)}
                      title="Approve destination"
                      className="px-2.5 py-1 rounded-lg bg-emerald-600 text-white text-xs font-semibold hover:bg-emerald-500 transition-colors flex items-center gap-1"
                    >
                      <Check className="w-3 h-3" />
                      Approve
                    </button>
                    <button
                      onClick={() => {
                        setRejectingId(s.id);
                        setRejectionReason('');
                      }}
                      title="Reject destination"
                      className="px-2 py-1 rounded-lg border border-border text-xs text-muted-foreground hover:bg-destructive/20 hover:text-destructive transition-colors flex items-center gap-1"
                    >
                      <X className="w-3 h-3" />
                      Reject
                    </button>
                  </div>
                )}
              </div>

              {rejectingId === s.id && (
                <div className="mt-3 pt-3 border-t border-border flex flex-col gap-2">
                  <input
                    type="text"
                    value={rejectionReason}
                    onChange={(e) => setRejectionReason(e.target.value)}
                    placeholder="Enter rejection reason (e.g., Road inaccessible)..."
                    className="w-full bg-background border border-border rounded-lg px-3 py-1.5 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-rally-blue"
                  />
                  <div className="flex justify-end gap-2">
                    <button
                      onClick={() => setRejectingId(null)}
                      className="px-2 py-1 rounded-lg text-xs text-muted-foreground hover:text-foreground"
                    >
                      Cancel
                    </button>
                    <button
                      onClick={() => handleReject(s.id)}
                      className="px-3 py-1 rounded-lg bg-destructive text-white text-xs font-semibold hover:opacity-90"
                    >
                      Confirm Rejection
                    </button>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {showModal && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-card border border-border rounded-2xl p-5 w-full max-w-md shadow-2xl animate-in zoom-in-95 duration-150">
            <div className="flex items-center justify-between mb-4">
              <h4 className="font-bold text-foreground text-sm sm:text-base">Suggest Alternative Destination</h4>
              <button
                onClick={() => setShowModal(false)}
                className="w-7 h-7 rounded-lg border border-border flex items-center justify-center text-muted-foreground hover:text-foreground"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <p className="text-xs text-muted-foreground mb-3">
              Search and propose an alternative endpoint. The group leader will review and can approve or reject your suggestion.
            </p>

            <div className="relative mb-3">
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => handleSearch(e.target.value)}
                placeholder="Search place or landmark..."
                className="w-full bg-background border border-border rounded-xl px-4 py-2.5 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-rally-blue"
              />
            </div>

            <div className="max-h-48 overflow-y-auto space-y-1 mb-4">
              {searching && <p className="text-xs text-muted-foreground text-center py-2">Searching...</p>}
              {!searching && searchResults.length === 0 && searchQuery && (
                <p className="text-xs text-muted-foreground text-center py-2">No matching locations found.</p>
              )}
              {searchResults.map((dest, i) => (
                <button
                  key={i}
                  onClick={() => handleSuggest(dest)}
                  disabled={loading}
                  className="w-full text-left p-2.5 rounded-xl hover:bg-white/5 transition-colors border border-transparent hover:border-border text-xs flex items-center justify-between"
                >
                  <span className="font-semibold text-foreground">{dest.name}</span>
                  <span className="text-[10px] text-muted-foreground">Select</span>
                </button>
              ))}
            </div>

            <div className="flex justify-end">
              <button
                onClick={() => setShowModal(false)}
                className="px-4 py-2 rounded-xl border border-border text-xs font-semibold text-muted-foreground hover:text-foreground transition-colors"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
