'use client';

import { useEffect, useState } from 'react';
import { rallyGroupService } from '@/lib/realtime/RallyGroupService';
import type { Group } from '@/lib/mock/types';
import type { GroupService } from '@/lib/mock/groupService';

/**
 * Subscribes to the RallyGroupService singleton and returns the current
 * group state. Mirrors lib/mock/useGroup.ts shape so any component that
 * was working against the mock switches to real data with no prop changes.
 *
 * - `group`   — null while loading OR when the user has no active group.
 * - `loading` — true only during the first async init.
 * - `service` — full GroupService for callers that need createGroup /
 *               joinGroup / endTrip / sendSOS / etc.
 */
export function useGroup(): {
  group: Group | null;
  loading: boolean;
  service: GroupService;
} {
  const [group, setGroup] = useState<Group | null>(() => rallyGroupService.getCurrentGroup());
  // If the service already has a group (e.g. just created/joined), start with
  // loading=false so the dashboard renders immediately without a blank state.
  const [loading, setLoading] = useState<boolean>(() => {
    const existing = rallyGroupService.getCurrentGroup();
    return existing === null;
  });

  useEffect(() => {
    // Sync once immediately in case the service updated between render and effect
    const current = rallyGroupService.getCurrentGroup();
    if (current !== null) {
      setGroup(current);
      setLoading(false);
    }

    const unsub = rallyGroupService.subscribe((g) => {
      setGroup(g);
      setLoading(false);
    });

    // Safety: if nothing is found after 6 seconds, stop showing spinner
    const timeout = setTimeout(() => setLoading(false), 6000);

    return () => {
      unsub();
      clearTimeout(timeout);
    };
  }, []);

  return { group, loading, service: rallyGroupService };
}