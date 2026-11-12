import { useCallback, useEffect, useState } from "react";
import { connectPayPal, getShop } from "./awning.functions";
import type { ShopSnapshot } from "./shop.server";

const CREDS = "awning-sandbox";

export function useShop() {
  const [snapshot, setSnapshot] = useState<ShopSnapshot | null>(null);
  const [error, setError] = useState("");
  const [pending, setPending] = useState(true);

  const apply = useCallback((next: ShopSnapshot) => {
    setSnapshot(next);
    setError("");
  }, []);

  const refresh = useCallback(async () => {
    try {
      apply(await getShop());
    } catch (err) {
      setError(err instanceof Error ? err.message : "The shop didn't load.");
    } finally {
      setPending(false);
    }
  }, [apply]);

  useEffect(() => {
    const raw = sessionStorage.getItem(CREDS);
    const boot = async () => {
      if (raw) {
        try {
          const creds = JSON.parse(raw) as { clientId?: string; secret?: string };
          if (creds.clientId && creds.secret) {
            const result = await connectPayPal({ data: { clientId: creds.clientId, secret: creds.secret } });
            apply(result.snapshot);
            if (!result.ok) sessionStorage.removeItem(CREDS);
            setPending(false);
            return;
          }
        } catch {
          sessionStorage.removeItem(CREDS);
        }
      }
      await refresh();
    };
    void boot();
  }, [apply, refresh]);

  return { snapshot, error, pending, apply, refresh };
}

export function rememberCreds(clientId: string, secret: string) {
  sessionStorage.setItem(CREDS, JSON.stringify({ clientId, secret }));
}

export function forgetCreds() {
  sessionStorage.removeItem(CREDS);
}
