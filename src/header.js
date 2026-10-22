// ==UserScript==
// @name         Flightradar24 LADD / N-A Unblocker (feed-level)
// @namespace    tweeks.io
// @version      22.31.3
// @description  Identifies every LADD / N/A / blocked military aircraft on Flightradar24 from public ADS-B, and injects callsign, registration, operator, age, country, MSN, squawk, vertical speed, GPS altitude, airspeeds, wind, photos, a reasoned origin/destination with a wind-corrected ETA (also for ordinary flights FR24 shows as N/A - military, private, GA, helicopters, with private landing sites; learned from 63 days of every aircraft worldwide, with live weather and closures), airport-board entries and a rebuilt 7-month flight log straight into FR24's own data - so it all renders like normal FR24 traffic.
// @author       Finlay Clarke
// @updateURL    https://raw.githubusercontent.com/FinlayC1/fr24-ladd-unblocker/main/dist/fr24-ladd-unblocker.user.js
// @downloadURL  https://raw.githubusercontent.com/FinlayC1/fr24-ladd-unblocker/main/dist/fr24-ladd-unblocker.user.js
// @match        https://www.flightradar24.com/*
// @match        https://flightradar24.com/*
// @connect      api.adsb.lol
// @connect      adsb.lol
// @connect      globe.adsb.lol
// @connect      opendata.adsb.fi
// @connect      globe.airplanes.live
// @connect      adsbexchange-com1.p.rapidapi.com
// @connect      aviationweather.gov
// @connect      external-api.faa.gov
// @connect      opensky-network.org
// @connect      api.adsbdb.com
// @connect      hexdb.io
// @connect      api.planespotters.net
// @connect      www.jetphotos.com
// @connect      api.flightradar24.com
// @connect      registry.faa.gov
// @connect      ardis.iomaircraftregistry.com
// @connect      ginfoapi.caa.co.uk
// @connect      app02.bazl.admin.ch
// @connect      overpass-api.de
// @connect      overpass.private.coffee
// @connect      sslip.io
// @connect      raw.githubusercontent.com
// @grant        GM_xmlhttpRequest
// @grant        GM.xmlHttpRequest
// @grant        unsafeWindow
// @grant        GM_notification
// @grant        GM.notification
// @run-at       document-start
// @noframes
// ==/UserScript==

/*
 * HOW IT WORKS
 * ------------
 * 1. A small interceptor runs in the page's main world. It shims XMLHttpRequest (FR24's gRPC-web feed) and fetch
 *    (FR24's JSON APIs):
 *    - `Feed/LiveFeed`: every flight carries its type/reg; callsign-less flights are reported to the resolver and
 *      identified ones get callsign / reg / type / hex / operator / route written straight into the protobuf bytes.
 *    - `Feed/FollowFlight` (the aircraft panel): identity, photos, MSN, age, country, operator, origin/destination,
 *      times, progress, and live ADS-B telemetry (vertical speed, GPS altitude, IAS/TAS/Mach, wind, temperature).
 *      FR24 draws a padlock wherever its "availability" flag is set; for values this script supplies itself the flag
 *      is cleared, so they render as ordinary text. Squawk is always padlocked for non-subscribers, so it is written
 *      into the panel directly.
 *    - Airport boards: identified flights are added to arrivals/departures/on-ground, their expanded cards answered
 *      locally (times, status, aircraft, airline, callsign, photos), and FR24's own N/A rows filled in. Flights FR24
 *      itself shows with no destination join the board of the airport they are predicted for when the prediction is
 *      good (on final, or 60%+ as the odds turn out), in FR24's estimated style.
 *    - "Recent <reg> flights" (the panel dropdown) is filled from the rebuilt flight log, with FR24's own "More <reg>
 *      flights" link to the log page. The search box gets "Live flights" entries for identified aircraft.
 * 2. The resolver matches callsign-less flights against public ADS-B (adsb.lol's global LADD and military lists,
 *    plus adsb.lol / adsb.fi / ... area queries) by dead-reckoned position, altitude, track, speed and type.
 * 3. Route engine (no AI - transparent reasoning, a few ms per aircraft): every plausible airport, and the
 *    "local sortie returning home" hypothesis, is scored on everything known - the aircraft's own 7-month history
 *    (routes in each direction, what followed what, home base, overnight stops, the return leg, its weekdays and hours,
 *    its own cruise level and the paths it flew each route by), the whole track so far against each great circle,
 *    heading and how consistently it has held it, the flow field (where traffic at this place, heading and height ends
 *    up), fields it flew over without coming down, descent and top of descent for its type, cruise level vs trip length
 *    for its type, selected altitude, squawk, callsign routes, range, runway length / width / surface / lighting, each
 *    airport's hours and season, which performance class uses it, directional route counts by kind of aircraft and
 *    the weekday / hour they are flown, fleet-mates, and - live - the destination's METAR / TAF (minima, crosswind,
 *    runway in use) and NOTAM closures. Learned from every aircraft adsb.lol saw over 63 days (Feb-Sep 2026, every type,
 *    military, private, charter: test/pipe_*.cjs) and scored on aircraft held out of every table and weight. The
 *    ETA comes from the wind triangle (true airspeed + wind along the course). FR24's filed plan wins when one exists.
 * 4. On an aircraft page (/data/aircraft/<reg>) whose history FR24 hides, the table is rebuilt from ADS-B in FR24's
 *    own markup, with a live row when the aircraft is flying, and the premium-locked MSN / AGE filled in. Where FR24
 *    shows the history itself, its "â€”" ends are named (airfields it does not list, "Private Site", from the ADS-B
 *    track or FR24's own playback track) and its live flight gets its predicted destination, in the table and in the
 *    playback panel. Flights are rebuilt from both adsb.lol and airplanes.live where one missed a landing; a flight is
 *    landed when last heard on a runway's final approach, stopped where a hole in coverage was too slow to have flown
 *    through (or a leg too long for the type), and its take-off / touchdown times are heard - or reckoned from the
 *    nearest point heard and shown "~". Owners: registries (FAA, Isle of Man) and databases, without their legal form.
 */
