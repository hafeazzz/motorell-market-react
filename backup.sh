#!/usr/bin/env bash
# ============================================================
# backup.sh — Backup logis (pg_dump) database Supabase MotorellMarket.
#
# Alur:
#   pg_dump skema `public`  →  gzip  →  ENKRIPSI AES-256  →  unggah ke GitHub
#   Release bertag `backup-YYYY-MM-DD`  →  hapus release backup > RETENTION_DAYS.
#
# ⚠️  WAJIB DIENKRIPSI: repo ini PUBLIK, dan dump berisi DATA PRIBADI (nama,
#     no. HP, email, alamat penjual di titip_jual_units & profiles). Tanpa
#     enkripsi, siapa pun bisa mengunduhnya dari halaman Releases. Passphrase
#     diambil dari GitHub Secret BACKUP_PASSPHRASE.
#
# Dependencies (semua ada di runner GitHub Actions): pg_dump (postgresql-client),
# gzip, openssl, gh (GitHub CLI). Lihat SETUP.md.
# ============================================================
set -euo pipefail

# ---- Konfigurasi dari environment / GitHub Secrets ----
: "${SUPABASE_DB_URL:?SUPABASE_DB_URL belum diset (pakai connection string SESSION POOLER, port 5432 — lihat SETUP.md)}"
: "${BACKUP_PASSPHRASE:?BACKUP_PASSPHRASE belum diset (passphrase enkripsi)}"
RETENTION_DAYS="${RETENTION_DAYS:-7}"
BACKUP_SCHEMAS="${BACKUP_SCHEMAS:-public}"     # skema yang di-dump (pisah koma)
ITER=200000                                    # iterasi PBKDF2 (samakan saat restore)

DATE="$(date -u +%Y-%m-%d)"
STAMP="$(date -u +%Y%m%d-%H%M%SZ)"
TAG="backup-${DATE}"
WORK="$(mktemp -d)"
DUMP="${WORK}/motorell-${STAMP}.sql"
GZ="${DUMP}.gz"
ENC="${GZ}.enc"
trap 'rm -rf "$WORK"' EXIT

log() { printf '%s  %s\n' "$(date -u +%H:%M:%SZ)" "$*"; }
fail() { log "ERROR: $*"; exit 1; }

# ---- 1) Dump ----
log "pg_dump skema '${BACKUP_SCHEMAS}'…"
schema_args=()
IFS=',' read -ra _schemas <<< "$BACKUP_SCHEMAS"
for s in "${_schemas[@]}"; do schema_args+=(--schema="$s"); done

pg_dump "$SUPABASE_DB_URL" \
  "${schema_args[@]}" \
  --no-owner --no-privileges --quote-all-identifiers \
  --file "$DUMP" || fail "pg_dump gagal (cek SUPABASE_DB_URL / gunakan Session Pooler)"

bytes=$(wc -c < "$DUMP")
[ "$bytes" -gt 128 ] || fail "hasil dump mencurigakan kecil (${bytes} byte)"
log "Dump OK: ${bytes} byte"

# ---- 2) Kompres ----
gzip -9 "$DUMP"                                  # → $GZ
log "Terkompres: $(wc -c < "$GZ") byte"

# ---- 3) Enkripsi (WAJIB — repo publik) ----
openssl enc -aes-256-cbc -pbkdf2 -iter "$ITER" -salt \
  -pass "pass:${BACKUP_PASSPHRASE}" -in "$GZ" -out "$ENC" || fail "enkripsi gagal"
log "Terenkripsi: $(basename "$ENC") ($(wc -c < "$ENC") byte)"

# ---- 4) Unggah ke GitHub Release ----
if gh release view "$TAG" >/dev/null 2>&1; then
  gh release upload "$TAG" "$ENC" --clobber
else
  gh release create "$TAG" "$ENC" \
    --title "DB backup ${DATE}" \
    --notes "Backup logis otomatis (pg_dump, skema: ${BACKUP_SCHEMAS}), terenkripsi AES-256-CBC (PBKDF2 iter=${ITER}). Cara restore: lihat SETUP.md."
fi
log "Terunggah ke release '${TAG}'"

# ---- 5) Bersihkan backup lama (> RETENTION_DAYS hari) ----
cutoff=$(date -u -d "${RETENTION_DAYS} days ago" +%s)
gh release list --limit 200 --json tagName,createdAt \
  --jq '.[] | select(.tagName | startswith("backup-")) | [.tagName, .createdAt] | @tsv' |
while IFS=$'\t' read -r tag created; do
  ts=$(date -u -d "$created" +%s)
  if [ "$ts" -lt "$cutoff" ]; then
    log "Hapus backup lama: ${tag}"
    gh release delete "$tag" --yes --cleanup-tag || log "  (gagal hapus ${tag}, dilewati)"
  fi
done

log "SELESAI ✔  (retensi ${RETENTION_DAYS} hari)"
