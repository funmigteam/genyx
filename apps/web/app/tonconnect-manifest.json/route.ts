export function GET() {
  // The app is served behind Caddy. `request.url` can therefore contain the
  // private Docker host (http://web:3000), which wallet clients rightfully
  // reject. A TON Connect manifest must advertise the public HTTPS origin.
  const origin = 'https://smartgenyx.com';
  return Response.json({ url: origin, name: 'GENYX', iconUrl: `${origin}/genyx-icon.svg` }, { headers: { 'Cache-Control': 'no-store' } });
}
