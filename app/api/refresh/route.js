export async function POST(request) {
  const { refresh_token } = await request.json()
  if (!refresh_token) return Response.json({ error: 'No refresh token' }, { status: 400 })
  const credentials = Buffer.from(
    `${process.env.SPOTIFY_CLIENT_ID}:${process.env.SPOTIFY_CLIENT_SECRET}`
  ).toString('base64')
  try {
    const res = await fetch('https://accounts.spotify.com/api/token', {
      method: 'POST',
      headers: {
        Authorization: `Basic ${credentials}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token,
      }).toString(),
    })
    const data = await res.json()
    return Response.json({
      access_token: data.access_token,
      expires_in: data.expires_in || 3600,
      issued_at: Date.now(),
    })
  } catch {
    return Response.json({ error: 'Refresh failed' }, { status: 500 })
  }
}
