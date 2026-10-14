// Cabeçalho do topo de cada página: eyebrow mono + título display grande + descrição
// opcional + ações à direita. SectionHeader continua sendo o título de SEÇÃO dentro
// da página; este é o H1 visual da tela.
export default function CabecalhoPagina({ titulo, eyebrow = null, descricao = null, acoes = null, className = '' }) {
  return (
    <header className={`mb-6 flex flex-col gap-4 border-b border-borda pb-5 sm:flex-row sm:items-end sm:justify-between ${className}`}>
      <div className="min-w-0">
        {eyebrow && (
          <div className="rotulo mb-1.5 flex items-center gap-2">
            <span className="h-px w-5 bg-destaque" aria-hidden="true" />
            {eyebrow}
          </div>
        )}
        <h2 className="font-display text-3xl font-bold uppercase leading-none tracking-wide text-texto sm:text-4xl">{titulo}</h2>
        {descricao && <p className="mt-2 max-w-2xl text-sm leading-relaxed text-texto-fraco">{descricao}</p>}
      </div>
      {acoes && <div className="flex shrink-0 flex-wrap items-center gap-2">{acoes}</div>}
    </header>
  )
}
