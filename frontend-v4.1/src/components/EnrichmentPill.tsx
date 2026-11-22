/**
 * EnrichmentPill — Discreet header status pill for Pass 2 Enrichment (SSE) & Atlas Jobs.
 * Auto-closes EventSource when enrichment is done/idle so zero wasted background work occurs.
 */

import React, { useCallback, useEffect, useState } from "react";
import { Globe, Pause, Play, Sparkles, X } from "lucide-react";
import { apiGet, apiPost } from "../api/client";
import type { EnrichmentSnapshot, JobsStatusData } from "../api/types";
import { useV4Store } from "../store/useV4Store";

export const EnrichmentPill: React.FC<{ hasData: boolean }> = ({ hasData }) => {
  const [snap, setSnap] = useState<EnrichmentSnapshot | null>(null);
  const [jobs, setJobs] = useState<JobsStatusData["jobs"] | null>(null);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  const refreshStatus = useCallback(async () => {
    try {
      const [enr, jb] = await Promise.all([
        apiGet<EnrichmentSnapshot>("/api/enrichment/status"),
        apiGet<JobsStatusData>("/api/v3/jobs/status"),
      ]);
      setSnap(enr);
      setJobs(jb.jobs);
    } catch {
      /* backend booting */
    }
  }, []);

  useEffect(() => {
    if (!hasData) return;
    let es: EventSource | null = null;
    refreshStatus();

    try {
      es = new EventSource("/api/enrichment/stream");
      es.onmessage = (ev) => {
        try {
          const next = JSON.parse(ev.data) as EnrichmentSnapshot;
          setSnap(next);
          if (!next.running && (next.phase === "done" || next.phase === "stopped" || next.phase === "idle")) {
            es?.close();
            es = null;
          }
        } catch {
          /* ignore */
        }
      };
      es.onerror = () => {
        es?.close();
        es = null;
      };
    } catch {
      /* SSE unavailable */
    }

    return () => {
      es?.close();
    };
  }, [hasData, refreshStatus]);

  if (!hasData || !snap || snap.total === 0) return null;

  const pct = snap.total > 0 ? Math.min(100, Math.round((snap.completed / snap.total) * 100)) : 100;
  const isRunning = Boolean(snap.running || jobs?.running);
  const isIncomplete = snap.completed < snap.total;

  // Hide pill when 100% done and nothing running, unless user opened popover
  if (!isRunning && !isIncomplete && !open) return null;

  const toggleEnrichment = async () => {
    setBusy(true);
    try {
      const next = await apiPost<EnrichmentSnapshot>(snap.running ? "/api/enrichment/stop" : "/api/enrichment/start");
      setSnap(next);
      if (next.running) {
        useV4Store.getState().showToast("Enrichissement relancé en arrière-plan");
      }
    } finally {
      setBusy(false);
    }
  };

  const seedAtlas = async () => {
    setBusy(true);
    try {
      const res = await apiPost<{ ok: boolean; queued: number; status: JobsStatusData["jobs"] }>(
        "/api/v3/jobs/seed?limit=120"
      );
      setJobs(res.status);
      useV4Store.getState().showToast(`Atlas : ${res.queued} artistes mis en file`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="relative shrink-0">
      <button
        type="button"
        onClick={() => {
          setOpen((v) => !v);
          refreshStatus();
        }}
        data-testid="enrichment-status-pill"
        title="Statut de l'enrichissement et de l'Atlas"
        className="inline-flex items-center gap-1.5 h-7 px-2 rounded border border-line-2 bg-bg-3 text-[11px] num text-ink-2 hover:text-ink hover:border-amber/60 whitespace-nowrap transition-colors"
      >
        <span
          className={`w-1.5 h-1.5 rounded-full shrink-0 ${
            isRunning ? "bg-amber animate-pulse" : isIncomplete ? "bg-brass" : "bg-moss"
          }`}
        />
        <span className="hidden md:inline">{isRunning ? `Enrich. ${pct}%` : `Catalogue ${pct}%`}</span>
      </button>

      {open && (
        <div className="absolute left-0 top-full mt-1.5 z-50 w-[min(18rem,calc(100vw-1.5rem))] bg-bg-2 border border-line-2 rounded-lg shadow-2xl p-3.5 text-xs space-y-3">
          <div className="flex items-center justify-between">
            <span className="font-semibold text-ink flex items-center gap-1.5">
              <Sparkles className="w-3.5 h-3.5 text-amber" />
              Enrichissement &amp; Atlas
            </span>
            <button onClick={() => setOpen(false)} className="text-ink-3 hover:text-ink" aria-label="Fermer">
              <X className="w-3.5 h-3.5" />
            </button>
          </div>

          <div className="space-y-1.5">
            <div className="flex justify-between text-[11px] text-ink-2 num">
              <span>Passe 2 ({snap.phase})</span>
              <span>
                {snap.completed} / {snap.total} ({pct}%)
              </span>
            </div>
            <div className="h-1.5 bg-bg-4 rounded-full overflow-hidden">
              <div className="h-full bg-amber transition-all" style={{ width: `${pct}%` }} />
            </div>
            {snap.current_track && (
              <p className="text-[10.5px] text-ink-3 truncate">{snap.current_track}</p>
            )}
          </div>

          {jobs && (
            <div className="p-2 rounded bg-bg-3 border border-line flex items-center justify-between text-[11px]">
              <span className="flex items-center gap-1.5 text-ink-2">
                <Globe className="w-3 h-3 text-brass" />
                Atlas ({jobs.completed} faits · {jobs.pending} en attente)
              </span>
            </div>
          )}

          <div className="flex items-center gap-2 pt-1">
            <button
              type="button"
              disabled={busy}
              onClick={toggleEnrichment}
              className="btn flex-1 justify-center text-[11px] h-7"
            >
              {snap.running ? (
                <>
                  <Pause className="w-3 h-3" /> Pause
                </>
              ) : (
                <>
                  <Play className="w-3 h-3" /> Relancer
                </>
              )}
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={seedAtlas}
              className="btn flex-1 justify-center text-[11px] h-7"
            >
              <Globe className="w-3 h-3" /> Atlas
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
