import { NextResponse } from 'next/server'

export async function GET(request) {
  const { searchParams } = new URL(request.url)
  const code = searchParams.get('code')
  const error = searchParams.get('error')
  const base = process.env.NEXTAUTH_URL

  if (error || !code) return NextResponse.redirect(`${base}/?error=access_denied`)

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
        grant_type: 'authorization_code',
        code,
        redirect_uri: `${base}/api/auth/callback`,
      }).toString(),
    })
    const data = await res.json()
    if (!data.access_token) return NextResponse.redirect(`${base}/?error=token_failed`)
    const params = new URLSearchParams({
      access_token: data.access_token,
      refresh_token: data.refresh_token || '',
      expires_in: String(data.expires_in || 3600),
      issued_at: String(Date.now()),
    })
    return NextResponse.redirect(`${base}/#${params}`)
  } catch {
    return NextResponse.redirect(`${base}/?error=server_error`)
  }
}
