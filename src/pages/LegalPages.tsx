import React from 'react';
import { FileText, Shield } from 'lucide-react';
import { useApp } from '../contexts/AppContext.tsx';

export function PrivacyPolicyPage() {
  const { language, t } = useApp();
  const isAr = language === 'ar';

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      <h1 className="text-2xl font-bold text-[#F8FAFC] flex items-center gap-2.5">
        <Shield className="w-6 h-6 text-[#D4AF37]" />
        <span>{t.nav.privacy}</span>
      </h1>

      <div className="bg-[#0D131F] border border-white/10 rounded-xl p-6 space-y-4 text-sm text-slate-300 leading-relaxed">
        <p>
          {isAr
            ? 'تحترم منصة MourTrading خصوصية بياناتك. نستخدم Clerk لإدارة المصادقة الآمنة والتحقق من البريد الإلكتروني وإدارة الجلسات، ونجمع بريدك الإلكتروني فقط للتحقق من الهوية وإرسال التنبيهات التي تفعلها باختيارك.'
            : 'MourTrading respects your data privacy. We use Clerk for secure email authentication, verification, and session management, collecting your email solely for account identity and user-opted alert notifications.'}
        </p>
        <p>
          {isAr
            ? 'لا نصل أبداً إلى حسابك الشخصي على Binance ولا نطلب مفاتيح التداول الخاصة بك أو أذونات السحب.'
            : 'MourTrading never connects to your personal Binance exchange account or requests trading or withdrawal API keys.'}
        </p>
        <p>
          {isAr
            ? 'تُحفظ بيانات المحفظة اليدوية وقوائم المفضلة والتنبيهات وسجل تحليلات الذكاء الاصطناعي في قاعدة بيانات Supabase PostgreSQL عبر وصول خادمي آمن ومعزول لكل مستخدم موثق.'
            : 'Manual portfolio holdings, watchlists, price alerts, and AI analysis history are stored in Supabase PostgreSQL via authenticated server-side access isolated per verified user ID.'}
        </p>
      </div>
    </div>
  );
}

export function TermsPage() {
  const { language, t } = useApp();
  const isAr = language === 'ar';

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      <h1 className="text-2xl font-bold text-[#F8FAFC] flex items-center gap-2.5">
        <FileText className="w-6 h-6 text-[#D4AF37]" />
        <span>{t.nav.terms}</span>
      </h1>

      <div className="bg-[#0D131F] border border-white/10 rounded-xl p-6 space-y-4 text-sm text-slate-300 leading-relaxed">
        <p>
          {isAr
            ? 'تقدم منصة MourTrading تحليلات سوقية ومؤشرات فنية وتقارير Mour AI لأغراض المعلومات والبحث الفني فقط، ولا تشكل بأي حال من الأحوال نصيحة مالية ملزمة أو وعداً بتحقيق أرباح.'
            : 'MourTrading provides market intelligence, calculated technical indicators, and Mour AI analytical reports strictly for informational purposes. Nothing on this platform constitutes guaranteed financial returns or investment advice.'}
        </p>
        <p>
          {isAr
            ? 'تخضع أصول العملات الرقمية لتقلبات عالية. يتحمل المستخدم وحده كامل المسؤولية عن قرارات الشراء أو البيع أو إدارة المخاطر.'
            : 'Cryptocurrency Spot markets carry substantial volatility and risk. Users bear sole responsibility for trading execution and capital allocation decisions.'}
        </p>
        <p>
          {isAr
            ? 'يُحظر إساءة استخدام واجهات البرمجة أو محاولة تجاوز حصص الاستخدام اليومية للذكاء الاصطناعي.'
            : 'Abuse of API endpoints, automated scraping, or attempts to bypass server-enforced AI quotas will result in account suspension.'}
        </p>
      </div>
    </div>
  );
}
