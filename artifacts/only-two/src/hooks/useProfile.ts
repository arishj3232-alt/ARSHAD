import { useState, useEffect, useCallback } from "react";
import { ref, set, onValue, update } from "firebase/database";
import { rtdb } from "@/lib/firebase";

const CLOUDINARY_CLOUD = "dwqgqkcac";
const CLOUDINARY_PRESET = "onlytwo_upload";
const CLOUDINARY_URL = `https://api.cloudinary.com/v1_1/${CLOUDINARY_CLOUD}/image/upload`;

async function hashFile(file: File): Promise<string> {
  const buf = await file.arrayBuffer();
  const hashBuf = await crypto.subtle.digest("SHA-256", buf);
  return Array.from(new Uint8Array(hashBuf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

async function uploadToCloudinary(file: File): Promise<string> {
  const formData = new FormData();
  formData.append("file", file);
  formData.append("upload_preset", CLOUDINARY_PRESET);
  const res = await fetch(CLOUDINARY_URL, { method: "POST", body: formData });
  const data = await res.json();
  return data.secure_url as string;
}

export type UserProfile = {
  dpUrl: string | null;
  dpHash: string | null;
  /**
   * Per-user read privacy: when true, this user does not send read receipts
   * (others never see blue ticks for messages they read).
   */
  readReceiptsEnabled?: boolean;
};

export function useProfile(userId: string | null) {
  const [profile, setProfile] = useState<UserProfile>({ dpUrl: null, dpHash: null });
  const [allProfiles, setAllProfiles] = useState<Record<string, UserProfile>>({});
  const [uploading, setUploading] = useState(false);

  useEffect(() => {
    try {
      const profilesRef = ref(rtdb, "profiles");
      const unsub = onValue(profilesRef, (snap) => {
        const data = (snap.val() ?? {}) as Record<string, UserProfile & Record<string, unknown>>;
        setAllProfiles(data as Record<string, UserProfile>);
        if (userId) {
          const row = data[userId];
          if (row) {
            setProfile({
              dpUrl: row.dpUrl ?? null,
              dpHash: row.dpHash ?? null,
              readReceiptsEnabled: row.readReceiptsEnabled === true,
            });
          } else {
            setProfile({ dpUrl: null, dpHash: null, readReceiptsEnabled: false });
          }
        }
      }, () => {});
      return () => unsub();
    } catch {
      return undefined;
    }
  }, [userId]);

  const uploadDp = useCallback(
    async (file: File) => {
      if (!userId) return;
      setUploading(true);
      try {
        const hash = await hashFile(file);
        if (profile.dpHash === hash) {
          return;
        }
        const url = await uploadToCloudinary(file);
        const newProfile: UserProfile = {
          dpUrl: url,
          dpHash: hash,
          readReceiptsEnabled: profile.readReceiptsEnabled === true,
        };
        await set(ref(rtdb, `profiles/${userId}`), newProfile);
        setProfile(newProfile);
      } catch {
      } finally {
        setUploading(false);
      }
    },
    [userId, profile.dpHash, profile.readReceiptsEnabled]
  );

  const updateReadReceiptsEnabled = useCallback(async (enabled: boolean) => {
    if (!userId) return;
    try {
      await update(ref(rtdb, `profiles/${userId}`), { readReceiptsEnabled: enabled });
      setProfile((p) => ({ ...p, readReceiptsEnabled: enabled }));
    } catch {
      /* noop */
    }
  }, [userId]);

  const getDpUrl = useCallback(
    (uid: string) => allProfiles[uid]?.dpUrl ?? null,
    [allProfiles]
  );

  const deleteDp = useCallback(async () => {
    if (!userId) return;
    try {
      const cleared: UserProfile = {
        dpUrl: null,
        dpHash: null,
        readReceiptsEnabled: profile.readReceiptsEnabled === true,
      };
      await set(ref(rtdb, `profiles/${userId}`), cleared);
      setProfile(cleared);
    } catch {
    }
  }, [userId, profile.readReceiptsEnabled]);

  return { profile, uploading, uploadDp, deleteDp, getDpUrl, updateReadReceiptsEnabled, allProfiles };
}
