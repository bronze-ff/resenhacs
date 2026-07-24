// site/client/src/pages/Clipes.jsx
import { useEffect, useState } from 'react'
import { SectionHeader } from '../components/ui'
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

  useEffect(() => {
    setDados(null)
    fetch(`/api/clipes?periodo=${periodo}`)
      .then((res) => (res.ok ? res.json() : { clipes: [] }))
      .then(setDados)
      .catch(() => setDados({ clipes: [] }))
  }, [periodo])

  return (
    <div className="space-y-6">
      <SectionHeader
        titulo="Clipes"
        className="flex-wrap"
        acao={
          <div className="flex gap-2">
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

      {dados === null ? (
        <p className="font-mono text-sm text-texto-fraco">Carregando…</p>
      ) : dados.clipes.length === 0 ? (
        <p className="font-mono text-sm text-texto-fraco">Nenhum clipe nesse período ainda.</p>
      ) : (
        <section className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {dados.clipes.map((c) => (
            <CardClipe key={c.id} clipe={c} aberto={clipeAberto === c.id} onAbrir={setClipeAberto} viewerSteamId={jogador?.steamId} />
          ))}
        </section>
      )}
    </div>
  )
}
