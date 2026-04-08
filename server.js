import express from "express";
import https from "https";

const app = express();
const PORT = process.env.PORT || 3000;
const API_BASE = "https://api.moxfield.com/v2/decks/all";
const EDH_API_URL = "https://edhtop16.com/api/graphql";
const SCRYFALL_SEARCH_URL = "https://api.scryfall.com/cards/search";
const SCRYFALL_NAMED_URL = "https://api.scryfall.com/cards/named";
const EDH_CACHE_TTL_MS = 60 * 60 * 1000;
const edhCache = new Map();
const staplesCache = new Map();
const scryfallCache = new Map();
const ALLOWED_TIME_PERIODS = new Set([
  "ONE_MONTH",
  "THREE_MONTHS",
  "SIX_MONTHS",
  "ONE_YEAR",
  "ALL_TIME",
  "POST_BAN",
]);
const DEFAULT_MIN_EVENT_SIZE = 30;
const EDH_CARD_WINRATE_QUERY = `
  query CardWinrate($name: String!, $cardName: String, $timePeriod: TimePeriod!) {
    commander(name: $name) {
      name
      cardDetail(cardName: $cardName) {
        name
        type
        cmc
        colorId
        imageUrls
        scryfallUrl
        cardPreviewImageUrl
        id
      }
      cardWinrateStats(cardName: $cardName, timePeriod: $timePeriod) {
        withCard {
          totalEntries
          topCuts
          conversionRate
        }
        withoutCard {
          totalEntries
          topCuts
          conversionRate
        }
      }
    }
  }
`;

app.use(express.static("."));

app.get("/health", (_req, res) => {
  res.status(200).json({ ok: true });
});

function extractDeckId(input) {
  const trimmed = (input || "").trim();
  if (!trimmed) return "";
  const match = trimmed.match(/moxfield\.com\/decks\/([A-Za-z0-9_-]+)/i);
  if (match) return match[1];
  return trimmed;
}

function normalizeText(value) {
  return (value || "").toString().trim();
}

function scryfallCacheKey(cardName) {
  return normalizeText(cardName).toLowerCase();
}

function edhCacheKey({ commander, cardName, timePeriod }) {
  return [commander, cardName, timePeriod].join("|").toLowerCase();
}

function staplesCacheKey({ commander, timePeriod, minEventSize }) {
  return [commander, timePeriod, minEventSize].join("|").toLowerCase();
}

