import { createClient } from 'npm:@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, apikey, x-client-info, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { ...corsHeaders, 'Content-Type': 'application/json' },
})
const normalizeCode = (value: unknown) => String(value ?? '').trim().toUpperCase()
const validCode = (code: string) => /^[A-Z0-9._-]{1,64}$/.test(code)
const syntheticEmail = (code: string) => `${code.toLowerCase()}@users.akashenterprises.invalid`

function namedKey(variable: string, legacyVariable: string) {
  const raw = Deno.env.get(variable)
  if (raw) {
    try { return JSON.parse(raw).default as string } catch { /* use legacy below */ }
  }
  return Deno.env.get(legacyVariable) ?? ''
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return json({ error: 'Method not allowed.' }, 405)

  const url = Deno.env.get('SUPABASE_URL') ?? ''
  const publishableKey = namedKey('SUPABASE_PUBLISHABLE_KEYS', 'SUPABASE_ANON_KEY')
  const secretKey = namedKey('SUPABASE_SECRET_KEYS', 'SUPABASE_SERVICE_ROLE_KEY')
  const authorization = req.headers.get('Authorization') ?? ''
  if (!url || !publishableKey || !secretKey || !authorization.startsWith('Bearer ')) {
    return json({ error: 'A valid signed-in HR session is required.' }, 401)
  }

  const userClient = createClient(url, publishableKey, { global: { headers: { Authorization: authorization } }, auth: { persistSession: false, autoRefreshToken: false } })
  const { data: authData, error: authError } = await userClient.auth.getUser()
  if (authError || !authData.user) return json({ error: 'Your sign-in has expired. Sign in again.' }, 401)
  const admin = createClient(url, secretKey, { auth: { persistSession: false, autoRefreshToken: false } })
  const { data: caller, error: callerError } = await admin.from('profiles').select('id,role,status,employee_code,must_change_password').eq('id', authData.user.id).maybeSingle()
  if (callerError || !caller || caller.status !== 'active') return json({ error: 'Your active employee profile is required.' }, 403)

  let body: Record<string, unknown>
  try { body = await req.json() } catch { return json({ error: 'Request body must be valid JSON.' }, 400) }

  if (body.action === 'complete_password_setup') {
    if (!caller.must_change_password) return json({ error: 'No password change is pending.' }, 403)
    const newPassword = String(body.new_password ?? '')
    if (newPassword.length < 8) return json({ error: 'Choose a password with at least 8 characters.' }, 400)
    const { error: passwordError } = await admin.auth.admin.updateUserById(authData.user.id, { password: newPassword })
    if (passwordError) return json({ error: passwordError.message }, 400)
    const { error: profileError } = await admin.from('profiles').update({ must_change_password: false }).eq('id', authData.user.id).eq('must_change_password', true)
    if (profileError) return json({ error: 'Password changed, but setup could not be completed. Contact HR or the developer.' }, 500)
    return json({ success: true })
  }

  if (!['hr_manager', 'technical_super_admin'].includes(caller.role)) return json({ error: 'Only an active HR Manager or Developer can manage user accounts.' }, 403)

  const mayGrantRole = (role: string) => {
    if (!['employee', 'site_manager', 'hr_manager', 'proprietor'].includes(role)) return false
    if (role === 'hr_manager' || role === 'proprietor') return caller.role === 'technical_super_admin'
    return true
  }

  function validateAccountCode(code: string, role: string) {
    if (role === 'proprietor' && code !== 'AE0001') throw new Error('The Proprietor & Founder account must use User ID AE0001.')
    if (code === 'AE0001' && role !== 'proprietor') throw new Error('AE0001 is reserved for the Proprietor & Founder.')
    if (role === 'hr_manager' && code !== 'AE0002') throw new Error('The HR account must use User ID AE0002.')
    if (code === 'AE0002' && role !== 'hr_manager') throw new Error('AE0002 is reserved for HR.')
    if (role === 'employee' || role === 'site_manager') {
      const sequence = /^AE(\d{4,})$/.exec(code)
      if (!sequence || Number(sequence[1]) < 3) throw new Error('Employee and Site Manager User IDs must start at AE0003.')
    }
  }

  async function resolveAssignments(row: Record<string, unknown>, creating: boolean) {
    let baseLocationId = row.base_location_id ? String(row.base_location_id) : null
    const locationName = String(row.base_location_name ?? '').trim()
    if (locationName) {
      const { data, error } = await admin.from('work_locations').select('id,name,is_active').eq('name', locationName).eq('is_active', true).limit(2)
      if (error) throw error
      if (!data || data.length !== 1) throw new Error(`Base location “${locationName}” must match exactly one active location.`)
      baseLocationId = data[0].id
    }
    if (baseLocationId) {
      const { data, error } = await admin.from('work_locations').select('id').eq('id', baseLocationId).eq('is_active', true).maybeSingle()
      if (error || !data) throw new Error('Choose an active base location.')
    }
    let managerId: string | null = null
    const managerCode = normalizeCode(row.reporting_manager_code)
    if (managerCode) {
      const { data, error } = await admin.from('profiles').select('id,role,status').eq('employee_code', managerCode).maybeSingle()
      if (error || !data || data.status !== 'active' || !['site_manager', 'hr_manager', 'technical_super_admin'].includes(data.role)) {
        throw new Error(`Reporting Manager User ID “${managerCode}” is not an active manager.`)
      }
      managerId = data.id
    }
    if (!creating && (locationName || row.base_location_id || managerCode)) {
      throw new Error('Base location or reporting manager changes must use the approved site transfer workflow.')
    }
    return { baseLocationId, managerId }
  }

  async function nextEmployeeCode() {
    const { data, error } = await admin.from('profiles').select('employee_code')
    if (error) throw error
    const used = new Set((data ?? []).map(p => normalizeCode(p.employee_code)).filter(code => /^AE\d{4,}$/.test(code)))
    let number = 3
    while (used.has(`AE${String(number).padStart(4, '0')}`)) number++
    return `AE${String(number).padStart(4, '0')}`
  }

  async function saveEmployee(row: Record<string, unknown>) {
    const action = String(row.action ?? 'create').toLowerCase()
    let code = normalizeCode(row.employee_code)
    const firstName = String(row.first_name ?? '').trim()
    const lastName = String(row.last_name ?? '').trim()
    if (!firstName || !lastName) throw new Error('First Name and Last Name are required.')
    const designation = String(row.designation ?? '').trim() || null
    const role = String(row.role ?? 'employee')
    if (action === 'create') {
      if (role === 'proprietor') code = code || 'AE0001'
      else if (role === 'hr_manager') code = code || 'AE0002'
      else if (role === 'employee' || role === 'site_manager') {
        if (code) throw new Error('Employee IDs are assigned automatically. Leave the User ID blank.')
        code = await nextEmployeeCode()
      }
    }
    if (!code) throw new Error(action === 'update' ? 'Enter the existing User ID to update.' : 'A User ID could not be assigned.')
    if (!validCode(code)) throw new Error('User ID must use 1–64 letters, numbers, dots, underscores or hyphens.')
    if (!mayGrantRole(role)) throw new Error('Your account cannot assign that access role.')
    validateAccountCode(code, role)
    const { data: existing, error: existingError } = await admin.from('profiles').select('id,role,status').eq('employee_code', code).maybeSingle()
    if (existingError) throw existingError

    if (action === 'update') {
      if (!existing) throw new Error('No existing employee has this User ID.')
      await resolveAssignments(row, false)
      const patch: Record<string, unknown> = { first_name: firstName, last_name: lastName, full_name: `${firstName} ${lastName}`, designation, role }
      const { error } = await admin.from('profiles').update(patch).eq('id', existing.id)
      if (error) throw error
      return { success: true, user_id: code }
    }
    if (action !== 'create') throw new Error('Action must be Create or Update.')
    if (existing) throw new Error('This User ID already exists. Use Update to change permitted details.')
    const initialPassword = code
    const { baseLocationId, managerId } = await resolveAssignments(row, true)
    const { data: created, error: createError } = await admin.auth.admin.createUser({
      email: syntheticEmail(code),
      password: initialPassword,
      email_confirm: true,
      user_metadata: { employee_code: code },
    })
    if (createError || !created.user) throw createError ?? new Error('Could not create the login account.')
    const profile = {
      id: created.user.id,
      employee_code: code,
      full_name: `${firstName} ${lastName}`,
      first_name: firstName,
      last_name: lastName,
      designation,
      base_location_id: baseLocationId,
      reporting_manager_id: managerId,
      role,
      status: 'active',
      must_change_password: true,
    }
    const { error: profileError } = await admin.from('profiles').insert(profile)
    if (profileError) {
      await admin.auth.admin.deleteUser(created.user.id)
      throw profileError
    }
    return { success: true, user_id: code, must_change_password: true }
  }

  async function resetPassword(userId: string) {
    if (!userId || userId === authData.user!.id) throw new Error('Choose another account to reset.')
    const { data: target, error } = await admin.from('profiles').select('id,employee_code,role,status').eq('id', userId).maybeSingle()
    if (error || !target || !target.employee_code) throw new Error('Employee account was not found.')
    if (caller.role !== 'technical_super_admin' && ['hr_manager', 'technical_super_admin', 'proprietor'].includes(target.role)) throw new Error('Only the Developer can reset the password of HR, the Proprietor & Founder, or another Developer.')
    const { error: flagError } = await admin.from('profiles').update({ must_change_password: true }).eq('id', target.id)
    if (flagError) throw flagError
    const { error: passwordError } = await admin.auth.admin.updateUserById(target.id, { password: target.employee_code })
    if (passwordError) { await admin.from('profiles').update({ must_change_password: false }).eq('id', target.id); throw passwordError }
    const { error: revokeError } = await admin.rpc('revoke_account_sessions', { p_user_id: target.id })
    if (revokeError) throw new Error('Password reset; the next sign-in will require a new password, but existing sessions could not be revoked.')
    return { success: true, user_id: target.employee_code, must_change_password: true }
  }

  async function setAccess(userId: string, active: boolean) {
    if (!userId || userId === authData.user!.id) throw new Error('You cannot remove your own access from this screen.')
    const { data: target, error } = await admin.from('profiles').select('id,role,status').eq('id', userId).maybeSingle()
    if (error || !target) throw new Error('Employee account was not found.')
    if (caller.role !== 'technical_super_admin' && ['hr_manager', 'technical_super_admin'].includes(target.role)) {
      throw new Error('Only an Administrator can change access for an HR Manager or Administrator.')
    }
    if (!active) {
      const { error: profileError } = await admin.from('profiles').update({ status: 'inactive' }).eq('id', userId)
      if (profileError) throw profileError
      const { error: banError } = await admin.auth.admin.updateUserById(userId, { ban_duration: '876000h' })
      if (banError) { await admin.from('profiles').update({ status: 'active' }).eq('id', userId); throw banError }
      const { error: revokeError } = await admin.rpc('revoke_account_sessions', { p_user_id: userId })
      if (revokeError) {
        await admin.auth.admin.updateUserById(userId, { ban_duration: 'none' })
        await admin.from('profiles').update({ status: 'active' }).eq('id', userId)
        throw revokeError
      }
    } else {
      const { error: unbanError } = await admin.auth.admin.updateUserById(userId, { ban_duration: 'none' })
      if (unbanError) throw unbanError
      const { error: profileError } = await admin.from('profiles').update({ status: 'active' }).eq('id', userId)
      if (profileError) {
        await admin.auth.admin.updateUserById(userId, { ban_duration: '876000h' })
        throw profileError
      }
    }
    return { success: true }
  }

  try {
    if (body.action === 'create' || body.action === 'update') return json(await saveEmployee({ ...(body.employee as Record<string, unknown>), action: body.action }))
    if (body.action === 'bulk') {
      const rows = Array.isArray(body.rows) ? body.rows as Record<string, unknown>[] : []
      if (!rows.length || rows.length > 50) return json({ error: 'Import between 1 and 50 rows at a time.' }, 400)
      const results = []
      for (let i = 0; i < rows.length; i++) {
        try { results.push({ row: i + 2, ...(await saveEmployee(rows[i])) }) }
        catch (error) { results.push({ row: i + 2, success: false, user_id: normalizeCode(rows[i].employee_code), error: error instanceof Error ? error.message : 'Could not import this row.' }) }
      }
      return json({ success: results.some(x => x.success), results })
    }
    if (body.action === 'reset_password') return json(await resetPassword(String(body.user_id ?? '')))
    if (body.action === 'deactivate' || body.action === 'activate') return json(await setAccess(String(body.user_id ?? ''), body.action === 'activate'))
    return json({ error: 'Unsupported account action.' }, 400)
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : 'The account request could not be completed.' }, 400)
  }
})

