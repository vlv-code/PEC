#!/bin/bash
# PEC-App Linux Configuration Deployment Script
set -e

CONF_DIR="/etc/proxybridge"
CONF_FILE="$CONF_DIR/pec_profile.pbprofile"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

echo "=== PEC-App Linux Profile Setup ==="

if [ "$EUID" -ne 0 ]; then
  echo "Error: This script must be run as root (sudo bash setup.sh)"
  exit 1
fi

mkdir -p "$CONF_DIR"
chmod 0700 "$CONF_DIR"

if [ -f "$SCRIPT_DIR/pec_profile.pbprofile" ]; then
  cp "$SCRIPT_DIR/pec_profile.pbprofile" "$CONF_FILE"
  chmod 0600 "$CONF_FILE"
  echo "Installed configuration profile to $CONF_FILE"
else
  echo "Warning: pec_profile.pbprofile not found in $SCRIPT_DIR"
fi

if systemctl list-unit-files | grep -q "proxybridge.service"; then
  echo "Restarting proxybridge service..."
  systemctl restart proxybridge.service || true
fi

echo "PEC-App Linux setup complete."
