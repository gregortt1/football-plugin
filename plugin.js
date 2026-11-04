// Kino plugin — Fútbol en vivo: partidos y canales deportivos dentro de "En vivo".
// Data: pelotalibre.biz (agenda, canales + relay API). Streams: tvf90.com, streamxhd.st, la18hd.su.
// Target: Kino QuickJS sandbox (no fetch/Buffer/require; kino.fetch only), apiVersion 15.

const SITE = "https://pelotalibre.biz";
// The same platform answers on two domains: when one stops answering, the other keeps the
// agenda, the match pages and the playback API working.
const SITES = [SITE, "https://futbol-libre.app"];
const SITE_FAIL_MS = 5 * 60 * 1000;
const siteFailedAt = Object.create(null);
let siteIndex = 0;

const AGENDA_PATH = "/agenda";
const CHANNELS_PATH = "/channels";
const MATCH_PATH = "/match/";
const PLAYBACK_PATH = "/api/direct-playback.php";
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
const MAX_SOURCES = 4;
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
  // Inglaterra y sus copas
  [/^premier league/i, ["eng.1"], "Premier League"],
  [/^championship/i, null, ""],                 // segunda división: no se muestra
  [/^league one/i, null, ""],
  [/^league two/i, null, ""],
  [/^(carabao cup|league cup|efl cup)/i, ["eng.league_cup"], "Carabao Cup"],
  [/^fa cup/i, ["eng.fa"], "FA Cup"],
  [/^efl trophy/i, null, ""],
  // España
  [/^laliga (smartbank|2)|^segunda divisi[oó]n/i, null, ""],
  [/^laliga/i, ["esp.1"], "LaLiga"],
  [/^copa del rey/i, ["esp.copa_del_rey"], "Copa del Rey"],
  // Italia
  [/^serie a/i, ["ita.1"], "Serie A"],
  [/^serie b/i, null, ""],
  [/^coppa italia/i, ["ita.coppa_italia"], "Coppa Italia"],
  // Alemania
  [/^(2\. )?bundesliga 2|^2\. bundesliga/i, null, ""],
  [/^bundesliga/i, ["ger.1"], "Bundesliga"],
  [/^dfb[- ]?pokal/i, ["ger.dfb_pokal"], "DFB Pokal"],
  // Francia
  [/^ligue 1/i, ["fra.1"], "Ligue 1"],
  [/^ligue 2/i, null, ""],
  [/^coupe de france/i, ["fra.coupe_de_france"], "Coupe de France"],
  [/^troph[eé]e des champions/i, ["fra.super_cup"], "Trophée des Champions"],
  // Europa
  [/^(uefa )?champions league|^liga de campeones/i, ["uefa.champions"], "Champions League"],
  [/^(uefa )?europa league|^liga europa/i, ["uefa.europa"], "Europa League"],
  [/conference league|uefa conference/i, ["uefa.europa.conf"], "Conference League"],
  // Sudamérica
  [/libertadores/i, ["conmebol.libertadores"], "Copa Libertadores"],
  [/sudamericana/i, ["conmebol.sudamericana"], "Copa Sudamericana"],
  [/recopa/i, ["conmebol.recopa"], "Recopa Sudamericana"],
  // Argentina, Brasil, México
  [/^liga profesional( argentina)?$/i, ["arg.1"], "Liga Profesional"],
  [/^brasileir[aã]o/i, ["bra.1"], "Brasileirão"],
  [/^s[eé]rie b/i, null, ""],
  [/^liga mx$/i, ["mex.1"], "Liga MX"],
  [/^liga de expansi[oó]n mx/i, null, ""],
  [/^copa mx/i, ["mex.copa_mx"], "Copa MX"],
  // Colombia, Chile, Perú, Paraguay, Uruguay, Ecuador, Venezuela, Bolivia
  [/^liga betplay/i, ["col.1"], "Liga BetPlay"],
  [/^primera a$/i, ["col.1"], "Primera A"],
  [/^liga chile$/i, ["chi.1"], "Liga Chile"],
  [/^liga 1$/i, ["per.1"], "Liga 1"],
  [/^liga paraguay$/i, ["par.1"], "Liga Paraguay"],
  [/^liga auf|^primera divisi[oó]n uruguaya/i, ["uru.1"], "Liga AUF"],
  [/^liga pro|^liga ecuador/i, ["ecu.1"], "LigaPro"],
  [/^liga venezolana|^liga futve/i, ["ven.1"], "Liga FUTVE"],
  [/^primera divisi[oó]n$/i, ["chi.1", "par.1", "bol.1", "uru.1", "crc.1"], "Primera División"],
  // Otras
  [/^primeira liga/i, ["por.1"], "Primeira Liga"],
  [/^s[uü]per lig/i, ["tur.1"], "Süper Lig"],
  [/^(saudi pro league|pro league|liga profesional saud[ií])/i, ["ksa.1"], "Saudi Pro League"],
  [/^eredivisie$/i, ["ned.1"], "Eredivisie"],
  [/^mls$/i, ["usa.1"], "MLS"],
  [/^primera b/i, null, ""],
  [/^segunda divisi[oó]n/i, null, ""],
  [/reserve league/i, null, ""],
  [/youth league/i, null, ""],  // lo que este plugin no muestra
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
  const status = (event.status && event.status.type) || {};
  const at = new Date(event.date).getTime();
  return {
    id: String(event.id || ""),
    home: home,
    away: away,
    homeLogo: homeLogo,
    awayLogo: awayLogo,
    at: at,
    state: String(status.state || ""),
    detail: String(status.detail || status.description || ""),
  };
}

