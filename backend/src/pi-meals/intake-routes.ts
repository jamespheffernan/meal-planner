import type {FastifyInstance} from 'fastify'
import {getMealActorId} from './auth.js'
import type {RecipeDraft} from './contracts.js'
import {readDocument} from './store.js'
import {createDraft,patchDraft,saveDraft,intakeSchema,patchSchema,saveSchema} from './intake.js'
export default async function intakeRoutes(fastify:FastifyInstance){
 fastify.post('/',async(request,reply)=>{const body=intakeSchema.safeParse(request.body);if(!body.success)return reply.code(400).send({error:body.error.message});return createDraft(fastify.prisma,getMealActorId(request),body.data)})
 fastify.get<{Params:{id:string}}>('/:id',async(request,reply)=>{getMealActorId(request);const row=await readDocument<RecipeDraft>(fastify.prisma,request.params.id,'recipe-draft');if(!row)return reply.code(404).send({error:'Recipe draft not found.'});return {...row.data,revision:row.revision}})
 fastify.patch<{Params:{id:string}}>('/:id',async(request,reply)=>{const body=patchSchema.safeParse(request.body);if(!body.success)return reply.code(400).send({error:body.error.message});return patchDraft(fastify.prisma,getMealActorId(request),request.params.id,body.data)})
 fastify.post<{Params:{id:string}}>('/:id/save',async(request,reply)=>{const body=saveSchema.safeParse(request.body);if(!body.success)return reply.code(400).send({error:body.error.message});return saveDraft(fastify.prisma,getMealActorId(request),request.params.id,body.data)})
}
