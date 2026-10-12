// Live shadow test: real flights FR24 shows as N/A right now (and adsb.lol's LADD list), one eighth of them (by Mode S
// code, so their history comes from a few archive shards), snapshotted every round while they fly; every engine predicts
// the very same moments; scored where each flight really landed. Nothing here is in any table or weight that is newer
// than the archive (which ends the day before yesterday) - except that the shipped tables do contain these aircraft's
// older flights, as they would for the user.
//   node test/live_shadow.cjs pick <dataDir> <outDir>           FR24 feed + adsb.lol LADD -> <outDir>/pick.json, history
//   node test/live_shadow.cjs snap <outDir>                     today's trace of every picked aircraft still flying
//   node test/live_shadow.cjs loop <dataDir> <outDir> <rounds> <minutes> <dev spec>   snap every <minutes>, and the METARs
//        of the dev engine's five likeliest fields at that moment (kept for scoring the weather-aware engine later)
//   node test/live_shadow.cjs score <dataDir> <outDir> <name=engine.js|tables-prefix-or-old:tb.json|logit.json[|t2 file][|wx]> ...
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const { execFile } = require('child_process');
const A = require('./arch.cjs');
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36';
const sleep = ms => new Promise(r => setTimeout(r, ms));
const curl = (url, hdr) => new Promise(res => execFile('curl', ['-s', '-m', '25', '--compressed', '-A', UA, ...(hdr ? ['-H', hdr] : []), '-w', '\n%{http_code}', url], { maxBuffer: 128e6 }, (err, out) => { if (err && !out) return res({ status: 0, body: '' }); const i = out.lastIndexOf('\n'); res({ status: Number(out.slice(i + 1)) || 0, body: out.slice(0, i) }); }));
const getJson = async (url, tries = 3) => { for (let k = 0; k < tries; k++) { const r = await curl(url); if (r.status === 429) { await sleep(8000 * (k + 1)); continue; } if (r.status !== 200) return { status: r.status, j: null }; try { return { status: 200, j: JSON.parse(r.body) }; } catch (e) { return { status: -1, j: null }; } } return { status: 429, j: null }; };
// one eighth of all aircraft: Mode S codes ending in these 32 shards
const SHARDS = A.SHARDS.filter((_, i) => i % 8 === 5), SHSET = new Set(SHARDS);
const NOT_AC = /^(GRND|SERV|BALL|GLID|DRON|UAV|ZZZZ|TWR|SHIP)$/;
const [mode, ...rest] = process.argv.slice(2);
const dayStr = t => new Date(t * 1000).toISOString().slice(0, 10);

async function feedTiles() {
  const out = new Map(); let calls = 0;
  const tile = async (n, s, w, e, depth) => {
    const url = `https://data-cloud.flightradar24.com/zones/fcgi/feed.js?bounds=${n},${s},${w},${e}&faa=1&satellite=1&mlat=1&flarm=1&adsb=1&gnd=0&air=1&vehicles=0&estimated=0&maxage=14400&gliders=0&stats=0`;
    const { j } = await getJson(url); calls++; await sleep(700);
    if (!j) return;
    const v = Object.entries(j).filter(([, x]) => Array.isArray(x));
    if (v.length >= 1490 && depth < 4) { const mn = (n + s) / 2, me = (w + e) / 2; for (const [a, b, c, d] of [[n, mn, w, me], [n, mn, me, e], [mn, s, w, me], [mn, s, me, e]]) await tile(a, b, c, d, depth + 1); return; }
    for (const [id, x] of v) out.set(id, x);
  };
  const regions = [[72, 34, -25, 45], [34, 10, -20, 60], [60, 15, -135, -52], [15, -40, -90, -30], [55, -10, 60, 150], [-10, -48, 110, 180]];
  for (const [n, s, w, e] of regions) await tile(n, s, w, e, 0);
  return { flights: out, calls };
}

