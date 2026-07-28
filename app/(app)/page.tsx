import { redirect } from "next/navigation";
import { defaultLandingHref } from "@/domain/navigation";
import { getCachedActor } from "./_actor";

// "My Work is the default landing screen for BDE and Team Lead" (docs/06-ui-spec.md); the other
// roles land on Dashboard. layout.tsx already redirects signed-out/suspended sessions away from
// this whole segment, so by the time this runs the actor is always active.
export default async function AppHome() {
  const result = await getCachedActor();
  if (result.status !== "active") redirect("/sign-in");

  const roles = result.actor.roleGrants.map((grant) => grant.role);
  redirect(defaultLandingHref(roles));
}
