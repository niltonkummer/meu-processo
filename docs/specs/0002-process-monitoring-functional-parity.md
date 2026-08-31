# Spec 0002 — Paridade funcional em acompanhamento processual

**Status:** aceita para planejamento e implementação incremental
**Data:** 29 de agosto de 2026
**Responsável de produto:** Meu Processo
**Relacionada:** [Spec 0001 — Cadastro local e busca de processos](./0001-target-search-validation.md)

## 1. Decisão

O Meu Processo terá como referência funcional a categoria de acompanhamento
processual oferecida por plataformas jurídicas consolidadas. A referência serve
para identificar resultados que o usuário espera obter; não autoriza copiar
código, interface, marca, textos, conteúdo organizado ou base proprietária de
qualquer concorrente.

O produto construirá uma base própria e auditável a partir de fontes oficiais e
conectores cuja utilização seja juridicamente permitida. O objetivo é atingir
paridade funcional progressiva em consulta, organização, monitoramento,
notificações e acesso a documentos públicos.

A experiência terá dois modos sobre a mesma API e os mesmos registros:

- **modo simples**, prioritário e padrão para pessoa física;
- **modo avançado**, destinado a advogados e escritórios.

O modo escolhido altera apresentação, densidade e ferramentas disponíveis. Ele
nunca altera o fato processual, a autorização, a proveniência ou o vínculo entre
usuário e processo.

## 2. Relação com a validação existente

A Spec 0001 continua sendo a validação técnica de busca stateless no DJEN. Esta
spec define a evolução posterior para produto persistente, autenticado e
multiusuário.

Nenhuma funcionalidade desta spec pode enfraquecer as garantias já aceitas:

- agrupamento somente pelo número CNJ normalizado;
- separação de processos com números diferentes;
- aviso de homônimos e cobertura parcial;
- CPF e CNPJ mascarados e nunca registrados integralmente em logs;
- HTML externo convertido em texto simples;
- links e dados sempre acompanhados da fonte;
- ausência de um resultado nunca apresentada como prova de inexistência.

## 3. Objetivos

1. Permitir que uma pessoa física encontre e acompanhe os próprios processos sem
   precisar conhecer terminologia jurídica.
2. Permitir que profissionais acompanhem uma carteira maior com filtros,
   clientes, ações em lote, exportações e auditoria.
3. Consolidar publicações, movimentações e documentos públicos em uma linha do
   tempo por processo, sem misturar processos ou clientes.
4. Detectar novidades e entregar alertas confiáveis.
5. Disponibilizar documentos públicos individualmente e em lote quando a fonte
   oficial permitir.
6. Exibir cobertura e indisponibilidade por fonte de forma explícita.
7. Fazer a base crescer organicamente a partir de alvos cadastrados e coleta
   prospectiva, sem depender de uma varredura nacional inicial.

## 4. Não objetivos desta spec

- Copiar a base, o conteúdo editorial ou a apresentação de um concorrente.
- Replicar doutrina, modelos, peças ou obras protegidas por direito autoral.
- Oferecer um buscador público irrestrito de pessoas, CPF ou CNPJ.
- Contornar CAPTCHA, autenticação, bloqueio geográfico, rate limit ou controles
  de acesso de tribunais.
- Obter ou distribuir documentos sigilosos ou sob segredo de justiça.
- Prometer cobertura nacional completa antes de medi-la por tribunal.
- Usar comercialmente dados do DataJud sem autorização compatível com a
  Portaria CNJ nº 374/2026.
- Calcular automaticamente prazos fatais ou substituir orientação jurídica.
- Adicionar pesquisa de jurisprudência, doutrina e geração de peças nesta
  entrega; essas capacidades exigirão specs próprias.

## 5. Personas e permissões

### 5.1 Pessoa física

Necessidades principais:

- saber se houve novidade;
- entender em linguagem clara o que foi publicado;
- encontrar o documento oficial;
- receber aviso sem precisar consultar vários portais;
- distinguir processo confirmado de possível homônimo.

