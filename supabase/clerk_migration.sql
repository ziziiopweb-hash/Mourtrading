-- ============================================================================
-- MourTrading — Non-Destructive Clerk + Supabase Migration Script
-- Safe to run on an EXISTING Supabase PostgreSQL database with live data.
-- NEVER drops tables or removes existing user rows.
-- Run this in Supabase Dashboard -> SQL Editor.
-- ============================================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- 1. Link Clerk User IDs cleanly to existing user_profiles (preserves existing UUIDs & data)
ALTER TABLE public.user_profiles
  ADD COLUMN IF NOT EXISTS clerk_user_id text UNIQUE;

CREATE INDEX IF NOT EXISTS idx_user_profiles_clerk_id
  ON public.user_profiles(clerk_user_id);

-- 2. Drop legacy auth.users foreign-key constraints so new Clerk users can be
--    created in user_profiles & child tables without needing auth.users rows.
ALTER TABLE public.user_profiles DROP CONSTRAINT IF EXISTS user_profiles_id_fkey;
ALTER TABLE public.user_preferences DROP CONSTRAINT IF EXISTS user_preferences_user_id_fkey;
ALTER TABLE public.favorites DROP CONSTRAINT IF EXISTS favorites_user_id_fkey;
ALTER TABLE public.analyses DROP CONSTRAINT IF EXISTS analyses_user_id_fkey;
ALTER TABLE public.signals DROP CONSTRAINT IF EXISTS signals_created_by_fkey;
ALTER TABLE public.portfolios DROP CONSTRAINT IF EXISTS portfolios_user_id_fkey;
ALTER TABLE public.portfolio_transactions DROP CONSTRAINT IF EXISTS portfolio_transactions_user_id_fkey;
ALTER TABLE public.price_alerts DROP CONSTRAINT IF EXISTS price_alerts_user_id_fkey;
ALTER TABLE public.notifications DROP CONSTRAINT IF EXISTS notifications_user_id_fkey;
ALTER TABLE public.subscriptions DROP CONSTRAINT IF EXISTS subscriptions_user_id_fkey;
ALTER TABLE public.admin_audit_logs DROP CONSTRAINT IF EXISTS admin_audit_logs_admin_uid_fkey;

-- 3. Server-side Atomic AI Quota Check & Persistence RPCs (scoped by explicit p_user_id)
CREATE OR REPLACE FUNCTION public.get_user_ai_quota(p_user_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  u_plan text;
  u_role text;
  free_lim integer;
  pro_lim integer;
  daily_lim integer;
  used_cnt integer;
BEGIN
  IF p_user_id IS NULL THEN
    RAISE EXCEPTION 'User ID required';
  END IF;

  SELECT plan, role INTO u_plan, u_role FROM public.user_profiles WHERE id = p_user_id;
  SELECT free_daily_ai_limit, pro_daily_ai_limit INTO free_lim, pro_lim FROM public.app_config WHERE id = 'global';

  daily_lim := CASE
    WHEN u_role = 'admin' THEN 500
    WHEN u_plan = 'pro' THEN COALESCE(pro_lim, 50)
    ELSE COALESCE(free_lim, 3)
  END;

  SELECT count(*)::integer INTO used_cnt
  FROM public.analyses
  WHERE user_id = p_user_id
    AND created_at >= (now() - interval '24 hours');

  RETURN jsonb_build_object(
    'plan', COALESCE(u_plan, 'free'),
    'used24h', used_cnt,
    'limit24h', daily_lim,
    'remaining24h', GREATEST(0, daily_lim - used_cnt)
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.save_verified_user_ai_analysis(
  p_user_id uuid,
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
  IF p_user_id IS NULL THEN
    RAISE EXCEPTION 'User ID required';
  END IF;

  SELECT plan, role, status INTO u_plan, u_role, u_status
  FROM public.user_profiles
  WHERE id = p_user_id
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
  WHERE user_id = p_user_id
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
    p_id, p_user_id, p_symbol, p_coin_name, p_timeframe, p_analysis_type, p_verdict, p_verified_price, p_confidence_score, p_report
  );

  RETURN jsonb_build_object(
    'allowed', true,
    'used24h', used_cnt + 1,
    'limit24h', daily_lim,
    'remaining24h', GREATEST(0, daily_lim - (used_cnt + 1))
  );
END;
$$;
