import React, { useState } from 'react';
import { ScanLine, Upload } from 'lucide-react';
import { useApp } from '../contexts/AppContext.tsx';
import { ApiError, apiFetch } from '../lib/api.ts';
import { AiReportView } from '../components/AiReportView.tsx';
import type { AiAnalysisReport, Timeframe } from '../types/trading.ts';

const TIMEFRAMES: Timeframe[] = ['1m', '5m', '15m', '1h', '4h', '1d', '1w'];

export function ChartVisionPage() {
  const { language, t, navigate, user } = useApp();
  const isAr = language === 'ar';

  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [imageBase64, setImageBase64] = useState<string>('');
  const [mimeType, setMimeType] = useState<'image/png' | 'image/jpeg' | 'image/webp'>('image/png');
  const [confirmedSymbol, setConfirmedSymbol] = useState('');
  const [confirmedTimeframe, setConfirmedTimeframe] = useState<Timeframe | ''>('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [report, setReport] = useState<AiAnalysisReport | null>(null);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) {
      setError(isAr ? 'يرجى رفع صورة بصيغة PNG أو JPEG أو WebP' : 'Please upload PNG, JPEG, or WebP image');
      return;
    }
    if (file.size > 4.5 * 1024 * 1024) {
      setError(isAr ? 'الحد الأقصى لحجم الصورة 4.5 ميجابايت' : 'Maximum image size is 4.5MB');
      return;
    }
    setError(null);
    setMimeType(file.type as 'image/png' | 'image/jpeg' | 'image/webp');
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = String(reader.result || '');
      setPreviewUrl(dataUrl);
      const base64 = dataUrl.split(',')[1] || '';
      setImageBase64(base64);
    };
    reader.readAsDataURL(file);
  };

  const handleAnalyzeImage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) {
      navigate('/login');
      return;
    }
    if (!imageBase64) {
      setError(isAr ? 'يرجى اختيار صورة الشارت أولاً' : 'Please upload a chart image first');
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const res = await apiFetch<{ report: AiAnalysisReport }>('/api/ai/analyze-image', {
        method: 'POST',
        body: JSON.stringify({
          imageBase64,
          mimeType,
          confirmedSymbol: confirmedSymbol.trim() ? confirmedSymbol.trim().toUpperCase() : undefined,
          confirmedTimeframe: confirmedTimeframe || undefined,
          language,
        }),
      });
      setReport(res.report);
      if (res.report.recognizedChartInfo?.pair && !confirmedSymbol) {
        setConfirmedSymbol(res.report.recognizedChartInfo.pair);
      }
    } catch (err) {
      setError(err instanceof ApiError || err instanceof Error ? err.message : 'Vision analysis failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-[#F8FAFC] flex items-center gap-2.5">
          <ScanLine className="w-6 h-6 text-[#D4AF37]" />
          <span>{t.ai.visionTitle}</span>
        </h1>
        <p className="text-xs text-slate-400 mt-1">{t.ai.uploadPrompt}</p>
      </div>

      <form
        onSubmit={handleAnalyzeImage}
        className="bg-[#0D131F] border border-white/10 rounded-xl p-6 space-y-5"
      >
        <label className="flex flex-col items-center justify-center border border-dashed border-white/20 hover:border-[#D4AF37]/60 rounded-xl p-6 cursor-pointer bg-[#070A0F]/60 transition-colors">
          <Upload className="w-7 h-7 text-[#D4AF37] mb-2" />
          <span className="text-sm font-medium text-slate-200">
            {isAr ? 'اضغط لاختيار لقطة شاشة للشارت' : 'Click to select chart screenshot'}
          </span>
          <span className="text-xs text-slate-500 mt-1">PNG / JPEG / WebP (max 4.5MB)</span>
          <input type="file" accept="image/png,image/jpeg,image/webp" className="hidden" onChange={handleFileChange} />
        </label>

        {previewUrl && (
          <div className="rounded-xl overflow-hidden border border-white/10 bg-[#070A0F] max-h-80 flex items-center justify-center">
            <img src={previewUrl} alt="Uploaded chart preview" className="max-h-80 object-contain" />
          </div>
        )}

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 items-end">
          <div className="space-y-1.5">
            <label className="block text-xs text-slate-300">{t.ai.confirmPairLabel}</label>
            <input
              type="text"
              dir="ltr"
              value={confirmedSymbol}
              onChange={(e) => setConfirmedSymbol(e.target.value.toUpperCase())}
              placeholder="e.g. BTCUSDT (optional)"
              className="w-full min-h-[42px] px-3.5 rounded-xl bg-[#070A0F] border border-white/12 text-sm font-mono-num text-[#F8FAFC]"
            />
          </div>

          <div className="space-y-1.5">
            <label className="block text-xs text-slate-300">
              {isAr ? 'تأكيد الإطار الزمني (اختياري)' : 'Confirm Timeframe (optional)'}
            </label>
            <select
              value={confirmedTimeframe}
              onChange={(e) => setConfirmedTimeframe((e.target.value as Timeframe) || '')}
              dir="ltr"
              className="w-full min-h-[42px] px-3.5 rounded-xl bg-[#070A0F] border border-white/12 text-sm font-mono-num text-[#F8FAFC]"
            >
              <option value="">Auto-detect</option>
              {TIMEFRAMES.map((tf) => (
                <option key={tf} value={tf}>
                  {tf.toUpperCase()}
                </option>
              ))}
            </select>
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full min-h-[42px] rounded-xl bg-[#D4AF37] hover:bg-[#E5C158] disabled:opacity-50 text-[#070A0F] font-bold text-sm cursor-pointer"
          >
            {loading ? t.common.loading : user ? (isAr ? 'تحليل الصورة بالذكاء' : 'Analyze Chart Image') : t.nav.login}
          </button>
        </div>

        {error && (
          <div className="p-3 rounded-lg bg-[#EF4444]/10 border border-[#EF4444]/30 text-xs text-[#EF4444]">
            {error}
          </div>
        )}
      </form>

      {report && <AiReportView report={report} />}
    </div>
  );
}
