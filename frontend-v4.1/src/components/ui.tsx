/**
 * UI primitives for the analytics pages ("liner notes" editorial style).
 * Solid surfaces, thin rules, serif headings, mono figures. No glass, no gradients-as-decoration.
 */

import React from "react";
import { Disc3, Play } from "lucide-react";
import { coverUrl } from "../api/client";

export const Page: React.FC<{ title: string; kicker?: string; intro?: React.ReactNode; actions?: React.ReactNode; children: React.ReactNode }> = ({
  title,
  kicker,
  intro,
  actions,
  children,
}) => (
  <div className="max-w-[1240px] mx-auto px-5 sm:px-8 pt-8 pb-32 fade-in">
    <header className="flex flex-wrap items-end justify-between gap-4 mb-8">
      <div className="max-w-2xl">
        {kicker && <p className="kicker mb-2">{kicker}</p>}
        <h1 className="font-display text-[34px] sm:text-[42px] leading-[1.05] font-[450] tracking-[-0.01em]">{title}</h1>
        {intro && <p className="mt-3 text-[14px] leading-relaxed text-ink-2">{intro}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </header>
    {children}
  </div>
);

export const InfoTooltip: React.FC<{ text: string; label?: string }> = ({ text, label = "Explication" }) => (
  <span className="relative inline-flex items-center group align-middle ml-1.5">
    <button
      type="button"
      aria-label={`${label} : ${text}`}
      className="inline-flex items-center justify-center w-[15px] h-[15px] rounded-full border border-line-2 text-[10px] font-mono leading-none text-ink-3 hover:text-amber hover:border-amber focus:text-amber focus:border-amber focus:outline-none transition-colors cursor-help"
    >
      ?
    </button>
    <span
      role="tooltip"
      className="pointer-events-none opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 transition-opacity duration-150 absolute bottom-full left-1/2 -translate-x-1/2 mb-2 z-50 w-64 max-w-[80vw] rounded bg-bg-2 border border-line-2 px-3 py-2 text-[11.5px] leading-snug font-sans font-normal normal-case tracking-normal text-ink-2 shadow-xl text-left"
    >
      {text}
    </span>
  </span>
);

export const Section: React.FC<{
  title?: React.ReactNode;
  kicker?: React.ReactNode;
  aside?: React.ReactNode;
  className?: string;
  children: React.ReactNode;
}> = ({ title, kicker, aside, className = "", children }) => (
  <section className={`panel p-5 sm:p-6 ${className}`}>
    {(title || kicker || aside) && (
      <div className="flex items-start justify-between gap-3 mb-4">
        <div>
          {kicker && <p className="kicker mb-1">{kicker}</p>}
          {title && <h2 className="font-display text-[20px] font-[500] leading-tight">{title}</h2>}
        </div>
        {aside}
      </div>
    )}
    {children}
  </section>
);

export const Stat: React.FC<{ label: React.ReactNode; value: React.ReactNode; sub?: React.ReactNode; accent?: boolean }> = ({
  label,
  value,
  sub,
  accent,
}) => (
  <div className="py-1">
    <p className="kicker">{label}</p>
    <p className={`font-display text-[30px] sm:text-[36px] leading-none mt-2 font-[420] num-sans ${accent ? "text-amber" : ""}`}>
      {value}
    </p>
    {sub && <p className="text-[12px] text-ink-3 mt-1.5">{sub}</p>}
  </div>
);

export const Cover: React.FC<{ url?: string | null; alt?: string; size?: number; className?: string; rounded?: boolean }> = ({
  url,
  alt = "",
  size = 48,
  className = "",
  rounded = false,
}) => {
  const src = coverUrl(url, size <= 64 ? 120 : size <= 160 ? 300 : 600);
  return (
    <div
      className={`shrink-0 overflow-hidden bg-bg-4 ${rounded ? "rounded-full" : "rounded-[3px]"} ${className}`}
      style={{ width: size, height: size }}
    >
      {src ? (
        <img src={src} alt={alt} loading="lazy" decoding="async" className="w-full h-full object-cover" />
      ) : (
        <div className="w-full h-full flex items-center justify-center text-ink-3">
          <Disc3 style={{ width: size * 0.45, height: size * 0.45 }} />
        </div>
      )}
    </div>
  );
};

/** Horizontal bar list — the workhorse chart. */
export const BarList: React.FC<{
  items: Array<{ key: string; label: React.ReactNode; value: number; display?: React.ReactNode; sub?: React.ReactNode; cover?: string | null }>;
  max?: number;
  color?: string;
}> = ({ items, max, color = "var(--color-amber)" }) => {
  const m = max ?? Math.max(1, ...items.map((i) => i.value));
  return (
    <ul className="space-y-2.5">
      {items.map((it) => (
        <li key={it.key} className="flex items-center gap-3">
          {it.cover !== undefined && <Cover url={it.cover} size={32} />}
          <div className="flex-1 min-w-0">
            <div className="flex items-baseline justify-between gap-3 text-[13px]">
              <span className="truncate">{it.label}</span>
              <span className="num text-[12px] text-ink-2 shrink-0">{it.display ?? it.value}</span>
            </div>
            <div className="mt-1 h-[3px] bg-bg-4 rounded-full overflow-hidden">
              <div className="h-full rounded-full" style={{ width: `${Math.max(1.5, (it.value / m) * 100)}%`, background: color }} />
            </div>
            {it.sub && <p className="text-[11px] text-ink-3 mt-1 truncate">{it.sub}</p>}
          </div>
        </li>
      ))}
    </ul>
  );
};

export const PlayButton: React.FC<{ onClick: () => void; title?: string; size?: number }> = ({ onClick, title = "Écouter", size = 28 }) => (
  <button
    onClick={(e) => {
      e.stopPropagation();
      onClick();
    }}
    title={title}
    aria-label={title}
    className="shrink-0 inline-flex items-center justify-center rounded-full border border-line-2 text-ink-2 hover:text-bg hover:bg-amber hover:border-amber transition-colors"
    style={{ width: size, height: size }}
  >
    <Play style={{ width: size * 0.42, height: size * 0.42 }} className="translate-x-[1px]" fill="currentColor" />
  </button>
);

export const Loading: React.FC<{ rows?: number; className?: string }> = ({ rows = 4, className = "" }) => (
  <div className={`space-y-3 ${className}`}>
    {Array.from({ length: rows }).map((_, i) => (
      <div key={i} className="skeleton h-5" style={{ width: `${92 - i * 9}%` }} />
    ))}
  </div>
);

export const ErrorNote: React.FC<{ message: string; onRetry?: () => void }> = ({ message, onRetry }) => (
  <div className="panel p-5 flex items-center justify-between gap-4 border-ember/40">
    <div>
      <p className="text-[13px] text-ink">Impossible de charger ces données.</p>
      <p className="text-[12px] text-ink-3 mt-1 num break-all">{message}</p>
    </div>
    {onRetry && (
      <button className="btn" onClick={onRetry}>
        Réessayer
      </button>
    )}
  </div>
);

export const Empty: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <p className="text-[13px] text-ink-3 py-6 text-center">{children}</p>
);

export const Tabs: React.FC<{ value: string; onChange: (v: string) => void; options: Array<{ id: string; label: string }> }> = ({
  value,
  onChange,
  options,
}) => (
  <div className="flex flex-wrap gap-1.5">
    {options.map((o) => (
      <button key={o.id} className="chip" data-active={value === o.id} onClick={() => onChange(o.id)}>
        {o.label}
      </button>
    ))}
  </div>
);
