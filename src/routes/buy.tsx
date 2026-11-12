import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { Button, Card, Mode, Note } from "@/components/bits";
import { Shell } from "@/components/shell";
import { askShop, capturePayment, placeOrder } from "@/lib/awning.functions";
import { SAMPLE_ASK } from "@/lib/boards";
import { euros } from "@/lib/money";
import { useShop } from "@/lib/use-shop";
import type { QuoteBody } from "@/lib/shop.server";

export const Route = createFileRoute("/buy")({ component: BuyerPage });

function BuyerPage() {
  const { snapshot, pending, error, apply } = useShop();
  const [query, setQuery] = useState(SAMPLE_ASK);
  const [quote, setQuote] = useState<QuoteBody | null>(null);
  const [note, setNote] = useState("");
  const [orderId, setOrderId] = useState("");
  const [approveUrl, setApproveUrl] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [useAlt, setUseAlt] = useState(false);

  async function ask(alternatives: boolean) {
    setBusy(true);
    setUseAlt(alternatives);
    try {
      const result = await askShop({ data: { query, agentName: "buyer", useAlternatives: alternatives } });
      apply(result.snapshot);
      setQuote(result.quote ?? null);
      setNote(result.summary);
    } catch (err) {
      setNote(err instanceof Error ? err.message : "The shop didn't answer.");
    } finally {
      setBusy(false);
    }
  }

  if (pending || !snapshot) {
    return (
      <Shell>
        <p className="text-muted">{error || "Opening the buyer…"}</p>
      </Shell>
    );
  }

  return (
    <Shell>
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-3xl">Buyer</h1>
        <Mode mode={snapshot.mode} />
      </div>
      <Note>
        This is an in-app agent, so a judge without an MCP client can still buy. Outside clients use the shop
        endpoint. The intent mandate is signed before the cart.
      </Note>
      <Card className="flex flex-col gap-3">
        <label className="flex flex-col gap-2 text-sm text-muted">
          What should the agent ask for?
          <textarea
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            className="min-h-28 rounded-lg border border-line bg-bg px-3 py-2 text-fg"
          />
        </label>
        <Button disabled={busy} onClick={() => void ask(false)}>
          Ask Linden
        </Button>
        {quote?.intent ? (
          <p className="break-all font-mono text-xs text-muted">
            Intent mandate {quote.intent.nutFree ? "nut-free" : "any"}{" "}
            {quote.intent.maxCents != null ? `cap ${euros(quote.intent.maxCents)}` : "no cap"} {quote.intent.signature}
          </p>
        ) : null}
        {quote?.issues.map((issue) => (
          <div key={`${issue.code}-${issue.message}`} className="rounded-lg border border-line px-3 py-2 text-sm">
            <p>{issue.userMessage}</p>
            <p className="font-mono text-xs text-muted">
              {issue.code}
              {issue.resolutionOptions.map((option) => ` · ${option.action}`).join("")}
            </p>
          </div>
        ))}
        {quote?.issues.some((issue) => issue.resolutionOptions.some((option) => option.action === "SUGGEST_ALTERNATIVE")) ? (
          <Button tone="quiet" disabled={busy} onClick={() => void ask(true)}>
            Accept the alternative and ask again
          </Button>
        ) : null}
        {quote?.cart ? (
          <div className="flex flex-col gap-2">
            <p>{quote.cart.lines.map((line) => `${line.qty} × ${line.name}`).join(", ")}</p>
            <p className="font-medium">{euros(quote.cart.totalCents)}</p>
            <p className="break-all font-mono text-xs text-muted">Cart mandate {quote.cart.signature}</p>
            <Button
              disabled={busy}
              onClick={() =>
                void (async () => {
                  setBusy(true);
                  try {
                    const result = await placeOrder({
                      data: { query, agentName: "buyer", useAlternatives: useAlt },
                    });
                    apply(result.snapshot);
                    setNote(result.summary);
                    setOrderId(result.orderId ?? "");
                    setApproveUrl(result.approveUrl ?? null);
                    setQuote(result.quote ?? quote);
                  } finally {
                    setBusy(false);
                  }
                })()
              }
            >
              Place order
            </Button>
          </div>
        ) : null}
        {approveUrl ? (
          <a href={approveUrl} target="_blank" rel="noreferrer" className="text-primary underline">
            Approve in PayPal as the Personal sandbox buyer
          </a>
        ) : null}
        {orderId ? (
          <Button
            tone="quiet"
            disabled={busy}
            onClick={() =>
              void (async () => {
                setBusy(true);
                try {
                  const result = await capturePayment({ data: { orderId } });
                  apply(result.snapshot);
                  setNote(result.summary);
                  setApproveUrl(result.approveUrl ?? approveUrl);
                } finally {
                  setBusy(false);
                }
              })()
            }
          >
            Capture
          </Button>
        ) : null}
        {note ? <Note>{note}</Note> : null}
      </Card>
    </Shell>
  );
}
