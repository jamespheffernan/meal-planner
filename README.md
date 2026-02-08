# Meal Planner

Smart meal planning and grocery shopping app with intelligent defaults, batch cooking support, loose pantry tracking, and AI-powered recipe discovery.

## Features

- **Recipe Discovery** - Tinder-style swipe interface to approve/reject recipes
- **Recipe Import** - Multiple methods: URL (schema.org), photos (OCR), Paprika exports, grocery receipts
- **Meal Planning** - Weekly calendar with drag-and-drop, batch cooking, and leftover planning
- **Smart Shopping Lists** - Generate from meal plans with intelligent assumptions (staples vs perishables)
- **Pantry Management** - Track inventory with expiration alerts and automatic deductions
- **Ingredient Management** - CRUD, bulk creation, brand preferences, Open Food Facts integration
- **Smart Recommendations** - AI-powered suggestions based on pantry, preferences, cooking history, and expiration
- **User Preferences** - Configure liked/disliked ingredients, dietary restrictions, budgets, calorie targets

## Tech Stack

### Backend
- **Framework**: Fastify 5 (TypeScript)
- **Database**: PostgreSQL with Prisma 6 ORM
- **Image Processing**: Sharp for image optimization, heic-convert for Apple photos
- **OCR & AI**: OpenAI GPT-4o for recipe extraction and image generation
- **CLI**: Lightweight HTTP wrapper for API calls
- **Testing**: Vitest

### Frontend
- **Framework**: Next.js 16 with React 19 (TypeScript)
- **State Management**: TanStack Query 5 (React Query)
- **Styling**: Tailwind CSS 4
- **UI Icons**: Lucide React
- **Image Handling**: react-easy-crop, heic2any for HEIC photos
- **Date**: date-fns

### Optional
- **Telegram Bot**: Telegraf (for bot commands)
- **Online Ordering (Ocado)**: Playwright automation (local-only; requires a saved Playwright `storageState` session)

## Getting Started

### Prerequisites

- Node.js 18+
- PostgreSQL 12+
- npm or pnpm
- (Optional) OpenAI API key for OCR and image generation
- (Optional) 32-byte encryption key for secure API key storage

### Installation

1. Clone the repository:
```bash
git clone https://github.com/jamespheffernan/meal-planner.git
cd meal-planner
```

2. Install dependencies:
```bash
npm install
cd backend && npm install
cd ../frontend && npm install
cd ..
```

3. Set up environment variables:

Backend (`backend/.env`):
```
# Database
DATABASE_URL="postgresql://user:password@localhost:5432/meal_planner"

# Server
PORT=3001
HOST=0.0.0.0

# AI & OCR (optional but recommended)
OPENAI_API_KEY=sk-...

# Encryption for stored API keys (optional, generates a 32-byte key)
# Generate with: node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
MEAL_PLANNER_ENCRYPTION_KEY=your_32_byte_key_in_hex_or_base64

# Telegram Bot (optional)
TELEGRAM_BOT_TOKEN=your_telegram_token

# Store integrations (optional)
ENABLE_STORE_OCADO=true
ENABLE_SHOPPING_ASSISTANT=false
ENABLE_SHOPPING_ASSISTANT_TELEGRAM=false
ORDER_PLACEMENT_ENABLED=false
```

Frontend (`frontend/.env.local`):
```
NEXT_PUBLIC_API_URL=http://localhost:3001/api
```

4. Set up the database:
```bash
cd backend
npm run db:push          # Create schema
npm run db:seed          # Optional: seed sample data
cd ..
```

5. Start development servers:
```bash
npm run dev
```

The app will be available at:
- Frontend: http://localhost:3000
- Backend API: http://localhost:3001
- Swagger UI: http://localhost:3001/documentation

## Online Ordering (Ocado)

Ocado integration uses Playwright and a saved browser session (`storageState`) stored encrypted in the database.

1. Generate a storageState file (one-time, local):
```bash
cd backend
npx playwright install chromium
npm run ocado:auth -- --out /tmp/ocado_storage_state.json
```

2. In the web app: `Settings` → `Online Ordering` → paste or upload that JSON.

3. In `Shopping`, open a list and click `Order on Ocado` to map items and add them to your Ocado cart.

6. (Optional) Run the Telegram bot:
```bash
cd backend
npm run bot
```

## Project Structure

