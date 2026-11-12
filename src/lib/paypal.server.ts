import { createHash } from "node:crypto";

const SANDBOX = "https://api-m.sandbox.paypal.com";

export type SandboxCreds = { clientId: string; secret: string };

type Fail = { ok: false; summary: string };
type Ok<T> = { ok: true; body: T };

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

export async function createCatalogProduct(
  creds: SandboxCreds,
  product: { name: string; detail: string; sku: string },
): Promise<Ok<{ id?: string }> | Fail> {
  return paypal(`/v1/catalogs/products`, creds, {
    method: "POST",
    requestId: `awning-product-${product.sku}`,
    body: {
      name: product.name.slice(0, 127),
      description: (product.detail || product.name).slice(0, 256),
      type: "PHYSICAL",
      home_url: "https://example.com/shops/linden",
    },
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
}): Promise<Ok<OrderBody> | Fail> {
  const total = input.lines.reduce((sum, line) => sum + line.unitCents * line.qty, 0);
  return paypal<OrderBody>("/v2/checkout/orders", input.creds, {
    method: "POST",
    requestId: `awning-order-${input.orderId}`,
    body: {
      intent: "CAPTURE",
      purchase_units: [
        {
          reference_id: input.orderId.slice(0, 256),
          custom_id: input.orderId.slice(0, 127),
          description: "Linden via Awning",
          amount: {
            currency_code: "EUR",
            value: money(total),
            breakdown: { item_total: { currency_code: "EUR", value: money(total) } },
          },
          items: input.lines.map((line) => ({
            name: line.name.slice(0, 127),
            sku: line.sku.slice(0, 127),
            quantity: String(line.qty),
            category: "PHYSICAL_GOODS",
            unit_amount: { currency_code: "EUR", value: money(line.unitCents) },
          })),
          shipping: {
            name: { full_name: "Pickup Guest" },
            address: {
              address_line_1: "1 Grafton Street",
              admin_area_2: "Dublin",
              admin_area_1: "Dublin",
              postal_code: "D02 AF30",
              country_code: "IE",
            },
          },
        },
      ],
      payment_source: {
        paypal: {
          experience_context: {
            brand_name: "Awning",
            user_action: "PAY_NOW",
            shipping_preference: "SET_PROVIDED_ADDRESS",
            return_url: "https://example.com/awning/return",
            cancel_url: "https://example.com/awning/cancel",
          },
        },
      },
    },
  });
}

export async function readCheckout(creds: SandboxCreds, paypalOrderId: string) {
  return paypal<OrderBody>(`/v2/checkout/orders/${encodeURIComponent(paypalOrderId)}`, creds);
}

export async function captureCheckout(creds: SandboxCreds, paypalOrderId: string) {
  return paypal<OrderBody>(`/v2/checkout/orders/${encodeURIComponent(paypalOrderId)}/capture`, creds, {
    method: "POST",
    requestId: `awning-capture-${paypalOrderId}`,
    body: {},
  });
}

export async function trackCheckout(input: {
  creds: SandboxCreds;
  paypalOrderId: string;
  captureId: string;
  trackingNumber: string;
  lines: { name: string; sku: string; qty: number }[];
}) {
  return paypal<OrderBody>(`/v2/checkout/orders/${encodeURIComponent(input.paypalOrderId)}/track`, input.creds, {
    method: "POST",
    requestId: `awning-track-${input.captureId}`,
    body: {
      capture_id: input.captureId,
      tracking_number: input.trackingNumber,
      carrier: "OTHER",
      carrier_name_other: "Pickup",
      notify_payer: false,
      items: input.lines.map((line) => ({
        name: line.name,
        sku: line.sku,
        quantity: String(line.qty),
      })),
    },
  });
}

export async function refundCapture(creds: SandboxCreds, captureId: string, cents: number, currency: string) {
  const created = await paypal<{ id?: string; status?: string }>(
    `/v2/payments/captures/${encodeURIComponent(captureId)}/refund`,
    creds,
    {
      method: "POST",
      requestId: `awning-refund-${captureId}`,
      body: {
        amount: { currency_code: currency, value: money(cents) },
        note_to_payer: "Awning refund",
      },
    },
  );
  if (!created.ok || !created.body.id) return created;
  const read = await paypal<{ id?: string; status?: string }>(
    `/v2/payments/refunds/${encodeURIComponent(created.body.id)}`,
    creds,
  );
  return read.ok ? read : created;
}
