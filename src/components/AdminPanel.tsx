"use client";

import { useMemo, useState, useTransition } from "react";
import { Alert, Box, Button, Card, CardContent, Chip, Container, Divider, MenuItem, Select, Stack, Table, TableBody, TableCell, TableHead, TableRow, TextField, Typography } from "@mui/material";
import { Check, CloudUpload, Login, PlayArrow } from "@mui/icons-material";
import { demoSimulation, demoTeams } from "@/lib/data/demo";
import { runRegionWorker } from "@/lib/engine/worker-client";
import type { Locale, MatchResult, RegionAnalysis, RegionId } from "@/lib/types";
import { getMessages } from "@/lib/i18n/messages";
import { saveDraft, validateDraft } from "@/app/[locale]/admin/actions";

const eventTemplates: Array<{ id: string; label: string; stage: MatchResult["stage"] }> = [
  { id: "kickoff", label: "Kickoff", stage: "kickoff" },
  { id: "masters-1", label: "Masters Santiago", stage: "masters-1" },
  { id: "stage-1", label: "Stage 1", stage: "stage-1" },
  { id: "masters-2", label: "Masters London", stage: "masters-2" },
  { id: "stage-2", label: "Stage 2", stage: "stage-2" },
];

function initialMatches(region: RegionId): MatchResult[] {
  const teams = demoTeams(region);
  return eventTemplates.flatMap((event, eventIndex) => {
    const count = event.stage === "stage-2" ? 3 : 2;
    return Array.from({ length: count }, (_, matchIndex) => {
      const teamA = teams[(eventIndex + matchIndex) % teams.length];
      const teamB = teams[(eventIndex + matchIndex + 2) % teams.length];
      return {
        id: `${region}-${event.id}-${matchIndex + 1}`,
        eventId: event.id,
        region,
        stage: event.stage,
        teamA: teamA.id,
        teamB: teamB.id,
        status: "scheduled" as const,
        maps: [],
        isRegularSeason: event.stage === "stage-1" || event.stage === "stage-2",
        isTiebreaker: false,
      };
    });
  });
}

function parseMapScores(raw: string) {
  if (!raw.trim()) return [];
  return raw.split(",").map((token, index) => {
    const match = token.trim().match(/^(.*?)\s+(\d+)\s*-\s*(\d+)$/);
    if (!match) return null;
    return { map: match[1].trim() || `Map ${index + 1}`, teamARounds: Number(match[2]), teamBRounds: Number(match[3]) };
  }).filter((value): value is { map: string; teamARounds: number; teamBRounds: number } => value !== null);
}

