import { useEffect, useState } from 'react'
import { useParams, Link } from 'react-router-dom'
import { nomeMapa, dataHora, corRating, nomeArma, TIPO_COMPRA } from '../lib/format.js'
import StatTile from '../components/StatTile.jsx'
import LinhaEvolucao from '../components/LinhaEvolucao.jsx'
import FiltroPeriodo from '../components/FiltroPeriodo.jsx'
import TagEstilo from '../components/TagEstilo.jsx'
import PosicionamentoAgregado from '../components/PosicionamentoAgregado.jsx'

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

  const { jogador, stats, porMapa, recentes, sinergia, evolucao, badges, estilo, destaques, armas, economia } = data

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
                sub={`${stats.clutchPct}% vencidos${stats.clutchSaves ? ` · ${stats.clutchSaves} save` : ''}`}
                title="Rounds em que ele ficou por último vivo contra 1+ inimigos: vencidos / total de situações. Save = sobreviveu mas o round foi perdido (salvou a arma)."
              />
            </div>
          )
        })()}
        <p className="mt-3 font-mono text-xs leading-relaxed text-texto-fraco">
          Como medimos — <span className="text-texto">Precisão</span>: tiros certos ÷ disparados (só armas de fogo).{' '}
          <span className="text-texto">Entry</span>: o 1º duelo de cada round, vencidos/disputados.{' '}
          <span className="text-texto">Trades</span>: kill em até 5s vingando um colega que acabou de morrer.{' '}
          <span className="text-texto">Clutch</span>: por último vivo contra 1+, vencidos/total.{' '}
          Em todo o site, <span className="text-texto">X/Y = sucessos/total</span>. Passe o mouse em cada card pra mais detalhe.
        </p>
      </section>

      <section>
        <h3 className="mb-3 font-display text-lg font-semibold uppercase tracking-wide text-texto">Utilitária</h3>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-8">
          <StatTile
            rotulo="Smokes"
            valor={stats.smokesThrown}
            title="Smokes jogadas no período."
          />
          <StatTile
            rotulo="Flashes"
            valor={stats.flashesThrown}
            sub={`${stats.enemiesFlashedPerFlash} inimigo/flash`}
            title="Flashes jogadas e a média de quantos inimigos cada uma cegou (não é %, uma flash pode cegar vários de uma vez)."
          />
          <StatTile
            rotulo="Flash assist"
            valor={stats.flashAssists}
            sub={`${stats.flashAssistPct}% das flashes`}
            title="Flash que cegou um inimigo morto por um colega (ou por você mesmo) logo em seguida, ainda cego. Mesmo conceito do 'Flash Assist' do Leetify/HLTV."
          />
          <StatTile
            rotulo="HEs"
            valor={stats.heThrown}
            sub={`${stats.avgHeDamage} dano/HE`}
            title={`Dano total em inimigo: ${stats.heDamage}${stats.heTeamDamage ? ` (+ ${stats.heTeamDamage} de fogo amigo, não conta aqui)` : ''}. A média é por HE jogada, não por partida.`}
          />
          <StatTile
            rotulo="Molotov/Incend."
            valor={stats.molotovsThrown}
            sub={`${stats.avgMolotovDamage} dano/molotov`}
            title={`Dano total em inimigo: ${stats.molotovDamage}${stats.molotovTeamDamage ? ` (+ ${stats.molotovTeamDamage} de fogo amigo, não conta aqui)` : ''}. A média é por molotov jogado, não por partida.`}
          />
          <StatTile
            rotulo="Cegou inimigo"
            valor={stats.enemiesFlashed}
            sub={`${stats.avgBlindDuration}s em média`}
            title="Quantas vezes flashou um inimigo, e a duração média de cegueira por vez (não o total)."
          />
          <StatTile
            rotulo="Cegou aliado"
            valor={stats.teammatesFlashed}
            sub={`${stats.teammateFlashDuration}s no total`}
            destaque={stats.teammatesFlashed > 0 ? 'text-perigo' : undefined}
            title="Flash de time: quantas vezes cegou um aliado (não conta auto-flash), e os segundos totais."
          />
          <StatTile
            rotulo="Fogo amigo (HE+fogo)"
            valor={stats.heTeamDamage + stats.molotovTeamDamage}
            destaque={(stats.heTeamDamage + stats.molotovTeamDamage) > 0 ? 'text-perigo' : undefined}
            title="Dano de HE + molotov no PRÓPRIO time — não entra no 'Dano HE'/'Dano fogo' de cima, que é só inimigo."
          />
        </div>
      </section>

      <div className="grid gap-6 lg:grid-cols-2">
        <section>
          <h3 className="mb-3 font-display text-lg font-semibold uppercase tracking-wide text-texto">Armas</h3>
          {armas.length === 0 && <p className="font-mono text-sm text-texto-fraco">Sem dados de arma ainda.</p>}
          <div className="space-y-2">
            {armas.slice(0, 6).map((a) => {
              const maiorKills = armas[0]?.kills || 1
              return (
                <div key={a.weapon} className="panel-cut border border-borda bg-superficie p-3">
                  <div className="mb-1.5 flex items-center justify-between font-mono text-sm">
                    <span className="text-texto">{nomeArma(a.weapon)}</span>
                    <span className="text-texto-fraco">
                      <span className="text-texto">{a.kills}</span> kills · {a.hsPct}% HS
                      {a.temAccuracyConfiavel && <> · {a.accuracy}% precisão</>}
                    </span>
                  </div>
                  <div className="h-1.5 overflow-hidden rounded bg-fundo">
                    <div className="h-full bg-destaque/70" style={{ width: `${(a.kills / maiorKills) * 100}%` }} />
                  </div>
                </div>
              )
            })}
          </div>
        </section>

        <section>
          <h3 className="mb-3 font-display text-lg font-semibold uppercase tracking-wide text-texto">
            Economia <span className="text-texto-fraco">— winrate por tipo de compra</span>
          </h3>
          <div className="grid grid-cols-2 gap-3">
            {Object.entries(economia ?? {}).map(([tipo, e]) => (
              <div key={tipo} className="panel-cut border border-borda bg-superficie p-3">
                <div className={`font-mono text-xs uppercase tracking-wide ${TIPO_COMPRA[tipo]?.cor ?? 'text-texto-fraco'}`}>
                  {TIPO_COMPRA[tipo]?.label ?? tipo}
                </div>
                <div className="mt-1 font-display text-xl font-bold text-texto">
                  {e.rounds > 0 ? `${e.winPct}%` : '–'}
                </div>
                <div className="font-mono text-xs text-texto-fraco">{e.won}/{e.rounds} rounds</div>
              </div>
            ))}
          </div>
          <p className="mt-2 font-mono text-[11px] text-texto-fraco">
            Classificação por valor de equipamento do TIME no fim do freezetime (padrão HLTV): eco &lt; $5k, forçado $5k-10k, meia-compra $10k-20k, cheia ≥ $20k.
          </p>
        </section>
      </div>

      <section>
        <h3 className="mb-3 font-display text-lg font-semibold uppercase tracking-wide text-texto">Posicionamento</h3>
        <PosicionamentoAgregado steamId={jogador.steamId} />
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

      {destaques.length > 0 && (
        <section>
          <h3 className="mb-3 font-display text-lg font-semibold uppercase tracking-wide text-texto">
            Highlights <span className="text-texto-fraco">({destaques.length}) — "em qual partida foi esse mesmo?"</span>
          </h3>
          <div className="flex flex-wrap gap-2">
            {destaques.map((d) => (
              <Link
                key={d.id}
                to={`/partida/${d.matchId}?highlight=${d.id}`}
                className="panel-cut-sm flex items-center gap-2 border border-borda bg-superficie px-3 py-2 font-mono text-xs transition-colors hover:border-destaque/60"
                title={`${nomeMapa(d.map)} · ${dataHora(d.playedAt)}`}
              >
                <span className="font-display font-semibold uppercase text-destaque">{d.kind}</span>
                <span className="text-texto-fraco">round {d.roundNumber}</span>
                <span className="text-texto-fraco">·</span>
                <span className="text-texto">{nomeMapa(d.map)}</span>
                <span className="text-texto-fraco">{dataHora(d.playedAt)}</span>
              </Link>
            ))}
          </div>
        </section>
      )}

      <section>
        <h3 className="mb-3 font-display text-lg font-semibold uppercase tracking-wide text-texto">
          Partidas recentes
          {stats.rating != null && (
            <span className="ml-2 font-mono text-xs font-normal normal-case text-texto-fraco">
              (± vs média de {stats.rating.toFixed(2)} — consistência: acima ou abaixo do normal dele)
            </span>
          )}
        </h3>
        {recentes.length === 0 && <p className="font-mono text-sm text-texto-fraco">Nenhuma partida ainda.</p>}
        <div className="space-y-2">
          {recentes.map((r) => {
            const delta = r.rating != null && stats.rating != null ? Math.round((r.rating - stats.rating) * 100) / 100 : null
            return (
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
                {delta != null && (
                  <span
                    className={`text-xs ${delta >= 0.1 ? 'text-sucesso' : delta <= -0.1 ? 'text-perigo' : 'text-texto-fraco'}`}
                    title="Diferença do rating dessa partida pra média dele no período"
                  >
                    {delta >= 0 ? '+' : ''}{delta.toFixed(2)}
                  </span>
                )}
              </span>
              <span className="font-mono text-sm tabular-nums text-texto-fraco">
                {r.scoreA}:{r.scoreB} · {r.kills}/{r.deaths}
                {r.rating != null && <span className={`ml-2 ${corRating(r.rating)}`}>{r.rating.toFixed(2)}</span>}
              </span>
            </Link>
            )
          })}
        </div>
      </section>
    </div>
  )
}
