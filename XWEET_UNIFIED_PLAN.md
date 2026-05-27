# Xweet — Unified Architecture & Implementation Plan

> **Merged from**: XWEET_COMPREHENSIVE_REFERENCE.md + XWEET_PLAN_PROPOSAL_AND_CODING_PLAN.md  
> **Date**: 2026-05-28  
> **All findings LIVE-VERIFIED with actual X API calls**  
> **Design principle**: Fallback at every layer — no single point of failure

---

## Table of Contents

1. [Executive Summary](#1-executive-summary)
2. [System Architecture](#2-system-architecture)
3. [Data Flow: End-to-End](#3-data-flow-end-to-end)
4. [Layer-by-Layer Fallback Design](#4-layer-by-layer-fallback-design)
5. [Module Architecture & File Structure](#5-module-architecture--file-structure)
6. [One-by-One Operation Flows](#6-one-by-one-operation-flows)
7. [Cron Job System](#7-cron-job-system)
8. [Implementation Plan: Phase-by-Phase](#8-implementation-plan-phase-by-phase)
9. [Verification & Validation](#9-verification--validation)
10. [Risk Assessment & Mitigations](#10-risk-assessment--mitigations)
11. [Reference Data & Constants](#11-reference-data--constants)
12. [Appendix: Current Bugs Inventory](#12-appendix-current-bugs-inventory)

---

## 1. Executive Summary

### Goal

Transform Xweet from a partially-broken Twitter scheduler into a **production-ready, self-healing system** with **fallback at every layer** — no single point of failure. The system must reliably handle all 5 X GraphQL operations while keeping the cron job as the safety net.

### Core Design Principles

1. **Fallback at every layer** — if the primary method fails, a fallback exists
2. **Cron as safety net** — cron dispatches missed/due tweets; X scheduling is primary
3. **Self-healing** — stale data auto-detected, caches auto-cleared, auto-retried
4. **Never lose data** — tweets are persisted in DB before any API call
5. **CAS (Compare-And-Swap)** — safe concurrent state transitions
6. **Circuit breaker** — stop hammering broken accounts

### What's Broken Now (Critical)

| # | Bug | Impact |
|---|-----|--------|
| 1 | `scheduled_tweets_list` should be `scheduled_tweet_list` | All X-scheduled tweets falsely marked as "sent" — **silent data loss** |
| 2 | 3/5 FALLBACK_QUERY_IDS are stale | Create/Edit/Delete scheduled tweet all fail |
| 3 | `scheduled-tweet.ts` bypasses `getQueryIds()` for 3/5 ops | Uses stale IDs directly |
| 4 | `encodeTid()` produces 23-char TIDs (needs 94-char) | X silently returns empty tweet_results |
| 5 | `clearQueryIdCache()` exists but is NEVER called | No auto-recovery from stale data |
| 6 | `editScheduledTweet()` defined but never called | Editing only updates DB, not X |
| 7 | Error classifier has no stale detection | Can't trigger auto-recovery |

### What Works Well (Keep)

- Multi-account management with per-account circuit breaker
- Cookie encryption (AES-256-GCM)
- Media upload pipeline (with amplify_video for 15-day video expiry)
- CT0 auto-refresh (proactive + reactive)
- Lock + CAS posting lifecycle
- B2 media storage
- Cron tick with time-budget guard

---

## 2. System Architecture

### 2.1 High-Level Architecture Diagram

```
┌─────────────────────────────────────────────────────────────────────────┐
│                           Xweet System                                  │
│                                                                         │
│  ┌──────────┐    ┌──────────────┐    ┌──────────────┐                  │
│  │  Browser  │───▶│  Next.js API │───▶│   Database   │                  │
│  │  (Admin)  │    │   Routes     │    │  (SQLite)    │                  │
│  └──────────┘    └──────┬───────┘    └──────┬───────┘                  │
│                         │                    │                          │
│                         ▼                    │                          │
│  ┌──────────────────────────────────┐        │                          │
│  │       Scheduling Engine          │        │                          │
│  │                                  │        │                          │
│  │  ┌────────────┐  ┌────────────┐  │        │                          │
│  │  │ X Scheduled │  │ Cron Tick  │  │        │                          │
│  │  │  (Primary)  │  │ (Fallback) │  │        │                          │
│  │  └──────┬─────┘  └──────┬─────┘  │        │                          │
│  │         │               │         │        │                          │
│  └─────────┼───────────────┼─────────┘        │                          │
│            │               │                  │                          │
│            ▼               ▼                  │                          │
│  ┌──────────────────────────────────┐        │                          │
│  │    Pre-Call Guards (Services)    │◀───────┘                          │
│  │  ┌───────────┐ ┌──────────────┐ │                                   │
│  │  │   Circuit │ │    Lock      │ │  Called BEFORE the X API client   │
│  │  │  Breaker  │ │   Service    │ │  to gate access per account       │
│  │  └───────────┘ └──────────────┘ │                                   │
│  └──────────────┬───────────────────┘                                   │
│                 │                                                        │
│                 ▼                                                        │
│  ┌──────────────────────────────────┐                                   │
│  │        X API Client Layer        │                                   │
│  │                                  │                                   │
│  │  ┌──────────┐ ┌──────┐ ┌──────┐ │                                   │
│  │  │ Query ID  │ │ TID  │ │Header│ │                                   │
│  │  │ Resolver  │ │ Gen  │ │Cache │ │                                   │
│  │  └──────────┘ └──────┘ └──────┘ │                                   │
│  └──────────────┬───────────────────┘                                   │
│                 │                                                        │
│                 ▼                                                        │
│  ┌──────────────────────────────────┐                                   │
│  │   Post-Call Handlers (Client)    │                                   │
│  │  ┌───────────┐ ┌──────────────┐ │                                   │
│  │  │  Error    │ │   Stale      │ │  Called AFTER the X API responds  │
│  │  │Classifier │ │   Recovery   │ │  to classify and recover          │
│  │  └───────────┘ └──────────────┘ │                                   │
│  │  ┌───────────┐ ┌──────────────┐ │                                   │
│  │  │  Phantom  │ │   Response   │ │                                   │
│  │  │  Success  │ │   Parsing    │ │                                   │
│  │  └───────────┘ └──────────────┘ │                                   │
│  └──────────────────────────────────┘                                   │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
                              │
                              ▼
                    ┌──────────────────┐
                    │   X / Twitter    │
                    │   GraphQL API    │
                    └──────────────────┘
```

### 2.2 Scheduling Decision Tree (Dual-Path with Fallback)

```
User creates tweet with scheduledAt
         │
         ▼
    ┌────────────┐
    │ Is it < 18 │──── NO ───▶  Store as "scheduled" (cron path)
    │ months out?│              Cron will dispatch when due
    └─────┬──────┘
          │ YES
          ▼
    ┌────────────────┐
    │ countXScheduled │──── ERROR ──▶  Store as "scheduled" (cron path)
    │ Tweets() < 100? │               (can't verify X capacity, play safe)
    └─────┬──────────┘
          │ YES
          ▼
    ┌────────────────┐
    │ Try X Scheduled│
    │ Tweet API      │
    └─────┬──────────┘
          │
     ┌────┴──────────────────────────────────┐
     │ SUCCESS │ FAILURE                      │
     ▼         ▼                              │
  "x_scheduled"  ┌─────────────────────────┐ │
  X posts it     │ Classify the failure    │ │
  automatically  │                         │ │
                 ├─ stealth_ban ────────────▶│── Mark account inactive, alert admin
                 ├─ auth_failure ───────────▶│── Attempt ct0 refresh, retry once
                 ├─ rate_limit ─────────────▶│── Store as "scheduled" (cron will retry later)
                 ├─ stale_cache ───────────▶│── Clear caches, retry once (factory pattern)
                 └─ terminal/other ─────────▶│── Store as "scheduled" (cron fallback)
                                           │
                                           ▼
                                  "scheduled" (cron path)
                                  Cron dispatches via CreateTweet
                                  when time arrives
```

**Key insight**: Both paths lead to the tweet being posted. The X Scheduled API is the "happy path" (cheaper, simpler), but the cron path is always available as fallback. **Not all failures should fall through** — `stealth_ban` means the account is banned and cron would also fail; only `terminal`, `rate_limit`, and unrecoverable errors should fall through to the cron path.

### 2.3 Cron Job Architecture (Single Cron — Merged)

> **Design decision**: Merged from 2 crons into 1. The maintenance tasks (ct0 refresh, X-schedule sync, cache pre-refresh) add ~200ms to each tick — well within the 8s time budget. A single cron simplifies ops (1 cron-job.org entry, 1 URL, 1 secret) and makes maintenance tasks more responsive (every 5 min instead of 15 min).

```
┌─────────────────────────────────────────────────┐
│                Cron Job System                    │
│                                                   │
│  cron-job.org ──▶ POST /api/cron/tick (5 min)   │
│    │                                              │
│    ├─▶ 1. Recover stale locks (5 min timeout)     │
│    ├─▶ 2. Recover stale "posting" status (2 min)  │
│    ├─▶ 3. Dispatch due tweets (batch of 5)        │
│    ├─▶ 4. Retry failed tweets (batch of 3)        │
│    ├─▶ 5. Refresh stale ct0 (>4h old)             │
│    ├─▶ 6. Sync X-scheduled tweets                 │
│    ├─▶ 7. Refresh cache pre-emptively             │
│    └─▶ 8. Time-budget guard (8s max)              │
│                                                   │
│  CRON_SECRET for authentication                   │
│  Time-budget prevents Vercel 10s timeout          │
└─────────────────────────────────────────────────┘
```

**Why a single cron is sufficient**:
1. **Maintenance tasks are cheap** — ct0 refresh and cache refresh are just HTTP fetches (~200ms total)
2. **Time-budget guard protects** — if any step takes too long, the 8s budget stops it
3. **More responsive** — ct0 and sync run every 5 min instead of 15 min (faster recovery)
4. **Simpler ops** — 1 cron-job.org entry, 1 URL, 1 secret to manage
5. **X handles the actual scheduling** — cron is just the safety net; heavy lifting is X's job

**Why cron is essential**:
1. **Safety net** — if X Scheduled API fails, cron dispatches via CreateTweet
2. **Overflow** — accounts with >100 scheduled tweets need cron
3. **Immediate posts** — "Post Now" uses cron's dispatch logic
4. **Stale recovery** — recovers crashed posting states
5. **Sync** — checks if X has posted scheduled tweets

---

## 3. Data Flow: End-to-End

### 3.1 Tweet Lifecycle State Machine

```
                  ┌───────────┐
                  │ scheduled │◀─── cron retry (failed → scheduled → sending)
                  └─────┬─────┘
                        │
           ┌────────────┼────────────┐
           │            │            │
           ▼            ▼            ▼
   ┌──────────────┐ ┌────────┐ ┌──────────┐
   │ x_scheduled  │ │sending │ │cancelled │
   │ (X handles)  │ │(cron)  │ │          │
   └──────┬───────┘ └───┬────┘ └──────────┘
          │             │
          │     ┌───────┼───────┐
          │     │       │       │
          │     ▼       ▼       ▼
          │   ┌────┐ ┌─────┐ ┌──────────┐
          │   │sent│ │failed│ │scheduled │
          │   └────┘ └──┬──┘ │(stale rcv)│
          │              │    └──────────┘
          │              └──▶ retry (up to 3)
          │
          └──────────────────▶ sent (X posted it)

Edge labels (why the transition happens):
  scheduled → x_scheduled : CreateScheduledTweet succeeded
  scheduled → sending     : Cron dispatch started (CAS lock acquired)
  scheduled → cancelled   : User cancelled before dispatch
  x_scheduled → sent      : Sync detected X posted it
  x_scheduled → cancelled : User cancelled, DeleteScheduledTweet called
  sending → sent          : CreateTweet succeeded
  sending → failed        : CreateTweet failed terminally
  sending → scheduled     : Stale LOCK recovery (5 min timeout, lock expired)
  sending → failed        : Stale POSTING recovery (2 min timeout, crash suspected)
  failed → scheduled      : Cron retry (increments retryCount)
  failed → cancelled      : User cancelled while queued for retry (CAS-safe)

⚠️ "sending → scheduled" vs "sending → failed" are DIFFERENT recovery paths:
  - Stale LOCK (5 min): Lock expired → re-queue as "scheduled" for next dispatch
  - Stale POSTING (2 min): Server may have crashed → mark "failed" for retry
  - Both run in cron tick but with different thresholds
```

### 3.2 Valid State Transitions (CAS-enforced)

```typescript
const VALID_TRANSITIONS = {
  scheduled:   ["x_scheduled", "sending", "cancelled"],
  x_scheduled: ["sent", "cancelled"],
  sending:     ["sent", "failed", "scheduled"],  // scheduled = stale lock recovery (5min)
  sent:        [],                                 // terminal
  failed:      ["scheduled", "cancelled"],         // scheduled = retry; cancelled = user cancels retry
  cancelled:   [],                                 // terminal
};

// CAS protects against concurrent transitions:
// If cron does failed→scheduled while user does failed→cancelled,
// only ONE succeeds because CAS checks current status = "failed" atomically.
// The loser gets a CAS mismatch error and handles it gracefully.
```

> **Accepted limitation**: If the server crashes mid-CreateTweet and the tweet
> actually landed on X, stale posting recovery marks it `failed` (→ `scheduled` →
> retry → potential duplicate). Error 187 (duplicate_posted) catches this at X's
> end, but only for identical text. There's no way to verify CreateTweet success
> post-crash without querying X's API for the tweet, which requires a tweet ID
> we don't have. This is an accepted trade-off.

---

## 4. Layer-by-Layer Fallback Design

### 4.1 Query ID Resolution — 5-Layer Fallback

```
┌─────────────────────────────────────────────────────────┐
│              Query ID Resolution Fallback Chain           │
│                                                           │
│  Layer 1: In-memory cache ──────────── ~0ms  (instant)   │
│      │ ⚠️ Serverless: cache is PER-INSTANCE only.          │
│      │ Cold starts get empty caches. Warm invocations      │
│      │ share memory within same instance, but instances    │
│      │ recycle unpredictably. "4h TTL" is a MAXIMUM —     │
│      │ actual TTL may be 0ms on cold start.               │
│      │ Multi-layer fallback is ESPECIALLY important in     │
│      │ serverless precisely because caches are ephemeral.  │
│      │ (expired or null?)                                 │
│      ▼                                                     │
│  Layer 2: GraphQL.json (develop) ───── ~0ms  (CDN cached) │
│      │ Covers ALL 5 ops. Updated daily by fa0311 CI.      │
│      │ (failed?)                                           │
│      ▼                                                     │
│  Layer 3: GraphQL.json (master) ────── ~0ms  (CDN cached) │
│      │ Covers ALL 5 ops. May lag develop by days.         │
│      │ (failed?)                                           │
│      ▼                                                     │
│  Layer 4: placeholder.json + ondemand ─ ~500ms (live)     │
│      │ placeholder: CreateTweet + FetchScheduledTweets    │
│      │ ondemand.ComposeScheduling: 4 scheduled ops         │
│      │ (failed?)                                           │
│      ▼                                                     │
│  Layer 5: FALLBACK_QUERY_IDS ───────── 0ms  (hardcoded)   │
│      │ Updated to last known live-verified values.         │
│      │ NOT persisted to DB (twt insight).                  │
│      │                                                     │
│  ─── NEVER NULL ─── Always returns 5 query IDs ───        │
│                                                           │
│  On stale error (code 48/404/344/"Query not found"):      │
│    → Clear ALL caches → Re-resolve from Layer 2 → Retry   │
└─────────────────────────────────────────────────────────┘
```

**Source coverage matrix (LIVE-VERIFIED)**:

| Source | CreateTweet | CreateScheduled | FetchScheduled | EditScheduled | DeleteScheduled |
|--------|:-----------:|:---------------:|:--------------:|:-------------:|:---------------:|
| GraphQL.json develop | ✅ | ✅ | ✅ | ✅ | ✅ |
| GraphQL.json master | ✅ | ✅ | ✅ | ✅ | ✅ |
| placeholder.json | ✅ | ❌ | ✅ | ❌ | ❌ |
| ondemand chunk | ❌ | ✅ | ✅ | ✅ | ✅ |
| FALLBACK (updated) | ✅ | ✅ | ✅ | ✅ | ✅ |

### 4.2 TID Generation — 3-Layer Fallback

```
┌──────────────────────────────────────────────────────────┐
│              TID Generation Fallback Chain                 │
│                                                            │
│  Layer 1: pair-dict ─────────────────── ~0ms  (CDN cached) │
│      │ Fetch pair.json (30 pre-computed pairs) from GitHub │
│      │ Use buildTransactionId() with pair.verification +    │
│      │   pair.animationKey → correct 94-char TID            │
│      │ Drastic-change guard: if count < 50% of cached,     │
│      │   keep old cache (prevents corrupted data)           │
│      │ (failed?)                                            │
│      ▼                                                      │
│  Layer 2: Live SVG ─────────────────── ~500ms (x.com fetch)│
│      │ Fetch x.com HTML → parse SVG animation frames        │
│      │ Extract verification key + dynamic index keys         │
│      │ from ondemand.s.*.js chunk                           │
│      │ Use buildTransactionId() → correct 94-char TID       │
│      │ (failed?)                                            │
│      ▼                                                      │
│  Layer 3: Skip TID ──────────────────── 0ms  (no header)   │
│      │ Some operations work without TID (media upload)       │
│      │ CreateTweet may return empty tweet_results            │
│      │ → detected by 4-layer response parsing                │
│      │ → retried with fresh TID on next attempt              │
│      │                                                      │
│  ─── GRACEFUL DEGRADATION ─── never crashes ───             │
└──────────────────────────────────────────────────────────┘
```

**TID assertion**: `if (tid && tid.length < 90) log.warn("TID suspiciously short")` — helps detect regression.

### 4.3 Header Resolution — 3-Layer Fallback

```
┌──────────────────────────────────────────────────────────┐
│              Header Resolution Fallback Chain               │
│                                                            │
│  Layer 1: header.json (fa0311) ──────── ~0ms  (cached 24h) │
│      │ Auto-updated Chrome headers (18 profiles)            │
│      │ Use "chrome-fetch" profile                           │
│      │ (failed?)                                            │
│      ▼                                                      │
│  Layer 2: Static Chrome constants ──────── 0ms  (hardcoded) │
│      │ From twt — complete sec-ch-ua, sec-fetch-*, etc.     │
│      │ Updated manually when Chrome version changes          │
│      │                                                      │
│  ─── Headers are ALWAYS available ───                       │
└──────────────────────────────────────────────────────────┘
```

### 4.4 Error Classification — Table-Driven with Fallback

```
┌──────────────────────────────────────────────────────────┐
│              Error Classification                          │
│                                                            │
│  Pattern Match ────────▶ 7 Error Classes                   │
│                                                            │
│  ┌─────────────────────────────────────────────────────┐  │
│  │ stale_cache    → code:48, HTTP 404, "Query not found" │  │
│  │                   code:344                            │  │
│  │ ACTION: Clear all caches → retry ONCE                  │  │
│  ├─────────────────────────────────────────────────────┤  │
│  │ transient      → HTTP 226, code:226, "might be       │  │
│  │                   automated"                           │  │
│  │ ACTION: Jittered retry up to 3 times                  │  │
│  ├─────────────────────────────────────────────────────┤  │
│  │ auth_failure   → HTTP 401, "Could not authenticate"  │  │
│  │ ACTION: Attempt ct0 refresh → retry once              │  │
│  ├─────────────────────────────────────────────────────┤  │
│  │ rate_limit     → HTTP 429, code:88, "Rate limit      │  │
│  │                   exceeded"                            │  │
│  │ ACTION: Wait + retry (circuit breaker tracks)         │  │
│  ├─────────────────────────────────────────────────────┤  │
│  │ stealth_ban    → code:353, "suspended", code:64       │  │
│  │ ACTION: Mark account inactive, alert admin            │  │
│  ├─────────────────────────────────────────────────────┤  │
│  │ duplicate_posted → code:187                           │  │
│  │ ACTION: Phantom success → recover to 'posted'         │  │
│  ├─────────────────────────────────────────────────────┤  │
│  │ terminal       → anything not matched above           │  │
│  │                   GRAPHQL_VALIDATION_FAILED, code:214 │  │
│  │ ACTION: Fail the tweet, log error                     │  │
│  └─────────────────────────────────────────────────────┘  │
│                                                            │
│  Fallback: If classification fails → treat as 'terminal'    │
└──────────────────────────────────────────────────────────┘
```

### 4.5 Posting Path — Dual-Path with Fallback

```
┌──────────────────────────────────────────────────────────┐
│              Posting Path Fallback                          │
│                                                            │
│  Path A: X Scheduled Tweet API (primary)                    │
│  ├── CreateScheduledTweet → X posts it automatically        │
│  ├── Status: "x_scheduled" in DB                            │
│  ├── Cron sync checks if X posted it                        │
│  └── If fails → fall through to Path B                      │
│                                                            │
│  Path B: Cron + CreateTweet (fallback)                      │
│  ├── Store as "scheduled" in DB                             │
│  ├── Cron tick dispatches when due                          │
│  ├── Uses CreateTweet for immediate posting                 │
│  └── If fails → retry up to 3 times, then mark failed       │
│                                                            │
│  Path C: "Post Now" (manual fallback)                       │
│  ├── User clicks "Post Now" in UI                           │
│  ├── Immediately dispatches via CreateTweet                 │
│  └── If X-scheduled, deletes from X first, then posts       │
│                                                            │
│  ─── Every tweet will eventually be posted or failed ───    │
└──────────────────────────────────────────────────────────┘
```

### 4.6 Circuit Breaker — Enhanced with Failure Window

```
┌──────────────────────────────────────────────────────────┐
│              Circuit Breaker                                │
│                                                            │
│  State: CLOSED (normal)                                     │
│    └── Track consecutive failures per account               │
│        └── Only count failures within 30-min window         │
│            └── Skip: auth_failure, rate_limit, stealth_ban, │
│                duplicate_posted (not real failures)          │
│            └── Window resets on LAST failure, NOT a true    │
│                sliding window. If last failure was >30 min   │
│                ago, count resets to 1. This means older     │
│                failures are "forgotten" faster than a true  │
│                sliding window would allow. Acceptable for    │
│                this use case (low throughput).              │
│                                                            │
│  State: OPEN (paused) ──▶ after 3 consecutive failures      │
│    └── Skip account in all cron dispatches                   │
│    └── Auto-close after 30 min cooldown                     │
│    └── Admin can manually close from UI                     │
│                                                            │
│  State: HALF-OPEN (testing) ──▶ after cooldown expires      │
│    └── Allow 1 test request                                 │
│    └── Success → close circuit                              │
│    └── Failure → re-open for another 30 min                  │
│                                                            │
│  Persistence: DB-backed (survives server restarts)           │
│  Concurrency: Atomic DB updates (CAS pattern)                │
└──────────────────────────────────────────────────────────┘
```

### 4.7 Stale Auto-Recovery Lifecycle

> **⚠️ CRITICAL DESIGN NOTE — Factory Pattern Required**
>
> `resilientApiCall()` MUST use a **factory function**, not a closure. If the caller
> resolves queryId/TID/headers *before* passing `fn` to `resilientApiCall`, the stale
> values are captured in the closure. Clearing caches has no effect — `fn()` reuses
> the same stale values. Instead, resolution must happen **inside** the factory so
> each retry re-resolves from (now-cleared) caches:
>
> ```typescript
> // ❌ WRONG — closure captures stale values:
> const queryIds = await getQueryIds();   // resolved here (stale)
> const tid = await generateTid(...);     // resolved here (stale)
> const fn = () => xFetch({ queryIds, tid, ... });
> await resilientApiCall(fn);             // retry reuses stale fn
>
> // ✅ CORRECT — factory re-resolves on each attempt:
> await resilientApiCall(async () => {
>   const queryIds = await getQueryIds();   // re-resolved each attempt
>   const tid = await generateTid(...);     // re-resolved each attempt
>   const headers = await getHeaders();     // re-resolved each attempt
>   return xFetch({ queryId: queryIds.CreateTweet, tid, headers, body });
> });
> ```

```
┌──────────────────────────────────────────────────────────┐
│              Stale Auto-Recovery                            │
│                                                            │
│  TRIGGER: X API returns stale_cache error class             │
│    (code:48, HTTP 404, "Query not found", code:344)        │
│    ⚠️ code:344 can also mean TID/header issues, not just   │
│    stale query IDs. Clearing ALL caches is still correct   │
│    because stale headers/TIDs can also cause 344.           │
│                                                            │
│  Step 1: CLEAR all caches                                  │
│    ├── clearQueryIdCache()                                  │
│    ├── clearTransactionIdCache()                            │
│    └── clearHeaderCache()                                   │
│                                                            │
│  Step 2: RETRY by calling the FACTORY again                 │
│    ├── Factory re-resolves getQueryIds() → fresh from CDN   │
│    ├── Factory re-resolves generateTid() → fresh from pair  │
│    └── Factory re-resolves getHeaders() → fresh from CDN    │
│    (NOT lazy — factory resolves explicitly on each call)    │
│                                                            │
│  Step 3: If still fails → BAIL                              │
│    ├── Log error with full context                          │
│    ├── Alert admin via log entry                            │
│    └── Mark tweet as failed (will retry on next cron tick)  │
│                                                            │
│  ─── Self-healing: stale data never blocks for long ───     │
└──────────────────────────────────────────────────────────┘
```

### 4.8 Response Parsing — 4-Layer Discriminated Union

```
┌──────────────────────────────────────────────────────────┐
│              Response Parsing (4-Layer)                     │
│                                                            │
│  For CreateTweet:                                          │
│  ├── Layer 1: tweetId present → success (even if errors[]) │
│  ├── Layer 2: empty tweet_results → silent rejection       │
│  ├── Layer 3: GraphQL errors[] → classified error          │
│  └── Layer 4: no data, no errors → unknown_failure         │
│                                                            │
│  For CreateScheduledTweet:                                 │
│  ├── Layer 1: data.tweet.rest_id present → success         │
│  ├── Layer 2: empty data → silent rejection                │
│  ├── Layer 3: GraphQL errors[] → classified error          │
│  └── Layer 4: no data, no errors → unknown_failure         │
│                                                            │
│  For EditScheduledTweet / DeleteScheduledTweet:            │
│  ├── Layer 1: "scheduledtweet_put":"Done" or               │
│  │           "scheduledtweet_delete":"Done" → success       │
│  ├── Layer 2: unexpected response → unknown                │
│  ├── Layer 3: GraphQL errors[] → classified error          │
│  └── Layer 4: no data, no errors → unknown_failure         │
│                                                            │
│  For FetchScheduledTweets:                                 │
│  ├── Layer 1: scheduled_tweet_list array → success         │
│  ├── Layer 2: empty list → no scheduled tweets             │
│  ├── Layer 3: GraphQL errors[] → classified error          │
│  └── Layer 4: no data, no errors → unknown_failure         │
│                                                            │
│  ─── No silent failures — every response is classified ─── │
└──────────────────────────────────────────────────────────┘
```

---

## 5. Module Architecture & File Structure

### 5.1 Target File Structure

```
src/
├── config/
│   ├── constants.ts          ← UPDATE: add GraphQL.json URLs, update FALLBACK_QUERY_IDS
│   └── env.ts                ← (no change)
│
├── lib/
│   ├── twitter/
│   │   ├── client.ts         ← REWRITE: add resilientApiCall(factory), 4-layer response parsing
│   │   ├── query-id.ts       ← REWRITE: 5-layer resolution (GraphQL.json primary)
│   │   ├── transaction-id.ts ← REWRITE: pair-dict primary, live SVG fallback
│   │   ├── transaction-id-shared.ts  ← NEW: buildTransactionId() core algorithm
│   │   ├── transaction-id-pair.ts    ← NEW: pair-dict primary method
│   │   ├── transaction-id-html.ts    ← NEW: HTML parsing + animation key
│   │   ├── transaction-id-cubic.ts   ← NEW: cubic bezier math (pure)
│   │   ├── scheduled-tweet.ts ← FIX: response key, use getQueryIds(), parse response
│   │   ├── post-tweet.ts     ← UPDATE: use resilientApiCall(factory), parse response
│   │   ├── media-upload.ts   ← (minor: use resilientApiCall for upload)
│   │   ├── headers.ts        ← UPDATE: add static Chrome constants as fallback
│   │   ├── ct0-refresh.ts    ← (no change)
│   │   ├── circuit-breaker.ts ← UPDATE: failure window, skip non-transient
│   │   └── features.ts       ← NEW: single source of truth for CreateTweet features
│   │                            (was hardcoded in post-tweet.ts — wrong features = silent failure)
│   │
│   ├── cache/
│   │   └── html-cache.ts     ← NEW: shared x.com HTML cache (5-min TTL)
│   │                            Used by both query-id.ts and transaction-id.ts
│   │                            (NOT in lib/twitter/ — it's shared infrastructure)
│   │
│   ├── utils/
│   │   ├── error-classifier.ts ← REWRITE: table-driven 7-class taxonomy
│   │   ├── retry.ts           ← UPDATE: jittered exponential backoff
│   │   └── date.ts            ← (no change)
│   │
│   ├── services/
│   │   ├── schedule-service.ts ← UPDATE: add stale posting recovery
│   │   ├── tweet-service.ts    ← UPDATE: phantom success recovery, editScheduledTweet wiring
│   │   ├── account-service.ts  ← (no change)
│   │   ├── lock-service.ts     ← (no change)
│   │   ├── encryption-service.ts ← (no change)
│   │   └── blob-service.ts     ← (no change)
│   │
│   ├── api/
│   │   ├── response.ts         ← (no change)
│   │   ├── errors.ts           ← UPDATE: add ErrorClass to TwitterApiError
│   │   ├── proxy.ts            ← (no change)
│   │   └── rate-limit.ts       ← (no change)
│   │
│   └── db/
│       ├── db.ts               ← (no change)
│       └── queries/            ← (no change)
│
├── types/
│   ├── twitter.ts             ← FIX: scheduled_tweet_list (remove 's')
│   ├── models.ts              ← (no change)
│   └── api.ts                 ← (no change)
│
├── app/
│   ├── api/
│   │   ├── cron/
│   │   │   └── tick/route.ts      ← UPDATE: merged maintenance tasks into tick
│   │   ├── tweets/
│   │   │   ├── route.ts           ← (no change)
│   │   │   └── [id]/
│   │   │       ├── route.ts       ← UPDATE: wire editScheduledTweet for X-scheduled
│   │   │       ├── cancel/route.ts ← UPDATE: handle "sending" state rejection
│   │   │       └── post-now/route.ts ← (no change)
│   │   └── ... (other routes unchanged)
│   └── ...
│
└── ...
```

### 5.2 Module Dependency Graph

```
                    ┌─────────────┐
                    │ API Routes   │
                    └──────┬──────┘
                           │
                    ┌──────▼──────┐
                    │ Services    │
                    │ (schedule,  │
                    │  tweet,     │
                    │  account)   │
                    └──────┬──────┘
                           │
              ┌────────────┼────────────┐
              │            │            │
       ┌──────▼──────┐ ┌──▼──────┐ ┌──▼──────┐
       │ X API Layer  │ │  DB     │ │  Lock   │
       │ (client,     │ │ Queries │ │ Service │
       │  scheduled,  │ └─────────┘ └─────────┘
       │  post-tweet) │
       └──────┬──────┘
              │
    ┌─────────┼─────────────┐
    │         │             │
┌───▼───┐ ┌──▼──────┐ ┌───▼────┐
│QueryID│ │  TID    │ │Headers │
│Resolver│ │Generator│ │ Cache  │
└───┬───┘ └──┬──────┘ └───┬────┘
    │         │             │
    └────┬────┘             │
         │                  │
  ┌──────▼──────┐           │
  │  html-cache │◀──────────┘ (shared by query-id + transaction-id)
  │ (lib/cache) │
  └─────────────┘
         │
  ┌──────▼──────┐
  │  Resilience │
  │  (error-    │
  │  classifier,│ ← cross-subdir dep: circuit-breaker.ts imports
  │  retry)     │   error-classifier.ts (lib/utils → lib/twitter)
  └─────────────┘
         ▲
         │
  ┌──────┴──────┐
  │  Circuit    │
  │  Breaker    │ ← called by Services (Pre-Call Guard)
  │ (lib/twitter│    imports ErrorClass from lib/utils
  └─────────────┘
```

---

## 6. One-by-One Operation Flows

### 6.1 Create Tweet (Immediate Post)

```
User clicks "Post Now"
    │
    ▼
API Route: POST /api/tweets (body: { text, accountId, scheduledAt: null })
    │
    ▼
tweet-service.publishTweet()
    │
    ├── 1. Acquire lock (CAS: scheduled → sending)
    │
    ├── 2. Check circuit breaker (if open → skip)
    │
    ├── 3. Resolve account cookies (decrypt)
    │
    ├── 4. Upload media (if any)
    │   ├── Use amplify_video for video (15-day expiry)
    │   ├── Use tweet_image for images
    │   └── Use tweet_gif for GIFs
    │
    ├── 5. Build CreateTweet request
    │   ├── getQueryIds() → resolve queryId (5-layer fallback)
    │   ├── generateTransactionId() → resolve TID (3-layer fallback)
    │   ├── getHeaders() → resolve headers (3-layer fallback)
    │   └── Build body: { variables: { tweet_text, media, ... }, queryId, features }
    │
    ├── 6. resilientApiCall() → xFetch()
    │   ├── If stale_cache error → clear caches → retry ONCE
    │   ├── If transient → jittered retry up to 3x
    │   ├── If auth_failure → ct0 refresh → retry once
    │   ├── If duplicate_posted → phantom success recovery → mark as "sent"
    │   └── If terminal → fail
    │
    ├── 7. Parse response (4-layer discriminated union)
    │   ├── success → extract tweetId
    │   ├── empty_results → warn, may need TID fix
    │   ├── graphql_error → classify and handle
    │   └── unknown_failure → log full response
    │
    ├── 8. CAS transition: sending → sent
    │
    ├── 9. Record success in circuit breaker
    │
    ├── 10. Release lock
    │
    └── 11. On PERMANENT failure (retry limit exceeded):
        └── Clean up B2 media (resource leak prevention)
```

### 6.2 Schedule Tweet (X Scheduled API)

> **⚠️ VIDEO EXPIRY MISMATCH**: `amplify_video` gives 15-day media expiry, but tweets
> can be scheduled up to 18 months out. A video uploaded today will be broken when the
> tweet posts in 30 days. Solutions:
> 1. **Reject video on tweets scheduled >14 days out** — safest, simplest
> 2. **Re-upload on cron dispatch** — if the X-scheduled tweet's video has expired, delete
>    it from X and re-create with a fresh upload (complex, not recommended for P0)
> 3. **Store video in B2 and re-upload on dispatch** — cron path already uses fresh uploads
>
> **Decision**: Option 1 for P0 (reject with clear error message). Option 3 is the
> cron-path behavior for overflow tweets. The 15-day window is fine for most use cases.

```
User schedules tweet for future time
    │
    ▼
API Route: POST /api/tweets (body: { text, accountId, scheduledAt: "2026-06-01T10:00:00Z" })
    │
    ▼
tweet-service.scheduleTweet()
    │
    ├── 1. Calculate time until scheduled
    │   ├── If < 1 minute → reject ("too soon")
    │   └── If > 18 months → reject ("too far")
    │
    ├── 2. Check X scheduling eligibility
    │   ├── Count account's current X-scheduled tweets
    │   │   └── On DB/network error → store as "scheduled" (cron path, play safe)
    │   ├── If >= 100 → store as "scheduled" (cron path)
    │   └── If < 100 → proceed with X Scheduled API
    │
    ├── 3. Video expiry guard (NEW)
    │   ├── If tweet has video media AND scheduled > 14 days out
    │   │   └── Reject: "Video tweets can't be scheduled more than 14 days ahead.
    │   │       Remove the video or choose a closer date."
    │   └── Otherwise → continue
    │
    ├── 4. Try X Scheduled API path
    │   ├── Upload media (if any) → use amplify_video for video, tweet_image for images
    │   ├── getQueryIds() → CreateScheduledTweet queryId
    │   ├── generateTransactionId() → TID
    │   ├── getHeaders() → headers
    │   ├── resilientApiCall(factory) → createScheduledTweet()
    │   │   ├── Factory re-resolves queryIds/TID/headers on each attempt
    │   │   ├── Body: { variables: { execute_at: SECONDS, post_tweet_request: { status, media_ids } } }
    │   │   ├── NO queryId in body! (causes error 214)
    │   │   ├── NO features needed!
    │   │   └── Parse: data.tweet.rest_id (LIVE-VERIFIED format, NOT data.create_scheduled_tweet.*)
    │   │
    │   ├── On success:
    │   │   ├── Save scheduledTweetRestId in DB
    │   │   ├── CAS: scheduled → x_scheduled
    │   │   └── Return success
    │   │
    │   └── On failure — classify error:
    │       ├── stealth_ban → Mark account inactive, alert admin (DO NOT fall through)
    │       ├── auth_failure → Attempt ct0 refresh, retry once
    │       ├── stale_cache → Clear caches, retry once (factory pattern)
    │       ├── rate_limit / terminal → Fall through to cron path
    │       └── Other → Fall through to cron path
    │
    ├── 5. Cron fallback path (if X scheduling failed or ineligible)
    │   ├── Store as "scheduled" in DB (no scheduledTweetRestId)
    │   ├── Cron will dispatch via CreateTweet when time arrives
    │   └── Return success (with note: "scheduled via cron")
    │
    └── Done
```

### 6.3 Edit Tweet

```
User edits a scheduled tweet
    │
    ▼
API Route: PUT /api/tweets/[id] (body: { text, scheduledAt })
    │
    ▼
tweet-service.updateTweet()
    │
    ├── 1. Load tweet from DB
    │   └── Include: text, scheduledAt, mediaIds (stored as JSON array), scheduledTweetRestId
    │
    ├── 2. Check current status
    │   ├── If "sent" or "cancelled" → reject ("cannot edit")
    │   ├── If "sending" → reject ("currently posting, try again in a moment")
    │   ├── If "x_scheduled" → edit on X + update DB
    │   └── If "scheduled" → update DB only (cron will use new data)
    │
    ├── 3. If "x_scheduled" with scheduledTweetRestId:
    │   ├── Upload NEW media (if changed) → get fresh mediaIds
    │   │   └── Media IDs come from DB (saved at tweet creation) or newly uploaded
    │   ├── Build complete post_tweet_request:
    │   │   └── status = updatedText, media_ids = updatedMediaIds (from DB or new upload)
    │   ├── editScheduledTweet() on X API
    │   │   ├── getQueryIds() → EditScheduledTweet queryId
    │   │   ├── Body: { variables: {
    │   │   │   scheduled_tweet_id: restId,
    │   │   │   execute_at: SECONDS, ← REQUIRED (live-verified!)
    │   │   │   post_tweet_request: { status, media_ids } ← COMPLETE, not partial
    │   │   │ }}
    │   │   ├── Parse: data.scheduledtweet_put === "Done"
    │   │   └── resilientApiCall(factory) with auto-recovery
    │   │
    │   └── Update DB with new text/time/mediaIds
    │
    └── 4. If just "scheduled" (cron path):
        └── Update DB only — cron uses fresh data when dispatching
```

> **Media IDs for edit**: The DB stores `mediaIds` (the X media IDs from initial upload)
> alongside the tweet. When editing, these are loaded and included in `post_tweet_request`.
> If the user changes media, new uploads happen first, and the new mediaIds replace the
> old ones. Old B2 blobs are cleaned up.

### 6.4 Delete/Cancel Tweet

```
User cancels a scheduled tweet
    │
    ▼
API Route: POST /api/tweets/[id]/cancel
    │
    ▼
tweet-service.cancelTweet()
    │
    ├── 1. Load tweet from DB
    │
    ├── 2. Check current status
    │   ├── If "sent" → reject ("already posted")
    │   ├── If "sending" → reject ("currently posting, try again in a moment")
    │   │   ← sending→cancelled is NOT a valid transition
    │   │   ← User must wait for dispatch to complete (usually <3s)
    │   ├── If "cancelled" → reject ("already cancelled")
    │   └── If "x_scheduled" → delete from X + update DB
    │
    ├── 3. If "x_scheduled" with scheduledTweetRestId:
    │   ├── deleteScheduledTweet() on X API
    │   │   ├── getQueryIds() → DeleteScheduledTweet queryId
    │   │   ├── Body: { variables: { scheduled_tweet_id: restId } }
    │   │   │   ← NOTE: scheduled_tweet_id, NOT tweet_id!
    │   │   ├── Parse: data.scheduledtweet_delete === "Done"
    │   │   └── resilientApiCall(factory) with auto-recovery
    │   │
    │   └── Clean up B2 media
    │
    ├── 4. If "scheduled" or "failed":
    │   └── No X API call needed — just update DB
    │
    ├── 5. CAS transition: current → cancelled
    │   └── CAS-safe: if cron already transitioned to "sending", this fails gracefully
    │
    └── 6. Clean up B2 media (if not already cleaned)
```

### 6.5 FetchScheduledTweets (Sync)

> **⚠️ CRITICAL: Error isolation required.** If `fetchScheduledTweets()` returns an
> error (rate limit, auth failure, network timeout), the DB tweets must NOT be marked
> as "sent" just because they're absent from a list that was never actually returned.
> The fetch outcome must be verified BEFORE marking anything.

```
Cron tick (step 6) or manual sync
    │
    ▼
schedule-service.executeCronTick() — sync step
    │
    ├── 1. Get all "x_scheduled" tweets from DB
    │
    ├── 2. For each account with x_scheduled tweets:
    │   ├── fetchScheduledTweets()
    │   │   ├── getQueryIds() → FetchScheduledTweets queryId
    │   │   ├── Body: { variables: { ascending: false } }
    │   │   │   ← ascending: false is REQUIRED! Empty {} → 422
    │   │   │   ← Enforced via Zod/schema validation, not just convention
    │   │   ├── Parse: data.viewer.scheduled_tweet_list
    │   │   │   ← NOT scheduled_tweets_list! (common mistake)
    │   │   └── resilientApiCall(factory) with auto-recovery
    │   │
    │   ├── CHECK FETCH OUTCOME (CRITICAL — do not skip!)
    │   │   ├── If fetch outcome is 'graphql_error' or 'unknown_failure':
    │   │   │   └── SKIP this account entirely — do NOT mark any tweets as sent
    │   │   │       Log: "Sync skipped for account {id}: fetch returned {outcome.kind}"
    │   │   └── If fetch outcome is 'list':
    │   │       └── Proceed to step 3
    │   │
    │   └── 3. For each DB tweet with status "x_scheduled":
    │       ├── Find in X's list by scheduledTweetRestId
    │       ├── If found → still scheduled, no action
    │       ├── If NOT found → ONE OF FOUR possibilities:
    │       │   ├── A. X posted it (scheduled time passed) → CAS: x_scheduled → sent
    │       │   ├── B. User manually deleted from X's native scheduler → CAS: x_scheduled → cancelled
    │       │   ├── C. Tweet was created < 2 minutes ago (eventual consistency) → SKIP
    │       │   │   └── Don't mark as sent for tweets younger than 2 min
    │       │   └── D. Unknown reason → CAS: x_scheduled → sent (with logged warning)
    │       │       └── Default assumption: X posted it. This is the happy path.
    │       │       If wrong, the user can manually cancel from the UI.
    │       ├── Record postedAt timestamp
    │       └── Clean up B2 media
    │
    └── Done
```

### 6.6 Cron Tick Dispatch (CreateTweet path)

> **⚠️ DESIGN NOTE: Lock + Idempotency.** Before dispatching, a lock must be acquired
> (CAS: scheduled → sending) and held until the DB status is updated after the API call.
> If the Vercel function times out after X received the CreateTweet but before DB update,
> the next tick will see the tweet still in "scheduled" (or recovered to "failed") and
> dispatch again. Error 187 (duplicate_posted) catches identical text. For different
> accounts posting the same text, 187 won't help — but this is a rare edge case accepted
> as a trade-off. The lock timeout (5 min) is the safety net: if the function dies, the
> lock expires and stale recovery handles it.

```
Cron tick every 5 minutes
    │
    ▼
schedule-service.executeCronTick()
    │
    ├── 1. Recover stale locks (tweets stuck in "sending" > 5 min)
    │   └── CAS: sending → scheduled (lock expired, re-queue for dispatch)
    │
    ├── 2. Recover stale postings (tweets in "sending" > 2 min)
    │   └── CAS: sending → failed (server may have crashed)
    │       ⚠️ Accepted risk: tweet may have landed on X → duplicate on retry
    │       Error 187 (duplicate_posted) is the safety net for this case
    │
    ├── 3. Dispatch due tweets (scheduledAt ≤ now, status = "scheduled")
    │   └── Batch of 5 (time-budget: 8 seconds)
    │       └── For each:
    │           ├── Check circuit breaker (if open → skip)
    │           ├── CAS: scheduled → sending (acquires lock)
    │           ├── publishTweet() → CreateTweet path
    │           └── On success: CAS: sending → sent
    │               On failure: CAS: sending → failed
    │
    ├── 4. Retry failed tweets (retryCount < 3)
    │   └── Batch of 3
    │       └── CAS: failed → sending (single transition, NOT failed→scheduled→sending)
    │           ← Avoids double-hop: failed→scheduled would re-queue as "due tweet"
    │           ← which counts against the batch-of-5, starving fresh tweets
    │           └── publishTweet() → CreateTweet path
    │               On success: CAS: sending → sent
    │               On failure: CAS: sending → failed, increment retryCount
    │
    ├── 5. Refresh stale ct0 (>4h old)
    │
    ├── 6. Sync X-scheduled tweets (with error isolation per §6.5)
    │
    ├── 7. Pre-refresh caches (query IDs, pair-dict, headers)
    │
    └── 8. Time-budget check after each operation
        └── If >8s elapsed → stop, next tick continues
```

---

## 7. Cron Job System

### 7.1 Why Cron Is Essential (Not Replaceable)

| Reason | Detail |
|--------|--------|
| **Safety net** | If CreateScheduledTweet fails, cron dispatches via CreateTweet |
| **Overflow** | Accounts with >100 X-scheduled tweets need cron |
| **Immediate posts** | "Post Now" uses cron's dispatch logic |
| **Stale recovery** | Recovers crashed posting states and stale locks |
| **Sync** | Checks if X has posted scheduled tweets |
| **Retry** | Retries failed tweets up to 3 times |
| **Maintenance** | Refreshes stale ct0 tokens proactively |

### 7.2 Cron Tick (Every 5 Minutes)

```typescript
// Pseudocode for executeCronTick()
async function executeCronTick() {
  const startTime = Date.now();

  // 1. Recover stale locks (5 min)
  const staleRecovered = await recoverStaleLocks();

  // 2. Recover stale postings (2 min) ← NEW
  const stalePostingsRecovered = await recoverStalePostings();

  // 3. Dispatch due tweets (batch of 5)
  let dispatched = 0;
  const dueTweets = await getDueTweets(5);
  for (const tweet of dueTweets) {
    if (Date.now() - startTime > 8000) break; // time budget
    if (await isCircuitBreakerOpen(tweet.accountId)) continue;
    const result = await publishTweet(tweet.id, "cron");
    if (result.success) dispatched++;
  }

  // 4. Retry failed tweets (batch of 3)
  let retried = 0;
  const failedTweets = await getRetryableTweets(3);
  for (const tweet of failedTweets) {
    if (Date.now() - startTime > 8000) break;
    // CAS: failed → sending (single transition, NOT failed→scheduled→sending)
    const casResult = await transitionTweetStatus(tweet.id, "failed", "sending");
    if (!casResult.success) continue; // CAS failed (e.g., user cancelled meanwhile)
    const result = await publishTweet(tweet.id, "cron");
    if (result.success) retried++;
  }

  // 5. Refresh stale ct0 (>4h old)
  let ct0Refreshed = 0;
  const staleAccounts = await getStaleCt0Accounts();
  for (const account of staleAccounts) {
    if (Date.now() - startTime > 8000) break;
    const result = await refreshAccountCt0(account.id);
    if (result.success) ct0Refreshed++;
  }

  // 6. Sync X-scheduled tweets (with error isolation)
  let synced = 0;
  const xScheduledTweets = await getXScheduledTweets();
  for (const tweet of xScheduledTweets) {
    if (Date.now() - startTime > 8000) break;
    if (await syncSingleTweet(tweet)) synced++;
  }

  // 7. Pre-refresh caches
  if (Date.now() - startTime < 6000) { // only if budget remains
    await preRefreshCaches();
  }

  return { dispatched, retried, staleRecovered, stalePostingsRecovered, ct0Refreshed, synced };
}
```

---

## 8. Implementation Plan: Phase-by-Phase

### Phase 1: Critical Bug Fixes (P0) — Estimated: 6-8 hours

> **Time estimate corrected**: P0.4 (TID rewrite) alone is 4-6 hours. Total P0 is
> 6-8 hours, not the originally estimated 2-3 hours.

#### P0.1: Fix FetchScheduledTweets Response Key

**Problem**: `scheduled_tweets_list` (wrong) → `scheduled_tweet_list` (correct)  
**Impact**: ALL X-scheduled tweets falsely marked as "sent" → **silent data loss**

**Files**:
- `src/types/twitter.ts` — fix type definition
- `src/lib/twitter/scheduled-tweet.ts:136` — fix `parseFetchResult()`

**Change**:
```typescript
// BEFORE:
data?.data?.viewer?.scheduled_tweets_list  // ❌ WRONG

// AFTER:
data?.data?.viewer?.scheduled_tweet_list   // ✅ CORRECT (no 's' before _list)
```

**Verification**: Call FetchScheduledTweets → `data.viewer.scheduled_tweet_list` returns actual scheduled tweets.

---

#### P0.2: Update FALLBACK_QUERY_IDS to Live-Verified Values

**Problem**: 3/5 hardcoded IDs return "Query not found"  
**Impact**: CreateScheduledTweet, EditScheduledTweet, DeleteScheduledTweet all fail

**File**: `src/config/constants.ts`

**Change**:
```typescript
// BEFORE (3/5 stale):
CreateScheduledTweet: "LCVzRQGxGfG2tJy8m9NkwA",  // ❌ STALE
EditScheduledTweet: "ob2UB2qrq0GnsW9DV9_2pg",     // ❌ STALE
DeleteScheduledTweet: "fKDSuHbN1hn2OaVhLLTAQg",   // ❌ STALE

// AFTER (all live-verified 2026-05-27):
CreateScheduledTweet: "LCVzRQGxOaGnOnYH01NQXg",  // ✅ LIVE
EditScheduledTweet: "_mHkQ5LHpRRjSXKOcG6eZw",    // ✅ LIVE
DeleteScheduledTweet: "CTOVqej0JBXAZSwkp1US0g",   // ✅ LIVE
```

**Verification**: Test each ID against live X API.

---

#### P0.3: Replace Direct FALLBACK_QUERY_IDS with getQueryIds()

**Problem**: `scheduled-tweet.ts` uses `FALLBACK_QUERY_IDS.*` directly for 3/5 ops  
**Impact**: Bypasses dynamic resolution → always uses stale IDs

**File**: `src/lib/twitter/scheduled-tweet.ts`

**Changes**:
```typescript
// BEFORE (3 places):
const queryId = FALLBACK_QUERY_IDS.CreateScheduledTweet;  // ❌
const queryId = FALLBACK_QUERY_IDS.EditScheduledTweet;     // ❌
const queryId = FALLBACK_QUERY_IDS.DeleteScheduledTweet;   // ❌

// AFTER (all 3):
const queryIds = await getQueryIds();
const queryId = queryIds.CreateScheduledTweet;  // ✅
const queryIds = await getQueryIds();
const queryId = queryIds.EditScheduledTweet;     // ✅
const queryIds = await getQueryIds();
const queryId = queryIds.DeleteScheduledTweet;   // ✅
```

**Verification**: Create/Edit/Delete scheduled tweet succeed with dynamically resolved IDs.

---

#### P0.4: Fix TID Generation — Pair-Dict Primary + Live SVG Fallback

**Problem**: `encodeTid()` produces ~23-char TIDs (X requires ~94-char)  
**Impact**: X silently rejects → empty `tweet_results`

**Approach**: Complete rewrite of TID system using twt's proven pattern.

**⚠️ Runtime constraint**: `buildTransactionId()` uses Node.js `crypto` module
(`crypto.createHash('sha256')`, `crypto.randomInt()`). This does NOT work on
Edge Runtime. All route handlers using TID must explicitly set
`export const runtime = 'nodejs'` (which is the default for App Router, but
must be verified — do NOT use `export const runtime = 'edge'`).

**⚠️ Time estimate**: This is the most complex P0 task — realistically 4-6 hours.
It involves 4 new files with cubic bezier math, SVG animation parsing, ondemand
JS chunk parsing, pair-dict fetch + drastic-change guard, and crypto operations.
The pair.json format must also be verified against the actual schema before writing
parsing code — the plan assumes it has `verification` and `animationKey` fields but
this must be confirmed by reading the actual pair.json response.

**Files to create/modify**:
1. `src/lib/twitter/transaction-id-shared.ts` — **NEW**: `buildTransactionId()` core algorithm
2. `src/lib/twitter/transaction-id-pair.ts` — **NEW**: pair-dict primary method
3. `src/lib/twitter/transaction-id-html.ts` — **NEW**: HTML parsing + animation key
4. `src/lib/twitter/transaction-id-cubic.ts` — **NEW**: cubic bezier math
5. `src/lib/twitter/transaction-id.ts` — **REWRITE**: live SVG fallback + public API

**Core algorithm** (from twt, directly adaptable):
```typescript
// transaction-id-shared.ts
export const EPOCH_OFFSET_MS = 1682924400 * 1000; // 2023-05-01 00:00:00 UTC
export const X_TX_CONSTANTS = {
  keyword: 'obfiowerehiring',
  additionalRandom: 3,
} as const;

export function buildTransactionId(
  method: string,
  path: string,
  keyBytes: number[],
  animationKey: string
): string {
  const timeNow = Math.floor((Date.now() - EPOCH_OFFSET_MS) / 1000);
  const timeNowBytes = [
    timeNow & 0xff,
    (timeNow >> 8) & 0xff,
    (timeNow >> 16) & 0xff,
    (timeNow >> 24) & 0xff,
  ];
  const data = `${method}!${path}!${timeNow}${X_TX_CONSTANTS.keyword}${animationKey}`;
  const hashBytes = Array.from(
    crypto.createHash('sha256').update(data).digest()
  ).slice(0, 16);
  const randomNum = crypto.randomInt(256);
  const bytesArr = [...keyBytes, ...timeNowBytes, ...hashBytes, X_TX_CONSTANTS.additionalRandom];
  const out = Buffer.from([randomNum, ...bytesArr.map(item => item ^ randomNum)]);
  return out.toString('base64').replace(/=/g, '');
}
```

**Pair-dict method** (primary, zero x.com fetches):
```typescript
// transaction-id-pair.ts
// 1. Fetch pair.json from GitHub CDN (30 pre-computed pairs)
// 2. Drastic-change guard: if new count < 50% of cached, keep old
// 3. Crypto-secure random selection: crypto.randomInt(pairs.length)
// 4. Decode pair.verification (base64) → keyBytes
// 5. Use pair.animationKey as-is
// 6. buildTransactionId(method, path, keyBytes, animationKey) → 94-char TID
```

**Live SVG method** (fallback, ~500ms):
```typescript
// transaction-id.ts (rewritten)
// 1. Fetch x.com HTML (shared via html-cache.ts, 5-min TTL)
// 2. Parse <script> tags for verification key
// 3. Parse SVG animation frames ([id^='loading-x-anim'])
// 4. Extract dynamic index keys from ondemand.s.*.js
// 5. Compute animation key from SVG frames + indices
// 6. buildTransactionId(method, path, keyBytes, animationKey) → 94-char TID
```

**Public API**:
```typescript
// transaction-id.ts (new public API)
export async function generateTransactionId(
  method: string,
  path: string
): Promise<string | null> {
  // Layer 1: pair-dict (zero x.com fetches, 94-char)
  const pairId = await generateFromPair(method, path);
  if (pairId) {
    console.debug(`[TID] pair-dict: ${pairId.length} chars`);
    return pairId;
  }

  // Layer 2: live SVG (~500ms, 94-char)
  try {
    const svgId = await generateFromLiveSvg(method, path);
    if (svgId) {
      console.debug(`[TID] live-SVG: ${svgId.length} chars`);
      return svgId;
    }
  } catch (e) {
    console.warn('[TID] live SVG failed:', e);
  }

  // Layer 3: skip TID (graceful degradation)
  console.warn('[TID] all methods failed — proceeding without TID');
  return null;
}

export function clearTidCache(): void {
  clearPairCache();
  clearHtmlCache();
}
```

**Verification**: Generate TID → verify `length >= 90`. Post tweet → verify non-empty `tweet_results`.

---

#### P0.5: Add GraphQL.json as Primary Query ID Source

**Problem**: Only `placeholder.json` is fetched, which covers 2/5 operations  
**Impact**: 3/5 operations have no dynamic source

**Files**: `src/config/constants.ts`, `src/lib/twitter/query-id.ts`

**New resolution order** (5-layer):
```
1. In-memory cache (instant, 4h TTL)
2. GraphQL.json develop → ALL 5 ops (CDN, ~0ms)
3. GraphQL.json master → ALL 5 ops (CDN, ~0ms)
4. placeholder.json + ondemand.ComposeScheduling chunk (live, ~500ms)
5. FALLBACK_QUERY_IDS (hardcoded, 0ms) — NOT persisted to DB
```

**GraphQL.json parsing** (with null safety — every access guarded):
```typescript
// GraphQL.json is an array of entries
const data = await resp.json();
if (!Array.isArray(data)) {
  console.warn('[QueryID] GraphQL.json is not an array');
  return null; // fall through to next layer
}
const entry = data.find((e: any) => e?.exports?.operationName === 'CreateScheduledTweet');
if (!entry?.exports?.queryId) {
  console.warn(`[QueryID] GraphQL.json missing CreateScheduledTweet (entry=${!!entry})`);
  return null; // fall through to next layer
}
const queryId = entry.exports.queryId;
const features = entry.exports?.metadata?.featureSwitches ?? []; // [] for scheduled ops
const fieldToggles = entry.exports?.metadata?.fieldToggles ?? []; // [] for scheduled ops
```

**New constants**:
```typescript
// constants.ts additions
export const GRAPHQL_JSON_DEVELOP_URL =
  "https://raw.githubusercontent.com/fa0311/TwitterInternalAPIDocument/develop/docs/json/GraphQL.json";
export const GRAPHQL_JSON_MASTER_URL =
  "https://raw.githubusercontent.com/fa0311/TwitterInternalAPIDocument/master/docs/json/GraphQL.json";
export const GRAPHQL_JSON_CACHE_MS = 6 * 60 * 60 * 1000; // 6h
```

**Verification**: On startup, log shows all 5 query IDs resolved from GraphQL.json.

---

### Phase 2: Self-Healing Infrastructure (P1)

#### P1.1: Table-Driven Error Classification

**File**: `src/lib/utils/error-classifier.ts` — REWRITE

```typescript
export type ErrorClass =
  | 'stale_cache'    // Clear caches → retry once
  | 'transient'      // Jittered retry up to 3x
  | 'auth_failure'   // ct0 refresh → retry once
  | 'rate_limit'     // Wait + circuit breaker
  | 'stealth_ban'    // Mark account inactive
  | 'duplicate_posted' // Phantom success → recover
  | 'terminal';      // Fail the tweet

export type RetryDecision = 'clear_and_continue' | 'continue' | 'bail';

const ERROR_PATTERNS: [RegExp, ErrorClass][] = [
  // Stale cache (query IDs, headers, TID)
  [/code: 48/i, 'stale_cache'],
  [/HTTP 404/, 'stale_cache'],
  [/Query not found/i, 'stale_cache'],
  [/code: 344/, 'stale_cache'],

  // Transient
  [/HTTP 226/, 'transient'],
  [/code: 226/, 'transient'],
  [/might be automated/i, 'transient'],

  // Auth failure
  [/HTTP 401/, 'auth_failure'],
  [/Could not authenticate/i, 'auth_failure'],

  // Rate limit
  [/HTTP 429/, 'rate_limit'],
  [/code: 88/, 'rate_limit'],
  [/Rate limit exceeded/i, 'rate_limit'],

  // Stealth ban
  [/code: 353/, 'stealth_ban'],
  [/suspended/i, 'stealth_ban'],
  [/code: 64/, 'stealth_ban'],

  // Duplicate (phantom success)
  [/code: 187/, 'duplicate_posted'],

  // Terminal (Xweet-specific scheduled op patterns)
  [/GRAPHQL_VALIDATION_FAILED/, 'terminal'],
  [/code: 214/, 'terminal'],  // Invalid queryId in body
];

export function classifyError(error: string): ErrorClass {
  for (const [pattern, cls] of ERROR_PATTERNS) {
    if (pattern.test(error)) return cls;
  }
  return 'terminal';
}

export function shouldRetry(attempt: number, errorClass: ErrorClass): RetryDecision {
  if (errorClass === 'stale_cache' && attempt === 0) return 'clear_and_continue';
  if (errorClass === 'transient' && attempt < 3) return 'continue';
  if (errorClass === 'auth_failure' && attempt === 0) return 'continue';
  return 'bail';
}
```

**Verification**: Unit test each pattern.

---

#### P1.2: 4-Layer Response Parsing

**File**: `src/lib/twitter/client.ts` — add response parsing types + functions

```typescript
// Discriminated union for CreateTweet
export type CreateTweetOutcome =
  | { kind: 'success'; tweetId: string }
  | { kind: 'empty_results' }
  | { kind: 'graphql_error'; error: string; errorClass: ErrorClass }
  | { kind: 'unknown_failure'; body: unknown };

// Discriminated union for CreateScheduledTweet
export type CreateScheduledTweetOutcome =
  | { kind: 'success'; restId: string }
  | { kind: 'graphql_error'; error: string; errorClass: ErrorClass }
  | { kind: 'unknown_failure'; body: unknown };

// Discriminated union for Edit/Delete ScheduledTweet
export type ScheduledMutationOutcome =
  | { kind: 'done' }
  | { kind: 'graphql_error'; error: string; errorClass: ErrorClass }
  | { kind: 'unknown_failure'; body: unknown };

// Discriminated union for FetchScheduledTweets
export type FetchScheduledOutcome =
  | { kind: 'list'; items: TwitterScheduledTweetItem[] }
  | { kind: 'graphql_error'; error: string; errorClass: ErrorClass }
  | { kind: 'unknown_failure'; body: unknown };

function parseCreateTweetResponse(body: unknown): CreateTweetOutcome {
  const data = body as any;
  // Layer 1: tweetId present = success
  const tweetId = data?.data?.create_tweet?.tweet_results?.result?.rest_id;
  if (tweetId) return { kind: 'success', tweetId };
  // Layer 2: empty tweet_results
  const results = data?.data?.create_tweet?.tweet_results;
  if (results && Object.keys(results).length === 0) return { kind: 'empty_results' };
  // Layer 3: GraphQL errors
  const errors = data?.errors;
  if (errors?.length > 0) {
    const errorStr = JSON.stringify(errors);
    return { kind: 'graphql_error', error: errorStr, errorClass: classifyError(errorStr) };
  }
  // Layer 4: unknown
  return { kind: 'unknown_failure', body };
}
```

**Verification**: Test with actual X API responses for each operation type.

---

#### P1.3: Stale Auto-Recovery in resilientApiCall()

**File**: `src/lib/twitter/client.ts` — add `resilientApiCall()`

> **⚠️ FACTORY PATTERN — the most important design decision in this plan.**
> The parameter is a **factory** (called fresh each attempt), NOT a closure with
> pre-resolved values. This is the fix for the critical bug where clearing caches
> had no effect because `fn()` reused stale values from its closure.

```typescript
/**
 * Executes an API call with automatic retry and stale-data recovery.
 * 
 * CRITICAL: `factory` is called fresh on EACH attempt. This means query IDs,
 * TIDs, and headers are re-resolved from (potentially cleared) caches on retry.
 * Do NOT resolve these outside the factory — that defeats the entire purpose.
 */
export async function resilientApiCall<T>(
  factory: () => Promise<T>,  // ← FACTORY, not closure with pre-resolved values
  attempt = 0
): Promise<T> {
  try {
    return await factory();  // ← calls factory fresh each time
  } catch (error) {
    const errorStr = error instanceof Error ? error.message : String(error);
    const errorClass = classifyError(errorStr);
    const decision = shouldRetry(attempt, errorClass);

    switch (decision) {
      case 'clear_and_continue':
        // Clear all caches — stale data may be interconnected
        clearQueryIdCache();
        clearTidCache();
        clearHeaderCache();
        console.warn(`[resilientApiCall] Stale data detected, clearing caches and retrying (attempt ${attempt})`);
        return resilientApiCall(factory, attempt + 1);  // ← factory re-resolves

      case 'continue':
        // Jittered retry for transient errors
        await waitBeforeRetry(attempt);
        console.warn(`[resilientApiCall] Transient error, retrying (attempt ${attempt})`);
        return resilientApiCall(factory, attempt + 1);  // ← factory re-resolves

      case 'bail':
        throw error;
    }
  }
}
```

**Call-site example** (must resolve inside factory):
```typescript
// ✅ CORRECT — factory resolves fresh on each attempt
const result = await resilientApiCall(async () => {
  const queryIds = await getQueryIds();       // re-resolved from (cleared) cache
  const tid = await generateTransactionId('POST', apiPath);  // re-resolved
  const headers = await getHeaders();         // re-resolved
  return xFetch({
    url: buildUrl(queryIds.CreateTweet, 'CreateTweet'),
    headers: { ...headers, 'x-client-transaction-id': tid },
    body: JSON.stringify({ variables, queryId: queryIds.CreateTweet, features }),
  });
});
```

**Verification**: Use intentionally stale query ID → confirm auto-recovery triggers.

---

#### P1.4: Upgrade Circuit Breaker with Failure Window

**File**: `src/lib/twitter/circuit-breaker.ts` — UPDATE

**Key improvements**:
1. Only count failures within a 30-min window (prevents old failures from triggering false positives)
2. Skip non-transient failures (auth_failure, rate_limit, stealth_ban, duplicate_posted don't count)
3. Auto-reset on expiry with conditional SQL

```typescript
export async function recordFailure(
  accountId: string,
  errorClass?: ErrorClass
): Promise<CircuitState> {
  // Skip non-real failures
  if (errorClass && ['auth_failure', 'rate_limit', 'stealth_ban', 'duplicate_posted'].includes(errorClass)) {
    return getCircuitState(accountId); // Don't increment
  }

  const account = await db.account.findUnique({
    where: { id: accountId },
    select: { failureCount: true, lastFailureAt: true },
  });

  // Reset count if last failure was >30 min ago (window expired)
  const windowMs = 30 * 60 * 1000;
  const withinWindow = account?.lastFailureAt &&
    (Date.now() - account.lastFailureAt.getTime()) < windowMs;

  const newCount = withinWindow ? (account?.failureCount ?? 0) + 1 : 1;
  const shouldOpen = newCount >= CIRCUIT_FAILURE_THRESHOLD;

  await db.account.update({
    where: { id: accountId },
    data: {
      failureCount: newCount,
      lastFailureAt: new Date(),
      circuitOpenUntil: shouldOpen ? new Date(Date.now() + CIRCUIT_COOLDOWN_MS) : null,
    },
  });

  return {
    isOpen: shouldOpen,
    failureCount: newCount,
    cooldownUntil: shouldOpen ? new Date(Date.now() + CIRCUIT_COOLDOWN_MS) : null,
  };
}
```

**Schema change**: Add `lastFailureAt DateTime?` field to Account model in Prisma schema.
Migration must handle existing rows: NULL default is fine (treated as "no recent failure"),
but this must be explicitly handled in the query (checked above as `account?.lastFailureAt`).

**Verification**: 3 transient failures within 30 min → circuit opens. Wait 30 min → auto-closes.

---

#### P1.5: Wire editScheduledTweet() into Update Flow

**Files**: `src/app/api/tweets/[id]/route.ts`, `src/lib/services/tweet-service.ts`

```typescript
// In PUT handler:
if (tweet.status === TWEET_STATUS.X_SCHEDULED && tweet.scheduledTweetRestId) {
  // Tweet is X-scheduled — must update both X and DB
  await editScheduledTweet({
    cookies: decryptedCookies,
    ct0: parsedCt0,
    scheduledTweetRestId: tweet.scheduledTweetRestId,
    text: updatedText,
    executeAt: updatedTime,  // REQUIRED (live-verified!)
    mediaIds: updatedMediaIds,
  });
}
// Then update DB
```

**Verification**: Edit X-scheduled tweet → confirm X reflects changes.

---

### Phase 3: Resilience Patterns (P2)

#### P2.1: Phantom Success Recovery (Error 187)

**File**: `src/lib/services/tweet-service.ts`

```typescript
// In publishTweet() catch block:
if (errorClass === 'duplicate_posted') {
  // The tweet IS on X — this is a phantom success
  await transitionTweetStatus(tweetId, TWEET_STATUS.SENDING, TWEET_STATUS.SENT, {
    postedAt: new Date(),
  });
  return { success: true, tweetId: 'recovered-duplicate' };
}
```

---

#### P2.2: Jittered Exponential Backoff

**File**: `src/lib/utils/retry.ts` — UPDATE

```typescript
const RETRY_DELAYS = [1000, 2000, 4000];

export async function waitBeforeRetry(failedAttempt: number): Promise<void> {
  const base = RETRY_DELAYS[failedAttempt] ?? 4000;
  const jitter = Math.round(base * (0.8 + crypto.randomInt(501) / 1000));
  await new Promise(resolve => setTimeout(resolve, jitter));
}
```

---

#### P2.3: Stale Posting Recovery

**File**: `src/lib/services/schedule-service.ts` — ADD

```typescript
const POSTING_STALE_MS = 2 * 60 * 1000; // 2 minutes

export async function recoverStalePostings(): Promise<number> {
  const staleCutoff = new Date(Date.now() - POSTING_STALE_MS);
  const result = await db.tweet.updateMany({
    where: {
      status: TWEET_STATUS.SENDING,
      updatedAt: { lte: staleCutoff },
    },
    data: {
      status: TWEET_STATUS.FAILED,
      error: '[Auto-recovered] Posting timed out — possible server crash.',
    },
  });
  return result.count;
}
```

**Call from**: `executeCronTick()` step 2.

---

#### P2.4: Complete Chrome Browser Fingerprint Headers

**File**: `src/lib/twitter/headers.ts` — ADD static fallback

```typescript
const STATIC_CHROME_HEADERS: Record<string, string> = {
  'X-Twitter-Auth-Type': 'OAuth2Session',
  'X-Twitter-Active-User': 'yes',
  'X-Twitter-Client-Language': 'en',
  'sec-ch-ua': '"Chromium";v="148", "Google Chrome";v="148", "Not/A)Brand";v="99"',
  'sec-ch-ua-mobile': '?0',
  'sec-ch-ua-platform': '"Linux"',
  'sec-fetch-dest': 'empty',
  'sec-fetch-mode': 'cors',
  'sec-fetch-site': 'same-origin',
  'cache-control': 'no-cache',
  'pragma': 'no-cache',
  'priority': 'u=1, i',
  'Accept': '*/*',
  'Accept-Language': 'en-US,en;q=0.9',
};
```

---

#### P2.5: Shared HTML Cache Between Query ID and TID

**File**: `src/lib/cache/html-cache.ts` — NEW (moved from lib/twitter/ — it's shared infrastructure)

```typescript
let cachedHtml: string | null = null;
let cachedHtmlAt = 0;
const HTML_CACHE_MS = 5 * 60 * 1000; // 5 minutes

export async function fetchXcomHtml(): Promise<string | null> {
  if (cachedHtml && Date.now() - cachedHtmlAt < HTML_CACHE_MS) {
    return cachedHtml;
  }

  try {
    const resp = await fetch("https://x.com", {
      headers: { "User-Agent": "Mozilla/5.0 ...", Accept: "text/html" },
      signal: AbortSignal.timeout(10000),
    });
    if (resp.ok) {
      cachedHtml = await resp.text();
      cachedHtmlAt = Date.now();
      return cachedHtml;
    }
  } catch {}

  return cachedHtml; // Return stale cache if fetch fails
}

export function clearHtmlCache(): void {
  cachedHtml = null;
  cachedHtmlAt = 0;
}
```

---

### Phase 4: Nice-to-Haves (P3)

#### P2.6: Features as Single Source of Truth

**File**: `src/lib/twitter/features.ts` — NEW

**Problem**: CreateTweet features are hardcoded in `post-tweet.ts`. Wrong features on
a scheduled tweet operation cause silent failures on X's end. Scheduled ops need `[]`
(features), CreateTweet needs 36 specific flags. This is a correctness concern, not
just maintainability.

```typescript
// features.ts — Single source of truth
export const CREATE_TWEET_FEATURES: Record<string, boolean> = {
  "premium_content_api_read_enabled": false,
  "communities_web_enable_tweet_community_results_fetch": true,
  // ... all 36 flags from placeholder.json
};

export const SCHEDULED_OP_FEATURES: Record<string, boolean> = {}; // Empty for scheduled ops

export const CREATE_TWEET_FIELD_TOGGLES: Record<string, boolean> = {}; // From GraphQL.json metadata
```

> **Bumped from LOW to MEDIUM**: Wrong features = silent failure. This isn't just
> code organization — it's a correctness guarantee.

---

### Phase 4: Nice-to-Haves (P3)

#### P3.1: XPFF Header
- Implement only if testing shows it reduces error 344
- Algorithm: AES-256-GCM with SHA-256 key derivation
- 5-minute validity — must regenerate frequently

#### P3.2: Draft Tweet APIs
- queryIds available from ondemand.ComposeScheduling chunk
- CreateDraftTweet, FetchDraftTweets, EditDraftTweet, DeleteDraftTweet
- Same format as scheduled but without `execute_at`

#### P3.3: DB-Backed Rate Limiting
- Current in-memory Map doesn't persist across server restarts
- Use DB-backed approach (like circuit breaker)
- Low priority since Xweet isn't high-throughput

---

## 9. Verification & Validation

### 9.1 P0 Verification Matrix

| Test Case | Operation | Expected Result | How to Verify |
|-----------|-----------|----------------|---------------|
| Response key fix | FetchScheduledTweets | Returns actual data | `data.viewer.scheduled_tweet_list.length > 0` |
| CreateScheduledTweet | CreateScheduledTweet | Tweet created | Response has `data.tweet.rest_id` |
| EditScheduledTweet | EditScheduledTweet | Tweet updated | Response: `{"data":{"scheduledtweet_put":"Done"}}` |
| DeleteScheduledTweet | DeleteScheduledTweet | Tweet deleted | Response: `{"data":{"scheduledtweet_delete":"Done"}}` |
| TID generation | Any tweet | 94-char TID | `tid.length >= 90` |
| GraphQL.json resolution | Server startup | All 5 IDs resolved | Log shows 5 IDs |
| Dynamic queryIds | All scheduled ops | All use getQueryIds() | No direct FALLBACK references |

### 9.2 P1 Verification Matrix

| Test Case | Operation | Expected Result | How to Verify |
|-----------|-----------|----------------|---------------|
| Stale auto-recovery | Post with stale ID | Auto-retry succeeds | Log: "clearing caches and retrying" |
| Error classification | Various errors | Correct ErrorClass | `classifyError("code: 48")` → `'stale_cache'` |
| Circuit breaker opens | 3 failures | Account paused | `isCircuitBreakerPaused()` → true |
| Circuit breaker auto-reset | After 30 min | Account resumes | `isCircuitBreakerPaused()` → false |
| EditScheduledTweet sync | Edit tweet | X reflects changes | FetchScheduledTweets shows new text |
| Failure window | Fail, wait 30min, fail | Count resets | Only new failures counted |

### 9.3 P2 Verification Matrix

| Test Case | Operation | Expected Result | How to Verify |
|-----------|-----------|----------------|---------------|
| Phantom success (187) | Duplicate post | Recovered to 'sent' | Status transitions to 'sent' |
| Jittered retry | Transient error | Delays 80-130% | Log shows variable delays |
| Stale posting recovery | Kill mid-post | Auto-recovered | Next cron tick recovers |
| Header fallback | header.json down | Static headers used | Request succeeds |
| Shared HTML cache | Query ID + TID both need x.com | Only 1 fetch | Log: 1 x.com fetch per 5 min |

### 9.4 End-to-End Validation

**Full scheduled tweet lifecycle test**:

1. ✅ Create account → verify → circuit is closed
2. ✅ Create scheduled tweet → `scheduledTweetRestId` saved in DB
3. ✅ FetchScheduledTweets → `scheduled_tweet_list` returns our tweet
4. ✅ Edit scheduled tweet (text + time) → X reflects changes
5. ✅ Wait for scheduled time → X posts the tweet
6. ✅ Delete scheduled tweet before it posts → X removes it
7. ✅ Use stale query ID → auto-recovery triggers → retry succeeds
8. ✅ Trigger 3 transient failures → circuit breaker opens
9. ✅ Wait 30 min → circuit breaker auto-resets
10. ✅ Kill server during posting → stale posting recovery on next tick
11. ✅ Create tweet with >100 existing → falls back to cron path
12. ✅ Post duplicate → phantom success recovery to 'sent'
13. ✅ Cron tick dispatches due tweets
14. ✅ Cron tick refreshes ct0 + syncs X-scheduled (merged from maintenance)

### 9.5 Regression Prevention Rules

1. **Never persist FALLBACK_QUERY_IDS to DB** — prevents stale fallback from blocking fresh data
2. **Always use `getQueryIds()` for all 5 operations** — no direct FALLBACK references allowed
3. **Response key is `scheduled_tweet_list`** — add comment: "NOT scheduled_tweets_list!"
4. **`execute_at` is REQUIRED for EditScheduledTweet** — add Zod validation
5. **TID must be ≥ 90 chars** — add assertion: `if (tid && tid.length < 90) warn()`
6. **CreateScheduledTweet response**: `data.tweet.rest_id` (NOT `data.create_scheduled_tweet.*`)
7. **`execute_at`**: Create = seconds, Fetch = milliseconds — always convert!
8. **`ascending: false`** required in FetchScheduledTweets body — enforce via Zod schema
9. **resilientApiCall must use FACTORY pattern** — never pass a closure with pre-resolved values
10. **Sync must check fetch outcome BEFORE marking as sent** — error → skip account
11. **`sending` state cannot be cancelled** — reject with "currently posting"
12. **Retry path: `failed → sending` (single CAS)** — never double-hop through `scheduled`
13. **Video media: reject if scheduled > 14 days** — amplify_video 15-day expiry
14. **All route handlers using TID must use Node.js runtime** — not Edge Runtime

---

## 10. Risk Assessment & Mitigations

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| GraphQL.json stale | Low (daily CI) | Medium | ondemand chunk live extraction as fallback |
| pair.json CDN down | Low | Low | Live SVG TID fallback |
| X changes TID algorithm | Low | High | pair-dict uses pre-computed values from real browser |
| X changes response format | Medium | Medium | 4-layer response parsing handles multiple formats |
| Circuit breaker false positive | Low | Low | Failure window + skip non-transient errors |
| editScheduledTweet breaks X state | Low | High | Must re-send complete `post_tweet_request` |
| Cron missed (cron-job.org down) | Low | High | Next tick picks up; X-scheduled tweets are independent |
| Vercel 10s timeout during dispatch | Medium | Medium | Time-budget guard (8s) + batch processing |
| All query ID sources fail | Very Low | Critical | Hardcoded FALLBACK_QUERY_IDS as last resort |
| All TID sources fail | Low | Medium | Skip TID (graceful degradation) |
| Header.json down | Low | Low | Static Chrome headers fallback |
| Vercel timeout → duplicate post | Medium | Low | Error 187 (duplicate_posted) catches at X's end |
| Sync error → false "sent" | Medium | High | Fetch outcome check before marking (§6.5) |
| Video media >14 days → broken | Medium | High | Reject video for >14-day scheduling (§6.2) |
| Code 344 misclassified as stale | Low | Low | 344 can also mean TID/header issues; clearing ALL caches is still correct |

---

## 11. Reference Data & Constants

### 11.1 Data Source URLs

```typescript
// PRIMARY — covers ALL 5 operations, auto-updated daily
const GRAPHQL_JSON_DEVELOP_URL =
  "https://raw.githubusercontent.com/fa0311/TwitterInternalAPIDocument/develop/docs/json/GraphQL.json";
const GRAPHQL_JSON_MASTER_URL =
  "https://raw.githubusercontent.com/fa0311/TwitterInternalAPIDocument/master/docs/json/GraphQL.json";

// SECONDARY — covers CreateTweet + FetchScheduledTweets
const PLACEHOLDER_URL =
  "https://raw.githubusercontent.com/fa0311/twitter-openapi/main/src/config/placeholder.json";

// TID pair-dict
const PAIR_JSON_URL =
  "https://raw.githubusercontent.com/fa0311/x-client-transaction-id-pair-dict/main/pair.json";

// Headers
const HEADER_JSON_URL =
  "https://raw.githubusercontent.com/fa0311/latest-user-agent/main/header.json";
```

### 11.2 Live-Verified Query IDs (2026-05-27)

| Operation | Query ID | Live-Tested? |
|-----------|----------|:------------:|
| CreateTweet | `H-t2v_HvFR07ZBP9aOeKoA` | ✅ |
| CreateScheduledTweet | `LCVzRQGxOaGnOnYH01NQXg` | ✅ |
| FetchScheduledTweets | `ffT6na2E9ReT4yfB5uzw_g` | ✅ |
| EditScheduledTweet | `_mHkQ5LHpRRjSXKOcG6eZw` | ✅ |
| DeleteScheduledTweet | `CTOVqej0JBXAZSwkp1US0g` | ✅ |

### 11.3 TID Constants

```typescript
const EPOCH_OFFSET_MS = 1682924400 * 1000; // 2023-05-01 00:00:00 UTC
const TX_KEYWORD = "obfiowerehiring";
const TX_ADDITIONAL_RANDOM = 3;
```

### 11.4 X Bearer Token (Public)

```
AAAAAAAAAAAAAAAAAAAAANRILgAAAAAAnNwIzUejRCOuH5E6I8xnZz4puTs%3D1Zv7ttfk8LF81IUq16cHjhLTvJu4FA33AGWWjCpTnA
```

### 11.5 API Gotchas Reference

| ❌ Mistake | ✅ Correct |
|-----------|-----------|
| `media_entities` in CreateScheduledTweet | Use `media_ids: ["id1", "id2"]` |
| Including `queryId` in scheduled/draft body | Only in URL path (body → error 214) |
| Empty `{}` for FetchScheduledTweets | Must include `{ascending: false}` |
| Using `scheduled_at` in CreateScheduledTweet | Use `execute_at` (Unix seconds) |
| Using `tweet_id` in DeleteScheduledTweet | Use `scheduled_tweet_id` |
| `scheduled_tweets_list` in FetchResponse | Key is `scheduled_tweet_list` |
| Comparing execute_at directly (Create vs Fetch) | Create = seconds, Fetch = milliseconds |
| Partial update in EditScheduledTweet | Must re-send complete `post_tweet_request` |
| Omitting `execute_at` in EditScheduledTweet | CAUSES ERROR — required (live-verified) |
| `data.create_scheduled_tweet.scheduled_tweet.rest_id` | Actual: `data.tweet.rest_id` (live-verified) |

---

## 12. Appendix: Current Bugs Inventory

| # | Severity | File | Bug | Impact |
|---|----------|------|-----|--------|
| 1 | 🔴 CRITICAL | `scheduled-tweet.ts:136` | `scheduled_tweets_list` → should be `scheduled_tweet_list` | Silent data loss |
| 2 | 🔴 CRITICAL | `types/twitter.ts:51` | Same wrong key in type definition | Same |
| 3 | 🔴 CRITICAL | `scheduled-tweet.ts:45` | `FALLBACK_QUERY_IDS.CreateScheduledTweet` direct | Stale ID → fails |
| 4 | 🔴 CRITICAL | `scheduled-tweet.ts:166` | `FALLBACK_QUERY_IDS.EditScheduledTweet` direct | Same |
| 5 | 🔴 CRITICAL | `scheduled-tweet.ts:198` | `FALLBACK_QUERY_IDS.DeleteScheduledTweet` direct | Same |
| 6 | 🔴 CRITICAL | `transaction-id.ts:65-71` | `encodeTid()` produces ~23-char TIDs | X silently rejects |
| 7 | 🔴 CRITICAL | `constants.ts:66-72` | 3/5 FALLBACK_QUERY_IDS are stale | Scheduled ops fail |
| 8 | 🔴 HIGH | `query-id.ts` | Only placeholder.json source | 3/5 ops have no dynamic source |
| 9 | 🔴 HIGH | `client.ts` | No stale query ID error detection | No auto-recovery |
| 10 | 🔴 HIGH | `schedule-service.ts:235` | syncSingleTweet uses broken fetchScheduledTweets | Falsely marks as "sent" |
| 11 | ⚠️ MEDIUM | `scheduled-tweet.ts` | `editScheduledTweet()` defined but never called | Edit only updates DB |
| 12 | ⚠️ MEDIUM | `tweets/[id]/route.ts` | PUT doesn't call editScheduledTweet | Same |
| 13 | ⚠️ MEDIUM | `error-classifier.ts` | Missing stale query ID codes (48, 353, 344) | No stale detection |
| 14 | ⚠️ MEDIUM | `transaction-id.ts:121` | Lqm1 fetches new document every call | Performance waste |
| 15 | ⚠️ MEDIUM | `features.ts` | Does not exist — features hardcoded in post-tweet.ts | Wrong features = silent failure on scheduled ops |

---

## Implementation Order Summary

```
Phase 1 (P0) — CRITICAL: Must do first, blocks all other work (6-8h)
  ├── P0.1: Fix scheduled_tweet_list response key
  ├── P0.2: Update FALLBACK_QUERY_IDS to live values
  ├── P0.3: Replace direct FALLBACK with getQueryIds()
  ├── P0.4: Fix TID generation (pair-dict + live SVG) [4-6h alone]
  └── P0.5: Add GraphQL.json as primary source

Phase 2 (P1) — SELF-HEALING: Makes the system resilient (3-4h)
  ├── P1.1: Table-driven error classification (7 classes)
  ├── P1.2: 4-layer response parsing (discriminated union)
  ├── P1.3: Stale auto-recovery (resilientApiCall FACTORY pattern)
  ├── P1.4: Circuit breaker upgrade (failure window, DB-persisted)
  └── P1.5: Wire editScheduledTweet into update flow

Phase 3 (P2) — RESILIENCE: Defense in depth (3-4h)
  ├── P2.1: Phantom success recovery (error 187)
  ├── P2.2: Jittered exponential backoff
  ├── P2.3: Stale posting recovery (2-min timeout)
  ├── P2.4: Complete Chrome fingerprint headers
  ├── P2.5: Shared HTML cache (lib/cache/, query ID + TID)
  └── P2.6: Features as single source of truth (correctness)

Phase 4 (P3) — NICE-TO-HAVE: Polish
  ├── P3.1: XPFF header (if testing shows value)
  ├── P3.2: Draft Tweet APIs
  └── P3.3: DB-backed rate limiting
```

**Estimated effort**: P0 = 6-8h, P1 = 3-4h, P2 = 3-4h, P3 = as needed

**Each phase is independently deployable** — P0 fixes can ship while P1 is in development.
