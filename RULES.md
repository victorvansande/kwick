# Kwick rules

A reference, not a law book. These notes keep the app one consistent piece of work, and they are the first thing to
read before adding something new. They are meant to be played with: when a change is clearly better by breaking a
rule, break it, and update the rule (and, if it is a checked one, the numbers in `tests/lint.mjs`) so the reference
stays true. `tests/lint.mjs` checks the rules a machine can check on every push; the rest are for whoever changes the
app (Claude included) to weigh.

## Look and feel

What Kwick feels like, as a touchstone for anything new: does it look like it was always there?

- **Calm, natural and precise.** A quiet surface that tells the truth about the sky. Decoration only when it carries
  real data; nothing that is only there to look busy.
- **The real sky is the colour.** The main card, the sun and the moon take the colour of the sky outside; the
  ground is a soft wash of that same sky.
- **Day and night are mirrors.** Pastel tints with dark ink by day; at night ink-black with just a touch of each card's colour and light ink (no blue cast). No glow, no
  gloss, no neon, no glassy bubbles.
- **Dot matrix is the signature.** Numerals on the instruments, grids (rain, clouds), scroll bars, timelines and
  small marks are built from dots that light up; a dot is "on", a faint dot is "off".
- **Capsules point.** Needles and markers are short rounded capsules in raspberry, on scales of dots or thin lines.
- **Thin lines, round ends.** Arcs, axes and icons are fine strokes with rounded caps; the travelled part bright,
  the rest soft.
- **Nature sets the shapes and the motion.** The sun's arc is a sine of time, the moon has its real phase, clouds
  drift with the wind, rain falls where it is forecast, frost creeps in. Motion is slow, smooth and caused by data.
- **One idea per card.** A title, one short subtitle, the reading, one picture of it, at most one line underneath.
- **Plain words.** Short English sentences a person would say; no jargon unless it is the right word.

## Data: one truth per quantity

1. **One source per quantity.** Wherever two cards show the same thing, they read the same value from the same
   place:
   - "now" (temperature, feels-like, sky, wind) is the current conditions `X.c`, everywhere: the main card, the top
     bar and the "Now" column of the hours card;
   - rain in the next six hours is `nowcast()`, everywhere: the precipitation card, the summary sentence, the
     main card's "Rain from / Dry from" and the rain on its arc;
   - the weather at any moment in those six hours (the word under "Now" or under the dragged sun, the icon, the
     sky's animation, the arc's band under the dot) takes whether it rains from that same timeline (`weatherAt`), so
     one moment never gets two answers;
   - sunrise and sunset are Open-Meteo's daily values; twilight, golden hour and solar noon are computed with the
     same sun formulas everywhere.
1a. **Rain needs rain behind it.** A rain or snow word, icon, falling drop or blue dot appears only where an amount
   is forecast (0.1 mm in an hour, 0.2 mm in a day); without one the sky shows by its cloud cover (`dryCode`). A
   chance alone is grey and still. Blue always means "in the forecast", on every card. (This kept coming back: a
   drizzle icon with 0.0 mm, a blue 75% over a dry hour, "Clear" on a rain band.)
2. **What you see is what is compared.** Logic that compares or labels values (same/colder, the dots on a scale)
   works from the same rounded numbers the card shows, never from hidden decimals.
3. **Say which day.** A time from another day than today carries the day ("Sunrise tomorrow").
4. **Measured, not made up.** Only data from a named source or a published formula; no extrapolation or estimates
   of our own. Every source is credited in About.
5. **Times are the place's own time**, in the clock style chosen in settings.

## Words

6. English, sentence case, no full stop on labels.
7. A card never repeats what it already says: the line under a number adds something new.
8. A card's title and subtitle are each exactly one line, never wrapped: write them short enough for a half-width
   card on a phone (about 16 characters), and on a very narrow screen they shrink a little to fit (`fitHeads`,
   down to 13 px). The foot of a card is at most one line.
9. Units always follow the settings and are written small after the number.
9a. **Never break or cut a phrase.** A label, a date, a time or a number with its unit stays whole on one line
    ("Sunrise tomorrow", "Tue 13 Oct", "34 min"): give each part `white-space: nowrap` or a no-break space, and let a
    line break only between parts (at a "·" or a comma). When space runs out, the text that can wrap wraps
    (balanced), and a name that can't wrap shrinks to fit. Cutting text off with an ellipsis is a last resort, only
    where nothing else is possible (a place name too long even at its smallest size); `tests/lint.mjs` keeps a list
    of those places.

