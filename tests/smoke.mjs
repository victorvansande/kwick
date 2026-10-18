/* Kwick smoke test: opens the app in Chromium and in WebKit (Safari's engine) at phone and desktop size, feeds it
   saved weather instead of the live services, and checks that it renders and works without errors: every card
   filled in, nothing sticking out sideways, the summary, the warning banner, the 14-day view and sheets, the
   settings, scrubbing the sun, zooming the radar, and the weather effects (frost, condensation, wind, fog).

   Run: node tests/smoke.mjs   (needs the "playwright" package and its browsers; see .github/workflows/publish.yml)
   Screenshots of every run land in tests/out/. Exits with an error if anything failed. */
import { chromium, webkit } from "playwright";
import http from "node:http";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const out = path.join(root, "tests", "out");
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".mjs": "text/javascript", ".css": "text/css", ".json": "application/json", ".png": "image/png", ".webmanifest": "application/manifest+json" };

/* ---------- a tiny static server for the repo ---------- */
const server = http.createServer(async (req, res) => {
  let p = decodeURIComponent(new URL(req.url, "http://x").pathname); if (p.endsWith("/")) p += "index.html";
  const file = path.join(root, p);
  try { if (!file.startsWith(root)) throw 0; const body = await fs.readFile(file); res.writeHead(200, { "content-type": TYPES[path.extname(file)] || "application/octet-stream" }); res.end(body); }
  catch { res.writeHead(404); res.end(); }
});
await new Promise(r => server.listen(0, r));
const base = `http://localhost:${server.address().port}/`;

/* ---------- saved weather, moved to today ---------- */
// The saved forecast's dates are shifted by whole days so "today" in the data is today, wherever the test runs.
const shiftDays = (text, days) => text.replace(/"(\d{4}-\d{2}-\d{2})(T[\d:]+)?"/g, (_, d, t = "") => {
  const s = new Date(Date.parse(d + "T00:00:00Z") + days * 864e5).toISOString().slice(0, 10); return `"${s}${t}"`;
});
const forecastText = await fs.readFile(path.join(root, "tests/fixtures/forecast.json"), "utf8");
const airText = await fs.readFile(path.join(root, "tests/fixtures/air.json"), "utf8");
const f0 = JSON.parse(forecastText), off = f0.utc_offset_seconds * 1000;
const todayLocal = new Date(Date.now() + off).toISOString().slice(0, 10);
const dayShift = Math.round((Date.parse(todayLocal) - Date.parse(f0.current.time.slice(0, 10))) / 864e5);
const nowKey = new Date(Date.now() + off).toISOString().slice(0, 13) + ":00";
function forecast(variant) {
  const j = JSON.parse(shiftDays(forecastText, dayShift)), c = j.current;
  c.time = nowKey; // "now" in the data is now
  if (variant === "cold") Object.assign(c, { temperature_2m: -6, apparent_temperature: -11 });
  if (variant === "humid") Object.assign(c, { relative_humidity_2m: 93, dew_point_2m: 17 });
  if (variant === "storm") {
    Object.assign(c, { weather_code: 65, precipitation: 3.2, wind_speed_10m: 55, wind_gusts_10m: 88, wind_direction_10m: 250 });
    // the main card takes rain from the quarter-hour timeline, so the storm rains there too
    if (j.minutely_15 && j.minutely_15.precipitation) j.minutely_15.precipitation = j.minutely_15.precipitation.map(() => 0.8);
  }
  if (variant === "fog") Object.assign(c, { weather_code: 45, visibility: 300 });
  return JSON.stringify(j);
}
const air = shiftDays(airText, dayShift);
// one orange wind warning drawn around Herentals, one yellow warning elsewhere that must not show
const ring = (x0, y0, x1, y1) => [x0, y0, x1, y0, x1, y1, x0, y1, x0, y0];
const iso = t => new Date(t).toISOString();
const warningsTile = JSON.stringify({ updated: iso(Date.now()), warnings: [
  { country: "belgium", level: 3, type: "Wind", event: "Orange wind warning", headline: "", description: "Gusts of 90 to 100 km/h.", instruction: "Secure loose objects.", sender: "KMI", web: "https://www.meteo.be/", onset: iso(Date.now() - 36e5), expires: iso(Date.now() + 9 * 36e5), areas: ["Antwerpen"], polys: [[ring(4.2, 50.9, 5.5, 51.5)]], bbox: [4.2, 50.9, 5.5, 51.5] },
  { country: "belgium", level: 2, type: "Rain", event: "Yellow rain warning", headline: "", description: "", instruction: "", sender: "KMI", web: "", onset: iso(Date.now()), expires: iso(Date.now() + 9 * 36e5), areas: ["Luxembourg"], polys: [[ring(5.2, 49.5, 6.2, 50.2)]], bbox: [5.2, 49.5, 6.2, 50.2] }] });
