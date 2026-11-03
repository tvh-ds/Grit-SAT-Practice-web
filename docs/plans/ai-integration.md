# Three High-Yield AI Engineering Features

## Summary

Build one cohesive AI system rather than three disconnected demos. The shared foundation will include a provider-neutral model gateway, prompt/model versioning, structured outputs, token/cost/latency tracing, offline evaluation datasets, and safe fallbacks.

Recommended implementation order:

1. AI Content Intelligence Copilot
2. Adaptive Mastery and Assignment Engine
3. Evidence-Grounded SAT Tutor

This order improves the question corpus first, then models student ability, then exposes a student-facing generative feature grounded in both.

## 1. AI Content Intelligence Copilot

Extend the existing Cohere OCR pipeline into a multimodal, human-reviewed content-quality system.

- Generate structured suggestions for SAT domain, skill, difficulty, explanation quality, OCR corruption, visual-stimulus problems, and answer-key inconsistencies.
- Add pgvector embeddings for approved questions and reviewable drafts to find semantic duplicates and related questions beyond the existing lexical fingerprinting.
- Display suggestions, confidence, evidence, and nearest matches in the import editor.
- Require explicit admin acceptance for every proposed change; never let the model publish questions or answer keys.
- Store model, prompt version, confidence, latency, token usage, estimated cost, and the administrator's decision for every suggestion.
- Run jobs asynchronously in the existing worker with idempotent job claims, retry limits, and deterministic failure states.

### Public interfaces

- `POST /admin-ai-review/imports/{importId}` starts or reruns analysis.
- `GET /admin-ai-review/imports/{importId}` returns job state and suggestions.
- `POST /admin-ai-review/suggestions/{id}/decision` accepts or rejects one suggestion.
- New typed outputs: `ContentSuggestion`, `DuplicateMatch`, `AIReviewJob`, and `ModelRun`.

### Evaluation and acceptance

- Create a manually labeled golden set of at least 200 questions.
- Target at least 85% macro-F1 for taxonomy labels and at least 90% precision for top-5 duplicate flags.
- Measure median review time against the current workflow; target a 30% reduction.
- Test malformed model output, retries, duplicate jobs, embedding-version mismatches, and protection against automatic publication.

### Resume signal

Multimodal document intelligence, embeddings, vector search, structured LLM output, asynchronous inference, evaluation, observability, and human-in-the-loop safety.

## 2. Interpretable Mastery and Adaptive Assignment Engine

Replace cumulative accuracy as the recommendation signal with a measurable learner model.

- Maintain per-student, per-skill ability, uncertainty, evidence count, recent accuracy, and response-time statistics.
- Apply an online IRT/Elo-style update after each graded response using correctness and question difficulty; down-weight abnormally fast guesses and timed-out responses.
- For cold starts, initialize from a neutral prior and prefer medium-difficulty questions until sufficient evidence exists.
- Generate admin-controlled practice assignments by ranking active questions using weakness, uncertainty, difficulty match, recency, and exposure penalties.
- Enforce constraints: no duplicate questions in a set, avoid recently completed questions, maintain requested skill coverage, and degrade gracefully when the bank lacks enough eligible items.
- Materialize the result using the existing immutable practice-snapshot system so the student test runtime does not need a parallel execution path.
- Show administrators why every question was selected and the expected skill coverage.

### Public interfaces

- `GET /admin-mastery/students/{studentId}` returns skill estimates and evidence.
- `POST /admin-adaptive-assignments/preview` returns a deterministic recommendation with explanations.
- `POST /admin-adaptive-assignments` freezes the preview into the existing assignment workflow.
- New types: `SkillMastery`, `AdaptiveCandidate`, `RecommendationReason`, and `MasteryModelVersion`.

### Evaluation and acceptance

- Replay historical attempts chronologically and compare against the current accuracy-only baseline.
- Target at least a 10% relative improvement in Brier score or log loss for predicting the next response.
- Report calibration by probability bucket, cold-start performance, coverage, repeat rate, and question-bank exhaustion.
- Unit-test mastery updates and deterministic ranking; E2E-test preview, assignment, completion, and subsequent mastery changes.

### Resume signal

Applied ML, online learning, IRT-style modeling, calibration, offline replay evaluation, explainable recommendations, and production integration.

## 3. Evidence-Grounded SAT Tutor

Add a context-aware tutor that behaves differently during practice and after grading.

- During active practice, provide progressive Socratic hints without receiving the correct answer or explanation in its prompt.
- Disable tutoring during full-length test attempts.
- After grading and explanation release, provide worked explanations, diagnose likely misconceptions, and recommend related reviewed questions.
- Retrieve only from approved questions, passages, explanations, and curated concept notes using hybrid metadata filtering plus vector similarity.
- Return source identifiers with every factual or instructional claim; if retrieval is weak, fall back to the stored explanation or state that evidence is insufficient.
- Stream responses through an authenticated Edge Function with ownership checks, rate limits, moderation, maximum context size, and per-student usage caps.
- Save conversations, retrieved sources, feedback, model version, prompt version, latency, tokens, and estimated cost.
- Add thumbs-up/down and “report answer leak” controls that feed the evaluation dataset.

### Public interfaces

- `POST /student-tutor/threads` creates a question-scoped thread after validating attempt state.
- `POST /student-tutor/threads/{id}/messages` streams a hint or explanation.
- `GET /student-tutor/threads/{id}` returns the student's own conversation and citations.
- New types: `TutorMode`, `TutorCitation`, `TutorMessage`, `RetrievalResult`, and `SafetyDecision`.

### Evaluation and acceptance

- Build at least 150 groundedness/helpfulness cases and 200 adversarial answer-leak prompts.
- Target at least 90% Recall@5 for retrieval, at least 95% valid citation coverage, and zero direct answer disclosures in the adversarial practice-mode set.
- Track p50/p95 latency, cost per conversation, fallback rate, citation validity, student feedback, and safety violations.
- Test ownership isolation, unreleased explanations, prompt injection in imported content, weak retrieval, provider outages, and rate limiting.

### Resume signal

Production RAG, hybrid retrieval, prompt-injection defenses, streaming inference, safety evaluation, observability, and user-feedback loops.

## Shared Implementation and Rollout

- Add a provider-neutral `AIProvider` abstraction with `generateStructured`, `streamText`, and `embed` operations; begin with one configured provider while keeping product code provider-independent.
- Keep AI operational tables in a private schema where possible. Enable RLS on every exposed table and index ownership, foreign keys, job status, and vector-search paths.
- Use Zod/JSON-schema validation for every model response; retry once with a repair prompt, then fail safely.
- Add a reusable model-run ledger containing feature, provider, model, prompt version, status, latency, tokens, cost, and error category.
- Ship each feature behind an independent feature flag and seed demo data so every feature can be shown without relying on live student traffic.
- Add an evaluation command that produces a versioned JSON report suitable for the README and resume metrics.

## Assumptions

- Portfolio-quality MVPs are the target, with roughly 1–2 focused weeks per feature.
- Administrators—not students—initiate adaptive assignments.
- AI-generated content changes always require human approval.
- The tutor is available as hints during practice and as a full explanation assistant after grading, but never during full-length exams.
- Performance numbers will be reported only after running the included evaluation suites; the targets above are acceptance goals, not preclaimed results.
