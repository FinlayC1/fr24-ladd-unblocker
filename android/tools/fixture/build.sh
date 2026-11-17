#!/usr/bin/env bash
# The module's test dex (android/module/src/test/resources/fixture.dex): these classes compiled and dexed. Our own code only.
# usage: ANDROID_HOME=... android/tools/fixture/build.sh
set -euo pipefail
D="$(cd "$(dirname "$0")" && pwd)"; W="$(mktemp -d)"; trap 'rm -rf "$W"' EXIT
javac --release 8 -d "$W/cls" "$D"/fx/*.java
"${ANDROID_HOME:?set ANDROID_HOME}/build-tools/35.0.0/d8" --min-api 29 --output "$W" "$W"/cls/fx/*.class
cp "$W/classes.dex" "$D/../../module/src/test/resources/fixture.dex"
