import { z } from "zod";

const CONTROL = /[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g;
const TAGS = /<\/?untrusted_input>/gi;

function plain(value: unknown): unknown {
  if (typeof value !== "string") return value;
  return value.replace(CONTROL, "").replace(TAGS, "").trim();
}

const querySchema = z.string().min(1).max(500);
const notesSchema = z.string().max(240);
const agentSchema = z.string().min(1).max(40).regex(/^[\w. -]+$/);

export function wrapUntrusted(text: string): string {
  return `<untrusted_input>${text.replace(TAGS, "")}</untrusted_input>`;
}

export type BuyerFields =
  | {
      ok: true;
      query: string;
      notes: string;
      agentName: string;
      wrappedQuery: string;
      wrappedNotes: string;
    }
  | { ok: false; summary: string };

/**
 * Buyer-agent text is data. It is zod-checked, wrapped for models, and never
 * dispatched as a tool call.
 */
export function buyerFields(input: { query: unknown; notes?: unknown; agentName?: unknown }): BuyerFields {
  const query = querySchema.safeParse(plain(input.query));
  if (!query.success) return { ok: false, summary: "That request isn't something the shop can read." };
  const notes = notesSchema.safeParse(plain(input.notes ?? ""));
  if (!notes.success) return { ok: false, summary: "That note is too long to check." };
  const agent = agentSchema.safeParse(plain(input.agentName ?? "") || "guest");
  return {
    ok: true,
    query: query.data,
    notes: notes.data,
    agentName: agent.success ? agent.data : "guest",
    wrappedQuery: wrapUntrusted(query.data),
    wrappedNotes: notes.data ? wrapUntrusted(notes.data) : "",
  };
}
