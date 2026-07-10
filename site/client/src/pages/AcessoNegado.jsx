export default function AcessoNegado() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4 px-6 text-center">
      <p className="font-mono text-xs uppercase tracking-[0.35em] text-perigo">Acesso negado</p>
      <h1 className="font-display text-3xl font-bold uppercase tracking-wide text-texto">Fora da whitelist</h1>
      <p className="max-w-sm font-mono text-sm text-texto-fraco">
        Sua conta Steam não está na whitelist. Pede pra um admin do grupo te adicionar.
      </p>
    </div>
  )
}
