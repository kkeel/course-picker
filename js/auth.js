// =====================================================
// AUTHENTICATION MODULE
// Phase 1: Development Mode Only
// Later we swap the real Memberstack logic into this file.
// =====================================================

// Set to true while building so you never get locked out.
// Change to false only after connecting Memberstack.
export const AUTH_DEV_MODE = true;

export async function getCurrentUser() {
  if (AUTH_DEV_MODE) {
    // Fake "staff" identity so ALL features remain unlocked.
    return {
      id: "dev-user",
      email: "dev@example.com",
      role: "staff",        // "staff" | "member" | "anonymous"
      plans: ["all-access"], 
    };
  }

  // --------------------------------------------
  // REAL MEMBERSTACK MODE (later)
  // --------------------------------------------
  return window.MemberStack.onReady.then(member => {
    if (!member.loggedIn) {
      return {
        id: null,
        email: null,
        role: "anonymous",
        plans: [],
      };
    }

    const plans = member.memberships || [];
    const role =
      plans.some(p => p.id === "STAFF_PLAN_ID") ? "staff" :
      plans.length > 0 ? "member" :
      "anonymous";

    return {
      id: member.id,
      email: member.email,
      role,
      plans,
    };
  });
}
