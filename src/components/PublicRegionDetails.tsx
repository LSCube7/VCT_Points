"use client";

import { useMemo, useState, type ReactNode } from "react";
import { Avatar, Box, Card, CardContent, Chip, Divider, Grid, LinearProgress, Stack, Tab, Tabs, Table, TableBody, TableCell, TableHead, TableRow, Typography } from "@mui/material";
import { ProbabilityChart } from "./ProbabilityChart";
import { resolveBracketParticipant } from "@/lib/bracket-display";
import { sortByDescending } from "@/lib/sorting";
import type { MatchResult, PublishedClusterAnalysis, PublishedTeamPoints, RegionAnalysis, ScenarioGroup, Team } from "@/lib/types";

type PublicRegionDetailsProps = {
  analysis: RegionAnalysis;
  teams: Team[];
  teamPoints: PublishedTeamPoints[];
  matches: MatchResult[];
  clusters?: PublishedClusterAnalysis;
  regionColor: string;
};

const statusLabels: Record<MatchResult["status"], string> = {
  scheduled: "未开始",
  completed: "已完成",
  forfeit: "弃权",
  cancelled: "已取消",
};

function participantLabel(
  reference: string,
  teamsById: Map<string, Team>,
  matchesById: Map<string, MatchResult>,
): string {
  const resolved = resolveBracketParticipant(reference, matchesById);
  const team = teamsById.get(resolved ?? reference);
  if (team) return team.shortName || team.name;
  if (reference.startsWith("winner:")) return `胜者 · ${reference.slice("winner:".length)}`;
  if (reference.startsWith("loser:")) return `败者 · ${reference.slice("loser:".length)}`;
  if (reference.startsWith("stage2-")) return "待配置入口";
  if (reference.startsWith("seed:")) return "待定种子";
  return resolved ?? reference;
}

function matchScore(match: MatchResult): string | null {
  if (match.maps.length === 0) return null;
  return match.maps.map((map) => `${map.map} ${map.teamARounds}-${map.teamBRounds}`).join(" · ");
}

function methodLabel(method?: string): string {
  if (method === "stage2-winner") return "Stage 2 冠军";
  if (method === "stage2-runner-up") return "Stage 2 亚军";
  if (method === "championship-points") return "冠军积分";
  return "—";
}

function TeamLogo({ team, size = 36 }: { team?: Team; size?: number }) {
  const label = team?.shortName ?? team?.id ?? "?";
  return <Avatar src={team?.logoUrl} alt={team ? `${team.name} Logo` : undefined} variant="rounded" sx={{ width: size, height: size, flexShrink: 0, bgcolor: "transparent", color: team?.color ?? "#17202a", "& img": { width: "100%", height: "100%", objectFit: "contain", p: 0.5 } }}>{label.slice(0, 2)}</Avatar>;
}

function percentageFromCount(count: bigint, totalOutcomes: bigint): number {
  if (totalOutcomes <= 0n) return 0;
  return Number((count * 1000000n) / totalOutcomes) / 10000;
}

function formatProbability(value: number): string {
  return `${value.toFixed(3)}%`;
}

function stage2PlacementForScenario(scenario: ScenarioGroup, teamId: string): number | undefined {
  const placement = scenario.stage2Placements?.[teamId];
  if (placement !== undefined) return placement;
  if (scenario.methods[teamId] === "stage2-winner") return 1;
  if (scenario.methods[teamId] === "stage2-runner-up") return 2;
  return undefined;
}

function scenarioPlacementLabels(scenario: ScenarioGroup, teamsById: Map<string, Team>): string {
  return scenario.qualifiers
    .slice()
    .sort((left, right) => (stage2PlacementForScenario(scenario, left) ?? 99) - (stage2PlacementForScenario(scenario, right) ?? 99) || left.localeCompare(right))
    .map((teamId) => {
      const placement = stage2PlacementForScenario(scenario, teamId);
      const teamName = teamsById.get(teamId)?.shortName ?? teamId;
      return placement ? `${placement}号 ${teamName}` : `${teamName} · ${methodLabel(scenario.methods[teamId])}`;
    })
    .join(" · ");
}

type QualificationRankCounts = [bigint, bigint, bigint, bigint];

