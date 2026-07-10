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
      <h2 className="mb-4 text-xl font-semibold">Jogadores</h2>
      <ul className="space-y-2">
        {jogadores.map((j) => (
          <li key={j.steamId}>
            <Link
              to={`/jogador/${j.steamId}`}
              className="flex items-center gap-3 rounded-lg border border-borda bg-superficie p-3 transition hover:border-destaque/60"
            >
              {j.avatarUrl && <img src={j.avatarUrl} alt="" className="h-8 w-8 rounded-full" />}
              <span>{j.nick || j.steamId}</span>
              {j.isAdmin && <span className="text-xs text-destaque">admin</span>}
            </Link>
          </li>
        ))}
      </ul>
    </div>
  )
}