## Layout

10. **One inset for every card**: `--pad-x` (20 px, 16 px on phones) left and right; the card's own padding top and
    bottom. A card whose content runs edge to edge (the hours strip) gives its header and foot that same inset.
10a. **A card's content grows with the card, not the screen.** Cards are made for a phone (a half-width card is
    about 180 px). Wider than a phone (601 px and up), each card gets a factor --k from its own width (width / 180 px,
    1 to 1.35) and its readings and pictures use it: the big numbers, compass, gauges, dot-matrix figures, the rain
    chart. Titles and small text keep the type scale. Phones and the wall view stay at 1, exactly as designed. Between
    761 and 1000 px the board has three columns, so no card gets twice the width its content was made for. Anything
    new that should fill a wider card uses `calc(size * var(--k,1))`.
11. **One gap between cards**: 14 px (10 px on phones).
12. **Controls line up with the text**: a switch or button in a card sits on the same inset as the title.
    The main card follows the same inset; corner controls (Back to now, the moon) line up on it.
12a. **Scrolling down the page never gets caught in a card.** Up and down on a mouse wheel or trackpad always
    scrolls the page; sliders and timelines move with a sideways scroll (or Shift), dragging or the arrow keys. On a
    touch screen one finger scrolls the page past the map; two fingers move and pinch it.
