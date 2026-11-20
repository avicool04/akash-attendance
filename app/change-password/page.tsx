'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase';

export default function ChangePasswordPage() {
  const router = useRouter();
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); setError('');
    if (password.length < 8) { setError('Use at least 8 characters for your new password.'); return; }
    if (password !== confirm) { setError('The passwords do not match.'); return; }
    setSaving(true);
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { router.replace('/'); return; }
    const { error: passwordError } = await supabase.auth.updateUser({ password });
    if (passwordError) { setError(passwordError.message); setSaving(false); return; }
    const { error: profileError } = await supabase.from('profiles')
      .update({ must_change_password: false }).eq('id', user.id);
    if (profileError) { setError('Password changed, but your account status could not be updated. Contact HR.'); setSaving(false); return; }
    const { data: profile } = await supabase.from('profiles').select('role').eq('id', user.id).single();
    router.replace(profile?.role === 'employee' || profile?.role === 'site_manager' ? '/employee' : '/admin');
  }

  return <main className="login-form-side" style={{ minHeight: '100vh' }}><div className="login-card">
    <div className="login-brand"><div className="brand-mark">A</div><div><div className="brand-name" style={{ color: '#183629' }}>Akash Enterprises</div><div className="brand-sub" style={{ color: '#87958b' }}>Account security</div></div></div>
    <div className="eyebrow">ONE-TIME SETUP</div><h1>Update your password</h1><p className="intro">Choose a new password before continuing to your workspace.</p>
    <form onSubmit={submit}>
      <div className="field"><label htmlFor="newPassword">New password</label><input id="newPassword" type="password" value={password} onChange={e => setPassword(e.target.value)} autoComplete="new-password" minLength={8} required /></div>
      <div className="field"><label htmlFor="confirmPassword">Confirm new password</label><input id="confirmPassword" type="password" value={confirm} onChange={e => setConfirm(e.target.value)} autoComplete="new-password" minLength={8} required /></div>
      {error && <div className="notice notice-error">{error}</div>}
      <button className="button button-primary" type="submit" disabled={saving}>{saving ? 'Updating…' : 'Save new password'}</button>
    </form>
  </div></main>;
}
