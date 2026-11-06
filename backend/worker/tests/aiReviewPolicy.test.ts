import { describe, expect, it } from "vitest";
import { canonicalSnapshot, draftRisks, hasMajorRisk, hasMinorRisk, importRisks, stateForRisks } from "../src/aiReviewPolicy";

const clean = { id: "d1", page_number: 1, prompt: "A complete SAT question?", question_type: "multiple_choice", suggested_answer: "A", source_question_number: 1, source_module_name: "Reading and Writing Module 1", choices: [{ text: "a" }, { text: "b" }, { text: "c" }, { text: "d" }], parser_metadata: {} };

describe("three-state ingestion policy", () => {
  it("marks risk-free questions complete", () => { const risks = draftRisks(clean); expect(risks).toEqual([]); expect(stateForRisks(risks)).toBe("complete"); });
  it("routes missing answers directly to humans", () => { const risks = draftRisks({ ...clean, suggested_answer: null }); expect(hasMajorRisk(risks)).toBe(true); expect(hasMinorRisk(risks)).toBe(false); });
  it("routes repairable parser and crop issues to AI", () => { const risks = draftRisks({ ...clean, has_visual_stimulus: true, stimulus_source_image_path: "source.png", stimulus_crop_status: "pending", parser_metadata: { parse_flags: ["recovered_from_page_replay"] } }); expect(hasMinorRisk(risks)).toBe(true); expect(hasMajorRisk(risks)).toBe(false); });
  it("does not require a crop or source image for converted visuals", () => { expect(draftRisks({ ...clean, has_visual_stimulus: true, visual_code: "<svg/>", stimulus_source_image_path: null, stimulus_crop_status: null })).toEqual([]); });
  it("sends unknown parser flags to humans", () => { expect(hasMajorRisk(draftRisks({ ...clean, parser_metadata: { parse_flags: ["future_flag"] } }))).toBe(true); });
  it("maps every known parser flag explicitly", () => {
    const major = ["duplicate_source_number_conflict", "source_question_id_unresolved", "screenshot_section_unresolved", "source_global_id_ocr_unresolved", "number_inference_after_duplicate"];
    const minor = ["question_id_recovered_from_neighbors", "source_choice_table_truncated_review_required", "recovered_from_page_replay", "recovered_from_global_marker_block", "source_global_id_positional_slot", "positional_answer_review_required", "repeated_source_question_coalesced", "legacy_parser_unverified"];
    for (const flag of major) expect(draftRisks({ ...clean, parser_metadata: { parse_flags: [flag] } })).toContainEqual(expect.objectContaining({ code: `parser:${flag}`, severity: "major" }));
    for (const flag of minor) expect(draftRisks({ ...clean, parser_metadata: { parse_flags: [flag] } })).toContainEqual(expect.objectContaining({ code: `parser:${flag}`, severity: "minor" }));
  });
  it("fails malformed full tests but exempts question banks", () => { expect(importRisks({ status: "completed", textQuality: { document_family: "full_test" }, drafts: [clean] }).major.map((risk) => risk.code)).toContain("full_test_question_count"); expect(importRisks({ status: "completed", textQuality: { document_family: "question_bank", answer_key_status: "complete" }, drafts: [clean] }).major).toEqual([]); });
  it("passes an exact full-test structure", () => {
    const specs = [["Reading and Writing Module 1", "reading_writing", 1, 27], ["Reading and Writing Module 2", "reading_writing", 2, 27], ["Math Module 1", "math", 1, 22], ["Math Module 2", "math", 2, 22]] as const;
    const drafts = specs.flatMap(([module, section, position, count]) => Array.from({ length: count }, (_, index) => ({ ...clean, id: `${module}-${index}`, section, source_module_name: module, source_module_position: position, source_question_number: index + 1 })));
    expect(importRisks({ status: "completed", textQuality: { document_family: "full_test", answer_key_status: "complete" }, drafts }).major).toEqual([]);
  });
  it("keeps answer-key problems as import warnings", () => { const result = importRisks({ status: "completed", textQuality: { document_family: "question_bank", answer_key_status: "missing" }, drafts: [clean] }); expect(result.major).toEqual([]); expect(result.warnings.map((risk) => risk.code)).toContain("answer_key_warning"); });
  it("hashes snapshots independent of object key order", () => { expect(canonicalSnapshot({ a: 1, b: { c: 2 } })).toBe(canonicalSnapshot({ b: { c: 2 }, a: 1 })); });
});
