import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "./ui/button";

export type SelectedFeedbackImage = { requestKey: string; file: File; previewUrl: string };
const types = new Set(["image/png", "image/jpeg", "image/webp"]);
const MAX_BYTES = 10 * 1024 * 1024;

/** Explicit local selection only. No screenshots, requests, binary browser
 * storage or original-name persistence. Parent owns the immutable submit and
 * current-account fence; previews are released on removal and unmount. */
export function useSelectedFeedbackImages() {
  const [images, setImages] = useState<SelectedFeedbackImage[]>([]);
  const active = useRef(images);
  active.current = images;
  useEffect(() => () => {
    for (const image of active.current) URL.revokeObjectURL(image.previewUrl);
  }, []);
  function change(next: SelectedFeedbackImage[]) {
    for (const image of active.current)
      if (!next.some(item => item.requestKey === image.requestKey)) URL.revokeObjectURL(image.previewUrl);
    active.current = next;
    setImages(next);
  }
  return { images, change };
}

export function FeedbackImageSelection({ images, onChange, enabled, locked }: {
  images: SelectedFeedbackImage[];
  onChange: (images: SelectedFeedbackImage[]) => void;
  enabled: boolean;
  locked: boolean;
}) {
  const { t } = useTranslation("experience"), input = useRef<HTMLInputElement>(null);
  const [error, setError] = useState(false);
  return <section className="space-y-3" aria-label={t("feedback.images.title")}>
    <p className="text-sm text-muted-foreground">{t(enabled ? "feedback.images.notice" : "feedback.imagesUnavailable")}</p>
    <input ref={input} hidden tabIndex={-1} type="file" multiple accept="image/png,image/jpeg,image/webp"
      disabled={!enabled || locked || images.length >= 3} aria-label={t("feedback.images.select")}
      onChange={event => {
        const files = Array.from(event.currentTarget.files ?? []);
        event.currentTarget.value = "";
        if (!enabled || locked) return;
        // Validate the entire selection before creating any local Blob URL.
        if (images.length + files.length > 3 || files.some(file => !types.has(file.type) || file.size < 1 || file.size > MAX_BYTES)) {
          setError(true); return;
        }
        setError(false);
        onChange([...images, ...files.map(file => ({ file, requestKey: crypto.randomUUID(), previewUrl: URL.createObjectURL(file) }))]);
      }} />
    <Button type="button" variant="outline" className="min-h-11" disabled={!enabled || locked || images.length >= 3}
      onClick={() => input.current?.click()}>{t("feedback.images.select")}</Button>
    {error && <p role="alert">{t("feedback.images.invalid")}</p>}
    {images.length > 0 && <ul className="space-y-3">{images.map((image, index) => <li key={image.requestKey} className="space-y-2">
      <img className="max-h-40 max-w-full rounded-md object-contain" src={image.previewUrl}
        alt={t("feedback.images.preview", { number: index + 1 })} />
      <p className="break-all text-sm">{image.file.name}</p>
      <Button type="button" variant="outline" className="min-h-11" disabled={locked}
        aria-label={t("feedback.images.removeNumber", { number: index + 1 })}
        onClick={() => { onChange(images.filter(item => item.requestKey !== image.requestKey)); setError(false); }}>{t("feedback.images.remove")}</Button>
    </li>)}</ul>}
  </section>;
}
