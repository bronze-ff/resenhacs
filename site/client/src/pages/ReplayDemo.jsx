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
      <h1 className="mb-2 font-display text-2xl font-bold uppercase tracking-wide text-destaque">
        Replay 2D — partida real
      </h1>
      <p className="mb-4 font-mono text-sm leading-relaxed text-texto-fraco">
        Posições reais de uma partida de vocês (de_anubis, 1º round), extraídas do demo
        pelo Coletor. Coloque <code>de_anubis.png</code> em <code>public/radars/</code> para
        o fundo do mapa aparecer alinhado.
      </p>
      {replay ? <ReplayViewer replay={replay} /> : <p className="font-mono text-sm text-texto-fraco">Carregando…</p>}
    </div>
  )
}
