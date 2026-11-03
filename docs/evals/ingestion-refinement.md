# Ingestion refinement evaluation

## AI-engineering résumé summary

Built and evaluated a Cohere Parse-backed PDF ingestion pipeline that turns SAT tests into reviewable, structured questions and answer keys. Across a frozen 36-import replay, question recovery rose **2,917 → 3,140 (+7.6%)**, matched source-key entries rose **1,654 → 2,415 (+46.0%)**, and exact 98-question/98-key imports rose **3/36 → 18/36**. Parser improvements on identical OCR account for **+97 questions and +565 matched keys**; fresh OCR on two imports accounts for the remaining **+126 questions and +196 keys**. None of 20 controls lost questions or matched keys. These measure PDF extraction and structural completeness—not answer accuracy, RAG retrieval, or admin approval.

## Final global-ID recovery checkpoint — 2026-09-25

This checkpoint supersedes the “Current checkpoint” below. The frozen cohort is still 36 formerly Partial imports, with 20 regression controls. All eight remaining global-ID targets were diagnosed and replayed against the same saved OCR; this pass made **zero OCR calls** and consumed **zero billed OCR pages**. Six source-audited improvements were promoted live using temporary staging and backups, bringing cumulative promotions to **23/36**. The two 101-question sources were intentionally left live as Partial.

| Metric | Before this global-ID pass | After | Change |
| --- | ---: | ---: | ---: |
| Frozen-cohort replay questions | 3,060 | 3,140 | +80 |
| Matched source answer entries | 2,181 | 2,415 | +234 |
| Replay UI Complete/Complete imports | 14 | 18 | +4 |
| Live promotions, cumulative | 17 | 23 | +6 |
| Strictly source-verified Complete/Complete live imports | 14 | 17 | +3 |

The +80 questions and +234 matched keys arise entirely from the eight targeted files on identical saved OCR. The three-pass distinction matters: UI Complete/Complete means exact 98 and 27/27/22/22 counts in each column; a strict verified pass also requires source-backed question identity, boundaries, choices, and key placement. `202508usv4.pdf` has 98/98 structurally but is excluded from strict verified passes because its PDF page 87 visibly clips one D-choice table. Its draft is flagged for manual visual review. All positional answer matches in the four August files and two partially keyed March files remain low-confidence suggestions, not approvals.

| Target | Prior replay Q / matched K | Final replay Q / matched K | Final live Questions / Answer key | Source/audit outcome |
| --- | ---: | ---: | --- | --- |
| `202508usv1.pdf` | 88 / 63 | 98 / 98 | Complete / Complete | Promoted; exact four-column key |
| `202508usv2.pdf` | 87 / 64 | 98 / 98 | Complete / Complete | Promoted; exact four-column key |
| `202508usv3.pdf` | 92 / 52 | 98 / 98 | Complete / Complete | Promoted; exact four-column key |
| `202508usv4.pdf` | 89 / 63 | 98 / 98 | Complete / Complete | Promoted; clipped choice requires review |
| `202503asiav5.pdf` | 88 / 52 | 98 / 54 | Complete / Partial | Promoted; source has RW keys only |
| `202503usv3.pdf` | 88 / 10 | 98 / 54 | Complete / Partial | Promoted; source has RW keys only |
| `202503asiav8.pdf` | 89 / 11 | 101 / 27 | Partial / Failed (live) | Not promoted; 101-question source, one 27-key range |
| `202503asiav9.pdf` | 89 / 5 | 101 / 27 | Partial / Failed (live) | Not promoted; 101-question source, one 27-key range |

Final *replay* distribution: **18 Complete/Complete, 10 Partial/Partial, 3 Partial/Failed, 3 Complete/Partial, 2 Complete/Failed**. Final *live* distribution from a fresh, de-duplicated hosted read: **18 Complete/Complete, 8 Partial/Partial, 5 Partial/Failed, 3 Complete/Partial, 2 Complete/Failed**. This separation avoids crediting replay-only gains in the two unpromoted sources. Final replay has zero unmatched raw key entries; this does **not** imply a complete source key for every import. The remaining Partial/Failed rows are characterized in [the per-import diagnosis](import-diagnosis.md).

Regression controls: none of the 20 lost a question or matched key versus the frozen baseline. Against the immediately preceding replay, all 20 had identical question text, choices, question counts, and matched-key counts. One control, `202503usv2.pdf`, remains 99 questions / 98 keys in replay (Partial/Partial because Math Module 2 has 23 questions); it was already 99 questions before this pass and is not a new regression. Visual/crop approval logic was not changed; graph and table drafts still need admin crop confirmation before approval, and full-test generation still requires approved drafts.

