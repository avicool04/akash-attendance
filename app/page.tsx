'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { supabase, toAuthEmail, toLegacyAuthEmail } from '@/lib/supabase';

export default function LoginPage() {
  const router = useRouter();
  const [userId, setUserId] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [checking, setChecking] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let alive = true;
    supabase.auth.getSession().then(async ({ data: { session } }) => {
      if (!alive) return;
      if (!session) { setChecking(false); return; }
      const { data: profile } = await supabase.from('profiles').select('role,status,must_change_password').eq('id', session.user.id).maybeSingle();
      if (!alive) return;
      if (!profile || profile.status !== 'active') { await supabase.auth.signOut(); setChecking(false); return; }
      if (profile.must_change_password) router.replace('/change-password');
      else if (['hr_manager','technical_super_admin','proprietor'].includes(profile.role)) router.replace('/admin');
      else if (['employee','site_manager'].includes(profile.role)) router.replace('/employee');
      else { await supabase.auth.signOut(); setChecking(false); }
    });
    return () => { alive = false; };
  }, [router]);

  async function handleLogin(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError('');
    setLoading(true);
    let { data, error: authError } = await supabase.auth.signInWithPassword({
      email: toAuthEmail(userId),
      password,
    });
    if (authError) {
      const fallback = await supabase.auth.signInWithPassword({
        email: toLegacyAuthEmail(userId),
        password,
      });
      data = fallback.data;
      authError = fallback.error;
    }
    if (authError || !data.user) {
      setError(authError?.message || 'Unable to sign in. Check your credentials.');
      setLoading(false);
      return;
    }
    const { data: profile, error: profileError } = await supabase
      .from('profiles')
      .select('role,status,must_change_password')
      .eq('id', data.user.id)
      .single();
    if (profileError || !profile || profile.status !== 'active') {
      await supabase.auth.signOut();
      setError('Your account is inactive or is not configured. Please contact HR.');
      setLoading(false);
      return;
    }
    if (profile.must_change_password) {
      router.replace('/change-password');
      return;
    }
    if (['hr_manager', 'technical_super_admin', 'proprietor'].includes(profile.role)) {
      router.replace('/admin');
    } else if (['employee', 'site_manager'].includes(profile.role)) {
      router.replace('/employee');
    } else {
      await supabase.auth.signOut();
      setError('This account does not have portal access. Please contact HR.');
      setLoading(false);
    }
  }

  if (checking) return <div className="loading-screen">Preparing your workspace…</div>;

  return (
    <main className="login-page">
      <section className="login-visual">
        <div className="brand">
          <div className="brand-mark">A</div>
          <div><div className="brand-name">AKASH ENTERPRISES</div><div className="brand-sub">People & operations</div></div>
        </div>
        <div className="login-visual-content">
          <div className="eyebrow" style={{ color: '#b9e8c9' }}>WORKFORCE MANAGEMENT</div>
          <h2>Every site.<br />Every shift.<br /><span style={{ color: '#a8e2bd' }}>In sync.</span></h2>
          <p>A clearer view of your teams, work locations and daily attendance — all in one place.</p>
          <div className="login-feature"><span>⌖</span> Location-aware attendance</div>
          <div className="login-feature"><span>◷</span> Simple check-in and check-out</div>
          <div className="login-feature"><span>▤</span> Centralised workforce records</div>
        </div>
        <div className="login-footer">AKASH ENTERPRISES · INTERNAL WORKSPACE</div>
      </section>
      <section className="login-form-side">
        <div className="login-card">
          <div className="login-brand">
            <div className="brand-mark">A</div>
            <div><div className="brand-name" style={{ color: '#183629' }}>Akash Enterprises</div><div className="brand-sub" style={{ color: '#87958b' }}>Attendance portal</div></div>
          </div>
          <div className="eyebrow">WELCOME BACK</div>
          <h1>Sign in to your account</h1>
          <p className="intro">Use the employee ID and password shared by HR.</p>
          <form onSubmit={handleLogin}>
            <div className="field">
              <label htmlFor="userId">Employee ID</label>
              <input id="userId" value={userId} onChange={e => setUserId(e.target.value)} placeholder="e.g. AE001" autoComplete="username" required />
            </div>
            <div className="field">
              <label htmlFor="password">Password</label>
              <input id="password" type="password" value={password} onChange={e => setPassword(e.target.value)} placeholder="Enter your password" autoComplete="current-password" required />
            </div>
            {error && <div className="notice notice-error">{error}</div>}
            <button className="button button-primary" type="submit" disabled={loading}>{loading ? 'Signing in…' : 'Sign in securely  →'}</button>
          </form>
          <p style={{ color: '#9aa59e', fontSize: 11, textAlign: 'center', marginTop: 22 }}>Your access is managed by Akash Enterprises HR.</p>
        </div>
      </section>
    </main>
  );
}
