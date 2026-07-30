// Identity, rented from Supabase — and optional.
//
// If VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY aren't set (the zero-config dev/mock build,
// incl. vite.mock.config.js), `authEnabled` is false and the app skips the login gate
// entirely: getSession() resolves to a stand-in `local` session so <Studio> renders as it
// always did. Configure the two env vars and the gate turns on with no other code change.

import { createClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

export const authEnabled = Boolean(url && anonKey);

const supabase = authEnabled ? createClient(url, anonKey) : null;

// The fake session used when auth is off — enough shape that App's `!session` checks pass and
// setAuthToken(null) leaves requests unauthenticated (backend then treats them as `local`).
const LOCAL_SESSION = { user: { email: null }, access_token: null };

export async function getSession() {
  if (!authEnabled) return LOCAL_SESSION;
  const { data } = await supabase.auth.getSession();
  return data.session; // null when signed out
}

// Subscribe to sign-in / sign-out / token-refresh. Returns an unsubscribe fn.
export function onAuthChange(cb) {
  if (!authEnabled) { cb(LOCAL_SESSION); return () => {}; }
  const { data } = supabase.auth.onAuthStateChange((_event, session) => cb(session));
  return () => data.subscription.unsubscribe();
}

// Email magic-link — no password to store or verify. `emailRedirectTo` brings them back to
// this same app after they click the link.
export async function signInWithEmail(email) {
  if (!authEnabled) return;
  const { error } = await supabase.auth.signInWithOtp({
    email,
    options: { emailRedirectTo: window.location.origin },
  });
  if (error) throw new Error(error.message);
}

export async function signOut() {
  if (!authEnabled) return;
  await supabase.auth.signOut();
}
