import { createFileRoute } from "@tanstack/react-router";
import type { CellValueChangedEvent, ColDef } from "ag-grid-community";
import { useEffect, useMemo, useState } from "react";
import QRCode from "qrcode";
import { Button, Card, Mode, Note } from "@/components/bits";
import { Ledger } from "@/components/grids";
import { Shell } from "@/components/shell";
import { RESYNC_BOARD } from "@/lib/boards";
import { diffBoard, type DiffLine } from "@/lib/diff";
import { euros } from "@/lib/money";
import { previewPathPrefix } from "@/lib/preview-path-prefix";
import { DEFAULT_RULE_TEXT, ruleLabel } from "@/lib/rules";
import {
  addGap,
  askLedger,
  commitBoard,
  connectPayPal,
  disconnectPayPal,
  publishShop,
  readBoard,
  refundPayment,
  saveProduct,
  saveShopRules,
  trackPickup,
} from "@/lib/awning.functions";
import { forgetCreds, rememberCreds, useShop } from "@/lib/use-shop";
import type { Action, GapRow, OrderRow, ProductRow } from "@/lib/shop.server";

export const Route = createFileRoute("/shop")({ component: ShopPage });

type Tab = "board" | "orders" | "demand" | "sandbox";

function describe(line: DiffLine): string {
  if (line.kind === "price") return `${line.name}: ${euros(line.fromCents)} to ${euros(line.toCents)}`;
  if (line.kind === "sold_out") return `${line.name} is crossed out`;
  if (line.kind === "restocked") return `${line.name} is back`;
  return `Add ${line.name} at ${euros(line.priceCents)}`;
}

