# Spec 0008 — panorama funcional e requisitos-alvo da plataforma

**Status:** aceita para planejamento; implementação depende do roadmap e de gates por fatia
**Data da pesquisa:** 30 de agosto de 2026
**Responsável de produto:** Meu Processo
**Relacionadas:** [Spec 0002](./0002-process-monitoring-functional-parity.md), [Roadmap 0008](../implementation/0008-functional-requirements-roadmap.md)

## 1. Decisão de produto

O Meu Processo adotará como referência as necessidades atendidas pelas
plataformas Jusbrasil para pessoas, profissionais e organizações. A referência
é funcional: identifica resultados, fluxos e expectativas do mercado. Ela não
autoriza copiar marca, textos, código, desenho de interface, taxonomias
proprietárias, acervo editorial, doutrina, modelos, peças, índices ou base de
dados de terceiros.

A base do produto será construída com fontes oficiais, dados fornecidos pelo
próprio usuário e fontes licenciadas cuja finalidade seja compatível. Cada fato
deve manter fonte, identificador, versão/hash e horário de coleta. Funcionalidade
sem fonte juridicamente e tecnicamente sustentável será adiada ou excluída.

O produto terá quatro camadas progressivas:

1. **Acompanha:** descoberta direcionada, linha do tempo, alertas e documentos
   para pessoa física.
2. **Profissional:** carteira, OAB, clientes, equipe, filtros e operações em lote.
3. **Pesquisa e IA:** pesquisa jurídica própria/licenciada e assistência com
   citações verificáveis.
4. **Soluções:** API, integrações, monitoramento em escala e relatórios
   corporativos, sujeitos a revisão jurídica específica.

## 2. Método, evidência e limitações

O inventário foi produzido por navegação manual e pontual nas superfícies
oficiais do Jusbrasil, incluindo páginas públicas, Central de Ajuda e menus de
uma sessão autenticada autorizada pelo proprietário. Nenhuma resposta
processual, dado de parte, informação de cobrança ou dado da conta foi copiado
para o repositório.

Legenda usada no catálogo:

- **observado:** disponível na interface ou documentação oficial consultada;
- **adaptar:** entregar o mesmo resultado com arquitetura, dados e UX próprios;
- **adiar:** capacidade válida, mas não necessária para validar o núcleo;
- **licenciar:** não implementar sem direito de uso do conteúdo ou fonte;
- **excluir:** incompatível com privacidade, termos, precisão ou estratégia.

Este é um panorama verificável em 30/08/2026, não uma garantia de que todos os
experimentos, contratos privados ou recursos futuros do concorrente estejam
representados. Planos, limites e nomes comerciais podem mudar. Antes de cada
implementação, os contratos e fontes relevantes devem ser novamente validados.

## 3. Catálogo funcional observado e decisão-alvo

### 3.1 Conta, identidade, preferências e privacidade

| Capacidade observada | Decisão no Meu Processo | Fase |
|---|---|---|
| Cadastro, login, logout e recuperação de acesso | adaptar com identidade gerenciada e sessão segura | Fundação |
| Perfil de pessoa e de profissional | adaptar sem publicar perfil por padrão | Fundação/Profissional |
| Validação de CPF e OAB para vínculos restritos | adaptar somente com finalidade e fonte compatíveis | Profissional |
| E-mail, telefone e senha | adaptar com verificação de canal e minimização | Fundação |
| Preferências de notificações por e-mail e WhatsApp | adaptar por canal, evento e alvo | Acompanha/Profissional |
| Assinatura, limites, alteração de plano e faturamento | adiar até existir uso recorrente e oferta aprovada | Comercial |
| Controle de descoberta por buscadores | não indexar perfis ou dados processuais por padrão | Fundação |
| Download de dados pessoais | implementar | Fundação pública |
| Desativação e exclusão permanente de conta | implementar com retenção legal documentada | Fundação pública |
| Relatórios de privacidade e políticas | adaptar como central de privacidade e auditoria | Fundação pública |

### 3.2 Navegação e pesquisa geral

