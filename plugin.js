// Kino plugin — Fútbol en vivo: partidos y canales deportivos dentro de "En vivo".
// Data: pelotalibre.biz (agenda, canales + relay API). Streams: tvf90.com, streamxhd.st, la18hd.su.
// Target: Kino QuickJS sandbox (no fetch/Buffer/require; kino.fetch only), apiVersion 15.

const SITE = "https://pelotalibre.biz";
const AGENDA_URL = SITE + "/agenda";
const CHANNELS_URL = SITE + "/channels";
const MATCH_URL = SITE + "/match/";
const PLAYBACK_URL = SITE + "/api/direct-playback.php";
const DEFAULT_LOGO = SITE + "/assets/channel-logos/default-channel.svg";

// Two sister sites carry the same channel names with the country in the open: one serves the
// Argentine feed, the other the Mexican one. ESPN 2 in Buenos Aires and ESPN 2 in Ciudad de
// México are different signals, so each is listed as its own channel, never swapped.
const AR_SITE = "https://futbollibreplay.org";
const MX_SITE = "https://librefutbol.pro";

const COUNTRY_FEEDS = [
  {
    source: "ar",
    site: AR_SITE,
    label: function () { return t("Argentina", "Argentina"); },
    // the Argentine site only carries the ESPN feeds; its Fox Sports pages are gone
    slugs: ["espn-1", "espn-2", "espn-3"],
  },
  {
    source: "mx",
    site: MX_SITE,
    label: function () { return t("México", "Mexico"); },
    slugs: ["espn-1", "espn-2", "espn-3", "fox-sports-1", "fox-sports-2", "fox-sports-3"],
  },
];

const FEED_NAMES = {
  "espn-1": "ESPN 1",
  "espn-2": "ESPN 2",
  "espn-3": "ESPN 3",
  "fox-sports-1": "Fox Sports 1",
  "fox-sports-2": "Fox Sports 2",
  "fox-sports-3": "Fox Sports 3",
};

const UA =
  "Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36";

const AGENDA_CACHE_MS = 60000;
const CHANNELS_CACHE_MS = 300000;
const STREAM_CACHE_MS = 120000;
const MATCH_PAGE = 300;
const CHANNEL_PAGE = 300;
const MAX_SOURCES = 3;
const MAX_SERVERS = 3;

// A football match runs up to two hours with half time and stoppage time.
const MATCH_WINDOW_MS = 165 * 60 * 1000;
// Listed as live this many minutes before kick-off (pre-match studio).
const EARLY_MS = 10 * 60 * 1000;
// The agenda carries today and tomorrow; anything beyond three days is not ours.
const AHEAD_MS = 72 * 60 * 60 * 1000;

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

// lowercase, no accents, no punctuation: the only shape names are compared in
function plain(value) {
  let text = clean(value).toLowerCase();
  try {
    text = text.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  } catch (e) {
    // a runtime without normalize still compares the ASCII part
  }
  return text.replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();
}

// --- which events this plugin shows --------------------------------------

// Anything that is not football: the agenda also carries padel, tennis, motor racing, US sports.
// Matched against `plain()` text, so no accents here.
const NOT_FOOTBALL =
  /\b(sports|padel|tenis|tennis|atp|wta|f1|formula|motogp|moto gp|nba|nfl|nhl|mlb|ufc|fiba|boxeo|boxing|rugby|cricket|golf|volei|beisbol|ciclismo|atletismo|knockout|lfa)\b/;

// Women's football is out on request: competitions, team lines and tags.
const WOMEN =
  /femen|women|\bwsl\b|\bnwsl\b|damer|feminin|frauen|femminile|shebelieves/;

function isFootball(competition, teams) {
  const text = plain(competition) + " " + plain(teams);
  if (NOT_FOOTBALL.test(text)) return false;
  if (WOMEN.test(text)) return false;
  return true;
}

// --- team names -----------------------------------------------------------

