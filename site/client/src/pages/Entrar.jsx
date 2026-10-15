import { Button } from '../components/ui'

function SteamIcon({ className }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden="true">
      <path d="M11.98 2C6.68 2 2.32 5.94 1.5 11.03l5.62 2.32a3.05 3.05 0 0 1 1.75-.55c.06 0 .12 0 .18.01l2.5-3.63v-.05a3.83 3.83 0 1 1 3.83 3.83h-.07l-3.57 2.55v.16a3.05 3.05 0 1 1-6.1.24L.1 14.5C.85 18.85 4.65 22 11.98 22c6.63 0 12-5.37 12-12s-5.37-8-12-8zm-2.4 15.44-1.3-.54a2.3 2.3 0 0 0 4.24-1.65l1.3.53a3.62 3.62 0 0 1-4.24 1.66zm7.65-8.6a2.5 2.5 0 1 0 0 5.01 2.5 2.5 0 0 0 0-5.01zm0 4.13a1.62 1.62 0 1 1 0-3.24 1.62 1.62 0 0 1 0 3.24z" />
    </svg>
  )
}

export default function Entrar() {
  return (
    <div className="relative flex min-h-screen flex-col items-center justify-center overflow-hidden px-6">
      <div className="relative z-10 flex flex-col items-center text-center">
        <p
          className="animate-surgir rotulo"
          style={{ animationDelay: '0ms' }}
        >
          Stats de cs2 por grupo
        </p>
        <h1
          className="animate-surgir mt-3 font-display text-5xl font-semibold leading-none text-texto sm:text-7xl"
          style={{ animationDelay: '90ms' }}
        >
          Resenha
        </h1>
        <p
          className="animate-surgir mt-5 max-w-sm text-base leading-relaxed text-texto-fraco"
          style={{ animationDelay: '180ms' }}
        >
          Stats, replay 2D e highlights de CS2 — feito pra resenha do grupo, não pra internet.
        </p>

        <Button
          as="a"
          href="/api/auth/steam"
          variante="primario"
          tamanho="lg"
          className="animate-surgir mt-10"
          style={{ animationDelay: '280ms' }}
          icone={<SteamIcon className="h-5 w-5" />}
        >
          Entrar com Steam
        </Button>

        <p
          className="animate-surgir rotulo mt-10 max-w-md leading-relaxed"
          style={{ animationDelay: '360ms' }}
        >
          Depois de entrar, adicione seus amigos na aba Amigos — quem já é seu amigo na Steam entra automático.
          Ao entrar, você concorda com o <a href="/privacidade" className="underline hover:text-texto">aviso de privacidade</a>.
        </p>
      </div>

    </div>
  )
}
