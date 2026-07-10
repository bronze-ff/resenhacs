import { useEffect, useState } from 'react'
import { useParams, Link } from 'react-router-dom'
import { nomeMapa, dataHora, corRating } from '../lib/format.js'
import StatTile from '../components/StatTile.jsx'
import LinhaEvolucao from '../components/LinhaEvolucao.jsx'
import FiltroPeriodo from '../components/FiltroPeriodo.jsx'
import TagEstilo from '../components/TagEstilo.jsx'

export default function JogadorPerfil() {
  const { steamId } = useParams()
  const [data, setData] = useState(null)
  const [erro, setErro] = useState(false)
  const [de, setDe] = useState('')
  const [ate, setAte] = useState('')

  useEffect(() => {
    setData(null)
    setErro(false)
    const qs = new URLSearchParams()
    if (de) qs.set('from', de)
    if (ate) qs.set('to', ate)
    fetch(`/api/profile/${steamId}${qs.size ? `?${qs}` : ''}`)
      .then((res) => {
        if (!res.ok) throw new Error()
        return res.json()
      })
      .then(setData)
      .catch(() => setErro(true))
  }, [steamId, de, ate])

  if (erro) return <p className="font-mono text-sm text-texto-fraco">Jogador não encontrado.</p>
  if (!data) return <p className="font-mono text-sm text-texto-fraco">Carregando…</p>

  const { jogador, stats, porMapa, recentes, sinergia, evolucao, badges, estilo } = data

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-4">
          {jogador.avatarUrl && (
            <img src={jogador.avatarUrl} alt="" className="panel-cut h-16 w-16 border border-borda object-cover" />
          )}
          <div>
            <div className="flex items-center gap-2">
              <h2 className="font-display text-2xl font-bold uppercase tracking-wide text-texto">
                {jogador.nick || jogador.steamId}
              </h2>
              <TagEstilo estilo={estilo} />
            </div>
            <p className="font-mono text-sm text-texto-fraco">{stats.partidas} partidas · {stats.winrate}% de vitória</p>
          </div>
        </div>
        <div className="flex items-center gap-4">
          <FiltroPeriodo de={de} ate={ate} onDe={setDe} onAte={setAte} />
          <Link
            to={`/comparar?a=${jogador.steamId}`}
            className="panel-cut-sm border border-borda px-3 py-2 font-mono text-xs uppercase tracking-wide text-texto-fraco transition-colors hover:border-destaque/60 hover:text-destaque"
          >
            Comparar com…
          </Link>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <StatTile rotulo="Rating" valor={stats.rating?.toFixed(2) ?? '–'} destaque={corRating(stats.rating)} />
        <StatTile rotulo="K/D" valor={stats.kd} />
        <StatTile rotulo="ADR" valor={stats.adr} />
        <StatTile rotulo="HS%" valor={`${stats.hsPct}%`} />
        <StatTile rotulo="Vitórias" valor={`${stats.vitorias}/${stats.partidas}`} sub={`${stats.winrate}%`} />
        <StatTile rotulo="Kills" valor={stats.kills} sub={`${stats.deaths} deaths`} />
      </div>

      {badges.length > 0 && (
        <section>
          <h3 className="mb-3 font-display text-lg font-semibold uppercase tracking-wide text-texto">
            Conquistas <span className="text-texto-fraco">({badges.length})</span>
          </h3>
          <div className="flex flex-wrap gap-2">
            {badges.map((b) => (
              <div
                key={b.tag}
                title={b.label}
                className="panel-cut-sm flex items-center gap-2 border border-borda bg-superficie px-3 py-2"
              >
                <span className="text-lg leading-none">{b.icon}</span>
                <span className="font-mono text-xs text-texto">{b.label}</span>
              </div>
            ))}
          </div>
        </section>
      )}

      <section>
        <h3 className="mb-3 font-display text-lg font-semibold uppercase tracking-wide text-texto">
          Evolução do rating <span className="text-texto-fraco">(últimas {evolucao.length} partidas)</span>
        </h3>
        <div className="panel-cut border border-borda bg-superficie p-4">
          <LinhaEvolucao pontos={evolucao.map((e) => ({ label: dataHora(e.playedAt), valor: e.rating }))} />
        </div>
      </section>

      <section>
        <h3 className="mb-3 font-display text-lg font-semibold uppercase tracking-wide text-texto">Detalhado</h3>
        {(() => {
          // Convenção do sistema inteiro: X/Y sempre = sucessos/total.
          const duelosEntry = stats.entryKills + stats.entryDeaths
          const entryPct = duelosEntry ? Math.round((stats.entryKills / duelosEntry) * 1000) / 10 : 0
          return (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
              <StatTile
                rotulo="Precisão"
                valor={`${stats.accuracy}%`}
                sub={`${stats.shotsHit} de ${stats.shotsFired} tiros`}
                title="Tiros que acertaram alguém ÷ tiros disparados (só armas de fogo; granada e faca ficam de fora)."
              />
              <StatTile
                rotulo="Dano utilitária"
                valor={stats.utilityDamagePerRound}
                sub="dano de granada / round"
                title="Dano de HE, molotov e incendiária por round jogado."
              />
              <StatTile
                rotulo="Entry (1º duelo)"
                valor={`${stats.entryKills}/${duelosEntry}`}
                sub={`${entryPct}% vencidos`}
                title={`O primeiro duelo de cada round: venceu ${stats.entryKills} (matou primeiro) e perdeu ${stats.entryDeaths} (morreu primeiro). Quando ele abre matando, o time ganha o round em ${stats.entryWinPct}% das vezes.`}
              />
              <StatTile
                rotulo="Trades"
                valor={stats.tradeKills}
                sub={`${stats.tradedDeaths} mortes suas vingadas`}
                title="Kills que vingaram um colega morto nos 5s anteriores. O número de baixo é o contrário: quantas vezes um colega vingou a morte dele."
              />
              <StatTile
                rotulo="Clutch (1vX)"
                valor={`${stats.clutchWins}/${stats.clutchAttempts}`}
                sub={`${stats.clutchPct}% vencidos`}
                title="Rounds em que ele ficou sozinho contra 2 ou mais inimigos: vencidos / tentativas."
              />
            </div>
          )
        })()}
        <p className="mt-3 font-mono text-xs leading-relaxed text-texto-fraco">
          Como medimos — <span className="text-texto">Precisão</span>: tiros certos ÷ disparados (só armas de fogo).{' '}
          <span className="text-texto">Entry</span>: o 1º duelo de cada round, vencidos/disputados.{' '}
          <span className="text-texto">Trades</span>: kill em até 5s vingando um colega que acabou de morrer.{' '}
          <span className="text-texto">Clutch</span>: sozinho contra 2+, vencidos/tentativas.{' '}
          Em todo o site, <span className="text-texto">X/Y = sucessos/total</span>. Passe o mouse em cada card pra mais detalhe.
        </p>
      </section>

      <div className="grid gap-6 lg:grid-cols-2">
        <section>
          <h3 className="mb-3 font-display text-lg font-semibold uppercase tracking-wide text-texto">Com quem mais joga</h3>
          {sinergia.length === 0 && <p className="font-mono text-sm text-texto-fraco">Sem duplas registradas ainda.</p>}
          <div className="space-y-2">
            {sinergia.map((s) => (
              <Link
                key={s.steamId}
                to={`/jogador/${s.steamId}`}
                className="panel-cut flex items-center justify-between border border-borda bg-superficie p-3 transition-colors hover:border-destaque/60"
              >
                <span className="flex items-center gap-3 font-mono text-texto">
                  {s.avatarUrl && (
                    <img src={s.avatarUrl} alt="" className="panel-cut-sm h-8 w-8 border border-borda object-cover" />
                  )}
                  <span>{s.nick || s.steamId}</span>
                </span>
                <span className="font-mono text-sm text-texto-fraco">
                  <span className="tabular-nums text-texto">{s.partidas}</span> juntos ·{' '}
                  <span className={`tabular-nums ${s.winrate >= 50 ? 'text-sucesso' : 'text-perigo'}`}>
                    {s.winrate}%
                  </span>
                </span>
              </Link>
            ))}
          </div>
        </section>

        <section>
          <h3 className="mb-3 font-display text-lg font-semibold uppercase tracking-wide text-texto">Por mapa</h3>
          {porMapa.length === 0 && <p className="font-mono text-sm text-texto-fraco">Sem dados por mapa ainda.</p>}
          <div className="space-y-2">
            {porMapa.map((mp) => (
              <div key={mp.map} className="panel-cut flex items-center justify-between border border-borda bg-superficie p-3">
                <span className="font-mono text-texto">{nomeMapa(mp.map)}</span>
                <span className="font-mono text-sm text-texto-fraco">
                  <span className="tabular-nums text-texto">{mp.partidas}</span> jogos ·{' '}
                  <span className={`tabular-nums ${mp.winrate >= 50 ? 'text-sucesso' : 'text-perigo'}`}>{mp.winrate}%</span>
                  {mp.rating != null && (
                    <span className={`ml-2 tabular-nums ${corRating(mp.rating)}`}>{mp.rating.toFixed(2)}</span>
                  )}
                </span>
              </div>
            ))}
          </div>
        </section>
      </div>

      <section>
        <h3 className="mb-3 font-display text-lg font-semibold uppercase tracking-wide text-texto">Partidas recentes</h3>
        {recentes.length === 0 && <p className="font-mono text-sm text-texto-fraco">Nenhuma partida ainda.</p>}
        <div className="space-y-2">
          {recentes.map((r) => (
            <Link
              key={r.id}
              to={`/partida/${r.id}`}
              className="panel-cut flex items-center justify-between border border-borda bg-superficie p-3 transition-colors hover:border-destaque/60"
            >
              <span className="flex items-center gap-3 font-mono text-texto">
                <span
                  className={`inline-block h-2 w-2 rounded-full ${r.won === true ? 'bg-sucesso' : r.won === false ? 'bg-perigo' : 'bg-texto-fraco'}`}
                  title={r.won === true ? 'Vitória' : r.won === false ? 'Derrota' : 'Empate'}
                />
                <span>{nomeMapa(r.map)}</span>
                <span className="text-xs text-texto-fraco">{dataHora(r.playedAt)}</span>
              </span>
              <span className="font-mono text-sm tabular-nums text-texto-fraco">
                {r.scoreA}:{r.scoreB} · {r.kills}/{r.deaths}
                {r.rating != null && <span className={`ml-2 ${corRating(r.rating)}`}>{r.rating.toFixed(2)}</span>}
              </span>
            </Link>
          ))}
        </div>
      </section>
    </div>
  )
}
