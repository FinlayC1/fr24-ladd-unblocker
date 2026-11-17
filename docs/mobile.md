# FR24's Android app (LSPosed module)

The same work the browser extension does on FR24's website, inside FR24's own Android app (`com.flightradar24free`): the
aircraft it hides (LADD, blocked, military with no callsign) shown with their registration, type and operator, their
routes and destinations, and FR24's padlocked figures filled in from public ADS-B. The module is a small APK of this
project's code only. LSPosed loads it into the official FR24 app while that app runs on your phone, and it hooks FR24's
code from inside, the way the extension hooks FR24's website. FR24's app is never changed on disk and never redistributed.

## What you need

- A rooted Android phone, Android 10 or later (FR24's app needs 10)
- [LSPosed](https://github.com/LSPosed/LSPosed) (Zygisk), API 93 or later
- FR24's app from Google Play. Tested against 11.14.0 (`android/tools/fr24check.sh`, below); other versions are
  recognised by what their code does, not by its names (see *When FR24 updates its app*)

## Installing

1. Download `fr24-ladd-unblocker-module.apk` from the [latest release](https://github.com/FinlayC1/fr24-ladd-unblocker/releases/latest)
   (or a test build: the *fr24-ladd-unblocker-module* artifact of a [Tests run](https://github.com/FinlayC1/fr24-ladd-unblocker/actions/workflows/tests.yml)).
2. Install it.
3. In LSPosed, *Modules*: enable **FR24 LADD Unblocker**, with **Flightradar24** ticked (the only app it asks for).
4. Close FR24 (swipe it away, or *Force stop* in its App info) and open it again.

The module's own screen (from the launcher, or LSPosed's module list) has its switches: on or off, and a monitor of your
own (its address and secret). Each change applies once FR24 is closed and opened again.

## How it works

- **Where FR24's data comes in.** FR24's app gets its map, flight panel, search cards, playback and most-tracked list from
  the same gRPC service as its website (`fr24.feed.api.v1.Feed`: LiveFeed, FollowFlight, FlightDetails, Playback,
  TopFlights). The module hooks the gRPC library inside FR24's app at the two points every one of those messages passes:
  - as each answer is read: its bytes go through the script first
  - as each request is written: the same
  
  FR24's app then reads what the script gave back, as it would on the website.
- **Finding those points.** FR24's code is obfuscated, and its names change with every release (in 11.14.0, gRPC's
  `MethodDescriptor` is `bmb`). The module finds them by what they do instead: messages that are fixed in the gRPC
  library, such as "requestMarshaller" and "Invalid protobuf byte sequence" (`Targets.java`). FR24's compiled code is read
  with the module's own reader of the dex format (`Dex.java`), so the APK holds this project's code only. It does this
  once per FR24 version, on its first start, which takes about a second; the answer is kept until FR24 is updated.
- **The script.** It is the extension's own script, unchanged, run in a page of the module's own inside FR24's app: a
  WebView FR24 never shows, at FR24's address (`dist/mobile/runtime.js`, from `src/mobile/shim.js`). What a userscript
  manager gives the script (its requests to adsb.lol, adsb.fi, the monitor and so on) comes from the module's Java side
  (`Runtime.java`, `Net.java`). The page starts with FR24's first screen and pauses while FR24 is in the background.
- **Never stopping FR24.** Anything not recognised, slow or failing is left alone, and FR24's app carries on as it is:
  - FR24's code not recognised: nothing is hooked
  - the page not ready, or slower than 2.5 s: the message passes as it came, and after three slow ones in a row
    everything passes for a minute
  - the page's renderer crashing: Android is told it was handled, so FR24 is not taken down with it, and the page is
    started again

## What carries over, and what does not yet

| On the website | In FR24's app (this version) |
|---|---|
| Blocked aircraft named on the map (callsign, registration, type) | Yes (LiveFeed) |
| Their routes and predicted destinations, N/A destinations | Yes (LiveFeed) |
| The flight panel: aircraft, photos, figures FR24 padlocks | Yes (FollowFlight) |
| Search cards, playback, most tracked | Yes (FlightDetails, Playback, TopFlights) |
| Airport boards beyond FR24's free day, recent-flights lists | Not yet: FR24's app asks for these over its web API, not gRPC (the next release) |
| The LADD Unblock window, website pages (aircraft, airport, flight pages) | Not in the app: its settings are the module's own screen |

## Testing on your phone

1. Install and enable the module as above, then open FR24.
2. Over a computer, `adb logcat -s FR24LADD` shows the module's log:
   - `hooked bmb / ptd$a.b / .a`: FR24's code recognised, the hooks in
   - `page started`, then `script ready in the page`: the script running
   - `FR24's LiveFeed seen - its messages go through the script`: the map's data going through it
   - anything with `not recognised`, `not started`, `too slow` or `main thread`: worth sending, with the lines around it
3. Pan to a blocked aircraft you know (on the website it shows named). Within a few seconds, as on the website, it should
   show its callsign and registration on the map and in its panel.

## When FR24 updates its app

The module looks for its hook points again, by what they do. If FR24 changed the gRPC library so much that they cannot be
found, the log says `FR24's app (this version) not recognised: nothing hooked`, and FR24 works as it does without the
module. A new version can be checked on a computer before it is used: `android/tools/fr24check.sh <FR24's base.apk>`
runs the script's messages through FR24's own code taken from that APK (its protobuf classes, and the code that turns
the LiveFeed answer into the flights its map draws). Every check should pass. FR24's code is only read there, from an APK
you have; none of it is kept in this repository or its CI.

## Signing the module for releases

Android only installs an update over an app signed with the same key. Releases are signed with the project's own key
when the repository has it as secrets (`MODULE_KEYSTORE_B64`, `MODULE_KEYSTORE_PASSWORD`, `MODULE_KEY_ALIAS`,
`MODULE_KEY_PASSWORD`). Without them, each release is signed with a different debug key, so the old module has to be
uninstalled before the new one is installed (its settings go with it). To make a key, on your own computer (never commit it):

```
keytool -genkeypair -v -keystore fr24ladd-module.jks -alias fr24ladd -keyalg RSA -keysize 4096 -validity 36500
```

Then add the four secrets in the repository's *Settings → Secrets and variables → Actions*, with the keystore as base64
(`base64 -w0 fr24ladd-module.jks` on Linux, `[Convert]::ToBase64String([IO.File]::ReadAllBytes("fr24ladd-module.jks"))`
in PowerShell).

## Building it yourself

```
node build.mjs                      # dist/mobile/runtime.js - the script, as the module runs it
cd android && ./gradlew :module:testReleaseUnitTest :module:assembleRelease
                                    # module/build/outputs/apk/release/module-release.apk (needs ANDROID_HOME, Java 17)
```

The tests:
- `test/unit_mobile.cjs` runs the script as the module runs it, in Chromium (Android's WebView is Chromium).
- `android/module/src/test` covers the module's own parts, and its dex reader against dexlib2. It uses a test dex of our
  own (`android/tools/fixture`, rebuilt with its `build.sh`). With `FR24_APK` set, it also checks every method of an FR24
  APK.
- `android/tools/fr24check.sh` is the check by FR24's own code, above.
