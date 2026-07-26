# Backup Database Otomatis — MotorellMarket

Backup logis harian database Supabase (skema `public`: `listings`,
`titip_jual_units`, `profiles`, `mod_parts`, dst) lewat GitHub Actions, disimpan
**terenkripsi** di GitHub Releases, retensi 7 hari.

## ⚠️ Baca dulu: keamanan (PENTING)

- Repo ini **publik**. Dump database berisi **data pribadi** (nama, no. HP,
  email, alamat penjual). Karena itu backup **selalu dienkripsi AES-256**
  sebelum diunggah — tanpa `BACKUP_PASSPHRASE`, file di Releases tidak bisa
  dibaca siapa pun. **Jangan** hapus langkah enkripsi di `backup.sh`.
- Kalau kamu lebih suka backup **tidak** nongol di repo publik sama sekali,
  jadikan repo privat, atau ganti target unggah ke penyimpanan privat
  (mis. Cloudflare R2 / S3 bucket privat). Skrip mudah disesuaikan.
- Ini **pelengkap**, bukan pengganti. Supabase Pro sudah punya backup harian
  + Point-in-Time Recovery yang mencakup seluruh instance (termasuk `auth` &
  `storage`). Backup ini fokus ke data aplikasi (`public`).

## Yang dibuat

| File | Fungsi |
|---|---|
| `backup.sh` | pg_dump → gzip → enkripsi → unggah ke Release → hapus yang > 7 hari |
| `.github/workflows/backup.yml` | Jadwal harian 02:00 WIB + tombol manual |
| `backup.env.example` | Daftar secret yang perlu diisi |

## 1) Ambil connection string (Session Pooler)

Supabase Dashboard → **Project Settings → Database → Connection string** → tab
**Session pooler** → salin URI. Bentuknya:

```
postgresql://postgres.<project-ref>:<db-password>@aws-0-<region>.pooler.supabase.com:5432/postgres
```

Kenapa Session Pooler (bukan yang lain):

- **Direct** (`db.<ref>.supabase.co`) → IPv6-only; runner GitHub tidak punya
  IPv6 → koneksi gagal.
- **Transaction pooler** (port `6543`) → tidak kompatibel `pg_dump`.
- **Session pooler** (port `5432`) → IPv4 + kompatibel `pg_dump`. ✅

## 2) Buat passphrase enkripsi

```bash
openssl rand -base64 32
```

Simpan hasilnya di tempat aman (password manager). **Kalau hilang, backup tidak
bisa di-restore.**

## 3) Tambahkan GitHub Secrets

GitHub repo → **Settings → Secrets and variables → Actions → New repository
secret**. Tambahkan (lihat `backup.env.example`):

Wajib:
- `SUPABASE_DB_URL` — URI Session Pooler dari langkah 1
- `BACKUP_PASSPHRASE` — passphrase dari langkah 2

Opsional (email saat gagal):
- `MAIL_SERVER`, `MAIL_PORT`, `MAIL_USERNAME`, `MAIL_PASSWORD`, `MAIL_TO`
  (Gmail: pakai **App Password**, bukan password akun)

> `GITHUB_TOKEN` **tidak perlu** ditambahkan — otomatis disediakan Actions, dan
> workflow sudah minta izin `contents: write`.

## 4) Commit & aktifkan

```bash
git add backup.sh .github/workflows/backup.yml backup.env.example SETUP.md
git commit -m "chore(ops): automated encrypted DB backup via GitHub Actions"
git push origin main
```

Workflow aktif setelah ter-push (jadwal harian jalan otomatis).

## 5) Tes sekarang (tanpa menunggu jam 2)

GitHub repo → tab **Actions** → **DB Backup** → **Run workflow** → jalankan di
branch `main`. Setelah hijau, cek tab **Releases** — ada `backup-YYYY-MM-DD`
berisi `motorell-*.sql.gz.enc`.

Jadwal cron GitHub kadang meleset beberapa menit dari waktu pasti — itu normal.

## Restore dari backup

Unduh `motorell-*.sql.gz.enc` dari Releases, lalu:

```bash
# 1) dekripsi + dekompres (iter harus 200000, sama seperti saat backup)
openssl enc -d -aes-256-cbc -pbkdf2 -iter 200000 \
  -pass "pass:$BACKUP_PASSPHRASE" -in motorell-XXXX.sql.gz.enc | gunzip > restore.sql

# 2) muat ke database (mis. project Supabase baru / lokal) via Session Pooler
psql "$SUPABASE_DB_URL" -f restore.sql
```

> Uji restore ke database **kosong/terpisah** dulu — jangan langsung ke
> produksi. Backup yang tak pernah diuji-restore = belum tentu backup.

## Penyesuaian

- **Jam**: ubah `cron` di `backup.yml` (UTC). `0 19 * * *` = 02:00 WIB.
- **Retensi**: ubah `RETENTION_DAYS` di step "Run backup" (default `7`).
- **Skema**: set env `BACKUP_SCHEMAS` (mis. `public,auth`) bila mau sertakan
  skema lain — perhatikan izin & kompleksitas FK untuk `auth`.

## Troubleshooting

| Gejala | Penyebab / solusi |
|---|---|
| `pg_dump: could not connect` / timeout | Bukan Session Pooler. Pakai host `...pooler.supabase.com` **port 5432**. |
| `server version mismatch` | Server Postgres lebih baru dari client. Naikkan `postgresql-client-17` → versi sesuai di workflow. |
| Release tak muncul | Cek log step "Run backup" di Actions; pastikan `permissions: contents: write`. |
| Email gagal | Cek secrets `MAIL_*`; Gmail wajib App Password + port 465 (secure). |
| Backup lama tak terhapus | `gh release delete` butuh gh ≥ 2.x (ada di runner) + tag berpola `backup-`. |
