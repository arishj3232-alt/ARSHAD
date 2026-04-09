import { useCallback, useState } from "react";

const CLOUDINARY_CLOUD = "dwqgqkcac";
const CLOUDINARY_PRESET = "onlytwo_upload";
const CLOUDINARY_URL = `https://api.cloudinary.com/v1_1/${CLOUDINARY_CLOUD}/auto/upload`;

async function uploadToCloudinary(file: File): Promise<string> {
  const formData = new FormData();
  formData.append("file", file);
  formData.append("upload_preset", CLOUDINARY_PRESET);

  const res = await fetch(CLOUDINARY_URL, {
    method: "POST",
    body: formData,
  });

  const data = await res.json();
  return data.secure_url as string;
}

export function useMediaUpload() {
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState(0);

  const uploadMedia = useCallback(
    async (
      file: File
    ): Promise<{ url: string; type: "image" | "video" | "audio" }> => {
      setUploading(true);
      setProgress(30);
      try {
        const url = await uploadToCloudinary(file);
        setProgress(100);

        let type: "image" | "video" | "audio";
        if (file.type.startsWith("image/")) {
          type = "image";
        } else if (file.type.startsWith("video/")) {
          type = "video";
        } else {
          type = "audio";
        }

        return { url, type };
      } finally {
        setUploading(false);
        setProgress(0);
      }
    },
    []
  );

  return { uploading, progress, uploadMedia };
}
