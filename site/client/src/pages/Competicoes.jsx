// site/client/src/pages/Competicoes.jsx
import { useEffect, useState } from 'react'
import { SectionHeader } from '../components/ui'

export default function Competicoes() {
  const [dados, setDados] = useState(null)

  useEffect(() => {
    fetch('/api/competicoes')
      .then((res) => (res.ok ? res.json() : { ativa: null, encerradas: [] }))
      .then(setDados)
      .catch(() => setDados({ ativa: null, encerradas: [] }))
  }, [])

  if (dados === null) return <p className="font-mono text-sm text-texto-fraco">Carregando…</p>

  return (
    <div className="space-y-6">
      <SectionHeader titulo="Competições" />
      {!dados.ativa && dados.encerradas.length === 0 && (
        <p className="font-mono text-sm text-texto-fraco">Nenhuma competição no momento.</p>
      )}
      {dados.ativa && (
        <div className="panel-cut border border-borda bg-superficie p-4">
          <h2 className="font-display text-xl font-bold text-texto">{dados.ativa.nome}</h2>
          <p className="mt-1 font-mono text-sm text-destaque">{dados.ativa.premioDescricao}</p>
        </div>
      )}
    </div>
  )
}
