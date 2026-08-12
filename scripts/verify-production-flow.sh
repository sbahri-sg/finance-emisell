#!/bin/sh
set -eu

test_db=emisell_finance_test
test_container=emisell-finance-integration-test
cookie_file=/tmp/emisell-integration-cookies.txt
base=http://127.0.0.1:18080

cleanup() {
  docker rm -f "$test_container" >/dev/null 2>&1 || true
  docker compose exec -T postgres sh -lc 'psql -U "$POSTGRES_USER" -d postgres -c "select pg_terminate_backend(pid) from pg_stat_activity where datname='"'"'emisell_finance_test'"'"' and pid<>pg_backend_pid();" -c "drop database if exists emisell_finance_test;"' >/dev/null 2>&1 || true
}
trap cleanup EXIT INT TERM

docker rm -f "$test_container" >/dev/null 2>&1 || true
docker compose exec -T postgres sh -lc 'psql -U "$POSTGRES_USER" -d postgres -c "select pg_terminate_backend(pid) from pg_stat_activity where datname='"'"'emisell_finance_test'"'"' and pid<>pg_backend_pid();" -c "drop database if exists emisell_finance_test;" -c "create database emisell_finance_test;"' >/dev/null
docker compose build app >/dev/null

set -a
. ./.env
set +a
test_database_url="${DATABASE_URL%/*}/$test_db"
docker run --rm -d --name "$test_container" --network saya_internal -p 127.0.0.1:18080:3000 -e DATABASE_URL="$test_database_url" -e APP_ORIGIN="$base" -e NODE_ENV=test -e PORT=3000 saya-app >/dev/null

ready=false
attempt=1
while [ "$attempt" -le 30 ]; do
  if curl -fsS "$base/api/health" >/dev/null 2>&1; then ready=true; break; fi
  sleep 1
  attempt=$((attempt+1))
done
[ "$ready" = true ]

curl -fsS -c "$cookie_file" -H 'Content-Type: application/json' -d '{"organizationName":"Integration Test","fullName":"Test Owner","email":"owner@test.invalid","password":"IntegrationOnly-2026"}' "$base/api/auth/setup" | jq -e '.ok==true' >/dev/null
account_id=$(curl -fsS -b "$cookie_file" -H 'Content-Type: application/json' -d '{"name":"Bank Test","institution":"Test Bank","kind":"bank","currency":"IDR","openingBalance":10000000,"color":"#225c55"}' "$base/api/accounts" | jq -er '.id')
deposit_id=$(curl -fsS -b "$cookie_file" -H 'Content-Type: application/json' -d '{"name":"Meta Ads Test","institution":"Meta","kind":"deposit","currency":"IDR","openingBalance":0,"lowBalanceThreshold":500000,"color":"#4f78a5"}' "$base/api/accounts" | jq -er '.id')
budget_id=$(curl -fsS -b "$cookie_file" -H 'Content-Type: application/json' -d '{"month":"2026-08"}' "$base/api/budgets" | jq -er '.id')
category_id=$(curl -fsS -b "$cookie_file" "$base/api/budgets?month=2026-08" | jq -er '.categories[]|select(.name=="Kebutuhan kantor")|.id')
curl -fsS -b "$cookie_file" -X PATCH -H 'Content-Type: application/json' -d '{"name":"Kebutuhan kantor","categoryType":"variable","plannedAmount":5000000,"color":"#d89b50"}' "$base/api/budget-categories/$category_id" | jq -e '.ok==true' >/dev/null

purchase_payload=$(jq -nc --arg category "$category_id" '{department:"Operasional",title:"Kursi kerja",purpose:"Kebutuhan ergonomi staff",urgency:"normal",vendor:"Vendor Test",quantity:1,unitPrice:1000000,budgetCategoryId:$category}')
purchase_id=$(curl -fsS -b "$cookie_file" -H 'Content-Type: application/json' -d "$purchase_payload" "$base/api/purchase-requests" | jq -er '.id')
curl -fsS -b "$cookie_file" -H 'Content-Type: application/json' -d '{"status":"approved","note":"Anggaran tersedia"}' "$base/api/purchase-requests/$purchase_id/transition" | jq -e '.ok==true' >/dev/null
pay_payload=$(jq -nc --arg account "$account_id" '{transactionDate:"2026-08-11",accountId:$account,amount:900000,reference:"PAY-TEST-001"}')
payment_id=$(curl -fsS -b "$cookie_file" -H 'Content-Type: application/json' -d "$pay_payload" "$base/api/purchase-requests/$purchase_id/pay" | jq -er '.transactionId')
curl -fsS -b "$cookie_file" "$base/api/bootstrap" | jq -e --arg account "$account_id" --arg purchase "$purchase_id" '(.accounts[]|select(.id==$account)|.balance|tonumber)==9100000 and (.purchaseRequests[]|select(.id==$purchase)|.status)=="purchased"' >/dev/null
curl -fsS -b "$cookie_file" -H 'Content-Type: application/json' -d '{"transactionDate":"2026-08-11","reason":"Koreksi nominal pembayaran"}' "$base/api/transactions/$payment_id/reverse" | jq -er '.id' >/dev/null

