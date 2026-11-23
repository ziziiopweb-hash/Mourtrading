import React from 'react';
import {
  AlertCircle,
  ArrowDownRight,
  ArrowUpRight,
  CheckCircle2,
  Clock,
  ShieldAlert,
  TrendingUp,
} from 'lucide-react';
import { useApp } from '../contexts/AppContext.tsx';
import { formatPercent, formatPrice, formatTimestamp } from '../lib/formatters.ts';
import type { AiAnalysisReport } from '../types/trading.ts';

export function AiReportView({ report }: { report: AiAnalysisReport }) {
  const { language, navigate } = useApp();
  const isAr = language === 'ar';

  const verdictStyles =
    report.verdict === 'BUY'
      ? 'bg-[#10B981]/12 border-[#10B981]/40 text-[#10B981]'
      : report.verdict === 'AVOID'
        ? 'bg-[#EF4444]/12 border-[#EF4444]/40 text-[#EF4444]'
        : 'bg-[#D4AF37]/12 border-[#D4AF37]/40 text-[#E5C158]';

  const verdictText =
    report.verdict === 'BUY'
      ? isAr
        ? 'BUY — فرصة شراء فوري مبررة'
        : 'BUY — Justified Spot Setup'
      : report.verdict === 'AVOID'
        ? isAr
          ? 'AVOID — يُنصح بتجنب الصفقة حالياً'
          : 'AVOID — Unfavorable Risk Profile'
        : isAr
          ? 'WAIT — انتظار تأكيد إضافي'
          : 'WAIT — Await Confirmation';

  return (
    <div className="space-y-6">
      {/* Header Verdict Banner */}
      <div className="bg-[#0D131F] border border-white/10 rounded-xl p-5 space-y-4">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="space-y-1">
            <div className="flex items-center gap-2 text-xs text-slate-400">
              <span className="font-mono-num text-[#D4AF37] font-semibold">{report.symbol}</span>
              <span aria-hidden="true">·</span>
              <span className="font-mono-num uppercase">{report.timeframe}</span>
              <span aria-hidden="true">·</span>
              <span>{report.dataSource}</span>
              <span aria-hidden="true">·</span>
              <span className="inline-flex items-center gap-1 font-mono-num">
                <Clock className="w-3 h-3" />
                {formatTimestamp(report.dataTimestamp, language)}
              </span>
            </div>
            <h2 className="text-xl font-bold text-[#F8FAFC]">
              {report.coinName} ({report.symbol})
            </h2>
            <div className="flex flex-wrap items-center gap-4 text-sm text-slate-300 pt-1">
              <span>
                {isAr ? 'السعر الموثق:' : 'Verified Price:'}{' '}
                <strong className="font-mono-num text-[#F8FAFC]">
                  {report.verifiedPrice > 0 ? `$${formatPrice(report.verifiedPrice)}` : '—'}
                </strong>
              </span>
              <span aria-hidden="true" className="text-slate-600">|</span>
              <span>
                {isAr ? 'الاتجاه العام:' : 'Direction:'} <strong>{report.overallDirection}</strong>
              </span>
              <span aria-hidden="true" className="text-slate-600">|</span>
              <span>
                {isAr ? 'قوة الاتجاه:' : 'Strength:'} <strong>{report.trendStrength}</strong>
              </span>
            </div>
          </div>

          <div className={`px-4 py-2.5 rounded-lg border text-sm font-bold whitespace-nowrap ${verdictStyles}`}>
            {verdictText}
          </div>
        </div>

        {report.needsUserConfirmation && (
          <div className="bg-[#D4AF37]/10 border border-[#D4AF37]/30 rounded-lg p-3 text-xs text-[#E5C158] flex items-center gap-2">
            <AlertCircle className="w-4 h-4 shrink-0" />
            <span>
              {isAr
                ? 'التعرف على صورة الشارت غير مؤكد تماماً. يرجى تأكيد الزوج والإطار الزمني أعلاه وإعادة التحليل للحصول على تحقق سعري حي.'
                : 'Chart symbol recognition has low certainty. Please confirm the pair and timeframe above and re-run for live price verification.'}
            </span>
          </div>
        )}
      </div>

      {/* Key Trade Levels Grid */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
        <div className="bg-[#0D131F] border border-white/10 rounded-xl p-3.5">
          <div className="text-xs text-slate-400 mb-1">{isAr ? 'منطقة الدخول' : 'Entry Zone'}</div>
          <div className="font-mono-num text-sm font-semibold text-[#F8FAFC]">
            {report.entryZone.justified && report.entryZone.low && report.entryZone.high
              ? `${formatPrice(report.entryZone.low)} – ${formatPrice(report.entryZone.high)}`
              : isAr
                ? 'غير مبرر حالياً'
                : 'Not Justified'}
          </div>
        </div>

        <div className="bg-[#0D131F] border border-white/10 rounded-xl p-3.5">
          <div className="text-xs text-slate-400 mb-1">TP1</div>
          <div className="font-mono-num text-sm font-semibold text-[#10B981]">
            {report.tp1 ? formatPrice(report.tp1) : '—'}
          </div>
          {report.potentialProfitPercent.tp1 !== null && (
            <div className="text-[11px] font-mono-num text-[#10B981]/80 mt-0.5">
              {formatPercent(report.potentialProfitPercent.tp1)}
            </div>
          )}
        </div>

        <div className="bg-[#0D131F] border border-white/10 rounded-xl p-3.5">
          <div className="text-xs text-slate-400 mb-1">TP2</div>
          <div className="font-mono-num text-sm font-semibold text-[#10B981]">
            {report.tp2 ? formatPrice(report.tp2) : '—'}
          </div>
          {report.potentialProfitPercent.tp2 !== null && (
            <div className="text-[11px] font-mono-num text-[#10B981]/80 mt-0.5">
              {formatPercent(report.potentialProfitPercent.tp2)}
            </div>
          )}
        </div>

        <div className="bg-[#0D131F] border border-white/10 rounded-xl p-3.5">
          <div className="text-xs text-slate-400 mb-1">TP3</div>
          <div className="font-mono-num text-sm font-semibold text-[#10B981]">
            {report.tp3 ? formatPrice(report.tp3) : '—'}
          </div>
          {report.potentialProfitPercent.tp3 !== null && (
            <div className="text-[11px] font-mono-num text-[#10B981]/80 mt-0.5">
              {formatPercent(report.potentialProfitPercent.tp3)}
            </div>
          )}
        </div>

        <div className="bg-[#0D131F] border border-white/10 rounded-xl p-3.5">
          <div className="text-xs text-slate-400 mb-1">{isAr ? 'وقف الخسارة' : 'Stop Loss'}</div>
          <div className="font-mono-num text-sm font-semibold text-[#EF4444]">
            {report.stopLoss ? formatPrice(report.stopLoss) : '—'}
          </div>
          {report.potentialLossPercent !== null && (
            <div className="text-[11px] font-mono-num text-[#EF4444]/80 mt-0.5">
              {formatPercent(report.potentialLossPercent)}
            </div>
          )}
        </div>

        <div className="bg-[#0D131F] border border-white/10 rounded-xl p-3.5">
          <div className="text-xs text-slate-400 mb-1">{isAr ? 'العائد / المخاطرة' : 'Risk / Reward'}</div>
          <div className="font-mono-num text-sm font-semibold text-[#E5C158]">
            {report.riskRewardRatio ? `1 : ${report.riskRewardRatio}` : '—'}
          </div>
          <div className="text-[11px] text-slate-400 mt-0.5">
            {isAr ? 'المخاطرة:' : 'Risk:'} {report.riskLevel}
          </div>
        </div>
      </div>

      {/* Technical Analysis & Support / Resistance */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        <div className="lg:col-span-2 bg-[#0D131F] border border-white/10 rounded-xl p-5 space-y-4">
          <h3 className="text-base font-semibold text-[#F8FAFC] flex items-center gap-2">
            <TrendingUp className="w-4 h-4 text-[#D4AF37]" />
            {isAr ? 'التحليل الفني المفصل' : 'Detailed Technical Analysis'}
          </h3>
          <p className="text-sm text-slate-300 leading-relaxed whitespace-pre-line">
            {report.technicalAnalysis}
          </p>

          {report.entryZone.note && (
            <div className="text-xs text-slate-400 pt-2 border-t border-white/8">
              <strong className="text-slate-200">{isAr ? 'ملاحظة الدخول:' : 'Entry Note:'}</strong>{' '}
              {report.entryZone.note}
            </div>
          )}

          <div className="pt-2 border-t border-white/8 flex flex-wrap items-center justify-between gap-2 text-xs text-slate-400">
            <span>
              {isAr ? 'مستوى إبطال السيناريو (Invalidation):' : 'Trade Invalidation Level:'}{' '}
              <strong className="font-mono-num text-[#EF4444]">
                {report.invalidationLevel ? formatPrice(report.invalidationLevel) : '—'}
              </strong>
            </span>
            {report.symbol !== 'UNKNOWN' && (
              <button
                onClick={() => navigate(`/coin/${report.symbol}`)}
                className="text-[#D4AF37] hover:underline font-medium cursor-pointer"
              >
                {isAr ? `عرض شارت ${report.symbol} الحي` : `Open Live ${report.symbol} Chart`}
              </button>
            )}
          </div>
        </div>

        <div className="bg-[#0D131F] border border-white/10 rounded-xl p-5 space-y-4">
          <div>
            <h4 className="text-xs font-semibold text-[#10B981] mb-2">
              {isAr ? 'مستويات الدعم الرئيسية' : 'Key Support Levels'}
            </h4>
            <div className="space-y-1.5 font-mono-num text-sm">
              {report.supportLevels.length > 0 ? (
                report.supportLevels.map((lvl, idx) => (
                  <div key={idx} className="flex justify-between py-1 border-b border-white/6">
                    <span className="text-slate-400">S{idx + 1}</span>
                    <span className="text-[#10B981] font-medium">${formatPrice(lvl)}</span>
                  </div>
                ))
              ) : (
                <div className="text-xs text-slate-500">—</div>
              )}
            </div>
          </div>

          <div>
            <h4 className="text-xs font-semibold text-[#EF4444] mb-2">
              {isAr ? 'مستويات المقاومة الرئيسية' : 'Key Resistance Levels'}
            </h4>
            <div className="space-y-1.5 font-mono-num text-sm">
              {report.resistanceLevels.length > 0 ? (
                report.resistanceLevels.map((lvl, idx) => (
                  <div key={idx} className="flex justify-between py-1 border-b border-white/6">
                    <span className="text-slate-400">R{idx + 1}</span>
                    <span className="text-[#EF4444] font-medium">${formatPrice(lvl)}</span>
                  </div>
                ))
              ) : (
                <div className="text-xs text-slate-500">—</div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Bullish vs Bearish Scenarios */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
        <div className="bg-[#0D131F] border border-white/10 rounded-xl p-5 space-y-2">
          <div className="flex items-center gap-2 text-sm font-semibold text-[#10B981]">
            <ArrowUpRight className="w-4 h-4" />
            {isAr ? 'السيناريو الصاعد (Bullish)' : 'Bullish Scenario'}
          </div>
          <p className="text-sm text-slate-300 leading-relaxed">{report.bullishScenario}</p>
        </div>

        <div className="bg-[#0D131F] border border-white/10 rounded-xl p-5 space-y-2">
          <div className="flex items-center gap-2 text-sm font-semibold text-[#EF4444]">
            <ArrowDownRight className="w-4 h-4" />
            {isAr ? 'السيناريو الهابط (Bearish)' : 'Bearish Scenario'}
          </div>
          <p className="text-sm text-slate-300 leading-relaxed">{report.bearishScenario}</p>
        </div>
      </div>

      {/* Supporting vs Opposing Reasons */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
        <div className="bg-[#0D131F] border border-white/10 rounded-xl p-5 space-y-3">
          <h4 className="text-sm font-semibold text-[#F8FAFC]">
            {isAr ? 'الأسباب الداعمة للصفقة' : 'Reasons Supporting Trade'}
          </h4>
          <ul className="space-y-2 text-sm text-slate-300">
            {report.supportingReasons.map((r, i) => (
              <li key={i} className="flex items-start gap-2">
                <CheckCircle2 className="w-4 h-4 text-[#10B981] shrink-0 mt-0.5" />
                <span>{r}</span>
              </li>
            ))}
          </ul>
        </div>

        <div className="bg-[#0D131F] border border-white/10 rounded-xl p-5 space-y-3">
          <h4 className="text-sm font-semibold text-[#F8FAFC]">
            {isAr ? 'العوامل المعارضة والمخاطر' : 'Reasons Opposing / Risks'}
          </h4>
          <ul className="space-y-2 text-sm text-slate-300">
            {report.opposingReasons.map((r, i) => (
              <li key={i} className="flex items-start gap-2">
                <ShieldAlert className="w-4 h-4 text-[#EF4444] shrink-0 mt-0.5" />
                <span>{r}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>

      {/* Facts vs AI Interpretations + Confidence Heuristic + Limitations */}
      <div className="bg-[#0D131F] border border-white/10 rounded-xl p-5 space-y-4">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
          <div>
            <h4 className="text-xs font-semibold text-[#D4AF37] mb-2">
              {isAr ? 'حقائق سوقية موثقة (Binance Data)' : 'Verified Market Facts'}
            </h4>
            <ul className="space-y-1.5 text-xs text-slate-300 list-disc list-inside">
              {report.verifiedMarketFacts.map((f, i) => (
                <li key={i}>{f}</li>
              ))}
            </ul>
          </div>
          <div>
            <h4 className="text-xs font-semibold text-slate-300 mb-2">
              {isAr ? 'تقديرات وتفسيرات Mour AI' : 'AI Analytical Interpretations'}
            </h4>
            <ul className="space-y-1.5 text-xs text-slate-400 list-disc list-inside">
              {report.aiInterpretations.map((f, i) => (
                <li key={i}>{f}</li>
              ))}
            </ul>
          </div>
        </div>

        <div className="pt-3 border-t border-white/8 flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs">
          <div className="text-slate-300">
            <strong className="text-[#E5C158]">
              {isAr ? 'مؤشر التوافق التحليلي:' : 'Analytical Confluence Score:'}{' '}
              <span className="font-mono-num">{report.confidenceScore}/100</span>
            </strong>{' '}
            — <span className="text-slate-400">{report.confidenceExplanation}</span>
          </div>
        </div>

        <div className="text-xs text-slate-500 pt-2 border-t border-white/6">
          <strong>{isAr ? 'القيود وعدم اليقين:' : 'Limitations & Uncertainty:'}</strong>{' '}
          {report.limitationsAndUncertainty}
        </div>
      </div>
    </div>
  );
}
