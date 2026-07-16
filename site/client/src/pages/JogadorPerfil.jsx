import { useEffect, useMemo, useState } from 'react'
import { useParams, useNavigate, Link } from 'react-router-dom'
import { nomeMapa, dataHora, corRating, nomeArma, TIPO_COMPRA } from '../lib/format.js'
import { Card, SectionHeader, StatTile, RatingBadge, DataTable, MapIcon, Badge, Select, PremierBadge } from '../components/ui'
import LinhaEvolucao from '../components/LinhaEvolucao.jsx'
import FiltroPeriodo from '../components/FiltroPeriodo.jsx'
import TagEstilo from '../components/TagEstilo.jsx'
import PosicionamentoAgregado from '../components/PosicionamentoAgregado.jsx'

// Stat compacto pro card mobile de partida (padrão do CardJogador em Ranking.jsx).
// `rating` (se passado) desenha um badge verde/vermelho estilo FACEIT (>= 1.0 / < 1.0).
function Stat({ rotulo, valor, cor, rating }) {
  return (
    <div className="min-w-0">
      <div className="font-mono text-[10px] uppercase tracking-wide text-texto-fraco">{rotulo}</div>
      {rating !== undefined ? (
        <RatingBadge valor={rating} className="text-sm" />
      ) : (
        <div className={`truncate text-sm font-semibold tabular-nums ${cor ?? 'text-texto'}`}>{valor}</div>
      )}
    </div>
  )
}

// Kinds de highlight que contam como "clutch" no resumo agrupado (CLUTCH_1V1, CLUTCH_1V2, CLUTCH_1V3...).
const CLUTCH_PREFIX = 'CLUTCH_'
const TOM_KIND = { ACE: 'destaque', QUAD: 'destaque', TRIPLE: 'sucesso' }
function tomDoKind(kind) {
  if (kind?.startsWith(CLUTCH_PREFIX)) return 'sucesso'
  return TOM_KIND[kind] ?? 'neutro'
}
function grupoDoKind(kind) {
  return kind?.startsWith(CLUTCH_PREFIX) ? 'Clutch' : kind
}
const LIMITE_INICIAL_DESTAQUES = 12

