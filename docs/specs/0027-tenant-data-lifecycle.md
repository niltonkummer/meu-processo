# Spec 0027 — ciclo de vida de dados do tenant

**Status:** implementado e validado localmente; exposição API/UI pendente  
**Data:** 31 de agosto de 2026  
**Requisitos:** `FND-012`, `FND-013`, `FND-015`, `FND-019`  
**Custo:** [Avaliação 0034](../costs/0034-local-data-lifecycle-foundation.md)

## 1. Problema e resultado

O produto já persiste identidade, identificadores protegidos, monitoramento,
evidência processual, alertas e documentos por tenant. Antes de um piloto, o
titular precisa poder obter uma cópia inteligível dos seus dados e pedir a
exclusão do espaço pessoal sem apagar ou revelar dados de outro tenant.

O resultado desta fatia é uma fundação local, assíncrona, idempotente e
auditável para exportação, expiração e exclusão. Ela não publica ainda uma rota
de exclusão: reautenticação recente e confirmação de alto atrito serão uma fatia
HTTP/frontend separada.

## 2. Classificação e finalidade

| Classe | Exemplos atuais | Escopo | Exportar | Excluir ao encerrar tenant | Retenção inicial |
|---|---|---|---:|---:|---|
| identidade | provider subject, membership, papel | usuário/tenant | sim, minimizado | pseudonimizar/desativar | enquanto conta ativa; tombstone técnico após exclusão |
| identificador sensível | nome, CPF/CNPJ cifrado e HMAC | tenant | valor revelado somente no worker | sim | enquanto monitoramento ativo |
| configuração | alvo, fonte, agenda, estado | tenant | sim | sim | enquanto tenant ativo |
| processo/evidência oficial | processo, evento, envelope, documento | tenant-private nesta fase | sim | sim | conforme vínculo e revisão jurídica |
| preferência/projeção | carteira, alerta, leitura | tenant | sim | sim | enquanto tenant ativo |
| entrega e segurança | autorização/outcome de download | tenant | resumo técnico | sim | 90 dias no máximo, política futura |
| operação | execução, receipt, outbox/inbox, job | tenant | contagens/estado, sem lease/token | sim | 30–90 dias, política futura |
| exportação | manifesto e objeto JSON | tenant | é o próprio artefato | expirar/apagar | 24 horas |
| tombstone/auditoria | IDs técnicos, tempos, contagens e resultado | controle restrito | não no artefato comum | preservar sem PII | prazo jurídico a definir antes de produção |

Não existe nesta implementação um corpus público compartilhado. Toda evidência
atual é `tenant-private` conforme ADR 0021 e, portanto, é removida com o tenant.
Uma futura promoção para evidência global deverá separar grant privado de fato
público antes de reutilizar este fluxo.

## 3. Atores e autorização

- somente membership ativa `owner` de tenant `personal` ativo solicita
  exportação ou exclusão;
- IDs de tenant e usuário vêm do `RequestContext`, nunca do corpo da operação;
- a API comum solicita por função estreita; não recebe grants nas tabelas;
- o worker usa role dedicada, sem login, ownership, `BYPASSRLS` ou grants de
  tabela, e chama apenas funções `security definer` allowlisted;
- claims usam `FOR UPDATE SKIP LOCKED`, lease curto e somente SHA-256 do token
  persistido;
- operação sobre outro tenant falha de forma indistinguível e não produz linha.

Organizações e deleção de apenas um membro ficam fora desta fatia porque exigem
política de múltiplos responsáveis e transferência de ownership.

## 4. Modelo persistente

`tenant_data_lifecycle_requests` contém:

- `tenant_id`, `request_id`, `requested_by_user_id` e `request_type`;
- estado `pending | running | completed | failed | expired`;
- lease, tentativas limitadas, `next_attempt_at` e código de erro allowlisted;
- para exportação: schema version, locator opaco, SHA-256, bytes e expiração;
- para exclusão: instante de congelamento/finalização e contagens sem conteúdo;
- timestamps `timestamptz`, constraints e FKs compostas tenant-bound.

Uma única solicitação não terminal de cada tipo pode existir por tenant. Índices
parciais cobrem fila pendente/retry e expiração; FKs recebem índices próprios.
RLS é habilitada e forçada. O runtime não recebe `SELECT` direto na tabela.

`tenant_deletion_tombstones` é isolada do runtime e guarda apenas `tenant_id`,
`request_id`, `deleted_at`, versão da política e contagens de linhas/objetos. Não
guarda provider subject, nome, CPF/CNPJ, CNJ, conteúdo, locator ou token.

## 5. Fluxo de exportação

1. `request`: valida owner/tenant ativo e cria ou devolve a solicitação
   idempotente.
2. `claim`: worker reivindica no máximo dez itens, concorrência local um.
3. `snapshot`: uma transação curta lê somente o tenant reivindicado e devolve
   uma projeção minimizada; o valor do identificador é revelado apenas em
   memória pelo protetor existente.
4. `write`: fora da transação, o worker serializa JSON determinístico UTF-8,
   limita a 10 MiB, calcula SHA-256 e grava em
   `exports/{tenantId}/{requestId}/{artifactId}.json` no storage privado.
