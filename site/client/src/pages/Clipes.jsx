import { useEffect, useState } from 'react'
import { Card, SectionHeader, DataTable, Badge } from '../components/ui'
import { useAuth } from '../auth/AuthContext.jsx'

const PERIODOS = [
  { valor: 'semana', label: 'Semana' },
  { valor: 'mes', label: 'Mês' },
  { valor: 'sempre', label: 'Sempre' },
]

const NOME_KIND = {
  ace: 'ACE', quad: 'QUAD KILL', triple: 'TRIPLE KILL',
  clutch_1v5: 'CLUTCH 1v5', clutch_1v4: 'CLUTCH 1v4', clutch_1v3: 'CLUTCH 1v3',
  clutch_1v2: 'CLUTCH 1v2', clutch_1v1: 'CLUTCH 1v1',
}

// kind vem null quando o round que a Allstar escolheu (gerar clipe por JOGADOR, não
// mais por highlight — ver allstarClip.js) não bate com nenhum highlight nosso pra
// esse jogador/round: a Allstar viu uma jogada boa que a gente não tinha detectado.
function nomeDoKind(kind) {
  if (!kind) return 'MOMENTO'
  return NOME_KIND[kind] ?? kind
}

// Ícone genérico pro card sem snapshot ainda (Allstar às vezes demora a gerar a
// miniatura) — mantém a mesma proporção aspect-video do snapshot real, sem "buraco".
function SnapshotPlaceholder() {
  return (
    <div className="mt-3 flex aspect-video w-full items-center justify-center border border-borda bg-superficie-alta text-texto-fraco">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="h-8 w-8">
        <rect x="3" y="5" width="18" height="14" rx="1" />
        <path d="M9 9L15 12L9 15V9Z" fill="currentColor" stroke="none" />
      </svg>
    </div>
  )
}

// Player embutido do Allstar — mesmo padrão usado na aba Clipes de Partida.jsx
// (site/client/src/pages/Partida.jsx), reaproveitado aqui pro modo "assistir" do card.
// `viewerSteamId` vai no ?UID= igual lá — é o parâmetro que a Allstar usa pra saber
// quem tá assistindo, não quem fez a jogada.
function PlayerClipe({ clipUrl, viewerSteamId, titulo }) {
  return (
    <div className="mt-3 aspect-video w-full">
      <iframe
        src={`${clipUrl}&UID=${viewerSteamId ?? ''}&location=melhoresClipes`}
        allow="autoplay; encrypted-media; picture-in-picture; clipboard-write; fullscreen"
        allowFullScreen
        className="h-full w-full border border-borda"
        title={titulo ?? 'Clipe Allstar'}
      />
    </div>
  )
}

function CardClipe({ clipe, aberto, onAbrir, viewerSteamId }) {
  const { pontuacao } = clipe
  return (
    <Card className="p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2">
          {clipe.avatarUrl && (
            <img src={clipe.avatarUrl} alt="" className="panel-cut-sm h-8 w-8 shrink-0 border border-borda object-cover" />
          )}
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <Badge tom="destaque">{nomeDoKind(clipe.kind)}</Badge>
              {pontuacao.bonusHeadshot > 0 && <Badge tom="sucesso">ALL HEADSHOTS</Badge>}
            </div>
            <p className="mt-1 truncate font-mono text-sm text-texto">
              {clipe.nick} · round {clipe.roundNumber} · {clipe.map}
            </p>
          </div>
        </div>
        <div className="shrink-0 text-right">
          <div
            className="font-display text-lg font-bold text-destaque"
            title={`${pontuacao.kind ?? 'momento'} (${pontuacao.base})${pontuacao.bonusHeadshot ? ` + All Headshots (+${pontuacao.bonusHeadshot})` : ''} = ${pontuacao.total}`}
          >
            {pontuacao.total}
          </div>
        </div>
      </div>
      {!aberto && (clipe.clipSnapshotUrl
        ? <img src={clipe.clipSnapshotUrl} alt="" className="mt-3 aspect-video w-full border border-borda object-cover" />
        : <SnapshotPlaceholder />)}
      <button
        type="button"
        onClick={() => onAbrir(aberto ? null : clipe.id)}
        className="panel-cut-sm mt-3 min-h-10 w-full border border-borda px-3 py-1.5 font-mono text-xs uppercase tracking-wide text-texto-fraco hover:border-destaque/50 hover:text-destaque lg:min-h-0"
      >
        {aberto ? 'Fechar' : '▶ Assistir'}
      </button>
      {aberto && (
        <PlayerClipe
          clipUrl={clipe.clipUrl}
          viewerSteamId={viewerSteamId}
          titulo={`Clipe Allstar de ${clipe.nick} — ${nomeDoKind(clipe.kind)} round ${clipe.roundNumber}`}
        />
      )}
    </Card>
  )
}

export default function Clipes() {
  const { jogador } = useAuth()
  const [periodo, setPeriodo] = useState('sempre')
  const [dados, setDados] = useState(null)
  const [clipeAberto, setClipeAberto] = useState(null)

  useEffect(() => {
    setDados(null)
    fetch(`/api/clipes?periodo=${periodo}`)
      .then((res) => (res.ok ? res.json() : { clipes: [], leaderboard: [] }))
      .then(setDados)
      .catch(() => setDados({ clipes: [], leaderboard: [] }))
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
        Pontuação calculada pelo Resenha (tipo de jogada + bônus de headshot) — não é a fórmula da Allstar.
      </p>

      {dados === null ? (
        <p className="font-mono text-sm text-texto-fraco">Carregando…</p>
      ) : dados.clipes.length === 0 ? (
        <p className="font-mono text-sm text-texto-fraco">Nenhum clipe nesse período ainda.</p>
      ) : (
        <>
          {dados.leaderboard.length > 0 && (
            <section>
              <h3 className="mb-2 font-display text-sm font-semibold uppercase tracking-wide text-texto-fraco">
                Leaderboard
              </h3>
              <div className="panel-cut border border-borda">
                <DataTable
                  head={<tr><th className="px-3 py-2">#</th><th className="px-3 py-2">Jogador</th><th className="px-2 py-2 text-right">Clipes</th><th className="px-3 py-2 text-right">Melhor pontuação</th></tr>}
                >
                  {dados.leaderboard.map((l, i) => (
                    <tr key={l.steamId}>
                      <td className="px-3 py-2 font-mono text-texto-fraco">{i + 1}º</td>
                      <td className="px-3 py-2">
                        <span className="flex items-center gap-2 font-mono text-texto">
                          {l.avatarUrl && <img src={l.avatarUrl} alt="" className="panel-cut-sm h-6 w-6 border border-borda object-cover" />}
                          {l.nick}
                        </span>
                      </td>
                      <td className="px-2 py-2 text-right tabular-nums">{l.clipes}</td>
                      <td className="px-3 py-2 text-right font-display font-bold text-destaque tabular-nums">{l.melhorPontuacao}</td>
                    </tr>
                  ))}
                </DataTable>
              </div>
            </section>
          )}

          <section className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {dados.clipes.map((c) => (
              <CardClipe key={c.id} clipe={c} aberto={clipeAberto === c.id} onAbrir={setClipeAberto} viewerSteamId={jogador?.steamId} />
            ))}
          </section>
        </>
      )}
    </div>
  )
}
