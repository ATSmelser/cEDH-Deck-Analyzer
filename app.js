const appEl = document.querySelector(".app");
const statusEl = document.getElementById("status");
const resultsEl = document.getElementById("results");
const deckNameEl = document.getElementById("deckName");
const deckIdEl = document.getElementById("deckId");
const deckOwnerLinkEl = document.getElementById("deckOwnerLink");
const statsStatusEl = document.getElementById("statsStatus");
const statsTableEl = document.getElementById("statsTable");
const takeawaysSectionEl = document.getElementById("takeawaysSection");
const takeawaysStatusEl = document.getElementById("takeawaysStatus");
const exportSummaryBtnEl = document.getElementById("exportSummaryBtn");
const lowDataBannerEl = document.getElementById("lowDataBanner");
const lowDataBannerTextEl = document.getElementById("lowDataBannerText");
const deckComparisonBlockEl = document.getElementById("deckComparisonBlock");
const deckComparisonTextEl = document.getElementById("deckComparisonText");
const deckPlayRateBlockEl = document.getElementById("deckPlayRateBlock");
const deckPlayRateTextEl = document.getElementById("deckPlayRateText");
const hottestTechBlockEl = document.getElementById("hottestTechBlock");
const hottestTechListEl = document.getElementById("hottestTechList");
const stinkersBlockEl = document.getElementById("potentialStinkersBlock");
const stinkersListEl = document.getElementById("potentialStinkersList");
const exclusionsBlockEl = document.getElementById("missingStaplesBlock");
const exclusionsListEl = document.getElementById("missingStaplesList");
const timeWindowSelectEl = document.getElementById("timeWindowSelect");
const sortHeaderEls = document.querySelectorAll("th[data-sort]");

const TAKEAWAY_PERIODS = ["THREE_MONTHS", "SIX_MONTHS", "ONE_YEAR"];
const TREND_PERIODS = ["THREE_MONTHS", "SIX_MONTHS", "ONE_YEAR", "ALL_TIME"];
const TREND_BUCKETS = [
  { key: "TWELVE_PLUS", upper: "ALL_TIME", lower: "ONE_YEAR", ageMonths: 18, minAgeMonths: 12 },
  { key: "SIX_TO_TWELVE", upper: "ONE_YEAR", lower: "SIX_MONTHS", ageMonths: 9, minAgeMonths: 6 },
  { key: "THREE_TO_SIX", upper: "SIX_MONTHS", lower: "THREE_MONTHS", ageMonths: 4.5, minAgeMonths: 3 },
  { key: "ZERO_TO_THREE", upper: "THREE_MONTHS", lower: null, ageMonths: 1.5, minAgeMonths: 0 },
];
const DECK_SUMMARY_PERIOD = "SIX_MONTHS";
const EXCLUSION_COMPARISON_PERIOD = "ONE_YEAR";
const TIME_PERIOD_LABELS = {
  THREE_MONTHS: "3 months",
  SIX_MONTHS: "6 months",
  ONE_YEAR: "12 months",
  ALL_TIME: "All time",
};
const NOTABLE_EXCLUSIONS_FETCH_THRESHOLD = 0;
const EDH_MIN_EVENT_SIZE = 30;
const SIGNIFICANCE_THRESHOLD = 0.05;
const MIN_COMMANDER_ENTRIES_FOR_SUMMARY = 100;

let currentDeck = null;
let currentCommander = "";
let currentStats = new Map();
let currentTrends = new Map();
let currentTakeawayStats = new Map();
let currentMissingStaples = [];
let currentCommanderEntriesSixMonths = null;
let selectedTimePeriod = "SIX_MONTHS";
let sortMetric = "delta";
let sortDirection = "desc";

function setInitialViewMode(isInitial) {
  if (!appEl) return;
  appEl.classList.toggle("app--initial", isInitial);
}

function setResultsVisible(isVisible) {
  if (!resultsEl) return;
  resultsEl.hidden = !isVisible;
  setInitialViewMode(!isVisible);
}

function setStatus(message, isError = false) {
  statusEl.textContent = message;
  statusEl.style.color = isError ? "#b3261e" : "#5b606b";
}

function setStatsStatus(message, isError = false) {
  statsStatusEl.textContent = message;
  statsStatusEl.style.color = isError ? "#b3261e" : "#5b606b";
}

function setTakeawaysStatus(message, isError = false) {
  if (!takeawaysStatusEl) return;
  takeawaysStatusEl.textContent = message;
  takeawaysStatusEl.style.color = isError ? "#b3261e" : "#5b606b";
}

function setTakeawaysSectionVisible(isVisible) {
  if (!takeawaysSectionEl) return;
  takeawaysSectionEl.hidden = !isVisible;
  if (exportSummaryBtnEl) exportSummaryBtnEl.disabled = !isVisible;
}

function setLowDataBannerVisible(isVisible) {
  if (!lowDataBannerEl) return;
  lowDataBannerEl.hidden = !isVisible;
}

function setTakeawayBlockVisible(element, isVisible) {
  if (!element) return;
  element.hidden = !isVisible;
}

function getCommanderEntriesFromStats(withCard, withoutCard) {
  const withTotal = Number(withCard?.totalEntries ?? 0);
  const withoutTotal = Number(withoutCard?.totalEntries ?? 0);

  if (!Number.isFinite(withTotal) || !Number.isFinite(withoutTotal)) return null;
  return withTotal + withoutTotal;
}

function extractDeckId(input) {
  const trimmed = input.trim();
  if (!trimmed) return "";

  const match = trimmed.match(/moxfield\.com\/decks\/([A-Za-z0-9_-]+)/i);
  return match ? match[1] : trimmed;
}

function normalizeCardName(value) {
  return (value || "").trim().toLowerCase();
}

function sanitizeFilename(value) {
  return (value || "summary")
    .toString()
    .trim()
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, "")
    .replace(/\s+/g, "-")
    .toLowerCase();
}

