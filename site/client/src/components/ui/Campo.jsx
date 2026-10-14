import { forwardRef, useId } from 'react'

// Campos de formulário padronizados. Mesma casca visual do trigger do Select
// (borda, fundo afundado, foco no destaque) pra input, textarea e o próprio Select
// conviverem lado a lado sem parecerem de famílias diferentes.
export const classeEntrada =
  'w-full min-h-11 border border-borda bg-fundo/70 px-3 py-2 text-sm text-texto placeholder:text-texto-fraco/60 transition-colors duration-200 hover:border-borda-forte focus:border-destaque focus:outline-none focus-visible:outline-none disabled:opacity-50 lg:min-h-10'

export function Campo({ rotulo, ajuda = null, erro = null, htmlFor, className = '', children }) {
  return (
    <div className={`flex flex-col gap-1.5 ${className}`}>
      {rotulo && (
        <label htmlFor={htmlFor} className="rotulo">
          {rotulo}
        </label>
      )}
      {children}
      {erro ? (
        <p className="text-xs text-perigo">{erro}</p>
      ) : (
        ajuda && <p className="text-xs text-texto-fraco">{ajuda}</p>
      )}
    </div>
  )
}

export const Input = forwardRef(function Input({ rotulo, ajuda, erro, id, className = '', campoClassName = '', ...props }, ref) {
  const idAuto = useId()
  const idFinal = id ?? idAuto
  const entrada = <input ref={ref} id={idFinal} className={`${classeEntrada} ${erro ? 'border-perigo/60' : ''} ${className}`} {...props} />
  if (!rotulo && !ajuda && !erro) return entrada
  return (
    <Campo rotulo={rotulo} ajuda={ajuda} erro={erro} htmlFor={idFinal} className={campoClassName}>
      {entrada}
    </Campo>
  )
})

export const Textarea = forwardRef(function Textarea({ rotulo, ajuda, erro, id, className = '', campoClassName = '', ...props }, ref) {
  const idAuto = useId()
  const idFinal = id ?? idAuto
  const entrada = <textarea ref={ref} id={idFinal} className={`${classeEntrada} min-h-24 resize-y ${className}`} {...props} />
  if (!rotulo && !ajuda && !erro) return entrada
  return (
    <Campo rotulo={rotulo} ajuda={ajuda} erro={erro} htmlFor={idFinal} className={campoClassName}>
      {entrada}
    </Campo>
  )
})
