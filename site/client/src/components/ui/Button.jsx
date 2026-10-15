import { forwardRef } from 'react'

// Botão padrão do site. Antes cada tela escrevia a mesma string de classes à mão
// (mais de 10 variações com padding, tracking e hover divergindo). Aqui mora o
// vocabulário inteiro: variante (papel do botão) × tamanho. `as` deixa usar com
// <Link>/<a> sem perder o visual.
const VARIANTES = {
  primario:
    'bg-destaque text-sobre-destaque border border-destaque hover:bg-destaque-forte hover:border-destaque-forte active:scale-[0.98]',
  secundario:
    'border border-borda-forte bg-superficie-alta text-texto hover:bg-superficie-topo hover:border-[#3a3a41] active:scale-[0.98]',
  contorno:
    'border border-destaque/40 bg-destaque/10 text-destaque hover:bg-destaque/15 hover:border-destaque/60 active:scale-[0.98]',
  fantasma:
    'border border-transparent text-texto-fraco hover:bg-superficie-alta hover:text-texto',
  perigo:
    'border border-perigo/30 bg-perigo/10 text-perigo hover:bg-perigo/15 hover:border-perigo/50 active:scale-[0.98]',
}

const TAMANHOS = {
  xs: 'h-8 px-2 text-xs gap-1 lg:h-7',
  sm: 'h-9 px-3 text-[13px] gap-1.5 lg:h-8',
  md: 'h-11 px-4 text-sm gap-2 lg:h-9',
  lg: 'h-12 px-5 text-[15px] gap-2 lg:h-11',
  icone: 'h-10 w-10 justify-center p-0 lg:h-9 lg:w-9',
}

export function classesBotao({ variante = 'secundario', tamanho = 'md', larguraTotal = false, className = '' } = {}) {
  return [
    'inline-flex shrink-0 cursor-pointer select-none items-center justify-center rounded-[var(--radius-pequeno)]',
    'font-sans font-medium whitespace-nowrap',
    'transition-[background-color,border-color,color,transform] duration-150',
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