function normalizeUrl(value) {
  const trimmed = (value || "").toString().trim();
  if (!trimmed) return "";
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  return `https://moxfield.com${trimmed.startsWith("/") ? "" : "/"}${trimmed}`;
}

function getDeckOwnerInfo(deck) {
  const owner =
    deck?.createdByUser ||
    deck?.owner ||
    deck?.author ||
    deck?.user ||
    null;

  const ownerName =
    owner?.displayName ||
    owner?.userName ||
    owner?.username ||
    owner?.name ||
    deck?.createdByUserName ||
    deck?.createdBy ||
    "";

  const ownerLink =
    normalizeUrl(owner?.profileUrl || owner?.url || owner?.publicUrl || "") ||
    (owner?.userName || owner?.username
      ? `https://moxfield.com/users/${encodeURIComponent(owner.userName || owner.username)}`
      : "");

  return {
    name: ownerName || "Unknown",
    url: ownerLink,
  };
}

function swapPartnerOrder(commander) {
  const parts = commander
    .split(" / ")
    .map((part) => part.trim())
    .filter(Boolean);

  if (parts.length !== 2) return null;
  return `${parts[1]} / ${parts[0]}`;
}

function getTimePeriodLabel(period) {
  return TIME_PERIOD_LABELS[period] || period;
}

function getTimePeriodRank(period) {
  return TAKEAWAY_PERIODS.indexOf(period);
}

function formatEntries(board, sortByName = true) {
  const entries = Object.entries(board).map(([name, details]) => ({
    name,
    quantity: details.quantity ?? 1,
  }));

  if (sortByName) {
    entries.sort((a, b) => a.name.localeCompare(b.name));
  }

  return entries;
}

function formatPercentFromRatio(value) {
  if (typeof value !== "number" || !Number.isFinite(value)) return "n/a";
  return `${(value * 100).toFixed(1)}%`;
}

function formatPercentValue(value) {
  if (typeof value !== "number" || !Number.isFinite(value)) return "n/a";
  const sign = value > 0 ? "+" : "";
  return `${sign}${value.toFixed(1)}%`;
}

function classifyTrendSignal(value) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return {
      symbol: "n/a",
      className: "trend-signal--na",
      label: "No trend",
      detail: "",
    };
  }

  const absValue = Math.abs(value);

  if (absValue < 0.0008) {
    return {
      symbol: "\u2192",
      className: "trend-signal--neutral",
      label: "Neutral",
      detail: "",
    };
  }

  if (value >= 0.003) {
    return {
      symbol: "\u2191",
      className: "trend-signal--strong-up",
      label: "Big increase",
      detail: "",
    };
  }

  if (value > 0) {
    return {
      symbol: "\u2197",
      className: "trend-signal--up",
      label: "Moderate increase",
      detail: "",
    };
  }

  if (value <= -0.003) {
    return {
      symbol: "\u2193",
      className: "trend-signal--strong-down",
      label: "Big decrease",
      detail: "",
    };
  }

  return {
    symbol: "\u2198",
    className: "trend-signal--down",
    label: "Moderate decrease",
    detail: "",
  };
}

function createTrendSignalElement(signal) {
  const el = document.createElement("span");
  el.textContent = signal.symbol;
  el.className = `trend-signal ${signal.className}`;
  el.setAttribute("aria-label", signal.label);
  return el;
}

function formatWithText(withCard) {
  if (!withCard) return "n/a";
  return `${formatPercentFromRatio(withCard.conversionRate)} (${withCard.topCuts}/${withCard.totalEntries})`;
}

function formatInclusionText(withTotal, withoutTotal) {
  const included = Number(withTotal);
  const excluded = Number(withoutTotal);

  if (!Number.isFinite(included) || !Number.isFinite(excluded)) return "n/a";

  const total = included + excluded;
  if (total <= 0) return "n/a";

  return `${formatPercentFromRatio(included / total)} (${included}/${total})`;
}

function computeInclusionValue(withCard, withoutCard) {
  const withTotal = Number(withCard?.totalEntries ?? 0);
  const withoutTotal = Number(withoutCard?.totalEntries ?? 0);

  if (!Number.isFinite(withTotal) || !Number.isFinite(withoutTotal)) return null;

  const total = withTotal + withoutTotal;
  if (total <= 0) return null;

  return withTotal / total;
}

