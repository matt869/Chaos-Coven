# Hosting Witching Hour 24/7 on Azure (Azure for Students)

One small Ubuntu VM runs everything: the Docker sandbox, the game server, and Caddy in front with a free HTTPS certificate. Your PC can be off. (Setup first starts a Cloudflare Quick Tunnel so you can try it straight away; the permanent address below replaces it.)

- **Size:** `Standard_B2als_v2` (2 vCPU, 4 GB). Roughly $30/month of student credit, including a Standard SSD and a public IP. (`Standard_B2s` was sold out in East Asia; any 2 vCPU / 4 GB size works. List what's available with `az vm list-skus --location eastasia --resource-type virtualMachines --output table`.)
- **Only the web ports are open** (80 and 443, to Caddy). Everything else, including SSH, stays closed; the VM is managed with `az vm run-command`.
- **Self-healing.** The `witching-hour` systemd service restarts after crashes and reboots. With the permanent address below, the URL never changes.

## Create it

Sign in once (opens your browser):

```powershell
az login
```

Then:

```powershell
az group create --name witching-hour --location eastasia
az vm create --resource-group witching-hour --name witching-hour `
  --image Ubuntu2404 --size Standard_B2als_v2 `
  --admin-username azureuser --generate-ssh-keys `
  --storage-sku StandardSSD_LRS --os-disk-size-gb 64 `
  --nsg-rule NONE --public-ip-sku Standard `
  --custom-data infra/azure/cloud-init.sh
```

If Azure refuses the region or says the size is not available (`SkuNotAvailable`), pick another region or size and run both commands again. Setup takes about 10 minutes after the VM is created.

## Give it one permanent address

A Cloudflare Quick Tunnel link changes every time the service restarts. For one address that never changes (free, no domain needed), give the VM's public IP a DNS name, open the two web ports, and put Caddy in front of the game:

```powershell
az network public-ip update -g witching-hour -n witching-hourPublicIP --dns-name chaos-coven
az network nsg rule create -g witching-hour --nsg-name witching-hourNSG -n allow-web --priority 900 `
  --direction Inbound --access Allow --protocol Tcp --destination-port-ranges 80 443 --source-address-prefixes Internet
az vm run-command invoke -g witching-hour -n witching-hour --command-id RunShellScript `
  --scripts "cd /opt/witching-hour && sudo -u witch git pull --ff-only && bash infra/azure/stable-url.sh chaos-coven.eastasia.cloudapp.azure.com"
```

The address is then `https://chaos-coven.eastasia.cloudapp.azure.com` (the DNS name, plus your region). [`stable-url.sh`](stable-url.sh) installs Caddy, which gets and renews a free Let's Encrypt certificate, redirects HTTP to HTTPS, and hides its own Server and Via headers. The game's security headers, the `/mcp` block and the access code (if you keep it) all still apply. The address survives restarts, reboots and redeploys; it only goes away if you delete the public IP or the resource group.

## Open to everyone, or behind a code

Setup creates an access code in `/etc/witching-hour.env`. To make the game open to anyone with the link (no password), comment the code out and restart:

```powershell
az vm run-command invoke -g witching-hour -n witching-hour --command-id RunShellScript `
  --scripts "sed -i 's/^WH_ACCESS_CODE=/# WH_ACCESS_CODE=/' /etc/witching-hour.env && systemctl restart witching-hour"
```

Without a code, each shift still belongs only to the browser that started it, and a shift whose page was closed ends after 5 minutes. To turn the code back on, run the same command with the `sed` reversed (`s/^# WH_ACCESS_CODE=/WH_ACCESS_CODE=/`). To read the code: `--scripts "cat /etc/witching-hour.env"`.

## Day to day

| Task | Command |
|---|---|
| Is it healthy? | `az vm run-command invoke -g witching-hour -n witching-hour --command-id RunShellScript --scripts "systemctl status witching-hour --no-pager \| tail -5; cd /opt/witching-hour && sudo -u witch node scripts/sandbox-status.mjs \| tail -1"` |
| Deploy the latest code from GitHub | `az vm run-command invoke -g witching-hour -n witching-hour --command-id RunShellScript --scripts "cd /opt/witching-hour && sudo -u witch git pull && sudo -u witch npm ci --no-audit --no-fund && sudo -u witch npm run build && systemctl restart witching-hour"` (the address stays the same) |
| Pause it (stops compute charges) | `az vm deallocate -g witching-hour -n witching-hour` |
| Start it again | `az vm start -g witching-hour -n witching-hour` (same address, same code) |
| Delete everything | `az group delete -n witching-hour` |

Check your remaining credit at https://www.microsoftazuresponsorships.com/.
