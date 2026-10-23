# Changelog

All notable changes to the FR24 LADD Unblocker. Versions follow `MAJOR.MINOR.PATCH`. The userscript and the monitor are released together.

1.0.0 is the first release. The versions before it are the betas, labelled B: B22.31.12 is version 22.31.12.

## [1.0.1] - 2026-10-23

### Fixed
- **Flights cut in two by a day's end and an ocean.** N1868M, 19 Oct, Teterboro to Barcelona, was "Teterboro -> N/A" and "N/A -> Barcelona" in its log and in the panel's recent flights.
  - Each day's file is built alone and the pieces joined after. Across a hole in coverage the join allowed 1,000 km/h. N1868M, east over the Atlantic at 566 kt, was lost off Newfoundland and heard again west of Spain 2 h 40 min later: 2,774 km, 1,044 km/h.
  - The join now allows the speed the aircraft was doing either side of the hole, plus a seventh, 1,300 km/h at most. It still doesn't join when there was time to land in between.
- **The monitor's flights cut by a restart.** On 23 Oct the monitor had N811MK as "Trenton -> ?" and "? -> ?". It restarted while the aircraft was over the Atlantic, and it continued a flight only within three hours.
  - It now continues one heard again high on the other side, when the distance fits the speed (the same rule as the logs).
- **Flights adsb.lol's archive doesn't have.** N811MK flew Trenton to Valencia on 15 Oct. adsb.lol's archive has it parked at Trenton from 22:38 and has no file of it the next day. The monitor heard the flight live, but the log page had nothing for it, nor for the aircraft's predictions.
  - The monitor's `/hist` now serves such flights with their day.
  - When the monitor builds a day, the positions it heard itself fill the archive's holes of two minutes and more.
  - A browser that reads such a day again itself keeps them.
- **The flight-number page has exactly the log page's flights.** N811MK's page had "Naples -> -" and "- -> Trenton" for one flight cut at midnight, beside the joined copy, and was missing flights its log had.
  - Both the monitor's `/flights` and the browser now take each aircraft's whole log, stitched and chained, and keep the flights under the callsign.
  - The browser then loads each aircraft's log the way its log page does.
- **TC-MAA was never identified.** FR24 has it as a G700 (GA7C) and adsb.lol's database as a G650 (GLF6). The matcher compared types by their first three letters (GA7, GLF), so it rejected an aircraft at the very position, height, track and speed.
  - Types now match within a maker's line, in the browser and the monitor alike: Gulfstream, Falcon, Global and Challenger, Citation, Embraer business jets, Learjet, Hawker, the 737 and A320 families.
  - Another maker's jet at the same spot is still not matched.
- **"N/A -> N/A" on ordinary flights, and LADD panels without time zones or progress bar, now and then until a reload.**
  - The cause: to add the learned landing places to FR24's airport list, the page deleted FR24's own airport and airline databases whenever that list had changed.
  - With another FR24 tab open, the deletion waits for that tab. FR24 in this tab opened its database behind it and never got its airports.
  - Nothing of FR24's is deleted now. The landing places join at FR24's next read of its list (hourly), which is asked for in full.
- **Aircraft logs said "verification page" for days the monitor gives anyway.** N811MK's log read "adsb.lol and airplanes.live are showing this browser a verification page ... 4 days not read yet". The 4 days were:
  - 5 May, 7 May and 11 Jun 2026, which adsb.lol published as one tar instead of in parts. The monitor took them for never published. It now reads such days, and looks again at start for days an older monitor gave up on.
  - 6 May, which adsb.lol never published (its outage). The monitor's `/atrace` now says so, and the log reads "6 May is in no public archive (adsb.lol published none)".

  The log page also changed:
  - A day the monitor has not indexed yet reads "the monitor's copy of this day is not ready yet".
  - The bold verification-page line shows only when those days can't come from the monitor (no monitor, or its archive not in use).
  - "Last error: terminated" (an archive download cut short, which is read again within the hour) no longer shows under every log.
- **Boards showed N/A while loading, and the list jumped.**
  - A board's first answer now waits up to 2 s for its kept rows, including the monitor's flights of the airport. Before, blocked aircraft's rows had "N/A" for where they went or came from until a re-read about 15 s later.
  - The row at the top of the view is held in place through each re-read, for 6 s after the answer, until the user moves the list. Rows arriving above it had moved the view "two days behind".

### Added
- **TheAirTraffic as another source, beside adsb.fi.** It is a community aggregator with feeders of its own; it heard N811MK further out over the Atlantic than adsb.lol did. It has no query API, but its map's files are public, in adsb.lol's format with the LADD flags:
  - **The monitor reads its whole-world file once a minute** (`tatEvery`; about 1 MB compressed, 12,000-odd aircraft):
    - its LADD, military, PIA and blocked aircraft are taken in the way the lists' are (live positions, flights, the live list);
    - every aircraft in it is a candidate for naming FR24's blocked flights, and for `/near` and `/tel` (TC-MAA is in it, unflagged);
    - its positions fill the holes of the monitor's day logs.
  - **The browser:**
    - reads today's file of the aircraft looked at, plus the last five days' (as far back as it keeps them), merged in;
    - uses it for a single day's file (playback) when adsb.lol's doesn't come;
    - uses its whole-world file as a fallback live source when the others can't name a flight, read at most every 30 s.
  - Its "no file" never makes a day without flights, and its refusals never make a day incomplete. A refusal or verification page pauses it for ten minutes (an hour after three in a row).
  - The extension asks for one more site (`globe.theairtraffic.com`); Tampermonkey asks once to allow it.

- **The world log: every aircraft's flights, every day, kept for good.** The monitor already read each day of adsb.lol's archive (every aircraft it heard that day) to index it. In the same read it now builds every aircraft's flights, with the same engine as the logs, and keeps them in one file a day (`STORE/world/`).
  - 21 Oct 2026: 68,294 aircraft and 193,149 flights in 21.8 MB, built in under 7 minutes here. An aircraft's day is found in 0.17 ms.
  - The past year (366 days, `worldDays`) is filled in newest first, one day at a time; a day read before is read again for it. Each new day is added once adsb.lol publishes it.
  - Nothing is ever deleted. While the disk has less than 4 GB free (`worldFreeGb`), no more days are built, and `/status` says so.
  - `/hist` now serves any aircraft, not only blocked ones. On a day the archive has no file of it, it had no flights; on a day it has one, its flights come from the world log. With `since`, only the days a browser is missing.
  - Browsers ask a monitor that has it for an ordinary aircraft's missing days in one request, instead of one request per day through `/atrace`.
  - A blocked aircraft's day read before it was known to be blocked is no longer served as a day without flights: the day's index or the world log says.
- **Central calculation: one route for every browser.** Each flight a browser shows is worked out on the monitor, once, and every browser shows that answer: the same departure, destination, odds, reasons and ETA. It is the userscript's own route code, run on the monitor unchanged (the blocks marked `==ROUTE-...==`), with the same engine and tables.
  - Browsers send what they see of each flight they show (`POST /calc`): its track (whole once, then what is new), FR24's plan, its flights of the day, the weather and closures at the airports in question. The monitor adds its own logs of the aircraft, the world log among them.
  - N1868M over the Atlantic: from what a browser sent, the monitor's answer is the browser's own, field for field. A second browser with only the last minute of the track gets the very same.
  - Each browser still keeps its user's own confirmation of a destination, and a landing it has seen before the monitor's answer has. The progress bar and the time to go are worked out from where the aircraft is now.
  - The tables take about 150 MB more memory on the monitor. It is on only with 300 MB free at start (`centralFreeMb`) and does at most 12 s of this work a minute (`centralMsPerMin`); otherwise every browser works routes out itself, as before. `/status` says which.

### Changed
- **Flight logs are rebuilt once** (log format 8): the monitor's days now carry its live-heard flights.

### Destination accuracy: why the odds are low, and when they're wrong
Measured on aircraft held out of training: 66,679 moments of 2,073 aircraft, 1-21 Oct, observed every 12 minutes of their flights.

| The flight, to the aircraft's history | Moments | Top choice right | Shown under 40% |
|---|---|---|---|
| Route flown 3 times or more | 2,763 | 92.9% | 1.6% |
| Route flown twice | 1,235 | 87.9% | 4.1% |
| Route flown once | 4,177 | 84.3% | 8.7% |
| Destination visited before, not from this origin | 18,033 | 79.7% | 13.6% |
| Destination never visited | 34,222 | 32.8% | 45.3% |
| No history at all | 6,249 | 33.9% | 57.3% |

- **A route flown before already gets high odds.** Low odds come from flights to places the aircraft hasn't been, which are half of all moments.
- **New destinations are mostly uncertain early in the flight:** 14% right with over 90 minutes to go (most misses 400 km or more away), 70% right within 20 minutes (most misses a neighbouring airport).
- **The odds shown are honest:** shown 10-30%, right 10-25% of the time.
- **N811MK, 23 Oct:** out of Trenton it has flown four different Atlantic crossings, each once (Rome Ciampino in April, Prague in August, Munich and Valencia in October). Mid-ocean, 25% for the most recent is what its history supports. Its Valencia flight was also missing from its log; that is fixed above.
- **The long logs browsers get from the monitor help a lot.** The figures above give each aircraft three weeks of history. Your browser gives a LADD aircraft the monitor's whole log, up to 220 days (a median of 75 flights here, against 5). On the same 27,034 moments of 665 held-out LADD aircraft:
  - right 51.1% -> 56.7%;
  - top three 66.5% -> 73.2%;
  - shown under 40% 36.2% -> 26.0%;
  - flights to places never visited 54% -> 29% of moments.
- **A landing guessed across a night is not made.** N811MK, 7 Oct, was lost coming down over Spain, and heard climbing 85 km away the next morning before Trenton. Reading a landing into that night the way a hole within one day is read gave Valladolid. Tried on 3,143 real stops of business jets and airliners with both ends out of coverage, such a guess was right 25% of the time and a neighbouring field 43% of it (Teterboro read as Newark). A wrong field is a visit in the aircraft's history: with it, N811MK's guess on 23 Oct was "Valladolid 73%", and it landed at Madrid. Those ends stay "-".
- **The weights refitted on long histories** (3,991 aircraft's monitor logs, warm-started from 1.0.0's): on the same 28,270 held-out moments, right 57.2% -> 57.5%, top three 73.5% -> 73.6%, better in every group; with three-week histories unchanged (52.3%). The calibration of the odds is kept from 1.0.0.

### Tests
- `unit_legs`, on the aircraft's real traces:
  - N1868M's crossing joined; a hole crossed faster than 1,300 km/h not joined;
  - N811MK's two days, lost coming down and heard climbing a night apart: no field guessed between them.
- `unit_monitor`: the crossing across a restart (fails without the fix).
- `unit_monitor2`:
  - the monitor's own positions fill the archive day's hole;
  - `/hist` serves the live-heard flight, and not twice;
  - `/flights?cs=` is the whole log, and a flight cut at midnight comes once.
- New `unit_world`:
  - every field of the fixtures' real flights kept through the world log's row;
  - a day of 1,000 aircraft added in the archive's order: each found again, one that did not fly, one not in the day, a day not kept; found again after a restart; a half-written day not taken;
  - the monitor: the world log built in the archive's read; an ordinary aircraft's day served from it, the same flights as the day's log is built; one not in the day's index: no flights; one in it whose day the world log has not: left out; a day read before read again for it alone (and its index); a day not published; the disk short of room.
