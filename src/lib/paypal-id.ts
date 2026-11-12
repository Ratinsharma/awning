import { createHash } from "node:crypto";

/** Same inputs always hash to the same PayPal-Request-Id, so a retry cannot charge twice. */
export function paypalRequestId(runId: string, toolName: string, args: unknown): string {
  return createHash("sha256").update(runId + toolName + JSON.stringify(args)).digest("hex");
}

function round2(amount: number): number {
  return Math.round((amount + Number.EPSILON) * 100) / 100;
}

/** Sum of quantity × unit price, rounded to 2 decimals, must equal the order total. */
export function totalsMatch(lines: { qty: number; unitCents: number }[], totalCents: number): boolean {
  const sum = lines.reduce((acc, line) => acc + round2(line.qty * (line.unitCents / 100)), 0);
  return round2(sum).toFixed(2) === round2(totalCents / 100).toFixed(2);
}
