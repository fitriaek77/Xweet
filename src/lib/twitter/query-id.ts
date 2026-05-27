// src/lib/twitter/query-id.ts
// 5-layer queryId resolution chain:
//   Layer 1: In-memory cache (instant, QUERY_ID_CACHE_MS = 4h TTL)
//   Layer 2: GraphQL.json (develop branch, CDN, ~0ms)
//   Layer 3: GraphQL.json (master branch, CDN, ~0ms)
//   Layer 4: placeholder.json + ondemand chunk (live, ~500ms)
//   Layer 5: FALLBACK_QUERY_IDS (hardcoded, 0ms)
//
// Each layer fills gaps left by previous layers.
// On-demand chunk parsing (ondemand.s.*.js from x.com HTML) was considered
// for Layer 4 but skipped — too complex and fragile. Layer 5 covers the
// 3 scheduled-tweet ops that placeholder.json lacks.

import {
  FA0311_RAW_BASE,
  FA0311_JSDELIVR_BASE,
  QUERY_ID_CACHE_MS,
  FALLBACK_QUERY_IDS,
  GRAPHQL_JSON_DEVELOP_URL,
  GRAPHQL_JSON_MASTER_URL,
  GRAPHQL_JSON_CACHE_MS,
} from "@/config/constants";

// ─── Public types ───

/** Query IDs for X GraphQL operations. */
export interface QueryIds {
  CreateTweet: string;
  CreateScheduledTweet: string;
  FetchScheduledTweets: string;
  EditScheduledTweet: string;
  DeleteScheduledTweet: string;
}

// ─── Internal types ───

/** placeholder.json shape — only CreateTweet and FetchScheduledTweets are
 *  reliably present; the 3 scheduled ops are usually absent. */
interface PlaceholderJson {
  CreateTweet?: { queryId: string };
  CreateScheduledTweet?: { queryId: string };
  FetchScheduledTweets?: { queryId: string };
  EditScheduledTweet?: { queryId: string };
  DeleteScheduledTweet?: { queryId: string };
}

/** All operation names we resolve, in a fixed order. */
const OP_NAMES = [
  "CreateTweet",
  "CreateScheduledTweet",
  "FetchScheduledTweets",
  "EditScheduledTweet",
  "DeleteScheduledTweet",
] as const;

type _OpName = (typeof OP_NAMES)[number];

// ─── Layer 1: In-memory result cache ───

let cachedQueryIds: QueryIds | null = null;
let cachedAt = 0;

// ─── Layers 2 & 3: GraphQL.json parsed cache ───
// Separate from the main result cache so that a 4h result expiry doesn't
// force a re-fetch of GraphQL.json from CDN (6h TTL).

let graphqlJsonMap: Map<string, string> | null = null;
let graphqlJsonCachedAt = 0;

// ─── Helper: safe JSON fetch with AbortSignal.timeout(5000) ───

async function safeFetchJson(url: string): Promise<unknown | null> {
  try {
    const resp = await fetch(url, { signal: AbortSignal.timeout(5000) });
    if (!resp.ok) return null;
    return await resp.json();
  } catch {
    return null;
  }
}

// ─── Layers 2 & 3: GraphQL.json ───

/**
 * Parse a GraphQL.json array into a Map<operationName, queryId>.
 * Null-safe: every access is guarded per the task spec.
 */
function parseGraphQLJson(
  data: unknown,
  label: string,
): Map<string, string> | null {
  if (!Array.isArray(data)) {
    process.stderr.write(`[QueryID] ${label} is not an array\n`);
    return null;
  }

  const map = new Map<string, string>();
  for (const opName of OP_NAMES) {
    const entry = (data as Record<string, unknown>[]).find((e) => {
      const obj = e;
      const exp = obj.exports as Record<string, unknown> | undefined;
      return exp != null && exp.operationName === opName;
    });
    const entryExports = entry != null
      ? (entry).exports as Record<string, unknown> | undefined
      : undefined;
    const queryId = entryExports != null ? entryExports.queryId : undefined;
    if (typeof queryId === "string") {
      map.set(opName, queryId);
    } else {
      process.stderr.write(`[QueryID] ${label} missing ${opName}\n`);
    }
  }

  if (map.size === 0) {
    process.stderr.write(`[QueryID] ${label} contains no matching operations\n`);
    return null;
  }

  return map;
}

/** Fetch and parse GraphQL.json from a single URL. */
async function fetchGraphQLJson(
  url: string,
  label: string,
): Promise<Map<string, string> | null> {
  const data = await safeFetchJson(url);
  if (data === null) {
    process.stderr.write(`[QueryID] ${label} fetch failed\n`);
    return null;
  }
  return parseGraphQLJson(data, label);
}

/**
 * Get the merged GraphQL.json map, using the 6h cache when fresh.
 * Tries develop (Layer 2) then master (Layer 3), each with jsDelivr
 * fallback. Results are merged to fill gaps.
 */
