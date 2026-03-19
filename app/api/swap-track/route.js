import { NextResponse } from 'next/server'

export async function POST(request) {
  const { trackIndex, currentSet, eventDescription, token } = await request.json()

  const prevTrack = currentSet[trackIndex - 1]
  const nextTrack = currentSet[trackIndex + 1]
  const currentTrack = currentSet[trackIndex]

  const context = `
Previous track: ${prevTrack ? `"${prevTrack.name}" by ${(prevTrack.artists||[]).map(a=>a.name).join(', ')} — BPM: ${prevTrack._bpm || 'unknown'}, Key: ${prevTrack._key || 'unknown'}` : 'None (this is the first track)'}
Current track to replace: "${currentTrack.name}" — BPM: ${currentTrack._bpm || 'unknown'}, Key: ${currentTrack._key || 'unknown'}
Next track: ${nextTrack ? `"${nextTrack.name}" by ${(nextTrack.artists||[]).map(a=>a.name).join(', ')} — BPM: ${nextTrack._bpm || 'unknown'}, Key: ${nextTrack._key || 'unknown'}` : 'None (this is the last track)'}
Event: ${eventDescription}
`

  let suggestions = []

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
        max_tokens: 600,
        messages: [{
          role: 'user',
          content: `You are an expert DJ. Suggest 5 replacement tracks for this position in a DJ set.

SET CONTEXT:
${context}

The replacement must:
1. Mix smoothly from the previous track (compatible BPM ±6, compatible Camelot key)
2. Lead smoothly into the next track (compatible BPM ±6, compatible Camelot key)
3. Fit the event vibe
4. Be a real song that exists on Spotify

FORMAT EXACTLY (5 tracks):
OPTION: "[Song Name]" by [Artist] | BPM: [number] | KEY: [camelot] | WHY: [max 8 words why it fits here]`
        }]
      })
    })

    if (claudeRes.ok) {
      const d = await claudeRes.json()
      const text = d.content?.[0]?.text || ''
      const lines = [...text.matchAll(/OPTION:\s*"(.+?)"\s+by\s+(.+?)\s*\|\s*BPM:\s*(\d+)\s*\|\s*KEY:\s*([^\|]+)\s*\|\s*WHY:\s*(.+)/gi)]
      suggestions = lines.map(m => ({
        name: m[1].trim(), artist: m[2].trim(),
        bpm: parseInt(m[3]), key: m[4].trim(), why: m[5].trim()
      }))
    }
  } catch { /* fall through to Spotify only */ }

  // Search Spotify for each suggestion
  const resolved = []
  for (const s of suggestions) {
    try {
      const q = encodeURIComponent(`track:${s.name} artist:${s.artist}`)
      const res = await fetch(`https://api.spotify.com/v1/search?q=${q}&type=track&limit=1`, {
        headers: { Authorization: `Bearer ${token}` }
      })
      const data = await res.json()
      const track = data.tracks?.items?.[0]
      if (track) {
        resolved.push({
          id: track.id, uri: track.uri, name: track.name, artists: track.artists,
          album: track.album, duration_ms: track.duration_ms,
          preview_url: track.preview_url, external_urls: track.external_urls,
          _bpm: s.bpm, _key: s.key, _role: s.why, _transition: null, _source: 'ai',
        })
      }
    } catch { /* skip */ }
  }

  return NextResponse.json({ alternatives: resolved })
}
