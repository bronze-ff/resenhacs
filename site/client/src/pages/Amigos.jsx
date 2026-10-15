import { useEffect, useState, useCallback } from 'react'
import { Link } from 'react-router-dom'
import { Avatar, Badge, Button, CabecalhoPagina, Card, EstadoErro, EstadoVazio, Input } from '../components/ui'

function LinhaJogador({ j, ban, acao }) {
  return (
    <Card className="flex items-center gap-3 p-3">
      <Avatar p={j} size={36} />
      <Link to={`/jogador/${j.steamId}`} className="min-w-0 flex-1 truncate font-display text-base font-semibold text-texto hover:text-destaque">
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

  return (
    <div className="space-y-6">
      <CabecalhoPagina
        eyebrow="Social"
        titulo="Amigos"
        descricao="Adicione amigos pelo SteamID e acompanhe pedidos."
        acoes={<span className="font-mono text-xs text-texto-fraco">{dados.amigos.length} amigo(s)</span>}
        className="!mb-0"
      />

      <Card className="p-4">
        <h3 className="rotulo mb-3">Adicionar amigo</h3>
        <form onSubmit={pedir} className="flex gap-2">
          <Input
            value={novo}
            onChange={(e) => setNovo(e.target.value)}
            placeholder="SteamID64 ou link do perfil"
            aria-label="SteamID64 ou link do perfil"
            className="flex-1 font-mono"
          />
          <Button type="submit" variante="primario" disabled={!novo.trim()}>Pedir</Button>
        </form>
        {erro && <EstadoErro mensagem={erro} className="mt-3" />}
      </Card>

      {dados.recebidos.length > 0 && (
        <section className="space-y-2">
          <h3 className="rotulo">Pedidos recebidos</h3>
          {dados.recebidos.map((j) => (
            <LinhaJogador key={j.steamId} j={j} ban={bans?.get(j.steamId)} acao={
              <span className="flex gap-2">
                <Button variante="primario" tamanho="sm" onClick={() => aceitar(j.steamId)}>Aceitar</Button>
                <Button variante="fantasma" tamanho="sm" onClick={() => remover(j.steamId)}>Recusar</Button>
              </span>
            } />
          ))}
        </section>
      )}

      {dados.enviados.length > 0 && (
        <section className="space-y-2">
          <h3 className="rotulo">Pedidos enviados</h3>
          {dados.enviados.map((j) => (
            <LinhaJogador key={j.steamId} j={j} ban={bans?.get(j.steamId)} acao={
              <Button variante="fantasma" tamanho="sm" onClick={() => remover(j.steamId)}>Cancelar</Button>
            } />
          ))}
        </section>
      )}

      <section className="space-y-2">
        <h3 className="rotulo">Amigos</h3>
        {dados.amigos.length === 0
          ? <EstadoVazio titulo="Nenhum amigo ainda" descricao="Você ainda não tem amigos. Adicione pelo SteamID acima." />
          : dados.amigos.map((j) => (
            <LinhaJogador key={j.steamId} j={j} ban={bans?.get(j.steamId)} acao={
              <Button variante="perigo" tamanho="sm" onClick={() => remover(j.steamId)}>Remover</Button>
            } />
          ))}
      </section>
    </div>
  )
}
