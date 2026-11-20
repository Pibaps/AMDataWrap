import { startTransition, useCallback, useMemo } from 'react'
import { parseAsBoolean, parseAsInteger, parseAsString, parseAsStringLiteral, useQueryStates } from 'nuqs'
import type { FilterState } from '../api/client'

export type VisualEdition = 'field' | 'editorial' | 'observatory'
export type ThemePolarity = 'dark' | 'light'
export type MainTab =
  | 'overview'
  | 'observatory'
  | 'science'
  | 'atlas'
  | 'analytics'
  | 'games'
  | 'continuum'

const editionParser = parseAsStringLiteral(['field', 'editorial', 'observatory'] as const).withDefault('field')
const themeParser = parseAsStringLiteral(['dark', 'light'] as const).withDefault('dark')
const tabParser = parseAsStringLiteral([
  'overview',
  'observatory',
  'science',
  'atlas',
  'analytics',
  'games',
  'continuum',
] as const).withDefault('overview')

const periodParser = parseAsStringLiteral(['all', 'year', 'month', 'season', 'custom'] as const).withDefault('all')
const skipParser = parseAsStringLiteral(['lastfm', 'all', 'custom'] as const).withDefault('lastfm')
const metricParser = parseAsStringLiteral(['ms', 'plays'] as const).withDefault('ms')

export function useUrlAppState() {
  const [state, setState] = useQueryStates(
    {
      tab: tabParser,
      edition: editionParser,
      theme: themeParser,
      calm: parseAsBoolean.withDefault(false),
      period_mode: periodParser,
      year: parseAsInteger,
      month: parseAsString,
      season: parseAsString,
      date_from: parseAsString,
      date_to: parseAsString,
      skip_mode: skipParser,
      min_seconds: parseAsInteger.withDefault(30),
      min_completion_pct: parseAsInteger.withDefault(50),
      metric: metricParser,
      artist: parseAsString,
      genre: parseAsString,
      decade: parseAsInteger,
      container_type: parseAsString,
      device: parseAsString,
      offline: parseAsString,
    },
    {
      history: 'replace',
      shallow: true,
    }
  )

  const filters: FilterState = useMemo(
    () => ({
      period_mode: state.period_mode,
      year: state.year ?? null,
      month: state.month ?? null,
      season: state.season ?? null,
      date_from: state.date_from ?? null,
      date_to: state.date_to ?? null,
      skip_mode: state.skip_mode,
      min_seconds: state.min_seconds,
      min_completion_pct: state.min_completion_pct,
      metric: state.metric,
      artist: state.artist ?? null,
      genre: state.genre ?? null,
      decade: state.decade ?? null,
      container_type: state.container_type ?? null,
      device: state.device ?? null,
      offline: state.offline ?? null,
    }),
    [state]
  )

  const patch = useCallback(
    (updates: Partial<typeof state>) => {
      startTransition(() => {
        void setState(updates)
      })
    },
    [setState]
  )

  const resetFilters = useCallback(() => {
    startTransition(() => {
      void setState({
        period_mode: 'all',
        year: null,
        month: null,
        season: null,
        date_from: null,
        date_to: null,
        skip_mode: 'lastfm',
        min_seconds: 30,
        min_completion_pct: 50,
        metric: 'ms',
        artist: null,
        genre: null,
        decade: null,
        container_type: null,
        device: null,
        offline: null,
      })
    })
  }, [setState])

  return {
    tab: state.tab as MainTab,
    edition: state.edition as VisualEdition,
    theme: state.theme as ThemePolarity,
    calm: state.calm,
    filters,
    setTab: (tab: MainTab) => patch({ tab }),
    setEdition: (edition: VisualEdition) => patch({ edition }),
    setTheme: (theme: ThemePolarity) => patch({ theme }),
    setCalm: (calm: boolean) => patch({ calm }),
    patchFilters: patch,
    resetFilters,
  }
}
