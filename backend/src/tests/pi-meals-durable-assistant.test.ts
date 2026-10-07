import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { createModels } from '@earendil-works/pi-ai/models'
import { fauxProvider, fauxAssistantMessage, fauxToolCall } from '@earendil-works/pi-ai/providers/faux'
import type { PrismaClient } from '@prisma/client'
const domain=vi.hoisted(()=>({revision:1,applied:0,operations:new Map<string,unknown>()}))
vi.mock('../pi-meals/selections.js',()=>({getSelection:async()=>({id:'selection',revision:domain.revision,lines:[]}),changeSelection:async(_p:unknown,_id:string,_actor:string,envelope:{operationId:string;expectedRevision:number})=>{if(domain.operations.has(envelope.operationId))return domain.operations.get(envelope.operationId);if(envelope.expectedRevision!==domain.revision)throw new Error('revision conflict');domain.applied++;const result={id:'selection',revision:++domain.revision};domain.operations.set(envelope.operationId,result);return result}}))
import { createMealAssistant } from '../pi-meals/assistant.js'
const dirs:string[]=[]
afterEach(async()=>{for(const dir of dirs.splice(0))await rm(dir,{recursive:true,force:true});domain.revision=1;domain.applied=0;domain.operations.clear()})
function database(){const rows=new Map<string,any>();return {rows,prisma:{piMealOperation:{findUnique:async({where}:{where:{id:string}})=>domain.operations.has(where.id)?{result:domain.operations.get(where.id)}:null},piMealOutbox:{findUnique:async({where}:{where:{id:string}})=>rows.get(where.id)??null,findFirst:async()=>[...rows.values()].find(r=>['pending','running'].includes(r.status))??null,upsert:async({where,create}:{where:{id:string};create:any})=>{if(!rows.has(where.id))rows.set(where.id,{...create,status:'pending'});return rows.get(where.id)},update:async({where,data}:{where:{id:string};data:any})=>{Object.assign(rows.get(where.id),data);return rows.get(where.id)}}} as unknown as PrismaClient}}
async function settle(assistant:Awaited<ReturnType<typeof createMealAssistant>>,id:string){for(let n=0;n<100;n++){const result=await assistant.get('actor',id);if(result&&['complete','failed'].includes(result.status))return result;await new Promise(resolve=>setTimeout(resolve,10))}throw new Error('did not settle')}
describe('meal assistant with real Pi Durable SQLite and fake domain/provider',()=>{
 it('dispatches, persists final answer, deduplicates and reopens without a second domain write',async()=>{
  const runtimeDir=await mkdtemp('/Volumes/4TB Private/Offloaded/Agent Work/pi-meals-assistant-test-');dirs.push(runtimeDir)
  const models=createModels();const faux=fauxProvider();models.setProvider(faux.provider)
  faux.setResponses([fauxAssistantMessage(fauxToolCall('set_stock',{lineId:'onion',quantity:1,unit:'each'},{id:'stock-1'}),{stopReason:'toolUse'}),fauxAssistantMessage('One onion recorded.')])
  const options={runtimeDir,models,model:{provider:faux.provider.id,modelId:faux.getModel().id}}
  const {prisma}=database();let assistant=await createMealAssistant(prisma,options)
  const sent=await assistant.submit('actor','operation','selection','I have one onion')
  expect(await settle(assistant,sent.requestId)).toEqual({requestId:sent.requestId,status:'complete',message:'One onion recorded.'})
  expect(domain.applied).toBe(1);await assistant.close()
  assistant=await createMealAssistant(prisma,options)
  expect((await assistant.submit('actor','operation','selection','I have one onion')).status).toBe('complete')
  expect(domain.applied).toBe(1);expect(faux.state.callCount).toBe(2)
  await expect(assistant.submit('actor','operation','selection','Different message')).rejects.toThrow('reused')
  expect(await assistant.get('other',sent.requestId)).toBeNull();await assistant.close()
 })
 it('resumes a running outbox after reopen without applying a committed tool twice',async()=>{
  const runtimeDir=await mkdtemp('/Volumes/4TB Private/Offloaded/Agent Work/pi-meals-assistant-recovery-');dirs.push(runtimeDir)
  const models=createModels();const faux=fauxProvider();models.setProvider(faux.provider)
  faux.setResponses([fauxAssistantMessage(fauxToolCall('rename_selection',{title:'Dinner'},{id:'rename-1'}),{stopReason:'toolUse'}),fauxAssistantMessage('Dinner saved.')])
  const options={runtimeDir,models,model:{provider:faux.provider.id,modelId:faux.getModel().id}}
  const {prisma,rows}=database();let assistant=await createMealAssistant(prisma,options)
  const sent=await assistant.submit('actor','recovery-op','selection','Call this Dinner')
  await settle(assistant,sent.requestId);await assistant.close()
  const row=rows.get(sent.requestId);row.status='running';delete row.payload.result
  assistant=await createMealAssistant(prisma,options)
  expect((await settle(assistant,sent.requestId)).message).toBe('Dinner saved.')
  expect(domain.applied).toBe(1);expect(faux.state.callCount).toBe(2);await assistant.close()
 })
 it('stops a tool loop at its configured turn limit',async()=>{
  const runtimeDir=await mkdtemp('/Volumes/4TB Private/Offloaded/Agent Work/pi-meals-assistant-limit-');dirs.push(runtimeDir)
  const models=createModels();const faux=fauxProvider();models.setProvider(faux.provider)
  faux.setResponses([fauxAssistantMessage(fauxToolCall('get_selection',{}, {id:'read-1'}),{stopReason:'toolUse'}),fauxAssistantMessage('Must not run')])
  const {prisma}=database();const assistant=await createMealAssistant(prisma,{runtimeDir,models,model:{provider:faux.provider.id,modelId:faux.getModel().id},maxTurns:1})
  const sent=await assistant.submit('actor','limit-op','selection','Read list')
  expect((await settle(assistant,sent.requestId)).status).toBe('failed')
  expect(faux.state.callCount).toBe(1);await assistant.close()
 })
 it('reports absent configuration without opening a runtime or calling a provider',async()=>{
  const {prisma}=database();const models=createModels();const assistant=await createMealAssistant(prisma,{models})
  expect(assistant.status().available).toBe(false)
  expect((await assistant.submit('actor','op','selection','Hello')).status).toBe('unavailable')
  await assistant.close()
 })
})
