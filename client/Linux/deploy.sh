#!/bin/bash

set -e

GITHUB_REPO="PEC/PEC-App"
GITHUB_API="https://api.github.com/repos/$GITHUB_REPO/releases/latest"
TEMP_DIR=$(mktemp -d /tmp/pec-app-install.XXXXXX)
trap 'rm -rf "$TEMP_DIR"' EXIT

echo ""
echo "==================================="
echo "PEC-App Auto-Deploy Script"
echo "==================================="
echo ""

# Check if running as root
if [ "$EUID" -ne 0 ]; then
    echo "ERROR: This script must be run as root"
    echo "Please run: sudo bash deploy.sh"
    exit 1
fi

# Check for required tools
check_requirements() {
    echo "Checking required tools..."

    local missing_tools=()

    if ! command -v curl &> /dev/null; then
        missing_tools+=("curl")
    fi

    if ! command -v tar &> /dev/null; then
        missing_tools+=("tar")
    fi

    if ! command -v jq &> /dev/null; then
        echo "WARNING: jq not found. Attempting to parse JSON manually."
    fi

    if [ ${#missing_tools[@]} -gt 0 ]; then
        echo "ERROR: Missing required tools: ${missing_tools[*]}"
        echo ""
        echo "Please install them first:"
        echo "  Debian/Ubuntu: sudo apt install curl tar jq"
        echo "  Fedora:        sudo dnf install curl tar jq"
        echo "  Arch:          sudo pacman -S curl tar jq"
        exit 1
    fi

    echo "All required tools available"
}

# Download latest release
download_latest_release() {
    echo ""
    echo "Fetching latest release information..."

    # Create temp directory
    mkdir -p "$TEMP_DIR"
    cd "$TEMP_DIR"

    # Get release info from GitHub API
    local api_response
    api_response=$(curl -sL "$GITHUB_API")

    if [ -z "$api_response" ]; then
        echo "ERROR: Failed to fetch release information from GitHub"
        exit 1
    fi

    # Extract download URL for Linux tar.gz
    local download_url
    if command -v jq &> /dev/null; then
        download_url=$(echo "$api_response" | jq -r '.assets[] | select(.name | test("ProxyBridge-Linux-.*\\.tar\\.gz$")) | .browser_download_url' | head -1)
    else
        # Fallback: manual parsing
        download_url=$(echo "$api_response" | grep -o '"browser_download_url": *"[^"]*ProxyBridge-Linux-[^"]*\.tar\.gz"' | head -1 | sed 's/.*"browser_download_url": *"\([^"]*\)".*/\1/')
    fi

    if [ -z "$download_url" ]; then
        echo "ERROR: Could not find Linux release archive in latest release"
        echo ""
        echo "Please check if a Linux release is available at:"
        echo "  https://github.com/$GITHUB_REPO/releases/latest"
        exit 1
    fi

    # Extract version from URL
    local filename
    filename=$(basename "$download_url")
    echo "Found release: $filename"
    echo "Download URL: $download_url"

    echo ""
    echo "Downloading $filename..."
    if ! curl -L -o "$filename" "$download_url"; then
        echo "ERROR: Failed to download release archive"
        exit 1
    fi

    echo "Download complete"

    # Verify SHA-256 checksum if available
    local checksums_url=""
    if command -v jq &> /dev/null; then
        checksums_url=$(echo "$api_response" | jq -r --arg fn "$filename" '.assets[] | select(.name == ($fn + ".sha256") or .name == "checksums.txt" or .name == "SHA256SUMS" or (.name | test("(?i)sha256.*\\.txt$"))) | .browser_download_url' | head -1)
    else
        checksums_url=$(echo "$api_response" | grep -o '"browser_download_url": *"[^"]*\(checksums\.txt\|SHA256SUMS\|sha256\)[^"]*"' | head -1 | sed 's/.*"browser_download_url": *"\([^"]*\)".*/\1/')
    fi

    if [ -n "$checksums_url" ]; then
        echo "Downloading checksum file: $(basename "$checksums_url")..."
        local checksum_file
        checksum_file=$(basename "$checksums_url")
        if curl -sL -o "$checksum_file" "$checksums_url"; then
            echo "Verifying SHA-256 checksum..."
            local expected_hash=""
            if grep -F "$filename" "$checksum_file" &> /dev/null; then
                local match_line
                match_line=$(grep -F "$filename" "$checksum_file" | head -1)
                if echo "$match_line" | grep -q "="; then
                    expected_hash=$(echo "$match_line" | awk -F'=' '{print $NF}' | tr -d ' \r\n\t')
                else
                    expected_hash=$(echo "$match_line" | awk '{print $1}' | tr -d ' \r\n\t')
                fi
            elif [ "$(wc -w < "$checksum_file" 2>/dev/null | tr -d ' ')" -eq 1 ]; then
                expected_hash=$(tr -d ' \r\n\t' < "$checksum_file")
            fi

            if [ -n "$expected_hash" ]; then
                expected_hash=$(echo "$expected_hash" | tr '[:upper:]' '[:lower:]')
                local actual_hash=""
                if command -v sha256sum &> /dev/null; then
                    actual_hash=$(sha256sum "$filename" | awk '{print $1}')
                elif command -v shasum &> /dev/null; then
                    actual_hash=$(shasum -a 256 "$filename" | awk '{print $1}')
                fi

                if [ -n "$actual_hash" ]; then
                    actual_hash=$(echo "$actual_hash" | tr '[:upper:]' '[:lower:]')
                    if [ "$actual_hash" = "$expected_hash" ]; then
                        echo "SHA-256 verified successfully: $actual_hash"
                    else
                        echo "ERROR: SHA-256 checksum mismatch for $filename"
                        echo "  Expected: $expected_hash"
                        echo "  Actual:   $actual_hash"
                        exit 1
                    fi
                else
                    echo "WARNING: Neither sha256sum nor shasum found, skipping checksum verification"
                fi
            else
                echo "WARNING: Could not parse checksum from $checksum_file, skipping verification"
            fi
        fi
    fi

    # Extract archive safely
    echo ""
    echo "Extracting archive..."
    if ! tar -xzf "$filename" --no-same-owner --no-same-permissions; then
        echo "ERROR: Failed to extract archive"
        exit 1
    fi

    echo "Extraction complete"
    echo "Files extracted to: $TEMP_DIR"
    ls -lh
}

# Detect Linux distribution
detect_distro() {
    if [ -f /etc/os-release ]; then
        . /etc/os-release
        DISTRO=$ID
        DISTRO_LIKE=$ID_LIKE
    elif [ -f /etc/lsb-release ]; then
        . /etc/lsb-release
        DISTRO=$DISTRIB_ID
    else
        DISTRO=$(uname -s)
    fi
    echo ""
    echo "Detected distribution: $DISTRO"
}

# Install dependencies based on distribution
install_dependencies() {
    echo ""
    echo "Checking and installing dependencies..."

    # Normalize distro name using ID_LIKE fallback
    local distro_family="$DISTRO"
    if [ -n "$DISTRO_LIKE" ]; then
        case "$DISTRO_LIKE" in
            *ubuntu*|*debian*) distro_family="debian" ;;
            *fedora*) distro_family="fedora" ;;
            *rhel*|*centos*) distro_family="rhel" ;;
            *arch*) distro_family="arch" ;;
            *suse*) distro_family="opensuse" ;;
        esac
    fi

    case "$distro_family" in
        ubuntu|debian|linuxmint|pop|elementary|zorin|kali|raspbian|mx|antix|deepin|lmde)
            echo "Using apt package manager..."
            apt-get update -qq
            apt-get install -y libelf1 zlib1g libgtk-3-0
            ;;
        fedora)
            echo "Using dnf package manager..."
            dnf install -y elfutils-libelf zlib gtk3
            ;;
        rhel|centos|rocky|almalinux)
            echo "Using yum package manager..."
            yum install -y elfutils-libelf zlib gtk3
            ;;
        arch|manjaro|endeavouros|garuda)
            echo "Using pacman package manager..."
            pacman -Sy --noconfirm libelf zlib gtk3
            ;;
        opensuse*|sles)
            echo "Using zypper package manager..."
            zypper install -y libelf1 libz1 gtk3
            ;;
        void)
            echo "Using xbps package manager..."
            xbps-install -Sy libelf zlib gtk3
            ;;
        *)
            echo "WARNING: Unknown distribution '$DISTRO' (family: '$DISTRO_LIKE')"
            echo ""
            echo "Please manually install the following packages:"
            echo "  Debian/Ubuntu: sudo apt install libelf1 zlib1g libgtk-3-0"
            echo "  Fedora:        sudo dnf install elfutils-libelf zlib gtk3"
            echo "  Arch:          sudo pacman -S libelf zlib gtk3"
            echo ""
            read -p "Continue anyway? (y/n) " -n 1 -r
            echo
            if [[ ! $REPLY =~ ^[Yy]$ ]]; then
                exit 1
            fi
            ;;
    esac

    echo "Dependencies installed"
}

