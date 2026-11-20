'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase';

type BaseLocation = { id: string; name: string; location_type: string; address: string | null; latitude: number; longitude: number };

export default function EmployeePage() {
  const router = useRouter();
  const [name, setName] = useState('Employee');
  const [code, setCode] = useState('');
  const [designation, setDesignation] = useState('');
  const [location, setLocation] = useState<BaseLocation | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    async function load() {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { router.replace('/'); return; }
      const { data: profile, error } = await supabase.from('profiles')
        .select('full_name,first_name,middle_name,last_name,employee_code,designation,base_location_id,status,role')
        .eq('id', user.id).single();
      if (error || !profile || profile.status !== 'active' || !['employee','site_manager'].includes(profile.role)) {
        await supabase.auth.signOut(); router.replace('/'); return;
      }
      if (!active) return;
      setName([profile.first_name, profile.middle_name, profile.last_name].filter(Boolean).join(' ') || profile.full_name || 'Employee');
      setCode(profile.employee_code || '');
      setDesignation(profile.designation || (profile.role === 'site_manager' ? 'Site Manager' : 'Team member'));
      if (profile.base_location_id) {
        const { data: loc } = await supabase.from('work_locations')
          .select('id,name,location_type,address,latitude,longitude')
          .eq('id', profile.base_location_id).maybeSingle();
        if (active && loc) setLocation(loc as BaseLocation);
      }
      if (active) setLoading(false);
    }
    void load();
    return () => { active = false; };
  }, [router]);

  if (loading) return <div className="loading-screen">Preparing your workspace…</div>;
  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand"><div className="brand-mark">A</div><div><div className="brand-name">AKASH ENTERPRISES</div><div className="brand-sub">Workforce portal</div></div></div>
        <div className="nav-label">MY WORKSPACE</div>
        <a className="nav-link active" href="/employee"><span className="nav-icon">▦</span> My overview</a>
        <div className="sidebar-bottom">
          <div className="user-mini"><div className="avatar">{name.split(' ').map(x => x[0]).slice(0,2).join('').toUpperCase()}</div><div><div className="user-mini-name">{name}</div><div className="user-mini-role">{designation}</div></div></div>
          <button className="button button-secondary" style={{ width: '100%', marginTop: 17, background: '#20392d', borderColor: '#385343', color: '#dcebe1' }} onClick={async () => { await supabase.auth.signOut(); router.replace('/'); }}>↪ &nbsp; Sign out</button>
        </div>
      </aside>
      <main className="main-area">
        <header className="topbar"><div className="mobile-brand"><div className="brand-mark" style={{ width: 32, height: 32, borderRadius: 10 }}>A</div><strong style={{ font: '800 12px Manrope' }}>AKASH ENTERPRISES</strong></div><div className="crumb">My workspace <span style={{ color: '#bdc7c0', margin: '0 8px' }}>/</span> Overview</div><div className="topbar-right"><span className="top-date">{new Intl.DateTimeFormat('en-IN',{dateStyle:'medium'}).format(new Date())}</span><button className="button button-secondary top-logout" onClick={async () => { await supabase.auth.signOut(); router.replace('/'); router.refresh(); }}>Log out ↗</button></div></header>
        <div className="content">
          <div className="page-heading"><div><div className="eyebrow">EMPLOYEE WORKSPACE</div><h1>My workspace</h1><p>Your assigned work location and employee details.</p></div><span className="pill pill-active">Account active</span></div>
          <section className="stats-grid" style={{ gridTemplateColumns: 'repeat(2,minmax(0,1fr))' }}>
            <div className="stat-card"><div className="stat-top">Employee ID <span className="stat-icon">♙</span></div><div className="stat-value" style={{ fontSize: 22 }}>{code || '—'}</div><div className="stat-foot">{designation}</div></div>
            <div className="stat-card"><div className="stat-top">Assigned location <span className="stat-icon">⌖</span></div><div className="stat-value" style={{ fontSize: 22 }}>{location?.name || 'Not assigned'}</div><div className="stat-foot">{location ? (location.location_type === 'office' ? 'Office' : 'Project site') : 'Please contact HR to get a location assigned'}</div></div>
          </section>
          <section className="panel">
            <div className="panel-head"><div><h2 className="panel-title">My work location</h2><p className="panel-subtitle">Your designated base location as maintained by HR</p></div><span className="stat-icon">⌖</span></div>
            <div className="panel-body">
              {location ? <><div style={{ font: '800 20px Manrope', marginBottom: 8 }}>{location.name}</div><p style={{ color: '#78867d', fontSize: 12, marginBottom: 14 }}>{location.address || 'No address provided'}</p><div style={{ color: '#718078', fontSize: 11 }}>Registered coordinates: {Number(location.latitude).toFixed(5)}, {Number(location.longitude).toFixed(5)}</div></> : <div className="empty-state"><div className="empty-icon">⌖</div><strong>No base location assigned</strong><p style={{ margin: '7px 0 0' }}>HR will assign your office or project site.</p></div>}
            </div>
          </section>
          <section className="panel" style={{ marginTop: 18 }}>
            <div className="panel-body" style={{ display: 'flex', alignItems: 'center', gap: 15 }}>
              <div className="stat-icon" style={{ width: 42, height: 42, flex: '0 0 42px' }}>◷</div>
              <div><div style={{ fontWeight: 700, fontSize: 13 }}>Attendance workspace</div><div style={{ color: '#849188', fontSize: 11, marginTop: 4 }}>GPS and selfie-verified check-in and check-out will be enabled in the next build.</div></div>
            </div>
          </section>
        </div>
      </main>
    </div>
  );
}