Verification: **161 worker tests passed across 13 files** with one worker; `npx tsc --noEmit` passed. Six staging audits found zero stage/replay, source-evidence, or source-key mismatches, and all six guarded promotions completed with **zero approval resets**. The promotion backups and journals remain under `backend/worker/tmp/refinement/`. No new OCR runtime was incurred; staging/replay used saved OCR, and jobs ran one at a time to limit CPU load.

## Previous checkpoint (superseded) — 2026-09-25

All **36/36** frozen Partial imports have a source diagnosis and final local replay. The 20 controls also replayed, with **zero decreases** in question count or matched keys. This pass used saved OCR/page text and no new OCR calls. Seventeen live imports have been source-audited and promoted: 14 verified Complete/Complete, two Questions Complete / Key Failed from source PDFs with no keys, and one Questions Complete / Key Partial from a PDF with RW keys only. The other 19 remain live as before, even where the local parser now improves them. See [the per-import diagnosis](import-diagnosis.md) for each source limitation and rerun decision.

| Frozen-cohort metric | Iteration-start replay | Current replay | Change |
| --- | ---: | ---: | ---: |
| Questions detected | 2,917 | 3,060 | +143 |
| Matched source answer-key entries | 1,654 | 2,181 | +527 |
| UI Complete/Complete in replay | 3 | 14 | +11 |
| Verified Complete/Complete promoted live | 0 | 14 | +14 |
| Total live promotions, including source-limited improvements | 0 | 17 | +17 |

The metric above counts actual source key entries matched to questions, not the UI readiness summary's suggested-answer count (which currently totals 2,184 and includes three additional suggestions). On identical saved OCR/stored page text, parser changes account for **+17 questions and +331 matched source keys** across 34 imports. The two fresh-OCR cases account jointly for **+126 questions and +196 matched source keys**. OCR was run in an earlier pass (60 physical pages, 76 billed pages, 500,718 ms), not during this pass.

Current replay status pairs: **14 Complete/Complete, 16 Partial/Partial, 3 Partial/Failed, 2 Complete/Failed, 1 Complete/Partial**. Current live status pairs after the 17 promotions: **14 Complete/Complete, 14 Partial/Partial, 5 Partial/Failed, 2 Complete/Failed, 1 Complete/Partial**. Thus parser-only improvements in unpromoted drafts are not being confused with changes visible in Admin → PDF Imports. Current replay has 234 raw key entries unmatched and 344 unresolved/conflicting question IDs; these are review indicators, not an accuracy percentage.

The largest new source-verified promotion is `202509us03.pdf`: **91 questions / 49 matched keys live → 98/98 live**, with four exact module sequences, an exact 27/27/22/22 source key grid, preserved old choice text, no approval reset, and an unchanged import ID. `202503asiav6.pdf` and `202505asiav3.pdf` were also promoted after source-verified duplicate-crop handling; both now show **98 questions / 0 keys** in the live Imports table. Their PDFs contain no answer key, so Key correctly remains Failed. `202503asiav5.pdf` now matches 52/54 global RW keys in replay; `202503asiav8.pdf`, `202503asiav9.pdf`, and `202503usv3.pdf` match 11/27, 5/27, and 10/54 respectively. Those global-ID improvements remain replay-only because the unmatched/ambiguous identities need further source audit; no answer was assigned by position.

The per-import outcomes for all 22 imports examined in this pass are in [the per-import diagnosis](import-diagnosis.md). Source-limited RW-only and question-bank uploads remain Partial/Failed under the strict 98/98 rule; missing source content is not fabricated. The historical checkpoint below is retained to show progress but is **superseded** by this current section.

Verification after the final parser and promotion-safeguard changes: **159 worker tests passed across 13 files** with one worker at a time; TypeScript typecheck passed. The hosted read-only Imports reconciliation confirmed 17 promotions and the live status distribution above. No new OCR job was launched in this pass.

## Earlier checkpoint (superseded)

### Cohort and measurement

**Checkpoint: eleven verified promotions complete; iteration on the remaining 25 imports is in progress.** The 36 IDs were frozen from the hosted Admin PDF Imports set on 2026-09-24. `Before Q/K` is the saved-source replay with parser code at iteration start; `After Q/K` is the latest full-cohort replay. `Live now` is calculated from current saved drafts and keys with the unchanged strict full-test rule.

