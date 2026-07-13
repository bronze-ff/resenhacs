import { useEffect, useState } from 'react'
import { nomeMapa } from '../lib/format.js'

const MAPAS = ['de_mirage', 'de_dust2', 'de_inferno', 'de_nuke', 'de_overpass', 'de_vertigo', 'de_ancient', 'de_anubis', 'de_train']
const TIPOS = [['', 'Todas'], ['smoke', 'Smoke'], ['flash', 'Flash'], ['he', 'HE'], ['molotov', 'Molotov']]

export default function Granadas() {
  const [mapa, setMapa] = useState(MAPAS[0])
  const [tipo, setTipo] = useState('')
  const [lineups, setLineups] = useState(null)

  useEffect(() => {
    setLineups(null)
    const params = new URLSearchParams({ map: mapa })
    if (tipo) params.set('tipo', tipo)
    fetch(`/api/lineups?${params}`)
      .then((res) => res.json())
      .then(setLineups)
      .catch(() => setLineups([]))
  }, [mapa, tipo])

  return (
    <div className="space-y-4">
      <h2 className="font-display text-2xl font-bold uppercase tracking-wide text-texto">Granadas</h2>
      <div className="flex flex-wrap gap-3">
        <select value={mapa} onChange={(e) => setMapa(e.target.value)} className="rounded border border-borda bg-superficie px-2 py-1 font-mono text-sm">
          {MAPAS.map((m) => <option key={m} value={m}>{nomeMapa(m)}</option>)}
        </select>
        <div className="flex overflow-hidden rounded border border-borda font-mono text-xs uppercase">
          {TIPOS.map(([v, label]) => (
            <button
              key={v || 'todas'}
              onClick={() => setTipo(v)}
              className={`px-3 py-1.5 transition-colors ${tipo === v ? 'bg-destaque text-fundo' : 'bg-superficie text-texto-fraco hover:text-texto'}`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>
      {!lineups && <p className="font-mono text-sm text-texto-fraco">Carregando…</p>}
      {lineups && lineups.length === 0 && <p className="font-mono text-sm text-texto-fraco">Nenhuma granada registrada pra esse filtro ainda.</p>}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {lineups?.map((l) => (
          <div key={l.id} className="panel-cut border border-borda bg-superficie p-3">
            <p className="font-display text-sm font-semibold uppercase text-texto">{l.tipo}</p>
            <p className="font-mono text-xs text-texto-fraco">{l.throwerNick || l.throwerSteamId}</p>
            <span className={`mt-1 inline-block panel-cut-sm px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wide ${l.origem === 'pro' ? 'border border-destaque/40 bg-destaque/10 text-destaque' : 'border border-borda text-texto-fraco'}`}>
              {l.origem === 'pro' ? 'Pro' : 'Grupo'}
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}
