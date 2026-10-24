#!/usr/bin/env bash
# Levanta la pila de pruebas: base limpia + PostgREST + servidor local.
# Requiere: Postgres en $PGPORT, binario postgrest en $POSTGREST_BIN y el SDK UMD en $SUPABASE_UMD.
set -euo pipefail
cd "$(dirname "$0")/../../.."
export PGPORT="${PGPORT:-54329}" PGDATABASE=smstest
export JWT_SECRET="${JWT_SECRET:-test-secret-test-secret-test-secret-123456}"
LOGDIR="${LOGDIR:-/tmp}"
P="psql -h 127.0.0.1 -p $PGPORT -U postgres -v ON_ERROR_STOP=1 -q"
$P -d postgres -c "drop database if exists smstest with (force)" -c "create database smstest" >/dev/null 2>&1
$P -d smstest -f _sistema/tests/supabase_stub.sql >/dev/null 2>&1
$P -d smstest -f _sistema/supabase/001_sistema_estudiantes.sql >/dev/null 2>&1

pkill -f "postgrest $LOGDIR/pgrst.conf" 2>/dev/null || true
pkill -f "_sistema/tests/e2e/server.mjs" 2>/dev/null || true
for i in $(seq 1 40); do
  (exec 3<>/dev/tcp/127.0.0.1/3001) 2>/dev/null || (exec 3<>/dev/tcp/127.0.0.1/8787) 2>/dev/null || break
  sleep 0.25
done
cat > "$LOGDIR/pgrst.conf" <<CONF
db-uri = "postgres://authenticator:authpass@127.0.0.1:$PGPORT/smstest"
db-schemas = "public"
db-anon-role = "anon"
jwt-secret = "$JWT_SECRET"
server-port = 3001
server-host = "127.0.0.1"
CONF
nohup "$POSTGREST_BIN" "$LOGDIR/pgrst.conf" > "$LOGDIR/pgrst.log" 2>&1 &
for i in $(seq 1 40); do grep -q "Schema cache loaded" "$LOGDIR/pgrst.log" 2>/dev/null && break; sleep 0.25; done
PGRST_URL=http://127.0.0.1:3001 nohup node _sistema/tests/e2e/server.mjs > "$LOGDIR/sms-server.log" 2>&1 &
for i in $(seq 1 30); do grep -q READY "$LOGDIR/sms-server.log" 2>/dev/null && break; sleep 0.3; done
grep READY "$LOGDIR/sms-server.log"
