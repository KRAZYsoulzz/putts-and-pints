# Putts & Pints — Scoreboard & Season Tournament Tracker

A dedicated tournament tracker and live scoreboard for **Putts & Pints**. Optimized for laptop scoring during event nights while providing a sleek, live mobile/tablet view for players via QR code.

Built with **React**, **TypeScript**, **Vite**, **Supabase**, and **VitePWA**.

---

## 🍺 Tournament Format & Rules

- **Divisions:** Separate Men's & Women's divisions.
- **Entry & Pots:**
  - $10 entry ($8 to night's division payout, $2 to Perfect Round Pot).
  - Bar matches half the total entry pot.
  - Perfect Round Pot builds and caps at $250; excess flows into the Backup Pot.
- **Scoring (18 Holes):**
  - **Basket 1 (5 stations):** 2 discs each, 1 to 5 pts per make (Max: 30 pts). Making all 10 discs is a **Perfect 5**.
  - **Basket 2 (4 stations):** 2 discs each, 1 to 4 pts per make (Max: 20 pts). Making all 8 discs is a **Perfect 4**.
  - One 9 is 50 pts max; 18 holes is 100 pts max.
- **The Cut & Final 9:** Top half of the field qualifies for the Final 9. Final 9 points are added to 18-hole totals (Max: 150 pts).
- **Bonuses:**
  - Perfect 5: $10 (split on ties)
  - Perfect 4: $10 (split on ties)
  - Division High Score: $10 (must beat previous record; split on ties)
  - Perfect Round Pot: Basket 1 = 30 + bonus spot makes.
  - Bonuses awarded manually by tournament director via right-click context menu.
- **Tags ($20):**
  - Optional. Tag fund finances tags, trophy, and subsidies.
  - Tag holders only qualify for bonuses.
  - Highest score gets the lowest tag number.
- **Season Points:** Top 5 in each division earn 10, 8, 6, 4, 2 points.

---

## 🚀 Supabase Setup

Putts & Pints shares the existing Supabase project with Putt Night. All tables are strictly isolated with the `pp_` prefix:
- `pp_seasons`
- `pp_players`
- `pp_tags`
- `pp_events`
- `pp_entries`
- `pp_ledger`

### 1. Apply Database Migration
Open your Supabase dashboard -> **SQL Editor**, open `supabase/001_schema.sql` and run it. That's it!

### 2. Director Login
Les can log in directly on the web app at `/login`:
- **Username:** `admin` (or `les`)
- **Password:** `MoneyManLes`

---

## 🌐 Netlify Deployment

1. Push this repository to your GitHub account:
   ```bash
   git remote add origin https://github.com/<your-username>/putts-and-pints.git
   git branch -M main
   git push -u origin main
   ```
2. In [Netlify](https://app.netlify.com/):
   - Click **Add new site** -> **Import an existing project** -> Select your new GitHub repo.
   - Build settings:
     - **Build command:** `npm run build`
     - **Publish directory:** `dist`
   - Single-page application redirects are already pre-configured in `public/_redirects`.

---

## 💻 Local Development

```bash
# Install dependencies
npm install

# Run dev server with hot reload
npm run dev

# Test scoring and financial rules logic
npx tsx scripts/test-logic.ts

# Production build
npm run build
```
