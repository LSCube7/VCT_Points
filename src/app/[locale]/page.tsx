import Link from "next/link";
import { ArrowForward, CalendarMonth, Hub, Insights } from "@mui/icons-material";
import { Box, Button, Card, CardContent, Chip, Container, Grid, Stack, Typography } from "@mui/material";
import { ProbabilityChart } from "@/components/ProbabilityChart";
import { getMessages } from "@/lib/i18n/messages";
import { getPublishedSnapshot } from "@/lib/data/public";
import { demoTeams, regions } from "@/lib/data/demo";
import { sortByDescending } from "@/lib/sorting";
import type { Locale } from "@/lib/types";

export default async function HomePage({ params }: { params: Promise<{ locale: Locale }> }) {
  const { locale } = await params;
  const copy = getMessages(locale);
  const snapshot = await getPublishedSnapshot();
  const isPublished = snapshot.version !== "unpublished" && snapshot.version !== "preview-seed";
  const publicTeams = snapshot.teams?.length
    ? [...snapshot.teams, ...(snapshot.challengerTeams ?? [])]
    : regions.flatMap(({ id }) => demoTeams(id));
  const teamNames = new Map(publicTeams.map((team) => [team.id, team.shortName] as const));
  const chartData = snapshot.regions.flatMap((analysis) => sortByDescending(analysis.teamProbabilities, (item) => item.probability.percentage, (item) => item.teamId).slice(0, 2).map((item) => ({ name: `${analysis.region.toUpperCase()} · ${teamNames.get(item.teamId) ?? item.teamId}`, value: item.probability.percentage, color: regions.find((region) => region.id === analysis.region)?.color })));
  return (
    <Container maxWidth="xl" sx={{ py: { xs: 4, md: 8 } }}>
      <Card sx={{ mb: 4 }}><CardContent sx={{ p: { xs: 3, md: 6 } }}>
        <Stack spacing={2} maxWidth={760}>
          <Chip label={isPublished ? copy.published : copy.preview} color="primary" variant="outlined" sx={{ alignSelf: "flex-start" }} />
          <Typography variant="h1" sx={{ fontSize: { xs: "2.6rem", md: "5rem" }, lineHeight: 0.98 }}>谁会去 Champions？</Typography>
          <Typography variant="h5" color="text.secondary" fontWeight={400}>{copy.subtitle}</Typography>
          <Typography color="text.secondary" maxWidth={640}>{isPublished ? `当前显示已发布的精确结果（${snapshot.version}）。` : `${copy.unpublished}。先用统一规则、等可能系列赛与精确情景聚合搭好计算框架，待管理员录入真实全年赛果后原子发布。`}</Typography>
          <Stack direction={{ xs: "column", sm: "row" }} spacing={1.5} pt={1}>
            <Link href={`/${locale}/regions/amer`}><Button variant="contained" endIcon={<ArrowForward />}>{copy.viewRegion} AMER</Button></Link>
            <Link href={`/${locale}/methodology`}><Button variant="outlined" startIcon={<Insights />}>{copy.methodology}</Button></Link>
          </Stack>
        </Stack>
      </CardContent></Card>

      <Grid container spacing={2} mb={4}>
        {[
          { icon: <Hub />, label: copy.slots, value: "16", caption: "4 regions × 4 slots" },
          { icon: <Insights />, label: copy.probability, value: "50/50", caption: "每场未赛系列赛" },
          { icon: <CalendarMonth />, label: isPublished ? copy.published : copy.unpublished, value: isPublished ? snapshot.version : "—", caption: isPublished ? "当前公开快照" : copy.pending },
        ].map((item) => (
          <Grid key={item.label} size={{ xs: 12, md: 4 }}>
            <Card sx={{ height: "100%" }}><CardContent><Stack direction="row" spacing={2} alignItems="center"><Box sx={{ color: "primary.main" }}>{item.icon}</Box><Box><Typography color="text.secondary" variant="body2">{item.label}</Typography><Typography variant="h4" fontWeight={800}>{item.value}</Typography><Typography variant="caption" color="text.secondary">{item.caption}</Typography></Box></Stack></CardContent></Card>
          </Grid>
        ))}
      </Grid>

      <Grid container spacing={3}>
        <Grid size={{ xs: 12, md: 7 }}>
          <Card sx={{ height: "100%" }}><CardContent sx={{ p: { xs: 2, md: 3 } }}><Stack spacing={1}><Typography variant="h5">{copy.probability}</Typography><Typography variant="body2" color="text.secondary">{isPublished ? "图表使用当前已发布的精确结果。" : "预览数据仅验证图表和聚合交互，正式版本会显示发布快照。"}</Typography>{chartData.length > 0 ? <ProbabilityChart data={chartData} ariaLabel={copy.probability} /> : <Box className="chart-surface" sx={{ display: "grid", placeItems: "center" }}><Typography color="text.secondary">{copy.pending}</Typography></Box>}</Stack></CardContent></Card>
        </Grid>
        <Grid size={{ xs: 12, md: 5 }}>
          <Stack spacing={2}>
            {regions.map((region) => (
              <Link key={region.id} href={`/${locale}/regions/${region.id}`}>
                <Card sx={{ borderLeft: `4px solid ${region.color}` }}><CardContent><Stack direction="row" justifyContent="space-between" alignItems="center"><Box><Typography variant="h6">{region.name}</Typography><Typography variant="body2" color="text.secondary">{copy.slots}: 4 · {isPublished ? copy.published : copy.pending}</Typography></Box><ArrowForward color="action" /></Stack></CardContent></Card>
              </Link>
            ))}
          </Stack>
        </Grid>
      </Grid>
    </Container>
  );
}
