import type { FastifyInstance } from "fastify";
import { getMealActorId } from "./auth.js";
import {
  changeWeek,
  createWeek,
  getWeek,
  listWeeks,
  type WeekCommand,
} from "./week.js";
import type { CommandEnvelope } from "./contracts.js";
export default async function weekRoutes(fastify: FastifyInstance) {
  fastify.get("/", async () => listWeeks(fastify.prisma));
  fastify.post("/", async (request, reply) =>
    reply
      .code(201)
      .send(
        await createWeek(fastify.prisma, getMealActorId(request), request.body),
      ),
  );
  fastify.get<{ Params: { id: string } }>(
    "/:id",
    async (request, reply) =>
      (await getWeek(fastify.prisma, request.params.id)) ??
      reply.code(404).send({ error: "Week not found." }),
  );
  fastify.post<{ Params: { id: string }; Body: CommandEnvelope<WeekCommand> }>(
    "/:id/commands",
    async (request) =>
      changeWeek(
        fastify.prisma,
        request.params.id,
        getMealActorId(request),
        request.body,
      ),
  );
}