```
meal-planner/
├── backend/
│   ├── prisma/
│   │   ├── schema.prisma        # Database schema
│   │   └── seed.ts              # Sample data seed script
│   ├── src/
│   │   ├── index.ts             # Fastify server setup
│   │   ├── bot/                 # Telegram bot commands
│   │   ├── cli/                 # CLI HTTP wrapper
│   │   ├── plugins/             # Fastify plugins (Prisma)
│   │   ├── routes/              # API route handlers
│   │   ├── services/            # Business logic & utilities
│   │   ├── scripts/             # Data pipeline scripts
│   │   └── tests/               # Unit tests
│   └── package.json
│
├── frontend/
│   ├── src/
│   │   ├── app/                 # Next.js app router pages
│   │   ├── components/          # React components
│   │   ├── lib/                 # API client, utilities, hooks
│   │   └── app/globals.css      # Global styles
│   └── package.json
│
└── package.json                 # Root monorepo config
```

## Architecture

### Data Flow

1. **Recipe Ingestion**: Multiple sources (URL scraping, photo OCR, Paprika imports, receipt parsing) → Recipe table with ingredients
2. **Discovery**: User swipes through pending recipes → Approval status change
3. **Meal Planning**: Drag recipes to weekly calendar → Create MealPlan entries
4. **Shopping**: Generate ShoppingList from selected MealPlans → Shopping list with per-item cost tracking
5. **Cooking**: Mark meals as cooked → Create CookingHistory entry, optionally deduct pantry items
6. **Recommendations**: Score approved recipes (7 dimensions) → Ranked suggestions based on pantry, preferences, expiration

### Key Services

- **RecommendationEngine** - Scores recipes on variety, expiration, pantry match, budget, calories, time, rating
- **RecipeScraper** - Extracts schema.org JSON-LD from URLs, falls back to HTML patterns
- **RecipeOCR** - Parses recipes and receipts from images using GPT-4o vision
- **PaprikaImport** - Handles ZIP, gzip, JSON formats from Paprika export
- **IngredientNormalizer** - Strips units, modifiers, quantities from ingredient names
- **SecretStore** - AES-256-GCM encryption for API keys
- **AIImage** - Generates recipe photos with DALL-E 3
- **ImageSearch** - Finds recipe images from web search results

## Database Schema

### Core Models

**Recipe**
- id, name, description, servings, cookTimeMinutes, prepTimeMinutes, totalTimeMinutes
- mealType (breakfast, lunch, dinner, snack)
- cookingStyle (quick_weeknight, batch_cook, special_occasion)
- photoUrl, estimatedCaloriesPerServing, estimatedCostPerServing
- approvalStatus (pending, approved, rejected, archived)
- timesCooked, lastCookedDate, createdAt, updatedAt
- Relations: RecipeIngredient[], RecipeInstruction[], CookingHistory[], MealPlan[]

**Ingredient**
- id, name (unique), category (staple, perishable, pantry, produce, meat, dairy, frozen)
- typicalUnit, estimatedCaloriesPerUnit, estimatedCostPerUnit, imageUrl
- Relations: Brand[], RecipeIngredient[], PantryInventory[], ShoppingListItem[]

**Brand**
- id, ingredientId, brandName, preferenceLevel (preferred, acceptable, avoid)
- notes, createdAt
- Relations: Ingredient, ShoppingListItem[]

**RecipeIngredient**
- id, recipeId, ingredientId, quantity, unit, notes, optional (boolean)
- Relations: Recipe, Ingredient

**RecipeInstruction**
- id, recipeId, stepNumber, instructionText
- Relations: Recipe

**CookingHistory**
- id, recipeId, cookedDate, servingsMade, isBatchCook, intendedMealCount
- rating (thumbs_up, thumbs_down, neutral), wouldMakeAgain, notes
- actualCost, actualTimeMinutes, createdAt
- Relations: Recipe, MealPlan[]

**MealPlan**
- id, recipeId, plannedDate, mealType, servingsPlanned
- isLeftover (boolean), parentCookingEventId (for batch cook tracking)
- status (planned, cooked, skipped), createdAt
- Relations: Recipe, CookingHistory (parent event)

**PantryInventory**
- id, ingredientId, quantity, unit, acquiredDate, expirationDate
- status (stocked, running_low, depleted)
- source (grocery_trip, manual_entry, recipe_deduction, user_checkin)
- lastUpdated, notes
- Relations: Ingredient

