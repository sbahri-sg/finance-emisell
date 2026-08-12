# Emisell Finance

Dashboard manajemen keuangan internal untuk perusahaan kecil. Aplikasi mencakup rekening, ledger transaksi, tagihan berulang, deposit iklan, pengajuan belanja, RAB, rekonsiliasi, dan laporan.

Modul pengajuan belanja memisahkan permintaan kebutuhan kantor dari transaksi pembayaran. Alurnya adalah diajukan, disetujui, dibeli, kemudian diterima. Saldo hanya berubah ketika pembayaran diposting ke ledger.

## Menjalankan aplikasi

1. Salin `.env.example` menjadi `.env` dan gunakan password database acak yang panjang.
2. Jalankan `docker compose up --build -d`.
3. Buka `http://localhost:8080`.
4. Pada kunjungan pertama, buat akun Owner dan workspace Emisell.

## Deployment production

Gunakan `compose.production.yml` bersama `.env.production`. Instruksi server, HTTPS, update, dan backup tersedia di [DEPLOYMENT.md](DEPLOYMENT.md).

## Prinsip keamanan

- Browser tidak pernah diberi kredensial PostgreSQL.
- Sesi login disimpan dalam cookie HttpOnly dengan SameSite Strict.
- Seluruh data bisnis membawa `organization_id` dan dicek ulang pada database.
- Transaksi posted tidak bisa diedit atau dihapus; koreksi dilakukan dengan reversal.
- Posting hanya dapat dilakukan Owner/Finance dan hanya jika ledger berimbang.
- Dokumen disimpan pada bucket private, dibatasi tipe dan ukuran file.
- Kredensial produksi harus disimpan di secret manager milik hosting.
- Aktifkan MFA untuk Owner/Finance dan Point-in-Time Recovery untuk database produksi.

## Model ledger

Nilai saldo tidak disimpan sebagai angka yang bebas diedit. Saldo dihitung dari `opening_balance` ditambah seluruh `transaction_entries` pada transaksi berstatus `posted`. Setiap transaksi wajib memiliki sedikitnya dua entry dan total `base_amount` harus nol.

Contoh top-up Meta Ads Rp10 juta:

- rekening bank: `-10.000.000`
- akun deposit Meta Ads: `+10.000.000`

Top-up tidak menjadi biaya. Biaya baru terjadi saat deposit digunakan.

## Pemeriksaan sebelum produksi

- Konfigurasikan URL redirect autentikasi secara eksplisit.
- Nonaktifkan sign-up publik; undang pengguna oleh Owner.
- Terapkan rate limit pada fungsi server dan notifikasi.
- Pasang Content Security Policy di hosting.
- Uji restore backup secara berkala.
- Lakukan rekonsiliasi minimal mingguan dan tutup periode bulanan.
