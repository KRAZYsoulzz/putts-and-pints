# Putts & Pints — Scoreboard & Season Tournament Tracker

A dedicated tournament tracker and live scoreboard for **Putts & Pints**. Optimized for laptop scoring during event nights while providing a sleek, live mobile/tablet view for players via QR code.

Built with **React**, **TypeScript**, **Vite**, **Supabase**, and **VitePWA**.

---

## 🍺 Tournament Format & Rules

- **Divisions:** Separate Men's & Women's divisions.
- **Entry & Pots:**
  - $10 entry ($8 to night's division payout, $2 to Perfect Round Pot).
  - Bar matches half the total entry pot, up to $150 per event (both divisions combined).
  - Perfect Round Pot builds and caps at $250; excess flows into the Backup Pot.
- **Scoring:** scorers enter two totals per player, the 18-hole total (max 100) and, for finalists, the Final 9 total (max 50). Per-basket scores are not tracked, so Perfect 5 / Perfect 4 / Perfect Round are awarded by hand. Making all 10 Basket 1 discs is a **Perfect 5**; all 8 Basket 2 discs is a **Perfect 4**.
- **The Cut & Final 9:** Top half of the field qualifies for the Final 9. Final 9 points are added to 18-hole totals (Max: 150 pts).
- **Bonuses:**
  - Perfect 5: shared pot (carryover + $10 added when someone wins), split evenly among everyone who hits it
  - Perfect 4: shared pot (carryover + $10 added when someone wins), split evenly among everyone who hits it
  - Division High Score: $10 (must beat previous record; split on ties)
  - Perfect Round Pot: shared pot, split evenly among everyone who hits it.
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

### 1. Apply Database Migrations
Open your Supabase dashboard → **SQL Editor** and run these files in order:

1. `supabase/001_schema.sql` (skip if the `pp_` tables already exist)
2. `supabase/002_admin_auth.sql`
3. `supabase/003_ledger_and_event_name.sql` (optional event names, the payout purse, bar-match and place-payout ledger rows, and bonus funding). Run this before using payouts. The app does not run it itself.

`002` turns off anonymous writes. Players and viewers can still read the live scoreboard, standings, players, and pots. Scoring, roster edits, pot adjustments, season management, and settings saves require a signed-in director. Do not add the `pp_private` schema to **Exposed schemas**.

### 2. Create the director account
The app no longer checks a password in the browser. Directors sign in through Supabase Auth. The login page still accepts usernames `admin` and `les`; those names are aliases for one Supabase user.

There is no seeded password. Create the account once:

1. In the dashboard open **Authentication → Users → Add user → Create new user**.
2. Use an email whose domain can receive mail. Supabase rejects addresses on `.local` and `example.com`.
3. Choose a password and turn on **Auto Confirm User**. You can reuse the director password you already use. Do not put it in the repository, this README, or a migration. It used to be hardcoded in the client, so pick a new one if this repo was ever shared.
4. Optional: under **Authentication → Providers → Email**, turn off public sign-ups. An extra account still cannot change data unless it is listed as a director.
5. In the SQL Editor, replace the email and run:

```sql
insert into pp_private.admins (user_id)
select id from auth.users where email = 'director@your-domain.com'
on conflict (user_id) do nothing;

insert into pp_private.director_alias (username, email) values
  ('admin', 'director@your-domain.com'),
  ('les', 'director@your-domain.com')
on conflict (username) do update set email = excluded.email;
```

6. Open `/login` and sign in with username `admin` or `les`, or with that email address.

To add another director, create their Supabase user, insert their id into `pp_private.admins`, and have them sign in with their email. Sign-out is in the sidebar (and in the top bar on a phone).

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
