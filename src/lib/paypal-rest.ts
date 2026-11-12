import {
  CheckoutPaymentIntent,
  Client,
  Environment,
  ItemCategory,
  OrdersController,
  PaymentsController,
  PaypalExperienceUserAction,
  PaypalPaymentTokenUsageType,
  PaypalWalletContextShippingPreference,
  VaultController,
  type Order,
} from "@paypal/paypal-server-sdk";
import type { SandboxCreds } from "./paypal.server";

/**
 * Direct REST fallback. The Orders, Payments, and Vault calls use
 * `@paypal/paypal-server-sdk` 2.0.0, the APIMatic-generated client the PayPal
 * Context Plugin documents. Every call is pinned to the sandbox host below.
 * Pickup tracking and catalog products use that same host because the generated
 * tracking method cannot send PayPal-Request-Id or a pickup carrier of OTHER.
 */
export const SANDBOX = "https://api-m.sandbox.paypal.com";

type Fail = { ok: false; summary: string };
type Ok<T> = { ok: true; body: T };

export type RestOrder = {
  id?: string;
  status?: string;
  links?: { href?: string; rel?: string }[];
  purchase_units?: {
    payments?: { captures?: { id?: string }[] };
    shipping?: { trackers?: { id?: string }[] };
  }[];
};

type Line = { name: string; sku: string; qty: number; unitCents: number };

function clientFor(creds: SandboxCreds) {
  return new Client({
    clientCredentialsAuthCredentials: {
      oAuthClientId: creds.clientId,
      oAuthClientSecret: creds.secret,
    },
    timeout: 20000,
    environment: Environment.Sandbox,
  });
}

function fail(error: unknown): Fail {
  if (error && typeof error === "object") {
    const record = error as { statusCode?: number; result?: unknown; message?: string };
    if (record.result !== undefined || record.statusCode) {
      return { ok: false, summary: explain(record.statusCode ?? 0, record.result) };
    }
  }
  return { ok: false, summary: error instanceof Error ? error.message : "PayPal sandbox call failed." };
}

function explain(status: number, body: unknown): string {
  if (!body || typeof body !== "object") return `PayPal returned HTTP ${status}.`;
  const record = body as { name?: string; message?: string; details?: { issue?: string; description?: string }[] };
  const issue = record.details?.[0];
  return [status, record.name, issue?.issue, issue?.description || record.message].filter(Boolean).join(" — ");
}

function money(cents: number): string {
  return (cents / 100).toFixed(2);
}

function fromOrder(order: Order): RestOrder {
  return {
    id: order.id,
    status: order.status,
    links: order.links?.map((link) => ({ href: link.href, rel: link.rel })),
    purchase_units: order.purchaseUnits?.map((unit) => ({
      payments: {
        captures: unit.payments?.captures?.map((capture) => ({ id: capture.id })),
      },
    })),
  };
}

const PICKUP = {
  name: { fullName: "Pickup Guest" },
  address: {
    addressLine1: "1 Grafton Street",
    adminArea2: "Dublin",
    adminArea1: "Dublin",
    postalCode: "D02 AF30",
    countryCode: "IE",
  },
};

export async function restCreateOrder(
  creds: SandboxCreds,
  requestId: string,
  input: { orderId: string; lines: Line[]; totalCents: number; vaultId?: string; storeInVault?: boolean },
): Promise<Ok<RestOrder> | Fail> {
  const total = money(input.totalCents);
  const paypal = input.vaultId
    ? { vaultId: input.vaultId }
    : {
        experienceContext: {
          brandName: "Awning",
          userAction: PaypalExperienceUserAction.PayNow,
          shippingPreference: PaypalWalletContextShippingPreference.SetProvidedAddress,
          returnUrl: "https://example.com/awning/return",
          cancelUrl: "https://example.com/awning/cancel",
        },
        ...(input.storeInVault
          ? {
              attributes: {
                vault: {
                  usageType: PaypalPaymentTokenUsageType.Merchant,
                  description: "Linden regular",
                },
              },
            }
          : {}),
      };
  try {
    const orders = new OrdersController(clientFor(creds));
    const response = await orders.createOrder({
      paypalRequestId: requestId,
      prefer: "return=representation",
      body: {
        intent: CheckoutPaymentIntent.Capture,
        purchaseUnits: [
          {
            referenceId: input.orderId.slice(0, 256),
            customId: input.orderId.slice(0, 127),
            description: "Linden via Awning",
            amount: {
              currencyCode: "EUR",
              value: total,
              breakdown: { itemTotal: { currencyCode: "EUR", value: total } },
            },
            items: input.lines.map((line) => ({
              name: line.name.slice(0, 127),
              sku: line.sku.slice(0, 127),
              quantity: String(line.qty),
              category: ItemCategory.PhysicalGoods,
              unitAmount: { currencyCode: "EUR", value: money(line.unitCents) },
            })),
            shipping: PICKUP,
          },
        ],
        paymentSource: { paypal },
      },
    });
    return { ok: true, body: fromOrder(response.result) };
  } catch (error) {
    return fail(error);
  }
}

