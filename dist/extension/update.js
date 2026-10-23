// FR24 LADD Unblocker - browser extension (Chrome / Edge, loaded unpacked): the page that updates it in place.
// An unpacked extension is loaded from a folder on the person's computer, and it starts again from that folder when it is
// reloaded. So the update is: the folder chosen once (Chrome's own folder picker, and its own "allow editing" prompt -
// an extension can write nowhere without them; the handle is kept in this extension's IndexedDB, so it is not asked for
// again), the new version's files fetched from the release on GitHub - only from this repository, at the version's own
// tag, each checked against the SHA-256 the release lists (files.json, written by build.mjs) - written over the old ones,
// the old version's files the new one no longer has deleted (only those: nothing else in the folder is touched), and then
// the extension restarted and the Flightradar24 tab it was opened from loaded again (background.js).
// #tab=<id>   the Flightradar24 tab that opened this page: loaded again when the new version starts
// #wrong      the last update was written to a folder Chrome does not load the extension from (the version did not change)
const REPO = 'FinlayC1/fr24-ladd-unblocker', RAW = `https://raw.githubusercontent.com/${REPO}/`;
const ZIP = 'dist/fr24-ladd-unblocker-extension.zip';
const ME = chrome.runtime.getManifest();
const hash = new URLSearchParams(location.hash.slice(1)), TAB = parseInt(hash.get('tab'), 10) || 0, WRONG = hash.has('wrong');
const $ = id => document.getElementById(id);

// ---- a little key-value store in IndexedDB (the folder's handle can be kept there; chrome.storage cannot hold it) -------
function kv(mode, fn) {
  return new Promise((res, rej) => {
    const o = indexedDB.open('tl-update', 1);
    o.onupgradeneeded = () => o.result.createObjectStore('kv');
    o.onerror = () => rej(o.error);
    o.onsuccess = () => {
      const db = o.result, tx = db.transaction('kv', mode), r = fn(tx.objectStore('kv'));
      tx.oncomplete = () => { db.close(); res(r && r.result); };
      tx.onerror = tx.onabort = () => { db.close(); rej(tx.error); };
    };
  });
}
const kvGet = k => kv('readonly', s => s.get(k)), kvSet = (k, v) => kv('readwrite', s => s.put(v, k)), kvDel = k => kv('readwrite', s => s.delete(k));

// (1.0.0 and on are newer than every beta: the versions before it - 22.31.12 and earlier, "B22.31.12" - are numbered 20
// and up, so the first number counts only within its own line)
const verParts = v => { const s = String(v || ''), p = s.replace(/^[vB]/i, '').split('.').map(x => parseInt(x, 10) || 0); return [!/^B/i.test(s) && p[0] >= 1 && p[0] < 20 ? 1 : 0].concat(p); };
const newerThan = (a, b) => { const x = verParts(a), y = verParts(b); for (let i = 0; i < Math.max(x.length, y.length); i++) { if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) > (y[i] || 0); } return false; };
const sha256 = async buf => [...new Uint8Array(await crypto.subtle.digest('SHA-256', buf))].map(b => b.toString(16).padStart(2, '0')).join('');
// (a file of the extension: a name, or one folder deep - icons/16.png; never .. or an absolute path)
const SAFE_NAME = /^[A-Za-z0-9][\w.-]*(\/[A-Za-z0-9][\w.-]*)?$/;

