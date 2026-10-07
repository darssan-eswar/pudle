import 'react-native-url-polyfill/auto';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { createClient } from '@supabase/supabase-js';

// Publishable (anon) key only: safe in a client, access is enforced by row-level security.
export const SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL ?? '';
const KEY = process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? '';

export const configured = SUPABASE_URL.startsWith('https://') && KEY.length > 0 && !KEY.startsWith('sb_secret_');

export const supabase = createClient(configured ? SUPABASE_URL : 'https://invalid.supabase.co', configured ? KEY : 'x', {
  auth: { storage: AsyncStorage, autoRefreshToken: true, persistSession: true, detectSessionInUrl: false },
});
