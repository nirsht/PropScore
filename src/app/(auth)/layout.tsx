import { Box, Container } from "@mui/material";

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <Box
      sx={{
        minHeight: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        bgcolor: "background.default",
        backgroundImage:
          "radial-gradient(1200px 600px at 10% -20%, rgba(124,92,255,0.18), transparent 60%), radial-gradient(900px 500px at 100% 110%, rgba(35,210,154,0.12), transparent 60%)",
      }}
    >
      <Container maxWidth="xs">{children}</Container>
    </Box>
  );
}
