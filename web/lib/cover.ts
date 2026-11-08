/**
 * Deterministic generative cover algorithm (DESIGN §5).
 *
 * Pure functions; same slug → identical rendering everywhere. The drawing
 * order of random values is fixed, so consumers must call the helpers in the
 * documented order.
 */

export type CategoryPalette = { base: string; deep: string };

/** Category colors per DESIGN §2.2. */
const CATEGORY_COLORS: Record<string, CategoryPalette> = {
  action: { base: "#E4572E", deep: "#6E1C0C" },
  adventure: { base: "#3A8F5C", deep: "#103B24" },
  arcade: { base: "#F0AE35", deep: "#7A4706" },
  board: { base: "#9A7352", deep: "#3A281B" },
  card: { base: "#C62A63", deep: "#470A22" },
  clicker: { base: "#EE86AE", deep: "#7A2246" },
  driving: { base: "#3F5C84", deep: "#121F36" },
  io: { base: "#11A3A0", deep: "#023F3E" },
  puzzle: { base: "#7B5EA7", deep: "#2A1C44" },
  shooting: { base: "#5E6E77", deep: "#1C2428" },
  sim: { base: "#8DB37E", deep: "#2B4823" },
  sports: { base: "#2D9C8E", deep: "#0B3832" },
  strategy: { base: "#B07F8A", deep: "#47262E" },
  trivia: { base: "#E3BD5C", deep: "#66500C" },
  word: { base: "#6A9BC6", deep: "#1A3653" },
};

const FALLBACK_COLORS: CategoryPalette = { base: "#8DB37E", deep: "#2B4823" };

export function categoryColors(slug: string): CategoryPalette {
  return CATEGORY_COLORS[slug] ?? FALLBACK_COLORS;
}

export function fnv1a32(text: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

/** mulberry32 PRNG; returns floats in [0, 1). */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export type TrailCoverPlan = {
  gradientAngle: number;
  light: { cx: number; cy: number; r: number };
  contours: string[];
  trail: { d: string; dot: { x: number; y: number } };
};

type Point = { x: number; y: number };

/**
 * Compute the full geometry for a 320×180 TrailCover. `rand` is consumed in a
 * fixed order: gradient angle, light center (x, y), contour center (cx, cy),
 * then per contour: two phases and two frequencies (outermost first), then
 * trail control points (y1, y2).
 */
export function planTrailCover(slug: string, width = 320, height = 180): TrailCoverPlan {
  const rand = mulberry32(fnv1a32(slug));
  const scaleX = width / 320;
  const scaleY = height / 180;

  const gradientAngle = 110 + rand() * 60;
  const light = {
    cx: width * (0.2 + rand() * 0.6),
    cy: height * (0.15 + rand() * 0.6),
    r: 190 * Math.max(scaleX, scaleY),
  };

  const cx = width * (0.4 + rand() * 0.5);
  const cy = height * (0.2 + rand() * 0.6);

  // 9 closed contours, radius 18 growing by ~22 per ring, innermost first.
  const contours: string[] = [];
  for (let ring = 0; ring < 9; ring++) {
    const radius = (18 + ring * 22) * scaleY;
    const phase1 = rand() * Math.PI * 2;
    const phase2 = rand() * Math.PI * 2;
    const freq1 = 2 + Math.round(rand() * 2);
    const freq2 = 4 + Math.round(rand() * 3);
    const amp1 = radius * (0.06 + rand() * 0.06);
    const amp2 = radius * (0.06 + rand() * 0.06);
    const points: Point[] = [];
    for (let i = 0; i < 24; i++) {
      const theta = (i / 24) * Math.PI * 2;
      const wobble =
        Math.sin(freq1 * theta + phase1) * amp1 + Math.sin(freq2 * theta + phase2) * amp2;
      const r = radius + wobble;
      points.push({ x: cx + Math.cos(theta) * r * scaleX, y: cy + Math.sin(theta) * r });
    }
    contours.push(catmullRomClosed(points));
  }

  // Trail: cubic bezier from the left edge to the right edge.
  const y1 = height * (0.15 + rand() * 0.7);
  const y2 = height * (0.15 + rand() * 0.7);
  const p0 = { x: -8 * scaleX, y: y1 };
  const p3 = { x: width + 8 * scaleX, y: y2 };
  const p1 = { x: width * 0.3, y: y1 + (y2 - y1) * 0.4 + (rand() - 0.5) * height * 0.5 };
  const p2 = { x: width * 0.7, y: y1 + (y2 - y1) * 0.6 + (rand() - 0.5) * height * 0.5 };
  const trail = {
    d: `M ${p0.x.toFixed(1)} ${p0.y.toFixed(1)} C ${p1.x.toFixed(1)} ${p1.y.toFixed(1)}, ${p2.x.toFixed(1)} ${p2.y.toFixed(1)}, ${p3.x.toFixed(1)} ${p3.y.toFixed(1)}`,
    dot: cubicPointAt(p0, p1, p2, p3, 0.6),
  };

  return {
    gradientAngle,
    light,
    contours,
    trail,
  };
}

export function leadingLetter(name: string): string {
  const stripped = name.replace(/^the\s+/i, "");
  const match = stripped.match(/[a-z0-9]/i);
  return (match?.[0] ?? "?").toUpperCase();
}

/** Approximate advance width of a display-font Latin glyph, for letter placement. */
function glyphWidth(char: string, fontSize: number): number {
  const wide = "MWQ@";
  const narrow = "Iijl1fjt.";
  if (wide.includes(char)) return fontSize * 0.95;
  if (narrow.includes(char)) return fontSize * 0.32;
  return fontSize * 0.62;
}

/** Placement for the cropped corner letter (DESIGN §5.6): x = width - 0.80 ×
 * glyph width and the baseline near the bottom, so ≥70% of the width and ≥60%
 * of the height stay visible (UI review U6). */
export function letterPlacement(char: string, fontSize: number, width: number): number {
  return width - 0.8 * glyphWidth(char, fontSize);
}

function cubicPointAt(p0: Point, p1: Point, p2: Point, p3: Point, t: number): Point {
  const u = 1 - t;
  const a = u * u * u;
  const b = 3 * u * u * t;
  const c = 3 * u * t * t;
  const d = t * t * t;
  return {
    x: a * p0.x + b * p1.x + c * p2.x + d * p3.x,
    y: a * p0.y + b * p1.y + c * p2.y + d * p3.y,
  };
}

/** Catmull-Rom through the points, emitted as a closed cubic bezier path. */
function catmullRomClosed(points: Point[]): string {
  const n = points.length;
  const at = (i: number) => points[(i + n) % n];
  let d = `M ${at(0).x.toFixed(1)} ${at(0).y.toFixed(1)}`;
  for (let i = 0; i < n; i++) {
    const p0 = at(i - 1);
    const p1 = at(i);
    const p2 = at(i + 1);
    const p3 = at(i + 2);
    const c1 = { x: p1.x + (p2.x - p0.x) / 6, y: p1.y + (p2.y - p0.y) / 6 };
    const c2 = { x: p2.x - (p3.x - p1.x) / 6, y: p2.y - (p3.y - p1.y) / 6 };
    d += ` C ${c1.x.toFixed(1)} ${c1.y.toFixed(1)}, ${c2.x.toFixed(1)} ${c2.y.toFixed(1)}, ${p2.x.toFixed(1)} ${p2.y.toFixed(1)}`;
  }
  return d + " Z";
}
