# Pi Meals

Choose recipes, review one grocery list, subtract what is already in the kitchen, then review a supermarket basket or continue in Aside. **Our week** adds household rotation, two cooking sessions, per-person lunches and recurring breakfast and evening supplies. Both paths use the same selected quantities.

The existing recipe library, discovery and import pages remain available. Paste an NYT Cooking link to read it through the household's signed-in Aside browser, or choose **Find recipes open in Aside** to import selected tabs. Existing recipe tabs stay open; temporary capture tabs close afterward. Reimporting the same NYT recipe preserves previous corrections.

Every import is stored as a shared PostgreSQL draft, including incomplete Instagram recipes. Closing the page or restarting the server preserves it. **Save draft changes** stores edits; **Save to recipe library** keeps a recipe for future shops without adding it to the current shop. A name, base yield, ingredients and instructions are required. Unspecified ingredient amounts stay null and remain flagged when shopping; they do not block library saving or weekly planning. Instagram imports reuse Manon Sweeper's caption, speech and OCR extraction, then use one bounded evidence interpretation call when needed. Missing amounts, yield and unclear transcription remain visible.

Apply `backend/prisma/migrations/20261008120000_nullable_recipe_ingredient_quantity/migration.sql` before running this version against an existing database. It removes the quantity column's non-null constraint and preserves existing rows. Legacy shopping-list generation and automatic pantry deductions still require confirmed ingredient amounts.

## Run on the household host

Use Node 26, PostgreSQL, Python 3 and the existing authorised Pi installation. Python's Unix file lock gives one runtime owner; this build targets macOS/Linux. Mount persistent storage before starting. Configure the backend from `.env.example`; keep credentials out of Git. The assistant uses the installed Pi credential store through its SDK. It does not copy OAuth tokens.

Set `PI_MEALS_REQUIRE_LOGIN=false` on the trusted household host to open directly into the shared kitchen. This mode needs no member selection or PIN and records new changes as household activity. Existing recipes, plans and history remain available. With login enabled, member identity identifies the planner's user; it does not assign cooking responsibility.

1. Back up the existing database. For a trial, restore that backup into a **separate database** and point `backend/.env` at it.
2. Install the locked dependencies with `npm ci` in `backend` and `frontend`.
3. Generate Prisma with `npm run db:generate` in `backend`. For an existing Meal Planner database, apply `backend/prisma/migrations/20261007140000_pi_meals/migration.sql` once with `prisma db execute`. A fresh empty database needs the full Prisma schema first. Do not run a reset against household data.
4. Set the session secret, distinct member PINs, allowed UI origin, model and persistent runtime/work/log directories. Configure the existing Sweeper path if it differs from this host. Its media tools must already work.
5. Set `frontend/.env.local` to `NEXT_PUBLIC_API_URL=/api` and `BACKEND_URL=http://127.0.0.1:3101`. Use the matching backend port and host. For access away from home, put the single host behind the existing authenticated HTTPS route, use one origin, and set `PI_MEALS_SECURE_COOKIE=true`.
6. Run `npm run build` in both folders. Start the backend with `npm start`; start the frontend with `npm start -- --hostname 127.0.0.1 --port 3100`. Sign in as James or Manon.

The build copies both Python helpers into `backend/dist/scripts`. Do not deploy only TypeScript output without those assets. The runtime directory must survive restarts. Keep PostgreSQL and the runtime SQLite database together in backups. A second host must not share this runtime directory or act as a second basket writer.

## Shopping and recovery

For the normal shopping flow, install and sign in to Aside on the household host. Read `aside guide`, run `aside settings save-sessions true` so shopping tasks appear in Aside's chat list, sign in to NYT Cooking and Ocado there, and set `PI_MEALS_ASIDE_LAUNCH_ENABLED=true` in the backend environment. Restart the backend after configuration changes. `PI_MEALS_ASIDE_BINARY` can specify an absolute CLI path when the server has a restricted PATH. Aside Vault may need unlocking to fill a saved retailer login.

**Shop with Aside** creates the basket and launches its task in one action. Aside chooses suitable products and whole pack counts; unquantified ingredients remain questions for the household. Reloading the app restores the recorded shopping task and its stop/review controls. **Choose products myself** retains the optional direct product picker. Its retailer writes have a separate `PI_MEALS_CART_MUTATIONS_ENABLED` switch, disabled by default. Read-only product search uses the existing encrypted Ocado session. `OCADO_BROWSER_CHANNEL=chrome` uses installed Chrome; omitting it requires Playwright Chromium.

The application blocks the old assistant, cart-add and order endpoints. Checkout remains on Ocado. Stop other bots and scheduled cart writers before enabling a real shopping trial. The account guard records an attempt before any effect. A failed or interrupted click requires read-back; the application does not repeat it. An unknown owner remains unresolved.

Aside is attended. Its local process exit is not proof that the remote task stopped or the trolley matched the list. Choose **Stop shopping & review trolley** first. The app stops the captured session and requires an idle readback. Review the stopped trolley, then choose **I’ve checked the trolley**. The account remains reserved until this second action; confirmation is bound to that stopped session and revision. The app records your confirmation separately from automatic product-and-quantity reconciliation. Missing session identity or uncertain stop results keep the attempt unresolved. Never enable a second executor while an attempt is unresolved.

The market page caches a data-free shell and stores this household's list and pending purchase observations on the device. It shows offline and pending state. The same operation ID survives reconnect; a conflicting revision remains visible. Sync purchases or deliberately clear them before changing the saved list/member. Signing out clears the device's offline list.

## Boundaries

A preparation button creates the weekly draft. Scheduled weekly notices are not enabled. Candidate recipes and old interview notes need household confirmation; imports and cooking history do not become favourites or dietary facts. Ingredient-name exclusion checks cannot establish allergen safety.

Recorded cooking and explicit purchases are facts supplied by a member. Planned meals do not reduce pantry stock. Older stock is not silently subtracted. More than 48 hours between cooking and lunch requires a confirmed freeze/thaw plan. Availability after cooking invalidates affected planned coverage; actual cooked records remain intact.

## Checks

Run `npm run test:run` and `npm run build` in `backend`; run `npm run build` and `npm run lint` in `frontend`. The pre-existing frontend contains lint errors outside the Pi Meals modules; record those separately from changed-code checks. Live retailer writes and two household weeks remain separate acceptance checks from unit tests and local browser tests.

For rollback, stop this host, retain the database backup and runtime files, and restore recipe/list access with cart mutations disabled. Do not replay prior approvals or start old and new cart writers together.
