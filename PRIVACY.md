# Privacy

**The short version:** the FR24 LADD Unblocker collects nothing about you. It has no analytics, no tracking and no accounts. Nothing is sold or shared. What it keeps, it keeps in your own browser or on your own server.

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

On flightradar24.com the extension works inside the page you opened. It reads Flightradar24's answers to that page in order to add to them. It does not read your Flightradar24 account details, cookies or passwords, and sends nothing from them anywhere.

## Your monitor

If you connect a monitor (your own server), your browser sends it:

- requests for the data it holds;
- a report every minute: the flights without a callsign your Flightradar24 page shows, names your browser found, owners it looked up, and, once, Flightradar24's feed headers as your page sends them, with your browser's version string. The headers are a device id and platform string, **never** an authorization, cookie or login. The monitor needs them to make its own requests to Flightradar24's feed in the form the feed expects.

The monitor is yours. It keeps what it gathers on your server ([docs/monitor.md](docs/monitor.md#what-it-keeps)) and answers only browsers that hold its secret. The author of this project receives nothing from it.

## About aircraft owners

The project looks up aircraft owners' **names** in public registers. It never fetches, stores or shows an address. It is meant for personal interest, and must not be used to track, follow or contact anyone. See [docs/legal.md](docs/legal.md#5-personal-data).

## Contact

Questions about this policy: the author, Finlay Clarke, through the repository.
