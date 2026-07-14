import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import ExplorarMapas, { MAPAS_POOL } from '../components/granadas/ExplorarMapas.jsx'
import PaginaMapaTaticas from '../components/taticas/PaginaMapaTaticas.jsx'

// Orquestrador mapa-first (mesmo padrão de Granadas.jsx): sem ?map= mostra a
// landing por mapa, com ?map= válido mostra a página do mapa (sidebar de
// filtros + grid de cards com mini-radar, estilo csnades — ver
// docs/superpowers/plans/2026-07-14-taticas-csnades.md, Task T2).
export default function Taticas() {
  const [searchParams, setSearchParams] = useSearchParams()
  const mapa = searchParams.get('map')
  const [contagens, setContagens] = useState(null)

  useEffect(() => {
    fetch('/api/taticas-curadas/contagem')
      .then((r) => r.json())
      // Adapta [{map, total}] pro shape [{map, tipo, total}] que ExplorarMapas já
      // sabe agrupar (reusa a mesma lógica de "vazio"/dimming sem duplicar).
      .then((rows) => setContagens(rows.map((r) => ({ map: r.map, tipo: 'taticas', total: r.total }))))
      .catch(() => setContagens([]))
  }, [])

  if (!mapa || !MAPAS_POOL.includes(mapa)) {
    return (
      <ExplorarMapas
        contagens={contagens}
        onEscolher={(m) => setSearchParams({ map: m })}
        subtitulo="Escolha um mapa pra ver o playbook curado do grupo."
        badges={(m) => {
          const total = contagens?.find((c) => c.map === m)?.total ?? 0
          return (
            <span className="panel-cut-sm border border-destaque/40 bg-fundo/80 px-1.5 py-0.5 font-mono text-[10px] uppercase text-destaque">
              {total} {total === 1 ? 'tática' : 'táticas'}
            </span>
          )
        }}
      />
    )
  }

  return <PaginaMapaTaticas mapa={mapa} onTrocarMapa={(m) => setSearchParams({ map: m })} />
}