| Capacidade observada | Decisão no Meu Processo | Fase |
|---|---|---|
| Navegação entre consulta processual e pesquisa jurídica | adaptar em módulos separados e leves | Fundação/Pesquisa |
| Busca global por várias classes de conteúdo | adiar até existir corpus próprio/licenciado | Pesquisa |
| Histórico de itens recentemente acessados | adaptar por usuário, com retenção curta e opção de limpar | Acompanha |
| Pesquisa unificada em jurisprudência, peças, doutrina, modelos, legislação, artigos e notícias | licenciar ou usar fontes oficiais por vertical | Pesquisa |

### 3.3 Consulta e descoberta de processos

| Capacidade observada | Decisão no Meu Processo | Fase |
|---|---|---|
| Consulta por número CNJ | implementar como identificação primária | Fundação |
| Consulta por nome | implementar como descoberta de candidatos, nunca confirmação de identidade | Fundação |
| Consulta por CPF | implementar somente quando houver fonte precisa e uso autorizado; documento próprio verificado para pessoa física | Fase posterior |
| Consulta por CNPJ/razão social | adaptar para organizações autorizadas e fontes compatíveis | Profissional |
| Consulta por OAB e UF | implementar para perfil profissional validado | Profissional |
| Resultados agregados e paginados | implementar com cobertura, fonte e atualização visíveis | Fundação |
| Vínculo preciso entre documento e processo, evitando homônimos | implementar apenas quando sustentado pela fonte; nunca inferir | Profissional/Soluções |
| Filtros por parte, polo, tribunal, classe, assunto, fase e período | evoluir conforme os campos confiáveis de cada fonte | Profissional |
| Consulta em lote | implementar por trabalho assíncrono, com finalidade e quotas | Soluções |
| Varredura de toda a base nacional para buscador público de pessoas | excluir do produto inicial | Excluído |

Regras obrigatórias:

- número CNJ normalizado identifica processo; sem CNJ, a identidade é composta e
  permanece provisória;
- nome semelhante não une pessoas ou processos;
- um resultado por nome é sempre “candidato” até confirmação determinística;
- “nenhum resultado nas fontes consultadas” nunca significa “não existem
  processos”;
- consultas de CPF/CNPJ não podem ser simuladas por busca textual e apresentadas
  como vínculo preciso;
- consultas sensíveis exigem finalidade, autorização, quota e auditoria.

### 3.4 Acompanhamento e notificações

| Capacidade observada | Decisão no Meu Processo | Fase |
|---|---|---|
| Acompanhar processo específico | implementar | Acompanha |
| Acompanhar nome | implementar com alerta de homônimo e cobertura | Acompanha |
| Acompanhar CPF | restringir ao documento próprio ou finalidade profissional autorizada | Posterior |
| Monitorar OAB e menções em publicações | implementar separadamente do monitoramento de processos | Profissional |
| Descobrir novas distribuições | adaptar por conectores/fonte e declarar latência | Profissional/Soluções |
| Atualizações no painel | implementar como primeiro canal | Acompanha |
| Alertas por e-mail | implementar após verificação e entregabilidade | Acompanha |
| Alertas por WhatsApp | adiar até consentimento, templates e custo aprovados | Profissional |
| Alertas específicos de audiência e decisão | implementar somente com classificador medido e link para evidência | Profissional |
| Marcar como lido, silenciar e deixar de acompanhar | implementar sem apagar o fato oficial | Acompanha |
| Frequência e tipos de evento configuráveis | adaptar | Profissional |

Acompanhamento de nome, CPF, OAB e processo são assinaturas distintas. Um alerta
de OAB não prova que o advogado acompanha ou representa a parte; um alerta de
nome não prova identidade; acompanhamento de processo não descobre por si só
todos os processos futuros da pessoa.

### 3.5 Processo, linha do tempo e publicações

| Capacidade observada | Decisão no Meu Processo | Fase |
|---|---|---|
| Cabeçalho com CNJ, tribunal, órgão, classe, assunto e partes | implementar somente com campos fornecidos e contexto visível | Fundação |
| Linha do tempo de movimentações e publicações | implementar com eventos normalizados e originais distinguíveis | Fundação |
| Texto integral ou trecho de publicação | implementar com HTML decodificado e renderização segura como texto | Fundação |
| Classificação de decisão, despacho, audiência e outros eventos | adaptar com versão do classificador e confiança | Profissional |
| Status/fase do processo | mostrar como dado da fonte ou interpretação rotulada | Profissional |
| Link e consulta do original | implementar sempre que a fonte permitir | Fundação |
| Histórico e última atualização | implementar por fonte | Fundação |
| Dados restritos para parte/advogado validado | adiar até existir autorização e conector oficial | Posterior |
| Relatório consolidado de histórico | adaptar com manifesto de cobertura | Profissional |

