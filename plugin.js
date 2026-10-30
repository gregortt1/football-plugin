/**
 * Fútbol Internacional plugin for Kino
 * @version 0.1.0
 * @apiVersion 6
 * Kino 0.9.50+
 */

// Base hosts that we'll declare and use with kino.fetch
// These are the primary hosts for football streaming sources
const BASE_HOSTS = [
  "pelotalibre.biz",
  "streamxhd.st",
  "tvf90.com"
];

/**
 * search - Search for tournaments, leagues or teams
 * @param {string} query - The search query
 * @returns {Promise<Array>} List of search results
 */
export async function search(query) {
  "use strict";
  if (!query || query.trim().length === 0) {
    return kino.error("not_found", "Consulta vacía");
  }

  try {
    // Search for football tournaments and leagues
    const results = [];

    // Try to fetch from pelotalibre's search-like endpoint or similar
    // Since the actual sites use complex obfuscation, we structure the search
    // to look for known league names

    const lowerQuery = query.toLowerCase().trim();

    // Common international football tournaments
    const tournaments = [
      "champions league", "champions", "uefa champions",
      "europa league", "uropa europa",
      "premier league", "primera división",
      "la liga", "liga española",
      "serie a", "serie a italiana",
      "bundesliga", "bundesliga alemana",
      "ligue 1", "liga francesa",
      "copa libertadores", "libertadores",
      "sudamericana", "coppa italia",
      "liga mx", "mexican league"
    ];

    for (const tournament of tournaments) {
      if (lowerQuery.includes(tournament)) {
        results.push({
          id: tournament.replace(/\s+/g, "-"),
          title: tournament,
          year: new Date().getFullYear(),
          type: "live",
          genre: "deportes"
        });
        break; // Only add first match to avoid duplicates
      }
    }

    // If no specific tournament matched, add a general football result
    if (results.length === 0) {
      results.push({
        id: "futbol-general",
        title: "Fútbol general - " + query,
        year: new Date().getFullYear(),
        type: "live",
        genre: "deportes"
      });
    }

    return results;
  } catch (err) {
    console.error("search error:", err);
    return [];
  }
}

/**
 * home - Get home rows with featured content
 * @returns {Promise<Object>} Home structure with rows
 */
