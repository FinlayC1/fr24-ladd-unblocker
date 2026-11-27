'use strict';
// (1.4.3) The iPhone app's script update for a release: { v: 1, version, shell, hosts, script } - the script the app puts
// into FR24's pages (dist/app/app.js), the hosts its requests may go to (dist/app/hosts.txt), the release's version and the
// native part it was built for (shell-id.cjs). The release signs these very bytes with the project's own key
// (fr24-ladd-unblocker-ios-update.sig); the app takes the update only with that signature, checked with the certificate
// built into it (ios/update-cert.pem), and only for its own native part.
// usage: node ios/update-manifest.cjs > dist/fr24-ladd-unblocker-ios-update.json
const fs = require('fs'), path = require('path');
const { shellId } = require('./shell-id.cjs');
function manifest(root) {
  root = root || path.join(__dirname, '..');
  const version = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).version;
  const script = fs.readFileSync(path.join(root, 'dist/app/app.js'), 'utf8');
  const hosts = fs.readFileSync(path.join(root, 'dist/app/hosts.txt'), 'utf8').split(/\r?\n/).map(s => s.trim()).filter(Boolean);
  if (!/^\d{1,4}\.\d{1,4}\.\d{1,4}$/.test(version) || script.length < 1000 || !hosts.length) throw new Error('not a release build');
  return JSON.stringify({ v: 1, version, shell: shellId(path.join(root, 'ios')), hosts, script });
}
if (require.main === module) process.stdout.write(manifest());
module.exports = { manifest };
