/** Model output is untrusted. It renders only in an opaque-origin sandbox with
 * scripts, connections, fonts, images, navigation and form submission blocked.
 * Do not use dangerouslySetInnerHTML or enable sandbox permissions here. */
const allowed = new Set("svg g defs marker path rect circle ellipse line polyline polygon text tspan title desc clipPath mask linearGradient radialGradient stop pattern table caption thead tbody tfoot tr th td div span p br style b strong i em sup sub".toLowerCase().split(" "));
function cleanMarkup(input: string): string {
  const parsed = new DOMParser().parseFromString(input, "text/html");
  const clean = (node: Element) => {
    for (const child of Array.from(node.children)) {
      if (!allowed.has(child.localName.toLowerCase())) { child.remove(); continue; }
      for (const attr of Array.from(child.attributes)) {
        if (/^on/i.test(attr.name) || /^(href|xlink:href|src|srcset|action|formaction|http-equiv)$/i.test(attr.name)) child.removeAttribute(attr.name);
      }
      clean(child);
    }
  };
  clean(parsed.body);
  const styles = Array.from(parsed.head.querySelectorAll("style")).map(style => style.outerHTML).join("");
  return styles + parsed.body.innerHTML;
}
export default function VisualCode({ code, format }: { code?: string | null; format?: string | null }) {
  if (!code || (format !== "svg" && format !== "html")) return null;
  const policy = "default-src 'none'; style-src 'unsafe-inline'; img-src 'none'; font-src 'none'; connect-src 'none'; form-action 'none'; base-uri 'none'";
  const tableLayout = format === "html" ? "<style>html,body{overflow:auto!important}body{display:block!important;margin:0!important;padding:8px;box-sizing:border-box}table{margin-left:auto;margin-right:auto;max-width:100%}th,td{overflow-wrap:anywhere}</style>" : "";
  const document = `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${policy}"><style>html,body{margin:0;background:white}body{display:flex;justify-content:center;align-items:center;min-height:380px}svg{max-width:100%;max-height:440px;height:auto}table{max-width:100%}</style></head><body>${cleanMarkup(code)}${tableLayout}</body></html>`;
  return <iframe title="Question visual" sandbox="" referrerPolicy="no-referrer" srcDoc={document} style={{ display: "block", width: "100%", height: 460, maxWidth: 700, border: 0, pointerEvents: format === "html" ? "auto" : "none", background: "white" }} />;
}
