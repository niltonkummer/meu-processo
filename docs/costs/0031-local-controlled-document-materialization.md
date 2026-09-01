# Avaliação de custo 0031 — materialização controlada local de documentos

<!-- infra-cost-assessment:v1 -->

**Status:** aprovado para implementação  
**Solicitado por:** proprietário do produto  
**Responsável:** engenharia do Meu Processo  
**Data da avaliação:** 31 de agosto de 2026  
**Ambientes afetados:** local e CI  
**Spec/issue:** Spec 0024 — materialização controlada de documento público

**Custo mensal atual (USD):** até US$ 0,38 já aprovado; execução local US$ 0  
**Custo mensal esperado (USD):** inalterado; delta US$ 0  
**Custo mensal limite (USD):** inalterado; este gate não pode consumir cloud  
**Aprovação:** proprietário, continuação explícita do plano em 31/08/2026,
restrita ao adapter local e a dados sintéticos

## 1. Decisão

Implementar localmente o caminho assíncrono que transforma o metadado de um
documento público em artefato privado verificável. O gate inclui fila durável no
PostgreSQL local, claim com lease, conector por fixture, quarentena privada,
scanner determinístico local, gravação atômica, reconciliação de falhas e
auditoria sem conteúdo processual.

O impacto de infraestrutura e custo é zero. Não serão ativados GCS, Cloud Run
Job, Cloud Tasks, Pub/Sub, Workflows, API judicial, proxy, antivírus SaaS ou
qualquer serviço gerenciado. O adapter de fixture não aceita URL nem rede.

## 2. Alteração de infraestrutura

| Componente/SKU | Região | Estado atual | Estado proposto | Quantidade | Custo unitário | Delta mensal |
|---|---|---|---|---:|---:|---:|
| PostgreSQL do Compose | máquina local | catálogo de documentos | fila, leases e outcomes de materialização | 1 descartável | US$ 0 | US$ 0 |
| Filesystem privado | máquina local | objetos materializados somente leitura | quarentena e publicação atômica em diretórios ignorados pelo Git | até 250 MiB por execução | US$ 0 | US$ 0 |
| Worker Node.js | máquina local/CI | workers one-shot existentes | novo worker one-shot, sem scheduler | concorrência 1 | US$ 0 | US$ 0 |
| GCS/filas/jobs/scanner externo | — | desativados | permanecem desativados | 0 | — | US$ 0 |

Não há custo único de implantação, migração cloud, backfill, recuperação ou
egress. O schema novo é exercitado apenas em bancos descartáveis locais/CI.

## 3. Premissas e cenários

| Direcionador | Base atual | Esperado | Limite operacional | Unidade |
|---|---:|---:|---:|---|
| Claims por execução | 0 | 1–3 | 10 | documentos |
| Concorrência | 0 | 1 | 1 | processo worker |
| Tamanho por documento | 0 | até 2 | 25 | MiB |
| Bytes temporários | 0 | até 6 | 250 | MiB por execução |
| Retenção da fixture/quarentena | 0 | duração do teste | 24 | horas |
| Chamadas de rede | 0 | 0 | 0 | por execução |
| Logs | 0 | métricas agregadas | sem bytes/conteúdo | conteúdo processual |

O cenário atual, esperado e limite custam US$ 0 porque executam em recursos já
presentes na máquina do desenvolvedor ou no runner efêmero de CI. O limite é
aplicado no código e configuração, não apenas por convenção operacional.

## 4. Custos não cobertos automaticamente

- Cloud Run, GCS, egress, filas, e-mail, APIs, IA e suporte: não consumidos.
- Infracost: não aplicável, pois nenhum arquivo Terraform será alterado.
- Impostos e câmbio: não aplicáveis ao delta zero.
- Espaço e CPU do runner/local: já disponíveis; não há aquisição ou reserva.

## 5. Limites e condição de parada

- `batchSize` máximo 10 e concorrência efetiva 1;
- lease entre 30 segundos e 15 minutos;
- PDF máximo 25 MiB e buffer temporário total máximo 250 MiB;
- somente fixture cadastrada por identificador opaco, sem URL ou acesso à rede;
- quarentena e objeto final fora de `dist`, `web` e controle de versão;
- arquivo infectado, inválido, divergente ou não auditável nunca é publicado;
- repetição idempotente não cria segundo artefato nem sobrescreve objeto
  divergente;
- qualquer tentativa de usar cloud, fonte real ou armazenamento sem limite
  bloqueia o rollout e exige nova avaliação aprovada;
- somente o proprietário pode aceitar aumento; validade até 30/09/2026 ou
  mudança de escopo, o que ocorrer primeiro.

## 6. Evidência e fontes

- avaliação 0030 para a referência futura de GCS e seus preços;
- `docker compose config`, pgTAP, contratos PostgreSQL, testes unitários e fluxo
  real com fixture serão anexados à implementação;
- Infracost dispensado por diff Terraform vazio;
- limitação: esta avaliação não estima o futuro custo de rede, antivírus ou GCS.

## 7. Aprovação

Status **aprovado para implementação** local. A continuação solicitada pelo
proprietário autoriza código, migration, testes, Compose e documentação desta
fatia. Não autoriza commit, push, deploy, criação de recurso cloud, chamada a
fonte real nem uso de dado pessoal/processual real.

## 8. Verificação posterior

Não há deploy ou custo externo a verificar em 7/30 dias. Se o adapter cloud for
autorizado no futuro, uma nova avaliação deverá criar sua própria linha de base
e verificação posterior.

| Data | Custo estimado | Custo real | Variação | Explicação | Ação |
|---|---:|---:|---:|---|---|
| 31/08/2026 | US$ 0 | US$ 0 | US$ 0 | implementação local | manter cloud desativada |
