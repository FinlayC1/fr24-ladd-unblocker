// monitor/wx.cjs: the figures public ADS-B lacks outside Europe, from a weather model - the standard atmosphere and the
// airspeed formulas; an estimate from a cell (east- and westbound, between levels); nothing for an aircraft on the ground,
// slow or low, or with its own airspeed; a cell asked for once it is needed; Open-Meteo's limits kept (a minute's, an
// hour's, a day's weighted calls) and its refusal pausing an hour; a cell answered without levels let go for a while.
// usage: node test/unit_wx.cjs
const { createWx, pressureAt, casOf, LEVELS } = require('../monitor/wx.cjs');
let fails = 0;
const check = (name, ok, info) => { if (!ok) fails++; console.log((ok ? 'PASS  ' : 'FAIL  ') + name + (info !== undefined ? '  ' + JSON.stringify(info) : '')); };
const near = (a, b, tol) => Math.abs(a - b) <= tol;
// one location's answer: the same wind (from wd, at ws kt) and temperature (C) on every level, one hour
const answer = (t, wd, ws, T) => { const h = { time: [t] }; for (const p of LEVELS) { h[`temperature_${p}hPa`] = [T]; h[`wind_speed_${p}hPa`] = [ws]; h[`wind_direction_${p}hPa`] = [wd]; } return { hourly: h }; };
// a fake Open-Meteo: one answer per location in the URL (or the status given)
function fakeFetch(opts) {
  const f = async url => {
    f.calls.push(url);
    if (f.status !== 200) return { status: f.status, text: async () => '' };
    const n = new URL(url).searchParams.get('latitude').split(',').length;
    return { status: 200, text: async () => JSON.stringify(Array.from({ length: n }, () => f.body())) };
  };
  f.calls = []; f.status = 200; f.body = () => answer(opts.t, 270, 100, -54);
  return f;
}
(async () => {
  // the standard atmosphere and the airspeed formulas
  check('pressure at FL350 and FL100 (ICAO standard atmosphere)', near(pressureAt(35000), 238.4, 0.5) && near(pressureAt(10000), 696.8, 0.5) && near(pressureAt(0), 1013.25, 0.01), [pressureAt(35000), pressureAt(10000)]);
  check('calibrated airspeed: equal to the true airspeed at sea level, ISA', near(casOf(250, 1013.25, 288.15), 250, 0.5), casOf(250, 1013.25, 288.15));
  check('calibrated airspeed at FL350, TAS 460 kt, ISA: about 271 kt', near(casOf(460, pressureAt(35000), 218.85), 271, 1.5), casOf(460, pressureAt(35000), 218.85));

  const nowS = 1.76e9, f = fakeFetch({ t: nowS });
  const wx = createWx({ fetch: f, gapMs: 1 });
  const jet = { hex: 'a00001', alt_baro: 35000, gs: 560, track: 90, lat: 40.2, lon: -99.6 };
  check('a cell not in yet: the row as it was, the cell asked for', wx.fill(jet, nowS) === jet && wx.want.has(wx.keyOf(40.2, -99.6)), [...wx.want.keys()]);
  const n = await wx.pump(Date.now());
  check('... one request brings it in', n === 1 && f.calls.length === 1 && wx.cells.size === 1 && !wx.want.size, { n, calls: f.calls.length });
  const e = wx.fill(jet, nowS);
  check('eastbound, a 100 kt tailwind: TAS 460, Mach 0.80, IAS 271, wind 270/100, -54 C, marked', e.tas === 460 && near(e.mach, 0.797, 0.002) && near(e.ias, 271, 1) && e.wd === 270 && e.ws === 100 && e.oat === -54 && e.wx === 1, e);
  const w = wx.fill(Object.assign({}, jet, { gs: 360, track: 270 }), nowS);
  check('westbound, the same wind ahead: the same TAS', w.tas === 460 && near(w.mach, 0.797, 0.002), w);
  const x = wx.fill(Object.assign({}, jet, { gs: 460, track: 0 }), nowS);
  check('northbound, a crosswind: TAS from both components', near(x.tas, Math.hypot(460, 100), 1), x);
  const mid = wx.fill(Object.assign({}, jet, { alt_baro: 24000 }), nowS);
  check('between two levels: the same wind and temperature (both levels alike)', mid.ws === 100 && mid.oat === -54, mid);
  const own = Object.assign({}, jet, { tas: 470 }), gnd = Object.assign({}, jet, { alt_baro: 'ground' }), low = Object.assign({}, jet, { alt_baro: 3000 }), slow = Object.assign({}, jet, { gs: 80 });
  check('nothing for an aircraft with its own airspeed, on the ground, below FL050 or slow', [own, gnd, low, slow].every(a => wx.fill(a, nowS) === a));
  check('nothing from an hour more than three hours off', wx.fill(jet, nowS + 4 * 3600) === jet);

  // the limits: 20 cells a request by default, 3 weighted calls a cell (27 variables)
  check('a cell counts as three calls (27 variables)', wx.weight(1) === 3 && wx.weight(20) === 60);
  {
    const f2 = fakeFetch({ t: nowS }), wx2 = createWx({ fetch: f2, gapMs: 1 });
    for (let i = 0; i < 400; i++) wx2.at(-80 + (i % 33) * 5, -175 + Math.floor(i / 33) * 5, 300, nowS);
    const t0 = Date.now(); let k = 0;
    for (let i = 0; i < 30; i++) { await wx2.pump(t0 + i * 2000); k++; }
    const sentW = f2.calls.length * 60;
    check('the minute\'s limit kept: at most 450 weighted calls in a minute (7 requests of 20 cells)', f2.calls.length === 7 && sentW <= 450 && wx2.stats.held > 0, { requests: f2.calls.length, held: wx2.stats.held, pumps: k });
    const before = f2.calls.length;
    await wx2.pump(t0 + 61000);
    check('... and a minute later, on again', f2.calls.length === before + 1, f2.calls.length);
  }
  {
    const f3 = fakeFetch({ t: nowS }), wx3 = createWx({ fetch: f3, gapMs: 1, minCap: 1e9, hourCap: 120 });
    for (let i = 0; i < 100; i++) wx3.at(-80 + (i % 33) * 5, -175 + Math.floor(i / 33) * 5, 300, nowS);
    const t0 = Date.now();
    for (let i = 0; i < 5; i++) await wx3.pump(t0 + i * 10);
    check('the hour\'s limit kept', f3.calls.length === 2, f3.calls.length);
    await wx3.pump(t0 + 3601e3);
    check('... an hour on, on again', f3.calls.length === 3, f3.calls.length);
  }
  {
    const f4 = fakeFetch({ t: nowS }), wx4 = createWx({ fetch: f4, gapMs: 1, minCap: 1e9, hourCap: 1e9, dayCap: 100 });
    for (let i = 0; i < 100; i++) wx4.at(-80 + (i % 33) * 5, -175 + Math.floor(i / 33) * 5, 300, nowS);
    const t0 = Date.parse('2026-10-14T10:00:00Z');
    for (let i = 0; i < 4; i++) await wx4.pump(t0 + i * 10);
    check('the day\'s limit kept', f4.calls.length === 1 && wx4.stats.used === 60, { calls: f4.calls.length, used: wx4.stats.used });
    await wx4.pump(Date.parse('2026-10-15T00:00:05Z'));
    check('... the next day, on again', f4.calls.length === 2, f4.calls.length);
  }
  {
    const f5 = fakeFetch({ t: nowS }), wx5 = createWx({ fetch: f5, gapMs: 1 });
    wx5.at(40, -100, 300, nowS); f5.status = 429;
    const t0 = Date.now();
    await wx5.pump(t0);
    check('a refusal (429): counted as a failure, the cell still wanted', wx5.stats.fails === 1 && /429/.test(wx5.stats.lastErr) && wx5.want.size === 1, wx5.stats);
    f5.status = 200;
    await wx5.pump(t0 + 600e3);
    check('... nothing asked for the next hour', f5.calls.length === 1, f5.calls.length);
    await wx5.pump(t0 + 3601e3);
    check('... then asked again', f5.calls.length === 2 && wx5.cells.size === 1, f5.calls.length);
  }
  {
    const f6 = fakeFetch({ t: nowS }), wx6 = createWx({ fetch: f6, gapMs: 1 });
    f6.body = () => ({ hourly: { time: [nowS] } });
    wx6.at(40, -100, 300, nowS);
    const t0 = Date.now();
    await wx6.pump(t0);
    check('a cell answered without levels: let go, not asked again at once', wx6.stats.bad === 1 && !wx6.want.size && wx6.bad.size === 1, wx6.stats);
    wx6.at(40, -100, 300, nowS); wx6.at(45, -100, 300, nowS);
    await wx6.pump(t0 + 10e3);
    check('... the next request without it', f6.calls.length === 2 && new URL(f6.calls[1]).searchParams.get('latitude') === '45', f6.calls[1]);
    f6.body = () => answer(nowS, 270, 100, -54);
    wx6.at(40, -100, 300, nowS);
    await wx6.pump(t0 + 3700e3);
    check('... asked again an hour on', f6.calls.length === 3 && wx6.cells.has(wx6.keyOf(40, -100)), f6.calls.length);
  }
  console.log(fails ? `\n${fails} failed` : '\nall passed');
  process.exit(fails ? 1 : 0);
})();
