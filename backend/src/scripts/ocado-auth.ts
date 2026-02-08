import { chromium } from 'playwright'
import { writeFile } from 'node:fs/promises'
import path from 'node:path'
import { PrismaClient } from '@prisma/client'
import { setStoreSession } from '../services/store-session.js'

function argValue(name: string): string | null {
  const idx = process.argv.findIndex(a => a === name)
  if (idx === -1) return null
  return process.argv[idx + 1] || null
}

function envFlag(name: string, defaultValue = false): boolean {
  const raw = process.env[name]
  if (raw === undefined) return defaultValue
  return ['1', 'true', 'yes', 'on'].includes(String(raw).toLowerCase())
}

function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

async function isLikelyLoggedIn(page: any): Promise<boolean> {
  const url = String(page.url() || '').toLowerCase()
  if (url.includes('login') || url.includes('signin')) return false

  const signIn = await page.locator('text=/sign in|log in/i').first().isVisible().catch(() => false)
  if (signIn) return false

  const signOut = await page.locator('text=/sign out|log out/i').first().isVisible().catch(() => false)
  if (signOut) return true

  const accountLink = await page.locator('a[href*="account"], a[href*="myaccount"], a[href*="orders"]').first().isVisible().catch(() => false)
  if (accountLink) return true

  // Cookie heuristic: if there are many cookies, we likely have a session.
  const cookies = await page.context().cookies().catch(() => [])
  if (Array.isArray(cookies) && cookies.length >= 5) return true

  return false
}

async function main() {
  const outPath = argValue('--out')
  const output = outPath || '/tmp/ocado_storage_state.json'

  const timeoutSeconds = Number(argValue('--timeout-seconds') || '') || 600
  const profileDir = argValue('--profile-dir') || path.join('/tmp', 'ocado_playwright_profile')
  const useChromeChannel = envFlag('OCADO_USE_CHROME_CHANNEL', true)

  // Persistent context reduces automation churn and tends to be less captcha-prone than
  // a fresh ephemeral profile each run.
  const context = await chromium.launchPersistentContext(profileDir, {
    headless: false,
    // Using real Chrome can reduce bot checks vs bundled Chromium.
    ...(useChromeChannel ? { channel: 'chrome' as any } : {}),
    viewport: { width: 1280, height: 900 },
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
    args: ['--disable-blink-features=AutomationControlled'],
  })

  await context.addInitScript(() => {
    // Minimal webdriver fingerprint reduction.
    try {
      Object.defineProperty(navigator, 'webdriver', { get: () => undefined })
    } catch {}
  })

  const page = await context.newPage()

  await page.goto('https://www.ocado.com', { waitUntil: 'domcontentloaded' })
  console.log('')
  console.log('Ocado auth helper')
  console.log(`1) A browser window opened to Ocado.`)
  console.log('2) Log in normally (including any 2FA).')
  console.log('3) If you see a captcha, solve it in the browser.')
  console.log('4) This script will auto-detect when you are logged in and save the session.')
  console.log('')

  const deadline = Date.now() + timeoutSeconds * 1000
  let lastNoteAt = 0
  while (Date.now() < deadline) {
    const captcha = await page.locator('text=/captcha|verify you are human|are you a robot/i').first().isVisible().catch(() => false)
    if (captcha && Date.now() - lastNoteAt > 15000) {
      lastNoteAt = Date.now()
      console.log('Captcha detected in the browser. Solve it there; I will keep waiting...')
    }

    if (await isLikelyLoggedIn(page)) break
    await sleep(1500)
  }

  if (!(await isLikelyLoggedIn(page))) {
    await page.screenshot({ path: '/tmp/ocado_auth_timeout.png', fullPage: true }).catch(() => undefined)
    throw new Error(`Timed out after ${timeoutSeconds}s waiting for login. Screenshot: /tmp/ocado_auth_timeout.png`)
  }

  const storageState = await context.storageState()
  await writeFile(output, JSON.stringify(storageState, null, 2), 'utf8')
  console.log('')
  console.log(`Saved Playwright storageState to: ${output}`)
  console.log('Attempting to also store this session into the encrypted DB (if configured)...')

  // Save to DB for immediate use in backend APIs (requires DATABASE_URL and MEAL_PLANNER_ENCRYPTION_KEY).
  try {
    const prisma = new PrismaClient()
    await setStoreSession(prisma, 'ocado', JSON.stringify(storageState))
    await prisma.$disconnect()
    console.log('Saved session to DB (encrypted).')
  } catch (e: any) {
    console.log(`Could not save session to DB: ${String(e?.message || e)}`)
    console.log('You can still paste the JSON into Settings -> Online Ordering.')
  }

  await context.close().catch(() => undefined)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
