# ADR 0005 — renderizador isolado com sessão única

**Status:** aceito para implementação
**Data:** 30 de agosto de 2026

## Contexto

O HTML oficial do TJRS depende de JavaScript para construir o CAPTCHA. O cliente
HTTP atual não executa essa etapa. Guardar um `BrowserContext` entre dois pedidos
seria apenas melhor esforço no Cloud Run com escala a zero e poderia perder ou,
se implementado incorretamente, misturar estado.

## Decisão

Usar um segundo Cloud Run privado, com Chromium e Playwright, e conduzir todo o
fluxo em uma única conexão WebSocket encaminhada pela API:

```text
frontend autenticado ⇄ gateway público protegido ⇄ renderer privado ⇄ TJRS
```

O backend resolve a URL no DJEN. O renderizador revalida e limita a navegação.
Challenge, resposta humana e PDF usam a mesma conexão e o mesmo contexto. Não há
persistência nem reconexão. Escala mínima zero, máxima um e concorrência um.

## Consequências

### Positivas

- correção não depende de session affinity;
- superfície do navegador fica fora da API principal;
- IAM, recursos, timeout e allowlist são específicos;
- queda elimina todo o estado;
- nenhum banco, fila, cache ou bucket é necessário.

### Negativas

- segunda imagem e segundo serviço faturável;
- sessão aberta mantém compute ativo enquanto o usuário digita;
- uma única sessão simultânea na validação;
- páginas oficiais podem mudar seletores e exigir atualização controlada;
- Chromium amplia a superfície de supply chain e exige scan próprio.

## Alternativas rejeitadas

- **Dois pedidos com estado em memória:** escala a zero e afinidade são apenas
  melhor esforço.
- **Redis/Firestore:** serializam metadados, mas não um contexto de navegador;
  acrescentam custo e não resolvem a continuidade.
- **Screenshot da página inteira:** pode expor conteúdo processual desnecessário.
- **OCR ou solver:** contraria o controle humano e a política do produto.
- **Chromium dentro da API pública:** amplia permissões e impacto de uma falha.
- **Proxy/VPN público:** origem e segurança operacional não são controláveis.

## Revisão

Reavaliar após 30 dias ou 100 documentos reais. Mais de uma sessão simultânea,
novo tribunal, persistência ou execução automática exige novo ADR, threat model
e avaliação de custo.
