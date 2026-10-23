# Privacy

**The short version:** the FR24 LADD Unblocker has no analytics, no tracking, no advertising and no accounts, and sells nothing. The only thing it says about itself is an anonymous count of installs, once a day, which you can switch off ([below](#counting-installs)). What it learns about aircraft is kept in your own browser and on the shared monitor, the project's server, which every client connects to by default. You can turn that off in settings, or use your own monitor instead. What the shared monitor receives from your browser, and how long it is kept, is set out below.

This policy covers the browser extension, the userscript and the monitor.

## What stays in your browser

The extension or userscript keeps a cache in your browser's own storage (IndexedDB) so that it does not ask the same questions twice:

- aircraft identities and owners;
- flight logs;
- learned routes;
- airport boards;
- your settings.

It never leaves your browser except as described below. Removing the extension or userscript, or clearing the site's data, deletes it.

The settings you enter yourself are kept in the same place: your monitor's address and secret, and your own API keys (ADS-B Exchange, FAA NOTAM). They are sent only to the service they belong to.

## What your browser asks for, and from whom

To fill in what Flightradar24 leaves blank, your browser makes requests to public data services. These are the ADS-B networks, aircraft registers, photo sites, weather and airport data, all listed in [docs/data-sources.md](docs/data-sources.md). Like any web request, these reveal your IP address to the service asked. They contain the aircraft or place being looked up, never anything about you.

When you open the LADD Unblock window, it reads this project's `package.json` from GitHub (raw.githubusercontent.com) to see whether a newer version is out, at most every half hour. Nothing is sent with it.

When you click **Update** in the extension, its update page downloads the new version's files from this repository on GitHub (raw.githubusercontent.com, at the version's release tag) and writes them into the extension's folder, which you chose and allowed it to edit. Nothing is sent with it. The folder's location stays in your browser, in the extension's own storage, and is never sent anywhere.

On flightradar24.com the extension works inside the page you opened. It reads Flightradar24's answers to that page in order to add to them. It does not read your Flightradar24 account details, cookies or passwords, and sends nothing from them anywhere.

## Counting installs

So the project knows roughly how many people use it, each install says hello to the monitor at most once every 12 hours, and once more straight after an update. The hello is a `POST /hello` to the monitor your copy uses (the shared one unless you set your own), and it carries exactly these six fields, nothing else:

| Field | What it is | Example |
|---|---|---|
| `id` | A random number your browser makes before its first hello (128 bits, written as 32 hex digits). It is not derived from anything about you, your browser or your computer; it only lets the monitor count one install once. It is kept in Flightradar24's site storage in your browser (localStorage), so updates keep it; clearing that storage makes a new one. | `3f9c…e1a0` |
| `ver` | The version installed | `22.28.9` |
| `kind` | Browser extension or userscript | `ext` / `us` |
| `handler` | For the userscript, its manager and that manager's version; for the extension, which build | `Tampermonkey 5.3`, `chrome-ext`, `firefox-ext` |
| `browser` | The browser's name only, not its version | `chrome`, `edge`, `brave`, `opera`, `firefox`, `safari` or `other` |
| `os` | The system's name only, not its version | `windows`, `mac`, `linux`, `android`, `ios` or `other` |

The browser and system are read from `navigator.userAgentData` where the browser has it, otherwise from its user agent string. Nothing about flights, the map or your Flightradar24 account is sent. The monitor keeps no IP address with the count. Like every request, the hello passes through the web server's access log described [below](#the-shared-monitor).

The monitor answers with the newest version, the oldest version still supported, and sometimes a short notice from the project's owner. These are shown on Flightradar24's map as a banner: "a new version is out", with **Update** and **Later**, or the notice, with a close button. The GitHub check above can also bring up the update banner.

**To switch it off:** open **LADD Unblock** on FR24's bottom bar and turn off **Count this install (anonymous)**. Nothing is sent from then on. Nothing is sent either while LADD Unblock itself is switched off, or while the monitor is turned off under Data sources. In Firefox, the add-on also asks Firefox's permission for "technical and interaction data" and sends nothing unless you allow it, when you install it or later from the LADD Unblock window.

## The shared monitor

Every copy connects to the project's shared monitor by default. You can change this under **Data sources** in the LADD Unblock window (on FR24's bottom bar): point it at your own monitor, or turn it off. With it off, nothing below is sent.

**What your browser sends it**

