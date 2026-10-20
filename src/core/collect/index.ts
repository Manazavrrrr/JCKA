/**
 * Точка входа слоя сбора.
 *
 * Слой отвечает на два вопроса и ни на один больше: откуда берётся поток
 * (sources) и что из него вытаскивается (terms, decision, run). Оценку
 * риска он не трогает — пойманное объявление становится обычной
 * публикацией и дальше идёт тем же путём, что и внесённая вручную:
 * разбор ИИ, гипотезы, решение аналитика.
 */

export {
  COLLECT_SOURCES,
  SOURCE_ACCESS_MODES,
  SOURCE_ACCESS_MODE_HINTS,
  SOURCE_ACCESS_MODE_LABELS,
  autoSources,
  findSource,
  keyRequiredSources,
  manualSources,
  sourceAccessModeSchema,
} from './sources';
export type { CollectSource, SourceAccessMode } from './sources';

export {
  APIFY_ACTOR,
  APIFY_ACTOR_PAGE,
  APIFY_PRICE_CHECKED_ON,
  APIFY_PRICE_NOTE,
  APIFY_PRICE_PER_1000_USD,
  APIFY_TERMS_CAVEAT,
  APIFY_TOKEN_PAGE,
  ApifyParseError,
  DEFAULT_POSTS_LIMIT,
  INSTAGRAM_SOURCE_ID,
  MAX_POSTS_LIMIT,
  apifyRunUrl,
  clampPostsLimit,
  estimateRunCostUsd,
  instagramProfileUrl,
  instagramScraperInput,
  normalizeInstagramAccount,
  parseApifyPosts,
} from './apify';
export type { ApifyParseOptions, ApifyParseProblem, InstagramScraperInput } from './apify';

export {
  MAX_TERM_LENGTH,
  MIN_TERM_LENGTH,
  POSITIVE_CATEGORIES,
  WATCH_TERM_CATEGORIES,
  WATCH_TERM_CATEGORY_HINTS,
  WATCH_TERM_CATEGORY_LABELS,
  WATCH_TERM_LANGUAGES,
  WATCH_TERM_LANGUAGE_LABELS,
  compileTerm,
  distinctTerms,
  hitCategories,
  matchTerms,
  termPatternSource,
  watchTermCategorySchema,
  watchTermInputSchema,
  watchTermLanguageSchema,
} from './terms';
export type { TermHit, WatchTerm, WatchTermCategory, WatchTermInput, WatchTermLanguage } from './terms';

export {
  COLLECT_REASONS,
  COLLECT_REASON_LABELS,
  COLLECT_VERDICTS,
  COLLECT_VERDICT_LABELS,
  DEFAULT_COLLECT_RULE,
  collectReasonSchema,
  collectRuleSchema,
  collectVerdictSchema,
  decide,
  fingerprint,
} from './decision';
export type { CollectDecision, CollectReason, CollectRule, CollectVerdict } from './decision';

export { runCollection } from './run';
export type {
  CollectRunResult,
  CollectStats,
  CollectedItem,
  RawItem,
  RunOptions,
  TermUsage,
} from './run';

export { DEFAULT_WATCH_TERMS } from './defaults';

export {
  DEFAULT_ACTIVE_QUERY_COUNT,
  DEFAULT_HASHTAG_LIMIT,
  DEFAULT_SEARCH_QUERIES,
  GEO_MARKERS,
  HASHTAG_PROBLEM_TEXT,
  MAX_ACTIVE_QUERIES,
  MAX_RESULTS_PER_WALK,
  hasGeoMarker,
  hashtagExploreUrl,
  instagramHashtagInput,
  limitPerTagWithinWalk,
  normalizeHashtag,
  plannedWalkResults,
} from './discovery';
export type { HashtagProblem, HashtagResult, SearchQuerySeed } from './discovery';

export {
  DEFAULT_DAILY_BUDGET_USD,
  LOCAL_UTC_OFFSET_MINUTES,
  MAX_DAILY_BUDGET_USD,
  clampDailyBudgetUsd,
  decideBudget,
  maxAffordableResults,
  spentTodayUsd,
  startOfLocalDay,
} from './budget';
export type { BudgetDecision, BudgetVerdict, SpentRun } from './budget';

export {
  TelegramParseError,
  channelUrl,
  htmlToText,
  normalizeChannel,
  parseTelegramPage,
} from './telegram';
export type { TelegramParseOptions, TelegramParseProblem } from './telegram';
