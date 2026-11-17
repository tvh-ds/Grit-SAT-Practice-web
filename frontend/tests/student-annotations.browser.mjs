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
if (staticBuild) {
  const contentTypes = { ".js": "text/javascript", ".css": "text/css", ".woff2": "font/woff2", ".svg": "image/svg+xml" };
  await page.route(`${base}/**`, route => {
    const { pathname } = new URL(route.request().url());
    const asset = /^\/assets\/[\w.-]+$/.test(pathname);
    const path = new URL(asset ? `../dist${pathname}` : "../dist/index.html", import.meta.url);
    return route.fulfill({ path: fileURLToPath(path), contentType: asset ? contentTypes[pathname.slice(pathname.lastIndexOf("."))] : "text/html" });
  });
}
const attempt = { id: "11111111-1111-4111-8111-111111111111", status: "graded", test: { title: "Algebra practice" } };
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
})];
const document = notes => ({ version: 1, theme: "white", height: 1000, notes,
  strokes: [{ points: [[30, 550], [120, 600]], color: "#c43d4b", width: 3, opacity: 1 }],
  comments: [{ id: "fixture", x: 420, y: 540, text: "Check this step", highlights: [{ x: 110, y: 200, width: 90, height: 18 }] }],
});
async function row(question, notes, assignmentWide = false) {
  return { question_id: question.question_id, document: document(notes), assignment_wide: assignmentWide,
    content_hash: await annotationFingerprint(assignmentWide ? { ...question, your_answer: undefined } : question) };
}
let reviews = [await row(questions[0], "Lower-priority class review", true), await row(questions[0], "Your equation review"), await row(questions[1], "Class review", true),
  { ...await row(questions[1], "Old content"), content_hash: "0".repeat(64) }];
await context.route("https://fonts.googleapis.com/**", route => route.abort());
await page.route("**/*.supabase.co/**", route => {
  const url = new URL(route.request().url());
  assert.equal(url.hostname, "wgkggknyndgaoyazdhdf.supabase.co");
  const json = body => route.fulfill({ json: body });
  if (url.pathname === "/auth/v1/user") return json(user);
  if (url.pathname === "/rest/v1/profiles") return json([{ id: user.id, role: "student", full_name: "Test student" }]);
  if (url.pathname === "/rest/v1/student_profiles") return json([{ profile_status: "approved" }]);
  if (url.pathname.endsWith(`/student-scores/${attempt.id}`)) return json({ attempt, review: questions });
  if (url.pathname.endsWith(`/student-scores/${attempt.id}/annotations`)) return json({ annotations: reviews });
  if (url.href === imageUrl) return route.fulfill({ contentType: "image/png", body: Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aHj0AAAAASUVORK5CYII=", "base64") });
  throw new Error(`Unexpected fixture request ${url.pathname}`);
});

const target = `${base}/student/scores/${attempt.id}`;
const artifacts = new URL("../../tmp/student-annotation-review/", import.meta.url);
await mkdir(artifacts, { recursive: true });
try {
  await page.goto(target);
  const view = page.getByRole("button", { name: "View annotated reviews (2)" });
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

  reviews = [];
  await Promise.all([page.waitForResponse(response => response.url().endsWith(`/student-scores/${attempt.id}/annotations`)), page.reload()]);
  await page.getByRole("heading", { name: "Answer Review" }).waitFor();
  assert.equal(await page.getByRole("button", { name: /View annotated reviews|Download reviews/ }).count(), 0);
  console.log("PASS: read-only mobile view, attempt and class matching, focus restoration, and an offline download with notes, marks, fonts, images and visuals.");
} finally {
  await browser.close();
}
