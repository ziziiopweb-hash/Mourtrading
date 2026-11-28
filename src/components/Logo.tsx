import React from 'react';

export function MourLogo({ compact = false }: { compact?: boolean }) {
  return (
    <div className="inline-flex items-center gap-2 sm:gap-2.5 shrink-0 select-none">
      <img
        src="/icon-192.png"
        alt="MourTrading"
        className="w-9 h-9 sm:w-10 sm:h-10 rounded-xl object-cover shrink-0 border border-[#D4AF37]/40 shadow-sm"
      />
      {!compact && (
        <span
          dir="ltr"
          className="text-[15px] sm:text-lg font-bold tracking-tight text-[#F8FAFC] whitespace-nowrap leading-none"
        >
          Mour<span className="text-[#D4AF37]">Trading</span>
        </span>
      )}
    </div>
  );
}
