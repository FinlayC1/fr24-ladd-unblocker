// The monitor's flight logs from adsb.lol's day archives, and its trace files read for what each answer is (22.31.9).
// adsb.lol's site now shows servers a proof-of-work verification page in front of its trace files - every day the monitor
// asked for failed, and its logs had gaps; adsb.lol publishes every day's traces on GitHub (a tar in parts of ~1.9 GB).
// Here a day's archive made up as adsb.lol's are - its heatmaps, then gzipped traces (N73VR's real 21 Oct among them) -
// cut into two parts mid-file, read in chunks of every size:
//   - the tar read the same whatever the chunks; a trace's own fields from its first kilobytes; the parts found (-0, -1)
//   - the day built: every blocked aircraft's trace and every one the archive flags LADD - not the others; a broken one
//     counted, not fatal; the day marked built from adsb.lol alone (a browser looking adds airplanes.live); the learning
//     rows written once; the day noted, its state "done"
//   - a day's job once the archive is in: nothing asked of adsb.lol (in it: built; not in it: no file); before it is out:
//     waits for it, asking nothing; a day not published: tried again in an hour, never marked
//   - adsb.lol's verification page: read as one - left alone an hour, said in /status - never a day without flights
// usage: node test/unit_archive.cjs <dataDir>
const fs = require('fs'), path = require('path'), zlib = require('zlib'), os = require('os');
process.env.MON_DATA = process.argv[2] || path.join(__dirname, '../monitor/data');
process.env.MON_STORE = fs.mkdtempSync(path.join(os.tmpdir(), 'monarch-'));
const M = require('../monitor/monitor.cjs');
const A = require('../monitor/archive.cjs');
M.loadEngine();
const E = M.E;
let fails = 0;
const check = (name, ok, info) => { if (!ok) fails++; console.log((ok ? 'PASS  ' : 'FAIL  ') + name + (info !== undefined ? '  ' + JSON.stringify(info).slice(0, 500) : '')); };
const code = id => { const a = E.byId(id); return a ? a.iata || a.icao : id; };
const dayOf = t => new Date(t * 1000).toISOString().slice(0, 10), dayS = d => Date.parse(d + 'T00:00:00Z') / 1000;
const nowS = () => Date.now() / 1000;

// ---- the networks, as this test answers them: adsb.lol's site behind its verification page; airplanes.live no file -----
const POW = '<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><title>Verification</title></head><body><h1>Verifying connection</h1><p>Solving security challenge</p><script>/* proof of work */</script></body></html>';
const asked = [];
let lolAnswer = [403, POW], aplAnswer = [404, ''];
global.fetch = async url => {
  asked.push(url);
  const a = /^https:\/\/adsb\.lol\//.test(url) ? lolAnswer : /globe\.airplanes\.live/.test(url) ? aplAnswer : [404, ''];
  return { status: a[0], text: async () => a[1] };
};

