// Tile de estatística no padrão FACEIT/perfil: rótulo mono em cima, valor grande, sub opcional.
import Card from './Card.jsx'
import Explicacao from './Explicacao.jsx'

// `tom` aqui é só o julgamento do valor numérico (bom/ruim/neutro) — por isso o
// vocabulário é um subconjunto do TONS de Badge.jsx (que também tem 'destaque', pra
// marcar categoria/tag, não resultado). StatTile nunca precisou de 'destaque' até hoje;
// se algum dia precisar, adiciona aqui em vez de reusar o de Badge (mesmo fallback
// silencioso pra neutro que Badge usa, pra nunca quebrar com um tom desconhecido).
const TONS = {
  sucesso: 'text-sucesso',
  perigo: 'text-perigo',
  neutro: 'text-texto',
}

// `metrica` ({ nome?, texto, unidade?, sentido? }, de lib/metricas.js) vira o "?" clicável
// do rótulo. O `title` nativo só aparecia no hover e sumia no celular.
export default function StatTile({ rotulo, valor, sub, metrica, tom = 'neutro', className = '', ...props }) {
  const corValor = TONS[tom] ?? TONS.neutro
  return (
    <Card className={`relative p-4 ${className}`.trim()} {...props}>
      <div className="break-words rotulo [overflow-wrap:anywhere]">
        <Explicacao metrica={metrica && { ...metrica, nome: rotulo }}>{rotulo}</Explicacao>
      </div>
      <div className={`mt-2 break-words font-mono text-2xl font-medium leading-none tabular-nums display-tight ${corValor}`}>{valor}</div>
      {sub != null && <div className="mt-0.5 font-mono text-xs text-texto-fraco">{sub}</div>}
    </Card>
  )
}
