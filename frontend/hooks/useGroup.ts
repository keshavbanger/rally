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
  const [group, setGroup] = useState<Group | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // Give the current state immediately (in case init already ran).
    setGroup(rallyGroupService.getCurrentGroup());
    setLoading(false);

    const unsub = rallyGroupService.subscribe((g) => {
      setGroup(g);
      setLoading(false);
    });

    return unsub;
  }, []);

  return { group, loading, service: rallyGroupService };
}