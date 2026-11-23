import React, { useState } from 'react';
import {
  Bell,
  Briefcase,
  Calculator,
  CreditCard,
  LogOut,
  Shield,
  Star,
  User,
} from 'lucide-react';
import { useApp } from '../contexts/AppContext.tsx';
import { apiFetch } from '../lib/api.ts';
import { formatTimestamp } from '../lib/formatters.ts';

export function ProfilePage() {
  const { language, t, navigate, user, logout, refreshSession } = useApp();
  const isAr = language === 'ar';

  const [displayName, setDisplayName] = useState(user?.displayName || '');
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setMsg(null);
    try {
      await apiFetch('/api/auth/profile', {
        method: 'POST',
        body: JSON.stringify({ displayName }),
      });
      await refreshSession();
      setMsg(isAr ? 'تم تحديث الملف الشخصي.' : 'Profile updated.');
    } catch (err) {
      setMsg(err instanceof Error ? err.message : 'Update failed');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <h1 className="text-2xl font-bold text-[#F8FAFC] flex items-center gap-2.5">
          <User className="w-6 h-6 text-[#D4AF37]" />
          <span>{t.nav.profile}</span>
        </h1>
        {user && (
          <button
            onClick={logout}
            className="min-h-[40px] px-4 rounded-xl border border-white/12 bg-[#0D131F] text-xs text-slate-300 hover:text-white flex items-center gap-1.5 cursor-pointer"
          >
            <LogOut className="w-4 h-4" />
            <span>{t.nav.logout}</span>
          </button>
        )}
      </div>

      {!user ? (
        <div className="bg-[#0D131F] border border-white/10 rounded-xl p-6 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <p className="text-sm text-slate-300">{t.common.signInRequired}</p>
          <div className="flex gap-2">
            <button
              onClick={() => navigate('/login')}
              className="px-4 py-2 rounded-xl bg-[#D4AF37] text-[#070A0F] text-xs font-bold cursor-pointer"
            >
              {t.nav.login}
            </button>
            <button
              onClick={() => navigate('/register')}
              className="px-4 py-2 rounded-xl border border-white/15 text-xs text-slate-200 cursor-pointer"
            >
              {t.nav.register}
            </button>
          </div>
        </div>
      ) : (
        <form onSubmit={handleSave} className="bg-[#0D131F] border border-white/10 rounded-xl p-5 space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs text-slate-400 mb-1">{t.auth.emailLabel}</label>
              <input
                type="text"
                disabled
                dir="ltr"
                value={user.email}
                className="w-full min-h-[42px] px-3.5 rounded-xl bg-[#070A0F] border border-white/8 text-sm font-mono-num text-slate-400"
              />
            </div>
            <div>
              <label className="block text-xs text-slate-400 mb-1">
                {isAr ? 'الاسم الظاهر' : 'Display Name'}
              </label>
              <input
                type="text"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                className="w-full min-h-[42px] px-3.5 rounded-xl bg-[#070A0F] border border-white/12 text-sm text-[#F8FAFC]"
              />
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-4 text-xs font-mono-num text-slate-400">
            <span>Plan: <strong className="text-[#E5C158] uppercase">{user.plan}</strong></span>
            <span>·</span>
            <span>Role: <strong className="text-slate-200 uppercase">{user.role}</strong></span>
            <span>·</span>
            <span>Last Login: {formatTimestamp(user.lastLoginAt, language)}</span>
          </div>

          <div className="flex items-center gap-3">
            <button
              type="submit"
              disabled={saving}
              className="px-5 py-2.5 rounded-xl bg-[#D4AF37] text-[#070A0F] text-xs font-bold cursor-pointer"
            >
              {saving ? t.common.loading : t.common.save}
            </button>
            {msg && <span className="text-xs text-[#10B981]">{msg}</span>}
          </div>
        </form>
      )}

      {/* Quick Tools Navigation Grid (especially helpful from Mobile Profile tab) */}
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
        {[
          { path: '/portfolio', label: t.nav.portfolio, icon: Briefcase },
          { path: '/calculator', label: t.nav.calculator, icon: Calculator },
          { path: '/watchlist', label: t.nav.watchlist, icon: Star },
          { path: '/alerts', label: t.nav.alerts, icon: Bell },
          { path: '/pricing', label: t.nav.pricing, icon: CreditCard },
          { path: '/security', label: t.nav.security, icon: Shield },
        ].map((item) => {
          const Icon = item.icon;
          return (
            <button
              key={item.path}
              onClick={() => navigate(item.path)}
              className="p-4 rounded-xl bg-[#0D131F] border border-white/10 hover:border-[#D4AF37]/40 text-start flex items-center gap-3 cursor-pointer"
            >
              <Icon className="w-4 h-4 text-[#D4AF37] shrink-0" />
              <span className="text-xs font-semibold text-slate-200">{item.label}</span>
            </button>
          );
        })}
      </div>

      {user?.role === 'admin' && (
        <button
          onClick={() => navigate('/admin')}
          className="w-full p-4 rounded-xl bg-[#D4AF37]/12 border border-[#D4AF37]/35 text-sm font-bold text-[#E5C158] cursor-pointer"
        >
          {isAr ? 'الانتقال إلى لوحة تحكم الإدارة (Admin Console)' : 'Open Administrator Console'}
        </button>
      )}
    </div>
  );
}

