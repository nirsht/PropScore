"use client";

import * as React from "react";
import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  LinearProgress,
  Paper,
  Stack,
  Typography,
} from "@mui/material";
import PlayArrowRoundedIcon from "@mui/icons-material/PlayArrowRounded";
import { DataGrid, type GridColDef } from "@mui/x-data-grid";
import {
  Area,
  AreaChart,
  ResponsiveContainer,
  Tooltip as RechartsTooltip,
  XAxis,
  YAxis,
} from "recharts";
import { trpc } from "@/lib/trpc/client";

type SyncRunRow = {
  id: string;
  startedAt: Date;
  finishedAt: Date | null;
  status: "RUNNING" | "SUCCEEDED" | "FAILED";
  recordsUpserted: number;
  recordsScored: number;
  cursorFrom: Date | null;
  cursorTo: Date | null;
  error: string | null;
  progressMessage: string | null;
  progressCurrent: number | null;
  progressTotal: number | null;
  logs: Array<{ ts: string; level: "info" | "warn" | "error"; message: string }> | null;
};

const COLUMNS: GridColDef<SyncRunRow>[] = [
  {
    field: "startedAt",
    headerName: "Started",
    width: 180,
    valueFormatter: (v) => new Date(v as string | Date).toLocaleString(),
  },
  {
    field: "finishedAt",
    headerName: "Finished",
    width: 180,
    valueFormatter: (v) => (v ? new Date(v as string | Date).toLocaleString() : "—"),
  },
  {
    field: "status",
    headerName: "Status",
    width: 120,
    renderCell: ({ value }) => {
      const v = value as SyncRunRow["status"];
      const color =
        v === "SUCCEEDED" ? "success" : v === "RUNNING" ? "info" : "error";
      return <Chip size="small" color={color} label={v} />;
    },
  },
  { field: "recordsUpserted", headerName: "Upserted", type: "number", width: 110 },
  { field: "recordsScored", headerName: "Scored", type: "number", width: 100 },
  {
    field: "cursorFrom",
    headerName: "From",
    width: 180,
    valueFormatter: (v) => (v ? new Date(v as string | Date).toLocaleString() : "—"),
  },
  {
    field: "cursorTo",
    headerName: "To",
    width: 180,
    valueFormatter: (v) => (v ? new Date(v as string | Date).toLocaleString() : "—"),
  },
  { field: "error", headerName: "Error", flex: 1, minWidth: 200 },
];

export function AdminSyncView() {
  const utils = trpc.useUtils();
  const runs = trpc.etl.runs.useQuery({ limit: 50 }, { refetchInterval: 5000 });
  const current = trpc.etl.current.useQuery(undefined, { refetchInterval: 1000 });
  const syncNow = trpc.etl.syncNow.useMutation({
    onSuccess: () => {
      void utils.etl.runs.invalidate();
      void utils.etl.current.invalidate();
    },
  });

  const chartData = (runs.data ?? [])
    .slice()
    .reverse()
    .map((r) => ({
      time: new Date(r.startedAt).toLocaleDateString(),
      upserted: r.recordsUpserted,
    }));

  const liveRun = (current.data as SyncRunRow | null) ?? null;

  return (
    <Stack spacing={3}>
      <Stack direction="row" alignItems="center" spacing={2}>
        <Typography variant="h5">ETL / Sync</Typography>
        {liveRun && (
          <Chip
            color="info"
            size="small"
            icon={<CircularProgress size={12} sx={{ color: "inherit" }} />}
            label={`Sync running since ${new Date(liveRun.startedAt).toLocaleTimeString()}`}
          />
        )}
        <div style={{ flex: 1 }} />
        <Button
          variant="contained"
          startIcon={<PlayArrowRoundedIcon />}
          disabled={syncNow.isPending || !!liveRun}
          onClick={() => syncNow.mutate(undefined)}
        >
          {syncNow.isPending ? "Starting…" : "Sync Now"}
        </Button>
      </Stack>

      {syncNow.error && <Alert severity="error">{syncNow.error.message}</Alert>}

      {/* Live progress + log panel */}
      {liveRun && <LiveRunPanel run={liveRun} />}

      <Paper variant="outlined" sx={{ p: 2 }}>
        <Typography variant="subtitle2" gutterBottom>
          Records upserted per run
        </Typography>
        <ResponsiveContainer width="100%" height={180}>
          <AreaChart data={chartData}>
            <defs>
              <linearGradient id="ups" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#7c5cff" stopOpacity={0.6} />
                <stop offset="100%" stopColor="#7c5cff" stopOpacity={0} />
              </linearGradient>
            </defs>
            <XAxis
              dataKey="time"
              tick={{ fontSize: 11, fill: "var(--mui-palette-text-secondary)" }}
            />
            <YAxis tick={{ fontSize: 11, fill: "var(--mui-palette-text-secondary)" }} />
            <RechartsTooltip
              contentStyle={{
                background: "var(--mui-palette-background-paper)",
                border: "1px solid var(--mui-palette-divider)",
                borderRadius: 8,
                fontSize: 12,
                boxShadow: "0 8px 24px rgba(0,0,0,0.35)",
                color: "var(--mui-palette-text-primary)",
              }}
              labelStyle={{ color: "var(--mui-palette-text-primary)", fontWeight: 600 }}
              itemStyle={{ color: "var(--mui-palette-text-secondary)" }}
              cursor={{ fill: "rgba(255,255,255,0.04)" }}
            />
            <Area
              type="monotone"
              dataKey="upserted"
              stroke="#7c5cff"
              fillOpacity={1}
              fill="url(#ups)"
            />
          </AreaChart>
        </ResponsiveContainer>
      </Paper>

      {/* Most-recent finished run logs (when no live run) */}
      {!liveRun && runs.data?.[0]?.logs && Array.isArray(runs.data[0].logs) && (
        <Paper variant="outlined" sx={{ p: 2 }}>
          <Typography variant="subtitle2" sx={{ mb: 1 }}>
            Last run logs
          </Typography>
          <LogConsole
            logs={
              (runs.data[0].logs as SyncRunRow["logs"]) ?? []
            }
          />
        </Paper>
      )}

      <Paper variant="outlined" sx={{ height: 540 }}>
        <DataGrid<SyncRunRow>
          rows={(runs.data ?? []) as SyncRunRow[]}
          columns={COLUMNS}
          getRowId={(r) => r.id}
          density="compact"
          loading={runs.isLoading}
          disableRowSelectionOnClick
          sx={{ border: 0 }}
        />
      </Paper>
    </Stack>
  );
}