# Use /usr/local/lib (matches RPATH in binary)
detect_lib_path() {
    LIB_PATH="/usr/local/lib"
    echo "Library installation path: $LIB_PATH"
}

# Check if files exist in extracted directory
check_files() {
    echo ""
    echo "Checking for required files..."

    if [ ! -f "$TEMP_DIR/libproxybridge.so" ]; then
        echo "ERROR: libproxybridge.so not found in extracted archive"
        exit 1
    fi

    if [ ! -f "$TEMP_DIR/ProxyBridge" ]; then
        echo "ERROR: ProxyBridge binary not found in extracted archive"
        exit 1
    fi

    if [ ! -f "$TEMP_DIR/ProxyBridgeGUI" ]; then
        echo "WARNING: ProxyBridgeGUI binary not found - GUI will not be installed"
    fi

    echo "All required files present"
}

# Install files
install_files() {
    echo ""
    echo "Installing ProxyBridge..."

    # Create directories if they don't exist
    mkdir -p "$LIB_PATH" /usr/local/bin
    [ -d /etc/proxybridge ] || mkdir -m 0700 /etc/proxybridge
    chmod 0700 /etc/proxybridge

    # Copy library
    echo "Installing libproxybridge.so to $LIB_PATH..."
    cp "$TEMP_DIR/libproxybridge.so" "$LIB_PATH/"
    chmod 755 "$LIB_PATH/libproxybridge.so"

    # Copy binary
    echo "Installing ProxyBridge to /usr/local/bin..."
    cp "$TEMP_DIR/ProxyBridge" /usr/local/bin/
    chmod 755 /usr/local/bin/ProxyBridge

    if [ -f "$TEMP_DIR/ProxyBridgeGUI" ]; then
        echo "Installing ProxyBridgeGUI to /usr/local/bin..."
        cp "$TEMP_DIR/ProxyBridgeGUI" /usr/local/bin/
        chmod 755 /usr/local/bin/ProxyBridgeGUI
    fi

    echo "Files installed"
}

