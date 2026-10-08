import type { FastifyInstance } from "fastify";
import { getMealActorId } from "./auth.js";
import {
  changeSelection,
  createSelection,
  getSelection,
  listSelections,
} from "./selections.js";
import type {
  CommandEnvelope,
  SelectionChange,
  SelectionItem,
} from "./contracts.js";
export default async function selectionRoutes(fastify: FastifyInstance) {
  fastify.get("/", async () => listSelections(fastify.prisma));
  fastify.post<{
    Body: { operationId: string; title?: string; items?: SelectionItem[] };
  }>("/", async (request, reply) => {
    const result = await createSelection(
      fastify.prisma,
      getMealActorId(request),
      request.body,
    );
    return reply.code(201).send(result);
  });
  fastify.get<{ Params: { id: string } }>("/:id", async (request, reply) => {
    const result = await getSelection(fastify.prisma, request.params.id);
    return (
      result ?? reply.code(404).send({ error: "Recipe selection not found." })
    );
  });
  fastify.post<{
    Params: { id: string };
    Body: CommandEnvelope<SelectionChange>;
  }>("/:id/commands", async (request) =>
    changeSelection(
      fastify.prisma,
      request.params.id,
      getMealActorId(request),
      request.body,
    ),
  );
}