export function AdminPanel({ locale }: { locale: Locale }) {
  const copy = getMessages(locale);
  const [region, setRegion] = useState<RegionId>("amer");
  const [matches, setMatches] = useState<MatchResult[]>(() => initialMatches("amer"));
  const [eventFilter, setEventFilter] = useState("all");
  const [mapText, setMapText] = useState<Record<string, string>>({});
  const [revision, setRevision] = useState(1);
  const [analysis, setAnalysis] = useState<RegionAnalysis | null>(null);
  const [analysisState, setAnalysisState] = useState<"idle" | "running" | "done" | "error">("idle");
  const [message, setMessage] = useState<{ severity: "success" | "info" | "error"; text: string } | null>(null);
  const [isPending, startTransition] = useTransition();
  const payload = useMemo(() => ({ seasonId: "vct-2026", revision, matches }), [matches, revision]);

  function changeRegion(nextRegion: RegionId) {
    setRegion(nextRegion);
    setMatches(initialMatches(nextRegion));
    setEventFilter("all");
    setMapText({});
    setAnalysis(null);
    setAnalysisState("idle");
    setRevision(1);
    setMessage(null);
  }

  function updateMatch(id: string, update: Partial<MatchResult>) {
    setMatches((current) => current.map((match) => match.id === id ? { ...match, ...update } : match));
  }

  function updateMaps(id: string, raw: string) {
    setMapText((current) => ({ ...current, [id]: raw }));
    updateMatch(id, { maps: parseMapScores(raw) });
  }

  function runAction(action: "validate" | "save") {
    startTransition(async () => {
      const result = action === "validate" ? await validateDraft(payload) : await saveDraft(payload);
      setMessage({ severity: result.ok ? "success" : result.code === "DATABASE_NOT_CONFIGURED" ? "info" : "error", text: result.ok ? (action === "validate" ? "草稿校验通过，可以启动精确计算。" : `草稿已保存，revision ${result.revision}`) : result.message ?? "操作失败" });
      if (result.ok && result.revision) setRevision(result.revision);
    });
  }

  function runCalculation() {
    setAnalysisState("running");
    setAnalysis(null);
    const worker = runRegionWorker(demoSimulation(region));
    worker.promise.then((result) => {
      setAnalysis(result);
      setAnalysisState("done");
    }).catch(() => setAnalysisState("error"));
  }

  return (
    <Container maxWidth="xl" sx={{ py: { xs: 3, md: 6 } }}>
      <Stack spacing={1} mb={4}><Typography variant="h1" sx={{ fontSize: { xs: "2.5rem", md: "4rem" } }}>{copy.adminTitle}</Typography><Typography color="text.secondary">{copy.adminIntro}</Typography><Stack direction={{ xs: "column", sm: "row" }} spacing={1} alignItems={{ sm: "center" }}><Chip label="Preview · OAuth access is required in production" variant="outlined" sx={{ alignSelf: "flex-start" }} /><Button component="a" href="/api/auth/login" size="small" startIcon={<Login />}>使用 LSCube 登录</Button></Stack></Stack>
      {message && <Alert severity={message.severity} sx={{ mb: 3 }}>{message.text}</Alert>}
      <Card><CardContent><Stack direction={{ xs: "column", sm: "row" }} justifyContent="space-between" gap={2} mb={2}><Stack direction="row" spacing={1}><Select size="small" value={region} onChange={(event) => changeRegion(event.target.value as RegionId)} aria-label="选择赛区">{(["amer", "emea", "pacific", "china"] as RegionId[]).map((item) => <MenuItem key={item} value={item}>{item.toUpperCase()}</MenuItem>)}</Select><Select size="small" value={eventFilter} onChange={(event) => setEventFilter(event.target.value)} aria-label="筛选赛事"><MenuItem value="all">全年赛事</MenuItem>{eventTemplates.map((event) => <MenuItem key={event.id} value={event.id}>{event.label}</MenuItem>)}</Select></Stack><Stack direction="row" spacing={1}><Button variant="outlined" startIcon={<Check />} onClick={() => runAction("validate")} disabled={isPending}>{copy.validate}</Button><Button variant="contained" startIcon={<CloudUpload />} onClick={() => runAction("save")} disabled={isPending}>{copy.saveDraft}</Button></Stack></Stack><Typography variant="caption" color="text.secondary" display="block" mb={2}>地图比分格式：地图名 回合数-回合数；多张地图用逗号分隔，例如 Haven 13-8, Ascent 13-10。</Typography><Divider /><Box sx={{ overflowX: "auto" }}><Table aria-label="赛事结果编辑表格"><TableHead><TableRow><TableCell>Event / Match</TableCell><TableCell>Team A</TableCell><TableCell>Team B</TableCell><TableCell>Status</TableCell><TableCell>Winner</TableCell><TableCell>Map rounds</TableCell></TableRow></TableHead><TableBody>{matches.filter((match) => eventFilter === "all" || match.eventId === eventFilter).map((match) => <TableRow key={match.id}><TableCell><Typography variant="body2" fontFamily="monospace">{match.eventId} / {match.id}</Typography></TableCell><TableCell>{match.teamA}</TableCell><TableCell>{match.teamB}</TableCell><TableCell><Select size="small" value={match.status} onChange={(event) => updateMatch(match.id, { status: event.target.value as MatchResult["status"] })}><MenuItem value="scheduled">Scheduled</MenuItem><MenuItem value="completed">Completed</MenuItem><MenuItem value="forfeit">Forfeit</MenuItem></Select></TableCell><TableCell><Select size="small" displayEmpty value={match.winner ?? ""} onChange={(event) => updateMatch(match.id, { winner: event.target.value || undefined })}><MenuItem value="">—</MenuItem><MenuItem value={match.teamA}>{match.teamA}</MenuItem><MenuItem value={match.teamB}>{match.teamB}</MenuItem></Select></TableCell><TableCell><TextField size="small" value={mapText[match.id] ?? match.maps.map((map) => `${map.map} ${map.teamARounds}-${map.teamBRounds}`).join(", ")} onChange={(event) => updateMaps(match.id, event.target.value)} placeholder="Haven 13-8" inputProps={{ "aria-label": `${match.id} map score` }} disabled={match.status === "scheduled"} /></TableCell></TableRow>)}</TableBody></Table></Box></CardContent></Card>
      <Stack direction={{ xs: "column", md: "row" }} spacing={2} mt={3}><Card sx={{ flex: 1 }}><CardContent><Stack direction="row" spacing={1} alignItems="center"><PlayArrow color="primary" /><Typography variant="h6">精确计算</Typography></Stack><Typography variant="body2" color="text.secondary" mt={1}>校验通过后，浏览器 Web Worker 会对未完成系列赛进行等可能枚举；结果按赛区分块上传。</Typography><Button sx={{ mt: 2 }} variant="contained" startIcon={<PlayArrow />} onClick={runCalculation} disabled={analysisState === "running"}> {analysisState === "running" ? "计算中…" : "启动预览计算"}</Button>{analysisState === "error" && <Alert severity="error" sx={{ mt: 2 }}>Worker 计算失败，请刷新后重试。</Alert>}{analysis && <Typography variant="body2" color="text.secondary" mt={2}>完成：{analysis.scenarioGroups.length} 个精确情景，{analysis.totalOutcomes} 个等可能结果。</Typography>}</CardContent></Card><Card sx={{ flex: 1 }}><CardContent><Typography variant="h6">{copy.noDatabase}</Typography><Typography variant="body2" color="text.secondary" mt={1}>revision {revision} · {matches.length} matches in current draft</Typography></CardContent></Card></Stack>
    </Container>
  );
}
