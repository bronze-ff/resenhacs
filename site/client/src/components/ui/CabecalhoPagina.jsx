// Cabeçalho do topo de cada página: eyebrow mono + título display grande + descrição
// opcional + ações à direita. SectionHeader continua sendo o título de SEÇÃO dentro
// da página; este é o H1 visual da tela.
export default function CabecalhoPagina({ titulo, eyebrow = null, descricao = null, acoes = null, className = '' }) {
  return (
    <header className={`mb-6 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between ${className}`}>
      <div className="min-w-0">
        {eyebrow && (
          <div className="rotulo mb-1">{eyebrow}</div>
        )}
        <h2 className="font-display text-2xl font-semibold leading-tight text-texto sm:text-[28px]">{titulo}</h2>
        {descricao && <p className="mt-1.5 max-w-2xl text-sm leading-relaxed text-texto-fraco">{descricao}</p>}
      </div>
      {acoes && <div className="flex shrink-0 flex-wrap items-center gap-2">{acoes}</div>}
    </header>
  )
}