function ShopPage() {
  const { snapshot, error, pending, apply } = useShop();
  const [tab, setTab] = useState<Tab>("board");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [rules, setRules] = useState(DEFAULT_RULE_TEXT);
  const [diff, setDiff] = useState<DiffLine[] | null>(null);
  const [pendingItems, setPendingItems] = useState<typeof RESYNC_BOARD | null>(null);
  const [question, setQuestion] = useState("What did agents ask for that I don't sell?");
  const [answer, setAnswer] = useState("");
  const [qr, setQr] = useState("");
  const [clientId, setClientId] = useState("");
  const [secret, setSecret] = useState("");

  const endpoint = useMemo(() => {
    if (typeof window === "undefined") return "/shops/linden/mcp";
    const prefix = previewPathPrefix(window.location.hostname, window.location.pathname) ?? "";
    return `${window.location.origin}${prefix}/shops/linden/mcp`;
  }, []);

  useEffect(() => {
    void QRCode.toDataURL(endpoint, { margin: 1, width: 180, color: { dark: "#121410", light: "#f4f0e6" } }).then(setQr);
  }, [endpoint]);

  async function run(task: () => Promise<Action>) {
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

  const columns = useMemo<ColDef<ProductRow & { priceEuros: number }>[]>(
    () => [
      { field: "name", headerName: "Item", editable: true, flex: 1.4, pinned: "left" },
      { field: "priceEuros", headerName: "EUR", editable: true, width: 110 },
      { field: "leadHours", headerName: "Hours", editable: true, width: 110 },
      { field: "stock", headerName: "Stock", editable: true, width: 100 },
      { field: "available", headerName: "On board", editable: true, width: 120 },
      {
        field: "allergens",
        headerName: "Allergens",
        flex: 1,
        valueFormatter: (params) => (params.value as string[] | undefined)?.join(", ") || "—",
      },
      { field: "paypalProductId", headerName: "PayPal", flex: 1 },
    ],
    [],
  );

  const gapColumns = useMemo<ColDef<GapRow>[]>(
    () => [
      { field: "query", headerName: "Asked for", flex: 1.4, pinned: "left" },
      { field: "asks", headerName: "Asks", width: 100 },
      { field: "status", headerName: "Status", width: 120 },
      {
        headerName: "",
        width: 110,
        sortable: false,
        cellRenderer: (params: { data?: GapRow }) => {
          if (!params.data || params.data.status === "filled") return "Added";
          return "Add";
        },
        onCellClicked: (event) => {
          const gap = event.data;
          if (!gap || gap.status === "filled" || busy) return;
          void run(() => addGap({ data: { gapId: gap.id } }));
        },
      },
    ],
    [busy],
  );

  if (pending || !snapshot) {
    return (
      <Shell>
        <p className="text-muted">{error || "Opening the shop…"}</p>
      </Shell>
    );
  }

  const rows = snapshot.products.map((product) => ({ ...product, priceEuros: product.priceCents / 100 }));

  async function onEdit(event: CellValueChangedEvent<ProductRow & { priceEuros: number }>) {
    const field = event.colDef.field;
    const id = event.data.id;
    if (!field) return;
    const patch: { id: string; name?: string; priceCents?: number; leadHours?: number; stock?: number; available?: boolean } = { id };
    if (field === "name") patch.name = String(event.newValue ?? "");
    if (field === "priceEuros") patch.priceCents = Math.round(Number(event.newValue) * 100);
    if (field === "leadHours") patch.leadHours = Number(event.newValue);
    if (field === "stock") patch.stock = Number(event.newValue);
    if (field === "available") patch.available = Boolean(event.newValue);
    await run(() => saveProduct({ data: patch }));
  }

  async function shrink(file: File) {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, 1280 / bitmap.width);
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Could not read that photo.");
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL("image/jpeg", 0.82);
  }

  return (
    <Shell>
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-3xl">{snapshot.shop.name}</h1>
          <p className="text-sm text-muted">Sample café. Edit the board, then go live.</p>
        </div>
        <Mode mode={snapshot.mode} />
      </div>
      <div className="flex gap-2 overflow-x-auto">
        {(
          [
            ["board", "Board"],
            ["orders", "Orders"],
            ["demand", "Demand"],
            ["sandbox", "Sandbox"],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            type="button"
            onClick={() => setTab(id)}
            className={`min-h-11 shrink-0 rounded-lg px-3 text-sm ${tab === id ? "bg-primary text-bg" : "text-muted"}`}
          >
            {label}
          </button>
        ))}
      </div>
      {note ? <Note>{note}</Note> : null}

      {tab === "board" ? (
        <>
          <img src="/boards/opening.jpg" alt="Opening chalkboard for Linden" className="w-full rounded-2xl border border-line" />
          <Card className="flex flex-col gap-3">
            <h2 className="text-xl">Catalog</h2>
            <Note>Prices live here. PayPal only stores the product id.</Note>
            <Ledger rows={rows} columns={columns} empty="The board is empty." onCellValueChanged={(event) => void onEdit(event)} />
            <div className="flex flex-wrap gap-2">
              {snapshot.shop.rules.map((rule) => (
                <span key={rule.id} className="rounded-full border border-line px-3 py-1 text-sm text-fg">
                  {ruleLabel(rule)}
                </span>
              ))}
            </div>
            <label className="flex flex-col gap-2 text-sm text-muted">
              Rules, in plain language
              <textarea
                value={rules}
                onChange={(event) => setRules(event.target.value)}
                className="min-h-24 rounded-lg border border-line bg-bg px-3 py-2 text-fg"
              />
            </label>
            <Button tone="quiet" disabled={busy} onClick={() => void run(() => saveShopRules({ data: { text: rules } }))}>
              Save rules
            </Button>
            <label className="flex min-h-11 cursor-pointer items-center justify-center rounded-lg border border-line px-4 text-sm">
              Photograph a board
              <input
                type="file"
                accept="image/*"
                capture="environment"
                className="sr-only"
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  if (!file) return;
                  void (async () => {
                    setBusy(true);
                    try {
                      const dataUrl = await shrink(file);
                      const result = await readBoard({ data: { dataUrl } });
                      apply(result.snapshot);
                      setDiff(result.lines ?? []);
                      setPendingItems(result.items ?? null);
                      setNote(result.summary);
                    } catch (err) {
                      setNote(err instanceof Error ? err.message : "Could not read that photo.");
                    } finally {
                      setBusy(false);
                    }
                  })();
                }}
              />
            </label>
            <img src="/boards/resync.jpg" alt="Later chalkboard: scone up, soup crossed out" className="w-full rounded-xl border border-line" />
            <Button
              tone="quiet"
              disabled={busy}
              onClick={() => {
                setPendingItems(RESYNC_BOARD);
                setDiff(diffBoard(snapshot.products, RESYNC_BOARD));
                setNote("Later board compared. Apply it when the diff looks right.");
              }}
            >
              Compare the later chalkboard
            </Button>
          </Card>
        </>
      ) : null}

      {tab === "orders" ? (
        <div className="flex flex-col gap-3">
          {snapshot.orders.length === 0 ? <Note>No orders yet. The buyer and the judge tour create them.</Note> : null}
          {snapshot.orders.map((order) => (
            <OrderCard key={order.id} order={order} busy={busy} onRun={run} />
          ))}
        </div>
      ) : null}

      {tab === "demand" ? (
        <>
          <Card className="flex flex-col gap-3">
            <h2 className="text-xl">Demand gaps</h2>
            <Note>What agents asked for and did not find. One tap adds it and calls create_product.</Note>
            <Ledger rows={snapshot.gaps} columns={gapColumns} empty="No unanswered asks yet." />
          </Card>
          <Card className="flex flex-col gap-3">
            <h2 className="text-xl">Agents</h2>
            <Ledger
              rows={snapshot.agents}
              columns={[
                { field: "agentName", headerName: "Agent", flex: 1, pinned: "left" },
                { field: "asks", headerName: "Asks", width: 100 },
                { field: "blocked", headerName: "Blocked", width: 120 },
                { field: "captured", headerName: "Captured", width: 120 },
              ]}
              empty="No agent traffic yet."
            />
          </Card>
          <Card className="flex flex-col gap-3">
            <h2 className="text-xl">Blocked</h2>
            <Ledger
              rows={snapshot.blocked}
              columns={[
                { field: "reason", headerName: "Rule", flex: 1, pinned: "left" },
                { field: "notes", headerName: "Note", flex: 1.2 },
                { field: "createdAt", headerName: "When", flex: 1 },
              ]}
              empty="Nothing blocked."
            />
            <label className="flex flex-col gap-2 text-sm text-muted">
              Ask the ledger
              <input
                value={question}
                onChange={(event) => setQuestion(event.target.value)}
                className="min-h-11 rounded-lg border border-line bg-bg px-3 text-fg"
              />
            </label>
            <Button
              tone="quiet"
              disabled={busy}
              onClick={() =>
                void (async () => {
                  setBusy(true);
                  try {
                    const result = await askLedger({ data: { question } });
                    apply(result.snapshot);
                    setAnswer(result.answer ?? result.summary);
                    setNote(result.source === "grok" ? "Answered by the model." : "Answered from the ledger.");
                  } finally {
                    setBusy(false);
                  }
                })()
              }
            >
              Ask
            </Button>
            {answer ? <p className="leading-relaxed">{answer}</p> : null}
          </Card>
        </>
      ) : null}

      {tab === "sandbox" || tab === "board" ? (
        <Card className="flex flex-col gap-3">
          {tab === "board" ? <h2 className="text-xl">Go live</h2> : <h2 className="text-xl">PayPal sandbox</h2>}
          <Note>
            Keys stay in this browser and in server memory. They are not written to the database. Replay is the
            honest label until a token succeeds.
          </Note>
          {tab === "sandbox" ? (
            <>
              <input
                value={clientId}
                onChange={(event) => setClientId(event.target.value)}
                placeholder="Client ID"
                autoComplete="off"
                className="min-h-11 rounded-lg border border-line bg-bg px-3 font-mono text-sm text-fg"
              />
              <input
                value={secret}
                onChange={(event) => setSecret(event.target.value)}
                placeholder="Secret"
                type="password"
                autoComplete="new-password"
                className="min-h-11 rounded-lg border border-line bg-bg px-3 font-mono text-sm text-fg"
              />
              <div className="flex flex-wrap gap-2">
                <Button
                  disabled={busy}
                  onClick={() =>
                    void (async () => {
                      const result = await run(() => connectPayPal({ data: { clientId, secret } }));
                      if (result?.ok) {
                        rememberCreds(clientId, secret);
                        setSecret("");
                      }
                    })()
                  }
                >
                  Connect sandbox
                </Button>
                <Button
                  tone="quiet"
                  disabled={busy}
                  onClick={() =>
                    void (async () => {
                      forgetCreds();
                      await run(() => disconnectPayPal());
                    })()
                  }
                >
                  Use replay
                </Button>
              </div>
            </>
          ) : null}
          <Button disabled={busy} onClick={() => void run(() => publishShop())}>
            Go live
          </Button>
          <div className="flex items-center gap-3">
            {qr ? <img src={qr} alt="QR code for the Linden agent endpoint" className="h-28 w-28 rounded-lg bg-fg" /> : null}
            <div className="min-w-0">
              <p className="text-sm text-muted">Agent endpoint</p>
              <p className="break-all font-mono text-xs">{endpoint}</p>
            </div>
          </div>
        </Card>
      ) : null}

      {diff && diff.length > 0 ? (
        <Card className="flex flex-col gap-2">
          <h2 className="text-xl">Board diff</h2>
          <ul className="flex flex-col gap-1 text-sm">
            {diff.map((line) => (
              <li key={`${line.kind}-${line.name}`}>{describe(line)}</li>
            ))}
          </ul>
          {pendingItems ? (
            <Button
              disabled={busy}
              onClick={() =>
                void (async () => {
                  const result = await run(() => commitBoard({ data: { items: pendingItems } }));
                  if (result?.ok) {
                    setDiff(result.lines ?? []);
                    setPendingItems(null);
                  }
                })()
              }
            >
              Apply to the catalog
            </Button>
          ) : null}
        </Card>
      ) : null}
    </Shell>
  );
}

