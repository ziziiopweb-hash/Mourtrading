-- ============================================================================
-- MourTrading — PostgreSQL Schema, Triggers, RPCs & Hardened RLS Policies
-- Target: Supabase PostgreSQL (https://szmpxygiitcxuhgmjtiv.supabase.co)
-- Run this entire script in the Supabase SQL Editor.
-- ============================================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ----------------------------------------------------------------------------
-- 1. Tables
-- ----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.user_profiles (
  id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email text UNIQUE NOT NULL,
  display_name text,
  role text NOT NULL DEFAULT 'user' CHECK (role IN ('user', 'admin')),
  plan text NOT NULL DEFAULT 'free' CHECK (plan IN ('free', 'pro')),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'suspended')),
  last_login_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.user_preferences (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  language text NOT NULL DEFAULT 'ar' CHECK (language IN ('ar', 'en')),
  default_quote_asset text NOT NULL DEFAULT 'USDT',
  default_timeframe text NOT NULL DEFAULT '1h' CHECK (default_timeframe IN ('1m', '5m', '15m', '1h', '4h', '1d', '1w')),
  email_alerts_enabled boolean NOT NULL DEFAULT true,
  signal_notifications_enabled boolean NOT NULL DEFAULT true,
  price_alerts_enabled boolean NOT NULL DEFAULT true,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.favorites (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  symbol text NOT NULL CHECK (char_length(symbol) BETWEEN 3 AND 20),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, symbol)
);

CREATE INDEX IF NOT EXISTS idx_favorites_user_id ON public.favorites(user_id);

