// Unit test of the page-world patch for FR24's FlightDetails (search card) and FollowFlight (panel) messages, on a real
// FlightDetails response captured from flightradar24.com (Ryanair FR4758, EI-HAY).
// usage: node test/unit_flightmsg.cjs <node_modules dir>
const fs = require('fs');
const path = require('path');
const { JSDOM } = require(path.join(process.argv[2], 'jsdom'));
const SRC = fs.readFileSync(path.join(__dirname, '..', 'dist', 'fr24-ladd-unblocker.user.js'), 'utf8');
const REAL = 'AAAAA+EK/QUIqtOyAhIGRUktSEFZIgRCMzhNKAAyFEJvZWluZyA3MzcgTUFYIDgtMjAwQABa7QEKKGh0dHBzOi8vd3d3LmpldHBob3Rvcy5jb20vcGhvdG8vMTIwNzUyOTASFlBhYmxvIEdvbnphbGV6IGRlIExlb24aOWh0dHBzOi8vY2RuLmpldHBob3Rvcy5jb20vMjAwLzYvMTEzOTc1OF8xNzc2MjAyODgwX3RiLmpwZyI2aHR0cHM6Ly9jZG4uamV0cGhvdG9zLmNvbS80MDAvNi8xMTM5NzU4XzE3NzYyMDI4ODAuanBnKjZodHRwczovL2Nkbi5qZXRwaG90b3MuY29tLzY0MC82LzExMzk3NThfMTc3NjIwMjg4MC5qcGda5QEKKGh0dHBzOi8vd3d3LmpldHBob3Rvcy5jb20vcGhvdG8vMTIwMzU5MjMSDkFsYmVydG8gQ3VjaW5pGjlodHRwczovL2Nkbi5qZXRwaG90b3MuY29tLzIwMC82LzE1NzQwMDZfMTc3Mjc5MzU2M190Yi5qcGciNmh0dHBzOi8vY2RuLmpldHBob3Rvcy5jb20vNDAwLzYvMTU3NDAwNl8xNzcyNzkzNTYzLmpwZyo2aHR0cHM6Ly9jZG4uamV0cGhvdG9zLmNvbS82NDAvNi8xNTc0MDA2XzE3NzI3OTM1NjMuanBnWuUBCihodHRwczovL3d3dy5qZXRwaG90b3MuY29tL3Bob3RvLzEyMDkyMzU4Eg5EZSBHdWlkaSBPc2Nhcho5aHR0cHM6Ly9jZG4uamV0cGhvdG9zLmNvbS8yMDAvNi8xMjg5NTIxXzE3Nzc3MDI1MzhfdGIuanBnIjZodHRwczovL2Nkbi5qZXRwaG90b3MuY29tLzQwMC82LzEyODk1MjFfMTc3NzcwMjUzOC5qcGcqNmh0dHBzOi8vY2RuLmpldHBob3Rvcy5jb20vNjQwLzYvMTI4OTUyMV8xNzc3NzAyNTM4LmpwZ2gBcAF6B1J5YW5haXKAAQESJgoGRlI0NzU4EAYYBiDODyjcAzjcxdDVBkCcttHVBkjB8tDVBnAGGiMI66CjARC0sQgY/VsgzAgoitfR1QYwntKrATizY0AESANQWyJZCNn6tY4EFXAaSUIdXmdlwCASKLS/ATCRAzgAQLj+zIWNNEgAUgdSWVI0NzU4WABiGAgBEAEYASABKAEwATgBQAFIAVgBYAFoAXABgAEBkAEBqAHJms2FjTQ6NwoJCKMDEN8BGNwSCgkIigYQlAMYviIKCQjECRD+BBiONgoJCM8LEIUGGPpBCgkI8A4Q3gcYu1SAAAAAD2dycGMtc3RhdHVzOjANCg==';
let fails = 0;
const check = (name, ok, info) => { if (!ok) fails++; console.log((ok ? 'PASS  ' : 'FAIL  ') + name + (info !== undefined ? '  ' + (typeof info === 'string' ? info : JSON.stringify(info)) : '')); };
const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'https://www.flightradar24.com/', runScripts: 'dangerously' });
const w = dom.window;
let H = null; w.__tlTestHook = h => { H = h; };
const posted = []; w.postMessage = d => posted.push(d);
w.unsafeWindow = w; w.GM_xmlhttpRequest = () => {}; w.fetch = () => Promise.reject(new Error('offline'));
w.indexedDB = undefined;
// only the page-world half is needed: evaluate its function and run it
const m = SRC.match(/function pageInterceptor\(\) \{[\s\S]*?\n {2}\}\n/);
if (!m) { console.log('FAIL  pageInterceptor not found in the build'); process.exit(1); }
w.eval('(' + m[0] + ')()');
check('page-world test hook', !!(H && H.patchFlightMsg && H.DETAILS));
const B = w.__tweeksLaddBridge;

