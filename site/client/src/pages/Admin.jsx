import { useEffect, useState } from 'react'

export default function Admin() {
  const [steamId, setSteamId] = useState('')
  const [mensagem, setMensagem] = useState(null)
  const [taticasPendentes, setTaticasPendentes] = useState(null)

  async function adicionar(e) {
    e.preventDefault()
    const res = await fetch('/api/players', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ steamId }),
    })
    if (res.ok) {
      setMensagem('Jogador adicionado à whitelist.')
      setSteamId('')
    } else {
      const body = await res.json().catch(() => ({}))
      setMensagem(body.erro ?? 'Erro ao adicionar.')
    }
  }

  useEffect(() => {
    fetch('/api/taticas?status=sugerida')
      .then((r) => r.json())
      .then(setTaticasPendentes)
      .catch(() => setTaticasPendentes([]))
  }, [])

  async function revisar(id, status) {
    const res = await fetch(`/api/taticas/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status }),
    })
    if (res.ok) {
      setTaticasPendentes((atual) => atual.filter((t) => t.id !== id))
    }
  }

  return (
    <div className="max-w-md">
      <h2 className="mb-4 font-display text-xl font-semibold uppercase tracking-wide text-texto">Admin</h2>
      <form onSubmit={adicionar} className="space-y-3">
        <label className="block font-mono text-xs uppercase tracking-wide text-texto-fraco" htmlFor="steamId">
          SteamID64 do novo Jogador (17 dígitos)
        </label>
        <input
          id="steamId"
          value={steamId}
          onChange={(e) => setSteamId(e.target.value)}
          className="w-full rounded border border-borda bg-superficie px-3 py-2 font-mono text-sm"
          placeholder="76561198…"
        />
        <button
          type="submit"
          className="panel-cut-sm min-h-10 w-full border border-destaque bg-destaque px-4 py-2 font-display text-sm font-semibold uppercase tracking-wide text-fundo lg:min-h-0 lg:w-auto"
        >
          Adicionar à whitelist
        </button>
      </form>
      {mensagem && <p className="mt-3 font-mono text-sm text-texto-fraco">{mensagem}</p>}

      <div className="mt-8 space-y-3">
        <h2 className="font-display text-xl font-semibold uppercase tracking-wide text-texto">
          Táticas pendentes
        </h2>
        {taticasPendentes?.length === 0 && (
          <p className="font-mono text-sm text-texto-fraco">Nenhuma tática aguardando revisão.</p>
        )}
        {taticasPendentes?.map((t) => (
          <div key={t.id} className="panel-cut-sm space-y-2 border border-borda bg-superficie px-3 py-2">
            <p className="font-display text-sm font-semibold uppercase text-texto">{t.nome}</p>
            <p className="font-mono text-xs text-texto-fraco">{t.descricao}</p>
            <p className="font-mono text-[10px] uppercase text-texto-fraco/70">sugerida por {t.criadoPorNick || t.criadoPor}</p>
            <div className="flex flex-wrap gap-2">
              <button
                onClick={() => revisar(t.id, 'aprovada')}
                className="panel-cut-sm min-h-10 border border-sucesso px-3 py-1 font-mono text-xs uppercase tracking-wide text-sucesso lg:min-h-0"
              >
                Aprovar
              </button>
              <button
                onClick={() => revisar(t.id, 'rejeitada')}
                className="panel-cut-sm min-h-10 border border-perigo px-3 py-1 font-mono text-xs uppercase tracking-wide text-perigo lg:min-h-0"
              >
                Rejeitar
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
