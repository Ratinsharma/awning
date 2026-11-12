import { z } from "zod";
import { createServerFn } from "@tanstack/react-start";
import type { BoardItem } from "./diff";
import type { SandboxCreds } from "./paypal.server";
import { buyerFields } from "./untrusted";

export const getShop = createServerFn({ method: "GET" }).handler(async () => {
  const { loadSnapshot } = await import("./shop.server");
  return loadSnapshot();
});

export const connectPayPal = createServerFn({ method: "POST" })
  .validator((data: SandboxCreds) => data)
  .handler(async ({ data }) => {
    const { connectSandbox } = await import("./shop.server");
    return connectSandbox({ clientId: data.clientId.trim(), secret: data.secret.trim() });
  });

export const disconnectPayPal = createServerFn({ method: "POST" }).handler(async () => {
  const { disconnectSandbox } = await import("./shop.server");
  return disconnectSandbox();
});

export const saveShopRules = createServerFn({ method: "POST" })
  .validator((data: { text: string }) => data)
  .handler(async ({ data }) => {
    const { saveRules } = await import("./shop.server");
    return saveRules(data.text);
  });

export const saveProduct = createServerFn({ method: "POST" })
  .validator(
    (data: { id: string; name?: string; priceCents?: number; leadHours?: number; stock?: number; available?: boolean }) =>
      data,
  )
  .handler(async ({ data }) => {
    const { updateProduct } = await import("./shop.server");
    return updateProduct(data);
  });

export const commitBoard = createServerFn({ method: "POST" })
  .validator((data: { items: BoardItem[] }) => data)
  .handler(async ({ data }) => {
    const { commitReading } = await import("./shop.server");
    return commitReading(data.items);
  });

export const readBoard = createServerFn({ method: "POST" })
  .validator((data: { dataUrl: string }) => data)
  .handler(async ({ data }) => {
    const { readUploadedBoard } = await import("./shop.server");
    return readUploadedBoard(data.dataUrl);
  });

export const publishShop = createServerFn({ method: "POST" }).handler(async () => {
  const { goLive } = await import("./shop.server");
  return goLive();
});

export const askShop = createServerFn({ method: "POST" })
  .validator((data: { query: string; agentName: string; useAlternatives?: boolean }) => {
    const buyer = buyerFields({ query: data.query, agentName: data.agentName });
    if (!buyer.ok) throw new Error(buyer.summary);
    return { query: buyer.query, agentName: buyer.agentName, useAlternatives: Boolean(data.useAlternatives) };
  })
  .handler(async ({ data }) => {
    const { quoteShop } = await import("./shop.server");
    return quoteShop(data.query, data.agentName, data.useAlternatives);
  });

export const placeOrder = createServerFn({ method: "POST" })
  .validator((data: { query: string; agentName: string; notes?: string; useAlternatives?: boolean }) => {
    const buyer = buyerFields(data);
    if (!buyer.ok) throw new Error(buyer.summary);
    return {
      query: buyer.query,
      agentName: buyer.agentName,
      notes: buyer.notes,
      useAlternatives: Boolean(data.useAlternatives),
    };
  })
  .handler(async ({ data }) => {
    const { placeShop } = await import("./shop.server");
    return placeShop(data);
  });

export const capturePayment = createServerFn({ method: "POST" })
  .validator((data: { orderId: string }) => data)
  .handler(async ({ data }) => {
    const { captureShop } = await import("./shop.server");
    return captureShop(data.orderId);
  });

export const trackPickup = createServerFn({ method: "POST" })
  .validator((data: { orderId: string }) => data)
  .handler(async ({ data }) => {
    const { trackShop } = await import("./shop.server");
    return trackShop(data.orderId);
  });

export const refundPayment = createServerFn({ method: "POST" })
  .validator((data: { orderId: string }) => z.object({ orderId: z.string().min(1).max(80) }).parse(data))
  .handler(async ({ data }) => {
    const { refundShop } = await import("./shop.server");
    return refundShop(data.orderId);
  });

export const approveOwnerStep = createServerFn({ method: "POST" })
  .validator((data: { orderId: string }) => z.object({ orderId: z.string().min(1).max(80) }).parse(data))
  .handler(async ({ data }) => {
    const { approveOwner } = await import("./shop.server");
    return approveOwner(data.orderId);
  });

export const addGap = createServerFn({ method: "POST" })
  .validator((data: { gapId: string }) => data)
  .handler(async ({ data }) => {
    const { addFromGap } = await import("./shop.server");
    return addFromGap(data.gapId);
  });

export const runAttack = createServerFn({ method: "POST" })
  .validator((data: { agentName: string }) => data)
  .handler(async ({ data }) => {
    const { simulateAttack } = await import("./shop.server");
    return simulateAttack(data.agentName || "rogue");
  });

export const restoreShop = createServerFn({ method: "POST" }).handler(async () => {
  const { restoreSample } = await import("./shop.server");
  return restoreSample();
});

export const askLedger = createServerFn({ method: "POST" })
  .validator((data: { question: string }) => data)
  .handler(async ({ data }) => {
    const { askStudio } = await import("./shop.server");
    return askStudio(data.question);
  });
