/**
 * LyricsPanel — Synchronized LRCLIB Lyrics Overlay synced to `playbackClock`.
 */

import React, { useEffect, useMemo, useRef, useState } from "react";
import { Music2, X } from "lucide-react";
import { apiGet } from "../api/client";
import type { LyricsData } from "../api/types";
import { usePlaybackClock } from "../audio/playbackClock";
import { useT } from "../i18n";
import { useV4Store } from "../store/useV4Store";

function parseLrcTimeMs(ts: string): number {
  const m = ts.match(/^(\d+):(\d+(?:\.\d+)?)$/);
  if (!m) return 0;
  return Math.round((Number(m[1]) * 60 + Number(m[2])) * 1000);
}

export const LyricsPanel: React.FC<{ open: boolean; onClose: () => void }> = ({ open, onClose }) => {
  const { t } = useT();
  const nowPlaying = useV4Store((s) => s.nowPlaying);
  const requestSeekMs = useV4Store((s) => s.requestSeekMs);
  const { positionMs } = usePlaybackClock(250);

  const [data, setData] = useState<LyricsData | null>(null);
  const [loading, setLoading] = useState(false);
  const activeLineRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    if (!open || !nowPlaying?.song_name) return;
    let cancelled = false;
    setLoading(true);
    const qs = new URLSearchParams({
      song: nowPlaying.song_name,
      artist: nowPlaying.artist_name || "",
      album: nowPlaying.album_name || "",
    });
    apiGet<LyricsData>(`/api/external/lyrics?${qs.toString()}`)
      .then((res) => {
        if (!cancelled) setData(res);
      })
      .catch(() => {
        if (!cancelled) setData({ found: false, plain_lyrics: null, synced_lines: [] });
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, nowPlaying?.song_name, nowPlaying?.artist_name, nowPlaying?.album_name]);

  const syncedParsed = useMemo(
    () =>
      (data?.synced_lines || []).map((l) => ({
        ms: parseLrcTimeMs(l.time),
        time: l.time,
        text: l.text,
      })),
    [data]
  );

  const activeIndex = useMemo(() => {
    if (syncedParsed.length === 0) return -1;
    let idx = 0;
    for (let i = 0; i < syncedParsed.length; i++) {
      if (syncedParsed[i].ms <= positionMs + 250) idx = i;
      else break;
    }
    return idx;
  }, [syncedParsed, positionMs]);

  useEffect(() => {
    activeLineRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [activeIndex]);

  if (!open) return null;

  return (
    <div
      data-testid="lyrics-panel"
      className="fixed bottom-16 left-4 sm:left-7 z-50 w-80 sm:w-96 max-h-[60vh] flex flex-col bg-bg-2 border border-line-2 rounded-lg shadow-2xl overflow-hidden"
    >
      <div className="flex items-center justify-between px-4 py-2.5 border-b border-line bg-bg-3">
        <div className="min-w-0">
          <p className="kicker text-amber flex items-center gap-1.5">
            <Music2 className="w-3 h-3" /> {t("player.lyricsTitle")}
          </p>
          {nowPlaying && (
            <p className="text-xs font-medium text-ink truncate mt-0.5">
              {nowPlaying.song_name} — {nowPlaying.artist_name}
            </p>
          )}
        </div>
        <button onClick={onClose} className="text-ink-3 hover:text-ink p-1" aria-label={t("drawer.close")}>
          <X className="w-4 h-4" />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-2 text-sm">
        {loading && <p className="text-xs text-ink-3 text-center py-6">{t("common.loading")}</p>}
        {!loading && data?.instrumental && (
          <p className="text-xs text-ink-3 text-center py-6">{t("player.lyricsInstrumental")}</p>
        )}
        {!loading && (!data || !data.found) && (
          <p className="text-xs text-ink-3 text-center py-6">{t("player.lyricsNotFound")}</p>
        )}
        {!loading && data?.found && syncedParsed.length > 0 && (
          <div className="space-y-1.5">
            {syncedParsed.map((line, i) => {
              const active = i === activeIndex;
              return (
                <button
                  type="button"
                  key={`${line.time}-${i}`}
                  ref={active ? activeLineRef : undefined}
                  onClick={() => requestSeekMs(line.ms)}
                  className={`w-full text-left px-2 py-1 rounded transition-colors ${
                    active ? "text-amber font-semibold bg-bg-3" : "text-ink-2 hover:text-ink"
                  }`}
                >
                  {line.text}
                </button>
              );
            })}
          </div>
        )}
        {!loading && data?.found && syncedParsed.length === 0 && data.plain_lyrics && (
          <pre className="whitespace-pre-wrap font-sans text-xs leading-relaxed text-ink-2">
            {data.plain_lyrics}
          </pre>
        )}
      </div>
    </div>
  );
};