async function pick(dataDir, outDir) {
  fs.mkdirSync(outDir, { recursive: true });
  const { flights, calls } = await feedTiles();
  const pickd = new Map(); let na = 0;
  for (const [id, x] of flights) {
    const hex = String(x[0] || '').toLowerCase(), type = String(x[8] || '').toUpperCase();
    if (!/^[0-9a-f]{6}$/.test(hex) || x[14] || (x[4] || 0) < 1000 || (x[5] || 0) < 50 || NOT_AC.test(type) || x[12]) continue;
    na++; if (!SHSET.has(hex.slice(-2))) continue;
    pickd.set(hex, { hex, fr24: id, type, reg: x[9] || '', cs: x[16] || x[13] || '', origin: x[11] || '', src: 'fr24 N/A' });
  }
  const { j: ladd } = await getJson('https://api.adsb.lol/v2/ladd');
  let nl = 0;
  for (const a of (ladd && ladd.ac) || []) {
    const hex = String(a.hex || '').toLowerCase(); if (!/^[0-9a-f]{6}$/.test(hex) || a.alt_baro === 'ground' || (+a.alt_baro || 0) < 1000) continue;
    nl++; if (!SHSET.has(hex.slice(-2)) || pickd.has(hex)) continue;
    pickd.set(hex, { hex, type: String(a.t || '').toUpperCase(), reg: a.r || '', cs: String(a.flight || '').trim(), src: 'LADD' });
  }
  const list = [...pickd.values()];
  fs.writeFileSync(path.join(outDir, 'pick.json'), JSON.stringify({ at: Math.floor(Date.now() / 1000), list }, null, 0));
  console.log(`FR24 feed: ${flights.size} flights (${calls} requests), ${na} airborne N/A; adsb.lol LADD airborne ${nl}; picked ${list.length} (shards ${SHARDS.length}/256)`);
  // their history: the archive's consecutive run (one pass over 32 shards), and the day the archive lacks (adsb.lol)
  const archDir = path.join(dataDir, 'arch'), run = A.dayPlan(archDir).run, want = new Set(list.map(a => a.hex));
  const lines = new Map();
  for (const sh of SHARDS) for (const d of run) {
    const f = path.join(archDir, d, sh + '.jsonl.gz'); if (!fs.existsSync(f)) continue;
    const txt = zlib.gunzipSync(fs.readFileSync(f)).toString('utf8');
    for (let i = 0; i < txt.length;) { let j = txt.indexOf('\n', i); if (j < 0) j = txt.length; const hex = txt.slice(i + 6, i + 12); if (want.has(hex)) (lines.get(hex) || lines.set(hex, []).get(hex)).push(txt.slice(i, j)); i = j + 1; }
  }
  const lastArch = run[run.length - 1], gapDays = []; for (let t = Date.parse(lastArch + 'T12:00:00Z') / 1000 + 86400; dayStr(t) < dayStr(Date.now() / 1000); t += 86400) gapDays.push(dayStr(t));
  for (const a of list) {
    const dir = path.join(outDir, a.hex); fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'arch.jsonl.gz'), zlib.gzipSync((lines.get(a.hex) || []).join('\n')));
    for (const d of gapDays) { const { j } = await getJson(`https://adsb.lol/globe_history/${d.replace(/-/g, '/')}/traces/${a.hex.slice(-2)}/trace_full_${a.hex}.json`, 2); if (j) fs.writeFileSync(path.join(dir, 'gap_' + d + '.json.gz'), zlib.gzipSync(JSON.stringify(j))); await sleep(150); }
  }
  console.log(`history: ${run.length} archive days (${run[0]} .. ${lastArch}) + ${gapDays.join(', ')} from adsb.lol; ${[...lines.values()].filter(l => l.length).length} of ${list.length} aircraft seen in the archive`);
}

