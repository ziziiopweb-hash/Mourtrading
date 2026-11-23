import React, { useEffect, useState } from 'react';
import { Bell, CheckCheck } from 'lucide-react';
import { useApp } from '../contexts/AppContext.tsx';
import { apiFetch } from '../lib/api.ts';
import { formatTimestamp } from '../lib/formatters.ts';

export function NotificationsPage() {
  const { language, t, navigate, user, notifications, refreshNotifications } = useApp();
  const isAr = language === 'ar';

  const [emailAlertsEnabled, setEmailAlertsEnabled] = useState(true);
  const [priceAlertsEnabled, setPriceAlertsEnabled] = useState(true);
  const [signalNotificationsEnabled, setSignalNotificationsEnabled] = useState(true);
  const [savedMsg, setSavedMsg] = useState<string | null>(null);

  useEffect(() => {
    if (!user) return;
    apiFetch<{
      preferences?: {
        emailAlertsEnabled?: boolean;
        priceAlertsEnabled?: boolean;
        signalNotificationsEnabled?: boolean;
      };
    }>('/api/user/preferences')
      .then((res) => {
        if (res.preferences) {
          setEmailAlertsEnabled(res.preferences.emailAlertsEnabled ?? true);
          setPriceAlertsEnabled(res.preferences.priceAlertsEnabled ?? true);
          setSignalNotificationsEnabled(res.preferences.signalNotificationsEnabled ?? true);
        }
      })
      .catch(() => {});
  }, [user]);

  const markRead = async (id: string) => {
    await apiFetch(`/api/user/notifications/${id}/read`, { method: 'PATCH' }).catch(() => {});
    refreshNotifications();
  };

  const markAllRead = async () => {
    await apiFetch('/api/user/notifications/read-all', { method: 'POST' }).catch(() => {});
    refreshNotifications();
  };

  const savePrefs = async () => {
    setSavedMsg(null);
    await apiFetch('/api/user/preferences', {
      method: 'PUT',
      body: JSON.stringify({
        emailAlertsEnabled,
        priceAlertsEnabled,
        signalNotificationsEnabled,
      }),
    });
    setSavedMsg(isAr ? 'تم حفظ تفضيلات الإشعارات.' : 'Notification preferences saved.');
  };

  if (!user) {
    return (
      <div className="bg-[#0D131F] border border-white/10 rounded-xl p-8 text-center space-y-3">
        <Bell className="w-8 h-8 text-[#D4AF37] mx-auto" />
        <p className="text-sm text-slate-300">{t.common.signInRequired}</p>
        <button
          onClick={() => navigate('/login')}
          className="px-5 py-2.5 rounded-xl bg-[#D4AF37] text-[#070A0F] text-xs font-bold cursor-pointer"
        >
          {t.nav.login}
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <h1 className="text-2xl font-bold text-[#F8FAFC] flex items-center gap-2.5">
          <Bell className="w-6 h-6 text-[#D4AF37]" />
          <span>{t.nav.notifications}</span>
        </h1>

        <button
          onClick={markAllRead}
          className="min-h-[38px] px-4 rounded-xl border border-white/12 bg-[#0D131F] text-xs text-slate-200 flex items-center gap-1.5 cursor-pointer"
        >
          <CheckCheck className="w-4 h-4 text-[#10B981]" />
          <span>{isAr ? 'تحديد الكل كمقروء' : 'Mark All Read'}</span>
        </button>
      </div>

      {/* Preferences */}
      <div className="bg-[#0D131F] border border-white/10 rounded-xl p-5 space-y-4">
        <h2 className="text-sm font-bold text-[#F8FAFC]">
          {isAr ? 'تفضيلات الإشعارات' : 'Notification Preferences'}
        </h2>
        <div className="flex flex-wrap gap-6 text-xs text-slate-300">
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={priceAlertsEnabled}
              onChange={(e) => setPriceAlertsEnabled(e.target.checked)}
              className="accent-[#D4AF37]"
            />
            <span>{isAr ? 'تنبيهات الأسعار داخل التطبيق' : 'In-App Price Alerts'}</span>
          </label>
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={signalNotificationsEnabled}
              onChange={(e) => setSignalNotificationsEnabled(e.target.checked)}
              className="accent-[#D4AF37]"
            />
            <span>{isAr ? 'تحديثات الإشارات' : 'Signal Updates'}</span>
          </label>
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={emailAlertsEnabled}
              onChange={(e) => setEmailAlertsEnabled(e.target.checked)}
              className="accent-[#D4AF37]"
            />
            <span>{isAr ? 'إشعارات البريد الإلكتروني' : 'Email Notifications'}</span>
          </label>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={savePrefs}
            className="px-4 py-2 rounded-lg bg-[#D4AF37] text-[#070A0F] text-xs font-bold cursor-pointer"
          >
            {t.common.save}
          </button>
          {savedMsg && <span className="text-xs text-[#10B981]">{savedMsg}</span>}
        </div>
      </div>

      {/* Feed */}
      <div className="bg-[#0D131F] border border-white/10 rounded-xl divide-y divide-white/8">
        {notifications.length === 0 ? (
          <div className="p-8 text-center text-sm text-slate-400">
            {isAr ? 'لا توجد إشعارات حالياً.' : 'No notifications yet.'}
          </div>
        ) : (
          notifications.map((n) => (
            <div
              key={n.id}
              onClick={() => !n.read && markRead(n.id)}
              className={`p-4 flex items-start justify-between gap-4 transition-colors ${
                n.read ? 'opacity-65' : 'bg-white/[0.02] cursor-pointer'
              }`}
            >
              <div className="space-y-1">
                <div className="text-sm font-semibold text-[#F8FAFC]">{n.title}</div>
                <div className="text-xs text-slate-300">{n.message}</div>
              </div>
              <div className="text-end shrink-0">
                <div className="text-[11px] font-mono-num text-slate-500">
                  {formatTimestamp(n.createdAt, language)}
                </div>
                {!n.read && (
                  <span className="text-[10px] font-semibold text-[#D4AF37]">
                    {isAr ? 'جديد' : 'Unread'}
                  </span>
                )}
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
