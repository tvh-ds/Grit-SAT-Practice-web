# Partial PDF import diagnosis

## Global-ID recovery pass — final outcome, 2026-09-25

This section supersedes the older checkpoint below for these eight files. All eight were compared against saved OCR and selected source-PDF pages; no new OCR was run. The four August files were staged one at a time, audited against the source and replay, backed up, and promoted. Two March files with 54 source RW keys were likewise promoted. No existing approval/rejection decisions or linked question records were reset by these six promotions; crops and answer suggestions remain pending admin review. The two 101-question sources were **not** promoted.

| Source | Before this pass: replay Q / matched K | Final replay Q / matched K | Live outcome |
| --- | ---: | ---: | --- |
| `202508usv1.pdf` | 88 / 63 | 98 / 98 | Complete / Complete; promoted |
| `202508usv2.pdf` | 87 / 64 | 98 / 98 | Complete / Complete; promoted |
| `202508usv3.pdf` | 92 / 52 | 98 / 98 | Complete / Complete; promoted |
| `202508usv4.pdf` | 89 / 63 | 98 / 98 | Complete / Complete; promoted, one clipped-choice visual still needs review |
| `202503asiav5.pdf` | 88 / 52 | 98 / 54 | Complete / Partial; promoted |
| `202503usv3.pdf` | 88 / 10 | 98 / 54 | Complete / Partial; promoted |
| `202503asiav8.pdf` | 89 / 11 | 101 / 27 | Partial / Failed live; not promoted |
| `202503asiav9.pdf` | 89 / 5 | 101 / 27 | Partial / Failed live; not promoted |

### Per-source findings and resolution

- **202508usv1.pdf:** Parser/boundary defect. The screenshot sequence includes two distinct Math questions on PDF page 56 (global badges 313 and 314), previously merged. Page-isolated recovery finds exactly 98 source-backed questions. The tail key has 22 four-pair rows plus five two-pair rows; column/row mapping supplies exactly 27/27/22/22 keys without trusting printed badge numbers. Source audit found no stage/replay, question-evidence, or key mismatch. Promoted under original import `bc6d2b77-5efc-46db-abb0-0c526bf49570`; backup `backup-bc6d2b77-5efc-46db-abb0-0c526bf49570-1790311661203.json`.
- **202508usv2.pdf:** Parser/boundary and key-matching defect. Isolated screenshots were lost or misread when global badges were treated as local test numbering; a Math equation boundary on page 56 was checked. Exact 98-question sequence and four-column 98-cell key passed the source audit. Promoted under `87a68f8b-4702-4715-9332-4da0a520f14d`; backup `backup-87a68f8b-4702-4715-9332-4da0a520f14d-1790311823538.json`.
- **202508usv3.pdf:** Parser/boundary and key-matching defect. Saved OCR contains 98 distinct screenshot questions despite only 92 prior drafts; PDF Math-module evidence and the four-column tail table support positional slots. The audited replay is 98/98 with no unmatched key cells. Promoted under `2654a0a5-606a-4fb5-8d3e-718fd184a61d`; backup `backup-2654a0a5-606a-4fb5-8d3e-718fd184a61d-1790311989200.json`.
- **202508usv4.pdf:** Parser/boundary defect plus a genuine source limitation. PDF page 39 has two distinct RW questions, formerly merged. The 98-question order and complete four-column key are source-backed, so the structural 98/98 improvement was audited and promoted under `c4e16d25-5a8d-4240-b800-3d4503e93ae8`; backup `backup-c4e16d25-5a8d-4240-b800-3d4503e93ae8-1790312230218.json`. However PDF page 87 itself clips part of a D-choice table. That draft retains `source_choice_table_truncated_review_required`, a visual image, and pending manual review. **This is a UI Complete/Complete row, not a fully source-verified choice-content pass.**
- **202503asiav5.pdf:** Parser/global-ID matching defect and key-source limitation. Multi-question pages, including PDF page 26 with global badges 251–254, defeated page-level parsing; a source global-ID jump and Math content establish the RW→Math transition at question 55. Global marker blocks recover exactly 98 distinct questions, then assign canonical 27/27/22/22 slots while preserving printed IDs in metadata. The source has only 54 RW keys, all matched; no Math keys were invented. Source audit accepted and promotion was completed under `f9c58ba7-a712-49a8-94ac-8ec2c12271fe`; backup `backup-f9c58ba7-a712-49a8-94ac-8ec2c12271fe-1790310240373.json`.
- **202503usv3.pdf:** Parser/global-ID matching defect and key-source limitation. PDF pages 16–19 show global questions 505–511; OCR bold-wrapped 506/507/511, hiding their boundaries from the former parser. Global marker recovery produces 98 questions, exact canonical slots, and all 54 printed RW keys matched by original ID. There are no Math keys in the source. Source audit accepted and promotion was completed under `f44bb670-8976-4ddc-9f9e-a9963eb38145`; backup `backup-f44bb670-8976-4ddc-9f9e-a9963eb38145-1790311405117.json`.
- **202503asiav8.pdf:** Parser recovery improved 89/11 to 101/27, but this is a **genuine noncanonical source**, not a 98-question test. PDF pages 13–14 confirm 30 questions in its first RW segment (badges 589–618) before the next run begins at 643. Only one 27-key range is present. Forcing a 27/27/22/22 split would shift three real questions. No live promotion; live remains Partial/Failed, replay Partial/Partial.
- **202503asiav9.pdf:** The same global-marker parser recovers 101 questions and all 27 source key entries, but the source has an overfull 30-question RW run and only a partial key range. A 98-slot or 98-key label would fabricate structure. No live promotion; live remains Partial/Failed, replay Partial/Partial.

All six promotion audits reported zero stage/replay mismatches, source-question evidence failures, and source-key mismatches. The guarded promotion checked for intervening admin edits, preserved each import ID, wrote a backup and journal under `backend/worker/tmp/refinement/`, and left generated tests and linked question records untouched. Positional answer assignments are explicitly low-confidence suggestions for admin review, not approved keys. The graph/visual crop and approval workflow is unchanged.

This ledger tracks the fixed cohort of 36 Admin → PDF Imports rows that showed Partial in Questions or Answer key at the start of the refinement loop. It records source evidence, parser defects, rerun results, and any live replacement. A count of 98 alone is not proof that question boundaries or answers are correct.

## Baseline and method

- Snapshot date: 2026-09-24 (Europe/Helsinki).
- Live source: hosted `pdf_imports`, `draft_questions`, `draft_question_choices`, `draft_answer_keys`, and `pdf_import_pages` records; statuses use the repository's `summarizePdfImportReadiness` rules.
- Cohort: 36 of 65 imports: 25 Partial/Partial, 9 Partial/Failed, and 2 Complete/Partial. Twenty Complete/Complete imports are regression controls.
- Source availability: 33 local saved OCR files, one import with stored page text, and two imports requiring fresh extraction from their local PDFs. All 36 source PDFs are present locally. Read-only verification found all 56 cohort/control objects unavailable (`Object not found`), so local frozen sources were used and remote byte identity could not be confirmed.
- Prior checkpoint progress: all 36 frozen imports had a diagnosis and replay; 17 improvements had been source-audited and promoted. The global-ID recovery pass above raised that count to 23. The 22 source diagnoses below were completed before changing parser logic in that earlier pass. Promotion counts come from the local promotion journals.
- Each section records baseline module counts, key evidence, approvals/links, a source-grounded diagnosis, code/test changes, rerun result, and live promotion outcome.

## Import diagnoses

## Second-pass source diagnoses of the 22 unpromoted imports (before new parser changes)

This pass used the frozen saved OCR (or the frozen stored page text for the RW bank), the current replay, and selective original-PDF checks. It distinguishes an absent source module/key from a parser miss. Counts here are the pre-change replay, not promised post-fix results. Global bank IDs must never be converted into canonical test slots by position alone.

