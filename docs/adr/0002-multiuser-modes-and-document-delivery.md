# ADR 0002 — Adotar uma base canônica com dois modos e entrega assíncrona de documentos

**Status:** aceito
**Data:** 2026-08-29
**Relacionado:** [Spec 0002 — Paridade funcional em acompanhamento processual](../specs/0002-process-monitoring-functional-parity.md)

## Contexto

Depois da validação stateless do DJEN, o produto precisa evoluir para monitoramento persistente destinado tanto a pessoa física quanto a advogados e escritórios. Esses públicos exigem níveis diferentes de linguagem e densidade, mas não podem receber versões divergentes do mesmo fato processual.

Documentos oficiais também podem estar acessíveis somente por redes brasileiras, variar por tribunal, exigir processamento demorado e ter tamanho incompatível com uma requisição web longa. Armazenar antecipadamente todos os documentos elevaria custo, retenção de dados pessoais e risco jurídico antes de existir demanda comprovada.

## Decisão

### Uma base e uma API

Manteremos uma representação canônica de processo, evento, publicação e documento. O frontend terá modo simples e avançado, ambos consumindo a mesma API, autorização e proveniência.

- modo simples organiza a informação por tarefas e explicações;
- modo avançado acrescenta carteira, filtros, ações em lote e auditoria;
- alternar o modo não altera fatos, acesso ou vínculos;
- módulos avançados serão carregados sob demanda.

### Identidade e estado operacional

- Firebase Authentication fornecerá identidade de usuário;
- autorização server-side usará escopo pessoal ou `organizationId` e papéis;
- Firestore armazenará perfis, alvos, assinaturas, processos normalizados, estado de coleta, alertas e trabalhos;
- respostas originais, cache temporário e exportações ficarão em buckets privados do Cloud Storage;
- toda infraestrutura será criada por Terraform e testada localmente com emuladores quando disponíveis.

### Documentos

Um gateway controlado no Cloud Run em `southamerica-east1` buscará e transmitirá documentos públicos obtidos por conectores oficiais. O cliente fornece somente um identificador interno. O gateway aplica autorização, allowlist, proteção contra SSRF, limites e auditoria.

O padrão será obter o documento sob demanda. Cloud Storage será usado como cache temporário e como área de trabalho para exportações, com lifecycle obrigatório. Não criaremos um arquivo nacional permanente nesta fase.

### Download em lote

- a API cria um `ExportJob` e retorna imediatamente;
- Cloud Tasks controla downloads, retries e limites por fonte;
- Cloud Run Jobs empacota trabalhos maiores quando uma requisição comum não for adequada;
- cada ZIP contém manifesto, hashes, falhas parciais e diretórios separados por CNJ;
- exportações expiram inicialmente em 24 horas;
- Google Cloud Workflows, Pub/Sub, Redis e mecanismo de busca dedicado não serão adicionados nesta fase.

## Consequências positivas

- pessoa física e profissional compartilham a mesma verdade processual;
- a experiência simples permanece leve mesmo com ferramentas avançadas;
- autorização e isolamento não dependem de componentes visuais;
- documentos bloqueados fora do Brasil podem ser transmitidos por um runtime brasileiro sem criar proxy aberto;
- armazenamento cresce com demanda real e tem expiração definida;
- exportações longas não mantêm conexões do navegador abertas;
- falhas parciais podem ser auditadas e entregues sem perder documentos válidos;
- a arquitetura evolui sem Workflows ou serviços de custo fixo prematuros.

## Consequências negativas e riscos

- autenticação, autorização e isolamento aumentam a complexidade antes do piloto externo;
- conectores por tribunal exigem manutenção contínua;
- cache e exportações criam obrigações de retenção, exclusão e auditoria;
- Cloud Tasks e Cloud Run Jobs adicionam estados assíncronos e retries que precisam ser idempotentes;
- o modo avançado pode degradar a experiência simples se o carregamento não for realmente separado;
- documentos públicos ainda podem conter dados sensíveis ou conteúdo malicioso;
- URLs assinadas, se adotadas, funcionam como credenciais temporárias e exigem validade curta.

## Controles compensatórios

- política deny-by-default e testes cross-tenant;
- uma representação canônica e testes contratuais entre os modos;
- gateway por `documentId`, nunca por URL fornecida pelo cliente;
- allowlist, validação de redirects, DNS/IP e MIME real;
- varredura de malware, tamanho máximo e nomes seguros;
- buckets com Public Access Prevention, lifecycle e IAM mínimo;
- logs sem dados pessoais, conteúdo ou URLs assinadas;
- quotas por usuário, organização, documento e exportação;
- feature flags server-side e rollout por conector;
- threat model e revisão jurídica antes de dados reais multiusuário.

## Alternativas consideradas

### Dois produtos ou dois frontends independentes

Rejeitada porque duplicaria regras, aumentaria risco de divergência factual e tornaria isolamento e acessibilidade mais difíceis de verificar.

### Proxy reverso genérico

Rejeitada por criar risco de SSRF, abuso como proxy aberto, vazamento de credenciais e custo sem escopo. O gateway resolve apenas documentos previamente registrados por conectores autorizados.

### Armazenar permanentemente todos os documentos

Rejeitada nesta fase por custo, coleta excessiva, retenção indefinida e ausência de finalidade comprovada para cada arquivo.

### Download síncrono em uma única requisição

Rejeitada por timeout, tamanho, falhas parciais, baixa retomada e experiência ruim em lotes maiores.

### Google Cloud Workflows

Rejeitada por enquanto porque fila, retry e empacotamento são atendidos por Cloud Tasks e Cloud Run Jobs com menos orquestração. A decisão será revista em backfills longos ou fluxos com múltiplas fontes dependentes.

### Mecanismo de busca dedicado desde o início

Rejeitada até haver volume e consultas que Firestore e índices direcionados não atendam. Uma futura adoção dependerá de medição de latência, custo e necessidade de texto livre.

## Critérios para revisar esta decisão

Revisaremos o ADR quando ocorrer pelo menos uma destas condições:

- exportações excederem consistentemente os limites de Cloud Run Jobs;
- mais de um consumidor independente precisar dos mesmos eventos;
- cache temporário não atender requisitos legítimos de retenção;
- consultas textuais exigirem índice dedicado;
- conectores precisarem de credenciais oficiais do usuário;
- legislação, termos das fontes ou política de documentos mudarem;
- medição mostrar que armazenamento prospectivo é mais barato e confiável que acesso sob demanda.
