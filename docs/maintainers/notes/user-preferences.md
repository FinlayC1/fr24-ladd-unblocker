---
name: fr24-userscript-prefs
description: "Standing requirements for the user's FR24 LADD unblocker userscript (photos order, speed, destination logic, testing)"
metadata:
  node_type: memory
  type: feedback
  originSessionId: 19c53497-3f79-4ad0-aea7-e7214a2d0ccf
  modified: 2026-10-02T14:20:18.436Z
---

The user's Tampermonkey/Tweeks script "Flightradar24 LADD / N-A Unblocker" is installed at C:\Users\finla\OneDrive\Documents\==UserScript==.txt (back up the previous version as ==UserScript==.vX.Y.backup.txt before replacing).

- Photos: JetPhotos always first (FR24's own photos count as JetPhotos); Planespotters only when JetPhotos has none.
- Everything must be instant and remembered across refresh (cached identity, photos, routes, departure airport).
- Hidden/padlocked info must be unlocked for ALL aircraft, not just LADD.
- Destination reasoning must be non-"AI" (transparent weighted evidence) and realistic: business jets land at business airports (Le Bourget not CDG, Farnborough/Luton not Heathrow).
- User expects heavy testing ("deepthink, deepsearch, test test test") and gets frustrated by regressions.
- Destination prediction applies to every flight FR24 shows as N/A (military, GA, helicopters, positioning), not only LADD - except drones; helicopters landing away from airports must say "private site" (v22.8.0, 2026-09-25).
- Never airport-data.com photos (FR24 itself serves them - strip them everywhere); Planespotters cropped to FR24's 16:9 frame; no info carried over between aircraft or between legs of one FR24 flight id; live info must survive the aircraft landing.
- Full photo slideshow and departure time/progress must appear without reopening the panel.
- Playback of a LADD flight (board card incl. kept rows, panel, search result, rebuilt log row) opens FR24's OWN map playback in the same tab at its take-off (-3 min) over its departure field, flight selected once on the map (user, 16 Oct; replaced the 10 Oct airplanes.live replay). FR24's bottom-bar Playback (its playback window) is never touched. Log-page tables (/data/aircraft) still link airplanes.live; LADD tags link to https://www.faa.gov/pilots/ladd.
- User cannot always tell which version is running: the strip shows vX.Y.Z since 22.8.2.
- No data-source site credits on the strip (user removed "· adsb.lol" in 22.16.1): identified cell shows only the hex, "verified", owner town.
- Learned private landing sites must NEVER be drawn on the FR24 map (22.16.2); they only name flight ends in panels, boards, strips.
- Slideshow = 3 pictures: JetPhotos first, then Planespotters fills the gaps (no duplicates) - for LADD and ordinary flights.
- Country of registration follows the registration prefix (M- Isle of Man, 2- Guernsey, VP-B Bermuda...), not the ICAO address block.
- Ordinary N/A flights: 22.8.4 still showed "waiting for its position" (F-BOZO) / a route frozen before landing (G-FRAU) on the user's machine though replays work; 22.8.5 adds position by hex across flight ids, FR24's own panel lat/lng as fallback, and a "live positions: N received" diagnostic in the strip - ask for a screenshot of it if still failing.
- 100% must read "Confirmed" (strip tag, board note "Confirmed destination", reason "on final approach..."), never "predicted 100%"; otherwise capped at 99%.
- Strip must look FR24-native in FR24's default LIGHT panel (user's main browser shows FR24 dark purple - some theme/extension); built from FR24's own row classes (bg-gray-400 / text-gray-900 labels / text-gray-1300 values). No strip at all for drones.
- Pictures, identity and routes must appear without reopening: pushed into FR24's stream as an extra frame the moment they change (22.8.5).
- No FR24 adverts anywhere and no right-hand ad sidebar, removed "seamlessly" (no flash, no empty gaps, no ad-blocker wall) - since 22.9.0 the slideshow is 3 dots (the JetPhotos promo slide is an advert and is gone).

