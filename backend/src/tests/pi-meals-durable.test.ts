import { afterEach, describe, expect, it } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { createModels } from '@earendil-works/pi-ai/models'
import { fauxProvider, fauxAssistantMessage } from '@earendil-works/pi-ai/providers/faux'
import { mealContext, mealConversation, openMealDurable } from '../pi-meals/durable.js'
const directories:string[]=[]
afterEach(async()=>{for(const dir of directories.splice(0))await rm(dir,{recursive:true,force:true})})
async function setup(){const runtimeDir=await mkdtemp('/Volumes/4TB Private/Offloaded/Agent Work/pi-meals-durable-test-');directories.push(runtimeDir);const models=createModels();const faux=fauxProvider();models.setProvider(faux.provider);faux.setResponses([fauxAssistantMessage('Meal list is ready.')]);return {runtimeDir,models,faux,model:{provider:faux.provider.id,modelId:faux.getModel().id}}}
describe('real Pi Durable SQLite meal host',()=>{
 it('stores a conversation and deduplicates a request after close and reopen',async()=>{
  const options=await setup();let host=await openMealDurable(options)
  const conversation=await mealConversation(host.harness,'selection-a',options.model)
  const first=await conversation.submit({type:'input',content:'Explain my list',requestId:'stable-1'},mealContext)
  expect((await first.wait(mealContext)).status).toBe('done')
  await host.close()
  host=await openMealDurable(options)
  const reopened=await mealConversation(host.harness,'selection-a',options.model)
  expect(reopened.id).toBe(conversation.id)
  const duplicate=await reopened.submit({type:'input',content:'Explain my list',requestId:'stable-1'},mealContext)
  expect(duplicate.id).toBe(first.id)
  expect((await duplicate.wait(mealContext)).status).toBe('done')
  expect(options.faux.state.callCount).toBe(1)
  await host.close()
 })
 it('rejects a second live storage owner and releases the lock on shutdown',async()=>{
  const options=await setup();const host=await openMealDurable(options)
  await expect(openMealDurable(options)).rejects.toThrow('already owned')
  await host.close();const reopened=await openMealDurable(options);await reopened.close()
 })
})