pay_payload=$(jq -nc --arg account "$account_id" '{transactionDate:"2026-08-11",accountId:$account,amount:950000,reference:"PAY-TEST-002"}')
payment_id=$(curl -fsS -b "$cookie_file" -H 'Content-Type: application/json' -d "$pay_payload" "$base/api/purchase-requests/$purchase_id/pay" | jq -er '.transactionId')
curl -fsS -b "$cookie_file" -H 'Content-Type: application/json' -d '{"status":"received","note":"Barang diterima"}' "$base/api/purchase-requests/$purchase_id/transition" | jq -e '.ok==true' >/dev/null
reverse_status=$(curl -sS -o /dev/null -w '%{http_code}' -b "$cookie_file" -H 'Content-Type: application/json' -d '{"transactionDate":"2026-08-11","reason":"Tidak boleh setelah diterima"}' "$base/api/transactions/$payment_id/reverse")
[ "$reverse_status" = 409 ]

topup_payload=$(jq -nc --arg account "$account_id" '{transactionDate:"2026-08-11",sourceAccountId:$account,amount:2000000,reference:"TOPUP-TEST-001"}')
curl -fsS -b "$cookie_file" -H 'Content-Type: application/json' -d "$topup_payload" "$base/api/deposits/$deposit_id/topup" | jq -er '.id' >/dev/null
usage_payload=$(jq -nc --arg category "$category_id" '{transactionDate:"2026-08-11",amount:300000,description:"Pemakaian Meta Ads test",budgetCategoryId:$category}')
curl -fsS -b "$cookie_file" -H 'Content-Type: application/json' -d "$usage_payload" "$base/api/deposits/$deposit_id/usage" | jq -er '.id' >/dev/null

bill_id=$(curl -fsS -b "$cookie_file" -H 'Content-Type: application/json' -d '{"vendor":"Cloud Test","description":"Server bulanan","dueDate":"2026-08-15","amount":100000,"currency":"IDR","recurrence":"monthly","owner":"IT","autoRenew":true,"reminderDays":[14,7,1]}' "$base/api/bills" | jq -er '.id')
bill_payload=$(jq -nc --arg account "$account_id" --arg category "$category_id" '{transactionDate:"2026-08-11",accountId:$account,amount:100000,reference:"BILL-TEST-001",budgetCategoryId:$category}')
curl -fsS -b "$cookie_file" -H 'Content-Type: application/json' -d "$bill_payload" "$base/api/bills/$bill_id/pay" | jq -e '.transactionId!=null and .nextBillId!=null' >/dev/null

curl -fsS -b "$cookie_file" "$base/api/bootstrap" | jq -e --arg account "$account_id" --arg deposit "$deposit_id" '(.accounts[]|select(.id==$account)|.balance|tonumber)==6950000 and (.accounts[]|select(.id==$deposit)|.balance|tonumber)==1700000' >/dev/null
curl -fsS -b "$cookie_file" "$base/api/reports?month=2026-08" | jq -e '(.summary.expense|tonumber)==1350000 and (.summary.depositBalance|tonumber)==1700000' >/dev/null
reconcile_payload=$(jq -nc '{statementDate:"2026-08-11",statementBalance:6950000,note:"Integration test"}')
curl -fsS -b "$cookie_file" -H 'Content-Type: application/json' -d "$reconcile_payload" "$base/api/accounts/$account_id/reconcile" | jq -e '.difference==0' >/dev/null

curl -fsS -b "$cookie_file" -H 'Content-Type: application/json' -d '{"status":"closed"}' "$base/api/budgets/$budget_id/status" | jq -e '.ok==true' >/dev/null
closed_payload=$(jq -nc --arg account "$account_id" '{transactionDate:"2026-08-11",amount:1000,accountId:$account,description:"Should be blocked",category:"Test",status:"posted"}')
closed_status=$(curl -sS -o /dev/null -w '%{http_code}' -b "$cookie_file" -H 'Content-Type: application/json' -d "$closed_payload" "$base/api/expenses")
[ "$closed_status" = 409 ]

balance_errors=$(docker compose exec -T postgres sh -lc 'psql -U "$POSTGRES_USER" -d emisell_finance_test -Atc "select count(*) from transactions t where t.status='"'"'posted'"'"' and (select coalesce(sum(e.amount),0) from transaction_entries e where e.transaction_id=t.id)<>0;"')
[ "$balance_errors" = 0 ]
printf 'Production finance integration flow passed.\n'
