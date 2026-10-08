import Fastify from "fastify";
import { installLegacyEffectBoundary } from "./pi-meals/legacy-effects.js";
import { installMealAuth } from "./pi-meals/auth.js";
import selectionRoutes from "./pi-meals/selection-routes.js";
import intakeRoutes from "./pi-meals/intake-routes.js";
import basketRoutes from "./pi-meals/basket-routes.js";
import assistantRoutes from "./pi-meals/assistant-routes.js";
import weekRoutes from "./pi-meals/week-routes.js";
import householdRoutes from "./pi-meals/household-routes.js";
import shoppingCycleRoutes from "./pi-meals/shopping-cycle-routes.js";
import cors from "@fastify/cors";
import sensible from "@fastify/sensible";
import multipart from "@fastify/multipart";
import prismaPlugin from "./plugins/prisma.js";
import recipeRoutes from "./routes/recipes.js";
import ingredientRoutes from "./routes/ingredients.js";
import mealPlanRoutes from "./routes/meal-plans.js";
import shoppingListRoutes from "./routes/shopping-lists.js";
import pantryRoutes from "./routes/pantry.js";
import ingestionRoutes from "./routes/ingestion.js";
import preferencesRoutes from "./routes/preferences.js";
import recommendationRoutes from "./routes/recommendations.js";
import settingsRoutes from "./routes/settings.js";
import adminRoutes from "./routes/admin.js";
import discoveryRoutes from "./routes/discovery.js";
import storesRoutes from "./routes/stores.js";
import budgetRoutes from "./routes/budget.js";
import staplesRoutes from "./routes/staples.js";
import shoppingAssistantRoutes from "./routes/shopping-assistant.js";
import ordersRoutes from "./routes/orders.js";
import mappingsRoutes from "./routes/mappings.js";

export async function buildApp() {
  const fastify = Fastify({
    logger: true,
    bodyLimit: 50 * 1024 * 1024, // 50MB limit for base64 images
  });

  // Register plugins
  await fastify.register(cors, {
    origin: (
      process.env.PI_MEALS_ALLOWED_ORIGINS ||
      "http://localhost:3100,http://127.0.0.1:3100"
    ).split(","),
    credentials: true,
  });
  await installMealAuth(fastify);
  installLegacyEffectBoundary(fastify);
  await fastify.register(sensible);
  await fastify.register(multipart, { limits: { fileSize: 10 * 1024 * 1024 } }); // 10MB limit
  await fastify.register(prismaPlugin);

  // Register routes
  await fastify.register(recipeRoutes, { prefix: "/api/recipes" });
  await fastify.register(ingredientRoutes, { prefix: "/api/ingredients" });
  await fastify.register(mealPlanRoutes, { prefix: "/api/meal-plans" });
  await fastify.register(shoppingListRoutes, { prefix: "/api/shopping-lists" });
  await fastify.register(pantryRoutes, { prefix: "/api/pantry" });
  await fastify.register(ingestionRoutes, { prefix: "/api/import" });
  await fastify.register(preferencesRoutes, { prefix: "/api/preferences" });
  await fastify.register(recommendationRoutes, {
    prefix: "/api/recommendations",
  });
  await fastify.register(settingsRoutes, { prefix: "/api/settings" });
  await fastify.register(adminRoutes, { prefix: "/api/admin" });
  await fastify.register(discoveryRoutes, { prefix: "/api/discovery" });
  await fastify.register(storesRoutes, { prefix: "/api/stores" });
  await fastify.register(budgetRoutes, { prefix: "/api/budget" });
  await fastify.register(staplesRoutes, { prefix: "/api/staples" });
  await fastify.register(shoppingAssistantRoutes, {
    prefix: "/api/shopping-assistant",
  });
  await fastify.register(ordersRoutes, { prefix: "/api/orders" });
  await fastify.register(mappingsRoutes, { prefix: "/api/mappings" });

  await fastify.register(selectionRoutes, {
    prefix: "/api/pi-meals/selections",
  });
  await fastify.register(intakeRoutes, { prefix: "/api/pi-meals/intake" });
  await fastify.register(basketRoutes, { prefix: "/api/pi-meals/baskets" });
  await fastify.register(assistantRoutes, {
    prefix: "/api/pi-meals/assistant",
  });
  await fastify.register(weekRoutes, { prefix: "/api/pi-meals/weeks" });

  await fastify.register(householdRoutes, {
    prefix: "/api/pi-meals/household",
  });
  await fastify.register(shoppingCycleRoutes, {
    prefix: "/api/pi-meals/shopping",
  });

  // Health check
  fastify.get("/health", async () => ({ status: "ok" }));

  return fastify;
}
