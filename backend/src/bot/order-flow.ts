import type { PrismaClient } from '@prisma/client'
import type { Context } from 'telegraf'
import { Markup } from 'telegraf'
import { prepareOcadoOrderForShoppingList } from '../services/orders/prepare-order.js'
import { confirmOcadoMappings } from '../services/orders/mappings.js'
import { addOcadoShoppingListToCart } from '../services/orders/add-to-cart.js'
import { checkoutDryRunForShoppingList } from '../services/orders/ocado-ordering.js'
import { consumeTelegramToken, getPendingOrder, putTelegramToken, setPendingOrder } from './telegram-tokens.js'

type AnyCtx = Context & any

export async function startTelegramOcadoOrder(ctx: AnyCtx, prisma: PrismaClient, shoppingListId?: string) {
  const chatId = String(ctx.chat.id)

  const listId = shoppingListId || (await prisma.shoppingList.findFirst({
    where: { status: { in: ['draft', 'ready', 'shopping'] } },
    orderBy: { createdAt: 'desc' },
  }))?.id

  if (!listId) {
    await ctx.reply('No active shopping list. Generate one in the web app first.')
    return
  }

  const prepared = await prepareOcadoOrderForShoppingList(prisma, listId, { maxResultsPerItem: 5 })
  if (!prepared.ok) {
    await ctx.reply(prepared.error || 'Could not prepare order.')
    return
  }

  const remaining = prepared.needsChoice.map((x: any) => x.ingredientId)
  await setPendingOrder(prisma, chatId, {
    shoppingListId: listId,
    remainingIngredientIds: remaining,
    createdAt: new Date().toISOString(),
  })

  if (prepared.needsChoice.length === 0) {
    await ctx.reply('All items are already mapped. Ready to add to your Ocado cart?', Markup.inlineKeyboard([
      [Markup.button.callback('Add to cart', `ggtok:${await putTelegramToken(prisma, chatId, { type: 'add_to_cart', shoppingListId: listId })}`)],
      [Markup.button.callback('Check delivery slots', `ggtok:${await putTelegramToken(prisma, chatId, { type: 'slots', shoppingListId: listId })}`)],
    ]))
    return
  }

  await ctx.reply(`I need quick choices for ${prepared.needsChoice.length} item(s). Tap the exact product you want.`)

  for (const item of prepared.needsChoice) {
    const buttons = []
    for (const cand of item.candidates.slice(0, 6)) {
      const token = await putTelegramToken(prisma, chatId, {
        type: 'map',
        shoppingListId: listId,
        ingredientId: item.ingredientId,
        storeProductId: cand.storeProductId,
      })
      const label = `${cand.name}${cand.price !== null ? ` (£${cand.price.toFixed(2)})` : ''}`
      buttons.push([Markup.button.callback(label.slice(0, 50), `ggtok:${token}`)])
    }

    await ctx.reply(`Choose for: ${item.ingredientName}`, Markup.inlineKeyboard(buttons))
  }
}

export async function handleTelegramTokenCallback(ctx: AnyCtx, prisma: PrismaClient, token: string) {
  const chatId = String(ctx.chat.id)
  const payload = await consumeTelegramToken(prisma, chatId, token)
  if (!payload) {
    await ctx.answerCbQuery('Expired action. Please try again.')
    return
  }

  if (payload.type === 'map') {
    await confirmOcadoMappings(prisma, payload.shoppingListId, [{ ingredientId: payload.ingredientId, storeProductId: payload.storeProductId, isDefault: true }])
    await ctx.answerCbQuery('Saved mapping')

    const pending = await getPendingOrder(prisma, chatId)
    if (pending && pending.shoppingListId === payload.shoppingListId) {
      const remaining = pending.remainingIngredientIds.filter((id) => id !== payload.ingredientId)
      await setPendingOrder(prisma, chatId, { ...pending, remainingIngredientIds: remaining })
      if (remaining.length === 0) {
        await ctx.reply('All mapped. Ready to add to cart?', Markup.inlineKeyboard([
          [Markup.button.callback('Add to cart', `ggtok:${await putTelegramToken(prisma, chatId, { type: 'add_to_cart', shoppingListId: pending.shoppingListId })}`)],
          [Markup.button.callback('Check delivery slots', `ggtok:${await putTelegramToken(prisma, chatId, { type: 'slots', shoppingListId: pending.shoppingListId })}`)],
        ]))
      }
    }
    return
  }

  if (payload.type === 'add_to_cart') {
    await ctx.answerCbQuery('Adding…')
    const result = await addOcadoShoppingListToCart(prisma, payload.shoppingListId)
    if (!result.ok) {
      await ctx.reply(result.error || 'Failed to add to cart.')
      return
    }
    await ctx.reply(`Added ${result.added.length} item(s) to cart. Cart total: ${result.cart.total !== null ? `£${result.cart.total.toFixed(2)}` : 'unknown'}.`)
    await ctx.reply('Open Ocado to checkout:', Markup.inlineKeyboard([
      [Markup.button.url('Open Ocado', 'https://www.ocado.com')],
      [Markup.button.callback('Check delivery slots', `ggtok:${await putTelegramToken(prisma, chatId, { type: 'slots', shoppingListId: payload.shoppingListId })}`)],
    ]))
    return
  }

  if (payload.type === 'slots') {
    await ctx.answerCbQuery('Checking…')
    const res = await checkoutDryRunForShoppingList(prisma, payload.shoppingListId)
    const slots = (res as any)?.slots || []
    if (slots.length === 0) {
      await ctx.reply('No delivery slots detected automatically. Open Ocado to pick a slot manually.')
      return
    }
    const text = slots.slice(0, 8).map((s: any, i: number) => `${i + 1}. ${s.fullText} (${s.price})`).join('\n')
    await ctx.reply(`Delivery slots (dry-run):\n${text}`)
    return
  }

  await ctx.answerCbQuery('Unknown action')
}
