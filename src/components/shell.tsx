import { Link, useRouterState } from "@tanstack/react-router";
import type { ReactNode } from "react";

const LINKS = [
  { to: "/shop", label: "Shop" },
  { to: "/buy", label: "Buyer" },
  { to: "/judge", label: "Judge" },
] as const;

export function Shell({ children }: { children: ReactNode }) {
  const path = useRouterState({ select: (state) => state.location.pathname });
  return (
    <div className="min-h-screen bg-bg text-fg">
      <div className="awning" />
      <header className="sticky top-0 z-10 border-b border-line bg-bg">
        <div className="mx-auto flex max-w-3xl items-center justify-between gap-3 px-4 py-3">
          <Link to="/" className="font-serif text-xl tracking-tight">
            Awning
          </Link>
          <nav className="flex gap-1">
            {LINKS.map((link) => {
              const on = path === link.to;
              return (
                <Link
                  key={link.to}
                  to={link.to}
                  className={`inline-flex min-h-11 items-center rounded-lg px-3 text-sm ${on ? "bg-surface text-fg" : "text-muted"}`}
                >
                  {link.label}
                </Link>
              );
            })}
          </nav>
        </div>
      </header>
      <main className="mx-auto flex max-w-3xl flex-col gap-4 px-4 py-6">{children}</main>
    </div>
  );
}
