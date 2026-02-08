import { chromium, type Browser, type BrowserContext, type Page } from 'playwright'
import type { PrismaClient } from '@prisma/client'
import { getStoreSessionStorageState } from '../../store-session.js'
import type { OcadoCartSummary, OcadoProductResult } from './types.js'
import { extractCartFromInitialState, extractProductsFromInitialState, parseInitialStateFromHtml } from './ocado-initial-state.js'
import { withProviderLock } from '../provider-lock.js'

function envFlag(name: string, defaultValue = false): boolean {
  const raw = process.env[name]
  if (raw === undefined) return defaultValue
  return ['1', 'true', 'yes', 'on'].includes(String(raw).toLowerCase())
}

function ocadoHeadlessDefault(): boolean {
  // Headless mode is more likely to trigger bot checks. Allow forcing headed mode in env.
  if (process.env.OCADO_HEADLESS !== undefined) {
    return envFlag('OCADO_HEADLESS', true)
  }
  return true
}

function humanDelay(minMs: number, maxMs: number) {
  const ms = Math.floor(minMs + Math.random() * (maxMs - minMs))
  return new Promise(resolve => setTimeout(resolve, ms))
}

export class OcadoAutomation {
  readonly baseUrl = 'https://www.ocado.com'

  constructor(private prisma: PrismaClient) {}

  private async detectBelowMinimum(page: Page): Promise<{ minimum: number | null; message?: string } | null> {
    // Ocado sometimes blocks checkout if order total is below a minimum (e.g. £40).
    const body = await page.locator('body').innerText().catch(() => '')
    if (!body) return null
    const text = body.replace(/\s+/g, ' ').trim()
    if (!/minimum\s+order/i.test(text)) return null
    const m = text.match(/minimum\s+order[^£]{0,50}£\s*([0-9]+(?:\.[0-9]{1,2})?)/i)
    const min = m ? Number(m[1]) : null
    return { minimum: Number.isFinite(min as any) ? (min as any) : null, message: 'Minimum order threshold detected' }
  }

  private async detectAccessIssue(page: Page): Promise<{ code: 'logged_out' | 'captcha' | null; detail?: string }> {
    const url = page.url()
    if (url.includes('login') || url.includes('signin')) {
      return { code: 'logged_out', detail: 'url' }
    }

    // Captcha / bot detection heuristics. Keep this conservative: false positives are worse than misses.
    const captchaSignals = await Promise.all([
      page.locator('iframe[src*="captcha" i]').first().isVisible().catch(() => false),
      page.locator('iframe[src*="hcaptcha" i]').first().isVisible().catch(() => false),
      page.locator('[id*="captcha" i]').first().isVisible().catch(() => false),
      page.locator('[class*="captcha" i]').first().isVisible().catch(() => false),
      page.locator('text=/verify you are human|captcha|are you a robot|robot check|unusual traffic|hcaptcha|cloudflare/i').first().isVisible().catch(() => false),
    ])
    if (captchaSignals.some(Boolean)) {
      return { code: 'captcha', detail: 'signals' }
    }

    // Heuristic: check if page contains obvious "Sign in" CTA.
    const signIn = await page.locator('text=/sign in|log in/i').first().isVisible().catch(() => false)
    if (signIn) {
      return { code: 'logged_out', detail: 'sign_in_cta' }
    }

    return { code: null }
  }

  private async assertLikelyLoggedIn(page: Page) {
    const issue = await this.detectAccessIssue(page)
    if (!issue.code) return
    if (issue.code === 'captcha') {
      throw new Error('[OCADO_CAPTCHA] Ocado blocked automation (captcha detected). Run `npm run ocado:auth` headed to complete verification, then retry.')
    }
    throw new Error('[OCADO_LOGGED_OUT] Ocado session appears logged out. Reconnect in Settings.')
  }

  private async getInitialState(page: Page): Promise<any | null> {
    const direct = await page.evaluate(() => {
      const g: any = globalThis as any
      return g.__INITIAL_STATE__ || g.INITIAL_STATE || null
    }).catch(() => null)
    if (direct) return direct

    const html = await page.content().catch(() => '')
    if (!html) return null
    return parseInitialStateFromHtml(html)
  }