// Seção de Highlights com resumo por tipo, filtro por tipo/mapa e "carregar mais" — tudo client-side,
// já que o backend manda os destaques inteiros (já filtrados por período) num único payload.
function SecaoHighlights({ destaques }) {
  const [filtroTipo, setFiltroTipo] = useState(null) // null = todos; string = kind exato OU "Clutch"
  const [filtroMapa, setFiltroMapa] = useState('')
  const [limite, setLimite] = useState(LIMITE_INICIAL_DESTAQUES)

  const ordenados = useMemo(
    () => [...destaques].sort((a, b) => new Date(b.playedAt ?? 0) - new Date(a.playedAt ?? 0)),
    [destaques],
  )

  const contagemPorGrupo = useMemo(() => {
    const map = new Map()
    for (const d of ordenados) {
      const g = grupoDoKind(d.kind)
      map.set(g, (map.get(g) ?? 0) + 1)
    }
    return map
  }, [ordenados])

  const mapasDisponiveis = useMemo(
    () => [...new Set(ordenados.map((d) => d.map).filter(Boolean))].sort(),
    [ordenados],
  )

  const filtrados = useMemo(
    () =>
      ordenados.filter(
        (d) => (filtroTipo == null || grupoDoKind(d.kind) === filtroTipo) && (!filtroMapa || d.map === filtroMapa),
      ),
    [ordenados, filtroTipo, filtroMapa],
  )

  const visiveis = filtrados.slice(0, limite)
  const temMais = filtrados.length > visiveis.length

  function aplicarFiltroTipo(grupo) {
    setFiltroTipo((atual) => (atual === grupo ? null : grupo))
    setLimite(LIMITE_INICIAL_DESTAQUES)
  }

  return (
    <section>
      <SectionHeader titulo={<>Highlights <span className="text-texto-fraco">({destaques.length}) — "em qual partida foi esse mesmo?"</span></>} />

      {/* Resumo por tipo — clicável, filtra a lista abaixo. */}
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => aplicarFiltroTipo(null)}
          className={`panel-cut-sm min-h-10 cursor-pointer border px-3 py-2 font-mono text-xs uppercase tracking-wide transition-colors duration-200 sm:min-h-0 ${
            filtroTipo == null
              ? 'border-destaque/60 bg-destaque/10 text-destaque'
              : 'border-borda bg-superficie text-texto-fraco hover:border-destaque/40 hover:text-texto'
          }`}
        >
          Todos ({ordenados.length})
        </button>
        {[...contagemPorGrupo.entries()].map(([grupo, qtd]) => (
          <button
            key={grupo}
            type="button"
            onClick={() => aplicarFiltroTipo(grupo)}
            className={`panel-cut-sm min-h-10 cursor-pointer border px-3 py-2 font-mono text-xs uppercase tracking-wide transition-colors duration-200 sm:min-h-0 ${
              filtroTipo === grupo
                ? 'border-destaque/60 bg-destaque/10 text-destaque'
                : 'border-borda bg-superficie text-texto-fraco hover:border-destaque/40 hover:text-texto'
            }`}
          >
            {grupo} ({qtd})
          </button>
        ))}

        {mapasDisponiveis.length > 1 && (
          <Select
            value={filtroMapa}
            onChange={(e) => {
              setFiltroMapa(e.target.value)
              setLimite(LIMITE_INICIAL_DESTAQUES)
            }}
            selectClassName="text-xs uppercase tracking-wide"
          >
            <option value="">Todos os mapas</option>
            {mapasDisponiveis.map((m) => (
              <option key={m} value={m}>{nomeMapa(m)}</option>
            ))}
          </Select>
        )}
      </div>

      {filtrados.length === 0 && <p className="font-mono text-sm text-texto-fraco">Nenhum highlight com esse filtro.</p>}

      {filtrados.length > 0 && (
        <>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {visiveis.map((d) => (
              <Link
                key={d.id}
                to={`/partida/${d.matchId}?highlight=${d.id}`}
                className="panel-cut-sm flex min-h-10 flex-wrap items-center gap-x-2 gap-y-1 border border-borda bg-superficie px-3 py-2 font-mono text-xs transition-colors duration-200 hover:border-destaque/60 hover:bg-superficie-alta"
                title={`${nomeMapa(d.map)} · ${dataHora(d.playedAt)}`}
              >
                <Badge tom={tomDoKind(d.kind)}>{d.kind}</Badge>
                <span className="text-texto-fraco">round {d.roundNumber}</span>
                <span className="ml-auto flex items-center gap-1 text-texto">
                  <MapIcon map={d.map} size={16} />
                  {nomeMapa(d.map)}
                </span>
                <span className="w-full text-texto-fraco sm:w-auto">{dataHora(d.playedAt)}</span>
              </Link>
            ))}
          </div>

          {temMais && (
            <div className="mt-3 flex justify-center">
              <button
                type="button"
                onClick={() => setLimite((l) => l + LIMITE_INICIAL_DESTAQUES)}
                className="panel-cut-sm min-h-10 cursor-pointer border border-borda px-4 py-2 font-mono text-xs uppercase tracking-wide text-texto-fraco transition-colors duration-200 hover:border-destaque/60 hover:text-destaque"
              >
                Carregar mais ({filtrados.length - visiveis.length})
              </button>
            </div>
          )}
        </>
      )}
    </section>
  )
}

