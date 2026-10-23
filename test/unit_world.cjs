// (1.0.1) The world log (monitor/world.cjs): every aircraft's flights of every day of adsb.lol's archive, kept for good.
//   - a flight in a row and back: every field the logs and the engine read, as built (the real flights of the fixtures)
//   - a day's file: 1,000 aircraft added in the archive's order, sorted into blocks; each one's flights found again, an
//     aircraft that did not fly ([]), one not in the day (null), a day not kept (undefined); found again after a restart; a
//     day half written not taken
//   - the monitor: a day of the archive read for its blocked aircraft builds the world log in the same read; an ordinary
//     aircraft's day served from it (/hist, since), the same flights as the day's log is built; one not in the day's index:
//     no flights; one in the index whose day the world log has not: not said (the browser reads it); a day read before the
//     world log read again for it alone (its index too), nothing else built again; the disk short of room: not built
// usage: node test/unit_world.cjs <dataDir>
const fs = require('fs'), path = require('path'), zlib = require('zlib'), os = require('os');
process.env.MON_DATA = process.argv[2] || path.join(__dirname, '../monitor/data');
process.env.MON_STORE = fs.mkdtempSync(path.join(os.tmpdir(), 'monworld-'));
const W = require('../monitor/world.cjs');
const M = require('../monitor/monitor.cjs');
const A = require('../monitor/archive.cjs');
M.loadEngine();
const E = M.E;
let fails = 0;
const check = (name, ok, info) => { if (!ok) fails++; console.log((ok ? 'PASS  ' : 'FAIL  ') + name + (info !== undefined ? '  ' + JSON.stringify(info).slice(0, 500) : '')); };
const dayOf = t => new Date(t * 1000).toISOString().slice(0, 10), dayS = d => Date.parse(d + 'T00:00:00Z') / 1000;
const nowS = () => Date.now() / 1000;
global.fetch = async () => ({ status: 404, text: async () => '' });

// ---- real flights: every fixture day of adsb.lol's, as a day's log is built --------------------------------------------
const FX = path.join(__dirname, 'fixtures', 'legs'), pool = [];
for (const hex of fs.readdirSync(FX)) for (const f of fs.readdirSync(path.join(FX, hex))) {
  const m = /^(\d{4}-\d\d-\d\d)_lol\.json\.gz$/.exec(f); if (!m) continue;
  let j; try { j = JSON.parse(zlib.gunzipSync(fs.readFileSync(path.join(FX, hex, f))).toString('utf8')); } catch (e) { continue; }   // (one is a site's error page)
  if (!j || !Array.isArray(j.trace)) continue;
  const info = { hex, type: String(j.t || '').toUpperCase() }, cls = E.classify(info), pts = E.parseTrace(j);
  const legs = E.legsFromPoints(pts, { heli: cls === 'heli', patrol: cls === 'fighter' || cls === 'milheavy', cls, type: info.type, rangeKm: E.typeRangeKm(info), dataEnd: dayS(m[1]) + 86400 });
  pool.push(legs.map(l => E.summarizeLeg(l, { visits: new Map(), base: 0, grp: E.groupOf(cls), cls, type: info.type })));
}
const flat = [].concat(...pool);
const near = (a, b, tol) => (a == null && b == null) || (typeof a === 'number' && typeof b === 'number' && Math.abs(a - b) <= tol);
const sameAp = (a, b) => (!a && !b) || (!!a && !!b && a.id === b.id && a.code === b.code && a.conf === b.conf);
{
  let bad = []; const keys = new Set();
  for (const s of flat) {
    const o = W.decodeLeg(JSON.parse(JSON.stringify(W.encodeLeg(s))), '2026/10/21');
    Object.keys(s).forEach(k => keys.add(k));
    const ok = near(o.tStart, s.tStart, 0.006) && near(o.tEnd, s.tEnd, 0.011) && near(o.tOff, s.tOff, 0.011) && near(o.tOn, s.tOn, 0.02) && o.tOffEst === s.tOffEst && o.tOnEst === s.tOnEst &&
      sameAp(o.from, s.from) && sameAp(o.to, s.to) && o.cs === (s.cs || '') && o.how === s.how && o.ended === s.ended && o.startedOnGround === s.startedOnGround &&
      near(o.startLat, s.startLat, 6e-5) && near(o.endLon, s.endLon, 6e-5) && near(o.endAlt, s.endAlt, 0.5) && near(o.endGs, s.endGs, 0.5) && near(o.startGs, s.startGs, 0.5) && near(o.endTrk, s.endTrk, 0.5) &&
      o.maxAlt === Math.round(s.maxAlt || 0) && o.pathKm === Math.round(s.pathKm || 0) && o.laps === (s.laps || 0) && JSON.stringify(o.path) === JSON.stringify(s.path || null) && o.endRules === 2 && o.day === '2026/10/21';
    if (!ok) bad.push({ s, o });
  }
  const lost = [...keys].filter(k => !(k in W.decodeLeg(W.encodeLeg(flat.find(s => k in s)))));
  check(`a flight in a row and back: every field as built (${flat.length} real flights of ${pool.length} days)`, flat.length >= 80 && !bad.length && !lost.length, { bad: bad.length, first: bad[0], lost }); }

