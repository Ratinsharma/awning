import { getSql, type Sql } from "@/lib/db";
import { OPENING_BOARD } from "./boards";
import {
  allergensForQuery,
  diffBoard,
  normName,
  suggestedPriceCents,
  titleQuery,
  type BoardItem,
  type DiffLine,
} from "./diff";
import { clauses, matchClause, pickupFrom, qtyIn, spendCapCents, wantsNutFree } from "./match";
import {
  approvalUrl,
  captureCheckout,
  captureIdOf,
  createCatalogProduct,
  createCheckout,
  getSandboxCreds,
  money,
  readCheckout,
  refundCapture,
  sandboxMode,
  setSandboxCreds,
  trackCheckout,
  accessToken,
  type SandboxCreds,
} from "./paypal.server";
import { authorize, compileRules, isRule, type CartLine, type Decision, type Rule } from "./rules";
import { signBody } from "./sign";
import { readMenuPhoto } from "./vision.server";

const SHOP = "linden";

export type ProductRow = {
  id: string;
  sku: string;
  name: string;
  detail: string;
  priceCents: number;
  currency: "EUR";
  allergens: string[];
  leadHours: number;
  stock: number;
  available: boolean;
  paypalProductId: string | null;
};

export type OrderRow = {
  id: string;
  status: string;
  totalCents: number;
  currency: string;
  lines: { sku: string; name: string; qty: number; unitCents: number }[];
  notes: string;
  cartSignature: string | null;
  paypalOrderId: string | null;
  paypalCaptureId: string | null;
  trackingNumber: string | null;
  trackerId: string | null;
  mode: "live" | "replay";
  blockedRule: string | null;
  agentName: string;
  createdAt: string;
};

export type GapRow = { id: string; query: string; asks: number; status: string };
export type AgentStat = { agentName: string; asks: number; blocked: number; captured: number };

export type ShopSnapshot = {
  shop: { id: string; slug: string; name: string; rules: Rule[]; live: boolean };
  mode: "live" | "replay";
  products: ProductRow[];
  orders: OrderRow[];
  gaps: GapRow[];
  agents: AgentStat[];
  blocked: { id: string; reason: string; notes: string; createdAt: string }[];
};

export type ResolutionOption = { action: string; label: string; metadata?: Record<string, string> };
export type ValidationIssue = {
  code: string;
  type: "BUSINESS_RULE" | "INVENTORY_ISSUE";
  message: string;
  userMessage: string;
  variantId?: string;
  resolutionOptions: ResolutionOption[];
};

export type SignedCart = {
  lines: { sku: string; name: string; qty: number; unitCents: number }[];
  totalCents: number;
  currency: "EUR";
  signature: string;
  signedAt: string;
};

export type QuoteBody = {
  status: "READY" | "INCOMPLETE";
  answer: string;
  issues: ValidationIssue[];
  cart: SignedCart | null;
  intent: { text: string; maxCents: number | null; nutFree: boolean; signature: string; signedAt: string };
};

export type Action = {
  ok: boolean;
  summary: string;
  detail?: string;
  snapshot: ShopSnapshot;
  quote?: QuoteBody;
  orderId?: string;
  approveUrl?: string | null;
  lines?: DiffLine[];
  items?: BoardItem[];
  answer?: string;
  source?: "grok" | "ledger";
};

const SEED: { id: string; sku: string; item: BoardItem }[] = [
  ["p-tea", "TEA"],
  ["p-scone", "SCONE"],
  ["p-soup", "SOUP"],
  ["p-cake", "CAKE-VAN"],
  ["p-croissant", "CROISS-ALM"],
].map(([id, sku], index) => ({ id, sku, item: OPENING_BOARD[index] }));

function asArray(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(String);
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      if (Array.isArray(parsed)) return parsed.map(String);
    } catch {
      return [];
    }
  }
  return [];
}

function asRules(value: unknown): Rule[] {
  const raw = typeof value === "string" ? JSON.parse(value) : value;
  return Array.isArray(raw) ? raw.filter(isRule) : [];
}

function asLines(value: unknown): OrderRow["lines"] {
  const raw = typeof value === "string" ? JSON.parse(value) : value;
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((line) => line && typeof line === "object")
    .map((line) => {
      const row = line as OrderRow["lines"][number];
      return {
        sku: String(row.sku),
        name: String(row.name),
        qty: Number(row.qty),
        unitCents: Number(row.unitCents),
      };
    });
}

async function ensureShop(sql: Sql) {
  const rules = JSON.stringify(compileRules("24 hours' notice for cakes, max 10 per order, no discounts, 8 orders a minute."));
  await sql`insert into shops (id, slug, name, rules_json, live)
    values (${SHOP}, ${SHOP}, ${"Linden"}, ${rules}::jsonb, false)
    on conflict (id) do nothing`;
  const existing = await sql<{ n: number }>`select count(*)::int as n from products where shop_id = ${SHOP}`;
  if ((existing[0]?.n ?? 0) > 0) return;
  for (const row of SEED) {
    await insertProduct(sql, row.id, row.sku, row.item, null);
  }
}

