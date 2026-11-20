  // ---- (1.3.12) FR24's aircraft and flight pages on a phone, in the app ---------------------------------------------------
  // FR24's log pages (/data/aircraft/<reg>, /data/flights/<number>) are its website's older pages: on a phone they are the
  // desktop page squeezed - its app banner over the top, its map's buttons over the aircraft's details, each flight a block
  // of labels. In the app (TL_APP) on a phone's width they are shown as a phone app shows them: a bar with the page's name,
  // the aircraft's pictures, its details in a grid, then its flights by year - a line each: the day, the flight, where from
  // and where to; a tap opens its times, its status and its Play, KML and CSV. All of it made from the page itself and
  // made again as the page changes (FR24's rows, the rows this script adds and fills in): the page's own buttons do the
  // work. A flight played: FR24's player, as FR24's page shows it, with a way back to the list.
  function phoneView() {
    if (typeof TL_APP !== 'object' || !TL_APP) return;
    const m = location.pathname.match(/^\/data\/(aircraft|flights)\/([^/?#]+)\/?$/i); if (!m) return;
    const kind = m[1].toLowerCase() === 'aircraft' ? 'AIRCRAFT' : 'FLIGHT', name = decodeURIComponent(m[2]).toUpperCase();
    let tries = 0;
    // (1.4.2: made from the old page FR24's new one is turned back into (06-classic) - once it is shown, everything in it
    // at once: its rows' landing places, serial number and age are in by then)
    const start = () => {
      const table = document.getElementById('tbl-datatable');
      if (!table || !document.body || document.querySelector('#content.tl-cl-wait')) { if (++tries < 600) setTimeout(start, 100); return; }
      pvBuild(table, kind, name);
    };
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true }); else start();
  }
  const PV_STYLE = `
#tl-pv{display:none}
@media (max-width:767.98px){
html.tl-pv-on:not(.tl-pv-play) body>*:not(#tl-pv){display:none!important}
html.tl-pv-on:not(.tl-pv-play) body{background:#f2f2f2!important;padding:0!important;margin:0!important}
html.tl-pv-on:not(.tl-pv-play) #tl-pv{display:block}
html.tl-pv-on.tl-pv-play #tl-pv{display:block;position:fixed;left:8px;top:8px;z-index:2147483000}
html.tl-pv-on.tl-pv-play #tl-pv>*:not(.tl-pv-backpill){display:none!important}
}
#tl-pv{font:14px/1.35 Roboto,"Segoe UI",system-ui,-apple-system,sans-serif;color:#1f1f1f;min-height:100vh;-webkit-text-size-adjust:100%}
#tl-pv a{color:#1a73c9;text-decoration:none}
#tl-pv .tl-pv-bar{position:sticky;top:0;z-index:5;display:flex;align-items:center;gap:12px;background:#2b2b2b;color:#fff;padding:10px 14px;min-height:64px;box-sizing:border-box}
#tl-pv .tl-pv-back{background:none;border:0;color:#fff;padding:6px;margin:-6px;display:flex}
#tl-pv .tl-pv-k{font-size:13px;letter-spacing:.04em;color:#e8e8e8}
#tl-pv .tl-pv-n{font-size:24px;font-weight:500;color:#f5c518;display:flex;align-items:center;gap:8px;line-height:1.15;word-break:break-word}
#tl-pv .tl-pv-n .tl-ladd-chip{font-size:11px}
#tl-pv .tl-pv-pics{display:flex;overflow-x:auto;scroll-snap-type:x mandatory;background:#2b2b2b}
#tl-pv .tl-pv-pic{flex:0 0 100%;scroll-snap-align:start;position:relative;aspect-ratio:16/10;background:#1b1b1b}
#tl-pv .tl-pv-pic img{width:100%;height:100%;object-fit:cover;display:block}
#tl-pv .tl-pv-pic span{position:absolute;left:10px;bottom:8px;color:#fff;font-size:12px;text-shadow:0 1px 3px #000}
#tl-pv .tl-pv-info{background:#3a3a3a;color:#fff;display:grid;grid-template-columns:1fr 1fr;padding:2px 14px 10px}
#tl-pv .tl-pv-f{padding:8px 6px 6px 0;border-bottom:1px solid #4a4a4a;min-width:0}
#tl-pv .tl-pv-f b{display:block;font-size:12px;font-weight:600;color:#bdbdbd;letter-spacing:.03em;text-transform:uppercase}
#tl-pv .tl-pv-f div{font-size:16px;overflow-wrap:anywhere}
#tl-pv .tl-pv-f a{color:#8ec5ff}
#tl-pv .tl-pv-year{background:#d6d6d6;color:#333;font-weight:600;padding:9px 14px;font-size:14px;letter-spacing:.03em}
#tl-pv .tl-pv-row{background:#fff;border-bottom:1px solid #e2e2e2}
#tl-pv .tl-pv-main{display:grid;grid-template-columns:14px 62px 1fr 22px;gap:4px 8px;padding:12px 14px;align-items:start;cursor:pointer}
#tl-pv .tl-pv-dot{width:9px;height:9px;border-radius:50%;background:#9e9e9e;margin-top:6px}
#tl-pv .tl-pv-dot.green{background:#3bb54a}#tl-pv .tl-pv-dot.red{background:#d9534f}#tl-pv .tl-pv-dot.yellow{background:#f0ad4e}
#tl-pv .tl-pv-date{font-size:16px;font-weight:500}
#tl-pv .tl-pv-fl{font-size:16px;font-weight:600;overflow-wrap:anywhere}
#tl-pv .tl-pv-ap{display:flex;gap:8px;align-items:center;color:#555;font-size:15px;margin-top:3px;min-width:0}
#tl-pv .tl-pv-ap svg{flex:0 0 18px;color:#777}
#tl-pv .tl-pv-ap>span{min-width:0;overflow-wrap:anywhere}
#tl-pv .tl-pv-chev{color:#1a73c9;transition:transform .15s;margin-top:4px}
#tl-pv .tl-pv-row.open .tl-pv-chev{transform:rotate(180deg)}
#tl-pv .tl-pv-more{display:none;padding:0 14px 12px 36px}
#tl-pv .tl-pv-row.open .tl-pv-more{display:block}
#tl-pv .tl-pv-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin-bottom:10px}
#tl-pv .tl-pv-grid b{display:block;font-size:11px;color:#888;font-weight:600;letter-spacing:.03em}
#tl-pv .tl-pv-grid div{font-size:15px}
#tl-pv .tl-pv-btns{display:flex;gap:8px;flex-wrap:wrap}
#tl-pv .tl-pv-btns button{border:1px solid #c9c9c9;background:#fff;color:#1f1f1f;border-radius:6px;padding:8px 14px;font:inherit;font-weight:600}
#tl-pv .tl-pv-btns button.tl-pv-play{background:#1a73c9;border-color:#1a73c9;color:#fff}
#tl-pv .tl-pv-note{padding:12px 14px;color:#555;font-size:13px;background:#fafafa;border-bottom:1px solid #e2e2e2}
#tl-pv .tl-pv-backpill{display:none;align-items:center;gap:6px;background:#2b2b2b;color:#fff;border:0;border-radius:18px;padding:8px 14px;font:600 14px/1 Roboto,system-ui,sans-serif;box-shadow:0 2px 8px rgba(0,0,0,.35)}
html.tl-pv-play #tl-pv .tl-pv-backpill{display:flex}
`;
  const PV_ICON = {
    back: '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 12H5M11 18l-6-6 6-6"/></svg>',
    off: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M3 20h18M5.5 15.5l13-6.2c1-.5 1.4-1.6.9-2.4-.4-.8-1.5-1.1-2.5-.6L13 8.4 7.3 5.6 5.6 6.4l3.8 3.5-3.6 1.7-2.1-1.1-1.2.6 2 3.5z"/></svg>',
    on: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M3 20h18M4.5 9.5l13.8 4.3c1 .3 2.1-.2 2.4-1.1.3-.9-.3-1.9-1.3-2.2L15 9.2l-3.4-5.3-1.9-.5 1.6 4.9-3.8-1.2-1.2-2-1.3-.4.4 4z"/></svg>',
    chev: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 9l6 6 6-6"/></svg>'
  };
  // (a cell's content as it is - its links, its "?" marks - copied, not its markup re-read)
  const pvCopy = el => { const f = document.createDocumentFragment(); if (el) for (const n of el.childNodes) f.appendChild(n.cloneNode(true)); return f; };
  const pvEl = (tag, cls, html) => { const e = document.createElement(tag); if (cls) e.className = cls; if (html) e.innerHTML = html; return e; };
  const pvText = el => clean(el && el.textContent || '');
  // (the page's details: each label and the value beside it - the aircraft's header, the flight's)
  function pvFields() {
    const out = [], seen = new Set();
    for (const lb of document.querySelectorAll('#cnt-aircraft-info label, #cnt-subpage-info label, .section-header label')) {
      const box = lb.closest('.row, p, div'), v = box && box.querySelector('.details');
      const k = pvText(lb).toUpperCase(); if (!v || !k || k.length > 40) continue;
      const key = k + '|' + pvText(v); if (seen.has(key)) continue; seen.add(key);
      out.push([k, v]);
    }
    return out;
  }
  function pvBuild(table, kind, name) {
    if (document.getElementById('tl-pv')) return;
    if (!document.getElementById('tl-pv-style')) { const st = document.createElement('style'); st.id = 'tl-pv-style'; st.textContent = PV_STYLE; (document.head || document.documentElement).appendChild(st); }
    const root = pvEl('div'); root.id = 'tl-pv';
    document.body.appendChild(root);
    document.documentElement.classList.add('tl-pv-on');
    const open = new Set();
    let sig = '', t = 0;
    const back = () => { if (history.length > 1) history.back(); else location.href = '/'; };
    const render = () => {
      const h1 = document.querySelector('#cnt-subpage-info h1'), chip = h1 && h1.querySelector('.tl-ladd-chip');
      const rows = [...table.querySelectorAll('tbody > tr')];
      const pics = [...document.querySelectorAll('.section-header .cnt-picture')].map(c => ({ img: c.querySelector('img'), cap: pvText(c.querySelector('.label')) })).filter(p => p.img && p.img.src);
      const fields = pvFields();
      const s = [name, chip ? chip.textContent : '', pics.map(p => p.img.src).join(','), fields.map(f => f[0] + '=' + f[1].textContent).join('|'), rows.map(r => r.className + ':' + r.textContent).join('|'), [...open].join(',')].join('#');
      if (s === sig) return; sig = s;
      const keep = window.scrollY;
      root.textContent = '';
      // (the bar: back, the page's kind and name - with the aircraft's LADD / PIA / MIL tag where it has one)
      const bar = pvEl('div', 'tl-pv-bar'), bk = pvEl('button', 'tl-pv-back', PV_ICON.back); bk.setAttribute('aria-label', 'Back'); bk.onclick = back;
      const tt = pvEl('div', 'tl-pv-t'), k = pvEl('div', 'tl-pv-k'), n = pvEl('div', 'tl-pv-n');
      k.textContent = kind; n.textContent = name; if (chip) n.appendChild(chip.cloneNode(true));
      tt.append(k, n); bar.append(bk, tt); root.appendChild(bar);
      if (pics.length) {
        const box = pvEl('div', 'tl-pv-pics');
        for (const p of pics) { const d = pvEl('div', 'tl-pv-pic'), im = document.createElement('img'); im.src = p.img.src; im.alt = p.img.alt || ''; im.loading = 'lazy'; d.appendChild(im); if (p.cap) { const c = pvEl('span'); c.textContent = p.cap; d.appendChild(c); } box.appendChild(d); }
        root.appendChild(box);
      }
      if (fields.length) {
        const info = pvEl('div', 'tl-pv-info');
        for (const [label, v] of fields) { const f = pvEl('div', 'tl-pv-f'), b = pvEl('b'), d = pvEl('div'); b.textContent = label; d.appendChild(pvCopy(v)); if (v.title) d.title = v.title; f.append(b, d); info.appendChild(f); }
        root.appendChild(info);
      }
      // (the flights: by year, as FR24's app lists them)
      let year = '';
      rows.forEach((tr, i) => {
        const c = tr.children;
        if (!tr.classList.contains('data-row') || c.length < 12) {
          const txt = pvText(tr); if (!txt) return;
          const note = pvEl('div', 'tl-pv-note'); note.appendChild(pvCopy(c[0] || tr)); root.appendChild(note); return;
        }
        const date = pvText(c[2]), dm = /^(\d{1,2})\s+([A-Za-z]{3})\s+(\d{4})$/.exec(date);
        if (dm && dm[3] !== year) { year = dm[3]; const y = pvEl('div', 'tl-pv-year'); y.textContent = 'YEAR ' + year; root.appendChild(y); }
        const key = (tr.dataset.timestamp || '') + ':' + i, row = pvEl('div', 'tl-pv-row' + (open.has(key) ? ' open' : ''));
        const main = pvEl('div', 'tl-pv-main'), dot = pvEl('span', 'tl-pv-dot'), sb = c[10] && c[10].querySelector('.state-block');
        if (sb) for (const col of ['green', 'red', 'yellow']) if (sb.classList.contains(col)) dot.classList.add(col);
        const dd = pvEl('div', 'tl-pv-date'); dd.textContent = dm ? dm[2] + ' ' + Number(dm[1]) : date;
        const mid = pvEl('div', 'tl-pv-mid'), fl = pvEl('div', 'tl-pv-fl'); fl.appendChild(pvCopy(c[5])); if (!pvText(c[5])) fl.textContent = '—';
        const apLine = (icon, td) => { const a = pvEl('div', 'tl-pv-ap', icon), sp = pvEl('span'); sp.appendChild(pvCopy(td)); if (!pvText(td)) sp.textContent = '—'; a.appendChild(sp); return a; };
        mid.append(fl, apLine(PV_ICON.off, c[3]), apLine(PV_ICON.on, c[4]));
        main.append(dot, dd, mid, pvEl('div', 'tl-pv-chev', PV_ICON.chev));
        main.onclick = ev => { if (ev.target.closest('a')) return; row.classList.toggle('open'); if (row.classList.contains('open')) open.add(key); else open.delete(key); };
        const more = pvEl('div', 'tl-pv-more'), grid = pvEl('div', 'tl-pv-grid');
        for (const [lb, td] of [['STD', c[7]], ['ATD', c[8]], ['STA', c[9]], ['STATUS', c[11]], ['FLIGHT TIME', c[6]]]) { const g = pvEl('div'), b = pvEl('b'), v = pvEl('div'); b.textContent = lb; v.textContent = pvText(td) || '—'; if (td && td.title) v.title = td.title; g.append(b, v); grid.appendChild(g); }
        more.appendChild(grid);
        // (the row's own buttons: Play / Live, KML, CSV - pressed for it)
        const btns = pvEl('div', 'tl-pv-btns');
        for (const a of c[12] ? c[12].querySelectorAll('a') : []) {
          const label = pvText(a); if (!label) continue;
          const b = pvEl('button', /btn-playback|tl-live/.test(a.className) ? 'tl-pv-play' : ''); b.type = 'button'; b.textContent = label;
          // (Play: the flight in FR24's own player page, made for a phone - its map and slider - not this page's player,
          // FR24's old one for a computer. A flight of FR24's own by its id; one known only here by the aircraft and its
          // take-off, on FR24's flights page, which the page part turns into the player - page.js mxPbAway)
          const pid = /btn-playback/.test(a.className) ? String(a.dataset.flightHex || (/^btn-playback-([0-9a-f]+)$/.exec(a.id) || [])[1] || '').toLowerCase() : '';
          b.onclick = () => {
            if (/^[0-9a-f]{1,8}$/.test(pid)) location.href = '/data/playback/' + pid;
            else if (PB_SYN.test(pid)) location.href = '/data/flights?tl-pb=' + pid;
            else a.click();
          };
          btns.appendChild(b);
        }
        if (btns.children.length) more.appendChild(btns);
        row.append(main, more); root.appendChild(row);
      });
      const pill = pvEl('button', 'tl-pv-backpill', PV_ICON.back + '<span>Flights</span>'); pill.type = 'button';
      pill.onclick = () => { document.documentElement.classList.remove('tl-pv-play'); window.scrollTo(0, 0); };
      root.appendChild(pill);
      if (window.scrollY !== keep) window.scrollTo(0, keep);
    };
    const soon = () => { if (!t) t = setTimeout(() => { t = 0; try { render(); } catch (e) { log('phone view', e); } }, 200); };
    render();
    new MutationObserver(soon).observe(table, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ['class', 'title'] });
    for (const sel of ['#cnt-aircraft-info', '.section-header', '#cnt-subpage-info']) { const el = document.querySelector(sel); if (el) new MutationObserver(soon).observe(el, { childList: true, subtree: true, characterData: true }); }
    // (a flight played: FR24's player, as its page shows it - the list again with "Flights", or when the player closes)
    const cp = document.getElementById('cnt-playback');
    // (FR24 shows its player by taking its "hidden" off - the page under this view is not shown, so its own flag is what tells)
    const playing = () => !!cp && !cp.classList.contains('hidden') && cp.style.display !== 'none';
    let was = false;
    const watch = () => {
      const now0 = playing();
      if (now0 && !was) { document.documentElement.classList.add('tl-pv-play'); setTimeout(() => { try { cp.scrollIntoView({ block: 'start' }); } catch (e) { /* as it is */ } window.dispatchEvent(new Event('resize')); }, 50); }
      else if (!now0 && was) document.documentElement.classList.remove('tl-pv-play');
      was = now0;
    };
    if (cp) new MutationObserver(watch).observe(cp, { attributes: true, attributeFilter: ['class', 'style'] });
    window.addEventListener('hashchange', () => { if (!location.hash) document.documentElement.classList.remove('tl-pv-play'); });
  }