export default function JogadorPerfil() {
  const { steamId } = useParams()
  const navegar = useNavigate()
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

  const { jogador, stats, porMapa, recentes, sinergia, evolucao, badges, estilo, destaques, armas, economia, premierAtual } = data

  return (
    <div className="space-y-6">
      {/* 1. Header — avatar, nick, badges/estilo (pequenos, ficam aqui mesmo) e filtro de período. */}
      <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex min-w-0 items-center gap-4">
          {jogador.avatarUrl && (
            <img src={jogador.avatarUrl} alt="" className="panel-cut h-16 w-16 shrink-0 border border-borda object-cover" />
          )}
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="truncate font-display text-2xl font-bold uppercase tracking-wide text-texto">
                {jogador.nick || jogador.steamId}
              </h2>
              <TagEstilo estilo={estilo} />
              <PremierBadge valor={premierAtual} />
            </div>
            <p className="font-mono text-sm text-texto-fraco">{stats.partidas} partidas · {stats.winrate}% de vitória</p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-3 lg:gap-4">
          <FiltroPeriodo de={de} ate={ate} onDe={setDe} onAte={setAte} />
          <Link
            to={`/comparar?a=${jogador.steamId}`}
            className="panel-cut-sm min-h-10 border border-borda px-3 py-2 font-mono text-xs uppercase tracking-wide text-texto-fraco transition-colors hover:border-destaque/60 hover:text-destaque lg:min-h-0"
          >
            Comparar com…
          </Link>
        </div>
      </div>

      {/* 2. Tiles de stats principais — o que mais se consulta de cara. */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <StatTile
          rotulo="Rating"
          valor={stats.rating?.toFixed(2) ?? '–'}
          tom={stats.rating == null ? 'neutro' : stats.rating >= 1.15 ? 'sucesso' : stats.rating <= 0.85 ? 'perigo' : 'neutro'}
        />
        <StatTile rotulo="K/D" valor={stats.kd} />
        <StatTile rotulo="ADR" valor={stats.adr} />
        <StatTile rotulo="HS%" valor={`${stats.hsPct}%`} />
        <StatTile rotulo="Vitórias" valor={`${stats.vitorias}/${stats.partidas}`} sub={`${stats.winrate}%`} />
        <StatTile rotulo="Kills" valor={stats.kills} sub={`${stats.deaths} deaths`} />
      </div>

      {badges.length > 0 && (
        <section>
          <SectionHeader titulo={<>Conquistas <span className="text-texto-fraco">({badges.length})</span></>} />
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

      {/* 3. Histórico de partidas — o que mais se consulta, logo depois dos tiles. */}
      <section>
        <SectionHeader titulo={<>
          Partidas recentes
          {stats.rating != null && (
            <span className="ml-2 font-mono text-xs font-normal normal-case text-texto-fraco">
              (± vs média de {stats.rating.toFixed(2)} — consistência: acima ou abaixo do normal dele)
            </span>
          )}
        </>} />
        {recentes.length === 0 && <p className="font-mono text-sm text-texto-fraco">Nenhuma partida ainda.</p>}

        {recentes.length > 0 && (
          <>
            {/* Mobile: cards no padrão do Ranking (badge V/D + grade de stats) */}
            <div className="space-y-2 lg:hidden">
              {recentes.map((r) => {
                const kd = r.deaths > 0 ? (r.kills / r.deaths).toFixed(2) : r.kills.toFixed(2)
                return (
                  <Link
                    key={r.id}
                    to={`/partida/${r.id}`}
                    className="panel-cut flex items-center gap-3 border border-borda bg-superficie p-3 transition-colors hover:bg-superficie-alta"
                  >
                    <div className="w-14 shrink-0 font-mono text-[11px] leading-tight text-texto-fraco">
                      <div>{new Date(r.playedAt ?? '').toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })}</div>
                      <div>{new Date(r.playedAt ?? '').toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}</div>
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span
                          className={`panel-cut-sm px-1.5 py-0.5 font-display text-[10px] font-bold uppercase ${
                            r.won === true ? 'bg-sucesso/15 text-sucesso' : r.won === false ? 'bg-perigo/15 text-perigo' : 'bg-superficie-alta text-texto-fraco'
                          }`}
                        >
                          {r.won === true ? 'V' : r.won === false ? 'D' : '—'}
                        </span>
                        <span className="font-display text-lg font-bold tabular-nums text-texto">{r.scoreA} : {r.scoreB}</span>
                        <MapIcon map={r.map} size={18} />
                        <span className="truncate font-mono text-xs text-texto-fraco">{nomeMapa(r.map)}</span>
                      </div>
                      <div className="mt-2 grid grid-cols-4 gap-2">
                        <Stat rotulo="Rating" valor={r.rating != null ? r.rating.toFixed(2) : '–'} rating={r.rating} />
                        <Stat rotulo="K/D/A" valor={`${r.kills}/${r.deaths}/${r.assists}`} />
                        <Stat rotulo="K/D" valor={kd} cor={Number(kd) >= 1 ? 'text-sucesso' : 'text-perigo'} />
                        <Stat rotulo="ADR" valor={r.adr} />
                      </div>
                    </div>
                  </Link>
                )
              })}
            </div>

            {/* Desktop: tabela densa estilo FACEIT */}
            <div className="hidden lg:block">
              <DataTable
                head={
                  <tr>
                    <th className="px-3 py-2">Data</th>
                    <th className="px-2 py-2">Placar</th>
                    <th className="px-2 py-2 text-right">Rating</th>
                    <th className="px-2 py-2 text-right">K/D/A</th>
                    <th className="px-2 py-2 text-right">K/D</th>
                    <th className="hidden px-2 py-2 text-right xl:table-cell">ADR</th>
                    <th className="hidden px-2 py-2 text-right xl:table-cell">HS%</th>
                    <th className="px-3 py-2">Mapa</th>
                  </tr>
                }
              >
                {recentes.map((r) => {
                  const kd = r.deaths > 0 ? (r.kills / r.deaths).toFixed(2) : r.kills.toFixed(2)
                  return (
                    <tr
                      key={r.id}
                      className={`cursor-pointer border-l-4 ${
                        r.won === true ? 'border-l-sucesso' : r.won === false ? 'border-l-perigo' : 'border-l-texto-fraco'
                      }`}
                      onClick={() => navegar(`/partida/${r.id}`)}
                    >
                      <td className="px-3 py-2">
                        <div className="font-mono text-[11px] leading-tight text-texto-fraco">
                          <div>{new Date(r.playedAt ?? '').toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })}</div>
                          <div>{new Date(r.playedAt ?? '').toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}</div>
                        </div>
                      </td>
                      <td className="px-2 py-2">
                        <span className="flex items-center gap-2">
                          <span
                            className={`panel-cut-sm px-1.5 py-0.5 font-display text-[10px] font-bold uppercase ${
                              r.won === true ? 'bg-sucesso/15 text-sucesso' : r.won === false ? 'bg-perigo/15 text-perigo' : 'bg-superficie-alta text-texto-fraco'
                            }`}
                          >
                            {r.won === true ? 'V' : r.won === false ? 'D' : '—'}
                          </span>
                          <span className="font-display font-bold tabular-nums text-texto">{r.scoreA} : {r.scoreB}</span>
                        </span>
                      </td>
                      <td className="px-2 py-2 text-right"><RatingBadge valor={r.rating} /></td>
                      <td className="px-2 py-2 text-right font-mono tabular-nums text-texto-fraco">{r.kills}/{r.deaths}/{r.assists}</td>
                      <td className={`px-2 py-2 text-right font-mono tabular-nums ${Number(kd) >= 1 ? 'text-sucesso' : 'text-perigo'}`}>{kd}</td>
                      <td className="hidden px-2 py-2 text-right font-mono tabular-nums text-texto-fraco xl:table-cell">{r.adr}</td>
                      <td className="hidden px-2 py-2 text-right font-mono tabular-nums text-texto-fraco xl:table-cell">{r.hsPct}%</td>
                      <td className="px-3 py-2 font-mono text-texto-fraco">
                        <span className="flex items-center gap-2">
                          <MapIcon map={r.map} size={20} />
                          {nomeMapa(r.map)}
                        </span>
                      </td>
                    </tr>
                  )
                })}
              </DataTable>
            </div>
          </>
        )}
      </section>

      {/* 4. Highlights — aces/clutches com deep-link, resumo por tipo/mapa e carregar mais. */}
      {destaques.length > 0 && <SecaoHighlights destaques={destaques} />}

      {/* 5. Armas. */}
      <section>
        <SectionHeader titulo="Armas" />
        {armas.length === 0 && <p className="font-mono text-sm text-texto-fraco">Sem dados de arma ainda.</p>}
        <div className="space-y-2">
          {armas.slice(0, 6).map((a) => {
            const maiorKills = armas[0]?.kills || 1
            return (
              <Card key={a.weapon} className="p-3">
                <div className="mb-1.5 flex flex-wrap items-center justify-between gap-x-3 gap-y-1 font-mono text-sm">
                  <span className="text-texto">{nomeArma(a.weapon)}</span>
                  <span className="text-texto-fraco">
                    <span className="text-texto">{a.kills}</span> kills · {a.hsPct}% HS
                    {a.temAccuracyConfiavel && <> · {a.accuracy}% precisão</>}
                  </span>
                </div>
                <div className="h-1.5 overflow-hidden rounded bg-fundo">
                  <div className="h-full bg-destaque/70" style={{ width: `${(a.kills / maiorKills) * 100}%` }} />
                </div>
              </Card>
            )
          })}
        </div>
      </section>

      {/* 6. Por mapa. */}
      <section>
        <SectionHeader titulo="Por mapa" />
        {porMapa.length === 0 && <p className="font-mono text-sm text-texto-fraco">Sem dados por mapa ainda.</p>}
        <div className="space-y-2">
          {porMapa.map((mp) => (
            <Card key={mp.map} className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 p-3">
              <span className="flex items-center gap-2 font-mono text-texto">
                <MapIcon map={mp.map} size={28} />
                {nomeMapa(mp.map)}
              </span>
              <span className="font-mono text-sm text-texto-fraco">
                <span className="tabular-nums text-texto">{mp.partidas}</span> jogos ·{' '}
                <span className={`tabular-nums ${mp.winrate >= 50 ? 'text-sucesso' : 'text-perigo'}`}>{mp.winrate}%</span>
                {mp.rating != null && (
                  <span className={`ml-2 tabular-nums ${corRating(mp.rating)}`}>{mp.rating.toFixed(2)}</span>
                )}
              </span>
            </Card>
          ))}
        </div>
      </section>

      {/* 7. Sinergia / com quem joga. */}
      <section>
        <SectionHeader titulo="Com quem mais joga" />
        {sinergia.length === 0 && <p className="font-mono text-sm text-texto-fraco">Sem duplas registradas ainda.</p>}
        <div className="space-y-2">
          {sinergia.map((s) => (
            <Card
              as={Link}
              interativo
              key={s.steamId}
              to={`/jogador/${s.steamId}`}
              className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 p-3"
            >
              <span className="flex min-w-0 items-center gap-3 font-mono text-texto">
                {s.avatarUrl && (
                  <img src={s.avatarUrl} alt="" className="panel-cut-sm h-8 w-8 shrink-0 border border-borda object-cover" />
                )}
                <span className="truncate">{s.nick || s.steamId}</span>
              </span>
              <span className="shrink-0 font-mono text-sm text-texto-fraco">
                <span className="tabular-nums text-texto">{s.partidas}</span> juntos ·{' '}
                <span className={`tabular-nums ${s.winrate >= 50 ? 'text-sucesso' : 'text-perigo'}`}>
                  {s.winrate}%
                </span>
              </span>
            </Card>
          ))}
        </div>
      </section>

      {/* 8. Resto — evolução, stats avançadas/utilitária, economia e posicionamento. */}
      <section>
        <SectionHeader titulo={<>Evolução do rating <span className="text-texto-fraco">(últimas {evolucao.length} partidas)</span></>} />
        <Card className="p-4">
          <LinhaEvolucao pontos={evolucao.map((e) => ({ label: dataHora(e.playedAt), valor: e.rating }))} />
        </Card>
      </section>

      <section>
        <SectionHeader titulo="Detalhado" />
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
        <SectionHeader titulo="Utilitária" />
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
            title="Quantas vezes flashou um inimigo por mais de 1.1s (cegueira rápida/de raspão não conta — mesmo critério do Leetify), e a duração média de cegueira por vez."
          />
          <StatTile
            rotulo="Cegou aliado"
            valor={stats.teammatesFlashed}
            sub={`${stats.teammateFlashDuration}s no total`}
            tom={stats.teammatesFlashed > 0 ? 'perigo' : 'neutro'}
            title="Flash de time (mais de 1.1s de cegueira) — auto-flash (cegar a si mesmo) CONTA aqui, é fogo amigo também."
          />
          <StatTile
            rotulo="Fogo amigo (HE+fogo)"
            valor={stats.heTeamDamage + stats.molotovTeamDamage}
            tom={(stats.heTeamDamage + stats.molotovTeamDamage) > 0 ? 'perigo' : 'neutro'}
            title="Dano de HE + molotov no PRÓPRIO time — não entra no 'Dano HE'/'Dano fogo' de cima, que é só inimigo."
          />
        </div>
      </section>

      <section>
        <SectionHeader titulo={<>Economia <span className="text-texto-fraco">— winrate por tipo de compra</span></>} />
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
          {Object.entries(economia ?? {}).map(([tipo, e]) => (
            <Card key={tipo} className="p-3">
              <div className={`font-mono text-xs uppercase tracking-wide ${TIPO_COMPRA[tipo]?.cor ?? 'text-texto-fraco'}`}>
                {TIPO_COMPRA[tipo]?.label ?? tipo}
              </div>
              <div className="mt-1 font-display text-xl font-bold text-texto">
                {e.rounds > 0 ? `${e.winPct}%` : '–'}
              </div>
              <div className="font-mono text-xs text-texto-fraco">{e.won}/{e.rounds} rounds</div>
            </Card>
          ))}
        </div>
        <p className="mt-2 font-mono text-[11px] text-texto-fraco">
          Classificação por valor de equipamento do TIME no fim do freezetime (padrão HLTV): eco &lt; $5k, forçado $5k-10k, meia-compra $10k-20k, cheia ≥ $20k.
        </p>
      </section>

      <section>
        <SectionHeader titulo="Posicionamento" />
        <PosicionamentoAgregado steamId={jogador.steamId} />
      </section>
    </div>
  )
}
