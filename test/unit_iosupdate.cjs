// 1.4.3 - the iPhone app updates its own script (ios/App/ScriptStore.swift, Updater.swift): a release's
// fr24-ladd-unblocker-ios-update-<id>.json (ios/update-manifest.cjs) signed with the project's key (ios/sign-update.sh),
// taken only with that signature and for the app's own native part (ios/shell-id.cjs, <id>), offered as the Android app
// offers its update (the same words):
//   - the native part's id: the same each time; changed by any change to the app's Swift, Info.plist or project.yml, not
//     by the script or its pictures
//   - the update: the release's version, the script and hosts as built (dist/app), that id
//   - signed with a keystore as the release's (JKS and PKCS12, a key password of its own): a signature the app's check
//     (RSA PKCS#1 v1.5 over SHA-256) takes, and refuses for one byte changed; checked against the certificate before it is
//     published - another certificate's: none published
//   - the certificate built into the app is the project's (the Android app's signer, pinned here)
//   - the app's code, its build and the release use the same names and checks; the release attaches what it made
//   - the offer: the Android app's words, Update / Not now, the update downloaded only on Update
// usage: node test/unit_iosupdate.cjs
const fs = require('fs'), os = require('os'), path = require('path'), crypto = require('crypto'), { execFileSync, spawnSync } = require('child_process');
const ROOT = path.join(__dirname, '..'), IOS = path.join(ROOT, 'ios');
const { shellId } = require(path.join(IOS, 'shell-id.cjs'));
const { manifest } = require(path.join(IOS, 'update-manifest.cjs'));
let fails = 0;
const check = (name, ok, info) => { if (!ok) fails++; console.log((ok ? 'PASS  ' : 'FAIL  ') + name + (info !== undefined ? '  ' + JSON.stringify(info).slice(0, 300) : '')); };
const has = cmd => spawnSync('sh', ['-c', 'command -v ' + cmd], { encoding: 'utf8' }).status === 0;

// ---- the native part's id ---------------------------------------------------------------------------------------------
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'iosid-'));
fs.cpSync(IOS, path.join(tmp, 'ios'), { recursive: true, filter: s => !/[\\/](build|Payload|LADDUnblocker\.xcodeproj)([\\/]|$)/.test(s) });
const T = path.join(tmp, 'ios'), id0 = shellId(IOS);
check('the native part\'s id: 16 hex digits, the same each time', /^[0-9a-f]{16}$/.test(id0) && shellId(IOS) === id0 && shellId(T) === id0, id0);
fs.mkdirSync(path.join(T, 'Web'), { recursive: true }); fs.writeFileSync(path.join(T, 'Web', 'app.js'), '// another script');
check('... the script (Web/app.js) is not the native part: the same id', shellId(T) === id0);
fs.appendFileSync(path.join(T, 'App', 'Updater.swift'), '\n// a change\n');
const id1 = shellId(T);
check('... a Swift file changed: another id (an app built before takes no update made after it)', id1 !== id0 && /^[0-9a-f]{16}$/.test(id1));
fs.writeFileSync(path.join(T, 'App', 'Extra.swift'), 'import Foundation\n');
check('... a Swift file added: another id again', shellId(T) !== id1);
const t2 = path.join(tmp, 'ios2'); fs.cpSync(T, t2, { recursive: true }); fs.rmSync(path.join(t2, 'App', 'Extra.swift'));
fs.writeFileSync(path.join(t2, 'App', 'Updater.swift'), fs.readFileSync(path.join(T, 'App', 'Updater.swift'), 'utf8').replace(/\n/g, '\r\n'));
check('... the same files with Windows line ends: the same id', shellId(t2) === id1);

// ---- the update -------------------------------------------------------------------------------------------------------
const built = fs.existsSync(path.join(ROOT, 'dist/app/app.js'));
if (!built) check('dist/app built (node build.mjs)', false);
else {
  const m = JSON.parse(manifest(ROOT)), pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  const hosts = fs.readFileSync(path.join(ROOT, 'dist/app/hosts.txt'), 'utf8').split(/\r?\n/).filter(Boolean);
  check('the update: v 1, the release\'s version, the app\'s native part, the script and its hosts as built', m.v === 1 && m.version === pkg.version && m.shell === id0 && m.script === fs.readFileSync(path.join(ROOT, 'dist/app/app.js'), 'utf8') && JSON.stringify(m.hosts) === JSON.stringify(hosts) && Object.keys(m).sort().join() === 'hosts,script,shell,v,version', { version: m.version, shell: m.shell, hosts: m.hosts.length });
  check('... the script it carries is this version\'s', m.script.includes("VERSION = '" + pkg.version + "'"));
}

