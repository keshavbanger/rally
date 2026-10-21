'use client';

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { env } from '@/lib/env';

/**
 * One browser Supabase client for the whole app (Singleton pattern).
 * Supabase Auth is the ONLY thing this frontend uses Supabase's own client for —
 * every other read/write goes through FastAPI (see lib/api/client.ts).
 *
 * A module-level singleton ensures exactly ONE GoTrueClient instance exists in the
 * browser context, preventing "Multiple GoTrueClient instances detected in the same browser context".
 */
/**
 * Strict Singleton instance attached to globalThis so Next.js Fast Refresh
 * and HMR do not recreate GoTrueClient instances across re-evaluations.
 */
interface GlobalWithSupabase {
  __rally_supabase_client__?: SupabaseClient;
}

const globalStore = (typeof globalThis !== 'undefined' ? globalThis : window) as unknown as GlobalWithSupabase;

export function getSupabaseClient(): SupabaseClient {
  if (globalStore.__rally_supabase_client__) {
    return globalStore.__rally_supabase_client__;
  }

  const client = createClient(env.supabaseUrl, env.supabaseAnonKey, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
    },
  });

  globalStore.__rally_supabase_client__ = client;
  return client;
}

/**
 * Shared singleton factory for components and custom hooks.
 * Reuses the single browser client instance instead of calling createClient repeatedly.
 */
export const createBrowserClient = (): SupabaseClient => getSupabaseClient();

/**
 * Shared client export for direct usage: `import { supabase } from '@/lib/supabase/client';`
 */
export const supabase: SupabaseClient = getSupabaseClient();

