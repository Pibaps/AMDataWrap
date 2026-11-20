/**
 * Unified V2 + V3 Analytical Suite styled in V2 Sonic Odyssey glassmorphism
 * and dynamically driven by the active profile's Capabilities Matrix.
 */

import React, { useEffect, useState } from "react";
import {
  Activity,
  Award,
  Clock,
  FlaskConical,
  Globe,
  Play,
  Search,
  Sparkles,
  UserCheck,
} from "lucide-react";
import { apiGet, buildQueryParams, formatHours, type NavTab } from "../api/client";
import { useV4Store } from "../store/useV4Store";

interface SuiteProps {
  tab: NavTab;
}

export const AnalyticsSuiteView: React.FC<SuiteProps> = ({ tab }) => {
  const filters = useV4Store((s) => s.filters);
  const capabilities = useV4Store((s) => s.capabilities);
  const setNowPlaying = useV4Store((s) => s.setNowPlaying);

  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [searchQ, setSearchQ] = useState("");
  const [searchResults, setSearchResults] = useState<any[]>([]);

  const playQuickTrack = async (song: string, artist: string, album = "") => {
    try {
      const res = await apiGet<any>(
        `/api/v4/playback/resolve?song=${encodeURIComponent(song)}&artist=${encodeURIComponent(artist)}&album=${encodeURIComponent(album)}`
      );
      setNowPlaying({
        song_name: song,
        artist_name: artist,
        album_name: album,
        artwork_url: res.artwork_url || null,
        video_id: res.video_id || null,
        preview_url: res.preview_url || null,
        duration_ms: 200_000,
        position_ms: 0,
        is_playing: true,
        provider: res.video_id ? "youtube_iframe" : "preview_audio",
      });
    } catch {
      // ignore
    }
  };

  useEffect(() => {
    if (tab === "search") return;
    let active = true;
    setLoading(true);
    const qs = buildQueryParams(filters);

    const fetchers: Record<string, () => Promise<any>> = {
      overview: () => apiGet(`/api/overview${qs}`),
      tops: async () => {
        const [artists, albums, tracks] = await Promise.all([
          apiGet(`/api/top/artists${qs}&limit=12`.replace("?&", "?")),
          apiGet(`/api/top/albums${qs}&limit=12`.replace("?&", "?")),
          apiGet(`/api/top/tracks${qs}&limit=15`.replace("?&", "?")),
        ]);
        return { artists, albums, tracks };
      },
      science: async () => {
        const [eras, compass, camelot] = await Promise.all([
          apiGet(`/api/v3/science/eras${qs}`).catch(() => ({ eras: [] })),
          apiGet(`/api/v3/science/compass${qs}`).catch(() => ({ points: [] })),
          apiGet(`/api/v3/science/camelot${qs}`).catch(() => ({ wheel: [] })),
        ]);
        return { eras, compass, camelot };
      },
      chrono: () => apiGet(`/api/chronobiology${qs}`),
      persona: () => apiGet(`/api/persona${qs}`),
      obsessions: () => apiGet(`/api/behavior${qs}`),
      atlas: () => apiGet(`/api/v3/atlas${qs}`),
      wrapped: () => apiGet(`/api/wrapped${qs}`),
    };

    const fn = fetchers[tab];
    if (!fn) {
      setLoading(false);
      return;
    }
    fn()
      .then((res) => {
        if (active) setData(res);
      })
      .catch(() => {
        if (active) setData(null);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [tab, filters]);

  const runSearch = async (q: string) => {
    setSearchQ(q);
    if (q.trim().length < 2) {
      setSearchResults([]);
      return;
    }
    try {
      const res = await apiGet<any>(`/api/v3/search/fts?q=${encodeURIComponent(q.trim())}&limit=25`);
      setSearchResults(res.results || res.items || []);
    } catch {
      setSearchResults([]);
    }
  };

  if (tab === "search") {
    return (
      <div className="max-w-4xl mx-auto px-3 sm:px-6 pb-28">
        <div className="glass-panel rounded-3xl p-6 space-y-4">
          <h1 className="font-display text-2xl font-bold flex items-center gap-2">
            <Search className="w-6 h-6 text-cyan-400" /> Recherche Instantanée FTS5
          </h1>
          <input
            type="text"
            value={searchQ}
            onChange={(e) => runSearch(e.target.value)}
            placeholder="Tape un titre, un artiste ou un album…"
            className="w-full bg-white/10 border border-white/15 rounded-2xl px-4 py-3 text-sm text-white placeholder:text-white/40"
          />
          <div className="space-y-1.5 max-h-[460px] overflow-y-auto">
            {searchResults.map((r: any, idx: number) => (
              <div
                key={idx}
                className="flex items-center justify-between p-3 rounded-2xl bg-white/[0.04] hover:bg-white/[0.08] transition"
              >
                <div className="min-w-0">
                  <p className="font-semibold text-sm truncate">{r.song_name || r.title || r.artist_name}</p>
                  <p className="text-xs text-white/60 truncate">
                    {r.artist_name} {r.album_name ? `· ${r.album_name}` : ""}
                  </p>
                </div>
                {r.song_name && (
                  <button
                    onClick={() => playQuickTrack(r.song_name, r.artist_name || "", r.album_name || "")}
                    className="p-2 rounded-full bg-rose-500/80 hover:bg-rose-500 text-white shrink-0"
                    title="Écouter en entier (0 €)"
                  >
                    <Play className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="max-w-5xl mx-auto px-6 py-12">
        <div className="glass-panel rounded-3xl p-10 text-center text-white/60 text-sm">
          Calcul analytique en cours…
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-6xl mx-auto px-3 sm:px-6 pb-28 space-y-6">
      {/* Transparent Capability Notice when estimated durations exist (e.g. YouTube Music) */}
      {capabilities && capabilities.estimated_duration_pct > 0 && (
        <div className="glass-pill rounded-2xl px-4 py-2.5 text-xs text-amber-200 flex items-center justify-between">
          <span>
            ℹ️ <strong>Durée estimée</strong> sur {capabilities.estimated_duration_pct.toFixed(0)} % des écoutes
            (YouTube Music Takeout).
          </span>
          <span className="font-mono-num text-[11px] opacity-75">{capabilities.platforms.join(" + ")}</span>
        </div>
      )}

      {tab === "overview" && data && (
        <div className="space-y-6">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3.5">
            {[
              { label: "Écoutes totales", value: (data.kpis?.total_plays || 0).toLocaleString("fr-FR") },
              { label: "Temps d'écoute", value: formatHours(data.kpis?.total_ms || 0) },
              { label: "Artistes uniques", value: (data.kpis?.unique_artists || 0).toLocaleString("fr-FR") },
              { label: "Titres uniques", value: (data.kpis?.unique_tracks || 0).toLocaleString("fr-FR") },
            ].map((k) => (
              <div key={k.label} className="glass-panel rounded-2xl p-4">
                <p className="text-[11px] font-mono-num text-white/55 uppercase">{k.label}</p>
                <p className="font-display text-2xl sm:text-3xl font-extrabold mt-1">{k.value}</p>
              </div>
            ))}
          </div>
          <div className="glass-panel rounded-3xl p-5">
            <h2 className="font-display text-lg font-bold mb-3 flex items-center gap-2">
              <Activity className="w-5 h-5 text-rose-400" /> Évolution Mensuelle
            </h2>
            <div className="grid grid-cols-2 sm:grid-cols-4 md:grid-cols-6 gap-2 text-xs font-mono-num">
              {(data.monthly || []).slice(-12).map((m: any) => (
                <div key={m.month} className="bg-white/[0.04] rounded-xl p-2.5">
                  <p className="text-white/55">{m.month}</p>
                  <p className="font-bold text-sm text-rose-200">{m.plays} plays</p>
                  <p className="text-[11px] text-white/60">{formatHours(m.total_ms || 0)}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {tab === "tops" && data && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
          <div className="glass-panel rounded-3xl p-5">
            <h2 className="font-display text-lg font-bold mb-3 flex items-center gap-2">
              <Award className="w-5 h-5 text-rose-400" /> Top Artistes
            </h2>
            <div className="space-y-2 text-xs">
              {(data.artists?.items || []).map((a: any, i: number) => (
                <div key={i} className="flex items-center justify-between p-2 rounded-xl bg-white/[0.03]">
                  <span className="truncate font-medium">
                    <span className="font-mono-num text-rose-300 mr-2">#{i + 1}</span>
                    {a.artist_name}
                  </span>
                  <span className="font-mono-num text-white/60 shrink-0">{a.plays}×</span>
                </div>
              ))}
            </div>
          </div>

          <div className="glass-panel rounded-3xl p-5">
            <h2 className="font-display text-lg font-bold mb-3">Top Albums</h2>
            <div className="space-y-2 text-xs">
              {(data.albums?.items || []).map((a: any, i: number) => (
                <div key={i} className="flex items-center justify-between p-2 rounded-xl bg-white/[0.03]">
                  <div className="min-w-0">
                    <p className="truncate font-medium">{a.album_name}</p>
                    <p className="text-[11px] text-white/55 truncate">{a.artist_name}</p>
                  </div>
                  <span className="font-mono-num text-white/60 shrink-0 ml-2">{a.plays}×</span>
                </div>
              ))}
            </div>
          </div>

          <div className="glass-panel rounded-3xl p-5">
            <h2 className="font-display text-lg font-bold mb-3">Top Titres (Lecture 0 €)</h2>
            <div className="space-y-2 text-xs">
              {(data.tracks?.items || []).map((t: any, i: number) => (
                <div key={i} className="flex items-center justify-between gap-2 p-2 rounded-xl bg-white/[0.03]">
                  <div className="min-w-0">
                    <p className="truncate font-medium">{t.song_name}</p>
                    <p className="text-[11px] text-white/55 truncate">{t.artist_name}</p>
                  </div>
                  <button
                    onClick={() => playQuickTrack(t.song_name, t.artist_name || "", t.album_name || "")}
                    className="p-1.5 rounded-full bg-rose-500/80 hover:bg-rose-500 text-white shrink-0"
                    title="Lire en entier (YouTube IFrame 0 €)"
                  >
                    <Play className="w-3 h-3" />
                  </button>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {tab === "science" && data && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
          <div className="glass-panel rounded-3xl p-5">
            <h2 className="font-display text-lg font-bold mb-2 flex items-center gap-2">
              <FlaskConical className="w-5 h-5 text-cyan-400" /> Ères Musicales (PELT)
            </h2>
            <div className="space-y-2 text-xs">
              {(data.eras?.eras || []).slice(0, 6).map((era: any, i: number) => (
                <div key={i} className="p-3 rounded-2xl bg-white/[0.04]">
                  <p className="font-semibold text-rose-200">{era.label || `Ère #${i + 1}`}</p>
                  <p className="font-mono-num text-white/60">
                    {era.start_month || era.start_date} → {era.end_month || era.end_date}
                  </p>
                </div>
              ))}
            </div>
          </div>
          <div className="glass-panel rounded-3xl p-5">
            <h2 className="font-display text-lg font-bold mb-2">Boussole Émotionnelle (Russell)</h2>
            <p className="text-xs text-white/60 mb-3">
              Valence × Énergie calculée sur tes titres analysés Audio DNA &amp; Paroles.
            </p>
            <div className="grid grid-cols-2 gap-2 text-xs">
              {["Euphorique", "Intense", "Mélancolique", "Serein"].map((q) => (
                <div key={q} className="p-3 rounded-2xl bg-white/[0.04] text-center font-semibold">
                  {q}
                </div>
              ))}
            </div>
          </div>
          <div className="glass-panel rounded-3xl p-5">
            <h2 className="font-display text-lg font-bold mb-2">Roue Camelot &amp; Mix Harmonique</h2>
            <div className="grid grid-cols-3 gap-1.5 text-xs font-mono-num">
              {(data.camelot?.wheel || []).slice(0, 12).map((c: any, i: number) => (
                <div key={i} className="p-2 rounded-xl bg-white/[0.04] text-center">
                  <p className="font-bold text-cyan-300">{c.code || c.camelot_code}</p>
                  <p className="text-white/60">{c.count || 0} titres</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {tab === "chrono" && data && (
        <div className="glass-panel rounded-3xl p-6">
          <h2 className="font-display text-xl font-bold mb-3 flex items-center gap-2">
            <Clock className="w-5 h-5 text-amber-400" /> Chronobiologie d&apos;Écoute (24h)
          </h2>
          <div className="grid grid-cols-6 sm:grid-cols-12 gap-2 text-center text-xs font-mono-num">
            {(data.by_hour || []).map((h: any) => (
              <div key={h.hour} className="p-2 rounded-xl bg-white/[0.04]">
                <p className="text-white/50">{h.hour}h</p>
                <p className="font-bold text-rose-200 mt-1">{h.plays}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {tab === "persona" && data && (
        <div className="glass-panel rounded-3xl p-6 space-y-3">
          <h2 className="font-display text-2xl font-bold flex items-center gap-2">
            <UserCheck className="w-6 h-6 text-indigo-400" />
            {data.persona?.title || "Ton Archétype Musical"}
          </h2>
          <p className="font-editorial italic text-xl text-white/80">
            {data.persona?.subtitle || data.persona?.description || "Explorateur sonore multi-plateformes."}
          </p>
        </div>
      )}

      {tab === "obsessions" && data && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
          {capabilities?.has_skips !== false && (
            <div className="glass-panel rounded-3xl p-5">
              <h2 className="font-display text-lg font-bold mb-2">Skips &amp; Obsessions</h2>
              <p className="text-xs text-white/65">
                Taux de skip :{" "}
                <strong className="text-rose-300 font-mono-num">
                  {((data.skip_rate || 0) * 100).toFixed(1)} %
                </strong>
              </p>
            </div>
          )}
          {capabilities?.has_lyrics_events && (
            <div className="glass-panel rounded-3xl p-5">
              <h2 className="font-display text-lg font-bold mb-2">Événements Paroles (Apple Music)</h2>
              <p className="text-xs text-white/65">
                Données `LYRIC_DISPLAY` actives sur ce profil Apple Music.
              </p>
            </div>
          )}
          {capabilities?.has_incognito_flag && (
            <div className="glass-panel rounded-3xl p-5">
              <h2 className="font-display text-lg font-bold mb-2">Sessions Privées &amp; Shuffle (Spotify)</h2>
              <p className="text-xs text-white/65">
                Champs exclusifs Spotify Extended (`incognito_mode` &amp; `shuffle`) détectés et filtrables.
              </p>
            </div>
          )}
        </div>
      )}

      {tab === "atlas" && data && (
        <div className="glass-panel rounded-3xl p-6">
          <h2 className="font-display text-xl font-bold mb-3 flex items-center gap-2">
            <Globe className="w-5 h-5 text-emerald-400" /> Atlas Mondial V3
          </h2>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 text-xs">
            {(data.countries || []).slice(0, 16).map((c: any, idx: number) => (
              <div key={idx} className="p-3 rounded-2xl bg-white/[0.04] flex justify-between">
                <span>{c.country_name || c.country_iso || "Monde"}</span>
                <span className="font-mono-num text-cyan-300">{c.plays || c.artists_count}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {tab === "wrapped" && data && (
        <div className="glass-panel rounded-3xl p-8 text-center space-y-3">
          <Sparkles className="w-8 h-8 text-rose-400 mx-auto" />
          <h2 className="font-display text-3xl font-extrabold">Sonic Odyssey Wrapped V4</h2>
          <p className="font-editorial italic text-xl text-white/80">
            {data.headline || "Une année de musique, de sillons et de découvertes."}
          </p>
        </div>
      )}
    </div>
  );
};
