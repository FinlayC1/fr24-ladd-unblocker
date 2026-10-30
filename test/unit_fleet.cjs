// (1.1.0) Fleet habits on the monitor (monitor.cjs fleetOf): the aircraft one owner has - as the owner lookups found it -
// and where the others flew in the last 60 days, the same for every browser:
//   - three aircraft of one company: each one's fleet the other two's airports (both ends of each flight), counted;
//   - a flight older than 60 days, a flight back where it began, the same flight twice: not counted;
//   - an aircraft held by a trust company or a bank (a registration service, not an operator): no fleet;
//   - an owner of one aircraft, or of more than fifteen (a lessor): no fleet.
// usage: node test/unit_fleet.cjs [dataDir]
const fs = require('fs'), os = require('os'), path = require('path');
process.env.MON_DATA = process.argv[2] || path.join(__dirname, '../monitor/data');
process.env.MON_STORE = fs.mkdtempSync(path.join(os.tmpdir(), 'monfleet-'));
const M = require('../monitor/monitor.cjs');
M.loadEngine();
const E = M.E;
let fails = 0;
const check = (name, ok, info) => { if (!ok) fails++; console.log((ok ? 'PASS  ' : 'FAIL  ') + name + (info !== undefined ? '  ' + JSON.stringify(info).slice(0, 500) : '')); };
const ap = c => E.byIcao(c).id, now = Date.now() / 1000;
const leg = (o, d, ago) => ({ from: { id: ap(o), conf: 'ground' }, to: { id: ap(d), conf: 'ground' }, tStart: now - ago, tEnd: now - ago + 3600, open: false });
const own = (hex, owner) => M.owners.db.set(hex, { owner, at: now, ok: true });
own('a10001', 'ACME AVIATION LLC'); own('a10002', 'Acme Aviation, LLC'); own('a10003', 'ACME AVIATION LLC');
M.legs.set('a10002', new Map([[1, leg('KTEB', 'KMIA', 86400)], [2, leg('KMIA', 'KTEB', 3 * 86400)], [3, leg('KMIA', 'KTEB', 3 * 86400)], [4, leg('KTEB', 'KTEB', 2 * 86400)], [5, leg('KTEB', 'KASE', 70 * 86400)]]));
M.legs.set('a10003', new Map([[1, leg('KTEB', 'KHPN', 5 * 86400)]]));
M.legs.set('a10001', new Map([[1, leg('KTEB', 'EGGW', 86400)]]));
const f1 = M.fleetOf('a10001'), o = f1 ? Object.fromEntries([...f1].map(([id, n]) => [E.byId(id).icao, n])) : null;
check('three aircraft of one company (its name written two ways): the fleet\'s airports - both ends of each flight of the other two, counted - not its own flights', !!o && o.KTEB === 3 && o.KMIA === 2 && o.KHPN === 1 && !o.EGGW, o);
check('... a flight older than 60 days, one back where it began, the same flight twice: not counted', !!o && !o.KASE && o.KTEB === 3);
own('a20001', 'WILMINGTON TRUST CO TRUSTEE'); own('a20002', 'WILMINGTON TRUST CO TRUSTEE'); M.legs.set('a20002', new Map([[1, leg('KTEB', 'KMIA', 86400)]]));
M.FL.at = 0;
check('an aircraft held by a trust company: no fleet (a registration service, not an operator)', M.fleetOf('a20001') === null);
own('a30001', 'SOLO JET LLC');
for (let i = 0; i < 17; i++) own('a4' + String(i).padStart(4, '0'), 'BIG LEASING HOLDINGS');
M.FL.at = 0;
check('an owner of one aircraft, or of seventeen (a lessor): no fleet', M.fleetOf('a30001') === null && M.fleetOf('a40000') === null);
console.log(fails ? `\n${fails} FAILED` : '\nall passed');
process.exit(fails ? 1 : 0);