async function snap(outDir) {
  const P = JSON.parse(fs.readFileSync(path.join(outDir, 'pick.json'), 'utf8')), now = Math.floor(Date.now() / 1000);
  let got = 0, flying = 0;
  const one = async a => {
    const dir = path.join(outDir, a.hex), done = path.join(dir, 'landed');
    if (fs.existsSync(done)) return;
    const { j } = await getJson(`https://adsb.lol/data/traces/${a.hex.slice(-2)}/trace_full_${a.hex}.json`, 2); if (!j || !j.trace) return;
    got++;
    fs.writeFileSync(path.join(dir, 'snap_' + now + '.json.gz'), zlib.gzipSync(JSON.stringify(j)));
    const last = j.trace[j.trace.length - 1], lastT = j.timestamp + last[0];
    // (seen on the ground, or not heard for 40 min, after the pick: its flight is over - later snaps add nothing)
    if ((last[3] === 'ground' && lastT > P.at) || now - lastT > 2400) fs.writeFileSync(done, String(now)); else flying++;
  };
  // (one request at a time, gently: adsb.lol is shared - and it is the user's own address that asks)
  for (const a of P.list) { await one(a); await sleep(600); }
  console.log(new Date().toISOString().slice(11, 16), 'snap: traces', got, 'still flying', flying);
  return flying;
}

