import { createHash } from "node:crypto";
import { paypalRequestId, totalsMatch } from "./paypal-id";
import {
  restCaptureOrder,
  restCreateOrder,
  restCreateProduct,
  restReadRefund,
  restRefundCapture,
  restTrackOrder,
  restVaultSetup,
  type RestOrder,
} from "./paypal-rest";
import { runLocalToolkit } from "./paypal-toolkit.server";

const SANDBOX = "https://api-m.sandbox.paypal.com";

export type SandboxCreds = { clientId: string; secret: string };

type Fail = { ok: false; summary: string };
type Ok<T> = { ok: true; body: T };
type MoneyTool = "create_order" | "pay_order" | "create_refund" | "create_product" | "create_shipment_tracking" | "vault";

const globalRef = globalThis as typeof globalThis & {
  __awningCreds?: SandboxCreds;
  __awningToken?: { key: string; token: string; exp: number };
};

export function sandboxMode(): "live" | "replay" {
  return globalRef.__awningCreds ? "live" : "replay";
}

export function setSandboxCreds(creds: SandboxCreds | null) {
  globalRef.__awningCreds = creds ?? undefined;
  if (!creds) globalRef.__awningToken = undefined;
}

export function getSandboxCreds(): SandboxCreds | null {
  return globalRef.__awningCreds ?? null;
}

export function money(cents: number): string {
  return (cents / 100).toFixed(2);
}

async function paypal<T>(
  path: string,
  creds: SandboxCreds,
  init?: { method?: string; body?: unknown; requestId?: string },
): Promise<Ok<T> | Fail> {
  let token: string;
  try {
    token = await accessToken(creds);
  } catch (error) {
    return { ok: false, summary: error instanceof Error ? error.message : "PayPal token failed." };
  }
  let response: Response;
  try {
    response = await fetch(`${SANDBOX}${path}`, {
      method: init?.method ?? "GET",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        ...(init?.requestId ? { "PayPal-Request-Id": init.requestId } : {}),
      },
      body: init?.body === undefined ? undefined : JSON.stringify(init.body),
      signal: AbortSignal.timeout(20000),
    });
  } catch {
    return { ok: false, summary: "Could not reach PayPal sandbox." };
  }
  const text = await response.text();
  let body: unknown = null;
  if (text) {
    try {
      body = JSON.parse(text);
    } catch {
      body = { message: text.slice(0, 240) };
    }
  }
  if (!response.ok) return { ok: false, summary: explain(response.status, body) };
  return { ok: true, body: body as T };
}

function explain(status: number, body: unknown): string {
  if (!body || typeof body !== "object") return `PayPal returned HTTP ${status}.`;
  const record = body as {
    name?: string;
    message?: string;
    details?: { issue?: string; description?: string }[];
  };
  const issue = record.details?.[0];
  return [status, record.name, issue?.issue, issue?.description || record.message]
    .filter(Boolean)
    .join(" — ");
}

export async function accessToken(creds: SandboxCreds): Promise<string> {
  const key = createHash("sha256").update(`${creds.clientId}:${creds.secret}`).digest("hex");
  const cached = globalRef.__awningToken;
  if (cached && cached.key === key && cached.exp > Date.now()) return cached.token;
  const response = await fetch(`${SANDBOX}/v1/oauth2/token`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${btoa(`${creds.clientId}:${creds.secret}`)}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: "grant_type=client_credentials",
    signal: AbortSignal.timeout(20000),
  });
  const body = (await response.json().catch(() => null)) as { access_token?: string; error_description?: string } | null;
  if (!response.ok || !body?.access_token) {
    throw new Error(body?.error_description || "PayPal refused those sandbox keys.");
  }
  globalRef.__awningToken = { key, token: body.access_token, exp: Date.now() + 8 * 60 * 1000 };
  return body.access_token;
}

async function callMoney<T>(input: {
  creds: SandboxCreds;
  runId: string;
  toolName: MoneyTool;
  args: unknown;
  rest: (requestId: string) => Promise<Ok<T> | Fail>;
}): Promise<Ok<T> | Fail> {
  const requestId = paypalRequestId(input.runId, input.toolName, input.args);
  if (input.toolName !== "vault") {
    let token: string;
    try {
      token = await accessToken(input.creds);
    } catch (error) {
      return { ok: false, summary: error instanceof Error ? error.message : "PayPal token failed." };
    }
    const viaToolkit = await runLocalToolkit({
      token,
      toolName: input.toolName,
      args: input.args,
      requestId,
    });
    if (viaToolkit.ok) return { ok: true, body: viaToolkit.body as T };
  }
  return input.rest(requestId);
}

export async function createCatalogProduct(
  creds: SandboxCreds,
  product: { name: string; detail: string; sku: string },
): Promise<Ok<{ id?: string }> | Fail> {
  const args = {
    name: product.name.slice(0, 127),
    type: "PHYSICAL",
    description: (product.detail || product.name).slice(0, 256),
    home_url: "https://example.com/shops/linden",
  };
  return callMoney({
    creds,
    runId: product.sku,
    toolName: "create_product",
    args,
    rest: (requestId) => restCreateProduct(creds, requestId, product),
  });
}

type OrderBody = {
  id?: string;
  status?: string;
  links?: { href?: string; rel?: string }[];
  purchase_units?: {
    payments?: { captures?: { id?: string }[] };
    shipping?: { trackers?: { id?: string }[] };
  }[];
};

