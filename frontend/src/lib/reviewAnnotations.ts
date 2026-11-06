export type BoardPoint = [number, number];
export type BoardStroke = { points: BoardPoint[]; color: string; width: number; opacity: number };
export type HighlightRect = { x: number; y: number; width: number; height: number };
export type BoardComment = { id: string; highlights: HighlightRect[]; x: number; y: number; text: string; color?: string; width?: number; height?: number };
export function commentSize(c: BoardComment) { return { width: c.width ?? 260, height: c.height ?? 180 }; }
export function commentConnector(c: BoardComment) {
  const r = c.highlights[c.highlights.length - 1] ?? { x: c.x, y: c.y, width: 0, height: 0 }, size = commentSize(c);
  const x = r.x + r.width / 2, y = r.y + r.height + 8;
  const bx = Math.max(c.x, Math.min(c.x + size.width, x)), by = y < c.y ? c.y : c.y + size.height;
  return { x, y, path: `M${bx},${by} C${bx},${by + (y < c.y ? -40 : 40)} ${x},${y + 40} ${x},${y}` };
}
export type ReviewAnnotation = {
  version: 1; theme: "white" | "black"; strokes: BoardStroke[]; notes: string; height: number;
  comments?: BoardComment[];
  spacious?: boolean;
};

export function emptyAnnotation(): ReviewAnnotation {
  return { version: 1, theme: "white", strokes: [], notes: "", height: 1000, spacious: true };
}

// Validate stored documents before rendering them; never interpret saved markup.
export function validAnnotation(value: unknown): value is ReviewAnnotation {
  if (!value || typeof value !== "object") return false;
  const v = value as ReviewAnnotation;
  return v.version === 1 && ["white", "black"].includes(v.theme) &&
    (v.spacious === undefined || typeof v.spacious === "boolean") &&
    typeof v.notes === "string" && v.notes.length <= 10000 &&
    Number.isFinite(v.height) && v.height >= 1000 && v.height <= 20000 &&
    (v.comments === undefined || (Array.isArray(v.comments) && v.comments.length <= 100 && new Set(v.comments.map(c => c?.id)).size === v.comments.length && v.comments.every(c =>
      c && typeof c.id === "string" && /^[a-zA-Z0-9-]{1,64}$/.test(c.id) && typeof c.text === "string" && c.text.length <= 2000 &&
      (c.color === undefined || (typeof c.color === "string" && /^#[0-9a-f]{6}$/i.test(c.color))) &&
      (c.width === undefined || (Number.isFinite(c.width) && c.width >= 180 && c.width <= 600)) &&
      (c.height === undefined || (Number.isFinite(c.height) && c.height >= 120 && c.height <= 600)) &&
      Number.isFinite(c.x) && c.x >= 0 && c.x <= Math.min(700, 960 - commentSize(c).width) && Number.isFinite(c.y) && c.y >= 0 && c.y <= v.height - Math.max(180, commentSize(c).height) &&
      Array.isArray(c.highlights) && c.highlights.length >= 1 && c.highlights.length <= 100 && c.highlights.every(r =>
        r && [r.x, r.y, r.width, r.height].every(Number.isFinite) && r.x >= 0 && r.y >= 0 && r.width > 0 && r.height > 0 && r.x + r.width <= 960 && r.y + r.height <= v.height)))) &&
    Array.isArray(v.strokes) && v.strokes.length <= 2000 && v.strokes.every(s =>
      s !== null && typeof s === "object" && /^#[0-9a-f]{6}$/i.test(s.color) && Number.isFinite(s.width) && s.width >= 1 && s.width <= 32 &&
      [0.3, 1].includes(s.opacity) && Array.isArray(s.points) && s.points.length > 0 && s.points.length <= 10000 &&
      s.points.every(p => Array.isArray(p) && p.length === 2 && p.every(Number.isFinite) &&
        p[0] >= 0 && p[0] <= 960 && p[1] >= 0 && p[1] <= 20000));
}

export function strokePath(stroke: BoardStroke): string {
  return stroke.points.map(([x, y], i) => `${i ? "L" : "M"}${x.toFixed(2)},${y.toFixed(2)}`).join(" ") +
    (stroke.points.length === 1 ? " l0.01,0" : "");
}

export function touchesStroke(stroke: BoardStroke, point: BoardPoint): boolean {
  return stroke.points.some((a, i) => {
    const b = stroke.points[i + 1] ?? a;
    const dx = b[0] - a[0], dy = b[1] - a[1];
    const t = Math.max(0, Math.min(1, ((point[0] - a[0]) * dx + (point[1] - a[1]) * dy) / (dx * dx + dy * dy || 1)));
    return Math.hypot(point[0] - a[0] - t * dx, point[1] - a[1] - t * dy) < 15 + stroke.width / 2;
  });
}
