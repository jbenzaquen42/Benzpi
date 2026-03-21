---
name: dev-environment
description: Use when starting, stopping, debugging, or cleaning up local development services and containerized environments, especially Docker Desktop or OrbStack style workflows.
---

# Dev Environment

Use this skill when the task is primarily about the local development environment rather than product code.

Typical cases:
- start or stop local services
- debug a broken Docker or Compose stack
- inspect logs, ports, health checks, and volumes
- clean up stale containers or rebuild an environment
- verify that the local environment is actually healthy

This skill is intentionally local-development-first. It is not a Kubernetes or production deployment guide.

## Core Rules

### Read the Environment Definition First

Before changing anything, inspect the files that define the environment:

```powershell
Get-ChildItem -Force
rg --files -g "Dockerfile*" -g "compose*.yml" -g "compose*.yaml" -g ".env*" -g ".dockerignore"
```

Also check project docs if they mention startup steps or service expectations.

### Verify Before Claiming Success

Do not say the environment is fixed unless you have a command that demonstrates recovery:
- `docker compose ps`
- `docker logs`
- `docker build`
- an app health check
- a successful startup command

### Keep Fixes Reversible and Targeted

Prefer small changes and direct diagnosis over broad cleanup or destructive resets.

## Docker and Compose Workflow

### Inspect

```powershell
docker version
docker compose version
docker compose config
docker compose ps
```

Look for:
- invalid compose config
- missing images or build contexts
- port collisions
- unhealthy containers
- missing environment variables

### Start or Restart

```powershell
docker compose up -d
docker compose restart <service>
docker compose up -d --build <service>
```

Prefer restarting or rebuilding the affected service before taking down the whole stack.

### Logs and Health

```powershell
docker compose logs --tail=200 <service>
docker inspect <container-id>
docker compose ps
```

Use logs and health status to identify root cause before changing files.

### Cleanup

Use cleanup carefully:

```powershell
docker compose down
docker compose down -v
docker system df
docker image prune -f
```

Guidance:
- avoid `down -v` unless you understand the data impact
- avoid broad pruning unless the issue is genuinely stale cache or disk pressure

## Common Issues

### Port Already In Use

Check what owns the port:

```powershell
Get-NetTCPConnection -LocalPort <port> -ErrorAction SilentlyContinue
```

Then either stop the conflicting process or change the service port intentionally.

### Service Starts Then Exits

Check:
- entrypoint or command mismatch
- missing env vars
- mount paths
- dependency service readiness
- startup command failure in logs

### Build Fails

Check:
- wrong build context
- missing files due to `.dockerignore`
- invalid base image tag
- failed package install step
- copied paths that do not exist

### Volume or Bind Mount Issues

Check:
- path existence on host
- container working directory expectations
- file ownership or permission assumptions

## When To Escalate

This skill is a good fit when the problem is environment wiring. If the real issue is application logic inside a working environment, hand off to the right implementation worker.