function parseIsoDate(value) {
  if (!value) return null;
  const parsed = new Date(`${value}T00:00:00Z`);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function computeCardAgeMonths(firstReleasedAt) {
  const releaseDate = parseIsoDate(firstReleasedAt);
  if (!releaseDate) return null;

  const now = new Date();
  const diffMs = now.getTime() - releaseDate.getTime();
  if (!Number.isFinite(diffMs) || diffMs < 0) return 0;

  return diffMs / (30.4375 * 24 * 60 * 60 * 1000);
}

function toBucketCounts(withCard, withoutCard) {
  const withEntries = Number(withCard?.totalEntries ?? 0);
  const withoutEntries = Number(withoutCard?.totalEntries ?? 0);
  const withTopCuts = Number(withCard?.topCuts ?? 0);

  if (
    ![withEntries, withoutEntries, withTopCuts].every((value) => Number.isFinite(value)) ||
    withEntries < 0 ||
    withoutEntries < 0 ||
    withTopCuts < 0 ||
    withTopCuts > withEntries
  ) {
    return null;
  }

  return {
    withEntries,
    withoutEntries,
    withTopCuts,
  };
}

function subtractBucketCounts(upper, lower) {
  if (!upper) return null;
  if (!lower) return { ...upper };

  const withEntries = upper.withEntries - lower.withEntries;
  const withoutEntries = upper.withoutEntries - lower.withoutEntries;
  const withTopCuts = upper.withTopCuts - lower.withTopCuts;

  if (
    ![withEntries, withoutEntries, withTopCuts].every((value) => Number.isFinite(value)) ||
    withEntries < 0 ||
    withoutEntries < 0 ||
    withTopCuts < 0 ||
    withTopCuts > withEntries
  ) {
    return null;
  }

  return {
    withEntries,
    withoutEntries,
    withTopCuts,
  };
}

function computeWeightedSlope(points) {
  const validPoints = points.filter(
    (point) =>
      typeof point?.x === "number" &&
      Number.isFinite(point.x) &&
      typeof point?.y === "number" &&
      Number.isFinite(point.y) &&
      typeof point?.w === "number" &&
      Number.isFinite(point.w) &&
      point.w > 0
  );

  if (validPoints.length < 2) return null;

  const totalWeight = validPoints.reduce((sum, point) => sum + point.w, 0);
  if (totalWeight <= 0) return null;

  const weightedX = validPoints.reduce((sum, point) => sum + point.w * point.x, 0) / totalWeight;
  const weightedY = validPoints.reduce((sum, point) => sum + point.w * point.y, 0) / totalWeight;
  const denominator = validPoints.reduce(
    (sum, point) => sum + point.w * (point.x - weightedX) * (point.x - weightedX),
    0
  );

  if (denominator <= 0) return null;

  return (
    validPoints.reduce(
      (sum, point) => sum + point.w * (point.x - weightedX) * (point.y - weightedY),
      0
    ) / denominator
  );
}

function computeDeltaValue(withCard, withoutCard) {
  if (!withCard || !withoutCard) return null;

  const withTotal = Number(withCard.totalEntries);
  const withoutTotal = Number(withoutCard.totalEntries);
  if (!Number.isFinite(withTotal) || !Number.isFinite(withoutTotal)) return null;
  if (withTotal <= 0 || withoutTotal <= 0) return null;

  const withRate = withCard.conversionRate;
  const withoutRate = withoutCard.conversionRate;
  if (typeof withRate !== "number" || typeof withoutRate !== "number") return null;

  return (withRate - withoutRate) * 100;
}

function computeCommanderConversionValue(withCard, withoutCard) {
  const withTotal = Number(withCard?.totalEntries ?? 0);
  const withoutTotal = Number(withoutCard?.totalEntries ?? 0);
  const withTopCuts = Number(withCard?.topCuts ?? 0);
  const withoutTopCuts = Number(withoutCard?.topCuts ?? 0);

  if (
    ![withTotal, withoutTotal, withTopCuts, withoutTopCuts].every(
      (value) => Number.isFinite(value)
    )
  ) {
    return null;
  }

  const totalEntries = withTotal + withoutTotal;
  if (totalEntries <= 0) return null;

  return (withTopCuts + withoutTopCuts) / totalEntries;
}

function normalCdf(z) {
  const t = 1 / (1 + 0.2316419 * z);
  const d = 0.3989423 * Math.exp(-(z * z) / 2);
  const probability =
    d *
    t *
    (0.3193815 +
      t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274))));

  return 1 - probability;
}

function computePValue(withCard, withoutCard) {
  if (!withCard || !withoutCard) return null;

  const n1 = Number(withCard.totalEntries);
  const n2 = Number(withoutCard.totalEntries);
  const x1 = Number(withCard.topCuts);
  const x2 = Number(withoutCard.topCuts);

  if (![n1, n2, x1, x2].every((value) => Number.isFinite(value))) return null;
  if (n1 === 0 || n2 === 0) return null;
  if (n1 < 5 || n2 < 5) return null;

  const pooledRate = (x1 + x2) / (n1 + n2);
  const standardError = Math.sqrt(pooledRate * (1 - pooledRate) * (1 / n1 + 1 / n2));
  if (standardError === 0) return null;

  const zScore = x1 / n1 - x2 / n2;
  const pValue = 2 * (1 - normalCdf(Math.abs(zScore / standardError)));
  return Number.isFinite(pValue) ? pValue : null;
}

function getSignificanceLabel(pValue, withTotal, withoutTotal) {
  if (withTotal === 0 || withoutTotal === 0) return "n/a";
  if (withTotal < 5 || withoutTotal < 5) return "Low sample";
  if (typeof pValue !== "number" || !Number.isFinite(pValue)) return "n/a";
  return pValue < SIGNIFICANCE_THRESHOLD ? "Yes (p<0.05)" : "No";
}

function buildCardStats(withCard, withoutCard) {
  const withTotal = Number(withCard?.totalEntries ?? 0);
  const withoutTotal = Number(withoutCard?.totalEntries ?? 0);
  const withTopCuts = Number(withCard?.topCuts ?? 0);
  const withoutTopCuts = Number(withoutCard?.topCuts ?? 0);
  const pValue = computePValue(withCard, withoutCard);
  const deltaValue = computeDeltaValue(withCard, withoutCard);
  const inclusionValue = computeInclusionValue(withCard, withoutCard);
  const commanderConversionRate = computeCommanderConversionValue(withCard, withoutCard);

  return {
    withText: formatWithText(withCard),
    withRate:
      typeof withCard?.conversionRate === "number" && Number.isFinite(withCard.conversionRate)
        ? withCard.conversionRate
        : null,
    withTotal: Number.isFinite(withTotal) ? withTotal : 0,
    withoutTotal: Number.isFinite(withoutTotal) ? withoutTotal : 0,
    withTopCuts: Number.isFinite(withTopCuts) ? withTopCuts : 0,
    withoutTopCuts: Number.isFinite(withoutTopCuts) ? withoutTopCuts : 0,
    inclusionValue,
    inclusionRate: formatInclusionText(withTotal, withoutTotal),
    commanderConversionRate,
    deltaValue,
    deltaText: formatPercentValue(deltaValue),
    pValue,
    significant: getSignificanceLabel(pValue, withTotal, withoutTotal),
    isSignificant: typeof pValue === "number" && pValue < SIGNIFICANCE_THRESHOLD,
  };
}

