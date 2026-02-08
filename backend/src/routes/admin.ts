import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify'
import { normalizeUnits } from '../scripts/normalize-units.js'
import { normalizeIngredientNames } from '../scripts/normalize-ingredient-names.js'
import { cleanupGarbageIngredients } from '../scripts/cleanup-garbage-ingredients.js'
import { createIngredientsFromReceipts } from '../scripts/create-ingredients-from-receipts.js'
import { normalizeIngredients } from '../scripts/normalize-ingredients.js'

type ApplyBody = { apply?: boolean }

function requireAdmin(request: FastifyRequest, reply: FastifyReply) {
  const token = process.env.MEAL_PLANNER_ADMIN_TOKEN || process.env.ADMIN_TOKEN
  if (!token) return
  const provided = request.headers['x-admin-token']
  if (provided !== token) {
    return reply.status(401).send({ error: 'Unauthorized' })
  }
}

export default async function adminRoutes(fastify: FastifyInstance) {
  fastify.post<{ Body: ApplyBody }>('/normalize-units', { preHandler: requireAdmin }, async (request) => {
    const apply = Boolean(request.body?.apply)
    const result = await normalizeUnits({ apply })
    return result
  })

  fastify.post('/normalize-ingredient-names', { preHandler: requireAdmin }, async () => {
    const result = await normalizeIngredientNames()
    return result
  })

  fastify.post<{ Body: ApplyBody }>('/cleanup-garbage-ingredients', { preHandler: requireAdmin }, async (request) => {
    const apply = Boolean(request.body?.apply)
    const result = await cleanupGarbageIngredients({ apply })
    return result
  })

  fastify.post<{ Body: ApplyBody }>('/create-ingredients-from-receipts', { preHandler: requireAdmin }, async (request) => {
    const apply = Boolean(request.body?.apply)
    const result = await createIngredientsFromReceipts({ apply })
    return result
  })

  fastify.post<{ Body: ApplyBody }>('/normalize-ingredients', { preHandler: requireAdmin }, async (request) => {
    const apply = Boolean(request.body?.apply)
    const result = await normalizeIngredients({ apply })
    return result
  })
}
