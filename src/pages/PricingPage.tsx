import React, { useEffect, useState } from 'react';
import { Check, CreditCard, Info } from 'lucide-react';
import { useApp } from '../contexts/AppContext.tsx';
import { ApiError, apiFetch } from '../lib/api.ts';
import type { AppConfig } from '../types/trading.ts';

export function PricingPage() {
  const { language, t, navigate, user } = useApp();
  const isAr = language === 'ar';

  const [config, setConfig] = useState<AppConfig | null>(null);
  const [gatewayConfigured, setGatewayConfigured] = useState(false);
  const [cycle, setCycle] = useState<'monthly' | 'annual'>('monthly');
  const [statusMsg, setStatusMsg] = useState<string | null>(null);

  useEffect(() => {
    apiFetch<{ config: AppConfig; paymentGatewayConfigured: boolean }>('/api/user/plans')
      .then((res) => {
        setConfig(res.config);
        setGatewayConfigured(res.paymentGatewayConfigured);
      })
      .catch(() => {});
  }, []);

  const handleUpgrade = async () => {
    if (!user) {
      navigate('/login');
      return;
    }
    setStatusMsg(null);
    try {
      await apiFetch('/api/user/subscription/checkout', {
        method: 'POST',
        body: JSON.stringify({ cycle }),
      });
    } catch (err) {
      if (err instanceof ApiError) {
        setStatusMsg(err.message);
      }
    }
  };

  const freeLimit = config?.freeDailyAiLimit ?? 3;
  const proLimit = config?.proDailyAiLimit ?? 50;
  const priceDisplay = cycle === 'monthly' ? config?.proMonthlyPriceUsd ?? 29 : config?.proAnnualPriceUsd ?? 290;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-[#F8FAFC] flex items-center gap-2.5">
            <CreditCard className="w-6 h-6 text-[#D4AF37]" />
            <span>{t.nav.pricing}</span>
          </h1>
          <p className="text-xs text-slate-400 mt-1">
            {isAr
              ? 'الحدود والأسعار قابلة للتعديل المباشر من قبل إدارة المنصة.'
              : 'Usage limits and pricing are dynamically managed from the Admin Console.'}
          </p>
        </div>

        <div className="flex items-center gap-1 p-1 bg-[#0D131F] border border-white/10 rounded-xl">
          <button
            onClick={() => setCycle('monthly')}
            className={`px-3 py-1.5 text-xs rounded-lg cursor-pointer ${
              cycle === 'monthly' ? 'bg-[#D4AF37] text-[#070A0F] font-bold' : 'text-slate-400'
            }`}
          >
            {isAr ? 'شهري' : 'Monthly'}
          </button>
          <button
            onClick={() => setCycle('annual')}
            className={`px-3 py-1.5 text-xs rounded-lg cursor-pointer ${
              cycle === 'annual' ? 'bg-[#D4AF37] text-[#070A0F] font-bold' : 'text-slate-400'
            }`}
          >
            {isAr ? 'سنوي' : 'Annual'}
          </button>
        </div>
      </div>

      {!gatewayConfigured && (
        <div className="p-4 rounded-xl bg-[#0D131F] border border-[#D4AF37]/30 text-xs text-[#E5C158] flex items-start gap-2.5">
          <Info className="w-4 h-4 shrink-0 mt-0.5" />
          <span>
            {isAr
              ? 'حالة الدفع: بوابة الدفع قيد الإعداد (Pending Payment Provider Integration). لا يتم تنفيذ مدفوعات وهمية حتى ربط مزود دفع فعلي أو تفعيل الخطة من المسؤول.'
              : 'Payment Integration Status: Pending external payment provider configuration (STRIPE_SECRET_KEY). No simulated payments are processed.'}
          </span>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* FREE PLAN */}
        <div className="bg-[#0D131F] border border-white/10 rounded-2xl p-6 space-y-5 flex flex-col justify-between">
          <div className="space-y-3">
            <div className="text-xs font-semibold text-slate-400">FREE PLAN</div>
            <div className="text-3xl font-bold font-mono-num text-[#F8FAFC]">$0</div>
            <p className="text-xs text-slate-400">
              {isAr ? `${freeLimit} تحليلات ذكاء اصطناعي كل 24 ساعة` : `${freeLimit} AI Analyses per rolling 24h`}
            </p>
            <ul className="space-y-2.5 pt-2 text-sm text-slate-300">
              {(config?.freeFeatures || []).map((f, i) => (
                <li key={i} className="flex items-center gap-2">
                  <Check className="w-4 h-4 text-[#10B981] shrink-0" />
                  <span>{f}</span>
                </li>
              ))}
            </ul>
          </div>

          <button
            onClick={() => navigate(user ? '/dashboard' : '/register')}
            className="w-full min-h-[44px] rounded-xl border border-white/15 bg-[#070A0F] text-sm font-semibold text-slate-200 cursor-pointer"
          >
            {user?.plan === 'free'
              ? isAr
                ? 'خطتك الحالية'
                : 'Current Plan'
              : isAr
                ? 'ابدأ مجاناً'
                : 'Get Started Free'}
          </button>
        </div>

        {/* PRO PLAN */}
        <div className="bg-[#0D131F] border border-[#D4AF37]/45 rounded-2xl p-6 space-y-5 flex flex-col justify-between">
          <div className="space-y-3">
            <div className="text-xs font-semibold text-[#D4AF37]">PRO PLAN</div>
            <div className="text-3xl font-bold font-mono-num text-[#F8FAFC]">
              ${priceDisplay}{' '}
              <span className="text-xs font-normal text-slate-400">
                / {cycle === 'monthly' ? (isAr ? 'شهر' : 'month') : isAr ? 'سنة' : 'year'}
              </span>
            </div>
            <p className="text-xs text-[#E5C158]">
              {isAr ? `${proLimit} تحليل ذكاء اصطناعي كل 24 ساعة` : `${proLimit} AI Analyses per rolling 24h`}
            </p>
            <ul className="space-y-2.5 pt-2 text-sm text-slate-200">
              {(config?.proFeatures || []).map((f, i) => (
                <li key={i} className="flex items-center gap-2">
                  <Check className="w-4 h-4 text-[#D4AF37] shrink-0" />
                  <span>{f}</span>
                </li>
              ))}
            </ul>
          </div>

          <button
            onClick={handleUpgrade}
            className="w-full min-h-[44px] rounded-xl bg-[#D4AF37] hover:bg-[#E5C158] text-[#070A0F] text-sm font-bold cursor-pointer"
          >
            {user?.plan === 'pro'
              ? isAr
                ? 'مفعّلة (PRO)'
                : 'Active (PRO)'
              : isAr
                ? 'طلب الترقية إلى Pro'
                : 'Request Pro Upgrade'}
          </button>
        </div>
      </div>

      {statusMsg && (
        <div className="p-4 rounded-xl bg-[#0D131F] border border-[#D4AF37]/40 text-xs text-[#E5C158]">
          {statusMsg}
        </div>
      )}
    </div>
  );
}
