# HTTP API

This is the backend-specific transport protocol of `geoxplain-aurora-adapter`; it is not part of the GeoXplain viewer contract. The Aurora client normally handles it. Use the endpoints directly only when implementing another client or operating the listener.

All request and status bodies are JSON. Completed results are msgpack payloads returned as `application/octet-stream`.

## Endpoints

| Method and path | Success | Purpose |
| --- | --- | --- |
| `POST /run` | `202 {"job_id": "..."}` | Submit one target. |
| `POST /run_batch` | `202 {"job_id": "..."}` | Submit multiple explicit targets. |
| `POST /overlay` | `202 {"job_id": "..."}` | Submit an ERA5 overlay pull. |
| `GET /jobs/{job_id}` | `200` JSON | Poll queue, progress, or error state. |
| `GET /jobs/{job_id}/result` | `200` bytes | Fetch a completed packed result. |
| `GET /health` | `200` JSON | Inspect backend mode and health. |

## Single-target request

```json
{
  "method": "ig",
  "target": {
    "var": "q",
    "level": 850,
    "mode": "point",
    "timestamp": "2024-03-20T00:00:00Z",
    "lat": 46.2,
    "lon": 8.8,
    "size": null
  },
  "input_vars": ["t", "q", "z"],
  "options": {
    "n_steps": 32,
    "baseline_sigma_deg": 2.5
  }
}
```

Supported method identifiers are `saliency`, `ig`, `rise`, and `vit_cx`. Method-specific options are the same as the corresponding Python functions.

## Batch request

```json
{
  "method": "saliency",
  "targets": [
    {"var": "q", "level": 850, "mode": "point", "timestamp": "2024-03-20T00:00:00Z", "lat": 46.2, "lon": 8.8, "size": null},
    {"var": "q", "level": 850, "mode": "point", "timestamp": "2024-03-20T06:00:00Z", "lat": 46.2, "lon": 8.8, "size": null}
  ],
  "input_vars": ["t", "q", "z"],
  "options": {}
}
```

## Overlay request

```json
{
  "variable": "q",
  "timestamps": ["2024-03-20T00:00:00Z"],
  "level": 850,
  "options": {
    "name": "Specific humidity 850 hPa",
    "unit": "kg/kg",
    "colormap": "viridis",
    "visible": true
  }
}
```

## Job status

The status body contains `job_id`, `status`, `eta_s`, `progress`, `text_output`, and `log_tail`. It may include `result_url` when done or `error_message` on failure.

Possible states in the implementation are `queued`, `queued_locally`, `running`, `completing`, `done`, and `error`. Treat `completing` as still in flight: the SLURM process has ended but its result file may not yet be visible.

The result endpoint returns `404` for an unknown job and `409` when a known job is not ready.

## Health response

```json
{
  "mode": "sbatch-persistent",
  "model_warm": true,
  "queue_depth": 0,
  "sbatch_config": {}
}
```

The `sbatch_config` field is omitted when the backend has no SLURM configuration.

!!! note "FastAPI schema scope"

    The current routes accept untyped dictionaries and validate them through the adapter's protocol dataclasses. FastAPI therefore exposes the routes in its generated OpenAPI document, but the detailed request-body fields are defined by the protocol module and summarized above.
