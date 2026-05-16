import {
  IconButton,
  Link as MuiLink,
  Stack,
  Tooltip,
  Typography,
} from "@mui/material";
import PhoneRoundedIcon from "@mui/icons-material/PhoneRounded";
import EmailRoundedIcon from "@mui/icons-material/EmailRounded";

export function ContactCard({
  role,
  name,
  phone,
  email,
}: {
  role: string;
  name: string | null;
  phone?: string | null;
  email?: string | null;
}) {
  const telHref = phone ? `tel:${phone.replace(/[^\d+]/g, "")}` : null;
  const mailHref = email ? `mailto:${email}` : null;

  return (
    <Stack
      direction="row"
      spacing={1}
      alignItems="center"
      sx={{ minWidth: 0, minHeight: 24 }}
    >
      <Typography
        variant="caption"
        sx={{
          color: "text.secondary",
          textTransform: "uppercase",
          letterSpacing: 0.4,
          fontWeight: 600,
          flexShrink: 0,
        }}
      >
        {role}
      </Typography>
      <Typography
        variant="body2"
        sx={{ fontWeight: 500, flex: 1, minWidth: 0 }}
        noWrap
      >
        {name ?? "—"}
      </Typography>
      {telHref && (
        <Tooltip title={`Call ${phone}`}>
          <IconButton
            size="small"
            component={MuiLink}
            href={telHref}
            sx={{ p: 0.25, color: "text.secondary" }}
          >
            <PhoneRoundedIcon sx={{ fontSize: 16 }} />
          </IconButton>
        </Tooltip>
      )}
      {mailHref && (
        <Tooltip title={`Email ${email}`}>
          <IconButton
            size="small"
            component={MuiLink}
            href={mailHref}
            sx={{ p: 0.25, color: "text.secondary" }}
          >
            <EmailRoundedIcon sx={{ fontSize: 16 }} />
          </IconButton>
        </Tooltip>
      )}
    </Stack>
  );
}
