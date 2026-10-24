import { ListSkeleton } from "@/components/skeletons";

export default function Loading() {
  return <ListSkeleton filters={3} rows={8} />;
}
