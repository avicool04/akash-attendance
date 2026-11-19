'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { supabase, toAuthEmail } from '@/lib/supabase';

export default function LoginPage() {
  const router = useRouter();
  const [userId, setUserId] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [checking, setChecking] = useState(true);

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session) {
        checkRoleAndRedirect(session.user.id);
      } else {
        setChecking(false);
      }
    });
  }, []);

  async function checkRoleAndRedirect(uid: string) {
    const { data } = await supabase
      .from('profiles')
      .select('role')
      .eq('id', uid)
      .single();

    if (data?.role === 'admin') {
      router.replace('/admin');
    } else {
      router.replace('/employee');
    }
  }

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      const email = toAuthEmail(userId);
      const { data, error: authError } = await supabase.auth.signInWithPassword({
        email,
        password,
      });

      if (authError) {
        setError(authError.message || 'Invalid User ID or Password');
        setLoading(false);
        return;
      }

      if (data.user) {
        await checkRoleAndRedirect(data.user.id);
      }
    } catch (err: any) {
      setError(err.message || 'Login failed');
      setLoading(false);
    }
  }

  if (checking) {
    return (
      <div className="container" style={{ paddingTop: '4rem', textAlign: 'center' }}>
        <p className="muted">Loading…</p>
      </div>
    );
  }

  return (
    <div>
      <header className="header">
        <div className="logo">
          <img src="/logo.png" alt="Akash Enterprises" style={{ height: 40, width: 'auto' }} />
          <div>
            <strong>Akash Enterprises</strong>
            <div style={{ fontSize: '0.8rem', opacity: 0.9 }}>Attendance System</div>
          </div>
        </div>
      </header>

      <div className="container" style={{ paddingTop: '2rem' }}>
        <div className="card">
          <h1 style={{ fontSize: '1.35rem', marginBottom: '0.25rem' }}>Sign In</h1>
          <p className="muted mb-2">Enter your User ID and Password</p>

          <form onSubmit={handleLogin}>
            <div className="field">
              <label>User ID</label>
              <input
                type="text"
                value={userId}
                onChange={(e) => setUserId(e.target.value)}
                placeholder="e.g. EMP001 or admin"
                required
                autoComplete="username"
              />
            </div>

            <div className="field">
              <label>Password</label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                required
                autoComplete="current-password"
              />
            </div>

            {error && <div className="status error">{error}</div>}

            <button type="submit" className="btn btn-primary mt-2" disabled={loading}>
              {loading ? 'Signing in…' : 'Sign In'}
            </button>
          </form>
        </div>

        <p className="center muted mt-2" style={{ fontSize: '0.8rem' }}>
          Credentials are provided by HR / Admin
        </p>
      </div>
    </div>
  );
}