### 3.6 Documentos e autos

| Capacidade observada | Decisão no Meu Processo | Fase |
|---|---|---|
| Listar documentos associados ao processo/evento | implementar conforme cobertura do tribunal | Acompanha |
| Abrir ou baixar documento individual | implementar por gateway brasileiro controlado | Acompanha |
| Consultar original na fonte | implementar | Acompanha |
| Acesso condicionado a CPF/OAB para documento restrito | somente por fluxo oficial e consentido; nunca compartilhar credencial | Posterior |
| Indicar indisponibilidade de autos | implementar com motivo conhecido e data | Acompanha |
| Download de petição inicial/auto completo | adaptar por conector e direito de acesso | Profissional |
| Download em lote e ZIP | implementar como diferencial, assíncrono e auditado | Profissional |
| Manifesto, hashes e falhas parciais do lote | implementar | Profissional |
| Cache temporário em Storage | implementar sob demanda, criptografado e com lifecycle | Profissional |
| Arquivo permanente nacional de documentos | excluir nesta etapa | Excluído |

Documentos são conteúdo não confiável. O produto valida tipo real, tamanho,
nome, redirects e origem; não renderiza HTML/SVG arbitrário; registra acesso sem
conteúdo sensível; respeita segredo de justiça e restrições da fonte.

### 3.7 Experiência para pessoa física

| Capacidade-alvo | Decisão | Fase |
|---|---|---|
| Início com “o que mudou” e “precisa de atenção” | implementar | Acompanha |
| Linguagem clara sem substituir orientação jurídica | implementar | Acompanha |
| Contexto fixo de pessoa → processo → evento → fonte | implementar | Fundação |
| Explicação determinística de tipos conhecidos | implementar antes de IA | Acompanha |
| Fluxos responsivos e aplicativo web leve | implementar; app nativo adiado | Fundação |
| Ajuda contextual para homônimos, cobertura e fonte indisponível | implementar | Fundação |

### 3.8 Modo profissional e organização

| Capacidade observada/alvo | Decisão no Meu Processo | Fase |
|---|---|---|
| Carteira densa com filtros e colunas | implementar como módulo carregado sob demanda | Profissional |
| Clientes, perfis, OABs, tags e responsáveis | implementar | Profissional |
| Importação e exportação CSV | implementar com prévia, validação e relatório de erros | Profissional |
| Seleção e ações em lote | implementar com confirmação e auditoria | Profissional |
| Múltiplos usuários | implementar com organizações e papéis | Profissional |
| Painel de uso e limites | implementar após entitlements server-side | Comercial |
| Auditoria de acesso, alteração e exportação | implementar | Profissional |
| Relatórios de carteira, cobertura e operação | implementar sem score jurídico opaco | Profissional |
| Integração com ERP/sistema jurídico | adiar para API/webhooks | Soluções |
| Cálculo automático de prazo fatal | excluir até validação jurídica e humana específica | Excluído |

### 3.9 Pesquisa jurídica

| Vertical observada | Recursos observados | Decisão-alvo |
|---|---|---|
| Jurisprudência | busca, múltiplos tribunais, filtros, decisões oficiais, apoio de IA | adaptar com fontes oficiais e índice próprio quando houver escala |
| Diários oficiais | termos, páginas/cadernos, download, alertas e cobertura por órgão | implementar primeiro para monitoramento direcionado; pesquisa ampla depois |
| Legislação | busca por tema/número, texto atualizado, data e versões anteriores | adaptar com fonte oficial e histórico verificável |
| Doutrina | busca em obras, capítulos, trechos e citação | licenciar; não copiar nem ingerir sem contrato |
| Peças processuais | busca em documentos reais, cópia de trechos, original e modelo | licenciar ou limitar aos documentos autorizados do próprio usuário |
| Modelos | busca, categorias, download, personalização e publicação | adiar; conteúdo próprio ou licenciado apenas |
| Artigos e notícias | descoberta e publicação editorial | adiar; não é necessária ao monitoramento |

