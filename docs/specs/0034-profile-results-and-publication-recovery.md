# Spec 0034 — resultados por perfil e recuperação de publicação

**Status:** aprovado para implementação
**Data:** 31 de agosto de 2026
**Custo:** [Avaliação 0043](../costs/0043-search-result-aggregation-and-publication-recovery.md)
**Decisão:** [ADR 0026](../adr/0026-profile-case-summary-projection.md)

## 1. Problema e resultado esperado

A lista de perfis monitorados mostra somente um rótulo minimizado. O usuário não
consegue saber quantos processos já foram associados a cada pessoa ou visualizar
um resumo sem refazer uma consulta. Além disso, o fluxo de publicação pode ficar
aparentemente parado e a descoberta visual do CAPTCHA pode selecionar um ícone
de áudio ou não reconhecer a superfície renderizada pelo tribunal.

O painel deve apresentar uma lista compacta por perfil com quantidade de
processos e até três processos recentes. Uma consulta concluída na sessão atual
deve aparecer imediatamente na lista de resultados, sem misturar consultas ou
homônimos. O download deve comunicar cada fase e apresentar apenas um CAPTCHA
visual válido para resposta humana.

## 2. Comportamento da agregação

- Cada perfil retorna `processCount` e `processSummary` com no máximo três itens.
- A contagem usa casos distintos vinculados explicitamente ao `subject_id` por
  evidência/alerta do pipeline; nome, texto parecido ou rótulo não criam vínculo.
- A consulta é única e paginada, sem N+1, sempre filtrada pelo tenant autenticado.
- O resumo contém somente CNJ, tribunal e data da atividade mais recente.
- Os itens são ordenados por atividade mais recente e identificador estável.
- Perfis sem projeção mostram zero e “Aguardando a primeira atualização”.
- A resposta de criação continua sem expor valor cifrado, referência protegida
  ou nome completo armazenado.
- Durante a sessão do navegador, buscas concluídas ficam em uma lista em memória,
  agrupadas pelo identificador exato da busca. A lista não é persistida em Web
  Storage e cada item mostra nome/rótulo, quantidade e até três processos.

## 3. Comportamento do download e CAPTCHA

- A navegação começa a inspeção no marco `commit`, tolera até 45 segundos para a
  resposta inicial e observa CAPTCHA/PDF por até 30 segundos.
- A sessão ponta a ponta continua limitada a 120 segundos e não faz retry ou
  reconexão automática.
- A descoberta aceita uma imagem carregada, um canvas com conteúdo ou uma
  superfície renderizada marcada por `data-url`/imagem de fundo quando estiver
  próxima ao campo de segurança.
- Elementos marcados como áudio, som, speaker ou volume nunca são escolhidos
  como CAPTCHA visual.
- Imagem sem dimensões/conteúdo ou resposta vazia não é enviada.
- O painel anuncia estados de conexão, espera da fonte, espera do usuário,
  validação e download concluído/erro por `aria-live`.
- Um novo desafio rejeitado substitui o anterior e informa que o código não foi
  aceito.
- O sistema não interpreta, resolve, terceiriza nem contorna CAPTCHA. A resposta
  é sempre fornecida pelo usuário e permanece no contexto efêmero da sessão.

## 4. Casos observáveis

### Sucesso

1. O usuário vê cada perfil com a contagem e os três processos mais recentes.
2. Uma nova busca aparece na lista da sessão e pode abrir seu detalhe completo.
3. Ao solicitar uma publicação, o painel informa que está conectando.
4. O CAPTCHA visual correto aparece, o usuário responde e o PDF validado é
   baixado uma vez.
5. Uma resposta direta em PDF continua funcionando sem CAPTCHA.

### Ausência e erro

- Perfil sem caso vinculado: contagem zero, sem inferir ausência de processos.
- Fonte sem CAPTCHA ou PDF em 30 segundos: erro recuperável, nunca spinner eterno.
- Somente ícone de áudio ou elemento vazio: nenhum desafio é enviado ao usuário.
- CAPTCHA expirado/rejeitado: orientar nova tentativa no mesmo fluxo permitido.
- Falha da origem: preservar resultados já conhecidos e não criar resumo falso.
- Resposta cross-tenant ou projeção malformada: falhar de forma fechada.

## 5. Privacidade e segurança

- Toda agregação usa `tenant_id` da transação autenticada e RLS forçada.
- CNJ de outro tenant não pode aparecer mesmo que `case_id` ou nome coincidam.
- O frontend não persiste nome, CPF/CNPJ, token, CNJ ou resposta de CAPTCHA.
- Logs não contêm nome, CPF/CNPJ, CNJ, comunicação, URL, HTML, imagem, resposta
  do CAPTCHA ou conteúdo do documento.
- A origem, allowlist, DNS público, HTTPS, tamanho e integridade do PDF não são
  relaxados.

## 6. Estratégia de testes e critérios de aceitação

1. Testes de regressão falham antes da implementação para a ausência de
   contagem/resumo e para a seleção incorreta de controle de áudio.
2. Repositórios em memória e Postgres cumprem o mesmo contrato público; o teste
   Postgres comprova contagem distinta, limite três, ordenação e isolamento.
3. O cliente rejeita contagem negativa, resumo com mais de três itens, chaves
   extras, CNJ/data inválidos e payload protegido.
4. A interface mostra contagem, vazio explícito, resumo e lista de buscas da
   sessão em desktop e celular.
5. Fixtures DOM cobrem `img`, `canvas`, `data-url`, imagem de fundo, ícone de
   áudio e superfície vazia.
6. Testes do fluxo cobrem estados, desafio rejeitado, resposta vazia, PDF e erro.
7. Cobertura rastreada permanece 100%; lint, typecheck e build passam.
8. Testes de banco, isolamento, contratos e scans não apresentam regressão ou
   finding High/Critical novo.

## 7. Rollout e rollback

Rollout exige solicitação explícita posterior. Em `validation`, aplicar o mesmo
artefato e executar smoke sintético antes de uma tentativa institucional
controlada. Interromper após cinco falhas consecutivas, mistura de processos,
sessão acima de 120 segundos ou custo projetado acima de US$ 10/mês.

Rollback restaura a versão anterior da API/painel/renderer. Não existe migração
destrutiva, backfill ou novo recurso de nuvem.
