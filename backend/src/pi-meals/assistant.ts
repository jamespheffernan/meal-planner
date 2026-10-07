import { createHash } from "node:crypto";
import { Prisma, type PrismaClient } from "@prisma/client";
import { Type } from "@earendil-works/pi-ai";
import { createModels, type Models } from "@earendil-works/pi-ai/models";
import { openaiProvider } from "@earendil-works/pi-ai/providers/openai";
import { anthropicProvider } from "@earendil-works/pi-ai/providers/anthropic";
import {
  createRegistry,
  defineExtension,
  defineTool,
  GenerationTask,
  hook,
  type ToolExecutionApi,
} from "@earendil-works/pi-durable";
import {
  mealDomainTools,
  selectionMutation,
} from "./assistant-domain-tools.js";
import { getSelection } from "./selections.js";
import {
  MealRun,
  mealContext,
  mealConversation,
  openMealDurable,
} from "./durable.js";
import { MealProviderUnavailable, sharedPiMealModels } from "./provider.js";
import type { SelectionChange } from "./contracts.js";
export type AssistantResult = {
  requestId: string;
  status: "queued" | "running" | "complete" | "unavailable" | "failed";
  message?: string;
};
type Payload = {
  message: string;
  selectionId: string;
  result?: string;
  error?: string;
};
export interface MealAssistantOptions {
  runtimeDir?: string;
  models?: Models;
  model?: { provider: string; modelId: string };
  maxTurns?: number;
  timeoutMs?: number;
}
const json = (value: unknown) => ({
  content: [{ type: "text" as const, text: JSON.stringify(value) }],
});
const digest = (value: unknown) =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex");
async function storedMessage(
  prisma: PrismaClient,
  actorId: string,
  id: string,
): Promise<AssistantResult | null> {
  if (!id.startsWith("meal_")) return null;
  const row = await prisma.piMealOutbox.findUnique({ where: { id } });
  if (!row || row.actorId !== actorId) return null;
  const payload = row.payload as unknown as Payload;
  return {
    requestId: row.id,
    status:
      row.status === "pending"
        ? "queued"
        : (row.status as AssistantResult["status"]),
    message: payload.result ?? payload.error,
  };
}
export async function createMealAssistant(
  prisma: PrismaClient,
  options: MealAssistantOptions = {},
) {
  const configuredModels = createModels();
  let models = options.models ?? configuredModels;
  let model = options.model;
  let reason =
    "Set PI_MEALS_MODEL_PROVIDER and PI_MEALS_MODEL_ID with an authorised Pi login or provider API key.";
  if (
    !model &&
    process.env.PI_MEALS_MODEL_PROVIDER &&
    process.env.PI_MEALS_MODEL_ID
  ) {
    const provider = process.env.PI_MEALS_MODEL_PROVIDER;
    if (provider === "openai" && process.env.OPENAI_API_KEY)
      configuredModels.setProvider(openaiProvider());
    else if (provider === "anthropic" && process.env.ANTHROPIC_API_KEY)
      configuredModels.setProvider(anthropicProvider());
    else if (!options.models) {
      try {
        models = await sharedPiMealModels(
          provider,
          process.env.PI_MEALS_MODEL_ID,
        );
      } catch (error) {
        reason =
          error instanceof MealProviderUnavailable
            ? error.message
            : "Requested meal model or authorised Pi login is unavailable. Check Pi configuration.";
      }
    } else
      reason =
        "Configured meal provider is unsupported or its API key is missing.";
    if (models.getProvider(provider))
      model = { provider, modelId: process.env.PI_MEALS_MODEL_ID };
  }
  if (model && !models.getModel(model.provider, model.modelId)) {
    model = undefined;
    reason = "Configured meal model is absent from the provider catalog.";
  }
  const timeoutMs =
    options.timeoutMs ?? Number(process.env.PI_MEALS_TIMEOUT_MS ?? 60000);
  const maxTurns =
    options.maxTurns ?? Number(process.env.PI_MEALS_MAX_TURNS ?? 8);
  if (
    !Number.isFinite(timeoutMs) ||
    timeoutMs < 1 ||
    !Number.isSafeInteger(maxTurns) ||
    maxTurns < 1
  )
    throw new Error("Invalid meal assistant limits.");
  if (!model)
    return {
      status: () => ({ available: false, status: "unavailable", reason }),
      submit: async (
        actorId: string,
        operationId: string,
        selectionId: string,
        message: string,
      ): Promise<AssistantResult> => ({
        requestId: `meal_${digest([actorId, operationId])}`,
        status: "unavailable",
        message: reason,
      }),
      get: (actorId: string, id: string) => storedMessage(prisma, actorId, id),
      close: async () => {},
    };
  let requestLimitError: string | undefined;
  const registry = createRegistry();
  const run = async (api: ToolExecutionApi) => {
    const value = await api.snapshot(MealRun, api.conversationId, mealContext);
    if (!value?.selectionId) throw new Error("Meal run context is missing.");
    return value;
  };
  const change = async (command: SelectionChange, api: ToolExecutionApi) =>
    json(
      await selectionMutation(prisma, await run(api), api, async () => command),
    );
  registry.install(
    defineExtension({
      name: "meal-assistant",
      tools: [
        ...mealDomainTools(prisma, run),
        defineTool({
          name: "get_selection",
          description:
            "Read the selected recipes, compiled grocery list, stock and warnings.",
          parameters: Type.Object({}),
          replay: "safe",
          execute: async (_args, api) =>
            json(await getSelection(prisma, (await run(api)).selectionId)),
        }),
        defineTool({
          name: "set_stock",
          description:
            "Record the amount the user has on hand for a grocery line. Read the selection to get its line ID and unit.",
          parameters: Type.Object({
            lineId: Type.String(),
            quantity: Type.Number({ minimum: 0 }),
            unit: Type.String(),
          }),
          replay: "safe",
          execute: async (args, api) =>
            change({ type: "set_stock", ...args }, api),
        }),
        defineTool({
          name: "have_all",
          description:
            "Cover the whole current grocery line only when the user explicitly says they have enough. Read the selection to identify its line ID. This coverage is invalidated when recipe quantities change; never invent a stock amount.",
          parameters: Type.Object({ lineId: Type.String() }),
          replay: "safe",
          execute: async (args, api) =>
            change({ type: "have_all", lineId: args.lineId }, api),
        }),
        defineTool({
          name: "set_recipe_servings",
          description:
            "Change servings for a selected recipe when asked. Read the selection for the item ID.",
          parameters: Type.Object({
            itemId: Type.String(),
            servings: Type.Number({ exclusiveMinimum: 0 }),
          }),
          replay: "safe",
          execute: async (args, api) =>
            json(
              await selectionMutation(
                prisma,
                await run(api),
                api,
                async (selection) => {
                  if (!selection.items.some((item) => item.id === args.itemId))
                    throw new Error("Selected recipe not found.");
                  return {
                    type: "replace_items",
                    items: selection.items.map((item) =>
                      item.id === args.itemId
                        ? { ...item, servings: args.servings }
                        : item,
                    ),
                  };
                },
              ),
            ),
        }),
        defineTool({
          name: "rename_selection",
          description: "Change the selection title when asked.",
          parameters: Type.Object({ title: Type.String({ minLength: 1 }) }),
          replay: "safe",
          execute: async (args, api) =>
            change({ type: "rename", title: args.title }, api),
        }),
      ],
      hooks: [
        hook(GenerationTask, {
          beforeRequest: async (_request, api) => {
            requestLimitError = "Meal run context is missing.";
            const context = await api.snapshot(
              MealRun,
              api.conversationId,
              mealContext,
            );
            if (!context) throw new Error("Meal run context missing.");
            requestLimitError =
              context.turns >= maxTurns ||
              Date.now() - context.startedAt > timeoutMs
                ? "Meal assistant reached its configured run limit."
                : undefined;
            if (requestLimitError) return undefined;
            await host.harness.commit(async (tx) => {
              (await tx.doc(MealRun, api.conversationId)).turns++;
            }, mealContext);
            return undefined;
          },
        }),
      ],
    }),
  );
  const maxOutputTokens = Number(
    process.env.PI_MEALS_MAX_OUTPUT_TOKENS ?? 2048,
  );
  if (!Number.isSafeInteger(maxOutputTokens) || maxOutputTokens < 1)
    throw new Error("Invalid meal output token limit.");
  const boundedModels: Models = new Proxy(models, {
    get(target, key) {
      if (key === "streamSimple")
        return ((ref, context, streamOptions) => {
          if (requestLimitError) throw new Error(requestLimitError);
          return models.streamSimple(ref, context, {
            ...streamOptions,
            maxTokens: maxOutputTokens,
          });
        }) as Models["streamSimple"];
      const value = Reflect.get(target, key);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
  let host: Awaited<ReturnType<typeof openMealDurable>>;
  try {
    host = await openMealDurable({
      models: boundedModels,
      registry,
      runtimeDir: options.runtimeDir,
      timeoutMs,
    });
  } catch (error) {
    const reason = `Meal assistant storage is unavailable: ${error instanceof Error ? error.message : String(error)}`;
    return {
      status: () => ({ available: false, status: "unavailable", reason }),
      submit: async (
        actorId: string,
        operationId: string,
        _selectionId: string,
        _message: string,
      ): Promise<AssistantResult> => ({
        requestId: `meal_${digest([actorId, operationId])}`,
        status: "unavailable",
        message: reason,
      }),
      get: (actorId: string, id: string) => storedMessage(prisma, actorId, id),
      close: async () => {},
    };
  }
  let closing = false;
  let dispatch: Promise<void> | undefined;
  let dispatchError: unknown;
  let recovery: ReturnType<typeof setTimeout> | undefined;
  let recoveryAttempts = 0;
  const dispatchPending = () => {
    if (dispatch || closing) return;
    if (recovery) {
      clearTimeout(recovery);
      recovery = undefined;
    }
    dispatchError = undefined;
    dispatch = (async () => {
      while (!closing) {
        const row = await prisma.piMealOutbox.findFirst({
          where: {
            id: { startsWith: "meal_" },
            status: { in: ["pending", "running"] },
          },
          orderBy: { createdAt: "asc" },
        });
        if (!row) {
          recoveryAttempts = 0;
          return;
        }
        const payload = row.payload as unknown as Payload;
        const conversation = await mealConversation(
          host.harness,
          JSON.stringify([row.actorId, row.documentId]),
          model!,
        );
        const context = await host.harness.snapshot(
          MealRun,
          conversation.id,
          mealContext,
        );
        if (context?.requestId !== row.id)
          await conversation.commit(async (tx) => {
            Object.assign(await tx.doc(MealRun, conversation.id), {
              actorId: row.actorId,
              selectionId: row.documentId,
              requestId: row.id,
              turns: 0,
              startedAt: Date.now(),
            });
          }, mealContext);
        await prisma.piMealOutbox.update({
          where: { id: row.id },
          data: { status: "running" },
        });
        let timer: ReturnType<typeof setTimeout> | undefined;
        let terminal:
          { status: string; payload: Prisma.InputJsonValue } | undefined;
        try {
          const submission = await conversation.submit(
            {
              type: "input",
              content: payload.message,
              requestId: row.id,
              whenBusy: "followUp",
            },
            mealContext,
          );
          timer = setTimeout(
            () => {
              void conversation.abort(mealContext).catch(() => {});
            },
            Math.max(
              1,
              timeoutMs -
                (Date.now() -
                  (context?.requestId === row.id
                    ? context.startedAt
                    : Date.now())),
            ),
          );
          const settled = await submission.wait(mealContext);
          if (closing) return;
          if (settled.status !== "done" || settled.type !== "input")
            throw new Error(
              "Meal assistant could not finish this message within its limits.",
            );
          const answer = await conversation.commit(
            (tx) => tx.entry(settled.answer),
            mealContext,
          );
          const content = (
            answer?.model?.[0] as unknown as {
              content?: Array<{ type: string; text?: string }>;
            }
          )?.content;
          const result =
            content
              ?.filter((block) => block.type === "text")
              .map((block) => block.text ?? "")
              .join("\n") ?? "";
          terminal = {
            status: "complete",
            payload: { ...payload, result } as Prisma.InputJsonValue,
          };
        } catch (error) {
          if (closing) return;
          terminal = {
            status: "failed",
            payload: {
              ...payload,
              error: error instanceof Error ? error.message : String(error),
            } as Prisma.InputJsonValue,
          };
        } finally {
          if (timer) clearTimeout(timer);
        }
        if (terminal)
          await prisma.piMealOutbox.update({
            where: { id: row.id },
            data: terminal,
          });
      }
    })()
      .catch((error) => {
        dispatchError = error;
      })
      .finally(() => {
        dispatch = undefined;
        if (dispatchError && !closing && recoveryAttempts < 3) {
          recoveryAttempts++;
          recovery = setTimeout(
            () => {
              recovery = undefined;
              dispatchPending();
            },
            100 * 2 ** (recoveryAttempts - 1),
          );
        }
      });
  };
  const get = (actorId: string, id: string) =>
    storedMessage(prisma, actorId, id);
  dispatchPending();
  return {
    status: () => ({
      available: true,
      status: dispatchError ? "failed" : closing ? "closing" : "ready",
      ...(dispatchError
        ? {
            reason:
              dispatchError instanceof Error
                ? dispatchError.message
                : String(dispatchError),
          }
        : {}),
    }),
    async submit(
      actorId: string,
      operationId: string,
      selectionId: string,
      message: string,
    ): Promise<AssistantResult> {
      if (closing) throw new Error("Meal assistant is shutting down.");
      const requestId = `meal_${digest([actorId, operationId])}`;
      const prior = await prisma.piMealOutbox.findUnique({
        where: { id: requestId },
      });
      if (prior) {
        const p = prior.payload as unknown as Payload;
        if (prior.documentId !== selectionId || p.message !== message)
          throw Object.assign(
            new Error("Message operation ID was reused with different input."),
            { statusCode: 409 },
          );
      } else {
        if (!(await getSelection(prisma, selectionId)))
          throw Object.assign(new Error("Recipe selection not found."), {
            statusCode: 404,
          });
        await prisma.piMealOutbox.upsert({
          where: { id: requestId },
          create: {
            id: requestId,
            actorId,
            documentId: selectionId,
            payload: { message, selectionId },
          },
          update: {},
        });
      }
      const admitted = await prisma.piMealOutbox.findUnique({
        where: { id: requestId },
      });
      const admittedPayload = admitted?.payload as unknown as Payload;
      if (
        admitted?.documentId !== selectionId ||
        admittedPayload?.message !== message
      )
        throw Object.assign(
          new Error("Message operation ID was reused with different input."),
          { statusCode: 409 },
        );
      dispatchPending();
      return (await get(actorId, requestId))!;
    },
    get,
    async close() {
      closing = true;
      if (recovery) {
        clearTimeout(recovery);
        recovery = undefined;
      }
      await host.close();
      await dispatch;
    },
  };
}
export type MealAssistant = Awaited<ReturnType<typeof createMealAssistant>>;
