# Spec 0020 — painel de acompanhamento persistido

Status: aprovada para implementação local.

## Objetivo

Permitir que a pessoa autenticada acompanhe descobertas e abra a linha do tempo
do processo exato no painel, usando apenas a projeção persistida e tenant-scoped.
Os modos simples e avançado apresentam os mesmos fatos; muda somente a densidade
visual.

## Caixa de acompanhamento

- carregar a primeira página de `GET /api/v1/alerts?limit=20&status=all` após a
  autenticação, em paralelo ao carregamento dos perfis;
- mostrar rótulo minimizado do perfil, CNJ, tribunal, data da fonte, estado de
  leitura e aviso de correspondência ainda não verificada;
- `caseId`, `caseEventId` e IDs de origem aparecem somente no modo avançado;
- permitir carregar a próxima página pelo cursor opaco, sem duplicar alertas;
- marcar leitura por ação explícita via
  `PATCH /api/v1/alerts/{alertId}/read`, mantendo idempotência;
- encerrar e limpar todo o estado ao sair da conta.

## Linha do tempo

- a ação de abrir usa exclusivamente o `caseId` do alerta selecionado;
- carregar `GET /api/v1/cases/{caseId}/events?limit=20` e páginas seguintes;
- validar que todos os eventos retornados possuem o mesmo `caseId` solicitado;
- destacar o evento `caseEventId` que originou o alerta, quando presente;
- mostrar data original, título, descrição decodificada e procedência oficial;
- resposta tardia de outro processo nunca pode substituir a seleção atual;
- erro, vazio e carregamento são locais ao painel e não apagam resultados de
  busca já visíveis.

## Integridade do cliente

- rejeitar campos extras, ausentes, tipos incorretos, datas inválidas, IDs
  inválidos, cursores repetidos e itens duplicados;
- nunca guardar alertas, CNJs, eventos, tokens ou nomes no `localStorage`;
- todos os requests são autenticados e respostas inesperadas falham fechadas
  com mensagens seguras;
- paginação é limitada a 100 páginas por interação;
- o frontend não associa por nome, texto, tribunal ou CNJ: somente por IDs
  canônicos recebidos da API.

## UX e acessibilidade

- direção editorial sóbria, mantendo tinta azul, papel claro, verde institucional
  e filete dourado já adotados;
- região de status com `aria-live`, headings em ordem lógica e botões com alvo
  mínimo de 44 px;
- seleção, não lido e evento de origem não dependem apenas de cor;
- listas longas usam `content-visibility`; animações respeitam
  `prefers-reduced-motion`;
- responsivo desde 320 px, sem tabela obrigatória no modo simples.

## Desempenho

- perfis e alertas independentes iniciam juntos após autenticação;
- componentes são definidos no nível de módulo para não remontar a cada render;
- dados derivados, como contagem de não lidos, não são duplicados em estado;
- nenhum pacote de UI ou dependência adicional entra no bundle.

## Critérios de aceite

- alerta abre o processo e destaca o evento exatos;
- paginação não repete nem mistura itens;
- marcar como lido altera apenas o alerta escolhido;
- troca rápida entre dois alertas ignora a resposta atrasada do primeiro;
- logout remove imediatamente a atividade sensível da tela;
- os mesmos fatos aparecem nos modos simples e avançado sem nova requisição;
- testes TDD, cobertura 100%, contratos, restore, acessibilidade e scans continuam
  verdes;
- custo externo permanece zero.

## Fora do escopo

- polling, push, e-mail, notificações do sistema operacional ou tempo real;
- documentos em lote, IA, crawler real, ativação remota e alteração de planos.