const PNG1 = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==", "base64");

async function routes(page, variant) {
  await page.route("**/*", route => {
    const u = new URL(route.request().url()), json = body => route.fulfill({ status: 200, contentType: "application/json", body });
    if (u.hostname === "localhost") return route.continue();
    if (u.hostname === "api.open-meteo.com") return json(forecast(variant));
    if (u.hostname === "air-quality-api.open-meteo.com") return json(air);
    if (u.hostname === "geocoding-api.open-meteo.com") return json(JSON.stringify({ results: [{ name: "Antwerp", admin1: "Flanders", country: "Belgium", latitude: 51.22, longitude: 4.4 }] }));
    if (u.hostname === "api.bigdatacloud.net") return json("{}");
    if (u.hostname === "api.rainviewer.com") return json(JSON.stringify({ host: "https://tilecache.rainviewer.com", radar: { past: [0, 1, 2].map(i => ({ time: Math.floor(Date.now() / 1000) - (2 - i) * 600, path: `/v2/radar/t${i}` })), nowcast: [] } }));
    if (u.hostname === "raw.githubusercontent.com") return json(warningsTile);
    if (/rainviewer|arcgisonline/.test(u.hostname)) return route.fulfill({ status: 200, contentType: "image/png", body: PNG1 });
    if (/fonts\.(googleapis|gstatic)\.com/.test(u.hostname)) return route.fulfill({ status: 200, contentType: "text/css", body: "" });
    if (u.hostname === "cdnjs.cloudflare.com") return route.continue(); // Leaflet
    return route.abort();
  });
}

/* ---------- the checks ---------- */
const failures = [];
let current = "";
const check = (label, ok, detail = "") => {
  console.log(`${ok ? "  ok  " : "  FAIL"} ${label}${ok || !detail ? "" : `: ${detail}`}`);
  if (!ok) { failures.push(label); if (process.env.GITHUB_ACTIONS) console.log(`::error title=${current}::${label}${detail ? ": " + String(detail).replace(/\s+/g, " ") : ""}`); }
};
// taps a control directly, so the floating dock can never be in the way
const tap = (page, sel) => page.$eval(sel, el => el.click());

