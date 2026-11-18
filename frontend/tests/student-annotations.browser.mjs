import assert from "node:assert/strict";
import { mkdir, readFile } from "node:fs/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import { annotationFingerprint } from "../src/lib/reviewAnnotations.ts";

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE_PATH ? pathToFileURL(process.env.PLAYWRIGHT_MODULE_PATH).href : "playwright");
const browser = await chromium.launch({ headless: true, channel: process.env.PLAYWRIGHT_CHANNEL });
const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
const page = await context.newPage();
const staticBuild = process.env.TEST_STATIC_BUILD === "1";
const base = staticBuild ? "https://sat-test.invalid" : process.env.TEST_BASE_URL ?? "http://127.0.0.1:5173";
async function serveBuild(tab) {
  if (!staticBuild) return;
  const contentTypes = { ".js": "text/javascript", ".css": "text/css", ".woff2": "font/woff2", ".svg": "image/svg+xml" };
  await tab.route(`${base}/**`, route => {
    const { pathname } = new URL(route.request().url());
    const asset = /^\/assets\/[\w.-]+$/.test(pathname);
    const path = new URL(asset ? `../dist${pathname}` : "../dist/index.html", import.meta.url);
    return route.fulfill({ path: fileURLToPath(path), contentType: asset ? contentTypes[pathname.slice(pathname.lastIndexOf("."))] : "text/html" });
  });
}
await serveBuild(page);
const attempt = { id: "11111111-1111-4111-8111-111111111111", status: "graded", test: { title: "Algebra practice", kind: "practice" } };
const user = { id: "22222222-2222-4222-8222-222222222222", email: "student@example.invalid", aud: "authenticated", role: "authenticated", user_metadata: {}, app_metadata: {} };
const expiresAt = Math.floor(Date.now() / 1000) + 3600;
const part = data => Buffer.from(JSON.stringify(data)).toString("base64url");
const token = `${part({ alg: "HS256" })}.${part({ sub: user.id, exp: expiresAt })}.fixture`;
await page.addInitScript(({ user, token, expiresAt }) => localStorage.setItem("sb-wgkggknyndgaoyazdhdf-auth-token", JSON.stringify({
  user, access_token: token, refresh_token: "fixture", expires_at: expiresAt, expires_in: 3600, token_type: "bearer",
})), { user, token, expiresAt });

const imageUrl = "https://wgkggknyndgaoyazdhdf.supabase.co/storage/v1/object/sign/question-assets/fixture.png?token=fixture";
const question = (number, fields) => ({ question_id: `q${number}`, question_number: number, section_type: "math", prompt: "Solve for $x^2$.",
  choices: [], correct_answer: "4", your_answer: "2", is_correct: false, ...fields });
const questions = [question(1, { stimulus_image_url: imageUrl }), question(2, {
  visual_format: "html", visual_code: "<table><tr><td>Offline visual</td></tr></table>",
}), question(3, {})];
const document = notes => ({ version: 1, theme: "white", height: 1000, notes,
  strokes: [{ points: [[30, 550], [120, 600]], color: "#c43d4b", width: 3, opacity: 1 }],
  comments: [{ id: "fixture", x: 420, y: 540, text: "Check this step", highlights: [{ x: 110, y: 200, width: 90, height: 18 }] }],
});
async function row(question, notes, assignmentWide = false) {
  return { question_id: question.question_id, document: document(notes), assignment_wide: assignmentWide,
    content_hash: await annotationFingerprint(assignmentWide ? { ...question, your_answer: undefined } : question) };
}
const legacyBoard = { ...await row(questions[1], "Class review", true), content_hash: "1".repeat(64), legacy_content_unchanged: true };
let reviews = [await row(questions[0], "Lower-priority class review", true), await row(questions[0], "Your equation review"), legacyBoard,
  { ...await row(questions[1], "Old content"), content_hash: "0".repeat(64) }];
