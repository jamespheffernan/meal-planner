import type { FastifyInstance } from "fastify";

// Legacy routes cannot bypass the reviewed Pi Meals basket boundary.
export function installLegacyEffectBoundary(app: FastifyInstance) {
  app.addHook("onRequest", async (request, reply) => {
    // Match the selected handler, including requests with encoded path segments.
    const path = (
      request.routeOptions.url ?? request.url.split("?")[0]
    ).replace(/\/+$/, "");
    if (
      request.method === "POST" &&
      (/^\/api\/stores\/ocado\/(cart\/add|checkout\/dry-run|place-order)$/.test(
        path,
      ) ||
        /^\/api\/shopping-lists\/[^/]+\/order\/(add-to-cart|checkout\/dry-run|place-order)$/.test(
          path,
        ) ||
        path === "/api/shopping-assistant/message")
    )
      return reply.code(410).send({
        message:
          "Use Pi Meals for reviewed basket changes. Ordering and checkout are manual on Ocado.",
      });
  });
}
