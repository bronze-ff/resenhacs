import { useEffect, useMemo, useState } from 'react'
import { useParams, useNavigate, Link } from 'react-router-dom'
import { nomeMapa, dataHora, corRating, nomeArma, TIPO_COMPRA, rotuloHighlight } from '../lib/format.js'
import { Abas, Avatar, Button, classesBotao, EstadoErro, EstadoVazio, Skeleton, SkeletonLista, Card, SectionHeader, StatTile, RatingBadge, DataTable, MapIcon, Badge, Select, PlataformaBadge, SteamIcon, FaceitIcon, faixaPremier, nivelDoElo, corChipDoNivel, TEXTO_POR_NIVEL, Explicacao } from '../components/ui'
import { METRICAS } from '../lib/metricas.js'
import LinhaEvolucao from '../components/LinhaEvolucao.jsx'
import DesempenhoRecente from '../components/perfil/DesempenhoRecente.jsx'
import MapaAtividade from '../components/perfil/MapaAtividade.jsx'
import PontosFortes from '../components/perfil/PontosFortes.jsx'
import Rivalidades from '../components/perfil/Rivalidades.jsx'
import DuelosAbertura from '../components/perfil/DuelosAbertura.jsx'
import FiltroPeriodo from '../components/FiltroPeriodo.jsx'
import TagEstilo from '../components/TagEstilo.jsx'
import PosicionamentoAgregado from '../components/PosicionamentoAgregado.jsx'
import CardClipe from '../components/CardClipe.jsx'
import { useAuth } from '../auth/AuthContext.jsx'

// Stat compacto pro card mobile de partida (padrão do CardJogador em Ranking.jsx).
// `rating` (se passado) desenha um badge verde/vermelho estilo FACEIT (>= 1.0 / < 1.0).
function Stat({ rotulo, valor, cor, rating, metrica }) {
  return (
    <div className="min-w-0">
      <div className="rotulo"><Explicacao metrica={metrica}>{rotulo}</Explicacao></div>
      {rating !== undefined ? (
        <RatingBadge valor={rating} className="text-sm" />
      ) : (
        <div className={`truncate text-sm font-semibold tabular-nums ${cor ?? 'text-texto'}`}>{valor}</div>
      )}
    </div>
  )
}

// Hero de rating de comunidade (Premier / FACEIT) — o "ponto" do jogador em destaque
// de verdade, não só um chip no header: número grande na cor da faixa, saldo das
// últimas partidas e a linha de evolução. Some inteiro quando não há valor (mesma
// regra dos badges: quem nunca jogou Premier/FACEIT não vê "sem dado" ocupando espaço).
function CardRatingComunidade({ rotulo, icone, corValor, valor, chipExtra, evolucao, metrica }) {
  if (valor == null) return null
  // Saldo do período coberto pela evolução (último − primeiro), não da última partida só.
  const delta = evolucao.length >= 2 ? Math.round(evolucao[evolucao.length - 1].valor - evolucao[0].valor) : null
  return (
    <Card className="relative p-5">
      <div className="rotulo flex items-center gap-2">
        {icone}
        <Explicacao metrica={metrica}>{rotulo}</Explicacao>
      </div>
      <div className="mt-1.5 flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <span className={`font-display text-5xl font-semibold leading-none tabular-nums display-tight ${corValor}`}>
          {Math.round(valor)}
        </span>
        {chipExtra}
        {delta != null && delta !== 0 && (
          <span className={`font-mono text-sm font-semibold tabular-nums ${delta > 0 ? 'text-sucesso' : 'text-perigo'}`}>
            {delta > 0 ? '+' : ''}{delta}
            <span className="ml-1 font-normal text-texto-fraco">nas últimas {evolucao.length} partidas</span>
          </span>
        )}
      </div>
      {evolucao.length >= 2 && (
        <div className="mt-3">
          <LinhaEvolucao
            pontos={evolucao.map((e) => ({ label: dataHora(e.playedAt), valor: e.valor }))}
            formatoValor={(v) => String(Math.round(v))}
          />
        </div>
      )}
    </Card>
  )
}

