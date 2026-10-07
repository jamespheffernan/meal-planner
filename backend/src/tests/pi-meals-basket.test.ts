import { describe,it,expect } from 'vitest'
import { reviewManifest,verifyReadback } from '../pi-meals/baskets.js'
import { basketHandoff } from '../pi-meals/aside.js'
import type { RecipeSelection,BasketProposal } from '../pi-meals/contracts.js'
const selection:RecipeSelection={id:'s',revision:2,title:'Dinner',items:[],stock:[],updatedAt:'now',lines:[{id:'a',name:'Flour',quantity:800,unit:'g',haveQuantity:0,buyQuantity:800,sources:[],warnings:[]}]}
const line={id:'a',name:'Flour',quantity:800,unit:'g',productId:'12345',productName:'Flour 500g',packQuantity:500,packUnit:'g'}
const cart=(items:Array<{productId:string;quantity:number}>)=>({verified:true as const,items,evidence:{source:'test'}})
describe('Reviewed basket manifest',()=>{
 it('requires two 500g packs for 800g and rejects a default single pack',()=>{expect(reviewManifest(selection,[line])[0].packs).toBe(2);expect(()=>reviewManifest(selection,[{...line,packs:1}])).toThrow('pack count')})
 it('rejects empty, incomplete and stale ingredient amounts',()=>{expect(()=>reviewManifest(selection,[])).toThrow();expect(()=>reviewManifest(selection,[{...line,productId:undefined}])).toThrow();expect(()=>reviewManifest(selection,[{...line,quantity:700}])).toThrow()})
 it('verifies additive targets and preserves unrelated manual products',()=>{const lines=reviewManifest(selection,[line]);expect(verifyReadback(cart([{productId:'manual',quantity:3},{productId:'12345',quantity:1}]),cart([{productId:'manual',quantity:3},{productId:'12345',quantity:3}]),lines)).toEqual([]);expect(verifyReadback(cart([{productId:'manual',quantity:3}]),cart([{productId:'12345',quantity:2}]),lines)).toContain('Product manual: expected 3, observed 0.')})
 it('does not treat failed reads as an empty cart',()=>{expect(()=>verifyReadback({verified:false,items:[],evidence:null} as never,cart([]),[])).toThrow('Cart read failed')})
 it('keeps exact identity and no checkout in the Aside handoff',()=>{const basket:BasketProposal={id:'basket-1',revision:3,selectionId:'s',selectionRevision:2,status:'ready',executor:'aside',lines:reviewManifest(selection,[line]),unresolved:[]};expect(basketHandoff(basket)).toContain('basket-1');expect(basketHandoff(basket)).toContain('"packs": 2');expect(basketHandoff(basket)).toContain('without retrying')})
})
