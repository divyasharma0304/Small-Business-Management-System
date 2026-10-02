# Velqora — small business management

Velqora is a configurable management app for small businesses: products and services, stock, purchases, suppliers, customers, orders, payments, expenses, optional production (recipes/BOMs), a dashboard and reports.

Nothing is specific to one kind of business. A candle maker, a bakery, a clothing brand, a reseller or a service business each set up their own categories, attributes, units, recipes and workflow. Every feature module except the core can be switched off.

The app runs locally with **Next.js** on `http://localhost:3000`. The data lives in a hosted **Supabase** project (PostgreSQL, Auth and Storage), which the Supabase free plan covers.

```
Your computer                          Supabase (cloud)
┌──────────────────────────┐           ┌───────────────────────────────┐
│ Next.js app (localhost)  │  HTTPS    │ PostgreSQL  (schema, RLS,     │
│  • React server pages    │ ───────▶  │   business-logic functions)   │
│  • Server actions        │           │ Auth        (owner login)     │
│  • Proxy (session check) │           │ Storage     (private files)   │
└──────────────────────────┘           └───────────────────────────────┘
```

---

## 👋 Running Velqora on your computer (team members)

Follow this if the business is **already set up** and someone has sent you the project's secret settings. Your computer runs only the app screens. All data lives in the shared online database, so you'll see the same products, orders and stock as everyone else.

These steps assume **Windows**. On Mac/Linux, use the Terminal app and plain `npm` instead of `npm.cmd`.

### Step 1: Install two free programs (one time only)

1. **Node.js**: go to https://nodejs.org, download the **LTS** version and install it (keep clicking *Next*).
2. **Git**: go to https://git-scm.com/download/win, download and install it (the default options are fine).

To check they worked, open a **new** PowerShell window (Start menu → type `PowerShell` → open it) and run:

```bash
node -v
```

```bash
git --version
```

Each should print a version number. If you see "not recognized", restart your computer and try again.

### Step 2: Download the project (one time only)

In PowerShell, pick a folder for it, for example your Documents folder:

```bash
cd $HOME\Documents
```

```bash
git clone https://github.com/divyasharma0304/Small-Business-Management-System.git velqora
```

```bash
cd velqora
```

> If the repository is **private**, GitHub will ask you to sign in. Ask the owner to add you first: GitHub → the repository → **Settings → Collaborators → Add people**.

### Step 3: Install the app's building blocks (one time only)

```bash
npm.cmd install
```

This takes a few minutes and downloads everything into a `node_modules` folder. Warnings are normal; only a red **ERR!** means something went wrong.

> **Why `npm.cmd` and not `npm`?** Windows PowerShell blocks script files by default, and plain `npm` is one. `npm.cmd` is the same command without that problem.

### Step 4: Add the secret settings file (one time only)

The app needs the database address and key. They are **not** on GitHub, on purpose.

1. Ask the owner for the contents of their **`.env.local`** file. They should send only these two lines, privately (WhatsApp/Signal message, not a public place):
   ```
   NEXT_PUBLIC_SUPABASE_URL=...
   NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=...
   ```
   You don't need `SUPABASE_DB_URL` or `SUPABASE_SERVICE_ROLE_KEY`. Those are only for changing the database itself, and should stay with the owner.
2. In the `velqora` folder, create a file named exactly **`.env.local`** and paste the two lines in. Easiest way:
   ```bash
   notepad .env.local
   ```
   Click **Yes** to create the file, paste, then **File → Save**. Make sure Notepad didn't add `.txt` to the name.

> ⚠️ Never put `.env.local` on GitHub or share it publicly. Git is already set up to ignore it.

### Step 5: Start the app (every time you want to use it)

```bash
npm.cmd run dev
```

Wait until you see **`✓ Ready`**, then open **http://localhost:3000** in your browser.

- Keep this PowerShell window **open** while you use the app. Closing it stops the app.
- To stop it yourself, click in the window and press **Ctrl + C**.
- Next time, you only need these two commands (no reinstall):
  ```bash
  cd $HOME\Documents\velqora
  ```
  ```bash
  npm.cmd run dev
  ```

### Step 6: Sign in

Sign in with the email and password the owner gives you.

