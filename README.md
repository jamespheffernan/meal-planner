# Meal Planner

Smart meal planning and grocery shopping app with intelligent defaults, batch cooking support, and loose pantry tracking.

## Features

- **Recipe Discovery** - Tinder-style swipe interface to approve/reject recipes
- **Meal Planning** - Weekly calendar view with drag-and-drop meal planning
- **Smart Shopping Lists** - Intelligent assumptions (staples vs perishables)
- **Pantry Management** - Track what you have with expiration alerts
- **Batch Cooking** - Plan leftovers across multiple days

## Tech Stack

- **Backend**: Node.js, Fastify, Prisma, PostgreSQL
- **Frontend**: Next.js 15, React, TailwindCSS, TanStack Query
- **Database**: PostgreSQL

## Getting Started

### Prerequisites

- Node.js 18+
- PostgreSQL database
- npm or pnpm

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
```

Frontend (`frontend/.env.local`):
```
NEXT_PUBLIC_API_URL=http://localhost:3001/api
```

4. Set up the database:
```bash
npm run db:push
```

5. Start the development servers:
```bash
npm run dev
```

The app will be available at:
- Frontend: http://localhost:3000
- Backend API: http://localhost:3001

## Project Structure

```
meal-planner/
├── backend/
│   ├── prisma/
│   │   └── schema.prisma    # Database schema
│   └── src/
│       ├── index.ts         # Fastify server
│       ├── plugins/         # Fastify plugins
│       └── routes/          # API routes
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
- `POST /api/recipes` - Create recipe
- `PATCH /api/recipes/:id/approval` - Update approval status

### Meal Plans
- `GET /api/meal-plans` - List meal plans (with date range)
- `POST /api/meal-plans` - Create meal plan
- `POST /api/meal-plans/:id/cooked` - Mark as cooked

### Shopping Lists
- `GET /api/shopping-lists` - List shopping lists
- `POST /api/shopping-lists/generate` - Generate from meal plans
- `PATCH /api/shopping-lists/:id/items/:itemId` - Update item

### Pantry
- `GET /api/pantry` - List pantry items
- `GET /api/pantry/expiring` - Get expiring items
- `POST /api/pantry` - Add item
- `PATCH /api/pantry/:id/status` - Quick status update

## License

MIT
