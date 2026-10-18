# Working on Kwick Weather

Kwick Weather (short name Kwick, formerly Isobar) is Victor's weather app: a vanilla JS PWA, no build step. This file
carries the way of working from session to session and machine to machine; read it, and `RULES.md`, before changing
anything. **Keep this file up to date: whenever you push, first update it with anything new that a next session must
know (decisions, preferences, open choices), and push it along.**

## Where things are

- Live: https://victorvansande.github.io/kwick/ (GitHub Pages, deployed from `main`, root). Repo: victorvansande/kwick
  (renamed from `isobar` on 2026-10-14; the old /isobar/ address no longer exists).
- Files: `app.js` (one IIFE, `renderAll` draws every card), `styles.css`, `index.html`, `palette.js` (every colour),
  `sw.js` (offline; network-first), `manifest.webmanifest`, `assets/` (icons, launch screens, moon map).
- `RULES.md`: the look and feel and the rules (data, words, layout, type, colour, rendering). A reference, not a law
  book: breaking a rule is fine when clearly better, and then the rule is updated. `tests/lint.mjs` checks the
  checkable ones; `tests/smoke.mjs` runs the app in Chromium and WebKit on every push (`.github/workflows/publish.yml`).
- Local preview on Windows: `powershell -ExecutionPolicy Bypass -File serve.ps1`, then http://localhost:5577.
- Internal names that keep "isobar" on purpose: the `isobar:` localStorage keys (renaming them would wipe everyone's
  saved places and settings), the service-worker cache key, the font name "Isobar Digits".

## How Victor likes to work

- **Language:** reply in Dutch, unless Victor writes in English; then English.
- **Design choices as pictures:** for any choice with several directions (a card, chart, icon, animation, layout),
  show 2–4 small visual mockups in the chat to pick from, with one recommendation, before building.
- **Commit after every change; push only when Victor says so** (to save tokens). In each reply, say what is still
  unpushed. A push to `main` goes live after the checks pass.
- **Check every change in the preview** (keep it open and scroll to the changed card), at phone width too (393 px and
  320 px), by day and at night, including the sheets that show the same thing.
- **Correct and scientific:** one source per quantity, cards never contradict each other, only measured data or
  published formulas, and say plainly when something isn't known or isn't forecast.
- **Calm and clean:** subtle, slow animations caused by data; no glow, no clutter; nothing cut off or broken mid-
  phrase; one line per title and subtitle.
- Be honest about what was and wasn't verified, especially on a phone (the preview runs Chrome, not Safari).

## State and open choices (2026-10-15)

- Radar: in and around the Benelux, Buienradar for the whole timeline (2 h measured + 2 h forecast, one source so
  nothing jumps at "now"); elsewhere RainViewer, past 2 h. RainViewer can show night-time ghost echoes; ignoring its
  weakest echoes outside the Benelux was offered, not decided.
- The summary line adds at most one short heads-up (slippery roads, fog, heat, strong sun, deep cold, poor air).
- Sun and moon cards: a calm sky wash (no dark core, no glowing corners), still the two that stand out. Sun times in
  day order on three columns, AM/PM and units small after the number, six times in the grid (fills one row on desktop); one line at the bottom: "Sunshine 8 h 55 min" left,
  "Day −3 min 48 s" (change in day length vs yesterday) right. Moon: the percentage on the tiles' left edge; dates on one line ("Full · Mon" / "26 Oct").
- Day bars (14 days, day look): soft wide translucent capsules, highs in plain ink.
- Larger screens (rule 10a): from 601 px each card scales its readings and pictures by its own width over a phone
  card's 180 px (--k, 1 to 1.35); three columns between 761 and 1000 px. Phones must stay exactly as they are.
- Tall cards: the rain chart sits on its foot, the feels-like scale and UV gauge sit centred between reading and foot.
- Wall view: measures after layout and grows taller (scaling smaller) until no card's content is cut off.
- Feels like: the thermometer mark ("Actual: 19°") always in the middle of the scale, only the red needle moves, with
  the feels-like value above it; one dot per degree, 2–3° per dot when the gap is over 11°.
- Temperatures centred on a point are centred on their digits, the degree sign hanging after (rule 14b, degMid).
- Air quality: in a tall card the scale and foot sit at the bottom.
- Scrolling down never gets caught in a card (rule 12a): vertical wheel always scrolls the page; on touch the map
  moves with two fingers.
- Open, not decided: refreshing the 48-hour card (options: day/night band, temperature-coloured curve, rain bars only
  when it rains, or all three; Victor said "leave it for now"); the night arc drawn below the horizon (audit point);
  hourly wind in the 48-hour strip; morning golden hour on the sun card; METAR-based correction of "now" cloud cover;
  hiding olive pollen north of the Alps.
- Places sheet: a "Current location" row under the search field does the same as the dock's location button
  (closes the sheet, then locates).
- Gauges: the UV numerals' bottom lines up with the gauge's bottom (keep it so); the pressure numerals sit a little
  below the dial's centre and shrink on narrow dials.
- Top bar: hidden fully above the screen (with visibility hidden), so nothing peeks out under iOS's status bar.
- Pushing from a cloud session: commits are backed up to the non-live branch `cloud`; `main` only on Victor's word.
- Empty cards in Chrome (a card showing only its background until tapped; seen on Humidity, 2026-10-18): Chrome
  dropping a layer's pixels under graphics-memory pressure. Fixed on three sides: the cards' light layer has no blur
  any more (no visible difference) and is smaller (inset −12%); its drift stops entirely off screen (`.offscreen.pig::
  before{animation:none}`, restarting 300 px before it scrolls in); and every card is repainted (`.rp`, one frame)
  as it comes into view and when the app returns to the front, plus a redraw when Chrome restores a lost canvas. Not
  reproducible on demand, so watch for it; if it returns, look at the Humidity card's full-card canvas next.
