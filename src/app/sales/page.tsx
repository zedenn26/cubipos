import { Workspace } from "@/components/workspace";
import { Reports } from "@/components/operations/reports";

export default function Page() {
  return (
    <Workspace title="Recent sales & receipts">
      <Reports salesOnly />
    </Workspace>
  );
}