function buildErrorStats() {
  return {
    withText: "Error",
    withRate: null,
    withTotal: null,
    withoutTotal: null,
    withTopCuts: null,
    withoutTopCuts: null,
    inclusionValue: null,
    inclusionRate: "Error",
    commanderConversionRate: null,
    deltaValue: null,
    deltaText: "Error",
    pValue: null,
    significant: "Error",
    isSignificant: false,
  };
}

function buildTrendStats(statsByPeriod, firstReleasedAt) {
  const ageMonths = computeCardAgeMonths(firstReleasedAt);
  const hasKnownAge = typeof ageMonths === "number" && Number.isFinite(ageMonths);

  if (hasKnownAge && ageMonths < 3) {
    return {
      inclusionSlope: null,
      conversionSlope: null,
      ageMonths,
      validBucketCount: 0,
    };
  }

  const points = TREND_BUCKETS.map((bucket) => {
    if (hasKnownAge && ageMonths < bucket.minAgeMonths) return null;

    const upperStats = statsByPeriod.get(bucket.upper) || null;
    const lowerStats = bucket.lower ? statsByPeriod.get(bucket.lower) || null : null;
    const upperCounts = toBucketCounts(upperStats?.withCard || null, upperStats?.withoutCard || null);
    const lowerCounts = bucket.lower
      ? toBucketCounts(lowerStats?.withCard || null, lowerStats?.withoutCard || null)
      : null;
    const bucketCounts = subtractBucketCounts(upperCounts, lowerCounts);

    if (!bucketCounts) return null;

    const inclusionRate =
      bucketCounts.withEntries + bucketCounts.withoutEntries > 0
        ? bucketCounts.withEntries / (bucketCounts.withEntries + bucketCounts.withoutEntries)
        : null;
    const conversionRate =
      bucketCounts.withEntries > 0 ? bucketCounts.withTopCuts / bucketCounts.withEntries : null;

    return {
      ageMonths: bucket.ageMonths,
      inclusionRate,
      inclusionWeight: bucketCounts.withEntries + bucketCounts.withoutEntries,
      conversionRate,
      conversionWeight: bucketCounts.withEntries,
    };
  }).filter(Boolean);

  const inclusionSlope = computeWeightedSlope(
    points.map((point) => ({
      x: point.ageMonths,
      y: point.inclusionRate,
      w: point.inclusionWeight,
    }))
  );
  const conversionSlope = computeWeightedSlope(
    points.map((point) => ({
      x: point.ageMonths,
      y: point.conversionRate,
      w: point.conversionWeight,
    }))
  );

  const validBucketCount = points.filter(
    (point) =>
      (typeof point.inclusionRate === "number" && Number.isFinite(point.inclusionRate)) ||
      (typeof point.conversionRate === "number" && Number.isFinite(point.conversionRate))
  ).length;

  return {
    inclusionSlope: typeof inclusionSlope === "number" ? -inclusionSlope : null,
    conversionSlope: typeof conversionSlope === "number" ? -conversionSlope : null,
    ageMonths,
    validBucketCount,
  };
}

function buildErrorTrendStats() {
  return {
    inclusionSlope: null,
    conversionSlope: null,
    ageMonths: null,
    validBucketCount: 0,
  };
}

function shouldHideFromMainTable(stats) {
  if (!stats) return false;
  if (typeof stats.inclusionValue === "number" && stats.inclusionValue > 0.75) return true;
  return false;
}

function createCardLink(name, commander) {
  const link = document.createElement("a");
  link.textContent = name;
  link.href = `https://edhtop16.com/commander/${encodeURIComponent(commander)}?tab=card&card=${encodeURIComponent(name)}`;
  link.target = "_blank";
  link.rel = "noopener noreferrer";
  return link;
}

function appendStatsRow(target, entry, stats, trendStats, commander) {
  const row = document.createElement("tr");

  if (stats?.isSignificant) {
    const deltaValue = stats.deltaValue ?? 0;
    row.classList.add(deltaValue >= 0 ? "sig-pos" : "sig-neg");
    row.title =
      `Statistically significant ${deltaValue >= 0 ? "positive" : "negative"} impact ` +
      `(p<0.05) based on ${getTimePeriodLabel(selectedTimePeriod)} EDHTop16 conversion rates.`;
  }

  const cardCell = document.createElement("td");
  if (commander) {
    cardCell.appendChild(createCardLink(entry.name, commander));
  } else {
    cardCell.textContent = entry.name;
  }

  const playRateCell = document.createElement("td");
  if (stats) {
    playRateCell.textContent = stats.inclusionRate;
    const inclusionTrendSignal = classifyTrendSignal(trendStats?.inclusionSlope);
    playRateCell.append(" ", createTrendSignalElement(inclusionTrendSignal));
  } else {
    playRateCell.textContent = "Loading...";
  }

  const winRateCell = document.createElement("td");
  if (stats) {
    winRateCell.textContent = stats.withText;
    const conversionTrendSignal = classifyTrendSignal(trendStats?.conversionSlope);
    winRateCell.append(" ", createTrendSignalElement(conversionTrendSignal));
  } else {
    winRateCell.textContent = "Loading...";
  }

  const impactCell = document.createElement("td");
  impactCell.textContent = stats ? stats.deltaText : "Loading...";

  row.append(cardCell, playRateCell, winRateCell, impactCell);
  target.appendChild(row);
}

function getTableSortValue(row, metric) {
  if (metric === "inclusionTrend") {
    return typeof row.trendStats?.inclusionSlope === "number" &&
      Number.isFinite(row.trendStats.inclusionSlope)
      ? row.trendStats.inclusionSlope
      : -Infinity;
  }

  if (metric === "conversionTrend") {
    return typeof row.trendStats?.conversionSlope === "number" &&
      Number.isFinite(row.trendStats.conversionSlope)
      ? row.trendStats.conversionSlope
      : -Infinity;
  }

  if (metric === "inclusion") return row.inclusionValue;
  if (metric === "winrate") return row.winRateValue;
  return row.deltaValue;
}

