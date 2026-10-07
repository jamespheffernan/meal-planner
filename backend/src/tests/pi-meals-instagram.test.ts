import {describe,it,expect} from 'vitest'
import {instagramUrl} from '../pi-meals/instagram.js'
describe('Instagram single-link boundary',()=>{
 it('accepts a post and removes tracking',()=>expect(instagramUrl('https://www.instagram.com/p/abc_123/?igsh=123')).toBe('https://www.instagram.com/p/abc_123/'))
 it.each(['https://instagram.com/username/','https://instagram.com.evil.test/p/abc/','http://instagram.com/p/abc/','https://user:pass@instagram.com/p/abc/','https://instagram.com:123/p/abc/','https://instagram.com/p/abc/extra'])('rejects %s',url=>expect(()=>instagramUrl(url)).toThrow())
})
