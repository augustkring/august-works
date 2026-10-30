# OpenShell RT-01 expected sandbox identity patch

This cumulative R4 downstream patch addresses the RT-01 identity-binding requirement against NVIDIA/OpenShell v0.1.2 at commit `6648bd0c290efbc41ba131ee9831ee45cd431f94`. It adds distinct identity-bound RPC names and CLI routing for Start, Stop, Delete, policy update, unary Exec, provider attach and provider detach while leaving legacy RPC names intact. The expected sandbox UUID participates in the existing mutation-replay fingerprint; same-name replacement and missing-identity cases fail before mutation/relay work, including provider attach revalidation after waiting for the sandbox mutation lock. The CLI retains its prior public helper signatures as wrappers and uses expected-ID helpers when the command has a selected UUID. The eight existing test mocks explicitly return `UNIMPLEMENTED` for all seven identity RPCs, and both production and mocks declare the generated identity-exec stream alias. R4 differs from R3 only by importing `tonic::Code` into the sandbox test module, fixing the first remote test-compilation error without changing production source. A gateway running older RPC definitions should reject the distinct methods as `UNIMPLEMENTED`; that compatibility probe remains a separate qualification item.

The patch is not admitted for profile use. `metadata.json` deliberately remains `candidate-not-qualified`; the CI workflow only supplies source/build/focused-test evidence. Runtime compatibility and physical target-host behavior remain unqualified until their separate probes pass and the profile gate is explicitly reviewed.

## Reproduce the source tree

From the repository root, run:

```sh
workdir="$(mktemp -d "${TMPDIR:-/tmp}/openshell-rt01.XXXXXX")"
scripts/openshell-rt01/fetch-and-apply.sh "$workdir/source"
```

The script fetches the exact upstream commit, refuses a pre-existing destination, checks the patch hash, applies it, and verifies the exact changed-path set and pinned hashes. `source-pins.json` binds the cumulative patch, its R3 parent hash, eighteen changed source files, workspace lock/build inputs, toolchain file and upstream license. Do not update these pins without reviewing the patch and rerunning the qualification workflow.

## Automated qualification route

`.github/workflows/openshell-rt01-qualification.yml` installs Rust `1.95.0` minimal (the upstream manifest requires at least `1.94`), checks formatting, compiles the server and CLI including their generated protobuf code, and runs these exact tests:

- `openshell-server::identity_bound_stop_targets_the_observed_uuid_only`
- `openshell-server::identity_delete_rejects_same_name_replacement_without_deleting_it`
- `openshell-server::identity_delete_requires_an_expected_uuid`
- `openshell-server::identity_policy_update_rejects_same_name_replacement_before_mutation`
- `openshell-server::identity_exec_rejects_same_name_replacement_before_opening_relay`
- `openshell-server::identity_provider_mutations_reject_same_name_replacement`
- `openshell-server::identity_provider_attach_rechecks_name_after_waiting_for_mutation_lock`
- `openshell-cli::sandbox_stop_and_start_accept_optional_names`
- `openshell-cli::sandbox_provider_subcommands_parse`

Build settings disable debug symbols and incremental compilation, cap Cargo at two jobs and Rust test threads at two. Each test name is resolved from Cargo’s test listing, run with `--exact`, and required to produce exactly one passing, non-ignored test result. Formatting and build output are retained with the focused-test logs. The workflow needs read-only repository contents and calls no secrets, model endpoints, gateways, providers or physical hosts. R3 `cargo check` passed, but focused-test compilation failed before test execution; R4 has not yet been compiled remotely. A passing R4 CI run would qualify only the pinned source/build/focused tests; it does not qualify an old-gateway compatibility probe, a running OpenShell deployment, or any physical RT-01 host behavior.

The complete upstream Apache-2.0 license and downstream attribution are in this directory. See `NOTICE.md`.
