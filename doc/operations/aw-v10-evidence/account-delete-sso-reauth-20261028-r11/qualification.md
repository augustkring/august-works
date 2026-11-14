# Passwordless OIDC account-deletion proof — scoped qualification

The signed OIDC integration fixture passed 1/1 on its recorded copied-source snapshot. It uses RSA-signed ID tokens, a local JWKS endpoint, and the actual patched Better Auth / SSO 1.7.7 pipeline. The provider is controlled test infrastructure, not a live enterprise IdP qualification.

The case checks fresh signed auth_time, nonce and state, exact principal/session binding, policy revision changes, one-use consumption, and expiry after a blocked final membership lock. Failed authorization leaves no deletion operation. The fixture resets its own rate-limit rows between independent negative scenarios; production rate limits remain active.

The related UI cohort r12 passed 21/21. The final server/UI compiler and broad workspace acceptance are tracked separately. SAML freshness and passwordless accounts with additional native factor policy are not qualified by this receipt.
