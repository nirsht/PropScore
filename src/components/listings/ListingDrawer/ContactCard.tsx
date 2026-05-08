import {
  Avatar,
  Box,
  IconButton,
  Link as MuiLink,
  Paper,
  Stack,
  Tooltip,
  Typography,
  alpha,
} from "@mui/material";
import PhoneRoundedIcon from "@mui/icons-material/PhoneRounded";
import EmailRoundedIcon from "@mui/icons-material/EmailRounded";

export function ContactCard({
  role,
  name,
  phone,
  email,
  accent = "primary",
}: {
  role: string;
  name: string | null;
  phone?: string | null;
  email?: string | null;
  accent?: "primary" | "secondary" | "default";
}) {
  const initials = (name ?? "")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((s) => s[0]?.toUpperCase() ?? "")
    .join("");
  const telHref = phone ? `tel:${phone.replace(/[^\d+]/g, "")}` : null;
  const mailHref = email ? `mailto:${email}` : null;
  const accentColor =
    accent === "primary"
      ? "primary.main"
      : accent === "secondary"
        ? "secondary.main"
        : "text.secondary";

  return (
    <Paper
      variant="outlined"
      sx={(theme) => ({
        p: 1.25,
        borderRadius: 2,
        bgcolor: alpha(
          theme.palette[accent === "default" ? "primary" : accent].main,
          0.04,
        ),
        borderColor: alpha(
          theme.palette[accent === "default" ? "primary" : accent].main,
          0.18,
        ),
      })}
    >
      <Stack direction="row" spacing={1.25} alignItems="center">
        <Avatar
          sx={(theme) => ({
            width: 36,
            height: 36,
            fontSize: 14,
            fontWeight: 600,
            bgcolor: alpha(
              theme.palette[accent === "default" ? "primary" : accent].main,
              0.15,
            ),
            color: accentColor,
          })}
        >
          {initials || "?"}
        </Avatar>
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Typography
            variant="caption"
            sx={{
              color: accentColor,
              fontWeight: 600,
              letterSpacing: 0.4,
              textTransform: "uppercase",
              lineHeight: 1,
            }}
          >
            {role}
          </Typography>
          <Typography
            variant="body2"
            sx={{ fontWeight: 600, lineHeight: 1.3, mt: 0.25 }}
            noWrap
          >
            {name ?? "—"}
          </Typography>
          {(phone || email) && (
            <Stack
              direction="row"
              spacing={1.5}
              sx={{ mt: 0.25, color: "text.secondary" }}
            >
              {phone && (
                <Typography variant="caption" noWrap>
                  {phone}
                </Typography>
              )}
              {email && (
                <Typography variant="caption" noWrap sx={{ minWidth: 0 }}>
                  {email}
                </Typography>
              )}
            </Stack>
          )}
        </Box>
        <Stack direction="row" spacing={0.5}>
          {telHref && (
            <Tooltip title={`Call ${phone}`}>
              <IconButton
                size="small"
                component={MuiLink}
                href={telHref}
                sx={(theme) => ({
                  bgcolor: alpha(theme.palette.success.main, 0.1),
                  color: "success.main",
                  "&:hover": {
                    bgcolor: alpha(theme.palette.success.main, 0.2),
                  },
                })}
              >
                <PhoneRoundedIcon fontSize="small" />
              </IconButton>
            </Tooltip>
          )}
          {mailHref && (
            <Tooltip title={`Email ${email}`}>
              <IconButton
                size="small"
                component={MuiLink}
                href={mailHref}
                sx={(theme) => ({
                  bgcolor: alpha(theme.palette.info.main, 0.1),
                  color: "info.main",
                  "&:hover": {
                    bgcolor: alpha(theme.palette.info.main, 0.2),
                  },
                })}
              >
                <EmailRoundedIcon fontSize="small" />
              </IconButton>
            </Tooltip>
          )}
        </Stack>
      </Stack>
    </Paper>
  );
}
