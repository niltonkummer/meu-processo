# Implementação 0014 — núcleo de identificadores protegidos

**Status:** implementado e verificado, incluindo HTTP e runtime local  
**Data:** 30 de agosto de 2026  
**Spec:** [0013](../specs/0013-protected-monitored-identifiers.md)  
**ADR:** [0019](../adr/0019-tenant-bound-identifier-protection.md)  
**Custo:** [0019](../costs/0019-local-protected-identifiers-and-api.md)

## Resultado

Nome, CPF e CNPJ podem ser transformados em um input persistível sem armazenar o
valor em claro:

- nome validado preserva a grafia normalizada somente dentro do ciphertext;
- blind index canônico ignora caixa/acento e é separado por tenant/tipo;
- CPF/CNPJ reutilizam validação de checksum e guardam apenas máscara final;
- AES-256-GCM usa IV aleatório, AAD tenant/type/key-version e tag de 128 bits;
- envelope e blind index possuem versões explícitas;
- listagens memory/PostgreSQL não retornam HMAC, ciphertext ou key version;
- migration 0003 exige ciphertext/key version e rejeita envelopes malformados;
- registros anteriores são marcados `legacy:v0:unavailable`, sem fabricar valor.

As chaves de teste são bytes sintéticos públicos e previsíveis, restritos ao
Compose local. Nenhuma chave real, secret reference, PII ou fonte externa foi
usada.

## TDD e falhas encontradas

O Red inicial comprovou ausência da factory e do adapter. Durante a suíte completa,
o teste de tampering encontrou que o decoder Base64URL do Node aceita algumas
representações não canônicas equivalentes. O adapter agora exige round-trip
canônico antes do AES-GCM, impedindo alteração textual ambígua do envelope.

Um segundo Red comprovou que o repository em memória expunha campos protegidos
nas listagens. Memory e PostgreSQL agora projetam somente campos públicos.

Um terceiro Red comprovou que a aplicação real ainda retornava `503` porque o
composition root não conectava a API ao repository. A configuração agora é
`disabled` por padrão e só habilita PostgreSQL quando URL, pool, versões e todas
as chaves Base64URL canônicas de 32 bytes são válidas.

## Evidências

| Verificação | Resultado |
|---|---:|
| testes de proteção/factory | 7/7 |
| suíte regular | 333/333 em 35 arquivos |
| cobertura monitorada | 100% statements/branches/functions/lines |
| pgTAP migration/constraints/RLS/grants | 34/34 |
| contract PostgreSQL, incluindo redaction/cross-tenant | 7/7 |
| backup/restore | aprovado |
| lint, typecheck, build e Compose config | aprovado |
| secret scan Trivy | 0 segredos |
| imagem da aplicação HIGH/CRITICAL corrigíveis | 0 vulnerabilidades |
| `npm audit --audit-level=high` | aprovado; 0 high/critical |

O audit mantém nove findings moderados transitivos já registrados na cadeia
Firebase/Firebase Tools. A correção automática é breaking e não foi aplicada.

## Práticas de segurança aplicadas

- input validado antes do sink criptográfico ou SQL;
- SQL continua totalmente parametrizado;
- IDs opacos e respostas sem campos protegidos;
- nenhum segredo no frontend, Web Storage ou bundle;
- erro criptográfico único, sem oracle de parse/tag/chave;
- chaves copiadas para buffers internos e nunca incluídas em mensagens;
- RLS forçada e escopo tenant continuam sendo autorização, não o UUID/HMAC.

O skill de segurança influenciou diretamente validação de entrada, redaction,
erros genéricos, ausência de segredo no browser e queries parametrizadas. As
regras PostgreSQL/Supabase orientaram constraints no banco, unicidade escopada,
RLS e contracts em banco novo.

## API e runtime local

- `POST /api/v1/monitoring/subjects` cadastra nome, CPF ou CNPJ;
- `GET /api/v1/monitoring/subjects` pagina e omite inativos por padrão;
- `DELETE /api/v1/monitoring/subjects/:id` arquiva com `If-Match`;
- autenticação Firebase é resolvida novamente em cada operação;
- o composition root cria pool PostgreSQL limitado, repository, tenant resolver,
  protector e service, fechando o pool junto com o servidor;
- o Compose executa essa composição com credenciais e chaves apenas locais.

O ensaio de runtime com Firebase Auth Emulator e PostgreSQL reais confirmou
cadastro `201`, listagem `200`, arquivamento `200`, isolamento entre dois usuários,
ausência de plaintext e envelopes HMAC/AES versionados no banco.

## Limite e próximo passo

O painel já consome esta API e remove o armazenamento legado conforme
[Implementação 0016](./0016-protected-profile-dashboard.md). Supabase e Infisical
não foram acessados; ativá-los requer novo gate de custo, segredos reais em
runtime, teste de TLS/pooler, rotação e rollback.
