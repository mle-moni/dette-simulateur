import { useEffect, useRef, useState } from 'react'
import type { YearRow } from './debt'

const H = 300
const M = { top: 16, right: 20, bottom: 32, left: 48 }

const fmt = (x: number, digits = 1) => x.toLocaleString('fr-FR', { minimumFractionDigits: digits, maximumFractionDigits: digits })

function niceTicks(min: number, max: number, count = 5) {
  // Courbe (quasi) plate : on impose une amplitude minimale, sinon le pas tombe sous la
  // précision des flottants et la boucle ci-dessous ne termine jamais.
  if (max - min < 1) {
    const mid = (min + max) / 2
    min = mid - 1
    max = mid + 1
  }
  const span = max - min
  const raw = span / count
  const mag = 10 ** Math.floor(Math.log10(raw))
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw) ?? raw
  const lo = Math.floor(min / step) * step
  const hi = Math.ceil(max / step) * step
  const ticks: number[] = []
  for (let k = 0; lo + k * step <= hi + step / 2; k++) ticks.push(+(lo + k * step).toFixed(10))
  return ticks
}

type Props = {
  rows: YearRow[]
  reference: number
  baseYear: number
  // Trajectoire constatée (t = années depuis baseYear), affichée en second série.
  actual: { t: number; ratio: number }[]
}

export function RatioChart({ rows, reference, baseYear, actual }: Props) {
  const wrapRef = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(640)
  const [hover, setHover] = useState<number | null>(null)

  useEffect(() => {
    const el = wrapRef.current
    if (!el) return
    const ro = new ResizeObserver(([e]) => setWidth(e.contentRect.width))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  // Le point de départ réel est confondu avec la projection : on ne montre le réel que s'il va au-delà.
  const showActual = actual.length > 1
  const values = rows.map((r) => r.ratio).concat(reference, showActual ? actual.map((a) => a.ratio) : [])
  const ticks = niceTicks(Math.min(...values), Math.max(...values))
  const yMin = ticks[0]
  const yMax = ticks[ticks.length - 1]
  const n = rows.length - 1 || 1
  const iw = Math.max(width - M.left - M.right, 10)
  const ih = H - M.top - M.bottom
  const x = (t: number) => M.left + (t / n) * iw
  const y = (v: number) => M.top + ih - ((v - yMin) / (yMax - yMin || 1)) * ih

  const line = (pts: { t: number; v: number }[]) => pts.map((p, k) => `${k ? 'L' : 'M'}${x(p.t)},${y(p.v)}`).join('')
  const path = line(rows.map((r) => ({ t: r.annee, v: r.ratio })))
  const actualPath = line(actual.map((a) => ({ t: a.t, v: a.ratio })))
  const xStep = Math.max(1, Math.ceil(n / Math.max(2, Math.floor(iw / 50))))
  const last = rows[rows.length - 1]
  const lastActual = actual[actual.length - 1]
  const h = hover !== null ? rows[hover] : null
  const hActual = hover !== null ? actual.find((a) => a.t === hover) : undefined

  const onMove = (e: React.PointerEvent<SVGRectElement>) => {
    const box = e.currentTarget.getBoundingClientRect()
    const t = Math.round(((e.clientX - box.left) / box.width) * n)
    setHover(Math.min(Math.max(t, 0), rows.length - 1))
  }

  return (
    <div className="chart" ref={wrapRef}>
      {showActual && (
        <div className="legend">
          <span><i className="swatch projection" />Projection</span>
          <span><i className="swatch reel" />Réel (FMI)</span>
        </div>
      )}
      <svg width={width} height={H} role="img" aria-label="Projection du ratio dette/PIB">
        {ticks.map((v) => (
          <g key={v}>
            <line className="grid" x1={M.left} x2={M.left + iw} y1={y(v)} y2={y(v)} />
            <text className="axis" x={M.left - 8} y={y(v)} dy="0.32em" textAnchor="end">
              {fmt(v, 0)}%
            </text>
          </g>
        ))}
        {rows.filter((r) => r.annee % xStep === 0).map((r) => (
          <text key={r.annee} className="axis" x={x(r.annee)} y={H - 10} textAnchor="middle">
            {baseYear + r.annee}
          </text>
        ))}
        <line className="ref" x1={M.left} x2={M.left + iw} y1={y(reference)} y2={y(reference)} />
        <text className="ref-label" x={M.left + iw} y={y(reference) + (last.ratio > reference ? 14 : -6)} textAnchor="end">
          niveau initial
        </text>
        {showActual && (
          <>
            <path className="series actual" d={actualPath} />
            <circle className="dot actual" cx={x(lastActual.t)} cy={y(lastActual.ratio)} r={4} />
          </>
        )}
        <path className="series" d={path} />
        <circle className="dot" cx={x(last.annee)} cy={y(last.ratio)} r={4} />
        <text className="end-label" x={x(last.annee) - 8} y={y(last.ratio) + (last.ratio >= reference ? -10 : 18)} textAnchor="end">
          {fmt(last.ratio)}%
        </text>
        {h && (
          <g pointerEvents="none">
            <line className="crosshair" x1={x(h.annee)} x2={x(h.annee)} y1={M.top} y2={M.top + ih} />
            {hActual && showActual && <circle className="dot actual" cx={x(hActual.t)} cy={y(hActual.ratio)} r={5} />}
            <circle className="dot" cx={x(h.annee)} cy={y(h.ratio)} r={5} />
          </g>
        )}
        <rect
          x={M.left}
          y={M.top}
          width={iw}
          height={ih}
          fill="transparent"
          onPointerMove={onMove}
          onPointerLeave={() => setHover(null)}
        />
      </svg>
      {h && (
        <div
          className="tooltip"
          style={{ left: Math.min(x(h.annee) + 12, width - 190), top: Math.max(y(h.ratio) - 70, 0) }}
        >
          <strong>{baseYear + h.annee}</strong>
          <span>Projection <b>{fmt(h.ratio)}%</b></span>
          {hActual && showActual && <span>Réel <b>{fmt(hActual.ratio)}%</b></span>}
          <span>Dette <b>{fmt(h.dette, 0)} Md$</b></span>
          <span>Taux moyen <b>{fmt(h.taux, 2)}%</b></span>
          <span>Charge <b>{fmt(h.charge, 2)}% PIB</b></span>
        </div>
      )}
    </div>
  )
}
