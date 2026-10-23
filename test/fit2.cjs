// The weights, at scale: conditional logit over pass 3's moments (test/pipe_examples.cjs), maximum likelihood with an
// L2 pull towards the starting table, full-batch Adam, the gradient computed in parallel worker threads over shared
// memory. Situations: phase x kind x height x distance (108 rows); rare evidence shares one weight per elapsed band.
// Aircraft with hash % 10 == 1 are held out of the fit as a validation set (reported every 50 iterations).
// usage: node test/fit2.cjs <examplesDir> <init logit.json> <out.json> [--iters=400] [--lambda=0.002] [--lr=0.03] [--drop=f1,f2]
//        [--workers=12] [--shared=a,b,..] [--maxEx=N]
const fs = require('fs');
const path = require('path');
const os = require('os');
const { Worker, isMainThread, parentPort, workerData } = require('worker_threads');
const NC = 144;   // elapsed band (3) x kind (4: jets, light, military, airliners) x height (4) x distance (3)
const ctxOld = c => { const el = Math.floor(c / 48), r = c % 48, kind = Math.floor(r / 12); return el * 36 + (kind === 3 ? 0 : kind) * 12 + r % 12; };
const hexHash = hex => (parseInt(hex, 16) * 2654435761 >>> 0) % 1000003;

// ---- loading: a shard's binary into flat typed arrays -------------------------------------------------------------------
function loadShards(dir, files, keep) {
  const ex = { exStart: [], exY: [], exVal: [], cCtx: [], cCtx2: [], cFr: [], cOff: [], cStart: [], fIdx: [], fVal: [], nC: 0, nF: 0, meta: [] };
  const exStart = [], exY = [], exVal = [], cCtx = [], cCtx2 = [], cFr = [], cOff = [], cStart = []; let fIdx = new Uint8Array(1 << 22), fVal = new Float32Array(1 << 22), nF = 0;
  let feat = null;
  for (const f of files) {
    const m = JSON.parse(fs.readFileSync(path.join(dir, f + '.meta.json'), 'utf8')); feat = feat || m.feat;
    const b = fs.readFileSync(path.join(dir, f + '.bin')); let o = 0;
    for (let e = 0; e < m.meta.length; e++) {
      const n = b.readUInt16LE(o), y = b.readInt16LE(o + 2); o += 4;
      const mm = m.meta[e], h = hexHash(mm[0]) % 10, use = keep(h, mm);
      const s0 = cCtx.length;
      for (let j = 0; j < n; j++) {
        const ctx = b[o], ctx2 = b[o + 1], fr = b[o + 2] / 255, off = b.readFloatLE(o + 3), nnz = b[o + 7]; o += 8;
        if (use) { cCtx.push(ctx); cCtx2.push(ctx2); cFr.push(fr); cOff.push(off); cStart.push(nF); }
        for (let k = 0; k < nnz; k++) {
          if (use) { if (nF >= fIdx.length) { const a = new Uint8Array(fIdx.length * 2); a.set(fIdx); fIdx = a; const v = new Float32Array(fVal.length * 2); v.set(fVal); fVal = v; } fIdx[nF] = b[o]; fVal[nF] = b.readFloatLE(o + 1); nF++; }
          o += 5;
        }
      }
      if (use && y >= 0) { exStart.push(s0); exY.push(y); exVal.push(h === 1 ? 1 : 0); ex.meta.push(mm); }
      else if (use) { cCtx.length = s0; cCtx2.length = s0; cFr.length = s0; cOff.length = s0; nF = cStart.length > s0 ? cStart[s0] : nF; cStart.length = s0; }
    }
  }
  cStart.push(nF); exStart.push(cCtx.length);
  return { feat, exStart: Int32Array.from(exStart), exY: Int16Array.from(exY), exVal: Uint8Array.from(exVal), cCtx: Uint8Array.from(cCtx), cCtx2: Uint8Array.from(cCtx2), cFr: Float32Array.from(cFr), cOff: Float32Array.from(cOff), cStart: Int32Array.from(cStart), fIdx: fIdx.subarray(0, nF), fVal: fVal.subarray(0, nF), meta: ex.meta };
}