// frame body of the real response
const raw = Buffer.from(REAL, 'base64'); const len = raw.readUInt32BE(1); const realBody = new Uint8Array(raw.subarray(5, 5 + len));
const dec = new TextDecoder();
const fields = (b, fn) => H.parse(b).filter(f => f.fn === fn);
const one = (b, fn) => fields(b, fn)[0];
const str = (b, fn) => { const f = one(b, fn); return f ? dec.decode(f.val) : ''; };
const num = (b, fn) => { const f = one(b, fn); return f ? f.val : undefined; };
const efiReal = one(realBody, 4).val, fid = num(efiReal, 1);
check('real FlightDetails parsed (id, reg, callsign)', fid === 1103986009 && str(one(realBody, 1).val, 2) === 'EI-HAY' && str(efiReal, 10) === 'RYR4758', { fid });

// 1) a blocked flight as FR24 serves it: no registration/callsign/schedule, only the sideview-less aircraft stub
const cat = parts => { const n = parts.reduce((s, p) => s + p.length, 0), o = new Uint8Array(n); let k = 0; for (const p of parts) { o.set(p, k); k += p.length; } return o; };
const aiStub = cat(fields(one(realBody, 1).val, 5).map(f => f.raw).concat(fields(one(realBody, 1).val, 8).map(f => f.raw)));
const efiBlocked = cat(H.parse(efiReal).filter(f => f.fn !== 10).map(f => f.raw));
const blocked = cat([H.fLen(1, aiStub), H.fLen(4, efiBlocked)]);
const id = fid;
B.resolved.set(id, { cs: 'LSA602', reg: 'I-WATT', hex: '300a26', type: 'GA6C', desc: 'Gulfstream G600', hexNum: 0x300a26, msn: '73012', owner: 'LSA', operatorId: 1943, age: 3, countryId: 104, squawk: 0o1234, photos: [{ link: 'https://example.org/p', credit: 'X', large: 'https://example.org/l.jpg' }] });
B.routes.set(id, { originId: 100, destId: 200, originIata: 'MXP', destIata: 'OTP', atd: 1790190000, eta: 1790200000, progress: { traversed: 500000, remaining: 700000, elapsed: 3600, remainingTime: 3000, eta: 1790200000, greatCircle: 1200000, stage: 3, pct: 42 } });
B.telem.set(id, { at: Date.now(), vr: -1536, sq: 0o4521, agps: 34500, ias: 280, tas: 450, mach: 0.78, oat: -40, wd: 270, ws: 60 });
const outD = H.patchFlightMsg(blocked, { id }, H.DETAILS);
const ai = one(outD, 1).val, sch = one(outD, 2), prg = one(outD, 3), efi = one(outD, 4).val;
check('search card: registration, type, description, owner', str(ai, 2) === 'I-WATT' && str(ai, 6) === 'Gulfstream G600' && str(ai, 15) === 'LSA', { reg: str(ai, 2), desc: str(ai, 6) });
check('search card: photo supplied', fields(ai, 11).length >= 1);
check('search card: schedule (flight, operator, origin, destination, departed)', !!sch && str(sch.val, 1) === 'LSA602' && num(sch.val, 2) === 1943 && num(sch.val, 4) === 100 && num(sch.val, 5) === 200 && num(sch.val, 9) === 1790190000, sch && H.parse(sch.val).map(f => f.fn));
check('search card: no invented scheduled times', !!sch && num(sch.val, 7) === undefined && num(sch.val, 8) === undefined);
check('search card: progress / ETA', !!prg && num(prg.val, 10) === 42 && num(prg.val, 5) === 1790200000);
check('search card: callsign', str(efi, 10) === 'LSA602');
check('search card: squawk as FR24 prints it (hex digits of the code)', num(efi, 15) === 0x4521, (num(efi, 15) || 0).toString(16));
check('no position/follow messages from a search card', !posted.some(p => p && (p.__tweeksLadd === 'pos' || p.__tweeksLadd === 'follow')));

// 2) an ordinary flight opened in the panel: identity reported, public telemetry unlocks the padlocked EFI fields
B.resolved.clear(); B.routes.clear(); B.telem.clear(); posted.length = 0;
const followBody = cat([H.fLen(1, one(realBody, 1).val), H.fLen(5, efiReal)]);
const out0 = H.patchFlightMsg(followBody, { id }, H.FOLLOW);
const info = posted.find(p => p && p.__tweeksLadd === 'aircraftInfo');
check('ordinary aircraft: identity reported for public data', !!info && info.hex === '4ca9aa' && info.reg === 'EI-HAY' && info.cs === 'RYR4758', info);
{ const e0 = one(out0, 5).val;
  check('ordinary aircraft without telemetry: FR24\'s padlocks off (figures, squawk, airspace) and nothing made up - the vertical speed\'s kept while nothing tells it', !one(e0, 12) && !one(e0, 14) && !one(e0, 18) && !!one(e0, 16) && !one(e0, 13) && num(e0, 15) === undefined && num(e0, 17) === undefined && num(e0, 5) === 24500, H.parse(e0).map(f => f.fn)); }
