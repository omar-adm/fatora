// ─────────────────────────────────────────────────────
//  auth.js
// ─────────────────────────────────────────────────────
import sb from './Supabase.js';

export async function getUser() {
  const { data } = await sb.auth.getUser();
  return data.user ?? null;
}

export async function getProfile(userId) {
  const { data } = await sb.from('profiles').select('*').eq('id', userId).maybeSingle();
  return data ?? null;
}

export function isAdmin(profile) {
  return profile?.role === 'admin';
}

export async function signInWithGoogle() {
  const { error } = await sb.auth.signInWithOAuth({
    provider: 'google',
    options: {
      redirectTo: window.location.origin + window.location.pathname,
    },
  });
  if (error) throw error;
}

export async function signOut() {
  await sb.auth.signOut();
}

export function onAuthChange(cb) {
  const { data: { subscription } } = sb.auth.onAuthStateChange(
    (_e, session) => cb(session?.user ?? null)
  );
  return () => subscription.unsubscribe();
}