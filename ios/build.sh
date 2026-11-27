#!/usr/bin/env bash
# The iPhone app's .ipa, unsigned (on a Mac with Xcode and XcodeGen - CI's ios job): the script built first ("node
# build.mjs" - dist/app), the Xcode project made from project.yml, the app built for iPhone and iPad, and the .ipa put
# together - dist/fr24-ladd-unblocker-ios.ipa. Unsigned: it is installed with a sideloading app (AltStore, Sideloadly
# ...), which signs it with the user's own Apple ID - docs/mobile.md.
set -euo pipefail
cd "$(dirname "$0")"
ROOT="$(cd .. && pwd)"
test -f "$ROOT/dist/app/app.js" || { echo "dist/app/app.js is missing: run \"node build.mjs\" first"; exit 1; }
mkdir -p Web
cp "$ROOT/dist/app/app.js" "$ROOT/dist/app/hosts.txt" Web/
# (1.4.3: what the app checks a release's script update with - the project's certificate and its own native part's id)
cp update-cert.pem Web/
node shell-id.cjs > Web/shell-id.txt
V="$(node -p "require('$ROOT/package.json').version")"
C="$(node -p "const p = '$V'.split('.').map(Number); p[0] * 10000 + p[1] * 100 + p[2]")"
xcodegen generate --spec project.yml
rm -rf build
xcodebuild -project LADDUnblocker.xcodeproj -target LADDUnblocker -configuration Release -sdk iphoneos \
  SYMROOT="$PWD/build" MARKETING_VERSION="$V" CURRENT_PROJECT_VERSION="$C" \
  CODE_SIGNING_ALLOWED=NO CODE_SIGNING_REQUIRED=NO CODE_SIGN_IDENTITY="" build
APP="build/Release-iphoneos/LADDUnblocker.app"
test -f "$APP/LADDUnblocker" || { echo "the app was not built"; exit 1; }
test -f "$APP/Web/app.js" || { echo "the script is not in the app"; exit 1; }
test -f "$APP/Web/update-cert.pem" && grep -qE '^[0-9a-f]{16}$' "$APP/Web/shell-id.txt" || { echo "the update's certificate or the app's id is not in the app"; exit 1; }
/usr/libexec/PlistBuddy -c "Print :CFBundleShortVersionString" "$APP/Info.plist" | grep -qx "$V" || { echo "the app's version is not $V"; exit 1; }
rm -rf Payload && mkdir Payload && cp -R "$APP" Payload/
mkdir -p "$ROOT/dist"
rm -f "$ROOT/dist/fr24-ladd-unblocker-ios.ipa"
zip -qry "$ROOT/dist/fr24-ladd-unblocker-ios.ipa" Payload
rm -rf Payload
echo "built $ROOT/dist/fr24-ladd-unblocker-ios.ipa ($V)"