Qualquer busca jurídica deve indicar corpus, período, tribunais/fontes, data de
indexação e limitações. Conteúdo oficial, editorial, de usuário e gerado por IA
nunca é apresentado como se tivesse a mesma autoridade.

### 3.10 Assistência por IA

Recursos observados incluem nova conversa, histórico pesquisável,
personalização, habilidades, importação de processo, criação de caso, análise de
autos, construção de peça, mapeamento de teses, pesquisa jurídica em conversa,
criação de documento e conteúdo educacional.

Decisão-alvo:

| Capacidade | Decisão | Fase |
|---|---|---|
| Explicar uma movimentação em linguagem simples | implementar com citações e escopo de um processo | IA inicial |
| Resumir autos e montar cronologia | implementar após avaliação de recuperação e citações | IA inicial |
| Conversas organizadas por caso | adaptar com isolamento estrito | IA inicial |
| Importar processo/documentos do próprio usuário | adaptar com autorização e malware scan | IA inicial |
| Pesquisa jurídica conversacional | adiar até existir corpus confiável | IA avançada |
| Rascunhar documento/peça | adiar; exigir revisão humana e referências | IA avançada |
| Mapear teses e comparar precedentes | adiar; exigir fontes e avaliação jurídica | IA avançada |
| Habilidades/prompts especializados | adaptar somente após testes por tarefa | IA avançada |
| Responder sem evidência ou misturar casos | excluir | Excluído |

A IA é uma camada derivada, nunca fonte oficial. Toda saída deve mostrar as
evidências usadas, data/modelo/versão, aviso de revisão humana e caminho para o
texto original. Falta de evidência produz recusa ou resposta limitada, não
complementação inventada.

### 3.11 Comunidade, conteúdo e diretório

| Capacidade observada | Decisão no Meu Processo | Fase |
|---|---|---|
| Publicar artigos e modelos | adiar; requer moderação, autoria e direitos | Ecossistema |
| Perfil público de autor/profissional | adiar e manter opt-in | Ecossistema |
| Diretório por área e cidade/UF | adiar; exige verificação e política de ranking | Ecossistema |
| Depoimentos de clientes | adiar; exige prova, moderação e consentimento | Ecossistema |
| Conteúdo educacional e notícias | adiar; pode ser parceria/editorial | Ecossistema |

Essas capacidades não entram no produto fundamental porque ampliam moderação,
SEO, reputação, fraude e tratamento de dados sem melhorar a confiabilidade do
monitoramento.

### 3.12 Soluções corporativas e API

| Capacidade observada | Decisão no Meu Processo | Fase |
|---|---|---|
| API de consulta por CNJ, nome, CPF e CNPJ | adaptar com finalidade, quota e contratos por campo | Soluções |
| Monitoramento contínuo e eventos classificados | adaptar | Soluções |
| Distribuição de novos processos | adaptar por fonte e SLA medido | Soluções |
| Busca/monitoramento por OAB | adaptar | Soluções |
| Monitoramento de diários e intimações | adaptar | Soluções |
| Download de autos e petição inicial | adaptar por autorização | Soluções |
| Webhooks e entrega em ERP | implementar com assinatura, retry e idempotência | Soluções |
| Consulta em lote | implementar assíncrona | Soluções |
| Background check e due diligence | adiar para revisão jurídica e finalidade estrita | Soluções posterior |
| Motor/score de risco | excluir do roadmap atual | Excluído |
| Critérios configuráveis e evidência auditável | somente se um futuro produto de decisão for aprovado | Excluído atual |
| Sandbox, documentação, chaves e métricas de uso | implementar antes de abrir API | Soluções |
| SLA e suporte dedicado | fase comercial após SLOs internos comprovados | Soluções |

## 4. Requisitos funcionais priorizados

Prioridades:

- **P0:** base confiável necessária para o MVP pessoal;
- **P1:** produto recorrente e documentos confiáveis;
- **P2:** operação profissional e comercial;
- **P3:** pesquisa, IA, API e ecossistema.

### 4.1 Fundação e confiança — P0