async function fetchOk(url, how) {
  const r = await fetch(url, { cache: 'no-store', credentials: 'omit' });
  if (!r.ok) { const e = new Error(`${how}: HTTP ${r.status}`); e.status = r.status; throw e; }
  return r;
}
// (the newest version: main's package.json - the one released as soon as its tests pass)
async function latestVersion() {
  const j = await (await fetchOk(RAW + 'main/package.json?t=' + Math.floor(Date.now() / 60000), 'the newest version')).json();
  if (!j || typeof j.version !== 'string' || !/^\d+(\.\d+){1,3}$/.test(j.version)) throw new Error('no version in the answer');
  return j.version;
}
// (the list of a version's files and their SHA-256, at its tag; then every file, each checked against it)
async function getPlan(version, progress) {
  const base = `${RAW}v${version}/dist/extension/`;
  let list;
  try { list = await (await fetchOk(base + 'files.json', 'the list of files')).json(); } catch (e) {
    if (e.status === 404) throw new Error(`v${version} is still being published: its release is made once its tests pass. Try again in a few minutes.`);
    throw e;
  }
  if (!list || list.version !== version || !list.files || typeof list.files !== 'object') throw new Error('the list of files is not for v' + version);
  const names = Object.keys(list.files);
  if (!names.includes('manifest.json') || names.some(n => !SAFE_NAME.test(n) || n === 'files.json' || !/^[0-9a-f]{64}$/.test(list.files[n]))) throw new Error('the list of files is not valid');
  const files = [];
  for (const [i, name] of names.entries()) {
    if (progress) progress(i + 1, names.length);
    const data = await (await fetchOk(base + name, name)).arrayBuffer();
    if (await sha256(data) !== list.files[name]) throw new Error(`${name} did not download correctly (its checksum is wrong). Nothing was changed.`);
    files.push({ name, data });
  }
  const man = JSON.parse(new TextDecoder().decode(files.find(f => f.name === 'manifest.json').data));
  if (man.version !== version || man.name !== ME.name) throw new Error('the new manifest is not v' + version + ' of this extension');
  files.push({ name: 'files.json', data: new TextEncoder().encode(JSON.stringify(list, null, 2) + '\n').buffer });
  return { version, files };
}
// (the files the running version was built with - what an update may delete)
async function ownFiles() {
  try { const j = await (await fetch(chrome.runtime.getURL('files.json'))).json(); return Object.keys(j.files || {}).filter(n => SAFE_NAME.test(n)).concat('files.json'); } catch (e) { return []; }
}

async function dirOf(dir, name, create) {
  const parts = name.split('/'), file = parts.pop();
  for (const p of parts) dir = await dir.getDirectoryHandle(p, { create });
  return { dir, file };
}
async function readText(dir, name) {
  const { dir: d, file } = await dirOf(dir, name, false);
  return (await (await d.getFileHandle(file)).getFile()).text();
}
// Is this the folder Chrome loads the extension from? Its manifest names this extension at the version that is running,
// and its content script is byte for byte the one running now.
async function checkFolder(dir) {
  let man = null, same = false;
  try { man = JSON.parse(await readText(dir, 'manifest.json')); } catch (e) { /* none */ }
  if (!man || man.name !== ME.name) return `That folder doesn't hold FR24 LADD Unblocker (no manifest.json of it). Choose the folder that has manifest.json in it.`;
  if (man.version !== ME.version) return `That folder holds v${man.version}, but the extension running is v${ME.version}: it isn't the folder Chrome loads it from. Check the folder next to Source on the extension's Details.`;
  try {
    const { dir: d, file } = await dirOf(dir, 'content.js', false);
    const mine = await (await fetch(chrome.runtime.getURL('content.js'))).arrayBuffer();
    same = await sha256(await (await d.getFileHandle(file)).getFile().then(f => f.arrayBuffer())) === await sha256(mine);
  } catch (e) { /* missing */ }
  if (!same) return `That folder's files aren't the ones running: it isn't the folder Chrome loads the extension from. Check the folder next to Source on the extension's Details.`;
  return '';
}
// The new files written over the old (manifest.json last: until then Chrome would still load the old version whole), then
// the old version's files the new one has no more deleted. Each file is written whole or not at all (Chrome writes to a
// copy and swaps it in on close).
async function install(dir, plan, progress) {
  const order = plan.files.filter(f => f.name !== 'manifest.json').concat(plan.files.filter(f => f.name === 'manifest.json'));
  for (const [i, f] of order.entries()) {
    if (progress) progress(i + 1, order.length);
    const { dir: d, file } = await dirOf(dir, f.name, true);
    const w = await (await d.getFileHandle(file, { create: true })).createWritable();
    await w.write(f.data); await w.close();
  }
  const keep = new Set(plan.files.map(f => f.name)), gone = [];
  for (const name of plan.old || []) {
    if (keep.has(name)) continue;
    try { const { dir: d, file } = await dirOf(dir, name, false); await d.removeEntry(file); gone.push(name); } catch (e) { /* not there */ }
  }
  const man = JSON.parse(await readText(dir, 'manifest.json'));
  if (man.version !== plan.version) throw new Error('the folder still says v' + man.version + ' after writing');
  return { written: order.length, deleted: gone };
}

