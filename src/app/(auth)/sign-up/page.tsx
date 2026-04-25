"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Alert,
  Box,
  Button,
  Link as MuiLink,
  Paper,
  Stack,
  TextField,
  Typography,
} from "@mui/material";
import { Logo } from "@/components/Logo";

export default function SignUpPage() {
  const router = useRouter();
  const [email, setEmail] = React.useState("");
  const [password, setPassword] = React.useState("");
  const [name, setName] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    const res = await fetch("/api/auth-extra/sign-up", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password, name }),
    });
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      setError(body.error ?? "Sign-up failed.");
      setLoading(false);
      return;
    }
    router.push("/sign-in");
  }

  return (
    <Paper
      elevation={0}
      component="form"
      onSubmit={handleSubmit}
      sx={{ p: 4, border: 1, borderColor: "divider" }}
    >
      <Stack spacing={3}>
        <Box>
          <Box sx={{ mb: 1.5 }}>
            <Logo size="lg" />
          </Box>
          <Typography variant="body2" color="text.secondary">
            Create your account. New users default to USER role.
          </Typography>
        </Box>

        {error && <Alert severity="error">{error}</Alert>}

        <TextField label="Name" value={name} onChange={(e) => setName(e.target.value)} />
        <TextField
          label="Email"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
        />
        <TextField
          label="Password"
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          inputProps={{ minLength: 6 }}
          required
        />
        <Button type="submit" variant="contained" size="large" disabled={loading}>
          {loading ? "Creating…" : "Create account"}
        </Button>
        <Typography variant="caption" color="text.secondary">
          Already have one?{" "}
          <MuiLink component={Link} href="/sign-in">
            Sign in
          </MuiLink>
        </Typography>
      </Stack>
    </Paper>
  );
}
