import Fastify from 'fastify'
import cors from '@fastify/cors'
import sensible from '@fastify/sensible'
import multipart from '@fastify/multipart'
import prismaPlugin from './plugins/prisma.js'
import recipeRoutes from './routes/recipes.js'
import ingredientRoutes from './routes/ingredients.js'
import mealPlanRoutes from './routes/meal-plans.js'
import shoppingListRoutes from './routes/shopping-lists.js'
import pantryRoutes from './routes/pantry.js'
import ingestionRoutes from './routes/ingestion.js'
import preferencesRoutes from './routes/preferences.js'
import recommendationRoutes from './routes/recommendations.js'
import settingsRoutes from './routes/settings.js'
import adminRoutes from './routes/admin.js'
import discoveryRoutes from './routes/discovery.js'
import storesRoutes from './routes/stores.js'
import budgetRoutes from './routes/budget.js'
import staplesRoutes from './routes/staples.js'
import shoppingAssistantRoutes from './routes/shopping-assistant.js'
import ordersRoutes from './routes/orders.js'

const fastify = Fastify({
  logger: true,
  bodyLimit: 50 * 1024 * 1024, // 50MB limit for base64 images
})

async function start() {
  // Register plugins
  await fastify.register(cors, { origin: true })
  await fastify.register(sensible)
  await fastify.register(multipart, { limits: { fileSize: 10 * 1024 * 1024 } }) // 10MB limit
  await fastify.register(prismaPlugin)

  // Register routes
  await fastify.register(recipeRoutes, { prefix: '/api/recipes' })
  await fastify.register(ingredientRoutes, { prefix: '/api/ingredients' })
  await fastify.register(mealPlanRoutes, { prefix: '/api/meal-plans' })
  await fastify.register(shoppingListRoutes, { prefix: '/api/shopping-lists' })
  await fastify.register(pantryRoutes, { prefix: '/api/pantry' })
  await fastify.register(ingestionRoutes, { prefix: '/api/import' })
  await fastify.register(preferencesRoutes, { prefix: '/api/preferences' })
  await fastify.register(recommendationRoutes, { prefix: '/api/recommendations' })
  await fastify.register(settingsRoutes, { prefix: '/api/settings' })
  await fastify.register(adminRoutes, { prefix: '/api/admin' })
  await fastify.register(discoveryRoutes, { prefix: '/api/discovery' })
  await fastify.register(storesRoutes, { prefix: '/api/stores' })
  await fastify.register(budgetRoutes, { prefix: '/api/budget' })
  await fastify.register(staplesRoutes, { prefix: '/api/staples' })
  await fastify.register(shoppingAssistantRoutes, { prefix: '/api/shopping-assistant' })
  await fastify.register(ordersRoutes, { prefix: '/api/orders' })

  // Health check
  fastify.get('/health', async () => ({ status: 'ok' }))

  const port = parseInt(process.env.PORT || '3001', 10)
  const host = process.env.HOST || '0.0.0.0'

  try {
    await fastify.listen({ port, host })
  } catch (err) {
    fastify.log.error(err)
    process.exit(1)
  }
}

start()
