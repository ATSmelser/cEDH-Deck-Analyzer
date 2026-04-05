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

const RECENT_TREND_PERIOD = "THREE_MONTHS";
const BASELINE_TREND_PERIOD = "ALL_TIME";
const RECENT_TREND_LABEL = "Last 3 months";
const TAKEAWAY_PERIODS = ["THREE_MONTHS", "SIX_MONTHS", "ONE_YEAR"];
const SUMMARY_COMPARISON_PERIOD = "ONE_YEAR";
const TIME_PERIOD_LABELS = {
  THREE_MONTHS: "3 months",
  SIX_MONTHS: "6 months",
  ONE_YEAR: "12 months",
  ALL_TIME: "All time",
};
const NOTABLE_EXCLUSIONS_FETCH_THRESHOLD = 0;
const STAPLES_MIN_EVENT_SIZE = 50;
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

function formatTrendDelta(value) {
  if (typeof value !== "number" || !Number.isFinite(value)) return "n/a";
  const sign = value > 0 ? "+" : "";
  return `${sign}${(value * 100).toFixed(1)}%`;
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

function buildTrendStats(recentWith, recentWithout, baselineWith, baselineWithout) {
  const recentInclusion = computeInclusionValue(recentWith, recentWithout);
  const baselineInclusion = computeInclusionValue(baselineWith, baselineWithout);
  const recentTotal =
    Number(recentWith?.totalEntries ?? 0) + Number(recentWithout?.totalEntries ?? 0);
  const baselineTotal =
    Number(baselineWith?.totalEntries ?? 0) + Number(baselineWithout?.totalEntries ?? 0);

  return {
    recentInclusion,
    baselineInclusion,
    delta:
      typeof recentInclusion === "number" && typeof baselineInclusion === "number"
        ? recentInclusion - baselineInclusion
        : null,
    recentTotal: Number.isFinite(recentTotal) ? recentTotal : 0,
    baselineTotal: Number.isFinite(baselineTotal) ? baselineTotal : 0,
  };
}

function buildErrorTrendStats() {
  return {
    recentInclusion: null,
    baselineInclusion: null,
    delta: null,
    recentTotal: 0,
    baselineTotal: 0,
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
      `(p<0.05) based on ${RECENT_TREND_LABEL} EDHTop16 conversion rates.`;
  }

  const cardCell = document.createElement("td");
  if (commander) {
    cardCell.appendChild(createCardLink(entry.name, commander));
  } else {
    cardCell.textContent = entry.name;
  }

  const playRateCell = document.createElement("td");
  playRateCell.textContent = stats ? stats.inclusionRate : "Loading...";

  const winRateCell = document.createElement("td");
  winRateCell.textContent = stats ? stats.withText : "Loading...";

  const impactCell = document.createElement("td");
  impactCell.textContent = stats ? stats.deltaText : "Loading...";

  const trendCell = document.createElement("td");
  trendCell.textContent =
    trendStats && typeof trendStats.delta === "number"
      ? formatTrendDelta(trendStats.delta)
      : "n/a";

  row.append(cardCell, playRateCell, winRateCell, impactCell, trendCell);
  target.appendChild(row);
}

function getTableSortValue(row, metric) {
  if (metric === "trending") {
    return typeof row.trendStats?.delta === "number" && Number.isFinite(row.trendStats.delta)
      ? row.trendStats.delta
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
        `(${getTimePeriodLabel(SUMMARY_COMPARISON_PERIOD)})`
      ),
    }));
}

function buildDeckComparisonTakeaway() {
  if (!currentDeck) return null;

  const eligibleStats = currentDeck.mainboard
    .map((entry) => currentTakeawayStats.get(entry.name)?.get(SUMMARY_COMPARISON_PERIOD) || null)
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
    period: SUMMARY_COMPARISON_PERIOD,
    sampleSize: conversionRates.length,
  };
}

function buildDeckPlayRateTakeaway() {
  if (!currentDeck) return null;

  const inclusionRates = currentDeck.mainboard
    .map((entry) => currentTakeawayStats.get(entry.name)?.get(SUMMARY_COMPARISON_PERIOD) || null)
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
    period: SUMMARY_COMPARISON_PERIOD,
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
      `${deckComparison.sampleSize} included cards average ` +
      `${formatPercentFromRatio(deckComparison.deckAverage)} conversion versus ` +
      `${formatPercentFromRatio(deckComparison.commanderAverage)} for the commander overall ` +
      `(${formatPercentValue(deckComparison.delta)} over ${getTimePeriodLabel(deckComparison.period)}).`;
  }

  if (deckPlayRateTextEl && deckPlayRate) {
    deckPlayRateTextEl.textContent =
      `${deckPlayRate.sampleSize} included cards average ` +
      `${formatPercentFromRatio(deckPlayRate.averagePlayRate)} play rate over ` +
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
    minEventSize: String(STAPLES_MIN_EVENT_SIZE),
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
          SUMMARY_COMPARISON_PERIOD
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
        const selectedResult = await fetchWithPartnerFallback(
          fetchCardStat,
          originalCommander,
          cardName,
          selectedTimePeriod
        );

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

          const takeawayResults = await Promise.allSettled(
            TAKEAWAY_PERIODS.filter((period) => period !== selectedTimePeriod).map(async (period) => {
              const periodData = (
                await fetchWithPartnerFallback(fetchCardStat, currentCommander, cardName, period)
              ).data;
              return { period, periodData };
            })
          );

          takeawayResults.forEach((result) => {
            if (result.status !== "fulfilled") return;

            const withCard = result.value.periodData?.cardWinrateStats?.withCard || null;
            const withoutCard = result.value.periodData?.cardWinrateStats?.withoutCard || null;
            takeawayStatsByPeriod.set(result.value.period, buildCardStats(withCard, withoutCard));
          });

          currentTakeawayStats.set(cardName, takeawayStatsByPeriod);
        }

        const recentData =
          selectedTimePeriod === RECENT_TREND_PERIOD
            ? selectedResult.data
            : (
                await fetchWithPartnerFallback(
                  fetchCardStat,
                  currentCommander,
                  cardName,
                  RECENT_TREND_PERIOD
                )
              ).data;

        const recentWith = recentData?.cardWinrateStats?.withCard || null;
        const recentWithout = recentData?.cardWinrateStats?.withoutCard || null;

        const baselineData =
          BASELINE_TREND_PERIOD === RECENT_TREND_PERIOD
            ? recentData
            : (
                await fetchWithPartnerFallback(
                  fetchCardStat,
                  currentCommander,
                  cardName,
                  BASELINE_TREND_PERIOD
                )
              ).data;

        const baselineWith = baselineData?.cardWinrateStats?.withCard || null;
        const baselineWithout = baselineData?.cardWinrateStats?.withoutCard || null;
        currentTrends.set(
          cardName,
          buildTrendStats(recentWith, recentWithout, baselineWith, baselineWithout)
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