1. **Full RW Question Bank With Key.pdf — source limitation plus replay regression.** Stored text and the PDF identify an RW question bank, with no Math modules. Current replay yields 84 paired questions/keys; the live draft has 132, so replacing it would lose 48 records. Diagnose that 48-item gap against stored page spans before any parser or promotion decision. It cannot be Complete as a full test.
2. **202508usv2.pdf — OCR/boundary and key-identity defects.** The 99-page screenshot compilation has global IDs in a four-column tail table (examples `73 D`, `100 A`, `374 C`, `396 C`), not local 1–27/1–22 slots. Replay has 87 questions, 94 detected keys, 31 unmatched, 18 unresolved question IDs and two ID conflicts. Page 56 has a math-equation boundary. Missing/uncertain screenshot questions and key identities require per-page recovery, not positional key assignment.
3. **202508usv3.pdf — OCR/boundary and key-identity defects.** Its 99 pages contain global-ID Math screenshot content (explicit Section 2 Module 2 headers on pages 77–81); tail keys include `238 B`, `265 D`, `418 C`, `553 1456`. Replay has 92 questions, 102 key entries, 52 unmatched, 21 unresolved IDs and four conflicts. The key table is not an exact 98-slot local grid, so completion is unsupported even if more page boundaries are recovered.
4. **202509us03.pdf — parser segmentation and matching defects, likely fixable full test.** Despite the running title “SAT SEPTEMBER BANK,” the OCR has four ordered 1-based runs: RW1 pages 1–18, RW2 starts page 19, Math1 starts page 38, Math2 explicitly starts page 51. The latter three starts have no reliable module header. The final page has a local four-column 27/27/22/22 key grid. The parser collapses the first three runs into a 69-question RW bank and leaves 22 Math questions, yielding 91 questions and only 22 matched keys, with 69 duplicate-ID conflicts. Seven questions are also lost at page/question boundaries. Restore modules from the source resets and verify each recovered span before using the 98 keys.
5. **202505asiav1.pdf — genuine RW-only source.** Saved OCR has 27+27 RW questions and 54 matching keys. OCR pages 20–22 contain empty Math answer headings, not Math question bodies or Math keys. Replay 54/54 is faithful; missing 44 Math items are not a parser bug.
6. **202508usv4.pdf — screenshot identity and OCR/boundary defects.** Ninety-four pages contain global IDs; tail key rows include `292 B`, `319 D`, `575 A`, `597 1512`. Replay has 89 questions and 98 keys but 38 unmatched and 19 unresolved IDs. A bold global Question 28 on page 10 illustrates that local-slot matching would be unsafe. Inspect missing screenshot pages and preserve global identities.
7. **202506asiav1-rw.pdf — genuine RW-only source.** Two exact 27-question RW modules and 54 keys are present in the 23-page OCR; the last page has empty Math answer headings. The absent 44 Math questions/keys cannot be fabricated.
8. **202508asiav2-rw.pdf — genuine RW-only source.** OCR page 22 has Math Module 1/2 “22 QUESTIONS” stubs without question bodies; page 23 has empty Math answer headings. The 54 RW questions and 54 keys are complete for the source, but Partial under the full-test rule.
9. **202508asiav3-rw.pdf — genuine RW-only source.** Its 23 pages provide 27+27 RW questions and corresponding keys, then empty Math answer headings. Replay 54/54 is source-faithful; no parser should invent Math.
10. **202509asiav2-rw.pdf — genuine one-module source.** The 28-page OCR has one 27-question RW module and a 1–27 answer list on its last page, with no other question modules. Replay 27/27 is source-faithful. Its one linked approved question is preserved.
11. **202510asiav3.pdf — source-limited screenshot compilation plus numbering collisions.** The 61 pages are one-question-per-page mixed RW/Math screenshots, with no answer-key page or canonical 98-slot structure. Replay recovers 61 prompts, 0 keys, and 54 duplicate-ID conflicts from reused local labels. Classify as a bank-like compilation and retain review flags; it cannot become 98/98 from this source.
12. **202510asiav4.pdf — source-limited screenshot compilation plus numbering collisions.** The 68-page source has mixed RW/Math questions, no answer-key page, and no complete four-module sequence. Replay recovers 59 prompts, 0 keys, with 52 duplicate-ID conflicts. Better page-level extraction may improve content but cannot supply absent keys.
13. **202503asiav5.pdf — global-ID matching defect and source shortfall.** The title gives intended global ranges RW 175–201/202–228 and Math 251–272/273–294, yet the OCR/replay yields 88 questions. The last page contains 54 RW keys in two columns (`175 B 202 A` through `201 A 228 B`); all 54 are unmatched because the current bank/module identity path does not align them to printed global IDs. This is not a 98-key source; global-ID matching can improve coverage but cannot create missing Math keys/questions.
14. **202503asiav6.pdf — two question-boundary bugs and absent key.** RW modules are now exact 27/27. Math1 is 21/22 because the complete, unnumbered graph Question 10 on OCR/PDF page 64 is appended after Question 9’s grid-in placeholder on page 63. Math2 is 24/22 because pages 88/89 repeat Question 12 (second crop has all A–D) and pages 93/94 repeat Question 16 (second crop adds D); the unnumbered crops become two extra inferred questions. A guarded same-stem/compatible-choice coalescence should prefer the richer crop. No answer-key entries appear in the 100-page source, so keys remain Failed even if questions reach 98.
15. **202503asiav8.pdf — key detection defect plus bank/source limitation.** Correction to the older section below: the PDF/OCR *does* have a key list, on page 39, including IDs 643–669 (`643 A` through `669 A`). The parser detects zero because this headingless one-pair-per-line tail is not recognized. The 89 replayed questions start at global ID 589 and extend far beyond a four-module test; the visible key list covers only a subset. Detect and match global-ID keys with adjacent-run safeguards, but do not report a 98-key full test.
16. **202503asiav9.pdf — key detection defect plus bank/source limitation.** Correction to the older section below: the last OCR/PDF page has a headingless key list for global IDs 790–816 (`790 A` through `816 A`); parser raw keys are zero. The 89 questions begin at global ID 736 and continue beyond that key range. A page footer (`13/13`) must not become a key. Match only source-identical IDs; the key is partial, not absent.
17. **202503usv3.pdf — global-ID matching defect and incomplete source.** The 37-page document names global RW Module 2 IDs 496–522 and starts at 469. Its final page has exactly two 27-key columns (`469 C 496 C` through `495 C 522 B`). Replay has 88 bank questions and 54 detected but unmatched keys. Printed global IDs, not bank ordinals 1–88, must govern matching. No Math key columns exist.
18. **202605asIav1-rw.pdf — genuine RW-only source.** Its 23 pages yield 54 RW questions/keys. The final Math Module 2 Answers page contains only a white-area figure/empty key section, not answer entries; no Math questions are present. Partial is correct.
19. **202605usv1-rw.pdf — genuine RW-only source.** The 36-page OCR contains 54 RW questions and a two-column 27/27 RW key grid on the last page. It has no Math module content or Math keys. Replay 54/54 is faithful.
20. **202508usv1.pdf — screenshot identity and OCR/boundary defects.** Its 98 pages have an apparent 98-entry tail key table combining local RW IDs 1–54 with global Math IDs 312–355 (examples `312 A`, `334 670`); that is not a four-column local 1-based grid. Replay has 88 questions, 98 keys, 36 unmatched, 21 unresolved IDs and seven conflicts. Page 4 has a bold-choice/question boundary. Source-confirm missing screenshot questions before any module assignment or key promotion.
21. **202505asiav3.pdf — repeated screenshot crop and absent key.** The source has exact 27/27 RW and 22 Math2, but 23 Math1 drafts. OCR/PDF page 74 prints Math1 Question 18 with graph/stem and no choices; page 75 repeats the same stem, supplies A–D, and omits the printed marker. The parser keeps it as an extra unresolved question. Coalesce only same-stem adjacent crops with compatible choices and retain the richer evidence. No answer-key page is present, so keys remain Failed.
22. **202505usv2.pdf — genuine global-ID bank without keys.** The 53-page source starts with printed global ID 23832, has 129 replayed questions and no answer-key page or four canonical modules. It is an overlength question bank; Partial/Failed is faithful.

### Shared-fix plan derived from the completed source pass

1. Add narrowly gated coalescence for adjacent screenshots of the same question when a marked earlier crop is followed by an unnumbered, richer crop with the same normalized stem and non-conflicting choices. Separately recover a clearly unnumbered Math question after a finished grid-in block without assigning an ID unless neighboring observed markers uniquely determine it.
2. Detect headingless global-ID answer lists only as consecutive question-number/answer runs, exclude footers and ordinary data tables, and match them only to uniquely observed printed global question IDs. This must not change canonical-module key handling.
3. For sources with a four-column exact local key grid and explicit 1-based question-number restarts, recover missing module headings from source order, then recover isolated question spans. Require four exact sequences and math/RW content checks before claiming Complete. Treat “BANK” in a running title as weaker than exact source structure, while retaining the bank safeguards for true global-ID compilations.
4. Add targeted regressions for each shared pattern, replay all 36 imports and 20 Complete/Complete controls once after changes, source-audit every apparent gain, and promote only monotonic verified improvements. Source-limited rows remain Partial/Failed with residual causes recorded.

### Second-pass rerun outcome for every diagnosed import

The last replay used the saved OCR/stored text; no fresh OCR calls were made in this pass. `Q/K` means detected questions/matched keys. Raw but unmatched keys are noted separately. The 20 controls showed no question-count or matched-key decrease. A question count of 98 does not imply a keyed full-test pass.

| Import | Replay Q/K | Rerun outcome and residual cause | Live action |
| --- | ---: | --- | --- |
| Full RW Question Bank With Key.pdf | 84/84 | 48 fewer than live draft; RW bank has no Math; preserve existing 132 drafts | None |
| 202508usv2.pdf | 87/64 | 94 raw global keys, 30 unmatched; screenshot boundaries/IDs unresolved | None |
| 202508usv3.pdf | 92/52 | 102 raw global keys, 50 unmatched; source key surplus and screenshot boundaries | None |
| 202509us03.pdf | **98/98** | Four exact source runs and four-column key grid; no unresolved IDs or unmatched keys | **Promoted** from 91/49 live drafts to 98/98 after backup and source audit; zero approvals/links reset |
| 202505asiav1.pdf | 54/54 | RW-only; empty Math sections | None |
| 202508usv4.pdf | 89/63 | 98 raw global keys, 35 unmatched; incomplete screenshot identities | None |
| 202506asiav1-rw.pdf | 54/54 | RW-only; empty Math headings | None |
| 202508asiav2-rw.pdf | 54/54 | RW-only; Math count stubs without questions | None |
| 202508asiav3-rw.pdf | 54/54 | RW-only; empty Math answers | None |
| 202509asiav2-rw.pdf | 27/27 | One RW module only; linked approved record unchanged | None |
| 202510asiav3.pdf | 61/0 | Mixed screenshot bank; no source key | None |
| 202510asiav4.pdf | 59/0 | Mixed screenshot bank; no source key | None |
| 202503asiav5.pdf | 88/52 | **52 of 54** global RW keys now match printed IDs; 2 remain unmatched; source lacks Math keys and ten questions | None: partial source/identity audit remains |
| 202503asiav6.pdf | **98/0** | Missing Math1 Q10 recovered, two duplicated Math2 crops coalesced; source has no answer key | **Promoted** 97→98 questions after source/choice audit, PDF checks on pages 56/64/100, backup; zero approvals reset; key stays Failed |
| 202503asiav8.pdf | 89/11 | Headingless 27-key global list now detected; 11 unique printed IDs matched, 16 keys and other identities unresolved | None |
| 202503asiav9.pdf | 89/5 | Headingless 27-key global list now detected; 5 unique printed IDs matched, 22 keys unresolved | None |
| 202503usv3.pdf | 88/10 | 54 raw global RW keys; 10 match uniquely printed IDs, 44 remain unmatched | None |
| 202605asIav1-rw.pdf | 54/54 | RW-only; blank Math answer area | None |
| 202605usv1-rw.pdf | 54/54 | RW-only; two-column 54-key grid | None |
| 202508usv1.pdf | 88/66 | 98 raw mixed local/global keys, 35 unmatched; screenshot identities unresolved; 63 source key entries matched, with three additional readiness-counted suggestions | None |
| 202505asiav3.pdf | **98/0** | Repeated screenshot crops coalesced into exact modules; source has no answer key | **Promoted** 100→98 questions after verifying duplicate removal, choice preservation, PDF identities on pages 57/81/87 and absent key on page 101; backup; zero approvals reset; key stays Failed |
| 202505usv2.pdf | 129/0 | Overlength global bank with no key | None |

All three promotions in this pass left original import IDs unchanged. September's 91 previous drafts were backed up and replaced by 98 source-audited drafts with an exact 98-key grid; post-promotion Imports summary was Complete/Complete. The March and May screenshot imports were backed up and promoted as **Questions Complete / Answer key Failed**, which is faithful to their keyless PDFs. The other local parser improvements remain **replay-only** and have not replaced live drafts.

## Earlier per-import history

The entries below preserve the prior checkpoint and its then-current reruns. Where a second-pass row above differs (including new live promotions), the second-pass row is authoritative.

### 202503asiav3.pdf — 61c0f264-3d1e-46f2-9957-877cd0b01fb0

