import * as echarts from 'echarts'
import { useEffect, useRef } from 'react'

interface EChartBoxProps {
  option: echarts.EChartsCoreOption
  height?: number | string
  className?: string
  onChartClick?: (params: any) => void
}

export function EChartBox({ option, height = 320, className = '', onChartClick }: EChartBoxProps) {
  const ref = useRef<HTMLDivElement | null>(null)
  const chartRef = useRef<echarts.ECharts | null>(null)

  useEffect(() => {
    if (!ref.current) return
    const chart = echarts.init(ref.current, undefined, { renderer: 'canvas' })
    chartRef.current = chart

    const ro = new ResizeObserver(() => {
      chart.resize()
    })
    ro.observe(ref.current)

    return () => {
      ro.disconnect()
      chart.dispose()
      chartRef.current = null
    }
  }, [])

  useEffect(() => {
    const chart = chartRef.current
    if (!chart) return
    chart.setOption(option, { notMerge: true })
  }, [option])

  useEffect(() => {
    const chart = chartRef.current
    if (!chart) return
    chart.off('click')
    if (onChartClick) {
      chart.on('click', onChartClick)
    }
  }, [onChartClick])

  return <div ref={ref} style={{ height }} className={`w-full ${className}`} />
}
