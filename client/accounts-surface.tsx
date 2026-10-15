import { useSettings, type PluginSurfaceProps } from "@getpaseo/plugin/client";
import { Modal, TextInput, useToast } from "@getpaseo/plugin/client/react-native";
import { SettingsCard, SettingsSwitch } from "@getpaseo/plugin/client/ui";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ScrollView, Text, View } from "react-native";
import type { LarkAccountView } from "../shared/model";
import { preferences } from "../shared/preferences";
import {
  removeAccount,
  renameAccount,
  setAccountDisabled,
  setDefaultAccount,
  syncHostAccounts,
} from "../shared/rpc";
import { AddAccountModal } from "./add-account";
import { describe, useStore, VISIBLE_POLL_MS, type LarkSubStore } from "./store";
import { Badge, Button, Card, IconButton, useText, type Theme } from "./ui";

export function LarkAccountsSurface(props: PluginSurfaceProps & { store: LarkSubStore }) {
  const { theme, layout, store } = props;
  const { state, error } = useStore(store);
  const text = useText(theme);
  const toast = useToast();
  const settings = useSettings(preferences);
  const [adding, setAdding] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [syncing, setSyncing] = useState(false);

  useEffect(() => store.watch(VISIBLE_POLL_MS), [store]);

  const handleRefreshAll = useCallback(async () => {
    setRefreshing(true);
    try {
      await store.refresh({ refresh: true });
      toast.show("Refreshed Lark account status", { variant: "success" });
    } catch (err) {
      toast.error(describe(err));
    } finally {
      setRefreshing(false);
    }
  }, [store, toast]);

  const handleSyncHost = useCallback(async () => {
    setSyncing(true);
    try {
      await store.rpc(syncHostAccounts, {});
      toast.show("Synced Lark accounts from host Keychain", { variant: "success" });
    } catch (err) {
      toast.error(describe(err));
    } finally {
      setSyncing(false);
    }
  }, [store, toast]);


  const accounts = state?.accounts ?? [];

  return (
    <View style={{ flex: 1, backgroundColor: theme.colors.surface0 }}>
      <ScrollView
        contentContainerStyle={{
          padding: layout.compact ? 16 : 28,
          gap: layout.compact ? 20 : 24,
          maxWidth: 820,
          width: "100%",
          alignSelf: "center",
        }}
      >
        <View style={{ gap: 6 }}>
          <Text style={[text.small, { fontWeight: "600", letterSpacing: 0.4, color: "#10b981" }]}>
            LarkSub · Multi-User Lark CLI
          </Text>
          <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
            <Text style={text.title} accessibilityRole="header">
              Lark Accounts
            </Text>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
              <Button
                theme={theme}
                size="small"
                icon="Download"
                label="Sync Host Keychain"
                busy={syncing}
                onPress={() => void handleSyncHost()}
              />
              <IconButton
                theme={theme}
                icon="RefreshCw"
                label="Refresh status"
                busy={refreshing}
                onPress={() => void handleRefreshAll()}
              />
              <Button
                theme={theme}
                tone="primary"
                size="small"
                icon="Plus"
                label="Add Lark Account"
                onPress={() => setAdding(true)}
              />
            </View>
          </View>
          <Text style={text.muted}>
            Authorize multiple team members' Lark accounts on this machine and choose which Lark account each Paseo
            session uses when running lark-cli skills (calendar, docs, IM, tasks, base, mail).
          </Text>
        </View>

        {error ? (
          <Card theme={theme}>
            <Text style={text.danger}>{error}</Text>
          </Card>
        ) : null}

        <Card theme={theme}>
          <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
            <View style={{ gap: 2 }}>
              <Text style={text.strong}>Shared Lark App Configuration</Text>
              <Text style={text.small}>
                {state?.appConfig
                  ? `App ID: ${state.appConfig.appId} (${state.appConfig.brand.toUpperCase()})`
                  : "No ~/.lark-cli/config.json detected"}
              </Text>
            </View>
            <Badge
              theme={theme}
              label={state?.larkCliAvailable ? "lark-cli ready" : "lark-cli missing"}
              tone={state?.larkCliAvailable ? "success" : "danger"}
            />
          </View>
          {state?.larkCliPath ? <Text style={text.small}>Binary: {state.larkCliPath}</Text> : null}
        </Card>

        <View style={{ gap: 12 }}>
          <Text style={text.heading}>Authorized Team Accounts ({accounts.length})</Text>
          {accounts.length === 0 ? (
            <Card theme={theme}>
              <Text style={text.body}>No Lark accounts registered yet.</Text>
              <Text style={text.muted}>
                Click "Add Lark Account" to scan a QR code with your Lark app, or "Sync Host Keychain" to import existing
                lark-cli logins on this Mac.
              </Text>
              <View style={{ flexDirection: "row", gap: 8 }}>
                <Button
                  theme={theme}
                  tone="primary"
                  icon="Plus"
                  label="Add Lark Account"
                  onPress={() => setAdding(true)}
                />
                <Button
                  theme={theme}
                  icon="Download"
                  label="Sync Host Keychain"
                  busy={syncing}
                  onPress={() => void handleSyncHost()}
                />
              </View>
            </Card>
          ) : (
            accounts.map((account) => (
              <AccountCard
                key={account.id}
                theme={theme}
                account={account}
                store={store}
                onReauthorize={() => setAdding(true)}
              />
            ))
          )}
        </View>

        {settings.status === "ready" ? (
          <View style={{ gap: 12 }}>
            <Text style={text.heading}>Preferences</Text>
            <SettingsCard>
              <SettingsSwitch
                label="Show Lark account switcher in session composer"
                hint="Displays a Lark · <User> pill in every agent session composer so team members can switch their session's Lark account with 1 click."
                value={settings.values.showComposerPill}
                disabled={settings.saving}
                onValueChange={(showComposerPill) => {
                  void settings
                    .save({ ...settings.values, showComposerPill }, settings.revision)
                    .then(() => store.refresh());
                }}
              />
            </SettingsCard>
          </View>
        ) : null}
      </ScrollView>

      {adding ? <AddAccountModal theme={theme} store={store} onClose={() => setAdding(false)} /> : null}
    </View>
  );
}

