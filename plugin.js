// Kino plugin — Fútbol Internacional
// Data: pelotalibre.biz (agenda + relay API). Stream relays: tvf90.com, streamxhd.st.
// Target: Kino QuickJS sandbox (no fetch/Buffer/require; kino.fetch only).

const SITE = "https://pelotalibre.biz";
const AGENDA_URL = SITE + "/agenda";
const MATCH_URL = SITE + "/match/";
const PLAYBACK_URL = SITE + "/api/direct-playback.php";
const TVF90 = "https://tvf90.com";

const UA =
  "Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36";

const CACHE_MS = 60000;
const RESOLVE_CACHE_MS = 300000;
const ROW_ITEMS = 30;
const PAGE_ITEMS = 40;
const MAX_SOURCES = 4;
const LIVE_WINDOW_MS = 3 * 60 * 60 * 1000;

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
    // a log line is not worth failing a row over
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

const DAYS_ES = ["dom", "lun", "mar", "mié", "jue", "vie", "sáb"];
const DAYS_EN = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function whenText(iso) {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "";
  const days = isEnglish() ? DAYS_EN : DAYS_ES;
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  return days[d.getDay()] + " " + hh + ":" + mm;
}

// --- which competitions this plugin shows --------------------------------

const GROUPS = [
  { key: "champions", es: "Champions League", en: "Champions League", re: /champions league/i },
  { key: "europa", es: "Europa League", en: "Europa League", re: /europa league/i },
  { key: "laliga", es: "La Liga", en: "La Liga", re: /^(laliga|la liga)$/i },
  { key: "premier", es: "Premier League", en: "Premier League", re: /^premier league$/i },
  { key: "seriea", es: "Serie A", en: "Serie A", re: /^serie a$/i },
  { key: "bundesliga", es: "Bundesliga", en: "Bundesliga", re: /bundesliga/i },
  { key: "ligue1", es: "Ligue 1", en: "Ligue 1", re: /^ligue 1$/i },
  {
    key: "sudamerica",
    es: "Sudamérica",
    en: "South America",
    re: /libertadores|sudamericana|brasileir|liga profesional|^liga 1$|liga chile|liga paraguay|^primera a$|^primera divisi|liga mx|liga betplay|liga nacional|copa ecuador|expansi[oó]n mx/i,
  },
];

const OTHER = { key: "otros", es: "Más fútbol", en: "More football" };

// Anything that is not football (the agenda also carries padel, tennis, motor racing...).
const NOT_FOOTBALL =
  /^(sports|f1|nba|nfl|nhl|mlb|espn knockout|ufc|boxeo|boxing|tenis|atp|wta|p[aá]del|motogp|moto gp|f[oó]rmula|cricket|rugby|golf|ciclismo|atletismo|v[oó]lei|b[eé]isbol|b[eé]isbol)/i;

function groupOf(competition) {
  const name = String(competition || "");
  for (let i = 0; i < GROUPS.length; i++) {
    if (GROUPS[i].re.test(name)) return GROUPS[i].key;
  }
  if (NOT_FOOTBALL.test(name)) return null;
  return OTHER.key;
}

function isFootball(competition) {
  return groupOf(competition) !== null;
}

// --- agenda parsing -------------------------------------------------------

