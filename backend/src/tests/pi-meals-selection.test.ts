import { describe, expect, it, vi } from 'vitest'
import type { PrismaClient } from '@prisma/client'
import { changeSelection, createSelection, getSelection, listSelections } from '../pi-meals/selections.js'
import type { SelectionItem } from '../pi-meals/contracts.js'

// The lead generates the real client. Fake-store tests need only this catch discriminator.
vi.mock('@prisma/client', async importOriginal => {
  const original=await importOriginal<typeof import('@prisma/client')>()
  return {...original,Prisma:{...original.Prisma,PrismaClientKnownRequestError:original.Prisma.PrismaClientKnownRequestError??class extends Error {code='fixture'}}}
})

// This fixture proves reducers/receipts only. Real PostgreSQL concurrency is checked by the lead.
function memoryStore():PrismaClient {
  const rows=new Map<string,any>(); const operations=new Map<string,any>()
  const document={
    findUnique:async({where}:any)=>structuredClone(rows.get(where.id)??null),
    findMany:async({where}:any)=>[...rows.values()].filter(r=>r.kind===where.kind).map(r=>structuredClone(r)),
    create:async({data}:any)=>{rows.set(data.id,structuredClone(data));return data},
    updateMany:async({where,data}:any)=>{const row=rows.get(where.id);if(!row||row.revision!==where.revision)return {count:0}; rows.set(where.id,{...row,...structuredClone(data)});return {count:1}},
  }
  const operation={findUnique:async({where}:any)=>structuredClone(operations.get(where.id)??null),create:async({data}:any)=>{operations.set(data.id,structuredClone(data));return data}}
  const prisma={piMealDocument:document,piMealOperation:operation,$transaction:async(fn:any)=>fn(prisma)}
  return prisma as unknown as PrismaClient
}
const recipe=(quantity=100):SelectionItem=>({id:'batch',recipeId:'library-recipe',name:'Bread',baseServings:4,servings:2,ingredients:[{id:'flour',name:'Flour',quantity,unit:'g'}]})
describe('recipe selection documents',()=>{
  it('creates deterministic idempotent selections and copies recipe ingredient snapshots',async()=>{
    const prisma=memoryStore(); const item=recipe()
    const request={operationId:'create-1',title:'Dinner',items:[item]}
    const first=await createSelection(prisma,'james',request)
    expect(await createSelection(prisma,'james',request)).toEqual(first)
    item.ingredients[0].quantity=999
    const loaded=await getSelection(prisma,first.id)
    expect(loaded?.items[0].ingredients[0].quantity).toBe(100)
    expect(loaded?.lines[0].quantity).toBe(50)
    expect(await listSelections(prisma)).toHaveLength(1)
    expect(await getSelection(prisma,'absent')).toBeNull()
  })
  it('preserves fixed covered stock across more servings and supports explicit undo',async()=>{
    const prisma=memoryStore(); const original=await createSelection(prisma,'james',{operationId:'create',items:[recipe()]})
    const stocked=await changeSelection(prisma,original.id,'james',{operationId:'stock',expectedRevision:1,command:{type:'set_stock',lineId:original.lines[0].id,quantity:999,unit:'g'}})
    expect(stocked.stock[0].quantity).toBe(50)
    const revised=await changeSelection(prisma,original.id,'james',{operationId:'more',expectedRevision:2,command:{type:'replace_items',items:[{...recipe(),servings:4}]}})
    expect(revised.lines[0]).toMatchObject({quantity:100,haveQuantity:50,buyQuantity:50})
    const undone=await changeSelection(prisma,original.id,'james',{operationId:'undo',expectedRevision:3,command:{type:'set_stock',lineId:original.lines[0].id,quantity:0,unit:'g'}})
    expect(undone.stock).toEqual([])
    expect(undone.lines[0].buyQuantity).toBe(100)
  })
  it('caps surviving stock on reductions and never resurrects removed coverage',async()=>{
    const prisma=memoryStore(); const original=await createSelection(prisma,'james',{operationId:'create',items:[recipe()]})
    await changeSelection(prisma,original.id,'james',{operationId:'stock',expectedRevision:1,command:{type:'set_stock',lineId:original.lines[0].id,quantity:0.05,unit:'kg'}})
    const reduced=await changeSelection(prisma,original.id,'james',{operationId:'less',expectedRevision:2,command:{type:'replace_items',items:[recipe(50)]}})
    expect(reduced.stock[0].quantity).toBe(25)
    const removed=await changeSelection(prisma,original.id,'james',{operationId:'remove',expectedRevision:3,command:{type:'replace_items',items:[]}})
    expect(removed.stock).toEqual([])
    const returned=await changeSelection(prisma,original.id,'james',{operationId:'return',expectedRevision:4,command:{type:'replace_items',items:[recipe()]}})
    expect(returned.lines[0].buyQuantity).toBe(50)
  })
  it('returns the original receipt on retries and rejects changed payloads or stale revisions',async()=>{
    const prisma=memoryStore(); const original=await createSelection(prisma,'james',{operationId:'create'})
    const envelope={operationId:'rename',expectedRevision:1,command:{type:'rename' as const,title:'Supper'}}
    const result=await changeSelection(prisma,original.id,'james',envelope)
    expect(await changeSelection(prisma,original.id,'james',envelope)).toEqual(result)
    await expect(changeSelection(prisma,original.id,'james',{...envelope,command:{type:'rename',title:'Other'}})).rejects.toMatchObject({statusCode:409})
    await expect(changeSelection(prisma,original.id,'james',{...envelope,operationId:'new'})).rejects.toMatchObject({statusCode:409})
    expect((await getSelection(prisma,original.id))?.revision).toBe(2)
  })
  it('rejects invalid quantities, duplicate batch IDs and malformed revisions',async()=>{
    const prisma=memoryStore()
    for(const amount of [-1,Infinity,NaN]){
      const item=recipe(); item.ingredients[0].quantity=amount
      await expect(createSelection(prisma,'james',{operationId:'invalid',items:[item]})).rejects.toMatchObject({statusCode:400})
    }
    await expect(createSelection(prisma,'james',{operationId:'duplicates',items:[recipe(),recipe()]})).rejects.toMatchObject({statusCode:400})
    const selection=await createSelection(prisma,'james',{operationId:'valid',items:[recipe()]})
    for(const revision of [-1,1.5,Infinity,Number.MAX_SAFE_INTEGER])await expect(changeSelection(prisma,selection.id,'james',{operationId:'badrevision',expectedRevision:revision,command:{type:'rename',title:'Title'}})).rejects.toMatchObject({statusCode:400})
    await expect(changeSelection(prisma,selection.id,'james',{operationId:'wrongunit',expectedRevision:1,command:{type:'set_stock',lineId:selection.lines[0].id,quantity:1,unit:'ml'}})).rejects.toMatchObject({statusCode:400})
    await expect(changeSelection(prisma,selection.id,'james',{operationId:'negative',expectedRevision:1,command:{type:'set_stock',lineId:selection.lines[0].id,quantity:-1,unit:'g'}})).rejects.toMatchObject({statusCode:400})
  })
  it('rejects unknown stock quantities until ingredient amounts are supplied',async()=>{
    const prisma=memoryStore(); const item=recipe(); item.ingredients[0].quantity=null
    const selection=await createSelection(prisma,'james',{operationId:'unknown',items:[item]})
    await expect(changeSelection(prisma,selection.id,'james',{operationId:'stock',expectedRevision:1,command:{type:'set_stock',lineId:selection.lines[0].id,quantity:1,unit:'g'}})).rejects.toMatchObject({statusCode:400})
  })
})
