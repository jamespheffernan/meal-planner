import type { OcadoProductResult } from './types.js'

type Jsonish = null | boolean | number | string | Jsonish[] | { [k: string]: Jsonish }

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

function isHttpUrl(s: string): boolean {
  return /^https?:\/\//i.test(s)
}

function normalizeWhitespace(s: string): string {
  return String(s || '').replace(/\s+/g, ' ').trim()
}

function normalizeProductId(v: unknown): string | null {
  if (typeof v === 'number' && Number.isFinite(v) && v > 0) return String(Math.trunc(v))
  if (typeof v !== 'string') return null
  const s = v.trim()
  if (!/^\d{4,}$/.test(s)) return null
  return s
}

function parseGbpLikePrice(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) {
    // Heuristic: Ocado state sometimes uses pence as an integer.
    if (Number.isInteger(v) && v >= 50 && v <= 500000) return v / 100
    return v
  }
  if (typeof v !== 'string') return null
  const s = v.trim()
  const m = s.match(/£\s*([0-9]+(?:\.[0-9]{1,2})?)/)
  if (m) return Number(m[1])
  const n = Number(s)
  return Number.isFinite(n) ? n : null
}

function pickFirstString(obj: Record<string, unknown>, keys: string[]): string | null {
  for (const k of keys) {
    const v = obj[k]
    if (typeof v === 'string' && v.trim()) return v.trim()
  }
  return null
}

function extractPriceFromObject(obj: Record<string, unknown>): number | null {
  const direct = parseGbpLikePrice(
    obj.price ??
      obj.currentPrice ??
      obj.offerPrice ??
      obj.unitPrice ??
      obj.priceValue ??
      obj.amount ??
      obj.value
  )
  if (direct !== null) return direct

  // Common nested patterns: { price: { value: 1.2 } }, { pricing: { now: { amount: 120 } } }, etc.
  for (const k of ['price', 'pricing', 'prices', 'unitPrice', 'now', 'current', 'amount']) {
    const v = obj[k]
    if (!isRecord(v)) continue
    const nested = extractPriceFromObject(v)
    if (nested !== null) return nested
  }

  return null
}

function extractCurrency(obj: Record<string, unknown>): string {
  const s = pickFirstString(obj, ['currency', 'currencyCode'])
  if (s && s.length <= 4) return s.toUpperCase()
  return 'GBP'
}

function extractImageUrl(obj: Record<string, unknown>): string | null {
  // Common string keys.
  const direct = pickFirstString(obj, ['imageUrl', 'imageURL', 'image', 'thumbnail', 'thumb', 'mainImage', 'primaryImage', 'src', 'url'])
  if (direct && isHttpUrl(direct)) return direct

  // Common nested patterns: { images: { primary: { url } } } or arrays.
  for (const k of ['images', 'image', 'media', 'assets', 'thumbnails', 'primary', 'main', 'default', 'large', 'small']) {
    const v = obj[k]
    if (typeof v === 'string' && isHttpUrl(v)) return v
    if (Array.isArray(v)) {
      for (const item of v) {
        if (typeof item === 'string' && isHttpUrl(item)) return item
        if (isRecord(item)) {
          const u = extractImageUrl(item)
          if (u) return u
        }
      }
    }
    if (isRecord(v)) {
      const u = extractImageUrl(v)
      if (u) return u
    }
  }
  return null
}

function extractProductUrl(obj: Record<string, unknown>, baseUrl: string, id: string): string {
  const direct = pickFirstString(obj, ['productUrl', 'url', 'href', 'canonicalUrl', 'canonicalURL'])
  if (direct) {
    if (direct.includes('/products/')) return isHttpUrl(direct) ? direct : baseUrl + direct
  }
  return `${baseUrl}/products/${id}`
}

type ProductCandidate = {
  id: string
  name: string | null
  price: number | null
  currency: string
  imageUrl: string | null
  productUrl: string | null
  score: number
}

function scoreCandidate(c: Omit<ProductCandidate, 'score'>): number {
  let s = 0
  if (c.id) s += 4
  if (c.name) s += 3
  if (c.price !== null) s += 3
  if (c.imageUrl) s += 2
  if (c.productUrl) s += 1
  return s
}

