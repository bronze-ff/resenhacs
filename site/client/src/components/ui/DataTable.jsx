// Wrapper leve de tabela: scroll horizontal + thead/tbody hairline com hover na linha; colunas ficam com quem usa.
export default function DataTable({ head, children, className = '', ...props }) {
  return (
    <div className="overflow-x-auto">
      <table className={`w-full border-collapse text-sm ${className}`.trim()} {...props}>
        {head && (
          <thead className="border-b border-borda text-left font-mono text-[10px] uppercase tracking-wide text-texto-fraco">
            {head}
          </thead>
        )}
        <tbody className="[&>tr]:border-b [&>tr]:border-borda/60 [&>tr]:transition-colors [&>tr:hover]:bg-superficie-alta/50">
          {children}
        </tbody>
      </table>
    </div>
  )
}
