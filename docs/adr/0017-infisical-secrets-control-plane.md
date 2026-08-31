# ADR 0017 — Infisical como fonte de verdade de segredos

**Status:** aceito para planejamento; implementação depende de threat model, custo e spec próprios
**Data:** 30 de agosto de 2026
**Relacionado:** [Spec 0009](../specs/0009-scalable-product-foundation.md), [Custo 0012](../costs/0012-supabase-infisical-platform-planning.md)

## Contexto

O projeto precisará separar segredos de local, staging e production, dar acesso
a pessoas e workloads, rotacionar credenciais e auditar alterações. Guardar
valores em Git, `.env`, Terraform state, GitHub Actions ou configurações do
Cloud Run viola os guardrails. Usar somente Secret Manager entrega valores ao
runtime, mas não oferece o mesmo plano central de organização e fluxo entre
ambientes e integrações.

Infisical suporta machine identities, autenticação GCP nativa e sincronização
para Google Secret Manager. Cloud Run não deve depender de uma chamada externa
ao vault em cada request nem manter uma credencial estática para acessá-lo.

## Decisão

Adotar:

- **Infisical:** fonte de verdade e plano de controle dos segredos;
- **Google Secret Manager:** destino materializado para o runtime GCP;
- **Cloud Run:** lê somente versões autorizadas do Secret Manager por IAM;
- **GCP ID Token Auth:** identidade nativa de workloads no Infisical, sem arquivo
  de chave;
- **Secret Sync:** promoção explícita Infisical → Secret Manager, com nomes
  allowlisted e comportamento de deleção seguro.

O runtime não consulta Infisical por request. A sincronização é assíncrona;
falha de sync mantém a última versão válida no Secret Manager, gera alerta e
bloqueia promoção que dependa da nova versão.

### Organização e acesso

- projeto Infisical próprio da aplicação, com ambientes `dev`, `staging` e
  `prod` e pastas por workload/integração;
- projetos GCP, service accounts, identities e destinos separados por ambiente;
- usuários humanos usam MFA e menor privilégio; acesso a produção é excepcional;
- machine identities possuem papel mínimo, TTL curto e escopo por pasta;
- CI autentica por identidade federada/OIDC suportada, nunca por token persistente;
- break-glass exige justificativa, prazo, dupla revisão quando o plano suportar e
  evento de auditoria;
- segredo é rotacionado com overlap controlado, verificação e revogação da versão
  anterior.

### Sincronização segura

- conexão GCP do Infisical recebe apenas permissões necessárias aos secrets
  gerenciados;
- `key schema`/prefixo impede que o sync toque segredos fora do namespace;
- no primeiro sync, import/overwrite é decidido por ambiente após inventário;
- deleção remota fica desabilitada no rollout inicial;
- produção começa com promoção manual e evidência; auto-sync só após testes de
  rollback, alerta e reconciliação;
- aplicação referencia secret IDs estáveis, não valores nem versões em código;
- logs, exceptions, telemetria e fixtures aplicam redaction.

### Limites de dados e IaC

- banco/MER guarda somente `secret_ref`, versão lógica, status e metadados de
  rotação; nunca plaintext;
- Terraform pode declarar integração, IAM e referências, mas nenhum valor de
  segredo entra em HCL, plan, output ou state;
- bootstrap mínimo de acesso é documentado e executado fora do repositório;
- export/backup de segredos é criptografado, restrito e testado conforme o plano;
- residência, subprocessadores, DPA, retenção de auditoria e resposta a incidente
  são aprovados antes de produção.

## Consequências

- existe uma fonte central com entrega GCP nativa e sem lookup por request;
- o runtime tolera indisponibilidade temporária do Infisical usando a última
  versão válida, mas não recebe rotações durante a falha;
- Secret Manager torna-se uma projeção materializada, não uma segunda fonte de
  edição;
- plano Free pode validar o fluxo, mas controles de produção podem exigir custo
  por identidade;
- mais um fornecedor entra no threat model, DPA, monitoramento e recuperação.

## Alternativas

- **Somente GCP Secret Manager:** contingência mais simples se custo, residência
  ou risco do novo fornecedor não forem aceitos.
- **Infisical consultado em runtime:** rejeitado por latência, disponibilidade e
  aumento do blast radius.
- **Infisical self-hosted:** adiado; exige banco, cache, HA, upgrades e backups.
- **Segredos em CI/Terraform/env versionado:** proibido.

## Revisão

Revisar antes do primeiro secret real e a cada mudança de plano/fornecedor.
Produção exige threat model, inventário, recovery drill, alertas de sync e custo
aprovado.

