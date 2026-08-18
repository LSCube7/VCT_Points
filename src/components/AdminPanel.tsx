"use client";

import { useMemo, useRef, useState, useTransition } from "react";
import {
  Add,
  Check,
  DeleteOutline,
  Groups,
  Image as ImageIcon,
  Login,
  PlayArrow,
  Remove,
  Save,
  Settings,
  UploadFile,
} from "@mui/icons-material";
import {
  Alert,
  Avatar,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  Container,
  Divider,
  FormControl,
  FormControlLabel,
  Grid,
  IconButton,
  InputLabel,
  MenuItem,
  Paper,
  Select,
  Stack,
  Switch,
  Tab,
  Tabs,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  TextField,
  Tooltip,
  Typography,
} from "@mui/material";
import { allDemoTeams, demoSimulation } from "@/lib/data/demo";
import { resolveBracketParticipant } from "@/lib/bracket-display";
import { runRegionWorker } from "@/lib/engine/worker-client";
import { getMessages } from "@/lib/i18n/messages";
import { calculateMastersAllocations, mastersParticipantIds, mastersSwissParticipantRefs, parseMastersQualificationRef } from "@/lib/masters";
import { applyTripleEliminationSeedOrder, createFullSchedule, EVENT_TEMPLATES, eventTemplate, hydrateDraftSchedule, MAP_POOL, rebuildRegionalGroupMatches, syncMastersQualificationMatches, syncMastersQualificationTournaments, syncMastersSwissRecordMatches, tournamentRegion } from "@/lib/schedule";
import { inspectKickoffScheduleMigration, migrateKickoffSchedule, type KickoffScheduleMigrationPreview } from "@/lib/schedule-migration";
import type { RegionAnalysis } from "@/lib/types";
import { SWISS_RECORDS } from "@/lib/types";
import type { DraftPayload, GroupConfig, Locale, MatchResult, MatchStatus, RegionId, SwissRecord, SwissTeamRecord, Team, TournamentConfig } from "@/lib/types";
import { saveDraft, validateDraft } from "@/app/[locale]/admin/actions";

type AdminTab = "matches" | "schedule" | "teams";
type MatchUpdate = { id: string; update: Partial<MatchResult> };

const regionLabels: Record<RegionId, string> = {
  amer: "AMER",
  emea: "EMEA",
  pacific: "PACIFIC",
  china: "CN",
};

function displayParticipant(ref: string, teams: Map<string, Team>, matchesById?: Map<string, MatchResult>): string {
  const resolvedRef = matchesById ? resolveBracketParticipant(ref, matchesById) : undefined;
  const displayRef = resolvedRef ?? ref;
  const team = teams.get(displayRef);
  if (team) return team.shortName || team.name;
  if (displayRef.startsWith("winner:")) return `胜者 · ${displayRef.slice("winner:".length)}`;
  if (displayRef.startsWith("loser:")) return `败者 · ${displayRef.slice("loser:".length)}`;
  const seedReference = displayRef.startsWith("seed:") ? displayRef.slice("seed:".length) : displayRef;
  const qualification = parseMastersQualificationRef(seedReference);
  if (qualification) return `待定 · ${qualification.region.toUpperCase()} 第 ${qualification.placement} 名`;
  if (displayRef.startsWith("swiss-pending:")) return `待定 · Swiss 晋级队伍 ${displayRef.slice("swiss-pending:".length).split(":").pop()}`;
  const seededTeam = displayRef.startsWith("seed:") ? teams.get(seedReference) : undefined;
  if (seededTeam) return seededTeam.shortName || seededTeam.name;
  if (displayRef.startsWith("seed:")) return `待配置种子 ${seedReference}`;
  return displayRef;
}

const bracketRoundOrder = [
  "Opening Round",
  "Upper Bracket Round 1",
  "Upper Bracket Round 2",
  "Upper Bracket Round 3",
  "Upper Bracket Quarterfinal",
  "Quarterfinal",
  "Upper Bracket Semifinal",
  "Semifinal",
  "Upper Bracket Final",
  "Middle Bracket Round 1",
  "Middle Bracket Round 2",
  "Middle Bracket Round 3",
  "Middle Bracket Round 4",
  "Middle Bracket Final",
  "Lower Bracket Round 1",
  "Lower Bracket Quarterfinal",
  "Lower Bracket Round 2",
  "Lower Bracket Round 3",
  "Lower Bracket Round 4",
  "Lower Bracket Round 5",
  "Lower Bracket Semifinal",
  "Lower Bracket Final",
  "Grand Final",
  "Final",
];

const bracketRoundLabels: Record<string, string> = {
  "Opening Round": "淘汰赛首轮",
  "Upper Bracket Round 1": "胜者组第 1 轮",
  "Upper Bracket Round 2": "胜者组第 2 轮",
  "Upper Bracket Round 3": "胜者组第 3 轮",
  "Upper Bracket Quarterfinal": "胜者组四分之一决赛",
  Quarterfinal: "四分之一决赛",
  "Upper Bracket Semifinal": "胜者组半决赛",
  Semifinal: "半决赛",
  "Upper Bracket Final": "胜者组决赛",
  "Middle Bracket Round 1": "中间败者组第 1 轮",
  "Middle Bracket Round 2": "中间败者组第 2 轮",
  "Middle Bracket Round 3": "中间败者组第 3 轮",
  "Middle Bracket Round 4": "中间败者组第 4 轮",
  "Middle Bracket Final": "中间败者组决赛",
  "Lower Bracket Round 1": "败者组第 1 轮",
  "Lower Bracket Quarterfinal": "败者组四分之一决赛",
  "Lower Bracket Round 2": "败者组第 2 轮",
  "Lower Bracket Round 3": "败者组第 3 轮",
  "Lower Bracket Round 4": "败者组第 4 轮",
  "Lower Bracket Round 5": "败者组第 5 轮",
  "Lower Bracket Semifinal": "败者组半决赛",
  "Lower Bracket Final": "败者组决赛",
  "Grand Final": "总决赛",
  Final: "决赛",
};

function bracketRoundLabel(round?: string): string {
  if (!round) return "淘汰赛";
  return bracketRoundLabels[round] ?? round;
}

function bracketRoundRank(round: string): number {
  const index = bracketRoundOrder.findIndex((label) => round === label);
  return index < 0 ? bracketRoundOrder.length : index;
}

function firstRoundMatches(matches: MatchResult[]): MatchResult[] {
  const playoffMatches = matches.filter((match) => match.phase === "playoffs");
  const matchesByEvent = new Map<string, MatchResult[]>();
  for (const match of playoffMatches) {
    const eventMatches = matchesByEvent.get(match.eventId) ?? [];
    eventMatches.push(match);
    matchesByEvent.set(match.eventId, eventMatches);
  }

  return [...matchesByEvent.values()].flatMap((eventMatches) => {
    const eventId = eventMatches[0]?.eventId;
    if (eventId && eventTemplate(eventId).format === "group-plus-playoffs") {
      return eventMatches.filter((match) => ["Upper Bracket Round 1", "Lower Bracket Round 1", "Opening Round"].includes(match.bracketRound ?? ""));
    }
    const firstRoundRank = Math.min(...eventMatches.map((match) => bracketRoundRank(match.bracketRound ?? "淘汰赛")));
    return eventMatches.filter((match) => bracketRoundRank(match.bracketRound ?? "淘汰赛") === firstRoundRank);
  });
}

function readAndResizeLogo(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("LOGO_READ_FAILED"));
    reader.onload = () => {
      const image = new window.Image();
      image.onerror = () => reject(new Error("LOGO_DECODE_FAILED"));
      image.onload = () => {
        const maxSize = 256;
        const scale = Math.min(1, maxSize / Math.max(image.width, image.height));
        const canvas = document.createElement("canvas");
        canvas.width = Math.max(1, Math.round(image.width * scale));
        canvas.height = Math.max(1, Math.round(image.height * scale));
        const context = canvas.getContext("2d");
        if (!context) {
          reject(new Error("LOGO_CANVAS_FAILED"));
          return;
        }
        context.drawImage(image, 0, 0, canvas.width, canvas.height);
        resolve(canvas.toDataURL("image/png"));
      };
      image.src = String(reader.result);
    };
    reader.readAsDataURL(file);
  });
}