// Kinds de highlight que contam como "clutch" no resumo agrupado (CLUTCH_1V1, CLUTCH_1V2, CLUTCH_1V3...).
// O Coletor grava o kind em minúsculas (ace, clutch_1v2); comparar em maiúsculas deixava
// todo Badge neutro e cada clutch_1vN num grupo próprio.
const CLUTCH_PREFIX = 'CLUTCH_'
const TOM_KIND = { ACE: 'destaque', QUAD: 'destaque', TRIPLE: 'sucesso' }
function tomDoKind(kind) {
  const k = String(kind ?? '').toUpperCase()
  if (k.startsWith(CLUTCH_PREFIX)) return 'sucesso'
  return TOM_KIND[k] ?? 'neutro'
}
function grupoDoKind(kind) {
  return String(kind ?? '').toUpperCase().startsWith(CLUTCH_PREFIX) ? 'Clutch' : rotuloHighlight(kind)
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
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <Abas
          rotulo="Filtrar highlights por tipo"
          valor={filtroTipo ?? ''}
          onChange={(v) => aplicarFiltroTipo(v === '' ? null : v)}
          className="max-w-full flex-wrap"
          itens={[
            { valor: '', rotulo: 'Todos', contagem: ordenados.length },
            ...[...contagemPorGrupo.entries()].map(([grupo, qtd]) => ({ valor: grupo, rotulo: grupo, contagem: qtd })),
          ]}
        />

        {mapasDisponiveis.length > 1 && (
          <Select
            value={filtroMapa}
            onChange={(e) => {
              setFiltroMapa(e.target.value)
              setLimite(LIMITE_INICIAL_DESTAQUES)
            }}
            selectClassName="text-xs"
          >
            <option value="">Todos os mapas</option>
            {mapasDisponiveis.map((m) => (
              <option key={m} value={m}>{nomeMapa(m)}</option>
            ))}
          </Select>
        )}
      </div>

      {filtrados.length === 0 && <EstadoVazio titulo="Nenhum highlight com esse filtro." />}

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
                <Badge tom={tomDoKind(d.kind)}>{rotuloHighlight(d.kind)}</Badge>
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
              <Button variante="secundario" onClick={() => setLimite((l) => l + LIMITE_INICIAL_DESTAQUES)}>
                Carregar mais ({filtrados.length - visiveis.length})
              </Button>
            </div>
          )}
        </>
      )}
    </section>
  )
}

// Seção de Clipes do perfil — prévia dos 6 melhores (por pontuação, backend já ordena e
// limita), reusando o CardClipe da aba Clipes; "Ver todos" abre a aba já filtrada nele.
function SecaoClipes({ clipes, steamId, viewerSteamId }) {
  const [clipeAberto, setClipeAberto] = useState(null)
  return (
    <section>
      <SectionHeader
        titulo="Clipes"
        acao={
          <Link
            to={`/clipes?jogador=${steamId}`}
            className={classesBotao({ variante: 'fantasma', tamanho: 'sm' })}
          >
            Ver todos →
          </Link>
        }
      />
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {clipes.map((c) => (
          <CardClipe key={c.id} clipe={c} aberto={clipeAberto === c.id} onAbrir={setClipeAberto} viewerSteamId={viewerSteamId} />
        ))}
      </div>
    </section>
  )
}