- Live baseline: Questions **complete 98/98** (RW M1 27/27, RW M2 27/27, Math M1 22/22, Math M2 22/22); Answer key **partial 98/98** (RW M1 27/27, RW M2 27/27, Math M1 22/22, Math M2 22/22).
- Review state: 86 has_suggested_key, 12 needs_review; 0 linked question records; generated test no.
- Sources: OCR `Tests Unparsed/post_ocr/2025 03/202503asiav3.ocr.txt`; PDF `Tests Unparsed/Digital SAT Tests/2025 03/202503asiav3.pdf`.
- Existing parser warnings: OCR loaded from saved post_ocr text (no Parse calls in this step).; 10 page(s) contain figures/tables/graphs; affected questions are marked needs_review with page images attached..
- Current-parser replay: Questions **complete 98/98**; Answer key **complete 98/98**; source saved_ocr; no unresolved IDs or unmatched keys. This is a material improvement over the earlier replay (90/98 matched) after the shared carryover-boundary fix.
- Source evidence and diagnosis: The PDF confirms all 98 questions and keys. Its page 32 prints Reading/Writing Module 2 keys 26–27 immediately above the “Math Module 1 Answers” heading; the prior source audit had mistakenly limited itself to the final OCR page and treated these keys as Math entries. OCR also split one R&W choice across pages 14–15. Existing Math choice strings contain OCR separator arrows that are absent after clean parsing.
- Fix, regression test, and rerun: The parser's scoped-key recovery maps 26–27 back to RW Module 2 by sequence. Added tests for heading-boundary reassignment, cross-page choice matching, and OCR arrow cleanup in the source audit helper. Staged content matched all 98 replay questions/choices; audit confirms exact 27/27/22/22 key grid and zero source-key mismatches. Same-OCR replay changed keys 88→98; no parser flags or unmatched keys.
- Live promotion: Promoted from Complete/Partial to Complete/Complete on the original import ID after full JSON backup and concurrency check; 0 approvals/links reset, no old choices lost, and all staged source content verified.

### 202606asiav3.pdf — 92f9b152-1c6a-4537-91e9-a55d588fa7ec

- Live baseline: Questions **complete 98/98** (RW M1 27/27, RW M2 27/27, Math M1 22/22, Math M2 22/22); Answer key **partial 98/98** (RW M1 27/27, RW M2 27/27, Math M1 22/22, Math M2 22/22).
- Review state: 83 needs_review, 15 has_suggested_key; 0 linked question records; generated test no.
- Sources: OCR `Tests Unparsed/post_ocr/2026 06/202606asiav3.ocr.txt`; PDF `Tests Unparsed/Digital SAT Tests/2026 06/202606asiav3.pdf`.
- Existing parser warnings: OCR loaded from saved post_ocr text (no Parse calls in this step).; 6 page(s) contain figures/tables/graphs; affected questions are marked needs_review with page images attached..
- Current-parser replay: Questions **complete 98/98**; Answer key **complete 98/98**; source saved_ocr; no unresolved IDs or unmatched keys.
- Source evidence and diagnosis: The source has all 98 questions and 98 valid raw key entries after rejecting page 6’s numbered equation as a false key. The previous two unresolved Math identities were Q6 and Q15: OCR emitted each number immediately before a figure block, while a preceding grid-in prompt remained buffered and consumed that identity. PDF crops confirm both printed markers; the four-column key grid confirms M2 Q6=B and Q15=B.
- Fix, regression test, and rerun: Added a focused regression proving Q5/Q6 and Q14/Q15 retain their IDs and key assignments when the following numbered prompts are figures. The fix flushes a pending carryover prompt before the next real stem marker. Same-OCR full-cohort replay improves keys 96→98 with zero unmatched entries. Staged replay/source audit passed; promoted to the original import ID after backup and concurrency check, with 0 approvals/links reset and no generated-test or linked-question changes.
- Live promotion: Promoted to Complete/Complete after an accepted source audit. Page 6 and page 8 PDF crops confirm the previously unresolved IDs; answer-key entries match the source.

### 202505usv1.pdf — 42d0badc-9049-47de-ac0b-ac57d949b954

- Live baseline: Questions **partial 97/98** (RW M1 27/27, RW M2 27/27, Math M1 21/22, Math M2 22/22); Answer key **partial 97/98** (RW M1 27/27, RW M2 27/27, Math M1 21/22, Math M2 22/22).
- Review state: 76 has_suggested_key, 21 needs_review; 0 linked question records; generated test no.
- Sources: OCR `Tests Unparsed/post_ocr/2025 05/202505usv1.ocr.txt`; PDF `Tests Unparsed/Digital SAT Tests/2025 05/202505usv1.pdf`.
- Existing parser warnings: OCR loaded from saved post_ocr text (no Parse calls in this step).; 13 page(s) contain figures/tables/graphs; affected questions are marked needs_review with page images attached.; Math Module 1: 21/22 questions (partial — review needed)..
- Current-parser replay: Questions **complete 98/98**; Answer key **partial 91/98**; source saved_ocr; flagged source_question_id_unresolved=6, question_id_recovered_from_neighbors=4; 6 unmatched key entries, 4 low-confidence key matches.
- Source evidence and diagnosis: The parser now recovers 98 questions, but the source key yields only 97 raw entries and 91 safe matches. Page 23’s triangle problem is among six unresolved identities; the key shortfall cannot be filled by guessing.
- Fix, regression test, and rerun: No source-verified shared parser fix yet; keep the residual case for targeted boundary/key work. Final frozen-cohort replay: Questions 98/98 (complete), Answer key 91/98 (partial); 97 raw key entries, 6 unmatched; source saved_ocr.
- Live promotion: Not promoted: source-limited or unresolved parse/key risk; existing drafts and approvals remain untouched.

### 202509us02.pdf — 7c8100e9-7970-41b3-9ff7-04c7de08c34d

- Live baseline: Questions **partial 97/98** (RW M1 27/27, RW M2 27/27, Math M1 21/22, Math M2 22/22); Answer key **partial 97/98** (RW M1 27/27, RW M2 27/27, Math M1 21/22, Math M2 22/22).
- Review state: 85 has_suggested_key, 12 needs_review; 0 linked question records; generated test no.
- Sources: OCR `Tests Unparsed/post_ocr/2025 09/202509us02.ocr.txt`; PDF `Tests Unparsed/Digital SAT Tests/2025 09/202509us02.pdf`.
- Existing parser warnings: OCR loaded from saved post_ocr text (no Parse calls in this step).; 13 page(s) contain figures/tables/graphs; affected questions are marked needs_review with page images attached.; Math Module 1: 21/22 questions (partial — review needed)..
- Existing key warnings: 98 key entries exceed 97 questions.
- Current-parser replay: Questions **complete 98/98**; Answer key **complete 98/98**; source saved_ocr; flagged none; 0 unmatched key entries, 98 low-confidence key matches.
- Source evidence and diagnosis: The PDF page 47 prints Math M1 Question 12, but OCR omits its number; the old parser shifted later question identities and choices. PDF page 52 prints Question 22. The final OCR key page has an exact four-column 27/27/22/22 grid.
- Fix, regression test, and rerun: Existing boundary regression plus source verification recovers Math M1 Questions 12 and 22. Final same-OCR replay 97/97→98/98; stage/content/source audit passed. Final frozen-cohort replay: Questions 98/98 (complete), Answer key 98/98 (complete); 98 raw key entries, 0 unmatched; source saved_ocr.
- Live promotion: Promoted from 97/97 to 98/98 on the original import ID after JSON backup and concurrency check; 0 approvals/links reset, original question records and generated tests unchanged.

### 202509us04.pdf — 203240e6-3f6e-4ead-ad03-f012e967d616

- Live baseline: Questions **partial 97/98** (RW M1 27/27, RW M2 27/27, Math M1 21/22, Math M2 22/22); Answer key **partial 97/98** (RW M1 27/27, RW M2 27/27, Math M1 21/22, Math M2 22/22).
- Review state: 84 has_suggested_key, 12 approved, 1 rejected; 0 linked question records; generated test no.
- Sources: OCR `Tests Unparsed/post_ocr/2025 09/202509us04.ocr.txt`; PDF `Tests Unparsed/Digital SAT Tests/2025 09/202509us04.pdf`.
- Existing parser warnings: OCR loaded from saved post_ocr text (no Parse calls in this step).; 13 page(s) contain figures/tables/graphs; affected questions are marked needs_review with page images attached.; Math Module 1: 21/22 questions (partial — review needed)..
- Existing key warnings: 98 key entries exceed 97 questions.
- Current-parser replay: Questions **complete 98/98**; Answer key **complete 98/98**; source saved_ocr; flagged none; 0 unmatched key entries, 98 low-confidence key matches.
- Source evidence and diagnosis: The PDF page 46 prints Math M1 Question 12 lost as a numbered OCR boundary; page 51 prints Question 22. The end key page has an exact four-column grid. Existing 12 approved and one rejected draft were not linked to question records.
- Fix, regression test, and rerun: Existing boundary recovery reaches 98/98 on the same OCR; staged content and exact key grid passed source audit. Final frozen-cohort replay: Questions 98/98 (complete), Answer key 98/98 (complete); 98 raw key entries, 0 unmatched; source saved_ocr.
- Live promotion: Promoted from 97/97 to 98/98 after backup and concurrency check; 12 approvals and 1 rejection were reset as authorized; no linked question records existed.

### 202510asiav2-new.pdf — 804a4e3b-3f27-4ff7-880d-8dec970119c4

- Live baseline: Questions **partial 97/98** (RW M1 27/27, RW M2 27/27, Math M1 22/22, Math M2 21/22); Answer key **partial 97/98** (RW M1 27/27, RW M2 27/27, Math M1 22/22, Math M2 21/22).
- Review state: 97 approved; 97 linked question records; generated test yes.
- Sources: OCR `Tests Unparsed/post_ocr/2025 10/202510asiav2-new.ocr.txt`; PDF `Tests Unparsed/Digital SAT Tests/2025 10/202510asiav2-new.pdf`.
- Existing parser warnings: OCR loaded from saved post_ocr text (no Parse calls in this step).; 9 page(s) contain figures/tables/graphs; affected questions are marked needs_review with page images attached.; Math Module 2: 21/22 questions (partial — review needed)..
- Existing key warnings: 98 key entries exceed 97 questions.
- Current-parser replay: Questions **complete 98/98**; Answer key **complete 98/98**; source saved_ocr; zero unresolved IDs, unmatched keys, or parser flags.
- Source evidence and diagnosis: The source contains 98 questions and an exact four-column answer grid. Six identities absent from selectable PDF text—RW1 Q13 (page 5), Math2 Q5–7 (page 26), and Math2 Q13–14 (page 28)—were visually confirmed on rendered pages; replay stems and choices align. The Math1 Q7 answer is printed as equivalent alternatives `$1/4 \\mid 0.25$`; normalization confirms the parser’s `1/4, 0.25` representation.
- Fix, regression test, and rerun: Shared carryover-boundary fix resolves the previously unresolved Math prompts. Same-OCR key matches improve 88→98. Source-audit fixes aggregate module-scoped keys across page breaks, normalize LaTeX answer alternatives, preserve visual marker witnesses, and compare split-page choices as continuous text. Staged content and exact key grid passed with no old-choice loss.
- Live promotion: Promoted to Complete/Complete on the original ID after backup and concurrency check; 97 approvals/rejections reset, 97 linked question records verified unchanged, and the existing generated test remained unchanged.

