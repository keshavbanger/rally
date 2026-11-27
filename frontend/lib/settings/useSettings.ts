'use client';

import { useEffect, useState } from 'react';
import { settingsService, DEFAULT_SETTINGS } from '@/lib/mock/settingsService';
import type { Settings } from '@/lib/mock/types';

export function useSettings() {
  // Start with defaults on both server and client — the singleton reads
  // localStorage synchronously at import time, so reading it here in the
  // initializer would mismatch the server's render. Sync for real in effect.
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [syncing, setSyncing] = useState(false);

  useEffect(() => {
    // Immediately apply cached/localStorage settings
    setSettings(settingsService.get());

    // Subscribe to future changes (from updates or backend sync)
    const unsubscribe = settingsService.subscribe(setSettings);

    // Kick off backend sync — first render shows localStorage, then updates
    setSyncing(true);
    settingsService
      .syncWithBackend()
      .finally(() => setSyncing(false));

    return unsubscribe;
  }, []);

  const update = (patch: Partial<Settings>) => settingsService.update(patch);

  return { settings, update, syncing };
}
