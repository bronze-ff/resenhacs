import { Button, classeEntrada } from './ui'

// Par de inputs de data (de → até) usado nos filtros de período do sistema.
// No mobile os dois inputs dividem a largura disponível (flex-1) em vez de quebrar
// linha em posições aleatórias (rótulo numa linha, seta sumida, data órfã na outra —
// visual quebrado real visto no Feed em 2026-07-24); no desktop segue inline compacto.
// Mesma casca dos outros campos (classeEntrada) + color-scheme dark pro ícone/popup
// nativo do calendário não sair branco.
const classeData = `${classeEntrada} min-w-0 flex-1 font-mono tabular-nums [color-scheme:dark] lg:w-36 lg:flex-none lg:px-2 lg:text-xs`

export default function FiltroPeriodo({ de, ate, onDe, onAte }) {
  return (
    <div className="flex w-full flex-wrap items-center gap-2 lg:w-auto">
      <span className="rotulo">Período</span>
      <div className="flex min-w-0 flex-1 items-center gap-2 lg:flex-none">
        <input
          type="date"
          value={de}
          onChange={(e) => onDe(e.target.value)}
          aria-label="Data inicial do período"
          className={classeData}
        />
        <span className="shrink-0 font-mono text-xs text-texto-fraco" aria-hidden="true">→</span>
        <input
          type="date"
          value={ate}
          onChange={(e) => onAte(e.target.value)}
          aria-label="Data final do período"
          className={classeData}
        />
      </div>
      {(de || ate) && (
        <Button
          variante="fantasma"
          tamanho="sm"
          onClick={() => {
            onDe('')
            onAte('')
          }}
        >
          limpar
        </Button>
      )}
    </div>
  )
}
