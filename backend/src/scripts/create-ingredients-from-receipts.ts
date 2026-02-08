import { PrismaClient, type IngredientCategory } from '@prisma/client'
import { fileURLToPath } from 'node:url'

type CreateIngredientsFromReceiptsResult = {
  totalReceipts: number
  totalUniqueItems: number
  created: number
  existed: number
  skipped: number
  dryRun: boolean
}

interface ParsedItem {
  name: string
  quantity: number
  unit: string
  price: number
}

interface AggregatedItem {
  name: string
  normalizedName: string
  totalQuantity: number
  avgPrice: number
  frequency: number
  units: string[]
  category: IngredientCategory | 'non-food'
}

// Valid categories: staple, perishable, pantry, produce, meat, dairy, frozen
function categorizeItem(name: string): IngredientCategory | 'non-food' {
  const lower = name.toLowerCase()

  // Skip non-food items
  if (lower.includes('toilet') || lower.includes('tissue') ||
      lower.includes('washing') || lower.includes('laundry') ||
      lower.includes('kalanchoe') || lower.includes('dog ')) {
    return 'non-food'
  }

  // Skip snacks (not useful for meal planning)
  if (lower.includes('chocolate') || lower.includes('popcorn') ||
      lower.includes('crisp') || lower.includes('snack') ||
      lower.includes('biscuit') || lower.includes('sweet') ||
      lower.includes('candy') || lower.includes('kinder') ||
      lower.includes('cordial') || lower.includes('hydration') ||
      lower.includes('wine') || lower.includes('beer') ||
      lower.includes('cider')) {
    return 'non-food'
  }

  // Meat & Fish
  if (lower.includes('chicken') || lower.includes('beef') ||
      lower.includes('pork') || lower.includes('bacon') ||
      lower.includes('salmon') || lower.includes('fish') ||
      lower.includes('ham') || lower.includes('mince')) {
    return 'meat'
  }

  // Dairy
  if (lower.includes('milk') || lower.includes('cream') ||
      lower.includes('cheese') || lower.includes('butter') ||
      lower.includes('yogurt') || lower.includes('yoghurt') ||
      lower.includes('eggs')) {
    return 'dairy'
  }

  // Produce (vegetables)
  if (lower.includes('carrot') || lower.includes('potato') ||
      lower.includes('onion') || lower.includes('tomato') ||
      lower.includes('lettuce') || lower.includes('spinach') ||
      lower.includes('kale') || lower.includes('celery') ||
      lower.includes('mushroom') || lower.includes('pepper') ||
      lower.includes('cauliflower') || lower.includes('broccoli') ||
      lower.includes('greens') || lower.includes('leek') ||
      lower.includes('chive') || lower.includes('garlic') ||
      lower.includes('cabbage') || lower.includes('courgette') ||
      lower.includes('aubergine') || lower.includes('asparagus')) {
    return 'produce'
  }

  // Produce (fruits)
  if (lower.includes('apple') || lower.includes('banana') ||
      lower.includes('orange') || lower.includes('lemon') ||
      lower.includes('kiwi') || lower.includes('avocado') ||
      lower.includes('berry') || lower.includes('mango') ||
      lower.includes('pear') || lower.includes('grape')) {
    return 'produce'
  }

  // Pantry staples
  if (lower.includes('rice') || lower.includes('pasta') ||
      lower.includes('oil') || lower.includes('vinegar') ||
      lower.includes('sauce') || lower.includes('seasoning') ||
      lower.includes('spice') || lower.includes('salt') ||
      lower.includes('lentil') || lower.includes('bean') ||
      lower.includes('flour') || lower.includes('sugar') ||
      lower.includes('stock') || lower.includes('broth') ||
      lower.includes('soy') || lower.includes('wasabi') ||
      lower.includes('almond') || lower.includes('walnut') ||
      lower.includes('nut')) {
    return 'pantry'
  }

  // Perishable (baked goods, prepared foods)
  if (lower.includes('bread') || lower.includes('bagel') ||
      lower.includes('roll') || lower.includes('pastry') ||
      lower.includes('croissant') || lower.includes('ciabatta') ||
      lower.includes('ramen') || lower.includes('ravioli') ||
      lower.includes('soup') || lower.includes('houmous') ||
      lower.includes('hummus') || lower.includes('dip') ||
      lower.includes('spread') || lower.includes('juice') ||
      lower.includes('soda') || lower.includes('water')) {
    return 'perishable'
  }

  // Default to staple for anything else food-related
  return 'staple'
}