// ---- by hand: the new version's zip, downloaded here ------------------------------------------------------------------
// The zip of the very version offered - at its tag, else main's (built with it, and released from it a few minutes after)
// - fetched and saved under its version's name. (The release's "latest" link lagged behind: it gave the version before
// until the release was made, and a browser could keep handing back what it had downloaded already.)
async function zipOf(version) {
  for (const ref of [`v${version}`, 'main']) {
    let r = null; try { r = await fetch(`${RAW}${ref}/${ZIP}?t=${Date.now()}`, { cache: 'no-store', credentials: 'omit' }); } catch (e) { continue; }
    if (!r.ok) continue;
    const buf = await r.arrayBuffer(), b = new Uint8Array(buf, 0, 2);
    if (buf.byteLength > 1000 && b[0] === 0x50 && b[1] === 0x4b) return buf;
  }
  throw new Error('the zip could not be downloaded from GitHub');
}
async function download() {
  const b = $('dl'); if (b.disabled) return;
  b.disabled = true; say(`Downloading v${state.latest}…`);
  try {
    const buf = await zipOf(state.latest), url = URL.createObjectURL(new Blob([buf], { type: 'application/zip' }));
    const a = Object.assign(document.createElement('a'), { href: url, download: `fr24-ladd-unblocker-extension-v${state.latest}.zip` });
    document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 60000);
    say(`Downloaded v${state.latest}. Unzip it over the extension's folder, then click Reload extension in LADD Unblock.`, 'good');
  } catch (e) { say(`The download didn't work (${e && e.message || e}). Check your connection and try again.`, 'bad'); }
  finally { b.disabled = false; }
}

