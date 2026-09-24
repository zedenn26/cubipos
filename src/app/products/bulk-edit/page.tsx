import { ProductBulkEditor } from "@/components/operations/product-bulk-editor";
import { Workspace } from "@/components/workspace";

export default function Page() {
  return (
    <Workspace title="Bulk edit products">
      <ProductBulkEditor />
    </Workspace>
  );
}
