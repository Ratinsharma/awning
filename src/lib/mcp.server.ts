import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { z } from "zod";
import { menuForAgent, orderStatus, placeShop, quoteShop } from "./shop.server";
import { buyerFields, wrapUntrusted } from "./untrusted";

function cors(response: Response): Response {
  const headers = new Headers(response.headers);
  headers.set("access-control-allow-origin", "*");
  headers.set("access-control-allow-methods", "GET, POST, DELETE, OPTIONS");
  headers.set(
    "access-control-allow-headers",
    "content-type, accept, mcp-session-id, mcp-protocol-version, last-event-id",
  );
  headers.set("access-control-expose-headers", "mcp-session-id");
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

function json(body: unknown, status = 200) {
  return cors(new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } }));
}

function text(payload: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(payload) }] };
}

function shopServer(slug: string) {
  const server = new McpServer({ name: "awning", version: "1.0.0" });

  server.registerTool(
    "browse_menu",
    { description: "List what this chalkboard shop can sell, with prices stored outside PayPal.", title: "Browse menu" },
    async () => text(await menuForAgent()),
  );

  server.registerTool(
    "ask",
    {
      title: "Ask the shop",
      description: "Ask if the shop can make something. Unmatched requests are logged as demand gaps. Cart API shaped validation_issues come back when it cannot.",
      inputSchema: { query: z.string() },
    },
    async ({ query }) => {
      const buyer = buyerFields({ query, agentName: "mcp" });
      if (!buyer.ok) return text({ ok: false, summary: buyer.summary, untrusted_query: wrapUntrusted(String(query).slice(0, 500)) });
      const result = await quoteShop(buyer.query, buyer.agentName, false);
      return text({ ...result.quote, untrusted_query: buyer.wrappedQuery });
    },
  );

  server.registerTool(
    "quote",
    {
      title: "Quote",
      description: "Price a request. Set use_alternatives when accepting a SUGGEST_ALTERNATIVE such as tea instead of a flat white.",
      inputSchema: { query: z.string(), use_alternatives: z.boolean().optional() },
    },
    async ({ query, use_alternatives }) => {
      const buyer = buyerFields({ query, agentName: "mcp" });
      if (!buyer.ok) return text({ ok: false, summary: buyer.summary, untrusted_query: wrapUntrusted(String(query).slice(0, 500)) });
      const result = await quoteShop(buyer.query, buyer.agentName, Boolean(use_alternatives));
      return text({ ...result.quote, untrusted_query: buyer.wrappedQuery });
    },
  );

  server.registerTool(
    "place_order",
    {
      title: "Place order",
      description: "Create a PayPal checkout (or a labelled replay order) after the shop rules pass. Returns an approval URL in live mode.",
      inputSchema: {
        query: z.string(),
        notes: z.string().optional(),
        use_alternatives: z.boolean().optional(),
      },
    },
    async ({ query, notes, use_alternatives }) => {
      const buyer = buyerFields({ query, notes, agentName: "mcp" });
      if (!buyer.ok) return text({ ok: false, summary: buyer.summary, untrusted_query: wrapUntrusted(String(query).slice(0, 500)) });
      const result = await placeShop({
        query: buyer.query,
        notes: buyer.notes,
        agentName: buyer.agentName,
        useAlternatives: Boolean(use_alternatives),
      });
      return text({
        ok: result.ok,
        summary: result.summary,
        order_id: result.orderId ?? null,
        approve_url: result.approveUrl ?? null,
        mode: result.snapshot.mode,
        validation_issues: result.quote?.issues ?? [],
        cart: result.quote?.cart ?? null,
        intent_mandate: result.quote?.intent ?? null,
        untrusted_query: buyer.wrappedQuery,
        untrusted_notes: buyer.wrappedNotes,
      });
    },
  );

  server.registerTool(
    "order_status",
    {
      title: "Order status",
      description: "Read an Awning order by its id or PayPal order id.",
      inputSchema: { order_id: z.string() },
    },
    async ({ order_id }) => text(await orderStatus(order_id)),
  );

  return server;
}

export async function handleShopMcp(slug: string, request: Request): Promise<Response> {
  if (slug !== "linden") return json({ error: "Unknown shop." }, 404);
  if (request.method === "OPTIONS") return cors(new Response(null, { status: 204 }));
  if (request.method === "GET" && !request.headers.get("accept")?.includes("text/event-stream")) {
    return json({
      name: "awning",
      shop: slug,
      transport: "mcp-streamable-http",
      tools: ["browse_menu", "ask", "quote", "place_order", "order_status"],
    });
  }
  try {
    const server = shopServer(slug);
    const transport = new WebStandardStreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
    });
    await server.connect(transport);
    return cors(await transport.handleRequest(request));
  } catch (error) {
    console.error("[awning-mcp]", error instanceof Error ? error.message : error);
    return json({ jsonrpc: "2.0", error: { code: -32603, message: "Internal server error" }, id: null }, 500);
  }
}