// ---- what's new: the headlines of every version newer than this one, from the changelog --------------------------------
async function news(from, to) {
  try {
    const md = await (await fetchOk(RAW + 'main/CHANGELOG.md?t=' + Math.floor(Date.now() / 60000), 'the changelog')).text();
    const items = [], vers = [];
    for (const sec of md.split(/^## \[/m).slice(1)) {
      const v = sec.slice(0, sec.indexOf(']'));
      if (!/^B?\d+(\.\d+)+$/.test(v) || !newerThan(v, from) || newerThan(v, to)) continue;
      vers.push(v);
      for (const m of sec.split(/^### Tests/m)[0].matchAll(/^- \*\*(.+?)\*\*/gm)) items.push(m[1].replace(/\.$/, ''));
      if (vers.length >= 3) break;
    }
    if (!items.length) return;
    $('newsTitle').textContent = vers.length > 1 ? `What's new since v${from}` : `What's new in v${vers[0]}`;
    for (const t of items.slice(0, 10)) $('newsList').appendChild(Object.assign(document.createElement('li'), { textContent: t }));
    $('news').hidden = false;
  } catch (e) { /* the page works without it */ }
}

// ---- the page ---------------------------------------------------------------------------------------------------------
const state = { latest: '', dir: null, busy: false };
function say(text, cls) { const m = $('msg'); m.textContent = text; m.className = cls || ''; }
function showGo(label) { const b = $('go'); b.textContent = label; b.hidden = false; b.disabled = false; $('goRow').hidden = false; }

async function load() {
  $('cur').textContent = 'v' + ME.version;
  if (WRONG) { await kvDel('dir').catch(() => {}); say(`Last time the new files went to a folder Chrome doesn't load the extension from, so it is still v${ME.version}. Choose the extension's folder again.`, 'bad'); }
  else state.dir = await kvGet('dir').catch(() => null) || null;
  try { state.latest = await latestVersion(); } catch (e) { $('latest').textContent = "couldn't check"; say("Couldn't reach GitHub to see the newest version. Check your connection, then open this page again.", 'bad'); return; }
  if (!newerThan(state.latest, ME.version)) { $('latest').textContent = `v${state.latest} (you have it)`; if (!WRONG) say('You have the newest version.', 'good'); return; }
  $('latest').textContent = 'v' + state.latest; $('latest').appendChild(Object.assign(document.createElement('span'), { className: 'tag', textContent: 'NEW' }));
  $('latestBox').classList.add('new');
  news(ME.version, state.latest);
  if (typeof window.showDirectoryPicker !== 'function') { $('manual').hidden = false; $('brave').hidden = !(navigator.brave && typeof navigator.brave.isBrave === 'function'); return; }
  if (!state.dir) { $('first').hidden = false; showGo('Choose the extension folder and update'); }
  else showGo(`Update to v${state.latest}`);
}

async function go() {
  if (state.busy) return;
  state.busy = true; $('go').disabled = true;
  try {
    // (the picker and the permission prompt need the click: asked first, before anything is awaited)
    let dir = state.dir, picked = false;
    if (dir) {
      const p = await dir.queryPermission({ mode: 'readwrite' }) === 'granted' ? 'granted' : await dir.requestPermission({ mode: 'readwrite' });
      if (p !== 'granted') throw Object.assign(new Error("Chrome wasn't allowed to edit the folder, so nothing changed. Click again and choose Allow."), { quiet: true });
    } else {
      dir = await window.showDirectoryPicker({ id: 'tl-extension', mode: 'readwrite', startIn: 'downloads' });
      picked = true;
    }
    say('Checking the folder…');
    const bad = await checkFolder(dir);
    if (bad) { if (!picked) { state.dir = null; await kvDel('dir').catch(() => {}); } throw Object.assign(new Error(bad), { quiet: true, again: true }); }
    state.dir = dir; await kvSet('dir', dir).catch(() => {});
    $('first').hidden = true;
    const plan = await getPlan(state.latest, (i, n) => say(`Downloading v${state.latest}: file ${i} of ${n}…`));
    plan.old = await ownFiles();
    await install(dir, plan, (i, n) => say(`Installing: file ${i} of ${n}…`));
    await kvSet('pending', { expect: plan.version, from: ME.version, tab: TAB, at: Date.now() });
    if (TAB) { try { chrome.tabs.sendMessage(TAB, { tlUpdated: plan.version }, () => void chrome.runtime.lastError); } catch (e) { /* the tab is gone */ } }
    $('go').hidden = true;
    say(`Done: v${plan.version} is installed. Refresh the page to start using it.`, 'good');
    $('goRow').hidden = false; $('restart').hidden = false; $('restart').focus();
  } catch (e) {
    if (e && e.name === 'AbortError') say('No folder chosen, so nothing changed.');
    else if (e && e.quiet) say(e.message, 'bad');
    else say(`The update stopped: ${e && e.message || e}. The extension is unchanged unless it says otherwise; you can try again.`, 'bad');
    if (!state.dir) { $('first').hidden = false; showGo('Choose the extension folder and update'); } else showGo(`Update to v${state.latest}`);
  } finally { state.busy = false; }
}

// (the extension starts again from its folder - this page closes with it - and background.js loads the FR24 tab again)
function restart() {
  $('restart').disabled = true; say('Restarting the extension…');
  chrome.runtime.sendMessage({ tlRestart: true, tab: TAB }, () => void chrome.runtime.lastError);
}

$('go').addEventListener('click', go);
$('dl').addEventListener('click', download);
$('restart').addEventListener('click', restart);
// (for the tests: the steps without Chrome's folder picker, which nothing can click in a test)
globalThis.__tlUpdate = { getPlan, install, checkFolder, ownFiles, latestVersion, kvGet, kvSet, zipOf, news };
load();
