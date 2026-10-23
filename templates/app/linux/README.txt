PEC-App Linux Deployment Package
====================================
This archive contains the enterprise configuration profile and automated
deployment script for the PEC Linux client.

Contents:
- pec_profile.pbprofile: Active routing profile and fleet connection settings.
- setup.sh: Installs the profile to /etc/proxybridge/ with secure permissions (0700/0600).

Note on Native Binaries:
The native eBPF/NFQUEUE transparent proxy engine is compiled directly on the target
Linux machine from the repository source code (client/Linux/) using the standard
setup script:
    sudo bash setup.sh
or distributed via pre-built .deb / .rpm enterprise package repositories.
