import { Workspace } from "@/components/workspace";
import { Catalog } from "@/components/operations/catalog";
export default function Page() {
  return (
    <Workspace title="Products">
      <Catalog />
    </Workspace>
  );
}
