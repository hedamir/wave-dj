export async function GET(request) {
  const { searchParams } = new URL(request.url)
  const url = searchParams.get('url')

  if (!url || !url.startsWith('https://p.scdn.co/')) {
    return new Response('Invalid URL', { status: 400 })
  }

  try {
    const res = await fetch(url)
    if (!res.ok) return new Response('Preview unavailable', { status: 404 })

    const buffer = await res.arrayBuffer()
    return new Response(buffer, {
      headers: {
        'Content-Type': 'audio/mpeg',
        'Access-Control-Allow-Origin': '*',
        'Cache-Control': 'public, max-age=3600',
      },
    })
  } catch {
    return new Response('Failed to fetch preview', { status: 500 })
  }
}