### 202506asiav2.pdf — bca29bda-3f86-4f1a-aa47-2fc9fcd71890

- Live baseline: Questions **partial 96/98** (RW M1 27/27, RW M2 27/27, Math M1 20/22, Math M2 22/22); Answer key **partial 96/98** (RW M1 27/27, RW M2 27/27, Math M1 20/22, Math M2 22/22).
- Review state: 8 approved, 82 has_suggested_key, 3 rejected, 3 needs_review; 0 linked question records; generated test no.
- Sources: OCR `Tests Unparsed/post_ocr/2025 06/202506asiav2.ocr.txt`; PDF `Tests Unparsed/Digital SAT Tests/2025 06/202506asiav2.pdf`.
- Existing parser warnings: OCR loaded from saved post_ocr text (no Parse calls in this step).; 9 page(s) contain figures/tables/graphs; affected questions are marked needs_review with page images attached.; Math Module 1: 20/22 questions (partial — review needed)..
- Existing key warnings: 98 key entries exceed 96 questions.
- Current-parser replay: Questions **complete 98/98**; Answer key **complete 98/98**; source saved_ocr; zero unresolved IDs, unmatched keys, or parser flags.
- Source evidence and diagnosis: All 98 questions and exact 27/27/22/22 keys are present. Previously inferred Math1 Q9 (page 22), Q16–17 (page 24) were visually checked against the PDF; OCR text and choices align. The other inferred Math items retain printed sequence markers in the OCR, and no key mismatches remain.
- Fix, regression test, and rerun: Shared carryover-boundary fix recovers the lost Math slots and key matches improve 88→98 on the same OCR. Staged replay matches all 98 source prompts, choices, and keys; old choices are preserved and source audit accepted.
- Live promotion: Promoted to Complete/Complete on the original ID after backup and concurrency check; 11 prior approved/rejected decisions reset. No linked question records or generated tests were changed.

### 202509us05.pdf — 5b0dea55-44ef-47ae-9bc6-8f30d3f22539

- Live baseline: Questions **partial 96/98** (RW M1 27/27, RW M2 27/27, Math M1 20/22, Math M2 22/22); Answer key **partial 96/98** (RW M1 27/27, RW M2 27/27, Math M1 20/22, Math M2 22/22).
- Review state: 84 has_suggested_key, 9 approved, 3 rejected; 6 linked question records; generated test no.
- Sources: OCR `Tests Unparsed/post_ocr/2025 09/202509us05.ocr.txt`; PDF `Tests Unparsed/Digital SAT Tests/2025 09/202509us05.pdf`.
- Existing parser warnings: OCR loaded from saved post_ocr text (no Parse calls in this step).; 12 page(s) contain figures/tables/graphs; affected questions are marked needs_review with page images attached.; Math Module 1: 20/22 questions (partial — review needed)..
- Existing key warnings: 98 key entries exceed 96 questions.
- Current-parser replay: Questions **complete 98/98**; Answer key **complete 98/98**; source saved_ocr; flagged none; 0 unmatched key entries, 98 low-confidence key matches.
- Source evidence and diagnosis: The source PDF page 50 prints Math M1 Questions 20–22. OCR preserved the two final prompts but did not supply dependable boundaries, so the old parser stored only 20 of the 22 Math M1 items and shifted later identities; the end key grid has all 98 entries.
- Fix, regression test, and rerun: Existing boundary recovery reaches 98/98 on the same OCR. The staged content matched every replayed prompt, choice, and key; all old choices were retained, the four-column key was exact, and the PDF confirmed the two inferred question numbers. Final frozen-cohort replay: Questions 98/98 (complete), Answer key 98/98 (complete); 98 raw key entries, 0 unmatched; source saved_ocr.
- Live promotion: Promoted from 96/96 to 98/98 after backup and concurrency check; 9 approvals and 3 rejections were reset. Six linked question records were hashed before and after and remained unchanged.

### 202510asiav1-new.pdf — 30e58fb4-be59-4f1b-aea2-5d480467debe

- Live baseline: Questions **partial 96/98** (RW M1 27/27, RW M2 27/27, Math M1 22/22, Math M2 20/22); Answer key **partial 96/98** (RW M1 27/27, RW M2 27/27, Math M1 22/22, Math M2 20/22).
- Review state: 95 approved, 1 rejected; 95 linked question records; generated test yes.
- Sources: OCR `Tests Unparsed/post_ocr/2025 10/202510asiav1-new.ocr.txt`; PDF `Tests Unparsed/Digital SAT Tests/2025 10/202510asiav1-new.pdf`.
- Existing parser warnings: OCR loaded from saved post_ocr text (no Parse calls in this step).; 16 page(s) contain figures/tables/graphs; affected questions are marked needs_review with page images attached.; Math Module 2: 20/22 questions (partial — review needed)..
- Existing key warnings: 98 key entries exceed 96 questions.
- Current-parser replay: Questions **complete 98/98**; Answer key **complete 98/98**; source saved_ocr; zero unresolved IDs, unmatched keys, or parser flags.
- Source evidence and diagnosis: All 98 question/key entries are present. Five Math IDs that selectable PDF text could not see (M1 Q1, Q15; M2 Q5, Q9, Q19) were visually confirmed on rendered PDF pages 21, 25, 29, 30, and 33; prompt and choice text matched nearby OCR. The exact source key grid is 27/27/22/22 with no key mismatches.
- Fix, regression test, and rerun: Shared carryover-boundary fix restores these numbered prompts and their key mappings. Same-OCR key matches improve 89→98; staged replay matches all 98 prompts/choices and all keys, with no old-choice loss. Source audit accepted.
- Live promotion: Promoted to Complete/Complete on the original ID; 96 prior approval/rejection states reset under the approved replacement safeguard, 95 linked question records were hash-checked unchanged, and the existing generated test was not modified.

### 202511asiav2.pdf — 0a039e35-8a88-4f02-a667-d882d8f5b7a2

- Live baseline: Questions **partial 92/98** (RW M1 27/27, RW M2 27/27, Math M1 22/22, Math M2 16/22); Answer key **partial 92/98** (RW M1 27/27, RW M2 27/27, Math M1 22/22, Math M2 16/22).
- Review state: 92 approved; 92 linked question records; generated test yes.
- Sources: OCR `Tests Unparsed/post_ocr/2025 11/202511asiav2.ocr.txt`; PDF `Tests Unparsed/Digital SAT Tests/2025 11/202511asiav2.pdf`.
- Existing parser warnings: OCR loaded from saved post_ocr text (no Parse calls in this step).; 15 page(s) contain figures/tables/graphs; affected questions are marked needs_review with page images attached.; Math Module 2: 16/22 questions (partial — review needed)..
- Existing key warnings: 98 key entries exceed 92 questions.
- Current-parser replay: Questions **partial 92/98**; Answer key **partial 74/98**; source saved_ocr; flagged source_question_id_unresolved=18, question_id_recovered_from_neighbors=1; 24 unmatched key entries, 74 low-confidence key matches.
- Source evidence and diagnosis: The OCR contains a 98-entry key but only 92 parsed questions (Math M2 16/22). Page 32’s algebra prompt begins a cluster of ambiguous Math boundaries; 24 key entries stay unmatched.
- Fix, regression test, and rerun: No source-verified shared parser fix yet; keep the residual case for targeted boundary/key work. Final frozen-cohort replay: Questions 92/98 (partial), Answer key 74/98 (partial); 98 raw key entries, 24 unmatched; source saved_ocr.
- Live promotion: Not promoted: source-limited or unresolved parse/key risk; existing drafts and approvals remain untouched.

### 202508usv1.pdf — bc6d2b77-5efc-46db-abb0-0c526bf49570

- Live baseline: Questions **partial 88/98** (RW M1 27/27, RW M2 27/27, Math M1 0/22, Math M2 0/22); Answer key **partial 67/98** (RW M1 25/27, RW M2 27/27, Math M1 0/22, Math M2 0/22).
- Review state: 63 has_suggested_key, 10 missing_key, 15 needs_review; 0 linked question records; generated test no.
- Sources: OCR `Tests Unparsed/post_ocr/2025 08/202508usv1.ocr.txt`; PDF `Tests Unparsed/Digital SAT Tests/2025 08/202508usv1.pdf`.
- Existing parser warnings: OCR loaded from saved post_ocr text (no Parse calls in this step).; 17 page(s) contain figures/tables/graphs; affected questions are marked needs_review with page images attached.; Question Bank – Reading and Writing: 88/27 questions (over count — review needed)..
- Existing key warnings: 98 key entries exceed 88 questions; module key shortfall: Question Bank – Reading and Writing 67/88.
- Current-parser replay: Questions **partial 88/98**; Answer key **partial 64/98**; source saved_ocr; flagged source_question_id_unresolved=21, duplicate_source_number_conflict=7; 36 unmatched key entries, 0 low-confidence key matches.
- Source evidence and diagnosis: This screenshot/global-ID compilation produces 88 questions and 98 raw keys; 34 questions extend beyond the two RW modules, with 36 unmatched keys. Page 4’s bold choice/question boundary is unresolved; canonical positional matching is unsafe.
- Fix, regression test, and rerun: No source-verified shared parser fix yet; keep the residual case for targeted boundary/key work. Final frozen-cohort replay: Questions 88/98 (partial), Answer key 64/98 (partial); 98 raw key entries, 36 unmatched; source saved_ocr.
- Live promotion: Not promoted: source-limited or unresolved parse/key risk; existing drafts and approvals remain untouched.

### 202505asiav2.pdf — 230e00b5-4473-4f06-9635-ee0cddce4a30

