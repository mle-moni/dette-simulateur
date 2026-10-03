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
  pib: 'PIB',
  dette: 'dette',
  croissance: 'croissance',
  inflation: 'inflation',
  taux: 'taux moyen',
  tauxMarginal: 'taux des nouveaux emprunts',
  maturite: 'durée',
  deficitPrimaire: 'déficit primaire',
}

type FieldKey = Exclude<keyof Params, 'tauxVariable'> | 'charge' | 'deficitTotal'

type Field = {
  key: FieldKey
  label: React.ReactNode
  unit: string
  step: number
  hint?: React.ReactNode
  solvable?: SolvableKey
  derived?: boolean
  advanced?: boolean // affiché seulement si le taux est variable
}

const FIELDS: Field[] = [
  { key: 'pib', label: 'PIB', unit: 'Md', step: 50, hint: "N'influence pas le ratio, seulement les montants" },
  { key: 'dette', label: 'Dette initiale', unit: '% PIB', step: 1, solvable: 'dette' },
  { key: 'croissance', label: 'Croissance réelle', unit: '%', step: 0.1, solvable: 'croissance' },
  { key: 'inflation', label: 'Inflation', unit: '%', step: 0.1, solvable: 'inflation' },
  {
    key: 'taux',
    label: 'Taux moyen de la dette',
    unit: '%',
    step: 0.1,
    hint: 'Taux apparent actuel du stock',
    solvable: 'taux',
  },
  {
    key: 'tauxMarginal',
    label: 'Taux des nouveaux emprunts',
    unit: '%',
    step: 0.1,
    hint: '≈ taux à 10 ans',
    solvable: 'tauxMarginal',
    advanced: true,
  },
  {
    key: 'maturite',
    label: 'Durée moyenne de la dette',
    unit: 'ans',
    step: 0.5,
    hint: 'Vitesse de convergence du taux moyen',
    advanced: true,
  },
  {
    key: 'deficitPrimaire',
    label: <Terme def="deficitPrimaire">Déficit primaire</Terme>,
    unit: '% PIB',
    step: 0.1,
    hint: 'Négatif = excédent primaire',
    solvable: 'deficitPrimaire',
  },
  { key: 'horizon', label: 'Horizon', unit: 'ans', step: 1 },
  { key: 'charge', label: 'Charge de la dette', unit: 'Md', step: 1, hint: '= taux moyen × dette', derived: true },
  {
    key: 'deficitTotal',
    label: 'Déficit total',
    unit: '% PIB',
    step: 0.1,
    hint: (
      <>
        = <Terme def="deficitPrimaire">déficit primaire</Terme> + charge de la dette
      </>
    ),
    derived: true,
  },
]

const fmt = (x: number, digits = 2) =>
  x.toLocaleString('fr-FR', { minimumFractionDigits: 0, maximumFractionDigits: digits })