- New `unit_central`:
  - every name the route code uses from outside its blocks is given on the monitor (found with ESLint's no-undef: a name added to the route code later fails it);
  - not on when turned off or short of memory, and said why; the landing sites left out with too little room after the tables;
  - the route tables compacted exactly as the build does;
  - tracks sent whole, then in parts; a part without the whole asked for whole; a new leg; nothing kept that is not a flight's;
  - N1868M: the monitor's answer is the browser's own;
  - end to end in two browsers (the built userscript, jsdom): the flight sent, the monitor's answer shown in both; then only what is new sent; the user's confirmation and a landing seen first stand; the monitor off: the browser's own;
  - the minute's allowance; a flight the monitor named itself.
- `unit_netfetch`: a monitor without the world log not asked for an ordinary aircraft's log; one with it asked once, from the oldest day wanted, nothing asked day by day; its flights not kept over a read of the day here.
- `unit_archive`: a day published as one tar; a never-published day's 404; days given up before retried at start.
- `unit_fr24`: TC-MAA matched; maker's lines; another maker's jet not matched.
- `unit_netfetch`:
  - no verification line when the monitor gives every day;
  - "not ready yet" for a day without an index;
  - a never-published day noted as such.
- New `unit_boardplace`: the present on opening; the top row held through re-reads with rows added above; the nearest row by time; the user's scroll respected; the first-open wait.
- `pipe_eval`: each moment's relation to the aircraft's history in the dump; `LONGHIST` / `LONGONLY` / `LONGSEL` evaluate with the monitor's long logs.

## [1.0.0] - 2026-10-23

### Fixed
- **Flight logs of any aircraft with both sites walling the browser.** On B22.31.12 an ordinary aircraft's FR24 page still said "82 days not read yet". The monitor's fix in B22.31.11 covered blocked, LADD and military aircraft only. Every other aircraft's earlier days were asked of adsb.lol's site (the last 40 days) and airplanes.live (older), and both put a verification page in front of the browser.
  - **The monitor indexes each day of adsb.lol's archives** as it reads them: where every aircraft's file is in that day's tar. That's about 68,000 aircraft and 1.1 MB a day. A day read before 1.0 is read again for its index alone, newest first.
  - **New `/atrace?hex=&day=`** returns any aircraft's file of that day, fetched alone from GitHub as a byte range of the part it is in, with no verification page in front of it. Checked live on 21 Oct: N73VR's file (43 KB) came in 207 ms.
  - **The browser reads every past day of a log from there**, at any age. That covers days older than adsb.lol's site keeps, which used to go to airplanes.live alone. adsb.lol's site is asked only for a day the monitor has no index of yet. airplanes.live is skipped while it walls the browser, and adsb.lol's "no file" then counts as a day without flights.
  - **The browser waits for the monitor's check before reading a log.** An ordinary aircraft's log didn't ask the monitor for anything before.
  - **Only a 1.0 monitor is asked** (its `/status` counts the days it has indexed). A 404 counts as "no flights" only when it says so, because a monitor not yet updated answers 404 for a path it doesn't know.
  - **The log page says how many days the monitor can give for any aircraft** ("…, 120 of them for any aircraft").
  - A single past day's file (playback, an aircraft's take-off) comes from there too.

### Added
- **Destinations from the aircraft's own datalink.** Many business jets send their route over ACARS: a flight plan uplinked to the FMS ("DA:KCMH:AA:KTEB"), position reports naming origin and destination, a filed flight plan, a departure clearance. adsb.lol publishes what its receivers hear on ACARS, VDL2 and HFDL as open data (CC0), about an hour behind.
  - The monitor reads each hour's files as they come out and keeps only the routes, for 36 hours.
  - The browser asks the monitor about the aircraft on screen, fifty at a time.
  - A route counts for a flight only when it is that flight's: from the airport it took off from, the aircraft on the way there, and either sent in flight or a plan sent up to 12 hours before take-off. The panel then says so: "flight plan uplinked to it (datalink, 14:05Z)".
  - **Checked against the flights actually flown on 21 Oct** (481 messages about 172 business jets and LADD aircraft): where the message named the flight's own origin, its destination was the airport landed at **362 times in 367** (LADD aircraft 123 in 128).
  - Operations messages ("OPSCTL … KHVN/KFLL") are not read: half named another leg.
  - Coverage is small: a few percent of business jets are heard this way on any day.
- **Event surges.** Fields busier with blocked aircraft these last three days than over the four weeks before (a race meeting, a summit) count for them, and quieter ones against. Served by the monitor as `/surge`.
- **Climb rate and cruise speed** as evidence of trip length. A faster climb than usual for the type means a lighter aircraft, so a shorter trip. The weights learned this; cruise speed came out at nothing.

### Changed
- **Destination weights refitted** on adsb.lol's archives of 1-21 Oct: 219,085 moments of 19,094 aircraft, warm-started from the previous weights. Scored on aircraft held out of training, the same moments for both:
  - business jets top choice 50.5% -> 50.9%, top three 66.6% -> 66.7%;
  - large-cabin jets 43.6% -> 44.4%, no history at all 30.8% -> 31.9%, trips over 3,000 km 33.2% -> 34.0%;
  - other LADD aircraft 67.9% -> 68.8% (pistons 71.5% -> 72.7%, turboprops 60.9% -> 60.6%).
  - A fit without the three new terms scores the same (50.9%). The gain is the newer data; the new terms add almost nothing on these moments.
- **The shown odds recalibrated** for business jets on held-out aircraft: stated against right off by 1.3 points on average (8.0 uncalibrated). Other classes keep theirs.
- **Versions.** This is 1.0.0. The 22.x versions are the betas, labelled B: B22.31.12 in the changelog, the window and the dashboard. On GitHub, once 1.0.0 is out, the release workflow titles every earlier release "B<version> (beta)", marks it a pre-release, and marks 1.0.0 the latest. GitHub would otherwise rank 22.31.12 above 1.0.0, and the README's "latest" download links would stay on it.

### Tests
- `unit_archive`, the archive index:
  - each file's place in the whole tar;
  - an aircraft not in the day gives null, a day with no index gives undefined;
  - the day's note keeps the list out;
  - `/atrace` returns one range of the right part with the file's own bytes;
  - a file the parts are cut through is fetched as both ranges, joined;
  - 404 not in the archive, 409 no index, 400 nonsense, 502 when GitHub fails;
  - `/status` counts the days indexed;
  - a day read before the index existed is next in line, gets the same index, and nothing is read or built again.
- `unit_netfetch`, an ordinary aircraft with both sites walling:
  - all 50 days are asked of the monitor once each, including a day older than adsb.lol's site keeps;
  - the sites aren't asked;
  - the log page says 1 day not read yet (the one with no index), not 50;
  - that day is read once its index exists;
  - a single past file comes from the archive too;
  - a monitor from before 1.0 isn't asked, and a bare 404 never makes a day without flights.
- New `unit_datalink`:
  - a line of each feed read the same;
  - every message form read, but not operations messages, two codes in other text, an unknown airport, or the same airport twice;
  - a route sent again merged, at most 8 per aircraft, gone after 36 hours;
  - zstd read by Node's own and by the small decoder kept for Node 18;
  - the day's new files listed;
  - the monitor's round reads only new files, and skips an hour over 36 hours old without downloading it;
  - `/datalink`, `/status` and `/surge` answer;
  - in the browser: routes asked for together and kept ten minutes, and a route taken only when it is this flight's (wrong origin, off the way, an earlier flight's report, a plan over 12 hours old: not taken).
  - It also runs on CI's Node 18 job, without the browser part.
- `unit_dash`: a beta's installs shown as B22.0.0.
- `fit2 --drop=`: a fit without chosen terms, to see what they add.

## [B22.31.12] - 2026-10-23

### Fixed
- **Pages lost the monitor while it read adsb.lol's archives**, so the log page, live figures and panels all fell back to the walled sites. On 22.31.11, HB-IXL's log page said "209 days not read yet". Panels lost their progress bar and time zones, and other flights read "N/A" until a page refresh.
  - The cause: 22.31.11 had the monitor read 220 days of archives (3.8 GB each), two at a time. On the 1 GB VM that ran it into swap, and its answers took longer than the browser waits. One late answer made the browser treat the monitor as gone, for everything, until it checked again.
  - **The monitor now reads one day at a time** (`archiveJobs` 1). The archive waits while the server is slow to answer (event loop over 200 ms late) or memory is short (less than `archiveFreeMb`, 120 MB, available). The wait is at most a minute at a time. Memory is read as Linux's MemAvailable, because Node 18's `os.freemem()` leaves out the page cache.
  - **The browser keeps using a busy monitor.** It waits 10 s for `/status` (was 4 s). It gives the monitor up only after three requests in a row go unanswered and none has been answered for two minutes. A refusal (an HTTP error) still counts as an answer.
  - **The log page says when the monitor isn't answering**, and why, instead of saying nothing.
- **A blocked flight's route stays in FR24's panel through a moment without data.** A route that comes out empty while the aircraft is in the air no longer replaces the one the page has. This holds for half an hour at most. Before, the panel lost its airports, time zones and progress bar until the next route.

### Changed
- **Ready for 1.0.0.** The next release is 1.0.0. The versions before it, 22.31.12 and earlier, become the betas ("B22.31.12"). Until now every check compared versions number by number, so 1.0.0 would have looked older than 22.31.12 and never been offered. 1.0.0 and later now count as newer than every beta. This affects:
  - the update banner on FR24 and the LADD Unblock window;
  - the extension's update page and its "what's new" list, which also reads "B" headings;
  - the monitor's "behind" check and its count of outdated installs;
  - the monitor's dashboard.
- **Update to this version before 1.0.0 comes out.** An older install can't tell that 1.0.0 is newer.
- **Userscript users:** userscript managers compare versions themselves, so they won't update 22.x to 1.0.0 on their own. Use the banner's Update and confirm the install once. The manager may call it a downgrade, and the window now says so.

### Tests
- `unit_archive`:
  - one day at a time;
  - no wait on a quiet server;
  - waits while the event loop is late, and at most a minute when memory is short;
  - the reader paced every 200 traces, the ones not taken included.
- `unit_netfetch`:
  - a monitor that misses three answers but answered within two minutes is still used;
  - after two minutes with no answer it is given up, and the log page says so;
  - used again once it answers;
  - an HTTP refusal counts as an answer.
- `unit_shared`: a route that comes out empty mid-flight leaves the page's route in place; the next route replaces it.
- `unit_installs`: 1.0.0 newer than 22.31.12 and "B22.31.11"; 1.0.1, 1.10.0 and 2.0.0 in order; '' older than both lines.
- `unit_selfupdate`: the extension updates itself from this beta to a "v1.0.0". The banner says it is out, the update page offers it, and the folder is updated and reloaded. The "what's new" list skips the beta's "B" heading.
- `unit_native` and `unit_hello` use an older beta (22.0.0) as their "older version", in place of 1.0.0.

## [B22.31.11] - 2026-10-23

### Fixed
- **Flight logs work with both sites walled.** The user's browser is shown adsb.lol's proof-of-work page and Cloudflare's block page by airplanes.live ("Attention Required!"), so it can read neither site's files. The monitor already had 39 of the last 40 days from adsb.lol's archives, but the log still said "221 days not fully read". The monitor only served days the aircraft flew, so every other day was asked of the walled sites.
  - **The monitor serves every day its archives cover.** A day the aircraft isn't in the archive is served as one without flights, as adsb.lol knows it.
  - **The browser takes those days** as read from adsb.lol alone. A day with no flights from the monitor used to be read again from both sites (airplanes.live has had flights adsb.lol missed, TC-ACN on 13 Sep). It still is when the aircraft is looked at and airplanes.live answers this browser. When airplanes.live has walled this browser within the hour, the day stays as the monitor has it, with nothing asked.
  - **"Not read yet"** now counts only days with nothing at all. A day with adsb.lol's flights and airplanes.live's still to add isn't a hole.
- **Today's flights with both sites walled.** The monitor's new `/trace` gives an aircraft's positions over the last 26 hours, from its own polling of adsb.lol's API, which has no verification page. It uses adsb.lol's trace format.
  - The browser reads it with both sites for the aircraft looked at.
  - For other blocked, LADD and military aircraft, it reads it when adsb.lol's file doesn't come.

### Changed
- **The monitor reads adsb.lol's archives for 220 days, two at a time** (`archiveDays` 220, `archiveJobs` 2), newest first. 220 days is the whole log page. Archives exist back to January.
  - Days in that range are left to the archive loop, not asked of adsb.lol's site one aircraft at a time.
  - A day's job waits for its archive, however old the day.
- **Military aircraft's days are also built from the archives** (not followed live), and the browser asks the monitor for them as for LADD aircraft.

### Tests
- `unit_archive`:
  - a military aircraft taken and not made blocked;
  - an aircraft not in a day's archive served that day as one without flights;
  - days 30 and 219 back "to come", day 300 not covered;
  - filling a log queues nothing the archives cover;
  - two days read at once, the same aircraft's file written by both;
  - `/trace`.
- `unit_netfetch`, both sites walled as in the user's browser:
  - the monitor's days (a flight and 11 days without) are the whole log, with nothing asked of the sites;
  - no "not read yet" for those days;
  - today's crossing read from the monitor's positions;
  - a military aircraft's log asked of the monitor;
  - an ordinary aircraft's positions not asked of the monitor in the background.
- `unit_histgap`: "not asked again next time" allows for days that ended under 6 hours ago, which are read again by design. It failed between 00:00 and 06:00 UTC.

## [B22.31.10] - 2026-10-22

### Fixed
- **The flight log page's layout.** 22.31.9's notice under the log (a verification page, the days not fully read) was one long line in a table cell that FR24 keeps on one line, so it stretched the whole table far past FR24's page. The footer now wraps inside the table, and the notices are on a line of their own, shorter.
- **A verification page is recognised by what it is.** 22.31.9 took any refusal or error page that mentioned "verify" or "challenge" for one. Now only adsb.lol's proof-of-work page and Cloudflare's challenge count. Anything else is said as what it is, with its status and the page's title: "refused (HTTP 403, "403 Forbidden")", "server error (HTTP 502)".

### Added
- **What the two networks actually send this browser**, readable in the console: `__tweeksLaddBridge.stats.net`. For each network: the counts of files, "no file", verification pages and failures, and the last answer that wasn't a file (address, status, page title, first words).
- **The log page says how far the monitor has got with adsb.lol's archives** ("the monitor has 12 of the last 40 days from adsb.lol's archives (reading 2026-10-10)"), or that it runs an older version and needs **Update monitor**. `/status` now counts the archive days read (`archive.have`).

