import type { FastifyInstance } from "fastify";
import { getMealActorId } from "./auth.js";
import {
  getHousehold,
  saveHousehold,
  rotationCandidates,
  prepareHouseholdWeek,
  interviewNotes,
  candidateQuerySchema,
} from "./household.js";
export default async function householdRoutes(app: FastifyInstance) {
  app.get("/", async () => ({
    household: await getHousehold(app.prisma),
    interviewNotes,
  }));
  app.get("/candidates", async (request) => {
    const parsed = candidateQuerySchema.safeParse(request.query);
    if (!parsed.success)
      throw Object.assign(
        new Error("Use expanded=true or false and an optional recipe search."),
        { statusCode: 400 },
      );
    return rotationCandidates(app.prisma, {
      expanded: parsed.data.expanded === "true",
      search: parsed.data.search,
    });
  });
  app.post("/commands", async (request) =>
    saveHousehold(app.prisma, getMealActorId(request), request.body),
  );
  app.post("/prepare", async (request) =>
    prepareHouseholdWeek(app.prisma, getMealActorId(request), request.body),
  );
}
