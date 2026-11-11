// Corrige a Baileys 7.0.0-rc.9 (usada pela Evolution API v2.3.7) para confirmar
// (ack) os stanzas <status> que o WhatsApp entrega com as actualizacoes de Estado.
//
// Sem este ack, ~50 min depois o WhatsApp fecha a ligacao com
//   stream:error <ack class="status" .../>  ("stream errored out")
// a Evolution religa sozinha, diz "open", envia, mas deixa de receber mensagens
// ate um QR novo. Ver evolution-api#2778 / PR #2785 e Baileys #2858 / #2883.
//
// O script falha (exit 1) se o ficheiro nao tiver exactamente o codigo esperado,
// para nunca produzir uma imagem "corrigida" que nao corrige nada.

const fs = require('fs');

const file = process.argv[2] || '/evolution/node_modules/baileys/lib/Socket/messages-recv.js';
let src = fs.readFileSync(file, 'utf8');

if (src.includes("ws.on('CB:status'")) {
  console.log('baileys status-ack: ja aplicado, nada a fazer');
  process.exit(0);
}

function replaceOnce(anchor, replacement) {
  const count = src.split(anchor).length - 1;
  if (count !== 1) {
    console.error(`baileys status-ack: ancora encontrada ${count}x (esperado 1): ${JSON.stringify(anchor)}`);
    process.exit(1);
  }
  src = src.replace(anchor, () => replacement);
}

// 1) handler: so confirma a recepcao; o conteudo do Estado nao e usado.
replaceOnce(
  '    const makeOfflineNodeProcessor = () => {',
  [
    '    const handleStatus = async (node) => {',
    '        try {',
    '            await sendMessageAck(node);',
    '        }',
    '        catch (error) {',
    "            onUnexpectedError(error, 'acking status');",
    '        }',
    '    };',
    '    const makeOfflineNodeProcessor = () => {',
  ].join('\n'),
);

// 2) Estados entregues enquanto a sessao estava offline tambem sao confirmados,
//    pela ordem, na fila offline (senao ficam presos a cada religacao).
replaceOnce(
  "            ['notification', handleNotification]\n        ]);",
  "            ['notification', handleNotification],\n            ['status', handleStatus]\n        ]);",
);

// 3) Estados entregues com a sessao online.
replaceOnce(
  "    ws.on('CB:notification', async (node) => {",
  [
    "    ws.on('CB:status', async (node) => {",
    "        await processNode('status', node, 'handling status', handleStatus);",
    '    });',
    "    ws.on('CB:notification', async (node) => {",
  ].join('\n'),
);

fs.writeFileSync(file, src);
console.log('baileys status-ack: patch aplicado em', file);
