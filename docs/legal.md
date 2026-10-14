# Legal notes

This document sets out why the FR24 LADD Unblocker is built to be lawful to use, and where the limits are. It covers:

- the radio broadcasts it relies on;
- the data licences;
- privacy;
- Flightradar24's rights, and what Flightradar24 can and cannot do about the project.

> **Not legal advice.** This is the author's analysis of a personal project, written to explain its design choices. Laws differ between countries and change. If your situation matters (commercial use, publishing the data, a letter from someone's lawyer), ask a lawyer qualified where you live.

- [1. What the project actually does](#1-what-the-project-actually-does)
- [2. ADS-B is a public broadcast](#2-ads-b-is-a-public-broadcast)
- [3. What LADD is, and what it is not](#3-what-ladd-is-and-what-it-is-not)
- [4. The data and its licences](#4-the-data-and-its-licences)
- [5. Personal data](#5-personal-data)
- [6. Flightradar24](#6-flightradar24)
- [7. What Flightradar24 can and cannot do](#7-what-flightradar24-can-and-cannot-do)
- [8. Staying on the right side of the line](#8-staying-on-the-right-side-of-the-line)
- [9. Disclaimer](#9-disclaimer)

---

## 1. What the project actually does

The project's legal position follows from a few facts about how it works:

- **It receives no radio signals.** It operates no receiver. It reads aircraft positions that community networks (adsb.lol, adsb.fi, OpenSky, airplanes.live) have already received and **published openly**, under their own published terms.
- **It changes only what the user's own browser shows.** The extension or userscript runs in the user's own browser, on pages the user has chosen to open. It adds information from other public sources to what Flightradar24 sends that browser. It decrypts nothing, logs into nothing, and uses no paid account.
- **It does not redistribute.** The optional monitor serves only its owner's own browsers, behind a secret. Nothing is published or sold.
- **It does not pretend to be anyone.** The project uses no Flightradar24 logos, claims no affiliation and does not present itself as Flightradar24.

## 2. ADS-B is a public broadcast

Aircraft equipped with ADS-B Out broadcast their identity (24-bit ICAO address and often callsign), position, altitude and velocity about twice a second. The broadcast is unencrypted, on 1090 MHz, to anyone in range. It exists precisely so that it can be received by anyone: air traffic control, other aircraft, and ground stations.

The broadcast is **required by law**, not volunteered:

- in the United States, by **14 CFR §91.225**, with performance requirements in **§91.227**, for most controlled airspace since 1 January 2020;
- in Europe, by **Commission Implementing Regulation (EU) No 1207/2011**;
- in the United Kingdom, by the retained version of that regulation.

Receiving these broadcasts is lawful in most countries, and tens of thousands of hobbyists do so, many of them feeding Flightradar24 itself. Some countries regulate who may *receive* radio messages. The United Kingdom's **Wireless Telegraphy Act 2006, s.48** is the usual example. Such rules are aimed at the person operating a receiver, and **this project operates none**. It uses data that others received and chose to publish.

## 3. What LADD is, and what it is not

The FAA's **Limiting Aircraft Data Displayed (LADD)** programme lets an aircraft owner ask that their aircraft's data be withheld. The point that matters is *whose* data it limits. LADD governs the flight data the **FAA itself distributes** to industry, through its data feeds, to companies that have agreed to the FAA's terms for receiving that data. A company that takes the FAA's data must honour the LADD list for **that** data.

LADD is therefore an **agreement about a data feed, not a law about the sky**:

- It does not make an aircraft's own ADS-B broadcast secret, and cannot. The broadcast is required by §91.225 and is unencrypted.
- It binds those who receive the FAA's data under the FAA's terms. It does not bind a person who receives no FAA data at all, or a network that hears the aircraft on its own receivers.
- The FAA recognises the gap. That is why it created a separate **Privacy ICAO Address (PIA)** programme: temporary addresses not linked to the owner in the public register. The FAA itself presents PIA as the way to limit identification from the broadcast, which LADD alone does not do.

Flightradar24 hides LADD aircraft because it takes FAA data and has its own arrangements. That is a business decision binding Flightradar24. It is not a legal status of the aircraft that binds everyone else. The community networks this project uses mark LADD aircraft with a flag (that is how the project shows the yellow **LADD** tag) and still publish their positions, under their own terms.

## 4. The data and its licences

Every source is used within its published terms. The details and limits are in [data-sources.md](data-sources.md).

- **adsb.lol** publishes under the **Open Database License (ODbL) 1.0**. The project credits it wherever its data is shown, as the ODbL requires. The ODbL's share-alike clause (§4.4) applies when a derivative database is *publicly used*. The monitor's store is used only by its owner's own browsers, behind a secret, so it is not publicly used. **If you ever make a monitor public, you must offer its derived data under the ODbL.**
- **adsb.fi, OpenSky Network and airplanes.live** are used within their open or non-commercial terms. Their published rate limits are respected. Approval-gated APIs (airplanes.live's REST API) are not used, and a refusal pauses the source rather than being worked around.
- **ADS-B Exchange** is used only through its official API with the **user's own** key, within that key's terms. Its website is never scraped.
- **OurAirports** is public domain. **OpenStreetMap** is ODbL and credited.
- **Aircraft registers** (the FAA Aircraft Registry, the UK CAA's G-INFO, the Isle of Man register, the Swiss register) are public registers, published so that anyone can look up who owns an aircraft. **hexdb.io** and **adsbdb.com** are free public lookups.
- **Photographs** belong to their photographers. They are shown with credit, from JetPhotos (through Flightradar24's own API, as Flightradar24 shows them) and Planespotters (through its public API).

## 5. Personal data

Aircraft owned by individuals bring personal data into play. In the UK and EU that means the (UK) GDPR. The project is designed accordingly:

- **Names only, never addresses.** Registers are read for the owner's name. Street addresses are never fetched, stored or shown. The FAA owner's city and state are kept, as the registry publishes them.
- **Personal use.** A person using the project for their own interest is within the GDPR's **household exemption (Article 2(2)(c))**: processing "by a natural person in the course of a purely personal or household activity".
- **No publication.** Nothing is published. The monitor answers only browsers holding its secret.
- **No telemetry.** The project collects nothing about its user. See [PRIVACY.md](../PRIVACY.md).

The household exemption ends where personal use ends. **Publishing** owners' names, running a public service, or using the data to follow or contact a person are different activities with different obligations. Don't do them with this project (section 8).

## 6. Flightradar24

Flightradar24 AB is a Swedish company. Its rights over what the project touches fall under a few headings. None of them gives it control over public broadcasts, or over what a user's own browser does with a page.

### 6.1 Facts are not owned

Aircraft positions, times, routes and runway lengths are **facts**. Copyright protects expression, not facts. In the United States that is settled by ***Feist Publications v. Rural Telephone Service*, 499 U.S. 340 (1991)**, and the UK and EU reach the same result by requiring originality. The project copies none of Flightradar24's expression: its code, design, text or images. The yellow LADD tag, the tables and the texts are the project's own.

### 6.2 Database right

Under EU and UK law a database maker has a *sui generis* right against extraction or re-use of a **substantial part** of its database. It also covers **repeated and systematic** extraction of small parts that conflicts with the database's normal exploitation (**Directive 96/9/EC, Article 7(1) and 7(5)**; in the UK, the **Copyright and Rights in Databases Regulations 1997**).

- **The browser extension and userscript** read what Flightradar24 sends to the user's own browser for display. That is the database's normal, intended use, and nothing is extracted from it to build anything else. The aircraft the project names are the ones Flightradar24's database **leaves blank**. Their identities come from other databases.
- **The monitor's optional FR24 scan** is the part to weigh. It reads the positions Flightradar24 draws for the callsign-less flights, to name them from public ADS-B. It keeps them only for the life of each flight, and serves them only to its owner's own browsers. The Court of Justice has held that the right exists to protect the maker's **investment**: there is an infringement only where the use risks it, for example by building a substitute for the maker's own service (***CV-Online Latvia v Melons*, C-762/19, 3 June 2021**). A tool that makes its user *use Flightradar24 more* is not a substitute for it.
- The scan is still the part that relies most on that argument. It can be switched off (`"fr24Scan": false` in `monitor.json`), and the project is designed to work without it.

### 6.3 No access control is bypassed

Laws on unauthorised access to computers, and on breaking technical protection, are aimed at getting **in** where you are not allowed:

- **No login, no paywall, no credentials.** The project uses Flightradar24's public pages and the same unauthenticated requests any visitor's browser makes. In the United States, ***Van Buren v. United States*, 593 U.S. 374 (2021)** limits the Computer Fraud and Abuse Act to entering areas one is not entitled to enter. ***hiQ Labs v. LinkedIn*, 31 F.4th 1180 (9th Cir. 2022)** applied that to publicly available web data.
- **Nothing is decrypted or circumvented.** Anti-circumvention rules (**17 U.S.C. §1201**; **Directive 2001/29/EC, Article 6**) protect *effective technological measures*. Where Flightradar24 sends something to every visitor's browser in plain form and simply does not draw it, drawing it circumvents no technological measure. The padlocked fields of a blocked aircraft are not unlocked from Flightradar24 at all: Flightradar24 never sends them. They are filled from other public sources.

UK law (**Computer Misuse Act 1990, s.1**) turns on whether access is *unauthorised*. Ordinary use of a public website is authorised. An **explicit** withdrawal of permission (a block, or a letter) changes that. This is why section 8 says what to do if one ever arrives.

### 6.4 Its terms of use

Websites' terms of use are a contract with the user. They are enforceable against a user who has actually agreed to them. Courts are cautious about "browsewrap" terms a visitor never saw or accepted: ***Specht v. Netscape*, 306 F.3d 17 (2d Cir. 2002)**; ***Nguyen v. Barnes & Noble*, 763 F.3d 1171 (9th Cir. 2014)**. In the EU, a site may restrict the use of a database by contract even where no database right applies (***Ryanair v PR Aviation*, C-30/14, 2015**). Even then, a breach of terms gives a contractual remedy, typically **ending the service to that user**. It is not a right to control what a person's own browser displays.

### 6.5 Changing a page in your own browser

How a page is shown on a user's own screen is the user's choice. That is the principle behind ad blockers, reader modes, user stylesheets, translation and accessibility tools. Germany's Federal Court of Justice upheld it against a publisher in the leading ad-blocker case (**BGH, 19 April 2018, I ZR 154/16, *Werbeblocker II***): the user decides what their browser shows, and a tool that helps them is not an unlawful obstruction of the publisher. This project removes advertisements and adds information, in the same way, only in the browser of the user who installed it.

### 6.6 Its name

"Flightradar24" is used only **descriptively**: to say which website the tool works with. That is nominative or descriptive use, permitted under trademark law. The project uses none of Flightradar24's logos or get-up for itself, and states plainly that it is not affiliated with or endorsed by Flightradar24 AB ([NOTICE.md](../NOTICE.md)).

## 7. What Flightradar24 can and cannot do

**It cannot:**

- make ADS-B broadcasts private, or claim ownership of what aircraft transmit;
- control the community networks, which receive and publish independently, under their own licences;
- extend LADD to people who take no FAA data;
- control what a user's own browser displays, or stop a user installing an extension;
- claim copyright in aircraft positions, routes, runway lengths or registry facts.

**It can:**

- **change its website.** The project may stop working until it is adapted, which is a technical matter, not a legal one;
- **refuse requests** from an address, such as a monitor's server. The monitor backs off on any refusal, and the browsers carry on without its scan;
- **end its service** to an account under its own terms.

None of these reaches the user's own browser, the public broadcasts, or the open data the project is built on.

## 8. Staying on the right side of the line

The project's design keeps its use personal, gentle and transparent. Users should keep it that way:

- **Use it for personal interest.** Don't use it to track, follow, locate or harass a person, or to publish where a particular private individual is or goes.
- **Don't republish.** Don't run a public monitor or publish its data. Doing so would bring in the ODbL's share-alike terms and data-protection duties that personal use does not.
- **Respect refusals.** If any source, Flightradar24 included, explicitly withdraws permission (a block, a notice or a letter), stop using it in the way objected to. For Flightradar24's server-side scan, that means `"fr24Scan": false`. The project's back-off on refusals exists for this reason.
- **Keep keys your own.** Use only API keys issued to you, within their terms.

## 9. Disclaimer

The software is provided "as is", without warranty of any kind. Predicted destinations are predictions: they are shown with a probability and are sometimes wrong. Identifications can be wrong. Don't use the project for navigation, safety, security or any decision with consequences. The author is not liable for any use of the software or of the data it shows.

Not affiliated with, endorsed by or connected to Flightradar24 AB, the FAA, or any data provider named in this repository. All trademarks belong to their owners.
