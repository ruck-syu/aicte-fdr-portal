import { ListSkeleton } from "@/components/skeletons";

export default function Loading() {
  return <ListSkeleton filters={5} rows={9} />;
}
