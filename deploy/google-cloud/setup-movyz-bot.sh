#!/usr/bin/env bash
set -euo pipefail

PROJECT_ID="${1:-}"
ZONE="${2:-us-east1-b}"
REPO_URL="${3:-https://github.com/zaidzaid2013333-tech/Movyz.git}"
VM_NAME="${4:-movyz-source-bot}"

if [[ -z "$PROJECT_ID" ]]; then
  echo "Usage: $0 <GCP_PROJECT_ID> [ZONE] [REPO_URL] [VM_NAME]"
  exit 1
fi

if ! command -v gcloud >/dev/null 2>&1; then
  echo "gcloud CLI is required."
  exit 1
fi

gcloud config set project "$PROJECT_ID"

if ! gcloud compute instances describe "$VM_NAME" --zone "$ZONE" >/dev/null 2>&1; then
  gcloud compute instances create "$VM_NAME"     --zone "$ZONE"     --machine-type "e2-micro"     --image-family "ubuntu-2404-lts-amd64"     --image-project "ubuntu-os-cloud"     --boot-disk-size "30GB"     --boot-disk-type "pd-standard"     --network-tier "STANDARD"     --tags "movyz-bot"
fi

gcloud compute ssh "$VM_NAME" --zone "$ZONE" --command "sudo bash -s -- '$REPO_URL'" <<'REMOTE'
set -euo pipefail
REPO_URL="$1"

export DEBIAN_FRONTEND=noninteractive
apt-get update
apt-get install -y ca-certificates curl git build-essential

if ! command -v node >/dev/null 2>&1; then
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
  apt-get install -y nodejs
fi

id movyz >/dev/null 2>&1 || useradd --system --create-home --home-dir /opt/movyz --shell /usr/sbin/nologin movyz

rm -rf /tmp/movyz-bootstrap
git clone --depth 1 "$REPO_URL" /tmp/movyz-bootstrap
rm -rf /opt/movyz
mv /tmp/movyz-bootstrap /opt/movyz
chown -R movyz:movyz /opt/movyz

cd /opt/movyz
npm install

install -d -m 0750 -o root -g movyz /etc/movyz
if [[ ! -f /etc/movyz/movyz.env ]]; then
  install -m 0640 -o root -g movyz /dev/null /etc/movyz/movyz.env
fi

install -m 0644 /opt/movyz/deploy/google-cloud/movyz-source-bot.service /etc/systemd/system/movyz-source-bot.service
systemctl daemon-reload
systemctl enable movyz-source-bot
systemctl restart movyz-source-bot

systemctl --no-pager --full status movyz-source-bot || true
REMOTE
