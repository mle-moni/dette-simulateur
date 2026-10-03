import raw from './data/pays.json'
import type { Params } from './debt'

// Données générées par scripts/fetch-data.mjs (FMI). Une valeur peut manquer (null).
export type DataPoint = { [K in Exclude<keyof Params, 'horizon' | 'tauxVariable'>]: number | null }

export type Pays = { code: string; nom: string; annees: Record<string, DataPoint> }

export const DATA = raw as { genere: string; sources: string; pays: Pays[] }

export const PREMIERE_ANNEE = 1980
export const DERNIERE_ANNEE = 2026
// Années issues des prévisions du FMI plutôt que de données constatées.
export const PREMIERE_PREVISION = 2025

export const findPays = (code: string) => DATA.pays.find((p) => p.code === code)!

// Applique les données d'une année aux paramètres ; les valeurs manquantes gardent l'ancienne valeur.
export function paramsFromData(prev: Params, point: DataPoint): { params: Params; manquants: string[] } {
  const params = { ...prev }
  const manquants: string[] = []
  for (const [k, v] of Object.entries(point) as [keyof DataPoint, number | null][]) {
    if (v === null) manquants.push(k)
    else params[k] = v
  }
  return { params, manquants }
}

// Trajectoire constatée du ratio dette/PIB à partir de l'année `annee`.
export function trajectoireReelle(pays: Pays, annee: number, horizon: number) {
  const points: { t: number; ratio: number }[] = []
  for (let a = annee; a <= Math.min(annee + horizon, DERNIERE_ANNEE); a++) {
    const d = pays.annees[a]?.dette
    if (d !== null && d !== undefined) points.push({ t: a - annee, ratio: d })
  }
  return points
}