const CLUB_WORDS = {
  fc: 1, cf: 1, sc: 1, ac: 1, cd: 1, ca: 1, csd: 1, afc: 1, as: 1, us: 1, ss: 1, ssc: 1,
  cfc: 1, bk: 1, if: 1, ff: 1, sk: 1, fk: 1, kf: 1, club: 1, sa: 1, sad: 1, ec: 1, sd: 1,
  ad: 1, the: 1, de: 1, del: 1, do: 1, da: 1, dos: 1, das: 1, al: 1, y: 1, and: 1,
  // the agenda names a club after its city as often as it does not
  jeddah: 1, riyadh: 1, saudi: 1, dammam: 1,
};

// Short forms the source uses next to the full name, so one fixture reads as one.
const ALIAS = {
  utd: "united",
  atl: "atletico",
  dep: "deportivo",
  ath: "athletic",
  univ: "universidad",
  psg: "paris saint germain",
  om: "olympique marseille",
  ol: "olympique lyonnais",
};

function teamWords(name) {
  const out = [];
  const words = plain(name).split(" ");
  for (let i = 0; i < words.length; i++) {
    const word = words[i];
    if (!word) continue;
    const alias = ALIAS[word];
    if (alias) {
      const parts = alias.split(" ");
      for (let j = 0; j < parts.length; j++) out.push(parts[j]);
      continue;
    }
    if (word.length > 1 && !CLUB_WORDS[word]) out.push(word);
  }
  return out;
}

function sameSide(a, b) {
  const left = teamWords(a);
  const right = teamWords(b);
  if (!left.length || !right.length) return false;
  let common = 0;
  for (let i = 0; i < left.length; i++) if (right.indexOf(left[i]) !== -1) common++;
  if (!common) return false;
  const union = left.length + right.length - common;
  return common / union >= 0.5 || common === Math.min(left.length, right.length);
}

// Two agenda rows at the same minute describe one fixture when both sides read alike.
function sameFixture(a, b) {
  if (a.at !== b.at) return false;
  return (
    (sameSide(a.home, b.home) && sameSide(a.away, b.away)) ||
    (sameSide(a.home, b.away) && sameSide(a.away, b.home))
  );
}

function splitTeams(teams) {
  const text = clean(teams);
  const m = /\s+vs\.?\s+/i.exec(text);
  if (!m) return [text, ""];
  return [text.slice(0, m.index).trim(), text.slice(m.index + m[0].length).trim()];
}

// --- covers ---------------------------------------------------------------

// A match has no poster on the site (its social card is 16:9 text, which crops badly in a
// channel tile), so the cover is a square tile the image service draws: both teams over a
// colour that stays the same for a competition, match after match.
const TILE_COLORS = ["0A7A42", "14405A", "3E2A5A", "4A1F2E", "1F3A22", "6A3D0E", "2A2A2A", "5A2A18"];

function tileColor(competition) {
  const text = plain(competition);
  let sum = 0;
  for (let i = 0; i < text.length; i++) sum = (sum * 31 + text.charCodeAt(i)) % 100000;
  return TILE_COLORS[sum % TILE_COLORS.length];
}

function shortName(name) {
  const text = clean(name);
  if (text.length <= 24) return text;
  const cut = text.slice(0, 24);
  const space = cut.lastIndexOf(" ");
  return (space > 8 ? cut.slice(0, space) : cut).trim();
}

// The two crests in one image: the worker set in Ajustes does the drawing, because Kino's
// live channel takes a single picture. Without it, the home crest stands alone.
function crestWorker() {
  try {
    const value = String(kino.config.get("crestWorker") || "").trim();
    if (!/^https:\/\/[^\/\s]+/i.test(value)) return "";
    return value;
  } catch (e) {
    return "";
  }
}

