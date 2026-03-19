export async function GET() {
  const key = process.env.ANTHROPIC_API_KEY
  
  if (!key) {
    return Response.json({ error: 'ANTHROPIC_API_KEY is not set' })
  }

  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': key,
        'anthropic-version': '2023-06-01',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 50,
        messages: [{ role: 'user', content: 'Say hello in 5 words.' }]
      })
    })

    const data = await res.json()

    return Response.json({
      status: res.status,
      ok: res.ok,
      keyPrefix: key.substring(0, 20) + '...',
      keyLength: key.length,
      response: data,
    })
  } catch (e) {
    return Response.json({ error: e.message })
  }
}
