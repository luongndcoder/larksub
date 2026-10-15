import type { PluginClientContext } from "@getpaseo/plugin/client";
import { LarkAccountsSurface } from "./client/accounts-surface";
import { contributeCommands } from "./client/commands";
import { contributePills } from "./client/pills";
import { LarkSubStore } from "./client/store";

export default function contribute(client: PluginClientContext) {
  const store = new LarkSubStore(client);
  const stopStore = store.start();

  client.addSurface("lark-accounts", (props) => <LarkAccountsSurface {...props} store={store} />);
  client.addSidebarItem({
    id: "lark-accounts",
    title: "Lark Accounts",
    icon: "Users",
    surface: "lark-accounts",
  });

  const stopPills = contributePills(client, store);
  const stopCommands = contributeCommands(client, store);

  return () => {
    stopCommands();
    stopPills();
    stopStore();
  };
}
