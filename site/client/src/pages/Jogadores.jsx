import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'

export default function Jogadores() {
  const [jogadores, setJogadores] = useState([])

  useEffect(() => {
    fetch('/api/players')
      .then((res) => (res.ok ? res.json() : []))
      .then(setJogadores)
      .catch(() => setJogadores([]))
  }, [])

  return (
    <div>
      <h2 className="mb-4 font-display text-xl font-semibold uppercase tracking-wide text-texto">Jogadores</h2>
      <ul className="space-y-2">
        {jogadores.map((j) => (
          <li key={j.steamId}>
            <Link
              to={`/jogador/${j.steamId}`}
              className="panel-cut flex items-center gap-3 border border-borda bg-superficie p-3 transition-colors hover:border-destaque/50 hover:bg-superficie-alta"
            >
              {j.avatarUrl && (
                <img src={j.avatarUrl} alt="" className="panel-cut-sm h-8 w-8 border border-borda object-cover" />
              )}
              <span className="font-mono text-sm text-texto">{j.nick || j.steamId}</span>
              {j.isAdmin && (
                <span className="font-mono text-[10px] uppercase tracking-widest text-destaque">admin</span>
              )}
            </Link>
          </li>
        ))}
      </ul>
    </div>
  )
}
