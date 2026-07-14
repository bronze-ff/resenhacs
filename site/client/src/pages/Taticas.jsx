import { useEffect, useState } from 'react'
import { nomeMapa } from '../lib/format.js'
import ReplayViewer from '../components/ReplayViewer.jsx'

const MAPAS = ['de_mirage', 'de_dust2', 'de_inferno', 'de_nuke', 'de_overpass', 'de_vertigo', 'de_ancient', 'de_anubis', 'de_train']

function TaticaCard({ t }) {
  const [aberta, setAberta] = useState(false)
  const [replay, setReplay] = useState(null)

  function abrir() {
    setAberta((v) => !v)
    if (!replay) {
      fetch(`/api/matches/${t.matchId}/replay`).then((r) => r.json()).then(setReplay).catch(() => {})
    }
  }

  return (
    <div className="panel-cut border border-borda bg-superficie p-3">
      <button onClick={abrir} className="w-full text-left">
        <p className="font-display text-sm font-semibold uppercase text-texto">{t.nome}</p>
        <p className="font-mono text-xs text-texto-fraco">{t.descricao}</p>
        <p className="mt-1 font-mono text-[10px] uppercase text-texto-fraco/70">sugerida por {t.criadoPorNick || t.criadoPor}</p>
      </button>
      {aberta && replay && (
        <div className="mt-3">
          <ReplayViewer replay={replay} seek={{ round: t.roundNumber, frame: 0, key: `${t.id}-${Date.now()}` }} />
        </div>
      )}
    </div>
  )
}

export default function Taticas() {
  const [mapa, setMapa] = useState(MAPAS[0])
  const [taticas, setTaticas] = useState(null)

  useEffect(() => {
    setTaticas(null)
    fetch(`/api/taticas?map=${mapa}`).then((r) => r.json()).then(setTaticas).catch(() => setTaticas([]))
  }, [mapa])

  return (
    <div className="space-y-4">
      <h2 className="font-display text-2xl font-bold uppercase tracking-wide text-texto">Táticas</h2>
      <select value={mapa} onChange={(e) => setMapa(e.target.value)} className="min-h-10 rounded border border-borda bg-superficie px-2 py-1 font-mono text-sm lg:min-h-0">
        {MAPAS.map((m) => <option key={m} value={m}>{nomeMapa(m)}</option>)}
      </select>
      {!taticas && <p className="font-mono text-sm text-texto-fraco">Carregando…</p>}
      {taticas && taticas.length === 0 && <p className="font-mono text-sm text-texto-fraco">Nenhuma tática aprovada nesse mapa ainda.</p>}
      <div className="grid gap-3 sm:grid-cols-2">
        {taticas?.map((t) => <TaticaCard key={t.id} t={t} />)}
      </div>
    </div>
  )
}
