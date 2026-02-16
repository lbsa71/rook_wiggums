# Systemd Deployment Guide

This guide covers deploying Substrate as a systemd service with automatic crash recovery.

## Architecture Overview

Substrate uses a two-service architecture for crash resilience:

1. **substrate.service** — Main service running the supervisor process
2. **substrate-recovery.service** — Recovery service triggered on failure

When the main service fails, systemd automatically activates the recovery service, which uses Claude AI to diagnose the issue, attempt a fix, and restart the service.

## Features

- **Automatic Recovery** — Claude AI diagnoses and fixes common issues
- **Smart Retry Logic** — Max 3 attempts with counter tracking
- **Email Notifications** — Alert on recovery exhaustion
- **Auto-Reset** — Counter resets on successful restart
- **60-Second Delay** — Gives transient issues time to resolve
- **5-Minute Timeout** — Prevents infinite hangs

## Installation

### Prerequisites

1. **Node.js 20+** installed (preferably via nvm)
2. **Claude CLI** installed and authenticated
   ```bash
   claude --version
   ```
3. **gog CLI** (optional, for email notifications)
   ```bash
   # Install gog if needed for email notifications
   # See: https://github.com/your-org/gog
   ```
4. **Substrate** repository cloned to `~/substrate`

### 1. Build Substrate

```bash
cd ~/substrate
npm install
cd server
npm run build
```

Verify the build:
```bash
ls -l server/dist/supervisor.js
```

### 2. Install Systemd Unit Files

```bash
# Create systemd user directory if it doesn't exist
mkdir -p ~/.config/systemd/user

# Copy service files (using user-level systemd)
cp ~/substrate/systemd/substrate.service ~/.config/systemd/user/substrate@.service
cp ~/substrate/systemd/substrate-recovery.service ~/.config/systemd/user/substrate-recovery@.service

# Reload systemd to recognize new services
systemctl --user daemon-reload
```

**Note**: The `@` syntax creates template units that work with your username. The service files use `%i` which systemd replaces with your username.

### 3. Enable User Lingering (Optional)

To allow services to run even when you're not logged in:

```bash
sudo loginctl enable-linger $(whoami)
```

### 4. Configure Environment Variables

The service files use a default Node.js path (`node/default/bin`) which you should create as a symlink:

```bash
# Create a 'default' symlink to your current Node version
# This avoids hardcoding version numbers in service files
ln -sf ~/.nvm/versions/node/v20.11.1 ~/.nvm/versions/node/default
```

Then create or edit `~/.config/systemd/user/substrate@.service.d/override.conf` for additional customization:

```bash
mkdir -p ~/.config/systemd/user/substrate@.service.d
cat > ~/.config/systemd/user/substrate@.service.d/override.conf <<'EOF'
[Service]
Environment="SUBSTRATE_ADMIN_EMAIL=your-email@example.com"
Environment="NODE_ENV=production"
# Optional: Override PATH if you need different Node installation
# Environment="PATH=/usr/bin:/usr/local/bin:/home/yourusername/.nvm/versions/node/v20.11.1/bin"
EOF
```

Replace:
- `your-email@example.com` with your actual email
- `/home/yourusername` with your actual home directory (if overriding PATH)
- Node version path with your actual Node.js installation (if overriding PATH)

Reload after editing:
```bash
systemctl --user daemon-reload
```

### 5. Start and Enable Services

```bash
# Start the main service (replace 'yourusername' with your username)
systemctl --user start substrate@$(whoami).service

# Enable auto-start on boot
systemctl --user enable substrate@$(whoami).service

# Check status
systemctl --user status substrate@$(whoami).service
```

## Usage

### Managing the Main Service

```bash
# Start
systemctl --user start substrate@$(whoami).service

# Stop
systemctl --user stop substrate@$(whoami).service

# Restart
systemctl --user restart substrate@$(whoami).service

# Status
systemctl --user status substrate@$(whoami).service

# View logs
journalctl --user -u substrate@$(whoami).service -f
```

### Monitoring Recovery

```bash
# Check recovery service status
systemctl --user status substrate-recovery@$(whoami).service

# View recovery logs
journalctl --user -u substrate-recovery@$(whoami).service -f

# Check recovery attempt counter
cat /tmp/substrate-recovery-attempts
```

### Manual Recovery Reset

If you need to reset the recovery attempt counter manually:

```bash
rm -f /tmp/substrate-recovery-attempts
```

This is automatically done when:
- Recovery succeeds and substrate restarts successfully
- Max attempts are exhausted (to allow manual intervention)

## How Recovery Works

### Trigger Conditions

The recovery service activates when `substrate.service` enters a failed state:
- Non-zero exit code (not 75, which is restart-by-design)
- Process crash or kill signal
- Timeout or resource limit exceeded

The main service's `Restart=on-failure` handles simple crashes, but persistent failures trigger recovery.

### Recovery Workflow

1. **Delay** — 60-second sleep gives transient issues time to resolve
2. **Attempt Check** — Verify we haven't exceeded 3 attempts
3. **Claude Diagnosis** — Run AI analysis with system checks:
   - Read systemd journal for error messages
   - Check TypeScript build status
   - Verify disk space, memory, Node version
   - Look for common issues (corrupt files, missing dependencies, port conflicts)
4. **Auto-Fix** — Claude attempts repairs:
   - Rebuild if TypeScript errors found
   - Restore from backup if substrate files corrupted
   - Reinstall dependencies if missing
5. **Restart** — Restart `substrate.service` via systemctl
6. **Verify** — Check if service is active after 5 seconds
7. **Reset** — Clear attempt counter on success

### Failure Handling

After 3 failed recovery attempts:
1. Email notification sent to configured admin email
2. Attempt counter reset to allow manual restart
3. Recovery service exits (no further automatic attempts)
4. Admin intervention required

