/**
 * Shared Supabase client singleton re-exported from lib/supabase/client.
 * Re-exports the exact same singleton instance so all imports across the app
 * share one GoTrueClient instance.
 */
export { getSupabaseClient, createBrowserClient, supabase } from './supabase/client';