function matchLogo(event) {
  if (event.crest && event.crestAway) {
    const worker = crestWorker();
    if (worker) {
      return (
        worker +
        (worker.indexOf("?") === -1 ? "?" : "&") +
        "a=" + encodeURIComponent(event.crest) +
        "&b=" + encodeURIComponent(event.crestAway)
      );
    }
  }
  if (event.crest) return event.crest;

  const home = shortName(event.home || event.teams);
  const away = shortName(event.away);
  const text = encodeURIComponent(home) + "%5Cnvs%5Cn" + (away ? encodeURIComponent(away) : "");
  return "https://placehold.co/300x300/" + tileColor(event.competition) + "/FFFFFF/png?font=roboto&text=" + text;
}

// --- fixtures: ESPN, not the stream site -----------------------------------

// The stream site's agenda carries whatever it can find: a youth cup with senior club names,
// the same match under three competition names, kick-off times that move. ESPN's public
// scoreboard is the reference for what is played, when, and who plays: it needs no key, and it
// also hands the club crests over. A match only shows if ESPN confirms it.
const ESPN = "https://site.api.espn.com/apis/site/v2/sports/soccer/";
const ESPN_CACHE_MS = 10 * 60 * 1000;

// Stream-site competition name -> the ESPN leagues that may hold it, and the name to show.
const ESPN_LEAGUES = [
  [/^ligue 1/i, ["fra.1"], "Ligue 1"],
  [/^ligue 2/i, ["fra.2"], "Ligue 2"],
  [/^laliga( smartbank)?/i, ["esp.2"], "LaLiga 2"],
  [/^laliga/i, ["esp.1"], "LaLiga"],
  [/^(2\. )?bundesliga 2|^2\. bundesliga/i, ["ger.2"], "2. Bundesliga"],
  [/^bundesliga/i, ["ger.1"], "Bundesliga"],
  [/^premier league/i, ["eng.1"], "Premier League"],
  [/^championship/i, ["eng.2"], "Championship"],
  [/^league one/i, ["eng.3"], "League One"],
  [/^league two/i, ["eng.4"], "League Two"],
  [/^(carabao cup|league cup)/i, ["eng.league_cup"], "Carabao Cup"],
  [/^serie a/i, ["ita.1"], "Serie A"],
  [/^serie b/i, ["ita.2"], "Serie B"],
  [/^primeira liga/i, ["por.1"], "Primeira Liga"],
  [/^s[uü]per lig/i, ["tur.1"], "Süper Lig"],
  [/^(saudi pro league|pro league|liga profesional saud[ií])/i, ["ksa.1"], "Saudi Pro League"],
  [/^brasileir[aã]o/i, ["bra.1"], "Brasileirão"],
  [/^liga profesional( argentina)?$/i, ["arg.1"], "Liga Profesional"],
  [/^liga betplay/i, ["col.1"], "Liga BetPlay"],
  [/^primera a/i, ["col.1"], "Primera A"],
  [/^liga mx$/i, ["mex.1"], "Liga MX"],
  [/^liga de expansi[oó]n mx/i, ["mex.2"], "Liga de Expansión MX"],
  [/^liga 1$/i, ["per.1"], "Liga 1"],
  [/^liga chile$/i, ["chi.1"], "Liga Chile"],
  [/^liga paraguay$/i, ["par.1"], "Liga Paraguay"],
  [/^primera divisi[oó]n$/i, ["chi.1", "bol.1", "crc.1"], "Primera División"],
  [/^eredivisie$/i, ["ned.1"], "Eredivisie"],
  [/^mls$/i, ["usa.1"], "MLS"],
  [/messi cup|u1[5-9]|u2[0-3]|\bsub\s?\d/i, null, ""],
];

const espnCache = Object.create(null);

function espnLeagues(competition) {
  const name = clean(competition).replace(/:\s*$/, "");
  for (let i = 0; i < ESPN_LEAGUES.length; i++) {
    const rule = ESPN_LEAGUES[i];
    if (!rule[0].test(name)) continue;
    if (!rule[1]) return null; // a competition this plugin does not show at all
    return { slugs: rule[1], title: rule[2] };
  }
  return null;
}

function utcDay(ms) {
  const d = new Date(ms);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return "" + y + m + day;
}

