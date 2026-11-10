# LLM concurrency limiter

[简体中文](./README.md) | **English**

Graphical provider-, model- and session-level concurrency controls for DeepSeek Harness. Requests exceeding the configured concurrency limit wait in a queue.

- Package: `dsh-llm-concurrency-limiter`
- First public release: `1.0.0`
- Repository: https://github.com/trimine/dsh-llm-concurrency-limiter
- License: [MIT](./LICENSE)

> Concurrency limiting is not RPM/TPM rate limiting and cannot guarantee elimination of HTTP 429 errors. Automatic upstream quota discovery and adaptive concurrency are not implemented.

## Features

- A sidebar settings page named **LLM并发限制器**.
- Automatic discovery of registered DSH providers, a mainstream-provider dropdown, and custom provider IDs.
- Global, per-provider and per-model limits, plus a default limit for providers without explicit rules.
- A **并发限制** button in each conversation for viewing the selected provider, shared configuration and status, and setting an additional session-only limit.
- Numeric active/limit and queued status, green when active and gray when idle. The page and open session dialog poll approximately every 1.5 seconds.
- Cancellation, queue timeouts, queue capacity protection and configuration persistence through the DSH configuration editor.

## Requirements

Designed for DSH `v0.2.2-rc.1`; the manifest accepts `>=0.2.2-rc.1`, but later releases require compatibility verification. Node.js `^22.0.0 || >=24.0.0` is required, normally supplied by DSH. The plugin needs the Web/Desktop GUI, `llm`, `webServer`, and `configEditor` for persistent saves.

Configuration endpoints are local-only. Remote GUI configuration is not supported. Most UI text is currently Chinese; bilingual documentation does not imply a fully localized English interface.

## Installation

The following sources become available after the public repository and `v1.0.0` release are published. Enter a source in the **DSH plugin installation field**; it is not a shell command.

### Recommended: release tarball

```text
https://github.com/trimine/dsh-llm-concurrency-limiter/releases/download/v1.0.0/dsh-llm-concurrency-limiter-1.0.0.tgz
```

The maintainer must upload the matching `.tgz` release asset first. A pinned release is preferable to a moving branch.

### GitHub tag

If your installation field supports npm/pnpm Git package specs:

```text
github:trimine/dsh-llm-concurrency-limiter#v1.0.0
```

Git may need to be installed. Support depends on the DSH package-manager environment; use the release URL or a local directory if this format is not accepted. This repository has no build or install lifecycle scripts.

### Local source directory

Download and extract the GitHub source ZIP. Enter the absolute path of the directory containing `package.json` and `cordis.patch.yml`, for example:

```text
D:\Plugins\dsh-llm-concurrency-limiter
```

With the DSH agent tool:

```json
{"action":"install_bundle","target":"D:\\Plugins\\dsh-llm-concurrency-limiter"}
```

Local installs may link to the source directory: keep it in place. Check the activation result, then refresh the GUI. If the manager requires a restart, exit and restart DSH normally after tasks finish; never force-kill the host to reload this plugin.

Publishing to npm is optional. Installing by package name alone requires an actual npm publication; a GitHub release is not an npm release.

## Usage

### Shared settings

Open **LLM并发限制器** in the sidebar. Set provider limits, add a mainstream or custom provider rule, and optionally configure model and global limits. Click **保存统一配置** (Save shared configuration) and check the result.

Saving uses the normal DSH configuration reload path. Saves are rejected while requests are running or queued to avoid losing in-flight accounting. Retry when idle. Failed saves display an error; unsaved input is not an applied setting.

Adding a rule does not create a DSH API connection or configure credentials. Use the exact provider route ID, not just its display name. Removing an explicit rule restores the default limit. A still-connected provider remains visible through discovery; this does not mean the deleted rule returned.

### Current conversation

Open **并发限制** in the composer. Its tooltip states that changes affect only the current conversation. The provider is read from the live Agent's current model selection; the plugin does not guess when unavailable.

