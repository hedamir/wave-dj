import { NextResponse } from 'next/server'

export async function POST(request) {
  const {
    eventDescription, bpmStart, bpmPeak, bpmEnd, setLength,
    anchorTracks, topTracks, likedTracks, token
  } = await request.json()

  const allLibrary = [...(topTracks || []), ...(likedTracks || [])]
  const seen = new Set()
  const libraryProfile = allLibrary
    .filter(t => { if (!t?.id || seen.has(t.id)) return false; seen.add(t.id); return true })
    .slice(0, 40)
    .map(t => `"${t.name}" by ${(t.artists || []).map(a => a.name).join(', ')}`)
    .join('\n')

  const anchorInfo = (anchorTracks || []).length > 0
    ? `\nANCHOR TRACKS (must include these in the set):\n${(anchorTracks || []).map((t, i) =>
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
          content: `You are an expert DJ with 15+ years experience. Build a complete ordered DJ set.

EVENT: ${eventDescription}
BPM ARC: ${bpmStart} BPM start → ${bpmPeak} BPM peak → ${bpmEnd} BPM end
SET LENGTH: ${trackCount} tracks
${anchorInfo}

DJ TASTE PROFILE:
${libraryProfile}

Build exactly ${trackCount} tracks. Each line must follow this EXACT format with no variations:
TRACK: "Song Name" by Artist Name | BPM: 128 | KEY: 8A | ROLE: opening groove sets tone | TRANSITION: same key smooth push

Rules:
- Song names and artists must be real songs that exist on Spotify
- BPM must be a realistic number for the genre
- KEY must be Camelot format like 8A or 9B
- ROLE is max 6 words describing the track's purpose
- TRANSITION is max 8 words describing how it leads to next track
- Last track has TRANSITION: closing track
- Include anchor tracks at appropriate positions

After all tracks add one line:
VIBE: one sentence describing the emotional journey max 15 words

Output ONLY the tracks and vibe line, nothing else.`
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

  if (!claudeText) {
    return NextResponse.json({ error: 'No response from AI — please try again' }, { status: 500 })
  }

  // Flexible parsing — handle various quote styles and formatting
  const trackLines = claudeText.split('\n').filter(l => l.trim().startsWith('TRACK:'))
  
  const parsedTracks = trackLines.map(line => {
    // Extract song name — handle straight quotes, curly quotes, no quotes
    const nameMatch = line.match(/TRACK:\s*["""]?(.+?)["""]?\s+by\s+/i)
    const artistMatch = line.match(/by\s+(.+?)\s*\|/i)
    const bpmMatch = line.match(/BPM:\s*(\d+)/i)
    const keyMatch = line.match(/KEY:\s*([^\|]+)/i)
    const roleMatch = line.match(/ROLE:\s*([^\|]+)/i)
    const transMatch = line.match(/TRANSITION:\s*(.+)/i)

    if (!nameMatch || !artistMatch) return null

    return {
      name: nameMatch[1].replace(/["""]/g, '').trim(),
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
    // Log the raw response for debugging
    console.error('Failed to parse Claude response:', claudeText.substring(0, 500))
    return NextResponse.json({ 
      error: 'Could not parse AI response — please try again',
      debug: claudeText.substring(0, 200)
    }, { status: 500 })
  }

  // Search Spotify for each track
  const resolvedTracks = []
  for (const ct of parsedTracks) {
    try {
      // Try exact search first
      let track = null
      const searches = [
        `track:"${ct.name}" artist:"${ct.artist}"`,
        `${ct.name} ${ct.artist}`,
        ct.name,
      ]
      for (const q of searches) {
        if (track) break
        try {
          const res = await fetch(
            `https://api.spotify.com/v1/search?q=${encodeURIComponent(q)}&type=track&limit=3`,
            { headers: { Authorization: `Bearer ${token}` } }
          )
          const data = await res.json()
          // Pick best match — prefer exact name match
          const items = data.tracks?.items || []
          track = items.find(t =>
            t.name.toLowerCase().includes(ct.name.toLowerCase()) ||
            ct.name.toLowerCase().includes(t.name.toLowerCase())
          ) || items[0]
        } catch { }
      }

      if (track) {
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
        })
      }
    } catch { }
  }

  // If anchor tracks weren't found by Claude's suggestions, add them directly
  const resolvedIds = new Set(resolvedTracks.map(t => t.id))
  for (const anchor of (anchorTracks || [])) {
    if (!resolvedIds.has(anchor.id) && resolvedTracks.length < trackCount) {
      resolvedTracks.push({
        ...anchor,
        _bpm: null,
        _key: null,
        _role: 'anchor track',
        _transition: null,
        _source: 'anchor',
      })
      resolvedIds.add(anchor.id)
    }
  }

  // Fill remaining slots with Spotify recommendations if needed
  if (resolvedTracks.length < Math.round(trackCount * 0.6)) {
    try {
      const seedIds = [...(topTracks || []).slice(0, 3), ...(anchorTracks || []).slice(0, 2)]
        .map(t => t.id).filter(Boolean).slice(0, 5)
      
      if (seedIds.length > 0) {
        const params = new URLSearchParams({
          limit: String(trackCount - resolvedTracks.length),
          seed_tracks: seedIds.join(','),
          target_tempo: String(Math.round((bpmStart + bpmPeak) / 2)),
          min_tempo: String(Math.max(60, bpmStart - 8)),
          max_tempo: String(Math.min(200, bpmPeak + 8)),
          target_energy: '0.8',
          target_danceability: '0.75',
        })
        const recRes = await fetch(
          `https://api.spotify.com/v1/recommendations?${params}`,
          { headers: { Authorization: `Bearer ${token}` } }
        )
        const recData = await recRes.json()
        const fillers = (recData.tracks || [])
          .filter(t => !resolvedIds.has(t.id))
          .map(t => ({
            id: t.id, uri: t.uri, name: t.name, artists: t.artists,
            album: t.album, duration_ms: t.duration_ms,
            preview_url: t.preview_url, external_urls: t.external_urls,
            _bpm: null, _key: null, _role: 'similar track', _transition: null, _source: 'spotify',
          }))
        resolvedTracks.push(...fillers)
      }
    } catch { }
  }

  if (!resolvedTracks.length) {
    return NextResponse.json({ error: 'Could not find tracks on Spotify — please try again' }, { status: 500 })
  }

  return NextResponse.json({
    tracks: resolvedTracks,
    vibe,
    totalFound: resolvedTracks.length,
  })
}
