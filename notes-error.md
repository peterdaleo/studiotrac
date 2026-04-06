# Error: useChart must be used within a ChartContainer

The error occurs in Home.tsx when the dashboard loads data after seeding. The issue is that `ChartTooltipContent` is used inside a `BarChart` but not wrapped in `ChartContainer`. The recharts Tooltip uses `ChartTooltipContent` which requires the `ChartContainer` context.

Fix: Replace the `ChartTooltip` with a regular recharts `Tooltip` in the bar chart, or wrap charts in `ChartContainer`.
