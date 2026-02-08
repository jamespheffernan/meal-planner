import { Telegraf, Markup } from 'telegraf'
import { PrismaClient } from '@prisma/client'
import { format, addDays, startOfWeek } from 'date-fns'
import { RecommendationEngine } from '../services/recommendation-engine.js'
import { handleAssistantMessage } from '../services/shopping-assistant/orchestrator.js'
import { handleTelegramTokenCallback, startTelegramOcadoOrder } from './order-flow.js'

const prisma = new PrismaClient()
const bot = new Telegraf(process.env.TELEGRAM_BOT_TOKEN!)

// Initialize recommendation engine
const recommendationEngine = new RecommendationEngine(prisma)

function envFlag(name: string, defaultValue = false): boolean {
  const raw = process.env[name]
  if (raw === undefined) return defaultValue
  return ['1', 'true', 'yes', 'on'].includes(String(raw).toLowerCase())
}

// Start command
bot.start((ctx) => {
  return ctx.reply(
    `Welcome to Meal Planner Bot! 🍽️

Commands:
/meals - View upcoming meals
/shopping - View shopping list
/pantry - Check pantry status
/suggest - Get recipe suggestion
/cooked - Mark a meal as cooked
/expiring - View expiring items
/help - Show all commands`,
    Markup.keyboard([
      ['📅 Meals', '🛒 Shopping'],
      ['📦 Pantry', '💡 Suggest'],
    ]).resize()
  )
})

// Help command
bot.help((ctx) => {
  return ctx.reply(
    `Meal Planner Bot Commands:

/meals - View upcoming meal plan
/shopping - View current shopping list
/pantry - Check pantry inventory
/suggest - Get a recipe suggestion for today
/cooked <recipe name> - Mark a meal as cooked
/expiring - View items expiring soon
/checkin - Pantry check-in
/order - Prepare ordering on Ocado (mapping + add to cart)

Quick replies are also available using the keyboard below.`
  )
})

// View upcoming meals
bot.command('meals', async (ctx) => {
  const today = new Date()
  const weekEnd = addDays(today, 7)

  const mealPlans = await prisma.mealPlan.findMany({
    where: {
      plannedDate: {
        gte: today,
        lte: weekEnd,
      },
      status: 'planned',
    },
    include: {
      recipe: true,
    },
    orderBy: [
      { plannedDate: 'asc' },
      { mealType: 'asc' },
    ],
  })

  if (mealPlans.length === 0) {
    return ctx.reply('No meals planned for the next 7 days. Use the web app to plan your meals!')
  }

  let message = '📅 *Upcoming Meals*\n\n'

  // Group by date
  const byDate = new Map<string, typeof mealPlans>()
  for (const meal of mealPlans) {
    const dateStr = format(new Date(meal.plannedDate), 'yyyy-MM-dd')
    if (!byDate.has(dateStr)) byDate.set(dateStr, [])
    byDate.get(dateStr)!.push(meal)
  }

  for (const [dateStr, meals] of byDate) {
    const date = new Date(dateStr)
    message += `*${format(date, 'EEEE, MMM d')}*\n`
    for (const meal of meals) {
      const icon = meal.mealType === 'breakfast' ? '🌅' :
                   meal.mealType === 'lunch' ? '☀️' :
                   meal.mealType === 'dinner' ? '🌙' : '🍪'
      message += `${icon} ${meal.mealType}: ${meal.recipe?.name || 'Unknown'}\n`
    }
    message += '\n'
  }

  return ctx.replyWithMarkdown(message)
})

// Keyboard handler for meals
bot.hears('📅 Meals', async (ctx) => {
  return ctx.reply('/meals')
})

// View shopping list
bot.command('shopping', async (ctx) => {
  const list = await prisma.shoppingList.findFirst({
    where: {
      status: { in: ['draft', 'ready', 'shopping'] },
    },
    include: {
      items: {
        include: {
          ingredient: true,
        },
        where: {
          OR: [
            { userOverride: 'need' },
            { assumedHave: false, userOverride: null },
          ],
        },
      },
    },
    orderBy: { createdAt: 'desc' },
  })

  if (!list || list.items.length === 0) {
    return ctx.reply('No active shopping list. Generate one from the web app!')
  }

  let message = '🛒 *Shopping List*\n\n'

  // Group by category
  const byCategory = new Map<string, typeof list.items>()
  for (const item of list.items) {
    const category = item.ingredient.category
    if (!byCategory.has(category)) byCategory.set(category, [])
    byCategory.get(category)!.push(item)
  }

  for (const [category, items] of byCategory) {
    message += `*${category.charAt(0).toUpperCase() + category.slice(1)}*\n`
    for (const item of items) {
      const check = item.purchased ? '✅' : '⬜'
      message += `${check} ${item.ingredient.name} (${item.quantity} ${item.unit})\n`
    }
    message += '\n'
  }

  const unpurchased = list.items.filter(i => !i.purchased).length
  message += `\n_${unpurchased} items remaining_`

  return ctx.replyWithMarkdown(message)
})