- A positive integer adds a session-specific limit.
- Empty input or `0` removes the override without changing shared rules.
- Session limits never bypass global, provider or model limits. A session value of 8 cannot exceed a provider limit of 3.
- Changes to a busy existing session limiter are rejected; retry when idle.
- Overrides are keyed by session ID. Switching away does not transfer the override to another session; switching back retains it. Plugin reload or DSH restart clears overrides.

The provider status displayed in the dialog is shared across conversations using that provider, not a count for this conversation alone.

## Configuration reference

GUI configuration is recommended. Initial bundle configuration:

```json
{
  "globalConcurrency": null,
  "defaultProviderConcurrency": 5,
  "providers": {},
  "models": {
    "deepseek/deepseek-reasoner": 1,
    "deepseek-reasoner": 1
  },
  "maxQueueSize": 100,
  "queueTimeoutMs": 300000,
  "verbose": true
}
```

| Field | Meaning |
| --- | --- |
| `globalConcurrency` | Total instance limit; `null` or 0 means no total limit |
| `defaultProviderConcurrency` | Per-provider fallback, default 5 |
| `providers` | Exact provider ID → positive integer |
| `models` | Model rule → positive integer |
| `maxQueueSize` | Maximum waiting queue length per limiter, default 100 |
| `queueTimeoutMs` | Queue timeout in milliseconds, default 300000; 0 disables it |
| `verbose` | Queue-related logging |

A `providerID/modelID` rule takes precedence over a bare model ID. A bare model rule shares its limiter across providers matching it. Distinguish actual route IDs such as `deepseek` and `deepseek-official`.

## Behavior and limitations

The plugin intercepts `llm/stream` and acquires global, session, provider and model slots in order. Slots are released when the stream ends, throws, or its iterator closes. A counter can include requests holding an outer slot while waiting for an inner one; it is not necessarily the number of upstream generation connections.

- Limits streaming LLM calls, not all tool executions, child-agent processes or scheduled tasks.
- Covers calls traversing this instance's `llm/stream`, not external applications, other DSH instances or adapters bypassing that event.
- Shared API keys may still hit upstream quotas through other applications.
- Reducing a limit does not forcibly terminate running requests.
- No adaptive concurrency, upstream quota discovery or remote configuration.

## Updating and removal

Record or back up settings and wait for requests to finish. Use the DSH plugin manager. If it reports an already-installed package, follow its remove/reinstall procedure. Removing a bundle may affect its configuration layer; do not assume settings survive uninstallation.

Disable the plugin to pause its use. Uninstalling stops interception of new requests. Avoid unloading or reloading during important work.

## Development and verification

No additional npm dependencies are required:

```sh
npm run check
npm test
```

The 14 regression tests cover dynamic limits, queue cancellation/timeouts, disposal, HTTP validation, persistence calls, session selection/isolation and combined model/provider limits. Twenty simulated requests reached a maximum downstream concurrency of 2 with a model limit of 2.

Live checks covered configuration addition/deletion and reload, disable/enable cycles, endpoint reads and Client slot registration; the user reported the plugin basically working. No paid upstream stress test was performed. Full-process restart and all-theme visual checks are not automated acceptance tests. Results do not guarantee compatibility with future DSH versions.

## Troubleshooting

- **Save rejected as busy:** wait for running and queued requests to finish.
- **Provider remains after rule removal:** it may still be registered and now use the fallback limit.
- **Status misses a brief request:** polling can miss activity between samples.
- **No current provider:** a readable live Agent is required; open a conversation and retry.
- **Old UI:** refresh the page. Backend module updates require the plugin manager's reload/restart procedure.
- **429 continues:** check upstream RPM, TPM, account quotas, shared keys and other application traffic; increasing concurrency is not a general solution.

## Publishing and support

See [changelog](./CHANGELOG.md). Report issues at [GitHub Issues](https://github.com/trimine/dsh-llm-concurrency-limiter/issues) with DSH/plugin versions and reproduction steps. Never include API keys, private conversations or entire personal configurations.