export default function App() {
  const [paysCode, setPaysCode] = useState(INITIAL.pays)
  const [annee, setAnnee] = useState(INITIAL.annee)
  const [params, setParams] = useState<Params>(
    () =>
      paramsFromData({ horizon: 20, tauxVariable: false } as Params, findPays(INITIAL.pays).annees[INITIAL.annee])
        .params,
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

  // Plus forte charge d'intérêts de la projection (% du PIB). Au-delà de 5 %, c'est une part
  // considérable de la richesse produite (environ un dixième des recettes publiques en France).
  const SEUIL_CHARGE = 5
  const chargeMax = Math.max(...rows.map((r) => r.charge))
  const alerteCharge =
    chargeMax > SEUIL_CHARGE
      ? `Attention : la charge d'intérêts atteint ${fmt(chargeMax, 1)} % du PIB sur la projection. Autrement dit, ${fmt(chargeMax, 1)} % de toute la richesse produite chaque année sert uniquement à payer les intérêts de la dette, sans même en rembourser le capital, et ne peut donc pas financer la Sécurité sociale, les retraites, l'éducation ou la santé.`
      : null

  // Explication de la valeur trouvée par la baguette, affichée en infobulle à côté du champ.
  const solveMessage =
    solved === null
      ? 'Aucune valeur de ce paramètre ne permet de stabiliser le ratio avec les autres valeurs.'
      : solving === 'dette'
        ? ecartTerme < 0
          ? "Niveau vers lequel la dette converge d'elle-même avec ces paramètres (taux < croissance nominale)."
          : "Seuil au-delà duquel la dette s'emballe, en deçà duquel elle se résorbe (taux > croissance nominale)."
        : `Valeur qui ramène le ratio dette/PIB à son niveau initial dans ${effective.horizon} ans.`

  const renderField = (f: Field) => {
    const isFree = !!f.solvable && solving === f.solvable
    const impossible = isFree && solved === null
    const value = valueOf(f.key, effective)
    const alerte = f.key === 'charge' ? alerteCharge : null
    return (
      <div
        className={`field${isFree ? ' free' : ''}${alerte ? ' alerte' : ''}${survol === f.key ? ' hl' : ''}`}
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
              aria-describedby={isFree ? 'solve-tip' : undefined}
              title={isFree ? 'Revenir à la valeur saisie' : "Trouver la valeur d'équilibre"}
              onClick={() => toggleSolve(f.solvable!)}
            >
              <WandIcon />
            </button>
          ) : alerte ? (
            <span className="warn-icon" aria-describedby={`${f.key}-alerte`}>
              <WarnIcon />
            </span>
          ) : (
            <span className="solve-spacer" />
          )}
        </div>
        {isFree && (
          <span id="solve-tip" role="tooltip" className="solve-tip">
            {solveMessage}
          </span>
        )}
        {alerte && (
          <span id={`${f.key}-alerte`} role="tooltip" className="solve-tip warn-tip">
            {alerte}
          </span>
        )}
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
        <p className="lede">Projetez le ratio dette/PIB à partir de quelques paramètres.</p>
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
        {manquants.length > 0 &&
          `Données manquantes (valeur précédente conservée) : ${manquants.map((k) => LABELS[k]).join(', ')}. `}
        FMI : base « Public Finances in Modern History » jusqu'en 2024, prévisions du World Economic Outlook pour
        2025-2026. PIB en dollars courants. Taux à 10 ans 2025-2026 et durée de la dette : valeurs indicatives.
      </p>
      <div className="layout">
        <section className="panel params">
          <h2>Paramètres</h2>
          {FIELDS.map((f) => (
            <Fragment key={f.key}>
              {f.key === 'tauxMarginal' && (
                <label className="toggle">
                  <input
                    type="checkbox"
                    checked={params.tauxVariable}
                    onChange={(e) => toggleTauxVariable(e.target.checked)}
                  />
                  Taux qui évolue avec les nouveaux emprunts
                </label>
              )}
              {(!f.advanced || params.tauxVariable) && renderField(f)}
            </Fragment>
          ))}
        </section>

        <section className="results">
          <div className="tiles">
            <div className="tile">
              <span className="tile-label">Dette/PIB en {annee + effective.horizon}</span>
              <span className="tile-value">{fmt(last.ratio, 1)}%</span>
              <span className={`trend ${trend}`}>
                {trend === 'stable'
                  ? '→ stable'
                  : `${trend === 'up' ? '▲' : '▼'} ${delta > 0 ? '+' : ''}${fmt(delta, 1)} pts`}
              </span>
            </div>
            <div className="tile">
              <span className="tile-label">
                <Terme def="deficitPrimaire">Déficit primaire</Terme> stabilisant
              </span>
              <span className="tile-value">{stabilizing === null ? '—' : `${fmt(stabilizing, 2)}%`}</span>
              <span className="tile-sub">
                {stabilizing !== null &&
                  `${stabilizing >= 0 ? 'déficit' : 'excédent'} pour retrouver le ratio initial en ${annee + effective.horizon}`}
              </span>
            </div>
            <div className="tile">
              <span className="tile-label">
                Taux − <Terme def="croissanceNominale">croissance nominale</Terme>
              </span>
              <span className="tile-value">{signed(ecartAuj)} pts</span>
              <span className="tile-sub">
                {effective.tauxVariable && `à terme ${signed(ecartTerme)} pts : `}
                {ecartTerme > 0 ? "« effet boule de neige », la dette s'auto-alimente" : 'la croissance érode la dette'}
              </span>
            </div>
          </div>

          <div className="panel">
            <h2>Ratio dette/PIB</h2>
            <RatioChart
              rows={rows}
              reference={effective.dette}
              baseYear={annee}
              actual={trajectoireReelle(pays, annee, effective.horizon)}
            />
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
            {variable(
              'dette',
              <>
                d<sub>t</sub>
              </>,
            )}{' '}
            ={' '}
            {variable(
              'dette',
              <>
                d<sub>t−1</sub>
              </>,
            )}{' '}
            × (1 +{' '}
            {variable(
              'taux',
              <>
                i<sub>t−1</sub>
              </>,
            )}
            ) / ((1 + {variable('croissance', 'g')})(1 + {variable('inflation', 'π')})) +{' '}
            {variable('deficitPrimaire', 'déficit primaire')}
            {effective.tauxVariable && (
              <>
                <br />
                chaque année, 1/{variable('maturite', 'durée')} du stock et la dette nouvelle sont refinancés au{' '}
                {variable('tauxMarginal', 'taux des nouveaux emprunts')}
              </>
            )}
          </p>

          <details className="panel deep-dive">
            <summary>Comprendre la dette</summary>
            <blockquote>
              Avec un <Terme def="deficitPrimaire">déficit primaire</Terme> nul, le ratio de dette en pourcentage du PIB
              augmente si le taux d'intérêt est supérieur à la{' '}
              <Terme def="croissanceNominale">croissance nominale</Terme> et diminue dans le cas contraire. En cas de{' '}
              <Terme def="deficitPrimaire">déficit primaire</Terme> positif, l'effet est plus ambigu : un écart taux -{' '}
              <Terme def="croissanceNominale">croissance nominale</Terme> positif accélère la hausse du ratio de dette,
              tandis qu'un écart négatif permet de contenir cette hausse, voire dans certains cas de faire baisser le
              ratio de dette.
            </blockquote>
            <p className="source-lien">
              Source :{' '}
              <a
                href="https://www.tresor.economie.gouv.fr/Articles/3658fd90-1ddd-492b-884e-56818aa86b2f/files/ac5fd22a-eff1-4cbe-989f-e1f7c75db1ba"
                target="_blank"
                rel="noopener noreferrer"
              >
                Direction générale du Trésor
              </a>
            </p>
          </details>

          <details className="panel deep-dive">
            <summary>Pour aller plus loin : le niveau de dette stabilisant</summary>
            <p>
              Quand le taux moyen est inférieur à la <Terme def="croissanceNominale">croissance nominale</Terme>, il
              existe toujours un niveau de dette qui se stabilise de lui-même, quel que soit le{' '}
              <Terme def="deficitPrimaire">déficit primaire</Terme>. Chaque année, la croissance du PIB érode le ratio
              d'un montant proportionnel à la dette, tandis que le <Terme def="deficitPrimaire">déficit primaire</Terme>{' '}
              l'alourdit d'un montant fixe : plus la dette est élevée, plus l'érosion est forte, jusqu'à compenser
              exactement le déficit. Ce point d'équilibre vaut environ{' '}
              <i>
                <Terme def="deficitPrimaire">déficit primaire</Terme> / (
                <Terme def="croissanceNominale">croissance nominale</Terme> − taux)
              </i>
              .
            </p>
            <p>
              Ce niveau n'est pas pour autant souhaitable : avec un{' '}
              <Terme def="deficitPrimaire">déficit primaire</Terme> de 3 % du PIB et un écart d'un point seulement, la
              dette se stabilise autour de 300 % du PIB. Et même quand le ratio se stabilise, la charge d'intérêts (taux
              × dette) peut dépasser ce que l'État est capable de lever en impôts : il ne peut alors la payer qu'en
              empruntant de nouveau, ce qui dépend entièrement de la confiance des prêteurs.
            </p>
            <p>
              Surtout, ce raisonnement suppose que les autres paramètres ne bougent pas quand la dette augmente, ce qui
              est peu probable. Une dette élevée tend à faire monter les taux exigés par les prêteurs, peut peser sur la
              croissance, et rend le pays plus vulnérable à un choc. L'écart taux − croissance peut alors devenir
              positif et la stabilisation disparaître : la dette entre dans une dynamique d'« effet boule de neige ».
            </p>
          </details>
        </section>
      </div>
    </main>
  )
}