export async function restCaptureOrder(
  creds: SandboxCreds,
  requestId: string,
  paypalOrderId: string,
): Promise<Ok<RestOrder> | Fail> {
  try {
    const orders = new OrdersController(clientFor(creds));
    const response = await orders.captureOrder({
      id: paypalOrderId,
      paypalRequestId: requestId,
      prefer: "return=representation",
      body: {},
    });
    return { ok: true, body: fromOrder(response.result) };
  } catch (error) {
    return fail(error);
  }
}

export async function restRefundCapture(
  creds: SandboxCreds,
  requestId: string,
  input: { captureId: string; cents: number; currency: string },
): Promise<Ok<{ id?: string; status?: string }> | Fail> {
  try {
    const payments = new PaymentsController(clientFor(creds));
    const response = await payments.refundCapturedPayment({
      captureId: input.captureId,
      paypalRequestId: requestId,
      body: {
        amount: { currencyCode: input.currency, value: money(input.cents) },
        noteToPayer: "Awning refund",
      },
    });
    return { ok: true, body: { id: response.result.id, status: response.result.status } };
  } catch (error) {
    return fail(error);
  }
}

export async function restReadRefund(
  creds: SandboxCreds,
  refundId: string,
): Promise<Ok<{ id?: string; status?: string }> | Fail> {
  try {
    const payments = new PaymentsController(clientFor(creds));
    const response = await payments.getRefund({ refundId });
    return { ok: true, body: { id: response.result.id, status: response.result.status } };
  } catch (error) {
    return fail(error);
  }
}

export async function restTrackOrder(
  creds: SandboxCreds,
  requestId: string,
  input: {
    paypalOrderId: string;
    captureId: string;
    trackingNumber: string;
    lines: { name: string; sku: string; qty: number }[];
  },
): Promise<Ok<RestOrder> | Fail> {
  const client = clientFor(creds);
  let token: string;
  try {
    token = (await client.clientCredentialsAuthManager.fetchToken()).accessToken;
  } catch (error) {
    return fail(error);
  }
  let response: Response;
  try {
    response = await fetch(`${SANDBOX}/v2/checkout/orders/${encodeURIComponent(input.paypalOrderId)}/track`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        "PayPal-Request-Id": requestId,
      },
      body: JSON.stringify({
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
      }),
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
  return { ok: true, body: snakeOrder(body) };
}

export async function restCreateProduct(
  creds: SandboxCreds,
  requestId: string,
  product: { name: string; detail: string },
): Promise<Ok<{ id?: string }> | Fail> {
  const client = clientFor(creds);
  let token: string;
  try {
    token = (await client.clientCredentialsAuthManager.fetchToken()).accessToken;
  } catch (error) {
    return fail(error);
  }
  let response: Response;
  try {
    response = await fetch(`${SANDBOX}/v1/catalogs/products`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        "PayPal-Request-Id": requestId,
      },
      body: JSON.stringify({
        name: product.name.slice(0, 127),
        description: (product.detail || product.name).slice(0, 256),
        type: "PHYSICAL",
        home_url: "https://example.com/shops/linden",
      }),
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
  const id = body && typeof body === "object" && "id" in body ? String((body as { id?: string }).id ?? "") : "";
  return { ok: true, body: { id: id || undefined } };
}

export async function restVaultSetup(
  creds: SandboxCreds,
  requestId: string,
): Promise<Ok<{ id?: string; status?: string }> | Fail> {
  try {
    const vault = new VaultController(clientFor(creds));
    const response = await vault.createSetupToken({
      paypalRequestId: requestId,
      body: {
        paymentSource: {
          paypal: {
            description: "Linden regular",
            usageType: PaypalPaymentTokenUsageType.Merchant,
          },
        },
      },
    });
    return { ok: true, body: { id: response.result.id, status: response.result.status } };
  } catch (error) {
    return fail(error);
  }
}

function snakeOrder(body: unknown): RestOrder {
  if (!body || typeof body !== "object") return {};
  const row = body as {
    id?: string;
    status?: string;
    links?: { href?: string; rel?: string }[];
    purchase_units?: RestOrder["purchase_units"];
  };
  return {
    id: row.id,
    status: row.status,
    links: row.links,
    purchase_units: row.purchase_units,
  };
}
