import { forwardRef } from 'react'

// Botão padrão do site. Antes cada tela escrevia a mesma string de classes à mão
// (mais de 10 variações de "panel-cut-sm border-destaque bg-destaque px-4 py-2 …"
// com padding, tracking e hover divergindo). Aqui mora o vocabulário inteiro:
// variante (papel do botão) × tamanho. `as` deixa usar com <Link>/<a> sem perder o
// visual. O corte diagonal fica, mas só no canto superior direito (panel-cut-tr):
// dois cortes num elemento de 40px de altura pesavam demais.
const VARIANTES = {
  primario:
    'bg-destaque text-fundo hover:bg-destaque-forte hover:shadow-acento active:translate-y-px border border-destaque',
  secundario:
    'border border-borda-forte bg-superficie-alta text-texto hover:border-texto-fraco/60 hover:bg-superficie-topo',
  contorno:
    'border border-destaque/60 bg-destaque/5 text-destaque hover:border-destaque hover:bg-destaque/10',
  fantasma:
    'border border-transparent text-texto-fraco hover:bg-superficie-alta hover:text-texto',
  perigo:
    'border border-perigo/40 bg-perigo/5 text-perigo hover:border-perigo/70 hover:bg-perigo/10',
}

const TAMANHOS = {
  sm: 'min-h-9 px-3 text-xs gap-1.5 lg:min-h-8',
  md: 'min-h-11 px-4 text-sm gap-2 lg:min-h-10',
  lg: 'min-h-12 px-6 text-base gap-2.5',
  icone: 'min-h-10 min-w-10 justify-center p-0',
}

export function classesBotao({ variante = 'secundario', tamanho = 'md', larguraTotal = false, className = '' } = {}) {
  return [
    'panel-cut-tr inline-flex shrink-0 cursor-pointer select-none items-center justify-center',
    'font-display font-semibold uppercase tracking-[0.06em] whitespace-nowrap',
    'transition-[background-color,border-color,color,box-shadow,transform] duration-200',
    'disabled:pointer-events-none disabled:opacity-45 aria-disabled:pointer-events-none aria-disabled:opacity-45',
    VARIANTES[variante] ?? VARIANTES.secundario,
    TAMANHOS[tamanho] ?? TAMANHOS.md,
    larguraTotal ? 'w-full' : '',
    className,
  ]
    .filter(Boolean)
    .join(' ')
}

function Spinner() {
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4 animate-spin" aria-hidden="true">
      <circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" strokeOpacity="0.25" strokeWidth="3" />
      <path d="M21 12a9 9 0 0 0-9-9" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  )
}

const Button = forwardRef(function Button(
  {
    as: Comp = 'button',
    variante = 'secundario',
    tamanho = 'md',
    larguraTotal = false,
    carregando = false,
    icone = null,
    iconeDireita = null,
    className = '',
    children,
    disabled,
    ...props
  },
  ref,
) {
  const extra = Comp === 'button' ? { type: props.type ?? 'button', disabled: disabled || carregando } : {}
  return (
    <Comp
      ref={ref}
      className={classesBotao({ variante, tamanho, larguraTotal, className })}
      aria-busy={carregando || undefined}
      {...props}
      {...extra}
    >
      {carregando ? <Spinner /> : icone}
      {children}
      {iconeDireita}
    </Comp>
  )
})

export default Button
