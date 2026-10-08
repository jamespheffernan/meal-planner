import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, rm, readFile, writeFile } from "node:fs/promises";
import { createModels } from "@earendil-works/pi-ai/models";
import {
  fauxProvider,
  fauxAssistantMessage,
  fauxToolCall,
} from "@earendil-works/pi-ai/providers/faux";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { createRequire } from "node:module";
import { join } from "node:path";
import { mealDomainTools } from "../pi-meals/assistant-domain-tools.js";
import { compileSelectionLines } from "../pi-meals/compiler.js";
import { makeWeek, getWeek } from "../pi-meals/week.js";
import { shoppingFingerprint } from "../pi-meals/shopping-cycle.js";
import type { ToolExecutionApi } from "@earendil-works/pi-durable";
import type { PrismaClient } from "@prisma/client";
const domain = vi.hoisted(() => ({
  selection: undefined as any,
  revision: 1,
  applied: 0,
  commands: [] as unknown[],
  operations: new Map<string, unknown>(),
}));
vi.mock("../pi-meals/selections.js", () => ({
  getSelection: async () =>
    domain.selection ?? {
      id: "selection",
      revision: domain.revision,
      lines: [],
    },
  changeSelection: async (
    _p: unknown,
    _id: string,
    _actor: string,
    envelope: {
      operationId: string;
      expectedRevision: number;
      command: unknown;
    },
  ) => {
    if (domain.operations.has(envelope.operationId))
      return domain.operations.get(envelope.operationId);
    if (envelope.expectedRevision !== domain.revision)
      throw new Error("revision conflict");
    domain.applied++;
    domain.commands.push(envelope.command);
    const result = { id: "selection", revision: ++domain.revision };
    domain.operations.set(envelope.operationId, result);
    return result;
  },
}));
import { createMealAssistant } from "../pi-meals/assistant.js";
const dirs: string[] = [];
afterEach(async () => {
  for (const dir of dirs.splice(0))
    await rm(dir, { recursive: true, force: true });
  domain.selection = undefined;
  domain.revision = 1;
  domain.applied = 0;
  domain.commands = [];
  domain.operations.clear();
});
function database() {
  const rows = new Map<string, any>();
  return {
    rows,
    prisma: {
      piMealOperation: {
        findUnique: async ({ where }: { where: { id: string } }) =>
          domain.operations.has(where.id)
            ? { result: domain.operations.get(where.id) }
            : null,
      },
      piMealOutbox: {
        findUnique: async ({ where }: { where: { id: string } }) =>
          rows.get(where.id) ?? null,
        findFirst: async () =>
          [...rows.values()].find((r) =>
            ["pending", "running"].includes(r.status),
          ) ?? null,
        upsert: async ({
          where,
          create,
        }: {
          where: { id: string };
          create: any;
        }) => {
          if (!rows.has(where.id))
            rows.set(where.id, { ...create, status: "pending" });
          return rows.get(where.id);
        },
        update: async ({
          where,
          data,
        }: {
          where: { id: string };
          data: any;
        }) => {
          Object.assign(rows.get(where.id), data);
          return rows.get(where.id);
        },
      },
    } as unknown as PrismaClient,
  };
}
async function settle(
  assistant: Awaited<ReturnType<typeof createMealAssistant>>,
  id: string,
) {
  for (let n = 0; n < 100; n++) {
    const result = await assistant.get("actor", id);
    if (result && ["complete", "failed"].includes(result.status)) return result;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error("did not settle");
}
describe("meal assistant with real Pi Durable SQLite and fake domain/provider", () => {
  it("resumes after SIGKILL between domain receipt commit and tool return without a second mutation", async () => {
    const directory = await mkdtemp(
      "/Volumes/4TB Private/Offloaded/Agent Work/pi-meals-assistant-crash-",
    );
    dirs.push(directory);
    const require = createRequire(import.meta.url);
    const script = join(directory, "worker.mts");
    const statePath = join(directory, "domain.json");
    await writeFile(
      statePath,
      JSON.stringify({
        documents: {
          selection: {
            id: "selection",
            kind: "selection",
            revision: 1,
            data: { title: "Before", items: [], stock: [] },
            updatedAt: new Date().toISOString(),
          },
        },
        operations: {},
        outbox: {},
        mutations: 0,
      }),
    );
    await writeFile(
      script,
      `
      import {readFile,writeFile,open,rename} from 'node:fs/promises';
      import {createMealAssistant} from ${JSON.stringify(new URL("../pi-meals/assistant.ts", import.meta.url).href)};
      import {createModels} from ${JSON.stringify(new URL("../../node_modules/@earendil-works/pi-ai/dist/models.js", import.meta.url).href)};
      import {fauxProvider,fauxAssistantMessage,fauxToolCall} from ${JSON.stringify(new URL("../../node_modules/@earendil-works/pi-ai/dist/providers/faux.js", import.meta.url).href)};
      const statePath=${JSON.stringify(statePath)};const state=JSON.parse(await readFile(statePath,'utf8'));
      const persist=async()=>{const temporary=statePath+'.next';await writeFile(temporary,JSON.stringify(state));const file=await open(temporary,'r+');await file.sync();await file.close();await rename(temporary,statePath);};
      const prisma={
        piMealDocument:{findUnique:async({where})=>{const row=state.documents[where.id];return row?{...row,updatedAt:new Date(row.updatedAt)}:null;},
          updateMany:async({where,data})=>{const row=state.documents[where.id];if(!row||row.revision!==where.revision)return {count:0};state.documents[where.id]={...row,...data};state.mutations++;return {count:1};}},
        piMealOperation:{findUnique:async({where})=>state.operations[where.id]??null,create:async({data})=>{state.operations[data.id]=data;return data;}},
        piMealOutbox:{findUnique:async({where})=>state.outbox[where.id]??null,findFirst:async()=>Object.values(state.outbox).find(row=>['pending','running'].includes(row.status))??null,
          upsert:async({where,create})=>{if(!state.outbox[where.id])state.outbox[where.id]={...create,status:'pending'};await persist();return state.outbox[where.id];},
          update:async({where,data})=>{Object.assign(state.outbox[where.id],data);await persist();return state.outbox[where.id];}},
        $transaction:async(fn)=>{const result=await fn(prisma);await persist();if(process.argv[2]==='crash'){console.log('receipt-committed');await new Promise(()=>{});}return result;}
      };
      const models=createModels();const faux=fauxProvider();models.setProvider(faux.provider);
      faux.setResponses(process.argv[2]==='crash'?[fauxAssistantMessage(fauxToolCall('rename_selection',{title:'Dinner'},{id:'rename-crash'}),{stopReason:'toolUse'})]:[fauxAssistantMessage('Dinner saved after recovery.')]);
      const assistant=await createMealAssistant(prisma,{runtimeDir:${JSON.stringify(join(directory, "runtime"))},models,model:{provider:faux.provider.id,modelId:faux.getModel().id},timeoutMs:30000});
      if(process.argv[2]==='crash')await assistant.submit('actor','crash-request','selection','Call this Dinner');
      for(let n=0;n<300;n++){const row=Object.values(state.outbox)[0];if(row&&['complete','failed'].includes(row.status)){console.log('result:'+JSON.stringify({status:row.status,message:row.payload.result,error:row.payload.error,mutations:state.mutations,providerCalls:faux.state.callCount}));await assistant.close();process.exit(0);}await new Promise(resolve=>setTimeout(resolve,20));}
      await assistant.close();throw new Error('Recovery did not settle.');
    `,
    );
    const launch = (mode: string) =>
      spawn(
        process.execPath,
        ["--import", require.resolve("tsx"), script, mode],
        { stdio: ["ignore", "pipe", "pipe"] },
      );
    const awaitLine = (child: ReturnType<typeof launch>, prefix: string) =>
      new Promise<string>((resolve, reject) => {
        let stdout = "",
          stderr = "";
        const timeout = setTimeout(
          () => reject(new Error("Child timed out: " + stderr)),
          10000,
        );
        child.stderr.on("data", (chunk) => {
          stderr += chunk.toString();
        });
        child.stdout.on("data", (chunk) => {
          stdout += chunk.toString();
          const line = stdout
            .split("\n")
            .find((line) => line.startsWith(prefix));
          if (line) {
            clearTimeout(timeout);
            resolve(line.slice(prefix.length));
          }
        });
        child.once("exit", () => {
          clearTimeout(timeout);
          if (!stdout.includes(prefix))
            reject(new Error("Child exited: " + stderr));
        });
      });
    const owner = launch("crash");
    try {
      await awaitLine(owner, "receipt-committed");
      const checkpoint = JSON.parse(await readFile(statePath, "utf8"));
      expect(checkpoint.mutations).toBe(1);
      expect(Object.keys(checkpoint.operations)).toHaveLength(1);
      expect(Object.values(checkpoint.outbox)[0]).toMatchObject({
        status: "running",
      });
      const dead = once(owner, "exit");
      owner.kill("SIGKILL");
      await dead;
      const restarted = launch("resume");
      try {
        const result = JSON.parse(await awaitLine(restarted, "result:"));
        expect(result).toMatchObject({
          status: "complete",
          message: "Dinner saved after recovery.",
          mutations: 1,
          providerCalls: 1,
        });
        await once(restarted, "exit");
      } finally {
        restarted.kill("SIGKILL");
      }
      const final = JSON.parse(await readFile(statePath, "utf8"));
      expect(final.mutations).toBe(1);
      expect(final.documents.selection.data.title).toBe("Dinner");
      expect(Object.keys(final.operations)).toHaveLength(1);
    } finally {
      owner.kill("SIGKILL");
    }
  });
  it("matches UI week coverage for arrival dates and purchases, including receipt replay", async () => {
    const item = {
      id: "batch",
      name: "Soup",
      baseServings: 2,
      servings: 2,
      ingredients: [{ name: "Carrot", quantity: 400, unit: "g" }],
    };
    const lines = compileSelectionLines([item]);
    domain.selection = {
      id: "selection",
      revision: 1,
      items: [item],
      stock: [],
      lines,
      title: "Soup",
      updatedAt: "now",
    };
    const data = makeWeek(domain.selection, "2026-10-05");
    data.allocations[0].batchId = "batch";
    const doc = {
      id: "week",
      kind: "week",
      revision: 1,
      data,
      updatedAt: new Date(),
    };
    const shopping = {
      selectionId: "selection",
      selectionRevision: 1,
      routes: [
        {
          lineId: lines[0].id,
          route: "market",
          availableOn: "2026-10-06",
          neededOn: "2026-10-05",
          fingerprint: shoppingFingerprint(lines[0]),
          actorId: "actor",
          recordedAt: "now",
        },
      ],
      purchases: [] as any[],
    };
    const prisma = {
      piMealDocument: {
        findMany: async () => [doc],
        findUnique: async ({ where }: any) =>
          where.id === "week"
            ? doc
            : {
                id: "shopping_selection",
                kind: "shopping_cycle",
                revision: 1,
                data: shopping,
                updatedAt: new Date(),
              },
      },
      piMealOperation: {
        findUnique: async () => ({
          actorId: "actor",
          documentId: "week",
          result: { ...doc, updatedAt: doc.updatedAt.toISOString() },
        }),
      },
    } as unknown as PrismaClient;
    const tools = mealDomainTools(prisma, async () => ({
      actorId: "actor",
      selectionId: "selection",
      requestId: "request",
    }));
    const api = { callId: "call" } as ToolExecutionApi;
    const read = tools.find((t) => t.name === "get_linked_weeks")!
      .execute as any;
    const replay = tools.find((t) => t.name === "change_linked_week")!
      .execute as any;
    const view = async () =>
      JSON.parse((await read({}, api)).content[0].text)[0];
    expect((await view()).lunches[0].coverage).toBe("uncovered");
    expect(await view()).toEqual(await getWeek(prisma, "week"));
    expect(
      JSON.parse(
        (
          await replay(
            { weekId: "week", command: { type: "refresh_selection" } },
            api,
          )
        ).content[0].text,
      ),
    ).toEqual(await getWeek(prisma, "week"));
    shopping.purchases.push({
      lineId: lines[0].id,
      quantity: 400,
      unit: lines[0].unit,
      fingerprint: shoppingFingerprint(lines[0]),
      actorId: "actor",
      purchasedAt: "2026-10-05T09:00:00Z",
      recordedAt: "now",
    });
    expect((await view()).lunches[0].coverage).toBe("planned");
    expect(await view()).toEqual(await getWeek(prisma, "week"));
    expect(
      JSON.parse(
        (
          await replay(
            { weekId: "week", command: { type: "refresh_selection" } },
            api,
          )
        ).content[0].text,
      ),
    ).toEqual(await getWeek(prisma, "week"));
  });
  it("recovers a transient dispatcher read failure without another submission", async () => {
    const runtimeDir = await mkdtemp(
      "/Volumes/4TB Private/Offloaded/Agent Work/pi-meals-assistant-io-",
    );
    dirs.push(runtimeDir);
    const models = createModels();
    const faux = fauxProvider();
    models.setProvider(faux.provider);
    faux.setResponses([fauxAssistantMessage("Recovered.")]);
    const { prisma, rows } = database();
    rows.set("meal_recovery", {
      id: "meal_recovery",
      actorId: "actor",
      documentId: "selection",
      status: "pending",
      payload: { message: "Read list", selectionId: "selection" },
    });
    const original = prisma.piMealOutbox.findFirst.bind(prisma.piMealOutbox);
    let reads = 0;
    prisma.piMealOutbox.findFirst = vi.fn(async (...args: any[]) => {
      if (++reads === 1) throw new Error("temporary database failure");
      return original(...(args as []));
    }) as any;
    const assistant = await createMealAssistant(prisma, {
      runtimeDir,
      models,
      model: { provider: faux.provider.id, modelId: faux.getModel().id },
    });
    try {
      expect((await settle(assistant, "meal_recovery")).message).toBe(
        "Recovered.",
      );
      expect(faux.state.callCount).toBe(1);
    } finally {
      await assistant.close();
    }
  });
  it("bounds dispatcher retries while leaving provider calls at zero", async () => {
    const runtimeDir = await mkdtemp(
      "/Volumes/4TB Private/Offloaded/Agent Work/pi-meals-assistant-io-limit-",
    );
    dirs.push(runtimeDir);
    const models = createModels();
    const faux = fauxProvider();
    models.setProvider(faux.provider);
    const { prisma } = database();
    const reads = vi.fn(async () => {
      throw new Error("database offline");
    });
    prisma.piMealOutbox.findFirst = reads as any;
    const assistant = await createMealAssistant(prisma, {
      runtimeDir,
      models,
      model: { provider: faux.provider.id, modelId: faux.getModel().id },
    });
    try {
      await new Promise((resolve) => setTimeout(resolve, 850));
      expect(reads).toHaveBeenCalledTimes(4);
      expect(assistant.status().status).toBe("failed");
      expect(faux.state.callCount).toBe(0);
    } finally {
      await assistant.close();
    }
  });
  it("reports unavailable storage without rejecting backend assistant creation", async () => {
    const runtimeDir = await mkdtemp(
      "/Volumes/4TB Private/Offloaded/Agent Work/pi-meals-assistant-owner-",
    );
    dirs.push(runtimeDir);
    const models = createModels();
    const faux = fauxProvider();
    models.setProvider(faux.provider);
    const { prisma } = database();
    const options = {
      runtimeDir,
      models,
      model: { provider: faux.provider.id, modelId: faux.getModel().id },
    };
    const owner = await createMealAssistant(prisma, options);
    try {
      const assistant = await createMealAssistant(prisma, options);
      expect(assistant.status()).toMatchObject({
        available: false,
        status: "unavailable",
      });
      expect(assistant.status().reason).toContain("already owned");
      expect(
        (await assistant.submit("actor", "op", "selection", "Hello")).status,
      ).toBe("unavailable");
      await assistant.close();
    } finally {
      await owner.close();
    }
  });
  it("dispatches, persists final answer, deduplicates and reopens without a second domain write", async () => {
    const runtimeDir = await mkdtemp(
      "/Volumes/4TB Private/Offloaded/Agent Work/pi-meals-assistant-test-",
    );
    dirs.push(runtimeDir);
    const models = createModels();
    const faux = fauxProvider();
    models.setProvider(faux.provider);
    faux.setResponses([
      fauxAssistantMessage(
        fauxToolCall(
          "set_stock",
          { lineId: "onion", quantity: 1, unit: "each" },
          { id: "stock-1" },
        ),
        { stopReason: "toolUse" },
      ),
      fauxAssistantMessage("One onion recorded."),
    ]);
    const options = {
      runtimeDir,
      models,
      model: { provider: faux.provider.id, modelId: faux.getModel().id },
    };
    const { prisma } = database();
    let assistant = await createMealAssistant(prisma, options);
    const sent = await assistant.submit(
      "actor",
      "operation",
      "selection",
      "I have one onion",
    );
    expect(await settle(assistant, sent.requestId)).toEqual({
      requestId: sent.requestId,
      status: "complete",
      message: "One onion recorded.",
    });
    expect(domain.applied).toBe(1);
    await assistant.close();
    assistant = await createMealAssistant(prisma, options);
    expect(
      (
        await assistant.submit(
          "actor",
          "operation",
          "selection",
          "I have one onion",
        )
      ).status,
    ).toBe("complete");
    expect(domain.applied).toBe(1);
    expect(faux.state.callCount).toBe(2);
    await expect(
      assistant.submit("actor", "operation", "selection", "Different message"),
    ).rejects.toThrow("reused");
    expect(await assistant.get("other", sent.requestId)).toBeNull();
    await assistant.close();
  });
  it("records explicit whole-line coverage without inventing a quantity", async () => {
    const runtimeDir = await mkdtemp(
      "/Volumes/4TB Private/Offloaded/Agent Work/pi-meals-assistant-enough-",
    );
    dirs.push(runtimeDir);
    const models = createModels();
    const faux = fauxProvider();
    models.setProvider(faux.provider);
    faux.setResponses([
      fauxAssistantMessage(
        fauxToolCall("have_all", { lineId: "onion" }, { id: "enough-1" }),
        { stopReason: "toolUse" },
      ),
      fauxAssistantMessage("Onions covered for this list."),
    ]);
    const { prisma } = database();
    const assistant = await createMealAssistant(prisma, {
      runtimeDir,
      models,
      model: { provider: faux.provider.id, modelId: faux.getModel().id },
    });
    try {
      const sent = await assistant.submit(
        "actor",
        "enough-op",
        "selection",
        "We have enough onions",
      );
      expect((await settle(assistant, sent.requestId)).status).toBe("complete");
      expect(domain.commands).toEqual([{ type: "have_all", lineId: "onion" }]);
      await assistant.submit(
        "actor",
        "enough-op",
        "selection",
        "We have enough onions",
      );
      expect(domain.applied).toBe(1);
    } finally {
      await assistant.close();
    }
  });
  it("resumes a running outbox after reopen without applying a committed tool twice", async () => {
    const runtimeDir = await mkdtemp(
      "/Volumes/4TB Private/Offloaded/Agent Work/pi-meals-assistant-recovery-",
    );
    dirs.push(runtimeDir);
    const models = createModels();
    const faux = fauxProvider();
    models.setProvider(faux.provider);
    faux.setResponses([
      fauxAssistantMessage(
        fauxToolCall(
          "rename_selection",
          { title: "Dinner" },
          { id: "rename-1" },
        ),
        { stopReason: "toolUse" },
      ),
      fauxAssistantMessage("Dinner saved."),
    ]);
    const options = {
      runtimeDir,
      models,
      model: { provider: faux.provider.id, modelId: faux.getModel().id },
    };
    const { prisma, rows } = database();
    let assistant = await createMealAssistant(prisma, options);
    const sent = await assistant.submit(
      "actor",
      "recovery-op",
      "selection",
      "Call this Dinner",
    );
    await settle(assistant, sent.requestId);
    await assistant.close();
    const row = rows.get(sent.requestId);
    row.status = "running";
    delete row.payload.result;
    assistant = await createMealAssistant(prisma, options);
    expect((await settle(assistant, sent.requestId)).message).toBe(
      "Dinner saved.",
    );
    expect(domain.applied).toBe(1);
    expect(faux.state.callCount).toBe(2);
    await assistant.close();
  });
  it("stops a tool loop at its configured turn limit", async () => {
    const runtimeDir = await mkdtemp(
      "/Volumes/4TB Private/Offloaded/Agent Work/pi-meals-assistant-limit-",
    );
    dirs.push(runtimeDir);
    const models = createModels();
    const faux = fauxProvider();
    models.setProvider(faux.provider);
    faux.setResponses([
      fauxAssistantMessage(
        fauxToolCall("get_selection", {}, { id: "read-1" }),
        { stopReason: "toolUse" },
      ),
      fauxAssistantMessage("Must not run"),
    ]);
    const { prisma } = database();
    const assistant = await createMealAssistant(prisma, {
      runtimeDir,
      models,
      model: { provider: faux.provider.id, modelId: faux.getModel().id },
      maxTurns: 1,
    });
    const sent = await assistant.submit(
      "actor",
      "limit-op",
      "selection",
      "Read list",
    );
    expect((await settle(assistant, sent.requestId)).status).toBe("failed");
    expect(faux.state.callCount).toBe(1);
    await assistant.close();
  });
  it("reports absent configuration without opening a runtime or calling a provider", async () => {
    const { prisma } = database();
    const models = createModels();
    const assistant = await createMealAssistant(prisma, { models });
    expect(assistant.status().available).toBe(false);
    expect(
      (await assistant.submit("actor", "op", "selection", "Hello")).status,
    ).toBe("unavailable");
    await assistant.close();
  });
});
