ARG AW_HOST_BASE_IMAGE
FROM ${AW_HOST_BASE_IMAGE}
# The base is a qualified, digest-pinned Node 24 + Docker CLI + xfsprogs + iptables image.
WORKDIR /opt/august-works
COPY deploy/v6/host-agent/index.mjs deploy/v6/host-agent/engine.mjs deploy/v6/host-agent/backup.mjs deploy/v6/host-agent/journal.mjs deploy/v6/host-agent/relay.mjs deploy/v6/host-agent/
COPY packages/shared/src/runtime-signing.ts packages/shared/src/runtime-signing.ts
ENV AW_HOST_CONFIG_FILE=/etc/aw-runtime/host.json
ENTRYPOINT ["node", "deploy/v6/host-agent/index.mjs"]
