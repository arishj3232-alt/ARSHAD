import { ExternalLink } from "lucide-react";

const URL_REGEX = /(https?:\/\/[^\s<>"]+)/g;

function getYouTubeId(url: string): string | null {
  const m =
    url.match(/youtu\.be\/([A-Za-z0-9_-]{11})/) ??
    url.match(/[?&]v=([A-Za-z0-9_-]{11})/);
  return m ? m[1] : null;
}

function getDomain(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

function getDeepLink(url: string): string {
  const domain = getDomain(url);
  if (domain.includes("youtube.com") || domain.includes("youtu.be")) return url;
  if (domain.includes("spotify.com")) return url.replace("https://open.spotify.com", "spotify://");
  if (domain.includes("instagram.com")) return url;
  return url;
}

type PreviewType = "youtube" | "spotify" | "instagram" | "generic";

function getType(url: string): PreviewType {
  const domain = getDomain(url);
  if (domain.includes("youtube.com") || domain.includes("youtu.be")) return "youtube";
  if (domain.includes("spotify.com")) return "spotify";
  if (domain.includes("instagram.com")) return "instagram";
  return "generic";
}

const TYPE_META: Record<PreviewType, { label: string; color: string; icon: string }> = {
  youtube: { label: "YouTube", color: "#ff0000", icon: "▶" },
  spotify: { label: "Spotify", color: "#1db954", icon: "♫" },
  instagram: { label: "Instagram", color: "#e1306c", icon: "◈" },
  generic: { label: "", color: "#8b5cf6", icon: "🔗" },
};

function LinkCard({ url, isOwn }: { url: string; isOwn: boolean }) {
  const type = getType(url);
  const meta = TYPE_META[type];
  const domain = getDomain(url);
  const ytId = type === "youtube" ? getYouTubeId(url) : null;
  const deepLink = getDeepLink(url);

  return (
    <a
      href={deepLink}
      target="_blank"
      rel="noopener noreferrer"
      className={`
        block mt-2 rounded-xl overflow-hidden border transition-all duration-200
        hover:scale-[1.01] hover:shadow-lg active:scale-[0.99]
        ${isOwn ? "border-white/20 bg-black/20" : "border-white/10 bg-white/5"}
      `}
    >
      {ytId && (
        <div className="relative">
          <img
            src={`https://img.youtube.com/vi/${ytId}/hqdefault.jpg`}
            alt="YouTube thumbnail"
            className="w-full h-28 object-cover"
            loading="lazy"
          />
          <div className="absolute inset-0 bg-black/30 flex items-center justify-center">
            <div className="w-10 h-10 rounded-full bg-red-600 flex items-center justify-center shadow-lg">
              <span className="text-white text-sm ml-0.5">▶</span>
            </div>
          </div>
        </div>
      )}
      <div className="flex items-center gap-2.5 px-3 py-2">
        <div
          className="w-6 h-6 rounded flex items-center justify-center text-xs text-white flex-shrink-0"
          style={{ backgroundColor: meta.color }}
        >
          {meta.icon}
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-xs text-white/80 font-medium truncate">
            {meta.label || domain}
          </p>
          <p className="text-[10px] text-white/40 truncate">{domain}</p>
        </div>
        <ExternalLink className="w-3.5 h-3.5 text-white/30 flex-shrink-0" />
      </div>
    </a>
  );
}

export function parseLinks(text: string): Array<{ type: "text" | "url"; value: string }> {
  const parts: Array<{ type: "text" | "url"; value: string }> = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  const re = new RegExp(URL_REGEX.source, "g");
  while ((match = re.exec(text)) !== null) {
    if (match.index > lastIndex) {
      parts.push({ type: "text", value: text.slice(lastIndex, match.index) });
    }
    parts.push({ type: "url", value: match[0] });
    lastIndex = match.index + match[0].length;
  }
  if (lastIndex < text.length) {
    parts.push({ type: "text", value: text.slice(lastIndex) });
  }
  return parts;
}

export function hasLinks(text: string): boolean {
  return URL_REGEX.test(text);
}

type TextWithLinksProps = {
  text: string;
  isOwn: boolean;
};

export default function TextWithLinks({ text, isOwn }: TextWithLinksProps) {
  const parts = parseLinks(text);
  const urls = parts.filter((p) => p.type === "url").map((p) => p.value);

  return (
    <>
      <p className="text-sm leading-relaxed break-words whitespace-pre-wrap">
        {parts.map((part, i) =>
          part.type === "url" ? (
            <a
              key={i}
              href={getDeepLink(part.value)}
              target="_blank"
              rel="noopener noreferrer"
              className={`
                underline underline-offset-2 transition-colors duration-150
                ${isOwn
                  ? "text-white/80 hover:text-white decoration-white/40 hover:decoration-white"
                  : "text-pink-300 hover:text-pink-200 decoration-pink-400/50 hover:decoration-pink-300"
                }
              `}
              onClick={(e) => e.stopPropagation()}
            >
              {part.value}
            </a>
          ) : (
            part.value
          )
        )}
      </p>
      {urls.slice(0, 2).map((url) => (
        <LinkCard key={url} url={url} isOwn={isOwn} />
      ))}
    </>
  );
}