// ---- signed as the release signs it -----------------------------------------------------------------------------------
if (!has('keytool') || !has('openssl')) console.log('(skipped: keytool or openssl not found)');
else {
  const msg = Buffer.from(JSON.stringify({ v: 1, version: '9.9.9', shell: id0, hosts: ['example.org'], script: '// x'.repeat(500) }));
  const upd = path.join(tmp, 'u.json'); fs.writeFileSync(upd, msg);
  for (const [type, keypass] of [['JKS', 'keypw-of-its-own'], ['PKCS12', 'storepw1']]) {
    const ks = path.join(tmp, 'k-' + type), cert = path.join(tmp, 'c-' + type + '.pem'), sig = path.join(tmp, 's-' + type);
    execFileSync('keytool', ['-genkeypair', '-noprompt', '-keystore', ks, '-storetype', type, '-storepass', 'storepw1', '-keypass', keypass, '-alias', 'rel', '-keyalg', 'RSA', '-keysize', '2048', '-dname', 'CN=Test', '-validity', '2'], { stdio: 'ignore' });
    fs.writeFileSync(cert, execFileSync('keytool', ['-exportcert', '-rfc', '-keystore', ks, '-storepass', 'storepw1', '-alias', 'rel'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }));
    const env = Object.assign({}, process.env, { MODULE_KEYSTORE: ks, MODULE_KEYSTORE_PASSWORD: 'storepw1', MODULE_KEY_ALIAS: 'rel', MODULE_KEY_PASSWORD: keypass });
    const r = spawnSync('bash', [path.join(IOS, 'sign-update.sh'), upd, sig, cert], { env, encoding: 'utf8' });
    const pub = crypto.createPublicKey(fs.readFileSync(cert)), s = r.status === 0 && fs.existsSync(sig) ? fs.readFileSync(sig) : null;
    // (the app's check: SecKeyVerifySignature, .rsaSignatureMessagePKCS1v15SHA256 - RSA PKCS#1 v1.5 over SHA-256)
    const ok = !!s && crypto.verify('sha256', msg, { key: pub, padding: crypto.constants.RSA_PKCS1_PADDING }, s);
    const bad = Buffer.from(msg); bad[10] ^= 1;
    check(`a ${type} keystore as the release's: a signature the app's check takes`, ok, r.stderr || r.stdout);
    check('... and refuses for one byte changed', !!s && !crypto.verify('sha256', bad, { key: pub, padding: crypto.constants.RSA_PKCS1_PADDING }, s));
    const sig2 = path.join(tmp, 's2-' + type), r2 = spawnSync('bash', [path.join(IOS, 'sign-update.sh'), upd, sig2, path.join(IOS, 'update-cert.pem')], { env, encoding: 'utf8' });
    check('... a key that is not the one the app checks with: nothing published (no signature left, a failure)', r2.status !== 0 && !fs.existsSync(sig2), r2.stdout.trim());
    check('... the key\'s files made to sign it removed', !fs.readdirSync(os.tmpdir()).some(f => /^tmp\./.test(f) && fs.existsSync(path.join(os.tmpdir(), f, 'k.pem'))));
  }
}

// ---- the certificate built into the app -------------------------------------------------------------------------------
{
  const pem = fs.readFileSync(path.join(IOS, 'update-cert.pem'), 'utf8'), x = new crypto.X509Certificate(pem);
  const fp = x.fingerprint256;
  check('the certificate built into the app: the project\'s own (the Android app\'s signer, RSA 4096)', fp === '80:D3:FF:BC:45:64:98:4D:97:FA:A0:10:26:76:A8:BA:CC:91:FE:17:95:A3:EB:77:57:BF:29:48:64:E0:4C:26' && /CN=FR24 LADD Unblocker/.test(x.subject) && x.publicKey.asymmetricKeyDetails.modulusLength === 4096, { fp, subject: x.subject });
}