async function insertProduct(sql: Sql, id: string, sku: string, item: BoardItem, paypalProductId: string | null) {
  await sql`insert into products
    (id, shop_id, sku, name, detail, price_cents, currency, allergens, lead_hours, stock, available, paypal_product_id)
    values (
      ${id}, ${SHOP}, ${sku}, ${item.name}, ${item.detail ?? ""}, ${item.priceCents}, ${"EUR"},
      ${JSON.stringify(item.allergens)}::jsonb, ${item.leadHours}, ${item.available ? 20 : 0},
      ${item.available}, ${paypalProductId}
    )
    on conflict (id) do nothing`;
}

export async function loadSnapshot(): Promise<ShopSnapshot> {
  const sql = await getSql();
  await ensureShop(sql);
  const shops = await sql<{ id: string; slug: string; name: string; rules_json: unknown; live: boolean }>`
    select id, slug, name, rules_json, live from shops where id = ${SHOP}`;
  const shop = shops[0];
  if (!shop) throw new Error("Linden is missing from the shop table.");
  const products = await sql<Record<string, unknown>>`
    select id, sku, name, detail, price_cents, currency, allergens, lead_hours, stock, available, paypal_product_id
    from products where shop_id = ${SHOP} order by name`;
  const orders = await sql<Record<string, unknown>>`
    select id, status, total_cents, currency, lines_json, notes, cart_signature, paypal_order_id,
      paypal_capture_id, tracking_number, tracker_id, mode, blocked_rule, agent_name,
      to_char(created_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') as created_at
    from orders where shop_id = ${SHOP} order by created_at desc limit 40`;
  const gaps = await sql<{ id: string; query: string; asks: number; status: string }>`
    select id, query, asks, status from demand_gaps where shop_id = ${SHOP} order by asks desc, query`;
  const events = await sql<{ agent_name: string; kind: string }>`
    select agent_name, kind from agent_events where shop_id = ${SHOP} order by created_at desc limit 200`;

  const agents = new Map<string, AgentStat>();
  for (const event of events) {
    const row = agents.get(event.agent_name) ?? { agentName: event.agent_name, asks: 0, blocked: 0, captured: 0 };
    if (event.kind === "asked") row.asks += 1;
    if (event.kind === "blocked") row.blocked += 1;
    if (event.kind === "captured") row.captured += 1;
    agents.set(event.agent_name, row);
  }

  const mappedOrders: OrderRow[] = orders.map((row) => ({
    id: String(row.id),
    status: String(row.status),
    totalCents: Number(row.total_cents),
    currency: String(row.currency),
    lines: asLines(row.lines_json),
    notes: String(row.notes ?? ""),
    cartSignature: row.cart_signature ? String(row.cart_signature) : null,
    paypalOrderId: row.paypal_order_id ? String(row.paypal_order_id) : null,
    paypalCaptureId: row.paypal_capture_id ? String(row.paypal_capture_id) : null,
    trackingNumber: row.tracking_number ? String(row.tracking_number) : null,
    trackerId: row.tracker_id ? String(row.tracker_id) : null,
    mode: row.mode === "live" ? "live" : "replay",
    blockedRule: row.blocked_rule ? String(row.blocked_rule) : null,
    agentName: String(row.agent_name),
    createdAt: String(row.created_at),
  }));

  return {
    shop: {
      id: shop.id,
      slug: shop.slug,
      name: shop.name,
      rules: asRules(shop.rules_json),
      live: Boolean(shop.live),
    },
    mode: sandboxMode(),
    products: products.map((row) => ({
      id: String(row.id),
      sku: String(row.sku),
      name: String(row.name),
      detail: String(row.detail ?? ""),
      priceCents: Number(row.price_cents),
      currency: "EUR",
      allergens: asArray(row.allergens),
      leadHours: Number(row.lead_hours),
      stock: Number(row.stock),
      available: Boolean(row.available),
      paypalProductId: row.paypal_product_id ? String(row.paypal_product_id) : null,
    })),
    orders: mappedOrders,
    gaps: gaps.map((gap) => ({ ...gap, asks: Number(gap.asks) })),
    agents: [...agents.values()],
    blocked: mappedOrders
      .filter((order) => order.status === "blocked")
      .slice(0, 12)
      .map((order) => ({
        id: order.id,
        reason: order.blockedRule ?? "blocked",
        notes: order.notes,
        createdAt: order.createdAt,
      })),
  };
}

async function recentCount(sql: Sql): Promise<number> {
  const rows = await sql<{ n: number }>`
    select count(*)::int as n from orders
    where shop_id = ${SHOP} and status <> 'blocked' and created_at > now() - interval '1 minute'`;
  return rows[0]?.n ?? 0;
}

