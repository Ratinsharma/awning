# Awning

A chalkboard café, open to AI agents, paid through PayPal.

Awning is the on-ramp for a shop that has no website and no catalog. It is not another "agent-ready storefront" pitch. The loop that matters: an agent asks for something that is not on the board, the owner adds it in one tap, and that same agent buys it.

Linden, the café in the demo, is sample data. It is not a claim that a real owner was filmed.

## Judge tour

Open the app and choose **Judge**. In order:

1. Restore the sample board.
2. Ask for a cake with one hour's notice. A rule blocks it.
3. Go live.
4. Ask for an oat-milk flat white and a gluten-free brownie.
5. Add the brownie from the demand gap.
6. Place the order. Tea is the alternative for the drink. The brownie is now real.
7. Capture, add pickup tracking, propose the refund, then approve it on the card. Propose 12 teas to see the same card for an order over the limit.
8. Run the rogue-agent attack. A discount code and a burst each stop on a named rule.
9. Compare the later chalkboard (scone price up, soup crossed out) and apply it.

Until sandbox keys are connected, captures are labelled **Replay**. Those ids are not PayPal payments.

## Agent endpoint

`/shops/linden/mcp` speaks MCP Streamable HTTP (official TypeScript SDK).

Tools: `browse_menu`, `ask`, `quote`, `place_order`, `order_status`.

`ask` and `quote` return Cart API v1-shaped `validation_issues` and `resolution_options` (`SUGGEST_ALTERNATIVE`, `REMOVE_ITEM`, `WAIT_FOR_RESTOCK`, `MODIFY_CART`). That is alignment with the shape, not a call to PayPal's hosted cart.

There is also an in-app buyer, so the loop works without an MCP client.

## PayPal

Sandbox only, and only after a Client ID and Secret are pasted on the shop's Sandbox tab. Keys are kept in browser session storage and in process memory. They are not written to the database or this repo.

| Moment | Call |
|---|---|
| Go live | `POST /v1/catalogs/products` |
| Checkout | `POST /v2/checkout/orders` |
| After approval | `GET /v2/checkout/orders/{id}` then `POST .../capture` |
| Pickup | `POST /v2/checkout/orders/{id}/track` |
| Refund | `POST /v2/payments/captures/{id}/refund` then `GET /v2/payments/refunds/{id}` |

Honest limits:

- Catalog products have no price field. Prices, stock, and allergens stay in Awning, linked by the PayPal product id.
- The demo shop checks out as one sandbox merchant. Production would onboard each shop as merchant of record.
- Intent and cart signatures follow the AP2 shape (cap, constraints, merchant-signed cart, buyer approval). This is not a certified AP2 implementation.
- Approve the live order as the **Personal** sandbox buyer, not the business app owner.

## Rules

Plain language is compiled into chips. From then on, `authorize()` enforces them. The model does not.

The sample sentence is: 24 hours' notice for cakes, max 10 per order, no discounts, 8 orders a minute.

## Stack

TanStack Start, React, Tailwind, AG Grid community (catalog, demand gaps, agent ledger, blocked attempts), PayPal REST sandbox, MCP.

```bash
npm install
npm run dev
```

## Before submission

The app runs the full loop without PayPal keys. Captures are labelled Replay. Those ids are not PayPal payments.

When the sandbox Client ID and Secret arrive, open **Shop**, choose **Sandbox**, paste them, and connect. Approve any live order as the **Personal** sandbox buyer, then capture. Keys stay in the browser session and in process memory. They are not stored in the database or this repository.

Do not describe Linden as a filmed owner. A real shop, a signed release, and a Devpost video are still yours to add. Lead with the demand-gap loop and the chalkboard re-sync. Do not claim a first agent-ready storefront.

## Engineering hardening

1. One `PayPal-Request-Id` per money-moving call. It is `sha256(runId + toolName + JSON.stringify(args))` on create order, capture, refund, create product, and tracking, so a retry cannot charge twice.
2. `@paypal/agent-toolkit` is pinned to an exact version (no `^`). `package-lock.json` is committed.
3. The toolkit runs locally in Node. Awning does not call PayPal's hosted sandbox MCP server.
4. `src/lib/paypal-rest.ts` is a direct REST fallback on `https://api-m.sandbox.paypal.com` for create order, capture, refund, tracking, and vault. If a toolkit call fails, Awning retries once through this client with the same request id. Orders, payments, and vault use `@paypal/paypal-server-sdk`, the APIMatic-generated client documented by the PayPal Context Plugin. The toolkit has no vault tool, so vault goes straight to this client.
5. Buyer-agent text is untrusted. It is wrapped in `<untrusted_input>` tags before it reaches a model or an agent response. It cannot trigger tools. Only zod-validated fields are passed to the rules engine.
6. Before an order is created, Awning checks that the sum of quantity × unit price, rounded to 2 decimals, equals the order total.
7. Refunds and orders over the limit stop on a one-tap approval card labelled "AI proposes → Rules check → Owner approves → PayPal confirms".

## Devpost

Awning hardens the money path before it asks PayPal to move funds: one `PayPal-Request-Id` from `sha256(runId + toolName + JSON.stringify(args))` on create order, capture, refund, create product, and tracking; `@paypal/agent-toolkit` pinned exactly with `package-lock.json` committed; the toolkit running locally in Node rather than on PayPal's hosted sandbox MCP server; a direct REST fallback in `src/lib/paypal-rest.ts` against `https://api-m.sandbox.paypal.com` for create order, capture, refund, tracking, and vault, generated from the APIMatic PayPal server SDK and retried once with the same request id if the toolkit fails; buyer-agent text wrapped in `<untrusted_input>` so it cannot trigger tools, with only zod-validated fields reaching the rules engine; an amount check that quantity × unit price, rounded to 2 decimals, equals the order total; and a one-tap owner card, "AI proposes → Rules check → Owner approves → PayPal confirms", for refunds and orders over the limit. The product itself is the on-ramp for a chalkboard café with no website: an agent asks for something that is not on the board, the owner adds it in one tap, and that same agent buys it. Linden is sample data, not a filmed owner. Give the engineering hardening about 10 seconds in the video, after the demand-gap loop and before the close.

## License

MIT.
