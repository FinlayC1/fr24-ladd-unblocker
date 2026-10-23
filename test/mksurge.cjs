// The daily landings the event-surge evidence is worked out from (engine.surgeOf), from pass 1's flights
// (test/pipe_legs.cjs): every LADD aircraft's flight that took off and landed at an airport (on the ground or low), eight
// minutes or more, counted at its arrival airport on its arrival day - as the monitor counts its blocked aircraft's
// learning rows. Military aircraft left out (the monitor's surge leaves them out too).
// usage: node test/mksurge.cjs <p1Dir> <out.json>        -> { 'YYYY-MM-DD': { airportId: landings } }
const fs = require('fs'), path = require('path'), zlib = require('zlib');
const [p1Dir, out] = process.argv.slice(2);
const daily = {}; let n = 0, ac = 0;
for (const f of fs.readdirSync(path.join(p1Dir, 'legs')).filter(f => f.endsWith('.json.gz'))) {
  const p = JSON.parse(zlib.gunzipSync(fs.readFileSync(path.join(p1Dir, 'legs', f))).toString('utf8'));
  for (const [hex, a] of Object.entries(p.ac || {})) {
    if (!(a[2] & 8) || (a[2] & 1)) continue; ac++;
    for (const l of (p.legs || {})[hex] || []) {
      const [t0, t1, from, to, fc, tc] = l;
      if (!from || !to || from === to || !(fc === 1 || fc === 2) || !(tc === 1 || tc === 2) || t1 - t0 < 480) continue;
      const d = new Date(t1 * 1000).toISOString().slice(0, 10); (daily[d] = daily[d] || {})[to] = (daily[d][to] || 0) + 1; n++;
    }
  }
}
fs.writeFileSync(out, JSON.stringify(daily));
console.log('LADD aircraft', ac, 'landings', n, 'days', Object.keys(daily).length);