// ---- a day's file ---------------------------------------------------------------------------------------------------
{ const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wl-')), w = W.createWorld(dir), D = '2026-10-21';
  let seed = 3; const rnd = () => (seed = seed * 16807 % 2147483647) / 2147483647;
  const want = new Map();
  while (want.size < 1000) { const hex = Math.floor(rnd() * 0xffffff).toString(16).padStart(6, '0'); if (!want.has(hex)) want.set(hex, rnd() < 0.2 ? [] : pool[Math.floor(rnd() * pool.length)]); }
  const wr = w.writer(D);
  for (const [hex, legs] of [...want].sort((a, b) => a[0].slice(-2).localeCompare(b[0].slice(-2)))) wr.add(hex, legs);   // (the archive's order: by the last two digits)
  const h = wr.finish();
  check('a day\'s file: 1,000 aircraft in blocks of 32, sorted by address', h.n === 1000 && h.nb === Math.ceil(1000 / W.PER_BLOCK) && w.has(D, W.WORLD_V) && !fs.existsSync(w.fileOf(D) + '.rows') && !fs.existsSync(w.fileOf(D) + '.tmp'), h);
  let wrong = 0; const t0 = Date.now();
  for (const [hex, legs] of want) { const got = w.lookup(D, hex), exp = legs.map(s => W.decodeLeg(JSON.parse(JSON.stringify(W.encodeLeg(s))), '2026/10/21')); if (JSON.stringify(got) !== JSON.stringify(exp)) wrong++; }
  const ms = Date.now() - t0;
  check(`... every aircraft's flights found again, the same (${ms} ms for 1,000)`, wrong === 0, { wrong });
  const none = [...want].find(x => !x[1].length);
  check('... an aircraft heard that day that did not fly: [] - one not in the day: null - a day not kept: undefined', JSON.stringify(w.lookup(D, none[0])) === '[]' && w.lookup(D, '000001') === null && w.lookup(D, 'fffffe') === null && w.lookup('2026-10-20', none[0]) === undefined);
  const first = [...want.keys()].sort()[0], last = [...want.keys()].sort().pop();
  check('... the first and the last address of the day', Array.isArray(w.lookup(D, first)) && Array.isArray(w.lookup(D, last)));
  // (a day half written - the monitor stopped mid-day: its rows file left, no day file - is not taken; it is built again)
  const w2 = w.writer('2026-10-20'); w2.add('abcdef', flat.slice(0, 2));
  fs.writeFileSync(path.join(dir, '2026-10-19.wl'), Buffer.from([1, 2, 3]));
  const again = W.createWorld(dir);
  check('... after a restart: the day found again; a half-written day and a broken file not taken', again.has(D, W.WORLD_V) && !again.has('2026-10-20') && !again.has('2026-10-19') && JSON.stringify(again.lookup(D, first)) === JSON.stringify(w.lookup(D, first)), [...again.days.keys()]);
  w2.abort();
  check('... a day given up: its rows file removed', !fs.existsSync(w.fileOf('2026-10-20') + '.rows'));
  check('free space where the store is: a number', W.freeBytes(dir) > 0); }