function buildQualificationRankCounts(analysis: RegionAnalysis): Map<string, QualificationRankCounts> {
  const rankCounts = new Map<string, QualificationRankCounts>(analysis.teamProbabilities.map((item) => [item.teamId, [0n, 0n, 0n, 0n]]));
  for (const scenario of analysis.scenarioGroups) {
    const outcomeCount = BigInt(scenario.outcomeCount);
    scenario.qualifiers.forEach((teamId) => {
      const placement = stage2PlacementForScenario(scenario, teamId);
      const counts = rankCounts.get(teamId);
      if (counts && placement && placement >= 1 && placement <= 4) counts[placement - 1] += outcomeCount;
    });
  }
  return rankCounts;
}

type ScenarioCategory = {
  id: string;
  qualifiers: string[];
  scenarios: ScenarioGroup[];
  outcomeCount: bigint;
  probability: number;
};

function groupScenariosByQualifiers(analysis: RegionAnalysis): ScenarioCategory[] {
  const grouped = new Map<string, ScenarioGroup[]>();
  const sortedScenarios = sortByDescending(analysis.scenarioGroups, (scenario) => scenario.probability.percentage, (scenario) => scenario.id);
  for (const scenario of sortedScenarios) {
    const key = [...new Set(scenario.qualifiers)].sort().join("|");
    grouped.set(key, [...(grouped.get(key) ?? []), scenario]);
  }
  const totalOutcomes = BigInt(analysis.totalOutcomes);
  return sortByDescending([...grouped.entries()].map(([id, scenarios]) => ({
    id,
    qualifiers: id.split("|").filter(Boolean),
    scenarios,
    outcomeCount: scenarios.reduce((total, scenario) => total + BigInt(scenario.outcomeCount), 0n),
    probability: percentageFromCount(scenarios.reduce((total, scenario) => total + BigInt(scenario.outcomeCount), 0n), totalOutcomes),
  })), (category) => category.probability, (category) => category.id);
}

function OverviewPanel({ analysis, teams, teamPoints, regionColor }: Pick<PublicRegionDetailsProps, "analysis" | "teams" | "teamPoints" | "regionColor">) {
  const teamById = new Map(teams.map((team) => [team.id, team]));
  const sortedProbabilities = sortByDescending(analysis.teamProbabilities, (item) => item.probability.percentage, (item) => item.teamId);
  const sortedScenarios = sortByDescending(analysis.scenarioGroups, (scenario) => scenario.probability.percentage, (scenario) => scenario.id);
  const chartData = sortedProbabilities
    .map((item) => ({ name: teamById.get(item.teamId)?.shortName ?? item.teamId, value: item.probability.percentage, color: regionColor }));
  return <Grid container spacing={3}>
    <Grid size={{ xs: 12, md: 8 }}>
      <Card><CardContent><Typography variant="h5" mb={1}>晋级概率</Typography><Typography variant="body2" color="text.secondary" mb={1}>每场未完成系列赛按 50/50 分支；当前图表使用已发布的精确结果。</Typography>{chartData.length > 0 ? <ProbabilityChart data={chartData} ariaLabel="赛区晋级概率" /> : <Typography color="text.secondary">暂无已发布结果。</Typography>}</CardContent></Card>
    </Grid>
    <Grid size={{ xs: 12, md: 4 }}>
      <Card sx={{ height: "100%" }}><CardContent><Typography variant="h5" mb={2}>当前情景</Typography>{sortedScenarios.length > 0 ? <Stack spacing={1.25}>{sortedScenarios.slice(0, 5).map((scenario) => <Box key={scenario.id} sx={{ p: 1.25, border: "1px solid var(--vct-border)", borderRadius: 2 }}><Stack direction="row" justifyContent="space-between" gap={1}><Typography variant="body2">{scenario.qualifiers.map((id) => teamById.get(id)?.shortName ?? id).join(" · ")}</Typography><Typography fontWeight={700} whiteSpace="nowrap">{scenario.probability.percentage.toFixed(2)}%</Typography></Stack></Box>)}</Stack> : <Typography color="text.secondary">暂无已发布结果。</Typography>}</CardContent></Card>
    </Grid>
    <Grid size={{ xs: 12 }}>
      <Card variant="outlined"><CardContent><Typography variant="h6" mb={1}>已确认冠军积分</Typography><Typography variant="body2" color="text.secondary" mb={2}>这里只显示发布时已经确定的历史赛事和常规赛积分；Stage 2 未完成比赛的积分随情景计算。</Typography><TeamPointsTable teams={teams} teamPoints={teamPoints} /></CardContent></Card>
    </Grid>
  </Grid>;
}

