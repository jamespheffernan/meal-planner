import { createHash } from 'node:crypto'
import type { PrismaClient } from '@prisma/client'
import { z } from 'zod'
import type { BasketManifestLine, BasketProposal, RecipeSelection } from './contracts.js'
import { canonicalUnit } from './compiler.js'
import { getSelection } from './selections.js'
import { MealConflict, mutateDocument, readDocument, type MealDocument } from './store.js'
import { asideAvailability, basketHandoff } from './aside.js'

type BasketData = Omit<BasketProposal,'id'|'revision'>
export interface CartObservation { verified:true; items:Array<{productId:string;quantity:number}>; evidence:unknown }
export interface BasketExecutor {
  /** A complete verified observation. Extraction failure must throw, never return an empty cart. */
  readCart():Promise<CartObservation>
  /** Exactly one attempt. No internal retries after an uncertain write. */
  addPacks(productId:string,packs:number):Promise<void>
}
export interface BasketDependencies { executor?:BasketExecutor; mutationsEnabled?:boolean }
const text=z.string().trim().min(1)
const revision=z.number().int().nonnegative()
export const createBasketSchema=z.object({operationId:text,selectionId:text,executor:z.enum(['aside','ocado']).optional()}).strict()
const manifestLine=z.object({id:text,name:text,quantity:z.number().finite().positive(),unit:text,productId:text.optional(),productName:text.optional(),packQuantity:z.number().finite().positive().optional(),packUnit:text.optional(),packs:z.number().int().positive().optional(),price:z.number().finite().nonnegative().optional(),baselineQuantity:z.number().int().nonnegative().optional()}).strict()
export const prepareBasketSchema=z.object({operationId:text,expectedRevision:revision,lines:z.array(manifestLine)}).strict()
export const fillBasketSchema=z.object({operationId:text,expectedRevision:revision,selectionRevision:revision}).strict()
export const reconcileBasketSchema=z.object({operationId:text,expectedRevision:revision}).strict()
function parse<T>(schema:z.ZodType<T>,input:unknown):T{const result=schema.safeParse(input);if(!result.success)throw Object.assign(new Error(result.error.message),{statusCode:400});return result.data}
function view(doc:MealDocument<BasketData>):BasketProposal{return {id:doc.id,revision:doc.revision,...doc.data}}
function required(current:BasketData|null):BasketData{if(!current)throw Object.assign(new Error('Basket not found.'),{statusCode:404});return current}
export async function getBasket(prisma:PrismaClient,id:string){const doc=await readDocument<BasketData>(prisma,id,'basket');return doc?view(doc):null}
function selectionLines(selection:RecipeSelection):BasketManifestLine[]{return selection.lines.filter(l=>l.buyQuantity===null||l.buyQuantity>0).map(l=>({id:l.id,name:l.name,quantity:l.buyQuantity??0,unit:l.unit}))}
export function reviewManifest(selection:RecipeSelection,lines:BasketManifestLine[]):BasketManifestLine[]{
  const expected=selectionLines(selection)
  if(!expected.length||expected.some(l=>l.quantity<=0))throw Object.assign(new Error('Resolve ingredient quantities before preparing a non-empty basket.'),{statusCode:400})
  if(lines.length!==expected.length||new Set(lines.map(l=>l.id)).size!==lines.length)throw Object.assign(new Error('Manifest must cover every shopping line exactly once.'),{statusCode:400})
  const products=new Set<string>()
  return expected.map(source=>{
    const line=lines.find(l=>l.id===source.id)
    if(!line||line.quantity!==source.quantity||line.unit!==source.unit||!line.productId||!line.productName||!line.packQuantity||!line.packUnit)throw Object.assign(new Error('Each shopping line needs reviewed product and pack details matching the selection.'),{statusCode:400})
    if(products.has(line.productId))throw Object.assign(new Error('Combine shopping lines that use the same product before review.'),{statusCode:400})
    products.add(line.productId)
    const buy=canonicalUnit(source.unit),pack=canonicalUnit(line.packUnit)
    if(buy.unit!==pack.unit)throw Object.assign(new Error('Product pack unit does not match ingredient unit.'),{statusCode:400})
    const packs=Math.ceil(source.quantity*buy.factor/(line.packQuantity*pack.factor))
    if(!Number.isSafeInteger(packs)||packs<1||(line.packs!==undefined&&line.packs!==packs))throw Object.assign(new Error('Reviewed pack count does not cover the shopping quantity.'),{statusCode:400})
    const {baselineQuantity:_,...clean}=line
    return {...clean,name:source.name,packs}
  })
}
export async function createBasket(prisma:PrismaClient,actorId:string,input:{operationId:string;selectionId:string;executor?:'aside'|'ocado'}){
  const parsed=parse(createBasketSchema,input),selection=await getSelection(prisma,parsed.selectionId)
  if(!selection)throw Object.assign(new Error('Recipe selection not found.'),{statusCode:404})
  const id=`basket_${createHash('sha256').update(JSON.stringify([actorId,parsed.operationId])).digest('hex').slice(0,24)}`
  return view(await mutateDocument<BasketData>(prisma,{id,kind:'basket',actorId,operationId:parsed.operationId,expectedRevision:0,payload:parsed,reduce:()=>({selectionId:selection.id,selectionRevision:selection.revision,executor:parsed.executor??'aside',status:'draft',lines:selectionLines(selection),unresolved:['Review product IDs, pack sizes, and quantities before filling.']})}))
}
export async function prepareBasket(prisma:PrismaClient,id:string,actorId:string,input:{operationId:string;expectedRevision:number;lines:BasketManifestLine[]}){
  const parsed=parse(prepareBasketSchema,input)
  if(await prisma.piMealOperation.findUnique({where:{id:parsed.operationId}}))return view(await mutateDocument<BasketData>(prisma,{id,kind:'basket',actorId,operationId:parsed.operationId,expectedRevision:parsed.expectedRevision,payload:parsed,reduce:()=>{throw new Error('Missing operation receipt')}}))
  const basket=await getBasket(prisma,id)
  if(!basket)throw Object.assign(new Error('Basket not found.'),{statusCode:404})
  const selection=await getSelection(prisma,basket.selectionId)
  if(!selection||selection.revision!==basket.selectionRevision)throw new MealConflict('The recipe selection changed. Create a new basket.')
  const lines=reviewManifest(selection,parsed.lines)
  return view(await mutateDocument<BasketData>(prisma,{id,kind:'basket',actorId,operationId:parsed.operationId,expectedRevision:parsed.expectedRevision,payload:parsed,reduce:current=>{const data=required(current);if(data.status==='running'||data.receipt)throw new MealConflict('An execution already exists. Reconcile it before creating another basket.');return {...data,lines,status:'ready',unresolved:[]}}}))
}
function observation(input:CartObservation):CartObservation{
  if(input?.verified!==true||!Array.isArray(input.items)||input.evidence===undefined||input.evidence===null||new Set(input.items.map(i=>i.productId)).size!==input.items.length||input.items.some(i=>!i.productId||!Number.isSafeInteger(i.quantity)||i.quantity<0))throw new Error('Cart read failed: complete structured evidence is required.')
  return input
}
export function verifyReadback(baseline:CartObservation,after:CartObservation,lines:BasketManifestLine[]):string[]{
  observation(baseline);observation(after)
  const targets=new Map(baseline.items.map(i=>[i.productId,i.quantity]))
  for(const line of lines)targets.set(line.productId!, (targets.get(line.productId!)??0)+line.packs!)
  const actual=new Map(after.items.map(i=>[i.productId,i.quantity])),issues:string[]=[]
  for(const [id,quantity] of targets)if((actual.get(id)??0)!==quantity)issues.push(`Product ${id}: expected ${quantity}, observed ${actual.get(id)??0}.`)
  for(const [id,quantity] of actual)if(!targets.has(id)&&quantity>0)issues.push(`Unexpected product ${id} appeared in the trolley.`)
  return issues
}
export async function fillBasket(prisma:PrismaClient,id:string,actorId:string,input:{operationId:string;expectedRevision:number;selectionRevision:number},deps:BasketDependencies={}){
  const parsed=parse(fillBasketSchema,input)
  const prior=await prisma.piMealOperation.findUnique({where:{id:parsed.operationId}})
  // Replay goes through store hashing, so a reused ID cannot change its request.
  if(prior){const replay=await mutateDocument<BasketData>(prisma,{id,kind:'basket',actorId,operationId:parsed.operationId,expectedRevision:parsed.expectedRevision,payload:parsed,reduce:()=>{throw new Error('Missing operation receipt')}});return view(replay)}
  const basket=await getBasket(prisma,id)
  if(!basket)throw Object.assign(new Error('Basket not found.'),{statusCode:404})
  const selection=await getSelection(prisma,basket.selectionId)
  if(!selection||selection.revision!==basket.selectionRevision||parsed.selectionRevision!==selection.revision)throw new MealConflict('The recipe selection changed. Review a new basket before filling.')
  reviewManifest(selection,basket.lines)
  const enabled=deps.mutationsEnabled??process.env.PI_MEALS_CART_MUTATIONS_ENABLED==='true'
  const supported=basket.executor==='ocado'&&enabled&&!!deps.executor
  const started=await mutateDocument<BasketData>(prisma,{id,kind:'basket',actorId,operationId:parsed.operationId,expectedRevision:parsed.expectedRevision,payload:parsed,reduce:current=>{const data=required(current);if(data.status!=='ready'||data.receipt)throw new MealConflict('Basket execution already started or is not reviewed.');return {...data,status:supported?'running':'needs_review',taskId:`basket-task:${id}:${parsed.operationId}`,unresolved:supported?[]:[basket.executor==='aside'?asideAvailability:'Automatic cart mutations are disabled or no verified Ocado adapter is configured.'],receipt:{effect:'fill_requested',operationId:parsed.operationId,uncertain:supported,checkout:false}}}})
  if(!supported)return view(started)
  let current=started,baseline:CartObservation|undefined,after:CartObservation|undefined,intent:unknown
  const save=async(data:BasketData,label:string)=>{current=await mutateDocument<BasketData>(prisma,{id,kind:'basket',actorId,operationId:`${parsed.operationId}:${label}`,expectedRevision:current.revision,payload:data,reduce:()=>data})}
  try{
    baseline=observation(await deps.executor!.readCart())
    await save({...current.data,receipt:{effect:'baseline_read',baseline,uncertain:false,checkout:false}},'baseline')
    for(let index=0;index<basket.lines.length;index++){
      const line=basket.lines[index];intent={productId:line.productId,packs:line.packs,targetQuantity:(baseline.items.find(i=>i.productId===line.productId)?.quantity??0)+line.packs!}
      await save({...current.data,receipt:{effect:'write_intent',baseline,intent,uncertain:true,checkout:false}},`intent-${index}`)
      const liveSelection=await getSelection(prisma,basket.selectionId)
      if(!liveSelection||liveSelection.revision!==basket.selectionRevision)throw new MealConflict('The selection changed during execution. Stop and review the trolley.')
      await deps.executor!.addPacks(line.productId!,line.packs!)
    }
    after=observation(await deps.executor!.readCart())
    const unresolved=verifyReadback(baseline,after,basket.lines)
    await save({...current.data,status:unresolved.length?'needs_review':'complete',unresolved,receipt:{effect:'readback',baseline,after,uncertain:unresolved.length>0,checkout:false}},'result')
  }catch(error){await save({...current.data,status:'needs_review',unresolved:[error instanceof Error?error.message:'Cart execution failed.'],receipt:{effect:intent?'write_uncertain':'read_failed',...(baseline?{baseline}:{}),...(intent?{intent}:{}),...(after?{after}:{}),uncertain:!!intent,checkout:false}},'failure')}
  // Seal the original operation receipt with the final observed result. Duplicate calls
  // during execution return running; they never execute effects again.
  await prisma.piMealOperation.update({where:{id:parsed.operationId},data:{result:JSON.parse(JSON.stringify(current))}})
  return view(current)
}
export async function reconcileBasket(prisma:PrismaClient,id:string,actorId:string,input:{operationId:string;expectedRevision:number},deps:BasketDependencies={}){
  const parsed=parse(reconcileBasketSchema,input),basket=await getBasket(prisma,id)
  if(!basket)throw Object.assign(new Error('Basket not found.'),{statusCode:404})
  const receipt=basket.receipt as {baseline?:CartObservation}|undefined
  let after:CartObservation|undefined,unresolved=['No verified baseline is available. Do not replay the fill; inspect the exact handoff.']
  if(basket.executor==='ocado'&&deps.executor&&receipt?.baseline){try{after=observation(await deps.executor.readCart());unresolved=verifyReadback(receipt.baseline,after,basket.lines)}catch(error){unresolved=[error instanceof Error?error.message:'Cart read failed.']}}
  return view(await mutateDocument<BasketData>(prisma,{id,kind:'basket',actorId,operationId:parsed.operationId,expectedRevision:parsed.expectedRevision,payload:parsed,reduce:current=>{const data=required(current);if(data.status==='running')throw new MealConflict('Execution may still be live. Wait for its result before reconciliation.');return {...data,status:after&&!unresolved.length?'complete':'needs_review',unresolved,receipt:{...((data.receipt as object)??{}),...(after?{after}:{}),effect:'reconciled_read_only',uncertain:unresolved.length>0,checkout:false}}}}))
}
export { basketHandoff }
