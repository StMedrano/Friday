# NVIDIA readiness without generation

Run from a private development checkout as the owner of the user-configured key file:

```sh
FRIDAY_NVIDIA_ALLOW_CATALOG_CHECK=yes \
FRIDAY_NVIDIA_SMOKE_MODEL=<operator-selected-vendor/model> \
npm run check:nvidia-catalog
```

The key stays in `~/.config/friday/nvidia-api.key`, outside Git. The check requires an owner-private regular file, validates its contents without printing them, and sends one GET to `https://integrate.api.nvidia.com/v1/models`. It refuses redirects and uses a 15-second network timeout. It sends no prompt, performs no retry, and changes no runtime settings. CI tests use synthetic files and responses.

The JSON output contains only readiness, a reason, the validated selected model on success, a bounded failure classification and `inferenceTested:false`. Exit status is 0 on catalog-model availability or 2 on any failed check. Do not interpret catalog success as credential authentication proof: the endpoint may expose a public catalog. It does not establish generation, billing eligibility, agent readiness or group authorization.

The older command without `--catalog` remains the single inference probe. It requires separate `FRIDAY_NVIDIA_ALLOW_ONE_LIVE_TEST=yes` and `FRIDAY_NVIDIA_VERIFIED_FREE=yes` guards plus a selected model. Do not assert those guards without evidence of the account's current terms. Group membership never activates NVIDIA inference or executable tools.

On 2026-10-14, the first read-only live check reported `model-unavailable` for `meta/llama-3.1-8b-instruct`. The private key file was present; no inference request occurred. Verify a currently advertised model before repeating the check. Production and staging were untouched.
