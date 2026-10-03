import { Fragment, useState } from 'react'
import './App.css'
import { RatioChart } from './Chart'
import { chargeFromParams, nominalGrowth, project, solve, type Params, type SolvableKey } from './debt'
import {
  DATA,
  DERNIERE_ANNEE,
  findPays,
  paramsFromData,
  PREMIERE_ANNEE,
  PREMIERE_PREVISION,
  trajectoireReelle,
} from './data'

const INITIAL = { pays: 'FRA', annee: DERNIERE_ANNEE }

const LABELS: Record<string, string> = {
  pib: 'PIB', dette: 'dette', croissance: 'croissance', inflation: 'inflation', taux: 'taux moyen',
  tauxMarginal: 'taux des nouveaux emprunts', maturite: 'durée', deficitPrimaire: 'déficit primaire',
}

type FieldKey = Exclude<keyof Params, 'tauxVariable'> | 'charge' | 'deficitTotal'

type Field = {
  key: FieldKey
  label: string
  unit: string
  step: number
  hint?: string
  solvable?: SolvableKey
  derived?: boolean
  advanced?: boolean // affiché seulement si le taux est variable
}

const FIELDS: Field[] = [
  { key: 'pib', label: 'PIB', unit: 'Md', step: 50, hint: "N'influence pas le ratio, seulement les montants" },
  { key: 'dette', label: 'Dette initiale', unit: '% PIB', step: 1, solvable: 'dette' },
  { key: 'croissance', label: 'Croissance réelle', unit: '%', step: 0.1, solvable: 'croissance' },
  { key: 'inflation', label: 'Inflation', unit: '%', step: 0.1, solvable: 'inflation' },
  { key: 'taux', label: 'Taux moyen de la dette', unit: '%', step: 0.1, hint: 'Taux apparent actuel du stock', solvable: 'taux' },
  { key: 'tauxMarginal', label: 'Taux des nouveaux emprunts', unit: '%', step: 0.1, hint: '≈ taux à 10 ans', solvable: 'tauxMarginal', advanced: true },
  { key: 'maturite', label: 'Durée moyenne de la dette', unit: 'ans', step: 0.5, hint: 'Vitesse de convergence du taux moyen', advanced: true },
  { key: 'deficitPrimaire', label: 'Déficit primaire', unit: '% PIB', step: 0.1, hint: 'Négatif = excédent primaire', solvable: 'deficitPrimaire' },
  { key: 'horizon', label: 'Horizon', unit: 'ans', step: 1 },
  { key: 'charge', label: 'Charge de la dette', unit: 'Md', step: 1, hint: '= taux moyen × dette', derived: true },
  { key: 'deficitTotal', label: 'Déficit total', unit: '% PIB', step: 0.1, hint: '= déficit primaire + charge de la dette', derived: true },
]

const fmt = (x: number, digits = 2) =>
  x.toLocaleString('fr-FR', { minimumFractionDigits: 0, maximumFractionDigits: digits })

