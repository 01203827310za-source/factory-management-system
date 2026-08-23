// ============================================================
// Shared color / model-number matching utility.
//
// Every place in the system that links records by color or model
// number (cutting -> fabric, model production -> ready stock, sales ->
// stock, returns -> stock, etc.) should build its lookup keys through
// this module instead of comparing raw strings directly. That way a
// row typed with one hamza spelling still links up with one typed with
// another, and "M 01" links up with "M01" — without ever letting two
// genuinely different colors or model numbers blur into each other.
//
// Strategy: normalize first (trim / collapse spaces / unify Arabic
// letter variants / strip diacritics), compare normalized-exact. Only
// if that fails, fall back to a conservative fuzzy comparison that
// refuses to match across different digit sequences and caps the
// allowed edit distance tightly.
//
// All Arabic-specific character classes below are written with \u
// escapes rather than literal characters, so the intent is unambiguous
// regardless of editor/terminal encoding.
// ============================================================

// Arabic combining marks: harakat/tanwin/sukun/shadda (U+064B-U+065F),
// superscript alef (U+0670), Quranic annotation marks (U+06D6-U+06ED).
const ARABIC_DIACRITICS = /[ً-ٰٟۖ-ۭ]/g;
const TATWEEL = /ـ/g; // kashida (ـ)

function stripDiacritics(s: string): string {
  return s.replace(ARABIC_DIACRITICS, '').replace(TATWEEL, '');
}

// Collapses safe Arabic letter variants that people type interchangeably:
//   أ إ آ ٱ (أ إ آ ٱ) -> ا (ا)
//   ى (ى) -> ي (ي)
//   ؤ (ؤ) -> و (و)
//   ئ (ئ) -> ي (ي)
//   ة (ة) -> ه (ه)
// This alone resolves the vast majority of "same color, different
// spelling" mismatches, with no fuzzy guessing involved.
function unifyArabicLetters(s: string): string {
  return s
    .replace(/[أإآٱ]/g, 'ا')
    .replace(/ى/g, 'ي')
    .replace(/ؤ/g, 'و')
    .replace(/ئ/g, 'ي')
    .replace(/ة/g, 'ه');
}

function collapseSpaces(s: string): string {
  return s.trim().replace(/\s+/g, ' ');
}

export function normalizeArabic(input: string | null | undefined): string {
  if (!input) return '';
  let s = collapseSpaces(String(input));
  s = stripDiacritics(s);
  s = unifyArabicLetters(s);
  return s.toLowerCase();
}

// Colors and other free-text labels: keep single internal spaces —
// multi-word colors are meaningfully different from their parts, so
// spaces between words must stay significant.
export function normalizeColor(input: string | null | undefined): string {
  return normalizeArabic(input);
}

// Model / cut codes: spacing carries no meaning ("M 01" === "M01"),
// so every internal space is dropped after the general normalization.
export function normalizeModelCode(input: string | null | undefined): string {
  return normalizeArabic(input).replace(/\s+/g, '');
}

export type MatchKind = 'color' | 'model';

function normalizeByKind(input: string | null | undefined, kind: MatchKind): string {
  return kind === 'model' ? normalizeModelCode(input) : normalizeColor(input);
}

function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  const al = a.length;
  const bl = b.length;
  if (al === 0) return bl;
  if (bl === 0) return al;

  let prev = new Array<number>(bl + 1);
  for (let j = 0; j <= bl; j++) prev[j] = j;

  for (let i = 1; i <= al; i++) {
    const cur = new Array<number>(bl + 1);
    cur[0] = i;
    for (let j = 1; j <= bl; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
    }
    prev = cur;
  }
  return prev[bl];
}

// Digit sequences must match exactly — "M01" must never fuzzy-match
// "M02", no matter how textually close they look otherwise.
function digitsSignature(s: string): string {
  return (s.match(/\d+/g) || []).join('-');
}

// Very short strings are refused for fuzzy matching entirely (one typo
// in a 3-letter color code changes its meaning too easily). Longer
// strings get a small, fixed edit-distance budget — never a loose ratio.
function fuzzyEditThreshold(len: number): number {
  if (len <= 4) return 0;
  if (len <= 9) return 1;
  return 2;
}