O usuário pessoa física só pode acompanhar o próprio perfil ou outro alvo para
o qual declare finalidade legítima. Consultas por CPF são limitadas ao próprio
documento após verificação de identidade, quando essa funcionalidade for aberta
ao público.

### 5.2 Advogado individual

Necessidades adicionais:

- acompanhar processos, clientes, nomes e OAB;
- filtrar e ordenar uma carteira;
- ver dados técnicos e texto oficial sem simplificação obrigatória;
- marcar, atribuir e exportar informações;
- baixar documentos em lote;
- manter trilha de coleta e auditoria.

### 5.3 Escritório

Necessidades adicionais:

- organização com múltiplos usuários;
- carteiras, clientes e OABs compartilhados;
- papéis de proprietário, administrador, advogado e leitura;
- segregação por organização e, futuramente, por equipe;
- histórico de acesso, exportação e alterações;
- limites e consumo agregados pelo contrato da organização.

## 6. Princípio de uma única verdade processual

Os dois modos de interface consomem a mesma representação canônica. Para o mesmo
`caseId` e instante de coleta:

- número CNJ, tribunal, órgão, classe, movimentos e documentos são idênticos;
- a ordenação cronológica usa o mesmo timestamp original;
- a fonte, o hash e o horário de coleta são preservados;
- conteúdo simplificado é apresentado como explicação, nunca como dado oficial;
- permissões são aplicadas no servidor antes da resposta;
- alternar de modo não dispara uma nova vinculação nem duplica o processo.

Testes contratuais devem comparar as respostas usadas nos dois modos para impedir
divergência factual.

## 7. Capacidades funcionais

### 7.1 Descoberta e cadastro

O produto deverá aceitar, conforme a capacidade real da fonte:

- número CNJ;
- nome completo e variações controladas;
- CPF próprio verificado;
- CNPJ para perfis empresariais autorizados;
- número e UF da OAB no modo profissional.

Cada resultado deve informar:

- fontes consultadas;
- fontes indisponíveis;
- data e hora da consulta;
- cobertura conhecida por tribunal;
- confiança do vínculo;
- possibilidade de homônimo;
- truncagem ou resposta parcial.

Resultados candidatos só entram na carteira após vínculo explícito ou regra
determinística documentada. Nome semelhante nunca é suficiente para confirmar
identidade.

### 7.2 Página do processo

Todo processo deverá ter:

- número CNJ em destaque;
- tribunal, grau, órgão, classe e assuntos quando fornecidos;
- situação da coleta e última atualização;
- linha do tempo unificada de movimentações e publicações;
- documentos vinculados ao evento que os originou;
- destinatários e advogados somente quando necessários, autorizados e fornecidos
  pela fonte;
- régua de procedência por evento;
- alerta de fonte desatualizada ou indisponível;
- estado de possível homônimo até confirmação.

### 7.3 Monitoramento

O usuário pode ativar ou desativar acompanhamento para:

- processo conhecido;
- nome e variações;
- CPF próprio verificado;
- CNPJ autorizado;
- OAB e UF no modo profissional.

Gatilhos:

1. sincronização inicial após cadastro;
2. atualização diária agendada;
3. atualização manual sujeita a quota;
4. reprocessamento controlado após falha de fonte.

Cada execução deve ser idempotente e registrar contagens, duração, fontes,
resultado parcial, falha e próximo horário de verificação sem registrar o
conteúdo processual em logs.

### 7.4 Alertas

O MVP persistente terá alertas dentro do painel. E-mail será o primeiro canal
externo. WhatsApp e push ficam para specs futuras.

Um alerta deve conter:

- processo e perfil monitorado;
- tipo de novidade;
- data da fonte;
- trecho mínimo necessário;
- link para o contexto no produto;
- indicação de possível homônimo ou dado parcial;
- opção de marcar como lido sem alterar o fato oficial.

### 7.5 Explicação simplificada

O modo simples pode apresentar uma explicação curta de uma movimentação ou
publicação. Na primeira versão, a explicação deve ser determinística e baseada
em tipos conhecidos. IA generativa só será adicionada com spec própria,
avaliação de qualidade e citações obrigatórias.

