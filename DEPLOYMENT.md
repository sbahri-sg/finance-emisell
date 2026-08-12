# Deployment Emisell Finance

Konfigurasi ini ditujukan untuk satu server/VPS kecil dengan Docker Compose dan reverse proxy HTTPS. PostgreSQL hanya berada di jaringan internal Docker; aplikasi secara default hanya terbuka pada `127.0.0.1:8080`.

## Kebutuhan server

- Linux 64-bit dengan Docker Engine dan Docker Compose v2
- Minimal 1 CPU, RAM 1 GB, dan ruang kosong 10 GB
- Domain/subdomain, misalnya `finance.perusahaan.com`
- Reverse proxy HTTPS seperti Nginx, Caddy, Traefik, atau Cloudflare Tunnel

## Persiapan pertama

1. Salin `.env.production.example` menjadi `.env.production`.
2. Ganti password database dengan nilai acak URL-safe minimal 32 karakter.
3. Isi `APP_ORIGIN` dengan URL HTTPS final tanpa slash di belakang.
4. Lindungi file konfigurasi dengan `chmod 600 .env.production`.
5. Validasi konfigurasi:

```sh
docker compose --env-file .env.production -f compose.production.yml config --quiet
```

## Menjalankan deployment

```sh
docker compose --env-file .env.production -f compose.production.yml up -d --build
docker compose --env-file .env.production -f compose.production.yml ps
```

Migrasi database dijalankan otomatis saat aplikasi dimulai. Buka URL HTTPS yang sudah dikonfigurasi dan buat akun Owner pada instalasi pertama.

## Reverse proxy

Teruskan trafik HTTPS dari domain ke `http://127.0.0.1:8080`. Kirim header berikut:

- `Host`
- `X-Forwarded-For`
- `X-Forwarded-Proto: https`

Jangan membuka port PostgreSQL ke internet. Jika aplikasi memang harus diakses langsung tanpa reverse proxy pada port publik, ubah `APP_BIND_ADDRESS`, tetapi HTTPS tetap wajib karena cookie login menggunakan atribut Secure.

## Update aplikasi

Selalu buat backup sebelum update:

```sh
./scripts/backup-database.sh .env.production
docker compose --env-file .env.production -f compose.production.yml up -d --build
docker compose --env-file .env.production -f compose.production.yml ps
```

Container lama diganti, sedangkan data PostgreSQL tetap berada pada volume `emisell_finance_postgres_data`.

## Backup database

```sh
./scripts/backup-database.sh .env.production
```

Backup tersimpan dalam folder `backups/` dengan izin file terbatas. Salin backup secara terenkripsi ke lokasi lain. Backup yang hanya berada pada server yang sama tidak cukup untuk pemulihan bencana.

Lakukan uji restore berkala pada database terpisah. Jangan menguji restore langsung pada database production.

## Pemeriksaan operasional

```sh
docker compose --env-file .env.production -f compose.production.yml ps
docker compose --env-file .env.production -f compose.production.yml logs --tail=100 app
docker compose --env-file .env.production -f compose.production.yml exec postgres pg_isready
```

Status aplikasi harus `healthy`. Log Docker dibatasi dan diputar otomatis agar tidak memenuhi disk.

## Keamanan

- Jangan commit `.env.production`, backup database, atau kredensial.
- Izinkan SSH hanya menggunakan key dan batasi firewall ke port 80/443.
- Aktifkan update keamanan otomatis pada server.
- Gunakan password berbeda untuk PostgreSQL dan akun Owner.
- Backup terenkripsi harus disimpan di lokasi terpisah.
- Pantau kapasitas disk dan status health container.
