import { ListSkeleton } from "@/components/skeletons";

export default function Loading() {
  return <ListSkeleton filters={1} rows={9} />;
}
