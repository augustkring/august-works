#!/usr/bin/env bash
set -euo pipefail

log() {
  echo "[openclaw-gateway-e2e] $*"
}

warn() {
  echo "[openclaw-gateway-e2e] WARN: $*" >&2
}

fail() {
  echo "[openclaw-gateway-e2e] ERROR: $*" >&2
  exit 1
}

require_cmd() {
  local cmd="$1"
  command -v "$cmd" >/dev/null 2>&1 || fail "missing required command: $cmd"
}

require_cmd curl
require_cmd jq
require_cmd docker
require_cmd node
require_cmd shasum

PAPERCLIP_API_URL="${PAPERCLIP_API_URL:-http://127.0.0.1:3100}"
API_BASE="${PAPERCLIP_API_URL%/}/api"

COMPANY_SELECTOR="${COMPANY_SELECTOR:-CLA}"
OPENCLAW_AGENT_NAME="${OPENCLAW_AGENT_NAME:-OpenClaw Gateway Smoke Agent}"
OPENCLAW_GATEWAY_URL="${OPENCLAW_GATEWAY_URL:-ws://127.0.0.1:18789}"
OPENCLAW_GATEWAY_TOKEN="${OPENCLAW_GATEWAY_TOKEN:-}"
OPENCLAW_TMP_DIR="${OPENCLAW_TMP_DIR:-${TMPDIR:-/tmp}}"
OPENCLAW_TMP_DIR="${OPENCLAW_TMP_DIR%/}"
OPENCLAW_TMP_DIR="${OPENCLAW_TMP_DIR:-/tmp}"
OPENCLAW_CONFIG_DIR="${OPENCLAW_CONFIG_DIR:-${OPENCLAW_TMP_DIR}/openclaw-paperclip-smoke}"
OPENCLAW_WORKSPACE_DIR="${OPENCLAW_WORKSPACE_DIR:-${OPENCLAW_CONFIG_DIR}/workspace}"
OPENCLAW_CONTAINER_NAME="${OPENCLAW_CONTAINER_NAME:-openclaw-docker-openclaw-gateway-1}"
OPENCLAW_IMAGE="${OPENCLAW_IMAGE:-openclaw:local}"
OPENCLAW_DOCKER_DIR="${OPENCLAW_DOCKER_DIR:-/tmp/openclaw-docker}"
OPENCLAW_RESET_DOCKER="${OPENCLAW_RESET_DOCKER:-1}"
OPENCLAW_BUILD="${OPENCLAW_BUILD:-1}"
OPENCLAW_WAIT_SECONDS="${OPENCLAW_WAIT_SECONDS:-60}"
OPENCLAW_RESET_STATE="${OPENCLAW_RESET_STATE:-1}"

PAPERCLIP_API_URL_FOR_OPENCLAW="${PAPERCLIP_API_URL_FOR_OPENCLAW:-http://host.docker.internal:3100}"
CASE_TIMEOUT_SEC="${CASE_TIMEOUT_SEC:-420}"
RUN_TIMEOUT_SEC="${RUN_TIMEOUT_SEC:-300}"
STRICT_CASES="${STRICT_CASES:-1}"
AUTO_INSTALL_SKILL="${AUTO_INSTALL_SKILL:-1}"
OPENCLAW_DIAG_DIR="${OPENCLAW_DIAG_DIR:-/tmp/openclaw-gateway-e2e-diag-$(date +%Y%m%d-%H%M%S)}"
OPENCLAW_ADAPTER_TIMEOUT_SEC="${OPENCLAW_ADAPTER_TIMEOUT_SEC:-120}"
OPENCLAW_ADAPTER_WAIT_TIMEOUT_MS="${OPENCLAW_ADAPTER_WAIT_TIMEOUT_MS:-120000}"
PAIRING_AUTO_APPROVE="${PAIRING_AUTO_APPROVE:-1}"
PAYLOAD_TEMPLATE_MESSAGE_APPEND="${PAYLOAD_TEMPLATE_MESSAGE_APPEND:-}"

# Gate 27.5 workflow evidence. The success case is opt-in so the established
# OpenClaw smoke remains backwards-compatible. Cancellation and process-loss
# are separately destructive and therefore require explicit opt-in.
WORKFLOW_CASES="${WORKFLOW_CASES:-0}"
WORKFLOW_CANCELLATION_CASE="${WORKFLOW_CANCELLATION_CASE:-0}"
WORKFLOW_PROCESS_LOSS_CASE="${WORKFLOW_PROCESS_LOSS_CASE:-0}"
WORKFLOW_RUN_TIMEOUT_SEC="${WORKFLOW_RUN_TIMEOUT_SEC:-300}"
WORKFLOW_PROCESS_LOSS_TIMEOUT_SEC="${WORKFLOW_PROCESS_LOSS_TIMEOUT_SEC:-90}"

AUTH_HEADERS=()
if [[ -n "${PAPERCLIP_AUTH_HEADER:-}" ]]; then
  AUTH_HEADERS+=( -H "Authorization: ${PAPERCLIP_AUTH_HEADER}" )
fi
if [[ -n "${PAPERCLIP_COOKIE:-}" ]]; then
  AUTH_HEADERS+=( -H "Cookie: ${PAPERCLIP_COOKIE}" )
  PAPERCLIP_BROWSER_ORIGIN="${PAPERCLIP_BROWSER_ORIGIN:-${PAPERCLIP_API_URL%/}}"
  AUTH_HEADERS+=( -H "Origin: ${PAPERCLIP_BROWSER_ORIGIN}" -H "Referer: ${PAPERCLIP_BROWSER_ORIGIN}/" )
fi

RESPONSE_CODE=""
RESPONSE_BODY=""
COMPANY_ID=""
AGENT_ID=""
AGENT_API_KEY=""
JOIN_REQUEST_ID=""
INVITE_ID=""
RUN_ID=""

CASE_A_ISSUE_ID=""
CASE_B_ISSUE_ID=""
CASE_C_ISSUE_ID=""
CASE_C_CREATED_ISSUE_ID=""

WORKFLOW_ID=""
WORKFLOW_RUN_ID=""
WORKFLOW_EXTERNAL_ISSUE_ID=""
WORKFLOW_EXTERNAL_HEARTBEAT_RUN_ID=""