**ShoppingList**
- id, createdDate, shoppingDate, status (draft, ready, shopping, completed)
- totalEstimatedCost, notes, createdAt
- Relations: ShoppingListItem[]

**ShoppingListItem**
- id, shoppingListId, ingredientId, brandId, quantity, unit
- assumedHave (boolean), userOverride (need, have, null), estimatedCost, actualCost
- purchased (boolean), recipeIds (array), notes, createdAt
- Relations: ShoppingList, Ingredient, Brand

**UserPreferences**
- id, budgetTargetWeekly, calorieTargetDaily, preferredCuisines[], dietaryRestrictions[]
- dislikedIngredients[], likedIngredients[], priorityWeights (JSON), defaultShoppingDay
- updatedAt
- Relations: none (singleton pattern)

**GroceryReceipt**
- id, storeName, purchaseDate, totalAmount, receiptImageUrl, parsedItems (JSON)
- processingStatus (uploaded, parsed, matched, completed), createdAt
- Relations: none (parsed items stored as JSON)

**AppSecret**
- id, encryptedValue, createdAt, updatedAt
- Used for storing encrypted API keys (e.g., OPENAI_API_KEY)

## API Reference

### Recipes

**List Recipes**
```
GET /api/recipes?approvalStatus=approved&mealType=dinner&limit=50&offset=0
```
Response: Recipe[] with nested RecipeIngredient[] and Ingredient details

**Get Recipe**
```
GET /api/recipes/:id
```

**Create Recipe**
```
POST /api/recipes
{
  "name": "Pasta Carbonara",
  "servings": 4,
  "cookTimeMinutes": 20,
  "mealType": "dinner",
  "cookingStyle": "quick_weeknight",
  "description": "...",
  "ingredients": [
    { "ingredientId": "...", "quantity": 400, "unit": "g", "notes": "..." }
  ],
  "instructions": [
    { "stepNumber": 1, "instructionText": "..." }
  ]
}
```

**Update Recipe**
```
PUT /api/recipes/:id
{ "name": "...", "servings": 4, ... }
```

**Update Approval Status**
```
PATCH /api/recipes/:id/approval
{ "approvalStatus": "approved" }
```

**Update Photo**
```
PATCH /api/recipes/:id/photo
{ "photoUrl": "https://..." }
```

**Find Web Image**
```
POST /api/recipes/:id/find-image
{ "query": "pasta carbonara" }
```
Uses image search to find and set photoUrl

**Generate AI Image**
```
POST /api/recipes/:id/generate-image
```
Uses DALL-E 3 to generate and set photoUrl

**Discover (Swipe)**
```
GET /api/recipes/discover?limit=20
```
Returns pending recipes for approval/rejection

**Delete Recipe**
```
DELETE /api/recipes/:id
```

### Recipe Import

**Import from URL**
```
POST /api/import/url
{ "url": "https://example.com/recipe", "autoApprove": false }
```
Scrapes schema.org JSON-LD or HTML patterns

**Import from Image (Preview)**
```
POST /api/import/image
{
  "imageBase64": "data:image/png;base64,...",
  "mimeType": "image/png",
  "previewOnly": true
}
```
Returns parsed recipes without saving

**Import from Image (Save)**
```
POST /api/import/image
{
  "imageBase64": "...",
  "mimeType": "image/png",
  "recipes": [
    {
      "name": "...",
      "servings": 4,
      "cookTimeMinutes": 30,
      "ingredients": [...],
      "instructions": [...]
    }
  ],
  "autoApprove": false
}
```

**Import Paprika Export**
```
POST /api/import/paprika
{ "data": "base64_encoded_zip_or_json", "autoApprove": false }
```
Handles .paprikarecipes ZIP files or gzipped JSON

**Parse Receipt (Preview)**
```
POST /api/import/receipt
{
  "imageBase64": "...",
  "mimeType": "image/png",
  "storeName": "Whole Foods"
}
```

**Apply Receipt Matches**
```
POST /api/import/receipt/apply
{
  "receiptId": "...",
  "matches": [
    { "lineIndex": 0, "ingredientId": "..." }
  ]
}
```

### Meal Plans

**List Meal Plans**
```
GET /api/meal-plans?fromDate=2025-02-03&toDate=2025-02-09&mealType=dinner
```
Defaults to current week if no dates