function MapScoreEditor({ match, onChange }: { match: MatchResult; onChange: (maps: MatchResult["maps"]) => void }) {
  if (match.status === "forfeit") {
    return <Typography variant="caption" color="text.secondary">弃权结果不填写地图比分</Typography>;
  }
  if (match.status === "scheduled" || match.status === "cancelled") {
    return <Typography variant="caption" color="text.secondary">完赛后填写地图比分</Typography>;
  }

  return (
    <Stack spacing={1} minWidth={{ xs: 280, md: 420 }}>
      {match.maps.map((score, index) => {
        const customMap = !MAP_POOL.includes(score.map as (typeof MAP_POOL)[number]);
        return (
          <Stack key={`${match.id}-map-${index}`} direction="row" spacing={0.75} alignItems="center">
            <FormControl size="small" sx={{ minWidth: 128 }}>
              <InputLabel id={`${match.id}-map-${index}-label`}>地图</InputLabel>
              <Select
                labelId={`${match.id}-map-${index}-label`}
                label="地图"
                value={customMap ? "__custom__" : score.map}
                onChange={(event) => {
                  const next = [...match.maps];
                  next[index] = { ...score, map: event.target.value === "__custom__" ? "自定义地图" : event.target.value };
                  onChange(next);
                }}
              >
                {MAP_POOL.map((map) => <MenuItem key={map} value={map}>{map}</MenuItem>)}
                <MenuItem value="__custom__">自定义地图</MenuItem>
              </Select>
            </FormControl>
            {customMap && <TextField size="small" label="地图名" value={score.map} onChange={(event) => { const next = [...match.maps]; next[index] = { ...score, map: event.target.value }; onChange(next); }} sx={{ width: 120 }} />}
            <TextField size="small" type="number" label="A 回合" value={score.teamARounds} onChange={(event) => { const next = [...match.maps]; next[index] = { ...score, teamARounds: Number(event.target.value) }; onChange(next); }} inputProps={{ min: 0, max: 99, inputMode: "numeric" }} sx={{ width: 84 }} />
            <Typography color="text.secondary">:</Typography>
            <TextField size="small" type="number" label="B 回合" value={score.teamBRounds} onChange={(event) => { const next = [...match.maps]; next[index] = { ...score, teamBRounds: Number(event.target.value) }; onChange(next); }} inputProps={{ min: 0, max: 99, inputMode: "numeric" }} sx={{ width: 84 }} />
            <Tooltip title="删除地图"><IconButton aria-label="删除地图" size="small" onClick={() => onChange(match.maps.filter((_, mapIndex) => mapIndex !== index))}><Remove fontSize="small" /></IconButton></Tooltip>
          </Stack>
        );
      })}
      <Button size="small" variant="outlined" startIcon={<Add />} sx={{ alignSelf: "flex-start" }} onClick={() => onChange([...match.maps, { map: MAP_POOL[0], teamARounds: 0, teamBRounds: 0 }])}>添加地图</Button>
    </Stack>
  );
}

function MatchControls({ match, teams, matchesById, onChange }: { match: MatchResult; teams: Map<string, Team>; matchesById?: Map<string, MatchResult>; onChange: (update: Partial<MatchResult>) => void }) {
  if (match.phase === "swiss") {
    return <Typography variant="caption" color="text.secondary">Swiss 不录入单场赛果，请在上方填写每支队伍的最终战绩。</Typography>;
  }
  const selectableWinner = [match.teamA, match.teamB];
  function updateStatus(status: MatchStatus) {
    const resetResult = status === "scheduled" || status === "forfeit" || status === "cancelled";
    onChange({
      status,
      winner: status === "scheduled" || status === "cancelled" ? undefined : match.winner,
      maps: resetResult ? [] : match.maps,
    });
  }

  return (
    <Stack spacing={1.25}>
      <Stack direction={{ xs: "column", sm: "row" }} spacing={1} alignItems={{ sm: "center" }}>
        <FormControl size="small" sx={{ minWidth: 118 }}>
          <InputLabel id={`${match.id}-status-label`}>状态</InputLabel>
          <Select labelId={`${match.id}-status-label`} label="状态" value={match.status} onChange={(event) => updateStatus(event.target.value as MatchStatus)}>
            <MenuItem value="scheduled">未开始</MenuItem><MenuItem value="completed">已完成</MenuItem><MenuItem value="forfeit">弃权</MenuItem><MenuItem value="cancelled">取消</MenuItem>
          </Select>
        </FormControl>
        <FormControl size="small" sx={{ minWidth: 180 }} disabled={match.status === "scheduled" || match.status === "cancelled" || selectableWinner.length === 0}>
          <InputLabel id={`${match.id}-winner-label`}>系列赛胜者</InputLabel>
          <Select labelId={`${match.id}-winner-label`} label="系列赛胜者" displayEmpty value={match.winner ?? ""} onChange={(event) => onChange({ winner: event.target.value || undefined })}>
            <MenuItem value="">待定</MenuItem>{selectableWinner.map((teamId) => <MenuItem key={teamId} value={teamId}>{displayParticipant(teamId, teams, matchesById)}</MenuItem>)}
          </Select>
        </FormControl>
        <Chip size="small" label={`Bo${match.bestOf ?? 3}`} variant="outlined" />
      </Stack>
      <MapScoreEditor match={match} onChange={(maps) => onChange({ maps })} />
      {(match.status === "forfeit" || match.status === "cancelled") && <TextField size="small" label={match.status === "forfeit" ? "弃权原因" : "取消原因"} value={match.notes ?? ""} onChange={(event) => onChange({ notes: event.target.value })} multiline minRows={2} fullWidth />}
    </Stack>
  );
}

function GroupMatchList({ matches, teams, matchesById, onChange }: { matches: MatchResult[]; teams: Map<string, Team>; matchesById?: Map<string, MatchResult>; onChange: (id: string, update: Partial<MatchResult>) => void }) {
  return (
    <Paper variant="outlined" sx={{ overflowX: "auto" }}>
      <Table size="small" aria-label="小组赛结果列表">
        <TableHead><TableRow><TableCell>轮次 / 对阵</TableCell><TableCell sx={{ minWidth: 520 }}>赛果与地图比分</TableCell></TableRow></TableHead>
        <TableBody>
          {matches.map((match) => <TableRow key={match.id} hover><TableCell sx={{ verticalAlign: "top", minWidth: 220 }}><Typography variant="caption" color="text.secondary" display="block">{match.roundLabel ?? match.phase}</Typography><Typography fontWeight={700}>{displayParticipant(match.teamA, teams, matchesById)}</Typography><Typography variant="body2" color="text.secondary">vs</Typography><Typography fontWeight={700}>{displayParticipant(match.teamB, teams, matchesById)}</Typography><Typography variant="caption" color="text.secondary" display="block" mt={0.5}>{match.id}</Typography></TableCell><TableCell><MatchControls match={match} teams={teams} matchesById={matchesById} onChange={(update) => onChange(match.id, update)} /></TableCell></TableRow>)}
          {matches.length === 0 && <TableRow><TableCell colSpan={2}><Typography color="text.secondary" textAlign="center" py={4}>当前筛选没有比赛</Typography></TableCell></TableRow>}
        </TableBody>
      </Table>
    </Paper>
  );
}

function MastersAllocationSummary({ teams, matches, eventId }: { teams: Team[]; matches: MatchResult[]; eventId: "masters-1" | "masters-2" }) {
  const allocations = calculateMastersAllocations(teams, matches, eventId);
  const teamById = new Map(teams.map((team) => [team.id, team]));
  return (
    <Paper variant="outlined" sx={{ p: 2 }}>
      <Stack direction={{ xs: "column", sm: "row" }} justifyContent="space-between" gap={1} mb={1.5}>
        <Box>
          <Typography variant="subtitle1" fontWeight={700}>国际赛事名额自动计算</Typography>
          <Typography variant="body2" color="text.secondary">名额由 {eventId === "masters-1" ? "Kickoff 三败淘汰的胜者组 / 中间败者组 / 败者组决赛" : "Stage 1 地区季后赛的总决赛与败者组决赛"} 结果自动确定；源赛事未完成时不会按队伍配置顺序代填。Swiss 只需为参赛队伍填写最终战绩。</Typography>
        </Box>
        <Chip size="small" color="primary" label="4 赛区 × 3 名额 = 12 队" />
      </Stack>
      <Grid container spacing={1.5}>
        {allocations.map((allocation) => (
          <Grid key={allocation.region} size={{ xs: 12, sm: 6, md: 3 }}>
            <Card variant="outlined" sx={{ height: "100%" }}>
              <CardContent sx={{ p: 1.5, "&:last-child": { pb: 1.5 } }}>
                <Stack direction="row" justifyContent="space-between" alignItems="center" gap={1}>
                  <Typography fontWeight={700}>{regionLabels[allocation.region]}</Typography>
                  <Chip size="small" label={`${allocation.slotCount} 个名额`} />
                </Stack>
                <Stack spacing={0.5} mt={1}>
                  {allocation.teamIdsByPlacement.map((teamId, index) => <Typography key={`${allocation.region}-${index}`} variant="body2">{index + 1}. {teamId ? (teamById.get(teamId)?.shortName ?? teamId) : "待源赛事赛果"}</Typography>)}
                  {!allocation.resolved && <Typography variant="caption" color="warning.main">源赛事尚未完成，名额暂待定</Typography>}
                </Stack>
              </CardContent>
            </Card>
          </Grid>
        ))}
      </Grid>
    </Paper>
  );
}

