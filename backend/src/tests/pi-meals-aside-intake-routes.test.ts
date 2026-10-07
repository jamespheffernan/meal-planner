import { describe, it, expect, vi } from "vitest";
import Fastify from "fastify";
import type { PrismaClient } from "@prisma/client";
const calls = vi.hoisted(() => ({ create: vi.fn(), tabs: vi.fn() }));
vi.mock("../pi-meals/intake.js", async (original) => ({
  ...(await original<typeof import("../pi-meals/intake.js")>()),
  createDraft: calls.create,
}));
vi.mock("../pi-meals/aside-recipes.js", async (original) => ({
  ...(await original<typeof import("../pi-meals/aside-recipes.js")>()),
  listAsideRecipeTabs: calls.tabs,
}));
import routes from "../pi-meals/intake-routes.js";
async function app(actor = true) {
  const server = Fastify();
  server.decorate("prisma", {} as PrismaClient);
  server.addHook("onRequest", async (request) => {
    if (actor) request.mealActorId = "james";
  });
  await server.register(routes, { prefix: "/intake" });
  return server;
}
describe("Aside intake routes", () => {
  it("returns discovered recipe tabs behind actor authentication", async () => {
    calls.tabs.mockResolvedValue([
      {
        targetId: "recipe-tab",
        title: "Synthetic soup",
        url: "https://cooking.nytimes.com/recipes/123-soup",
      },
    ]);
    const server = await app();
    expect((await server.inject({ url: "/intake/aside-tabs" })).json()).toEqual(
      { tabs: await calls.tabs() },
    );
    await server.close();
    const unsigned = await app(false);
    expect(
      (await unsigned.inject({ url: "/intake/aside-tabs" })).statusCode,
    ).toBe(401);
    await unsigned.close();
  });
  it("serially imports deduplicated recipe URLs and reports failures alongside successes", async () => {
    calls.create.mockReset();
    calls.create.mockImplementation(async (_db, _actor, input) =>
      input.url.includes("456")
        ? { ingredients: [], instructions: [], gaps: ["Sign in to Aside."] }
        : {
            ingredients: [{}],
            instructions: ["Simmer"],
            gaps: [],
            source: input.url,
          },
    );
    const server = await app();
    const response = await server.inject({
      method: "POST",
      url: "/intake/from-aside",
      payload: {
        operationId: "batch",
        urls: [
          "https://cooking.nytimes.com/recipes/123-soup",
          "https://cooking.nytimes.com/recipes/123-other?utm_source=x",
          "https://evil.test/recipes/9",
          "https://cooking.nytimes.com/recipes/456",
        ],
      },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json().drafts).toHaveLength(2);
    expect(response.json().failures).toHaveLength(2);
    expect(calls.create).toHaveBeenCalledTimes(2);
    const first = calls.create.mock.calls[0][2].operationId;
    await server.inject({
      method: "POST",
      url: "/intake/from-aside",
      payload: {
        operationId: "batch",
        urls: ["https://cooking.nytimes.com/recipes/123-soup"],
      },
    });
    expect(calls.create.mock.calls[2][2].operationId).toBe(first);
    expect(
      (
        await server.inject({
          method: "POST",
          url: "/intake/from-aside",
          payload: {
            operationId: "large",
            urls: Array(21).fill("https://cooking.nytimes.com/recipes/123"),
          },
        })
      ).statusCode,
    ).toBe(400);
    await server.close();
  });
});
