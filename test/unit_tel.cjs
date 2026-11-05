// (1.2.4) The monitor's telemetry store (monitor/tel.cjs): the squawk each aircraft was last heard with in the air, kept 16
// hours after its reports themselves are let go (two minutes) - for FR24's panel of a flight no receiver hears now
// usage: node test/unit_tel.cjs
const { createTel } = require('../monitor/tel.cjs');
let fails = 0;
const check = (name, ok, extra) => { if (!ok) fails++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra !== undefined ? '  ' + JSON.stringify(extra) : ''}`); };
const T = 1793000000, tel = createTel({});
tel.add([{ hex: '3c6444', lat: 50, lon: 5, alt_baro: 36000, squawk: '1000', seen_pos: 0 }, { hex: '4ca123', lat: 53, lon: -6, alt_baro: 'ground', squawk: '7000', seen_pos: 0 }], T);
tel.addCrowd([['400abc', 51.5, -1.2, 24000, 420, 90, 0, '6171', null, null, null, null, null, null, null, T - 5]], T);
check('a squawk heard in the air kept, from the monitor\'s own lists and the browsers\' reports; one on the ground not', JSON.stringify(tel.lastSq(['3c6444', '400abc', '4ca123', 'ffffff'], T)) === JSON.stringify({ '3c6444': ['1000', T], '400abc': ['6171', T - 5] }), tel.lastSq(['3c6444', '400abc', '4ca123'], T));
tel.prune(T + 3600);
check('... an hour on: the reports gone, the squawks kept', tel.get(['3c6444'], T + 3600).length === 0 && tel.lastSq(['3c6444'], T + 3600)['3c6444'][0] === '1000');
tel.add([{ hex: '3c6444', lat: 51, lon: 6, alt_baro: 38000, squawk: '2341', seen_pos: 0 }], T + 3700);
check('... a newer one replaces it', tel.lastSq(['3c6444'], T + 3700)['3c6444'][0] === '2341');
tel.prune(T + 3700 + 16 * 3600 + 1);
check('... after 16 hours: let go', !tel.lastSq(['3c6444'], T + 3700 + 16 * 3600 + 1)['3c6444'] && tel.sqSize === 0, tel.sqSize);
console.log(fails ? `\n${fails} failed` : '\nall passed');
process.exitCode = fails ? 1 : 0;