function drinkAlternative(clause: string, products: ProductRow[]): ProductRow | null {
  if (/gluten-free|gluten free/.test(clause.toLowerCase())) return null;
  if (!/flat white|oat|coffee|latte|cappuccino|milk/.test(clause.toLowerCase())) return null;
  return products.find((product) => product.available && /tea/i.test(product.name)) ?? null;
}

function issueFor(clause: string, alt: ProductRow | null): ValidationIssue {
  return {
    code: "ITEM_NOT_ON_BOARD",
    type: "INVENTORY_ISSUE",
    message: `${clause} is not on the board`,
    userMessage: `We don't sell ${clause.replace(/^a\s+/i, "")} yet.`,
    resolutionOptions: alt
      ? [{ action: "SUGGEST_ALTERNATIVE", label: `Offer ${alt.name}`, metadata: { sku: alt.sku, priority: "high" } }]
      : [{ action: "REMOVE_ITEM", label: "Leave it off the cart", metadata: { priority: "low" } }],
  };
}

async function logGap(sql: Sql, query: string) {
  const key = normName(query);
  if (!key) return;
  const id = `gap-${key.replace(/ /g, "-").slice(0, 40)}`;
  await sql`insert into demand_gaps (id, shop_id, query, asks)
    values (${id}, ${SHOP}, ${key}, 1)
    on conflict (shop_id, query) do update
    set asks = demand_gaps.asks + 1, updated_at = now()`;
}

async function logEvent(sql: Sql, agent: string, kind: string, detail: string) {
  await sql`insert into agent_events (id, shop_id, agent_name, kind, detail)
    values (${crypto.randomUUID()}, ${SHOP}, ${agent}, ${kind}, ${detail})`;
}

type Resolution = {
  issues: ValidationIssue[];
  lines: CartLine[];
  answer: string;
  decision: Decision | null;
  cart: SignedCart | null;
  intent: QuoteBody["intent"];
};

function buildIntent(query: string): QuoteBody["intent"] {
  const intent = {
    text: query,
    maxCents: spendCapCents(query) ?? null,
    nutFree: wantsNutFree(query),
    signedAt: new Date().toISOString(),
  };
  return { ...intent, signature: signBody(intent) };
}

async function resolve(query: string, useAlternatives: boolean, recordGaps: boolean): Promise<Resolution> {
  const snapshot = await loadSnapshot();
  const intent = buildIntent(query);
  const now = new Date();
  const pickupAt = pickupFrom(query, now);
  const issues: ValidationIssue[] = [];
  const lines: CartLine[] = [];
  const notes: string[] = [];

  for (const clause of clauses(query)) {
    const found = matchClause(clause, snapshot.products);
    if (!found) {
      const alt = drinkAlternative(clause, snapshot.products);
      if (useAlternatives && alt) {
        lines.push(toLine(alt, 1));
        notes.push(`${clause.trim()} isn't on the board. Offering ${alt.name} instead.`);
        continue;
      }
      issues.push(issueFor(clause, alt));
      if (recordGaps) {
        const sql = await getSql();
        await logGap(sql, clause.replace(/^a\s+/i, ""));
      }
      continue;
    }
    if (!found.available) {
      issues.push({
        code: "INVENTORY_ISSUE",
        type: "INVENTORY_ISSUE",
        message: `${found.name} is sold out`,
        userMessage: `${found.name} is crossed off the board.`,
        variantId: found.sku,
        resolutionOptions: [
          { action: "WAIT_FOR_RESTOCK", label: "Wait until it's back", metadata: { sku: found.sku } },
          { action: "REMOVE_ITEM", label: "Remove it", metadata: { sku: found.sku } },
        ],
      });
      continue;
    }
    lines.push(toLine(found, qtyIn(clause)));
  }

  let decision: Decision | null = null;
  let cart: SignedCart | null = null;
  if (issues.length === 0 && lines.length > 0) {
    decision = authorize({
      rules: snapshot.shop.rules,
      lines,
      now,
      pickupAt,
      intent: { maxCents: intent.maxCents ?? undefined, nutFree: intent.nutFree },
      recentOrders: await recentCount(await getSql()),
    });
    if (!decision.ok) {
      issues.push({
        code: "BUSINESS_RULE",
        type: "BUSINESS_RULE",
        message: decision.reason,
        userMessage: decision.reason,
        resolutionOptions: [{ action: "MODIFY_CART", label: "Change the order", metadata: { rule: decision.ruleId } }],
      });
    } else {
      const publicLines = lines.map(({ sku, name, qty, unitCents }) => ({ sku, name, qty, unitCents }));
      const totalCents = publicLines.reduce((sum, line) => sum + line.unitCents * line.qty, 0);
      const signedAt = new Date().toISOString();
      const body = { currency: "EUR" as const, lines: publicLines, totalCents };
      cart = { ...body, signature: signBody({ ...body, signedAt }), signedAt };
    }
  }

  const answer = [
    ...notes,
    cart ? `Cart signed for ${money(cart.totalCents)} EUR.` : null,
    issues.length && !cart ? issues.map((issue) => issue.userMessage).join(" ") : null,
  ]
    .filter(Boolean)
    .join(" ");

  return { issues, lines, answer: answer || "Nothing matched the board.", decision, cart, intent };
}