function collectProductCandidates(state: unknown, baseUrl: string): ProductCandidate[] {
  const out: ProductCandidate[] = []
  const seenObjects = new WeakSet<object>()

  const visit = (node: unknown, depth: number) => {
    if (depth > 12) return
    if (!node) return

    if (Array.isArray(node)) {
      const lim = Math.min(node.length, 2000)
      for (let i = 0; i < lim; i++) visit(node[i], depth + 1)
      return
    }

    if (!isRecord(node)) return
    if (seenObjects.has(node)) return
    seenObjects.add(node)

    // Candidate detection: object contains an id-like field + at least one of name/price/url.
    const id =
      normalizeProductId((node as any).productId) ||
      normalizeProductId((node as any).productID) ||
      normalizeProductId((node as any).product_id) ||
      normalizeProductId((node as any).id) ||
      normalizeProductId((node as any).sku)

    if (id) {
      const nameRaw =
        pickFirstString(node, ['name', 'title', 'productName', 'description', 'shortDescription']) || null
      const name = nameRaw ? normalizeWhitespace(nameRaw).slice(0, 200) : null
      const price = extractPriceFromObject(node)
      const currency = extractCurrency(node)
      const imageUrl = extractImageUrl(node)
      const productUrl = extractProductUrl(node, baseUrl, id)
      const base = { id, name, price, currency, imageUrl, productUrl }
      out.push({ ...base, score: scoreCandidate(base) })
    }

    for (const v of Object.values(node)) visit(v, depth + 1)
  }

  visit(state, 0)
  return out
}

function collectProductIdArrays(state: unknown): Array<{ ids: string[]; score: number }> {
  const out: Array<{ ids: string[]; score: number }> = []
  const seenObjects = new WeakSet<object>()

  const visit = (node: unknown, depth: number, path: string) => {
    if (depth > 12) return
    if (!node) return

    if (Array.isArray(node)) {
      // Arrays of product IDs are typically part of search results.
      const ids: string[] = []
      const lim = Math.min(node.length, 3000)
      for (let i = 0; i < lim; i++) {
        const id = normalizeProductId(node[i])
        if (id) ids.push(id)
      }
      if (ids.length >= 1 && ids.length >= Math.min(lim, 3)) {
        let s = 0
        const p = path.toLowerCase()
        if (p.includes('search')) s += 6
        if (p.includes('result')) s += 4
        if (p.includes('product')) s += 2
        if (ids.length <= 50) s += 2
        out.push({ ids, score: s })
      }
      // Still traverse, but cap to reduce worst-case.
      for (let i = 0; i < Math.min(lim, 300); i++) visit(node[i], depth + 1, path + '[]')
      return
    }

    if (!isRecord(node)) return
    if (seenObjects.has(node)) return
    seenObjects.add(node)

    for (const [k, v] of Object.entries(node)) visit(v, depth + 1, path ? `${path}.${k}` : k)
  }

  visit(state, 0, '')
  return out
}

export function extractProductsFromInitialState(
  state: unknown,
  opts: { baseUrl: string; query?: string; maxResults: number }
): Array<OcadoProductResult & { _debug?: { source: 'initial_state' } }> {
  const baseUrl = opts.baseUrl
  const maxResults = Math.max(1, Math.min(50, opts.maxResults || 5))

  const candidates = collectProductCandidates(state, baseUrl)
  if (candidates.length === 0) return []

  // Pick best candidate per product ID.
  const bestById = new Map<string, ProductCandidate>()
  for (const c of candidates) {
    const prev = bestById.get(c.id)
    if (!prev || c.score > prev.score) bestById.set(c.id, c)
  }

  // Prefer search result ordering if we can detect it.
  const arrays = collectProductIdArrays(state).sort((a, b) => b.score - a.score)
  const orderedIds = arrays[0]?.ids || []

  const results: Array<OcadoProductResult & { _debug?: { source: 'initial_state' } }> = []
  const pushFromCandidate = (c: ProductCandidate) => {
    if (results.length >= maxResults) return
    if (!c.name) return
    results.push({
      provider: 'ocado',
      providerProductId: c.id,
      name: c.name,
      price: c.price,
      currency: c.currency || 'GBP',
      imageUrl: c.imageUrl,
      productUrl: c.productUrl,
      _debug: { source: 'initial_state' },
    })
  }

  for (const id of orderedIds) {
    const c = bestById.get(id)
    if (c) pushFromCandidate(c)
    if (results.length >= maxResults) break
  }

  if (results.length >= 1) return results.slice(0, maxResults)

  // Fallback: top scored candidates (stable sort: score desc, id asc).
  const fallback = Array.from(bestById.values()).sort((a, b) => (b.score - a.score) || a.id.localeCompare(b.id))
  for (const c of fallback) {
    pushFromCandidate(c)
    if (results.length >= maxResults) break
  }
  return results.slice(0, maxResults)
}

