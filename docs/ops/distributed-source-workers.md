# Distributed source workers

Movyz can run source maintenance across three layers that share the same Supabase lease state:

1. **GitHub Actions** — the autonomous baseline runner. Every 15 minutes it runs one complete maintenance cycle: primary sources, secondary sources, then expiring-source repair.
2. **GitHub Codespaces** — an optional burst worker. The devcontainer starts `npm run bot` automatically when the Codespace starts and the three Supabase environment variables are present. Stop the Codespace to stop this worker.
3. **Cloudflare scheduled maintenance** — remains compatible as a fallback because `server/maintenance.ts` uses Supabase leases. A concurrent tick that cannot acquire its lease exits as `skipped` instead of duplicating the same job.

## GitHub Actions secrets

In the repository settings, add these Actions secrets:

- `SUPABASE_URL`
- `SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`

Then use **Actions → Movyz Source Maintenance → Run workflow** for an immediate cycle.

## Codespaces secrets

Add the same three values as Codespaces secrets. Do not commit them to the repository.

After opening the Codespace, the worker log is:

```bash
tail -f /tmp/movyz-source-bot.log
```

To stop the worker without stopping the Codespace:

```kill "$(cat /tmp/movyz-source-bot.pid)"
```

## Operational behavior

The Actions runner calls `runMaintenanceTick()` directly, so it uses the same provider resolution and persistence logic as the existing VM runner.

The database lease state prevents duplicate work between Actions, Codespaces, Cloudflare, and the future VM runner. Keep at least one layer enabled; the others can be used for bursts or fallback.

Never place a Supabase service-role key in source files, commits, workflow YAML, or Codespaces config.