// ---- the app's code, its build and the release: the same names and checks --------------------------------------------
{
  const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8');
  const store = read('ios/App/ScriptStore.swift'), upd = read('ios/App/Updater.swift'), pol = read('ios/App/Policy.swift'), web = read('ios/App/WebViewController.swift');
  const build = read('ios/build.sh'), rel = read('.github/workflows/release.yml');
  check('the app takes an update only signed with the project\'s key (RSA PKCS#1 v1.5, SHA-256, the certificate built in), for its own native part, newer than itself', /\.rsaSignatureMessagePKCS1v15SHA256/.test(store) && /SecKeyVerifySignature/.test(store) && /bundledText\("update-cert", "pem"\)/.test(store) && /shell == mine/.test(store) && /Policy\.newer\(u\.version, appVersion\)/.test(store) && /Policy\.newer\(u\.version, running\)/.test(store));
  check('... checked again each time it starts; one no newer than the app (a new .ipa since) deleted', /static func current\(\)/.test(store) && /clear\(\)/.test(store) && /ScriptStore\.current\(\)/.test(web));
  check('... from this project\'s own release downloads only, the files named for its own native part', /static func updateFiles\(_ j: \[String: Any\], shell: String\)/.test(pol) && /https:\/\/github\.com\/\\\(repo\)\/releases\/download\/\\\(tag\)\/\\\(name\)/.test(pol) && /ScriptStore\.releaseFile\(shell\)/.test(pol) && /ScriptStore\.releaseSig\(shell\)/.test(pol) && /Policy\.updateFiles\(j, shell: shell\)/.test(upd) && /let shell = ScriptStore\.shellId/.test(upd));
  check('... downloaded only on Update, then kept and FR24 loaded again with it; a failure, or a release for another native part - the release page', /func start\(/.test(upd) && /if let f = files \{ self\?\.start\(v, f\) \} else \{ UIApplication\.shared\.open\(Policy\.releasesPage\) \}/.test(upd) && /ScriptStore\.keep\(data, sig, over: from\)/.test(upd) && /self\.updated\(\)/.test(upd) && /func failed\([\s\S]*Policy\.releasesPage/.test(upd) && !/offerReload|offerIpa/.test(upd) && /Updater\(host: self, running: script\.version\) \{ \[weak self\] in self\?\.useUpdate\(\) \}/.test(web) && /removeAllUserScripts/.test(web));
  // (the Android app's words: android/app strings.xml)
  const sx = read('android/app/src/main/res/values/strings.xml'), str = n => ((sx.match(new RegExp('<string name="' + n + '">([^<]*)</string>')) || [])[1] || '\u0000').replace(/\\"/g, '"');
  const sw = t => '"' + t.replace(/%1\$s/, '\\(v)').replace(/%2\$s/, '\\(mine)') + '"';
  const words = [['update_title', 'Update available'], ['update_now'], ['update_later'], ['update_checking'], ['update_busy'], ['update_none_found']].map(([n]) => '"' + str(n) + '"');
  check('the offer in the Android app\'s words: Update available, Version x ... Update now?, Update, Not now and its notes', words.every(w => upd.includes(w)) && upd.includes(sw(str('update_text'))) && upd.includes('"' + str('update_latest').replace('%1$s', '\\(mine)') + '"') && upd.includes('"' + str('update_downloading').replace('%1$s', '\\(v)') + '"') && upd.includes(str('update_failed').replace(': %1$s', '')), words);
  check('... a version put off not offered again by itself, only when Update is pressed in the page', /if !asked && prefs\.string\(forKey: "updateLater"\) == v \{ return \}/.test(upd) && /prefs\.set\(v, forKey: "updateLater"\)/.test(upd) && /case "update": updater\?\.check\(asked: true\)/.test(web));
  check('the app built with the certificate and its own id (ios/build.sh)', /cp update-cert\.pem Web\//.test(build) && /node shell-id\.cjs > Web\/shell-id\.txt/.test(build));
  check('the release: the update made, signed, checked and attached - none without the key', /ID="\$\(node ios\/shell-id\.cjs\)"; U="dist\/fr24-ladd-unblocker-ios-update-\$ID"/.test(rel) && /node ios\/update-manifest\.cjs > "\$U\.json" && bash ios\/sign-update\.sh "\$U\.json" "\$U\.sig"/.test(rel) && /no signing key set: the iPhone app's script update is not published/.test(rel));
  check('... the names the app looks for are the ones the release publishes', /static func releaseFile\(_ shell: String\) -> String \{ "fr24-ladd-unblocker-ios-update-\\\(shell\)\.json" \}/.test(store) && /static func releaseSig\(_ shell: String\) -> String \{ "fr24-ladd-unblocker-ios-update-\\\(shell\)\.sig" \}/.test(store));
  // (the release's own lines, run: the update and its signature attached, both or neither)
  const line = (rel.match(/^ *(for U in dist\/fr24-ladd-unblocker-ios-update-\*\.json; do .*)$/m) || [])[1];
  const attach = files => { const d = fs.mkdtempSync(path.join(tmp, 'rel-')); fs.mkdirSync(path.join(d, 'dist')); for (const f of files) fs.writeFileSync(path.join(d, 'dist', f), 'x'); return spawnSync('bash', ['-c', 'set -e; IPA="dist/a.ipa"; ' + line + '; printf %s "$IPA"'], { cwd: d, encoding: 'utf8' }).stdout; };
  const nm = 'fr24-ladd-unblocker-ios-update-' + id0;
  check('... attached with the release (both files, or none)', !!line && attach([nm + '.json', nm + '.sig']) === `dist/a.ipa dist/${nm}.json dist/${nm}.sig` && attach([nm + '.json']) === 'dist/a.ipa' && attach([]) === 'dist/a.ipa', line);
}

fs.rmSync(tmp, { recursive: true, force: true });
console.log(fails ? `\n${fails} failed` : '\nall passed');
process.exit(fails ? 1 : 0);
