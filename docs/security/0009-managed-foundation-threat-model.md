# Threat model 0009 — fundação gerenciada passiva

**Status:** revisado para implementação plan-only  
**Data:** 31 de agosto de 2026  
**Escopo:** Specs 0029/0030 e ADR 0023

## Ativos e fronteiras

Ativos futuros: documentos/evidências, exportações, URLs PostgreSQL, chaves de
identificador e identidades de workload. As fronteiras são Git/CI → Terraform,
Infisical → Secret Manager, Cloud Run → Supabase e Cloud Run → GCS.

Neste gate não há dados nem valores reais. O risco principal é o IaC criar uma
rota de ativação ou privilégio excessivo antes dos adapters estarem prontos.

## Ameaças e controles

| Ameaça | Impacto | Controles obrigatórios |
|---|---|---|
| `apply` acidental | custo/mutação externa | flag falsa; acknowledgement; workflow sem rollout; custo 0036 não autoriza deploy |
| secret em plan/state | comprometimento de banco/chaves | somente containers; proibir versions/data values/outputs; secret scan |
| bucket público | exposição processual | PAP enforced; uniform access; nenhum principal público; IAM por bucket |
| leitura/escrita sem trilha | investigação impossível | Cloud Audit Logs DATA_READ/DATA_WRITE; paths sem PII; retenção/custo revisados no piloto |
| destruição de evidência | perda e não conformidade | force destroy false; deletion policy PREVENT; prevent_destroy; version/soft delete |
| retenção ilimitada | custo e violação de minimização | expiração de versões arquivadas; custo e lifecycle revisados |
| identidade compartilhada | movimento lateral | service account por workload; grants exatos por secret/objeto |
| API grava/apaga objetos | adulteração ou purge indevido | API somente viewer; materializador creator+viewer sem delete/overwrite; lifecycle objectUser |
| worker iniciado sem adapter | perda em filesystem efêmero | Jobs/Scheduler fora do gate; modos GCS explícitos e contract tests verdes |
| supply-chain/provider drift | configuração inesperada | provider major pin + lock; actions/imagens por digest; scanners e revisão |
| nome de bucket previsível | enumeração | não é controle de acesso; PAP/IAM continuam obrigatórios |

## Casos negativos obrigatórios

- plano padrão não contém recurso `managed_foundation`;
- acknowledgement ausente rejeita opt-in;
- não existe `google_secret_manager_secret_version`;
- não existe IAM público nem papel de storage no projeto;
- monitoring/dispatcher não recebem acesso ao bucket;
- document worker não recebe delete/overwrite; read serve somente à verificação
  idempotente de locator determinístico;
- API não recebe create/delete;
- nenhum output retorna key, connection string ou secret payload.

## Risco residual e próxima revisão

Soft delete e versionamento retêm objetos apagados por sete dias; essa janela
deve aparecer no aviso de privacidade e no runbook de exclusão antes de dados
reais. CMEK não impede acesso por uma identidade já autorizada. A próxima
revisão deve cobrir Secret Sync, pin de versões, egress Supabase/GCP, logs e
execução autenticada de Jobs/Scheduler.
