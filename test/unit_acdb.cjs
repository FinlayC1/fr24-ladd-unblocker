// (1.1.1) Every aircraft in the world on the monitor (monitor/acdb.cjs): the open aircraft databases and registers - here
// small copies of each in its own format, served as the sites serve them - merged and kept on disk:
//   - tar1090-db's and ADS-B Exchange's lines, OpenSky's (quoted with '), Transport Canada's register (a zip: aircraft and
//     owners joined by mark, the Mode S address in binary) and the FAA's (a zip: MASTER.txt): each read;
//   - a register's word over the databases', a database's full field over an empty one; "(Miscode - ...)" and
//     placeholders no owner; never a street, postcode or anything of an address but city and state;
//   - looked up from the file: one block read, an aircraft in no database none; a source that fails leaves the others;
//     rebuilt whole or not at all; too few aircraft not kept;
//   - /owners: an aircraft never looked up has them at once - a register's own lookup stands over them; a private
//     person's name still withheld from the public; one with something missing queued for a lookup;
//   - the sweep: each day's aircraft of the world log that the databases leave something out of, queued.
// usage: node test/unit_acdb.cjs [dataDir]
const fs = require('fs'), os = require('os'), path = require('path'), zlib = require('zlib');
process.env.MON_DATA = process.argv[2] || path.join(__dirname, '../monitor/data');
process.env.MON_STORE = fs.mkdtempSync(path.join(os.tmpdir(), 'monacdb-'));
const A = require('../monitor/acdb.cjs');
let fails = 0;
const check = (name, ok, info) => { if (!ok) fails++; console.log((ok ? 'PASS  ' : 'FAIL  ') + name + (info !== undefined ? '  ' + JSON.stringify(info).slice(0, 500) : '')); };

