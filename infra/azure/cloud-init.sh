#!/bin/bash
# First-boot setup for an Azure VM (Ubuntu 24.04) that hosts Witching Hour 24/7.
# Passed as --custom-data to `az vm create` (see infra/azure/README.md). Runs once, as root.
#
# Result: Docker + Node 22 + cloudflared, the repo built in /opt/witching-hour, and a
# systemd service that starts the sandbox, the game server and a Cloudflare Quick Tunnel
# protected by an access code, restarting after crashes and reboots.
# Log: /var/log/witching-hour-setup.log
set -euxo pipefail
exec > /var/log/witching-hour-setup.log 2>&1

REPO_URL="${WH_REPO_URL:-https://github.com/matt869/Chaos-Coven.git}"
APP_DIR=/opt/witching-hour
APP_USER=witch
export DEBIAN_FRONTEND=noninteractive

# 2 GB of swap: headroom for builds on a 4 GB VM.
if [ ! -f /swapfile ]; then
  fallocate -l 2G /swapfile
  chmod 600 /swapfile
  mkswap /swapfile
  swapon /swapfile
  echo '/swapfile none swap sw 0 0' >> /etc/fstab
fi

apt-get update
apt-get install -y ca-certificates curl git gnupg docker.io docker-compose-v2
systemctl enable --now docker

# Node.js 22 from the NodeSource apt repository (signed).
curl -fsSL https://deb.nodesource.com/setup_22.x -o /tmp/nodesource_setup.sh
bash /tmp/nodesource_setup.sh
apt-get install -y nodejs

# cloudflared from Cloudflare's apt repository (signed).
mkdir -p --mode=0755 /usr/share/keyrings
curl -fsSL https://pkg.cloudflare.com/cloudflare-main.gpg -o /usr/share/keyrings/cloudflare-main.gpg
echo 'deb [signed-by=/usr/share/keyrings/cloudflare-main.gpg] https://pkg.cloudflare.com/cloudflared any main' > /etc/apt/sources.list.d/cloudflared.list
apt-get update
apt-get install -y cloudflared

# An unprivileged user that may use Docker, and the app.
id "$APP_USER" >/dev/null 2>&1 || useradd --system --create-home --shell /usr/sbin/nologin "$APP_USER"
usermod -aG docker "$APP_USER"
if [ ! -d "$APP_DIR/.git" ]; then git clone "$REPO_URL" "$APP_DIR"; fi
chown -R "$APP_USER:$APP_USER" "$APP_DIR"
sudo -u "$APP_USER" -H bash -c "cd '$APP_DIR' && npm ci --no-audit --no-fund && npm run build"

# A fixed access code, kept across restarts. Readable by root and the app user only.
# Tracing off while handling the code, so it never lands in the setup log.
set +x
if [ ! -f /etc/witching-hour.env ]; then
  # Not `tr </dev/urandom | head`: under pipefail, head closing the pipe kills tr with
  # SIGPIPE and the whole script stops (that bug stopped the first setup).
  CODE="$(node -e "const a='abcdefghjkmnpqrstuvwxyz23456789';const b=require('crypto').randomBytes(12);let s='';for(const x of b)s+=a[x%a.length];console.log(s.replace(/(....)(....)(....)/,'\$1-\$2-\$3'))")"
  printf 'WH_ACCESS_CODE=%s\n' "$CODE" > /etc/witching-hour.env
fi
chown root:"$APP_USER" /etc/witching-hour.env
chmod 640 /etc/witching-hour.env
set -x

cat > /etc/systemd/system/witching-hour.service <<UNIT
[Unit]
Description=Witching Hour (sandbox, game server, Cloudflare Quick Tunnel)
After=docker.service network-online.target
Requires=docker.service
Wants=network-online.target

[Service]
User=$APP_USER
WorkingDirectory=$APP_DIR
EnvironmentFile=/etc/witching-hour.env
# The first start builds the sandbox images, which takes a few minutes.
TimeoutStartSec=1200
ExecStartPre=/usr/bin/docker compose -f sandbox/docker-compose.yml up -d --build
# host-quick refuses to start until the sandbox is healthy; systemd retries.
ExecStart=/usr/bin/node scripts/host-quick.mjs
Restart=always
RestartSec=20

[Install]
WantedBy=multi-user.target
UNIT

systemctl daemon-reload
systemctl enable --now witching-hour
echo "setup finished"