async function espnBoard(slug, date) {
  const key = slug + "@" + date;
  const hit = espnCache[key];
  if (hit && Date.now() - hit.at < ESPN_CACHE_MS) return hit.events;

  try {
    const res = await kino.fetch(ESPN + slug + "/scoreboard?dates=" + date, {
      headers: { "User-Agent": UA, Accept: "application/json" },
    });
    if (!res || !res.ok) return [];
    const body = await res.json();
    const events = (body && body.events) || [];
    espnCache[key] = { at: Date.now(), events: events };
    return events;
  } catch (e) {
    log("espn failed", slug, date, e && e.message);
    return [];
  }
}

function espnNames(event) {
  const competition = (event.competitions && event.competitions[0]) || {};
  const sides = competition.competitors || [];
  let home = "";
  let away = "";
  let homeLogo = "";
  let awayLogo = "";
  for (let i = 0; i < sides.length; i++) {
    const team = sides[i].team || {};
    if (sides[i].homeAway === "home") {
      home = team.displayName || team.name || "";
      homeLogo = team.logo || (team.logos && team.logos[0] && team.logos[0].href) || "";
    } else {
      away = team.displayName || team.name || "";
      awayLogo = team.logo || (team.logos && team.logos[0] && team.logos[0].href) || "";
    }
  }
  const at = new Date(event.date).getTime();
  return { id: String(event.id || ""), home: home, away: away, homeLogo: homeLogo, awayLogo: awayLogo, at: at };
}

// The ESPN fixture for a site event: same two clubs, kick-off close enough to be the same match.
function espnFixtureFor(siteEvent, boardEvents) {
  let best = null;
  let bestDelta = Infinity;
  for (let i = 0; i < boardEvents.length; i++) {
    const fixture = espnNames(boardEvents[i]);
    if (!fixture.home || !fixture.away || !fixture.at) continue;
    const delta = Math.abs(fixture.at - siteEvent.at);
    if (delta > 3 * 60 * 60 * 1000) continue;
    const straight = sameSide(siteEvent.home, fixture.home) && sameSide(siteEvent.away, fixture.away);
    const swapped = sameSide(siteEvent.home, fixture.away) && sameSide(siteEvent.away, fixture.home);
    if (!straight && !swapped) continue;
    if (delta < bestDelta) {
      bestDelta = delta;
      best = fixture;
    }
  }
  return best;
}

