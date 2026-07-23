import { useEffect, useState, useCallback } from 'react'
import { Link } from 'react-router-dom'
import { Card, SectionHeader, Badge } from '../components/ui'

function LinhaJogador({ j, ban, acao }) {
  return (
    <Card className="flex items-center gap-3 p-3">
      {j.avatarUrl && <img src={j.avatarUrl} alt="" className="panel-cut-sm h-8 w-8 shrink-0 border border-borda object-cover" />}
      <Link to={`/jogador/${j.steamId}`} className="min-w-0 flex-1 truncate font-mono text-sm text-texto hover:text-destaque">
        {j.nick || j.steamId}
      </Link>
      {ban?.vacBanned && <Badge tom="perigo" title={`VAC ban — ${ban.numVacBans} conta(s)`}>VAC ban</Badge>}
      {!ban?.vacBanned && ban?.gameBanned && <Badge tom="perigo" title={`Game ban — ${ban.numGameBans}`}>Game ban</Badge>}
      {acao}
    </Card>
  )
}

export default function Amigos() {
  const [dados, setDados] = useState({ amigos: [], recebidos: [], enviados: [] })
  const [bans, setBans] = useState(null) // Map steamId -> ban info; null = ainda não carregou/indisponível
  const [novo, setNovo] = useState('')
  const [erro, setErro] = useState(null)

  const recarregar = useCallback(() => {
    fetch('/api/amigos')
      .then((r) => (r.ok ? r.json() : { amigos: [], recebidos: [], enviados: [] }))
      .then(setDados)
      .catch(() => setDados({ amigos: [], recebidos: [], enviados: [] }))
  }, [])

  useEffect(() => {
    recarregar()
    // Alerta de ban/smurf: cruza amigos + eu com GetPlayerBans da Steam. Se não tiver
    // STEAM_API_KEY configurada o endpoint devolve 503 — degrada silenciosamente
    // (sem tag de ban), não quebra a tela.
    fetch('/api/players/bans')
      .then((r) => (r.ok ? r.json() : []))
      .then((rows) => setBans(new Map(rows.map((r) => [r.steamId, r.ban]))))
      .catch(() => setBans(new Map()))
  }, [recarregar])

  async function pedir(e) {
    e.preventDefault()
    setErro(null)
    const res = await fetch('/api/amigos', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ steamId: novo.trim().split('/').filter(Boolean).pop() }),
    })
    if (!res.ok) return setErro((await res.json().catch(() => ({}))).erro ?? 'Erro ao adicionar')
    setNovo('')
    recarregar()
  }
  const aceitar = async (steamId) => { await fetch(`/api/amigos/${steamId}/aceitar`, { method: 'POST' }); recarregar() }
  const remover = async (steamId) => { await fetch(`/api/amigos/${steamId}`, { method: 'DELETE' }); recarregar() }

  const btn = 'panel-cut-sm shrink-0 border px-2 py-1 font-mono text-[11px] uppercase tracking-wide'

  return (
    <div className="space-y-6">
      <SectionHeader titulo="Amigos" acao={<span className="font-mono text-xs text-texto-fraco">{dados.amigos.length} amigo(s)</span>} />

      <Card className="p-4">
        <h3 className="mb-3 font-display text-sm font-semibold uppercase tracking-wide text-texto">Adicionar amigo</h3>
        <form onSubmit={pedir} className="flex gap-2">
          <input
            value={novo}
            onChange={(e) => setNovo(e.target.value)}
            placeholder="SteamID64 ou link do perfil"
            className="panel-cut-sm min-h-10 flex-1 border border-borda bg-superficie px-3 py-2 font-mono text-sm"
          />
          <button type="submit" disabled={!novo.trim()} className={`${btn} border-destaque bg-destaque text-fundo disabled:opacity-40`}>Pedir</button>
        </form>
        {erro && <p className="mt-2 font-mono text-sm text-perigo">{erro}</p>}
      </Card>

      {dados.recebidos.length > 0 && (
        <section className="space-y-2">
          <h3 className="font-display text-sm font-semibold uppercase tracking-wide text-texto-fraco">Pedidos recebidos</h3>
          {dados.recebidos.map((j) => (
            <LinhaJogador key={j.steamId} j={j} ban={bans?.get(j.steamId)} acao={
              <span className="flex gap-1">
                <button onClick={() => aceitar(j.steamId)} className={`${btn} border-sucesso text-sucesso`}>Aceitar</button>
                <button onClick={() => remover(j.steamId)} className={`${btn} border-borda text-texto-fraco`}>Recusar</button>
              </span>
            } />
          ))}
        </section>
      )}

      {dados.enviados.length > 0 && (
        <section className="space-y-2">
          <h3 className="font-display text-sm font-semibold uppercase tracking-wide text-texto-fraco">Pedidos enviados</h3>
          {dados.enviados.map((j) => (
            <LinhaJogador key={j.steamId} j={j} ban={bans?.get(j.steamId)} acao={
              <button onClick={() => remover(j.steamId)} className={`${btn} border-borda text-texto-fraco`}>Cancelar</button>
            } />
          ))}
        </section>
      )}

      <section className="space-y-2">
        <h3 className="font-display text-sm font-semibold uppercase tracking-wide text-texto-fraco">Amigos</h3>
        {dados.amigos.length === 0
          ? <p className="font-mono text-sm text-texto-fraco">Você ainda não tem amigos. Adicione pelo SteamID acima.</p>
          : dados.amigos.map((j) => (
            <LinhaJogador key={j.steamId} j={j} ban={bans?.get(j.steamId)} acao={
              <button onClick={() => remover(j.steamId)} className={`${btn} border-borda text-texto-fraco hover:border-perigo hover:text-perigo`}>Remover</button>
            } />
          ))}
      </section>
    </div>
  )
}
