# Security Model

The ADLC harness uses a three-tier defence-in-depth approach to sandbox agent execution.

## Tier 3 — Bash Command Denylist (implemented)

`src/hooks/security.ts` provides two hooks registered on the `PreToolUse` event.

### `bashSecurityHook`

A pattern-matching denylist that blocks obviously destructive or malicious commands before they reach the shell. Categories covered:

- **Filesystem destruction** — `rm -rf /`, `rm -rf ~`, `chmod -R 777 /`, writes to `/dev/sda` / `/dev/nvme`, etc.
- **Network exfiltration** — shell-piped downloads (`curl … | sh`, `wget … | bash`), netcat listeners (`nc -l`), reverse-shell tools (`ncat`, `socat`).
- **Privilege escalation** — `sudo`, `su -`, `doas`, setuid bits (`chmod u+s`, `chmod +s`).
- **Process / system manipulation** — `kill -9 1`, `killall`, `pkill`, `reboot`, `systemctl stop`, `service stop`.
- **Crypto mining / malware** — `xmrig`, `minerd`, `cryptonight`.

Hook returns `{ continue: false }` to abort the tool call when any pattern is matched.

### `createFileSystemBoundaryHook(projectDir)`

Restricts file-system writes to within `projectDir`:

- **Write / Edit tools** — resolves `file_path` with `path.resolve` and verifies it starts with the resolved `projectDir`. Blocks `../` traversal and absolute paths outside the project.
- **Bash tool** — best-effort detection of `cd` to absolute paths outside `projectDir`.

## Tier 2 — Per-Agent Tool Permissions (implemented)

`src/hooks/permissions.ts` defines the minimum tool set for each agent role:

| Agent       | Read | Write | Edit | Bash | Glob | Grep | Notes                                  |
|-------------|------|-------|------|------|------|------|----------------------------------------|
| initializer | ✓    | ✓     |      | ✓    | ✓    | ✓    | Setup: reads spec, writes plan files   |
| planner     | ✓    | ✓     |      |      | ✓    | ✓    | No code execution — spec → plan only   |
| generator   | ✓    | ✓     | ✓    | ✓    | ✓    | ✓    | Full access for feature implementation |
| evaluator   | ✓    |       |      | ✓    | ✓    | ✓    | Read-only + Bash for test runner       |
| coding      | ✓    | ✓     | ✓    | ✓    | ✓    | ✓    | Same as generator                      |

Call `getAllowedTools(agentType)` to retrieve the tool list and pass it to `AgentSessionOptions.allowedTools`. Note: this helper is available but not yet wired into agent session runners — individual agents currently hardcode their `allowedTools` arrays. Future PRs should migrate agents to use this centralized helper.

## Tier 1 — OS-Level Sandbox (informational — not yet implemented)

OS-level sandboxing provides the strongest isolation guarantee because it is enforced by the kernel rather than application code.

### macOS — `sandbox-exec`

macOS ships with the `sandbox-exec` command that applies an SBPL (Sandbox Profile Language) policy to a process tree.

Example minimal policy for file read-only + no network:

```scheme
(version 1)
(deny default)
(allow process-exec)
(allow file-read* (subpath "/usr/lib") (subpath "/usr/share") (subpath "/private/tmp"))
(allow file-read-write* (subpath "/path/to/project"))
(deny network*)
```

Run the agent process under the profile:

```sh
sandbox-exec -f agent.sb bun run src/orchestrator.ts
```

Limitations:

- `sandbox-exec` is deprecated as a public API on recent macOS but still functional.
- The `(subpath …)` rules require absolute paths; they do not expand environment variables.
- Apple's TCC framework controls camera/microphone/contacts independently.

### Linux — Namespaces + seccomp

Two complementary mechanisms are available:

**User namespaces + bind mounts** — run the agent in a new mount namespace with only the project directory visible:

```sh
unshare --mount --user --pid --fork \
  bash -c "
    mount --bind /path/to/project /project
    mount --make-rprivate /
    exec bun run src/orchestrator.ts
  "
```

**seccomp-bpf** — filter the syscall surface. A typical allowlist for a Node/Bun process covers `read`, `write`, `open`, `close`, `stat`, `mmap`, `brk`, `exit_group`, and a small number of others. Use `libseccomp` or the [`seccomp`](https://github.com/nicowillis/seccomp) npm package to generate and load a BPF filter.

```ts
// Illustrative — not currently wired in
import { SeccompFilter, Action, Syscall } from "seccomp";

const filter = new SeccompFilter(Action.ERRNO(1)); // default: EPERM
filter.addRule(Action.ALLOW, Syscall.READ);
filter.addRule(Action.ALLOW, Syscall.WRITE);
// … add remaining required syscalls …
filter.load();
```

**bubblewrap (`bwrap`)** — a setuid helper that combines namespaces for rootless container-like isolation:

```sh
bwrap \
  --ro-bind /usr /usr \
  --ro-bind /lib /lib \
  --bind /path/to/project /project \
  --unshare-net \
  --chdir /project \
  bun run src/orchestrator.ts
```

### Recommendations for Future Implementation

1. Wrap each agent `runAgentSession` call in a `bwrap` invocation on Linux or a `sandbox-exec` call on macOS.
2. Pass the `projectDir` as the only read-write bind mount.
3. Combine with `--unshare-net` (Linux) or `(deny network*)` (macOS) unless the agent explicitly needs network access.
4. Use seccomp to further restrict the syscall surface on Linux CI runners.
