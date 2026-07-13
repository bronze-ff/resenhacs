import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import ExplorarMapas, { MAPAS_POOL } from '../components/granadas/ExplorarMapas.jsx'

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

  return (
    <div className="font-mono text-sm text-texto-fraco">
      Mapa selecionado: {mapa} (página do mapa chega na próxima task)
    </div>
  )
}