async function run(engine, name, viewport, variant = "normal") {
  current = `${name} ${viewport.width}px ${variant}`;
  console.log(`\n${current}`);
  const context = await engine.newContext({ viewport, deviceScaleFactor: 2, serviceWorkers: "block" });
  await context.addInitScript(() => {
    if (!localStorage.getItem("isobar:place")) {
      localStorage.setItem("isobar:place", JSON.stringify({ name: "Herentals", sub: "Flanders, Belgium", lat: 51.1765, lon: 4.8325 }));
      localStorage.setItem("isobar:saved", JSON.stringify([{ name: "Herentals", sub: "Flanders, Belgium", lat: 51.1765, lon: 4.8325 }, { name: "Antwerp", sub: "Flanders, Belgium", lat: 51.22, lon: 4.4 }]));
    }
  });
  const page = await context.newPage(), errors = [];
  page.on("pageerror", e => errors.push(String(e)));
  // ignored: blocked test requests, Safari noting it skips the Android-only "interactive-widget" viewport setting, and the
  // browser's harmless note that a ResizeObserver callback was deferred to the next frame
  page.on("console", m => { if (m.type() === "error" && !/Failed to load resource|Viewport argument key|ResizeObserver loop/.test(m.text())) errors.push(m.text()); });
  await routes(page, variant);
  await page.goto(base);
  await page.waitForSelector("#heroTemp", { timeout: 15000 }).catch(() => {});
  await page.waitForTimeout(1500);
  const tag = `${name}-${viewport.width}-${variant}`;

  const s = await page.evaluate(() => ({
    hero: !!document.querySelector("#heroTemp"), cards: document.querySelectorAll("#board > .card").length,
    skeletons: document.querySelectorAll("#board .sk").length, summary: document.querySelector("#summary").textContent.trim(),
    overflow: document.documentElement.scrollWidth - innerWidth,
    warn: !document.querySelector("#warn").hidden && document.querySelector("#warnT").textContent
  }));
  check("main card renders", s.hero);
  check("all 16 cards present", s.cards === 16, `${s.cards}`);
  check("no card left loading", s.skeletons === 0, `${s.skeletons} placeholders`);
  check("summary written", s.summary.length > 10, s.summary);
  check("nothing sticks out sideways", s.overflow <= 0, `${s.overflow}px too wide`);
  // RULES.md: one truth per quantity, and one inset for every card
  const same = await page.evaluate(() => {
    const q = sel => document.querySelector(sel), num = t => (String(t || "").match(/-?\d+/) || [""])[0];
    const insets = [...document.querySelectorAll("#board > .card:not(.a-radar)")].map(c => {
      const h = c.querySelector(".ch h3"); return h && h.offsetParent ? Math.round(h.getBoundingClientRect().left - c.getBoundingClientRect().left) : null;
    }).filter(v => v != null);
    return { hero: num(q("#heroTemp").dataset.v), hourNow: num(q("#c-hourly svg text") && q("#c-hourly svg text").textContent),
      feelsHero: num(q("#heroFeels").textContent), feelsCard: num(q("#c-feels .num").textContent),
      insets: [...new Set(insets)], precip: q(".now-say").textContent, summary: q("#summary").textContent };
  });
  check("'now' shows the same temperature on the main card and in the hours", same.hero === same.hourNow, `${same.hero} vs ${same.hourNow}`);
  check("feels-like is the same on the main card and its own card", same.feelsHero === same.feelsCard, `${same.feelsHero} vs ${same.feelsCard}`);
  check("summary and precipitation card agree about rain soon", !(/^No rain expected/.test(same.precip) && /^(Rain|Drizzle|Snow|Sleet|Thunder|Light|Heavy)/.test(same.summary)), `"${same.summary}" / "${same.precip}"`);
  check("every card has the same inset", same.insets.length === 1, same.insets.join(", ") + "px"); // the radar card is a full-bleed map
  check("warning banner shows only the warning for this spot", s.warn === "Orange warning · Wind", String(s.warn));

  if (variant === "normal") {
    // sheets and controls
    await tap(page, "#warn"); check("warning details open", await page.evaluate(() => document.querySelector("#dlgWarn").open)); await page.keyboard.press("Escape");
    await tap(page, '.hseg button[data-v="d"]');
    check("14-day view shows 14 days", (await page.locator(".dcol").count()) === 14);
    await page.$$eval(".dcol", els => els[3].click());
    check("tapping a day opens it in the full forecast", await page.evaluate(() => document.querySelector("#dlgDays").open && document.querySelector("#deck .day.open .day-h").dataset.n === "3"));
    await page.keyboard.press("Escape");
    await tap(page, '.hseg button[data-v="h"]');
    await tap(page, "#searchBtn"); check("places sheet opens", await page.evaluate(() => document.querySelector("#dlgPlaces").open));
    await page.goBack(); await page.waitForTimeout(300); // Android's back button
    check("back closes the sheet and stays in the app", await page.evaluate(() => !document.querySelector("#dlgPlaces").open && !!document.querySelector("#heroTemp")));
    await tap(page, "#setBtn"); check("settings open", await page.evaluate(() => document.querySelector("#dlgSet").open)); await page.keyboard.press("Escape");
    await tap(page, "#infoBtn"); check("about the data opens", await page.evaluate(() => document.querySelector("#dlgInfo").open)); await page.keyboard.press("Escape");
    await tap(page, "#humidInfo"); check("humidity explainer opens", await page.evaluate(() => document.querySelector("#dlgLearn").open)); await page.keyboard.press("Escape");
    // scrub the sun on the main card (closing a sheet can scroll the page, so bring the arc into view first)
    await page.evaluate(() => scrollTo(0, 0));
    await page.locator("#arcIn").scrollIntoViewIfNeeded(); await page.waitForTimeout(300);
    const arc = await page.locator("#arcIn").boundingBox();
    if (arc) {
      await page.mouse.move(arc.x + arc.width * .3, arc.y + arc.height * .5); await page.mouse.down();
      await page.mouse.move(arc.x + arc.width * .7, arc.y + arc.height * .5, { steps: 6 }); await page.waitForTimeout(100); await page.mouse.up();
      await page.waitForTimeout(100);
      const when = await page.textContent("#heroWhen");
      check("scrubbing the sun shows another hour", when !== "Now", `still "${when}"; arc at ${Math.round(arc.x)},${Math.round(arc.y)} ${Math.round(arc.width)}×${Math.round(arc.height)}`);
    }
    // daylight through the year: one column per day, and the arrow keys move through it
    await page.click("#c-sun .sseg button[data-v=\"year\"]"); // the year chart sits behind the sun card's Year switch
    check("daylight chart covers the whole year", await page.evaluate(() => { const n = +document.querySelector("#yrChart").getAttribute("aria-valuemax"); return n === 365 || n === 366; }));
    await page.focus("#yrChart"); const before = await page.textContent("#yrDate"); await page.keyboard.press("PageUp");
    check("moving through the year shows another day", (await page.textContent("#yrDate")) !== before);
    // swipe between the two saved places (here with the arrow keys)
    check("two place dots", (await page.locator("#pdots i").count()) === 2);
    await page.evaluate(() => document.activeElement && document.activeElement.blur()); // the sun slider uses the arrow keys itself
    await page.keyboard.press("ArrowRight"); await page.waitForFunction(() => document.querySelector("#placeName").textContent === "Antwerp" && !document.querySelector("#refreshBtn").classList.contains("spin"), null, { timeout: 6000 }).catch(() => {});
    check("next place with the arrow key", (await page.textContent("#placeName")) === "Antwerp", await page.textContent("#placeName"));
    await page.keyboard.press("ArrowLeft"); await page.waitForFunction(() => document.querySelector("#placeName").textContent === "Herentals" && !document.querySelector("#refreshBtn").classList.contains("spin"), null, { timeout: 6000 }).catch(() => {});
    check("and back", (await page.textContent("#placeName")) === "Herentals", await page.textContent("#placeName"));
    // the radar: zoom in and out (this once ran Safari out of memory)
    await page.locator("#c-radar").scrollIntoViewIfNeeded();
    await page.waitForSelector("#radarMap .leaflet-pane", { timeout: 8000 }).catch(() => {}); // the map loads as the radar nears the screen
    for (let i = 0; i < 4; i++) { await tap(page, "#zIn"); await page.waitForTimeout(250); }
    for (let i = 0; i < 4; i++) { await tap(page, "#zOut"); await page.waitForTimeout(250); }
    check("radar survives zooming", await page.evaluate(() => !!document.querySelector("#radarMap .leaflet-pane")).catch(() => false));
    // cards pause their animations when scrolled away
    check("off-screen cards pause", await page.evaluate(() => document.querySelectorAll(".offscreen").length > 0));
  }
  if (variant === "cold") check("frost on the main card", await page.evaluate(() => !!document.querySelector("#heroFrost")));
  if (variant === "humid") check("condensation on the humidity card", await page.evaluate(() => !!document.querySelector("#humidCv")));
  if (variant === "storm") check("rain and wind on the main card", await page.evaluate(() => !!document.querySelector("#c-hero .fx") && !!document.querySelector("#c-hero .wlines")));
  if (variant === "fog") check("fog washes out the visibility card", await page.evaluate(() => parseFloat(getComputedStyle(document.querySelector(".vis-fog")).opacity) > .5));

  await page.evaluate(() => scrollTo(0, 0));
  await page.screenshot({ path: path.join(out, `${tag}.png`), fullPage: true });
  check("no errors in the console", errors.length === 0, errors.slice(0, 3).join(" | "));
  await context.close();
}

await fs.mkdir(out, { recursive: true });
const phone = { width: 390, height: 844 }, desktop = { width: 1280, height: 900 };
for (const [engine, name] of [[chromium, "chromium"], [webkit, "webkit"]]) {
  const browser = await engine.launch();
  const safe = async (...a) => { try { await run(browser, name, ...a); } catch (e) { check("run finished", false, e.message.split("\n")[0]); } };
  await safe(phone);
  await safe(desktop);
  for (const v of ["cold", "humid", "storm", "fog"]) await safe(phone, v);
  await browser.close();
}
server.close();
console.log(failures.length ? `\n${failures.length} check(s) failed` : "\nAll checks passed");
process.exit(failures.length ? 1 : 0);
