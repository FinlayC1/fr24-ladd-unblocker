'use strict';
// (1.3) Every airport in OurAirports that is not closed - airports, airfields and strips, heliports, seaplane and balloon
// bases - that FR24 does not list, as airports of their own: its ICAO code (else its GPS code, else OurAirports' own
// ident) and name, where it is, its height, the nearest FR24 airport (whose country and time zone it takes). Each with
// the id the route engine gives it (engine.js fieldId - the airfields the engine already knows keep theirs), so a flight
// the engine sends to one ends at that same airport everywhere: FR24's airport list in the browser, its boards and panel,
// the monitor's boards, logs and weather (apwx.cjs).
// "FR24 lists it" as the engine reads it: its code is an FR24 airport's, or it lies within that airport's own reach.
// GET /oaap gives the list once a browser starts (kept a week there): { v, at, n, rows: [[id, code, ident, name, city,
// ref (nearest FR24 airport id), lat, lon, ft, kind (L large, M medium, S small, H heliport, W seaplane base, B balloon)]] }
const fs = require('fs'), path = require('path'), zlib = require('zlib');
const KIND = { large_airport: 'L', medium_airport: 'M', small_airport: 'S', heliport: 'H', seaplane_base: 'W', balloonport: 'B' };

function cells(line) {
  const out = []; let cur = '', q = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') { if (q && line[i + 1] === '"') { cur += '"'; i++; } else q = !q; }
    else if (ch === ',' && !q) { out.push(cur); cur = ''; } else cur += ch;
  }
  out.push(cur); return out;
}

function createOaAirports(env) {
  const { E } = env, file = path.join(env.dataDir, 'oa_airports.csv');
  let list = null, byId = new Map(), gz = null, at = 0;
  // the airports, worked out once (the engine's FR24 airports and fields loaded first)
  function build() {
    list = []; byId = new Map();
    if (!fs.existsSync(file) || typeof E.fieldId !== 'function') return list;
    const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/), head = cells(lines[0] || ''), ix = k => head.indexOf(k);
    const [cT, cN, cLa, cLo, cE, cM, cI, cG, cId, cA] = ['type', 'name', 'latitude_deg', 'longitude_deg', 'elevation_ft', 'municipality', 'icao_code', 'gps_code', 'ident', 'iata_code'].map(ix);
    const fr24Iata = new Set(), fr24Code = new Set();
    for (const a of E.airports) if (a.id < 1e7) { if (a.iata) { fr24Iata.add(String(a.iata).toUpperCase()); fr24Code.add(String(a.iata).toUpperCase()); } if (a.icao) fr24Code.add(String(a.icao).toUpperCase()); }
    const taken = new Set();
    for (let i = 1; i < lines.length; i++) {
      const l = lines[i]; if (!l) continue;
      const r = cells(l), kind = KIND[r[cT]]; if (!kind) continue;               // (closed ones, and anything else, left out)
      const lat = +r[cLa], lon = +r[cLo]; if (!Number.isFinite(lat) || !Number.isFinite(lon) || r[cLa] === '' || r[cLo] === '') continue;
      const ident = String(r[cI] || r[cG] || r[cId] || '').toUpperCase().trim(); if (!ident) continue;
      const own = E.byIcao(ident); if (own && own.id < 1e7) continue;           // (FR24 lists it by its code)
      const iata = String(r[cA] || '').toUpperCase().trim(); if (iata && fr24Iata.has(iata)) continue;
      // (inside an FR24 airport's own reach - 2.5 km, more for a big one: part of that airport, as the engine has it)
      let listed = false;
      E.nearby(lat, lon, 5.5, (a, d) => { if (a.id < 1e7 && d <= Math.max(2.5, 1.5 + Math.min(3.5, Math.log10(1 + (a.size || 0)) * 0.7) + 0.5)) listed = true; });
      if (listed) continue;
      const id = E.fieldId(ident); if (byId.has(id)) continue;
      const ref = E.airportAt(lat, lon, 300), refId = ref && ref.airport && ref.airport.id < 1e7 ? ref.airport.id : 0;
      // (its code as shown and in its address: never one of FR24's own airports' codes, never another of these)
      const oaId = String(r[cId] || '').toUpperCase().trim(), code = [/^[A-Z]{3}$/.test(iata) ? iata : '', ident, oaId].find(k => k && !fr24Code.has(k) && !taken.has(k)) || ('OA' + id);
      taken.add(code);
      const row = [id, code, ident, String(r[cN] || ident), String(r[cM] || ''), refId, Math.round(lat * 1e5) / 1e5, Math.round(lon * 1e5) / 1e5, Math.round(+r[cE] || 0), kind];
      list.push(row); byId.set(id, row);
    }
    at = Date.now(); gz = null;
    return list;
  }
  const rows = () => list || build();
  // an airport of the list by its id, in the engine's form (for the monitor's weather and boards)
  function get(id) {
    const r = (rows(), byId.get(id)); if (!r) return null;
    return { id: r[0], iata: r[1] === r[2] ? '' : r[1], icao: r[2], code: r[1], name: r[3], city: r[4], lat: r[6], lon: r[7], alt: r[8], kind: r[9], ref: r[5] };
  }
  function body() { if (!gz) gz = zlib.gzipSync(Buffer.from(JSON.stringify({ v: 1, at, n: rows().length, rows: rows() }))); return gz; }
  return { rows, get, body, get size() { return rows().length; } };
}
module.exports = { createOaAirports };
