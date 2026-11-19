import { Disc3, Pause, Play } from 'lucide-react'
import { useApp } from '../../store/AppContext'

interface ArtworkProps {
  url?: string | null
  alt: string
  size?: 'xs' | 'sm' | 'md' | 'lg' | 'xl'
  rounded?: 'md' | 'lg' | 'xl' | 'full'
  previewUrl?: string | null
  songName?: string
  artistName?: string | null
  albumName?: string | null
  className?: string
}

const SIZE_MAP = {
  xs: 'w-9 h-9',
  sm: 'w-11 h-11',
  md: 'w-14 h-14',
  lg: 'w-20 h-20',
  xl: 'w-28 h-28',
}

const RADIUS_MAP = {
  md: 'rounded-lg',
  lg: 'rounded-xl',
  xl: 'rounded-2xl',
  full: 'rounded-full',
}

export function Artwork({
  url,
  alt,
  size = 'md',
  rounded = 'lg',
  previewUrl,
  songName,
  artistName,
  albumName,
  className = '',
}: ArtworkProps) {
  const { playPreview, playingTrack, isPlaying } = useApp()
  const isThisPlaying = Boolean(previewUrl && playingTrack?.preview_url === previewUrl && isPlaying)

  const handlePlayClick = (e: React.MouseEvent) => {
    if (!previewUrl) return
    e.stopPropagation()
    playPreview({
      song_name: songName || alt,
      artist_name: artistName,
      album_name: albumName,
      artwork_url: url,
      preview_url: previewUrl,
    })
  }

  return (
    <div
      className={`relative shrink-0 overflow-hidden bg-gradient-to-br from-zinc-800/90 to-zinc-900/90 border border-white/10 group ${SIZE_MAP[size]} ${RADIUS_MAP[rounded]} ${className}`}
    >
      {url ? (
        <img
          src={url}
          alt={alt}
          loading="lazy"
          className="w-full h-full object-cover transition-transform duration-300 group-hover:scale-105"
        />
      ) : (
        <div className="w-full h-full flex items-center justify-center bg-gradient-to-br from-rose-500/20 via-indigo-500/15 to-zinc-900 text-white/35">
          <Disc3 className="w-1/2 h-1/2" />
        </div>
      )}

      {previewUrl && (
        <button
          type="button"
          onClick={handlePlayClick}
          title={isThisPlaying ? 'Mettre en pause' : 'Écouter un extrait 30s'}
          className={`absolute inset-0 flex items-center justify-center bg-black/50 backdrop-blur-[2px] transition-opacity duration-200 cursor-pointer ${
            isThisPlaying ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'
          }`}
        >
          <span className="w-7 h-7 rounded-full bg-white text-black flex items-center justify-center shadow-lg">
            {isThisPlaying ? <Pause className="w-3.5 h-3.5 fill-current" /> : <Play className="w-3.5 h-3.5 fill-current ml-0.5" />}
          </span>
        </button>
      )}
    </div>
  )
}