function toLine(product: ProductRow, qty: number): CartLine {
  return {
    sku: product.sku,
    name: product.name,
    qty,
    unitCents: product.priceCents,
    allergens: product.allergens,
    leadHours: product.leadHours,
  };
}

function quoteOf(resolved: Resolution): QuoteBody {
  return {
    status: resolved.cart ? "READY" : "INCOMPLETE",
    answer: resolved.answer,
    issues: resolved.issues,
    cart: resolved.cart,
    intent: resolved.intent,
  };
}

export async function quoteShop(query: string, agentName: string, useAlternatives = false): Promise<Action> {
  const resolved = await resolve(query, useAlternatives, true);
  const sql = await getSql();
  await logEvent(sql, agentName, "asked", query.slice(0, 240));
  const snapshot = await loadSnapshot();
  return {
    ok: Boolean(resolved.cart),
    summary: resolved.answer,
    snapshot,
    quote: quoteOf(resolved),
  };
}

export async function placeShop(input: {
  query: string;
  agentName: string;
  notes?: string;
  useAlternatives?: boolean;
}): Promise<Action> {
  const resolved = await resolve(input.query, Boolean(input.useAlternatives), false);
  const sql = await getSql();
  if (!resolved.cart || !resolved.decision?.ok) {
    if (resolved.decision && !resolved.decision.ok && resolved.lines.length) {
      const total = resolved.lines.reduce((sum, line) => sum + line.unitCents * line.qty, 0);
      const id = crypto.randomUUID();
      await sql`insert into orders
        (id, shop_id, status, total_cents, currency, lines_json, notes, intent_json, mode, blocked_rule, agent_name)
        values (
          ${id}, ${SHOP}, ${"blocked"}, ${total}, ${"EUR"}, ${JSON.stringify(resolved.lines)}::jsonb,
          ${input.notes ?? ""}, ${JSON.stringify(resolved.intent)}::jsonb, ${sandboxMode()},
          ${resolved.decision.ruleId}, ${input.agentName}
        )`;
      await logEvent(sql, input.agentName, "blocked", resolved.decision.reason);
    }
    return {
      ok: false,
      summary: resolved.answer,
      snapshot: await loadSnapshot(),
      quote: quoteOf(resolved),
    };
  }

  if (input.notes && /\b(discount|coupon|staff\s*\d+)\b/i.test(input.notes)) {
    const blocked = authorize({
      rules: (await loadSnapshot()).shop.rules,
      lines: resolved.lines,
      notes: input.notes,
      recentOrders: 0,
    });
    if (!blocked.ok) {
      const id = crypto.randomUUID();
      await sql`insert into orders
        (id, shop_id, status, total_cents, currency, lines_json, notes, mode, blocked_rule, agent_name)
        values (
          ${id}, ${SHOP}, ${"blocked"}, ${resolved.cart.totalCents}, ${"EUR"},
          ${JSON.stringify(resolved.cart.lines)}::jsonb, ${input.notes}, ${sandboxMode()},
          ${blocked.ruleId}, ${input.agentName}
        )`;
      await logEvent(sql, input.agentName, "blocked", blocked.reason);
      return { ok: false, summary: blocked.reason, snapshot: await loadSnapshot(), quote: quoteOf(resolved) };
    }
  }

  const orderId = crypto.randomUUID();
  const creds = getSandboxCreds();
  let paypalOrderId = `REPLAY-${orderId.slice(0, 8).toUpperCase()}`;
  let approve: string | null = null;
  const mode = creds ? "live" : "replay";
  if (creds) {
    const created = await createCheckout({ creds, orderId, lines: resolved.cart.lines });
    if (!created.ok || !created.body.id) {
      return { ok: false, summary: created.ok ? "PayPal did not return an order id." : created.summary, snapshot: await loadSnapshot(), quote: quoteOf(resolved) };
    }
    paypalOrderId = created.body.id;
    approve = approvalUrl(created.body);
  }

  await sql`insert into orders
    (id, shop_id, status, total_cents, currency, lines_json, notes, intent_json, cart_signature, paypal_order_id, mode, agent_name)
    values (
      ${orderId}, ${SHOP}, ${"awaiting_approval"}, ${resolved.cart.totalCents}, ${"EUR"},
      ${JSON.stringify(resolved.cart.lines)}::jsonb, ${input.notes ?? ""}, ${JSON.stringify(resolved.intent)}::jsonb,
      ${resolved.cart.signature}, ${paypalOrderId}, ${mode}, ${input.agentName}
    )`;

  const summary = mode === "live"
    ? "PayPal order created. The buyer still has to approve it."
    : "Replay order created. Capture stays on this side of PayPal until sandbox keys are connected.";
  return {
    ok: true,
    summary,
    snapshot: await loadSnapshot(),
    quote: quoteOf(resolved),
    orderId,
    approveUrl: approve,
  };
}

