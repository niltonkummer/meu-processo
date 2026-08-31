# Avaliação de custo 0020 — painel local de perfis protegidos

<!-- infra-cost-assessment:v1 -->

**Status:** aprovado para implementação local  
**Solicitado por:** proprietário do produto  
**Data da avaliação:** 30 de agosto de 2026  
**Ambientes afetados:** local e CI, sem credenciais externas  
**Spec:** [0013](../specs/0013-protected-monitored-identifiers.md)

**Custo mensal atual (USD):** até US$ 0,38 já aprovado  
**Custo mensal esperado (USD):** até US$ 0,38; delta US$ 0  
**Custo mensal limite (USD):** US$ 10  
**Aprovação:** continuação explícita da implementação planejada em 30/08/2026

## Decisão

Autorizar, somente local/CI:

- cliente web estrito para cadastro, listagem e arquivamento;
- substituição do cadastro em Web Storage pela API autenticada;
- remoção automática do payload legado `meu-processo.targets.v1`;
- rótulos minimizados no painel e redaction adicional do tenant HTTP;
- teste de navegador com Firebase Emulator e PostgreSQL sintéticos;
- ajuste de origem loopback do emulator e favicon local.

Não autoriza Supabase, Infisical, GCP, Brevo, deploy, dado pessoal real, commit
ou push.

## Custo e limites

| Componente | Alteração | Delta mensal |
|---|---|---:|
| bundle web | cliente TypeScript pequeno, sem dependência nova | US$ 0 |
| Compose | containers descartáveis já previstos | US$ 0 |
| CI | testes na suíte existente | US$ 0 |

Não há Terraform, novo SKU, egress de produto ou retenção externa. O ensaio usa
um usuário, um identificador e chaves previsíveis exclusivamente sintéticos. Os
containers e volumes são removidos ao final.

## Condição de parada

Parar antes de segredo real, banco gerenciado, publicação ou tráfego de usuário.
Qualquer ativação Supabase/Infisical exige gate próprio, TLS, rollback e rotação.