- Live baseline: Questions **partial 97/98** (RW M1 27/27, RW M2 27/27, Math M1 21/22, Math M2 22/22); Answer key **partial 54/98** (RW M1 27/27, RW M2 27/27, Math M1 0/22, Math M2 0/22).
- Review state: 51 has_suggested_key, 23 needs_review, 23 missing_key; 0 linked question records; generated test no.
- Sources: OCR `Tests Unparsed/post_ocr/2025 05/202505asiav2.ocr.txt`; PDF `Tests Unparsed/Digital SAT Tests/2025 05/202505asiav2.pdf`.
- Existing parser warnings: OCR loaded from saved post_ocr text (no Parse calls in this step).; 24 page(s) contain figures/tables/graphs; affected questions are marked needs_review with page images attached.; Math Module 1: 21/22 questions (partial — review needed)..
- Existing key warnings: module key shortfall: Math Module 1 0/21; Math Module 2 0/22.
- Current-parser replay: Questions **partial 97/98**; Answer key **partial 54/98**; source saved_ocr; flagged source_question_id_unresolved=8, question_id_recovered_from_neighbors=1; 0 unmatched key entries, 1 low-confidence key matches.
- Source evidence and diagnosis: The source has two exact RW modules with 54 keys, but Math M1 is 21/22 and Math M2 22/22 with no Math answer-key section. Page 27’s triangle item is among uncertain Math identities.
- Fix, regression test, and rerun: No source-verified shared parser fix yet; keep the residual case for targeted boundary/key work. Final frozen-cohort replay: Questions 97/98 (partial), Answer key 54/98 (partial); 54 raw key entries, 0 unmatched; source saved_ocr.
- Live promotion: Not promoted: source-limited or unresolved parse/key risk; existing drafts and approvals remain untouched.

### 202508usv2.pdf — 87a68f8b-4702-4715-9332-4da0a520f14d

- Live baseline: Questions **partial 87/98** (RW M1 27/27, RW M2 27/27, Math M1 0/22, Math M2 0/22); Answer key **partial 63/98** (RW M1 25/27, RW M2 24/27, Math M1 0/22, Math M2 0/22).
- Review state: 59 has_suggested_key, 11 needs_review, 17 missing_key; 0 linked question records; generated test no.
- Sources: OCR `Tests Unparsed/post_ocr/2025 08/202508usv2.ocr.txt`; PDF `Tests Unparsed/Digital SAT Tests/2025 08/202508usv2.pdf`.
- Existing parser warnings: OCR loaded from saved post_ocr text (no Parse calls in this step).; 14 page(s) contain figures/tables/graphs; affected questions are marked needs_review with page images attached.; Question Bank – Reading and Writing: 87/27 questions (over count — review needed)..
- Existing key warnings: 94 key entries exceed 87 questions; module key shortfall: Question Bank – Reading and Writing 63/87.
- Current-parser replay: Questions **partial 87/98**; Answer key **partial 63/98**; source saved_ocr; flagged source_question_id_unresolved=18, duplicate_source_number_conflict=2; 31 unmatched key entries, 0 low-confidence key matches.
- Source evidence and diagnosis: This screenshot-style compilation uses noncanonical/global question IDs; saved OCR and PDF have no reliable 27/27/22/22 module headings. Page 56 has an unresolved Math equation boundary; 94 key entries include 31 unmatched. Treat count-based full-test inference as unsafe.
- Fix, regression test, and rerun: No source-verified shared parser fix yet; keep the residual case for targeted boundary/key work. Final frozen-cohort replay: Questions 87/98 (partial), Answer key 63/98 (partial); 94 raw key entries, 31 unmatched; source saved_ocr.
- Live promotion: Not promoted: source-limited or unresolved parse/key risk; existing drafts and approvals remain untouched.

### 202509asiav4.pdf — ce0006f0-b2a7-4ceb-b3e1-275f2f349414

- Live baseline: Questions **partial 95/98** (RW M1 27/27, RW M2 27/27, Math M1 22/22, Math M2 19/22); Answer key **partial 55/98** (RW M1 26/27, RW M2 27/27, Math M1 2/22, Math M2 0/22).
- Review state: 56 approved, 30 missing_key, 9 needs_review; 56 linked question records; generated test no.
- Sources: OCR `Tests Unparsed/post_ocr/2025 09/202509asiav4.ocr.txt`; PDF `Tests Unparsed/Digital SAT Tests/2025 09/202509asiav4.pdf`.
- Existing parser warnings: OCR loaded from saved post_ocr text (no Parse calls in this step).; 11 page(s) contain figures/tables/graphs; affected questions are marked needs_review with page images attached.; Question Bank – Reading and Writing: 54/27 questions (over count — review needed).; Question Bank – Math: 41/22 questions (over count — review needed)..
- Existing key warnings: 54 key entries parsed but none matched any question.
- Current-parser replay: Questions **partial 96/98**; Answer key **partial 0/98**; source saved_ocr; flagged duplicate_source_number_conflict=56; 54 unmatched key entries, 0 low-confidence key matches.
- Source evidence and diagnosis: OCR/PDF has shorthand RW “MODULE 1”/“Module2”, then 22 Math questions per explicit section. Page 33 has two 27-key RW runs plus compact “M1:” and “M2:” 22-key runs. The old parser merged RW modules, ingested key rows as Math questions, and lost Math keys.
- Fix, regression test, and rerun: Recognize shorthand module headings and bold inline 1–27 question numbers only for this full-test family; skip dense key-only pages; parse compact M1/M2 headings and “or” numeric alternatives. Focused regression passes, same-OCR replay 96/0→98/98. Final frozen-cohort replay: Questions 98/98 (complete), Answer key 98/98 (complete); 98 raw key entries, 0 unmatched; source saved_ocr.
- Live promotion: Promoted from 95 questions / 55 matched keys to 98/98 on the original import ID after backup, source audit, and concurrency check. All 56 linked records were hashed before/after and remained unchanged; no question content or approval state was altered.

### 202508usv4.pdf — c4e16d25-5a8d-4240-b800-3d4503e93ae8

- Live baseline: Questions **partial 88/98** (RW M1 27/27, RW M2 27/27, Math M1 0/22, Math M2 0/22); Answer key **partial 60/98** (RW M1 21/27, RW M2 23/27, Math M1 0/22, Math M2 0/22).
- Review state: 56 has_suggested_key, 10 needs_review, 22 missing_key; 0 linked question records; generated test no.
- Sources: OCR `Tests Unparsed/post_ocr/2025 08/202508usv4.ocr.txt`; PDF `Tests Unparsed/Digital SAT Tests/2025 08/202508usv4.pdf`.
- Existing parser warnings: OCR loaded from saved post_ocr text (no Parse calls in this step).; 12 page(s) contain figures/tables/graphs; affected questions are marked needs_review with page images attached.; Question Bank – Reading and Writing: 88/27 questions (over count — review needed)..
- Existing key warnings: 98 key entries exceed 88 questions; module key shortfall: Question Bank – Reading and Writing 60/88.
- Current-parser replay: Questions **partial 88/98**; Answer key **partial 60/98**; source saved_ocr; flagged source_question_id_unresolved=19; 38 unmatched key entries, 0 low-confidence key matches.
- Source evidence and diagnosis: Screenshot/global-ID bank pages contain 88 recoverable questions and 98 raw keys, but 38 keys remain unmatched. Page 10’s bold global Question 28 illustrates noncanonical numbering; merging by module position would risk wrong answers.
- Fix, regression test, and rerun: No source-verified shared parser fix yet; keep the residual case for targeted boundary/key work. Final frozen-cohort replay: Questions 88/98 (partial), Answer key 60/98 (partial); 98 raw key entries, 38 unmatched; source saved_ocr.
- Live promotion: Not promoted: source-limited or unresolved parse/key risk; existing drafts and approvals remain untouched.

### 202508usv3.pdf — 2654a0a5-606a-4fb5-8d3e-718fd184a61d

- Live baseline: Questions **partial 92/98** (RW M1 27/27, RW M2 27/27, Math M1 0/22, Math M2 0/22); Answer key **partial 50/98** (RW M1 20/27, RW M2 16/27, Math M1 0/22, Math M2 0/22).
- Review state: 49 has_suggested_key, 30 missing_key, 13 needs_review; 0 linked question records; generated test no.
- Sources: OCR `Tests Unparsed/post_ocr/2025 08/202508usv3.ocr.txt`; PDF `Tests Unparsed/Digital SAT Tests/2025 08/202508usv3.pdf`.
- Existing parser warnings: OCR loaded from saved post_ocr text (no Parse calls in this step).; 16 page(s) contain figures/tables/graphs; affected questions are marked needs_review with page images attached.; Question Bank – Reading and Writing: 92/27 questions (over count — review needed)..
- Existing key warnings: 102 key entries exceed 92 questions; module key shortfall: Question Bank – Reading and Writing 50/92.
- Current-parser replay: Questions **partial 92/98**; Answer key **partial 50/98**; source saved_ocr; flagged source_question_id_unresolved=21, duplicate_source_number_conflict=4; 52 unmatched key entries, 0 low-confidence key matches.
- Source evidence and diagnosis: The screenshot-style source has global IDs and fragmented question/visual boundaries (for example page 24, bold Question 24). It yields 92 questions and 102 raw keys, including duplicates/unmatched entries; no trustworthy canonical split.
- Fix, regression test, and rerun: No source-verified shared parser fix yet; keep the residual case for targeted boundary/key work. Final frozen-cohort replay: Questions 92/98 (partial), Answer key 50/98 (partial); 102 raw key entries, 52 unmatched; source saved_ocr.
- Live promotion: Not promoted: source-limited or unresolved parse/key risk; existing drafts and approvals remain untouched.

### 202509us03.pdf — d49e9221-8b21-486a-8bab-6cef7d086530

- Live baseline: Questions **partial 91/98** (RW M1 27/27, RW M2 27/27, Math M1 22/22, Math M2 0/22); Answer key **partial 49/98** (RW M1 27/27, RW M2 0/27, Math M1 22/22, Math M2 0/22).
- Review state: 46 has_suggested_key, 9 needs_review, 36 missing_key; 0 linked question records; generated test no.
- Sources: OCR `Tests Unparsed/post_ocr/2025 09/202509us03.ocr.txt`; PDF `Tests Unparsed/Digital SAT Tests/2025 09/202509us03.pdf`.
- Existing parser warnings: OCR loaded from saved post_ocr text (no Parse calls in this step).; 11 page(s) contain figures/tables/graphs; affected questions are marked needs_review with page images attached.; Question Bank – Reading and Writing: 69/27 questions (over count — review needed)..
- Existing key warnings: 98 key entries exceed 91 questions; module key shortfall: Question Bank – Reading and Writing 27/69.
- Current-parser replay: Questions **partial 91/98**; Answer key **partial 22/98**; source saved_ocr; flagged duplicate_source_number_conflict=69; 76 unmatched key entries, 22 low-confidence key matches.
- Source evidence and diagnosis: The source calls itself “SAT SEPTEMBER BANK.” Four section headings are present, but the first RW section contains 69 parsed items and Math has 22; 98 raw key entries cannot be mapped safely to 91 questions. This is mixed-bank/segmentation rather than an exact full test.
- Fix, regression test, and rerun: No source-verified shared parser fix yet; keep the residual case for targeted boundary/key work. Final frozen-cohort replay: Questions 91/98 (partial), Answer key 22/98 (partial); 98 raw key entries, 76 unmatched; source saved_ocr.
- Live promotion: Not promoted: source-limited or unresolved parse/key risk; existing drafts and approvals remain untouched.

