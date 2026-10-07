import type { FastifyInstance } from 'fastify'
import { getMealActorId } from './auth.js'
import { basketHandoff, createBasket, fillBasket, getBasket, prepareBasket, reconcileBasket } from './baskets.js'
import { withOcadoExecutor } from './ocado.js'
import type { BasketManifestLine } from './contracts.js'
export default async function basketRoutes(fastify:FastifyInstance){
  fastify.post<{Body:{operationId:string;selectionId:string;executor?:'aside'|'ocado'}}>('/',async(request,reply)=>reply.code(201).send(await createBasket(fastify.prisma,getMealActorId(request),request.body)))
  fastify.get<{Params:{id:string}}>('/:id',async(request,reply)=>(await getBasket(fastify.prisma,request.params.id))??reply.code(404).send({error:'Basket not found.'}))
  fastify.get<{Params:{id:string}}>('/:id/handoff',async(request,reply)=>{const basket=await getBasket(fastify.prisma,request.params.id);return basket?{basketId:basket.id,revision:basket.revision,executor:basket.executor,taskId:basket.taskId,text:basketHandoff(basket)}:reply.code(404).send({error:'Basket not found.'})})
  fastify.post<{Params:{id:string};Body:{operationId:string;expectedRevision:number;lines:BasketManifestLine[]}}>('/:id/prepare',async(request)=>prepareBasket(fastify.prisma,request.params.id,getMealActorId(request),request.body))
  fastify.post<{Params:{id:string};Body:{operationId:string;expectedRevision:number;selectionRevision:number}}>('/:id/fill',async(request)=>{
    const basket=await getBasket(fastify.prisma,request.params.id),actor=getMealActorId(request)
    if(request.body?.operationId&&await fastify.prisma.piMealOperation.findUnique({where:{id:request.body.operationId}}))return fillBasket(fastify.prisma,request.params.id,actor,request.body)
    if(basket?.executor==='ocado'&&process.env.PI_MEALS_CART_MUTATIONS_ENABLED==='true')return withOcadoExecutor(fastify.prisma,basket.lines,executor=>fillBasket(fastify.prisma,request.params.id,actor,request.body,{executor}))
    return fillBasket(fastify.prisma,request.params.id,actor,request.body)
  })
  fastify.post<{Params:{id:string};Body:{operationId:string;expectedRevision:number}}>('/:id/reconcile',async(request)=>{
    const basket=await getBasket(fastify.prisma,request.params.id),actor=getMealActorId(request)
    if(basket?.executor==='ocado'&&process.env.PI_MEALS_CART_MUTATIONS_ENABLED==='true')return withOcadoExecutor(fastify.prisma,basket.lines,executor=>reconcileBasket(fastify.prisma,request.params.id,actor,request.body,{executor}))
    return reconcileBasket(fastify.prisma,request.params.id,actor,request.body)
  })
}
