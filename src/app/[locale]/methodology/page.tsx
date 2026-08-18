import Link from "next/link";
import { ArrowBack, CheckCircle, Code, Functions, Source } from "@mui/icons-material";
import { Box, Button, Card, CardContent, Chip, Container, Divider, Grid, List, ListItem, ListItemIcon, ListItemText, Stack, Table, TableBody, TableCell, TableHead, TableRow, Typography } from "@mui/material";
import { getMessages } from "@/lib/i18n/messages";
import { RULE_SOURCES, CHAMPIONSHIP_POINTS } from "@/lib/rules";
import type { Locale } from "@/lib/types";

export default async function MethodologyPage({ params }: { params: Promise<{ locale: Locale }> }) {
  const { locale } = await params;
  const copy = getMessages(locale);
  const labels = locale === "zh-CN"
    ? { title: "方法与规则", lead: "把规则、数据截止时间和概率假设公开，让每个数字都能追溯。", model: "计算模型", rules: "冠军积分规则", tiebreak: "同分判定顺序", sources: "规则来源", tiebreakItems: ["Stage 2 最终名次", "Masters 2 最终名次", "Stage 1 最终名次", "Masters 1 最终名次", "Kickoff 最终名次"] }
    : { title: "Methodology & rules", lead: "Rules, cut-off dates, and probability assumptions stay visible and traceable.", model: "Calculation model", rules: "Championship points", tiebreak: "Tie-break order", sources: "Sources", tiebreakItems: ["Stage 2 final standing", "Masters 2 final standing", "Stage 1 final standing", "Masters 1 final standing", "Kickoff final standing"] };
  const eventLabels: Record<string, string> = { kickoff: "Kickoff", "masters-1": "Masters Santiago", "stage-1": "Stage 1", "masters-2": "Masters London", "stage-2": "Stage 2" };
  return (
    <Container maxWidth="lg" sx={{ py: { xs: 3, md: 6 } }}>
      <Link href={`/${locale}`}><Button startIcon={<ArrowBack />} sx={{ mb: 3 }}>{copy.overview}</Button></Link>
      <Stack spacing={1} mb={4}><Typography variant="h1" sx={{ fontSize: { xs: "2.6rem", md: "4rem" } }}>{labels.title}</Typography><Typography variant="h6" fontWeight={400} color="text.secondary">{labels.lead}</Typography></Stack>
      <Grid container spacing={3}>
        <Grid size={{ xs: 12, md: 7 }}><Card><CardContent><Stack direction="row" spacing={1} alignItems="center" mb={2}><Functions color="primary" /><Typography variant="h5">{labels.model}</Typography></Stack><List disablePadding>{["Stage 2 小组赛必须完整锁定，模拟从 Play-In 到 Playoffs 开始。", "每场未完成系列赛为独立 50/50 事件，使用 BigInt 精确计数。", "状态图动态规划合并等价状态，不使用蒙特卡洛抽样。", "精确结果先按晋级队伍、席位和方式聚合，再进行可解释聚类。"].map((text) => <ListItem key={text} disableGutters><ListItemIcon><CheckCircle color="primary" fontSize="small" /></ListItemIcon><ListItemText primary={locale === "en" ? text.replace("小组赛必须完整锁定，模拟从 Play-In 到 Playoffs 开始。", "Stage 2 groups must be locked; simulation starts at Play-In.").replace("每场未完成系列赛为独立 50/50 事件，使用 BigInt 精确计数。", "Each unplayed series is an independent 50/50 event counted with BigInt.").replace("状态图动态规划合并等价状态，不使用蒙特卡洛抽样。", "Memoized state aggregation avoids Monte Carlo sampling.").replace("精确结果先按晋级队伍、席位和方式聚合，再进行可解释聚类。", "Exact outcomes are grouped before interpretable clustering.") : text} /></ListItem>)}</List></CardContent></Card></Grid>
        <Grid size={{ xs: 12, md: 5 }}><Card><CardContent><Typography variant="h5" mb={2}>{labels.tiebreak}</Typography><Stack spacing={1}>{labels.tiebreakItems.map((item, index) => <Stack key={item} direction="row" spacing={1.5} alignItems="flex-start"><Chip label={index + 1} size="small" color={index === 0 ? "primary" : "default"} /><Typography variant="body2">{item}</Typography></Stack>)}</Stack></CardContent></Card></Grid>
        <Grid size={12}><Card><CardContent><Typography variant="h5" mb={2}>{labels.rules}</Typography><Table size="small"><TableHead><TableRow><TableCell>Event</TableCell><TableCell>Placement points</TableCell><TableCell>Extra</TableCell></TableRow></TableHead><TableBody>{Object.entries(CHAMPIONSHIP_POINTS).map(([event, points]) => <TableRow key={event}><TableCell>{eventLabels[event]}</TableCell><TableCell>{points.join(" / ")}</TableCell><TableCell>{event === "stage-1" || event === "stage-2" ? "+1 per regular-season win" : "—"}</TableCell></TableRow>)}</TableBody></Table></CardContent></Card></Grid>
        <Grid size={12}><Card><CardContent><Stack direction="row" spacing={1} alignItems="center" mb={1}><Source color="primary" /><Typography variant="h5">{labels.sources}</Typography></Stack>{RULE_SOURCES.map((source) => <Box key={source.url} sx={{ py: 1 }}><Typography variant="body2">{source.label}</Typography><Typography component="a" href={source.url} target="_blank" rel="noreferrer" color="primary.main" variant="caption">{source.url}</Typography></Box>)}<Divider sx={{ my: 2 }} /><Stack direction="row" spacing={1} alignItems="center"><Code fontSize="small" color="action" /><Typography variant="caption" color="text.secondary">Engine version: 2026.1.0 · 未解决的官方同分情况会阻止发布。</Typography></Stack></CardContent></Card></Grid>
      </Grid>
    </Container>
  );
}
