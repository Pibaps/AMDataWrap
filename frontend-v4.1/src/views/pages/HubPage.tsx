/**
 * HubPage ("Archives") — Simplified Grand-Public Essential View + Collapsible Technical Drawer (V4.1).
 *
 * Essential View (default):
 * 1. Importer mes écoutes (clear drag & drop, Apple Music RGPD .zip/.csv, Spotify JSON, custom CSV)
 * 2. Mes profils & sauvegardes (simple profile selection)
 * 3. Écoute en direct (kept in reserve for future hosted version — free scrobbles via ListenBrainz / Last.fm)
 *
 * Collapsible Drawer (`Options avancées / Technique`, closed by default):
 * - Capabilities Matrix, ISRC ±180s Merged Profiles, MV3 Extension details, Webhooks, LAN QR Code.
 */

import React, { useEffect, useState } from "react";
import { Check, ChevronDown, Clock, Copy, Download, GitMerge, Plus, RefreshCw, Smartphone, Trash2, Upload, Wifi } from "lucide-react";
import { API, apiDelete, apiGet, apiPost, formatInt, type ProfileItem } from "../../api/client";
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

  const [csvFile, setCsvFile] = useState<File | null>(null);
  const [csvPreview, setCsvPreview] = useState<any | null>(null);
  const [csvMapping, setCsvMapping] = useState<Record<string, string>>({});

  const [mergeName, setMergeName] = useState("Collection Fusionnée");
  const [mergeSelectedIds, setMergeSelectedIds] = useState<number[]>([]);

  const [trackingSetup, setTrackingSetup] = useState<any | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [repairMsg, setRepairMsg] = useState<string | null>(null);
  const [repairing, setRepairing] = useState(false);
  const [backupMsg, setBackupMsg] = useState<string | null>(null);
  const [restoring, setRestoring] = useState(false);

  const handleDeleteSource = async (profileId: number, sourceId: number, filename: string) => {
    if (!window.confirm(`Supprimer l'import « ${filename} » et ses écoutes associées ?`)) return;
    try {
      await apiDelete(`/api/v4/profiles/${profileId}/sources/${sourceId}`);
      invalidateApiCache();
      await onRefreshProfiles();
      setBackupMsg(`Source « ${filename} » supprimée.`);
    } catch (err: any) {
      setBackupMsg(`Erreur suppression : ${err.message}`);
    }
  };

  const handleRestoreBackup = async (file: File) => {
    setRestoring(true);
    setBackupMsg(null);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch("/api/v4/profiles/import-backup", { method: "POST", body: fd });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.detail || res.statusText);
      invalidateApiCache();
      await onRefreshProfiles();
      setBackupMsg(
        `Sauvegarde restaurée : ${data.profile_name || data.name || "profil"} (${formatInt(
          data.restored_events ?? data.inserted_events ?? 0,
        )} écoutes).`,
      );
    } catch (err: any) {
      setBackupMsg(`Erreur restauration : ${err.message}`);
    } finally {
      setRestoring(false);
    }
  };

  const handleRepairEnrichment = async () => {
    setRepairing(true);
    setRepairMsg(null);
    try {
      const res = await apiPost<{ ok: boolean; queued_tracks: number }>("/api/v4/enrichment/repair");
      invalidateApiCache();
      setRepairMsg(
        res.queued_tracks > 0
          ? `${formatInt(res.queued_tracks)} titres remis en file pour réparation des pochettes et extraits.`
          : "Toutes les pochettes et extraits sont déjà complets."
      );
    } catch (err: any) {
      setRepairMsg(`Erreur : ${err.message}`);
    } finally {
      setRepairing(false);
    }
  };

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
      title="Archives"
      kicker="MES ÉCOUTES & SAUVEGARDES LOCALES"
      intro="Dépose ton fichier d'historique Apple Music, Spotify ou CSV pour mettre à jour ta collection et tes statistiques — tout reste 100 % privé sur ton ordinateur."
    >
      {/* 1. Essential: Importer mes écoutes */}
      <Section
        className="mb-6"
        kicker="ÉTAPE 1 · AJOUTER OU METTRE À JOUR"
        title="Importer mes écoutes"
        aside={
          <div className="flex flex-wrap items-center gap-2 max-w-full">
            <select
              value={selectedPlatform}
              onChange={(e) => setSelectedPlatform(e.target.value)}
              className="field text-xs max-w-full"
              aria-label="Format d'archive"
            >
              <option value="auto">Détection automatique</option>
              <option value="apple_music">Apple Music (.zip / .csv)</option>
              <option value="spotify">Spotify (.zip / .json)</option>
              <option value="youtube_music">YouTube Music (.json)</option>
              <option value="deezer">Deezer (.xlsx)</option>
              <option value="tidal">TIDAL / CSV personnalisé (.csv)</option>
            </select>
            <input
              type="text"
              value={targetProfileName}
              onChange={(e) => setTargetProfileName(e.target.value)}
              placeholder="Nom du profil (optionnel)"
              className="field text-xs w-full sm:w-44 min-w-0"
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
            {uploading ? "Importation en cours…" : "Glisse-dépose ton archive ici ou clique pour choisir un fichier"}
          </p>
          <p className="text-xs text-ink-3 mt-1">
            Apple Music RGPD (.zip / .csv), Spotify (.zip / .json), Deezer (.xlsx) ou CSV · Aucun envoi sur un serveur externe
          </p>
        </label>

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
        {!importProgress && importStatus && <p className="mt-3 text-xs num text-amber">{importStatus}</p>}

        {/* Manual CSV column mapping when needed */}
        {csvPreview && csvFile && (
          <div className="mt-4 p-4 rounded bg-bg-3 border border-amber/40 space-y-3">
            <p className="text-xs font-semibold text-amber">Associer les colonnes du fichier ({csvFile.name})</p>
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
              Valider et importer
            </button>
          </div>
        )}

        {guides.length > 0 && (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-2.5 mt-5">
            {guides.map((g) => (
              <div key={g.platform} className="p-3 rounded bg-bg-3 border border-line text-xs min-w-0 break-words">
                <p className="font-semibold text-ink">{g.label}</p>
                <p className="num text-[10px] text-amber mt-0.5 break-words">{(g.accepted_extensions || []).join(" · ")}</p>
                <p className="text-[11px] text-ink-3 mt-1.5 leading-snug break-words">{g.steps?.[0]}</p>
              </div>
            ))}
          </div>
        )}
      </Section>

      {/* 2. Essential: Mes profils & sauvegardes + 3. Écoute en direct (en réserve) */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 mb-6">
        <Section className="lg:col-span-7" kicker="ÉTAPE 2 · COLLECTION ACTIVE" title="Mes profils & sauvegardes">
          <div className="space-y-2">
            {profiles.map((p: ProfileItem) => (
              <div
                key={p.id}
                className={`p-3 rounded border space-y-2 ${
                  p.is_active ? "bg-bg-3 border-amber/60" : "bg-bg border-line"
                }`}
              >
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="text-sm font-medium flex items-center gap-2">
                      {p.name}
                      {p.kind === "merged" && <span className="kicker px-2 py-0.5 rounded bg-bg-4">FUSIONNÉ</span>}
                    </p>
                    <p className="text-xs text-ink-3 num mt-0.5">
                      {formatInt(p.total_plays ?? p.events_count ?? 0)} écoutes enregistrées
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <a
                      href={`/api/v4/profiles/${p.id}/export`}
                      download={`amdatawrap-profile-${p.id}.amdw.json.gz`}
                      className="btn text-[11px] py-1 px-2"
                      title="Exporter une sauvegarde portable (.amdw.json.gz)"
                    >
                      <Download className="w-3 h-3" />
                      Export
                    </a>
                    {!p.is_active ? (
                      <button onClick={() => activateProfile(p.id)} className="btn text-xs">
                        Sélectionner
                      </button>
                    ) : (
                      <span className="num text-xs text-amber font-semibold">ACTIF</span>
                    )}
                  </div>
                </div>
                {Array.isArray(p.sources) && p.sources.length > 0 && (
                  <div className="pt-2 border-t border-line/60 space-y-1">
                    {p.sources.map((src) => (
                      <div key={src.id} className="flex items-center justify-between gap-2 text-[11px] text-ink-3">
                        <span className="truncate">
                          <span className="text-ink-2 font-mono">{src.source_provider}</span> · {src.filename} ({formatInt(src.events_count)})
                        </span>
                        <button
                          type="button"
                          onClick={() => handleDeleteSource(p.id, src.id, src.filename || src.source_provider)}
                          className="text-ink-3 hover:text-ember p-0.5 rounded transition-colors shrink-0"
                          title="Supprimer cette source"
                        >
                          <Trash2 className="w-3 h-3" />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>

          <div className="mt-4 pt-4 border-t border-line flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={handleRepairEnrichment}
                disabled={repairing}
                data-testid="repair-enrichment-btn"
                className="btn text-xs"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${repairing ? "animate-spin" : ""}`} />
                Réparer / Rafraîchir les pochettes &amp; extraits manquants
              </button>
              <label className="btn text-xs cursor-pointer">
                <Upload className="w-3.5 h-3.5" />
                {restoring ? "Restauration…" : "Restaurer (.amdw.json.gz)"}
                <input
                  type="file"
                  accept=".gz,.json,.amdw"
                  className="hidden"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) handleRestoreBackup(f);
                    e.currentTarget.value = "";
                  }}
                />
              </label>
            </div>
            {(repairMsg || backupMsg) && (
              <span className="text-[11.5px] text-amber num">{backupMsg || repairMsg}</span>
            )}
          </div>
        </Section>

        <Section
          className="lg:col-span-5"
          kicker="FEUILLE DE ROUTE HÉBERGÉE"
          title="Écoute en direct"
        >
          <div className="p-4 rounded bg-bg-3 border border-line space-y-2.5 text-xs text-ink-2 leading-relaxed">
            <div className="flex items-center gap-2 text-brass font-medium">
              <Clock className="w-4 h-4 shrink-0" />
              <span>Mis de côté pour la future version hébergée</span>
            </div>
            <p>
              Le suivi automatique en direct est mis en réserve pour le déploiement en ligne (piste{" "}
              <strong className="text-ink">scrobbles gratuits type ListenBrainz / Last.fm</strong>), afin de garder
              cette version locale simple, rapide et sans configuration complexe.
            </p>
            <p className="text-ink-3">
              En attendant, il suffit d&apos;importer une nouvelle archive dès que tu veux actualiser tes stats.
            </p>
          </div>
        </Section>
      </div>

      {/* Collapsible Advanced / Technical Drawer (closed by default) */}
      <details
        data-testid="hub-advanced-drawer"
        className="panel p-5 sm:p-6 group"
      >
        <summary className="cursor-pointer list-none flex items-center justify-between text-sm font-medium text-ink-2 hover:text-ink select-none">
          <span>Options avancées / Technique</span>
          <ChevronDown className="w-4 h-4 text-ink-3 transition-transform group-open:rotate-180" />
        </summary>

        <div className="mt-6 space-y-6 pt-5 border-t border-line">
          <div className="flex flex-wrap items-center gap-4 text-xs">
            <label className="flex items-center gap-2 text-ink-2 cursor-pointer">
              <input
                type="checkbox"
                checked={includeIncognito}
                onChange={(e) => setIncludeIncognito(e.target.checked)}
                className="accent-amber"
              />
              Inclure les sessions privées Spotify (<code>incognito_mode</code>) lors de l&apos;import
            </label>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
            {/* Capabilities Matrix */}
            <div className="lg:col-span-6 space-y-3">
              <p className="kicker">MATRICE DE CAPACITÉS DU PROFIL ACTIF</p>
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
            </div>

            {/* Merged Profiles (ISRC ±180s) */}
            <div className="lg:col-span-6 space-y-3">
              <p className="kicker">FUSION MULTI-PROFILS (DÉDUPLICATION ISRC ±180S)</p>
              {standardProfiles.length >= 2 ? (
                <div className="space-y-2.5 p-3.5 rounded bg-bg-3 border border-line">
                  <p className="text-xs font-medium flex items-center gap-1.5 text-ink">
                    <GitMerge className="w-3.5 h-3.5 text-amber" /> Créer une vue fusionnée
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
              ) : (
                <p className="text-xs text-ink-3">Importe au moins deux profils distincts pour activer la fusion.</p>
              )}
            </div>
          </div>

          {/* Extension MV3, Webhooks & LAN QR */}
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
            <div className="lg:col-span-7 space-y-2.5 text-xs">
              <p className="kicker">EXTENSION MV3 & WEBHOOKS LOCAUX</p>
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
                    <button onClick={() => copyText(g.id, g.copy_value)} className="btn text-[11px] num h-7">
                      {copiedId === g.id ? <Check className="w-3 h-3 text-amber" /> : <Copy className="w-3 h-3" />}
                      {g.copy_value}
                    </button>
                  )}
                </div>
              ))}
            </div>

            <div className="lg:col-span-5 space-y-3 text-xs" data-testid="lan-qr-card">
              <p className="kicker">ACCÈS SMARTPHONE LAN WI-FI</p>
              {trackingSetup?.lan && (
                <div className="flex items-center gap-4 pt-1">
                  <div
                    className="w-24 h-24 rounded bg-white p-1.5 shrink-0 flex items-center justify-center [&>svg]:w-full [&>svg]:h-full"
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
          </div>
        </div>
      </details>
    </Page>
  );
};
