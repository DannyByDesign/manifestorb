# Fast-Path SLA Dashboard Spec

## Purpose
Operational dashboard for fast-path reliability and latency.

Primary questions:
1. Is fast-path meeting latency SLOs?
2. Are fast-path turns falling back too often?
3. Are failures provider-specific (Google vs Microsoft)?

## Telemetry Source
- Event: `openworld.runtime.fast_path`
- Event: `openworld.turn.completed` (contextual correlation only)

## Required Dimensions
- `mode` (`strict` | `recovery`)
- `reason` (operation reason)
- `toolName`
- `decision`
- `outcome`
- `fallbackCause`
- `provider`

## Panels

### 1) Fast-Path Latency by Operation
- Metric: `latencyMs`
- Filter: `decision=executed`, `outcome=success`
- Group by: `reason`
- Aggregates: p50, p95, p99
- Time windows: 15m, 1h, 24h

### 2) Fast-Path Fallback Rate
- Numerator: count of `decision=fallback`
- Denominator: count of (`decision=selected` + `decision=executed` + `decision=fallback`)
- Group by: `reason`
- Display: percentage + trend

### 3) Fallback Cause Breakdown
- Metric: count of `decision=fallback`
- Group by: `fallbackCause`
- Filters: all, per `reason`, per `provider`

### 4) Provider Latency Split
- Metric: p50/p95/p99 `latencyMs`
- Filter: `decision=executed`, `outcome=success`
- Group by: `provider`, then `reason`

### 5) Provider Fallback Split
- Metric: fallback rate
- Group by: `provider`, then `fallbackCause`

## Alert Thresholds (Initial)
1. Fast-path latency regression:
- Condition: p95 latency > 3000ms for 10m
- Scope: top high-volume `reason` values

2. Fallback spike:
- Condition: fallback rate > 5% for 15m
- Scope: global + per provider

3. Provider degradation:
- Condition: provider fallback rate > 2x trailing 7d baseline
- Scope: Google/Microsoft separately

## Investigation Runbook
1. Check top `reason` by p95 latency.
2. Check `fallbackCause` concentration.
3. Compare provider split for same `reason`.
4. Inspect recent deploy/runtime changes around spike window.

## Acceptance Criteria
- Dashboard can show p50/p95/p99 latency by operation reason.
- Dashboard can show fallback causes and rates.
- Dashboard can isolate provider-specific regressions.
