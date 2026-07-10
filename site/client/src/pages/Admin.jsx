import { useState } from 'react'

export default function Admin() {
  const [steamId, setSteamId] = useState('')
  const [mensagem, setMensagem] = useState(null)

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
          className="panel-cut-sm border border-destaque bg-destaque px-4 py-2 font-display text-sm font-semibold uppercase tracking-wide text-fundo"
        >
          Adicionar à whitelist
        </button>
      </form>
      {mensagem && <p className="mt-3 font-mono text-sm text-texto-fraco">{mensagem}</p>}
    </div>
  )
}