function LiveRunPanel({ run }: { run: SyncRunRow }) {
  const logs = Array.isArray(run.logs) ? run.logs : [];

  return (
    <Paper variant="outlined" sx={{ p: 2 }}>
      <Stack direction="row" spacing={2} alignItems="center" sx={{ mb: 1.5 }}>
        <CircularProgress size={16} />
        <Typography variant="subtitle2">In progress</Typography>
        <Box sx={{ flex: 1 }} />
        <Typography variant="caption" color="text.secondary">
          {run.progressCurrent ?? 0} upserted
        </Typography>
      </Stack>

      <LinearProgress
        variant={run.progressTotal ? "determinate" : "indeterminate"}
        value={
          run.progressTotal && run.progressCurrent
            ? Math.min(100, (run.progressCurrent / run.progressTotal) * 100)
            : undefined
        }
        sx={{ borderRadius: 1, height: 6, mb: 1.5 }}
      />

      {run.progressMessage && (
        <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
          {run.progressMessage}
        </Typography>
      )}

      <LogConsole logs={logs} autoScroll />
    </Paper>
  );
}

function LogConsole({
  logs,
  autoScroll = false,
}: {
  logs: Array<{ ts: string; level: "info" | "warn" | "error"; message: string }>;
  autoScroll?: boolean;
}) {
  const ref = React.useRef<HTMLDivElement>(null);
  React.useEffect(() => {
    if (autoScroll && ref.current) {
      ref.current.scrollTop = ref.current.scrollHeight;
    }
  }, [logs, autoScroll]);

  if (!logs.length) {
    return (
      <Typography variant="body2" color="text.secondary">
        Waiting for output…
      </Typography>
    );
  }

  return (
    <Box
      ref={ref}
      sx={{
        bgcolor: "background.default",
        border: 1,
        borderColor: "divider",
        borderRadius: 1.5,
        p: 1.5,
        maxHeight: 280,
        overflowY: "auto",
        fontFamily:
          'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, "Liberation Mono", monospace',
        fontSize: 12,
        lineHeight: 1.55,
      }}
    >
      {logs.map((entry, i) => {
        const color =
          entry.level === "error"
            ? "#ff6b8a"
            : entry.level === "warn"
            ? "#ffb86b"
            : "var(--mui-palette-text-secondary)";
        const ts = new Date(entry.ts).toLocaleTimeString();
        return (
          <Box key={i} sx={{ display: "flex", gap: 1.5 }}>
            <Box component="span" sx={{ color: "text.secondary", flexShrink: 0 }}>
              {ts}
            </Box>
            <Box component="span" sx={{ color, whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
              {entry.message}
            </Box>
          </Box>
        );
      })}
    </Box>
  );
}
