import {describe,it,expect,vi} from 'vitest'
import type {Page} from 'playwright'
import {pageExecutor,readVerifiedCart} from '../pi-meals/ocado.js'
const line={id:'flour',name:'Flour',quantity:800,unit:'g',productId:'12345',productName:'Flour',packQuantity:500,packUnit:'g',packs:2}
function pageDouble(failClick=false){let quantity=0;const click=vi.fn(async()=>{quantity++;if(failClick)throw new Error('uncertain click')});const page={goto:vi.fn(async()=>{}),waitForLoadState:vi.fn(async()=>{}),evaluate:vi.fn(async()=>({items:quantity?[{productId:'12345',quantity}]:[],declared:quantity?1:0,url:'https://www.ocado.com/trolley'})),locator:vi.fn((selector:string)=>({getAttribute:async()=> 'https://www.ocado.com/products/flour-12345',innerText:async()=>selector==='h1'?'Flour':'Flour 500g'})),getByRole:vi.fn(()=>({count:async()=>1,click}))};return {page:page as unknown as Page,click}}
describe('real Ocado executor control flow',()=>{
 it('reads before each bounded click and verifies both increments',async()=>{const {page,click}=pageDouble();await pageExecutor(page,[line]).addPacks('12345',2);expect(click).toHaveBeenCalledTimes(2);expect(page.evaluate).toHaveBeenCalledTimes(4)})
 it('never retries a failed click',async()=>{const {page,click}=pageDouble(true);await expect(pageExecutor(page,[line]).addPacks('12345',2)).rejects.toThrow('uncertain click');expect(click).toHaveBeenCalledTimes(1)})
 it('propagates unknown cart observations',async()=>{const {page}=pageDouble();vi.mocked(page.evaluate).mockRejectedValue(new Error('layout unknown'));await expect(readVerifiedCart(page)).rejects.toThrow('layout unknown')})
})