// A postponed or cancelled match is not a channel: ESPN still lists it, with the reason.
const NOT_PLAYED = /postponed|cancel|suspend|abandon|aplaz|suspenden/i;

function playable(fixture) {
  if (NOT_PLAYED.test(fixture.detail)) return false;
  if (fixture.state === "post") return false; // already over
  return true;
}

// The ESPN fixture for a site event: same two clubs, kick-off close enough to be the same match.
function espnFixtureFor(siteEvent, boardEvents) {
  let best = null;
  let bestDelta = Infinity;
  for (let i = 0; i < boardEvents.length; i++) {
    const fixture = espnNames(boardEvents[i]);
    if (!fixture.home || !fixture.away || !fixture.at) continue;
    if (!playable(fixture)) continue;
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
    // only the first league of a group is fetched up front: the rest are asked for in turn,
    // and only when the first one did not settle every match of that competition
    for (let d = 0; d < group.dates.length; d++) wanted[group.slugs[0] + "@" + group.dates[d]] = true;
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
      labels: event.labels || [],
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
    const labels = [];
    const srcRe = /href="\/match\/([^"#?]+)#source=(\d+)">\s*<span>[^<]*<\/span>\s*<small>([^<]*)<\/small>/g;
    let m;
    while ((m = srcRe.exec(chunk))) {
      if (m[1] !== slug) continue;
      if (sources.indexOf(m[2]) !== -1) continue;
      sources.push(m[2]);
      const label = clean(m[3]);
      if (label && labels.indexOf(label) === -1) labels.push(label);
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
    const event = makeEvent(slug, competition, teams, sides, at, sources);
    event.labels = labels;
    events.push(event);
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
    const html = await siteText(AGENDA_PATH);
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
    const html = await siteText(CHANNELS_PATH);
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

// --- the site, with a spare ----------------------------------------------

async function siteText(path, cap) {
  const order = [siteIndex];
  for (let i = 0; i < SITES.length; i++) if (i !== siteIndex) order.push(i);

  let last = null;
  for (let i = 0; i < order.length; i++) {
    const index = order[i];
    const failedAt = siteFailedAt[index];
    if (failedAt && Date.now() - failedAt < SITE_FAIL_MS) continue;
    try {
      const body = await getText(SITES[index] + path, cap || 4000);
      siteIndex = index;
      delete siteFailedAt[index];
      return body;
    } catch (e) {
      siteFailedAt[index] = Date.now();
      last = e;
      log("site failed", SITES[index], path, e && e.message);
    }
  }
  throw last || new Error("no site");
}

async function siteJson(path, cap) {
  const order = [siteIndex];
  for (let i = 0; i < SITES.length; i++) if (i !== siteIndex) order.push(i);

  let last = null;
  for (let i = 0; i < order.length; i++) {
    const index = order[i];
    const failedAt = siteFailedAt[index];
    if (failedAt && Date.now() - failedAt < SITE_FAIL_MS) continue;
    try {
      const body = await getJson(SITES[index] + path, cap || 4000);
      siteIndex = index;
      delete siteFailedAt[index];
      return body;
    } catch (e) {
      siteFailedAt[index] = Date.now();
      last = e;
      log("site failed", SITES[index], path, e && e.message);
    }
  }
  throw last || new Error("no site");
}

// --- network helpers ------------------------------------------------------

// Kino drops the call at 20 s; every request inside resolve gets what is left of this budget,
// so a relay that never answers cannot swallow the whole attempt.
const RESOLVE_BUDGET_MS = 12000;
// One source never gets more than this: a relay that hangs must not eat the whole attempt.
const SOURCE_BUDGET_MS = 3000;
let resolveDeadline = 0;

function startBudget() {
  resolveDeadline = Date.now() + RESOLVE_BUDGET_MS;
}

function remainingMs() {
  return resolveDeadline ? resolveDeadline - Date.now() : RESOLVE_BUDGET_MS;
}

function budgetTimeout(most) {
  const left = remainingMs();
  if (left <= 0) return 2000;
  return Math.max(2000, Math.min(most, left));
}

async function getText(url, cap) {
  if (remainingMs() <= 0) throw new Error("out of time");
  const res = await kino.fetch(url, {
    headers: { "User-Agent": UA, Referer: SITE + "/" },
    timeoutMs: budgetTimeout(cap || 8000),
  });
  if (!res || !res.ok) throw new Error("HTTP " + (res ? res.status : "?"));
  return await res.text();
}

async function getJson(url, cap) {
  if (remainingMs() <= 0) throw new Error("out of time");
  const res = await kino.fetch(url, {
    headers: { "User-Agent": UA, Accept: "application/json", Referer: SITE + "/" },
    timeoutMs: budgetTimeout(cap || 6000),
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
  const out = [
    { id: "vivo", title: t("Partidos en vivo", "Live matches"), genre: "deportes" },
    { id: "proximos", title: t("Próximos partidos", "Upcoming matches"), genre: "deportes" },
  ];
  for (let i = 0; i < BRANDS.length; i++) {
    out.push({ id: BRANDS[i].id, title: BRANDS[i].title, genre: "deportes" });
  }
  return out;
}

function brandById(id) {
  for (let i = 0; i < BRANDS.length; i++) {
    if (BRANDS[i].id === id) return BRANDS[i];
  }
  return null;
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

// The same match, one card per broadcaster: "Galatasaray vs Stuttgart · ESPN 5" plays ESPN 5
// and nothing else, which is how a person picks the feed of their own country.
function matchChannels(event, categoryId, now) {
  const many = onePerBroadcaster();
  const labels = (event.labels || []).slice(0, 6);
  if (!many || labels.length < 2) return [matchChannel(event, categoryId, now)];

  const upcoming = event.at > now + EARLY_MS;
  let prefix = "";
  if (upcoming) {
    const day = dayLabel(event.at, now);
    prefix = (day ? day + " " : "") + clockText(event.at) + " · ";
  }

  const out = [];
  const seen = Object.create(null);
  for (let i = 0; i < labels.length && out.length < 4; i++) {
    // "Fox Deportes · Español" and "Fox Deportes" are one card, not two
    const label = labels[i].replace(/\s*·\s*(espa[ñn]ol|portugu[eê]s|ingl[eé]s)\s*$/i, "").trim();
    const key = plain(label);
    if (!key || seen[key]) continue;
    seen[key] = true;
    out.push({
      id: "m-" + event.slug + "-" + out.length,
      title: (prefix + event.teams + " · " + label).slice(0, 300),
      categoryId: categoryId,
      ref: "m~" + event.slug + "~" + event.at + "~" + pinSource(event, labels[i]),
      logo: matchLogo(event),
    });
  }
  if (!out.length) out.push(matchChannel(event, categoryId, now));
  return out;
}

// Which source id carries that broadcaster; the rest of the match's sources stay as backups.
function pinSource(event, label) {
  const ids = event.sources || [];
  if (!ids.length) return "";
  const index = (event.labels || []).indexOf(label);
  if (index <= 0) return ids.join(".");
  const first = event.sourceIds && event.sourceIds[label];
  const pinned = first || ids[Math.min(index, ids.length - 1)];
  const rest = [];
  for (let i = 0; i < ids.length; i++) if (ids[i] !== pinned) rest.push(ids[i]);
  return [pinned].concat(rest).join(".");
}

function onePerBroadcaster() {
  try {
    return String(kino.config.get("onePerBroadcaster") || "on") !== "off";
  } catch (e) {
    return true;
  }
}

// Streams known to answer for channels the directory already lists: when the site's sources
// are down, the same channel plays from here. Names are the plugin's own channel names.
const STREAM_BACKUP = {
  "ESPN": "http://190.61.101.11:7050/play/a09k/index.m3u8?hls",
  "ESPN 2": "http://190.108.83.69:8000/play/a0an/index.m3u8",
  "ESPN 3": "http://190.108.83.69:8000/play/a039/index.m3u8",
  "ESPN 4": "http://190.61.101.11:7050/play/a08p/index.m3u8?hls",
  "ESPN 5": "http://190.61.101.11:7050/play/a06j/index.m3u8?hls",
  "ESPN 6": "http://190.61.101.11:7050/play/a05e/index.m3u8?hls",
  "ESPN 7": "http://205.235.6.29:8000/play/a0zv/index.m3u8?hls",
  "ESPN Premium": "http://205.235.6.29:8000/play/a0wl/index.m3u8?hls",
  "Fox Sports": "http://190.61.101.11:7050/play/a08t/index.m3u8?hls",
  "DSports": "http://190.117.20.37:8000/play/a08d/index.m3u8",
  "DSports 2": "http://201.240.104.137:8000/play/dtv2/index.m3u8",
  "TyC Sports": "http://45.186.254.75:8000/play/a08n/index.m3u8",
  "TNT Sports": "http://181.79.87.131:8000/play/a0e0/index.m3u8",
};

// The brands the plugin shows. Anything else the directory carries is left out on purpose:
// a list of thirty sports channels nobody opens is worse than six that are the ones people watch.
const BRANDS = [
  { id: "espn", title: "ESPN", re: /^espn\b|^espn\s*\d/i },
  { id: "fox", title: "Fox Sports", re: /^fox\s*sports|^fox\s*deportes|^fox\b/i },
  { id: "dsports", title: "DSports", re: /^d\s*sports|^directv\s*sports|^dsports/i },
  { id: "tigo", title: "Tigo Sports", re: /^tigo\s*sports/i },
  { id: "dazn", title: "DAZN", re: /^dazn/i },
  { id: "bein", title: "beIN Sports", re: /^bein\s*sports/i },
  { id: "tyc", title: "TyC Sports", re: /^tyc\s*sports/i },
  { id: "tnt", title: "TNT Sports", re: /^tnt\s*sports/i },
];

function brandOf(title) {
  const name = plain(title);
  for (let i = 0; i < BRANDS.length; i++) {
    if (BRANDS[i].re.test(name)) return BRANDS[i];
  }
  return null;
}

// Channels the stream site does not carry, from the public iptv-org lists: Latin sports
// channels that answer today. They come with their stream already known, so Kino plays them
// without asking the site for a source.
const EXTRA_STREAMS = [
  { name: "Tigo Sports (Paraguay)", logo: "https://upload.wikimedia.org/wikipedia/commons/thumb/3/3b/Tigo_Sports_2025.png/960px-Tigo_Sports_2025.png", url: "http://45.134.141.161:2200/ARG/Tigo_Sports/tracks-v1a1/mono.m3u8" },
  { name: "Tigo Sports (Honduras)", logo: "https://upload.wikimedia.org/wikipedia/commons/thumb/3/3b/Tigo_Sports_2025.png/960px-Tigo_Sports_2025.png", url: "http://168.196.127.137:6001/play/a0ay/index.m3u8" },
  { name: "Tigo Sports+ (Paraguay)", logo: "https://upload.wikimedia.org/wikipedia/commons/thumb/3/3b/Tigo_Sports_2025.png/960px-Tigo_Sports_2025.png", url: "http://45.170.130.224:8000/play/a04i/index.m3u8" },
  { name: "TNT Sports Premium (Chile)", logo: "", url: "http://190.108.83.69:8000/play/a03i/index.m3u8" },
  { name: "beIN SPORTS XTRA en Español", logo: "https://i.imgur.com/V562tpO.png", url: "https://dc1644a9jazgj.cloudfront.net/beIN_Sports_Xtra_Espanol.m3u8" },
];

function extraStation(extra, index) {
  return {
    id: "x-" + index,
    title: extra.name,
    ref: "",
    logo: extra.logo,
    stream: extra.url,
  };
}
// One list of stations: the site's own directory, with the six channels that exist in both
// an Argentine and a Mexican feed replaced by those two, each named with its country.
const deadStations = Object.create(null);
const DEAD_MS = 30 * 60 * 1000;

function markDead(station) {
  if (station) deadStations[station] = Date.now();
}

function looksDead(id) {
  const at = deadStations[id];
  if (!at) return false;
  if (Date.now() - at > DEAD_MS) {
    delete deadStations[id];
    return false;
  }
  return true;
}

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

  for (let e = 0; e < EXTRA_STREAMS.length; e++) {
    out.push(extraStation(EXTRA_STREAMS[e], e));
  }

  // the same name twice is the same channel twice: keep the first, and skip what just failed
  const seen = Object.create(null);
  const unique = [];
  for (let i = 0; i < out.length; i++) {
    const key = plain(String(out[i].title).replace(/\+/g, " plus ")).replace(/\ben\b/g, " ").replace(/\s+/g, " ").trim();
    if (seen[key]) continue;
    if (looksDead(out[i].id)) continue;
    seen[key] = true;
    unique.push(out[i]);
  }
  return unique;
}

function sportsChannel(station, index, categoryId) {
  const item = {
    id: station.id,
    title: String(station.title || station.id).slice(0, 300),
    categoryId: categoryId,
    logo: station.logo || DEFAULT_LOGO,
    number: (index % 9999) + 1,
  };
  if (station.stream) item.stream = { url: station.stream, mime: "application/x-mpegURL" };
  else item.ref = station.ref;
  return item;
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

  const brand = brandById(categoryId);
  if (brand) {
    const list = await stationList();
    const mine = [];
    for (let i = 0; i < list.length; i++) {
      if (brandOf(list[i].title) === brand) mine.push(list[i]);
    }
    const all = mine.map(function (station, index) {
      return sportsChannel(station, index, categoryId);
    });
    return pageOf(all, cursor, CHANNEL_PAGE);
  }

  // the site being unreachable must not turn into an error screen: the channels still work
  let events = [];
  try {
    events = await agendaEvents();
  } catch (e) {
    log("agenda unavailable", e && e.message);
    return { items: [] };
  }
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

  const all = [];
  for (let i = 0; i < selected.length; i++) {
    const cards = matchChannels(selected[i], categoryId, now);
    for (let c = 0; c < cards.length; c++) all.push(cards[c]);
  }
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

  let events;
  try {
    events = await agendaEvents();
  } catch (e) {
    return [];
  }
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

  startBudget();
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
  const servers = (await channelServers(slug)).slice(0, MAX_SERVERS);

  // the mirrors of one channel are asked at the same time, same as a match's sources
  const tries = servers.map(function (server) {
    return channelFromServer(slug, server)
      .then(function (answer) {
        if (!answer || !answer.url) return null;
        if (answer.health === "failed") return null;
        return streamFromRelay(answer.url);
      })
      .catch(function (e) {
        log("channel source failed", slug, server, e && e.message);
        return null;
      });
  });

  // The site's mirrors get a few seconds and no more: a relay that hangs must not eat the
  // whole budget when a known stream of the same channel is one line away.
  const full = resolveDeadline;
  resolveDeadline = Math.min(full, Date.now() + 4500);

  const winner = await new Promise(function (resolve) {
    if (!tries.length) return resolve(null);
    let open = tries.length;
    let settled = false;
    for (let i = 0; i < tries.length; i++) {
      tries[i].then(function (stream) {
        open--;
        if (settled) return;
        if (stream) {
          settled = true;
          resolve(stream);
        } else if (!open) {
          settled = true;
          resolve(null);
        }
      });
    }
  });
  resolveDeadline = full;
  if (winner) return winner;

  // the same channel, from a stream that answered when it was harvested: plain http cannot be
  // fetched by a plugin, so it goes straight to the player
  const name = await channelName(slug);
  if (name && STREAM_BACKUP[name]) {
    log("channel backup", name);
    return { url: STREAM_BACKUP[name], mime: "application/x-mpegURL" };
  }

  log("channel exhausted", slug);
  markDead("c-" + slug);
  return null;
}

async function channelName(slug) {
  try {
    const list = await channelList();
    for (let i = 0; i < list.length; i++) {
      if (list[i].slug === slug) return list[i].name;
    }
  } catch (e) {
    // no name, no backup
  }
  return "";
}

async function channelServers(slug) {
  const fallback = [4, 1, 3];
  try {
    const page = await siteText("/channel/" + encodeURIComponent(slug));
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
    PLAYBACK_PATH +
    "?type=channel&slug=" +
    encodeURIComponent(slug) +
    "&server=" +
    encodeURIComponent(String(server)) +
    "&automatic=1";

  const answer = await siteJson(url);
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
    markDead("f-" + source + "-" + slug);
    return null;
  }
}

async function resolveMatch(payload) {
  const parts = String(payload || "").split("~");
  const slug = parts[0];
  const at = Number(parts[1]) || 0;
  let ids = parts[2]
    ? parts[2].split(".").filter(function (id) {
        return /^\d+$/.test(id);
      })
    : [];
  let sources = [];
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

  try {
    const page = await siteText(MATCH_PATH + encodeURIComponent(slug));
    sources = parseSources(page);
  } catch (e) {
    log("match page failed", slug, e && e.message);
  }
  if (!sources.length && ids.length) {
    for (let i = 0; i < ids.length; i++) sources.push({ id: ids[i], name: "" });
  }

  // A ref that carries a source first is a card of that broadcaster: it gets its own turn
  // before the rest, so the person who picked ESPN gets ESPN and not ESPN AR.
  const pinned = ids.length ? String(ids[0]) : "";
  if (pinned) {
    let hit = null;
    try {
      hit = await eventFromSource(slug, pinned, false);
    } catch (e) {
      log("pinned source failed", pinned, e && e.message);
    }
    if (hit) return hit;
  }

  // Every source of the match is asked at the same time: one that hangs no longer costs the
  // others their turn, and the first that really emits wins.
  const tries = [];
  const count = Math.min(sources.length, MAX_SOURCES);
  for (let i = 0; i < count; i++) {
    tries.push(
      eventFromSource(slug, sources[i].id, false).catch(function (e) {
        log("match source failed", sources[i].id, e && e.message);
        return null;
      })
    );
  }
  if (!tries.length) return null;

  // The first answer wins: waiting for the slow ones would only add their hang to the call.
  const winner = await new Promise(function (resolve) {
    let open = tries.length;
    let settled = false;
    for (let i = 0; i < tries.length; i++) {
      tries[i].then(function (stream) {
        open--;
        if (settled) return;
        if (stream) {
          settled = true;
          resolve(stream);
        } else if (!open) {
          settled = true;
          resolve(null);
        }
      });
    }
  });
  if (winner) return winner;
  if (remainingMs() < 2500) log("out of time for match", slug, "after", count, "sources");

  // Every source of this match is dead: play the channel that carries it, when we know it.
  return await streamFromBroadcast(sources);
}

// "Fuente 2 · ESPN" means the match is on ESPN. Only an exact channel name counts, so an
// Argentine feed is never replaced by a Mexican one.
async function streamFromBroadcast(sources) {
  const names = [];
  for (let i = 0; i < sources.length; i++) {
    const name = plain(sources[i].name);
    if (name && names.indexOf(name) === -1) names.push(name);
  }
  if (!names.length) return null;

  let stations;
  try {
    stations = await stationList();
  } catch (e) {
    return null;
  }

  for (let n = 0; n < names.length; n++) {
    for (let s = 0; s < stations.length; s++) {
      const station = stations[s];
      if (plain(station.title) !== names[n]) continue;
      log("fallback to channel", station.title);
      if (station.stream) return { url: station.stream, mime: "application/x-mpegURL" };
      if (station.ref && station.ref.indexOf("c~") === 0) {
        const stream = await resolveChannel(station.ref.slice(2));
        if (stream) return stream;
      }
    }
  }
  return null;
}

// Each source button says which channel carries it: "Fuente 2 · ESPN AR". The name is what
// lets a dead match fall back to that channel.
function parseSources(html) {
  const page = String(html || "");
  const out = [];
  const seen = Object.create(null);
  const button = /data-source="(\d+)"[^>]*title="([^"]*)"/g;
  let m;
  while ((m = button.exec(page))) {
    const id = m[1];
    if (seen[id]) continue;
    seen[id] = true;
    const label = clean(m[2]).split("·").pop().trim();
    out.push({ id: id, name: label });
  }
  if (out.length) return out.slice(0, 8);

  const plain = /data-source="(\d+)"/g;
  while ((m = plain.exec(page))) {
    if (seen[m[1]]) continue;
    seen[m[1]] = true;
    out.push({ id: m[1], name: "" });
  }
  return out.slice(0, 8);
}

async function eventFromSource(slug, sourceId, deep) {
  const url =
    PLAYBACK_PATH +
    "?type=event&slug=" +
    encodeURIComponent(slug) +
    "&source=" +
    encodeURIComponent(sourceId) +
    "&automatic=1";

  const answer = await siteJson(url);
  if (!answer || !answer.url) return null;
  if (String(answer.health || "") === "failed") return null; // the site says this source is down
  return streamFromRelay(String(answer.url), deep);
}

// --- relay pages ----------------------------------------------------------

// Every relay (tvf90, streamxhd, la18hd) wraps the same thing: a page that holds
// playbackURL, sometimes behind one iframe, sometimes split into base64 pieces.
async function streamFromRelay(url, deep) {
  const playlist = await playlistAt(url);
  if (!playlist) return null;

  const streamUrl = normalise(playlist);
  if (!streamUrl) return null;

  const nodes = ftllyNodes(streamUrl);
  const found = nodes.length > 1 ? await firstAlive(nodes, deep, 4000) : (await alive(streamUrl, deep)) ? streamUrl : null;
  if (!found) return null;

  return { url: found, mime: "application/x-mpegURL" };
}

// 4.ftlly.com and 10.ftlly.com sometimes take eleven seconds to say 404 for a stream their
// siblings serve at once: the token is not tied to the node, so any node will do.
function ftllyNodes(url) {
  try {
    const parsed = new URL(url);
    const match = /^(\d+)\.ftlly\.com$/i.exec(parsed.hostname);
    if (!match) return [url];
    const out = [];
    const order = [parsed.hostname.split(".")[0], "3", "8", "2", "6", "5", "7"];
    for (let i = 0; i < order.length; i++) {
      const host = order[i] + ".ftlly.com";
      if (out.indexOf("https://" + host + parsed.pathname + parsed.search) !== -1) continue;
      if (out.length >= 5) break;
      out.push("https://" + host + parsed.pathname + parsed.search);
    }
    return out;
  } catch (e) {
    return [url];
  }
}

async function firstAlive(urls, deep, cap) {
  return await new Promise(function (resolve) {
    let open = urls.length;
    let settled = false;
    for (let i = 0; i < urls.length; i++) {
      const url = urls[i];
      alive(url, deep, cap).then(function (ok) {
        open--;
        if (settled) return;
        if (ok) {
          settled = true;
          resolve(url);
        } else if (!open) {
          settled = true;
          resolve(null);
        }
      });
    }
  });
}

// A relay happily hands out a playlist for a channel that is off: read it, walk to a variant
// and touch the first segment before promising it. A manifest that answers is not a stream.
const PROBE_BYTES = 65536;

async function alive(url, deep, cap) {
  try {
    const manifest = await fetchCap(url, cap);
    if (!manifest) return false;

    let text = manifest.text;
    let base = url;
    if (text.indexOf("#EXTM3U") !== 0) return false;

    const isMaster = text.indexOf("#EXT-X-STREAM-INF") !== -1;
    // a live match does not pay for the deep walk: a master that answers is a signal, and the
    // player fetches its variants itself
    if (deep === false) return !(text.indexOf("#EXT-X-ENDLIST") !== -1 && !isMaster);

    // a master playlist names its variants: one of them is the video
    if (isMaster) {
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

async function fetchCap(url, cap) {
  try {
    if (remainingMs() <= 0) return null;
    const res = await kino.fetch(url, {
      headers: { "User-Agent": UA },
      maxBytes: PROBE_BYTES,
      timeoutMs: budgetTimeout(cap || 6000),
    });
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