export async function captureShop(orderId: string): Promise<Action> {
  const sql = await getSql();
  const rows = await sql<Record<string, unknown>>`select * from orders where id = ${orderId} and shop_id = ${SHOP}`;
  const order = rows[0];
  if (!order) return { ok: false, summary: "No such order.", snapshot: await loadSnapshot() };
  if (order.status === "captured" || order.status === "refunded") {
    return { ok: true, summary: "Already captured.", snapshot: await loadSnapshot(), orderId };
  }
  const creds = getSandboxCreds();
  const paypalOrderId = String(order.paypal_order_id ?? "");
  if (creds && !paypalOrderId.startsWith("REPLAY-")) {
    const current = await readCheckout(creds, paypalOrderId);
    if (!current.ok) return { ok: false, summary: current.summary, snapshot: await loadSnapshot(), orderId };
    if (current.body.status === "CREATED") {
      return {
        ok: false,
        summary: "PayPal is still waiting for the Personal sandbox buyer to approve.",
        snapshot: await loadSnapshot(),
        orderId,
        approveUrl: approvalUrl(current.body),
      };
    }
    let captureId = captureIdOf(current.body);
    if (current.body.status === "APPROVED" || !captureId) {
      const captured = await captureCheckout(creds, paypalOrderId);
      if (!captured.ok) return { ok: false, summary: captured.summary, snapshot: await loadSnapshot(), orderId };
      captureId = captureIdOf(captured.body);
    }
    if (!captureId) return { ok: false, summary: "PayPal captured the order but did not return a capture id.", snapshot: await loadSnapshot(), orderId };
    const receipt = signBody({ orderId, paypalOrderId, captureId });
    await sql`update orders set status = 'captured', paypal_capture_id = ${captureId}, cart_signature = ${receipt}, mode = 'live' where id = ${orderId}`;
    await logEvent(sql, String(order.agent_name), "captured", captureId);
    return { ok: true, summary: `Captured ${captureId}.`, snapshot: await loadSnapshot(), orderId };
  }

  const captureId = `REPLAY-CAP-${orderId.slice(0, 8).toUpperCase()}`;
  const receipt = signBody({ orderId, paypalOrderId, captureId, replay: true });
  await sql`update orders set status = 'captured', paypal_capture_id = ${captureId}, cart_signature = ${receipt}, mode = 'replay' where id = ${orderId}`;
  await logEvent(sql, String(order.agent_name), "captured", captureId);
  return {
    ok: true,
    summary: `Replay capture ${captureId}. Not a PayPal capture.`,
    snapshot: await loadSnapshot(),
    orderId,
  };
}

export async function trackShop(orderId: string): Promise<Action> {
  const sql = await getSql();
  const rows = await sql<Record<string, unknown>>`select * from orders where id = ${orderId} and shop_id = ${SHOP}`;
  const order = rows[0];
  if (!order) return { ok: false, summary: "No such order.", snapshot: await loadSnapshot() };
  if (order.status !== "captured" && order.status !== "tracked") {
    return { ok: false, summary: "Capture the order before adding pickup tracking.", snapshot: await loadSnapshot(), orderId };
  }
  const lines = asLines(order.lines_json);
  const trackingNumber = `AWNING-${String(orderId).slice(0, 8).toUpperCase()}`;
  const creds = getSandboxCreds();
  const paypalOrderId = String(order.paypal_order_id ?? "");
  const captureId = String(order.paypal_capture_id ?? "");
  if (creds && !paypalOrderId.startsWith("REPLAY-") && !captureId.startsWith("REPLAY-")) {
    const tracked = await trackCheckout({ creds, paypalOrderId, captureId, trackingNumber, lines });
    if (!tracked.ok) return { ok: false, summary: tracked.summary, snapshot: await loadSnapshot(), orderId };
    const trackerId = tracked.body.purchase_units?.[0]?.shipping?.trackers?.[0]?.id ?? trackingNumber;
    await sql`update orders set status = 'tracked', tracking_number = ${trackingNumber}, tracker_id = ${trackerId} where id = ${orderId}`;
    return { ok: true, summary: `Tracking ${trackerId}.`, snapshot: await loadSnapshot(), orderId };
  }
  const trackerId = `REPLAY-TRK-${trackingNumber}`;
  await sql`update orders set status = 'tracked', tracking_number = ${trackingNumber}, tracker_id = ${trackerId}, mode = 'replay' where id = ${orderId}`;
  return { ok: true, summary: `Replay tracking ${trackerId}.`, snapshot: await loadSnapshot(), orderId };
}

