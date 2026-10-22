import { Link } from 'react-router-dom'
import { Button, EstadoVazio } from '../components/ui'

// Rota "*": link velho ou digitado errado. Antes o app renderizava nada e sobrava
// a tela preta. Logado aparece dentro do Shell; deslogado, sozinha.
export default function NaoEncontrada({ logado = false }) {
  const conteudo = (
    <EstadoVazio
      className="w-full"
      titulo="Essa página não existe."
      descricao="O link pode estar errado ou a página saiu do ar."
      acao={
        <Button as={Link} to="/" variante="secundario">
          {logado ? '← Partidas' : '← Início'}
        </Button>
      }
    />
  )
  if (logado) return conteudo
  return <main className="mx-auto flex min-h-screen max-w-md items-center px-4">{conteudo}</main>
}
