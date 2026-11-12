import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { OPENING_BOARD, RESYNC_BOARD } from "./boards.ts";
import { diffBoard } from "./diff.ts";
import { clauses, matchClause, pickupFrom, spendCapCents } from "./match.ts";

describe("diffBoard", () => {
  it("sees the second chalkboard", () => {
    const lines = diffBoard(OPENING_BOARD, RESYNC_BOARD);
    assert.ok(lines.some((line) => line.kind === "price" && line.name.includes("scone")));
    assert.ok(lines.some((line) => line.kind === "sold_out" && line.name.includes("Soup")));
    assert.ok(lines.some((line) => line.kind === "added" && line.name.includes("brownie")));
  });
});

describe("match", () => {
  it("splits the agent ask and misses both items", () => {
    const parts = clauses("Oat-milk flat white and a gluten-free brownie, nut-free, under €60.");
    assert.deepEqual(parts, ["Oat-milk flat white", "a gluten-free brownie"]);
    assert.equal(matchClause(parts[0], OPENING_BOARD), null);
    assert.equal(matchClause(parts[1], OPENING_BOARD), null);
    assert.equal(spendCapCents("under €60"), 6000);
  });

  it("finds the brownie once it is on the board", () => {
    const found = matchClause("a gluten-free brownie", RESYNC_BOARD);
    assert.equal(found?.name, "Gluten-free brownie");
  });

  it("reads Saturday and a one-hour pickup", () => {
    const now = new Date("2026-11-12T05:00:00Z");
    assert.equal(pickupFrom("pickup in 1 hour", now)?.toISOString(), "2026-11-12T06:00:00.000Z");
    assert.equal(pickupFrom("Saturday", now)?.toISOString(), "2026-11-14T10:00:00.000Z");
  });
});
