import { useState } from 'react'

export default function Perfil() {
  const [matchAuthCode, setMatchAuthCode] = useState('')
  const [lastShareCode, setLastShareCode] = useState('')
  const [mensagem, setMensagem] = useState(null)

  async function salvar(e) {
    e.preventDefault()
    const res = await fetch('/api/players/me', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ matchAuthCode, lastShareCode }),
    })
    const body = await res.json().catch(() => ({}))
    setMensagem(res.ok ? 'Códigos salvos. O Coletor vai buscar suas Partidas.' : (body.erro ?? 'Erro ao salvar.'))
  }

  return (
    <div className="max-w-lg">
      <h2 className="mb-2 font-display text-xl font-semibold uppercase tracking-wide text-texto">Meu perfil</h2>
      <p className="mb-4 font-mono text-sm leading-relaxed text-texto-fraco">
        Para o Resenha achar suas Partidas de matchmaking, cole seu código de autenticação de
        histórico e o último share code. Pegue os dois em{' '}
        <a
          className="text-destaque underline"
          href="https://help.steampowered.com/en/wizard/HelpWithGameIssue/?appid=730&issueid=128"
          target="_blank"
          rel="noreferrer"
        >
          Steam → Ajuda → Compartilhar histórico de partidas
        </a>
        .
      </p>
      <form onSubmit={salvar} className="space-y-3">
        <div>
          <label className="block font-mono text-xs uppercase tracking-wide text-texto-fraco" htmlFor="authCode">
            Código de autenticação de histórico
          </label>
          <input
            id="authCode"
            value={matchAuthCode}
            onChange={(e) => setMatchAuthCode(e.target.value)}
            className="w-full rounded border border-borda bg-superficie px-3 py-2 font-mono text-sm"
            placeholder="XXXX-XXXXX-XXXX"
          />
        </div>
        <div>
          <label className="block font-mono text-xs uppercase tracking-wide text-texto-fraco" htmlFor="shareCode">
            Último share code
          </label>
          <input
            id="shareCode"
            value={lastShareCode}
            onChange={(e) => setLastShareCode(e.target.value)}
            className="w-full rounded border border-borda bg-superficie px-3 py-2 font-mono text-sm"
            placeholder="CSGO-xxxxx-xxxxx-xxxxx-xxxxx-xxxxx"
          />
        </div>
        <button
          type="submit"
          className="panel-cut-sm border border-destaque bg-destaque px-4 py-2 font-display text-sm font-semibold uppercase tracking-wide text-fundo"
        >
          Salvar
        </button>
      </form>
      {mensagem && <p className="mt-3 font-mono text-sm text-texto-fraco">{mensagem}</p>}
    </div>
  )
}
