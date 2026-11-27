'use strict';
// (1.4.3) The iPhone app's native part as an id: SHA-256 of its Swift sources, its Info.plist and project.yml (the first
// 16 hex digits). A script update published with a release (update-manifest.cjs) is for the app whose native part has the
// same id - the bridge, the requests, everything the script asks of the app is the same there. ios/build.sh puts it into
// the app (Web/shell-id.txt); the release writes it into the update. Any change to the native part changes it: an app
// built before then takes no update made after, and opens the release page for its new .ipa instead.
// usage: node ios/shell-id.cjs
const fs = require('fs'), path = require('path'), crypto = require('crypto');
function shellId(dir) {
  dir = dir || __dirname;
  const app = path.join(dir, 'App');
  const files = ['project.yml', 'App/Info.plist'].concat(fs.readdirSync(app).filter(f => f.endsWith('.swift')).sort().map(f => 'App/' + f));
  const h = crypto.createHash('sha256');
  for (const f of files) { h.update(f + '\0'); h.update(fs.readFileSync(path.join(dir, f), 'utf8').replace(/\r\n/g, '\n')); h.update('\0'); }
  return h.digest('hex').slice(0, 16);
}
if (require.main === module) console.log(shellId());
module.exports = { shellId };
