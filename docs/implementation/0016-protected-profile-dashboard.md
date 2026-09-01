# Implementação 0016 — painel de perfis protegidos

**Status:** implementado e verificado localmente  
**Data:** 30 de agosto de 2026  
**Custo:** [0020](../costs/0020-local-protected-profile-ui.md)  
**Spec:** [0013](../specs/0013-protected-monitored-identifiers.md)

## Resultado

O painel deixou de tratar o navegador como banco de identificadores:

- login carrega perfis ativos pela API da própria conta;
- “Cadastrar e buscar” persiste primeiro o perfil protegido e só então consulta
  a fonte oficial;
- conflito de cadastro recarrega a projeção da conta sem duplicar o perfil;
- arquivamento usa o `version` recebido e `If-Match`;
- somente iniciais de nome ou máscara de CPF/CNPJ aparecem na lista;
- o payload legado `meu-processo.targets.v1` é apagado e não existe fallback de
  persistência local;
- logout limpa imediatamente perfis e resultados da memória.

A listagem percorre todas as páginas antes de renderizar. Cursor repetido,
perfil duplicado ou mais de 100 páginas invalidam a resposta inteira, evitando
que uma projeção parcial seja apresentada como completa.

A projeção HTTP também deixou de retornar `tenantId`. O cliente aceita somente
seis campos públicos conhecidos; ciphertext, blind index, key version, tenant ou
qualquer campo inesperado tornam toda a resposta inválida.

## UX e desempenho

A direção visual profissional existente foi preservada. Foram adicionados:

- estados explícitos de carregamento da conta e arquivamento;
- botão de arquivamento com alvo mínimo de 44 px e nome acessível;
- `role=status` durante carregamento e erro seguro em `role=alert`;
- favicon local, eliminando o único 404 de console;
- origem customizável do Auth Emulator, aceita no CSP somente quando é HTTP
  loopback explícito com porta.

Nenhuma biblioteca de UI ou dependência de runtime foi adicionada. O bundle
principal permaneceu em aproximadamente 68 KiB gzip.

## Evidência

- 372 testes em 36 arquivos;
- 100% statements, branches, functions e lines no núcleo monitorado, incluindo
  o cliente web de perfis;
- lint, typecheck, build e Compose config aprovados;
- navegador real: criação de conta, cadastro `P. S.`, erro seguro da fonte e
  arquivamento concluídos;
- navegador real após build final: renderização e criação de conta sem erros ou
  warnings; a busca local registrou somente o 502 esperado da fonte externa;
- `localStorage`: nenhum item;
- PostgreSQL: registros sintéticos arquivados, zero plaintext e envelopes AES/HMAC
  versionados;
- nenhum dado de outro tenant ou campo protegido chegou ao painel.

As orientações de frontend mantiveram semântica, foco, legibilidade e layout
responsivo. As práticas React determinaram efeitos restritos a lifecycle,
operações em event handlers, updates funcionais e remoção do Web Storage com
schema legado explícito.

## Limites

O perfil salvo ainda não dispara um worker nem permite repetir a busca sem que a
pessoa informe novamente o valor: a listagem não deve revelar o plaintext. O
próximo incremento é o comando server-side/worker que recupera o identificador
somente dentro da fronteira autorizada, consulta fontes e grava eventos com
proveniência. Supabase e Infisical permanecem sem acesso até gate externo.