function AccountCard({
  theme,
  account,
  store,
  onReauthorize,
}: {
  theme: Theme;
  account: LarkAccountView;
  store: LarkSubStore;
  onReauthorize(): void;
}) {
  const text = useText(theme);
  const toast = useToast();
  const [busy, setBusy] = useState<string | null>(null);
  const [renaming, setRenaming] = useState(false);

  const statusBadge = useMemo(() => {
    switch (account.status) {
      case "active":
        return { label: "Active", tone: "success" as const };
      case "expired":
        return { label: "Token Expired", tone: "warning" as const };
      case "signed_out":
        return { label: "Signed Out", tone: "danger" as const };
      case "disabled":
        return { label: "Disabled", tone: "muted" as const };
    }
  }, [account.status]);

  const handleMakeDefault = useCallback(async () => {
    setBusy("default");
    try {
      await store.rpc(setDefaultAccount, { accountId: account.id });
      toast.show(`${account.label} is now the default Lark account`, { variant: "success" });
    } catch (err) {
      toast.error(describe(err));
    } finally {
      setBusy(null);
    }
  }, [store, account.id, account.label, toast]);

  const handleToggleDisabled = useCallback(async () => {
    setBusy("toggle");
    try {
      await store.rpc(setAccountDisabled, { accountId: account.id, disabled: !account.disabled });
    } catch (err) {
      toast.error(describe(err));
    } finally {
      setBusy(null);
    }
  }, [store, account.id, account.disabled, toast]);

  const handleRefreshOne = useCallback(async () => {
    setBusy("refresh");
    try {
      await store.refresh({ refresh: true, accountId: account.id });
    } catch (err) {
      toast.error(describe(err));
    } finally {
      setBusy(null);
    }
  }, [store, account.id, toast]);

  const handleRemove = useCallback(async () => {
    setBusy("remove");
    try {
      await store.rpc(removeAccount, { accountId: account.id });
      toast.show(`Removed ${account.label}`, { variant: "success" });
    } catch (err) {
      toast.error(describe(err));
    } finally {
      setBusy(null);
    }
  }, [store, account.id, account.label, toast]);


  return (
    <Card theme={theme}>
      <View style={{ flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between", gap: 12 }}>
        <View style={{ flex: 1, gap: 4 }}>
          <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 8 }}>
            <Text style={text.heading}>{account.label}</Text>
            <Badge theme={theme} label={statusBadge.label} tone={statusBadge.tone} />
            {account.isDefault ? <Badge theme={theme} label="Default" tone="accent" /> : null}
          </View>
          <Text style={text.muted}>
            {account.userName} · {account.userOpenId}
          </Text>
          {typeof account.scopeCount === "number" ? (
            <Text style={text.small}>{account.scopeCount} OAuth scopes granted</Text>
          ) : null}
          {account.lastError ? <Text style={text.danger}>{account.lastError}</Text> : null}
        </View>

        <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
          <IconButton
            theme={theme}
            icon="RefreshCw"
            label="Verify token status"
            busy={busy === "refresh"}
            onPress={() => void handleRefreshOne()}
          />
          <IconButton
            theme={theme}
            icon="Pencil"
            label="Rename account"
            onPress={() => setRenaming(true)}
          />
          <IconButton
            theme={theme}
            icon="Trash2"
            tone="danger"
            label="Remove account"
            busy={busy === "remove"}
            onPress={() => void handleRemove()}
          />
        </View>
      </View>

      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
        {!account.isDefault && !account.disabled ? (
          <Button
            theme={theme}
            size="small"
            icon="Star"
            label="Set as Default"
            busy={busy === "default"}
            onPress={() => void handleMakeDefault()}
          />
        ) : null}
        {account.status === "expired" || account.status === "signed_out" ? (
          <Button
            theme={theme}
            tone="primary"
            size="small"
            icon="QrCode"
            label="Re-authenticate"
            onPress={onReauthorize}
          />
        ) : null}
        <Button
          theme={theme}
          size="small"
          label={account.disabled ? "Enable" : "Disable"}
          busy={busy === "toggle"}
          onPress={() => void handleToggleDisabled()}
        />
      </View>

      {renaming ? (
        <RenameModal theme={theme} account={account} store={store} onClose={() => setRenaming(false)} />
      ) : null}
    </Card>
  );
}

