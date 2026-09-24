#!/bin/sh
# Run from repository root. Backend is paused for a consistent DB/files snapshot.
set -eu
umask 077
destination=${1:?Usage: sh ops/backup.sh NEW_BACKUP_DIRECTORY}
test ! -e "$destination" || { echo 'Destination must be new' >&2; exit 1; }
mkdir -p "$destination"
docker compose stop backend
trap 'docker compose start backend' EXIT
docker compose exec -T postgres pg_dump -U postgres -d helpdesk -Fc > "$destination/database.dump"
docker compose run --rm --no-deps --entrypoint tar backend -czf - -C /app/storage . > "$destination/attachments.tar.gz"
(cd "$destination" && sha256sum database.dump attachments.tar.gz > SHA256SUMS)
echo 'Backup complete. Store the encryption key separately. Rehearse restoration before relying on this backup.'
