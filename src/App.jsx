import { useState, useEffect, useRef } from 'react'
import { supabase } from './supabase.js'

const GROWTH_STAGES = [
  "VE – Emergence","V1","V2","V3","V4","V5","V6","V7","V8","V9","V10","V11","V12+",
  "VT – Tassel","R1 – Silking","R2 – Blister","R3 – Milk","R4 – Dough","R5 – Dent","R6 – Maturity",
  "Feekes 1","Feekes 2","Feekes 3","Feekes 4","Feekes 5","Feekes 6","Feekes 7","Feekes 8",
  "Feekes 9","Feekes 10","Feekes 10.5","Feekes 11",
  "R1 – Unifoliate","R2 – Flowering","R3 – Pod Set","R4 – Pod Fill",
  "R5 – Beginning Seed","R6 – Full Seed","R7 – Beginning Maturity","R8 – Full Maturity",
  "Other / Custom"
]

const CROPS = ["Corn","Soybeans","Cover Crop","Wheat","Milo","Fallow"]

function compressImage(file, maxW = 900) {
  return new Promise((res) => {
    const img = new Image()
    const url = URL.createObjectURL(file)
    img.onload = () => {
      const scale = Math.min(1, maxW / img.width)
      const canvas = document.createElement('canvas')
      canvas.width = img.width * scale
      canvas.height = img.height * scale
      canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height)
      URL.revokeObjectURL(url)
      res(canvas.toDataURL('image/jpeg', 0.72))
    }
    img.onerror = () => { URL.revokeObjectURL(url); res(null) }
    img.src = url
  })
}

function fmtDate(iso) {
  if (!iso) return ''
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}
function fmtTime(iso) {
  if (!iso) return ''
  return new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
}

const emptyForm = () => ({ title: '', crop: CROPS[0], stage: GROWTH_STAGES[0], notes: '', photos: [] })

// ── SQL to create tables (run once in Supabase SQL editor) ───────────────────
// Copy this comment block and run it in Supabase → SQL Editor → New Query:
//
// create table if not exists farms (
//   id text primary key,
//   name text not null,
//   pin text not null,
//   created_at timestamptz default now()
// );
// insert into farms (id, name, pin) values ('farm_johnson', 'Johnson Farms', '936170')
//   on conflict (id) do nothing;
//
// create table if not exists fields (
//   id text primary key,
//   farm_id text references farms(id) on delete cascade,
//   name text not null,
//   created_at timestamptz default now()
// );
//
// create table if not exists entries (
//   id text primary key,
//   farm_id text references farms(id) on delete cascade,
//   field_id text references fields(id) on delete cascade,
//   author text not null,
//   title text,
//   crop text,
//   stage text,
//   notes text,
//   photos jsonb default '[]',
//   created_at timestamptz default now()
// );
//
// alter table farms enable row level security;
// alter table fields enable row level security;
// alter table entries enable row level security;
//
// create policy "public read farms" on farms for select using (true);
// create policy "public read fields" on fields for select using (true);
// create policy "public read entries" on entries for select using (true);
// create policy "public insert fields" on fields for insert with check (true);
// create policy "public delete fields" on fields for delete using (true);
// create policy "public insert entries" on entries for insert with check (true);
// create policy "public delete entries" on entries for delete using (true);
// create policy "public insert farms" on farms for insert with check (true);
// ─────────────────────────────────────────────────────────────────────────────