// ---- scoring ------------------------------------------------------------------------------------------------------------------
function engineFrom(spec, dataDir) {
  const [file, tables, logit, ...more] = spec.split('|'), wx = more.includes('wx') ? 'wx' : '', t2file = more.find(x => x && x !== 'wx');
  const { createRouteEngine } = require(path.resolve(file));
  const E = createRouteEngine();
  E.setAirports(JSON.parse(fs.readFileSync(path.join(dataDir, 'airports.json'), 'utf8')).rows); require('./dataset.cjs').withFields(E, dataDir);
  E.setRunways(JSON.parse(fs.readFileSync(path.join(dataDir, 'runways.json'), 'utf8'))); E.setRunwayLengths(JSON.parse(fs.readFileSync(path.join(dataDir, 'runway_len.json'), 'utf8')));
  if (tables.startsWith('old:')) E.setTables(JSON.parse(fs.readFileSync(tables.slice(4), 'utf8')));
  else {
    E.setTables(JSON.parse(fs.readFileSync(tables + '_tb.json', 'utf8')));
    let t2 = JSON.parse(fs.readFileSync(t2file || tables + '_t2.json', 'utf8'));
    if (t2.pk === 2) { const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'main', '03-data.js'), 'utf8'), i0 = src.indexOf('/* ==UNPACKT2== */') + 18, i1 = src.indexOf('/* ==/UNPACKT2== */'); t2 = new Function(src.slice(i0, i1) + '; return unpackT2;')()(t2); }
    if (E.setTables2) E.setTables2(t2);
  }
  E.setLogit(JSON.parse(fs.readFileSync(logit, 'utf8')));
  return { E, wx: wx === 'wx' };
}
const wxEntry = m => {
  const fin = Number.isFinite; let ceil = Infinity; for (const c of m.clouds || []) if (/BKN|OVC|VV/.test(c.cover || '') && fin(+c.base)) ceil = Math.min(ceil, +c.base);
  const n = parseFloat(String(m.visib == null ? '' : m.visib).replace('+', '')), vis = fin(n) ? n * 1.609 : NaN;
  const cat = m.fltCat || (ceil < 500 || vis < 1.6 ? 'LIFR' : ceil < 1000 || vis < 4.8 ? 'IFR' : ceil <= 3000 || vis <= 8 ? 'MVFR' : 'VFR');
  return { cat, ws: fin(+m.wspd) ? +m.wspd : NaN, wd: fin(+m.wdir) ? +m.wdir : NaN, gust: fin(+m.wgst) ? +m.wgst : NaN, vis, ceil, raw: m.rawOb || '', at: (+m.obsTime || 0) * 1000 };
};
// METARs as they were at each snapshot (kept on disk: <outDir>/wx_<snapT>.json - asked once, when first scored soon after)
async function wxFor(outDir, snapT, icaos) {
  const f = path.join(outDir, 'wx_' + snapT + '.json'); let have = fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) : {};
  const need = [...new Set(icaos)].filter(i => /^[A-Z]{4}$/.test(i) && !(i in have));
  if (need.length && Date.now() / 1000 - snapT < 3 * 3600) {
    for (let i = 0; i < need.length; i += 40) {
      const ids = need.slice(i, i + 40).join(',');
      const [{ j: m }, { j: t }] = [await getJson(`https://aviationweather.gov/api/data/metar?ids=${ids}&format=json`), await getJson(`https://aviationweather.gov/api/data/taf?ids=${ids}&format=json`)];
      const tafs = new Map(); for (const x of Array.isArray(t) ? t : []) { const per = []; for (const fc of x.fcsts || []) { if (fc.fcstChange === 'TEMPO' || fc.fcstChange === 'PROB' || fc.probability) continue; const e = wxEntry({ wspd: fc.wspd, wdir: fc.wdir, wgst: fc.wgst, visib: fc.visib, clouds: fc.clouds }); per.push({ from: (fc.fcstChange === 'BECMG' && fc.timeBec) || fc.timeFrom, to: fc.timeTo, cat: e.cat, ws: e.ws, wd: e.wd, gust: e.gust, vis: e.vis, ceil: e.ceil }); } per.sort((a, b) => a.from - b.from); if (per.length) tafs.set(String(x.icaoId).toUpperCase(), per); }
      for (const x of Array.isArray(m) ? m : []) { const id = String(x.icaoId || '').toUpperCase(), e = wxEntry(x); if (tafs.has(id)) e.taf = tafs.get(id); have[id] = e; }
      for (const id of need.slice(i, i + 40)) if (!(id in have)) have[id] = null;
      await sleep(400);
    }
    fs.writeFileSync(f, JSON.stringify(have));
  }
  return new Map(Object.entries(have).filter(([, v]) => v && snapT * 1000 - v.at < 90 * 60000).map(([k, v]) => [k, v]));
}
function pointsOf(E, dir, upTo) {
  const pts = [];
  const arch = path.join(dir, 'arch.jsonl.gz');
  if (fs.existsSync(arch)) for (const l of zlib.gunzipSync(fs.readFileSync(arch)).toString('utf8').split('\n')) { if (!l) continue; try { const o = JSON.parse(l); pts.push(...E.parseTrace({ timestamp: o.ts, trace: o.tr })); } catch (e) { /* skip */ } }
  for (const f of fs.readdirSync(dir).filter(x => x.startsWith('gap_'))) pts.push(...E.parseTrace(JSON.parse(zlib.gunzipSync(fs.readFileSync(path.join(dir, f))).toString('utf8'))));
  const snaps = fs.readdirSync(dir).filter(x => x.startsWith('snap_')).map(x => +x.slice(5, -8)).sort((a, b) => a - b);
  const use = upTo == null ? snaps[snaps.length - 1] : snaps.filter(s => s <= upTo).pop();
  let meta = null;
  if (use) { const j = JSON.parse(zlib.gunzipSync(fs.readFileSync(path.join(dir, 'snap_' + use + '.json.gz'))).toString('utf8')); meta = j; pts.push(...E.parseTrace(j).filter(p => upTo == null || p.t <= upTo)); }
  pts.sort((a, b) => a.t - b.t);
  return { pts: pts.filter((p, i) => !i || p.t > pts[i - 1].t), meta, snaps };
}
async function score(dataDir, outDir, specs) {
  const P = JSON.parse(fs.readFileSync(path.join(outDir, 'pick.json'), 'utf8'));
  const engines = specs.map(s => { const [name, spec] = s.split('='); return Object.assign({ name }, engineFrom(spec, dataDir)); });
  const truthE = engines.find(e => !e.wx).E;
  const res = engines.map(() => ({})), rows = [];
  const add = (k, i, hit, p) => { const s = res[i][k] = res[i][k] || { n: 0, hit: 0, sp: 0 }; s.n++; s.hit += hit; s.sp += p; };
  for (const a of P.list) {
    const dir = path.join(outDir, a.hex); if (!fs.existsSync(dir)) continue;
    // the truth: where the flight that was in the air at the pick ended (latest snapshot)
    const full = pointsOf(truthE, dir, null); if (!full.meta) continue;
    const ac0 = { hex: a.hex, type: String(full.meta.t || a.type || '').toUpperCase(), reg: String(full.meta.r || a.reg || '').toUpperCase(), mil: !!((full.meta.dbFlags || 0) & 1), ladd: !!((full.meta.dbFlags || 0) & 8) || a.src === 'LADD', pia: !!((full.meta.dbFlags || 0) & 4), desc: full.meta.desc || '', ownOp: full.meta.ownOp || '', year: full.meta.year || '' };
    const cls0 = truthE.classify(ac0), legs = truthE.legsFromPoints(full.pts, { heli: cls0 === 'heli', patrol: cls0 === 'fighter' || cls0 === 'milheavy' });
    const leg = legs.find(l => l.start.t <= P.at + 300 && (l.ended ? l.end.t >= P.at : true) && l.pts.length); if (!leg || !leg.ended) continue;
    const s = truthE.summarizeLeg(leg, null); if (!s.to || !['ground', 'low'].includes(s.to.conf)) continue;
    const D = truthE.byId(s.to.id); if (!D) continue;
    for (const snapT of full.snaps) {
      if (snapT > s.tEnd - 120 || snapT < s.tStart + 180) continue;
      const togo = (s.tEnd - snapT) / 60;
      const row = { hex: a.hex, reg: ac0.reg, type: ac0.type, src: a.src, cls: cls0, truth: D.code, t: snapT, togo: Math.round(togo), p: {} };
      for (let i = 0; i < engines.length; i++) {
        const { E, wx, name } = engines[i];
        const { pts } = pointsOf(E, dir, snapT), cls = E.classify(ac0);
        const lg = E.legsFromPoints(pts, { heli: cls === 'heli', patrol: cls === 'fighter' || cls === 'milheavy' }), cur = lg[lg.length - 1]; if (!cur || cur.ended || Math.abs(cur.start.t - leg.start.t) > 900) continue;
        const sums = lg.map(l => E.summarizeLeg(l, null)), chained = E.chainLegs(E.stitchLegs(sums.slice(0, -1).map(x => Object.assign({}, x))));
        const hs = E.histStats(chained.filter(h => h.tEnd < cur.start.t - 60), cur.start.t);
        const all = [cur.start].concat(cur.pts), pos = all[all.length - 1], thin = []; for (const p of all) if (!thin.length || p.t - thin[thin.length - 1].t >= 20) thin.push(p);
        if (pos.gnd) continue;
        const ac = Object.assign({ cs: pos.cs || '' }, ac0);
        let r = E.predict({ ac, pos, trail: thin, hs, now: pos.t });
        if (wx && r && r.cands.length) { const W = await wxFor(outDir, snapT, r.cands.slice(0, 5).map(c => String(c.airport.icao || '').toUpperCase())); r = E.predict({ ac, pos, trail: thin, hs, now: pos.t, wx: W }); }
        const top = r && r.cands[0]; if (!top) continue;
        const near = x => x.id === D.id || E.dist(x.lat, x.lon, D.lat, D.lon) < 4, hit = near(top.airport) ? 1 : 0;
        const pc = E.calibrated ? E.calibrated(top.p, cls) : top.p;
        row.p[name] = [top.airport.code, Math.round(top.p * 100), hit];
        add('ALL', i, hit, pc); add('cls ' + cls0, i, hit, pc); add('src ' + a.src, i, hit, pc); if (ac0.ladd) add('LADD', i, hit, pc);
        add('togo ' + (togo < 30 ? 'a <30' : togo < 90 ? 'b 30-90' : 'c 90+'), i, hit, pc);
      }
      rows.push(row);
    }
  }
  fs.writeFileSync(path.join(outDir, 'scored.json'), JSON.stringify(rows));
  const keys = [...new Set(res.flatMap(r => Object.keys(r)))].sort();
  console.log(`${new Set(rows.map(r => r.hex)).size} landed flights, ${rows.length} moments (snapshots while airborne)`);
  console.log('bucket'.padEnd(22) + engines.map(e => e.name.padStart(18)).join(''));
  for (const k of keys) console.log(k.padEnd(22) + res.map(r => r[k] ? `${String(r[k].n).padStart(5)} ${(100 * r[k].hit / r[k].n).toFixed(1).padStart(5)}% p${Math.round(100 * r[k].sp / r[k].n)}`.padStart(18) : ''.padStart(18)).join(''));
}