**Create Meal Plan**
```
POST /api/meal-plans
{
  "recipeId": "...",
  "plannedDate": "2025-02-05",
  "mealType": "dinner",
  "servingsPlanned": 4,
  "isLeftover": false,
  "parentCookingEventId": null
}
```

**Bulk Assign Meals**
```
POST /api/meal-plans/batch
{
  "mealPlans": [
    {
      "recipeId": "...",
      "plannedDate": "2025-02-05",
      "mealType": "dinner",
      "servingsPlanned": 4
    }
  ]
}
```

**Update Meal Plan**
```
PUT /api/meal-plans/:id
{ "servingsPlanned": 6, ... }
```

**Mark as Cooked**
```
POST /api/meal-plans/:id/cooked
{
  "servingsMade": 4,
  "isBatchCook": true,
  "intendedMealCount": 2,
  "rating": "thumbs_up",
  "wouldMakeAgain": true,
  "notes": "...",
  "actualCost": 15.50,
  "actualTimeMinutes": 25
}
```
Creates CookingHistory entry and optionally deducts pantry

**Delete Meal Plan**
```
DELETE /api/meal-plans/:id
```

### Shopping Lists

**List Shopping Lists**
```
GET /api/shopping-lists?status=ready
```

**Get Shopping List**
```
GET /api/shopping-lists/:id
```
Includes items grouped by ingredient category

**Generate Shopping List**
```
POST /api/shopping-lists/generate
{
  "mealPlanIds": ["...", "..."],
  "shoppingDate": "2025-02-03"
}
```
Aggregates ingredients, applies staple assumptions, calculates costs

**Update List Status**
```
PATCH /api/shopping-lists/:id/status
{ "status": "shopping" }
```

**Update Item**
```
PATCH /api/shopping-lists/:id/items/:itemId
{
  "quantity": 2,
  "userOverride": "need",
  "purchased": true,
  "actualCost": 4.99,
  "notes": "..."
}
```

**Complete List & Update Pantry**
```
POST /api/shopping-lists/:id/complete
```
Marks list as completed and creates PantryInventory entries

**Delete Shopping List**
```
DELETE /api/shopping-lists/:id
```

### Pantry

**List Pantry**
```
GET /api/pantry?status=stocked
```

**Get Expiring Items**
```
GET /api/pantry/expiring
```
Items expiring within 5 days, grouped by urgency

**Add Item**
```
POST /api/pantry
{
  "ingredientId": "...",
  "quantity": 2.5,
  "unit": "cups",
  "acquiredDate": "2025-02-03",
  "expirationDate": "2025-02-10",
  "source": "grocery_trip",
  "notes": "..."
}
```

**Get Item**
```
GET /api/pantry/:id
```

**Update Item**
```
PATCH /api/pantry/:id
{ "quantity": 1, "status": "running_low", ... }
```

**Quick Status Update**
```
PATCH /api/pantry/:id/status
{ "status": "running_low" }
```

**Bulk Check-in**
```
POST /api/pantry/checkin
{
  "updates": [
    { "itemId": "...", "quantity": 5, "status": "stocked" }
  ]
}
```

**Deduct After Cooking**
```
POST /api/pantry/deduct
{
  "cookingHistoryId": "...",
  "deductions": [
    { "ingredientId": "...", "quantity": 0.5, "unit": "cup" }
  ]
}
```

**Delete Item**
```
DELETE /api/pantry/:id
```

### Ingredients

**List Ingredients**
```
GET /api/ingredients?category=produce&limit=100
```

**Get Ingredient**
```
GET /api/ingredients/:id
```
Includes brands and estimated nutrition

**Create Ingredient**
```
POST /api/ingredients
{
  "name": "Chicken Breast",
  "category": "meat",
  "typicalUnit": "g",
  "estimatedCaloriesPerUnit": 1.65,
  "estimatedCostPerUnit": 0.05,
  "imageUrl": "https://..."
}
```

**Bulk Create Ingredients**
```
POST /api/ingredients/bulk
[
  { "name": "...", "category": "...", ... },
  { "name": "...", "category": "...", ... }
]
```

**Update Ingredient**
```
PUT /api/ingredients/:id
{ "estimatedCostPerUnit": 0.06, ... }
```

**Refresh Open Food Facts**
```
POST /api/ingredients/:id/off-refresh
```
Fetches nutrition/cost data from Open Food Facts API