function SwissRecordsConfiguration({ config, matches, teams, onChange }: { config: TournamentConfig; matches: MatchResult[]; teams: Team[]; onChange: (config: TournamentConfig) => void }) {
  const configuredParticipants = config.groupStage?.groups.find((group) => group.id === "swiss")?.teamIds ?? [];
  const participantIds = configuredParticipants.length > 0
    ? [...new Set(configuredParticipants)]
    : (config.eventId === "masters-1" || config.eventId === "masters-2" ? mastersSwissParticipantRefs(config.eventId) : []);
  if (participantIds.length === 0) return null;

  const teamById = new Map(teams.map((team) => [team.id, team]));
  const matchesById = new Map(matches.map((match) => [match.id, match]));
  const recordByTeam = new Map((config.swissRecords ?? []).map((entry) => [entry.teamId, entry.record]));
  const recordedCount = participantIds.filter((teamId) => recordByTeam.has(teamId)).length;
  const qualifiedIds = participantIds.filter((teamId) => recordByTeam.get(teamId) === "2-0" || recordByTeam.get(teamId) === "2-1");

  function updateRecord(teamId: string, record: SwissRecord | "") {
    const nextByTeam = new Map(recordByTeam);
    if (record) nextByTeam.set(teamId, record);
    else nextByTeam.delete(teamId);
    const swissRecords: SwissTeamRecord[] = participantIds.flatMap((participantId) => {
      const nextRecord = nextByTeam.get(participantId);
      return nextRecord ? [{ teamId: participantId, record: nextRecord }] : [];
    });
    onChange({ ...config, swissRecords });
  }

  return (
    <Paper variant="outlined" sx={{ p: 2 }}>
      <Stack direction={{ xs: "column", sm: "row" }} justifyContent="space-between" gap={1} mb={1.5}>
        <Box>
          <Typography variant="subtitle1" fontWeight={700}>Swiss 阶段最终战绩</Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>不录入 Swiss 每一场比赛，只为每支队伍记录最终战绩：2-0、2-1、1-2 或 0-2。填满参赛队伍后，2-0 和 2-1 的队伍会自动进入淘汰赛。</Typography>
        </Box>
        <Chip size="small" color={recordedCount === participantIds.length ? "success" : "default"} label={`已录入 ${recordedCount}/${participantIds.length} 队`} />
      </Stack>
      {participantIds.some((teamId) => !teamById.has(teamId)) && <Alert severity="info" sx={{ mb: 1.5 }}>部分参赛队伍仍显示为待定，请先完成四赛区名额计算；名额确定后，原有战绩会按队伍引用保留。</Alert>}
      {recordedCount === participantIds.length && qualifiedIds.length !== 4 && <Alert severity="error" sx={{ mb: 1.5 }}>完整 Swiss 战绩必须恰好有 4 支队伍为 2-0 或 2-1，当前为 {qualifiedIds.length} 支；淘汰赛入口暂不会更新。</Alert>}
      <Grid container spacing={1.25}>
        {participantIds.map((teamId, index) => {
          const labelId = `${config.id}-swiss-record-${index + 1}-label`;
          return <Grid key={teamId} size={{ xs: 12, sm: 6, md: 3 }}>
            <Card variant="outlined">
              <CardContent sx={{ p: 1.5, "&:last-child": { pb: 1.5 } }}>
                <Typography fontWeight={700}>{displayParticipant(teamId, teamById, matchesById)}</Typography>
                <Typography variant="caption" color="text.secondary" display="block" sx={{ mt: 0.25, mb: 1 }}>{teamId}</Typography>
                <FormControl fullWidth size="small">
                  <InputLabel id={labelId} shrink>最终战绩</InputLabel>
                  <Select labelId={labelId} label="最终战绩" value={recordByTeam.get(teamId) ?? ""} displayEmpty renderValue={(value) => value || "未录入"} onChange={(event) => updateRecord(teamId, event.target.value as SwissRecord | "")}>
                    <MenuItem value="">未录入</MenuItem>
                    {SWISS_RECORDS.map((record) => <MenuItem key={record} value={record}>{record}</MenuItem>)}
                  </Select>
                </FormControl>
              </CardContent>
            </Card>
          </Grid>;
        })}
      </Grid>
      <Typography variant="body2" color="text.secondary" sx={{ mt: 1.5 }}>
        当前可晋级：{qualifiedIds.length > 0 ? qualifiedIds.map((teamId) => displayParticipant(teamId, teamById, matchesById)).join("、") : "待录入完整战绩"}
      </Typography>
    </Paper>
  );
}

function BracketMatchCard({ match, teams, matchesById, onChange }: { match: MatchResult; teams: Map<string, Team>; matchesById: Map<string, MatchResult>; onChange: (id: string, update: Partial<MatchResult>) => void }) {
  return (
    <Card variant="outlined" sx={{ minWidth: 260, mb: 2 }}>
      <CardContent sx={{ p: 1.5, "&:last-child": { pb: 1.5 } }}>
        <Typography variant="caption" color="text.secondary" display="block" mb={0.75}>{bracketRoundLabel(match.bracketRound ?? match.roundLabel)}</Typography>
        <Stack spacing={0.5} mb={1.25}><Stack direction="row" justifyContent="space-between" gap={1}><Typography variant="body2" fontWeight={700}>{displayParticipant(match.teamA, teams, matchesById)}</Typography>{match.winner === match.teamA && <Chip size="small" color="success" label="胜" />}</Stack><Divider /><Stack direction="row" justifyContent="space-between" gap={1}><Typography variant="body2" fontWeight={700}>{displayParticipant(match.teamB, teams, matchesById)}</Typography>{match.winner === match.teamB && <Chip size="small" color="success" label="胜" />}</Stack></Stack>
        <MatchControls match={match} teams={teams} matchesById={matchesById} onChange={(update) => onChange(match.id, update)} />
      </CardContent>
    </Card>
  );
}

