# Data sources

Every external source the project uses, what for, under what terms, and how it is kept within its limits. The principle throughout: **public data only, the least load possible, and nothing that requires approval or a key the user has not entered themselves.**

## ADS-B (aircraft positions)

| Source | Endpoints used | Used by | Limits and etiquette | Licence |
|---|---|---|---|---|
| **adsb.lol** | `api.adsb.lol/v2/ladd`, `/v2/mil`, `/v2/pia`, `/v2/point`, `/v2/hex`; history files `adsb.lol/globe_history/YYYY/MM/DD/traces/xx/trace_full_<hex>.json`, today's `adsb.lol/data/traces/...`, heatmaps | Monitor (primary), browser (backup) | Dynamic rate limits. Monitor: one request at a time, at least 2 s apart, at most 20 a minute, 2-minute pause on `429`. History files about 40 days back. The site now shows a proof-of-work verification page in front of its history files to clients that ask too much: the browser asks three at a time, a quarter of a second apart (the background one at a time), and when it meets the page it stops asking for 10 minutes and tells the user to open adsb.lol once. The monitor stops for an hour and reads the days from the archives below. | ODbL |
| **adsb.lol day archives** | `github.com/adsblol/globe_history_<year>/releases/download/v<Y.M.D>-planes-readsb-prod-0/...tar.aa`, `.ab`, … | Monitor | adsb.lol's own publication of every day's traces for bulk use: one tar a day in parts of about 1.9 GB (3.8 GB on 21 Oct 2026, 68,294 traces), out a few hours after the day ends. Read once per day as it downloads, never stored; one day at a time. | ODbL |
| **adsb.fi** | `opendata.adsb.fi/api/v2/mil`, `/api/v3/lat/<lat>/lon/<lon>/dist/<nm>` (v2 path as fallback), `/api/v2/hex/<hex>` | Monitor (backup), browser (area and hex lookups) | 1 request per second (public endpoints) | adsb.fi open data terms |
| **OpenSky Network** | `opensky-network.org/api/states/all` | Monitor (backup), browser (last-resort area lookups) | Anonymous daily credits. Monitor: one world snapshot per 15 minutes at most, only while adsb.lol's LADD list is silent; 6-hour pause when refused. | OpenSky terms (non-commercial) |
| **airplanes.live** | `globe.airplanes.live/globe_history/YYYY/MM/DD/traces/xx/trace_full_<hex>.json` | Monitor and browser: every day of the aircraft being looked at (today's `globe.airplanes.live/data/traces/...` too), days another network missed, history older than 40 days | Public history files only. Browser: two at a time, never in the background; 10-minute pause on a verification page. Monitor: one at a time, 2 s apart; 6-hour pause on `403`/`429`. **Its REST API requires approval and is not used.** | airplanes.live terms |
| **ADS-B Exchange** | `adsbexchange-com1.p.rapidapi.com/v2/...` (official API on RapidAPI) | Browser and monitor, only with the user's own key | Paid quota. Browser: only when the free networks cannot identify a flight. Monitor: at most 150 requests a day, only when adsb.fi fails too. **Its globe is never scraped.** | ADS-B Exchange terms |

Considered and not used:

- **airplanes.live REST API:** requires approval.
- **ADSB One:** no longer answers (`403`).
- **ADSBHub and TheAirTraffic:** feed-in only, with no query API.
- **Services that appear only on unverified aggregator pages:** not used until they can be checked.

## Flightradar24

**In the browser.** The extension and userscript run on flightradar24.com and read FR24's own answers to the page: the live feed, panels, boards, search, and airport and schedule data. They add to what FR24 shows and never override FR24's own routes or airports. FR24's own rate limits are respected: background calls are spaced, and the script backs off for a minute after any `429`. The airport panel's movements per day are counted from FR24's own schedule pages for that airport, at most once every 10 minutes, and only after the panel has been open for a moment.

**On the monitor (optional).** The monitor reads FR24's live feed (`data-feed.flightradar24.com`, the same LiveFeed and FollowFlight requests the page makes) to find the flights FR24 draws without a callsign:

- **Pace:** one world round every 2 minutes, one request every 0.4 s within it.
- **Trails:** at most one every 20 s, for flights it cannot name otherwise and for named flights as they land.
- **Refusals:** any refusal pauses it for 10 minutes, doubling up to 2 hours.
- **Headers:** it uses the feed headers a browser reports (never an authorization or cookie). It uses no account.
- **Off switch:** `"fr24Scan": false` in `monitor.json` turns it off. The browsers then do their own world scan.

Automated reading of FR24's feed is the part of the project that FR24's terms are least likely to welcome; see [legal.md](legal.md#62-database-right).

## Aircraft and airport reference data

| Source | Used for | Licence |
|---|---|---|
| OurAirports (`davidmegginson/ourairports-data`) | Airfields, heliports, seaplane bases, runways (each end in full), radio frequencies (`monitor/mkdata.cjs`) | Public domain |
| Open-Meteo GFS API (`api.open-meteo.com`, NOAA's GFS model) | Wind and temperature on nine pressure levels, for 5-degree cells where aircraft fly without Mode S EHS (most of the US, the oceans): the monitor works out true and indicated airspeed, Mach, wind and temperature from them (`monitor/wx.cjs`). Each cell every 12 hours, at most 7,000 weighted calls a day (the free tier's limit is 10,000) | Free, non-commercial; CC BY 4.0 |
| tar1090-db (`wiedehopf/tar1090-db`) | ICAO type designators, aircraft classes | See the repository's licence (used as a lookup table) |
| FAA aircraft register (MASTER / DEREG) | Build-year table by type and serial (`src/agetable.json`), US owner names | Public domain (US government) |
| Isle of Man, UK CAA G-INFO, Swiss FOCA (BAZL) registers | Owner names | Public registers |
| hexdb.io, adsbdb.com | Registration, type and owner by transponder address | Free public lookups |
| EUROCONTROL atlas FIR/UIR (via GitHub), VATSpy fallback | Airspace names | Public |
| OpenStreetMap (Overpass API) | Naming hospitals' pads, offshore platforms and estates where helicopters land | ODbL |
| JetPhotos (through FR24's own API), Planespotters API | Aircraft photos | Each photographer's copyright, shown with credit |
| aviationweather.gov | METAR/TAF for the predicted destination | Public (US government) |
| FAA NOTAM API | Airport closures (only with the user's own key) | Public (US government) |

## Owner lookups on the monitor

The monitor looks up each blocked aircraft's owner once (`monitor/owners.cjs`) and keeps it, so browsers don't each ask the registers. It uses the same code as the browser (`src/registry.js`):

| Site | Pace | On refusal |
|---|---|---|
| hexdb.io, api.adsbdb.com | one request every 1.5 s | `429`: 10 minutes; `401`/`403`: an hour |
| registry.faa.gov, ginfoapi.caa.co.uk, ardis.iomaircraftregistry.com, app02.bazl.admin.ch | one request every 3 s | the same |

It looks up one aircraft every 4 s, the ones flying now first, and asks again after 60 days. A register that did not answer is asked again an hour later. Requests say who is asking (`User-Agent: fr24-ladd-monitor …`).

## Personal data

- **Owner names only.** Registers are used for owner names; **addresses are never fetched, stored or shown.** Trustee and lessor names (for example "Bank of Utah Trustee") are replaced by the operator where it can be determined.
- **Keys stay with the user.** API keys (ADS-B Exchange, FAA NOTAM) and the monitor secret are entered by the user and stored only in their browser (IndexedDB) or on their own server. They are never sent anywhere except to the service they belong to.
- **No telemetry, one count.** The project sends no data about its user to anyone. The only thing a browser says about itself is the daily hello to the monitor that counts installs: a random install id, the version, extension or userscript, the userscript manager (or extension build), and the browser and system by name (`POST /hello`, at most every 12 hours and once after an update). It is switched off with **Count this install (anonymous)** in the LADD Unblock window; nothing is sent then. Exactly what it sends is in [PRIVACY.md](../PRIVACY.md#counting-installs).