bot.hears('🛒 Shopping', async (ctx) => {
  return ctx.reply('/shopping')
})

// Start an Ocado order flow (mapping + add to cart)
bot.command('order', async (ctx) => {
  if (!envFlag('ENABLE_STORE_OCADO', true)) {
    return ctx.reply('Ocado integration disabled on server.')
  }
  return startTelegramOcadoOrder(ctx as any, prisma)
})

// Pantry status
bot.command('pantry', async (ctx) => {
  const items = await prisma.pantryInventory.findMany({
    where: { status: { not: 'depleted' } },
    include: { ingredient: true },
    orderBy: { expirationDate: 'asc' },
    take: 20,
  })

  if (items.length === 0) {
    return ctx.reply('Your pantry is empty! Add items from the web app.')
  }

  let message = '📦 *Pantry Status*\n\n'

  for (const item of items) {
    const status = item.status === 'running_low' ? '⚠️' : '✅'
    let expiry = ''
    if (item.expirationDate) {
      const daysUntil = Math.ceil(
        (new Date(item.expirationDate).getTime() - Date.now()) / (1000 * 60 * 60 * 24)
      )
      if (daysUntil <= 3) expiry = ' 🔴'
      else if (daysUntil <= 7) expiry = ' 🟡'
    }
    message += `${status} ${item.ingredient.name}${expiry}\n`
  }

  return ctx.replyWithMarkdown(message)
})

bot.hears('📦 Pantry', async (ctx) => {
  return ctx.reply('/pantry')
})

// Recipe suggestion
bot.command('suggest', async (ctx) => {
  const today = new Date().getDay() // 0 = Sunday

  const suggestion = await recommendationEngine.suggestRecipe({
    mealType: 'dinner',
    dayOfWeek: today,
  })

  if (!suggestion) {
    return ctx.reply('No approved recipes found. Approve some recipes in the web app first!')
  }

  const recipe = suggestion.recipe
  const time = recipe.totalTimeMinutes || recipe.cookTimeMinutes

  const message = `💡 *Recipe Suggestion*

*${recipe.name}*
⏱ ${time} minutes
👥 ${recipe.servings} servings
${recipe.cookingStyle === 'quick_weeknight' ? '⚡ Quick weeknight meal' :
  recipe.cookingStyle === 'batch_cook' ? '📦 Great for batch cooking' :
  '✨ Special occasion'}

Would you like to cook this?`

  return ctx.replyWithMarkdown(
    message,
    Markup.inlineKeyboard([
      [
        Markup.button.callback('✅ Yes, cooking now', `cook_${recipe.id}`),
        Markup.button.callback('🔄 Another suggestion', 'suggest_another'),
      ],
      [
        Markup.button.callback('📅 Add to meal plan', `plan_${recipe.id}`),
      ],
    ])
  )
})

bot.hears('💡 Suggest', async (ctx) => {
  return ctx.reply('/suggest')
})

