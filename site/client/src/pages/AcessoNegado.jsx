import { Button } from '../components/ui'

export default function AcessoNegado() {
  return (
    <div className="flex min-h-screen items-center justify-center px-6">
      <div className="panel-cut realce-topo relative flex max-w-md flex-col items-center gap-4 border border-borda bg-superficie px-8 py-12 text-center">
        <div className="absolute left-0 top-0 h-[2px] w-16 bg-perigo" aria-hidden="true" />
        <span className="panel-cut-sm flex h-14 w-14 items-center justify-center border border-perigo/40 bg-perigo/10 text-perigo">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className="h-6 w-6" aria-hidden="true">
            <rect x="5" y="11" width="14" height="10" />
            <path d="M8 11V7a4 4 0 0 1 8 0v4" />
          </svg>
        </span>
        <p className="rotulo !text-perigo">Acesso negado</p>
        <h1 className="font-display text-4xl font-semibold leading-none text-texto">Fora da whitelist</h1>
        <p className="text-sm leading-relaxed text-texto-fraco">
          Sua conta Steam não está na whitelist. Pede pra um admin do grupo te adicionar.
        </p>
        <Button as="a" href="/" variante="secundario" className="mt-2">Voltar ao início</Button>
      </div>
    </div>
  )
}
