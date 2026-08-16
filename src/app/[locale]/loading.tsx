import { Box, Card, Container, Skeleton, Stack } from "@mui/material";

export default function LocaleLoading() {
  return <Container maxWidth="xl" sx={{ py: 6 }}><Stack spacing={2}><Skeleton variant="rounded" height={180} /><Box display="grid" gridTemplateColumns={{ xs: "1fr", md: "2fr 1fr" }} gap={2}><Card><Skeleton variant="rectangular" height={320} /></Card><Card><Skeleton variant="rectangular" height={320} /></Card></Box></Stack></Container>;
}
