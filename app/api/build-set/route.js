import { NextResponse } from 'next/server'

export async function POST(request) {
  const {
    eventDescription, bpmStart, bpmPeak, bpmEnd, setLength,
    anchorTracks, topTracks, likedTracks, token
  } = await request.json()

  // Build taste profile — used as context only, NOT as track source
  const allLibrary = [...(topTracks || []), ...(likedTracks || [])]
  const seen = new Set()
  const libraryTracks = allLibrary
    .filter(t => { if (!t?.id || seen.has(t.id)) return false; seen.add(t.id); return true })
    .slice(0, 40)

  // Extract taste signals: genres, artists, energy patterns
  const artistNames = [...new Set(libraryTracks.flatMap(t => (t.artists || []).map(a => a.name)))].slice(0, 20)
  const sampleTracks = libraryTracks.slice(0, 15).map(t => `"${t.name}" by ${(t.artists || []).map(a => a.name).join(', ')}`)

  // All existing track names to AVOID recommending
  const libraryTrackNames = new Set(libraryTracks.map(t => t.name.toLowerCase()))

  const anchorInfo = (anchorTracks || []).length > 0
    ? `\nANCHOR TRACKS (place these at appropriate positions in the set):\n${(anchorTracks || []).map((t, i) =>
        `${i + 1}. "${t.name}" by ${(t.artists || []).map(a => a.name).join(', ')}`
      ).join('\n')}`
    : '\nNo anchor tracks — build the full set from scratch.'

  const trackCount = setLength === '1h' ? 15 : setLength === '2h' ? 25 : 20

  let claudeText = ''

  try {
    const claudeRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 2500,
        messages: [{
          role: 'user',
          content: `You are an expert DJ and music curator with 15+ years experience building professional sets.

EVENT TO PREPARE FOR:
${eventDescription}

BPM ARC: Start at ${bpmStart} BPM → Peak at ${bpmPeak} BPM → Land at ${bpmEnd} BPM
SET LENGTH: ${trackCount} tracks
${anchorInfo}

DJ TASTE PROFILE (use this to understand their style — do NOT copy these tracks):
Artists they like: ${artistNames.join(', ')}
Sample of their library: ${sampleTracks.join(' | ')}

YOUR MISSION:
Build a set of ${trackCount} tracks that a professional DJ would actually play at this event.

CRITICAL RULES:
1. DISCOVERY FOCUS — At least 70% of tracks must be songs NOT already in the DJ's library. Think like a record store owner recommending new music based on taste.
2. REAL TRACKS ONLY — Every track must be a real song that exists on Spotify right now.
3. BPM ARC — Follow the arc naturally. Each track's BPM should progress smoothly.
4. HARMONIC MIXING — Use Camelot wheel. Consecutive tracks should be in compatible keys (same number ±1, or same key ±A/B).
5. EVENT FIT — Every track must suit the event description. Think about the crowd, the time, the energy.
6. SMOOTH NARRATIVE — The set should tell a story. Think about how a real DJ builds tension and release.
7. ANCHOR TRACKS — Include any anchor tracks at the right energy position in the arc.

For each track output EXACTLY this format on one line:
TRACK: "Song Name" by Artist Name | BPM: 128 | KEY: 8A | ROLE: opening groove sets tone | TRANSITION: same key smooth energy push

After all tracks:
VIBE: [one vivid sentence describing the emotional journey of this set, max 15 words]

Output ONLY the track lines and the VIBE line. Nothing else. No numbering, no explanations.`
        }]
      })
    })

    if (claudeRes.ok) {
      const d = await claudeRes.json()
      claudeText = d.content?.[0]?.text || ''
    }
  } catch (e) {
    return NextResponse.json({ error: 'AI service unavailable — please try again' }, { status: 500 })
  }

  if (!claudeText.trim()) {
    return NextResponse.json({ error: 'No response from AI — please try again' }, { status: 500 })
  }

  // Parse tracks
  const trackLines = claudeText.split('\n').filter(l => l.trim().startsWith('TRACK:'))

  const parsedTracks = trackLines.map(line => {
    const nameMatch = line.match(/TRACK:\s*["""]?(.+?)["""]?\s+by\s+/i)
    const artistMatch = line.match(/\bby\s+(.+?)\s*\|/i)
    const bpmMatch = line.match(/BPM:\s*(\d+)/i)
    const keyMatch = line.match(/KEY:\s*([A-G][#b]?\s*(?:min|maj|major|minor)?|[0-9]{1,2}[AB])/i)
    const roleMatch = line.match(/ROLE:\s*([^\|]+)/i)
    const transMatch = line.match(/TRANSITION:\s*(.+)/i)
    if (!nameMatch || !artistMatch) return null
    return {
      name: nameMatch[1].replace(/["""'']/g, '').trim(),
      artist: artistMatch[1].trim(),
      bpm: bpmMatch ? parseInt(bpmMatch[1]) : null,
      key: keyMatch ? keyMatch[1].trim() : null,
      role: roleMatch ? roleMatch[1].trim() : null,
      transition: transMatch ? transMatch[1].trim() : null,
    }
  }).filter(Boolean)

  const vibeMatch = claudeText.match(/VIBE:\s*(.+)/i)
  const vibe = vibeMatch ? vibeMatch[1].trim() : ''

  if (!parsedTracks.length) {
    return NextResponse.json({
      error: 'Could not parse AI response — please try again',
    }, { status: 500 })
  }

  // Search Spotify for each track — try multiple search strategies
  const resolvedTracks = []
  const resolvedIds = new Set()

  for (const ct of parsedTracks) {
    try {
      let track = null
      const searches = [
        `track:"${ct.name}" artist:"${ct.artist}"`,
        `"${ct.name}" "${ct.artist}"`,
        `${ct.name} ${ct.artist}`,
        ct.name,
      ]
      for (const q of searches) {
        if (track) break
        try {
          const res = await fetch(
            `https://api.spotify.com/v1/search?q=${encodeURIComponent(q)}&type=track&limit=5`,
            { headers: { Authorization: `Bearer ${token}` } }
          )
          const data = await res.json()
          const items = data.tracks?.items || []
          track = items.find(t =>
            t.name.toLowerCase().includes(ct.name.toLowerCase().substring(0, 10)) &&
            (t.artists || []).some(a => a.name.toLowerCase().includes(ct.artist.toLowerCase().split(' ')[0]))
          ) || items.find(t =>
            t.name.toLowerCase().includes(ct.name.toLowerCase().substring(0, 8))
          ) || items[0]
        } catch { }
      }

      if (track && !resolvedIds.has(track.id)) {
        resolvedIds.add(track.id)
        resolvedTracks.push({
          id: track.id,
          uri: track.uri,
          name: track.name,
          artists: track.artists,
          album: track.album,
          duration_ms: track.duration_ms,
          preview_url: track.preview_url,
          external_urls: track.external_urls,
          _bpm: ct.bpm,
          _key: ct.key,
          _role: ct.role,
          _transition: ct.transition,
          _source: 'ai',
          _isNew: !libraryTrackNames.has(track.name.toLowerCase()),
        })
      }
    } catch { }
  }

  // Always include anchor tracks — add any that weren't found by Claude
  for (const anchor of (anchorTracks || [])) {
    if (!resolvedIds.has(anchor.id)) {
      resolvedIds.add(anchor.id)
      resolvedTracks.push({
        ...anchor,
        _bpm: null,
        _key: null,
        _role: 'anchor track',
        _transition: null,
        _source: 'anchor',
        _isNew: false,
      })
    }
  }

  // Fill remaining with Spotify recommendations if needed (from seeds based on taste, not library copy)
  if (resolvedTracks.length < Math.round(trackCount * 0.6)) {
    try {
      // Use anchor tracks + top tracks as seeds for discovery
      const seedTracks = [
        ...(anchorTracks || []).slice(0, 2),
        ...(topTracks || []).slice(0, 3),
      ].map(t => t.id).filter(Boolean).slice(0, 5)

      if (seedTracks.length > 0) {
        const params = new URLSearchParams({
          limit: String(Math.min(20, trackCount - resolvedTracks.length)),
          seed_tracks: seedTracks.join(','),
          target_tempo: String(Math.round((bpmStart + bpmPeak) / 2)),
          min_tempo: String(Math.max(60, bpmStart - 10)),
          max_tempo: String(Math.min(220, bpmPeak + 10)),
          target_energy: '0.8',
          target_danceability: '0.75',
          min_popularity: '20',
        })
        const recRes = await fetch(
          `https://api.spotify.com/v1/recommendations?${params}`,
          { headers: { Authorization: `Bearer ${token}` } }
        )
        const recData = await recRes.json()
        for (const t of (recData.tracks || [])) {
          if (!resolvedIds.has(t.id)) {
            resolvedIds.add(t.id)
            resolvedTracks.push({
              id: t.id, uri: t.uri, name: t.name, artists: t.artists,
              album: t.album, duration_ms: t.duration_ms,
              preview_url: t.preview_url, external_urls: t.external_urls,
              _bpm: null, _key: null, _role: 'similar track', _transition: null,
              _source: 'spotify', _isNew: !libraryTrackNames.has(t.name.toLowerCase()),
            })
          }
        }
      }
    } catch { }
  }

  if (!resolvedTracks.length) {
    return NextResponse.json({ error: 'Could not find tracks on Spotify — please try again' }, { status: 500 })
  }

  // Count new discoveries
  const newCount = resolvedTracks.filter(t => t._isNew).length

  return NextResponse.json({
    tracks: resolvedTracks,
    vibe,
    totalFound: resolvedTracks.length,
    newDiscoveries: newCount,
  })
}
