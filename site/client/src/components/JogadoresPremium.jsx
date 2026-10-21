import { useEffect, useMemo, useState } from 'react'
import { Avatar, Card, EstadoErro, EstadoVazio, Input, PremiumBadge, SectionHeader, SkeletonLista } from './ui'

// Admin: marca quem é Premium (apoia o site). Premium ganha a badge no nick e pode pedir
// clipe real da DEMO-SLAP, que gasta crédito pago (site/server/src/routes/players.js).
export default function JogadoresPremium() {
  const [jogadores, setJogadores] = useState(null)
  const [erro, setErro] = useState(false)
  const [busca, setBusca] = useState('')
  const [salvando, setSalvando] = useState(null)
  const [erroSalvar, setErroSalvar] = useState(null)

  useEffect(() => {
    fetch('/api/players/premium')
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then(setJogadores)
      .catch(() => setErro(true))
  }, [])

  const visiveis = useMemo(() => {
    const termo = busca.trim().toLowerCase()
    return (jogadores ?? []).filter((p) => !termo || (p.nick ?? '').toLowerCase().includes(termo) || p.steamId.includes(termo))
  }, [jogadores, busca])

  async function alternar(p) {
    setSalvando(p.steamId)
    setErroSalvar(null)
    try {
      const r = await fetch(`/api/players/${p.steamId}/premium`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ premium: !p.premium }),
      })
      if (!r.ok) throw new Error()
      setJogadores((atual) => atual.map((j) => (j.steamId === p.steamId ? { ...j, premium: !p.premium } : j)))
    } catch {
      setErroSalvar(`Não foi possível salvar ${p.nick || p.steamId}. Tente de novo.`)
    } finally {
      setSalvando(null)
    }
  }

  const total = (jogadores ?? []).filter((p) => p.premium).length

  return (
    <section className="space-y-3">
      <SectionHeader titulo="Jogadores Premium" subtitulo="Badge no nick e clipe de vídeo (DEMO-SLAP)" />
      <Card className="space-y-3 p-4 sm:p-5">
        {erro && <EstadoErro mensagem="Não foi possível carregar os Jogadores." />}
        {!erro && jogadores === null && <SkeletonLista linhas={4} altura="h-10" rotulo="Carregando Jogadores" />}
        {!erro && jogadores?.length === 0 && <EstadoVazio titulo="Nenhum Jogador cadastrado." />}
        {!erro && jogadores?.length > 0 && (
          <>
            <div className="flex flex-wrap items-end justify-between gap-3">
              <Input
                id="busca-premium"
                rotulo="Buscar Jogador"
                value={busca}
                onChange={(e) => setBusca(e.target.value)}
                placeholder="Nick ou SteamID64"
                className="max-w-xs"
              />
              <p className="text-sm text-texto-fraco"><span className="tabular-nums text-texto">{total}</span> Premium</p>
            </div>
            <ul className="divide-y divide-borda border border-borda" aria-label="Jogadores">
              {visiveis.map((p) => (
                <li key={p.steamId} className="flex items-center justify-between gap-3 px-3 py-2">
                  <span className="flex min-w-0 items-center gap-2">
                    <Avatar p={p} size={24} />
                    <span className="truncate text-sm text-texto">{p.nick || p.steamId}</span>
                    {p.premium && <PremiumBadge />}
                  </span>
                  <label className="flex shrink-0 cursor-pointer items-center gap-2 text-sm text-texto-fraco">
                    <input
                      type="checkbox"
                      checked={p.premium}
                      disabled={salvando === p.steamId}
                      onChange={() => alternar(p)}
                      aria-label={`Premium: ${p.nick || p.steamId}`}
                      className="h-4 w-4 accent-[color:var(--color-destaque)]"
                    />
                    Premium
                  </label>
                </li>
              ))}
            </ul>
            {erroSalvar && <p role="alert" className="text-sm text-perigo">{erroSalvar}</p>}
          </>
        )}
      </Card>
    </section>
  )
}
