'use client'
import { useEffect, useState, useCallback, useRef } from 'react'

// ── HELPERS ───────────────────────────────────────────────────────
function fmtDur(ms) {
  const s = Math.round(ms / 1000)
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}
function fmtTotalDur(tracks) {
  const ms = tracks.reduce((s, t) => s + (t.duration_ms || 210000), 0)
  const m = Math.round(ms / 60000)
  return `${Math.floor(m / 60)}h ${m % 60}m`
}

const CAMELOT_COMPAT = {
  '1A':['1A','1B','2A','12A'],'1B':['1B','1A','2B','12B'],
  '2A':['2A','2B','3A','1A'],'2B':['2B','2A','3B','1B'],
  '3A':['3A','3B','4A','2A'],'3B':['3B','3A','4B','2B'],
  '4A':['4A','4B','5A','3A'],'4B':['4B','4A','5B','3B'],
  '5A':['5A','5B','6A','4A'],'5B':['5B','5A','6B','4B'],
  '6A':['6A','6B','7A','5A'],'6B':['6B','6A','7B','5B'],
  '7A':['7A','7B','8A','6A'],'7B':['7B','7A','8B','6B'],
  '8A':['8A','8B','9A','7A'],'8B':['8B','8A','9B','7B'],
  '9A':['9A','9B','10A','8A'],'9B':['9B','9A','10B','8B'],
  '10A':['10A','10B','11A','9A'],'10B':['10B','10A','11B','9B'],
  '11A':['11A','11B','12A','10A'],'11B':['11B','11A','12B','10B'],
  '12A':['12A','12B','1A','11A'],'12B':['12B','12A','1B','11B'],
}

function getCompatScore(keyA, keyB) {
  if (!keyA || !keyB) return 'unknown'
  const k = keyA.toUpperCase().trim()
  const compatible = CAMELOT_COMPAT[k] || []
  if (compatible[0] === keyB.toUpperCase().trim()) return 'perfect'
  if (compatible.includes(keyB.toUpperCase().trim())) return 'good'
  return 'clash'
}

// ── COMPONENTS ────────────────────────────────────────────────────
function Spinner({ size = 16, color = '#888' }) {
  return (
    <div style={{ width: size, height: size, border: `2px solid rgba(0,0,0,0.1)`, borderTopColor: color, borderRadius: '50%', animation: 'spin 0.7s linear infinite', flexShrink: 0 }}>
      <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
    </div>
  )
}

