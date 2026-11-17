#!/usr/bin/env bash
# The module's messages checked by FR24's own code, on a computer - for a new version of FR24's app before it is used with
# the module (FR24's code is FR24's: it is read here from an APK you have, and never kept in the repository):
#   1. FR24's APK read for the module's hook targets (Targets, with the module's own dex reader - what it does on the phone)
#   2. FR24's code made runnable on Java (dex2jar, then FixNew: R8's constructor folding put right from the dex itself)
#   3. the script run as the module runs it (test/unit_mobile.cjs, in Chromium), every message it gives back kept
#   4. each of them read by FR24's own marshaller and written again by it, and FR24's own map code run on the LiveFeed answer
#      (Fr24Check): what FR24's app would hold of each
# usage: android/tools/fr24check.sh <FR24's base.apk>
# needs: Java 17+, Gradle, Node with Playwright's Chromium, ANDROID_HOME (for android.jar), and network for the tools
set -euo pipefail
APK="$(cd "$(dirname "$1")" && pwd)/$(basename "$1")"
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
W="$(mktemp -d)"; trap 'rm -rf "$W"' EXIT
ANDROID_JAR="${ANDROID_HOME:?set ANDROID_HOME}/platforms/android-35/android.jar"
test -f "$ANDROID_JAR" || { echo "no $ANDROID_JAR (sdkmanager \"platforms;android-35\")"; exit 1; }

# (the tools: dex2jar, dexlib2, ASM - from Maven Central)
cat > "$W/build.gradle" <<'EOF'
plugins { id 'java' }
repositories { mavenCentral(); google() }
dependencies {
  implementation 'de.femtopedia.dex2jar:dex-tools:2.4.39'
  implementation 'com.android.tools.smali:smali-dexlib2:3.0.9'
  implementation 'org.ow2.asm:asm:9.8'
}
tasks.register('libs', Copy) { from configurations.runtimeClasspath; into 'libs' }
EOF
echo "rootProject.name='fr24check'" > "$W/settings.gradle"
(cd "$W" && gradle -q --no-daemon libs)
LIBS="$W/libs/*"

mkdir -p "$W/dex" "$W/jar" "$W/fix" "$W/cls"
(cd "$W/dex" && unzip -q -o "$APK" 'classes*.dex')
for d in "$W"/dex/classes*.dex; do java -cp "$LIBS" com.googlecode.dex2jar.tools.Dex2jarCmd -f -o "$W/jar/$(basename "$d" .dex).jar" "$d" > /dev/null; done
M="$ROOT/android/module/src/main/java/io/github/finlayc1/fr24ladd"
javac -d "$W/cls" -cp "$LIBS" "$M/Targets.java" "$M/Dex.java" "$ROOT/android/tools/FixNew.java" "$ROOT/android/tools/Fr24Check.java"
for j in "$W"/jar/*.jar; do java -Xmx6g -cp "$W/cls:$LIBS" FixNew "$APK" "$j" "$W/fix/$(basename "$j")"; done

(cd "$ROOT" && node build.mjs > /dev/null && TL_DUMP="$W/dump" node test/unit_mobile.cjs)
# (dex2jar writes no stack map frames: Java's verifier is left out for FR24's converted code)
java -XX:+UnlockDiagnosticVMOptions -XX:-BytecodeVerificationRemote -XX:-BytecodeVerificationLocal -cp "$W/cls:$LIBS" Fr24Check "$APK" "$W/fix" "$ANDROID_JAR" "$W/dump"
