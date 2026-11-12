import { createFileRoute } from "@tanstack/react-router";
import { handleShopMcp } from "@/lib/mcp.server";

const handle = ({ request, params }: { request: Request; params: { slug: string } }) =>
  handleShopMcp(params.slug, request);

export const Route = createFileRoute("/shops/$slug/mcp")({
  server: {
    handlers: {
      GET: handle,
      POST: handle,
      DELETE: handle,
      OPTIONS: handle,
    },
  },
});
