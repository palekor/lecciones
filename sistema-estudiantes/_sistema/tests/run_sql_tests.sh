#!/usr/bin/env bash
# Reinstala el esquema en una base limpia y corre las pruebas SQL.
# Uso: PGPORT=54329 ./_sistema/tests/run_sql_tests.sh
set -euo pipefail
cd "$(dirname "$0")/../.."
P="psql -h ${PGHOST:-127.0.0.1} -p ${PGPORT:-54329} -U ${PGUSER:-postgres} -v ON_ERROR_STOP=1 -q"
$P -d postgres -c "drop database if exists smstest with (force)" -c "create database smstest" >/dev/null 2>&1
$P -d smstest -f _sistema/tests/supabase_stub.sql >/dev/null 2>&1
$P -d smstest -f _sistema/supabase/001_sistema_estudiantes.sql >/dev/null 2>&1
# Segunda ejecución: la migración debe poder re-ejecutarse sin romper nada.
$P -d smstest -f _sistema/supabase/001_sistema_estudiantes.sql >/dev/null 2>&1
$P -d smstest -f _sistema/tests/test_schema.sql 2>&1 | grep -E "PASS|FAIL|ERROR|ALL_TESTS_PASSED" | sed 's/^psql:[^:]*:[0-9]*: //'
$P -d smstest -f _sistema/tests/test_v11.sql 2>&1 | grep -E "PASS|FAIL|ERROR|V11_TESTS_PASSED" | sed 's/^psql:[^:]*:[0-9]*: //'
$P -d smstest -f _sistema/tests/test_v12.sql 2>&1 | grep -E "PASS|FAIL|ERROR|V12_TESTS_PASSED" | sed 's/^psql:[^:]*:[0-9]*: //'
$P -d smstest -f _sistema/tests/test_v13.sql 2>&1 | grep -E "PASS|FAIL|ERROR|V13_TESTS_PASSED" | sed 's/^psql:[^:]*:[0-9]*: //'
