import { notFound } from "next/navigation";
import { ArrowBack, Lock, TableChart } from "@mui/icons-material";
import { Box, Button, Card, CardContent, Chip, Container, Grid, Stack, Tab, Tabs, Typography } from "@mui/material";
import Link from "next/link";
import { ProbabilityChart } from "@/components/ProbabilityChart";
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
  const teamById = new Map(data.teams.map((team) => [team.id, team]));
  const chartData = data.analysis.teamProbabilities.map((item) => ({ name: teamById.get(item.teamId)?.shortName ?? item.teamId, value: item.probability.percentage, color: data.metadata?.color }));
  return (
    <Container maxWidth="xl" sx={{ py: { xs: 3, md: 6 } }}>
      <Stack spacing={2} mb={4}>
        <Link href={`/${locale}`}><Button startIcon={<ArrowBack />} sx={{ alignSelf: "flex-start" }}>{copy.overview}</Button></Link>
        <Stack direction={{ xs: "column", md: "row" }} justifyContent="space-between" gap={2}>
          <Box><Stack direction="row" spacing={1} alignItems="center"><Box sx={{ width: 12, height: 32, bgcolor: data.metadata.color, transform: "skew(-14deg)" }} /><Typography variant="h2">{data.metadata.name}</Typography><Chip label={copy.preview} size="small" variant="outlined" /></Stack><Typography color="text.secondary" mt={1}>{copy.slots}: 4 · Stage 2 Play-In → Playoffs</Typography></Box>
          <Stack direction="row" spacing={1}><Chip icon={<Lock />} label={copy.unpublished} /><Chip icon={<TableChart />} label={`${data.analysis.scenarioGroups.length} ${copy.scenario}`} variant="outlined" /></Stack>
        </Stack>
      </Stack>
      <Tabs value={0} sx={{ mb: 3 }} aria-label={`${data.metadata.name} tabs`}><Tab label={copy.overview} /><Tab label={copy.bracket} /><Tab label={copy.scenario} /><Tab label={copy.focus} /><Tab label={copy.clusters} /></Tabs>
      <Grid container spacing={3}>
        <Grid size={{ xs: 12, md: 8 }}><Card><CardContent><Typography variant="h5" mb={1}>{copy.probability}</Typography><Typography variant="body2" color="text.secondary">每场未完成系列赛均按 50/50 分支；当前图表使用界面预览数据。</Typography>{chartData.length > 0 ? <ProbabilityChart data={chartData} ariaLabel={`${data.metadata.name} ${copy.probability}`} /> : <Box className="chart-surface" sx={{ display: "grid", placeItems: "center" }}><Typography color="text.secondary">{copy.pending}</Typography></Box>}</CardContent></Card></Grid>
        <Grid size={{ xs: 12, md: 4 }}><Card sx={{ height: "100%" }}><CardContent><Typography variant="h5" mb={2}>{copy.scenario}</Typography>{data.analysis.scenarioGroups.length > 0 ? <Stack spacing={1.5}>{data.analysis.scenarioGroups.slice(0, 5).map((scenario) => <Box key={scenario.id} sx={{ p: 1.5, border: "1px solid var(--vct-border)", borderRadius: 2 }}><Stack direction="row" justifyContent="space-between" gap={1}><Typography variant="body2">{scenario.qualifiers.map((id) => teamById.get(id)?.shortName ?? id).join(" · ")}</Typography><Typography fontWeight={700}>{scenario.probability.percentage.toFixed(2)}%</Typography></Stack></Box>)}</Stack> : <Typography color="text.secondary">{copy.pending}</Typography>}</CardContent></Card></Grid>
      </Grid>
      <Box component="section" mt={4}><Typography variant="h5" mb={2}>{copy.points}</Typography><Grid container spacing={2}>{data.teams.map((team) => <Grid key={team.id} size={{ xs: 12, sm: 6, md: 3 }}><Card variant="outlined"><CardContent><Typography fontWeight={700}>{team.shortName}</Typography><Typography variant="body2" color="text.secondary">{copy.pending}</Typography></CardContent></Card></Grid>)}</Grid></Box>
    </Container>
  );
}
