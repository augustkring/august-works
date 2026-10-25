# Managed Slack agent-tool connection

The Apps catalog offers the Blentera-managed Slack OAuth app when the instance
operator configures both `PAPERCLIP_TOOL_OAUTH_SLACK_CLIENT_ID` and
`PAPERCLIP_TOOL_OAUTH_SLACK_CLIENT_SECRET`. The credentials stay in the
deployment environment. If either is missing, the managed method is not
advertised; the separate customer-owned OAuth method remains available under
the advanced setup option.

Register the Blentera-owned Slack app with the instance's OAuth callback URI:

```text
https://<public-instance-origin>/api/tools/oauth/callback
```

The managed agent-tool method requests the reviewed Slack scopes
`channels:read`, `chat:write`, and `search:read`. Slack workspace consent and
the connection's current access profile remain independent controls. Connecting
the workspace does not grant every discovered tool to every agent. To remove
access, revoke or archive the connection in Apps; the normal connection
credential and grant lifecycle applies.

This OAuth client is separate from the Slack chat bot app, which receives
Events API requests and uses its own bot token and signing secret. It is also
separate from optional personal Slack search authorization.
