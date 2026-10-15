import { useState } from 'react'
import { Link } from 'react-router-dom'
import { nomeMapa, dataHora, origemPartida, corRating } from '../../lib/format.js'
import { orientarPlacar } from '../../lib/resultado.js'
import { Avatar, Badge, Card, MapIcon, PlataformaBadge } from '../ui'

// Card de Partida do Feed (referência: Leetify). Metade esquerda é a "capa" — o radar
// do mapa esmaecido atrás do nome; metade direita são linhas de stat. Com o viewer em
// campo (`m.eu`), mostra o K/D/A e o rating DELE; Partida só de amigos mostra o grupo.

const ROTULO_RESULTADO = {
  vitoria: { texto: 'Vitória', classe: 'border-sucesso/40 bg-sucesso/10 text-sucesso' },
  derrota: { texto: 'Derrota', classe: 'border-perigo/40 bg-perigo/10 text-perigo' },
  empate: { texto: 'Empate', classe: 'border-borda-forte bg-superficie-alta text-texto-fraco' },
  misto: { texto: 'Grupo dividido', classe: 'border-borda-forte bg-superficie-alta text-texto-fraco' },
}

// Arte do mapa: o PNG do radar (já servido em /radars) esmaecido. Mapa sem radar
// (ex.: algum mapa novo) só some — o card continua com o fundo liso.
function CapaMapa({ map }) {
  const [erro, setErro] = useState(false)
  if (erro || !map) return null
  return (
    <img
      src={`/radars/${map}.png`}
      alt=""
      aria-hidden="true"
      onError={() => setErro(true)}
      className="pointer-events-none absolute -right-8 -top-1/3 w-[78%] max-w-none opacity-30"
    />
  )
}

function Rostos({ m, avatares }) {
  const t = m.tracked ?? []
  if (t.length === 0) return null
  const comAvatar = (p) => ({ ...p, avatarUrl: p.avatarUrl ?? avatares.get(p.steamId) ?? null })
  const extras = t.length - 5
  return (
    <span className="flex shrink-0 -space-x-1.5" title={t.map((p) => p.nick).join(', ')}>
      {t.slice(0, 5).map((p) => (
        <span key={p.steamId} className="rounded-[var(--radius-pequeno)] ring-2 ring-superficie">
          <Avatar p={comAvatar(p)} size={22} />
        </span>
      ))}
      {extras > 0 && (
        <span className="flex h-[22px] min-w-[22px] items-center justify-center rounded-[var(--radius-pequeno)] border border-borda bg-superficie-alta px-1 font-mono text-[11px] text-texto-fraco ring-2 ring-superficie">
          +{extras}
        </span>
      )}
    </span>
  )
}

function LinhaStat({ rotulo, children }) {
  return (
    <div className="flex h-11 items-center justify-between gap-3 border-t border-borda px-4 first:border-t-0">
      <span className="text-xs text-texto-fraco">{rotulo}</span>
      <span className="font-mono text-sm tabular-nums">{children}</span>
    </div>
  )
}

export default function CardPartidaFeed({ m, resultado, avatares }) {
  const origem = origemPartida(m.source, m.temDemo)
  const { a, b } = orientarPlacar(m.scoreA, m.scoreB, resultado)
  const r = ROTULO_RESULTADO[resultado]
  const eu = m.eu
  const corPlacar = resultado === 'vitoria' ? 'text-sucesso' : resultado === 'derrota' ? 'text-perigo' : 'text-texto'

  return (
    <Card as={Link} interativo to={`/partida/${m.id}`} className="block overflow-hidden">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-borda px-4 py-2.5">
        {r && <span className={`inline-flex h-5 items-center rounded-[var(--radius-pequeno)] border px-1.5 text-[11px] font-medium ${r.classe}`}>{r.texto}</span>}
        {dataHora(m.playedAt) && <span className="font-mono text-xs text-texto-fraco">{dataHora(m.playedAt)}</span>}
        <span className="ml-auto">
          <Rostos m={m} avatares={avatares} />
        </span>
      </div>
      <div className="grid sm:grid-cols-[minmax(0,1.25fr)_minmax(0,1fr)]">
        <div className="relative min-h-[132px] overflow-hidden bg-fundo/60">
          <CapaMapa map={m.map} />
          <div className="absolute inset-0 bg-gradient-to-r from-superficie via-superficie/80 to-superficie/20" aria-hidden="true" />
          <div className="relative flex h-full min-h-[132px] flex-col justify-between gap-3 p-4">
            <div className="flex min-w-0 flex-wrap items-center gap-2">
              <MapIcon map={m.map} size={32} />
              <span className="truncate font-display text-xl font-semibold text-texto">{nomeMapa(m.map)}</span>
              {m.source === 'pro' && <Badge tom="destaque">PRO</Badge>}
              <PlataformaBadge source={m.source} plataformaManual={m.plataformaManual} />
              <Badge tom="neutro" title={origem.title}>{origem.label}</Badge>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {m.mvp && (
                <Badge tom="neutro" className="!text-texto">
                  <span className="text-ouro" aria-hidden="true">★</span> MVP {m.mvp.nick}
                </Badge>
              )}
              {m.highlights > 0 && (
                <Badge tom="neutro" className="!text-texto">
                  {m.highlights} highlight{m.highlights === 1 ? '' : 's'}
                </Badge>
              )}
              {m.source === 'pro' && m.teamAName && m.teamBName && (
                <Badge tom="neutro" className="!text-texto">{m.teamAName} x {m.teamBName}</Badge>
              )}
            </div>
          </div>
        </div>
        <div className="border-t border-borda sm:border-l sm:border-t-0">
          <LinhaStat rotulo="Placar">
            <span className={corPlacar}>{a ?? '–'}</span>
            <span className="text-texto-fraco"> : </span>
            <span>{b ?? '–'}</span>
          </LinhaStat>
          {eu ? (
            <>
              <LinhaStat rotulo="Seu K / D / A">{eu.kills} / {eu.deaths} / {eu.assists}</LinhaStat>
              <LinhaStat rotulo="Seu rating">
                {eu.rating == null ? (
                  <span className="text-texto-fraco">–</span>
                ) : (
                  <span className={corRating(eu.rating)}>
                    {eu.rating.toFixed(2)}{' '}
                    <span className="text-[11px]" aria-label={eu.rating >= 1 ? 'acima de 1.00' : 'abaixo de 1.00'}>
                      {eu.rating >= 1 ? '↑' : '↓'}
                    </span>
                  </span>
                )}
              </LinhaStat>
            </>
          ) : (
            <>
              <LinhaStat rotulo="Do grupo">{(m.tracked ?? []).length || '–'}</LinhaStat>
              <LinhaStat rotulo="Rating do MVP">
                {m.mvp?.rating != null ? <span className={corRating(m.mvp.rating)}>{m.mvp.rating.toFixed(2)}</span> : <span className="text-texto-fraco">–</span>}
              </LinhaStat>
            </>
          )}
        </div>
      </div>
    </Card>
  )
}
