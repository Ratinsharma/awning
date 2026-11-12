import { createFileRoute, Link } from "@tanstack/react-router";
import { Shell } from "@/components/shell";

export const Route = createFileRoute("/")({ component: Home });

function Home() {
  return (
    <Shell>
      <p className="font-mono text-xs uppercase tracking-widest text-primary">Chalkboard to checkout</p>
      <h1 className="max-w-xl text-4xl leading-tight">Your chalkboard is the API.</h1>
      <p className="max-w-xl text-lg leading-relaxed text-muted">
        An agent asks Linden for something that is not on the board. You add it in one tap. The same agent buys it,
        and PayPal captures the payment.
      </p>
      <img
        src="/boards/opening.jpg"
        alt="Sample chalkboard for Linden, a café with no website"
        className="w-full rounded-2xl border border-line"
      />
      <ol className="grid gap-2 sm:grid-cols-3">
        {[
          ["1", "Ask", "An agent asks for something missing."],
          ["2", "Add", "One tap puts it on the board."],
          ["3", "Buy", "The same agent checks out."],
        ].map(([n, title, body]) => (
          <li key={n} className="rounded-2xl border border-line bg-surface p-3">
            <p className="font-mono text-xs text-primary">{n}</p>
            <p className="text-base">{title}</p>
            <p className="text-sm text-muted">{body}</p>
          </li>
        ))}
      </ol>
      <div className="flex flex-col gap-2 sm:flex-row">
        <Link
          to="/judge"
          className="inline-flex min-h-11 flex-1 items-center justify-center rounded-lg bg-primary px-4 text-sm font-medium text-bg"
        >
          Run the judge tour
        </Link>
        <Link
          to="/shop"
          className="inline-flex min-h-11 flex-1 items-center justify-center rounded-lg border border-line px-4 text-sm font-medium text-fg"
        >
          Open the shop
        </Link>
        <Link
          to="/buy"
          className="inline-flex min-h-11 flex-1 items-center justify-center rounded-lg border border-line px-4 text-sm font-medium text-fg"
        >
          Open the buyer
        </Link>
      </div>
      <p className="text-sm leading-relaxed text-muted">
        Linden is a sample café, not a filmed owner. Until sandbox keys are connected, money movement is labelled
        Replay. Prices stay in Awning. PayPal product records do not hold them. Mandates follow the AP2 shape and are
        not a certified implementation.
      </p>
    </Shell>
  );
}