function FirstRoundConfiguration({ matches, teams, onChange }: { matches: MatchResult[]; teams: Team[]; onChange: (id: string, update: Partial<MatchResult>) => void }) {
  const firstRound = firstRoundMatches(matches);
  if (firstRound.length === 0) return null;

  const teamById = new Map(teams.map((team) => [team.id, team]));
  function candidatesFor(match: MatchResult): Team[] {
    const internationalParticipants = eventTemplate(match.eventId).scope === "international"
      ? new Set(mastersParticipantIds(teams, matches, match.eventId as "masters-1" | "masters-2"))
      : undefined;
    return teams.filter((team) => team.active && (internationalParticipants ? internationalParticipants.has(team.id) : match.region === "global" || team.region === match.region));
  }
  function updateParticipant(match: MatchResult, side: "teamA" | "teamB", value: string) {
    const update = side === "teamA" ? { teamA: value } : { teamB: value };
    onChange(match.id, { ...update, status: "scheduled", winner: undefined, maps: [], notes: undefined });
  }

  return (
    <Paper variant="outlined" sx={{ p: 2 }}>
      <Typography variant="subtitle1" fontWeight={700}>淘汰赛第一轮对阵配置</Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5, mb: 1.5 }}>
        在这里手动指定每场淘汰赛首轮的双方。更换队伍会清除该场已有赛果，避免旧结果被错误沿用。
      </Typography>
      <Stack spacing={1.25}>
        {firstRound.map((match) => {
          const options = new Map<string, Team>(candidatesFor(match).map((team) => [team.id, team]));
          for (const participant of [match.teamA, match.teamB]) {
            const currentTeam = teamById.get(participant);
            if (currentTeam) options.set(currentTeam.id, currentTeam);
          }
          const eventLabel = eventTemplate(match.eventId).label;
          return (
            <Stack key={match.id} direction={{ xs: "column", md: "row" }} spacing={1} alignItems={{ md: "center" }}>
              <Box sx={{ minWidth: { md: 250 } }}>
                <Typography variant="body2" fontWeight={700}>{eventLabel} · {bracketRoundLabel(match.bracketRound ?? "首轮")}</Typography>
                <Typography variant="caption" color="text.secondary">{match.id}</Typography>
              </Box>
              <FormControl size="small" sx={{ minWidth: { xs: "100%", md: 220 } }}>
                <InputLabel id={`${match.id}-first-round-a-label`}>队伍 A</InputLabel>
                <Select labelId={`${match.id}-first-round-a-label`} label="队伍 A" value={match.teamA} onChange={(event) => updateParticipant(match, "teamA", event.target.value)}>
                  {[...options.values()].map((team) => <MenuItem key={team.id} value={team.id} disabled={team.id === match.teamB}>{team.name}</MenuItem>)}
                  {!teamById.has(match.teamA) && <MenuItem value={match.teamA}>{displayParticipant(match.teamA, teamById)}</MenuItem>}
                </Select>
              </FormControl>
              <Typography color="text.secondary" sx={{ alignSelf: { xs: "center", md: "auto" } }}>vs</Typography>
              <FormControl size="small" sx={{ minWidth: { xs: "100%", md: 220 } }}>
                <InputLabel id={`${match.id}-first-round-b-label`}>队伍 B</InputLabel>
                <Select labelId={`${match.id}-first-round-b-label`} label="队伍 B" value={match.teamB} onChange={(event) => updateParticipant(match, "teamB", event.target.value)}>
                  {[...options.values()].map((team) => <MenuItem key={team.id} value={team.id} disabled={team.id === match.teamA}>{team.name}</MenuItem>)}
                  {!teamById.has(match.teamB) && <MenuItem value={match.teamB}>{displayParticipant(match.teamB, teamById)}</MenuItem>}
                </Select>
              </FormControl>
            </Stack>
          );
        })}
      </Stack>
    </Paper>
  );
}

function BracketBoard({ matches, teams, matchesById, onChange }: { matches: MatchResult[]; teams: Map<string, Team>; matchesById: Map<string, MatchResult>; onChange: (id: string, update: Partial<MatchResult>) => void }) {
  const rounds = [...new Set(matches.map((match) => match.bracketRound ?? "淘汰赛"))].sort((left, right) => {
    return bracketRoundRank(left) - bracketRoundRank(right);
  });
  return <Stack spacing={2}><FirstRoundConfiguration matches={matches} teams={[...teams.values()]} onChange={onChange} /><Box sx={{ overflowX: "auto", pb: 1 }}><Box sx={{ display: "grid", gridTemplateColumns: `repeat(${Math.max(rounds.length, 1)}, minmax(280px, 1fr))`, gap: 2, minWidth: Math.max(rounds.length, 1) * 280 }}>{rounds.map((round) => <Box key={round}><Typography variant="subtitle2" color="text.secondary" mb={1}>{bracketRoundLabel(round)}</Typography>{matches.filter((match) => (match.bracketRound ?? "淘汰赛") === round).map((match) => <BracketMatchCard key={match.id} match={match} teams={teams} matchesById={matchesById} onChange={onChange} />)}</Box>)}</Box></Box></Stack>;
}

function TripleEliminationConfiguration({ config, teams, matches, migration, onChange, onMigrate, onOpenMatches }: { config: TournamentConfig; teams: Team[]; matches: MatchResult[]; migration: KickoffScheduleMigrationPreview; onChange: (config: TournamentConfig) => void; onMigrate?: () => void; onOpenMatches?: () => void }) {
  const region = tournamentRegion(config, matches);
  const eligibleTeams = teams.filter((team) => config.scope === "international" || team.region === region);
  const configuredRefs = config.bracket?.teamRefs ?? [];
  const seedSlots = Array.from({ length: 12 }, (_, index) => configuredRefs[index]?.startsWith("seed:") ? "" : configuredRefs[index] ?? "");
  const teamRefs = seedSlots.map((teamId, index) => teamId || `seed:${index + 1}`);
  const teamById = new Map(teams.map((team) => [team.id, team]));
  const selectedTeamIds = new Set(seedSlots.filter(Boolean));
  const currentBracketMatches = matches.filter((match) => match.eventId === config.eventId && match.region === region && match.phase === "playoffs");
  const hasLegacySchedule = currentBracketMatches.length > 0 && (currentBracketMatches.length !== 30 || !currentBracketMatches.some((match) => match.bracketRound === "Middle Bracket Round 1"));
  const isLegacyRegion = region ? migration.legacyRegions.includes(region) : false;
  const sections = [
    { title: "胜者组", detail: "4 场首轮 · 4 场第二轮 · 2 场第三轮 · 1 场决赛", note: "前四种子从第二轮进入" },
    { title: "中间败者组", detail: "4 场第一轮 · 2 场第二轮 · 2 场第三轮 · 1 场第四轮 · 1 场决赛", note: "胜者组首次失利后进入" },
    { title: "败者组", detail: "2 场第一轮 · 2 场第二轮 · 2 场第三轮 · 1 场第四轮 · 1 场第五轮 · 1 场决赛", note: "第二次失利后进入，第三次失利淘汰" },
  ];
  function updateSeedSlot(index: number, teamId: string) {
    const nextRefs = seedSlots.map((current, slotIndex) => slotIndex === index ? teamId || `seed:${slotIndex + 1}` : current || `seed:${slotIndex + 1}`);
    onChange({ ...config, bracket: { type: "triple-elimination", startRound: config.bracket?.startRound ?? "quarterfinals", teamRefs: nextRefs } });
  }
  return <Stack spacing={2}>
    <Alert severity="info" icon={<Settings />}>Kickoff 的赛制结构固定为 12 队三败淘汰。这里展示轮次和种子入口；实际首轮双方请到“赛果录入 → 淘汰赛图”中配置，避免配置页和已录入赛果互相覆盖。</Alert>
    {hasLegacySchedule && <Alert severity="warning">当前草稿仍载入旧版 Kickoff 对阵图（检测到 {currentBracketMatches.length} 场淘汰赛）。本页不会自动覆盖旧赛果；请先确认迁移后，再在赛果录入页使用新版胜者组 / 中间败者组 / 败者组结构。</Alert>}
    {isLegacyRegion && migration.blockedRegions.length > 0 && <Alert severity="error">检测到旧版后续轮次已有赛果，自动迁移已阻止（受影响赛区：{migration.blockedRegions.join("、")}）。请先保留原草稿，并手动将这些结果按新版对阵重新录入。</Alert>}
    <Grid container spacing={2}>{sections.map((section) => <Grid key={section.title} size={{ xs: 12, md: 4 }}><Card variant="outlined" sx={{ height: "100%" }}><CardContent><Typography variant="subtitle1" fontWeight={700}>{section.title}</Typography><Typography variant="body2" sx={{ mt: 1 }}>{section.detail}</Typography><Typography variant="caption" color="text.secondary" display="block" sx={{ mt: 1 }}>{section.note}</Typography></CardContent></Card></Grid>)}</Grid>
    <Paper variant="outlined" sx={{ p: 2 }}>
      <Typography variant="subtitle1" fontWeight={700}>手动配置种子顺位</Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5, mb: 1.5 }}>队伍列表顺序不代表种子顺位。请手动填写 12 个入口：前四个进入胜者组第 2 轮，后八个组成胜者组第 1 轮；同一队伍不能重复选择。</Typography>
      <Grid container spacing={1.5} sx={{ mb: 2 }}>
        {seedSlots.map((currentTeamId, index) => {
          const label = index < 4 ? `胜者组第 2 轮种子 ${index + 1}` : `胜者组第 1 轮队伍 ${index - 3}`;
          const options = eligibleTeams.filter((team) => !selectedTeamIds.has(team.id) || team.id === currentTeamId);
          return <Grid key={`${config.id}-seed-slot-${index + 1}`} size={{ xs: 12, sm: 6, md: 3 }}><FormControl fullWidth size="small"><InputLabel id={`${config.id}-seed-slot-${index + 1}-label`}>{label}</InputLabel><Select labelId={`${config.id}-seed-slot-${index + 1}-label`} label={label} value={currentTeamId} onChange={(event) => updateSeedSlot(index, event.target.value)}><MenuItem value="">未配置</MenuItem>{options.map((team) => <MenuItem key={team.id} value={team.id}>{team.name}</MenuItem>)}{currentTeamId && !teamById.has(currentTeamId) && <MenuItem value={currentTeamId}>{currentTeamId}</MenuItem>}</Select></FormControl></Grid>;
        })}
      </Grid>
      <Stack spacing={1.5}>
        <Box><Typography variant="caption" color="text.secondary" display="block" sx={{ mb: 0.75 }}>胜者组第 2 轮 · 轮空种子</Typography><Stack direction="row" spacing={0.75} flexWrap="wrap" useFlexGap>{teamRefs.slice(0, 4).map((teamId) => <Chip key={teamId} size="small" label={displayParticipant(teamId, teamById)} />)}</Stack></Box>
        <Box><Typography variant="caption" color="text.secondary" display="block" sx={{ mb: 0.75 }}>胜者组第 1 轮 · 首轮队伍</Typography><Stack direction="row" spacing={0.75} flexWrap="wrap" useFlexGap>{teamRefs.slice(4, 12).map((teamId) => <Chip key={teamId} size="small" variant="outlined" label={displayParticipant(teamId, teamById)} />)}</Stack></Box>
      </Stack>
    </Paper>
    <Stack direction={{ xs: "column", sm: "row" }} spacing={1} alignItems={{ sm: "center" }}>
      {isLegacyRegion && migration.canMigrate && onMigrate && <Button variant="contained" color="warning" startIcon={<Settings />} onClick={onMigrate}>迁移全部旧版 Kickoff 赛程</Button>}
      {onOpenMatches && <Button variant="outlined" startIcon={<PlayArrow />} onClick={onOpenMatches}>去赛果录入配置首轮对阵</Button>}
    </Stack>
  </Stack>;
}

