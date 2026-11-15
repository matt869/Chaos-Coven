# Hosting Witching Hour with Cloudflare

Witching Hour can't run on Cloudflare Pages or Workers: the game server drives a Docker Compose sandbox with the Docker CLI. Instead, run the whole stack on one machine with Docker (your PC or a VM), and put a **Cloudflare Tunnel** in front of it, with **Cloudflare Access** deciding who can get in.

```
judge's browser ──HTTPS──▶ Cloudflare (Access login) ──tunnel──▶ cloudflared on your machine ──▶ game server 127.0.0.1:4000
                                                                                                     │
                                                                                         sandbox (Docker, never exposed)
```

Only the game server goes through the tunnel. It serves everything a player needs on one hostname: the player UI, the API, the terminal WebSocket, Daemonwatch at `/daemonwatch/`, and Grafana at `/grafana/`.

## 1. Run the stack

```bash
npm install
npm run build
npm run sandbox:up
npm run sandbox:status     # wait until it says "sandbox: healthy"
npm run start:hosted       # game server with demo timings (see scripts/start-hosted.mjs)
```

Open http://127.0.0.1:4000 locally and check a haunting starts before going further.

## 2. Create the tunnel

You need a domain on Cloudflare. `cloudflared` is already installed on Windows if `cloudflared --version` works.

```bash
cloudflared tunnel login                                   # opens a browser; pick your domain
cloudflared tunnel create witching-hour                    # prints the tunnel ID and credentials file
cloudflared tunnel route dns witching-hour play.example.com
```

Copy [`config.example.yml`](config.example.yml) to `infra/cloudflare/config.yml` (it's gitignored), fill in the tunnel ID, credentials path and hostname, then:

```bash
cloudflared tunnel --config infra/cloudflare/config.yml run
```

## 3. Put Cloudflare Access in front (do not skip)

The game has no login of its own: it was designed to be reachable only from your machine. Anyone who reaches it can start and end hauntings in your sandbox, so require a login:

1. Cloudflare dashboard → **Zero Trust** → **Access** → **Applications** → **Add an application** → **Self-hosted**.
2. Application domain: `play.example.com`.
3. Add a policy: **Allow**, with an **Emails** rule listing the judges and playtesters (or an **Emails ending in** rule for a team). They sign in with a one-time code sent to their email.
4. Save, then open `https://play.example.com` in a private window to check it asks for a login.

## 4. Before you share the link

- **One sandbox, one player.** A second visitor sees "someone is already on call" and when it frees up. Sessions end and revert on their own after `WH_SESSION_MAX_MINUTES` (20 in hosted mode).
- **Keep the machine awake, and Docker running.** If the PC sleeps or Docker Desktop quits, the sandbox goes down (this happened twice during testing). In Windows power settings, set sleep to **Never** while hosting. In Docker Desktop **Settings → General**, turn on **Start Docker Desktop when you sign in**. Check with `npm run sandbox:status`.
- **Never expose the sandbox ports** (3000, 3100, 8081-8084, 8474, 9090). The tunnel config only routes the game server.
- `/mcp` is blocked in the tunnel config, and the server also refuses any MCP request that came through a proxy.
- Put the link in the README's "Play it" line once it works.

## Quick temporary link (no Access)

For a five-minute check, `cloudflared tunnel --url http://127.0.0.1:4000` prints a random `*.trycloudflare.com` link with no account needed. **Anyone with that link can play, and there's no login.** Use it only briefly, and stop it with Ctrl+C.