  private async goToCart(page: Page) {
    // Prefer clicking a cart/trolley link if present, otherwise try direct URLs.
    const cartLinkSelectors = [
      'a[href*="trolley"]',
      'a[href*="basket"]',
      '[data-test="trolley"]',
      '[aria-label*="trolley"]',
      '[aria-label*="basket"]',
    ]

    for (const selector of cartLinkSelectors) {
      try {
        const el = page.locator(selector).first()
        if (await el.isVisible({ timeout: 1000 }).catch(() => false)) {
          await el.click({ timeout: 3000 })
          await humanDelay(1200, 2200)
          await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => undefined)
          return
        }
      } catch {
        // ignore
      }
    }

    const cartUrls = [
      `${this.baseUrl}/webshop/trolley`,
      `${this.baseUrl}/trolley`,
      `${this.baseUrl}/basket`,
      `${this.baseUrl}/webshop/get/basket`,
    ]

    for (const url of cartUrls) {
      try {
        await page.goto(url, { waitUntil: 'domcontentloaded' })
        await humanDelay(1200, 2200)
        await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => undefined)
        return
      } catch {
        // try next
      }
    }
  }

  private async goToCheckoutOrSlots(page: Page) {
    // Assumes we're already in cart/trolley/basket; click checkout / book slot.
    const checkoutSelectors = [
      'button:has-text("Book a slot")',
      'button:has-text("book slot")',
      'a:has-text("Book a slot")',
      'a:has-text("book slot")',
      'button:has-text("Checkout")',
      'a:has-text("Checkout")',
      'a[href*="slot"]',
      'button[class*="slot"]',
    ]

    for (const selector of checkoutSelectors) {
      try {
        const el = page.locator(selector).first()
        if (await el.isVisible({ timeout: 1500 }).catch(() => false)) {
          await el.click({ timeout: 5000 })
          await humanDelay(2000, 3200)
          await page.waitForLoadState('networkidle', { timeout: 20000 }).catch(() => undefined)
          return
        }
      } catch {
        // next
      }
    }

    // Last resort: attempt direct checkout-like URLs.
    const urls = [
      `${this.baseUrl}/checkout`,
      `${this.baseUrl}/webshop/checkout`,
      `${this.baseUrl}/webshop/get/checkout`,
      `${this.baseUrl}/slots`,
    ]
    for (const url of urls) {
      try {
        await page.goto(url, { waitUntil: 'domcontentloaded' })
        await humanDelay(1600, 2600)
        await page.waitForLoadState('networkidle', { timeout: 20000 }).catch(() => undefined)
        return
      } catch {
        // next
      }
    }
  }

  async withPage<T>(opts: { headless?: boolean }, fn: (ctx: { browser: Browser; context: BrowserContext; page: Page }) => Promise<T>): Promise<T> {
    return withProviderLock('ocado', async () => {
      const headless = opts.headless ?? ocadoHeadlessDefault()
      const enabled = envFlag('ENABLE_STORE_OCADO', true)
      if (!enabled) {
        throw new Error('Ocado integration disabled (set ENABLE_STORE_OCADO=true)')
      }

      const storageState = await getStoreSessionStorageState(this.prisma, 'ocado')
      if (!storageState) {
        throw new Error('Ocado session not configured. Add Playwright storageState in Settings.')
      }

      const browser = await chromium.launch({
        headless,
        // Avoid obvious automation flags where possible.
        args: ['--disable-blink-features=AutomationControlled'],
      })

      try {
        const context = await browser.newContext({
          storageState,
          viewport: { width: 1280, height: 900 },
          userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
        })
        await context.addInitScript(() => {
          try {
            Object.defineProperty(navigator, 'webdriver', { get: () => undefined })
          } catch {}
        })
        context.setDefaultTimeout(20000)
        const page = await context.newPage()
        page.setDefaultTimeout(20000)
        try {
          return await fn({ browser, context, page })
        } finally {
          await context.close().catch(() => undefined)
        }
      } finally {
        await browser.close().catch(() => undefined)
      }
    })
  }

  async searchProducts(page: Page, query: string, maxResults = 5): Promise<OcadoProductResult[]> {
    const q = query.trim()
    if (!q) return []

    // Navigate to homepage.
    if (!page.url().startsWith(this.baseUrl)) {
      await page.goto(this.baseUrl, { waitUntil: 'domcontentloaded' })
      await humanDelay(1200, 2200)
    }

    await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => undefined)
    await this.assertLikelyLoggedIn(page)

    // Prefer parsing window.__INITIAL_STATE__ on a dedicated search URL to reduce selector drift.
    const enc = encodeURIComponent(q)
    const searchUrls = [
      `${this.baseUrl}/search?entry=${enc}`,
      `${this.baseUrl}/search?query=${enc}`,
      `${this.baseUrl}/search?search=${enc}`,
    ]
    for (const url of searchUrls) {
      try {
        await page.goto(url, { waitUntil: 'domcontentloaded' })
        await humanDelay(1200, 2200)
        await page.waitForLoadState('networkidle', { timeout: 20000 }).catch(() => undefined)
        await this.assertLikelyLoggedIn(page)

        const state = await this.getInitialState(page)
        const parsed = extractProductsFromInitialState(state, { baseUrl: this.baseUrl, query: q, maxResults })
        if (parsed.length >= 1) return parsed.map(({ _debug, ...p }) => p)
      } catch {
        // try next URL
      }
    }

    const searchSelectors = [
      'input[type="search"]:visible',
      'input[placeholder*="Search"]:visible',
      'input[name="search"]:visible',
      '#findText',
      'header input[type="text"]',
      '.search-input',
    ]

    let searchBox: any = null
    for (const selector of searchSelectors) {
      try {
        searchBox = await page.waitForSelector(selector, { state: 'visible', timeout: 2500 })
        if (searchBox) break
      } catch {
        // try next
      }
    }

    if (!searchBox) {
      // Dump debug artifact to help fix selector drift.
      await this.writeDebug(page, 'ocado_search_no_box')
      throw new Error('Ocado search box not found (UI likely changed).')
    }

    await searchBox.fill(q)
    await humanDelay(300, 800)
    await searchBox.press('Enter')
    await humanDelay(1400, 2400)
    await page.waitForLoadState('networkidle', { timeout: 20000 }).catch(() => undefined)
    await this.assertLikelyLoggedIn(page)

    // Prefer state parsing on the actual results page.
    try {
      const state = await this.getInitialState(page)
      const parsed = extractProductsFromInitialState(state, { baseUrl: this.baseUrl, query: q, maxResults })
      if (parsed.length >= 1) return parsed.map(({ _debug, ...p }) => p)
    } catch {
      // ignore; fall back to DOM scraping
    }

    // Try extraction strategies in page context. Prefer the image-based strategy used in Grocery Getter.
    //
    // NOTE: When running under tsx/esbuild, Playwright's function serialization can include helper
    // references (e.g. "__name") that don't exist in the browser context. Use string evaluation
    // to keep the browser-side code self-contained.
    const products = (await page.evaluate(`(() => {
      const maxResults = ${JSON.stringify(maxResults)}
      const baseUrl = ${JSON.stringify(this.baseUrl)}
      const doc = document

      function parsePrice(text) {
        if (!text) return null
        const raw = String(text)
        const idx = raw.indexOf('£')
        if (idx === -1) return null
        const tail = raw.slice(idx + 1)
        let num = ''
        for (let i = 0; i < tail.length; i++) {
          const ch = tail[i]
          const isDigit = ch >= '0' && ch <= '9'
          if (isDigit || ch === '.') {
            num += ch
            continue
          }
          if (num) break
        }
        const v = parseFloat(num)
        return Number.isFinite(v) ? v : null
      }

      function extractIdFromHref(href) {
        if (!href) return null
        const raw = String(href).split('?')[0].split('#')[0]
        const parts = raw.split('/')
        for (let i = parts.length - 1; i >= 0; i--) {
          const seg = parts[i]
          if (!seg) continue
          let j = seg.length - 1
          while (j >= 0) {
            const ch = seg[j]
            const isDigit = ch >= '0' && ch <= '9'
            if (!isDigit) break
            j--
          }
          const trailing = seg.slice(j + 1)
          if (trailing && trailing.length >= 4) return trailing
        }
        return null
      }

      function bestImageUrl(img) {
        const src = img?.getAttribute?.('src')
        if (src) return src
        const dataSrc = img?.getAttribute?.('data-src')
        if (dataSrc) return dataSrc
        const srcset = img?.getAttribute?.('srcset')
        if (srcset) {
          const first = String(srcset).split(',')[0]?.trim()?.split(' ')[0]
          if (first) return first
        }
        return null
      }

      const out = []
      const seenTitles = new Set()

      // Strategy A: walk from product images (similar to Grocery Getter)
      const imgs = Array.from(doc?.querySelectorAll?.('img[data-test=\"lazy-load-image\"]') || [])
      for (const imgEl of imgs) {
        let container = imgEl
        for (let i = 0; i < 10 && container; i++) {
          container = container.parentElement
          if (!container) break

          const priceEl = container.querySelector?.('[data-test*=\"price\"]')
          const titleEl =
            container.querySelector?.('[class*=\"title\"], h1, h2, h3, h4, h5, h6') ||
            container.querySelector?.('a[href*=\"/products/\"]')

          const title = (titleEl?.textContent || '').trim()
          const price = parsePrice((priceEl?.textContent || '').trim())
          const link = container.querySelector?.('a[href*=\"/products/\"]')
          const id = extractIdFromHref(link?.getAttribute?.('href') || null)
          const imageUrl = bestImageUrl(imgEl)

          if (title && price !== null && id && imageUrl) {
            if (!seenTitles.has(title)) {
              seenTitles.add(title)
              out.push({
                provider: 'ocado',
                providerProductId: id,
                name: title,
                price,
                currency: 'GBP',
                imageUrl,
                productUrl: baseUrl + '/products/' + id,
              })
            }
            break
          }
        }
        if (out.length >= maxResults) break
      }

      if (out.length >= 1) return out.slice(0, maxResults)

      // Strategy B: product links fallback
      const links = Array.from(doc?.querySelectorAll?.('a[href*=\"/products/\"]') || [])
      const seen = new Set()
      for (const a of links) {
        const id = extractIdFromHref(a.getAttribute?.('href') || null)
        if (!id || seen.has(id)) continue
        seen.add(id)

        let el = a
        let price = null
        for (let i = 0; i < 8 && el; i++) {
          const priceEl = el.querySelector?.('[data-test*=\"price\"], [class*=\"price\"], span')
          price = parsePrice(priceEl ? priceEl.textContent : null)
          if (price !== null) break
          el = el.parentElement
        }

        const title = (a.textContent || '').trim().slice(0, 200)
        const img = a.querySelector?.('img') || el?.querySelector?.('img')
        const imageUrl = bestImageUrl(img)

        out.push({
          provider: 'ocado',
          providerProductId: id,
          name: title || ('Ocado product ' + id),
          price,
          currency: 'GBP',
          imageUrl,
          productUrl: baseUrl + '/products/' + id,
        })
        if (out.length >= maxResults) break
      }

      return out.slice(0, maxResults)
    })()`)) as any[]

    if (!products || products.length === 0) {
      await this.writeDebug(page, 'ocado_search_no_results')
    }

    return (products || []).slice(0, maxResults)
  }

  async addToCart(page: Page, providerProductId: string, quantity = 1): Promise<void> {
    const id = String(providerProductId).trim()
    if (!id) throw new Error('providerProductId is required')

    // Most robust baseline: open product page and click an "Add" button.
    await page.goto(`${this.baseUrl}/products/${id}`, { waitUntil: 'domcontentloaded' })
    await humanDelay(900, 1600)
    await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => undefined)

    // Attempt common add-to-cart selectors.
    const selectors = [
      '[data-test*="add-to-trolley"] button',
      'button:has-text("Add")',
      'button:has-text("Add to trolley")',
      'button:has-text("Add to basket")',
      'button:has-text("Add to cart")',
    ]

    let clicked = false
    for (const sel of selectors) {
      try {
        const btn = await page.waitForSelector(sel, { state: 'visible', timeout: 4000 })
        if (!btn) continue
        for (let i = 0; i < Math.max(1, quantity); i++) {
          await btn.click({ timeout: 4000 })
          await humanDelay(350, 800)
        }
        clicked = true
        break
      } catch {
        // next selector
      }
    }

    if (!clicked) {
      await this.writeDebug(page, `ocado_add_to_cart_failed_${id}`)
      throw new Error('Could not add item to cart (selector drift or not logged in).')
    }
  }

  async viewCart(page: Page): Promise<OcadoCartSummary> {
    await this.goToCart(page)
    await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => undefined)
    await this.assertLikelyLoggedIn(page)

    // Prefer parsing initial state when available (less selector drift).
    try {
      const state = await this.getInitialState(page)
      const cart = extractCartFromInitialState(state)
      if (cart) {
        const belowMinimum = await this.detectBelowMinimum(page)
        return {
          currency: cart.currency || 'GBP',
          total: cart.total ?? null,
          items: cart.items || [],
          _meta: { source: 'initial_state' },
          _status: belowMinimum ? { belowMinimum } : undefined,
        }
      }
    } catch {
      // fall back to DOM scraping below
    }

    // Ported conceptually from Grocery Getter: use quantity inputs as anchors.
    const summary = (await page.evaluate(`(() => {
      const doc = document

      function parseMoney(text) {
        if (!text) return null
        const raw = String(text)
        const idx = raw.indexOf('£')
        if (idx === -1) return null
        const tail = raw.slice(idx + 1)
        let num = ''
        for (let i = 0; i < tail.length; i++) {
          const ch = tail[i]
          const isDigit = ch >= '0' && ch <= '9'
          if (isDigit || ch === '.') {
            num += ch
            continue
          }
          if (num) break
        }
        const v = parseFloat(num)
        return Number.isFinite(v) ? v : null
      }

      function extractIdFromHref(href) {
        if (!href) return null
        const raw = String(href).split('?')[0].split('#')[0]
        const parts = raw.split('/')
        for (let i = parts.length - 1; i >= 0; i--) {
          const seg = parts[i]
          if (!seg) continue
          let j = seg.length - 1
          while (j >= 0) {
            const ch = seg[j]
            const isDigit = ch >= '0' && ch <= '9'
            if (!isDigit) break
            j--
          }
          const trailing = seg.slice(j + 1)
          if (trailing && trailing.length >= 4) return trailing
        }
        return null
      }

      const items = []
      const seen = new Set() // by providerProductId, else by title fallback

      const qtyInputs = Array.from(doc?.querySelectorAll?.('input[type="number"]') || [])
      for (const qtyInput of qtyInputs) {
        let parent = qtyInput
        for (let i = 0; i < 10 && parent; i++) {
          parent = parent.parentElement
          if (!parent) break

          const linkEl = parent.querySelector?.('a[href*="/products/"]')
          const providerProductId = extractIdFromHref(linkEl?.getAttribute?.('href') || null)
          const titleEl = parent.querySelector?.('h1, h2, h3, h4, h5, h6') || linkEl
          const priceEls = Array.from(parent.querySelectorAll?.('[class*="price"]') || [])
          if (!titleEl || priceEls.length === 0) continue

          const title = (titleEl.textContent || '').trim()
          if (title.length < 5 || title.length > 200) continue
          const dedupeKey = providerProductId || title
          if (seen.has(dedupeKey)) break

          let priceText = ''
          for (const el of priceEls) {
            const t = (el.textContent || '').trim()
            if (t.includes('£') && t.length < 20) {
              priceText = t
              break
            }
          }
          const price = parseMoney(priceText || null)
          const quantity = Number(qtyInput.value || '1') || 1

          items.push({
            name: title,
            providerProductId,
            quantity,
            price,
            lineTotal: price !== null ? price * quantity : null,
          })
          seen.add(dedupeKey)
          break
        }
      }

      // Total: heuristic from body text.
      const bodyText = doc?.body?.innerText || doc?.body?.textContent || ''
      const lines = String(bodyText).split('\\n').map(l => l.trim()).filter(Boolean)
      let total = null
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i].toLowerCase()
        if (line === 'total' || (line.includes('total') && !line.includes('subtotal'))) {
          const next = lines[i + 1] || ''
          const v = parseMoney(next)
          if (v !== null) {
            total = v
            break
          }
        }
      }

      return { currency: 'GBP', total, items }
    })()`)) as OcadoCartSummary

    const belowMinimum = await this.detectBelowMinimum(page)
    return {
      ...(summary as any),
      _meta: { source: 'dom' },
      _status: belowMinimum ? { belowMinimum } : undefined,
    } as OcadoCartSummary
  }

  async getCartQuantitiesByProductId(page: Page): Promise<Record<string, number>> {
    await this.goToCart(page)
    await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => undefined)
    await this.assertLikelyLoggedIn(page)

    // Prefer initial state parsing when it yields product IDs.
    try {
      const state = await this.getInitialState(page)
      const cart = extractCartFromInitialState(state)
      if (cart && cart.items.length >= 1) {
        const out: Record<string, number> = {}
        for (const it of cart.items) {
          if (it.providerProductId) out[it.providerProductId] = it.quantity
        }
        if (Object.keys(out).length >= 1) return out
      }
    } catch {
      // fall back to DOM scraping
    }

    const mapping = (await page.evaluate(`(() => {
      const doc = document

      function extractIdFromHref(href) {
        if (!href) return null
        const raw = String(href).split('?')[0].split('#')[0]
        const parts = raw.split('/')
        for (let i = parts.length - 1; i >= 0; i--) {
          const seg = parts[i]
          if (!seg) continue
          let j = seg.length - 1
          while (j >= 0) {
            const ch = seg[j]
            const isDigit = ch >= '0' && ch <= '9'
            if (!isDigit) break
            j--
          }
          const trailing = seg.slice(j + 1)
          if (trailing && trailing.length >= 4) return trailing
        }
        return null
      }

      const out = {}
      const qtyInputs = Array.from(doc?.querySelectorAll?.('input[type="number"]') || [])
      for (const qtyInput of qtyInputs) {
        let parent = qtyInput
        for (let i = 0; i < 10 && parent; i++) {
          parent = parent.parentElement
          if (!parent) break
          const linkEl = parent.querySelector?.('a[href*="/products/"]')
          const id = extractIdFromHref(linkEl?.getAttribute?.('href') || null)
          if (!id) continue
          const q = Number(qtyInput.value || '0') || 0
          if (q > 0) out[id] = q
          break
        }
      }
      return out
    })()`)) as Record<string, number>

    return mapping || {}
  }

  private slotCandidates(page: Page) {
    return page
      .locator('button, div[role="button"], [data-test*="slot"], [class*="slot"]')
      .filter({ hasText: /\d{1,2}(:\d{2})?\s*(am|pm)?\s*-\s*\d{1,2}(:\d{2})?\s*(am|pm)?/i })
  }

  async getDeliverySlots(page: Page, limit = 10): Promise<Array<{ index: number; date: string; time: string; price: string; fullText: string }>> {
    // Navigate to cart then checkout/slots.
    await this.goToCart(page)
    await this.goToCheckoutOrSlots(page)
    await page.waitForLoadState('networkidle', { timeout: 20000 }).catch(() => undefined)
    await this.assertLikelyLoggedIn(page)

    const candidates = this.slotCandidates(page)
    const count = await candidates.count().catch(() => 0)
    const lim = Math.min(Math.max(1, limit), 50)
    const slots: Array<{ index: number; date: string; time: string; price: string; fullText: string }> = []
    const seen = new Set<string>()

    for (let i = 0; i < Math.min(count, lim); i++) {
      const raw = await candidates.nth(i).innerText().catch(() => '')
      const slotText = raw.replace(/\s+/g, ' ').trim().slice(0, 200)
      if (!slotText) continue
      if (seen.has(slotText)) continue
      seen.add(slotText)

      const pm = slotText.match(/£\s*([0-9]+(?:\.[0-9]{1,2})?)/)
      const price = pm ? `£${pm[1]}` : 'N/A'

      const tm = slotText.match(/(\d{1,2}(?::\d{2})?\s*(?:am|pm)?\s*-\s*\d{1,2}(?::\d{2})?\s*(?:am|pm)?)/i)
      const time = tm ? tm[1].replace(/\s+/g, '') : 'See page'

      const dm = slotText.match(/\b(mon|tue|wed|thu|fri|sat|sun)[a-z]*\b[^0-9]{0,10}(\d{1,2})\b/i)
      const date = dm ? dm[0].trim() : 'See page'

      slots.push({
        index: i,
        date,
        time,
        price,
        fullText: slotText.substring(0, 160),
      })
    }

    if (!slots || slots.length === 0) {
      // Explicit missing-slot signal where possible.
      const noSlotsMsg = await page.locator('text=/no\\s+(delivery\\s+)?slots|sold\\s+out|nothing\\s+available/i').first().isVisible().catch(() => false)
      if (noSlotsMsg) {
        await this.writeDebug(page, 'ocado_delivery_slots_none_no_slots')
        throw new Error('[OCADO_NO_SLOTS] No delivery slots available.')
      }
      await this.writeDebug(page, 'ocado_delivery_slots_none')
    }

    return slots || []
  }

  async selectDeliverySlot(page: Page, slotIndex = 0): Promise<{ ok: boolean; fullText: string | null }> {
    // Prefer elements that look like slot cards (time range + optional price).
    try {
      const candidates = this.slotCandidates(page)
      const count = await candidates.count()
      if (count > slotIndex) {
        const fullText = (await candidates.nth(slotIndex).innerText().catch(() => '')).replace(/\s+/g, ' ').trim().slice(0, 160) || null
        await candidates.nth(slotIndex).click({ timeout: 8000 })
        await humanDelay(1400, 2400)
        return { ok: true, fullText }
      }
    } catch {
      // fall through
    }

    const selectors = ['[data-test="delivery-slot"]', '.delivery-slot', '.slot-option', 'button:has-text("Select")']
    for (const selector of selectors) {
      try {
        const els = page.locator(selector)
        const count = await els.count()
        if (count > slotIndex) {
          const fullText = (await els.nth(slotIndex).innerText().catch(() => '')).replace(/\s+/g, ' ').trim().slice(0, 160) || null
          await els.nth(slotIndex).click({ timeout: 8000 })
          await humanDelay(1400, 2400)
          return { ok: true, fullText }
        }
      } catch {}
    }
    await this.writeDebug(page, 'ocado_select_slot_failed')
    return { ok: false, fullText: null }
  }

  async placeOrder(page: Page, opts: { dryRun: boolean }): Promise<{ ok: boolean; message: string; url: string }> {
    await this.goToCart(page)
    await this.goToCheckoutOrSlots(page)
    await page.waitForLoadState('networkidle', { timeout: 20000 }).catch(() => undefined)
    await this.assertLikelyLoggedIn(page)

    // Best-effort: try selecting first slot if a slot UI exists.
    await this.selectDeliverySlot(page, 0).catch(() => ({ ok: false, fullText: null }))

    // Step through checkout with generic "continue" style buttons.
    const nextSelectors = [
      'button:has-text("Continue")',
      'button:has-text("Next")',
      'button:has-text("Proceed")',
      'button:has-text("Review")',
      'button:has-text("Confirm")',
    ]

    for (let step = 0; step < 5; step++) {
      let progressed = false
      for (const sel of nextSelectors) {
        try {
          const btn = page.locator(sel).first()
          if (await btn.isVisible({ timeout: 1500 }).catch(() => false)) {
            await btn.click({ timeout: 5000 })
            await humanDelay(1400, 2400)
            await page.waitForLoadState('networkidle', { timeout: 20000 }).catch(() => undefined)
            progressed = true
            break
          }
        } catch {
          // next
        }
      }
      if (!progressed) break
    }

    const placeSelectors = [
      'button:has-text("Place order")',
      'button:has-text("Place Order")',
      'button:has-text("Pay")',
    ]

    let canPlace = false
    for (const sel of placeSelectors) {
      const visible = await page.locator(sel).first().isVisible().catch(() => false)
      if (visible) { canPlace = true; break }
    }

    if (opts.dryRun) {
      return {
        ok: true,
        message: canPlace
          ? 'Reached final confirmation step (dry-run). Order not placed.'
          : 'Reached checkout flow (dry-run). Could not confirm final step visibility.',
        url: page.url(),
      }
    }

    // Non-dry-run: attempt to click "Place order".
    for (const sel of placeSelectors) {
      try {
        const btn = page.locator(sel).first()
        if (await btn.isVisible({ timeout: 1500 }).catch(() => false)) {
          await btn.click({ timeout: 5000 })
          await humanDelay(2000, 3500)
          await page.waitForLoadState('networkidle', { timeout: 20000 }).catch(() => undefined)
          return { ok: true, message: 'Place order clicked. Verify in Ocado.', url: page.url() }
        }
      } catch {
        // next
      }
    }

    await this.writeDebug(page, 'ocado_place_order_failed')
    return { ok: false, message: 'Could not find Place order button.', url: page.url() }
  }

  async writeDebug(page: Page, slug: string) {
    try {
      const safe = slug.replace(/[^a-zA-Z0-9_-]+/g, '_').slice(0, 80)
      const stamp = new Date().toISOString().replace(/[^0-9T]+/g, '_').replace(/_+/g, '_').slice(0, 19)
      const base = `ocado_${safe}_${stamp}`
      const html = await page.content().catch(() => '')
      if (html) {
        await import('node:fs/promises').then(fs => fs.writeFile(`/tmp/${base}.html`, html, 'utf8'))
      }
      await page.screenshot({ path: `/tmp/${base}.png`, fullPage: true }).catch(() => undefined)
    } catch {
      // ignore debug failures
    }
  }
}