### Full RW Question Bank With Key.pdf — 5a255e65-742d-41e1-ba7c-ca0379257ebc

- Live baseline: Questions **partial 132/98** (RW M1 27/27, RW M2 27/27, Math M1 0/22, Math M2 0/22); Answer key **partial 132/98** (RW M1 27/27, RW M2 27/27, Math M1 0/22, Math M2 0/22).
- Review state: 132 needs_review; 0 linked question records; generated test no.
- Sources: OCR stored page text (100 pages); PDF `Tests Unparsed/Full RW Question Bank With Key.pdf`.
- Current-parser replay: Questions **partial 84/98**; Answer key **partial 84/98**; source stored_page_text; flagged none; 0 unmatched key entries, 0 low-confidence key matches.
- Source evidence and diagnosis: Stored page text is a Reading/Writing question-bank source: 84 replayed keys pair with 84 replayed questions, but 30 questions lie beyond the two canonical RW modules and the PDF has no Math modules. The saved live draft contains 132 entries, so this is also a parser-version/content-regression candidate, not a safe full-test promotion.
- Fix, regression test, and rerun: No source-verified shared parser fix yet; keep the residual case for targeted boundary/key work. Final frozen-cohort replay: Questions 84/98 (partial), Answer key 84/98 (partial); 84 raw key entries, 0 unmatched; source stored_page_text.
- Live promotion: Not promoted: source-limited or unresolved parse/key risk; existing drafts and approvals remain untouched.

### 202505asiav1.pdf — ad58d621-826c-4187-a241-504927d786b4

- Live baseline: Questions **partial 54/98** (RW M1 27/27, RW M2 27/27, Math M1 0/22, Math M2 0/22); Answer key **partial 54/98** (RW M1 27/27, RW M2 27/27, Math M1 0/22, Math M2 0/22).
- Review state: 45 has_suggested_key, 9 needs_review; 0 linked question records; generated test no.
- Sources: OCR `Tests Unparsed/post_ocr/2025 05/202505asiav1.ocr.txt`; PDF `Tests Unparsed/Digital SAT Tests/2025 05/202505asiav1.pdf`.
- Existing parser warnings: OCR loaded from saved post_ocr text (no Parse calls in this step).; 4 page(s) contain figures/tables/graphs; affected questions are marked needs_review with page images attached..
- Current-parser replay: Questions **partial 54/98**; Answer key **partial 54/98**; source saved_ocr; flagged none; 0 unmatched key entries, 1 low-confidence key matches.
- Source evidence and diagnosis: The source contains two 27-question RW modules and 54 corresponding keys; Math headings are index/count stubs without question content. The 54/54 replay is faithful to this RW-only source, which cannot pass the strict full-test rule.
- Fix, regression test, and rerun: No source-verified shared parser fix yet; keep the residual case for targeted boundary/key work. Final frozen-cohort replay: Questions 54/98 (partial), Answer key 54/98 (partial); 54 raw key entries, 0 unmatched; source saved_ocr.
- Live promotion: Not promoted: source-limited or unresolved parse/key risk; existing drafts and approvals remain untouched.

### 202506asiav1-rw.pdf — 061d8acb-6e5d-4b29-97f0-a866686ba410

- Live baseline: Questions **partial 54/98** (RW M1 27/27, RW M2 27/27, Math M1 0/22, Math M2 0/22); Answer key **partial 54/98** (RW M1 27/27, RW M2 27/27, Math M1 0/22, Math M2 0/22).
- Review state: 51 has_suggested_key, 3 needs_review; 0 linked question records; generated test no.
- Sources: OCR `Tests Unparsed/post_ocr/2025 06/202506asiav1-rw.ocr.txt`; PDF `Tests Unparsed/Digital SAT Tests/2025 06/202506asiav1-rw.pdf`.
- Existing parser warnings: OCR loaded from saved post_ocr text (no Parse calls in this step).; 3 page(s) contain figures/tables/graphs; affected questions are marked needs_review with page images attached..
- Current-parser replay: Questions **partial 54/98**; Answer key **partial 54/98**; source saved_ocr; flagged none; 0 unmatched key entries, 2 low-confidence key matches.
- Source evidence and diagnosis: The PDF/OCR has only RW M1 and M2 content, exactly 27 questions and 27 keys each; Math headings are empty count stubs. Missing Math questions are source-limited, not parser omissions.
- Fix, regression test, and rerun: No source-verified shared parser fix yet; keep the residual case for targeted boundary/key work. Final frozen-cohort replay: Questions 54/98 (partial), Answer key 54/98 (partial); 54 raw key entries, 0 unmatched; source saved_ocr.
- Live promotion: Not promoted: source-limited or unresolved parse/key risk; existing drafts and approvals remain untouched.

### 202508asiav2-rw.pdf — 8804b47e-5126-420f-a851-b6949abfcbe6

- Live baseline: Questions **partial 54/98** (RW M1 27/27, RW M2 27/27, Math M1 0/22, Math M2 0/22); Answer key **partial 54/98** (RW M1 27/27, RW M2 27/27, Math M1 0/22, Math M2 0/22).
- Review state: 50 has_suggested_key, 4 needs_review; 0 linked question records; generated test no.
- Sources: OCR `Tests Unparsed/post_ocr/2025 08/202508asiav2-rw.ocr.txt`; PDF `Tests Unparsed/Digital SAT Tests/2025 08/202508asiav2-rw.pdf`.
- Existing parser warnings: OCR loaded from saved post_ocr text (no Parse calls in this step).; 4 page(s) contain figures/tables/graphs; affected questions are marked needs_review with page images attached..
- Current-parser replay: Questions **partial 54/98**; Answer key **partial 54/98**; source saved_ocr; flagged none; 0 unmatched key entries, 0 low-confidence key matches.
- Source evidence and diagnosis: The source name and OCR show RW-only content: two exact 27-question/key modules. Math headings in the OCR are table-of-contents stubs without Math question bodies.
- Fix, regression test, and rerun: No source-verified shared parser fix yet; keep the residual case for targeted boundary/key work. Final frozen-cohort replay: Questions 54/98 (partial), Answer key 54/98 (partial); 54 raw key entries, 0 unmatched; source saved_ocr.
- Live promotion: Not promoted: source-limited or unresolved parse/key risk; existing drafts and approvals remain untouched.

### 202508asiav3-rw.pdf — 109a6422-9447-4b63-8c53-84374d9db8bd

- Live baseline: Questions **partial 54/98** (RW M1 27/27, RW M2 27/27, Math M1 0/22, Math M2 0/22); Answer key **partial 54/98** (RW M1 27/27, RW M2 27/27, Math M1 0/22, Math M2 0/22).
- Review state: 31 needs_review, 23 has_suggested_key; 0 linked question records; generated test no.
- Sources: OCR `Tests Unparsed/post_ocr/2025 08/202508asiav3-rw.ocr.txt`; PDF `Tests Unparsed/Digital SAT Tests/2025 08/202508asiav3-rw.pdf`.
- Existing parser warnings: OCR loaded from saved post_ocr text (no Parse calls in this step).; 5 page(s) contain figures/tables/graphs; affected questions are marked needs_review with page images attached..
- Current-parser replay: Questions **partial 54/98**; Answer key **partial 54/98**; source saved_ocr; flagged none; 0 unmatched key entries, 0 low-confidence key matches.
- Source evidence and diagnosis: The source name and OCR show RW-only content: two exact 27-question/key modules. Math headings are count stubs without Math question bodies.
- Fix, regression test, and rerun: No source-verified shared parser fix yet; keep the residual case for targeted boundary/key work. Final frozen-cohort replay: Questions 54/98 (partial), Answer key 54/98 (partial); 54 raw key entries, 0 unmatched; source saved_ocr.
- Live promotion: Not promoted: source-limited or unresolved parse/key risk; existing drafts and approvals remain untouched.

### 202605asIav1-rw.pdf — e37ce1fd-757a-4226-9e12-7b4cf4106be4

- Live baseline: Questions **partial 54/98** (RW M1 27/27, RW M2 27/27, Math M1 0/22, Math M2 0/22); Answer key **partial 54/98** (RW M1 27/27, RW M2 27/27, Math M1 0/22, Math M2 0/22).
- Review state: 51 has_suggested_key, 3 needs_review; 0 linked question records; generated test no.
- Sources: OCR `Tests Unparsed/post_ocr/2026 05/202605asIav1-rw.ocr.txt`; PDF `Tests Unparsed/Digital SAT Tests/2026 05/202605asIav1-rw.pdf`.
- Existing parser warnings: OCR loaded from saved post_ocr text (no Parse calls in this step).; 4 page(s) contain figures/tables/graphs; affected questions are marked needs_review with page images attached..
- Current-parser replay: Questions **partial 54/98**; Answer key **partial 54/98**; source saved_ocr; flagged none; 0 unmatched key entries, 0 low-confidence key matches.
- Source evidence and diagnosis: OCR provides exact RW M1/M2 counts and 54 keys; Math pages are only empty heading/count stubs. No Math questions are present to recover.
- Fix, regression test, and rerun: No source-verified shared parser fix yet; keep the residual case for targeted boundary/key work. Final frozen-cohort replay: Questions 54/98 (partial), Answer key 54/98 (partial); 54 raw key entries, 0 unmatched; source saved_ocr.
- Live promotion: Not promoted: source-limited or unresolved parse/key risk; existing drafts and approvals remain untouched.

### 202605usv1-rw.pdf — 9c52c3be-1129-4b12-b995-ebc56e7c95ed

- Live baseline: Questions **partial 54/98** (RW M1 27/27, RW M2 27/27, Math M1 0/22, Math M2 0/22); Answer key **partial 54/98** (RW M1 27/27, RW M2 27/27, Math M1 0/22, Math M2 0/22).
- Review state: 51 has_suggested_key, 3 needs_review; 0 linked question records; generated test no.
- Sources: OCR `Tests Unparsed/post_ocr/2026 05/202605usv1-rw.ocr.txt`; PDF `Tests Unparsed/Digital SAT Tests/2026 05/202605usv1-rw.pdf`.
- Existing parser warnings: OCR loaded from saved post_ocr text (no Parse calls in this step).; 4 page(s) contain figures/tables/graphs; affected questions are marked needs_review with page images attached..
- Current-parser replay: Questions **partial 54/98**; Answer key **partial 54/98**; source saved_ocr; flagged none; 0 unmatched key entries, 54 low-confidence key matches.
- Source evidence and diagnosis: The file begins “Module 1: Reading and Writing” and includes only two RW modules and 54 keys. This is source-limited under the full-test import rule.
- Fix, regression test, and rerun: No source-verified shared parser fix yet; keep the residual case for targeted boundary/key work. Final frozen-cohort replay: Questions 54/98 (partial), Answer key 54/98 (partial); 54 raw key entries, 0 unmatched; source saved_ocr.
- Live promotion: Not promoted: source-limited or unresolved parse/key risk; existing drafts and approvals remain untouched.