- Responsiveness first (1 Oct: 22.10.3 made FR24 "unusably slow" - world-scan adoption 1.5 s freeze, 120 ms quickRouteAll bursts every 3 s). Since 22.11.0 all background CPU work runs in idle slices (core idleSlice/sliced) and pauses while the map is dragged/zoomed; test/perf.cjs measures stalls (world-scan load), test/perf_feed.cjs page-side feed cost (jsdom TextDecoder is slow - swap in Node's).
- Strip: compact (destination, departure, also possible); reasons/ETA/weather/how-it-was-worked-out only in the destination tooltip. Placed directly above FR24's route boxes (under the photo), never under the tracked-by bar.
- Owner names: legal forms and bracketed trading/former names after them removed (PAL Aerospace); "Private" is a placeholder. Ordinary flights FR24 calls "Private owner" get the registered owner (FAA, IOM, UK G-INFO ginfoapi.caa.co.uk public API) on panel and log page - names only, never addresses. Military aircraft fall back to "Military", not "Private owner".
- FR24 30-minute session timeout neutralised (session store sessionSuspended reset synchronously).
- airplanes.live API requires approval ("contact us") - not used; satellite/ocean flights identified from a persisted last-seen memory carried forward (M-BIZZ).

- AGE/MSN/country (2 Oct): no open source has build years worldwide (hexdb/adsbdb none, OpenSky DB ~0.1%, OpenSky metadata API 410 Gone, airframes.org says "no bots"). Built in: src/agetable.json from FAA MASTER+DEREG joined to tar1090-db types (test/mkagetable.cjs, 82k turbine/heli airframes; leave-one-out serial dating 98% within a year). FR24 list.json aircraftInfo gives country (FR24 id) and model text but serialNo null/age hidden for free accounts; MSN from JetPhotos cards or FR24's own panel cell. Full ICAO nationality-mark table (REG_NATIONAL) - registration beats transponder block.
- Panel layout differs by width: wide = photo in a fixed block, only the body below scrolls; strip goes in the scrolling element above the route boxes (find by computed overflow).
- Board cards: aircraft name = FR24's model text (fr24Model), else database desc de-capitalised.
- Long-final confirmation (engine.longFinal): up to 35 km, must agree with top candidate, not piston/mil; 99.8% precision on archive (test/final_eval.cjs AGREE=1).
- 22.12.0 (2 Oct) user asks: one flight never split in two in logs (coverage lost at one END of a flight = engine throughGap; old cached splits joined in stitchLegs holeJoin); light aircraft/helis use unlisted strips (landingInGap fields, lost-low near strip, heli first-seen-low near strip; Enstone not "Aerodrome"); trustee owners (TVPX, Bank of Utah, Wells Fargo Trust...) never shown - operator via FR24 operator id/ICAO or callsign prefix (N67WV TWY26 = Solairus); log page: FR24 mode from 1 FR24 row, +90 days of ADS-B rows under FR24's week (OLDER_DAYS), FR24 rows keep FR24 playback, ours adsb.lol/airplanes.live; playback panel MSN filled; boards: archive per airport (06-boards.js, 'b:<apId>' in hist store) of landed LADD/N-A flights, log legs, FR24 schedules, FR24's own board rows; page answers board pages -2.. / 2.. (FR24 free = page 1 ~9 h ahead + page -1 earlier today; setting meta.previousPage/nextPage makes FR24's UI ask for more - verified live).
- 22.12.0 INSTALLED 2 Oct 15:00 (backup v22.11.1). TKF1 (G-XXEE): heli first heard low+slow on its pad after a coverage hole = took off there (heliSlow0), not landingInGap's field; private-site destination names a specific spot only if that spot alone beats the top airport, else "Private site" + "likeliest its own spot ..." in the reason; heliport-ahead only <1000 ft AGL or descending. test/case_panel.cjs takes case.trace (recorded adsb.lol trace fixture) for blocked flights FR24 has no playback for (fixtures/panels/oct2.json).
- 22.12.1 (2 Oct afternoon): G-JDPB "from Chester" (adsb.lol leg lost low at Sleap stayed open; trailFor now appends the current pos when >10 min after the trail so the gap rule cuts it); N900YB "on the ground at Dublin" at FL370 (currentPos: stale id positions give way to another id of the same hex or areaCache when newer by 30 s); LADD registry owner lookup (enrich) also when no name is known (ownerDue, daily, ownerAskedAt persisted) - HLL01/G-NMCF Kingmoor Aviation; ownerName drops ALL bracketed parts ("(Illinois)", "(2025)", "(UK)"); page pubIds cache (hex -> owner/age/msn/country) patched into FR24's FollowFlight aircraft block (fields 15/7/10/3, flags 13/14/16 removed) so "Private owner"/padlocks are not drawn first. Tests that use a real aircraft's hex with live sources can flip when that aircraft flies (replay M-BIZZ case now a fake hex).
- National registers beyond FAA/UK/IOM: Transport Canada robots.txt Disallow:/ and its bulk download needs an Open Data licence accepted (ask user); CASA (Australia) site unreachable from here; Swiss BAZL lfr/csv returned empty. Not added yet.
- Heredocs mangle backslashes:  became a literal backspace once - check sources for control chars (scratchpad fix_backspace.cjs).

**Why:** repeated explicit complaints across sessions (slow photos, Planespotters shown before JetPhotos, bizjet→LHR/CDG predictions, re-computation after refresh).
**How to apply:** check each change against these before shipping; report accuracy honestly by flight phase (95% is only reachable late in a flight). See [[fr24-engine-accuracy]].
- 10 Oct (22.15): playback links go to globe.airplanes.live (not adsb.lol). FR24 map playback must name blocked/mil/PIA flights and give their route as flown, strip tag "Playback" in RED (never predicted/confirmed). Log pages and routes page must show exactly what the map tab computes (synced, instant). Logos wanted for operators FR24 lacks (BAE). Private landing sites must be named on boards, remembered.
