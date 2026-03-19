import { NextResponse } from 'next/server'

async function getFreshToken(refreshToken) {
  const credentials = Buffer.from(
    `${process.env.SPOTIFY_CLIENT_ID}:${process.env.SPOTIFY_CLIENT_SECRET}`
  ).toString('base64')
  const res = await fetch('https://accounts.spotify.com/api/token', {
    method: 'POST',
    headers: {
      Authorization: `Basic ${credentials}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
    }).toString(),
  })
  const data = await res.json()
  return data.access_token
}

export async function POST(request) {
  const { tracks, setName, eventDescription, vibe, userId, refreshToken, token } = await request.json()

  if (!tracks?.length) return NextResponse.json({ error: 'No tracks to save' }, { status: 400 })
  if (!userId) return NextResponse.json({ error: 'No user ID' }, { status: 400 })

  // Always get a fresh token
  let activeToken = token
  if (refreshToken) {
    try {
      const fresh = await getFreshToken(refreshToken)
      if (fresh) activeToken = fresh
    } catch { }
  }

  if (!activeToken) {
    return NextResponse.json({ error: 'No valid token — please log out and log back in' }, { status: 401 })
  }

  // Step 1: Create playlist
  let playlist
  try {
    const createRes = await fetch('https://api.spotify.com/v1/me/playlists', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${activeToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        name: setName || `wave. DJ Set · ${new Date().toLocaleDateString()}`,
        public: false,
        description: vibe || eventDescription || 'Built with wave. DJ',
      }),
    })

    if (!createRes.ok) {
      const err = await createRes.json()
      return NextResponse.json({
        error: `Failed to create playlist: ${err?.error?.message || createRes.status}. Please log out and log back in.`
      }, { status: createRes.status })
    }

    playlist = await createRes.json()
  } catch (e) {
    return NextResponse.json({ error: `Network error creating playlist: ${e.message}` }, { status: 500 })
  }

  // Step 2: Build valid URIs — filter out anything that's not a proper spotify track URI
  const validUris = tracks
    .map(t => t?.uri)
    .filter(uri => uri && typeof uri === 'string' && uri.startsWith('spotify:track:'))

  if (!validUris.length) {
    return NextResponse.json({
      error: 'No valid track URIs found — the tracks may not have loaded properly. Please rebuild the set and try again.',
      debug: { totalTracks: tracks.length, sampleTrack: tracks[0] }
    }, { status: 400 })
  }

  // Step 3: Add tracks in chunks of 100 (Spotify max per request)
  let addedCount = 0
  const errors = []

  for (let i = 0; i < validUris.length; i += 100) {
    const chunk = validUris.slice(i, i + 100)
    let success = false
    let attempts = 0

    while (!success && attempts < 3) {
      try {
        const res = await fetch(`https://api.spotify.com/v1/playlists/${playlist.id}/tracks`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${activeToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ uris: chunk }),
        })

        if (res.ok) {
          addedCount += chunk.length
          success = true
        } else {
          const errData = await res.json()
          errors.push(`Chunk ${i}: ${errData?.error?.message || res.status}`)
          attempts++
          await new Promise(r => setTimeout(r, 1500))
        }
      } catch (e) {
        errors.push(`Chunk ${i} exception: ${e.message}`)
        attempts++
        await new Promise(r => setTimeout(r, 1500))
      }
    }
  }

  // Step 4: Verify
  let finalCount = 0
  try {
    const checkRes = await fetch(`https://api.spotify.com/v1/playlists/${playlist.id}`, {
      headers: { Authorization: `Bearer ${activeToken}` }
    })
    if (checkRes.ok) {
      const checkData = await checkRes.json()
      finalCount = checkData.tracks?.total || 0
    }
  } catch { }

  if (addedCount === 0) {
    return NextResponse.json({
      error: `Playlist created but no tracks could be added. Errors: ${errors.join(', ')}`,
      playlistId: playlist.id,
      playlistUrl: playlist.external_urls?.spotify,
    }, { status: 500 })
  }

  return NextResponse.json({
    success: true,
    playlistId: playlist.id,
    playlistUrl: playlist.external_urls?.spotify,
    tracksAdded: addedCount,
    tracksTotal: validUris.length,
    finalCount,
    verified: finalCount >= addedCount,
  })
}
