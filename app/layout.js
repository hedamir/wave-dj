export const metadata = {
  title: 'wave. DJ — build your perfect set',
  description: 'AI-powered DJ set builder. Describe your event, build your set, save to Spotify.',
}
export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body style={{ margin: 0, padding: 0 }}>{children}</body>
    </html>
  )
}
