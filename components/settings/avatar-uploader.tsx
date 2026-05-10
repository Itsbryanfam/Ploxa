"use client";

import { useCallback, useRef, useState } from "react";
import Cropper from "react-easy-crop";
import type { Area } from "react-easy-crop";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";

const MAX_BYTES = 5 * 1024 * 1024;
const ALLOWED = ["image/jpeg", "image/png", "image/webp", "image/gif"] as const;

type Kind = "static" | "gif";
type Allowed = (typeof ALLOWED)[number];

function isAllowed(t: string): t is Allowed {
  return (ALLOWED as readonly string[]).includes(t);
}

interface Props {
  onResult: (blob: Blob, kind: Kind) => void;
  /** Trigger element (e.g. the avatar slot). Click → file picker. */
  children: React.ReactNode;
}

export function AvatarUploader({ onResult, children }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [imageDataUrl, setImageDataUrl] = useState<string | null>(null);
  const [crop, setCrop] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [croppedAreaPixels, setCroppedAreaPixels] = useState<Area | null>(null);

  const handleFile = (file: File) => {
    setError(null);
    if (!isAllowed(file.type)) {
      setError("Upload a JPG, PNG, WebP, or GIF.");
      return;
    }
    if (file.size > MAX_BYTES) {
      setError(
        `File is ${(file.size / 1024 / 1024).toFixed(1)} MB. Max is 5 MB.`,
      );
      return;
    }
    if (file.type === "image/gif") {
      onResult(file, "gif");
      return;
    }
    const reader = new FileReader();
    reader.onload = () => setImageDataUrl(reader.result as string);
    reader.readAsDataURL(file);
  };

  const onCropComplete = useCallback((_: Area, areaPixels: Area) => {
    setCroppedAreaPixels(areaPixels);
  }, []);

  const handleConfirm = async () => {
    if (!imageDataUrl || !croppedAreaPixels) return;
    const blob = await cropImage(imageDataUrl, croppedAreaPixels);
    onResult(blob, "static");
    setImageDataUrl(null);
  };

  const handleCancel = () => setImageDataUrl(null);

  return (
    <>
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        className="rounded-full focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
      >
        {children}
      </button>
      <input
        ref={inputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp,image/gif"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) handleFile(file);
          e.target.value = ""; // allow picking the same file twice
        }}
      />
      {error && (
        <p className="mt-2 text-sm text-red-500" role="alert">
          {error}
        </p>
      )}
      <Dialog
        open={imageDataUrl !== null}
        onOpenChange={(o) => !o && setImageDataUrl(null)}
      >
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Crop your photo</DialogTitle>
          </DialogHeader>
          {imageDataUrl && (
            <div className="relative h-96 w-full bg-black">
              <Cropper
                image={imageDataUrl}
                crop={crop}
                zoom={zoom}
                aspect={1}
                cropShape="round"
                showGrid={false}
                onCropChange={setCrop}
                onZoomChange={setZoom}
                onCropComplete={onCropComplete}
              />
            </div>
          )}
          <div className="px-4">
            <label className="text-sm">
              Zoom
              <input
                type="range"
                min="1"
                max="3"
                step="0.05"
                value={zoom}
                onChange={(e) => setZoom(Number(e.target.value))}
                className="ml-2 align-middle"
              />
            </label>
          </div>
          <DialogFooter>
            <Button variant="secondary" onClick={handleCancel}>
              Cancel
            </Button>
            <Button onClick={handleConfirm}>Save</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

/**
 * Render the cropped region of `imageSrc` (data URL) into a canvas, return as
 * a JPEG blob. JPEG keeps file sizes small for static avatars.
 */
async function cropImage(imageSrc: string, area: Area): Promise<Blob> {
  const img = new Image();
  img.src = imageSrc;
  await new Promise((res) => {
    img.onload = res;
  });
  const canvas = document.createElement("canvas");
  canvas.width = area.width;
  canvas.height = area.height;
  const ctx = canvas.getContext("2d")!;
  ctx.drawImage(
    img,
    area.x,
    area.y,
    area.width,
    area.height,
    0,
    0,
    area.width,
    area.height,
  );
  return await new Promise<Blob>((resolve) => {
    canvas.toBlob((b) => resolve(b!), "image/jpeg", 0.92);
  });
}
