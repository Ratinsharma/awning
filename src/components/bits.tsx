import type { ButtonHTMLAttributes, ReactNode } from "react";

export function Button({
  tone = "primary",
  className = "",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { tone?: "primary" | "quiet" | "danger" }) {
  const look =
    tone === "primary"
      ? "bg-primary text-bg hover:opacity-90 active:opacity-80"
      : tone === "danger"
        ? "bg-danger text-bg hover:opacity-90 active:opacity-80"
        : "border border-line bg-transparent text-fg hover:bg-surface";
  return (
    <button
      {...props}
      className={`inline-flex min-h-11 items-center justify-center rounded-lg px-4 text-center text-sm font-medium transition-opacity disabled:opacity-50 ${look} ${className}`}
    />
  );
}

export function Card({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <section className={`rounded-2xl border border-line bg-surface p-4 ${className}`}>{children}</section>;
}

export function Mode({ mode }: { mode: "live" | "replay" }) {
  return (
    <span
      className={`rounded-full border px-2 py-1 font-mono text-xs uppercase tracking-wide ${
        mode === "live" ? "border-primary text-primary" : "border-line text-muted"
      }`}
    >
      {mode === "live" ? "Live" : "Replay"}
    </span>
  );
}

export function Note({ children }: { children: ReactNode }) {
  return <p className="text-sm leading-relaxed text-muted">{children}</p>;
}

export function Chip({ children }: { children: ReactNode }) {
  return (
    <span className="rounded-full border border-line px-3 py-1 text-sm text-fg">{children}</span>
  );
}

export function Skeleton({ className = "h-24" }: { className?: string }) {
  return <div className={`skeleton ${className}`} aria-hidden />;
}

export function Loading({ label = "Loading…" }: { label?: string }) {
  return (
    <div className="flex flex-col gap-3" role="status" aria-live="polite">
      <Skeleton className="h-8 w-40" />
      <Skeleton className="h-48" />
      <Skeleton className="h-16" />
      <p className="sr-only">{label}</p>
    </div>
  );
}

export const APPROVAL_STEPS = ["AI proposes", "Rules check", "Owner approves", "PayPal confirms"] as const;
export const APPROVAL_LABEL = APPROVAL_STEPS.join(" → ");

export function ApprovalCard({
  title,
  detail,
  busy,
  onApprove,
}: {
  title: string;
  detail: string;
  busy: boolean;
  onApprove: () => void;
}) {
  return (
    <Card className="flex flex-col gap-3 border-primary/40">
      <ol className="flex flex-wrap gap-1.5">
        {APPROVAL_STEPS.map((step, index) => (
          <li
            key={step}
            className={`rounded-full px-2.5 py-1 font-mono text-[11px] leading-tight ${
              index === 2 ? "bg-primary text-bg" : "border border-line text-muted"
            }`}
          >
            {index + 1}. {step}
          </li>
        ))}
      </ol>
      <h2 className="text-xl">{title}</h2>
      <p className="break-words text-sm leading-relaxed">{detail}</p>
      <Button disabled={busy} onClick={onApprove}>
        {busy ? "Approving…" : "Approve"}
      </Button>
    </Card>
  );
}