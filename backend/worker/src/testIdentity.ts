/** Conservative SAT source identity across compact filenames and editorial titles.
 * Asia/Int/International are aliases; US remains a separate administration. */
export interface TestIdentity { year: number; month: number; region?: "int" | "us"; variant?: number; section?: "math" | "rw"; }
export interface ExistingTestSource { id: string; kind: "test" | "import"; label: string; status: string; contentScope?: string; }
const MONTHS = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];
const normalized = (text: string) => text.normalize("NFKC").toLowerCase().replace(/\.pdf$/i, "").replace(/[^a-z0-9]+/g, " ").trim();

export function parseTestIdentity(label: string): TestIdentity | null {
  const text = normalized(label);
  const compact = text.match(/\b(20\d{2})\s*(0[1-9]|1[0-2])\s*(asia|international|int|usa|us)\s*(?:v(?:ersion)?\s*)?(\d{1,3})\b/);
  let year: number, month: number, region: TestIdentity["region"], variant: number | undefined;
  if (compact) {
    year = Number(compact[1]); month = Number(compact[2]); region = /^(us|usa)$/.test(compact[3]!) ? "us" : "int"; variant = Number(compact[4]);
  } else {
    const yearMatch = text.match(/\b(20\d{2})\b/);
    if (!yearMatch) return null;
    year = Number(yearMatch[1]);
    const monthIndex = MONTHS.findIndex(m => new RegExp(`\\b(?:${m}|${m.slice(0, 3)}${m === "september" ? "|sept" : ""})\\b`).test(text));
    const numericDate = text.match(/\b20\d{2}\s+(0?[1-9]|1[0-2])\b/);
    month = monthIndex >= 0 ? monthIndex + 1 : numericDate ? Number(numericDate[1]) : 0;
    if (!month) return null;
    region = /\b(?:us|usa|united states|domestic)\b/.test(text) ? "us" : /\b(?:int|international|asia|asian)\b/.test(text) ? "int" : undefined;
    const explicit = text.match(/\b(?:v|version|variant|test|form)\s*(\d{1,3})\b/);
    const numbers = text.replace(/\b20\d{2}\b/, "").replace(numericDate ? new RegExp(`^.*?\\b0?${month}\\b`) : /$^/, "").match(/\b\d{1,3}\b/g);
    if (explicit) variant = Number(explicit[1]);
    else if (numbers?.length === 1) variant = Number(numbers[0]);
  }
  if (variant === 0) variant = undefined;
  const section = /\bmath\b/.test(text) ? "math" : /\b(?:rw|r w|reading|writing)\b/.test(text) ? "rw" : undefined;
  return { year, month, region, variant, section };
}

export function findExistingTest(label: string, sources: ExistingTestSource[]): { decision: "new" | "duplicate" | "review"; matches: ExistingTestSource[] } {
  const incoming = parseTestIdentity(label);
  const matches: ExistingTestSource[] = [];
  let definite = false;
  for (const source of sources) {
    const existing = parseTestIdentity(source.label);
    const exact = normalized(label) === normalized(source.label);
    if (!exact) {
      if (!incoming || !existing || incoming.year !== existing.year || incoming.month !== existing.month) continue;
      if (incoming.region && existing.region && incoming.region !== existing.region) continue;
      if (incoming.variant && existing.variant && incoming.variant !== existing.variant) continue;
    }
    matches.push(source);
    const sameIdentity = incoming && existing && incoming.region && existing.region === incoming.region && incoming.variant && incoming.variant === existing.variant;
    const sameScope = (incoming?.section ?? "full") === (existing?.section ?? "full") && (!source.contentScope || source.contentScope === "full_test");
    if ((exact || sameIdentity) && sameScope && !["failed", "cancelled"].includes(source.status)) definite = true;
  }
  if (definite) return { decision: "duplicate", matches };
  if (matches.length || !incoming?.region || !incoming.variant) return { decision: "review", matches };
  return { decision: "new", matches: [] };
}
