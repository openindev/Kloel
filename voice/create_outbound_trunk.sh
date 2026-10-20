#!/bin/bash
# Run on the Mac once DIDlogic SIP creds exist: DIDLOGIC_SIP_USER=... DIDLOGIC_SIP_PASS=... ./create_outbound_trunk.sh
set -euo pipefail
cat > /tmp/didlogic-outbound.json <<J
{"trunk":{"name":"didlogic-br-outbound","address":"sip.br.didlogic.net","transport":"SIP_TRANSPORT_UDP","numbers":["+551152863804"],"authUsername":"$DIDLOGIC_SIP_USER","authPassword":"$DIDLOGIC_SIP_PASS"}}
J
lk sip outbound create --project kloel-ai /tmp/didlogic-outbound.json; rm -f /tmp/didlogic-outbound.json
echo "Now: railway variables --service kloel-voice --set LIVEKIT_SIP_OUTBOUND_TRUNK_ID=<ST_... above>"
