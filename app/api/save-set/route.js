import { NextResponse } from 'next/server'

export async function POST(request) {
  const { tracks, setName, eventDescription, vibe, token } = await request.json()

  if (!tracks?.length) return NextResponse.json({ error: 'No tracks to save' }, { status: 400 })
  if (!token) return NextResponse.json({ error: 'No token provided' }, { status: 401 })

  // Validate URIs
  const validUris = tracks
    .map(t => t?.uri)
    .filter(uri => uri && typeof uri === 'string' && uri.startsWith('spotify:track:'))

  if (!validUris.length) {
    return NextResponse.json({ error: 'No valid track URIs — please rebuild the set' }, { status: 400 })
  }

  // Step 1: Get user ID using the exact token from browser
  let spotifyUserId
  try {
    const meRes = await fetch('https://api.spotify.com/v1/me', {
      headers: { Authorization: `Bearer ${token}` }
    })
    if (!meRes.ok) {
      return NextResponse.json({ 
        error: 'Token invalid — please log out and log back in' 
      }, { status: 401 })
    }
    const me = await meRes.json()
    spotifyUserId = me.id
  } catch (e) {
    return NextResponse.json({ error: `Auth check failed: ${e.message}` }, { status: 500 })
  }

  // Step 2: Create playlist
  let playlist
  try {
    const createRes = await fetch(`https://api.spotify.com/v1/users/${spotifyUserId}/playlists`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
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
      // Try /me/playlists as fallback
      const fallbackRes = await fetch('https://api.spotify.com/v1/me/playlists', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          name: setName || `wave. DJ Set · ${new Date().toLocaleDateString()}`,
          public: false,
          description: vibe || eventDescription || 'Built with wave. DJ',
        }),
      })
      if (!fallbackRes.ok) {
        const fallbackErr = await fallbackRes.json()
        return NextResponse.json({
          error: `Could not create playlist (${fallbackRes.status}): ${fallbackErr?.error?.message}. Your Spotify account may not have permission. Try logging out and back in.`
        }, { status: fallbackRes.status })
      }
      playlist = await fallbackRes.json()
    } else {
      playlist = await createRes.json()
    }
  } catch (e) {
    return NextResponse.json({ error: `Create failed: ${e.message}` }, { status: 500 })
  }

  // Step 3: Add tracks
  let addedCount = 0
  let addError = ''

  for (let i = 0; i < validUris.length; i += 100) {
    const chunk = validUris.slice(i, i + 100)
    try {
      const addRes = await fetch(`https://api.spotify.com/v1/playlists/${playlist.id}/tracks`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ uris: chunk }),
      })
      if (addRes.ok) {
        addedCount += chunk.length
      } else {
        const addErr = await addRes.json()
        addError = `HTTP ${addRes.status}: ${addErr?.error?.message || JSON.stringify(addErr)}`
        // Log full error for debugging
        console.error('Track add failed:', addRes.status, JSON.stringify(addErr))
        console.error('Playlist ID:', playlist.id)
        console.error('Token prefix:', token.substring(0, 20))
        console.error('URIs sample:', chunk.slice(0, 3))
      }
    } catch (e) {
      addError = e.message
    }
  }

  if (addedCount === 0) {
    return NextResponse.json({
      error: `Track add failed — ${addError}`,
      playlistUrl: playlist.external_urls?.spotify,
    }, { status: 500 })
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
