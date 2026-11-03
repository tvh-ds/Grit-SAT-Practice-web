# Student performance: measured latency report

## Result

The staging changes substantially improved submissions and vocabulary reviews under seven concurrent synthetic users. The final run recorded **zero request errors** across 840 measured calls and passed the score, persistence, retry, rollback, and vocabulary-consistency checks.

Staging does **not** fully meet the agreed latency targets yet: full-test start, full-test resume, and 20-question practice start remain above the 2-second p95 navigation target. Test listing meets it narrowly at 1,993.9 ms. These are staging measurements; the user accepted the remaining misses and requested release.

Largest p95 improvements:

- 98-question submit: 28,660.0 → 2,269.4 ms (**92.1% faster**); concurrent retry: 29,437.6 → 2,311.6 ms (**92.1% faster**).
- 20-question submit: 7,888.6 → 1,913.1 ms (**75.7% faster**).
- Vocabulary review: 2,772.5 → 978.9 ms (**64.7% faster**).
- Test listing: 3,959.4 → 1,993.9 ms (**49.6% faster**).

## Test setup

| Item | Details |
|---|---|
| Environment | Supabase staging project `wgkggknyndgaoyazdhdf`, region `ap-southeast-1`; production is in the same region. Staging/production compute tier was not available in the checked metadata. |
| Load generator | Windows runner in Helsinki, Finland (`Europe/Helsinki`); measured client-to-Edge Function request latency, not browser-render or whole-page time. The transcontinental client route is a limitation when interpreting user-perceived latency. |
| Synthetic fixture | 7 students, 14 test assignments, 98 distinct multiple-choice questions with 392 choices, a 98-question full test (27/27/22/22 modules), a 20-question practice test reusing the first 20 questions, 120 vocabulary cards, and 3 small image objects linked from 9 questions. Existing staging catalog data remained present. |
| Workload | 10 waves × 7 concurrent students; 70 samples per action. Same accounts and fixture reused; students logged in again for each wave with 60 seconds between waves. Before and after used the same staging project and data. |
| Before run | `perf-20260925210352-4e84f7fc`; 2026-09-25 21:04:04.062–21:24:06.691 UTC. |
| After run | Same run ID and fixture; 2026-09-25 22:18:54.698–22:31:25.867 UTC. |
| Revision | Git HEAD `342931e` for both runs; the measured implementation was in the working tree. Submission source SHA-256: before `7ad47921f575e265f3b10cfc9e2cb73360b774f723cb9c4daabf8fec47d321d9`, after `87b86e3712ff79e479b582aa0227d6d140a6dcf15cf0346dd42abbf6c5126c3b`. |
| Active staging function versions | `student-attempts` v5, `student-responses` v3, `student-scores` v3, `student-submit` v4, `student-tests` v5, `student-vocab` v5. |

Percentiles use nearest-rank over all 70 samples, including failed requests. Each latency cell is **p50 / p95 / p99 / maximum, in milliseconds**. `p95 Δ` is after minus before; a negative value is faster.

## Before and after

