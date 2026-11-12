export function normName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

export type BoardItem = {
  name: string;
  priceCents: number;
  available: boolean;
  leadHours: number;
  allergens: string[];
  detail?: string;
};

export type DiffLine =
  | { kind: "price"; name: string; fromCents: number; toCents: number }
  | { kind: "sold_out"; name: string }
  | { kind: "restocked"; name: string }
  | { kind: "added"; name: string; priceCents: number };

export function diffBoard(
  current: { name: string; priceCents: number; available: boolean }[],
  next: { name: string; priceCents: number; available: boolean }[],
): DiffLine[] {
  const lines: DiffLine[] = [];
  const byName = new Map(current.map((item) => [normName(item.name), item]));
  for (const item of next) {
    const prev = byName.get(normName(item.name));
    if (!prev) {
      lines.push({ kind: "added", name: item.name, priceCents: item.priceCents });
      continue;
    }
    if (prev.priceCents !== item.priceCents) {
      lines.push({
        kind: "price",
        name: item.name,
        fromCents: prev.priceCents,
        toCents: item.priceCents,
      });
    }
    if (prev.available && !item.available) lines.push({ kind: "sold_out", name: item.name });
    if (!prev.available && item.available) lines.push({ kind: "restocked", name: item.name });
  }
  return lines;
}

export function suggestedPriceCents(query: string): number {
  const q = query.toLowerCase();
  if (q.includes("brownie")) return 450;
  if (q.includes("flat white") || q.includes("oat")) return 380;
  return 500;
}

export function titleQuery(query: string): string {
  return query
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

export function allergensForQuery(query: string): string[] {
  const q = query.toLowerCase();
  const allergens: string[] = [];
  if (q.includes("brownie") || q.includes("cake") || q.includes("scone")) {
    allergens.push("egg", "dairy");
  } else if (q.includes("milk") || q.includes("oat")) {
    allergens.push("dairy");
  }
  if (/\bnut/.test(q) && !/nut-free|nut free/.test(q)) allergens.push("nuts");
  return allergens;
}
