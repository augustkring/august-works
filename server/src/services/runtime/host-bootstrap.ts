import type { SaasPlatformConfig } from "../../saas-platform-config.js";
/** Secret is short-lived enrollment only; platform and billing credentials never reach a runtime host. */
export function runtimeHostCloudInit(
  config: SaasPlatformConfig,
  origin: string,
  hostId: string,
  token: string,
) {
  const host = {
    backupEndpoint: config.objects.endpoint,
    controlOrigin: origin,
    hostId,
    region: config.runtime.region,
    enrollmentToken: token,
    unreachableSeconds: config.runtime.unreachableSeconds,
    heartbeatSeconds: config.runtime.heartbeatSeconds,
  };
  const script = `#!/bin/bash
set -euo pipefail
# A newly allocated, separate virtio state device is mandatory. Never format a mounted/existing filesystem.
test -b /dev/vdb
if ! blkid /dev/vdb >/dev/null 2>&1; then
  test -z "$(lsblk -nro MOUNTPOINT /dev/vdb | tr -d '[:space:]')"
  mkfs.xfs /dev/vdb
fi
test "$(blkid -s TYPE -o value /dev/vdb)" = xfs
install -d -m 0700 /var/lib/aw-runtime /etc/aw-runtime
install -d -m 0711 /var/lib/aw-runtime/cells
state_uuid=$(blkid -s UUID -o value /dev/vdb)
printf 'UUID=%s /var/lib/aw-runtime/cells xfs defaults,nodev,nosuid,prjquota 0 2\\n' "$state_uuid" >> /etc/fstab
mount /var/lib/aw-runtime/cells
xfs_quota -x -c state /var/lib/aw-runtime/cells
systemctl enable --now docker
# Host image must contain the tested Node 24, Docker CLI, xfs_quota and iptables contract.
docker pull ${config.runtime.hostAgentImage}
systemctl daemon-reload
systemctl enable --now aw-runtime-host
`;
  const service = `[Unit]
Description=August Works runtime host controller
After=docker.service network-online.target
Requires=docker.service
[Service]
Restart=always
RestartSec=5
TimeoutStopSec=90
ExecStartPre=-/usr/bin/docker rm aw-runtime-host
ExecStart=/usr/bin/docker run --rm --name aw-runtime-host --network host --pid host --read-only --cap-drop ALL --cap-add SYS_ADMIN --cap-add NET_ADMIN --cap-add CHOWN --cap-add DAC_OVERRIDE --security-opt no-new-privileges:true --pids-limit 256 --memory 1g --cpus 1 --tmpfs /tmp:rw,nosuid,nodev,size=256m --mount type=bind,source=/var/run/docker.sock,target=/var/run/docker.sock --mount type=bind,source=/var/lib/aw-runtime,target=/var/lib/aw-runtime --mount type=bind,source=/etc/aw-runtime,target=/etc/aw-runtime --mount type=bind,source=/sys/fs/cgroup,target=/sys/fs/cgroup,readonly ${config.runtime.hostAgentImage}
ExecStop=/usr/bin/docker stop --time 60 aw-runtime-host
[Install]
WantedBy=multi-user.target
`;
  return (
    "#cloud-config\n" +
    JSON.stringify({
      package_update: true,
      packages: ["ca-certificates", "docker.io", "xfsprogs"],
      ssh_pwauth: false,
      disable_root: true,
      write_files: [
        {
          path: "/etc/aw-runtime/host.json",
          permissions: "0600",
          content: JSON.stringify(host),
        },
        {
          path: "/usr/local/sbin/aw-runtime-bootstrap",
          permissions: "0700",
          content: script,
        },
        {
          path: "/etc/systemd/system/aw-runtime-host.service",
          permissions: "0644",
          content: service,
        },
      ],
      runcmd: [["/usr/local/sbin/aw-runtime-bootstrap"]],
    })
  );
}