export default function App() {
  const [screen, setScreen] = useState('login')
  const [session, setSession] = useState(null)
  const [farms, setFarms] = useState([])
  const [fields, setFields] = useState([])
  const [entries, setEntries] = useState([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [activeField, setActiveField] = useState(null)
  const [activeEntry, setActiveEntry] = useState(null)
  const [fieldSearch, setFieldSearch] = useState('')

  const [loginFarmId, setLoginFarmId] = useState('')
  const [loginPin, setLoginPin] = useState('')
  const [loginName, setLoginName] = useState('')
  const [loginError, setLoginError] = useState('')

  const [entryForm, setEntryForm] = useState(emptyForm())
  const photoInputRef = useRef()
  const galleryInputRef = useRef()

  const [newFieldName, setNewFieldName] = useState('')
  const [fieldError, setFieldError] = useState('')
  const [newFarmName, setNewFarmName] = useState('')
  const [newFarmPin, setNewFarmPin] = useState('')
  const [farmError, setFarmError] = useState('')
  const [dbReady, setDbReady] = useState(true)
  const [dbError, setDbError] = useState('')

  // ── Load farms on mount ──────────────────────────────────────────────────
  useEffect(() => {
    loadFarms()
  }, [])

  // ── Load fields + entries when farm session starts ───────────────────────
  useEffect(() => {
    if (session?.farmId) {
      loadFields(session.farmId)
      loadEntries(session.farmId)
    }
  }, [session?.farmId])

  // ── Realtime subscription ────────────────────────────────────────────────
  useEffect(() => {
    if (!session?.farmId) return
    const sub = supabase
      .channel('db-changes')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'entries' }, () => {
        loadEntries(session.farmId)
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'fields' }, () => {
        loadFields(session.farmId)
      })
      .subscribe()
    return () => supabase.removeChannel(sub)
  }, [session?.farmId])

  async function loadFarms() {
    setLoading(true)
    const { data, error } = await supabase.from('farms').select('*')
    if (error) {
      setDbError('Database tables not set up yet. Please run the setup SQL in Supabase.')
      setDbReady(false)
    } else {
      setFarms(data || [])
      if (data?.length > 0) setLoginFarmId(data[0].id)
      setDbReady(true)
    }
    setLoading(false)
  }

  async function loadFields(farmId) {
    const { data } = await supabase.from('fields').select('*').eq('farm_id', farmId).order('name')
    setFields(data || [])
  }

  async function loadEntries(farmId) {
    const { data } = await supabase.from('entries').select('*').eq('farm_id', farmId).order('created_at', { ascending: false })
    setEntries(data || [])
  }

  // ── LOGIN ────────────────────────────────────────────────────────────────
  const handleLogin = () => {
    const farm = farms.find(f => f.id === loginFarmId)
    if (!farm) { setLoginError('Farm not found.'); return }
    if (farm.pin !== loginPin.trim()) { setLoginError('Incorrect PIN.'); return }
    if (!loginName.trim()) { setLoginError('Please enter your name.'); return }
    setSession({ farmId: farm.id, farmName: farm.name, userName: loginName.trim() })
    setScreen('fields')
    setLoginError('')
  }

  // ── ADD FARM ─────────────────────────────────────────────────────────────
  const handleAddFarm = async () => {
    const name = newFarmName.trim()
    const pin = newFarmPin.trim()
    if (!name) { setFarmError('Enter a farm name.'); return }
    if (pin.length < 4) { setFarmError('PIN must be at least 4 characters.'); return }
    if (farms.find(f => f.name.toLowerCase() === name.toLowerCase())) { setFarmError('Farm already exists.'); return }
    const id = `farm_${Date.now()}`
    const { error } = await supabase.from('farms').insert({ id, name, pin })
    if (error) { setFarmError('Error saving farm. Please try again.'); return }
    await loadFarms()
    setNewFarmName('')
    setNewFarmPin('')
    setFarmError('')
    setScreen('login')
  }

  // ── ADD FIELD ────────────────────────────────────────────────────────────
  const handleAddField = async () => {
    const name = newFieldName.trim()
    if (!name) { setFieldError('Enter a field name.'); return }
    if (fields.find(f => f.name.toLowerCase() === name.toLowerCase())) { setFieldError('Field already exists.'); return }
    const { error } = await supabase.from('fields').insert({ id: `field_${Date.now()}`, farm_id: session.farmId, name })
    if (error) { setFieldError('Error saving field.'); return }
    setNewFieldName('')
    setFieldError('')
  }

  const handleDeleteField = async (fid) => {
    await supabase.from('fields').delete().eq('id', fid)
  }

  // ── SAVE ENTRY ───────────────────────────────────────────────────────────
  const handleSaveEntry = async () => {
    if (!entryForm.title.trim() && !entryForm.notes.trim() && entryForm.photos.length === 0) return
    setSaving(true)
    const { error } = await supabase.from('entries').insert({
      id: `entry_${Date.now()}`,
      farm_id: session.farmId,
      field_id: activeField.id,
      author: session.userName,
      title: entryForm.title.trim(),
      crop: entryForm.crop,
      stage: entryForm.stage,
      notes: entryForm.notes.trim(),
      photos: entryForm.photos,
    })
    setSaving(false)
    if (error) { alert('Error saving entry. Please try again.'); return }
    setEntryForm(emptyForm())
    setScreen('fieldLog')
  }

  const handleAddPhotos = async (e) => {
    const files = Array.from(e.target.files || [])
    if (!files.length) return
    const compressed = (await Promise.all(files.map(compressImage))).filter(Boolean)
    setEntryForm(ef => ({ ...ef, photos: [...ef.photos, ...compressed] }))
    e.target.value = ''
  }

  const handleDeleteEntry = async (eid) => {
    await supabase.from('entries').delete().eq('id', eid)
    setScreen('fieldLog')
  }

  const farmFields = fields.filter(f =>
    f.name.toLowerCase().includes(fieldSearch.toLowerCase())
  )

  const fieldEntries = (fid) => entries.filter(e => e.field_id === fid)
  const canSave = entryForm.title.trim() || entryForm.notes.trim() || entryForm.photos.length > 0
  const currentFarm = farms.find(f => f.id === session?.farmId)

  // ── RENDER ───────────────────────────────────────────────────────────────
  if (loading) return (
    <div style={{ ...S.shell, display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '100vh' }}>
      <div style={{ textAlign: 'center', color: MUTED }}>
        <div style={{ fontSize: 40, marginBottom: 16 }}>🌿</div>
        <div style={{ fontSize: 16 }}>Loading…</div>
      </div>
    </div>
  )

  return (
    <div style={S.shell}>
      <style>{css}</style>

      {/* ── DB NOT READY ── */}
      {!dbReady && (
        <div style={S.loginWrap}>
          <div style={S.loginCard}>
            <div style={S.loginLogo}>⚠️</div>
            <div style={{ ...S.loginTitle, fontSize: 18, marginBottom: 12 }}>Database Setup Required</div>
            <div style={{ color: MUTED, fontSize: 14, lineHeight: 1.7, marginBottom: 16 }}>
              The database tables haven't been created yet. Please go to your Supabase project → SQL Editor → New Query, paste and run the setup SQL from the top of <code>App.jsx</code>, then refresh this page.
            </div>
            <button onClick={loadFarms} style={S.primaryBtn}>Retry</button>
          </div>
        </div>
      )}

      {/* ── LOGIN ── */}
      {dbReady && screen === 'login' && (
        <div style={S.loginWrap}>
          <div style={S.loginCard}>
            <div style={S.loginLogo}>🌿</div>
            <div style={S.loginTitle}>Compass Agri-Service</div>
            <div style={S.loginSub}>Field Log</div>
            <div style={S.fg}>
              <label style={S.lbl}>Farm</label>
              <select value={loginFarmId} onChange={e => setLoginFarmId(e.target.value)} style={S.input}>
                {farms.map(f => <option key={f.id} value={f.id}>{f.name}</option>)}
              </select>
            </div>
            <div style={S.fg}>
              <label style={S.lbl}>Your Name</label>
              <input value={loginName} onChange={e => setLoginName(e.target.value)}
                placeholder="e.g. Mike" style={S.input}
                onKeyDown={e => e.key === 'Enter' && handleLogin()} />
            </div>
            <div style={S.fg}>
              <label style={S.lbl}>Team PIN</label>
              <input type="password" value={loginPin} onChange={e => setLoginPin(e.target.value)}
                placeholder="••••••" style={S.input}
                onKeyDown={e => e.key === 'Enter' && handleLogin()} />
            </div>
            {loginError && <div style={S.errorBox}>{loginError}</div>}
            <button onClick={handleLogin} style={S.primaryBtn}>Enter →</button>
            <button onClick={() => setScreen('manageFarms')} style={S.ghostBtn}>+ Add New Farm</button>
          </div>
        </div>
      )}

      {/* ── ADD FARM ── */}
      {dbReady && screen === 'manageFarms' && (
        <div style={S.loginWrap}>
          <div style={S.loginCard}>
            <button onClick={() => setScreen('login')} style={S.backBtn}>← Back</button>
            <div style={{ ...S.loginTitle, marginTop: 12 }}>Add a Farm</div>
            <div style={S.fg}>
              <label style={S.lbl}>Farm Name</label>
              <input value={newFarmName} onChange={e => setNewFarmName(e.target.value)}
                placeholder="e.g. Smith Acres" style={S.input} />
            </div>
            <div style={S.fg}>
              <label style={S.lbl}>Team PIN</label>
              <input value={newFarmPin} onChange={e => setNewFarmPin(e.target.value)}
                placeholder="min 4 characters" style={S.input} />
            </div>
            {farmError && <div style={S.errorBox}>{farmError}</div>}
            <button onClick={handleAddFarm} style={S.primaryBtn}>Create Farm</button>
            {farms.length > 0 && (
              <div style={{ marginTop: 20 }}>
                <div style={S.secLabel}>Existing Farms</div>
                {farms.map(f => <div key={f.id} style={S.chip}>{f.name}</div>)}
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── FIELD LIST ── */}
      {dbReady && screen === 'fields' && (
        <div style={S.page}>
          <div style={S.topBar}>
            <div>
              <div style={S.topFarm}>{currentFarm?.name}</div>
              <div style={S.topSub}>Logged in as {session.userName}</div>
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button onClick={() => setScreen('manageFields')} style={S.iconBtn} title="Manage Fields">⚙</button>
              <button onClick={() => { setSession(null); setScreen('login'); setLoginPin('') }} style={S.iconBtn} title="Log out">⎋</button>
            </div>
          </div>
          <div style={{ padding: '14px 16px 0' }}>
            <input value={fieldSearch} onChange={e => setFieldSearch(e.target.value)}
              placeholder="🔍  Search fields…" style={{ ...S.input, marginBottom: 0 }} />
          </div>
          <div style={S.list}>
            {farmFields.length === 0 && (
              <div style={S.empty}>
                {fields.length === 0
                  ? <><span>No fields yet.</span><br /><span style={{ fontSize: 13, opacity: 0.6 }}>Tap ⚙ to add fields.</span></>
                  : 'No fields match your search.'}
              </div>
            )}
            {farmFields.map(f => {
              const fe = fieldEntries(f.id)
              const last = fe[0]
              const thumb = last?.photos?.[0]
              return (
                <div key={f.id} style={S.fieldCard} className="hoverCard"
                  onClick={() => { setActiveField(f); setScreen('fieldLog') }}>
                  {thumb && <img src={thumb} alt="" style={S.fieldThumb} />}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={S.fieldCardName}>{f.name}</div>
                    {last
                      ? <div style={S.fieldCardMeta}>{fmtDate(last.created_at)} · {last.crop}{last.stage ? ` · ${last.stage}` : ''}</div>
                      : <div style={S.fieldCardMeta}>No entries yet</div>}
                  </div>
                  <div style={S.fieldCardRight}>
                    <div style={S.entryCount}>{fe.length}</div>
                    <div style={S.entryLabel}>entries</div>
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* ── MANAGE FIELDS ── */}
      {dbReady && screen === 'manageFields' && (
        <div style={S.page}>
          <div style={S.topBar}>
            <button onClick={() => setScreen('fields')} style={S.backBtn}>← Fields</button>
            <div style={S.topFarm}>Manage Fields</div>
            <div style={{ width: 60 }} />
          </div>
          <div style={{ padding: '16px' }}>
            <div style={S.secLabel}>Add New Field</div>
            <div style={{ display: 'flex', gap: 8, marginBottom: 6 }}>
              <input value={newFieldName} onChange={e => setNewFieldName(e.target.value)}
                placeholder="Field name" style={{ ...S.input, flex: 1, marginBottom: 0 }}
                onKeyDown={e => e.key === 'Enter' && handleAddField()} />
              <button onClick={handleAddField} style={S.addBtn}>Add</button>
            </div>
            {fieldError && <div style={S.errorBox}>{fieldError}</div>}
            <div style={{ marginTop: 22 }}>
              <div style={S.secLabel}>{fields.length} Field{fields.length !== 1 ? 's' : ''}</div>
              {fields.length === 0 && <div style={S.empty}>No fields added yet.</div>}
              {[...fields].sort((a, b) => a.name.localeCompare(b.name)).map(f => (
                <div key={f.id} style={S.manageRow}>
                  <span style={{ color: TEXT, fontSize: 15 }}>{f.name}</span>
                  <button onClick={() => handleDeleteField(f.id)} style={S.deleteBtn}>Remove</button>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* ── FIELD LOG ── */}
      {dbReady && screen === 'fieldLog' && activeField && (
        <div style={S.page}>
          <div style={S.topBar}>
            <button onClick={() => setScreen('fields')} style={S.backBtn}>← Fields</button>
            <div style={S.topFarm}>{activeField.name}</div>
            <button onClick={() => { setEntryForm(emptyForm()); setScreen('newEntry') }} style={S.newEntryBtn}>+ Log</button>
          </div>
          <div style={S.list}>
            {fieldEntries(activeField.id).length === 0 && (
              <div style={S.empty}>No entries yet.<br /><span style={{ fontSize: 13, opacity: 0.6 }}>Tap + Log to add the first observation.</span></div>
            )}
            {fieldEntries(activeField.id).map(entry => (
              <div key={entry.id} style={S.entryCard} className="hoverCard"
                onClick={() => { setActiveEntry(entry); setScreen('entryDetail') }}>
                <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
                  {entry.photos?.[0] && <img src={entry.photos[0]} alt="" style={S.entryThumb} />}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={S.entryTitle}>{entry.title || `${entry.crop} – ${entry.stage}`}</div>
                        <div style={S.entryMeta}>
                          {entry.crop && <span style={S.cropBadge}>{entry.crop}</span>}
                          {fmtDate(entry.created_at)} · {entry.author}
                        </div>
                      </div>
                      {entry.photos?.length > 0 && <div style={S.photoCount}>📷 {entry.photos.length}</div>}
                    </div>
                    {entry.notes && (
                      <div style={S.entryNotes}>
                        {entry.notes.length > 100 ? entry.notes.slice(0, 100) + '…' : entry.notes}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── NEW ENTRY ── */}
      {dbReady && screen === 'newEntry' && activeField && (
        <div style={S.page}>
          <div style={S.topBar}>
            <button onClick={() => setScreen('fieldLog')} style={S.backBtn}>← Cancel</button>
            <div style={S.topFarm}>New Entry</div>
            <div style={{ width: 60 }} />
          </div>
          <div style={{ padding: '16px' }}>
            <div style={S.secLabel}>{activeField.name}</div>
            <div style={S.fg}>
              <label style={S.lbl}>Title</label>
              <input value={entryForm.title} onChange={e => setEntryForm(f => ({ ...f, title: e.target.value }))}
                placeholder="e.g. Week 3 scouting, Fungicide application…" style={S.input} />
            </div>
            <div style={S.fg}>
              <label style={S.lbl}>Crop</label>
              <select value={entryForm.crop} onChange={e => setEntryForm(f => ({ ...f, crop: e.target.value }))} style={S.input}>
                {CROPS.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
            <div style={S.fg}>
              <label style={S.lbl}>Growth Stage</label>
              <select value={entryForm.stage} onChange={e => setEntryForm(f => ({ ...f, stage: e.target.value }))} style={S.input}>
                {GROWTH_STAGES.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
            <div style={S.fg}>
              <label style={S.lbl}>Observations / Notes</label>
              <textarea value={entryForm.notes} onChange={e => setEntryForm(f => ({ ...f, notes: e.target.value }))}
                placeholder="Describe what you see — pest pressure, crop health, stand issues, etc."
                rows={6} style={{ ...S.input, resize: 'vertical', lineHeight: 1.6 }} />
            </div>
            <div style={S.fg}>
              <label style={S.lbl}>Photos</label>
              <input ref={photoInputRef} type="file" accept="image/*" multiple capture="environment"
                onChange={handleAddPhotos} style={{ display: 'none' }} />
              <input ref={galleryInputRef} type="file" accept="image/*" multiple
                onChange={handleAddPhotos} style={{ display: 'none' }} />
              <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
                <button onClick={() => photoInputRef.current?.click()} style={{ ...S.photoBtn, flex: 1 }}>📷 Camera</button>
                <button onClick={() => galleryInputRef.current?.click()} style={{ ...S.photoBtn, flex: 1 }}>🖼 Camera Roll</button>
              </div>
              {entryForm.photos.length > 0 && (
                <div style={S.photoStrip}>
                  {entryForm.photos.map((p, i) => (
                    <div key={i} style={{ position: 'relative' }}>
                      <img src={p} alt="" style={S.photoThumb} />
                      <button onClick={() => setEntryForm(f => ({ ...f, photos: f.photos.filter((_, j) => j !== i) }))}
                        style={S.photoRemove}>✕</button>
                    </div>
                  ))}
                </div>
              )}
            </div>
            <button onClick={handleSaveEntry} disabled={!canSave || saving}
              style={{ ...S.primaryBtn, opacity: canSave && !saving ? 1 : 0.4, cursor: canSave && !saving ? 'pointer' : 'not-allowed' }}>
              {saving ? 'Saving…' : 'Save Entry'}
            </button>
          </div>
        </div>
      )}

      {/* ── ENTRY DETAIL ── */}
      {dbReady && screen === 'entryDetail' && activeEntry && (
        <div style={S.page}>
          <div style={S.topBar}>
            <button onClick={() => setScreen('fieldLog')} style={S.backBtn}>← Log</button>
            <div style={S.topFarm}>{activeField?.name}</div>
            <button onClick={() => handleDeleteEntry(activeEntry.id)} style={S.deleteEntryBtn}>Delete</button>
          </div>
          <div style={{ padding: '16px' }}>
            {activeEntry.title && <div style={S.detailTitle}>{activeEntry.title}</div>}
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 10 }}>
              {activeEntry.crop && <span style={S.cropBadge}>{activeEntry.crop}</span>}
              <span style={{ ...S.cropBadge, background: '#1e3a18', color: MUTED }}>{activeEntry.stage}</span>
            </div>
            <div style={S.detailMeta}>
              {fmtDate(activeEntry.created_at)} at {fmtTime(activeEntry.created_at)}<br />
              Logged by <strong>{activeEntry.author}</strong>
            </div>
            {activeEntry.notes && <div style={S.detailNotes}>{activeEntry.notes}</div>}
            {activeEntry.photos?.length > 0 && (
              <div style={{ marginTop: 18 }}>
                <div style={S.secLabel}>Photos ({activeEntry.photos.length})</div>
                <div style={S.photoGrid}>
                  {activeEntry.photos.map((p, i) => (
                    <img key={i} src={p} alt="" style={S.detailPhoto} />
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

const GREEN    = '#3d6b34'
const GREEN_LT = '#5a9e47'
const GREEN_DK = '#1e3a18'
const BG       = '#090f08'
const CARD     = '#0e1a0c'
const BORDER   = '#1e3018'
const TEXT     = '#f0e6c8'
const MUTED    = '#9ab88a'

const S = {
  shell:          { minHeight: '100vh', background: BG, color: TEXT, fontFamily: "'Palatino Linotype','Book Antiqua',Palatino,serif", maxWidth: 500, margin: '0 auto' },
  loginWrap:      { minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20, background: `radial-gradient(ellipse at 40% 30%, #112610 0%, ${BG} 70%)` },
  loginCard:      { width: '100%', maxWidth: 360, background: CARD, borderRadius: 18, padding: '32px 28px', border: `1px solid ${BORDER}`, boxShadow: '0 8px 40px #00000066' },
  loginLogo:      { fontSize: 40, textAlign: 'center', marginBottom: 6 },
  loginTitle:     { fontSize: 24, fontWeight: 'bold', textAlign: 'center', color: GREEN_LT, letterSpacing: 0.5 },
  loginSub:       { fontSize: 12, textAlign: 'center', color: MUTED, marginBottom: 28, letterSpacing: 2, textTransform: 'uppercase' },
  page:           { minHeight: '100vh', display: 'flex', flexDirection: 'column' },
  topBar:         { display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '16px 16px 13px', background: `linear-gradient(135deg, ${GREEN_DK} 0%, #162b13 100%)`, borderBottom: `2px solid ${GREEN}`, position: 'sticky', top: 0, zIndex: 10 },
  topFarm:        { fontSize: 16, fontWeight: 'bold', color: GREEN_LT, flex: 1, textAlign: 'center' },
  topSub:         { fontSize: 11, color: MUTED, letterSpacing: 1 },
  list:           { padding: '12px 16px', flex: 1 },
  fieldCard:      { background: CARD, border: `1px solid ${BORDER}`, borderRadius: 12, padding: '12px 14px', marginBottom: 10, display: 'flex', alignItems: 'center', gap: 12, cursor: 'pointer', transition: 'border-color 0.15s, background 0.15s' },
  fieldThumb:     { width: 52, height: 52, borderRadius: 8, objectFit: 'cover', border: `1px solid ${BORDER}`, flexShrink: 0 },
  fieldCardName:  { fontSize: 15, fontWeight: 'bold', color: TEXT, marginBottom: 3 },
  fieldCardMeta:  { fontSize: 12, color: MUTED },
  fieldCardRight: { textAlign: 'center', flexShrink: 0 },
  entryCount:     { fontSize: 20, fontWeight: 'bold', color: GREEN_LT },
  entryLabel:     { fontSize: 10, color: MUTED, letterSpacing: 1, textTransform: 'uppercase' },
  entryCard:      { background: CARD, border: `1px solid ${BORDER}`, borderRadius: 12, padding: '13px 14px', marginBottom: 10, cursor: 'pointer', transition: 'border-color 0.15s' },
  entryThumb:     { width: 60, height: 60, borderRadius: 8, objectFit: 'cover', border: `1px solid ${BORDER}`, flexShrink: 0 },
  entryTitle:     { fontSize: 14, fontWeight: 'bold', color: TEXT, marginBottom: 3 },
  entryMeta:      { fontSize: 11, color: MUTED, marginBottom: 4, display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' },
  entryNotes:     { fontSize: 13, color: '#c8b898', lineHeight: 1.5, marginTop: 4 },
  photoCount:     { fontSize: 12, color: MUTED, whiteSpace: 'nowrap', marginLeft: 8, flexShrink: 0 },
  cropBadge:      { display: 'inline-block', background: '#1a3518', color: GREEN_LT, fontSize: 11, padding: '2px 8px', borderRadius: 20, border: `1px solid ${GREEN}`, letterSpacing: 0.3 },
  detailTitle:    { fontSize: 20, fontWeight: 'bold', color: TEXT, marginBottom: 8 },
  detailMeta:     { fontSize: 13, color: MUTED, marginBottom: 14, lineHeight: 1.7 },
  detailNotes:    { fontSize: 15, color: TEXT, lineHeight: 1.7, background: '#0a1209', borderRadius: 10, padding: '14px 16px', border: `1px solid ${BORDER}` },
  photoGrid:      { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginTop: 8 },
  detailPhoto:    { width: '100%', borderRadius: 10, border: `1px solid ${BORDER}`, display: 'block' },
  manageRow:      { display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '11px 14px', background: CARD, borderRadius: 8, border: `1px solid ${BORDER}`, marginBottom: 8 },
  chip:           { padding: '8px 12px', background: '#122210', borderRadius: 8, border: `1px solid ${BORDER}`, marginBottom: 6, fontSize: 14, color: TEXT },
  input:          { width: '100%', boxSizing: 'border-box', padding: '12px 14px', background: '#0a1209', border: `1px solid ${BORDER}`, borderRadius: 8, color: TEXT, fontSize: 15, fontFamily: 'inherit', outline: 'none', appearance: 'none', WebkitAppearance: 'none', marginBottom: 14 },
  fg:             { marginBottom: 4 },
  lbl:            { display: 'block', fontSize: 11, color: MUTED, letterSpacing: 1.2, textTransform: 'uppercase', marginBottom: 6 },
  secLabel:       { fontSize: 11, color: MUTED, letterSpacing: 1.5, textTransform: 'uppercase', marginBottom: 10 },
  primaryBtn:     { width: '100%', padding: '15px', background: `linear-gradient(135deg, ${GREEN}, ${GREEN_LT})`, color: '#0f1a0d', border: 'none', borderRadius: 10, fontSize: 16, fontWeight: 'bold', fontFamily: 'inherit', cursor: 'pointer', letterSpacing: 0.5, marginTop: 6, boxShadow: '0 4px 16px #3d6b3444' },
  ghostBtn:       { width: '100%', padding: '12px', background: 'transparent', color: MUTED, border: `1px solid ${BORDER}`, borderRadius: 10, fontSize: 14, fontFamily: 'inherit', cursor: 'pointer', marginTop: 10 },
  backBtn:        { background: 'transparent', border: 'none', color: MUTED, fontSize: 14, fontFamily: 'inherit', cursor: 'pointer', padding: '4px 0', whiteSpace: 'nowrap' },
  iconBtn:        { background: 'transparent', border: `1px solid ${BORDER}`, color: MUTED, fontSize: 16, borderRadius: 8, padding: '5px 9px', cursor: 'pointer' },
  newEntryBtn:    { background: GREEN, border: 'none', color: '#0f1a0d', fontSize: 14, fontWeight: 'bold', fontFamily: 'inherit', borderRadius: 8, padding: '7px 14px', cursor: 'pointer', whiteSpace: 'nowrap' },
  deleteBtn:      { background: '#3a1212', border: '1px solid #6b2020', color: '#ff8a8a', fontSize: 12, borderRadius: 6, padding: '5px 10px', cursor: 'pointer', fontFamily: 'inherit' },
  deleteEntryBtn: { background: 'transparent', border: 'none', color: '#e05050', fontSize: 13, fontFamily: 'inherit', cursor: 'pointer' },
  addBtn:         { padding: '12px 18px', background: GREEN, border: 'none', borderRadius: 8, color: '#0f1a0d', fontSize: 15, fontWeight: 'bold', fontFamily: 'inherit', cursor: 'pointer', whiteSpace: 'nowrap' },
  photoBtn:       { padding: '13px', background: '#0a1209', border: `2px dashed ${GREEN}`, borderRadius: 10, color: GREEN_LT, fontSize: 14, fontFamily: 'inherit', cursor: 'pointer' },
  photoStrip:     { display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 4 },
  photoThumb:     { width: 80, height: 80, objectFit: 'cover', borderRadius: 8, border: `1px solid ${BORDER}`, display: 'block' },
  photoRemove:    { position: 'absolute', top: -6, right: -6, background: '#3a1212', border: 'none', color: '#ff8a8a', borderRadius: '50%', width: 20, height: 20, fontSize: 11, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' },
  errorBox:       { background: '#3a1212', border: '1px solid #6b2020', borderRadius: 8, padding: '10px 12px', fontSize: 13, color: '#ff9a9a', marginBottom: 12 },
  empty:          { textAlign: 'center', color: MUTED, padding: '48px 20px', lineHeight: 1.8, fontSize: 15 },
}

const css = `
  .hoverCard:hover { border-color: ${GREEN} !important; background: #122210 !important; }
  * { -webkit-tap-highlight-color: transparent; }
  select option { background: #0a1209; color: ${TEXT}; }
  textarea { font-family: inherit; color: ${TEXT}; background: #0a1209; }
  input::placeholder { color: #4a6a44; }
  textarea::placeholder { color: #4a6a44; }
  ::-webkit-scrollbar { width: 4px; }
  ::-webkit-scrollbar-track { background: transparent; }
  ::-webkit-scrollbar-thumb { background: ${BORDER}; border-radius: 4px; }
`
