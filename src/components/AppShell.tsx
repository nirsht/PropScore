"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { signOut } from "next-auth/react";
import {
  AppBar,
  Box,
  Button,
  Container,
  IconButton,
  Stack,
  Toolbar,
  Tooltip,
  Typography,
} from "@mui/material";
import LogoutOutlinedIcon from "@mui/icons-material/LogoutOutlined";
import TableRowsRoundedIcon from "@mui/icons-material/TableRowsRounded";
import MapOutlinedIcon from "@mui/icons-material/MapOutlined";
import SettingsOutlinedIcon from "@mui/icons-material/SettingsOutlined";
import { Logo } from "./Logo";

const NAV = [
  { href: "/listings", label: "Opportunities", icon: TableRowsRoundedIcon },
  { href: "/map", label: "Map", icon: MapOutlinedIcon },
  { href: "/admin/sync", label: "Admin", icon: SettingsOutlinedIcon },
];

type Props = {
  children: React.ReactNode;
  userEmail: string;
};

export function AppShell({ children, userEmail }: Props) {
  const pathname = usePathname();

  return (
    <Box sx={{ minHeight: "100vh", bgcolor: "background.default" }}>
      <AppBar
        position="sticky"
        elevation={0}
        sx={{
          bgcolor: "background.paper",
          color: "text.primary",
          borderBottom: 1,
          borderColor: "divider",
        }}
      >
        <Toolbar sx={{ gap: 2 }}>
          <Box
            component={Link}
            href="/listings"
            sx={{ textDecoration: "none", display: "inline-flex", alignItems: "center", mr: 1 }}
          >
            <Logo size="md" />
          </Box>

          <Stack direction="row" spacing={0.5}>
            {NAV.map((item) => {
              const active = pathname?.startsWith(item.href);
              const Icon = item.icon;
              return (
                <Button
                  key={item.href}
                  component={Link}
                  href={item.href}
                  size="small"
                  startIcon={<Icon fontSize="small" />}
                  variant={active ? "contained" : "text"}
                  color={active ? "primary" : "inherit"}
                >
                  {item.label}
                </Button>
              );
            })}
          </Stack>

          <Box sx={{ flex: 1 }} />

          <Stack direction="row" spacing={1} alignItems="center">
            <Typography variant="body2" color="text.secondary">
              {userEmail}
            </Typography>
            <Tooltip title="Sign out">
              <IconButton size="small" onClick={() => signOut({ callbackUrl: "/sign-in" })}>
                <LogoutOutlinedIcon fontSize="small" />
              </IconButton>
            </Tooltip>
          </Stack>
        </Toolbar>
      </AppBar>

      <Container maxWidth={false} sx={{ py: 3, px: { xs: 2, md: 3 } }}>
        {children}
      </Container>
    </Box>
  );
}