// Walk the agenda and keep only what ESPN confirms, with ESPN's clubs, time and crests.
async function confirmFixtures(events, now) {
  const groups = Object.create(null);
  for (let i = 0; i < events.length; i++) {
    const event = events[i];
    const league = espnLeagues(event.competition);
    if (league === null) continue; // not shown at all (youth cups)
    if (!league) continue; // a competition ESPN does not carry: leave the site's word
    const key = league.slugs[0] + "|" + league.title;
    if (!groups[key]) groups[key] = { slugs: league.slugs, title: league.title, events: [] };
    groups[key].events.push(event);
  }

  const confirmedFor = Object.create(null); // site event -> fixture
  const offline = Object.create(null); // leagues ESPN could not answer for

  // every board this refresh needs, fetched in small parallel batches: six at a time is
  // several times faster than one by one and still gentle with the feed
  const wanted = Object.create(null);
  for (const key in groups) {
    const group = groups[key];
    const dates = Object.create(null);
    for (let i = 0; i < group.events.length; i++) {
      const at = group.events[i].at;
      const hour = new Date(at).getUTCHours();
      dates[utcDay(at)] = true;
      // ESPN files a game under its local date, which can be the day before or after in UTC
      if (hour < 6) dates[utcDay(at - 86400000)] = true;
      else if (hour >= 18) dates[utcDay(at + 86400000)] = true;
    }
    group.dates = Object.keys(dates);
    for (let s = 0; s < group.slugs.length; s++) {
      for (let d = 0; d < group.dates.length; d++) wanted[group.slugs[s] + "@" + group.dates[d]] = true;
    }
  }
  const jobs = Object.keys(wanted).map(function (pair) {
    const at = pair.lastIndexOf("@");
    return [pair.slice(0, at), pair.slice(at + 1)];
  });
  for (let i = 0; i < jobs.length; i += 6) {
    const batch = jobs.slice(i, i + 6).map(function (job) {
      return espnBoard(job[0], job[1]);
    });
    await Promise.all(batch);
  }

  for (const key in groups) {
    const group = groups[key];
    const list = group.dates;
    let left = group.events.length;
    let answered = false;
    for (let s = 0; s < group.slugs.length && left > 0; s++) {
      const boards = [];
      for (let d = 0; d < list.length; d++) {
        const board = await espnBoard(group.slugs[s], list[d]);
        if (board.length) answered = true;
        for (let b = 0; b < board.length; b++) boards.push(board[b]);
      }
      if (!boards.length) continue;
      for (let i = 0; i < group.events.length; i++) {
        const event = group.events[i];
        const key = "e" + event.at + event.teams;
        if (confirmedFor[key]) continue;
        const fixture = espnFixtureFor(event, boards);
        if (!fixture) continue;
        confirmedFor[key] = { event: event, fixture: fixture, title: group.title };
        left--;
      }
    }
    // ESPN unreachable for this league: keep the site's cards rather than empty the row
    if (!answered) offline[group.title] = true;
  }

  const out = [];
  for (let i = 0; i < events.length; i++) {
    const event = events[i];
    const league = espnLeagues(event.competition);
    if (league === null) continue; // youth and reserve cups
    const confirmed = confirmedFor["e" + event.at + event.teams];
    if (!confirmed) {
      if (league && !offline[league.title]) continue; // ESPN has this league and not this match
      out.push(event); // ESPN has no word on it: the site's card stands
      continue;
    }
    out.push({
      slug: event.slug,
      competition: confirmed.title,
      teams: confirmed.fixture.home + " vs " + confirmed.fixture.away,
      home: confirmed.fixture.home,
      away: confirmed.fixture.away,
      at: confirmed.fixture.at,
      sources: event.sources,
      crest: confirmed.fixture.homeLogo,
      crestAway: confirmed.fixture.awayLogo,
      espnId: confirmed.fixture.id,
    });
  }
  void now;
  return out;
}
// --- agenda parsing -------------------------------------------------------

function parseAgenda(html, now) {
  const events = [];
  const chunks = String(html || "").split("data-agenda-event");

  for (let i = 1; i < chunks.length; i++) {
    const chunk = chunks[i];
    const slug = (/href="\/match\/([^"#?]+)#source=\d+"/.exec(chunk) || [])[1];
    if (!slug) continue;

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

    if (!isFootball(competition, teams)) continue;

    const start = (/data-source-instant="([^"]+)"/.exec(chunk) || [])[1] || "";
    const at = start ? new Date(start).getTime() : 0;
    if (!at || isNaN(at)) continue;

    // Finished a while ago, or so far out it is not today's problem.
    if (at + MATCH_WINDOW_MS < now) continue;
    if (at > now + AHEAD_MS) continue;

    const sides = splitTeams(teams);
    events.push(makeEvent(slug, competition, teams, sides, at, sources));
  }

  events.sort(function (a, b) {
    if (a.at !== b.at) return a.at - b.at;
    return a.teams < b.teams ? -1 : a.teams > b.teams ? 1 : 0;
  });
  return events;
}

// The agenda repeats a fixture under two competition names (Pro League / Saudi Pro League,
// Liga Chile / Primera División, "Sheffield Utd" / "Sheffield United"): one card survives,
// the copy with more sources, or the one whose competition name is the fuller.
function dedupeEvents(events) {
  const byId = Object.create(null);
  const unique = [];
  for (let i = 0; i < events.length; i++) {
    const id = events[i].espnId;
    if (id) {
      if (byId[id]) continue;
      byId[id] = true;
    }
    unique.push(events[i]);
  }
  events = unique;

  const kept = [];
  for (let i = 0; i < events.length; i++) {
    const event = events[i];
    let merged = false;
    for (let k = 0; k < kept.length; k++) {
      if (!sameFixture(kept[k], event)) continue;
      if (event.sources.length > kept[k].sources.length) kept[k] = event;
      else if (event.competition.length > kept[k].competition.length) kept[k].competition = event.competition;
      merged = true;
      break;
    }
    if (!merged) kept.push(event);
  }
  return kept;
}