// Champ numérique contrôlé qui garde la saisie en cours (ex. « 1, » ou « - »)
// tout en se resynchronisant quand la valeur change ailleurs.
function NumberInput({
  id,
  step,
  value,
  onChange,
}: {
  id: string
  step: number
  value: number
  onChange: (v: number) => void
}) {
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

const DEFINITIONS = {
  croissanceNominale: 'croissance réelle + inflation',
  deficitPrimaire: 'déficit hors charge de la dette (intérêts)',
}

// Terme accompagné de sa définition au survol.
function Terme({ def, children }: { def: keyof typeof DEFINITIONS; children: React.ReactNode }) {
  return (
    <span className="def" tabIndex={0} data-def={DEFINITIONS[def]}>
      {children}
    </span>
  )
}

function WarnIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      width="18"
      height="18"
      aria-hidden="true"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
      <path d="M12 9v4M12 17h.01" />
    </svg>
  )
}

function WandIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      width="18"
      height="18"
      aria-hidden="true"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="m21.64 3.64-1.28-1.28a1.21 1.21 0 0 0-1.72 0L2.36 18.64a1.21 1.21 0 0 0 0 1.72l1.28 1.28a1.2 1.2 0 0 0 1.72 0L21.64 5.36a1.2 1.2 0 0 0 0-1.72" />
      <path d="m14 7 3 3" />
      <path d="M5 6v4M19 14v4M10 2v2M7 8H3M21 16h-4M11 3H9" />
    </svg>
  )
}