- Loading: the cards draw as soon as the forecast is in; air quality (air and pollen cards keep their skeleton
  meanwhile) and the four-model spread fill in after. Still open: a first-ever visit waits for the location prompt
  (up to 12 s) before it fetches anything.
- Follow me: on launch and after 10+ min away the app checks your location (only once location was allowed; never
  asks by itself) and moves there when >3 km from the place on screen, to a saved place within 3 km if there is one.
  Not verified on an iPhone: iOS may keep asking for location in the home-screen app.
- "Looks AI-made" (a colleague, 2026-10-14): proposed one calm card colour (colour only on main/sun/moon), dot-matrix
  numerals only on the main card and top bar, raspberry only for "now"/warnings, fewer dot motifs, a warmer font
  last. Mockups shown; Victor: not now. Don't redo unasked.
- Feels-like card: its corner accent shows which way it feels (blue-violet colder, deep red warmer, none when the same),
  clear from 1° and growing to 4° (this card's accent counts for more via `--acc-k`; warmer leans further since the
  card is coral). The other cards' accents are still decorative.
- 48-hour and 14-day rain gauges (option B, 2026-10-16): the five dots and the blue number show the AMOUNT, like the
  precipitation card (one dot per 0.1/0.5/1/2/4 mm in an hour, 0.2/1/2/5/10 mm in a day), with drops falling onto the
  stack (a drop every 2–3.2 s, `hdrip`). Where no rain is forecast but it might come, the dots stay empty and still
  and the chance shows in grey (`.pc`). Blue always means "in the forecast"; a chance alone never rains. Why: the
  chance (ensemble) and the amount (main run) disagree at times, and a blue 75% over a dry hour read as rain. An
  hour's rain/snow icon needs ≥0.1 mm too, so icon, gauge and amount agree. Options A (grey chance dots, blue when
  forecast) and C (a word per hour) were shown, not chosen. The precipitation card follows the same rule: in a dry
  spell its chance columns are grey, not faded blue. The (i) sheet opens with "Blue: rain in the forecast", "Grey:
  only a chance" and "Why a high chance can still be grey".
- Hours/days card: an (i) (in the 48 hours at the end of the scroll dots; in the 14 days beside "Full forecast", so a
  strip that fits without scrolling leaves no empty row) opens "Chance and amount" (the shared learn sheet, retitled):
  what the chance means (≥0.1 mm, ensemble share, not area or time), the amount (1 mm = 1 l/m²), why both, dots and drops.
- Main card arc: the arc and its weather bands are clipped at the horizon line (round ends never dip below it).
- Logo (2026-10-16, option R1): a thermometer of dots in a hairline glass, three white dots and two raspberry up the
  tube, a big raspberry bulb, a fine scale (long/short marks) beside the tube, a little left of centre. Drawn once in
  `tools/icons.mjs`, which renders every icon size and the 12 launch screens (`node tools/icons.mjs`).
- Moon: soft terminator (light fades over the last few degrees of sun height), not a hard clip.
- Saved for later, don't build unasked: a Vestaboard-style split-flap text effect (letters cycling until they land).
- Night look: ink-black (`--bg:#0e0f12`) with just a touch of each card's colour, no night-blue cast.
- Precipitation card speaks of snow when most of what falls is snow ("Snow likely from…", "N cm of snow"), white dots,
  slow swaying flakes, the odd twinkle.
- Weather effects (2026-10-15), all data-driven and calm:
  - an orange or red warning in force: a soft glow in its colour round the dock and a dot in the top bar (the one
    glow RULES.md 19 allows: a signal, not decoration);
  - hail (WMO 96/99): white grains bounce on the precipitation stack, subtitle "· hail";
  - fog hours in the 48-hour strip: overlapping soft drifting puffs (not a band);
  - storm (gusts ≥ 75 km/h): every card's slow light drifts at 16 s instead of 34 s;
  - thunder sky: a muted plum corner (not the signal raspberry, which stays for "now" and warnings); thunder rain is a
    downpour (more, longer, faster streaks);
  - rain and snow lean with the wind everywhere (east-west part sets the side, speed the slant, ~2° to 28°);
  - thunder in the precipitation grid: every 3–7 s a random zigzag bolt of white dots down the grid, sometimes forked;
  - snow lying on the ground (current snow_depth ≥ 1 cm): a soft lumpy ridge on the main card's horizon line.
- Tried and removed (don't redo unasked): a glow inside the main card's clouds and a flash in the cloud cover card
  during thunder; frost needles in the 48-hour strip; a golden-hour glow on the sun card.
- The main card's own thunder flash and glowing bolts are unchanged; making them calmer (thinner, no glow, rarer) was
  offered, not decided. Other ideas offered, not decided: real lightning strikes on the radar (Blitzortung, terms to
  check), fixing the empty-cards-in-Chrome bug first, a proper minus sign ("−4°") in the 48-hour strip.
- Cloud cover card: at least six rows of dots; on a short card the dots sit closer (10–15 px), phones unchanged.
- Clock: 24-hour by default for everyone (2026-10-18); 12-hour only when picked in settings (`clockChosen`), so an
  old region-based "12" saved with other settings is reset. The precipitation axis marks whole hours under their own
  column ("13:00" / "1pm").
