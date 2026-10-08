import type { FastifyInstance } from "fastify";
import { getMealActorId } from "./auth.js";
import {
  basketHandoff,
  assertBasketReconciliationAllowed,
  createBasket,
  fillBasket,
  finishAsideBasket,
  stopAsideBasket,
  getBasket,
  listBaskets,
  openAsideBasket,
  prepareBasket,
  reconcileBasket,
} from "./baskets.js";
import { inspectAsideSession, inspectAsideProcess } from "./aside.js";
import { searchMealProducts, withOcadoExecutor } from "./ocado.js";
import type { BasketManifestLine } from "./contracts.js";
export default async function basketRoutes(fastify: FastifyInstance) {
  fastify.get<{ Querystring: { selectionId?: string } }>(
    "/",
    async (request) => ({
      baskets: await listBaskets(fastify.prisma, request.query.selectionId),
    }),
  );
  fastify.get<{ Querystring: { q?: string } }>(
    "/products",
    async (request) => ({
      products: await searchMealProducts(fastify.prisma, request.query.q),
    }),
  );
  fastify.post<{
    Body: {
      operationId: string;
      selectionId: string;
      executor?: "aside" | "ocado";
    };
  }>("/", async (request, reply) =>
    reply
      .code(201)
      .send(
        await createBasket(
          fastify.prisma,
          getMealActorId(request),
          request.body,
        ),
      ),
  );
  fastify.get<{ Params: { id: string } }>("/:id", async (request, reply) => {
    const basket = await getBasket(fastify.prisma, request.params.id);
    if (!basket) return reply.code(404).send({ error: "Basket not found." });
    if (basket.executor === "aside") {
      const receipt = basket.receipt as { logPath?: string } | undefined;
      const liveProcess = receipt?.logPath
        ? inspectAsideProcess(receipt.logPath)
        : undefined;
      if (liveProcess) basket.receipt = { ...receipt, ...liveProcess };
    }
    if (basket.executor !== "aside" || !basket.taskId) return basket;
    try {
      return {
        ...basket,
        asideSession: await inspectAsideSession(basket.taskId),
      };
    } catch (error) {
      return {
        ...basket,
        asideSession: {
          sessionId: basket.taskId,
          status: "unknown",
          error:
            error instanceof Error ? error.message : "Aside status unavailable",
        },
      };
    }
  });
  fastify.get<{ Params: { id: string } }>(
    "/:id/handoff",
    async (request, reply) => {
      const basket = await getBasket(fastify.prisma, request.params.id);
      return basket
        ? {
            basketId: basket.id,
            revision: basket.revision,
            executor: basket.executor,
            taskId: basket.taskId,
            text: basketHandoff(basket),
          }
        : reply.code(404).send({ error: "Basket not found." });
    },
  );
  fastify.post<{
    Params: { id: string };
    Body: { operationId: string; expectedRevision: number };
  }>("/:id/open-aside", async (request) =>
    openAsideBasket(
      fastify.prisma,
      request.params.id,
      getMealActorId(request),
      request.body,
    ),
  );
  fastify.post<{
    Params: { id: string };
    Body: { operationId: string; expectedRevision: number };
  }>("/:id/stop-aside", async (request) =>
    stopAsideBasket(
      fastify.prisma,
      request.params.id,
      getMealActorId(request),
      request.body,
    ),
  );
  fastify.post<{
    Params: { id: string };
    Body: {
      operationId: string;
      expectedRevision: number;
      confirmedTrolley: true;
      stoppedSessionId: string;
      reviewToken: string;
    };
  }>("/:id/finish-aside", async (request) =>
    finishAsideBasket(
      fastify.prisma,
      request.params.id,
      getMealActorId(request),
      request.body,
    ),
  );
  fastify.post<{
    Params: { id: string };
    Body: {
      operationId: string;
      expectedRevision: number;
      lines: BasketManifestLine[];
    };
  }>("/:id/prepare", async (request) =>
    prepareBasket(
      fastify.prisma,
      request.params.id,
      getMealActorId(request),
      request.body,
    ),
  );
  fastify.post<{
    Params: { id: string };
    Body: {
      operationId: string;
      expectedRevision: number;
      selectionRevision: number;
    };
  }>("/:id/fill", async (request) => {
    const basket = await getBasket(fastify.prisma, request.params.id),
      actor = getMealActorId(request);
    if (
      request.body?.operationId &&
      (await fastify.prisma.piMealOperation.findUnique({
        where: { id: request.body.operationId },
      }))
    )
      return fillBasket(fastify.prisma, request.params.id, actor, request.body);
    if (
      basket?.executor === "ocado" &&
      process.env.PI_MEALS_CART_MUTATIONS_ENABLED === "true"
    )
      return withOcadoExecutor(fastify.prisma, basket.lines, (executor) =>
        fillBasket(fastify.prisma, request.params.id, actor, request.body, {
          executor,
        }),
      );
    return fillBasket(fastify.prisma, request.params.id, actor, request.body);
  });
  fastify.post<{
    Params: { id: string };
    Body: { operationId: string; expectedRevision: number };
  }>("/:id/reconcile", async (request) => {
    const basket = await getBasket(fastify.prisma, request.params.id),
      actor = getMealActorId(request);
    if (
      request.body?.operationId &&
      (await fastify.prisma.piMealOperation.findUnique({
        where: { id: request.body.operationId },
      }))
    )
      return reconcileBasket(
        fastify.prisma,
        request.params.id,
        actor,
        request.body,
      );
    if (basket) assertBasketReconciliationAllowed(basket);
    if (basket?.executor === "ocado")
      return withOcadoExecutor(fastify.prisma, basket.lines, (executor) =>
        reconcileBasket(
          fastify.prisma,
          request.params.id,
          actor,
          request.body,
          { executor },
        ),
      );
    return reconcileBasket(
      fastify.prisma,
      request.params.id,
      actor,
      request.body,
    );
  });
}
