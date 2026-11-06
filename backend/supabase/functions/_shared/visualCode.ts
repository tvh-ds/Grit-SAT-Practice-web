/** Minimal write-boundary checks; rendering must still use an isolated sandbox.
 * Null means accepted; a string explains the validation failure. The bulk
 * importer should additionally parse SVG as XML and check actual rendering. */
export function validateVisualCode(code: unknown, format: unknown): string | null {
  if (typeof code !== "string" || !code.trim() || code.length > 250_000) return "Visual code must contain at most 250,000 characters";
  if (format !== "svg" && format !== "html") return "Visual format must be svg or html";
  if (format === "svg" && !/^\s*(?:<\?xml[^>]*>\s*)?<svg\b/i.test(code)) return "SVG root is missing";
  if (format === "html" && !/<table\b/i.test(code)) return "HTML table is missing";
  if (/<\s*\/?\s*(?:script|iframe|object|embed|foreignObject|image|img|link|base|form|input|button|a|audio|video|animate|set)\b/i.test(code) || /<\s*meta\b[^>]*http-equiv/i.test(code)) return "Visual contains an unsafe element";
  if (/\b(?:on[a-z]+|href|xlink:href|src|srcset|action|formaction)\s*=/i.test(code)) return "Visual contains an unsafe attribute";
  if (/<!ENTITY|<!DOCTYPE\s+svg|@import|javascript\s*:|data\s*:/i.test(code)) return "Visual contains unsafe content";
  for (const match of code.matchAll(/url\s*\(\s*([^)]*)\)/gi)) {
    if (!/^['"]?#[A-Za-z_][\w.:-]*['"]?$/.test(match[1].trim())) return "Visual contains an external resource";
  }
  return null;
}
