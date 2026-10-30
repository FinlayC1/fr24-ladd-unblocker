// Live accuracy (1.1.0): every answer central calculation gives a flight is noted - one each five minutes, and every time
// its destination changes - and once the flight is down (its answer says where it landed, or the monitor's own log has the
// flight ending at an airport) each one is scored against where it really went. Live figures in /status (right, by kind
// of aircraft and by how long before the landing), and each finished flight kept for good with its track and every answer
// given for it: training data from exactly the flights the browsers look at - STORE/scores/YYYY-MM-DD.jsonl (a day older
// than two gzipped: .jsonl.gz). One line a flight:
//   { id, hex, reg, type, grp, kind, t0, t1, origin, actual, how, preds: [[t, destId, p, conf, phase]], trail: [[t, lat, lon, alt]] }
const fs = require('fs'), path = require('path'), zlib = require('zlib');
const fin = v => typeof v === 'number' && isFinite(v);
const dayOf = t => new Date(t * 1000).toISOString().slice(0, 10);
// (minutes before the landing a noted answer was given: the buckets the figures are kept in)
const TOGO = [[15, '<15m'], [45, '15-45m'], [120, '45m-2h'], [Infinity, '2h+']];
const togo = m => TOGO.find(b => m < b[0])[1];

function createScores(env) {
  const dir = path.join(env.store, 'scores'), E = env.E, log = env.log || (() => {});
  const C = Object.assign({ every: 300, quietMin: 45, giveUpH: 8, maxOpen: 20000, maxPreds: 120, maxTrail: 720 }, env.cfg || {});
  const open = new Map();   // FR24 id -> the flight being followed (below)
  const S = { noted: 0, flights: 0, scored: 0, unresolved: 0, written: 0, err: '', days: {} };
  // (the figures of a day: moments - each noted answer - right, by kind of aircraft and time to go; flights - the answer
  // half an hour before landing - right)
  const dayStat = d => S.days[d] || (S.days[d] = { moments: 0, right: 0, flights: 0, flightsRight: 0, grp: {}, togo: {} });
  const sure = e => !!e && (e.conf === 'ground' || e.conf === 'low');
  // One answer of central calculation for a flight (F: central's own record of it; r: the answer)
  function note(F, r, nowS) {
    // (an id of 2,000,000,000 and over is a browser's own for an aircraft - its log page, a watched one: hexCalcId - the
    // same flight as its FR24 id; scored once, under that)
    if (!F || !r || !(F.id > 0) || F.id >= 2e9) return;
    nowS = nowS || Date.now() / 1000;
    let x = open.get(F.id);
    if (!x) {
      if (r.landed || r.onGround || open.size >= C.maxOpen) return;
      const ac = { hex: F.hex, type: (F.rec && F.rec.type) || '', reg: (F.rec && F.rec.reg) || '' };
      x = { id: F.id, hex: F.hex || '', reg: ac.reg, type: ac.type, grp: E ? E.groupOf(E.classify(ac)) : '', kind: F.kind, t0: F.trail.length ? F.trail[0].t : nowS, t1: nowS, origin: 0, preds: [], F };
      open.set(F.id, x); S.flights++;
    }
    x.t1 = nowS; x.F = F; if (r.originId) x.origin = r.originId;
    if (r.landed && r.destId) { finish(x, r.destId, 'landed', r.ata || nowS); return; }
    if (r.onGround || !r.destId) return;
    const last = x.preds[x.preds.length - 1];
    if (!last || last[1] !== r.destId || nowS - last[0] >= C.every) {
      x.preds.push([Math.round(nowS), r.destId, Math.round(r.destP || 0), r.destConf || '', r.phase || '']); S.noted++;
      if (x.preds.length > C.maxPreds) x.preds.splice(1, x.preds.length - C.maxPreds);
    }
  }
  // (a finished flight into the day's figures: each noted answer against where it went; the flight's own answer - the last
  // given half an hour or more before it landed, else its first)
  function score(preds, grp, actual, ata) {
    const d = dayStat(dayOf(ata));
    for (const p of preds) {
      if (p[0] > ata) continue;
      const ok = p[1] === actual, g = d.grp[grp || '?'] || (d.grp[grp || '?'] = [0, 0]), b = togo((ata - p[0]) / 60), tg = d.togo[b] || (d.togo[b] = [0, 0]);
      d.moments++; g[0]++; tg[0]++; if (ok) { d.right++; g[1]++; tg[1]++; }
    }
    const before = preds.filter(p => ata - p[0] >= 1800), pick = before.length ? before[before.length - 1] : preds[0];
    d.flights++; if (pick && pick[1] === actual) d.flightsRight++;
  }
  // Scored, and written to the day's file (ata: when it landed)
  function finish(x, actual, how, ata) {
    open.delete(x.id);
    if (!x.preds.length) return;
    score(x.preds, x.grp, actual, ata);
    S.scored++;
    const tr = []; for (const p of (x.F && x.F.trail) || []) if (!tr.length || p.t - tr[tr.length - 1][0] >= 60) tr.push([Math.round(p.t), +p.lat.toFixed(4), +p.lon.toFixed(4), fin(p.alt) ? Math.round(p.alt) : null]);
    const row = { id: x.id, hex: x.hex, reg: x.reg, type: x.type, grp: x.grp, kind: x.kind, t0: Math.round(x.t0), t1: Math.round(ata), origin: x.origin, actual, how, preds: x.preds, trail: tr.slice(-C.maxTrail) };
    if (env.room && !env.room()) return;
    try { fs.mkdirSync(dir, { recursive: true }); fs.appendFileSync(path.join(dir, dayOf(ata) + '.jsonl'), JSON.stringify(row) + '\n'); S.written++; }
    catch (e) { S.err = String(e && e.message || e).slice(0, 120); }
  }
  // Every few minutes: a flight not heard of for three quarters of an hour, looked for in the monitor's own log - its flight
  // ending at an airport (on its runway or low over it) is where it went; given up after eight hours. Old days gzipped.
  function sweep(nowS) {
    nowS = nowS || Date.now() / 1000;
    for (const x of [...open.values()]) {
      if (nowS - x.t1 < C.quietMin * 60) continue;
      let legs = []; try { legs = x.hex && env.logOf ? env.logOf(x.hex) || [] : []; } catch (e) { legs = []; }
      const l = legs.find(q => q && sure(q.to) && (q.tEnd || 0) >= x.t1 - 1800 && (q.tStart || 0) <= x.t1 + 600 && (q.tOn || q.tEnd) >= x.t0);
      if (l) { finish(x, l.to.id, 'log', l.tOn || l.tEnd); continue; }
      if (nowS - x.t1 > C.giveUpH * 3600) { open.delete(x.id); S.unresolved++; }
    }
    // (the figures: a fortnight kept)
    for (const d of Object.keys(S.days)) if (d < dayOf(nowS - 14 * 86400)) delete S.days[d];
    let names = []; try { names = fs.readdirSync(dir); } catch (e) { names = []; }
    for (const f of names) {
      const m = /^(\d{4}-\d\d-\d\d)\.jsonl$/.exec(f); if (!m || m[1] >= dayOf(nowS - 2 * 86400)) continue;
      try { const p = path.join(dir, f); fs.writeFileSync(p + '.gz.tmp', zlib.gzipSync(fs.readFileSync(p), { level: 6 })); fs.renameSync(p + '.gz.tmp', p + '.gz'); fs.unlinkSync(p); } catch (e) { S.err = String(e && e.message || e).slice(0, 120); }
    }
  }
  // (the figures for /status: the last seven days together, and each day's)
  function summary(nowS) {
    nowS = nowS || Date.now() / 1000;
    const t = { moments: 0, right: 0, flights: 0, flightsRight: 0, grp: {}, togo: {} }, from = dayOf(nowS - 6 * 86400);
    for (const [d, x] of Object.entries(S.days)) {
      if (d < from) continue;
      for (const k of ['moments', 'right', 'flights', 'flightsRight']) t[k] += x[k];
      for (const k of ['grp', 'togo']) for (const [g, v] of Object.entries(x[k])) { const a = t[k][g] || (t[k][g] = [0, 0]); a[0] += v[0]; a[1] += v[1]; }
    }
    const pct = (a, b) => b ? Math.round(1000 * a / b) / 10 : null;
    return { following: open.size, noted: S.noted, scored: S.scored, unresolved: S.unresolved, written: S.written, err: S.err,
      week: { moments: t.moments, rightPct: pct(t.right, t.moments), flights: t.flights, flightRightPct: pct(t.flightsRight, t.flights),
        byKind: Object.fromEntries(Object.entries(t.grp).map(([g, v]) => [g, { n: v[0], rightPct: pct(v[1], v[0]) }])),
        byTimeToGo: Object.fromEntries(TOGO.map(b => b[1]).filter(k => t.togo[k]).map(k => [k, { n: t.togo[k][0], rightPct: pct(t.togo[k][1], t.togo[k][0]) }])) } };
  }
  // At start: the last week's figures from its files
  function load(nowS) {
    nowS = nowS || Date.now() / 1000; let n = 0;
    for (let k = 0; k < 7; k++) {
      const d = dayOf(nowS - k * 86400), plain = path.join(dir, d + '.jsonl'); let txt = '';
      try { txt = fs.existsSync(plain) ? fs.readFileSync(plain, 'utf8') : zlib.gunzipSync(fs.readFileSync(plain + '.gz')).toString('utf8'); } catch (e) { continue; }
      for (const line of txt.split('\n')) { if (!line) continue; try { const r = JSON.parse(line); if (Array.isArray(r.preds) && r.actual) { score(r.preds, r.grp, r.actual, r.t1); n++; } } catch (e) { /* a broken line */ } }
    }
    return n;
  }
  return { note, sweep, summary, finish, load, open, stats: S };
}

module.exports = { createScores };
