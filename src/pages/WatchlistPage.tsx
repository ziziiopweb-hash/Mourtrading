import React, { useState } from 'react';
import { Plus, Star, Trash2, TrendingDown, TrendingUp } from 'lucide-react';
import { useApp } from '../contexts/AppContext.tsx';
import { formatCompactVolume, formatPercent, formatPrice } from '../lib/formatters.ts';

export function WatchlistPage() {
  const { language, t, navigate, watchlist, toggleWatchlist, tickers, tickerMap, user } = useApp();
  const isAr = language === 'ar';
  const [addInput, setAddInput] = useState('');

  const handleAdd = (e: React.FormEvent) => {
    e.preventDefault();
    const clean = addInput.trim().toUpperCase();
    if (!clean) return;
    const pair = clean.endsWith('USDT') ? clean : `${clean}USDT`;
    if (!watchlist.includes(pair)) {
      toggleWatchlist(pair);
    }
    setAddInput('');
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-[#F8FAFC] flex items-center gap-2.5">
            <Star className="w-6 h-6 text-[#D4AF37]" />
            <span>{t.nav.watchlist}</span>
          </h1>
          <p className="text-xs text-slate-400 mt-1">
            {user
              ? isAr
                ? 'مفضلتك متزامنة مع حسابك في Supabase PostgreSQL.'
                : 'Synced to your Supabase PostgreSQL account.'
              : isAr
                ? 'محفوظة محلياً في المتصفح — سجّل دخولك للمزامنة السحابية.'
                : 'Saved locally — sign in to sync across devices.'}
          </p>
        </div>

        <form onSubmit={handleAdd} className="flex items-center gap-2">
          <input
            type="text"
            dir="ltr"
            list="wl-pairs"
            value={addInput}
            onChange={(e) => setAddInput(e.target.value)}
            placeholder="BTCUSDT"
            className="min-h-[40px] px-3 rounded-xl bg-[#0D131F] border border-white/12 text-sm font-mono-num text-[#F8FAFC]"
          />
          <datalist id="wl-pairs">
            {tickers.slice(0, 100).map((tk) => (
              <option key={tk.symbol} value={tk.symbol} />
            ))}
          </datalist>
          <button
            type="submit"
            className="min-h-[40px] px-4 rounded-xl bg-[#D4AF37] hover:bg-[#E5C158] text-[#070A0F] text-xs font-bold flex items-center gap-1 cursor-pointer"
          >
            <Plus className="w-4 h-4" />
            <span>{t.common.add}</span>
          </button>
        </form>
      </div>

      {watchlist.length === 0 ? (
        <div className="bg-[#0D131F] border border-white/10 rounded-xl p-10 text-center text-sm text-slate-400">
          {isAr ? 'قائمة المفضلة فارغة.' : 'Your watchlist is empty.'}
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {watchlist.map((sym) => {
            const tk = tickerMap.get(sym);
            const up = (tk?.priceChangePercent ?? 0) >= 0;
            return (
              <div
                key={sym}
                className="bg-[#0D131F] border border-white/10 rounded-xl p-4 flex flex-col justify-between gap-3"
              >
                <div className="flex items-start justify-between">
                  <button
                    onClick={() => navigate(`/coin/${sym}`)}
                    className="font-mono-num text-base font-bold text-[#F8FAFC] hover:text-[#D4AF37] cursor-pointer"
                  >
                    {sym}
                  </button>
                  <button
                    onClick={() => toggleWatchlist(sym)}
                    className="p-1 text-slate-500 hover:text-[#EF4444] cursor-pointer"
                    aria-label="Remove from watchlist"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>

                {tk ? (
                  <div className="flex items-end justify-between font-mono-num">
                    <div>
                      <div className="text-xl font-bold text-[#F8FAFC]">${formatPrice(tk.lastPrice)}</div>
                      <div className="text-[11px] text-slate-500">
                        Vol: {formatCompactVolume(tk.quoteVolume)}
                      </div>
                    </div>
                    <div className={`text-xs font-semibold flex items-center gap-1 ${up ? 'text-[#10B981]' : 'text-[#EF4444]'}`}>
                      {up ? <TrendingUp className="w-3.5 h-3.5" /> : <TrendingDown className="w-3.5 h-3.5" />}
                      {formatPercent(tk.priceChangePercent)}
                    </div>
                  </div>
                ) : (
                  <div className="text-xs text-slate-500">{t.common.loading}</div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