function renderStatsTable(entries, statsMap, trendMap, commander, metric = "delta", direction = "desc") {
  statsTableEl.innerHTML = "";

  const rows = entries
    .map((entry) => {
      const stats = statsMap.get(entry.name) || null;
      const trendStats = trendMap.get(entry.name) || null;

      return {
        entry,
        stats,
        trendStats,
        deltaValue: stats?.deltaValue ?? 0,
        inclusionValue:
          typeof stats?.inclusionValue === "number" && Number.isFinite(stats.inclusionValue)
            ? stats.inclusionValue
            : -Infinity,
        winRateValue:
          typeof stats?.withRate === "number" && Number.isFinite(stats.withRate)
            ? stats.withRate
            : -Infinity,
      };
    })
    .filter((row) => !shouldHideFromMainTable(row.stats));

  rows
    .sort((a, b) => {
      const aValue = getTableSortValue(a, metric);
      const bValue = getTableSortValue(b, metric);

      if (direction === "asc") {
        return aValue - bValue || a.entry.name.localeCompare(b.entry.name);
      }

      return bValue - aValue || a.entry.name.localeCompare(b.entry.name);
    })
    .forEach(({ entry, stats, trendStats }) =>
      appendStatsRow(statsTableEl, entry, stats, trendStats, commander)
    );
}

function clearTakeawayLists() {
  if (hottestTechListEl) hottestTechListEl.innerHTML = "";
  if (stinkersListEl) stinkersListEl.innerHTML = "";
  if (exclusionsListEl) exclusionsListEl.innerHTML = "";
}

function appendTakeawayItem(target, item, commander) {
  if (!target) return;

  const wrapper = document.createElement("div");
  wrapper.className = "takeaway-item";

  const link = createCardLink(item.name, commander);

  const detail = document.createElement("p");
  detail.className = "takeaway-detail";
  detail.textContent = item.detail;

  wrapper.append(link, detail);
  target.appendChild(wrapper);
}

function formatTakeawayRateDetail(includeText, impactText, suffix = "") {
  const suffixText = suffix ? ` ${suffix}` : "";
  return `Include rate ${includeText} • Impact ${impactText}${suffixText}`;
}

function formatTakeawayIncludeRate(stats) {
  return formatPercentFromRatio(stats?.inclusionValue);
}

function formatTakeawayImpact(stats) {
  return stats?.deltaText || "n/a";
}

function buildImpactTakeaways(direction) {
  if (!currentDeck) return [];

  return currentDeck.mainboard
    .map((entry) => {
      const statsByPeriod = currentTakeawayStats.get(entry.name) || new Map();
      let bestMatch = null;

      TAKEAWAY_PERIODS.forEach((period) => {
        const stats = statsByPeriod.get(period) || null;
        if (!stats?.isSignificant || typeof stats?.pValue !== "number") return;
        if (typeof stats?.inclusionValue === "number" && stats.inclusionValue > 0.75) {
          return;
        }
        if (direction === "positive" ? stats.deltaValue <= 0 : stats.deltaValue >= 0) return;

        const candidate = {
          name: entry.name,
          period,
          stats,
        };

        if (!bestMatch) {
          bestMatch = candidate;
          return;
        }

        if (candidate.stats.pValue < bestMatch.stats.pValue) {
          bestMatch = candidate;
          return;
        }

        if (
          candidate.stats.pValue === bestMatch.stats.pValue &&
          getTimePeriodRank(candidate.period) > getTimePeriodRank(bestMatch.period)
        ) {
          bestMatch = candidate;
        }
      });

      return bestMatch;
    })
    .filter(Boolean)
    .sort((a, b) => {
      if (a.stats.pValue !== b.stats.pValue) return a.stats.pValue - b.stats.pValue;

      if (direction === "positive") {
        return b.stats.deltaValue - a.stats.deltaValue || a.name.localeCompare(b.name);
      }

      return a.stats.deltaValue - b.stats.deltaValue || a.name.localeCompare(b.name);
    })
    .slice(0, 5)
    .map(({ name, period, stats }) => ({
      name,
      detail: `${formatTakeawayRateDetail(
        formatTakeawayIncludeRate(stats),
        formatTakeawayImpact(stats)
      )} (${getTimePeriodLabel(period)})`,
    }));
}

function buildExclusionTakeaways() {
  return [...currentMissingStaples]
    .sort((a, b) => b.playRate - a.playRate || a.name.localeCompare(b.name))
    .map((item) => ({
      name: item.name,
      detail: formatTakeawayRateDetail(
        `${item.playRate.toFixed(1)}%`,
        item.impactText || "n/a",
        `(${getTimePeriodLabel(EXCLUSION_COMPARISON_PERIOD)})`
      ),
    }));
}

function buildDeckComparisonTakeaway() {
  if (!currentDeck) return null;

  const eligibleStats = currentDeck.mainboard
    .map((entry) => currentTakeawayStats.get(entry.name)?.get(DECK_SUMMARY_PERIOD) || null)
    .filter(
      (stats) =>
        typeof stats?.withRate === "number" &&
        Number.isFinite(stats.withRate) &&
        stats.withRate > 0 &&
        typeof stats?.inclusionValue === "number" &&
        Number.isFinite(stats.inclusionValue) &&
        stats.inclusionValue > 0
    );

  const conversionRates = eligibleStats.map((stats) => stats.withRate);

  if (conversionRates.length === 0) return null;

  const commanderStats = eligibleStats.find(
    (stats) =>
      typeof stats?.commanderConversionRate === "number" &&
      Number.isFinite(stats.commanderConversionRate)
  );

  if (!commanderStats) return null;

  const deckAverage = conversionRates.reduce((sum, value) => sum + value, 0) / conversionRates.length;
  const commanderAverage = commanderStats.commanderConversionRate;
  const delta = (deckAverage - commanderAverage) * 100;

  return {
    deckAverage,
    commanderAverage,
    delta,
    period: DECK_SUMMARY_PERIOD,
    sampleSize: conversionRates.length,
  };
}

