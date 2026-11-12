export type Rule =
  | { id: string; type: "min_notice_hours"; hours: number; match: string }
  | { id: string; type: "max_qty"; max: number }
  | { id: string; type: "no_discounts" }
  | { id: string; type: "max_per_minute"; max: number };

export type CartLine = {
  sku: string;
  name: string;
  qty: number;
  unitCents: number;
  allergens: string[];
  leadHours: number;
};

export type Decision = { ok: true } | { ok: false; ruleId: string; reason: string };

const DISCOUNT = /\b(discount|coupon|promo|%\s*off|staff\s*\d+)\b/i;

export const DEFAULT_RULE_TEXT =
  "24 hours' notice for cakes, max 10 per order, no discounts, 8 orders a minute.";

export function ruleLabel(rule: Rule): string {
  switch (rule.type) {
    case "min_notice_hours":
      return rule.match ? `${rule.hours}h notice for ${rule.match}` : `${rule.hours}h notice`;
    case "max_qty":
      return `Max ${rule.max} per order`;
    case "no_discounts":
      return "No discounts";
    case "max_per_minute":
      return `Max ${rule.max} orders a minute`;
  }
}

export function compileRules(text: string): Rule[] {
  const rules: Rule[] = [];
  const notice = text.match(/(\d+)\s*hours?'?\s*(?:notice|lead)/i);
  if (notice) {
    rules.push({
      id: "notice",
      type: "min_notice_hours",
      hours: Number(notice[1]),
      match: /cake/i.test(text) ? "cake" : "",
    });
  }
  const qty = text.match(/max(?:imum)?(?:\s+of)?\s*(\d+)\s*(?:per|an|each|\/)\s*order/i);
  if (qty) rules.push({ id: "max-qty", type: "max_qty", max: Number(qty[1]) });
  if (/no\s+discounts?/i.test(text)) rules.push({ id: "no-discounts", type: "no_discounts" });
  const rate = text.match(/(\d+)\s*(?:orders?|requests?)\s*(?:a|per|\/)\s*minute/i);
  if (rate) rules.push({ id: "rate", type: "max_per_minute", max: Number(rate[1]) });
  return rules;
}

export function isRule(value: unknown): value is Rule {
  if (!value || typeof value !== "object") return false;
  const rule = value as Rule;
  if (rule.type === "no_discounts") return typeof rule.id === "string";
  if (rule.type === "max_qty" || rule.type === "max_per_minute") {
    return typeof rule.id === "string" && typeof rule.max === "number";
  }
  if (rule.type === "min_notice_hours") {
    return typeof rule.id === "string" && typeof rule.hours === "number" && typeof rule.match === "string";
  }
  return false;
}

export function authorize(input: {
  rules: Rule[];
  lines: CartLine[];
  notes?: string;
  pickupAt?: Date | null;
  now?: Date;
  recentOrders?: number;
  intent?: { maxCents?: number; nutFree?: boolean } | null;
}): Decision {
  const now = input.now ?? new Date();
  if (input.lines.length === 0) {
    return { ok: false, ruleId: "empty", reason: "The cart is empty." };
  }
  if (input.lines.some((line) => line.qty < 1 || !Number.isInteger(line.qty))) {
    return { ok: false, ruleId: "qty", reason: "Quantity has to be a whole number." };
  }

  if (input.intent?.nutFree) {
    const nuts = input.lines.find((line) =>
      line.allergens.some((allergen) => /nut/i.test(allergen)),
    );
    if (nuts) {
      return {
        ok: false,
        ruleId: "intent-nut-free",
        reason: `${nuts.name} contains nuts. The intent mandate says nut-free.`,
      };
    }
  }

  const total = input.lines.reduce((sum, line) => sum + line.unitCents * line.qty, 0);
  if (input.intent?.maxCents != null && total > input.intent.maxCents) {
    return {
      ok: false,
      ruleId: "intent-cap",
      reason: "This cart is over the signed spend cap.",
    };
  }

  if (input.rules.some((rule) => rule.type === "no_discounts") && DISCOUNT.test(input.notes ?? "")) {
    return {
      ok: false,
      ruleId: "no-discounts",
      reason: "Discounts are refused. The note looked like a discount code.",
    };
  }

  const maxQty = input.rules.find((rule) => rule.type === "max_qty");
  if (maxQty && maxQty.type === "max_qty") {
    const qty = input.lines.reduce((sum, line) => sum + line.qty, 0);
    if (qty > maxQty.max || input.lines.some((line) => line.qty > maxQty.max)) {
      return {
        ok: false,
        ruleId: maxQty.id,
        reason: `Max ${maxQty.max} items per order.`,
      };
    }
  }

  for (const line of input.lines) {
    const notice = input.rules.find(
      (rule) =>
        rule.type === "min_notice_hours" &&
        (!rule.match || line.name.toLowerCase().includes(rule.match.toLowerCase())),
    );
    const ruleHours = notice && notice.type === "min_notice_hours" ? notice.hours : 0;
    const hours = Math.max(ruleHours, line.leadHours);
    if (hours <= 0) continue;
    const ready = input.pickupAt?.getTime() ?? 0;
    if (!input.pickupAt || ready - now.getTime() < hours * 60 * 60 * 1000) {
      return {
        ok: false,
        ruleId: notice && notice.type === "min_notice_hours" ? notice.id : "lead-time",
        reason: `${line.name} needs ${hours} hours' notice.`,
      };
    }
  }

  const rate = input.rules.find((rule) => rule.type === "max_per_minute");
  if (rate && rate.type === "max_per_minute" && (input.recentOrders ?? 0) >= rate.max) {
    return {
      ok: false,
      ruleId: rate.id,
      reason: `Max ${rate.max} orders a minute. This burst was stopped.`,
    };
  }

  return { ok: true };
}
