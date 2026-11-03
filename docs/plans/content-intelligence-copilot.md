# Feature plan 1: AI Content Intelligence Copilot

The Content Intelligence Copilot turns the existing PDF importer into a reviewed content-production system. It uses AI where document interpretation is useful, deterministic checks where correctness can be established directly, and human approval at the publication boundary.

The three capabilities share the current Cohere OCR worker, Supabase draft tables, SAT taxonomy, and admin import editor. They should be delivered in the order below so later predictions and duplicate checks operate on a trustworthy corpus.

## 1. AI-reviewed ingestion with human sign-off

Extend the current import path into:

```text
PDF -> OCR -> SAT parser -> deterministic risk checks -> selective AI review -> human sign-off -> publish
```

The existing worker remains responsible for page extraction, OCR, question parsing, answer-key matching, visual crops, and source provenance. Deterministic review runs automatically and first validates the import structure. A structurally failed full test stops before AI and marks every derived draft Failed. Imports that pass are checked question by question: clear drafts become Complete, major risks go directly to human Review, and minor repairable risks receive an automatic source-grounded multimodal AI repair when a dedicated review API key is configured. Without that key, minor-risk questions go directly to human Review. There is no random quality-control sample or manual AI-run control.

The model returns structured findings and, at confidence 0.80 or higher, may repair validated passage, prompt, choice, answer, visual-association, and crop fields in the working draft. Every finding identifies the source page, evidence, severity, explanation, and proposed correction. The parser original, AI-fixed snapshot, and field diff remain auditable. Every AI-attempted question still goes to human Review; AI never approves, rejects, publishes, or marks a question Failed or Complete.

Every draft receives one current review state:

- `Complete`: automated review finished with no unresolved risk, or a human resolved the question in Review. Complete questions need no individual sign-off. An administrator approves the import once all its questions are Complete; that action approves the drafts and assembles the test.
- `Review`: a human must inspect the parser risks, AI-fixed version, source image, answer, and any crop before approval.
- `Failed`: import-level structural validation failed, so downstream review and publication are disabled until Full Reprocess succeeds.

The admin editor presents these states as queues, shows import warnings above the questions, summarizes deterministic risks and AI changes, and opens the supporting source image. Human edits invalidate stale review results. Dismissing a finding requires a reason and becomes evaluation feedback. Full Reprocess reruns OCR, parsing, deterministic gates, and downstream review from the stored PDF. The Approve Import action is enabled only when every question is Complete and approval prerequisites such as answer coverage and confirmed visual crops are met.

Production evidence will include extraction correctness, serious-defect recall, the serious-defect rate among Complete drafts, human review time, latency, failure rate, and cost per approved question. The detailed implementation is in [the ingestion implementation plan](ai-content-ingestion-implementation.md), and the reporting contract is in [the ingestion evaluation report](../evals/ai-content-ingestion-evaluation.md).

## 2. Domain, skill, and difficulty predictions

Predict missing metadata for full-length-test questions after ingestion review. Domain and skill form a closed, hierarchical classification problem: the predicted skill must belong to the predicted domain and both must come from the project SAT taxonomy. Source-provided labels remain authoritative; predictions are stored separately with model version, evidence, confidence, and the administrator's decision.

Begin with two measurable baselines:

- a lightweight supervised text classifier trained only after the reviewed corpus contains enough examples for each supported class;
- a constrained language-model classifier that must choose from the same taxonomy and return structured evidence.

Select the approach from held-out performance, latency, cost, and calibration rather than model novelty. Split evaluation data by source test and duplicate group so variants of the same question cannot appear in both training and evaluation. Report macro-F1, per-class precision and recall, hierarchical consistency, coverage at each confidence threshold, expected calibration error, latency, and cost.

Difficulty is a separate prediction task. Initially label it clearly as an editorial estimate based on question content and reasoning burden. Do not present it as psychometric item difficulty. Once sufficient student response data exists, calibrate it against empirical correctness and ability estimates and report the relationship between editorial and observed difficulty.

Administrators can accept, replace, or dismiss each prediction. These decisions create a versioned training and evaluation dataset. No prediction silently overwrites source metadata or enters the published question bank without human acceptance.

## 3. Lexical duplicate and conflicting-key detection

Detect repeated questions with a cost-efficient lexical pipeline tailored to the fact that true duplicates should be nearly identical.

First, normalize casing, Unicode punctuation, whitespace, and OCR formatting while preserving numbers, operators, negation, choice order, and other meaning-bearing text. Hash section, question type, passage, prompt, and ordered choices to identify exact content duplicates in constant time. Exclude the answer key from the content hash and compare it separately so identical content with different keys produces a high-severity contradiction instead of two unrelated fingerprints.

Second, retrieve near-exact candidates with indexed trigram similarity and compare complete word/token sequences. Candidate rules must be strict enough to catch punctuation, whitespace, or small OCR differences without grouping merely similar SAT questions. Use PostgreSQL's [`pg_trgm`](https://www.postgresql.org/docs/current/pgtrgm.html) when the corpus size justifies database candidate search; retain deterministic hashing as the first and cheapest stage. Vector embeddings are unnecessary for this duplicate definition.

The review UI groups occurrences, shows field-level differences, source test/page references, and any answer-key disagreement. Humans decide whether to link, keep separate, or mark a false match. The system never deletes a question automatically. Evaluation reports exact-duplicate recall, near-duplicate precision/recall, conflicting-key recall, candidate volume per question, query latency, and reviewer acceptance rate on a held-out labeled set.
