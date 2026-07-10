import { useEffect, useState } from 'react'
import ReplayViewer from '../components/ReplayViewer.jsx'

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
      <h1 className="mb-2 text-2xl font-bold text-destaque">Replay 2D — demo</h1>
      <p className="mb-4 text-sm text-texto-fraco">
        Dados sintéticos (10 bolinhas em de_mirage, 2 rounds) só para mostrar a engine.
        Coloque os PNGs de radar em <code>public/radars/</code> para o fundo real.
      </p>
      {replay ? <ReplayViewer replay={replay} /> : <p className="text-texto-fraco">Carregando…</p>}
    </div>
  )
}
