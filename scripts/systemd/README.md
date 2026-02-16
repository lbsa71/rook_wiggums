# Systemd Deployment Guide

This directory contains systemd service units and recovery scripts for deploying Substrate as a system service with automated crash recovery.

## Files

- **`substrate.service`** - Main systemd unit for the Substrate server
- **`substrate-recovery.service`** - Automated recovery service triggered on failure
- **`../recovery.sh`** - Recovery orchestration script with graduated response

## Installation

### Prerequisites

1. Substrate repository cloned to `/home/rook/substrate`
2. Node.js installed (preferably via nvm)
3. Claude CLI installed and authenticated
4. Mail utility installed (`sudo apt-get install mailutils` on Debian/Ubuntu)

### Setup Steps

1. **Update paths in service files** (if not using default `/home/rook/substrate`):
   ```bash
   # Edit substrate.service and substrate-recovery.service
   # Update WorkingDirectory, ExecStart paths, and USER/GROUP if needed
   ```

2. **Copy service files to systemd directory**:
   ```bash
   sudo cp scripts/systemd/substrate.service /etc/systemd/system/
   sudo cp scripts/systemd/substrate-recovery.service /etc/systemd/system/
   ```

3. **Ensure recovery script is executable**:
   ```bash
   chmod +x scripts/recovery.sh
   ```

4. **Reload systemd daemon**:
   ```bash
   sudo systemctl daemon-reload
   ```

5. **Enable and start the service**:
   ```bash
   sudo systemctl enable substrate.service
   sudo systemctl start substrate.service
   ```

6. **Verify the service is running**:
   ```bash
   sudo systemctl status substrate.service
   ```

## Recovery Mechanism

### How It Works

When `substrate.service` fails, systemd automatically triggers `substrate-recovery.service` via the `OnFailure=` directive.

The recovery process follows a graduated response strategy:

1. **First Attempt** (60s delay):
   - Wait 60 seconds
   - Invoke Claude CLI to diagnose the issue
   - Claude checks logs, build state, disk space, memory, and processes
   - If Claude reports success, restart substrate.service
   - Send email notification

2. **Second Attempt** (120s delay):
   - Wait 120 seconds (escalating backoff)
   - Repeat diagnostic process
   - Send email notification

3. **Third Attempt** (180s delay):
   - Wait 180 seconds
   - Final diagnostic attempt
   - Send email notification

4. **After 3 Failures**:
   - Stop attempting automatic recovery
   - Send "manual intervention required" email with recent logs attached
   - Administrator must SSH in to resolve

### Attempt Counter Reset

The attempt counter is automatically reset when:
- Substrate service starts successfully (via `ExecStartPost=`)
- Recovery completes successfully and restarts the service

The counter is stored at `/tmp/substrate-recovery-attempts`.

### Email Notifications

All recovery attempts and outcomes send email notifications to `lbsa71@hotmail.com`. Emails include:
- Attempt number and status
- Hostname and timestamp
- Claude diagnostic output
- Recent service logs

### Manual Reset

To manually reset the recovery attempt counter:
```bash
sudo /home/rook/substrate/scripts/recovery.sh --reset
```

## Monitoring

### View Service Logs
```bash
# Substrate service logs
sudo journalctl -u substrate -f

# Recovery service logs
sudo journalctl -u substrate-recovery -f

# Combined view
sudo journalctl -u substrate -u substrate-recovery -f
```

### Check Recovery Status
```bash
# View attempt counter
cat /tmp/substrate-recovery-attempts

# View service status
sudo systemctl status substrate.service
sudo systemctl status substrate-recovery.service
```

## Troubleshooting

### Recovery Service Not Triggering

Check that `OnFailure=` is configured in substrate.service:
```bash
systemctl show substrate.service | grep OnFailure
```

### Claude CLI Issues

Verify Claude is installed and authenticated:
```bash
sudo -u rook claude --version
```

### Email Not Sending

Install and configure mail utilities:
```bash
sudo apt-get install mailutils
# Configure postfix or use an external SMTP relay
```

Test email:
```bash
echo "Test" | mail -s "Test" lbsa71@hotmail.com
```

### Path Issues

Ensure the `PATH` environment variable in `substrate.service` includes your Node.js installation:
```bash
# Find node path
which node

# Update Environment="PATH=..." in substrate.service
```

## Configuration

### Adjusting Recovery Attempts

Edit `scripts/recovery.sh`:
```bash
MAX_ATTEMPTS=3  # Change to desired maximum
```

### Adjusting Timeouts

Edit `scripts/recovery.sh`:
```bash
CLAUDE_TIMEOUT=300  # 5 minutes (in seconds)
```

Edit `scripts/systemd/substrate-recovery.service`:
```
TimeoutStartSec=600  # Should be > CLAUDE_TIMEOUT + max backoff
```

### Changing Email Recipient

Edit `scripts/recovery.sh`:
```bash
RECIPIENT_EMAIL="your-email@example.com"
```

## Uninstallation

```bash
sudo systemctl stop substrate.service
sudo systemctl disable substrate.service
sudo rm /etc/systemd/system/substrate.service
sudo rm /etc/systemd/system/substrate-recovery.service
sudo systemctl daemon-reload
rm -f /tmp/substrate-recovery-attempts
```

## Security Considerations

- The recovery script runs with the same user as the substrate service (`rook`)
- Claude CLI runs with `--dangerously-skip-permissions` flag to allow system diagnostics
- Email notifications may contain sensitive log information
- Consider encrypting emails or using a secure mail relay
- The attempt counter file (`/tmp/substrate-recovery-attempts`) is world-readable but only writable by the service user

## Maintenance

The recovery system is designed to be low-maintenance:
- Logs are automatically managed by journald (rotate based on system configuration)
- No manual cleanup required for attempt counter (resets automatically)
- Email notifications provide visibility into recovery attempts

For persistent issues, review the pattern of failures in emails and logs to identify root causes.