- Cohort: 36 of 65 imports initially Partial in Questions or Answer key; 20 Complete/Complete imports are controls. The initial live distribution was 25 Partial/Partial, 9 Partial/Failed, 2 Complete/Partial.
- UI pass: both columns Complete, exactly 98 total and 27/27/22/22 per module. Verified pass additionally requires source-grounded boundary, identity, choice, and key evidence with no unresolved high-risk error.
- 34 imports replay identical saved OCR/page text; two required fresh OCR. Parser-only gains and new-OCR-plus-parser gains are separated below.
- Question/key modules are ordered RW1/RW2/Math1/Math2. A fifth `n/0` bucket denotes unassigned extra questions/keys, not a canonical SAT module. `Matched/raw/unmatched` shows key coverage. `Low` is the parser's confidence diagnostic; it is not by itself proof that source-verified answers are wrong.
- RW-only and question-bank PDFs remain Partial under the strict full-test rule; missing modules are never fabricated. Promotion requires a backed-up staged replay, source evidence, and no regression.

### Aggregate checkpoint

| Metric | Start replay | Latest replay |
| --- | ---: | ---: |
| Imports | 36 | 36 |
| Questions detected | 2,917 | 3,048 (+131) |
| Matched answer keys | 1,654 | 1,996 (+342) |
| UI Complete/Complete | 3 | 11 |
| Replay status pairs | 18 Partial/Partial; 6 Complete/Partial; 8 Partial/Failed; 1 Failed/Failed; 3 Complete/Complete | 17 Partial/Partial; 1 Complete/Partial; 7 Partial/Failed; 11 Complete/Complete |
| Verified passes | — | 11 |

Attribution: same-source parser changes across 34 imports recovered **5 questions and 146 matched keys**. Fresh OCR plus parsing recovered **126 questions and 196 matched keys** across two PDFs. Together these account for the +131 questions and +342 keys; OCR gains are not credited to parser-only work.

Latest live status distribution: **18 Partial/Partial, 7 Partial/Failed, 11 Complete/Complete**. All eleven Complete/Complete rows are source-audited promotions. Latest replay diagnostics: 288 unresolved/duplicate question IDs, 364 unmatched key entries, 621 low-confidence key-match flags. These are review-workload indicators across mixed source types, not accuracy percentages.

### Per-import checkpoint