// ---- the monitor ------------------------------------------------------------------------------------------------------
function tarHeader(name, size, type) {
  const h = Buffer.alloc(512, 0);
  h.write(name, 0, 100, 'latin1'); h.write('0000644\0', 100); h.write('0001750\0', 108); h.write('0001750\0', 116);
  h.write(size.toString(8).padStart(11, '0') + '\0', 124); h.write(Math.floor(Date.now() / 1000).toString(8).padStart(11, '0') + '\0', 136);
  h.write('        ', 148); h.write(type || '0', 156); h.write('ustar\0', 257, 'latin1'); h.write('00', 263);
  let sum = 0; for (const b of h) sum += b; h.write(sum.toString(8).padStart(6, '0') + '\0 ', 148);
  return h;
}
const tarEntry = (name, buf) => Buffer.concat([tarHeader(name, buf.length, '0'), buf, Buffer.alloc((512 - buf.length % 512) % 512)]);
const gz = o => zlib.gzipSync(Buffer.from(JSON.stringify(o)));
const tr = hex => `./traces/${hex.slice(-2)}/trace_full_${hex}.json`;
const D = dayOf(nowS() - 3 * 86400), HD = D.replace(/-/g, '/');
const REAL = Object.assign(JSON.parse(zlib.gunzipSync(fs.readFileSync(path.join(__dirname, 'fixtures/traces/a9ca9d-2026-10-21.json.gz'))).toString()), { timestamp: dayS(D) });
const ARNZ = JSON.parse(zlib.gunzipSync(fs.readFileSync(path.join(__dirname, 'fixtures/legs/424c60/2026-10-07_lol.json.gz'))).toString());
const PLAIN = Object.assign({}, ARNZ, { icao: 'aaaaaa', r: 'G-PLAIN', t: 'A320', dbFlags: 0, timestamp: dayS(D) });
const tarOf = list => Buffer.concat(list.map(([n, b]) => tarEntry(n, b)).concat([Buffer.alloc(1024)]));
const TAR = tarOf([[tr('aaaaaa'), gz(PLAIN)], [tr('a9ca9d'), gz(REAL)], [tr('bbbbbc'), gz({ icao: 'bbbbbc', r: 'G-PARK', t: 'C172', dbFlags: 0, timestamp: dayS(D), trace: [[0, 51.5, -0.1, 'ground', 0, null, 0]] })],
  [tr('bbbbbd'), gz({ icao: 'bbbbbd', r: 'G-BRKN', t: 'C172', dbFlags: 0, timestamp: dayS(D), trace: [[0, 51.5, -0.1, 1000]] }).subarray(0, 40)]]);   // (published cut short: it will not read)
let PARTS = {};
const partsFor = (d, tar) => { const tag = A.tagOf(d, 0), base = `https://github.com/adsblol/globe_history_${d.slice(0, 4)}/releases/download/${tag}/${tag}`; const cut = Math.floor(tar.length / 2) + 1; PARTS[base + '.tar.aa'] = tar.subarray(0, cut); PARTS[base + '.tar.ab'] = tar.subarray(cut); };
const io = {
  get: async u => PARTS[u] ? 206 : 404,
  open: async u => { const b = PARTS[u]; if (!b) throw new Error('404'); return (async function* () { for (let o = 0; o < b.length; o += 5000) yield b.subarray(o, o + 5000); })(); }
};
const code = id => { const a = E.byId(id); return a ? a.iata || a.icao : id; };
const sigs = legs => legs.map(l => (l.from ? code(l.from.id) : '?') + '-' + (l.to ? code(l.to.id) : '?') + '@' + Math.round(l.tStart));

