import { useCallback, useState } from "react";
import { ref, uploadBytesResumable, getDownloadURL } from "firebase/storage";
import { storage } from "@/lib/firebase";

export function useMediaUpload() {
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState(0);

  const uploadFile = useCallback(
    async (
      file: File,
      path: string
    ): Promise<string> => {
      setUploading(true);
      setProgress(0);
      return new Promise((resolve, reject) => {
        const storageRef = ref(storage, path);
        const uploadTask = uploadBytesResumable(storageRef, file);
        uploadTask.on(
          "state_changed",
          (snap) => {
            setProgress((snap.bytesTransferred / snap.totalBytes) * 100);
          },
          (err) => {
            setUploading(false);
            reject(err);
          },
          async () => {
            const url = await getDownloadURL(uploadTask.snapshot.ref);
            setUploading(false);
            resolve(url);
          }
        );
      });
    },
    []
  );

  const uploadMedia = useCallback(
    async (file: File): Promise<{ url: string; type: "image" | "video" | "audio" }> => {
      const timestamp = Date.now();
      const ext = file.name.split(".").pop() ?? "";
      const path = `media/${timestamp}_${Math.random().toString(36).slice(2)}.${ext}`;
      const url = await uploadFile(file, path);
      if (file.type.startsWith("image/")) return { url, type: "image" };
      if (file.type.startsWith("video/")) return { url, type: "video" };
      return { url, type: "audio" };
    },
    [uploadFile]
  );

  return { uploading, progress, uploadMedia };
}
