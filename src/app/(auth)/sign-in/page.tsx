"use client";

import * as React from "react";
import { signIn } from "next-auth/react";
import { useRouter, useSearchParams } from "next/navigation";
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
import Link from "next/link";
import { Logo } from "@/components/Logo";

export default function SignInPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const callbackUrl = searchParams.get("from") ?? "/listings";

  const [email, setEmail] = React.useState("");
  const [password, setPassword] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    const res = await signIn("credentials", {
      email,
      password,
      redirect: false,
    });
    setLoading(false);
    if (res?.error) {
      setError("Invalid email or password.");
      return;
    }
    router.push(callbackUrl);
    router.refresh();
  }

  return (
    <Paper
      elevation={0}
      component="form"
      onSubmit={handleSubmit}
      sx={{
        p: 4,
        border: 1,
        borderColor: "divider",
        backdropFilter: "blur(6px)",
      }}
    >
      <Stack spacing={3}>
        <Box>
          <Box sx={{ mb: 1.5 }}>
            <Logo size="lg" />
          </Box>
          <Typography variant="body2" color="text.secondary">
            Sign in to score, sort, and reason over MLS opportunities.
          </Typography>
        </Box>

        {error && <Alert severity="error">{error}</Alert>}

        <TextField
          label="Email"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          autoComplete="email"
          required
        />
        <TextField
          label="Password"
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoComplete="current-password"
          required
        />

        <Button type="submit" variant="contained" size="large" disabled={loading}>
          {loading ? "Signing in…" : "Sign in"}
        </Button>

        <Typography variant="caption" color="text.secondary">
          New here?{" "}
          <MuiLink component={Link} href="/sign-up">
            Create an account
          </MuiLink>
        </Typography>
      </Stack>
    </Paper>
  );
}
