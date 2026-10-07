import { createHash } from 'node:crypto'
import type { PrismaClient } from '@prisma/client'
import { z } from 'zod'
import type { CommandEnvelope, RecipeSelection, SelectionChange, SelectionItem, StockDecision } from './contracts.js'
import { canonicalUnit, compileSelectionLines } from './compiler.js'
import { listDocuments, mutateDocument, readDocument, type MealDocument } from './store.js'

const text=z.string().trim().min(1)
const quantity=z.number().finite().nonnegative()
const ingredientSchema=z.object({id:text.optional(),name:text,quantity:quantity.nullable(),unit:z.string(),raw:z.string().optional()}).strict()
export const selectionItemsSchema=z.array(z.object({id:text,recipeId:text.optional(),name:text,source:z.string().optional(),photoUrl:z.string().optional(),baseServings:z.number().finite().positive(),servings:z.number().finite().positive(),ingredients:z.array(ingredientSchema)}).strict()).superRefine((items,ctx)=>{
  const ids=new Set<string>()
  items.forEach((item,index)=>{if(ids.has(item.id))ctx.addIssue({code:z.ZodIssueCode.custom,message:'Selection item IDs must be unique.',path:[index,'id']});ids.add(item.id)})
})
export const createSelectionSchema=z.object({operationId:text,title:text.optional(),items:selectionItemsSchema.optional()}).strict()
export const selectionCommandSchema=z.object({operationId:text,expectedRevision:z.number().int().nonnegative().max(2147483646),command:z.discriminatedUnion('type',[
  z.object({type:z.literal('replace_items'),items:selectionItemsSchema}).strict(),
  z.object({type:z.literal('set_stock'),lineId:text,quantity,unit:z.string()}).strict(),
  z.object({type:z.literal('rename'),title:text}).strict(),
])}).strict()
interface SelectionData { title:string; items:SelectionItem[]; stock:StockDecision[] }
function parse<T>(schema:z.ZodType<T>,input:unknown):T {
  const result=schema.safeParse(input)
  if(!result.success)throw Object.assign(new Error(result.error.issues.map(issue=>`${issue.path.join('.')}: ${issue.message}`).join('; ')),{statusCode:400})
  return result.data
}
function view(document:MealDocument<SelectionData>):RecipeSelection {
  return {id:document.id,revision:document.revision,title:document.data.title,items:document.data.items,stock:document.data.stock,lines:compileSelectionLines(document.data.items,document.data.stock),updatedAt:document.updatedAt}
}
export async function getSelection(prisma:PrismaClient,id:string):Promise<RecipeSelection|null>{
  const document=await readDocument<SelectionData>(prisma,id,'selection')
  return document ? view(document) : null
}
export async function listSelections(prisma:PrismaClient):Promise<RecipeSelection[]>{return (await listDocuments<SelectionData>(prisma,'selection')).map(view)}
export async function createSelection(prisma:PrismaClient,actorId:string,input:{operationId:string;title?:string;items?:SelectionItem[]}):Promise<RecipeSelection>{
  const parsed=parse(createSelectionSchema,input)
  const id=`selection_${createHash('sha256').update(JSON.stringify([actorId,parsed.operationId])).digest('hex').slice(0,24)}`
  return view(await mutateDocument<SelectionData>(prisma,{id,kind:'selection',actorId,operationId:parsed.operationId,expectedRevision:0,payload:parsed,reduce:()=>{
    const items=structuredClone(parsed.items??[])
    compileSelectionLines(items)
    return {title:parsed.title??'Recipe selection',items,stock:[]}
  }}))
}
export function reduceSelection(current:SelectionData|null,command:SelectionChange):SelectionData {
  if(!current)throw Object.assign(new Error('Recipe selection not found.'),{statusCode:404})
  if(command.type==='rename')return {...current,title:command.title}
  if(command.type==='replace_items'){
    const items=structuredClone(command.items)
    const lines=compileSelectionLines(items,current.stock)
    return {...current,items,stock:lines.filter(l=>l.haveQuantity>0).map(l=>({lineId:l.id,quantity:l.haveQuantity,unit:l.unit}))}
  }
  const line=compileSelectionLines(current.items).find(l=>l.id===command.lineId)
  if(!line)throw Object.assign(new Error('Shopping line not found.'),{statusCode:400})
  const conversion=canonicalUnit(command.unit)
  if(conversion.unit!==line.unit)throw Object.assign(new Error('Stock unit does not match this shopping line.'),{statusCode:400})
  const requested=command.quantity*conversion.factor
  if(!Number.isFinite(requested))throw Object.assign(new Error('Stock quantity must be finite.'),{statusCode:400})
  if(line.quantity===null && requested>0)throw Object.assign(new Error('Set the unknown ingredient amount before recording stock.'),{statusCode:400})
  const covered=Math.min(requested,line.quantity??0)
  const stock=current.stock.filter(s=>s.lineId!==line.id)
  if(covered>0)stock.push({lineId:line.id,quantity:covered,unit:line.unit})
  return {...current,stock}
}
export async function changeSelection(prisma:PrismaClient,id:string,actorId:string,envelope:CommandEnvelope<SelectionChange>):Promise<RecipeSelection>{
  const parsed=parse(selectionCommandSchema,envelope)
  return view(await mutateDocument<SelectionData>(prisma,{id,kind:'selection',actorId,operationId:parsed.operationId,expectedRevision:parsed.expectedRevision,payload:parsed.command,reduce:current=>reduceSelection(current,parsed.command)}))
}
