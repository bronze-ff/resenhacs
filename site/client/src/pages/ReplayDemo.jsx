import { useEffect, useState } from 'react'
import ReplayViewer from '../components/ReplayViewer.jsx'
import { CabecalhoPagina, Skeleton } from '../components/ui'

// Rota pública só para mostrar a engine de Replay 2D com dados sintéticos,
// sem precisar de login nem de demo real. Aperte Play.
export default function ReplayDemo() {
  const [replay, setReplay] = useState(null)

  useEffect(() => {
    fetch('/demo-replay.json')
      .then((res) => res.json())
      .then(setReplay)
      .catch(() => setReplay(null))
  }, [])

  return (
    <div className="mx-auto max-w-2xl p-6">
      <CabecalhoPagina
        eyebrow="Demonstração"
        titulo="Replay 2D — partida real"
        descricao="Posições reais de uma partida de vocês (de_anubis, 1º round), extraídas da Demo pelo Coletor."
      />
      {replay ? (
        <ReplayViewer replay={replay} />
      ) : (
        <div role="status" aria-label="Carregando replay" className="space-y-3">
          <Skeleton className="h-10 w-full" />
          <Skeleton className="aspect-square w-full" />
        </div>
      )}
    </div>
  )
}
