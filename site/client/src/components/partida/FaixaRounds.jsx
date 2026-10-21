import { Fragment } from 'react'
import { TIPO_COMPRA, rotuloHighlight } from '../../lib/format.js'

// Faixa de rounds da Partida: cada coluna é um round, com o equipamento do Time A
// crescendo pra cima e o do Time B pra baixo (a posição já diz o time), o número no meio
// e o resultado pro grupo (▲/▼ + cor). Clicar num round abre ele no Replay 2D.
// Intervalo (troca de lado) depois do round 12 e a cada 3 rounds no overtime (MR3).

// Degraus neutros (mais claro = compra maior): verde e vermelho ficam só pra round ganho/perdido.
const COR_BARRA_COMPRA = {
  eco: 'bg-texto-fraco/20', forcado: 'bg-texto-fraco/45', semi: 'bg-texto/55', full: 'bg-texto/85',
}
const ALTURA = 52 // px de cada metade do gráfico

function fmtEquip(v) {
  if (v == null) return '–'
  if (v >= 1000) return `$${(v / 1000).toFixed(1)}k`
  return `$${v}`
}

const trocaLadoDepois = (rn) => rn === 12 || (rn > 24 && (rn - 24) % 3 === 0)

function Barra({ e, time, maior }) {
  const altura = e ? Math.max(4, (e.equipValue / maior) * ALTURA) : 4
  const borda = time === 'A' ? 'border-time-a/70' : 'border-time-b/70'
  return (
    <div
      title={e ? `Time ${time}: $${e.equipValue} (${TIPO_COMPRA[e.buyType]?.label ?? e.buyType})` : `Time ${time}: sem dado`}
      className={`w-3.5 border ${e ? `${COR_BARRA_COMPRA[e.buyType] ?? 'bg-borda'} ${borda}` : 'border-borda bg-borda'}`}
      style={{ height: altura }}
    />
  )
}

