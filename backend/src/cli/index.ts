#!/usr/bin/env node
import { readFile } from 'node:fs/promises'
import process from 'node:process'

const DEFAULT_BASE_URL = process.env.MEAL_PLANNER_API_URL || 'http://localhost:3001/api'
const METHODS = new Set(['GET', 'POST', 'PUT', 'PATCH', 'DELETE'])

type ParsedArgs = {
  method: string
  path: string
  baseUrl: string
  data?: string
  dataFile?: string
  headers: string[]
  pretty: boolean
  raw: boolean
}

function printHelp() {
  console.log(`Meal Planner CLI

Usage:
  npm run cli -- api [METHOD] <path> [options]

Examples:
  npm run cli -- api GET /recipes
  npm run cli -- api /recipes/123
  npm run cli -- api POST /recipes --data '{"name":"Pasta","servings":2,"cookTimeMinutes":15,"mealType":"dinner","cookingStyle":"quick_weeknight"}'
  npm run cli -- api PATCH /recipes/123/approval --data '{"approvalStatus":"approved"}'
  npm run cli -- api POST /recipes/123/generate-image
  npm run cli -- api POST /import/url --data '{"url":"https://example.com/recipe"}'

Options:
  --base-url <url>        API base URL (default: ${DEFAULT_BASE_URL})
  --data <json|string>    Request body (JSON or raw string)
  --data-file <path>      Read request body from file
  --header <k:v>          Add header (can repeat)
  --pretty               Pretty-print JSON responses
  --raw                  Print raw response text
`)
}

function parseArgs(argv: string[]): ParsedArgs | null {
  if (argv.length === 0) return null
  const command = argv.shift()
  if (command !== 'api') return null

  let method = 'GET'
  let path = ''

  if (argv[0] && METHODS.has(argv[0].toUpperCase())) {
    method = argv.shift()!.toUpperCase()
  }

  if (argv[0] && !argv[0].startsWith('--')) {
    path = argv.shift()!
  }

  const flags: ParsedArgs = {
    method,
    path,
    baseUrl: DEFAULT_BASE_URL,
    headers: [],
    pretty: false,
    raw: false,
  }

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    if (!arg.startsWith('--')) continue
    const value = argv[i + 1]
    if (arg === '--base-url' && value) {
      flags.baseUrl = value
      i += 1
      continue
    }
    if (arg === '--data' && value) {
      flags.data = value
      i += 1
      continue
    }
    if (arg === '--data-file' && value) {
      flags.dataFile = value
      i += 1
      continue
    }
    if (arg === '--header' && value) {
      flags.headers.push(value)
      i += 1
      continue
    }
    if (arg === '--pretty') {
      flags.pretty = true
      continue
    }
    if (arg === '--raw') {
      flags.raw = true
      continue
    }
  }

  return flags
}

function parseHeaders(headerPairs: string[]): Record<string, string> {
  const headers: Record<string, string> = {}
  for (const pair of headerPairs) {
    const idx = pair.indexOf(':')
    if (idx === -1) continue
    const key = pair.slice(0, idx).trim()
    const value = pair.slice(idx + 1).trim()
    if (key) headers[key] = value
  }
  return headers
}

async function resolveBody(data?: string, dataFile?: string) {
  if (dataFile) {
    return readFile(dataFile, 'utf8')
  }
  if (data && data.startsWith('@')) {
    return readFile(data.slice(1), 'utf8')
  }
  return data
}

async function main() {
  const parsed = parseArgs(process.argv.slice(2))
  if (!parsed || !parsed.path) {
    printHelp()
    process.exit(parsed ? 1 : 0)
  }

  const url = `${parsed.baseUrl}${parsed.path}`
  const headers = parseHeaders(parsed.headers)

  const body = await resolveBody(parsed.data, parsed.dataFile)
  let finalBody: string | undefined

  if (body !== undefined) {
    try {
      const parsedBody = JSON.parse(body)
      finalBody = JSON.stringify(parsedBody)
      if (!headers['Content-Type']) {
        headers['Content-Type'] = 'application/json'
      }
    } catch {
      finalBody = body
    }
  }

  const response = await fetch(url, {
    method: parsed.method,
    headers,
    body: finalBody,
  })

  const text = await response.text()
  const contentType = response.headers.get('content-type') || ''

  if (!response.ok) {
    console.error(`Request failed: ${response.status} ${response.statusText}`)
    if (text) console.error(text)
    process.exit(1)
  }

  if (parsed.raw || !contentType.includes('application/json')) {
    console.log(text)
    return
  }

  try {
    const json = JSON.parse(text)
    console.log(parsed.pretty ? JSON.stringify(json, null, 2) : JSON.stringify(json))
  } catch {
    console.log(text)
  }
}

main().catch((error) => {
  console.error('CLI error:', error instanceof Error ? error.message : error)
  process.exit(1)
})
