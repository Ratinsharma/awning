type ToolkitApi = {
  run(method: string, arg: unknown): Promise<string>;
};

type ToolkitCtor = new (
  token: string,
  context?: { sandbox?: boolean; request_id?: string },
) => ToolkitApi;

/**
 * In-process PayPal agent toolkit. This does not call PayPal's hosted MCP server.
 * `request_id` is sent as PayPal-Request-Id by the toolkit's own HTTP client.
 */
export async function runLocalToolkit(input: {
  token: string;
  toolName: string;
  args: unknown;
  requestId: string;
}): Promise<{ ok: true; body: unknown } | { ok: false; summary: string }> {
  try {
    const loaded = (await import("@paypal/agent-toolkit/mcp")) as { PayPalAPI: ToolkitCtor };
    const api = new loaded.PayPalAPI(input.token, { sandbox: true, request_id: input.requestId });
    const raw = await api.run(input.toolName, input.args);
    return readToolkit(raw);
  } catch (error) {
    return { ok: false, summary: error instanceof Error ? error.message : "Toolkit call failed." };
  }
}

function readToolkit(raw: unknown): { ok: true; body: unknown } | { ok: false; summary: string } {
  if (typeof raw !== "string" || raw.length === 0) return { ok: false, summary: "Toolkit returned nothing." };
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { ok: false, summary: raw.slice(0, 240) };
  }
  if (!parsed || typeof parsed !== "object") return { ok: false, summary: "Toolkit returned nothing." };
  const record = parsed as { error?: { message?: string }; status?: string; response?: unknown };
  if (record.error) return { ok: false, summary: record.error.message || "Toolkit call failed." };
  if (record.status === "error") return { ok: false, summary: "Toolkit call failed." };
  return { ok: true, body: record.response ?? parsed };
}