Toda explicação deve:

- aparecer separada do texto oficial;
- apontar a publicação ou movimentação que a fundamenta;
- evitar afirmar prazo ou resultado não presente na fonte;
- permitir abrir o texto original;
- informar quando não houver segurança para simplificar.

## 8. Modos de interface

### 8.1 Direção visual comum

A direção permanece **editorial institucional de precisão**: moderna,
profissional, séria e leve. A assinatura visual é a régua de procedência:

```text
Processo CNJ · Tribunal · Fonte oficial · Coletado em · Confiança
```

Os modos compartilham tokens, componentes, acessibilidade e linguagem de
estados. Não existirão dois frontends independentes.

### 8.2 Modo simples — pessoa física

É o modo padrão em telas pequenas e para contas de pessoa física.

Prioridades:

1. **O que mudou?**
2. **Isso precisa de atenção?**
3. **Quando aconteceu?**
4. **Onde confirmo?**

Características:

- navegação por tarefas, não por termos técnicos;
- um processo por contexto principal;
- cartões com título, data, estado e ação primária;
- explicação curta seguida do texto oficial recolhido;
- linguagem como “Nova publicação” e “Confira no tribunal”;
- filtros essenciais, inicialmente período e novidades;
- ações destrutivas ou de alto impacto sempre confirmadas;
- ausência de tabelas largas na experiência principal;
- ajuda contextual para homônimos, fontes e cobertura.

Telas prioritárias:

- Início;
- Meus processos;
- Detalhe do processo;
- Documentos;
- Alertas;
- Perfis acompanhados;
- Preferências e privacidade.

### 8.3 Modo avançado — profissionais

É habilitado por preferência do usuário e pode ser o padrão de contas
profissionais.

Características:

- carteira em tabela ou grade densa;
- colunas configuráveis sem alterar o contrato da API;
- filtros por cliente, OAB, tribunal, órgão, classe, período, atualização,
  status e tags;
- seleção múltipla e barra de ações em lote;
- texto oficial visível com metadados técnicos;
- histórico de coleta, fonte e falhas;
- atalhos de teclado documentados;
- exportações, relatórios e download em lote;
- estado salvo como preferência, nunca contendo dados processuais sensíveis no
  armazenamento persistente do navegador.

Telas adicionais:

- Carteira;
- Clientes e perfis;
- Central de documentos;
- Exportações;
- Saúde das fontes;
- Auditoria;
- Administração da organização.

### 8.4 Alternância entre modos

- A alternância fica disponível no menu de perfil.
- A preferência pode ser persistida no perfil autenticado.
- Alterar o modo preserva rota, processo, filtros compatíveis e seleção segura.
- Respostas pendentes do modo anterior devem ser canceladas ou ignoradas.
- Um usuário profissional pode usar o modo simples; recursos autorizados não são
  removidos, apenas reorganizados.
- Recursos não contratados são explicados, nunca simulados com dados fictícios.

## 9. Documentos

### 9.1 Tipos suportados

O sistema diferencia:

- certidão da comunicação do DJEN;
- inteiro teor indicado pela publicação;
- documento público do processo obtido no tribunal;
- arquivo gerado pelo produto, como manifesto ou relatório.

Uma referência de documento contém, no mínimo:

- `documentId` interno não enumerável;
- `caseId` e evento de origem;
- fonte e identificador oficial;
- URL oficial armazenada de forma protegida;
- tipo e descrição da fonte;
- disponibilidade: `public`, `auth_required`, `unavailable` ou `unknown`;
- MIME type declarado e detectado;
- tamanho quando conhecido;
- hash quando o conteúdo for obtido;
- horário de coleta e última verificação.

Documento ausente, indisponível ou protegido não pode aparecer como erro de
conteúdo do processo. O estado deve ser explícito.

### 9.2 Gateway brasileiro

Documentos acessíveis apenas a partir do Brasil serão obtidos por um gateway
controlado no Cloud Run em `southamerica-east1`.

