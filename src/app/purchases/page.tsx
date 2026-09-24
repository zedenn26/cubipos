import { Workspace } from "@/components/workspace";
import { Purchases } from "@/components/operations/purchases";
export default function Page() {
  return (
    <Workspace title="Suppliers & purchases">
      <Purchases />
    </Workspace>
  );
}