function fuzzyEqualNormalized(a: string, b: string): boolean {
  if (!a || !b) return false;
  if (a === b) return true;
  if (digitsSignature(a) !== digitsSignature(b)) return false;
  const threshold = fuzzyEditThreshold(Math.max(a.length, b.length));
  if (threshold === 0) return false;
  return levenshtein(a, b) <= threshold;
}

/**
 * Do `a` and `b` refer to the same color / model number?
 * Exact match after normalization first; high-threshold fuzzy match only
 * as a fallback, and never across differing digit sequences.
 */
export function textsMatch(a: string | null | undefined, b: string | null | undefined, kind: MatchKind = 'color'): boolean {
  const na = normalizeByKind(a, kind);
  const nb = normalizeByKind(b, kind);
  if (!na || !nb) return na === nb;
  if (na === nb) return true;
  return fuzzyEqualNormalized(na, nb);
}

/**
 * Finds the item in `items` whose `keyFn(item)` best matches `raw`.
 * Prefers a normalized-exact match; falls back to the closest safe
 * fuzzy match (smallest edit distance) if no exact match exists.
 */
export function findBestMatch<T>(
  items: T[],
  raw: string | null | undefined,
  keyFn: (item: T) => string | null | undefined,
  kind: MatchKind = 'color',
): T | undefined {
  const target = normalizeByKind(raw, kind);
  if (!target) return undefined;

  for (const item of items) {
    if (normalizeByKind(keyFn(item), kind) === target) return item;
  }

  let best: T | undefined;
  let bestDist = Infinity;
  for (const item of items) {
    const candidate = normalizeByKind(keyFn(item), kind);
    if (!candidate) continue;
    if (digitsSignature(candidate) !== digitsSignature(target)) continue;
    const threshold = fuzzyEditThreshold(Math.max(candidate.length, target.length));
    if (threshold === 0) continue;
    const dist = levenshtein(candidate, target);
    if (dist <= threshold && dist < bestDist) {
      bestDist = dist;
      best = item;
    }
  }
  return best;
}

/**
 * Does `list` (raw, unnormalized strings) contain a value matching `raw`?
 * Same normalized-exact-first, high-threshold-fuzzy-fallback rule.
 */
export function containsMatch(list: (string | null | undefined)[], raw: string | null | undefined, kind: MatchKind = 'color'): boolean {
  return findBestMatch(list, raw, x => x, kind) !== undefined;
}

type PartKind = MatchKind | 'exact';

/**
 * Groups composite keys (e.g. [material_type, color] or [model_code, color])
 * coming from different tables into one shared bucket whenever they refer
 * to the same thing, even if the raw text differs slightly between tables.
 * Use one instance per key "shape" within a single request/computation —
 * every row from every source table should resolve() through it so they
 * all land in the same bucket.
 */
export class FuzzyKeyIndex {
  private buckets: { norm: string[]; key: string }[] = [];
  private counter = 0;

  constructor(private kinds: PartKind[]) {}

  private normalizeParts(parts: (string | number | null | undefined)[]): string[] {
    return parts.map((p, i) => {
      const kind = this.kinds[i];
      if (kind === 'exact') return String(p ?? '');
      return normalizeByKind(String(p ?? ''), kind);
    });
  }

  /** Resolves raw parts to a canonical bucket key, reusing an existing bucket when possible. */
  resolve(parts: (string | number | null | undefined)[]): string {
    const norm = this.normalizeParts(parts);

    for (const b of this.buckets) {
      if (b.norm.every((n, i) => n === norm[i])) return b.key;
    }
    for (const b of this.buckets) {
      const isMatch = b.norm.every((n, i) => {
        if (this.kinds[i] === 'exact') return n === norm[i];
        return fuzzyEqualNormalized(n, norm[i]);
      });
      if (isMatch) return b.key;
    }

    const key = `#${this.counter++}:${norm.join('|')}`;
    this.buckets.push({ norm, key });
    return key;
  }
}
