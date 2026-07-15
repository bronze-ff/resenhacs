import { Component } from 'react'
import Card from './ui/Card.jsx'

// Rede de segurança do site inteiro: sem isso, qualquer erro de render (ex.: um
// componente que assume um dado que não veio) derruba a árvore inteira e sobra só
// o fundo escuro do body — parece a página ter travado/ficado preta, sem pista
// nenhuma do que aconteceu. Com o boundary, pelo menos aparece uma mensagem (e o
// usuário consegue nos mandar o texto do erro em vez de só "ficou preto").
export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props)
    this.state = { erro: null }
  }

  static getDerivedStateFromError(erro) {
    return { erro }
  }

  componentDidCatch(erro, info) {
    console.error('Erro não tratado na UI:', erro, info)
  }

  render() {
    if (!this.state.erro) return this.props.children
    return (
      <div className="flex min-h-screen items-center justify-center bg-fundo p-4">
        <Card className="max-w-md space-y-3 p-5">
          <h2 className="font-display text-lg font-bold uppercase tracking-wide text-perigo">
            Essa página quebrou
          </h2>
          <p className="font-mono text-sm text-texto-fraco">
            Algo deu errado ao carregar essa tela. Manda um print dessa mensagem pro grupo
            resolver.
          </p>
          <p className="overflow-x-auto whitespace-pre-wrap break-words rounded border border-borda bg-fundo p-2 font-mono text-xs text-texto-fraco">
            {this.state.erro?.message || String(this.state.erro)}
          </p>
          <button
            onClick={() => window.location.reload()}
            className="panel-cut-sm min-h-10 w-full border border-destaque bg-destaque px-4 py-2 font-display text-sm font-semibold uppercase tracking-wide text-fundo lg:min-h-0 lg:w-auto"
          >
            Recarregar
          </button>
        </Card>
      </div>
    )
  }
}
