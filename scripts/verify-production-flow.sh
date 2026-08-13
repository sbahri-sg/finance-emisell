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
custom_category_id=$(curl -fsS -b "$cookie_file" -H 'Content-Type: application/json' -d '{"name":"Pajak & Legal","color":"#9b6f45"}' "$base/api/expense-categories" | jq -er '.id')
curl -fsS -b "$cookie_file" -X PATCH -H 'Content-Type: application/json' -d '{"name":"Pajak & Kepatuhan","color":"#9b6f45","active":true}' "$base/api/expense-categories/$custom_category_id" | jq -e '.name=="Pajak & Kepatuhan"' >/dev/null
curl -fsS -b "$cookie_file" "$base/api/settings" | jq -e --arg category "$custom_category_id" '([.expenseCategories[]|select(.id==$category and .name=="Pajak & Kepatuhan" and .active==true)]|length)==1' >/dev/null
disposable_category_id=$(curl -fsS -b "$cookie_file" -H 'Content-Type: application/json' -d '{"name":"Kategori Sementara","color":"#607d73"}' "$base/api/expense-categories" | jq -er '.id')
curl -fsS -b "$cookie_file" -X DELETE "$base/api/expense-categories/$disposable_category_id" | jq -e '.ok==true' >/dev/null
curl -fsS -b "$cookie_file" "$base/api/settings" | jq -e --arg category "$disposable_category_id" '([.expenseCategories[]|select(.id==$category)]|length)==0' >/dev/null
account_id=$(curl -fsS -b "$cookie_file" -H 'Content-Type: application/json' -d '{"name":"Bank Test","institution":"Test Bank","kind":"bank","currency":"IDR","openingBalance":10000000,"color":"#225c55"}' "$base/api/accounts" | jq -er '.id')
deposit_id=$(curl -fsS -b "$cookie_file" -H 'Content-Type: application/json' -d '{"name":"Meta Ads Test","institution":"Meta","kind":"deposit","currency":"IDR","openingBalance":0,"lowBalanceThreshold":500000,"color":"#4f78a5"}' "$base/api/accounts" | jq -er '.id')
budget_id=$(curl -fsS -b "$cookie_file" -H 'Content-Type: application/json' -d '{"month":"2026-08"}' "$base/api/budgets" | jq -er '.id')
category_id=$(curl -fsS -b "$cookie_file" "$base/api/budgets?month=2026-08" | jq -er '.categories[]|select(.name=="Kebutuhan kantor")|.id')
disposable_budget_category_id=$(curl -fsS -b "$cookie_file" -H 'Content-Type: application/json' -d '{"name":"Pos salah input","expenseCategory":"Lain-Lain","details":[],"budgetModel":"fixed","lineItems":[],"categoryType":"variable","plannedAmount":50000,"color":"#8b9692"}' "$base/api/budgets/$budget_id/categories" | jq -er '.id')
curl -fsS -b "$cookie_file" "$base/api/budgets?month=2026-08" | jq -e --arg category "$disposable_budget_category_id" '(.categories[]|select(.id==$category)|.canDelete)==true' >/dev/null
curl -fsS -b "$cookie_file" -X DELETE "$base/api/budget-categories/$disposable_budget_category_id" | jq -e '.ok==true' >/dev/null
curl -fsS -b "$cookie_file" "$base/api/budgets?month=2026-08" | jq -e --arg category "$disposable_budget_category_id" '([.categories[]|select(.id==$category)]|length)==0' >/dev/null
archivable_budget_category_id=$(curl -fsS -b "$cookie_file" -H 'Content-Type: application/json' -d '{"name":"Pos transaksi dibatalkan","expenseCategory":"Lain-Lain","details":[],"budgetModel":"fixed","lineItems":[],"categoryType":"variable","plannedAmount":50000,"color":"#8b9692"}' "$base/api/budgets/$budget_id/categories" | jq -er '.id')
archivable_expense_payload=$(jq -nc --arg account "$account_id" --arg category "$archivable_budget_category_id" '{transactionDate:"2026-08-11",accountId:$account,amount:10000,description:"Transaksi untuk uji arsip RAB",category:"Lain-Lain",budgetCategoryId:$category,paymentMethod:"transfer"}')
archivable_transaction_id=$(curl -fsS -b "$cookie_file" -H 'Content-Type: application/json' -d "$archivable_expense_payload" "$base/api/expenses" | jq -er '.id')
curl -fsS -b "$cookie_file" -H 'Content-Type: application/json' -d '{"transactionDate":"2026-08-11","reason":"Batalkan transaksi uji arsip"}' "$base/api/transactions/$archivable_transaction_id/reverse" | jq -er '.id' >/dev/null
curl -fsS -b "$cookie_file" "$base/api/budgets?month=2026-08" | jq -e --arg category "$archivable_budget_category_id" '(.categories[]|select(.id==$category)|.canDelete)==true' >/dev/null
curl -fsS -b "$cookie_file" -X DELETE "$base/api/budget-categories/$archivable_budget_category_id" | jq -e '.ok==true and .archived==true' >/dev/null
curl -fsS -b "$cookie_file" "$base/api/budgets?month=2026-08" | jq -e --arg category "$archivable_budget_category_id" '([.categories[]|select(.id==$category)]|length)==0' >/dev/null
replacement_budget_category_id=$(curl -fsS -b "$cookie_file" -H 'Content-Type: application/json' -d '{"name":"Pos transaksi dibatalkan","expenseCategory":"Lain-Lain","details":[],"budgetModel":"fixed","lineItems":[],"categoryType":"variable","plannedAmount":50000,"color":"#8b9692"}' "$base/api/budgets/$budget_id/categories" | jq -er '.id')
curl -fsS -b "$cookie_file" -X DELETE "$base/api/budget-categories/$replacement_budget_category_id" | jq -e '.ok==true and .archived==false' >/dev/null
curl -fsS -b "$cookie_file" -X PATCH -H 'Content-Type: application/json' -d '{"name":"Kebutuhan kantor","expenseCategory":"Kebersihan & Perlengkapan","details":["ATK","Galon"],"budgetModel":"multi_item","lineItems":[{"name":"ATK","quantity":10,"unitPrice":300000},{"name":"Galon","quantity":20,"unitPrice":100000}],"categoryType":"variable","plannedAmount":1,"color":"#d89b50"}' "$base/api/budget-categories/$category_id" | jq -e '.ok==true' >/dev/null
curl -fsS -b "$cookie_file" "$base/api/budgets?month=2026-08" | jq -e --arg category "$category_id" '(.categories[]|select(.id==$category)|.plannedAmount|tonumber)==5000000 and (.categories[]|select(.id==$category)|.budgetModel)=="multi_item" and ([.categories[]|select(.id==$category)|.lineItems[]]|length)==2' >/dev/null
atk_item_id=$(curl -fsS -b "$cookie_file" "$base/api/budgets?month=2026-08" | jq -er --arg category "$category_id" '.categories[]|select(.id==$category)|.lineItems[]|select(.name=="ATK")|.id')
galon_item_id=$(curl -fsS -b "$cookie_file" "$base/api/budgets?month=2026-08" | jq -er --arg category "$category_id" '.categories[]|select(.id==$category)|.lineItems[]|select(.name=="Galon")|.id')
cart_payload=$(jq -nc --arg account "$account_id" --arg category "$category_id" --arg atk "$atk_item_id" --arg galon "$galon_item_id" '{transactionDate:"2026-08-11",accountId:$account,amount:620000,description:"Belanja keranjang RAB",category:"Kebersihan & Perlengkapan",budgetCategoryId:$category,budgetItems:[{budgetItemId:$atk,quantity:2,unitPrice:250000},{budgetItemId:$galon,quantity:1,unitPrice:120000}],paymentMethod:"transfer"}')
cart_transaction_id=$(curl -fsS -b "$cookie_file" -H 'Content-Type: application/json' -d "$cart_payload" "$base/api/expenses" | jq -er '.id')
[ "$(curl -sS -o /dev/null -w '%{http_code}' -b "$cookie_file" -X DELETE "$base/api/budget-categories/$category_id")" = 409 ]
curl -fsS -b "$cookie_file" "$base/api/budgets?month=2026-08" | jq -e --arg category "$category_id" '(.categories[]|select(.id==$category)|.canDelete)==false' >/dev/null
curl -fsS -b "$cookie_file" "$base/api/budgets?month=2026-08" | jq -e --arg category "$category_id" '(.categories[]|select(.id==$category)|.lineItems[]|select(.name=="ATK")|.remainingQuantity)==8 and (.categories[]|select(.id==$category)|.lineItems[]|select(.name=="Galon")|.remainingQuantity)==19' >/dev/null
over_cart_payload=$(jq -nc --arg account "$account_id" --arg category "$category_id" --arg atk "$atk_item_id" '{transactionDate:"2026-08-11",accountId:$account,amount:2700000,description:"Melebihi sisa item",category:"Kebersihan & Perlengkapan",budgetCategoryId:$category,budgetItems:[{budgetItemId:$atk,quantity:9,unitPrice:300000}],paymentMethod:"transfer"}')
[ "$(curl -sS -o /dev/null -w '%{http_code}' -b "$cookie_file" -H 'Content-Type: application/json' -d "$over_cart_payload" "$base/api/expenses")" = 409 ]
cart_edit_payload=$(jq -nc --arg account "$account_id" --arg category "$category_id" --arg atk "$atk_item_id" '{transactionDate:"2026-08-11",accountId:$account,amount:750000,description:"Belanja keranjang RAB revisi",category:"Kebersihan & Perlengkapan",budgetCategoryId:$category,budgetItems:[{budgetItemId:$atk,quantity:3,unitPrice:250000}],paymentMethod:"cash"}')
cart_transaction_id=$(curl -fsS -b "$cookie_file" -X PATCH -H 'Content-Type: application/json' -d "$cart_edit_payload" "$base/api/transactions/$cart_transaction_id" | jq -er '.id')
curl -fsS -b "$cookie_file" "$base/api/budgets?month=2026-08" | jq -e --arg category "$category_id" '(.categories[]|select(.id==$category)|.lineItems[]|select(.name=="ATK")|.remainingQuantity)==7 and (.categories[]|select(.id==$category)|.lineItems[]|select(.name=="Galon")|.remainingQuantity)==20' >/dev/null
curl -fsS -b "$cookie_file" -H 'Content-Type: application/json' -d '{"transactionDate":"2026-08-11","reason":"Batalkan belanja keranjang uji"}' "$base/api/transactions/$cart_transaction_id/reverse" | jq -er '.id' >/dev/null
curl -fsS -b "$cookie_file" "$base/api/budgets?month=2026-08" | jq -e --arg category "$category_id" '(.categories[]|select(.id==$category)|.lineItems[]|select(.name=="ATK")|.remainingQuantity)==10 and (.categories[]|select(.id==$category)|.lineItems[]|select(.name=="Galon")|.remainingQuantity)==20' >/dev/null
used_expense_category_id=$(curl -fsS -b "$cookie_file" "$base/api/settings" | jq -er '.expenseCategories[]|select(.name=="Kebersihan & Perlengkapan")|.id')
[ "$(curl -sS -o /dev/null -w '%{http_code}' -b "$cookie_file" -X DELETE "$base/api/expense-categories/$used_expense_category_id")" = 409 ]
[ "$(curl -sS -o /dev/null -w '%{http_code}' -b "$cookie_file" -X PATCH -H 'Content-Type: application/json' -d '{"name":"Kebersihan & Perlengkapan","color":"#6f9f72","active":false}' "$base/api/expense-categories/$used_expense_category_id")" = 409 ]
fractional_quantity_status=$(curl -sS -o /dev/null -w '%{http_code}' -b "$cookie_file" -X PATCH -H 'Content-Type: application/json' -d '{"name":"Kebutuhan kantor","expenseCategory":"Kebersihan & Perlengkapan","details":["Galon"],"budgetModel":"multi_item","lineItems":[{"name":"Galon","quantity":1.07,"unitPrice":50000}],"categoryType":"variable","plannedAmount":53500,"color":"#d89b50"}' "$base/api/budget-categories/$category_id")
[ "$fractional_quantity_status" = 400 ]

purchase_payload=$(jq -nc --arg category "$category_id" '{department:"Operasional",title:"Kursi kerja",purpose:"Kebutuhan ergonomi staff",urgency:"normal",vendor:"Vendor Test",quantity:1,unitPrice:1000000,budgetCategoryId:$category}')
purchase_id=$(curl -fsS -b "$cookie_file" -H 'Content-Type: application/json' -d "$purchase_payload" "$base/api/purchase-requests" | jq -er '.id')
curl -fsS -b "$cookie_file" -H 'Content-Type: application/json' -d '{"status":"approved","note":"Anggaran tersedia"}' "$base/api/purchase-requests/$purchase_id/transition" | jq -e '.ok==true' >/dev/null
pay_payload=$(jq -nc --arg account "$account_id" '{transactionDate:"2026-08-11",accountId:$account,amount:900000,paymentMethod:"transfer",proofReference:"https://example.invalid/proof-1"}')
payment_id=$(curl -fsS -b "$cookie_file" -H 'Content-Type: application/json' -d "$pay_payload" "$base/api/purchase-requests/$purchase_id/pay" | jq -er '.transactionId')
curl -fsS -b "$cookie_file" "$base/api/bootstrap" | jq -e --arg account "$account_id" --arg purchase "$purchase_id" '(.accounts[]|select(.id==$account)|.balance|tonumber)==9100000 and (.purchaseRequests[]|select(.id==$purchase)|.status)=="purchased"' >/dev/null
curl -fsS -b "$cookie_file" -H 'Content-Type: application/json' -d '{"transactionDate":"2026-08-11","reason":"Koreksi nominal pembayaran"}' "$base/api/transactions/$payment_id/reverse" | jq -er '.id' >/dev/null

pay_payload=$(jq -nc --arg account "$account_id" '{transactionDate:"2026-08-11",accountId:$account,amount:950000,paymentMethod:"transfer",proofReference:"https://example.invalid/proof-2"}')
payment_id=$(curl -fsS -b "$cookie_file" -H 'Content-Type: application/json' -d "$pay_payload" "$base/api/purchase-requests/$purchase_id/pay" | jq -er '.transactionId')
purchase_edit=$(jq -nc --arg account "$account_id" --arg category "$category_id" '{transactionDate:"2026-08-11",accountId:$account,amount:975000,description:"Kursi kerja revisi",category:"Kebersihan & Perlengkapan",budgetCategoryId:$category,counterparty:"Vendor Test",paymentMethod:"cash",proofUrl:"https://example.invalid/proof-edited"}')
payment_id=$(curl -fsS -b "$cookie_file" -X PATCH -H 'Content-Type: application/json' -d "$purchase_edit" "$base/api/transactions/$payment_id" | jq -er '.id')
curl -fsS -b "$cookie_file" "$base/api/bootstrap" | jq -e --arg purchase "$purchase_id" --arg payment "$payment_id" '(.purchaseRequests[]|select(.id==$purchase)|.paymentTransactionId)==$payment and (.purchaseRequests[]|select(.id==$purchase)|.paidAmount|tonumber)==975000 and (.purchaseRequests[]|select(.id==$purchase)|.paymentReference)=="cash" and ([.transactions[]|select(.description=="Kursi kerja revisi" and .editable==true)]|length)==1' >/dev/null
curl -fsS -b "$cookie_file" -H 'Content-Type: application/json' -d '{"status":"received","note":"Barang diterima"}' "$base/api/purchase-requests/$purchase_id/transition" | jq -e '.ok==true' >/dev/null
reverse_status=$(curl -sS -o /dev/null -w '%{http_code}' -b "$cookie_file" -H 'Content-Type: application/json' -d '{"transactionDate":"2026-08-11","reason":"Tidak boleh setelah diterima"}' "$base/api/transactions/$payment_id/reverse")
[ "$reverse_status" = 409 ]

topup_payload=$(jq -nc --arg account "$account_id" '{transactionDate:"2026-08-11",sourceAccountId:$account,amount:2000000,proofUrl:"https://example.invalid/topup-proof"}')
curl -fsS -b "$cookie_file" -H 'Content-Type: application/json' -d "$topup_payload" "$base/api/deposits/$deposit_id/topup" | jq -er '.id' >/dev/null
usage_payload=$(jq -nc --arg category "$category_id" '{transactionDate:"2026-08-11",amount:300000,description:"Pemakaian Meta Ads test",budgetCategoryId:$category}')
curl -fsS -b "$cookie_file" -H 'Content-Type: application/json' -d "$usage_payload" "$base/api/deposits/$deposit_id/usage" | jq -er '.id' >/dev/null

bill_id=$(curl -fsS -b "$cookie_file" -H 'Content-Type: application/json' -d '{"vendor":"Cloud Test","description":"Server bulanan","dueDate":"2026-08-15","unitPrice":50000,"quantity":2,"paymentMethod":"transfer","currency":"IDR","recurrence":"monthly","owner":"IT","autoRenew":true,"reminderDays":[14,7,1]}' "$base/api/bills" | jq -er '.id')
bill_payload=$(jq -nc --arg account "$account_id" --arg category "$category_id" '{transactionDate:"2026-08-11",accountId:$account,amount:100000,reference:"BILL-TEST-001",budgetCategoryId:$category}')
bill_payment=$(curl -fsS -b "$cookie_file" -H 'Content-Type: application/json' -d "$bill_payload" "$base/api/bills/$bill_id/pay")
bill_transaction_id=$(printf '%s' "$bill_payment" | jq -er '.transactionId')
next_bill_id=$(printf '%s' "$bill_payment" | jq -er '.nextBillId')
curl -fsS -b "$cookie_file" -X DELETE "$base/api/bills/$next_bill_id" | jq -e '.ok==true and .archived==false' >/dev/null
curl -fsS -b "$cookie_file" -X DELETE "$base/api/bills/$bill_id" | jq -e '.ok==true and .archived==true' >/dev/null
curl -fsS -b "$cookie_file" "$base/api/bootstrap" | jq -e --arg bill "$bill_id" --arg next "$next_bill_id" --arg transaction "$bill_transaction_id" '([.bills[]|select(.id==$bill or .id==$next)]|length)==0 and ([.transactions[]|select(.id==$transaction)]|length)==1' >/dev/null

income_payload=$(jq -nc --arg account "$account_id" '{transactionDate:"2026-08-11",accountId:$account,amount:500000,description:"Income sebelum edit",sourceType:"service_income",paymentMethod:"transfer"}')
income_id=$(curl -fsS -b "$cookie_file" -H 'Content-Type: application/json' -d "$income_payload" "$base/api/income" | jq -er '.id')
income_edit=$(jq -nc --arg account "$account_id" '{transactionDate:"2026-08-11",accountId:$account,amount:700000,description:"Income setelah edit",sourceType:"service_income",paymentMethod:"transfer"}')
curl -fsS -b "$cookie_file" -X PATCH -H 'Content-Type: application/json' -d "$income_edit" "$base/api/transactions/$income_id" | jq -er '.id' >/dev/null

expense_payload=$(jq -nc --arg account "$account_id" --arg category "$category_id" '{transactionDate:"2026-08-11",accountId:$account,amount:100000,description:"Expense sebelum edit",category:"Kebersihan & Perlengkapan",budgetCategoryId:$category,budgetItemName:"Galon",paymentMethod:"transfer"}')
expense_id=$(curl -fsS -b "$cookie_file" -H 'Content-Type: application/json' -d "$expense_payload" "$base/api/expenses" | jq -er '.id')
expense_edit=$(jq -nc --arg account "$account_id" --arg category "$category_id" '{transactionDate:"2026-08-11",accountId:$account,amount:150000,description:"Expense setelah edit",category:"Kebersihan & Perlengkapan",budgetCategoryId:$category,budgetItemName:"Galon",paymentMethod:"cash"}')
curl -fsS -b "$cookie_file" -X PATCH -H 'Content-Type: application/json' -d "$expense_edit" "$base/api/transactions/$expense_id" | jq -er '.id' >/dev/null

curl -fsS -b "$cookie_file" "$base/api/bootstrap" | jq -e --arg account "$account_id" --arg deposit "$deposit_id" '(.accounts[]|select(.id==$account)|.balance|tonumber)==7475000 and (.accounts[]|select(.id==$deposit)|.balance|tonumber)==1700000 and ([.transactions[]|select(.description=="Income sebelum edit" or .description=="Expense sebelum edit")]|length)==0 and ([.transactions[]|select(.description=="Income setelah edit" or .description=="Expense setelah edit")]|length)==2 and ([.transactions[]|select(.description=="Expense setelah edit")|.budgetItemName][0])=="Galon" and ([.bills[]|select(.vendor=="Cloud Test")]|length)==0' >/dev/null
curl -fsS -b "$cookie_file" "$base/api/reports?month=2026-08" | jq -e '(.summary.income|tonumber)==700000 and (.summary.expense|tonumber)==1525000 and (.summary.depositBalance|tonumber)==1700000' >/dev/null
reconcile_payload=$(jq -nc '{statementDate:"2026-08-11",statementBalance:7475000,note:"Integration test"}')
curl -fsS -b "$cookie_file" -H 'Content-Type: application/json' -d "$reconcile_payload" "$base/api/accounts/$account_id/reconcile" | jq -e '.difference==0' >/dev/null

[ "$(curl -sS -o /dev/null -w '%{http_code}' -b "$cookie_file" -X DELETE "$base/api/accounts/$account_id")" = 409 ]
[ "$(curl -sS -o /dev/null -w '%{http_code}' -b "$cookie_file" -X DELETE "$base/api/accounts/$deposit_id")" = 409 ]
empty_deposit=$(curl -fsS -b "$cookie_file" -H 'Content-Type: application/json' -d '{"name":"Empty Deposit","institution":"Test","kind":"deposit","currency":"IDR","openingBalance":0,"color":"#4f78a5"}' "$base/api/accounts" | jq -er '.id')
curl -fsS -b "$cookie_file" -X PATCH -H 'Content-Type: application/json' -d '{"name":"Edited Deposit","institution":"Edited Test","kind":"deposit","currency":"IDR","lowBalanceThreshold":250000,"color":"#225c55"}' "$base/api/accounts/$empty_deposit" | jq -e '.ok==true' >/dev/null
curl -fsS -b "$cookie_file" -X DELETE "$base/api/accounts/$empty_deposit" | jq -e '.ok==true' >/dev/null

merge_balance_before=$(curl -fsS -b "$cookie_file" "$base/api/bootstrap" | jq -er --arg account "$account_id" '.accounts[]|select(.id==$account)|.balance')
merge_entries_before=$(docker compose exec -T postgres sh -lc 'psql -U "$POSTGRES_USER" -d emisell_finance_test -Atc "select count(*) from transaction_entries"')
merge_payload=$(jq -nc --arg replacement "$custom_category_id" '{replacementCategoryId:$replacement}')
curl -fsS -b "$cookie_file" -X DELETE -H 'Content-Type: application/json' -d "$merge_payload" "$base/api/expense-categories/$used_expense_category_id" | jq -e --arg replacement "$custom_category_id" '.ok==true and .merged==true and .replacement.id==$replacement' >/dev/null
curl -fsS -b "$cookie_file" "$base/api/settings" | jq -e --arg removed "$used_expense_category_id" '([.expenseCategories[]|select(.id==$removed)]|length)==0' >/dev/null
curl -fsS -b "$cookie_file" "$base/api/budgets?month=2026-08" | jq -e --arg category "$category_id" '(.categories[]|select(.id==$category)|.expenseCategory)=="Pajak & Kepatuhan"' >/dev/null
merge_balance_after=$(curl -fsS -b "$cookie_file" "$base/api/bootstrap" | jq -er --arg account "$account_id" '.accounts[]|select(.id==$account)|.balance')
merge_entries_after=$(docker compose exec -T postgres sh -lc 'psql -U "$POSTGRES_USER" -d emisell_finance_test -Atc "select count(*) from transaction_entries"')
[ "$merge_balance_before" = "$merge_balance_after" ]
[ "$merge_entries_before" = "$merge_entries_after" ]

curl -fsS -b "$cookie_file" -H 'Content-Type: application/json' -d '{"status":"closed"}' "$base/api/budgets/$budget_id/status" | jq -e '.ok==true' >/dev/null
closed_payload=$(jq -nc --arg account "$account_id" '{transactionDate:"2026-08-11",amount:1000,accountId:$account,description:"Should be blocked",category:"Lain-Lain",paymentMethod:"transfer"}')
closed_status=$(curl -sS -o /dev/null -w '%{http_code}' -b "$cookie_file" -H 'Content-Type: application/json' -d "$closed_payload" "$base/api/expenses")
[ "$closed_status" = 409 ]

balance_errors=$(docker compose exec -T postgres sh -lc 'psql -U "$POSTGRES_USER" -d emisell_finance_test -Atc "select count(*) from transactions t where t.status='"'"'posted'"'"' and (select coalesce(sum(e.amount),0) from transaction_entries e where e.transaction_id=t.id)<>0;"')
[ "$balance_errors" = 0 ]
printf 'Production finance integration flow passed.\n'
