// 1.3.5 - FR24's aircraft directory (/data/aircraft) with the types FR24 does not list (Bombardier Global, Gulfstream...):
//   - monitor: every type of the aircraft database in families as FR24 keeps them, each one's aircraft in production order,
//     a page of a type's or a family's (actypes.cjs)
//   - extension: FR24's server sending one of their addresses elsewhere seen, told to the tab
//   - the page: their families among FR24's own (its search searches that list); a family FR24 has given the types it
//     lacks; their family's and type's pages made from a page FR24 has - in FR24's own moves and as a page loads; links to
//     them; FR24's production list's rows and pages
// usage: node test/unit_135.cjs <node_modules dir>
const fs = require('fs'), path = require('path'), os = require('os'), vm = require('vm'), zlib = require('zlib');
const NM = process.argv[2] ? path.resolve(process.argv[2]) : path.join(__dirname, '..', 'node_modules');
const { createAcTypes, makerOf, tidy, byMsn } = require('../monitor/actypes.cjs');
let fails = 0;
const check = (name, ok, extra) => { if (!ok) fails++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra !== undefined ? '  ' + JSON.stringify(extra).slice(0, 600) : ''}`); };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const until = async (f, ms) => { const t = Date.now(); while (Date.now() - t < ms) { try { if (f()) return true; } catch (e) { /* not yet */ } await sleep(20); } return false; };

(async () => {
  // ---- 1. the monitor: the types, their families, their aircraft -----------------------------------------------------
  { const store = fs.mkdtempSync(path.join(os.tmpdir(), 'act135-'));
    const ac = [
      { hex: '43eb4a', reg: 'M-PORT', type: 'GL5T', model: 'BOMBARDIER BD-700 Global 5000/5500', msn: '9868', year: 2018, owner: 'Port Aviation' },
      { hex: '400001', reg: 'G-GLBX', type: 'GL5T', model: 'BOMBARDIER BD-700 Global 5000/5500', msn: '9127', year: 2004 },
      { hex: '400002', reg: 'G-GLBY', type: 'GL5T', model: 'BOMBARDIER BD-700 Global 5000/5500', msn: '9500' },
      { hex: '400003', reg: 'N1GX', type: 'GLEX', model: 'BOMBARDIER BD-700 Global 6000/6500', msn: '9201', year: 2006, op: 'Jet Ops' },
      { hex: '400004', reg: 'N2GX', type: 'GLEX', model: 'BOMBARDIER BD-700 Global 6000/6500', msn: '987', year: 1999 },
      { hex: '400005', reg: 'N3GX', type: 'GLEX', model: 'Bombardier Global 6000', msn: '9300', year: 2010 },
      { hex: '400006', reg: 'N650GA', type: 'GLF6', model: 'GULFSTREAM G650', msn: '6001', year: 2012 },
      { hex: '400007', reg: 'N651GA', type: 'GLF6', model: 'GULFSTREAM G650', msn: '6002', year: 2013 },
      { hex: '400008', reg: 'N652GA', type: 'GLF6', model: 'GULFSTREAM G650', msn: '6003' },
      { hex: '400009', reg: 'N100AT', type: 'AT8T', model: 'AIR TRACTOR AT-802', year: 2001 },
      { hex: '40000a', reg: 'N101AT', type: 'AT8T', model: 'AIR TRACTOR AT-802', year: 2002 },
      { hex: '40000b', reg: 'N102AT', type: 'AT8T', model: 'AIR TRACTOR AT-802' },
      { hex: '40000c', reg: 'N1Z', type: 'ZZZZ', model: 'Unknown' }, { hex: '40000d', reg: 'N2Z', type: 'ZZZZ' }, { hex: '40000e', reg: 'N3Z', type: 'ZZZZ' },
      { hex: '40000f', reg: 'N9GL', type: 'GLID', model: 'Glider' }, { hex: '400010', reg: 'N1X', type: 'XX1', model: 'ONE OFF' },
    ];
    const T = createAcTypes({ store, pause: () => Promise.resolve() });
    const ok = await T.build(async fn => { ac.forEach(fn); return ac.length; }, 1234, o => (o.reg === 'G-GLBY' ? { year: 2008 } : null));
    const ix = JSON.parse(zlib.gunzipSync(T.indexBody()));
    const gl = ix.families.find(f => f.code === 'GLOBAL'), gs = ix.families.find(f => f.code === 'GULFSTREAM'), at = ix.families.find(f => f.code === 'AIRTRACTOR');
    check('the types in families as FR24 keeps them - Bombardier Global (Global 6000, 5000), Gulfstream (G650) - their counts, most aircraft first; FR24\'s form: code, name, slug, count, types', ok && gl && gl.name === 'Bombardier Global' && gl.slug === 'bombardier-global' && gl.count === 6 && gl.types.map(t => t.code).join() === 'GL5T,GLEX' && gl.types[0].name === 'Bombardier BD-700 Global 5000/5500' && gl.types[0].slug === 'gl5t' && gs && gs.types[0].code === 'GLF6' && gs.types[0].name === 'Gulfstream G650', ix.families);
    check('... a type in none of them with its maker\'s - its maker\'s name whole (Air Tractor, not "Air")', at && at.name === 'Air Tractor' && at.types[0].code === 'AT8T', at);
    check('... no designator that is no type (ZZZZ, gliders), none with too few to list', !ix.families.some(f => f.types.some(t => ['ZZZZ', 'GLID', 'XX1'].includes(t.code))));
    const p = T.page({ type: 'GL5T' });
    check('a type\'s aircraft in production order (serial numbers as numbers), each: registration, serial number, year built - worked out where the database has none - and owner or operator', p.total === 3 && p.rows.map(r => r[0]).join() === 'G-GLBX,G-GLBY,M-PORT' && p.rows[2][1] === '9868' && p.rows[2][3] === 'Port Aviation' && p.rows[1][2] === 2008 && p.averageAge > 0, p);
    const pf = T.page({ family: 'GLOBAL', per: 10 });
    check('... a family\'s: its types\' together, in production order, each with its type ("987" before "9127")', pf.total === 6 && pf.rows[0][0] === 'N2GX' && pf.rows[0][5] === 'GLEX' && pf.rows.some(r => r[5] === 'GL5T'), pf.rows.map(r => r[0] + ':' + r[5]));
    const pp = T.page({ type: 'GL5T', per: 10, page: 9 });
    check('... pages of them: a page past the last is the last', pp.page === 1 && pp.lastPage === 1 && T.page({ type: 'NOPE' }) === null && T.page({ type: '../x' }) === null);
    const T2 = createAcTypes({ store });
    check('kept on disk: a monitor started again has them at once; built again only with a newer aircraft database', !!T2.indexBody() && T2.due(1234) === false && T2.due(5678) === true);
    check('names tidied: makers in capitals as names, the model as it is', tidy('BOMBARDIER BD-700 Global 6000') === 'Bombardier BD-700 Global 6000' && tidy('CESSNA 560XL Citation XLS') === 'Cessna 560XL Citation XLS' && makerOf('De Havilland DHC-6') === 'De Havilland' && makerOf('American AA-5 Tiger') === 'American' && byMsn(['a', '987'], ['b', '9127']) < 0);
  }

  // ---- 2. the extension's background: one of their addresses sent elsewhere seen ------------------------------------
  { const ls = { redirect: null, msg: [] };
    const any = () => new Proxy(function () {}, { get: (t, k) => (k === 'addListener' ? () => {} : any()), apply: () => undefined });
    const fill = o => new Proxy(o, { get: (t, k) => (k in t ? t[k] : any()) });
    const chrome = fill({ runtime: fill({ id: 'ext1', onMessage: { addListener(f) { ls.msg.push(f); } }, getURL: x => x, reload() {}, lastError: null, getManifest: () => ({ version: '1' }) }),
      webRequest: { onBeforeRedirect: { addListener(f, filter) { ls.redirect = f; ls.filter = filter; } } } });
    vm.runInNewContext(fs.readFileSync(path.join(__dirname, '..', 'extension', 'background.js'), 'utf8'), { chrome, URL, setTimeout, clearTimeout, console, fetch: async () => ({ ok: false }), AbortController, btoa: s => Buffer.from(s, 'binary').toString('base64'), atob: s => Buffer.from(s, 'base64').toString('binary') });
    const ask = tab => new Promise(res => { for (const f of ls.msg) f({ tlOaFrom: true }, { id: 'ext1', tab: { id: tab } }, v => res(v)); setTimeout(() => res(undefined), 200); });
    ls.redirect({ url: 'https://www.flightradar24.com/data/aircraft/bombardier-global/gl5t?page=2', redirectUrl: 'https://www.flightradar24.com/data/aircraft', tabId: 3, type: 'main_frame' });
    ls.redirect({ url: 'https://www.flightradar24.com/data/aircraft/g-abcd', redirectUrl: 'https://www.flightradar24.com/data/aircraft/g-abcd', tabId: 4, type: 'main_frame' });
    const a1 = await ask(3), a2 = await ask(4);
    check('the extension: FR24\'s server sending one of their addresses elsewhere seen - where from, told to that tab; a redirect to the same page never', a1 === '/data/aircraft/bombardier-global/gl5t?page=2' && !a2 && ls.filter.urls.includes('https://www.flightradar24.com/data/aircraft/*'), { a1, a2 });
  }

  let JSDOM = null; try { ({ JSDOM } = require(path.join(NM, 'jsdom'))); } catch (e) { console.log('(skipped the browser: no jsdom)'); }
  if (!JSDOM) { console.log(fails ? `\n${fails} failed` : '\nall passed'); process.exit(fails ? 1 : 0); }
  const SRC = fs.readFileSync(path.join(__dirname, '..', 'dist', 'fr24-ladd-unblocker.user.js'), 'utf8');
  const PI = SRC.match(/function pageInterceptor\(\) \{[\s\S]*?\n {2}\}\n/)[0];
  const page = (url, html, before) => {
    const w = new JSDOM(html || '<!doctype html><html><head></head><body><div id="app"></div></body></html>', { url, runScripts: 'dangerously', pretendToBeVisual: true }).window; let H = null; const posts = [];
    w.__tlTestHook = h => { H = h; }; w.Response = Response; w.Headers = Headers; w.Blob = Blob;
    w.fetch = () => Promise.reject(new Error('offline')); w.postMessage = d => { if (d && d.__tweeksLadd) posts.push(d); };
    if (before) before(w);
    w.eval('(' + PI + ')()');
    return { w, H: () => H, posts, send: data => w.dispatchEvent(new w.MessageEvent('message', { data, source: w, origin: 'https://www.flightradar24.com' })) };
  };
  const vue = (P, component, props, url) => { const gp = { $page: { component, props, url: url || '/' }, $inertia: {} }; P.w.document.getElementById('app').__vue_app__ = { config: { globalProperties: gp } }; return gp; };
  const FR24 = [
    { code: 'A320', name: 'Airbus A320 family', slug: 'airbus-a320', count: 11000, types: [{ code: 'A320', name: 'Airbus A320', slug: 'a320', count: 5000 }, { code: 'A20N', name: 'Airbus A320neo', slug: 'a20n', count: 3000 }] },
    { code: 'CITATION', name: 'Cessna Citation', slug: 'cessna-citation', count: 900, types: [{ code: 'C25A', name: 'Citation CJ2', slug: 'c25a', count: 900 }] },
  ];
  const OURS = [
    { code: 'AIRBUS', name: 'Airbus', slug: 'airbus', count: 8100, types: [{ code: 'A320', name: 'Airbus A-320', slug: 'a320', count: 5100 }, { code: 'A20N', name: 'Airbus A-320neo', slug: 'a20n', count: 3000 }] },
    { code: 'GLOBAL', name: 'Bombardier Global', slug: 'bombardier-global', count: 1819, types: [{ code: 'GLEX', name: 'Bombardier BD-700 Global 6000/6500', slug: 'glex', count: 1110 }, { code: 'GL5T', name: 'Bombardier BD-700 Global 5000/5500', slug: 'gl5t', count: 392 }, { code: 'GL7T', name: 'Bombardier BD-700 Global 7000/7500', slug: 'gl7t', count: 317 }] },
    { code: 'GULFSTREAM', name: 'Gulfstream', slug: 'gulfstream', count: 740, types: [{ code: 'GLF6', name: 'Gulfstream G650', slug: 'glf6', count: 740 }] },
    { code: 'CITATION', name: 'Cessna Citation', slug: 'cessna-citation', count: 2227, types: [{ code: 'C25A', name: 'Cessna 525A Citation CJ2', slug: 'c25a', count: 1035 }, { code: 'C56X', name: 'Cessna 560XL Citation XLS', slug: 'c56x', count: 1192 }] },
  ];
  const PG = { code: 'GL5T', total: 392, averageAge: 11.6, page: 2, lastPage: 8, perPage: 50, rows: [['M-PORT', '9868', 2018, 'Port Aviation', '43eb4a'], ['G-GLBX', '', 0, '', '400001']] };

  // ---- 3. the page: the directory -------------------------------------------------------------------------------------
  let kept = null;
  { const P = page('https://www.flightradar24.com/data/aircraft'), H = P.H();
    const props = { families: FR24.map(f => Object.assign({}, f)) }; vue(P, 'Data/Aircraft', props);
    H.acTick(); const ask = P.posts.find(p => p.__tweeksLadd === 'acDir');
    P.send({ __tweeksLadd: 'acDirGot', key: ask && ask.key, families: OURS, at: 1 });
    const fam = props.families, codes = fam.map(f => f.code), cit = fam.find(f => f.code === 'CITATION'), gl = fam.find(f => f.code === 'GLOBAL');
    check('FR24\'s aircraft directory: their families among FR24\'s own, after them, most aircraft first - in FR24\'s own form (its search on the page searches this list, so finds them)', !!ask && codes.join() === 'A320,CITATION,GLOBAL,GULFSTREAM' && gl.slug === 'bombardier-global' && gl.count === 1819 && gl.types.length === 3 && gl.photo === null, codes);
    check('... a type FR24 lists itself left to FR24 (Airbus\'s A320s - no "Airbus" family twice); a family FR24 has given only the types it lacks (Citation: the 560XL, its count raised)', !codes.includes('AIRBUS') && cit.types.map(t => t.code).join() === 'C25A,C56X' && cit.count === 900 + 1192, cit);
    const ref = H.acRefGet(); kept = { add: P.w.localStorage.getItem('tl.ac.add'), ref: P.w.localStorage.getItem('tl.ac.ref') };
    check('... a family and type FR24 has learned, to make theirs from (its biggest)', ref && ref.fam === 'airbus-a320' && ref.type === 'a320', ref);
    const q1 = H.acPageReq('https://www.flightradar24.com/data/aircraft/bombardier-global/gl5t?page=2'), q2 = H.acPageReq('/data/aircraft/bombardier-global'), q3 = H.acPageReq('/data/aircraft/cessna-citation/c56x'), q4 = H.acPageReq('/data/aircraft/cessna-citation'), q5 = H.acPageReq('/data/aircraft/g-abcd'), q6 = H.acPageReq('/data/aircraft/airbus-a320?tl-ac=%2Fdata%2Faircraft%2Fgulfstream%2Fglf6');
    check('their addresses known: a type\'s (and its page), a family\'s, theirs in a family of FR24\'s - and made from FR24\'s own type and family pages; FR24\'s own family, an aircraft\'s page: FR24\'s', q1 && q1.kind === 'type' && q1.type.code === 'GL5T' && q1.page === 2 && q1.refUrl === '/data/aircraft/airbus-a320/a320?tl-ac=%2Fdata%2Faircraft%2Fbombardier-global%2Fgl5t&page=2' && q2 && q2.kind === 'family' && q2.refUrl === '/data/aircraft/airbus-a320?tl-ac=%2Fdata%2Faircraft%2Fbombardier-global' && q3 && q3.type.code === 'C56X' && q3.fam.fr24 && !q4 && !q5 && q6 && q6.type.code === 'GLF6', { q1: q1 && q1.refUrl, q2: q2 && q2.refUrl });
    // (a link pressed: to the page of FR24's theirs is made from)
    const a = P.w.document.createElement('a'); a.href = '/data/aircraft/gulfstream'; P.w.document.body.appendChild(a);
    a.dispatchEvent(new P.w.MouseEvent('mousedown', { bubbles: true }));
    const b = P.w.document.createElement('a'); b.href = '/data/aircraft/g-abcd'; P.w.document.body.appendChild(b); b.dispatchEvent(new P.w.MouseEvent('mousedown', { bubbles: true }));
    check('a link to one of theirs - FR24\'s search, its cards - goes to the page of FR24\'s it is made from (FR24\'s server has none of theirs); any other left alone', a.getAttribute('href') === '/data/aircraft/airbus-a320?tl-ac=%2Fdata%2Faircraft%2Fgulfstream' && b.getAttribute('href') === '/data/aircraft/g-abcd', a.getAttribute('href'));
    // (FR24's page of the type theirs is made from, made theirs - its production list, Laravel's pages of it)
    const refPage = { component: 'Data/AircraftType', props: { family: { code: 'A320', name: 'Airbus A320 family', slug: 'airbus-a320' }, type: { code: 'A320', name: 'Airbus A320', model: 'A320' }, statistics: { total: 5000, averageAge: 12 }, aircraft: { data: [{ registration: 'EI-DCY' }], current_page: 1, last_page: 100, links: [] }, photos: { 'EI-DCY': { src: 'x' } }, locked: true, canonicalUrl: 'https://www.flightradar24.com/data/aircraft/airbus-a320/a320', content: { data: [{ cta: [1] }] } }, url: '/data/aircraft/airbus-a320/a320', version: 'v1' };
    H.photoCache.set('43EB4A', { photos: [{ thumb: 't.jpg', medium: 'm.jpg', copyright: 'J. Smith' }], at: Date.now() });
    const o = H.acPageOf(refPage, q1, PG), ap = o.props.aircraft, r0 = ap.data[0];
    check('a type\'s page made from FR24\'s: its type, its family, its numbers, unlocked; FR24\'s own texts kept', o.component === 'Data/AircraftType' && o.url === '/data/aircraft/bombardier-global/gl5t?page=2' && o.props.type.code === 'GL5T' && o.props.type.name === 'Bombardier BD-700 Global 5000/5500' && o.props.family.code === 'GLOBAL' && o.props.family.slug === 'bombardier-global' && o.props.statistics.total === 392 && o.props.statistics.averageAge === 11.6 && o.props.locked === false && o.props.canonicalUrl === 'https://www.flightradar24.com/data/aircraft/bombardier-global/gl5t' && o.props.content.data[0].cta[0] === 1 && o.version === 'v1', o.props);
    check('... its production list in FR24\'s rows: registration, serial number, owner, type, age - none where not known - and the pictures this page has', r0.registration === 'M-PORT' && r0.msn === '9868' && r0.owner === 'Port Aviation' && r0.airline === null && r0.type === 'Bombardier BD-700 Global 5000/5500' && r0.age === new Date().getUTCFullYear() - 2018 && ap.data[1].msn === null && ap.data[1].age === null && ap.data[1].owner === null && o.props.photos['M-PORT'].src === 'm.jpg' && !o.props.photos['EI-DCY'], ap.data);
    const labels = ap.links.map(l => l.label).join('|');
    check('... and Laravel\'s pages of it, as FR24\'s list goes through them (its links its own address, ?page=)', ap.current_page === 2 && ap.last_page === 8 && ap.total === 392 && ap.from === 51 && ap.to === 52 && labels === '&laquo; Previous|1|2|3|4|5|...|8|Next &raquo;' && ap.links[0].url === 'https://www.flightradar24.com/data/aircraft/bombardier-global/gl5t?page=1' && ap.links[2].active === true, labels);
    const of = H.acPageOf(Object.assign({}, refPage, { component: 'Data/AircraftFamily' }), q2, null);
    check('a family\'s page: its types\' cards, its count - its list filled when the monitor\'s page of it comes', of.component === 'Data/AircraftFamily' && of.props.types.map(t => t.code).join() === 'GLEX,GL5T,GL7T' && !('type' in of.props) && of.props.statistics.total === 1819 && of.props.aircraft.data.length === 0, of.props.types);
    P.w.close();
  }

  // ---- 4. a family of FR24's own: the types it lacks among its own -------------------------------------------------------
  { const P = page('https://www.flightradar24.com/data/aircraft/cessna-citation', null, w => { w.localStorage.setItem('tl.ac.add', kept.add); w.localStorage.setItem('tl.ac.ref', kept.ref); }), H = P.H();
    const props = { family: { code: 'CITATION', name: 'Cessna Citation', slug: 'cessna-citation' }, types: [{ code: 'C25A', slug: 'c25a', count: 900 }], aircraft: { data: [{ registration: 'N1' }], current_page: 1, last_page: 1, links: [] } };
    vue(P, 'Data/AircraftFamily', props); H.acTick(); H.acTick();
    check('a family FR24 has: the types it lacks among its own cards, once', props.types.map(t => t.code).join() === 'C25A,C56X', props.types);
    P.w.close();
  }

  // ---- 5. their page as it loads, and filled ------------------------------------------------------------------------------
  { const refPage = { component: 'Data/AircraftType', props: { family: { code: 'A320', name: 'Airbus A320 family', slug: 'airbus-a320' }, type: { code: 'A320', name: 'Airbus A320' }, statistics: { total: 5000 }, aircraft: { data: [{ registration: 'EI-DCY' }], current_page: 1, last_page: 100, links: [] }, photos: {}, locked: true, canonicalUrl: 'x' }, url: '/data/aircraft/airbus-a320/a320', version: 'v1' };
    const html = '<!doctype html><html><head></head><body><div id="app" data-page="' + JSON.stringify(refPage).replace(/&/g, '&amp;').replace(/"/g, '&quot;') + '"></div></body></html>';
    const P = page('https://www.flightradar24.com/data/aircraft/airbus-a320/a320?tl-ac=%2Fdata%2Faircraft%2Fgulfstream%2Fglf6', html, w => { w.localStorage.setItem('tl.ac.add', kept.add); w.localStorage.setItem('tl.ac.ref', kept.ref); }), H = P.H();
    const pg = JSON.parse(P.w.document.getElementById('app').getAttribute('data-page'));
    check('their page as it loads: FR24\'s page of the type it is made from made theirs before FR24\'s app reads it - its address theirs', pg.component === 'Data/AircraftType' && pg.props.type.code === 'GLF6' && pg.props.family.code === 'GULFSTREAM' && pg.props.aircraft.data.length === 0 && pg.props.statistics.total === 740 && P.w.location.pathname === '/data/aircraft/gulfstream/glf6' && !P.w.location.search, { c: pg.component, t: pg.props.type, path: P.w.location.pathname });
    const props = JSON.parse(JSON.stringify(pg.props)); vue(P, 'Data/AircraftType', props);
    H.acTick(); const ask = P.posts.find(p => p.__tweeksLadd === 'acPage');
    check('... its production list asked of the monitor (through the userscript) - that type, that page', !!ask && ask.kind === 'type' && ask.code === 'GLF6' && ask.page === 1, ask);
    P.send({ __tweeksLadd: 'acPageGot', key: ask.key, page: { code: 'GLF6', total: 3, averageAge: 12.5, page: 1, lastPage: 1, perPage: 50, rows: [['N650GA', '6001', 2012, '', '400006'], ['N651GA', '6002', 2013, 'GA Ops', '400007']] } });
    const gp = P.w.document.getElementById('app').__vue_app__.config.globalProperties;
    await until(() => gp.$page.props.aircraft.data.length === 2, 2000);
    check('... and filled when it comes; kept, so the way back is at once', gp.$page.props.aircraft.data[0].registration === 'N650GA' && gp.$page.props.statistics.total === 3 && /N650GA/.test(P.w.localStorage.getItem('tl.ac.pg') || ''), gp.$page.props.aircraft.data);
    // (sent elsewhere by FR24's server - the extension's word: made from FR24's)
    let went = ''; H.setAcNav(u => { went = u; });
    H.acceptAcFrom({ path: '/data/aircraft/bombardier-global/glex' }); const w1 = went; went = '';
    H.acceptAcFrom({ path: '/data/aircraft/g-abcd' });
    check('one of theirs FR24\'s server sent elsewhere (the extension saw where from): made from FR24\'s page; an aircraft\'s address of FR24\'s own never', w1 === '/data/aircraft/airbus-a320/a320?tl-ac=%2Fdata%2Faircraft%2Fbombardier-global%2Fglex' && went === '', w1);
    P.w.close();
  }

  // ---- 6. FR24's own moves to their pages: its router's XHR (and fetch) - FR24's page it is made from asked for instead -----
  { const refType = { component: 'Data/AircraftType', props: { family: { code: 'A320', name: 'Airbus A320 family', slug: 'airbus-a320' }, type: { code: 'A320', name: 'Airbus A320' }, statistics: { total: 5000 }, aircraft: { data: [{ registration: 'EI-DCY' }], current_page: 1, last_page: 100, links: [] }, photos: {}, locked: true, canonicalUrl: 'x' }, url: '/data/aircraft/airbus-a320/a320', version: 'v1' };
    const asked = [];
    const P = page('https://www.flightradar24.com/data/aircraft', null, w => {
      w.localStorage.setItem('tl.ac.add', kept.add); w.localStorage.setItem('tl.ac.ref', kept.ref);
      // (FR24's server, as far as its router asks it: FR24's own pages only)
      const serve = u => { asked.push(u); return /^\/data\/aircraft\/airbus-a320\/a320\?/.test(u) ? JSON.stringify(refType) : '{"component":"Error","props":{}}'; };
      class FX { constructor() { this.readyState = 0; this.status = 0; } open(m, u) { this.m = m; this.u = u; this.readyState = 1; } setRequestHeader() {} getAllResponseHeaders() { return 'content-type: application/json'; } getResponseHeader() { return 'application/json'; } addEventListener(k, f) { this['on' + k] = f; }
        send() { setTimeout(() => { this._t = serve(this.u); this.readyState = 4; this.status = 200; if (this.onreadystatechange) this.onreadystatechange(); if (this.onload) this.onload(); }, 5); } }
      Object.defineProperty(FX.prototype, 'responseText', { configurable: true, get() { return this._t || ''; } });
      Object.defineProperty(FX.prototype, 'response', { configurable: true, get() { return this._t || ''; } });
      w.XMLHttpRequest = FX;
      w.fetch = (u, o) => { asked.push(String(u)); return Promise.resolve(new Response(serve(String(u)), { status: 200, headers: { 'content-type': 'application/json' } })); };
    });
    const x = new P.w.XMLHttpRequest(); let got = null;
    x.onload = () => { got = JSON.parse(x.responseText); };
    x.open('GET', '/data/aircraft/bombardier-global/gl5t?page=2'); x.setRequestHeader('X-Inertia', 'true'); x.setRequestHeader('X-Inertia-Partial-Data', 'photos'); x.send();
    await until(() => P.posts.some(p => p.__tweeksLadd === 'acPage'), 1000);
    const ask = P.posts.find(p => p.__tweeksLadd === 'acPage'); await sleep(30);
    const early = asked.length;
    P.send({ __tweeksLadd: 'acPageGot', key: ask.key, page: PG });
    await until(() => got, 2000);
    check('FR24\'s router moving to one of theirs (its XHR - a page of its list, its pictures): FR24\'s page it is made from asked for instead, only once the monitor\'s page of it is here, and given to FR24 as theirs', early === 0 && asked[0] === '/data/aircraft/airbus-a320/a320?tl-ac=%2Fdata%2Faircraft%2Fbombardier-global%2Fgl5t&page=2' && got && got.component === 'Data/AircraftType' && got.props.type.code === 'GL5T' && got.props.aircraft.current_page === 2 && got.props.aircraft.data[0].registration === 'M-PORT' && got.url === '/data/aircraft/bombardier-global/gl5t?page=2', { asked, got: got && { c: got.component, url: got.url } });
    asked.length = 0;
    const r = await P.w.fetch('https://www.flightradar24.com/data/aircraft/bombardier-global/gl5t?page=2', { headers: { 'X-Inertia': 'true' } }), j = await r.json();
    check('... asked with fetch: the same (the monitor\'s page of it kept - not asked again)', /^\/data\/aircraft\/airbus-a320\/a320\?tl-ac=/.test(asked[0]) && j.component === 'Data/AircraftType' && j.props.type.code === 'GL5T' && P.posts.filter(p => p.__tweeksLadd === 'acPage').length === 1, asked);
    P.w.close();
  }

  console.log(fails ? `\n${fails} failed` : '\nall passed');
  process.exit(fails ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
