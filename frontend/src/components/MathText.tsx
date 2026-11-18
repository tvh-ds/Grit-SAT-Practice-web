import { useMemo, type ReactNode } from "react";
import katex from "katex";
import "katex/dist/katex.min.css";

interface Segment {
  math: string | null;
  text: string | null;
  display: boolean;
}

/**
 * True when a single-dollar span looks like math rather than currency.
 * "$12 to purchase oranges at $3" must stay text; "$6p + 30 = 150$",
 * "$(0, y)$", "$24y^2z^2$" render as math. Pure numbers ("$12", "$3.50")
 * are never math.
 */
function looksLikeMath(inner: string): boolean {
  const s = inner.trim();
  if (!s || s.length > 220) return false;
  // Pure numeric/currency content: "$12", "$3.50", "$42, 46".
  if (/^[\d\s,.$%°+\-*/]+$/.test(s)) return false;
  if (/[\\^_{}=]/.test(s)) return true;
  // Short symbolic spans with no prose words ("(0, y)", "w + l", "36x").
  if (s.length <= 40 && !/[a-z]{3,}/.test(s) && /[a-zA-Z(),]/.test(s)) return true;
  return false;
}

const TOKEN_RE = /\$\$([\s\S]+?)\$\$|\\\[([\s\S]+?)\\\]|\\\(([\s\S]+?)\\\)|\$([^$\n]+?)\$/g;

/** Split text into prose/math segments (display vs inline). */
export function splitMathSegments(text: string): Segment[] {
  const out: Segment[] = [];
  let last = 0;
  TOKEN_RE.lastIndex = 0;
  for (;;) {
    const m = TOKEN_RE.exec(text);
    if (!m) break;
    const idx = m.index;
    if (idx > last) out.push({ math: null, text: text.slice(last, idx), display: false });
    if (m[1] !== undefined) out.push({ math: m[1], text: null, display: true });
    else if (m[2] !== undefined) out.push({ math: m[2], text: null, display: true });
    else if (m[3] !== undefined) out.push({ math: m[3], text: null, display: false });
    else if (looksLikeMath(m[4] ?? "")) out.push({ math: m[4] ?? "", text: null, display: false });
    else out.push({ math: null, text: m[0], display: false });
    last = idx + m[0].length;
  }
  if (last < text.length) out.push({ math: null, text: text.slice(last), display: false });
  return out;
}

function renderMath(source: string, display: boolean): string {
  try {
    return katex.renderToString(source, { displayMode: display, throwOnError: false, strict: false, trust: false });
  } catch {
    return escapeHtml(source);
  }
}

function escapeHtml(source: string): string {
  return source.replace(/[&<>"']/g, (ch) => {
    switch (ch) {
      case "&":
        return "&amp;";
      case "<":
        return "&lt;";
      case ">":
        return "&gt;";
      case '"':
        return "&quot;";
      case "'":
        return "&#39;";
      default:
        return ch;
    }
  });
}

/**
 * Display fallback for blanks already stored escaped in the DB
 * ("\_\_\_\_\_\_" → "_____"). Mirrors the parser normalization in
 * worker textNormalize.ts. Only 3+ runs are touched: standalone "\_"
 * and LaTeX commands are left alone.
 */
function normalizeEscapedBlanksDisplay(text: string): string {
  return text.replace(/(?:\\_){3,}/g, (m) => "_".repeat(m.length / 2));
}

/**
 * Render a plain-text chunk preserving line breaks and **bold** markers.
 * Single "*" bullets are left alone (only paired "**" becomes bold), so
 * note-taking passages ("* Atoms …") keep their bullets. Math is already
 * split out before this runs, so LaTeX is unaffected.
 */
function renderPlainRichTextChunk(chunk: string, keyPrefix: string): ReactNode[] {
  const out: ReactNode[] = [];
  const lines = chunk.split("\n");
  lines.forEach((line, li) => {
    if (li > 0) out.push(<br key={`${keyPrefix}-br-${li}`} />);
    const parts = line.split(/\*\*([^*]+?)\*\*/g);
    parts.forEach((part, pi) => {
      if (!part) return;
      if (pi % 2 === 1) out.push(<strong key={`${keyPrefix}-${li}-${pi}`}>{part}</strong>);
      else out.push(<span key={`${keyPrefix}-${li}-${pi}`}>{part}</span>);
    });
  });
  return out;
}

/** Only exact underline markers are interpreted. All other markup remains text. */
function renderRichTextChunk(chunk: string, keyPrefix: string): ReactNode[] {
  return chunk.split(/<u>([\s\S]*?)<\/u>/g).map((part, index) => {
    const children = renderPlainRichTextChunk(part, `${keyPrefix}-${index}`);
    return index % 2 === 1
      ? <span key={`${keyPrefix}-u-${index}`} style={{ textDecoration: "underline" }}>{children}</span>
      : <span key={`${keyPrefix}-plain-${index}`}>{children}</span>;
  });
}

/**
 * Render SAT prompt/passage/choice text with LaTeX equations typeset via
 * KaTeX. Supports $$…$$, \\[…\\], \\(…\\) and guarded $…$ (currency-safe).
 * Falls back to escaped raw text when KaTeX cannot render.
 */
export default function MathText({ text, className, style }: { text: string; className?: string; style?: React.CSSProperties }) {
  const nodes = useMemo(() => {
    if (!text) return null;
    // Display-level fallback so already-stored escaped blanks render clean.
    const clean = normalizeEscapedBlanksDisplay(text);
    // Fast path only skips tokenizing when math is impossible; rich text
    // (line breaks, **bold**) is still rendered below.
    const segs = clean.includes("$") || clean.includes("\\") ? splitMathSegments(clean) : [{ math: null, text: clean, display: false }];
    if (segs.every((s) => s.math === null)) {
      return <>{segs.flatMap((s, i) => renderRichTextChunk(s.text ?? "", `t-${i}`))}</>;
    }
    return segs.map((s, i) => {
      if (s.math === null) return <span key={i}>{renderRichTextChunk(s.text ?? "", `t-${i}`)}</span>;
      if (s.display) {
        return (
          <span
            key={i}
            style={{ display: "block", margin: "8px 0", overflowX: "auto" }}
            dangerouslySetInnerHTML={{ __html: renderMath(s.math, true) }}
          />
        );
      }
      return <span key={i} dangerouslySetInnerHTML={{ __html: renderMath(s.math, false) }} />;
    });
  }, [text]);
  if (!nodes) return <span className={className} style={style}>{text}</span>;
  return <span className={className} style={style}>{nodes}</span>;
}
