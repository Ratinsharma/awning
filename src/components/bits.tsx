import type { ButtonHTMLAttributes, ReactNode } from "react";

export function Button({
  tone = "primary",
  className = "",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { tone?: "primary" | "quiet" | "danger" }) {
  const look =
    tone === "primary"
      ? "bg-primary text-bg"
      : tone === "danger"
        ? "bg-danger text-bg"
        : "border border-line bg-transparent text-fg";
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
    <span className="rounded-full border border-line px-2 py-1 font-mono text-xs uppercase tracking-wide text-primary">
      {mode === "live" ? "Live" : "Replay"}
    </span>
  );
}

export function Note({ children }: { children: ReactNode }) {
  return <p className="text-sm leading-relaxed text-muted">{children}</p>;
}
