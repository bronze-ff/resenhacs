import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import ExplorarMapas, { MAPAS_POOL } from '../components/granadas/ExplorarMapas.jsx'
import PaginaMapa from '../components/granadas/PaginaMapa.jsx'
import PaginaMapaAuto from '../components/granadas/PaginaMapaAuto.jsx'
import { Abas } from '../components/ui'

// Dois modos por mapa: "Automático" (padrão — lineups agrupados das Demos, sem
// cadastro) e "Curadas" (biblioteca manual com vídeo, mantida pelo admin).
export default function Granadas() {
  const [searchParams, setSearchParams] = useSearchParams()
  const mapa = searchParams.get('map')
  const modo = searchParams.get('modo') === 'curadas' ? 'curadas' : 'auto'
  const [contagens, setContagens] = useState(null)

  useEffect(() => {
    fetch('/api/granadas/contagem')
      .then((r) => r.json())
      .then(setContagens)
      .catch(() => setContagens([]))
  }, [])

  function ir(m, novoModo = modo) {
    setSearchParams(novoModo === 'curadas' ? { map: m, modo: 'curadas' } : { map: m })
  }

  if (!mapa || !MAPAS_POOL.includes(mapa)) {
    return (
      <ExplorarMapas
        eyebrow="Granadas"
        contagens={modo === 'curadas' ? contagens : null}
        subtitulo="Escolha um mapa pra ver os lineups que o grupo e os pros usam de verdade."
        onEscolher={(m) => ir(m)}
      />
    )
  }

  const seletorModo = (
    <div className="flex flex-col gap-1.5">
      <p className="rotulo">Biblioteca</p>
      <Abas
        rotulo="Biblioteca de granadas"
        larguraTotal
        valor={modo}
        onChange={(v) => ir(mapa, v)}
        itens={[{ valor: 'auto', rotulo: 'Automático' }, { valor: 'curadas', rotulo: 'Curadas' }]}
      />
    </div>
  )

  if (modo === 'curadas') {
    return <PaginaMapa mapa={mapa} onTrocarMapa={(m) => ir(m)} seletorModo={seletorModo} />
  }
  return <PaginaMapaAuto mapa={mapa} onTrocarMapa={(m) => ir(m)} seletorModo={seletorModo} />
}