12b. **One way back, in one place.** When a card is moved away from now (dragging along the sun's day, the year, the
    main card's arc), a red pill brings it back: "Back to now" for a time, "Today" for a date. It takes the card's
    top-right corner and replaces the view switcher there while it shows; it never sits beside or below the
    switcher. Each view shows only its own way back.
12c. **Same job, same behaviour.** When cards do the same thing (switch views, fold open, go back to now, point with
    a needle, show a grid of dots, let drops fall), they use the same piece and the same motion. A fix to one is
    checked on all the others in the same change, not found later on the next card.
12d. **What can be tapped looks tappable.** A notice that offers a way out shows it as a button with a verb (Retry,
    Today, Back to now), never as a plain message you happen to be able to tap. A hint about a hidden gesture is a
    short line of text, shown once, not an animation.
13a. **Corners**: card 30 px (`--r-card`), surfaces inside cards 16 px, pills fully round; 1–3 px only for hairline
    marks and needles.
13b. **Gaps inside cards** follow a rhythm of 4: 2, 4, 8, 12, 16, 20 px.
13c. **Breathing room between blocks.** Inside a card, separate blocks (the header, a reading, a picture, a row of
    tiles, a sentence, the foot) are at least 12 px apart; lines that belong together sit 2–4 px apart. Text never
    touches the edge of a box it sits in: a tile or other inner box keeps 12 px of padding all round. In code: the
    header (`.ch`) keeps 12 px below it, the foot (`.foot`) and a note (`.empty`) keep 12 px above them.
13. Cards keep the order fixed in `index.html` and the grid areas in `styles.css`; a new card gets a place in both
    the wide and the phone layout, and in the wall view.

## Type

14. **Three faces, by role**, always through their variables:
    - `--f-display` (Geist): titles, sentences, buttons;
    - `--f-label` (Geist letters with Urbanist figures): small labels, units, times on axes;
    - `--f-num` (Urbanist, light): the big readings.
14a. **Type sizes**: 11, 12, 13, 15, 17, 20, 30 px. The big readings in `--f-num` keep their own sizes; text fields
    stay 16 px (iOS zooms in below that); text inside an SVG drawing scales with it.
14b. **A temperature centred on something is centred on its digits.** Above a needle, over a column or a point on a
    curve, the number sits centred and the degree sign hangs after it, as on the main card: use `degMid` (HTML) or
    `degMidSvg` (SVG text), which balance the visible degree sign with an invisible one in front.
15. **Weights**: Geist 400, 500, 600, 700; Urbanist 200–400. Nothing in between (Geist only comes in those steps).
16. Dot-matrix numerals only on the main card, the top bar and the instruments (wind, UV, pressure, air quality),
    and each has a spoken label (`aria-label`).

## Colour and look

17. Every colour of a card comes from `palette.js` or the `:root` tokens; no new hard-coded colours in components.
18. Raspberry (`--signal`) marks "now" and needles, and the one main action; nothing decorative.
19. Day and night are mirrors: day = light tints with dark ink, night = ink-black with a touch of the card's colour and light ink; no glow or shine
    on cards in either. Sky cards (main card, sun, moon) show the real sky colour. The one glow allowed is a warning's: an orange or red warning in force puts a soft halo in its colour round the dock (it is a signal, not decoration).
20. Shapes follow nature: the sun's arc is a sine of time, the moon has its real phase, rain falls where it is
    forecast. **Motion follows the data too**: rain and snow lean with the wind, clouds and lines drift at its pace,
    drops fall as often as the rain is heavy, and nothing moves that the data doesn't say.
20a. **Sheets are cards too.** The windows that open on top (14 days, How sure, About, Settings, Places, warnings,
    the humidity explainer) follow every rule here: the same data as the cards, the same words, day and night as
    mirrors (light glass with dark ink by day, the board's night glass at night), drawn with the sheet tokens
    `--ink`, `--ink-2`, `--ink-3`, `--wash` and `--wash-2` rather than fixed white, and no blur on the sheet itself.
    "Today" in a sheet says whether it means the whole day or the rest of it.
20b. **Axes are true.** Every mark sits exactly on the value it names: month letters span their real number of days,
    a needle sits on its dot, a temperature over a point is centred on its digits (14b), and labels never overlap.
    Equal spacing is only right when the values really are equal.

## Rendering and speed

21. No `mask`, `filter` or `backdrop-filter` on a very wide or scrolling element; put it on a card-sized wrapper.
    Cards contain their own painting.
21a. **Animate only what the graphics chip can move for free**: `transform` and `opacity` of a finished layer. Never
    animate what forces a redraw every frame (gradient positions, custom properties inside gradients, blur, SVG noise)
    on anything large; draw it once and move the layer. Continuous redraws across many cards make Chrome fall behind
    and flash half-drawn or stale cards. Small, throttled exceptions (the heat shimmer on the arc and the number) are fine.
21b. **Keep the graphics chip's memory light.** No blur on layers that move (the cards' light is soft gradients, not a
    blurred layer); big moving layers stop altogether off screen so Chrome can let them go; and a card is repainted as
    it comes into view, because Chrome short of memory can drop a layer's pixels and leave a card empty. A card also
    clips its own moving layers to its rounded shape, since Chrome and iOS can let a moved layer paint outside the
    plain corner clip.
22. Animations pause when their card is off screen or the tab is hidden, and respect "reduce motion".
22a. **Everything that folds open, folds smoothly, all the same way.** A panel, list or menu that opens inside a card
    or sheet (the air card's pollutants, the folded pollen strip, a day in the 14-day sheet) never jumps from hidden to
    shown with `display:none`. It sits in a wrapper that grows from `grid-template-rows:0fr` to `1fr` over about
    .35 s (`ease`; a big panel like a whole day may take up to .45 s), with its content clipped (`min-height:0;
    overflow:hidden`) and `visibility:hidden` once closed, so nothing in it can be tabbed to; its arrow turns along.
    Closing runs the same way back. A panel that opens beside the content (the pollutants on a wide air card) widens
    the same way instead: its column grows from `0fr`, its contents fading in once there is room, and the layout never
    switches between side-by-side and stacked mid-way. Being short and only on a tap, this is the one allowed
    exception to 21a's "transform and opacity only".
23. Canvases are sized to the screen's pixels and redrawn only when something changed.
24. Heavy things (map, moon map, climate history) load only when they are about to be seen.

## Way of working

25. Every change is checked in the preview (at phone width too, down to 320 px, and by day and at night), including
    the sheets that show the same thing as the changed card. Layouts that change with the width are checked on a
    wide screen too (about 1000 and 1300 px) and in the wall view, where most layout bugs turned up; then committed. It is pushed to
    `main` when the owner says so, and the check workflow runs the lint
    and the browser test in Chromium and WebKit before publishing.
26. Design choices are shown as options first; the person who owns the app picks.
