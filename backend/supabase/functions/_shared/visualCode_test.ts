import { validateVisualCode } from "./visualCode.ts";
import { importApprovalWarnings } from "./importApproval.ts";

Deno.test("visual validation allows local chart definitions but blocks active and external content", () => {
  const svg = '<svg xmlns="http://www.w3.org/2000/svg"><defs><marker id="tip"/></defs><path marker-end="url(#tip)"/></svg>';
  if (validateVisualCode(svg, "svg") !== null) throw new Error("Safe SVG rejected");
  for (const bad of ['<svg><script>alert(1)</script></svg>', '<svg><image href="https://example.invalid/x"/></svg>', '<svg><rect style="fill:url(https://example.invalid/x)"/></svg>']) {
    if (validateVisualCode(bad, "svg") === null) throw new Error("Unsafe SVG accepted");
  }
  if (validateVisualCode('<html><head><meta charset="utf-8"></head><body><table><tr><td>1</td></tr></table></body></html>', 'html') !== null) throw new Error("Safe table rejected");
});

Deno.test("converted visual does not require crop or human review", () => {
  const warnings = importApprovalWarnings([{ review_state: "review", status: "needs_review", suggested_answer: "A", has_visual_stimulus: true, visual_code: "<svg/>", stimulus_crop_status: null, question_type: "multiple_choice", choices: [{}, {}, {}, {}] }], "passed", null);
  if (warnings.length) throw new Error(JSON.stringify(warnings));
});