export default function FaixaRounds({ rounds, economia, highlights, timeDoGrupo, selecionado, onSelecionar, clicavel }) {
  if (!rounds?.length) return null
  const econ = new Map()
  for (const e of economia ?? []) econ.set(`${e.roundNumber}${e.team}`, e)
  const maior = Math.max(1, ...(economia ?? []).map((e) => e.equipValue))
  const temEcon = (economia ?? []).length > 0
  const hl = new Map()
  for (const h of highlights ?? []) hl.set(h.roundNumber, [...(hl.get(h.roundNumber) ?? []), h])

  return (
    <div className="panel-cut border border-borda bg-superficie realce-topo">
      <div className="overflow-x-auto px-3 py-3 sm:px-4">
        <div className="flex min-w-max items-stretch gap-1 lg:min-w-0">
          {rounds.map((r) => {
            const rn = r.roundNumber
            const a = econ.get(`${rn}A`)
            const b = econ.get(`${rn}B`)
            const doGrupo = timeDoGrupo ? r.winnerTeam === timeDoGrupo : null
            const momentos = hl.get(rn) ?? []
            const ativo = selecionado === rn
            const resultado = doGrupo === true ? 'vencido pelo seu time' : doGrupo === false ? 'perdido pelo seu time' : `vencido pelo Time ${r.winnerTeam ?? '?'}`
            const rotulo = `Round ${rn}, ${resultado}${momentos.length ? `, ${momentos.map((h) => rotuloHighlight(h.kind)).join(', ')}` : ''}`
            const chip = (
              <span
                className={`relative flex h-10 w-full flex-col items-center justify-center rounded-[var(--radius-pequeno)] border font-mono text-[11px] tabular-nums transition-colors ${
                  doGrupo === true ? 'border-sucesso/50 bg-sucesso/10' : doGrupo === false ? 'border-perigo/40 bg-perigo/5' : 'border-borda bg-superficie-alta'
                } ${ativo ? 'outline outline-2 outline-offset-1 outline-destaque' : ''} ${
                  r.winnerTeam === 'A' ? 'shadow-[inset_0_2px_0_var(--color-time-a)]' : r.winnerTeam === 'B' ? 'shadow-[inset_0_-2px_0_var(--color-time-b)]' : ''
                }`}
              >
                <span className="text-texto">{rn}</span>
                <span className="flex h-2.5 items-center gap-0.5 text-[9px] leading-none" aria-hidden="true">
                  {doGrupo === true && <span className="text-sucesso">▲</span>}
                  {doGrupo === false && <span className="text-perigo">▼</span>}
                  {momentos.length > 0 && <span className="h-1.5 w-1.5 rounded-full bg-texto" />}
                </span>
              </span>
            )
            return (
              <Fragment key={rn}>
                <div className="flex w-9 shrink-0 flex-col items-center lg:w-auto lg:min-w-[30px] lg:flex-1">
                  {temEcon && (
                    <>
                      <span className="h-4 whitespace-nowrap font-mono text-[10px] tabular-nums text-time-a">{a ? fmtEquip(a.equipValue) : ''}</span>
                      <div className="flex w-full items-end justify-center" style={{ height: ALTURA }}><Barra e={a} time="A" maior={maior} /></div>
                    </>
                  )}
                  <div className="my-1 w-full">
                    {clicavel ? (
                      <button
                        type="button"
                        onClick={() => onSelecionar(rn)}
                        aria-pressed={ativo}
                        aria-label={`${rotulo}. Assistir no Replay 2D`}
                        title={`${rotulo}${r.winReason ? ` (${r.winReason})` : ''}. Clique para assistir.`}
                        className="block w-full cursor-pointer rounded-[var(--radius-pequeno)] hover:brightness-125"
                      >
                        {chip}
                      </button>
                    ) : (
                      <span title={rotulo} aria-label={rotulo} className="block">{chip}</span>
                    )}
                  </div>
                  {temEcon && (
                    <>
                      <div className="flex w-full items-start justify-center" style={{ height: ALTURA }}><Barra e={b} time="B" maior={maior} /></div>
                      <span className="h-4 whitespace-nowrap font-mono text-[10px] tabular-nums text-time-b">{b ? fmtEquip(b.equipValue) : ''}</span>
                    </>
                  )}
                </div>
                {trocaLadoDepois(rn) && rn !== rounds[rounds.length - 1].roundNumber && (
                  <div className="flex w-3 shrink-0 justify-center" title="Intervalo: os times trocam de lado">
                    <span className="w-px bg-borda-forte" aria-hidden="true" />
                    <span className="sr-only">Intervalo, troca de lado</span>
                  </div>
                )}
              </Fragment>
            )
          })}
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 border-t border-borda px-3 py-2 text-xs text-texto-fraco sm:px-4">
        {timeDoGrupo && (
          <>
            <span className="flex items-center gap-1"><span className="text-sucesso" aria-hidden="true">▲</span>seu time venceu</span>
            <span className="flex items-center gap-1"><span className="text-perigo" aria-hidden="true">▼</span>seu time perdeu</span>
          </>
        )}
        <span className="flex items-center gap-1.5"><span className="h-1.5 w-1.5 rounded-full bg-texto" aria-hidden="true" />Highlight</span>
        {temEcon && (
          <>
            <span className="text-texto-fraco/50" aria-hidden="true">|</span>
            <span>equipamento: Time A acima, Time B abaixo</span>
            {Object.entries(TIPO_COMPRA).map(([tipo, info]) => (
              <span key={tipo} className="flex items-center gap-1">
                <span className={`inline-block h-2 w-2 ${COR_BARRA_COMPRA[tipo]}`} aria-hidden="true" />
                {info.label}
              </span>
            ))}
          </>
        )}
        {clicavel && <span className="sm:ml-auto">Clique num round para assistir.</span>}
      </div>
    </div>
  )
}