function buildDeckPlayRateTakeaway() {
  if (!currentDeck) return null;

  const inclusionRates = currentDeck.mainboard
    .map((entry) => currentTakeawayStats.get(entry.name)?.get(DECK_SUMMARY_PERIOD) || null)
    .filter(
      (stats) =>
        typeof stats?.inclusionValue === "number" && Number.isFinite(stats.inclusionValue)
    )
    .map((stats) => stats.inclusionValue);

  if (inclusionRates.length === 0) return null;

  const averagePlayRate =
    inclusionRates.reduce((sum, value) => sum + value, 0) / inclusionRates.length;

  return {
    averagePlayRate,
    period: DECK_SUMMARY_PERIOD,
    sampleSize: inclusionRates.length,
  };
}

function renderTakeaways() {
  const deckComparison = buildDeckComparisonTakeaway();
  const deckPlayRate = buildDeckPlayRateTakeaway();
  const standouts = buildImpactTakeaways("positive");
  const stinkers = buildImpactTakeaways("negative");
  const exclusions = buildExclusionTakeaways();
  const showLowDataBanner =
    typeof currentCommanderEntriesSixMonths === "number" &&
    currentCommanderEntriesSixMonths < MIN_COMMANDER_ENTRIES_FOR_SUMMARY;

  clearTakeawayLists();
  setLowDataBannerVisible(showLowDataBanner);

  if (lowDataBannerTextEl && showLowDataBanner) {
    lowDataBannerTextEl.textContent =
      `There isn't much EDHTop16 data available for this commander: only ` +
      `${currentCommanderEntriesSixMonths} entries in the last 6 months.`;
  }

  setTakeawayBlockVisible(deckComparisonBlockEl, !showLowDataBanner && !!deckComparison);
  setTakeawayBlockVisible(deckPlayRateBlockEl, !showLowDataBanner && !!deckPlayRate);
  setTakeawayBlockVisible(hottestTechBlockEl, !showLowDataBanner && standouts.length > 0);
  setTakeawayBlockVisible(stinkersBlockEl, !showLowDataBanner && stinkers.length > 0);
  setTakeawayBlockVisible(exclusionsBlockEl, !showLowDataBanner && exclusions.length > 0);
  setTakeawaysSectionVisible(
    showLowDataBanner ||
      !!deckComparison ||
      !!deckPlayRate ||
      standouts.length > 0 ||
      stinkers.length > 0 ||
      exclusions.length > 0
  );

  if (showLowDataBanner) return;

  if (deckComparisonTextEl && deckComparison) {
    deckComparisonTextEl.textContent =
      `Cards in this decklist average ${formatPercentFromRatio(deckComparison.deckAverage)} conversion versus ` +
      `${formatPercentFromRatio(deckComparison.commanderAverage)} for the commander overall ` +
      `(${formatPercentValue(deckComparison.delta)} over ${getTimePeriodLabel(deckComparison.period)}).`;
  }

  if (deckPlayRateTextEl && deckPlayRate) {
    deckPlayRateTextEl.textContent =
      `Cards in this decklist average ${formatPercentFromRatio(deckPlayRate.averagePlayRate)} play rate over ` +
      `${getTimePeriodLabel(deckPlayRate.period)}.`;
  }

  standouts.forEach((item) => appendTakeawayItem(hottestTechListEl, item, currentCommander));
  stinkers.forEach((item) => appendTakeawayItem(stinkersListEl, item, currentCommander));
  exclusions.forEach((item) => appendTakeawayItem(exclusionsListEl, item, currentCommander));
}

async function fetchJson(url, errorPrefix) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`${errorPrefix} ${response.status}`);
  }

  const data = await response.json();
  if (data?.error) {
    throw new Error(data.error);
  }

  return data;
}

async function fetchCardStat(commander, cardName, timePeriod) {
  const params = new URLSearchParams({
    commander,
    card: cardName,
    timePeriod,
  });

  const data = await fetchJson(`/api/edhtop16?${params.toString()}`, "EDHTop16 error");
  if (!data?.cardWinrateStats) {
    throw new Error("No card winrate stats returned");
  }

  return data;
}

async function fetchCommanderStaples(commander, timePeriod) {
  const params = new URLSearchParams({
    commander,
    timePeriod,
    minEventSize: String(EDH_MIN_EVENT_SIZE),
    threshold: String(NOTABLE_EXCLUSIONS_FETCH_THRESHOLD),
  });

  const data = await fetchJson(
    `/api/edhtop16-staples?${params.toString()}`,
    "EDHTop16 staples error"
  );

  if (!Array.isArray(data?.cards)) {
    throw new Error("No staples returned");
  }

  return data;
}

async function fetchWithPartnerFallback(fetcher, commander, ...args) {
  const swappedCommander = swapPartnerOrder(commander);

  try {
    const data = await fetcher(commander, ...args);
    return { data, usedCommander: commander };
  } catch (error) {
    if (!swappedCommander || swappedCommander === commander) {
      throw error;
    }

    const data = await fetcher(swappedCommander, ...args);
    return { data, usedCommander: swappedCommander };
  }
}

function resetTakeaways() {
  currentTakeawayStats = new Map();
  currentMissingStaples = [];
  currentCommanderEntriesSixMonths = null;
  clearTakeawayLists();
  setLowDataBannerVisible(false);
  setTakeawaysSectionVisible(false);
  setTakeawaysStatus("");
}