// ---- a day's archive, as adsb.lol makes them ------------------------------------------------------------------------
function tarHeader(name, size, type) {
  const h = Buffer.alloc(512, 0);
  h.write(name, 0, 100, 'latin1'); h.write('0000644\0', 100); h.write('0001750\0', 108); h.write('0001750\0', 116);
  h.write(size.toString(8).padStart(11, '0') + '\0', 124); h.write(Math.floor(Date.now() / 1000).toString(8).padStart(11, '0') + '\0', 136);
  h.write('        ', 148); h.write(type || '0', 156); h.write('ustar\0', 257, 'latin1'); h.write('00', 263);
  let sum = 0; for (const b of h) sum += b; h.write(sum.toString(8).padStart(6, '0') + '\0 ', 148);
  return h;
}
const tarEntry = (name, buf) => Buffer.concat([tarHeader(name, buf.length, '0'), buf, Buffer.alloc((512 - buf.length % 512) % 512)]);
const tarDir = name => tarHeader(name, 0, '5');
const D = dayOf(nowS() - 3 * 86400), HD = D.replace(/-/g, '/');
const REAL = Object.assign(JSON.parse(zlib.gunzipSync(fs.readFileSync(path.join(__dirname, 'fixtures/traces/a9ca9d-2026-10-21.json.gz'))).toString()), { timestamp: dayS(D) });
const ARNZ = JSON.parse(zlib.gunzipSync(fs.readFileSync(path.join(__dirname, 'fixtures/legs/424c60/2026-10-07_lol.json.gz'))).toString());
const gz = o => zlib.gzipSync(Buffer.from(JSON.stringify(o)));
const tr = hex => `./traces/${hex.slice(-2)}/trace_full_${hex}.json`;
const entries = [
  ['dir', './'], ['dir', './heatmap/'], ['file', './heatmap/33.bin.ttf', zlib.gzipSync(Buffer.alloc(70000, 7))], ['dir', './traces/'],
  ['file', tr('aaaaaa'), gz(Object.assign({}, ARNZ, { icao: 'aaaaaa', r: 'G-PLAIN', t: 'A320', dbFlags: 0, timestamp: dayS(D) }))],   // (an ordinary aircraft)
  ['file', tr('a9ca9d'), gz(REAL)],                                                                                                    // (flagged LADD, not known to the monitor)
  ['file', tr('c0ffee'), gz(Object.assign({}, ARNZ, { icao: 'c0ffee', dbFlags: 0, timestamp: dayS(D) }))],                             // (blocked, known to the monitor, no flag)
  ['file', './traces/23/trace_full_~123123.json', gz({ icao: '~123123', dbFlags: 8, timestamp: dayS(D), trace: [] })],               // (not an ICAO address)
  ['file', tr('bbbbbb'), Buffer.concat([gz({ icao: 'bbbbbb', dbFlags: 8, timestamp: dayS(D), trace: [[0, 50, 0, 1000]] }).subarray(0, 40)])],   // (cut short)
  ['file', tr('c0ffef'), Buffer.from(JSON.stringify(Object.assign({}, ARNZ, { icao: 'c0ffef', dbFlags: 8, timestamp: dayS(D) })))],    // (not gzipped, flagged)
  ['file', tr('ae1234'), gz(Object.assign({}, ARNZ, { icao: 'ae1234', r: '11-1234', t: 'C30J', dbFlags: 1, timestamp: dayS(D) }))],     // (military: its log kept, not followed)
  ['file', './README.txt', Buffer.from('adsb.lol globe history')]
];
const TAR = Buffer.concat(entries.map(e => e[0] === 'dir' ? tarDir(e[1]) : tarEntry(e[1], e[2])).concat([Buffer.alloc(1024)]));
const cut = Math.floor(TAR.length * 0.53) + 3;   // (mid-file, as GitHub's parts are)
const tag = A.tagOf(D, 0), base = `https://github.com/adsblol/globe_history_${D.slice(0, 4)}/releases/download/${tag}/${tag}`;
let PARTS = { [base + '.tar.aa']: TAR.subarray(0, cut), [base + '.tar.ab']: TAR.subarray(cut) };
const gets = [];
const io = {
  get: async u => { gets.push(u); return PARTS[u] ? 206 : 404; },
  open: async u => { const b = PARTS[u]; if (!b) throw new Error('404'); return (async function* () { let o = 0; while (o < b.length) { const n = 1 + Math.floor(Math.random() * 9000); yield b.subarray(o, o + n); o += n; } })(); }
};