## Troubleshooting

### Recovery Service Not Triggering

Check `OnFailure=` is properly configured:
```bash
systemctl --user cat substrate@$(whoami).service | grep OnFailure
```

Should show:
```
OnFailure=substrate-recovery@%i.service
```

### Claude CLI Not Found

Ensure Claude is in the PATH for systemd services:
```bash
# Test Claude availability
systemctl --user show-environment | grep PATH

# Update PATH in service override if needed
# See "Configure Environment Variables" section above
```

### Email Notifications Not Sending

1. Verify `gog` is installed and in PATH:
   ```bash
   which gog
   gog gmail send --help
   ```

2. Set `SUBSTRATE_ADMIN_EMAIL` environment variable (see step 4 above)

3. Check recovery logs for email send attempts:
   ```bash
   journalctl --user -u substrate-recovery@$(whoami).service | grep email
   ```

### Recovery Keeps Failing

View detailed recovery output:
```bash
# Check Claude's recovery attempt log
cat /tmp/substrate-recovery-output.log

# View full recovery service logs
journalctl --user -u substrate-recovery@$(whoami).service -n 200
```

Common issues:
- **Build failures** — Run `cd ~/substrate/server && npm install && npm run build` manually
- **Permission issues** — Check ownership of `~/.local/share/substrate` and `~/.config/substrate`
- **Port conflicts** — Check if port 3000 is in use: `netstat -tlnp | grep 3000`
- **Corrupt state** — Restore from backup: `cd ~/substrate/server && npm run restore`

### Manually Test Recovery Script

```bash
# Run recovery script directly
bash -x ~/substrate/systemd/substrate-recovery.sh

# This will go through the full recovery process
```

## System-Wide Installation (Alternative)

For system-wide installation (requires root):

```bash
# Copy service files
sudo cp ~/substrate/systemd/substrate.service /etc/systemd/system/substrate@.service
sudo cp ~/substrate/systemd/substrate-recovery.service /etc/systemd/system/substrate-recovery@.service

# Reload systemd
sudo systemctl daemon-reload

# Start for specific user
sudo systemctl start substrate@yourusername.service
sudo systemctl enable substrate@yourusername.service
```

## Configuration Files

### substrate.service

Main service unit that:
- Runs `node dist/supervisor.js` in the server directory
- Restarts on failure (simple crashes)
- Triggers recovery service on persistent failures
- Includes security hardening (NoNewPrivileges, PrivateTmp, etc.)

### substrate-recovery.service

Recovery service unit that:
- Activates only on main service failure (`OnFailure=`)
- Type is `oneshot` (runs once per failure)
- 60-second pre-start delay
- 5-minute timeout
- Executes `substrate-recovery.sh`

### substrate-recovery.sh

Recovery script that:
- Tracks attempt counter (max 3)
- Runs Claude AI diagnosis
- Attempts automatic fixes
- Restarts main service
- Sends email on exhaustion
- Resets counter on success

## Monitoring & Alerts

### Recommended Monitoring

Set up external monitoring to alert on:

1. **Service State**
   ```bash
   systemctl --user is-active substrate@$(whoami).service
   ```

2. **Recovery Attempts**
   ```bash
   journalctl --user -u substrate-recovery@$(whoami).service --since "1 hour ago" | wc -l
   ```

3. **Crash Rate**
   ```bash
   journalctl --user -u substrate@$(whoami).service --since "1 day ago" | grep -c "exited"
   ```

### Log Files

- **Main service logs**: `journalctl --user -u substrate@$(whoami).service`
- **Recovery logs**: `journalctl --user -u substrate-recovery@$(whoami).service`
- **Application logs**: `~/.local/share/substrate/debug.log`
- **Recovery output**: `/tmp/substrate-recovery-output.log`

## Security Considerations

The recovery service runs with the same user permissions as the main service and includes:

- **No privilege escalation** — `NoNewPrivileges=true`
- **Read-only system** — `ProtectSystem=strict`
- **Limited home access** — `ProtectHome=read-only`
- **Writable paths** — Only substrate data and config directories
- **No capabilities** — `CapabilityBoundingSet=` (empty)

The recovery script uses `--dangerously-skip-permissions` with Claude CLI to allow file system operations. This is necessary for automated recovery but means Claude has full user-level access. Ensure:

1. Your system is properly secured at the OS level
2. Claude CLI is from a trusted source and up-to-date
3. You monitor recovery logs for unexpected actions

## Uninstallation

```bash
# Stop and disable services
systemctl --user stop substrate@$(whoami).service
systemctl --user disable substrate@$(whoami).service

# Remove service files
rm ~/.config/systemd/user/substrate@.service
rm ~/.config/systemd/user/substrate-recovery@.service
rm -rf ~/.config/systemd/user/substrate@.service.d

# Reload systemd
systemctl --user daemon-reload

# Clean up temporary files
rm -f /tmp/substrate-recovery-attempts
rm -f /tmp/substrate-recovery-in-progress
rm -f /tmp/substrate-recovery-output.log
```

## References

- [systemd.service manual](https://www.freedesktop.org/software/systemd/man/systemd.service.html)
- [systemd.unit OnFailure](https://www.freedesktop.org/software/systemd/man/systemd.unit.html#OnFailure=)
- [systemd user services](https://wiki.archlinux.org/title/Systemd/User)
- [Claude CLI documentation](https://docs.anthropic.com/claude-code)

## Support

For issues or questions:
1. Check troubleshooting section above
2. Review recovery logs for specific error messages
3. Open an issue on GitHub: https://github.com/rookdaemon/substrate/issues
4. Include relevant logs and configuration when reporting issues
