import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Card, SectionHeader, Badge } from '../components/ui'

export default function Jogadores() {
  const [jogadores, setJogadores] = useState([])
  const [bans, setBans] = useState(null) // Map steamId -> ban info; null = ainda não carregou/indisponível

  useEffect(() => {
    fetch('/api/players')
      .then((res) => (res.ok ? res.json() : []))
      .then(setJogadores)
      .catch(() => setJogadores([]))
    // Alerta de ban/smurf: cruza o grupo com GetPlayerBans da Steam. Se não tiver
    // STEAM_API_KEY configurada o endpoint devolve 503 — degrada silenciosamente
    // (sem tag de ban), não quebra a tela.
    fetch('/api/players/bans')
      .then((res) => (res.ok ? res.json() : []))
      .then((rows) => setBans(new Map(rows.map((r) => [r.steamId, r.ban]))))
      .catch(() => setBans(new Map()))
  }, [])

  return (
    <div>
      <SectionHeader titulo="Jogadores" />
      <ul className="space-y-2">
        {jogadores.map((j) => {
          const ban = bans?.get(j.steamId)
          return (
          <li key={j.steamId}>
            <Card as={Link} interativo to={`/jogador/${j.steamId}`} className="flex items-center gap-3 p-3">
              {j.avatarUrl && (
                <img src={j.avatarUrl} alt="" className="panel-cut-sm h-8 w-8 shrink-0 border border-borda object-cover" />
              )}
              <span className="min-w-0 flex-1 truncate font-mono text-sm text-texto">{j.nick || j.steamId}</span>
              {j.isAdmin && (
                <span className="shrink-0 font-mono text-[10px] uppercase tracking-widest text-destaque">admin</span>
              )}
              {ban?.vacBanned && (
                <Badge tom="perigo" title={`VAC ban — ${ban.numVacBans} conta(s), há ${ban.daysSinceLastBan} dias`}>
                  VAC ban
                </Badge>
              )}
              {!ban?.vacBanned && ban?.gameBanned && (
                <Badge tom="perigo" title={`Game ban (Overwatch/cheat) — ${ban.numGameBans} ban(s)`}>
                  Game ban
                </Badge>
              )}
            </Card>
          </li>
          )
        })}
      </ul>
    </div>
  )
}
