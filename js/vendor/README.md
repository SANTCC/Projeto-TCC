# Bibliotecas de terceiros vendorizadas

Arquivos copiados para o repositório (sem CDN), para que a página funcione mesmo com bloqueio de rede externa.

| Arquivo | Origem | Versão | Licença |
|---|---|---|---|
| `bot-detector.iife.min.js` | [niksbanna/js-bot-detector](https://github.com/niksbanna/js-bot-detector) — pacote npm `@niksbanna/bot-detector` (`dist/bot-detector.iife.min.js`) | 1.1.0 | MIT |

Global exposta: `BotDetectorLib` (uso: `BotDetectorLib.detectInstant()` → `{ verdict: 'human' | 'suspicious' | 'bot', score, ... }`).

Para atualizar: `npm pack @niksbanna/bot-detector`, extrair `package/dist/bot-detector.iife.min.js` e substituir este arquivo, atualizando a versão acima.