### 202503asiav6.pdf — 1efb7cc3-0023-4ba7-b539-714049dab24f

- Live baseline: Questions **partial 97/98** (RW M1 27/27, RW M2 25/27, Math M1 21/22, Math M2 24/22); Answer key **failed 0/98** (RW M1 0/27, RW M2 0/27, Math M1 0/22, Math M2 0/22).
- Review state: 70 missing_key, 27 needs_review; 0 linked question records; generated test no.
- Sources: OCR `Tests Unparsed/post_ocr/2025 03/202503asiav6.ocr.txt`; PDF `Tests Unparsed/Digital SAT Tests/2025 03/202503asiav6.pdf`.
- Existing parser warnings: OCR loaded from saved post_ocr text (no Parse calls in this step).; 28 page(s) contain figures/tables/graphs; affected questions are marked needs_review with page images attached.; Reading and Writing Module 2: 25/27 questions (partial — review needed).; Math Module 1: 21/22 questions (partial — review needed).; Math Module 2: 24/22 questions (over count — review needed)..
- Current-parser replay: Questions **partial 97/98**; Answer key **failed 0/98**; source saved_ocr; flagged source_question_id_unresolved=9; 0 unmatched key entries, 0 low-confidence key matches.
- Source evidence and diagnosis: Bluebook-like screenshots repeat Section 1, Module 1 headings. Replay yields RW2 25, Math1 21, Math2 24, with no key entries; page 59’s technician problem is among unresolved boundaries. Question and key incompleteness remain.
- Fix, regression test, and rerun: No source-verified shared parser fix yet; keep the residual case for targeted boundary/key work. Final frozen-cohort replay: Questions 97/98 (partial), Answer key 0/98 (failed); 0 raw key entries, 0 unmatched; source saved_ocr.
- Live promotion: Not promoted: source-limited or unresolved parse/key risk; existing drafts and approvals remain untouched.

### 202505asiav3.pdf — d9c65800-e3c7-4df3-9559-be960a0c59ae

- Live baseline: Questions **partial 100/98** (RW M1 27/27, RW M2 28/27, Math M1 23/22, Math M2 22/22); Answer key **failed 0/98** (RW M1 0/27, RW M2 0/27, Math M1 0/22, Math M2 0/22).
- Review state: 58 missing_key, 42 needs_review; 0 linked question records; generated test no.
- Sources: OCR `Tests Unparsed/post_ocr/2025 05/202505asiav3.ocr.txt`; PDF `Tests Unparsed/Digital SAT Tests/2025 05/202505asiav3.pdf`.
- Existing parser warnings: OCR loaded from saved post_ocr text (no Parse calls in this step).; 43 page(s) contain figures/tables/graphs; affected questions are marked needs_review with page images attached.; Reading and Writing Module 2: 28/27 questions (over count — review needed).; Math Module 1: 23/22 questions (over count — review needed)..
- Current-parser replay: Questions **partial 99/98**; Answer key **failed 0/98**; source saved_ocr; flagged source_question_id_unresolved=6, repeated_source_question_coalesced=1; 0 unmatched key entries, 0 low-confidence key matches.
- Source evidence and diagnosis: The source includes no answer key. Math M1 has 23 parsed entries against 22 expected; page 13’s table question and a repeated source-number coalescence require further boundary review before any replacement.
- Fix, regression test, and rerun: No source-verified shared parser fix yet; keep the residual case for targeted boundary/key work. Final frozen-cohort replay: Questions 99/98 (partial), Answer key 0/98 (failed); 0 raw key entries, 0 unmatched; source saved_ocr.
- Live promotion: Not promoted: source-limited or unresolved parse/key risk; existing drafts and approvals remain untouched.

### 202503asiav8.pdf — 46525c1c-c446-409b-b52a-72cffd1f397d

- Live baseline: Questions **partial 89/98** (RW M1 27/27, RW M2 27/27, Math M1 0/22, Math M2 0/22); Answer key **failed 0/98** (RW M1 0/27, RW M2 0/27, Math M1 0/22, Math M2 0/22).
- Review state: 80 missing_key, 9 needs_review; 0 linked question records; generated test no.
- Sources: OCR `Tests Unparsed/post_ocr/2025 03/202503asiav8.ocr.txt`; PDF `Tests Unparsed/Digital SAT Tests/2025 03/202503asiav8.pdf`.
- Existing parser warnings: OCR loaded from saved post_ocr text (no Parse calls in this step).; 10 page(s) contain figures/tables/graphs; affected questions are marked needs_review with page images attached.; Question Bank – Reading and Writing: 89/27 questions (over count — review needed)..
- Current-parser replay: Questions **partial 89/98**; Answer key **failed 0/98**; source saved_ocr; flagged none; 0 unmatched key entries, 0 low-confidence key matches.
- Source evidence and diagnosis: The PDF/OCR uses global IDs beginning at 589 and has no answer key. Eighty-nine bank questions are recoverable, but no canonical 98-question module structure exists.
- Fix, regression test, and rerun: No source-verified shared parser fix yet; keep the residual case for targeted boundary/key work. Final frozen-cohort replay: Questions 89/98 (partial), Answer key 0/98 (failed); 0 raw key entries, 0 unmatched; source saved_ocr.
- Live promotion: Not promoted: source-limited or unresolved parse/key risk; existing drafts and approvals remain untouched.

### 202503asiav9.pdf — dee2b151-7e6f-40e9-bdf0-8badbc1ef253

- Live baseline: Questions **partial 89/98** (RW M1 27/27, RW M2 27/27, Math M1 0/22, Math M2 0/22); Answer key **failed 0/98** (RW M1 0/27, RW M2 0/27, Math M1 0/22, Math M2 0/22).
- Review state: 81 missing_key, 8 needs_review; 0 linked question records; generated test no.
- Sources: OCR `Tests Unparsed/post_ocr/2025 03/202503asiav9.ocr.txt`; PDF `Tests Unparsed/Digital SAT Tests/2025 03/202503asiav9.pdf`.
- Existing parser warnings: OCR loaded from saved post_ocr text (no Parse calls in this step).; 9 page(s) contain figures/tables/graphs; affected questions are marked needs_review with page images attached.; Question Bank – Reading and Writing: 89/27 questions (over count — review needed)..
- Current-parser replay: Questions **partial 89/98**; Answer key **failed 0/98**; source saved_ocr; flagged none; 0 unmatched key entries, 0 low-confidence key matches.
- Source evidence and diagnosis: The PDF/OCR uses global IDs beginning at 736 and has no answer key. Eighty-nine bank questions are recoverable, but no canonical 98-question module structure exists.
- Fix, regression test, and rerun: No source-verified shared parser fix yet; keep the residual case for targeted boundary/key work. Final frozen-cohort replay: Questions 89/98 (partial), Answer key 0/98 (failed); 0 raw key entries, 0 unmatched; source saved_ocr.
- Live promotion: Not promoted: source-limited or unresolved parse/key risk; existing drafts and approvals remain untouched.

### 202503asiav5.pdf — f9c58ba7-a712-49a8-94ac-8ec2c12271fe

- Live baseline: Questions **partial 88/98** (RW M1 0/27, RW M2 0/27, Math M1 22/22, Math M2 22/22); Answer key **partial 0/98** (RW M1 0/27, RW M2 0/27, Math M1 0/22, Math M2 0/22).
- Review state: 74 missing_key, 14 needs_review; 0 linked question records; generated test no.
- Sources: OCR `Tests Unparsed/post_ocr/2025 03/202503asiav5.ocr.txt`; PDF `Tests Unparsed/Digital SAT Tests/2025 03/202503asiav5.pdf`.
- Existing parser warnings: OCR loaded from saved post_ocr text (no Parse calls in this step).; 18 page(s) contain figures/tables/graphs; affected questions are marked needs_review with page images attached.; Question Bank – Math: 88/22 questions (over count — review needed)..
- Existing key warnings: 54 key entries parsed but none matched any question.
- Current-parser replay: Questions **partial 88/98**; Answer key **partial 0/98**; source saved_ocr; flagged none; 54 unmatched key entries, 0 low-confidence key matches.
- Source evidence and diagnosis: Source title lists global ranges RW 175–228 and Math 251–294; 54 RW key entries cannot match those global IDs under canonical module matching. Eighty-eight questions are recoverable; the source/key coverage is not a clean 98/98 full test.
- Fix, regression test, and rerun: No source-verified shared parser fix yet; keep the residual case for targeted boundary/key work. Final frozen-cohort replay: Questions 88/98 (partial), Answer key 0/98 (partial); 54 raw key entries, 54 unmatched; source saved_ocr.
- Live promotion: Not promoted: source-limited or unresolved parse/key risk; existing drafts and approvals remain untouched.

### 202503usv3.pdf — f44bb670-8976-4ddc-9f9e-a9963eb38145

- Live baseline: Questions **partial 88/98** (RW M1 27/27, RW M2 27/27, Math M1 0/22, Math M2 0/22); Answer key **partial 0/98** (RW M1 0/27, RW M2 0/27, Math M1 0/22, Math M2 0/22).
- Review state: 82 missing_key, 6 needs_review; 0 linked question records; generated test no.
- Sources: OCR `Tests Unparsed/post_ocr/2025 03/202503usv3.ocr.txt`; PDF `Tests Unparsed/Digital SAT Tests/2025 03/202503usv3.pdf`.
- Existing parser warnings: OCR loaded from saved post_ocr text (no Parse calls in this step).; 7 page(s) contain figures/tables/graphs; affected questions are marked needs_review with page images attached.; Question Bank – Reading and Writing: 88/27 questions (over count — review needed)..
- Existing key warnings: 54 key entries parsed but none matched any question.
- Current-parser replay: Questions **partial 88/98**; Answer key **partial 0/98**; source saved_ocr; flagged none; 54 unmatched key entries, 0 low-confidence key matches.
- Source evidence and diagnosis: The source title labels global Question 496–522 ranges, and the OCR starts at ID 469. Fifty-four raw key entries are present but none can be safely aligned with the 88 bank-style questions.
- Fix, regression test, and rerun: No source-verified shared parser fix yet; keep the residual case for targeted boundary/key work. Final frozen-cohort replay: Questions 88/98 (partial), Answer key 0/98 (partial); 54 raw key entries, 54 unmatched; source saved_ocr.
- Live promotion: Not promoted: source-limited or unresolved parse/key risk; existing drafts and approvals remain untouched.

