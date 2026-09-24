import { Workspace } from "@/components/workspace";
import { SystemDashboard } from "@/components/system/dashboard";
export default function Page() {
  return (
    <Workspace title="Platform overview" system>
      <SystemDashboard />
    </Workspace>
  );
}