await context.route("https://fonts.googleapis.com/**", route => route.abort());
await page.route("**/*.supabase.co/**", route => {
  const url = new URL(route.request().url());
  assert.equal(url.hostname, "wgkggknyndgaoyazdhdf.supabase.co");
  const json = body => route.fulfill({ json: body });
  if (url.pathname === "/auth/v1/user") return json(user);
  if (url.pathname === "/rest/v1/profiles") return json([{ id: user.id, role: "student", full_name: "Test student" }]);
  if (url.pathname === "/rest/v1/student_profiles") return json([{ profile_status: "approved" }]);
  if (url.pathname.endsWith("/student-tests")) return json({ tests: [{ id: "practice-1", ...attempt.test, questions: questions.length, attempt }] });
  if (url.pathname.endsWith("/student-scores")) return json({ history: [attempt] });
  if (url.pathname.endsWith(`/student-scores/${attempt.id}`)) return json({ attempt, review: questions });
  if (url.pathname.endsWith(`/student-scores/${attempt.id}/annotations`)) return json({ annotations: reviews });
  if (url.href === imageUrl) return route.fulfill({ contentType: "image/png", body: Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aHj0AAAAASUVORK5CYII=", "base64") });
  throw new Error(`Unexpected fixture request ${url.pathname}`);
});

const target = `${base}/student/scores/${attempt.id}`;
const artifacts = new URL("../../tmp/student-annotation-review/", import.meta.url);
await mkdir(artifacts, { recursive: true });
try {
  await page.goto(`${base}/student/practice`);
  await page.getByRole("button", { name: "Review practice" }).click();
  await page.waitForURL(target);
  const reviewTab = page.getByRole("tab", { name: "Answer Review" });
  const summaryTab = page.getByRole("tab", { name: "Score summary" });
  await page.getByRole("heading", { name: "Annotated reviews" }).waitFor();
  assert.equal(await reviewTab.getAttribute("aria-selected"), "true");
  assert.equal(await page.getByText("Correct answers", { exact: true }).isVisible(), false);
  await reviewTab.focus();
  await page.keyboard.press("ArrowRight");
  await page.getByText("Correct answers", { exact: true }).waitFor();
  assert.equal(await summaryTab.getAttribute("aria-selected"), "true");
  assert.equal(await page.getByRole("heading", { name: "Annotated reviews" }).isVisible(), false);
  await page.keyboard.press("Home");
  await page.getByRole("heading", { name: "Annotated reviews" }).waitFor();
  assert.equal(await reviewTab.getAttribute("aria-selected"), "true");
  await page.getByRole("button", { name: "← Practice" }).waitFor();

  const view = page.getByRole("button", { name: "View annotated reviews (2)" });
  await view.waitFor();
  assert.ok(await view.evaluate(button => button.getBoundingClientRect().bottom <= innerHeight));
  await view.click();
  const viewer = page.getByRole("dialog", { name: "Annotated reviews" });
  await viewer.getByText("Your equation review", { exact: true }).waitFor();
  await viewer.getByText("Class review", { exact: true }).waitFor();
  assert.equal(await viewer.getByText("Old content", { exact: true }).count(), 0);
  assert.equal(await viewer.getByText("Lower-priority class review", { exact: true }).count(), 0);
  assert.equal(await viewer.getByRole("textbox").count(), 0);
  await viewer.getByRole("button", { name: "Actual size" }).waitFor();
  assert.ok(await viewer.locator(".annotation-sheet").first().evaluate(el => el.getBoundingClientRect().width <= innerWidth));
  await page.screenshot({ path: fileURLToPath(new URL("mobile-view.png", artifacts)) });
  await page.keyboard.press("Escape");
  await viewer.waitFor({ state: "hidden" });
  assert.equal(await view.evaluate(el => el === document.activeElement), true);

  const [download] = await Promise.all([page.waitForEvent("download", { timeout: 15000 }), page.getByRole("button", { name: "Download reviews" }).click()]);
  assert.equal(download.suggestedFilename(), "Algebra-practice-annotated-reviews.html");
  const saved = new URL(download.suggestedFilename(), artifacts);
  await download.saveAs(fileURLToPath(saved));
  const html = await readFile(saved, "utf8");
  assert.ok(!html.includes(imageUrl), "The downloaded copy does not retain the signed asset URL");
  assert.match(html, /data:font\/woff2;base64,/);
  assert.match(html, /data:image\/png;base64,/);
  const offline = await context.newPage();
  await offline.route("http*/**", route => route.abort());
  await offline.goto(saved.href);
  await offline.getByText("Your equation review", { exact: true }).waitFor();
  await offline.frameLocator("iframe").getByText("Offline visual").waitFor();
  assert.equal(await offline.locator(".annotation-ink rect").count(), 2);
  assert.ok(await offline.locator("img").first().evaluate(img => img.complete && img.naturalWidth > 0));
  await offline.close();

  // Exercise the admin save endpoint while the student's review remains open.
  const adminContext = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  await adminContext.route("https://fonts.googleapis.com/**", route => route.abort());
  const admin = await adminContext.newPage();
  await serveBuild(admin);
  const adminUser = { ...user, id: "33333333-3333-4333-8333-333333333333" };
  const adminToken = `${part({ alg: "HS256" })}.${part({ sub: adminUser.id, exp: expiresAt })}.fixture`;
  await admin.addInitScript(({ adminUser, adminToken, expiresAt }) => localStorage.setItem("sb-wgkggknyndgaoyazdhdf-auth-token", JSON.stringify({
    user: adminUser, access_token: adminToken, refresh_token: "fixture", expires_at: expiresAt, expires_in: 3600, token_type: "bearer",
  })), { adminUser, adminToken, expiresAt });
  const scope = "admin-practice-assignments/practice-1";
  const savedAt = "2026-11-17T10:00:00Z";
  const priorBoard = { ...legacyBoard, shared_at: null, updated_at: savedAt,
    question: { updated_at: "2026-11-16T10:00:00Z", passage: null, choices: [] } };
  const writes = [];
  await admin.route("**/*.supabase.co/**", route => {
    const request = route.request();
    const url = new URL(request.url());
    assert.equal(url.hostname, "wgkggknyndgaoyazdhdf.supabase.co");
    const json = body => route.fulfill({ json: body });
    if (url.pathname === "/auth/v1/user") return json(adminUser);
    if (url.pathname === "/rest/v1/profiles") return json([{ id: adminUser.id, role: "admin", full_name: "Test admin" }]);
    if (url.pathname.endsWith(`/${scope}`)) {
      return json({ batch: { id: "practice-1", title: attempt.test.title, timer_minutes: 15 }, students: [],
        questions: questions.map(({ your_answer, ...q }) => ({ ...q, question_type: "student_produced", typed_answers: [], completed_count: 1 })) });
    }
    if (url.pathname === "/rest/v1/admin_review_annotations") {
      if (request.method() === "GET") return json([priorBoard]);
      const values = request.postDataJSON();
      const questionId = values.question_id ?? url.searchParams.get("question_id")?.slice(3);
      assert.ok(values.shared_at);
      assert.equal(values.updated_at, values.shared_at);
      assert.equal(values.scope ?? url.searchParams.get("scope")?.slice(3), scope);
      writes.push(request.method());
      const saved = { question_id: questionId, content_hash: values.content_hash, document: values.document };
      reviews = reviews.filter(item => item.question_id !== questionId || !item.assignment_wide);
      reviews.push({ ...saved, assignment_wide: true });
      return json({ ...saved, shared_at: values.shared_at });
    }
    if (url.href === imageUrl) return route.fulfill({ status: 404 });
    throw new Error(`Unexpected admin fixture request ${url.pathname}`);
  });
  await admin.goto(`${base}/admin/assignments/practice/practice-1`);
  await admin.getByRole("button", { name: "All Questions (3)" }).click();
  await admin.getByRole("button", { name: "Edit annotation" }).click();
  await admin.getByRole("button", { name: "Review notes", exact: true }).click();
  assert.equal(await admin.getByRole("textbox", { name: "Review notes" }).inputValue(), "Class review");
  await admin.getByRole("textbox", { name: "Review notes" }).fill("Updated class review");
  await admin.getByRole("button", { name: "Save annotation" }).click();
  await admin.getByRole("button", { name: "Save annotation" }).waitFor({ state: "hidden" });

  await view.click();
  await viewer.getByText("Updated class review", { exact: true }).waitFor({ timeout: 20000 });
  assert.equal(await viewer.getByText("Class review", { exact: true }).count(), 0);

  const thirdQuestion = admin.locator(".card").filter({ has: admin.getByText("Q3", { exact: true }) });
  await thirdQuestion.getByRole("button", { name: "Annotate", exact: true }).click();
  await admin.getByRole("button", { name: "Review notes", exact: true }).click();
  await admin.getByRole("textbox", { name: "Review notes" }).fill("Newly saved review");
  await admin.getByRole("button", { name: "Save annotation" }).click();
  await viewer.getByText("Newly saved review", { exact: true }).waitFor({ timeout: 20000 });
  assert.deepEqual(writes, ["PATCH", "POST"]);
  await adminContext.close();

  reviews = [];
  await page.goto(`${base}/student/results`);
  await page.getByRole("link", { name: "Review practice" }).click();
  await page.waitForURL(target);
  await page.getByRole("status").filter({ hasText: "No annotated reviews are available for this attempt yet." }).waitFor();
  assert.equal(await page.getByRole("button", { name: /View annotated reviews|Download reviews/ }).count(), 0);
  console.log("PASS: completed practice opens Answer Review, legacy reviews are visible, and teacher saves and edits reach the open student viewer automatically.");
} finally {
  await browser.close();
}
