import { AnimatePresence, motion } from 'framer-motion'
import { CheckCircle2, FileArchive, Loader2, Upload, X } from 'lucide-react'
import { useRef, useState } from 'react'
import { uploadZipFile } from '../../api/client'
import { useApp } from '../../store/AppContext'

export function ImportZipModal() {
  const { importModalOpen, setImportModalOpen, triggerRefresh } = useApp()
  const [dragging, setDragging] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement | null>(null)

  const handleFile = async (file: File) => {
    if (!file.name.toLowerCase().endsWith('.zip')) {
      setError('Veuillez sélectionner une archive .zip (Apple Media Services information.zip).')
      return
    }
    setError(null)
    setSuccess(null)
    setUploading(true)
    try {
      const res = await uploadZipFile(file)
      setSuccess(
        `Import réussi : ${res.summary.total_play_events.toLocaleString('fr-FR')} écoutes audio, ${res.summary.unique_tracks.toLocaleString('fr-FR')} titres uniques (${res.summary.pass1_artist_pct}% résolus en Passe 1).`
      )
      triggerRefresh()
      setTimeout(() => {
        setImportModalOpen(false)
        setSuccess(null)
      }, 1500)
    } catch (e: any) {
      setError(e.message || "Échec de l'import.")
    } finally {
      setUploading(false)
    }
  }

  return (
    <AnimatePresence>
      {importModalOpen && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-md p-4"
          onClick={() => !uploading && setImportModalOpen(false)}
        >
          <motion.div
            initial={{ scale: 0.94, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0.94, opacity: 0 }}
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-lg glass-panel rounded-3xl p-6 border border-white/15"
          >
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2.5">
                <div className="w-9 h-9 rounded-xl bg-rose-500/20 text-rose-400 flex items-center justify-center">
                  <FileArchive className="w-5 h-5" />
                </div>
                <div>
                  <h2 className="text-lg font-bold text-white">Importer un export Apple Music</h2>
                  <p className="text-xs text-zinc-400">Archive RGPD Apple Media Services information.zip</p>
                </div>
              </div>
              {!uploading && (
                <button
                  type="button"
                  onClick={() => setImportModalOpen(false)}
                  className="p-1.5 rounded-xl hover:bg-white/10 text-zinc-400 hover:text-white cursor-pointer"
                >
                  <X className="w-4 h-4" />
                </button>
              )}
            </div>

            <div
              onDragOver={(e) => {
                e.preventDefault()
                setDragging(true)
              }}
              onDragLeave={() => setDragging(false)}
              onDrop={(e) => {
                e.preventDefault()
                setDragging(false)
                const f = e.dataTransfer.files[0]
                if (f) handleFile(f)
              }}
              onClick={() => !uploading && inputRef.current?.click()}
              className={`border-2 border-dashed rounded-2xl p-8 text-center transition-all cursor-pointer ${
                dragging
                  ? 'border-rose-400 bg-rose-500/10'
                  : 'border-white/15 hover:border-white/30 bg-white/[0.02]'
              }`}
            >
              <input
                ref={inputRef}
                type="file"
                accept=".zip"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0]
                  if (f) handleFile(f)
                }}
              />
              {uploading ? (
                <div className="flex flex-col items-center gap-3">
                  <Loader2 className="w-10 h-10 text-rose-400 animate-spin" />
                  <p className="text-sm font-medium text-white">Analyse de l'archive & Passe 1 en cours…</p>
                  <p className="text-xs text-zinc-400">Le cache d'enrichissement iTunes existant est conservé.</p>
                </div>
              ) : (
                <div className="flex flex-col items-center gap-2.5">
                  <div className="w-12 h-12 rounded-2xl bg-white/[0.06] flex items-center justify-center text-zinc-300">
                    <Upload className="w-6 h-6" />
                  </div>
                  <p className="text-sm font-medium text-white">Glissez-déposez votre fichier .zip ici</p>
                  <p className="text-xs text-zinc-400">ou cliquez pour parcourir vos fichiers</p>
                </div>
              )}
            </div>

            {error && (
              <div className="mt-4 p-3 rounded-xl bg-red-500/15 border border-red-500/30 text-xs text-red-300">
                {error}
              </div>
            )}
            {success && (
              <div className="mt-4 p-3 rounded-xl bg-emerald-500/15 border border-emerald-500/30 text-xs text-emerald-300 flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4 shrink-0" />
                <span>{success}</span>
              </div>
            )}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
