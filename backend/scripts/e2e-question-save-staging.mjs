// Exercises real answer persistence using disposable fixtures in staging only.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

const ref = "wgkggknyndgaoyazdhdf";
assert.ok(process.argv.includes(`--project-ref=${ref}`), "Explicit staging reference required");
const env = path => Object.fromEntries(readFileSync(new URL(path, import.meta.url), "utf8").split(/\r?\n/).flatMap(line => {
  const match = line.match(/^([A-Z_]+)=(.*)$/);
  return match ? [[match[1], match[2].trim().replace(/^['"]|['"]$/g, "")]] : [];
}));
const frontend = env("../../frontend/.env.local"), worker = env("../worker/.env"), accounts = env(".env");
for (const url of [frontend.VITE_SUPABASE_URL, worker.SUPABASE_URL]) assert.equal(new URL(url).hostname, `${ref}.supabase.co`);
const options = { auth: { persistSession: false, autoRefreshToken: false } };
const service = createClient(worker.SUPABASE_URL, worker.SUPABASE_SERVICE_ROLE_KEY, options);
const admin = createClient(worker.SUPABASE_URL, frontend.VITE_SUPABASE_ANON_KEY, options);
const must = result => { assert.equal(result.error, null, result.error?.message); return result.data; };
const prefix = `question-save-${crypto.randomUUID()}`;
const questionIds = [];
let testId;
try {
  console.log(`Verified staging target: ${ref}`);
  const session = must(await admin.auth.signInWithPassword({ email: accounts.APP_ADMIN_EMAIL, password: accounts.APP_ADMIN_PASSWORD })).session;
  const insert = async (table, row) => must(await service.from(table).insert(row).select().single());
  const question = async (type, answer) => {
    const row = await insert("questions", { prompt: prefix, section: "math", question_type: type, difficulty: 3, correct_answer: answer, status: "archived", created_by: session.user.id });
    questionIds.push(row.id);
    return row;
  };
  const read = async id => must(await service.from("questions").select("*, choices:question_choices(*)").eq("id", id).single());
  const call = async (path, body, status = 200) => {
    const response = await fetch(`${worker.SUPABASE_URL}/functions/v1/${path}`, {
      method: path.startsWith("admin-questions/") ? "PATCH" : "POST",
      headers: { apikey: frontend.VITE_SUPABASE_ANON_KEY, Authorization: `Bearer ${session.access_token}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await response.json();
    assert.equal(response.status, status, JSON.stringify(data));
    return data;
  };

  const spr = await question("student_produced", "12");
  await call(`admin-questions/${spr.id}`, { prompt: `${prefix} revised`, correct_answer: "3/5", choices: [] });
  assert.equal((await read(spr.id)).correct_answer, "3/5");
  assert.equal((await read(spr.id)).prompt, `${prefix} revised`);
  console.log("PASS student-produced answer and prompt save with empty choices");

  const mc = await question("multiple_choice", "A");
  const choices = ["A", "B", "C", "D"].map((label, index) => ({ label, text: String(index + 1), position: index + 1, is_correct: label === "A" }));
  must(await service.from("question_choices").insert(choices.map(choice => ({ ...choice, question_id: mc.id }))));
  const originalChoices = (await read(mc.id)).choices;
  const originalIds = originalChoices.map(choice => choice.id).sort();
  await call(`admin-questions/${mc.id}`, { correct_answer: " b ", choices });
  let saved = await read(mc.id);
  assert.equal(saved.correct_answer, "B");
  assert.deepEqual(saved.choices.filter(choice => choice.is_correct).map(choice => choice.label), ["B"]);
  assert.deepEqual(saved.choices.map(choice => choice.id).sort(), originalIds);
  await call(`admin-questions/${mc.id}`, { correct_answer: "C" });
  saved = await read(mc.id);
  assert.equal(saved.correct_answer, "C");
  assert.deepEqual(saved.choices.filter(choice => choice.is_correct).map(choice => choice.label), ["C"]);
  assert.deepEqual(saved.choices.map(choice => choice.id).sort(), originalIds);
  console.log("PASS choice and answer-only saves synchronize answer flags and retain choice IDs");

  await call(`admin-questions/${mc.id}`, { correct_answer: "Z", prompt: "Must not persist" }, 422);
  await call(`admin-questions/${mc.id}`, { correct_answer: "B", choices: [] }, 422);
  assert.equal((await read(mc.id)).correct_answer, "C");
  assert.equal((await read(mc.id)).prompt, prefix);
  console.log("PASS invalid edits leave the question unchanged");

  const test = await insert("tests", { title: prefix, kind: "full", status: "draft", created_by: session.user.id });
  testId = test.id;
  const section = await insert("test_sections", { test_id: testId, name: "Math", section_type: "math", position: 1 });
  const module = await insert("test_modules", { section_id: section.id, name: "Math Module 1", time_limit_minutes: 35, position: 1 });
  const link = await insert("test_module_questions", { module_id: module.id, question_id: mc.id, position: 1 });
  await call(`admin-tests/${testId}/questions/${link.id}/content`, {
    prompt: prefix, correct_answer: "D", choices: choices.map(({ label, text }) => ({ label, text })),
    passage_text: null, explanation: null, stimulus_image_path: null,
  });
  const updatedLink = must(await service.from("test_module_questions").select("question_id").eq("id", link.id).single());
  questionIds.push(updatedLink.question_id);
  saved = await read(updatedLink.question_id);
  assert.notEqual(updatedLink.question_id, mc.id);
  assert.equal(saved.correct_answer, "D");
  assert.deepEqual(saved.choices.filter(choice => choice.is_correct).map(choice => choice.label), ["D"]);
  assert.equal((await read(mc.id)).correct_answer, "C");
  console.log("PASS full-test answer persists in a separate copy and preserves the original question");

  const sprLink = await insert("test_module_questions", { module_id: module.id, question_id: spr.id, position: 2 });
  await call(`admin-tests/${testId}/questions/${sprLink.id}/content`, {
    prompt: `${prefix} revised`, correct_answer: "7/8", choices: [],
    passage_text: null, explanation: null, stimulus_image_path: null,
  });
  const updatedSprLink = must(await service.from("test_module_questions").select("question_id").eq("id", sprLink.id).single());
  questionIds.push(updatedSprLink.question_id);
  assert.equal((await read(updatedSprLink.question_id)).correct_answer, "7/8");
  assert.equal((await read(spr.id)).correct_answer, "3/5");

  // The editor closes and reloads through this endpoint. Verify that reopening
  // exposes the new answers rather than the original/shared question records.
  const reopened = await fetch(`${worker.SUPABASE_URL}/functions/v1/admin-tests/${testId}`, {
    headers: { apikey: frontend.VITE_SUPABASE_ANON_KEY, Authorization: `Bearer ${session.access_token}` },
    cache: "no-store",
  });
  assert.equal(reopened.status, 200);
  const detail = await reopened.json();
  const reopenedLinks = detail.test.sections.flatMap(section => section.modules.flatMap(module => module.questions));
  assert.equal(reopenedLinks.find(item => item.id === link.id).question.correct_answer, "D");
  assert.equal(reopenedLinks.find(item => item.id === sprLink.id).question.correct_answer, "7/8");
  console.log("PASS admin test editor reload returns edited multiple-choice and student-produced answers");
} finally {
  // Include cloned questions even if a response was lost after committing.
  if (testId) {
    const sections = must(await service.from("test_sections").select("modules:test_modules(questions:test_module_questions(question_id))").eq("test_id", testId));
    for (const section of sections) for (const module of section.modules) for (const link of module.questions) questionIds.push(link.question_id);
    must(await service.from("tests").delete().eq("id", testId).eq("title", prefix));
  }
  if (questionIds.length) {
    must(await service.from("audit_logs").delete().in("entity_id", questionIds));
    must(await service.from("questions").delete().in("id", questionIds));
  }
  await admin.auth.signOut();
  console.log("Temporary staging fixtures removed.");
}
