import { Workspace } from "@/components/workspace";
import { SettingsPanel } from "@/components/operations/settings";
export default function Page() {
  return (
    <Workspace title="Business settings">
      <SettingsPanel />
    </Workspace>
  );
}
