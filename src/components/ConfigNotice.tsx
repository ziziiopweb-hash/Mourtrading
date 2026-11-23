import React from 'react';
import { AlertTriangle, KeyRound } from 'lucide-react';
import { useApp } from '../contexts/AppContext.tsx';

export function ConfigNotice({
  title,
  message,
  missingVars,
}: {
  title?: string;
  message: string;
  missingVars?: string[];
}) {
  const { language } = useApp();
  const isAr = language === 'ar';

  return (
    <div className="bg-[#0D131F] border border-[#D4AF37]/35 rounded-xl p-5 text-sm">
      <div className="flex items-start gap-3">
        <AlertTriangle className="w-5 h-5 text-[#D4AF37] shrink-0 mt-0.5" />
        <div className="space-y-2 flex-1 min-w-0">
          <h3 className="font-semibold text-[#F8FAFC]">
            {title || (isAr ? 'إعداد الخدمة مطلوب' : 'External Service Configuration Required')}
          </h3>
          <p className="text-slate-300 leading-relaxed">{message}</p>
          {missingVars && missingVars.length > 0 && (
            <div className="pt-1">
              <div className="flex items-center gap-1.5 text-xs text-slate-400 mb-1.5">
                <KeyRound className="w-3.5 h-3.5 text-[#D4AF37]" />
                <span>{isAr ? 'متغيرات البيئة المطلوبة:' : 'Required environment variables:'}</span>
              </div>
              <div className="flex flex-wrap gap-2" dir="ltr">
                {missingVars.map((v) => (
                  <code
                    key={v}
                    className="px-2 py-1 text-xs font-mono-num bg-[#070A0F] border border-white/10 rounded text-[#E5C158]"
                  >
                    {v}
                  </code>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
