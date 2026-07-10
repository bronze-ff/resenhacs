// Gráfico de linha em SVG puro (sem lib externa — consistente com o ReplayViewer, que
// também é desenhado à mão). `pontos`: [{label, valor}], em ordem cronológica.
const LARGURA = 640
const ALTURA = 140
const PAD = 18

export default function LinhaEvolucao({ pontos, cor = 'var(--color-destaque)', formatoValor = (v) => v.toFixed(2) }) {
  if (!pontos || pontos.length === 0) {
    return <p className="font-mono text-sm text-texto-fraco">Sem partidas suficientes ainda.</p>
  }
  if (pontos.length === 1) {
    return (
      <p className="font-mono text-sm text-texto-fraco">
        Só uma partida registrada até agora ({formatoValor(pontos[0].valor)}) — o gráfico aparece a partir da 2ª.
      </p>
    )
  }

  const valores = pontos.map((p) => p.valor)
  const min = Math.min(...valores)
  const max = Math.max(...valores)
  const faixa = max - min || 1
  const passoX = (LARGURA - PAD * 2) / (pontos.length - 1)

  const xy = (i) => {
    const x = PAD + i * passoX
    const y = ALTURA - PAD - ((pontos[i].valor - min) / faixa) * (ALTURA - PAD * 2)
    return [x, y]
  }
  const linha = pontos.map((_, i) => xy(i).join(',')).join(' ')
  const media = valores.reduce((a, b) => a + b, 0) / valores.length
  const yMedia = ALTURA - PAD - ((media - min) / faixa) * (ALTURA - PAD * 2)

  return (
    <svg viewBox={`0 0 ${LARGURA} ${ALTURA}`} className="w-full" role="img" aria-label="Evolução ao longo do tempo">
      {/* grid horizontal simples */}
      {[0, 0.5, 1].map((f) => (
        <line
          key={f}
          x1={PAD} x2={LARGURA - PAD}
          y1={PAD + f * (ALTURA - PAD * 2)} y2={PAD + f * (ALTURA - PAD * 2)}
          stroke="var(--color-borda)" strokeWidth="1"
        />
      ))}
      {/* linha de média, tracejada */}
      <line x1={PAD} x2={LARGURA - PAD} y1={yMedia} y2={yMedia} stroke="var(--color-texto-fraco)" strokeWidth="1" strokeDasharray="3,3" />
      <polyline points={linha} fill="none" stroke={cor} strokeWidth="2" />
      {pontos.map((p, i) => {
        const [x, y] = xy(i)
        return <circle key={i} cx={x} cy={y} r="3" fill={cor}><title>{formatoValor(p.valor)}{p.label ? ` — ${p.label}` : ''}</title></circle>
      })}
      <text x={PAD} y={12} className="font-mono" fontSize="9" fill="var(--color-texto-fraco)">{formatoValor(max)}</text>
      <text x={PAD} y={ALTURA - 6} className="font-mono" fontSize="9" fill="var(--color-texto-fraco)">{formatoValor(min)}</text>
      <text x={LARGURA - PAD} y={12} textAnchor="end" className="font-mono" fontSize="9" fill="var(--color-texto-fraco)">
        média {formatoValor(media)}
      </text>
    </svg>
  )
}
