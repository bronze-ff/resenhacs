import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import ExplorarMapas, { MAPAS_POOL } from '../components/granadas/ExplorarMapas.jsx'
import PaginaMapa from '../components/granadas/PaginaMapa.jsx'

export default function Granadas() {
  const [searchParams, setSearchParams] = useSearchParams()
  const mapa = searchParams.get('map')
  const [contagens, setContagens] = useState(null)

  useEffect(() => {
    fetch('/api/granadas/contagem')
      .then((r) => r.json())
      .then(setContagens)
      .catch(() => setContagens([]))
  }, [])

  if (!mapa || !MAPAS_POOL.includes(mapa)) {
    return <ExplorarMapas contagens={contagens} onEscolher={(m) => setSearchParams({ map: m })} />
  }

  return <PaginaMapa mapa={mapa} onTrocarMapa={(m) => setSearchParams({ map: m })} />
}