export function SecurityPage() {
  const { language, t, user, logout, navigate } = useApp();
  const isAr = language === 'ar';

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-[#F8FAFC] flex items-center gap-2.5">
        <Shield className="w-6 h-6 text-[#D4AF37]" />
        <span>{t.nav.security}</span>
      </h1>

      <div className="bg-[#0D131F] border border-white/10 rounded-xl p-6 space-y-4 text-sm">
        <h2 className="font-bold text-[#F8FAFC]">
          {isAr ? 'ضوابط أمان الجلسة والمصادقة' : 'Authentication & Session Security Controls'}
        </h2>
        <ul className="space-y-2.5 text-xs text-slate-300 leading-relaxed list-disc list-inside">
          <li>
            {isAr
              ? 'مصادقة خالية من كلمات المرور عبر رمز تحقق عشوائي مشفر من 6 أرقام صالح لمدة 5 دقائق.'
              : 'Passwordless 6-digit CSPRNG OTP authentication with 5-minute TTL and 5-attempt lockout.'}
          </li>
          <li>
            {isAr
              ? 'تخزين تجزئة HMAC-SHA256 فقط للرمز في قاعدة البيانات مع منع إعادة الاستخدام.'
              : 'Only HMAC-SHA256 OTP hashes are stored; challenges are invalidated atomically upon use.'}
          </li>
          <li>
            {isAr
              ? 'جلسات محمية عبر Supabase Auth JWT وملفات تعريف ارتباط HttpOnly + Secure + SameSite=None وسياسات أمان الصفوف (RLS) في PostgreSQL.'
              : 'Sessions protected via Supabase Auth JWTs, HttpOnly; Secure; SameSite=None; Partitioned cookies, and PostgreSQL Row Level Security.'}
          </li>
          <li>
            {isAr
              ? 'جميع مفاتيح Gemini وResend ومفاتيح الخدمة الخاصة تبقى معزولة تماماً على الخادم.'
              : 'All server secrets (Gemini, Resend, optional Supabase service role key) remain strictly server-side.'}
          </li>
        </ul>

        {user ? (
          <div className="pt-3 border-t border-white/8 flex flex-wrap items-center justify-between gap-3">
            <span className="text-xs text-slate-400 font-mono-num">
              UID: {user.uid}
            </span>
            <button
              onClick={logout}
              className="px-4 py-2 rounded-xl bg-[#EF4444]/15 border border-[#EF4444]/35 text-xs font-bold text-[#EF4444] cursor-pointer"
            >
              {isAr ? 'إنهاء الجلسة الحالية (تسجيل الخروج)' : 'Revoke Current Session (Sign Out)'}
            </button>
          </div>
        ) : (
          <button
            onClick={() => navigate('/login')}
            className="px-4 py-2 rounded-xl bg-[#D4AF37] text-[#070A0F] text-xs font-bold cursor-pointer"
          >
            {t.nav.login}
          </button>
        )}
      </div>
    </div>
  );
}