export default function App() {
  const [paysCode, setPaysCode] = useState(INITIAL.pays)
  const [annee, setAnnee] = useState(INITIAL.annee)
  const [params, setParams] = useState<Params>(
    () => paramsFromData({ horizon: 20, tauxVariable: false } as Params, findPays(INITIAL.pays).annees[INITIAL.annee]).params,
  )
  const [manquants, setManquants] = useState<string[]>([])
  const [modifie, setModifie] = useState(false)
  const [solving, setSolving] = useState<SolvableKey | null>(null)
  // Variable survolée (dans la formule ou dans les paramètres), pour surligner l'autre côté.
  const [survol, setSurvol] = useState<FieldKey | null>(null)
  const pays = findPays(paysCode)

  const charger = (code: string, a: number) => {
    const r = paramsFromData(params, findPays(code).annees[a])
    setPaysCode(code)
    setAnnee(a)
    setParams(r.params)
    setManquants(r.manquants)
    setModifie(false)
    setSolving(null)
  }

  const solved = solving ? solve(params, solving) : null
  const effective: Params = solving && solved !== null ? { ...params, [solving]: solved } : params
  const rows = project(effective)
  const last = rows[rows.length - 1]
  const delta = last.ratio - effective.dette
  const stabilizing = solve(effective, 'deficitPrimaire')
  // Écart taux − croissance nominale, aujourd'hui et à terme (taux moyen → taux marginal).
  const ecartAuj = effective.taux - nominalGrowth(effective)
  const ecartTerme = effective.tauxVariable ? effective.tauxMarginal - nominalGrowth(effective) : ecartAuj
  const signed = (x: number) => `${x > 0 ? '+' : ''}${fmt(x, 2)}`

  const valueOf = (key: FieldKey, p: Params) => {
    if (key === 'charge') return (chargeFromParams(p) / 100) * p.pib
    if (key === 'deficitTotal') return p.deficitPrimaire + chargeFromParams(p)
    return p[key]
  }

  const setField = (key: FieldKey, v: number) => {
    if (key !== 'horizon') setModifie(true)
    setParams((p) => {
      if (key === 'horizon') return { ...p, horizon: Math.min(Math.max(Math.round(v), 1), 100) }
      if (key === 'maturite') return { ...p, maturite: Math.min(Math.max(v, 1), 50) }
      return { ...p, [key]: v }
    })
  }

  const toggleTauxVariable = (on: boolean) => {
    setParams((p) => ({ ...p, tauxVariable: on }))
    if (!on && solving === 'tauxMarginal') setSolving(null)
  }

  // La valeur saisie reste dans `params` : désactiver la baguette restaure la valeur d'avant.
  const toggleSolve = (key: SolvableKey) => setSolving((u) => (u === key ? null : key))

  const renderField = (f: Field) => {
    const isFree = !!f.solvable && solving === f.solvable
    const impossible = isFree && solved === null
    const value = valueOf(f.key, effective)
    return (
      <div
        className={`field${isFree ? ' free' : ''}${survol === f.key ? ' hl' : ''}`}
        onMouseEnter={() => setSurvol(f.key)}
        onMouseLeave={() => setSurvol(null)}
      >
        <label htmlFor={f.key}>
          {f.label}
          {f.hint && <small>{f.hint}</small>}
        </label>
        <div className="control">
          {isFree || f.derived ? (
            <output id={f.key} className={f.derived ? 'derived' : undefined}>
              {impossible ? 'impossible' : fmt(value, f.unit === 'Md' ? 0 : 2)}
            </output>
          ) : (
            <NumberInput id={f.key} step={f.step} value={value} onChange={(v) => setField(f.key, v)} />
          )}
          <span className="unit">{f.unit === 'Md' ? 'Md$' : f.unit}</span>
          {f.solvable ? (
            <button
              type="button"
              className="solve"
              aria-pressed={isFree}
              title={isFree ? 'Revenir à la valeur saisie' : 'Trouver la valeur d’équilibre'}
              onClick={() => toggleSolve(f.solvable!)}
            >
              <WandIcon />
            </button>
          ) : (
            <span className="solve-spacer" />
          )}
        </div>
      </div>
    )
  }

  // Variables de la formule liées à chaque champ (les champs calculés renvoient à leurs composantes).
  const LIENS: Partial<Record<FieldKey, FieldKey[]>> = {
    charge: ['taux', 'dette'],
    deficitTotal: ['deficitPrimaire', 'taux', 'dette'],
  }
  const variable = (key: FieldKey, children: React.ReactNode) => {
    const actif = survol !== null && (survol === key || LIENS[survol]?.includes(key))
    return (
      <span
        className={`var${actif ? ' hl' : ''}`}
        onMouseEnter={() => setSurvol(key)}
        onMouseLeave={() => setSurvol(null)}
      >
        {children}
      </span>
    )
  }

  const trend = Math.abs(delta) < 0.05 ? 'stable' : delta > 0 ? 'up' : 'down'

  return (
    <main>
      <header>
        <h1>Simulateur de dette</h1>
        <p className="lede">
          Projetez le ratio dette/PIB à partir de quelques paramètres, puis libérez-en un pour trouver la valeur qui
          stabilise la dette.
        </p>
      </header>

      <div className="source panel">
        <label className="source-pays">
          Pays
          <select value={paysCode} onChange={(e) => charger(e.target.value, annee)}>
            {DATA.pays.map((p) => (
              <option key={p.code} value={p.code}>
                {p.nom}
              </option>
            ))}
          </select>
        </label>
        <label className="source-annee">
          <span>
            Année <b>{annee}</b>
            {annee >= PREMIERE_PREVISION && <em> prévision</em>}
          </span>
          <input
            type="range"
            min={PREMIERE_ANNEE}
            max={DERNIERE_ANNEE}
            step={1}
            value={annee}
            onChange={(e) => charger(paysCode, Number(e.target.value))}
          />
          <span className="source-bornes">
            <span>{PREMIERE_ANNEE}</span>
            <span>{DERNIERE_ANNEE}</span>
          </span>
        </label>
      </div>
      <p className="source-note">
        {modifie ? `${pays.nom} ${annee}, paramètres modifiés. ` : `${pays.nom} ${annee}. `}
        {manquants.length > 0 && `Données manquantes (valeur précédente conservée) : ${manquants.map((k) => LABELS[k]).join(', ')}. `}
        FMI : base « Public Finances in Modern History » jusqu’en 2024, prévisions du World Economic Outlook pour 2025-2026.
        PIB en dollars courants. Taux à 10 ans 2025-2026 et durée de la dette : valeurs indicatives.
      </p>
      <div className="layout">
        <section className="panel params">
          <h2>Paramètres</h2>
          {FIELDS.map((f) => (
            <Fragment key={f.key}>
              {f.key === 'tauxMarginal' && (
                <label className="toggle">
                  <input type="checkbox" checked={params.tauxVariable} onChange={(e) => toggleTauxVariable(e.target.checked)} />
                  Taux qui évolue avec les nouveaux emprunts
                </label>
              )}
              {(!f.advanced || params.tauxVariable) && renderField(f)}
            </Fragment>
          ))}
          {solving && (
            <p className="note">
              {solved === null
                ? 'Aucune valeur de ce paramètre ne permet de stabiliser le ratio avec les autres valeurs.'
                : solving === 'dette'
                  ? ecartTerme < 0
                    ? 'Niveau vers lequel la dette converge d’elle-même avec ces paramètres (taux < croissance nominale).'
                    : 'Seuil au-delà duquel la dette s’emballe, en deçà duquel elle se résorbe (taux > croissance nominale).'
                  : `Valeur qui ramène le ratio dette/PIB à son niveau initial dans ${effective.horizon} ans.`}
            </p>
          )}
        </section>

        <section className="results">
          <div className="tiles">
            <div className="tile">
              <span className="tile-label">Dette/PIB en {annee + effective.horizon}</span>
              <span className="tile-value">{fmt(last.ratio, 1)}%</span>
              <span className={`trend ${trend}`}>
                {trend === 'stable' ? '→ stable' : `${trend === 'up' ? '▲' : '▼'} ${delta > 0 ? '+' : ''}${fmt(delta, 1)} pts`}
              </span>
            </div>
            <div className="tile">
              <span className="tile-label">Déficit primaire stabilisant</span>
              <span className="tile-value">{stabilizing === null ? '—' : `${fmt(stabilizing, 2)}%`}</span>
              <span className="tile-sub">
                {stabilizing !== null && `${stabilizing >= 0 ? 'déficit' : 'excédent'} pour retrouver le ratio initial en ${annee + effective.horizon}`}
              </span>
            </div>
            <div className="tile">
              <span className="tile-label">Taux − croissance nominale</span>
              <span className="tile-value">{signed(ecartAuj)} pts</span>
              <span className="tile-sub">
                {effective.tauxVariable && `à terme ${signed(ecartTerme)} pts : `}
                {ecartTerme > 0 ? '« effet boule de neige », la dette s’auto-alimente' : 'la croissance érode la dette'}
              </span>
            </div>
          </div>

          <div className="panel">
            <h2>Ratio dette/PIB</h2>
            <RatioChart rows={rows} reference={effective.dette} baseYear={annee} actual={trajectoireReelle(pays, annee, effective.horizon)} />
          </div>

          <details className="panel">
            <summary>Tableau de projection</summary>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Année</th>
                    <th>PIB (Md$)</th>
                    <th>Dette (Md$)</th>
                    <th>Dette/PIB</th>
                    {effective.tauxVariable && <th>Taux moyen</th>}
                    <th>Charge (% PIB)</th>
                    <th>Déficit total (% PIB)</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.annee}>
                      <td>{annee + r.annee}</td>
                      <td>{fmt(r.pib, 0)}</td>
                      <td>{fmt(r.dette, 0)}</td>
                      <td>{fmt(r.ratio, 1)}%</td>
                      {effective.tauxVariable && <td>{fmt(r.taux, 2)}%</td>}
                      <td>{fmt(r.charge, 2)}</td>
                      <td>{fmt(r.deficitTotal, 2)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </details>

          <p className="formula">
            {variable('dette', <>d<sub>t</sub></>)} = {variable('dette', <>d<sub>t−1</sub></>)} × (1 +{' '}
            {variable('taux', <>i<sub>t−1</sub></>)}) / ((1 + {variable('croissance', 'g')})(1 +{' '}
            {variable('inflation', 'π')})) + {variable('deficitPrimaire', 'déficit primaire')}
            {effective.tauxVariable && (
              <>
                <br />
                chaque année, 1/{variable('maturite', 'durée')} du stock et la dette nouvelle sont refinancés au{' '}
                {variable('tauxMarginal', 'taux des nouveaux emprunts')}
              </>
            )}
          </p>
        </section>
      </div>
    </main>
  )
}

