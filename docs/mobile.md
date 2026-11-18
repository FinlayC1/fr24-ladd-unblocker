# Android

Two ways to have the extension's work on an Android phone:

- **The app** (no root): FR24's own site, as FR24 serves it to a phone, full-screen in an app of this project's own, with
  the script in it, as the extension puts it in on a computer. Install one APK and open it.
- **The LSPosed module** (rooted phones): the same script inside FR24's own Android app (`com.flightradar24free`).

Both are this project's code only. FR24's site is loaded from FR24, as a browser loads it, and FR24's app is never changed
or redistributed.

## The app

### Installing

1. On the phone, download `fr24-ladd-unblocker-app.apk` from the
   [latest release](https://github.com/FinlayC1/fr24-ladd-unblocker/releases/latest), or a test build: the
   *fr24-ladd-unblocker-app* artifact of a [Tests run](https://github.com/FinlayC1/fr24-ladd-unblocker/actions/workflows/tests.yml).
2. Open it. The first time, Android asks you to allow your browser to install apps.
3. Open **LADD Unblocker**.

Updates (1.3.12): the app looks for a new version when it opens (every twelve hours at most), and when you press *Update*
in the LADD Unblock window. It downloads the new APK from the latest release, checks it (GitHub's SHA-256 for it, and that
it is this app, later, signed with the same key), and Android asks you to confirm. The first time, Android asks you to let
the app install its updates ("Allow from this source"). Your settings are kept. A release signed with another key
cannot install over the app: the app tells you, and you uninstall it and install the new one from the release page (see
*Signing*). Version 1.3.11 cannot update itself: install 1.3.12 by hand once.

### What it does

Everything the extension does on FR24's site, on FR24's site as a phone gets it:
- blocked aircraft (LADD, blocked, military with no callsign) named on the map, with their routes and destinations
- the flight panel, boards, playback, most tracked, airport pages, and the LADD Unblock window with its settings (your
  monitor among them)
- a watched aircraft's alerts as the phone's own notifications
- a flight log's CSV saved to Downloads
- FR24's "my location", when you allow it: the app asks Android for the phone's location itself (1.3.12)
- LADD Unblock in FR24's bar at the bottom of the map, beside Settings, Weather and Filters, as on a computer (1.3.12)
- aircraft and flight log pages laid out as a phone app lays them out (1.3.12): a bar with the registration or flight
  number, the aircraft's pictures and details, then its flights by year, one line each - tap one for its times, status
  and its Play, KML and CSV; *Play* shows FR24's player, *Flights* goes back
- no "Open in app" pill or app banner (1.3.12)

What is different from FR24's own app:
- It is FR24's mobile site. It looks and works much like FR24's app, but it is FR24's site, not a copy of their app.
- Sign in to FR24 with your e-mail and password. A sign-in with Google, Apple or Facebook opens in a window over the
  page (1.3.12) and closes when it is done, or with *Back*. Google may still refuse sign-ins from inside an app.
- Its sign-in is its own: signing in to FR24 in Chrome does not sign you in here.
- Links away from FR24's site open in your browser.

### How it works

- **The script, before FR24's code.** The app puts the script (`dist/app/app.js`, from `build.mjs`) into each page of FR24's
  site at document start, before FR24's own code runs: `src/app/shim.js`, then the page part (`src/page.js`), then the
  userscript. It does this with AndroidX WebKit's document-start scripts, for `https://www.flightradar24.com` and
  `https://flightradar24.com` only, and in their top frame only (as the userscript's `@noframes`).
- **What a userscript manager would give it** comes from the app's Java side (`MainActivity.java`), over a bridge given to
  those pages only (`TLNative`, AndroidX WebKit's web message listener):
  - the script's requests to the other sites (`AppNet.java`): https only, to the hosts its header lists (`@connect`, each
    with its subdomains) and a monitor host you allow. Every redirect is checked too. They carry the app's own cookies
    for that host, as the extension's do.
  - notifications, a monitor host to allow (asked of you once), and files to save to Downloads
  - the phone's location (`Geo.java`): the page's `navigator.geolocation`, answered by the app
  - the app's own update (`Updater.java`, `UpdateReceiver.java`)
  - up to 32 requests at once, with the WebView's user agent where the script sets none (1.3.12: 1.3.11's four at a time
    left the monitor's check waiting behind slower answers until the script gave up on the monitor)
- **Kept private.** The preamble takes the bridge and removes it from the page's globals, so nothing FR24's page loads
  after it can use it, and the script's own functions live in a closure, not the page's globals.
- **Its rules** are in `Policy.java`: which pages stay in the app, which hosts the script may reach, and saved files' names.

### Testing it

- `adb logcat -s FR24LADD chromium` shows the app's log and the page's console.
- The checks without a phone:
  - `test/unit_app.cjs` runs `dist/app/app.js` as the app puts it in, in Chromium (Android's WebView is Chromium), with the
    app's side stood in for. It checks that the page part is in before FR24's first script, that FR24's LiveFeed answer is
    named, and the bridge's every message: the location, the update, and a log page laid out for a phone too.
  - `android/app/src/test` checks the app's rules (pages, origins, hosts, sign-in windows, the update's release and
    versions, the location's limits) and its requests against fake servers (JUnit).

## The iPhone and iPad app (1.3.12)

The Android app's twin (`ios/`): FR24's site in the app's own web view, with the same script (`dist/app/app.js`) put
into each page of FR24's site at document start, before FR24's own code runs, and the same bridge for what a userscript
manager would give it. The script cannot tell them apart, apart from which app it is (`TL_APP.platform`).

### Installing

Apple lets an app outside the App Store be installed only by signing it with an Apple ID. The release's
`fr24-ladd-unblocker-ios.ipa` is unsigned: install it with a sideloading app, which signs it with your own Apple ID:
[AltStore](https://altstore.io) or [Sideloadly](https://sideloadly.io) (on your computer). With a free Apple ID, the app
has to be signed again every 7 days (AltStore does it for you); a paid developer account makes it a year.

1. Download `fr24-ladd-unblocker-ios.ipa` from the
   [latest release](https://github.com/FinlayC1/fr24-ladd-unblocker/releases/latest), or the *fr24-ladd-unblocker-ios*
   artifact of a [Tests run](https://github.com/FinlayC1/fr24-ladd-unblocker/actions/workflows/tests.yml) on `main` (or
   one run by hand on a branch).
2. Open it with AltStore or Sideloadly and install it.
3. On the phone: *Settings → General → VPN & Device Management*, trust your Apple ID's profile (the first time).
4. Open **LADD Unblocker**.

Updates: the app looks for a new version when it opens (every twelve hours at most) and when you press *Update* in the
LADD Unblock window. iOS does not let an app install its own update: the app tells you, and opens the release page.
Install the new `.ipa` the same way; your settings stay.

### What it does

The same as the Android app: blocked aircraft named, routes, the panel, boards, playback, log pages laid out for a phone,
LADD Unblock in FR24's bar, notifications, FR24's "my location" (iOS asks you once), a flight log's CSV saved through the
share sheet (Files, AirDrop ...), sign-in windows. FR24's pages open in the app; anything else opens in Safari.

### How it works

- `WebViewController.swift`: FR24's site in a `WKWebView`, kept clear of the notch and the home bar. The bridge's
  preamble, then the script, as `WKUserScript`s at document start, top frame only; both run only on
  `https://www.flightradar24.com` and `https://flightradar24.com`. The page's messages come in through a script message
  handler (`TLNative`), only from FR24's own pages; the app's answers go back to the page's bridge under a name of this
  run's own.
- `AppNet.swift`: the script's requests - https only, to the hosts its header lists and a monitor host you allow, every
  redirect checked and followed by the app itself, with the web view's user agent.
- `Geo.swift` (the location), `Updater.swift` (the update), `Policy.swift` (the rules, as the Android app's).
- Built on a Mac by CI's `ios` job (`ios/build.sh`: XcodeGen makes the Xcode project from `ios/project.yml`; Xcode builds
  it unsigned and the `.ipa` is put together). It runs on a push to `main` - the release attaches that run's `.ipa` - or
  by hand: *Actions → Tests → Run workflow* on any branch. GitHub's Macs are few and can take minutes to start; "Waiting
  for a hosted runner to come online" is that wait.

## The LSPosed module (FR24's own app)

The same work inside FR24's own Android app. The module is a small APK of this project's code only. LSPosed loads it into
the official FR24 app while that app runs on your phone, and it hooks FR24's code from inside, the way the extension hooks
FR24's website. FR24's app is never changed on disk and never redistributed.

### What you need

- A rooted Android phone, Android 10 or later (FR24's app needs 10)
- [LSPosed](https://github.com/LSPosed/LSPosed) (Zygisk), API 93 or later
- FR24's app from Google Play. Tested against 11.14.0 (`android/tools/fr24check.sh`, below); other versions are
  recognised by what their code does, not by its names (see *When FR24 updates its app*)

### Installing

1. Download `fr24-ladd-unblocker-module.apk` from the [latest release](https://github.com/FinlayC1/fr24-ladd-unblocker/releases/latest)
   (or a test build: the *fr24-ladd-unblocker-module* artifact of a [Tests run](https://github.com/FinlayC1/fr24-ladd-unblocker/actions/workflows/tests.yml)).
2. Install it.
3. In LSPosed, *Modules*: enable **FR24 LADD Unblocker**, with **Flightradar24** ticked (the only app it asks for).
4. Close FR24 (swipe it away, or *Force stop* in its App info) and open it again.

The module's own screen (from the launcher, or LSPosed's module list) has its switches: on or off, and a monitor of your
own (its address and secret). Each change applies once FR24 is closed and opened again.

### How it works

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

### What carries over, and what does not yet

| On the website | In FR24's app (this version) |
|---|---|
| Blocked aircraft named on the map (callsign, registration, type) | Yes (LiveFeed) |
| Their routes and predicted destinations, N/A destinations | Yes (LiveFeed) |
| The flight panel: aircraft, photos, figures FR24 padlocks | Yes (FollowFlight) |
| Search cards, playback, most tracked | Yes (FlightDetails, Playback, TopFlights) |
| Airport boards beyond FR24's free day, recent-flights lists | Not yet: FR24's app asks for these over its web API, not gRPC (the next release) |
| The LADD Unblock window, website pages (aircraft, airport, flight pages) | Not in the app: its settings are the module's own screen |

### Testing on your phone

1. Install and enable the module as above, then open FR24.
2. Over a computer, `adb logcat -s FR24LADD` shows the module's log:
   - `hooked bmb / ptd$a.b / .a`: FR24's code recognised, the hooks in
   - `page started`, then `script ready in the page`: the script running
   - `FR24's LiveFeed seen - its messages go through the script`: the map's data going through it
   - anything with `not recognised`, `not started`, `too slow` or `main thread`: worth sending, with the lines around it
3. Pan to a blocked aircraft you know (on the website it shows named). Within a few seconds, as on the website, it should
   show its callsign and registration on the map and in its panel.

### When FR24 updates its app

The module looks for its hook points again, by what they do. If FR24 changed the gRPC library so much that they cannot be
found, the log says `FR24's app (this version) not recognised: nothing hooked`, and FR24 works as it does without the
module. A new version can be checked on a computer before it is used: `android/tools/fr24check.sh <FR24's base.apk>`
runs the script's messages through FR24's own code taken from that APK (its protobuf classes, and the code that turns
the LiveFeed answer into the flights its map draws). Every check should pass. FR24's code is only read there, from an APK
you have; none of it is kept in this repository or its CI.

## Signing for releases

Android only installs an update over an app signed with the same key. Releases (the app and the module) are signed with
the project's own key when the repository has it as secrets (`MODULE_KEYSTORE_B64`, `MODULE_KEYSTORE_PASSWORD`, `MODULE_KEY_ALIAS`,
`MODULE_KEY_PASSWORD`). Without them, each release is signed with a different debug key, so the old app or module has
to be uninstalled before the new one is installed (its settings go with it). To make a key, on your own computer (never commit it):

```
keytool -genkeypair -v -keystore fr24ladd-module.jks -alias fr24ladd -keyalg RSA -keysize 4096 -validity 36500
```

Then add the four secrets in the repository's *Settings → Secrets and variables → Actions*, with the keystore as base64
(`base64 -w0 fr24ladd-module.jks` on Linux, `[Convert]::ToBase64String([IO.File]::ReadAllBytes("fr24ladd-module.jks"))`
in PowerShell).

## Building it yourself

```
node build.mjs                      # dist/app/app.js and dist/mobile/runtime.js - the script, as each runs it
cd android && ./gradlew :app:testReleaseUnitTest :app:assembleRelease :module:testReleaseUnitTest :module:assembleRelease
                                    # app/build/outputs/apk/release/app-release.apk and module/.../module-release.apk
                                    # (needs ANDROID_HOME, Java 17)
```

The tests:
- `test/unit_app.cjs` and `android/app/src/test`: the app's, above.
- `test/unit_mobile.cjs` runs the script as the module runs it, in Chromium (Android's WebView is Chromium).
- `android/module/src/test` covers the module's own parts, and its dex reader against dexlib2. It uses a test dex of our
  own (`android/tools/fixture`, rebuilt with its `build.sh`). With `FR24_APK` set, it also checks every method of an FR24
  APK.
- `android/tools/fr24check.sh` is the check by FR24's own code, above.
