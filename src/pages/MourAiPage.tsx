import React, { useEffect, useState } from 'react';
import { Bot, History, ScanLine } from 'lucide-react';
import { useApp } from '../contexts/AppContext.tsx';
import { ApiError, apiFetch } from '../lib/api.ts';
import { formatTimestamp } from '../lib/formatters.ts';
import { AiReportView } from '../components/AiReportView.tsx';
import { ConfigNotice } from '../components/ConfigNotice.tsx';
import type { AiAnalysisReport, Timeframe } from '../types/trading.ts';

const TIMEFRAMES: Timeframe[] = ['1m', '5m', '15m', '1h', '4h', '1d', '1w'];

export function MourAiPage() {
  const { language, t, navigate, user, tickers, route, readiness } = useApp();
  const isAr = language === 'ar';

  const initialSymbol = new URLSearchParams(route.split('?')[1] || '').get('symbol')?.toUpperCase() || 'BTCUSDT';

  const [symbol, setSymbol] = useState(initialSymbol);
  const [timeframe, setTimeframe] = useState<Timeframe>('4h');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [missingVars, setMissingVars] = useState<string[] | undefined>(undefined);
  const [report, setReport] = useState<AiAnalysisReport | null>(null);
  const [history, setHistory] = useState<AiAnalysisReport[]>([]);
  const [quota, setQuota] = useState<{ used24h: number; limit24h: number; remaining24h: number } | null>(null);

  useEffect(() => {
    if (!user) return;
    apiFetch<{ used24h: number; limit24h: number; remaining24h: number }>('/api/ai/quota')
      .then(setQuota)
      .catch(() => {});
    apiFetch<{ analyses: AiAnalysisReport[] }>('/api/ai/history?limit=12')
      .then((res) => setHistory(res.analyses || []))
      .catch(() => {});
  }, [user]);

  const handleAnalyze = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) {
      navigate('/login');
      return;
    }
    setError(null);
    setMissingVars(undefined);
    setLoading(true);
    try {
      const res = await apiFetch<{
        report: AiAnalysisReport;
        quota: { used24h: number; limit24h: number; remaining24h: number };
      }>('/api/ai/analyze', {
        method: 'POST',
        body: JSON.stringify({ symbol: symbol.trim().toUpperCase(), timeframe, language }),
      });
      setReport(res.report);
      setQuota(res.quota);
      setHistory((prev) => [res.report, ...prev.filter((h) => h.id !== res.report.id)]);
    } catch (err) {
      if (err instanceof ApiError) {
        setError(err.message);
        setMissingVars(err.missingVars);
      } else {
        setError(err instanceof Error ? err.message : 'Analysis failed');
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-[#F8FAFC] flex items-center gap-2.5">
            <Bot className="w-6 h-6 text-[#D4AF37]" />
            <span>{t.ai.title}</span>
          </h1>
          <p className="text-xs text-slate-400 mt-1">{t.ai.disclaimer}</p>
        </div>

        <button
          onClick={() => navigate('/ai/vision')}
          className="min-h-[40px] px-4 py-2 rounded-xl border border-[#D4AF37]/35 bg-[#0D131F] hover:bg-[#D4AF37]/10 text-xs font-semibold text-[#E5C158] flex items-center gap-2 cursor-pointer"
        >
          <ScanLine className="w-4 h-4" />
          <span>{t.nav.vision}</span>
        </button>
      </div>

      {readiness && (!readiness.geminiAi.configured || !readiness.supabase.configured || !readiness.supabase.schemaReady) && (
        <ConfigNotice
          title={isAr ? 'يتطلب تهيئة Gemini و Supabase للتحليل الموثق' : 'Gemini & Supabase Configuration Required'}
          message={
            readiness.supabase.error ||
            (isAr
              ? 'تشغيل محرك Mour AI وحفظ سجل التحليلات في Supabase وتطبيق الحد اليومي (3 تحليلات / 24 ساعة) يتطلب توفر المفاتيح التالية.'
              : 'Running Mour AI, persisting analysis history in Supabase PostgreSQL, and enforcing the 3/24h rolling quota require these env vars.')
          }
          missingVars={[...readiness.geminiAi.missingVars, ...readiness.supabase.missingVars]}
        />
      )}

      {/* Analysis Request Form */}
      <form
        onSubmit={handleAnalyze}
        className="bg-[#0D131F] border border-white/10 rounded-xl p-5 grid grid-cols-1 md:grid-cols-4 gap-4 items-end"
      >
        <div className="space-y-1.5">
          <label className="block text-xs text-slate-300 font-medium">{t.ai.selectPair}</label>
          <input
            type="text"
            list="mour-spot-pairs"
            dir="ltr"
            value={symbol}
            onChange={(e) => setSymbol(e.target.value.toUpperCase())}
            placeholder="BTCUSDT"
            className="w-full min-h-[44px] px-3.5 rounded-xl bg-[#070A0F] border border-white/12 text-sm font-mono-num text-[#F8FAFC] focus:outline-none focus:border-[#D4AF37]"
          />
          <datalist id="mour-spot-pairs">
            {tickers.slice(0, 120).map((tk) => (
              <option key={tk.symbol} value={tk.symbol} />
            ))}
          </datalist>
        </div>

        <div className="space-y-1.5">
          <label className="block text-xs text-slate-300 font-medium">{t.ai.selectTf}</label>
          <select
            value={timeframe}
            onChange={(e) => setTimeframe(e.target.value as Timeframe)}
            dir="ltr"
            className="w-full min-h-[44px] px-3.5 rounded-xl bg-[#070A0F] border border-white/12 text-sm font-mono-num text-[#F8FAFC] focus:outline-none focus:border-[#D4AF37]"
          >
            {TIMEFRAMES.map((tf) => (
              <option key={tf} value={tf}>
                {tf.toUpperCase()}
              </option>
            ))}
          </select>
        </div>

        <div className="space-y-1.5">
          <div className="text-xs text-slate-400">{t.ai.quotaLabel}</div>
          <div className="min-h-[44px] px-3.5 rounded-xl bg-[#070A0F] border border-white/8 flex items-center justify-between font-mono-num text-sm">
            <span className="text-slate-300">
              {quota ? `${quota.remaining24h} / ${quota.limit24h}` : user ? '—' : '3 / 24h'}
            </span>
            <span className="text-xs text-[#D4AF37]">
              {user ? user.plan.toUpperCase() : isAr ? 'يتطلب دخول' : 'Login Req.'}
            </span>
          </div>
        </div>

        <button
          type="submit"
          disabled={loading}
          className="w-full min-h-[44px] px-5 rounded-xl bg-[#D4AF37] hover:bg-[#E5C158] disabled:opacity-50 text-[#070A0F] font-bold text-sm transition-colors cursor-pointer"
        >
          {loading ? t.ai.analyzing : user ? t.ai.runAnalysis : t.nav.login}
        </button>
      </form>

      {error && (
        <div className="p-4 rounded-xl bg-[#EF4444]/10 border border-[#EF4444]/30 text-sm text-[#EF4444] space-y-1">
          <div>{error}</div>
          {missingVars && missingVars.length > 0 && (
            <div className="text-xs font-mono-num text-slate-300" dir="ltr">
              Missing env: {missingVars.join(', ')}
            </div>
          )}
        </div>
      )}

      {report && <AiReportView report={report} />}

      {/* Saved Supabase History */}
      {user && (
        <div className="bg-[#0D131F] border border-white/10 rounded-xl p-5 space-y-4">
          <h2 className="text-base font-bold text-[#F8FAFC] flex items-center gap-2">
            <History className="w-4 h-4 text-[#D4AF37]" />
            <span>{isAr ? 'سجل تحليلات Mour AI المحفوظة' : 'Saved Mour AI Analysis History'}</span>
          </h2>

          {history.length === 0 ? (
            <p className="text-xs text-slate-400">
              {isAr ? 'لا توجد تحليلات محفوظة بعد.' : 'No saved analyses yet.'}
            </p>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
              {history.map((item) => (
                <button
                  key={item.id}
                  onClick={() => setReport(item)}
                  className="text-start p-3.5 rounded-xl bg-[#070A0F] border border-white/8 hover:border-[#D4AF37]/40 transition-colors space-y-1.5 cursor-pointer"
                >
                  <div className="flex items-center justify-between font-mono-num text-xs">
                    <span className="font-bold text-[#F8FAFC]">
                      {item.symbol} · {item.timeframe.toUpperCase()}
                    </span>
                    <span
                      className={
                        item.verdict === 'BUY'
                          ? 'text-[#10B981]'
                          : item.verdict === 'AVOID'
                            ? 'text-[#EF4444]'
                            : 'text-[#E5C158]'
                      }
                    >
                      {item.verdict}
                    </span>
                  </div>
                  <div className="text-[11px] text-slate-400 font-mono-num">
                    {formatTimestamp(item.createdAt, language)}
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
