# MourTrading — Production Setup & Deployment Guide (Clerk + Supabase PostgreSQL)

## 1. Environment Variables

Configure secrets in your hosting environment (AI Studio **Settings > Secrets**, `.env` locally, or Cloud Run Secret Manager). Never expose server secrets in frontend `VITE_*` variables or commit `.env` to GitHub.

| Variable | Purpose | Scope | Required |
| :--- | :--- | :--- | :--- |
| `VITE_CLERK_PUBLISHABLE_KEY` | Clerk Publishable Key (`pk_test_...` / `pk_live_...`) for `<SignIn />`, `<SignUp />`, `<UserProfile />` | Client + Server | **Yes** |
| `CLERK_SECRET_KEY` | Clerk Secret Key (`sk_test_...` / `sk_live_...`) for server JWT verification & admin role sync | **Server-only** | **Yes** |
| `VITE_SUPABASE_URL` | Supabase PostgreSQL project URL (`https://szmpxygiitcxuhgmjtiv.supabase.co`) | Server | Optional (local fallback built-in) |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase Service Role Key used **strictly on Express server** for cloud persistence & 12s monitors | **Server-only (NEVER expose in frontend)** | Optional (falls back to `.mourtrading-data/store.json` if omitted) |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | Supabase project publishable key (read-only fallback for public market signals/plans) | Server | Optional |
| `GEMINI_API_KEY` | Server-side Mour AI market & chart vision analysis (`@google/genai`) | **Server-only** | Yes (for AI reports) |
| `ADMIN_EMAIL` | Reserved administrator account (`jackwilliam2026a@gmail.com`) | Server | Yes |

> **Security Note:** Stripe and Resend are completely removed. `SUPABASE_SERVICE_ROLE_KEY` and `CLERK_SECRET_KEY` never leave the Express backend. Every database mutation verifies Clerk JWT signatures + verified email claims first and scopes rows explicitly by the mapped `user_id`.

---

## 2. Clerk Authentication Setup Steps

1. Create or open your application in the [Clerk Dashboard](https://dashboard.clerk.com/).
2. Navigate to **User & Authentication > Email, Phone, Username**:
   - Enable **Email address**.
   - Enable **Verify at sign-up** using **Email verification code** (required by MourTrading before session access).
   - Enable **Email verification code** (passwordless email login) and/or **Password** depending on your preference.
3. Navigate to **API Keys**, copy your **Publishable key** (`VITE_CLERK_PUBLISHABLE_KEY`) and **Secret key** (`CLERK_SECRET_KEY`), and add them to your environment secrets.
4. Admin Roles:
   - Signing in with verified primary email `jackwilliam2026a@gmail.com` automatically assigns `role = 'admin'` in Supabase `user_profiles` and Clerk `publicMetadata.role`.
   - From `/admin/users`, admins can promote or demote other verified users (`Make Admin` / `Revoke Admin`), updating both Supabase PostgreSQL and Clerk `publicMetadata.role`.

---

## 3. Supabase PostgreSQL Database Setup (Non-Destructive)

### Option A: Existing Supabase Database (Preserves All Existing Tables & Data)
1. Open your Supabase project dashboard (`https://szmpxygiitcxuhgmjtiv.supabase.co`) -> **SQL Editor**.
2. Execute `supabase/clerk_migration.sql`.
   - Safely adds `clerk_user_id text UNIQUE` to `public.user_profiles` without dropping tables or deleting existing data.
   - Drops legacy `auth.users` foreign-key constraints so Clerk users link cleanly alongside existing Supabase profiles (matched automatically by `clerk_user_id` or verified primary `email`).
   - Adds `get_user_ai_quota(p_user_id uuid)` and `save_verified_user_ai_analysis(...)` RPCs for rolling 24h AI quota enforcement.

### Option B: Fresh Supabase Database
1. Open **SQL Editor** in Supabase.
2. Execute `supabase/schema.sql`.
   - Creates all 14 tables (`user_profiles`, `user_preferences`, `favorites`, `analyses`, `signals`, `signal_events`, `portfolios`, `portfolio_transactions`, `price_alerts`, `notifications`, `subscriptions`, `app_config`, `admin_audit_logs`, `auth_failure_logs`), indexes, RLS policies, and Clerk-compatible RPCs.

3. Add `SUPABASE_SERVICE_ROLE_KEY` from **Supabase > Project Settings > API** to your server secrets.

---

## 4. Google Cloud Run Deployment

```bash
gcloud run deploy mourtrading \
  --source . \
  --region europe-west2 \
  --port 3000 \
  --allow-unauthenticated \
  --set-env-vars "VITE_SUPABASE_URL=https://szmpxygiitcxuhgmjtiv.supabase.co,ADMIN_EMAIL=jackwilliam2026a@gmail.com,NODE_ENV=production"
```
Attach `VITE_CLERK_PUBLISHABLE_KEY`, `CLERK_SECRET_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `VITE_SUPABASE_PUBLISHABLE_KEY`, and `GEMINI_API_KEY` via Cloud Run Secret Manager.
