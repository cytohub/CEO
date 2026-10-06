import { AdminPageSkeleton } from "@/components/admin/admin-page";

export default function AuditLoading() {
  return <AdminPageSkeleton label="audit log" blocks={[40, 560]} />;
}