| Import | Live now Q/key | Before Q/K | After Q/K | Question modules RW1/RW2/Math1/Math2* | Key modules | Matched/raw/unmatched | Low | Unresolved | Verified/promoted |
| --- | --- | ---: | ---: | --- | --- | ---: | ---: | ---: | --- |
| Full RW Question Bank With Key.pdf | Partial/Partial | 84/84 | 84/84 | 27/27, 27/27, 0/22, 0/22, 30/0 | 27/27, 27/27, 0/22, 0/22, 30/0 | 84/84/0 | 0 | 0 | No/No |
| 202503asiav3.pdf | Complete/Complete | 98/88 | 98/98 | 27/27,27/27,22/22,22/22 | 27/27,27/27,22/22,22/22 | 98/98/0 | 0 | 0 | Yes/Yes |
| 202606asiav4.pdf | Complete/Complete | 70/0 | 98/98 | 27/27, 27/27, 22/22, 22/22 | 27/27, 27/27, 22/22, 22/22 | 98/98/0 | 1 | 0 | Yes/Yes |
| 202508usv2.pdf | Partial/Partial | 87/63 | 87/62 | 27/27, 27/27, 0/22, 0/22, 33/0 | 25/27, 24/27, 0/22, 0/22, 13/0 | 62/94/32 | 0 | 22 | No/No |
| 202508usv3.pdf | Partial/Partial | 92/50 | 92/50 | 27/27, 27/27, 0/22, 0/22, 38/0 | 20/27, 16/27, 0/22, 0/22, 14/0 | 50/102/52 | 0 | 25 | No/No |
| 202509us03.pdf | Partial/Partial | 91/22 | 91/22 | 27/27, 27/27, 22/22, 0/22, 15/0 | 0/27, 0/27, 22/22, 0/22 | 22/98/76 | 22 | 69 | No/No |
| 202606usv1.pdf | Complete/Complete | 0/0 | 98/98 | 27/27, 27/27, 22/22, 22/22 | 27/27, 27/27, 22/22, 22/22 | 98/98/0 | 0 | 0 | Yes/Yes |
| 202505asiav1.pdf | Partial/Partial | 54/54 | 54/54 | 27/27, 27/27, 0/22, 0/22 | 27/27, 27/27, 0/22, 0/22 | 54/54/0 | 1 | 0 | No/No |
| 202508usv4.pdf | Partial/Partial | 88/60 | 89/60 | 27/27, 27/27, 0/22, 0/22, 35/0 | 21/27, 23/27, 0/22, 0/22, 16/0 | 60/98/38 | 0 | 21 | No/No |
| 202509asiav4.pdf | Complete/Complete | 96/0 | 98/98 | 27/27, 27/27, 22/22, 22/22 | 27/27, 27/27, 22/22, 22/22 | 98/98/0 | 54 | 0 | Yes/Yes |
| 202509us02.pdf | Complete/Complete | 98/98 | 98/98 | 27/27, 27/27, 22/22, 22/22 | 27/27, 27/27, 22/22, 22/22 | 98/98/0 | 98 | 0 | Yes/Yes |
| 202506asiav1-rw.pdf | Partial/Partial | 54/54 | 54/54 | 27/27, 27/27, 0/22, 0/22 | 27/27, 27/27, 0/22, 0/22 | 54/54/0 | 2 | 0 | No/No |
| 202509us04.pdf | Complete/Complete | 98/98 | 98/98 | 27/27, 27/27, 22/22, 22/22 | 27/27, 27/27, 22/22, 22/22 | 98/98/0 | 98 | 0 | Yes/Yes |
| 202508asiav2-rw.pdf | Partial/Partial | 54/54 | 54/54 | 27/27, 27/27, 0/22, 0/22 | 27/27, 27/27, 0/22, 0/22 | 54/54/0 | 0 | 0 | No/No |
| 202508asiav3-rw.pdf | Partial/Partial | 54/54 | 54/54 | 27/27, 27/27, 0/22, 0/22 | 27/27, 27/27, 0/22, 0/22 | 54/54/0 | 0 | 0 | No/No |
| 202509us05.pdf | Complete/Complete | 98/98 | 98/98 | 27/27, 27/27, 22/22, 22/22 | 27/27, 27/27, 22/22, 22/22 | 98/98/0 | 98 | 0 | Yes/Yes |
| 202510asiav1-new.pdf | Complete/Complete | 98/89 | 98/98 | 27/27,27/27,22/22,22/22 | 27/27,27/27,22/22,22/22 | 98/98/0 | 5 | 0 | Yes/Yes |
| 202509asiav2-rw.pdf | Partial/Partial | 27/27 | 27/27 | 27/27, 0/27, 0/22, 0/22 | 27/27, 0/27, 0/22, 0/22 | 27/27/0 | 0 | 0 | No/No |
| 202510asiav3.pdf | Partial/Failed | 61/0 | 61/0 | 27/27,27/27,0/22,0/22,7/0 | 0/27,0/27,0/22,0/22 | 0/0/0 | 0 | 54 | No/No |
| 202510asiav2-new.pdf | Complete/Complete | 98/88 | 98/98 | 27/27,27/27,22/22,22/22 | 27/27,27/27,22/22,22/22 | 98/98/0 | 6 | 0 | Yes/Yes |
| 202510asiav4.pdf | Partial/Failed | 59/0 | 59/0 | 27/27,27/27,0/22,0/22,5/0 | 0/27,0/27,0/22,0/22 | 0/0/0 | 0 | 52 | No/No |
| 202503asiav5.pdf | Partial/Partial | 88/0 | 88/0 | 0/27, 0/27, 22/22, 22/22, 44/0 | 0/27, 0/27, 0/22, 0/22 | 0/54/54 | 0 | 0 | No/No |
| 202503asiav6.pdf | Partial/Failed | 97/0 | 99/0 | 27/27,27/27,21/22,24/22 | 0/27,0/27,0/22,0/22 | 0/0/0 | 0 | 2 | No/No |
| 202503asiav8.pdf | Partial/Failed | 89/0 | 89/0 | 27/27, 27/27, 0/22, 0/22, 35/0 | 0/27, 0/27, 0/22, 0/22 | 0/0/0 | 0 | 0 | No/No |
| 202503asiav9.pdf | Partial/Failed | 89/0 | 89/0 | 27/27, 27/27, 0/22, 0/22, 35/0 | 0/27, 0/27, 0/22, 0/22 | 0/0/0 | 0 | 0 | No/No |
| 202503usv3.pdf | Partial/Partial | 88/0 | 88/0 | 27/27, 27/27, 0/22, 0/22, 34/0 | 0/27, 0/27, 0/22, 0/22 | 0/54/54 | 0 | 0 | No/No |
| 202605asIav1-rw.pdf | Partial/Partial | 54/54 | 54/54 | 27/27, 27/27, 0/22, 0/22 | 27/27, 27/27, 0/22, 0/22 | 54/54/0 | 0 | 0 | No/No |
| 202605usv1-rw.pdf | Partial/Partial | 54/54 | 54/54 | 27/27, 27/27, 0/22, 0/22 | 27/27, 27/27, 0/22, 0/22 | 54/54/0 | 54 | 0 | No/No |
| 202606asiav3.pdf | Complete/Complete | 98/96 | 98/98 | 27/27,27/27,22/22,22/22 | 27/27,27/27,22/22,22/22 | 98/98/0 | 98 | 0 | Yes/Yes |
| 202511asiav2.pdf | Partial/Partial | 92/74 | 92/78 | 27/27,27/27,22/22,16/22 | 27/27,27/27,22/22,2/22 | 78/98/20 | 78 | 14 | No/No |
| 202505asiav2.pdf | Partial/Partial | 97/54 | 97/54 | 27/27, 27/27, 21/22, 22/22 | 27/27, 27/27, 0/22, 0/22 | 54/54/0 | 1 | 8 | No/No |
| 202508usv1.pdf | Partial/Partial | 88/62 | 88/61 | 27/27, 27/27, 0/22, 0/22, 34/0 | 25/27, 27/27, 0/22, 0/22, 12/0 | 61/98/37 | 0 | 28 | No/No |
| 202505asiav3.pdf | Partial/Failed | 99/0 | 99/0 | 27/27, 27/27, 23/22, 22/22 | 0/27, 0/27, 0/22, 0/22 | 0/0/0 | 0 | 6 | No/No |
| 202505usv1.pdf | Partial/Partial | 98/91 | 98/96 | 27/27,27/27,22/22,22/22 | 27/27,27/27,20/22,22/22 | 96/97/1 | 1 | 0 | No/No |
| 202505usv2.pdf | Partial/Failed | 129/0 | 129/0 | 27/27, 27/27, 0/22, 0/22, 75/0 | 0/27, 0/27, 0/22, 0/22 | 0/0/0 | 0 | 0 | No/No |
| 202506asiav2.pdf | Complete/Complete | 98/88 | 98/98 | 27/27,27/27,22/22,22/22 | 27/27,27/27,22/22,22/22 | 98/98/0 | 5 | 0 | Yes/Yes |

