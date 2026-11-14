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

The managed agent-tool method uses Slack's user-token OAuth endpoints:
`https://slack.com/oauth/v2_user/authorize` and
`https://slack.com/api/oauth.v2.user.access`. It requests only the reviewed
search, channel-history, channel-list and message-send scopes listed in the Slack
app manifest. Slack's [MCP documentation](https://docs.slack.dev/ai/slack-mcp-server/)
requires a registered app and says only internal or Marketplace-published apps
may use its MCP server. Deployment credentials alone do not prove that Slack
has qualified the app for customer workspaces.

Slack workspace consent and the connection's current access profile remain
independent controls. Connecting the workspace does not grant every discovered
tool to every agent. To remove access, revoke or archive the connection in Apps;
the normal connection credential and grant lifecycle applies.

This OAuth client is separate from the Slack chat bot app, which receives
Events API requests and uses its own bot token and signing secret. It is also
separate from optional personal Slack search authorization.