| ID | Requisito | Critério de aceite resumido |
|---|---|---|
| FUN-001 | Autenticar e autorizar no servidor | rota privada recusa anônimo; tenant vem do servidor |
| FUN-002 | Manter um contexto processual canônico | mesma fonte/evento produz o mesmo fato nos dois modos |
| FUN-003 | Preservar proveniência | todo fato possui fonte, ID/hash e `collectedAt` |
| FUN-004 | Separar fonte, normalização e explicação | UI e API identificam cada camada sem ambiguidade |
| FUN-005 | Impedir mistura entre tenants e processos | suíte cross-tenant e troca rápida de contexto passa |
| FUN-006 | Registrar cobertura por fonte | usuário vê consultado, parcial, indisponível e desatualizado |
| FUN-007 | Tratar ausência com precisão | nunca afirmar inexistência fora do corpus consultado |
| FUN-008 | Expor saúde da coleta | última execução, latência, falha e próximo retry sem PII |
| FUN-009 | Aplicar estados seguros na interface | loading, vazio, parcial, desatualizado, negado e erro são distintos |
| FUN-010 | Oferecer central de privacidade | exportação e exclusão têm fluxo e auditoria antes do piloto |

### 4.2 Descoberta e monitor pessoal — P0

| ID | Requisito | Critério de aceite resumido |
|---|---|---|
| DIS-001 | Cadastrar CNJ | formato inválido falha; válido mantém número e tribunal contextual |
| DIS-002 | Cadastrar nome e variações explícitas | variações não são inventadas e resultados ficam candidatos |
| DIS-003 | Agrupar publicações por CNJ | CNJs diferentes nunca se unem por nome/texto |
| DIS-004 | Confirmar ou rejeitar candidato | decisão é auditada e reversível sem alterar fonte |
| DIS-005 | Consultar sob demanda | resposta informa fontes, horário, parcialidade e paginação |
| MON-001 | Ativar/desativar alvo | somente alvo ativo entra na próxima coleta |
| MON-002 | Sincronização inicial | cadastro cria execução idempotente sem duplicar evento |
| MON-003 | Atualização agendada direcionada | somente alvos ativos/vencidos são selecionados |
| MON-004 | Detectar novidade | evento já conhecido não gera novo alerta |
| MON-005 | Alertar no painel | alerta abre exatamente o processo e evento corretos |
| MON-006 | Marcar lido/silenciar | preferência não altera nem remove evento oficial |

### 4.3 Processo, publicação e frontend — P0

| ID | Requisito | Critério de aceite resumido |
|---|---|---|
| CAS-001 | Mostrar cabeçalho fixo do processo | CNJ, tribunal e fonte permanecem visíveis no contexto |
| CAS-002 | Linha do tempo determinística | ordenação usa timestamp original e desempate documentado |
| CAS-003 | Decodificar HTML com segurança | entidades viram texto; HTML/script externo nunca executa |
| CAS-004 | Abrir original | link usa host/protocolo permitido e mantém contexto |
| CAS-005 | Mostrar possível homônimo | candidato não é rotulado como processo confirmado |
| UI-001 | Modo simples como padrão | tarefas principais funcionam no celular e por teclado |
| UI-002 | Régua de procedência | cada evento informa CNJ, tribunal, fonte e coleta |
| UI-003 | Desempenho | LCP < 2,5 s, INP < 200 ms, CLS < 0,1 no alvo definido |
| UI-004 | Acessibilidade | WCAG AA, foco, semântica e estados não dependem só de cor |

### 4.4 Documentos e notificações externas — P1

| ID | Requisito | Critério de aceite resumido |
|---|---|---|
| DOC-001 | Descobrir documentos por evento | lista explicita cobertura e indisponibilidade |
| DOC-002 | Baixar documento individual | autorização, allowlist, timeout, MIME e tamanho são validados |
| DOC-003 | Manter sessão humana quando exigida | desafio não é contornado; sessão não é compartilhada |
| DOC-004 | Auditar acesso | registra ator, documento interno, fonte e resultado sem conteúdo |
| NTF-001 | Verificar e-mail | canal só recebe dado processual após comprovação de posse |
| NTF-002 | Preferências granulares | usuário escolhe alvo e tipo de evento; opt-out é respeitado |
| NTF-003 | Entrega idempotente | retry não duplica mensagem; falha aparece no painel |
| EXP-001 | Criar exportação em lote | API retorna job e não mantém requisição longa |
| EXP-002 | Entregar pacote verificável | ZIP tem pastas por CNJ, manifesto, hashes e falhas parciais |
| EXP-003 | Expirar artefatos | objeto e URL expiram; acesso é tenant-scoped e auditado |