CREATE TABLE IF NOT EXISTS public.analyses (
  id text PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  symbol text NOT NULL,
  coin_name text NOT NULL,
  timeframe text NOT NULL CHECK (timeframe IN ('1m', '5m', '15m', '1h', '4h', '1d', '1w')),
  analysis_type text NOT NULL CHECK (analysis_type IN ('market', 'vision')),
  verdict text NOT NULL CHECK (verdict IN ('BUY', 'WAIT', 'AVOID')),
  verified_price numeric NOT NULL,
  confidence_score numeric NOT NULL,
  report jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_analyses_user_created ON public.analyses(user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS public.signals (
  id text PRIMARY KEY,
  symbol text NOT NULL,
  source text NOT NULL CHECK (source IN ('ADMIN', 'AI')),
  timeframe text NOT NULL CHECK (timeframe IN ('1m', '5m', '15m', '1h', '4h', '1d', '1w')),
  status text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'TP1_HIT', 'TP2_HIT', 'TP3_HIT', 'STOP_LOSS_HIT', 'CANCELLED')),
  entry_low numeric NOT NULL CHECK (entry_low > 0),
  entry_high numeric NOT NULL CHECK (entry_high > 0),
  tp1 numeric NOT NULL CHECK (tp1 > 0),
  tp2 numeric NOT NULL CHECK (tp2 > 0),
  tp3 numeric NOT NULL CHECK (tp3 > 0),
  stop_loss numeric NOT NULL CHECK (stop_loss > 0),
  risk_reward_ratio numeric NOT NULL,
  entry_reference_price numeric,
  actual_result_percent numeric,
  ambiguity_note text,
  explanation text NOT NULL,
  created_by uuid REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_signals_status_created ON public.signals(status, created_at DESC);

CREATE TABLE IF NOT EXISTS public.signal_events (
  id text PRIMARY KEY,
  signal_id text NOT NULL REFERENCES public.signals(id) ON DELETE CASCADE,
  symbol text NOT NULL,
  event_type text NOT NULL CHECK (event_type IN ('CREATED', 'TP1_HIT', 'TP2_HIT', 'TP3_HIT', 'STOP_LOSS_HIT', 'CANCELLED')),
  trigger_price numeric NOT NULL,
  result_percent numeric NOT NULL DEFAULT 0,
  note text,
  occurred_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_signal_events_signal ON public.signal_events(signal_id, occurred_at DESC);

CREATE TABLE IF NOT EXISTS public.portfolios (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  usdt_balance numeric NOT NULL DEFAULT 0 CHECK (usdt_balance >= 0),
  holdings jsonb NOT NULL DEFAULT '[]'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.portfolio_transactions (
  id text PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  asset text NOT NULL,
  side text NOT NULL CHECK (side IN ('BUY', 'SELL')),
  quantity numeric NOT NULL CHECK (quantity > 0),
  price_usdt numeric NOT NULL CHECK (price_usdt >= 0),
  note text DEFAULT '',
  executed_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_portfolio_tx_user_exec ON public.portfolio_transactions(user_id, executed_at DESC);

CREATE TABLE IF NOT EXISTS public.price_alerts (
  id text PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  symbol text NOT NULL,
  condition text NOT NULL CHECK (condition IN ('ABOVE', 'BELOW', 'ENTRY_ZONE', 'TP_TARGET', 'SL_TARGET')),
  target_price numeric NOT NULL CHECK (target_price > 0),
  target_price_upper numeric,
  email_notify boolean NOT NULL DEFAULT false,
  status text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'TRIGGERED', 'DISABLED')),
  triggered_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_price_alerts_user_status ON public.price_alerts(user_id, status, created_at DESC);

CREATE TABLE IF NOT EXISTS public.notifications (
  id text PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  type text NOT NULL CHECK (type IN ('PRICE_ALERT', 'SIGNAL_EVENT', 'ANNOUNCEMENT', 'SYSTEM')),
  title text NOT NULL,
  message text NOT NULL,
  read boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_notifications_user_created ON public.notifications(user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS public.subscriptions (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  plan text NOT NULL DEFAULT 'free' CHECK (plan IN ('free', 'pro')),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'pending_payment', 'expired', 'cancelled')),
  requested_cycle text,
  daily_ai_limit integer NOT NULL DEFAULT 3,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.app_config (
  id text PRIMARY KEY DEFAULT 'global',
  free_daily_ai_limit integer NOT NULL DEFAULT 3,
  pro_daily_ai_limit integer NOT NULL DEFAULT 50,
  pro_monthly_price_usd numeric NOT NULL DEFAULT 29,
  pro_annual_price_usd numeric NOT NULL DEFAULT 290,
  pro_duration_days integer NOT NULL DEFAULT 30,
  free_features jsonb NOT NULL DEFAULT '["3 AI Analyses / 24h","Live Binance Spot Market Data","Standard Technical Charts & Indicators","Watchlist & Manual Portfolio Tracking"]'::jsonb,
  pro_features jsonb NOT NULL DEFAULT '["50 AI Analyses / 24h","Multi-Timeframe AI & Vision Deep Reports","Priority Spot Signals & Alerts","Extended Watchlists & Portfolio Analytics"]'::jsonb,
  announcement text NOT NULL DEFAULT '',
  updated_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO public.app_config (id) VALUES ('global') ON CONFLICT (id) DO NOTHING;

CREATE TABLE IF NOT EXISTS public.admin_audit_logs (
  id text PRIMARY KEY,
  admin_uid uuid NOT NULL REFERENCES auth.users(id),
  action text NOT NULL,
  target_id text NOT NULL,
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.auth_failure_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text,
  reason text NOT NULL,
  ip text,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- ----------------------------------------------------------------------------
-- 2. Security Helper Functions & Triggers
-- ----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.user_profiles
    WHERE id = auth.uid()
      AND role = 'admin'
      AND status = 'active'
      AND lower(email) = 'jackwilliam2026a@gmail.com'
  );
$$;

-- Automatically provision profile, preferences, default favorites, portfolio & subscription on signup
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  assigned_role text;
  user_display text;
BEGIN
  assigned_role := CASE
    WHEN lower(NEW.email) = 'jackwilliam2026a@gmail.com' THEN 'admin'
    ELSE 'user'
  END;
  user_display := COALESCE(NEW.raw_user_meta_data->>'display_name', split_part(NEW.email, '@', 1));

  INSERT INTO public.user_profiles (id, email, display_name, role, plan, status, last_login_at)
  VALUES (NEW.id, lower(NEW.email), user_display, assigned_role, 'free', 'active', now())
  ON CONFLICT (id) DO UPDATE SET
    role = assigned_role,
    last_login_at = now(),
    updated_at = now();

  INSERT INTO public.user_preferences (user_id) VALUES (NEW.id) ON CONFLICT (user_id) DO NOTHING;
  INSERT INTO public.portfolios (user_id) VALUES (NEW.id) ON CONFLICT (user_id) DO NOTHING;
  INSERT INTO public.subscriptions (user_id, plan, status, daily_ai_limit)
  VALUES (NEW.id, 'free', 'active', 3)
  ON CONFLICT (user_id) DO NOTHING;

  INSERT INTO public.favorites (user_id, symbol)
  VALUES
    (NEW.id, 'BTCUSDT'),
    (NEW.id, 'ETHUSDT'),
    (NEW.id, 'SOLUSDT'),
    (NEW.id, 'BNBUSDT')
  ON CONFLICT (user_id, symbol) DO NOTHING;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- Guard against non-admin users escalating their own role/plan/status
CREATE OR REPLACE FUNCTION public.protect_profile_privileged_columns()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.is_admin() THEN
    IF NEW.role IS DISTINCT FROM OLD.role
       OR NEW.plan IS DISTINCT FROM OLD.plan
       OR NEW.status IS DISTINCT FROM OLD.status
       OR NEW.email IS DISTINCT FROM OLD.email THEN
      RAISE EXCEPTION 'Unauthorized modification of privileged account fields';
    END IF;
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_protect_profile ON public.user_profiles;
CREATE TRIGGER trg_protect_profile
  BEFORE UPDATE ON public.user_profiles
  FOR EACH ROW EXECUTE FUNCTION public.protect_profile_privileged_columns();

-- Atomic rolling 24-hour AI Quota Check (enforced via PostgreSQL server timestamps)
CREATE OR REPLACE FUNCTION public.get_my_ai_quota()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  uid uuid := auth.uid();
  u_plan text;
  u_role text;
  free_lim integer;
  pro_lim integer;
  daily_lim integer;
  used_cnt integer;
BEGIN
  IF uid IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  SELECT plan, role INTO u_plan, u_role FROM public.user_profiles WHERE id = uid;
  SELECT free_daily_ai_limit, pro_daily_ai_limit INTO free_lim, pro_lim FROM public.app_config WHERE id = 'global';

  daily_lim := CASE
    WHEN u_role = 'admin' THEN 500
    WHEN u_plan = 'pro' THEN COALESCE(pro_lim, 50)
    ELSE COALESCE(free_lim, 3)
  END;

  SELECT count(*)::integer INTO used_cnt
  FROM public.analyses
  WHERE user_id = uid
    AND created_at >= (now() - interval '24 hours');

  RETURN jsonb_build_object(
    'plan', COALESCE(u_plan, 'free'),
    'used24h', used_cnt,
    'limit24h', daily_lim,
    'remaining24h', GREATEST(0, daily_lim - used_cnt)
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.save_verified_ai_analysis(
  p_id text,
  p_symbol text,
  p_coin_name text,
  p_timeframe text,
  p_analysis_type text,
  p_verdict text,
  p_verified_price numeric,
  p_confidence_score numeric,
  p_report jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  uid uuid := auth.uid();
  u_plan text;
  u_role text;
  u_status text;
  free_lim integer;
  pro_lim integer;
  daily_lim integer;
  used_cnt integer;
  oldest_ts timestamptz;
  reset_mins integer;
BEGIN
  IF uid IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  -- Lock user row to prevent concurrent race-condition quota bypass
  SELECT plan, role, status INTO u_plan, u_role, u_status
  FROM public.user_profiles
  WHERE id = uid
  FOR UPDATE;

  IF u_status = 'suspended' THEN
    RAISE EXCEPTION 'Account suspended';
  END IF;

  SELECT free_daily_ai_limit, pro_daily_ai_limit INTO free_lim, pro_lim FROM public.app_config WHERE id = 'global';
  daily_lim := CASE
    WHEN u_role = 'admin' THEN 500
    WHEN u_plan = 'pro' THEN COALESCE(pro_lim, 50)
    ELSE COALESCE(free_lim, 3)
  END;

  SELECT count(*)::integer, min(created_at) INTO used_cnt, oldest_ts
  FROM public.analyses
  WHERE user_id = uid
    AND created_at >= (now() - interval '24 hours');

  IF used_cnt >= daily_lim THEN
    reset_mins := GREATEST(1, CEIL(EXTRACT(EPOCH FROM ((oldest_ts + interval '24 hours') - now())) / 60.0)::integer);
    RETURN jsonb_build_object(
      'allowed', false,
      'used24h', used_cnt,
      'limit24h', daily_lim,
      'remaining24h', 0,
      'resetsInMinutes', reset_mins
    );
  END IF;

  INSERT INTO public.analyses (
    id, user_id, symbol, coin_name, timeframe, analysis_type, verdict, verified_price, confidence_score, report
  ) VALUES (
    p_id, uid, p_symbol, p_coin_name, p_timeframe, p_analysis_type, p_verdict, p_verified_price, p_confidence_score, p_report
  );

  RETURN jsonb_build_object(
    'allowed', true,
    'used24h', used_cnt + 1,
    'limit24h', daily_lim,
    'remaining24h', GREATEST(0, daily_lim - (used_cnt + 1))
  );
END;
$$;

-- ----------------------------------------------------------------------------
-- 3. Enable Row Level Security (RLS) & Policies
-- ----------------------------------------------------------------------------

ALTER TABLE public.user_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_preferences ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.favorites ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.analyses ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.signals ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.signal_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.portfolios ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.portfolio_transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.price_alerts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.app_config ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.admin_audit_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.auth_failure_logs ENABLE ROW LEVEL SECURITY;

-- user_profiles
DROP POLICY IF EXISTS "profiles_select_own_or_admin" ON public.user_profiles;
CREATE POLICY "profiles_select_own_or_admin" ON public.user_profiles
  FOR SELECT USING (auth.uid() = id OR public.is_admin());

DROP POLICY IF EXISTS "profiles_update_own_or_admin" ON public.user_profiles;
CREATE POLICY "profiles_update_own_or_admin" ON public.user_profiles
  FOR UPDATE USING (auth.uid() = id OR public.is_admin())
  WITH CHECK (auth.uid() = id OR public.is_admin());

-- user_preferences
DROP POLICY IF EXISTS "prefs_owner_all" ON public.user_preferences;
CREATE POLICY "prefs_owner_all" ON public.user_preferences
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- favorites
DROP POLICY IF EXISTS "favorites_owner_all" ON public.favorites;
CREATE POLICY "favorites_owner_all" ON public.favorites
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- analyses
DROP POLICY IF EXISTS "analyses_select_own_or_admin" ON public.analyses;
CREATE POLICY "analyses_select_own_or_admin" ON public.analyses
  FOR SELECT USING (auth.uid() = user_id OR public.is_admin());

DROP POLICY IF EXISTS "analyses_insert_own" ON public.analyses;
CREATE POLICY "analyses_insert_own" ON public.analyses
  FOR INSERT WITH CHECK (auth.uid() = user_id);

-- signals (publicly readable market intelligence; strictly admin-managed writes)
DROP POLICY IF EXISTS "signals_select_all" ON public.signals;
CREATE POLICY "signals_select_all" ON public.signals
  FOR SELECT USING (true);

DROP POLICY IF EXISTS "signals_admin_insert" ON public.signals;
CREATE POLICY "signals_admin_insert" ON public.signals
  FOR INSERT WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS "signals_admin_update" ON public.signals;
CREATE POLICY "signals_admin_update" ON public.signals
  FOR UPDATE USING (public.is_admin()) WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS "signals_admin_delete" ON public.signals;
CREATE POLICY "signals_admin_delete" ON public.signals
  FOR DELETE USING (public.is_admin());

-- signal_events
DROP POLICY IF EXISTS "signal_events_select_all" ON public.signal_events;
CREATE POLICY "signal_events_select_all" ON public.signal_events
  FOR SELECT USING (true);

DROP POLICY IF EXISTS "signal_events_admin_write" ON public.signal_events;
CREATE POLICY "signal_events_admin_write" ON public.signal_events
  FOR ALL USING (public.is_admin()) WITH CHECK (public.is_admin());

-- portfolios
DROP POLICY IF EXISTS "portfolios_owner_all" ON public.portfolios;
CREATE POLICY "portfolios_owner_all" ON public.portfolios
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- portfolio_transactions
DROP POLICY IF EXISTS "portfolio_tx_owner_all" ON public.portfolio_transactions;
CREATE POLICY "portfolio_tx_owner_all" ON public.portfolio_transactions
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- price_alerts
DROP POLICY IF EXISTS "alerts_owner_all" ON public.price_alerts;
CREATE POLICY "alerts_owner_all" ON public.price_alerts
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- notifications (owners read & mark read; admins broadcast)
DROP POLICY IF EXISTS "notifications_owner_select" ON public.notifications;
CREATE POLICY "notifications_owner_select" ON public.notifications
  FOR SELECT USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "notifications_owner_update" ON public.notifications;
CREATE POLICY "notifications_owner_update" ON public.notifications
  FOR UPDATE USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "notifications_admin_insert" ON public.notifications;
CREATE POLICY "notifications_admin_insert" ON public.notifications
  FOR INSERT WITH CHECK (public.is_admin());

-- subscriptions
DROP POLICY IF EXISTS "subscriptions_select_own_or_admin" ON public.subscriptions;
CREATE POLICY "subscriptions_select_own_or_admin" ON public.subscriptions
  FOR SELECT USING (auth.uid() = user_id OR public.is_admin());

DROP POLICY IF EXISTS "subscriptions_admin_all" ON public.subscriptions;
CREATE POLICY "subscriptions_admin_all" ON public.subscriptions
  FOR ALL USING (public.is_admin()) WITH CHECK (public.is_admin());

-- app_config
DROP POLICY IF EXISTS "app_config_select_all" ON public.app_config;
CREATE POLICY "app_config_select_all" ON public.app_config
  FOR SELECT USING (true);

DROP POLICY IF EXISTS "app_config_admin_write" ON public.app_config;
CREATE POLICY "app_config_admin_write" ON public.app_config
  FOR ALL USING (public.is_admin()) WITH CHECK (public.is_admin());

-- admin_audit_logs & auth_failure_logs
DROP POLICY IF EXISTS "audit_logs_admin_only" ON public.admin_audit_logs;
CREATE POLICY "audit_logs_admin_only" ON public.admin_audit_logs
  FOR ALL USING (public.is_admin()) WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS "auth_failures_admin_only" ON public.auth_failure_logs;
CREATE POLICY "auth_failures_admin_only" ON public.auth_failure_logs
  FOR SELECT USING (public.is_admin());

DROP POLICY IF EXISTS "auth_failures_insert_any" ON public.auth_failure_logs;
CREATE POLICY "auth_failures_insert_any" ON public.auth_failure_logs
  FOR INSERT WITH CHECK (true);
