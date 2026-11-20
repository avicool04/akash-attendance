'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase';

type Location = {
  id: string; name: string; location_type: 'office' | 'site'; address: string | null;
  latitude: number; longitude: number; site_manager_id: string | null; is_active: boolean;
};
type Employee = {
  id: string; employee_code: string | null; full_name: string; designation: string | null;
  role: string; status: string; base_location_id: string | null;
};
type FormState = {
  name: string; location_type: 'office' | 'site'; address: string;
  latitude: string; longitude: string; site_manager_id: string;
};
const blankForm: FormState = { name: '', location_type: 'site', address: '', latitude: '', longitude: '', site_manager_id: '' };

export default function AdminPage() {
  const router = useRouter();
  const [userName, setUserName] = useState('HR Team');
  const [userId, setUserId] = useState('');
  const [locations, setLocations] = useState<Location[]>([]);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [form, setForm] = useState<FormState>(blankForm);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [selectedEmployee, setSelectedEmployee] = useState('');
  const [selectedLocation, setSelectedLocation] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [locating, setLocating] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  const loadData = useCallback(async () => {
    const { data: authData, error: authError } = await supabase.auth.getUser();
    if (authError || !authData.user) { router.replace('/'); return; }
    const { data: profile, error: profileError } = await supabase
      .from('profiles').select('full_name,role,status').eq('id', authData.user.id).single();
    if (profileError || !profile || profile.status !== 'active') { await supabase.auth.signOut(); router.replace('/'); return; }
    if (!['hr_manager', 'technical_super_admin'].includes(profile.role)) { router.replace(profile.role === 'employee' || profile.role === 'site_manager' ? '/employee' : '/'); return; }
    setUserId(authData.user.id);
    setUserName(profile.full_name || 'HR Team');

    const [locRes, empRes] = await Promise.all([
      supabase.from('work_locations')
        .select('id,name,location_type,address,latitude,longitude,site_manager_id,is_active')
        .order('created_at', { ascending: false }),
      supabase.from('profiles')
        .select('id,employee_code,full_name,designation,role,status,base_location_id')
        .in('role', ['employee', 'site_manager'])
        .order('full_name'),
    ]);
    if (locRes.error) setError(locRes.error.message);
    else setLocations((locRes.data || []) as Location[]);
    if (empRes.error) setError(empRes.error.message);
    else setEmployees((empRes.data || []) as Employee[]);
    setLoading(false);
  }, [router]);

  useEffect(() => { void loadData(); }, [loadData]);

  const activeLocations = useMemo(() => locations.filter(l => l.is_active).length, [locations]);
  const assignedCount = useMemo(() => employees.filter(e => e.base_location_id).length, [employees]);
  const unassignedCount = employees.length - assignedCount;
  const managerOptions = employees.filter(e => e.role === 'site_manager' && e.status === 'active');

  function updateForm<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm(current => ({ ...current, [key]: value }));
  }
  function startEdit(location: Location) {
    setEditingId(location.id);
    setForm({
      name: location.name, location_type: location.location_type || 'site',
      address: location.address || '', latitude: String(location.latitude),
      longitude: String(location.longitude), site_manager_id: location.site_manager_id || '',
    });
    setMessage('');
    setError('');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }
  function resetForm() { setEditingId(null); setForm(blankForm); }

  function useCurrentLocation() {
    if (!navigator.geolocation) { setError('This browser does not support GPS location.'); return; }
    setLocating(true); setError('');
    navigator.geolocation.getCurrentPosition(
      position => {
        updateForm('latitude', position.coords.latitude.toFixed(7));
        updateForm('longitude', position.coords.longitude.toFixed(7));
        setLocating(false);
      },
      geoError => { setError(geoError.message || 'Could not get GPS coordinates.'); setLocating(false); },
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 }
    );
  }

  async function saveLocation(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); setSaving(true); setError(''); setMessage('');
    const latitude = Number(form.latitude), longitude = Number(form.longitude);
    if (!Number.isFinite(latitude) || latitude < -90 || latitude > 90 || !Number.isFinite(longitude) || longitude < -180 || longitude > 180) {
      setError('Enter valid latitude and longitude coordinates.'); setSaving(false); return;
    }
    const payload = {
      name: form.name.trim(), location_type: form.location_type, address: form.address.trim() || null,
      latitude, longitude, site_manager_id: form.site_manager_id || null,
    };
    const result = editingId
      ? await supabase.from('work_locations').update(payload).eq('id', editingId)
      : await supabase.from('work_locations').insert({ ...payload, created_by: userId });
    if (result.error) setError(result.error.message);
    else { setMessage(editingId ? 'Location details updated.' : 'New location added successfully.'); resetForm(); await loadData(); }
    setSaving(false);
  }

  async function toggleLocation(location: Location) {
    setError(''); setMessage('');
    const { error: updateError } = await supabase.from('work_locations')
      .update({ is_active: !location.is_active }).eq('id', location.id);
    if (updateError) setError(updateError.message);
    else { setMessage(location.is_active ? 'Location deactivated.' : 'Location activated.'); await loadData(); }
  }

  async function assignLocation(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); setError(''); setMessage('');
    if (!selectedEmployee) { setError('Select an employee first.'); return; }
    setSaving(true);
    const { error: assignError } = await supabase.rpc('assign_employee_location', {
      p_employee_id: selectedEmployee, p_location_id: selectedLocation || null,
    });
    if (assignError) setError(assignError.message);
    else { setMessage(selectedLocation ? 'Employee location assignment saved.' : 'Employee location assignment cleared.'); await loadData(); }
    setSaving(false);
  }

  if (loading) return <div className="loading-screen">Loading HR workspace…</div>;

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-mark">A</div>
          <div><div className="brand-name">AKASH ENTERPRISES</div><div className="brand-sub">Workforce portal</div></div>
        </div>
        <div className="nav-label">WORKSPACE</div>
        <a className="nav-link active" href="/admin"><span className="nav-icon">▦</span> Overview</a>
        <a className="nav-link" href="#locations"><span className="nav-icon">⌖</span> Office & Sites</a>
        <a className="nav-link" href="#assignments"><span className="nav-icon">♙</span> Employee assignments</a>
        <div className="nav-label" style={{ marginTop: 29 }}>MANAGEMENT</div>
        <span className="nav-link" style={{ opacity: .55, cursor: 'default' }}><span className="nav-icon">◷</span> Attendance records</span>
        <span className="nav-link" style={{ opacity: .55, cursor: 'default' }}><span className="nav-icon">▤</span> Reports</span>
        <div className="sidebar-bottom">
          <div className="user-mini">
            <div className="avatar">{userName.split(' ').map(x => x[0]).slice(0,2).join('').toUpperCase()}</div>
            <div><div className="user-mini-name">{userName}</div><div className="user-mini-role">HR Administrator</div></div>
          </div>
          <button className="button button-secondary" style={{ width: '100%', marginTop: 17, background: '#20392d', borderColor: '#385343', color: '#dcebe1' }} onClick={async () => { await supabase.auth.signOut(); router.replace('/'); }}>↪ &nbsp; Sign out</button>
        </div>
      </aside>

      <main className="main-area">
        <header className="topbar">
          <div className="mobile-brand"><div className="brand-mark" style={{ width: 32, height: 32, borderRadius: 10 }}>A</div><strong style={{ font: '800 12px Manrope' }}>AKASH ENTERPRISES</strong></div>
          <div className="crumb">Workspace <span style={{ color: '#bdc7c0', margin: '0 8px' }}>/</span> HR overview</div>
          <div className="topbar-right"><span className="top-date">{new Intl.DateTimeFormat('en-IN', { dateStyle: 'full' }).format(new Date())}</span><div className="icon-circle">♙</div></div>
        </header>

        <div className="content">
          <div className="page-heading">
            <div><div className="eyebrow">HR CONTROL CENTRE</div><h1>Good day, {userName.split(' ')[0]}.</h1><p>Manage your workforce, offices and project locations from one place.</p></div>
            <button className="button button-primary" onClick={() => { resetForm(); document.getElementById('location-form')?.scrollIntoView({ behavior: 'smooth' }); }}>＋ Add location</button>
          </div>

          {error && <div className="notice notice-error">{error}</div>}
          {message && <div className="notice notice-success">{message}</div>}

          <section className="stats-grid">
            <div className="stat-card"><div className="stat-top">Total locations <span className="stat-icon">⌖</span></div><div className="stat-value">{locations.length}</div><div className="stat-foot">Offices and project sites</div></div>
            <div className="stat-card"><div className="stat-top">Active locations <span className="stat-icon">✓</span></div><div className="stat-value">{activeLocations}</div><div className="stat-foot">Available for employee assignment</div></div>
            <div className="stat-card"><div className="stat-top">Employees assigned <span className="stat-icon">♙</span></div><div className="stat-value">{assignedCount}</div><div className="stat-foot">With a designated base location</div></div>
            <div className="stat-card"><div className="stat-top">Awaiting assignment <span className="stat-icon">＋</span></div><div className="stat-value">{unassignedCount}</div><div className="stat-foot">Active employees without a base location</div></div>
          </section>

          <section className="location-layout" id="locations">
            <div className="panel">
              <div className="panel-head"><div><h2 className="panel-title">Office & site locations</h2><p className="panel-subtitle">Your organisation's registered work locations</p></div><span className="pill pill-active">{activeLocations} active</span></div>
              {locations.length === 0 ? <div className="empty-state"><div className="empty-icon">⌖</div><strong>No locations added yet</strong><p style={{ margin: '7px 0 0' }}>Add your first office or project site to get started.</p></div> :
                <div className="location-list">{locations.map(location => {
                  const count = employees.filter(e => e.base_location_id === location.id).length;
                  const manager = employees.find(e => e.id === location.site_manager_id);
                  return <div className="location-row" key={location.id}>
                    <div className="location-pin">{location.location_type === 'office' ? '⌂' : '⌖'}</div>
                    <div className="location-info">
                      <div className="location-name">{location.name}</div>
                      <div className="location-meta">{location.address || 'Address not added'} · {location.latitude.toFixed(4)}, {location.longitude.toFixed(4)}</div>
                      {manager && <div className="location-meta">Site manager: {manager.full_name}</div>}
                    </div>
                    <div className="location-right">
                      <span className={'pill ' + (location.location_type === 'office' ? 'pill-office' : 'pill-site')}>{location.location_type === 'office' ? 'Office' : 'Site'}</span>
                      <span className={'pill ' + (location.is_active ? 'pill-active' : 'pill-inactive')}>{location.is_active ? 'Active' : 'Inactive'}</span>
                      <span className="count-text">{count} staff</span>
                      <button className="button button-quiet" onClick={() => startEdit(location)}>Edit</button>
                      <button className="button button-quiet" onClick={() => void toggleLocation(location)}>{location.is_active ? 'Deactivate' : 'Activate'}</button>
                    </div>
                  </div>;
                })}</div>}
            </div>

            <div className="panel" id="location-form">
              <div className="panel-head"><div><h2 className="panel-title">{editingId ? 'Edit location' : 'Add a location'}</h2><p className="panel-subtitle">Register an office or a project site</p></div><span className="stat-icon">＋</span></div>
              <div className="panel-body">
                <form onSubmit={saveLocation}>
                  <div className="field"><label>Location name *</label><input value={form.name} onChange={e => updateForm('name', e.target.value)} placeholder="e.g. Bhubaneswar Head Office" required maxLength={120} /></div>
                  <div className="field"><label>Location type *</label><select value={form.location_type} onChange={e => updateForm('location_type', e.target.value as 'office' | 'site')}><option value="site">Project Site</option><option value="office">Office</option></select></div>
                  <div className="field"><label>Address</label><input value={form.address} onChange={e => updateForm('address', e.target.value)} placeholder="Street, city, state" maxLength={300} /></div>
                  <div className="form-grid">
                    <div className="field"><label>Latitude *</label><input value={form.latitude} onChange={e => updateForm('latitude', e.target.value)} placeholder="20.2961" inputMode="decimal" required /></div>
                    <div className="field"><label>Longitude *</label><input value={form.longitude} onChange={e => updateForm('longitude', e.target.value)} placeholder="85.8245" inputMode="decimal" required /></div>
                  </div>
                  <button className="button button-secondary" type="button" style={{ width: '100%', marginBottom: 14 }} onClick={useCurrentLocation} disabled={locating}>{locating ? 'Getting GPS…' : '◎ Use my current GPS location'}</button>
                  <div className="field"><label>Site manager</label><select value={form.site_manager_id} onChange={e => updateForm('site_manager_id', e.target.value)}><option value="">Not assigned</option>{managerOptions.map(m => <option key={m.id} value={m.id}>{m.full_name}{m.employee_code ? ' · ' + m.employee_code : ''}</option>)}</select></div>
                  <p className="form-note">GPS coordinates identify the registered work location. Employee punch coordinates will be recorded separately; this setting does not create a geofence restriction.</p>
                  <div className="form-actions"><button className="button button-primary" type="submit" disabled={saving}>{saving ? 'Saving…' : editingId ? 'Save changes' : 'Create location'}</button>{editingId && <button className="button button-secondary" type="button" onClick={resetForm}>Cancel</button>}</div>
                </form>
              </div>
            </div>
          </section>

          <section className="panel assign-panel" id="assignments">
            <div className="panel-head"><div><h2 className="panel-title">Employee location assignment</h2><p className="panel-subtitle">Set or change each employee's designated base location</p></div><span className="pill pill-active">{assignedCount} assigned</span></div>
            <div className="panel-body">
              <form className="assign-controls" onSubmit={assignLocation}>
                <div className="field"><label>Employee</label><select value={selectedEmployee} onChange={e => setSelectedEmployee(e.target.value)} required><option value="">Choose employee</option>{employees.filter(e => e.status === 'active').map(e => <option key={e.id} value={e.id}>{e.full_name}{e.employee_code ? ' · ' + e.employee_code : ''}</option>)}</select></div>
                <div className="field"><label>Assign to location</label><select value={selectedLocation} onChange={e => setSelectedLocation(e.target.value)}><option value="">No location / Unassign</option>{locations.filter(l => l.is_active).map(l => <option key={l.id} value={l.id}>{l.name} ({l.location_type})</option>)}</select></div>
                <button className="button button-primary" type="submit" disabled={saving || !selectedEmployee}>{saving ? 'Saving…' : 'Save assignment'}</button>
              </form>
            </div>
            <div style={{ overflowX: 'auto' }}>
              <table className="employee-table"><thead><tr><th>Employee</th><th>Designation</th><th>Base location</th><th>Status</th></tr></thead><tbody>
                {employees.map(employee => {
                  const location = locations.find(l => l.id === employee.base_location_id);
                  return <tr key={employee.id}>
                    <td><div className="employee-name">{employee.full_name}</div><div className="employee-code">{employee.employee_code || employee.role.replace('_',' ')}</div></td>
                    <td>{employee.designation || (employee.role === 'site_manager' ? 'Site Manager' : '—')}</td>
                    <td>{location ? location.name : <span style={{ color: '#b17a32' }}>Not assigned</span>}</td>
                    <td><span className={'pill ' + (employee.status === 'active' ? 'pill-active' : 'pill-inactive')}>{employee.status}</span></td>
                  </tr>;
                })}
                {employees.length === 0 && <tr><td colSpan={4} style={{ textAlign: 'center', color: '#89968e', padding: 24 }}>No employees are available to assign yet.</td></tr>}
              </tbody></table>
            </div>
          </section>
        </div>
      </main>
    </div>
  );
}
