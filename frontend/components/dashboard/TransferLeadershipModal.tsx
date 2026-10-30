'use client';

/**
 * TransferLeadershipModal — Modal for safely transferring group leadership.
 *
 * Enforces:
 * - Only active group members can be selected
 * - Prevents selecting self or invalid members
 * - Explains consequences clearly
 * - Supports both standalone transfer and "Transfer & Leave" flow
 * - Loading and error states
 */

import React, { useState } from 'react';
import { Crown, X, Loader2, AlertCircle, CheckCircle2, UserCheck } from 'lucide-react';
import type { Member } from '@/lib/mock/types';

interface TransferLeadershipModalProps {
  isOpen: boolean;
  onClose: () => void;
  members: Member[];
  onTransfer: (newLeaderId: string, leaveAfter: boolean) => Promise<void>;
  isLeavingFlow?: boolean;
}

export default function TransferLeadershipModal({
  isOpen,
  onClose,
  members,
  onTransfer,
  isLeavingFlow = false,
}: TransferLeadershipModalProps) {
  // Eligible candidates: active members other than the current leader
  const eligibleMembers = members.filter((m) => !m.isCurrentUser && m.role !== 'Leader');
  const [selectedMemberId, setSelectedMemberId] = useState<string>(
    eligibleMembers.length > 0 ? eligibleMembers[0].id : ''
  );
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  if (!isOpen) return null;

  const handleConfirm = async () => {
    if (!selectedMemberId) {
      setErrorMessage('Please select an eligible member to receive leadership.');
      return;
    }
    setErrorMessage(null);
    setIsSubmitting(true);
    try {
      await onTransfer(selectedMemberId, isLeavingFlow);
      onClose();
    } catch (err: any) {
      setErrorMessage(err?.message || 'Failed to transfer leadership. Please try again.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const selectedMember = eligibleMembers.find((m) => m.id === selectedMemberId);

  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/70 backdrop-blur-sm p-4 animate-in fade-in duration-200">
      <div className="w-full max-w-md rounded-2xl border border-border bg-card p-6 shadow-2xl relative text-foreground space-y-5">
        {/* Close Button */}
        <button
          type="button"
          onClick={onClose}
          disabled={isSubmitting}
          className="absolute top-4 right-4 p-1 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted transition-colors disabled:opacity-40"
        >
          <X className="w-5 h-5" />
        </button>

        {/* Header */}
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-amber-500/10 border border-amber-500/30 text-amber-400 flex items-center justify-center shrink-0">
            <Crown className="w-5 h-5" />
          </div>
          <div>
            <h2 className="text-lg font-bold text-foreground">
              {isLeavingFlow ? 'Transfer Leadership to Leave' : 'Transfer Group Leadership'}
            </h2>
            <p className="text-xs text-muted-foreground mt-0.5">
              {isLeavingFlow
                ? 'A group must have a leader. Assign a new leader before leaving.'
                : 'Pass group management and route control to another member.'}
            </p>
          </div>
        </div>

        {/* Error message */}
        {errorMessage && (
          <div className="p-3 rounded-xl bg-red-500/10 border border-red-500/30 text-red-400 text-xs flex items-start gap-2">
            <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
            <span>{errorMessage}</span>
          </div>
        )}

        {/* Member selection */}
        {eligibleMembers.length === 0 ? (
          <div className="p-4 rounded-xl border border-border bg-background text-center text-xs text-muted-foreground">
            No other active members in this group. You are currently the sole member.
          </div>
        ) : (
          <div className="space-y-2">
            <label className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">
              Select New Leader
            </label>
            <div className="max-h-56 overflow-y-auto space-y-2 pr-1">
              {eligibleMembers.map((member) => {
                const isSelected = member.id === selectedMemberId;
                return (
                  <div
                    key={member.id}
                    onClick={() => !isSubmitting && setSelectedMemberId(member.id)}
                    className={`flex items-center justify-between p-3 rounded-xl border cursor-pointer transition-all ${
                      isSelected
                        ? 'border-amber-500/50 bg-amber-500/10 text-foreground'
                        : 'border-border bg-background/50 hover:bg-background text-muted-foreground hover:text-foreground'
                    }`}
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <div className="w-8 h-8 rounded-full bg-rally-blue/15 border border-rally-blue/30 text-rally-blue font-bold flex items-center justify-center text-xs shrink-0">
                        {member.name.charAt(0).toUpperCase()}
                      </div>
                      <div className="min-w-0">
                        <p className="text-sm font-semibold truncate text-foreground">
                          {member.name}
                        </p>
                        <p className="text-[10px] text-muted-foreground flex items-center gap-1.5">
                          <span
                            className={`w-1.5 h-1.5 rounded-full ${
                              member.online ? 'bg-emerald-400' : 'bg-muted-foreground'
                            }`}
                          />
                          {member.online ? 'Online' : 'Offline'}
                        </p>
                      </div>
                    </div>

                    {isSelected && (
                      <CheckCircle2 className="w-4 h-4 text-amber-400 shrink-0" />
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Description note */}
        {selectedMember && (
          <p className="text-xs text-muted-foreground leading-relaxed">
            {isLeavingFlow ? (
              <>
                <strong className="text-foreground">{selectedMember.name}</strong> will become the new leader of this RALLY, and your membership will be removed.
              </>
            ) : (
              <>
                <strong className="text-foreground">{selectedMember.name}</strong> will become the new leader. You will remain in this RALLY as a member.
              </>
            )}
          </p>
        )}

        {/* Actions */}
        <div className="flex items-center justify-end gap-3 pt-2 border-t border-border">
          <button
            type="button"
            onClick={onClose}
            disabled={isSubmitting}
            className="px-4 py-2 rounded-xl text-xs font-semibold text-muted-foreground hover:text-foreground hover:bg-muted transition-colors disabled:opacity-40"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleConfirm}
            disabled={isSubmitting || !selectedMemberId || eligibleMembers.length === 0}
            className={`flex items-center gap-2 px-5 py-2.5 rounded-xl text-xs font-bold transition-all disabled:opacity-40 ${
              isLeavingFlow
                ? 'bg-red-500 hover:bg-red-600 text-white'
                : 'bg-amber-500 hover:bg-amber-600 text-black'
            }`}
          >
            {isSubmitting ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                Transferring…
              </>
            ) : (
              <>
                <UserCheck className="w-4 h-4" />
                {isLeavingFlow ? 'Transfer & Leave' : 'Confirm Transfer'}
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
