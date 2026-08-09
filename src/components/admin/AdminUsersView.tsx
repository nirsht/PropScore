"use client";

import * as React from "react";
import {
  Alert,
  Box,
  Button,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  MenuItem,
  Stack,
  TextField,
  Typography,
} from "@mui/material";
import PersonAddAlt1RoundedIcon from "@mui/icons-material/PersonAddAlt1Rounded";
import { DataGrid, type GridColDef } from "@mui/x-data-grid";
import { trpc } from "@/lib/trpc/client";

type Role = "USER" | "ADMIN";

type UserRow = {
  id: string;
  email: string;
  name: string | null;
  role: Role;
  createdAt: Date;
  gmailConnected: boolean;
  threadCount: number;
};

export function AdminUsersView() {
  const utils = trpc.useUtils();
  const users = trpc.admin.listUsers.useQuery();
  const [dialogOpen, setDialogOpen] = React.useState(false);

  const columns: GridColDef<UserRow>[] = [
    { field: "email", headerName: "Email", flex: 1, minWidth: 220 },
    { field: "name", headerName: "Name", width: 180, valueFormatter: (v) => v || "—" },
    {
      field: "role",
      headerName: "Role",
      width: 160,
      renderCell: (params) => <RoleCell row={params.row} />,
    },
    {
      field: "gmailConnected",
      headerName: "Gmail",
      width: 110,
      renderCell: (params) =>
        params.row.gmailConnected ? (
          <Chip size="small" color="success" label="connected" />
        ) : (
          <Chip size="small" variant="outlined" label="—" />
        ),
    },
    { field: "threadCount", headerName: "Outreach", width: 100, type: "number" },
    {
      field: "createdAt",
      headerName: "Created",
      width: 160,
      valueFormatter: (v) => new Date(v as string | Date).toLocaleDateString(),
    },
    {
      field: "actions",
      headerName: "",
      width: 150,
      sortable: false,
      filterable: false,
      renderCell: (params) => <ResetPasswordButton userId={params.row.id} />,
    },
  ];

  return (
    <Stack spacing={2}>
      <Stack direction="row" alignItems="center" justifyContent="space-between">
        <Box>
          <Typography variant="h5" sx={{ fontWeight: 600 }}>
            Users
          </Typography>
          <Typography variant="body2" color="text.secondary">
            Create and manage the team. New users sign in with the email and
            password you set here.
          </Typography>
        </Box>
        <Button
          variant="contained"
          startIcon={<PersonAddAlt1RoundedIcon />}
          onClick={() => setDialogOpen(true)}
        >
          Add user
        </Button>
      </Stack>

      <Box sx={{ height: 560, width: "100%" }}>
        <DataGrid
          rows={users.data ?? []}
          columns={columns}
          loading={users.isLoading}
          disableRowSelectionOnClick
          initialState={{
            pagination: { paginationModel: { pageSize: 25 } },
          }}
          pageSizeOptions={[25, 50, 100]}
        />
      </Box>

      <AddUserDialog
        open={dialogOpen}
        onClose={() => setDialogOpen(false)}
        onCreated={() => {
          void utils.admin.listUsers.invalidate();
          setDialogOpen(false);
        }}
      />
    </Stack>
  );
}

function RoleCell({ row }: { row: UserRow }) {
  const utils = trpc.useUtils();
  const setRole = trpc.admin.setRole.useMutation({
    onSuccess: () => void utils.admin.listUsers.invalidate(),
  });
  return (
    <TextField
      select
      size="small"
      value={row.role}
      disabled={setRole.isPending}
      onChange={(e) =>
        setRole.mutate({ userId: row.id, role: e.target.value as Role })
      }
      variant="standard"
      sx={{ minWidth: 100 }}
    >
      <MenuItem value="USER">User</MenuItem>
      <MenuItem value="ADMIN">Admin</MenuItem>
    </TextField>
  );
}

function ResetPasswordButton({ userId }: { userId: string }) {
  const [open, setOpen] = React.useState(false);
  const [password, setPassword] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);
  const reset = trpc.admin.resetPassword.useMutation({
    onSuccess: () => {
      setOpen(false);
      setPassword("");
      setError(null);
    },
    onError: (e) => setError(e.message),
  });
  return (
    <>
      <Button size="small" onClick={() => setOpen(true)}>
        Reset password
      </Button>
      <Dialog open={open} onClose={() => setOpen(false)}>
        <DialogTitle>Reset password</DialogTitle>
        <DialogContent sx={{ minWidth: 320 }}>
          {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
          <TextField
            autoFocus
            fullWidth
            type="password"
            label="New password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            helperText="At least 6 characters"
            sx={{ mt: 1 }}
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setOpen(false)}>Cancel</Button>
          <Button
            variant="contained"
            disabled={password.length < 6 || reset.isPending}
            onClick={() => reset.mutate({ userId, password })}
          >
            Save
          </Button>
        </DialogActions>
      </Dialog>
    </>
  );
}

function AddUserDialog({
  open,
  onClose,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: () => void;
}) {
  const [email, setEmail] = React.useState("");
  const [name, setName] = React.useState("");
  const [password, setPassword] = React.useState("");
  const [role, setRole] = React.useState<Role>("USER");
  const [error, setError] = React.useState<string | null>(null);

  const create = trpc.admin.createUser.useMutation({
    onSuccess: () => {
      setEmail("");
      setName("");
      setPassword("");
      setRole("USER");
      setError(null);
      onCreated();
    },
    onError: (e) => setError(e.message),
  });

  const emailValid = /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email);
  const canSubmit = emailValid && password.length >= 6 && !create.isPending;

  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="xs">
      <DialogTitle>Add user</DialogTitle>
      <DialogContent>
        {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
        <Stack spacing={2} sx={{ mt: 1 }}>
          <TextField
            autoFocus
            fullWidth
            type="email"
            label="Email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
          <TextField
            fullWidth
            label="Name (optional)"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
          <TextField
            fullWidth
            type="password"
            label="Password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            helperText="At least 6 characters"
          />
          <TextField
            select
            fullWidth
            label="Role"
            value={role}
            onChange={(e) => setRole(e.target.value as Role)}
          >
            <MenuItem value="USER">User</MenuItem>
            <MenuItem value="ADMIN">Admin</MenuItem>
          </TextField>
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Cancel</Button>
        <Button
          variant="contained"
          disabled={!canSubmit}
          onClick={() =>
            create.mutate({
              email,
              password,
              name: name.trim() || undefined,
              role,
            })
          }
        >
          {create.isPending ? "Creating…" : "Create user"}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
