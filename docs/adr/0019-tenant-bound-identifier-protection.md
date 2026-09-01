# ADR 0019 — proteção tenant-bound de identificadores monitorados

**Status:** aceito  
**Data:** 30 de agosto de 2026  
**Custo:** [0019](../costs/0019-local-protected-identifiers-and-api.md)

## Contexto

Nome, CPF e CNPJ precisam ser recuperados para consultas autorizadas, mas não
podem permanecer em claro no PostgreSQL, logs, respostas técnicas ou índices.
Hash simples de CPF/CNPJ é inadequado por ter espaço de busca pequeno; criptografia
determinística também permitiria correlacionar tenants.

## Decisão

Para cada identificador persistido:

- normalizar e validar no domínio;
- armazenar apenas um rótulo minimizado/masked;
- calcular blind index com HMAC-SHA-256 sobre tenant, tipo e forma canônica;
- cifrar o valor normalizado com AES-256-GCM, IV aleatório de 96 bits e AAD
  contendo tenant, tipo e versão da chave;
- versionar separadamente a chave de blind index e a chave de criptografia;
- comparar por blind index apenas dentro do tenant;
- revelar o plaintext somente dentro do worker/conector autorizado.

As chaves são injetadas no adapter como bytes, nunca em domínio, banco, frontend,
log ou erro. No ambiente gerenciado, a origem será Infisical e a projeção de
runtime será Secret Manager; essa conexão não pertence à implementação local.

## Consequências

- igualdade/idempotência é eficiente sem plaintext;
- um dump não permite ataque offline sem a chave HMAC;
- o mesmo CPF/CNPJ em tenants distintos não possui o mesmo blind index;
- IV aleatório produz ciphertext diferente para valores iguais;
- rotação de criptografia pode ocorrer por key version;
- rotação do blind index exige dual-write/backfill controlado;
- busca textual parcial de nome não usa blind index e exigirá estratégia própria;
- comprometimento simultâneo do banco e das chaves ainda revela dados, portanto
  IAM mínimo, auditoria e rotação continuam necessários.

## Alternativas rejeitadas

- plaintext ou base64: não protege confidencialidade;
- SHA-256 sem chave: enumerável para CPF/CNPJ;
- HMAC global sem tenant: permite correlação cross-tenant;
- criptografia determinística como índice: aumenta vazamento de igualdade;
- chave no frontend ou variável `VITE_*`: expõe o segredo ao navegador.
