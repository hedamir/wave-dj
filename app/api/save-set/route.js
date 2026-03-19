import { NextResponse } from 'next/server'

async function freshToken(refreshToken) {
  const credentials = Buffer.from(
    `${process.env.SPOTIFY_CLIENT_ID}:${process.env.SPOTIFY_CLIENT_SECRET}`
  ).toString('base64')
  const res = await fetch('https://accounts.spotify.com/api/token', {
    method: 'POST',
    headers: {
      Authorization: `Basic ${credentials}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: refreshToken }).toString(),
  })
  const data = await res.json()
  return data.access_token
}

export async function POST(request) {
  const { tracks, setName, eventDescription, vibe, userId, refreshToken } = await request.json()

  if (!tracks?.length) return NextResponse.json({ error: 'No tracks to save' }, { status: 400 })
  if (!userId) return NextResponse.json({ error: 'No user ID' }, { status: 400 })
  if (!refreshToken) return NextResponse.json({ error: 'No refresh token' }, { status: 400 })

  // Always get a fresh token before saving — this prevents the expired token bug
  let token
  try {
    token = await freshToken(refreshToken)
    if (!token) return NextResponse.json({ error: 'Could not refresh token — please log in again' }, { status: 401 })
  } catch {
    return NextResponse.json({ error: 'Token refresh failed — please log in again' }, { status: 401 })
  }

  // Step 1: Create the playlist
  let playlist
  try {
    const res = await fetch(`https://api.spotify.com/v1/users/${userId}/playlists`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: setName || `wave. DJ Set · ${new Date().toLocaleDateString()}`,
        public: false,
        description: vibe || eventDescription || 'Built with wave. DJ',
      }),
    })
    if (!res.ok) {
      const err = await res.json()
      return NextResponse.json({ error: `Failed to create playlist: ${err.error?.message || res.status}` }, { status: res.status })
    }
    playlist = await res.json()
  } catch (e) {
    return NextResponse.json({ error: 'Failed to create playlist' }, { status: 500 })
  }

  // Step 2: Add tracks in chunks of 50
  const uris = tracks.filter(t => t?.uri).map(t => t.uri)
  const chunks = []
  for (let i = 0; i < uris.length; i += 50) chunks.push(uris.slice(i, i + 50))

  let addedCount = 0
  for (const chunk of chunks) {
    let attempts = 0
    while (attempts < 3) {
      try {
        const res = await fetch(`https://api.spotify.com/v1/playlists/${playlist.id}/tracks`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ uris: chunk }),
        })
        if (res.ok) { addedCount += chunk.length; break }
        attempts++
        if (attempts < 3) await new Promise(r => setTimeout(r, 1000))
      } catch {
        attempts++
        if (attempts < 3) await new Promise(r => setTimeout(r, 1000))
      }
    }
  }

  // Step 3: Verify playlist was created correctly
  let verified = false
  try {
    const check = await fetch(`https://api.spotify.com/v1/playlists/${playlist.id}`, {
      headers: { Authorization: `Bearer ${token}` }
    })
    if (check.ok) {
      const checkData = await check.json()
      verified = checkData.tracks?.total >= Math.min(uris.length, addedCount)
    }
  } catch { /* verification non-critical */ }

  return NextResponse.json({
    success: true,
    playlistId: playlist.id,
    playlistUrl: playlist.external_urls?.spotify,
    tracksAdded: addedCount,
    tracksTotal: uris.length,
    verified,
  })
}