async function getGraphQLJsonMap(): Promise<Map<string, string>> {
  // Return cached if fresh (6h TTL)
  if (graphqlJsonMap && Date.now() - graphqlJsonCachedAt < GRAPHQL_JSON_CACHE_MS) {
    return graphqlJsonMap;
  }

  const merged = new Map<string, string>();

  // Sources in priority order: Layer 2 → Layer 3, each with jsDelivr CDN fallback
  const sources: Array<{ url: string; label: string }> = [
    {
      url: GRAPHQL_JSON_DEVELOP_URL,
      label: "GraphQL.json(develop)",
    },
    {
      url: "https://cdn.jsdelivr.net/gh/fa0311/TwitterInternalAPIDocument@develop/docs/json/GraphQL.json",
      label: "GraphQL.json(develop-jsdelivr)",
    },
    {
      url: GRAPHQL_JSON_MASTER_URL,
      label: "GraphQL.json(master)",
    },
    {
      url: "https://cdn.jsdelivr.net/gh/fa0311/TwitterInternalAPIDocument@master/docs/json/GraphQL.json",
      label: "GraphQL.json(master-jsdelivr)",
    },
  ];

  for (const { url, label } of sources) {
    // All 5 ops found — no need to try further sources
    if (merged.size === OP_NAMES.length) break;

    const result = await fetchGraphQLJson(url, label);
    if (!result) continue;

    // Fill gaps: only set ops not yet present
    for (const opName of OP_NAMES) {
      if (!merged.has(opName)) {
        const qid = result.get(opName);
        if (qid) merged.set(opName, qid);
      }
    }
  }

  // Cache even partial results (Layer 4 or 5 will fill remaining gaps)
  if (merged.size > 0) {
    graphqlJsonMap = merged;
    graphqlJsonCachedAt = Date.now();
  }

  return merged;
}

// ─── Layer 4: placeholder.json ───
// NOTE: placeholder.json only covers CreateTweet and FetchScheduledTweets.
// The 3 scheduled-tweet ops (CreateScheduledTweet, EditScheduledTweet,
// DeleteScheduledTweet) are NOT present in placeholder.json.
// On-demand chunk parsing (ondemand.s.*.js from x.com HTML) was considered
// but skipped due to complexity and fragility — Layer 5 (hardcoded fallback)
// handles these ops instead.

const GITHUB_PLACEHOLDER_PATH = "twitter-openapi/main/dist/placeholder.json";
const JSDELIVR_PLACEHOLDER_PATH = "twitter-openapi@main/dist/placeholder.json";

/**
 * Fetch placeholder.json and extract queryIds into a Map.
 * Tries GitHub raw first, then jsDelivr mirror.
 */
function getPlaceholderQueryId(data: PlaceholderJson, op: string): string | undefined {
  switch (op) {
    case "CreateTweet": return data.CreateTweet?.queryId;
    case "CreateScheduledTweet": return data.CreateScheduledTweet?.queryId;
    case "FetchScheduledTweets": return data.FetchScheduledTweets?.queryId;
    case "EditScheduledTweet": return data.EditScheduledTweet?.queryId;
    case "DeleteScheduledTweet": return data.DeleteScheduledTweet?.queryId;
    default: return undefined;
  }
}

async function fetchPlaceholderJson(): Promise<Map<string, string>> {
  const map = new Map<string, string>();

  const urls = [
    `${FA0311_RAW_BASE}/${GITHUB_PLACEHOLDER_PATH}`,
    `${FA0311_JSDELIVR_BASE}/${JSDELIVR_PLACEHOLDER_PATH}`,
  ];

  for (const url of urls) {
    const data = await safeFetchJson(url);
    if (data === null || typeof data !== "object") continue;

    const typed = data as PlaceholderJson;
    for (const opName of OP_NAMES) {
      if (!map.has(opName)) {
        const qid = getPlaceholderQueryId(typed, opName);
        if (qid) map.set(opName, qid);
      }
    }

    // Got at least something — stop trying URLs
    if (map.size > 0) break;
  }

  return map;
}

// ─── Main resolver ───

/**
 * Get cached queryIds using a 5-layer resolution chain.
 * Layers: in-memory cache → GraphQL.json(develop) → GraphQL.json(master)
 *         → placeholder.json → hardcoded fallback.
 * Partial results from each layer fill gaps for the next.
 */
export async function getQueryIds(): Promise<QueryIds> {
  // Layer 1: Return cached if fresh
  if (cachedQueryIds && Date.now() - cachedAt < QUERY_ID_CACHE_MS) {
    return cachedQueryIds;
  }

  // Build merged result, filling gaps from each layer
  const merged = new Map<string, string>();

  // Layers 2 & 3: GraphQL.json (develop + master with jsDelivr fallbacks)
  try {
    const graphqlMap = await getGraphQLJsonMap();
    for (const opName of OP_NAMES) {
      const qid = graphqlMap.get(opName);
      if (qid) merged.set(opName, qid);
    }
  } catch {
    // Network error — continue to next layer
  }

  // Layer 4: placeholder.json (only covers CreateTweet + FetchScheduledTweets)
  try {
    const placeholderMap = await fetchPlaceholderJson();
    for (const opName of OP_NAMES) {
      if (!merged.has(opName)) {
        const qid = placeholderMap.get(opName);
        if (qid) merged.set(opName, qid);
      }
    }
  } catch {
    // Network error — continue to fallback
  }

  // Layer 5: Hardcoded fallback for any remaining gaps
  const result: QueryIds = {
    CreateTweet: merged.get("CreateTweet") ?? FALLBACK_QUERY_IDS.CreateTweet,
    CreateScheduledTweet:
      merged.get("CreateScheduledTweet") ?? FALLBACK_QUERY_IDS.CreateScheduledTweet,
    FetchScheduledTweets:
      merged.get("FetchScheduledTweets") ?? FALLBACK_QUERY_IDS.FetchScheduledTweets,
    EditScheduledTweet:
      merged.get("EditScheduledTweet") ?? FALLBACK_QUERY_IDS.EditScheduledTweet,
    DeleteScheduledTweet:
      merged.get("DeleteScheduledTweet") ?? FALLBACK_QUERY_IDS.DeleteScheduledTweet,
  };

  // Cache the result (Layer 1)
  cachedQueryIds = result;
  cachedAt = Date.now();

  return result;
}

/** Force-clear all caches (e.g., on stale queryId error from X). */
export function clearQueryIdCache(): void {
  cachedQueryIds = null;
  cachedAt = 0;
  graphqlJsonMap = null;
  graphqlJsonCachedAt = 0;
}