### Tests
- `unit_netfetch`:
  - pages mentioning "verify" or "challenge" that aren't verification pages;
  - the status and title in the reason;
  - the diagnostics handed to the page;
  - the footer notices in their own wrapping block.

## [B22.31.9] - 2026-10-22

### Fixed
- **Recent flights: FR24 now asks for the list at a new address.** The panel's "Recent <reg> flights" request moved from `api.flightradar24.com/common/v1/flight/list.json` to `www.flightradar24.com/common/v2/flight/list.json`, with the session's token. The script only recognised the old one, so it never saw the request and the list stayed "No flights available" for every aircraft. Both are now recognised, on any FR24 host and any version, with fetch and with XHR.
  - The token is blanked out of the request log kept for diagnosis (`stats.reqLog`, `stats.lastList`), since those are pasted into bug reports.
- **Recent flights now include today's earlier flights.** When an aircraft's log was already saved, today's trace was never read for the list. So the flight before the one on screen was missing, such as N73VR's night crossing New Haven → Luton before its departure from Luton. Today's trace is now always read for the list, and the list is sent again when it arrives.
- **Flight logs: the networks' answers are read for what they are.** adsb.lol now shows a proof-of-work verification page ("Verifying connection") to clients that ask too much, too fast, and Cloudflare shows one in front of airplanes.live. Those answers were failed requests at best, and gaps in the logs. The trace reader is rewritten in the browser and on the monitor:
  - **Each answer is told apart:**
    - the file;
    - no file (a day the network heard nothing of the aircraft);
    - a verification page, with a 403 or 200 status;
    - a refusal to slow down (waited out, twice);
    - a file cut short, or another aircraft's file;
    - a server error, or no answer (tried once more).

    Only the file and "no file" count as answers about the day. Nothing else is ever taken for a day without flights: those days are read again later, and the reason is kept.
  - **A verification page stops the asking.**
    - The browser stops asking that network for 10 minutes. Requests already waiting their turn aren't sent.
    - While a network hasn't answered well lately, one request goes first and the others wait for its answer.
    - The sources pop-over and the log page say so, with a link to open the site once (which clears it for the browser).
  - **Gentler on both networks.** The browser asks adsb.lol three files at a time, a quarter of a second apart (it was eight, 30 ms apart), and airplanes.live two at a time. The background takes one.
  - **One refusal no longer turns airplanes.live off.** A single 403 used to stop every airplanes.live request for 30 minutes, and every day asked in that time became a gap.
  - **Today's trace comes from both networks** for the aircraft being looked at: airplanes.live had N73VR's crossing when adsb.lol's file didn't come. The background asks adsb.lol alone.
- **Monitor: adsb.lol's days are read from its daily archives.** adsb.lol now shows servers its verification page, so every day the monitor asked for failed. adsb.lol publishes every day's traces on GitHub (`adsblol/globe_history_<year>`), one tar a day in parts of about 1.9 GB.
  - The monitor reads each finished day of the last `archiveDays` (40) as it downloads, never writing it to disk, and builds every blocked aircraft's day from it. It also builds every aircraft the archive flags LADD, adding it to the blocked list.
  - Real 21 Oct archive: 3.8 GB, 68,294 traces, 4,259 LADD aircraft, 4 minutes, 141 MB of memory.
  - A day's job waits for its archive, up to a day and a half after the day ends. Once the archive is in, nothing is asked of adsb.lol's site for that day.
  - Days built this way are marked as adsb.lol only, so a browser looking at the aircraft adds airplanes.live.
  - `/status` shows what each network answered (`nets`) and the archives read (`archive`).
- **Every saved flight log is deleted again and rebuilt with the new reader**, in the browser and on the monitor. The log version goes up to 7 on both, so a monitor not yet updated has its days ignored.

### Tests
- New `unit_netfetch` (browser), based on N73VR's real 21 Oct trace from adsb.lol's archive plus today's crossing to Luton. It covers:
  - every kind of answer;
  - a 429 waited out;
  - a verification page remembered: adsb.lol asked once in all, the background included, and said in the sources pop-over and on the log page;
  - a walled day built from airplanes.live and marked to read again;
  - days neither network answered never taken as days without flights;
  - both networks with no file: a day without flights;
  - the background never asking airplanes.live;
  - today's crossing read from airplanes.live;
  - "Recent N73VR flights" listing New Haven → Luton and Morristown → New Haven.
- New `unit_archive` (monitor):
  - a day's archive made as adsb.lol makes them, cut into two parts mid-file and read in chunks of every size;
  - the parts found, including a release published again (`-1`);
  - only blocked and LADD-flagged aircraft taken; a broken file counted;
  - learning rows written once; the day noted;
  - jobs once the archive is in asking nothing; before it is out, waiting for it;
  - an unpublished day retried after an hour;
  - adsb.lol's verification page pausing it for an hour and never making a day without flights.
- `unit_recentlist`: FR24's v2 address on the www host, with fetch, XHR and a relative address; a flight number's list left alone; the token never kept.

## [B22.31.8] - 2026-10-22

### Fixed
- **The deletion of every saved log could be skipped if the tab was closed during it.** 22.31.7 noted "done" in the browser before the deletion had run, so a tab closed half way left the old logs saved, and the next start took them for already deleted. It is now noted once the deletion has finished. A second tab opened in those first seconds may delete again, which loses only what was built in them.

### Tests
- `unit_recent` sets up its aircraft's logs only after the first-run deletion is done: it deleted the test's logs, and the test failed six times in eight.

## [B22.31.7] - 2026-10-22

### Fixed
- **Every saved flight log is deleted, once, and rebuilt from scratch**, in the browser and on the monitor. 22.31.6 made old logs unusable but left them saved until each aircraft's log was next loaded, so the log pages still showed what the old build had read.
  - **Browser:** on the first run of this version, the saved logs (IndexedDB), today's tracks and every aircraft's compact recent flights are deleted. What was learned (the self-learning tables), the airport boards and the aircraft's identity records are kept. Loading a log waits for the deletion, so nothing built meanwhile is deleted after it.
  - **Monitor:** on the first start of this version, the files of its `hist/` folder are deleted. What it learned (`learn/`, `learn-crowd/`), its tracks and its names are kept. `hist-reset.txt` in its store notes it, so it is not done again.
  - **When asked:** the LADD Unblock window has **Rebuild flight logs** under "This browser", and the owner's secret adds **Delete saved logs** for the monitor (`POST /admin/reset-logs`). Each takes a second click within 5 seconds, so nothing is deleted by a stray click.
- **Recent flights: FR24's requests are now kept for diagnosis.** On one FR24 the panel's list never reached the script's hook (`listAsked` never set), so the list could not be filled whatever the log held. The last sixty FR24 requests of the page are now kept in memory, readable in the console as `__tweeksLaddBridge.stats.reqLog`, so which request carries the list can be read straight off.

### Tests
- New `unit_logreset`: a real IndexedDB with an older build's logs, today's tracks, learned data, boards and an aircraft record. The first run deletes the logs and tracks and empties the compact recent flights, and keeps the rest of the record, the learned data and the boards. The reset is noted, so the next start keeps a log built since. The window's button asks on the first click and deletes on the second.
- `unit_monitor2`: the monitor's first start with an older (or no) reset note deletes `hist/` and keeps `learn/`; the next start keeps the logs built since; the owner's action deletes the files.

## [B22.31.6] - 2026-10-22

### Fixed
- **Panel photos: "Aircraft photo not available" for an aircraft JetPhotos has photos of** (HB-IGO: four on JetPhotos, two on its FR24 aircraft page). The lookup asks FR24's registration list first. For a blocked aircraft FR24 answers but holds the photos back, and that empty answer was taken for "JetPhotos has none"; JetPhotos itself was asked only when FR24's lookup failed outright. Now, when FR24's lookup has no photos:
  - FR24's own page of the aircraft is read next. Its header shows the airframe's JetPhotos photos, with their photo pages and credits, for blocked aircraft too.
  - Then JetPhotos itself, then Planespotters.
  - JetPhotos is asked once per registration for both the photos and the serial number; it was asked twice.
  - Every aircraft wrongly settled as having no photos is looked up again (photo pipeline version 10).
- **"Recent <reg> flights" said "No flights available" for a blocked aircraft whose log has flights.** FR24 draws that list once, from its first answer, and the page holds that answer nine seconds at most. The list was handed over only once every day of the log had been read from the networks, which takes longer than that for an aircraft whose log is not kept yet. It is now handed over the moment it has flights to list; the monitor's days come in one request. A list read slowly from the networks reaches the page within two seconds, where it never arrived before.
- **Flight logs: much more thorough, in the browser and on the monitor, and rebuilt from scratch.** HB-IGO's log jumped from 15 Jul to 17 Oct.
  - **Both networks for every day.** adsb.lol's file (the last 40 days) and airplanes.live's are merged, so a whole flight one network never heard is in the log. Before, airplanes.live was asked only when adsb.lol had no file, or a take-off or landing was missing. In the browser this applies when the aircraft is looked at; the background still asks adsb.lol only.
  - **A day is done only when every network asked has answered.** A network refusing or timing out is never taken for "no flights": the day is read again later, and the log page says how many days are not fully read yet and why.
  - **Each day records where it came from.** A day read from adsb.lol alone, or with one network refusing, is read again with both the next time the aircraft is looked at.
  - **The last three days are read again** if they were read before that day's files could be complete (six hours after it ended).
  - **The monitor reads every day from both networks**, and builds an aircraft's whole 220-day log when someone looks at it, not just the last 40 days. A day it built while one network refused is passed to browsers marked as partial. A day it heard the aircraft fly with no file anywhere stays unknown.
  - **Every log is discarded and rebuilt**, in the browser (log version 6) and on the monitor (once it is updated). Until a log is rebuilt, the panel's predictions keep using the aircraft's compact recent flights.

### Tests
- New `unit_photopage`: FR24's lookup holding the photos back, so they come from FR24's aircraft page (each with its own photo page and credit, large size). With none there either, JetPhotos itself. With photos in FR24's lookup, nothing else is asked.
- New `unit_recentfast`: networks taking 20 s a file, the monitor holding the aircraft's flights. The list reaches the page in under two seconds and the full list follows. 22.31.5's code never delivers it in time.
- `unit_histgap`: an older build's log is rebuilt from scratch, both networks. A day read from adsb.lol alone is read again with both once the aircraft is looked at. In the background, adsb.lol having no file is never taken for "no flights".
- `unit_monitor2`: adsb.lol and airplanes.live both asked for a day. With airplanes.live refusing, adsb.lol's flights are kept and the day is marked partial; when it answers, the day is complete. An older build's log is not used. The fill covers 220 days. `unit_monlive` and `unit_store` use the new day builder.

## [B22.31.5] - 2026-10-22

### Fixed
- **A map click closed the window only after FR24 had redrawn it: the window went, came back, then closed.** FR24 redraws the open window a quarter of a second after every map click, and 22.31.4 pressed the window's X only once it had been still for most of a second after the click. Its X is now pressed the moment the mouse is let go, before FR24 hears of the click, so the window closes once, as its X closes it, and FR24 has nothing open to redraw.
  - Should it come back anyway, it is closed again after a quarter of a second rather than most of one (four presses at most within eight seconds).
  - Playback's window is still closed a moment later, so a flight picked on its map leaves it open.

### Tests
- `unit_barlook`, on the test page built from the real FR24 recording: the window is gone within half a second of the click (its own closing fade) and is never drawn again. 22.31.4's code fails this: FR24 redraws the window and it closes only 1.6 s after the click.

## [B22.31.4] - 2026-10-22

### Fixed
- **A click on the map still did nothing to a bottom-bar window; it flashed and stayed open.** A recording on the real FR24 map showed two things. First, the flash is FR24's own: about a quarter of a second after a map click, FR24 draws the open window afresh (the old one removed, a new one added at the same moment). Second, this script pressed nothing at all. It decided a window was open from the bar's buttons, and only when exactly one of them looked unlike the rest. On FR24 that never held, so no window was ever found open. Now:
  - A window counts as open when it is on the page as FR24 draws its windows: a header with the title in the middle, and a button holding only an X icon at its right.
  - The bar's buttons are no longer looked at for this. A bar's own labels are never taken for a window's title, even for a bar this script didn't put its button on.

### Tests
- `unit_barlook` has a test page with FR24's real title bar, the window drawn afresh a quarter of a second after the click, and a bar whose buttons' looks tell nothing. Filters, Weather, Settings and LADD Unblock are each put away by their X; a drag of the map or a click in the window leaves them open. 22.31.3's code leaves Filters open there and presses nothing, as on the real map.

## [B22.31.3] - 2026-10-22