O gateway:

- recebe apenas `documentId`, nunca URL arbitrária;
- verifica usuário, organização, processo e documento no servidor;
- resolve a URL a partir do registro autorizado;
- aceita apenas HTTPS e hosts judiciais cadastrados por conector;
- valida DNS, IP e todos os redirecionamentos contra SSRF;
- não encaminha cookies ou credenciais do usuário para hosts não previstos;
- aplica timeout, rate limit, limite de tamanho e concorrência;
- transmite o conteúdo sem carregá-lo integralmente na memória;
- valida tipo real do arquivo e usa nome seguro;
- devolve `Cache-Control: private, no-store`;
- registra auditoria sem conteúdo, token ou URL sensível.

### 9.3 Cache e retenção

O padrão inicial é acesso sob demanda. O Cloud Storage funciona como cache
privado e temporário, não como arquivo nacional indiscriminado.

- bucket regional em São Paulo;
- acesso público impedido;
- chave por fonte, identificador e hash, nunca somente por nome;
- lifecycle inicial de 7 dias para cache de documentos;
- arquivo de exportação com expiração de 24 horas;
- exclusão antecipada quando o usuário remover a exportação;
- retenção permanente exige finalidade, base legal e política próprias;
- cache e objeto sempre escopados por autorização, mesmo que o conteúdo oficial
  seja público.

## 10. Download de documentos em lote

### 10.1 Experiência

No modo simples, a pessoa física pode solicitar **Baixar documentos deste
processo**, respeitando a quota reduzida e sem seleção entre processos. No modo
avançado, o usuário pode selecionar documentos na carteira, em um processo ou
na Central de documentos e solicitar **Baixar selecionados** para um ou vários
processos autorizados.

O pedido cria um trabalho assíncrono. A interface não mantém uma requisição
aberta enquanto os tribunais respondem.

Estados do trabalho:

```text
queued → discovering → fetching → scanning → packaging
                                      ├── ready
                                      ├── partial
                                      ├── failed
                                      └── expired
```

A interface mostra progresso por contagens, não uma porcentagem inventada. O
usuário pode sair da página e voltar depois.

### 10.2 Conteúdo do pacote

O pacote é um ZIP com estrutura determinística:

```text
processo_<cnj>/
  manifest.csv
  manifest.json
  documentos/
    <data>_<tipo>_<documentId-curto>.pdf
  indisponiveis.csv
```

O manifesto contém:

- processo CNJ;
- `documentId`;
- nome original seguro e nome no pacote;
- tipo, fonte e identificador oficial;
- data do documento e data da coleta;
- tamanho e SHA-256;
- resultado: incluído, indisponível, protegido, inválido ou falha da fonte;
- mensagem segura para falhas parciais.

O pacote nunca mistura documentos de organizações, usuários ou processos não
selecionados. Para múltiplos processos, cada CNJ possui diretório próprio.

### 10.3 Limites iniciais de validação

Os limites são configuração server-side e podem variar por plano. Valores
iniciais:

| Perfil | Arquivos por trabalho | Tamanho total | Trabalhos simultâneos |
|---|---:|---:|---:|
| Pessoa física | 25 | 250 MiB | 1 |
| Profissional | 250 | 2 GiB | 3 por organização |

Regras comuns:

- arquivo individual máximo de 100 MiB;
- exportação expira em 24 horas;
- download exige nova autorização, mesmo com trabalho pronto;
- falha em um documento gera resultado `partial`, não descarta os demais;
- exceder limite deve falhar antes de iniciar downloads quando o tamanho for
  conhecido;
- quando o tamanho não for conhecido, o worker interrompe com manifesto parcial
  ao atingir a quota;
- quotas e consumo são exibidos antes da confirmação;
- custo e taxa da fonte podem reduzir dinamicamente a concorrência.

### 10.4 Segurança dos pacotes

