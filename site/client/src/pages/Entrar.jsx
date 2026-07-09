export default function Entrar() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-6">
      <h1 className="text-4xl font-bold text-destaque">Resenha</h1>
      <p className="text-texto-fraco">Stats e highlights do grupo. Fechado pra resenha.</p>
      <a
        href="/api/auth/steam"
        className="rounded bg-superficie px-6 py-3 font-medium hover:bg-borda"
      >
        Entrar com Steam
      </a>
    </div>
  )
}
