import assert from "node:assert/strict";
import { createClient } from "npm:@supabase/supabase-js@2";
import { HttpError } from "./auth.ts";
import { loadSharedReviewAnnotations } from "./sharedReviewAnnotations.ts";

const attemptId = "11111111-1111-4111-8111-111111111111";
const student = "student-a";
const attempt = { id: attemptId, test_id: "test-a", assignment_id: "assignment-a" };

function fixture(onQuery: (table: string, search: URLSearchParams) => unknown[]) {
  return createClient("https://fixture.invalid", "fixture-key", {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { fetch: (input) => {
      const url = new URL(String(input));
      return Promise.resolve(Response.json(onQuery(url.pathname.split("/").at(-1) ?? "", url.searchParams)));
    } },
  });
}

Deno.test("shared annotated reviews require a graded attempt owned by the requester", async () => {
  const svc = fixture((table, search) => {
    assert.equal(table, "attempts");
    assert.equal(search.get("id"), `eq.${attemptId}`);
    assert.equal(search.get("student_id"), "eq.other-student");
    assert.equal(search.get("status"), "eq.graded");
    return [];
  });
  await assert.rejects(() => loadSharedReviewAnnotations(svc, "other-student", attemptId),
    (error) => error instanceof HttpError && error.status === 404);
});

Deno.test("shared annotated reviews are limited to the attempt's scopes and questions", async () => {
  const batchScope = "admin-practice-assignments/practice-a";
  const studentScope = `admin-students/${student}/attempts/${attemptId}`;
  const fullScope = `admin-tests/assignment-batches/full-a/attempts/${attemptId}`;
  const review = { question_id: "question-a", content_hash: "hash", document: { notes: "Feedback" } };
  const savedAt = "2026-11-17T10:00:00Z";
  const unchanged = { updated_at: "2026-11-16T10:00:00Z", passage: null, choices: [] };
  const legacyReview = { ...review, updated_at: savedAt, shared_at: null, question: unchanged };
  const svc = fixture((table, search) => {
    switch (table) {
      case "attempts": return [attempt];
      case "test_assignments":
        assert.equal(search.get("id"), "eq.assignment-a");
        assert.equal(search.get("test_id"), "eq.test-a");
        assert.equal(search.get("student_id"), `eq.${student}`);
        return [{ assignment_batch_id: "full-a" }];
      case "practice_assignment_batches":
        assert.equal(search.get("snapshot_test_id"), "eq.test-a");
        return [{ id: "practice-a" }];
      case "attempt_modules":
        assert.equal(search.get("attempt_id"), `eq.${attemptId}`);
        return [{ module_id: "module-a" }];
      case "test_module_questions":
        assert.equal(search.get("module_id"), "in.(module-a)");
        return [{ question_id: "question-a" }];
      case "admin_review_annotations":
        assert.equal(search.get("question_id"), "in.(question-a)");
        assert.equal(search.get("shared_at"), null, "Saved annotations are visible regardless of the old sharing flag");
        assert.equal(search.get("order"), "updated_at.desc,owner_id.asc");
        assert.equal(search.get("scope"), `in.(${studentScope},${fullScope},${batchScope}/attempts/${attemptId},${batchScope})`);
        return [
          { ...legacyReview, scope: studentScope, shared_at: savedAt },
          { ...legacyReview, scope: batchScope },
          { ...legacyReview, scope: batchScope, question: { ...unchanged, choices: [{ updated_at: "2026-11-18T10:00:00Z" }] } },
        ];
      default: throw new Error(`Unexpected query for ${table}`);
    }
  });
  assert.deepEqual(await loadSharedReviewAnnotations(svc, student, attemptId), [
    { ...review, assignment_wide: false, legacy_content_unchanged: false },
    { ...review, assignment_wide: true, legacy_content_unchanged: true },
    { ...review, assignment_wide: true, legacy_content_unchanged: false },
  ]);
});
