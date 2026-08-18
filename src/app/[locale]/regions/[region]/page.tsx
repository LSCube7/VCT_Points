import { notFound } from "next/navigation";
import { ArrowBack } from "@mui/icons-material";
import { Box, Button, Chip, Container, Stack, Typography } from "@mui/material";
import Link from "next/link";
import { PublicRegionDetails } from "@/components/PublicRegionDetails";
import { getRegion } from "@/lib/data/public";
import { getMessages } from "@/lib/i18n/messages";
import { regions } from "@/lib/data/demo";
import type { Locale, RegionId } from "@/lib/types";

export function generateStaticParams() {
  return ["zh-CN", "en"].flatMap((locale) => regions.map(({ id }) => ({ locale, region: id })));
}

export default async function RegionPage({ params }: { params: Promise<{ locale: Locale; region: string }> }) {
  const { locale, region: rawRegion } = await params;
  if (!regions.some((item) => item.id === rawRegion)) notFound();
  const region = rawRegion as RegionId;
  const copy = getMessages(locale);
  const data = await getRegion(region);
  if (!data.metadata || !data.analysis) notFound();
  return (
    <Container maxWidth="xl" sx={{ py: { xs: 3, md: 6 } }}>
      <Stack spacing={2} mb={4}>
        <Link href={`/${locale}`}><Button startIcon={<ArrowBack />} sx={{ alignSelf: "flex-start" }}>{copy.overview}</Button></Link>
        <Stack direction={{ xs: "column", md: "row" }} justifyContent="space-between" gap={2}>
          <Box><Stack direction="row" spacing={1} alignItems="center"><Box sx={{ width: 12, height: 32, bgcolor: data.metadata.color, borderRadius: 1 }} /><Typography variant="h2">{data.metadata.name}</Typography><Chip label={data.isPublished ? copy.published : copy.preview} size="small" variant="outlined" /></Stack><Typography color="text.secondary" mt={1}>{copy.slots}: 4 · Stage 2 Play-In → Playoffs</Typography></Box>
          <Stack direction="row" spacing={1}><Chip label={data.isPublished ? data.version : copy.unpublished} /><Chip label={`${data.analysis.scenarioGroups.length} ${copy.scenario}`} variant="outlined" /></Stack>
        </Stack>
      </Stack>
      <PublicRegionDetails analysis={data.analysis} teams={data.teams} teamPoints={data.teamPoints} matches={data.matches} clusters={data.clusters} regionColor={data.metadata.color} />
    </Container>
  );
}
