// Fixed shapes: nothing here may be reported.
export async function listMine() {
  const user = await getAuthedUser();
  return user?.id ?? null;
}

// An Edge Function verifying a token it was handed is a different call.
export async function verify(token: string) {
  return await supabase.auth.getUser(token);
}