function decodeHtmlEntities(value) {
  return (value || "")
    .replace(/&#x27;/g, "'")
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

function parseCommanderStaples(html) {
  const sectionPattern =
    /<div class="flex items-center justify-between border-b border-white\/30 bg-black\/30 px-2 py-1"><span class="font-medium">([^<]+)<\/span><span class="text-sm font-medium">Play rate<\/span><\/div><div class="flex flex-col">([\s\S]*?)<\/div><\/div>/g;
  const cardPattern =
    /<button[^>]*><div class="flex items-center gap-2"><span class="text-sm text-white hover:underline">([\s\S]*?)<\/span><\/div><div class="flex gap-2">[\s\S]*?<span class="text-sm text-white\/60">([\d.]+)(?:<!-- -->)?%<\/span><\/div><\/button>/g;
  const cards = [];
  const seen = new Set();
  let sectionMatch;

  while ((sectionMatch = sectionPattern.exec(html)) !== null) {
    const cardListHtml = sectionMatch[2];
    let cardMatch;
    while ((cardMatch = cardPattern.exec(cardListHtml)) !== null) {
      const name = decodeHtmlEntities(cardMatch[1]).trim();
      const playRate = Number(cardMatch[2]);
      const key = name.toLowerCase();
      if (!name || !Number.isFinite(playRate) || seen.has(key)) continue;
      seen.add(key);
      cards.push({
        name,
        playRate,
      });
    }
  }

  return cards;
}

function fetchJson(url, headers = {}) {
  return new Promise((resolve, reject) => {
    https
      .get(
        url,
        {
          headers: {
            "User-Agent":
              "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/144.0.0.0 Safari/537.36",
            Accept: "application/json;q=0.9,*/*;q=0.8",
            ...headers,
          },
        },
        (apiRes) => {
          let data = "";
          apiRes.on("data", (chunk) => {
            data += chunk;
          });
          apiRes.on("end", () => {
            if (apiRes.statusCode && apiRes.statusCode >= 400) {
              reject(new Error(`Upstream request failed (${apiRes.statusCode})`));
              return;
            }

            try {
              resolve(JSON.parse(data));
            } catch (error) {
              reject(new Error("Invalid upstream response"));
            }
          });
        }
      )
      .on("error", () => {
        reject(new Error("Proxy error"));
      });
  });
}

async function fetchCardReleaseInfo(cardName) {
  const normalizedName = normalizeText(cardName);
  if (!normalizedName) return null;

  const cacheKey = scryfallCacheKey(normalizedName);
  const cached = scryfallCache.get(cacheKey);
  if (cached && Date.now() - cached.timestamp < EDH_CACHE_TTL_MS) {
    return cached.data;
  }

  try {
    const params = new URLSearchParams({
      q: `!"${normalizedName}"`,
      unique: "prints",
      order: "released",
      dir: "asc",
    });
    const response = await fetchJson(`${SCRYFALL_SEARCH_URL}?${params.toString()}`);
    const earliestPrinting =
      Array.isArray(response?.data) && response.data.length > 0 ? response.data[0] : null;
    let releaseInfo = earliestPrinting?.released_at
      ? {
          firstReleasedAt: earliestPrinting.released_at,
        }
      : null;

    if (!releaseInfo) {
      const namedParams = new URLSearchParams({ exact: normalizedName });
      const namedResponse = await fetchJson(`${SCRYFALL_NAMED_URL}?${namedParams.toString()}`);
      releaseInfo = namedResponse?.released_at
        ? {
            firstReleasedAt: namedResponse.released_at,
          }
        : null;
    }

    scryfallCache.set(cacheKey, {
      data: releaseInfo,
      timestamp: Date.now(),
    });
    return releaseInfo;
  } catch (error) {
    scryfallCache.set(cacheKey, {
      data: null,
      timestamp: Date.now(),
    });
    return null;
  }
}

app.get("/api/deck", async (req, res) => {
  try {
    const deckId = extractDeckId(req.query.id);
    if (!deckId) {
      return res.status(400).json({ error: "Missing deck id" });
    }

    const apiUrl = `${API_BASE}/${deckId}`;
    https
      .get(
        apiUrl,
        {
          headers: {
            "User-Agent": "SisayScenarioGenerator/1.0",
          },
        },
        (apiRes) => {
          let data = "";
          apiRes.on("data", (chunk) => {
            data += chunk;
          });
          apiRes.on("end", async () => {
            if (apiRes.statusCode && apiRes.statusCode >= 400) {
              return res
                .status(apiRes.statusCode)
                .json({ error: "Upstream request failed" });
            }
            try {
              const json = JSON.parse(data);
              return res.json(json);
            } catch (err) {
              return res.status(502).json({ error: "Invalid upstream response" });
            }
          });
        }
      )
      .on("error", () => {
        return res.status(502).json({ error: "Proxy error" });
      });
  } catch (error) {
    return res.status(500).json({ error: "Server error" });
  }
});

app.get("/api/edhtop16", async (req, res) => {
  try {
    const commander = normalizeText(req.query.commander);
    const cardName = normalizeText(req.query.card);
    const timePeriod = normalizeText(req.query.timePeriod || "ONE_YEAR");

    if (!commander || !cardName) {
      return res.status(400).json({ error: "Missing commander or card" });
    }
    if (!ALLOWED_TIME_PERIODS.has(timePeriod)) {
      return res.status(400).json({ error: `Invalid timePeriod: ${timePeriod}` });
    }

    const cacheKey = edhCacheKey({ commander, cardName, timePeriod });
    const cached = edhCache.get(cacheKey);
    if (cached && Date.now() - cached.timestamp < EDH_CACHE_TTL_MS) {
      return res.json(cached.data);
    }

    const payload = JSON.stringify({
      query: EDH_CARD_WINRATE_QUERY,
      variables: {
        name: commander,
        cardName,
        timePeriod,
      },
    });

    const request = https.request(
      EDH_API_URL,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(payload),
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/144.0.0.0 Safari/537.36",
          Accept: "*/*",
        },
      },
      (apiRes) => {
        let data = "";
        apiRes.on("data", (chunk) => {
          data += chunk;
        });
        apiRes.on("end", async () => {
          if (apiRes.statusCode && apiRes.statusCode >= 400) {
            return res
              .status(apiRes.statusCode)
              .json({ error: "Upstream request failed" });
          }
          try {
            const json = JSON.parse(data);
            const upstreamError = json?.errors?.[0]?.message || null;
            if (upstreamError) {
              return res.status(502).json({ error: `EDHTop16: ${upstreamError}` });
            }
            const commanderData = json?.data?.commander || null;
            const releaseInfo = await fetchCardReleaseInfo(cardName);
            const responseData = {
              commander: commanderData?.name || commander,
              cardDetail: commanderData?.cardDetail || null,
              cardWinrateStats: commanderData?.cardWinrateStats || null,
              cardMeta: releaseInfo,
            };
            edhCache.set(cacheKey, { data: responseData, timestamp: Date.now() });
            return res.json(responseData);
          } catch (err) {
            return res.status(502).json({ error: "Invalid upstream response" });
          }
        });
      }
    );

    request.on("error", () => {
      return res.status(502).json({ error: "Proxy error" });
    });

    request.write(payload);
    request.end();
  } catch (error) {
    return res.status(500).json({ error: "Server error" });
  }
});

