import { LoadingSkeleton } from "@/ui/states/LoadingSkeleton";

// Next.js's loading UI convention - shown automatically while this segment (and layout.tsx's
// session/role/tenant fetch) resolves. docs/06-ui-spec.md: "skeleton matching final layout, never
// a spinner alone."
export default function Loading() {
  return <LoadingSkeleton />;
}
