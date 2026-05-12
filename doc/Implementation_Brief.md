# Implementation Brief: Pulse Migration

## 1. Technical Stack
- **Framework**: Next.js (App Router).
- **Database**: Turso (SQLite).
- **ORM**: Drizzle ORM or Kysely.
- **Styling**: Tailwind CSS + Framer Motion.
- **Market Data**: Alpha Vantage API (Free Tier).

## 2. Backend Architecture
### 2.1 API Routes (`/api`)
- `POST /auth`: Validate PIN against a server-side hash.
- `GET /portfolio`: Fetch snapshots and aggregated holdings.
- `POST /trade`: Log transaction and trigger asset metadata refresh.
- `GET /sync`: Trigger Alpha Vantage pull (Cron Job via Vercel).

### 2.2 Data Migration Script
- **Source**: Existing GAS API (`?action=getPortfolio`).
- **Target**: Turso `transactions` and `snapshots` tables.
- **Process**:
    1. Fetch full JSON from GAS.
    2. Map to SQL Schema.
    3. Perform Bulk Insert.
    4. Recalculate 'Net Invested' for every day to populate `snapshots` if missing.

## 3. Frontend Architecture
- **State Management**: React Context or Zustand for local state (Currency Mode, Stealth Mode).
- **Components**:
    - `HeroSection`: Performance graph + Balance + Currency Toggle.
    - `AllocationSection`: Double-doughnut charts + Breakdown bars.
    - `HoldingsTable`: High-density list with expandable details banner.
    - `SimulateView`: Form input -> Result cards.

## 4. Automation (Cron)
- **Schedule**: 4 times/day (IST) to cover US Market hours.
- **Task**: 
    1. Fetch latest prices for all active tickers in `assets`.
    2. Update `assets` table.
    3. Record a new entry in `snapshots` at market close (23:00).
