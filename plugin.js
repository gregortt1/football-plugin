// Kino plugin — Fútbol en vivo (canales)
// Data: pelotalibre.biz (agenda, canales + relay API). Stream relays: tvf90.com, streamxhd.st, la18hd.su.
// Target: Kino QuickJS sandbox (no fetch/Buffer/require; kino.fetch only).

const SITE = "https://pelotalibre.biz";
const AGENDA_URL = SITE + "/agenda";
const CHANNELS_URL = SITE + "/channels";
const MATCH_URL = SITE + "/match/";
const PLAYBACK_URL = SITE + "/api/direct-playback.php";
const DEFAULT_LOGO = SITE + "/assets/channel-logos/default-channel.svg";

const UA =
  "Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36";

const AGENDA_CACHE_MS = 60000;
const CHANNELS_CACHE_MS = 300000;
const STREAM_CACHE_MS = 120000;
const MATCH_PAGE = 300;
const CHANNEL_PAGE = 300;
const MAX_SOURCES = 3;
const MAX_SERVERS = 2;

// A football match can run past two hours with half time and stoppage time.
const MATCH_WINDOW_MS = 165 * 60 * 1000;
// Listed as live this many minutes before kick-off (pre-match studio).
const EARLY_MS = 10 * 60 * 1000;

// --- text helpers ---------------------------------------------------------

function isEnglish() {
  try {
    return typeof kino.lang === "string" && /^en/i.test(kino.lang);
  } catch (e) {
    return false;
  }
}

function t(es, en) {
  return isEnglish() ? en : es;
}

function log() {
  try {
    kino.log.apply(null, arguments);
  } catch (e) {
    // a log line is not worth failing a channel over
  }
}