- **Requests for what it holds:**
  - the area your map shows (its centre and radius), for the aircraft there;
  - the aircraft you open, for their live figures;
  - the airport boards you open;
  - the playback moments you play, with the flight id, position and type of each flight in them that has no name yet. The monitor keeps these positions, without your address, for up to three days while it works out which aircraft each flight is;
  - the place your map is looking at, so the monitor can follow it (it keeps that place rounded to a whole degree).
  - (1.0.1) each flight your map works a route out for, as your browser sees it - Flightradar24's flight id, the aircraft, its track since it took off, Flightradar24's plan for it, its flights of the day, the weather and closures your browser has for the airports in question - so the monitor works the route out once and every browser shows the same. Kept without your address, for 30 minutes after the last time any browser sent it.
- **A report every minute:**
  - the flights without a callsign your Flightradar24 page shows (Flightradar24's flight id, position, type);
  - the names your browser found for them, in live view and in playback;
  - the owners it looked up in public registers;
  - the routes it worked out for flights the monitor names (the airports, the chance, the times), so other browsers can show them;
  - the flights it learned from: an aircraft's take-off and landing airports and times, callsign and type, as rebuilt from public ADS-B, so every browser's route engine learns from them;
  - the pictures it found of blocked aircraft: the aircraft's ICAO address and the pictures' addresses on JetPhotos or Planespotters, with their photographers' credits, so other browsers show them without looking them up.
- **Every 30 seconds:** the public ADS-B reports your browser fetched from adsb.lol, adsb.fi and TheAirTraffic around your map, so other browsers need not fetch them again.
- **Once a day at most, the hello** described under [Counting installs](#counting-installs), unless you switched it off.

**What it never receives:** your Flightradar24 account, cookies, password or e-mail address, anything typed into a page, or Flightradar24's device id for your browser. That id is sent only to a monitor of your own (one you gave a secret).

**What it keeps, and for how long**

- **About aircraft:** names of flights, owners of aircraft and flight logs, as described in [docs/monitor.md](docs/monitor.md#what-it-keeps). Owners who are private individuals are never served from it (see [docs/legal.md](docs/legal.md#5-personal-data)). What browsers send is checked before it is passed on:
  - a name or an owner is used only when two browsers agree, or the monitor's own data confirms it;
  - an ADS-B report is used only when its values are physically possible and it does not contradict the monitor's own data. It is passed on only while it is current, about two minutes;
  - a route is used only for the aircraft the monitor named, and is passed on with that flight's name for the life of the flight;
  - a learned flight is used only when it reads as a real flight. It is kept for good with the flights the monitor learns from;
  - a picture is used only when its addresses are on JetPhotos' or Planespotters' own sites. Three are kept for an aircraft, until no browser has asked for them for 120 days.
- **About you:**
  - **Your IP address, with each request,** in three places:
    - the web server's access log, which also records the request, including the area or aircraft asked about. It is kept for 14 days at most;
    - the monitor's rate limit, for one minute;
    - its dashboard, without the request's details, in memory until the next restart. Only the owner of the server sees it.
  - **For a name or owner your browser reported,** your address is kept with it in memory, for six hours at most. That lets the monitor count how many different browsers agree.
  - **For the routes, learned flights and pictures your browser sends,** and the aircraft and places it asks the monitor to follow, your address is counted in memory against an hourly allowance. The count is dropped when its hour is over. None of them is kept with your address.
  - **The places maps look at,** rounded to a degree, are kept for three days. They are not linked to any address.

The author runs the shared monitor and receives nothing else from it: no profile, no history of what you looked at.

## Your own monitor

If you point the extension at your own monitor (with its secret), the same things go to it and nowhere else. Your browser then also sends Flightradar24's feed headers once, so your monitor can read Flightradar24's map in the form the feed expects. Those headers are a device id and a platform string, plus your browser's version string, **never** an authorisation, cookie or login. What your monitor keeps stays on your server ([docs/monitor.md](docs/monitor.md#what-it-keeps)), and the author of this project receives nothing from it.

## About aircraft owners

The project looks up aircraft owners' **names** in public registers. It never fetches, stores or shows an address. It is meant for personal interest, and must not be used to track, follow or contact anyone. See [docs/legal.md](docs/legal.md#5-personal-data).

## Contact

Questions about this policy: the author, Finlay Clarke, through the repository, or rbxfinlay on Discord.
