export async function GET() {
  const params = new URLSearchParams({
    client_id: process.env.SPOTIFY_CLIENT_ID,
    response_type: 'code',
    redirect_uri: `${process.env.NEXTAUTH_URL}/api/auth/callback`,
    scope: [
      'user-read-private','user-read-email',
      'user-library-read','playlist-read-private',
      'playlist-read-collaborative','user-top-read',
      'user-read-recently-played','playlist-modify-public',
      'playlist-modify-private',
    ].join(' '),
    show_dialog: 'true',
  })
  return Response.redirect(`https://accounts.spotify.com/authorize?${params}`)
}