function TeamPointsTable({ teams, teamPoints }: { teams: Team[]; teamPoints: PublishedTeamPoints[] }) {
  const pointsById = new Map(teamPoints.map((item) => [item.teamId, item]));
  const sortedTeams = sortByDescending(teams, (team) => pointsById.get(team.id)?.total ?? Number.NEGATIVE_INFINITY, (team) => team.id);
  return <Box sx={{ overflowX: "auto" }}><Table size="small" aria-label="已确认冠军积分"><TableHead><TableRow><TableCell>队伍</TableCell><TableCell align="right">总分</TableCell><TableCell align="right">Kickoff</TableCell><TableCell align="right">Masters 1</TableCell><TableCell align="right">Stage 1</TableCell><TableCell align="right">Masters 2</TableCell><TableCell align="right">常规赛</TableCell></TableRow></TableHead><TableBody>{sortedTeams.map((team) => {
    const points = pointsById.get(team.id);
    return <TableRow key={team.id} hover><TableCell><Stack direction="row" spacing={1} alignItems="center"><TeamLogo team={team} size={30} /><Box><Typography variant="body2" fontWeight={700}>{team.name}</Typography><Typography variant="caption" color="text.secondary">{team.shortName}</Typography></Box></Stack></TableCell><TableCell align="right" sx={{ fontWeight: 700 }}>{points?.total ?? "—"}</TableCell><TableCell align="right">{points?.breakdown.kickoff ?? "—"}</TableCell><TableCell align="right">{points?.breakdown.masters1 ?? "—"}</TableCell><TableCell align="right">{points?.breakdown.stage1 ?? "—"}</TableCell><TableCell align="right">{points?.breakdown.masters2 ?? "—"}</TableCell><TableCell align="right">{points?.breakdown.regularSeason ?? "—"}</TableCell></TableRow>;
  })}</TableBody></Table></Box>;
}

function BracketPanel({ matches, teams }: Pick<PublicRegionDetailsProps, "matches" | "teams">) {
  const matchesById = new Map(matches.map((match) => [match.id, match]));
  const teamsById = new Map(teams.map((team) => [team.id, team]));
  const rounds = useMemo(() => {
    const grouped = new Map<string, MatchResult[]>();
    for (const match of matches) {
      const round = match.bracketRound ?? match.roundLabel ?? "淘汰赛";
      grouped.set(round, [...(grouped.get(round) ?? []), match]);
    }
    return [...grouped.entries()];
  }, [matches]);
  if (rounds.length === 0) return <Card><CardContent><Typography color="text.secondary">当前发布快照未包含 Stage 2 对阵图。</Typography></CardContent></Card>;
  return <Box sx={{ overflowX: "auto", pb: 1 }}><Box sx={{ display: "grid", gridTemplateColumns: `repeat(${rounds.length}, minmax(270px, 1fr))`, gap: 2, minWidth: rounds.length * 270 }}>{rounds.map(([round, roundMatches]) => <Box key={round}><Typography variant="subtitle1" fontWeight={700} mb={1}>{round}</Typography><Stack spacing={1.5}>{roundMatches.map((match) => {
    const score = matchScore(match);
    const winner = match.winner ? participantLabel(match.winner, teamsById, matchesById) : undefined;
    return <Card key={match.id} variant="outlined"><CardContent sx={{ p: 1.5, "&:last-child": { pb: 1.5 } }}><Stack spacing={0.75}><Stack direction="row" justifyContent="space-between" gap={1}><Typography variant="caption" color="text.secondary">{match.id}</Typography><Chip size="small" label={statusLabels[match.status]} color={match.status === "completed" || match.status === "forfeit" ? "success" : "default"} /></Stack><Typography fontWeight={match.winner === match.teamA ? 700 : 400}>{participantLabel(match.teamA, teamsById, matchesById)}</Typography><Typography fontWeight={match.winner === match.teamB ? 700 : 400}>{participantLabel(match.teamB, teamsById, matchesById)}</Typography>{winner && <Typography variant="caption" color="text.secondary">系列赛胜者：{winner}</Typography>}{score && <Typography variant="caption" color="text.secondary">{score}</Typography>}</Stack></CardContent></Card>;
  })}</Stack></Box>)}</Box></Box>;
}

