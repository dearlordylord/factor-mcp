# Security

Do not post passwords, cookies, authorization headers, private captures, order/payment data, or personal preferences in public issues. Report vulnerabilities privately through GitHub’s Security tab for this repository.

The MCP uses a private local session file. Capture is token-protected on loopback only; the temporary extension has Factor Canada and loopback host access. It never captures password requests or uploads credentials to a maintainer server. Session renewal still requires the user’s browser. Treat the session file like a password.

Writes replace main-meal selections and can affect charges. Check recipe surcharges, quota, editing deadlines, and the user’s intent. Uncertain writes must be reconciled by reading the week before retrying. Never claim allergy safety from incomplete recipe data.

Public source and release packages exclude personal preference files, weekly plans, environment files, API captures, sessions, and generated extension credentials. Gitleaks checks tracked files/history and staged changes, with a detection canary in CI. Package allowlists and clean-install smoke checks run before releasing. Tests use synthetic account data; live account tests are not run in CI.