- arquivos passam por verificação de tipo, tamanho e malware antes do pacote;
- nomes removem caminhos, caracteres de controle e colisões;
- conteúdo compactado não é descompactado automaticamente pelo backend;
- ZIP é criado por streaming ou em armazenamento temporário limitado;
- a entrega ocorre pelo gateway autenticado ou URL assinada de curtíssima duração
  vinculada ao trabalho, conforme threat model;
- o bucket permanece privado e com Public Access Prevention;
- toda criação, download, cancelamento e expiração entra na trilha de auditoria.

## 11. Base própria e cobertura

### 11.1 Crescimento da base

A base cresce em três movimentos:

1. **sob demanda:** consulta ou cadastro enriquece o processo solicitado;
2. **monitoramento:** processos ativos recebem atualizações periódicas;
3. **coleta prospectiva:** cadernos e fontes prioritárias são coletados uma vez e
   comparados com alvos autorizados.

Não haverá promessa de “mesma base” de terceiros. O painel publicará uma matriz
de cobertura própria, medida por fonte e tribunal.

### 11.2 Registro de capacidades da fonte

Cada conector declara e testa capacidades independentes:

- busca por CNJ;
- busca por nome;
- busca por CPF/CNPJ;
- busca por OAB;
- capa processual;
- movimentações;
- publicações;
- documentos públicos;
- atualização incremental;
- limitação geográfica, autenticação, CAPTCHA e rate limit.

Uma capacidade indisponível não deve ser inferida a partir de outra. A interface
mostra “fonte não oferece” ou “fonte indisponível”, conforme o caso.

### 11.3 Fontes iniciais

- DJEN para comunicações, publicações, certidões e links oficiais;
- conectores direcionados a tribunais para capa, movimentos e documentos
  públicos;
- cadernos do DJEN para coleta prospectiva quando o volume justificar;
- DataJud somente em cenários não comerciais e autorizados, nunca como base de
  uma oferta paga sem autorização específica.

## 12. Modelo de dados conceitual

Entidades mínimas:

```text
User
Organization
Membership
Subject
MonitoringTarget
Subscription
Case
CaseSource
CaseEvent
Publication
DocumentReference
CollectionRun
Alert
ExportJob
AuditEvent
```

Invariantes:

- `Case` usa número CNJ normalizado como identidade jurídica, com contexto da
  fonte e grau quando necessário;
- `Subscription` liga usuário ou organização ao alvo sem duplicar a coleta;
- toda entidade de negócio possui `organizationId` ou escopo pessoal explícito;
- `CaseEvent`, `Publication` e `DocumentReference` preservam fonte e
  identificador oficial;
- deduplicação usa identificador da fonte e hash, nunca similaridade textual;
- dados originais e normalizados são distinguíveis;
- explicações e conteúdo de IA ficam separados dos fatos oficiais;
- exclusão lógica, retenção e auditoria não podem apagar silenciosamente a
  proveniência exigida.

## 13. Arquitetura alvo incremental

```text
Firebase Hosting + Authentication
                │
                ▼
Cloud Run API privada por identidade
      │              │
      │              ├── gateway de documentos no Brasil
      │              ├── Supabase PostgreSQL: usuários, carteira, estado e alertas
      │              └── Cloud Storage: originais, cache e exportações
      │
Cloud Scheduler ──► coletor idempotente
Cloud Tasks ──────► consultas e downloads com retry/rate limit
Cloud Run Job ────► empacotamento de exportações maiores
```

Infisical é a fonte de verdade dos segredos e sincroniza o namespace autorizado
para o Google Secret Manager, consumido pelo Cloud Run por IAM. O runtime não
consulta o vault por request e o frontend nunca recebe credenciais.

Google Cloud Workflows não é necessário nesta fase. Cloud Tasks controla
trabalhos curtos e retries; Cloud Run Jobs atende exportações que ultrapassem o
tempo adequado de uma requisição. Pub/Sub será considerado somente quando
houver múltiplos consumidores independentes.

Toda infraestrutura nova é criada por Terraform. O frontend não recebe segredo,
credencial de tribunal ou permissão direta ampla sobre buckets.

