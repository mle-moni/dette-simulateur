// Télécharge les séries historiques du FMI (API DataMapper) et écrit src/data/pays.json.
// Usage : node scripts/fetch-data.mjs
//
// Sources :
//   FPP — « Public Finances in Modern History » (dette, intérêts, solde primaire, taux long réel), jusqu'en 2024
//   WEO — « World Economic Outlook » (croissance, inflation, PIB en $, et prévisions budgétaires 2025-2026)
import { writeFile } from 'node:fs/promises'

const API = 'https://www.imf.org/external/datamapper/api/v1'
const FIRST = 1980
const LAST = 2026
const LAST_FPP = 2024

const PAYS = {
  FRA: 'France',
  DEU: 'Allemagne',
  ITA: 'Italie',
  ESP: 'Espagne',
  GRC: 'Grèce',
  PRT: 'Portugal',
  BEL: 'Belgique',
  NLD: 'Pays-Bas',
  IRL: 'Irlande',
  GBR: 'Royaume-Uni',
  USA: 'États-Unis',
  CAN: 'Canada',
  JPN: 'Japon',
}

// Taux souverains à 10 ans absents de FPP après 2024 (saisis à la main).
// 2025 : moyennes annuelles approximatives. 2026 : cotations de fin d'été / fin septembre 2026.
const TAUX_10A = {
  FRA: { 2025: 3.35, 2026: 4.8 },
  DEU: { 2025: 2.6, 2026: 3.85 },
  ITA: { 2025: 3.6, 2026: 4.8 },
  ESP: { 2025: 3.2, 2026: 4.15 },
  GRC: { 2025: 3.4, 2026: 4.5 },
  PRT: { 2025: 3.1, 2026: 3.44 },
  BEL: { 2025: 3.2, 2026: 3.76 },
  NLD: { 2025: 2.8, 2026: 3.29 },
  IRL: { 2025: 2.9, 2026: 3.35 },
  GBR: { 2025: 4.6, 2026: 5.31 },
  USA: { 2025: 4.3, 2026: 5.29 },
  CAN: { 2025: 3.3, 2026: 3.97 },
  JPN: { 2025: 1.4, 2026: 3.07 },
}

// Durée moyenne de la dette (années) : pas de série historique, valeur typique par pays.
const MATURITE = {
  FRA: 8.5,
  DEU: 7,
  ITA: 7,
  ESP: 8,
  GRC: 7.5,
  PRT: 7.5,
  BEL: 10,
  NLD: 7.5,
  IRL: 10,
  GBR: 14,
  USA: 6,
  CAN: 6.5,
  JPN: 9,
}
const maturite = (code, annee) => (code === 'GRC' && annee >= 2012 ? 19 : MATURITE[code]) // restructuration grecque

async function series(indicator) {
  const res = await fetch(`${API}/${indicator}`)
  if (!res.ok) throw new Error(`${indicator}: HTTP ${res.status}`)
  const json = await res.json()
  return json.values?.[indicator] ?? {}
}

const ids = [
  'd',
  'ie',
  'pb',
  'rltir',
  'GGXWDG_NGDP',
  'GGXCNL_NGDP',
  'GGXONLB_G01_GDP_PT',
  'NGDP_RPCH',
  'PCPIPCH',
  'NGDPD',
]
const S = Object.fromEntries(await Promise.all(ids.map(async (id) => [id, await series(id)])))

const get = (id, code, annee) => {
  const v = S[id][code]?.[annee]
  return v === undefined || v === null || v === '' ? null : Number(v)
}
const round = (x, n = 2) => (x === null || !Number.isFinite(x) ? null : Math.round(x * 10 ** n) / 10 ** n)

const pays = Object.entries(PAYS).map(([code, nom]) => {
  const annees = {}
  // Dette, intérêts et solde primaire : FPP jusqu'en 2024. Au-delà, les prévisions WEO sont
  // raccordées au dernier point FPP (les définitions diffèrent un peu, ex. intérêts nets
  // dans le WEO) : on applique l'évolution prévue par le WEO au niveau FPP de 2024.
  const weoDette = (a) => get('GGXWDG_NGDP', code, a)
  const weoPb = (a) => get('GGXONLB_G01_GDP_PT', code, a)
  const weoInterets = (a) => {
    const prim = weoPb(a)
    const total = get('GGXCNL_NGDP', code, a)
    return prim !== null && total !== null ? prim - total : null
  }
  const weoTaux = (a) => {
    const ie = weoInterets(a)
    const dPrec = weoDette(a - 1)
    return ie !== null && dPrec ? (ie / dPrec) * 100 : null
  }
  const ratio = (x, y) => (x !== null && y ? x / y : null)
  const dette = (a) => {
    if (a <= LAST_FPP) return get('d', code, a) ?? weoDette(a)
    const k = ratio(weoDette(a), weoDette(LAST_FPP))
    const base = get('d', code, LAST_FPP)
    return k !== null && base !== null ? base * k : weoDette(a)
  }
  const pb = (a) => {
    if (a <= LAST_FPP) return get('pb', code, a) ?? weoPb(a)
    const w = weoPb(a)
    const w0 = weoPb(LAST_FPP)
    const base = get('pb', code, LAST_FPP)
    return w !== null && w0 !== null && base !== null ? base + (w - w0) : w
  }
  const tauxMoyen = (a) => {
    const ie = a <= LAST_FPP ? get('ie', code, a) : null
    const dPrec = dette(a - 1)
    if (ie !== null && dPrec) return (ie / dPrec) * 100
    // Intérêts nets quasi nuls dans le WEO (gros actifs financiers, ex. Canada) : on garde le taux 2024.
    const base = tauxMoyen(LAST_FPP)
    const w0 = weoTaux(LAST_FPP)
    const k = w0 !== null && w0 > 0.5 ? ratio(weoTaux(a), w0) : 1
    return base !== null && k !== null ? base * Math.min(Math.max(k, 0.8), 1.25) : weoTaux(a) // borné : le taux moyen bouge lentement
  }
  for (let a = FIRST; a <= LAST; a++) {
    const inflation = get('PCPIPCH', code, a)
    const d = dette(a)
    const rl = a <= LAST_FPP ? get('rltir', code, a) : null
    const tauxMarginal =
      TAUX_10A[code][a] ??
      (rl !== null && inflation !== null ? ((1 + rl / 100) * (1 + inflation / 100) - 1) * 100 : null)
    const p = pb(a)
    annees[a] = {
      pib: round(get('NGDPD', code, a), 0),
      dette: round(d, 1),
      croissance: round(get('NGDP_RPCH', code, a), 1),
      inflation: round(inflation, 1),
      taux: round(tauxMoyen(a)),
      tauxMarginal: round(tauxMarginal),
      maturite: maturite(code, a),
      deficitPrimaire: round(p === null ? null : -p),
    }
  }
  return { code, nom, annees }
})

const out = {
  genere: new Date().toISOString().slice(0, 10),
  sources:
    'FMI — Public Finances in Modern History (≤ 2024) et World Economic Outlook (croissance, inflation, PIB, prévisions 2025-2026)',
  pays,
}
await writeFile(new URL('../src/data/pays.json', import.meta.url), JSON.stringify(out) + '\n')

for (const p of pays) {
  const manquants = Object.entries(p.annees)
    .filter(([, v]) => Object.values(v).some((x) => x === null))
    .map(([a]) => a)
  console.log(p.code, manquants.length ? `incomplet : ${manquants.join(' ')}` : 'complet')
}
