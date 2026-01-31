import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

async function main() {
  console.log('Seeding database...')

  // Create ingredients
  const ingredients = await Promise.all([
    // Proteins
    prisma.ingredient.upsert({
      where: { name: 'chicken breast' },
      update: {},
      create: {
        name: 'chicken breast',
        category: 'meat',
        typicalUnit: 'g',
        estimatedCaloriesPerUnit: 1.65,
        estimatedCostPerUnit: 0.008,
      },
    }),
    prisma.ingredient.upsert({
      where: { name: 'ground beef' },
      update: {},
      create: {
        name: 'ground beef',
        category: 'meat',
        typicalUnit: 'g',
        estimatedCaloriesPerUnit: 2.5,
        estimatedCostPerUnit: 0.012,
      },
    }),
    prisma.ingredient.upsert({
      where: { name: 'salmon fillet' },
      update: {},
      create: {
        name: 'salmon fillet',
        category: 'meat',
        typicalUnit: 'g',
        estimatedCaloriesPerUnit: 2.08,
        estimatedCostPerUnit: 0.025,
      },
    }),
    prisma.ingredient.upsert({
      where: { name: 'eggs' },
      update: {},
      create: {
        name: 'eggs',
        category: 'dairy',
        typicalUnit: 'piece',
        estimatedCaloriesPerUnit: 70,
        estimatedCostPerUnit: 0.30,
      },
    }),

    // Dairy
    prisma.ingredient.upsert({
      where: { name: 'butter' },
      update: {},
      create: {
        name: 'butter',
        category: 'dairy',
        typicalUnit: 'tbsp',
        estimatedCaloriesPerUnit: 100,
        estimatedCostPerUnit: 0.15,
      },
    }),
    prisma.ingredient.upsert({
      where: { name: 'milk' },
      update: {},
      create: {
        name: 'milk',
        category: 'dairy',
        typicalUnit: 'ml',
        estimatedCaloriesPerUnit: 0.42,
        estimatedCostPerUnit: 0.001,
      },
    }),
    prisma.ingredient.upsert({
      where: { name: 'parmesan cheese' },
      update: {},
      create: {
        name: 'parmesan cheese',
        category: 'dairy',
        typicalUnit: 'g',
        estimatedCaloriesPerUnit: 4.31,
        estimatedCostPerUnit: 0.02,
      },
    }),

    // Produce
    prisma.ingredient.upsert({
      where: { name: 'onion' },
      update: {},
      create: {
        name: 'onion',
        category: 'produce',
        typicalUnit: 'piece',
        estimatedCaloriesPerUnit: 44,
        estimatedCostPerUnit: 0.30,
      },
    }),
    prisma.ingredient.upsert({
      where: { name: 'garlic' },
      update: {},
      create: {
        name: 'garlic',
        category: 'produce',
        typicalUnit: 'clove',
        estimatedCaloriesPerUnit: 4,
        estimatedCostPerUnit: 0.10,
      },
    }),
    prisma.ingredient.upsert({
      where: { name: 'tomatoes' },
      update: {},
      create: {
        name: 'tomatoes',
        category: 'produce',
        typicalUnit: 'piece',
        estimatedCaloriesPerUnit: 22,
        estimatedCostPerUnit: 0.40,
      },
    }),
    prisma.ingredient.upsert({
      where: { name: 'spinach' },
      update: {},
      create: {
        name: 'spinach',
        category: 'produce',
        typicalUnit: 'g',
        estimatedCaloriesPerUnit: 0.23,
        estimatedCostPerUnit: 0.015,
      },
    }),
    prisma.ingredient.upsert({
      where: { name: 'lemon' },
      update: {},
      create: {
        name: 'lemon',
        category: 'produce',
        typicalUnit: 'piece',
        estimatedCaloriesPerUnit: 17,
        estimatedCostPerUnit: 0.35,
      },
    }),
    prisma.ingredient.upsert({
      where: { name: 'broccoli' },
      update: {},
      create: {
        name: 'broccoli',
        category: 'produce',
        typicalUnit: 'g',
        estimatedCaloriesPerUnit: 0.34,
        estimatedCostPerUnit: 0.005,
      },
    }),

    // Pantry staples
    prisma.ingredient.upsert({
      where: { name: 'olive oil' },
      update: {},
      create: {
        name: 'olive oil',
        category: 'staple',
        typicalUnit: 'tbsp',
        estimatedCaloriesPerUnit: 120,
        estimatedCostPerUnit: 0.10,
      },
    }),
    prisma.ingredient.upsert({
      where: { name: 'salt' },
      update: {},
      create: {
        name: 'salt',
        category: 'staple',
        typicalUnit: 'tsp',
        estimatedCaloriesPerUnit: 0,
        estimatedCostPerUnit: 0.01,
      },
    }),
    prisma.ingredient.upsert({
      where: { name: 'black pepper' },
      update: {},
      create: {
        name: 'black pepper',
        category: 'staple',
        typicalUnit: 'tsp',
        estimatedCaloriesPerUnit: 6,
        estimatedCostPerUnit: 0.05,
      },
    }),
    prisma.ingredient.upsert({
      where: { name: 'soy sauce' },
      update: {},
      create: {
        name: 'soy sauce',
        category: 'staple',
        typicalUnit: 'tbsp',
        estimatedCaloriesPerUnit: 8,
        estimatedCostPerUnit: 0.08,
      },
    }),

    // Pantry
    prisma.ingredient.upsert({
      where: { name: 'pasta' },
      update: {},
      create: {
        name: 'pasta',
        category: 'pantry',
        typicalUnit: 'g',
        estimatedCaloriesPerUnit: 1.31,
        estimatedCostPerUnit: 0.003,
      },
    }),
    prisma.ingredient.upsert({
      where: { name: 'rice' },
      update: {},
      create: {
        name: 'rice',
        category: 'pantry',
        typicalUnit: 'g',
        estimatedCaloriesPerUnit: 1.30,
        estimatedCostPerUnit: 0.002,
      },
    }),
    prisma.ingredient.upsert({
      where: { name: 'canned tomatoes' },
      update: {},
      create: {
        name: 'canned tomatoes',
        category: 'pantry',
        typicalUnit: 'g',
        estimatedCaloriesPerUnit: 0.18,
        estimatedCostPerUnit: 0.003,
      },
    }),
    prisma.ingredient.upsert({
      where: { name: 'chicken stock' },
      update: {},
      create: {
        name: 'chicken stock',
        category: 'pantry',
        typicalUnit: 'ml',
        estimatedCaloriesPerUnit: 0.05,
        estimatedCostPerUnit: 0.002,
      },
    }),
  ])

  console.log(`Created ${ingredients.length} ingredients`)

  // Create sample recipes
  const chickenStirFry = await prisma.recipe.create({
    data: {
      name: 'Quick Chicken Stir Fry',
      description: 'A fast and healthy weeknight dinner with chicken and vegetables',
      servings: 4,
      cookTimeMinutes: 15,
      prepTimeMinutes: 10,
      totalTimeMinutes: 25,
      mealType: 'dinner',
      cookingStyle: 'quick_weeknight',
      estimatedCaloriesPerServing: 350,
      estimatedCostPerServing: 3.50,
      approvalStatus: 'approved',
      recipeIngredients: {
        create: [
          { ingredientId: ingredients[0].id, quantity: 500, unit: 'g' },
          { ingredientId: ingredients[7].id, quantity: 1, unit: 'piece' },
          { ingredientId: ingredients[8].id, quantity: 3, unit: 'clove' },
          { ingredientId: ingredients[12].id, quantity: 200, unit: 'g' },
          { ingredientId: ingredients[16].id, quantity: 2, unit: 'tbsp' },
          { ingredientId: ingredients[13].id, quantity: 1, unit: 'tbsp' },
        ],
      },
      recipeInstructions: {
        create: [
          { stepNumber: 1, instructionText: 'Cut chicken breast into thin strips and season with salt and pepper.' },
          { stepNumber: 2, instructionText: 'Heat olive oil in a large wok or skillet over high heat.' },
          { stepNumber: 3, instructionText: 'Add chicken and stir fry for 5-6 minutes until golden and cooked through. Remove and set aside.' },
          { stepNumber: 4, instructionText: 'Add onion and garlic to the pan and stir fry for 2 minutes.' },
          { stepNumber: 5, instructionText: 'Add broccoli and cook for 3 minutes until tender-crisp.' },
          { stepNumber: 6, instructionText: 'Return chicken to the pan, add soy sauce, toss to combine and serve.' },
        ],
      },
    },
  })

  const spaghettiSauce = await prisma.recipe.create({
    data: {
      name: 'Classic Spaghetti with Meat Sauce',
      description: 'A hearty Italian classic perfect for batch cooking',
      servings: 6,
      cookTimeMinutes: 45,
      prepTimeMinutes: 15,
      totalTimeMinutes: 60,
      mealType: 'dinner',
      cookingStyle: 'batch_cook',
      estimatedCaloriesPerServing: 520,
      estimatedCostPerServing: 2.80,
      approvalStatus: 'approved',
      recipeIngredients: {
        create: [
          { ingredientId: ingredients[1].id, quantity: 500, unit: 'g' },
          { ingredientId: ingredients[17].id, quantity: 400, unit: 'g' },
          { ingredientId: ingredients[7].id, quantity: 1, unit: 'piece' },
          { ingredientId: ingredients[8].id, quantity: 4, unit: 'clove' },
          { ingredientId: ingredients[19].id, quantity: 400, unit: 'g' },
          { ingredientId: ingredients[6].id, quantity: 50, unit: 'g' },
          { ingredientId: ingredients[13].id, quantity: 2, unit: 'tbsp' },
        ],
      },
      recipeInstructions: {
        create: [
          { stepNumber: 1, instructionText: 'Heat olive oil in a large pot over medium heat.' },
          { stepNumber: 2, instructionText: 'Add onion and garlic, cook until softened.' },
          { stepNumber: 3, instructionText: 'Add ground beef and cook until browned, breaking it up as it cooks.' },
          { stepNumber: 4, instructionText: 'Add canned tomatoes, season with salt and pepper. Simmer for 30 minutes.' },
          { stepNumber: 5, instructionText: 'Cook pasta according to package directions, drain.' },
          { stepNumber: 6, instructionText: 'Serve sauce over pasta, topped with parmesan cheese.' },
        ],
      },
    },
  })

  const salmonDinner = await prisma.recipe.create({
    data: {
      name: 'Pan-Seared Salmon with Lemon',
      description: 'Elegant but simple salmon dinner ready in 20 minutes',
      servings: 2,
      cookTimeMinutes: 12,
      prepTimeMinutes: 5,
      totalTimeMinutes: 17,
      mealType: 'dinner',
      cookingStyle: 'quick_weeknight',
      estimatedCaloriesPerServing: 380,
      estimatedCostPerServing: 8.50,
      approvalStatus: 'approved',
      recipeIngredients: {
        create: [
          { ingredientId: ingredients[2].id, quantity: 300, unit: 'g' },
          { ingredientId: ingredients[11].id, quantity: 1, unit: 'piece' },
          { ingredientId: ingredients[4].id, quantity: 2, unit: 'tbsp' },
          { ingredientId: ingredients[10].id, quantity: 100, unit: 'g' },
          { ingredientId: ingredients[14].id, quantity: 0.5, unit: 'tsp' },
          { ingredientId: ingredients[15].id, quantity: 0.25, unit: 'tsp' },
        ],
      },
      recipeInstructions: {
        create: [
          { stepNumber: 1, instructionText: 'Pat salmon fillets dry and season with salt and pepper.' },
          { stepNumber: 2, instructionText: 'Heat butter in a skillet over medium-high heat.' },
          { stepNumber: 3, instructionText: 'Place salmon skin-side up and cook for 4 minutes until golden.' },
          { stepNumber: 4, instructionText: 'Flip and cook for another 3-4 minutes.' },
          { stepNumber: 5, instructionText: 'Squeeze lemon juice over the salmon.' },
          { stepNumber: 6, instructionText: 'Serve with sauteed spinach on the side.' },
        ],
      },
    },
  })

  const scrambledEggs = await prisma.recipe.create({
    data: {
      name: 'Fluffy Scrambled Eggs',
      description: 'Perfect creamy scrambled eggs for breakfast',
      servings: 2,
      cookTimeMinutes: 5,
      prepTimeMinutes: 2,
      totalTimeMinutes: 7,
      mealType: 'breakfast',
      cookingStyle: 'quick_weeknight',
      estimatedCaloriesPerServing: 220,
      estimatedCostPerServing: 1.20,
      approvalStatus: 'approved',
      recipeIngredients: {
        create: [
          { ingredientId: ingredients[3].id, quantity: 4, unit: 'piece' },
          { ingredientId: ingredients[4].id, quantity: 1, unit: 'tbsp' },
          { ingredientId: ingredients[5].id, quantity: 30, unit: 'ml' },
          { ingredientId: ingredients[14].id, quantity: 0.25, unit: 'tsp' },
          { ingredientId: ingredients[15].id, quantity: 0.1, unit: 'tsp' },
        ],
      },
      recipeInstructions: {
        create: [
          { stepNumber: 1, instructionText: 'Crack eggs into a bowl, add milk, salt and pepper. Whisk until combined.' },
          { stepNumber: 2, instructionText: 'Melt butter in a non-stick pan over low heat.' },
          { stepNumber: 3, instructionText: 'Pour in eggs and let sit for 20 seconds.' },
          { stepNumber: 4, instructionText: 'Gently push eggs from edges to center, forming soft curds.' },
          { stepNumber: 5, instructionText: 'Remove from heat while still slightly wet - they will continue cooking.' },
        ],
      },
    },
  })

  // Create a pending recipe for discover
  await prisma.recipe.create({
    data: {
      name: 'Mediterranean Chicken Bowl',
      description: 'Healthy grain bowl with grilled chicken, hummus, and fresh vegetables',
      servings: 2,
      cookTimeMinutes: 20,
      prepTimeMinutes: 15,
      totalTimeMinutes: 35,
      mealType: 'lunch',
      cookingStyle: 'quick_weeknight',
      estimatedCaloriesPerServing: 450,
      estimatedCostPerServing: 5.00,
      approvalStatus: 'pending',
    },
  })

  await prisma.recipe.create({
    data: {
      name: 'Thai Green Curry',
      description: 'Aromatic coconut curry with vegetables and your choice of protein',
      servings: 4,
      cookTimeMinutes: 25,
      prepTimeMinutes: 15,
      totalTimeMinutes: 40,
      mealType: 'dinner',
      cookingStyle: 'batch_cook',
      estimatedCaloriesPerServing: 480,
      estimatedCostPerServing: 4.50,
      approvalStatus: 'pending',
    },
  })

  console.log('Created sample recipes')

  // Create user preferences
  await prisma.userPreferences.upsert({
    where: { id: 'default-user' },
    update: {},
    create: {
      id: 'default-user',
      budgetTargetWeekly: 100,
      calorieTargetDaily: 2000,
      preferredCuisines: ['Italian', 'Asian', 'Mediterranean'],
      dietaryRestrictions: [],
      dislikedIngredients: [],
      priorityWeights: {
        variety: 0.15,
        expiration: 0.20,
        pantry: 0.15,
        budget: 0.15,
        calorie: 0.10,
        time: 0.15,
        rating: 0.10,
      },
      defaultShoppingDay: 'saturday',
    },
  })

  console.log('Created user preferences')

  // Add some pantry items
  await prisma.pantryInventory.create({
    data: {
      ingredientId: ingredients[13].id, // olive oil
      quantity: 500,
      unit: 'ml',
      acquiredDate: new Date(),
      status: 'stocked',
      source: 'manual_entry',
    },
  })

  await prisma.pantryInventory.create({
    data: {
      ingredientId: ingredients[14].id, // salt
      quantity: 1,
      unit: 'container',
      acquiredDate: new Date(),
      status: 'stocked',
      source: 'manual_entry',
    },
  })

  await prisma.pantryInventory.create({
    data: {
      ingredientId: ingredients[17].id, // pasta
      quantity: 500,
      unit: 'g',
      acquiredDate: new Date(),
      status: 'stocked',
      source: 'manual_entry',
    },
  })

  await prisma.pantryInventory.create({
    data: {
      ingredientId: ingredients[18].id, // rice
      quantity: 1000,
      unit: 'g',
      acquiredDate: new Date(),
      status: 'stocked',
      source: 'manual_entry',
    },
  })

  // Add an expiring item
  const threeDaysFromNow = new Date()
  threeDaysFromNow.setDate(threeDaysFromNow.getDate() + 3)

  await prisma.pantryInventory.create({
    data: {
      ingredientId: ingredients[0].id, // chicken
      quantity: 400,
      unit: 'g',
      acquiredDate: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000),
      expirationDate: threeDaysFromNow,
      status: 'stocked',
      source: 'grocery_trip',
    },
  })

  console.log('Created pantry items')

  console.log('Seeding completed!')
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
