import { useMemo, useRef, useState } from "react";
import { Download, History, Layers, Search as SearchIcon } from "lucide-react";
import {
  API,
  buildQueryParams,
  formatDurationMs,
  formatHours,
  formatInt,
} from "../api/client";
import type { HistoryData, SessionsData } from "../api/types";
import { playTrack } from "../audio/playTrack";
import { useApi } from "../hooks/useApi";
import { useT } from "../i18n";
import { useV4Store } from "../store/useV4Store";
import { Cover, Empty, Loading, PlayButton } from "./ui";

const ROW_HEIGHT = 56;
const VIEWPORT_HEIGHT = 520;
const OVERSCAN = 6;

export function HistorySessionsPanel({
  initialMode = "sessions",
}: {
  initialMode?: "sessions" | "history";
}) {
  const { t } = useT();
  const filters = useV4Store((s) => s.filters);
  const openDrawer = useV4Store((s) => s.openDrawer);

  const [mode, setMode] = useState<"sessions" | "history">(initialMode);
  const [sessionSort, setSessionSort] = useState<"recent" | "longest" | "plays">("recent");
  const [expandedSession, setExpandedSession] = useState<number | null>(null);

  const [historySort, setHistorySort] = useState<"recent" | "oldest" | "longest">("recent");
  const [historyQuery, setHistoryQuery] = useState("");
  const [scrollTop, setScrollTop] = useState(0);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  const filterQs = buildQueryParams(filters);

  const sessionsUrl =
    mode === "sessions"
      ? `${API.sessions}?limit=60&sort=${sessionSort}&${filterQs}`
      : null;
  const historyUrl =
    mode === "history"
      ? `${API.history}?limit=1000&sort=${historySort}&q=${encodeURIComponent(historyQuery.trim())}&${filterQs}`
      : null;

  const { data: sessionsData, loading: sessionsLoading } = useApi<SessionsData>(sessionsUrl);
  const { data: historyData, loading: historyLoading } = useApi<HistoryData>(historyUrl);

  const items = historyData?.items ?? [];
  const totalHeight = items.length * ROW_HEIGHT;
  const visibleCount = Math.ceil(VIEWPORT_HEIGHT / ROW_HEIGHT);
  const startIndex = Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - OVERSCAN);
  const endIndex = Math.min(items.length, startIndex + visibleCount + OVERSCAN * 2);

  const visibleItems = useMemo(
    () => items.slice(startIndex, endIndex),
    [items, startIndex, endIndex],
  );

  const csvUrl = `${API.historyCsv}?${filterQs}${
    historyQuery.trim() ? `&q=${encodeURIComponent(historyQuery.trim())}` : ""
  }`;

  return (
    <div className="space-y-4">
      {/* Mode switcher */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-1.5 bg-white/[0.03] border border-white/10 rounded-xl p-1">
          <button
            type="button"
            onClick={() => setMode("sessions")}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium flex items-center gap-1.5 transition ${
              mode === "sessions"
                ? "bg-white text-black"
                : "text-zinc-400 hover:text-white"
            }`}
          >
            <Layers className="w-3.5 h-3.5" />
            {t("search.tabSessions")}
          </button>
          <button
            type="button"
            onClick={() => setMode("history")}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium flex items-center gap-1.5 transition ${
              mode === "history"
                ? "bg-white text-black"
                : "text-zinc-400 hover:text-white"
            }`}
          >
            <History className="w-3.5 h-3.5" />
            {t("search.tabHistory")}
          </button>
        </div>

        {mode === "sessions" ? (
          <select
            value={sessionSort}
            onChange={(e) => setSessionSort(e.target.value as "recent" | "longest" | "plays")}
            className="bg-white/[0.04] border border-white/10 rounded-lg px-2.5 py-1.5 text-xs text-zinc-200"
          >
            <option value="recent">{t("sessions.recent")}</option>
            <option value="longest">{t("sessions.longest")}</option>
            <option value="plays">{t("sessions.mostPlays")}</option>
          </select>
        ) : (
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative">
              <SearchIcon className="w-3.5 h-3.5 text-zinc-500 absolute left-2.5 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={historyQuery}
                onChange={(e) => {
                  setHistoryQuery(e.target.value);
                  setScrollTop(0);
                  if (scrollRef.current) scrollRef.current.scrollTop = 0;
                }}
                placeholder={t("history.placeholder")}
                className="pl-8 pr-3 py-1.5 bg-white/[0.04] border border-white/10 rounded-lg text-xs text-white placeholder-zinc-500 focus:outline-none focus:border-white/30"
              />
            </div>
            <select
              value={historySort}
              onChange={(e) => setHistorySort(e.target.value as "recent" | "oldest" | "longest")}
              className="bg-white/[0.04] border border-white/10 rounded-lg px-2.5 py-1.5 text-xs text-zinc-200"
            >
              <option value="recent">{t("sessions.recent")}</option>
              <option value="oldest">Oldest</option>
              <option value="longest">{t("sessions.longest")}</option>
            </select>
            <a
              href={csvUrl}
              download="amdatawrap-history.csv"
              className="px-3 py-1.5 rounded-lg bg-white/10 hover:bg-white/15 border border-white/15 text-xs text-white flex items-center gap-1.5 transition"
            >
              <Download className="w-3.5 h-3.5" />
              {t("history.exportCsv")}
            </a>
          </div>
        )}
      </div>

      {/* Sessions view */}
      {mode === "sessions" && (
        <div className="space-y-2.5">
          {sessionsLoading && <Loading />}
          {!sessionsLoading && (!sessionsData || sessionsData.items.length === 0) && (
            <Empty>{t("common.noData")}</Empty>
          )}
          {sessionsData?.items.map((s) => {
            const isOpen = expandedSession === s.session_id;
            return (
              <div
                key={s.session_id}
                className="rounded-xl border border-white/10 bg-white/[0.02] overflow-hidden"
              >
                <div
                  onClick={() =>
                    setExpandedSession(isOpen ? null : s.session_id)
                  }
                  className="px-4 py-3 flex flex-wrap items-center justify-between gap-3 cursor-pointer hover:bg-white/[0.03] transition"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        openDrawer({ type: "day", date: s.local_date });
                      }}
                      className="text-xs font-mono px-2 py-1 rounded bg-white/5 hover:bg-white/15 text-zinc-200 transition"
                    >
                      {s.local_date}
                    </button>
                    <div className="text-xs text-zinc-400 truncate">
                      {s.start_local.slice(11, 16)} → {s.end_local.slice(11, 16)}
                      {s.device_label ? ` · ${s.device_label}` : ""}
                      {s.playlist_name ? ` · ${s.playlist_name}` : ""}
                    </div>
                  </div>
                  <div className="flex items-center gap-4 text-xs font-mono text-zinc-300 shrink-0">
                    <span>{formatInt(s.plays)} {t("common.plays")}</span>
                    <span>{formatHours(s.total_ms)}</span>
                    <span className="text-zinc-500">{isOpen ? "−" : "+"}</span>
                  </div>
                </div>

                {isOpen && s.tracks.length > 0 && (
                  <div className="border-t border-white/10 divide-y divide-white/[0.05] bg-black/20">
                    {s.tracks.map((tr, idx) => (
                      <div
                        key={`${s.session_id}-${idx}`}
                        className="px-4 py-2 flex items-center gap-3"
                      >
                        <Cover
                          url={tr.artwork_url}
                          alt={tr.song_name}
                          size={32}
                        />
                        <div className="min-w-0 flex-1">
                          <div className="text-xs text-zinc-100 truncate">
                            {tr.song_name}
                          </div>
                          <div className="text-[11px] text-zinc-500 truncate">
                            {tr.artist_name || "—"} · {tr.album_name}
                          </div>
                        </div>
                        <span className="text-[11px] font-mono text-zinc-500">
                          {tr.started_at_local.slice(11, 16)} · {Math.round(tr.completion_ratio * 100)}%
                        </span>
                        <PlayButton
                          onClick={() =>
                            playTrack({
                              song_name: tr.song_name,
                              artist_name: tr.artist_name || "",
                              album_name: tr.album_name || "",
                              artwork_url: tr.artwork_url,
                              preview_url: tr.preview_url,
                            })
                          }
                          size={26}
                        />
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Virtualized History view */}
      {mode === "history" && (
        <div className="rounded-xl border border-white/10 bg-white/[0.02] overflow-hidden">
          <div className="px-4 py-2 border-b border-white/10 flex items-center justify-between text-[11px] font-mono text-zinc-400">
            <span>
              {historyData
                ? `${formatInt(historyData.total)} ${t("history.rowsCount")}`
                : "…"}
            </span>
            <span>{items.length > 0 ? `${items.length}` : ""}</span>
          </div>

          {historyLoading ? (
            <div className="p-6">
              <Loading />
            </div>
          ) : items.length === 0 ? (
            <Empty>{t("common.noData")}</Empty>
          ) : (
            <div
              ref={scrollRef}
              onScroll={(e) => setScrollTop(e.currentTarget.scrollTop)}
              style={{ height: VIEWPORT_HEIGHT }}
              className="overflow-y-auto relative"
            >
              <div style={{ height: totalHeight, position: "relative" }}>
                <div
                  style={{
                    transform: `translateY(${startIndex * ROW_HEIGHT}px)`,
                    position: "absolute",
                    left: 0,
                    right: 0,
                    top: 0,
                  }}
                >
                  {visibleItems.map((ev) => (
                    <div
                      key={ev.id}
                      style={{ height: ROW_HEIGHT }}
                      className="px-4 flex items-center gap-3 border-b border-white/[0.04] hover:bg-white/[0.03] transition"
                    >
                      <Cover
                        url={ev.artwork_url}
                        alt={ev.song_name}
                        size={36}
                      />
                      <div className="min-w-0 flex-1">
                        <div className="text-xs text-zinc-100 truncate">
                          {ev.song_name}
                        </div>
                        <div className="text-[11px] text-zinc-500 truncate flex items-center gap-1.5">
                          {ev.artist_group_key ? (
                            <button
                              type="button"
                              onClick={() =>
                                openDrawer({
                                  type: "artist",
                                  key: ev.artist_group_key!,
                                })
                              }
                              className="hover:text-white underline-offset-2 hover:underline truncate"
                            >
                              {ev.artist_name || "—"}
                            </button>
                          ) : (
                            <span>{ev.artist_name || "—"}</span>
                          )}
                          <span>·</span>
                          <button
                            type="button"
                            onClick={() =>
                              openDrawer({
                                type: "album",
                                key: ev.album_group_key,
                              })
                            }
                            className="hover:text-white underline-offset-2 hover:underline truncate"
                          >
                            {ev.album_name}
                          </button>
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() => openDrawer({ type: "day", date: ev.local_date })}
                        className="text-[11px] font-mono text-zinc-400 hover:text-white shrink-0"
                      >
                        {ev.started_at_local.slice(0, 16).replace("T", " ")}
                      </button>
                      <span className="text-[11px] font-mono text-zinc-500 w-12 text-right shrink-0">
                        {formatDurationMs(ev.play_duration_ms)}
                      </span>
                      <PlayButton
                        onClick={() =>
                          playTrack({
                            song_name: ev.song_name,
                            artist_name: ev.artist_name || "",
                            album_name: ev.album_name || "",
                            artwork_url: ev.artwork_url,
                            track_key: ev.track_key,
                            preview_url: ev.preview_url,
                          })
                        }
                        size={26}
                      />
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