export default function JogadorPerfil() {
  const { steamId } = useParams()
  const navegar = useNavigate()
  const { jogador: viewer } = useAuth()
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

  if (erro) return <EstadoErro mensagem="Jogador não encontrado." />
  if (!data) {
    return (
      <div className="space-y-6" role="status" aria-label="Carregando perfil">
        <div className="flex items-center gap-4">
          <Skeleton className="panel-cut h-20 w-20 shrink-0" />
          <div className="flex-1 space-y-2">
            <Skeleton className="h-8 w-56" />
            <Skeleton className="h-4 w-40" />
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
          {Array.from({ length: 6 }, (_, i) => <Skeleton key={i} className="panel-cut h-24" />)}
        </div>
        <SkeletonLista linhas={5} altura="h-14" rotulo="Carregando perfil" />
      </div>
    )
  }

  const { jogador, stats, porMapa, recentes, sinergia, evolucao, badges, estilo, destaques, armas, economia, premierAtual } = data
  const clipes = data.clipes ?? []
  // ?? []/null: payloads antigos em cache (ou fixtures de teste) podem não ter os campos novos.
  const evolucaoPremier = data.evolucaoPremier ?? []
  const evolucaoFaceit = data.evolucaoFaceit ?? []
  const faceitEloAtual = data.faceitEloAtual ?? jogador.faceitElo ?? null
  const nivelFaceit = faceitEloAtual != null ? (jogador.faceitSkillLevel ?? nivelDoElo(faceitEloAtual)) : null

  return (
    <div className="space-y-8">
      {/* 1. Header — avatar, nick, badges/estilo (pequenos, ficam aqui mesmo) e filtro de período. */}
      <header className="flex flex-col gap-5 border-b border-borda pb-6 lg:flex-row lg:items-end lg:justify-between">
        <div className="flex min-w-0 items-center gap-4 sm:gap-5">
          <Avatar p={jogador} size={80} />
          <div className="min-w-0">
            <div className="rotulo mb-1.5">Jogador</div>
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="truncate font-display text-3xl font-semibold leading-none text-texto sm:text-5xl">
                {jogador.nick || jogador.steamId}
              </h2>
              <TagEstilo estilo={estilo} />
              {/* Premier/FACEIT saíram daqui de propósito: viraram o hero logo abaixo
                  (CardRatingComunidade) — o mesmo número duas vezes na mesma dobra é ruído. */}
            </div>
            <p className="mt-2 font-mono text-sm text-texto-fraco">
              <span className="tabular-nums text-texto">{stats.partidas}</span> partidas ·{' '}
              <span className="tabular-nums text-texto">{stats.winrate}%</span> de vitória
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-3 lg:gap-4">
          <FiltroPeriodo de={de} ate={ate} onDe={setDe} onAte={setAte} />
          {/* Perfis externos: Steam sempre existe (o id é o steam_id64); FACEIT só pra
              quem vinculou a conta — sem chip "sem dado" pra quem nunca vinculou. */}
          <a
            href={`https://steamcommunity.com/profiles/${jogador.steamId}`}
            target="_blank"
            rel="noreferrer"
            title="Abrir perfil na Steam"
            aria-label="Abrir perfil na Steam"
            className={classesBotao({ variante: 'secundario', tamanho: 'icone' })}
          >
            <SteamIcon className="h-4 w-4" />
          </a>
          {jogador.faceitNick && (
            <a
              href={`https://www.faceit.com/en/players/${encodeURIComponent(jogador.faceitNick)}`}
              target="_blank"
              rel="noreferrer"
              title={`Abrir perfil na FACEIT (${jogador.faceitNick})`}
              aria-label="Abrir perfil na FACEIT"
              className={classesBotao({ variante: 'secundario', tamanho: 'icone' })}
            >
              <FaceitIcon className="h-4 w-4" />
            </a>
          )}
          <Link
            to={`/comparar?a=${jogador.steamId}`}
            className={classesBotao({ variante: 'secundario' })}
          >
            Comparar com…
          </Link>
        </div>
      </header>

      {/* 1b. Hero de rating de comunidade — o ponto do Premier e o ELO da FACEIT em
          destaque, antes dos tiles (é o número que a resenha mais cita). */}
      {(premierAtual != null || faceitEloAtual != null) && (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <CardRatingComunidade
            rotulo="Premier — CS Rating"
            icone={<SteamIcon className="h-3.5 w-3.5 shrink-0" />}
            corValor={premierAtual != null ? faixaPremier(premierAtual).cor : ''}
            valor={premierAtual}
            evolucao={evolucaoPremier}
            metrica={METRICAS.premier}
          />
          <CardRatingComunidade
            rotulo="FACEIT — ELO"
            icone={<FaceitIcon className="h-3.5 w-3.5 shrink-0" />}
            corValor={nivelFaceit != null ? (TEXTO_POR_NIVEL[nivelFaceit] ?? TEXTO_POR_NIVEL[1]) : ''}
            valor={faceitEloAtual}
            chipExtra={nivelFaceit != null && (
              <span className={`panel-cut-sm border px-2 py-0.5 font-mono text-xs font-bold ${corChipDoNivel(nivelFaceit)}`}>
                Nível {nivelFaceit}
              </span>
            )}
            evolucao={evolucaoFaceit}
            metrica={METRICAS.faceitElo}
          />
        </div>
      )}

      {/* 2. Tiles de stats principais — o que mais se consulta de cara. */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <StatTile
          rotulo="Rating"
          valor={stats.rating?.toFixed(2) ?? '–'}
          tom={stats.rating == null ? 'neutro' : stats.rating >= 1.15 ? 'sucesso' : stats.rating <= 0.85 ? 'perigo' : 'neutro'}
          metrica={METRICAS.ratingPeriodo}
        />
        <StatTile rotulo="K/D" valor={stats.kd} metrica={METRICAS.kd} />
        <StatTile rotulo="ADR" valor={stats.adr} metrica={METRICAS.adrPeriodo} />
        <StatTile rotulo="HS%" valor={`${stats.hsPct}%`} metrica={METRICAS.hsPeriodo} />
        <StatTile
          rotulo="Vitórias"
          valor={`${stats.vitorias}/${stats.partidas}`}
          sub={`${stats.winrate}%`}
          metrica={{ ...METRICAS.winrate, nome: 'Vitórias', texto: 'Em cima: vitórias / partidas jogadas. Embaixo: winrate, vitórias ÷ (vitórias + derrotas). Empate não entra no %.' }}
        />
        <StatTile rotulo="Kills" valor={stats.kills} sub={`${stats.deaths} deaths`} metrica={METRICAS.killsTotal} />
      </div>

      {/* 2b. Desempenho recente (gráfico das últimas 30) + mapa de atividade, e os
          pontos fortes contra o grupo — referência FACEIT/Leetify. */}
      <div className="grid gap-3 xl:grid-cols-[minmax(0,1fr)_340px]">
        <DesempenhoRecente evolucao={evolucao} />
        <MapaAtividade atividade={data.atividade ?? []} />
      </div>
      <PontosFortes pontos={data.pontosFortes ?? []} proprio={viewer?.steamId === jogador.steamId} />
      <Rivalidades steamId={jogador.steamId} proprio={viewer?.steamId === jogador.steamId} />
      <DuelosAbertura steamId={jogador.steamId} />

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
        <SectionHeader titulo="Partidas recentes" />
        {recentes.length === 0 && <EstadoVazio titulo="Nenhuma partida ainda." />}

        {recentes.length > 0 && (
          <>
            {/* Mobile: cards no padrão do Ranking (badge V/D + grade de stats) */}
            <div className="space-y-2 lg:hidden">
              {recentes.map((r, i) => {
                const kd = r.deaths > 0 ? (r.kills / r.deaths).toFixed(2) : r.kills.toFixed(2)
                // "?" só no 1º card: repetir em cada partida vira ruído.
                const explica = i === 0
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
                      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                        <span
                          className={`panel-cut-sm px-1.5 py-0.5 text-[11px] font-semibold ${
                            r.won === true ? 'bg-sucesso/15 text-sucesso' : r.won === false ? 'bg-perigo/15 text-perigo' : 'bg-superficie-alta text-texto-fraco'
                          }`}
                        >
                          {r.won === true ? 'V' : r.won === false ? 'D' : '—'}
                        </span>
                        <span className="font-display text-lg font-semibold tabular-nums text-texto">{r.scoreA} : {r.scoreB}</span>
                        <MapIcon map={r.map} size={18} />
                        <span className="min-w-0 truncate font-mono text-xs text-texto-fraco">{nomeMapa(r.map)}</span>
                        <PlataformaBadge source={r.source} className="shrink-0" />
                      </div>
                      <div className="mt-2 grid grid-cols-4 gap-2">
                        <Stat rotulo="Rating" valor={r.rating != null ? r.rating.toFixed(2) : '–'} rating={r.rating} metrica={explica ? METRICAS.rating : null} />
                        <Stat rotulo="K/D/A" valor={`${r.kills}/${r.deaths}/${r.assists}`} metrica={explica ? METRICAS.kda : null} />
                        <Stat rotulo="K/D" valor={kd} cor={Number(kd) >= 1 ? 'text-sucesso' : 'text-perigo'} metrica={explica ? METRICAS.kd : null} />
                        <Stat rotulo="ADR" valor={r.adr} metrica={explica ? METRICAS.adr : null} />
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
                    <th className="px-2 py-2 text-right"><Explicacao metrica={METRICAS.rating}>Rating</Explicacao></th>
                    <th className="px-2 py-2 text-right"><Explicacao metrica={METRICAS.kda}>K/D/A</Explicacao></th>
                    <th className="px-2 py-2 text-right"><Explicacao metrica={METRICAS.kd}>K/D</Explicacao></th>
                    <th className="hidden px-2 py-2 text-right xl:table-cell"><Explicacao metrica={METRICAS.adr}>ADR</Explicacao></th>
                    <th className="hidden px-2 py-2 text-right xl:table-cell"><Explicacao metrica={METRICAS.hs}>HS%</Explicacao></th>
                    <th className="px-3 py-2">Mapa</th>
                  </tr>
                }
              >
                {recentes.map((r) => {
                  const kd = r.deaths > 0 ? (r.kills / r.deaths).toFixed(2) : r.kills.toFixed(2)
                  return (
                    <tr
                      key={r.id}
                      className="cursor-pointer"
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
                            className={`panel-cut-sm px-1.5 py-0.5 text-[11px] font-semibold ${
                              r.won === true ? 'bg-sucesso/15 text-sucesso' : r.won === false ? 'bg-perigo/15 text-perigo' : 'bg-superficie-alta text-texto-fraco'
                            }`}
                          >
                            {r.won === true ? 'V' : r.won === false ? 'D' : '—'}
                          </span>
                          <span className="font-display font-semibold tabular-nums text-texto">{r.scoreA} : {r.scoreB}</span>
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
                          <PlataformaBadge source={r.source} className="shrink-0" />
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

      {/* 4b. Clipes — prévia dos melhores momentos em vídeo, reusando o card da aba Clipes. */}
      {clipes.length > 0 && <SecaoClipes clipes={clipes} steamId={jogador.steamId} viewerSteamId={viewer?.steamId} />}

      {/* 5. Armas. */}
      <section>
        <SectionHeader titulo="Armas" />
        {armas.length === 0 && <EstadoVazio titulo="Sem dados de arma ainda." />}
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
                <div className="h-1.5 overflow-hidden bg-fundo">
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
        {porMapa.length === 0 && <EstadoVazio titulo="Sem dados por mapa ainda." />}
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
        {sinergia.length === 0 && <EstadoVazio titulo="Sem duplas registradas ainda." />}
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
                <Avatar p={s} size={32} />
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
                metrica={METRICAS.precisao}
              />
              <StatTile
                rotulo="Dano utilitária"
                valor={stats.utilityDamagePerRound}
                sub="dano de granada / round"
                metrica={METRICAS.danoUtilRound}
              />
              <StatTile
                rotulo="Entry (1º duelo)"
                valor={`${stats.entryKills}/${duelosEntry}`}
                sub={`${entryPct}% vencidos`}
                metrica={METRICAS.entryDuelo}
              />
              <StatTile
                rotulo="Trades"
                valor={stats.tradeKills}
                sub={`${stats.tradedDeaths} mortes suas vingadas`}
                metrica={METRICAS.tradesPeriodo}
              />
              <StatTile
                rotulo="Clutch (1vX)"
                valor={`${stats.clutchWins}/${stats.clutchAttempts}`}
                sub={`${stats.clutchPct}% vencidos${stats.clutchSaves ? ` · ${stats.clutchSaves} save` : ''}`}
                metrica={METRICAS.clutch}
              />
            </div>
          )
        })()}
        <p className="mt-3 font-mono text-xs leading-relaxed text-texto-fraco">
          Como medimos — <span className="text-texto">Precisão</span>: tiros certos ÷ disparados (só armas de fogo).{' '}
          <span className="text-texto">Entry</span>: o 1º duelo de cada round, vencidos/disputados.{' '}
          <span className="text-texto">Trades</span>: kill em até 5s vingando um colega que acabou de morrer.{' '}
          <span className="text-texto">Clutch</span>: por último vivo contra 1+, vencidos/total.{' '}
          Em todo o site, <span className="text-texto">X/Y = sucessos/total</span>. Toque no ? de cada card pra mais detalhe.
        </p>
      </section>

      <section>
        <SectionHeader titulo="Utilitária" />
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-8">
          <StatTile
            rotulo="Smokes"
            valor={stats.smokesThrown}
            metrica={METRICAS.smokesPeriodo}
          />
          <StatTile
            rotulo="Flashes"
            valor={stats.flashesThrown}
            sub={`${stats.enemiesFlashedPerFlash} inimigo/flash`}
            metrica={METRICAS.flashesPeriodo}
          />
          <StatTile
            rotulo="Flash assist"
            valor={stats.flashAssists}
            sub={`${stats.flashAssistPct}% das flashes`}
            metrica={METRICAS.flashAssistPeriodo}
          />
          <StatTile
            rotulo="HEs"
            valor={stats.heThrown}
            sub={`${stats.avgHeDamage} dano/HE`}
            metrica={METRICAS.hesPeriodo}
          />
          <StatTile
            rotulo="Molotov/Incend."
            valor={stats.molotovsThrown}
            sub={`${stats.avgMolotovDamage} dano/molotov`}
            metrica={METRICAS.molotovsPeriodo}
          />
          <StatTile
            rotulo="Cegou inimigo"
            valor={stats.enemiesFlashed}
            sub={`${stats.avgBlindDuration}s em média`}
            metrica={METRICAS.cegouInimigoPeriodo}
          />
          <StatTile
            rotulo="Cegou aliado"
            valor={stats.teammatesFlashed}
            sub={`${stats.teammateFlashDuration}s no total`}
            tom={stats.teammatesFlashed > 0 ? 'perigo' : 'neutro'}
            metrica={METRICAS.cegouAliadoPeriodo}
          />
          <StatTile
            rotulo="Fogo amigo (HE+fogo)"
            valor={stats.heTeamDamage + stats.molotovTeamDamage}
            tom={(stats.heTeamDamage + stats.molotovTeamDamage) > 0 ? 'perigo' : 'neutro'}
            metrica={METRICAS.fogoAmigoUtil}
          />
        </div>
      </section>

      <section>
        <SectionHeader titulo={<>Economia <span className="text-texto-fraco">— winrate por tipo de compra</span></>} />
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
          {Object.entries(economia ?? {}).map(([tipo, e]) => (
            <Card key={tipo} className="p-3">
              <div className={`font-mono text-xs ${TIPO_COMPRA[tipo]?.cor ?? 'text-texto-fraco'}`}>
                <Explicacao metrica={{ ...METRICAS.economia, nome: TIPO_COMPRA[tipo]?.label ?? tipo }}>
                  {TIPO_COMPRA[tipo]?.label ?? tipo}
                </Explicacao>
              </div>
              <div className="mt-1 font-display text-xl font-semibold text-texto">
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