5. `complete`: a função compara tenant/request/lease hash, registra metadados e
   `expires_at = completed_at + 24 hours`.
6. `expire`: worker apaga o objeto de modo idempotente e só então marca a
   solicitação `expired`; falha de objeto permanece reconciliável.

O artefato possui `schemaVersion`, `generatedAt`, contexto do tenant,
identificadores monitorados revelados, configurações, carteira, eventos,
documentos, alertas e resumo operacional. Ele não contém ciphertext, HMAC,
provider subject bruto, lease, token, URL assinada, caminho local, payload bruto
nem dados de outro tenant. Campo não implementado aparece em `omitted` com razão;
ausência nunca é apresentada como exportação completa.

## 6. Fluxo de exclusão

1. a camada de aplicação exige confirmação explícita e cria o pedido;
2. na mesma transação, tenant muda para `deleting`, memberships ficam inativas,
   alvos deixam de ser agendados e novos acessos falham fechados;
3. o worker remove agregados tenant-private em fases e ordem de FK: entregas e
   materializações; documentos; alertas/timeline/evidência/casos; inbox/outbox e
   execuções; vínculos, estados, alvos e sujeitos;
4. objetos privados listados antes da remoção são apagados/reconciliados fora da
   transação; nenhum nome ou identificador entra no locator;
5. finalização mantém somente tenant/membership técnicos desativados, pedido e
   tombstone; `provider_subject` é substituído por valor técnico irreversível e
   o usuário vira `deleted` quando não tiver outra membership ativa;
6. tenant muda para `deleted`; repetir qualquer fase ou finalização é seguro.

Falha após congelamento não reativa automaticamente o tenant. A operação vai a
retry limitado e depois `failed`, exigindo runbook e decisão humana. O rollback
de código não reabre conta nem restaura dado já apagado.

## 7. Retenção, backup e restore

- exportação: TTL rígido de 24 horas, inclusive objeto;
- artefatos documentais: respeitam `expires_at` existente e são reconciliados;
- jobs/logs técnicos: política alvo 30–90 dias, sem conteúdo/PII;
- tombstone/auditoria: sem PII e prazo ainda bloqueado por revisão jurídica;
- backup anterior a uma exclusão expira pelo lifecycle do backup e não é usado
  para restaurar seletivamente a conta apagada;
- restore sintético deve preservar schema, RLS, grants e pedido/tombstone sem
  ressuscitar membership ou dados excluídos.

Esta fatia não define retenção gerenciada do Supabase/GCS. Esses valores exigem
avaliação de custo, DPA, RPO/RTO e teste em sandbox antes de produção.

## 8. Falhas e segurança operacional

- nenhum log contém conteúdo do export, identificador revelado ou locator;
- métricas usam tipo/estado/contagem e correlation ID técnicos;
- erro externo é allowlisted; mensagem interna não é persistida;
- tamanho, lote, concorrência, lease e tentativas têm limite fixo;
- transação não inclui escrita/leitura de object storage;
- objeto órfão ou linha sem objeto é detectado por reconciliação;
- ausência de protetor, storage ou role correta impede startup/claim.

## 9. TDD e critérios de aceite

1. pgTAP prova constraints, índices de FKs, RLS forçada e ausência de grants.
2. contrato memória/PostgreSQL prova request, idempotência, claim, lease,
   complete, retry, dead-end e expiração.
3. usuário A não solicita, vê, conclui ou exclui tenant B.
4. export contém apenas projeção A, é determinístico, legível, limitado e não
   contém ciphertext/HMAC/token/provider subject.
5. dois workers produzem um único claim e token obsoleto nunca conclui.
6. exclusão congela acesso imediatamente e purge repetido não falha nem toca B.
7. tombstone não contém PII e tenant excluído não pode ser reprovisionado por
   acidente com o mesmo contexto.
8. expiração apaga primeiro o objeto e marca depois; falha é reconciliável.
9. backup/restore local mantém grants/RLS e não ressuscita dados excluídos.
10. cobertura de aplicação/domínio permanece 100%; suíte, lint, typecheck,
    build, secret/dependency/container scans passam.

## 10. Rollout e rollback

Rollout local: migration aditiva → pgTAP → contratos → worker one-shot com
fixtures sintéticas → backup/restore → suíte completa. Não existe backfill.

Rollback antes de uso descarta o banco efêmero e reaplica 0001–0011. Depois de
um pedido, o código pode parar novos claims, mas não remove tabelas nem reverte
`deleting/deleted`; recuperação segue runbook. Produção exige expand/verify,
feature flag, backup verificado e avaliação própria.

## 11. Fora de escopo

- endpoint/frontend público de exclusão, reautenticação recente e recuperação;
- exclusão de membro/organização, disputa legal ou legal hold;
- Supabase/GCS reais, lifecycle cloud, signed URL e download do artefato;
- retenção definitiva de auditoria/backups e revisão jurídica LGPD;
- corpus público compartilhado e promoção de evidência;
- e-mail de confirmação, deploy, commit ou dados reais.
