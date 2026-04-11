import { useState } from "react";
import { cn } from "@/lib/utils";

const fallbackCls = "text-xs text-white/45 px-2 py-3 rounded-lg bg-white/5 border border-white/10";

type ImgProps = {
  src: string | undefined;
  alt?: string;
  className?: string;
  onClick?: () => void;
  draggable?: boolean;
  onContextMenu?: (e: React.MouseEvent) => void;
  style?: React.CSSProperties;
};

export function SafeImage({ src, alt = "", className, onClick, draggable, onContextMenu, style }: ImgProps) {
  const [error, setError] = useState(false);
  if (!src?.trim() || error) {
    return <div className={cn(fallbackCls, className)}>Media unavailable</div>;
  }
  return (
    <img
      src={src}
      alt={alt}
      loading="lazy"
      decoding="async"
      onError={() => setError(true)}
      onClick={onClick}
      draggable={draggable}
      onContextMenu={onContextMenu}
      className={className}
      style={style}
    />
  );
}

type MediaSrcProps = {
  src: string | undefined;
  className?: string;
  playsInline?: boolean;
  autoPlay?: boolean;
  muted?: boolean;
};

export function SafeVideo({ src, className, playsInline = true, autoPlay, muted }: MediaSrcProps) {
  const [error, setError] = useState(false);
  if (!src?.trim() || error) {
    return <div className={cn(fallbackCls, className)}>Video unavailable</div>;
  }
  return (
    <video
      src={src}
      controls
      playsInline={playsInline}
      autoPlay={autoPlay}
      muted={muted}
      className={className}
      onError={() => setError(true)}
    />
  );
}

export function SafeAudio({ src, className }: MediaSrcProps) {
  const [error, setError] = useState(false);
  if (!src?.trim() || error) {
    return <div className={cn(fallbackCls, className)}>Audio unavailable</div>;
  }
  return <audio src={src} controls className={className} onError={() => setError(true)} />;
}