// Handle cooking confirmation
bot.action(/^cook_(.+)$/, async (ctx) => {
  const recipeId = ctx.match[1]

  // Create cooking history entry
  const recipe = await prisma.recipe.findUnique({ where: { id: recipeId } })
  if (!recipe) {
    return ctx.answerCbQuery('Recipe not found')
  }

  await prisma.cookingHistory.create({
    data: {
      recipeId,
      cookedDate: new Date(),
      servingsMade: recipe.servings,
      isBatchCook: false,
      intendedMealCount: 1,
    },
  })

  await prisma.recipe.update({
    where: { id: recipeId },
    data: {
      timesCooked: { increment: 1 },
      lastCookedDate: new Date(),
    },
  })

  await ctx.answerCbQuery('Marked as cooking!')
  await ctx.editMessageText(
    `Great! Enjoy cooking *${recipe.name}*! 🍳\n\nI'll ask for your feedback later.`,
    { parse_mode: 'Markdown' }
  )

  // Schedule feedback request (in a real app, this would be a proper job queue)
  setTimeout(async () => {
    await ctx.reply(
      `How was *${recipe.name}*?`,
      {
        parse_mode: 'Markdown',
        ...Markup.inlineKeyboard([
          [
            Markup.button.callback('👍 Great!', `feedback_${recipeId}_thumbs_up`),
            Markup.button.callback('👎 Not great', `feedback_${recipeId}_thumbs_down`),
            Markup.button.callback('😐 Okay', `feedback_${recipeId}_neutral`),
          ],
        ]),
      }
    )
  }, 2 * 60 * 60 * 1000) // 2 hours later (for demo, would be configurable)
})

// Handle feedback
bot.action(/^feedback_(.+)_(thumbs_up|thumbs_down|neutral)$/, async (ctx) => {
  const recipeId = ctx.match[1]
  const rating = ctx.match[2] as 'thumbs_up' | 'thumbs_down' | 'neutral'

  // Find the most recent cooking history for this recipe
  const history = await prisma.cookingHistory.findFirst({
    where: { recipeId },
    orderBy: { createdAt: 'desc' },
  })

  if (history) {
    await prisma.cookingHistory.update({
      where: { id: history.id },
      data: { rating },
    })
  }

  const response = rating === 'thumbs_up' ? 'Glad you liked it! 🎉' :
                   rating === 'thumbs_down' ? 'Sorry to hear that. I\'ll note this for future suggestions.' :
                   'Got it, thanks for the feedback!'

  await ctx.answerCbQuery(response)
  await ctx.editMessageText(response)

  // Follow-up question
  if (rating !== 'thumbs_down') {
    await ctx.reply(
      'Would you make this again?',
      Markup.inlineKeyboard([
        [
          Markup.button.callback('Yes!', `again_${recipeId}_yes`),
          Markup.button.callback('Maybe', `again_${recipeId}_maybe`),
          Markup.button.callback('No', `again_${recipeId}_no`),
        ],
      ])
    )
  }
})

// Handle "would make again" response
bot.action(/^again_(.+)_(yes|maybe|no)$/, async (ctx) => {
  const recipeId = ctx.match[1]
  const wouldMakeAgain = ctx.match[2] === 'yes' ? true : ctx.match[2] === 'no' ? false : null

  const history = await prisma.cookingHistory.findFirst({
    where: { recipeId },
    orderBy: { createdAt: 'desc' },
  })

  if (history && wouldMakeAgain !== null) {
    await prisma.cookingHistory.update({
      where: { id: history.id },
      data: { wouldMakeAgain },
    })
  }

  await ctx.answerCbQuery('Thanks!')
  await ctx.editMessageText('Thanks for the feedback! It helps improve suggestions. 📊')
})

// Another suggestion
bot.action('suggest_another', async (ctx) => {
  await ctx.answerCbQuery('Getting another suggestion...')
  // Trigger the suggest command again
  await ctx.reply('/suggest')
})

// Expiring items
bot.command('expiring', async (ctx) => {
  const threshold = new Date()
  threshold.setDate(threshold.getDate() + 5)

  const items = await prisma.pantryInventory.findMany({
    where: {
      expirationDate: {
        lte: threshold,
        gte: new Date(),
      },
      status: { not: 'depleted' },
    },
    include: { ingredient: true },
    orderBy: { expirationDate: 'asc' },
  })

  if (items.length === 0) {
    return ctx.reply('No items expiring in the next 5 days! 🎉')
  }

  let message = '⚠️ *Expiring Soon*\n\n'

  for (const item of items) {
    const daysLeft = Math.ceil(
      (new Date(item.expirationDate!).getTime() - Date.now()) / (1000 * 60 * 60 * 24)
    )
    const urgency = daysLeft <= 2 ? '🔴' : daysLeft <= 4 ? '🟡' : '🟢'
    message += `${urgency} ${item.ingredient.name} - ${daysLeft} day${daysLeft !== 1 ? 's' : ''} left\n`
  }

  message += '\nUse /suggest to find recipes using these ingredients!'

  return ctx.replyWithMarkdown(message)
})