### 4.5 Profissional e organização — P2

| ID | Requisito | Critério de aceite resumido |
|---|---|---|
| ORG-001 | Criar organização e memberships | papéis deny-by-default e testes entre escritórios passam |
| ORG-002 | Compartilhar carteira com escopo | só membros autorizados veem cliente/processo |
| PRO-001 | Monitorar OAB/UF | assinatura e alerta de OAB não se confundem com processo |
| PRO-002 | Gerir clientes, tags e responsáveis | toda entidade mantém organização e auditoria |
| PRO-003 | Filtrar carteira | filtros combinados têm paginação estável e resultado reproduzível |
| PRO-004 | Importar CSV | prévia, erros por linha e nenhuma criação parcial silenciosa |
| PRO-005 | Exportar dados | escopo e campos são confirmados; arquivo expira |
| PRO-006 | Executar ação em lote | prévia, confirmação, idempotência e relatório final |
| ENT-001 | Aplicar limites de plano no servidor | UI e API leem o mesmo entitlement |
| ENT-002 | Medir consumo | processo, alvo, usuário, exportação e IA têm unidade auditável |

### 4.6 Pesquisa, IA e soluções — P3

| ID | Requisito | Critério de aceite resumido |
|---|---|---|
| RES-001 | Pesquisar corpus jurídico declarado | resposta informa fontes, período, atualização e filtros |
| RES-002 | Salvar pesquisa/alerta | consulta versionada pode ser reproduzida e desativada |
| AI-001 | Resumir um processo isolado | somente documentos autorizados do caso entram no contexto |
| AI-002 | Citar cada afirmação relevante | citação abre trecho/fonte; ausência produz limitação explícita |
| AI-003 | Registrar versão e avaliação | modelo, prompt/política e conjunto de evidência são auditáveis |
| AI-004 | Exigir revisão humana | rascunho não é protocolado nem tratado como parecer automático |
| API-001 | Autenticar cliente e aplicar escopo | chave/identidade não permite enumerar outro tenant |
| API-002 | Oferecer contratos versionados | breaking change usa nova versão e janela de migração |
| API-003 | Entregar webhooks confiáveis | assinatura, replay protection, retry e idempotência testados |
| API-004 | Operar sandbox e quotas | dado sintético, limites e métricas precedem acesso real |

## 5. Requisitos não funcionais

### 5.1 Exatidão e proveniência

- zero união por similaridade de nome;
- zero resposta atrasada exibida no contexto de outro processo;
- idempotência de coleta, alerta e exportação;
- conteúdo original imutável e normalização versionada;
- cobertura e frescor mensuráveis por fonte e tribunal;
- interpretação/classificação sempre rotulada com confiança e versão.

### 5.2 Segurança, privacidade e autorização

- deny-by-default e escopo de tenant no backend, cache, fila, bucket e busca;
- CPF/CNPJ mascarados em UI quando possível e ausentes de logs;
- sem token ou dado processual em Web Storage/service worker;
- finalidade, consentimento/base legal, retenção e exclusão documentados;
- documentos tratados como entrada hostil;
- rate limit, quota, auditoria e detecção de abuso em consultas sensíveis;
- dados de produção nunca usados em development/staging.

### 5.3 Disponibilidade e operação

- timeout, retry limitado, backoff e circuit breaker por fonte;
- falha externa preserva último dado válido e marca desatualização;
- jobs são retomáveis e possuem dead-letter/revisão operacional;
- SLOs e runbooks existem antes de compromisso comercial;
- logs e métricas usam IDs técnicos e não conteúdo processual.

### 5.4 Desempenho e acessibilidade

- metas web da seção UI-003 no fluxo pessoal;
- paginação server-side e cancelamento de requisições antigas;
- módulo profissional e IA carregados sob demanda;
- WCAG 2.2 AA como alvo, navegação completa por teclado e redução de movimento;
- datas exibidas em horário de Brasília com timestamp original preservado.

