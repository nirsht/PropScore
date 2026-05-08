import * as React from "react";
import {
  Alert,
  Button,
  Link as MuiLink,
  Snackbar,
  Tooltip,
} from "@mui/material";
import OpenInNewRoundedIcon from "@mui/icons-material/OpenInNewRounded";

export function ToolLink({
  href,
  label,
  icon,
}: {
  href: string;
  label: string;
  icon: React.ReactNode;
}) {
  return (
    <Tooltip title="Opens in a new tab" arrow>
      <Button
        component={MuiLink}
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        size="small"
        variant="outlined"
        startIcon={icon}
        endIcon={<OpenInNewRoundedIcon sx={{ fontSize: 14 }} />}
      >
        {label}
      </Button>
    </Tooltip>
  );
}

/**
 * For tools whose URLs don't accept an address search param (SF PIM,
 * Symbium, Redfin). Copies the full address to the clipboard, surfaces a
 * Snackbar telling the user to paste, then opens the tool in a new tab.
 */
export function CopyAndOpenLink({
  href,
  label,
  icon,
  copyText,
}: {
  href: string;
  label: string;
  icon: React.ReactNode;
  copyText: string;
}) {
  const [snackbarOpen, setSnackbarOpen] = React.useState(false);
  const handleClick = async () => {
    try {
      await navigator.clipboard.writeText(copyText);
      setSnackbarOpen(true);
    } catch {
      // Clipboard API unavailable (older browsers, insecure context). Still
      // open the tool — the user can copy the address from the drawer header.
    }
    window.open(href, "_blank", "noopener,noreferrer");
  };
  return (
    <>
      <Tooltip
        title={`Copies the address, then opens ${label} so you can paste it (no search param available).`}
        arrow
      >
        <Button
          size="small"
          variant="outlined"
          startIcon={icon}
          endIcon={<OpenInNewRoundedIcon sx={{ fontSize: 14 }} />}
          onClick={handleClick}
        >
          {label}
        </Button>
      </Tooltip>
      <Snackbar
        open={snackbarOpen}
        autoHideDuration={3000}
        onClose={() => setSnackbarOpen(false)}
        anchorOrigin={{ vertical: "bottom", horizontal: "center" }}
      >
        <Alert
          severity="success"
          variant="filled"
          onClose={() => setSnackbarOpen(false)}
          sx={{ width: "100%" }}
        >
          Address copied — paste it into {label}.
        </Alert>
      </Snackbar>
    </>
  );
}