### Fixed
- **A click on the map put a bottom-bar window away and it came straight back.** FR24 answers every click on its map by trying to select a flight; its aircraft layer asks for one that is not there ("Flight not found!" in the console, then "Missing parameters: flightId"). Selecting a flight puts the open window away, and the failed try brings it back a moment later. With LADD Unblock open, what came back was FR24's own Widgets window, which is why Widgets appeared when LADD Unblock closed. 22.31.2 looked at the window 0.6 s after the click, found FR24 had already put it away, did nothing, and FR24 then brought it back; spamming the map hid the gap.
  - The window is now watched for eight seconds from the click. When it is open and not coming in or going out for most of a second, its own X is pressed (three times at most). Never a bar button.
  - For LADD Unblock, FR24's Widgets window is watched and put away too.
  - Watching stops as soon as a bar button is pressed after the click, so the person's own choice is never undone. In playback, nothing is pressed once a flight is picked.
  - After FR24 puts LADD Unblock's window away and brings it back, the script keeps the window's title, so it can be closed by its X again.

### Tests
- `unit_barlook` has a mode that behaves like FR24's real map: the window goes away at once and comes back 0.9 s later. For each window of the bar, and LADD Unblock, it must end away and stay away. A bar button pressed just after the click is left alone. 22.31.2's code fails this: the window comes back and stays, and FR24's Widgets appears in LADD Unblock's place.

## [B22.31.2] - 2026-10-22

### Fixed
- **A click on the map closed a bottom-bar window and opened it again, over and over, and could open Widgets from another window.** FR24 puts its window away itself on a map click. 22.31.0 then pressed the window's bar button, which opened it again. 22.31.1 pressed the window's X, but when it didn't recognise FR24's X it still pressed the bar button, or any picture-only button it found level with the title, even outside the window (one opened Widgets).
  - A map click no longer presses any bar button.
  - The window and its button are watched from the moment the map is pressed. If FR24 puts the window away, or redraws it or its button, it is left to FR24.
  - Only a window FR24 leaves exactly as it was is closed, by its own X. The X is looked for only in the window's title band, as a button or as a picture with a click on it.
  - If no X is found there, nothing is pressed.
