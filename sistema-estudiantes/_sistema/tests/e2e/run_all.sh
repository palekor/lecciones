#!/usr/bin/env bash
# Corre toda la batería: SQL + unitarias + E2E públicas + E2E del panel.
set -uo pipefail
cd "$(dirname "$0")/../../.."
: "${POSTGREST_BIN:?ruta al binario postgrest}" "${SUPABASE_UMD:?ruta a supabase.js UMD}"
export LOGDIR="${LOGDIR:-/tmp}" SHOTS="${SHOTS:-/tmp}"
status=0
echo "== SQL"
sql_out=$(./_sistema/tests/run_sql_tests.sh)
echo "$sql_out" | grep -E "FAIL|ERROR|_TESTS_PASSED"
echo "$sql_out" | grep -q ALL_TESTS_PASSED && echo "$sql_out" | grep -q V11_TESTS_PASSED && echo "$sql_out" | grep -q V12_TESTS_PASSED && echo "$sql_out" | grep -q V13_TESTS_PASSED && echo "$sql_out" | grep -q V14_TESTS_PASSED || status=1
echo "== Unitarias"; node _sistema/tests/core.test.mjs | tail -1 || status=1
./_sistema/tests/e2e/start_stack.sh >/dev/null
export ANON_KEY=$(grep -o 'ANON_KEY=.*' "$LOGDIR/sms-server.log" | cut -d= -f2)
echo "== E2E público"; python3 _sistema/tests/e2e/test_public.py | grep -E "FAIL|OK$" || status=1
echo "== E2E panel";   python3 _sistema/tests/e2e/test_admin.py  | grep -E "FAIL|OK$" || status=1
echo "== E2E journal"; python3 _sistema/tests/e2e/test_journal.py | grep -E "FAIL|OK$" || status=1
echo "== E2E prospectos"; python3 _sistema/tests/e2e/test_prospects.py | grep -E "FAIL|OK$" || status=1
exit $status
