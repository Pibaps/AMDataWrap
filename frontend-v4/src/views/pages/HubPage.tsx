/**
 * HubPage — Multi-Platform Archive Import (Apple Music, Spotify, YouTube Music, Deezer, TIDAL),
 * Assisted CSV Mapping, Profiles & Merged Views, Capabilities Matrix, Live Tracking & LAN QR Code.
 */

import React, { useEffect, useState } from "react";
import { Check, Copy, GitMerge, Plus, Smartphone, Upload, Wifi } from "lucide-react";
import { API, apiGet, apiPost, formatInt, type ProfileItem } from "../../api/client";
import { Page, Section } from "../../components/ui";
import { invalidateApiCache } from "../../hooks/useApi";
import { useV4Store } from "../../store/useV4Store";

export interface HubPageProps {
  onRefreshProfiles: () => Promise<void>;
}

export const HubPage: React.FC<HubPageProps> = ({ onRefreshProfiles }) => {
  const profiles = useV4Store((s) => s.profiles);
  const activeProfileId = useV4Store((s) => s.activeProfileId);
  const capabilities = useV4Store((s) => s.capabilities);
  const extensionConnected = useV4Store((s) => s.extensionConnected);
  const extensionPlatforms = useV4Store((s) => s.extensionPlatforms);

  const [guides, setGuides] = useState<any[]>([]);
  const [selectedPlatform, setSelectedPlatform] = useState("auto");
  const [targetProfileName, setTargetProfileName] = useState("");
  const [includeIncognito, setIncludeIncognito] = useState(true);
  const [importStatus, setImportStatus] = useState<string | null>(null);
  const [importProgress, setImportProgress] = useState<{ percent: number; detail: string; status: "running" | "done" | "error" } | null>(null);
  const [uploading, setUploading] = useState(false);

  // Assisted CSV mapping (e.g. atypical TIDAL CSV)
  const [csvFile, setCsvFile] = useState<File | null>(null);
  const [csvPreview, setCsvPreview] = useState<any | null>(null);
  const [csvMapping, setCsvMapping] = useState<Record<string, string>>({});

  // Merged profile creation
  const [mergeName, setMergeName] = useState("Collection Fusionnée");
  const [mergeSelectedIds, setMergeSelectedIds] = useState<number[]>([]);

  // Live tracking & LAN QR
  const [trackingSetup, setTrackingSetup] = useState<any | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  useEffect(() => {
    apiGet<{ platforms: any[] }>(API.importGuides)
      .then((r) => setGuides(r.platforms || []))
      .catch(() => {});
    apiGet<any>(API.trackingSetup)
      .then((r) => setTrackingSetup(r))
      .catch(() => {});
  }, []);

  const handleFileImport = async (file: File, customMapping?: Record<string, string>) => {
    if (file.name.toLowerCase().endsWith(".csv") && !customMapping) {
      const fdPrev = new FormData();
      fdPrev.append("file", file);
      const prevRes = await fetch(API.importPreview, { method: "POST", body: fdPrev });
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
    setImportStatus(null);
    const importId =
      typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
        ? crypto.randomUUID()
        : `imp-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
    setImportProgress({ percent: 2, detail: `Envoi de ${file.name}…`, status: "running" });

    let pollTimer: number | null = null;
    const stopPolling = () => {
      if (pollTimer !== null) {
        window.clearInterval(pollTimer);
        pollTimer = null;
      }
    };

    try {
      const fd = new FormData();
      fd.append("file", file);
      fd.append("platform", selectedPlatform);
      fd.append("import_id", importId);
      if (targetProfileName.trim()) {
        fd.append("profile_name", targetProfileName.trim());
      } else if (activeProfileId) {
        fd.append("profile_id", String(activeProfileId));
      }
      fd.append("include_incognito", String(includeIncognito));
      if (customMapping) {
        fd.append("column_mapping_json", JSON.stringify(customMapping));
      }

      const startBackendPoll = () => {
        if (pollTimer !== null) return;
        pollTimer = window.setInterval(async () => {
          try {
            const p = await apiGet<{ percent?: number; detail?: string; status?: string }>(API.importProgress(importId));
            if (p && typeof p.percent === "number") {
              const mapped = Math.min(99, 15 + Math.round(p.percent * 0.85));
              setImportProgress((prev) => ({
                percent: Math.max(prev?.percent ?? 15, mapped),
                detail: p.detail || prev?.detail || "Traitement de l'archive…",
                status: "running",
              }));
            }
          } catch {
            /* ignore transient poll error */
          }
        }, 250);
      };

      const { ok, statusText, data } = await new Promise<{ ok: boolean; statusText: string; data: any }>((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open("POST", API.importV4);
        xhr.upload.onprogress = (ev) => {
          if (ev.lengthComputable && ev.total > 0) {
            const upPct = Math.round((ev.loaded / ev.total) * 100);
            const mapped = Math.max(2, Math.round(upPct * 0.15));
            setImportProgress({
              percent: mapped,
              detail: upPct < 100 ? `Envoi de ${file.name} (${upPct} %)…` : "Archive reçue, analyse en cours…",
              status: "running",
            });
            if (upPct >= 100) startBackendPoll();
          }
        };
        xhr.upload.onload = () => {
          setImportProgress((prev) => ({
            percent: Math.max(prev?.percent ?? 15, 15),
            detail: "Archive reçue, analyse en cours…",
            status: "running",
          }));
          startBackendPoll();
        };
        xhr.onload = () => {
          let parsed: any = {};
          try {
            parsed = JSON.parse(xhr.responseText || "{}");
          } catch {
            parsed = { detail: xhr.responseText };
          }
          resolve({ ok: xhr.status >= 200 && xhr.status < 300, statusText: xhr.statusText, data: parsed });
        };
        xhr.onerror = () => reject(new Error("Connexion interrompue pendant l'envoi."));
        xhr.send(fd);
      });

      stopPolling();
      if (!ok) {
        const msg = `Erreur : ${data.message || data.detail || statusText}`;
        setImportStatus(msg);
        setImportProgress({ percent: 100, detail: msg, status: "error" });
      } else {
        const msg = `${data.detected_platform} importé : ${formatInt(data.inserted_events)} écoutes ajoutées (${formatInt(
          data.skipped_duplicates
        )} doublons ignorés).`;
        setImportStatus(msg);
        setImportProgress({ percent: 100, detail: msg, status: "done" });
        setCsvFile(null);
        setCsvPreview(null);
        invalidateApiCache();
        await onRefreshProfiles();
      }
    } catch (err: any) {
      stopPolling();
      const msg = `Erreur réseau : ${err.message}`;
      setImportStatus(msg);
      setImportProgress({ percent: 100, detail: msg, status: "error" });
    } finally {
      stopPolling();
      setUploading(false);
    }
  };

  const handleCreateMerged = async () => {
    if (mergeSelectedIds.length < 2) return;
    await apiPost(API.profiles, {
      name: mergeName.trim() || "Profil Fusionné",
      kind: "merged",
      merged_profile_ids: mergeSelectedIds,
    });
    setMergeSelectedIds([]);
    invalidateApiCache();
    await onRefreshProfiles();
  };

  const activateProfile = async (id: number) => {
    await apiPost(`${API.profiles}/${id}/activate`);
    invalidateApiCache();
    await onRefreshProfiles();
  };

  const copyText = (id: string, text: string) => {
    navigator.clipboard?.writeText(text).catch(() => {});
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 1800);
  };

  const standardProfiles = profiles.filter((p) => p.kind === "standard");

  return (
    <Page
      title="Import & profils"
      kicker="INGESTION MULTI-PLATEFORMES · PROFILS · SUIVI TEMPS RÉEL"
      intro="Importe tes archives RGPD / Takeout locales, gère tes profils séparés ou fusionnés et configure la synchronisation locale sur PC et smartphone."
    >
      {/* 1. Multi-Platform Drag & Drop Importer */}
      <Section
        className="mb-6"
        kicker="ARCHIVES OFFICIELLES LOCALES"
        title="Importer une archive Apple Music, Spotify, YouTube Music, Deezer ou TIDAL"
        aside={
          <div className="flex flex-wrap items-center gap-2">
            <select
              value={selectedPlatform}
              onChange={(e) => setSelectedPlatform(e.target.value)}
              className="field text-xs"
            >
              <option value="auto">Auto-détection</option>
              <option value="apple_music">Apple Music (.zip)</option>
              <option value="spotify">Spotify (.zip / .json)</option>
              <option value="youtube_music">YouTube Music (.json)</option>
              <option value="deezer">Deezer (.xlsx)</option>
              <option value="tidal">TIDAL (.csv)</option>
            </select>
            <input
              type="text"
              value={targetProfileName}
              onChange={(e) => setTargetProfileName(e.target.value)}
              placeholder="Nouveau profil (optionnel)"
              className="field text-xs w-44"
            />
          </div>
        }
      >
        <label
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault();
            const f = e.dataTransfer.files?.[0];
            if (f) handleFileImport(f);
          }}
          className="block border border-dashed border-line-2 hover:border-amber rounded p-7 text-center cursor-pointer transition-colors bg-bg-3/50"
        >
          <input
            type="file"
            accept=".zip,.json,.html,.htm,.xlsx,.csv"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) handleFileImport(f);
            }}
          />
          <Upload className="w-6 h-6 text-amber mx-auto mb-2" />
          <p className="font-display text-lg font-[500]">
            {uploading ? "Traitement de l'archive…" : "Glisse-dépose ton fichier d'export ici ou clique pour parcourir"}
          </p>
          <p className="text-xs text-ink-3 mt-1">
            Formats acceptés : .zip, .json, .xlsx, .csv · Traitement 100 % local
          </p>
        </label>

        <div className="mt-3 flex flex-wrap items-center justify-between gap-3 text-xs">
          <label className="flex items-center gap-2 text-ink-2 cursor-pointer">
            <input
              type="checkbox"
              checked={includeIncognito}
              onChange={(e) => setIncludeIncognito(e.target.checked)}
              className="accent-amber"
            />
            Inclure les sessions privées Spotify (<code>incognito_mode</code>)
          </label>
          {!importProgress && importStatus && <span className="num text-amber">{importStatus}</span>}
        </div>

        {importProgress && (
          <div className="mt-4 p-3.5 rounded bg-bg-3 border border-line-2 space-y-2" role="status" aria-live="polite">
            <div className="flex items-center justify-between gap-3 text-xs">
              <span className={importProgress.status === "error" ? "text-ember font-medium break-words min-w-0" : "text-ink break-words min-w-0"}>
                {importProgress.detail}
              </span>
              <span className={`num font-semibold shrink-0 ${importProgress.status === "error" ? "text-ember" : importProgress.status === "done" ? "text-moss" : "text-amber"}`}>
                {importProgress.percent} %
              </span>
            </div>
            <div className="h-2 w-full bg-bg-4 rounded-full overflow-hidden">
              <div
                className={`h-full rounded-full transition-all duration-200 ${
                  importProgress.status === "error" ? "bg-ember" : importProgress.status === "done" ? "bg-moss" : "bg-amber"
                }`}
                style={{ width: `${Math.max(2, importProgress.percent)}%` }}
              />
            </div>
          </div>
        )}

        {/* Manual CSV column mapping when needed */}
        {csvPreview && csvFile && (
          <div className="mt-4 p-4 rounded bg-bg-3 border border-amber/40 space-y-3">
            <p className="text-xs font-semibold text-amber">
              Mappage manuel des colonnes CSV ({csvFile.name})
            </p>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5 text-xs">
              {["song", "artist", "album", "duration", "isrc", "date"].map((field) => (
                <label key={field} className="flex flex-col gap-1">
                  <span className="kicker">{field}</span>
                  <select
                    value={csvMapping[field] || ""}
                    onChange={(e) => setCsvMapping((m) => ({ ...m, [field]: e.target.value }))}
                    className="field text-xs"
                  >
                    <option value="">— Ignorer —</option>
                    {(csvPreview.headers || []).map((h: string) => (
                      <option key={h} value={h}>
                        {h}
                      </option>
                    ))}
                  </select>
                </label>
              ))}
            </div>
            <button onClick={() => handleFileImport(csvFile, csvMapping)} className="btn btn-primary">
              Valider le mappage et importer
            </button>
          </div>
        )}

        {guides.length > 0 && (
          <div className="grid grid-cols-1 sm:grid-cols-5 gap-2.5 mt-5">
            {guides.map((g) => (
              <div key={g.platform} className="p-3 rounded bg-bg-3 border border-line text-xs">
                <p className="font-semibold text-ink">{g.label}</p>
                <p className="num text-[10px] text-amber mt-0.5">{(g.accepted_extensions || []).join(" · ")}</p>
                <p className="text-[11px] text-ink-3 mt-1.5 leading-snug">{g.steps?.[0]}</p>
              </div>
            ))}
          </div>
        )}
      </Section>

      {/* 2. Profiles & Capabilities Matrix */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 mb-6">
        <Section className="lg:col-span-6" kicker="ISOLATION OU FUSION" title="Profils d'écoute">
          <div className="space-y-2">
            {profiles.map((p: ProfileItem) => (
              <div
                key={p.id}
                className={`p-3 rounded border flex items-center justify-between gap-3 ${
                  p.is_active ? "bg-bg-3 border-amber/60" : "bg-bg border-line"
                }`}
              >
                <div>
                  <p className="text-sm font-medium flex items-center gap-2">
                    {p.name}
                    <span className="kicker px-2 py-0.5 rounded bg-bg-4">
                      {p.kind === "merged" ? "FUSIONNÉ" : "STANDARD"}
                    </span>
                  </p>
                  <p className="text-xs text-ink-3 num mt-0.5">
                    {formatInt(p.total_plays ?? p.events_count ?? 0)} écoutes ·{" "}
                    {(p.platforms && p.platforms.length > 0
                      ? p.platforms
                      : Array.from(new Set((p.sources || []).map((s) => s.source_provider)))
                    ).join(", ") || "vide"}
                  </p>
                </div>
                {!p.is_active ? (
                  <button onClick={() => activateProfile(p.id)} className="btn text-xs">
                    Activer
                  </button>
                ) : (
                  <span className="num text-xs text-amber font-semibold">ACTIF</span>
                )}
              </div>
            ))}
          </div>

          {standardProfiles.length >= 2 && (
            <div className="mt-4 pt-4 border-t border-line space-y-2.5">
              <p className="text-xs font-medium flex items-center gap-1.5 text-ink">
                <GitMerge className="w-3.5 h-3.5 text-amber" /> Créer une vue fusionnée (déduplication ISRC ±180s)
              </p>
              <input
                type="text"
                value={mergeName}
                onChange={(e) => setMergeName(e.target.value)}
                className="field w-full text-xs"
              />
              <div className="flex flex-wrap gap-1.5">
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
                      className="chip"
                      data-active={checked}
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
                className="btn btn-primary"
              >
                <Plus className="w-3.5 h-3.5" /> Fusionner ({mergeSelectedIds.length} profils)
              </button>
            </div>
          )}
        </Section>

        <Section
          className="lg:col-span-6"
          kicker=" CONTRAT DE DONNÉES"
          title="Matrice de capacités du profil actif"
        >
          <div data-testid="capabilities-matrix" className="grid grid-cols-2 gap-2 text-xs">
            {capabilities &&
              (
                [
                  ["Durées exactes", capabilities.has_exact_duration],
                  ["Skips", capabilities.has_skips],
                  ["Raisons de fin", capabilities.has_end_reasons],
                  ["Événements Paroles", capabilities.has_lyrics_events],
                  ["Recherches", capabilities.has_search_events],
                  ["Appareils", capabilities.has_devices],
                  ["Qualité Audio", capabilities.has_audio_quality],
                  ["Incognito (Spotify)", capabilities.has_incognito_flag],
                  ["Shuffle", capabilities.has_shuffle_flag],
                ] as Array<[string, boolean]>
              ).map(([label, ok]) => (
                <div
                  key={label}
                  className={`px-3 py-2 rounded border flex items-center justify-between ${
                    ok ? "bg-bg-3 border-line-2 text-ink" : "bg-bg border-line text-ink-3"
                  }`}
                >
                  <span>{label}</span>
                  <span className={`num text-[10px] ${ok ? "text-amber" : "text-ink-3"}`}>
                    {ok ? "ACTIF" : "ABSENT"}
                  </span>
                </div>
              ))}
          </div>
        </Section>
      </div>

      {/* 3. Live Tracking & LAN Smartphone QR Code */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        <Section
          className="lg:col-span-7"
          kicker="CONNECTEURS TEMPS RÉEL"
          title="Capteurs locaux & Webhooks de scrobbling"
        >
          <div className="space-y-2.5 text-xs">
            <div className="p-3 rounded bg-bg-3 border border-line flex items-center justify-between">
              <div>
                <p className="font-medium text-ink">Extension Navigateur MV3 (amdatawrap-bridge)</p>
                <p className="text-ink-3 mt-0.5">
                  {extensionConnected
                    ? `Connectée (${extensionPlatforms.join(", ") || "en veille"})`
                    : "Non connectée · Charge extensions/amdatawrap-bridge dans Chrome/Edge"}
                </p>
              </div>
              <span className="num text-[11px] px-2 py-0.5 rounded bg-bg-4 text-ink-2">
                {extensionConnected ? "EN LIGNE" : "VEILLE"}
              </span>
            </div>

            {trackingSetup?.guides?.map((g: any) => (
              <div key={g.id} className="p-3 rounded bg-bg-3 border border-line space-y-1.5">
                <div className="flex items-center justify-between">
                  <p className="font-medium text-ink">{g.name}</p>
                  <span className="num text-[10px] text-amber">{g.cost}</span>
                </div>
                <p className="text-ink-2">{g.steps?.[0]}</p>
                {g.copy_value && (
                  <button
                    onClick={() => copyText(g.id, g.copy_value)}
                    className="btn text-[11px] num h-7"
                  >
                    {copiedId === g.id ? <Check className="w-3 h-3 text-amber" /> : <Copy className="w-3 h-3" />}
                    {g.copy_value}
                  </button>
                )}
              </div>
            ))}
          </div>
        </Section>

        <Section
          className="lg:col-span-5"
          kicker="RÉSEAU LOCAL WI-FI"
          title="Accès Smartphone LAN"
        >
          <div data-testid="lan-qr-card" className="space-y-3 text-xs">
            <p className="text-ink-2">
              Scanne ce QR code depuis ton téléphone connecté au même Wi-Fi pour ouvrir le salon d&apos;écoute sur
              mobile.
            </p>
            {trackingSetup?.lan && (
              <div className="flex items-center gap-4 pt-1">
                <div
                  className="w-28 h-28 rounded bg-white p-2 shrink-0 flex items-center justify-center [&>svg]:w-full [&>svg]:h-full"
                  dangerouslySetInnerHTML={{ __html: trackingSetup.lan.frontend_qr_svg }}
                />
                <div className="space-y-1.5 min-w-0">
                  <p className="flex items-center gap-1.5 text-amber num">
                    <Wifi className="w-3.5 h-3.5" /> {trackingSetup.lan.lan_ip}
                  </p>
                  <p className="num text-ink break-all">{trackingSetup.lan.frontend_v4_url}</p>
                  <button
                    onClick={() => copyText("lan-url", trackingSetup.lan.frontend_v4_url)}
                    className="btn text-xs"
                  >
                    <Smartphone className="w-3.5 h-3.5" /> Copier l&apos;URL LAN
                  </button>
                </div>
              </div>
            )}
          </div>
        </Section>
      </div>
    </Page>
  );
};
