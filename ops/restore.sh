#!/bin/sh
# Target MUST be a new isolated Compose project with empty volumes.
set -eu
source_dir=${1:?Usage: COMPOSE_PROJECT_NAME=helpdesk-restore sh ops/restore.sh BACKUP_DIRECTORY}
case "${COMPOSE_PROJECT_NAME:-}" in *-restore*) ;; *) echo 'Use an isolated COMPOSE_PROJECT_NAME containing -restore' >&2; exit 1;; esac
export HELPDESK_SUBNET=${HELPDESK_SUBNET:-172.30.51.0/24}
export HELPDESK_PROXY_IP=${HELPDESK_PROXY_IP:-172.30.51.10}
(cd "$source_dir" && sha256sum -c SHA256SUMS)
docker compose up -d --wait postgres
tables=$(docker compose exec -T postgres psql -U postgres -d helpdesk -Atc "SELECT count(*) FROM information_schema.tables WHERE table_schema='public'")
test "$tables" = 0 || { echo 'Refusing to restore into a nonempty database' >&2; exit 1; }
docker compose exec -T postgres pg_restore -U postgres -d helpdesk --exit-on-error < "$source_dir/database.dump"
docker compose run --rm -T --no-deps --entrypoint sh backend -c 'test -z "$(ls -A /app/storage)" && tar -xzf - -C /app/storage' < "$source_dir/attachments.tar.gz"
docker compose run --rm migrate
echo 'Restore completed. Keep mailboxes disabled in the drill environment before starting workers. Verify row counts and attachment downloads.'