// the weather each snapshot would have seen: the dev engine's five likeliest fields, asked right after the snapshot
async function prefetchWx(dataDir, outDir, spec) {
  const P = JSON.parse(fs.readFileSync(path.join(outDir, 'pick.json'), 'utf8')), { E } = engineFrom(spec, dataDir), byT = new Map();
  for (const a of P.list) {
    const dir = path.join(outDir, a.hex); if (!fs.existsSync(dir)) continue;
    const { pts, meta, snaps } = pointsOf(E, dir, null), snapT = snaps[snaps.length - 1]; if (!meta || !snapT || Date.now() / 1000 - snapT > 1800) continue;
    const ac = { hex: a.hex, type: String(meta.t || a.type || '').toUpperCase(), reg: String(meta.r || a.reg || '').toUpperCase(), mil: !!((meta.dbFlags || 0) & 1), ladd: !!((meta.dbFlags || 0) & 8) || a.src === 'LADD' }, cls = E.classify(ac);
    const lg = E.legsFromPoints(pts, { heli: cls === 'heli', patrol: cls === 'fighter' || cls === 'milheavy' }), cur = lg[lg.length - 1]; if (!cur || cur.ended) continue;
    const sums = lg.map(l => E.summarizeLeg(l, null)), chained = E.chainLegs(E.stitchLegs(sums.slice(0, -1).map(x => Object.assign({}, x)))), hs = E.histStats(chained.filter(h => h.tEnd < cur.start.t - 60), cur.start.t);
    const all = [cur.start].concat(cur.pts), pos = all[all.length - 1], thin = []; for (const p of all) if (!thin.length || p.t - thin[thin.length - 1].t >= 20) thin.push(p);
    const r = E.predict({ ac, pos, trail: thin, hs, now: pos.t }); if (!r) continue;
    const l = byT.get(snapT) || byT.set(snapT, []).get(snapT); l.push(...r.cands.slice(0, 5).map(c => String(c.airport.icao || '').toUpperCase()));
  }
  let n = 0; for (const [t, ids] of byT) { const m = await wxFor(outDir, t, ids); n += m.size; }
  console.log('weather: ' + n + ' METARs kept for ' + byT.size + ' snapshot time(s)');
}

(async () => {
  if (mode === 'pick') await pick(rest[0], rest[1]);
  else if (mode === 'snap') await snap(rest[0]);
  else if (mode === 'loop') { const [dataDir, outDir, rounds, mins, spec] = rest; for (let i = 0; i < +rounds; i++) { const f = await snap(outDir); try { await prefetchWx(dataDir, outDir, spec); } catch (e) { console.log('weather', e.message); } if (!f) break; if (i + 1 < +rounds) await sleep(+mins * 60000); } console.log('loop done'); }
  else if (mode === 'score') await score(rest[0], rest[1], rest.slice(2));
  else console.log('modes: pick | snap | loop | score');
})();
