# Extensão FACEIT do ResenhaCS

Quando o Jogador baixa uma Demo pelo **Watch Demo** da FACEIT, a extensão observa esse download e envia ao ResenhaCS apenas o `faceitMatchId` e o link assinado da Demo. O download continua normalmente no navegador. A extensão não lê o arquivo, não acessa a API da FACEIT, não injeta scripts e não automatiza o site.

## Estado desta entrega

A allowlist está **vazia** em `src/config.js`. Nenhum download é enviado nessa configuração. O formato do id e o caminho da sala nesse mesmo arquivo são provisórios, pendentes do X0; não há fallback pelo nome do arquivo.

Antes de ativar, o Filippe precisa conferir um download real: hosts de `url` e `finalUrl`, formato do nome, presença da sala no referrer e validade do link após 15 e 60 minutos. Não envie o link completo nem sua assinatura. Depois dessa conferência, Faro ajusta `src/config.js`; Torno atualiza o array de `shared/extensao/faceit-demo-hosts.json` no X-PKG. O teste T17 compara as listas, sem importar arquivos externos ao pacote no runtime.

O server X-SRV, a página de conexão X-UI, os ícones X-LOJA e o empacotamento X-PKG são entregas separadas. Os testes daqui usam mocks do I9 e hosts fictícios. A carga sem compactação depende dos três ícones `icons/icon-16.png`, `icon-48.png` e `icon-128.png`, entregues pelo X-LOJA. Não há dependência de runtime.

## Instalar sem compactação

Depois de integrar as entregas acima:

1. Abra `chrome://extensions` ou `brave://extensions` e ative **Modo do desenvolvedor**.
2. Clique em **Carregar sem compactação** e selecione a pasta `extensao/`.
3. Na conta do ResenhaCS, clique em **Conectar extensão**. O site precisa usar o ID da extensão instalada; a publicação e a chave estável ficam com X-PKG e Filippe.
4. Baixe uma Demo pelo Watch Demo da FACEIT. Confira o histórico e abra **Ver Partida**, quando disponível.

O popup mostra conexão, últimas 20 tentativas e um badge de envios novos. Abrir o popup zera o badge. **Desconectar** apaga token e histórico locais. Não há interruptor ou ciclo automático: o único gatilho de envio é um download reconhecido que o Jogador iniciou.

## I9 e privacidade

A API fica em `https://resenhacs.vercel.app/api/extensao`. Só esse host tem permissão de rede. A origem que pode entregar o token é exatamente `https://resenha-phi.vercel.app`, com a mensagem `{ tipo: 'resenha-token', token }`, sem campos extras. Mensagens internas só são aceitas do próprio popup.

Antes de cada envio, o worker chama `POST /renovar` com o Bearer atual e usa o token novo em `POST /envio`. Não envia cookies e não segue redirects da API. Em 401 apaga o token e pede reconexão; falha de rede na renovação preserva o token e não envia. Não há retry automático: cada download id é tratado no máximo uma vez na sessão do navegador. Se o worker encerrar depois de marcar o id e antes de concluir a rede, é preciso baixar a Demo novamente para tentar outro envio.

Downloads de outros hosts são descartados em memória, sem registro, log ou envio. O histórico guarda data, estado, mensagem contratada, `faceitMatchId` e, quando válido, `matchId`; não guarda URL assinada, filename ou referrer. O token fica separado em `chrome.storage.local`, restrito a contextos confiáveis da extensão. A resposta de estado do worker ao popup não inclui o token; o popup não o usa nem o exibe. O evento local `storage.onChanged` pode notificar sua mudança enquanto o popup estiver aberto. Não há Sentry, PostHog, código remoto, permissões de tabs/cookies ou acesso ao histórico de navegação.

O Coletor pode recusar um link expirado. Nesse caso, o Jogador envia o `.dem.gz` já baixado pela página da Partida. O envio de links só é ativado após X0 e integração com X-SRV/X-COL.

## Testes

Os arquivos de `test/` usam Vitest com fakes de `chrome.*` e `fetch`, sem rede real. X-PKG é dono de `package.json`, lockfile e do comando de verify da extensão. T17 fica explicitamente pendente enquanto tanto o pacote X-PKG quanto o JSON compartilhado estiverem ausentes. Ao integrar o pacote, o teste exige o JSON e a igualdade das listas: arquivo ausente ou caminho alterado falha. Nesta entrega foram executados apenas os testes focados, com um worker; o gate e o download real ficam para a liberação do Maestro e a conferência do Filippe.