export function approvalUrl(order: OrderBody): string | null {
  const links = order.links ?? [];
  return (
    links.find((link) => link.rel === "payer-action")?.href ??
    links.find((link) => link.rel === "approve")?.href ??
    null
  );
}

export function captureIdOf(order: OrderBody): string | null {
  return order.purchase_units?.[0]?.payments?.captures?.[0]?.id ?? null;
}

export async function createCheckout(input: {
  creds: SandboxCreds;
  orderId: string;
  lines: { name: string; sku: string; qty: number; unitCents: number }[];
  totalCents: number;
}): Promise<Ok<OrderBody> | Fail> {
  if (!totalsMatch(input.lines, input.totalCents)) {
    return { ok: false, summary: "Order total does not match quantity × price." };
  }
  const args = {
    currencyCode: "EUR",
    items: input.lines.map((line) => ({
      name: line.name,
      quantity: line.qty,
      description: line.sku,
      itemCost: line.unitCents / 100,
      taxPercent: 0,
      itemTotal: (line.unitCents * line.qty) / 100,
    })),
    discount: 0,
    shippingCost: 0,
  };
  const created = await callMoney<RestOrder>({
    creds: input.creds,
    runId: input.orderId,
    toolName: "create_order",
    args,
    rest: (requestId) =>
      restCreateOrder(input.creds, requestId, {
        orderId: input.orderId,
        lines: input.lines,
        totalCents: input.totalCents,
      }),
  });
  if (!created.ok) return created;
  return { ok: true, body: asOrder(created.body) };
}

export async function readCheckout(creds: SandboxCreds, paypalOrderId: string) {
  return paypal<OrderBody>(`/v2/checkout/orders/${encodeURIComponent(paypalOrderId)}`, creds);
}

export async function captureCheckout(creds: SandboxCreds, paypalOrderId: string): Promise<Ok<OrderBody> | Fail> {
  const args = { id: paypalOrderId };
  const captured = await callMoney<RestOrder>({
    creds,
    runId: paypalOrderId,
    toolName: "pay_order",
    args,
    rest: (requestId) => restCaptureOrder(creds, requestId, paypalOrderId),
  });
  if (!captured.ok) return captured;
  return { ok: true, body: asOrder(captured.body) };
}

export async function trackCheckout(input: {
  creds: SandboxCreds;
  paypalOrderId: string;
  captureId: string;
  trackingNumber: string;
  lines: { name: string; sku: string; qty: number }[];
}): Promise<Ok<OrderBody> | Fail> {
  const args = {
    order_id: input.paypalOrderId,
    transaction_id: input.captureId,
    tracking_number: input.trackingNumber,
    status: "SHIPPED",
    carrier: "OTHER",
  };
  const tracked = await callMoney<RestOrder>({
    creds: input.creds,
    runId: input.captureId,
    toolName: "create_shipment_tracking",
    args,
    rest: (requestId) => restTrackOrder(input.creds, requestId, input),
  });
  if (!tracked.ok) return tracked;
  return { ok: true, body: asOrder(tracked.body) };
}

export async function refundCapture(creds: SandboxCreds, captureId: string, cents: number, currency: string) {
  const args = {
    capture_id: captureId,
    amount: { currency_code: currency, value: money(cents) },
    note_to_payer: "Awning refund",
  };
  const created = await callMoney<{ id?: string; status?: string }>({
    creds,
    runId: captureId,
    toolName: "create_refund",
    args,
    rest: (requestId) => restRefundCapture(creds, requestId, { captureId, cents, currency }),
  });
  if (!created.ok || !created.body.id) return created;
  const read = await restReadRefund(creds, created.body.id);
  return read.ok ? read : created;
}

export async function openVault(creds: SandboxCreds, runId: string) {
  const args = { usage: "MERCHANT", description: "Linden regular" };
  return callMoney({
    creds,
    runId,
    toolName: "vault",
    args,
    rest: (requestId) => restVaultSetup(creds, requestId),
  });
}

export async function chargeVault(input: {
  creds: SandboxCreds;
  runId: string;
  orderId: string;
  vaultId: string;
  lines: { name: string; sku: string; qty: number; unitCents: number }[];
  totalCents: number;
}) {
  if (!totalsMatch(input.lines, input.totalCents)) {
    return { ok: false as const, summary: "Order total does not match quantity × price." };
  }
  const args = { vaultId: input.vaultId, totalCents: input.totalCents, currency: "EUR" };
  const created = await callMoney<RestOrder>({
    creds: input.creds,
    runId: input.runId,
    toolName: "vault",
    args,
    rest: (requestId) =>
      restCreateOrder(input.creds, requestId, {
        orderId: input.orderId,
        lines: input.lines,
        totalCents: input.totalCents,
        vaultId: input.vaultId,
      }),
  });
  if (!created.ok) return created;
  return { ok: true as const, body: asOrder(created.body) };
}

function asOrder(body: unknown): OrderBody {
  if (!body || typeof body !== "object") return {};
  const row = body as {
    id?: string;
    status?: string;
    links?: { href?: string; rel?: string }[];
    purchase_units?: OrderBody["purchase_units"];
    purchaseUnits?: {
      payments?: { captures?: { id?: string }[] };
      shipping?: { trackers?: { id?: string }[] };
    }[];
  };
  const units = row.purchase_units ?? row.purchaseUnits;
  return {
    id: row.id,
    status: row.status,
    links: row.links,
    purchase_units: units,
  };
}
