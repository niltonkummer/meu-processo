# Objetos locais privados

Esta pasta existe apenas para validação local da materialização e entrega de
documentos. Seu conteúdo, exceto este arquivo, é ignorado pelo Git. O worker a
monta em escrita e a aplicação a monta em somente leitura.

Estrutura aceita:

```text
documents/tenant/{tenantId}/{documentId}/{artifactId}.pdf
```

O worker também cria a área privada temporária `.quarantine`. Arquivos só saem
dela após validação de formato, tamanho, hash e varredura sintética local.

Não use nomes, CPF/CNPJ, CNJ, e-mail ou URLs no caminho. Um PDF só pode ser
entregue quando já existir um registro e um artefato correspondentes no banco,
com tamanho, SHA-256, estado limpo e validade aprovados.