function makeEvent(slug, competition, teams, sides, at, sources) {
  return {
    slug: slug,
    competition: competition,
    teams: teams,
    home: sides[0],
    away: sides[1],
    at: at,
    sources: sources.slice(0, 6),
  };
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
  const parsed = parseAgenda(await agendaHtml(), Date.now());
  const confirmed = await confirmFixtures(parsed, Date.now());
  return dedupeEvents(confirmed);
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

// --- En vivo --------------------------------------------------------------

// This plugin lives in En vivo only: no catalogue rows.
export async function home() {
  return [];
}

export async function liveCategories() {
  return [
    { id: "vivo", title: t("Partidos en vivo", "Live matches"), genre: "deportes" },
    { id: "canales", title: t("Canales deportivos", "Sports channels"), genre: "deportes" },
    { id: "proximos", title: t("Próximos partidos", "Upcoming matches"), genre: "deportes" },
  ];
}

function isLive(event, now) {
  return now >= event.at - EARLY_MS && now < event.at + MATCH_WINDOW_MS;
}

const DAYS_ES = ["dom", "lun", "mar", "mié", "jue", "vie", "sáb"];
const DAYS_EN = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];

function midnight(ms) {
  const d = new Date(ms);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

// A match after midnight is tomorrow, not "later today": say so in front of the hour.
function dayLabel(ms, now) {
  const days = Math.round((midnight(ms) - midnight(now)) / 86400000);
  if (!days) return "";
  if (days === 1) return t("mañana", "tomorrow");
  const names = isEnglish() ? DAYS_EN : DAYS_ES;
  return names[new Date(ms).getDay()] || "";
}

function matchChannel(event, categoryId, now) {
  const upcoming = event.at > now + EARLY_MS;
  let prefix = "";
  if (upcoming) {
    const day = dayLabel(event.at, now);
    prefix = (day ? day + " " : "") + clockText(event.at) + " · ";
  }
  return {
    id: "m-" + event.slug,
    title: prefix + event.teams.slice(0, 300),
    categoryId: categoryId,
    ref: "m~" + event.slug + "~" + event.at + "~" + event.sources.join("."),
    logo: matchLogo(event),
  };
}

// One list of stations: the site's own directory, with the six channels that exist in both
// an Argentine and a Mexican feed replaced by those two, each named with its country.
async function stationList() {
  const base = await channelList();
  const bySlug = Object.create(null);
  for (let i = 0; i < base.length; i++) bySlug[base[i].slug] = base[i];

  const split = Object.create(null);
  for (let f = 0; f < COUNTRY_FEEDS.length; f++) {
    const slugs = COUNTRY_FEEDS[f].slugs;
    for (let s = 0; s < slugs.length; s++) split[slugs[s]] = true;
  }

  const out = [];
  for (let i = 0; i < base.length; i++) {
    const entry = base[i];
    if (split[entry.slug]) continue;
    out.push({ id: "c-" + entry.slug, title: entry.name, ref: "c~" + entry.slug, logo: entry.logo || DEFAULT_LOGO });
  }

  for (let f = 0; f < COUNTRY_FEEDS.length; f++) {
    const feed = COUNTRY_FEEDS[f];
    for (let s = 0; s < feed.slugs.length; s++) {
      const slug = feed.slugs[s];
      const entry = bySlug[slug];
      const name = FEED_NAMES[slug] || (entry && entry.name) || slug;
      out.push({
        id: "f-" + feed.source + "-" + slug,
        title: name + " (" + feed.label() + ")",
        ref: "f~" + feed.source + "~" + slug,
        logo: (entry && entry.logo) || DEFAULT_LOGO,
      });
    }
  }

  // the same name twice is the same channel twice: keep the first
  const seen = Object.create(null);
  const unique = [];
  for (let i = 0; i < out.length; i++) {
    const key = plain(out[i].title);
    if (seen[key]) continue;
    seen[key] = true;
    unique.push(out[i]);
  }
  return unique;
}

function sportsChannel(station, index, categoryId) {
  return {
    id: station.id,
    title: String(station.title || station.id).slice(0, 300),
    categoryId: categoryId,
    ref: station.ref,
    logo: station.logo || DEFAULT_LOGO,
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
    const list = await stationList();
    const all = list.map(function (station, index) {
      return sportsChannel(station, index, categoryId);
    });
    return pageOf(all, cursor, CHANNEL_PAGE);
  }

  const events = await agendaEvents();
  const now = Date.now();
  let selected;

  if (categoryId === "vivo") {
    selected = events.filter(function (event) {
      return isLive(event, now);
    });
  } else if (categoryId === "proximos") {
    selected = events.filter(function (event) {
      return event.at > now + EARLY_MS;
    });
  } else {
    return { items: [] };
  }

  const all = selected.map(function (event) {
    return matchChannel(event, categoryId, now);
  });
  return pageOf(all, cursor, MATCH_PAGE);
}

export async function liveSearch(arg) {
  await null;
  const query = plain((arg && arg.query) || "");
  if (query.length < 2) return { items: [] };

  const words = query.split(" ").filter(function (word) {
    return word.length > 0;
  });
  const now = Date.now();
  const hits = [];

  try {
    const events = await agendaEvents();
    for (let i = 0; i < events.length && hits.length < 60; i++) {
      const event = events[i];
      const hay = plain(event.teams + " " + event.competition);
      if (!words.every(function (word) { return hay.indexOf(word) !== -1; })) continue;
      const live = isLive(event, now);
      const item = matchChannel(event, live ? "vivo" : "proximos", now);
      item.adult = false;
      hits.push(item);
    }
  } catch (e) {
    log("live search agenda failed", e && e.message);
  }

  try {
    const stations = await stationList();
    for (let i = 0; i < stations.length && hits.length < 100; i++) {
      const station = stations[i];
      if (plain(station.title).indexOf(query) === -1) continue;
      const item = sportsChannel(station, i, "canales");
      item.adult = false;
      hits.push(item);
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
      title: event.teams.slice(0, 300),
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
  else if (key.indexOf("f~") === 0) stream = await resolveFeed(key.slice(2));
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

// A channel on the site declares one to three servers on its own page (Fuente 1, 2, 3). Those
// are mirrors of the same feed, so walking them in order is safe: the same channel stays the
// same channel, only the road changes.
async function resolveChannel(slug) {
  const servers = await channelServers(slug);
  let dead = 0;

  for (let i = 0; i < servers.length && i < MAX_SERVERS; i++) {
    try {
      const answer = await channelFromServer(slug, servers[i]);
      if (!answer) continue;
      if (answer.health === "failed") {
        dead++;
        continue;
      }
      if (!answer.url) continue;
      const stream = await streamFromRelay(answer.url);
      if (stream) return stream;
    } catch (e) {
      log("channel source failed", slug, servers[i], e && e.message);
    }
  }
  log("channel exhausted", slug, "dead sources:", dead);
  return null;
}

async function channelServers(slug) {
  const fallback = [4, 1, 3];
  try {
    const page = await getText(SITE + "/channel/" + encodeURIComponent(slug));
    const found = [];
    const re = /data-server="(\d+)"[^>]*data-source="\d+"/g;
    let m;
    while ((m = re.exec(page))) {
      const server = Number(m[1]);
      if (server && found.indexOf(server) === -1) found.push(server);
    }
    if (found.length) return found;
  } catch (e) {
    log("channel page failed", slug, e && e.message);
  }
  return fallback;
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
  if (!answer) return null;
  return { url: answer.url ? String(answer.url) : "", health: String(answer.health || "") };
}

// The country feeds live on their own site: one page per channel, wrapping the relay the same
// way every other page here does. Each entry is pinned to its country, so nothing is swapped.
async function resolveFeed(payload) {
  const parts = String(payload || "").split("~");
  const source = parts[0];
  const slug = parts[1];
  if (!slug) return null;

  let site = "";
  for (let i = 0; i < COUNTRY_FEEDS.length; i++) {
    if (COUNTRY_FEEDS[i].source === source) site = COUNTRY_FEEDS[i].site;
  }
  if (!site) return null;

  try {
    const pageUrl = site + "/en-vivo/" + encodeURIComponent(slug);
    const page = await getText(pageUrl);
    const playlist = await playlistFromHtml(page, pageUrl, 0);
    if (!playlist) return null;

    const streamUrl = normalise(playlist);
    if (!streamUrl || !(await alive(streamUrl))) return null;
    return { url: streamUrl, mime: "application/x-mpegURL" };
  } catch (e) {
    log("feed failed", source, slug, e && e.message);
    return null;
  }
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
  if (at && now < at - EARLY_MS) {
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

// A relay happily hands out a playlist for a channel that is off: read it, walk to a variant
// and touch the first segment before promising it. A manifest that answers is not a stream.
const PROBE_BYTES = 65536;

async function alive(url) {
  try {
    const manifest = await fetchCap(url);
    if (!manifest) return false;

    let text = manifest.text;
    let base = url;
    if (text.indexOf("#EXTM3U") !== 0) return false;

    // a master playlist names its variants: one of them is the video
    if (text.indexOf("#EXT-X-STREAM-INF") !== -1) {
      const variant = firstUri(text, base, true);
      if (!variant) return false;
      const child = await fetchCap(variant);
      if (!child) return false;
      text = child.text;
      base = variant;
      if (text.indexOf("#EXTM3U") !== 0) return false;
    }

    // a finished stream is a dead channel
    if (text.indexOf("#EXT-X-ENDLIST") !== -1) return false;

    const segment = firstUri(text, base, false);
    if (!segment) return false;

    const head = await fetchCap(segment);
    return !!head;
  } catch (e) {
    log("probe failed", e && e.message);
    return false;
  }
}

async function fetchCap(url) {
  try {
    const res = await kino.fetch(url, { headers: { "User-Agent": UA }, maxBytes: PROBE_BYTES });
    if (!res || !res.ok) return null;
    return { text: await res.text(), status: res.status };
  } catch (e) {
    return null;
  }
}

// The first URI of a playlist: after #EXT-X-STREAM-INF for a master, after #EXTINF for a media.
function firstUri(text, base, variant) {
  const lines = String(text).split(/\r?\n/);
  const tag = variant ? "#EXT-X-STREAM-INF" : "#EXTINF";
  let seen = false;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    if (line.charAt(0) === "#") {
      if (line.indexOf(tag) === 0) seen = true;
      continue;
    }
    if (!seen) continue;
    return absoluteUrl(line, base);
  }
  return null;
}
async function playlistAt(url) {
  const page = await getText(url);
  return await playlistFromHtml(page, url, 0);
}

// Every relay wraps the same thing: a page that holds playbackURL, sometimes behind an iframe,
// sometimes two of them (tvf90: canal.php -> 5.php -> playbackURL).
async function playlistFromHtml(page, base, depth) {
  const found = playbackFrom(page) || decodeStreamxhd(page) || findM3u8(page);
  if (found) return found;
  if (depth >= 3) return null;

  const src = (/<iframe[^>]+src=["']([^"']+)["']/i.exec(page) || [])[1];
  if (!src) return null;

  const inner = absoluteUrl(decodeEntities(src), base);
  if (!inner) return null;

  let next;
  try {
    next = await getText(inner);
  } catch (e) {
    log("iframe failed", depth, e && e.message);
    return null;
  }
  return await playlistFromHtml(next, inner, depth + 1);
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
