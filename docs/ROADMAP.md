# Roadmap

Each ticket should take one or two days. These rules apply to every phase: static site only, no accounts, no tracking, everything stays in the browser, and nothing ranks or describes areas by schools, safety, demographics or "desirability."

## Phase 1: Map of Weber and Davis County

### 1.1 Add MapLibre base map
Load MapLibre GL JS from a CDN with a free, keyless tile source (for example OpenFreeMap) and show a map section centered on Weber and Davis County.
- [ ] The map renders on desktop and mobile with no API key.
- [ ] Tile attribution is visible.
- [ ] If tiles fail to load, the rest of the page still works and the map shows a short message.
- [ ] The map can be panned and zoomed with the keyboard.

### 1.2 City and county boundaries
Add a GeoJSON layer of city boundaries in both counties, using public data from the Utah Geospatial Resource Center (UGRC).
- [ ] Boundaries draw as outlines with names, all in one neutral style.
- [ ] The source and license are noted in the README.
- [ ] The file is simplified to 300 KB or less.

### 1.3 Per-city property tax defaults
When someone selects a city, set the property-tax assumption to that area's published rate.
- [ ] Rates come from county or state published tax-rate tables, with the source and year noted.
- [ ] Selecting a city updates the tax rate and every result.
- [ ] The user can still override the rate by hand.

### 1.4 Price-to-budget shading
Shade each city by how its typical list price compares with the user's current budget tier: within comfortable, stretch, or above.
- [ ] Shading uses only price data compared with the user's own budget. There is no ranking, score or descriptive label.
- [ ] The price data source and date are shown.
- [ ] The legend uses text as well as color.

### 1.5 Fair-housing guardrail check
Add a test that scans the source for banned descriptors (school ratings, crime, safety, demographics, "desirable," "good neighborhood") and fails if any appear.
- [ ] `node --test` includes the guardrail test.
- [ ] CONTRIBUTING.md documents the rule.

## Phase 2: Guided "simulate buying" walkthrough

### 2.1 Step-by-step shell
Turn the page into a five-step walkthrough (budget, pre-approval, house hunting, offer, closing) with progress shown.
- [ ] The back and next buttons work, and focus moves to each step's heading.
- [ ] Progress is kept in `localStorage`.

### 2.2 Cash-to-close calculator
Itemize the cash needed to close: earnest money, appraisal, inspection, lender fees, title and prepaids.
- [ ] Each line can be edited and has a Utah-typical default.
- [ ] A warning appears when the cash needed is more than savings.

### 2.3 Offer simulator
Show how the payment and cash needed change if the user offers above or below list price or asks for seller concessions.
- [ ] Results update live and are covered by unit tests.

### 2.4 Glossary tooltips
Add plain-language definitions for PMI, MIP, escrow, DTI, LTV and other terms.
- [ ] The tooltips work on hover, focus and tap.

## Phase 3: Live rate feed

### 3.1 Scheduled rate snapshot
Add a GitHub Action that fetches the weekly MORTGAGE30US and MORTGAGE15US series from FRED and commits them to `data/rates.json`.
- [ ] The FRED key is stored in repository secrets and never reaches the client.
- [ ] The workflow runs weekly and can also be started by hand.

### 3.2 Use the snapshot in the app
Load `data/rates.json` for the default rate and its "as of" date.
- [ ] The app falls back to the hardcoded default if the file is missing.
- [ ] The label shows the actual date of the data.

### 3.3 Rate history sparkline
Show a small 52-week rate chart next to the rate slider.
- [ ] The chart has a text alternative.

## Phase 4: Scenario comparison and export

### 4.1 Save scenarios
Let the user name and save up to five scenarios in `localStorage`.
- [ ] Scenarios can be saved, renamed and deleted.

### 4.2 Compare side by side
Show a table and chart comparing two or three scenarios.
- [ ] Differences are highlighted.
- [ ] The table works on mobile, stacked or scrolling inside its own area.

### 4.3 PDF and print export
Add a print stylesheet and an "Export PDF" button that uses the browser's print dialog.
- [ ] The output is a clean one- or two-page summary that includes the disclaimer and the rate date.

### 4.4 Shareable link
Encode a scenario in the URL hash. Nothing is sent to a server.
- [ ] Opening the link restores the scenario.
- [ ] The UI warns that the link contains the user's numbers.