api_request() {
  local method="$1"
  local path="$2"
  local data="${3-}"
  local idempotency_key="${4-}"
  local tmp
  tmp="$(mktemp)"

  local url
  if [[ "$path" == http://* || "$path" == https://* ]]; then
    url="$path"
  elif [[ "$path" == /api/* ]]; then
    url="${PAPERCLIP_API_URL%/}${path}"
  else
    url="${API_BASE}${path}"
  fi

  local request_headers=("${AUTH_HEADERS[@]}")
  if [[ -n "$idempotency_key" ]]; then
    request_headers+=( -H "Idempotency-Key: ${idempotency_key}" )
  fi

  if [[ -n "$data" ]]; then
    RESPONSE_CODE="$(curl -sS -o "$tmp" -w "%{http_code}" -X "$method" "${request_headers[@]}" -H "Content-Type: application/json" "$url" --data "$data")"
  else
    RESPONSE_CODE="$(curl -sS -o "$tmp" -w "%{http_code}" -X "$method" "${request_headers[@]}" "$url")"
  fi

  RESPONSE_BODY="$(cat "$tmp")"
  rm -f "$tmp"
}

capture_run_diagnostics() {
  local run_id="$1"
  local label="${2:-run}"
  [[ -n "$run_id" ]] || return 0

  mkdir -p "$OPENCLAW_DIAG_DIR"

  api_request "GET" "/heartbeat-runs/${run_id}/events?limit=1000"
  if [[ "$RESPONSE_CODE" == "200" ]]; then
    printf "%s\n" "$RESPONSE_BODY" > "${OPENCLAW_DIAG_DIR}/${label}-${run_id}-events.json"
  else
    warn "could not fetch events for run ${run_id} (HTTP ${RESPONSE_CODE})"
  fi

  api_request "GET" "/heartbeat-runs/${run_id}/log?limitBytes=524288"
  if [[ "$RESPONSE_CODE" == "200" ]]; then
    printf "%s\n" "$RESPONSE_BODY" > "${OPENCLAW_DIAG_DIR}/${label}-${run_id}-log.json"
    jq -r '.content // ""' <<<"$RESPONSE_BODY" > "${OPENCLAW_DIAG_DIR}/${label}-${run_id}-log.txt" 2>/dev/null || true
  else
    warn "could not fetch log for run ${run_id} (HTTP ${RESPONSE_CODE})"
  fi
}

capture_issue_diagnostics() {
  local issue_id="$1"
  local label="${2:-issue}"
  [[ -n "$issue_id" ]] || return 0
  mkdir -p "$OPENCLAW_DIAG_DIR"

  api_request "GET" "/issues/${issue_id}"
  if [[ "$RESPONSE_CODE" == "200" ]]; then
    printf "%s\n" "$RESPONSE_BODY" > "${OPENCLAW_DIAG_DIR}/${label}-${issue_id}.json"
  fi

  api_request "GET" "/issues/${issue_id}/comments"
  if [[ "$RESPONSE_CODE" == "200" ]]; then
    printf "%s\n" "$RESPONSE_BODY" > "${OPENCLAW_DIAG_DIR}/${label}-${issue_id}-comments.json"
  fi
}

capture_openclaw_container_logs() {
  mkdir -p "$OPENCLAW_DIAG_DIR"
  local container
  container="$(detect_openclaw_container || true)"
  if [[ -z "$container" ]]; then
    warn "could not detect OpenClaw container for diagnostics"
    return 0
  fi
  docker logs --tail=1200 "$container" > "${OPENCLAW_DIAG_DIR}/openclaw-container.log" 2>&1 || true
}

assert_status() {
  local expected="$1"
  if [[ "$RESPONSE_CODE" != "$expected" ]]; then
    echo "$RESPONSE_BODY" >&2
    fail "expected HTTP ${expected}, got ${RESPONSE_CODE}"
  fi
}

require_board_auth() {
  if [[ ${#AUTH_HEADERS[@]} -eq 0 ]]; then
    fail "board auth required. Set PAPERCLIP_COOKIE or PAPERCLIP_AUTH_HEADER."
  fi
  api_request "GET" "/companies"
  if [[ "$RESPONSE_CODE" != "200" ]]; then
    echo "$RESPONSE_BODY" >&2
    fail "board auth invalid for /api/companies (HTTP ${RESPONSE_CODE})"
  fi
}

maybe_cleanup_openclaw_docker() {
  if [[ "$OPENCLAW_RESET_DOCKER" != "1" ]]; then
    log "OPENCLAW_RESET_DOCKER=${OPENCLAW_RESET_DOCKER}; skipping docker cleanup"
    return
  fi

  log "cleaning OpenClaw docker state"
  if [[ -d "$OPENCLAW_DOCKER_DIR" ]]; then
    docker compose -f "$OPENCLAW_DOCKER_DIR/docker-compose.yml" down --remove-orphans >/dev/null 2>&1 || true
  fi
  if docker ps -a --format '{{.Names}}' | grep -qx "$OPENCLAW_CONTAINER_NAME"; then
    docker rm -f "$OPENCLAW_CONTAINER_NAME" >/dev/null 2>&1 || true
  fi
  docker image rm "$OPENCLAW_IMAGE" >/dev/null 2>&1 || true
}

start_openclaw_docker() {
  log "starting clean OpenClaw docker"
  OPENCLAW_CONFIG_DIR="$OPENCLAW_CONFIG_DIR" OPENCLAW_WORKSPACE_DIR="$OPENCLAW_WORKSPACE_DIR" \
  OPENCLAW_RESET_STATE="$OPENCLAW_RESET_STATE" OPENCLAW_BUILD="$OPENCLAW_BUILD" OPENCLAW_WAIT_SECONDS="$OPENCLAW_WAIT_SECONDS" \
    ./scripts/smoke/openclaw-docker-ui.sh
}

wait_http_ready() {
  local url="$1"
  local timeout_sec="$2"
  local started_at now code
  started_at="$(date +%s)"
  while true; do
    code="$(curl -sS -o /dev/null -w "%{http_code}" "$url" || true)"
    if [[ "$code" == "200" ]]; then
      return 0
    fi
    now="$(date +%s)"
    if (( now - started_at >= timeout_sec )); then
      return 1
    fi
    sleep 1
  done
}

detect_openclaw_container() {
  if docker ps --format '{{.Names}}' | grep -qx "$OPENCLAW_CONTAINER_NAME"; then
    echo "$OPENCLAW_CONTAINER_NAME"
    return 0
  fi

  local detected
  detected="$(docker ps --format '{{.Names}}' | grep 'openclaw-gateway' | head -n1 || true)"
  if [[ -n "$detected" ]]; then
    echo "$detected"
    return 0
  fi

  return 1
}

detect_gateway_token() {
  if [[ -n "$OPENCLAW_GATEWAY_TOKEN" ]]; then
    echo "$OPENCLAW_GATEWAY_TOKEN"
    return 0
  fi

  local config_path
  config_path="${OPENCLAW_CONFIG_DIR%/}/openclaw.json"
  if [[ -f "$config_path" ]]; then
    local token
    token="$(jq -r '.gateway.auth.token // empty' "$config_path")"
    if [[ -n "$token" ]]; then
      echo "$token"
      return 0
    fi
  fi

  local container
  container="$(detect_openclaw_container || true)"
  if [[ -n "$container" ]]; then
    local token_from_container
    token_from_container="$(docker exec "$container" sh -lc "node -e 'const fs=require(\"fs\");const c=JSON.parse(fs.readFileSync(\"/home/node/.openclaw/openclaw.json\",\"utf8\"));process.stdout.write(c.gateway?.auth?.token||\"\");'" 2>/dev/null || true)"
    if [[ -n "$token_from_container" ]]; then
      echo "$token_from_container"
      return 0
    fi
  fi

  return 1
}

hash_prefix() {
  local value="$1"
  printf "%s" "$value" | shasum -a 256 | awk '{print $1}' | cut -c1-12
}

probe_gateway_ws() {
  local url="$1"
  local token="$2"

  node - "$url" "$token" <<'NODE'
const WebSocket = require("ws");
const url = process.argv[2];
const token = process.argv[3];

const ws = new WebSocket(url, { headers: { Authorization: `Bearer ${token}` } });
const timeout = setTimeout(() => {
  console.error("gateway probe timed out");
  process.exit(2);
}, 8000);

ws.on("message", (raw) => {
  try {
    const message = JSON.parse(String(raw));
    if (message?.type === "event" && message?.event === "connect.challenge") {
      clearTimeout(timeout);
      ws.close();
      process.exit(0);
    }
  } catch {
    // ignore
  }
});

ws.on("error", (err) => {
  clearTimeout(timeout);
  console.error(err?.message || String(err));
  process.exit(1);
});
NODE
}

resolve_company_id() {
  api_request "GET" "/companies"
  assert_status "200"

  local selector
  selector="$(printf "%s" "$COMPANY_SELECTOR" | tr '[:lower:]' '[:upper:]')"

  COMPANY_ID="$(jq -r --arg sel "$selector" '
    map(select(
      ((.id // "") | ascii_upcase) == $sel or
      ((.name // "") | ascii_upcase) == $sel or
      ((.issuePrefix // "") | ascii_upcase) == $sel
    ))
    | .[0].id // empty
  ' <<<"$RESPONSE_BODY")"

  if [[ -z "$COMPANY_ID" ]]; then
    local available
    available="$(jq -r '.[] | "- id=\(.id) issuePrefix=\(.issuePrefix // "") name=\(.name // "")"' <<<"$RESPONSE_BODY")"
    echo "$available" >&2
    fail "could not find company for selector '${COMPANY_SELECTOR}'"
  fi

  log "resolved company ${COMPANY_ID} from selector ${COMPANY_SELECTOR}"
}

cleanup_openclaw_agents() {
  api_request "GET" "/companies/${COMPANY_ID}/agents"
  assert_status "200"

  local ids
  ids="$(jq -r '.[] | select((.adapterType == "openclaw" or .adapterType == "openclaw_gateway")) | .id' <<<"$RESPONSE_BODY")"
  if [[ -z "$ids" ]]; then
    log "no prior OpenClaw agents to cleanup"
    return
  fi

  while IFS= read -r id; do
    [[ -n "$id" ]] || continue
    log "terminating prior OpenClaw agent ${id}"
    api_request "POST" "/agents/${id}/terminate" "{}"
    if [[ "$RESPONSE_CODE" != "200" && "$RESPONSE_CODE" != "404" ]]; then
      warn "terminate ${id} returned HTTP ${RESPONSE_CODE}"
    fi

    api_request "DELETE" "/agents/${id}"
    if [[ "$RESPONSE_CODE" != "200" && "$RESPONSE_CODE" != "404" ]]; then
      warn "delete ${id} returned HTTP ${RESPONSE_CODE}"
    fi
  done <<<"$ids"
}

cleanup_pending_join_requests() {
  api_request "GET" "/companies/${COMPANY_ID}/join-requests?status=pending_approval"
  if [[ "$RESPONSE_CODE" != "200" ]]; then
    warn "join-request cleanup skipped (HTTP ${RESPONSE_CODE})"
    return
  fi

  local ids
  ids="$(jq -r '.[] | select((.adapterType == "openclaw" or .adapterType == "openclaw_gateway")) | .id' <<<"$RESPONSE_BODY")"
  if [[ -z "$ids" ]]; then
    return
  fi

  while IFS= read -r request_id; do
    [[ -n "$request_id" ]] || continue
    log "rejecting stale pending join request ${request_id}"
    api_request "POST" "/companies/${COMPANY_ID}/join-requests/${request_id}/reject" "{}"
    if [[ "$RESPONSE_CODE" != "200" && "$RESPONSE_CODE" != "404" && "$RESPONSE_CODE" != "409" ]]; then
      warn "reject ${request_id} returned HTTP ${RESPONSE_CODE}"
    fi
  done <<<"$ids"
}

create_and_approve_gateway_join() {
  local gateway_token="$1"

  local invite_payload
  invite_payload="$(jq -nc '{allowedJoinTypes:"agent"}')"
  api_request "POST" "/companies/${COMPANY_ID}/invites" "$invite_payload"
  assert_status "201"

  local invite_token
  invite_token="$(jq -r '.token // empty' <<<"$RESPONSE_BODY")"
  INVITE_ID="$(jq -r '.id // empty' <<<"$RESPONSE_BODY")"
  [[ -n "$invite_token" && -n "$INVITE_ID" ]] || fail "invite creation missing token/id"

  local join_payload
  join_payload="$(jq -nc \
    --arg name "$OPENCLAW_AGENT_NAME" \
    --arg url "$OPENCLAW_GATEWAY_URL" \
    --arg token "$gateway_token" \
    --arg paperclipApiUrl "$PAPERCLIP_API_URL_FOR_OPENCLAW" \
    --argjson timeoutSec "$OPENCLAW_ADAPTER_TIMEOUT_SEC" \
    --argjson waitTimeoutMs "$OPENCLAW_ADAPTER_WAIT_TIMEOUT_MS" \
    '{
      requestType: "agent",
      agentName: $name,
      adapterType: "openclaw_gateway",
      capabilities: "OpenClaw gateway smoke harness",
      agentDefaultsPayload: {
        url: $url,
        headers: { "x-openclaw-token": $token },
        role: "operator",
        scopes: ["operator.admin"],
        sessionKeyStrategy: "fixed",
        sessionKey: "paperclip",
        timeoutSec: $timeoutSec,
        waitTimeoutMs: $waitTimeoutMs,
        paperclipApiUrl: $paperclipApiUrl
      }
    }')"

  api_request "POST" "/invites/${invite_token}/accept" "$join_payload"
  assert_status "202"

  JOIN_REQUEST_ID="$(jq -r '.id // empty' <<<"$RESPONSE_BODY")"
  local claim_secret
  claim_secret="$(jq -r '.claimSecret // empty' <<<"$RESPONSE_BODY")"
  local claim_path
  claim_path="$(jq -r '.claimApiKeyPath // empty' <<<"$RESPONSE_BODY")"
  [[ -n "$JOIN_REQUEST_ID" && -n "$claim_secret" && -n "$claim_path" ]] || fail "join accept missing claim metadata"

  log "approving join request ${JOIN_REQUEST_ID}"
  api_request "POST" "/companies/${COMPANY_ID}/join-requests/${JOIN_REQUEST_ID}/approve" "{}"
  assert_status "200"

  AGENT_ID="$(jq -r '.createdAgentId // empty' <<<"$RESPONSE_BODY")"
  [[ -n "$AGENT_ID" ]] || fail "join approval missing createdAgentId"

  log "claiming one-time agent API key"
  local claim_payload
  claim_payload="$(jq -nc --arg secret "$claim_secret" '{claimSecret:$secret}')"
  api_request "POST" "$claim_path" "$claim_payload"
  assert_status "201"

  AGENT_API_KEY="$(jq -r '.token // empty' <<<"$RESPONSE_BODY")"
  [[ -n "$AGENT_API_KEY" ]] || fail "claim response missing token"

  persist_claimed_key_artifacts "$RESPONSE_BODY"
  inject_agent_api_key_payload_template
}

persist_claimed_key_artifacts() {
  local claim_json="$1"
  local workspace_dir="${OPENCLAW_CONFIG_DIR%/}/workspace"
  local skill_dir="${OPENCLAW_CONFIG_DIR%/}/skills/paperclip"
  local claimed_file="${workspace_dir}/paperclip-claimed-api-key.json"
  local claimed_raw_file="${workspace_dir}/paperclip-claimed-api-key.raw.json"

  mkdir -p "$workspace_dir" "$skill_dir"
  local token
  token="$(jq -r '.token // .apiKey // empty' <<<"$claim_json")"
  [[ -n "$token" ]] || fail "claim response missing token/apiKey"

  printf "%s\n" "$claim_json" > "$claimed_raw_file"
  chmod 600 "$claimed_raw_file"

  jq -nc --arg token "$token" '{ token: $token, apiKey: $token }' > "$claimed_file"
  # Keep this readable for OpenClaw runtime users across sandbox/container contexts.
  chmod 644 "$claimed_file"

  local container
  container="$(detect_openclaw_container || true)"
  if [[ -n "$container" ]]; then
    docker exec "$container" sh -lc "mkdir -p /home/node/.openclaw/workspace" >/dev/null 2>&1 || true
    docker cp "$claimed_file" "${container}:/home/node/.openclaw/workspace/paperclip-claimed-api-key.json" >/dev/null 2>&1 || true
    docker exec "$container" sh -lc "chmod 644 /home/node/.openclaw/workspace/paperclip-claimed-api-key.json" >/dev/null 2>&1 || true
  fi

  if [[ "$AUTO_INSTALL_SKILL" == "1" ]]; then
    api_request "GET" "/skills/paperclip"
    assert_status "200"
    {
      echo "PAPERCLIP_API_URL=${PAPERCLIP_API_URL_FOR_OPENCLAW}"
      echo
      printf "%s\n" "$RESPONSE_BODY"
    } > "${skill_dir}/SKILL.md"
    chmod 600 "${skill_dir}/SKILL.md"
  fi

  log "wrote claimed key artifacts to ${claimed_file} and ${claimed_raw_file}"
}

inject_agent_api_key_payload_template() {
  [[ -n "$AGENT_ID" ]] || fail "inject_agent_api_key_payload_template requires AGENT_ID"
  [[ -n "$AGENT_API_KEY" ]] || fail "inject_agent_api_key_payload_template requires AGENT_API_KEY"

  api_request "GET" "/agents/${AGENT_ID}"
  assert_status "200"

  local base_message
  base_message="Set PAPERCLIP_API_KEY=${AGENT_API_KEY} in your run context before running Paperclip heartbeat steps."
  if [[ -n "$PAYLOAD_TEMPLATE_MESSAGE_APPEND" ]]; then
    base_message="${base_message}\n\n${PAYLOAD_TEMPLATE_MESSAGE_APPEND}"
  fi

  local patch_payload
  patch_payload="$(jq -c --arg message "$base_message" '
    {adapterConfig: ((.adapterConfig // {}) + {
      payloadTemplate: (((.adapterConfig // {}).payloadTemplate // {}) + {
        message: $message
      })
    })}
  ' <<<"$RESPONSE_BODY")"

  api_request "PATCH" "/agents/${AGENT_ID}" "$patch_payload"
  assert_status "200"
}

validate_joined_gateway_agent() {
  local expected_gateway_token="$1"

  api_request "GET" "/agents/${AGENT_ID}"
  assert_status "200"

  local adapter_type gateway_url configured_token disable_device_auth device_key_len
  adapter_type="$(jq -r '.adapterType // empty' <<<"$RESPONSE_BODY")"
  gateway_url="$(jq -r '.adapterConfig.url // empty' <<<"$RESPONSE_BODY")"
  configured_token="$(jq -r '.adapterConfig.headers["x-openclaw-token"] // .adapterConfig.headers["x-openclaw-auth"] // empty' <<<"$RESPONSE_BODY")"
  disable_device_auth="$(jq -r 'if .adapterConfig.disableDeviceAuth == true then "true" else "false" end' <<<"$RESPONSE_BODY")"
  device_key_len="$(jq -r '(.adapterConfig.devicePrivateKeyPem // "" | length)' <<<"$RESPONSE_BODY")"

  [[ "$adapter_type" == "openclaw_gateway" ]] || fail "joined agent adapterType is '${adapter_type}', expected 'openclaw_gateway'"
  [[ "$gateway_url" =~ ^wss?:// ]] || fail "joined agent gateway url is invalid: '${gateway_url}'"
  [[ -n "$configured_token" ]] || fail "joined agent missing adapterConfig.headers.x-openclaw-token"
  if (( ${#configured_token} < 16 )); then
    fail "joined agent gateway token looks too short (${#configured_token} chars)"
  fi

  local expected_hash configured_hash
  expected_hash="$(hash_prefix "$expected_gateway_token")"
  configured_hash="$(hash_prefix "$configured_token")"
  if [[ "$expected_hash" != "$configured_hash" ]]; then
    fail "joined agent gateway token hash mismatch (expected ${expected_hash}, got ${configured_hash})"
  fi

  [[ "$disable_device_auth" == "false" ]] || fail "joined agent has disableDeviceAuth=true; smoke requires device auth enabled with persistent key"
  if (( device_key_len < 32 )); then
    fail "joined agent missing persistent devicePrivateKeyPem (length=${device_key_len})"
  fi

  log "validated joined gateway agent config (token sha256 prefix ${configured_hash})"
}

run_log_contains_pairing_required() {
  local run_id="$1"
  api_request "GET" "/heartbeat-runs/${run_id}/log?limitBytes=262144"
  if [[ "$RESPONSE_CODE" != "200" ]]; then
    return 1
  fi
  local content
  content="$(jq -r '.content // ""' <<<"$RESPONSE_BODY")"
  grep -qi "pairing required" <<<"$content"
}

approve_latest_pairing_request() {
  local gateway_token="$1"
  local container
  container="$(detect_openclaw_container || true)"
  [[ -n "$container" ]] || return 1

  log "approving latest gateway pairing request in ${container}"
  local output
  if output="$(docker exec \
    -e OPENCLAW_GATEWAY_URL="$OPENCLAW_GATEWAY_URL" \
    -e OPENCLAW_GATEWAY_TOKEN="$gateway_token" \
    "$container" \
    sh -lc 'openclaw devices approve --latest --json --url "$OPENCLAW_GATEWAY_URL" --token "$OPENCLAW_GATEWAY_TOKEN"' 2>&1)"; then
    log "pairing approval response: $(printf "%s" "$output" | tr '\n' ' ' | cut -c1-400)"
    return 0
  fi

  warn "pairing auto-approve failed: $(printf "%s" "$output" | tr '\n' ' ' | cut -c1-400)"
  return 1
}

trigger_wakeup() {
  local reason="$1"
  local issue_id="${2:-}"

  local payload
  if [[ -n "$issue_id" ]]; then
    payload="$(jq -nc --arg issueId "$issue_id" --arg reason "$reason" '{source:"on_demand",triggerDetail:"manual",reason:$reason,payload:{issueId:$issueId,taskId:$issueId}}')"
  else
    payload="$(jq -nc --arg reason "$reason" '{source:"on_demand",triggerDetail:"manual",reason:$reason}')"
  fi

  api_request "POST" "/agents/${AGENT_ID}/wakeup" "$payload"
  if [[ "$RESPONSE_CODE" != "202" ]]; then
    echo "$RESPONSE_BODY" >&2
    fail "wakeup failed (HTTP ${RESPONSE_CODE})"
  fi

  RUN_ID="$(jq -r '.id // empty' <<<"$RESPONSE_BODY")"
  if [[ -z "$RUN_ID" ]]; then
    warn "wakeup response did not include run id; body: ${RESPONSE_BODY}"
  fi
}

get_run_status() {
  local run_id="$1"
  api_request "GET" "/companies/${COMPANY_ID}/heartbeat-runs?agentId=${AGENT_ID}&limit=200"
  if [[ "$RESPONSE_CODE" != "200" ]]; then
    echo ""
    return 0
  fi
  jq -r --arg runId "$run_id" '.[] | select(.id == $runId) | .status' <<<"$RESPONSE_BODY" | head -n1
}

wait_for_run_terminal() {
  local run_id="$1"
  local timeout_sec="$2"
  local started now status

  [[ -n "$run_id" ]] || fail "wait_for_run_terminal requires run id"
  started="$(date +%s)"

  while true; do
    status="$(get_run_status "$run_id")"
    if [[ "$status" == "succeeded" || "$status" == "failed" || "$status" == "timed_out" || "$status" == "cancelled" ]]; then
      if [[ "$status" != "succeeded" ]]; then
        capture_run_diagnostics "$run_id" "run-nonsuccess"
        capture_openclaw_container_logs
      fi
      echo "$status"
      return 0
    fi

    now="$(date +%s)"
    if (( now - started >= timeout_sec )); then
      capture_run_diagnostics "$run_id" "run-timeout"
      capture_openclaw_container_logs
      echo "timeout"
      return 0
    fi
    sleep 2
  done
}

get_issue_status() {
  local issue_id="$1"
  api_request "GET" "/issues/${issue_id}"
  if [[ "$RESPONSE_CODE" != "200" ]]; then
    echo ""
    return 0
  fi
  jq -r '.status // empty' <<<"$RESPONSE_BODY"
}

wait_for_issue_terminal() {
  local issue_id="$1"
  local timeout_sec="$2"
  local started now status
  started="$(date +%s)"

  while true; do
    status="$(get_issue_status "$issue_id")"
    if [[ "$status" == "done" || "$status" == "blocked" || "$status" == "cancelled" ]]; then
      echo "$status"
      return 0
    fi

    now="$(date +%s)"
    if (( now - started >= timeout_sec )); then
      echo "timeout"
      return 0
    fi
    sleep 3
  done
}

issue_comments_contain() {
  local issue_id="$1"
  local marker="$2"
  api_request "GET" "/issues/${issue_id}/comments"
  if [[ "$RESPONSE_CODE" != "200" ]]; then
    echo "false"
    return 0
  fi
  jq -r --arg marker "$marker" '[.[] | (.body // "") | contains($marker)] | any' <<<"$RESPONSE_BODY"
}

create_issue_for_case() {
  local title="$1"
  local description="$2"
  local priority="${3:-high}"

  local payload
  payload="$(jq -nc \
    --arg title "$title" \
    --arg description "$description" \
    --arg assignee "$AGENT_ID" \
    --arg priority "$priority" \
    '{title:$title,description:$description,status:"todo",priority:$priority,assigneeAgentId:$assignee}')"

  api_request "POST" "/companies/${COMPANY_ID}/issues" "$payload"
  assert_status "201"

  local issue_id issue_identifier
  issue_id="$(jq -r '.id // empty' <<<"$RESPONSE_BODY")"
  issue_identifier="$(jq -r '.identifier // empty' <<<"$RESPONSE_BODY")"
  [[ -n "$issue_id" ]] || fail "issue create missing id"

  echo "${issue_id}|${issue_identifier}"
}

patch_agent_session_strategy_run() {
  api_request "GET" "/agents/${AGENT_ID}"
  assert_status "200"

  local patch_payload
  patch_payload="$(jq -c '{adapterConfig: ((.adapterConfig // {}) + {sessionKeyStrategy:"run"})}' <<<"$RESPONSE_BODY")"
  api_request "PATCH" "/agents/${AGENT_ID}" "$patch_payload"
  assert_status "200"
}

find_issue_by_query() {
  local query="$1"
  local encoded_query
  encoded_query="$(jq -rn --arg q "$query" '$q|@uri')"
  api_request "GET" "/companies/${COMPANY_ID}/issues?q=${encoded_query}"
  if [[ "$RESPONSE_CODE" != "200" ]]; then
    echo ""
    return 0
  fi
  jq -r '.[] | .id' <<<"$RESPONSE_BODY" | head -n1
}

ensure_workflow_smoke_enabled() {
  api_request "PATCH" "/instance/settings/experimental"     '{"enableWorkflowsV1":true,"enableWorkflowExternalAgentNodes":true}'
  assert_status "200"

  local workflows_enabled external_enabled
  workflows_enabled="$(jq -r '.enableWorkflowsV1 // false' <<<"$RESPONSE_BODY")"
  external_enabled="$(jq -r '.enableWorkflowExternalAgentNodes // false' <<<"$RESPONSE_BODY")"
  [[ "$workflows_enabled" == "true" ]] || fail "workflow smoke could not enable Workflows V1"
  [[ "$external_enabled" == "true" ]] || fail "workflow smoke could not enable External Agent workflow nodes"
}

wait_for_workflow_run_terminal() {
  local run_id="$1"
  local timeout_sec="$2"
  local started_at now status
  started_at="$(date +%s)"

  while true; do
    api_request "GET" "/companies/${COMPANY_ID}/workflow-runs/${run_id}"
    if [[ "$RESPONSE_CODE" != "200" ]]; then
      echo "$RESPONSE_BODY" >&2
      fail "workflow run ${run_id} read failed with HTTP ${RESPONSE_CODE}"
    fi
    status="$(jq -r '.run.status // "unknown"' <<<"$RESPONSE_BODY")"
    case "$status" in
      succeeded|failed|cancelled)
        echo "$status"
        return 0
        ;;
    esac

    now="$(date +%s)"
    if (( now - started_at >= timeout_sec )); then
      echo "$status"
      return 0
    fi
    sleep 1
  done
}

capture_workflow_diagnostics() {
  local run_id="$1"
  local label="${2:-workflow}"
  mkdir -p "$OPENCLAW_DIAG_DIR"
  api_request "GET" "/companies/${COMPANY_ID}/workflow-runs/${run_id}"
  if [[ "$RESPONSE_CODE" == "200" ]]; then
    printf "%s\n" "$RESPONSE_BODY" > "${OPENCLAW_DIAG_DIR}/${label}-${run_id}.json"
  fi
}

create_external_agent_workflow() {
  local marker="$1"
  local timeout_seconds="$2"
  local objective="$3"

  api_request "POST" "/companies/${COMPANY_ID}/workflows"     "$(jq -nc --arg marker "$marker"       '{name:("[OpenClaw Gateway Smoke] External Agent " + $marker),description:"Gate 27.5 live External Agent workflow evidence"}')"
  assert_status "201"

  WORKFLOW_ID="$(jq -r '.id // empty' <<<"$RESPONSE_BODY")"
  local draft_revision_id
  draft_revision_id="$(jq -r '.draftRevisionId // empty' <<<"$RESPONSE_BODY")"
  [[ -n "$WORKFLOW_ID" && -n "$draft_revision_id" ]] || fail "workflow create missing id or draft revision"

  local patch_payload
  patch_payload="$(jq -nc     --arg expected "$draft_revision_id"     --arg agentId "$AGENT_ID"     --arg marker "$marker"     --arg objective "$objective"     --argjson timeout "$timeout_seconds"     '{
      expectedRevisionId:$expected,
      changeSummary:"Gate 27.5 OpenClaw External Agent smoke",
      graph:{
        version:1,
        nodes:[
          {
            id:"start",
            type:"core.manual_trigger",
            name:"Manual start",
            position:{x:0,y:0},
            config:{}
          },
          {
            id:"external",
            type:"agent.external",
            name:"OpenClaw External Agent",
            position:{x:180,y:0},
            config:{
              agentId:$agentId,
              objective:$objective,
              structuredInput:{marker:$marker,score:7},
              expectedOutputSchema:{
                type:"object",
                properties:{
                  marker:{type:"string",const:$marker},
                  score:{type:"number",const:7}
                },
                required:["marker","score"],
                additionalProperties:false
              },
              timeoutSeconds:$timeout,
              allowedCapabilityScope:"binding_grants",
              fallbackPolicy:"fail"
            }
          },
          {
            id:"after",
            type:"core.condition",
            name:"Continue after OpenClaw",
            position:{x:360,y:0},
            config:{expression:"true"}
          }
        ],
        edges:[
          {id:"e1",source:"start",target:"external"},
          {id:"e2",source:"external",target:"after"}
        ],
        variables:[],
        settings:{}
      }
    }')"

  api_request "PATCH" "/companies/${COMPANY_ID}/workflows/${WORKFLOW_ID}/draft" "$patch_payload"
  assert_status "200"
  draft_revision_id="$(jq -r '.draftRevisionId // empty' <<<"$RESPONSE_BODY")"
  [[ -n "$draft_revision_id" ]] || fail "workflow update missing draftRevisionId"

  local publish_payload
  publish_payload="$(jq -nc --arg draft "$draft_revision_id"     '{expectedDraftRevisionId:$draft,expectedPublishedRevisionId:null,approvalId:null}')"
  api_request "POST" "/companies/${COMPANY_ID}/workflows/${WORKFLOW_ID}/publish" "$publish_payload"
  assert_status "200"
  [[ "$(jq -r '.publishedRevision.state // empty' <<<"$RESPONSE_BODY")" == "published" ]]     || fail "workflow publication did not return a published revision"
}

start_external_agent_workflow() {
  local marker="$1"
  local request_key="$2"

  local run_payload
  run_payload="$(jq -nc --arg marker "$marker" '{input:{marker:$marker},revisionId:null}')"
  api_request "POST" "/companies/${COMPANY_ID}/workflows/${WORKFLOW_ID}/run" "$run_payload" "$request_key"
  assert_status "201"

  WORKFLOW_RUN_ID="$(jq -r '.run.id // empty' <<<"$RESPONSE_BODY")"
  WORKFLOW_EXTERNAL_ISSUE_ID="$(jq -r '[.steps[] | select(.nodeId=="external")][0].outputJson.issueId // empty' <<<"$RESPONSE_BODY")"
  WORKFLOW_EXTERNAL_HEARTBEAT_RUN_ID="$(jq -r '[.steps[] | select(.nodeId=="external")][0].outputJson.heartbeatRunId // empty' <<<"$RESPONSE_BODY")"
  [[ -n "$WORKFLOW_RUN_ID" ]] || fail "workflow run response missing run id"
}

assert_external_agent_workflow_success() {
  local marker="$1"
  local label="${2:-workflow-external}"
  local status
  status="$(wait_for_workflow_run_terminal "$WORKFLOW_RUN_ID" "$WORKFLOW_RUN_TIMEOUT_SEC")"
  log "${label} run ${WORKFLOW_RUN_ID} status=${status}"

  api_request "GET" "/companies/${COMPANY_ID}/workflow-runs/${WORKFLOW_RUN_ID}"
  assert_status "200"
  local external_status returned_marker returned_score
  external_status="$(jq -r '[.steps[] | select(.nodeId=="external")][0].status // empty' <<<"$RESPONSE_BODY")"
  returned_marker="$(jq -r '[.steps[] | select(.nodeId=="external")][0].outputJson.output.marker // empty' <<<"$RESPONSE_BODY")"
  returned_score="$(jq -r '[.steps[] | select(.nodeId=="external")][0].outputJson.output.score // empty' <<<"$RESPONSE_BODY")"
  WORKFLOW_EXTERNAL_ISSUE_ID="$(jq -r '[.steps[] | select(.nodeId=="external")][0].outputJson.issueId // empty' <<<"$RESPONSE_BODY")"
  WORKFLOW_EXTERNAL_HEARTBEAT_RUN_ID="$(jq -r '[.steps[] | select(.nodeId=="external")][0].outputJson.heartbeatRunId // empty' <<<"$RESPONSE_BODY")"

  if [[ "$status" != "succeeded" || "$external_status" != "succeeded" || "$returned_marker" != "$marker" || "$returned_score" != "7" ]]; then
    capture_workflow_diagnostics "$WORKFLOW_RUN_ID" "$label"
    [[ -n "$WORKFLOW_EXTERNAL_ISSUE_ID" ]] && capture_issue_diagnostics "$WORKFLOW_EXTERNAL_ISSUE_ID" "$label"
    [[ -n "$WORKFLOW_EXTERNAL_HEARTBEAT_RUN_ID" ]] && capture_run_diagnostics "$WORKFLOW_EXTERNAL_HEARTBEAT_RUN_ID" "$label"
    capture_openclaw_container_logs
    fail "${label} did not return the governed structured result"
  fi
}

run_workflow_external_agent_case() {
  local marker="OPENCLAW_WORKFLOW_OK_$(date +%s)"
  local objective
  objective="Return ONLY this JSON object as your final answer, with no markdown or prose: {\"marker\":\"${marker}\",\"score\":7}. Do not alter the marker or score."

  log "workflow success case: building External Agent workflow"
  create_external_agent_workflow "$marker" 180 "$objective"
  start_external_agent_workflow "$marker" "openclaw-workflow-success-${marker}"
  assert_external_agent_workflow_success "$marker" "workflow-success"
}

run_workflow_cancellation_case() {
  local marker="OPENCLAW_WORKFLOW_CANCEL_$(date +%s)"
  local objective
  objective="Perform a careful multi-step review of the structured input. Before giving a final answer, verify the marker and score twice. Final answer must be ONLY JSON: {\"marker\":\"${marker}\",\"score\":7}."

  log "workflow cancellation case: starting live External Agent work"
  create_external_agent_workflow "$marker" 180 "$objective"
  start_external_agent_workflow "$marker" "openclaw-workflow-cancel-${marker}"

  api_request "POST" "/companies/${COMPANY_ID}/workflow-runs/${WORKFLOW_RUN_ID}/cancel"     '{"reason":"Gate 27.5 live cancellation exercise"}'
  assert_status "200"

  local status
  status="$(wait_for_workflow_run_terminal "$WORKFLOW_RUN_ID" 90)"
  log "workflow cancellation case run ${WORKFLOW_RUN_ID} status=${status}"
  if [[ "$status" != "cancelled" ]]; then
    capture_workflow_diagnostics "$WORKFLOW_RUN_ID" "workflow-cancel"
    [[ -n "$WORKFLOW_EXTERNAL_HEARTBEAT_RUN_ID" ]] && capture_run_diagnostics "$WORKFLOW_EXTERNAL_HEARTBEAT_RUN_ID" "workflow-cancel"
    capture_openclaw_container_logs
    fail "workflow cancellation case did not reach cancelled"
  fi
}

run_workflow_process_loss_case() {
  local marker="OPENCLAW_WORKFLOW_PROCESS_LOSS_$(date +%s)"
  local objective
  objective="Return ONLY JSON when complete: {\"marker\":\"${marker}\",\"score\":7}. Validate the structured input before replying."

  log "workflow process-loss case: starting External Agent run"
  create_external_agent_workflow "$marker" 30 "$objective"
  start_external_agent_workflow "$marker" "openclaw-workflow-process-loss-${marker}"

  local container
  container="$(detect_openclaw_container || true)"
  [[ -n "$container" ]] || fail "workflow process-loss case could not find OpenClaw gateway container"

  log "workflow process-loss case: SIGKILL gateway container ${container}"
  docker kill --signal=KILL "$container" >/dev/null
  sleep 2
  docker start "$container" >/dev/null
  wait_http_ready "http://127.0.0.1:18789/" "$OPENCLAW_WAIT_SECONDS"     || fail "OpenClaw gateway did not recover after process-loss exercise"

  local gateway_token
  gateway_token="$(detect_gateway_token || true)"
  [[ -n "$gateway_token" ]] || fail "could not resolve gateway token after restart"
  probe_gateway_ws "$OPENCLAW_GATEWAY_URL" "$gateway_token"

  local status
  status="$(wait_for_workflow_run_terminal "$WORKFLOW_RUN_ID" "$WORKFLOW_PROCESS_LOSS_TIMEOUT_SEC")"
  log "workflow process-loss original run ${WORKFLOW_RUN_ID} status=${status}"

  if [[ "$status" == "succeeded" ]]; then
    assert_external_agent_workflow_success "$marker" "workflow-process-loss-auto-recovery"
    return
  fi
  if [[ "$status" != "failed" ]]; then
    capture_workflow_diagnostics "$WORKFLOW_RUN_ID" "workflow-process-loss"
    capture_openclaw_container_logs
    fail "workflow process-loss run neither recovered nor failed truthfully"
  fi

  local failed_run_id="$WORKFLOW_RUN_ID"
  api_request "POST" "/companies/${COMPANY_ID}/workflow-runs/${failed_run_id}/retry"     '{"reason":"Retry after live OpenClaw gateway process loss"}'     "openclaw-workflow-process-loss-retry-${marker}"
  assert_status "201"
  WORKFLOW_RUN_ID="$(jq -r '.run.id // empty' <<<"$RESPONSE_BODY")"
  [[ -n "$WORKFLOW_RUN_ID" && "$WORKFLOW_RUN_ID" != "$failed_run_id" ]]     || fail "process-loss retry did not create a new workflow run"

  assert_external_agent_workflow_success "$marker" "workflow-process-loss-retry"
}

run_case_a() {
  local marker="OPENCLAW_CASE_A_OK_$(date +%s)"
  local description
  description="Case A validation.\n\n1) Read this issue.\n2) Post a comment containing exactly: ${marker}\n3) Mark this issue done."

  local created
  created="$(create_issue_for_case "[OpenClaw Gateway Smoke] Case A" "$description")"
  CASE_A_ISSUE_ID="${created%%|*}"
  local case_identifier="${created##*|}"

  log "case A issue ${CASE_A_ISSUE_ID} (${case_identifier})"
  trigger_wakeup "openclaw_gateway_smoke_case_a" "$CASE_A_ISSUE_ID"

  local run_status issue_status marker_found
  if [[ -n "$RUN_ID" ]]; then
    run_status="$(wait_for_run_terminal "$RUN_ID" "$RUN_TIMEOUT_SEC")"
    log "case A run ${RUN_ID} status=${run_status}"
  else
    run_status="unknown"
  fi

  issue_status="$(wait_for_issue_terminal "$CASE_A_ISSUE_ID" "$CASE_TIMEOUT_SEC")"
  marker_found="$(issue_comments_contain "$CASE_A_ISSUE_ID" "$marker")"
  log "case A issue_status=${issue_status} marker_found=${marker_found}"

  if [[ "$issue_status" != "done" || "$marker_found" != "true" ]]; then
    capture_issue_diagnostics "$CASE_A_ISSUE_ID" "case-a"
    if [[ -n "$RUN_ID" ]]; then
      capture_run_diagnostics "$RUN_ID" "case-a"
    fi
    capture_openclaw_container_logs
  fi

  if [[ "$STRICT_CASES" == "1" ]]; then
    [[ "$run_status" == "succeeded" ]] || fail "case A run did not succeed"
    [[ "$issue_status" == "done" ]] || fail "case A issue did not reach done"
    [[ "$marker_found" == "true" ]] || fail "case A marker not found in comments"
  fi
}

run_case_b() {
  local marker="OPENCLAW_CASE_B_OK_$(date +%s)"
  local message_text="${marker}"
  local description
  description="Case B validation.\n\nUse the message tool to send this exact text to the user's main chat session in webchat:\n${message_text}\n\nAfter sending, post a Paperclip issue comment containing exactly: ${marker}\nThen mark this issue done."

  local created
  created="$(create_issue_for_case "[OpenClaw Gateway Smoke] Case B" "$description")"
  CASE_B_ISSUE_ID="${created%%|*}"
  local case_identifier="${created##*|}"

  log "case B issue ${CASE_B_ISSUE_ID} (${case_identifier})"
  trigger_wakeup "openclaw_gateway_smoke_case_b" "$CASE_B_ISSUE_ID"

  local run_status issue_status marker_found
  if [[ -n "$RUN_ID" ]]; then
    run_status="$(wait_for_run_terminal "$RUN_ID" "$RUN_TIMEOUT_SEC")"
    log "case B run ${RUN_ID} status=${run_status}"
  else
    run_status="unknown"
  fi

  issue_status="$(wait_for_issue_terminal "$CASE_B_ISSUE_ID" "$CASE_TIMEOUT_SEC")"
  marker_found="$(issue_comments_contain "$CASE_B_ISSUE_ID" "$marker")"
  log "case B issue_status=${issue_status} marker_found=${marker_found}"

  if [[ "$issue_status" != "done" || "$marker_found" != "true" ]]; then
    capture_issue_diagnostics "$CASE_B_ISSUE_ID" "case-b"
    if [[ -n "$RUN_ID" ]]; then
      capture_run_diagnostics "$RUN_ID" "case-b"
    fi
    capture_openclaw_container_logs
  fi

  warn "case B requires manual UX confirmation in OpenClaw main webchat: message '${message_text}' appears in main chat"

  if [[ "$STRICT_CASES" == "1" ]]; then
    [[ "$run_status" == "succeeded" ]] || fail "case B run did not succeed"
    [[ "$issue_status" == "done" ]] || fail "case B issue did not reach done"
    [[ "$marker_found" == "true" ]] || fail "case B marker not found in comments"
  fi
}

run_case_c() {
  patch_agent_session_strategy_run

  local marker="OPENCLAW_CASE_C_CREATED_$(date +%s)"
  local ack_marker="OPENCLAW_CASE_C_ACK_$(date +%s)"
  local original_issue_reference="the original case issue you are currently reading"
  local description
  description="Case C validation.\n\nTreat this run as a fresh/new session.\nCreate a NEW Paperclip issue in this same company with title exactly:\n${marker}\nUse description: 'created by case C smoke'.\n\nThen post a comment on ${original_issue_reference} containing exactly: ${ack_marker}\nDo NOT post the ACK comment on the newly created issue.\nThen mark the original case issue done."

  local created
  created="$(create_issue_for_case "[OpenClaw Gateway Smoke] Case C" "$description")"
  CASE_C_ISSUE_ID="${created%%|*}"
  local case_identifier="${created##*|}"

  log "case C issue ${CASE_C_ISSUE_ID} (${case_identifier})"
  trigger_wakeup "openclaw_gateway_smoke_case_c" "$CASE_C_ISSUE_ID"

  local run_status issue_status marker_found created_issue
  if [[ -n "$RUN_ID" ]]; then
    run_status="$(wait_for_run_terminal "$RUN_ID" "$RUN_TIMEOUT_SEC")"
    log "case C run ${RUN_ID} status=${run_status}"
  else
    run_status="unknown"
  fi

  issue_status="$(wait_for_issue_terminal "$CASE_C_ISSUE_ID" "$CASE_TIMEOUT_SEC")"
  marker_found="$(issue_comments_contain "$CASE_C_ISSUE_ID" "$ack_marker")"
  created_issue="$(find_issue_by_query "$marker")"
  if [[ "$created_issue" == "$CASE_C_ISSUE_ID" ]]; then
    created_issue=""
  fi
  CASE_C_CREATED_ISSUE_ID="$created_issue"
  log "case C issue_status=${issue_status} marker_found=${marker_found} created_issue_id=${CASE_C_CREATED_ISSUE_ID:-none}"

  if [[ "$issue_status" != "done" || "$marker_found" != "true" || -z "$CASE_C_CREATED_ISSUE_ID" ]]; then
    capture_issue_diagnostics "$CASE_C_ISSUE_ID" "case-c"
    if [[ -n "$CASE_C_CREATED_ISSUE_ID" ]]; then
      capture_issue_diagnostics "$CASE_C_CREATED_ISSUE_ID" "case-c-created"
    fi
    if [[ -n "$RUN_ID" ]]; then
      capture_run_diagnostics "$RUN_ID" "case-c"
    fi
    capture_openclaw_container_logs
  fi

  if [[ "$STRICT_CASES" == "1" ]]; then
    [[ "$run_status" == "succeeded" ]] || fail "case C run did not succeed"
    [[ "$issue_status" == "done" ]] || fail "case C issue did not reach done"
    [[ "$marker_found" == "true" ]] || fail "case C ack marker not found in comments"
    [[ -n "$CASE_C_CREATED_ISSUE_ID" ]] || fail "case C did not create the expected new issue"
  fi
}

main() {
  log "starting OpenClaw gateway E2E smoke"
  mkdir -p "$OPENCLAW_DIAG_DIR"
  log "diagnostics dir: ${OPENCLAW_DIAG_DIR}"

  wait_http_ready "${PAPERCLIP_API_URL%/}/api/health" 15 || fail "Paperclip API health endpoint not reachable"
  api_request "GET" "/health"
  assert_status "200"
  log "paperclip health deploymentMode=$(jq -r '.deploymentMode // "unknown"' <<<"$RESPONSE_BODY") exposure=$(jq -r '.deploymentExposure // "unknown"' <<<"$RESPONSE_BODY")"

  require_board_auth
  resolve_company_id
  cleanup_openclaw_agents
  cleanup_pending_join_requests

  maybe_cleanup_openclaw_docker
  start_openclaw_docker
  wait_http_ready "http://127.0.0.1:18789/" "$OPENCLAW_WAIT_SECONDS" || fail "OpenClaw HTTP health not reachable"

  local gateway_token
  gateway_token="$(detect_gateway_token || true)"
  [[ -n "$gateway_token" ]] || fail "could not resolve OpenClaw gateway token"
  log "resolved gateway token (sha256 prefix $(hash_prefix "$gateway_token"))"

  log "probing gateway websocket challenge at ${OPENCLAW_GATEWAY_URL}"
  probe_gateway_ws "$OPENCLAW_GATEWAY_URL" "$gateway_token"

  create_and_approve_gateway_join "$gateway_token"
  log "joined/approved agent ${AGENT_ID} invite=${INVITE_ID} joinRequest=${JOIN_REQUEST_ID}"
  validate_joined_gateway_agent "$gateway_token"

  local connect_status="unknown"
  local connect_attempt
  for connect_attempt in 1 2; do
    trigger_wakeup "openclaw_gateway_smoke_connectivity_attempt_${connect_attempt}"
    if [[ -z "$RUN_ID" ]]; then
      connect_status="unknown"
      break
    fi
    connect_status="$(wait_for_run_terminal "$RUN_ID" "$RUN_TIMEOUT_SEC")"
    if [[ "$connect_status" == "succeeded" ]]; then
      log "connectivity wake run ${RUN_ID} succeeded (attempt=${connect_attempt})"
      break
    fi

    if [[ "$PAIRING_AUTO_APPROVE" == "1" && "$connect_attempt" -eq 1 ]] && run_log_contains_pairing_required "$RUN_ID"; then
      log "connectivity run hit pairing gate; attempting one-time pairing approval"
      approve_latest_pairing_request "$gateway_token" || fail "pairing approval failed after pairing-required run ${RUN_ID}"
      sleep 2
      continue
    fi

    fail "connectivity wake run failed: ${connect_status} (attempt=${connect_attempt}, runId=${RUN_ID})"
  done
  [[ "$connect_status" == "succeeded" ]] || fail "connectivity wake run did not succeed after retries"

  if [[ "$WORKFLOW_CASES" == "1" ]]; then
    ensure_workflow_smoke_enabled
    run_workflow_external_agent_case
    if [[ "$WORKFLOW_CANCELLATION_CASE" == "1" ]]; then
      run_workflow_cancellation_case
    fi
    if [[ "$WORKFLOW_PROCESS_LOSS_CASE" == "1" ]]; then
      run_workflow_process_loss_case
    fi
  fi

  run_case_a
  run_case_b
  run_case_c

  log "success"
  log "companyId=${COMPANY_ID}"
  log "agentId=${AGENT_ID}"
  log "inviteId=${INVITE_ID}"
  log "joinRequestId=${JOIN_REQUEST_ID}"
  log "caseA_issueId=${CASE_A_ISSUE_ID}"
  log "caseB_issueId=${CASE_B_ISSUE_ID}"
  log "caseC_issueId=${CASE_C_ISSUE_ID}"
  log "caseC_createdIssueId=${CASE_C_CREATED_ISSUE_ID:-none}"
  if [[ "$WORKFLOW_CASES" == "1" ]]; then
    log "workflowId=${WORKFLOW_ID:-none}"
    log "workflowRunId=${WORKFLOW_RUN_ID:-none}"
    log "workflowExternalIssueId=${WORKFLOW_EXTERNAL_ISSUE_ID:-none}"
    log "workflowExternalHeartbeatRunId=${WORKFLOW_EXTERNAL_HEARTBEAT_RUN_ID:-none}"
  fi
  log "agentApiKeyPrefix=${AGENT_API_KEY:0:12}..."
}

main "$@"