function AlbumArt({ images = [], size = 44 }) {
  const url = images?.[0]?.url
  return (
    <div style={{ width: size, height: size, borderRadius: 6, background: '#f0f0ee', overflow: 'hidden', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      {url ? <img src={url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> :
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" style={{ opacity: 0.2 }}><path d="M9 18V5l12-2v13" /><circle cx="6" cy="18" r="3" /><circle cx="18" cy="16" r="3" /></svg>}
    </div>
  )
}

function BpmArcViz({ start, peak, end }) {
  const pts = [
    [20, 70], [100, 20], [180, 70]
  ]
  const labels = [
    { x: 20, y: 88, text: `${start}` },
    { x: 100, y: 14, text: `${peak}` },
    { x: 180, y: 88, text: `${end}` },
  ]
  const path = `M ${pts[0][0]} ${pts[0][1]} Q ${pts[1][0]} ${pts[1][1]} ${pts[2][0]} ${pts[2][1]}`
  return (
    <svg width="200" height="96" viewBox="0 0 200 96" style={{ overflow: 'visible' }}>
      <path d={path} fill="none" stroke="rgba(0,0,0,0.12)" strokeWidth="2" strokeLinecap="round" />
      <path d={path} fill="none" stroke="#1DB954" strokeWidth="2.5" strokeLinecap="round" strokeDasharray="4 3" />
      {pts.map((p, i) => <circle key={i} cx={p[0]} cy={p[1]} r="4" fill={i === 1 ? '#1DB954' : '#1a1a1a'} />)}
      {labels.map((l, i) => <text key={i} x={l.x} y={l.y} textAnchor="middle" fontSize="10" fontWeight="500" fill="#666" fontFamily="-apple-system,sans-serif">{l.text} BPM</text>)}
    </svg>
  )
}

// ── MAIN APP ──────────────────────────────────────────────────────
export default function App() {
  // Auth
  const [token, setToken] = useState(null)
  const [refreshToken, setRefreshToken] = useState(null)
  const [issuedAt, setIssuedAt] = useState(null)
  const [user, setUser] = useState(null)

  // Library
  const [topTracks, setTopTracks] = useState([])
  const [likedTracks, setLikedTracks] = useState([])
  const [playlists, setPlaylists] = useState([])
  const [libraryReady, setLibraryReady] = useState(false)

  // Set builder state
  const [screen, setScreen] = useState('connect') // connect | setup | building | set | saving | saved
  const [eventDesc, setEventDesc] = useState('')
  const [bpmStart, setBpmStart] = useState(122)
  const [bpmPeak, setBpmPeak] = useState(132)
  const [bpmEnd, setBpmEnd] = useState(126)
  const [setLength, setSetLength] = useState('1.5h')
  const [showAnchorPanel, setShowAnchorPanel] = useState(false)
  const [anchorTracks, setAnchorTracks] = useState([])
  const [anchorSearch, setAnchorSearch] = useState('')
  const [anchorResults, setAnchorResults] = useState([])
  const [anchorSearching, setAnchorSearching] = useState(false)

  // Generated set
  const [set, setSet] = useState([])
  const [setVibe, setSetVibe] = useState('')
  const [buildStatus, setBuildStatus] = useState('')
  const [buildError, setBuildError] = useState('')

  // Swap
  const [swappingIndex, setSwappingIndex] = useState(null)
  const [swapAlts, setSwapAlts] = useState([])
  const [swapLoading, setSwapLoading] = useState(false)

  // Preview
  const [playingId, setPlayingId] = useState(null)
  const [playingProgress, setPlayingProgress] = useState(0)
  const audioRef = useRef(null)
  const progressRef = useRef(null)

  // Save
  const [saveStatus, setSaveStatus] = useState('') // '' | 'saving' | 'saved' | 'error'
  const [saveResult, setSaveResult] = useState(null)
  const [saveError, setSaveError] = useState('')
  const [setName, setSetName] = useState('')

  const [toast, setToast] = useState('')
  const setRef = useRef(null)

  const showToast = msg => { setToast(msg); setTimeout(() => setToast(''), 3000) }

  // ── TOKEN MANAGEMENT ─────────────────────────────────────────────
  const getValidToken = useCallback(async () => {
    if (!refreshToken) return token
    const age = Date.now() - (issuedAt || 0)
    if (age < 45 * 60 * 1000 && token) return token // still fresh
    try {
      const res = await fetch('/api/refresh', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refresh_token: refreshToken }),
      })
      const data = await res.json()
      if (data.access_token) {
        setToken(data.access_token)
        setIssuedAt(data.issued_at || Date.now())
        return data.access_token
      }
    } catch { }
    return token
  }, [token, refreshToken, issuedAt])

  // Proactive refresh every 45 min
  useEffect(() => {
    if (!refreshToken) return
    const interval = setInterval(() => getValidToken(), 45 * 60 * 1000)
    return () => clearInterval(interval)
  }, [refreshToken, getValidToken])

  const spFetch = useCallback(async (url, opts = {}) => {
    const t = await getValidToken()
    const r = await fetch(url, { ...opts, headers: { Authorization: `Bearer ${t}`, ...opts.headers } })
    if (!r.ok) throw new Error(`${r.status}`)
    return r.json()
  }, [getValidToken])

  // ── PARSE TOKEN FROM URL ─────────────────────────────────────────
  useEffect(() => {
    // Read token from cookie (set by server at login)
    const getCookie = name => {
      const match = document.cookie.match(new RegExp('(^| )' + name + '=([^;]+)'))
      return match ? match[2] : null
    }
    
    const hash = window.location.hash.substring(1)
    if (hash) {
      const p = new URLSearchParams(hash)
      if (p.get('logged_in') === 'true') {
        // Token is in cookie, read it from there
        const at = getCookie('sp_access_token')
        const rt = getCookie('sp_refresh_token')
        const ia = p.get('issued_at')
        if (at) {
          setToken(at)
          if (rt) setRefreshToken(rt)
          if (ia) setIssuedAt(parseInt(ia))
        }
        window.history.replaceState({}, '', '/')
      } else {
        // Legacy hash token support
        const at = p.get('access_token'), rt = p.get('refresh_token'), ia = p.get('issued_at')
        if (at) {
          setToken(at)
          if (rt) setRefreshToken(rt)
          if (ia) setIssuedAt(parseInt(ia))
          window.history.replaceState({}, '', '/')
        }
      }
    }
    const urlParams = new URLSearchParams(window.location.search)
    if (urlParams.get('error')) showToast('Login failed — please try again')
  }, [])

  // ── LOAD USER + LIBRARY ──────────────────────────────────────────
  useEffect(() => {
    if (!token) return
    spFetch('https://api.spotify.com/v1/me').then(u => {
      setUser(u)
      setScreen('setup')
      setSetName(`wave. DJ Set — ${new Date().toLocaleDateString()}`)
      loadLibrary()
    }).catch(() => showToast('Could not connect to Spotify'))
  }, [token])

  async function loadLibrary() {
    try {
      const [topRes, likedRes, plRes] = await Promise.all([
        spFetch('https://api.spotify.com/v1/me/top/tracks?limit=50&time_range=medium_term'),
        spFetch('https://api.spotify.com/v1/me/tracks?limit=50'),
        spFetch('https://api.spotify.com/v1/me/playlists?limit=50'),
      ])
      setTopTracks(topRes.items || [])
      setLikedTracks((likedRes.items || []).map(i => i.track).filter(Boolean))
      setPlaylists(plRes.items || [])
      setLibraryReady(true)
    } catch { setLibraryReady(true) }
  }

  // ── ANCHOR TRACK SEARCH ──────────────────────────────────────────
  async function searchAnchors(q) {
    if (!q.trim()) { setAnchorResults([]); return }
    setAnchorSearching(true)
    try {
      const data = await spFetch(`https://api.spotify.com/v1/search?q=${encodeURIComponent(q)}&type=track&limit=8`)
      setAnchorResults(data.tracks?.items || [])
    } catch { }
    setAnchorSearching(false)
  }

  useEffect(() => {
    const t = setTimeout(() => searchAnchors(anchorSearch), 400)
    return () => clearTimeout(t)
  }, [anchorSearch])

  function addAnchor(track) {
    if (anchorTracks.find(t => t.id === track.id)) return
    if (anchorTracks.length >= 5) { showToast('Max 5 anchor tracks'); return }
    setAnchorTracks(prev => [...prev, track])
    setAnchorSearch('')
    setAnchorResults([])
  }

  function removeAnchor(id) {
    setAnchorTracks(prev => prev.filter(t => t.id !== id))
  }

  // ── BUILD SET ────────────────────────────────────────────────────
  async function buildSet() {
    if (!eventDesc.trim()) { showToast('Please describe your event first'); return }
    setScreen('building')
    setBuildError('')
    setBuildStatus('Claude is reading your event...')
    setSet([])

    try {
      const t = await getValidToken()
      setBuildStatus('Building your set narrative...')
      const res = await fetch('/api/build-set', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          eventDescription: eventDesc,
          bpmStart, bpmPeak, bpmEnd, setLength,
          anchorTracks,
          topTracks: topTracks.slice(0, 30),
          likedTracks: likedTracks.slice(0, 30),
          token: t,
        }),
      })
      const data = await res.json()
      if (!res.ok || !data.tracks?.length) {
        setBuildError(data.error || 'Could not build set — please try again')
        setScreen('setup')
        return
      }
      setSet(data.tracks)
      setSetVibe(data.vibe || '')
      setBuildStatus('')
      setScreen('set')
      if (data.newDiscoveries > 0) {
        showToast(`${data.newDiscoveries} new discoveries in your set`)
      }
      setTimeout(() => setRef.current?.scrollIntoView({ behavior: 'smooth' }), 100)
    } catch (e) {
      setBuildError('Something went wrong — please try again')
      setScreen('setup')
    }
  }

  // ── SWAP TRACK ───────────────────────────────────────────────────
  async function startSwap(index) {
    setSwappingIndex(index)
    setSwapAlts([])
    setSwapLoading(true)
    try {
      const t = await getValidToken()
      const res = await fetch('/api/swap-track', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ trackIndex: index, currentSet: set, eventDescription: eventDesc, token: t }),
      })
      const data = await res.json()
      setSwapAlts(data.alternatives || [])
    } catch { showToast('Could not load alternatives') }
    setSwapLoading(false)
  }

  function confirmSwap(alt) {
    setSet(prev => prev.map((t, i) => i === swappingIndex ? alt : t))
    setSwappingIndex(null)
    setSwapAlts([])
  }

  function cancelSwap() {
    setSwappingIndex(null)
    setSwapAlts([])
  }

  function moveTrack(index, dir) {
    const newSet = [...set]
    const target = index + dir
    if (target < 0 || target >= newSet.length) return
    ;[newSet[index], newSet[target]] = [newSet[target], newSet[index]]
    setSet(newSet)
  }

  function removeTrack(index) {
    setSet(prev => prev.filter((_, i) => i !== index))
  }

  // ── PREVIEW ──────────────────────────────────────────────────────
  function togglePreview(track) {
    if (!track.preview_url) { showToast('No preview available for this track'); return }
    if (playingId === track.id) {
      audioRef.current?.pause()
      setPlayingId(null)
      clearInterval(progressRef.current)
      setPlayingProgress(0)
      return
    }
    if (audioRef.current) { audioRef.current.pause(); clearInterval(progressRef.current) }
    // Use proxy to avoid CORS issues with Spotify preview URLs
    const proxyUrl = `/api/preview?url=${encodeURIComponent(track.preview_url)}`
    const audio = new Audio(proxyUrl)
    audioRef.current = audio
    setPlayingId(track.id)
    setPlayingProgress(0)
    audio.play().catch(() => showToast('Could not play preview'))
    progressRef.current = setInterval(() => {
      if (audio.ended) { setPlayingId(null); setPlayingProgress(0); clearInterval(progressRef.current); return }
      setPlayingProgress(audio.currentTime / 30)
    }, 100)
    audio.onended = () => { setPlayingId(null); setPlayingProgress(0); clearInterval(progressRef.current) }
  }

  useEffect(() => () => { audioRef.current?.pause(); clearInterval(progressRef.current) }, [])

  // ── SAVE SET ─────────────────────────────────────────────────────
  async function saveSet() {
    if (!set.length) return
    setSaveStatus('saving')
    setSaveError('')
    try {
      // Get the current live token — do NOT refresh, use exactly what the browser has
      const activeToken = token

      const res = await fetch('/api/save-set', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tracks: set,
          setName,
          eventDescription: eventDesc,
          vibe: setVibe,
          token: token,
        }),
      })

      const data = await res.json()
      if (!res.ok || !data.success) {
        setSaveError(data.error || 'Save failed — please try again')
        setSaveStatus('error')
        return
      }
      setSaveResult(data)
      setSaveStatus('saved')
    } catch (e) {
      setSaveError(`Connection error: ${e.message}`)
      setSaveStatus('error')
    }
  }

  // ── SHARED STYLES ─────────────────────────────────────────────────
  const s = {
    app: { fontFamily: '-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif', background: '#f5f5f3', minHeight: '100vh' },
    topbar: { background: '#fff', borderBottom: '0.5px solid rgba(0,0,0,0.08)', padding: '12px 20px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', position: 'sticky', top: 0, zIndex: 20 },
    logo: { fontSize: 16, fontWeight: 500, letterSpacing: -0.5 },
    main: { maxWidth: 680, margin: '0 auto', padding: '28px 20px' },
    card: { background: '#fff', border: '0.5px solid rgba(0,0,0,0.08)', borderRadius: 14, padding: '20px 22px', marginBottom: 14 },
    label: { fontSize: 10, fontWeight: 500, color: '#aaa', letterSpacing: '0.8px', textTransform: 'uppercase', marginBottom: 10, display: 'block' },
    title: { fontSize: 22, fontWeight: 500, letterSpacing: -0.4, marginBottom: 6 },
    sub: { fontSize: 13, color: '#888', lineHeight: 1.6, marginBottom: 20 },
    input: { width: '100%', padding: '11px 14px', borderRadius: 10, border: '0.5px solid rgba(0,0,0,0.15)', background: '#fafaf8', fontSize: 14, fontFamily: 'inherit', outline: 'none', resize: 'vertical' },
    btn: { padding: '10px 18px', borderRadius: 10, fontSize: 13, fontFamily: 'inherit', cursor: 'pointer', border: '0.5px solid rgba(0,0,0,0.12)', background: '#fff', color: '#555', transition: 'all 0.15s' },
    btnPrimary: { padding: '13px 24px', borderRadius: 12, fontSize: 14, fontFamily: 'inherit', cursor: 'pointer', border: 'none', background: '#1a1a1a', color: '#fff', fontWeight: 500, width: '100%', transition: 'opacity 0.15s' },
    btnSpotify: { display: 'inline-flex', alignItems: 'center', gap: 8, background: '#1DB954', color: '#fff', borderRadius: 28, padding: '12px 28px', fontSize: 14, fontWeight: 500, textDecoration: 'none', border: 'none', cursor: 'pointer', fontFamily: 'inherit' },
    bpmInput: { width: '100%', padding: '8px 12px', borderRadius: 8, border: '0.5px solid rgba(0,0,0,0.12)', background: '#f7f7f5', fontSize: 16, fontWeight: 500, fontFamily: 'monospace', textAlign: 'center', outline: 'none' },
  }

  const SpotifyIcon = ({ size = 16 }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor">
      <path d="M12 0C5.4 0 0 5.4 0 12s5.4 12 12 12 12-5.4 12-12S18.66 0 12 0zm5.521 17.34c-.24.359-.66.48-1.021.24-2.82-1.74-6.36-2.101-10.561-1.141-.418.122-.779-.179-.899-.539-.12-.421.18-.78.54-.9 4.56-1.021 8.52-.6 11.64 1.32.42.18.479.659.301 1.02zm1.44-3.3c-.301.42-.841.6-1.262.3-3.239-1.98-8.159-2.58-11.939-1.38-.479.12-1.02-.12-1.14-.6-.12-.48.12-1.021.6-1.141C9.6 9.9 15 10.561 18.72 12.84c.361.181.54.78.241 1.2zm.12-3.36C15.24 8.4 8.82 8.16 5.16 9.301c-.6.179-1.2-.181-1.38-.721-.18-.601.18-1.2.72-1.381 4.26-1.26 11.28-1.02 15.721 1.621.539.3.719 1.02.419 1.56-.299.421-1.02.599-1.559.3z"/>
    </svg>
  )

  // ── SCREENS ───────────────────────────────────────────────────────

  // CONNECT
  if (screen === 'connect') return (
    <div style={{ ...s.app, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minHeight: '100vh', textAlign: 'center', padding: '0 24px' }}>
      <div style={{ width: 64, height: 64, borderRadius: '50%', background: '#1DB954', display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: 22 }}>
        <SpotifyIcon size={32} />
      </div>
      <div style={{ fontSize: 28, fontWeight: 500, letterSpacing: -0.8, marginBottom: 8 }}>wave. <span style={{ color: '#1DB954' }}>DJ</span></div>
      <div style={{ fontSize: 15, color: '#888', lineHeight: 1.7, marginBottom: 10, maxWidth: 320 }}>Build perfect DJ sets with AI.</div>
      <div style={{ fontSize: 13, color: '#bbb', lineHeight: 1.7, marginBottom: 32, maxWidth: 300 }}>Describe your event. AI builds a smooth, ordered set from your Spotify library. Preview every track. Save to Spotify.</div>
      <a href="/api/auth/login" style={s.btnSpotify}>
        <SpotifyIcon size={16} /> Log in with Spotify
      </a>
    </div>
  )

  // BUILDING
  if (screen === 'building') return (
    <div style={{ ...s.app, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minHeight: '100vh', textAlign: 'center', padding: '0 24px' }}>
      <Spinner size={28} color="#1DB954" />
      <div style={{ fontSize: 15, color: '#555', marginTop: 20, marginBottom: 8, fontWeight: 500 }}>{buildStatus}</div>
      <div style={{ fontSize: 13, color: '#aaa' }}>Claude + Spotify are building your set...</div>
    </div>
  )

  return (
    <div style={s.app}>
      {/* TOPBAR */}
      <div style={s.topbar}>
        <div style={s.logo}>wave. <span style={{ color: '#1DB954' }}>DJ</span></div>
        {user && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            {user.images?.[0]?.url && <img src={user.images[0].url} alt="" style={{ width: 26, height: 26, borderRadius: '50%', objectFit: 'cover' }} />}
            <div style={{ display: 'flex', alignItems: 'center', gap: 7, padding: '5px 12px', borderRadius: 20, border: '0.5px solid rgba(0,0,0,0.1)', background: '#f5f5f3', fontSize: 12, color: '#666' }}>
              <div style={{ width: 6, height: 6, borderRadius: '50%', background: '#1DB954' }} />
              <span>{user.display_name || user.id}</span>
              <span style={{ color: '#ddd', margin: '0 2px' }}>·</span>
              <span style={{ cursor: 'pointer', color: '#bbb' }} onClick={() => { setToken(null); setUser(null); setScreen('connect') }}>log out</span>
            </div>
          </div>
        )}
      </div>

      <div style={s.main}>

        {/* ── SETUP SCREEN ── */}
        {screen === 'setup' && (
          <div>
            <div style={s.title}>Build your set</div>
            <div style={s.sub}>Describe your event and AI builds a perfectly ordered set from your Spotify library.</div>

            {buildError && (
              <div style={{ background: '#FCEBEB', border: '0.5px solid #F09595', borderRadius: 10, padding: '12px 16px', fontSize: 13, color: '#791F1F', marginBottom: 14 }}>
                {buildError}
              </div>
            )}

            {/* EVENT DESCRIPTION */}
            <div style={s.card}>
              <span style={s.label}>Describe your event</span>
              <textarea
                value={eventDesc}
                onChange={e => setEventDesc(e.target.value)}
                placeholder="e.g. Saturday night warehouse rave, Berlin-style, 300 people, I play 1am–3am peak hour, dark minimal techno, experienced crowd..."
                rows={4}
                style={{ ...s.input, lineHeight: 1.6 }}
              />
              <div style={{ fontSize: 11, color: '#bbb', marginTop: 8 }}>The more detail you give, the better the set. Include: venue, crowd, time, genre, your slot.</div>
            </div>

            {/* BPM ARC */}
            <div style={s.card}>
              <span style={s.label}>BPM arc</span>
              <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 11, color: '#aaa', marginBottom: 6, textAlign: 'center' }}>Start</div>
                  <input type="number" value={bpmStart} onChange={e => setBpmStart(+e.target.value)} min={60} max={200} style={s.bpmInput} />
                </div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 11, color: '#aaa', marginBottom: 6, textAlign: 'center' }}>Peak</div>
                  <input type="number" value={bpmPeak} onChange={e => setBpmPeak(+e.target.value)} min={60} max={200} style={{ ...s.bpmInput, color: '#1DB954' }} />
                </div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 11, color: '#aaa', marginBottom: 6, textAlign: 'center' }}>End</div>
                  <input type="number" value={bpmEnd} onChange={e => setBpmEnd(+e.target.value)} min={60} max={200} style={s.bpmInput} />
                </div>
              </div>
              <div style={{ display: 'flex', justifyContent: 'center', marginTop: 14 }}>
                <BpmArcViz start={bpmStart} peak={bpmPeak} end={bpmEnd} />
              </div>
            </div>

            {/* SET LENGTH */}
            <div style={s.card}>
              <span style={s.label}>Set length</span>
              <div style={{ display: 'flex', gap: 8 }}>
                {[['1h', '1 hour (~15 tracks)'], ['1.5h', '1.5 hours (~22 tracks)'], ['2h', '2 hours (~30 tracks)']].map(([v, l]) => (
                  <button key={v} onClick={() => setSetLength(v)} style={{ ...s.btn, flex: 1, fontSize: 12, background: setLength === v ? '#1a1a1a' : '#fff', color: setLength === v ? '#fff' : '#555', border: setLength === v ? 'none' : '0.5px solid rgba(0,0,0,0.12)' }}>{l}</button>
                ))}
              </div>
            </div>

            {/* ANCHOR TRACKS — OPTIONAL */}
            <div style={s.card}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: showAnchorPanel ? 14 : 0 }}>
                <div>
                  <span style={{ fontSize: 13, fontWeight: 500, color: '#1a1a1a' }}>Anchor tracks</span>
                  <span style={{ fontSize: 12, color: '#bbb', marginLeft: 8 }}>optional</span>
                </div>
                <button onClick={() => setShowAnchorPanel(p => !p)} style={{ ...s.btn, fontSize: 12, padding: '6px 14px' }}>
                  {showAnchorPanel ? 'Hide' : anchorTracks.length > 0 ? `${anchorTracks.length} selected` : '+ Add tracks'}
                </button>
              </div>

              {!showAnchorPanel && anchorTracks.length === 0 && (
                <div style={{ fontSize: 12, color: '#bbb', lineHeight: 1.6 }}>
                  Pick tracks you definitely want in your set. AI fills the gaps around them.
                </div>
              )}

              {showAnchorPanel && (
                <div>
                  <input
                    type="text"
                    value={anchorSearch}
                    onChange={e => setAnchorSearch(e.target.value)}
                    placeholder="Search for a track..."
                    style={{ ...s.input, marginBottom: 10 }}
                  />
                  {anchorSearching && <div style={{ display: 'flex', justifyContent: 'center', padding: '12px 0' }}><Spinner /></div>}
                  {anchorResults.map(t => (
                    <div key={t.id} onClick={() => addAnchor(t)}
                      style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 0', borderBottom: '0.5px solid rgba(0,0,0,0.05)', cursor: 'pointer' }}
                      onMouseEnter={e => e.currentTarget.style.opacity = '0.7'}
                      onMouseLeave={e => e.currentTarget.style.opacity = '1'}>
                      <AlbumArt images={t.album?.images} size={36} />
                      <div style={{ minWidth: 0 }}>
                        <div style={{ fontSize: 13, fontWeight: 500, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{t.name}</div>
                        <div style={{ fontSize: 11, color: '#999' }}>{(t.artists || []).map(a => a.name).join(', ')}</div>
                      </div>
                      <div style={{ marginLeft: 'auto', fontSize: 18, color: '#1DB954', flexShrink: 0 }}>+</div>
                    </div>
                  ))}

                  {anchorTracks.length > 0 && (
                    <div style={{ marginTop: 12 }}>
                      <div style={{ fontSize: 11, color: '#aaa', marginBottom: 8 }}>Selected anchors:</div>
                      {anchorTracks.map(t => (
                        <div key={t.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '7px 0', borderBottom: '0.5px solid rgba(0,0,0,0.05)' }}>
                          <AlbumArt images={t.album?.images} size={32} />
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ fontSize: 12, fontWeight: 500, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{t.name}</div>
                            <div style={{ fontSize: 11, color: '#999' }}>{(t.artists || []).map(a => a.name).join(', ')}</div>
                          </div>
                          <button onClick={() => removeAnchor(t.id)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#bbb', fontSize: 16, padding: '0 4px' }}>×</button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* BUILD BUTTON */}
            <button onClick={buildSet} disabled={!eventDesc.trim() || !libraryReady}
              style={{ ...s.btnPrimary, opacity: !eventDesc.trim() || !libraryReady ? 0.5 : 1, cursor: !eventDesc.trim() || !libraryReady ? 'not-allowed' : 'pointer' }}>
              {!libraryReady ? 'Loading your library...' : 'Build my set ✦'}
            </button>
          </div>
        )}

        {/* ── SET SCREEN ── */}
        {screen === 'set' && (
          <div ref={setRef}>
            {/* HEADER */}
            <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 6, gap: 12 }}>
              <div>
                <div style={s.title}>Your set</div>
                {setVibe && <div style={{ fontSize: 13, color: '#888', fontStyle: 'italic', marginBottom: 4 }}>"{setVibe}"</div>}
                <div style={{ fontSize: 12, color: '#aaa' }}>{set.length} tracks · {fmtTotalDur(set)}</div>
              </div>
              <button onClick={() => { setScreen('setup'); setSaveStatus(''); setSaveResult(null) }} style={{ ...s.btn, fontSize: 12, padding: '7px 14px', flexShrink: 0 }}>← Edit</button>
            </div>

            {/* BPM ARC VIZ */}
            <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 16 }}>
              <BpmArcViz start={bpmStart} peak={bpmPeak} end={bpmEnd} />
            </div>

            {/* LEGEND */}
            <div style={{ display: 'flex', gap: 12, marginBottom: 14, flexWrap: 'wrap', fontSize: 11 }}>
              <span style={{ display: 'flex', alignItems: 'center', gap: 4, color: '#aaa' }}>
                <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#1DB954', display: 'inline-block' }} /> Perfect mix
              </span>
              <span style={{ display: 'flex', alignItems: 'center', gap: 4, color: '#aaa' }}>
                <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#EF9F27', display: 'inline-block' }} /> Manageable
              </span>
              <span style={{ display: 'flex', alignItems: 'center', gap: 4, color: '#aaa' }}>
                <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#bbb', display: 'inline-block' }} /> Unknown
              </span>
              <span style={{ color: '#aaa' }}>· Tap ▶ to preview · Tap track to swap</span>
            </div>

            {/* TRACK LIST */}
            <div style={{ background: '#fff', border: '0.5px solid rgba(0,0,0,0.08)', borderRadius: 14, overflow: 'hidden', marginBottom: 16 }}>
              {set.map((track, i) => {
                const nextTrack = set[i + 1]
                const compat = nextTrack ? getCompatScore(track._key, nextTrack._key) : null
                const compatColor = compat === 'perfect' ? '#1DB954' : compat === 'good' ? '#EF9F27' : '#ccc'
                const isPlaying = playingId === track.id
                const isSwapping = swappingIndex === i

                return (
                  <div key={track.id + i}>
                    {/* TRACK ROW */}
                    <div style={{ padding: '0 14px' }}>
                      <div style={{ display: 'grid', gridTemplateColumns: '24px 44px 1fr auto', gap: 10, alignItems: 'center', padding: '12px 0', borderBottom: isSwapping ? 'none' : '0.5px solid rgba(0,0,0,0.05)', background: isSwapping ? '#fafaf8' : 'transparent' }}>
                        {/* Track number */}
                        <div style={{ fontSize: 11, color: '#ccc', textAlign: 'center', fontFamily: 'monospace' }}>{i + 1}</div>

                        {/* Album art + play button */}
                        <div style={{ position: 'relative', cursor: 'pointer' }} onClick={() => togglePreview(track)}>
                          <AlbumArt images={track.album?.images} size={44} />
                          <div style={{ position: 'absolute', inset: 0, borderRadius: 6, background: 'rgba(0,0,0,0.35)', display: 'flex', alignItems: 'center', justifyContent: 'center', opacity: isPlaying ? 1 : 0, transition: 'opacity 0.15s' }}
                            onMouseEnter={e => e.currentTarget.style.opacity = '1'}
                            onMouseLeave={e => { if (!isPlaying) e.currentTarget.style.opacity = '0' }}>
                            {isPlaying
                              ? <svg width="14" height="14" viewBox="0 0 24 24" fill="white"><rect x="6" y="4" width="4" height="16" /><rect x="14" y="4" width="4" height="16" /></svg>
                              : <svg width="12" height="14" viewBox="0 0 24 24" fill="white"><polygon points="5 3 19 12 5 21 5 3" /></svg>}
                          </div>
                          {!track.preview_url && <div style={{ position: 'absolute', bottom: 2, right: 2, width: 8, height: 8, borderRadius: '50%', background: '#ccc', border: '1px solid #fff' }} />}
                        </div>

                        {/* Track info */}
                        <div style={{ minWidth: 0 }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 2 }}>
                            <div style={{ fontSize: 13, fontWeight: 500, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{track.name}</div>
                            {track._isNew && <span style={{ fontSize: 9, padding: '2px 6px', borderRadius: 8, background: '#E1F5EE', color: '#085041', fontWeight: 500, flexShrink: 0, whiteSpace: 'nowrap' }}>new</span>}
                          </div>
                          <div style={{ fontSize: 11, color: '#999', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', marginBottom: 3 }}>
                            {(track.artists || []).map(a => a.name).join(', ')}
                          </div>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                            {track._bpm && <span style={{ fontSize: 10, padding: '1px 6px', borderRadius: 5, background: '#f0f0ee', color: '#666', fontFamily: 'monospace' }}>{track._bpm} BPM</span>}
                            {track._key && <span style={{ fontSize: 10, padding: '1px 6px', borderRadius: 5, background: '#f0f0ee', color: '#666', fontWeight: 500 }}>{track._key}</span>}
                            {track._role && <span style={{ fontSize: 10, color: '#bbb' }}>· {track._role}</span>}
                          </div>
                        </div>

                        {/* Actions */}
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 4, alignItems: 'flex-end' }}>
                          <div style={{ display: 'flex', gap: 4 }}>
                            <button onClick={() => moveTrack(i, -1)} disabled={i === 0} style={{ width: 24, height: 24, borderRadius: 6, border: '0.5px solid rgba(0,0,0,0.1)', background: '#fff', cursor: i === 0 ? 'not-allowed' : 'pointer', opacity: i === 0 ? 0.3 : 1, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, color: '#666' }}>↑</button>
                            <button onClick={() => moveTrack(i, 1)} disabled={i === set.length - 1} style={{ width: 24, height: 24, borderRadius: 6, border: '0.5px solid rgba(0,0,0,0.1)', background: '#fff', cursor: i === set.length - 1 ? 'not-allowed' : 'pointer', opacity: i === set.length - 1 ? 0.3 : 1, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, color: '#666' }}>↓</button>
                          </div>
                          <div style={{ display: 'flex', gap: 4 }}>
                            <button onClick={() => startSwap(i)} style={{ width: 24, height: 24, borderRadius: 6, border: '0.5px solid rgba(0,0,0,0.1)', background: '#fff', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 10, color: '#666' }} title="Swap track">⇄</button>
                            <button onClick={() => removeTrack(i)} style={{ width: 24, height: 24, borderRadius: 6, border: '0.5px solid rgba(0,0,0,0.1)', background: '#fff', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 13, color: '#bbb' }} title="Remove">×</button>
                          </div>
                        </div>
                      </div>

                      {/* PROGRESS BAR for playing track */}
                      {isPlaying && (
                        <div style={{ height: 2, background: 'rgba(0,0,0,0.06)', borderRadius: 1, marginBottom: 8, marginTop: -4 }}>
                          <div style={{ height: '100%', background: '#1DB954', borderRadius: 1, width: `${playingProgress * 100}%`, transition: 'width 0.1s linear' }} />
                        </div>
                      )}

                      {/* SWAP PANEL */}
                      {isSwapping && (
                        <div style={{ background: '#fafaf8', borderRadius: 10, padding: '12px 0', marginBottom: 10 }}>
                          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
                            <div style={{ fontSize: 12, fontWeight: 500, color: '#555' }}>
                              {swapLoading ? 'Finding alternatives...' : `${swapAlts.length} alternatives`}
                            </div>
                            <button onClick={cancelSwap} style={{ fontSize: 12, color: '#bbb', background: 'none', border: 'none', cursor: 'pointer' }}>cancel</button>
                          </div>
                          {swapLoading && <div style={{ display: 'flex', justifyContent: 'center', padding: '8px 0' }}><Spinner /></div>}
                          {swapAlts.map((alt, ai) => (
                            <div key={alt.id + ai} onClick={() => confirmSwap(alt)}
                              style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 0', borderTop: '0.5px solid rgba(0,0,0,0.05)', cursor: 'pointer' }}
                              onMouseEnter={e => e.currentTarget.style.background = '#f5f5f3'}
                              onMouseLeave={e => e.currentTarget.style.background = ''}>
                              <AlbumArt images={alt.album?.images} size={36} />
                              <div style={{ flex: 1, minWidth: 0 }}>
                                <div style={{ fontSize: 12, fontWeight: 500, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{alt.name}</div>
                                <div style={{ fontSize: 11, color: '#999' }}>{(alt.artists || []).map(a => a.name).join(', ')}</div>
                                <div style={{ fontSize: 10, color: '#bbb', marginTop: 1 }}>{alt._bpm} BPM · {alt._key} · {alt._role}</div>
                              </div>
                              <div style={{ fontSize: 12, color: '#1DB954', flexShrink: 0, fontWeight: 500 }}>Use →</div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>

                    {/* TRANSITION CONNECTOR */}
                    {nextTrack && (
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '4px 14px', background: 'rgba(0,0,0,0.015)' }}>
                        <div style={{ width: 6, height: 6, borderRadius: '50%', background: compatColor, flexShrink: 0 }} />
                        <div style={{ fontSize: 10, color: '#bbb', flex: 1 }}>
                          {track._transition || `${track._key} → ${nextTrack._key} · ${nextTrack._bpm ? (nextTrack._bpm - (track._bpm || 0) > 0 ? '+' : '') + (nextTrack._bpm - (track._bpm || 0)) + ' BPM' : ''}`}
                        </div>
                      </div>
                    )}
                  </div>
                )
              })}
            </div>

            {/* MINI PLAYER */}
            {playingId && (() => {
              const pt = set.find(t => t.id === playingId)
              return pt ? (
                <div style={{ background: '#1a1a1a', borderRadius: 12, padding: '12px 16px', display: 'flex', alignItems: 'center', gap: 12, marginBottom: 14 }}>
                  <AlbumArt images={pt.album?.images} size={36} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 12, fontWeight: 500, color: '#fff', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{pt.name}</div>
                    <div style={{ fontSize: 10, color: '#888', marginTop: 1 }}>30s preview · {Math.round(playingProgress * 30)}s / 30s</div>
                    <div style={{ height: 2, background: 'rgba(255,255,255,0.15)', borderRadius: 1, marginTop: 6 }}>
                      <div style={{ height: '100%', background: '#1DB954', borderRadius: 1, width: `${playingProgress * 100}%`, transition: 'width 0.1s linear' }} />
                    </div>
                  </div>
                  <button onClick={() => togglePreview(pt)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#fff', fontSize: 18, padding: '4px 8px' }}>⏹</button>
                </div>
              ) : null
            })()}

            {/* SAVE SECTION */}
            <div style={s.card}>
              <span style={s.label}>Save to Spotify</span>

              {saveStatus === '' && (
                <>
                  <input value={setName} onChange={e => setSetName(e.target.value)} placeholder="Set name..." style={{ ...s.input, marginBottom: 12 }} />
                  <button onClick={saveSet} style={s.btnPrimary}>
                    <span style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
                      <SpotifyIcon size={16} /> Save {set.length} tracks to Spotify
                    </span>
                  </button>
                </>
              )}

              {saveStatus === 'saving' && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 0', color: '#666', fontSize: 13 }}>
                  <Spinner size={18} color="#1DB954" />
                  Refreshing token · Creating playlist · Adding tracks · Verifying...
                </div>
              )}

              {saveStatus === 'saved' && saveResult && (
                <div style={{ background: '#E1F5EE', border: '0.5px solid #9FE1CB', borderRadius: 10, padding: '14px 16px' }}>
                  <div style={{ fontSize: 14, fontWeight: 500, color: '#085041', marginBottom: 4 }}>
                    ✓ Saved successfully
                  </div>
                  <div style={{ fontSize: 12, color: '#0F6E56', marginBottom: 12 }}>
                    {saveResult.tracksAdded} tracks saved to "{setName}" · {saveResult.verified ? 'Verified ✓' : 'Check your Spotify'}
                  </div>
                  <a href={saveResult.playlistUrl} target="_blank" rel="noopener noreferrer"
                    style={{ display: 'inline-flex', alignItems: 'center', gap: 6, background: '#1DB954', color: '#fff', borderRadius: 8, padding: '8px 14px', fontSize: 12, fontWeight: 500, textDecoration: 'none' }}>
                    <SpotifyIcon size={13} /> Open in Spotify →
                  </a>
                  <button onClick={() => { setSaveStatus(''); setSaveResult(null) }} style={{ ...s.btn, fontSize: 12, marginLeft: 8, padding: '7px 14px' }}>Save again</button>
                </div>
              )}

              {saveStatus === 'error' && (
                <div style={{ background: '#FCEBEB', border: '0.5px solid #F09595', borderRadius: 10, padding: '14px 16px' }}>
                  <div style={{ fontSize: 13, fontWeight: 500, color: '#791F1F', marginBottom: 6 }}>Save failed</div>
                  <div style={{ fontSize: 12, color: '#A32D2D', marginBottom: 12 }}>{saveError}</div>
                  <button onClick={saveSet} style={{ ...s.btnPrimary, width: 'auto', padding: '8px 18px', fontSize: 12 }}>Retry</button>
                  <button onClick={() => setSaveStatus('')} style={{ ...s.btn, fontSize: 12, marginLeft: 8 }}>Cancel</button>
                </div>
              )}
            </div>

            {/* REBUILD */}
            <button onClick={() => { setScreen('setup'); setSaveStatus(''); setSaveResult(null) }}
              style={{ ...s.btn, width: '100%', fontSize: 13, padding: '11px', textAlign: 'center' }}>
              ← Build a different set
            </button>
          </div>
        )}

      </div>

      {/* TOAST */}
      {toast && (
        <div style={{ position: 'fixed', bottom: 24, left: '50%', transform: 'translateX(-50%)', background: '#1a1a1a', color: '#fff', padding: '9px 20px', borderRadius: 22, fontSize: 13, zIndex: 100, whiteSpace: 'nowrap' }}>
          {toast}
        </div>
      )}
    </div>
  )
}
