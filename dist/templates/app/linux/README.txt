PEC-App Linux App Templates
====================================
This directory holds pre-compiled base binaries for the Linux client:
- pec-cli (NFQUEUE transparent proxy binary)
- deploy.sh (Linux service installer)

During dynamic packaging by src/appPackager.ts, these binaries are bundled
alongside the generated pec_profile.pbprofile into a tar.gz bundle.
