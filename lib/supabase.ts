import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

export const supabase = createClient(supabaseUrl, supabaseAnonKey);

/** Current ERP accounts use this internal Auth email suffix. */
export function toAuthEmail(userId: string): string {
  return `${userId.toLowerCase().trim()}@users.akashenterprises.invalid`;
}

/** Compatibility with the first prototype's manually created admin account. */
export function toLegacyAuthEmail(userId: string): string {
  return `${userId.toLowerCase().trim()}@akash.internal`;
}

/** Extract the visible User ID from either internal Auth email format. */
export function fromAuthEmail(email: string): string {
  return email.split('@')[0] || '';
}
