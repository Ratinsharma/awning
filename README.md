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
7. Capture, add pickup tracking, refund.
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

## License

MIT.