function ScenarioPanel({ analysis, teams }: Pick<PublicRegionDetailsProps, "analysis" | "teams">) {
  const teamById = new Map(teams.map((team) => [team.id, team]));
  const categories = groupScenariosByQualifiers(analysis);
  if (categories.length === 0) return <Card><CardContent><Typography color="text.secondary">暂无已发布精确情景。</Typography></CardContent></Card>;
  return (
    <Stack spacing={1.5}>
      {categories.slice(0, 50).map((category) => (
        <Card key={category.id} variant="outlined">
          <CardContent sx={{ p: 1.5, "&:last-child": { pb: 1.5 } }}>
            <Stack direction={{ xs: "column", sm: "row" }} justifyContent="space-between" gap={1}>
              <Stack direction="row" spacing={0.75} flexWrap="wrap" useFlexGap alignItems="center">
                <Typography fontWeight={700}>同一 4 队组合</Typography>
                {category.qualifiers.map((id) => <Chip key={id} size="small" label={teamById.get(id)?.shortName ?? id} />)}
              </Stack>
              <Stack alignItems={{ xs: "flex-start", sm: "flex-end" }}>
                <Typography fontWeight={700}>{formatProbability(category.probability)}</Typography>
                <Typography variant="caption" color="text.secondary">{category.outcomeCount.toString()} / {analysis.totalOutcomes} 个结果</Typography>
              </Stack>
            </Stack>
            <Divider sx={{ my: 1.25 }} />
            <Typography variant="subtitle2" mb={0.75}>小类情况（{category.scenarios.length}）</Typography>
            <Stack spacing={0.75}>
              {category.scenarios.map((scenario) => (
                <Box key={scenario.id} sx={{ p: 1, bgcolor: "action.hover", borderRadius: 1 }}>
                  <Stack direction={{ xs: "column", sm: "row" }} justifyContent="space-between" gap={0.5}>
                    <Typography variant="body2" fontWeight={600}>{scenarioPlacementLabels(scenario, teamById)}</Typography>
                    <Typography variant="body2" fontWeight={700} whiteSpace="nowrap">{formatProbability(scenario.probability.percentage)}</Typography>
                  </Stack>
                  <Typography variant="caption" color="text.secondary">晋级方式：{scenario.qualifiers.map((id) => `${teamById.get(id)?.shortName ?? id} · ${methodLabel(scenario.methods[id])}`).join("；")}</Typography>
                </Box>
              ))}
            </Stack>
          </CardContent>
        </Card>
      ))}
      {categories.length > 50 && <Typography variant="caption" color="text.secondary">仅显示概率最高的 50 个四队组合，完整组合数为 {categories.length}。</Typography>}
    </Stack>
  );
}

function FocusPanel({ analysis, teams, teamPoints }: Pick<PublicRegionDetailsProps, "analysis" | "teams" | "teamPoints">) {
  const teamById = new Map(teams.map((team) => [team.id, team]));
  const pointsById = new Map(teamPoints.map((item) => [item.teamId, item.total]));
  const totalOutcomes = BigInt(analysis.totalOutcomes);
  const rankCountsByTeam = buildQualificationRankCounts(analysis);
  const sortedProbabilities = sortByDescending(analysis.teamProbabilities, (item) => item.probability.percentage, (item) => item.teamId);
  return <Box sx={{ overflowX: "auto" }}><Table size="small" aria-label="队伍晋级概率与冠军积分" sx={{ minWidth: 1080 }}><TableHead sx={{ "& th": { bgcolor: "#2f436d", color: "#fff", fontWeight: 700, whiteSpace: "nowrap" } }}><TableRow><TableCell sx={{ minWidth: 190 }}>队伍</TableCell><TableCell align="right">总积分</TableCell><TableCell align="right">进冠军赛<br />情况数</TableCell><TableCell align="right" sx={{ minWidth: 180 }}>概率</TableCell><TableCell align="right">1号<br />（冠军）</TableCell><TableCell align="right">2号<br />（亚军）</TableCell><TableCell align="right">3号</TableCell><TableCell align="right">4号</TableCell><TableCell align="right">未进<br />冠军赛</TableCell></TableRow></TableHead><TableBody>{sortedProbabilities.map((item) => {
    const team = teamById.get(item.teamId);
    const rankCounts = rankCountsByTeam.get(item.teamId) ?? [0n, 0n, 0n, 0n];
    const qualifiedCount = rankCounts.reduce((total, count) => total + count, 0n);
    const unqualifiedCount = totalOutcomes > qualifiedCount ? totalOutcomes - qualifiedCount : 0n;
    const totalPercentage = percentageFromCount(qualifiedCount, totalOutcomes);
    return <TableRow key={item.teamId} hover><TableCell sx={{ minWidth: 190, whiteSpace: "nowrap" }}><Stack direction="row" spacing={1} alignItems="center"><TeamLogo team={team} size={38} /><Box><Typography variant="body2" fontWeight={700}>{team?.name ?? item.teamId}</Typography><Typography variant="caption" color="text.secondary">{team?.shortName ?? item.teamId}</Typography></Box></Stack></TableCell><TableCell align="right" sx={{ fontWeight: 700 }}>{pointsById.get(item.teamId) ?? "—"}</TableCell><TableCell align="right" sx={{ whiteSpace: "nowrap" }}>{qualifiedCount.toString()}</TableCell><TableCell align="right"><Stack spacing={0.5} alignItems="flex-end" sx={{ minWidth: 160 }}><Typography fontWeight={700}>{formatProbability(totalPercentage)}</Typography><LinearProgress variant="determinate" value={Math.min(100, Math.max(0, totalPercentage))} aria-label={`${team?.shortName ?? item.teamId} 晋级概率`} sx={{ width: "100%", height: 7, borderRadius: 999, bgcolor: "#d7dde8", "& .MuiLinearProgress-bar": { bgcolor: team?.color ?? "primary.main", borderRadius: 999 } }} /></Stack></TableCell><TableCell align="right">{formatProbability(percentageFromCount(rankCounts[0], totalOutcomes))}</TableCell><TableCell align="right">{formatProbability(percentageFromCount(rankCounts[1], totalOutcomes))}</TableCell><TableCell align="right">{formatProbability(percentageFromCount(rankCounts[2], totalOutcomes))}</TableCell><TableCell align="right">{formatProbability(percentageFromCount(rankCounts[3], totalOutcomes))}</TableCell><TableCell align="right" sx={{ color: "text.secondary" }}>{formatProbability(percentageFromCount(unqualifiedCount, totalOutcomes))}</TableCell></TableRow>;
  })}</TableBody></Table></Box>;
}

