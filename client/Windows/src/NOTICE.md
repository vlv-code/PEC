# Open-Source Attribution & Third-Party Notice: PECAppCore

`PECAppCore` (and the core routing/interception engine in `client/Windows/src`) derives from the open-source **ProxyBridge** project.

- **Original Project:** [ProxyBridge](https://github.com/InterceptSuite/ProxyBridge)
- **Original Author:** Copyright (c) 2024 InterceptSuite (Sourav Kalal)
- **License:** MIT License
- **Import Baseline:** Imported 2026-10-19 (commit `2bcbdf4`), substantially modified, hardened, and rebranded as part of PEC-App.

## Modifications in PEC
- Integration into PEC enterprise fleet architecture (`PECAppCore.dll`, `PEC-App.exe`, `PECAppSvc.exe`).
- Dynamic credential synchronization and profile management over authenticated HTTP endpoints (`POST /api/app/sync`).
- Hardened installer and updater execution with WinVerifyTrust Authenticode checks and secure ACLs.
- Multi-profile enterprise fleet telemetry and dynamic routing presets.
- Clean compilation and automated packaging via the PEC Server native App Studio.

## MIT License

```text
MIT License

Copyright (c) 2024 InterceptSuite (Sourav Kalal)

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```
