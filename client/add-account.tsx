import { openExternalUrl } from "@getpaseo/plugin/client";
import { copyText, Modal, TextInput, useToast } from "@getpaseo/plugin/client/react-native";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, Image, Text, View } from "react-native";
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
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const startedOnce = useRef(false);

  const pending = state?.pendingLogin ?? null;

  useEffect(() => store.watchClosely(), [store]);

  const handleStart = useCallback(
    async (customLabel?: string) => {
      setStarting(true);
      setError(null);
      try {
        await store.rpc(startLogin, {
          label: (customLabel ?? label).trim() || undefined,
          domain: "all",
        });
      } catch (err) {
        setError(describe(err));
      } finally {
        setStarting(false);
      }
    },
    [store, label],
  );

  useEffect(() => {
    if (!startedOnce.current && !pending) {
      startedOnce.current = true;
      void handleStart("");
    }
  }, [handleStart, pending]);

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

  return (
    <Modal title="Add Lark Account (QR / OAuth)" open onOpenChange={(open) => (open ? undefined : void handleCancel())}>
      <Modal.Content>
        <View style={{ gap: 14 }}>
          <Text style={text.muted}>
            Scan the QR code with your Lark mobile app or open the verification link in your browser to authorize your
            personal Lark account for Paseo sessions.
          </Text>

          <View style={{ gap: 6 }}>
            <Text style={text.small}>Optional display label (defaults to your Lark full name)</Text>
            <View style={{ flexDirection: "row", gap: 8, alignItems: "center" }}>
              <View style={{ flex: 1 }}>
                <TextInput
                  value={label}
                  onChangeText={setLabel}
                  placeholder="e.g. Nguyễn Danh Lương"
                  placeholderTextColor={theme.colors.foregroundMuted}
                  style={inputStyle}
                />
              </View>
              <Button
                theme={theme}
                label="Refresh QR"
                icon="RefreshCw"
                busy={starting}
                onPress={() => void handleStart(label)}
              />
            </View>
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
