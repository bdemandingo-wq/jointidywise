/**
 * UNIFIED SUPABASE CLIENT
 * 
 * Session persistence is ENABLED for better mobile app experience.
 * On native (Capacitor), uses @capacitor/preferences for storage.
 * On web, uses localStorage.
 */

import { createClient } from '@supabase/supabase-js';
import type { Database } from '@/integrations/supabase/types';
import { Capacitor } from '@capacitor/core';
import { getStorageAdapter } from '@/lib/capacitorStorage';
import { SUPABASE_PUBLIC_ANON_KEY, SUPABASE_PUBLIC_URL } from '@/lib/supabasePublicEnv';
import { installDemoGate } from '@/lib/demo/gate';

// Supabase anon key is intentionally public — security enforced via RLS policies.
const SUPABASE_URL = SUPABASE_PUBLIC_URL;
const SUPABASE_PUBLISHABLE_KEY = SUPABASE_PUBLIC_ANON_KEY;

const isNative = Capacitor.isNativePlatform();

/**
 * Supabase client with session persistence enabled
 * - Native: uses Capacitor Preferences for reliable persistence
 * - Web: uses localStorage
 * - detectSessionInUrl: false on native (deep links handled manually)
 */
export const supabase = createClient<Database>(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    storage: getStorageAdapter(),
    detectSessionInUrl: !isNative,
  }
});

// Sample demo swaps business reads for in-memory rows and refuses writes.
// Auth stays on this same client. The gate is a no-op until demo is on.
installDemoGate(supabase as never);
