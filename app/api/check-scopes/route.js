export async function GET(request) {
  const { searchParams } = new URL(request.url)
  const token = searchParams.get('token')
  if (!token) return Response.json({ error: 'Add ?token=YOUR_TOKEN to the URL' })

  try {
    // Check current user and their available scopes
    const res = await fetch('https://api.spotify.com/v1/me', {
      headers: { Authorization: `Bearer ${token}` }
    })
    const me = await res.json()

    // Try to create a test playlist to check if we have write access
    const testRes = await fetch('https://api.spotify.com/v1/me/playlists', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        name: 'wave. test - delete me',
        public: false,
        description: 'test'
      })
    })
    const testData = await testRes.json()

    let addTest = null
    if (testRes.ok && testData.id) {
      // Try adding a known track
      const addRes = await fetch(`https://api.spotify.com/v1/playlists/${testData.id}/tracks`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ uris: ['spotify:track:4uLU6hMCjMI75M1A2tKUQC'] })
      })
      const addData = await addRes.json()
      addTest = { status: addRes.status, ok: addRes.ok, response: addData }

      // Clean up test playlist
      await fetch(`https://api.spotify.com/v1/playlists/${testData.id}/followers`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` }
      })
    }

    return Response.json({
      user: me.display_name,
      playlist_create: { status: testRes.status, ok: testRes.ok },
      track_add: addTest,
      message: addTest?.ok ? 'ALL GOOD - saving should work' : 'TRACK ADD IS FAILING - permission issue confirmed'
    })
  } catch (e) {
    return Response.json({ error: e.message })
  }
}
