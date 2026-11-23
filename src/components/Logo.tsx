import React from 'react';

export function MourLogo({ compact = false }: { compact?: boolean }) {
  return (
    <div className="flex items-center gap-2.5 shrink-0 select-none">
      <svg
        width="32"
        height="32"
        viewBox="0 0 64 64"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        className="shrink-0"
        aria-hidden="true"
      >
        <rect width="64" height="64" rx="14" fill="#0D131F" />
        <rect x="2" y="2" width="60" height="60" rx="12" stroke="#D4AF37" strokeOpacity="0.45" strokeWidth="1.5" />
        <path
          d="M14 44V20L25 32L32 22L39 32L50 20V44"
          stroke="#D4AF37"
          strokeWidth="4"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <path
          d="M25 44L32 34L39 44"
          stroke="#10B981"
          strokeWidth="3.2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
      {!compact && (
        <span className="text-lg font-bold tracking-tight text-[#F8FAFC] whitespace-nowrap">
          Mour<span className="text-[#D4AF37]">Trading</span>
        </span>
      )}
    </div>
  );
}
