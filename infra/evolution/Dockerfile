# Evolution API v2.3.7 com a correcao do ack dos Estados (<status>) na Baileys.
# Sem ela, as instancias ficam "open" mas deixam de receber mensagens
# (~50 min apos cada QR). Ver patch-baileys-status-ack.cjs.
#
# Remover quando sair uma versao oficial da Evolution com a correcao
# (evolution-api#2778 / PR #2785).
FROM evoapicloud/evolution-api:v2.3.7

COPY patch-baileys-status-ack.cjs /tmp/patch-baileys-status-ack.cjs
RUN node /tmp/patch-baileys-status-ack.cjs /evolution/node_modules/baileys/lib/Socket/messages-recv.js \
 && grep -q "ws.on('CB:status'" /evolution/node_modules/baileys/lib/Socket/messages-recv.js \
 && rm /tmp/patch-baileys-status-ack.cjs
