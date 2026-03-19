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
  return res.json()
}

export async function POST(request) {
  const { tracks, setName, eventDescription, vibe, refreshToken, token } = await request.json()

  if (!tracks?.length) return NextResponse.json({ error: 'No tracks to save' }, { status: 400 })

  // Get fresh token
  let activeToken = token
  if (refreshToken) {
    try {
      const data = await getFreshToken(refreshToken)
      if (data.access_token) activeToken = data.access_token
    } catch { }
  }

  // Get current user ID from the token itself — don't trust what frontend sends
  let spotifyUserId
  try {
    const meRes = await fetch('https://api.spotify.com/v1/me', {
      headers: { Authorization: `Bearer ${activeToken}` }
    })
    const me = await meRes.json()
    spotifyUserId = me.id
    if (!spotifyUserId) return NextResponse.json({ error: 'Could not get user ID from Spotify' }, { status: 401 })
  } catch (e) {
    return NextResponse.json({ error: `Auth failed: ${e.message}` }, { status: 401 })
  }

  // Validate URIs
  const validUris = tracks
    .map(t => t?.uri)
    .filter(uri => uri && typeof uri === 'string' && uri.startsWith('spotify:track:'))

  if (!validUris.length) {
    return NextResponse.json({ error: 'No valid track URIs — please rebuild the set' }, { status: 400 })
  }

  // Create playlist using the user ID we just confirmed from the token
  let playlist
  try {
    const createRes = await fetch(`https://api.spotify.com/v1/users/${spotifyUserId}/playlists`, {
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
      return NextResponse.json({ error: `Create failed: ${err?.error?.message}` }, { status: createRes.status })
    }
    playlist = await createRes.json()
  } catch (e) {
    return NextResponse.json({ error: `Create exception: ${e.message}` }, { status: 500 })
  }

  // Add tracks in batches using the same token
  let addedCount = 0
  for (let i = 0; i < validUris.length; i += 100) {
    const chunk = validUris.slice(i, i + 100)
    try {
      const addRes = await fetch(`https://api.spotify.com/v1/playlists/${playlist.id}/tracks`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${activeToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ uris: chunk }),
      })
      if (addRes.ok) {
        addedCount += chunk.length
      } else {
        const addErr = await addRes.json()
        // If first chunk fails, return detailed error
        if (i === 0) {
          return NextResponse.json({
            error: `Tracks could not be added (${addRes.status}): ${addErr?.error?.message}. User ID used: ${spotifyUserId}. Playlist ID: ${playlist.id}`,
            playlistUrl: playlist.external_urls?.spotify,
          }, { status: addRes.status })
        }
      }
    } catch (e) {
      if (i === 0) return NextResponse.json({ error: `Add exception: ${e.message}` }, { status: 500 })
    }
  }

  return NextResponse.json({
    success: true,
    playlistId: playlist.id,
    playlistUrl: playlist.external_urls?.spotify,
    tracksAdded: addedCount,
    tracksTotal: validUris.length,
    verified: addedCount > 0,
  })
}
