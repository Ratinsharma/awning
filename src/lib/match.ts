const STOP = new Set([
  "a",
  "an",
  "the",
  "of",
  "and",
  "for",
  "with",
  "under",
  "please",
  "i",
  "want",
  "me",
  "to",
  "get",
  "one",
  "some",
  "nut",
  "free",
  "today",
  "saturday",
  "sunday",
  "hour",
  "hours",
  "pickup",
  "in",
]);

export function clauses(text: string): string[] {
  return text
    .split(/\band\b|,|&/i)
    .map((part) => part.replace(/\([^)]*\)/g, " ").trim())
    .filter((part) => tokens(part).length > 0);
}

function tokens(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .split(" ")
    .map((token) => token.trim())
    .filter((token) => token.length >= 3 && !STOP.has(token));
}

export function matchClause<T extends { name: string }>(clause: string, products: T[]): T | null {
  const want = tokens(clause);
  if (want.length === 0) return null;
  let best: { item: T; score: number } | null = null;
  for (const item of products) {
    const have = new Set(tokens(item.name));
    const score = want.filter((token) => have.has(token)).length;
    if (score === 0) continue;
    if (!best || score > best.score) best = { item, score };
  }
  return best?.item ?? null;
}

export function qtyIn(clause: string): number {
  const match = clause.match(/\b(\d{1,2})\b/);
  if (!match) return 1;
  const qty = Number(match[1]);
  return qty > 0 ? qty : 1;
}

export function pickupFrom(text: string, now: Date): Date | null {
  if (/in\s*(?:an|1|one)\s*hour/i.test(text) || /\btoday\b/i.test(text)) {
    return new Date(now.getTime() + 60 * 60 * 1000);
  }
  if (/\bsaturday\b/i.test(text)) {
    const when = new Date(now);
    const day = when.getUTCDay();
    const add = (6 - day + 7) % 7 || 7;
    when.setUTCDate(when.getUTCDate() + add);
    when.setUTCHours(10, 0, 0, 0);
    return when;
  }
  return null;
}

export function wantsNutFree(text: string): boolean {
  return /nut-free|nut free|no nuts/i.test(text);
}

export function spendCapCents(text: string): number | undefined {
  const match = text.match(/(?:€|eur|under|below|max)\s*€?\s*(\d{1,4})(?:[.,](\d{2}))?/i);
  if (!match) return undefined;
  const euros = Number(match[1]);
  const extra = match[2] ? Number(match[2]) : 0;
  return euros * 100 + extra;
}
