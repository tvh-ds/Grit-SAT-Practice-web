import boardStyles from "../styles/review-annotations.css?inline";
import mathStyles from "katex/dist/katex.min.css?inline";

async function inlineAsset(url: string) {
  if (url.startsWith("data:")) return url;
  const response = await fetch(url);
  if (!response.ok) throw new Error("Could not load a review asset.");
  const blob = await response.blob();
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

async function offlineMathStyles() {
  // KaTeX lists woff2, woff and ttf for each face. Embed the first format.
  const fontSources = /url\((['"]?)([^)'"\s]+)\1\)\s*format\(['"]woff2['"]\)[^;}]*/g;
  const inlineFonts = new Map(await Promise.all(Array.from(mathStyles.matchAll(fontSources), async ([source, , url]) =>
    [source, `url("${await inlineAsset(url)}") format("woff2")`] as const)));
  return mathStyles.replace(fontSources, source => inlineFonts.get(source) ?? source);
}

export async function downloadAnnotatedReviews(title: string, markup: string) {
  const file = document.implementation.createHTMLDocument(`${title} · Annotated reviews`);
  file.documentElement.lang = "en";
  const policy = file.createElement("meta");
  policy.httpEquiv = "Content-Security-Policy";
  policy.content = "default-src 'none'; style-src 'unsafe-inline'; img-src data:; font-src data:; frame-src about:; base-uri 'none'; form-action 'none'";
  const charset = file.createElement("meta");
  charset.setAttribute("charset", "utf-8");
  file.head.prepend(charset, policy);

  const contents = new DOMParser().parseFromString(markup, "text/html");
  const review = file.createElement("main");
  review.className = "annotation-export";
  review.append(...Array.from(contents.body.childNodes));
  file.body.append(review);

  const [, fonts] = await Promise.all([
    Promise.all(Array.from(review.querySelectorAll("img"), async image => {
      image.setAttribute("src", await inlineAsset(image.getAttribute("src") ?? ""));
    })),
    review.querySelector(".katex") ? offlineMathStyles() : "",
  ]);
  const css = file.createElement("style");
  css.textContent = `* { box-sizing: border-box; } body { margin: 0; font: 15px/1.5 Inter, system-ui, sans-serif; } ${boardStyles}\n${fonts}`;
  file.head.append(css);

  const blob = new Blob(["<!doctype html>\n", file.documentElement.outerHTML], { type: "text/html;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  const name = title.replace(/[^\p{L}\p{N}]+/gu, "-").replace(/^-+|-+$/g, "").slice(0, 100);
  link.download = `${name ? `${name}-` : ""}annotated-reviews.html`;
  document.body.append(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
