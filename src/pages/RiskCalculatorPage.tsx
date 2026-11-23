import React, { useMemo, useState } from 'react';
import { Calculator } from 'lucide-react';
import { useApp } from '../contexts/AppContext.tsx';
import { formatPercent, formatPrice, formatUsd } from '../lib/formatters.ts';

export function RiskCalculatorPage() {
  const { language, t } = useApp();
  const isAr = language === 'ar';

  const [accountBalance, setAccountBalance] = useState('10000');
  const [riskPercent, setRiskPercent] = useState('1.5');
  const [entryPrice, setEntryPrice] = useState('60000');
  const [stopLoss, setStopLoss] = useState('57500');
  const [tp1, setTp1] = useState('63000');
  const [tp2, setTp2] = useState('66000');
  const [tp3, setTp3] = useState('70000');

  const calc = useMemo(() => {
    const bal = Number(accountBalance);
    const riskPct = Number(riskPercent);
    const entry = Number(entryPrice);
    const sl = Number(stopLoss);
    const t1 = Number(tp1);
    const t2 = Number(tp2);
    const t3 = Number(tp3);

    if (
      !Number.isFinite(bal) ||
      bal <= 0 ||
      !Number.isFinite(riskPct) ||
      riskPct <= 0 ||
      !Number.isFinite(entry) ||
      entry <= 0 ||
      !Number.isFinite(sl) ||
      sl <= 0 ||
      sl >= entry
    ) {
      return null;
    }

    const maxLossUsd = bal * (riskPct / 100);
    const riskPerUnit = entry - sl;
    const positionUnits = maxLossUsd / riskPerUnit;
    const positionUsdt = positionUnits * entry;
    const stopDistancePct = ((entry - sl) / entry) * 100;

    const evalTarget = (target: number) => {
      if (!Number.isFinite(target) || target <= entry) return null;
      const gainUsd = positionUnits * (target - entry);
      const gainPct = ((target - entry) / entry) * 100;
      const rr = (target - entry) / riskPerUnit;
      return { gainUsd, gainPct, rr };
    };

    return {
      maxLossUsd,
      positionUnits,
      positionUsdt,
      stopDistancePct,
      tp1Res: evalTarget(t1),
      tp2Res: evalTarget(t2),
      tp3Res: evalTarget(t3),
      exceedsBalance: positionUsdt > bal,
    };
  }, [accountBalance, riskPercent, entryPrice, stopLoss, tp1, tp2, tp3]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-[#F8FAFC] flex items-center gap-2.5">
          <Calculator className="w-6 h-6 text-[#D4AF37]" />
          <span>{t.nav.calculator}</span>
        </h1>
        <p className="text-xs text-slate-400 mt-1">
          {isAr
            ? 'حاسبة حجم الصفقة الفورية (Spot) وإدارة المخاطر وحساب العائد إلى المخاطرة'
            : 'Spot position sizing, maximum risk capital, and multi-target Risk/Reward calculator'}
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        <div className="lg:col-span-5 bg-[#0D131F] border border-white/10 rounded-xl p-5 space-y-4">
          {[
            { label: isAr ? 'رصيد الحساب (USDT)' : 'Account Balance (USDT)', val: accountBalance, set: setAccountBalance },
            { label: isAr ? 'نسبة المخاطرة (%)' : 'Risk Percentage (%)', val: riskPercent, set: setRiskPercent },
            { label: isAr ? 'سعر الدخول' : 'Entry Price', val: entryPrice, set: setEntryPrice },
            { label: isAr ? 'سعر وقف الخسارة (أقل من الدخول)' : 'Stop Loss (< Entry)', val: stopLoss, set: setStopLoss },
            { label: 'Take Profit 1 (TP1)', val: tp1, set: setTp1 },
            { label: 'Take Profit 2 (TP2)', val: tp2, set: setTp2 },
            { label: 'Take Profit 3 (TP3)', val: tp3, set: setTp3 },
          ].map((f, idx) => (
            <div key={idx} className="space-y-1">
              <label className="block text-xs text-slate-300">{f.label}</label>
              <input
                type="number"
                step="any"
                dir="ltr"
                value={f.val}
                onChange={(e) => f.set(e.target.value)}
                className="w-full min-h-[42px] px-3.5 rounded-xl bg-[#070A0F] border border-white/12 text-sm font-mono-num text-[#F8FAFC] focus:outline-none focus:border-[#D4AF37]"
              />
            </div>
          ))}
        </div>

        <div className="lg:col-span-7 space-y-4">
          {!calc ? (
            <div className="bg-[#0D131F] border border-[#EF4444]/30 rounded-xl p-6 text-sm text-[#EF4444]">
              {isAr
                ? 'تأكد أن جميع القيم موجبة وأن وقف الخسارة أقل من سعر الدخول.'
                : 'Ensure all values are positive and Stop Loss is strictly below Entry Price for Spot long sizing.'}
            </div>
          ) : (
            <>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 font-mono-num">
                <div className="bg-[#0D131F] border border-white/10 rounded-xl p-5">
                  <div className="text-xs text-slate-400">
                    {isAr ? 'حجم الصفقة المطلوب (USDT)' : 'Recommended Position Size (USDT)'}
                  </div>
                  <div className="text-2xl font-bold text-[#E5C158] mt-1">{formatUsd(calc.positionUsdt)}</div>
                  <div className="text-xs text-slate-400 mt-1">
                    {calc.positionUnits.toFixed(6)} {isAr ? 'وحدة' : 'units'}
                  </div>
                </div>

                <div className="bg-[#0D131F] border border-white/10 rounded-xl p-5">
                  <div className="text-xs text-slate-400">
                    {isAr ? 'أقصى خسارة محتملة' : 'Maximum Potential Loss'}
                  </div>
                  <div className="text-2xl font-bold text-[#EF4444] mt-1">-{formatUsd(calc.maxLossUsd)}</div>
                  <div className="text-xs text-slate-400 mt-1">
                    {isAr ? 'مسافة الوقف:' : 'Stop distance:'} -{calc.stopDistancePct.toFixed(2)}%
                  </div>
                </div>
              </div>

              {calc.exceedsBalance && (
                <div className="p-3.5 rounded-xl bg-[#D4AF37]/10 border border-[#D4AF37]/30 text-xs text-[#E5C158]">
                  {isAr
                    ? 'ملاحظة: حجم الصفقة المحسوب يتجاوز رصيد الحساب الفوري لأن مسافة وقف الخسارة ضيقة مقارنة بنسبة المخاطرة.'
                    : 'Note: Calculated position size exceeds 100% Spot account balance because stop distance is tighter than your risk percentage.'}
                </div>
              )}

              <div className="bg-[#0D131F] border border-white/10 rounded-xl p-5 space-y-3">
                <h2 className="text-sm font-bold text-[#F8FAFC]">
                  {isAr ? 'الأرباح المتوقعة ونسبة العائد للمخاطرة' : 'Target Projections & Risk/Reward'}
                </h2>
                <div className="divide-y divide-white/8 font-mono-num text-xs">
                  {[
                    { name: 'TP1', price: Number(tp1), res: calc.tp1Res },
                    { name: 'TP2', price: Number(tp2), res: calc.tp2Res },
                    { name: 'TP3', price: Number(tp3), res: calc.tp3Res },
                  ].map((row) => (
                    <div key={row.name} className="py-3 flex items-center justify-between gap-4">
                      <span className="font-bold text-[#F8FAFC]">
                        {row.name} (${formatPrice(row.price)})
                      </span>
                      {row.res ? (
                        <div className="flex items-center gap-5">
                          <span className="text-[#10B981] font-semibold">
                            +{formatUsd(row.res.gainUsd)} ({formatPercent(row.res.gainPct)})
                          </span>
                          <span className="text-[#E5C158]">R:R 1 : {row.res.rr.toFixed(2)}</span>
                        </div>
                      ) : (
                        <span className="text-slate-500">—</span>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
