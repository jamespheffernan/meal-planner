# Meal Planner CLI Cookbook

This project ships a generic API CLI so anything reachable by HTTP is also reachable by CLI.

## Base
- Set `MEAL_PLANNER_API_URL` to point at your API (default: `http://localhost:3001/api`)
- Run commands from repo root:
  - `npm run cli -- api ...`
  - `npm run cli -- admin ...`

## Common API Tasks
1. List recipes
```
npm run cli -- api GET /recipes
```
1. Create a recipe
```
npm run cli -- api POST /recipes --data '{"name":"Pasta","servings":2,"cookTimeMinutes":15,"mealType":"dinner","cookingStyle":"quick_weeknight"}'
```
1. Approve a recipe
```
npm run cli -- api PATCH /recipes/<id>/approval --data '{"approvalStatus":"approved"}'
```
1. Import from URL
```
npm run cli -- api POST /import/url --data '{"url":"https://example.com/recipe"}'
```
1. Generate a shopping list
```
npm run cli -- api POST /shopping-lists/generate --data '{"mealPlanIds":["<id>"]}'
```

## Admin Tasks (Scripts via API)
These map to endpoints under `/api/admin/*` and can be run via CLI.

1. Normalize units (dry run)
```
npm run cli -- admin normalize-units --dry-run
```
1. Normalize units (apply)
```
npm run cli -- admin normalize-units --apply
```
1. Normalize ingredient names (merge duplicates)
```
npm run cli -- admin normalize-ingredient-names
```
1. Clean up garbage ingredients
```
npm run cli -- admin cleanup-garbage-ingredients --apply
```
1. Create ingredients from receipts
```
npm run cli -- admin create-ingredients-from-receipts --apply
```
1. Normalize ingredients with OpenAI
```
npm run cli -- admin normalize-ingredients --apply
```

## Admin Auth (optional)
If `MEAL_PLANNER_ADMIN_TOKEN` is set, pass it as a header:
```
npm run cli -- admin normalize-units --apply --header "x-admin-token: <token>"
```