function ScheduleConfiguration({ config, teams, matches, migration, onMigrate, onChange, onOpenMatches }: { config: TournamentConfig; teams: Team[]; matches: MatchResult[]; migration: KickoffScheduleMigrationPreview; onMigrate?: () => void; onChange: (config: TournamentConfig) => void; onOpenMatches?: () => void }) {
  const isTripleElimination = config.format === "triple-elimination";
  const configRegion = tournamentRegion(config, matches);
  const eligibleTeams = config.scope === "international" ? teams : teams.filter((team) => team.region === configRegion);
  const groups = config.groupStage?.groups ?? [];
  function updateGroup(groupId: string, update: Partial<GroupConfig>) {
    onChange({ ...config, groupStage: { bestOf: config.groupStage?.bestOf ?? 3, groups: groups.map((group) => group.id === groupId ? { ...group, ...update } : group) } });
  }
  function addGroup() {
    const index = groups.length + 1;
    onChange({ ...config, groupStage: { bestOf: config.groupStage?.bestOf ?? 3, groups: [...groups, { id: `group-${index}`, name: `Group ${index}`, teamIds: [] }] } });
  }
  function removeGroup(groupId: string) {
    onChange({ ...config, groupStage: { bestOf: config.groupStage?.bestOf ?? 3, groups: groups.filter((group) => group.id !== groupId) } });
  }
  return <Stack spacing={2}>
    <Stack direction={{ xs: "column", md: "row" }} spacing={2} alignItems={{ md: "center" }}><Box sx={{ flex: 1 }}><Typography variant="h6">{config.name}</Typography><Typography variant="body2" color="text.secondary">{isTripleElimination ? "赛区赛事：12 队三败淘汰，胜者组 / 中间败者组 / 败者组固定衔接" : config.scope === "international" ? "国际赛事：四赛区自动分配名额，Swiss 战绩自动决定晋级队伍" : "赛区赛事：可视化配置小组分组与淘汰赛入口"}</Typography></Box><FormControl size="small" sx={{ minWidth: 190 }} disabled><InputLabel id={`${config.id}-format-label`}>赛事格式</InputLabel><Select labelId={`${config.id}-format-label`} label="赛事格式" value={config.format}><MenuItem value="triple-elimination">三败淘汰</MenuItem><MenuItem value="group-plus-playoffs">小组赛 + 淘汰赛</MenuItem><MenuItem value="swiss-plus-playoffs">Swiss + 淘汰赛</MenuItem></Select></FormControl>{isTripleElimination ? <TextField size="small" sx={{ minWidth: 260 }} label="淘汰赛起始" value="固定：胜者组第 1 轮（前四种子第 2 轮进入）" disabled /> : <FormControl size="small" sx={{ minWidth: 160 }}><InputLabel id={`${config.id}-start-label`}>淘汰赛起始</InputLabel><Select labelId={`${config.id}-start-label`} label="淘汰赛起始" value={config.bracket?.startRound ?? "quarterfinals"} onChange={(event) => onChange({ ...config, bracket: { type: config.bracket?.type ?? "double-elimination", teamRefs: config.bracket?.teamRefs ?? [], startRound: event.target.value as "quarterfinals" | "semifinals" } })}><MenuItem value="quarterfinals">四分之一决赛</MenuItem><MenuItem value="semifinals">半决赛</MenuItem></Select></FormControl>}</Stack>
    {config.scope === "international" && <MastersAllocationSummary teams={teams} matches={matches} eventId={config.eventId as "masters-1" | "masters-2"} />}
    {isTripleElimination ? <TripleEliminationConfiguration config={config} teams={teams} matches={matches} migration={migration} onChange={onChange} onMigrate={onMigrate} onOpenMatches={onOpenMatches} /> : config.scope === "international" ? <Alert severity="info" icon={<Settings />}>国际赛事的 12 个名额、Swiss 参赛队伍和淘汰赛入口由四赛区名额及队伍最终战绩自动计算，不需要手动配置抽签对阵。</Alert> : <>
      <Divider />
      <Stack direction="row" justifyContent="space-between" alignItems="center"><Box><Typography variant="subtitle1">小组 / Swiss 分组</Typography><Typography variant="body2" color="text.secondary">修改分组会同步重建常规赛对阵；仍在同一分组的相同对局会保留赛果。</Typography></Box><Button startIcon={<Add />} onClick={addGroup}>新增分组</Button></Stack>
      <Grid container spacing={2}>{groups.map((group) => <Grid key={group.id} size={{ xs: 12, md: 6 }}><Paper variant="outlined" sx={{ p: 2 }}><Stack direction="row" spacing={1} alignItems="center" mb={1.5}><TextField size="small" label="分组名称" value={group.name} onChange={(event) => updateGroup(group.id, { name: event.target.value })} sx={{ flex: 1 }} /><IconButton aria-label={`删除${group.name}`} size="small" onClick={() => removeGroup(group.id)} disabled={groups.length <= 1}><DeleteOutline /></IconButton></Stack><FormControl fullWidth size="small"><InputLabel id={`${config.id}-${group.id}-teams-label`}>队伍</InputLabel><Select multiple labelId={`${config.id}-${group.id}-teams-label`} label="队伍" value={group.teamIds} onChange={(event) => updateGroup(group.id, { teamIds: typeof event.target.value === "string" ? event.target.value.split(",") : event.target.value as string[] })} renderValue={(selected) => <Stack direction="row" spacing={0.5} flexWrap="wrap" useFlexGap>{(selected as string[]).map((teamId) => <Chip key={teamId} size="small" label={displayParticipant(teamId, new Map(teams.map((team) => [team.id, team])))} />)}</Stack>}>{eligibleTeams.map((team) => <MenuItem key={team.id} value={team.id}>{team.name}</MenuItem>)}</Select></FormControl></Paper></Grid>)}</Grid>
      <Alert severity="info" icon={<Settings />}>分组调整后会立即同步到“赛果录入”的小组赛列表。移出新分组的已录入赛果会先弹窗确认，确认后才会删除。</Alert>
    </>}
  </Stack>;
}