if (!isMainThread) {
  // ---- worker: holds its slice of the moments; computes nll and gradient for the weights in shared memory ----------------
  const { dir, files, NF, shared, maxPer } = workerData;
  const D = loadShards(dir, files, (h) => h !== 0);
  // (--drop: features left out - their values taken as 0 - to see what they add)
  if (workerData.drop && workerData.drop.length) { const dr = new Set(workerData.drop); for (let k = 0; k < D.fIdx.length; k++) if (dr.has(D.fIdx[k])) D.fVal[k] = 0; }
  const W = new Float64Array(workerData.wBuf), SH = Uint8Array.from(shared);
  const nEx = D.exY.length;
  const row = (c, i) => SH[i] ? c - (c % 12) : c;   // (shared: one weight per elapsed band and kind)
  parentPort.postMessage({ ready: true, nEx, nVal: D.exVal.reduce((a, b) => a + b, 0), nCand: D.cCtx.length });
  const sc = new Float64Array(4096);
  parentPort.on('message', msg => {
    if (msg.cmd !== 'grad') return;
    const g = new Float64Array(W.length); let nll = 0, n = 0, vNll = 0, vN = 0, vTop = 0, tTop = 0;
    for (let e = 0; e < nEx; e++) {
      const c0 = D.exStart[e], c1 = D.exStart[e + 1], nc = c1 - c0, y = D.exY[e], val = D.exVal[e];
      let mx = -1e300;
      for (let j = 0; j < nc; j++) {
        const c = c0 + j, ctx = D.cCtx[c], ctx2 = D.cCtx2[c], fr = D.cFr[c]; let s = D.cOff[c];
        for (let k = D.cStart[c]; k < D.cStart[c + 1]; k++) { const i = D.fIdx[k], x = D.fVal[k]; const a = W[row(ctx, i) * NF + i]; s += (fr ? (1 - fr) * a + fr * W[row(ctx2, i) * NF + i] : a) * x; }
        sc[j] = s; if (s > mx) mx = s;
      }
      let z = 0; for (let j = 0; j < nc; j++) { sc[j] = Math.exp(sc[j] - mx); z += sc[j]; }
      const lp = Math.log(sc[y] / z);
      // (top-1 without the sampled tail's offsets would need rescoring; the rank among the kept candidates is shown)
      let top = 1; for (let j = 0; j < nc; j++) if (j !== y && sc[j] > sc[y]) { top = 0; break; }
      if (val) { vNll -= lp; vN++; vTop += top; continue; }
      nll -= lp; n++; tTop += top;
      for (let j = 0; j < nc; j++) {
        const coef = sc[j] / z - (j === y ? 1 : 0); if (Math.abs(coef) < 1e-7) continue;
        const c = c0 + j, ctx = D.cCtx[c], ctx2 = D.cCtx2[c], fr = D.cFr[c];
        for (let k = D.cStart[c]; k < D.cStart[c + 1]; k++) { const i = D.fIdx[k], x = D.fVal[k] * coef; g[row(ctx, i) * NF + i] += x * (1 - fr); if (fr) g[row(ctx2, i) * NF + i] += x * fr; }
      }
    }
    parentPort.postMessage({ g, nll, n, vNll, vN, vTop, tTop }, [g.buffer]);
  });
} else {
  const args = process.argv.slice(2);
  const [dir, initFile, outFile] = args.filter(a => !a.startsWith('--'));
  const opt = (k, d) => { const a = args.find(x => x.startsWith('--' + k + '=')); return a ? a.slice(k.length + 3) : d; };
  const ITERS = +opt('iters', 400), LAMBDA = +opt('lambda', 0.002), LR = +opt('lr', 0.03), NW = +opt('workers', Math.max(2, os.cpus().length - 4));
  const files = fs.readdirSync(dir).filter(f => f.endsWith('.meta.json')).map(f => f.replace('.meta.json', '')).sort();
  const FEAT = JSON.parse(fs.readFileSync(path.join(dir, files[0] + '.meta.json'), 'utf8')).feat, NF = FEAT.length;
  const DEFAULT_SHARED = 'hret,hself,hrev,haway,htrip,hlast,hhome,xc,hxc,sqTrip,fmsTrip,od,luseC,hvis,hbase,habit,arrH,rshort,unpaved,fleet,odT,odH,seqG,csOD,csD,aps,pgNever,rwyT,hseq,hseq3,hdow,hhour,hcz,htplX,hczd,dark,clbT,tasT,surge';
  const SHARED = new Set(opt('shared', DEFAULT_SHARED).split(',').filter(Boolean)), shared = FEAT.map(k => SHARED.has(k) ? 1 : 0);
  const DROP = opt('drop', '').split(',').filter(Boolean).map(k => FEAT.indexOf(k)).filter(i => i >= 0);
  const row = (c, i) => shared[i] ? c - (c % 12) : c;
  // start (and L2 anchor): the earlier table, by feature name; new evidence starts at 0
  const init = JSON.parse(fs.readFileSync(initFile, 'utf8')), ix = new Map(init.feat.map((k, i) => [k, i])), nInit = init.w.length;
  const wBuf = new SharedArrayBuffer(NC * NF * 8), W = new Float64Array(wBuf), anchor = new Float64Array(NC * NF);
  for (let c = 0; c < NC; c++) for (let i = 0; i < NF; i++) { const j = ix.get(FEAT[i]) != null ? ix.get(FEAT[i]) : FEAT[i] === 'plen' ? ix.get('pos') : null; W[c * NF + i] = anchor[c * NF + i] = j != null ? init.w[nInit >= 144 ? c : nInit >= 108 ? ctxOld(c) : ctxOld(c) % nInit][j] || 0 : 0; }
  // the files split over the workers (round robin)
  const parts = Array.from({ length: NW }, (_, k) => files.filter((_, i) => i % NW === k));
  const workers = [];
  let nEx = 0, nVal = 0, nCand = 0;
  const t0 = Date.now();
  Promise.all(parts.map(p => new Promise(res => { const w = new Worker(__filename, { workerData: { dir, files: p, NF, shared, wBuf, drop: DROP }, resourceLimits: { maxOldGenerationSizeMb: 6000 } }); w.once('message', m => { nEx += m.nEx; nVal += m.nVal; nCand += m.nCand; res(w); }); w.on('error', e => console.log('worker error', e)); workers.push(w); })))
    .then(async () => {
      console.log('moments', nEx, '(validation', nVal + ')', 'candidates', nCand, 'features', NF, 'loaded in', Math.round((Date.now() - t0) / 1000), 's');
      const m = new Float64Array(W.length), v = new Float64Array(W.length), b1 = 0.9, b2 = 0.999;
      const grad = () => Promise.all(workers.map(w => new Promise(res => { w.once('message', res); w.postMessage({ cmd: 'grad' }); })));
      let best = null, bestV = Infinity;
      for (let it = 1; it <= ITERS; it++) {
        const rs = await grad(); const g = new Float64Array(W.length); let nll = 0, n = 0, vNll = 0, vN = 0, vTop = 0, tTop = 0;
        for (const r of rs) { const gg = new Float64Array(r.g.buffer || r.g); for (let k = 0; k < g.length; k++) g[k] += gg[k]; nll += r.nll; n += r.n; vNll += r.vNll; vN += r.vN; vTop += r.vTop; tTop += r.tTop; }
        for (let k = 0; k < W.length; k++) {
          const gk = g[k] / n + LAMBDA * (W[k] - anchor[k]);
          m[k] = b1 * m[k] + (1 - b1) * gk; v[k] = b2 * v[k] + (1 - b2) * gk * gk;
          W[k] -= LR * (m[k] / (1 - Math.pow(b1, it))) / (Math.sqrt(v[k] / (1 - Math.pow(b2, it))) + 1e-8);
        }
        // (shared rows: keep the copies in step - the row used is the band's first)
        if (vN && vNll / vN < bestV) { bestV = vNll / vN; best = Float64Array.from(W); }
        if (it === 1 || it % 25 === 0) console.log(`  iter ${it} train nll ${(nll / n).toFixed(4)} top ${(100 * tTop / n).toFixed(1)}% | validation nll ${(vNll / Math.max(1, vN)).toFixed(4)} top ${(100 * vTop / Math.max(1, vN)).toFixed(1)}% | ${Math.round((Date.now() - t0) / 1000)} s`);
      }
      const Wout = best || W;
      const out = []; for (let c = 0; c < NC; c++) out.push(FEAT.map((_, i) => +Wout[row(c, i) * NF + i].toFixed(4)));
      fs.writeFileSync(outFile, JSON.stringify({ feat: FEAT, w: out, fit: { moments: nEx, validation: nVal, bestValNll: +bestV.toFixed(4), iters: ITERS, lambda: LAMBDA, built: new Date().toISOString() } }));
      console.log('written', outFile, 'best validation nll', bestV.toFixed(4));
      for (const w of workers) w.terminate();
    });
}
