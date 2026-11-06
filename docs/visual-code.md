# Visuals as code

Convert existing draft visuals with **GPT-6.1 Terra, medium reasoning** in Codex. Inspect the actual source and match it to the question prompt. Keep graph axes, bin boundaries, labels, units, all table cells, diagram markings and hidden edges. Never fabricate a missing figure. Use standalone SVG for figures and semantic HTML for tables. External resources, scripts and embedded raster images are prohibited.

The production application reads `visual_code` and `visual_format` on drafts and questions. Converted drafts stay marked as visual, require no crop or review step, and publish with their code. Image/source/crop references are removed only after conversion succeeds. Unconverted questions retain their existing image display during migration.

Codex's model quota is used by the conversion agent. This is not an unattended OpenAI API integration: the ingestion worker cannot directly invoke the Codex collaboration model. Future conversions use the same Codex agent workflow, with validated output applied by the batch importer. No API key is substituted for the selected model.

The initial batch is frozen in `tmp/visual-code-500/selection.json`, ordered by draft creation time then ID. `ready.json` records exact source hashes, and conversion results are saved per draft ID. The production-only batch command runs from `backend/worker`: `npx tsx scripts/apply-visual-code-batch.ts` previews changes; adding `--apply` saves them. It backs up changed records, rejects changed/published sources, validates markup safety, and verifies saved code. Invalid or mismatched input is reported instead of replacing a question with an unrelated graphic.
