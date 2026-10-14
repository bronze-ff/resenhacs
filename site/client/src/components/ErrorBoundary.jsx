import { Component } from 'react'
import { capturarErro } from '../observabilidade/sentry.js'
import Card from './ui/Card.jsx'
import Button from './ui/Button.jsx'

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
    capturarErro(erro)
    console.error('Erro não tratado na UI:', erro, info)
  }

  render() {
    if (!this.state.erro) return this.props.children
    return (
      <div className="flex min-h-screen items-center justify-center bg-fundo p-4">
        <Card className="max-w-md space-y-3 p-5">
          <h2 className="font-display text-lg font-semibold text-perigo">
            Essa página quebrou
          </h2>
          <p className="text-sm text-texto-fraco">
            Algo deu errado ao carregar essa tela. Manda um print dessa mensagem pro grupo
            resolver.
          </p>
          <p className="overflow-x-auto whitespace-pre-wrap break-words border border-borda bg-fundo p-2 font-mono text-xs text-texto-fraco">
            {this.state.erro?.message || String(this.state.erro)}
          </p>
          <Button variante="primario" className="w-full sm:w-auto" onClick={() => window.location.reload()}>
            Recarregar
          </Button>
        </Card>
      </div>
    )
  }
}
