#!/bin/bash
# Gives a running Witching Hour VM one permanent HTTPS address instead of a Cloudflare
# Quick Tunnel link (which changes on every restart).
#
#   sudo bash infra/azure/stable-url.sh chaos-coven.eastasia.cloudapp.azure.com
#
# Needs: the VM's public IP has that DNS name, and ports 80 and 443 are open to the
# internet (see infra/azure/README.md). Caddy gets and renews the HTTPS certificate
# from Let's Encrypt and proxies to the game server on 127.0.0.1:4000. The game's
# access code, security headers and /mcp block all still apply.
set -euo pipefail

FQDN="${1:?usage: stable-url.sh <hostname>}"
if ! [[ "$FQDN" =~ ^[a-z0-9-]+(\.[a-z0-9-]+)+$ ]]; then
  echo "not a hostname: $FQDN" >&2
  exit 1
fi
export DEBIAN_FRONTEND=noninteractive

# Caddy from its official, signed apt repository.
if ! command -v caddy >/dev/null; then
  apt-get install -y debian-keyring debian-archive-keyring apt-transport-https curl gnupg
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | gpg --dearmor --yes -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' -o /etc/apt/sources.list.d/caddy-stable.list
  apt-get update
  apt-get install -y caddy
fi

cat > /etc/caddy/Caddyfile <<CADDY
# Managed by infra/azure/stable-url.sh
$FQDN {
	encode zstd gzip
	reverse_proxy 127.0.0.1:4000
	# Don't announce the server software to visitors.
	header {
		defer
		-Server
		-Via
	}
}
CADDY
systemctl enable caddy
systemctl restart caddy

# The game service runs the game server directly; Caddy is the front door now.
UNIT=/etc/systemd/system/witching-hour.service
sed -i 's#^Description=.*#Description=Witching Hour (sandbox and game server, behind Caddy)#' "$UNIT"
sed -i 's#^ExecStart=.*#ExecStart=/usr/bin/node scripts/start-hosted.mjs#' "$UNIT"
systemctl daemon-reload
systemctl restart witching-hour
echo "stable address: https://$FQDN"
