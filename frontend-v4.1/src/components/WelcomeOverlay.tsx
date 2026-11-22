/**
 * WelcomeOverlay — Guided First Launch & 1-Click Demo Library Mode.
 * Shown when `has_data === false` and user is not on the Archives/Hub tab.
 */

import React, { useState } from "react";
import { Disc3, Sparkles, Upload } from "lucide-react";
import { apiPost } from "../api/client";
import { useT } from "../i18n";
import { invalidateApiCache } from "../hooks/useApi";
import { useV4Store } from "../store/useV4Store";

export interface WelcomeOverlayProps {
  onLoaded: () => Promise<void>;
}

export const WelcomeOverlay: React.FC<WelcomeOverlayProps> = ({ onLoaded }) => {
  const { t } = useT();
  const setActiveTab = useV4Store((s) => s.setActiveTab);
  const [loadingDemo, setLoadingDemo] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleLoadDemo = async () => {
    setLoadingDemo(true);
    setError(null);
    try {
      await apiPost("/api/v4/demo/load");
      invalidateApiCache();
      await onLoaded();
      setActiveTab("studio");
    } catch (err: any) {
      setError(err?.message || "Impossible de charger la démo.");
    } finally {
      setLoadingDemo(false);
    }
  };

  return (
    <div
      data-testid="welcome-screen"
      className="fixed inset-0 z-30 bg-bg/92 backdrop-blur-sm flex items-center justify-center p-5"
    >
      <div className="max-w-xl w-full panel-raised p-7 sm:p-10 space-y-6 text-center">
        <div className="w-12 h-12 rounded-full bg-bg-3 border border-amber/40 flex items-center justify-center mx-auto text-amber">
          <Disc3 className="w-6 h-6" />
        </div>
        <div className="space-y-2">
          <p className="kicker text-amber">{t("welcome.kicker")}</p>
          <h1 className="font-display text-3xl sm:text-4xl font-[450] text-ink">{t("welcome.title")}</h1>
          <p className="text-sm text-ink-2 leading-relaxed">{t("welcome.subtitle")}</p>
        </div>

        <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-center gap-3 pt-2">
          <button
            type="button"
            onClick={() => setActiveTab("hub")}
            className="btn btn-primary justify-center h-10 px-5 text-xs"
          >
            <Upload className="w-4 h-4" />
            {t("welcome.importBtn")}
          </button>
          <button
            type="button"
            onClick={handleLoadDemo}
            disabled={loadingDemo}
            data-testid="load-demo-btn"
            className="btn justify-center h-10 px-5 text-xs"
          >
            <Sparkles className="w-4 h-4 text-amber" />
            {loadingDemo ? t("welcome.demoLoading") : t("welcome.demoBtn")}
          </button>
        </div>

        {error && <p className="text-xs text-ember num">{error}</p>}
      </div>
    </div>
  );
};