app.get("/api/edhtop16-staples", async (req, res) => {
  try {
    const commander = normalizeText(req.query.commander);
    const timePeriod = normalizeText(req.query.timePeriod || "ONE_YEAR");
    const minEventSize = Number(req.query.minEventSize || DEFAULT_MIN_EVENT_SIZE);
    const threshold = Number(req.query.threshold ?? 75);

    if (!commander) {
      return res.status(400).json({ error: "Missing commander" });
    }
    if (!ALLOWED_TIME_PERIODS.has(timePeriod)) {
      return res.status(400).json({ error: `Invalid timePeriod: ${timePeriod}` });
    }
    if (!Number.isFinite(minEventSize) || minEventSize <= 0) {
      return res.status(400).json({ error: "Invalid minEventSize" });
    }
    if (!Number.isFinite(threshold) || threshold < 0 || threshold > 100) {
      return res.status(400).json({ error: "Invalid threshold" });
    }

    const cacheKey = staplesCacheKey({ commander, timePeriod, minEventSize });
    const cached = staplesCache.get(cacheKey);
    if (cached && Date.now() - cached.timestamp < EDH_CACHE_TTL_MS) {
      return res.json({
        commander: cached.commander,
        threshold,
        cards: cached.cards.filter((card) => card.playRate > threshold),
      });
    }

    const staplesUrl =
      `https://edhtop16.com/commander/${encodeURIComponent(commander)}` +
      `?tab=staples&sortBy=TOP&timePeriod=${encodeURIComponent(timePeriod)}` +
      `&minEventSize=${encodeURIComponent(minEventSize)}`;

    https
      .get(
        staplesUrl,
        {
          headers: {
            "User-Agent":
              "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/144.0.0.0 Safari/537.36",
            Accept: "text/html,application/xhtml+xml",
          },
        },
        (apiRes) => {
          let data = "";
          apiRes.on("data", (chunk) => {
            data += chunk;
          });
          apiRes.on("end", () => {
            if (apiRes.statusCode && apiRes.statusCode >= 400) {
              return res
                .status(apiRes.statusCode)
                .json({ error: "Upstream request failed" });
            }
            try {
              const cards = parseCommanderStaples(data);
              const responseData = {
                commander,
                threshold,
                cards: cards.filter((card) => card.playRate > threshold),
              };
              staplesCache.set(cacheKey, {
                commander,
                cards,
                timestamp: Date.now(),
              });
              return res.json(responseData);
            } catch (err) {
              return res.status(502).json({ error: "Invalid upstream response" });
            }
          });
        }
      )
      .on("error", () => {
        return res.status(502).json({ error: "Proxy error" });
      });
  } catch (error) {
    return res.status(500).json({ error: "Server error" });
  }
});

app.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
});
