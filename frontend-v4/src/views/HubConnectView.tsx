/**
 * V4 Hub Connexions, Onboarding Multi-Plateformes, Profils & Fusion,
 * Tracking Temps Réel 0 € (PC + Mobile), QR Code LAN & Mode Boost WebGPU PC Opt-in.
 */

import React, { useEffect, useState } from "react";
import {
  Check,
  Copy,
  Cpu,
  GitMerge,
  Layers,
  Plus,
  QrCode,
  Radio,
  Smartphone,
  Upload,
  Wifi,
} from "lucide-react";
import { apiGet, apiPost, type ProfileCapabilities, type ProfileItem } from "../api/client";
import { useV4Store } from "../store/useV4Store";

interface HubProps {
  onRefreshProfiles: () => Promise<void>;
}

export const HubConnectView: React.FC<HubProps> = ({ onRefreshProfiles }) => {
  const profiles = useV4Store((s) => s.profiles);
  const activeProfileId = useV4Store((s) => s.activeProfileId);
  const capabilities = useV4Store((s) => s.capabilities);
  const extensionConnected = useV4Store((s) => s.extensionConnected);
  const extensionPlatforms = useV4Store((s) => s.extensionPlatforms);
  const graphicsTier = useV4Store((s) => s.graphicsTier);
  const webgpuAvailable = useV4Store((s) => s.webgpuAvailable);
  const webgpuOptIn = useV4Store((s) => s.webgpuOptIn);
  const setWebgpuStatus = useV4Store((s) => s.setWebgpuStatus);
  const drawCallsCount = useV4Store((s) => s.drawCallsCount);

  const [guides, setGuides] = useState<any[]>([]);
  const [selectedPlatform, setSelectedPlatform] = useState("auto");
  const [targetProfileName, setTargetProfileName] = useState("");
  const [includeIncognito, setIncludeIncognito] = useState(true);
  const [importStatus, setImportStatus] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);

  // TIDAL CSV assisted mapping state
  const [csvFile, setCsvFile] = useState<File | null>(null);
  const [csvPreview, setCsvPreview] = useState<any | null>(null);
  const [csvMapping, setCsvMapping] = useState<Record<string, string>>({});

  // Merge profile form
  const [mergeName, setMergeName] = useState("Vue Fusionnée Multi-Plateformes");
  const [mergeSelectedIds, setMergeSelectedIds] = useState<number[]>([]);

  // Live Tracking & LAN QR
  const [trackingSetup, setTrackingSetup] = useState<any | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  useEffect(() => {
    apiGet<{ platforms: any[] }>("/api/v4/import/guides")
      .then((r) => setGuides(r.platforms || []))
      .catch(() => {});
    apiGet<any>("/api/v4/tracking/setup")
      .then((r) => setTrackingSetup(r))
      .catch(() => {});
  }, []);

  const handleFileImport = async (file: File, customMapping?: Record<string, string>) => {
    // If CSV and no customMapping yet, check if manual mapping is needed
    if (file.name.toLowerCase().endsWith(".csv") && !customMapping) {
      const fdPrev = new FormData();
      fdPrev.append("file", file);
      const prevRes = await fetch("/api/v4/import/preview", { method: "POST", body: fdPrev });
      if (prevRes.ok) {
        const prev = await prevRes.json();
        if (prev.needs_manual_mapping) {
          setCsvFile(file);
          setCsvPreview(prev);
          setCsvMapping(prev.detected_mapping || {});
          return;
        }
      }
    }

    setUploading(true);
    setImportStatus("Import en cours…");
    try {
      const fd = new FormData();
      fd.append("file", file);
      fd.append("platform", selectedPlatform);
      if (targetProfileName.trim()) {
        fd.append("profile_name", targetProfileName.trim());
      } else if (activeProfileId) {
        fd.append("profile_id", String(activeProfileId));
      }
      fd.append("include_incognito", String(includeIncognito));
      if (customMapping) {
        fd.append("column_mapping_json", JSON.stringify(customMapping));
      }
      const resp = await fetch("/api/v4/import", { method: "POST", body: fd });
      const data = await resp.json();
      if (!resp.ok) {
        setImportStatus(`Erreur : ${data.message || data.detail || resp.statusText}`);
      } else {
        setImportStatus(
          `✅ ${data.detected_platform} importé : ${data.inserted_events} écoutes ajoutées (${data.skipped_duplicates} doublons ignorés).`
        );
        setCsvFile(null);
        setCsvPreview(null);
        await onRefreshProfiles();
      }
    } catch (err: any) {
      setImportStatus(`Erreur réseau : ${err.message}`);
    } finally {
      setUploading(false);
    }
  };

  const handleCreateMerged = async () => {
    if (mergeSelectedIds.length < 2) return;
    await apiPost("/api/v4/profiles", {
      name: mergeName.trim() || "Profil Fusionné",
      kind: "merged",
      merged_profile_ids: mergeSelectedIds,
    });
    setMergeSelectedIds([]);
    await onRefreshProfiles();
  };

  const activateProfile = async (id: number) => {
    await apiPost(`/api/v4/profiles/${id}/activate`);
    await onRefreshProfiles();
  };

  const copyText = (id: string, text: string) => {
    navigator.clipboard?.writeText(text).catch(() => {});
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 1800);
  };

  const standardProfiles = profiles.filter((p) => p.kind === "standard");

  return (
    <div className="max-w-6xl mx-auto px-3 sm:px-6 pb-28 space-y-6">
      {/* 1. Universal 5-Platform Drag & Drop Importer */}
      <section className="glass-panel rounded-3xl p-5 sm:p-6">
        <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
          <div>
            <h1 className="font-display text-2xl font-bold flex items-center gap-2">
              <Upload className="w-6 h-6 text-rose-400" />
              Import Multi-Plateformes RGPD / Takeout (0 €)
            </h1>
            <p className="text-xs text-white/65">
              Apple Music (.zip) · Spotify Extended &amp; Account (.zip/.json) · YouTube Music Takeout (.json) ·
              Deezer (.xlsx) · TIDAL (.csv)
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <select
              value={selectedPlatform}
              onChange={(e) => setSelectedPlatform(e.target.value)}
              className="bg-white/10 border border-white/15 rounded-xl px-3 py-1.5 text-white"
            >
              <option value="auto" className="bg-[#0d0f1a]">Auto-détection</option>
              <option value="apple_music" className="bg-[#0d0f1a]">Apple Music (.zip)</option>
              <option value="spotify" className="bg-[#0d0f1a]">Spotify (.zip/.json)</option>
              <option value="youtube_music" className="bg-[#0d0f1a]">YouTube Music (.json)</option>
              <option value="deezer" className="bg-[#0d0f1a]">Deezer (.xlsx)</option>
              <option value="tidal" className="bg-[#0d0f1a]">TIDAL (.csv)</option>
            </select>
            <input
              type="text"
              value={targetProfileName}
              onChange={(e) => setTargetProfileName(e.target.value)}
              placeholder="Nouveau profil (optionnel)"
              className="bg-white/10 border border-white/15 rounded-xl px-3 py-1.5 text-white placeholder:text-white/40 w-44"
            />
          </div>
        </div>

        <label
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault();
            const f = e.dataTransfer.files?.[0];
            if (f) handleFileImport(f);
          }}
          className="block border-2 border-dashed border-white/20 hover:border-rose-400/60 rounded-2xl p-6 text-center cursor-pointer transition bg-white/[0.02]"
        >
          <input
            type="file"
            accept=".zip,.json,.xlsx,.csv"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) handleFileImport(f);
            }}
          />
          <p className="font-display font-bold text-base">
            {uploading ? "Traitement de ton archive…" : "Glisse-dépose ton fichier RGPD / Takeout ici"}
          </p>
          <p className="text-xs text-white/55 mt-1">
            Ou clique pour parcourir · 100 % local sur ton appareil · Colonne IP Deezer strictement rejetée
          </p>
        </label>

        <div className="mt-3 flex flex-wrap items-center justify-between gap-3 text-xs">
          <label className="flex items-center gap-2 text-white/75 cursor-pointer">
            <input
              type="checkbox"
              checked={includeIncognito}
              onChange={(e) => setIncludeIncognito(e.target.checked)}
              className="accent-rose-500"
            />
            Inclure les sessions privées Spotify (<code>incognito_mode</code>)
          </label>
          {importStatus && <span className="font-mono-num text-cyan-200">{importStatus}</span>}
        </div>

        {/* Assisted Manual Column Mapping for atypical TIDAL CSV */}
        {csvPreview && csvFile && (
          <div className="mt-4 p-4 rounded-2xl bg-indigo-950/50 border border-indigo-400/30 space-y-3">
            <p className="text-sm font-semibold text-indigo-200">
              Mappage manuel assisté CSV ({csvFile.name})
            </p>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 text-xs">
              {["song", "artist", "album", "duration", "isrc", "date"].map((field) => (
                <label key={field} className="flex flex-col gap-1">
                  <span className="text-white/60 uppercase font-mono-num">{field}</span>
                  <select
                    value={csvMapping[field] || ""}
                    onChange={(e) => setCsvMapping((m) => ({ ...m, [field]: e.target.value }))}
                    className="bg-black/40 border border-white/15 rounded-lg px-2 py-1"
                  >
                    <option value="">— Ignorer —</option>
                    {(csvPreview.headers || []).map((h: string) => (
                      <option key={h} value={h}>{h}</option>
                    ))}
                  </select>
                </label>
              ))}
            </div>
            <button
              onClick={() => handleFileImport(csvFile, csvMapping)}
              className="px-4 py-1.5 rounded-full bg-rose-500 text-white text-xs font-semibold"
            >
              Valider le mappage et importer
            </button>
          </div>
        )}

        {/* Quick Platform Guides */}
        <div className="grid grid-cols-1 sm:grid-cols-5 gap-2.5 mt-4">
          {guides.map((g) => (
            <div key={g.platform} className="bg-white/[0.04] rounded-2xl p-3 border border-white/10">
              <p className="font-display font-bold text-xs text-rose-200">{g.label}</p>
              <p className="text-[10px] font-mono-num text-white/50 mt-0.5">
                {(g.accepted_extensions || []).join(" · ")}
              </p>
              <p className="text-[11px] text-white/70 mt-1.5 leading-snug">{g.steps?.[0]}</p>
            </div>
          ))}
        </div>
      </section>

      {/* 2. Multi-Profiles, Fusion & Capabilities Matrix */}
      <section className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="glass-panel rounded-3xl p-5 space-y-4">
          <h2 className="font-display text-lg font-bold flex items-center gap-2">
            <Layers className="w-5 h-5 text-indigo-400" />
            Profils Séparés &amp; Vues Fusionnées
          </h2>
          <div className="space-y-2">
            {profiles.map((p: ProfileItem) => (
              <div
                key={p.id}
                className={`p-3 rounded-2xl border flex items-center justify-between gap-3 ${
                  p.is_active
                    ? "bg-rose-500/15 border-rose-400/50"
                    : "bg-white/[0.03] border-white/10"
                }`}
              >
                <div>
                  <p className="font-semibold text-sm flex items-center gap-2">
                    {p.name}
                    <span className="text-[10px] font-mono-num px-2 py-0.5 rounded-full bg-white/10">
                      {p.kind === "merged" ? "FUSIONNÉ" : "STANDARD"}
                    </span>
                  </p>
                  <p className="text-xs text-white/60 font-mono-num">
                    {(p.total_plays ?? p.events_count ?? 0).toLocaleString("fr-FR")} écoutes ·{" "}
                    {(p.platforms && p.platforms.length > 0
                      ? p.platforms
                      : Array.from(new Set((p.sources || []).map((s) => s.source_provider)))
                    ).join(", ") || "vide"}
                  </p>
                </div>
                {!p.is_active ? (
                  <button
                    onClick={() => activateProfile(p.id)}
                    className="px-3 py-1 rounded-full bg-white/10 hover:bg-white/20 text-xs"
                  >
                    Activer
                  </button>
                ) : (
                  <span className="text-xs font-mono-num text-emerald-300">ACTIF</span>
                )}
              </div>
            ))}
          </div>

          {standardProfiles.length >= 2 && (
            <div className="pt-3 border-t border-white/10 space-y-2">
              <p className="text-xs font-semibold flex items-center gap-1.5 text-cyan-200">
                <GitMerge className="w-4 h-4" /> Créer une vue fusionnée (dédupliquée ISRC ±180s)
              </p>
              <input
                type="text"
                value={mergeName}
                onChange={(e) => setMergeName(e.target.value)}
                className="w-full bg-white/10 border border-white/15 rounded-xl px-3 py-1.5 text-xs"
              />
              <div className="flex flex-wrap gap-2">
                {standardProfiles.map((sp) => {
                  const checked = mergeSelectedIds.includes(sp.id);
                  return (
                    <button
                      key={sp.id}
                      onClick={() =>
                        setMergeSelectedIds((ids) =>
                          checked ? ids.filter((x) => x !== sp.id) : [...ids, sp.id]
                        )
                      }
                      className={`px-2.5 py-1 rounded-full text-xs border ${
                        checked
                          ? "bg-indigo-500/40 border-indigo-300 text-white"
                          : "bg-white/5 border-white/10 text-white/65"
                      }`}
                    >
                      {checked ? "✓ " : "+ "}
                      {sp.name}
                    </button>
                  );
                })}
              </div>
              <button
                onClick={handleCreateMerged}
                disabled={mergeSelectedIds.length < 2}
                className="px-4 py-1.5 rounded-full bg-indigo-500 disabled:opacity-40 text-xs font-semibold flex items-center gap-1.5"
              >
                <Plus className="w-3.5 h-3.5" /> Fusionner ({mergeSelectedIds.length} profils)
              </button>
            </div>
          )}
        </div>

        {/* Capabilities Matrix */}
        <div className="glass-panel rounded-3xl p-5 space-y-3" data-testid="capabilities-matrix">
          <h2 className="font-display text-lg font-bold">Matrice de Capacités du Profil Actif</h2>
          <p className="text-xs text-white/60">
            L&apos;interface adapte automatiquement chaque module aux données réellement présentes dans ce profil.
          </p>
          {capabilities && (
            <div className="grid grid-cols-2 gap-2 text-xs">
              {(
                [
                  ["Durées exactes", capabilities.has_exact_duration],
                  ["Skips", capabilities.has_skips],
                  ["End Reasons", capabilities.has_end_reasons],
                  ["Événements Paroles", capabilities.has_lyrics_events],
                  ["Recherches", capabilities.has_search_events],
                  ["Appareils", capabilities.has_devices],
                  ["Qualité Audio", capabilities.has_audio_quality],
                  ["Mode Incognito (Spotify)", capabilities.has_incognito_flag],
                  ["Mode Shuffle", capabilities.has_shuffle_flag],
                ] as Array<[string, boolean]>
              ).map(([label, supported]) => (
                <div
                  key={label}
                  className={`px-3 py-2 rounded-xl border flex items-center justify-between ${
                    supported
                      ? "bg-emerald-500/10 border-emerald-400/30 text-emerald-200"
                      : "bg-white/[0.02] border-white/10 text-white/40"
                  }`}
                >
                  <span>{label}</span>
                  <span className="font-mono-num text-[10px]">{supported ? "OUI" : "MASQUÉ"}</span>
                </div>
              ))}
            </div>
          )}
          {capabilities && capabilities.estimated_duration_pct > 0 && (
            <div className="p-2.5 rounded-xl bg-amber-500/15 border border-amber-400/30 text-xs text-amber-200">
              ⚠️ {capabilities.estimated_duration_pct.toFixed(0)} % des écoutes ont une <strong>durée estimée</strong>{" "}
              (ex: YouTube Music Takeout).
            </div>
          )}
        </div>
      </section>

      {/* 3. Tracking Live 0 € + Extension MV3 + Smartphone LAN QR Code + WebGPU PC Opt-in */}
      <section className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="glass-panel rounded-3xl p-5 space-y-3">
          <h2 className="font-display text-lg font-bold flex items-center gap-2">
            <Radio className="w-5 h-5 text-emerald-400" />
            Tracking Temps Réel 0 € &amp; Extension MV3
          </h2>
          <div className="p-3 rounded-2xl bg-white/[0.04] border border-white/10 flex items-center justify-between text-xs">
            <div>
              <p className="font-semibold">Extension Navigateur MV3 (`amdatawrap-bridge`)</p>
              <p className="text-white/60">
                {extensionConnected
                  ? `Connectée (${extensionPlatforms.join(", ") || "en attente d'onglet"})`
                  : "Non détectée · Charge extensions/amdatawrap-bridge en mode développeur"}
              </p>
            </div>
            <span
              className={`px-2.5 py-1 rounded-full font-mono-num text-[10px] ${
                extensionConnected ? "bg-emerald-500/20 text-emerald-300" : "bg-white/10 text-white/50"
              }`}
            >
              {extensionConnected ? "LIVE" : "OFFLINE"}
            </span>
          </div>

          {trackingSetup?.guides?.map((g: any) => (
            <div key={g.id} className="p-3 rounded-2xl bg-white/[0.03] border border-white/10 text-xs space-y-1.5">
              <div className="flex items-center justify-between">
                <p className="font-semibold text-white">{g.name}</p>
                <span className="text-[10px] font-mono-num text-cyan-300">{g.cost}</span>
              </div>
              <p className="text-white/65">{g.steps?.[0]}</p>
              {g.copy_value && (
                <button
                  onClick={() => copyText(g.id, g.copy_value)}
                  className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-white/10 hover:bg-white/15 font-mono-num text-[11px]"
                >
                  {copiedId === g.id ? <Check className="w-3 h-3 text-emerald-300" /> : <Copy className="w-3 h-3" />}
                  {g.copy_value}
                </button>
              )}
            </div>
          ))}
        </div>

        {/* Smartphone LAN QR Code + Phase 3 Graphics Tier / WebGPU Opt-in */}
        <div className="space-y-6">
          <div className="glass-panel rounded-3xl p-5" data-testid="lan-qr-card">
            <h2 className="font-display text-lg font-bold flex items-center gap-2 mb-2">
              <Smartphone className="w-5 h-5 text-cyan-400" />
              Accès Smartphone sur Réseau Local (Wi-Fi)
            </h2>
            <p className="text-xs text-white/65 mb-3">
              Scanne ce QR code depuis ton téléphone sur le même Wi-Fi pour ouvrir AMDataWrap V4 en WebGL2 mobile.
            </p>
            {trackingSetup?.lan && (
              <div className="flex items-center gap-4">
                <div
                  className="w-28 h-28 rounded-2xl bg-black/40 p-2 border border-white/15 shrink-0 flex items-center justify-center [&>svg]:w-full [&>svg]:h-full"
                  dangerouslySetInnerHTML={{ __html: trackingSetup.lan.frontend_qr_svg }}
                />
                <div className="text-xs space-y-1.5 min-w-0">
                  <p className="flex items-center gap-1.5 text-emerald-300 font-mono-num">
                    <Wifi className="w-3.5 h-3.5" /> {trackingSetup.lan.lan_ip}
                  </p>
                  <p className="font-mono-num text-white/85 break-all">{trackingSetup.lan.frontend_v4_url}</p>
                  <button
                    onClick={() => copyText("lan-url", trackingSetup.lan.frontend_v4_url)}
                    className="px-3 py-1 rounded-full bg-white/10 hover:bg-white/20 text-[11px] inline-flex items-center gap-1"
                  >
                    <QrCode className="w-3 h-3" /> Copier l&apos;URL LAN
                  </button>
                </div>
              </div>
            )}
          </div>

          <div className="glass-panel rounded-3xl p-5" data-testid="graphics-tier-card">
            <h2 className="font-display text-lg font-bold flex items-center gap-2 mb-2">
              <Cpu className="w-5 h-5 text-amber-400" />
              Moteur Graphique &amp; Mode Boost WebGPU (Phase 3)
            </h2>
            <div className="flex items-center justify-between text-xs mb-3 font-mono-num">
              <span className="text-white/70">Palier actif : <strong>Tier {graphicsTier}</strong></span>
              <span className="text-cyan-300">Draw Calls : {drawCallsCount} (&lt; 60 cible)</span>
            </div>
            <label className="flex items-center justify-between p-3 rounded-2xl bg-white/[0.04] border border-white/10 text-xs cursor-pointer">
              <div>
                <p className="font-semibold">Mode Boost PC Ultra (WebGPU Opt-in)</p>
                <p className="text-white/55">
                  {webgpuAvailable
                    ? "navigator.gpu détecté — réflexions anisotropes avancées avec fallback WebGL2 instantané"
                    : "WebGPU indisponible sur ce navigateur — WebGL2 actif par défaut"}
                </p>
              </div>
              <input
                type="checkbox"
                disabled={!webgpuAvailable}
                checked={webgpuOptIn}
                onChange={(e) => setWebgpuStatus(webgpuAvailable, e.target.checked)}
                className="accent-rose-500 w-4 h-4"
              />
            </label>
          </div>
        </div>
      </section>
    </div>
  );
};
