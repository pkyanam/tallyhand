"use client";
import { useClerk, useUser } from "@clerk/nextjs";
import { UserPill } from "./user-pill";
export function ClerkUserPill() {
  const { user } = useUser();
  const { signOut } = useClerk();
  return <UserPill name={user?.fullName || user?.firstName || user?.primaryEmailAddress?.emailAddress || "My account"}
    email={user?.primaryEmailAddress?.emailAddress} imageUrl={user?.imageUrl} cloud
    onSignOut={() => { void signOut({ redirectUrl: "/" }); }} />;
}
