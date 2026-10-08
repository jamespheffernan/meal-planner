import type { FastifyInstance } from "fastify";
import { getMealActorId } from "./auth.js";
import { getShoppingCycle, changeShoppingCycle } from "./shopping-cycle.js";
export default async function shoppingCycleRoutes(fastify: FastifyInstance) {
  fastify.get<{
    Params: {
      selectionId: string;
    };
  }>("/:selectionId", async (request) =>
    getShoppingCycle(fastify.prisma, request.params.selectionId),
  );
  fastify.post<{
    Params: {
      selectionId: string;
    };
  }>("/:selectionId/commands", async (request) =>
    changeShoppingCycle(
      fastify.prisma,
      request.params.selectionId,
      getMealActorId(request),
      request.body,
    ),
  );
}