function decodeEntities(value) {
  return String(value == null ? "" : value)
    .replace(/\\(?=['"&])/g, "")
    .replace(/&#0*39;/g, "'")
    .replace(/&#0*34;/g, '"')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&");
}

function clean(value) {
  return decodeEntities(value).replace(/\s+/g, " ").trim();
}

function clockText(ms) {
  const d = new Date(ms);
  if (isNaN(d.getTime())) return "";
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  return hh + ":" + mm;
}

// --- which competitions this plugin shows --------------------------------

// Anything that is not football (the agenda also carries padel, tennis, motor racing...).
const NOT_FOOTBALL =
  /^(sports|f1|nba|nfl|nhl|mlb|espn knockout|ufc|boxeo|boxing|tenis|atp|wta|p[aá]del|motogp|moto gp|f[oó]rmula|cricket|rugby|golf|ciclismo|atletismo|v[oó]lei|b[eé]isbol)/i;

// Women's football is left out on request: competitions, team lines and tags.
const WOMEN = /femenil|femenina|femenino|women'?s|\bwsl\b|damer|feminin/i;

function isFootball(competition) {
  return !NOT_FOOTBALL.test(String(competition || ""));
}

function isWomen(competition, teams) {
  return WOMEN.test(String(competition || "")) || WOMEN.test(String(teams || ""));
}

// --- agenda parsing -------------------------------------------------------

function parseAgenda(html, now) {
  const events = [];
  const bySlug = Object.create(null);
  const byMatch = Object.create(null);
  const chunks = String(html || "").split("data-agenda-event");

  for (let i = 1; i < chunks.length; i++) {
    const chunk = chunks[i];
    const slug = (/href="\/match\/([^"#?]+)#source=\d+"/.exec(chunk) || [])[1];
    if (!slug || bySlug[slug]) continue;

    const sources = [];
    const srcRe = /href="\/match\/([^"#?]+)#source=(\d+)"/g;
    let m;
    while ((m = srcRe.exec(chunk))) {
      if (m[1] !== slug) continue;
      if (sources.indexOf(m[2]) === -1) sources.push(m[2]);
    }
    if (!sources.length) continue;

    const competition = clean((/source-agenda-competition">([^<]*)</.exec(chunk) || [])[1]).replace(/:\s*$/, "");
    let teams = clean((/<strong><span class="source-agenda-competition">[^<]*<\/span>\s*([^<]+)<\/strong>/.exec(chunk) || [])[1]);
    if (!teams) continue;

    // The source sometimes repeats the competition inside the match line.
    if (competition) {
      const prefix = competition.toLowerCase() + ":";
      if (teams.toLowerCase().indexOf(prefix) === 0) teams = teams.slice(prefix.length).trim();
    }

    if (!isFootball(competition) || isWomen(competition, teams)) continue;

    const start = (/data-source-instant="([^"]+)"/.exec(chunk) || [])[1] || "";
    const at = start ? new Date(start).getTime() : 0;
    if (!at || isNaN(at)) continue;

    // A match that finished a while ago is not a channel any more.
    if (at + MATCH_WINDOW_MS < now) continue;

    // The agenda repeats some matches under two competition names: one card is enough,
    // and the copy with more sources is the one worth keeping.
    const key = teams.toLowerCase() + "@" + at;
    const previous = byMatch[key];
    if (previous !== undefined) {
      if (events[previous].sources.length >= sources.length) continue;
      events.splice(previous, 1);
      reindex(events, byMatch);
    }
    byMatch[key] = events.length;
    bySlug[slug] = true;

    events.push({
      slug: slug,
      competition: competition,
      teams: teams,
      start: start,
      at: at,
      sources: sources.slice(0, 6),
    });
  }

  events.sort(function (a, b) {
    if (a.at !== b.at) return a.at - b.at;
    return a.teams < b.teams ? -1 : a.teams > b.teams ? 1 : 0;
  });
  return events;
}

function reindex(events, byMatch) {
  for (let i = 0; i < events.length; i++) {
    byMatch[events[i].teams.toLowerCase() + "@" + events[i].at] = i;
  }
}

// --- channels page --------------------------------------------------------

function parseChannels(html) {
  const list = [];
  const seen = Object.create(null);
  const cardRe = /<a class="channel-card" href="\/channel\/([^"]+)">([\s\S]*?)<\/a>/g;
  let m;
  while ((m = cardRe.exec(String(html || "")))) {
    const slug = m[1];
    if (seen[slug]) continue;
    seen[slug] = true;

    const body = m[2];
    const name = clean((/<h3>([^<]+)<\/h3>/.exec(body) || [])[1]) || clean(slug);
    const logo = (/<img[^>]+src="([^"]+)"/.exec(body) || [])[1] || "";

    list.push({ slug: slug, name: name, logo: logoUrl(logo) });
  }
  return list;
}

// Kino draws network images as plain bitmaps, so an SVG logo goes through a raster step.
function logoUrl(value) {
  const url = siteUrl(value) || DEFAULT_LOGO;
  if (!/\.svg(\?|$)/i.test(url)) return url;
  return (
    "https://images.weserv.nl/?url=" +
    encodeURIComponent(url.replace(/^https?:\/\//, "")) +
    "&output=png&w=200&h=200&fit=contain"
  );
}

function siteUrl(value) {
  const url = String(value || "").trim();
  if (!url) return "";
  if (/^https?:\/\//i.test(url)) return url;
  if (url.indexOf("//") === 0) return "https:" + url;
  return SITE + (url.charAt(0) === "/" ? url : "/" + url);
}

// --- cached fetches -------------------------------------------------------

let agendaCache = { at: 0, html: "" };
let channelsCache = { at: 0, list: [] };

async function agendaHtml() {
  const now = Date.now();
  if (agendaCache.html && now - agendaCache.at < AGENDA_CACHE_MS) return agendaCache.html;
  try {
    const html = await getText(AGENDA_URL);
    if (html && html.length > 1000) {
      agendaCache = { at: now, html: html };
      return html;
    }
    throw new Error("empty agenda");
  } catch (e) {
    log("agenda failed", e && e.message);
    if (agendaCache.html) return agendaCache.html;
    throw e;
  }
}

async function agendaEvents() {
  return parseAgenda(await agendaHtml(), Date.now());
}

async function channelList() {
  const now = Date.now();
  if (channelsCache.list.length && now - channelsCache.at < CHANNELS_CACHE_MS) return channelsCache.list;
  try {
    const html = await getText(CHANNELS_URL);
    const list = parseChannels(html);
    if (list.length) {
      channelsCache = { at: now, list: list };
      return list;
    }
    throw new Error("no channels");
  } catch (e) {
    log("channels failed", e && e.message);
    if (channelsCache.list.length) return channelsCache.list;
    return [];
  }
}

// --- network helpers ------------------------------------------------------

async function getText(url) {
  const res = await kino.fetch(url, {
    headers: { "User-Agent": UA, Referer: SITE + "/" },
  });
  if (!res || !res.ok) throw new Error("HTTP " + (res ? res.status : "?"));
  return await res.text();
}

async function getJson(url) {
  const res = await kino.fetch(url, {
    headers: { "User-Agent": UA, Accept: "application/json", Referer: SITE + "/" },
  });
  if (!res || !res.ok) throw new Error("HTTP " + (res ? res.status : "?"));
  return await res.json();
}

// --- the capability list --------------------------------------------------

// En vivo is the home of this plugin: no catalogue rows, only channels.
export async function home() {
  return [];
}

export async function liveCategories() {
  return [
    { id: "vivo", title: t("Partidos en vivo", "Live matches"), genre: "deportes" },
    { id: "proximos", title: t("Próximos partidos", "Upcoming matches"), genre: "deportes" },
    { id: "canales", title: t("Canales deportivos", "Sports channels"), genre: "deportes" },
  ];
}

function matchChannel(event, categoryId) {
  return {
    id: "m-" + event.slug,
    title: event.teams.slice(0, 200),
    categoryId: categoryId,
    ref: "m~" + event.slug + "~" + event.at + "~" + event.sources.join("."),
    logo: SITE + "/og/match/" + encodeURIComponent(event.slug) + ".png",
  };
}

function sportsChannel(entry, index, categoryId) {
  return {
    id: "c-" + entry.slug,
    title: String(entry.name || entry.slug).slice(0, 200),
    categoryId: categoryId,
    ref: "c~" + entry.slug,
    logo: entry.logo || DEFAULT_LOGO,
    number: (index % 9999) + 1,
  };
}

function pageOf(list, cursor, size) {
  const from = cursor > 0 ? cursor : 0;
  const items = list.slice(from, from + size);
  const next = from + size < list.length ? String(from + size) : undefined;
  return { items: items, next: next };
}

export async function liveChannels(arg) {
  await null;
  const categoryId = String((arg && arg.categoryId) || "vivo");
  const cursor = arg && arg.cursor ? Number(arg.cursor) : 0;
  if (!isFinite(cursor) || cursor < 0) throw kino.error("not_found", "cursor inválido");

  if (categoryId === "canales") {
    const list = await channelList();
    const all = list.map(function (entry, index) {
      return sportsChannel(entry, index, categoryId);
    });
    return pageOf(all, cursor, CHANNEL_PAGE);
  }

  const events = await agendaEvents();
  const now = Date.now();
  let selected = [];

  if (categoryId === "vivo") {
    selected = events.filter(function (event) {
      return now >= event.at - EARLY_MS && now < event.at + MATCH_WINDOW_MS;
    });
  } else if (categoryId === "proximos") {
    selected = events.filter(function (event) {
      return event.at > now + EARLY_MS;
    });
  } else {
    return { items: [] };
  }

  const all = selected.map(function (event) {
    return matchChannel(event, categoryId);
  });
  return pageOf(all, cursor, MATCH_PAGE);
}

export async function liveSearch(arg) {
  await null;
  const query = clean((arg && arg.query) || "").toLowerCase();
  if (query.length < 2) return { items: [] };

  const words = query.split(/\s+/).filter(function (word) {
    return word.length > 0;
  });

  const hits = [];

  try {
    const events = await agendaEvents();
    for (let i = 0; i < events.length && hits.length < 60; i++) {
      const event = events[i];
      const hay = (event.teams + " " + event.competition).toLowerCase();
      if (!words.every(function (word) { return hay.indexOf(word) !== -1; })) continue;
      const item = matchChannel(event, Date.now() >= event.at - EARLY_MS ? "vivo" : "proximos");
      item.ref = "m~" + event.slug + "~" + event.at + "~" + event.sources.join(".");
      item.adult = false;
      hits.push(item);
    }
  } catch (e) {
    log("live search agenda failed", e && e.message);
  }

  try {
    const channels = await channelList();
    for (let i = 0; i < channels.length && hits.length < 100; i++) {
      const entry = channels[i];
      if (entry.name.toLowerCase().indexOf(query) === -1) continue;
      hits.push(sportsChannel(entry, i, "canales"));
    }
  } catch (e) {
    log("live search channels failed", e && e.message);
  }

  return { items: hits.slice(0, 100) };
}

export async function guide(arg) {
  await null;
  const ids = (arg && arg.channelIds) || [];
  const from = Number(arg && arg.from) || 0;
  const to = Number(arg && arg.to) || 0;
  if (!ids.length) return [];

  const events = await agendaEvents();
  const bySlug = Object.create(null);
  for (let i = 0; i < events.length; i++) bySlug[events[i].slug] = events[i];

  const out = [];
  for (let i = 0; i < ids.length && i < 50; i++) {
    const id = String(ids[i] || "");
    if (id.indexOf("m-") !== 0) continue;
    const event = bySlug[id.slice(2)];
    if (!event) continue;
    const start = event.at;
    const end = event.at + MATCH_WINDOW_MS;
    if (end <= from || start >= to) continue;
    out.push({
      channelId: id,
      title: event.teams.slice(0, 200),
      start: start,
      end: end,
      description: event.competition.slice(0, 200),
    });
  }
  return out;
}

// --- resolving a channel --------------------------------------------------

const resolveCache = Object.create(null);

export async function resolve(ref) {
  await null; // the checks below may throw: never before the first await
  const key = String(ref || "").trim();
  if (!key) throw kino.error("not_found", "referencia vacía");

  const cached = resolveCache[key];
  if (cached && Date.now() - cached.at < STREAM_CACHE_MS) return cached.stream;

  let stream = null;
  if (key.indexOf("c~") === 0) stream = await resolveChannel(key.slice(2));
  else if (key.indexOf("m~") === 0) stream = await resolveMatch(key.slice(2));
  else throw kino.error("not_found", "referencia desconocida");

  if (!stream) {
    throw kino.error("unavailable", "ninguna fuente respondió", {
      userMessage: t(
        "Ninguna fuente está respondiendo en este momento. Prueba otra vez en un rato.",
        "No source is responding right now. Try again in a while."
      ),
    });
  }

  resolveCache[key] = { at: Date.now(), stream: stream };
  return stream;
}

async function resolveChannel(slug) {
  const serverOrder = [1, 4];
  let attempts = 0;

  for (let i = 0; i < serverOrder.length && attempts < MAX_SERVERS; i++) {
    attempts++;
    try {
      const stream = await channelFromServer(slug, serverOrder[i]);
      if (stream) return stream;
    } catch (e) {
      log("channel source failed", slug, serverOrder[i], e && e.message);
    }
  }
  return null;
}

async function channelFromServer(slug, server) {
  const url =
    PLAYBACK_URL +
    "?type=channel&slug=" +
    encodeURIComponent(slug) +
    "&server=" +
    encodeURIComponent(String(server)) +
    "&automatic=1";

  const answer = await getJson(url);
  if (!answer || !answer.url) return null;
  return streamFromRelay(String(answer.url));
}

async function resolveMatch(payload) {
  const parts = String(payload || "").split("~");
  const slug = parts[0];
  const at = Number(parts[1]) || 0;
  let sources = parts[2]
    ? parts[2].split(".").filter(function (id) {
        return /^\d+$/.test(id);
      })
    : [];
  if (!slug) return null;

  const now = Date.now();
  if (at && now < at - 5 * 60 * 1000) {
    throw kino.error("not_found", "el partido aún no comienza", {
      userMessage: t(
        "Este partido empieza a las " + clockText(at) + ". Vuelve cuando esté al aire.",
        "This match starts at " + clockText(at) + ". Come back when it is on."
      ),
    });
  }

  if (!sources.length) {
    try {
      const page = await getText(MATCH_URL + encodeURIComponent(slug));
      sources = parseSourceIds(page);
    } catch (e) {
      log("match page failed", slug, e && e.message);
    }
  }

  let attempts = 0;
  for (let i = 0; i < sources.length && attempts < MAX_SOURCES; i++) {
    attempts++;
    try {
      const stream = await eventFromSource(slug, sources[i]);
      if (stream) return stream;
    } catch (e) {
      log("match source failed", sources[i], e && e.message);
    }
  }
  return null;
}

function parseSourceIds(html) {
  const out = [];
  const re = /data-source="(\d+)"/g;
  let m;
  while ((m = re.exec(String(html || "")))) {
    if (out.indexOf(m[1]) === -1) out.push(m[1]);
  }
  return out.slice(0, 8);
}

async function eventFromSource(slug, sourceId) {
  const url =
    PLAYBACK_URL +
    "?type=event&slug=" +
    encodeURIComponent(slug) +
    "&source=" +
    encodeURIComponent(sourceId) +
    "&automatic=1";

  const answer = await getJson(url);
  if (!answer || !answer.url) return null;
  return streamFromRelay(String(answer.url));
}

// --- relay pages ----------------------------------------------------------

// Every relay (tvf90, streamxhd, la18hd) wraps the same thing: a page that holds
// playbackURL, sometimes behind one iframe, sometimes split into base64 pieces.
async function streamFromRelay(url) {
  const playlist = await playlistAt(url);
  if (!playlist) return null;

  const streamUrl = normalise(playlist);
  if (!streamUrl || !(await alive(streamUrl))) return null;

  return { url: streamUrl, mime: "application/x-mpegURL" };
}

// A relay happily hands out a playlist for a channel that is off: read it before promising it.
async function alive(url) {
  try {
    const res = await kino.fetch(url, { headers: { "User-Agent": UA } });
    if (!res || !res.ok) return false;
    const head = (await res.text()).slice(0, 80);
    return head.indexOf("#EXTM3U") === 0;
  } catch (e) {
    log("probe failed", e && e.message);
    return false;
  }
}

async function playlistAt(url) {
  const page = await getText(url);
  let found = playbackFrom(page);
  if (found) return found;

  found = decodeStreamxhd(page);
  if (found) return found;

  found = findM3u8(page);
  if (found) return found;

  const src = (/<iframe[^>]+src=["']([^"']+)["']/i.exec(page) || [])[1];
  if (!src) return null;

  const inner = absoluteUrl(decodeEntities(src), url);
  if (!inner) return null;

  const page2 = await getText(inner);
  return playbackFrom(page2) || decodeStreamxhd(page2) || findM3u8(page2);
}

function normalise(url) {
  return String(url)
    .replace(/\\\//g, "/")
    .replace(/^https:\/\/([^\/:?#]+):443(\/|\?|$)/, "https://$1$2")
    .replace(/&amp;/g, "&")
    .trim();
}

function playbackFrom(html) {
  const m = /playbackURL\s*=\s*["']([^"']+)["']/.exec(html);
  return m && m[1] ? normalise(decodeEntities(m[1])) : null;
}

function findM3u8(html) {
  const m = /https?:\/\/[^"'\\\s<>]+\.m3u8[^"'\\\s<>]*/i.exec(String(html).replace(/\\\//g, "/"));
  return m ? normalise(m[0]) : null;
}

function absoluteUrl(url, base) {
  const value = String(url || "").trim();
  if (!value) return null;
  try {
    return new URL(value, base).href;
  } catch (e) {
    if (value.indexOf("//") === 0) return "https:" + value;
    if (/^https?:\/\//i.test(value)) return value;
    return null;
  }
}

// The streamxhd player ships its URL as base64 fragments: [[index, "b64"], ...],
// sorted by index, each decoded to a number minus a key and turned into one character.
function decodeStreamxhd(html) {
  try {
    const head = /var\s+playbackURL\s*=\s*""\s*,\s*([A-Za-z_$][\w$]*)\s*=\s*\[\]/.exec(html);
    if (!head) return null;
    const name = head[1].replace(/\$/g, "\\$");

    const assign = new RegExp(name + "\\s*=\\s*(\\[[\\s\\S]*?\\])\\s*;").exec(html);
    if (!assign) return null;

    const pairs = [];
    const pairRe = /\[(\d+)\s*,\s*"([^"]*)"\]/g;
    let m;
    while ((m = pairRe.exec(assign[1]))) pairs.push([Number(m[1]), m[2]]);
    if (!pairs.length) return null;

    const keyExp = /var\s+k\s*=\s*([A-Za-z_$][\w$]*)\s*\(\s*\)\s*\+\s*([A-Za-z_$][\w$]*)\s*\(\s*\)/.exec(html);
    if (!keyExp) return null;

    const first = functionValue(html, keyExp[1]);
    const second = functionValue(html, keyExp[2]);
    if (first === null || second === null) return null;
    const key = first + second;

    pairs.sort(function (a, b) {
      return a[0] - b[0];
    });

    let out = "";
    for (let i = 0; i < pairs.length; i++) {
      const digits = atob(pairs[i][1]).replace(/\D/g, "");
      if (!digits) return null;
      out += String.fromCharCode(parseInt(digits, 10) - key);
    }
    return normalise(out.indexOf("http") === 0 ? out : "");
  } catch (e) {
    return null;
  }
}

function functionValue(html, name) {
  const escaped = name.replace(/\$/g, "\\$");
  const re = new RegExp("function\\s+" + escaped + "\\s*\\(\\s*\\)\\s*\\{\\s*return\\s+(\\d+)\\s*;?\\s*\\}");
  const m = re.exec(html);
  return m ? Number(m[1]) : null;
}
