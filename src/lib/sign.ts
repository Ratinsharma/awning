import { createHmac } from "node:crypto";

const KEY = "awning-demo-receipt-v1";

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map((item) => canonical(item)).join(",")}]`;
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonical(record[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

export function signBody(value: unknown): string {
  return createHmac("sha256", KEY).update(canonical(value)).digest("hex");
}
