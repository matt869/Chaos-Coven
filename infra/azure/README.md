# Hosting Witching Hour 24/7 on Azure (Azure for Students)

One small Ubuntu VM runs everything: the Docker sandbox, the game server and a Cloudflare Quick Tunnel protected by an access code. Your PC can be off.

- **Size:** `Standard_B2als_v2` (2 vCPU, 4 GB). Roughly $30/month of student credit, including a Standard SSD and a public IP. (`Standard_B2s` was sold out in East Asia; any 2 vCPU / 4 GB size works. List what's available with `az vm list-skus --location eastasia --resource-type virtualMachines --output table`.)
- **No inbound ports.** The VM only connects out (to Cloudflare, GitHub, package mirrors). It's managed with `az vm run-command`, so SSH isn't needed.
- **Self-healing.** The `witching-hour` systemd service restarts after crashes and reboots. The access code is fixed; the link changes only when the service or VM restarts.

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

## Get the link and the access code

```powershell
az vm run-command invoke -g witching-hour -n witching-hour --command-id RunShellScript `
  --scripts "cat /opt/witching-hour/scripts/.hosting/link.txt || tail -20 /var/log/witching-hour-setup.log"
```

The link is the `trycloudflare.com` address in the output. If the setup log is still running, wait a few minutes and run it again.

## Day to day

| Task | Command |
|---|---|
| Is it healthy? | `az vm run-command invoke -g witching-hour -n witching-hour --command-id RunShellScript --scripts "systemctl status witching-hour --no-pager \| tail -5; cd /opt/witching-hour && sudo -u witch node scripts/sandbox-status.mjs \| tail -1"` |
| Deploy the latest code from GitHub | `az vm run-command invoke -g witching-hour -n witching-hour --command-id RunShellScript --scripts "cd /opt/witching-hour && sudo -u witch git pull && sudo -u witch npm ci --no-audit --no-fund && sudo -u witch npm run build && systemctl restart witching-hour"` (the link changes) |
| Pause it (stops compute charges) | `az vm deallocate -g witching-hour -n witching-hour` |
| Start it again | `az vm start -g witching-hour -n witching-hour` (new link, same code) |
| Delete everything | `az group delete -n witching-hour` |

Check your remaining credit at https://www.microsoftazuresponsorships.com/.