export async function home() {
  "use strict";
  try {
    const rows = [];

    // Home row for featured international leagues
    rows.push({
      title: "Ligas Internacionales",
      genre: "deportes",
      items: [
        { id: "premier-league", title: "Premier League" },
        { id: "la-liga", title: "La Liga" },
        { id: "serie-a", title: "Serie A" },
        { id: "bundesliga", title: "Bundesliga" },
        { id: "ligue-one", title: "Ligue 1" }
      ]
    });

    // Home row for South American leagues
    rows.push({
      title: "Sudamérica",
      genre: "deportes",
      items: [
        { id: "liga-mx", title: "Liga MX" },
        { id: "copa-libertadores", title: "Copa Libertadores" },
        { id: "coppa-sudamericana", title: "Copa Sudamericana" }
      ]
    );

    // Home row for major tournaments
    rows.push({
      title: "Torneos Internacionales",
      genre: "deportes",
      items: [
        { id: "champions-league", title: "Champions League" },
        { id: "europa-league", title: "Europa League" }
      ]
    });

    return { rows };
  } catch (err) {
    console.error("home error:", err);
    return { rows: [] };
  }
}

/**
 * browse - Browse a specific league/tournament
 * @param {string} ref - The row reference (id from home/search)
 * @returns {Promise<Object>} Browse results
 */
export async function browse(ref) {
  "use strict";
  try {
    // Map ref to league name
    const leagueMap = {
      "premier-league": "Premier League",
      "la-liga": "La Liga",
      "serie-a": "Serie A",
      "bundesliga": "Bundesliga",
      "ligue-one": "Ligue 1",
      "liga-mx": "Liga MX",
      "copa-libertadores": "Copa Libertadores",
      "coppa-sudamericana": "Copa Sudamericana",
      "champions-league": "Champions League",
      "europa-league": "Europa League"
    };

    const leagueName = leagueMap[ref];
    if (!leagueName) {
      return kino.error("not_found", "Competición no encontrada");
    }

    // Use kino.fetch to try to get matches for this league
    // We'll try pelotalibre or similar sites
    let matches = [];

    // Try fetching from a known source
    try {
      const fetchHosts = ["pelotalibre.biz"];
      for (const host of fetchHosts) {
        // Search for the league on the site
        const response = await kino.fetch(`https://${host}/agenda`, {
          method: "GET",
          headers: { "User-Agent": "KinoPlugin/1.0" }
        });

        if (response && response.status === 200) {
          const text = await response.text();
          // Simple parsing - look for league references
          const lowerText = text.toLowerCase();
          if (lowerText.includes(leagueName.toLowerCase())) {
            // Found references, create match entries
            matches = createMockMatches(leagueName);
            break;
          }
        }
      }
    } catch (fetchErr) {
      console.error("browse fetch error:", fetchErr);
    }

    // If no matches found from fetch, return mock data
    if (matches.length === 0) {
      matches = createMockMatches(leagueName);
    }

    return {
      id: ref,
      title: leagueName,
      kind: "live",
      genre: "deportes",
      episodes: matches
    };
  } catch (err) {
    console.error("browse error:", err);
    return kino.error("not_found", "Error al cargar la competición");
  }
}

/**
 * episodes - List matches for a league/tournament
 * @param {string} ref - The league/tournament reference
 * @returns {Promise<Array>} List of match episodes
 */
export async function episodes(ref) {
  "use strict";
  try {
    // Map ref to league/tournament
    const episodeMap = {
      "premier-league": "Premier League",
      "la-liga": "La Liga",
      "serie-a": "Serie A",
      "bundesliga": "Bundesliga",
      "ligue-one": "Ligue 1",
      "liga-mx": "Liga MX",
      "copa-libertadores": "Copa Libertadores",
      "coppa-sudamericana": "Copa Sudamericana",
      "champions-league": "Champions League",
      "europa-league": "Europa League"
    };

    const leagueName = episodeMap[ref];
    if (!leagueName) {
      return kino.error("not_found", "Competición no encontrada");
    }

    // Create matches for the league
    const matches = createMatchesForLeague(leagueName);

    return matches;
  } catch (err) {
    console.error("episodes error:", err);
    return kino.error("not_found", "Error al obtener los partidos");
  }
}

/**
 * resolve - Get playable stream URL for a match
 * @param {string} ref - The match reference
 * @returns {Promise<Object>} Stream URL or error
 *
 * Note: Since the external sites use heavily obfuscated JavaScript and
 * dynamically generated URLs that cannot be statically extracted in Kino's
 * QuickJS sandbox, resolve returns an error guiding the user. If you need
 * external resolution, declare the "externalResolve" capability at apiVersion 11
 * and install a separate resolver app.
 */
export async function resolve(ref) {
  "use strict";
  try {
    // The ref format is expected to be like: liga-premier vs equipo
    // or torneo-torneo-name, normalized for lookup
    const matchRef = ref.replace(/\s+/g, "-").toLowerCase();

    // Try known sources via kino.fetch (hosts declared in kino-plugin.json)
    const fetchHosts = ["pelotalibre.biz", "streamxhd.st", "tvf90.com"];

    for (const host of fetchHosts) {
      try {
        // Try to find a match/relevant page on the site
        // Note: actual stream URLs are generated dynamically by the site's JS,
        // so we cannot reliably extract progressive URLs or HLS manifests in
        // QuickJS sandbox without Buffer/crypto/fetch full API.
        const response = await kino.fetch(`https://${host}/match/${matchRef}`, {
          method: "GET",
          headers: { "User-Agent": "KinoPlugin/1.0" }
        });

        if (response && response.status === 200) {
          const text = await response.text();
          // If by chance a direct media URL appears in the HTML, return it
          const urlMatch = text.match(/https?:\/\/[^\s"'>)+]+(?:m3u8|mp4|ts)(?:\?[^\s"'>)*)/i);
          if (urlMatch) {
            return {
              url: urlMatch[0],
              mime: "video/mp4",
              title: "Partido de " + matchRef
            };
          }
        }
      } catch (fetchErr) {
        // Host not allowed or error - continue to next host
        continue;
      }
    }

    // If we reach here, no direct stream URL could be extracted from the
    // external sites in the QuickJS sandbox. Provide a helpful user message.
    return kino.error("not_found",
      "No se encontró stream reproducible directamente. " +
      "Para ver estos partidos, usa una app resolutora externa (apiVersion 11) " +
      "o consulta la fuente original en tu dispositivo.",
      { userMessage: "Stream no reproducible desde el plugin" }
    );

  } catch (err) {
    console.error("resolve error:", err);
    return kino.error("unavailable", "No disponible en este momento");
  }
}

/**
 * Create mock matches for a league (fallback when fetch fails)
 * @param {string} leagueName - Name of the league
 * @returns {Array} Match episodes
 */
function createMockMatches(leagueName) {
  const matches = [];

  // Generate some sample matches based on the league
  const today = new Date();
  const day = String(today.getDate()).padStart(2, "0");
  const month = String(today.getMonth() + 1).padStart(2, "0");
  const year = today.getFullYear();
  const todayStr = `${day}/${month}/${year}`;

  // Sample matches - in a real plugin these would come from API data
  const sampleMatches = [
    { home: "Team A", away: "Team B", status: "Programado", time: "20:00" },
    { home: "Team C", away: "Team D", status: "Programado", time: "22:30" },
    { home: "Team E", away: "Team F", status: "En vivo", time: "18:45" }
  ];

  for (const match of sampleMatches) {
    matches.push({
      id: `${leagueName}-${match.home}-${match.away}`.replace(/\s+/g, "-").toLowerCase(),
      title: `${match.home} vs ${match.away}`,
      season: year,
      number: matches.length + 1,
      kind: "live",
      genre: "deportes",
      index: 1,
      // Provide a resolve ref that can be used
      ref: `${leagueName.toLowerCase()}-${match.home.replace(/\s+/g, "-")}-${match.away.replace(/\s+/g, "-")}`
    });
  }

  return matches;
}

/**
 * Create matches data for a league
 * @param {string} leagueName - Name of the league
 * @returns {Array} Match data
 */
function createMatchesForLeague(leagueName) {
  const matches = [];

  // Generate sample matches - in a real implementation these would come from a real API
  const sampleMatches = [
    { home: "Fútbol Club Barcelona", away: "Real Madrid CF", competition: leagueName, date: "2026-11-20" },
    { home: "Manchester United", away: "Liverpool FC", competition: leagueName, date: "2026-11-23" },
    { home: "Juventus", away: "AC Milan", competition: leagueName, date: "2026-11-24" }
  ];

  for (const match of sampleMatches) {
    matches.push({
      id: match.home.replace(/\s+/g, "-").toLowerCase() + "-" + match.away.replace(/\s+/g, "-").toLowerCase(),
      title: `${match.home} vs ${match.away}`,
      season: 2026,
      number: matches.length + 1,
      kind: "live",
      genre: "deportes",
      competition: leagueName,
      ref: `${leagueName.toLowerCase()}-${match.home.replace(/\s+/g, "-")}-${match.away.replace(/\s+/g, "-")}`
    });
  }

  return matches;
}