import { describe, it, expect } from 'vitest'

// Test the shopping list generation logic (algorithm from spec)
describe('Shopping List Generation Algorithm', () => {
  // Helper to simulate the algorithm
  function generateShoppingListItems(
    mealPlans: Array<{
      recipe: {
        servings: number
        ingredients: Array<{
          ingredientId: string
          quantity: number
          unit: string
          ingredient: { id: string; name: string; category: string }
        }>
      }
      servingsPlanned: number
    }>,
    pantryItems: Array<{
      ingredientId: string
      quantity: number
      status: 'stocked' | 'running_low' | 'depleted'
    }>,
    stapleCategories = ['staple'],
    perishableCategories = ['perishable', 'produce', 'meat', 'dairy']
  ) {
    const ingredientsNeeded = new Map<
      string,
      { quantity: number; unit: string; ingredient: any; recipeIds: string[] }
    >()

    // Aggregate ingredients
    for (const mealPlan of mealPlans) {
      const multiplier = mealPlan.servingsPlanned / mealPlan.recipe.servings

      for (const ri of mealPlan.recipe.ingredients) {
        const scaledQty = ri.quantity * multiplier
        const existing = ingredientsNeeded.get(ri.ingredientId)

        if (existing) {
          existing.quantity += scaledQty
        } else {
          ingredientsNeeded.set(ri.ingredientId, {
            quantity: scaledQty,
            unit: ri.unit,
            ingredient: ri.ingredient,
            recipeIds: [],
          })
        }
      }
    }

    // Check pantry and apply assumptions
    const pantryMap = new Map(pantryItems.map(p => [p.ingredientId, p]))
    const items: Array<{
      ingredientId: string
      quantity: number
      unit: string
      assumedHave: boolean
      ingredient: any
    }> = []

    for (const [ingredientId, data] of ingredientsNeeded) {
      const pantryItem = pantryMap.get(ingredientId)
      let neededQuantity = data.quantity

      // Deduct pantry quantity
      if (pantryItem && pantryItem.status !== 'depleted') {
        neededQuantity -= pantryItem.quantity
        if (neededQuantity < 0) neededQuantity = 0
      }

      // Apply intelligent assumption
      let assumedHave = false
      if (stapleCategories.includes(data.ingredient.category)) {
        assumedHave = true
      } else if (perishableCategories.includes(data.ingredient.category)) {
        assumedHave = false
      }

      // Override if pantry says depleted
      if (pantryItem?.status === 'depleted') {
        assumedHave = false
      }

      items.push({
        ingredientId,
        quantity: neededQuantity > 0 ? neededQuantity : data.quantity,
        unit: data.unit,
        assumedHave,
        ingredient: data.ingredient,
      })
    }

    return items
  }

  it('should aggregate ingredients from multiple recipes', () => {
    const mealPlans = [
      {
        recipe: {
          servings: 4,
          ingredients: [
            { ingredientId: 'flour', quantity: 200, unit: 'g', ingredient: { id: 'flour', name: 'flour', category: 'pantry' } },
            { ingredientId: 'eggs', quantity: 2, unit: 'piece', ingredient: { id: 'eggs', name: 'eggs', category: 'dairy' } },
          ],
        },
        servingsPlanned: 4,
      },
      {
        recipe: {
          servings: 2,
          ingredients: [
            { ingredientId: 'flour', quantity: 100, unit: 'g', ingredient: { id: 'flour', name: 'flour', category: 'pantry' } },
          ],
        },
        servingsPlanned: 2,
      },
    ]

    const items = generateShoppingListItems(mealPlans, [])

    const flour = items.find(i => i.ingredientId === 'flour')
    expect(flour?.quantity).toBe(300) // 200 + 100
  })

  it('should scale ingredients based on servings', () => {
    const mealPlans = [
      {
        recipe: {
          servings: 4,
          ingredients: [
            { ingredientId: 'chicken', quantity: 500, unit: 'g', ingredient: { id: 'chicken', name: 'chicken', category: 'meat' } },
          ],
        },
        servingsPlanned: 8, // Double the recipe
      },
    ]

    const items = generateShoppingListItems(mealPlans, [])

    const chicken = items.find(i => i.ingredientId === 'chicken')
    expect(chicken?.quantity).toBe(1000) // 500 * 2
  })

  it('should deduct pantry quantities', () => {
    const mealPlans = [
      {
        recipe: {
          servings: 4,
          ingredients: [
            { ingredientId: 'rice', quantity: 400, unit: 'g', ingredient: { id: 'rice', name: 'rice', category: 'pantry' } },
          ],
        },
        servingsPlanned: 4,
      },
    ]

    const pantryItems = [{ ingredientId: 'rice', quantity: 150, status: 'stocked' as const }]

    const items = generateShoppingListItems(mealPlans, pantryItems)

    const rice = items.find(i => i.ingredientId === 'rice')
    expect(rice?.quantity).toBe(250) // 400 - 150
  })

  it('should mark staples as assumed have', () => {
    const mealPlans = [
      {
        recipe: {
          servings: 4,
          ingredients: [
            { ingredientId: 'salt', quantity: 1, unit: 'tsp', ingredient: { id: 'salt', name: 'salt', category: 'staple' } },
            { ingredientId: 'chicken', quantity: 500, unit: 'g', ingredient: { id: 'chicken', name: 'chicken', category: 'meat' } },
          ],
        },
        servingsPlanned: 4,
      },
    ]

    const items = generateShoppingListItems(mealPlans, [])

    const salt = items.find(i => i.ingredientId === 'salt')
    const chicken = items.find(i => i.ingredientId === 'chicken')

    expect(salt?.assumedHave).toBe(true) // Staple
    expect(chicken?.assumedHave).toBe(false) // Perishable
  })

  it('should not assume have if pantry shows depleted', () => {
    const mealPlans = [
      {
        recipe: {
          servings: 4,
          ingredients: [
            { ingredientId: 'olive-oil', quantity: 2, unit: 'tbsp', ingredient: { id: 'olive-oil', name: 'olive oil', category: 'staple' } },
          ],
        },
        servingsPlanned: 4,
      },
    ]

    const pantryItems = [{ ingredientId: 'olive-oil', quantity: 0, status: 'depleted' as const }]

    const items = generateShoppingListItems(mealPlans, pantryItems)

    const oil = items.find(i => i.ingredientId === 'olive-oil')
    expect(oil?.assumedHave).toBe(false) // Depleted overrides staple assumption
  })

  it('should handle empty meal plans', () => {
    const items = generateShoppingListItems([], [])
    expect(items).toHaveLength(0)
  })

  it('should not go negative on pantry deduction', () => {
    const mealPlans = [
      {
        recipe: {
          servings: 4,
          ingredients: [
            { ingredientId: 'pasta', quantity: 200, unit: 'g', ingredient: { id: 'pasta', name: 'pasta', category: 'pantry' } },
          ],
        },
        servingsPlanned: 4,
      },
    ]

    const pantryItems = [{ ingredientId: 'pasta', quantity: 500, status: 'stocked' as const }] // More than needed

    const items = generateShoppingListItems(mealPlans, pantryItems)

    const pasta = items.find(i => i.ingredientId === 'pasta')
    expect(pasta?.quantity).toBe(200) // Should use original quantity, not negative
  })
})