function updateCommanderDisplay(commander) {
  currentCommander = commander;
  deckIdEl.textContent = commander || "";
}

function updateDeckOwnerDisplay(deck) {
  if (!deckOwnerLinkEl) return;

  const owner = getDeckOwnerInfo(deck);
  deckOwnerLinkEl.textContent = owner.name;

  if (owner.url) {
    deckOwnerLinkEl.href = owner.url;
    deckOwnerLinkEl.removeAttribute("aria-disabled");
  } else {
    deckOwnerLinkEl.removeAttribute("href");
    deckOwnerLinkEl.setAttribute("aria-disabled", "true");
  }
}

async function exportSummaryCard() {
  if (!takeawaysSectionEl || takeawaysSectionEl.hidden) return;
  if (!window.htmlToImage?.toPng) {
    setTakeawaysStatus("Export library not available.", true);
    return;
  }

  const originalButtonText = exportSummaryBtnEl?.textContent || "Export PNG";

  try {
    if (exportSummaryBtnEl) {
      exportSummaryBtnEl.disabled = true;
      exportSummaryBtnEl.textContent = "Exporting...";
    }

    takeawaysSectionEl.classList.add("summary-card--exporting");

    const dataUrl = await window.htmlToImage.toPng(takeawaysSectionEl, {
      cacheBust: true,
      backgroundColor: "#141923",
      pixelRatio: 2.5,
    });

    const link = document.createElement("a");
    link.href = dataUrl;
    link.download = `${sanitizeFilename(deckNameEl?.textContent)}-summary.png`;
    link.click();

    setTakeawaysStatus("Summary exported.");
  } catch (error) {
    setTakeawaysStatus(`Could not export summary. ${error.message}`, true);
  } finally {
    takeawaysSectionEl.classList.remove("summary-card--exporting");

    if (exportSummaryBtnEl) {
      exportSummaryBtnEl.disabled = false;
      exportSummaryBtnEl.textContent = originalButtonText;
    }
  }
}

async function loadMissingStaples() {
  if (!currentDeck || !currentCommander) {
    setTakeawaysSectionVisible(false);
    setTakeawaysStatus("Load a deck first.", true);
    return;
  }

  setTakeawaysStatus("");
  currentMissingStaples = [];

  try {
    const result = await fetchWithPartnerFallback(
      fetchCommanderStaples,
      currentCommander,
      selectedTimePeriod
    );

    if (result.usedCommander !== currentCommander) {
      updateCommanderDisplay(result.usedCommander);
    }

    const deckCards = new Set([
      ...currentDeck.mainboard.map((entry) => normalizeCardName(entry.name)),
      ...currentDeck.commanders.map((entry) => normalizeCardName(entry.name)),
    ]);

    const missingCards = result.data.cards.filter(
      (card) => !deckCards.has(normalizeCardName(card.name))
    );

    const topMissingCards = [...missingCards]
      .sort((a, b) => b.playRate - a.playRate || a.name.localeCompare(b.name))
      .slice(0, 3);

    const exclusionStatResults = await Promise.allSettled(
      topMissingCards.map(async (card) => {
        const exclusionResult = await fetchWithPartnerFallback(
          fetchCardStat,
          currentCommander,
          card.name,
          EXCLUSION_COMPARISON_PERIOD
        );

        return {
          card,
          usedCommander: exclusionResult.usedCommander,
          stats: buildCardStats(
            exclusionResult.data?.cardWinrateStats?.withCard || null,
            exclusionResult.data?.cardWinrateStats?.withoutCard || null
          ),
        };
      })
    );

    currentMissingStaples = topMissingCards.map((card) => {
      const statResult = exclusionStatResults.find(
        (result) => result.status === "fulfilled" && result.value.card.name === card.name
      );

      if (statResult?.status === "fulfilled" && statResult.value.usedCommander !== currentCommander) {
        updateCommanderDisplay(statResult.value.usedCommander);
      }

      return {
        ...card,
        impactText:
          statResult?.status === "fulfilled"
            ? formatTakeawayImpact(statResult.value.stats)
            : "n/a",
      };
    });

    renderTakeaways();
  } catch (error) {
    currentMissingStaples = [];
    renderTakeaways();
    setTakeawaysSectionVisible(true);
    setTakeawaysStatus(`Could not load missing staples. ${error.message}`, true);
  }
}

async function loadDeck() {
  const deckId = extractDeckId(document.getElementById("deckInput").value);
  if (!deckId) {
    setStatus("Enter a Moxfield deck link or public ID.", true);
    return;
  }

  setStatus("Loading deck data...");
  setResultsVisible(false);

  try {
    const data = await fetchJson(`/api/deck?id=${encodeURIComponent(deckId)}`, "Request failed:");
    const commanders = formatEntries(data.commanders || {}, false);
    const mainboard = formatEntries(data.mainboard || {});

    currentDeck = { ...data, commanders, mainboard };
    currentStats = new Map();
    currentTrends = new Map();
    resetTakeaways();

    deckNameEl.textContent = data.name || "Untitled deck";
    updateCommanderDisplay(commanders.map((entry) => entry.name).join(" / "));
    updateDeckOwnerDisplay(data);

    setResultsVisible(true);
    renderStatsTable(mainboard, currentStats, currentTrends, currentCommander, sortMetric, sortDirection);

    setStatus("Loaded.");
    await loadEdhStats();
  } catch (error) {
    setResultsVisible(false);
    setStatus(`Could not load deck. ${error.message}`, true);
  }
}

