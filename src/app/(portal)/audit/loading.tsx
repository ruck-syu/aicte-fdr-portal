import { ListSkeleton } from "@/components/skeletons";

export default function Loading() {
  return <ListSkeleton filters={4} rows={10} />;
}
