import { createHash } from "node:crypto";
import { z } from "zod";
import {
  listAsideRecipeTabs,
  nytRecipeIdentity,
  nytRecipeUrl,
} from "./aside-recipes.js";
import type { FastifyInstance } from "fastify";
import { getMealActorId } from "./auth.js";
import type { RecipeDraft } from "./contracts.js";
import { readDocument, listDocuments } from "./store.js";
import {
  createDraft,
  patchDraft,
  saveDraft,
  intakeSchema,
  patchSchema,
  saveSchema,
} from "./intake.js";
export default async function intakeRoutes(fastify: FastifyInstance) {
  fastify.get("/", async () =>
    (await listDocuments<RecipeDraft>(fastify.prisma, "recipe-draft")).map(
      (row) => ({ ...row.data, revision: row.revision }),
    ),
  );
  fastify.post("/", async (request, reply) => {
    const body = intakeSchema.safeParse(request.body);
    if (!body.success)
      return reply.code(400).send({ error: body.error.message });
    return createDraft(fastify.prisma, getMealActorId(request), body.data);
  });
  fastify.get("/aside-tabs", async (request) => {
    getMealActorId(request);
    return { tabs: await listAsideRecipeTabs() };
  });
  fastify.post("/from-aside", async (request, reply) => {
    const parsed = z
      .object({
        operationId: z.string().min(1).max(200),
        urls: z.array(z.string().max(4000)).min(1).max(20),
      })
      .strict()
      .safeParse(request.body);
    if (!parsed.success)
      return reply.code(400).send({ error: parsed.error.message });
    const actor = getMealActorId(request);
    const drafts: RecipeDraft[] = [];
    const failures: Array<{ url: string; message: string }> = [];
    const seen = new Set<string>();
    for (const supplied of parsed.data.urls) {
      try {
        const url = nytRecipeUrl(supplied);
        const identity = nytRecipeIdentity(url);
        if (seen.has(identity)) continue;
        seen.add(identity);
        const operationId = `aside-${createHash("sha256")
          .update(JSON.stringify([parsed.data.operationId, identity]))
          .digest("hex")}`;
        const draft = await createDraft(fastify.prisma, actor, {
          operationId,
          url,
        });
        drafts.push(draft);
        if (!draft.ingredients.length || !draft.instructions.length)
          failures.push({ url, message: draft.gaps.join(" ") });
      } catch (error) {
        failures.push({
          url: supplied,
          message:
            error instanceof Error
              ? error.message
              : "Aside recipe import failed.",
        });
      }
    }
    return { drafts, failures };
  });
  fastify.get<{ Params: { id: string } }>("/:id", async (request, reply) => {
    getMealActorId(request);
    const row = await readDocument<RecipeDraft>(
      fastify.prisma,
      request.params.id,
      "recipe-draft",
    );
    if (!row) return reply.code(404).send({ error: "Recipe draft not found." });
    return { ...row.data, revision: row.revision };
  });
  fastify.patch<{ Params: { id: string } }>("/:id", async (request, reply) => {
    const body = patchSchema.safeParse(request.body);
    if (!body.success)
      return reply.code(400).send({ error: body.error.message });
    return patchDraft(
      fastify.prisma,
      getMealActorId(request),
      request.params.id,
      body.data,
    );
  });
  fastify.post<{ Params: { id: string } }>(
    "/:id/save",
    async (request, reply) => {
      const body = saveSchema.safeParse(request.body);
      if (!body.success)
        return reply.code(400).send({ error: body.error.message });
      return saveDraft(
        fastify.prisma,
        getMealActorId(request),
        request.params.id,
        body.data,
      );
    },
  );
}
