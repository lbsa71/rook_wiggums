#!/bin/bash
#
# Substrate Recovery Script
# Automatically diagnoses and repairs substrate process crashes
#
# This script is invoked by substrate-recovery.service when the main
# substrate.service fails. It uses Claude AI to diagnose the issue,
# attempt a fix, and restart the service.
#
# Features:
# - Max 3 retry attempts with counter tracking
# - Email notification on retry exhaustion
# - Automatic counter reset on successful substrate start
# - 5-minute timeout (enforced by systemd TimeoutStartSec)
#

set -euo pipefail

# Configuration
SUBSTRATE_DIR="${HOME}/substrate"
ATTEMPT_FILE="/tmp/substrate-recovery-attempts"
MAX_ATTEMPTS=3
RECOVERY_MARKER="/tmp/substrate-recovery-in-progress"
USER_EMAIL="${SUBSTRATE_ADMIN_EMAIL:-stefan@example.com}"

# Logging helper
log() {
    echo "[$(date -Iseconds)] [substrate-recovery] $*" >&2
    logger -t substrate-recovery "$*"
}

# Check if we should proceed with recovery
check_attempt_limit() {
    local attempts=0
    
    if [[ -f "${ATTEMPT_FILE}" ]]; then
        attempts=$(cat "${ATTEMPT_FILE}")
    fi
    
    if [[ ${attempts} -ge ${MAX_ATTEMPTS} ]]; then
        log "ERROR: Maximum recovery attempts (${MAX_ATTEMPTS}) exhausted"
        send_failure_notification "${attempts}"
        # Remove attempt file to allow manual restart after admin intervention
        rm -f "${ATTEMPT_FILE}"
        exit 1
    fi
    
    # Increment and save attempt counter
    attempts=$((attempts + 1))
    echo "${attempts}" > "${ATTEMPT_FILE}"
    log "Recovery attempt ${attempts} of ${MAX_ATTEMPTS}"
    
    return 0
}

# Send email notification on failure
send_failure_notification() {
    local attempts=$1
    
    log "Sending failure notification email to ${USER_EMAIL}"
    
    # Build email subject and body
    local subject="[SUBSTRATE] Recovery failed after ${attempts} attempts"
    local body="Substrate process has crashed ${attempts} times and automatic recovery has failed.

Recent journal entries:
$(journalctl -u substrate.service -n 50 --no-pager 2>&1)

Build status:
$(cd "${SUBSTRATE_DIR}/server" && npx tsc --noEmit 2>&1 || echo "Build check failed")

Disk space:
$(df -h "${HOME}" 2>&1)

Please SSH in and investigate manually.

Recovery attempt log:
$(journalctl -u substrate-recovery.service -n 100 --no-pager 2>&1)
"
    
    # Try to send email using gog if available
    if command -v gog >/dev/null 2>&1; then
        echo "${body}" | gog gmail send --to "${USER_EMAIL}" --subject "${subject}" 2>&1 || \
            log "WARNING: Failed to send email via gog"
    else
        log "WARNING: gog command not found, cannot send email notification"
        log "Email would have been sent to: ${USER_EMAIL}"
        log "Subject: ${subject}"
    fi
}

# Run Claude AI recovery diagnosis
run_claude_recovery() {
    log "Running Claude AI recovery diagnosis"
    
    # Mark recovery in progress
    touch "${RECOVERY_MARKER}"
    
    # Build recovery prompt
    local prompt="You are the substrate recovery assistant. The substrate process has crashed and you need to diagnose and fix the issue.

Context:
- Substrate is a self-referential AI agent orchestration shell
- Main process: node dist/supervisor.js in ${SUBSTRATE_DIR}/server
- The process is managed by systemd (substrate.service)

Tasks:
1. Check systemd journal for recent errors:
   journalctl -u substrate.service -n 100 --no-pager

2. Check build status:
   cd ${SUBSTRATE_DIR}/server && npx tsc --noEmit

3. Check system resources:
   - Disk space: df -h ${HOME}
   - Memory: free -h
   - Node version: node --version (should be 20+)

4. Check for common issues:
   - Corrupt substrate files in ~/.local/share/substrate/substrate
   - Missing dependencies in node_modules
   - TypeScript compilation errors
   - Port conflicts (default port 3000)
   - Permission issues with substrate files

5. Attempt to fix identified issues:
   - If build fails: cd ${SUBSTRATE_DIR}/server && npm install && npm run build
   - If substrate files corrupt: cd ${SUBSTRATE_DIR}/server && npm run backup && npm run restore
   - If dependencies missing: cd ${SUBSTRATE_DIR} && npm install
   - Document any unfixable issues for manual intervention

6. After fixing, verify the fix:
   - Try starting the service manually: systemctl --user start substrate.service
   - Check if it stays running: sleep 10 && systemctl --user status substrate.service

7. Output a summary of:
   - What was wrong
   - What you fixed
   - Whether manual intervention is still needed

Work in ${SUBSTRATE_DIR} directory."

    # Run Claude with the recovery prompt
    if command -v claude >/dev/null 2>&1; then
        log "Invoking Claude CLI for recovery..."
        
        # Run Claude with a working directory and capture output
        cd "${SUBSTRATE_DIR}"
        
        if claude -p "${prompt}" --dangerously-skip-permissions 2>&1 | tee /tmp/substrate-recovery-output.log; then
            log "Claude recovery completed successfully"
            rm -f "${RECOVERY_MARKER}"
            return 0
        else
            log "ERROR: Claude recovery failed or encountered errors"
            rm -f "${RECOVERY_MARKER}"
            return 1
        fi
    else
        log "ERROR: Claude CLI not found or not in PATH"
        log "Please ensure Claude CLI is installed and authenticated"
        rm -f "${RECOVERY_MARKER}"
        return 1
    fi
}

# Restart the substrate service
restart_substrate() {
    log "Attempting to restart substrate.service"
    
    # Use systemctl to restart the main service
    if systemctl --user restart substrate.service 2>&1; then
        log "Successfully restarted substrate.service"
        
        # Wait a moment and verify it's running
        sleep 5
        
        if systemctl --user is-active --quiet substrate.service; then
            log "Substrate service is now active - recovery successful!"
            # Reset attempt counter on successful recovery
            rm -f "${ATTEMPT_FILE}"
            return 0
        else
            log "WARNING: Service restarted but is not active"
            return 1
        fi
    else
        log "ERROR: Failed to restart substrate.service"
        return 1
    fi
}

# Main recovery workflow
main() {
    log "=== Substrate Recovery Service Started ==="
    
    # Check if we've exceeded attempt limit
    check_attempt_limit
    
    # Run Claude AI recovery
    if run_claude_recovery; then
        log "Recovery diagnosis completed"
    else
        log "Recovery diagnosis failed, but attempting restart anyway"
    fi
    
    # Attempt to restart the service
    if restart_substrate; then
        log "=== Recovery completed successfully ==="
        exit 0
    else
        log "=== Recovery failed - service did not restart properly ==="
        exit 1
    fi
}

# Run main workflow
main "$@"
