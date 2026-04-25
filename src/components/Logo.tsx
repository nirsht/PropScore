"use client";

import { Box, Stack, Typography } from "@mui/material";

type Size = "sm" | "md" | "lg";

const SIZE: Record<Size, { mark: number; word: string }> = {
  sm: { mark: 22, word: "1.05rem" },
  md: { mark: 28, word: "1.25rem" },
  lg: { mark: 40, word: "1.75rem" },
};

export function LogoMark({ size = 28 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
    >
      <defs>
        <linearGradient id="ps-bg" x1="0" y1="0" x2="32" y2="32" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#7c5cff" />
          <stop offset="100%" stopColor="#5236d4" />
        </linearGradient>
      </defs>
      <rect x="0" y="0" width="32" height="32" rx="8" fill="url(#ps-bg)" />
      {/* Three ascending score bars */}
      <rect x="7"  y="18" width="4" height="7"  rx="1" fill="#fff" opacity="0.5" />
      <rect x="14" y="13" width="4" height="12" rx="1" fill="#fff" opacity="0.75" />
      <rect x="21" y="8"  width="4" height="17" rx="1" fill="#fff" />
      {/* Subtle trend dot */}
      <circle cx="23" cy="8" r="2" fill="#23d29a" stroke="#0a0a0c" strokeWidth="1" />
    </svg>
  );
}

export function Logo({
  size = "md",
  showWord = true,
  href,
}: {
  size?: Size;
  showWord?: boolean;
  href?: string;
}) {
  const s = SIZE[size];
  const content = (
    <Stack direction="row" spacing={1} alignItems="center">
      <LogoMark size={s.mark} />
      {showWord && (
        <Typography
          component="span"
          sx={{
            fontWeight: 700,
            letterSpacing: "-0.02em",
            fontSize: s.word,
            color: "text.primary",
            lineHeight: 1,
          }}
        >
          Prop
          <Box component="span" sx={{ color: "primary.main" }}>
            Score
          </Box>
        </Typography>
      )}
    </Stack>
  );

  if (!href) return content;
  return (
    <Box
      component="a"
      href={href}
      sx={{ textDecoration: "none", display: "inline-flex", alignItems: "center" }}
    >
      {content}
    </Box>
  );
}