B.telem.set(id, { at: Date.now(), vr: 1216, sq: 0o2341, agps: 24800, ias: 290, tas: 410, mach: 0.66, oat: -20, wd: 250, ws: 40 });
const out1 = H.patchFlightMsg(followBody, { id }, H.FOLLOW), efi1 = one(out1, 5).val;
check('ordinary aircraft: vertical speed unlocked (value, no availability flag)', num(efi1, 17) === 1216 && !one(efi1, 16), { vs: num(efi1, 17) });
const ems = one(efi1, 13);
check('ordinary aircraft: GPS alt / airspeeds / Mach / wind / temperature unlocked', !!ems && !one(efi1, 12) && num(ems.val, 8) === 24800 && num(ems.val, 5) === 290 && num(ems.val, 7) === 660, ems && H.parse(ems.val).map(f => f.fn + '=' + f.val));
check('ordinary aircraft: FR24 data kept (registration, callsign, photos)', str(one(out1, 1).val, 2) === 'EI-HAY' && str(efi1, 10) === 'RYR4758' && fields(one(out1, 1).val, 11).length === 3);
// 2b) what FR24 itself knows of an ordinary flight's route is reported (its own ids, before anything is added), and a
//     reasoned route only ever fills what FR24 left empty
{
  B.telem.clear(); B.routes.clear(); posted.length = 0;
  const schedReal = one(realBody, 2).val;
  const withSched = cat([H.fLen(1, one(realBody, 1).val), H.fLen(3, schedReal), H.fLen(5, efiReal)]);
  B.routes.set(id, { originId: 111, destId: 222, originIata: 'AAA', destIata: 'BBB' });
  const outS = H.patchFlightMsg(withSched, { id }, H.FOLLOW), sc = one(outS, 3).val;
  const rep1 = posted.filter(p => p && p.__tweeksLadd === 'sched').pop();
  check('ordinary flight: FR24\'s own departure / arrival reported to the userscript', !!rep1 && rep1.id === id && rep1.o === 1998 && rep1.d === 476, rep1);
  check('ordinary flight with a route: FR24\'s airports never replaced by a reasoned route', fields(sc, 4).length === 1 && num(sc, 4) === 1998 && fields(sc, 5).length === 1 && num(sc, 5) === 476, H.parse(sc).map(f => f.fn + '=' + f.val));
  posted.length = 0;
  const noSched = cat([H.fLen(1, one(realBody, 1).val), H.fLen(5, efiReal)]);
  const outN = H.patchFlightMsg(noSched, { id }, H.FOLLOW), scN = one(outN, 3);
  const rep2 = posted.filter(p => p && p.__tweeksLadd === 'sched').pop();
  check('ordinary flight shown as N/A: reported without airports, the reasoned ones go into FR24\'s frame', !!rep2 && rep2.o === 0 && rep2.d === 0 && !!scN && num(scN.val, 4) === 111 && num(scN.val, 5) === 222, { rep2, sched: scN && H.parse(scN.val).map(f => f.fn + '=' + f.val) });
  // FR24 merges every later frame of the stream into the panel: a frame without the aircraft block (a position update)
  // carries the reasoned route, times and progress too - so a route found after the first frame shows without reopening
  B.routes.set(id, { originId: 111, destId: 222, atd: 1790190000, eta: 1790200000, progress: { traversed: 5e5, remaining: 7e5, elapsed: 3600, remainingTime: 3000, eta: 1790200000, greatCircle: 12e5, stage: 3, pct: 42 } });
  const upd = cat([H.fLen(5, efiReal)]);
  const outU = H.patchFlightMsg(upd, { id }, H.FOLLOW), scU = one(outU, 3), pgU = one(outU, 4);
  check('later frames of the stream carry the reasoned departure time, route and progress (no reopening needed)', !!scU && num(scU.val, 9) === 1790190000 && num(scU.val, 4) === 111 && num(scU.val, 5) === 222 && !!pgU && num(pgU.val, 10) === 42 && !one(outU, 1), { sched: scU && H.parse(scU.val).map(f => f.fn + '=' + f.val), progress: pgU && H.parse(pgU.val).map(f => f.fn + '=' + f.val) });
  B.routes.clear();
}
// 2c) airport-data.com pictures (FR24's fallback): taken out of FR24's own aircraft block - JetPhotos / Planespotters in
//     their place when there are any, otherwise none - and the userscript is asked for them
{
  B.telem.clear(); B.routes.clear(); posted.length = 0;
  const adImg = cat([H.fStr(1, 'https://www.airport-data.com/aircraft/photo/001559952.html'), H.fStr(2, 'airport-data'), H.fStr(3, 'https://image.airport-data.com/aircraft/thumbnails/001559952.jpg'), H.fStr(5, 'https://image.airport-data.com/aircraft/001559952.jpg')]);
  const aiAd = cat([H.fVar(1, 0x406b2c), H.fStr(2, 'G-KLLY'), H.fStr(4, 'AS50'), H.fLen(11, adImg)]);
  const fid2 = 1103986010, efi2 = cat(H.parse(efiReal).filter(f => f.fn !== 1).map(f => f.raw).concat([H.fVar(1, fid2)]));
  const outA = H.patchFlightMsg(cat([H.fLen(1, aiAd), H.fLen(5, efi2)]), { id: fid2 }, H.FOLLOW);
  const imgsA = fields(one(outA, 1).val, 11).map(f => str(f.val, 3));
  const infoA = posted.find(p => p && p.__tweeksLadd === 'aircraftInfo' && p.id === fid2), askA = posted.find(p => p && p.__tweeksLadd === 'needPhotos');
  check('ordinary aircraft: FR24\'s airport-data picture taken out, JetPhotos / Planespotters asked for', imgsA.length === 0 && !!infoA && infoA.adPhotos === true && !!askA && askA.hex === '406b2c', { imgs: imgsA, info: infoA && infoA.adPhotos, ask: askA && askA.hex });
  w.postMessage = d => posted.push(d);
  w.dispatchEvent(new w.MessageEvent('message', { data: { __tweeksLadd: 'photosDone', hex: '406b2c', photos: [{ link: 'https://www.jetphotos.com/photo/1', credit: 'X', large: 'https://cdn.jetphotos.com/640/1.jpg', source: 'JetPhotos' }] }, source: w }));
  const outB = H.patchFlightMsg(cat([H.fLen(1, aiAd), H.fLen(5, efi2)]), { id: fid2 }, H.FOLLOW);
  const imgsB = fields(one(outB, 1).val, 11).map(f => str(f.val, 3));
  check('ordinary aircraft: its JetPhotos picture shown instead of the airport-data one', imgsB.length === 1 && imgsB[0] === 'https://cdn.jetphotos.com/640/1.jpg', imgsB);
  // a blocked aircraft: FR24's airport-data picture is not taken for a real photo (nor kept as FR24's own)
  posted.length = 0;
  B.resolved.set(fid2, { cs: 'GKLLY', reg: 'G-KLLY', hex: '406b2c', hexNum: 0x406b2c, type: 'AS50', photos: [] });
  const outC = H.patchFlightMsg(cat([H.fLen(1, aiAd), H.fLen(5, efi2)]), { id: fid2 }, H.FOLLOW);
  const imgsC = fields(one(outC, 1).val, 11).map(f => str(f.val, 3));
  check('blocked aircraft: FR24\'s airport-data picture dropped, never reported as its own photo', !imgsC.some(u => /airport-data/.test(u)) && !posted.some(p => p && p.__tweeksLadd === 'photos' && (p.photos || []).some(x => /airport-data/.test(x.large))), imgsC);
  // the full slideshow once all its pictures are in: FR24 replaces its picture list with a later frame's aircraft
  // block (tried on the live site), so the next update carries the block again, with every picture
  const three = [1, 2, 3].map(k => ({ link: 'https://www.jetphotos.com/photo/' + k, credit: 'P' + k, large: 'https://cdn.jetphotos.com/640/' + k + '.jpg', source: 'JetPhotos' }));
  w.dispatchEvent(new w.MessageEvent('message', { data: { __tweeksLadd: 'resolve', entries: [{ id: fid2, cs: 'GKLLY', reg: 'G-KLLY', hex: '406b2c', type: 'AS50', photos: three }] }, source: w }));
  const outD = H.patchFlightMsg(cat([H.fLen(5, efi2)]), { id: fid2 }, H.FOLLOW), aiD = one(outD, 1);
  const imgsD = aiD ? fields(aiD.val, 11).map(f => str(f.val, 3)) : [];
  check('pictures arriving after the panel opened: the next update brings the whole slideshow (no reopening)', imgsD.length === 3 && str(aiD.val, 2) === 'G-KLLY' && !!one(outD, 5), imgsD);
  const outE = H.patchFlightMsg(cat([H.fLen(5, efi2)]), { id: fid2 }, H.FOLLOW);
  check('... and only once (later updates stay as FR24 sent them)', !one(outE, 1));
  B.resolved.delete(fid2);
}
// 2e) an ordinary aircraft FR24 has two JetPhotos pictures of: the slideshow is filled to three with a Planespotters one
//     (the JetPhotos ones the userscript found too are not shown twice)
{
  posted.length = 0;
  const jpImg = n => cat([H.fStr(1, 'https://www.jetphotos.com/photo/' + n), H.fStr(2, 'JP' + n), H.fStr(3, 'https://cdn.jetphotos.com/200/5/' + n + '_tb.jpg'), H.fStr(4, 'https://cdn.jetphotos.com/400/5/' + n + '.jpg'), H.fStr(5, 'https://cdn.jetphotos.com/640cb/5/' + n + '.jpg')]);
  const aiTwo = cat([H.fVar(1, 0x43c55e), H.fStr(2, 'M-WJBA'), H.fStr(4, 'C68A'), H.fLen(11, jpImg('476943_1783760161')), H.fLen(11, jpImg('476944_1783760162'))]);
  const fid3 = 1103986123, efi3 = cat(H.parse(efiReal).filter(f => f.fn !== 1).map(f => f.raw).concat([H.fVar(1, fid3)]));
  const outF = H.patchFlightMsg(cat([H.fLen(1, aiTwo), H.fLen(5, efi3)]), { id: fid3 }, H.FOLLOW);
  const askF = posted.find(p => p && p.__tweeksLadd === 'needPhotos' && p.hex === '43c55e');
  check('ordinary aircraft with two FR24 pictures: its other pictures asked for', !!askF && fields(one(outF, 1).val, 11).length === 2, askF);
  w.dispatchEvent(new w.MessageEvent('message', { data: { __tweeksLadd: 'photosDone', hex: '43c55e', photos: [
    { link: 'https://www.jetphotos.com/photo/1', credit: 'JP1', large: 'https://cdn.jetphotos.com/640/5/476943_1783760161.jpg', source: 'JetPhotos' },
    { link: 'https://www.jetphotos.com/photo/2', credit: 'JP2', large: 'https://cdn.jetphotos.com/640/5/476944_1783760162.jpg', source: 'JetPhotos' },
    { link: 'https://www.planespotters.net/photo/9', credit: 'PS', large: 'https://t.plnspttrs.net/1/999_abc_280.jpg', source: 'Planespotters' }] }, source: w }));
  const outG = H.patchFlightMsg(cat([H.fLen(5, efi3)]), { id: fid3 }, H.FOLLOW), aiG = one(outG, 1);
  const imgsG = aiG ? fields(aiG.val, 11).map(f => str(f.val, 3)) : [];
  check('... then the slideshow filled to three: FR24\'s two JetPhotos pictures, then the Planespotters one (none twice)', imgsG.length === 3 && /plnspttrs/.test(imgsG[2]) && imgsG.filter(u => /476943/.test(u)).length === 1, imgsG);
}
// 2d) "Playback" of a blocked flight (panel menu, airport-board card): its ADS-B track on adsb.lol, not FR24's empty one
{
  const opened = []; w.open = u => { opened.push(u); return null; };
  const pid = 1103986077;
  B.resolved.set(pid, { cs: 'VSB82', reg: 'M-ARNZ', hex: '424c60', hexNum: 0x424c60, type: 'PC24', photos: [] });
  B.routes.set(pid, { atd: Math.floor(Date.now() / 1000) - 1800 });
  H.patchFlightMsg(cat([H.fLen(5, cat(H.parse(efiReal).filter(f => f.fn !== 1).map(f => f.raw).concat([H.fVar(1, pid)])))]), { id: pid }, H.FOLLOW);
  w.document.body.insertAdjacentHTML('beforeend', `<div id="pbtest"><button data-testid="aircraft__playback"><span>Playback</span></button><ul><li id="airport_schedule_${9000000000 + pid}"><a href="/data/aircraft/m-arnz#x">Playback</a></li><li id="airport_schedule_5869989311"><span data-testid="airport-flight-details__registration">M-ARNZ</span><a href="/x">Playback</a></li><li id="airport_schedule_5869989312"><span data-testid="airport-flight-details__registration">EI-HAY</span><a id="pbother" href="/y">Playback</a></li></ul></div>`);
  const clk = el => el.dispatchEvent(new w.MouseEvent('click', { bubbles: true, cancelable: true }));
  clk(w.document.querySelector('#pbtest [data-testid="aircraft__playback"] span'));
  const lis = w.document.querySelectorAll('#pbtest li a'); clk(lis[0]); clk(lis[1]); clk(lis[2]);
  check('Playback of a blocked flight (panel menu, board cards) opens its ADS-B track on airplanes.live; other flights keep FR24\'s', opened.length === 3 && opened.every(u => /^https:\/\/globe\.airplanes\.live\/\?icao=424c60&showTrace=\d{4}-\d\d-\d\d&startTime=\d\d:\d\d&endTime=\d\d:\d\d$/.test(u)), opened);
  w.document.getElementById('pbtest').remove(); B.resolved.delete(pid); B.routes.delete(pid);
}
// 3) the LiveFeed record of the selected ordinary flight carries the padlock flags the panel actually uses (captured
//    from UAL444: extra 13 = EMS availability, 16 squawk, 17 vertical speed): with public telemetry they are dropped
{
  const uid = 1104056268;
  const extra = cat([H.fStr(1, 'UA444'), H.fStr(2, 'N73276'), H.fStr(4, 'B738'), H.fLen(13, cat([H.fVar(1, 1), H.fVar(2, 1), H.fVar(8, 1)])), H.fVar(14, 11130341), H.fVar(16, 1), H.fVar(17, 1), H.fVar(18, 1)]);
  const flight = cat([H.fVar(1, uid), H.fVar(5, 25025), H.fStr(11, 'UAL444'), H.fLen(13, extra)]);
  B.telem.clear();
  const same = H.patchFlight(flight, [], true, Date.now());
  { const ex0 = one(same, 13).val;
    check('ordinary LiveFeed record without telemetry: the EMS, squawk and airspace padlocks off, no figure made up (the vertical speed\'s kept: nothing tells it yet)', !one(ex0, 13) && !one(ex0, 16) && !one(ex0, 18) && !!one(ex0, 17) && !one(ex0, 6) && !one(ex0, 12) && !one(ex0, 5) && str(ex0, 2) === 'N73276', H.parse(ex0).map(f => f.fn)); }
  // (FR24's own altitudes, two reports half a minute apart: its vertical speed; then its airspace from the boundaries)
  { const tsN = Math.round(Date.now() / 1000), f32b = (fn, v) => { const b = new Uint8Array(5); b[0] = fn * 8 + 5; new DataView(b.buffer).setFloat32(1, v, true); return b; };
    const at = (alt, ts) => cat([H.fVar(1, uid + 7), f32b(2, 51.5), f32b(3, -0.5), H.fVar(5, alt), H.fVar(9, ts), H.fStr(11, 'UAL445'), H.fLen(13, extra)]);
    H.patchFlight(at(19000, tsN - 30), [], false, Date.now());
    const exV = one(H.patchFlight(at(20000, tsN), [], false, Date.now()), 13).val;
    check('no public report: the vertical speed from FR24\'s own altitudes (+1,000 ft in 30 s = +2,000 fpm), its padlock off', num(exV, 6) === 2000 && !one(exV, 17), H.parse(exV).map(f => f.fn + (f.wt === 0 ? '=' + f.val : '')));
    const asked = H.airWant().slice(); H.flushAir();
    const askMsg = posted.filter(p => p && p.__tweeksLadd === 'airAsk').pop();
    check('... its airspace asked of the userscript (the flights in view with no public report)', asked.some(r => r[0] === uid + 7) && !!askMsg && askMsg.rows.some(r => r[0] === uid + 7), asked);
    w.dispatchEvent(new w.MessageEvent('message', { data: { __tweeksLadd: 'airRows', rows: [[uid + 7, 51.5, -0.5, 20000, 'London', 'EGTT', 0, 245]] }, source: w }));
    const exA = one(H.patchFlight(at(20100, tsN + 10), [], false, Date.now()), 13).val;
    check('... and given: the airspace in the record, its padlock off', str(exA, 11) === 'London' && str(exA, 19) === 'EGTT' && !one(exA, 18), H.parse(exA).map(f => f.fn));
    const exU = one(H.patchFlight(at(30000, tsN + 400), [], false, Date.now()), 13).val;
    check('... not above the band the boundary is for (FL300 in an FIR up to FL245)', str(exU, 11) !== 'London', str(exU, 11));
    // (on the ground: level - a "0" that is true)
    const g = cat([H.fVar(1, uid + 8), H.fVar(5, 0), H.fVar(9, tsN), H.fVar(10, 1), H.fStr(11, 'UAL446'), H.fLen(13, extra)]);
    const exG = one(H.patchFlight(g, [], false, Date.now()), 13).val;
    check('... on the ground: vertical speed 0, no padlock', num(exG, 6) === 0 && !one(exG, 17), H.parse(exG).map(f => f.fn)); }
  B.telem.set(uid, { at: Date.now(), vr: -64, sq: 0o7035, agps: 26125, ias: 280 });
  const out = H.patchFlight(flight, [], true, Date.now()), ex2 = one(out, 13).val;
  check('ordinary LiveFeed record: vertical speed / EMS locks dropped, public values in', !one(ex2, 17) && !one(ex2, 13) && !!one(ex2, 6) && !!one(ex2, 12) && num(one(ex2, 12).val, 8) === 26125, H.parse(ex2).map(f => f.fn));
  check('ordinary LiveFeed record: FR24 identity kept (flight, reg, type, callsign)', str(ex2, 1) === 'UA444' && str(ex2, 2) === 'N73276' && str(ex2, 4) === 'B738' && str(out, 11) === 'UAL444');
  // every aircraft in view: the view poll's telemetry (keyed by callsign / registration) unlocks records nobody opened yet
  B.telem.clear();
  const f32 = (fn, v) => { const b = new Uint8Array(5); b[0] = fn * 8 + 5; new DataView(b.buffer).setFloat32(1, v, true); return b; };
  const placed = (lat, lon) => cat([H.fVar(1, uid), f32(2, lat), f32(3, lon), H.fVar(5, 25025), H.fStr(11, 'UAL444'), H.fLen(13, extra)]);
  H.acceptPubTel([['UAL444', 'N73276', 'a9d0e5', 37.6, -122.4, Date.now() - 4000, -640, '7035', 26125, 280, 450, 0.78, -40, 250, 45, 'Oakland', 'KZOA']]);
  const outP = H.patchFlight(placed(37.7, -122.3), [], false, Date.now()), exP = one(outP, 13).val;
  check('ordinary flight in view, never opened: unlocked from the view poll (vertical speed, EMS, airspace)', num(exP, 6) !== undefined && !one(exP, 17) && !one(exP, 13) && !one(exP, 18) && str(exP, 11) === 'Oakland' && str(exP, 19) === 'KZOA' && num(one(exP, 12).val, 8) === 26125, H.parse(exP).map(f => f.fn));
  check('the matched telemetry is kept for the panel of that flight', !!H.telem.get(uid) && H.telem.get(uid).air === 'Oakland' && H.telem.get(uid).airId === 'KZOA');
  B.telem.clear();
  const outFar = H.patchFlight(placed(51.5, -0.1), [], false, Date.now());
  { const exF = one(outFar, 13).val;
    check('same callsign far from where FR24 draws the flight: not used (no vertical speed, figures or airspace of the other)', !one(exF, 6) && !one(exF, 12) && str(exF, 11) !== 'Oakland' && !one(exF, 13), H.parse(exF).map(f => f.fn)); }
  // the panel of that flight: airspace (FIR/UIR) as text in its extended info
  B.telem.set(id, { at: Date.now(), vr: 500, agps: 30000, air: 'Shannon', airId: 'EISN' });
  const outA = H.patchFlightMsg(followBody, { id }, H.FOLLOW), efiA = one(outA, 5).val;
  check('panel: FIR/UIR supplied (name + ICAO code badge), padlock flag dropped', str(efiA, 19) === 'Shannon' && str(efiA, 20) === 'EISN' && !one(efiA, 18), str(efiA, 19) + ' / ' + str(efiA, 20));
}
// 4) registrations get reused: a registration-matched photo of another manufacturer's aircraft is refused
{
  const ps = slug => ({ link: 'https://www.planespotters.net/photo/1/' + slug + '?utm_source=api' });
  const c172 = H.makerOf({ desc: 'Cessna 172S', type: 'C172' }), gl5 = H.makerOf({ desc: 'Bombardier Global 5000', type: 'GL5T' }), lj = H.makerOf({ desc: '', type: 'LJ60' });
  check('photo of the old American Airlines 737 refused for Cessna N677AA', c172 === 'cessna' && !H.photoFits(ps('n677aa-american-airlines-boeing-737-3a4'), c172));
  check('matching photos kept (Bombardier Global, Learjet under Bombardier, unnamed page)', H.photoFits(ps('n502vj-vista-america-bombardier-global-5000-bd-700-1a11'), gl5) && H.photoFits(ps('n10mb-private-bombardier-learjet-60'), lj) && H.photoFits(ps('n123ab-private'), c172));
  check('a Gulfstream photo refused for a Bombardier', !H.photoFits(ps('n502vj-private-gulfstream-g450'), gl5));
}
// 5) pictures and a route arriving while the panel is open go into FR24's stream at once, as a frame of our own: FR24
//    reads it when told the response has grown (tried on the live site: its store took it 7 ms later) - not at FR24's
//    next update, and never only after reopening the panel
(async () => {
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const frames = s => { const o = []; H.b64DecodeInto(s, o); const b = Uint8Array.from(o), out = []; let p = 0; while (p + 5 <= b.length) { const n = ((b[p + 1] << 24) | (b[p + 2] << 16) | (b[p + 3] << 8) | b[p + 4]) >>> 0; out.push(b.subarray(p + 5, p + 5 + n)); p += 5 + n; } return out; };
  const jp = n => cat([H.fStr(1, 'https://www.jetphotos.com/photo/' + n), H.fStr(2, 'JP' + n), H.fStr(3, 'https://cdn.jetphotos.com/200/5/' + n + '_tb.jpg')]);
  const fid4 = 1103986333, efi4 = cat(H.parse(efiReal).filter(f => f.fn !== 1).map(f => f.raw).concat([H.fVar(1, fid4)]));
  const sched4 = cat([H.fVar(4, 1939)]);
  const events = [], st = { id: fid4, out: '', xhr: { readyState: 3, dispatchEvent: e => { events.push(e.type); return true; } } };
  H.setFollowSt(st);
  const ai4 = cat([H.fVar(1, 0x4ca5d1), H.fStr(2, 'EI-FRA'), H.fStr(4, 'C68A'), H.fLen(11, jp('600001_1'))]);
  H.patchFlightMsg(cat([H.fLen(1, ai4), H.fLen(3, sched4), H.fLen(5, efi4)]), st, H.FOLLOW);     // FR24's first frame
  posted.length = 0;
  w.dispatchEvent(new w.MessageEvent('message', { data: { __tweeksLadd: 'photosDone', hex: '4ca5d1', photos: [
    { link: 'https://www.jetphotos.com/photo/1', credit: 'JP1', large: 'https://cdn.jetphotos.com/640/5/600001_1.jpg', source: 'JetPhotos' },
    { link: 'https://www.planespotters.net/photo/7', credit: 'PS7', large: 'https://t.plnspttrs.net/7/7_a_280.jpg', source: 'Planespotters' },
    { link: 'https://www.planespotters.net/photo/8', credit: 'PS8', large: 'https://t.plnspttrs.net/8/8_b_280.jpg', source: 'Planespotters' }] }, source: w }));
  await sleep(120);
  const fr = frames(st.out), last = fr[fr.length - 1], aiP = last && one(last, 1);
  const imgsP = aiP ? fields(aiP.val, 11).map(f => str(f.val, 3)) : [];
  check('pictures arriving with the panel open: pushed into FR24\'s stream at once (FR24\'s picture + two Planespotters, FR24 told to read)', fr.length === 1 && imgsP.length === 3 && /jetphotos/.test(imgsP[0]) && imgsP.filter(u => /plnspttrs/.test(u)).length === 2 && events.includes('readystatechange') && !!one(last, 5) && !!one(last, 3), { frames: fr.length, imgs: imgsP, events });
  check('... that frame of our own reports no position again (only FR24\'s own updates do)', !posted.some(p => p && p.__tweeksLadd === 'pos'));
  // a route found for the flight on screen: shown now, with FR24's latest schedule and position
  const kr = st.out.length;
  w.dispatchEvent(new w.MessageEvent('message', { data: { __tweeksLadd: 'route', id: fid4, route: { originId: 1939, destId: 902, originIata: 'LGW', destIata: 'DUB', progress: null } }, source: w }));
  await sleep(120);
  const fr2 = frames(st.out.slice(kr)), s2 = fr2.length && one(fr2[fr2.length - 1], 3);
  check('a route found with the panel open: in FR24\'s stream at once (FR24\'s departure kept, ours added)', fr2.length === 1 && !!s2 && num(s2.val, 5) === 902 && num(s2.val, 4) === 1939, { frames: fr2.length });
  // the stream finished (panel closed): nothing is pushed any more
  st.xhr.readyState = 4; const k3 = st.out.length;
  w.dispatchEvent(new w.MessageEvent('message', { data: { __tweeksLadd: 'route', id: fid4, route: { originId: 1939, destId: 903, progress: null } }, source: w }));
  await sleep(120);
  check('... and nothing once the stream is closed', st.out.length === k3);
  // FR24 names the destination itself in a later update (it can, once the aircraft has landed): reported, so FR24's answer stands
  posted.length = 0;
  H.setFollowSt(null);
  H.patchFlightMsg(cat([H.fLen(3, cat([H.fVar(4, 1939), H.fVar(5, 555)])), H.fLen(5, efi4)]), { id: fid4 }, H.FOLLOW);
  const sc = posted.find(p => p && p.__tweeksLadd === 'sched');
  check('FR24 naming the destination in a later update: reported (FR24\'s route then stands)', !!sc && sc.o === 1939 && sc.d === 555, sc);
  posted.length = 0;
  H.patchFlightMsg(cat([H.fLen(3, cat([H.fVar(4, 1939)])), H.fLen(5, efi4)]), { id: fid4 }, H.FOLLOW);
  check('... and a later update without it does not take it back', !posted.some(p => p && p.__tweeksLadd === 'sched'));
  // An ordinary aircraft whose name, serial number and age the userscript already holds: in FR24's first frame - no
  // "Private owner" and padlocks drawn first and replaced a moment later (2 Oct)
  {
    w.dispatchEvent(new w.MessageEvent('message', { data: { __tweeksLadd: 'pubIds', rows: [['400B1C', 'Kingmoor Aviation', 30, '5601', 0]] }, source: w }));
    await sleep(20);
    const aiO = cat([H.fVar(1, 0x400b1c), H.fStr(2, 'G-TEST'), H.fStr(4, 'AS55'), H.fStr(15, 'Private owner'), H.fVar(13, 0), H.fVar(14, 0), H.fVar(3, 222)]);
    const fidO = 0x41f0bbb1, efiO = cat([H.fVar(1, fidO), H.fStr(10, 'GTEST')]);
    const outO = H.patchFlightMsg(cat([H.fLen(1, aiO), H.fLen(5, efiO)]), { id: fidO }, H.FOLLOW);
    const aiN = one(outO, 1).val;
    check('an ordinary aircraft\'s known name, serial number and age go into FR24\'s first frame (no "Private owner", no padlocks)', str(aiN, 15) === 'Kingmoor Aviation' && str(aiN, 7) === '5601' && num(aiN, 10) === 30 && !one(aiN, 13) && !one(aiN, 14) && num(aiN, 3) === 222, { owner: str(aiN, 15), msn: str(aiN, 7), age: num(aiN, 10), msnFlag: !!one(aiN, 13), ageFlag: !!one(aiN, 14) });
    const aiA = cat([H.fVar(1, 0x400b1c), H.fStr(15, 'British Airways')]);
    const outA = H.patchFlightMsg(cat([H.fLen(1, aiA), H.fLen(5, efiO)]), { id: fidO + 1 }, H.FOLLOW);
    check('... a real operator FR24 names stays', str(one(outA, 1).val, 15) === 'British Airways', str(one(outA, 1).val, 15));
  }
  console.log(fails ? `\n${fails} FAILED` : '\nall passed');
  process.exit(fails ? 1 : 0);
})();