## 14. Contratos de serviço planejados

Os contratos definitivos serão versionados antes da implementação. Recursos
mínimos:

```text
POST /api/v1/searches
GET  /api/v1/cases
GET  /api/v1/cases/{caseId}
GET  /api/v1/cases/{caseId}/events
GET  /api/v1/cases/{caseId}/documents
POST /api/v1/monitoring-targets
POST /api/v1/export-jobs
GET  /api/v1/export-jobs/{exportJobId}
GET  /api/v1/export-jobs/{exportJobId}/download
DELETE /api/v1/export-jobs/{exportJobId}
```

`POST /api/v1/export-jobs` recebe somente IDs internos autorizados:

```json
{
  "documentIds": ["doc_01", "doc_02"],
  "format": "zip"
}
```

Não aceita URLs, caminhos de objeto ou nomes de bucket fornecidos pelo cliente.

Respostas de listas usam paginação estável. Dados processuais usam
`Cache-Control: private, no-store`. Erros têm códigos estáveis e não refletem
respostas integrais das fontes.

## 15. Segurança, privacidade e isolamento

### 15.1 Autenticação e autorização

- Firebase Authentication identifica a pessoa usuária;
- autorização é aplicada no backend e nas regras do banco;
- política padrão é negar;
- toda rota privada testa usuário, organização, papel e recurso;
- trocar o `caseId`, `documentId` ou `exportJobId` nunca pode permitir acesso a
  outro tenant;
- URLs assinadas, quando usadas, expiram rapidamente e não substituem a
  autorização de criação do trabalho;
- logout elimina dados processuais em memória e invalida a sessão aplicável.

### 15.2 Dados pessoais

- coleta mínima e finalidade por tipo de monitoramento;
- CPF/CNPJ cifrados ou tokenizados quando a persistência for necessária;
- nenhum conteúdo processual em logs, analytics de frontend ou ferramentas de
  sessão;
- dados reais não entram em fixtures, screenshots ou ambientes de teste;
- política de retenção, exclusão e atendimento ao titular precede piloto externo;
- processo público não torna irrestrito todo uso secundário de seus dados.

### 15.3 Conteúdo não confiável

- HTML nunca é renderizado diretamente;
- PDF e outros arquivos são tratados como conteúdo ativo e potencialmente
  malicioso;
- links externos passam por allowlist e validação de protocolo;
- o frontend não usa `dangerouslySetInnerHTML`;
- documentos não são indexados para busca global sem finalidade e autorização
  documentadas.

## 16. Requisitos não funcionais

### 16.1 Precisão

- zero mistura conhecida entre processos ou tenants;
- toda informação exibida possui fonte ou é marcada como explicação;
- timestamps mantêm valor original e apresentação em horário adequado;
- dados parciais nunca substituem silenciosamente dados válidos anteriores;
- conflito entre fontes é exibido, não resolvido por escolha silenciosa.

### 16.2 Desempenho

- LCP menor que 2,5 s em conexão móvel na experiência simples;
- INP menor que 200 ms e CLS menor que 0,1;
- modo avançado carregado sob demanda, sem aumentar o pacote inicial do modo
  simples além da meta aceita;
- criação de exportação responde em até 2 s com trabalho enfileirado, sem esperar
  os documentos;
- listas são paginadas e virtualizadas apenas quando medição justificar;
- documentos são transmitidos por streaming.

### 16.3 Acessibilidade

- WCAG 2.2 AA como meta;
- navegação completa por teclado;
- foco sempre visível;
- alvos clicáveis de pelo menos 44 × 44 px no modo simples;
- tabelas avançadas possuem cabeçalhos, nome acessível e alternativa responsiva;
- progresso de exportação usa texto e `aria-live`, não apenas cor;
- `prefers-reduced-motion` é respeitado.

### 16.4 Custo

- nenhuma implementação desta spec começa sem avaliação baseada em
  `docs/templates/infra-cost-assessment.md` com status
  `aprovado para implementação`;
- cada avaliação informa custo atual, esperado e limite operacional em USD,
  incluindo custo único e custos não representados pelo Terraform;
