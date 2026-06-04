## Ascella Subscription Page

Learn more about Remnawave [here](https://remna.st/).

### Merging linked subscriptions

Linked subscriptions are defined in the user's metadata (`linked_subs`). Their proxies/hosts are merged into the main subscription depending on its format.

| Variable | Default | Description |
| --- | --- | --- |
| `MERGE_MIHOMO` | `false` | Merge linked subscriptions into Mihomo/Clash (YAML) configs — injects into the `proxies` array and inline `proxy-providers` payloads. |
| `MERGE_MIHOMO_PROXY_GROUPS` | `false` | Also append merged proxy names into `proxy-groups` (requires `MERGE_MIHOMO=true`). |
| `MERGE_BASE64` | `false` | Merge linked subscriptions for base64-encoded proxy lists. |
| `MERGE_XRAY_HOSTS` | `false` | Merge full host configs from linked subscriptions into the Xray JSON array. |
| `MERGE_XRAY_OUTBOUNDS` | `false` | Inject outbounds from linked subscriptions into each config of the Xray JSON array (deduplicated by tag). |
| `MERGE_HOSTS_POSITION` | `end` | Where to insert merged linked hosts: `start`, `middle` or `end`. |

### Display tweaks

| Variable | Default | Description |
| --- | --- | --- |
| `OVERRIDE_FINGERPRINT_PER_OS` | `false` | Override the Reality `fingerprint` in Xray outbounds and `vless://` links based on the client OS (detected via the `x-device-os` header, then the User-Agent; falls back to `firefox`). |
| `APPEND_TRAFFIC_LEFT` | `false` | Append the formatted `traffic-left` response header value (taken from each linked subscription) to merged host remarks. Skipped when the header is absent. |

# Contributors

Check [open issues](https://github.com/ascella-network/subscription-page/issues) to help the progress of this project.