// ---- a zip file as the registers send it (deflated members)
function zipOf(files) {
  const locals = [], cents = []; let off = 0;
  for (const [name, text] of Object.entries(files)) {
    const data = Buffer.from(text, 'latin1'), z = zlib.deflateRawSync(data), nb = Buffer.from(name);
    const lh = Buffer.alloc(30); lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(20, 4); lh.writeUInt16LE(8, 8); lh.writeUInt32LE(z.length, 18); lh.writeUInt32LE(data.length, 22); lh.writeUInt16LE(nb.length, 26);
    const ch = Buffer.alloc(46); ch.writeUInt32LE(0x02014b50, 0); ch.writeUInt16LE(20, 4); ch.writeUInt16LE(20, 6); ch.writeUInt16LE(8, 10); ch.writeUInt32LE(z.length, 20); ch.writeUInt32LE(data.length, 24); ch.writeUInt16LE(nb.length, 28); ch.writeUInt32LE(off, 42);
    locals.push(lh, nb, z); cents.push(ch, nb); off += 30 + nb.length + z.length;
  }
  const cd = Buffer.concat(cents), e = Buffer.alloc(22); e.writeUInt32LE(0x06054b50, 0); e.writeUInt16LE(cents.length / 2, 8); e.writeUInt16LE(cents.length / 2, 10); e.writeUInt32LE(cd.length, 12); e.writeUInt32LE(off, 16);
  return Buffer.concat(locals.concat([cd, e]));
}
const q = (s, c) => c + String(s).replace(new RegExp(c, 'g'), c + c) + c;
// ---- the sources: a few aircraft each, and 2,000 others in tar1090-db (enough to be kept)
const T = ['A15A72;N1868M;GLF6;00;GULFSTREAM G650;2015;N1868M LLC;', '406B2A;G-ABCD;C25A;00;;2010;Private;', '007CC1;N26BD;ASTR;00;;1992;ARKANSAS BOLT CO (Miscode - UNITED STATES);', 'C00001;C-FABC;PA28;00;PIPER PA-28;;;'];
for (let i = 0; i < 2000; i++) T.push((0x500000 + i).toString(16).toUpperCase() + ';;B738;00;;' + (2000 + (i % 20)) + ';AIRLINE ' + i + ';');
const X = [{ icao: 'a15a72', reg: 'N1868M', icaotype: 'GLF6', year: '2015', manufacturer: 'Gulfstream', model: 'G650ER', ownop: 'WRONG NAME LLC' }, { icao: '406b2a', reg: 'G-ABCD', icaotype: 'C25A', year: null, manufacturer: 'Cessna', model: 'Citation CJ2+', ownop: null }];
const OS_HEAD = "'icao24','timestamp','built','manufacturerName','model','operator','owner','registration','serialNumber','typecode'";
const OS = [OS_HEAD, "'406b2a','2024-01-01 00:00:00','2010-05-01','Cessna','525A','','Acme Jets, Ltd','G-ABCD','525A-0471','C25A'", "'a15a72','2024-01-01 00:00:00','2015-01-01','Gulfstream','G650','','N1868M LLC','N1868M','6100','GLF6'"];
const FAA_HEAD = 'N-NUMBER,SERIAL NUMBER,MFR MDL CODE,ENG MFR MDL,YEAR MFR,TYPE REGISTRANT,NAME,STREET,STREET2,CITY,STATE,ZIP CODE,REGION,COUNTY,COUNTRY,LAST ACTION DATE,CERT ISSUE DATE,CERTIFICATION,TYPE AIRCRAFT,TYPE ENGINE,STATUS CODE,MODE S CODE,FRACT OWNER,AIR WORTH DATE,OTHER NAMES(1),OTHER NAMES(2),OTHER NAMES(3),OTHER NAMES(4),OTHER NAMES(5),EXPIRATION DATE,UNIQUE ID,KIT MFR, KIT MODEL,MODE S CODE HEX,';
const FAA = [FAA_HEAD, '1868M ,6110                          ,1152031,     ,2015,7,BANK OF UTAH TRUSTEE                              ,200 E SOUTH TEMPLE STE 210        ,                                 ,SALT LAKE CITY    ,UT,841111234,4,035,US,20230101,20230101,1T          ,5,4,V ,50532662,     ,20150601,                                                  ,                                                  ,                                                  ,                                                  ,                                                  ,20290131,01234567,                              ,                    ,A15A72    ,'];
const ccLine = (mark, msn, built, bin) => { const f = new Array(48).fill(''); f[0] = ' ' + mark; f[5] = msn; f[31] = built; f[42] = bin; return f.map(v => q(v, '"')).join(','); };
const CCURR = [ccLine('FABC', '28-7105001', '1971/03/01', (0xc00001).toString(2).padStart(24, '0'))].join('\n');
const COWNR = [['FABC', 'Doe, Jane', '', '12 Maple Street', '', 'Deep River', 'Ontario', 'Ontario', 'K0J 1P0', 'CANADA'].map(v => q(v, '"')).join(',')].join('\n');
const SRC = {
  'https://t/tar1090.csv.gz': zlib.gzipSync(T.join('\n') + '\n'), 'https://t/adsbx.json.gz': zlib.gzipSync(X.map(o => JSON.stringify(o)).join('\n') + '\n'),
  'https://t/opensky.csv': Buffer.from(OS.join('\n') + '\n'), 'https://t/ccar.zip': zipOf({ 'carscurr.txt': CCURR, 'carsownr.txt': COWNR, 'carslayout.txt': 'x' }), 'https://t/faa.zip': zipOf({ 'MASTER.txt': FAA.join('\r\n') + '\r\n' })
};
const urls = { tar1090: 'https://t/tar1090.csv.gz', adsbx: 'https://t/adsbx.json.gz', opensky: 'https://t/opensky.csv', ccar: 'https://t/ccar.zip', faa: 'https://t/faa.zip' };
let refuse = new Set();
const fakeFetch = async u => {
  const b = SRC[u]; if (!b || refuse.has(u)) return { status: 404, body: null, arrayBuffer: async () => new ArrayBuffer(0), text: async () => '' };
  return { status: 200, body: require('stream').Readable.toWeb(require('stream').Readable.from([b])), arrayBuffer: async () => b.buffer.slice(b.byteOffset, b.byteOffset + b.length), text: async () => b.toString() };
};