### 5.5 Qualidade e entrega

- spec-first, TDD e cobertura integral de aplicação/domínio;
- contratos anonimizados para cada conector;
- mutation tests em autorização, deduplicação e vínculo;
- Docker Compose/emuladores localmente;
- infraestrutura somente por Terraform;
- scans de segredo, SAST, dependência, licença, container e IaC;
- nenhuma fatia inicia sem avaliação de custo aprovada.

## 6. Fora do escopo e proibições

- copiar o acervo, ranking, UI, textos ou dados autenticados do Jusbrasil;
- usar scraping massivo como substituto não autorizado de licença;
- construir buscador público irrestrito de pessoas por nome, CPF ou CNPJ;
- contornar CAPTCHA, autenticação, geoblocking, rate limit ou segredo de justiça;
- comercializar DataJud ou outra fonte incompatível com essa finalidade;
- inferir identidade, culpa, risco ou prazo a partir de nome semelhante;
- score jurídico opaco, decisão automática adversa ou promessa de cobertura total;
- protocolar peças, calcular prazo fatal ou aconselhar juridicamente sem revisão
  humana e uma spec própria;
- armazenar todos os autos nacionais sem finalidade, retenção e custo aprovados.

## 7. Evidências oficiais consultadas

- [Consulta processual](https://www.jusbrasil.com.br/consulta-processual/)
- [Pesquisa jurídica](https://www.jusbrasil.com.br/iniciar-pesquisa/)
- [Jurisprudência](https://www.jusbrasil.com.br/jurisprudencia/)
- [Diários oficiais](https://www.jusbrasil.com.br/diarios/)
- [Peças processuais](https://www.jusbrasil.com.br/pecas/)
- [Modelos](https://www.jusbrasil.com.br/modelos-pecas/)
- [Legislação](https://www.jusbrasil.com.br/legislacao/)
- [Doutrina](https://www.jusbrasil.com.br/doutrina/)
- [Diretório de advogados](https://www.jusbrasil.com.br/advogados/)
- [Jus IA](https://ia.jusbrasil.com.br/)
- [Jusbrasil Soluções](https://solucoes.jusbrasil.com.br/)
- [APIs Jusbrasil Soluções](https://insight.jusbrasil.com.br/)
- [Documentação da API](https://api.jusbrasil.com.br/docs/index.html)
- [Como acompanhar processos](https://suporte.jusbrasil.com.br/hc/pt-br/articles/360050938432-Como-acompanhar-processos-no-Jusbrasil)
- [Diferença entre nome, CPF e processo](https://suporte.jusbrasil.com.br/hc/pt-br/articles/360053322611-Qual-a-diferen%C3%A7a-entre-acompanhar-um-nome-um-CPF-e-um-processo-no-Jusbrasil)
- [Monitoramento de OAB e acompanhamento de processos](https://suporte.jusbrasil.com.br/hc/pt-br/articles/7820826460308-Qual-a-diferen%C3%A7a-entre-Monitoramento-de-OAB-e-Acompanhamento-de-Processos)
- [Acesso a documentos de processos](https://suporte.jusbrasil.com.br/hc/pt-br/articles/360060414572-Como-acessar-documentos-de-processos-no-Jusbrasil)
- [Escopo do Jus IA](https://suporte.jusbrasil.com.br/hc/pt-br/articles/35776006089876-Qual-o-escopo-do-Jus-IA)
- [Planos de assinatura](https://suporte.jusbrasil.com.br/hc/pt-br/articles/19759490506516-Conhe%C3%A7a-os-planos-de-assinatura-do-Jusbrasil)

## 8. Critério de conclusão desta spec

Esta spec estará atendida como instrumento de planejamento quando:

1. cada requisito implementado estiver ligado a uma spec executável menor;
2. o roadmap indicar fase, dependências e gate de saída;
3. decisões arquiteturais estiverem registradas em ADRs;
4. capacidades adiadas/licenciadas não forem introduzidas por acidente;
5. cada PR declarar quais IDs desta spec atende e como foram testados.

Ela não autoriza implementar todo o catálogo em uma única entrega.