function TeamConfiguration({ teams, onChange }: { teams: Team[]; onChange: (teams: Team[]) => void }) {
  async function uploadLogo(teamId: string, file: File | undefined) {
    if (!file || !file.type.startsWith("image/")) return;
    try {
      const logoUrl = await readAndResizeLogo(file);
      onChange(teams.map((team) => team.id === teamId ? { ...team, logoUrl } : team));
    } catch {
      // The draft validator reports an actionable error if the data is invalid.
    }
  }
  function updateTeam(teamId: string, update: Partial<Team>) {
    onChange(teams.map((team) => team.id === teamId ? { ...team, ...update } : team));
  }
  return <Stack spacing={2}><Alert severity="info" icon={<ImageIcon />}>Logo 会压缩为不超过 256px 的 PNG 并随草稿保存，当前不依赖额外对象存储；以后接入 Vercel Blob 时可直接替换保存字段。</Alert><Paper variant="outlined" sx={{ overflowX: "auto" }}><Table size="small" aria-label="队伍配置表"><TableHead><TableRow><TableCell>Logo</TableCell><TableCell>赛区</TableCell><TableCell>队伍名称</TableCell><TableCell>简称</TableCell><TableCell>国家/地区</TableCell><TableCell>启用</TableCell></TableRow></TableHead><TableBody>{teams.map((team) => <TableRow key={team.id} hover><TableCell><Stack direction="row" spacing={1} alignItems="center"><Avatar src={team.logoUrl} variant="rounded" sx={{ width: 36, height: 36 }}>{team.shortName.slice(0, 2)}</Avatar><Button component="label" size="small" variant="outlined" startIcon={<UploadFile />}>上传<input hidden type="file" accept="image/png,image/jpeg,image/webp,image/svg+xml" onChange={(event) => void uploadLogo(team.id, event.target.files?.[0])} /></Button>{team.logoUrl && <Tooltip title="移除 Logo"><IconButton size="small" aria-label={`移除${team.name} Logo`} onClick={() => updateTeam(team.id, { logoUrl: undefined })}><DeleteOutline fontSize="small" /></IconButton></Tooltip>}</Stack></TableCell><TableCell><Chip size="small" label={regionLabels[team.region]} /></TableCell><TableCell><TextField size="small" value={team.name} onChange={(event) => updateTeam(team.id, { name: event.target.value })} inputProps={{ "aria-label": `${team.id} 队伍名称` }} /></TableCell><TableCell><TextField size="small" value={team.shortName} onChange={(event) => updateTeam(team.id, { shortName: event.target.value })} inputProps={{ "aria-label": `${team.id} 队伍简称` }} sx={{ width: 130 }} /></TableCell><TableCell><TextField size="small" value={team.country ?? ""} onChange={(event) => updateTeam(team.id, { country: event.target.value })} placeholder="例如 CN" sx={{ width: 120 }} /></TableCell><TableCell><FormControlLabel control={<Switch checked={team.active} onChange={(event) => updateTeam(team.id, { active: event.target.checked })} />} label={team.active ? "启用" : "停用"} /></TableCell></TableRow>)}</TableBody></Table></Paper></Stack>;
}