(async () => {
  // ---- the tar, read in chunks of any size -----------------------------------------------------------------------
  { const read = async sizes => { const got = []; const rd = A.tarReader(() => true, async (name, buf) => { got.push(name + ':' + buf.length + ':' + require('crypto').createHash('md5').update(buf).digest('hex')); }); let o = 0, i = 0; while (o < TAR.length) { const n = sizes(i++); await rd.push(TAR.subarray(o, o + n)); o += n; } return { got, done: rd.done, n: rd.entries }; };
    const whole = await read(() => TAR.length), ones = await read(() => 1), odd = await read(i => [7, 511, 513, 1, 4096, 100000][i % 6]);
    const files = entries.filter(e => e[0] === 'file').length;
    check('the tar read the same in one piece, byte by byte, and in odd chunks: every file, whole, and its end found', whole.got.length === files && JSON.stringify(ones.got) === JSON.stringify(whole.got) && JSON.stringify(odd.got) === JSON.stringify(whole.got) && whole.done && ones.done, { files, got: whole.got.length, done: whole.done }); }
  { const h = A.headOf(gz(REAL)), h2 = A.headOf(Buffer.from(JSON.stringify({ icao: 'x', r: 'G-X', t: 'C172', dbFlags: 0, trace: [] })));
    check('a trace\'s own fields from its first kilobytes (gzipped or not): flags, registration, type', h && h.flags === 8 && h.reg === 'N73VR' && h.type === 'FA7X' && h2.flags === 0 && h2.reg === 'G-X', { h, h2 }); }
  { gets.length = 0; const p = await A.partsOf(D, io.get);
    check('the day\'s parts found: .aa, .ab - and no more', p.length === 2 && /\.tar\.aa$/.test(p[0]) && /\.tar\.ab$/.test(p[1]) && gets.length === 3, gets);
    const t1 = A.tagOf(D, 1), b1 = base.replace(new RegExp(tag, 'g'), t1);
    const P1 = { [b1 + '.tar.aa']: Buffer.alloc(1) };
    const p1 = await A.partsOf(D, async u => P1[u] ? 206 : 404);
    check('... a day published again (-1): that one', p1.length === 1 && p1[0].includes(t1), p1);
    const p0 = await A.partsOf(D, async () => 404);
    check('... none published: none', p0.length === 0); }

  // ---- the day built from it ----------------------------------------------------------------------------------------
  M.markBlocked('c0ffee', { reg: 'M-ARNZ' }, dayS(D) - 86400);
  M.markBlocked('c0ffe1', { reg: 'N1' }, dayS(D) - 86400);
  check('(before: the LADD aircraft the archive flags is not known to the monitor)', !M.blocked.has('a9ca9d'));
  asked.length = 0;
  const st = await M.archiveDay(D, io);
  check('the day read: both parts, every trace of an ICAO address in it (not the "~" one)', st.published && st.parts === 2 && st.traces === 6 && st.entries === entries.length, st);
  check('... taken: the blocked aircraft\'s, those the archive flags LADD and the military ones; not an ordinary one; a broken file counted', st.taken === 4 && st.bad === 1 && !M.blocked.has('aaaaaa') && !fs.existsSync(M.histFile('aaaaaa')), st);
  check('... nothing asked of adsb.lol\'s site or airplanes.live meanwhile', asked.length === 0, asked);
  const h = M.histRead('a9ca9d'), legs = h.legs.filter(l => l.day === HD).map(l => (l.from ? code(l.from.id) : '?') + '-' + (l.to ? code(l.to.id) : '?'));
  check('N73VR (flagged LADD, new to the monitor): blocked from now on; its day\'s flights built - Morristown - New Haven among them', M.blocked.has('a9ca9d') && legs.includes('MMU-HVN') && h.days[HD] === legs.length, { legs, n: h.days[HD] });
  check('... marked built from adsb.lol alone (a browser looking at it adds airplanes.live), and served so', h.lo[HD] === 1 && !h.part[HD] && M.histOf('a9ca9d').lo.includes(HD) && !M.histOf('a9ca9d').part.includes(HD) && M.histOf('a9ca9d').days[HD] === legs.length, { lo: h.lo, served: M.histOf('a9ca9d') && { lo: M.histOf('a9ca9d').lo, part: M.histOf('a9ca9d').part } });
  const hC = M.histRead('c0ffee');
  check('the blocked aircraft the monitor knew (no flag in the file): its day built too', hC.days[HD] >= 3, hC.days);
  check('... and one not gzipped, flagged LADD: built', M.histRead('c0ffef').days[HD] >= 3, M.histRead('c0ffef').days);
  const learn = (() => { try { return JSON.parse(fs.readFileSync(path.join(process.env.MON_STORE, 'learn', D + '.json'), 'utf8')); } catch (e) { return null; } })();
  check('the learning rows of the day written (once, at the end)', Array.isArray(learn) && learn.some(r => String(r[0]).startsWith('a9ca9d|')) && learn.some(r => String(r[0]).startsWith('c0ffee|')), learn && learn.length);
  check('a military aircraft: its day built and served (/hist) - not made a blocked aircraft (not followed live)', M.histRead('ae1234').days[HD] >= 3 && M.histOf('ae1234').days[HD] >= 3 && !M.blocked.has('ae1234'), { days: M.histRead('ae1234').days, blocked: M.blocked.has('ae1234') });
  { const z = M.histOf('c0ffe3'), D9 = dayOf(nowS() - 9 * 86400).replace(/-/g, '/');
    check('an aircraft not in the day\'s archive: that day served as one without flights, adsb.lol alone (lo) - not a day not read', z.days[HD] === 0 && z.lo.includes(HD) && !(D9 in z.days), z); }
  check('the day noted - "done" - and the archive\'s figures kept (/status)', fs.existsSync(M.archMark(D)) && M.archiveState(D, nowS()) === 'done' && M.AR.days === 1 && M.AR.last.day === D && M.answer(new URL('http://x/status'), nowS()).archive.days === 1, M.AR);

  // ---- a day's job once its archive is in; before it is out -------------------------------------------------------
  asked.length = 0;
  M.histPend.add('a9ca9d|' + D); await M.histOne({ hex: 'a9ca9d', day: D, tries: 0, at: 0 });
  check('a day\'s job, the archive in, the aircraft in it: done - nothing asked of anyone', asked.length === 0 && !M.histPend.has('a9ca9d|' + D) && !M.histQ.length, asked);
  M.histPend.add('c0ffe1|' + D); await M.histOne({ hex: 'c0ffe1', day: D, tries: 0, at: 0, fill: true });
  check('... the aircraft not in it (adsb.lol heard nothing of it): adsb.lol\'s site not asked; airplanes.live asked; no file there either - a day without flights', !asked.some(u => /adsb\.lol/.test(u)) && asked.some(u => /airplanes\.live.*trace_full_c0ffe1/.test(u)) && M.histRead('c0ffe1').days[HD] === 0, { asked, days: M.histRead('c0ffe1').days });
  const Y = dayOf(nowS() - 86400); asked.length = 0;
  M.histPend.add('c0ffee|' + Y); await M.histOne({ hex: 'c0ffee', day: Y, tries: 0, at: 0 });
  const q = M.histQ.find(j => j.hex === 'c0ffee');
  check('yesterday, its archive not out yet: the job waits for it (an hour) - nothing asked', M.archiveState(Y, nowS()) === 'wait' && asked.length === 0 && !!q && q.at > Date.now() + 3500e3 && M.histPend.has('c0ffee|' + Y), { state: M.archiveState(Y, nowS()), asked, q });
  M.histQ.length = 0; M.histPend.clear();
  // ---- every day of the 220 the archives cover: read in the end, newest first; nothing asked of the sites for them -------
  { const D30 = dayOf(nowS() - 30 * 86400), D219 = dayOf(nowS() - 219 * 86400), D300 = dayOf(nowS() - 300 * 86400);
    check('a day of 30 or 219 days ago not read yet: to come ("wait") - one of 300 days ago: not covered ("off")', M.CFG.archiveDays === 220 && M.archiveState(D30, nowS()) === 'wait' && M.archiveState(D219, nowS()) === 'wait' && M.archiveState(D300, nowS()) === 'off', [M.archiveState(D30, nowS()), M.archiveState(D219, nowS()), M.archiveState(D300, nowS())]);
    M.markBlocked('c0ffe4', null, nowS() - 400 * 86400); M.fillAsked.clear(); M.histQ.length = 0; M.histPend.clear();
    const was = M.closed; M.closed = dayOf(nowS() - 2 * 86400);
    M.fillHist('c0ffe4', nowS());
    check('filling an aircraft\'s log: no day the archives cover queued to be asked of adsb.lol\'s site (all 220)', M.histQ.filter(j => j.hex === 'c0ffe4').length === 0, M.histQ.length);
    M.closed = was; M.histQ.length = 0; M.histPend.clear(); }
  // ---- two days read at once ------------------------------------------------------------------------------------------
  { const mk = day => { const E2 = entries.map(e => e[0] === 'file' && /trace_full_c0ffee/.test(e[1]) ? ['file', e[1], gz(Object.assign({}, ARNZ, { icao: 'c0ffee', dbFlags: 0, timestamp: dayS(day) }))] : e).filter(e => !(e[0] === 'file' && /trace_full_(a9ca9d|ae1234)/.test(e[1])));
      const T = Buffer.concat(E2.map(e => e[0] === 'dir' ? tarDir(e[1]) : tarEntry(e[1], e[2])).concat([Buffer.alloc(1024)])), tg = A.tagOf(day, 0), bs = `https://github.com/adsblol/globe_history_${day.slice(0, 4)}/releases/download/${tg}/${tg}`, c = Math.floor(T.length / 2) + 1;
      PARTS[bs + '.tar.aa'] = T.subarray(0, c); PARTS[bs + '.tar.ab'] = T.subarray(c); };
    const Da = dayOf(nowS() - 6 * 86400), Db = dayOf(nowS() - 7 * 86400); mk(Da); mk(Db);
    const both = await Promise.all([M.archiveDay(Da, io), M.archiveDay(Db, io)]);
    const hc = M.histRead('c0ffee');
    check('two days read at once: both done, each aircraft\'s days built (its file written by both, neither lost)', both.every(x => x.published && x.taken === 2) && M.archiveState(Da, nowS()) === 'done' && M.archiveState(Db, nowS()) === 'done' && hc.days[Da.replace(/-/g, '/')] >= 3 && hc.days[Db.replace(/-/g, '/')] >= 3 && hc.days[HD] >= 3 && !M.archRunning.size && M.AR.running === '', { days: hc.days, running: M.AR.running }); }
  // ---- today's positions, for browsers the sites' own files are walled from (/trace) ----------------------------------
  { const t = Math.floor(nowS()) - 3 * 3600, hexT = 'c0ffee';
    M.tracks.put(hexT, [[t, 51.0, -0.5, 'ground'], [t + 60, 51.01, -0.5, 1200], [t + 120, 51.1, -0.6, 5000]]);
    M.ingest({ hex: hexT, lat: 51.5, lon: -1.0, alt_baro: 20000, gs: 400, track: 300, seen_pos: 0, flight: 'MARNZ', r: 'M-ARNZ', t: 'PC24' }, nowS() - 60);
    M.ingest({ hex: hexT, lat: 51.6, lon: -1.2, alt_baro: 22000, gs: 410, track: 300, seen_pos: 0 }, nowS());
    const tr2 = M.answer(new URL('http://x/trace?hex=' + hexT), nowS()), none = M.answer(new URL('http://x/trace?hex=abcdef'), nowS());
    const ts = tr2 ? tr2.trace.map(r => r[0]) : [];
    check('/trace: the day\'s kept track and the positions held now, in time order, as an adsb.lol trace file (icao, absolute times)', !!tr2 && tr2.icao === hexT && tr2.timestamp === 0 && tr2.trace.length === 5 && tr2.trace[0][3] === 'ground' && ts.every((x, i) => !i || x > ts[i - 1]) && tr2.trace[4][3] === 22000, tr2 && tr2.trace.map(r => [r[0] - t, r[3]]));
    check('... an aircraft not heard: nothing (404)', none === null); }

  // ---- a day not published ------------------------------------------------------------------------------------------
  { const D5 = dayOf(nowS() - 5 * 86400); PARTS = {};
    const s5 = await M.archiveDay(D5, io);
    check('a day not published: nothing noted, tried again in an hour (not before)', s5.published === false && !fs.existsSync(M.archMark(D5)) && M.archTried.has(D5) && M.archiveNext(nowS()) !== D5, { s5, next: M.archiveNext(nowS()) }); }

  // ---- adsb.lol's verification page ---------------------------------------------------------------------------------
  { asked.length = 0; delete M.pause['adsb.lol'];
    const r = await M.traceGet('https://adsb.lol/globe_history/2026/01/01/traces/9d/trace_full_a9ca9d.json', 'a9ca9d');
    const r2 = await M.traceGet('https://adsb.lol/globe_history/2026/01/02/traces/9d/trace_full_a9ca9d.json', 'a9ca9d');
    check('adsb.lol\'s verification page: read as one; left alone an hour - the next file not asked', r.state === 'wall' && r2.state === 'paused' && r2.why === 'wall' && asked.length === 1 && M.pause['adsb.lol'] > Date.now() + 3500e3, { r, r2, asked: asked.length });
    const sts = M.answer(new URL('http://x/status'), nowS());
    check('... said in /status (the networks\' answers)', sts.nets && sts.nets['adsb.lol'] && sts.nets['adsb.lol'].wall === 1 && sts.nets['adsb.lol'].wallAt > 0, sts.nets);
    // (a day older than the archives cover, adsb.lol walling, airplanes.live with no file: not known - never a day without
    // flights, and not asked again every two minutes)
    const was = M.CFG.archiveDays; M.CFG.archiveDays = 2; asked.length = 0;
    const D8 = dayOf(nowS() - 8 * 86400); M.markBlocked('c0ffe2', null, dayS(D8) - 86400);
    M.histPend.add('c0ffe2|' + D8); await M.histOne({ hex: 'c0ffe2', day: D8, tries: 0, at: 0, fill: true });
    const h8 = M.histRead('c0ffe2');
    check('... a day the archives do not cover, adsb.lol walling, no file at airplanes.live: not known (-1) - never a day without flights; not queued again', h8.days[D8.replace(/-/g, '/')] === -1 && !M.histQ.length && !asked.some(u => /adsb\.lol/.test(u)), { days: h8.days, q: M.histQ.length, asked });
    M.CFG.archiveDays = was; }
  // ---- the classifier, as the userscript's ---------------------------------------------------------------------------
  { const k = (st, b) => M.classifyTrace('a9ca9d', st, b).state;
    check('answers told apart as the userscript does: file, none, wall (403, 200), rate, failures', k(200, JSON.stringify(REAL)) === 'ok' && k(404, '') === 'none' && k(403, POW) === 'wall' && k(200, POW) === 'wall' && k(429, '') === 'rate' && k(403, '') === 'err' && k(200, '{"x":1}') === 'err' && k(200, JSON.stringify(Object.assign({}, REAL, { icao: 'abcdef' }))) === 'err'); }
  console.log(fails ? `\n${fails} failed` : '\nall passed');
  process.exit(fails ? 1 : 0);
})().catch(e => { console.log('FAIL  CRASH ' + (e && e.stack || e)); process.exit(1); });