- mudanças Terraform exigem diff Infracost no pull request;
- escala a zero onde compatível;
- coleta direcionada antes de varredura nacional;
- download sob demanda antes de armazenamento permanente;
- deduplicação por hash para evitar baixar e armazenar o mesmo arquivo;
- lifecycle obrigatório em cache e exportações;
- quotas por perfil, organização e fonte;
- métricas de bytes obtidos, armazenados e entregues por trabalho;
- budget e alertas antes de abrir o download em lote a clientes externos.
- custo real é comparado à estimativa 7 e 30 dias após cada deploy;
- novo SKU, instância mínima, aumento de retenção ou egress entre regiões exige
  aprovação explícita antes da implementação.

## 17. Observabilidade

Métricas mínimas:

- sucesso, falha e duração por conector;
- cobertura e última atualização por tribunal;
- novidades e duplicidades por execução;
- documentos descobertos, disponíveis, protegidos e indisponíveis;
- bytes por documento e exportação;
- trabalhos `ready`, `partial`, `failed` e `expired`;
- custo estimado por perfil e organização;
- alertas entregues, abertos e com falha.

Logs usam identificadores internos, correlation ID e contagens. Não incluem nome,
CPF/CNPJ, texto processual, URL assinada, conteúdo de documento ou token.

## 18. Estratégia de testes

### 18.1 Testes obrigatórios

- unitários para normalização, deduplicação e regras de estado;
- contrato com fixtures anonimizadas por fonte;
- propriedade/fuzz para CNJ, nomes de arquivo, manifestos e identificadores;
- integração com Supabase/PostgreSQL e storage locais;
- integração de fila e worker com serviços locais controlados;
- E2E dos modos simples e avançado;
- acessibilidade automatizada e navegação por teclado;
- testes de cancelamento de requisição ao trocar processo ou modo;
- mutation testing em autorização, isolamento, deduplicação e vinculação;
- scanners de segredo, dependência, SAST, container e IaC.

### 18.2 Matriz de isolamento

Devem falhar de forma segura:

- usuário pessoal A lendo processo de B;
- organização A lendo processo, documento ou exportação de B;
- membro removido reutilizando URL anterior;
- troca manual de `caseId`, `documentId` ou `exportJobId`;
- cache sem `organizationId` ou escopo pessoal;
- exportação contendo documento não selecionado;
- resposta atrasada de um processo substituindo outro;
- modo avançado revelando campo que o modo simples não recebeu por falta de
  autorização.

### 18.3 Documentos e exportações

Testar:

- fonte sem documento;
- documento que exige autenticação;
- redirecionamento para host não permitido;
- tentativa de SSRF para IP privado ou metadados da nuvem;
- MIME declarado diferente do conteúdo;
- arquivo maior que a quota;
- nomes com caminho, Unicode malformado e colisões;
- falha parcial preservando os arquivos válidos e o manifesto;
- hash e tamanho conferidos após download;
- pacote com múltiplos processos mantendo diretórios separados;
- expiração e revogação do download;
- concorrência e retry sem duplicar trabalho ou cobrança.

## 19. Critérios de aceitação

1. A Spec 0001 continua funcionando sem regressão durante a migração.
2. Modo simples e avançado exibem fatos idênticos para o mesmo processo.
3. A interface simples prioriza novidade, atenção, data e fonte sem exigir
   conhecimento jurídico.
4. A interface avançada oferece carteira, filtros e seleção múltipla sem carregar
   dados de outro tenant.
5. Alternar de modo preserva o contexto e não permite resposta atrasada misturar
   processos.
6. Todo processo exibido possui CNJ e procedência no mesmo contexto visual.
7. Busca por nome mantém aviso de homônimo e exige confirmação de candidato.
8. Busca por CPF/CNPJ/OAB informa limites reais da fonte e não promete cobertura
   completa.
9. Monitoramento diário é idempotente e não cria alertas duplicados.
10. Fonte indisponível produz estado parcial e preserva o último dado válido.
11. Documento só é aberto após autorização server-side para usuário,
    organização e processo.
