# Notices and attributions

FR24 LADD Unblocker - Copyright © 2026 Finlay Clarke. See [LICENSE](LICENSE).

## Trademarks

"Flightradar24" is a trademark of **Flightradar24 AB**. It is used in this project only to describe the website the software works with. This project is independent: it is not affiliated with, endorsed by, sponsored by or connected to Flightradar24 AB. It uses none of its logos.

FAA, adsb.lol, adsb.fi, OpenSky Network, airplanes.live, ADS-B Exchange, JetPhotos, Planespotters, OurAirports, OpenStreetMap and other names are the property of their owners. They are used only to credit and describe sources.

## Data

| Data | Source | Terms |
|---|---|---|
| Aircraft positions, LADD / military / PIA lists, day traces, heatmaps | © [adsb.lol](https://adsb.lol) contributors | [Open Database License 1.0](https://opendatacommons.org/licenses/odbl/1-0/) |
| Aircraft positions | [adsb.fi](https://adsb.fi) | adsb.fi open-data terms |
| Aircraft positions | [The OpenSky Network](https://opensky-network.org) | OpenSky terms of use (non-commercial) |
| History files | [airplanes.live](https://airplanes.live) | airplanes.live terms |
| Aircraft positions (optional, user's own key) | ADS-B Exchange | ADS-B Exchange API terms |
| Airports, airfields, heliports, runways, radio frequencies | [OurAirports](https://ourairports.com) | Public domain |
| Names of landing sites | © [OpenStreetMap](https://www.openstreetmap.org/copyright) contributors | [Open Database License 1.0](https://opendatacommons.org/licenses/odbl/1-0/) |
| Aircraft types and classes | [tar1090-db](https://github.com/wiedehopf/tar1090-db) | That repository's licence |
| Owner names | FAA Aircraft Registry, UK CAA G-INFO, Isle of Man Aircraft Registry, Swiss FOCA register; hexdb.io, adsbdb.com | Public registers and public lookups |
| Weather | aviationweather.gov | US Government public data |
| Airspace boundaries | EUROCONTROL atlas FIR/UIR, VATSpy data project | Public |
| Photographs | JetPhotos, Planespotters | © each photographer, shown with credit |

Data derived from adsb.lol and OpenStreetMap stays under the ODbL. The shared monitor is publicly used, so the flights it logs are offered under the ODbL at `/export/legs?day=YYYY-MM-DD`. Anyone who makes another monitor's store, or a database derived from it, available to the public must do the same ([docs/legal.md](docs/legal.md#4-the-data-and-its-licences)).

## Software

The monitor and the extension use only the Node.js and browser standard libraries at run time. The development tools (`eslint`, `jsdom`, `fake-indexeddb`) are used only to build and test, under their own MIT licences, and are not distributed.
