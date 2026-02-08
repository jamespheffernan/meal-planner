import type { PrismaClient } from '@prisma/client'
import { getOpenAIClient } from '../openai-client.js'
import { getBudgetSummary } from '../budget/summary.js'
import { detectStaplesFromOrders } from '../staples/detector.js'
import { prepareOcadoOrderForShoppingList } from '../orders/prepare-order.js'
import { checkoutDryRunForShoppingList } from '../orders/ocado-ordering.js'
import { addOcadoShoppingListToCart } from '../orders/add-to-cart.js'

type Channel = 'telegram' | 'web'

type StoredState = {
  messages?: Array<{ role: 'system' | 'user' | 'assistant' | 'tool'; content: string; name?: string; tool_call_id?: string }>
}

function envFlag(name: string, defaultValue = false): boolean {
  const raw = process.env[name]
  if (raw === undefined) return defaultValue
  return ['1', 'true', 'yes', 'on'].includes(String(raw).toLowerCase())
}

function trimHistory<T>(arr: T[], max: number): T[] {
  if (arr.length <= max) return arr
  return arr.slice(arr.length - max)
}

export async function handleAssistantMessage(prisma: PrismaClient, input: { channel: Channel; externalId: string; message: string }) {
  if (!envFlag('ENABLE_SHOPPING_ASSISTANT', false)) {
    return { ok: false, message: 'Shopping assistant disabled (set ENABLE_SHOPPING_ASSISTANT=true).' }
  }

  const actions: any[] = []

  // Deterministic fast-path for ordering flows, so it works even if the model doesn't tool-call.
  const lower = input.message.toLowerCase()
  if (input.channel === 'telegram' && /\b(order|ocado|checkout|book a slot|delivery slot|delivery slots)\b/.test(lower)) {
    const list = await prisma.shoppingList.findFirst({
      where: { status: { in: ['draft', 'ready', 'shopping'] } },
      orderBy: { createdAt: 'desc' },
    })
    if (!list) {
      return { ok: true, response: 'No active shopping list. Generate one in the web app first.', actions }
    }

    const prepared = await prepareOcadoOrderForShoppingList(prisma, list.id, { maxResultsPerItem: 5 })
    if (!prepared.ok) {
      return { ok: true, response: prepared.error || 'Could not prepare order.', actions }
    }

    actions.push({ type: 'telegram_order_prepare', prepared })
    const needs = prepared.needsChoice?.length || 0
    const auto = prepared.autoMapped?.length || 0
    return {
      ok: true,
      response: needs > 0
        ? `I can order your shopping list on Ocado. ${auto} items are already mapped; ${needs} need a quick product choice.`
        : `I can order your shopping list on Ocado. All items are already mapped.`,
      actions,
    }
  }

  let openai: any
  try {
    openai = await getOpenAIClient(prisma)
  } catch (e: any) {
    const msg = String(e?.message || e || '')
    if (msg.toLowerCase().includes('openai api key')) {
      return {
        ok: true,
        response: 'OpenAI is not configured. Add an OpenAI API key in Settings, or set OPENAI_API_KEY in the environment.',
        actions,
      }
    }
    return { ok: true, response: `Assistant is not available: ${msg || 'missing configuration'}`, actions }
  }

  const session = await prisma.assistantSession.upsert({
    where: { channel_externalId: { channel: input.channel, externalId: input.externalId } },
    update: {},
    create: { channel: input.channel, externalId: input.externalId, state: { messages: [] } },
  })

  const state = (session.state || {}) as StoredState
  const history = Array.isArray(state.messages) ? state.messages : []

  const systemPrompt = `You are a grocery shopping assistant embedded inside a meal planning app.

You can:
- summarize the active shopping list,
- suggest staples based on purchase history,
- summarize budget based on past purchase orders.

Be concise and practical (2-6 sentences). If you cannot perform an action due to missing configuration, say exactly what is missing and where to set it (Settings page / env var).`

  const messages: any[] = [
    { role: 'system', content: systemPrompt },
    ...history,
    { role: 'user', content: input.message },
  ]

  const tools: any[] = [
    {
      type: 'function',
      function: {
        name: 'get_active_shopping_list',
        description: 'Get the most recent non-completed shopping list and return only needed items.',
        parameters: { type: 'object', properties: {}, required: [] },
      },
    },
    {
      type: 'function',
      function: {
        name: 'get_budget_summary',
        description: 'Get budget summary from purchase history.',
        parameters: {
          type: 'object',
          properties: { weeks: { type: 'integer', minimum: 1, maximum: 52, default: 8 } },
          required: [],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'get_staple_suggestions',
        description: 'Detect staple suggestions from purchase order history.',
        parameters: {
          type: 'object',
          properties: { weeks: { type: 'integer', minimum: 1, maximum: 52, default: 12 } },
          required: [],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'start_order_on_ocado',
        description: 'Prepare the active shopping list for ordering on Ocado (maps items and returns choices).',
        parameters: { type: 'object', properties: {}, required: [] },
      },
    },
    {
      type: 'function',
      function: {
        name: 'checkout_dry_run',
        description: 'Check delivery slots (dry-run) for the active shopping list on Ocado. Does not place an order.',
        parameters: { type: 'object', properties: {}, required: [] },
      },
    },
    {
      type: 'function',
      function: {
        name: 'add_active_list_to_cart',
        description: 'Add the active shopping list to the Ocado cart using stored mappings. Does not place an order.',
        parameters: { type: 'object', properties: {}, required: [] },
      },
    },
  ]

  let loopGuard = 0
  let lastAssistantText = ''
  let workingMessages = messages

  while (loopGuard++ < 6) {
    const resp = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: workingMessages,
      tools,
      tool_choice: 'auto',
      temperature: 0.2,
    })

    const choice = resp.choices[0]
    const msg: any = choice?.message
    if (!msg) break

    // If no tool calls, we are done.
    const toolCalls = msg.tool_calls || []
    if (!toolCalls.length) {
      lastAssistantText = msg.content || ''
      workingMessages = [...workingMessages, { role: 'assistant', content: lastAssistantText }]
      break
    }

    // Append assistant tool-call message.
    workingMessages = [...workingMessages, msg]

    for (const tc of toolCalls) {
      const name = tc.function?.name
      let args: any = {}
      try {
        args = tc.function?.arguments ? JSON.parse(tc.function.arguments) : {}
      } catch {
        args = {}
      }

      let result: any
      try {
        if (name === 'get_active_shopping_list') {
          const list = await prisma.shoppingList.findFirst({
            where: { status: { in: ['draft', 'ready', 'shopping'] } },
            include: { items: { include: { ingredient: true }, orderBy: { createdAt: 'asc' } } },
            orderBy: { createdAt: 'desc' },
          })
          const needed = (list?.items || []).filter(i => {
            if (i.userOverride === 'have') return false
            if (i.userOverride === 'need') return true
            return !i.assumedHave
          })
          result = {
            listId: list?.id || null,
            createdDate: list?.createdDate || null,
            neededCount: needed.length,
            neededItems: needed.slice(0, 30).map(i => `${i.ingredient.name} (${i.quantity} ${i.unit})`),
          }
        } else if (name === 'get_budget_summary') {
          result = await getBudgetSummary(prisma, Number(args?.weeks || 8))
        } else if (name === 'get_staple_suggestions') {
          const suggestions = await detectStaplesFromOrders(prisma, { weeks: Number(args?.weeks || 12) })
          result = { suggestions: suggestions.slice(0, 15) }
        } else if (name === 'start_order_on_ocado') {
          const list = await prisma.shoppingList.findFirst({
            where: { status: { in: ['draft', 'ready', 'shopping'] } },
            orderBy: { createdAt: 'desc' },
          })
          if (!list) {
            result = { error: 'No active shopping list.' }
          } else {
            const prepared = await prepareOcadoOrderForShoppingList(prisma, list.id, { maxResultsPerItem: 5 })
            result = prepared
            if (prepared.ok && input.channel === 'telegram') {
              actions.push({ type: 'telegram_order_prepare', prepared })
            }
          }
        } else if (name === 'checkout_dry_run') {
          const list = await prisma.shoppingList.findFirst({
            where: { status: { in: ['draft', 'ready', 'shopping'] } },
            orderBy: { createdAt: 'desc' },
          })
          if (!list) {
            result = { error: 'No active shopping list.' }
          } else {
            result = await checkoutDryRunForShoppingList(prisma, list.id)
          }
        } else if (name === 'add_active_list_to_cart') {
          const list = await prisma.shoppingList.findFirst({
            where: { status: { in: ['draft', 'ready', 'shopping'] } },
            orderBy: { createdAt: 'desc' },
          })
          if (!list) {
            result = { error: 'No active shopping list.' }
          } else {
            result = await addOcadoShoppingListToCart(prisma, list.id)
          }
        } else {
          result = { error: `Unknown tool: ${name}` }
        }
      } catch (e: any) {
        result = { error: String(e?.message || e || 'Tool failed') }
      }

      workingMessages = [
        ...workingMessages,
        {
          role: 'tool',
          tool_call_id: tc.id,
          content: JSON.stringify(result),
        },
      ]
    }
  }

  const toStore = trimHistory(
    workingMessages
      .filter((m: any) => m.role !== 'system')
      .map((m: any) => {
        if (m.role === 'tool') return { role: 'tool', content: m.content, tool_call_id: m.tool_call_id }
        return { role: m.role, content: m.content || '' }
      }),
    20
  )

  await prisma.assistantSession.update({
    where: { id: session.id },
    data: { state: { messages: toStore } },
  })

  return { ok: true, response: lastAssistantText || 'Sorry, I could not generate a response.', actions }
}