async function loadEdhStats({ reloadTakeaways = true } = {}) {
  if (!currentDeck) {
    setStatsStatus("Load a deck first.", true);
    return;
  }

  const originalCommander = currentDeck.commanders.map((entry) => entry.name).join(" / ");
  if (!originalCommander) {
    setStatsStatus("Enter the commander name used on EDHTop16.", true);
    return;
  }

  currentCommander = originalCommander;
  currentStats = new Map();
  currentTrends = new Map();
  if (reloadTakeaways) {
    currentTakeawayStats = new Map();
    currentCommanderEntriesSixMonths = null;
  }

  const cards = currentDeck.mainboard.map((entry) => entry.name);
  const concurrency = 3;
  let nextIndex = 0;
  let completed = 0;
  let commanderResolved = false;

  setStatsStatus(`Loaded 0/${cards.length} cards.`);

  if (cards.length > 0) {
    try {
      const dataCheckResult = await fetchWithPartnerFallback(
        fetchCardStat,
        originalCommander,
        cards[0],
        "SIX_MONTHS"
      );

      if (!commanderResolved && dataCheckResult.usedCommander !== currentCommander) {
        updateCommanderDisplay(dataCheckResult.usedCommander);
        commanderResolved = true;
      }

      currentCommanderEntriesSixMonths = getCommanderEntriesFromStats(
        dataCheckResult.data?.cardWinrateStats?.withCard || null,
        dataCheckResult.data?.cardWinrateStats?.withoutCard || null
      );
    } catch (error) {
      currentCommanderEntriesSixMonths = null;
    }
  }

  async function worker() {
    while (nextIndex < cards.length) {
      const cardName = cards[nextIndex];
      nextIndex += 1;

      try {
        const periodsToLoad = new Set([selectedTimePeriod, ...TREND_PERIODS]);
        if (reloadTakeaways) {
          TAKEAWAY_PERIODS.forEach((period) => periodsToLoad.add(period));
        }

        const periodEntries = await Promise.all(
          Array.from(periodsToLoad).map(async (period) => {
            const result = await fetchWithPartnerFallback(
              fetchCardStat,
              originalCommander,
              cardName,
              period
            );
            return [period, result];
          })
        );
        const periodResults = new Map(periodEntries);
        const selectedResult = periodResults.get(selectedTimePeriod);

        if (!commanderResolved && selectedResult.usedCommander !== currentCommander) {
          updateCommanderDisplay(selectedResult.usedCommander);
          commanderResolved = true;
        }

        const selectedWith = selectedResult.data?.cardWinrateStats?.withCard || null;
        const selectedWithout = selectedResult.data?.cardWinrateStats?.withoutCard || null;
        currentStats.set(cardName, buildCardStats(selectedWith, selectedWithout));

        if (reloadTakeaways) {
          const takeawayStatsByPeriod = new Map();
          takeawayStatsByPeriod.set(selectedTimePeriod, buildCardStats(selectedWith, selectedWithout));
          TAKEAWAY_PERIODS.filter((period) => period !== selectedTimePeriod).forEach((period) => {
            const periodResult = periodResults.get(period);
            const withCard = periodResult?.data?.cardWinrateStats?.withCard || null;
            const withoutCard = periodResult?.data?.cardWinrateStats?.withoutCard || null;
            takeawayStatsByPeriod.set(period, buildCardStats(withCard, withoutCard));
          });

          currentTakeawayStats.set(cardName, takeawayStatsByPeriod);
        }

        const trendStatsByPeriod = new Map();
        TREND_PERIODS.forEach((period) => {
          trendStatsByPeriod.set(period, periodResults.get(period)?.data?.cardWinrateStats || null);
        });

        currentTrends.set(
          cardName,
          buildTrendStats(trendStatsByPeriod, selectedResult.data?.cardMeta?.firstReleasedAt || null)
        );
      } catch (error) {
        currentStats.set(cardName, buildErrorStats());
        currentTrends.set(cardName, buildErrorTrendStats());
      } finally {
        completed += 1;

        if (completed % 10 === 0 || completed === cards.length) {
          setStatsStatus(`Loaded ${completed}/${cards.length} cards.`);
        }

        renderStatsTable(
          currentDeck.mainboard,
          currentStats,
          currentTrends,
          currentCommander,
          sortMetric,
          sortDirection
        );
      }
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, cards.length) }, () => worker()));
  setStatsStatus(`Loaded ${completed}/${cards.length} cards.`);
  if (reloadTakeaways) {
    await loadMissingStaples();
  }
}

function updateSortIndicators() {
  if (!sortHeaderEls.length) return;

  sortHeaderEls.forEach((header) => {
    if (header.dataset.sort === sortMetric) {
      header.dataset.order = sortDirection;
    } else {
      delete header.dataset.order;
    }
  });
}

document.getElementById("loadBtn").addEventListener("click", loadDeck);

document.getElementById("deckInput").addEventListener("keydown", (event) => {
  if (event.key === "Enter") {
    loadDeck();
  }
});

if (timeWindowSelectEl) {
  timeWindowSelectEl.value = selectedTimePeriod;
  timeWindowSelectEl.addEventListener("change", async (event) => {
    selectedTimePeriod = event.target.value;
    if (!currentDeck) return;

    setStatsStatus("Time window changed. Refreshing EDHTop16 stats...");
    await loadEdhStats({ reloadTakeaways: false });
  });
}

if (exportSummaryBtnEl) {
  exportSummaryBtnEl.disabled = true;
  exportSummaryBtnEl.addEventListener("click", exportSummaryCard);
}

if (sortHeaderEls.length > 0) {
  sortHeaderEls.forEach((header) => {
    header.addEventListener("click", () => {
      const metric = header.dataset.sort;
      if (!metric || !currentDeck) return;

      if (sortMetric === metric) {
        sortDirection = sortDirection === "asc" ? "desc" : "asc";
      } else {
        sortMetric = metric;
        sortDirection = "desc";
      }

      renderStatsTable(
        currentDeck.mainboard,
        currentStats,
        currentTrends,
        currentCommander,
        sortMetric,
        sortDirection
      );
      updateSortIndicators();
    });
  });
}

setResultsVisible(false);

updateSortIndicators();