(async () => {
  partsFor(D, TAR);
  check('(the world log on by default: 366 days, not built with under 4 GB free)', M.CFG.worldDays === 366 && M.CFG.worldFreeGb === 4 && M.worldRoom());
  const st = await M.archiveDay(D, io);
  check('a day of the archive read for its blocked aircraft: the world log of it built in the same read - every aircraft in it that reads', st.published && M.WORLD.has(D, W.WORLD_V) && M.WORLD.days.get(D).n === 3 && st.taken === 1 && M.archIdx.has(D) && st.bad === 1, { st, w: M.WORLD.days.get(D) });
  // (an ordinary aircraft's day - as its day's log is built from adsb.lol's file)
  const info = { hex: 'aaaaaa', type: 'A320' }, cls = E.classify(info);
  const exp = E.legsFromPoints(E.parseTrace(PLAIN), { heli: false, patrol: false, cls, type: 'A320', rangeKm: E.typeRangeKm(info), dataEnd: dayS(D) + 86400 }).map(l => E.summarizeLeg(l, { visits: new Map(), base: 0, mil: false, grp: E.groupOf(cls), cls, type: 'A320' }));
  const since = dayOf(nowS() - 40 * 86400);
  const r = M.answer(new URL(`http://x/hist?hex=aaaaaa,bbbbbc,c0ffe3&since=${since}`), nowS()), [pa, pb, pc] = r.list;
  check('/hist of an ordinary aircraft: its day from the world log - the same flights as its day\'s log is built, from adsb.lol alone (lo)', r.hv === M.HIST_V && pa.days[HD] === exp.length && exp.length >= 2 && JSON.stringify(sigs(pa.legs)) === JSON.stringify(sigs(exp)) && pa.lo.includes(HD) && pa.legs.every(l => l.day === HD && Array.isArray(l.lx)), { got: sigs(pa.legs), exp: sigs(exp), n: pa.days[HD] });
  check('... one heard that day that did not fly: a day without flights', pb.days[HD] === 0 && pb.lo.includes(HD), pb);
  check('... one not in the day\'s archive (its index): a day without flights', pc.days[HD] === 0 && pc.lo.includes(HD), pc);
  const rb = M.answer(new URL(`http://x/hist?hex=bbbbbd&since=${since}`), nowS()).list[0];
  check('... one whose file would not read (in the day\'s index, not in the world log): that day not said - never "no flights"', !(HD in rb.days), rb.days);
  // (the disk filling up while a day is built - a write refused: the day given up, nothing kept of it, tried again later)
  { const D2 = dayOf(nowS() - 4 * 86400), orig = M.WORLD.writer; partsFor(D2, TAR);
    M.WORLD.writer = d => { const w = orig(d), add = w.add; let n = 0; w.add = (...a) => { if (++n === 2) throw new Error('ENOSPC: no space left on device, write'); return add(...a); }; return w; };
    const s2 = await M.archiveDay(D2, io); M.WORLD.writer = orig;
    check('a write refused while the day is built (the disk full): the day given up - nothing of it kept, no file left beside it, tried again later; the blocked aircraft\'s day built all the same', s2.published && !M.WORLD.has(D2) && !fs.existsSync(M.WORLD.fileOf(D2) + '.rows') && !fs.existsSync(M.WORLD.fileOf(D2) + '.tmp') && /ENOSPC/.test(M.WS.err) && !M.worldWants(D2, nowS()) && M.histRead('a9ca9d').days[D2.replace(/-/g, '/')] >= 1, { s2, err: M.WS.err }); }
  const r2 = M.answer(new URL(`http://x/hist?hex=aaaaaa&since=${dayOf(nowS() - 2 * 86400)}`), nowS()).list[0];
  check('... a day before "since": not looked up', !(HD in r2.days), r2.days);
  // (the world log has not the day - not built yet: an ordinary aircraft in the day's index is not said to have no flights)
  fs.renameSync(M.WORLD.fileOf(D), M.WORLD.fileOf(D) + '.keep'); M.WORLD.scan();
  const r3 = M.answer(new URL(`http://x/hist?hex=aaaaaa,c0ffe3&since=${since}`), nowS()).list;
  check('... the world log without the day: the aircraft in its index left out (the browser reads it) - one not in it still none', !(HD in r3[0].days) && r3[1].days[HD] === 0, r3.map(x => x.days));
  // (a day read before the world log: read again for it alone - and its index, which it has not - nothing else built again)
  fs.unlinkSync(M.idxFile(D)); M.archIdx.delete(D);
  for (let k = 1; k < 3; k++) M.archDays.set(dayOf(nowS() - k * 86400), false);
  const job = M.archiveJob(nowS());
  check('a day read before the world log: next, for it alone', job && job.d === D && job.only === true && job.world === true && !job.index, job);
  const hb = fs.statSync(M.histFile('a9ca9d')).mtimeMs, takenBefore = M.AR.taken;
  const sw = await M.worldDay(D, io);
  check('... read again: its world log and its index - the blocked aircraft\'s day not built again', M.WORLD.has(D, W.WORLD_V) && sw.world === 3 && M.archIdx.has(D) && M.AR.taken === takenBefore && fs.statSync(M.histFile('a9ca9d')).mtimeMs === hb, sw);
  check('... and then nothing left to do for it', !(M.archiveJob(nowS()) && M.archiveJob(nowS()).d === D));
  const r4 = M.answer(new URL(`http://x/hist?hex=aaaaaa&since=${since}`), nowS()).list[0];
  check('... served from it again', r4.days[HD] === exp.length, r4.days);
  // (a day not published, older than the archive's days: tried again in an hour)
  const D9 = dayOf(nowS() - 300 * 86400);
  const s9 = await M.worldDay(D9, io);
  check('a day of the world log\'s year not published (yet): nothing kept, tried again in an hour', s9.published === false && !M.WORLD.has(D9) && !M.worldWants(D9, nowS()), s9);
  // (the disk short of room: nothing built - said in /status)
  fs.unlinkSync(M.WORLD.fileOf(D)); M.WORLD.scan();
  M.CFG.worldFreeGb = 1e9; M.worldRecheck();
  check('the disk with less free than worldFreeGb: no day built for the world log, said in /status', !M.worldWants(D, nowS()) && !(M.archiveJob(nowS()) && M.archiveJob(nowS()).world) && M.answer(new URL('http://x/status'), nowS()).archive.world.full === true);
  M.CFG.worldFreeGb = 4; M.worldRecheck();
  check('... room again: the day wanted', M.worldWants(D, nowS()));
  const ws = M.answer(new URL('http://x/status'), nowS()).archive.world;
  check('/status: the world log\'s days, its size, lookups', ws.on === 366 && ws.v === W.WORLD_V && ws.built >= 2 && ws.lookups > 0 && typeof ws.gb === 'number', ws);
  for (let k = 1; k < 3; k++) M.archDays.delete(dayOf(nowS() - k * 86400));
  console.log(fails ? `\n${fails} failed` : '\nall passed');
  process.exit(fails ? 1 : 0);
})().catch(e => { console.log('FAIL  crashed', e && e.stack || e); process.exit(1); });