export async function refundShop(orderId: string): Promise<Action> {
  const sql = await getSql();
  const rows = await sql<Record<string, unknown>>`select * from orders where id = ${orderId} and shop_id = ${SHOP}`;
  const order = rows[0];
  if (!order) return { ok: false, summary: "No such order.", snapshot: await loadSnapshot() };
  if (!order.paypal_capture_id || order.status === "blocked" || order.status === "awaiting_approval") {
    return { ok: false, summary: "Only a captured order can be refunded.", snapshot: await loadSnapshot(), orderId };
  }
  const creds = getSandboxCreds();
  const captureId = String(order.paypal_capture_id);
  if (creds && !captureId.startsWith("REPLAY-")) {
    const refunded = await refundCapture(creds, captureId, Number(order.total_cents), String(order.currency));
    if (!refunded.ok) return { ok: false, summary: refunded.summary, snapshot: await loadSnapshot(), orderId };
    await sql`update orders set status = 'refunded' where id = ${orderId}`;
    return { ok: true, summary: `Refund ${refunded.body.id ?? ""} ${refunded.body.status ?? "sent"}.`.trim(), snapshot: await loadSnapshot(), orderId };
  }
  await sql`update orders set status = 'refunded', mode = 'replay' where id = ${orderId}`;
  return { ok: true, summary: "Replay refund. PayPal was not called.", snapshot: await loadSnapshot(), orderId };
}

export async function saveRules(text: string): Promise<Action> {
  const rules = compileRules(text);
  if (rules.length === 0) {
    return {
      ok: false,
      summary: "Couldn't turn that into a rule. Try: 24 hours' notice for cakes, max 10 per order, no discounts.",
      snapshot: await loadSnapshot(),
    };
  }
  const sql = await getSql();
  await sql`update shops set rules_json = ${JSON.stringify(rules)}::jsonb where id = ${SHOP}`;
  return { ok: true, summary: "Rules saved. Code enforces them from here.", snapshot: await loadSnapshot() };
}

export async function updateProduct(input: {
  id: string;
  name?: string;
  priceCents?: number;
  leadHours?: number;
  stock?: number;
  available?: boolean;
}): Promise<Action> {
  const name = input.name?.trim();
  if (name != null && (name.length < 1 || name.length > 80)) {
    return { ok: false, summary: "Name looks wrong.", snapshot: await loadSnapshot() };
  }
  if (input.priceCents != null && (input.priceCents < 0 || input.priceCents > 1_000_000)) {
    return { ok: false, summary: "Price is out of range.", snapshot: await loadSnapshot() };
  }
  const sql = await getSql();
  const current = await sql<{ name: string; price_cents: number; lead_hours: number; stock: number; available: boolean }>`
    select name, price_cents, lead_hours, stock, available from products where id = ${input.id} and shop_id = ${SHOP}`;
  const row = current[0];
  if (!row) return { ok: false, summary: "No such item.", snapshot: await loadSnapshot() };
  await sql`update products set
    name = ${name ?? row.name},
    price_cents = ${input.priceCents ?? Number(row.price_cents)},
    lead_hours = ${input.leadHours ?? Number(row.lead_hours)},
    stock = ${input.stock ?? Number(row.stock)},
    available = ${input.available ?? Boolean(row.available)}
    where id = ${input.id} and shop_id = ${SHOP}`;
  return { ok: true, summary: "Catalog updated.", snapshot: await loadSnapshot() };
}

