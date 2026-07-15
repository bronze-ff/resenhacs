// <select> nativo (mantém teclado, leitor de tela e o picker nativo do celular),
// só com a aparência padrão do navegador escondida (appearance-none) e trocada
// pelo visual do site — border/hover/focus na cor de destaque + seta customizada.
// Reusa em qualquer lugar que hoje tem um <select> cru; children são as <option>.
export default function Select({ className = '', selectClassName = '', children, ...props }) {
  return (
    <div className={`relative inline-block ${className}`}>
      <select
        {...props}
        className={`peer min-h-10 w-full cursor-pointer appearance-none rounded border border-borda bg-superficie py-2 pl-3 pr-9 font-mono text-sm text-texto transition-colors hover:border-destaque/60 focus:border-destaque focus:outline-none disabled:cursor-not-allowed disabled:opacity-50 lg:min-h-0 ${selectClassName}`}
      >
        {children}
      </select>
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        className="pointer-events-none absolute right-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-texto-fraco transition-colors peer-hover:text-destaque peer-focus:text-destaque"
        aria-hidden="true"
      >
        <path d="M6 9L12 15L18 9" />
      </svg>
    </div>
  )
}