- **Photos: a thin stock picture first, the carousel later.** The panel drew our photos over FR24's picture only after a second and a half, and FR24's thin stock picture or sideview showed until then.
  - Photos already known are drawn the moment the panel opens.
  - While they are still being looked up (the monitor's cache, JetPhotos, Planespotters), an empty frame of FR24's photo size shows instead of the thin picture.
  - FR24's own stock picture is shown only once the lookup has found none (or after 10 seconds without an answer).
- **An FR24 tab already open did not see a new version for up to half an hour.** 22.31.0 still said "up to date" after 22.31.1 was merged: the tab had last asked GitHub before the merge, and asked again only every 30 minutes (GitHub's copy can also be up to 5 minutes old). It now also asks on coming back to the FR24 tab, when its last answer is over two minutes old, and every 10 minutes otherwise. Opening FR24 still asks at once.

### Tests
- `unit_barlook`, on an FR24 that puts its window away itself on a map click and draws its button at rest a while after. Its X is tried as a button, a picture, and one that opens what it closes, with a picture-only button of the page beside the windows that opens Widgets. Three windows and LADD Unblock are each put away and nothing opens again; 22.31.1's code reopened them and opened Widgets. On an FR24 that leaves the window open, its X is pressed; with a close button it can't recognise, nothing is pressed.
- `unit_panelphoto`: photos known as the panel opens are drawn at once and FR24's slideshow takes over. While they are looked up, an empty frame at FR24's photo size shows, never the fallback, then the photos. Looked up with none found, FR24's fallback shows.
- `unit_hello`: a version merged while FR24 is open. Coming back to the tab within two minutes of the last answer doesn't ask again; later, it does and the update banner comes up.

## [B22.31.1] - 2026-10-22

### Fixed
- **A click on the map put a bottom-bar window away and opened it again at once.** It was put away by pressing its bar button a moment after the click. FR24 was already putting it away itself and draws the button at rest only a while after, so that press opened it again. The click now presses the window's own X, which only ever closes, and does nothing to a window FR24 is already putting away. Should it come back a moment later with nothing pressed on the bar, its X is pressed once more. This applies to LADD Unblock and to FR24's Settings, Weather, Filters, Widgets and now Playback. Playback is left open when the click picks a flight on its map.
- **The LADD Unblock icon no longer thickens under the mouse.** It takes FR24's hover colour only. Selected, it is drawn at the width it used to have under the mouse (2.3, from 1.5 at rest), in FR24's open yellow, whether or not the mouse is over it.
- **Flight logs still had gaps in the last 40 days.** TC-ACN's London to Istanbul of 13 September and Larnaca to Istanbul of 26 September are on airplanes.live but were missing from its log, and N1876T's log had nothing between 15 October and 10 September. The log page takes the days the monitor already has, and the monitor called a day "no flights" when adsb.lol had no file of it, or when it watched the aircraft all day and didn't hear it fly. adsb.lol can miss what airplanes.live hears, so those days were wrong, and the log page took them at once (which is why it loaded instantly with the same holes). The browser now takes only the days the monitor has flights for. Days without flights are read in the browser from both networks, and logs that took them from the monitor have those days read again. The monitor also builds those days itself when someone looks at the aircraft.
- **The "Recent flights" list in the panel said "No flights available"** with the aircraft's flights in its log (N1876T). The list was filled only when FR24's answer came in its usual shape with too few flights. It is now filled whatever FR24 answers: no list at all, an error, or something that isn't JSON. FR24's own lists of ordinary aircraft are left alone. It is also filled when FR24 asks with XHR rather than fetch, without making FR24's own list wait. The last request is noted for diagnosis: `__tweeksLaddBridge.stats.lastList` in the page's console.

### Tests
- `unit_barlook`: an FR24 that puts its window away itself on the map's click and draws its button at rest a while after. Weather and LADD Unblock stay away; the old way opened both again. Playback is put away by its X, and left open when a flight is picked. Under the mouse the icon keeps its line width; open, it is 2.3.
- New `unit_recentlist`: FR24's usual empty answer, no list, a refusal, a page that isn't JSON, and FR24's own list of an ordinary aircraft, over both fetch and XHR.
- `unit_histgap`: the monitor's days with a flight taken as they are, its days "without flights" read from both networks, and a log kept by 22.31.0 read again.

## [B22.31.0] - 2026-10-22

### Added
- **The monitor builds the logs of LADD aircraft and shares them.** When anyone looks at a blocked aircraft (its panel, its "Recent flights" list or its log page), the monitor builds any of its last 40 days it doesn't have yet. From then on every browser gets them at once from the monitor.
- **Blocked aircraft's pictures are shared through the monitor.** Pictures a browser finds are sent to the monitor with its regular report, and every other browser gets them at once instead of looking them up again. Only addresses on JetPhotos' and Planespotters' own sites are accepted, three per aircraft.

### Fixed
- **Flight logs had a hole covering the last 40 days.** N527P's log jumped from 10 September to 21 October, though airplanes.live has all its flights. Every day adsb.lol had no file for was recorded as a day without flights and never read again, and the last 40 days are the ones read from adsb.lol. A day is now recorded as having no flights only when airplanes.live has no file for it either. Logs saved by earlier versions have those days read again, and the monitor's saved days are re-checked the same way.
- **The "Recent flights" list in the panel was empty.** It is built from the last 21 days, which were the empty ones. It now loads like the log page does when you open it, and it also works for aircraft FR24 shows with no history of their own, such as military and N/A flights (FAMUS62, 06-6165).
- **A blocked aircraft's panel showed FR24's stock picture of its type instead of its photos.** N50JE showed a generic Gulfstream credited to Flightradar24, while JetPhotos has pictures of it. That stock picture was taken for FR24's own photo of the aircraft. It is now never treated as a photo of the aircraft, never saved, and the aircraft's JetPhotos pictures are shown in its place. Aircraft saved with it by earlier versions are looked up again.
- **airplanes.live playback links now open the flight's whole day, with every other day reachable.** Before, stepping to another day often showed nothing until you searched for the aircraft again. airplanes.live keeps a link's start and end times for every day you move to, so the other days only showed those hours. Links now open the flight's day and nothing else; the flight is one of that day's legs.
- **FR24's Most tracked list also gets predicted destinations when FR24 asks for the list with fetch**, not only with XHR.
- **The update banner appears the moment FR24 opens on an out-of-date version.** It only came up once the LADD Unblock window was opened. The newest version is now checked as FR24 opens, and the last answer is kept so the banner shows at once. It was also hidden while any of FR24's map widgets were up, because they count as dialogs; it now hides only for real pop-ups.
- **The update page downloads the right zip, and has been redesigned to match the project's GitHub page.** The download link pointed at GitHub's "latest release", which lags behind and could hand back the version you already had. The page now downloads the exact version on offer and names the file for it. It also lists what's new since your version, and in Brave it explains how to turn on one-click updates.
- **A blocked flight opened before FR24 had drawn its panel no longer loses its strip.** If the script looked at the page in the moment between the flight being opened and its panel appearing, it found no panel and forgot which flight was open, so the strip was never drawn unless the flight was also in the page address. A flight opened in the last 3 seconds is now kept while its panel is being drawn.
- **The LADD Unblock icon now gets clearly thicker on hover and when open**, and the dot drawn on it when an update was out has been removed. The update banner says so instead.

### Tests
- New `unit_histgap`: with no adsb.lol files, a looked-at log gets its flights from airplanes.live and both networks' "no file" counts as no flights. A background load records no day as empty and doesn't ask again at once. Logs saved by older versions are read again.
- New `unit_photocache`: the monitor's picture store (sites accepted, stock pictures dropped, a browser's budget, kept on disk); the browser takes the monitor's pictures with no lookup, and sends pictures it finds.
- `unit_monitor2`: days asked for to fill a log, airplanes.live refusing, old saved "no flights" days, `/hist` queueing the missing days, and `/report` with `/photos`. `unit_flightmsg`: FR24's stock picture dropped from a blocked aircraft's panel. `unit_mosttracked`: Most tracked over fetch. `unit_selfupdate`: the by-hand download and what's new. `unit_barlook`: the icon on an FR24 whose icons don't thicken. `unit_pbbuttons` / `unit_pbnative`: day-only playback links.

## [B22.30.3] - 2026-10-21

### Added
- **FR24's Most tracked flights list shows predicted destinations.** A flight that FR24 lists with no destination now shows the one worked out here, as it would on the flight's panel and the airport boards. For example, AF1 out of Andrews showed "ADW – N/A" and now shows GSP. A flight not yet worked out is worked out from FR24's own track of it, fetched in the background, wherever it is in the world, and appears the next time FR24 refreshes the list. FR24's own destinations are left as they are.
- **Route searches list the flights worked out on that route.** Searching for a route such as "LPL-EIS" (or "EGGP-TUPJ" in ICAO codes) lists every flight in the air on it, as FR24 lists its own: blocked aircraft such as M-PORT, and flights FR24 shows without a destination. Each comes with its flight card and dropdown, and its callsign follows it in the list, linking to its flight-number page (MPORT). This also works when FR24's search returns nothing for the route.
- **FR24's own search results get the predicted destination** of a flight FR24 has none for, in the result and its route line.

### Fixed
- **A click on the map closes the bottom bar's open window, as its X does.** This covers LADD Unblock and FR24's own Settings, Weather, Filters and Widgets windows. Dragging the map, clicking inside the window, and FR24's Playback are left alone.
- **The LADD Unblock icon changes like FR24's other bar icons.** It gets thicker and changes colour on hover, and thicker and yellow when open. The thickness and colours are read from FR24's own buttons in each state; the icon used to stay the same throughout.
- **The LADD Unblock window's switches slide across when turned**, as FR24's do, using the speed and easing of FR24's own switches when they can be read. The window used to be redrawn on every change, so a switch only appeared in its new position. The window now changes only what differs, which also keeps text typed into its fields.
- **The tooltip with the reasons for a predicted destination stays up while you read it.** The aircraft panel's strip was redrawn every time it was updated, several times a second, which closed the tooltip. Only what changed is updated now, and the tooltip's text updates once the mouse leaves.

### Tests
- New `unit_barlook` (real Chromium, on the Vue page made like FR24's, with Google's map under it): a map click closes FR24's window and LADD Unblock's, but not after a drag, a click in the window, or with playback open. A switch slides part-way across on each frame and stays the same element. The icon at rest, on hover and open matches FR24's icons. A tooltip being read stays up.
- New `unit_mosttracked` (the built userscript in jsdom, both halves): Most tracked (Feed/TopFlights and JSON) is filled, FR24's own destinations are kept, and unworked flights are requested and then worked out from FR24's track. Route searches are tested in IATA and ICAO codes, with FR24 failing, and are not listed after landing or for another route. FR24's own search row gets the destination.

## [B22.30.2] - 2026-10-17

### Fixed
- **A flight that came down in a hole in coverage and flew on is two flights, not one from where the first began.** N6012C (a Gulfstream G600) was heard at cruise over central Asia, not heard for hours, and heard again over the Black Sea: it had landed at Baku and flown on, and the panel said it took off from Hanoi, 8,000 km back. A hole at cruise is now a stop when the ground across it, at the slower of the aircraft's two speeds either side, leaves three quarters of an hour and a quarter more time than the flight needed (flying straight through leaves a few minutes: none of the holes in over 300,000 real trace points changes), or when the aircraft is found climbing from 8,000 ft or more below where it was lost, or was lost going down at 8,000 ft or more below where it is found. The aircraft's log no longer joins the flights either side of such a hole.
- **The flight in progress begins after that hole**, in the userscript and in the monitor. FR24 keeps one flight id through a stop, and its trail, with the ADS-B in front of it, held the flight before; the track is now cut at the last take-off or hole it came down in, as the log's flights are. The departure is then the field that fits both ends of the hole, said to be "out of ADS-B coverage", or none: never the take-off of the flight before.
- **A browser's own answer stands over another browser's.** "Worked out by another browser" took the place of the destination this browser had worked out itself, with the aircraft's log or its take-off seen, whenever the other put its odds 10 points higher; and what this browser had worked out was not sent to the monitor. A browser that has the aircraft's log, or saw its take-off on the ground, now keeps its own answer whatever odds the other put on its own; another's fills a panel that has no destination, or has neither of those and a destination 10 points less sure, and a destination confirmed in another browser still stands. Its own answer goes to the monitor to be kept and handed to the others.
- **The departure of the flight before is dropped wherever it is kept**: by the browser for the flight id, in the route another browser sent (the departure that came with a wrong destination), and on the monitor in its own answer and in the route it hands out.
- **The odds were worked out for the wrong flight.** With the departure of the flight before, the distance flown, the line flown and the range left were those of a flight from Hanoi, so the destinations it weighed lay along that line and none stood out. They are now worked out for the flight it is on. A jet still thousands of kilometres out, on a line a dozen airports share (across the Atlantic to the US East Coast), keeps near-equal odds for them: that is what is known until it is nearer.

### Tests
- New `unit_n6012c`: the hole rules (a stop, a hole flown straight through, climbing out and going down), with over 300,000 real trace points checked to keep their flights whole; the flight in progress cut at the hole in the userscript and the monitor; the built userscript on N6012C as FR24 and adsb.lol could have given it (FR24's first point on the ground at Baku, climbing, at 26,400 ft, none; one flight id from Hanoi; today's trace only), its log, its own route standing over another's and being sent to the monitor, and the departures of the flight before dropped from the browser's record, the shared route and the monitor's rows.

## [B22.30.1] - 2026-10-16

### Fixed
- **Playback on a blocked flight opens its track on airplanes.live again**, in a new tab - from the flight cards on airport boards, the aircraft panel (its Playback button and the one in More), search results and the rows of the panel's recent flights - not FR24's map playback, which 22.30.0 used by mistake. The track runs from five minutes before take-off to five minutes after landing (or until now). FR24's own playback is opened only by the Playback button on the bottom bar, and every flight FR24 knows keeps FR24's Playback.
- **The LADD Unblock button is on the bottom bar from the first frame the bar is drawn**, instead of up to a second after, when it could be seen appearing. It is put there in the same turn FR24 draws the bar, before the browser paints it.
- **The LADD Unblock button changes size with FR24's other bar buttons.** FR24 draws the bar's buttons small while its playback is open and larger when it is put away; the button was made once and stayed as it was (small beside large buttons once the playback was closed). It is now made again the same way as theirs whenever theirs change.

### Tests
- `unit_native` checks, in every layout of the mock page, that the button is on the bar in the first frame of a bar built late and drawn with FR24's buttons in no frame apart while the playback opens and closes; `unit_pbbuttons`, `unit_pbnative` and `e2e` check the airplanes.live address.

## [B22.30.0] - 2026-10-16

### Fixed
- **A predicted destination has to fit the way the aircraft is flying.** An airport far behind or off to the side of a steady, level aircraft that isn't getting closer to it is marked down hard, so the past record of an airframe no longer wins over where it is heading (SE-RLZ shown going to Angelholm while flying towards Warsaw). Aircraft turning, climbing out, near an airport or squawking an emergency are not judged this way, nor are helicopters, light aircraft or military flights other than business jets.
- **A destination worked out by another browser or the monitor is checked again on every update.** It is dropped once the aircraft flies away from it, or, unless it was confirmed, when its arrival time has passed by 15 minutes (more on long flights) and the aircraft is still in the air far from it. A single position never drops one on its own (TC-AKB stuck on "Le Bourget 74%" while descending south near Turin). The monitor drops such destinations at once too, and `/status` counts them (`destsDropped`).
- **No arrival time in the past is shown**, and the route of the flight shown keeps updating while its log is loading.
- **Playback on a blocked flight plays it in FR24's own map playback**, in the same tab: from the flight cards on airport boards, the aircraft panel's Playback button and search results. It starts 3 minutes before take-off over the departure airfield (or 10 minutes before landing, or a few minutes ago at its position), with the flight selected on the map. Middle-click or Ctrl/Cmd-click opens it in a new tab. Other flights keep FR24's own playback.
- **The bottom bar's Playback button opens FR24's playback window again**, as it does without the extension.
- **A blocked aircraft's picture is FR24's full size with one photo credit**, instead of a short strip (JNY5, T7OKS). FR24's own picture elements are no longer changed; the extension shows its own picture in their place until FR24 has one.
- **No airline logo on a private flight.** An airport's boards guessed a flight's airline from other flights in its schedule, which put Jet2's logo on Gulfstream N358V arriving at East Midlands. The airline is now taken only from the same flight number, and boards saved with the wrong logo are cleaned.

### Tests
- New: `unit_heading` (destinations off the aircraft's track), `unit_pbbuttons` and `unit_pbnative` (Playback buttons, the last in Chromium on a Vue page), `unit_logos` and `unit_panelphoto` (the picture in FR24's panel, in Chromium).

## [B22.29.0] - 2026-10-16

### Added
- **Update is one click for the extension (Chrome, Edge), with nothing to download or unzip by hand.** Update opens the extension's own update page next to Flightradar24. It downloads the new version's files from this repository's release, checks each against the SHA-256 the release lists (`files.json`), writes them over the old ones and deletes the old version's files the new one no longer has, touching nothing else in the folder. It then says it's done and offers **Refresh page**, which restarts the extension and loads Flightradar24 again with the new version. The first time, Chrome asks you to choose the extension's folder and allow it to be edited; it never lets an extension write files without that. Browsers that don't allow it (Brave) get the zip as before.
- **A banner at the top of Flightradar24's map when a newer version is out**, with Update and Later, so it's seen without opening the LADD Unblock window. It says when this update is required, and shows the monitor owner's notice when there is one.
- **An anonymous count of installs.** Each install says hello to the monitor at most every 12 hours with a random id and the version, install type, browser and system by name, and nothing else (see [PRIVACY.md](PRIVACY.md#counting-installs)). The monitor counts one person per network, so one person's browsers are not counted twice, and keeps no IP address with the count. The switch "Count this install (anonymous)" in the LADD Unblock window turns it off. The README shows the count as a badge, from the monitor's `/badge`.
- **The monitor's dashboard is an admin panel** with five pages:
  - Overview: health, versions, disk space, Update monitor and Restart.
  - Users: people and installs, active per day, versions, browsers and systems.
  - Traffic.
  - Logs.
  - Options: whether the monitor is public, its rate limit, counting installs, the notice shown on every map, and the lowest version still supported.
- Tests: `unit_selfupdate` runs the whole update in Chromium, from the banner to the new version running. `unit_installs` and `unit_dash` cover the monitor's count and admin panel.

## [B22.28.9] - 2026-10-15

### Fixed
- **The bottom of the LADD Unblock window is no longer cut off once it has finished opening.** The window was held above the bottom bar's top edge, a few moments after it opened, although FR24's windows reach lower, beside the bar (which is in the middle). It now ends where FR24's own windows end, such as Settings and Weather.

## [B22.28.8] - 2026-10-15

### Fixed
- **The LADD Unblock window no longer turns into FR24's Widgets list by itself.** When FR24 redrew its window while LADD Unblock was open (its data refreshing), the new window came up as plain Widgets and LADD Unblock vanished without being closed. The redrawn window is now given the title and content as it comes in, so the window stays, with FR24's own movement for the swap. Pressing another button, a flight, Widgets or the close button still puts it away.

## [B22.28.7] - 2026-10-15

### Fixed
- **The LADD Unblock window's colours are FR24's again.** In FR24's own window its body was dark, the grey of the title bar, so the dark words on it could not be seen. It now has the light grey body of FR24's other windows (Weather, Filters) under the dark text.

## [B22.28.6] - 2026-10-15

### Changed
- **LADD Unblock now opens in FR24's own window, like every other option on the bar.** Pressing it opens FR24's Widgets window under the name "LADD Unblock", with the script's switches in it: so it is FR24's size, title bar, text and movement at any zoom, whatever window was open drops back with FR24's own animation, and only LADD Unblock is lit on the bar. Opening a flight, an airport or another option closes it the way FR24 closes its own, and pressing Widgets brings Widgets back. If FR24's window is ever not found, a copy of it is used instead.
- Tests: `unit_native` runs the window in Chromium on a Vue 3 page built like FR24's (`test/fixtures/fr24mock.html`), in seven layouts, frame by frame, in CI.

### Fixed
- **Playback on a LADD flight opens its airplanes.live track from every airport board and from search.** N600EB's departure from LaGuardia on Tuesday opened the aircraft's FR24 page: only today's rows of a flight still flying were known. Rows kept from earlier days, the flight or the aircraft found in the search, and a middle-click now open the track, from take-off to landing. Other flights keep FR24's playback.
- **The empty bar between "Disruptions" and "Airport statistics" on airport panels is gone.** It was the box the latest events sat in, still counted as showing something because of an empty box FR24 keeps beside them. Any box in that list with nothing in it to see is hidden before it is drawn, and comes back when FR24 puts something in it.
- **FR24's Bookmarks widget is switched off in FR24's own Widgets list**, so FR24 no longer puts it on the map at all; anywhere it would still be put in, it is hidden before the page is drawn, never for a moment.

## [B22.28.5] - 2026-10-15

### Changed
- **The LADD Unblock window's text is now as large as FR24's own, and its title bar matches theirs.** The text, which was about three quarters of the size of the bottom bar's, is now the same size; the grey title bar has FR24's lettering and a larger, thinner close button.
- **A "Text size" option in the window** (S, M, L, XL), kept between visits.
- **It takes the place of FR24's panels instead of lying over them.** While the window is open, the widget panels FR24 always shows on the map go away, and opening it closes any other bottom-bar window that is open (Settings, Weather, Filters, Widgets). Closing it brings the widget panels back.

### Removed
- **FR24's Bookmarks widget, completely:** its panel on the map and its entry in the Widgets window.
- **The empty space left under "Disruptions" on every airport's panel.** It comes back by itself if there is ever something in it.

## [B22.28.4] - 2026-10-15

### Fixed
- **A LADD aircraft's slideshow no longer opens on a short picture with "© name - JetPhotos" burnt into its bottom.** JVW739 (OE-GAB) showed it on first click. When FR24 has its own pictures of a blocked airframe, it sends them in the panel's first answer, and they were passed on as FR24 sent them, in JetPhotos' credit-bar size. They are now given to the slideshow the same way the script's own pictures are: the clean large picture, drawn like every other slide. As a second guard, any JetPhotos picture in its credit-bar size that reaches the page by any other route is switched to the clean size as it is drawn.

## [B22.28.3] - 2026-10-15

### Fixed
- **One row for a flight that was planned again, and its card filled in.** Liverpool's departures showed Cranwell FTU's CWL52 to Glasgow twice: FR24's own row at 15:30 (estimated 15:40) with an empty card - airline N/A, aircraft N/A - and the schedule's at 16:15 (16:25) with a filled card. The two were exactly 45 minutes apart, and a flight counted as the same one only when its times were *less than* 45 minutes apart. Now the same callsign to the same airport within two hours is one row (FR24's own), when the flight has not been flown yet; two flights already flown 45 minutes apart (circuits, shuttles) are still two. The kept row's operator and aircraft go into the card FR24 leaves empty - and a card is filled from what is kept of a flight even when its aircraft is not known.
- **The wrong airline's logo on a row.** That second row carried Ryanair's logo on Cranwell FTU's flight. An airline id is now used only where it is the airline the row names; where the two disagree the name stands, with the logo FR24 lists under it, or none.
- **Place names without their county.** "Rotherham, South Yorkshire" (OurAirports' name for the town by Wentworth Private Airstrip, which was on a board row as "Rotherham, S...") is now Rotherham, and "Private site near Rotherham, South Yorkshire" is "Private site near Rotherham". A place is the part before its first comma, on boards, in panels, in playback and in search: landing places, airfields, heliports, owners' towns. Two different places that would read the same - "Newport, Wales" and "Newport, Isle of Wight" - keep their whole names. Landing places kept by an older version are cut when shown.

### Changed
- `ENGINE.placeShort` (and `ENGINE.placeLabels` for a list) is the one cut for place names; the page half has the same three lines and `test/unit_places.cjs` checks they agree.
- Tests: `unit_dupes`, `unit_places`.

## [B22.28.2] - 2026-10-15

### Changed
- **The LADD Unblock window now copies FR24's own windows instead of guessing at them.** It is the width of Widgets and sits where Widgets does, its title bar is as tall as FR24's on screen (so its text and switches are the same size as theirs, whatever zoom FR24's page uses), and it opens and closes with the same movement as FR24's windows. It learns all of this by watching the first FR24 window you open from the bottom bar, and keeps it. Before then, it uses the size of Widgets as it appears in a screenshot and simply appears.
- Its section titles, dividers, corners and switches are drawn in Widgets' colours and sizes.

## [B22.28.1] - 2026-10-15

### Fixed
- **A flight FR24 has no destination for, in map playback, gets one where FR24's own track ended.** CAPTR33, a Hawk out of Leeming on 15 Oct, was heard only by multilateration and lost out over the Irish Sea, so its public track had no landing and the panel said "QKG → N/A". Where the public track has no end, FR24's own track of the flight (its free playback) is read at the same time, and an end of it down at a field (low and slow, within 7 km of an airport or 2 km of a strip; a landing site for a helicopter or light aircraft) is the destination or origin. It goes into FR24's panel answer, which now waits for the route as well as the track (1.5 s at most). One that comes after FR24 has drawn the panel is written into its own "N/A" boxes, with the city under the code.
- **Playback panels the page never identified are filled from the panel itself.** When the page's message about a flight's aircraft did not arrive, nothing was filled in: no route, the serial number and squawk padlocked, the age "N/A". The ICAO address on the panel is now used once it is the new flight's (not the one before, still on screen for a moment).
- **The serial number, age, country and squawk in playback are filled where FR24 shows "N/A" as well as where it shows a padlock.** The squawk comes from the flight's track at the moment shown. Everything written for one flight is taken out again when another is opened.
- **"Private Site" is shown in the playback header of an aircraft's page.** G-FRGP's row read Liverpool → Private Site, but the header of its playback said "To: -". FR24 builds that panel when Play is pressed and fills it from its own request, after the page's checks had run. The header's "-" ends are now checked as the playback runs, and are read from the row itself when needed.
- **A LADD aircraft's pictures in playback come in about a second instead of tens of seconds.** They were asked for only after the register lookups had finished, and then at the back of the queue. They are now asked for the moment the flight is opened or named, at the front of the queue, in parallel with the registers. FR24's panel answer waits for them (2.5 s at most), and pictures that come later are put into the slideshow. Blocked aircraft named on the playback map have theirs fetched in the background (40 at most), so the one clicked usually has them already.

## [B22.28.0] - 2026-10-15

### Added
- **The LADD Unblock window says when this version is out of date.** A small amber dot appears on the bottom bar's LADD Unblock button when a newer version is out, and the window's **Updates** says so in a line of its own. The newest version is looked up a little after FR24 opens and every 6 hours.
- **A short "what's new" note after an update.** The first time the window is opened after an update, a small note at its top gives the new version's main changes, with a link to all of them. It stays until it is dismissed with its ✕. Until the window is opened, the button has a small blue dot.
- **The monitor's own figures in the window.** A new **Monitor** section shows its version (and whether it is behind), how long it has been running, the live list and how old the LADD list is, blocked aircraft and flights kept, FR24's scan and how many of its flights are named, flights waiting to be named, lookups served to browsers, owners known, its queues, its errors and any hosts it is leaving alone. With the owner's secret it also shows its memory, load, requests a minute and browsers. These come from the monitor only, every 20 seconds while the window is open; the data services are not asked anything more.
- **Controls for the monitor, with the owner's secret.** **Update monitor** does what `deploy.sh` does on the server: the newest version from GitHub, restarted, checked, and put back if it does not answer. **Restart** saves everything and starts it again. **Log** shows its latest log lines and how the last update went. Each button needs a second click to act. The monitor needs updating once on the server (`bash ~/fr24-ladd/monitor/deploy.sh`) for these to appear.
- **This browser's own figures:** flights identified, routes worked out, flights the monitor named, blocked aircraft live, and requests answered and failed since FR24 was opened. Each data source under **Data sources** also counts its answers and failures.

### Monitor
- `POST /admin/update`, `POST /admin/restart` and `GET /admin/log`, only with the secret (never on a monitor without one). `/status` and `/stats` give the monitor's version and commit.

## [B22.27.2] - 2026-10-15

### Changed
- **The Firefox add-on's id is now `ladd-unblocker@finlayc1.github.io`.** Firefox Add-ons would not take the old id (`fr24-ladd-unblocker@finlayc1.github.io`) for a new listing ("Duplicate add-on ID found"), because the self-distributed upload of 22.27.0 holds it. With a new id the Firefox build goes on as a new, listed add-on. Nothing else changes, and Chrome and Edge are not affected.

## [B22.27.1] - 2026-10-15

### Changed
- The same as 22.27.0, under a new version number, so the Firefox build can go on Firefox Add-ons as a listed add-on (the site takes each version number only once, and 22.27.0 went up as a self-distributed one).

## [B22.27.0] - 2026-10-15

### Added
- **A Firefox build of the extension, ready for Firefox Add-ons.** The extension zip failed addons.mozilla.org's check with three errors: its background was a service worker only (Firefox runs a background script instead), it had no add-on id, and its script, at 8 MB, was too large for the check to read. Each release now also has `fr24-ladd-unblocker-firefox.zip`, which passes Mozilla's own check (addons-linter) with no errors:
  - its background is `background.js` as a background script;
  - its add-on id is `fr24-ladd-unblocker@finlayc1.github.io`, and it says what it sends (what FR24's page shows, to the shared monitor, as set out in PRIVACY.md);
  - it needs Firefox 140 or later, on the desktop.
- In Firefox, the LADD Unblock window's **Updates** shows "Firefox add-on": Firefox updates it from Firefox Add-ons by itself, so **Update** downloads nothing.

### Changed
- **The extension's learned tables are in files of their own** (`data-1.js` and so on, beside `content.js`), each well under the 5 MB Firefox's check reads; `content.js` is now about 1 MB. The Chrome and Edge extension works as before. To update an unpacked one, unzip the new zip over the old folder as usual (the new files are added) and click **Reload extension**.

## [B22.26.1] - 2026-10-15

### Fixed
- **Made-up flights on the airport boards: both ends are checked now, for every jet FR24 shows itself.**
  - Biggin Hill's departures were full of easyJets, a China Southern 787, a Norwegian, an Iberia Express and BA CityFlyers "departed Biggin Hill -> Gatwick". These were Gatwick's arrivals, heard for the first time at a few thousand feet over Biggin Hill on the way in. A board that is opened has the monitor listen around that airport, so jets passing low over it are first or last heard there. 22.25.1 checked only the far end of a flight, and these did land at Gatwick, so they got through.
  - Luton's departures had rows showing a callsign only, going to "N/A", next to FR24's own: NetJets, VistaJet, Wizz, Wizz Malta, and jets flying under their registration. Business jets "to Stansted" and "to Biggin Hill" came from legs first heard over Luton.
  - Now a row the script makes of an aircraft that is not blocked (a flight FR24 shows itself) is kept only when both its ends were seen. An airliner's take-off and landing must both be seen on the ground. A business jet's or turboprop's ends may also be seen low, under 3,000 ft within 15 km of the field, but not as a landing guessed inside a hole in coverage. A row with an end unknown ("N/A") goes too, followed live or not, because FR24's own row says the same. A registration's real return to the field it left, seen at both ends, stays.
  - A light aircraft or glider, blocked or not, is on an airport's board only when it was seen there, on the ground or low beside the field. G-RDGE, a glider out of Chester, was "departed Liverpool": it was first heard soaring 25 km away.
  - Rows already kept are removed when a board is opened, or when the monitor or an aircraft's log sends them again.
- **FR24's own row of a flight and the script's row of it, side by side.** On Liverpool's arrivals, U281 from Belfast showed "Scheduled 14:40, A320", with EZY89VK (the A319 G-EZBX) landed from Belfast at 14:42 beside it. FR24's flight-number list was read before the flight flew, so its row had no callsign to match. The two are now one row when the airline, the other airport and the time (within 45 minutes) agree. That row is FR24's own, with what was seen added: landed at 14:42, the A319 that flew it, its callsign.
- **The wrong airline logo on a row.** G-NBCA, a PC-12 flying as GNBCA, showed easyJet's logo on Liverpool's arrivals. A row's operator came from the last callsign the aircraft's record had, not from the flight's own callsign. It now comes from the flight's own callsign, and an airline's from its callsign as before.
- **A glider shown as a "Business jet"** with no type when its type code was not known. A glider is now shown as FR24 shows one, as type GLID in the glider category, going by its model (DG-1000S, ASK 21, Discus and so on).

## [B22.26.0] - 2026-10-15

### Added
- **LADD Unblock on FR24's bottom bar.** A new button after Playback, with its own icon (an aircraft with an open padlock), opens a window drawn like FR24's own Widgets and Weather windows. It holds every setting in one place:
  - **Enable LADD Unblock**, to switch the whole thing off and leave FR24 as it is. The button and window stay so it can be switched back on. Applies after a reload.
  - A switch for each feature: the aircraft panel details (the strip under the photo), airport boards, search, aircraft and flight pages, take-off and landing alerts, and hiding ads and upgrade prompts. Each takes effect at once except where it says otherwise.
  - **Updates**: the version installed and the latest one. For the userscript, **Update** opens the new file and your userscript manager offers to update. An unpacked extension cannot replace its own files, so **Update** downloads the new zip; unzip it over the old folder and click **Reload extension**, which loads it again and reloads FR24.
  - **Data sources**: which feeds are answering, the monitor, and the ADS-B Exchange and FAA NOTAM keys. These used to be behind **sources** on the strip, which is gone; the version number on the strip now opens this window.
- The button is found by the bar's labels and copies one of FR24's own buttons, so it takes the bar's look. If FR24 draws the bar again, the button is put back. The window takes the place and width of FR24's own windows once one of them has been opened.
- The userscript names its update address (`@updateURL`, `@downloadURL`), so userscript managers check for new versions on their own.
## [B22.25.2] - 2026-10-15

### Fixed
- **A take-off seen by FR24 was lost, and the departure shown as "unknown, first seen at FL368".** KSK16, a Challenger 605 out of Ankara (Etimesgut) for Nairobi, had FR24's own trail from the runway climbing out south-west of Ankara, yet the panel had no departure. FR24 leaves out a height it does not have, so such a point of its trail reads 0 ft. One of them after the climb was taken for the aircraft down low, the hole in coverage after it for a landing, and the take-off before it for an earlier flight, which was cut off. A point of FR24's trail at 0 ft is now read as having no height when the aircraft is moving at speed away from every airfield, or was heard more than 3,000 ft above the field under it within the previous three minutes. A take-off or landing roll at 0 ft on a runway is read as before, at fields high up too (Etimesgut is at 2,600 ft). This is worked out in the browser, so the monitor does not need updating for it.
- **A helicopter "took off from Manchester" eleven minutes into a flight FR24 was already showing in Wales.** G-IOOS, an A109 at 137 kt over Swansea Bay at 08:33Z, was shown as "took off from MAN, 08:09Z": 230 km in 24 minutes. A departure the aircraft cannot have made is now neither kept for the flight nor shown. The test is whether, at any speed the aircraft has flown (half as fast again, plus 30 km), it could have got from that airport at that time to where it is now. A departure worked out once for a flight is kept for it and stands over weaker answers later, so a wrong one stayed. How Manchester came in the first place could not be traced from here. One sign is that the panel's true airspeed (414 kt) cannot be an A109's, so public ADS-B reports from another aircraft were likely mixed in under G-IOOS's address. Reports placing it at Manchester in the middle of the flight are already dropped from its track (checked in the test). This is worked out in the browser too.

## [B22.25.1] - 2026-10-15

### Fixed
- **Made-up flights on the airport boards, again.** Luton's arrivals had easyJets and Wizz jets "from Stansted" and a Ryanair "from Liverpool", none of which flew those routes. Each was a real landing at Luton given an origin nobody saw it leave. These jets were first heard in the air near Stansted, in the hold the two airports share, and the place they were first heard was taken for where they took off. 22.24.0's fix covered only an end close by, and it trusted any row whose landing was seen. Now a row the script makes of an airline's jet flying its own flight number (a flight FR24 shows itself, with its real route) is kept only when its other end was seen: the take-off there on the ground for an arrival (or FR24's own origin, for one followed live), and the landing there on the ground for a departure. A departure "to Palma" whose landing nobody saw goes too. Business jets, light aircraft, and blocked or military aircraft are not affected. Rows already kept are removed when a board is opened, and rows the monitor sends are checked the same way, so the monitor does not need updating for this.

## [B22.25.0] - 2026-10-15

The monitor keeps working on a flight until it can name it, and what one browser works out reaches every other. Update the monitor with this release: an older monitor ignores what browsers share, and nothing breaks.

### Added
- **The monitor keeps working on a flight until it can name it.** A playback flight it had no name for, and a callsign-less flight in its own FR24 scans that it could not name live, now go on a waiting list and are tried again and again: at once when a browser asks about a new moment of it, a minute later, then less and less often, up to ten minutes apart while the flight is recent and an hour apart after that (six hours when no aircraft the monitor follows has been anywhere near it). Each moment a browser asks about adds to the flight's path. The path is laid against every blocked aircraft's track as that track grows (live ADS-B, the day rebuilds a day later, FR24's own trails). A flight is named when one aircraft of its type fits it everywhere it can be placed, at its height, and no other comes close. Two flights where one aircraft could be: neither, for now. Kept three days.
- **Dead reckoning across the holes in a track.** An aircraft out of hearing over the ocean for two hours is carried along the great circle between where it was last heard and where it was heard again. Past its last point over open water it is carried on at its own speed and track for up to three hours (a quarter of an hour over land, where airways turn). A playback flight in such a hole is now named, as "monitor (its track, carried across a gap)".
- **A playback left open asks the monitor again** every 45 seconds about the flights still unnamed (for a quarter of an hour after its last frame), so a name the monitor works out meanwhile appears without scrubbing.
- **Routes worked out in one browser show in every other.** When a flight the monitor names is opened, the route the browser works out with the aircraft's whole log (or with its take-off seen, or a destination confirmed) goes to the monitor with the browser's next report. Every other browser gets it with the names: on the map at once, and in the panel when the flight is opened there before that browser has the aircraft's log, marked "worked out by another browser". A destination confirmed in one browser is "confirmed in another browser" in all of them and stands over guesses. A browser's own route stays where it is about as good (within ten points). A browser never sends back a route it got from another, nor a landing (every browser sees where the aircraft is). Each end of a route is kept on its own, so a browser that sends only an origin leaves another browser's destination in place. A shared origin lasts the whole flight; a shared destination lasts until, an hour on, the flight has come no nearer to it (a confirmed one stays).
- **Every browser's engine learns from every browser's flights.** The completed flights a browser rebuilds from public ADS-B (including aircraft the monitor does not follow) go to the monitor, are learned there with its own, and reach every browser's engine with the next /learned. Each flight counts once: the browser that sent it leaves its own copy out once the monitor's learning has it. A flight the monitor did not take (refused, or past a browser's hourly share) goes on being learned in that browser.

### Monitor
- New `waiting.cjs` (the waiting list) and dead reckoning in `tracks.cjs` (`estimate`, `atAll`, `around`). /pbmatch tries the moment's unnamed flights against the tracks at once, within a time budget shared by all browsers, and leaves the rest to the background (every 15 s). Names worked out later are kept with how they were found and given to later playback asks.
- /report takes `routes` and `learn` from browsers, up to 600 an hour each from anyone's browser (`routesPerHour`, `learnPerHour`). Each is checked: a destination behind the flight is refused, and a learned flight must read as a real one. The reply says what was taken. /fr24ids rows have three more columns: whose route it is (0 the monitor's, 1 a browser's, 2 confirmed in a browser), the destination's word, and whether the origin is a browser's.
- /status and the dashboard show the flights waiting, the ones named later, and what browsers shared.

### Fixed
- The monitor's rough destination showed its chance as under 1% on the page: it was sent as a fraction where the page expects a percentage.

## [B22.24.1] - 2026-10-15

### Fixed
- **The flight an aircraft is flying now showed up in its own "Recent flights" list** as a past flight, "Manchester -> N/A, Unknown" (N212AP as WWI21 to Teterboro, VQ-BXF as PEX28F to London City). For a flight FR24 routes itself, the script has no route of its own, so it took the aircraft to be on the ground. It now goes by FR24's own plan of the flight (departed, not arrived) or by where the aircraft is (in the air within the last 20 minutes). Where the aircraft is wins: one on the ground after landing still has its last flight listed first, even when FR24's plan never says it arrived.
- In the same list, an older flight last heard high (lost from hearing in the air) was left out while the aircraft was flying. Only the flight on screen is left out now.
- **A short picture with a second credit burnt into it** opened an aircraft's slideshow the first time ("© Boltushkina Anastasia - Kazakhstan Spotting Club - JetPhotos" under FR24's own credit). It was FR24's own picture of the blocked airframe in JetPhotos' credit-bar size: arriving while the script waited for Planespotters, it was taken for Planespotters' answer and shown uncleaned while JetPhotos was still slow. It is no longer taken for that answer, every picture is cleaned before it is shown or kept, and the page strips the credit-bar size as well.

## [B22.24.0] - 2026-10-15

Playback names flights at once with no N/A or padlocks, and the airport boards lose their made-up flights.

### Changed
- **Playback names flights at once.** The browser no longer waits for the monitor before it looks for itself. As soon as a playback shows its first frame, it fetches adsb.lol's record of that half hour (the heatmap) and matches it at the same time as it asks the monitor. Whichever answers first names the flight, so a monitor that is slow or down costs nothing.
  - A matched aircraft that the browser already knows (its registration and type) is named right away. Its callsign follows when its track arrives. Before, each match waited for that aircraft's track of the day, one after another.
  - The heatmap file is fetched as soon as the playback opens, with no two-minute wait, and the next half hour's file too near its end. The last two stay in memory and the last six finished half hours stay on disk (the browser's cache storage), so a playback opened again, even after a reload, has its names at once.
  - A flight that was not matched is tried again two minutes further on, instead of never again that half hour.
  - Matching against the heatmap is about four times faster: each moment's flights are indexed by map cell (the same results; `heatMatch`).
- **No "N/A" for Mach or temperature in playback.** The track's own Mach and outside air temperature are now used. Where the track has none, Mach is worked out from the indicated airspeed and altitude, and the temperature from the true airspeed and Mach (only at Mach 0.395 and above, and only within 35 °C of the standard atmosphere). Against the aircraft's own figures in the test tracks, both are typically within 0.001 Mach and 1 °C.
- **No padlocks on country, serial number and age in playback.** FR24 sends a playback panel only once, often before the registers have answered. These cells are now filled in as the answers arrive, as on a live flight.

### Fixed
- Owner names: "LLC" stayed on a name that is only a number ("756J LLC" is now 756J). Dubai free-zone forms are taken off too ("MAPA AVIATION DWC-LLC" is Mapa Aviation; also FZE, FZCO, FZ-LLC and DMCC).
- The airport panel: the "Latest events" part left an empty box under the weather, and it and the plea to improve coverage showed for a moment before they were removed. They are now removed as FR24 adds them, before the browser draws them, and the box they sat in goes with them.
- **Made-up flights on the airport boards.** Biggin Hill's arrivals were full of easyJets "from Gatwick", and Manchester's departures had Ryanairs and a Qatar 787 "to Manchester" and "to Liverpool". These were jets climbing out of the airport next door, given a landing they never made:
  - A flight lost from hearing while still climbing was given a landing at the field below or ahead of it. A jet is now only landed where it was heard coming down (`climbingAt` in the engine). Flights kept by earlier versions and by the monitor are checked again before they reach a board (`climbedOut`).
  - The live prediction routed an airline's departing jet to the next airport along its departure. An airline's jet flying its own flight number is no longer routed back to the field it left, or to one within 80 km.
  - Rows already kept of such flights are removed when a board is opened. A row of an airline's jet is never kept with the field it left as its other end, with a field within 80 km unless it was seen landing there, or with no other end at all (FR24 shows that flight itself).
  - A jet lost at cruise or climbing away no longer gets a "private site" under where it was lost as its destination.
- FR24's "Remove ads" button, and the empty slot it sat in, stayed in the airport boards' lists. They are now removed as FR24 adds them, so the rows close up, on the boards' own pages too.
- An aircraft FR24 names itself was taken over as a blocked one when its transponder sent no callsign (G-EZWZ, an easyJet on the stand at Liverpool). A flight is now only treated as blocked when FR24 has neither a callsign nor a registration for it, as the monitor already did. One taken over before is let go and shown as FR24 shows it.
- The monitor now keeps each flight's end height, how it ended and the rules it was built with (`endAlt`, `how`, `endRules`), so browsers can tell its new flights from the ones it kept before this version.
- Tests: `unit_tracks` failed when it ran in the hour or so after midnight UTC.

## [B22.23.0] - 2026-10-14

Playback names blocked flights the moment they are shown, and the monitor keeps 90 days of tracks and learns from them.

### Added
- **The monitor keeps every blocked aircraft's track for 90 days** (`trackDays`), thinned to a point a minute in the air and one every five minutes on the ground, in `tracks/YYYY-MM-DD.json.gz`. That covers the 7 days of FR24's default playback many times over.
- **Instant playback names (`POST /pbmatch`).** The browser sends the moment and the unnamed flights it is showing in one request, and the monitor names each one from the names it gave live, or from where each blocked aircraft was heard at that moment. It names a flight from a track only when one aircraft of a fitting type alone fits it. The flight's route comes back with it, so the panel fills at once. A monitor without it falls back to `/names`.
- **Learning over 90 days (`GET /learned`).** The monitor learns the destination engine's tables from its last 90 days of learning rows (`learnDays`) and sends them as one snapshot. The browser keeps it and applies it on the next page load, then learns only the rows the snapshot does not cover.

### Changed
- **The live LADD list stays fresh while days are rebuilt.** The rebuild workers wait while adsb.lol is paused or the LADD list is more than three polls old (`backfillWaits` in `/status`).
- **Estimated airspeeds are marked.** Figures the monitor works out from the weather model show as "≈ 460 kts" in the panel, with a tooltip saying where they came from. An aircraft's own figures show as before.
- **A monitor of your own, in the extension.** Any https address now works: setting one in *Sources* opens a page where the browser asks you to allow it, once.
- A public monitor takes at most 4 new places to poll (`/area`) and 300 new aircraft to follow (`/seed`) an hour from any one address other than the owner's (`areaPerHour`, `seedPerHour`).

### Fixed
- **Releases publish themselves.** Once every test passes on `main` with a version not yet released, `v<version>` is published with the extension and the userscript attached, so the README's *Download the extension* button always gets the newest tested build.
- The extension's health warnings (FR24 refusing the unlocked fields, a changed data format, an unrecognised live feed) never appeared: the script could not read the page part's counters from the extension's own world.
- The browser sent the monitor's own airspeed figures, estimates included, back to it as its own poll, where they were kept without their mark.
- Tests: `unit_public`'s rate check failed when it ran across a minute's turn. `unit_extension` now runs in CI.

## [B22.22.1] - 2026-10-14

### Added
- **Airspeeds, Mach, wind and temperature over the US and the oceans.** Public ADS-B has them only where radars ask aircraft for them (Mode S EHS: Europe), so over the US those fields stayed "N/A" (JCO55 over South Dakota). The monitor now works them out (`monitor/wx.cjs`):
  - wind and temperature at the aircraft's height come from NOAA's GFS weather model, via Open-Meteo (CC BY 4.0), for 5-degree cells where such aircraft fly, refreshed every 12 hours;
  - true airspeed is the ground speed less the wind, then Mach, indicated airspeed, wind and temperature follow from it.
  - These are estimates, typically within about 10 kt and 2 °C. An aircraft's own figures always win.
  - The weather requests keep under Open-Meteo's free limits a minute, an hour and a day (450, 4,000 and 7,000 weighted calls; 20 cells a request), so a busy moment no longer earns a refusal and an hour's pause. A cell answered without usable levels is let go for an hour instead of being asked for again at once. Tested in `unit_wx`.
- The browser keeps the monitor's airspeed figures for two minutes when its own newer poll has none, instead of blanking them every other poll.

## [B22.22.0] - 2026-10-14

Every copy now shares one monitor, padlocks are gone, and airport boards no longer invent flights.

### Added
- **Every copy connects to the shared monitor by default.** It needs no setup and no secret. The strip's *Sources* menu can point it at your own monitor, or turn it off.
  - A monitor is public unless set otherwise (`"public": false` or `MON_PUBLIC=0`). Reading needs no secret; the owner's secret opens the dashboard's numbers and the full answers. Each address gets 300 requests a minute; the owner is never limited.
  - Reports from strangers are checked before they are used:
    - A name is taken from one browser only when the monitor's own ADS-B data puts that aircraft where FR24 draws the flight. If its own data says otherwise, the name is refused however many browsers send it. Otherwise two browsers must agree.
    - Owners need two browsers sending the very same findings.
    - A stranger's FR24 positions never overwrite the monitor's own scan.
  - The shared monitor names an owner only when the register shows an organisation. Private individuals' names and towns are withheld.
  - The flights it logs are offered under the ODbL (`/export/legs?day=`).
- **No padlocks.** Every padlock FR24 draws for a free account is cleared, on any aircraft: vertical speed, GPS altitude, airspeeds, Mach, wind, temperature, squawk and airspace.
  - The values come from public ADS-B. The monitor keeps the newest report of every aircraft it hears (`monitor/tel.cjs`, `/tel`, and full figures in `/near`).
  - An aircraft clicked is asked of the monitor and of the browser's own source at once, and the first answer is drawn.
  - With no public report, the vertical speed is worked out from FR24's own altitudes (seeded from the panel's trail), and the airspace from the FIR/UIR boundaries. Nothing is made up: a vertical speed nothing tells yet stays FR24's own for a flight's first seconds.
  - On FR24's flight-history pages (`/data/aircraft/…` and now `/data/flights/…`), the playback panel's padlocked figures and serial number are filled in. The padlocked **KML** and **CSV** buttons become working downloads of the flight's public ADS-B track (adsb.lol / airplanes.live, ODbL), in FR24's own CSV columns.
- **Shared polling (50/50).**
  - The map's view is polled from the monitor every other time, halving each browser's own requests to adsb.lol and adsb.fi.
  - What a browser's own polls found goes back to the monitor every 30 s and serves every other browser. Rows are checked: physical values only, fresh, never over the monitor's own report of the last minute, never far from where the monitor heard the aircraft.
  - The monitor's own area polls alternate between adsb.lol and adsb.fi, and it follows 8 of the places browsers look at (was 3).
- **Names found in playback are kept for good.** A browser that names an FR24 flight in playback reports it. The monitor keeps it with the day of the flight (`names/YYYY-MM-DD.jsonl`), and any later playback of it, by anyone, is named from the archive at once. It is taken from one browser when the monitor's own log has the aircraft in the air then, otherwise from two.
- **A standby monitor**, ready for one: the browser uses the first shared monitor that answers, and moves to the next when it stops answering.
- Dashboard rows for public mode, names from browsers, the names archive and the figures held.
- Tests: `unit_boards`, `unit_padlocks`, `unit_public`, `unit_vectoring`.

### Changed
- A monitor that stops answering is looked at again after 30 s, not 5 minutes.
- Browsers send FR24's feed headers (its device id for that browser) only to a monitor of their own, never to the shared one.
- A public monitor's dashboard keeps request paths without their query, so where a map was and which aircraft was opened are not kept against an address. Reporters' addresses are kept in memory for 30 minutes (live names) or 6 hours (playback names, owners) at most.
- `deploy.sh` limits the server's system log, including the web server's access log, to 14 days.
- [PRIVACY.md](PRIVACY.md), [docs/legal.md](docs/legal.md), [LICENSE](LICENSE) §2(b) and [docs/monitor.md](docs/monitor.md) describe the shared monitor.
- **The GitHub page:** a new download-style README with light and dark graphics in FR24's own charcoal and blue, a GitHub Pages site (`site/`, `.github/workflows/pages.yml`) and new extension icons.

### Fixed
- **False "Liverpool → Liverpool, landed" flights on airport boards.** EI-EVN, as RYR8SF at 17:33, an hour before it left for Szczecin, was one of many. FR24's own flights with an origin but no destination yet sat through a long taxi. On the take-off roll FR24's ground flag flickered: "airborne" at 110 kt, then "on the ground" again. The take-off time had been taken from the second report of the taxi, so the roll passed for an approach to the field being left and the flicker for a landing there. The same-field check then let it through because its take-off time was 0. Now:
  - a flight is routed only once it has been seen flying, at least two reports off the ground at flying speed;
  - its take-off is the first of them;
  - an approach or a landing must come in from further out;
  - a flight back where it began needs a seen take-off and a real flight: up long enough, high enough, far enough (`ENGINE.localFlew`; light aircraft, helicopters and fast jets can fly real circuits);
  - rows an older version kept of such flights are removed when the board is read;
  - the monitor's own boards apply the same rule.
- **"Possible destination: RAF Valley" while N99GY was being vectored for Dublin.** The alternatives' odds were scaled up when the shown odds of the destination were capped, which turned a hundredth of a percent into 10%. That scaling is now capped, alternatives under 2% are never offered, and a destination held at 90% or more on the way down is kept while the aircraft is vectored round for its runway.
- The monitor's check of a browser's name used a list of aircraft up to 10 s old, so an aircraft heard in between was not checked at all. Each name is now checked against the aircraft as heard at that moment.
- Owner findings waiting for a second browser were never let go. They are now dropped after 6 hours.

## [B22.21.0] - 2026-10-14

### Added
- **A permanent log of every blocked aircraft's departures and arrivals.**
  - Flights are kept on disk for good. A day's file is only ever added to, and the last 90 days are also held in memory.
  - Airport boards for any range of days, anywhere in the world, read older days from disk.
  - Flights that only FR24 sees, with no public ADS-B receiver hearing them, are logged from FR24's own track. FR24's trail is fetched as the aircraft lands. An ADS-B record of the same flight replaces the FR24 one when it comes.
  - Every blocked aircraft's completed flights feed the browsers' destination engine as learning rows (`/learn`).
- **Owners and operators looked up once, on the server** (`monitor/owners.cjs`).
  - Sources: hexdb, adsbdb and each aircraft's own register (FAA, UK G-INFO, Isle of Man, Swiss FOCA). The aircraft flying now are looked up first, gently.
  - Results are kept for good and refreshed after 60 days.
  - Browsers ask the monitor before any register (`/owners`). What a browser finds itself, including FR24's operator, goes back with its next report.
  - The names table carries each aircraft's owner and operator.
- `src/registry.js`: the register code, shared verbatim by the userscript and the monitor.
- **The map's airport panel, filled in:**
  - *Movements per day*: FR24's own schedule counted by local day, plus the blocked flights it does not show.
  - *Runway usage*: the runways the tracked flights used, worked out from each take-off and landing's track.
  - *Airport & runway details*: every runway in full (width, lighting, each end's heading, elevation and displaced threshold) and the airport's radio frequencies.
  - The *Latest events* part and the plea to help FR24's ground coverage are taken out.
- **Runway data:** `monitor/mkdata.cjs` builds `runway_info.json` (9,446 runways at 6,352 of FR24's 6,944 airports) and `freqs.json` (5,138 airports) from OurAirports, and refreshes `runways.json` / `runway_len.json`.
- Monitor endpoints `/owners` and `/airport`. Dashboard rows for owners and for flights logged from FR24 only.
- Tests: `unit_store`, `unit_registry`, `unit_panel`.

### Changed
- Every take-off and landing in the log records the runway used.

### Fixed
- **The LADD tag is always shown on an LADD aircraft.** A record made from a source without adsb.lol's database flags said "not LADD". It overrode the flag known from elsewhere when the tag was drawn, and overwrote it when saved: OK-VOS, a Gulfstream G600 on the LADD list, showed "ADS-B". Now:
  - LADD, PIA and military flags are sticky;
  - they are learned from every answer that carries them;
  - an aircraft named before its flag was known gets it at once, in the browser and in the monitor's names.
- OurAirports rows with commas inside quoted fields (10 runways) were split wrongly by the engine's CSV reader.

## [B22.20.0] - 2026-10-14

The monitor names every blocked flight FR24 draws, anywhere in the world, and hands every name to a browser the moment FR24 opens.

### Added
- **FR24 world scan on the server** (`monitor/fr24.cjs`): FR24's whole map every two minutes, with a back-off when FR24 refuses.
- **Naming on the server** (`monitor/ident.cjs`). Every flight FR24 draws without a callsign or registration is matched against public ADS-B: the lists, address lookups, targeted area lookups, dead reckoning, FR24's trail and parked aircraft. Names are withdrawn on disagreement.
- **Rough destinations on the server** (`monitor/dest.cjs`): every named airborne flight, with an estimated arrival, using the same engine and learned weights as the browser.
- `/fr24ids`: the whole names table on connect, then every 20 s what changed (new names, moved positions, withdrawn names). The browser hands names straight to the page, so FR24's first frame of any of those flights is drawn named.
- `POST /report`: browsers pass on FR24's feed headers, the callsign-less flights they see, and the names they found themselves.
- **Browser extension** for Chrome and Edge (Manifest V3), built from the same script into `dist/extension/` and a zip.

### Changed
- Faster public ADS-B:
  - the LADD list every 10 s and the military list every 30 s;
  - recently heard blocked aircraft by address every 30 s (the rest every 10 minutes);
  - browsers take the live list's changes every 5 s.
- The browser's own world scan runs only while the monitor's FR24 scan is not working.

### Removed
- The local `127.0.0.1` monitor: the userscript uses the shared monitor only (no `@connect 127.0.0.1` / `localhost`).

## [B22.19.1] - 2026-10-14

### Added
- **Backup data sources for the monitor**, each used only when the one before it fails:
  - adsb.fi's military list and area query while adsb.lol rate-limits;
  - ADS-B Exchange, with the user's own key only and at most 150 requests a day;
  - an OpenSky Network world snapshot, keeping the blocked aircraft in it, while adsb.lol's LADD list has been silent for 3 minutes (at most every 15 minutes).
- Dashboard rows for the backups.

### Changed
- Area queries to adsb.fi use its current `v3` endpoint, falling back to the deprecated `v2` one.

## [B22.19.0] - 2026-10-14

The monitor becomes the primary worldwide identifier and the source of flight history.

### Added
- Monitor polls adsb.lol's worldwide **military** and **PIA** lists, as well as the LADD list.
- `/live`: every LADD, military, PIA and blocked aircraft heard in the last 5 minutes, with each list's age.
- `/hist`: each blocked aircraft's finished days, rebuilt from adsb.lol's full day traces in the userscript's own log format. Days watched without a gap and not heard flying are reported as having no flights.
- Hard cap of 20 adsb.lol API requests a minute.
- `monitor/deploy.sh`: update, verify and automatic rollback on the server.
- `monitor/vm-setup.sh`: run the service from a git checkout, with compressed HTTPS.
- `monitor/merge-store.cjs`: merge another monitor's flights and blocked aircraft without duplicates.
- Dashboard: list ages, request rate, live list size, day-log progress.

### Changed
- With a shared monitor configured, the userscript never asks a monitor on `127.0.0.1`.
- The userscript takes the monitor's live list (every 20 s, in idle slices) instead of polling the LADD and military lists itself. It falls back to its own requests when the monitor is down or stale.
- Flight logs of blocked aircraft take the monitor's days first, asked for in batches. Only the remaining days are fetched from adsb.lol.

### Fixed
- The monitor saves its state on `SIGTERM`. Previously a `systemctl restart` could lose up to 2 minutes of data.
- An aircraft that leaves the LADD programme moves to address lookups instead of going unwatched.

## [B22.18.3] - 2026-10-13
### Added
- Shared monitor on a server: an HTTPS address and a secret in the strip's *sources* pop-over.
- Monitor secret (`X-Monitor-Token`) and per-client rate limit.
- `/dash` dashboard and `/stats`.

## [B22.17.0] - 2026-10-11
### Added
- Free runway data on airport pages.
- Search results for blocked aircraft and their callsigns.
- Movements tables.
- Naming of private landing sites from OpenStreetMap.

### Fixed
- Tables built by the script were hidden by FR24's stylesheet on old data pages.

## [B22.16.0] - 2026-10-10
### Added
- Airport data pages: boards, statistics and routes include blocked flights.
- Playback telemetry synchronised to FR24's frame time.
- Flight-number pages answered from the monitor.

### Changed
- Learned private landing sites are never drawn as map pins (22.16.2).
- No data-source credit on the strip (22.16.1).

## [B22.15.0] - 2026-10-10
### Added
- Identification in FR24's map **playback**, from adsb.lol's heatmaps.
- Logos for operators FR24 lacks.
- Learned landing places on boards.

### Changed
- Playback links go to airplanes.live's globe.

## [B22.14.0] - 2026-10-08
### Added
- **Ocean identification**: FR24's trail laid against adsb.lol traces and heatmaps (22.14.2–22.14.3).
- Identification of parked aircraft from the monitor's `/parked` (22.14.4).
- Approach-path table v3 (99.85% right on held-out jets).
- Swiss register.

## [B22.13.0] - 2026-10-07
### Added
- **Permanent monitor** (`monitor/monitor.cjs`): adsb.lol polling, flights per day, `/board`, `/legs`, `/last`.
- Airport boards merged into one ±3-day list.
- Links strip for N/A flights.

## [B22.12.0] - 2026-10-02
### Added
- Split flights rejoined.
- Trustee owners replaced by operators.
- 90-day log rows and airport-board archive.
- Learned arrival paths (22.12.2).

## [B22.10.0] - 2026-10-01
### Changed
- Route engine retrained on 63 days of worldwide traffic. Accuracy on held-out aircraft rose from 60.4% to 67.6%; for LADD aircraft from 52.2% to 56.3%.

### Added
- Weather and NOTAM evidence.
- Odds calibration.

## [B22.9.0] - 2026-09-27
### Added
- Advertisements and the advert sidebar removed seamlessly.

## [B22.8.0] - 2026-09-25
### Added
- Destination prediction for every N/A flight (military, private, GA, helicopters), with private landing sites.

Earlier versions: see [docs/maintainers/notes](docs/maintainers/notes/).
