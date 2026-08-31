# Avaliação 0022 — evidência processual local reconstruível

**Status:** aprovado somente para desenvolvimento local e CI  
**Data:** 31 de agosto de 2026  
**Teto adicional aprovado:** US$ 0/mês

## Escopo autorizado

- implementar o primeiro agregado de evidência com `SourceEnvelope`,
  `CaseRecord` e `TenantCase` em PostgreSQL descartável;
- integrar a gravação à conclusão transacional do worker com outbox mínima;
- validar deduplicação, replay, isolamento tenant, RLS, privilégios e restore;
- usar somente fontes, CNJs, tribunais, hashes e datas sintéticos;
- manter todo envelope como `TENANT_PRIVATE` até existir classificação jurídica
  aprovada para uma fonte oficial pública.

## Custo desta etapa

| Recurso | Uso | Delta mensal |
|---|---:|---:|
| CPU/RAM local | testes e Compose sob demanda | US$ 0 |
| PostgreSQL local | tabelas e volume descartável | US$ 0 |
| GitHub Actions | dentro da franquia existente | US$ 0 incremental |
| Cloud Storage | não provisionado | US$ 0 |
| Supabase/Infisical/GCP/tribunais | não acessados | US$ 0 |

## Limites obrigatórios

- não persistir payload bruto, texto integral, nomes, CPF/CNPJ ou links externos;
- não habilitar DJEN nem outro adapter real;
- não compartilhar evidência entre tenants nesta etapa;
- não criar bucket, serviço gerenciado, job permanente ou egress;
- paths de storage serão apenas referências opacas futuras, nunca URLs;
- testes devem usar dados sintéticos e remover recursos locais descartáveis;
- commit, push e deploy permanecem fora do escopo sem autorização explícita.

## Hipótese de capacidade

O recorte adiciona uma linha de envelope, uma referência externa e no máximo uma
exposição tenant-scoped por observação inédita. A medição local deve registrar o
tamanho por 1.000 observações antes de habilitar retenção real. Não há custo de
object storage porque nenhum payload ou documento será materializado agora.

### Medição local em 31/08/2026

Uma execução sintética gravou 1.000 envelopes, observações, processos,
referências, grants e recibos em banco descartável. A diferença de
`pg_total_relation_size`, incluindo índices dessas seis tabelas, foi:

| Volume | Armazenamento medido/estimado |
|---:|---:|
| 1.000 observações | 2.203.648 bytes (2,10 MiB) |
| por observação | 2.203,65 bytes |
| 10.000 observações, extrapolação linear | ~21 MiB |
| 1.000.000 observações, extrapolação linear | ~2,05 GiB |

Essa é uma medição de metadados sem texto, payload, PDF, bloat, WAL, backup,
réplica ou índices futuros. Portanto, serve para dimensionar a fundação local,
não como estimativa de fatura do Supabase/GCS. O teste não fez egress nem
acessou fornecedor externo.

## Gate para expansão

Eventos/publicações, payload em GCS, evidência global deduplicada ou fonte real
exigem avaliação própria de finalidade, retenção, volume, egress, lifecycle,
rebuild, exclusão e custo para 10, 1.000 e 10.000 perfis. A promoção para
`PUBLIC_OFFICIAL` só pode ocorrer após revisão jurídica documentada da fonte.
