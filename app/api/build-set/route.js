import { NextResponse } from 'next/server'

export async function POST(request) {
  const {
    eventDescription, bpmStart, bpmPeak, bpmEnd, setLength,
    anchorTracks, topTracks, likedTracks, token
  } = await request.json()

  // Build taste profile from user library
  const allLibrary = [...(topTracks || []), ...(likedTracks || [])]
  const seen = new Set()
  const libraryProfile = allLibrary
    .filter(t => { if (!t?.id || seen.has(t.id)) return false; seen.add(t.id); return true })
    .slice(0, 40)
    .map(t => `"${t.name}" by ${(t.artists || []).map(a => a.name).join(', ')}`)
    .join('\n')

  const anchorInfo = (anchorTracks || []).length > 0
    ? `\nANCHOR TRACKS (must appear in the set):\n${(anchorTracks || []).map((t, i) =>
        `${i + 1}. "${t.name}" by ${(t.artists || []).map(a => a.name).join(', ')} — BPM: ${t.bpm || 'unknown'}, Key: ${t.key || 'unknown'}`
      ).join('\n')}`
    : '\nNo anchor tracks — build the full set from scratch based on the DJ taste profile.'

  const bpmArc = `Start: ${bpmStart} BPM → Peak: ${bpmPeak} BPM → End: ${bpmEnd} BPM`
  const trackCount = setLength === '1h' ? 15 : setLength === '2h' ? 25 : 20

  let claudeResult = null

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
        max_tokens: 2000,
        messages: [{
          role: 'user',
          content: `You are an expert DJ with 15+ years experience building sets for professional events. Your job is to build a complete, carefully ordered DJ set.

EVENT DESCRIPTION:
${eventDescription}

BPM ARC: ${bpmArc}
SET LENGTH: ${setLength} (${trackCount} tracks)

DJ TASTE PROFILE (their Spotify library):
${libraryProfile}
${anchorInfo}

BUILD A ${trackCount}-TRACK SET that:
1. Follows the BPM arc naturally — gradually moving from ${bpmStart} to ${bpmPeak} then settling to ${bpmEnd}
2. Has smooth harmonic transitions — consecutive tracks should be in compatible Camelot wheel keys
3. Tells an emotional story appropriate for the event description
4. Places anchor tracks at appropriate positions in the arc if provided
5. Mixes tracks the DJ knows with new discoveries that fit their taste
6. Each transition should make musical sense — explain briefly why it works

For EACH track provide:
- Track name and artist (must be a real song on Spotify)
- Expected BPM (specific number)
- Expected Camelot key (e.g. 8A, 9B)
- Your role note for this track in the set (max 6 words — e.g. "opening groove, sets the tone")
- Transition note to next track (max 8 words — e.g. "same key, +2 BPM push")

FORMAT EXACTLY LIKE THIS (one track per line):
TRACK: "[Song Name]" by [Artist] | BPM: [number] | KEY: [camelot] | ROLE: [role note] | TRANSITION: [transition note]

After all tracks, add:
VIBE: [one sentence describing the emotional journey of this set, max 15 words]

Be creative, specific, and think like a real DJ preparing for this exact event.`
        }]
      })
    })

    if (claudeRes.ok) {
      const d = await claudeRes.json()
      const text = d.content?.[0]?.text || ''

      const trackLines = [...text.matchAll(/TRACK:\s*"(.+?)"\s+by\s+(.+?)\s*\|\s*BPM:\s*(\d+)\s*\|\s*KEY:\s*([^\|]+)\s*\|\s*ROLE:\s*([^\|]+)\s*\|\s*TRANSITION:\s*(.+)/gi)]
      const vibeMatch = text.match(/VIBE:\s*(.+)/i)

      claudeResult = {
        tracks: trackLines.map(m => ({
          name: m[1].trim(),
          artist: m[2].trim(),
          bpm: parseInt(m[3]),
          key: m[4].trim(),
          role: m[5].trim(),
          transition: m[6].trim(),
        })),
        vibe: vibeMatch ? vibeMatch[1].trim() : '',
      }
    }
  } catch (e) {
    return NextResponse.json({ error: 'AI failed', details: e.message }, { status: 500 })
  }

  if (!claudeResult?.tracks?.length) {
    return NextResponse.json({ error: 'No tracks generated' }, { status: 500 })
  }

  // Search Spotify for each track Claude suggested
  const resolvedTracks = []
  for (const ct of claudeResult.tracks) {
    try {
      // First try exact search
      const q = encodeURIComponent(`track:${ct.name} artist:${ct.artist}`)
      const res = await fetch(`https://api.spotify.com/v1/search?q=${q}&type=track&limit=3`, {
        headers: { Authorization: `Bearer ${token}` }
      })
      const data = await res.json()
      let track = data.tracks?.items?.[0]

      // If not found, try loose search
      if (!track) {
        const q2 = encodeURIComponent(`${ct.name} ${ct.artist}`)
        const res2 = await fetch(`https://api.spotify.com/v1/search?q=${q2}&type=track&limit=3`, {
          headers: { Authorization: `Bearer ${token}` }
        })
        const data2 = await res2.json()
        track = data2.tracks?.items?.[0]
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
          // Claude's metadata
          _bpm: ct.bpm,
          _key: ct.key,
          _role: ct.role,
          _transition: ct.transition,
          _source: 'ai',
        })
      }
    } catch { /* skip failed searches */ }
  }

  // If Claude didn't find enough tracks, fill with Spotify recommendations
  if (resolvedTracks.length < trackCount - 5 && libraryProfile.length > 0) {
    try {
      const seedIds = (topTracks || []).slice(0, 5).map(t => t.id).filter(Boolean)
      if (seedIds.length > 0) {
        const params = new URLSearchParams({
          limit: String(trackCount - resolvedTracks.length),
          seed_tracks: seedIds.slice(0, 5).join(','),
          target_tempo: String(Math.round((bpmStart + bpmPeak) / 2)),
          min_tempo: String(Math.max(60, bpmStart - 10)),
          max_tempo: String(Math.min(200, bpmPeak + 10)),
          target_energy: '0.8',
          target_danceability: '0.75',
        })
        const recRes = await fetch(`https://api.spotify.com/v1/recommendations?${params}`, {
          headers: { Authorization: `Bearer ${token}` }
        })
        const recData = await recRes.json()
        const existingIds = new Set(resolvedTracks.map(t => t.id))
        const fillers = (recData.tracks || [])
          .filter(t => !existingIds.has(t.id))
          .map(t => ({
            id: t.id, uri: t.uri, name: t.name, artists: t.artists,
            album: t.album, duration_ms: t.duration_ms,
            preview_url: t.preview_url, external_urls: t.external_urls,
            _bpm: null, _key: null, _role: 'filler track', _transition: null, _source: 'spotify',
          }))
        resolvedTracks.push(...fillers)
      }
    } catch { /* ignore filler errors */ }
  }

  return NextResponse.json({
    tracks: resolvedTracks,
    vibe: claudeResult.vibe,
    totalFound: resolvedTracks.length,
  })
}
