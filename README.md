# Meal Planner

Smart meal planning and grocery shopping app with intelligent defaults, batch cooking support, and loose pantry tracking.

## Features

- **Recipe Discovery** - Tinder-style swipe interface to approve/reject recipes
- **Recipe Import** - Import recipes from URLs (schema.org), photos (OCR), or Paprika exports
- **Meal Planning** - Weekly calendar view with drag-and-drop meal planning
- **Smart Shopping Lists** - Intelligent assumptions (staples vs perishables)
- **Pantry Management** - Track what you have with expiration alerts
- **Batch Cooking** - Plan leftovers across multiple days
- **Smart Recommendations** - AI-powered recipe suggestions based on pantry, preferences, and history
- **Telegram Bot** - Quick access to meals, shopping lists, and check-ins

## Tech Stack

- **Backend**: Node.js, Fastify, Prisma, PostgreSQL
- **Frontend**: Next.js 15, React, TailwindCSS, TanStack Query
- **Telegram Bot**: Telegraf
- **AI Services**: OpenAI (for OCR and nutrition estimation)
- **Database**: PostgreSQL

## Getting Started

### Prerequisites

- Node.js 18+
- PostgreSQL database
- npm or pnpm
- (Optional) OpenAI API key for recipe OCR
- (Optional) Telegram bot token for bot features

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
DATABASE_URL="postgresql://user:password@localhost:5432/meal_planner?schema=public"
PORT=3001

# Optional - for recipe OCR and AI features
OPENAI_API_KEY=your_openai_api_key

# Optional - for Telegram bot
TELEGRAM_BOT_TOKEN=your_telegram_bot_token
```

Frontend (`frontend/.env.local`):
```
NEXT_PUBLIC_API_URL=http://localhost:3001/api
```

4. Set up the database:
```bash
cd backend
npm run db:push
npm run db:seed  # Optional: add sample data
cd ..
```

5. Start the development servers:
```bash
npm run dev
```

The app will be available at:
- Frontend: http://localhost:3000
- Backend API: http://localhost:3001

### Running the Telegram Bot

```bash
cd backend
npm run bot
```

## Project Structure

```
meal-planner/
├── backend/
│   ├── prisma/
│   │   ├── schema.prisma    # Database schema
│   │   └── seed.ts          # Sample data seed script
│   └── src/
│       ├── index.ts         # Fastify server
│       ├── bot/             # Telegram bot
│       ├── plugins/         # Fastify plugins
│       ├── routes/          # API routes
│       ├── services/        # Business logic
│       └── tests/           # Unit tests
├── frontend/
│   └── src/
│       ├── app/             # Next.js app router pages
│       ├── components/      # React components
│       └── lib/             # API client and utilities
└── package.json             # Root package.json
```

## API Endpoints

### Recipes
- `GET /api/recipes` - List recipes
- `GET /api/recipes/discover` - Get pending recipes for swipe
- `GET /api/recipes/:id` - Get recipe details
- `POST /api/recipes` - Create recipe
- `PUT /api/recipes/:id` - Update recipe
- `PATCH /api/recipes/:id/approval` - Update approval status
- `DELETE /api/recipes/:id` - Delete recipe

### Recipe Import
- `POST /api/import/url` - Import from URL (schema.org)
- `POST /api/import/image` - Import from photo (OCR)
- `POST /api/import/paprika` - Import Paprika export
- `POST /api/import/receipt` - Parse grocery receipt

### Meal Plans
- `GET /api/meal-plans` - List meal plans (with date range)
- `POST /api/meal-plans` - Create meal plan
- `POST /api/meal-plans/batch` - Create batch cook with leftovers
- `POST /api/meal-plans/:id/cooked` - Mark as cooked
- `DELETE /api/meal-plans/:id` - Delete meal plan

### Shopping Lists
- `GET /api/shopping-lists` - List shopping lists
- `GET /api/shopping-lists/:id` - Get shopping list details
- `POST /api/shopping-lists/generate` - Generate from meal plans
- `PATCH /api/shopping-lists/:id/items/:itemId` - Update item
- `POST /api/shopping-lists/:id/complete` - Complete and update pantry

### Pantry
- `GET /api/pantry` - List pantry items
- `GET /api/pantry/expiring` - Get expiring items
- `POST /api/pantry` - Add item
- `PATCH /api/pantry/:id/status` - Quick status update

### Recommendations
- `GET /api/recommendations` - Get recommended recipes
- `GET /api/recommendations/suggest` - Get top suggestion for meal type
- `GET /api/recommendations/use-soon` - Recipes using expiring ingredients
- `GET /api/recommendations/meal-plan-suggestions` - Suggestions for a date

### Preferences
- `GET /api/preferences` - Get user preferences
- `PUT /api/preferences` - Update preferences
- `POST /api/preferences/dislike/:ingredientId` - Add disliked ingredient
- `DELETE /api/preferences/dislike/:ingredientId` - Remove disliked ingredient

## Telegram Bot Commands

- `/start` - Welcome message
- `/help` - Show all commands
- `/meals` - View upcoming meals this week
- `/suggest [meal_type]` - Get a recipe suggestion
- `/cooked` - Quick log that you cooked today's meal
- `/shopping` - View current shopping list
- `/pantry` - Quick pantry status
- `/expiring` - Items expiring soon
- `/checkin` - Confirm pantry items (weekly reminder)

## Running Tests

```bash
cd backend
npm run test       # Watch mode
npm run test:run   # Single run
```

## Recommendation Engine

The recommendation engine scores recipes based on configurable weights:

- **Variety** - Penalizes recently cooked recipes
- **Expiration** - Boosts recipes using soon-to-expire ingredients
- **Pantry Match** - Boosts recipes with ingredients you already have
- **Budget** - Considers estimated cost vs weekly budget
- **Calories** - Matches your daily calorie target
- **Time** - Quick recipes on weekdays, longer on weekends
- **Rating** - Considers your past ratings

Configure weights in Settings to personalize recommendations.

## License

MIT
