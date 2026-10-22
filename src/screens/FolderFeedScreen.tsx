import React, { useEffect, useRef, useState } from "react";
import { Pressable, ScrollView, Text, StyleSheet } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import * as Clipboard from "expo-clipboard";
import Screen from "../components/Screen";
import { Colors, Spacing, Typography } from "../theme";
import { requestStashFolderFeed, subscribeStashSyncStatus, type StashSyncStatus } from "../db/syncClient";
import { STASH_SYNC_DEV_TOOLS } from "../utils/syncBuildGate";

type Settings = { version: 1; policy: "always-on"; enabled: true; backend: string; url: string; limit: number };
function validate(value: unknown): Settings {
  const s = value as Settings;
  if (!s || s.version !== 1 || s.enabled !== true || s.policy !== "always-on" || typeof s.backend !== "string" || typeof s.url !== "string" || s.url.length > 2048 || s.limit !== 50) throw new Error("Backend does not support automatic private folder feeds.");
  const url = new URL(s.url), base = new URL(s.backend);
  if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash || base.origin !== s.backend || url.origin !== base.origin || !url.pathname.startsWith("/feeds/folders/") || !url.pathname.endsWith(".atom")) throw new Error("Backend returned an unsafe feed URL.");
  return { version: 1, policy: "always-on", enabled: true, backend: s.backend, url: s.url, limit: 50 };
}
export default function FolderFeedScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const [sync, setSync] = useState<StashSyncStatus | null>(null);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [preview, setPreview] = useState("");
  const epoch = useRef(0);
  const pending = useRef<AbortController | null>(null);
  const identity = useRef("");

  useEffect(() => {
    if (!STASH_SYNC_DEV_TOOLS) return;
    const unsubscribe = subscribeStashSyncStatus((next) => {
      const key = next.phase === "synced" && !next.disconnecting && !next.restartRequired && next.account ? JSON.stringify(next.account) : "";
      if (identity.current !== key) {
        identity.current = key;
        epoch.current++;
        pending.current?.abort(); pending.current = null;
        setSettings(null); setPreview(""); setBusy(false); setMessage("");
      }
      setSync(next);
    });
    return () => { unsubscribe(); epoch.current++; pending.current?.abort(); pending.current = null; };
  }, []);

  const ready = STASH_SYNC_DEV_TOOLS && sync?.phase === "synced" && !!sync.account && !sync.disconnecting && !sync.restartRequired;
  const request = async (action: "status" | "preview") => {
    if (!ready || pending.current) return;
    const controller = new AbortController(); pending.current = controller;
    const generation = ++epoch.current;
    setBusy(true); setMessage(""); setPreview("");
    try {
      const response = await requestStashFolderFeed(id, action, controller.signal);
      if (!response.ok) throw new Error(response.status === 404 ? "Folder/feed unavailable, or backend lacks automatic private feeds. Refresh or check Settings → Sync." : response.status === 503 ? "Backend feed hosting is not configured." : `Feed request failed (HTTP ${response.status}). Retry to confirm current status.`);
      if (action === "preview") {
        if (!(response.headers.get("Content-Type") ?? "").startsWith("application/atom+xml")) throw new Error("Backend preview is incompatible.");
        const xml = await response.text();
        if (xml.length > 6000000) throw new Error("Preview too large.");
        if (generation === epoch.current && !controller.signal.aborted) setPreview(xml);
      } else {
        const result = validate(await response.json());
        if (new URL(result.url).pathname !== `/feeds/folders/${encodeURIComponent(id)}.atom`) throw new Error("Backend returned a different folder's feed URL.");
        if (generation === epoch.current && !controller.signal.aborted) setSettings(result);
      }
    } catch (error) {
      if (generation === epoch.current && !controller.signal.aborted) {
        setSettings(null); setPreview("");
        setMessage(error instanceof Error ? error.message : "Feed unavailable. Retry to confirm current status.");
      }
    } finally {
      if (generation === epoch.current) { pending.current = null; setBusy(false); }
    }
  };

  useEffect(() => {
    epoch.current++; pending.current?.abort(); pending.current = null;
    setSettings(null); setPreview(""); setBusy(false);
    if (ready) void request("status");
    return () => { epoch.current++; pending.current?.abort(); pending.current = null; };
  }, [id, ready, sync?.account?.serverUrl, sync?.account?.username]);

  const copy = async () => {
    if (!settings || !ready || busy) return;
    const generation = epoch.current;
    try {
      await Clipboard.setStringAsync(settings.url);
      if (generation === epoch.current) setMessage("Clean Atom URL copied (no credentials).");
    } catch { if (generation === epoch.current) setMessage("Could not copy URL."); }
  };
  const unavailable = !STASH_SYNC_DEV_TOOLS ? "Feeds require an Android development or explicitly opted-in sync build." : !ready ? "Connect/prepare in Settings → Sync and wait for a complete exchange. Offline, recovery-pending and disconnected sessions cannot confirm publication." : "Refresh to confirm backend feed status.";
  const action = (label: string, onPress: () => void, disabled = false) => <Pressable accessibilityRole="button" disabled={disabled} onPress={onPress} style={[styles.button, disabled && { opacity: 0.5 }]}><Text style={styles.link}>{label}</Text></Pressable>;
  return <Screen options={{ title: "Folder feed" }}><ScrollView contentContainerStyle={styles.body}>
    <Text style={styles.heading}>{busy ? "Pending — waiting for backend confirmation…" : settings ? "Available — private authenticated feed" : "Unavailable — status not confirmed"}</Text>
    <Text style={styles.text}>{sync?.account?.serverUrl ?? "No active backend"}</Text>
    {!ready && <Text style={styles.text}>{unavailable}</Text>}
    {!!message && <Text accessibilityRole="alert" style={styles.text}>{message}</Text>}
    <Text style={styles.text}>The backend hosts this Atom feed; your phone need not stay online. Only the latest 50 active text/link items are included, not a full export. Future eligible items added to this folder appear after sync. Local edits appear after sync.</Text>
    <Text style={styles.text}>Readers need your existing account-wide Basic login, not folder-only access. Give it only to a trusted reader/aggregator (at the actual fetcher). Every active folder has a private feed automatically. Archiving the folder stops future fetches; reader caches cannot be recalled. Unarchiving restores availability at the same URL.</Text>
    {settings && <Text selectable style={styles.text}>{settings.url}</Text>}
    {action("Refresh / Retry", () => void request("status"), !ready || busy)}
    {settings && action("Copy Atom URL", () => void copy(), !ready || busy)}
    {action("Preview Atom XML", () => void request("preview"), !ready || busy)}
    {action("Settings → Sync", () => router.push("/settings/sync"))}
    {!!preview && <><Text style={styles.heading}>Atom preview (plaintext XML; not a WebView)</Text><Text selectable style={styles.text}>{preview}</Text></>}
  </ScrollView></Screen>;
}
const styles = StyleSheet.create({
  body: { padding: Spacing.md, gap: Spacing.md }, heading: { ...Typography.subheading },
  text: { ...Typography.body, color: Colors.textSecondary },
  button: { padding: Spacing.md, backgroundColor: Colors.surface }, link: { ...Typography.body, color: Colors.accent },
});
