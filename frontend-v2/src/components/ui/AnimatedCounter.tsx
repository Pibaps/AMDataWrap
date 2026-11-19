import { useEffect, useState } from 'react'

interface AnimatedCounterProps {
  value: number
  decimals?: number
  suffix?: string
  prefix?: string
  duration?: number
  className?: string
}

export function AnimatedCounter({
  value,
  decimals = 0,
  suffix = '',
  prefix = '',
  duration = 650,
  className = '',
}: AnimatedCounterProps) {
  const [display, setDisplay] = useState(value)

  useEffect(() => {
    let start: number | null = null
    const from = display
    const to = value
    if (from === to) return

    let rafId = 0
    const step = (ts: number) => {
      if (!start) start = ts
      const p = Math.min(1, (ts - start) / duration)
      const eased = 1 - Math.pow(1 - p, 3)
      setDisplay(from + (to - from) * eased)
      if (p < 1) {
        rafId = requestAnimationFrame(step)
      } else {
        setDisplay(to)
      }
    }
    rafId = requestAnimationFrame(step)
    return () => cancelAnimationFrame(rafId)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, duration])

  const formatted =
    decimals > 0
      ? display.toLocaleString('fr-FR', { minimumFractionDigits: decimals, maximumFractionDigits: decimals })
      : Math.round(display).toLocaleString('fr-FR')

  return (
    <span className={`font-mono-num ${className}`}>
      {prefix}
      {formatted}
      {suffix}
    </span>
  )
}