function skuFor(name: string, taken: Set<string>): string {
  const base = name.toUpperCase().replace(/[^A-Z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 18) || "ITEM";
  let sku = base;
  let n = 2;
  while (taken.has(sku)) sku = `${base.slice(0, 14)}-${n++}`;
  return sku;
}

export async function commitReading(items: BoardItem[]): Promise<Action> {
  const sql = await getSql();
  await ensureShop(sql);
  const snapshot = await loadSnapshot();
  const lines = diffBoard(snapshot.products, items);
  const taken = new Set(snapshot.products.map((product) => product.sku));
  for (const item of items) {
    const current = snapshot.products.find((product) => normName(product.name) === normName(item.name));
    if (!current) {
      const sku = skuFor(item.name, taken);
      taken.add(sku);
      await insertProduct(sql, crypto.randomUUID(), sku, item, null);
      continue;
    }
    await sql`update products set
      price_cents = ${item.priceCents},
      available = ${item.available},
      stock = ${item.available ? Math.max(current.stock, 1) : 0},
      lead_hours = ${item.leadHours},
      allergens = ${JSON.stringify(item.allergens.length ? item.allergens : current.allergens)}::jsonb,
      detail = ${item.detail || current.detail}
      where id = ${current.id}`;
  }
  const summary = lines.length ? `Board updated. ${lines.length} change${lines.length === 1 ? "" : "s"}.` : "The board matches the catalog.";
  return { ok: true, summary, lines, snapshot: await loadSnapshot() };
}

export async function previewReading(items: BoardItem[]): Promise<Action> {
  const snapshot = await loadSnapshot();
  const lines = diffBoard(snapshot.products, items);
  return {
    ok: true,
    summary: lines.length ? `${lines.length} change${lines.length === 1 ? "" : "s"} on the board.` : "No changes.",
    lines,
    snapshot,
  };
}

export async function readUploadedBoard(dataUrl: string): Promise<Action> {
  try {
    const items = await readMenuPhoto(dataUrl);
    const preview = await previewReading(items);
    return { ...preview, items };
  } catch (error) {
    return {
      ok: false,
      summary: error instanceof Error ? error.message : "Could not read that photo.",
      snapshot: await loadSnapshot(),
    };
  }
}

export async function goLive(): Promise<Action> {
  const sql = await getSql();
  const snapshot = await loadSnapshot();
  const creds = getSandboxCreds();
  const failures: string[] = [];
  for (const product of snapshot.products) {
    if (!product.available) continue;
    if (creds) {
      if (product.paypalProductId && !product.paypalProductId.startsWith("REPLAY-")) continue;
      const created = await createCatalogProduct(creds, product);
      if (!created.ok || !created.body.id) {
        failures.push(`${product.name}: ${created.ok ? "no id" : created.summary}`);
        continue;
      }
      await sql`update products set paypal_product_id = ${created.body.id} where id = ${product.id}`;
    } else if (!product.paypalProductId) {
      await sql`update products set paypal_product_id = ${`REPLAY-${product.sku}`} where id = ${product.id}`;
    }
  }
  await sql`update shops set live = true where id = ${SHOP}`;
  if (failures.length) {
    return { ok: false, summary: failures.join(" "), snapshot: await loadSnapshot() };
  }
  const mode = sandboxMode();
  return {
    ok: true,
    summary: mode === "live"
      ? "Live. Each item has a PayPal product id. Prices stay in Awning."
      : "Replay. Product ids are local. Connect sandbox keys to call create_product.",
    snapshot: await loadSnapshot(),
  };
}

export async function addFromGap(gapId: string): Promise<Action> {
  const sql = await getSql();
  const gaps = await sql<{ id: string; query: string; status: string }>`
    select id, query, status from demand_gaps where id = ${gapId} and shop_id = ${SHOP}`;
  const gap = gaps[0];
  if (!gap) return { ok: false, summary: "That gap is gone.", snapshot: await loadSnapshot() };
  if (gap.status === "filled") return { ok: true, summary: "Already on the board.", snapshot: await loadSnapshot() };
  const snapshot = await loadSnapshot();
  const name = titleQuery(gap.query);
  const existing = snapshot.products.find((product) => normName(product.name) === normName(name));
  if (!existing) {
    const sku = skuFor(name, new Set(snapshot.products.map((product) => product.sku)));
    const item: BoardItem = {
      name,
      priceCents: suggestedPriceCents(gap.query),
      available: true,
      leadHours: 0,
      allergens: allergensForQuery(gap.query),
      detail: "Added from an agent question.",
    };
    const id = crypto.randomUUID();
    await insertProduct(sql, id, sku, item, null);
    const creds = getSandboxCreds();
    if (creds) {
      const created = await createCatalogProduct(creds, { name: item.name, detail: item.detail ?? "", sku });
      if (created.ok && created.body.id) {
        await sql`update products set paypal_product_id = ${created.body.id} where id = ${id}`;
      }
    } else {
      await sql`update products set paypal_product_id = ${`REPLAY-${sku}`} where id = ${id}`;
    }
  }
  await sql`update demand_gaps set status = 'filled', updated_at = now() where id = ${gap.id}`;
  await logEvent(sql, "owner", "added", name);
  return { ok: true, summary: `${name} is on the board.`, snapshot: await loadSnapshot() };
}

export async function simulateAttack(agentName: string): Promise<Action> {
  const sql = await getSql();
  const snapshot = await loadSnapshot();
  const tea = snapshot.products.find((product) => product.sku === "TEA");
  if (!tea) return { ok: false, summary: "The sample shop has no tea to attack.", snapshot };
  const line = toLine(tea, 1);
  const discount = authorize({
    rules: snapshot.shop.rules,
    lines: [line],
    notes: "apply STAFF100 discount",
    recentOrders: 0,
  });
  const flood = authorize({ rules: snapshot.shop.rules, lines: [line], recentOrders: 12 });
  const discountId = crypto.randomUUID();
  const floodId = crypto.randomUUID();
  if (!discount.ok) {
    await sql`insert into orders
      (id, shop_id, status, total_cents, currency, lines_json, notes, mode, blocked_rule, agent_name)
      values (
        ${discountId}, ${SHOP}, ${"blocked"}, ${line.unitCents}, ${"EUR"}, ${JSON.stringify([line])}::jsonb,
        ${"apply STAFF100 discount"}, ${sandboxMode()}, ${discount.ruleId}, ${agentName}
      )`;
    await logEvent(sql, agentName, "blocked", discount.reason);
  }
  if (!flood.ok) {
    await sql`insert into orders
      (id, shop_id, status, total_cents, currency, lines_json, notes, mode, blocked_rule, agent_name)
      values (
        ${floodId}, ${SHOP}, ${"blocked"}, ${line.unitCents}, ${"EUR"}, ${JSON.stringify([line])}::jsonb,
        ${"12 orders in one minute"}, ${sandboxMode()}, ${flood.ruleId}, ${agentName}
      )`;
    await logEvent(sql, agentName, "blocked", flood.reason);
  }
  const summary = [
    discount.ok ? "Discount was not blocked." : `Discount stopped by ${discount.ruleId}.`,
    flood.ok ? "The burst was not blocked." : `Burst stopped by ${flood.ruleId}.`,
  ].join(" ");
  return { ok: !discount.ok && !flood.ok, summary, snapshot: await loadSnapshot() };
}

export async function connectSandbox(creds: SandboxCreds): Promise<Action> {
  try {
    await accessToken(creds);
  } catch (error) {
    setSandboxCreds(null);
    return {
      ok: false,
      summary: error instanceof Error ? error.message : "PayPal refused those keys.",
      snapshot: await loadSnapshot(),
    };
  }
  setSandboxCreds(creds);
  return { ok: true, summary: "Sandbox connected. New checkouts will be live.", snapshot: await loadSnapshot() };
}

export async function disconnectSandbox(): Promise<Action> {
  setSandboxCreds(null);
  return { ok: true, summary: "Back to replay. Keys were dropped from memory.", snapshot: await loadSnapshot() };
}

export async function restoreSample(): Promise<Action> {
  const sql = await getSql();
  await ensureShop(sql);
  await sql`delete from agent_events where shop_id = ${SHOP}`;
  await sql`delete from demand_gaps where shop_id = ${SHOP}`;
  await sql`delete from orders where shop_id = ${SHOP}`;
  await sql`delete from products where shop_id = ${SHOP}`;
  const rules = JSON.stringify(compileRules("24 hours' notice for cakes, max 10 per order, no discounts, 8 orders a minute."));
  await sql`update shops set rules_json = ${rules}::jsonb, live = false, name = ${"Linden"} where id = ${SHOP}`;
  for (const row of SEED) await insertProduct(sql, row.id, row.sku, row.item, null);
  return { ok: true, summary: "Sample board restored.", snapshot: await loadSnapshot() };
}

export async function askStudio(question: string): Promise<Action> {
  const snapshot = await loadSnapshot();
  const open = snapshot.gaps.filter((gap) => gap.status === "open");
  const ledger = open.length
    ? open.map((gap) => `Agents asked for ${gap.query} ${gap.asks} time${gap.asks === 1 ? "" : "s"}.`).join(" ")
    : "No open gaps. Agents are finding what you sell.";
  const apiKey = process.env.XAI_API_KEY;
  if (!apiKey || !question.trim()) {
    return { ok: true, summary: ledger, answer: ledger, source: "ledger", snapshot };
  }
  try {
    const response = await fetch("https://api.x.ai/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "grok-4.5",
        max_tokens: 180,
        messages: [
          {
            role: "user",
            content: `You are the shop ledger for Linden, a café. Answer in two sentences, no hype. Question: ${question}\nOpen gaps: ${JSON.stringify(open)}\nRecent blocked: ${JSON.stringify(snapshot.blocked.slice(0, 5))}`,
          },
        ],
      }),
      signal: AbortSignal.timeout(20000),
    });
    if (!response.ok) return { ok: true, summary: ledger, answer: ledger, source: "ledger", snapshot };
    const body = (await response.json()) as { choices?: { message?: { content?: string } }[] };
    const answer = body.choices?.[0]?.message?.content?.trim() || ledger;
    return { ok: true, summary: answer, answer, source: "grok", snapshot };
  } catch {
    return { ok: true, summary: ledger, answer: ledger, source: "ledger", snapshot };
  }
}

export async function menuForAgent() {
  const snapshot = await loadSnapshot();
  return {
    shop: snapshot.shop.name,
    currency: "EUR",
    note: "Prices live in Awning. PayPal product ids do not carry a price.",
    items: snapshot.products.map((product) => ({
      sku: product.sku,
      name: product.name,
      price: money(product.priceCents),
      available: product.available,
      lead_hours: product.leadHours,
      allergens: product.allergens,
      paypal_product_id: product.paypalProductId,
    })),
  };
}

export async function orderStatus(orderId: string) {
  const snapshot = await loadSnapshot();
  const order = snapshot.orders.find((row) => row.id === orderId || row.paypalOrderId === orderId);
  if (!order) return { ok: false as const, summary: "No such order." };
  return { ok: true as const, order };
}
