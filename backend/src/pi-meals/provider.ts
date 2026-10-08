import { homedir } from "node:os";
import { isAbsolute, join } from "node:path";
import { pathToFileURL } from "node:url";
import type { CredentialStore, Models } from "@earendil-works/pi-ai";
export class MealProviderUnavailable extends Error {}
async function loadInstalledModule(root: string, name: string) {
  try {
    return await import(pathToFileURL(join(root, "dist/core", name)).href);
  } catch {
    throw new MealProviderUnavailable(
      `Installed Pi SDK module ${name} is unavailable at ${root}. Set PI_MEALS_PI_SDK_ROOT.`,
    );
  }
}
/** Use Pi's authorised provider runtime and its locked credential store. No token copies or raw token adapters. */
export async function sharedPiMealModels(
  provider: string,
  modelId: string,
): Promise<Models> {
  const root =
    process.env.PI_MEALS_PI_SDK_ROOT ??
    join(
      homedir(),
      ".bun/install/global/node_modules/@earendil-works/pi-coding-agent",
    );
  if (!isAbsolute(root))
    throw new MealProviderUnavailable(
      "PI_MEALS_PI_SDK_ROOT must be an absolute installed Pi package path.",
    );
  const authModule = (await loadInstalledModule(root, "auth-storage.js")) as {
    AuthStorage: { create(path: string): CredentialStore };
  };
  const credentials = authModule.AuthStorage.create(
    join(homedir(), ".pi/agent/auth.json"),
  );
  if (
    !["read", "modify", "list", "delete"].every(
      (key) => typeof Reflect.get(credentials, key) === "function",
    )
  )
    throw new MealProviderUnavailable(
      "Installed Pi auth store is incompatible.",
    );
  const runtimeModule = (await loadInstalledModule(
    root,
    "model-runtime.js",
  )) as {
    ModelRuntime: {
      create(options: {
        credentials: CredentialStore;
        modelsPath: string;
        allowModelNetwork: boolean;
        signal: AbortSignal;
      }): Promise<Models & { getError(): string | undefined }>;
    };
  };
  const runtime = await runtimeModule.ModelRuntime.create({
    credentials,
    modelsPath: join(homedir(), ".pi/agent/models.json"),
    allowModelNetwork: false,
    signal: AbortSignal.timeout(30000),
  });
  if (runtime.getError())
    throw new MealProviderUnavailable(
      "Pi model configuration could not be loaded.",
    );
  if (!runtime.getModel(provider, modelId))
    throw new MealProviderUnavailable(
      "Requested meal model is absent from the installed Pi catalog.",
    );
  const available = await runtime.getAvailable(provider, {
    signal: AbortSignal.timeout(30000),
  });
  if (
    !available.some(
      (model) => model.provider === provider && model.id === modelId,
    )
  )
    throw new MealProviderUnavailable(
      "Pi has no authorised login for the requested meal model.",
    );
  return runtime;
}