// Pantry check-in
bot.command('checkin', async (ctx) => {
  // Find items that haven't been updated recently
  const threshold = new Date()
  threshold.setDate(threshold.getDate() - 7)

  const items = await prisma.pantryInventory.findMany({
    where: {
      lastUpdated: { lt: threshold },
      status: { not: 'depleted' },
    },
    include: { ingredient: true },
    take: 5,
  })

  if (items.length === 0) {
    return ctx.reply('Your pantry info is up to date! ✅')
  }

  const item = items[0]
  return ctx.reply(
    `Do you still have *${item.ingredient.name}*?`,
    {
      parse_mode: 'Markdown',
      ...Markup.inlineKeyboard([
        [
          Markup.button.callback('✅ Yes, stocked', `checkin_${item.id}_stocked`),
          Markup.button.callback('⚠️ Running low', `checkin_${item.id}_running_low`),
          Markup.button.callback('❌ Out', `checkin_${item.id}_depleted`),
        ],
      ]),
    }
  )
})

// Handle check-in responses
bot.action(/^checkin_(.+)_(stocked|running_low|depleted)$/, async (ctx) => {
  const itemId = ctx.match[1]
  const status = ctx.match[2] as 'stocked' | 'running_low' | 'depleted'

  await prisma.pantryInventory.update({
    where: { id: itemId },
    data: {
      status,
      source: 'user_checkin',
    },
  })

  await ctx.answerCbQuery('Updated!')

  // Check if more items need check-in
  const threshold = new Date()
  threshold.setDate(threshold.getDate() - 7)

  const moreItems = await prisma.pantryInventory.findMany({
    where: {
      lastUpdated: { lt: threshold },
      status: { not: 'depleted' },
      id: { not: itemId },
    },
    include: { ingredient: true },
    take: 1,
  })

  if (moreItems.length > 0) {
    const item = moreItems[0]
    await ctx.editMessageText(
      `Do you still have *${item.ingredient.name}*?`,
      {
        parse_mode: 'Markdown',
        ...Markup.inlineKeyboard([
          [
            Markup.button.callback('✅ Yes', `checkin_${item.id}_stocked`),
            Markup.button.callback('⚠️ Low', `checkin_${item.id}_running_low`),
            Markup.button.callback('❌ Out', `checkin_${item.id}_depleted`),
          ],
        ]),
      }
    )
  } else {
    await ctx.editMessageText('All done! Your pantry is up to date. ✅')
  }
})

// Mark recipe as cooked by name
bot.command('cooked', async (ctx) => {
  const recipeName = ctx.message.text.replace('/cooked', '').trim()

  if (!recipeName) {
    // Show list of today's planned meals
    const today = new Date()
    today.setHours(0, 0, 0, 0)
    const tomorrow = new Date(today)
    tomorrow.setDate(tomorrow.getDate() + 1)

    const todaysMeals = await prisma.mealPlan.findMany({
      where: {
        plannedDate: {
          gte: today,
          lt: tomorrow,
        },
        status: 'planned',
      },
      include: { recipe: true },
    })

    if (todaysMeals.length === 0) {
      return ctx.reply('No meals planned for today. Use /cooked <recipe name> to mark any recipe as cooked.')
    }

    const buttons = todaysMeals.map(meal => [
      Markup.button.callback(
        `${meal.recipe?.name || 'Unknown'}`,
        `markcooked_${meal.id}`
      ),
    ])

    return ctx.reply(
      'Which meal did you cook?',
      Markup.inlineKeyboard(buttons)
    )
  }

  // Find recipe by name
  const recipe = await prisma.recipe.findFirst({
    where: {
      name: { contains: recipeName, mode: 'insensitive' },
      approvalStatus: 'approved',
    },
  })

  if (!recipe) {
    return ctx.reply(`Couldn't find a recipe matching "${recipeName}". Try a different name or use the web app.`)
  }

  // Mark as cooked
  await prisma.cookingHistory.create({
    data: {
      recipeId: recipe.id,
      cookedDate: new Date(),
      servingsMade: recipe.servings,
      isBatchCook: false,
      intendedMealCount: 1,
    },
  })

  await prisma.recipe.update({
    where: { id: recipe.id },
    data: {
      timesCooked: { increment: 1 },
      lastCookedDate: new Date(),
    },
  })

  return ctx.reply(`Marked *${recipe.name}* as cooked! 🍳\n\nHow was it?`, {
    parse_mode: 'Markdown',
    ...Markup.inlineKeyboard([
      [
        Markup.button.callback('👍', `feedback_${recipe.id}_thumbs_up`),
        Markup.button.callback('👎', `feedback_${recipe.id}_thumbs_down`),
        Markup.button.callback('😐', `feedback_${recipe.id}_neutral`),
      ],
    ]),
  })
})

