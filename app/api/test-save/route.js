import { NextResponse } from 'next/server'

export async function POST(request) {
  const { token } = await request.json()
  
  if (!token) return NextResponse.json({ error: 'No token' })

  const results = {}

  // Test 1: Get user info
  try {
    const meRes = await fetch('https://api.spotify.com/v1/me', {
      headers: { Authorization: `Bearer ${token}` }
    })
    const me = await meRes.json()
    results.user = { id: me.id, email: me.email, status: meRes.status }
  } catch(e) { results.user = { error: e.message } }

  // Test 2: Create a test playlist
  let playlistId = null
  try {
    const createRes = await fetch('https://api.spotify.com/v1/me/playlists', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'wave. test DELETE ME', public: false })
    })
    const createData = await createRes.json()
    results.create = { status: createRes.status, ok: createRes.ok, id: createData.id, error: createData.error }
    playlistId = createData.id
  } catch(e) { results.create = { error: e.message } }

  // Test 3: Add a known track
  if (playlistId) {
    try {
      const addRes = await fetch(`https://api.spotify.com/v1/playlists/${playlistId}/tracks`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ uris: ['spotify:track:4uLU6hMCjMI75M1A2tKUQC'] })
      })
      const addData = await addRes.json()
      results.add_tracks = { status: addRes.status, ok: addRes.ok, error: addData.error, snapshot: addData.snapshot_id }
    } catch(e) { results.add_tracks = { error: e.message } }

    // Clean up
    try {
      await fetch(`https://api.spotify.com/v1/playlists/${playlistId}/followers`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` }
      })
    } catch {}
  }

  return NextResponse.json(results)
}
