import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { authorize, compileRules, DEFAULT_RULE_TEXT, type CartLine, type Rule } from "./rules.ts";

const rules: Rule[] = compileRules(DEFAULT_RULE_TEXT);

const tea: CartLine = {
  sku: "TEA",
  name: "Pot of tea",
  qty: 1,
  unitCents: 300,
  allergens: [],
  leadHours: 0,
};

const cake: CartLine = {
  ...tea,
  sku: "CAKE-VAN",
  name: "Vanilla birthday cake",
  unitCents: 4800,
  leadHours: 24,
};

const nuts: CartLine = {
  ...tea,
  sku: "CROISS-ALM",
  name: "Almond croissant",
  allergens: ["nuts"],
  unitCents: 450,
};

const now = new Date("2026-11-12T05:00:00Z");

describe("compileRules", () => {
  it("reads the sample sentence into four rules", () => {
    assert.deepEqual(
      rules.map((rule) => rule.type),
      ["min_notice_hours", "max_qty", "no_discounts", "max_per_minute"],
    );
  });
});

describe("authorize", () => {
  it("allows tea", () => {
    assert.equal(authorize({ rules, lines: [tea], now }).ok, true);
  });

  it("blocks a discount code", () => {
    const decision = authorize({ rules, lines: [tea], notes: "apply STAFF100 discount", now });
    assert.equal(decision.ok, false);
    if (!decision.ok) assert.equal(decision.ruleId, "no-discounts");
  });

  it("blocks a burst", () => {
    const decision = authorize({ rules, lines: [tea], recentOrders: 8, now });
    assert.equal(decision.ok, false);
    if (!decision.ok) assert.equal(decision.ruleId, "rate");
  });

  it("blocks a cake without notice", () => {
    const decision = authorize({
      rules,
      lines: [cake],
      now,
      pickupAt: new Date(now.getTime() + 60 * 60 * 1000),
    });
    assert.equal(decision.ok, false);
    if (!decision.ok) assert.match(decision.reason, /24 hours/);
  });

  it("allows a cake on Saturday", () => {
    const decision = authorize({
      rules,
      lines: [cake],
      now,
      pickupAt: new Date("2026-11-14T10:00:00Z"),
    });
    assert.equal(decision.ok, true);
  });

  it("enforces a nut-free intent", () => {
    const decision = authorize({
      rules,
      lines: [nuts],
      now,
      intent: { nutFree: true, maxCents: 6000 },
    });
    assert.equal(decision.ok, false);
    if (!decision.ok) assert.equal(decision.ruleId, "intent-nut-free");
  });

  it("enforces the spend cap", () => {
    const decision = authorize({
      rules,
      lines: [{ ...cake, leadHours: 0 }],
      now,
      pickupAt: new Date("2026-11-14T10:00:00Z"),
      intent: { maxCents: 1000 },
    });
    assert.equal(decision.ok, false);
    if (!decision.ok) assert.equal(decision.ruleId, "intent-cap");
  });
});
