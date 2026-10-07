import { describe, expect, it } from 'vitest'
import { compileSelectionLines } from '../pi-meals/compiler.js'
import type { SelectionItem } from '../pi-meals/contracts.js'
const item = (id:string, quantity:number|null, unit:string, servings=2):SelectionItem => ({id,name:id,baseServings:2,servings,ingredients:[{id:'flour',name:'Flour',quantity,unit}]})
describe('selection ingredient compiler',()=>{
  it('consolidates three recipe contributions and scales each once',()=>{
    const lines=compileSelectionLines([item('a',0.5,'kg'),item('b',250,'g'),item('c',100,'g',1)])
    expect(lines).toHaveLength(1)
    expect(lines[0]).toMatchObject({quantity:800,unit:'g',buyQuantity:800})
    expect(lines[0].sources.map(s=>s.quantity)).toEqual([500,250,50])
  })
  it('separates incompatible dimensions, fluid ounces and discrete packages',()=>{
    const lines=compileSelectionLines(['g','ml','oz','fl oz','piece','slice','pack'].map((u,i)=>item(String(i),1,u)))
    expect(lines).toHaveLength(6)
    expect(lines.find(l=>l.unit==='g')?.quantity).toBeCloseTo(29.349523125)
    expect(lines.find(l=>l.unit==='fl oz')?.quantity).toBe(1)
  })
  it('preserves explicit unknown amounts and all contributions',()=>{
    const [line]=compileSelectionLines([item('a',null,'g'),item('b',2,'g')])
    expect(line.quantity).toBeNull()
    expect(line.buyQuantity).toBeNull()
    expect(line.sources).toHaveLength(2)
    expect(line.warnings.length).toBeGreaterThan(0)
  })
  it('allows deliberate duplicate recipe batches with unique item IDs and fractional portions',()=>{
    const a={...item('batch-1',4,'piece',0.5),recipeId:'same'}
    const b={...item('batch-2',4,'piece',1),recipeId:'same'}
    expect(compileSelectionLines([a,b])[0].quantity).toBe(3)
  })
  it('does not collapse different ingredient IDs or strip preparation words',()=>{
    const a=item('a',1,'g'); const b=item('b',1,'g'); b.ingredients[0].id='other'
    expect(compileSelectionLines([a,b])).toHaveLength(2)
    delete a.ingredients[0].id; delete b.ingredients[0].id; b.ingredients[0].name='Flour, toasted'
    expect(compileSelectionLines([a,b])).toHaveLength(2)
  })
  it('fails finite-input arithmetic overflow before storing a selection',()=>{
    expect(()=>compileSelectionLines([item('a',Number.MAX_VALUE,'kg')])).toThrow('finite')
  })
  it('keeps prior stock coverage fixed when demand increases',()=>{
    const [original]=compileSelectionLines([item('a',100,'g')])
    const [added]=compileSelectionLines([item('a',200,'g')],[{lineId:original.id,quantity:100,unit:'g'}])
    expect(added).toMatchObject({haveQuantity:100,buyQuantity:100})
  })
})