**Add Brand**
```
POST /api/ingredients/:id/brands
{
  "brandName": "Kroger",
  "preferenceLevel": "acceptable",
  "notes": "Cheaper but lower quality"
}
```

**Remove Brand**
```
DELETE /api/ingredients/:id/brands/:brandId
```

**Delete Ingredient**
```
DELETE /api/ingredients/:id
```

### Recommendations

**Get Recommendations**
```
GET /api/recommendations?mealType=dinner&limit=10&excludeIds=id1,id2
```
Returns recipes scored on 7 dimensions with breakdown

**Get Single Suggestion**
```
GET /api/recommendations/suggest?mealType=dinner
```
Returns top recommendation ("What should I cook tonight?")

**Use-Soon Recipes**
```
GET /api/recommendations/use-soon
```
Recipes using expiring ingredients, ranked by urgency

**Meal-Plan Suggestions**
```
GET /api/recommendations/meal-plan-suggestions?date=2025-02-05
```
Suggestions for a specific date and meal type

### Preferences

**Get Preferences**
```
GET /api/preferences
```

**Update Preferences**
```
PUT /api/preferences
{
  "budgetTargetWeekly": 150.00,
  "calorieTargetDaily": 2000,
  "preferredCuisines": ["Italian", "Thai"],
  "dietaryRestrictions": ["vegetarian"],
  "priorityWeights": {
    "variety": 0.2,
    "expiration": 0.25,
    "pantry": 0.15,
    "budget": 0.1,
    "calorie": 0.1,
    "time": 0.1,
    "rating": 0.1
  }
}
```

**Add Disliked Ingredient**
```
POST /api/preferences/dislike/:ingredientId
```

**Remove Disliked Ingredient**
```
DELETE /api/preferences/dislike/:ingredientId
```

**Get Disliked Ingredients**
```
GET /api/preferences/disliked-ingredients
```

**Add Liked Ingredient**
```
POST /api/preferences/like/:ingredientId
```

**Remove Liked Ingredient**
```
DELETE /api/preferences/like/:ingredientId
```

**Get Liked Ingredients**
```
GET /api/preferences/liked-ingredients
```

### Settings

**Get OpenAI Key Status**
```
GET /api/settings/openai-key
```
Returns whether a key is stored (does not return the key itself)

**Store OpenAI Key**
```
PUT /api/settings/openai-key
{ "apiKey": "sk-..." }
```
Encrypts and stores in AppSecret table

**Delete OpenAI Key**
```
DELETE /api/settings/openai-key
```

**Verify OpenAI Key**
```
POST /api/settings/openai-key/verify
{ "apiKey": "sk-..." }
```
Tests the key with a simple API call

## Frontend Pages

### Main Pages

- **`/`** (Dashboard) - Overview of upcoming meals, shopping lists, pantry status
- **`/discover`** - Tinder-style recipe swipe interface for approval/rejection
- **`/meal-plan`** - Weekly calendar with drag-and-drop meal assignment
- **`/shopping`** - Shopping lists (generate, view, check-off items, complete)
- **`/pantry`** - Inventory management, expiring items, check-ins
- **`/recipes`** - Browse all approved recipes
- **`/recipes/[id]`** - Recipe detail view (servings, ingredients, nutrition, cooking history)
- **`/recipes/[id]/edit`** - Edit recipe details
- **`/recipes/new`** - Manual recipe creation form
- **`/import`** - Multi-method recipe import (URL, photo, Paprika, receipts)
- **`/ingredients`** - Ingredient catalog and management
- **`/ingredients/[id]`** - Ingredient detail with nutrition, brands, usage history
- **`/settings`** - User preferences, API key storage, diet/budget configuration

### Components

- **Dashboard** - Main landing with meal summary and quick actions
- **RecipePhoto** - Photo viewer with web image search and AI generation
- **RecipePoolSidebar** - Approved recipes sidebar for drag-to-calendar
- **MealProgressTracker** - Visualization of meals cooked vs planned
- **StagedMealsList** - Drag-drop staging area before bulk assignment
- **ServingPickerModal** - Modal to adjust servings when adding to calendar
- **CompletionCelebration** - Celebration overlay when completing meals/lists

## Recommendation Engine

Scores recipes on 7 dimensions (configurable weights):