// Normalize ingredient name for database
function normalizeName(name: string): string {
  return name
    .replace(/^tesco\s+(finest\s+)?/i, '')
    .replace(/^organic\s+/i, '')
    .replace(/^british\s+/i, '')
    .replace(/\d+\s*(g|ml|kg|l|cl|pack|x)\b/gi, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()
}

// Extract primary unit from various formats
function extractUnit(unit: string, name: string): string {
  if (unit && unit !== '') {
    // Extract just the unit type
    const match = unit.match(/(g|kg|ml|l|pack|piece|bunch)/i)
    if (match) return match[1].toLowerCase()
  }

  // Try to infer from name
  const nameMatch = name.match(/(\d+)\s*(g|kg|ml|l)\b/i)
  if (nameMatch) return nameMatch[2].toLowerCase()

  return 'piece'
}

export async function createIngredientsFromReceipts({ apply }: { apply: boolean }): Promise<CreateIngredientsFromReceiptsResult> {
  const prisma = new PrismaClient()
  const dryRun = !apply
  console.log('Fetching receipt data...\n')

  // Get all receipts with parsed items
  const receipts = await prisma.groceryReceipt.findMany({
    select: {
      parsedItems: true,
      purchaseDate: true,
    }
  })

  // Aggregate items across all receipts
  const itemMap = new Map<string, AggregatedItem>()

  for (const receipt of receipts) {
    const items = (receipt.parsedItems as unknown as ParsedItem[] | null) || []

    for (const item of items) {
      const normalized = normalizeName(item.name)
      const category = categorizeItem(item.name)

      if (itemMap.has(normalized)) {
        const existing = itemMap.get(normalized)!
        existing.frequency++
        existing.totalQuantity += item.quantity
        existing.avgPrice = (existing.avgPrice * (existing.frequency - 1) + item.price) / existing.frequency
        if (item.unit && !existing.units.includes(item.unit)) {
          existing.units.push(item.unit)
        }
      } else {
        itemMap.set(normalized, {
          name: item.name,
          normalizedName: normalized,
          totalQuantity: item.quantity,
          avgPrice: item.price,
          frequency: 1,
          units: item.unit ? [item.unit] : [],
          category,
        })
      }
    }
  }

  // Sort by frequency
  const sortedItems = Array.from(itemMap.values())
    .sort((a, b) => b.frequency - a.frequency)

  console.log(`Found ${sortedItems.length} unique items across ${receipts.length} receipts\n`)

  // Create ingredients (skip non-food)
  let created = 0
  let skipped = 0
  let existed = 0

  const foodCategories: IngredientCategory[] = ['meat', 'dairy', 'produce', 'pantry', 'perishable', 'staple', 'frozen']

  for (const item of sortedItems) {
    if (item.category === 'non-food') {
      skipped++
      continue
    }

    // Check if ingredient already exists
    const existing = await prisma.ingredient.findFirst({
      where: {
        OR: [
          { name: item.normalizedName },
          { name: { contains: item.normalizedName.split(' ')[0] } }
        ]
      }
    })

    if (existing) {
      // Update cost estimate if we have price data
      if (item.avgPrice > 0 && !dryRun) {
        await prisma.ingredient.update({
          where: { id: existing.id },
          data: {
            estimatedCostPerUnit: item.avgPrice,
          }
        })
      }
      existed++
      continue
    }

    // Create new ingredient
    const unit = extractUnit(item.units[0] || '', item.name)

    if (!dryRun) {
      await prisma.ingredient.create({
        data: {
          name: item.normalizedName,
          category: item.category as IngredientCategory,
          typicalUnit: unit,
          estimatedCostPerUnit: item.avgPrice > 0 ? item.avgPrice : null,
        }
      })
    }

    created++
    console.log(`✓ Created: ${item.normalizedName} (${item.category}) - £${item.avgPrice.toFixed(2)} - bought ${item.frequency}x`)
  }

  console.log(`\n--- Summary ---`)
  console.log(`Created: ${created} ingredients`)
  console.log(`Already existed: ${existed}`)
  console.log(`Skipped (non-food): ${skipped}`)

  // Show frequency stats for created items
  console.log(`\n--- Most Frequent Purchases ---`)
  const frequent = sortedItems
    .filter(i => i.category !== 'non-food')
    .slice(0, 20)

  for (const item of frequent) {
    console.log(`  ${item.frequency}x ${item.normalizedName} (£${item.avgPrice.toFixed(2)} avg)`)
  }

  if (dryRun) {
    console.log('\nDry run only - no writes performed.')
  }

  await prisma.$disconnect()
  return {
    totalReceipts: receipts.length,
    totalUniqueItems: sortedItems.length,
    created,
    existed,
    skipped,
    dryRun,
  }
}

const isDirectRun = process.argv[1] === fileURLToPath(import.meta.url)

if (isDirectRun) {
  const apply = process.argv.includes('--apply')
  createIngredientsFromReceipts({ apply })
    .catch(console.error)
}
