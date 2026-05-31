export type JoinInvitePayload = {
  type: 'digikladde_join';
  version: 1;
  roomId: string;
  joinSecret: string;
  courseSyncId?: string;
};

export type ParsedJoinInvite = {
  roomId: string;
  joinSecret: string;
  courseSyncId?: string;
};

export const parseJoinInvite = (rawValue: string): ParsedJoinInvite | null => {
  const text = rawValue.trim();
  if (!text) return null;

  try {
    const parsed = JSON.parse(text) as Partial<JoinInvitePayload>;
    if (parsed.type === 'digikladde_join' && parsed.roomId && parsed.joinSecret) {
      return {
        roomId: parsed.roomId.trim(),
        joinSecret: parsed.joinSecret.trim(),
        courseSyncId: parsed.courseSyncId?.trim() || undefined,
      };
    }
  } catch {
    // Fallback for old text format.
  }

  const roomIdMatch = text.match(/roomId\s*=\s*([^\n\r]+)/i);
  const joinSecretMatch = text.match(/joinSecret\s*=\s*([^\n\r]+)/i);
  const courseSyncIdMatch = text.match(/courseSyncId\s*=\s*([^\n\r]+)/i);
  if (!roomIdMatch || !joinSecretMatch) return null;

  return {
    roomId: roomIdMatch[1].trim(),
    joinSecret: joinSecretMatch[1].trim(),
    courseSyncId: courseSyncIdMatch?.[1]?.trim() || undefined,
  };
};
