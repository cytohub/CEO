import { AdminPageSkeleton } from "@/components/admin/admin-page";

export default function UsersLoading() {
  return <AdminPageSkeleton label="users" blocks={[300, 140, 220]} />;
}
