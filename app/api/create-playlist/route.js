import { NextResponse } from 'next/server'

export async function POST(request) {
  const { setName, eventDescription, vibe, token } = await request.json()
  if (!token) return NextResponse.json({ error: 'No token' }, { status: 401 })

  try {
    const createRes = await fetch('https://api.spotify.com/v1/me/playlists', {
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
      return NextResponse.json({
        error: `Create failed (${createRes.status}): ${err?.error?.message}`
      }, { status: createRes.status })
    }

    const playlist = await createRes.json()
    return NextResponse.json({
      playlistId: playlist.id,
      playlistUrl: playlist.external_urls?.spotify,
    })
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}