| Action | Before p50 / p95 / p99 / max (ms) | After p50 / p95 / p99 / max (ms) | p95 Δ (ms) | p95 change | Errors before → after | Target / result |
|---|---:|---:|---:|---:|---:|---|
| Login | 767.3 / 906.4 / 933.2 / 933.2 | 728.0 / 1,298.1 / 1,302.4 / 1,302.4 | +391.7 | 43.2% slower | 0 → 0 | No latency target; no errors |
| Test listing | 2,232.1 / 3,959.4 / 6,124.8 / 6,124.8 | 1,579.5 / 1,993.9 / 2,420.6 / 2,420.6 | −1,965.5 | 49.6% faster | 1 (500) → 0 | <2,000 ms; pass narrowly |
| Full-test start (98 Q) | 5,633.2 / 6,664.7 / 7,076.6 / 7,076.6 | 2,158.9 / 3,556.1 / 3,635.0 / 3,635.0 | −3,108.6 | 46.6% faster | 0 → 0 | <2,000 ms; **miss** |
| Full-test resume (98 Q) | 4,562.7 / 5,607.1 / 5,793.5 / 5,793.5 | 1,718.9 / 3,250.7 / 3,350.6 / 3,350.6 | −2,356.4 | 42.0% faster | 0 → 0 | <2,000 ms; **miss** |
| Practice-test start (20 Q) | 4,864.2 / 6,174.8 / 6,526.4 / 6,526.4 | 1,832.5 / 2,386.0 / 2,798.4 / 2,798.4 | −3,788.8 | 61.4% faster | 0 → 0 | <2,000 ms; **miss** |
| Answer save | 1,886.2 / 2,199.1 / 3,633.1 / 3,633.1 | 1,908.9 / 2,171.7 / 2,303.7 / 2,303.7 | −27.4 | 1.2% faster | 0 → 0 | No explicit latency target; save barrier/error handling tested |
| Practice submission (20 Q) | 7,002.0 / 7,888.6 / 8,729.2 / 8,729.2 | 1,707.8 / 1,913.1 / 1,956.6 / 1,956.6 | −5,975.5 | 75.7% faster | 0 → 0 | <5,000 ms; pass |
| Vocabulary dashboard | 1,935.7 / 2,402.2 / 3,232.1 / 3,232.1 | 1,368.5 / 1,574.1 / 1,714.7 / 1,714.7 | −828.1 | 34.5% faster | 0 → 0 | <2,000 ms; pass |
| Vocabulary study queue | 1,478.4 / 1,830.1 / 2,341.5 / 2,341.5 | 1,482.5 / 1,622.0 / 1,689.7 / 1,689.7 | −208.1 | 11.4% faster | 0 → 0 | <2,000 ms; pass |
| Vocabulary review | 2,327.0 / 2,772.5 / 3,329.3 / 3,329.3 | 844.3 / 978.9 / 1,333.4 / 1,333.4 | −1,793.6 | 64.7% faster | 0 → 0 | <2,000 ms; pass |
| Full-test submission (98 Q) | 27,613.4 / 28,660.0 / 30,726.5 / 30,726.5 | 1,961.2 / 2,269.4 / 2,407.8 / 2,407.8 | −26,390.6 | 92.1% faster | 40 (500) → 0 | <5,000 ms; pass |
| Concurrent retry (98 Q) | 27,838.5 / 29,437.6 / 29,812.7 / 29,812.7 | 2,003.5 / 2,311.6 / 2,373.4 / 2,373.4 | −27,126.0 | 92.1% faster | 30 (29×500, 1×503) → 0 | <5,000 ms; pass |

All actions had 70 samples in both runs. Baseline errors totalled 71; after-run errors totalled zero. The after run had no 429s, 5xx responses, or timeouts. The test-listing p95 is only 6.1 ms inside its target, so it should be treated as borderline rather than a robust margin.

## Correctness and regression checks

- 70/70 full-test submissions returned the expected score (98/98); 70/70 practice submissions returned 20/20.
- 70/70 concurrent retries matched the original response. The database contained one score and one submit event per attempt, with topic totals applied exactly once.
- Empty and one-answer partial submissions returned 0/98 and 1/98 respectively.
- A deliberately invalid topic result raised an error after the test answer correction; the answer correction, score, submit event, and attempt status all rolled back.
- Vocabulary consistency passed: review history, response durations, daily activity, and scheduling state agreed for all 70 reviews.
- Validation passed: six affected Edge Functions type-checked; 11 backend scoring/progress tests passed; 3 answer-save queue tests passed; frontend TypeScript/Vite build passed; performance runner strict TypeScript check passed.

## Implemented and remaining

The 98-question serial correctness updates are now finalized through a service-role-only, idempotent database transaction that also writes the score, attempt status, assignment completion, topic totals, and submit event. Vocabulary review history, scheduling, and daily activity are likewise written atomically. Independent student reads were parallelized; test-list question counts and vocabulary card states use smaller nested reads; assigned test metadata and structure are fetched together; signed image URLs are deduplicated and batched. The client waits for pending answer saves before navigation/submission and presents a retry path when a save fails.

The initial optimized replay surfaced intermittent `JWT issued at future` 500s while profile rows were queried immediately after login. Student endpoints now verify the token with Supabase Auth, then perform the profile/status lookup using the verified user ID and service-role client. A seven-user smoke check passed, and the final 70-sample run recorded no request errors.

Remaining performance work is to bring 98-question start/resume and 20-question start below the 2-second p95 target with adequate margin, then rerun the same workload. The Helsinki-to-Singapore measurement path and unknown Supabase tier limit how directly these figures predict the production student experience. Staging remains deployed for testing; synthetic accounts and records were removed after this report was saved. This report does not measure production traffic or confirm a production deployment.
