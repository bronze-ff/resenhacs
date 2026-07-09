export default function AcessoNegado() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4">
      <h1 className="text-2xl font-bold">Acesso restrito</h1>
      <p className="text-texto-fraco">
        Sua conta Steam não está na whitelist. Pede pra um admin do grupo te adicionar.
      </p>
    </div>
  )
}