function ClusterPanel({ analysis, teams, clusters }: Pick<PublicRegionDetailsProps, "analysis" | "teams" | "clusters">) {
  const teamById = new Map(teams.map((team) => [team.id, team]));
  if (!clusters || clusters.clusters.length === 0) return <Card><CardContent><Typography color="text.secondary">当前发布快照未包含情景聚类，请重新发布精确结果。</Typography></CardContent></Card>;
  const scenariosById = new Map(analysis.scenarioGroups.map((scenario) => [scenario.id, scenario]));
  const sortedClusters = sortByDescending(clusters.clusters, (cluster) => cluster.totalProbability, (cluster) => cluster.id);
  return <Stack spacing={1.5}><AlertText>推荐聚类数：{clusters.recommendedK}。聚类按情景晋级方式、已确认积分和 Stage 2 名次特征计算。</AlertText>{sortedClusters.map((cluster) => {
    const medoid = scenariosById.get(cluster.medoidScenarioId);
    return <Card key={cluster.id} variant="outlined"><CardContent><Stack direction={{ xs: "column", sm: "row" }} justifyContent="space-between" gap={1}><Typography variant="h6">{cluster.id}</Typography><Typography fontWeight={700}>{(cluster.totalProbability * 100).toFixed(2)}%</Typography></Stack><Typography variant="body2" color="text.secondary">包含 {cluster.scenarioIds.length} 个情景；代表情景：{medoid?.qualifiers.map((id) => teamById.get(id)?.shortName ?? id).join(" · ") ?? cluster.medoidScenarioId}</Typography></CardContent></Card>;
  })}</Stack>;
}

function AlertText({ children }: { children: ReactNode }) {
  return <Box sx={{ p: 1.5, bgcolor: "action.hover", borderRadius: 1 }}><Typography variant="body2" color="text.secondary">{children}</Typography></Box>;
}

export function PublicRegionDetails({ analysis, teams, teamPoints, matches, clusters, regionColor }: PublicRegionDetailsProps) {
  const [tab, setTab] = useState(0);
  return <>
    <Tabs value={tab} onChange={(_, value: number) => setTab(value)} sx={{ mb: 3 }} aria-label="赛区公开数据标签"><Tab label="总览" /><Tab label="对阵图" /><Tab label="精确情景" /><Tab label="队伍焦点" /><Tab label="聚类分析" /></Tabs>
    {tab === 0 && <OverviewPanel analysis={analysis} teams={teams} teamPoints={teamPoints} regionColor={regionColor} />}
    {tab === 1 && <BracketPanel matches={matches} teams={teams} />}
    {tab === 2 && <ScenarioPanel analysis={analysis} teams={teams} />}
    {tab === 3 && <FocusPanel analysis={analysis} teams={teams} teamPoints={teamPoints} />}
    {tab === 4 && <ClusterPanel analysis={analysis} teams={teams} clusters={clusters} />}
  </>;
}
