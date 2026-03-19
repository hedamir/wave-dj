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
  return { token: data.access_token, scope: data.scope }
}

export async function POST(request) {
  const { tracks, setName, eventDescription, vibe, userId, refreshToken, token } = await request.json()

  if (!tracks?.length) return NextResponse.json({ error: 'No tracks to save' }, { status: 400 })

  // Get fresh token and check its scopes
  let activeToken = token
  let tokenScope = ''
  
  if (refreshToken) {
    try {
      const { token: fresh, scope } = await getFreshToken(refreshToken)
      if (fresh) {
        activeToken = fresh
        tokenScope = scope || ''
      }
    } catch { }
  }

  // Check if token has required scopes
  const hasModifyScope = tokenScope.includes('playlist-modify') || tokenScope === ''
  
  // Validate URIs
  const validUris = tracks
    .map(t => t?.uri)
    .filter(uri => uri && typeof uri === 'string' && uri.startsWith('spotify:track:'))

  if (!validUris.length) {
    return NextResponse.json({
      error: 'No valid track URIs — please rebuild the set and try again'
    }, { status: 400 })
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
        error: `Failed to create playlist: ${err?.error?.message || createRes.status}`
      }, { status: createRes.status })
    }
    playlist = await createRes.json()
  } catch (e) {
    return NextResponse.json({ error: `Create failed: ${e.message}` }, { status: 500 })
  }

  // Step 2: Add tracks using PUT instead of POST (replaces all tracks, avoids permission issues)
  let addedCount = 0
  let addError = ''

  // Try PUT first (set all tracks at once)
  try {
    const putRes = await fetch(`https://api.spotify.com/v1/playlists/${playlist.id}/tracks`, {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${activeToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ uris: validUris.slice(0, 100) }),
    })

    if (putRes.ok) {
      addedCount = Math.min(validUris.length, 100)
      
      // If more than 100 tracks, add the rest with POST
      if (validUris.length > 100) {
        for (let i = 100; i < validUris.length; i += 100) {
          const chunk = validUris.slice(i, i + 100)
          const postRes = await fetch(`https://api.spotify.com/v1/playlists/${playlist.id}/tracks`, {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${activeToken}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({ uris: chunk }),
          })
          if (postRes.ok) addedCount += chunk.length
        }
      }
    } else {
      const putErr = await putRes.json()
      addError = `PUT failed (${putRes.status}): ${putErr?.error?.message}`

      // Fall back to POST
      const postRes = await fetch(`https://api.spotify.com/v1/playlists/${playlist.id}/tracks`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${activeToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ uris: validUris.slice(0, 100) }),
      })

      if (postRes.ok) {
        addedCount = Math.min(validUris.length, 100)
      } else {
        const postErr = await postRes.json()
        addError += ` | POST also failed (${postRes.status}): ${postErr?.error?.message}`
        
        // Return detailed error with scope info
        return NextResponse.json({
          error: `Playlist created but tracks could not be added. This is a permissions issue. Please go to wave-dj.vercel.app, log out, then log in again. Error: ${addError}. Token scopes: ${tokenScope || 'unknown'}`,
          playlistId: playlist.id,
          playlistUrl: playlist.external_urls?.spotify,
        }, { status: 403 })
      }
    }
  } catch (e) {
    return NextResponse.json({ error: `Track add exception: ${e.message}` }, { status: 500 })
  }

  // Verify
  let finalCount = 0
  try {
    const check = await fetch(`https://api.spotify.com/v1/playlists/${playlist.id}`, {
      headers: { Authorization: `Bearer ${activeToken}` }
    })
    if (check.ok) {
      const d = await check.json()
      finalCount = d.tracks?.total || 0
    }
  } catch { }

  return NextResponse.json({
    success: true,
    playlistId: playlist.id,
    playlistUrl: playlist.external_urls?.spotify,
    tracksAdded: addedCount,
    tracksTotal: validUris.length,
    finalCount,
    verified: finalCount > 0,
  })
}