// Champ numérique contrôlé qui garde la saisie en cours (ex. « 1, » ou « - »)
// tout en se resynchronisant quand la valeur change ailleurs.
function NumberInput({ id, step, value, onChange }: { id: string; step: number; value: number; onChange: (v: number) => void }) {
  const [draft, setDraft] = useState(String(+value.toFixed(3)))
  const [synced, setSynced] = useState(value)
  if (value !== synced) {
    setSynced(value)
    if (Math.abs(parseFloat(draft) - value) > 1e-9) setDraft(String(+value.toFixed(3)))
  }
  return (
    <input
      id={id}
      type="number"
      inputMode="decimal"
      step={step}
      value={draft}
      onChange={(e) => {
        setDraft(e.target.value)
        const v = parseFloat(e.target.value)
        if (Number.isFinite(v)) onChange(v)
      }}
    />
  )
}

function WandIcon() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="m21.64 3.64-1.28-1.28a1.21 1.21 0 0 0-1.72 0L2.36 18.64a1.21 1.21 0 0 0 0 1.72l1.28 1.28a1.2 1.2 0 0 0 1.72 0L21.64 5.36a1.2 1.2 0 0 0 0-1.72" />
      <path d="m14 7 3 3" />
      <path d="M5 6v4M19 14v4M10 2v2M7 8H3M21 16h-4M11 3H9" />
    </svg>
  )
}
