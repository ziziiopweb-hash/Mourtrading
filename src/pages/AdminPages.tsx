import React, { useEffect, useState } from 'react';
import {
  Activity,
  Download,
  Megaphone,
  Search,
  Settings,
  Signal,
  Users,
} from 'lucide-react';
import {
  AdminSignalRowActions,
  SignalEditModal,
  SignalsAdminManager,
} from '../components/SignalsAdminManager.tsx';
import { useApp } from '../contexts/AppContext.tsx';
import { apiFetch } from '../lib/api.ts';
import { formatPrice, formatTimestamp } from '../lib/formatters.ts';
import { fetchAllSignals, type SignalWithLive } from '../lib/signalsService.ts';
import type { AppConfig, UserProfile } from '../types/trading.ts';

function AdminGuard({ children }: { children: React.ReactNode }) {
  const { isAdmin, authLoading, navigate } = useApp();

  useEffect(() => {
    if (!authLoading && !isAdmin) {
      navigate('/');
    }
  }, [authLoading, isAdmin, navigate]);

  if (authLoading || !isAdmin) {
    return null;
  }

  return <>{children}</>;
}

export function AdminDashboardPage() {
  const { language, t, navigate } = useApp();
  const isAr = language === 'ar';

  const [data, setData] = useState<{
    stats: {
      totalUsers: number;
      activeUsers: number;
      activeLast24h: number;
      newRegistrations7d: number;
      aiAnalyses24h: number;
      aiAnalyses30d: number;
      failedAuthAttemptsRecent: number;
      totalSignals: number;
    };
    apiHealth: {
      binance: { ok: boolean; wsConnected: boolean; pairCount: number };
      geminiConfigured: boolean;
      checkedAt: string;
    };
    recentAuthFailures: Array<{ emailHash?: string; reason?: string; ip?: string; createdAt?: string }>;
  } | null>(null);
  const [auditLogs, setAuditLogs] = useState<Array<{ id: string; adminUid: string; action: string; targetId: string; createdAt: string }>>([]);

  useEffect(() => {
    apiFetch<NonNullable<typeof data>>('/api/admin/overview').then(setData).catch(() => {});
    apiFetch<{ logs: typeof auditLogs }>('/api/admin/audit-logs')
      .then((res) => setAuditLogs(res.logs || []))
      .catch(() => {});
  }, []);

  const handleExport = async () => {
    const res = await apiFetch<Record<string, unknown>>('/api/admin/export');
    const blob = new Blob([JSON.stringify(res, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `mourtrading-report-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <AdminGuard>
      <div className="space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <h1 className="text-2xl font-bold text-[#F8FAFC]">{t.nav.admin}</h1>
          <div className="flex flex-wrap gap-2">
            <button
              onClick={() => navigate('/admin/users')}
              className="px-3 py-2 rounded-xl bg-[#0D131F] border border-white/12 text-xs text-slate-200 cursor-pointer"
            >
              {t.nav.adminUsers}
            </button>
            <button
              onClick={() => navigate('/admin/signals')}
              className="px-3 py-2 rounded-xl bg-[#0D131F] border border-white/12 text-xs text-slate-200 cursor-pointer"
            >
              {t.nav.adminSignals}
            </button>
            <button
              onClick={() => navigate('/admin/settings')}
              className="px-3 py-2 rounded-xl bg-[#0D131F] border border-white/12 text-xs text-slate-200 cursor-pointer"
            >
              {t.nav.adminSettings}
            </button>
            <button
              onClick={handleExport}
              className="px-3 py-2 rounded-xl bg-[#D4AF37] text-[#070A0F] text-xs font-bold flex items-center gap-1.5 cursor-pointer"
            >
              <Download className="w-3.5 h-3.5" />
              <span>{isAr ? 'تصدير التقرير' : 'Export Report'}</span>
            </button>
          </div>
        </div>

        {data && (
          <>
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 font-mono-num">
              {[
                { label: isAr ? 'إجمالي الحسابات' : 'Total Accounts', val: data.stats.totalUsers },
                { label: isAr ? 'المستخدمون النشطون' : 'Active Users', val: data.stats.activeUsers },
                { label: isAr ? 'تسجيلات جديدة (7 أيام)' : 'New Users (7d)', val: data.stats.newRegistrations7d },
                { label: isAr ? 'تحليلات AI (24س / 30ي)' : 'AI Usage (24h / 30d)', val: `${data.stats.aiAnalyses24h} / ${data.stats.aiAnalyses30d}` },
                { label: isAr ? 'محاولات الدخول الفاشلة' : 'Failed Auth Attempts', val: data.stats.failedAuthAttemptsRecent },
                { label: isAr ? 'إجمالي الإشارات' : 'Total Signals', val: data.stats.totalSignals },
                { label: 'Binance WS', val: data.apiHealth.binance.wsConnected ? 'CONNECTED' : 'RECONNECTING' },
                { label: 'Gemini AI', val: data.apiHealth.geminiConfigured ? 'READY' : 'OFF' },
              ].map((kpi, i) => (
                <div key={i} className="bg-[#0D131F] border border-white/10 rounded-xl p-4">
                  <div className="text-xs text-slate-400">{kpi.label}</div>
                  <div className="text-xl font-bold text-[#F8FAFC] mt-1">{kpi.val}</div>
                </div>
              ))}
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <div className="bg-[#0D131F] border border-white/10 rounded-xl p-5 space-y-3">
                <h2 className="text-sm font-bold text-[#F8FAFC] flex items-center gap-2">
                  <Activity className="w-4 h-4 text-[#D4AF37]" />
                  <span>{isAr ? 'سجل التدقيق الإداري' : 'Administrator Audit Trail'}</span>
                </h2>
                <div className="divide-y divide-white/6 text-xs font-mono-num max-h-72 overflow-y-auto">
                  {auditLogs.map((log) => (
                    <div key={log.id} className="py-2 flex justify-between gap-3">
                      <span className="text-[#E5C158]">{log.action}</span>
                      <span className="text-slate-400 truncate">{log.targetId}</span>
                      <span className="text-slate-500">{formatTimestamp(log.createdAt, language)}</span>
                    </div>
                  ))}
                </div>
              </div>

              <div className="bg-[#0D131F] border border-white/10 rounded-xl p-5 space-y-3">
                <h2 className="text-sm font-bold text-[#F8FAFC]">
                  {isAr ? 'محاولات المصادقة الفاشلة الأخيرة' : 'Recent Failed Auth Attempts'}
                </h2>
                <div className="divide-y divide-white/6 text-xs font-mono-num max-h-72 overflow-y-auto">
                  {data.recentAuthFailures.map((f, idx) => (
                    <div key={idx} className="py-2 flex justify-between gap-2">
                      <span className="text-[#EF4444] truncate">{f.reason}</span>
                      <span className="text-slate-500 shrink-0">{formatTimestamp(f.createdAt, language)}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </>
        )}
      </div>
    </AdminGuard>
  );
}

export function AdminUsersPage() {
  const { language, t, user: currentUser } = useApp();
  const isAr = language === 'ar';

  const [users, setUsers] = useState<UserProfile[]>([]);
  const [q, setQ] = useState('');

  const loadUsers = (queryStr = '') => {
    apiFetch<{ users: UserProfile[] }>(`/api/admin/users?q=${encodeURIComponent(queryStr)}`)
      .then((res) => setUsers(res.users || []))
      .catch(() => {});
  };

  useEffect(() => {
    loadUsers();
  }, []);

  const updateUser = async (
    uid: string,
    patch: { status?: 'active' | 'suspended'; plan?: 'free' | 'pro'; role?: 'user' | 'admin' },
  ) => {
    const res = await apiFetch<{ user: UserProfile }>(`/api/admin/users/${uid}`, {
      method: 'PATCH',
      body: JSON.stringify(patch),
    });
    setUsers((prev) => prev.map((u) => (u.uid === uid ? res.user : u)));
  };

  return (
    <AdminGuard>
      <div className="space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <h1 className="text-2xl font-bold text-[#F8FAFC] flex items-center gap-2">
            <Users className="w-6 h-6 text-[#D4AF37]" />
            <span>{t.nav.adminUsers}</span>
          </h1>
          <div className="flex items-center gap-2">
            <div className="relative">
              <Search className="w-4 h-4 text-slate-500 absolute top-1/2 -translate-y-1/2 start-3" />
              <input
                type="text"
                value={q}
                onChange={(e) => {
                  setQ(e.target.value);
                  loadUsers(e.target.value);
                }}
                placeholder={isAr ? 'بحث بالبريد أو UID...' : 'Search email or UID...'}
                className="min-h-[40px] ps-9 pe-3 rounded-xl bg-[#0D131F] border border-white/12 text-xs text-[#F8FAFC]"
              />
            </div>
          </div>
        </div>

        <div className="bg-[#0D131F] border border-white/10 rounded-xl overflow-x-auto">
          <table className="w-full text-xs font-mono-num">
            <thead>
              <tr className="border-b border-white/10 text-slate-400 bg-[#070A0F]/60">
                <th className="py-3 px-4 text-start">Email</th>
                <th className="py-3 px-4 text-start">Role</th>
                <th className="py-3 px-4 text-start">Plan</th>
                <th className="py-3 px-4 text-start">Status</th>
                <th className="py-3 px-4 text-end">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/6">
              {users.map((u) => {
                const isSelf = Boolean(currentUser && currentUser.uid === u.uid);
                return (
                  <tr key={u.uid}>
                    <td className="py-3 px-4 text-slate-200">{u.email}</td>
                    <td className="py-3 px-4 text-[#E5C158] uppercase">{u.role}</td>
                    <td className="py-3 px-4 uppercase">{u.plan}</td>
                    <td className={`py-3 px-4 uppercase ${u.status === 'active' ? 'text-[#10B981]' : 'text-[#EF4444]'}`}>
                      {u.status}
                    </td>
                    <td className="py-3 px-4 text-end space-x-2">
                      <button
                        onClick={() => updateUser(u.uid, { plan: u.plan === 'pro' ? 'free' : 'pro' })}
                        className="px-2.5 py-1 rounded bg-white/8 hover:bg-white/15 text-slate-200 cursor-pointer"
                      >
                        {u.plan === 'pro' ? 'Set Free' : 'Grant Pro'}
                      </button>
                      {!isSelf && (
                        <button
                          onClick={() => updateUser(u.uid, { role: u.role === 'admin' ? 'user' : 'admin' })}
                          className="px-2.5 py-1 rounded bg-[#D4AF37]/15 text-[#E5C158] cursor-pointer"
                        >
                          {u.role === 'admin' ? 'Revoke Admin' : 'Make Admin'}
                        </button>
                      )}
                      {u.role !== 'admin' && (
                        <button
                          onClick={() =>
                            updateUser(u.uid, { status: u.status === 'active' ? 'suspended' : 'active' })
                          }
                          className="px-2.5 py-1 rounded bg-[#EF4444]/15 text-[#EF4444] cursor-pointer"
                        >
                          {u.status === 'active' ? 'Suspend' : 'Reactivate'}
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </AdminGuard>
  );
}

export function AdminSignalsPage() {
  const { language, t, tickerMap } = useApp();
  const isAr = language === 'ar';

  const [signals, setSignals] = useState<SignalWithLive[]>([]);
  const [editingSignal, setEditingSignal] = useState<SignalWithLive | null>(null);

  const loadSignals = () => {
    fetchAllSignals()
      .then((res) => setSignals(res.signals))
      .catch(() => {});
  };

  useEffect(() => {
    loadSignals();
  }, []);

  return (
    <AdminGuard>
      <div className="space-y-6">
        <h1 className="text-2xl font-bold text-[#F8FAFC] flex items-center gap-2">
          <Signal className="w-6 h-6 text-[#D4AF37]" />
          <span>{t.nav.adminSignals}</span>
        </h1>

        <SignalsAdminManager
          onSignalCreated={(created) =>
            setSignals((prev) => [created, ...prev.filter((s) => s.id !== created.id)])
          }
          onAutoScanCompleted={() => loadSignals()}
        />

        <div className="bg-[#0D131F] border border-white/10 rounded-xl divide-y divide-white/8">
          {signals.length === 0 ? (
            <div className="p-6 text-center text-xs text-slate-400">
              {isAr ? 'لا توجد إشارات منشورة بعد.' : 'No published signals yet.'}
            </div>
          ) : (
            signals.map((sig) => {
              const livePrice = tickerMap.get(sig.symbol)?.lastPrice ?? sig.livePrice ?? null;
              return (
                <div key={sig.id} className="p-4 space-y-2.5 text-xs font-mono-num">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <div className="font-bold text-[#F8FAFC]">
                        {sig.symbol} · {sig.status}{' '}
                        <span className="text-[#E5C158] font-normal">
                          ({sig.source === 'AUTO' || sig.source === 'AI' ? (isAr ? 'تلقائية' : 'Auto') : isAr ? 'يدوية' : 'Manual'})
                        </span>
                      </div>
                      <div className="text-slate-400 mt-0.5">
                        Entry {formatPrice(sig.entryLow)}–{formatPrice(sig.entryHigh)} · TP1{' '}
                        {formatPrice(sig.tp1)} · SL {formatPrice(sig.stopLoss)}
                      </div>
                    </div>
                  </div>
                  <AdminSignalRowActions
                    signal={sig}
                    livePrice={livePrice}
                    onEdit={() => setEditingSignal(sig)}
                    onUpdated={(updated) =>
                      setSignals((prev) => prev.map((s) => (s.id === updated.id ? updated : s)))
                    }
                    onDeleted={(id) => setSignals((prev) => prev.filter((s) => s.id !== id))}
                  />
                </div>
              );
            })
          )}
        </div>

        <SignalEditModal
          signal={editingSignal}
          onClose={() => setEditingSignal(null)}
          onSaved={(updated) =>
            setSignals((prev) => prev.map((s) => (s.id === updated.id ? updated : s)))
          }
        />
      </div>
    </AdminGuard>
  );
}

export function AdminSettingsPage() {
  const { language, t, refreshSession } = useApp();
  const isAr = language === 'ar';

  const [freeLimit, setFreeLimit] = useState(3);
  const [proLimit, setProLimit] = useState(50);
  const [monthlyPrice, setMonthlyPrice] = useState(5);
  const [annualPrice, setAnnualPrice] = useState(50);
  const [durationDays, setDurationDays] = useState(30);
  const [announcement, setAnnouncement] = useState('');
  const [broadcastTitle, setBroadcastTitle] = useState('');
  const [broadcastMsg, setBroadcastMsg] = useState('');
  const [savedNotice, setSavedNotice] = useState<string | null>(null);

  useEffect(() => {
    apiFetch<{ config: AppConfig | null }>('/api/user/plans')
      .then((res) => {
        if (res.config) {
          setFreeLimit(res.config.freeDailyAiLimit);
          setProLimit(res.config.proDailyAiLimit);
          setMonthlyPrice(res.config.proMonthlyPriceUsd);
          setAnnualPrice(res.config.proAnnualPriceUsd);
          setDurationDays(res.config.proDurationDays || 30);
          setAnnouncement(res.config.announcement || '');
        }
      })
      .catch(() => {});
  }, []);

  const handleSaveSettings = async (e: React.FormEvent) => {
    e.preventDefault();
    setSavedNotice(null);
    await apiFetch('/api/admin/settings', {
      method: 'PUT',
      body: JSON.stringify({
        freeDailyAiLimit: Number(freeLimit),
        proDailyAiLimit: Number(proLimit),
        proMonthlyPriceUsd: Number(monthlyPrice),
        proAnnualPriceUsd: Number(annualPrice),
        proDurationDays: Number(durationDays),
        freeFeatures: [
          `${freeLimit} AI Analyses / 24h`,
          'Live Binance Spot Market Data',
          'Standard Technical Charts & Indicators',
          'Watchlist & Manual Portfolio Tracking',
        ],
        proFeatures: [
          `${proLimit} AI Analyses / 24h`,
          'Multi-Timeframe AI & Vision Deep Reports',
          'Priority Spot Signals & Alerts',
          'Extended Watchlists & Portfolio Analytics',
        ],
        announcement,
      }),
    });
    await refreshSession();
    setSavedNotice(isAr ? 'تم حفظ إعدادات المنصة بنجاح.' : 'Platform settings saved.');
  };

  const handleBroadcast = async (e: React.FormEvent) => {
    e.preventDefault();
    await apiFetch('/api/admin/announcements', {
      method: 'POST',
      body: JSON.stringify({ title: broadcastTitle, message: broadcastMsg }),
    });
    setBroadcastTitle('');
    setBroadcastMsg('');
    setSavedNotice(isAr ? 'تم إرسال الإشعار لجميع المستخدمين النشطين.' : 'Announcement broadcast to active users.');
  };

  return (
    <AdminGuard>
      <div className="space-y-6">
        <h1 className="text-2xl font-bold text-[#F8FAFC] flex items-center gap-2">
          <Settings className="w-6 h-6 text-[#D4AF37]" />
          <span>{t.nav.adminSettings}</span>
        </h1>

        <form onSubmit={handleSaveSettings} className="bg-[#0D131F] border border-white/10 rounded-xl p-5 space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-3 lg:grid-cols-5 gap-3">
            <div>
              <label className="block text-xs text-slate-400 mb-1">Free AI Limit / 24h</label>
              <input
                type="number"
                value={freeLimit}
                onChange={(e) => setFreeLimit(Number(e.target.value))}
                className="w-full min-h-[40px] px-3 rounded-lg bg-[#070A0F] border border-white/12 text-sm font-mono-num"
              />
            </div>
            <div>
              <label className="block text-xs text-slate-400 mb-1">Pro AI Limit / 24h</label>
              <input
                type="number"
                value={proLimit}
                onChange={(e) => setProLimit(Number(e.target.value))}
                className="w-full min-h-[40px] px-3 rounded-lg bg-[#070A0F] border border-white/12 text-sm font-mono-num"
              />
            </div>
            <div>
              <label className="block text-xs text-slate-400 mb-1">Pro Monthly ($)</label>
              <input
                type="number"
                value={monthlyPrice}
                onChange={(e) => setMonthlyPrice(Number(e.target.value))}
                className="w-full min-h-[40px] px-3 rounded-lg bg-[#070A0F] border border-white/12 text-sm font-mono-num"
              />
            </div>
            <div>
              <label className="block text-xs text-slate-400 mb-1">Pro Annual ($)</label>
              <input
                type="number"
                value={annualPrice}
                onChange={(e) => setAnnualPrice(Number(e.target.value))}
                className="w-full min-h-[40px] px-3 rounded-lg bg-[#070A0F] border border-white/12 text-sm font-mono-num"
              />
            </div>
            <div>
              <label className="block text-xs text-slate-400 mb-1">Duration (Days)</label>
              <input
                type="number"
                value={durationDays}
                onChange={(e) => setDurationDays(Number(e.target.value))}
                className="w-full min-h-[40px] px-3 rounded-lg bg-[#070A0F] border border-white/12 text-sm font-mono-num"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs text-slate-400 mb-1">
              {isAr ? 'شريط الإعلان العلوي للمنصة' : 'Top Platform Announcement Banner'}
            </label>
            <input
              type="text"
              value={announcement}
              onChange={(e) => setAnnouncement(e.target.value)}
              className="w-full min-h-[40px] px-3 rounded-lg bg-[#070A0F] border border-white/12 text-sm"
            />
          </div>

          <button
            type="submit"
            className="px-5 py-2.5 rounded-xl bg-[#D4AF37] text-[#070A0F] text-xs font-bold cursor-pointer"
          >
            {t.common.save}
          </button>
        </form>

        <form onSubmit={handleBroadcast} className="bg-[#0D131F] border border-white/10 rounded-xl p-5 space-y-3">
          <h2 className="text-sm font-bold text-[#F8FAFC] flex items-center gap-2">
            <Megaphone className="w-4 h-4 text-[#D4AF37]" />
            <span>{isAr ? 'إرسال إشعار جماعي للمستخدمين' : 'Broadcast In-App Notification'}</span>
          </h2>
          <input
            type="text"
            required
            value={broadcastTitle}
            onChange={(e) => setBroadcastTitle(e.target.value)}
            placeholder={isAr ? 'عنوان الإشعار' : 'Notification title'}
            className="w-full min-h-[40px] px-3 rounded-lg bg-[#070A0F] border border-white/12 text-xs"
          />
          <textarea
            required
            rows={2}
            value={broadcastMsg}
            onChange={(e) => setBroadcastMsg(e.target.value)}
            placeholder={isAr ? 'نص الإشعار...' : 'Notification message...'}
            className="w-full p-3 rounded-lg bg-[#070A0F] border border-white/12 text-xs"
          />
          <button
            type="submit"
            className="px-4 py-2 rounded-xl border border-[#D4AF37]/40 text-[#E5C158] text-xs font-bold cursor-pointer"
          >
            {isAr ? 'إرسال الآن' : 'Broadcast Now'}
          </button>
        </form>

        {savedNotice && <div className="text-xs text-[#10B981]">{savedNotice}</div>}
      </div>
    </AdminGuard>
  );
}
