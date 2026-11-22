/**
 * FilterDrawer — Collapsible Advanced Analytical Filters Bar (`Filtres +`).
 */

import React from "react";
import { RotateCcw, X } from "lucide-react";
import type { FilterOptionsData } from "../api/types";
import { useT } from "../i18n";
import { useV4Store } from "../store/useV4Store";

export interface FilterDrawerProps {
  open: boolean;
  onClose: () => void;
  options: FilterOptionsData | null;
  hasIncognito?: boolean;
}

export const FilterDrawer: React.FC<FilterDrawerProps> = ({ open, onClose, options, hasIncognito }) => {
  const { t } = useT();
  const filters = useV4Store((s) => s.filters);
  const setFilters = useV4Store((s) => s.setFilters);
  const resetFilters = useV4Store((s) => s.resetFilters);

  if (!open) return null;

  return (
    <div
      data-testid="filter-drawer"
      className="bg-bg-2 border-b border-line px-4 sm:px-7 py-4 text-xs"
    >
      <div className="max-w-[1440px] mx-auto space-y-4">
        <div className="flex items-center justify-between">
          <span className="kicker text-amber">{t("filter.title")}</span>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={resetFilters}
              data-testid="filter-reset-btn"
              className="btn text-[11px] h-7 px-2.5"
            >
              <RotateCcw className="w-3 h-3" />
              {t("filter.reset")}
            </button>
            <button
              type="button"
              onClick={onClose}
              aria-label={t("filter.close")}
              className="p-1 text-ink-3 hover:text-ink"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
          {/* Month */}
          <label className="flex flex-col gap-1">
            <span className="kicker">{t("filter.month")}</span>
            <select
              value={filters.period_mode === "month" ? filters.month : ""}
              onChange={(e) => {
                const v = e.target.value;
                if (v) setFilters({ period_mode: "month", year: "all", month: v });
                else setFilters({ period_mode: "all", month: "" });
              }}
              className="field text-xs"
            >
              <option value="">{t("filter.allMonths")}</option>
              {(options?.months || []).slice(0, 48).map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>
          </label>

          {/* Season */}
          <label className="flex flex-col gap-1">
            <span className="kicker">{t("filter.season")}</span>
            <select
              value={filters.period_mode === "season" ? filters.season : ""}
              onChange={(e) => {
                const v = e.target.value;
                if (v) setFilters({ period_mode: "season", year: "all", season: v });
                else setFilters({ period_mode: "all", season: "" });
              }}
              className="field text-xs"
            >
              <option value="">{t("filter.allSeasons")}</option>
              {(options?.seasons || ["Hiver", "Printemps", "Été", "Automne"]).map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </label>

          {/* Custom Date Range */}
          <label className="flex flex-col gap-1">
            <span className="kicker">{t("filter.dateFrom")}</span>
            <input
              type="date"
              value={filters.date_from}
              onChange={(e) =>
                setFilters({
                  period_mode: e.target.value || filters.date_to ? "custom" : "all",
                  year: "all",
                  date_from: e.target.value,
                })
              }
              className="field text-xs"
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="kicker">{t("filter.dateTo")}</span>
            <input
              type="date"
              value={filters.date_to}
              onChange={(e) =>
                setFilters({
                  period_mode: e.target.value || filters.date_from ? "custom" : "all",
                  year: "all",
                  date_to: e.target.value,
                })
              }
              className="field text-xs"
            />
          </label>

          {/* Genre */}
          <label className="flex flex-col gap-1">
            <span className="kicker">{t("filter.genre")}</span>
            <select
              value={filters.genre}
              onChange={(e) => setFilters({ genre: e.target.value })}
              className="field text-xs"
            >
              <option value="">{t("filter.allGenres")}</option>
              {(options?.genres || []).map((g) => (
                <option key={g} value={g}>
                  {g}
                </option>
              ))}
            </select>
          </label>

          {/* Device */}
          <label className="flex flex-col gap-1">
            <span className="kicker">{t("filter.device")}</span>
            <select
              value={filters.device}
              onChange={(e) => setFilters({ device: e.target.value })}
              className="field text-xs"
            >
              <option value="">{t("filter.allDevices")}</option>
              {(options?.devices || []).map((d) => (
                <option key={d} value={d}>
                  {d}
                </option>
              ))}
            </select>
          </label>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 items-end">
          {/* Skip rule */}
          <label className="flex flex-col gap-1">
            <span className="kicker">{t("filter.skipRule")}</span>
            <select
              value={filters.skip_mode}
              onChange={(e) => setFilters({ skip_mode: e.target.value as "lastfm" | "all" | "custom" })}
              className="field text-xs"
            >
              <option value="lastfm">{t("filter.skipLastfm")}</option>
              <option value="all">{t("filter.skipAll")}</option>
              <option value="custom">{t("filter.skipCustom")}</option>
            </select>
          </label>

          {filters.skip_mode === "custom" && (
            <>
              <label className="flex flex-col gap-1">
                <span className="kicker">{t("filter.minSeconds")}</span>
                <input
                  type="number"
                  min={0}
                  max={600}
                  value={filters.min_seconds}
                  onChange={(e) => setFilters({ min_seconds: Number(e.target.value) || 0 })}
                  className="field text-xs num"
                />
              </label>
              <label className="flex flex-col gap-1">
                <span className="kicker">{t("filter.minCompletion")}</span>
                <input
                  type="number"
                  min={0}
                  max={100}
                  value={filters.min_completion_pct}
                  onChange={(e) => setFilters({ min_completion_pct: Number(e.target.value) || 0 })}
                  className="field text-xs num"
                />
              </label>
            </>
          )}

          {/* Ranking Metric */}
          <label className="flex flex-col gap-1">
            <span className="kicker">{t("filter.metric")}</span>
            <select
              value={filters.metric}
              onChange={(e) => setFilters({ metric: e.target.value as "ms" | "plays" })}
              className="field text-xs"
            >
              <option value="ms">{t("filter.metricMs")}</option>
              <option value="plays">{t("filter.metricPlays")}</option>
            </select>
          </label>

          {/* Offline */}
          <label className="flex flex-col gap-1">
            <span className="kicker">{t("filter.offline")}</span>
            <select
              value={filters.offline}
              onChange={(e) => setFilters({ offline: e.target.value as "" | "true" | "false" })}
              className="field text-xs"
            >
              <option value="">{t("filter.offlineAll")}</option>
              <option value="true">{t("filter.offlineOnly")}</option>
              <option value="false">{t("filter.onlineOnly")}</option>
            </select>
          </label>

          {hasIncognito && (
            <label className="flex items-center gap-2 text-ink-2 cursor-pointer col-span-2 pb-1">
              <input
                type="checkbox"
                checked={filters.exclude_incognito}
                onChange={(e) => setFilters({ exclude_incognito: e.target.checked })}
                className="accent-amber"
              />
              <span>{t("filter.excludeIncognito")}</span>
            </label>
          )}
        </div>
      </div>
    </div>
  );
};
