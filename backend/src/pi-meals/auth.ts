import { createHmac, timingSafeEqual, randomBytes } from 'node:crypto'
import type { FastifyInstance, FastifyRequest } from 'fastify'

declare module 'fastify' { interface FastifyRequest { mealActorId?: string } }
const COOKIE = 'pi_meals_session'
const MAX_AGE = 60 * 60 * 24 * 14
const attempts = new Map<string, { count: number; until: number }>()
function secret(): string { return process.env.PI_MEALS_SESSION_SECRET || '' }
function equal(a: string, b: string): boolean {
  const aHash = createHmac('sha256', 'pi-meals-compare').update(a).digest()
  const bHash = createHmac('sha256', 'pi-meals-compare').update(b).digest()
  return timingSafeEqual(aHash, bHash)
}
function signature(value: string) { return createHmac('sha256', secret()).update(value).digest('base64url') }
function authenticated(request: FastifyRequest): string | undefined {
  const cookie = (request.headers.cookie || '').split(';').map(s=>s.trim()).find(s=>s.startsWith(`${COOKIE}=`))?.slice(COOKIE.length+1)
  if (!cookie || secret().length < 32) return undefined
  const [body, sig] = cookie.split('.')
  if (!body || !sig || !equal(signature(body),sig)) return undefined
  try {
    const data = JSON.parse(Buffer.from(body,'base64url').toString())
    if (!['james','manon'].includes(data.actor) || !Number.isFinite(data.expires) || data.expires <= Date.now()) return undefined
    return data.actor
  } catch { return undefined }
}
export function getMealActorId(request: FastifyRequest): string {
  if (!request.mealActorId) throw Object.assign(new Error('Please sign in to Meal Planner.'), {statusCode:401})
  return request.mealActorId
}
function cookieHeader(value: string, age: number) {
  return `${COOKIE}=${value}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${age}${process.env.PI_MEALS_SECURE_COOKIE === 'true' ? '; Secure' : ''}`
}
/** The isolated build protects the whole application, including legacy mutation routes. */
export async function installMealAuth(app: FastifyInstance) {
  app.decorateRequest('mealActorId', undefined)
  app.addHook('onRequest', async (request, reply) => {
    const path = request.url.split('?')[0]
    if (path === '/health' || request.method === 'OPTIONS' || path === '/api/pi-meals/auth/login') return
    if (process.env.PI_MEALS_AUTH_DISABLED === 'test' && process.env.NODE_ENV === 'test') { request.mealActorId='james'; return }
    request.mealActorId = authenticated(request)
    if (!request.mealActorId) return reply.code(401).send({message:'Please sign in to Meal Planner.'})
    // SameSite cookies plus an explicit origin check protect browser mutations.
    if (!['GET','HEAD','OPTIONS'].includes(request.method) && request.headers.origin) {
      const allowed = (process.env.PI_MEALS_ALLOWED_ORIGINS || 'http://localhost:3100,http://127.0.0.1:3100').split(',').map(s=>s.trim())
      if (!allowed.includes(request.headers.origin)) return reply.code(403).send({message:'This page is not allowed to change Meal Planner.'})
    }
  })
  app.get('/api/pi-meals/auth/session', async request => {
    const actorId=getMealActorId(request)
    return {actorId,name:actorId==='james'?'James':'Manon'}
  })
  app.post<{Body:{member?:string;pin?:string}}>('/api/pi-meals/auth/login', async (request,reply)=>{
    if (request.headers.origin) {
      const allowed=(process.env.PI_MEALS_ALLOWED_ORIGINS || 'http://localhost:3100,http://127.0.0.1:3100').split(',').map(s=>s.trim())
      if(!allowed.includes(request.headers.origin))return reply.code(403).send({message:'This page is not allowed to sign in.'})
    }
    if(secret().length<32)return reply.code(503).send({message:'Household sign-in needs a session secret and member PINs configured on the host.'})
    const now=Date.now()
    for(const [key,value] of attempts)if(value.until<now)attempts.delete(key)
    const current=attempts.get(request.ip)
    if(current && current.count>=8)return reply.code(429).send({message:'Too many attempts. Please wait ten minutes.'})
    const member=request.body?.member?.toLowerCase()
    const supplied=request.body?.pin
    const expected=member==='james'?process.env.PI_MEALS_JAMES_PIN:member==='manon'?process.env.PI_MEALS_MANON_PIN:undefined
    if(!expected || typeof supplied!=='string' || !equal(expected,supplied)){
      attempts.set(request.ip,{count:(current?.count||0)+1,until:current?.until||now+600_000})
      return reply.code(401).send({message:'That name and PIN did not match.'})
    }
    attempts.delete(request.ip)
    const body=Buffer.from(JSON.stringify({actor:member,expires:now+MAX_AGE*1000,nonce:randomBytes(16).toString('hex')})).toString('base64url')
    reply.header('Set-Cookie',cookieHeader(`${body}.${signature(body)}`,MAX_AGE))
    return {actorId:member,name:member==='james'?'James':'Manon'}
  })
  app.post('/api/pi-meals/auth/logout',async (_request,reply)=>{
    reply.header('Set-Cookie',cookieHeader('',0));return {success:true}
  })
}
