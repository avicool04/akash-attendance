import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

export const supabase = createClient(supabaseUrl, supabaseAnonKey);

/** Convert plain User ID to the internal email used by Supabase Auth */
export function toAuthEmail(userId: string): string {
  return `${userId.toLowerCase().trim()}@akash.internal`;
}

/** Extract User ID from internal email */
export function fromAuthEmail(email: string): string {
  return email.replace('@akash.internal', '');
}
