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
import { runRegionWorker } from "@/lib/engine/worker-client";
import { getMessages } from "@/lib/i18n/messages";
import { createFullSchedule, EVENT_TEMPLATES, eventTemplate, MAP_POOL } from "@/lib/schedule";
import type { RegionAnalysis } from "@/lib/types";
import type { DraftPayload, GroupConfig, Locale, MatchResult, MatchStatus, RegionId, Team, TournamentConfig } from "@/lib/types";
import { saveDraft, validateDraft } from "@/app/[locale]/admin/actions";

type AdminTab = "matches" | "schedule" | "teams";

const regionLabels: Record<RegionId, string> = {
  amer: "AMER",
  emea: "EMEA",
  pacific: "PACIFIC",
  china: "CN",
};

function displayParticipant(ref: string, teams: Map<string, Team>): string {
  const team = teams.get(ref);
  if (team) return team.shortName || team.name;
  if (ref.startsWith("winner:")) return `胜者 · ${ref.slice("winner:".length)}`;
  if (ref.startsWith("loser:")) return `败者 · ${ref.slice("loser:".length)}`;
  if (ref.startsWith("seed:")) return `种子 · ${ref.slice("seed:".length)}`;
  return ref;
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

function MatchControls({ match, teams, onChange }: { match: MatchResult; teams: Map<string, Team>; onChange: (update: Partial<MatchResult>) => void }) {
  const selectableWinner = [match.teamA, match.teamB];
  function updateStatus(status: MatchStatus) {
    onChange({ status, winner: status === "scheduled" || status === "cancelled" ? undefined : match.winner, maps: status === "scheduled" || status === "forfeit" || status === "cancelled" ? [] : match.maps });
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
            <MenuItem value="">待定</MenuItem>{selectableWinner.map((teamId) => <MenuItem key={teamId} value={teamId}>{displayParticipant(teamId, teams)}</MenuItem>)}
          </Select>
        </FormControl>
        <Chip size="small" label={`Bo${match.bestOf ?? 3}`} variant="outlined" />
      </Stack>
      <MapScoreEditor match={match} onChange={(maps) => onChange({ maps })} />
      {(match.status === "forfeit" || match.status === "cancelled") && <TextField size="small" label={match.status === "forfeit" ? "弃权原因" : "取消原因"} value={match.notes ?? ""} onChange={(event) => onChange({ notes: event.target.value })} multiline minRows={2} fullWidth />}
    </Stack>
  );
}

function GroupMatchList({ matches, teams, onChange }: { matches: MatchResult[]; teams: Map<string, Team>; onChange: (id: string, update: Partial<MatchResult>) => void }) {
  return (
    <Paper variant="outlined" sx={{ overflowX: "auto" }}>
      <Table size="small" aria-label="小组赛结果列表">
        <TableHead><TableRow><TableCell>轮次 / 对阵</TableCell><TableCell sx={{ minWidth: 520 }}>赛果与地图比分</TableCell></TableRow></TableHead>
        <TableBody>
          {matches.map((match) => <TableRow key={match.id} hover><TableCell sx={{ verticalAlign: "top", minWidth: 220 }}><Typography variant="caption" color="text.secondary" display="block">{match.roundLabel ?? match.phase}</Typography><Typography fontWeight={700}>{displayParticipant(match.teamA, teams)}</Typography><Typography variant="body2" color="text.secondary">vs</Typography><Typography fontWeight={700}>{displayParticipant(match.teamB, teams)}</Typography><Typography variant="caption" color="text.secondary" display="block" mt={0.5}>{match.id}</Typography></TableCell><TableCell><MatchControls match={match} teams={teams} onChange={(update) => onChange(match.id, update)} /></TableCell></TableRow>)}
          {matches.length === 0 && <TableRow><TableCell colSpan={2}><Typography color="text.secondary" textAlign="center" py={4}>当前筛选没有比赛</Typography></TableCell></TableRow>}
        </TableBody>
      </Table>
    </Paper>
  );
}

function BracketMatchCard({ match, teams, onChange }: { match: MatchResult; teams: Map<string, Team>; onChange: (id: string, update: Partial<MatchResult>) => void }) {
  return (
    <Card variant="outlined" sx={{ minWidth: 260, mb: 2 }}>
      <CardContent sx={{ p: 1.5, "&:last-child": { pb: 1.5 } }}>
        <Typography variant="caption" color="text.secondary" display="block" mb={0.75}>{bracketRoundLabel(match.bracketRound ?? match.roundLabel)}</Typography>
        <Stack spacing={0.5} mb={1.25}><Stack direction="row" justifyContent="space-between" gap={1}><Typography variant="body2" fontWeight={700}>{displayParticipant(match.teamA, teams)}</Typography>{match.winner === match.teamA && <Chip size="small" color="success" label="胜" />}</Stack><Divider /><Stack direction="row" justifyContent="space-between" gap={1}><Typography variant="body2" fontWeight={700}>{displayParticipant(match.teamB, teams)}</Typography>{match.winner === match.teamB && <Chip size="small" color="success" label="胜" />}</Stack></Stack>
        <MatchControls match={match} teams={teams} onChange={(update) => onChange(match.id, update)} />
      </CardContent>
    </Card>
  );
}

function FirstRoundConfiguration({ matches, teams, onChange }: { matches: MatchResult[]; teams: Team[]; onChange: (id: string, update: Partial<MatchResult>) => void }) {
  const firstRound = firstRoundMatches(matches);
  if (firstRound.length === 0) return null;

  const teamById = new Map(teams.map((team) => [team.id, team]));
  function candidatesFor(match: MatchResult): Team[] {
    return teams.filter((team) => team.active && (match.region === "global" || team.region === match.region));
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

function BracketBoard({ matches, teams, onChange }: { matches: MatchResult[]; teams: Map<string, Team>; onChange: (id: string, update: Partial<MatchResult>) => void }) {
  const rounds = [...new Set(matches.map((match) => match.bracketRound ?? "淘汰赛"))].sort((left, right) => {
    return bracketRoundRank(left) - bracketRoundRank(right);
  });
  return <Stack spacing={2}><FirstRoundConfiguration matches={matches} teams={[...teams.values()]} onChange={onChange} /><Box sx={{ overflowX: "auto", pb: 1 }}><Box sx={{ display: "grid", gridTemplateColumns: `repeat(${Math.max(rounds.length, 1)}, minmax(280px, 1fr))`, gap: 2, minWidth: Math.max(rounds.length, 1) * 280 }}>{rounds.map((round) => <Box key={round}><Typography variant="subtitle2" color="text.secondary" mb={1}>{bracketRoundLabel(round)}</Typography>{matches.filter((match) => (match.bracketRound ?? "淘汰赛") === round).map((match) => <BracketMatchCard key={match.id} match={match} teams={teams} onChange={onChange} />)}</Box>)}</Box></Box></Stack>;
}

function TripleEliminationConfiguration({ config, teams, onOpenMatches }: { config: TournamentConfig; teams: Team[]; onOpenMatches?: () => void }) {
  const eligibleTeams = teams.filter((team) => config.scope === "international" || config.id.endsWith(team.region));
  const configuredRefs = config.bracket?.teamRefs ?? [];
  const teamRefs = [...new Set([...configuredRefs, ...eligibleTeams.map((team) => team.id)])].slice(0, 12);
  const teamById = new Map(teams.map((team) => [team.id, team]));
  const sections = [
    { title: "胜者组", detail: "4 场首轮 · 4 场第二轮 · 2 场第三轮 · 1 场决赛", note: "前四种子从第二轮进入" },
    { title: "中间败者组", detail: "4 场第一轮 · 2 场第二轮 · 2 场第三轮 · 1 场第四轮 · 1 场决赛", note: "胜者组首次失利后进入" },
    { title: "败者组", detail: "2 场第一轮 · 2 场第二轮 · 2 场第三轮 · 1 场第四轮 · 1 场第五轮 · 1 场决赛", note: "第二次失利后进入，第三次失利淘汰" },
  ];
  return <Stack spacing={2}>
    <Alert severity="info" icon={<Settings />}>Kickoff 的赛制结构固定为 12 队三败淘汰。这里展示轮次和种子入口；实际首轮双方请到“赛果录入 → 淘汰赛图”中配置，避免配置页和已录入赛果互相覆盖。</Alert>
    <Grid container spacing={2}>{sections.map((section) => <Grid key={section.title} size={{ xs: 12, md: 4 }}><Card variant="outlined" sx={{ height: "100%" }}><CardContent><Typography variant="subtitle1" fontWeight={700}>{section.title}</Typography><Typography variant="body2" sx={{ mt: 1 }}>{section.detail}</Typography><Typography variant="caption" color="text.secondary" display="block" sx={{ mt: 1 }}>{section.note}</Typography></CardContent></Card></Grid>)}</Grid>
    <Paper variant="outlined" sx={{ p: 2 }}>
      <Typography variant="subtitle1" fontWeight={700}>种子入口</Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5, mb: 1.5 }}>前四个种子轮空到胜者组第 2 轮，其余八队组成胜者组第 1 轮的四场对阵。</Typography>
      <Stack spacing={1.5}>
        <Box><Typography variant="caption" color="text.secondary" display="block" sx={{ mb: 0.75 }}>胜者组第 2 轮 · 轮空种子</Typography><Stack direction="row" spacing={0.75} flexWrap="wrap" useFlexGap>{teamRefs.slice(0, 4).map((teamId) => <Chip key={teamId} size="small" label={displayParticipant(teamId, teamById)} />)}</Stack></Box>
        <Box><Typography variant="caption" color="text.secondary" display="block" sx={{ mb: 0.75 }}>胜者组第 1 轮 · 首轮队伍</Typography><Stack direction="row" spacing={0.75} flexWrap="wrap" useFlexGap>{teamRefs.slice(4, 12).map((teamId) => <Chip key={teamId} size="small" variant="outlined" label={displayParticipant(teamId, teamById)} />)}</Stack></Box>
      </Stack>
    </Paper>
    {onOpenMatches && <Button variant="outlined" startIcon={<PlayArrow />} onClick={onOpenMatches} sx={{ alignSelf: "flex-start" }}>去赛果录入配置首轮对阵</Button>}
  </Stack>;
}

function ScheduleConfiguration({ config, teams, onChange, onOpenMatches }: { config: TournamentConfig; teams: Team[]; onChange: (config: TournamentConfig) => void; onOpenMatches?: () => void }) {
  const isTripleElimination = config.format === "triple-elimination";
  const eligibleTeams = config.scope === "international" ? teams : teams.filter((team) => config.id.endsWith(team.region));
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
    <Stack direction={{ xs: "column", md: "row" }} spacing={2} alignItems={{ md: "center" }}><Box sx={{ flex: 1 }}><Typography variant="h6">{config.name}</Typography><Typography variant="body2" color="text.secondary">{isTripleElimination ? "赛区赛事：12 队三败淘汰，胜者组 / 中间败者组 / 败者组固定衔接" : config.scope === "international" ? "全球赛事：四赛区各 3 队，8 队 Swiss 晋级 8 队淘汰赛" : "赛区赛事：可视化配置小组分组与淘汰赛入口"}</Typography></Box><FormControl size="small" sx={{ minWidth: 190 }} disabled><InputLabel id={`${config.id}-format-label`}>赛事格式</InputLabel><Select labelId={`${config.id}-format-label`} label="赛事格式" value={config.format}><MenuItem value="triple-elimination">三败淘汰</MenuItem><MenuItem value="group-plus-playoffs">小组赛 + 淘汰赛</MenuItem><MenuItem value="swiss-plus-playoffs">Swiss + 淘汰赛</MenuItem></Select></FormControl>{isTripleElimination ? <TextField size="small" sx={{ minWidth: 260 }} label="淘汰赛起始" value="固定：胜者组第 1 轮（前四种子第 2 轮进入）" disabled /> : <FormControl size="small" sx={{ minWidth: 160 }}><InputLabel id={`${config.id}-start-label`}>淘汰赛起始</InputLabel><Select labelId={`${config.id}-start-label`} label="淘汰赛起始" value={config.bracket?.startRound ?? "quarterfinals"} onChange={(event) => onChange({ ...config, bracket: { type: config.bracket?.type ?? "double-elimination", teamRefs: config.bracket?.teamRefs ?? [], startRound: event.target.value as "quarterfinals" | "semifinals" } })}><MenuItem value="quarterfinals">四分之一决赛</MenuItem><MenuItem value="semifinals">半决赛</MenuItem></Select></FormControl>}</Stack>
    {isTripleElimination ? <TripleEliminationConfiguration config={config} teams={teams} onOpenMatches={onOpenMatches} /> : <>
      <Divider />
      <Stack direction="row" justifyContent="space-between" alignItems="center"><Box><Typography variant="subtitle1">小组 / Swiss 分组</Typography><Typography variant="body2" color="text.secondary">当前使用多选框保存队伍归属；不会覆盖已经录入的比赛结果。</Typography></Box><Button startIcon={<Add />} onClick={addGroup}>新增分组</Button></Stack>
      <Grid container spacing={2}>{groups.map((group) => <Grid key={group.id} size={{ xs: 12, md: 6 }}><Paper variant="outlined" sx={{ p: 2 }}><Stack direction="row" spacing={1} alignItems="center" mb={1.5}><TextField size="small" label="分组名称" value={group.name} onChange={(event) => updateGroup(group.id, { name: event.target.value })} sx={{ flex: 1 }} /><IconButton aria-label={`删除${group.name}`} size="small" onClick={() => removeGroup(group.id)} disabled={groups.length <= 1}><DeleteOutline /></IconButton></Stack><FormControl fullWidth size="small"><InputLabel id={`${config.id}-${group.id}-teams-label`}>队伍</InputLabel><Select multiple labelId={`${config.id}-${group.id}-teams-label`} label="队伍" value={group.teamIds} onChange={(event) => updateGroup(group.id, { teamIds: typeof event.target.value === "string" ? event.target.value.split(",") : event.target.value as string[] })} renderValue={(selected) => <Stack direction="row" spacing={0.5} flexWrap="wrap" useFlexGap>{(selected as string[]).map((teamId) => <Chip key={teamId} size="small" label={displayParticipant(teamId, new Map(teams.map((team) => [team.id, team])))} />)}</Stack>}>{eligibleTeams.map((team) => <MenuItem key={team.id} value={team.id}>{team.name}</MenuItem>)}</Select></FormControl></Paper></Grid>)}</Grid>
      <Alert severity="info" icon={<Settings />}>分组和淘汰赛起始设置会保存到草稿，用于后续校验；已生成的对阵和已录入赛果请在“赛果录入”页维护。</Alert>
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

export function AdminPanel({ locale, initialDraft }: { locale: Locale; initialDraft?: DraftPayload }) {
  const copy = getMessages(locale);
  const initial = useMemo(() => { const teams = allDemoTeams(); return { teams, ...createFullSchedule(teams) }; }, []);
  const [region, setRegion] = useState<RegionId>("amer");
  const [teams, setTeams] = useState<Team[]>(() => initialDraft?.teams ?? initial.teams);
  const [matches, setMatches] = useState<MatchResult[]>(() => initialDraft?.matches ?? initial.matches);
  const [tournaments, setTournaments] = useState<TournamentConfig[]>(() => initialDraft?.tournaments ?? initial.tournaments);
  const [eventFilter, setEventFilter] = useState("all");
  const [phaseFilter, setPhaseFilter] = useState<"all" | "group" | "swiss" | "playoffs">("all");
  const [tab, setTab] = useState<AdminTab>("matches");
  const [revision, setRevision] = useState(() => initialDraft?.revision ?? 1);
  const [analysis, setAnalysis] = useState<RegionAnalysis | null>(null);
  const [analysisState, setAnalysisState] = useState<"idle" | "running" | "done" | "error">("idle");
  const [message, setMessage] = useState<{ severity: "success" | "info" | "error"; text: string } | null>(null);
  const [draftStatus, setDraftStatus] = useState<"clean" | "dirty" | "saving" | "saved" | "error" | "conflict">("clean");
  const [isPending, startTransition] = useTransition();
  const teamById = useMemo(() => new Map(teams.map((team) => [team.id, team])), [teams]);
  const payload = useMemo<DraftPayload>(() => ({ seasonId: "vct-2026", revision, matches, teams, tournaments }), [matches, revision, teams, tournaments]);
  const changeTokenRef = useRef(0);
  const saveInFlightRef = useRef(false);
  const visibleMatches = useMemo(() => matches.filter((match) => (match.region === "global" || match.region === region) && (eventFilter === "all" || match.eventId === eventFilter) && (phaseFilter === "all" || match.phase === phaseFilter)), [eventFilter, matches, phaseFilter, region]);
  const visibleEvent = eventFilter === "all" ? null : eventTemplate(eventFilter);
  const bracketMatches = visibleMatches.filter((match) => match.phase === "playoffs");
  const listMatches = visibleMatches.filter((match) => match.phase !== "playoffs");

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

  function updateMatch(id: string, update: Partial<MatchResult>) {
    setMatches((current) => current.map((match) => match.id === id ? { ...match, ...update } : match));
    markDraftChanged();
  }
  function updateTournament(config: TournamentConfig) {
    setTournaments((current) => current.map((item) => item.id === config.id ? config : item));
    markDraftChanged();
  }
  function updateTeams(nextTeams: Team[]) {
    setTeams(nextTeams);
    markDraftChanged();
  }
  function runAction(action: "validate" | "save") {
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

  const selectedConfig = eventFilter === "all" ? tournaments.find((config) => config.scope === "regional" && config.id.endsWith(region)) ?? tournaments[0] : tournaments.find((config) => config.eventId === eventFilter && (config.scope === "international" || config.id.endsWith(region)));

  return <Container maxWidth="xl" sx={{ py: { xs: 3, md: 6 } }}>
    <Stack spacing={1} mb={3}><Typography variant="h1" sx={{ fontSize: { xs: "2rem", md: "3rem" } }}>{copy.adminTitle}</Typography><Typography color="text.secondary">使用 MUI 控件录入全年赛果、配置赛程、维护队伍和 Logo；国际赛为全球唯一赛事，不按赛区重复。</Typography><Stack direction={{ xs: "column", sm: "row" }} spacing={1} alignItems={{ sm: "center" }}><Chip label="MUI 管理界面" variant="outlined" /><Chip label={`${matches.length} 场已建赛程`} variant="outlined" /><Button component="a" href="/api/auth/login" size="small" startIcon={<Login />}>使用 LSCube 登录</Button></Stack></Stack>
    {message && <Alert severity={message.severity} sx={{ mb: 3 }}>{message.text}</Alert>}
    <Card><CardContent>
      <Stack direction={{ xs: "column", md: "row" }} justifyContent="space-between" gap={2} mb={2}><Stack direction={{ xs: "column", sm: "row" }} spacing={1}><FormControl size="small" sx={{ minWidth: 130 }}><InputLabel id="admin-region-label">赛区</InputLabel><Select labelId="admin-region-label" label="赛区" value={region} onChange={(event) => setRegion(event.target.value as RegionId)}>{(["amer", "emea", "pacific", "china"] as RegionId[]).map((item) => <MenuItem key={item} value={item}>{regionLabels[item]}</MenuItem>)}</Select></FormControl><FormControl size="small" sx={{ minWidth: 210 }}><InputLabel id="admin-event-label">赛事</InputLabel><Select labelId="admin-event-label" label="赛事" value={eventFilter} onChange={(event) => { setEventFilter(event.target.value); setPhaseFilter("all"); }}><MenuItem value="all">全年赛事</MenuItem>{EVENT_TEMPLATES.map((event) => <MenuItem key={event.id} value={event.id}>{event.label}{event.scope === "international" ? " · 全球" : " · 赛区"}</MenuItem>)}</Select></FormControl><FormControl size="small" sx={{ minWidth: 170 }}><InputLabel id="admin-phase-label">阶段</InputLabel><Select labelId="admin-phase-label" label="阶段" value={phaseFilter} onChange={(event) => setPhaseFilter(event.target.value as typeof phaseFilter)}><MenuItem value="all">全部阶段</MenuItem><MenuItem value="group">小组赛列表</MenuItem><MenuItem value="swiss">Swiss 列表</MenuItem><MenuItem value="playoffs">淘汰赛图</MenuItem></Select></FormControl></Stack><Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap><Button variant="outlined" startIcon={<Check />} onClick={() => runAction("validate")} disabled={isPending}>{copy.validate}</Button><Button variant="contained" startIcon={<Save />} onClick={() => runAction("save")} disabled={isPending}>{copy.saveDraft}</Button></Stack></Stack>
      <Tabs value={tab} onChange={(_, value: AdminTab) => setTab(value)} aria-label="赛事管理标签" sx={{ mb: 3 }}><Tab value="matches" label="赛果录入" icon={<Check />} iconPosition="start" /><Tab value="schedule" label="赛程配置" icon={<Groups />} iconPosition="start" /><Tab value="teams" label="队伍配置" icon={<ImageIcon />} iconPosition="start" /></Tabs>
      {tab === "matches" && <Stack spacing={2}><Alert severity="info">小组赛和 Swiss 使用列表输入；淘汰赛使用对阵图输入。普通完赛必须填写每张地图的回合比分，弃权只填写原因，不填地图。草稿允许保留未完成赛果，请点击“保存草稿”手动保存。</Alert>{phaseFilter === "playoffs" || (bracketMatches.length > 0 && listMatches.length === 0) ? <BracketBoard matches={bracketMatches.length > 0 ? bracketMatches : visibleMatches} teams={teamById} onChange={updateMatch} /> : phaseFilter === "all" && bracketMatches.length > 0 && listMatches.length > 0 ? <><Typography variant="h6">小组赛 / Swiss 列表</Typography><GroupMatchList matches={listMatches} teams={teamById} onChange={updateMatch} /><Typography variant="h6" mt={2}>淘汰赛对阵图</Typography><BracketBoard matches={bracketMatches} teams={teamById} onChange={updateMatch} /></> : <GroupMatchList matches={listMatches.length > 0 ? listMatches : visibleMatches} teams={teamById} onChange={updateMatch} />}</Stack>}
      {tab === "schedule" && <Stack spacing={2}><Alert severity="info">Masters Santiago 和 Masters London 按 2026 赛制建模为 12 队全球赛事：四赛区各 3 队，8 队 Swiss，前 4 晋级 8 队双败淘汰。分组配置在这里维护；实际对阵和赛果在“赛果录入”页维护。</Alert>{selectedConfig ? <ScheduleConfiguration config={selectedConfig} teams={teams} onChange={updateTournament} onOpenMatches={() => { setEventFilter(selectedConfig.eventId); setPhaseFilter("playoffs"); setTab("matches"); }} /> : <Typography color="text.secondary">请选择赛事配置。</Typography>}</Stack>}
      {tab === "teams" && <TeamConfiguration teams={teams} onChange={updateTeams} />}
    </CardContent></Card>
    <Stack direction={{ xs: "column", md: "row" }} spacing={2} mt={3}><Card sx={{ flex: 1 }}><CardContent><Stack direction="row" spacing={1} alignItems="center"><PlayArrow color="primary" /><Typography variant="h6">精确计算</Typography></Stack><Typography variant="body2" color="text.secondary" mt={1}>校验通过后，浏览器 Web Worker 会对当前赛区未完成系列赛进行等可能枚举。</Typography><Button sx={{ mt: 2 }} variant="contained" startIcon={<PlayArrow />} onClick={runCalculation} disabled={analysisState === "running"}>{analysisState === "running" ? "计算中…" : "启动预览计算"}</Button>{analysisState === "error" && <Alert severity="error" sx={{ mt: 2 }}>Worker 计算失败，请刷新后重试。</Alert>}{analysis && <Typography variant="body2" color="text.secondary" mt={2}>完成：{analysis.scenarioGroups.length} 个精确情景，{analysis.totalOutcomes} 个等可能结果。</Typography>}</CardContent></Card><Card sx={{ flex: 1 }}><CardContent><Typography variant="h6">草稿状态</Typography><Typography variant="body2" color="text.secondary" mt={1}>revision {revision} · {teams.filter((team) => team.active).length} 支启用队伍 · {tournaments.length} 个赛事配置</Typography><Stack direction="row" spacing={1} mt={2}><Chip size="small" label={tab === "matches" ? "正在录入赛果" : tab === "schedule" ? "正在配置赛程" : "正在维护队伍"} /><Chip size="small" label={draftStatus === "clean" ? "就绪" : draftStatus === "dirty" ? "有未保存修改" : draftStatus === "saving" ? "保存中" : draftStatus === "saved" ? "已保存" : draftStatus === "conflict" ? "版本冲突" : "保存失败"} color={draftStatus === "saving" ? "warning" : draftStatus === "error" || draftStatus === "conflict" ? "error" : draftStatus === "dirty" ? "warning" : draftStatus === "saved" ? "success" : "default"} /></Stack></CardContent></Card></Stack>
  </Container>;
}
