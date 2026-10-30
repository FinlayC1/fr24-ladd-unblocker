'use strict';
// The owner's console and file browser (1.1.3), for the dashboard (/dash, the secret needed for every request - a monitor
// with no secret offers neither). The console runs the monitor's own commands - PowerShell's names and aliases where
// there is one - never a shell: a page that runs anything on the server is the server's to anyone who has the secret.
// The file browser shows the monitor's store and data folders, read-only: a folder's entries, the start of a file
// (gzipped ones unpacked, JSON laid out), a file whole as a download. Nothing outside those two folders is ever read.
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const PREVIEW = 256 * 1024;
const fmtSize = b => b >= 1e9 ? (b / 1e9).toFixed(2) + ' GB' : b >= 1e6 ? (b / 1e6).toFixed(1) + ' MB' : b >= 1e3 ? (b / 1e3).toFixed(1) + ' KB' : b + ' B';

function createConsole(env) {
  const roots = { store: env.store, data: env.data };
  // (a path the browser gave: "store/acdb/acdb.bin" - inside one of the two folders, after every link is followed, or null)
  function resolve(rel) {
    const parts = String(rel || '').replace(/\\/g, '/').split('/').filter(x => x && x !== '.');
    const top = parts.shift() || '';
    if (!roots[top]) return top ? null : { top: '', abs: '', rel: '' };
    if (parts.some(x => x === '..')) return null;
    const base = fs.realpathSync(roots[top]), abs = path.resolve(base, ...parts);
    let real; try { real = fs.realpathSync(abs); } catch (e) { real = abs; }
    if (real !== base && !real.startsWith(base + path.sep)) return null;
    return { top, abs: real, rel: [top].concat(parts).join('/') };
  }
  // A folder's entries, or a file's start: { path, dir: [[name, isDir, size, mtime]] } | { path, file: { size, mtime, text, cut, kind } }
  function files(rel) {
    const r = resolve(rel); if (!r) return { err: 'not inside the store or data folders' };
    if (!r.top) return { path: '', dir: Object.entries(roots).map(([k, d]) => { let st = null; try { st = fs.statSync(d); } catch (e) { /* none */ } return [k, true, 0, st ? Math.round(st.mtimeMs) : 0]; }) };
    let st; try { st = fs.statSync(r.abs); } catch (e) { return { path: r.rel, err: 'not found' }; }
    if (st.isDirectory()) {
      const out = [];
      for (const name of fs.readdirSync(r.abs).sort()) { let s = null; try { s = fs.statSync(path.join(r.abs, name)); } catch (e) { continue; } out.push([name, s.isDirectory(), s.isDirectory() ? 0 : s.size, Math.round(s.mtimeMs)]); if (out.length >= 5000) break; }
      out.sort((a, b) => (b[1] - a[1]) || a[0].localeCompare(b[0]));
      return { path: r.rel, dir: out };
    }
    return { path: r.rel, file: Object.assign({ size: st.size, mtime: Math.round(st.mtimeMs) }, preview(r.abs, st.size)) };
  }
  function preview(abs, size) {
    const fd = fs.openSync(abs, 'r');
    try {
      const n = Math.min(size, abs.endsWith('.gz') ? 4 * 1024 * 1024 : PREVIEW), buf = Buffer.alloc(n); fs.readSync(fd, buf, 0, n, 0);
      let data = buf, kind = 'text', cut = n < size;
      if (abs.endsWith('.gz')) { try { data = zlib.gunzipSync(buf, { finishFlush: zlib.constants.Z_SYNC_FLUSH }); kind = 'gzip'; } catch (e) { kind = 'binary'; } }
      if (data.length > PREVIEW) { data = data.slice(0, PREVIEW); cut = true; }
      const bin = kind !== 'gzip' && data.slice(0, 4096).some(c => c === 0);
      if (bin || kind === 'binary') { const h = []; for (let i = 0; i < Math.min(data.length, 4096); i += 16) h.push(i.toString(16).padStart(8, '0') + '  ' + [...data.slice(i, i + 16)].map(c => c.toString(16).padStart(2, '0')).join(' ')); return { kind: 'binary', text: h.join('\n'), cut: true }; }
      let text = data.toString('utf8');
      if (!cut && /\.json$/i.test(abs.replace(/\.gz$/, ''))) { try { text = JSON.stringify(JSON.parse(text), null, 2); kind = 'json'; } catch (e) { /* as it is */ } }
      return { kind, text, cut };
    } finally { fs.closeSync(fd); }
  }
  // (a file whole, for a download: its path on disk and name, or null)
  function download(rel) { const r = resolve(rel); if (!r || !r.top) return null; try { const st = fs.statSync(r.abs); return st.isFile() ? { abs: r.abs, name: path.basename(r.abs), size: st.size } : null; } catch (e) { return null; } }
  // (a folder's size: every file under it, 200,000 at most)
  function du(abs) { let bytes = 0, n = 0; const walk = d => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { if (n >= 200000) return; const p = path.join(d, e.name); if (e.isDirectory()) walk(p); else { try { bytes += fs.statSync(p).size; n++; } catch (x) { /* gone */ } } } }; walk(abs); return { bytes, files: n }; }

  // ---- the commands --------------------------------------------------------------------------------------------------
  const J = o => JSON.stringify(o, null, 2);
  const hexOf = s => {
    s = String(s || '').trim(); if (/^[0-9a-f]{6}$/i.test(s)) return s.toLowerCase();
    const reg = s.toUpperCase().replace(/[^A-Z0-9-]/g, ''); if (!reg) return '';
    return (env.hexOfReg && env.hexOfReg(reg)) || '';
  };
  const CMDS = [
    [['help', 'get-help', '?'], '', 'this list', () => CMDS.map(c => `${c[0].join(', ')}  ${c[1]}\n    ${c[2]}`).join('\n')],
    [['status', 'get-status'], '[section]', 'the monitor\'s /status, or one part of it (e.g. acdb, central, owners)', a => { const s = env.status(); return J(a[0] ? s[a[0]] : s); }],
    [['ls', 'dir', 'gci', 'get-childitem'], '[path]', 'a folder of the store or data (store/..., data/...)', a => { const f = files(a[0] || ''); if (f.err) return f.err; if (f.file) return `${f.path}  ${fmtSize(f.file.size)}  ${new Date(f.file.mtime).toISOString()}`; return (f.dir.length ? f.dir.map(([nm, d, sz, mt]) => `${d ? 'd' : '-'}  ${(d ? '' : fmtSize(sz)).padStart(10)}  ${mt ? new Date(mt).toISOString().slice(0, 19).replace('T', ' ') : ''.padEnd(19)}  ${nm}${d ? '/' : ''}`).join('\n') : '(empty)') + `\n${f.dir.length} entries`; }],
    [['cat', 'type', 'gc', 'get-content'], '<path> [-tail n]', 'a file\'s start (gzipped ones unpacked), or its last n lines', a => { const t = a.indexOf('-tail'), n = t >= 0 ? Math.max(1, +a[t + 1] || 20) : 0; const f = files(a[0]); if (f.err) return f.err; if (!f.file) return 'a folder - ls it'; return n ? f.file.text.split('\n').slice(-n).join('\n') : f.file.text + (f.file.cut ? '\n... (the start only - download it from Files for all of it)' : ''); }],
    [['du', 'get-diskusage'], '[path]', 'how much a folder holds', a => { const r = resolve(a[0] || 'store'); if (!r || !r.top) return 'not inside the store or data folders'; const d = du(r.abs); return `${r.rel}: ${fmtSize(d.bytes)} in ${d.files} files`; }],
    [['df', 'get-psdrive'], '', 'the disk the store is on', () => { try { const s = fs.statfsSync(env.store); return `free ${fmtSize(s.bavail * s.bsize)} of ${fmtSize(s.blocks * s.bsize)}`; } catch (e) { return 'not measurable here: ' + e.message; } }],
    [['mem', 'get-process', 'ps'], '', 'this process: memory, uptime, version', () => { const m = process.memoryUsage(); return J({ version: typeof env.version === 'function' ? env.version() : env.version, uptimeS: Math.round(process.uptime()), rss: fmtSize(m.rss), heapUsed: fmtSize(m.heapUsed), heapTotal: fmtSize(m.heapTotal), external: fmtSize(m.external), node: process.version }); }],
    [['aircraft', 'get-aircraft', 'ac'], '<hex|registration>', 'everything kept on one aircraft: the database, its owner, blocked or not, in view now', a => { const h = hexOf(a[0]); if (!h) return 'no such aircraft known here (a hex address or a registration)'; return J(env.aircraft(h)); }],
    [['log', 'get-log'], '[n] [text]', 'the latest log lines (300 kept), those with the text only', a => { const n = Math.min(300, Math.max(1, +a[0] || 40)), f = (isFinite(+a[0]) ? a.slice(1) : a).join(' ').toLowerCase(); return env.logLines().filter(l => !f || String(l).toLowerCase().includes(f)).slice(-n).join('\n') || '(none)'; }],
    [['airport', 'get-airport'], '<ICAO|IATA|id>', 'an airport\'s runways, usage and movements as browsers get them', a => { const ap = env.airport(a[0]); return ap ? J(env.airportAnswer(ap.id)) : 'no such airport'; }],
    [['board', 'get-board'], '<ICAO|IATA|id> [arrivals|departures] [n]', 'an airport\'s board kept here: counts, then the next n rows from now', a => { const ap = env.airport(a[0]); if (!ap) return 'no such airport'; const kind = /^d/i.test(a[1] || '') ? 'departures' : 'arrivals', n = Math.min(200, Math.max(1, +a[2] || +a[1] || 25)); return env.board(ap.id, kind, n); }],
    [['route', 'get-route'], '<hex|registration>', 'central calculation\'s latest answer for the aircraft', a => { const h = hexOf(a[0]); return h ? J(env.route(h) || 'no answer worked out for it lately') : 'no such aircraft known here'; }],
    [['acdb', 'get-acdb'], '[status|rebuild]', 'the aircraft database: its state, or build it again now', async a => { if (/^rebuild$/i.test(a[0] || '')) { if (env.acdb.status().building) return 'already building'; const ok = await env.acdb.build(); return ok ? 'built: ' + J(env.acdb.status()) : 'not built: ' + env.acdb.status().err; } return J(env.acdb.status()); }],
    [['sweep', 'invoke-sweep'], '', 'queue the world log\'s newest day\'s aircraft the database leaves something out of', async () => 'queued ' + await env.sweep() + ' aircraft for lookup'],
    [['save', 'save-state'], '', 'write everything held to disk now', () => { env.save(); return 'saved'; }],
    [['find', 'select-string', 'sls'], '<text> [path]', 'file and folder names under a folder that contain the text (500 at most)', a => { const r = resolve(a[1] || 'store'); if (!r || !r.top || !a[0]) return 'find <text> [path]'; const want = a[0].toLowerCase(), out = []; const walk = (d, rel) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { if (out.length >= 500) return; const rp = rel + '/' + e.name; if (e.name.toLowerCase().includes(want)) out.push(rp + (e.isDirectory() ? '/' : '')); if (e.isDirectory()) walk(path.join(d, e.name), rp); } }; walk(r.abs, r.rel); return out.join('\n') || '(none)'; }],
    [['restart', 'restart-service'], '', 'restart the monitor (it saves first; systemd starts it again)', () => J(env.control('/admin/restart'))],
    [['update', 'update-monitor'], '', 'update to the newest commit of the branch, checked, rolled back if it does not answer', () => J(env.control('/admin/update'))],
    [['lag', 'get-lag'], '', 'how far behind the monitor\'s main loop has run over the last minute (what every request waits behind)', () => J(env.lag ? env.lag() : null)],
    [['profile', 'measure-command'], '[seconds]', 'what the monitor spends its time on: a CPU profile of 5-120 s - the busiest functions, the whole profile kept in store/profiles/', a => profile(Math.min(120, Math.max(5, +a[0] || 20)))],
    [['clear', 'cls', 'clear-host'], '', 'clear the screen', () => '\u0000clear']
  ];
  // (the inspector's CPU profiler, in this process, for a few seconds: its samples summed by function - its own time and
  // with what it calls - and the profile written whole for Chrome's DevTools)
  let profiling = false;
  function profile(sec) {
    if (profiling) return 'a profile is already being taken';
    profiling = true;
    const inspector = require('inspector'), ses = new inspector.Session(); ses.connect();
    const post = (m, p) => new Promise((res, rej) => ses.post(m, p || {}, (e, r) => e ? rej(e) : res(r)));
    return post('Profiler.enable').then(() => post('Profiler.setSamplingInterval', { interval: 1000 })).then(() => post('Profiler.start'))
      .then(() => new Promise(r => setTimeout(r, sec * 1000))).then(() => post('Profiler.stop')).then(({ profile: pr }) => {
        const dir = path.join(env.store, 'profiles'); fs.mkdirSync(dir, { recursive: true });
        const name = new Date().toISOString().replace(/[:.]/g, '-') + '.cpuprofile'; fs.writeFileSync(path.join(dir, name), JSON.stringify(pr));
        const byId = new Map(pr.nodes.map(x => [x.id, x])), parent = new Map(), self = new Map(), incl = new Map(), dt = pr.timeDeltas || [];
        for (const x of pr.nodes) for (const c of x.children || []) parent.set(c, x.id);
        const label = x => (x.callFrame.functionName || '(anonymous)') + ' ' + String(x.callFrame.url || '').split('/').pop() + ':' + (x.callFrame.lineNumber + 1);
        let total = 0;
        pr.samples.forEach((sid, i) => {
          const t = Math.max(0, dt[i] || 0); total += t; const x = byId.get(sid); if (!x) return;
          self.set(label(x), (self.get(label(x)) || 0) + t);
          const seen = new Set(); for (let y = sid; y != null; y = parent.get(y)) { const k = label(byId.get(y)); if (!seen.has(k)) { seen.add(k); incl.set(k, (incl.get(k) || 0) + t); } }
        });
        const top = (m, n) => [...m].filter(([k]) => !/^\((root|program|idle|garbage collector)\)/.test(k)).sort((a, b) => b[1] - a[1]).slice(0, n).map(([k, t]) => `${(t / 1000).toFixed(0).padStart(7)} ms  ${(100 * t / Math.max(1, total)).toFixed(1).padStart(5)}%  ${k}`).join('\n');
        const idle = self.get('(idle) :0') || 0, gc = self.get('(garbage collector) :0') || 0;
        return `${sec} s profiled - busy ${(100 * (1 - idle / Math.max(1, total))).toFixed(0)}%, garbage collection ${(100 * gc / Math.max(1, total)).toFixed(1)}%\n\nits own time:\n${top(self, 25)}\n\nwith what it calls:\n${top(incl, 25)}\n\nthe whole profile: store/profiles/${name} (Files - download - open it in Chrome DevTools > Performance)`;
      }).finally(() => { profiling = false; try { ses.disconnect(); } catch (e) { /* closed */ } });
  }
  const byName = new Map(); for (const c of CMDS) for (const n of c[0]) byName.set(n, c);
  // (a line typed: its words - "quoted words" kept together)
  const words = line => (String(line || '').match(/"[^"]*"|'[^']*'|\S+/g) || []).map(w => w.replace(/^["']|["']$/g, ''));
  async function run(line) {
    const w = words(line); if (!w.length) return { out: '' };
    const c = byName.get(w[0].toLowerCase());
    if (!c) return { out: `'${w[0]}' is not a command here - "help" lists them`, err: true };
    try { const out = await c[3](w.slice(1)); return out === '\u0000clear' ? { clear: true, out: '' } : { out: String(out == null ? '' : out) }; } catch (e) { return { out: String(e && e.message || e), err: true }; }
  }
  return { files, download, run, resolve, words, commands: CMDS.map(c => c[0][0]) };
}

module.exports = { createConsole };