function parseAgenda(html) {
  const events = [];
  const seen = Object.create(null);
  const chunks = String(html || "").split("data-agenda-event");

  for (let i = 1; i < chunks.length; i++) {
    const chunk = chunks[i];
    const slug = (/href="\/match\/([^"#?]+)#source=\d+"/.exec(chunk) || [])[1];
    if (!slug || seen[slug]) continue;

    const sources = [];
    const srcRe = /href="\/match\/([^"#?]+)#source=(\d+)"[^>]*><span>([^<]*)<\/span>(?:<small>([^<]*)<\/small>)?/g;
    let m;
    while ((m = srcRe.exec(chunk))) {
      if (m[1] !== slug) continue;
      sources.push({ id: m[2], channel: clean(m[4] || m[3] || "") });
    }
    if (!sources.length) continue;

    seen[slug] = true;
    const competition = clean((/source-agenda-competition">([^<]*)</.exec(chunk) || [])[1]).replace(/:\s*$/, "");
    let teams = clean((/<strong><span class="source-agenda-competition">[^<]*<\/span>\s*([^<]+)<\/strong>/.exec(chunk) || [])[1]);
    if (!teams) continue;

    // The source sometimes repeats the competition inside the match line.
    if (competition) {
      const prefix = competition.toLowerCase() + ":";
      if (teams.toLowerCase().indexOf(prefix) === 0) teams = teams.slice(prefix.length).trim();
    }
    if (!isFootball(competition)) continue;
    const group = groupOf(competition);

    const start = (/data-source-instant="([^"]+)"/.exec(chunk) || [])[1] || "";
    const at = start ? new Date(start).getTime() : 0;

    // A match that ended hours ago is not a channel any more.
    if (!isNaN(at) && at && at + LIVE_WINDOW_MS < Date.now()) continue;

    events.push({
      slug: slug,
      competition: competition,
      group: group,
      teams: teams,
      title: competition ? competition + ": " + teams : teams,
      start: start,
      at: isNaN(at) ? 0 : at,
      sources: sources,
    });
  }

  events.sort(function (a, b) {
    if (a.at !== b.at) return a.at - b.at;
    return a.title < b.title ? -1 : a.title > b.title ? 1 : 0;
  });
  return events;
}

function isLive(event, now) {
  if (!event.at) return false;
  return now >= event.at && now < event.at + LIVE_WINDOW_MS;
}

function toItem(event, now) {
  const live = isLive(event, now);
  const when = whenText(event.start);
  const count = event.sources.length;
  const badges = [];
  if (live) badges.push("EN VIVO");
  else if (when) badges.push(when.slice(0, 20));

  const parts = [];
  if (when) parts.push(when);
  parts.push(count === 1 ? t("1 fuente", "1 source") : count + t(" fuentes", " sources"));
  if (event.sources[0] && event.sources[0].channel) parts.push(event.sources[0].channel);

  return {
    id: event.slug,
    ref: event.slug,
    title: event.title.slice(0, 200),
    kind: "live",
    overview: parts.join(" · ").slice(0, 400),
    genres: ["deportes"],
    badges: badges,
  };
}

// --- the agenda, fetched once per minute ----------------------------------

let agendaCache = { at: 0, html: "" };

async function agendaHtml() {
  const now = Date.now();
  if (agendaCache.html && now - agendaCache.at < CACHE_MS) return agendaCache.html;
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

// --- the five capabilities ------------------------------------------------

export async function home() {
  let events;
  try {
    events = parseAgenda(await agendaHtml());
  } catch (e) {
    return [];
  }
  if (!events.length) return [];

  const now = Date.now();
  const rows = [];

  const live = events.filter(function (e) {
    return isLive(e, now);
  });
  if (live.length) {
    rows.push({
      id: "now",
      title: t("En vivo ahora", "Live now"),
      genre: "deportes",
      ref: "now",
      items: live.slice(0, 20).map(function (e) {
        return toItem(e, now);
      }),
    });
  }

  rows.push({
    id: "all",
    title: t("Todo el fútbol", "All football"),
    genre: "deportes",
    ref: "all",
    items: events.slice(0, ROW_ITEMS).map(function (e) {
      return toItem(e, now);
    }),
  });

  for (let i = 0; i < GROUPS.length; i++) {
    const group = GROUPS[i];
    const items = events
      .filter(function (e) {
        return e.group === group.key;
      })
      .slice(0, ROW_ITEMS)
      .map(function (e) {
        return toItem(e, now);
      });
    if (!items.length) continue;
    rows.push({
      id: "g-" + group.key,
      title: t(group.es, group.en),
      genre: "deportes",
      ref: "g-" + group.key,
      items: items,
    });
  }

  const more = events
    .filter(function (e) {
      return e.group === OTHER.key;
    })
    .slice(0, ROW_ITEMS)
    .map(function (e) {
      return toItem(e, now);
    });
  if (more.length) {
    rows.push({
      id: "g-otros",
      title: t(OTHER.es, OTHER.en),
      genre: "deportes",
      ref: "g-otros",
      items: more,
    });
  }

  return rows.slice(0, 20);
}

export async function search(query) {
  let events;
  try {
    events = parseAgenda(await agendaHtml());
  } catch (e) {
    return { items: [] };
  }

  const q = clean((query && query.q) || "").toLowerCase();
  if (!q) return { items: [] };

  const words = q.split(/\s+/).filter(function (w) {
    return w.length > 1;
  });
  const needles = words.length ? words : [q];

  const now = Date.now();
  const items = events
    .filter(function (e) {
      const hay = (e.title + " " + e.competition).toLowerCase();
      return needles.every(function (w) {
        return hay.indexOf(w) !== -1;
      });
    })
    .slice(0, 100)
    .map(function (e) {
      return toItem(e, now);
    });

  return { items: items };
}

export async function browse(ref, cursor) {
  let events;
  try {
    events = parseAgenda(await agendaHtml());
  } catch (e) {
    throw kino.error("unavailable", "no se pudo leer la agenda");
  }

  const now = Date.now();
  let list = null;
  const key = String(ref || "");

  if (key === "all") {
    list = events;
  } else if (key === "now") {
    list = events.filter(function (e) {
      return isLive(e, now);
    });
  } else if (key.indexOf("g-") === 0) {
    const wanted = key.slice(2);
    list = events.filter(function (e) {
      return e.group === wanted;
    });
  }

  if (!list) throw kino.error("not_found", "esa fila ya no existe");

  const page = cursor ? Number(cursor) : 1;
  if (!isFinite(page) || page < 1 || page > 100) {
    throw kino.error("not_found", "página inválida");
  }

  const from = (page - 1) * PAGE_ITEMS;
  const slice = list.slice(from, from + PAGE_ITEMS);
  return {
    items: slice.map(function (e) {
      return toItem(e, now);
    }),
    next: from + PAGE_ITEMS < list.length ? String(page + 1) : undefined,
  };
}

export async function resolve(ref) {
  await null; // the checks below may throw: never before the first await
  const slug = String(ref || "").trim();
  if (!slug) throw kino.error("not_found", "partido vacío");

  const cached = resolveCache[slug];
  if (cached && Date.now() - cached.at < RESOLVE_CACHE_MS) return cached.stream;

  const page = await getText(MATCH_URL + encodeURIComponent(slug));
  const sources = parseSources(page);
  if (!sources.length) throw kino.error("not_found", "este partido no tiene fuentes");

  const ordered = sources
    .filter(function (s) {
      return s.provider === "server-1";
    })
    .concat(
      sources.filter(function (s) {
        return s.provider === "server-2";
      })
    )
    .concat(
      sources.filter(function (s) {
        return s.provider !== "server-1" && s.provider !== "server-2";
      })
    );

  let attempts = 0;
  for (let i = 0; i < ordered.length && attempts < MAX_SOURCES; i++) {
    attempts++;
    const source = ordered[i];
    try {
      const stream = await resolveSource(slug, source.id);
      if (stream) {
        resolveCache[slug] = { at: Date.now(), stream: stream };
        return stream;
      }
    } catch (e) {
      log("source failed", source.id, e && e.message);
    }
  }

  throw kino.error("unavailable", "ninguna fuente respondió", {
    userMessage: t(
      "Ninguna fuente de este partido está respondiendo. Prueba otro partido o vuelve más tarde.",
      "No source for this match is responding. Try another match or come back later."
    ),
  });
}

// --- source resolution ----------------------------------------------------

const resolveCache = Object.create(null);

function parseSources(html) {
  const out = [];
  const seen = Object.create(null);
  const re = /data-source="(\d+)"([^>]*)>/g;
  let m;
  while ((m = re.exec(html))) {
    const id = m[1];
    if (seen[id]) continue;
    seen[id] = true;
    const attrs = m[2] || "";
    const provider = (/data-provider="([^"]*)"/.exec(attrs) || [])[1] || "";
    const title = clean((/title="([^"]*)"/.exec(attrs) || [])[1]).replace(/^Fuente \d+\s*·\s*/, "");
    out.push({ id: id, provider: provider, label: title });
  }
  return out;
}

async function resolveSource(slug, sourceId) {
  const url =
    PLAYBACK_URL +
    "?type=event&slug=" +
    encodeURIComponent(slug) +
    "&source=" +
    encodeURIComponent(sourceId) +
    "&automatic=1";

  const answer = await getJson(url);
  if (!answer || !answer.url) return null;

  const relay = String(answer.url);
  let host = "";
  try {
    host = new URL(relay).host.toLowerCase();
  } catch (e) {
    return null;
  }

  let playable = null;
  if (host === "tvf90.com" || /\.tvf90\.com$/.test(host)) playable = await fromTvf90(relay);
  else if (host === "streamxhd.st" || /\.streamxhd\.st$/.test(host)) playable = await fromStreamxhd(relay);
  if (!playable) return null;

  const streamUrl = normalise(playable);
  if (!(await alive(streamUrl))) return null;
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

function normalise(url) {
  return String(url)
    .replace(/^https:\/\/([^\/:?#]+):443(\/|\?|$)/, "https://$1$2")
    .replace(/&amp;/g, "&")
    .trim();
}

function playbackFrom(html) {
  const m = /playbackURL\s*=\s*["']([^"']+)["']/.exec(html);
  return m && m[1] ? normalise(decodeEntities(m[1])) : null;
}

function absolute(url, base) {
  const value = String(url || "").trim();
  if (!value) return null;
  if (value.indexOf("//") === 0) return "https:" + value;
  if (/^https?:\/\//i.test(value)) return value;
  if (value.charAt(0) === "/") return base + value;
  return base + "/" + value;
}

async function fromTvf90(wrapperUrl) {
  const wrapper = await getText(wrapperUrl);
  const direct = playbackFrom(wrapper);
  if (direct) return direct;

  const src = (/<iframe[^>]+src="([^"]+)"/.exec(wrapper) || [])[1];
  if (!src) return null;

  const inner = absolute(decodeEntities(src), TVF90);
  if (!inner) return null;

  const page = await getText(inner);
  return playbackFrom(page);
}

// The streamxhd player ships its URL as base64 fragments: [[index, "b64"], ...],
// sorted by index, each decoded to a number minus a key and turned into one character.
function decodeStreamxhd(html) {
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
    let digits;
    try {
      digits = atob(pairs[i][1]).replace(/\D/g, "");
    } catch (e) {
      return null;
    }
    if (!digits) return null;
    out += String.fromCharCode(parseInt(digits, 10) - key);
  }
  return out.indexOf("http") === 0 ? out : null;
}

function functionValue(html, name) {
  const escaped = name.replace(/\$/g, "\\$");
  const re = new RegExp("function\\s+" + escaped + "\\s*\\(\\s*\\)\\s*\\{\\s*return\\s+(\\d+)\\s*;?\\s*\\}");
  const m = re.exec(html);
  return m ? Number(m[1]) : null;
}

async function fromStreamxhd(pageUrl) {
  const page = await getText(pageUrl);
  return decodeStreamxhd(page);
}
