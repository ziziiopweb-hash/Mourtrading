import React, { useEffect, useState } from 'react';
import { Activity, AlertTriangle, ShieldCheck, Signal } from 'lucide-react';
import { useApp } from '../contexts/AppContext.tsx';
import { apiFetch } from '../lib/api.ts';
import { formatPercent, formatPrice, formatTimestamp } from '../lib/formatters.ts';
import { ConfigNotice } from '../components/ConfigNotice.tsx';
import type { SignalEvent, TradingSignal } from '../types/trading.ts';

export function SignalsPage() {
  const { language, t, navigate, tickerMap, readiness } = useApp();
  const isAr = language === 'ar';

  const [statusFilter, setStatusFilter] = useState<'ALL' | 'ACTIVE' | 'COMPLETED'>('ALL');
  const [sourceFilter, setSourceFilter] = useState<'ALL' | 'ADMIN' | 'AI'>('ALL');
  const [signals, setSignals] = useState<Array<TradingSignal & { livePrice?: number | null }>>([]);
  const [events, setEvents] = useState<SignalEvent[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    apiFetch<{ signals: TradingSignal[]; events: SignalEvent[] }>(
      `/api/signals?status=${statusFilter}&source=${sourceFilter}`,
    )
      .then((res) => {
        setSignals(res.signals || []);
        setEvents(res.events || []);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [statusFilter, sourceFilter]);

  const statusColor = (status: string) => {
    if (status === 'TP1_HIT' || status === 'TP2_HIT' || status === 'TP3_HIT') return 'text-[#10B981]';
    if (status === 'STOP_LOSS_HIT') return 'text-[#EF4444]';
    if (status === 'CANCELLED') return 'text-slate-400';
    return 'text-[#E5C158]';
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-[#F8FAFC] flex items-center gap-2.5">
            <Signal className="w-6 h-6 text-[#D4AF37]" />
            <span>{t.nav.signals}</span>
          </h1>
          <p className="text-xs text-slate-400 mt-1">
            {isAr
              ? 'إشارات Spot مراقبة خادمياً مقابل أسعار Binance الحية مع سجل تنفيذ غير قابل للتلاعب'
              : 'Backend-monitored Spot signals tracked against live Binance prices with transparent execution history'}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-1 p-1 bg-[#0D131F] border border-white/10 rounded-xl">
            {(['ALL', 'ACTIVE', 'COMPLETED'] as const).map((s) => (
              <button
                key={s}
                onClick={() => setStatusFilter(s)}
                className={`px-3 py-1.5 text-xs rounded-lg cursor-pointer ${
                  statusFilter === s ? 'bg-[#D4AF37] text-[#070A0F] font-bold' : 'text-slate-400'
                }`}
              >
                {s === 'ALL' ? (isAr ? 'الكل' : 'All') : s === 'ACTIVE' ? (isAr ? 'النشطة' : 'Active') : isAr ? 'المكتملة' : 'Completed'}
              </button>
            ))}
          </div>

          <div className="flex items-center gap-1 p-1 bg-[#0D131F] border border-white/10 rounded-xl">
            {(['ALL', 'ADMIN', 'AI'] as const).map((src) => (
              <button
                key={src}
                onClick={() => setSourceFilter(src)}
                className={`px-3 py-1.5 text-xs rounded-lg cursor-pointer ${
                  sourceFilter === src ? 'bg-white/12 text-[#F8FAFC] font-semibold' : 'text-slate-400'
                }`}
              >
                {src === 'ALL' ? (isAr ? 'جميع المصادر' : 'All Sources') : src}
              </button>
            ))}
          </div>
        </div>
      </div>

      {readiness && (!readiness.supabase.configured || !readiness.supabase.schemaReady) && (
        <ConfigNotice
          message={
            readiness.supabase.error ||
            (isAr
              ? 'حفظ ومراقبة إشارات التداول يتطلب إعداد متغيرات Supabase وتشغيل supabase/schema.sql.'
              : 'Storing and monitoring Spot signals requires configuring Supabase environment variables and running supabase/schema.sql.')
          }
          missingVars={readiness.supabase.missingVars}
        />
      )}

      {loading ? (
        <div className="py-12 text-center text-sm text-slate-400">{t.common.loading}</div>
      ) : signals.length === 0 ? (
        <div className="bg-[#0D131F] border border-white/10 rounded-xl p-10 text-center space-y-3">
          <Activity className="w-8 h-8 text-[#D4AF37] mx-auto" />
          <p className="text-sm text-slate-300">
            {isAr ? 'لا توجد إشارات مطابقة للتصفية الحالية.' : 'No signals match the selected filter.'}
          </p>
          <p className="text-xs text-slate-500">
            {isAr
              ? 'لا يتم توليد أو عرض أي نسب نجاح تاريخية وهمية. الإشارات تظهر فقط عند نشرها من الإدارة أو اعتمادها.'
              : 'MourTrading never fabricates historical win rates. Signals appear here once published by Admin or verified.'}
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
          {signals.map((sig) => {
            const livePrice = tickerMap.get(sig.symbol)?.lastPrice ?? sig.livePrice ?? null;
            return (
              <div key={sig.id} className="bg-[#0D131F] border border-white/10 rounded-xl p-5 space-y-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="flex items-center gap-2 text-xs text-slate-400">
                      <span className="inline-flex items-center gap-1 text-[#D4AF37] font-semibold">
                        <ShieldCheck className="w-3.5 h-3.5" />
                        {sig.source === 'ADMIN' ? (isAr ? 'إشارة رسمية من الإدارة' : 'Official Admin Signal') : 'AI Signal'}
                      </span>
                      <span aria-hidden="true">·</span>
                      <span className="font-mono-num uppercase">{sig.timeframe}</span>
                      <span aria-hidden="true">·</span>
                      <span className="font-mono-num">{formatTimestamp(sig.createdAt, language)}</span>
                    </div>
                    <button
                      onClick={() => navigate(`/coin/${sig.symbol}`)}
                      className="text-lg font-bold font-mono-num text-[#F8FAFC] hover:text-[#D4AF37] mt-1 cursor-pointer"
                    >
                      {sig.symbol}
                    </button>
                  </div>

                  <div className="text-end">
                    <div className={`text-sm font-mono-num font-bold ${statusColor(sig.status)}`}>{sig.status}</div>
                    {typeof sig.actualResultPercent === 'number' && (
                      <div
                        className={`text-xs font-mono-num ${
                          sig.actualResultPercent >= 0 ? 'text-[#10B981]' : 'text-[#EF4444]'
                        }`}
                      >
                        {formatPercent(sig.actualResultPercent)}
                      </div>
                    )}
                  </div>
                </div>

                <div className="grid grid-cols-3 sm:grid-cols-6 gap-2 font-mono-num text-xs">
                  <div className="p-2 rounded bg-[#070A0F]">
                    <div className="text-slate-500">Entry</div>
                    <div className="text-slate-200 font-semibold mt-0.5">
                      {formatPrice(sig.entryLow)}–{formatPrice(sig.entryHigh)}
                    </div>
                  </div>
                  <div className="p-2 rounded bg-[#070A0F]">
                    <div className="text-slate-500">TP1</div>
                    <div className="text-[#10B981] font-semibold mt-0.5">{formatPrice(sig.tp1)}</div>
                  </div>
                  <div className="p-2 rounded bg-[#070A0F]">
                    <div className="text-slate-500">TP2</div>
                    <div className="text-[#10B981] font-semibold mt-0.5">{formatPrice(sig.tp2)}</div>
                  </div>
                  <div className="p-2 rounded bg-[#070A0F]">
                    <div className="text-slate-500">TP3</div>
                    <div className="text-[#10B981] font-semibold mt-0.5">{formatPrice(sig.tp3)}</div>
                  </div>
                  <div className="p-2 rounded bg-[#070A0F]">
                    <div className="text-slate-500">SL</div>
                    <div className="text-[#EF4444] font-semibold mt-0.5">{formatPrice(sig.stopLoss)}</div>
                  </div>
                  <div className="p-2 rounded bg-[#070A0F]">
                    <div className="text-slate-500">Live</div>
                    <div className="text-[#E5C158] font-semibold mt-0.5">
                      {livePrice ? formatPrice(livePrice) : '—'}
                    </div>
                  </div>
                </div>

                <p className="text-xs text-slate-300 leading-relaxed">{sig.explanation}</p>

                {sig.ambiguityNote && (
                  <div className="p-2.5 rounded-lg bg-[#D4AF37]/10 border border-[#D4AF37]/30 text-[11px] text-[#E5C158] flex items-center gap-2">
                    <AlertTriangle className="w-4 h-4 shrink-0" />
                    <span>{sig.ambiguityNote}</span>
                  </div>
                )}

                <div className="text-[11px] font-mono-num text-slate-400 flex justify-between border-t border-white/6 pt-2">
                  <span>R:R 1 : {sig.riskRewardRatio}</span>
                  <span>{formatTimestamp(sig.updatedAt, language)}</span>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {events.length > 0 && (
        <div className="bg-[#0D131F] border border-white/10 rounded-xl p-5 space-y-3">
          <h2 className="text-sm font-bold text-[#F8FAFC]">
            {isAr ? 'سجل أحداث الإشارات الموثق' : 'Immutable Signal Execution Events'}
          </h2>
          <div className="divide-y divide-white/6 text-xs font-mono-num">
            {events.slice(0, 15).map((ev) => (
              <div key={ev.id} className="py-2.5 flex flex-wrap items-center justify-between gap-2">
                <span className="font-bold text-[#F8FAFC]">{ev.symbol}</span>
                <span className={statusColor(ev.eventType)}>{ev.eventType}</span>
                <span className="text-slate-300">${formatPrice(ev.triggerPrice)}</span>
                <span className={ev.resultPercent >= 0 ? 'text-[#10B981]' : 'text-[#EF4444]'}>
                  {formatPercent(ev.resultPercent)}
                </span>
                <span className="text-slate-500">{formatTimestamp(ev.occurredAt, language)}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
