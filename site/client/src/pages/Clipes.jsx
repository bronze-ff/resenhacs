// site/client/src/pages/Clipes.jsx
import { useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { SectionHeader, Select } from '../components/ui'
import { useAuth } from '../auth/AuthContext.jsx'
import CardClipe from '../components/CardClipe.jsx'

const PERIODOS = [
  { valor: 'semana', label: 'Semana' },
  { valor: 'mes', label: 'Mês' },
  { valor: 'sempre', label: 'Sempre' },
]

export default function Clipes() {
  const { jogador } = useAuth()
  const [periodo, setPeriodo] = useState('sempre')
  const [dados, setDados] = useState(null)
  const [clipeAberto, setClipeAberto] = useState(null)
  // Filtro por jogador espelhado na URL (?jogador=steamId) — o link "Ver todos" do
  // perfil chega aqui já filtrado, e trocar o filtro atualiza a URL (compartilhável).
  const [searchParams, setSearchParams] = useSearchParams()
  const jogadorFiltro = searchParams.get('jogador') ?? ''

  function setJogadorFiltro(valor) {
    const proximos = new URLSearchParams(searchParams)
    if (valor) proximos.set('jogador', valor)
    else proximos.delete('jogador')
    setSearchParams(proximos, { replace: true })
  }

  useEffect(() => {
    setDados(null)
    fetch(`/api/clipes?periodo=${periodo}`)
      .then((res) => (res.ok ? res.json() : { clipes: [] }))
      .then(setDados)
      .catch(() => setDados({ clipes: [] }))
  }, [periodo])

  // Opções do dropdown derivadas da lista carregada (a aba carrega tudo de uma vez, sem
  // paginação) — pares steamId/nick distintos, ordenados por nick.
  const opcoesJogador = useMemo(() => {
    if (!dados) return []
    const vistos = new Map()
    for (const c of dados.clipes) if (!vistos.has(c.steamId)) vistos.set(c.steamId, c.nick)
    return [...vistos.entries()]
      .map(([steamId, nick]) => ({ valor: steamId, label: nick }))
      .sort((a, b) => a.label.localeCompare(b.label))
  }, [dados])

  const clipesFiltrados =
    dados === null ? null : jogadorFiltro ? dados.clipes.filter((c) => c.steamId === jogadorFiltro) : dados.clipes

  return (
    <div className="space-y-6">
      <SectionHeader
        titulo="Clipes"
        className="flex-wrap"
        acao={
          <div className="flex flex-wrap items-center gap-2">
            <Select value={jogadorFiltro} onChange={(e) => setJogadorFiltro(e.target.value)} className="w-auto" selectClassName="py-1.5 text-xs">
              <option value="">Todos</option>
              {opcoesJogador.map((o) => (
                <option key={o.valor} value={o.valor}>{o.label}</option>
              ))}
            </Select>
            {PERIODOS.map((p) => (
              <button
                key={p.valor}
                onClick={() => setPeriodo(p.valor)}
                className={`panel-cut-sm min-h-10 border px-3 py-1.5 font-mono text-xs uppercase tracking-wide lg:min-h-0 ${
                  periodo === p.valor ? 'border-destaque bg-destaque/10 text-destaque' : 'border-borda text-texto-fraco'
                }`}
              >
                {p.label}
              </button>
            ))}
          </div>
        }
      />
      <p className="font-mono text-xs text-texto-fraco">
        Pontuação: kills (curva não-linear) + headshots + clutch + variedade de armas — passe o mouse no número pra ver o cálculo.
      </p>

      {clipesFiltrados === null ? (
        <p className="font-mono text-sm text-texto-fraco">Carregando…</p>
      ) : clipesFiltrados.length === 0 ? (
        <p className="font-mono text-sm text-texto-fraco">
          {jogadorFiltro ? 'Nenhum clipe desse jogador nesse período.' : 'Nenhum clipe nesse período ainda.'}
        </p>
      ) : (
        <section className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {clipesFiltrados.map((c) => (
            <CardClipe key={c.id} clipe={c} aberto={clipeAberto === c.id} onAbrir={setClipeAberto} viewerSteamId={jogador?.steamId} />
          ))}
        </section>
      )}
    </div>
  )
}