function OrderCard({
  order,
  busy,
  onRun,
}: {
  order: OrderRow;
  busy: boolean;
  onRun: (task: () => Promise<Action>) => Promise<unknown>;
}) {
  return (
    <Card className="flex flex-col gap-2">
      <div className="flex items-center justify-between gap-2">
        <p className="font-medium">{euros(order.totalCents)}</p>
        <Mode mode={order.mode} />
      </div>
      <p className="text-sm text-muted">
        {order.status} · {order.agentName}
        {order.blockedRule ? ` · stopped by ${order.blockedRule}` : ""}
      </p>
      <p className="text-sm">{order.lines.map((line) => `${line.qty} ${line.name}`).join(", ")}</p>
      {order.notes ? <p className="font-mono text-xs text-muted">{order.notes}</p> : null}
      <p className="break-all font-mono text-xs text-muted">
        {order.paypalOrderId}
        {order.paypalCaptureId ? ` · ${order.paypalCaptureId}` : ""}
        {order.trackerId ? ` · ${order.trackerId}` : ""}
      </p>
      {order.cartSignature ? <p className="break-all font-mono text-xs text-muted">Receipt {order.cartSignature}</p> : null}
      <div className="flex flex-wrap gap-2">
        {order.paypalCaptureId && order.status !== "refunded" ? (
          <Button tone="quiet" disabled={busy} onClick={() => void onRun(() => trackPickup({ data: { orderId: order.id } }))}>
            Add pickup tracking
          </Button>
        ) : null}
        {order.paypalCaptureId && order.status !== "refunded" && order.status !== "blocked" ? (
          <Button tone="quiet" disabled={busy} onClick={() => void onRun(() => refundPayment({ data: { orderId: order.id } }))}>
            Refund
          </Button>
        ) : null}
      </div>
    </Card>
  );
}
