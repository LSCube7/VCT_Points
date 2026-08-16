"use client";

import { Button, Container, Stack, Typography } from "@mui/material";

export default function LocaleError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <Container maxWidth="sm" sx={{ py: 12 }}>
      <Stack spacing={2} alignItems="flex-start">
        <Typography variant="h3">页面暂时无法加载</Typography>
        <Typography color="text.secondary">请稍后重试；如果问题持续，请把时间和页面地址提供给管理员。</Typography>
        <Button variant="contained" onClick={reset}>重新加载</Button>
      </Stack>
    </Container>
  );
}
