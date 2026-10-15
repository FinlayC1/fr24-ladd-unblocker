# Privacy

**The short version:** the FR24 LADD Unblocker has no analytics, no tracking, no advertising and no accounts, and sells nothing. What it learns about aircraft is kept in your own browser and on the shared monitor, the project's server, which every copy connects to by default. You can turn that off, or use your own monitor instead. What the shared monitor receives from your browser, and how long it is kept, is set out below.

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

On flightradar24.com the extension works inside the page you opened. It reads Flightradar24's answers to that page in order to add to them. It does not read your Flightradar24 account details, cookies or passwords, and sends nothing from them anywhere.

## The shared monitor

Every copy connects to the project's shared monitor by default. You can change this under **Data sources** in the LADD Unblock window (on FR24's bottom bar): point it at your own monitor, or turn it off. With it off, nothing below is sent.

**What your browser sends it**

- **Requests for what it holds:**
  - the area your map shows (its centre and radius), for the aircraft there;
  - the aircraft you open, for their live figures;
  - the airport boards you open;
  - the playback moments you play, with the flight id, position and type of each flight in them that has no name yet. The monitor keeps these positions, without your address, for up to three days while it works out which aircraft each flight is;
  - the place your map is looking at, so the monitor can follow it (it keeps that place rounded to a whole degree).
- **A report every minute:**
  - the flights without a callsign your Flightradar24 page shows (Flightradar24's flight id, position, type);
  - the names your browser found for them, in live view and in playback;
  - the owners it looked up in public registers;
  - the routes it worked out for flights the monitor names (the airports, the chance, the times), so other browsers can show them;
  - the flights it learned from: an aircraft's take-off and landing airports and times, callsign and type, as rebuilt from public ADS-B, so every browser's route engine learns from them.
- **Every 30 seconds:** the public ADS-B reports your browser fetched from adsb.lol and adsb.fi around your map, so other browsers need not fetch them again.

**What it never receives:** your Flightradar24 account, cookies, password or e-mail address, anything typed into a page, or Flightradar24's device id for your browser. That id is sent only to a monitor of your own (one you gave a secret).

**What it keeps, and for how long**

- **About aircraft:** names of flights, owners of aircraft and flight logs, as described in [docs/monitor.md](docs/monitor.md#what-it-keeps). Owners who are private individuals are never served from it (see [docs/legal.md](docs/legal.md#5-personal-data)). What browsers send is checked before it is passed on:
  - a name or an owner is used only when two browsers agree, or the monitor's own data confirms it;
  - an ADS-B report is used only when its values are physically possible and it does not contradict the monitor's own data. It is passed on only while it is current, about two minutes;
  - a route is used only for the aircraft the monitor named, and is passed on with that flight's name for the life of the flight;
  - a learned flight is used only when it reads as a real flight. It is kept for good with the flights the monitor learns from.
- **About you:**
  - **Your IP address, with each request,** in three places:
    - the web server's access log, which also records the request, including the area or aircraft asked about. It is kept for 14 days at most;
    - the monitor's rate limit, for one minute;
    - its dashboard, without the request's details, in memory until the next restart. Only the owner of the server sees it.
  - **For a name or owner your browser reported,** your address is kept with it in memory, for six hours at most. That lets the monitor count how many different browsers agree.
  - **For the routes and learned flights your browser sends,** and the aircraft and places it asks the monitor to follow, your address is counted in memory against an hourly allowance. The count is dropped when its hour is over. Neither the routes nor the flights are kept with your address.
  - **The places maps look at,** rounded to a degree, are kept for three days. They are not linked to any address.

The author runs the shared monitor and receives nothing else from it: no profile, no history of what you looked at.

## Your own monitor

If you point the extension at your own monitor (with its secret), the same things go to it and nowhere else. Your browser then also sends Flightradar24's feed headers once, so your monitor can read Flightradar24's map in the form the feed expects. Those headers are a device id and a platform string, plus your browser's version string, **never** an authorisation, cookie or login. What your monitor keeps stays on your server ([docs/monitor.md](docs/monitor.md#what-it-keeps)), and the author of this project receives nothing from it.

## About aircraft owners

The project looks up aircraft owners' **names** in public registers. It never fetches, stores or shows an address. It is meant for personal interest, and must not be used to track, follow or contact anyone. See [docs/legal.md](docs/legal.md#5-personal-data).

## Contact

Questions about this policy: the author, Finlay Clarke, through the repository.
