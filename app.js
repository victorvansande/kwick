/* Kwick Weather: the app. Loaded after Leaflet, palette.js and the moon map (see index.html). */
(() => {
"use strict";
const $ = (s, r = document) => r.querySelector(s);
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const esc = s => String(s ?? "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const R = v => (v == null || isNaN(v)) ? "–" : Math.round(v);
/* A temperature centred on something (a needle, a column, a point on a curve) is centred on its digits; the degree sign
   hangs after them, as on the main card. An invisible degree sign in front balances the visible one. In HTML and in
   SVG text. */
const degMid = v => `<span class="deg0">°</span>${v}°`;
const degMidSvg = v => `<tspan fill-opacity="0">°</tspan>${v}°`;
const nz = v => v == null || isNaN(v) ? null : v;
const { FAM, heroPal, lum, paint } = window.Palette;

/* The dock's refraction uses an SVG filter inside backdrop-filter, which only Chromium renders. */
if (navigator.userAgentData && navigator.userAgentData.brands.some(b => /Chromium/.test(b.brand))) document.documentElement.classList.add("lq");

/* ---------------- app shell ---------------- */
// Opened from the home screen: switch on the native-app behaviour in CSS (no bounce, no selection, status bar scrim)
if (navigator.standalone || matchMedia("(display-mode: standalone)").matches) document.documentElement.classList.add("standalone");
document.addEventListener("touchstart", () => {}, { passive: true }); // iOS only shows :active press states when the page listens for touches
// Safari ignores user-scalable=no, so block its pinch gestures directly; the radar map handles its own pinch zoom
for (const ev of ["gesturestart", "gesturechange"]) document.addEventListener(ev, e => { if (!e.target.closest || !e.target.closest(".leaflet-container")) e.preventDefault(); }, { passive: false });
// Offline support and instant launch (see sw.js)
if ("serviceWorker" in navigator && (location.protocol === "https:" || location.hostname === "localhost")) navigator.serviceWorker.register("sw.js").catch(() => {});
/* A home-screen app can stay alive for days, resuming without reloading, and so keeps running the version it started
   with (a fix that is already online never reaches it). When it comes back after five minutes or more, it asks whether
   app.js changed (its ETag) and quietly reloads into the new version if so; never while a sheet is open. */
{
  let tag = null, hiddenAt = 0;
  const tagOf = () => fetch("app.js", { method: "HEAD", cache: "no-store" }).then(r => r.ok ? r.headers.get("etag") || r.headers.get("last-modified") : null).catch(() => null);
  tagOf().then(t => { tag = t; });
  document.addEventListener("visibilitychange", async () => {
    if (document.hidden) { hiddenAt = Date.now(); return; }
    if (!tag || Date.now() - hiddenAt < 5 * 6e4) return;
    const now = await tagOf();
    if (now && now !== tag && !document.querySelector("dialog[open]")) location.reload();
  });
}

/* ---------------- storage ---------------- */
const store = {
  get(k, d) { try { const v = localStorage.getItem("isobar:" + k); return v ? JSON.parse(v) : d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem("isobar:" + k, JSON.stringify(v)); } catch {} }
};
const S = Object.assign({ temp: "c", wind: "kmh", precip: "mm", clock: "24", mode: "auto", model: "best_match" }, store.get("settings", {}));
// the clock is 24-hour unless someone picks 12-hour in settings themselves (it used to follow the phone's region, and
// that choice was saved along with any other setting, so it's only kept when it was picked on purpose)
if (!store.get("clockChosen", false)) S.clock = "24";
let place = store.get("place", null);
let saved = store.get("saved", []);
let D = null, AQ = null, U = null, TZ = "UTC", OFF = 0, fetchedAt = 0; // U: how sure the forecast is, per day

const MODELS = [
  ["best_match", "Best match", "Picks the sharpest local model for your spot (KNMI HARMONIE, DWD ICON-D2, Météo-France AROME, UKMO, HRRR…) and hands over to ECMWF for later days."],
  ["ecmwf_ifs", "ECMWF IFS", "The European Centre's global model, 9 km, a reference for the days ahead."],
  ["ecmwf_aifs025_single", "ECMWF AIFS", "ECMWF's machine-learning global forecast."],
  ["icon_seamless", "DWD ICON", "German Weather Service. 2.2 km over central Europe."],
  ["knmi_seamless", "KNMI HARMONIE", "Dutch Met Office. 2 km over the Netherlands and Belgium, 5.5 km over the rest of Europe."],
  ["meteofrance_seamless", "Météo-France AROME", "1.3 km over France and its neighbours."],
  ["metno_seamless", "MET Norway", "1 km over the Nordics."],
  ["ukmo_seamless", "UK Met Office", "2 km over the British Isles."],
  ["gfs_seamless", "NOAA GFS + HRRR", "US global model, 3 km HRRR over North America."]
];

/* ---------------- time ---------------- */
function T(str) {
  const [d, t = "00:00"] = str.split("T");
  const [Y, M, Dd] = d.split("-").map(Number);
  const [h, m] = t.split(":").map(Number);
  return new Date(Date.UTC(Y, M - 1, Dd, h, m) - OFF * 1000);
}
const loc = () => S.clock === "12" ? "en-US" : "en-GB";
/* A time that says its day when it isn't today (rule 3): "13:30", "01:15 tomorrow", "23:00 yesterday", else "Tue 09:00". */
const dayKey = t => new Date(t.valueOf() + OFF * 1000).toISOString().slice(0, 10);
const fmtTD = t => {
  const d = Math.round((Date.parse(dayKey(t)) - Date.parse(dayKey(Date.now()))) / 864e5), s = fmtT(new Date(t.valueOf()));
  return d === 0 ? s : d === 1 ? `${s} tomorrow` : d === -1 ? `${s} yesterday` : `${wd(dayKey(t))} ${s}`;
};
const fmtT = d => (!d || isNaN(d)) ? "–" : new Intl.DateTimeFormat(loc(), { hour: S.clock === "12" ? "numeric" : "2-digit", minute: "2-digit", hour12: S.clock === "12", timeZone: TZ }).format(d);
const fmtH = d => S.clock === "12"
  ? new Intl.DateTimeFormat("en-US", { hour: "numeric", hour12: true, timeZone: TZ }).format(d).replace(" ", "").toLowerCase()
  : new Intl.DateTimeFormat("en-GB", { hour: "2-digit", hour12: false, timeZone: TZ }).format(d);
const dayOf = key => { const [Y, M, Dd] = key.split("-").map(Number); return new Date(Date.UTC(Y, M - 1, Dd, 12)); };
const wd = key => dayOf(key).toLocaleDateString("en-GB", { weekday: "short", timeZone: "UTC" });
const dm_ = key => dayOf(key).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });
// one way to write a length of time everywhere: "10 h 57 min", "45 min", "3 min 48 s"; a number never parts from its unit (no-break spaces)
const dur = s => { if (s == null || isNaN(s)) return "–"; const t = Math.round(s / 60), h = Math.floor(t / 60), m = t % 60; return h ? (m ? `${h}\u00a0h ${m}\u00a0min` : `${h}\u00a0h`) : `${m}\u00a0min`; };
// a time for a reading: the numbers in their own size and AM/PM small after them, as every unit
const fmtTu = d => fmtT(d).replace(/[\s ]?([ap]\.?\s?m\.?)$/i, "<span class=\"u\"> $1</span>");
const inMins = m => m < 60 ? `${Math.round(m)}\u00a0min` : `${Math.floor(m / 60)}\u00a0h ${Math.round(m % 60) ? Math.round(m % 60) + "\u00a0min" : ""}`.trim();
const localDateLabel = d => new Intl.DateTimeFormat("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: TZ }).format(d);

/* ---------------- units ---------------- */
const toC = t => S.temp === "f" ? (t - 32) * 5 / 9 : t;
const WU = { kmh: "km/h", ms: "m/s", mph: "mph", kn: "kn" };
const PU = () => S.precip === "inch" ? "in" : "mm";
const toMs = v => ({ kmh: v / 3.6, ms: v, mph: v * 0.44704, kn: v * 0.514444 })[S.wind];
const toMm = v => S.precip === "inch" ? v * 25.4 : v;
const fmtP = v => v == null ? "–" : (S.precip === "inch" ? v.toFixed(2) : (v < 10 ? v.toFixed(1) : Math.round(v)));
const BFT = [[0.5, "Calm"], [1.6, "Light air"], [3.4, "Light breeze"], [5.5, "Gentle breeze"], [8, "Moderate breeze"], [10.8, "Fresh breeze"], [13.9, "Strong breeze"], [17.2, "Near gale"], [20.8, "Gale"], [24.5, "Strong gale"], [28.5, "Storm"], [32.7, "Violent storm"], [1e9, "Hurricane force"]];
const beaufort = ms => { const i = BFT.findIndex(b => ms < b[0]); return [i, BFT[i][1]]; };
const PTS = ["N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE", "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW"];
const pt16 = d => PTS[Math.round(d / 22.5) % 16];

/* ---------------- weather codes ---------------- */
const WMO = {0:["Clear","clear"],1:["Mostly clear","clear"],2:["Partly cloudy","partly"],3:["Overcast","cloudy"],45:["Fog","fog"],48:["Freezing fog","fog"],
  51:["Light drizzle","drizzle"],53:["Drizzle","drizzle"],55:["Heavy drizzle","drizzle"],56:["Freezing drizzle","sleet"],57:["Freezing drizzle","sleet"],
  61:["Light rain","rain"],63:["Moderate rain","rain"],65:["Heavy rain","rain"],66:["Freezing rain","sleet"],67:["Freezing rain","sleet"],
  71:["Light snow","snow"],73:["Snow","snow"],75:["Heavy snow","snow"],77:["Snow grains","snow"],80:["Light showers","rain"],81:["Showers","rain"],82:["Violent showers","rain"],
  85:["Snow showers","snow"],86:["Heavy snow showers","snow"],95:["Thunderstorm","thunder"],96:["Thunder and hail","thunder"],99:["Thunder and hail","thunder"]};
const wmo = c => WMO[c] || ["–", "cloudy"];
function icon(kind, day = true) {
  const id = { clear: day ? "i-sun" : "i-moon", partly: day ? "i-pcd" : "i-pcn", cloudy: "i-cloud", fog: "i-fog", drizzle: "i-drizzle", rain: "i-rain", snow: "i-snow", sleet: "i-sleet", thunder: "i-thunder" }[kind] || "i-cloud";
  return `<svg class="ic" viewBox="0 0 24 24" aria-hidden="true"><use href="#${id}"/></svg>`;
}

/* ---------------- dot-matrix numerals ---------------- */
const GL = {
  "0": [".###.", "#...#", "#...#", "#...#", "#...#", "#...#", ".###."],
  "1": ["..#..", ".##..", "..#..", "..#..", "..#..", "..#..", ".###."],
  "2": [".###.", "#...#", "....#", "...#.", "..#..", ".#...", "#####"],
  "3": [".###.", "#...#", "....#", "..##.", "....#", "#...#", ".###."],
  "4": ["...#.", "..##.", ".#.#.", "#..#.", "#####", "...#.", "...#."],
  "5": ["#####", "#....", "####.", "....#", "....#", "#...#", ".###."],
  "6": ["..##.", ".#...", "#....", "####.", "#...#", "#...#", ".###."],
  "7": ["#####", "....#", "...#.", "..#..", ".#...", ".#...", ".#..."],
  "8": [".###.", "#...#", "#...#", ".###.", "#...#", "#...#", ".###."],
  "9": [".###.", "#...#", "#...#", ".####", "....#", "...#.", ".##.."],
  "-": ["...", "...", "...", "###", "...", "...", "..."],
  ".": [".", ".", ".", ".", ".", ".", "#"],
  ":": [".", ".", "#", ".", "#", ".", "."],
  "–": ["...", "...", "...", "###", "...", "...", "..."]
};
/* Where the dot-matrix numerals go (the app's number rule): the main temperature, the clock, and numbers that sit
   inside an instrument, such as the wind compass, the UV gauge, the pressure dial and the air-quality scale. Plain
   readings (feels like, humidity, visibility, rain, clouds, the moon, pollen) use the thin numeral font. */
function dm(str, { deg = false, ghost = true } = {}) {
  let x = 0; const on = [], off = [];
  for (const ch of String(str)) {
    const g = GL[ch]; if (!g) continue;
    g.forEach((row, y) => [...row].forEach((v, cx) => (v === "#" ? on : off).push([x + cx, y])));
    x += g[0].length + 1;
  }
  if (deg) { [".#.", "#.#", ".#."].forEach((row, y) => [...row].forEach((v, cx) => { if (v === "#") on.push([x + cx, y, 1]); })); x += 3; }
  else x -= 1;
  // --dshift: how far to slide the number so its digits, not digits plus degree sign, sit on the centre line
  // (only for up to two digits: a long number such as −47° needs the whole width and is simply centred)
  let s = `<svg class="dm" viewBox="-0.5 -0.5 ${x} 7" aria-hidden="true"${deg && x <= 15 ? ` style="--dshift:${(200 / x).toFixed(2)}%"` : ""}>`;
  if (ghost) for (const [a, b] of off) s += `<circle class="g" cx="${a}" cy="${b}" r=".33"/>`;
  for (const [a, b, small] of on) s += `<circle class="o" cx="${a}" cy="${b}" r="${small ? .3 : .4}" style="--d:${(((a * 7 + b * 13) % 17) / 17 * .55).toFixed(2)}s"/>`;
  return s + "</svg>";
}

/* ---------------- astronomy (after V. Agafonkin's SunCalc) ---------------- */
const PI = Math.PI, sin = Math.sin, cos = Math.cos, tan = Math.tan, asin = Math.asin, atan2 = Math.atan2, acos = Math.acos, rad = PI / 180;
const dayMs = 864e5, J1970 = 2440588, J2000 = 2451545, J0 = 0.0009, OBL = rad * 23.4397;
const toDays = d => d.valueOf() / dayMs - 0.5 + J1970 - J2000;
const fromJ = j => new Date((j + 0.5 - J1970) * dayMs);
const RA = (l, b) => atan2(sin(l) * cos(OBL) - tan(b) * sin(OBL), cos(l));
const DEC = (l, b) => asin(sin(b) * cos(OBL) + cos(b) * sin(OBL) * sin(l));
const ALT = (H, phi, dec) => asin(sin(phi) * sin(dec) + cos(phi) * cos(dec) * cos(H));
const sidereal = (d, lw) => rad * (280.16 + 360.9856235 * d) - lw;
const refr = h => { if (h < 0) h = 0; return 0.0002967 / Math.tan(h + 0.00312536 / (h + 0.08901179)); };
const solarM = d => rad * (357.5291 + 0.98560028 * d);
const eclL = M => M + rad * (1.9148 * sin(M) + 0.02 * sin(2 * M) + 0.0003 * sin(3 * M)) + rad * 102.9372 + PI;
const sunCoords = d => { const L = eclL(solarM(d)); return { dec: DEC(L, 0), ra: RA(L, 0) }; };
function sunTimes(date, lat, lng) {
  const lw = rad * -lng, phi = rad * lat, d = toDays(date), n = Math.round(d - J0 - lw / (2 * PI));
  const ds = J0 + lw / (2 * PI) + n, M = solarM(ds), L = eclL(M), dec = DEC(L, 0);
  const Jnoon = J2000 + ds + 0.0053 * sin(M) - 0.0069 * sin(2 * L);
  const out = { noon: fromJ(Jnoon) };
  for (const [h, a, b] of [[-0.833, "rise", "set"], [-6, "dawn", "dusk"], [6, "goldenEnd", "golden"]]) {
    const w = acos((sin(h * rad) - sin(phi) * sin(dec)) / (cos(phi) * cos(dec)));
    const Jset = J2000 + J0 + (w + lw) / (2 * PI) + n + 0.0053 * sin(M) - 0.0069 * sin(2 * L);
    out[a] = fromJ(Jnoon - (Jset - Jnoon)); out[b] = fromJ(Jset);
  }
  return out;
}
const sunAlt = (date, lat, lng) => { const lw = rad * -lng, phi = rad * lat, d = toDays(date), c = sunCoords(d); return ALT(sidereal(d, lw) - c.ra, phi, c.dec); };
const moonCoords = d => {
  const L = rad * (218.316 + 13.176396 * d), M = rad * (134.963 + 13.064993 * d), F = rad * (93.272 + 13.22935 * d);
  const l = L + rad * 6.289 * sin(M), b = rad * 5.128 * sin(F);
  return { ra: RA(l, b), dec: DEC(l, b), dist: 385001 - 20905 * cos(M) };
};
const moonAlt = (date, lat, lng) => { const lw = rad * -lng, phi = rad * lat, d = toDays(date), c = moonCoords(d); const h = ALT(sidereal(d, lw) - c.ra, phi, c.dec); return h + refr(h); };
function moonIllum(date) {
  const d = toDays(date), s = sunCoords(d), m = moonCoords(d), sd = 149598000;
  const phi = acos(sin(s.dec) * sin(m.dec) + cos(s.dec) * cos(m.dec) * cos(s.ra - m.ra));
  const inc = atan2(sd * sin(phi), m.dist - sd * cos(phi));
  const ang = atan2(cos(s.dec) * sin(s.ra - m.ra), sin(s.dec) * cos(m.dec) - cos(s.dec) * sin(m.dec) * cos(s.ra - m.ra));
  return { fraction: (1 + cos(inc)) / 2, phase: 0.5 + 0.5 * inc * (ang < 0 ? -1 : 1) / PI };
}
function moonTimes(t0, lat, lng) {
  const hl = h => new Date(t0.valueOf() + h * 36e5), hc = 0.133 * rad;
  let h0 = moonAlt(t0, lat, lng) - hc, rise, set;
  for (let i = 1; i <= 24; i += 2) {
    const h1 = moonAlt(hl(i), lat, lng) - hc, h2 = moonAlt(hl(i + 1), lat, lng) - hc;
    const a = (h0 + h2) / 2 - h1, b = (h2 - h0) / 2, xe = -b / (2 * a), ye = (a * xe + b) * xe + h1, dd = b * b - 4 * a * h1;
    let roots = 0, x1 = 0, x2 = 0;
    if (dd >= 0) { const dx = Math.sqrt(dd) / (Math.abs(a) * 2); x1 = xe - dx; x2 = xe + dx; if (Math.abs(x1) <= 1) roots++; if (Math.abs(x2) <= 1) roots++; if (x1 < -1) x1 = x2; }
    if (roots === 1) { if (h0 < 0) rise = i + x1; else set = i + x1; }
    else if (roots === 2) { rise = i + (ye < 0 ? x2 : x1); set = i + (ye < 0 ? x1 : x2); }
    if (rise != null && set != null) break;
    h0 = h2;
  }
  return { rise: rise != null ? hl(rise) : null, set: set != null ? hl(set) : null };
}
const phaseName = p => p < .034 || p > .966 ? "New moon" : p < .216 ? "Waxing crescent" : p < .284 ? "First quarter" : p < .466 ? "Waxing gibbous" : p < .534 ? "Full moon" : p < .716 ? "Waning gibbous" : p < .784 ? "Last quarter" : "Waning crescent";

/* The lit part of the moon as a path: the bright limb plus the terminator ellipse. */
function moonLitPath(ctx, cx, cy, r, phase) {
  const k = cos(2 * PI * phase);
  ctx.beginPath();
  if (phase < .5) { ctx.arc(cx, cy, r, -PI / 2, PI / 2, false); ctx.ellipse(cx, cy, r * Math.abs(k), r, 0, PI / 2, -PI / 2, k > 0); }
  else { ctx.arc(cx, cy, r, PI / 2, 3 * PI / 2, false); ctx.ellipse(cx, cy, r * Math.abs(k), r, 0, -PI / 2, PI / 2, k > 0); }
  ctx.closePath();
}
function moonShape(ctx, cx, cy, r, phase, mirror, lit, dark) {
  ctx.save();
  if (mirror) { ctx.translate(cx * 2, 0); ctx.scale(-1, 1); }
  ctx.beginPath(); ctx.arc(cx, cy, r, 0, PI * 2); ctx.fillStyle = dark; ctx.fill();
  moonLitPath(ctx, cx, cy, r, phase); ctx.fillStyle = lit; ctx.fill();
  ctx.restore();
}
/* Canvases size themselves from the page layout. While renderAll rebuilds the cards, their drawing waits until every card
   is in place (holdDraw), so the browser lays the page out once instead of once per canvas. Same frame, same result. */
let holdDraw = null;
const whenMeasured = fn => holdDraw ? holdDraw.add(fn) : fn();
function sizeCanvas(cv) {
  const dpr = Math.min(window.devicePixelRatio || 1, 2), w = cv.clientWidth, h = cv.clientHeight;
  if (!w || !h) return null;
  cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr);
  const ctx = cv.getContext("2d"); ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return { ctx, w, h };
}
/* The real near side, on a unit disc with north up as seen from the northern hemisphere (Crisium on the right).
   Seas: [x, y, rx, ry, rotation, darkness]; large seas are built from a few overlapping pieces for an irregular outline. */
const MARIA = [
  [-.66, .05, .26, .38, .2, .7], [-.55, -.25, .2, .2, 0, .65], [-.62, .3, .18, .16, 0, .6], // Oceanus Procellarum
  [-.34, -.38, .27, .22, -.3, .95],  // Mare Imbrium
  [.17, -.38, .16, .15, 0, .95],     // Mare Serenitatis
  [.33, -.1, .2, .17, .3, .9], [.42, .02, .1, .1, 0, .8], // Mare Tranquillitatis
  [.68, -.3, .11, .13, 0, 1],        // Mare Crisium
  [.55, .16, .12, .16, .4, .75],     // Mare Fecunditatis
  [.34, .3, .09, .09, 0, .75],       // Mare Nectaris
  [-.17, .38, .17, .13, .2, .75],    // Mare Nubium
  [-.48, .38, .1, .09, 0, .85],      // Mare Humorum
  [.02, -.72, .42, .07, 0, .65],     // Mare Frigoris
  [.04, -.2, .07, .06, 0, .75]       // Mare Vaporum
];
/* Young, bright rayed craters: [x, y, radius, brightness]. Tycho (first) also gets its ray system. */
const BRIGHT = [[-.12, .72, .035, 1], [-.32, -.12, .03, .8], [-.55, -.1, .02, .6], [-.7, -.36, .02, 1]];

/* Smooth value noise (fBm) for irregular sea edges and the grain of the highlands. */
const nhash = (x, y) => { let h = Math.imul(x, 374761393) + Math.imul(y, 668265263); h = Math.imul(h ^ (h >>> 13), 1274126177); return ((h ^ (h >>> 16)) >>> 0) / 4294967296; };
function vnoise(x, y) {
  const xi = Math.floor(x), yi = Math.floor(y), u = x - xi, v = y - yi, su = u * u * (3 - 2 * u), sv = v * v * (3 - 2 * v);
  const a = nhash(xi, yi), b = nhash(xi + 1, yi), c = nhash(xi, yi + 1), d = nhash(xi + 1, yi + 1);
  return a + (b - a) * su + (c - a) * sv + (a - b - c + d) * su * sv;
}
const fbm = (x, y) => { let v = 0, a = .5, f = 1; for (let o = 0; o < 4; o++) { v += a * vnoise(x * f, y * f); f *= 2; a *= .5; } return v; };
const smoothstep = (e0, e1, x) => { const t = clamp((x - e0) / (e1 - e0), 0, 1); return t * t * (3 - 2 * t); };

/* The full-moon surface, painted once per size and reused for every phase: soft seas with noise-warped edges,
   mottled highlands, ~160 small soft craters (mostly in the southern highlands), the bright rayed craters,
   and a gentle darkening toward the rim. */
let moonTex = null, moonMap = null, moonMapWait = true;
/* NASA's lunar surface map (assets/moon-map.js), fetched once the moon card comes near the screen and read into pixel data.
   Until it's in (moonMapWait), the big moon isn't painted at all, rather than spending a long moment painting the
   stand-in surface that would be replaced a split second later; the stand-in is only for when the map can't load. */
function loadMoonMap() {
  return new Promise(res => {
    const read = () => {
      if (!window.MOON_MAP) return res(null);
      const img = new Image();
      // decoded off the main thread; only the near side (the middle half of the map, longitudes −90° to 90°) is read
      const take = () => {
        const W = img.width, x0 = W / 4, cw = W / 2, c = document.createElement("canvas"); c.width = cw; c.height = img.height;
        const x = c.getContext("2d", { willReadFrequently: true }); x.drawImage(img, x0, 0, cw, img.height, 0, 0, cw, img.height);
        try { moonMap = { w: W, h: img.height, d: x.getImageData(0, 0, cw, img.height).data, x0, cw }; } catch { moonMap = null; }
        res(moonMap);
      };
      img.src = window.MOON_MAP;
      (img.decode ? img.decode() : new Promise((ok, no) => { img.onload = ok; img.onerror = no; })).then(take, () => res(null));
    };
    if (window.MOON_MAP) return read();
    const s = document.createElement("script"); s.src = "assets/moon-map.js"; s.onload = read; s.onerror = () => res(null);
    document.head.appendChild(s);
  });
}
/* The real near side: the map projected onto the disc as seen from Earth (orthographic, longitude 0 facing us),
   turned to soft grey with a faint cool tint and a touch of darkening toward the rim. */
function moonTextureReal(size) {
  const cv = document.createElement("canvas"); cv.width = cv.height = size;
  const c = cv.getContext("2d"), img = c.createImageData(size, size), p = img.data, { w, h, d, x0, cw } = moonMap;
  for (let py = 0; py < size; py++) for (let px = 0; px < size; px++) {
    const u = (px + .5) / size * 2 - 1, v = (py + .5) / size * 2 - 1, r2 = u * u + v * v, i = (py * size + px) * 4;
    if (r2 > 1) { p[i + 3] = 0; continue; }
    const lat = Math.asin(-v), cl = Math.cos(lat), lon = cl > 1e-6 ? Math.asin(clamp(u / cl, -1, 1)) : 0;
    const tx = clamp(Math.floor((lon / (2 * PI) + .5) * w) - x0, 0, cw - 1), ty = Math.min(h - 1, Math.floor((.5 - lat / PI) * h)), j = (ty * cw + tx) * 4;
    const lum = (d[j] * .3 + d[j + 1] * .59 + d[j + 2] * .11) / 255;
    const shade = clamp(lum * 1.3 + .15, 0, 1) * (.86 + .14 * Math.sqrt(1 - r2)); // slightly softened contrast keeps it calm
    p[i] = 248 * shade; p[i + 1] = 247 * shade; p[i + 2] = Math.min(255, 258 * shade);
    p[i + 3] = 255 * clamp((1 - Math.sqrt(r2)) * size / 2, 0, 1);
  }
  c.putImageData(img, 0, 0);
  return cv;
}
function moonTexture(size) {
  if (moonTex && moonTex.size === size) return moonTex.cv;
  if (moonMap) { moonTex = { size, cv: moonTextureReal(size) }; return moonTex.cv; }
  const cv = document.createElement("canvas"); cv.width = cv.height = size;
  const c = cv.getContext("2d"), img = c.createImageData(size, size), p = img.data, rnd = fxRand(77), craters = [];
  while (craters.length < 160) {
    const x = rnd() * 2 - 1, y = rnd() * 2 - 1;
    if (x * x + y * y > .92 || (y < .1 && rnd() < .55)) continue; // denser in the southern highlands
    craters.push([x, y, .008 + Math.pow(rnd(), 3) * .04, .03 + rnd() * .06]);
  }
  const rot = MARIA.map(([, , , , r]) => [cos(r), sin(r)]);
  for (let py = 0; py < size; py++) for (let px = 0; px < size; px++) {
    const u = (px + .5) / size * 2 - 1, v = (py + .5) / size * 2 - 1, r2 = u * u + v * v, i = (py * size + px) * 4;
    if (r2 > 1) { p[i + 3] = 0; continue; }
    const warp = (fbm(u * 2.4 + 11, v * 2.4 + 7) - .47) * 1.3 + (fbm(u * 7, v * 7 + 5) - .47) * .35;
    let mare = 0;
    MARIA.forEach(([x, y, rx, ry, , a], k) => {
      const [cs, sn] = rot[k], dx = u - x, dy = v - y, ex = (dx * cs + dy * sn) / rx, ey = (-dx * sn + dy * cs) / ry;
      mare = 1 - (1 - mare) * (1 - a * (1 - smoothstep(.35, 1.4, Math.sqrt(ex * ex + ey * ey) + warp))); // soft union: neighbouring seas flow together
    });
    mare *= .8 + (fbm(u * 5 + 2, v * 5 + 9) - .47) * .6; // patchy darkness within a sea
    let alb = .91 - mare * .27 + (fbm(u * 9, v * 9) - .47) * .07 + (fbm(u * 28 + 3, v * 28) - .47) * .05;
    for (const [x, y, cr, k] of craters) { const d2 = ((u - x) ** 2 + (v - y) ** 2) / (cr * cr); if (d2 < 6) alb -= k * Math.exp(-d2 * 1.4) * (1 - mare * .6); }
    BRIGHT.forEach(([x, y, cr, k], j) => {
      const dx = u - x, dy = v - y, d = Math.sqrt(dx * dx + dy * dy);
      alb += .12 * k * Math.exp(-(d * d) / (cr * cr) * 1.6);
      if (j === 0) alb += Math.pow(Math.abs(cos(Math.atan2(dy, dx) * 4.5 + .4)), 26) * Math.exp(-d * 2.4) * .06 * (d > cr ? 1 : 0);
    });
    const shade = clamp(alb, 0, 1) * (.8 + .2 * Math.sqrt(1 - r2));
    p[i] = 250 * shade; p[i + 1] = 249 * shade; p[i + 2] = Math.min(255, 262 * shade);
    p[i + 3] = 255 * clamp((1 - Math.sqrt(r2)) * size / 2, 0, 1);
  }
  c.putImageData(img, 0, 0);
  moonTex = { size, cv };
  return cv;
}
/* Matte moon: the painted surface shown only where the sun lights it, with a faint trace on the dark side (earthshine).
   South of the equator the moon appears upside down, so the whole face turns 180°. */
function drawBigMoon(cv, phase, south) {
  const s = sizeCanvas(cv); if (!s || moonMapWait) return;
  const { ctx, w } = s, cx = w / 2, cy = w / 2, r = w * .4, tex = moonTexture(Math.round(r * 2 * (cv.width / w)));
  ctx.save();
  if (south) { ctx.translate(cx, cy); ctx.rotate(PI); ctx.translate(-cx, -cy); } // the 180° turn also flips the lit side
  ctx.beginPath(); ctx.arc(cx, cy, r, 0, PI * 2); ctx.fillStyle = "rgba(190,195,255,.08)"; ctx.fill();
  ctx.globalAlpha = .07; ctx.drawImage(tex, cx - r, cy - r, r * 2, r * 2); ctx.globalAlpha = 1;
  ctx.drawImage(moonLit(tex, phase), cx - r, cy - r, r * 2, r * 2);
  ctx.restore();
}
/* The sunlit surface with a soft terminator, as the real moon shows it: the light fades out over the last few degrees of
   sun height (μ0, the cosine towards the sun, from .12 down to just past 0; the sun is a disc and the surface is rough),
   with a light touch of the Lommel-Seeliger shading of the regolith (2·μ0 / (μ0 + μ), 1 at full moon) towards the line. */
let moonLitCache = null;
function moonLit(tex, phase) {
  const key = `${tex.width}|${phase.toFixed(4)}`;
  if (moonLitCache && moonLitCache.key === key) return moonLitCache.cv;
  const n = tex.width, cv = moonLitCache && moonLitCache.cv.width === n ? moonLitCache.cv : document.createElement("canvas");
  cv.width = cv.height = n;
  const c = cv.getContext("2d"); c.clearRect(0, 0, n, n); c.drawImage(tex, 0, 0);
  const img = c.getImageData(0, 0, n, n), p = img.data, a = 2 * PI * phase, sx = sin(a), sz = -cos(a), h = n / 2;
  for (let y = 0, i = 3; y < n; y++) for (let x = 0; x < n; x++, i += 4) {
    const u = (x + .5 - h) / h, v = (y + .5 - h) / h, z2 = 1 - u * u - v * v; if (z2 <= 0) continue;
    const z = Math.sqrt(z2), m0 = u * sx + z * sz;
    if (m0 <= -.02) { p[i] = 0; continue; }
    const edge = smoothstep(-.02, .12, m0), ls = m0 > 0 ? Math.min(1, 2 * m0 / (m0 + z)) : 0;
    p[i] *= edge * (.82 + .18 * ls);
  }
  c.putImageData(img, 0, 0);
  moonLitCache = { key, cv };
  return cv;
}
/* A ruler of daily moons that scrolls under a fixed centre marker. `off` is the selected day relative to today (can be fractional). */
const stripStep = w => clamp(w / 23, 16, 26);
function drawStrip(cv, off, base, mirror) {
  const s = sizeCanvas(cv); if (!s) return;
  const { ctx, w, h } = s, step = stripStep(w), r = Math.min(step * .36, 8), mid = w / 2, cy = 16;
  const phaseOn = d => moonIllum(new Date(base.valueOf() + d * dayMs)).phase;
  ctx.font = "500 11px 'Isobar Digits', Geist, sans-serif"; ctx.textAlign = "center"; ctx.textBaseline = "alphabetic"; // 11 px, the smallest size on the type scale
  const d0 = Math.floor(off - mid / step) - 1, d1 = Math.ceil(off + mid / step) + 1;
  let prev = phaseOn(d0 - 1);
  const tags = [];
  for (let d = d0; d <= d1; d++) {
    const p = phaseOn(d), x = mid + (d - off) * step, a = clamp(1 - Math.pow(Math.abs(x - mid) / mid, 2) * .85, 0, 1);
    moonShape(ctx, x, cy, r, p, mirror, `rgba(255,255,255,${(.94 * a).toFixed(3)})`, `rgba(255,255,255,${(.14 * a).toFixed(3)})`);
    const tag = d === 0 ? "Today" : prev < .5 && p >= .5 ? "Full" : prev > .8 && p < .2 ? "New" : "";
    if (tag) tags.push({ tag, x, a, w: ctx.measureText(tag).width, first: d === 0 });
    prev = p;
  }
  // labels never overlap: "Today" goes first, a new or full moon right next to it gives way
  const placed = [];
  for (const t of tags.sort((m, n) => n.first - m.first)) {
    if (placed.some(o => Math.abs(o.x - t.x) < (o.w + t.w) / 2 + 6)) continue;
    placed.push(t); ctx.fillStyle = `rgba(255,255,255,${(.75 * t.a).toFixed(3)})`; ctx.fillText(t.tag, t.x, h - 4);
  }
  ctx.fillStyle = Palette.SIGNAL; ctx.beginPath(); ctx.roundRect ? ctx.roundRect(mid - 2, cy + r + 3, 4, 10, 2) : ctx.rect(mid - 2, cy + r + 3, 4, 10); ctx.fill(); // the capsule needle
}

/* ---------------- data ---------------- */
/* Every request gives up after 10 seconds (a hanging connection then shows a message instead of spinning forever),
   and can be called off with `signal` when something newer replaces it. */
async function getJSON(url, signal) {
  const c = new AbortController(), timer = setTimeout(() => c.abort(new DOMException("Timed out", "TimeoutError")), 10000);
  const stop = () => c.abort(signal.reason);
  if (signal) { if (signal.aborted) stop(); else signal.addEventListener("abort", stop, { once: true }); }
  try {
    const r = await fetch(url, { signal: c.signal });
    const j = await r.json().catch(() => null);
    if (!r.ok || !j || j.error) throw new Error((j && j.reason) || `Request failed (${r.status})`);
    return j;
  } catch (e) {
    if (c.signal.reason && c.signal.reason.name === "TimeoutError") throw new Error("the service took too long to answer");
    throw e;
  } finally { clearTimeout(timer); if (signal) signal.removeEventListener("abort", stop); }
}
const qs = o => Object.entries(o).map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join("&");
/* How sure the forecast is, per day: four independent models (European, American, Canadian, German) forecast the same
   days, and the more they disagree, the less certain the day. "high" when their highs lie within 2° and they agree on
   rain, "low" from 5° apart (or when some bring rain and others none), "medium" in between. Distance counts too: the
   further ahead the less anyone can know, even when the models happen to agree, so from 6 days out a day is never
   "high", and its softness (fz) grows with distance. Returns { "2026-10-14": { deg, fz, lead, conf } } with deg the
   models' spread in °C, or null. */
const SPREAD_MODELS = ["ecmwf_ifs025", "gfs_seamless", "gem_seamless", "icon_seamless"];
function confidence(u) {
  if (!u || !u.daily || !u.daily.time) return null;
  // Four models agreeing on one later day is often luck. Looking further ahead never makes a forecast surer, so the
  // uncertainty only holds or grows from day to day: a day is at least as unsure (and as fuzzy) as the one before it.
  const out = {}, d = u.daily;
  let was = 0, wasFz = 0;
  d.time.forEach((day, i) => {
    const hi = SPREAD_MODELS.map(m => (d[`temperature_2m_max_${m}`] || [])[i]).filter(v => v != null);
    const mm = SPREAD_MODELS.map(m => (d[`precipitation_sum_${m}`] || [])[i]).filter(v => v != null);
    if (hi.length < 2) return;
    const deg = Math.max(...hi) - Math.min(...hi), split = mm.some(v => v >= 1) && mm.some(v => v < .2);
    let tl = deg <= 2 ? 0 : deg <= 4.5 ? 1 : 2; // from the temperatures: carried on to the days after
    if (i >= 6) tl = Math.max(1, tl);
    tl = was = Math.max(tl, was);
    const level = split ? Math.min(2, tl + 1) : tl; // models split over rain: only this day is less sure
    const fz = wasFz = Math.max(deg, i * .45, wasFz);
    out[day] = { deg, fz, lead: i, n: hi.length, conf: ["high", "medium", "low"][level] };
  });
  return out;
}
function fetchAll(p, signal) {
  const w = getJSON("https://api.open-meteo.com/v1/forecast?" + qs({
    latitude: p.lat, longitude: p.lon, timezone: "auto", forecast_days: 14, past_days: 1,
    current: "temperature_2m,relative_humidity_2m,apparent_temperature,is_day,precipitation,weather_code,cloud_cover,pressure_msl,wind_speed_10m,wind_direction_10m,wind_gusts_10m,visibility,uv_index,dew_point_2m,snow_depth",
    minutely_15: "precipitation,snowfall", forecast_minutely_15: 24, past_minutely_15: 0,
    hourly: "temperature_2m,apparent_temperature,precipitation_probability,precipitation,snowfall,weather_code,wind_speed_10m,wind_gusts_10m,wind_direction_10m,uv_index,is_day,pressure_msl,visibility,cloud_cover,relative_humidity_2m,dew_point_2m",
    daily: "weather_code,temperature_2m_max,temperature_2m_min,apparent_temperature_max,apparent_temperature_min,sunrise,sunset,daylight_duration,sunshine_duration,uv_index_max,precipitation_sum,precipitation_probability_max,precipitation_hours,wind_speed_10m_max,wind_gusts_10m_max,wind_direction_10m_dominant",
    temperature_unit: S.temp === "f" ? "fahrenheit" : "celsius", wind_speed_unit: S.wind, precipitation_unit: S.precip, models: S.model
  }), signal);
  const a = getJSON("https://air-quality-api.open-meteo.com/v1/air-quality?" + qs({
    latitude: p.lat, longitude: p.lon, timezone: "auto", forecast_days: 2,
    current: "european_aqi,us_aqi,pm10,pm2_5,nitrogen_dioxide,ozone,sulphur_dioxide,dust,alder_pollen,birch_pollen,grass_pollen,mugwort_pollen,olive_pollen,ragweed_pollen",
    hourly: "european_aqi"
  }), signal).catch(() => null);
  // the same days from four independent models, to see how much they agree (see confidence())
  const u = getJSON("https://api.open-meteo.com/v1/forecast?" + qs({
    latitude: p.lat, longitude: p.lon, timezone: "auto", forecast_days: 14, daily: "temperature_2m_max,precipitation_sum", models: SPREAD_MODELS.join(",")
  }), signal).catch(() => null);
  return [w, a, u]; // promises: the forecast comes first and is drawn at once, air and model spread fill in after
}
async function geocode(q) {
  const j = await getJSON("https://geocoding-api.open-meteo.com/v1/search?" + qs({ name: q, count: 8, language: "en", format: "json" }));
  return (j.results || []).map(r => ({ name: r.name, sub: [r.admin1, r.country].filter(Boolean).join(", "), lat: +r.latitude.toFixed(4), lon: +r.longitude.toFixed(4) }));
}
async function reverse(lat, lon) {
  let name = `${lat.toFixed(2)}°, ${lon.toFixed(2)}°`, sub = "";
  try {
    const r = await getJSON(`https://api.bigdatacloud.net/data/reverse-geocode-client?latitude=${lat}&longitude=${lon}&localityLanguage=en`);
    name = r.city || r.locality || name; sub = [r.principalSubdivision, r.countryName].filter(Boolean).join(", ");
  } catch {}
  return { name, sub, lat: +lat.toFixed(4), lon: +lon.toFixed(4), gps: true };
}
function geolocate(maxAge = 600000) { // maxAge: how old a known position may be, in ms
  return new Promise((res, rej) => {
    if (!navigator.geolocation) return rej(new Error("This browser can't share its location. Search for a place instead."));
    navigator.geolocation.getCurrentPosition(p => { store.set("locOK", true); res(p.coords); },
      e => { if (e.code === 1) store.set("locOK", false); rej(new Error(e.code === 1 ? "Location access is blocked. Allow it in your browser, or search for a place." : "Couldn't get your location. Search for a place instead.")); },
      { timeout: 12000, maximumAge: maxAge });
  });
}
async function guessPlace() {
  try { const c = await geolocate(); return await reverse(c.latitude, c.longitude); } catch {}
  try {
    const city = (Intl.DateTimeFormat().resolvedOptions().timeZone || "").split("/").pop().replace(/_/g, " ");
    if (city) { const r = await geocode(city); if (r[0]) return r[0]; }
  } catch {}
  return { name: "Brussels", sub: "Brussels Capital, Belgium", lat: 50.8505, lon: 4.3488 };
}

/* ---------------- render helpers ---------------- */
/* A line made of parts ("Flanders, Belgium · Tue 13 Oct") breaks only between its parts: each part moves to the next
   line whole, the "·" or comma staying with the part before it. A part wider than the whole line still wraps inside. */
const wholeParts = list => list.map(x => `<span class="part">${esc(x)}</span>`).join(" ");
const head = (t, s) => `<header class="ch"><h3>${esc(t)}</h3><p>${esc(s)}</p></header>`;
/* A card's title and subtitle are always one line (rule 8): when one doesn't fit (a narrow phone), it shrinks a little
   until it does, down to 13 px. Run after the cards are drawn and when the window changes size. */
/* Wider than a phone, each card's readings and pictures grow with the card: --k is its width over 180 px (a phone's half-width card, what the content was made for), from 1 to
   1.35 (styles.css uses it from 601 px up). Phones and the wall view keep 1, exactly as they were designed. */
if ("ResizeObserver" in window) {
  const ro = new ResizeObserver(es => { for (const e of es) { const el = e.target, k = innerWidth > 600 && !document.documentElement.classList.contains("wall") ? clamp(el.offsetWidth / 180, 1, 1.35) : 1; el.style.setProperty("--k", k.toFixed(3)); } });
  document.querySelectorAll("#board > .card").forEach(c => ro.observe(c));
}
function fitHeads() {
  for (const p of document.querySelectorAll(".card .ch h3, .card .ch p")) {
    p.style.fontSize = "";
    if (p.scrollWidth > p.clientWidth + 1) p.style.fontSize = `${Math.max(13, parseFloat(getComputedStyle(p).fontSize) * p.clientWidth / p.scrollWidth - .3).toFixed(1)}px`;
  }
  // a card's foot is one line too (rule 8) and never breaks a phrase (9a): on a narrow card it shrinks a little, down to
  // 11 px; a foot that still doesn't fit falls back to its short form (data-short), such as the wind's "N · gusts 9 km/h"
  const fit = f => {
    f.style.fontSize = "";
    if (f.scrollWidth <= f.clientWidth + 1) return true;
    f.style.fontSize = `${Math.max(11, 13 * f.clientWidth / f.scrollWidth - .3).toFixed(1)}px`;
    return f.scrollWidth <= f.clientWidth + 1;
  };
  for (const f of document.querySelectorAll(".card .foot")) {
    for (const s of f.querySelectorAll("[data-full]")) { s.innerHTML = s.dataset.full; delete s.dataset.full; }
    if (!f.clientWidth || fit(f)) continue;
    const short = f.querySelectorAll("[data-short]");
    if (short.length) { for (const s of short) { s.dataset.full = s.innerHTML; s.innerHTML = s.dataset.short; } fit(f); }
  }
}
const tile = (k, v) => `<div class="tile"><span class="mono">${k}</span><b>${v}</b></div>`;
const card = id => document.getElementById(id);
let X = {};
/* A forecast kept from earlier (offline, or the app reopened later) still describes "now" as it was back then.
   Move "now" up to the present hour, taken from the hourly forecast. */
function rollForward() {
  const c = D.current, H = D.hourly;
  const key = new Date(Date.now() + OFF * 1000).toISOString().slice(0, 13) + ":00";
  if (!c || c.time >= key) return;
  const h = H.time.indexOf(key); if (h < 0) return;
  const next = { ...c, time: key };
  for (const k of ["temperature_2m", "apparent_temperature", "weather_code", "wind_speed_10m", "wind_gusts_10m", "wind_direction_10m", "uv_index", "is_day", "pressure_msl", "visibility", "cloud_cover", "precipitation", "relative_humidity_2m", "dew_point_2m"])
    if (H[k] && H[k][h] != null) next[k] = H[k][h];
  D.current = next;
}
function derive() {
  rollForward();
  const c = D.current, H = D.hourly, Dy = D.daily;
  let hi = H.time.indexOf(c.time.slice(0, 13) + ":00"); if (hi < 0) hi = 0;
  let di = Dy.time.indexOf(c.time.slice(0, 10)); if (di < 0) di = 0;
  // Open-Meteo gives an hour's rain, snowfall, chance of rain and gusts for the hour BEFORE its time ("13:00" = 12–13).
  // Everything here reads an hour as the one that starts at its time, so those four move one step back, onto the hour
  // they describe; temperature, sky and the rest are the moment itself and stay. (The quarter hours: see nowcast.)
  const lead = a => a ? [...a.slice(1), null] : a;
  const Hs = { ...H, precipitation: lead(H.precipitation), precipitation_probability: lead(H.precipitation_probability), snowfall: lead(H.snowfall), wind_gusts_10m: lead(H.wind_gusts_10m) };
  X = { c, H: Hs, Dy, hi, di, lat: D.latitude, lon: D.longitude, todayKey: Dy.time[di], kind: wmo(c.weather_code)[1], isDay: !!c.is_day };
  // one answer to "is it raining now": the quarter-hour timeline (as on the precipitation card and the arc), so the
  // main card, the top bar and the hours' "Now" never say clear while the card below says rain, or the other way round
  X.nc = nowcast();
  const w = weatherAt(Date.now(), c.weather_code, c.cloud_cover);
  X.c = { ...c, weather_code: w.code, precipitation: w.q < 0 ? c.precipitation : w.wet ? X.nc.vals[w.q] : 0 }; X.kind = wmo(w.code)[1];
}
/* A rain code without any rain to back it shows the sky instead, by its cloud cover, in the cloud card's own steps
   (clear to 12%, few clouds to 37%, scattered to 62%, then overcast), so it never says overcast under a clear sky. */
const dryCode = cloud => cloud == null ? 3 : cloud <= 12 ? 0 : cloud <= 37 ? 1 : cloud <= 62 ? 2 : 3;
/* Drizzle and rain are named by how much falls (mm in an hour), with the precipitation card's own steps: light under
   2.5, moderate to 7.6, heavy above. So an icon, a label and the card never call the same rain three different things
   (the models' own drizzle codes could make a day with 8 mm "drizzle"). Showers, freezing rain and snow keep theirs. */
const normRain = (code, mmh) => [51, 53, 55, 61, 63, 65].includes(code) && mmh != null && mmh > 0 ? (mmh < 2.5 ? 61 : mmh < 7.6 ? 63 : 65) : code;
/* Which quarter hour of the timeline holds moment t (-1 outside the next six hours). */
const quarterAt = t => X.nc ? X.nc.times.findIndex(x => x.valueOf() <= t && t < x.valueOf() + 9e5) : -1;
/* The weather at moment t, given the hourly forecast's code for it. Within the next six hours whether anything falls
   comes from the quarter-hour timeline: a dry code with rain in that quarter becomes rain (or snow) as heavy as it is,
   and a rain code with none becomes the sky its cloud cover gives (dryCode), as an hour's icon does without an
   amount. q: the quarter (-1 outside the timeline), wet: whether anything falls in it. Thunder stays thunder. */
function weatherAt(t, code, cloud, mmh) {
  const q = quarterAt(t); if (q < 0) return { code: normRain(code, mmh), q, wet: null };
  const nc = X.nc, r = nc.rate[q], wet = r >= nc.thr, snowy = (nc.snow[q] ?? 0) > 0, falls = code >= 51 && code < 95;
  if (wet && !falls && code < 95) code = snowy ? (r < 1 ? 71 : r < 4 ? 73 : 75) : r < 2.5 ? 61 : r < 7.6 ? 63 : 65; // the precipitation card's Light/Moderate/Heavy
  else if (!wet && falls) code = dryCode(cloud);
  else if (wet) code = normRain(code, r);
  return { code, q, wet };
}

/* ---------------- one-glance summary ---------------- */
/* One or two plain sentences: what the next 12 hours do, then the one thing most worth knowing after that. */
function renderSummary() {
  const { H, hi, Dy, di, c } = X, end = Math.min(H.time.length, hi + 12);
  const kindAt = k => wmo(H.weather_code[k])[1];
  const PRECIP = ["rain", "drizzle", "snow", "sleet", "thunder"];
  const mmh = k => toMm(H.precipitation[k] ?? 0);
  // within the next six hours the quarter-hour timeline decides (the same one the precipitation card shows); later on, the hourly
  const nc = nowcast(), ncWet = k => { const t0 = T(H.time[k]).valueOf(), t1 = t0 + 36e5; if (!nc.times.length || t1 > nc.end) return null; return nc.times.some((t, i) => t >= t0 && t < t1 && nc.rate[i] >= nc.thr); };
  const wet = k => ncWet(k) ?? (mmh(k) >= .2 || ((H.precipitation_probability[k] ?? 0) >= 60 && PRECIP.includes(kindAt(k))));
  const at = k => fmtTD(T(H.time[k]));
  // what falls during a wet spell, named after its wettest hour
  const what = (a, b) => {
    let peak = a; for (let k = a; k < b; k++) if (mmh(k) > mmh(peak)) peak = k;
    const kind = kindAt(peak), r = mmh(peak), any = [];
    for (let k = a; k < b; k++) any.push(kindAt(k));
    if (any.includes("thunder")) return "thunderstorms";
    // named by the amount with the precipitation card's steps (normRain), never "drizzle" for a wet spell
    const base = kind === "snow" || any.includes("snow") ? "snow" : kind === "sleet" ? "sleet" : "rain";
    return base === "sleet" ? base : (r < 2.5 ? "light " : r >= 7.6 ? "heavy " : "") + base;
  };
  const cap = s => s[0].toUpperCase() + s.slice(1);
  let first;
  const wetNow = nc.times.length ? nc.rate[0] >= nc.thr : wet(hi) || (c.precipitation ?? 0) > 0;
  // within the next six hours the sentence speaks to the quarter hour and in the precipitation card's own words
  // (light / heavy by its rate, snow when most of it is snow), so the two never disagree about when or what
  const shower = w => w.replace(/^(light |heavy )?rain$/, m => m.startsWith("heavy") ? "a heavy shower" : m.startsWith("light") ? "a light shower" : "a shower");
  const qWhat = (a, b) => {
    let pk = 0, sn = 0, storm = false;
    for (let i = a; i < b; i++) { pk = Math.max(pk, nc.rate[i]); if ((nc.snow[i] ?? 0) > 0) sn++; const k = H.time.findIndex(s => T(s) > nc.times[i]) - 1; if (k >= 0 && kindAt(k) === "thunder") storm = true; }
    return storm ? "thunderstorms" : (pk < 2.5 ? "light " : pk >= 7.6 ? "heavy " : "") + (sn * 2 >= b - a ? "snow" : "rain");
  };
  let ncFirst = null;
  if (nc.times.length) {
    const n = nc.rate.length, wq = i => nc.rate[i] >= nc.thr, qT = i => fmtTD(nc.times[i]);
    if (wetNow) { const i = nc.rate.findIndex(v => v < nc.thr); if (i > 0) ncFirst = `${cap(qWhat(0, i))} until ${qT(i)}, then dry.`; }
    else {
      const i = nc.rate.findIndex(v => v >= nc.thr);
      if (i >= 0) { let j = i; while (j < n && wq(j)) j++; ncFirst = j < n && j - i <= 8 ? `Dry, with ${shower(qWhat(i, j))} around ${qT(i)}.` : `Dry until ${qT(i)}, then ${qWhat(i, j)}.`; }
    }
  }
  if (ncFirst) first = ncFirst;
  else if (wetNow) {
    let stop = hi; while (stop < end && wet(stop)) stop++;
    first = stop < end ? `${cap(what(hi, stop))} until ${at(stop)}, then dry.` : `${cap(what(hi, end))} on and off for the next 12 hours.`;
  } else {
    let start = hi; while (start < end && !wet(start)) start++;
    if (start < end) {
      let stop = start; while (stop < end && wet(stop)) stop++;
      first = stop - start <= 2 ? `Dry, with ${shower(what(start, stop))} around ${at(start)}.`
        : `Dry until ${at(start)}, then ${what(start, stop)}.`;
    } else {
      // no rain: describe the sky, or the fog if it hangs around
      let fog = 0, cc = 0, day = 0, n = 0;
      for (let k = hi; k < end; k++) { if (kindAt(k) === "fog") fog++; cc += H.cloud_cover[k] ?? 50; day += H.is_day[k] ? 1 : 0; n++; }
      cc /= n || 1;
      if (fog >= 3 && kindAt(hi) === "fog") { let f = hi; while (f < end && kindAt(f) === "fog") f++; first = f < end ? `Foggy until ${at(f)}, then dry.` : "Foggy and dry."; }
      else if (day >= n / 2) first = cc < 30 ? "Dry and sunny." : cc < 70 ? "Dry, with some sun." : "Dry but cloudy.";
      else first = cc < 30 ? "Clear and dry tonight." : "Dry, with a cloudy night.";
    }
  }
  // the second sentence: the most useful thing after that
  const tc = v => toC(v), wu = WU[S.wind];
  let gust = 0, gk = hi; for (let k = hi; k < end; k++) if ((H.wind_gusts_10m[k] ?? 0) > gust) { gust = H.wind_gusts_10m[k]; gk = k; }
  const tonightMin = Dy.temperature_2m_min[di + 1] ?? Dy.temperature_2m_min[di];
  const dTomorrow = Dy.temperature_2m_max[di + 1] != null ? tc(Dy.temperature_2m_max[di + 1]) - tc(Dy.temperature_2m_max[di]) : 0;
  const localHour = +new Intl.DateTimeFormat("en-GB", { hour: "numeric", hourCycle: "h23", timeZone: TZ }).format(new Date());
  let second = "";
  if (toMs(gust) * 3.6 >= 60) second = `Gusts up to ${R(gust)} ${wu} around ${at(gk)}.`;
  else if (tc(tonightMin) <= 0 && tc(c.temperature_2m) > 0 && localHour >= 12) second = `Frost tonight, down to ${R(tonightMin)}°.`;
  else if (Math.abs(dTomorrow) >= 3) second = `${dTomorrow > 0 ? "Warmer" : "Colder"} tomorrow, up to ${R(Dy.temperature_2m_max[di + 1])}°.`;
  else if (localHour < 14 && tc(Dy.temperature_2m_max[di]) - tc(c.temperature_2m) >= 2) second = `Up to ${R(Dy.temperature_2m_max[di])}° this afternoon.`;
  else if (Dy.temperature_2m_max[di + 1] != null) second = (Dy.precipitation_probability_max[di + 1] ?? 0) >= 60 && !wetNow ? "Rain likely tomorrow." : `Similar tomorrow, around ${R(Dy.temperature_2m_max[di + 1])}°.`;
  // At most one short heads-up, only when it matters, from the hours ahead: the first that applies, in this order of
  // risk. Thresholds: ice when rain or drizzle falls at 1 °C or less (or freezing rain is forecast), fog under 1 km of
  // visibility, heat when it feels 32 °C or more ("extreme caution" on the heat index), UV 6 and up ("high", WHO), feels
  // like −10 °C or less, air quality "poor" (European AQI 60+). It replaces the gentle second sentence ("Similar
  // tomorrow…"), never a wind, frost or temperature-change one, so the line stays a glance.
  const today = k => H.time[k].startsWith(X.todayKey);
  const visKm = v => v == null ? 99 : (D.current_units && D.current_units.visibility) === "ft" ? v * 0.0003048 : v / 1000;
  let tip = "";
  const ks = []; for (let k = hi; k < end; k++) ks.push(k);
  if (ks.some(k => [56, 57, 66, 67].includes(H.weather_code[k]) || ((wet(k) || kindAt(k) === "snow") && tc(H.temperature_2m[k]) <= 1))) tip = "Roads may be slippery.";
  else if (!/^Foggy/.test(first) && ks.some(k => visKm(H.visibility[k]) < 1)) tip = "Watch for fog on the roads.";
  else if (ks.some(k => today(k) && tc(H.apparent_temperature[k]) >= 32)) tip = "Stay cool and drink water.";
  else if (ks.some(k => today(k) && (H.uv_index[k] ?? 0) >= 6)) tip = "Wear sun protection.";
  else if (ks.some(k => tc(H.apparent_temperature[k]) <= -10)) tip = "Dress warmly.";
  else if ((AQ && AQ.current && AQ.current.european_aqi) >= 60) tip = "Poor air: go easy outdoors.";
  if (tip && /^(Similar tomorrow|Up to |Rain likely tomorrow)/.test(second)) second = "";
  // written only when it changes: the line is read out by screen readers, which should not hear it again every refresh
  const txt = `${first} ${second} ${tip}`.replace(/\s+/g, " ").trim(), sm = $("#summary"); if (sm.textContent !== txt) sm.textContent = txt;
}

/* ---------------- weather-reactive effects ---------------- */
const calmMotion = matchMedia("(prefers-reduced-motion: reduce)");
const fxRand = seed => () => (seed = (seed * 9301 + 49297) % 233280) / 233280;

/* Falling rain or snow streaks, shared by the day cards and the main card. */
/* How far falling rain and snow lean with the wind, in degrees from straight down: positive drifts to the right (a
   wind blowing east), negative to the left. Only the wind's east-west part leans it (as the wind lines show), by its
   speed: about 3° in a breeze up to 28° in a gale. Without wind data, the old fixed lean to the left. */
const fallLean = (dir, kmh) => dir == null || kmh == null ? -14 : -sin(dir * rad) * clamp(3 + kmh * .45, 3, 28);
function fallDrops(seedN, kind, count, strength, lean = -14) {
  const rnd = fxRand(seedN * 7919 + 17);
  const [t0, tv] = { snow: [5, 5], hail: [.5, .25], drizzle: [1.1, .6], thunder: [.5, .3] }[kind] || [.75, .5]; // seconds to fall: snow drifts, hail and storm rain drop hard
  let drops = "";
  for (let k = 0; k < count; k++) {
    const t = t0 + rnd() * tv;
    drops += `<i style="--x:${(rnd() * 110).toFixed(1)}%;--y:${Math.round(rnd() * 90)}%;--l:${Math.round(10 + rnd() * 12)}px;--t:${t.toFixed(2)}s;--w:${(-rnd() * t).toFixed(2)}s;--o:${((.3 + rnd() * .5) * strength).toFixed(2)}"></i>`;
  }
  // the lean as the drift over the 520 px fall (--dx) and the matching tilt of each streak (--rot)
  return `<span class="fx${{ snow: " snow", hail: " hail", drizzle: " drizzle", thunder: " storm" }[kind] || ""}" aria-hidden="true" style="--dx:${(520 * Math.tan(lean * rad)).toFixed(0)}px;--rot:${(-lean).toFixed(1)}deg">${drops}</span>`;
}

/* Wind lines: a few long, soft lines that ripple across the card and lift at the end in a small open flick, a quiet nod
   to the classic wind symbol without its busy loops.
   They always travel across the card, never straight down (that reads as rain): left to right or right to left by the
   wind's east-west lean, tilted a little by its north-south part. The compass marker gives the exact direction.
   `n` lines, each crossing in about `dur` seconds at opacity `o`. */
function windLines(dir, n, dur, o, seed) {
  if (n <= 0) return "";
  const rnd = fxRand(seed), toEast = sin(dir * rad) < 0, tilt = clamp(cos(dir * rad) * 9, -9, 9) * (toEast ? 1 : -1);
  let out = "";
  for (let i = 0; i < n; i++) {
    const y = 14 + (i + rnd() * .8) * (172 / n), a = 4 + rnd() * 5, end = 140 + rnd() * 45, t = dur * (.8 + rnd() * .45);
    // the flick: one open curve that leaves the line in its own direction, up or down, never a loop
    const up = rnd() < .5 ? -1 : 1, Y = v => (v * up).toFixed(0);
    const flick = `c7 0 12 ${Y(-2)} 15 ${Y(-7)}`;
    out += `<path pathLength="400" d="M-70 ${y.toFixed(1)} C-20 ${(y - a).toFixed(1)} 20 ${(y + a).toFixed(1)} ${(end - 90).toFixed(0)} ${y.toFixed(1)} S${(end - 20).toFixed(0)} ${(y - a * .6).toFixed(1)} ${end.toFixed(0)} ${y.toFixed(1)} ${flick}" style="--t:${t.toFixed(2)}s;--w:${(-rnd() * t).toFixed(2)}s;--o:${(o * (.7 + rnd() * .3)).toFixed(2)}"/>`;
  }
  return `<svg class="wlines" viewBox="0 0 200 200" preserveAspectRatio="none" aria-hidden="true"><g transform="rotate(${tilt.toFixed(1)} 100 100)${toEast ? "" : " translate(200 0) scale(-1 1)"}">${out}</g></svg>`;
}

/* The wind card: calm air stays still; a breeze gets two slow, faint lines; stronger wind brings more, faster and
   brighter ones. When gusts run well above the average wind, two quick extra lines blow through. */
function windFlow(dir, kmh, gustKmh) {
  if (kmh < 2) return "";
  // seconds per crossing: a lazy drift in a light breeze (about 6 s at 5 km/h), brisk in a gale (about 1 s at 60 km/h)
  const n = Math.round(clamp(2 + kmh / 9, 2, 7)), dur = clamp(9 / (1 + kmh / 8), .7, 7), o = clamp(.35 + kmh / 60, .35, .9);
  return windLines(dir, n, dur, o, Math.round(dir) + 7) + (gustKmh - kmh >= 15 ? windLines(dir, 2, dur * .55, .5, Math.round(dir) + 11) : "");
}

/* The main card in a wind storm (gusts from `from` km/h): more and faster lines the stronger the gusts. */
function gustStreaks(dir, gKmh, from) {
  if (gKmh < from) return "";
  return windLines(dir, Math.round(clamp(4 + (gKmh - from) / 8, 4, 9)), clamp(9 / (1 + gKmh / 8), .6, 2), .6, Math.round(dir) + 3);
}

/* Soft fog banks lying low and wide across the main card. */
function mistLayer(seed, type) {
  const rnd = fxRand(seed), P = {
    fog: { n: 5, w: [90, 60], h: [14, 10], y: [28, 66], o: [.32, .16], b: 22, t: [20, 14] }
  }[type];
  let out = "";
  for (let i = 0; i < P.n; i++) {
    const r = k => P[k][0] + rnd() * P[k][1];
    out += `<i style="--x:${(rnd() * 70 - 15).toFixed(0)}%;--y:${r("y").toFixed(0)}%;--w:${r("w").toFixed(0)}%;--h:${r("h").toFixed(0)}%;--o:${r("o").toFixed(2)};--b:${P.b}px;--t:${r("t").toFixed(0)}s;--dl:${(-rnd() * 20).toFixed(0)}s"></i>`;
  }
  return `<span class="mist" aria-hidden="true">${out}</span>`;
}

/* Puffy clouds for the main card. The count follows cloud cover (a mostly clear sky gets one or two), they drift
   faster in stronger wind, sit greyer in rain, dimmer at night, and overcast skies add a dull grey wash on top. */
function cloudLayer(seed, cover, { night = false, wet = false, windKmh = 10 } = {}) {
  if (cover < 12) return "";
  const rnd = fxRand(seed), n = clamp(Math.round(cover / 17), 1, 6);
  const cc = wet ? "#c9cbe2" : night ? "#c7cdf0" : "#ffffff", base = night ? .2 : wet ? .42 : .48;
  const puffs = [[4, 46, 92, 46], [14, 22, 40, 70], [38, 6, 42, 82], [62, 26, 34, 62], [76, 44, 22, 44]];
  let out = cover >= 85 ? `<span class="overcast-sky"></span>` : "";
  for (let i = 0; i < n; i++) {
    const t = (130 - clamp(windKmh, 0, 70)) * (.8 + rnd() * .5);
    const shape = puffs.map(([l, tp, w, h]) => `<i style="left:${l + (rnd() - .5) * 6}%;top:${tp + (rnd() - .5) * 8}%;width:${w * (.85 + rnd() * .3)}%;height:${h}%"></i>`).join("");
    out += `<span class="cloud" style="--w:${(32 + rnd() * 30).toFixed(0)}%;--y:${(-4 + rnd() * 44).toFixed(0)}%;--o:${(base * (.7 + rnd() * .5)).toFixed(2)};--b:${(4 + rnd() * 4).toFixed(1)}px;--t:${t.toFixed(0)}s;--d:${(-rnd() * t).toFixed(0)}s;--cc:${cc}">${shape}</span>`;
  }
  return `<span class="clouds" aria-hidden="true">${out}</span>`;
}

/* Three jagged lightning bolts that take turns lighting up with the storm flash. */
function bolts(seed) {
  const rnd = fxRand(seed); let out = "";
  for (let i = 0; i < 3; i++) {
    let x = 32, y = 0, d = `M${x} 0`, fork = "";
    while (y < 100) {
      y = Math.min(100, y + 7 + rnd() * 9); x = clamp(x + (rnd() - .5) * 20, 6, 58); d += ` L${x.toFixed(1)} ${y.toFixed(1)}`;
      if (!fork && y > 35 && rnd() < .35) fork = `M${x.toFixed(1)} ${y.toFixed(1)} l${((rnd() - .5) * 26).toFixed(1)} ${(10 + rnd() * 14).toFixed(1)} l${((rnd() - .5) * 10).toFixed(1)} ${(6 + rnd() * 8).toFixed(1)}`;
    }
    out += `<svg class="bolt" viewBox="0 0 64 100" preserveAspectRatio="none" aria-hidden="true" style="left:${(8 + rnd() * 70).toFixed(0)}%;--d:${i * 9}s"><path d="${d}" fill="none" stroke="#fff" stroke-width="1.8" stroke-linejoin="round" vector-effect="non-scaling-stroke"/>${fork ? `<path d="${fork}" fill="none" stroke="#fff" stroke-width="1" vector-effect="non-scaling-stroke"/>` : ""}</svg>`;
  }
  return out;
}

/* A sparse, fixed sky of tiny twinkling dots; `avoid(x, y)` keeps them off things like the moon or a big number. */
function starField(seed, count, avoid) {
  const rnd = fxRand(seed); let out = "", n = 0;
  for (let tries = 0; tries < count * 4 && n < count; tries++) {
    const x = rnd() * 100, y = rnd() * 100;
    if (avoid && avoid(x, y)) continue;
    const s = rnd() < .2 ? 2 : rnd() < .6 ? 1.5 : 1; n++;
    out += `<i style="left:${x.toFixed(1)}%;top:${y.toFixed(1)}%;--s:${s}px;--o:${(.35 + rnd() * .45).toFixed(2)};--t:${(3 + rnd() * 5).toFixed(1)}s;--w:${(-rnd() * 8).toFixed(1)}s"></i>`;
  }
  return `<span class="stars" aria-hidden="true">${out}</span>`;
}

/* Heat haze. One shimmer per card (UV, main card), sharing a single animation loop. Strength 0 switches a card off.
   Phones draw SVG filters on the processor, so the costly part stays small: only the arc (or gauge) is distorted, and
   its noise is moved 15 times a second, not 60. The card itself gets soft rising bands of warm air, a layer the
   graphics chip moves for free. */
const HAZE = { uv: 0, hero: 0 };
let hazeRAF = 0;
function setHaze(which, scale) {
  const el = card(which === "uv" ? "c-uv" : "c-hero"), on = scale > 0 && !calmMotion.matches;
  HAZE[which] = on ? scale : 0;
  el.classList.toggle("hot", on);
  let heat = el.querySelector(":scope > .heat");
  if (on && !heat) { heat = document.createElement("span"); heat.className = "heat"; heat.setAttribute("aria-hidden", "true"); el.prepend(heat); }
  if (heat) { if (on) heat.style.setProperty("--heat", (scale / 14 * .4).toFixed(2)); else heat.remove(); }
  if (on) document.getElementById(`hazeMap-${which}`).setAttribute("scale", scale);
  if (on && which === "hero") document.getElementById("hazeMap-text").setAttribute("scale", (scale * .4).toFixed(1)); // the number and its lines: gentler, so they stay readable
  cancelAnimationFrame(hazeRAF);
  if (!HAZE.uv && !HAZE.hero) return;
  const t0 = performance.now(), noise = { uv: document.getElementById("hazeNoise-uv"), hero: document.getElementById("hazeNoise-hero") }, noiseText = document.getElementById("hazeNoise-text");
  let last = 0;
  const tick = now => {
    hazeRAF = requestAnimationFrame(tick);
    if (now - last < 66) return; last = now;
    const k = (now - t0) / 1000;
    for (const [id, ph] of [["uv", 0], ["hero", 2.1]]) if (HAZE[id] && !offscreen(id === "uv" ? "c-uv" : "c-hero")) {
      const f = `${(.006 + .002 * sin(k * .6 + 1 + ph)).toFixed(4)} ${(.05 + .012 * sin(k * .9 + ph)).toFixed(4)}`;
      noise[id].setAttribute("baseFrequency", f);
      if (id === "hero") noiseText.setAttribute("baseFrequency", f); // in step with the arc
    }
  };
  hazeRAF = requestAnimationFrame(tick);
}

/* A well-mixed random generator (mulberry32) for the fine-grained textures. The simple one above is fine for placing
   a few dozen things, but its consecutive values are correlated, so thousands of grains line up into a woven lattice. */
const prng = seed => () => { seed = (seed + 0x6D2B79F5) | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
/* Smooth value noise (0–1) on a `cell`-pixel grid, for uneven, natural-looking patches. */
function patchNoise(rnd, cell) {
  const g = new Map(), v = (i, j) => { const k = i + "," + j; if (!g.has(k)) g.set(k, rnd()); return g.get(k); }, s = t => t * t * (3 - 2 * t);
  return (x, y) => {
    const i = Math.floor(x / cell), j = Math.floor(y / cell), u = s(x / cell - i), q = s(y / cell - j);
    const a = v(i, j), b = v(i + 1, j), c = v(i, j + 1), d = v(i + 1, j + 1);
    return a + (b - a) * u + (c - a) * q + (a - b - c + d) * u * q;
  };
}
/* Frosted rim: frost creeping in from the card's edges in uneven patches. A soft matte haze gives the frosted-glass
   look; over it, fine ice needles and grains catch the light, densest at the rim and thinning toward the middle.
   Drawn once; a few glints twinkle on top in CSS. */
let frostRAF = 0;
function frostRim(cv, seed = 17, creep = false) {
  cancelAnimationFrame(frostRAF);
  const s = sizeCanvas(cv); if (!s) return;
  const { ctx, w, h } = s, dpr = cv.width / w, rnd = prng(seed), patch = patchNoise(prng(seed + 7), 54), reach = Math.min(w, h) * .34;
  const edge = (side, u, d) => side === 0 ? [u * w, d] : side === 1 ? [w - d, u * h] : side === 2 ? [u * w, h - d] : [d, u * h];
  // how far the frost creeps in varies along the edge (big, slow swells plus finer wobble), so its inner edge is
  // ragged and uneven rather than a neat shape
  const big = patchNoise(prng(seed + 3), 80), fine = patchNoise(prng(seed + 5), 24);
  const reachAt = (x, y) => reach * (.7 + .95 * big(x, y) + .3 * fine(x, y));
  const frostAt = (x, y) => clamp(1 - Math.min(x, y, w - x, h - y) / reachAt(x, y), 0, 1);
  // matte frost, worked out on a coarse grid and scaled up smoothly (soft and cheap); K holds how deep in the frost each cell is
  const sc = 4, lw = Math.ceil(w / sc) + 1, lh = Math.ceil(h / sc) + 1, low = document.createElement("canvas");
  low.width = lw; low.height = lh;
  const lc = low.getContext("2d"), im = lc.createImageData(lw, lh), K = new Float32Array(lw * lh);
  for (let j = 0; j < lh; j++) for (let i = 0; i < lw; i++) {
    const n = j * lw + i; K[n] = frostAt(i * sc, j * sc);
    im.data[n * 4] = 232; im.data[n * 4 + 1] = 243; im.data[n * 4 + 2] = 255;
  }
  // crystals: short needles at random angles and fine grains, densest where the frost is thickest; sorted from the rim
  // inward so they can appear in the order the frost reaches them
  const xs = [];
  for (let i = 0; i < (w + h) * 16; i++) {
    const d = Math.pow(rnd(), 1.5) * reach * 1.9, [x, y] = edge(Math.floor(rnd() * 4), rnd(), d), f = frostAt(x, y);
    const k = f * (.4 + .6 * patch(x, y));
    if (rnd() > k) continue;
    const a = ((.1 + .4 * rnd()) * k).toFixed(3);
    xs.push(rnd() < .6 ? { f, x, y, a, ang: rnd() * PI, len: .7 + rnd() * 2.4, lw: .45 + rnd() * .45 } : { f, x, y, a, r: .3 + rnd() * .5 });
  }
  xs.sort((p, q) => q.f - p.f);
  const cr = document.createElement("canvas"); cr.width = cv.width; cr.height = cv.height;
  const cc = cr.getContext("2d"); cc.setTransform(dpr, 0, 0, dpr, 0, 0); cc.lineCap = "round";
  let drawn = 0;
  // paints the frost at stage p (0 = clear glass, 1 = fully frosted): the frozen front moves in from the rim, following
  // the same ragged contour, with a soft leading edge; crystals appear just behind it
  const paint = p => {
    const front = 1 - p * 1.25;
    for (let n = 0; n < K.length; n++) im.data[n * 4 + 3] = Math.round(Math.pow(K[n], 1.5) * .7 * clamp((K[n] - front) / .2, 0, 1) * 255);
    lc.putImageData(im, 0, 0);
    for (; drawn < xs.length && xs[drawn].f > front + .1; drawn++) {
      const c = xs[drawn];
      if (c.r) { cc.fillStyle = `rgba(238,247,255,${c.a})`; cc.beginPath(); cc.arc(c.x, c.y, c.r, 0, PI * 2); cc.fill(); }
      else { const dx = cos(c.ang) * c.len, dy = sin(c.ang) * c.len; cc.strokeStyle = `rgba(238,247,255,${c.a})`; cc.lineWidth = c.lw; cc.beginPath(); cc.moveTo(c.x - dx, c.y - dy); cc.lineTo(c.x + dx, c.y + dy); cc.stroke(); }
    }
    ctx.clearRect(0, 0, w, h); ctx.imageSmoothingEnabled = true;
    ctx.drawImage(low, 0, 0, lw * sc, lh * sc); ctx.drawImage(cr, 0, 0, w, h);
  };
  if (!creep || calmMotion.matches) { paint(1); return; }
  // the first time the card turns cold, it freezes over before your eyes
  const t0 = performance.now(), dur = 12000; // slow and nearly even, so you watch it creep
  const step = now => { const k = Math.min(1, (now - t0) / dur); paint(1 - Math.pow(1 - k, 1.15)); if (k < 1) frostRAF = requestAnimationFrame(step); };
  paint(0); frostRAF = requestAnimationFrame(step);
}
function frostGlints(seed, n) {
  const rnd = fxRand(seed); let out = "";
  for (let i = 0; i < n; i++) {
    const side = i % 4, u = 6 + rnd() * 88, d = 2 + Math.pow(rnd(), 1.4) * 18, s = Math.round(5 + rnd() * 6);
    const [l, t] = side === 0 ? [u, d] : side === 1 ? [100 - d, u] : side === 2 ? [u, 100 - d] : [d, u];
    out += `<i class="glint" style="left:${l.toFixed(1)}%;top:${t.toFixed(1)}%;--s:${s}px;--t:${(2.6 + rnd() * 3).toFixed(1)}s;--w:${(-rnd() * 6).toFixed(1)}s"></i>`;
  }
  return out;
}


/* Condensation: a fine mist of micro-droplets with larger beads. Each bead works like a tiny lens: darker at the top,
   light gathered at the bottom, a sharp highlight and a soft contact shadow. Now and then a heavy bead runs down,
   swallowing the beads in its way and wiping a clear trail through the mist. */
let condStop = () => {};
function drawBead(c, x, y, r) {
  const ry = r * 1.08;
  c.fillStyle = "rgba(0,22,30,.15)"; c.beginPath(); c.ellipse(x + r * .1, y + ry * .3, r * .9, ry * .85, 0, 0, PI * 2); c.fill();
  const g = c.createLinearGradient(x, y - ry, x, y + ry);
  g.addColorStop(0, "rgba(0,26,32,.24)"); g.addColorStop(.55, "rgba(255,255,255,.05)"); g.addColorStop(1, "rgba(255,255,255,.42)");
  c.fillStyle = g; c.beginPath(); c.ellipse(x, y, r, ry, 0, 0, PI * 2); c.fill();
  c.lineWidth = Math.max(.45, r * .12);
  c.strokeStyle = "rgba(255,255,255,.32)"; c.beginPath(); c.ellipse(x, y, r * .93, ry * .93, 0, PI * .12, PI * .88); c.stroke();
  c.strokeStyle = "rgba(0,30,36,.22)"; c.beginPath(); c.ellipse(x, y, r * .96, ry * .96, 0, PI * 1.1, PI * 1.9); c.stroke();
  c.fillStyle = "rgba(255,255,255,.92)"; c.beginPath(); c.ellipse(x - r * .34, y - ry * .42, r * .2, r * .12, -.5, 0, PI * 2); c.fill();
  if (r > 3) { c.fillStyle = "rgba(255,255,255,.4)"; c.beginPath(); c.arc(x + r * .3, y + ry * .46, r * .08, 0, PI * 2); c.fill(); }
}
/* A tiny droplet on glass, drawn as a little lens: a bright catch-light at the top left, clear in the middle and a
   soft darker rim at the bottom, with a faint shadow under it. Rounder and softer than a speck. */
function microDrop(c, x, y, r) {
  c.fillStyle = "rgba(20,32,90,.07)"; c.beginPath(); c.arc(x, y + r * .3, r, 0, PI * 2); c.fill();
  const g = c.createRadialGradient(x - r * .35, y - r * .4, r * .08, x, y, r);
  g.addColorStop(0, "rgba(255,255,255,.85)"); g.addColorStop(.45, "rgba(255,255,255,.16)"); g.addColorStop(1, "rgba(20,32,90,.2)");
  c.fillStyle = g; c.beginPath(); c.arc(x, y, r, 0, PI * 2); c.fill();
}
function startCondensation(cv) {
  condStop();
  const s = sizeCanvas(cv); if (!s) return;
  const { ctx, w, h } = s, dpr = cv.width / w, rnd = prng(31);
  const layer = () => { const c = document.createElement("canvas"); c.width = cv.width; c.height = cv.height; const x = c.getContext("2d"); x.setTransform(dpr, 0, 0, dpr, 0, 0); return [c, x]; };
  const [mist, m] = layer(), [beadC, bc] = layer();
  // fogged glass: a faint haze with scattered micro-droplets, each a tiny lens rather than a speck
  m.fillStyle = "rgba(225,235,255,.05)"; m.fillRect(0, 0, w, h);
  for (let i = 0; i < w * h / 70; i++) microDrop(m, rnd() * w, rnd() * h, .7 + rnd() * .9);
  const beads = [];
  for (let tries = 0; tries < 900 && beads.length < w * h / 950; tries++) {
    const r = 1.2 + Math.pow(rnd(), 2.4) * 5.6, x = rnd() * w, y = rnd() * h;
    if (beads.some(b => Math.hypot(b.x - x, b.y - y) < b.r + r + 1.5)) continue;
    beads.push({ x, y, r });
  }
  m.globalCompositeOperation = "destination-out";
  for (const b of beads) { m.beginPath(); m.arc(b.x, b.y, b.r * 1.6, 0, PI * 2); m.fill(); } // beads gather the mist around them
  const paintBeads = () => { bc.clearRect(0, 0, w, h); for (const b of beads) (b.r < 2.2 ? microDrop : drawBead)(bc, b.x, b.y, b.r); }; // the smallest beads as soft little lenses
  paintBeads();
  const frame = run => { ctx.clearRect(0, 0, w, h); ctx.drawImage(mist, 0, 0, w, h); ctx.drawImage(beadC, 0, 0, w, h); if (run) drawBead(ctx, run.x, run.y, run.r); };
  frame();
  if (calmMotion.matches) return;
  // A run comes soon after the card scrolls into view (so someone scrolling past at an ordinary pace is likely to see
  // one), then every few seconds while it stays in view; it never runs unseen.
  let raf = 0, timer = 0, run = null, stopped = false, lastRun = 0;
  const next = (ms = 2500 + rnd() * 3000) => { clearTimeout(timer); timer = setTimeout(startRun, ms); };
  const seen = new IntersectionObserver(([e]) => { if (e.isIntersecting && !run && performance.now() - lastRun > 2500) next(500 + rnd() * 700); }, { threshold: .4 });
  seen.observe(cv);
  const startRun = () => {
    if (run || offscreen("c-humid")) return; // out of view: the observer starts the next one when it's back
    let big = beads.filter(b => b.r > 3.4 && b.y < h * .6);
    if (!big.length) { // the big beads have all run off: one grows again, as condensation keeps gathering
      const r = 3.6 + rnd() * 1.6; beads.push({ x: r + rnd() * (w - 2 * r), y: r + rnd() * h * .4, r }); paintBeads();
      big = beads.filter(b => b.r > 3.4 && b.y < h * .6);
    }
    const b = big[Math.floor(rnd() * big.length)];
    lastRun = performance.now();
    beads.splice(beads.indexOf(b), 1); paintBeads();
    run = { x: b.x, y: b.y, r: b.r, v: .15, x0: b.x, lastBead: b.y };
    raf = requestAnimationFrame(slide);
  };
  const slide = () => {
    if (stopped) return;
    run.v = Math.min(run.v + .025, 1.9); run.y += run.v; run.x = run.x0 + sin(run.y / 18) * 1.2;
    m.beginPath(); m.ellipse(run.x, run.y - run.r * .4, run.r * .55, run.r * .9, 0, 0, PI * 2); m.fill(); // wipe the trail
    let ate = false;
    for (let i = beads.length - 1; i >= 0; i--) {
      const b = beads[i];
      if (Math.hypot(b.x - run.x, b.y - run.y) < b.r + run.r * .9) { run.r = Math.min(Math.hypot(run.r, b.r), 8); beads.splice(i, 1); ate = true; }
    }
    if (run.y - run.lastBead > 22 + rnd() * 20) { beads.push({ x: run.x + (rnd() - .5) * 2, y: run.y - run.r * 2, r: .9 + rnd() * .6 }); run.lastBead = run.y; ate = true; }
    if (ate) paintBeads();
    if (run.y - run.r > h) { run = null; frame(); next(); return; }
    frame(run); raf = requestAnimationFrame(slide);
  };
  next();
  condStop = () => { stopped = true; cancelAnimationFrame(raf); clearTimeout(timer); seen.disconnect(); };
}

/* ---------------- hero ---------------- */
/* Could there be a rainbow right now? Kept rare: only when one is genuinely likely. It takes, all together:
   - a low enough sun: the bow lies 42° around the point straight opposite the sun, so with the sun above about 40° it
     is (almost) wholly below the horizon, and right at the horizon the light is too weak;
   - real sunshine: an open sky (under 70% cloud) and no heavy rain falling here now;
   - rain close by: showers (or thunder showers) likely (50%+) now or within the hour, or plain rain likely with a sky
     broken open (under 50% cloud): the classic showery afternoon with the sun out between the showers.
   Returns the sun's height and how bright to draw the bow, or null. */
function rainbowChance() {
  const { c, H, hi, kind } = X;
  if (!c.is_day || kind === "snow" || kind === "sleet") return null;
  const alt = sunAlt(new Date(), X.lat, X.lon) / rad;
  if (alt < 3 || alt > 40) return null;
  const cloud = c.cloud_cover ?? 100;
  if (cloud >= 70 || toMm(c.precipitation ?? 0) >= 2.5) return null;
  const near = [hi - 1, hi, hi + 1].filter(k => k >= 0 && k < H.time.length), likely = k => (H.precipitation_probability[k] ?? 100) >= 50;
  const showers = near.some(k => [80, 81, 82, 95].includes(H.weather_code[k]) && likely(k));
  const rain = near.some(k => toMm(H.precipitation[k] ?? 0) >= .2 && likely(k));
  if (!showers && !(rain && cloud < 50)) return null;
  return { alt, o: showers && cloud < 50 ? 1 : .75 }; // brightest with showers and the sun well out
}
/* The weather behind the main card for one hour, painted back to front so combined weather stacks naturally:
   sun glow or stars, then clouds and fog, then whatever is falling, then wind on top. Dragging along the arc repaints
   it for the hour you land on, so snow at 01:00 shows as snow. */
/* Snow lying on the ground (the model's snow depth now, from 1 cm): a soft, slightly lumpy ridge of snow along the
   horizon line of the main card's arc, a little higher the deeper it lies (up to about 30 cm). Its lumps are fixed
   per place, so it doesn't shift between refreshes. Still, no animation. */
function snowRidge() {
  const v = X.c.snow_depth, cm = v == null ? 0 : v * (S.precip === "inch" ? 30.48 : 100); // metres, or feet with inches
  if (cm < 1) return "";
  const k = clamp(.7 + Math.log2(cm) * .3, .7, 2.2), rnd = prng(Math.round(X.lat * 100) * 31 + Math.round(X.lon * 100));
  let d = "M0 95.6", x = 0;
  while (x < 300) { const w = 14 + rnd() * 22; d += ` Q${(x + w / 2).toFixed(1)} ${(95 - (.9 + rnd() * 1.6) * 1.6 * k).toFixed(1)} ${Math.min(300, x + w).toFixed(1)} ${(95 - rnd() * .5 * k).toFixed(1)}`; x += w; }
  return `<path class="snowr" d="${d} L300 95.6Z"/><path class="snowr-edge" d="${d}"/>`;
}
function heroSky({ kind, code, mm, cloud, windKmh, gustKmh, dir, isDay }) {
  const fair = kind === "clear" || kind === "partly";
  const falling = ["snow", "sleet", "thunder", "drizzle", "rain"].includes(kind) || mm > 0;
  const cover = cloud ?? (kind === "cloudy" ? 95 : kind === "partly" ? 50 : falling ? 90 : 5);
  const L = [], lean = fallLean(dir, Math.max(windKmh ?? 0, (gustKmh ?? 0) * .7)); // rain and snow lean with the wind (gusts count)
  if (fair && isDay) L.push(`<span class="sunglow" aria-hidden="true"><i></i></span>`);
  // stars every night: a full sky when it's clear, a few peeking through cloud or fog, none while rain or snow falls
  if (!isDay && !falling) L.push(starField(907, fair ? 26 : 9, (x, y) => x > 16 && x < 84 && y > 20 && y < 66));
  L.push(cloudLayer(33, kind === "fog" ? Math.min(cover, 40) : cover, { night: !isDay, wet: falling, windKmh }));
  if (kind === "fog") L.push(mistLayer(21, "fog"));
  if (kind === "snow") L.push(fallDrops(99, "snow", code === 75 || code === 86 ? 62 : code === 71 ? 26 : 40, .9, lean));          // snow, heavier codes more flakes
  else if (kind === "sleet") L.push(fallDrops(99, "rain", 22, .8, lean), fallDrops(98, "snow", 20, .9, lean));                       // freezing rain and drizzle
  // thunder rain is a downpour: more, longer and faster streaks than ordinary rain, driven at a steeper slant
  else if (code === 96 || code === 99) L.push(fallDrops(99, "thunder", 48, 1, lean), fallDrops(97, "hail", code === 99 ? 34 : 22, 1, lean), bolts(5)); // thunder with hail
  else if (kind === "thunder") L.push(fallDrops(99, "thunder", mm < 2 ? 56 : 70, 1, lean), bolts(5));
  else if (kind === "drizzle") L.push(fallDrops(99, "drizzle", code === 55 ? 40 : 28, .7, lean));
  else if (kind === "rain" || mm > 0) L.push(fallDrops(99, "rain", code === 65 || code === 82 || mm >= 4 ? 52 : code === 61 || code === 80 ? 26 : 38, .85, lean));
  L.push(gustStreaks(dir, gustKmh, 50));                                                                                              // wind storm from 50 km/h gusts
  return L.join("");
}
// what the sky looks like, coarsely: the sky is only repainted while dragging when this changes
const skyKey = w => [w.kind, w.code, Math.round(w.mm * 2), Math.round((w.cloud ?? -10) / 10), w.isDay, Math.round(w.windKmh / 10), w.gustKmh >= 50].join();
let heroSkyKey = "";
function renderHero() {
  const { c, Dy, di, kind, isDay } = X, el = card("c-hero");
  // the sky outside right now: the sun's height and the weather set the colour, the temperature tints it
  const tC = toC(c.temperature_2m), pal = heroPal(Math.round(sunAlt(new Date(), X.lat, X.lon) / rad * 2) / 2, kind, tC);
  paint(el, pal);
  el.classList.toggle("light", lum(pal.mid) > .42); // a pale sky (snow, fog) takes dark text
  const au = $("#aurora"); paint(au, pal);
  const rise = Dy.sunrise[di] ? T(Dy.sunrise[di]) : null, set = Dy.sunset[di] ? T(Dy.sunset[di]) : null;
  const st = sunTimes(dayOf(X.todayKey), X.lat, X.lon);
  const now = Date.now();
  const sunDay = !!(rise && set && !isNaN(rise));
  const up = sunDay ? now >= rise && now <= set : sunAlt(new Date(), X.lat, X.lon) > 0;
  let f = 0, mid = "";
  if (sunDay) {
    f = clamp((now - rise) / (set - rise), 0, 1);
    if (now < rise) mid = `Sunrise in ${inMins((rise - now) / 6e4)}`;
    else if (now > set) { const nr = Dy.sunrise[di + 1] ? T(Dy.sunrise[di + 1]) : null; mid = nr ? `Sunrise in ${inMins((nr - now) / 6e4)}` : "After sunset"; }
    else mid = `Solar noon ${fmtT(st.noon)}`;
  } else mid = up ? "Midnight sun" : "Polar night";
  // By day the arc is the sun's path. After dark the arc is the night itself, from sunset to sunrise, as tall as the sun
  // sinks tonight (a short summer night is a low arc, a long winter night a tall one); the dot shows how far the night
  // has come, and rain or fog stay on it. The moon keeps a path of its own, so it shows apart, in the corner of the sky.
  let a0 = rise, a1 = set, body = "sun";
  if (sunDay && !up) {
    const ps = Dy.sunset[di - 1] ? T(Dy.sunset[di - 1]) : null, nr = Dy.sunrise[di + 1] ? T(Dy.sunrise[di + 1]) : null;
    const [n0, n1] = now < rise ? [ps, rise] : [set, nr];
    if (n0 && n1 && !isNaN(n0) && !isNaN(n1)) { a0 = n0; a1 = n1; body = "night"; f = clamp((now - a0) / (a1 - a0), 0, 1); } // a night next to a midnight sun keeps the day arc
  }
  // at night the arc runs from one day's sunset to the next day's sunrise, and the labels say which day each one is,
  // so they never seem to contradict the sun card (which shows today)
  const night = body === "night";
  arcDay = night ? { peak: Math.max(0, -sunAlt(new Date((a0.valueOf() + a1.valueOf()) / 2), X.lat, X.lon)) } // peak: the highest point on the path
    : sunDay ? { peak: Math.max(0, sunAlt(st.noon, X.lat, X.lon)) } : null;
  const [px, py] = arcPoint(f).map(v => v.toFixed(1));
  const scrub = sunDay;
  // the weather along the path: rain or snow hours as a soft band under the arc, heavy cloud as a faint one
  const segs = scrub ? arcWeather(a0, a1) : [];
  if (body === "sun" && up && sunDay) {
    const wet = g => g.type === "wet" || g.type === "snow";
    const cur = segs.find(g => now >= g.t0 && now < g.t1);
    const next = cur && wet(cur) ? segs.find(g => g.t0 >= cur.t1 && !wet(g)) : segs.find(g => g.t0 > now && wet(g));
    if (next) mid = cur && wet(cur) ? `Dry from ${fmtTD(next.h)}` : `${next.type === "snow" ? "Snow" : "Rain"} from ${fmtTD(next.h)}`;
    // within the next six hours, to the quarter hour from the same timeline as the precipitation card
    const nc = nowcast();
    if (nc.times.length) {
      const wetQ = i => nc.rate[i] >= nc.thr, nowWet = wetQ(0), i = nowWet ? nc.rate.findIndex(v => v < nc.thr) : nc.rate.findIndex(v => v >= nc.thr);
      if (i > 0 && nc.times[i] <= a1) mid = nowWet ? `Dry from ${fmtTD(nc.times[i])}` : `${wmo(hourAt(nc.times[i]).code)[1] === "snow" ? "Snow" : "Rain"} from ${fmtTD(nc.times[i])}`;
    }
  }
  const rb = body === "sun" ? rainbowChance() : null;
  if (rb) mid = `Rainbow possible to the ${now < st.noon ? "west" : "east"}`; // always opposite the sun
  X.sun = scrub ? { rise: a0, set: a1, f, cur: f, body } : null;
  // the moon, day and night: small, with today's phase, apart from the arc; a thin rim keeps a new moon visible
  const mAlt = moonAlt(new Date(now), X.lat, X.lon) / rad, mi = moonIllum(new Date(now));
  const moon = mi ? `<span class="hero-moon" id="heroMoon" role="img" aria-label="Moon ${mAlt > 0 ? "up" : "below the horizon"}, ${Math.round(mi.fraction * 100)}% lit" title="Moon ${mAlt > 0 ? "up" : "below the horizon"}, ${Math.round(mi.fraction * 100)}% lit"><svg viewBox="-12 -12 24 24"><circle r="8" fill="currentColor" fill-opacity=".14" stroke="currentColor" stroke-opacity=".45" stroke-width=".7"/><path d="${moonSvg(mi.phase, 8)}" fill="currentColor"${X.lat < 0 ? ' transform="scale(-1 1)"' : ""}/></svg><svg class="hm-ind" viewBox="0 0 12 10"><path d="M1 8.5h10"/><path d="${mAlt > 0 ? "M6 6.5V1.5M3.9 3.6L6 1.5l2.1 2.1" : "M6 1.5v5M3.9 4.4L6 6.5l2.1-2.1"}"/></svg></span>` : "";
  const dot = night
    ? `<g id="sunDot" class="sun-dot" transform="translate(${px} ${py})"><circle r="5.2" fill="currentColor" fill-opacity=".18"/><path d="${moonSvg(mi.phase, 5.2)}" fill="currentColor"${X.lat < 0 ? ' transform="scale(-1 1)"' : ""}/></g>` /* at night a little moon in today's phase marks the spot */
    : `<g id="sunDot" class="sun-dot" transform="translate(${px} ${py})" opacity="${up ? 1 : .5}"><radialGradient id="sunGlow"><stop offset="0" stop-color="#fff6d6"/><stop offset=".45" stop-color="#ffe7a0" stop-opacity=".85"/><stop offset="1" stop-color="#ffd27a" stop-opacity="0"/></radialGradient><circle r="8.4" fill="url(#sunGlow)"/><circle r="3.6" fill="currentColor"/></g>`; // by day the sun: a white core in a soft warm glow
  // the drawing is only as tall as today's arc (plus room for the dot), so a low winter arc leaves no empty sky above it
  const vy = Math.max(0, Math.floor(arcPoint(.5)[1] - 16));
  const arc = `<svg viewBox="0 ${vy} 300 ${108 - vy}" aria-hidden="true">
    <line x1="0" y1="95" x2="300" y2="95" stroke="currentColor" stroke-opacity=".3" stroke-width="1"/>${snowRidge()}
    <clipPath id="arcSky"><rect x="-20" y="${vy - 20}" width="340" height="${115 - vy}"/></clipPath>
    <g clip-path="url(#arcSky)"><!-- the arc and its weather end at the horizon line: their round ends never dip below it -->
    <path id="arcDone" d="${arcPath(0, f)}" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
    <path id="arcLeft" d="${arcPath(f, 1)}" fill="none" stroke="currentColor" stroke-opacity=".3" stroke-width="1.4" stroke-linecap="round"/>
    ${segs.filter(g => g.type).map(g => `<path class="awx awx-${g.type}" d="${arcPath(g.f0, g.f1)}"/>`).join("")}</g>
    ${dot}
  </svg>`;
  const [label] = wmo(c.weather_code);
  const w = { kind, code: c.weather_code, mm: toMm(c.precipitation ?? 0), cloud: c.cloud_cover, windKmh: toMs(c.wind_speed_10m ?? 0) * 3.6, gustKmh: toMs(c.wind_gusts_10m ?? 0) * 3.6, dir: c.wind_direction_10m ?? 0, isDay };
  heroSkyKey = skyKey(w);
  const L = [];
  // a rainbow when the physics allow one: it stands opposite the sun, as high as 42° minus the sun's height
  if (rb) L.push(`<span class="rainbow" aria-hidden="true" style="--rb-x:${clamp(100 - arcPoint(f)[0] / 3, 18, 82).toFixed(1)}%;--rb-alt:${rb.alt.toFixed(1)};--rb-o:${rb.o};--rb-hy:82%"><i></i></span>`);
  const sky = `<div id="heroSky" style="display:contents">${heroSky(w)}</div>${L.join("")}`;
  const cold = tC < 0;
  el.innerHTML = `${sky}${cold ? `<canvas class="frost" id="heroFrost"></canvas>${frostGlints(41, 14)}` : ""}
    <header class="ch"><h3 id="heroWhen">Now</h3><p id="heroSub">${esc(label)}</p></header>
    <span class="hero-upd mono" id="heroUpd"${Date.now() - fetchedAt < 30 * 6e4 ? " hidden" : ""}>Updated ${updLabel(fetchedAt)}</span>${moon}
    <button class="hero-now" id="heroNow" hidden>Back to now</button>
    <div class="hero-temp" id="heroTemp" data-v="${R(c.temperature_2m)}" role="img" aria-label="${R(c.temperature_2m)} degrees">${dm(String(R(c.temperature_2m)), { deg: true })}</div>
    <div class="hero-meta"><span id="heroFeels">Feels like ${R(c.apparent_temperature)}°</span><span>High ${R(Dy.temperature_2m_max[di])}° · Low ${R(Dy.temperature_2m_min[di])}°</span><span id="heroClim" class="clim"${climLine() ? "" : " hidden"}>${esc(climLine())}</span></div>
    <div class="arc"><div class="arc-in" id="arcIn"${scrub ? ` role="slider" tabindex="0" aria-label="Time of day. Drag the sun or use the arrow keys to see the temperature at that hour." aria-valuemin="0" aria-valuemax="100" aria-valuenow="${Math.round(f * 100)}" aria-valuetext="Now"` : ""}>${arc}</div></div>
    <div class="hero-foot">
      <div><b>${fmtT(a0)}</b><span>${night ? (now < rise ? "Sunset yesterday" : "Sunset") : "Sunrise"}</span></div>
      <div class="mid"><span id="heroMid">${esc(mid)}</span></div>
      <div class="r"><b>${fmtT(a1)}</b><span>${night ? (now < rise ? "Sunrise" : "Sunrise tomorrow") : "Sunset"}</span></div>
    </div>`;
  glowAt(f);
  // the rainbow stands on the horizon line of the arc below
  if (rb) whenMeasured(() => { const b = el.querySelector(".rainbow"), s = el.querySelector(".arc svg"); if (!b || !s) return; const cr = el.getBoundingClientRect(), sr = s.getBoundingClientRect(); b.style.setProperty("--rb-hy", `${((sr.top + sr.height * (95 - vy) / (108 - vy) - cr.top) / cr.height * 100).toFixed(1)}%`); });
  $("#tbIc").innerHTML = icon(kind, isDay);
  $("#tbIc").classList.toggle("lift", kind === "cloudy" || kind === "partly"); // cloud icons sit high to leave room for rain; alone in the bar they are centred
  const tbT = $("#tbTemp"); tbT.innerHTML = dm(String(R(c.temperature_2m)), { deg: true }); tbT.setAttribute("aria-label", `${R(c.temperature_2m)} degrees`);
  if (scrub) { bindSunScrub(); arcTip(); }
  // below 0° the card frosts over at the rim (fades in the first time only); from 28° it shimmers
  if (cold) { const grow = !heroFrostGrown; whenMeasured(() => frostRim($("#heroFrost"), 17, grow)); }
  heroFrostGrown = cold;
  setHaze("hero", tC >= 28 ? clamp(4 + (tC - 28) * 1.5, 4, 14) : 0);
}
let heroFrostGrown = false;

/* ---------------- dragging the sun: scrub through today's daylight ---------------- */
/* Runs `fn` with the latest event at most once per screen refresh. Touch screens report moves faster than the screen
   redraws, so updating on every event queues work up and the indicator trails the finger. */
/* The app's one rule for the mouse wheel: scrolling up and down always scrolls the page, also over a slider, strip or
   timeline, so moving down the page never gets caught in a card. A sideways scroll (a trackpad swipe, or the wheel
   with Shift held) moves the slider instead, one step as far as one press of an arrow key (a trackpad's small steps
   add up to one). */
function wheelStep(el, step) {
  if (!el) return;
  let acc = 0, last = 0;
  el.addEventListener("wheel", e => {
    const side = Math.abs(e.deltaX) > Math.abs(e.deltaY);
    if (!side && !e.shiftKey) return; // up and down: the page's
    const d = side ? e.deltaX : e.deltaY; if (!d) return;
    e.preventDefault();
    const px = d * (e.deltaMode === 1 ? 33 : e.deltaMode === 2 ? 400 : 1), now = performance.now();
    if (now - last > 300 || Math.sign(px) !== Math.sign(acc)) acc = 0;
    last = now;
    if (Math.abs(px) >= 50) { acc = 0; step(Math.sign(px)); return; } // a mouse notch: one step
    acc += px; if (Math.abs(acc) >= 50) { step(Math.sign(acc)); acc = 0; } // a trackpad: its small steps add up
  }, { passive: false });
}
function perFrame(fn) { let last = null, id = 0; return e => { last = e; if (!id) id = requestAnimationFrame(() => { id = 0; fn(last); }); }; }
/* Where the sun sits on the main card's arc: a smooth sine curve from sunrise to sunset, as tall as the sun really
   climbs that day (90° would reach the top). So the arc is low and flat in a northern winter and tall in summer and
   near the equator; the dot moves along it with the time of day, evenly from left to right. */
let arcDay = null;
const arcPoint = f => {
  const h = arcDay ? clamp(arcDay.peak / (PI / 2), .12, 1) * 82 : 78; // midnight sun or polar night: a plain arc
  // time runs evenly from left to right and the height follows a sine, as the sun's altitude does through the day:
  // it leaves the horizon at a gentle slope instead of shooting straight up
  return [30 + 240 * f, 95 - h * sin(PI * f)];
};
const arcPath = (f0, f1) => {
  const n = Math.max(2, Math.ceil(Math.abs(f1 - f0) * 48)); let d = "";
  for (let i = 0; i <= n; i++) { const [x, y] = arcPoint(f0 + (f1 - f0) * i / n); d += `${i ? "L" : "M"}${x.toFixed(1)} ${y.toFixed(1)}`; }
  return d;
};
/* The lit part of the moon as an SVG path around 0,0 (same shape as moonLitPath on the moon card). */
function moonSvg(p, r) {
  const k = cos(2 * PI * p), rx = Math.max(r * Math.abs(k), .01).toFixed(2), sw = k > 0 ? 0 : 1;
  return p < .5 ? `M0 ${-r}A${r} ${r} 0 0 1 0 ${r}A${rx} ${r} 0 0 ${sw} 0 ${-r}Z` : `M0 ${r}A${r} ${r} 0 0 1 0 ${-r}A${rx} ${r} 0 0 ${sw} 0 ${r}Z`;
}
/* The hourly weather along the arc between a0 and a1, merged into runs: "wet" (rain, drizzle, thunder), "snow",
   "cloud" (75% cover or more) or "" (fair). f0/f1 are positions on the arc, h the start of the run. Within the next
   six hours each hour is cut at the quarter hours and whether it rains comes from the quarter-hour timeline, the same
   one the precipitation card and the label under the dot use (weatherAt), so a band never says rain where the card
   or the label says dry. */
function arcWeather(a0, a1) {
  const H = X.H, A = a0.valueOf(), B = a1.valueOf(), segs = [], nc = X.nc;
  const add = (type, from, to) => {
    const last = segs.at(-1);
    if (last && last.type === type && last.t1 === from) { last.t1 = to; last.f1 = (to - A) / (B - A); }
    else segs.push({ type, t0: from, t1: to, f0: (from - A) / (B - A), f1: (to - A) / (B - A), h: new Date(from) });
  };
  H.time.forEach((s, k) => {
    const t = T(s).valueOf(), from = Math.max(t, A), to = Math.min(t + 36e5, B); // the hour that starts at its time
    if (to <= from) return;
    const kd = wmo(H.weather_code[k])[1], snowK = kd === "snow" || kd === "sleet", cloud = (H.cloud_cover[k] ?? 0) >= 75 ? "cloud" : "";
    const hourFall = snowK || ["rain", "drizzle", "thunder"].includes(kd) || toMm(H.precipitation[k] ?? 0) >= .1;
    for (let a = from; a < to;) {
      const q = quarterAt(a);
      if (q >= 0) { // inside the quarter-hour timeline
        const b = Math.min(to, nc.times[q].valueOf() + 9e5);
        add(nc.rate[q] >= nc.thr ? ((nc.snow[q] ?? 0) > 0 || snowK ? "snow" : "wet") : cloud, a, b); a = b;
      } else { // outside it: the hour's own forecast, up to where the timeline starts
        const nx = nc.times.find(x => x.valueOf() > a), b = Math.min(to, nx ? nx.valueOf() : Infinity);
        add(hourFall ? (snowK ? "snow" : "wet") : cloud, a, b); a = b;
      }
    }
  });
  return segs;
}
/* The warm light on a clear day sits where the sun is: low on the left in the morning, highest at noon, low on the
   right in the evening, and it turns golden as the sun nears the horizon. */
function glowAt(f) {
  const g = $("#c-hero .sunglow"), s = X.sun;
  if (!g || !s || s.body !== "sun") return;
  const [x, y] = arcPoint(f), lift = clamp((95 - y) / 82, 0, 1);
  const alt = sunAlt(new Date(s.rise.valueOf() + f * (s.set - s.rise)), X.lat, X.lon) / rad, warm = clamp(1 - alt / 14, 0, 1);
  const gx = x / 300 * 112 - 6;
  g.style.setProperty("--gx", `${gx.toFixed(1)}%`);
  g.style.setProperty("--gy", `${(24 - lift * 34).toFixed(1)}%`);
  g.style.setProperty("--ga", `${(99 + 81 * clamp((gx + 6) / 112, 0, 1)).toFixed(1)}deg`); // rays fan away from the sun, straight down at noon
  g.style.setProperty("--ray", `255 ${Math.round(247 - 52 * warm)} ${Math.round(226 - 90 * warm)}`);
}
/* Hourly values at any instant, interpolated between the two nearest hours. */
function hourAt(t) {
  const H = X.H; let k = H.time.findIndex(s => T(s) > t) - 1;
  if (k < 0) k = H.time.length - 1;
  const k2 = Math.min(k + 1, H.time.length - 1), u = clamp((t - T(H.time[k])) / 36e5, 0, 1), near = u < .5 ? k : k2;
  const L = a => a[k] == null ? a[k2] : a[k2] == null ? a[k] : a[k] + (a[k2] - a[k]) * u;
  return { temp: L(H.temperature_2m), feels: L(H.apparent_temperature), code: H.weather_code[near], k: near };
}
/* Redraws only what changed; the dot-matrix number is rebuilt when the whole degree changes, which replays its dot animation. */
function scrubSun(f) {
  const s = X.sun; if (!s) return;
  if (!arcHinted) { arcHinted = true; store.set("arcHinted", true); } // once tried, the hint is not needed
  f = clamp(f, 0, 1); s.cur = f;
  const t = new Date(s.rise.valueOf() + f * (s.set - s.rise));
  const [px, py] = arcPoint(f).map(v => v.toFixed(1));
  $("#arcDone").setAttribute("d", arcPath(0, f));
  $("#arcLeft").setAttribute("d", arcPath(f, 1));
  const dot = $("#sunDot"); dot.setAttribute("transform", `translate(${px} ${py})`); dot.setAttribute("opacity", "1");
  const h = hourAt(t), wa = weatherAt(t.valueOf(), h.code, X.H.cloud_cover[h.k], toMm(X.H.precipitation[h.k] ?? 0)), [label, kind] = wmo(wa.code), v = R(h.temp), box = $("#heroTemp");
  // the weather on the card follows the hour too: snow, rain, fog, cloud, stars or sun (and agrees with the band under
  // the dot and the precipitation card, weatherAt)
  const H = X.H, k = h.k, w = { kind, code: wa.code, mm: wa.q < 0 ? toMm(H.precipitation[k] ?? 0) : wa.wet ? toMm(X.nc.vals[wa.q]) * 4 : 0, cloud: H.cloud_cover[k], windKmh: toMs(H.wind_speed_10m[k] ?? 0) * 3.6, gustKmh: toMs(H.wind_gusts_10m[k] ?? 0) * 3.6, dir: H.wind_direction_10m[k] ?? 0, isDay: !!H.is_day[k] };
  const sk = skyKey(w); if (sk !== heroSkyKey && $("#heroSky")) { heroSkyKey = sk; $("#heroSky").innerHTML = heroSky(w); }
  if (box.dataset.v !== String(v)) { box.dataset.v = v; box.innerHTML = dm(String(v), { deg: true }); box.setAttribute("aria-label", `${v} degrees`); }
  $("#heroWhen").textContent = fmtT(t);
  $("#heroSub").textContent = label;
  $("#heroFeels").textContent = `Feels like ${R(h.feels)}°`;
  const alt = Math.round(sunAlt(t, X.lat, X.lon) / rad); // after dark: how deep the sun has sunk
  $("#heroMid").textContent = alt ? `Sun ${Math.abs(alt)}° ${alt > 0 ? "above" : "below"} the horizon` : "Sun on the horizon";
  const hm = $("#heroMoon"); if (hm) hm.hidden = true; // the moon in the corner is the moon of now
  const hp = heroPal(Math.round(sunAlt(t, X.lat, X.lon) / rad * 2) / 2, kind, Math.round(toC(h.temp) * 2) / 2); // the sky at that hour; half steps keep repaints rare
  paint(card("c-hero"), hp); card("c-hero").classList.toggle("light", lum(hp.mid) > .42);
  glowAt(f);
  $("#heroUpd").hidden = true; $("#heroNow").hidden = false;
  const box2 = $("#arcIn"); box2.setAttribute("aria-valuenow", Math.round(f * 100)); box2.setAttribute("aria-valuetext", `${fmtT(t)}, ${v} degrees, ${label}`);
}
/* The one hint that the sun can be dragged: the first time the app opens, the line under the arc says so for a few
   seconds, then gives its place back. It never shows again, nor after the sun has once been dragged. */
let arcHinted = store.get("arcHinted", false);
function arcTip() {
  if (arcHinted) return;
  const swap = (el, text) => { el.classList.add("fade"); setTimeout(() => { if (X.sun && X.sun.cur === X.sun.f) el.textContent = text; el.classList.remove("fade"); }, 400); }; // a drag meanwhile wins
  setTimeout(() => {
    const el = $("#heroMid"), s = X.sun; if (!el || !s || arcHinted || document.hidden) return;
    arcHinted = true; store.set("arcHinted", true);
    const was = el.textContent, tip = s.body === "night" ? "Drag the moon through the night" : "Drag the sun through the day";
    swap(el, tip);
    setTimeout(() => { if (el.isConnected && el.textContent === tip) swap(el, was); }, 6400);
  }, 1200);
}
function bindSunScrub() {
  const box = $("#arcIn");
  const fAt = e => { const r = box.getBoundingClientRect(), x = (e.clientX - r.left) / r.width * 300; return clamp((x - 30) / 240, 0, 1); };
  // track the drag on the window so it keeps working when the pointer leaves the arc
  const move = perFrame(e => scrubSun(fAt(e)));
  const end = e => { if (e.type === "pointerup") scrubSun(fAt(e)); box.classList.remove("grab"); removeEventListener("pointermove", move); removeEventListener("pointerup", end); removeEventListener("pointercancel", end); };
  box.addEventListener("pointerdown", e => {
    if (e.button !== 0) return;
    box.classList.add("grab"); scrubSun(fAt(e));
    addEventListener("pointermove", move); addEventListener("pointerup", end); addEventListener("pointercancel", end);
  });
  box.addEventListener("keydown", e => {
    const s = X.sun, hour = 36e5 / (s.set - s.rise);
    const f = { ArrowRight: s.cur + hour, ArrowUp: s.cur + hour, ArrowLeft: s.cur - hour, ArrowDown: s.cur - hour, Home: 0, End: 1 }[e.key];
    if (f == null) return; e.preventDefault(); scrubSun(f);
  });
  wheelStep(box, d => { const s = X.sun; if (s) scrubSun(s.cur + d * 36e5 / (s.set - s.rise)); }); // an hour per notch
  $("#heroNow").onclick = () => { renderHero(); $("#arcIn").focus({ preventScroll: true }); };
}

/* ---------------- rain in the next hours (glass) ---------------- */
/* Rain in the next six hours, per quarter-hour: the one timeline the precipitation card, the summary and the main card
   all read, so they never disagree about when it rains. From the quarter-hour forecast, with the hourly filling in. */
function nowcast() {
  const M = D.minutely_15;
  let times = [], vals = [], snow = []; // snow: fresh snow per quarter-hour (cm, or inches), from the same forecast
  const hs = k => (X.H.snowfall ? X.H.snowfall[k] ?? 0 : 0) / 4;
  // skip quarter-hours that already passed (a kept forecast can be hours old); with too few left the hourly takes over
  // a quarter hour's amount is for the quarter BEFORE its time ("20:15" = 20:00–20:15): each is kept at its start
  if (M && M.precipitation && M.precipitation.some(v => v != null)) M.time.forEach((s, i) => { const t = new Date(T(s).valueOf() - 9e5); if (t >= Date.now() - 9e5) { times.push(t); vals.push(M.precipitation[i] ?? 0); snow.push(M.snowfall ? M.snowfall[i] ?? 0 : 0); } });
  if (times.length < 8) { times = []; vals = []; snow = []; for (let i = 0; i < 6; i++) { const t = X.H.time[X.hi + i]; if (!t) break; for (let q = 0; q < 4; q++) { times.push(new Date(T(t).valueOf() + q * 9e5)); vals.push((X.H.precipitation[X.hi + i] ?? 0) / 4); snow.push(hs(X.hi + i)); } } }
  // always six hours (24 quarter-hours): when the quarter-hour forecast runs out early (an older kept copy), the hourly
  // forecast fills the rest, so the grid keeps the same number of columns and the same dot size
  while (times.length && times.length < 24) {
    const t = new Date(times.at(-1).valueOf() + 9e5), k = X.H.time.findIndex(s => T(s) > t) - 1;
    if (k < 0) break; times.push(t); vals.push((X.H.precipitation[k] ?? 0) / 4); snow.push(hs(k));
  }
  times = times.slice(0, 24); vals = vals.slice(0, 24); snow = snow.slice(0, 24);
  return { times, vals, snow, rate: vals.map(v => toMm(v) * 4), thr: .1, end: times.length ? times.at(-1).valueOf() + 9e5 : 0 };
}
/* Thunder in the precipitation grid: every 3 to 7 s a bolt of white dots zigzags down the grid from top to bottom,
   starting above a thundery quarter-hour and drifting a few columns sideways as it falls, often with a short fork,
   then flickers out (a quick double flicker, opacity only). A new random bolt each time. One loop for the app; it
   idles while the page is hidden, the card has no thunder, or motion is reduced. */
let strikeT = 0;
function strikes() {
  clearTimeout(strikeT);
  const g = document.querySelector("#c-now .strike");
  if (!g || calmMotion.matches) return;
  if (!document.hidden && !offscreen("c-now")) {
    const cols = g.dataset.thun.split(",").map(Number), n = +g.dataset.n, rows = +g.dataset.rows, sp = 10;
    const rnd = Math.random, at = (c, k) => `<circle cx="${c * sp + 5}" cy="${(rows - 1 - k) * sp + 5}" r="2.6"`;
    let c = cols[Math.floor(rnd() * cols.length)], main = "", fork = "";
    const side = c < 2 ? 1 : c > n - 3 ? -1 : rnd() < .5 ? -1 : 1; // near an edge it leans inwards, so it never runs along it
    const forkAt = rnd() < .65 ? rows - 3 - Math.floor(rnd() * 2) : -1; // most bolts branch once, a little below the top
    for (let k = rows - 1; k >= 0; k--) {
      main += `${at(c, k)}/>`;
      if (k === forkAt && c - side * 3 >= 0 && c - side * 3 < n) // the fork branches off the other way (only with room for it)
        for (let f = 1; f <= 3; f++) fork += `${at(c - side * f, k - f)} fill-opacity="${(.7 - f * .15).toFixed(2)}"/>`;
      const r = rnd(); c = clamp(c + (r < .55 ? side : r < .8 ? 0 : -side), 0, n - 1); // mostly one way, now and then back
    }
    g.innerHTML = main + fork;
    g.animate([{ opacity: 0 }, { opacity: 1, offset: .08 }, { opacity: .15, offset: .25 }, { opacity: .95, offset: .4 }, { opacity: 0 }], { duration: 900, easing: "linear" });
  }
  strikeT = setTimeout(strikes, 3000 + Math.random() * 4000);
}
function renderNow() {
  const el = card("c-now"), { times, vals, snow, rate } = nowcast();
  const thr = 0.1, first = rate.findIndex(v => v >= thr), peak = Math.max(0, ...rate);
  const inten = r => r < 2.5 ? "Light" : r < 7.6 ? "Moderate" : r < 50 ? "Heavy" : "Violent";
  // snow: a quarter-hour whose forecast has fresh snow. When most of what falls is snow the card speaks of snow, counts
  // it in centimetres (inches) of snow, and draws it white, with slow swaying flakes and the odd twinkle
  const sn = rate.map((r, i) => r >= thr && (snow[i] ?? 0) > 0), wetN = rate.filter(r => r >= thr).length;
  // hail: Open-Meteo only reports it as a thunderstorm with hail (WMO 96, 99); those quarter-hours get bouncing grains
  const codeAt = t => { const k = X.H.time.findIndex(s => T(s) > t) - 1; return k >= 0 ? X.H.weather_code[k] : null; };
  const hail = rate.map((r, i) => r >= thr && [96, 99].includes(codeAt(times[i])));
  // thunder (WMO 95–99): now and then a bolt of white dots strikes down the grid from one of those quarter-hours (strikes())
  const thun = rate.map((r, i) => r >= thr && codeAt(times[i]) >= 95), tIdx = thun.flatMap((t, i) => t ? [i] : []);
  const isSnow = wetN > 0 && sn.filter(Boolean).length * 2 >= wetN, P = isSnow ? "Snow" : "Rain", low = isSnow ? " snow" : "";
  let say, sub;
  if (first < 0) { say = `No rain expected in the next ${Math.round(rate.length / 4)} hours`; sub = "Dry"; }
  else if (first === 0) {
    const stop = rate.findIndex(v => v < thr);
    say = stop < 0 ? `${P} continues for the next ${Math.round(rate.length / 4)} hours` : `${P} easing off around ${fmtTD(times[stop])}`;
    sub = `${inten(peak)}${low} now`;
  } else { say = `${P} likely from about ${fmtTD(times[first])}`; sub = `${inten(peak)}${low} · in ${inMins((times[first] - Date.now()) / 6e4)}`; }
  if (sub !== "Dry" && hail.some(Boolean)) sub += " · hail";
  else if (sub !== "Dry" && tIdx.length) sub += " · thunder";
  const total = vals.reduce((a, b) => a + b, 0), snowTotal = snow.reduce((a, b) => a + b, 0);
  const totalTxt = isSnow ? `${snowTotal < 10 ? (Math.round(snowTotal * 10) / 10) : Math.round(snowTotal)} <span class="u">${S.precip === "inch" ? "in" : "cm"}</span> of snow` : `${fmtP(total)} <span class="u">${PU()}</span> total`;
  const n = rate.length, rows = 8, sp = 10;
  // LED rain gauge. Wet columns fill cell by cell from the bottom; afterwards a drip steps down the empty
  // cells of the grid one at a time with a fading trail, and the top of the stack pulses as it lands.
  // Heavier rain drips more often; every column keeps its own rhythm.
  let grid = "", wet = "", glow = "";
  // dry for the whole window: the empty grid shows a sun by day or a crescent moon by night, centred with as many
  // empty rows above as below, quiet and still
  // no rain expected, but a chance of a shower: grey columns as tall as the chance that hour (10% a dot, 100% the full
  // height), grey as in the 48 hours, since blue means rain in the forecast; only with not even a chance does the sun
  // or moon appear
  const popAt = t => { const k = X.H.time.findIndex(s => T(s) > t) - 1; return k >= 0 ? X.H.precipitation_probability[k] ?? 0 : 0; };
  const chance = first < 0 ? times.map(t => { const p = popAt(t); return p >= 10 ? Math.max(1, Math.round(p / 100 * rows)) : 0; }) : [];
  if (chance.some(Boolean)) sub = `Dry · up to ${Math.max(...times.map(popAt))}% chance`;
  const dry = new Set();
  if (first < 0 && !chance.some(Boolean)) {
    const pic = X.isDay ? ["#.##.#", ".####.", "######", "######", ".####.", "#.##.#"] : ["..###.", ".##...", "##....", "##....", ".##...", "..###."];
    const ox = Math.floor((n - pic[0].length) / 2), oy = (rows - pic.length) / 2;
    pic.forEach((r, y) => [...r].forEach((c, x) => { if (c === "#") dry.add(`${ox + x},${rows - 1 - (oy + y)}`); }));
  }
  rate.forEach((r, i) => {
    const lit = r <= 0 ? 0 : Math.min(rows, Math.max(1, Math.ceil(Math.log2(1 + r * 4) * 1.6)));
    const cx = i * sp + 5, cyOf = k => (rows - 1 - k) * sp + 5;
    const period = (5.6 - Math.min(lit, 8) * .3).toFixed(2), stepT = period * .024;
    const start = 2.4 + ((i * 7919) % 97) / 97 * period;
    for (let k = 0; k < rows; k++) {
      // the full grid of faint dots is always there; lit (blue) dots land on top of their own grey dot, so while they
      // fill in, or if a drawing ever stalls, the grid shows no holes
      if (k < lit) grid += `<circle cx="${cx}" cy="${cyOf(k)}" r="2.1" fill="currentColor" opacity=".07"/>`;
      if (k >= lit) { if (k < (chance[i] || 0)) grid += `<circle cx="${cx}" cy="${cyOf(k)}" r="2.3" fill="currentColor" opacity=".3"/>`; else if (dry.has(`${i},${k}`)) glow += `<circle cx="${cx}" cy="${cyOf(k)}" r="2.5" fill="${X.isDay ? "#ffd88a" : "#e6e4ff"}"/>`; else grid += `<circle cx="${cx}" cy="${cyOf(k)}" r="2.1" fill="currentColor" opacity=".07"/>`; continue; }
      const tone = (.95 - (k / Math.max(lit - 1, 1)) * .4 * (lit / rows)).toFixed(2);
      const fill = `--d:${(.25 + i * .035 + k * .09).toFixed(2)}s`;
      const top = k === lit - 1 && lit < rows, tw = sn[i] && (i * 7 + k * 3) % 11 === 0; // now and then a snow dot catches the light
      wet += `<circle class="wet${top ? " top" : ""}${tw ? " tw" : ""}" cx="${cx}" cy="${cyOf(k)}" r="2.5" fill="${sn[i] ? "var(--snow)" : "var(--rain)"}" fill-opacity="${tone}" style="${fill}${top ? `;--p:${period}s;--w2:${(start + (rows - lit) * stepT).toFixed(2)}s` : ""}${tw ? `;--tw:${(-((i + k) % 5) * .55).toFixed(2)}s` : ""}"/>`;
    }
    if (hail[i] && lit < rows) // hail: a white grain drops onto the stack and bounces once
      wet += `<circle class="hailg" cx="${cx}" cy="${cyOf(rows - 1)}" r="2" fill="var(--snow)" style="--p:${(period * .8).toFixed(2)}s;--w:${start.toFixed(2)}s;--fall:${(rows - lit - 1) * sp}px"/>`;
    else if (sn[i] && lit < rows) // snow: one slow flake sways down the empty cells instead of the quick drips
      wet += `<circle class="flake" cx="${cx}" cy="${cyOf(rows - 1)}" r="1.8" fill="var(--snow)" style="--p:${(period * 1.7).toFixed(2)}s;--w:${start.toFixed(2)}s;--fall:${(rows - lit - 1) * sp}px"/>`;
    else for (let j = 0, n = rows - lit; lit && j < n; j++)
      wet += `<circle class="drip" cx="${cx}" cy="${cyOf(rows - 1 - j)}" r="2.5" fill="var(--rain)" style="--p:${period}s;--w:${(start + j * stepT).toFixed(2)}s"/>`;
  });
  const dots = `${grid}<g filter="url(#bloom)">${wet}</g>${glow ? `<g class="dry-glow">${glow}</g>` : ""}`;
  // the axis marks whole hours, each under its own column ("13:00", or "1pm" on a 12-hour clock, short like the
  // hours card), never one crowding "Now" or running off the right edge (rule 20b)
  let axis = `<span class="tm" style="left:0">Now</span>`;
  times.forEach((t, i) => {
    if (i < 3 || n - i < 3 || new Date(t.valueOf() + OFF * 1000).getUTCMinutes() !== 0) return;
    axis += `<span class="tm" style="left:${(i / n * 100).toFixed(2)}%">${S.clock === "12" ? fmtH(t) : fmtT(t)}</span>`;
  });
  el.innerHTML = `<div class="ch-row">${head("Precipitation", sub)}${total > 0 ? `<span class="mono">${totalTxt}</span>` : ""}</div>
    <div class="now-say">${esc(say)}</div>
    <div class="now-chart"><svg viewBox="0 0 ${n * sp} ${rows * sp}" role="img" aria-label="Precipitation per 15 minutes"><defs><filter id="bloom" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="1.3" result="b"/><feComponentTransfer in="b" result="s"><feFuncA type="linear" slope=".55"/></feComponentTransfer><feMerge><feMergeNode in="s"/><feMergeNode in="SourceGraphic"/></feMerge></filter></defs>${dots}${tIdx.length ? `<g class="strike" data-thun="${tIdx.join(",")}" data-n="${n}" data-rows="${rows}"></g>` : ""}</svg></div>
    <div class="now-axis">${axis}</div>`;
  // once every dot has filled in (the last starts after about 1.7 s), the fill-in animation is dropped, so the blue dots
  // stand in their final place even if Chrome stalled the animation or the card was paused off screen meanwhile
  const chart = el.querySelector(".now-chart"); setTimeout(() => chart.classList.add("settled"), 3000);
  clearTimeout(strikeT); if (tIdx.length) strikeT = setTimeout(strikes, 2500); // the first strike once the grid has filled in
}

/* ---------------- wind ---------------- */
function renderWind() {
  const { c } = X, el = card("c-wind");
  const sp = c.wind_speed_10m, dir = c.wind_direction_10m ?? 0, gust = c.wind_gusts_10m;
  // a storm (gusts of 75 km/h and more, Beaufort 9): every card's slow light drifts faster and more restlessly
  document.documentElement.classList.toggle("storm", toMs(gust ?? 0) * 3.6 >= 75);
  const [b, bname] = beaufort(toMs(sp ?? 0));
  // a quiet ring with eight marks: the four points of the compass and the four between them
  let ticks = `<circle cx="100" cy="100" r="92" fill="none" stroke="currentColor" stroke-opacity=".16" stroke-width="1"/>`;
  for (let i = 0; i < 8; i++) {
    const a = i * 45 * rad, major = i % 2 === 0, mid = !major;
    const r1 = 92, r2 = major ? 81 : 86;
    ticks += `<line x1="${100 + r1 * sin(a)}" y1="${100 - r1 * cos(a)}" x2="${100 + r2 * sin(a)}" y2="${100 - r2 * cos(a)}" stroke="currentColor" stroke-opacity="${major ? .95 : mid ? .6 : .32}" stroke-width="${major ? 1.8 : 1}" stroke-linecap="round"/>`;
  }
  const lab = ["N", "E", "S", "W"].map((t, i) => { const a = i * 90 * rad; return `<text x="${100 + 68 * sin(a)}" y="${100 - 68 * cos(a) + 3.5}" text-anchor="middle" font-family="Geist, sans-serif" font-size="14" fill="currentColor" fill-opacity=".75">${t}</text>`; }).join("");
  const a = dir * rad, tip = 81, base = 95;
  const tri = `<line x1="${100 + tip * sin(a)}" y1="${100 - tip * cos(a)}" x2="${100 + base * sin(a)}" y2="${100 - base * cos(a)}" stroke="var(--signal)" stroke-width="6.5" stroke-linecap="round"/>`; // a capsule needle on the ring

  const spTxt = sp == null ? "–" : String(Math.round(sp));
  // streaks flow across the card from the side the wind comes from, scaled to its strength
  const kmh = toMs(sp ?? 0) * 3.6, gusts = windFlow(dir, kmh, toMs(gust ?? 0) * 3.6);
  el.innerHTML = `${gusts}${head("Wind", sp == null ? "–" : esc(bname))}
    <div class="compass"><svg viewBox="0 0 200 200" role="img" aria-label="Wind from ${pt16(dir)}">${ticks}${lab}${tri}</svg>
      <div class="compass-c" role="img" aria-label="${sp == null ? "No wind data" : `${spTxt} ${WU[S.wind]}`}">${dm(spTxt)}<span class="mono u">${WU[S.wind]}</span></div></div>
    <div class="foot"><span data-short="${PTS[Math.round(((dir % 360) + 360) % 360 / 45) % 8 * 2]} · gusts <b>${R(gust)}</b> ${WU[S.wind]}">From ${PTS[Math.round(((dir % 360) + 360) % 360 / 45) % 8 * 2]} · gusts <b>${R(gust)}</b> ${WU[S.wind]}</span></div>`;
}

/* ---------------- feels like ---------------- */
function renderFeels() {
  const { c } = X, el = card("c-feels");
  const t = c.temperature_2m, f = c.apparent_temperature;
  // everything works from the whole degrees the card shows, so the words, the number and the dots always agree
  const rt = R(t), rf = R(f), ms = toMs(c.wind_speed_10m ?? 0);
  let why, sub;
  // only causes the numbers can back up: wind cools, humid warmth warms, the sun warms by day under an open sky
  const d = Math.abs(rf - rt);
  // the difference itself is the subtitle, with its cause in a word when the numbers back one up
  if (!d) { sub = "Same"; why = "It feels about as warm as the thermometer says."; }
  else if (rf < rt) { sub = `${d}° colder${ms > 3 ? " · wind" : ""}`; why = ms > 3 ? `Wind makes it feel ${d}° colder than measured.` : `Feels ${d}° colder than measured.`; }
  else { const humid = (c.relative_humidity_2m ?? 0) > 55 && toC(t) >= 20, sun = c.is_day && (c.cloud_cover ?? 100) < 50;
    sub = `${d}° warmer${humid ? " · humid" : sun ? " · sun" : ""}`; why = (c.relative_humidity_2m ?? 0) > 55 && toC(t) >= 20 ? `Humidity makes it feel ${d}° warmer.` : c.is_day && (c.cloud_cover ?? 100) < 50 ? `Sunshine and still air make it feel ${d}° warmer.` : `Feels ${d}° warmer than measured.`; }
  const same = !d; // the same to the degree: the needle sits right on the thermometer mark
  // the accent glow says which way it feels: a cool blue-violet when colder, a deep warm red when warmer, none when the
  // same. It shows clearly from 1° (this card lets its accent count for more than the others do) and grows to 4°.
  // Warmer leans further, as the card's own coral is warm already.
  const base = FAM.coral, cold = rf < rt, k = clamp(d / 4, 0, 1);
  const tint = same ? base.mid : window.Palette.mix(base.mid, cold ? "#5b5cf0" : "#e3122f", cold ? .6 + .4 * k : .75 + .25 * k);
  paint(el, { ...base, acc: tint });
  el.style.setProperty("--acc-k", same ? 1 : ((cold ? 1.5 : 1.9) + .4 * k).toFixed(2));
  // one line nothing else says: how cold and how warm today feels at its extremes (from the hourly feels-like)
  const ft = X.H.time.map((s, k) => s.startsWith(X.todayKey) ? X.H.apparent_temperature[k] : null).filter(v => v != null);
  const range = ft.length ? `<div class="foot"><span>Today feels <b>${R(Math.min(...ft))}°</b> to <b>${R(Math.max(...ft))}°</b></span></div>` : "";
  // the scale as a row of dots with the thermometer always in the middle and only the needle moving: one dot per
  // degree, or per 2 or 3 degrees when the gap is wider than half the scale, so the needle never runs off the end; the
  // dots between the mark and the needle light up
  const N = 25, step = Math.max(1, Math.ceil(d / 11)), at = v => clamp(12 + Math.round((v - rt) / step), 0, N - 1), pos = k => (k / (N - 1) * 100).toFixed(2);
  const ti = at(rt), fi = at(rf), k0 = Math.min(ti, fi), k1 = Math.max(ti, fi);
  let fdots = ""; for (let k = 0; k < N; k++) fdots += `<i${!same && k >= k0 && k <= k1 ? ' class="on"' : ""}></i>`;
  el.innerHTML = `${head("Feels like", sub)}
    <div class="num big">${R(f)}°</div>
    <div class="ftrack" aria-hidden="true"><div class="fdots">${fdots}</div>
      ${ti === fi ? "" : `<div class="tick" style="left:${pos(ti)}%"></div>`}<div class="tri" style="left:${pos(fi)}%"></div>
      <span class="lab" style="left:${pos(ti)}%">Actual: ${R(t)}°</span>${same ? "" : `<span class="lab up" style="left:${pos(fi)}%">${degMid(R(f))}</span>`}</div>
    ${range}`;
  el.querySelector(".num").setAttribute("aria-label", `${R(f)} degrees. ${why}`); // the longer explanation stays for screen readers
}

/* ---------------- hourly (glass) ---------------- */
/* The rain gauge under each hour (and day): its five dots show the amount, in the same blue as the precipitation card,
   one dot for each step reached (mm in an hour, or in a day); the blue number under it is that amount. Where no rain
   is in the forecast but it might still rain, the dots stay empty and the chance shows in grey instead. So blue always
   means "in the forecast", as on the precipitation card, and a chance never looks like rain. */
const AMT_H = [.1, .5, 1, 2, 4], AMT_D = [.2, 1, 2, 5, 10];
const rainLabel = (mm, min, v, pop) => mm >= min ? `<span>${fmtP(v)}<small>${PU()}</small></span>` : pop != null && pop >= 10 ? `<span class="pc">${pop}%</span>` : "<span>&nbsp;</span>";
function renderHourly() {
  const { H, hi } = X, el = card("c-hourly");
  const n = Math.min(48, H.time.length - hi), colW = 58, temps = [], cols = [];
  let labelled = false;
  for (let i = 0; i < n; i++) {
    const k = hi + i, t = T(H.time[k]), pop = nz(H.precipitation_probability[k]);
    // "Now" shows the conditions right now, exactly as the main card and the top bar do; later columns the hourly forecast
    // an hour's rain or snow icon needs an amount to back it (0.1 mm or more): a drizzle code with less is shown as cloud,
    // so the icon, the drops and the amount always agree ("Now" shows the conditions right now, as the main card does)
    // "Now" takes its rain from the quarter-hour timeline, like its icon (X.c, weatherAt) and the precipitation card,
    // as an hourly rate; later hours keep the hourly forecast's amount
    const q0 = i ? -1 : quarterAt(Date.now()), now0 = q0 >= 0 && X.nc.rate[q0] >= X.nc.thr ? X.nc.vals[q0] * 4 : q0 >= 0 ? 0 : null;
    const hmm = now0 != null ? toMm(now0) : toMm(H.precipitation[k] ?? 0), wc = i ? (H.weather_code[k] >= 51 && H.weather_code[k] < 95 && hmm < .1 ? dryCode(H.cloud_cover[k]) : H.weather_code[k] < 51 && hmm >= .1 ? ((H.snowfall?.[k] ?? 0) > 0 ? 71 : normRain(61, hmm)) : normRain(H.weather_code[k], hmm)) : X.c.weather_code;
    const day = i ? !!H.is_day[k] : X.isDay, [, kind] = wmo(wc);
    temps.push(i ? H.temperature_2m[k] : X.c.temperature_2m);
    const isMid = H.time[k].endsWith("T00:00");
    const tl = i === 0 ? `<span class="htime now">Now</span>` : isMid ? `<span class="htime mid">${wd(H.time[k].slice(0, 10))}</span>` : `<span class="htime">${fmtH(t)}</span>`;
    const mm = hmm, lit = AMT_H.filter(v => mm >= v).length;
    // in an hour with rain in the forecast (0.1 mm or more), drops fall through the empty dots onto the stack and its
    // top dot gives a small bounce as each lands, as in the precipitation card: more often the harder it rains, each
    // hour on its own rhythm. An hour with only a chance stays still.
    const rains = mm >= .1 && lit < 5;
    // a drop every 3.2 s in light rain down to every 2 s in heavy rain; each dot stays lit a little longer than in the
    // precipitation card, as these columns are small
    const per = (3.38 - Math.min(8, Math.ceil(Math.log2(1 + mm * 4) * 1.6)) * .17).toFixed(2), stepT = per * .06, t0 = .8 + ((i * 7919) % 97) / 97 * per;
    let pd = ""; for (let q = 0; q < 5; q++) pd += `<circle${rains && q === lit - 1 ? ` class="htop" style="--p:${per}s;--w2:${(t0 + (5 - lit) * stepT).toFixed(2)}s"` : ""} cx="4" cy="${26 - q * 5.5}" r="${q < lit ? 2.2 : 1.5}" fill="${q < lit ? "var(--rain)" : "currentColor"}" opacity="${q < lit ? 1 : .18}"/>`;
    if (rains) for (let j = 0; j < 5 - lit; j++) pd += `<circle class="drip" cx="4" cy="${26 - (4 - j) * 5.5}" r="2.2" fill="var(--rain)" style="--p:${per}s;--w:${(t0 + j * stepT).toFixed(2)}s"/>`;
    if (mm >= .1 || (pop ?? 0) >= 10) labelled = true;
    cols.push(`<div class="hcol">${tl}${icon(kind, day)}<span></span>
      <div class="hpop"><svg viewBox="0 0 8 30" aria-hidden="true">${pd}</svg>${rainLabel(mm, .1, now0 ?? H.precipitation[k], pop)}</div></div>`);
  }
  const valid = temps.filter(v => v != null), mn = Math.min(...valid), mx = Math.max(...valid), span = (mx - mn) || 1;
  const pts = temps.map((v, i) => [i * colW + colW / 2, 24 + (1 - ((v ?? mn) - mn) / span) * 44]);
  let d = `M${pts[0][0]} ${pts[0][1]}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i - 1] || pts[i], p1 = pts[i], p2 = pts[i + 1], p3 = pts[i + 2] || p2;
    d += ` C${p1[0] + (p2[0] - p0[0]) / 6} ${p1[1] + (p2[1] - p0[1]) / 6} ${p2[0] - (p3[0] - p1[0]) / 6} ${p2[1] - (p3[1] - p1[1]) / 6} ${p2[0]} ${p2[1]}`;
  }
  const W = n * colW;
  const svg = `<svg class="hcurve" width="${W}" height="78" viewBox="0 0 ${W} 78" aria-hidden="true">
    <path d="${d}" fill="none" stroke="var(--ink)" stroke-opacity=".55" stroke-width="1.4"/>
    ${pts.map(([x, y], i) => `<circle cx="${x}" cy="${y}" r="${i === 0 ? 4.5 : 2.6}" fill="${i === 0 ? "var(--signal)" : "var(--ink)"}"/><text x="${x}" y="${y - 10}">${degMidSvg(R(temps[i]))}</text>`).join("")}
  </svg>`;
  // Sun and moon track above the hours: sunlight, a violet twilight around each sunset and sunrise, then night.
  // Each turn is marked with a small horizon glyph (arrow down for sunset, up for sunrise) and the time.
  const t0 = T(H.time[hi]).valueOf(), xAt = t => (t - t0) / 36e5 * colW + colW / 2;
  const evs = [];
  X.Dy.time.forEach((_, j) => {
    for (const [key, up] of [["sunrise", true], ["sunset", false]]) {
      const s = X.Dy[key][j]; if (!s) continue;
      const t = T(s).valueOf(), x = xAt(t);
      if (x > 0 && x < W) evs.push({ x, t, up });
    }
  });
  evs.sort((a, b) => a.x - b.x);
  const SUN = "var(--day-track)", TWI = "var(--twilight-track)", MOON = "var(--night-track)";
  const stops = [`${H.is_day[hi] ? SUN : MOON} 0px`];
  for (const e of evs) stops.push(...(e.up
    ? [`${MOON} ${e.x - colW}px`, `${TWI} ${e.x - colW * .3}px`, `${SUN} ${e.x + colW * .4}px`]
    : [`${SUN} ${e.x - colW * .4}px`, `${TWI} ${e.x + colW * .3}px`, `${MOON} ${e.x + colW}px`]));
  stops.push(`${evs.length ? (evs.at(-1).up ? SUN : MOON) : H.is_day[hi] ? SUN : MOON} ${W}px`);
  const glyph = up => `<svg viewBox="0 0 16 12" aria-hidden="true"><path d="M1.5 11h13M4.5 11a3.5 3.5 0 0 1 7 0"/><path d="${up ? "M8 5.4V1M6.4 2.6L8 1l1.6 1.6" : "M8 1v4.4M6.4 3.8L8 5.4l1.6-1.6"}"/></svg>`;
  const track = `<span class="htrack" aria-hidden="true" style="width:${W}px;background:linear-gradient(90deg,${stops.join(",")})"></span>`
    + evs.map(e => `<span class="hev" style="left:${e.x.toFixed(1)}px" aria-label="${e.up ? "Sunrise" : "Sunset"} ${fmtT(new Date(e.t))}">${glyph(e.up)}${fmtT(new Date(e.t))}</span>`).join("");
  const view = store.get("hview", "h");
  el.dataset.view = view;
  el.innerHTML = `<div class="ch-row"><header class="ch"><h3 id="hTitle">${view === "d" ? "Next 14 days" : "Next 48 hours"}</h3>
      <p class="hv-h">${R(mn)}° to ${R(mx)}°</p>
      <p class="hv-d" id="hDaysSub">${dayHint()}</p></header>
      <div class="hseg" role="tablist" aria-label="Forecast range"><button role="tab" data-v="h" aria-selected="${view === "h"}">48 h</button><button role="tab" data-v="d" aria-selected="${view === "d"}">14 days</button></div></div>
    <div class="hfade hv-h"><div class="hscroll hv-h" tabindex="0" aria-label="Hourly forecast, scroll sideways"><div class="hin${labelled ? "" : " dry"}" style="grid-template-columns:repeat(${n},${colW}px);width:${W}px">${track}${cols.join("")}${svg}</div></div></div>
    <div class="hfade hv-d"><div class="hscroll hv-d" id="hDays" tabindex="0" aria-label="Daily forecast, scroll sideways">${view === "d" ? dayStrip() : ""}</div></div>
    <div class="hdots"><div class="dscroll hv-h" aria-hidden="true"></div><div class="dscroll hv-d" aria-hidden="true"></div><button class="info-i hv-h rain-i" aria-label="What the chance of rain and the amount mean"><svg viewBox="0 0 12 12"><path d="M6 5.4v3.6"/><path d="M6 3h.01"/></svg></button></div>
    <div class="hv-d hfoot"><span class="hfoot-l"><button class="hall-main" id="hAll">Full forecast<svg viewBox="0 0 12 12" aria-hidden="true"><path d="M2.5 6h7M6.5 3l3 3-3 3"/></svg></button><button class="info-i rain-i" aria-label="What the chance of rain and the amount mean"><svg viewBox="0 0 12 12"><path d="M6 5.4v3.6"/><path d="M6 3h.01"/></svg></button></span><button class="hall" id="hSure">How sure?<svg viewBox="0 0 12 12" aria-hidden="true"><path d="M4.5 2.5L8 6l-3.5 3.5"/></svg></button></div>`; // the hidden view is built when it is first opened
  for (const v of ["h", "d"]) dotScroll(el.querySelector(`.hscroll.hv-${v}`), el.querySelector(`.dscroll.hv-${v}`));
  el.querySelectorAll(".rain-i").forEach(b => b.onclick = openRainLearn); // in the 48 hours at the end of the scroll dots, in the 14 days beside "Full forecast"
}
/* A plain-language explainer of the chance of rain and the amount, starting from today's numbers. */
function openRainLearn() {
  const look = dayLook(X.di), inch = S.precip === "inch", mm = v => inch ? `${(v / 25.4).toFixed(v < 2.5 ? 2 : 1)} in` : `${v} mm`;
  const wet = toMm(look.mm) >= .1, now = look.pop != null && look.pop >= 5
    ? `Today: a ${look.pop}% chance of rain${wet ? `, about ${fmtP(look.mm)} ${PU()} if it comes` : ", and hardly any if it does"}.`
    : wet ? `Today: about ${fmtP(look.mm)} ${PU()} of rain expected.` : "Today: no rain in the forecast.";
  $("#learnTitle").textContent = "Chance and amount";
  $("#learnBody").innerHTML = `${now ? `<p class="now">${esc(now)}</p>` : ""}
    <h3>Blue: rain in the forecast</h3><p>The dots and the number show how much: one dot each for ${mm(.1)}, ${mm(.5)}, ${mm(1)}, ${mm(2)} and ${mm(4)} in an hour (${mm(.2)}, ${mm(1)}, ${mm(2)}, ${mm(5)} and ${mm(10)} in a day), with drops falling onto them, more often the harder it rains.</p>
    <h3>Grey: only a chance</h3><p>The forecast itself stays dry there, but some of its runs bring rain; the grey number is that chance. Grey never rains.</p>
    <h3>Why a high chance can still be grey</h3><p>The amount comes from the main forecast, the chance from dozens of slightly different runs of it. When the main forecast keeps it dry until seven o'clock but three in four runs already bring rain at six, the six o'clock hour shows a grey 75%: rain is quite possible, it's just not the best guess yet. The precipitation card above works the same way: its grey columns are the chance in a dry spell.</p>
    <h3>Chance of rain</h3><p>How likely it is that it rains here at all: at least ${mm(.1)} in that hour. It comes from running the forecast dozens of times, each with slightly different starting conditions. A 70% chance means about 7 in 10 of those runs bring rain to this spot. For a whole day, the highest hour counts.</p>
    <h3>What it doesn't mean</h3><p>A 30% chance doesn't mean rain over 30% of the area, or for 30% of the time. It's the chance that you get wet here, however briefly.</p>
    <h3>Amount</h3><p>How much water falls if it rains, in ${inch ? "inches" : "millimetres"}. ${inch ? "A tenth of an inch" : "1 mm"} is ${inch ? "about 2.5 litres" : "1 litre"} on every square metre. A day with less than ${mm(.5)} is barely wet; ${mm(10)} or more is a properly rainy day.</p>
    <h3>Why you need both</h3><p>They answer different questions. A 70% chance with ${mm(.3)} is almost surely a little drizzle. A 20% chance with ${mm(8)} is probably dry, but if that shower does hit you, it pours.</p>`;
  $("#dlgLearn").setAttribute("aria-label", "Chance of rain and amount"); $("#dlgLearn").showModal();
}
/* A sideways strip shows a row of dots under it instead of a scrollbar: a few lit dots travel along as it scrolls, like a
   dot-matrix display, and dragging along the dots scrolls the strip. */
function dotScroll(sc, bar) {
  if (!sc || !bar) return;
  let n = 0, shown = "";
  const draw = () => {
    const W = bar.clientWidth, max = sc.scrollWidth - sc.clientWidth; if (!W) return;
    const N = Math.max(8, Math.floor(W / 9));
    if (N !== n) { n = N; shown = ""; bar.innerHTML = "<i></i>".repeat(N); }
    bar.style.visibility = max > 1 ? "" : "hidden";
    const size = clamp(Math.round(N * sc.clientWidth / sc.scrollWidth), 2, N), at = max > 0 ? Math.round((N - size) * sc.scrollLeft / max) : 0;
    if (shown === `${size},${at}`) return; shown = `${size},${at}`;
    [...bar.children].forEach((d, k) => d.classList.toggle("on", k >= at && k < at + size));
  };
  sc.addEventListener("scroll", perFrame(draw), { passive: true });
  if ("ResizeObserver" in window) new ResizeObserver(() => draw()).observe(sc);
  const go = e => { const r = bar.getBoundingClientRect(); sc.scrollLeft = clamp((e.clientX - r.left) / r.width, 0, 1) * (sc.scrollWidth - sc.clientWidth); };
  bar.addEventListener("pointerdown", e => { if (e.button) return; bar.setPointerCapture(e.pointerId); go(e); });
  bar.addEventListener("pointermove", e => { if (bar.hasPointerCapture(e.pointerId)) go(e); });
  wheelStep(bar, d => sc.scrollBy({ left: d * Math.max(48, sc.clientWidth / 6), behavior: "smooth" })); // a sixth of the strip per notch
  whenMeasured(draw);
}
/* The next 14 days as columns: each day's low-to-high range as a bar on one shared scale, coloured by temperature,
   with the chance of rain in dots. Tapping a day opens the full forecast with that day unfolded. */
function dayStrip() {
  const { Dy, di, c } = X;
  const idx = []; for (let i = di; i < Dy.time.length && idx.length < 14; i++) idx.push(i);
  const lo = Math.min(...idx.map(i => Dy.temperature_2m_min[i]).filter(v => v != null));
  const hi = Math.max(...idx.map(i => Dy.temperature_2m_max[i]).filter(v => v != null));
  const P = v => ((v - lo) / ((hi - lo) || 1) * 100).toFixed(1);
  const tc = v => window.Palette.tempFam(toC(v)).mid;
  const cols = idx.map((i, n) => {
    const look = dayLook(i), key = Dy.time[i], [label, kind] = wmo(look.code);
    const mn = Dy.temperature_2m_min[i], mx = Dy.temperature_2m_max[i], pop = look.pop;
    // the gauge shows the day's amount (rainLabel above); a day without it but with a chance shows that chance in grey
    const dmm = toMm(look.mm ?? 0), lit = AMT_D.filter(v => dmm >= v).length;
    // a day with rain in the forecast (0.2 mm or more): drops fall through the empty dots as in the 48 hours, their
    // rhythm set by how hard it rains while it rains (the day's amount over its hours of rain)
    const rains = dmm >= .2 && lit < 5;
    const rate = dmm / Math.max(1, Dy.precipitation_hours?.[i] ?? 1);
    const per = (3.38 - Math.min(8, Math.ceil(Math.log2(1 + rate * 4) * 1.6)) * .17).toFixed(2), stepT = per * .06, t0 = .8 + ((n * 7919) % 97) / 97 * per; // as in the 48 hours
    let pd = ""; for (let q = 0; q < 5; q++) pd += `<circle${rains && q === lit - 1 ? ` class="htop" style="--p:${per}s;--w2:${(t0 + (5 - lit) * stepT).toFixed(2)}s"` : ""} cx="4" cy="${26 - q * 5.5}" ${q < lit ? `r="2.2" fill="var(--rain)"` : `r="1.5" fill="currentColor" opacity=".18"`}/>`;
    if (rains) for (let j = 0; j < 5 - lit; j++) pd += `<circle class="drip" cx="4" cy="${26 - (4 - j) * 5.5}" r="2.2" fill="var(--rain)" style="--p:${per}s;--w:${(t0 + j * stepT).toFixed(2)}s"/>`;
    const now = n === 0 && c.temperature_2m != null ? `<span class="nd" style="bottom:${P(clamp(c.temperature_2m, lo, hi))}%"></span>` : "";
    // an uncertain day: the bar reaches out by how much the models disagree, fading at both ends, so it reads as
    // "somewhere around here" rather than an exact range
    const uc = U && U[key], fuzz = uc && uc.conf !== "high" ? (uc.fz ?? uc.deg) * (S.temp === "f" ? 1.8 : 1) / 2 : 0;
    const top = clamp(+P(mx + fuzz), 0, 100), bot = clamp(+P(mn - fuzz), 0, 100), fz = fuzz ? clamp((top - +P(mx) + +P(mn) - bot) / 2 / Math.max(top - bot, 1) * 100 + 8, 8, 45) : 0;
    return `<button class="dcol${uc && uc.conf === "low" ? " unsure" : ""}" data-n="${n}" aria-label="${n === 0 ? "Today" : wd(key) + " " + dm_(key)}: ${esc(label)}, ${R(mn)} to ${R(mx)} degrees${dmm >= .2 ? `, about ${fmtP(look.mm)} ${PU()} of rain` : ""}${pop != null ? `, ${pop}% chance of rain` : ""}${uc && uc.conf !== "high" ? ", models disagree" : ""}. Open details.">
      <span class="htime${n === 0 ? " now" : ""}">${n === 0 ? "Today" : wd(key)}</span>${icon(kind, true)}
      <em class="dhi hiT" style="--tc:${tc(mx)}">${degMid(R(mx))}</em>
      <span class="dbar"><span class="dfill${fuzz ? " fuzzy" : ""}" style="top:${(100 - top).toFixed(1)}%;bottom:${bot.toFixed(1)}%;--lo:${tc(mn)};--hi:${tc(mx)};--fz:${fz.toFixed(0)}%"></span>${now}</span>
      <em class="dlo">${degMid(R(mn))}</em>
      <div class="hpop"><svg viewBox="0 0 8 30" aria-hidden="true">${pd}</svg>${rainLabel(dmm, .2, look.mm, pop)}</div></button>`;
  });
  return `<div class="dstrip" style="grid-template-columns:repeat(${cols.length},minmax(58px,1fr));min-width:${cols.length * 58}px">${cols.join("")}</div>`;
}
$("#c-hourly").addEventListener("click", e => {
  const tab = e.target.closest(".hseg button");
  if (tab) {
    const v = tab.dataset.v, el = card("c-hourly"); store.set("hview", v); el.dataset.view = v;
    if (v === "d" && !$("#hDays").firstChild) $("#hDays").innerHTML = dayStrip();
    el.querySelectorAll(".hseg button").forEach(b => b.setAttribute("aria-selected", String(b === tab)));
    $("#hTitle").textContent = v === "d" ? "Next 14 days" : "Next 48 hours";
    return;
  }
  const col = e.target.closest(".dcol"); if (col) return openDays(+col.dataset.n);
  if (e.target.closest("#hAll")) openDays(null);
  if (e.target.closest("#hSure")) openSpread(0);
});
/* The 14-day view's subtitle: the range of the fortnight, as the 48-hour view shows its own (the Full forecast button
   already says the days open). */
function dayHint() {
  const { Dy, di } = X, lo = Math.min(...Dy.temperature_2m_min.slice(di, di + 14).filter(v => v != null)), hi = Math.max(...Dy.temperature_2m_max.slice(di, di + 14).filter(v => v != null));
  return `${R(lo)}° to ${R(hi)}°`;
}
/* Pops the full 14-day stack out in a sheet; with a day number, that day comes up unfolded. */
function openDays(n) {
  if (n != null) store.set("openDay", n);
  renderDays();
  $("#dlgDays").showModal();
  const sheet = $("#dlgDays .sheet");
  sheet.scrollTop = 0;
  if (n != null && n > 0) requestAnimationFrame(() => { const d = $("#deck .day.open"); if (d) sheet.scrollTop = d.offsetTop - 70; });
}

/* ---------------- how sure: the ECMWF ensemble ---------------- */
/* The European model run 51 times from slightly different starts. Fetched only when someone opens the sheet, kept
   for three hours, and boiled down per run to each day's high, low and rain. */
let ENS = null, spView = "t", spSel = 0;
async function openSpread(day) {
  spSel = day || 0;
  $("#dlgSpread").showModal();
  const key = `${X.lat},${X.lon},${S.temp},${S.precip}`;
  if (!ENS || ENS.key !== key || Date.now() - ENS.at > 3 * 36e5) {
    ENS = null; $("#spRead").textContent = ""; $("#spChart").hidden = true;
    $("#spSay").textContent = "Fetching the 51 runs…";
    try { ENS = await fetchEns(key); }
    catch { $("#spSay").textContent = "The ensemble isn't available right now. Try again in a moment."; return; }
  }
  $("#spChart").hidden = false;
  drawSpread();
}
async function fetchEns(key) {
  const j = await getJSON("https://ensemble-api.open-meteo.com/v1/ensemble?" + qs({
    latitude: X.lat, longitude: X.lon, timezone: "auto", forecast_days: 15, hourly: "temperature_2m,precipitation", models: "ecmwf_ifs025",
    temperature_unit: S.temp === "f" ? "fahrenheit" : "celsius", precipitation_unit: S.precip
  }));
  const H = j.hourly, days = [...new Set(H.time.map(t => t.slice(0, 10)))].filter(d => d >= X.todayKey);
  const at = Object.fromEntries(days.map((d, i) => [d, i]));
  const runs = Object.keys(H).filter(k => /^temperature_2m(_member\d+)?$/.test(k)).map(k => k.slice(14));
  const hi = [], lo = [], mm = [];
  for (const s of runs) {
    const t = H["temperature_2m" + s], p = H["precipitation" + s] || [];
    const h = days.map(() => -Infinity), l = days.map(() => Infinity), r = days.map(() => 0), n = days.map(() => 0);
    H.time.forEach((tm, k) => { const i = at[tm.slice(0, 10)]; if (i == null || t[k] == null) return; h[i] = Math.max(h[i], t[k]); l[i] = Math.min(l[i], t[k]); r[i] += p[k] ?? 0; n[i]++; });
    hi.push(h.map((v, i) => n[i] >= 20 ? v : null)); lo.push(l.map((v, i) => n[i] >= 20 ? v : null)); mm.push(r.map((v, i) => n[i] >= 20 ? v : null));
  }
  const keep = days.map((_, i) => hi.filter(m => m[i] != null).length >= 20); // a day needs most of the runs
  const n = keep.indexOf(false) < 0 ? days.length : keep.indexOf(false);
  return { key, at: Date.now(), days: days.slice(0, n), hi: hi.map(m => m.slice(0, n)), lo: lo.map(m => m.slice(0, n)), mm: mm.map(m => m.slice(0, n)), runs: runs.length };
}
const quant = (a, p) => { const s = a.filter(v => v != null).sort((x, y) => x - y); return s.length ? s[Math.min(s.length - 1, Math.max(0, Math.round(p * (s.length - 1))))] : null; };
const longDay = (key, i) => i === 0 ? "today" : i === 1 ? "tomorrow" : i < 7 ? dayOf(key).toLocaleDateString("en-GB", { weekday: "long", timeZone: "UTC" }) : `${wd(key)} ${dm_(key)}`;
function spreadStats() {
  const E = ENS, col = (A, i) => A.map(m => m[i]);
  const wet = S.precip === "inch" ? .04 : 1;
  return E.days.map((key, i) => {
    const h = col(E.hi, i), l = col(E.lo, i), r = col(E.mm, i).filter(v => v != null);
    const fi = X.Dy.time.indexOf(key);
    return { key, h10: quant(h, .1), h50: quant(h, .5), h90: quant(h, .9), l10: quant(l, .1), l90: quant(l, .9),
      wet: r.filter(v => v >= wet).length, n: r.length, mean: r.reduce((a, b) => a + b, 0) / (r.length || 1), r90: quant(r, .9),
      app: fi >= 0 ? X.Dy.temperature_2m_max[fi] : null };
  });
}
function drawSpread() {
  const E = ENS; if (!E) return;
  const st = spreadStats(), n = st.length; spSel = clamp(spSel, 0, n - 1);
  $("#spSeg").querySelectorAll("button").forEach(b => b.setAttribute("aria-pressed", String(b.dataset.v === spView)));
  $("#spRed").hidden = spView !== "t";
  // With Best match, today and tomorrow come from a sharper local model than these runs, so its line can fall outside
  // all of them; that is no error, and the note says so (only then)
  const outside = i => { const h = E.hi.map(m => m[i]).filter(v => v != null); return st[i].app != null && h.length && (st[i].app < Math.min(...h) - .5 || st[i].app > Math.max(...h) + .5); };
  $("#spLocal").hidden = !(spView === "t" && S.model === "best_match" && [0, 1].some(i => i < n && outside(i)));
  // one plain sentence first
  if (spView === "t") {
    const thr = S.temp === "f" ? 5.4 : 3, w = st.map(s => s.h90 - s.h10);
    let k = w.findIndex(v => v > thr); if (k < 0) k = n;
    const rest = st.slice(k), mx = Math.max(...w.slice(0, Math.max(k, 1)));
    $("#spSay").textContent = k === n ? `The runs agree all the way: highs within ${Math.max(1, R(mx))}° for the next ${n} days.`
      : k === 0 ? `The runs already differ today: a high anywhere from ${R(st[0].h10)}° to ${R(st[0].h90)}°.`
      : `${k === 1 ? "Today" : `Through ${longDay(st[k - 1].key, k - 1)}`} the runs agree within ${Math.max(1, R(mx))}°. After that, highs could be anywhere from ${R(Math.min(...rest.map(s => s.h10)))}° to ${R(Math.max(...rest.map(s => s.h90)))}°.`;
  } else {
    const best = st.reduce((m, s, i) => s.wet / (s.n || 1) > st[m].wet / (st[m].n || 1) ? i : m, 0), b = st[best];
    const many = st.filter(s => s.wet / (s.n || 1) >= .5).length;
    $("#spSay").textContent = b.wet / (b.n || 1) < .2 ? `Dry in almost every run for the next ${n} days.`
      : `Rain is likeliest ${longDay(b.key, best)}: wet in ${b.wet} of ${b.n} runs.${many > 1 ? ` ${many} days are wet in more than half the runs.` : ""}`;
  }
  // the chart
  const cv = $("#spCv"), sz = sizeCanvas(cv); if (!sz) return;
  const { ctx, w, h } = sz, padL = 30, padR = 6, top = 10, bot = 24, cw = (w - padL - padR) / n;
  const ink = document.documentElement.dataset.mode === "day" ? "16,15,24" : "255,255,255"; // the sheet's ink, dark by day and light at night
  const X0 = i => padL + (i + .5) * cw;
  ctx.font = "500 10px 'Isobar Digits', Geist, sans-serif"; ctx.textBaseline = "middle";
  const grid = (vals, Y, fmt) => { ctx.strokeStyle = `rgba(${ink},.08)`; ctx.lineWidth = 1; ctx.fillStyle = `rgba(${ink},.5)`; ctx.textAlign = "right";
    for (const v of vals) { const y = Math.round(Y(v)) + .5; ctx.beginPath(); ctx.moveTo(padL, y); ctx.lineTo(w - padR, y); ctx.stroke(); ctx.fillText(fmt(v), padL - 6, y); } };
  // day labels along the bottom
  ctx.textAlign = "center"; ctx.fillStyle = `rgba(${ink},.5)`;
  st.forEach((s, i) => { if (i % 2 === 0 || cw > 34) ctx.fillText(i === 0 ? "Now" : cw > 30 ? wd(s.key) : wd(s.key).slice(0, 2), X0(i), h - 8); }); // "Wed" as everywhere; two letters only when narrow
  // the selected day
  ctx.fillStyle = `rgba(${ink},.07)`; ctx.fillRect(padL + spSel * cw, top - 4, cw, h - top - bot + 8);
  if (spView === "t") {
    const all = E.hi.flat().filter(v => v != null).concat(st.map(s => s.app).filter(v => v != null));
    const step = S.temp === "f" ? 10 : 5, lo = Math.floor(Math.min(...all) / step) * step, hi = Math.ceil(Math.max(...all) / step) * step;
    const Y = v => top + (hi - v) / ((hi - lo) || 1) * (h - top - bot);
    const ticks = []; for (let v = lo; v <= hi; v += step) ticks.push(v);
    grid(ticks, Y, v => `${v}°`);
    // the band that holds 8 in 10 runs
    ctx.beginPath(); st.forEach((s, i) => ctx[i ? "lineTo" : "moveTo"](X0(i), Y(s.h90))); for (let i = n - 1; i >= 0; i--) ctx.lineTo(X0(i), Y(st[i].h10));
    ctx.closePath(); ctx.fillStyle = "rgba(138,150,255,.3)"; ctx.fill();
    // every run as a thin line
    ctx.strokeStyle = `rgba(${ink},.13)`; ctx.lineWidth = 1; ctx.lineJoin = "round";
    for (const m of E.hi) { ctx.beginPath(); let on = false; m.forEach((v, i) => { if (v == null) return; ctx[on ? "lineTo" : "moveTo"](X0(i), Y(v)); on = true; }); ctx.stroke(); }
    // the middle run, then the app's own forecast in the accent
    ctx.strokeStyle = `rgb(${ink})`; ctx.lineWidth = 2.2; ctx.beginPath(); st.forEach((s, i) => ctx[i ? "lineTo" : "moveTo"](X0(i), Y(s.h50))); ctx.stroke();
    ctx.strokeStyle = Palette.SIGNAL; ctx.fillStyle = Palette.SIGNAL; ctx.lineWidth = 1.6; ctx.setLineDash([3, 3]); ctx.beginPath();
    let on = false; st.forEach((s, i) => { if (s.app == null) return; ctx[on ? "lineTo" : "moveTo"](X0(i), Y(s.app)); on = true; }); ctx.stroke(); ctx.setLineDash([]);
    st.forEach((s, i) => { if (s.app == null) return; ctx.beginPath(); ctx.arc(X0(i), Y(s.app), i === spSel ? 4 : 2.6, 0, PI * 2); ctx.fill(); });
  } else {
    const Y = v => top + (1 - v) * (h - top - bot);
    grid([0, .5, 1], Y, v => `${Math.round(v * 100)}%`);
    st.forEach((s, i) => {
      const f = s.wet / (s.n || 1), bw = Math.min(cw * .62, 22), x = X0(i) - bw / 2, y = Y(f);
      ctx.fillStyle = `rgba(127,192,255,${(.35 + f * .5).toFixed(2)})`;
      ctx.beginPath(); ctx.roundRect ? ctx.roundRect(x, y, bw, Y(0) - y, [4, 4, 1, 1]) : ctx.rect(x, y, bw, Y(0) - y); ctx.fill();
      if (f >= .3 && cw > 20) { ctx.fillStyle = `rgba(${ink},.75)`; ctx.textAlign = "center"; ctx.fillText(`${Math.round(f * 100)}`, X0(i), y - 8); }
    });
  }
  // what the selected day holds
  const s = st[spSel], name = spSel === 0 ? "Today" : `${wd(s.key)} ${dm_(s.key)}`;
  $("#spRead").innerHTML = spView === "t"
    ? `<b>${esc(name)}</b><span>High <b>${R(s.h10)}–${R(s.h90)}°</b>, most likely ${R(s.h50)}°${s.app != null ? ` · in the app ${R(s.app)}°` : ""}</span><span>Low ${R(s.l10)}–${R(s.l90)}°</span>`
    : `<b>${esc(name)}</b><span>Wet in <b>${s.wet} of ${s.n}</b> runs</span><span>${fmtP(s.mean)} ${PU()} on average, up to ${fmtP(s.r90)} ${PU()} in the wettest runs</span>`;
  const box = $("#spChart"); box.setAttribute("aria-valuemin", 0); box.setAttribute("aria-valuemax", n - 1); box.setAttribute("aria-valuenow", spSel);
  box.setAttribute("aria-valuetext", $("#spRead").textContent);
}
(() => {
  const box = $("#spChart");
  const pick = perFrame(e => { if (!ENS) return; const r = box.getBoundingClientRect(), n = ENS.days.length, i = Math.floor((e.clientX - r.left - 30) / ((r.width - 36) / n)); if (clamp(i, 0, n - 1) !== spSel) { spSel = clamp(i, 0, n - 1); drawSpread(); } });
  const end = () => { box.classList.remove("grab"); removeEventListener("pointermove", pick); removeEventListener("pointerup", end); removeEventListener("pointercancel", end); };
  box.addEventListener("pointerdown", e => { if (e.button !== 0) return; box.classList.add("grab"); pick(e); addEventListener("pointermove", pick); addEventListener("pointerup", end); addEventListener("pointercancel", end); });
  box.addEventListener("keydown", e => {
    const d = { ArrowRight: 1, ArrowUp: 1, ArrowLeft: -1, ArrowDown: -1 }[e.key]; if (!d || !ENS) return;
    e.preventDefault(); spSel = clamp(spSel + d, 0, ENS.days.length - 1); drawSpread();
  });
  wheelStep(box, d => { if (!ENS) return; spSel = clamp(spSel + d, 0, ENS.days.length - 1); drawSpread(); }); // a day per notch
  $("#spSeg").addEventListener("click", e => { const b = e.target.closest("button"); if (b) { spView = b.dataset.v; drawSpread(); } });
  addEventListener("resize", () => { if ($("#dlgSpread").open) drawSpread(); });
})();

/* ---------------- 14 days ---------------- */
/* What a day looks like, told the way you would tell it (the 14-day list and the hours card's day columns both read
   this, so they always agree):
   - a thunderstorm whenever one is forecast;
   - rain or snow only when at least 0.2 mm is expected, and then the heaviest kind the day brings;
   - otherwise the sky of its daytime hours (08:00–20:00), by what most of them are, so one foggy or cloudy morning hour
     doesn't turn a sunny day into "Fog" or "Overcast" (the day's own code takes the single worst hour).
   Today counts only the hours still to come: at 17:00 a morning's drizzle no longer stands for "today". Days past the
   hourly forecast keep the day's own summary. The chance of rain is the day's highest; Open-Meteo stops giving it after
   about 11 days, and then it is null (the amount still comes). */
function dayLook(i) {
  const { Dy, H, hi, di } = X, key = Dy.time[i], today = i === di, ks = [];
  for (let k = 0; k < H.time.length; k++) if (H.time[k].startsWith(key) && (!today || k >= hi)) ks.push(k);
  const pops = ks.map(k => H.precipitation_probability[k]).filter(v => v != null);
  const pop = today && pops.length ? Math.max(...pops) : nz(Dy.precipitation_probability_max[i]);
  const mm = today ? ks.reduce((a, k) => a + (H.precipitation[k] ?? 0), 0) : Dy.precipitation_sum[i] ?? 0;
  const codes = ks.map(k => H.weather_code[k]).filter(c => c != null);
  let code = Dy.weather_code[i];
  if (codes.length) {
    const wet = codes.filter(c => c >= 51);
    if (codes.some(c => c >= 95)) code = Math.max(...codes);
    else if (toMm(mm) >= .2) code = normRain(wet.length ? Math.max(...wet) : Math.max(code ?? 61, 51), Math.max(...ks.map(k => toMm(H.precipitation[k] ?? 0)))); // named by its wettest hour
    else {
      const dayKs = ks.filter(k => { const h = +H.time[k].slice(11, 13); return h >= 8 && h < 20; }), use = dayKs.length ? dayKs : ks, n = {};
      for (const k of use) { const c = H.weather_code[k]; if (c != null) { const s = c >= 51 ? dryCode(H.cloud_cover[k]) : c; n[s] = (n[s] || 0) + 1; } } // a dry day's stray drizzle hour counts as its sky (dryCode)
      code = +Object.keys(n).sort((a, b) => n[b] - n[a] || b - a)[0]; // the most common; a tie goes to the cloudier
    }
  }
  return { code, pop, mm, rest: today };
}
/* Rain (or snow) falls in a day card when the day is likely wet (40%+ and at least 0.5 mm) or, past the days that come
   with a chance, when at least 1 mm is expected. More rain means more drops; a likelier forecast draws them brighter. */
function weatherFx(n, kind, pop, sumMm, lean) {
  if (!(pop != null ? pop >= 40 && sumMm >= .5 : sumMm >= 1)) return "";
  const snow = kind === "snow";
  const count = sumMm < 1 ? 16 : sumMm < 5 ? 26 : sumMm < 15 ? 36 : 48;
  const strength = clamp(((pop ?? 60) - 20) / 60, .45, 1);
  return fallDrops(n, snow ? "snow" : kind, count, strength, lean);
}
function renderDays() {
  const { Dy, di, c } = X, el = card("c-days");
  const idx = []; for (let i = di; i < Dy.time.length && idx.length < 14; i++) idx.push(i);
  const cl = idx.map(i => climFor(Dy.time[i])); // normals and records per day, once they're in
  const lo = Math.min(...idx.map(i => Dy.temperature_2m_min[i]).filter(v => v != null), ...cl.filter(Boolean).map(x => fromC(x.lo)));
  const hi = Math.max(...idx.map(i => Dy.temperature_2m_max[i]).filter(v => v != null), ...cl.filter(Boolean).map(x => fromC(x.hi)));
  const P = v => ((v - lo) / ((hi - lo) || 1) * 100).toFixed(1);
  const open = store.get("openDay", 0);
  const items = idx.map((i, n) => {
    const look = dayLook(i), key = Dy.time[i], [label, kind] = wmo(look.code);
    const mn = Dy.temperature_2m_min[i], mx = Dy.temperature_2m_max[i], pop = look.pop;
    const tc = v => window.Palette.tempFam(toC(v)).mid; // colour of a temperature on the shared scale
    const rise = Dy.sunrise[i] ? T(Dy.sunrise[i]) : null, set = Dy.sunset[i] ? T(Dy.sunset[i]) : null;
    const wdir = Dy.wind_direction_10m_dominant[i];
    return `<article class="day${n === open ? " open" : ""}" style="z-index:${n + 1}">
      ${weatherFx(n, kind, pop, toMm(look.mm), fallLean(wdir, Dy.wind_speed_10m_max[i] == null ? null : toMs(Dy.wind_speed_10m_max[i]) * 3.6 * .7))}
      <button class="day-h" aria-expanded="${n === open}" data-n="${n}">
        <span class="dn"><b>${n === 0 ? "Today" : wd(key)}</b><i>${n === 0 ? wd(key) + " " : ""}${dm_(key)}</i></span>
        ${icon(kind, true)}
        <span class="dp">${pop != null ? (pop >= 10 ? pop + "%" : "") : toMm(look.mm) >= .2 ? `${fmtP(look.mm)} ${PU()}` : ""}</span>
        <span class="dr"><em>${R(mn)}°</em><span class="bar">${cl[n] ? `<span class="nrm" style="left:${P(fromC(cl[n].lo))}%;right:${(100 - P(fromC(cl[n].hi))).toFixed(1)}%"></span>` : ""}<span class="fill" style="left:${P(mn)}%;right:${(100 - P(mx)).toFixed(1)}%;--lo:${tc(mn)};--hi:${tc(mx)}"></span>${n === 0 && c.temperature_2m != null ? `<span class="nd" style="left:${P(clamp(c.temperature_2m, lo, hi))}%"></span>` : ""}</span><em class="hiT" style="--tc:${tc(mx)}">${R(mx)}°</em></span>
      </button>
      <div class="day-b"><div class="day-bi"><div class="day-grid">
        <div class="say">${look.rest ? `Rest of today: ${esc(label.toLowerCase())}` : esc(label)}${pop != null ? `, ${pop}% chance of rain` : toMm(look.mm) >= .2 ? `, about ${fmtP(look.mm)} ${PU()} of rain` : ""}.</div>
        ${tile("Feels like", `${R(Dy.apparent_temperature_min[i])}° / ${R(Dy.apparent_temperature_max[i])}°`)}
        ${tile(look.rest ? "Rain today" : "Rain", `${fmtP(Dy.precipitation_sum[i])} ${PU()}`)}
        ${tile(look.rest ? "Rain hours today" : "Rain hours", `${R(Dy.precipitation_hours[i])} h`)}
        ${tile("Wind", `${R(Dy.wind_speed_10m_max[i])} ${WU[S.wind]}${wdir != null ? " " + pt16(wdir) : ""}`)}
        ${tile("Gusts", `${R(Dy.wind_gusts_10m_max[i])} ${WU[S.wind]}`)}
        ${tile("UV max", Dy.uv_index_max[i] != null ? Dy.uv_index_max[i].toFixed(1) : "–")}
        ${tile("Sunrise", fmtT(rise))}
        ${tile("Sunset", fmtT(set))}
        ${tile("Sunshine", dur(Dy.sunshine_duration[i]))}
        ${cl[n] ? tile("Normal", `${R(fromC(cl[n].lo))}° / ${R(fromC(cl[n].hi))}°`) : ""}
        ${cl[n] && cl[n].rh ? tile("Record high", `${R(fromC(cl[n].rh[0]))}° <small>${cl[n].rh[1]}</small>`) : ""}
        ${cl[n] && cl[n].rl ? tile("Record low", `${R(fromC(cl[n].rl[0]))}° <small>${cl[n].rl[1]}</small>`) : ""}
        ${U && U[key] ? `<button class="tile tile-go" data-spread="${n}"><span class="mono">Models</span><b>${U[key].n || 4} models within ${Math.max(1, Math.round(U[key].deg * (S.temp === "f" ? 1.8 : 1)))}°${U[key].lead >= 6 ? " · far ahead" : ""}</b><svg viewBox="0 0 12 12" aria-hidden="true"><path d="M4.5 2.5L8 6l-3.5 3.5"/></svg></button>` : ""}
      </div></div></div>
    </article>`;
  }).join("");
  el.innerHTML = `<div class="deck" id="deck">${items}</div>`;
  $("#daysRange").textContent = `${R(lo)}° – ${R(hi)}°`;
}

/* ---------------- UV ---------------- */
/* Heat haze from UV 6 up: the card's background, grain and gauge ripple like air over hot asphalt. */
const UVL =[[3, "Low", "mint"], [6, "Moderate", "amber"], [8, "High", "vermilion"], [11, "Very high", "crimson"], [1e9, "Extreme", "violet"]];
function renderUV() {
  const { c, H, hi, Dy, di } = X, el = card("c-uv");
  const uv = Math.max(0, c.uv_index ?? H.uv_index[hi] ?? 0);
  const L = UVL.find(l => uv < l[0]);
  paint(el, FAM[L[2]]);
  setHaze("uv", uv >= 6 ? clamp(4 + (uv - 6) * 2, 4, 14) : 0);
  let peak = 0, peakT = null, from = null, to = null;
  // only hours still to come: in the evening a peak earlier today is no news
  for (let k = hi; k < H.time.length && H.time[k].startsWith(X.todayKey); k++) {
    if (T(H.time[k]) < Date.now()) continue;
    const v = H.uv_index[k] ?? 0; if (v > peak) { peak = v; peakT = T(H.time[k]); }
    if (v >= 3) { if (!from) from = T(H.time[k]); to = T(H.time[k]); }
  }
  let ticks = "";
  for (let v = 0; v <= 12; v += 3) { const th = PI * (1 - v / 12); ticks += `<line x1="${100 + 86 * cos(th)}" y1="${100 - 86 * sin(th)}" x2="${100 + (v % 3 ? 90 : 94) * cos(th)}" y2="${100 - (v % 3 ? 90 : 94) * sin(th)}" stroke="currentColor" stroke-opacity="${v % 3 ? .38 : .75}" stroke-linecap="round"/>`; }
  const th = PI * (1 - clamp(uv, 0, 12) / 12), mx_ = 100 + 80 * cos(th), my_ = 100 - 80 * sin(th);
  const tri = `<line x1="${100 + 78 * cos(th)}" y1="${100 - 78 * sin(th)}" x2="${100 + 89 * cos(th)}" y2="${100 - 89 * sin(th)}" stroke="var(--signal)" stroke-width="6.5" stroke-linecap="round"/>`; // the capsule needle
  const sub = uv < 3 && peak >= 3 && from ? `Protection ${fmtT(from)}–${fmtT(new Date(to.valueOf() + 36e5))}` : Math.round(peak) > Math.round(uv) ? `Peak ${Math.round(peak)} at ${fmtT(peakT)}` : `Today's max ${R(Dy.uv_index_max[di])}`; // a peak only when it's higher than now, as shown
  el.innerHTML = `${head("UV index", L[1])}
    <div class="gauge"><svg viewBox="0 0 200 108" aria-hidden="true">${ticks}
      <path d="M20 100 A80 80 0 0 1 180 100" fill="none" stroke="currentColor" stroke-opacity=".3" stroke-width="2"/>
      <path d="M20 100 A80 80 0 0 1 ${mx_.toFixed(1)} ${my_.toFixed(1)}" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/>
      ${tri}</svg>
      <div class="gauge-v" role="img" aria-label="UV index ${uv < 10 ? uv.toFixed(1) : Math.round(uv)}">${dm(uv < 10 ? uv.toFixed(1) : String(Math.round(uv)))}</div></div>
    <div class="foot"><span>${esc(sub)}</span></div>`;
}

/* ---------------- humidity ---------------- */
function renderHumid() {
  const { c } = X, el = card("c-humid");
  const h = c.relative_humidity_2m, dp = c.dew_point_2m, dpC = toC(dp);
  // muggy air is described by its dew point (how much water it really holds); otherwise by how full the air is,
  // so cool air at 82% reads as humid rather than "dry"
  const lab = dpC == null || h == null ? "–" : dpC >= 21 ? "Oppressive" : dpC >= 18 ? "Muggy" : dpC >= 16 ? "A little muggy"
    : h >= 90 ? "Very humid" : h >= 75 ? "Humid" : h >= 45 ? "Comfortable" : h >= 25 ? "Dry" : "Very dry";
  // a slim meter on the right edge: a column of dots from 0% at the bottom to 100% (saturated air) at the top, lit up
  // to the humidity now, with the needle on the level
  const lvl = clamp(h ?? 0, 0, 100), NG = 21, gauge = Array.from({ length: NG }, (_, k) => `<i class="${(NG - 1 - k) / (NG - 1) * 100 <= lvl ? "on" : ""}"></i>`).join("");
  const wet = (h ?? 0) >= 85; // condensation beads up on the card on very humid days
  el.innerHTML = `<div class="hgauge" aria-hidden="true"><span class="hg-top">100%</span><div class="hg-col">${gauge}<span class="tri" style="bottom:calc(2.5px + (100% - 5px) * ${(lvl / 100).toFixed(3)})"></span></div></div>
    ${wet ? `<canvas class="condense" id="humidCv" aria-hidden="true"></canvas>` : ""}${head("Humidity", lab)}
    <div class="num big">${R(h)}<small>%</small></div>
    <div class="foot"><span>Dew point <b>${R(dp)}°</b></span><button class="info-i" id="humidInfo" aria-label="How humidity, dew and fog work"><svg viewBox="0 0 12 12"><path d="M6 5.4v3.6"/><path d="M6 3h.01"/></svg></button></div>`;
  $("#humidInfo").onclick = () => openLearn(c.temperature_2m, dp, h);
  if (wet) whenMeasured(() => startCondensation($("#humidCv"))); else condStop();
}

/* A plain-language explainer of humidity, dew point, dew, frost and fog, starting from today's numbers. */
function openLearn(t, dp, h) {
  const gap = t != null && dp != null ? R(t) - R(dp) : null, F = S.temp === "f", mi = F || S.precip === "inch";
  const frz = F ? 32 : 0, dry = F ? 61 : 16, sticky = F ? 64 : 18, heavy = F ? 70 : 21; // the same steps as the humidity card's labels
  const now = gap == null ? "" : gap <= 1
    ? `Right now the air is ${R(t)}° and the dew point ${R(dp)}°. They're almost the same, so the air is close to full: dew, mist or fog are likely.`
    : `Right now the air is ${R(t)}° and the dew point ${R(dp)}°. A surface has to cool ${gap}° below the air before dew forms on it${R(dp) <= frz ? ", and since that's below freezing it would be frost" : ""}.`;
  $("#learnTitle").textContent = "Humidity, dew and fog"; $("#dlgLearn").setAttribute("aria-label", "Humidity, dew and fog");
  $("#learnBody").innerHTML = `${now ? `<p class="now">${esc(now)}</p>` : ""}
    <h3>Humidity</h3><p>Air always carries some water as invisible vapour. Warm air can hold much more than cold air. Humidity (${R(h)}% now) says how full the air is compared with the most it can hold at its current temperature.</p>
    <h3>Dew point</h3><p>The temperature the air would have to cool to before it's completely full (100%). It tells you how much water is really in the air: the higher it is, the muggier it feels. Below ${dry}° it feels fresh, from ${dry}° a little muggy, from ${sticky}° muggy and from ${heavy}° oppressive.</p>
    <h3>Dew</h3><p>On clear, calm nights, grass, leaves and car roofs lose heat to the open sky and get colder than the air around them. Once a surface is colder than the dew point, water condenses on it, just like drops on a cold glass of water. If the surface is below ${frz}°, it becomes frost instead.</p>
    <h3>Mist and fog</h3><p>When the air itself cools down to its dew point, the water condenses into tiny floating droplets. You call it mist if you can still see over ${mi ? "half a mile" : "1 km"}, and fog below that. It mostly forms on still, clear nights, or when damp air moves over cold ground or water.</p>
    <h3>Why humidity peaks at night</h3><p>The amount of water in the air hardly changes over a day, but cooler night air can hold less of it. So humidity climbs towards 100% at night and drops again as the sun warms the air.</p>`;
  $("#dlgLearn").showModal();
}

/* ---------------- air ---------------- */
const EAQ = [[20, "Good", "mint"], [40, "Fair", "azure"], [60, "Moderate", "amber"], [80, "Poor", "coral"], [100, "Very poor", "crimson"], [1e9, "Extremely poor", "violet"]];
function renderAir() {
  const el = card("c-air"), a = AQ && AQ.current;
  if (!a && airWait) { el.innerHTML = `<div class="sk"></div>`; return; } // still on its way: no "unavailable" yet
  if (!a || a.european_aqi == null) {
    paint(el, FAM.night);
    el.innerHTML = `${head("Air quality", "Unavailable")}<p class="empty">Air quality data from CAMS isn't available for this spot right now.</p>`; return;
  }
  const v = a.european_aqi, li = EAQ.findIndex(l => v < l[0]), L = EAQ[li];
  paint(el, FAM[L[2]]);
  let peak = v, peakT = null; const HA = AQ.hourly;
  // looking ahead only: a worse hour earlier today is past
  if (HA) { const start = HA.time.findIndex(t => T(t) > new Date()); for (let k = Math.max(0, start); k < Math.min(HA.time.length, start + 24); k++) if ((HA.european_aqi[k] ?? 0) > peak) { peak = HA.european_aqi[k]; peakT = T(HA.time[k]); } }
  const rows = [["PM2.5", a.pm2_5, 15], ["PM10", a.pm10, 45], ["O₃", a.ozone, 100], ["NO₂", a.nitrogen_dioxide, 25], ["SO₂", a.sulphur_dioxide, 40]].filter(r => r[1] != null);
  // the scale as a row of 24 dots, five index points each (0–120), lit up to the value now
  const scale = Array.from({ length: 24 }, (_, k) => `<i class="${k * 5 < v ? "on" : ""}"></i>`).join("");
  // the pollutant figures are for the curious: folded away behind a small toggle, which remembers its state
  const open = store.get("airOpen", false);
  // polluted air shows: a smog veil from Moderate up, thicker the higher the index, and fine particles drifting with
  // the wind, as many as the PM2.5 count (from 5 µg/m³, the WHO yearly guideline)
  const smog = v >= 40 ? clamp(.25 + (v - 40) / 60 * .5, .25, .75) : 0, pm = a.pm2_5 ?? 0;
  const ms = toMs(X.c.wind_speed_10m ?? 0), east = sin((X.c.wind_direction_10m ?? 270) * rad) < 0, rnd = prng(Math.round(pm * 10) + 7);
  const motes = pm >= 5 ? Array.from({ length: Math.round(clamp(pm * 1.2, 4, 60)) }, () => `<i style="left:${(rnd() * 100).toFixed(1)}%;top:${(rnd() * 100).toFixed(1)}%;--t:${(clamp(16 / (1 + ms / 3), 4, 16) * (.7 + rnd() * .6)).toFixed(1)}s;--d:-${(rnd() * 16).toFixed(1)}s;--dx:${east ? "" : "-"}${(30 + rnd() * 30).toFixed(0)}px;--dy:${((rnd() - .5) * 24).toFixed(0)}px;--o:${(.35 + rnd() * .5).toFixed(2)}"></i>`).join("") : "";
  // clean air (Good) shows too: the card turns a touch clearer, with soft light falling in from above that drifts very
  // slowly, like sun through trees; the cleaner the air, the clearer the light
  const clear = v < 20 ? .45 + (20 - v) / 20 * .55 : 0;
  // and when the air is excellent (index under 15, the cleanest part of Good), hairline glints twinkle like stars: three
  // of them, each lit for about a second in a cycle of 10 to 14 s, and each time somewhere new (see below)
  const spot = () => [`${(8 + Math.random() * 86).toFixed(0)}%`, `${(10 + Math.random() * 78).toFixed(0)}%`], glintAt = () => { const [l, t] = spot(); return `left:${l};top:${t}`; };
  const sparks = v < 15 ? Array.from({ length: 3 }, (_, i) => `<i class="air-glint" style="${glintAt()};--t:${(10 + Math.random() * 4).toFixed(1)}s;--d:-${(i * 4 + Math.random() * 1.5).toFixed(1)}s"></i>`).join("") : "";
  el.innerHTML = `${clear ? `<span class="clear-air" aria-hidden="true" style="--s:${clear.toFixed(2)}"></span>` : ""}${sparks ? `<span class="sparks" aria-hidden="true">${sparks}</span>` : ""}${smog ? `<span class="smog" aria-hidden="true" style="opacity:${smog.toFixed(2)}"></span>` : ""}${motes ? `<span class="motes" aria-hidden="true">${motes}</span>` : ""}<div class="air${open ? " open" : ""}"><div class="air-l">${head("Air quality", L[1])}
      <span class="air-v" role="img" aria-label="European AQI ${Math.round(v)}, ${L[1].toLowerCase()}">${dm(String(Math.round(v)))}</span>
      <span class="mono">European AQI</span>
      <div class="scale" aria-hidden="true">${scale}<span class="tri" style="left:calc(2.5px + (100% - 5px) * ${clamp(v / 115, 0, 1).toFixed(3)})"></span></div>
      <div class="air-foot"><span class="mono">${peakT ? `Worst around ${fmtTD(peakT)}` : "Steady over the next 24 h"}</span>
      <button class="air-more mono" id="airMore" aria-expanded="${open}" aria-controls="airPol">Pollutants<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 9.5l6 6 6-6"/></svg></button></div></div>
    <div class="pol-wrap" id="airPol"><div><div class="pol tile">${rows.map(([n, val, lim]) => `<div class="pol-r"><span class="mono">${n}</span><div class="mbar"><div class="fill" style="width:${clamp(val / (lim * 2) * 100, 2, 100)}%"></div><span class="lim" style="left:50%"></span></div><span class="v">${val < 10 ? val.toFixed(1) : Math.round(val)}<small>µg/m³</small></span></div>`).join("")}
      <span class="mono lim-key" title="WHO air quality guideline: the most it should be on average over 24 hours (ozone: over 8 hours)"><i aria-hidden="true"></i>WHO recommended maximum</span>${a.us_aqi != null ? `<span class="mono pol-us">US AQI ${Math.round(a.us_aqi)}</span>` : ""}</div></div></div></div>`;
  el.querySelectorAll(".air-glint").forEach(g => g.addEventListener("animationiteration", () => { [g.style.left, g.style.top] = spot(); })); // a new spot each time
  $("#airMore").onclick = () => {
    const box = el.querySelector(".air"), on = !box.classList.contains("open");
    box.classList.toggle("open", on); $("#airMore").setAttribute("aria-expanded", on); store.set("airOpen", on);
  };
}

/* ---------------- moon ---------------- */
const MOON_RANGE = 120; // days either side of today
const dlab = d => d ? new Intl.DateTimeFormat("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: TZ }).format(d) : "–";
function renderMoon() {
  const el = card("c-moon");
  // stars kept clear of the moon itself, so none show through its dark side
  el.innerHTML = `${starField(4111, 20, (x, y) => x < 44 && y > 14 && y < 82)}
    <header class="ch"><h3 id="moonWhen">Moon</h3><p id="moonPhase"></p></header>
    <button class="hero-now" id="moonNow" hidden>Today</button>
    <div class="moon"><canvas id="moonCv" role="img"></canvas>
      <div class="moon-stats">
        <div><span class="num big" id="moonLit"></span></div>
        <div class="kv" id="moonKv"></div>
      </div></div>
    <div class="strip" id="moonStripBox" role="slider" tabindex="0" aria-label="Moon phase by date. Drag, scroll or use the arrow keys to move through the days." aria-valuemin="${-MOON_RANGE}" aria-valuemax="${MOON_RANGE}"><canvas id="moonStrip" aria-hidden="true"></canvas></div>`;
  X.moonOff = 0; X.moonDay = null;
  updateMoon(0);
  bindMoonScrub();
}
/* Moves the moon card to a day offset from today; fractional offsets let the phase change smoothly while dragging. */
function updateMoon(off) {
  off = clamp(off, -MOON_RANGE, MOON_RANGE); X.moonOff = off;
  const { lat, lon } = X, base = T(X.todayKey + "T12:00"), day = Math.round(off);
  const at = Math.abs(off) < 1e-3 ? new Date() : new Date(base.valueOf() + off * dayMs);
  const mi = moonIllum(at);
  X.moon = { phase: mi.phase, south: lat < 0, base };
  $("#moonPhase").textContent = phaseName(mi.phase);
  $("#moonLit").innerHTML = `${Math.round(mi.fraction * 100)}<small>% lit</small>`;
  $("#moonWhen").textContent = day === 0 ? "Moon" : dlab(new Date(base.valueOf() + day * dayMs));
  $("#moonNow").hidden = Math.abs(off) < .5;
  if (X.moonDay !== day) {
    // rise, set and the next full and new moon only change per day, so work them out once per day
    X.moonDay = day;
    const t0 = new Date(T(X.todayKey + "T00:00").valueOf() + day * dayMs);
    const mt = moonTimes(t0, lat, lon), from = day === 0 ? new Date() : t0;
    let nextFull = null, nextNew = null, prev = moonIllum(from).phase;
    for (let h = 3; h < 24 * 32 && !(nextFull && nextNew); h += 3) {
      const t = new Date(from.valueOf() + h * 36e5), p = moonIllum(t).phase;
      if (!nextFull && prev < .5 && p >= .5) nextFull = t;
      if (!nextNew && prev > .8 && p < .2) nextNew = t;
      prev = p;
    }
    const none = day === 0 ? "None today" : "None";
    // the next full and new moon: the weekday goes with the short label ("Full · Mon"), so the date stays whole on one line
    const dm = d => d ? new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", timeZone: TZ }).format(d) : "–", wkd = d => d ? " · " + new Intl.DateTimeFormat("en-GB", { weekday: "short", timeZone: TZ }).format(d) : "";
    $("#moonKv").innerHTML = tile("Moonrise", mt.rise ? fmtTu(mt.rise) : none) + tile("Moonset", mt.set ? fmtTu(mt.set) : none) + tile("Full" + wkd(nextFull), dm(nextFull)) + tile("New" + wkd(nextNew), dm(nextNew));
  }
  const box = $("#moonStripBox");
  box.setAttribute("aria-valuenow", day);
  box.setAttribute("aria-valuetext", `${day === 0 ? "Today" : dlab(new Date(base.valueOf() + day * dayMs))}, ${phaseName(mi.phase)}, ${Math.round(mi.fraction * 100)} percent lit`);
  // a soft halo that grows with the lit fraction: barely there at a crescent, gentle at full moon
  const g = Math.pow(mi.fraction, 1.6), cv = $("#moonCv");
  cv.style.filter = `drop-shadow(0 0 ${(6 + 22 * g).toFixed(1)}px rgba(214,220,255,${(.04 + .3 * g).toFixed(3)}))`;
  cv.setAttribute("aria-label", `${phaseName(mi.phase)}, ${Math.round(mi.fraction * 100)} percent lit`);
  drawMoons();
}
function drawMoons() {
  if (!X.moon || !D) return;
  if (holdDraw) return void holdDraw.add(drawMoons);
  const cv = $("#moonCv"), st = $("#moonStrip"); if (!cv || !st) return;
  drawBigMoon(cv, X.moon.phase, X.moon.south);
  drawStrip(st, X.moonOff || 0, X.moon.base, X.moon.south);
}
let moonAnim = 0;
function moonGlide(to) {
  cancelAnimationFrame(moonAnim);
  X.moonTarget = to;
  const from = X.moonOff, t0 = performance.now(), dur = Math.min(900, 250 + Math.abs(to - from) * 12);
  const step = now => { const k = Math.min(1, (now - t0) / dur), e = 1 - Math.pow(1 - k, 3); updateMoon(from + (to - from) * e); if (k < 1) moonAnim = requestAnimationFrame(step); else X.moonTarget = null; };
  moonAnim = requestAnimationFrame(step);
}
function bindMoonScrub() {
  const box = $("#moonStripBox"), cv = $("#moonCv");
  let x0 = 0, o0 = 0, px = 1;
  const move = perFrame(e => updateMoon(o0 - (e.clientX - x0) / px));
  const end = () => { box.classList.remove("grab"); cv.classList.remove("grab"); removeEventListener("pointermove", move); removeEventListener("pointerup", end); removeEventListener("pointercancel", end); moonGlide(Math.round(X.moonOff)); };
  const down = e => {
    if (e.button !== 0) return;
    cancelAnimationFrame(moonAnim); X.moonTarget = null;
    // dragging the strip moves one day per moon; dragging the big moon is slower and finer
    px = e.currentTarget === box ? stripStep(box.clientWidth) : 8;
    x0 = e.clientX; o0 = X.moonOff; e.currentTarget.classList.add("grab");
    addEventListener("pointermove", move); addEventListener("pointerup", end); addEventListener("pointercancel", end);
  };
  box.addEventListener("pointerdown", down); cv.addEventListener("pointerdown", down);
  wheelStep(box, s => moonGlide(clamp((X.moonTarget ?? Math.round(X.moonOff)) + s, -MOON_RANGE, MOON_RANGE))); // a day per notch
  box.addEventListener("keydown", e => {
    const cur = X.moonTarget ?? Math.round(X.moonOff); // keep counting from where a running glide is heading
    const to = { ArrowRight: cur + 1, ArrowUp: cur + 1, ArrowLeft: cur - 1, ArrowDown: cur - 1, PageUp: cur + 7, PageDown: cur - 7, Home: 0 }[e.key];
    if (to == null) return; e.preventDefault(); moonGlide(clamp(to, -MOON_RANGE, MOON_RANGE));
  });
  $("#moonNow").onclick = () => moonGlide(0);
}

/* ---------------- sun ---------------- */
function renderSun() {
  const { Dy, di, lat, lon } = X, el = card("c-sun");
  const st = sunTimes(dayOf(X.todayKey), lat, lon);
  const mid0 = T(X.todayKey + "T00:00").valueOf();
  const fr = d => d && !isNaN(d) ? clamp((d - mid0) / dayMs, 0, 1) : null;
  const dl = Dy.daylight_duration[di], dly = di > 0 ? Dy.daylight_duration[di - 1] : null;
  const ch = dl != null && dly != null ? dl - dly : null;
  // the change in day length since yesterday, in the line at the bottom
  const chTxt = ch == null ? "–" : `${ch >= 0 ? "+" : "−"}${Math.floor(Math.abs(ch) / 60)}\u00a0min ${Math.round(Math.abs(ch) % 60)}\u00a0s`;
  const view = store.get("sunView", "day");
  const night = "#120a3a", tw = "#6a3fe0", gold = "#ff8a3c", day = "#ffe6b0";
  const stops = [];
  const add = (f, col) => { if (f != null) stops.push([f, col]); };
  if (fr(st.dawn) == null && fr(st.rise) == null) { const up = sunAlt(st.noon, lat, lon) > 0; add(0, up ? day : night); add(1, up ? day : night); }
  else { add(0, night); add(fr(st.dawn), night); add(fr(st.rise), tw); add(fr(st.goldenEnd), gold); add(fr(st.noon), day); add(fr(st.golden), gold); add(fr(st.set), tw); add(fr(st.dusk), night); add(1, night); }
  const grad = stops.sort((a, b) => a[0] - b[0]).map(([f, c]) => `<stop offset="${(f * 100).toFixed(2)}%" stop-color="${c}"/>`).join("");
  const sunsh = Dy.sunshine_duration[di];
  X.sunCard = { mid0, t: null };
  // two views, as in the hours card: today's sun, or the daylight through the whole year
  el.dataset.view = view;
  el.innerHTML = `<div class="ch-row"><header class="ch"><h3 id="sunWhen">Sun</h3><p id="sunSub"></p></header>
      <div class="hseg sseg" role="tablist" aria-label="Sun view"><button role="tab" data-v="day" aria-selected="${view === "day"}">Day</button><button role="tab" data-v="year" aria-selected="${view === "year"}">Year</button></div></div>
    <button class="hero-now" id="sunNow" hidden>Back to now</button>
    <div class="sun-day">
    <div class="band" id="sunBand" role="slider" tabindex="0" aria-label="Time of day. Drag, scroll or use the arrow keys to see the sun at another hour." aria-valuemin="0" aria-valuemax="1440"><svg viewBox="0 0 1000 30" preserveAspectRatio="none" aria-hidden="true"><defs><linearGradient id="sb">${grad}</linearGradient></defs><rect width="1000" height="30" fill="url(#sb)"/></svg><span class="tri" id="sunTri"></span>
      <div class="band-axis tm"><span>00</span><span>06</span><span>12</span><span>18</span><span>24</span></div></div>
    <div class="kv5">
      <div><span class="mono">First light</span><b>${fmtTu(st.dawn)}</b></div>
      <div><span class="mono">Sunrise</span><b>${fmtTu(Dy.sunrise[di] ? T(Dy.sunrise[di]) : null)}</b></div>
      <div><span class="mono">Solar noon</span><b>${fmtTu(st.noon)}</b></div>
      <div><span class="mono">Golden hour</span><b>${fmtTu(st.golden)}</b></div>
      <div><span class="mono">Sunset</span><b>${fmtTu(Dy.sunset[di] ? T(Dy.sunset[di]) : null)}</b></div>
      <div><span class="mono">Last light</span><b>${fmtTu(st.dusk)}</b></div>
    </div>
    <div class="foot"><span>Sunshine <b>${dur(sunsh)}</b></span><span>Day <b id="sunChange">${chTxt}</b></span></div>
    </div>
    <div class="sun-year" id="c-year"></div>`; // the daylight through the year fills this (renderYear runs right after)
  updateSun(null);
  bindSunCard();
}
/* Switches the sun card between today (day) and the daylight through the year (year), and remembers the choice. */
function setSunView(v) {
  const el = card("c-sun"); store.set("sunView", v); el.dataset.view = v;
  el.querySelectorAll(".sseg button").forEach(b => b.setAttribute("aria-selected", String(b.dataset.v === v)));
  updateSun(null); // back to now in the day view; in the year view this only resets the hidden band
  if (v === "year") { drawYear(); if (X.year) updateYear(X.year.cur ?? X.year.today); }
}
/* Moves the sun card to a time today (null = now). The card colour follows the sun's height at that moment. */
function updateSun(t) {
  const s = X.sunCard; if (!s) return;
  const live = t == null, at = live ? new Date() : new Date(clamp(t, s.mid0, s.mid0 + dayMs - 6e4));
  s.t = live ? null : at.valueOf();
  const alt = sunAlt(at, X.lat, X.lon) / rad, f = clamp((at - s.mid0) / dayMs, 0, 1);
  paint(card("c-sun"), window.Palette.skyPal(Math.round(alt * 2) / 2)); // half-degree steps: smooth to the eye, far fewer repaints
  $("#sunTri").style.left = `${(f * 100).toFixed(2)}%`;
  const state = alt > 6 ? `Sun ${Math.round(alt)}° high` : alt > -.8 ? "Golden hour" : alt > -6 ? "Twilight" : "Night";
  if (card("c-sun").dataset.view !== "year") { // the year view keeps its own heading
    $("#sunWhen").textContent = live ? "Sun" : fmtT(at);
    $("#sunSub").textContent = state; // now too: golden hour, twilight, night or how high the sun stands
  }
  $("#sunChange").parentElement.style.visibility = live ? "" : "hidden"; $("#sunNow").hidden = live;
  const band = $("#sunBand");
  band.setAttribute("aria-valuenow", Math.round(f * 1440));
  band.setAttribute("aria-valuetext", `${fmtT(at)}, ${state}`);
}
function bindSunCard() {
  const band = $("#sunBand"), s = X.sunCard;
  const tAt = e => { const r = band.getBoundingClientRect(); return s.mid0 + clamp((e.clientX - r.left) / r.width, 0, 1) * dayMs; };
  const cur = () => s.t ?? Date.now();
  const move = perFrame(e => updateSun(tAt(e)));
  const end = () => { band.classList.remove("grab"); removeEventListener("pointermove", move); removeEventListener("pointerup", end); removeEventListener("pointercancel", end); };
  band.addEventListener("pointerdown", e => {
    if (e.button !== 0) return;
    band.classList.add("grab"); updateSun(tAt(e));
    addEventListener("pointermove", move); addEventListener("pointerup", end); addEventListener("pointercancel", end);
  });
  wheelStep(band, s => updateSun(cur() + s * 15 * 6e4)); // a quarter of an hour per notch, as the arrow keys
  band.addEventListener("keydown", e => {
    const step = { ArrowRight: 15, ArrowUp: 15, ArrowLeft: -15, ArrowDown: -15, PageUp: 60, PageDown: -60 }[e.key];
    if (e.key === "Home") { e.preventDefault(); updateSun(null); return; }
    if (step == null) return; e.preventDefault(); updateSun(cur() + step * 6e4);
  });
  $("#sunNow").onclick = () => updateSun(null);
  card("c-sun").querySelector(".sseg").onclick = e => { const b = e.target.closest("button"); if (b) setSunView(b.dataset.v); };
}

/* ---------------- daylight through the year (glass) ---------------- */
/* Every day of this year as a thin column: down is the clock (0 at the top, 24 at the bottom), coloured as on the sun
   card: night, twilight, golden hour and daylight. Times are on the place's own clock, so the jumps where it switches
   between winter and summer time show as a step. Drag across it (or use the arrow keys) to read any day. */
const YEAR_COL = { night: "#120a3a", tw: "#6a3fe0", gold: "#ff8a3c", day: "#ffe6b0" };
// the year's 365 days only change with the place and the year, so they're worked out once and kept
let yearKept = null;
function yearData() {
  const year = +new Date(Date.now() + OFF * 1000).toISOString().slice(0, 4), yk = `${year}|${X.lat}|${X.lon}|${TZ}`;
  if (yearKept && yearKept.k === yk) { const t = yearKept.days.findIndex(d => d.key === X.todayKey); return { year, days: yearKept.days, today: t < 0 ? 0 : t }; }
  const fmt = new Intl.DateTimeFormat("en-GB", { timeZone: TZ, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
  const offH = d => { const p = Object.fromEntries(fmt.formatToParts(d).map(x => [x.type, x.value])); return (Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute) - d.valueOf()) / 36e5; };
  const days = [], n = (Date.UTC(year + 1, 0, 1) - Date.UTC(year, 0, 1)) / 864e5;
  // the clock offset, asked weekly (asking is slow, in Safari above all) and day by day only in a week where it changes
  const noonOf = i => new Date(Date.UTC(year, 0, 1 + i, 12) - OFF * 1000), offs = [];
  for (let a = 0; a < n - 1; a += 7) {
    const b = Math.min(a + 7, n - 1), oa = offs[a] ?? (offs[a] = offH(noonOf(a))), ob = offs[b] = offH(noonOf(b));
    for (let i = a + 1; i < b; i++) offs[i] = oa === ob ? oa : offH(noonOf(i));
  }
  for (let i = 0; i < n; i++) {
    const noonUTC = noonOf(i), off = offs[i], st = sunTimes(noonUTC, X.lat, X.lon);
    const h = t => t && !isNaN(t) ? (((t.valueOf() / 36e5 + off) % 24) + 24) % 24 : null; // a moment as hours on the local clock
    const up = sunAlt(st.noon, X.lat, X.lon) > 0;
    // the sun's height every quarter of an hour of the local day: the chart is drawn from these, so it is right at any latitude
    // (midnight sun, polar night, white nights where dusk runs into dawn), whatever the rise and set times do
    const alt = new Float32Array(97), mid = Date.UTC(year, 0, 1 + i) - off * 36e5;
    for (let k = 0; k <= 96; k++) alt[k] = sunAlt(new Date(mid + k * 9e5), X.lat, X.lon) / rad;
    days.push({ key: new Date(Date.UTC(year, 0, 1 + i)).toISOString().slice(0, 10), off, up, alt,
      dawn: h(st.dawn), rise: h(st.rise), ge: h(st.goldenEnd), noon: h(st.noon), gold: h(st.golden), set: h(st.set), dusk: h(st.dusk),
      rise_t: st.rise, set_t: st.set, len: !isNaN(st.rise) && !isNaN(st.set) ? (st.set - st.rise) / 6e4 : up ? 1440 : 0 });
  }
  const minOff = Math.min(...days.map(d => d.off));
  days.forEach(d => { d.summer = d.off > minOff; });
  // the moments the clocks change: found to the minute between the noons either side, as wall-clock times before and after
  const dst = [];
  for (let i = 1; i < n; i++) if (days[i].off !== days[i - 1].off) {
    let a = noonOf(i - 1).valueOf(), b = noonOf(i).valueOf();
    while (b - a > 6e4) { const m = Math.round((a + b) / 2 / 6e4) * 6e4; if (offH(new Date(m)) === days[i - 1].off) a = m; else b = m; }
    const t = b, wall = off => { const w = new Date(t + off * 36e5); return [w.getUTCHours(), w.getUTCMinutes()]; };
    dst.push({ i, key: days[i].key, from: wall(days[i - 1].off), to: wall(days[i].off), fwd: days[i].off > days[i - 1].off });
  }
  days.dst = dst;
  yearKept = { k: yk, days };
  const today = days.findIndex(d => d.key === X.todayKey);
  return { year, days, today: today < 0 ? 0 : today };
}
function renderYear() {
  const el = card("c-year"), Y = (X.year = yearData());
  el.innerHTML = `<header class="ch"><h3>Daylight</h3><p id="yrDate"></p></header>
    <button class="hero-now" id="yrNow" hidden>Today</button>
    <div class="yr-read num" id="yrLen"></div>
    <p class="yr-sub" id="yrSub"></p>
    <div class="yr-chart" id="yrChart" role="slider" tabindex="0" aria-label="Day of the year. Drag or use the arrow keys to see the daylight on another day." aria-valuemin="1" aria-valuemax="${Y.days.length}">
      <canvas id="yrCv" aria-hidden="true"></canvas>
      ${[6, 12, 18].map(hr => `<span class="yr-h tm" data-h="${hr}" style="top:${hr / 24 * 100}%"><i></i>${S.clock === "12" ? `${hr % 12 || 12}${hr < 12 ? "am" : "pm"}` : String(hr).padStart(2, "0")}</span>`).join("")}
      ${(Y.days.dst || []).map(c => { const x = (c.i / Y.days.length * 100); return `<span class="yr-dst${x > 55 ? " r" : ""}${c === Y.days.dst[0] ? " up" : ""}" style="left:${x.toFixed(2)}%"><b class="mono">${dm_(c.key)} · ${wallClock(c.from)} → ${wallClock(c.to)}</b></span>`; }).join("")}
      <span class="yr-today" style="left:${((Y.today + .5) / Y.days.length * 100).toFixed(2)}%"></span><span class="yr-sel" id="yrSel"></span></div>
    <div class="yr-axis tm" style="grid-template-columns:${Array.from({ length: 12 }, (_, m) => `${new Date(Date.UTC(Y.year, m + 1, 0)).getUTCDate()}fr`).join(" ")}">${["J", "F", "M", "A", "M", "J", "J", "A", "S", "O", "N", "D"].map(m => `<span>${m}</span>`).join("")}</div>`; // each letter spans its own month, as wide as its days, with a tick where it begins, so a day lines up under its month
  drawYear();
  updateYear(Y.today);
  bindYear();
}
function drawYear() {
  if (holdDraw) return void holdDraw.add(drawYear);
  const Y = X.year, cv = $("#yrCv"); if (!Y || !cv) return;
  const s = sizeCanvas(cv); if (!s) return;
  const { ctx, w, h } = s, n = Y.days.length, cw = w / n, mix = window.Palette.mix;
  // The sky's colour for the sun's height, as in the sun card: night until −6° (civil dawn), violet twilight up to
  // sunrise, golden light up to 6°, then warming to full day at that day's highest sun, so every day keeps its glow.
  const skyOf = d => { const peak = Math.max(...d.alt); return a => a <= -6 ? YEAR_COL.night : a <= -.833 ? mix(YEAR_COL.night, YEAR_COL.tw, (a + 6) / 5.167)
    : a <= 6 ? mix(YEAR_COL.tw, YEAR_COL.gold, (a + .833) / 6.833) : mix(YEAR_COL.gold, YEAR_COL.day, peak > 6 ? (a - 6) / (peak - 6) : 1); };
  Y.days.forEach((d, i) => {
    const g = ctx.createLinearGradient(0, 0, 0, h), sky = skyOf(d);
    for (let k = 0; k <= 96; k++) g.addColorStop(k / 96, sky(d.alt[k]));
    ctx.fillStyle = g; ctx.fillRect(Math.floor(i * cw), 0, Math.ceil(cw) + 1, h);
  });
  // the hour labels on the left edge take dark ink on bright sky and light ink on night, from the colour beneath them
  const d0 = Y.days[Math.min(n - 1, Math.floor(16 / cw))], sky0 = skyOf(d0);
  for (const lab of cv.parentElement.querySelectorAll(".yr-h")) {
    const c = parseInt(sky0(d0.alt[lab.dataset.h * 4]).slice(1), 16), l = ((c >> 16 & 255) * .3 + (c >> 8 & 255) * .59 + (c & 255) * .11) / 255;
    lab.classList.toggle("dk", l > .55);
  }
}
const hm = mins => dur(mins * 60);
// a wall-clock time [hours, minutes] in the chosen clock style
const wallClock = ([h, m]) => S.clock === "12" ? `${h % 12 || 12}${m ? ":" + String(m).padStart(2, "0") : ""} ${h < 12 ? "am" : "pm"}` : `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
function updateYear(i) {
  const Y = X.year; if (!Y) return;
  i = clamp(Math.round(i), 0, Y.days.length - 1); Y.cur = i;
  const d = Y.days[i], isToday = i === Y.today;
  const longest = Y.days.reduce((a, b) => b.len > a.len ? b : a), shortest = Y.days.reduce((a, b) => b.len < a.len ? b : a);
  $("#yrSel").style.left = `${((i + .5) / Y.days.length * 100).toFixed(2)}%`;
  $("#yrDate").textContent = isToday ? "Today" : `${wd(d.key)} ${dm_(d.key)}`;
  if (card("c-sun").dataset.view === "year") { $("#sunWhen").textContent = "Daylight"; $("#sunSub").textContent = $("#yrDate").textContent; }
  // today uses the forecast's own sunrise, sunset and day length, so it matches the sun card to the minute
  const api = isToday && X.Dy.sunrise[X.di] ? { rise: T(X.Dy.sunrise[X.di]), set: T(X.Dy.sunset[X.di]), len: X.Dy.daylight_duration[X.di] / 60 } : null;
  const riseT = api ? api.rise : d.rise_t, setT = api ? api.set : d.set_t, len = api && api.len ? api.len : d.len;
  $("#yrLen").textContent = hm(len);
  // one short line: the sun's hours, which clock time it is, and only the special days get a word
  const clock = Y.days.some(x => x.summer) ? (d.summer ? "summer time" : "winter time") : "";
  const change = (Y.days.dst || []).find(c => c.i === i);
  const special = change ? `clocks go ${change.fwd ? "forward" : "back"} at ${wallClock(change.from)}` : d === longest ? "longest day" : d === shortest ? "shortest day" : "";
  $("#yrSub").textContent = d.rise_t && !isNaN(d.rise_t) ? [`${fmtT(riseT)} – ${fmtT(setT)}`, clock, special].filter(Boolean).join(" · ") : d.up ? "The sun doesn't set" : "The sun doesn't rise";
  $("#yrNow").hidden = isToday;
  const box = $("#yrChart"); box.setAttribute("aria-valuenow", i + 1); box.setAttribute("aria-valuetext", `${$("#yrDate").textContent}, ${hm(len)} of daylight, sunrise to sunset ${$("#yrSub").textContent}`);
}
function bindYear() {
  const box = $("#yrChart"), at = e => { const r = box.getBoundingClientRect(); return (e.clientX - r.left) / r.width * X.year.days.length - .5; };
  const move = perFrame(e => updateYear(at(e)));
  const end = () => { box.classList.remove("grab"); removeEventListener("pointermove", move); removeEventListener("pointerup", end); removeEventListener("pointercancel", end); };
  box.addEventListener("pointerdown", e => { if (e.button !== 0) return; box.classList.add("grab"); updateYear(at(e)); addEventListener("pointermove", move); addEventListener("pointerup", end); addEventListener("pointercancel", end); });
  wheelStep(box, s => updateYear(X.year.cur + s)); // a day per notch
  box.addEventListener("keydown", e => {
    const step = { ArrowRight: 1, ArrowLeft: -1, ArrowUp: 1, ArrowDown: -1, PageUp: 30, PageDown: -30 }[e.key];
    if (e.key === "Home") { e.preventDefault(); updateYear(X.year.today); return; }
    if (step == null) return; e.preventDefault(); updateYear(X.year.cur + step);
  });
  $("#yrNow").onclick = () => updateYear(X.year.today);
}

/* ---------------- pressure (glass) ---------------- */
function renderPress() {
  const { c, H, hi } = X, el = card("c-press");
  const p = c.pressure_msl, p3 = H.pressure_msl[hi - 3];
  const dp = p != null && p3 != null ? p - p3 : null;
  // a change of 2 hPa or more in 3 hours is fast; the needle trembles, as on an old barometer before a storm
  const fast = dp != null && Math.abs(dp) >= 2;
  const trend = dp == null ? "Steady" : dp > 1 ? (fast ? "Rising fast" : "Rising") : dp < -1 ? (fast ? "Falling fast" : "Falling") : "Steady";
  const inHg = S.precip === "inch";
  const val = p == null ? "–" : inHg ? (p * 0.02953).toFixed(2) : Math.round(p);
  const A = v => (135 + (clamp(v, 960, 1060) - 960) / 100 * 270) * rad;
  const pt = (a, r) => [100 + r * cos(a), 100 + r * sin(a)];
  let ticks = "";
  for (let v = 960; v <= 1060; v += 20) { const a = A(v), big = true, [x1, y1] = pt(a, 86), [x2, y2] = pt(a, big ? 74 : 80); ticks += `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="currentColor" stroke-opacity="${big ? .8 : .32}" stroke-width="${big ? 1.6 : 1}" stroke-linecap="round"/>`; }
  const a = A(p ?? 1013), [tx, ty] = pt(a, 72), [bx, by] = pt(a, 86);
  const [s1x, s1y] = pt(A(960), 94), [s2x, s2y] = pt(A(1060), 94);
  el.innerHTML = `${head("Pressure", trend)}
    <div class="dial"><svg viewBox="0 0 200 188" aria-hidden="true">${ticks}
      <path d="M${s1x} ${s1y} A94 94 0 1 1 ${s2x} ${s2y}" fill="none" stroke="currentColor" stroke-opacity=".16" stroke-width="1"/>
      <line${fast ? ` class="tremble"` : ""} x1="${tx}" y1="${ty}" x2="${bx}" y2="${by}" stroke="var(--signal)" stroke-width="6.5" stroke-linecap="round"/>
      <circle cx="${pt(A(1013.25), 94)[0].toFixed(1)}" cy="${pt(A(1013.25), 94)[1].toFixed(1)}" r="2.6" fill="currentColor"><title>Standard pressure, 1013 hPa</title></circle></svg>
      <div class="dial-v" role="img" aria-label="${val} ${inHg ? "inches of mercury" : "hectopascals"}">${dm(String(val))}<span class="mono u">${inHg ? "inHg" : "hPa"}</span></div></div>
    <div class="foot"><span>Last 3 hours</span><b>${dp == null ? "–" : `${dp >= 0 ? "+" : "−"}${Math.abs(inHg ? dp * 0.02953 : dp).toFixed(inHg ? 2 : 1)}`}</b></div>`;
}

/* ---------------- visibility (glass) ---------------- */
function renderVis() {
  const { c, H, hi } = X, el = card("c-vis");
  const raw = c.visibility ?? H.visibility[hi];
  const unitFt = (D.current_units && D.current_units.visibility) === "ft";
  const km = raw == null ? null : unitFt ? raw * 0.0003048 : raw / 1000;
  const imperial = S.precip === "inch" || S.temp === "f";
  const show = km == null ? "–" : imperial ? (km / 1.609).toFixed(km / 1.609 < 10 ? 1 : 0) : (km < 10 ? km.toFixed(1) : Math.round(km));
  const lab = km == null ? "–" : km < 1 ? "Fog" : km < 4 ? "Mist or haze" : km < 10 ? "Moderate" : km < 20 ? "Good" : "Very clear";
  // Fading ridges: five hill lines at 1, 3, 8, 20 and 50 km, nearest at the bottom. Ridges within sight are
  // drawn with normal atmospheric depth; the one at the edge of visibility is half-lost, the rest vanish into haze.
  const RIDGES = [1, 3, 8, 20, 50], W = 240, Hh = 92;
  const lg = d => Math.log10(Math.max(d, .1));
  let paths = "", edge = null;
  for (let i = RIDGES.length - 1; i >= 0; i--) {
    const d = RIDGES[i], prev = i ? RIDGES[i - 1] : .3;
    const v = km == null ? 0 : clamp((lg(km) - lg(prev)) / (lg(d) - lg(prev)), 0, 1); // 1 = fully in sight
    if (v >= 1 && edge == null) edge = i; // farthest ridge that is fully clear
    const base = 80 - i * 13, amp = 6 - i * .8, ph = i * 1.7; // one or two gentle swells per ridge, a slight ripple on top
    // The ridge shape repeats every 240 units (the card width), so it can drift sideways forever without a seam.
    // Nearer ridges flow faster than distant ones (parallax), and each bobs gently on its own slow rhythm.
    let p = `M0 ${Hh}`;
    for (let x = 0; x <= W * 2; x += 8) p += ` L${x} ${(base - amp * (.8 * sin(x / W * 2 * PI * (1 + (i % 2)) + ph) + .2 * sin(x / W * 6 * PI + ph * 2))).toFixed(1)}`;
    // colour by distance (dark near, blue-grey far), then washed into the haze by how far out of sight it is
    const col = `color-mix(in oklab,color-mix(in oklab,var(--v-near),var(--v-far) ${Math.round(i / (RIDGES.length - 1) * 100)}%) ${Math.round(v * 100)}%,var(--v-haze))`;
    paths += `<path d="${p} L${W * 2} ${Hh}Z" style="fill:${col};--t:${(17 + i * 9)}s;--b:${(3.6 + i * 1.2).toFixed(1)}s;--dl:${(-i * 7.3).toFixed(1)}s"/>`;
  }
  // clarity 0 (thick fog, under 0.5 km) to 1 (30 km and more): how blue the sky is and how much haze hangs over it all
  const clear = km == null ? .5 : clamp((lg(km) - lg(.5)) / (lg(30) - lg(.5)), 0, 1);
  const fmtD = d => imperial ? `${Math.round(d / 1.609 * 10) / 10} mi` : `${d} km`; // the unit never parts from its number
  // one short line the number above doesn't say: where visibility is heading over the next 12 hours (hourly forecast)
  const toKm = v => v == null ? null : unitFt ? v * 0.0003048 : v / 1000, nice = d => fmtD(d >= 10 ? Math.round(d) : Math.round(d * 10) / 10);
  const next = []; for (let k = hi + 1; k <= hi + 12 && k < H.time.length; k++) { const v = toKm(H.visibility[k]); if (v != null) next.push([v, T(H.time[k])]); }
  let say = "";
  if (km != null && next.length) {
    const fog = km >= 1 && next.find(([v]) => v < 1), clearing = km < 1 && next.find(([v]) => v >= 2);
    const lo = next.reduce((m, x) => x[0] < m[0] ? x : m), hiV = next.reduce((m, x) => x[0] > m[0] ? x : m);
    say = fog ? `Fog likely by ${fmtTD(fog[1])}` : clearing ? `Clearing by ${fmtTD(clearing[1])}`
      : lo[0] < km * .6 ? `Down to ${nice(lo[0])} by ${fmtTD(lo[1])}` : hiV[0] > km * 1.6 && km < 20 ? `Up to ${nice(hiV[0])} by ${fmtTD(hiV[1])}` : "Steady for the next 12 h";
  }
  el.innerHTML = `<span class="vis-sky" aria-hidden="true" style="--clear:${Math.round(clear * 100)}%;--skyA:${(.35 + .4 * clear).toFixed(2)}"></span>
    <span class="vis-fog" aria-hidden="true" style="--fogA:${((1 - clear) * .75).toFixed(2)}"></span>
    ${head("Visibility", lab)}
    <div class="num big">${show}<small>${imperial ? "mi" : "km"}</small></div>
    <p class="vis-say">${esc(say)}</p>
    <div class="vis"><svg viewBox="0 0 ${W} ${Hh}" preserveAspectRatio="none" role="img" aria-label="You can see about ${show} ${imperial ? "miles" : "kilometres"}">${paths}</svg></div>`;
}

/* ---------------- rain totals ---------------- */
function renderRain() {
  const { di, H, hi } = X, el = card("c-rain");
  // the rest of today, as the 14 days' "Today" counts it (dayLook): the amount still to come and its chance, said so
  // in the subtitle, so the two never show different numbers for "today"
  const look = dayLook(di), today = look.mm, pop = look.pop;
  const next = []; for (let k = hi; k < hi + 24 && k < H.time.length; k++) next.push(H.precipitation[k] ?? 0);
  const sum24 = next.reduce((a, b) => a + b, 0), mx = Math.max(...next.map(toMm), 1);
  const bars = next.map((v, i) => { const h = toMm(v) / mx * 36; return `<rect x="${i * 10 + 2}" y="${40 - Math.max(h, 1.5)}" width="6" height="${Math.max(h, 1.5)}" rx="3" fill="currentColor" opacity="${v > 0 ? 1 : .24}"/>`; }).join("");
  el.innerHTML = `${head("Rain today", pop != null ? `Rest of day · ${pop}%` : "Rest of day")}
    <div class="num big">${fmtP(today)}<small>${PU()}</small></div>
    <div class="spark"><svg viewBox="0 0 240 42" preserveAspectRatio="none" aria-hidden="true">${bars}</svg></div>
    <div class="spark-ax">${[0, 12, 23].map(k => H.time[hi + k] ? `<span class="tm">${k ? fmtT(T(H.time[hi + k])) : "Now"}</span>` : "<span></span>").join("")}</div>
    <div class="foot"><span style="white-space:nowrap">Next 24 h <b>${fmtP(sum24)}</b> ${PU()}</span></div>`;
}

/* ---------------- clouds ---------------- */
function renderClouds() {
  const { c } = X, el = card("c-clouds");
  const cc = c.cloud_cover ?? 0;
  const lab = cc <= 12 ? "Clear" : cc <= 37 ? "Few clouds" : cc <= 62 ? "Scattered" : cc <= 87 ? "Broken" : "Overcast";
  if (el._drift) clearInterval(el._drift);
  el.innerHTML = `${head("Cloud cover", lab)}
    <div class="num big">${R(cc)}<small>%</small></div>
    <div class="field"></div>`;
  whenMeasured(() => cloudField(el, cc));
}
/* The dot field fills the room the card has: as many rows as fit below the number (at least six), always 14 across. */
function cloudField(el, cc) {
  const box = el.querySelector(".field"); if (!box) return;
  if (el._drift) clearInterval(el._drift);
  // the same fine grid as the rain card: a dot every ~15 px, filling only the room the card has below the number;
  // where that leaves fewer than six rows (a short card beside a tall one), the dots sit closer, down to 10 px apart
  const w = box.clientWidth || 200, pitch = clamp((box.clientHeight - 12) / 6, 10, 15), cols = Math.max(6, Math.round(w / pitch));
  const rows = clamp(Math.floor((box.clientHeight - 12) / pitch), 3, 14), total = cols * rows, lit = Math.round(cc / 100 * total);
  // a smooth field that wraps around the width, so the lit dots form cloud banks that can drift and come back round
  const T = 2 * PI / cols;
  const order = Array.from({ length: total }, (_, i) => { const x = i % cols, y = Math.floor(i / cols); return [i, sin(x * T + y * .55) + .6 * sin(2 * x * T + 1.7 - y * .8) + .35 * sin(3 * x * T + 4.1 + y * 1.1) + ((i * 9301 + 49297) % 233280) / 233280 * .45]; }).sort((a, b) => b[1] - a[1]).map(a => a[0]);
  const on = new Set(order.slice(0, lit));
  let dots = ""; for (let i = 0; i < total; i++) { const x = i % cols, y = Math.floor(i / cols); dots += `<circle cx="${x * 10 + 5}" cy="${y * 10 + 5}" r="2.5" fill="currentColor"${on.has(i) ? "" : ' class="off"'}/>`; }
  box.innerHTML = `<svg viewBox="0 0 ${cols * 10} ${rows * 10}" aria-hidden="true">${dots}</svg>`;
  el._fit = `${w}x${box.clientHeight}`;
  if (!lit || lit === total || calmMotion.matches) return;
  // the banks drift left to right one column at a time, like a dot-matrix ticker, at the pace of the wind:
  // a step every ~3 s when it's calm, ~1 s in a moderate breeze (5 m/s), a quarter second in a gale
  const dotEls = box.querySelectorAll("circle"), ms = toMs(X.c.wind_speed_10m ?? 0);
  const step = clamp(3200 / (1 + ms / 2.5), 230, 3200);
  el.style.setProperty("--drift", `${Math.min(450, step * .7) | 0}ms`);
  let shift = 0;
  el._drift = setInterval(() => {
    if (document.hidden || offscreen("c-clouds")) return;
    shift = (shift + 1) % cols;
    dotEls.forEach((d, i) => { const x = i % cols, y = Math.floor(i / cols); d.classList.toggle("off", !on.has(y * cols + (x - shift + cols) % cols)); });
  }, step);
}

/* ---------------- pollen ---------------- */
const POLLEN = [["grass_pollen", "Grass", [5, 30, 100]], ["birch_pollen", "Birch", [10, 100, 500]], ["alder_pollen", "Alder", [10, 50, 200]], ["mugwort_pollen", "Mugwort", [5, 20, 50]], ["ragweed_pollen", "Ragweed", [5, 20, 50]], ["olive_pollen", "Olive", [20, 100, 400]]];
/* Pollen and desert dust: what sets off hay fever and asthma outdoors. Pollen comes from the CAMS European model, so
   only for Europe; dust comes from the CAMS global model, so everywhere (it matters most around deserts: the Sahara,
   the Middle East, Central Asia, Australia). Outside Europe the card says plainly that pollen isn't forecast there.
   Dust levels follow the particle limits it counts towards (PM10: WHO 45 and EU 50 µg/m³ over a day). */
const DUST = [20, 50, 150];
function renderPollen() {
  const el = card("c-pollen"), a = AQ && AQ.current;
  if (!a && airWait) { el.innerHTML = `<div class="sk"></div>`; return; }
  const lvl = (v, t) => v < 1 ? [0, "None"] : v < t[0] ? [1, "Low"] : v < t[1] ? [2, "Moderate"] : v < t[2] ? [3, "High"] : [4, "Very high"];
  const fmt = v => v < 10 ? v.toFixed(1) : Math.round(v);
  const dots = i => `<span class="dots" role="img" aria-label="${i.ln}">${[1, 2, 3, 4].map(q => `<i class="${q <= i.l ? "on" : ""}"></i>`).join("")}</span>`;
  const dust = a && a.dust != null ? (() => { const [l, ln] = lvl(a.dust, DUST); return { n: "Desert dust", v: a.dust, l, ln }; })() : null;
  const items = a ? POLLEN.filter(([k]) => a[k] != null).map(([k, n, t]) => { const v = a[k], [l, ln] = lvl(v, t); return { n, v, l, ln }; }) : [];
  const say = i => i.l === 0 ? "Nothing in the air" : `${i.n} is ${i.ln.toLowerCase()}`;
  el.classList.remove("open");
  if (!items.length) { // outside Europe: dust only, and an honest line about pollen
    el.classList.remove("slim");
    el.innerHTML = `${head("Pollen and dust", !dust ? "Not forecast here" : dust.l ? say(dust) : "No desert dust")}
      ${dust ? `<div class="pgrid"><div class="tile"><span class="mono">Desert dust</span><b>${fmt(dust.v)}<small>µg/m³</small></b>${dots(dust)}</div></div>` : ""}
      <p class="empty">Pollen isn't forecast here: the pollen model (CAMS) only covers Europe.</p>`;
    return;
  }
  const all = dust ? [...items, dust] : items, top = all.reduce((m, i) => i.l > m.l ? i : m, all[0]);
  const grid = `<div class="pgrid" id="polGrid">${items.map(i => `<div class="tile"><span class="mono">${i.n}</span><b>${fmt(i.v)}</b>${dots(i)}</div>`).join("")}</div>`;
  const foot = dust ? `<div class="foot"><span>Desert dust <b>${fmt(dust.v)}</b> µg/m³ · ${dust.ln.toLowerCase()}</span></div>` : "";
  // nothing in the air at all: one quiet line instead of a wall of zeros, which still opens to show each type
  el.classList.toggle("slim", top.l === 0);
  if (top.l === 0) {
    const open = store.get("polOpen", false);
    el.classList.toggle("open", open);
    el.innerHTML = `<div class="ch-row">${head("Pollen and dust", say(top))}<button class="air-more mono" id="polMore" aria-expanded="${open}" aria-controls="polFold">All ${all.length} at zero<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 9.5l6 6 6-6"/></svg></button></div><div class="pfold" id="polFold"><div>${grid}${foot}</div></div>`;
    $("#polMore").onclick = () => { const on = !el.classList.contains("open"); el.classList.toggle("open", on); $("#polMore").setAttribute("aria-expanded", on); store.set("polOpen", on); };
    return;
  }
  // pollen in the air shows as a few soft grains floating up and along with the wind, slower and rounder than the air
  // card's particles: more of them the higher the worst pollen level (none when it's all at zero)
  const pl = Math.max(...items.map(i => i.l)), prnd = prng(pl * 31 + items.length), east = sin((X.c.wind_direction_10m ?? 270) * rad) < 0;
  const grains = pl ? Array.from({ length: [0, 6, 12, 20, 30][pl] }, () => `<i style="left:${(prnd() * 100).toFixed(1)}%;top:${(20 + prnd() * 80).toFixed(1)}%;--t:${(14 + prnd() * 10).toFixed(1)}s;--d:-${(prnd() * 24).toFixed(1)}s;--dx:${east ? "" : "-"}${(20 + prnd() * 40).toFixed(0)}px;--dy:-${(20 + prnd() * 30).toFixed(0)}px;--o:${(.35 + prnd() * .45).toFixed(2)}"></i>`).join("") : "";
  el.innerHTML = `${grains ? `<span class="pollen-air" aria-hidden="true">${grains}</span>` : ""}<div class="ch-row">${head("Pollen and dust", say(top))}</div>
    ${grid}${foot}`;
}

/* ---------------- source ---------------- */
function renderSrc() {
  const m = MODELS.find(x => x[0] === S.model) || MODELS[0];
  $("#infoBody").innerHTML = `<p><b>Forecast</b> Open-Meteo, ${esc(m[1])} model. ${esc(m[2])}</p>
    <p><b>Air, pollen and dust</b> Copernicus CAMS: the European model for air and pollen (pollen only in Europe), the global model for desert dust and for air outside Europe. Pollen counts are in grains per cubic metre of air.</p>
    <p><b>Rain radar</b> In and around the Benelux: Buienradar (buienradar.nl), its measured radar of the past two hours and its forecast for the next two. Elsewhere: RainViewer, the past two hours. On Esri map tiles (Esri, HERE, Garmin, © OpenStreetMap).</p>
    <p><b>How sure</b> The ECMWF ensemble (51 runs) and how far four main models (ECMWF, GFS, GEM, ICON) lie apart, both via Open-Meteo.</p>
    <p><b>Weather warnings</b> MeteoAlarm (EUMETNET) and the national weather services, such as KMI. Region outlines © EuroGeographics.</p>
    <p><b>Normals and records</b> ERA5 reanalysis (Copernicus), for the area around this spot: normals over 1991–2020, records since 1950.</p>
    <p><b>Sun and moon</b> Sunrise and sunset from Open-Meteo. Twilight, golden hour, the sun's height and the moon's phase, rise and set are calculated on this device with standard astronomical formulas. Moon map: NASA LRO imagery.</p>
    <p><b>Places</b> Search by Open-Meteo geocoding (GeoNames); your own spot named by BigDataCloud.</p>
    <button class="wall-link" id="wallBtn">Show every card on one screen</button>`;
  $("#wallBtn").onclick = () => { $("#dlgInfo").close(); setWall(true); };
  // where the forecast is for, at the top of the About sheet: coordinates, height above sea level and time zone
  const ll = (v, p, n) => `${Math.abs(v).toFixed(2)}° ${v >= 0 ? p : n}`;
  const elev = D.elevation ?? 0, elevTxt = S.precip === "inch" ? `${Math.round(elev * 3.281)} <span class="u">ft</span>` : `${Math.round(elev)} <span class="u">m</span>`;
  $("#infoBody").insertAdjacentHTML("afterbegin", `<p><b>This spot</b> ${ll(D.latitude, "N", "S")}, ${ll(D.longitude, "E", "W")} · ${elevTxt} above sea level · ${esc(D.timezone.replace(/_/g, " "))}</p>`);
  $("#modelChip").innerHTML = `Model <b>${esc(m[1].split(" ·")[0])}</b>`;
  $("#modelChip").hidden = S.model === "best_match"; // shown only once you've picked a model of your own
}

/* ---------------- radar ---------------- */
let map, base, marker, cityLayer, frames = [], layers = [], fi = 0, timer = null, radarHost = "", radarLoaded = 0, radarBr = null; // radarBr: whether the frames loaded are Buienradar's (the place lies in its area)
const esri = kind => `https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_${document.documentElement.dataset.mode === "day" ? "Light" : "Dark"}_Gray_${kind}/MapServer/tile/{z}/{y}/{x}`;
/* Our own map labels instead of the provider's: only larger cities, in the app's type. [name, lat, lon, population in millions] */
const CITIES = [
  ["London",51.507,-0.128,9],["Paris",48.857,2.352,11],["Brussels",50.850,4.352,1.2],["Antwerp",51.219,4.402,.53],["Ghent",51.054,3.717,.26],["Liège",50.633,5.567,.2],
  ["Charleroi",50.411,4.444,.2],["Bruges",51.209,3.225,.12],["Leuven",50.880,4.700,.1],["Namur",50.467,4.872,.11],["Amsterdam",52.370,4.895,.9],["Rotterdam",51.924,4.478,.65],
  ["The Hague",52.070,4.300,.55],["Utrecht",52.091,5.122,.36],["Eindhoven",51.441,5.470,.24],["Breda",51.589,4.776,.18],["Maastricht",50.851,5.691,.12],["Groningen",53.219,6.567,.23],
  ["Lille",50.629,3.057,1],["Luxembourg",49.612,6.130,.13],["Cologne",50.938,6.960,1.1],["Düsseldorf",51.227,6.774,.62],["Dortmund",51.514,7.468,.59],["Essen",51.456,7.012,.58],
  ["Aachen",50.776,6.084,.25],["Frankfurt",50.110,8.682,.76],["Berlin",52.520,13.405,3.6],["Hamburg",53.551,9.993,1.8],["Munich",48.137,11.576,1.5],["Stuttgart",48.776,9.183,.63],
  ["Bremen",53.079,8.802,.57],["Hanover",52.375,9.732,.54],["Leipzig",51.340,12.375,.6],["Dresden",51.050,13.738,.56],["Nuremberg",49.452,11.077,.52],["Zurich",47.377,8.541,.42],
  ["Basel",47.560,7.588,.17],["Geneva",46.204,6.143,.2],["Lyon",45.764,4.836,1.4],["Marseille",43.296,5.370,.87],["Bordeaux",44.838,-.579,.26],["Toulouse",43.605,1.444,.5],
  ["Nantes",47.218,-1.554,.32],["Strasbourg",48.573,7.752,.29],["Reims",49.258,4.032,.18],["Rouen",49.443,1.099,.11],["Madrid",40.417,-3.704,3.3],["Barcelona",41.385,2.173,1.6],
  ["Lisbon",38.722,-9.139,.55],["Porto",41.158,-8.629,.23],["Seville",37.389,-5.984,.69],["Valencia",39.470,-.377,.79],["Rome",41.903,12.496,2.8],["Milan",45.464,9.190,1.4],
  ["Naples",40.852,14.268,.96],["Turin",45.070,7.687,.87],["Venice",45.441,12.316,.26],["Florence",43.770,11.256,.38],["Vienna",48.208,16.373,1.9],["Prague",50.075,14.438,1.3],
  ["Warsaw",52.230,21.012,1.8],["Kraków",50.065,19.945,.78],["Budapest",47.498,19.040,1.7],["Copenhagen",55.676,12.568,.64],["Stockholm",59.329,18.069,.98],["Oslo",59.914,10.752,.7],
  ["Helsinki",60.170,24.938,.66],["Dublin",53.350,-6.260,.59],["Manchester",53.481,-2.243,.55],["Birmingham",52.486,-1.890,1.1],["Leeds",53.801,-1.549,.79],["Bristol",51.455,-2.588,.47],
  ["Glasgow",55.864,-4.252,.63],["Edinburgh",55.953,-3.188,.52],["Athens",37.984,23.728,3],["Istanbul",41.008,28.978,15],["Bucharest",44.427,26.103,1.8],["Sofia",42.698,23.322,1.2],
  ["Belgrade",44.787,20.457,1.2],["Zagreb",45.815,15.982,.8],["Kyiv",50.450,30.523,2.9],["Moscow",55.756,37.617,12.5],["St Petersburg",59.934,30.336,5.4],["Riga",56.950,24.105,.63],
  ["Vilnius",54.687,25.280,.58],["Tallinn",59.437,24.754,.44],["New York",40.713,-74.006,8.3],["Los Angeles",34.052,-118.244,3.9],["Chicago",41.878,-87.630,2.7],["Houston",29.760,-95.370,2.3],
  ["Phoenix",33.448,-112.074,1.6],["Philadelphia",39.953,-75.165,1.6],["Dallas",32.777,-96.797,1.3],["San Diego",32.716,-117.161,1.4],["San Francisco",37.775,-122.419,.87],["Seattle",47.606,-122.332,.74],
  ["Denver",39.739,-104.990,.71],["Boston",42.360,-71.059,.68],["Washington",38.907,-77.037,.69],["Atlanta",33.749,-84.388,.5],["Miami",25.762,-80.192,.45],["Toronto",43.653,-79.383,2.8],
  ["Montreal",45.502,-73.567,1.8],["Vancouver",49.283,-123.121,.68],["Mexico City",19.433,-99.133,9.2],["São Paulo",-23.550,-46.633,12.3],["Rio de Janeiro",-22.907,-43.173,6.7],["Buenos Aires",-34.604,-58.382,3.1],
  ["Lima",-12.046,-77.043,9.7],["Bogotá",4.711,-74.072,7.4],["Santiago",-33.449,-70.669,6.2],["Tokyo",35.676,139.650,14],["Osaka",34.694,135.502,2.7],["Seoul",37.566,126.978,9.7],
  ["Beijing",39.904,116.407,21],["Shanghai",31.230,121.474,24],["Hong Kong",22.319,114.169,7.4],["Singapore",1.352,103.820,5.6],["Bangkok",13.756,100.502,10.5],["Jakarta",-6.208,106.846,10.6],
  ["Delhi",28.704,77.102,30],["Mumbai",19.076,72.878,20],["Dubai",25.205,55.271,3.3],["Cairo",30.044,31.236,10],["Lagos",6.524,3.379,15],["Nairobi",-1.292,36.822,4.4],
  ["Johannesburg",-26.204,28.047,5.6],["Cape Town",-33.925,18.424,4.6],["Sydney",-33.869,151.209,5.3],["Melbourne",-37.814,144.963,5],["Brisbane",-27.470,153.026,2.5],["Perth",-31.951,115.861,2.1],["Auckland",-36.849,174.763,1.7]
];
const mlab = (name, here) => L.marker([0, 0], { interactive: false, keyboard: false, icon: L.divIcon({ className: `mlab${here ? " here" : ""}`, iconSize: [0, 0], html: `<i></i><span>${esc(name)}</span>` }) });
/* Picks the biggest cities in view, skipping any that would crowd an existing label or your own location. */
function placeCities() {
  if (!map) return;
  cityLayer.clearLayers();
  const b = map.getBounds().pad(-.08), here = map.latLngToContainerPoint(marker.getLatLng());
  const taken = [[here.x, here.y]], max = map.getSize().x > 420 ? 6 : 4;
  const hereName = (place && place.name || "").toLowerCase();
  if (place) cityLayer.addLayer(mlab(place.name, true).setLatLng(marker.getLatLng()));
  for (const [n, la, lo] of CITIES.filter(c => b.contains([c[1], c[2]])).sort((a, b) => b[3] - a[3])) {
    if (taken.length > max || n.toLowerCase() === hereName) continue;
    const p = map.latLngToContainerPoint([la, lo]);
    if (taken.some(([x, y]) => Math.abs(x - p.x) < 96 && Math.abs(y - p.y) < 30)) continue;
    taken.push([p.x, p.y]); cityLayer.addLayer(mlab(n).setLatLng([la, lo]));
  }
}
/* Radar tiles, redrawn in the app's palette. RainViewer's free tiles only exist up to zoom 7 and in one colour scheme,
   so each tile is read pixel by pixel: rain intensity is recovered from the original colours and repainted on our ramp.
   Past zoom 7 the parent tile is upscaled smoothly (with a little blur scaled to the zoom) instead of as blocky pixels. */
const RAIN_RAMP = [[0, [143, 168, 255, .38]], [.22, [143, 168, 255, .5]], [.4, [75, 78, 242, .66]], [.56, [122, 63, 240, .76]], [.7, [232, 48, 127, .86]], [.85, [239, 47, 43, .9]], [1, [255, 207, 92, .95]]];
const RAIN_LUT = Array.from({ length: 101 }, (_, i) => {
  const v = i / 100, j = RAIN_RAMP.findIndex(s => s[0] >= v), b = RAIN_RAMP[Math.max(j, 1)], a = RAIN_RAMP[Math.max(j, 1) - 1], t = (v - a[0]) / ((b[0] - a[0]) || 1);
  return a[1].map((x, k) => x + (b[1][k] - x) * clamp(t, 0, 1));
});
/* Intensity (0–1) from a pixel in RainViewer's "Universal Blue" scheme: pale to deep blue for light to steady rain,
   then yellow, orange, red, and magenta or white for the most intense cells. */
function rainLevel(r, g, b) {
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), l = (mx + mn) / 510, d = mx - mn;
  if (d < 24) return l > .78 ? 1 : .2;
  let h = mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
  h = (h * 60 + 360) % 360;
  if (h >= 165 && h <= 262) return clamp(.06 + (1 - l) * .6, .06, .5);
  if (h > 262 && h < 335) return .97;
  if (h >= 42 && h < 165) return .58;
  if (h >= 22) return .72;
  return .87;
}
/* Softens radar pixels before they're recoloured, so the rain has smooth edges instead of blocky steps. Done by hand
   because Safari has no canvas blur filter: two box-blur passes each way (close to a Gaussian), on premultiplied colour
   so the edges of a shower don't go dark. */
const radarScratch = document.createElement("canvas");
function softBlur(p, w, h) {
  const n = w * h, a = new Float32Array(n * 4), b = new Float32Array(n * 4);
  for (let i = 0; i < n * 4; i += 4) { const al = p[i + 3] / 255; a[i] = p[i] * al; a[i + 1] = p[i + 1] * al; a[i + 2] = p[i + 2] * al; a[i + 3] = p[i + 3]; }
  const pass = (src, dst, horiz) => { // radius-1 box blur along rows or columns, edges clamped
    const len = horiz ? w : h, lines = horiz ? h : w, step = horiz ? 4 : w * 4;
    for (let l = 0; l < lines; l++) {
      const base = horiz ? l * w * 4 : l * 4;
      for (let x = 0; x < len; x++) {
        const o = base + x * step, lo = base + Math.max(0, x - 1) * step, hi = base + Math.min(len - 1, x + 1) * step;
        for (let c = 0; c < 4; c++) dst[o + c] = (src[lo + c] + src[o + c] + src[hi + c]) / 3;
      }
    }
  };
  pass(a, b, true); pass(b, a, false); pass(a, b, true); pass(b, a, false);
  for (let i = 0; i < n * 4; i += 4) {
    const al = a[i + 3]; p[i + 3] = al;
    if (al > 0) { const m = 255 / al; p[i] = a[i] * m; p[i + 1] = a[i + 1] * m; p[i + 2] = a[i + 2] * m; }
  }
}
let RadarLayer = null;
const makeRadarLayer = () => L.GridLayer.extend({
  // few spare tiles and no redraws mid-zoom: every tile is a recoloured canvas, and iOS has a hard cap on canvas memory
  options: { keepBuffer: 1, updateWhenZooming: false },
  onAdd(map) {
    L.GridLayer.prototype.onAdd.call(this, map);
    // give a dropped tile's pixels back right away instead of waiting for the garbage collector
    this.on("tileunload", e => { e.tile.width = e.tile.height = 0; });
  },
  createTile(coords, done) {
    const tile = document.createElement("canvas"); tile.width = tile.height = 256;
    // The area of RainViewer's zoom-7 (or lower) world this tile shows: sw source pixels square at (sx, sy). A shifted
    // layer (options.shift, in source pixels) takes its area from elsewhere, which can span up to four source tiles;
    // without a shift each tile reads only its own source tile.
    const z = Math.min(coords.z, 7), k = 2 ** (coords.z - z), sw = 256 / k, pad = 3, n = 2 ** z;
    const [shx, shy] = this.options.shift || [0, 0], sx = coords.x * sw - shx, sy = coords.y * sw - shy;
    let x0 = Math.floor(sx - pad), y0 = Math.floor(sy - pad), x1 = Math.ceil(sx + sw + pad), y1 = Math.ceil(sy + sw + pad);
    if (!shx && !shy) { const ox = Math.floor(coords.x / k) * 256, oy = Math.floor(coords.y / k) * 256; x0 = Math.max(ox, x0); y0 = Math.max(oy, y0); x1 = Math.min(ox + 256, x1); y1 = Math.min(oy + 256, y1); } // radar now: its own source tile only
    const parts = [];
    for (let ty = Math.floor(y0 / 256); ty <= Math.floor((y1 - 1) / 256); ty++) for (let tx = Math.floor(x0 / 256); tx <= Math.floor((x1 - 1) / 256); tx++) if (ty >= 0 && ty < n) parts.push([tx, ty]);
    let left = parts.length; const imgs = [];
    const finish = () => {
      if (!tile.width) return; // dropped while its images were loading
      const w = x1 - x0, h = y1 - y0;
      radarScratch.width = w; radarScratch.height = h;
      const s = radarScratch.getContext("2d", { willReadFrequently: true });
      for (const [img, tx, ty] of imgs) s.drawImage(img, tx * 256 - x0, ty * 256 - y0);
      const im = s.getImageData(0, 0, w, h), p = im.data;
      softBlur(p, w, h);
      for (let i = 0; i < p.length; i += 4) {
        const a = p[i + 3]; if (a < 10) { p[i + 3] = 0; continue; }
        const col = RAIN_LUT[Math.round(rainLevel(p[i], p[i + 1], p[i + 2]) * 100)];
        p[i] = col[0]; p[i + 1] = col[1]; p[i + 2] = col[2]; p[i + 3] = Math.round(col[3] * a);
      }
      s.putImageData(im, 0, 0);
      // recoloured at the source's own size, then scaled up smoothly
      const c = tile.getContext("2d");
      c.imageSmoothingEnabled = true; c.imageSmoothingQuality = "high";
      c.drawImage(radarScratch, sx - x0, sy - y0, sw, sw, 0, 0, 256, 256);
      done(null, tile);
    };
    if (!left) { done(null, tile); return tile; }
    for (const [tx, ty] of parts) {
      const img = new Image(); img.crossOrigin = "anonymous";
      img.onload = () => { imgs.push([img, tx, ty]); if (!--left) finish(); };
      img.onerror = () => { if (!--left) finish(); };
      img.src = this.options.url.replace("{z}", z).replace("{x}", ((tx % n) + n) % n).replace("{y}", ty);
    }
    return tile;
  }
});
/* Buienradar: the measured radar of the past two hours and its forecast for the next two, every 10 minutes, for the
   Benelux and around. Inside that area the whole timeline comes from this one product, so the rain doesn't jump,
   vanish or change shape at "now" (two different radars never quite agree: one may show light rain the other filters
   out). Its images are Web Mercator; their extent isn't published, so it was measured by laying the images over
   RainViewer's radar of the same moments and finding where the showers line up best (to within a few km). Only used
   when your place lies well inside it; elsewhere RainViewer shows the past two hours. */
const BR_AREA = [[49.525, .025], [54.785, 9.96]];
const inBr = (la, lo) => la > BR_AREA[0][0] + .4 && la < BR_AREA[1][0] - .4 && lo > BR_AREA[0][1] + .4 && lo < BR_AREA[1][1] - .4;
/* Intensity (0–1) from a pixel in Buienradar's colours: near-white for drizzle, then light to deep blue, red for heavy
   and purple for the most intense. */
const brLevel = (r, g, b) => Math.max(r, g, b) - Math.min(r, g, b) < 24 ? .2 : rainLevel(r, g, b);
/* Recolours one forecast image to the app's palette (once, when it is first needed) and hands it to its map layer. */
function brPrepare(f, layer) {
  if (f.ready) return; f.ready = true;
  const img = new Image(); img.crossOrigin = "anonymous";
  img.onload = () => {
    const c = document.createElement("canvas"); c.width = img.width; c.height = img.height;
    const x = c.getContext("2d", { willReadFrequently: true }); x.drawImage(img, 0, 0);
    const im = x.getImageData(0, 0, c.width, c.height), p = im.data;
    for (let i = 0; i < p.length; i += 4) {
      const a = p[i + 3]; if (a < 10) { p[i + 3] = 0; continue; }
      const col = RAIN_LUT[Math.round(brLevel(p[i], p[i + 1], p[i + 2]) * 100)];
      p[i] = col[0]; p[i + 1] = col[1]; p[i + 2] = col[2]; p[i + 3] = Math.round(col[3] * 255 * Math.min(1, a / 204));
    }
    x.putImageData(im, 0, 0);
    c.toBlob(b => { if (b) layer.setUrl(f.obj = URL.createObjectURL(b)); c.width = c.height = 0; });
  };
  img.onerror = () => { f.ready = false; };
  img.src = f.url;
}
async function brFrames() {
  const m = await getJSON("https://image.buienradar.nl/2.0/metadata/sprite/RadarMapRainWebmercatorNL?width=1000&height=915&history=12&forecast=12");
  const now = Date.now() / 1000;
  return (m.times || []).map(t => { const time = Date.parse(t.timestamp + "Z") / 1000; return { time, url: t.url, fut: time > now, br: true }; });
}
const BLANK = "data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==";

/* The map library (Leaflet) only loads once the radar is about to scroll into view; its stylesheet goes in front of
   the app's own, where it always stood, so the app's styles still win. */
const LEAFLET = "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/";
let leafletP = null;
function loadLeaflet() {
  if (window.L) return Promise.resolve(true);
  return leafletP || (leafletP = new Promise(res => {
    const css = document.createElement("link"); css.rel = "stylesheet"; css.href = LEAFLET + "leaflet.min.css";
    const js = document.createElement("script"); js.src = LEAFLET + "leaflet.min.js";
    let left = 2; const one = () => { if (!--left) res(!!window.L); };
    const fail = () => { leafletP = null; css.remove(); js.remove(); res(false); };
    css.onload = one; js.onload = one; css.onerror = js.onerror = fail;
    document.head.insertBefore(css, document.querySelector('link[href="styles.css"]'));
    document.head.appendChild(js);
  }));
}
/* The radar wakes up when its card comes within a long scroll of the screen (or straight away if it's already
   near), so a launch doesn't spend time and data on a map far down the page. Runs one at a time. */
let radarNear = !("IntersectionObserver" in window), radarRun = Promise.resolve();
const wantRadar = () => { if (radarNear && D) radarRun = radarRun.then(initRadar).catch(e => console.error(e)); };
if (!radarNear) {
  const io = new IntersectionObserver(es => { if (es.some(e => e.isIntersecting)) { io.disconnect(); radarNear = true; wantRadar(); } }, { rootMargin: "1400px 0px" });
  io.observe(card("c-radar"));
}
async function initRadar() {
  const box = $("#radarMap");
  if (!(await loadLeaflet())) { box.innerHTML = `<p class="empty" style="padding:60px 20px">The map library didn't load. Check your connection and refresh.</p>`; return; }
  if (!RadarLayer) RadarLayer = makeRadarLayer();
  const ll = [D.latitude, D.longitude];
  if (!map) {
    // On a touch screen one finger scrolls the page past the map, so a swipe down the app never gets caught in it; two
    // fingers move and pinch the map. A sideways one-finger swipe (someone trying to pan) shows how, briefly.
    const touch = matchMedia("(pointer: coarse)").matches;
    map = L.map(box, { zoomControl: false, scrollWheelZoom: false, attributionControl: false, dragging: !touch }).setView(ll, 7);
    if (touch) {
      const hint = document.createElement("p"); hint.className = "map-hint"; hint.textContent = "Use two fingers to move the map"; box.parentElement.appendChild(hint);
      let x0 = 0, y0 = 0, shown = 0;
      box.addEventListener("touchstart", e => { if (e.touches.length === 1) { x0 = e.touches[0].clientX; y0 = e.touches[0].clientY; } }, { passive: true });
      box.addEventListener("touchmove", e => {
        if (e.touches.length !== 1 || Date.now() - shown < 4000) return;
        const dx = Math.abs(e.touches[0].clientX - x0), dy = Math.abs(e.touches[0].clientY - y0);
        if (dx > 30 && dx > dy * 1.5) { shown = Date.now(); hint.classList.add("on"); setTimeout(() => hint.classList.remove("on"), 1600); }
      }, { passive: true });
    }
    base = L.tileLayer(esri("Base"), { maxZoom: 12, maxNativeZoom: 16 }).addTo(map);
    // an HTML dot rather than a vector circle: vector shapes stretch with the map during a zoom and then snap back
    marker = L.marker(ll, { icon: L.divIcon({ className: "here-pin", iconSize: [14, 14] }), interactive: false, keyboard: false }).addTo(map);
    cityLayer = L.layerGroup().addTo(map);
    map.on("moveend zoomend resize", placeCities);
    $("#zIn").onclick = () => map.zoomIn(); $("#zOut").onclick = () => map.zoomOut();
    $("#rPlay").onclick = () => timer ? stopLoop() : startLoop();
    // drag along the timeline to move through the frames, like scrubbing a video
    const rt = $("#rTicks");
    const frameAt = x => { const r = rt.getBoundingClientRect(); return clamp(Math.floor((x - r.left) / r.width * frames.length), 0, frames.length - 1); };
    const scrubTo = i => { if (i !== fi) show(i); };
    rt.addEventListener("pointerdown", e => { if (!frames.length || e.button !== 0) return; stopLoop(); rt.setPointerCapture(e.pointerId); rt.classList.add("grab"); scrubTo(frameAt(e.clientX)); });
    const rMove = perFrame(e => scrubTo(frameAt(e.clientX)));
    rt.addEventListener("pointermove", e => { if (rt.hasPointerCapture(e.pointerId)) rMove(e); });
    for (const ev of ["pointerup", "pointercancel"]) rt.addEventListener(ev, () => rt.classList.remove("grab"));
    wheelStep(rt, d => { if (!frames.length) return; stopLoop(); show(fi + d); }); // a frame per notch
    rt.addEventListener("keydown", e => { const d = { ArrowRight: 1, ArrowLeft: -1 }[e.key]; if (d && frames.length) { e.preventDefault(); stopLoop(); show(fi + d); rt.children[fi].focus(); } });
  } else { map.setView(ll, map.getZoom()); marker.setLatLng(ll); base.setUrl(esri("Base")); }
  placeCities();
  setTimeout(() => map.invalidateSize(), 50);
  // fresh frames are kept for five minutes, unless the place moved into or out of Buienradar's area (its source changes)
  if (Date.now() - radarLoaded < 5 * 6e4 && layers.length && radarBr === inBr(ll[0], ll[1])) return;
  try {
    const j = await getJSON("https://api.rainviewer.com/public/weather-maps.json");
    radarHost = j.host; radarLoaded = Date.now();
    layers.forEach(l => map.removeLayer(l)); stopLoop();
    frames.forEach(f => f.obj && URL.revokeObjectURL(f.obj)); // let go of the previous forecast images
    const past = (j.radar && j.radar.past) || [], fut = (j.radar && j.radar.nowcast) || [];
    const tileUrl = f => `${radarHost}${f.path}/256/{z}/{x}/{y}/2/1_1.png`;
    frames = [...past.map(f => ({ ...f, fut: false })), ...fut.map(f => ({ ...f, fut: true }))];
    // inside Buienradar's area its past and forecast replace RainViewer altogether: one source for the whole timeline
    radarBr = inBr(ll[0], ll[1]);
    if (radarBr) { try { const b = await brFrames(); if (b.some(f => !f.fut) && b.some(f => f.fut)) frames = b; } catch {} }
    layers = frames.map(f => f.br ? L.imageOverlay(BLANK, BR_AREA, { opacity: 0, zIndex: 10, interactive: false })
      : new RadarLayer({ url: tileUrl(f), opacity: 0, maxZoom: 12, zIndex: 10 })); // show() puts the ones it needs on the map
    const ticks = () => { $("#rTicks").innerHTML = frames.map((f, i) => `<button class="${f.fut ? "fut" : ""}" data-i="${i}" aria-label="${f.fut ? "Forecast frame" : "Frame"} ${i + 1}"></button>`).join(""); };
    ticks();
    $("#rTicks").onclick = e => { const b = e.target.closest("button"); if (b) { stopLoop(); show(+b.dataset.i); } };
    show(Math.max(0, frames.findLastIndex(f => !f.fut))); // open on the latest measured frame
  } catch { $("#radarSub").textContent = navigator.onLine ? "Radar is unavailable right now" : "Offline"; }
}
function show(i) {
  if (!frames.length) return;
  fi = (i + frames.length) % frames.length;
  // only the shown frame and two either side are loaded (enough to play smoothly); the rest are dropped to save memory
  const n = frames.length, near = k => { const d = Math.abs(k - fi); return Math.min(d, n - d) <= 2; };
  layers.forEach((l, k) => {
    if (!near(k)) { if (map.hasLayer(l)) map.removeLayer(l); return; }
    if (!map.hasLayer(l)) l.addTo(map);
    if (frames[k].br) brPrepare(frames[k], l);
    l.setOpacity(k === fi ? .8 : 0); // the same strength either side of now, so the rain doesn't seem to fade at the switch
  });
  [...$("#rTicks").children].forEach((b, k) => b.classList.toggle("cur", k === fi));
  $("#radarSub").textContent = frames[fi].br ? (frames[fi].fut ? "Forecast · Buienradar" : "Radar · Buienradar") : ""; // whose radar you are looking at
  const t = new Date(frames[fi].time * 1000), mins = Math.round((t - Date.now()) / 6e4);
  $("#rTime").textContent = `${fmtT(t)} ${Math.abs(mins) < 6 && !frames[fi].fut ? "now" : (mins > 0 ? "+" : "") + mins + "m"}`; // a forecast frame always says how far ahead
}
function startLoop() { if (!frames.length) return; timer = setInterval(() => { if (!offscreen("c-radar")) show(fi + 1); }, 650); $("#rPlayIc").innerHTML = '<path d="M7 5.5h3.5v13H7zM13.5 5.5H17v13h-3.5z"/>'; $("#rPlay").setAttribute("aria-label", "Pause radar loop"); }
function stopLoop() { clearInterval(timer); timer = null; $("#rPlayIc").innerHTML = '<path d="M8 5.5v13l10.5-6.5z"/>'; $("#rPlay").setAttribute("aria-label", "Play radar loop"); }

/* ---------------- orchestration ---------------- */
function applyMode() {
  const m = S.mode === "auto" ? (D && !D.current.is_day ? "night" : D ? "day" : "night") : S.mode;
  document.documentElement.dataset.mode = m;
  $('meta[name="theme-color"]').content = m === "day" ? "#e8e7ef" : "#0e0f12";
  if (base) base.setUrl(esri("Base"));
}
// runs every second: the formatter is made once per clock style and time zone, and nothing is touched unless the minute changed
let clockFmt = null, clockShown = "";
function renderClock() {
  if (!D || document.hidden) return;
  const fk = S.clock + TZ;
  if (!clockFmt || clockFmt.k !== fk) clockFmt = { k: fk, f: new Intl.DateTimeFormat(S.clock === "12" ? "en-US" : "en-GB", { hour: S.clock === "12" ? "numeric" : "2-digit", minute: "2-digit", hour12: S.clock === "12", timeZone: TZ }) };
  const parts = clockFmt.f.formatToParts(new Date());
  const get = t => (parts.find(p => p.type === t) || {}).value || "";
  const hh = get("hour"), mm = get("minute"), ap = get("dayPeriod").toLowerCase(), el = $("#clock");
  const shown = `${hh}:${mm}${ap}`;
  if (shown === clockShown && el.dataset.len) return;
  clockShown = shown;
  el.innerHTML = `<span class="ck">${hh}:${mm}</span>${ap ? `<span class="ck-ap">${ap}</span>` : ""}`; el.dataset.len = 1;
  el.setAttribute("aria-label", `Local time ${hh}:${mm}${ap ? " " + ap : ""}`);
  $("#tbTime").textContent = `${hh}:${mm}${ap ? " " + ap : ""}`; // the same time, quietly, in the top bar that shows on scrolling
}
/* The place name is never cut off: when it doesn't fit beside the clock it shrinks until it does (down to 20 px; only a
   name too long even then ends in an ellipsis). */
function fitName() {
  const n = $("#placeName"); n.style.fontSize = "";
  if (n.scrollWidth > n.clientWidth) n.style.fontSize = `${Math.max(20, parseFloat(getComputedStyle(n).fontSize) * n.clientWidth / n.scrollWidth - .5).toFixed(1)}px`;
}
document.fonts?.ready.then(() => { fitName(); fitHeads(); }); // measured again once the real font is in
if ("ResizeObserver" in window) new ResizeObserver(() => fitName()).observe($(".top-r")); // and whenever the clock beside it changes width (a 12-hour "12:19 pm" is wider)
function renderPlace() {
  $("#placeName").textContent = place ? place.name : "Kwick";
  { const len = (place ? place.name : "").length, h = $("#placeName").parentElement; h.classList.toggle("long", len > 11 && len <= 17); h.classList.toggle("longer", len > 17); }
  fitName();
  $("#tbName").textContent = place ? place.name : "";
  const t = D ? localDateLabel(new Date()) : ""; // the time itself lives in the clock pill
  // each part (region, country, date) stays whole; a line only breaks between them
  const bits = !place ? ["Finding your location"] : place.sub ? place.sub.split(", ").map((q, i, a) => i < a.length - 1 ? q + "," : q) : [];
  if (place && t) { if (bits.length) bits[bits.length - 1] += " ·"; bits.push(t); }
  $("#placeSub").innerHTML = wholeParts(bits);
  renderDots();
}
function renderAll() {
  derive(); applyMode(); renderPlace(); renderClock();
  // the full 14-day stack lives in a sheet: it's built when the sheet opens (openDays), and here only if it's open
  const parts = [renderSummary, renderHero, renderNow, renderWind, renderFeels, renderHourly, ...($("#dlgDays").open ? [renderDays] : []), renderUV, renderHumid, renderAir, renderMoon, renderSun, renderYear, renderPress, renderVis, renderRain, renderClouds, renderPollen, renderSrc];
  holdDraw = new Set();
  for (const f of parts) { try { f(); } catch (e) { console.error(f.name, e); } }
  const draws = holdDraw; holdDraw = null; // every card is in place: now the canvases measure and draw
  fitHeads();
  if (wallOn) { fitWall(); settleWall(); } // on the wall, first make room so no card is cut off
  for (const f of draws) { try { f(); } catch (e) { console.error(e); } }
  wantRadar();
  loadClimate();
}

/* ---------------- climate: what's normal here, and the records ---------------- */
/* Every day since 1950 at this spot, from the ERA5 reanalysis (Copernicus), fetched once per place and boiled down
   to one small table per calendar day: the normal high and low (1991–2020, averaged over a fortnight around the
   date so the curve is smooth) and the warmest high and coldest low on that date, with their years. All in °C. */
const CLIM_FROM = 1950, CLIM_TO = new Date().getFullYear() - 1;
let CLIM = null;
const climKey = (lat, lon) => `clim:${lat.toFixed(1)},${lon.toFixed(1)}:${CLIM_TO}`;
const climIdx = key => { const [, m, d] = key.split("-").map(Number); return (Date.UTC(2024, m - 1, d) - Date.UTC(2024, 0, 1)) / dayMs; }; // day of a leap year: 0–365
const fromC = c => S.temp === "f" ? c * 9 / 5 + 32 : c;
let climBusy = "";
async function loadClimate() {
  if (!X.lat && X.lat !== 0) return;
  const key = climKey(X.lat, X.lon);
  if (CLIM && CLIM.key === key) return;
  const kept = store.get(key, null);
  if (kept) { CLIM = kept; kept.at = Date.now(); store.set(key, kept); return climUpdate(); } // marked as used, so it stays among the six
  if (climBusy === key || !navigator.onLine) return;
  climBusy = key;
  try {
    // a one-off download of about half a megabyte: wait until the app has settled, so it never competes with the forecast
    await new Promise(r => "requestIdleCallback" in window ? requestIdleCallback(() => r(), { timeout: 4000 }) : setTimeout(r, 1500));
    if (climKey(X.lat, X.lon) !== key) return; // moved on to another place meanwhile
    const u = `https://archive-api.open-meteo.com/v1/archive?latitude=${X.lat}&longitude=${X.lon}&start_date=${CLIM_FROM}-01-01&end_date=${CLIM_TO}-12-31&daily=temperature_2m_max,temperature_2m_min&timezone=auto&timeformat=unixtime`;
    const j = await (await fetch(u)).json(), t = j.daily && j.daily.time;
    if (!t || !t.length) return;
    const mx = j.daily.temperature_2m_max, mn = j.daily.temperature_2m_min, shift = (j.utc_offset_seconds || 0) * 1000 + 6 * 36e5; // lands mid-morning, so the date is right in summer and winter time
    const sh = new Float64Array(366), sl = new Float64Array(366), n = new Uint16Array(366);
    const rh = Array(366).fill(null), rl = Array(366).fill(null);
    t.forEach((s, i) => {
      if (mx[i] == null || mn[i] == null) return;
      const d = new Date(s * 1000 + shift), y = d.getUTCFullYear();
      const k = (Date.UTC(2024, d.getUTCMonth(), d.getUTCDate()) - Date.UTC(2024, 0, 1)) / dayMs;
      if (y >= 1991 && y <= 2020) { sh[k] += mx[i]; sl[k] += mn[i]; n[k]++; }
      if (!rh[k] || mx[i] > rh[k][0]) rh[k] = [mx[i], y];
      if (!rl[k] || mn[i] < rl[k][0]) rl[k] = [mn[i], y];
    });
    const nh = [], nl = [];
    for (let k = 0; k < 366; k++) {
      let a = 0, b = 0, c = 0;
      for (let w = -7; w <= 7; w++) { const q = (k + w + 366) % 366; a += sh[q]; b += sl[q]; c += n[q]; }
      nh.push(c ? +(a / c).toFixed(1) : null); nl.push(c ? +(b / c).toFixed(1) : null);
    }
    CLIM = { key, nh, nl, rh, rl, from: Math.max(CLIM_FROM, new Date(t[0] * 1000 + shift).getUTCFullYear()) };
    // keep the tables of the six places looked at most recently (each about 12 kB), drop older ones
    try {
      const old = Object.keys(localStorage).filter(k => k.startsWith("isobar:clim:")).map(k => [k, (JSON.parse(localStorage.getItem(k)) || {}).at || 0]).sort((a, b) => b[1] - a[1]);
      old.slice(5).forEach(([k]) => localStorage.removeItem(k));
    } catch {}
    CLIM.at = Date.now();
    store.set(key, CLIM);
    climUpdate();
  } catch { /* no climate today: the cards simply leave it out */ } finally { climBusy = ""; }
}
/* The normals and records for a forecast day (key "YYYY-MM-DD"), in °C; null until the table is in. */
function climFor(key) {
  if (!CLIM || CLIM.key !== climKey(X.lat, X.lon)) return null;
  const k = climIdx(key);
  return CLIM.nh[k] == null ? null : { hi: CLIM.nh[k], lo: CLIM.nl[k], rh: CLIM.rh[k], rl: CLIM.rl[k], from: CLIM.from };
}
/* One quiet line on the main card: how today's high compares with normal, or a record when one is forecast. */
function climLine() {
  const cl = climFor(X.todayKey); if (!cl) return "";
  const hi = X.Dy.temperature_2m_max[X.di], lo = X.Dy.temperature_2m_min[X.di];
  const date = dm_(X.todayKey);
  // a record only with a clear margin: the history is an average over the area (~25 km), the forecast is for this spot
  if (hi != null && cl.rh && toC(hi) > cl.rh[0] + 1.5) return `Warmer than any ${date} since ${cl.from}`;
  if (lo != null && cl.rl && toC(lo) < cl.rl[0] - 1.5) return `Colder than any ${date} since ${cl.from}`;
  if (hi == null) return "";
  const diff = (toC(hi) - cl.hi) * (S.temp === "f" ? 1.8 : 1), a = Math.round(Math.abs(diff));
  return a < 2 ? "About normal for the time of year" : `${a}° ${diff > 0 ? "warmer" : "colder"} than normal`;
}
function climUpdate() {
  const el = $("#heroClim");
  if (el) { const s = climLine(); el.textContent = s; el.hidden = !s; }
  if ($("#dlgDays").open) renderDays();
}
function showError(msg) {
  const el = card("c-hero");
  paint(el, FAM.crimson);
  el.innerHTML = `${head("No forecast", "Something went wrong")}<div class="err"><p>${esc(msg)}</p><button class="btn" id="retry">Try again</button></div>`;
  $("#retry").onclick = () => load(place);
}
let airWait = false; // the air quality is still loading (the forecast came first)
let loading = false, dataKey = "", loadCtrl = null, shownPlace = null; // shownPlace: the place whose forecast is on screen
// A background refresh waits its turn; something you asked for (another place, a refresh) calls off whatever is loading.
async function load(p, { quiet = false } = {}) {
  if (!p || (loading && quiet)) return;
  if (loadCtrl) loadCtrl.abort();
  const my = loadCtrl = new AbortController();
  const prev = place, key = cacheKey(p);
  loading = true; $("#refreshBtn").classList.add("spin"); $("#netPill").classList.add("busy");
  place = p; store.set("place", p);
  if (!saved.some(s => samePlace(s, p))) { roamer = p; store.set("roamer", p); } // an unsaved place leads the swipe order
  renderPlace();
  // a place seen before opens straight from its last forecast while the fresh one loads
  if (dataKey !== key) { const hit = forecasts.get(key); if (hit) { adopt(hit, key); shownPlace = p; try { renderAll(); } catch (e) { console.error(e); } } }
  try {
    const [wP, aP, uP] = fetchAll(p, my.signal);
    const w = await wP;
    if (my.signal.aborted) return;
    // The cards appear as soon as the forecast is in: the air quality and the model spread are slower services and
    // must not hold up the first screen. Until they arrive, the last ones for this place stay (or their cards wait).
    const keepA = dataKey === key ? AQ : null, keepU = dataKey === key ? U : null;
    adopt({ D: w, AQ: keepA, U: keepU, at: Date.now() }, key); shownPlace = p;
    netFail = false; loadWarnings(p);
    airWait = !keepA; renderAll();
    const [a, u] = await Promise.all([aP, uP]);
    if (my.signal.aborted || dataKey !== key) return;
    airWait = false; AQ = a || keepA; U = (u && confidence(u)) || keepU;
    forecasts.put(key, { D, AQ, U, at: fetchedAt });
    for (const f of [renderSummary, renderAir, renderPollen, renderHourly, ...($("#dlgDays").open ? [renderDays] : [])]) { try { f(); } catch (e) { console.error(f.name, e); } }
  } catch (e) {
    if (my.signal.aborted) return; // replaced by a newer request: that one reports
    netFail = true;
    if (dataKey === key) { if (!quiet && navigator.onLine) toast("Couldn't reach the forecast. Showing the last one."); }
    else if (!D) showError(navigator.onLine ? `Couldn't load the forecast: ${e.message}. Try again in a moment.` : "You're offline. Connect to the internet to load the forecast.");
    else { // nothing kept for this place: stay on the one that is showing
      place = shownPlace || prev; store.set("place", place); renderPlace();
      toast(navigator.onLine ? `Couldn't load ${p.name}. Try again in a moment.` : `${p.name} loads once you're back online.`);
    }
  } finally { if (loadCtrl === my) { loadCtrl = null; loading = false; $("#refreshBtn").classList.remove("spin"); $("#netPill").classList.remove("busy"); renderNet(); } }
}
function adopt(f, key) { D = f.D; AQ = f.AQ; U = f.U || null; TZ = D.timezone; OFF = D.utc_offset_seconds; fetchedAt = f.at; dataKey = key; }
const cacheKey = p => [p.lat, p.lon, S.temp, S.wind, S.precip, S.model].join("|");
/* The last forecast of the six most recent places and settings, so they open offline too. */
const forecasts = {
  mem: null, // read from storage once; afterwards kept in memory, so a refresh doesn't parse every stored forecast again
  all() {
    if (this.mem) return this.mem;
    const c = store.get("forecasts", null); if (c) return (this.mem = c);
    const old = store.get("cache", null); // the single-place cache of earlier versions
    return (this.mem = old && old.key ? { [old.key]: { D: old.D, AQ: old.AQ, at: old.at } } : {});
  },
  get(key) { return this.all()[key] || null; },
  put(key, f) {
    const c = this.all(); c[key] = f;
    const keys = Object.keys(c).sort((a, b) => c[b].at - c[a].at);
    this.mem = Object.fromEntries(keys.slice(0, 6).map(k => [k, c[k]]));
    // a full storage keeps fewer places rather than none
    for (let n = Math.min(6, keys.length); n > 0; n--) {
      try { localStorage.setItem("isobar:forecasts", JSON.stringify(Object.fromEntries(keys.slice(0, n).map(k => [k, c[k]])))); break; } catch {}
    }
    try { localStorage.removeItem("isobar:cache"); } catch {}
  }
};

/* ---------------- official weather warnings ---------------- */
/* MeteoAlarm's warnings (KMI, KNMI, DWD...), prepared every half hour by .github/workflows/warnings.yml and stored
   in 5° tiles on the "warnings" branch. The app fetches its own tile and keeps the warnings whose area it is in. */
const WARN_URL = "https://raw.githubusercontent.com/victorvansande/kwick/warnings/w/";
const WLEVEL = { 2: ["Yellow", "#ffd23f"], 3: ["Orange", "#ff8a1f"], 4: ["Red", "#ff3b30"] };
let warnings = [];
// is the point inside the warning's outline? (even-odd rule, so holes in a region count as outside)
function inWarning(w, x, y) {
  const [x0, y0, x1, y1] = w.bbox; if (x < x0 || x > x1 || y < y0 || y > y1) return false;
  return w.polys.some(rings => {
    let inside = false;
    for (const r of rings) for (let i = 0, j = r.length - 2; i < r.length; j = i, i += 2) {
      const xi = r[i], yi = r[i + 1], xj = r[j], yj = r[j + 1];
      if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) inside = !inside;
    }
    return inside;
  });
}
// When the warnings feed itself has gone quiet (not updated for 2 hours, or gone), saying nothing would read as "all
// clear". warnStale then holds the time of its last update ("" if unknown) and the banner says warnings are unavailable.
let warnStale = null;
async function loadWarnings(p) {
  let updated;
  try {
    const r = await fetch(`${WARN_URL}${Math.floor(p.lat / 5)}_${Math.floor(p.lon / 5)}.json`, { cache: "no-cache" });
    if (r.status === 404) { // no warnings anywhere in this tile; trust that only if the feed is alive
      warnings = [];
      const ix = await fetch(WARN_URL.replace(/w\/$/, "index.json"), { cache: "no-cache" });
      updated = ix.ok ? (await ix.json()).updated : null;
    } else if (r.ok) {
      const j = await r.json(), soon = Date.now() + 36 * 36e5; // what's on now, and what starts within the next day and a half
      updated = j.updated;
      warnings = j.warnings.filter(w => Date.parse(w.expires) > Date.now() && Date.parse(w.onset) < soon && inWarning(w, p.lon, p.lat))
        .sort((a, b) => b.level - a.level || Date.parse(a.onset) - Date.parse(b.onset));
    } else return; // other failures (a hiccup): keep what was shown
    warnStale = !updated || Date.now() - Date.parse(updated) > 2 * 36e5 ? (updated || "") : null;
  } catch { return; } // offline: keep what was shown
  if (place === p) renderWarnings();
}
// "14:00", "tomorrow 06:00" or "Tue 09:00", in the place's own time
function whenAt(d) {
  const key = x => new Date(x.valueOf() + OFF * 1000).toISOString().slice(0, 10), today = key(new Date()), k = key(d);
  return k === today ? fmtT(d) : k === key(new Date(Date.now() + 864e5)) ? `tomorrow ${fmtT(d)}` : `${wd(k)} ${fmtT(d)}`;
}
// the notice that warnings are unavailable can be hidden; it comes back when the feed goes quiet again another time
const warnHideKey = () => warnStale || `none ${new Date().toDateString()}`;
function renderWarnings() {
  const b = $("#warn"), x = $("#warnX"); b.classList.remove("stale"); x.hidden = true;
  document.documentElement.classList.remove("warned");
  if (!warnings.length && warnStale !== null) { // the feed is down: say so rather than show nothing
    if (store.get("warnHide", null) === warnHideKey()) { b.hidden = true; return; }
    b.hidden = false; x.hidden = false; b.classList.add("stale"); b.style.setProperty("--wc", "#9aa0aa");
    $("#warnT").textContent = "Warnings unavailable";
    $("#warnS").textContent = warnStale ? `Last updated ${whenAt(new Date(warnStale))}` : "The warnings feed isn't responding";
    b.setAttribute("aria-label", `Official weather warnings are unavailable right now. ${$("#warnS").textContent}.`);
    return;
  }
  b.hidden = !warnings.length; if (!warnings.length) return;
  // an orange or red warning in force right now also shows in the app's frame: a thin edge in its colour round the
  // dock and a dot in the top bar, so it stays noticed while scrolling (set here, cleared at the top)
  const strong = warnings.find(v => v.level >= 3 && Date.now() >= Date.parse(v.onset) && Date.now() < Date.parse(v.expires));
  if (strong) { document.documentElement.classList.add("warned"); document.documentElement.style.setProperty("--warn-c", WLEVEL[strong.level][1]); }
  const w = warnings[0], [name, col] = WLEVEL[w.level] || WLEVEL[2], now = Date.now() >= Date.parse(w.onset);
  b.style.setProperty("--wc", col);
  $("#warnT").textContent = `${name} warning · ${w.type}`;
  $("#warnS").textContent = [now ? `Until ${whenAt(new Date(w.expires))}` : `From ${whenAt(new Date(w.onset))}`, warnings.length > 1 ? `+${warnings.length - 1} more` : (w.areas[0] || "")].filter(Boolean).join(" · ");
  b.setAttribute("aria-label", `${name} weather warning for ${w.type}. ${$("#warnS").textContent}. Show details.`);
}
$("#warnX").onclick = () => { store.set("warnHide", warnHideKey()); renderWarnings(); };
$("#warn").onclick = () => {
  if (!warnings.length) { $("#warnBody").innerHTML = `<p>The official warnings (MeteoAlarm, via KMI and the other national weather services) couldn't be refreshed for a while, so this app can't tell whether any apply right now. Check your national weather service.</p>`; $("#dlgWarn").showModal(); return; }
  const link = u => /^https?:\/\//.test(u) ? ` · <a href="${esc(u)}" target="_blank" rel="noopener">More details</a>` : "";
  $("#warnBody").innerHTML = warnings.map(w => {
    const [name, col] = WLEVEL[w.level] || WLEVEL[2];
    return `<div class="wx" style="--wc:${col}"><h3><i></i>${esc(name)} warning · ${esc(w.type)}</h3>
      <p class="when">${esc(whenAt(new Date(w.onset)))} – ${esc(whenAt(new Date(w.expires)))}${w.areas.length ? " · " + esc(w.areas.slice(0, 3).join(", ")) : ""}</p>
      ${w.description ? `<p>${esc(w.description)}</p>` : w.headline ? `<p>${esc(w.headline)}</p>` : ""}
      ${w.instruction && !/^be (vigilant|aware)\.?$/i.test(w.instruction.trim()) ? `<p>${esc(w.instruction)}</p>` : ""}
      <p>${esc(w.sender || "MeteoAlarm")}${link(w.web)}</p></div>`;
  }).join("");
  $("#dlgWarn").showModal();
};

/* ---------------- connection ---------------- */
// like a native app: without a connection the last forecast stays up, with a pill saying since when
let netFail = false;
const updLabel = t => fmtTD(t); // "13:30", "23:00 yesterday" or "Tue 13:30"
function renderNet() {
  const offline = !navigator.onLine, on = (offline || netFail) && !!D, pill = $("#netPill");
  pill.classList.toggle("on", on); pill.setAttribute("aria-hidden", String(!on)); pill.tabIndex = on ? 0 : -1;
  document.body.classList.toggle("net-off", on);
  if (on) {
    // one short phrase, so it fits beside Retry on the smallest phone: "Couldn't update since 13:30" (with the day
    // when it's older than 20 hours)
    $("#netT").textContent = offline ? "Offline" : "Couldn't update";
    $("#netS").textContent = `since ${updLabel(fetchedAt)}`;
    pill.setAttribute("aria-label", `${offline ? "Offline" : "Couldn't update"} since ${updLabel(fetchedAt)}, forecast from then. Retry.`);
  }
  $("#c-radar").classList.toggle("offline", offline);
}
// Retry fetches the forecast again at once; if that fails too while the phone says it's online, the page itself
// reloads (a home-screen app left in the background for long can keep a stuck connection that only a reload clears)
$("#netPill").onclick = async () => {
  if (loading) return;
  await load(place);
  if (!netFail || !navigator.onLine) return;
  // at most one reload every two minutes, so a forecast service that is down doesn't turn Retry into a reload loop
  let last = 0; try { last = +sessionStorage.getItem("retryReload") || 0; sessionStorage.setItem("retryReload", String(Date.now())); } catch {}
  if (Date.now() - last > 12e4) location.reload();
};
addEventListener("online", () => { netFail = false; renderNet(); if (place) load(place, { quiet: true }); });
addEventListener("offline", renderNet);

let toastT;
function toast(msg) { const t = $("#toast"); t.textContent = msg; t.hidden = false; clearTimeout(toastT); toastT = setTimeout(() => t.hidden = true, 3600); }

/* ---------------- deck ---------------- */
$("#c-days").addEventListener("click", e => {
  const go = e.target.closest("[data-spread]"); if (go) return openSpread(+go.dataset.spread);
  const b = e.target.closest(".day-h"); if (!b) return;
  const art = b.parentElement, was = art.classList.contains("open");
  document.querySelectorAll(".day.open").forEach(d => { d.classList.remove("open"); d.querySelector(".day-h").setAttribute("aria-expanded", "false"); });
  if (!was) { art.classList.add("open"); b.setAttribute("aria-expanded", "true"); store.set("openDay", +b.dataset.n); } else store.set("openDay", -1);
});

/* ---------------- places ---------------- */
const dlgP = $("#dlgPlaces"), dlgS = $("#dlgSet");
document.querySelectorAll("[data-close]").forEach(b => b.onclick = () => b.closest("dialog").close());
[dlgP, dlgS, $("#dlgDays"), $("#dlgInfo"), $("#dlgLearn"), $("#dlgWarn"), $("#dlgSpread")].forEach(d => d.addEventListener("click", e => { if (e.target === d) d.close(); }));
// a place: the row itself is a button; for saved places the remove button sits beside it (never inside another button)
const placeRow = (p, i, kind) => `<div class="prow"><button class="row" data-kind="${kind}" data-i="${i}"><span><b>${esc(p.name)}</b><span>${esc(p.sub || `${p.lat}, ${p.lon}`)}</span></span></button>${kind === "saved" ? `<button class="x" data-del="${i}" aria-label="Remove ${esc(p.name)}">✕</button>` : ""}</div>`;
let results = [];
function renderSaved() {
  $("#savedList").innerHTML = saved.length ? saved.map((p, i) => placeRow(p, i, "saved")).join("") : `<p class="muted" style="margin:4px 14px;font-size:13px">No saved places yet.</p>`;
  const isSaved = place && saved.some(s => s.lat === place.lat && s.lon === place.lon);
  $("#saveCur").hidden = !place || isSaved;
  if (place) $("#saveCurT").textContent = `Save ${place.name}`;
  renderDots();
}
// The places sheet opens with the search field in view: on a phone it hangs from the top of the screen and is only as
// tall as the space above the keyboard (the visible viewport), so nothing of the page shows between it and the keys
function openPlaces() {
  renderSaved(); $("#results").innerHTML = ""; $("#q").value = ""; results = [];
  const sh = dlgP.querySelector(".sheet"); dlgP.showModal(); sh.scrollTop = 0; requestAnimationFrame(() => { sh.scrollTop = 0; });
}
if (window.visualViewport) {
  const vv = visualViewport, fit = () => document.documentElement.style.setProperty("--vvh", `${Math.round(vv.height)}px`);
  vv.addEventListener("resize", fit); fit();
}

/* ---------------- swipe between places ---------------- */
// You swipe through your saved places, led by the last place you opened that isn't saved (such as the spot your
// location found). Small dots under "Places" in the dock show how many there are and where you are.
const samePlace = (a, b) => !!a && !!b && a.lat === b.lat && a.lon === b.lon;
let roamer = store.get("roamer", null);
function placeRing() { const r = saved.slice(); if (roamer && !r.some(s => samePlace(s, roamer))) r.unshift(roamer); return r; }
function renderDots() {
  const r = placeRing(), i = r.findIndex(s => samePlace(s, place));
  $("#pdots").innerHTML = r.length > 1 ? r.map((_, k) => `<i class="${k === i ? "on" : ""}"></i>`).join("") : "";
  $("#searchBtn").setAttribute("aria-label", r.length > 1 && i >= 0 ? `Places, ${i + 1} of ${r.length}` : "Places");
}
// Lets go of the page after a swipe (`dir` 1 = next place, -1 = previous, 0 = stay): it slides out, the new place
// loads (instantly when its forecast was kept), and slides in from the other side. With nowhere to go it springs back.
let swiping = false;
async function release(dir) {
  const app = $(".app"), from = app.style.transform || "translateX(0px)", op = app.style.opacity || "1";
  app.style.transform = ""; app.style.opacity = "";
  const r = placeRing(), next = dir ? r[r.findIndex(s => samePlace(s, place)) + dir] : null;
  if (!next || swiping) { app.animate([{ transform: from, opacity: op }, { transform: "translateX(0)", opacity: 1 }], { duration: 280, easing: "cubic-bezier(.2,.8,.2,1)" }); return; }
  swiping = true;
  const out = app.animate([{ transform: from, opacity: op }, { transform: `translateX(${-dir * 32}%)`, opacity: 0 }], { duration: 170, easing: "cubic-bezier(.4,0,1,1)", fill: "forwards" });
  await out.finished;
  scrollTo(0, 0); load(next);
  { const r = placeRing(); toast(`${next.name} · ${r.findIndex(s => samePlace(s, next)) + 1} of ${r.length}`); } // where you landed
  app.animate([{ transform: `translateX(${dir * 32}%)`, opacity: 0 }, { transform: "translateX(0)", opacity: 1 }], { duration: 320, easing: "cubic-bezier(.2,.8,.2,1)" });
  out.cancel(); swiping = false;
}
{
  const app = $(".app");
  // controls that move sideways themselves keep their own gesture
  const own = t => t.closest(".hscroll,.leaflet-container,[role=slider],.band,#arcIn,#moonCv,.rticks,.zoomer,.rbar,input");
  // Only a clearly sideways swipe counts (twice as far sideways as up or down), so scrolling never switches places by
  // accident. While you drag, the next place's name slides in at the edge it comes from; once you have dragged far
  // enough to switch it lights up. Letting go there (or flicking) switches; anywhere short of it springs back.
  let x0 = 0, y0 = 0, t0 = 0, dx = 0, mode = "no", ready = false;
  const peek = $("#swPeek"), far = () => Math.min(innerWidth * .28, 130);
  const hidePeek = () => { peek.className = "swpeek"; peek.style.opacity = ""; };
  app.addEventListener("touchstart", e => {
    mode = e.touches.length === 1 && !own(e.target) && placeRing().length > 1 && !swiping ? "maybe" : "no";
    x0 = e.touches[0].clientX; y0 = e.touches[0].clientY; t0 = e.timeStamp; dx = 0; ready = false;
  }, { passive: true });
  app.addEventListener("touchmove", e => {
    if (mode === "no") return;
    const t = e.touches[0], mx = t.clientX - x0, my = t.clientY - y0;
    if (mode === "maybe") { if (Math.hypot(mx, my) < 14) return; mode = Math.abs(mx) > Math.abs(my) * 2 ? "swipe" : "no"; if (mode === "no") return; }
    e.preventDefault(); dx = mx; // a sideways swipe: the page follows the finger instead of scrolling
    const r = placeRing(), i = r.findIndex(s => samePlace(s, place)), there = r[i + (dx < 0 ? 1 : -1)];
    const shift = there ? dx * .55 : dx * .18; // with nothing that way it only gives a little
    app.style.transform = `translateX(${shift.toFixed(1)}px)`; app.style.opacity = (1 - Math.min(Math.abs(shift) / 700, .3)).toFixed(3);
    if (!there) return hidePeek();
    const p = Math.min(Math.abs(dx) / far(), 1), now = p >= 1;
    peek.className = `swpeek on ${dx < 0 ? "r" : "l"}${now ? " ready" : ""}`; peek.style.opacity = Math.min(p * 1.6, 1).toFixed(2);
    $("#swPeekName").textContent = there.name; $("#swPeekN").textContent = `${r.indexOf(there) + 1} of ${r.length}`;
    if (now && !ready && navigator.vibrate) navigator.vibrate(8); // a small tick on Android when it will switch
    ready = now;
  }, { passive: false });
  const end = e => {
    if (mode !== "swipe") return; mode = "no"; hidePeek();
    const fast = Math.abs(dx) > 50 && Math.abs(dx) / Math.max(e.timeStamp - t0, 1) > .6; // a quick flick also switches
    release(ready || fast ? (dx < 0 ? 1 : -1) : 0);
  };
  app.addEventListener("touchend", end); app.addEventListener("touchcancel", end);
  // on a computer: the arrow keys
  document.addEventListener("keydown", e => {
    if ((e.key !== "ArrowLeft" && e.key !== "ArrowRight") || e.altKey || e.ctrlKey || e.metaKey || document.querySelector("dialog[open]") || (e.target.closest && e.target.closest("input,[role=slider],.hscroll,.leaflet-container,.band,.rticks"))) return;
    if (placeRing().length > 1) release(e.key === "ArrowRight" ? 1 : -1);
  });
}
let qT;
$("#q").addEventListener("input", e => {
  dlgP.querySelector(".sheet").scrollTop = 0; // new results start at the top, with the field in view
  clearTimeout(qT); const q = e.target.value.trim();
  if (q.length < 2) { $("#results").innerHTML = ""; results = []; return; }
  qT = setTimeout(async () => {
    try { results = await geocode(q); $("#results").innerHTML = results.length ? results.map((p, i) => placeRow(p, i, "res")).join("") : `<p class="muted" style="margin:4px 14px;font-size:13px">No places match “${esc(q)}”.</p>`; }
    catch { $("#results").innerHTML = `<p class="muted" style="margin:4px 14px;font-size:13px">Search isn't reachable right now.</p>`; }
  }, 260);
});
$("#q").addEventListener("keydown", e => { if (e.key === "Enter") { e.preventDefault(); if (results[0]) { dlgP.close(); load(results[0]); } } });
dlgP.addEventListener("click", e => {
  const del = e.target.closest("[data-del]");
  if (del) { e.stopPropagation(); saved.splice(+del.dataset.del, 1); store.set("saved", saved); renderSaved(); return; }
  const row = e.target.closest(".row[data-kind]"); if (!row) return;
  const p = row.dataset.kind === "saved" ? saved[+row.dataset.i] : results[+row.dataset.i];
  dlgP.close(); load(p);
});
$("#saveCur").onclick = () => { if (!place) return; saved.push({ name: place.name, sub: place.sub, lat: place.lat, lon: place.lon }); store.set("saved", saved); renderSaved();
  // the first time there is more than one place, say once how to move between them
  if (placeRing().length > 1 && !store.get("swipeHint", false)) { store.set("swipeHint", true); toast(`Saved ${place.name}. Swipe sideways to switch places`); }
  else toast(`Saved ${place.name}`);
};
$("#placeBtn").onclick = openPlaces; $("#searchBtn").onclick = openPlaces;
$("#locBtn").onclick = async () => {
  $("#locBtn").classList.add("spin");
  try { const c = await geolocate(); await load(await reverse(c.latitude, c.longitude)); }
  catch (e) { toast(e.message); }
  finally { $("#locBtn").classList.remove("spin"); }
};
// the same from inside the places sheet: it closes at once and the dock button shows the search
$("#useLoc").onclick = () => { dlgP.close(); $("#locBtn").click(); };
$("#refreshBtn").onclick = () => load(place);
$("#topbar").onclick = () => scrollTo({ top: 0, behavior: "smooth" });

/* ---------------- settings ---------------- */
function renderSettings() {
  document.querySelectorAll(".seg").forEach(seg => [...seg.children].forEach(b => b.setAttribute("aria-pressed", String(S[seg.dataset.k] === b.dataset.v))));
  $("#models").innerHTML = MODELS.map(([id, n, d]) => `<button data-m="${id}" aria-pressed="${S.model === id}"><b>${esc(n)}</b><span>${esc(d)}</span></button>`).join("");
}
function setSetting(k, v) {
  if (S[k] === v) return;
  const old = S[k], refetch = ["temp", "wind", "precip", "model"].includes(k);
  S[k] = v;
  // units and models come from the server: offline that only works if this combination was kept before
  if (refetch && !navigator.onLine && place && !forecasts.get(cacheKey(place))) { S[k] = old; renderSettings(); return toast("That needs a connection. Try again once you're online."); }
  store.set("settings", S); if (k === "clock") store.set("clockChosen", true); renderSettings();
  if (refetch) load(place);
  else if (D) renderAll(); else applyMode();
}
dlgS.addEventListener("click", e => {
  const b = e.target.closest(".seg button"); if (b) return setSetting(b.parentElement.dataset.k, b.dataset.v);
  const m = e.target.closest("[data-m]"); if (m) setSetting("model", m.dataset.m);
});
// the dock button opens all settings; the model chip opens just the forecast models
const openSettings = modelOnly => { dlgS.classList.toggle("model-only", modelOnly); $("#setTitle").textContent = modelOnly ? "Forecast model" : "Settings"; renderSettings(); dlgS.showModal(); };
$("#setBtn").onclick = () => openSettings(false);
$("#modelChip").onclick = () => openSettings(true);
$("#infoBtn").onclick = () => $("#dlgInfo").showModal();
/* While a sheet is open the page behind it stays put. iOS ignores overflow: hidden and scrolls the page whenever a swipe
   on the sheet (or beside it) has nothing left to scroll, so the page is pinned where it was and put back exactly there
   when the last sheet closes; the top bar keeps its state meanwhile. Watches every dialog, so new sheets are covered too. */
let lockY = null;
const lockPage = () => {
  const open = !!document.querySelector("dialog[open]"), b = document.body.style;
  if (open && lockY == null) { lockY = scrollY; Object.assign(b, { position: "fixed", top: `-${lockY}px`, left: "0", right: "0" }); }
  else if (!open && lockY != null) { Object.assign(b, { position: "", top: "", left: "", right: "" }); scrollTo(0, lockY); lockY = null; }
};
document.querySelectorAll("dialog").forEach(d => new MutationObserver(lockPage).observe(d, { attributes: true, attributeFilter: ["open"] }));

/* ---------------- Android ---------------- */
// The back button (or gesture) closes an open sheet instead of leaving the app. Each sheet adds a step to the
// history while it's open; closing it any other way (✕, a tap outside, Escape) takes that step back out again.
{
  // history.back() lands a moment later: a sheet opened before it has landed waits for it before adding its own step,
  // or the late step back would take the new sheet's step out and the next back would leave the app
  let skipPop = 0, waiting = [];
  document.querySelectorAll("dialog").forEach(d => {
    const push = () => { if (d.open) history.pushState({ sheet: d.id }, ""); else d.hist = false; };
    new MutationObserver(() => { if (d.open && !d.hist) { d.hist = true; if (skipPop) waiting.push(push); else push(); } }).observe(d, { attributes: true, attributeFilter: ["open"] });
    d.addEventListener("close", () => { if (!d.hist) return; d.hist = false; if (history.state && history.state.sheet === d.id) { skipPop++; history.back(); } });
  });
  addEventListener("popstate", () => {
    if (skipPop) { if (!--skipPop) { const w = waiting; waiting = []; w.forEach(f => f()); } return; }
    const d = document.querySelector("dialog[open]"); if (d) { d.hist = false; d.close(); }
  });
}
// Chrome offers to install the app: show "Install Kwick as an app" in Settings while that offer stands
// (iPhones never make this offer; there it's Share → Add to Home Screen).
let installOffer = null;
addEventListener("beforeinstallprompt", e => { e.preventDefault(); installOffer = e; $("#installBtn").hidden = false; });
addEventListener("appinstalled", () => { installOffer = null; $("#installBtn").hidden = true; });
$("#installBtn").onclick = async () => { if (!installOffer) return; installOffer.prompt(); await installOffer.userChoice.catch(() => {}); installOffer = null; $("#installBtn").hidden = true; };
// shortcuts from a long press on the app icon: ?open=places, radar or days
function openFromLink() {
  const what = new URLSearchParams(location.search).get("open"); if (!what) return;
  history.replaceState(history.state, "", location.pathname); // so a refresh doesn't open it again
  if (what === "places") openPlaces();
  else if (what === "radar") card("c-radar").scrollIntoView({ block: "center" });
  else if (what === "days" && D) openDays(null);
}

/* ---------------- only animate what can be seen ---------------- */
// Each card pauses its CSS animations, and the JS loops tied to it (radar playback, heat shimmer, running
// condensation beads), while it's scrolled out of view. The margin is generous, so everything is already running
// again by the time it scrolls in, exactly as it was left: nothing changes on screen, the phone just does less work.
const offscreen = id => { const el = card(id); return !!el && el.classList.contains("offscreen"); };
/* Chrome, short of graphics memory, can drop a layer's pixels and leave a card showing only its background until
   something repaints it (a tap did). So a card is repainted, for free, each time it comes into view and when the app
   comes back to the front: a paint-only class on for one frame makes Chrome draw it afresh. Together with fewer and
   smaller layers (no blur on the cards' light, its drift stopped off screen) this keeps cards from staying empty. */
const repaint = el => { el.classList.add("rp"); requestAnimationFrame(() => requestAnimationFrame(() => el.classList.remove("rp"))); };
if ("IntersectionObserver" in window) {
  const io = new IntersectionObserver(es => {
    for (const e of es) { e.target.classList.toggle("offscreen", !e.isIntersecting); if (e.isIntersecting) repaint(e.target); }
  }, { rootMargin: "300px 0px" });
  const seen = new IntersectionObserver(es => { for (const e of es) if (e.isIntersecting) repaint(e.target); }); // and once more as it really enters the screen
  document.querySelectorAll("#board > .card").forEach(el => { io.observe(el); seen.observe(el); });
}
const repaintVisible = () => document.querySelectorAll("#board > .card:not(.offscreen)").forEach(repaint);
document.addEventListener("visibilitychange", () => { if (!document.hidden) repaintVisible(); });
addEventListener("pageshow", repaintVisible);
// a canvas whose drawing the graphics chip threw away (Chrome tells it so) is drawn again with its card
document.addEventListener("contextrestored", e => { if (e.target.closest?.(".card") && X.c) renderAll(); }, true);

/* ---------------- wall view ---------------- */
/* Every card on one screen, just for fun on a spare monitor: the app is laid out at a fixed 2720 px width (and as tall as
   the window's shape asks) in a 9 × 4 grid, then scaled as one piece to fit the window. Opened from the link at the
   bottom of About the data, with the W key or with ?wall in the address; W, Esc or the corner × close it. */
let wallOn = false;
function fitWall(atLeast = 0) {
  const W = 2720, H = Math.max(1330, Math.round(W * innerHeight / innerWidth), Math.round(atLeast)), s = Math.min(innerWidth / W, innerHeight / H), r = document.documentElement.style;
  r.setProperty("--wall-w", `${W}px`); r.setProperty("--wall-h", `${H}px`); r.setProperty("--wall-s", s.toFixed(4));
  r.setProperty("--wall-x", `${((innerWidth - W * s) / 2).toFixed(1)}px`); r.setProperty("--wall-y", `${((innerHeight - H * s) / 2).toFixed(1)}px`);
}
/* Nothing on the wall is ever cut off: once the cards are in place it measures how far any card's own content runs
   past its bottom, and makes the wall that much taller (the four rows share the extra), then scales the whole a little
   smaller to fit the window. A short, wide window simply gets a slightly smaller wall. */
function settleWall() {
  for (let pass = 0; pass < 4; pass++) {
    const root = document.documentElement, s = parseFloat(root.style.getPropertyValue("--wall-s")) || 1;
    let over = 0;
    for (const c of document.querySelectorAll("#board > .card")) {
      if (!c.getClientRects().length) continue;
      const kids = [...c.children].filter(k => { const cs = getComputedStyle(k); return cs.position !== "absolute" && cs.position !== "fixed" && cs.display !== "none" && parseFloat(cs.marginBottom) >= 0 && k.getClientRects().length; }); // not what bleeds to the edge on purpose (the visibility landscape)
      if (!kids.length) continue;
      const bottom = Math.max(...kids.map(k => k.getBoundingClientRect().bottom)) + parseFloat(getComputedStyle(c).paddingBottom) * s;
      over = Math.max(over, (bottom - c.getBoundingClientRect().bottom) / s);
    }
    if (over <= 1) return;
    fitWall(parseFloat(root.style.getPropertyValue("--wall-h")) + over * 4 + 8);
  }
}
function setWall(on) {
  if (on === wallOn) return; wallOn = on;
  document.documentElement.classList.toggle("wall", on);
  if (on) { fitWall(); scrollTo(0, 0); }
  if (D) renderAll(); // the canvases and the cloud field size themselves to their new cards
  if (map) setTimeout(() => map.invalidateSize(), 60);
}
$("#wallX").onclick = () => setWall(false);
document.addEventListener("keydown", e => {
  if (e.altKey || e.ctrlKey || e.metaKey || document.querySelector("dialog[open]") || (e.target.closest && e.target.closest("input,textarea"))) return;
  if (e.key === "w" || e.key === "W") setWall(!wallOn);
  else if (e.key === "Escape" && wallOn) setWall(false);
});
if (new URLSearchParams(location.search).has("wall")) setWall(true);

/* ---------------- lifecycle ---------------- */
document.querySelectorAll("[data-fam]").forEach(el => paint(el, FAM[el.dataset.fam]));
// stagger the slow inflow so the cards don't pulse in unison
document.querySelectorAll(".pig").forEach((el, i) => el.style.setProperty("--delay", `${(-(i * 7.3) % 34).toFixed(1)}s`));
let rT;
// Phones fire "resize" whenever the address bar slides in or out while scrolling; only a real change of width (turning
// the phone, resizing a window) needs the canvases redrawn, and redrawing clears them for a moment.
let lastW = innerWidth;
window.addEventListener("resize", () => {
  fitName(); fitHeads();
  clearTimeout(rT);
  if (wallOn) fitWall(); // the wall view rescales at once, and redraws its cards once the window settles
  rT = setTimeout(() => {
    if (wallOn) { if (D) renderAll(); if (map) map.invalidateSize(); return; }
    if (innerWidth === lastW) { if (map) map.invalidateSize(); return; }
    lastW = innerWidth;
    drawMoons(); drawYear(); if (map) map.invalidateSize();
    // canvas effects are drawn at a fixed pixel size, so redraw them (instantly) at the new size
    const hf = $("#heroFrost"); if (hf) frostRim(hf);
    const hc = $("#humidCv"); if (hc) startCondensation(hc);
    if (D) renderClouds(); // the cloud field fits as many rows as the card has room for
  }, 150);
});
const tb = $("#topbar");
let tbOn = null; // touch the top bar only when it actually shows or hides, not on every scroll event
window.addEventListener("scroll", () => { if (lockY != null) return; const on = scrollY > 160 && !!D; if (on === tbOn) return; tbOn = on; tb.classList.toggle("show", on); tb.setAttribute("aria-hidden", String(!on)); }, { passive: true });
let hiddenAt = 0;
document.addEventListener("visibilitychange", () => {
  if (document.hidden) { hiddenAt = Date.now(); return; }
  const away = hiddenAt && Date.now() - hiddenAt > 10 * 6e4;
  if (place && Date.now() - fetchedAt > 10 * 6e4) load(place, { quiet: true });
  if (away) followMe(); // back after a while: maybe somewhere else now
});

/* The app opens where you are: on launch, and on coming back after 10 minutes or more away, it checks your location
   and moves there when you're more than 3 km from the place on screen; near a saved place it shows that one, by its
   own name. Only once location has been allowed (here, or before in this app): it never asks out of the blue. While
   you use the app, a place you picked yourself stays. */
async function followMe() {
  if (!place || !navigator.onLine || !navigator.geolocation) return;
  let state = "prompt";
  try { state = (await navigator.permissions.query({ name: "geolocation" })).state; } catch {}
  if (state === "denied" || (state !== "granted" && !store.get("locOK", false))) return;
  try {
    const c = await geolocate(60000); // fresh: a position from before you set off would put you back home
    const km = (a, b) => Math.hypot((a.lat - b.lat) * 111, (a.lon - b.lon) * 111 * cos(a.lat * rad));
    const here = { lat: c.latitude, lon: c.longitude };
    if (km(here, place) < 3) return;
    const near = saved.map(s => [s, km(here, s)]).filter(([, d]) => d < 3).sort((a, b) => a[1] - b[1])[0];
    const to = near ? near[0] : await reverse(c.latitude, c.longitude);
    while (loading) await new Promise(r => setTimeout(r, 200));
    load(to, { quiet: true });
  } catch {}
}

/* Pull to refresh in the home-screen app (Safari has its own). */
if (document.documentElement.classList.contains("standalone")) {
  const el = $("#ptr"), arc = $("#ptrArc"), need = 110;
  let y0 = null, pull = 0;
  // the ring fills as you pull; full means letting go will refresh
  const set = p => { el.style.transform = `translateY(${-50 + Math.min(p, 170) * .45}px)`; el.style.opacity = Math.min(1, p / 60); arc.style.strokeDasharray = `${Math.min(100, p / need * 100).toFixed(1)} 100`; };
  const reset = () => { el.classList.add("snap"); el.style.transform = ""; el.style.opacity = ""; setTimeout(() => { el.classList.remove("snap", "go"); arc.style.strokeDasharray = ""; }, 320); };
  addEventListener("touchstart", e => {
    pull = 0;
    y0 = scrollY <= 0 && e.touches.length === 1 && !el.classList.contains("go") && !e.target.closest(".leaflet-container,dialog,#arcIn,[role=slider]") ? e.touches[0].clientY : null;
  }, { passive: true });
  addEventListener("touchmove", e => {
    if (y0 == null) return;
    if (scrollY > 0) { y0 = null; pull = 0; return reset(); }
    pull = Math.max(0, e.touches[0].clientY - y0); set(pull);
  }, { passive: true });
  addEventListener("touchend", async () => {
    if (y0 == null) return; y0 = null;
    if (pull < need || !place) return reset();
    el.classList.add("snap", "go"); el.style.transform = "translateY(6px)";
    await load(place); reset();
  });
}
setInterval(() => { if (place && !document.hidden) load(place, { quiet: true }); }, 10 * 6e4);
setInterval(() => { if (D && !document.hidden) { renderPlace(); renderNet(); } }, 30e3);
setInterval(renderClock, 1000);

(async function boot() {
  applyMode();
  // once the real lunar map is read, redraw the moon from it (until then the painted fallback shows)
  const moonIn = () => loadMoonMap().then(() => { moonMapWait = false; moonTex = null; drawMoons(); });
  if ("IntersectionObserver" in window) { // the 186 kB lunar map loads only as the moon card comes near the screen
    const io = new IntersectionObserver(es => { if (es.some(e => e.isIntersecting)) { io.disconnect(); moonIn(); } }, { rootMargin: "900px 0px" });
    io.observe(card("c-moon"));
  } else moonIn();
  const hit = place && forecasts.get(cacheKey(place));
  if (hit) { adopt(hit, cacheKey(place)); try { renderAll(); } catch (e) { console.error(e); } }
  renderNet();
  if (!place) { renderPlace(); place = await guessPlace(); }
  const first = load(place, { quiet: !!D });
  if (D) openFromLink(); else first.then(openFromLink);
  followMe();
})();
})();
