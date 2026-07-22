// Ícone + tom + rótulo por resultado — reforça o julgamento além da cor (Regra do
// Sinal Duplo do DESIGN.md). `null`/resultado desconhecido (ex.: Partida pro sem
// ninguém do grupo em campo) cai no chip neutro sem rótulo, só o placar cru.
const RESULTADOS = {
  vitoria: { bg: 'bg-sucesso/10', border: 'border-sucesso/40', texto: 'text-sucesso', rotulo: 'Vitória', path: 'M12 19V5M6 11l6-6 6 6' },
  derrota: { bg: 'bg-perigo/10', border: 'border-perigo/40', texto: 'text-perigo', rotulo: 'Derrota', path: 'M12 5v14M6 13l6 6 6-6' },
  empate: { bg: 'bg-superficie-alta', border: 'border-borda', texto: 'text-texto-fraco', rotulo: 'Empate', path: 'M5 12h14' },
  misto: { bg: 'bg-superficie-alta', border: 'border-borda', texto: 'text-texto-fraco', rotulo: 'Misto', path: null, title: 'O grupo jogou dividido nos dois times' },
}

// Chip de resultado preenchido (não side-stripe): ícone + rótulo + placar juntos, um
// único bloco de leitura em vez de badge-texto e placar separados. `size="normal"` pro
// cabeçalho de uma Partida (hero, mais peso); default "compacto" pra linha de lista
// (Feed). Mesmo vocabulário do PremierBadge (default sempre compacto, 'normal' pra
// destaque) — ver PremierBadge.jsx.
export default function ResultChip({ resultado, a, b, size = 'compacto' }) {
  const r = RESULTADOS[resultado]
  const grande = size === 'normal'
  return (
    <div
      title={r?.title}
      className={`panel-cut-sm flex shrink-0 items-center border ${grande ? 'gap-3 px-4 py-2' : 'gap-2.5 px-3 py-1.5'} ${r?.bg ?? 'bg-superficie-alta'} ${r?.border ?? 'border-borda'}`}
    >
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="3"
        strokeLinecap="round"
        strokeLinejoin="round"
        className={`${grande ? 'h-5 w-5' : 'h-4 w-4'} ${r?.texto ?? 'text-texto-fraco'}`}
        aria-hidden="true"
      >
        {r?.path ? <path d={r.path} /> : <circle cx="12" cy="12" r="7" />}
      </svg>
      <div>
        {r && (
          <div className={`font-mono font-bold uppercase tracking-wide ${grande ? 'text-xs' : 'text-[10px]'} ${r.texto}`}>
            {r.rotulo}
          </div>
        )}
        <div className={`font-display font-bold leading-none tabular-nums ${grande ? 'text-3xl' : 'text-lg'}`}>
          <span className={r?.texto ?? 'text-texto'}>{a ?? '–'}</span>
          <span className="text-texto-fraco">:{b ?? '–'}</span>
        </div>
      </div>
    </div>
  )
}