1. **Variety** (0.2 default) - Penalizes recently cooked recipes (last 7 days get 0 points)
2. **Expiration** (0.25 default) - Boosts recipes using soon-to-expire ingredients
3. **Pantry Match** (0.15 default) - Boosts recipes with ingredients already in stock
4. **Budget** (0.1 default) - Considers estimated cost vs weekly budget target
5. **Calorie** (0.1 default) - Matches daily calorie target
6. **Time** (0.1 default) - Prefers quick recipes on weekdays, longer on weekends
7. **Rating** (0.1 default) - Boosts recipes with good cooking history ratings

Weights are stored in UserPreferences.priorityWeights and can be customized per user.

## CLI Tool

Lightweight HTTP wrapper for API calls. Useful for scripts and automation.
See `CLI_COOKBOOK.md` for a full list of examples.

```bash
cd backend

# Basic syntax
npm run cli -- api [METHOD] <path> [options]

# Examples
npm run cli -- api GET /recipes
npm run cli -- api GET /recipes?approvalStatus=approved&limit=10
npm run cli -- api POST /recipes --data '{"name":"Pasta","servings":2,"cookTimeMinutes":15,"mealType":"dinner","cookingStyle":"quick_weeknight"}'
npm run cli -- api POST /recipes/123/generate-image
npm run cli -- api PATCH /recipes/123/approval --data '{"approvalStatus":"approved"}'
npm run cli -- api POST /import/url --data '{"url":"https://example.com"}'

# Options
--base-url <url>        API base URL (default: MEAL_PLANNER_API_URL or http://localhost:3001/api)
--data <json|string>    Request body (JSON or raw string)
--data-file <path>      Read request body from file (or @file with --data)
--header <k:v>          Add header (can repeat)
--pretty                Pretty-print JSON responses
--raw                   Print raw response text
--apply                 Run admin task in write mode
--dry-run               Run admin task in dry-run mode (default)
```

Environment:
```bash
MEAL_PLANNER_API_URL=http://localhost:3001/api npm run cli -- api GET /recipes
```

## Data Pipeline Scripts

Located in `backend/src/scripts/`
These scripts are also exposed via API under `/api/admin/*` and via CLI as `npm run cli -- admin <task>`.

**normalize-ingredients.ts**
```bash
npm run db:seed -- normalize-ingredients
```
Merges duplicate ingredient names using fuzzy matching

**normalize-ingredient-names.ts**
```bash
npm run db:seed -- normalize-ingredient-names
```
Strips units and modifiers from ingredient names using IngredientNormalizer

**create-ingredients-from-receipts.ts**
```bash
npm run db:seed -- create-ingredients-from-receipts
```
Parses grocery receipts and creates Ingredient entries

**cleanup-garbage-ingredients.ts**
```bash
npm run db:seed -- cleanup-garbage-ingredients
```
Removes very short or single-letter ingredient names

Run via:
```bash
cd backend
tsx src/scripts/normalize-ingredients.ts
```

## Testing

```bash
cd backend
npm run test          # Watch mode with Vitest
npm run test:run      # Single run
```

## Database Management

```bash
cd backend

# Create/update schema
npm run db:push

# Create migration
npm run db:migrate

# Generate Prisma client
npm run db:generate

# Prisma Studio (visual editor)
npm run db:studio

# Seed sample data
npm run db:seed
```

The seed script loads the curated ingredient catalog from `backend/prisma/ingredient-catalog.ts`.
It can also enrich ingredients with Open Food Facts data (calories/images) during seeding.

Optional environment overrides:
```bash
# Disable OFF enrichment
OFF_ENRICH=false

# Tune OFF request concurrency and delay (ms)
OFF_ENRICH_CONCURRENCY=3
OFF_ENRICH_DELAY_MS=200
```

## Deployment

### Backend

```bash
cd backend
npm run build
npm start
```

Requires:
- PostgreSQL database
- MEAL_PLANNER_ENCRYPTION_KEY for secret storage
- (Optional) OPENAI_API_KEY for OCR/image features
- PORT and HOST env vars

### Frontend

```bash
cd frontend
npm run build
npm start
```

Or build and deploy static site:
```bash
npm run build
# Output in `.next/`
```

Requires:
- NEXT_PUBLIC_API_URL pointing to backend

## License

MIT

## Contributing

Contributions welcome. Open issues or PRs for bugs, features, or improvements.