# Update library cache
update_ldconfig() {
    echo ""
    echo "Updating library cache..."

    # Add /usr/local/lib to ld.so.conf if not already there
    if [ -d /etc/ld.so.conf.d ]; then
        if ! grep -q "^/usr/local/lib" /etc/ld.so.conf.d/* 2>/dev/null; then
            echo "/usr/local/lib" > /etc/ld.so.conf.d/proxybridge.conf
            if [ "$LIB_PATH" = "/usr/local/lib64" ]; then
                echo "/usr/local/lib64" >> /etc/ld.so.conf.d/proxybridge.conf
            fi
        fi
    fi

    # Run ldconfig
    if command -v ldconfig &> /dev/null; then
        ldconfig 2>/dev/null || true
        ldconfig -v 2>/dev/null | grep -q proxybridge || true
        echo "Library cache updated"
    else
        echo "WARNING: ldconfig not found. You may need to reboot."
    fi
}

# Verify installation
verify_installation() {
    echo ""
    echo "Verifying installation..."

    # Check if binary is in PATH
    if command -v ProxyBridge &> /dev/null; then
        echo "ProxyBridge binary found in PATH"
    else
        echo "ProxyBridge binary not found in PATH"
        echo "  You may need to add /usr/local/bin to your PATH"
    fi

    # Check if library is loadable
    if ldd /usr/local/bin/ProxyBridge 2>/dev/null | grep -q "libproxybridge.so"; then
        if ldd /usr/local/bin/ProxyBridge 2>/dev/null | grep "libproxybridge.so" | grep -q "not found"; then
            echo "libproxybridge.so not loadable"
        else
            echo "libproxybridge.so is loadable"
        fi
    fi

    # Final test - try to run --help
    if /usr/local/bin/ProxyBridge --help &>/dev/null; then
        echo "ProxyBridge executable is working"
    else
        echo "⚠ ProxyBridge may have issues - try: sudo ldconfig"
    fi
}

# Cleanup temp directory
cleanup() {
    echo ""
    echo "Cleaning up temporary files..."
    rm -rf "$TEMP_DIR"
    echo "Cleanup complete"
}

# Main deployment
main() {
    check_requirements
    download_latest_release
    detect_distro
    check_files
    install_dependencies
    detect_lib_path
    install_files
    update_ldconfig
    verify_installation
    cleanup

    echo ""
    echo "==================================="
    echo "Installation Complete!"
    echo "==================================="
    echo ""
    echo "You can now run ProxyBridge from anywhere:"
    echo "  sudo ProxyBridge --help"
    if [ -f /usr/local/bin/ProxyBridgeGUI ]; then
       echo "  sudo ProxyBridgeGUI      (Graphical Interface)"
    fi
    echo "  sudo ProxyBridge --proxy socks5://IP:PORT --rule \"app:*:*:TCP:PROXY\""
    echo ""
    echo "No cleanup is needed after a crash: the kernel detaches the eBPF programs automatically."
    echo ""
}

# Trap errors
trap 'echo ""; echo "ERROR: Installation failed."; exit 1' ERR

main