(async () => {
  const store = fs.mkdtempSync(path.join(os.tmpdir(), 'acdb-'));
  const ac = A.createAcdb({ store, fetch: fakeFetch, urls });
  check('nothing built yet: due, nothing found', ac.due() && ac.lookup('a15a72') === null);
  const ok = await ac.build(), st = ac.status();
  check('built from all five sources', ok && st.aircraft === 2004 && ['tar1090', 'adsbx', 'opensky', 'ccar', 'faa'].every(k => st.sources[k] && st.sources[k].n > 0), st);
  const n1868 = ac.lookup('A15A72');
  check('N1868M: the FAA\'s word over the databases (its serial number, year, owner, city and state) - the model from a database', !!n1868 && n1868.reg === 'N1868M' && n1868.msn === '6110' && n1868.year === 2015 && n1868.owner === 'BANK OF UTAH TRUSTEE' && n1868.ownerCity === 'SALT LAKE CITY, UT' && n1868.model === 'Gulfstream G650ER' && n1868.type === 'GLF6', n1868);
  const abcd = ac.lookup('406b2a');
  check('G-ABCD: OpenSky\'s serial number, build year and owner where tar1090-db said "Private" and ADS-B Exchange nothing - only filling in (the model as ADS-B Exchange has it)', !!abcd && abcd.msn === '525A-0471' && abcd.year === 2010 && abcd.owner === 'Acme Jets, Ltd' && abcd.model === 'Cessna Citation CJ2+', abcd);
  const cfabc = ac.lookup('c00001');
  check('C-FABC: Transport Canada\'s register - aircraft and owner joined by mark, the address from binary; the owner and her city, never her street or postcode', !!cfabc && cfabc.reg === 'C-FABC' && cfabc.msn === '28-7105001' && cfabc.year === 1971 && cfabc.owner === 'Doe, Jane' && cfabc.ownerCity === 'Deep River, Ontario' && !/Maple|K0J/.test(JSON.stringify(cfabc)), cfabc);
  const misc = ac.lookup('007cc1');
  check('a miscoded transponder\'s note left off the owner; an aircraft in no database: none', !!misc && misc.owner === 'ARKANSAS BOLT CO' && ac.lookup('abcdef') === null && ac.lookup('zz') === null, misc);
  check('... and nothing of an address in the file at all', !/SOUTH TEMPLE|841111234|Maple/.test(zlib.gunzipSync ? fs.readFileSync(ac.file).toString('latin1') : ''));
  // (lookups: one block each)
  const t0 = Date.now(); for (let i = 0; i < 2000; i++) ac.lookup((0x500000 + i).toString(16)); const ms = Date.now() - t0;
  check(`... 2,000 lookups in ${ms} ms`, ms < 2000 && ac.lookup('5003e7').year === 2019);
  // (after a restart: the file read again)
  const ac2 = A.createAcdb({ store, fetch: fakeFetch, urls });
  check('after a restart: read back from disk, not due', !ac2.due() && ac2.lookup('a15a72').msn === '6110');
  // (a source refusing: the others kept; too few aircraft: not kept, the old file serves)
  refuse = new Set([urls.faa, urls.opensky]);
  const ok2 = await ac2.build(), st2 = ac2.status();
  check('the FAA and OpenSky refusing: built from the rest (N1868M as the databases have it, no serial number), said which failed', ok2 && st2.sources.faa.err && st2.sources.opensky.err && st2.aircraft === 2004 && ac2.lookup('a15a72').owner === 'WRONG NAME LLC' && !ac2.lookup('a15a72').msn, st2.sources);
  refuse = new Set([urls.faa, urls.opensky, urls.tar1090]);
  const ok3 = await ac2.build();
  check('... all but a few refusing: not kept - the last one still serves', !ok3 && ac2.lookup('a15a72').reg === 'N1868M' && /not kept/.test(ac2.status().err), ac2.status().err);
  refuse = new Set();

  // ---- built in a worker thread, as the monitor builds it: over HTTP, its own memory --------------------------------------
  { const http = require('http');
    let big = null;
    const srv = http.createServer((q, res) => {
      if (q.url === '/stall') return;   // (never answers)
      if (q.url === '/cut') { const b = SRC['https://t/tar1090.csv.gz']; res.writeHead(200, { 'Content-Length': String(b.length * 4) }); res.write(b.slice(0, b.length >> 1)); setTimeout(() => res.socket.destroy(), 50); return; }
      if (q.url === '/big') { res.writeHead(200); return res.end(big); }
      const b = SRC['https://t' + q.url]; if (!b) { res.writeHead(404); return res.end(); }
      res.writeHead(200); res.end(b);
    });
    await new Promise(r => srv.listen(0, '127.0.0.1', r));
    const H = 'http://127.0.0.1:' + srv.address().port, hu = {}; for (const [k, u] of Object.entries(urls)) hu[k] = u.replace('https://t', H);
    const ws = fs.mkdtempSync(path.join(os.tmpdir(), 'acdbw-'));
    const aw = A.createAcdb({ store: ws, worker: true, urls: hu });
    const okw = await aw.build(), stw = aw.status();
    const same = ['a15a72', '406b2a', 'c00001', '007cc1'].every(h => JSON.stringify(aw.lookup(h)) === JSON.stringify(ac.lookup(h)));
    check('built in a worker thread over HTTP (as the monitor builds it): the same aircraft, the same answers', okw && stw.aircraft === 2004 && same && !stw.building && fs.readdirSync(path.join(ws, 'acdb')).join() === 'acdb.bin', { okw, stw, a: aw.lookup('a15a72') });
    // (a download cut off half way: that source failed, the rest built - nothing hangs)
    const ac3 = A.createAcdb({ store: fs.mkdtempSync(path.join(os.tmpdir(), 'acdbc-')), worker: true, minAircraft: 1, urls: Object.assign({}, hu, { tar1090: H + '/cut' }) });
    const t3 = Date.now(), ok3c = await ac3.build(), st3 = ac3.status();
    check('... a download cut off half way: that source failed (said so), the others built; over in moments', ok3c && !!(st3.sources.tar1090 && st3.sources.tar1090.err) && st3.sources.adsbx.n > 0 && Date.now() - t3 < 20000, st3.sources);
    // (a source that never answers: stopped after the time allowed - the file built before still serves)
    const aws = A.createAcdb({ store: ws, worker: true, urls: Object.assign({}, hu, { tar1090: H + '/stall' }), cfg: { maxMin: 0.03 } });
    const oks = await aws.build();
    check('... a source that never answers: the build stopped after the time allowed, the file built before still serves', !oks && /minutes - stopped/.test(aws.status().err) && !aws.status().building && aws.lookup('a15a72') && aws.lookup('a15a72').msn === '6110', aws.status().err);
    // (out of memory: only the worker ends - this process, and the file built before, go on)
    const L = []; for (let i = 0; i < 400000; i++) L.push((0x100000 + i).toString(16) + ';N' + i + ';C172;00;CESSNA 172 SKYHAWK NUMBER ' + i + ';1999;OWNER NUMBER ' + i + ' HOLDINGS LLC;');
    big = zlib.gzipSync(L.join('\n'));
    const awm = A.createAcdb({ store: ws, worker: true, urls: Object.assign({}, hu, { tar1090: H + '/big' }), cfg: { heapMb: 16 } });
    const okm = await awm.build();
    check('... out of memory (its limit 16 MB here): only the worker ends - this goes on, the file built before still serves', !okm && /out of memory|ended/.test(awm.status().err) && !awm.status().building && awm.lookup('a15a72') && awm.lookup('a15a72').msn === '6110', awm.status().err);
    srv.close(); }

  // ---- /owners on the monitor ------------------------------------------------------------------------------------------
  const M = require('../monitor/monitor.cjs');
  M.loadEngine();
  // (the monitor's own store, built from the same sources)
  const real = global.fetch; global.fetch = fakeFetch;
  M.AC.build = M.AC.build; const AC = M.AC; await (async () => { const b = A.createAcdb({ store: process.env.MON_STORE, fetch: fakeFetch, urls }); await b.build(); })(); AC.open();
  global.fetch = real;
  const own = hexes => M.answer(new URL('http://x/owners?hex=' + hexes.join(',')), Date.now() / 1000, { admin: false, ip: '1.2.3.4' });
  const r1 = await own(['406b2a']), row = (r1.list || [])[0] || [];
  check('/owners: an aircraft never looked up here - its serial number, build year, owner, model at once', row[0] === '406b2a' && row[8] === '525A-0471' && row[9] === 2010 && row[4] === 'Acme Jets, Ltd' && row[3] === 'Cessna Citation CJ2+' && row[13] === 0, row);
  const r2 = await own(['c00001']), row2 = (r2.list || [])[0] || [];
  check('... a private person\'s name (and city) withheld from the public as before - the serial number and year given', row2[4] === '' && row2[5] === '' && row2[15] === 1 && row2[8] === '28-7105001' && row2[9] === 1971, row2);
  M.owners.db.set('406b2a', { reg: 'G-ABCD', owner: 'Register Name Ltd', msn: '525A-0471', at: Math.round(Date.now() / 1000), ok: true, regOwner: true });
  const row3 = ((await own(['406b2a'])).list || [])[0] || [];
  check('... a register\'s own lookup here stands over the databases', row3[4] === 'Register Name Ltd' && row3[14] === 1 && row3[9] === 2010, row3);
  M.owners.q.length = 0; M.owners.db.delete('a15a72');
  await own(['abcdef', 'a15a72', '406b2a']);
  check('... one in no database queued for a lookup; one with everything known not', M.owners.q.includes('abcdef') && !M.owners.q.includes('a15a72'), M.owners.q.slice(0, 5));
  // ---- the sweep of the world log's day -----------------------------------------------------------------------------------
  { const d = '2026-10-20', wr = M.WORLD.writer(d); wr.add('abcde0', []); wr.add('a15a72', []); wr.add('5003e7', []); wr.finish();
    M.owners.q.length = 0; M.owners.db.clear();
    const n = await M.acdbSweep();
    check('the sweep: the world log\'s day\'s aircraft the databases leave something out of (no serial number) queued - one with all of it not', n >= 2 && M.owners.q.includes('abcde0') && M.owners.q.includes('5003e7') && !M.owners.q.includes('a15a72'), { n, q: M.owners.q.slice(0, 5) });
    check('... once a day', await M.acdbSweep() === 0); }
  const s = M.answer(new URL('http://x/status'), Date.now() / 1000, { admin: true });
  check('/status: the aircraft database - how many, when built, each source', s.aircraft && s.aircraft.aircraft === 2004 && s.aircraft.sources && s.aircraft.sources.faa, s.aircraft);
  console.log(fails ? `\n${fails} FAILED` : '\nall passed');
  process.exit(fails ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
