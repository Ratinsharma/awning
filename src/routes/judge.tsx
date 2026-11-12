import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { Button, Card, ApprovalCard, Mode, Note } from "@/components/bits";
import { Shell } from "@/components/shell";
import {
  addGap,
  approveOwnerStep,
  askShop,
  capturePayment,
  commitBoard,
  placeOrder,
  publishShop,
  refundPayment,
  restoreShop,
  runAttack,
  trackPickup,
} from "@/lib/awning.functions";
import { RESYNC_BOARD, SAMPLE_ASK } from "@/lib/boards";
import { diffBoard } from "@/lib/diff";
import { euros } from "@/lib/money";
import { wrapUntrusted } from "@/lib/untrusted";
import { useShop } from "@/lib/use-shop";

export const Route = createFileRoute("/judge")({ component: JudgePage });

const CAKE = "Vanilla birthday cake, pickup in 1 hour";

function JudgePage() {
  const { snapshot, pending, error, apply } = useShop();
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [diff, setDiff] = useState<string[]>([]);
  const waiting = snapshot?.orders.find((order) => order.status === "awaiting_approval");
  const refundable = snapshot?.orders.find((order) => order.status === "captured" || order.status === "tracked");
  const approvals = snapshot?.orders.filter((order) => order.status === "owner_review" || order.status === "refund_proposed") ?? [];

  async function go<T extends { ok: boolean; summary: string; snapshot: NonNullable<typeof snapshot> }>(
    task: () => Promise<T>,
  ) {
    setBusy(true);
    try {
      const result = await task();
      apply(result.snapshot);
      setNote(result.summary);
      return result;
    } catch (err) {
      setNote(err instanceof Error ? err.message : "That step failed.");
      return null;
    } finally {
      setBusy(false);
    }
  }

  if (pending || !snapshot) {
    return (
      <Shell>
        <p className="text-muted">{error || "Preparing the tour…"}</p>
      </Shell>
    );
  }

  return (
    <Shell>
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="font-mono text-xs uppercase tracking-widest text-primary">Judge tour</p>
          <h1 className="text-3xl">One loop, on the record.</h1>
        </div>
        <Mode mode={snapshot.mode} />
      </div>
      <Note>
        Every button calls the same shop the buyer and the MCP endpoint use. Replay ids are not PayPal captures.
        Connect sandbox keys on the shop page first if you want the live path.
      </Note>
      {approvals.map((order) => (
        <ApprovalCard
          key={order.id}
          busy={busy}
          title={order.status === "refund_proposed" ? "Refund" : "Over the limit"}
          detail={`${euros(order.totalCents)} · ${order.lines.map((line) => `${line.qty} ${line.name}`).join(", ")}${
            order.blockedRule ? ` · Rules check stopped on ${order.blockedRule}.` : " · Rules check: a captured order can be refunded."
          }${order.notes ? ` ${wrapUntrusted(order.notes)}` : ""}`}
          onApprove={() => void go(() => approveOwnerStep({ data: { orderId: order.id } }))}
        />
      ))}

      <img src="/boards/opening.jpg" alt="Opening Linden chalkboard" className="w-full rounded-2xl border border-line" />

      <Card className="flex flex-col gap-3">
        <h2 className="text-xl">1. Sample board</h2>
        <Button disabled={busy} onClick={() => void go(() => restoreShop())}>
          Restore Linden
        </Button>
      </Card>

      <Card className="flex flex-col gap-3">
        <h2 className="text-xl">2. A cake with one hour's notice</h2>
        <Note>The rule is in code, not in the prompt.</Note>
        <Button
          tone="quiet"
          disabled={busy}
          onClick={() => void go(() => askShop({ data: { query: CAKE, agentName: "judge" } }))}
        >
          Ask for the cake
        </Button>
      </Card>

      <Card className="flex flex-col gap-3">
        <h2 className="text-xl">3. Publish</h2>
        <Button tone="quiet" disabled={busy} onClick={() => void go(() => publishShop())}>
          Go live
        </Button>
      </Card>

      <Card className="flex flex-col gap-3">
        <h2 className="text-xl">4. Ask for what isn't sold</h2>
        <p className="text-sm text-muted">{SAMPLE_ASK}</p>
        <Button
          disabled={busy}
          onClick={() => void go(() => askShop({ data: { query: SAMPLE_ASK, agentName: "judge" } }))}
        >
          Ask the agent question
        </Button>
      </Card>

      <Card className="flex flex-col gap-3">
        <h2 className="text-xl">5. Add the gap</h2>
        <Button
          disabled={busy}
          onClick={() => {
            const gap = snapshot.gaps.find((row) => row.status === "open" && row.query.includes("brownie"));
            if (!gap) {
              setNote("Ask first. The brownie gap is not on the ledger yet.");
              return;
            }
            void go(() => addGap({ data: { gapId: gap.id } }));
          }}
        >
          Add the brownie
        </Button>
      </Card>

      <Card className="flex flex-col gap-3">
        <h2 className="text-xl">6. Same agent buys</h2>
        <Note>Tea is the alternative for the flat white. The brownie is now on the board.</Note>
        <Button
          disabled={busy}
          onClick={() =>
            void go(() => placeOrder({ data: { query: SAMPLE_ASK, agentName: "judge", useAlternatives: true } }))
          }
        >
          Place that order
        </Button>
        {waiting ? <p className="break-all font-mono text-xs text-muted">{waiting.paypalOrderId}</p> : null}
      </Card>

      <Card className="flex flex-col gap-3">
        <h2 className="text-xl">7. Capture, track, refund</h2>
        <Note>A refund and an order over the limit wait on the approval card. One tap sends them to PayPal.</Note>
        <div className="flex flex-wrap gap-2">
          <Button
            tone="quiet"
            disabled={busy || !waiting}
            onClick={() => waiting && void go(() => capturePayment({ data: { orderId: waiting.id } }))}
          >
            Capture payment
          </Button>
          <Button
            tone="quiet"
            disabled={busy || !refundable}
            onClick={() => refundable && void go(() => trackPickup({ data: { orderId: refundable.id } }))}
          >
            Add tracking
          </Button>
          <Button
            tone="quiet"
            disabled={busy || !refundable}
            onClick={() => refundable && void go(() => refundPayment({ data: { orderId: refundable.id } }))}
          >
            Propose refund
          </Button>
          <Button
            tone="quiet"
            disabled={busy}
            onClick={() => void go(() => placeOrder({ data: { query: "12 pots of tea", agentName: "judge" } }))}
          >
            Propose 12 teas
          </Button>
        </div>
      </Card>

      <Card className="flex flex-col gap-3">
        <h2 className="text-xl">8. Rogue agent</h2>
        <Note>A discount code, then a burst. Both should stop on a named rule.</Note>
        <Button tone="quiet" disabled={busy} onClick={() => void go(() => runAttack({ data: { agentName: "rogue" } }))}>
          Run the attack
        </Button>
      </Card>

      <Card className="flex flex-col gap-3">
        <h2 className="text-xl">9. Photograph the board again</h2>
        <img src="/boards/resync.jpg" alt="Later Linden chalkboard, soup crossed out" className="w-full rounded-xl border border-line" />
        <Button
          tone="quiet"
          disabled={busy}
          onClick={() => setDiff(diffBoard(snapshot.products, RESYNC_BOARD).map(lineText))}
        >
          Compare
        </Button>
        {diff.map((line) => (
          <p key={line} className="text-sm">
            {line}
          </p>
        ))}
        <Button disabled={busy || diff.length === 0} onClick={() => void go(() => commitBoard({ data: { items: RESYNC_BOARD } }))}>
          Apply the later board
        </Button>
      </Card>

      {note ? (
        <Card>
          <p className="leading-relaxed">{note}</p>
          {snapshot.orders[0] ? (
            <p className="mt-2 break-all font-mono text-xs text-muted">
              Latest {snapshot.orders[0].status} {snapshot.orders[0].paypalOrderId}{" "}
              {snapshot.orders[0].paypalCaptureId ?? ""} {euros(snapshot.orders[0].totalCents)}
            </p>
          ) : null}
        </Card>
      ) : null}
    </Shell>
  );
}

function lineText(line: ReturnType<typeof diffBoard>[number]): string {
  if (line.kind === "price") return `${line.name}: ${euros(line.fromCents)} to ${euros(line.toCents)}`;
  if (line.kind === "sold_out") return `${line.name} sold out`;
  if (line.kind === "restocked") return `${line.name} back`;
  return `${line.name} added at ${euros(line.priceCents)}`;
}