// Handle marking meal plan as cooked
bot.action(/^markcooked_(.+)$/, async (ctx) => {
  const mealPlanId = ctx.match[1]

  const mealPlan = await prisma.mealPlan.findUnique({
    where: { id: mealPlanId },
    include: { recipe: true },
  })

  if (!mealPlan) {
    return ctx.answerCbQuery('Meal not found')
  }

  // Create cooking history
  const cookingHistory = await prisma.cookingHistory.create({
    data: {
      recipeId: mealPlan.recipeId,
      cookedDate: mealPlan.plannedDate,
      servingsMade: mealPlan.servingsPlanned,
      isBatchCook: false,
      intendedMealCount: 1,
    },
  })

  // Update meal plan
  await prisma.mealPlan.update({
    where: { id: mealPlanId },
    data: {
      status: 'cooked',
      parentCookingEventId: cookingHistory.id,
    },
  })

  // Update recipe stats
  await prisma.recipe.update({
    where: { id: mealPlan.recipeId },
    data: {
      timesCooked: { increment: 1 },
      lastCookedDate: mealPlan.plannedDate,
    },
  })

  await ctx.answerCbQuery('Marked as cooked!')
  await ctx.editMessageText(
    `Marked *${mealPlan.recipe?.name}* as cooked! 🍳`,
    { parse_mode: 'Markdown' }
  )
})

// Token callback handler for inline keyboards generated by the order flow
bot.action(/^ggtok:(.+)$/, async (ctx) => {
  const token = (ctx.match as any)[1]
  return handleTelegramTokenCallback(ctx as any, prisma, token)
})

// Conversational handler (optional): routes free-form text through the Shopping Assistant
bot.on('text', async (ctx, next) => {
  if (!envFlag('ENABLE_SHOPPING_ASSISTANT_TELEGRAM', false)) {
    return next()
  }

  const text = (ctx.message as any)?.text?.trim?.() as string | undefined
  if (!text) return next()
  if (text.startsWith('/')) return next()

  // Simple deterministic shortcuts
  const lower = text.toLowerCase()
  if (lower === 'shopping') return ctx.reply('/shopping')
  if (lower === 'pantry') return ctx.reply('/pantry')
  if (lower === 'meals') return ctx.reply('/meals')
  if (lower === 'help') return ctx.reply('/help')

  try {
    const res = await handleAssistantMessage(prisma, {
      channel: 'telegram',
      externalId: String(ctx.chat.id),
      message: text,
    })
    if ((res as any)?.ok && (res as any)?.response) {
      // If the assistant requested an ordering UI action, render it as Telegram keyboards.
      const actions = (res as any).actions || []
      const orderAction = actions.find((a: any) => a?.type === 'telegram_order_prepare')
      if (orderAction?.prepared?.ok) {
        await ctx.reply((res as any).response)
        return startTelegramOcadoOrder(ctx as any, prisma, orderAction.prepared.shoppingListId)
      }
      return ctx.reply((res as any).response)
    }
    return ctx.reply((res as any)?.message || 'Assistant is not available right now.')
  } catch (err: any) {
    console.error('Assistant error:', err)
    return ctx.reply(err?.message || 'Assistant failed. Check server logs.')
  }
})

// Error handler
bot.catch((err, ctx) => {
  console.error('Bot error:', err)
  ctx.reply('Oops! Something went wrong. Please try again.')
})

// Launch bot
async function startBot() {
  console.log('Starting Telegram bot...')

  // Use long polling in development
  if (process.env.NODE_ENV === 'production' && process.env.WEBHOOK_URL) {
    await bot.launch({
      webhook: {
        domain: process.env.WEBHOOK_URL,
        port: parseInt(process.env.WEBHOOK_PORT || '3002', 10),
      },
    })
    console.log('Bot started with webhook')
  } else {
    await bot.launch()
    console.log('Bot started with long polling')
  }
}

// Graceful shutdown
process.once('SIGINT', () => bot.stop('SIGINT'))
process.once('SIGTERM', () => bot.stop('SIGTERM'))

startBot().catch(console.error)

export { bot }
