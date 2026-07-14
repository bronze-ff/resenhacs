function CornerMark({ className }) {
  return <div className={`pointer-events-none absolute h-10 w-10 border-destaque/25 ${className}`} />
}

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
      <div className="pointer-events-none absolute left-1/2 top-1/2 h-[600px] w-[600px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-destaque/10 blur-[130px]" />
      <div
        className="pointer-events-none absolute inset-0 opacity-40"
        style={{
          background:
            'conic-gradient(from 0deg at 50% 50%, transparent 0deg, rgba(255,46,67,0.05) 40deg, transparent 90deg)',
          animation: 'girar 14s linear infinite',
        }}
      />

      <CornerMark className="left-6 top-6 border-l border-t" />
      <CornerMark className="right-6 top-6 border-r border-t" />
      <CornerMark className="bottom-6 left-6 border-b border-l" />
      <CornerMark className="bottom-6 right-6 border-b border-r" />

      <div className="relative z-10 flex flex-col items-center text-center">
        <p
          className="animate-surgir font-mono text-xs uppercase tracking-[0.35em] text-destaque"
          style={{ animationDelay: '0ms' }}
        >
          Acesso restrito · grupo fechado
        </p>
        <h1
          className="animate-surgir mt-4 font-display text-4xl font-bold uppercase tracking-widest text-texto sm:text-6xl lg:text-7xl"
          style={{ animationDelay: '90ms' }}
        >
          Resenha<span className="text-destaque">.</span>
        </h1>
        <p
          className="animate-surgir mt-4 max-w-sm font-mono text-sm leading-relaxed text-texto-fraco"
          style={{ animationDelay: '180ms' }}
        >
          Stats, replay 2D e highlights de CS2 — feito pra resenha do grupo, não pra internet.
        </p>

        <a
          href="/api/auth/steam"
          className="animate-surgir panel-cut mt-10 flex items-center gap-3 border border-destaque bg-destaque px-7 py-3.5 font-display text-sm font-semibold uppercase tracking-wider text-fundo shadow-[0_0_40px_-10px_rgba(255,46,67,0.6)] transition-shadow hover:shadow-[0_0_60px_-8px_rgba(255,46,67,0.8)]"
          style={{ animationDelay: '280ms' }}
        >
          <SteamIcon className="h-5 w-5" />
          Entrar com Steam
        </a>

        <p
          className="animate-surgir mt-8 font-mono text-[11px] uppercase tracking-widest text-texto-fraco/60"
          style={{ animationDelay: '360ms' }}
        >
          Whitelist necessária — pede pro admin do grupo
        </p>
      </div>

      <style>{`@keyframes girar { to { transform: rotate(360deg); } }`}</style>
    </div>
  )
}