function RenameModal({
  theme,
  account,
  store,
  onClose,
}: {
  theme: Theme;
  account: LarkAccountView;
  store: LarkSubStore;
  onClose(): void;
}) {
  const text = useText(theme);
  const toast = useToast();
  const [label, setLabel] = useState(account.label);
  const [saving, setSaving] = useState(false);

  const handleSave = useCallback(async () => {
    const trimmed = label.trim();
    if (!trimmed) return;
    setSaving(true);
    try {
      await store.rpc(renameAccount, { accountId: account.id, label: trimmed });
      onClose();
    } catch (err) {
      toast.error(describe(err));
    } finally {
      setSaving(false);
    }
  }, [label, account.id, store, onClose, toast]);

  const inputStyle = useMemo(
    () => ({
      color: theme.colors.foreground,
      backgroundColor: theme.colors.surface2,
      borderColor: theme.colors.border,
      borderWidth: 1,
      borderRadius: 8,
      paddingHorizontal: 12,
      paddingVertical: 10,
      fontSize: 15,
    }),
    [theme],
  );

  return (
    <Modal title="Rename Lark Account" open onOpenChange={(open) => (open ? undefined : onClose())}>
      <Modal.Content>
        <Text style={text.muted}>Choose a short display name shown in the session composer pill.</Text>
        <TextInput
          value={label}
          onChangeText={setLabel}
          autoFocus
          maxLength={40}
          placeholder="Display name"
          placeholderTextColor={theme.colors.foregroundMuted}
          onSubmitEditing={() => void handleSave()}
          style={inputStyle}
        />
        <View style={{ flexDirection: "row", gap: 8, justifyContent: "flex-end" }}>
          <Button theme={theme} label="Cancel" onPress={onClose} />
          <Button
            theme={theme}
            tone="primary"
            label="Save"
            busy={saving}
            disabled={!label.trim()}
            onPress={() => void handleSave()}
          />
        </View>
      </Modal.Content>
    </Modal>
  );
}