export function AdminPanel({ locale, initialDraft, draftLoadError }: { locale: Locale; initialDraft?: DraftPayload; draftLoadError?: { code?: string; message?: string } }) {
  const copy = getMessages(locale);
  const initial = useMemo(() => {
    const teams = initialDraft?.teams?.length ? initialDraft.teams : allDemoTeams();
    const generated = createFullSchedule(teams);
    return { teams, ...hydrateDraftSchedule(generated, initialDraft, teams) };
  }, [initialDraft]);
  const [region, setRegion] = useState<RegionId>("amer");
  const [teams, setTeams] = useState<Team[]>(() => initial.teams);
  const [matches, setMatches] = useState<MatchResult[]>(() => initial.matches);
  const [tournaments, setTournaments] = useState<TournamentConfig[]>(() => initial.tournaments);
  const [eventFilter, setEventFilter] = useState("all");
  const [phaseFilter, setPhaseFilter] = useState<"all" | "group" | "swiss" | "playoffs">("all");
  const [tab, setTab] = useState<AdminTab>("matches");
  const [revision, setRevision] = useState(() => initialDraft?.revision ?? 1);
  const [analysis, setAnalysis] = useState<RegionAnalysis | null>(null);
  const [analysisState, setAnalysisState] = useState<"idle" | "running" | "done" | "error">("idle");
  const draftLoadBlocked = Boolean(draftLoadError && draftLoadError.code !== "DATABASE_NOT_CONFIGURED");
  const draftLoadMessage = draftLoadError?.code === "LOAD_FAILED"
    ? `${draftLoadError.message ?? "草稿读取失败"} 当前仅显示默认预览数据，已暂停保存，请修复数据库连接后刷新页面。`
    : draftLoadError?.message;
  const [message, setMessage] = useState<{ severity: "success" | "info" | "error"; text: string } | null>(() => draftLoadMessage ? { severity: draftLoadBlocked ? "error" : "info", text: draftLoadMessage } : null);
  const [draftStatus, setDraftStatus] = useState<"clean" | "dirty" | "saving" | "saved" | "error" | "conflict">("clean");
  const [isPending, startTransition] = useTransition();
  const teamById = useMemo(() => new Map(teams.map((team) => [team.id, team])), [teams]);
  const matchesById = useMemo(() => new Map(matches.map((match) => [match.id, match])), [matches]);
  const payload = useMemo<DraftPayload>(() => ({ seasonId: "vct-2026", revision, matches, teams, tournaments }), [matches, revision, teams, tournaments]);
  const kickoffMigration = useMemo(() => inspectKickoffScheduleMigration(matches), [matches]);
  const changeTokenRef = useRef(0);
  const saveInFlightRef = useRef(false);
  const visibleEvent = eventFilter === "all" ? null : eventTemplate(eventFilter);
  const visibleMatches = useMemo(() => matches.filter((match) => {
    const matchesEvent = eventFilter === "all" || match.eventId === eventFilter;
    const matchesScope = visibleEvent?.scope === "international"
      ? match.region === "global"
      : eventFilter === "all"
        ? match.region === "global" || match.region === region
        : match.region === region;
    return matchesEvent && matchesScope && (phaseFilter === "all" || match.phase === phaseFilter);
  }), [eventFilter, matches, phaseFilter, region, visibleEvent]);
  const bracketMatches = visibleMatches.filter((match) => match.phase === "playoffs");
  const listMatches = visibleMatches.filter((match) => match.phase === "group");

  function markDraftChanged() {
    changeTokenRef.current += 1;
    setDraftStatus("dirty");
  }

  function saveDraftNow(snapshot: DraftPayload) {
    if (saveInFlightRef.current) return;
    saveInFlightRef.current = true;
    const tokenAtStart = changeTokenRef.current;
    setDraftStatus("saving");
    startTransition(async () => {
      try {
        const result = await saveDraft(snapshot);
        if (result.ok) {
          if (result.revision) setRevision(result.revision);
          setDraftStatus(changeTokenRef.current === tokenAtStart ? "saved" : "dirty");
          setMessage({ severity: "success", text: `草稿已保存，revision ${result.revision}` });
        } else {
          setDraftStatus(result.code === "REVISION_CONFLICT" ? "conflict" : "error");
          setMessage({ severity: result.code === "DATABASE_NOT_CONFIGURED" ? "info" : "error", text: result.message ?? "草稿保存失败，请稍后重试" });
        }
      } catch {
        setDraftStatus("error");
        setMessage({ severity: "error", text: "草稿保存失败，请稍后重试" });
      } finally {
        saveInFlightRef.current = false;
      }
    });
  }

  function applyMatchUpdates(updates: MatchUpdate[]) {
    const updateById = new Map(updates.map(({ id, update }) => [id, update]));
    const nextMatches = syncMastersQualificationMatches(matches.map((match) => {
      const update = updateById.get(match.id);
      return update ? { ...match, ...update } : match;
    }), teams);
    const syncedTournaments = syncMastersQualificationTournaments(tournaments, nextMatches, teams);
    const hasSwissRecords = syncedTournaments.some((tournament) => tournament.format === "swiss-plus-playoffs" && (tournament.swissRecords?.length ?? 0) > 0);
    setMatches(hasSwissRecords ? syncMastersSwissRecordMatches(nextMatches, syncedTournaments) : nextMatches);
    setTournaments(syncedTournaments);
    markDraftChanged();
  }
  function updateMatch(id: string, update: Partial<MatchResult>) {
    applyMatchUpdates([{ id, update }]);
  }
  function updateTournament(config: TournamentConfig) {
    const previous = tournaments.find((item) => item.id === config.id);
    const previousRefs = previous?.bracket?.teamRefs ?? [];
    const nextRefs = config.bracket?.teamRefs ?? [];
    const seedOrderChanged = previous?.format === "triple-elimination" && config.format === "triple-elimination" && JSON.stringify(previousRefs) !== JSON.stringify(nextRefs);
    const groupStageChanged = previous?.scope === "regional"
      && config.scope === "regional"
      && previous.format === "group-plus-playoffs"
      && config.format === "group-plus-playoffs"
      && JSON.stringify(previous.groupStage?.groups ?? []) !== JSON.stringify(config.groupStage?.groups ?? []);
    let nextMatches = matches;
    let clearedResults = false;
    let rebuiltGroupSchedule = false;
    let removedGroupResults = 0;
    if (groupStageChanged) {
      const rebuilt = rebuildRegionalGroupMatches(nextMatches, config);
      if (rebuilt.removedResults.length > 0 && typeof window !== "undefined" && !window.confirm(`调整分组会移除 ${rebuilt.removedResults.length} 场已录入的常规赛赛果。确认后这些赛果将从当前草稿中删除，是否继续？`)) return;
      if (rebuilt.matches !== nextMatches) {
        nextMatches = rebuilt.matches;
        rebuiltGroupSchedule = true;
        removedGroupResults = rebuilt.removedResults.length;
      }
    }
    if (seedOrderChanged) {
      const seedRegion = tournamentRegion(config, matches);
      const regionMatches = seedRegion ? nextMatches.filter((match) => match.eventId === config.eventId && match.region === seedRegion && match.phase === "playoffs") : [];
      const legacySchedule = regionMatches.length > 0 && (regionMatches.length !== 30 || !regionMatches.some((match) => match.bracketRound === "Middle Bracket Round 1"));
      if (legacySchedule) {
        setMessage({ severity: "error", text: "请先点击“迁移全部旧版 Kickoff 赛程”，再配置种子顺位。" });
        return;
      }
      const hasResults = regionMatches.some((match) => match.status !== "scheduled");
      if (hasResults && typeof window !== "undefined" && !window.confirm("修改种子顺位会清空该赛区 Kickoff 淘汰赛的已有赛果，以避免沿用错误的对阵结果。是否继续？")) return;
      nextMatches = applyTripleEliminationSeedOrder(nextMatches, config).map((match) => {
        if (!seedRegion || match.eventId !== config.eventId || match.region !== seedRegion || match.phase !== "playoffs" || !hasResults) return match;
        return { ...match, status: "scheduled", winner: undefined, maps: [], playedAt: undefined, notes: undefined };
      });
      clearedResults = hasResults;
    }
    nextMatches = syncMastersQualificationMatches(nextMatches, teams);
    const nextTournaments = syncMastersQualificationTournaments(tournaments.map((item) => item.id === config.id ? config : item), nextMatches, teams);
    const swissRecordsChanged = previous?.format === "swiss-plus-playoffs"
      && config.format === "swiss-plus-playoffs"
      && JSON.stringify(previous.swissRecords ?? []) !== JSON.stringify(config.swissRecords ?? []);
    if (swissRecordsChanged) nextMatches = syncMastersSwissRecordMatches(nextMatches, nextTournaments);
    setTournaments(nextTournaments);
    if (nextMatches !== matches) setMatches(nextMatches);
    markDraftChanged();
    if (rebuiltGroupSchedule && clearedResults) {
      setMessage({ severity: "info", text: `分组已更新，常规赛对阵已同步${removedGroupResults > 0 ? `，移除了 ${removedGroupResults} 场旧赛果` : ""}；种子顺位更新后 Kickoff 淘汰赛旧赛果也已清空，请重新录入并保存草稿。` });
    } else if (rebuiltGroupSchedule) {
      setMessage({ severity: "success", text: `分组已更新，常规赛对阵已同步${removedGroupResults > 0 ? `，移除了 ${removedGroupResults} 场旧赛果` : ""}。` });
    } else if (clearedResults) {
      setMessage({ severity: "info", text: "种子顺位已更新，该赛区 Kickoff 淘汰赛旧赛果已清空，请重新录入并保存草稿。" });
    }
  }
  function updateTeams(nextTeams: Team[]) {
    setTeams(nextTeams);
    const nextMatches = syncMastersQualificationMatches(matches, nextTeams);
    const nextTournaments = syncMastersQualificationTournaments(tournaments, nextMatches, nextTeams);
    const hasSwissRecords = nextTournaments.some((tournament) => tournament.format === "swiss-plus-playoffs" && (tournament.swissRecords?.length ?? 0) > 0);
    setMatches(hasSwissRecords ? syncMastersSwissRecordMatches(nextMatches, nextTournaments) : nextMatches);
    setTournaments(nextTournaments);
    markDraftChanged();
  }
  function migrateKickoff() {
    try {
      const migrated = migrateKickoffSchedule({ matches, teams, tournaments });
      if (migrated.migratedRegions.length === 0) {
        setMessage({ severity: "info", text: "当前草稿已经是新版 Kickoff 赛程，无需迁移。" });
        return;
      }
      setMatches(migrated.matches);
      setTournaments(migrated.tournaments);
      markDraftChanged();
      setMessage({ severity: "success", text: `已迁移 ${migrated.migratedRegions.map((region) => regionLabels[region]).join("、")} 的 Kickoff 赛程。请确认首轮对阵后点击“保存草稿”。` });
    } catch (error) {
      const blockedRegions = error instanceof Error && error.message.startsWith("KICKOFF_MIGRATION_HAS_RESULTS:")
        ? error.message.slice("KICKOFF_MIGRATION_HAS_RESULTS:".length).split(",").map((region) => regionLabels[region as RegionId] ?? region).join("、")
        : "部分赛区";
      setMessage({ severity: "error", text: `无法自动迁移 ${blockedRegions} 的旧版 Kickoff 赛程；旧版后续轮次已有赛果，请保留原草稿并手动按新版对阵录入。` });
    }
  }
  function runAction(action: "validate" | "save") {
    if (draftLoadBlocked) {
      setMessage({ severity: "error", text: draftLoadMessage ?? "草稿尚未成功读取，请刷新页面后重试。" });
      return;
    }
    if (action === "save") {
      saveDraftNow(payload);
      return;
    }
    startTransition(async () => {
      const result = await validateDraft(payload);
      setMessage({ severity: result.ok ? "success" : result.code === "DATABASE_NOT_CONFIGURED" ? "info" : "error", text: result.ok ? "草稿校验通过，可以启动精确计算。" : result.message ?? "操作失败" });
    });
  }
  function runCalculation() {
    setAnalysisState("running"); setAnalysis(null);
    const worker = runRegionWorker(demoSimulation(region));
    worker.promise.then((result) => { setAnalysis(result); setAnalysisState("done"); }).catch(() => setAnalysisState("error"));
  }

  const kickoffMigrationAlert = kickoffMigration.legacyRegions.length > 0
    ? <Alert severity={kickoffMigration.blockedRegions.length > 0 ? "error" : "warning"} action={kickoffMigration.canMigrate ? <Button color="inherit" size="small" onClick={migrateKickoff}>迁移 Kickoff</Button> : undefined}>
      {kickoffMigration.blockedRegions.length > 0
        ? `检测到旧版 Kickoff 对阵图，且 ${kickoffMigration.blockedRegions.map((item) => regionLabels[item]).join("、")} 的后续轮次已有赛果，无法自动迁移；请先保留当前草稿，再按新版对阵手动录入。`
        : `当前草稿仍使用旧版 Kickoff 对阵图（${kickoffMigration.legacyRegions.map((item) => regionLabels[item]).join("、")}）。迁移后会保留首轮已录入结果，并显示新版胜者组 / 中间败者组 / 败者组。`}
    </Alert>
    : null;

  const selectedConfig = eventFilter === "all"
    ? tournaments.find((config) => config.scope === "regional" && tournamentRegion(config, matches) === region) ?? tournaments[0]
    : tournaments.find((config) => config.eventId === eventFilter && (config.scope === "international" || tournamentRegion(config, matches) === region));

  return <Container maxWidth="xl" sx={{ py: { xs: 3, md: 6 } }}>
    <Stack spacing={1} mb={3}><Typography variant="h1" sx={{ fontSize: { xs: "2rem", md: "3rem" } }}>{copy.adminTitle}</Typography><Typography color="text.secondary">使用 MUI 控件录入全年赛果、配置赛程、维护队伍和 Logo；国际赛为全球唯一赛事，不按赛区重复。</Typography><Stack direction={{ xs: "column", sm: "row" }} spacing={1} alignItems={{ sm: "center" }}><Chip label="MUI 管理界面" variant="outlined" /><Chip label={`${matches.length} 场已建赛程`} variant="outlined" /><Button component="a" href="/api/auth/login" size="small" startIcon={<Login />}>使用 LSCube 登录</Button></Stack></Stack>
    {message && <Alert severity={message.severity} sx={{ mb: 3 }}>{message.text}</Alert>}
    <Card><CardContent>
      <Stack direction={{ xs: "column", md: "row" }} justifyContent="space-between" gap={2} mb={2}><Stack direction={{ xs: "column", sm: "row" }} spacing={1}><FormControl size="small" sx={{ minWidth: 130 }} disabled={visibleEvent?.scope === "international"}><InputLabel id="admin-region-label">范围</InputLabel><Select labelId="admin-region-label" label="范围" value={visibleEvent?.scope === "international" ? "global" : region} onChange={(event) => { if (event.target.value !== "global") setRegion(event.target.value as RegionId); }}>{visibleEvent?.scope === "international" && <MenuItem value="global">国际赛事</MenuItem>}{(["amer", "emea", "pacific", "china"] as RegionId[]).map((item) => <MenuItem key={item} value={item}>{regionLabels[item]}</MenuItem>)}</Select></FormControl><FormControl size="small" sx={{ minWidth: 210 }}><InputLabel id="admin-event-label">赛事</InputLabel><Select labelId="admin-event-label" label="赛事" value={eventFilter} onChange={(event) => { setEventFilter(event.target.value); setPhaseFilter("all"); }}><MenuItem value="all">全年赛事</MenuItem>{EVENT_TEMPLATES.map((event) => <MenuItem key={event.id} value={event.id}>{event.label}{event.scope === "international" ? " · 国际" : " · 赛区"}</MenuItem>)}</Select></FormControl><FormControl size="small" sx={{ minWidth: 170 }}><InputLabel id="admin-phase-label">阶段</InputLabel><Select labelId="admin-phase-label" label="阶段" value={phaseFilter} onChange={(event) => setPhaseFilter(event.target.value as typeof phaseFilter)}><MenuItem value="all">全部阶段</MenuItem><MenuItem value="group">小组赛列表</MenuItem><MenuItem value="swiss">Swiss 队伍战绩</MenuItem><MenuItem value="playoffs">淘汰赛图</MenuItem></Select></FormControl></Stack><Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap><Button variant="outlined" startIcon={<Check />} onClick={() => runAction("validate")} disabled={isPending || draftLoadBlocked}>{copy.validate}</Button><Button variant="contained" startIcon={<Save />} onClick={() => runAction("save")} disabled={isPending || draftLoadBlocked}>{copy.saveDraft}</Button></Stack></Stack>
      <Tabs value={tab} onChange={(_, value: AdminTab) => setTab(value)} aria-label="赛事管理标签" sx={{ mb: 3 }}><Tab value="matches" label="赛果录入" icon={<Check />} iconPosition="start" /><Tab value="schedule" label="赛程配置" icon={<Groups />} iconPosition="start" /><Tab value="teams" label="队伍配置" icon={<ImageIcon />} iconPosition="start" /></Tabs>
      {tab === "matches" && <Stack spacing={2}><Alert severity="info">小组赛仍使用列表逐场录入，淘汰赛使用对阵图输入。Masters Swiss 只为每支队伍填写最终战绩（2-0、2-1、1-2、0-2），不录入抽签对阵、单场赛果或地图比分；填满后 2-0 和 2-1 的队伍会自动进入淘汰赛。普通完赛必须填写每张地图的回合比分，弃权只填写原因，不填地图。草稿允许保留未完成赛果，请点击“保存草稿”手动保存。</Alert>{kickoffMigrationAlert}{visibleEvent?.scope === "international" && selectedConfig?.format === "swiss-plus-playoffs" && (phaseFilter === "all" || phaseFilter === "swiss") && <SwissRecordsConfiguration config={selectedConfig} matches={matches} teams={teams} onChange={updateTournament} />}{phaseFilter === "swiss" ? <Alert severity="info">Swiss 队伍最终战绩已在上方录入；该阶段不再维护抽签对阵。</Alert> : phaseFilter === "playoffs" ? <BracketBoard matches={bracketMatches.length > 0 ? bracketMatches : visibleMatches} teams={teamById} matchesById={matchesById} onChange={updateMatch} /> : phaseFilter === "all" && bracketMatches.length > 0 && listMatches.length > 0 ? <><Typography variant="h6">小组赛列表</Typography><GroupMatchList matches={listMatches} teams={teamById} matchesById={matchesById} onChange={updateMatch} /><Typography variant="h6" mt={2}>淘汰赛对阵图</Typography><BracketBoard matches={bracketMatches} teams={teamById} matchesById={matchesById} onChange={updateMatch} /></> : listMatches.length > 0 ? <GroupMatchList matches={listMatches} teams={teamById} matchesById={matchesById} onChange={updateMatch} /> : bracketMatches.length > 0 ? <BracketBoard matches={bracketMatches} teams={teamById} matchesById={matchesById} onChange={updateMatch} /> : <GroupMatchList matches={[]} teams={teamById} matchesById={matchesById} onChange={updateMatch} />}</Stack>}
      {tab === "schedule" && <Stack spacing={2}><Alert severity="info">Masters Santiago 和 Masters London 是不属于任何赛区的国际赛事：四赛区名额自动计算为各 3 队，Swiss 参赛队伍及最终战绩在“赛果录入”页维护，淘汰赛入口会自动更新，不需要填写抽签对阵。</Alert>{selectedConfig ? <ScheduleConfiguration config={selectedConfig} teams={teams} matches={matches} migration={kickoffMigration} onMigrate={migrateKickoff} onChange={updateTournament} onOpenMatches={() => { setEventFilter(selectedConfig.eventId); setPhaseFilter("playoffs"); setTab("matches"); }} /> : <Typography color="text.secondary">请选择赛事配置。</Typography>}</Stack>}
      {tab === "teams" && <TeamConfiguration teams={teams} onChange={updateTeams} />}
    </CardContent></Card>
    <Stack direction={{ xs: "column", md: "row" }} spacing={2} mt={3}><Card sx={{ flex: 1 }}><CardContent><Stack direction="row" spacing={1} alignItems="center"><PlayArrow color="primary" /><Typography variant="h6">精确计算</Typography></Stack><Typography variant="body2" color="text.secondary" mt={1}>校验通过后，浏览器 Web Worker 会对当前赛区未完成系列赛进行等可能枚举。</Typography><Button sx={{ mt: 2 }} variant="contained" startIcon={<PlayArrow />} onClick={runCalculation} disabled={analysisState === "running"}>{analysisState === "running" ? "计算中…" : "启动预览计算"}</Button>{analysisState === "error" && <Alert severity="error" sx={{ mt: 2 }}>Worker 计算失败，请刷新后重试。</Alert>}{analysis && <Typography variant="body2" color="text.secondary" mt={2}>完成：{analysis.scenarioGroups.length} 个精确情景，{analysis.totalOutcomes} 个等可能结果。</Typography>}</CardContent></Card><Card sx={{ flex: 1 }}><CardContent><Typography variant="h6">草稿状态</Typography><Typography variant="body2" color="text.secondary" mt={1}>revision {revision} · {teams.filter((team) => team.active).length} 支启用队伍 · {tournaments.length} 个赛事配置</Typography><Stack direction="row" spacing={1} mt={2}><Chip size="small" label={tab === "matches" ? "正在录入赛果" : tab === "schedule" ? "正在配置赛程" : "正在维护队伍"} /><Chip size="small" label={draftStatus === "clean" ? "就绪" : draftStatus === "dirty" ? "有未保存修改" : draftStatus === "saving" ? "保存中" : draftStatus === "saved" ? "已保存" : draftStatus === "conflict" ? "版本冲突" : "保存失败"} color={draftStatus === "saving" ? "warning" : draftStatus === "error" || draftStatus === "conflict" ? "error" : draftStatus === "dirty" ? "warning" : draftStatus === "saved" ? "success" : "default"} /></Stack></CardContent></Card></Stack>
  </Container>;
}
