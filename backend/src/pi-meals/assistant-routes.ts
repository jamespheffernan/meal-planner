import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { getMealActorId } from './auth.js'
import { createMealAssistant, type MealAssistant } from './assistant.js'
const messageSchema=z.object({operationId:z.string().trim().min(1).max(200),selectionId:z.string().trim().min(1).max(200),message:z.string().trim().min(1).max(12000)}).strict()
const assistants=new WeakMap<FastifyInstance,MealAssistant>()
export async function closeMealAssistant(fastify:FastifyInstance){await assistants.get(fastify)?.close();assistants.delete(fastify)}
export default async function assistantRoutes(fastify:FastifyInstance){
  const assistant=await createMealAssistant(fastify.prisma)
  assistants.set(fastify,assistant)
  fastify.addHook('onClose',async()=>{await assistant.close();assistants.delete(fastify)})
  fastify.get('/status',async()=>assistant.status())
  fastify.post('/messages',async(request,reply)=>{
    const parsed=messageSchema.safeParse(request.body)
    if(!parsed.success)return reply.code(400).send({error:parsed.error.issues.map(i=>i.message).join('; ')})
    const {operationId,selectionId,message}=parsed.data
    return reply.code(202).send(await assistant.submit(getMealActorId(request),operationId,selectionId,message))
  })
  fastify.get<{Params:{requestId:string}}>('/messages/:requestId',async(request,reply)=>{
    const result=await assistant.get(getMealActorId(request),request.params.requestId)
    return result??reply.code(404).send({error:'Assistant message not found.'})
  })
}
