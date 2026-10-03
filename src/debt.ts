// Modèle de dynamique de la dette publique.
//
// Notations (taux exprimés en fraction, pas en %) :
//   d : dette / PIB         g : croissance réelle     π : inflation
//   i : taux apparent (taux moyen) de la dette        p : déficit primaire / PIB
//   r : taux des nouveaux emprunts                    m : durée moyenne de la dette (ans)
//
// Récurrence : D_t = D_{t-1}·(1+i_{t-1}) + p·Y_t   et   Y_t = Y_{t-1}·(1+g)(1+π)
//
// Le taux moyen n'est pas figé : chaque année, 1/m du stock arrive à échéance et
// est refinancé au taux r, de même que la dette nouvelle. Le taux moyen converge
// donc vers r en quelques années (environ m).

export type Params = {
  pib: number // Md
  dette: number // % du PIB
  croissance: number // %
  inflation: number // %
  taux: number // % (taux moyen initial)
  tauxMarginal: number // % (taux des nouveaux emprunts)
  maturite: number // années
  tauxVariable: boolean // false : le taux moyen reste figé (taux marginal ignoré)
  deficitPrimaire: number // % du PIB (positif = déficit, négatif = excédent)
  horizon: number // années
}

export type SolvableKey = 'dette' | 'croissance' | 'inflation' | 'taux' | 'tauxMarginal' | 'deficitPrimaire'

export type YearRow = {
  annee: number
  pib: number
  dette: number // Md
  ratio: number // %
  taux: number // % (taux moyen en fin d'année)
  charge: number // % du PIB
  deficitTotal: number // % du PIB
}

export const chargeFromParams = (p: Params) => (p.taux / 100) * p.dette

export function project(p: Params): YearRow[] {
  const G = (1 + p.croissance / 100) * (1 + p.inflation / 100)
  const r = (p.tauxVariable ? p.tauxMarginal : p.taux) / 100
  const pd = p.deficitPrimaire / 100
  const amort = 1 / Math.max(p.maturite, 1)
  let i = p.taux / 100
  let Y = p.pib
  let D = (p.dette / 100) * Y
  const rows: YearRow[] = [
    {
      annee: 0,
      pib: Y,
      dette: D,
      ratio: p.dette,
      taux: p.taux,
      charge: chargeFromParams(p),
      deficitTotal: p.deficitPrimaire + chargeFromParams(p),
    },
  ]
  for (let t = 1; t <= p.horizon; t++) {
    const interets = i * D
    Y = Y * G
    const Dn = D + interets + pd * Y
    // Part de l'ancien stock encore en vie ; le reste est (re)financé au taux r.
    const ancien = Math.max(Math.min(D * (1 - amort), Dn), 0)
    i = Dn > 0 ? (i * ancien + r * (Dn - ancien)) / Dn : r
    D = Dn
    const charge = (interets / Y) * 100
    rows.push({
      annee: t,
      pib: Y,
      dette: D,
      ratio: (D / Y) * 100,
      taux: i * 100,
      charge,
      deficitTotal: p.deficitPrimaire + charge,
    })
  }
  return rows
}

// Bornes de recherche et sens de variation du ratio final pour chaque paramètre.
const SEARCH: Record<SolvableKey, [number, number]> = {
  dette: [0, 2000],
  croissance: [-30, 50],
  inflation: [-30, 50],
  taux: [-20, 50],
  tauxMarginal: [-20, 50],
  deficitPrimaire: [-50, 50],
}

// Valeur du paramètre `key` qui ramène le ratio dette/PIB à son niveau initial
// au terme de l'horizon, les autres paramètres étant fixés. Avec des taux
// constants (taux moyen = taux marginal), cela revient à un ratio stationnaire.
// Renvoie null si aucune valeur n'existe dans les bornes de recherche.
export function solve(p: Params, key: SolvableKey): number | null {
  const gap = (v: number) => {
    const q = { ...p, [key]: v }
    return project(q).at(-1)!.ratio - q.dette
  }
  let [lo, hi] = SEARCH[key]
  let flo = gap(lo)
  let fhi = gap(hi)
  // Quand taux < croissance nominale, un ratio stable existe toujours mais peut être
  // très élevé (déficit primaire / écart) : on élargit la recherche jusqu'à 10 000 000 %.
  while (key === 'dette' && Number.isFinite(fhi) && Math.sign(flo) === Math.sign(fhi) && hi < 1e7) {
    hi *= 10
    fhi = gap(hi)
  }
  if (!Number.isFinite(flo) || !Number.isFinite(fhi) || Math.sign(flo) === Math.sign(fhi)) return null
  // Dichotomie : on s'arrête dès que l'intervalle fait moins de 1e-6 (largement assez pour l'affichage).
  while (hi - lo > 1e-6) {
    const mid = (lo + hi) / 2
    const fm = gap(mid)
    if (Math.sign(fm) === Math.sign(flo)) {
      lo = mid
      flo = fm
    } else hi = mid
  }
  return (lo + hi) / 2
}

export const nominalGrowth = (p: Params) => ((1 + p.croissance / 100) * (1 + p.inflation / 100) - 1) * 100