export function extractCartFromInitialState(state: unknown): {
  currency: string
  total: number | null
  items: Array<{
    name: string
    providerProductId: string | null
    quantity: number
    price: number | null
    lineTotal: number | null
  }>
  _debug?: { source: 'initial_state' }
} | null {
  const seenObjects = new WeakSet<object>()
  const itemsByKey = new Map<string, { name: string; providerProductId: string | null; quantity: number; price: number | null }>()
  let currency: string | null = null
  let total: number | null = null

  const visit = (node: unknown, depth: number, path: string) => {
    if (depth > 12) return
    if (!node) return

    if (Array.isArray(node)) {
      for (let i = 0; i < Math.min(node.length, 1500); i++) visit(node[i], depth + 1, path + '[]')
      return
    }

    if (!isRecord(node)) return
    if (seenObjects.has(node)) return
    seenObjects.add(node)

    const p = path.toLowerCase()
    if (total === null && (p.includes('trolley') || p.includes('basket') || p.includes('cart'))) {
      const maybeTotal = parseGbpLikePrice(
        (node as any).total ?? (node as any).orderTotal ?? (node as any).basketTotal ?? (node as any).totalPrice
      )
      if (maybeTotal !== null) total = maybeTotal
    }

    if (!currency) {
      const c = pickFirstString(node, ['currency', 'currencyCode'])
      if (c && c.length <= 4) currency = c.toUpperCase()
    }

    const qtyRaw = (node as any).quantity ?? (node as any).qty
    const qty = typeof qtyRaw === 'number' ? qtyRaw : Number(qtyRaw)
    const id =
      normalizeProductId((node as any).productId) ||
      normalizeProductId((node as any).productID) ||
      normalizeProductId((node as any).product_id) ||
      normalizeProductId((node as any).id) ||
      null

    // Line item heuristic: needs a quantity + a product id or name, and should live somewhere "trolley/basket/cart"-ish.
    if (Number.isFinite(qty) && qty > 0 && qty <= 200 && (p.includes('trolley') || p.includes('basket') || p.includes('cart'))) {
      const nameRaw = pickFirstString(node, ['name', 'title', 'productName', 'description', 'shortDescription'])
      const name = nameRaw ? normalizeWhitespace(nameRaw).slice(0, 200) : null
      const price = extractPriceFromObject(node)
      if (name || id) {
        const key = id || (name ? `name:${name}` : `anon:${itemsByKey.size}`)
        const prev = itemsByKey.get(key)
        if (!prev || (prev.price === null && price !== null)) {
          itemsByKey.set(key, {
            name: name || prev?.name || (id ? `Ocado product ${id}` : 'Ocado item'),
            providerProductId: id,
            quantity: Math.max(1, Math.round(qty)),
            price,
          })
        }
      }
    }

    for (const [k, v] of Object.entries(node)) visit(v, depth + 1, path ? `${path}.${k}` : k)
  }

  visit(state, 0, '')

  const items = Array.from(itemsByKey.values()).map(it => ({
    name: it.name,
    providerProductId: it.providerProductId,
    quantity: it.quantity,
    price: it.price,
    lineTotal: it.price !== null ? it.price * it.quantity : null,
  }))

  if (items.length === 0 && total === null) return null
  return {
    currency: currency || 'GBP',
    total,
    items,
    _debug: { source: 'initial_state' },
  }
}

export function parseInitialStateFromHtml(html: string): Jsonish | null {
  const raw = String(html || '')
  const idx = raw.indexOf('__INITIAL_STATE__')
  if (idx === -1) return null

  // Find the first `{` after the token and try to parse a balanced JSON object.
  const start = raw.indexOf('{', idx)
  if (start === -1) return null

  let i = start
  let depth = 0
  let inStr = false
  let esc = false
  for (; i < raw.length; i++) {
    const ch = raw[i]
    if (inStr) {
      if (esc) {
        esc = false
        continue
      }
      if (ch === '\\\\') {
        esc = true
        continue
      }
      if (ch === '\"') {
        inStr = false
      }
      continue
    }
    if (ch === '\"') {
      inStr = true
      continue
    }
    if (ch === '{') depth++
    if (ch === '}') depth--
    if (depth === 0) {
      const json = raw.slice(start, i + 1)
      try {
        return JSON.parse(json) as any
      } catch {
        return null
      }
    }
  }
  return null
}
