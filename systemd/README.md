# Systemd Service Files

This directory contains systemd unit files and recovery scripts for deploying Substrate as a managed service with automatic crash recovery.

## Files

### substrate.service
Main systemd service unit that runs the Substrate supervisor process.

**Key Features:**
- Runs as user-level service (template unit with `@` suffix)
- Restarts on simple failures (`Restart=on-failure`)
- Triggers recovery service on persistent failures (`OnFailure=`)
- Includes security hardening directives
- Uses `%i` specifier to work with any username

### substrate-recovery.service
Recovery service that activates when the main service fails.

**Key Features:**
- Type `oneshot` (runs once per trigger)
- 60-second delay before starting (`ExecStartPre=/bin/sleep 60`)
- 5-minute timeout (`TimeoutStartSec=300`)
- Executes recovery script to diagnose and fix issues

### substrate-recovery.sh
Bash script that performs automated crash recovery.

**Key Features:**
- Max 3 recovery attempts with counter tracking
- Uses Claude AI to diagnose and fix issues
- Checks logs, build status, system resources
- Sends email notification on exhaustion
- Automatically resets counter on success

## Installation

See [docs/systemd-deployment.md](../docs/systemd-deployment.md) for complete installation and usage instructions.

Quick start:

```bash
# Copy service files to user systemd directory
mkdir -p ~/.config/systemd/user
cp substrate.service ~/.config/systemd/user/substrate@.service
cp substrate-recovery.service ~/.config/systemd/user/substrate-recovery@.service
systemctl --user daemon-reload

# Start service (replace 'yourusername' with your actual username)
systemctl --user start substrate@$(whoami).service
systemctl --user enable substrate@$(whoami).service
```

## Usage

The `@` suffix makes these template units that work with any username:

```bash
# Start/stop/restart
systemctl --user start substrate@$(whoami).service
systemctl --user stop substrate@$(whoami).service
systemctl --user restart substrate@$(whoami).service

# View status
systemctl --user status substrate@$(whoami).service

# View logs
journalctl --user -u substrate@$(whoami).service -f

# View recovery logs
journalctl --user -u substrate-recovery@$(whoami).service -f
```

## Environment Variables

Set these in a systemd override file or in the service file:

- `SUBSTRATE_ADMIN_EMAIL` — Email address for failure notifications (default: `stefan@example.com`)
- `NODE_ENV` — Node environment (default: `production`)
- `PATH` — Must include Node.js binary directory

Example override:
```bash
mkdir -p ~/.config/systemd/user/substrate@.service.d
cat > ~/.config/systemd/user/substrate@.service.d/override.conf <<'EOF'
[Service]
Environment="SUBSTRATE_ADMIN_EMAIL=your-email@example.com"
Environment="PATH=/usr/bin:/usr/local/bin:/home/yourusername/.nvm/versions/node/v20.11.1/bin"
EOF
systemctl --user daemon-reload
```

## Troubleshooting

### Check if recovery is working
```bash
# View recovery attempts
cat /tmp/substrate-recovery-attempts

# View recovery logs
journalctl --user -u substrate-recovery@$(whoami).service
```

### Reset recovery counter
```bash
rm -f /tmp/substrate-recovery-attempts
```

### Test recovery manually
```bash
bash -x ./substrate-recovery.sh
```

## Security Notes

- Service runs with user-level permissions (no root required)
- Recovery script uses `--dangerously-skip-permissions` for Claude CLI
- Security hardening includes: `NoNewPrivileges`, `ProtectSystem=strict`, `ProtectHome=read-only`
- Only substrate data directories are writable

## References

- [systemd.service](https://www.freedesktop.org/software/systemd/man/systemd.service.html)
- [systemd.unit OnFailure](https://www.freedesktop.org/software/systemd/man/systemd.unit.html#OnFailure=)
- [systemd user services](https://wiki.archlinux.org/title/Systemd/User)