### 202505usv2.pdf — e0296651-586c-429b-addb-38cc54870909

- Live baseline: Questions **partial 129/98** (RW M1 27/27, RW M2 27/27, Math M1 0/22, Math M2 0/22); Answer key **failed 0/98** (RW M1 0/27, RW M2 0/27, Math M1 0/22, Math M2 0/22).
- Review state: 111 missing_key, 18 needs_review; 0 linked question records; generated test no.
- Sources: OCR `Tests Unparsed/post_ocr/2025 05/202505usv2.ocr.txt`; PDF `Tests Unparsed/Digital SAT Tests/2025 05/202505usv2.pdf`.
- Existing parser warnings: OCR loaded from saved post_ocr text (no Parse calls in this step).; 16 page(s) contain figures/tables/graphs; affected questions are marked needs_review with page images attached.; Question Bank – Reading and Writing: 129/27 questions (over count — review needed)..
- Current-parser replay: Questions **partial 129/98**; Answer key **failed 0/98**; source saved_ocr; flagged none; 0 unmatched key entries, 0 low-confidence key matches.
- Source evidence and diagnosis: The source begins with global bank ID 23832 and contains 129 recoverable questions with no answer key. It is a question-bank compilation, not a 98-question full test.
- Fix, regression test, and rerun: No source-verified shared parser fix yet; keep the residual case for targeted boundary/key work. Final frozen-cohort replay: Questions 129/98 (partial), Answer key 0/98 (failed); 0 raw key entries, 0 unmatched; source saved_ocr.
- Live promotion: Not promoted: source-limited or unresolved parse/key risk; existing drafts and approvals remain untouched.

### 202606asiav4.pdf — 5be74619-83d9-4847-8f86-1a3c7d3d6aa2

- Live baseline: Questions **partial 62/98** (RW M1 62/27, RW M2 0/27, Math M1 0/22, Math M2 0/22); Answer key **failed 0/98** (RW M1 0/27, RW M2 0/27, Math M1 0/22, Math M2 0/22).
- Review state: 62 missing_key; 0 linked question records; generated test no.
- Sources: OCR absent; PDF `Tests Unparsed/Digital SAT Tests/2026 06/202606asiav4.pdf`.
- Existing parser warnings: Reading and Writing Module 1: 62/27 questions (over count — module boundaries may be missing, review needed)..
- Current-parser replay: Questions **complete 98/98**; Answer key **complete 98/98**; source new_ocr (7 physical pages, 23 billed pages); one neighboring-marker-recovered question ID was visually confirmed on PDF page 6; 0 unmatched keys.
- Source evidence and diagnosis: The seven-page compact PDF had only 70 questions through selectable text. Fresh 23-billed-page OCR exposes 98 ordered questions and a four-column 27/27/22/22 key grid; one question ID is recovered from neighbors. This is an OCR loss plus headingless module-segmentation defect.
- Fix, regression test, and rerun: Fresh OCR exposed the complete source. Guarded 27/27/22/22 reconstruction, four-column key parsing, and inline bold question-number recognition now yield 98/98. The recovered ID and question/choice text were source-checked; regression tests pass. Final replay: Questions 98/98 (complete), Answer key 98/98 (complete); 98 raw keys, 0 unmatched; source new_ocr.
- Live promotion: Promoted to the original import ID after staged audit and backup; the previous 62-draft set had no approvals or links to reset. Imports summary and detail show the 98-question, 98-key draft.

### 202509asiav2-rw.pdf — 8cb061e0-93fe-4246-9af3-22c009eaeb06

- Live baseline: Questions **partial 27/98** (RW M1 27/27, RW M2 0/27, Math M1 0/22, Math M2 0/22); Answer key **partial 27/98** (RW M1 27/27, RW M2 0/27, Math M1 0/22, Math M2 0/22).
- Review state: 1 approved, 22 has_suggested_key, 4 needs_review; 1 linked question records; generated test no.
- Sources: OCR `Tests Unparsed/post_ocr/2025 09/202509asiav2-rw.ocr.txt`; PDF `Tests Unparsed/Digital SAT Tests/2025 09/202509asiav2-rw.pdf`.
- Existing parser warnings: OCR loaded from saved post_ocr text (no Parse calls in this step).; 5 page(s) contain figures/tables/graphs; affected questions are marked needs_review with page images attached..
- Current-parser replay: Questions **partial 27/98**; Answer key **partial 27/98**; source saved_ocr; flagged none; 0 unmatched key entries, 0 low-confidence key matches.
- Source evidence and diagnosis: The source contains one 27-question RW module with 27 keys and no other question modules. This is a genuine section-only upload under the strict full-test rule.
- Fix, regression test, and rerun: No source-verified shared parser fix yet; keep the residual case for targeted boundary/key work. Final frozen-cohort replay: Questions 27/98 (partial), Answer key 27/98 (partial); 27 raw key entries, 0 unmatched; source saved_ocr.
- Live promotion: Not promoted: source-limited or unresolved parse/key risk; existing drafts and approvals remain untouched.

### 202606usv1.pdf — 1391b5fc-23a1-4b5a-bd26-b719bb0f656c

- Live baseline: Questions **partial 48/98** (RW M1 48/27, RW M2 0/27, Math M1 0/22, Math M2 0/22); Answer key **failed 0/98** (RW M1 0/27, RW M2 0/27, Math M1 0/22, Math M2 0/22).
- Review state: 48 missing_key; 0 linked question records; generated test no.
- Sources: OCR absent; PDF `Tests Unparsed/Digital SAT Tests/2026 06/202606usv1.pdf`.
- Existing parser warnings: Reading and Writing Module 1: 48/27 questions (over count — module boundaries may be missing, review needed; OCR fallback attempted).; OCR failed on 12 page(s): 2 (fetch failed); 3 (fetch failed); 10 (fetch failed); 15 (fetch failed); 20 (fetch failed); 23 (fetch failed); 31 (fetch failed); 36 (fetch failed); 38 (fetch failed); 43 (fetch failed); 44 (fetch failed); 52 (fetch failed)..
- Current-parser replay: Questions **complete 98/98**; Answer key **complete 98/98**; source new_ocr (53 physical pages, 53 billed pages); all formerly missed Math markers are recovered; exact four-column key grid, 0 unmatched keys, and no unresolved IDs.
- Source evidence and diagnosis: Selectable extraction missed all usable questions. Fresh OCR of all 53 pages exposed 98 key entries and visible Math prompts, including ten Math markers initially missed when numbered math blocks followed choice layouts.
- Fix, regression test, and rerun: Isolated numbered-block recovery was adjusted so math expressions following option groups stay in their intended question slots. OCR boundary regression tests pass; all ten Math IDs, prompt/choice spans, and the exact four-column key grid were source-checked. Final replay: Questions 98/98 (complete), Answer key 98/98 (complete); 98 raw keys, 0 unmatched; source new_ocr.
- Live promotion: Promoted after staged audit and backup; the previous 48-draft set had no approvals or links to reset. Imports summary and detail show the verified 98/98 draft.

### 202510asiav4.pdf — 65ca5fa9-faf5-4bc4-beb4-250b3cc340ec

- Live baseline: Questions **partial 40/98** (RW M1 27/27, RW M2 13/27, Math M1 0/22, Math M2 0/22); Answer key **failed 0/98** (RW M1 0/27, RW M2 0/27, Math M1 0/22, Math M2 0/22).
- Review state: 31 missing_key, 9 needs_review; 0 linked question records; generated test no.
- Sources: OCR `Tests Unparsed/post_ocr/2025 10/202510asiav4.ocr.txt`; PDF `Tests Unparsed/Digital SAT Tests/2025 10/202510asiav4.pdf`.
- Existing parser warnings: OCR loaded from saved post_ocr text (no Parse calls in this step).; 20 page(s) contain figures/tables/graphs; affected questions are marked needs_review with page images attached.; Question Bank – Reading and Writing: 40/27 questions (over count — review needed)..
- Current-parser replay: Questions **partial 59/98**; Answer key **failed 0/98**; source saved_ocr; flagged duplicate_source_number_conflict=47; 0 unmatched key entries, 0 low-confidence key matches.
- Source evidence and diagnosis: The one-question-per-page compilation has 59 recoverable prompts and no answer key. Page 1 begins a translated-literature item, but no canonical module/key evidence supports full-test completion.
- Fix, regression test, and rerun: No source-verified shared parser fix yet; keep the residual case for targeted boundary/key work. Final frozen-cohort replay: Questions 59/98 (partial), Answer key 0/98 (failed); 0 raw key entries, 0 unmatched; source saved_ocr.
- Live promotion: Not promoted: source-limited or unresolved parse/key risk; existing drafts and approvals remain untouched.

### 202510asiav3.pdf — 113724ac-ef9d-4160-8a26-12700dab6910

- Live baseline: Questions **partial 38/98** (RW M1 27/27, RW M2 11/27, Math M1 0/22, Math M2 0/22); Answer key **failed 0/98** (RW M1 0/27, RW M2 0/27, Math M1 0/22, Math M2 0/22).
- Review state: 6 needs_review, 32 missing_key; 0 linked question records; generated test no.
- Sources: OCR `Tests Unparsed/post_ocr/2025 10/202510asiav3.ocr.txt`; PDF `Tests Unparsed/Digital SAT Tests/2025 10/202510asiav3.pdf`.
- Existing parser warnings: OCR loaded from saved post_ocr text (no Parse calls in this step).; 19 page(s) contain figures/tables/graphs; affected questions are marked needs_review with page images attached.; Question Bank – Reading and Writing: 38/27 questions (over count — review needed)..
- Current-parser replay: Questions **partial 61/98**; Answer key **failed 0/98**; source saved_ocr; flagged duplicate_source_number_conflict=46; 0 unmatched key entries, 0 low-confidence key matches.
- Source evidence and diagnosis: The PDF/OCR is a one-question-per-page compilation with no answer key or canonical module boundaries. Replay recovers 61 prompts; page 1’s graph-data question is flagged with duplicate/global numbering. It is not a verified 98-question keyed test.
- Fix, regression test, and rerun: No source-verified shared parser fix yet; keep the residual case for targeted boundary/key work. Final frozen-cohort replay: Questions 61/98 (partial), Answer key 0/98 (failed); 0 raw key entries, 0 unmatched; source saved_ocr.
- Live promotion: Not promoted: source-limited or unresolved parse/key risk; existing drafts and approvals remain untouched.
