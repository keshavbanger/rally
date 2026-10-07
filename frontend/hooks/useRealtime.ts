'use client';

import { useEffect, useState } from 'react';
import { rallyGroupService } from '@/lib/realtime/RallyGroupService';
import type { ConnectionStatus, ServerMessage } from '@/lib/ws/types';

/**
 * Exposes the live WebSocket connection status and the most recent server
 * message from the RallyGroupService singleton.
 *
 * The service owns the single TripSocket instance; this hook simply surfaces
 * its state so components can react to connectivity changes and incoming
 * real-time frames without managing the socket themselves.
 *
 * - `connectionStatus` — CONNECTING | CONNECTED | DISCONNECTED |
 *                        RECONNECTING | ERROR  (from lib/ws/types.ts).
 * - `lastMessage`      — the most recent ServerMessage received, or null.
 *                        Components that need to act on specific message
 *                        types (e.g. sos, alert) should filter by
 *                        lastMessage.type inside a useEffect.
 * - `isConnected`      — convenience boolean (status === 'CONNECTED').
 *
 * This hook does NOT open or close the socket — the service owns the
 * lifecycle and connects/disconnects automatically based on trip state.
 */
export function useRealtime(): {
  connectionStatus: ConnectionStatus;
  lastMessage: ServerMessage | null;
  isConnected: boolean;
} {
  const [connectionStatus, setConnectionStatus] = useState<ConnectionStatus>(
    rallyGroupService.getConnectionStatus()
  );
  const [lastMessage, setLastMessage] = useState<ServerMessage | null>(null);

  useEffect(() => {
    // Subscribe to connection status changes (CONNECTING, CONNECTED, etc.)
    const unsubStatus = rallyGroupService.subscribeConnectionStatus((status) => {
      setConnectionStatus(status);
    });

    // Subscribe to incoming WebSocket messages.
    // RallyGroupService processes each message itself (updating livePositions,
    // triggering refreshes) and then re-emits them here so components can
    // react to specific types (e.g. to flash an SOS banner) without
    // duplicating the service's internal logic.
    // Note: `subscribeMessages` is added below to RallyGroupService as a
    // thin pass-through — see implementation note in the docstring.
    const unsubMessages = rallyGroupService.subscribeMessages((msg) => {
      setLastMessage(msg);
    });

    return () => {
      unsubStatus();
      unsubMessages();
    };
  }, []);

  return {
    connectionStatus,
    lastMessage,
    isConnected: connectionStatus === 'CONNECTED',
  };
}