# Managed OpenCode browser Project journey, r5

The authenticated browser test completed successfully: 1 passed, 0 failed. It used the pinned managed OpenCode binary through the controlled local Messages broker and full application, with the same qualified heartbeat, Human session validation, and Project source/result path. Live-events WebSocket handling was installed for the browser session; the run log contains no `/events/ws` 404.

The browser journey creates a private Project with a local workspace from a real conversation turn, checks the returned tool result, and verifies the Project card after reload. This receipt does not cover repository URL creation.

The raw focused logs and source patch are preserved losslessly as gzip files. Secret scan counts were zero for bearer credentials, JWTs, session tokens, and credential fields.

Source-pin manifest SHA-256: `d462312c985e0b0f07e85e6c2d801436990056bf7847d77d3c37d00933fe546a`.
Source reconstruction patch SHA-256: `4057edfc330b37c38b1f5c7693aaaf53e6966388ec7291a9ceb5205f0e533c42`.
Qualified OpenCode binary SHA-256: `513f500a1a5ea1dc7d865547ac87b32a8936334e8d5abd5b3ff585c45a170080`.

Archived artifacts:

- `binary.path` — SHA-256 `f9de8f8c28ee85cc6cd346d81a952ff0792e0098ac97168000211cf99995cb99` (124 bytes)
- `binary.sha256` — SHA-256 `dcac393b6edf8f0341f95b5a83f0031acdf2ae2df82e686ffd50a6f6de575d62` (65 bytes)
- `exit` — SHA-256 `9a271f2a916b0b6ee6cecb2426f0b3206ef074578be55d9bc94f6f3fe3ab86aa` (2 bytes)
- `runner.txt` — SHA-256 `d845b259a2ec7b4aaf7818a0f9879c23e0d116729850777b26317e694883cec0` (125 bytes)
- `snapshot.exit` — SHA-256 `9a271f2a916b0b6ee6cecb2426f0b3206ef074578be55d9bc94f6f3fe3ab86aa` (2 bytes)
- `snapshot.log.gz` — SHA-256 `40f78baa6eb37d639ef6dd5d13356b56b988673745304c9a61c8edaf48617669` (55 bytes)
- `source-pins.json` — SHA-256 `d462312c985e0b0f07e85e6c2d801436990056bf7847d77d3c37d00933fe546a` (168608 bytes)
- `source-pins.source-files/server/src/services/native-runtime/native-opencode-managed-browser.integration.test.ts` — SHA-256 `dbc83674ccc2908b11d753e90a8a12d95e6c9656d8e00888dd20aa3a98286cb8` (10634 bytes)
- `source-pins.source.patch.gz` — SHA-256 `cfc290b23bad69e82e2ff14159c35d6f107a9f8cda501dc24b19d12504211d62` (50566 bytes)
- `syntax.exit` — SHA-256 `9a271f2a916b0b6ee6cecb2426f0b3206ef074578be55d9bc94f6f3fe3ab86aa` (2 bytes)
- `syntax.log.gz` — SHA-256 `efdf2a665476d106236d62f24417c66fae96188fa0f5081f0b9b490df7ad986e` (76 bytes)
- `test.exit` — SHA-256 `9a271f2a916b0b6ee6cecb2426f0b3206ef074578be55d9bc94f6f3fe3ab86aa` (2 bytes)
- `test.log.gz` — SHA-256 `1e626ba5614f3b3278f6ec1ab2686b53e1792b4cd40b51f9922f9d465c1fa257` (5161 bytes)
