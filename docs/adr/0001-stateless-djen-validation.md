# ADR 0001 — Validar o DJEN antes de persistir dados pessoais

Status: concluído para a validação inicial; armazenamento no navegador
substituído pela [ADR 0019](./0019-tenant-bound-identifier-protection.md)
Data: 2026-08-29

> Nota histórica: a decisão abaixo descreve a primeira validação. Desde
> 30/08/2026, perfis são persistidos cifrados por tenant e o payload local legado
> é removido pelo painel.

## Contexto

O produto precisa descobrir processos relacionados a um nome, CPF ou CNPJ. O DJEN possui um filtro oficial por nome da parte, mas não possui filtros próprios por CPF ou CNPJ. Persistir alvos agora exigiria autenticação, autorização, segregação por usuário, retenção e exclusão de dados pessoais antes de sabermos se a fonte atende ao caso de uso.

## Decisão

A primeira fatia será stateless no servidor. Os alvos serão guardados somente no navegador. O backend validará a entrada, consultará a API oficial do DJEN e agrupará publicações por número CNJ.

Nome usará `nomeParte`. CPF/CNPJ usarão busca literal no campo `texto`, em duas representações, e serão marcados como experimentais e incompletos.

## Consequências

- Podemos validar acesso, qualidade e tempo de resposta sem criar uma base central de dados pessoais.
- Reiniciar ou trocar de navegador perde a lista local de alvos.
- Não há monitoramento agendado nem histórico.
- O resultado por CPF/CNPJ pode ser vazio mesmo quando existirem processos.
- A próxima etapa de persistência exigirá autenticação implementada, regras de
  isolamento testadas e Supabase PostgreSQL aprovado conforme ADR 0016.

## Alternativas consideradas

- **Persistir imediatamente em banco:** rejeitada nesta etapa por aumentar o
  risco antes de validar a fonte.
- **Varredura integral e índice próprio:** rejeitada por custo, restrições operacionais, privacidade e ausência de uma fonte aberta nacional que permita busca completa por documento.
- **DataJud como base comercial:** rejeitada porque as condições atuais limitam o uso a finalidades não comerciais.
