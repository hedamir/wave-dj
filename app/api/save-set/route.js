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
  if (!userId) return NextResponse.json({ error: 'No user ID provided' }, { status: 400 })

  // Try refresh token first, fall back to provided token
  let activeToken = token
  if (refreshToken) {
    try {
      const fresh = await getFreshToken(refreshToken)
      if (fresh) activeToken = fresh
    } catch { /* use existing token */ }
  }

  if (!activeToken) {
    return NextResponse.json({ error: 'No valid token — please log out and log back in' }, { status: 401 })
  }

  // Step 1: Verify token works and has right scopes by checking user profile
  try {
    const meRes = await fetch('https://api.spotify.com/v1/me', {
      headers: { Authorization: `Bearer ${activeToken}` }
    })
    if (!meRes.ok) {
      return NextResponse.json({ error: 'Token invalid — please log out and log back in' }, { status: 401 })
    }
  } catch {
    return NextResponse.json({ error: 'Could not verify token' }, { status: 500 })
  }

  // Step 2: Create playlist
  let playlist
  try {
    const createRes = await fetch(`https://api.spotify.com/v1/users/${userId}/playlists`, {
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
      const errData = await createRes.json()
      const errMsg = errData?.error?.message || createRes.status
      // If forbidden, try creating as current user instead of userId
      if (createRes.status === 403) {
        // Try with /me/playlists instead
        const meCreateRes = await fetch('https://api.spotify.com/v1/me/playlists', {
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
        if (!meCreateRes.ok) {
          const meErr = await meCreateRes.json()
          return NextResponse.json({
            error: `Failed to create playlist: ${meErr?.error?.message || meCreateRes.status}. Please log out and log back in to refresh permissions.`
          }, { status: meCreateRes.status })
        }
        playlist = await meCreateRes.json()
      } else {
        return NextResponse.json({ error: `Failed to create playlist: ${errMsg}` }, { status: createRes.status })
      }
    } else {
      playlist = await createRes.json()
    }
  } catch (e) {
    return NextResponse.json({ error: `Network error: ${e.message}` }, { status: 500 })
  }

  // Step 3: Add tracks in chunks of 50 with retry
  const uris = tracks.filter(t => t?.uri).map(t => t.uri)
  let addedCount = 0

  for (let i = 0; i < uris.length; i += 50) {
    const chunk = uris.slice(i, i + 50)
    let attempts = 0
    while (attempts < 3) {
      try {
        const res = await fetch(`https://api.spotify.com/v1/playlists/${playlist.id}/tracks`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${activeToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ uris: chunk }),
        })
        if (res.ok) { addedCount += chunk.length; break }
        attempts++
        await new Promise(r => setTimeout(r, 1000))
      } catch {
        attempts++
        await new Promise(r => setTimeout(r, 1000))
      }
    }
  }

  // Step 4: Verify
  let verified = false
  try {
    const checkRes = await fetch(`https://api.spotify.com/v1/playlists/${playlist.id}`, {
      headers: { Authorization: `Bearer ${activeToken}` }
    })
    if (checkRes.ok) {
      const checkData = await checkRes.json()
      verified = (checkData.tracks?.total || 0) > 0
    }
  } catch { }

  return NextResponse.json({
    success: true,
    playlistId: playlist.id,
    playlistUrl: playlist.external_urls?.spotify,
    tracksAdded: addedCount,
    tracksTotal: uris.length,
    verified,
  })
}
