import { useEffect, useState } from 'react'

const CORES_STATUS = {
  pendente: 'text-texto-fraco', baixando: 'text-destaque', processando: 'text-destaque',
  concluida: 'text-sucesso', falhou: 'text-perigo',
}

export default function PartidasPro() {
  const [fila, setFila] = useState(null)
  const [url, setUrl] = useState('')
  const [erro, setErro] = useState(null)

  function carregar() {
    fetch('/api/partidas-pro-fila').then((r) => r.json()).then(setFila).catch(() => setFila([]))
  }

  useEffect(carregar, [])

  async function adicionar(e) {
    e.preventDefault()
    setErro(null)
    const res = await fetch('/api/partidas-pro-fila', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ hltvUrl: url }),
    })
    if (res.ok) {
      setUrl('')
      carregar()
    } else {
      const body = await res.json().catch(() => ({}))
      setErro(body.erro ?? 'Erro ao adicionar.')
    }
  }

  return (
    <div className="space-y-4">
      <h2 className="font-display text-2xl font-bold uppercase tracking-wide text-texto">Partidas pro</h2>
      <form onSubmit={adicionar} className="flex gap-2">
        <input
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="Link do demo no HLTV"
          className="flex-1 rounded border border-borda bg-superficie px-3 py-2 font-mono text-sm"
        />
        <button type="submit" className="panel-cut-sm border border-destaque bg-destaque px-4 py-2 font-display text-sm font-semibold uppercase text-fundo">
          Adicionar
        </button>
      </form>
      {erro && <p className="font-mono text-sm text-perigo">{erro}</p>}
      <div className="space-y-2">
        {fila?.map((f) => (
          <div key={f.id} className="panel-cut-sm flex items-center justify-between border border-borda bg-superficie px-3 py-2">
            <span className="truncate font-mono text-xs text-texto-fraco">{f.hltvUrl}</span>
            <span className={`font-mono text-xs uppercase ${CORES_STATUS[f.status]}`}>{f.status}</span>
          </div>
        ))}
      </div>
    </div>
  )
}