> **Current limitation:** the app has one login per business for now. A Team page with separate logins for co-founders is planned but not built yet. Until then, the owner shares their own sign-in details with you privately. Either of you can change the password under **Settings → Account**; tell each other if you do.

### Getting updates

When new features are pushed to GitHub, stop the app (**Ctrl + C**), then run:

```bash
git pull
```

```bash
npm.cmd install
```

```bash
npm.cmd run dev
```

### If something goes wrong

| What you see | What to do |
|---|---|
| `npm : File ... npm.ps1 cannot be loaded because running scripts is disabled` | Use `npm.cmd` instead of `npm` (see Step 3). |
| `'node' / 'git' is not recognized` | Install it (Step 1), then open a **new** PowerShell window. |
| The browser shows **"Connect Supabase"** | `.env.local` is missing, misnamed (e.g. `.env.local.txt`), or in the wrong folder. Fix it, then stop and restart the app. |
| `Port 3000 is in use` | The app is already running in another window. Use that one, or open the address it prints (e.g. http://localhost:3001). |
| "Incorrect email or password" | Check the details with the owner. Use **Forgot password?** only if you're sure, because it changes the shared password. |
| Anything else | Copy the red text from the PowerShell window and send it to the owner. |

---

## Contents

1. [Status: what's built](#status-whats-built)
2. [Tech stack](#tech-stack)
3. [Setup (first time)](#setup-first-time)
4. [Environment variables](#environment-variables)
5. [Database migrations](#database-migrations)
6. [Authentication](#authentication)
7. [Storage](#storage)
8. [Financial logic (how numbers are calculated)](#financial-logic)
9. [Inventory logic](#inventory-logic)
10. [Security model (RLS)](#security-model)
11. [Demo data](#demo-data)
12. [Testing](#testing)
13. [Project structure](#project-structure)
14. [Free-tier notes](#free-tier-notes)
15. [Troubleshooting](#troubleshooting)
16. [Future deployment](#future-deployment)

---

## Status: what's built

| Area | Status |
|---|---|
| Foundation: auth (login, first-run owner sign-up, password reset/change), business setup wizard, settings, module switches, audit log | ✅ Done |
| Catalog: products / services / materials, categories, variants, custom attributes, images, costing (standard, itemised, recipe) | ✅ Done |
| Inventory: stock levels, min/max, low-stock flags, full movement ledger, adjustments, wastage, negative-stock guard | ✅ Done |
| Suppliers, customers, purchases (partial receiving, landed cost), orders (configurable workflow), payments & refunds, expenses with receipts | ✅ Done |
| Production: recipes/BOMs, batches, consumption, production wastage, finished goods at actual cost | ✅ Done |
| Dashboard with KPIs and charts, 12 reports, CSV (Excel-compatible) export, print / Save as PDF | ✅ Done |
| Demo data (load / delete with one click) | ✅ Done |
| **Phase 6 — in-app notifications, email notifications (Gmail SMTP), local backups, Gmail backups, restore** | ⏸️ **Not built yet** (postponed by the owner) |

**Postponed (Phase 6).** Low stock is already flagged on the dashboard, in the sidebar badge and on the Inventory page. There is **no** notification centre, email sending, backup or restore feature yet. The UI has no buttons for these, and nothing pretends they exist. Until Phase 6 is built, you can download your data with the CSV exports under **Reports**. Supabase's free plan has **no automatic backups** (see [Free-tier notes](#free-tier-notes)).

---

## Tech stack

| Layer | Choice | Why |
|---|---|---|
| Framework | Next.js 16 (App Router, React 19, TypeScript) | Server components for data pages, server actions for mutations, one codebase |
| Styling / UI | Tailwind CSS 4, shadcn/ui (Radix primitives), lucide-react icons | Accessible, consistent components that live in this repo (`src/components/ui`) |
| Charts | Recharts 3 via the shadcn chart wrapper | Mature, React-native, themable |
| Validation | Zod 4 | Every server action validates its input |
| Database | Supabase PostgreSQL | Hosted Postgres with RLS; multi-step operations are Postgres functions |
| Auth | Supabase Auth via `@supabase/ssr` | Cookie sessions, verified on the server (`getClaims`) |
| Files | Supabase Storage (one **private** bucket) | Images, receipts, invoices. Served through short-lived signed URLs |
| Tests | Vitest + PGlite (Postgres in WASM) | Tests run the real migrations locally, with no Docker |

---

## Setup (first time)

Requirements: **Node.js 20+** (tested on 24), npm, and a free [Supabase](https://supabase.com) account.

### 1. Create the Supabase project

1. Create a new project at supabase.com. For India, pick the **Mumbai (ap-south-1)** region. Save the database password.
2. Wait for the project to finish provisioning.

### 2. Clone and install

```bash
git clone https://github.com/divyasharma0304/Small-Business-Management-System.git velqora
cd velqora
npm install
```

### 3. Configure environment variables

```bash
cp .env.example .env.local
```

Fill in `.env.local` as described in [Environment variables](#environment-variables).

### 4. Create the database schema

```bash
npm run db:push
```

This command applies every file in `supabase/migrations/` to your Supabase database in order. See [Database migrations](#database-migrations).

### 5. Configure Supabase Auth URLs

In the Supabase dashboard, open **Authentication → URL Configuration**:

- **Site URL:** `http://localhost:3000`
- **Redirect URLs:** add `http://localhost:3000/auth/callback`

The password-reset and email-confirmation links need these settings.

### 6. Run the app

```bash
npm run dev
```

Open http://localhost:3000.

### 7. Create the owner account and your business

1. On the sign-in page, click **Create the owner account**. This link appears only while no owner exists.
   - If "Confirm email" is on in Supabase (**Authentication → Sign In / Providers → Email**), you'll receive a confirmation email. The built-in Supabase mailer is heavily rate-limited. To skip email entirely, create the user in **Authentication → Users → Add user** with "Auto Confirm User" ticked, then sign in.
2. The setup wizard asks for business details, location, currency and tax, and the features you want.
3. **Recommended:** once your owner account exists, turn off **Allow new users to sign up** in Supabase (**Authentication → Sign In / Providers**). The app already closes its own sign-up page after the first owner, and a stray account can't see any data (RLS), but disabling sign-ups removes the option entirely.

---

## Environment variables

| Variable | Required | Used by | Where to find it |
|---|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | yes | app | Project Settings → API / **Connect** |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | yes | app | Project Settings → API Keys → *publishable* key (`sb_publishable_…`). The legacy `anon` key also works; the app also reads `NEXT_PUBLIC_SUPABASE_ANON_KEY` |
| `SUPABASE_DB_URL` | for `npm run db:push` | CLI script only | **Connect** → *Session pooler* connection string, with your DB password |
| `SUPABASE_SERVICE_ROLE_KEY` | only for integration tests | test scripts only | Project Settings → API Keys → *secret* key (`sb_secret_…`) |

Rules:

- `.env.local` is git-ignored. **Never commit it.**
- The running app **never reads the service-role key**. Nothing under `src/` references it, so it cannot reach the browser.
- The publishable key is designed to be public: it grants nothing beyond what RLS allows.

---

## Database migrations

Everything about the database is in `supabase/migrations/` and is reproducible from the repo:

| File | Contents |
|---|---|
| `…000100_core_schema.sql` | Tables, enums, constraints, indexes, `updated_at` triggers |
| `…000200_business_logic.sql` | Transactional functions: stock movements, products, orders, purchases, payments, production |
| `…000300_security.sql` | Row Level Security policies, column grants, function grants, the private storage bucket and its policies |
| `…000400_reporting.sql` | Report functions (profit, time series, breakdowns) and read-model views |
| `…000500_demo_data.sql` | Optional demo data seeding and removal |
| `…000600_fk_no_action.sql` | Referential-integrity refinement |
| `…000700_business_today.sql` | Business-timezone "today" |

- **Apply:** `npm run db:push`. It runs the Supabase CLI with `SUPABASE_DB_URL`, never prints the URL, and applies only migrations not yet applied.
- **Preview:** `npm run db:push -- --dry-run`
- **Changing the schema:** add a *new* timestamped file to `supabase/migrations/`. Never edit a migration that has already been applied, and don't make schema changes only in the dashboard.

---

## Authentication

- Supabase Auth handles all passwords. The app stores none.
- `src/proxy.ts` (Next.js 16 "proxy", formerly middleware) refreshes the session cookie and redirects signed-out visitors to `/login`.
- Every page and server action checks the user again on the server (`requireContext()` in `src/lib/context.ts`), and the database enforces access through RLS. The proxy is only a convenience layer.
- Password reset: **Forgot password?** sends an email with a link → `/auth/callback` → `/auth/update-password`.
- Password change: **Settings → Account**.
- Roles: `business_members.role` exists (`owner`, `admin`, `staff`). The MVP has one owner with full access. Adding roles later doesn't require a schema rebuild.

---

## Storage

- One **private** bucket, `business-files`, created by the security migration. The size limit is 10 MB per file; allowed types are PNG, JPEG, WebP, GIF and PDF.
- File paths are `{business_id}/{products|logos|receipts|purchases}/{random}.{ext}`. Storage policies allow a user to read or write only inside folders of businesses they belong to.
- Uploads go directly from the browser with the signed-in user's session. Pages show files through signed URLs that expire after 1 hour.
- Only the path is stored in Postgres (e.g. `products.image_path`).

---

## Financial logic

These rules are implemented in SQL (`…_business_logic.sql`, `…_reporting.sql`) and apply everywhere.

### Order amounts (calculated in `public.calc_document`, mirrored in `src/lib/calc/document.ts`)

```
gross_i    = round(qty × unit price, 2)
net_i      = gross_i − line discount_i
subtotal   = Σ net_i
share_i    = order discount split across lines in proportion to net_i
base_i     = net_i − share_i
Prices exclude tax:  tax_i = round(base_i × rate/100, 2);        revenue_i = base_i;        line total = base_i + tax_i
Prices include tax:  tax_i = round(base_i − base_i/(1+rate/100)); revenue_i = base_i − tax_i; line total = base_i
Order total   = Σ line totals + shipping charge
Order revenue = Σ revenue_i + shipping charge   (shipping is revenue and is not taxed in the MVP)
```

- Tax is optional and generic: a label (GST/VAT/…), a registration number, a default rate, per-item rates, and whether selling prices include tax. With tax off, every rate counts as 0. No Indian tax rules (CGST/SGST/IGST split) are hard-coded.
- Discounts reduce revenue. They are never treated as an expense.

### When is something a sale? (revenue recognition)

In **Settings → Inventory & sales** you choose the status at which an order is **recognised**: Confirmed (default), Processing, Ready, Shipped or Delivered. When an order reaches that status, in one transaction:

1. Stock is deducted for stock-tracked lines.
2. Each line's **unit cost is frozen** on the order line: the current weighted-average stock cost, or the item's standard cost when stock isn't tracked. This is the line's COGS.
3. The order counts as revenue, dated by its **order date**.
4. The order's items are **locked**. To undo a recognised order, cancel it or mark it returned.

Drafts and orders not yet recognised don't affect stock or profit.

### Payments

- Payments are separate records. An order is paid only when payments cover it.
- `amount_paid = Σ payments − Σ refunds`. Payment status is Unpaid, Partial or Paid. A database trigger keeps these fields in sync and rejects overpayments and refunds larger than what was paid.
- Profit is based on sales, not on cash received. **Payments** and **Pending payments** show the cash view.

### Returns and cancellations

- **Cancel:** if stock was deducted, it goes back at the exact cost it left with. The order is excluded from revenue.
- **Return** (full order): same stock treatment. The sale is removed from revenue.
- Money paid back is recorded as a **refund**. The app never assumes a refund happened.
- Partial returns are not supported in the MVP. To handle one, cancel the order and re-create it with the kept items, or record a stock adjustment and a refund.

### Purchases

- Enter purchase prices **excluding tax**, as they appear on a supplier's tax invoice.
- **Landed unit cost** = (line amount after discounts + that line's share of freight/other charges, split by line value + tax **if it is not recoverable**) ÷ quantity. The setting "I can claim back tax paid on purchases" controls whether tax counts as cost.
- Stock is added at landed cost **when received**. Partial receipts are supported.
- **Purchases are not expenses.** Their cost reaches profit through COGS when the goods are sold. Record non-stock costs (rent, ads, software…) as **Expenses**.

### Profit (Reports → Profit & loss, dashboard)

```
Revenue            = Σ recognised orders' revenue (after discounts, excl. tax, incl. shipping)
COGS               = Σ frozen line costs of those orders
Gross profit       = Revenue − COGS
Operating expenses = Σ expenses
Stock losses       = stand-alone wastage value + net value of manual stock adjustments
Estimated net profit = Gross profit − Operating expenses − Stock losses
```

This is an owner's management view, not statutory accounts. It is labelled "estimated" in the app for that reason.

### Historical accuracy

Orders keep snapshots of the item description, SKU, category, price, tax rate and unit cost as they were when the order was saved or recognised. Later price or cost changes never rewrite past orders; a test in the suite checks this.

---

## Inventory logic

- **Valuation: moving weighted-average cost (WAC)**, used consistently everywhere.
  - Stock in: `new avg = (old qty × old avg + qty × unit cost) ÷ (old qty + qty)`. If there was no positive stock, the new average is simply the unit cost.
  - Stock out: at the current average. Reversals (cancel/return) use the original cost.
- **Every change creates a row in `inventory_transactions`** with the date and time, item, signed quantity, type, unit cost, value, balance and average after the movement, reference (order, purchase, batch…), batch/lot and notes. Stock levels can **only** change through `public.apply_stock_movement()`. API users can't write the stock tables directly.
- Transaction types: opening stock, purchase, sale, sale reversal, return, production output, production consumption, wastage, adjustment. Transfers between locations are not in the MVP; each item has a single location text field.
- **Negative stock** is blocked by default with a clear message. You can allow it in Settings.
- **Low stock**: quantity ≤ minimum (when a minimum is set). Low stock shows on the dashboard, in the sidebar badge, on the Inventory page and in reports.
- The history keeps full detail, so a different valuation method (e.g. FIFO layers) could be derived later.

### Production

- A recipe (BOM) lists components with quantities per *yield* and an optional wastage %. The owner defines all materials; nothing is predefined.
- Planning a batch scales the recipe. Stock doesn't change until the batch is **completed**, when one transaction:
  1. deducts the materials used (production consumption),
  2. deducts wasted materials (wastage) and records them in the wastage log, linked to the batch,
  3. adds the finished goods at **(materials used + materials wasted + optional additional cost) ÷ quantity produced**.
- Because production wastage is part of the finished goods' cost, it reaches profit through COGS. Stand-alone wastage (damage, expiry…) is written off directly in the P&L.

---

## Security model

- **Tenancy:** every business table has `business_id`. `public.is_business_member(business_id)` checks the signed-in user's membership, and every RLS policy uses it. The anon role has no table access.
- **Integrity-critical tables** (stock, stock movements, orders, order lines, purchases, production, wastage) are *read-only* for API users. They change only through `SECURITY DEFINER` functions, which check membership first and run in a single transaction. Column-level grants limit direct updates on products and stock levels to harmless fields (active flag, image, min/max/location).
- **Server actions** re-check authentication, validate with Zod, and return friendly errors. Raw database errors are logged on the server, never shown to users. CSV exports escape formula-injection characters.
- React escapes all output (XSS). Supabase uses parameterised queries (SQL injection). Search input is escaped before it reaches PostgREST filters.
- The service-role key is used only by local test scripts.

---

## Demo data

**Settings → Demo data → Load demo data** creates sample records through the same functions as real data: generic categories, Product A/B/C, a service, two materials, two customers, two suppliers, purchases (one received), a recipe with a completed batch, three orders with payments, and expenses. Every demo record carries a **Demo** badge.

**Delete all demo data** removes every demo record and its stock history. If any real order or purchase uses a demo item, customer or supplier, nothing is deleted and the app tells you why.

---

## Testing

```bash
npm test                  # database logic + calculator parity (PGlite, no network)
npm run test:integration  # against your hosted Supabase project (needs SUPABASE_SERVICE_ROLE_KEY)
npm run typecheck
npm run lint
npm run build
```

- `tests/db/business-logic.test.ts` runs the real migrations in PGlite, with stand-ins for Supabase's `auth` and `storage` schemas, and covers:
  - RLS isolation between businesses and direct-write blocking
  - SKU uniqueness
  - purchase receiving, partial receipts, landed cost and weighted-average cost
  - order totals, discounts and shipping
  - partial payments and overpayment rejection
  - stock deduction at recognition, and that historical COGS is unchanged after cost edits
  - negative-stock blocking
  - profit calculation, low-stock detection and adjustment losses
  - returns and refunds
  - production with wastage costing
  - demo seed and delete, and cascade integrity
- `tests/db/calc-parity.test.ts` checks that the browser's live totals match the database's calculation on 300 random documents.
- `tests/integration/supabase.test.ts` creates a disposable user and business in your Supabase project, then exercises Auth, PostgREST, RLS, Storage policies, the purchase → order → payment → report flow, and demo data. Afterwards it deletes everything it created.
- `scripts/e2e-user.mjs create|delete` manages a disposable user for manual browser testing. The credentials are written only to `.env.local`.

---

## Project structure

```
src/
  app/
    (auth)/              login, signup (first owner), forgot-password
    auth/                email-link callback, update-password
    setup/               first-run business wizard
    (app)/               signed-in app: dashboard, catalog, inventory, orders, customers,
                         payments, purchases, suppliers, expenses, production, reports, settings
    print/               print / Save-as-PDF views (order invoice, reports)
    api/reports/[type]   CSV export
  components/            UI building blocks (ui/ = shadcn primitives), feature components
  lib/
    actions/             server actions (validated mutations)
    queries/             server-side read helpers
    reports/             report definitions, CSV, params
    validation/          Zod schemas
    calc/                document calculator (mirror of the SQL one)
    supabase/            browser / server / proxy clients
    context.ts           auth + business context for pages and actions
  proxy.ts               session refresh + redirect to login
supabase/migrations/     the complete database definition
tests/                   PGlite database tests, hosted integration test
scripts/                 db-push, e2e test user helper
```

---

## Free-tier notes

The MVP stays within the Supabase **Free plan** for one business with low traffic. Things to know:

- **Free projects are paused after about 7 days without activity.** Restore the project from the Supabase dashboard; data is kept. Using the app regularly avoids pauses.
- **The free plan has no automatic database backups** (daily backups and point-in-time recovery are paid features). Until Velqora's own backup feature (Phase 6) exists, export your reports to CSV regularly, or take a manual dump with the Supabase CLI (`supabase db dump`). **Do not commit dumps**; they are git-ignored.
- The built-in Supabase email sender is rate-limited to a few emails per hour. That's fine for password resets. Heavier email use needs custom SMTP (planned with Phase 6).
- Storage: 1 GB on the free plan, plenty for product photos and receipts at 10 MB per file.

---

## Troubleshooting

| Problem | Fix |
|---|---|
| Every page redirects to **Connect Supabase** | `.env.local` is missing `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`. Restart `npm run dev` after editing it. |
| Signed in, but pages error with "relation … does not exist" | The migrations haven't been applied. Run `npm run db:push`. |
| `npm run db:push` can't connect | Use the **Session pooler** connection string (port 5432) and check the password. Special characters in the password are fine. |
| Password-reset link says "invalid or expired" | Add `http://localhost:3000/auth/callback` to **Redirect URLs** and request a new link. Links are single-use. |
| "Sign-ups are disabled" when creating the owner | Create the user in **Authentication → Users → Add user** (auto-confirm), then sign in. |
| "Not enough stock for …" | Negative stock is off (the default). Receive a purchase, adjust stock, or allow negative stock in Settings. |
| "This order has already been recorded as a sale" | Recognised orders are locked by design. Cancel or return the order instead. |
| The app suddenly can't reach the database after a quiet week | The free Supabase project was paused. Restore it in the dashboard. |

---

## Future deployment

The code is ready for hosted deployment (e.g. Vercel) with no structural changes:

1. Set the same environment variables in the host (not `SUPABASE_SERVICE_ROLE_KEY`, which isn't needed).
2. Add the production URL to Supabase **Site URL** and **Redirect URLs**.
3. Consider the Supabase Pro plan for automatic backups and no pausing.

Designed-for but **not implemented**: multiple users and roles (the `business_members.role` column exists), multiple businesses per user, customer and supplier portals, online payments, WhatsApp notifications, and Shopify/WooCommerce integration.
