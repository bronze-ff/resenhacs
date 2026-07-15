import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../auth/AuthContext.jsx'
import { Card, SectionHeader, Badge } from '../components/ui'

function FormTime({ jogadoresDoGrupo, onCriado }) {
  const [nome, setNome] = useState('')
  const [selecionados, setSelecionados] = useState([])
  const [erro, setErro] = useState(null)
  const [enviando, setEnviando] = useState(false)

  function alternar(steamId) {
    setSelecionados((s) => (s.includes(steamId) ? s.filter((x) => x !== steamId) : [...s, steamId]))
  }

  async function criar(e) {
    e.preventDefault()
    setEnviando(true)
    setErro(null)
    const res = await fetch('/api/teams', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ nome, membros: selecionados }),
    })
    const body = await res.json().catch(() => ({}))
    setEnviando(false)
    if (!res.ok) return setErro(body.erro ?? 'Erro ao criar time')
    setNome('')
    setSelecionados([])
    onCriado()
  }

  return (
    <Card className="p-4 sm:p-5">
      <h3 className="mb-3 font-display text-sm font-semibold uppercase tracking-wide text-texto">Novo time</h3>
      <form onSubmit={criar} className="space-y-3">
        <input
          value={nome}
          onChange={(e) => setNome(e.target.value)}
          placeholder="Nome do time"
          className="panel-cut-sm min-h-10 w-full border border-borda bg-superficie px-3 py-2 font-mono text-sm lg:min-h-0"
        />
        <div className="flex flex-wrap gap-2">
          {jogadoresDoGrupo.map((j) => (
            <button
              type="button"
              key={j.steamId}
              onClick={() => alternar(j.steamId)}
              className={`panel-cut-sm flex min-h-10 items-center border px-2.5 py-1 font-mono text-xs lg:min-h-0 ${
                selecionados.includes(j.steamId) ? 'border-destaque bg-destaque/10 text-destaque' : 'border-borda text-texto-fraco'
              }`}
            >
              {j.nick || j.steamId}
            </button>
          ))}
        </div>
        <button
          type="submit"
          disabled={!nome.trim() || selecionados.length === 0 || enviando}
          className="panel-cut-sm min-h-10 border border-destaque bg-destaque px-4 py-2 font-display text-sm font-semibold uppercase tracking-wide text-fundo disabled:opacity-40"
        >
          Criar time
        </button>
        {erro && <p className="font-mono text-sm text-perigo">{erro}</p>}
      </form>
    </Card>
  )
}

function CardTime({ time, isAdmin, onMudou }) {
  async function alternarPublico() {
    await fetch(`/api/teams/${time.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ publico: !time.publico }),
    })
    onMudou()
  }

  async function apagar() {
    if (!confirm(`Apagar o time "${time.nome}"?`)) return
    await fetch(`/api/teams/${time.id}`, { method: 'DELETE' })
    onMudou()
  }

  return (
    <Card className="p-4 sm:p-5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <h3 className="truncate font-display text-base font-semibold uppercase tracking-wide text-texto">{time.nome}</h3>
          <p className="truncate font-mono text-xs text-texto-fraco">{time.membros.map((m) => m.nick || m.steamId).join(', ')}</p>
        </div>
        <Badge tom={time.publico ? 'sucesso' : 'neutro'} className="shrink-0">{time.publico ? 'Público' : 'Privado'}</Badge>
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        <Link
          to={`/times/comparar?a=${time.id}`}
          className="panel-cut-sm flex min-h-10 items-center border border-borda px-2.5 py-1 font-mono text-xs text-texto-fraco hover:border-destaque/60 hover:text-destaque lg:min-h-0"
        >
          Comparar
        </Link>
        {isAdmin && (
          <>
            <button onClick={alternarPublico} className="panel-cut-sm flex min-h-10 items-center border border-borda px-2.5 py-1 font-mono text-xs text-texto-fraco hover:border-destaque/60 hover:text-destaque lg:min-h-0">
              {time.publico ? 'Tornar privado' : 'Tornar público'}
            </button>
            <button onClick={apagar} className="panel-cut-sm flex min-h-10 items-center border border-borda px-2.5 py-1 font-mono text-xs text-texto-fraco hover:border-perigo/60 hover:text-perigo lg:min-h-0">
              Apagar
            </button>
          </>
        )}
      </div>
    </Card>
  )
}

export default function Times() {
  const { jogador } = useAuth()
  const [times, setTimes] = useState(null)
  const [jogadoresDoGrupo, setJogadoresDoGrupo] = useState([])

  function recarregar() {
    fetch('/api/teams').then((res) => (res.ok ? res.json() : [])).then(setTimes)
  }

  useEffect(() => {
    recarregar()
    fetch('/api/players').then((res) => (res.ok ? res.json() : [])).then(setJogadoresDoGrupo)
  }, [])

  if (times === null) return <p className="font-mono text-sm text-texto-fraco">Carregando…</p>

  return (
    <div className="space-y-6">
      <SectionHeader titulo="Times" />
      {times.length === 0 && <p className="font-mono text-sm text-texto-fraco">Nenhum time criado nesse grupo ainda.</p>}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        {times.map((t) => (
          <CardTime key={t.id} time={t} isAdmin={jogador?.souAdminDoGrupo} onMudou={recarregar} />
        ))}
      </div>
      {jogador?.souAdminDoGrupo && <FormTime jogadoresDoGrupo={jogadoresDoGrupo} onCriado={recarregar} />}
    </div>
  )
}