12. Gateway rejeita URL arbitrária, host não autorizado, IP privado e redirect
    inseguro.
13. Download em lote cria trabalho assíncrono e retorna progresso por contagens.
14. Pacote ZIP contém manifestos, hashes e diretórios separados por CNJ.
15. Falha de um documento resulta em pacote parcial verificável.
16. Nenhum pacote contém documento fora da seleção autorizada.
17. Exportações expiram e deixam de ser acessíveis em até 24 horas.
18. Bucket de documentos e exportações impede acesso público.
19. Logs não contêm dados pessoais, texto processual, documentos ou URLs
    assinadas.
20. Pessoa física não consegue cadastrar CPF de terceiro no fluxo público.
21. Dados oficiais, normalizados e explicações são distinguíveis.
22. O frontend atende as metas de acessibilidade e desempenho definidas.
23. Código de aplicação e domínio mantém 100% de statements, branches, functions
    e lines.
24. Testes cross-tenant, E2E, scans e Terraform bloqueiam promoção quando falham.
25. Nenhuma feature desta spec é anunciada para um tribunal antes de passar pelo
    teste de capacidade daquele conector.

## 20. Entregas incrementais

### Fase A — Fundação multiusuário

- autenticação;
- organização, papéis e isolamento;
- modelo canônico de processo, fonte e monitoramento;
- Supabase/PostgreSQL e storage locais;
- trilha de auditoria mínima.

### Fase B — Experiência simples prioritária

- design system comum;
- Início, Meus processos e Detalhe;
- alternância de modo e primeira visão avançada sobre os mesmos dados;
- explicações determinísticas;
- estados de homônimo, fonte parcial e desatualização;
- alertas no painel.

### Fase C — Monitoramento confiável

- Scheduler e coletor idempotente;
- Cloud Tasks por alvo quando necessário;
- e-mail;
- métricas de cobertura e custo.

### Fase D — Documentos

- certidão DJEN e links oficiais;
- gateway brasileiro;
- referência de documentos;
- cache privado temporário;
- segurança e auditoria.

### Fase E — Modo profissional e lote

- carteira, clientes, OAB, filtros e tags;
- Central de documentos;
- export jobs, manifestos e pacote ZIP;
- limites por organização;
- saúde de fontes e auditoria ampliada.

### Fase F — Capacidades avançadas futuras

- IA com avaliação e citações;
- relatórios profissionais;
- webhooks e integrações;
- pesquisa jurídica, jurisprudência e conteúdo próprio sob specs separadas.

Cada fase exige critérios observáveis, TDD, infraestrutura por Terraform,
rollout controlado e rollback documentado. A aceitação desta spec não autoriza
deploy automático nem abertura pública do serviço.

## 21. Rollout e rollback

- funcionalidades são protegidas por configuração server-side por ambiente e
  perfil;
- modo simples permanece fallback quando o módulo avançado falhar;
- gateway inicia com allowlist restrita e poucos conectores;
- download em lote começa em development com dados sintéticos;
- piloto real exige revisão jurídica, threat model e política de retenção;
- falha operacional desabilita novos trabalhos sem remover pacotes válidos antes
  da expiração;
- rollback de API mantém compatibilidade com trabalhos já criados ou os encerra
  explicitamente com estado seguro.

## 22. Referências

- [Funcionalidades do plano Jusbrasil Processos](https://suporte.jusbrasil.com.br/hc/pt-br/articles/8488202195476-Quais-s%C3%A3o-as-funcionalidades-do-plano-Jusbrasil-Processos)
- [Planos e recursos atuais do Jusbrasil](https://www.jusbrasil.com.br/pro)
- [API pública do DJEN](https://hcomunicaapi.cnj.jus.br/swagger/index.html)
- [Portaria CNJ nº 374/2026](https://atos.cnj.jus.br/atos/detalhar/6972)
- [Engineering Guardrails](../../ENGINEERING_GUARDRAILS.md)
