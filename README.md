# Kind Clock

Kind Clock is a static web app designed for GitHub Pages and backed by Supabase for auth + database.

## Features started in this implementation

- User sign up and login
- Workplace creation (admin) and join via one-time invite code
- Clock in and clock out
- Auto clock-out options:
  - After a number of hours
  - At a specific time
- Time off entry (self-service, no approval)
- Admin tools:
  - Create one-time invite codes
  - Set weekly schedule hours for users
  - Correct historical sessions (with audit log)
- Weekly progress view (Monday-Sunday, America/Chicago schedule boundary)

## Project files

- `index.html`: page markup and section layout
- `styles.css`: friendly visual style
- `app.js`: Supabase client logic and UI behavior
- `config.js`: Supabase URL/anon key config
- `supabase/schema.sql`: schema, RLS policies, and RPC functions
- `.github/workflows/deploy.yml`: GitHub Pages deployment workflow

## 1) Supabase setup

1. Open your Supabase project SQL editor.
2. Run `supabase/schema.sql`.
3. In Supabase Auth settings, configure your Site URL and redirect URL to your GitHub Pages URL (for example `https://<username>.github.io/<repo>`).

## 2) Configure frontend

Edit `config.js`:

```js
export const SUPABASE_URL = "https://YOUR_PROJECT.supabase.co";
export const SUPABASE_ANON_KEY = "YOUR_SUPABASE_ANON_KEY";
```

## 3) Run locally

Because this uses ES modules, run a local static server from the project root.

PowerShell example:

```powershell
python -m http.server 5500
```

Then open `http://localhost:5500`.

## 4) Deploy to GitHub Pages

1. Push to `main`.
2. In GitHub repo settings, enable Pages and choose GitHub Actions as source.
3. The workflow deploys the static files from the repository root.

## 5) Auto clock-out backend runner

`supabase/schema.sql` includes function `public.run_auto_clock_out()`.

Set up a scheduled job in Supabase (or external scheduler) that calls:

```sql
select public.run_auto_clock_out();
```

Run every 1 to 5 minutes for reliable auto-close.

## Notes and current limitations

- This is the first implementation slice and intentionally lightweight.
- Invite codes are one-time use.
- Time off is recorded but does not reduce required schedule hours.
- Weekly progress uses Monday-Sunday boundaries in America/Chicago for grouping.
- If you enable email confirmation in Supabase Auth, users must confirm before login.

## Next implementation steps

- Add richer validation and friendlier admin correction UI (session picker)
- Add notification prompts for imminent auto clock-out
- Add deeper reporting (weekly history and exports)
