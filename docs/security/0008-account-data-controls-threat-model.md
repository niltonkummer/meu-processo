# Threat model 0008 — controles de dados da conta

## Ativos e fronteiras

Ativos: conteúdo exportado, identidade, vínculo tenant, artefato privado e
solicitação de exclusão. Fronteiras: navegador → API, API → PostgreSQL e API →
object store local. O navegador e todo identificador recebido são não
confiáveis.

## Ameaças e controles

| Ameaça | Controle verificável |
|---|---|
| IDOR/cross-tenant | contexto derivado do token, função SQL tenant-bound, 404 uniforme e teste A/B |
| roubo do locator | locator nunca sai da camada de repositório; cliente usa apenas UUID |
| artefato adulterado | arquivo regular sem symlink, limite 10 MiB, tamanho e SHA-256 conferidos |
| execução de conteúdo | download como attachment JSON, CSP sandbox, nosniff e no-store |
| exclusão acidental | POST, corpo exato, frase explícita, reautenticação e `auth_time` ≤ 5 min |
| replay de token antigo | Firebase valida revogação e servidor rejeita autenticação não recente |
| CSRF | sessão desta fatia usa Authorization Bearer, não cookie; mudança exige novo controle |
| XSS/exfiltração | token em memória, JSX escapado, sem sinks HTML e destino de API same-origin |
| disparo privilegiado | worker não é acessível pela API e usa papel separado |
| enumeração | ausente, negado e tenant divergente produzem resposta pública indistinguível |

## Risco residual

Um XSS no mesmo origin ainda pode agir durante a sessão em memória; CSP,
ausência de HTML bruto e dependências pinadas reduzem esse risco. A operação
cloud, assinatura de URLs e retenção real não estão autorizadas neste gate.
