import { Link } from 'react-router-dom'

// Aviso de privacidade (LGPD art. 9º: informação clara ao titular). Página pública —
// acessível antes do login, linkada da Landing, do /entrar e da Minha conta.
// O contato do controlador vem de VITE_CONTATO_PRIVACIDADE (acesso estático); sem ele a
// página orienta a falar com o admin do grupo.
const CONTATO = import.meta.env.VITE_CONTATO_PRIVACIDADE

function Secao({ titulo, children }) {
  return (
    <section className="space-y-3">
      <h2 className="font-display text-lg font-semibold text-texto">{titulo}</h2>
      <div className="space-y-3 text-sm leading-relaxed text-texto-fraco [&_strong]:font-medium [&_strong]:text-texto">{children}</div>
    </section>
  )
}

export default function Privacidade() {
  return (
    <div className="mx-auto max-w-3xl px-5 py-12 sm:py-16">
      <Link to="/" className="text-sm text-texto-fraco hover:text-texto">← Voltar</Link>
      <h1 className="mt-6 font-display text-3xl font-semibold text-texto">Privacidade</h1>
      <p className="mt-2 text-sm text-texto-fraco">
        Como o Resenha trata seus dados, em português direto. Última atualização: outubro de 2026.
      </p>

      <div className="mt-10 space-y-10">
        <Secao titulo="Quem somos">
          <p>
            O Resenha é um site de estatísticas de CS2 feito para um grupo fechado de amigos. Não é um produto comercial,
            não vende dados e não mostra anúncios. O responsável pelo tratamento dos dados é o administrador do grupo.
          </p>
          <p>
            <strong>Contato para assuntos de privacidade:</strong>{' '}
            {CONTATO ? <a href={`mailto:${CONTATO}`} className="text-destaque hover:underline">{CONTATO}</a> : 'fale com o administrador do grupo.'}
          </p>
        </Secao>

        <Secao titulo="Que dados usamos">
          <ul className="list-disc space-y-2 pl-5">
            <li><strong>Da sua conta Steam:</strong> SteamID, nick e avatar públicos. O login é pela Steam; nunca vemos sua senha.</li>
            <li><strong>Das suas partidas:</strong> placar, mapa, data e estatísticas (kills, dano, economia, posições) tiradas das demos.</li>
            <li><strong>Que você informa:</strong> código de autenticação do histórico de partidas da Steam (para o site achar suas partidas), vínculo com a FACEIT, link de troca (só se você vencer uma competição) e demos que você envia.</li>
            <li><strong>De outros jogadores nas mesmas partidas:</strong> as demos trazem SteamID, nick e estatísticas de todos os 10 jogadores, inclusive adversários que não usam o Resenha.</li>
            <li><strong>Uso do site:</strong> contagem anônima de páginas vistas (PostHog), sem cookie e com IDs de jogador e de partida removidos das URLs; e registros de erro (Sentry) sem dados pessoais.</li>
          </ul>
          <p>Não coletamos e-mail, telefone, documento nem endereço.</p>
        </Secao>

        <Secao titulo="Para que e com que base">
          <ul className="list-disc space-y-2 pl-5">
            <li><strong>Mostrar suas partidas e estatísticas ao grupo</strong> — legítimo interesse (é o motivo de o site existir), só para você e seus amigos aceitos.</li>
            <li><strong>Vínculo FACEIT e geração de clipes (Allstar)</strong> — feitos só quando você pede.</li>
            <li><strong>Métricas de uso e erros</strong> — legítimo interesse, para manter o site funcionando. Você pode desligar as métricas em Minha conta.</li>
          </ul>
        </Secao>

        <Secao titulo="Com quem compartilhamos">
          <p>Usamos serviços que processam dados em nosso nome (alguns fora do Brasil):</p>
          <ul className="list-disc space-y-2 pl-5">
            <li><strong>Vercel</strong> (hospedagem do site e da API), <strong>Supabase</strong> (banco de dados) e <strong>Cloudflare R2</strong> (armazenamento de demos e replays).</li>
            <li><strong>Sentry</strong> (registro de erros) e <strong>PostHog</strong> (métricas, servidor na União Europeia).</li>
            <li><strong>Steam / Valve</strong> e <strong>FACEIT</strong> — de onde vêm as partidas.</li>
            <li><strong>Allstar</strong> — quando um clipe é pedido, a demo da partida (com os 10 jogadores) é enviada a ela para gerar o vídeo, e o SteamID de quem assiste vai junto no player.</li>
          </ul>
        </Secao>

        <Secao titulo="Por quanto tempo guardamos">
          <ul className="list-disc space-y-2 pl-5">
            <li>Arquivo bruto da demo (.dem): apagado cerca de 14 dias depois do processamento.</li>
            <li>Demos enviadas que não viraram partida: apagadas em até 30 dias.</li>
            <li>Estatísticas, replay 2D e clipes: enquanto o site existir, ou até você excluir sua conta.</li>
          </ul>
        </Secao>

        <Secao titulo="Seus direitos">
          <p>Pela LGPD você pode, a qualquer momento:</p>
          <ul className="list-disc space-y-2 pl-5">
            <li><strong>Baixar seus dados</strong> — em Minha conta, “Baixar meus dados”.</li>
            <li><strong>Excluir sua conta</strong> — em Minha conta. Apagamos seu nick, avatar, códigos, vínculos, amizades, clipes e envios; as estatísticas das partidas ficam sob “Jogador removido”, porque também são dos outros participantes.</li>
            <li><strong>Desligar as métricas de uso</strong> — em Minha conta.</li>
            <li><strong>Pedir correção, informação ou remoção</strong> — pelo contato acima. Isso vale também para quem aparece numa partida sem ter conta no Resenha.</li>
          </ul>
        </Secao>

        <Secao titulo="Segurança">
          <p>
            O acesso é só por login da Steam. Cada jogador só vê partidas em que jogou ou de amigos aceitos. O banco e os arquivos
            não ficam abertos ao público, e as conexões são criptografadas (HTTPS). Se acontecer um incidente que afete seus dados,
            avisaremos os afetados e a ANPD como a lei exige.
          </p>
        </Secao>
      </div>
    </div>
  )
}
