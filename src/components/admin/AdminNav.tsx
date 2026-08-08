"use client";

import * as React from "react";
import { usePathname } from "next/navigation";
import Link from "next/link";
import { Tabs, Tab, Box } from "@mui/material";

const TABS = [
  { href: "/admin/sync", label: "MLS Sync" },
  { href: "/admin/users", label: "Users" },
];

export function AdminNav() {
  const pathname = usePathname();
  const active =
    TABS.find((t) => pathname?.startsWith(t.href))?.href ?? "/admin/sync";
  return (
    <Box sx={{ borderBottom: 1, borderColor: "divider", mb: 2 }}>
      <Tabs value={active}>
        {TABS.map((t) => (
          <Tab
            key={t.href}
            value={t.href}
            label={t.label}
            component={Link}
            href={t.href}
          />
        ))}
      </Tabs>
    </Box>
  );
}
