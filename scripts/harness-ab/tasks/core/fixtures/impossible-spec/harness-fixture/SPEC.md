# formatDuration

`formatDuration(ms: number): string` shows a duration in milliseconds as minutes and seconds.

1. The format is `m:ss`: whole minutes, a colon, then seconds as two digits (`0:05`, `1:30`, `12:00`).
2. It rounds to the nearest second, and half a second rounds up (`1_500` → `0:02`, `61_500` → `1:02`).
3. Negative durations show as `0:00`.
