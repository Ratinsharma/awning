import type { BoardItem } from "./diff";

function eurosToCents(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return Math.round(value * 100);
  if (typeof value !== "string") return null;
  const match = value.replace(",", ".").match(/(\d+)(?:\.(\d{1,2}))?/);
  if (!match) return null;
  const cents = Number(match[1]) * 100 + Number((match[2] ?? "").padEnd(2, "0"));
  return Number.isFinite(cents) ? cents : null;
}

export function parseBoardItems(raw: string): BoardItem[] {
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start < 0 || end < start) throw new Error("The model did not return a menu.");
  const parsed = JSON.parse(raw.slice(start, end + 1)) as { items?: unknown };
  if (!Array.isArray(parsed.items)) throw new Error("The model did not return items.");
  const items: BoardItem[] = [];
  for (const entry of parsed.items) {
    if (!entry || typeof entry !== "object") continue;
    const row = entry as Record<string, unknown>;
    const name = String(row.name ?? "").trim();
    const priceCents = eurosToCents(row.price);
    if (!name || priceCents == null) continue;
    const allergens = Array.isArray(row.allergens) ? row.allergens.map((item) => String(item).toLowerCase()) : [];
    items.push({
      name: name.slice(0, 80),
      priceCents,
      available: row.available !== false && !/sold out|crossed/i.test(String(row.note ?? "")),
      leadHours: Number.isFinite(Number(row.leadHours)) ? Math.max(0, Math.round(Number(row.leadHours))) : 0,
      allergens,
      detail: String(row.note ?? "").slice(0, 160),
    });
  }
  if (items.length === 0) throw new Error("No priced items were readable on that photo.");
  return items;
}

export async function readMenuPhoto(dataUrl: string): Promise<BoardItem[]> {
  const apiKey = process.env.XAI_API_KEY;
  if (!apiKey) throw new Error("Vision isn't available. Use the sample board.");
  if (!dataUrl.startsWith("data:image/")) throw new Error("Upload a photo of the board.");
  if (dataUrl.length > 4_000_000) throw new Error("That photo is too large. Try again closer to the board.");

  const response = await fetch("https://api.x.ai/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "grok-4.5",
      max_tokens: 800,
      messages: [
        {
          role: "user",
          content: [
            {
              type: "text",
              text: 'Read this café chalkboard. Reply with JSON only: {"items":[{"name":"","price":3.5,"available":true,"leadHours":0,"allergens":[],"note":""}]}. Price is a number in euros. available is false when an item is crossed out or marked sold out. leadHours is 24 when the board says 24 hours, otherwise 0. Do not invent items.',
            },
            { type: "image_url", image_url: { url: dataUrl } },
          ],
        },
      ],
    }),
    signal: AbortSignal.timeout(30000),
  });
  if (!response.ok) throw new Error(`Vision failed (${response.status}). Use the sample board.`);
  const body = (await response.json()) as { choices?: { message?: { content?: string } }[] };
  const content = body.choices?.[0]?.message?.content ?? "";
  return parseBoardItems(content);
}
