// Test-only CORS relay emulating a userscript manager's GM_xmlhttpRequest for the in-browser harness.
// GET http://127.0.0.1:8765/p?u=<url>  -> fetches <url> server-side and returns it with permissive CORS headers.
// GET http://127.0.0.1:8765/script      -> the built userscript (so the harness always runs the latest build).
import http from 'http';
import fs from 'fs';
import path from 'path';
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..');
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36';
const ALLOW = /^https:\/\/([a-z0-9.-]+\.)?(adsb\.lol|adsb\.fi|airplanes\.live|adsb\.one|opensky-network\.org|adsbdb\.com|hexdb\.io|planespotters\.net|jetphotos\.com|faa\.gov|flightradar24\.com|githubusercontent\.com|caa\.co\.uk)\/|^http:\/\/127\.0\.0\.1:47524\//;
const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Private-Network': 'true', 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': 'GET, OPTIONS' };
let n = 0;
http.createServer(async (req, res) => {
  if (req.method === 'OPTIONS') { res.writeHead(204, cors); return res.end(); }
  const u = new URL(req.url, 'http://x');
  if (u.pathname === '/script') { res.writeHead(200, { ...cors, 'content-type': 'text/javascript' }); return res.end(fs.readFileSync(path.join(root, 'dist', 'fr24-ladd-unblocker.user.js'))); }
  if (u.pathname === '/bridge.html') {
    // Embedded by the FR24 page: relays GM requests (and serves the build) over postMessage, same-origin to the relay.
    res.writeHead(200, { ...cors, 'content-type': 'text/html' });
    return res.end(`<!doctype html><script>
      addEventListener('message', async ev => {
        const d = ev.data || {}; if (!d.__tlReq) return;
        try {
          const r = await fetch(d.script ? '/script?' + Date.now() : '/p?u=' + encodeURIComponent(d.url));
          const text = await r.text();
          ev.source.postMessage({ __tlRes: d.__tlReq, status: r.status, text }, '*');
        } catch (e) { ev.source.postMessage({ __tlRes: d.__tlReq, status: 0, error: String(e) }, '*'); }
      });
      parent.postMessage({ __tlBridge: 'hello' }, '*');
    </script>`);
  }
  if (u.pathname === '/harness') { res.writeHead(200, { ...cors, 'content-type': 'text/javascript' }); return res.end(fs.readFileSync(path.join(root, 'test', 'harness.js'))); }
  const target = u.searchParams.get('u') || '';
  if (!ALLOW.test(target)) { res.writeHead(403, cors); return res.end('blocked'); }
  try {
    const headers = { 'User-Agent': UA, Accept: req.headers.accept || '*/*' };
    if (/planespotters/.test(target)) { headers.Origin = 'https://www.flightradar24.com'; headers.Referer = 'https://www.flightradar24.com/'; headers['Sec-Fetch-Mode'] = 'cors'; }
    const r = await fetch(target, { headers, redirect: 'follow' });
    const body = Buffer.from(await r.arrayBuffer());
    res.writeHead(r.status, { ...cors, 'content-type': r.headers.get('content-type') || 'application/octet-stream' });
    res.end(body);
    if (++n % 25 === 0) console.log('relayed', n);
  } catch (e) { res.writeHead(502, cors); res.end(String(e)); }
}).listen(8765, '127.0.0.1', () => console.log('relay on http://127.0.0.1:8765'));
