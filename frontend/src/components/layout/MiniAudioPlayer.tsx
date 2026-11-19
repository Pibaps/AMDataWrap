import { AnimatePresence, motion } from 'framer-motion'
import { Pause, Play, Volume2, X } from 'lucide-react'
import { useApp } from '../../store/AppContext'

export function MiniAudioPlayer() {
  const { playingTrack, isPlaying, togglePlayPause, stopPreview, audioProgress } = useApp()

  return (
    <AnimatePresence>
      {playingTrack && (
        <motion.div
          initial={{ y: 80, opacity: 0, scale: 0.95 }}
          animate={{ y: 0, opacity: 1, scale: 1 }}
          exit={{ y: 80, opacity: 0, scale: 0.95 }}
          transition={{ type: 'spring', stiffness: 360, damping: 30 }}
          className="fixed bottom-5 right-5 z-50 w-80 glass-panel rounded-2xl p-3 shadow-2xl border border-white/15"
        >
          <div className="flex items-center gap-3">
            <div className="w-11 h-11 rounded-xl overflow-hidden bg-zinc-800 shrink-0 border border-white/10">
              {playingTrack.artwork_url ? (
                <img src={playingTrack.artwork_url} alt={playingTrack.song_name} className="w-full h-full object-cover" />
              ) : (
                <div className="w-full h-full flex items-center justify-center text-zinc-500">
                  <Volume2 className="w-5 h-5" />
                </div>
              )}
            </div>

            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1.5">
                <span className="text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded bg-rose-500/20 text-rose-300 font-medium">
                  Aperçu 30s
                </span>
              </div>
              <p className="text-xs font-semibold text-white truncate mt-0.5">{playingTrack.song_name}</p>
              <p className="text-[11px] text-zinc-400 truncate">{playingTrack.artist_name || playingTrack.album_name}</p>
            </div>

            <button
              type="button"
              onClick={togglePlayPause}
              className="w-8 h-8 rounded-full bg-white text-black flex items-center justify-center shrink-0 hover:scale-105 transition-transform cursor-pointer"
            >
              {isPlaying ? <Pause className="w-3.5 h-3.5 fill-current" /> : <Play className="w-3.5 h-3.5 fill-current ml-0.5" />}
            </button>
            <button
              type="button"
              onClick={stopPreview}
              className="p-1 text-zinc-400 hover:text-white cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          <div className="mt-2.5 h-1 w-full rounded-full bg-white/10 overflow-hidden">
            <div
              className="h-full bg-gradient-to-r from-rose-500 to-fuchsia-400 transition-[width] duration-150"
              style={{ width: `${audioProgress}%` }}
            />
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
