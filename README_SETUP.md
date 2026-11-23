# MourTrading — Production Setup & Deployment Guide (Supabase + Gemini)

## 1. Required Environment Variables

Configure these secrets in your hosting environment (AI Studio **Settings > Secrets**, `.env` locally, or Cloud Run Secret Manager). Never commit real secrets to GitHub.

| Variable | Purpose | Required |
| :--- | :--- | :--- |
| `VITE_SUPABASE_URL` | Supabase project URL (`https://szmpxygiitcxuhgmjtiv.supabase.co`) | Yes |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | Supabase project publishable (`anon`) key | Yes |
| `GEMINI_API_KEY` | Server-side Mour AI market & chart vision analysis (`@google/genai`) | Yes |
| `ADMIN_EMAIL` | Reserved administrator account (`jackwilliam2026a@gmail.com`) | Yes |
| `SUPABASE_SERVICE_ROLE_KEY` | Enables background 12s signal TP/SL & price alert evaluator (server-only) | Optional |
| `RESEND_API_KEY` | Price alert notification emails (and custom SMTP in Supabase Auth) | Optional |
| `RESEND_FROM_EMAIL` | Verified sender address in Resend (e.g. `MourTrading <noreply@yourdomain.com>`) | Optional |
| `STRIPE_SECRET_KEY` | External payment gateway key (leave blank until activating Pro checkout) | Optional |

---

## 2. Supabase PostgreSQL Schema, Triggers & RLS Setup

1. Open your Supabase project dashboard (`https://szmpxygiitcxuhgmjtiv.supabase.co`) -> **SQL Editor**.
2. Paste and execute the entire contents of `supabase/schema.sql`.
   This creates:
   - All 14 PostgreSQL tables (`user_profiles`, `user_preferences`, `favorites`, `analyses`, `signals`, `signal_events`, `portfolios`, `portfolio_transactions`, `price_alerts`, `notifications`, `subscriptions`, `app_config`, `admin_audit_logs`, `auth_failure_logs`).
   - `handle_new_user()` trigger on `auth.users` that auto-provisions profile, default favorites, preferences, portfolio, subscription, and grants `role = 'admin'` strictly to `jackwilliam2026a@gmail.com`.
   - `protect_profile_privileged_columns()` trigger preventing role/plan/status self-escalation.
   - `get_my_ai_quota()` & `save_verified_ai_analysis(...)` `SECURITY DEFINER` RPCs for atomic rolling 24h AI quota enforcement.
   - Strict Row Level Security (`ENABLE ROW LEVEL SECURITY`) policies on every table.
3. In **Authentication > Providers > Email**, ensure **Email** is enabled and customize the **Magic Link / Email OTP** template to display `{{ .Token }}` so users receive a 6-digit OTP code.

---

## 3. Google Cloud Run Deployment

```bash
gcloud run deploy mourtrading \
  --source . \
  --region europe-west2 \
  --port 3000 \
  --allow-unauthenticated \
  --set-env-vars "VITE_SUPABASE_URL=https://szmpxygiitcxuhgmjtiv.supabase.co,ADMIN_EMAIL=jackwilliam2026a@gmail.com,NODE_ENV=production"
```
Attach `VITE_SUPABASE_PUBLISHABLE_KEY`, `GEMINI_API_KEY`, and optionally `SUPABASE_SERVICE_ROLE_KEY` and `RESEND_API_KEY` via Cloud Run Secret Manager.
