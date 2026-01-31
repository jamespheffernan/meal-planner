import Fastify from 'fastify'
import cors from '@fastify/cors'
import sensible from '@fastify/sensible'
import prismaPlugin from './plugins/prisma.js'
import recipeRoutes from './routes/recipes.js'
import ingredientRoutes from './routes/ingredients.js'
import mealPlanRoutes from './routes/meal-plans.js'
import shoppingListRoutes from './routes/shopping-lists.js'
import pantryRoutes from './routes/pantry.js'

const fastify = Fastify({
  logger: true,
})

async function start() {
  // Register plugins
  await fastify.register(cors, { origin: true })
  await fastify.register(sensible)
  await fastify.register(prismaPlugin)

  // Register routes
  await fastify.register(recipeRoutes, { prefix: '/api/recipes' })
  await fastify.register(ingredientRoutes, { prefix: '/api/ingredients' })
  await fastify.register(mealPlanRoutes, { prefix: '/api/meal-plans' })
  await fastify.register(shoppingListRoutes, { prefix: '/api/shopping-lists' })
  await fastify.register(pantryRoutes, { prefix: '/api/pantry' })

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
