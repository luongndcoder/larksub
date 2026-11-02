import { openExternalUrl } from "@getpaseo/plugin/client";
import { copyText, Modal, TextInput, useToast } from "@getpaseo/plugin/client/react-native";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, Image, Pressable, Text, View } from "react-native";
import { cancelLogin, startLogin } from "../shared/rpc";
import { describe, useStore, type LarkSubStore } from "./store";
import { Badge, Button, Card, useText, type Theme } from "./ui";

export function AddAccountModal({
  theme,
  store,
  onClose,
}: {
  theme: Theme;
  store: LarkSubStore;
  onClose(): void;
}) {
  const text = useText(theme);
  const toast = useToast();
  const { state } = useStore(store);
  const [label, setLabel] = useState("");
  const [appId, setAppId] = useState("");
  const [appSecret, setAppSecret] = useState("");
  const [brand, setBrand] = useState<"lark" | "feishu">("lark");
  const [useCustomApp, setUseCustomApp] = useState(true);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const pending = state?.pendingLogin ?? null;
  const hostAppId = state?.appConfig?.appId ?? null;

  useEffect(() => store.watchClosely(), [store]);

  useEffect(() => {
    if (state?.appConfig?.brand === "feishu") setBrand("feishu");
  }, [state?.appConfig?.brand]);

  const handleStart = useCallback(async () => {
    setStarting(true);
    setError(null);
    try {
      const trimmedAppId = appId.trim();
      if (useCustomApp) {
        if (!trimmedAppId) {
          throw new Error("Paste your own App ID (cli_a...) — do not use the host's app on a shared machine.");
        }
        if (!appSecret.trim()) {
          throw new Error("App Secret is required when using your own App ID.");
        }
        await store.rpc(startLogin, {
          label: label.trim() || undefined,
          domain: "all",
          appId: trimmedAppId,
          appSecret: appSecret.trim(),
          brand,
        });
      } else {
        await store.rpc(startLogin, {
          label: label.trim() || undefined,
          domain: "all",
        });
      }
    } catch (err) {
      setError(describe(err));
    } finally {
      setStarting(false);
    }
  }, [store, label, appId, appSecret, brand, useCustomApp]);

  const startedOnce = useRef(false);
  useEffect(() => {
    // Only auto-start when reusing the host app. Custom-app mode requires
    // the user to paste App ID + Secret first, otherwise the QR points at
    // the host owner's personal app and Lark rejects other tenants with
    // "You don't have the access to ...".
    if (!startedOnce.current && !pending && !useCustomApp) {
      startedOnce.current = true;
      void handleStart();
    }
  }, [handleStart, pending, useCustomApp]);

  useEffect(() => {
    if (pending?.status === "authorized") {
      toast.show(`Authorized Lark account: ${pending.authorizedUserName ?? "Success"}`, { variant: "success" });
      const timer = setTimeout(() => {
        void store.rpc(cancelLogin, {}).catch(() => undefined);
        onClose();
      }, 900);
      return () => clearTimeout(timer);
    }
  }, [pending?.status, pending?.authorizedUserName, store, toast, onClose]);

  const handleCancel = useCallback(async () => {
    try {
      await store.rpc(cancelLogin, {});
    } catch {
      // ignore
    }
    onClose();
  }, [store, onClose]);

  const handleCopyLink = useCallback(async () => {
    if (!pending?.verificationUrl) return;
    await copyText(pending.verificationUrl);
    toast.show("Verification link copied", { variant: "success" });
  }, [pending?.verificationUrl, toast]);

  const inputStyle = useMemo(
    () => ({
      color: theme.colors.foreground,
      backgroundColor: theme.colors.surface2,
      borderColor: theme.colors.border,
      borderWidth: 1,
      borderRadius: 8,
      paddingHorizontal: 12,
      paddingVertical: 10,
      fontSize: 14,
    }),
    [theme],
  );

  const monoSmall = useMemo(
    () => ({ color: theme.colors.foregroundMuted, fontSize: 12 }),
    [theme],
  );

  return (
    <Modal title="Add Lark Account (QR / OAuth)" open onOpenChange={(open) => (open ? undefined : void handleCancel())}>
      <Modal.Content>
        <View style={{ gap: 14 }}>
          <Text style={text.muted}>
            Each member authorizes with their own Lark app. Create an app at open.larksuite.com, then paste its App ID +
            Secret below before generating the QR. Using another person's app fails with "You don't have the access".
          </Text>

          <View style={{ gap: 6 }}>
            <Text style={text.small}>Optional display label (defaults to your Lark full name)</Text>
            <TextInput
              value={label}
              onChangeText={setLabel}
              placeholder="e.g. Nguyễn Danh Lương"
              placeholderTextColor={theme.colors.foregroundMuted}
              style={inputStyle}
            />
          </View>

          <Pressable
            accessibilityRole="checkbox"
            onPress={() => setUseCustomApp((v) => !v)}
            style={{ flexDirection: "row", alignItems: "center", gap: 8 }}
          >
            <View
              style={{
                width: 18,
                height: 18,
                borderRadius: 5,
                borderWidth: 1,
                borderColor: theme.colors.border,
                backgroundColor: useCustomApp ? "#059669" : "transparent",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              {useCustomApp ? <Text style={{ color: "#fff", fontSize: 12 }}>✓</Text> : null}
            </View>
            <Text style={text.body}>Use my own Lark app (recommended on shared hosts)</Text>
          </Pressable>

          {useCustomApp ? (
            <View style={{ gap: 8 }}>
              <View style={{ gap: 6 }}>
                <Text style={text.small}>Your App ID (cli_a...)</Text>
                <TextInput
                  value={appId}
                  onChangeText={setAppId}
                  placeholder="cli_a..."
                  autoCapitalize="none"
                  placeholderTextColor={theme.colors.foregroundMuted}
                  style={inputStyle}
                />
              </View>
              <View style={{ gap: 6 }}>
                <Text style={text.small}>Your App Secret</Text>
                <TextInput
                  value={appSecret}
                  onChangeText={setAppSecret}
                  placeholder="Paste from Lark Developer Console"
                  autoCapitalize="none"
                  secureTextEntry
                  placeholderTextColor={theme.colors.foregroundMuted}
                  style={inputStyle}
                />
              </View>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                <Text style={text.small}>Brand:</Text>
                {(["lark", "feishu"] as const).map((b) => (
                  <Pressable
                    key={b}
                    onPress={() => setBrand(b)}
                    style={{
                      paddingHorizontal: 10,
                      paddingVertical: 5,
                      borderRadius: 7,
                      borderWidth: 1,
                      borderColor: brand === b ? "#059669" : theme.colors.border,
                      backgroundColor: brand === b ? "#05966922" : "transparent",
                    }}
                  >
                    <Text style={brand === b ? text.body : text.muted}>{b}</Text>
                  </Pressable>
                ))}
              </View>
              <Text style={monoSmall}>
                How to get these: open.larksuite.com → Create Custom App → Credentials & Basic Info → copy App ID /
                App Secret → enable needed scopes → publish a version.
              </Text>
            </View>
          ) : (
            <Text style={text.small}>
              Reusing host app{hostAppId ? `: ${hostAppId}` : ""}. Only works if that app is published to your tenant —
              otherwise Lark shows "You don't have the access".
            </Text>
          )}

          <View style={{ flexDirection: "row", gap: 8 }}>
            <Button
              theme={theme}
              tone="primary"
              label={pending ? "Regenerate QR" : "Generate QR"}
              icon="QrCode"
              busy={starting}
              onPress={() => void handleStart()}
            />
            {pending ? (
              <Button
                theme={theme}
                label="Refresh QR"
                icon="RefreshCw"
                busy={starting}
                onPress={() => void handleStart()}
              />
            ) : null}
          </View>

          {error ? <Text style={text.danger}>{error}</Text> : null}

          {starting && !pending ? (
            <View style={{ paddingVertical: 24, alignItems: "center", gap: 10 }}>
              <ActivityIndicator size="small" color="#10b981" />
              <Text style={text.muted}>Generating Lark OAuth QR code…</Text>
            </View>
          ) : null}

          {pending ? (
            <Card theme={theme}>
              <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
                <Text style={text.strong}>Device Authorization</Text>
                <Badge
                  theme={theme}
                  label={
                    pending.status === "authorized"
                      ? "Authorized"
                      : pending.status === "failed"
                        ? "Failed"
                        : "Waiting for confirmation…"
                  }
                  tone={
                    pending.status === "authorized"
                      ? "success"
                      : pending.status === "failed"
                        ? "danger"
                        : "accent"
                  }
                />
              </View>
              {pending.appId ? <Text style={text.small}>Authorizing into app: {pending.appId}</Text> : null}

              {pending.qrDataUrl ? (
                <View
                  style={{
                    alignSelf: "center",
                    padding: 12,
                    borderRadius: 12,
                    backgroundColor: "#ffffff",
                    borderWidth: 1,
                    borderColor: theme.colors.border,
                  }}
                >
                  <Image source={{ uri: pending.qrDataUrl }} style={{ width: 210, height: 210 }} resizeMode="contain" />
                </View>
              ) : null}

              <View style={{ alignItems: "center", gap: 4 }}>
                <Text style={text.small}>User Code</Text>
                <Text selectable style={text.mono}>
                  {pending.userCode}
                </Text>
              </View>

              {pending.error ? <Text style={text.danger}>{pending.error}</Text> : null}

              <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8, justifyContent: "center" }}>
                <Button
                  theme={theme}
                  tone="primary"
                  icon="ExternalLink"
                  label="Open Lark Auth Page"
                  onPress={() => void openExternalUrl(pending.verificationUrl)}
                />
                <Button theme={theme} icon="Copy" label="Copy Link" onPress={() => void handleCopyLink()} />
              </View>
            </Card>
          ) : null}

          <View style={{ flexDirection: "row", justifyContent: "flex-end", gap: 8 }}>
            <Button theme={theme} label="Close" onPress={() => void handleCancel()} />
          </View>
        </View>
      </Modal.Content>
    </Modal>
  );
}