### OCR, controls, and promotion record

| Newly OCRed source | Pages processed | Billed pages | Runtime |
| --- | ---: | ---: | ---: |
| 202606asiav4.pdf | 7 | 23 | 243,014 ms |
| 202606usv1.pdf | 53 | 53 | 257,704 ms |
| **Total** | **60** | **76** | **500,718 ms** |

- The 20 controls replayed as 19 Complete/Complete and 1 Partial/Partial. No question-count or matched-key decreases were detected; the saved cohort-level comparator reports no control regressions.
- Eleven imports are backed up, audited, and promoted under their original IDs: `202503asiav3.pdf`, `202509us02.pdf`, `202509us04.pdf`, `202509us05.pdf`, `202509asiav4.pdf`, `202510asiav1-new.pdf`, `202510asiav2-new.pdf`, `202506asiav2.pdf`, `202606asiav3.pdf`, `202606asiav4.pdf`, and `202606usv1.pdf`. All eleven are source-verified Complete/Complete. Approval/rejection reset counts and linked-record checks are in their diagnosis sections.
- New source review covered June Asia v3’s Math M2 Q6/Q15 figure markers and key values, March Asia v3’s misplaced RW2 key heading and page-split choice, October Asia v1/v2’s recovered Math IDs and exact key grids, and June Asia v2’s recovered Math questions. Printed markers lacking selectable PDF text were visually confirmed from rendered pages; key answers were checked against OCR key sections and source grids.
- The source-audit utility now aggregates key sections across OCR pages, repairs exact sequential heading mis-scopes, handles cross-page answer choices and equivalent LaTeX math forms, and records manual visual marker checks. Regression tests cover these cases.
- Read-only bucket verification attempted all 56 cohort/control PDFs; all returned `Object not found`. Frozen local PDFs, OCR, and checksums were used for audits, but byte identity against the hosted objects could not be established.
- Focused/full worker tests last passed 139 tests across 11 files; typecheck passed. These checks will be rerun after the remaining parser iterations.

### Remaining loop at the earlier checkpoint

The 25 imports not yet promoted remain in the loop. The five newly exact saved-OCR replays passed source review and were promoted; the remaining cohort consists of source-limited RW/question-bank imports and incomplete full-test/question-bank cases. Continue with closest-to-complete full tests first, then verify source limitations and update each diagnosis. Replay the complete 36-import cohort and all 20 controls after any further ingestion-parser change. Final tests and per-import outcomes remain pending.
